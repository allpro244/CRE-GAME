// PLAT QUALITY, MEASURED. The generator has harnesses for what a town HAS
// (parks, boulevards, coverage) and none for what a town LOOKS LIKE — which
// is how ten attempts at "the generations look weird" passed every check in
// the repo while changing nothing the eye cares about. These functions turn
// the five named pathologies into numbers a harness can print and a gallery
// can badge: sliver lots, confetti blocks, unprogrammed asphalt, ruler
// streams, missing core-to-fringe hierarchy.
//
// Pure readers over a GeneratedCity — no dice, no mutation, safe to call
// from any harness or renderer.
import { makeProjection, ringArea, centroid, longestEdgeAngle, extentAlong, cleanRing } from "../src/citygen/geom.mjs";

/**
 * A lot reads as a sliver when a surveyor would refuse to stake it: an
 * interior angle sharper than ~22 degrees, a width under 8 m (narrower than
 * the street it fronts), or an aspect past 6.5 (a strip, not a lot). The
 * thresholds are drawn from the same Manhattan-calibrated block maths the
 * generator itself documents (25x100 ft lots: width 7.6 m is the historic
 * MINIMUM, aspect 4) with slack so only the truly broken trip them.
 */
export const SLIVER = { minAngleDeg: 22, minWidthM: 8, maxAspect: 6.5 };
/** Sharper than this is a spike — the seam-wedge signature, counted apart. */
export const SPIKE_DEG = 15;

function interiorAngles(ring) {
  // ring closed (first == last) or open; normalize to open
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring;
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)));
    out.push((Math.acos(cos) * 180) / Math.PI);
  }
  return out;
}

/** Width/length via extents along and across the longest edge. */
function lotShape(ring) {
  const ang = longestEdgeAngle(ring);
  const along = extentAlong(ring, ang).span;
  const across = extentAlong(ring, ang + Math.PI / 2).span;
  const len = Math.max(along, across), wid = Math.max(1e-6, Math.min(along, across));
  return { len, wid, aspect: len / wid };
}

/**
 * Everything the plat harness and the gallery need for one generated city.
 * `city` is makeCity's return; all measurement happens in metres via the
 * island's own projection around the manifest core.
 */
export function measurePlat(city) {
  const [cx, cy] = city.manifest.core;
  const proj = makeProjection(cx, cy);
  const P = (pt) => proj.toXY(pt);

  const degenerate = [];
  const lots = [];
  for (const f of city.parcelFeatures.features) {
    const raw = f.geometry?.coordinates?.[0];
    if (!raw || raw.length < 4) { degenerate.push(`${f.properties?.bbl}: ring<4pts`); continue; }
    let ring = raw.map(P);
    for (const [x, y] of ring) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) { degenerate.push(`${f.properties?.bbl}: non-finite`); ring = null; break; }
    }
    if (!ring) continue;
    ring = cleanRing(ring);
    const area = Math.abs(ringArea(ring));
    if (!(area > 0)) { degenerate.push(`${f.properties?.bbl}: area<=0`); continue; }
    const rec = city.parcels[f.properties.bbl];
    const angles = interiorAngles(ring);
    const minAngle = angles.length ? Math.min(...angles) : 90;
    const { wid, aspect } = lotShape(ring);
    lots.push({
      bbl: f.properties.bbl, ring, area, minAngle, wid, aspect,
      district: rec?.district ?? "?",
      block: rec?.block ?? -1,
      floors: rec?.floors ?? 0,
      cls: rec?.class ?? f.properties.class ?? "?",
      centroid: centroid(ring),
      sliver: minAngle < SLIVER.minAngleDeg || wid < SLIVER.minWidthM || aspect > SLIVER.maxAspect,
      spike: minAngle < SPIKE_DEG,
    });
  }

  // Confetti: a block shattered into scraps. Three-plus lots under 120 sq m
  // in one block is subdivision debris, not a fine grain — a real burgage
  // lot bottoms out near 190 sq m (7.6 x 25 m).
  const byBlock = new Map();
  for (const l of lots) {
    if (!byBlock.has(l.block)) byBlock.set(l.block, []);
    byBlock.get(l.block).push(l);
  }
  let confettiBlocks = 0;
  for (const [, ls] of byBlock) {
    if (ls.filter((l) => l.area < 120).length >= 3) confettiBlocks++;
  }

  // Paved ground with no programme: APRONS only. `paveland` is the base
  // sheet under the whole island — counting it measured the island and the
  // first run of this harness printed 100%, which is the exact fake-metric
  // trap CLAUDE.md warns about (a number that cannot move measures nothing).
  // The largest single void is the number that matches the eye — one
  // 20,000 sq m grey wedge reads worse than forty small aprons.
  const landF = city.context.features.find((f) => f.properties?.kind === "land" && f.geometry?.type === "Polygon");
  const landArea = landF ? Math.abs(ringArea(landF.geometry.coordinates[0].map(P))) : 1;
  let pavedVoid = 0, largestVoid = 0;
  // Street share: pavement ground against block ground. A real city runs
  // 0.35-0.45 pavement-to-block; the stripe-fan districts in the Tarrworth
  // screenshot measured 1.55 — more street than city, which is exactly what
  // the eye called "shattered". This is THE number for that disease.
  let pavementA = 0, blockA = 0;
  for (const f of city.context.features) {
    if (f.geometry?.type !== "Polygon") continue;
    const k = f.properties?.kind;
    const a = Math.abs(ringArea(f.geometry.coordinates[0].map(P)));
    // A median is programmed ground, not a void — it counts as city, not road.
    if (k === "median") blockA += a;
    else if (k === "pavement") pavementA += a;
    else if (k === "block") blockA += a;
    else if (k === "apron") { pavedVoid += a; if (a > largestVoid) largestVoid = a; }
  }
  const streetShare = blockA > 0 ? +(pavementA / blockA).toFixed(2) : null;

  // Streams: a brook meanders; a ruler does not. For each named water body,
  // fit the principal axis of its polygon points; meander = cross-axis
  // spread over length. A dead-straight canal scores about its own
  // width/length; anything that visibly bends scores several times that.
  const streams = new Map();
  for (const f of city.context.features) {
    if (f.properties?.kind !== "stream" || f.geometry?.type !== "Polygon") continue;
    const nm = f.properties.name ?? "stream";
    if (!streams.has(nm)) streams.set(nm, []);
    for (const pt of f.geometry.coordinates[0]) streams.get(nm).push(P(pt));
  }
  const streamStats = [];
  for (const [name, pts] of streams) {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const len = 4 * Math.sqrt(l1 / pts.length) || 1; // ~major extent
    const spread = 4 * Math.sqrt(Math.max(0, l2) / pts.length);
    streamStats.push({ name, lengthM: Math.round(len), meander: +(spread / len).toFixed(3) });
  }

  // Orientation coherence per district: fold lot bearings mod 90 deg and
  // take the circular variance. Low inside a district is a surveyed grid;
  // high is either deliberate organic fabric or seam chaos — the gallery
  // tells those apart, the number just flags where to look.
  const byDistrict = new Map();
  for (const l of lots) {
    if (!byDistrict.has(l.district)) byDistrict.set(l.district, []);
    byDistrict.get(l.district).push(longestEdgeAngle(l.ring));
  }
  const districtOrient = [];
  for (const [d, angs] of byDistrict) {
    if (angs.length < 6) continue;
    let c = 0, s = 0;
    for (const a of angs) { c += Math.cos(4 * a); s += Math.sin(4 * a); } // mod 90 deg
    const R = Math.hypot(c, s) / angs.length;
    districtOrient.push({ district: d, variance: +(1 - R).toFixed(3), n: angs.length });
  }
  districtOrient.sort((a, b) => b.variance - a.variance);

  // Hierarchy: does downtown exist statistically? Mean floors in the inner
  // quarter of the island radius against the outer quarter.
  const dists = lots.map((l) => Math.hypot(l.centroid[0], l.centroid[1])).sort((a, b) => a - b);
  const rMax = dists[dists.length - 1] || 1;
  let innerF = 0, innerN = 0, outerF = 0, outerN = 0;
  for (const l of lots) {
    const r = Math.hypot(l.centroid[0], l.centroid[1]) / rMax;
    if (r < 0.25 && l.floors > 0) { innerF += l.floors; innerN++; }
    if (r > 0.75 && l.floors > 0) { outerF += l.floors; outerN++; }
  }
  const gradient = innerN && outerN ? +((innerF / innerN) / (outerF / outerN)).toFixed(2) : null;

  const slivers = lots.filter((l) => l.sliver);
  const spikes = lots.filter((l) => l.spike);
  return {
    seed: city.seed, name: city.manifest.city, lots: lots.length,
    sliverPct: +((100 * slivers.length) / Math.max(1, lots.length)).toFixed(1),
    spikePct: +((100 * spikes.length) / Math.max(1, lots.length)).toFixed(1),
    confettiBlocks,
    blocks: byBlock.size,
    pavedVoidPct: +((100 * pavedVoid) / landArea).toFixed(1),
    largestVoidM2: Math.round(largestVoid),
    streetShare,
    streams: streamStats,
    worstOrient: districtOrient[0] ?? null,
    medianOrient: districtOrient.length ? districtOrient[Math.floor(districtOrient.length / 2)].variance : null,
    gradient,
    degenerate,
    _lots: lots, // for the renderer; underscore = not part of the report
  };
}
