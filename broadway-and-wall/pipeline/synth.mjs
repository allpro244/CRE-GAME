// Deterministic SYNTHETIC dev dataset for Lower Manhattan (CD1 stand-in).
// Emits the same raw-file schema as fetch.mjs (MapPLUTO / Footprints field
// names) so process.mjs and tiles.mjs consume either source unchanged.
//
// This exists because build environments don't always reach NYC Open Data.
// It is NOT real PLUTO data: the coastline outline is real-ish, everything
// inside it is procedurally generated with a fixed seed. The manifest marks
// it `source: "synthetic"` and the app badges it in the top bar.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mulberry32, makeProjection, polygonArea, centroid, bboxOfRing,
  splitRing, insetRing,
} from "./lib/geom.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
mkdirSync(RAW, { recursive: true });

const SEED = 10007;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

// Approximate Lower Manhattan shoreline south of Chambers St (lon, lat).
const COAST = [
  [-74.0125, 40.7158], // West St @ Chambers
  [-74.0140, 40.7135],
  [-74.0158, 40.7118], // Battery Park City esplanade
  [-74.0171, 40.7095],
  [-74.0184, 40.7065],
  [-74.0176, 40.7035],
  [-74.0158, 40.7010], // The Battery
  [-74.0130, 40.7000],
  [-74.0100, 40.7002], // South Ferry
  [-74.0060, 40.7008],
  [-74.0028, 40.7022], // Old Slip
  [-74.0000, 40.7048],
  [-73.9982, 40.7075], // South Street Seaport
  [-73.9977, 40.7098],
  [-73.9992, 40.7118], // Brooklyn Bridge
  [-74.0015, 40.7128],
  [-74.0040, 40.7138], // Park Row toward City Hall
  [-74.0080, 40.7148],
  [-74.0105, 40.7154], // Chambers St back to West St
];

const CENTER = [-74.0085, 40.7075];
const proj = makeProjection(CENTER[0], CENTER[1]);
const landRing = COAST.map(proj.toXY);

// Activity cores that shape height, class, and value distributions.
const CORE_WALL = proj.toXY([-74.0106, 40.7064]); // Wall & Broad
const CORE_WTC = proj.toXY([-74.0122, 40.7118]);  // WTC / Fulton
const CORE_SEAPORT = proj.toXY([-73.9995, 40.7068]);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const coreHeat = (p) => {
  const g = (c, r) => Math.exp(-(dist(p, c) ** 2) / (2 * r * r));
  return Math.min(1, g(CORE_WALL, 420) * 1.0 + g(CORE_WTC, 380) * 0.85 + g(CORE_SEAPORT, 300) * 0.35);
};

// --- recursive subdivision -------------------------------------------------
function subdivide(ring, targetArea, jitterDeg, out) {
  const area = polygonArea([ring]);
  if (area <= targetArea() || area < 900) { out.push(ring); return; }
  const [minX, minY, maxX, maxY] = bboxOfRing(ring);
  const wide = maxX - minX >= maxY - minY;
  // cut roughly perpendicular to the long axis, jittered in angle & position
  const baseAngle = wide ? Math.PI / 2 : 0;
  const angle = baseAngle + ((rr(-jitterDeg, jitterDeg) * Math.PI) / 180);
  const t = rr(0.42, 0.58);
  const p = wide
    ? [minX + (maxX - minX) * t, (minY + maxY) / 2]
    : [(minX + maxX) / 2, minY + (maxY - minY) * t];
  const [a, b] = splitRing(ring, p, Math.cos(angle), Math.sin(angle));
  if (!a || !b) { out.push(ring); return; }
  subdivide(a, targetArea, jitterDeg, out);
  subdivide(b, targetArea, jitterDeg, out);
}

// blocks: irregular, FiDi-scale (~4,000–11,000 m²)
const blocks = [];
subdivide(landRing, () => rr(4200, 11500), 16, blocks);

const STREETS = [
  "Wall St", "Broad St", "Broadway", "Water St", "Pearl St", "Beaver St",
  "Stone St", "Maiden Ln", "John St", "Fulton St", "Nassau St", "William St",
  "Pine St", "Cedar St", "Liberty St", "Greenwich St", "Trinity Pl",
  "Exchange Pl", "Rector St", "Whitehall St", "State St", "Front St",
  "South St", "Gold St", "Cliff St", "Beekman St", "Ann St", "Park Row",
  "Church St", "Vesey St", "Barclay St", "Murray St", "Warren St", "Chambers St",
  "Washington St", "West St", "Hanover Sq", "Coenties Slip", "Bridge St",
];

function zoningFor(heat, p) {
  const west = p[0] < proj.toXY([-74.0145, 40.708])[0];
  if (west) return { z: "BPC", commfar: 10, resfar: 10 };
  if (heat > 0.72) return { z: "C5-5", commfar: 15, resfar: 10 };
  if (heat > 0.5) return { z: "C6-9", commfar: 15, resfar: 12 };
  if (heat > 0.3) return { z: "C6-4", commfar: 10, resfar: 10 };
  return { z: "C6-2A", commfar: 6, resfar: 6.02 };
}

function classFor(heat) {
  const r = rand();
  if (r < 0.035) return "V1";            // vacant lot
  if (r < 0.055) return "G1";            // parking garage
  if (heat > 0.55) {
    if (r < 0.62) return "O4";           // office
    if (r < 0.72) return "RM";           // mixed
    if (r < 0.82) return "D0";           // multifamily (conversions)
    if (r < 0.90) return "K2";           // retail
    return "O3";
  }
  if (r < 0.30) return "O4";
  if (r < 0.50) return "D0";
  if (r < 0.68) return "RM";
  if (r < 0.85) return "K2";
  return "S1";                            // store + residence (mixed)
}

function yearFor() {
  const r = rand();
  if (r < 0.58) return Math.round(rr(1885, 1935));
  if (r < 0.85) return Math.round(rr(1955, 1992));
  return Math.round(rr(2000, 2024));
}

const parcels = { type: "FeatureCollection", features: [] };
const buildings = { type: "FeatureCollection", features: [] };
let blockNo = 1, binNo = 1000001;

for (const blockRaw of blocks) {
  const street = insetRing(blockRaw, 7); // ~14 m street gaps between blocks
  if (!street || polygonArea([street]) < 700) continue;
  const bc = centroid(street);
  const heat = coreHeat(bc);
  const blockStreet = pick(STREETS);
  let houseNo = Math.round(rr(1, 60));

  // a few blocks stay one full-block lot (tower plates); rest subdivide
  const lots = [];
  if (rand() < 0.07) lots.push(street);
  else subdivide(street, () => rr(320, 1350), 10, lots);

  let lotNo = 1;
  for (const lotRing of lots) {
    const areaM2 = polygonArea([lotRing]);
    if (areaM2 < 90) continue; // sliver guard
    const lotArea = Math.round(areaM2 * 10.7639); // sf
    const c = centroid(lotRing);
    const h = coreHeat(c);
    const zone = zoningFor(h, c);
    const cls = classFor(h);
    const vacant = cls === "V1";
    const bbl = 1000000000 + blockNo * 10000 + lotNo; // borough 1 + block + lot

    // massing: prob of a tower rises with heat and lot size; pre-1961
    // buildings ignore the FAR clamp (grandfathered overbuilt stock — the
    // teardown-vs-keep tension FiDi is famous for)
    const yearbuilt = vacant ? 0 : yearFor();
    let floors = 0, bldgArea = 0, footprint = null, heightM = 0;
    if (!vacant) {
      const towerP = Math.min(0.8, h * h * 1.1 + (areaM2 > 1600 ? 0.18 : 0));
      let coverage;
      if (areaM2 > 220 && rand() < towerP) {
        floors = Math.round(rr(24, 66));
        coverage = rr(0.5, 0.72);
      } else if (rand() < 0.55 + h * 0.3) {
        floors = Math.round(rr(8, 24));
        coverage = rr(0.72, 0.9);
      } else {
        floors = Math.round(rr(3, 8));
        coverage = rr(0.8, 0.95);
      }
      if (cls === "G1") floors = Math.min(floors, 6);
      if (cls === "K2") floors = Math.min(floors, 4);
      if (yearbuilt >= 1961) {
        floors = Math.min(floors, Math.max(2, Math.round(zone.commfar / coverage)));
      }
      const side = Math.sqrt(areaM2);
      footprint = insetRing(lotRing, (side * (1 - Math.sqrt(coverage))) / 2);
      const realCov = footprint ? polygonArea([footprint]) / areaM2 : coverage;
      bldgArea = Math.round(lotArea * realCov * floors);
      heightM = floors * 3.55 + rr(1, 5);
    }
    const landPsfBase = 180 + 620 * h;
    const assessland = Math.round(lotArea * landPsfBase * rr(0.85, 1.15) * 0.45);
    const bldgPsf = cls[0] === "O" ? rr(220, 420) : cls[0] === "D" ? rr(180, 330) : rr(120, 260);
    const assesstot = assessland + Math.round(bldgArea * bldgPsf * 0.45);
    const unitsres = cls[0] === "D" || cls === "S1" || cls === "RM"
      ? Math.max(1, Math.round((bldgArea * (cls === "D0" ? 0.9 : 0.45)) / 900)) : 0;

    parcels.features.push({
      type: "Feature",
      id: bbl,
      geometry: { type: "Polygon", coordinates: [[...lotRing.map(proj.toLL), proj.toLL(lotRing[0])]] },
      properties: {
        bbl: String(bbl),
        borough: "MN", block: String(blockNo), lot: String(lotNo),
        address: `${houseNo} ${blockStreet}`,
        zonedist1: zone.z, commfar: zone.commfar, resfar: zone.resfar,
        bldgclass: cls, landuse: vacant ? "11" : cls === "G1" ? "10" : cls[0] === "O" ? "05" : "04",
        lotarea: lotArea, bldgarea: bldgArea, numfloors: floors,
        yearbuilt, assessland, assesstot, unitsres,
        cd: "101",
      },
    });

    if (!vacant && footprint) {
      buildings.features.push({
        type: "Feature",
        id: binNo,
        geometry: { type: "Polygon", coordinates: [[...footprint.map(proj.toLL), proj.toLL(footprint[0])]] },
        properties: {
          bin: String(binNo++),
          base_bbl: String(bbl),
          heightroof: +(heightM * 3.28084).toFixed(1), // real dataset is feet
          cnstrct_yr: yearbuilt,
          groundelev: Math.round(rr(5, 40)),
        },
      });
    }
    houseNo += Math.round(rr(2, 8));
    lotNo++;
  }
  blockNo++;
}

// Subway stations in/near CD1 — approximate real locations; weight ~ relative ridership.
const STATIONS = [
  { name: "Fulton St", lines: "2 3 4 5 A C J Z", ll: [-74.0080, 40.7098], weight: 100 },
  { name: "Wall St", lines: "4 5", ll: [-74.0119, 40.7073], weight: 55 },
  { name: "Wall St", lines: "2 3", ll: [-74.0067, 40.7069], weight: 45 },
  { name: "Broad St", lines: "J Z", ll: [-74.0111, 40.7063], weight: 25 },
  { name: "Bowling Green", lines: "4 5", ll: [-74.0141, 40.7049], weight: 60 },
  { name: "South Ferry", lines: "1", ll: [-74.0134, 40.7017], weight: 40 },
  { name: "Whitehall St", lines: "R W", ll: [-74.0127, 40.7032], weight: 35 },
  { name: "Rector St", lines: "1", ll: [-74.0138, 40.7075], weight: 20 },
  { name: "Rector St", lines: "R W", ll: [-74.0132, 40.7085], weight: 18 },
  { name: "WTC Cortlandt", lines: "1", ll: [-74.0121, 40.7115], weight: 30 },
  { name: "World Trade Center", lines: "E", ll: [-74.0097, 40.7126], weight: 45 },
  { name: "Cortlandt St", lines: "R W", ll: [-74.0110, 40.7106], weight: 25 },
  { name: "Park Place", lines: "2 3", ll: [-74.0088, 40.7132], weight: 30 },
  { name: "City Hall", lines: "R W", ll: [-74.0072, 40.7134], weight: 22 },
  { name: "Brooklyn Bridge–City Hall", lines: "4 5 6", ll: [-74.0041, 40.7128], weight: 65 },
  { name: "Chambers St", lines: "1 2 3", ll: [-74.0093, 40.7150], weight: 50 },
  { name: "Chambers St", lines: "J Z", ll: [-74.0038, 40.7133], weight: 20 },
];
const stations = {
  type: "FeatureCollection",
  features: STATIONS.map((s, i) => ({
    type: "Feature", id: i + 1,
    geometry: { type: "Point", coordinates: s.ll },
    properties: { stop_name: s.name, daytime_routes: s.lines, weight: s.weight },
  })),
};

// Per-block workplace employment (jobs cluster where office space is).
const jobsByBlock = new Map();
for (const f of parcels.features) {
  const p = f.properties;
  const jobs = p.bldgclass[0] === "O" ? p.bldgarea / 230
    : p.bldgclass === "K2" ? p.bldgarea / 400
    : p.bldgclass === "RM" || p.bldgclass === "S1" ? p.bldgarea / 700 : 0;
  if (!jobs) continue;
  const key = p.block;
  const cur = jobsByBlock.get(key) ?? { jobs: 0, x: 0, y: 0, n: 0 };
  const ring = f.geometry.coordinates[0];
  const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length;
  const cy = ring.reduce((s, q) => s + q[1], 0) / ring.length;
  cur.jobs += jobs; cur.x += cx; cur.y += cy; cur.n++;
  jobsByBlock.set(key, cur);
}
const employment = {
  type: "FeatureCollection",
  features: [...jobsByBlock.values()].map((b, i) => ({
    type: "Feature", id: i + 1,
    geometry: { type: "Point", coordinates: [b.x / b.n, b.y / b.n] },
    properties: { jobs: Math.round(b.jobs) },
  })),
};

const context = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...COAST, COAST[0]]] },
    properties: { kind: "land" },
  }],
};

writeFileSync(join(RAW, "parcels.geojson"), JSON.stringify(parcels));
writeFileSync(join(RAW, "buildings.geojson"), JSON.stringify(buildings));
writeFileSync(join(RAW, "stations.geojson"), JSON.stringify(stations));
writeFileSync(join(RAW, "employment.geojson"), JSON.stringify(employment));
writeFileSync(join(RAW, "context.geojson"), JSON.stringify(context));
writeFileSync(join(RAW, "manifest.json"), JSON.stringify({
  source: "synthetic", district: "101", seed: SEED, lodes: true,
}, null, 2));

console.log(`Synthetic dev dataset: ${parcels.features.length} lots on ${blockNo - 1} blocks, ${buildings.features.length} buildings, ${stations.features.length} stations, ${employment.features.length} employment blocks.`);
