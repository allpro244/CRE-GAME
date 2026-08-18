/**
 * Street paint must not smear toward the creek, or across a park.
 *
 * A boulevard tagged `cls: "shore"` got the shore-road stroke, sidewalk,
 * dashes and a row of parked cars along a kilometre chord. Park rings tagged
 * `kind: "street"` did the same around every green. Paveland as one island
 * polygon triangulated across the river wherever a bank cell was missing.
 * A seam that still landed on a common painted a carriageway through the
 * lawn; leftover pavement sits above the park fill unless the green is a
 * hole and the dashes walk the edge the way water already does.
 *
 *   pnpm streetpaint
 */
import { makeCity, PROCEDURAL } from "../src/citygen/index.mjs";

function makeProjection(lon0, lat0) {
  const R = 6378137;
  const toRad = Math.PI / 180;
  const cos = Math.cos(lat0 * toRad);
  return {
    toM: ([lon, lat]) => [(lon - lon0) * toRad * R * cos, (lat - lat0) * toRad * R],
  };
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const inter = ((yi > p[1]) !== (yj > p[1]))
      && (p[0] < (xj - xi) * (p[1] - yi) / ((yj - yi) || 1e-15) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

function ringOf(f) {
  const g = f.geometry;
  if (g.type === "Polygon") return g.coordinates[0].slice(0, -1);
  if (g.type === "LineString") return g.coordinates;
  return null;
}

function segLen(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

const cases = [
  { seed: 1, size: "harbour" },
  { seed: 42, size: "harbour" },
  { seed: 3178393255, size: "harbour" },
  { seed: 3533229586, size: "harbour" },
  { seed: 3252, size: "harbour" },
  // Default play size: seams can still land on a green after `fits`.
  { seed: 3252, size: "city" },
  { seed: 4604, size: "city" },
];
let failed = 0;

for (const { seed, size } of cases) {
  const city = makeCity(PROCEDURAL, seed, { size });
  const core = city.manifest?.core ?? city.manifest?.bbox;
  const lon0 = Array.isArray(core) && core.length === 2 ? core[0] : (city.manifest.bbox[0] + city.manifest.bbox[2]) / 2;
  const lat0 = Array.isArray(core) && core.length === 2 ? core[1] : (city.manifest.bbox[1] + city.manifest.bbox[3]) / 2;
  const proj = makeProjection(lon0, lat0);
  const feats = city.context.features;

  const streams = feats
    .filter((f) => f.properties?.kind === "stream")
    .map(ringOf)
    .filter(Boolean)
    .map((r) => r.map(proj.toM));
  const channels = feats
    .filter((f) => f.properties?.kind === "stream" && f.properties?.water !== "pond")
    .map(ringOf)
    .filter(Boolean)
    .map((r) => r.map(proj.toM));

  const streets = feats.filter((f) => f.properties?.kind === "street" && f.geometry.type === "LineString");
  const parkStreet = streets.filter((f) => f.properties?.cls === "park").length;
  const shore = streets.filter((f) => f.properties?.cls === "shore");
  const fakeShore = shore.filter((f) => {
    const r = ringOf(f).map(proj.toM);
    if (r.length !== 2) return false;
    return segLen(r[0], r[1]) > 200;
  });

  const parksPaint = feats
    .filter((f) => f.properties?.kind === "park" && f.geometry?.type === "Polygon")
    .map(ringOf)
    .filter(Boolean)
    .map((r) => r.map(proj.toM));

  let wetDash = 0, wetSidewalk = 0, parkDash = 0, parkSidewalk = 0, parkSeam = 0;
  for (const f of feats) {
    if (f.geometry?.type !== "LineString") continue;
    const r = ringOf(f)?.map(proj.toM);
    if (!r || r.length < 2) continue;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      const len = segLen(a, b);
      if (len < 12) continue;
      const steps = Math.max(2, Math.ceil(len / 8));
      let wet = 0, inGreen = 0;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (streams.some((s) => inRing(p, s))) wet++;
        if (parksPaint.some((pk) => inRing(p, pk))) inGreen++;
      }
      if (wet > steps * 0.35) {
        if (f.properties?.kind === "centerline") wetDash++;
        if (f.properties?.kind === "street" && (f.properties?.cls === "grid" || f.properties?.cls === "lane")) wetSidewalk++;
      }
      if (inGreen > steps * 0.35) {
        if (f.properties?.kind === "centerline") parkDash++;
        if (f.properties?.kind === "street" && (f.properties?.cls === "grid" || f.properties?.cls === "lane")) parkSidewalk++;
        if (f.properties?.kind === "street" && (f.properties?.cls === "seam" || f.properties?.cls === "boulevard")) parkSeam++;
      }
    }
  }

  let paveInPark = 0;
  for (const f of feats.filter((x) => x.properties?.kind === "pavement" && x.geometry?.type === "Polygon")) {
    const coords = f.geometry.coordinates ?? [];
    const outer = (coords[0] ?? []).slice(0, -1).map(proj.toM);
    if (outer.length < 3) continue;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of outer) {
      minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
      maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]);
    }
    let deep = 0;
    for (let x = minx + 6; x < maxx; x += 16) {
      for (let y = miny + 6; y < maxy; y += 16) {
        const p = [x, y];
        if (!inRing(p, outer)) continue;
        let inHole = false;
        for (let h = 1; h < coords.length; h++) {
          if (inRing(p, coords[h].slice(0, -1).map(proj.toM))) { inHole = true; break; }
        }
        if (inHole) continue;
        if (parksPaint.some((pk) => inRing(p, pk))) {
          // ignore the kerb-width fringe; the fault is asphalt in the lawn
          let edge = Infinity;
          for (const pk of parksPaint) {
            for (let i = 0; i < pk.length; i++) {
              const a = pk[i], b = pk[(i + 1) % pk.length];
              const dx = b[0] - a[0], dy = b[1] - a[1];
              const l2 = dx * dx + dy * dy;
              let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
              t = Math.max(0, Math.min(1, t));
              edge = Math.min(edge, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
            }
          }
          if (edge >= 8) deep++;
        }
      }
    }
    if (deep > 2) paveInPark++;
  }

  const paveland = feats.find((f) => f.properties?.kind === "paveland");
  const nHoles = paveland?.geometry?.coordinates?.length > 1 ? paveland.geometry.coordinates.length - 1 : 0;
  const nPaintedWater = feats.filter((f) => f.properties?.kind === "stream").length;
  const missingHoles = nPaintedWater > 0 && nHoles < 1;

  const parks = feats.filter((f) => f.properties?.kind === "park" && f.geometry?.type === "Polygon");
  let parkNeedsHole = 0, parkHasHole = 0;
  for (const f of parks) {
    const outer = (f.geometry.coordinates[0] ?? []).slice(0, -1).map(proj.toM);
    const wet = channels.some((s) => s.some((p) => inRing(p, outer)) || outer.some((p) => channels.some((c) => inRing(p, c))));
    if (!wet) continue;
    parkNeedsHole++;
    if ((f.geometry.coordinates?.length ?? 0) > 1) parkHasHole++;
  }
  const aprons = feats.filter((f) => f.properties?.kind === "apron" && f.geometry?.type === "Polygon");
  let apronNeedsHole = 0, apronHasHole = 0;
  for (const f of aprons) {
    const outer = (f.geometry.coordinates[0] ?? []).slice(0, -1).map(proj.toM);
    const wet = channels.some((s) => outer.some((p) => inRing(p, s)));
    if (!wet) continue;
    apronNeedsHole++;
    if ((f.geometry.coordinates?.length ?? 0) > 1) apronHasHole++;
  }

  let wetKerb = 0;
  for (const f of feats.filter((x) => x.properties?.kind === "parkkerb" && x.geometry?.type === "LineString")) {
    const r = ringOf(f)?.map(proj.toM);
    if (!r || r.length < 2) continue;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      const len = segLen(a, b);
      if (len < 12) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (streams.some((s) => inRing(mid, s))) wetKerb++;
    }
  }

  let fatBridge = 0;
  for (const f of feats.filter((x) => x.properties?.kind === "bridge" && x.geometry?.type === "Polygon")) {
    const r = ringOf(f)?.map(proj.toM);
    if (!r || r.length < 4) continue;
    const edges = [];
    for (let i = 0; i < r.length; i++) edges.push(segLen(r[i], r[(i + 1) % r.length]));
    edges.sort((a, b) => a - b);
    if (edges[0] > 16) fatBridge++;
  }

  const problems = [];
  if (parkStreet) problems.push(`park rings tagged street (${parkStreet})`);
  if (fakeShore.length) problems.push(`${fakeShore.length} kilometre-chord(s) tagged shore`);
  if (wetDash) problems.push(`${wetDash} centreline(s) run through water`);
  if (wetSidewalk) problems.push(`${wetSidewalk} sidewalk(s) run through water`);
  if (parkDash) problems.push(`${parkDash} centreline(s) run through a park`);
  if (parkSidewalk) problems.push(`${parkSidewalk} sidewalk(s) run through a park`);
  if (parkSeam) problems.push(`${parkSeam} seam/boulevard(s) run through a park`);
  if (paveInPark) problems.push(`${paveInPark} pavement fill(s) cover a park`);
  if (missingHoles) problems.push(`paveland has no water holes (${nHoles} holes, ${nPaintedWater} streams)`);
  if (parkNeedsHole && parkHasHole < parkNeedsHole) {
    problems.push(`park over water missing holes (${parkHasHole}/${parkNeedsHole})`);
  }
  if (apronNeedsHole && apronHasHole < apronNeedsHole) {
    problems.push(`apron over water missing holes (${apronHasHole}/${apronNeedsHole})`);
  }
  if (wetKerb) problems.push(`${wetKerb} park kerb(s) run through water`);
  if (fatBridge) problems.push(`${fatBridge} bridge(s) thicker than a street`);

  const ok = problems.length === 0;
  console.log(
    `${ok ? "OK" : "FAIL"} seed ${seed} ${size}: shore-lines ${shore.length} `
    + `paveland-holes ${nHoles}/${nPaintedWater} `
    + (ok ? "" : problems.join("; ")),
  );
  if (!ok) failed++;
}

if (failed) {
  console.error(`\nstreet-paint: ${failed} seed(s) failed`);
  process.exit(1);
}
console.log("\nstreet-paint: all seeds clean");
