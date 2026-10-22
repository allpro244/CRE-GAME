// A SUBDIVISION, PLATTED.
//
// One neighbourhood parcel stands for a whole subdivision (owner's Phase 1
// decision). Its streets, lots and houses are drawn from a RECIPE — the region
// seed, the tract, the era — so the same plat comes back on every rebuild,
// and a later phase can UNPACK the parcel into its individual lots by calling
// platFor() with the record's recipe and keeping the lots its `built` bitset
// names.
//
// The owner's note on the first renders: "the uniformity of the grid is weird
// looking". So no two plats are cut alike, and none is one stamped pattern:
//   - each plat takes its own bearing — square to the survey, or turned to the
//     old road it was platted along — and its own block length and lot width;
//   - lot widths vary lot to lot inside a block, and only some plats have
//     alleys;
//   - pre-war plats are grids with uneven blocks and a jog where a cross street
//     was platted off-line; post-war plats are curving streets of differing
//     sweep closed into loops; 1980s+ plats are a winding collector with
//     cul-de-sacs of differing length and angle.
//
// Sizes [S]: pre-war lot 30-50 x 100-130 ft on 400-700 ft blocks with a 16 ft
// alley where there is one (streetcar suburbs); post-war 60-80 x 105-125 ft
// (Levittown 60 x 100; 1950s tracts 6-10k sf); recent 65-80 x 110-130 ft
// (Census SOC median new lot ~8-9k sf in the 2010s); local ROW 50-60 ft;
// cul-de-sacs at most 600 ft with a 45 ft bulb; stormwater pond 3-5% of the
// tract. House footprints 7 x 11 m pre-war, 9 x 13 m later, set back ~7 m.
import { makeRng, FT, add, sub, mul, dist, norm, perp, dot, lerp, resample, cumLen, pointAt } from "./util.mjs";

export const PLAT_GEN = "region-plat/1";
export const ERA_YEARS = { prewar: [1905, 1939], postwar: [1946, 1975], recent: [1985, 2020] };
// [S, approximate] two-storey share: pre-war foursquares and bungalows mixed, post-war mostly ranches, recent mostly two
export const TWO_STOREY = { prewar: 0.6, postwar: 0.25, recent: 0.7 };
const HOUSE = { prewar: [7, 11], postwar: [9, 13], recent: [10, 14], grid: [9, 13] };

/**
 * The plat for a recipe: { seed, tract: [x0,y0,x1,y1] (canonical m), era, id, bearing? }.
 * Returns streets (polylines), bulbs, ponds and lots in a stable order; each lot carries its ring and its house.
 * `ok(p)` says where building may stand (dry, unflooded, not the freeway, not the town).
 */
export function platFor(recipe, ok = () => true) {
  const { seed, tract, era, id } = recipe;
  const rng = makeRng(`plat:${id}:${era}:${seed}`);
  const [x0, y0, x1, y1] = tract;
  const inset = 66 * FT / 2 + 4;          // half a section-line road's ROW, and a verge
  // (the land developer's grid gives up land only where a road runs along the tract's side: recipe.insets)
  const ins = era === "grid" && recipe.insets ? recipe.insets : [inset, inset, inset, inset];
  const X0 = x0 + ins[0], Y0 = y0 + ins[1], X1 = x1 - ins[2], Y1 = y1 - ins[3];
  const C = [(X0 + X1) / 2, (Y0 + Y1) / 2];
  // the plat's own frame: u along its streets, v across. Square to the survey, or turned to its road.
  // (the land developer's grid runs along the tract's long side: a grid turned inside a rectangle wastes its corners)
  const deg = era === "grid" ? (X1 - X0 >= Y1 - Y0 ? 0 : 90) : recipe.bearing ?? (rng() < 0.5 ? 0 : 90) + rng.range(-3, 3);
  const t = (deg * Math.PI) / 180, u = [Math.cos(t), Math.sin(t)], v = perp(u);
  const half = (Math.abs(dot([X1 - X0, 0], u)) + Math.abs(dot([0, Y1 - Y0], u))) / 2;   // reach of the tract along u
  const halfV = (Math.abs(dot([X1 - X0, 0], v)) + Math.abs(dot([0, Y1 - Y0], v))) / 2;
  const P = (a, b) => add(C, add(mul(u, a), mul(v, b)));
  const inTract = (p) => p[0] >= X0 && p[0] <= X1 && p[1] >= Y0 && p[1] <= Y1;
  const streets = [], bulbs = [], ponds = [], lots = [];
  const ROW = rng.range(50, 60) * FT;
  const [hw0, hd0] = HOUSE[era];
  // LOTS GROW WITH DISTANCE (owner): `scale` is the lot area against the era's own norm, set from how far
  // out the plat lies (outer.mjs); frontage takes most of it, depth the rest.
  const SC = recipe.scale ?? 1, FS = SC ** 0.6, DS = SC ** 0.4;

  // stormwater detention in the corner nearest the water (recent plats; post-war often had none) [S]
  if (era === "recent" || (era === "postwar" && rng() < 0.3)) {
    const corners = [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]];
    const near = corners.map((c) => ({ c, d: recipe.waterNear ? dist(c, recipe.waterNear) : rng() })).sort((a, b) => a.d - b.d)[0].c;
    const r = Math.sqrt(rng.range(0.03, 0.05) * (X1 - X0) * (Y1 - Y0) / Math.PI);
    ponds.push({ c: lerp(near, C, (r + 25) / Math.max(1, dist(near, C))), r });
  }
  const clearOfPonds = (p) => !ponds.some((q) => dist(p, q.c) < q.r + 8);
  const good = (p) => inTract(p) && clearOfPonds(p) && ok(p);

  /** Lots both sides of a street polyline, frontage jittered lot to lot, skipping gaps (cross streets). */
  // `fit` (the land developer's grid): a lot that runs into ground it cannot use is shortened to fit, down
  // to 60% of its depth, rather than dropped; only a lot that cannot be fitted is skipped
  const lotsAlong = (pl, front, depth, sides, gapAt = [], fit = false) => {
    const L = cumLen(pl).at(-1);
    for (const sd of sides) {
      let s = fit ? 1 : front * 0.6;
      while (s + front * (fit ? 0.9 : 0.5) < L) {
        const w = front * (fit ? rng.range(0.98, 1.02) : rng.range(0.88, 1.14));
        const sm = s + w / 2;
        if (fit) {
          // a lot may not cross a cross street: restart just past it, losing only the street itself
          const g = gapAt.find((gg) => s < gg + ROW / 2 && s + w > gg - ROW / 2);
          if (g !== undefined) { s = g + ROW / 2 + 0.5; continue; }
        } else if (gapAt.some((g) => Math.abs(g - sm) < ROW / 2 + w / 2)) { s += w; continue; }
        const a = pointAt(pl, s), b = pointAt(pl, Math.min(L, s + w)), m = pointAt(pl, sm);
        const dir = norm(sub(b, a)), n = mul(perp(dir), sd);
        const f0 = add(a, mul(n, ROW / 2)), f1 = add(b, mul(n, ROW / 2));
        let ring = [f0, f1, add(f1, mul(n, depth)), add(f0, mul(n, depth))];
        s += w;
        if (fit && good(f0) && good(f1)) {
          ring = null;
          for (const k of [1, 0.85, 0.72, 0.6]) {
            const r = [f0, f1, add(f1, mul(n, depth * k)), add(f0, mul(n, depth * k))];
            if (r.every(good) && good(add(m, mul(n, ROW / 2 + depth * k * 0.5)))) { ring = r; break; }
          }
        }
        if (!ring || !ring.every(good) || !good(m)) continue;
        // the house: set back from the street, a little off-centre, its size varied
        const hw = Math.min(w * 0.75, hw0 * rng.range(0.9, 1.12)), hd = hd0 * rng.range(0.9, 1.12);
        const back = ROW / 2 + rng.range(5.5, 9) + hd / 2;
        const hc = add(add(m, mul(n, back)), mul(dir, (w - hw) * rng.range(-0.25, 0.25)));
        const two = rng() < TWO_STOREY[era];
        lots.push({ ring, front: [f0, f1], house: { c: hc, u: dir, w: hw, d: hd, storeys: two ? 2 : 1 } });
      }
    }
  };

  if (era === "grid") {
    // THE LAND DEVELOPER'S PLAT (landdev.ts): the player's lot size at 1:1.8, every street double-loaded, the
    // first and last rows backing onto the tract's edge (no street wasted along the boundary road), a cross
    // street every ~1,200 ft (the longest block suburban codes allow [S, 1,000-1,320 ft]). Rows stretch up
    // to a quarter to fill the tract's depth exactly.
    const lotM2 = (recipe.lotSf ?? 7500) * 0.09290304, d0 = Math.sqrt(lotM2 * 1.8), front = lotM2 / d0;
    const span = 2 * halfV, n = Math.max(1, Math.round((span - ROW) / (2 * d0 + ROW)));
    const depth = Math.max(d0 * 0.8, Math.min(d0 * 1.25, (span - n * ROW) / (2 * n)));
    const nc = Math.floor((2 * half) / (1200 * FT)), crossAt = [];
    for (let i = 1; i <= nc; i++) crossAt.push(-half + (i * 2 * half) / (nc + 1));
    for (let j = 0; j < n; j++) {
      const b = -halfV + depth + ROW / 2 + j * (2 * depth + ROW);
      const pl = [P(-half, b), P(half, b)];
      streets.push(pl);
      lotsAlong(pl, front, depth, [1, -1], crossAt.map((a) => a + half), true);
    }
    for (const a of crossAt) streets.push([P(a, -halfV + depth + ROW / 2), P(a, -halfV + depth + ROW / 2 + (n - 1) * (2 * depth + ROW))]);
  } else if (era === "prewar") {
    // ("grid": the land developer's plat, landdev.ts — the player's chosen lot size, 1:1.8, 600 ft blocks, no alley)
    const G = era === "grid", gFront = G ? Math.sqrt((recipe.lotSf ?? 7500) / 1.8) : 0;
    // a grid with uneven blocks: block length and lot width per plat, the odd jogged cross street, alleys in most
    const front = G ? gFront * FT : rng.range(30, 50) * FT * FS, depth = G ? gFront * 1.8 * FT : rng.range(100, 130) * FT * DS, alley = !G && rng() < 0.65 ? 16 * FT : 0;
    const blockLen = G ? 600 * FT : rng.range(400, 700) * FT, pitch = 2 * depth + alley + ROW;
    const n = Math.max(1, Math.round((2 * halfV) / pitch));
    const crossAt = []; // positions along u of the cross streets, shared by every street of the plat (a grid), each jogged a little
    for (let s = -half + rng.range(0.3, 0.7) * blockLen; s < half; s += blockLen * rng.range(0.8, 1.2)) crossAt.push(s);
    for (let j = 0; j <= n; j++) {
      const b = -halfV + (j * 2 * halfV) / n;
      const pl = [P(-half, b), P(half, b)];
      streets.push(pl);
      lotsAlong(pl, front, depth, j === 0 ? [1] : j === n ? [-1] : [1, -1], crossAt.map((a) => a + half));
    }
    for (const a of crossAt) {
      const jog = !G && rng() < 0.2 ? rng.range(-12, 12) : 0;   // platted off-line by a later owner
      streets.push([P(a, -halfV), P(a, 0), P(a + jog, 0.001), P(a + jog, halfV)]);
    }
  } else if (era === "postwar") {
    // curving streets of differing sweep closed into loops: a shared bend (the ground) plus each street's own
    const front = rng.range(60, 80) * FT * FS, depth = rng.range(105, 125) * FT * DS, pitch = 2 * depth + ROW;
    const n = Math.max(1, Math.round((2 * halfV) / pitch));
    const lam = 2 * half * rng.range(0.7, 1.4), ph = rng.range(0, 6.28), A = Math.min(45, pitch * 0.4) * rng.range(0.5, 1);
    const end = depth + 20;
    const lines = [];
    for (let j = 0; j < n; j++) {
      const b = -halfV + ((j + 0.5) * 2 * halfV) / n;
      const a2 = rng.range(-0.15, 0.15) * pitch, ph2 = rng.range(0, 6.28), lam2 = lam * rng.range(0.6, 1.2);
      const e0 = -half + end * rng.range(0.8, 1.6), e1 = half - end * rng.range(0.8, 1.6);
      const pl = [];
      for (let s = e0; s <= e1 + 1; s += 15) pl.push(P(s, b + A * Math.sin(2 * Math.PI * s / lam + ph) + a2 * Math.sin(2 * Math.PI * s / lam2 + ph2)));
      if (pl.length < 2) continue;
      lines.push(pl); streets.push(pl);
      lotsAlong(pl, front, depth, [1, -1]);
    }
    // close neighbouring streets into loops at alternating ends; one or two connectors out to the section roads
    for (let j = 0; j + 1 < lines.length; j++) {
      const at = j % 2 === 0 ? 0 : -1;
      streets.push([lines[j].at(at), lines[j + 1].at(at)]);
    }
    if (lines.length) {
      const m = lines[Math.floor(lines.length / 2)];
      streets.push([m[0], add(m[0], mul(u, -end * 2))], [m.at(-1), add(m.at(-1), mul(u, end * 2))]);
    }
  } else {
    // a winding collector with cul-de-sacs of differing length, angle and spacing; lots back onto the collector
    const front = rng.range(65, 80) * FT * FS, depth = rng.range(110, 130) * FT * DS;
    const nSpine = Math.max(1, Math.round((2 * halfV) / (2 * (600 * FT + 40))));
    for (let k = 0; k < nSpine; k++) {
      const b = -halfV + ((k + 0.5) * 2 * halfV) / nSpine;
      const amp = rng.range(15, 50), lam = 2 * half * rng.range(0.6, 1.3), ph = rng.range(0, 6.28);
      const spine = [];
      for (let s = -half; s <= half + 1; s += 15) spine.push(P(s, b + amp * Math.sin(2 * Math.PI * s / lam + ph) * Math.sin(Math.PI * (s + half) / (2 * half))));
      streets.push(spine);
      const room = halfV / nSpine - 10;
      let s = depth + rng.range(10, 40);
      const L = cumLen(spine).at(-1);
      let side = rng() < 0.5 ? 1 : -1;
      while (s < L - depth) {
        const base = pointAt(spine, s), dir = norm(sub(pointAt(spine, Math.min(L, s + 5)), pointAt(spine, Math.max(0, s - 5))));
        const len = Math.min(600 * FT, room - depth * 0.6) * rng.range(0.45, 1);
        if (len > 40) {
          const ang = rng.range(-0.4, 0.4), nn = mul(perp(dir), side);
          const d2 = norm(add(mul(nn, Math.cos(ang)), mul(dir, Math.sin(ang))));
          const bend = rng.range(-0.25, 0.25);
          const mid = add(base, mul(d2, len * 0.5)), tip = add(mid, mul(norm(add(d2, mul(perp(d2), bend))), len * 0.5));
          if (good(tip)) {
            const pl = resample([add(base, mul(d2, ROW / 2)), mid, tip], 10);
            streets.push([base, ...pl]); bulbs.push(tip);
            lotsAlong(pl, front, depth, [1, -1]);
          }
        }
        s += rng.range(70, 140); if (rng() < 0.7) side = -side;
      }
    }
  }
  return { streets, bulbs, ponds, lots, bulbR: 45 * FT, ROW, frame: { u, v, C } };
}

/** A lot set as a compact bitset string (base64url), so a record can say which of the plat's lots are built. */
export function packBits(n, isSet) {
  const bytes = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (isSet(i)) bytes[i >> 3] |= 1 << (i & 7);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unpackBits(str, n) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const s = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = [];
  for (let i = 0; i < n; i++) if ((s.charCodeAt(i >> 3) >> (i & 7)) & 1) out.push(i);
  return out;
}
