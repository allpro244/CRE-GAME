// THE LAND DEVELOPER'S PLAT, AS DESIGNED (the subdivision design desk).
//
// platFor (plats.mjs) draws the town's historic subdivisions and the plain
// grid the land developer's card used to file. This draws the plat the
// player lays out on the design desk: a street pattern, a lot-size mix, the
// pattern turned and slid over the tract, a detention pond, amenities set
// down from a palette, and lots merged, split or given over to open space.
// It is pure geometry from a recipe — the same recipe in, the same lots out,
// byte for byte — so the engine stores the recipe (types.ts PlatDesign) and
// the page, the map and Unreal redraw the same plat from it on every load.
//
// The economics are not here. A lot carries its distance to each amenity;
// what that distance is worth (the hedonic premium) and what an amenity costs
// are the engine's (engine/platdesign.ts).
//
// Sizes [S]: lots 50 x 100 ft (5,000 sf, the small-lot R-2 minimum), 65 x 115
// (7,500, the Census median new-house lot), 80 x 125 (10,000), 100 x 150
// (15,000, an estate lot); a local street 50 ft of right-of-way, a collector
// 66 ft (ITE / typical subdivision codes: local 50-60, collector 60-80); a
// grid block 660 ft (an eighth of a mile, the survey's own unit); cul-de-sacs
// at most 600 ft (the common fire-code and subdivision-code limit) with a
// 45 ft paved bulb in a 55 ft right-of-way radius.
//
// Coordinates are the region's canonical metres (frame.mjs: y down).
import { FT, add, sub, mul, dist, norm, perp, dot, cumLen, pointAt, resample, makeRng, ringAreaAbs, SQFT_PER_M2 } from "./util.mjs";

export const DESIGN_GEN = "region-plat-design/1";
export const DESIGN_LAYOUTS = ["grid", "loops", "culdesac"];
export const DESIGN_SIZES = [5000, 7500, 10000, 15000];
/** frontage x depth, ft, by nominal lot size [S, above] */
export const LOT_DIM_FT = { 5000: [50, 100], 7500: [65, 115], 10000: [80, 125], 15000: [100, 150] };
const ROW = { local: 50 * FT, collector: 66 * FT, court: 50 * FT };
/** The longest block a subdivision code allows between cross streets, about 1,200-1,320 ft [S, typical codes]. */
const BLOCK = 1200 * FT;
const CDS_MAX = 600 * FT;
const BULB_R = 45 * FT, BULB_ROW_R = 55 * FT;
/** The smallest lot a split may leave: the R-2 minimum, 5,000 sf on 40 ft of frontage [S, typical R-2]. */
export const SPLIT_MIN = { sf: 5000, ft: 40 };

const STREET_NAMES = ["Oak", "Maple", "Hickory", "Walnut", "Linden", "Sycamore", "Willow", "Aspen", "Birch", "Cedar", "Elm", "Ash",
  "Meadowlark", "Bluestem", "Prairie", "Fox Run", "Harvest", "Orchard", "Clover", "Juniper", "Larkspur", "Sumac", "Hawthorn", "Bur Oak",
  "Redbud", "Chestnut", "Wren", "Kestrel", "Cardinal", "Sparrow", "Thistle", "Goldenrod"];
const SUFFIX = { grid: ["St", "Ave"], loops: ["Dr", "Ln"], culdesac: ["Ct", "Pl"], collector: ["Pkwy", "Blvd"] };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sqft = (m2) => m2 * SQFT_PER_M2;

/** The design's shares, normalised; a single size when nothing else is set. */
export function mixShares(mix) {
  const out = DESIGN_SIZES.map((s) => Math.max(0, Number(mix?.[s] ?? 0)));
  const t = out.reduce((a, b) => a + b, 0);
  if (!(t > 0)) return DESIGN_SIZES.map((s) => (s === 7500 ? 1 : 0));
  return out.map((v) => v / t);
}

/** Distance from p to segment ab. */
function segDist(p, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
  const t = L2 > 1e-12 ? clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey);
}
/** Edge-to-edge distance between two convex-ish rings, 0 where they touch. */
export function ringGap(A, B) {
  let best = Infinity;
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b0 = B[j], b1 = B[(j + 1) % B.length];
      best = Math.min(best, segDist(a0, b0, b1), segDist(b0, a0, a1));
    }
  }
  return best;
}
const centroid = (r) => r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);

/**
 * THE BASE PLAT: streets and lots for (layout, mix, rot, shift), before any
 * claim or edit. `env`: { r: tract box [x0,y0,x1,y1], bearing, id, seed,
 * ok(p) — buildable ground, street(p) — where a street may run }.
 * Lot sizes are dealt street by street (or court by court) to whichever size
 * the plat is shortest of against the mix, counting lots actually kept.
 */
export function designBase(spec, env) {
  const layout = DESIGN_LAYOUTS.includes(spec.layout) ? spec.layout : "grid";
  const shares = mixShares(spec.mix);
  const rng = makeRng(`plat-design:${env.id}:${layout}:${env.seed}`);
  const [x0, y0, x1, y1] = env.r;
  // a side with a road along it gives up half the road's 66 ft right-of-way and a verge; a side on a
  // field gives up nothing (env.insets: west, north, east, south in the canonical frame; region/index.mjs)
  const ins = env.insets ?? [66 * FT / 2 + 4, 66 * FT / 2 + 4, 66 * FT / 2 + 4, 66 * FT / 2 + 4];
  const X0 = x0 + ins[0], Y0 = y0 + ins[1], X1 = x1 - ins[2], Y1 = y1 - ins[3];
  const shift = [Number(spec.shift?.[0] ?? 0), Number(spec.shift?.[1] ?? 0)];
  const C = add([(X0 + X1) / 2, (Y0 + Y1) / 2], shift);
  // the pattern runs along the tract's long side unless turned: a grid turned in a rectangle wastes its corners
  const deg = (env.bearing ?? (X1 - X0 >= Y1 - Y0 ? 0 : 90)) + Number(spec.rot ?? 0);
  const th = (deg * Math.PI) / 180, u = [Math.cos(th), Math.sin(th)], v = perp(u);
  const sl = Math.hypot(shift[0], shift[1]);
  const half = (Math.abs(dot([X1 - X0, 0], u)) + Math.abs(dot([0, Y1 - Y0], u))) / 2 + sl;
  const halfV = (Math.abs(dot([X1 - X0, 0], v)) + Math.abs(dot([0, Y1 - Y0], v))) / 2 + sl;
  const P = (a, b) => add(C, add(mul(u, a), mul(v, b)));
  const inTract = (p) => p[0] >= X0 && p[0] <= X1 && p[1] >= Y0 && p[1] <= Y1;
  const good = (p) => inTract(p) && env.ok(p);
  const streetOk = (p) => inTract(p) && (env.street ? env.street(p) : true);
  const streets = [], bulbs = [], lots = [];
  const kept = new Map(DESIGN_SIZES.map((s) => [s, 0]));
  let face = 0;
  const choose = () => {
    const n = [...kept.values()].reduce((a, b) => a + b, 0);
    let best = DESIGN_SIZES[0], gap = -Infinity;
    DESIGN_SIZES.forEach((s, i) => {
      if (!(shares[i] > 0)) return;
      const g = shares[i] - (n ? kept.get(s) / n : 0);
      if (g > gap + 1e-9) { gap = g; best = s; }
    });
    return best;
  };
  const dims = (s) => [LOT_DIM_FT[s][0] * FT, LOT_DIM_FT[s][1] * FT];
  let nameI = Math.floor(rng() * STREET_NAMES.length);
  const nameOf = (kind) => { const n = STREET_NAMES[nameI++ % STREET_NAMES.length]; const sx = SUFFIX[kind]; return `${n} ${sx[nameI % sx.length]}`; };

  /** Lots both sides of a polyline at a fixed frontage, from s0 to s1 along it, skipping gaps. */
  const lotsAlong = (pl, size, sides, R, street, s0 = 0, s1 = Infinity, gapAt = []) => {
    const [w, depth] = dims(size);
    const Lf = cumLen(pl).at(-1), L = Math.min(s1, Lf);
    // side lines run square to the street at each corner, so neighbours on a curve share them
    const nrm = (s, sd) => mul(perp(norm(sub(pointAt(pl, Math.min(Lf, s + 3)), pointAt(pl, Math.max(0, s - 3))))), sd);
    for (const sd of sides) {
      const f = face++;
      let s = s0;
      while (s + w <= L + 1e-6) {
        // a lot may not cross a cross street: restart just past it, losing only the street itself
        const g = gapAt.find((gg) => s < gg + R / 2 && s + w > gg - R / 2);
        if (g !== undefined) { s = g + R / 2 + 0.5; continue; }
        const sm = s + w / 2;
        const a = pointAt(pl, s), b = pointAt(pl, s + w), m = pointAt(pl, sm);
        const n0 = nrm(s, sd), n1 = nrm(s + w, sd), n = nrm(sm, sd);
        const f0 = add(a, mul(n0, R / 2)), f1 = add(b, mul(n1, R / 2));
        // where the street's own frontage is not usable ground, slide a quarter lot on and try again
        if (!good(f0) || !good(f1)) { s += w / 4; continue; }
        // a lot that runs into ground it cannot use is cut short to fit, to 60% of its depth and never
        // under the district's minimum lot; past that it is not a lot
        let ring = null, dd = depth;
        for (const k of [1, 0.85, 0.72, 0.6]) {
          dd = depth * k;
          const r = sd > 0 ? [f0, f1, add(f1, mul(n1, dd)), add(f0, mul(n0, dd))] : [f1, f0, add(f0, mul(n0, dd)), add(f1, mul(n1, dd))];
          if (r.every(good) && good(centroid(r)) && good(add(m, mul(n, R / 2 + dd / 2))) && sqft(ringAreaAbs(r)) >= SPLIT_MIN.sf * 0.98) { ring = r; break; }
        }
        if (!ring) { s += w / 4; continue; }
        s += w;
        lots.push({ ring, front: [ring[0], ring[1]], c: centroid(ring), a: Math.round(sqft(ringAreaAbs(ring))), w: w / FT, d: dd / FT, size, face: f, street, sd });
        kept.set(size, kept.get(size) + 1);
      }
    }
  };
  /** The runs of a polyline that lie where a street may go, each at least `min` m. */
  const runsOf = (pl, min = 30) => {
    const out = []; let cur = [];
    for (const p of resample(pl, 6)) { if (streetOk(p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur);
    return out.filter((r) => cumLen(r).at(-1) >= min);
  };
  const addStreet = (pl, kind, name) => {
    const runs = runsOf(pl);
    const ids = [];
    for (const r of runs) { ids.push(streets.length); streets.push({ pl: r, kind, name, row: ROW[kind === "collector" ? "collector" : kind === "court" ? "court" : "local"] / FT }); }
    return ids;
  };

  if (layout === "grid" || layout === "loops") {
    // parallel streets across v, each with one lot size both sides; the pitch from street to street is
    // the two depths that back onto each other plus the right-of-way
    const R = ROW.local;
    const loops = layout === "loops";
    const lam = clamp(2 * half * rng.range(0.7, 1.1), 260, 720), ph = rng.range(0, 6.28);
    const bend = (s, pitch) => (loops ? Math.min(28, pitch * 0.28) * Math.sin((2 * Math.PI * s) / lam + ph) : 0);
    const rows = [];
    let vs = -halfV, prevD = 0;
    for (let j = 0; j < 200; j++) {
      const size = choose(), d = dims(size)[1];
      vs = j === 0 ? -halfV + d + R / 2 : vs + R / 2 + prevD + d + R / 2;
      if (vs - R / 2 > halfV) break;
      const pitch = 2 * d + R;
      const pl = [];
      for (let s = -half; s <= half + 1; s += 12) pl.push(P(s, vs + bend(s, pitch)));
      // where this street lies inside the tract
      const runs = runsOf(pl, 2 * dims(size)[0]);
      const name = nameOf(loops ? "loops" : "grid");
      const row = { size, runs, name, ids: [] };
      rows.push(row);
      // the cross streets of a grid: every block length, shared by every street (gaps in the lots)
      for (const run of runs) {
        const id = streets.length;
        streets.push({ pl: run, kind: "local", name, row: R / FT });
        row.ids.push(id);
        const L = cumLen(run).at(-1);
        if (loops) {
          // a loop closes at its ends: leave a right-of-way clear for the connector
          lotsAlong(run, size, [1, -1], R, id, R / 2 + 2, L - R / 2 - 2);
        } else {
          // the cross streets fall at fixed u, so find where along this run each sits
          const sAt = [];
          const startU = dot(sub(run[0], C), u);
          for (let a = -half + BLOCK * 0.5; a < half; a += BLOCK) sAt.push(a - startU);
          lotsAlong(run, size, [1, -1], R, id, 0, Infinity, sAt);
        }
      }
      prevD = d;
    }
    if (!loops) {
      // the cross streets, from the first street to the last
      const vA = -halfV, vB = halfV;
      for (let a = -half + BLOCK * 0.5; a < half; a += BLOCK) addStreet([P(a, vA), P(a, vB)], "local", nameOf("grid"));
    } else {
      // close neighbouring streets into loops at alternating ends; the middle street runs out to the section roads
      const ends = rows.map((r) => (r.runs.length ? r.runs.reduce((b, x) => (cumLen(x).at(-1) > cumLen(b).at(-1) ? x : b)) : null));
      for (let j = 0; j + 1 < ends.length; j++) {
        const a = ends[j], b = ends[j + 1];
        if (!a || !b) continue;
        const at = j % 2 === 0 ? -1 : 0;
        addStreet([a.at(at), b.at(at)], "local", rows[j].name);
      }
      const mid = ends[Math.floor(ends.length / 2)];
      if (mid) { addStreet([mid[0], add(mid[0], mul(u, -400))], "collector", nameOf("collector")); addStreet([mid.at(-1), add(mid.at(-1), mul(u, 400))], "collector", streets.at(-1)?.name ?? nameOf("collector")); }
    }
  } else {
    // A WINDING COLLECTOR WITH COURTS. No house fronts the collector (it carries the plat's traffic);
    // courts run off it both sides, a pitch of their two depths plus the right-of-way apart, each at
    // most 600 ft with a bulb and pie lots round its end.
    const Rc = ROW.collector, R = ROW.court;
    const dAvg = DESIGN_SIZES.reduce((t, s, i) => t + shares[i] * dims(s)[1], 0);
    const band = 2 * (CDS_MAX + dAvg + Rc / 2);
    const nSpine = Math.max(1, Math.round((2 * halfV - 2 * sl) / band));
    for (let k = 0; k < nSpine; k++) {
      const b = -halfV + sl + ((k + 0.5) * (2 * halfV - 2 * sl)) / nSpine;
      const amp = rng.range(4, 12), lam = 2 * half * rng.range(0.8, 1.2), ph = rng.range(0, 6.28);
      const pl = [];
      for (let s = -half; s <= half + 1; s += 12) pl.push(P(s, b + amp * Math.sin((2 * Math.PI * s) / lam + ph)));
      const name = nameOf("collector");
      const room = (2 * halfV - 2 * sl) / nSpine / 2 - Rc / 2;
      for (const run of runsOf(pl, 120)) {
        const sid = streets.length;
        streets.push({ pl: run, kind: "collector", name, row: Rc / FT });
        const L = cumLen(run).at(-1);
        let s = 0, prevD = 0;
        for (let guard = 0; guard < 400; guard++) {
          const size = choose(), [w, d] = dims(size);
          s = guard === 0 ? d + R / 2 : s + R / 2 + prevD + d + R / 2;
          if (s > L - d - R / 2) break;
          prevD = d;
          const base = pointAt(run, s), dir = norm(sub(pointAt(run, Math.min(L, s + 4)), pointAt(run, Math.max(0, s - 4))));
          for (const side of [1, -1]) {
            const nn = mul(v, side);   // courts parallel, square to the plat, whatever the collector does
            let len = Math.min(CDS_MAX, room - d - BULB_ROW_R + 10);
            // shorten the court until its bulb and the lots round it are on the tract
            while (len > 2 * w && !(good(add(base, mul(nn, len + BULB_ROW_R))) && streetOk(add(base, mul(nn, len))))) len -= 10;
            if (len < 2 * w) continue;
            const tip = add(base, mul(nn, len));
            const stem = [add(base, mul(nn, Rc / 2)), tip];
            const cname = nameOf("culdesac");
            const id = streets.length;
            streets.push({ pl: stem, kind: "court", name: cname, row: R / FT });
            bulbs.push({ c: tip, r: BULB_R, street: id });
            lotsAlong(stem, size, [1, -1], R, id, 6, len - Rc / 2 - BULB_ROW_R + 2);
            // pie lots round the bulb, across its far half
            const n0 = Math.atan2(nn[1], nn[0]), nPie = size >= 10000 ? 3 : 4, spread = (Math.PI * 150) / 180;
            const f = face++;
            for (let q = 0; q < nPie; q++) {
              const ta = n0 - spread / 2 + (q * spread) / nPie, tb = ta + spread / nPie;
              const r0 = BULB_ROW_R, r1 = BULB_ROW_R + d * 0.9;
              const pt = (r, t) => add(tip, [r * Math.cos(t), r * Math.sin(t)]);
              const tm = (ta + tb) / 2;
              const ring = [pt(r0, ta), pt(r0, tm), pt(r0, tb), pt(r1, tb), pt(r1, tm), pt(r1, ta)];
              const c = centroid(ring);
              if (!ring.every(good) || !good(c)) continue;
              lots.push({ ring, front: [ring[0], ring[2]], c, a: Math.round(sqft(ringAreaAbs(ring))), w: Math.round((r0 * spread) / nPie / FT), d: (d * 0.9) / FT, size, face: f, street: id, pie: true });
              kept.set(size, kept.get(size) + 1);
            }
          }
        }
        void sid;
      }
    }
  }
  // NOBODY PAVES A STREET THAT SERVES NO LOT. Each street keeps only the runs that lie within reach
  // of a lot (a lot's centre is half its depth past the right-of-way), so a street the pattern laid
  // across the floodplain or off the tract's dry ground is not built, and not counted.
  const reach = (s) => (s.kind === "collector" ? 75 : 45);
  const cells = new Map(), CS = 50;
  for (const l of lots) { const k = `${Math.floor(l.c[0] / CS)},${Math.floor(l.c[1] / CS)}`; (cells.get(k) ?? cells.set(k, []).get(k)).push(l.c); }
  const nearLot = (p, r) => {
    const i = Math.floor(p[0] / CS), j = Math.floor(p[1] / CS);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const c of cells.get(`${i + a},${j + b}`) ?? []) if (dist(c, p) <= r) return true;
    return false;
  };
  const paved = [], remap = new Map();
  streets.forEach((s, id) => {
    let cur = [], first = true;
    const flush = () => {
      if (cur.length > 1 && cumLen(cur).at(-1) >= 20) { if (first) remap.set(id, paved.length); first = false; paved.push({ ...s, pl: cur }); }
      cur = [];
    };
    for (const p of resample(s.pl, 6)) { if (nearLot(p, reach(s))) cur.push(p); else flush(); }
    flush();
  });
  for (const l of lots) l.street = remap.get(l.street) ?? -1;
  const bulbsKept = bulbs.filter((b) => remap.has(b.street)).map((b) => ({ ...b, street: remap.get(b.street) }));
  return { layout, lots, streets: paved, bulbs: bulbsKept, frame: { u, v, C, deg } };
}

/** Merge the run of base lots `ids` (consecutive on one face) into one lot. */
function mergeLots(group) {
  const a = group[0], b = group.at(-1);
  if (a.pie) {
    const ring = [...group.flatMap((l) => [l.ring[0], l.ring[1]]), b.ring[2], b.ring[3], ...group.slice().reverse().flatMap((l) => [l.ring[4], l.ring[5]])];
    return { ...a, ring, front: [a.ring[0], b.ring[2]], c: centroid(ring), a: group.reduce((t, l) => t + l.a, 0), w: group.reduce((t, l) => t + l.w, 0) };
  }
  // a ring starts at the front corner nearer the street's start on the right-hand side (sd 1) and
  // the farther one on the left (sd -1), so a run's two ends come from different lots
  const ring = a.sd < 0 ? [b.ring[0], a.ring[1], a.ring[2], b.ring[3]] : [a.ring[0], b.ring[1], b.ring[2], a.ring[3]];
  return { ...a, ring, front: [ring[0], ring[1]], c: centroid(ring), a: group.reduce((t, l) => t + l.a, 0), w: group.reduce((t, l) => t + l.w, 0) };
}
function splitLot(l) {
  if (l.pie) return null;
  const [p0, p1, p2, p3] = l.ring;
  const m01 = mul(add(p0, p1), 0.5), m32 = mul(add(p3, p2), 0.5);
  const A = [p0, m01, m32, p3], B = [m01, p1, p2, m32];
  const half = (r) => ({ ...l, ring: r, front: [r[0], r[1]], c: centroid(r), a: Math.round(sqft(ringAreaAbs(r))), w: l.w / 2 });
  return [half(A), half(B)];
}
/** Two lots on one face that share a side line (not two either side of a gap where a lot did not fit). */
const touching = (a, b) => a.ring.some((p) => b.ring.some((q) => dist(p, q) < 0.5));
/** Can this base lot be split into two lots the zoning allows? */
export const canSplit = (l) => !l.pie && l.w / 2 >= SPLIT_MIN.ft && l.a / 2 >= SPLIT_MIN.sf;

/**
 * THE DESIGNED PLAT. `design`: { layout, mix, rot, shift, pond?: [x,y], amen: [{ k, at: [x,y], sf }],
 * open: [i], merge: [i], split: [i] } — lot indices are BASE lots (designBase order). `env` as
 * designBase plus pondSf, pondAt (the default pond site), floodDist(p) (m to the floodplain or
 * creek, Infinity where there is none) and trail (polylines along the floodplain's edge).
 *
 * Claims come first and in order: the detention pond, then each amenity takes the base lots nearest
 * where it was set down until it has its land; then edits (open, merge with the next lot on the
 * face, split in two). Every final lot carries `near`: [amenity index, edge-to-edge metres] for each
 * amenity within 800 m.
 */
export function designPlat(design, env) {
  const base = designBase(design, env);
  const B = base.lots;
  const claimed = new Map();         // base index -> claim index (-1 the pond)
  const claimNearest = (at, sf, tag) => {
    if (!(sf > 0) || !at) return [];
    const order = B.map((l, i) => i).filter((i) => !claimed.has(i)).sort((i, j) => dist(B[i].c, at) - dist(B[j].c, at) || i - j);
    const out = []; let got = 0;
    for (const i of order) { if (got >= sf * 0.97) break; claimed.set(i, tag); out.push(i); got += B[i].a; }
    return out;
  };
  const pondAt = design.pond ?? env.pondAt;
  const pondLots = claimNearest(pondAt, env.pondSf ?? 0, -1);
  const amen = (design.amen ?? []).map((a, k) => {
    if (a.k === "greenway") return { k: a.k, at: a.at, lots: [], sf: 0, trail: env.trail ?? [], ok: (env.trail ?? []).length > 0 };
    const ids = claimNearest(a.at, a.sf, k);
    return { k: a.k, at: a.at, lots: ids, sf: ids.reduce((t, i) => t + B[i].a, 0), ok: ids.length > 0 };
  });
  const openSet = new Set((design.open ?? []).filter((i) => B[i] && !claimed.has(i)));
  const mergeSet = new Set((design.merge ?? []).filter((i) => B[i] && !claimed.has(i) && !openSet.has(i)));
  const splitSet = new Set((design.split ?? []).filter((i) => B[i] && !claimed.has(i) && !openSet.has(i) && canSplit(B[i])));
  const lots = [];
  for (let i = 0; i < B.length; i++) {
    if (claimed.has(i) || openSet.has(i)) continue;
    const group = [i];
    while (mergeSet.has(group.at(-1))) {
      const nx = group.at(-1) + 1;
      if (!B[nx] || B[nx].face !== B[i].face || claimed.has(nx) || openSet.has(nx) || !touching(B[group.at(-1)], B[nx])) break;
      group.push(nx);
    }
    if (group.length > 1) { lots.push({ ...mergeLots(group.map((g) => B[g])), base: group }); i = group.at(-1); continue; }
    if (splitSet.has(i)) { const two = splitLot(B[i]); if (two) { for (const h of two) lots.push({ ...h, base: [i], half: true }); continue; } }
    lots.push({ ...B[i], base: [i] });
  }
  // what each lot is near: edge-to-edge to an amenity's land, or to the floodplain for a greenway
  for (const l of lots) {
    const near = [];
    amen.forEach((a, k) => {
      if (!a.ok) return;
      let m = Infinity;
      if (a.k === "greenway") m = Math.max(0, (env.floodDist?.(l.c) ?? Infinity) - Math.sqrt(l.a / SQFT_PER_M2) / 2);
      else for (const i of a.lots) { if (dist(B[i].c, l.c) > 900) continue; m = Math.min(m, ringGap(l.ring, B[i].ring)); }
      if (m <= 800) near.push([k, Math.round(m)]);
    });
    l.near = near;
  }
  const area = (ids) => ids.reduce((t, i) => t + B[i].a, 0);
  const streetSf = sqft(base.streets.reduce((t, s) => t + cumLen(s.pl).at(-1) * s.row * FT, 0) + base.bulbs.reduce((t, b) => t + Math.PI * BULB_ROW_R * BULB_ROW_R, 0));
  return {
    gen: DESIGN_GEN,
    layout: base.layout, frame: base.frame,
    base: B, lots, streets: base.streets, bulbs: base.bulbs, bulbR: BULB_R,
    pond: { at: pondAt, lots: pondLots, sf: area(pondLots), r: Math.sqrt(Math.max(1, (env.pondSf ?? 0) / SQFT_PER_M2) / Math.PI) },
    amen, open: [...openSet],
    stats: {
      lotSf: lots.reduce((t, l) => t + l.a, 0),
      streetSf: Math.round(streetSf),
      pondSf: area(pondLots),
      amenSf: amen.reduce((t, a) => t + a.sf, 0),
      openSf: area([...openSet]),
    },
  };
}
