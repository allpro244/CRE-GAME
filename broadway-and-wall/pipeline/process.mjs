// Normalize raw source data (real or synthetic) into the game's data files:
//   public/data/parcels.json   — attribute table keyed by BBL (the sim substrate)
//   public/data/adjacency.json — BBL -> neighboring BBLs (shared lot lines)
//   public/data/stations.json, context.geojson, manifest.json
//   pipeline/out/{parcels,buildings}.geojson — inputs for tiles.mjs
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProjection, polygonArea, centroid, bboxOfRing, sharedBoundaryLength, insetRing } from "./lib/geom.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
const OUT = join(ROOT, "out");
const PUB = join(ROOT, "..", "public", "data");
mkdirSync(OUT, { recursive: true });
mkdirSync(PUB, { recursive: true });

const read = (f) => JSON.parse(readFileSync(join(RAW, f), "utf8"));
if (!existsSync(join(RAW, "parcels.geojson"))) {
  console.error("No raw data found. Run `node pipeline/fetch.mjs` (real data) or `node pipeline/synth.mjs` (dev data) first.");
  process.exit(1);
}
const rawParcels = read("parcels.geojson");
const rawBuildings = read("buildings.geojson");
const rawStations = read("stations.geojson");
const manifest = read("manifest.json");
const employment = existsSync(join(RAW, "employment.geojson")) ? read("employment.geojson") : null;

const num = (v) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

// Asset-class remap from PLUTO building class letter (spec: office, retail,
// mixed, multifamily, land — odd classes get the closest fit).
function assetClass(bldgclass, landuse, bldgarea) {
  const c = (bldgclass ?? "").toUpperCase();
  const L = c[0];
  if (!bldgarea || L === "V" || landuse === "11") return "land";
  if (L === "G" || L === "T" || L === "Z" || L === "Q") return "land"; // garages/transport/misc: teardown-class
  if (L === "O" || L === "H" || L === "E" || L === "I" || L === "J" || L === "Y" || L === "W" || L === "P") return "office";
  if (L === "K" || L === "L") return "retail";
  if (L === "S" || c === "RM" || L === "M") return "mixed";
  if (L === "A" || L === "B" || L === "C" || L === "D" || L === "N" || L === "R") return "multifamily";
  return "mixed";
}

// --- pass 1: extract, project, measure -------------------------------------
// centroid of all features -> local meter frame
let cx = 0, cy = 0, cn = 0;
for (const f of rawParcels.features) {
  if (!f.geometry) continue;
  const ring = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0];
  for (const [x, y] of ring) { cx += x; cy += y; cn++; }
}
const proj = makeProjection(cx / cn, cy / cn);

const lots = [];
for (const f of rawParcels.features) {
  if (!f.geometry) continue;
  const p = f.properties;
  const bbl = String(p.bbl ?? p.BBL ?? "").replace(/\.0+$/, "");
  if (!bbl) continue;
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  // largest outer ring carries the lot for adjacency/centroid purposes
  let best = null, bestA = 0;
  for (const poly of polys) {
    const xy = poly[0].map(proj.toXY);
    const a = Math.abs(polygonArea([xy]));
    if (a > bestA) { bestA = a; best = xy; }
  }
  if (!best || bestA < 5) continue;
  lots.push({ bbl, p, ring: best, ringLL: f.geometry, areaM2: bestA, c: centroid(best) });
}

// medians by building class for imputation
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
const byClass = new Map();
for (const l of lots) {
  const k = (l.p.bldgclass ?? "??")[0];
  if (!byClass.has(k)) byClass.set(k, { years: [], floors: [], psf: [] });
  const g = byClass.get(k);
  const yb = num(l.p.yearbuilt); if (yb && yb > 1800) g.years.push(yb);
  const nf = num(l.p.numfloors); if (nf && nf > 0) g.floors.push(nf);
  const at = num(l.p.assesstot), la = num(l.p.lotarea);
  if (at && la) g.psf.push(at / la);
}

// --- demand kernels ---------------------------------------------------------
// keep stations within 1.5 km of the study area so a citywide dataset works
let lotsMinX = Infinity, lotsMinY = Infinity, lotsMaxX = -Infinity, lotsMaxY = -Infinity;
for (const l of lots) {
  if (l.c[0] < lotsMinX) lotsMinX = l.c[0]; if (l.c[0] > lotsMaxX) lotsMaxX = l.c[0];
  if (l.c[1] < lotsMinY) lotsMinY = l.c[1]; if (l.c[1] > lotsMaxY) lotsMaxY = l.c[1];
}
const stationPts = rawStations.features
  .filter((f) => f.geometry?.type === "Point")
  .map((f) => ({
    xy: proj.toXY(f.geometry.coordinates),
    w: num(f.properties.weight) ?? 30,
    name: f.properties.stop_name ?? f.properties.name ?? "station",
    lines: f.properties.daytime_routes ?? f.properties.line ?? "",
    ll: f.geometry.coordinates,
  }))
  .filter((s) =>
    s.xy[0] > lotsMinX - 1500 && s.xy[0] < lotsMaxX + 1500 &&
    s.xy[1] > lotsMinY - 1500 && s.xy[1] < lotsMaxY + 1500);

let jobPts;
if (employment?.features?.length) {
  jobPts = employment.features.map((f) => ({ xy: proj.toXY(f.geometry.coordinates), jobs: num(f.properties.jobs) ?? 0 }));
} else {
  // fallback proxy: jobs from commercial built area
  jobPts = lots
    .filter((l) => ["O", "K", "S", "R", "M"].includes((l.p.bldgclass ?? "")[0]))
    .map((l) => ({ xy: l.c, jobs: (num(l.p.bldgarea) ?? 0) / 300 }));
  console.warn("No LODES employment file — using built-area employment proxy for demandScore.");
}

// gaussian kernels with a 3σ cutoff via a bucket index — island-scale safe
const gauss = (d, r) => Math.exp(-(d * d) / (2 * r * r));
function bucketIndex(pts, cell) {
  const m = new Map();
  for (const p of pts) {
    const k = Math.floor(p.xy[0] / cell) + ":" + Math.floor(p.xy[1] / cell);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  return (c, radius, fn) => {
    const r = Math.ceil(radius / cell);
    const gx = Math.floor(c[0] / cell), gy = Math.floor(c[1] / cell);
    let acc = 0;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (const p of m.get((gx + dx) + ":" + (gy + dy)) ?? []) {
          const d = Math.hypot(c[0] - p.xy[0], c[1] - p.xy[1]);
          if (d <= radius) acc += fn(p, d);
        }
    return acc;
  };
}
const nearStations = bucketIndex(stationPts, 350);
const nearJobs = bucketIndex(jobPts, 300);
const raws = lots.map((l) => ({
  transit: nearStations(l.c, 1050, (s, d) => s.w * gauss(d, 350)),
  emp: nearJobs(l.c, 900, (j, d) => j.jobs * gauss(d, 300)),
}));
const p95 = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || 1; };
const t95 = p95(raws.map((r) => r.transit));
const e95 = p95(raws.map((r) => r.emp));

// --- adjacency: bbox grid index + shared boundary length --------------------
const CELL = 60; // meters
const grid = new Map();
lots.forEach((l, i) => {
  const [minX, minY, maxX, maxY] = bboxOfRing(l.ring);
  l.bbox = [minX, minY, maxX, maxY];
  for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
    for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy++) {
      const k = gx + ":" + gy;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
});
const TOL = 1.5;   // meters — the "buffer" of buffer-and-intersect
const MIN_SHARED = 3; // meters of shared lot line to count as adjacent
const adjacency = {};
let edgeCount = 0;
lots.forEach((l, i) => {
  const cand = new Set();
  const [minX, minY, maxX, maxY] = l.bbox;
  for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
    for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy++)
      for (const j of grid.get(gx + ":" + gy) ?? []) if (j > i) cand.add(j);
  for (const j of cand) {
    const m = lots[j];
    if (m.bbox[0] > maxX + TOL || m.bbox[2] < minX - TOL || m.bbox[1] > maxY + TOL || m.bbox[3] < minY - TOL) continue;
    const shared = sharedBoundaryLength(l.ring, m.ring, TOL);
    if (shared >= MIN_SHARED) {
      (adjacency[l.bbl] ??= []).push(m.bbl);
      (adjacency[m.bbl] ??= []).push(l.bbl);
      edgeCount++;
    }
  }
});

// --- assemble records --------------------------------------------------------
const table = {};
const tileParcels = { type: "FeatureCollection", features: [] };
for (let i = 0; i < lots.length; i++) {
  const l = lots[i], p = l.p;
  const imputed = [];
  const cls = (p.bldgclass ?? "").toUpperCase() || "??";
  const g = byClass.get(cls[0]) ?? { years: [], floors: [], psf: [] };

  let lotArea = num(p.lotarea);
  const geomSf = Math.round(l.areaM2 * 10.7639);
  if (!lotArea || lotArea < 100 || Math.abs(lotArea - geomSf) / geomSf > 3) {
    lotArea = geomSf; imputed.push("lotArea");
  }
  let floors = num(p.numfloors);
  let bldgArea = num(p.bldgarea);
  const vacant = assetClass(cls, p.landuse, bldgArea) === "land";
  if (!vacant) {
    if (!floors) { floors = median(g.floors) ?? 4; imputed.push("floors"); }
    if (!bldgArea) { bldgArea = Math.round(lotArea * 0.7 * floors); imputed.push("bldgArea"); }
  } else { floors = floors ?? 0; bldgArea = bldgArea ?? 0; }
  let yearBuilt = num(p.yearbuilt);
  if (!vacant && (!yearBuilt || yearBuilt < 1800)) { yearBuilt = median(g.years) ?? 1930; imputed.push("yearBuilt"); }
  let assessLand = num(p.assessland);
  let assessTot = num(p.assesstot);
  if (!assessLand || assessLand <= 0) {
    assessLand = Math.round(lotArea * (median(g.psf) ?? 120) * 0.35); imputed.push("assessedLand");
  }
  if (!assessTot || assessTot < assessLand) {
    assessTot = assessLand + Math.round(bldgArea * (median(g.psf) ?? 120) * 0.4); imputed.push("assessedTotal");
  }

  const dem = raws[i];
  const demandScore = Math.max(1, Math.min(100, Math.round(
    45 * Math.min(1, dem.transit / t95) + 55 * Math.min(1, dem.emp / e95)
  )));
  const assessedPsf = assessLand / lotArea;
  // assessed values run well below market; scale up, then blend with demand
  const landPsf = Math.max(30, Math.round((assessedPsf / 0.45) * (0.6 + 0.9 * (demandScore / 100))));

  const farMaxComm = num(p.commfar) ?? 0;
  const farMaxRes = num(p.resfar) ?? 0;
  const klass = assetClass(cls, p.landuse, bldgArea);

  table[l.bbl] = {
    bbl: l.bbl,
    address: p.address ?? "(no address)",
    borough: p.borough ?? "MN",
    block: p.block ?? l.bbl.slice(1, 6),
    lot: p.lot ?? l.bbl.slice(6),
    zoneDist: p.zonedist1 ?? "—",
    farMaxComm, farMaxRes,
    bldgClass: cls,
    class: klass,
    lotArea, bldgArea, floors, yearBuilt,
    unitsRes: num(p.unitsres) ?? 0,
    assessedLand: assessLand,
    assessedTotal: assessTot,
    demandScore,
    landPsf,
    landPsfHistory: [landPsf],
    imputed,
    centroid: proj.toLL(l.c).map((v) => +v.toFixed(6)),
  };

  tileParcels.features.push({
    type: "Feature",
    id: Number(l.bbl),
    geometry: l.ringLL,
    properties: {
      bbl: l.bbl, address: table[l.bbl].address, class: klass,
      demand: demandScore, landpsf: landPsf, zone: table[l.bbl].zoneDist,
    },
  });
}

// buildings for the tiler: join heights (feet -> meters) by base BBL.
// Massing: tall pre-1961 towers get wedding-cake setback tiers; tall modern
// towers get a podium (a low base filling the lot) with a slimmer shaft —
// both via stacked volumes with fill-extrusion-base.
const tileBuildings = { type: "FeatureCollection", features: [] };
let missingH = 0, tiered = 0, podiums = 0;
const lotRingByBBL = new Map(lots.map((l) => [l.bbl, l.ring]));

function setbackTiers(geom, hM) {
  // tiers only for a simple polygon with one meaningful outer ring
  if (geom.type !== "Polygon") return null;
  const ringLL = geom.coordinates[0];
  const ringXY = ringLL.slice(0, -1).map(proj.toXY);
  const areaM2 = Math.abs(polygonArea([ringXY]));
  if (areaM2 < 250) return null;
  const side = Math.sqrt(areaM2);
  const inset = (frac) => {
    const r = insetRing(ringXY, (side * (1 - Math.sqrt(frac))) / 2);
    if (!r) return null;
    const ll = r.map(proj.toLL);
    return { type: "Polygon", coordinates: [[...ll, ll[0]]] };
  };
  const mid = inset(0.66), top = inset(0.38);
  if (!mid || !top) return null;
  return [
    { geom, base: 0, top: +(hM * 0.52).toFixed(1) },
    { geom: mid, base: +(hM * 0.52).toFixed(1), top: +(hM * 0.82).toFixed(1) },
    { geom: top, base: +(hM * 0.82).toFixed(1), top: +hM.toFixed(1) },
  ];
}

for (const f of rawBuildings.features) {
  if (!f.geometry) continue;
  const bbl = String(f.properties.base_bbl ?? f.properties.bbl ?? "").replace(/\.0+$/, "");
  const rec = table[bbl];
  let hft = num(f.properties.heightroof);
  if (!hft || hft < 8) { hft = rec && rec.floors ? rec.floors * 11.5 : 30; missingH++; }
  const hM = +(hft * 0.3048).toFixed(1);
  const year = num(f.properties.cnstrct_yr) ?? rec?.yearBuilt ?? 1950;
  const props = {
    bbl: bbl || "",
    class: rec?.class ?? "office",
    year,
    // stable per-building tone jitter for the facade palette
    tone: bbl ? Number(bbl) % 5 : 0,
  };
  const id = bbl && table[bbl] ? Number(bbl) : undefined;
  const tiers = year < 1961 && hM >= 60 ? setbackTiers(f.geometry, hM) : null;
  let podium = null;
  if (!tiers && year >= 1961 && hM >= 45) {
    // modern tower: low podium on (nearly) the whole lot, shaft above
    const lotRingM = lotRingByBBL.get(bbl);
    if (lotRingM) {
      const pod = insetRing(lotRingM, 1.4);
      if (pod) {
        const ll = pod.map(proj.toLL);
        podium = { type: "Polygon", coordinates: [[...ll, ll[0]]] };
      }
    }
  }
  if (tiers) {
    tiered++;
    for (const t of tiers) {
      tileBuildings.features.push({
        type: "Feature", id,
        geometry: t.geom,
        properties: { ...props, heightM: t.top, baseM: t.base },
      });
    }
  } else if (podium) {
    podiums++;
    tileBuildings.features.push({
      type: "Feature", id,
      geometry: podium,
      properties: { ...props, heightM: 8, baseM: 0 },
    });
    tileBuildings.features.push({
      type: "Feature", id,
      geometry: f.geometry,
      properties: { ...props, heightM: hM, baseM: 8 },
    });
  } else {
    const baseFt = num(f.properties.base_ft);
    tileBuildings.features.push({
      type: "Feature", id,
      geometry: f.geometry,
      properties: { ...props, heightM: hM, baseM: baseFt ? +(baseFt * 0.3048).toFixed(1) : 0 },
    });
  }
}
console.log(`${tiered} old towers got setback massing, ${podiums} modern towers got podiums.`);

// the two big payloads ship gzipped; the app inflates via DecompressionStream
writeFileSync(join(PUB, "parcels.json.gz"), gzipSync(JSON.stringify(table), { level: 9 }));
writeFileSync(join(PUB, "adjacency.json.gz"), gzipSync(JSON.stringify(adjacency), { level: 9 }));
for (const f of ["parcels.json", "adjacency.json"]) rmSync(join(PUB, f), { force: true });
writeFileSync(join(PUB, "stations.json"), JSON.stringify(stationPts.map((s) => ({ name: s.name, lines: s.lines, ll: s.ll }))));
if (existsSync(join(RAW, "context.geojson")))
  writeFileSync(join(PUB, "context.geojson"), readFileSync(join(RAW, "context.geojson")));
writeFileSync(join(PUB, "manifest.json"), JSON.stringify({
  ...manifest,
  lots: lots.length,
  adjacencyEdges: edgeCount,
  processed: true,
}, null, 2));
writeFileSync(join(OUT, "parcels.geojson"), JSON.stringify(tileParcels));
writeFileSync(join(OUT, "buildings.geojson"), JSON.stringify(tileBuildings));

// compact mesh feed for the 3D building renderer (same volumes as the tiles)
const b3d = [];
for (const f of tileBuildings.features) {
  if (f.geometry.type !== "Polygon") continue;
  const p = f.properties;
  const ring = f.geometry.coordinates[0].slice(0, -1).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
  if (ring.length < 3) continue;
  const rec = p.bbl ? table[p.bbl] : null;
  b3d.push({
    b: p.bbl,
    c: p.class,
    y: p.year,
    t: p.tone,
    f: rec?.floors ?? 0,
    z0: p.baseM,
    z1: p.heightM,
    d: p.bbl ? 0 : 1, // decorative (ships, cranes, sheds)
    r: ring,
  });
}
writeFileSync(join(PUB, "buildings3d.json.gz"), gzipSync(JSON.stringify(b3d), { level: 9 }));
console.log(`buildings3d.json.gz: ${b3d.length} volumes for the mesh renderer`);

const avgNbrs = lots.length ? (2 * edgeCount / lots.length).toFixed(1) : 0;
console.log(`Processed ${lots.length} lots (${Object.keys(adjacency).length} with neighbors, ${edgeCount} edges, avg ${avgNbrs}/lot), ${tileBuildings.features.length} buildings (${missingH} heights imputed).`);
console.log(`Wrote ${PUB}/{parcels,adjacency,stations,manifest}.json and ${OUT}/{parcels,buildings}.geojson`);
