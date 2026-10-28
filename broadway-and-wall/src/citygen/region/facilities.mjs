// THE COUNTRY BEYOND THE MAP: the region's heavy industry, drawn round the
// playable window (INDUSTRIES_71.md §4b, ONE_ECONOMY_PLAN.md step 2c).
//
// The 6 x 6 km window is the market: every acre of it is a parcel or a tract
// someone can buy. The land-hungry industries a county seat lives off — the
// airport, the railroad's yard, a refinery, a metals works, the quarries, the
// big farms, the power station — stand outside it, in a belt of country
// BELT metres wide all round. They are background: drawn, named and clickable,
// never in an engine table, never for sale. `city.facilities` lists them (id,
// name, BEA industry, footprint, centroid, and the pieces the renderer draws)
// so a later step can attach a firm's books to each; `city.hinterland` is the
// ground they stand on (the land, the fields, the river and roads carried on
// past the window's edge, the freight line).
//
// NOTHING IN THE WINDOW MOVES. Every draw here comes from its own stream
// ("facilities:<seed>"), and the land model is only read, so the region's
// parcels, tracts, roads and every other stream are byte-identical with or
// without this file.
//
// All work is in the canonical frame (region/land.mjs: river top to bottom,
// +y downstream, the window 0..S); index.mjs turns it into lon/lat.
//
// Status labels as in land.mjs: [S] sourced or a measured US norm
// (approximate), [O] an owner design decision, [K] a shape parameter set by eye.
import {
  MILE, makeRng, makeNoise, add, sub, mul, dist, norm, perp, dot, cumLen, resample, chaikinOpen, pointAt,
  rectRing, ringCentroid, ringAreaAbs, pointInRing, distToLine,
} from "./util.mjs";

/** [O] how far the drawn country reaches past the window's edge, m (the widest camera sees ~20 km). */
export const BELT = 4000;
/** [K] facilities keep this far off the window's edge, m: the market's last tract keeps its hedge. */
const MARGIN = 150;
/** raster for siting, m (a tool choice) */
const CELL = 40;
const WIN = 1, WATER = 2, SEA = 4, ROAD = 8, RAIL = 16, FAC = 32;

/**
 * BEA summary industries (2017 Input-Output accounts), as INDUSTRIES_71.md
 * names them. The code is the join key for the economy; the word is the card's.
 */
export const FACILITY_INDUSTRY = {
  airport: { code: "481", word: "Air transport" },
  railyard: { code: "482", word: "Rail freight" },
  refinery: { code: "324", word: "Oil refining" },
  metals: { code: "331", word: "Primary metals" },
  quarry: { code: "212", word: "Mining" },
  farm: { code: "111CA", word: "Farms" },
  orchard: { code: "111CA", word: "Farms" },
  forest: { code: "113FF", word: "Forestry" },
  power: { code: "22", word: "Utilities" },
};

const SURNAMES = ["Harlan", "Kestrel", "Wexler", "Corwin", "Ashby", "Talbot", "Hollis", "Brandt", "Mercer", "Lindell", "Garrow", "Whitcomb", "Pruett", "Danforth", "Rourke", "Stroud", "Kimball", "Vance", "Oakes", "Fenwick", "Thayer", "Larkin", "Bellamy", "Crane", "Wilder", "Haskell", "Pell", "Sorensen", "Marlow", "Ingram"];
const PLACES = ["Coldwater", "Prairie", "Ironwood", "Bluestem", "Six Mile", "Elk Grove", "Red Bank", "Long Point", "Granite", "Sycamore", "Burr Oak", "Flint Hill", "Big Bend", "Cedar Point", "Salt Creek", "Twin Lakes"];
const BIRDS = ["Kestrel", "Merlin", "Harrier", "Osprey", "Swift", "Heron", "Plover", "Curlew"];

/**
 * Place the region's background facilities and the country round them.
 * `M` is the finished land model (generateLand + storyPrep + townFootprint + placeOuter), read only.
 * Returns canonical-frame data: { facilities, hinterland }.
 */
export function placeFacilities(M, seed) {
  const S = M.S, B = BELT, rng = makeRng("facilities:" + (seed >>> 0));
  const nz = makeNoise(rng, 1300);
  const X0 = -B, X1 = S + B, Wn = Math.ceil((X1 - X0) / CELL);
  const grid = new Uint8Array(Wn * Wn);
  const idx = (p) => { const i = Math.floor((p[0] - X0) / CELL), j = Math.floor((p[1] - X0) / CELL); return i < 0 || j < 0 || i >= Wn || j >= Wn ? -1 : j * Wn + i; };
  const ctr = (k) => [X0 + ((k % Wn) + 0.5) * CELL, X0 + (Math.floor(k / Wn) + 0.5) * CELL];
  const inWindow = (p, m = 0) => p[0] > -m && p[1] > -m && p[0] < S + m && p[1] < S + m;
  const inExtent = (p) => p[0] >= X0 && p[1] >= X0 && p[0] <= X1 && p[1] <= X1;
  const coastY = M.coastY;
  const isSea = (p) => !!coastY && p[1] > coastY(p[0]);
  const stampDisk = (p, r, flag) => {
    const i0 = Math.max(0, Math.floor((p[0] - r - X0) / CELL)), i1 = Math.min(Wn - 1, Math.floor((p[0] + r - X0) / CELL));
    const j0 = Math.max(0, Math.floor((p[1] - r - X0) / CELL)), j1 = Math.min(Wn - 1, Math.floor((p[1] + r - X0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = X0 + (i + 0.5) * CELL - p[0], y = X0 + (j + 0.5) * CELL - p[1];
      if (x * x + y * y <= (r + CELL * 0.5) ** 2) grid[j * Wn + i] |= flag;
    }
  };
  const stampLine = (pts, r, flag) => { for (const q of resample(pts, CELL / 2)) stampDisk(q, r, flag); };
  const stampRing = (ring, flag, pad = 0) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let x = x0 - pad; x <= x1 + pad; x += CELL / 2) for (let y = y0 - pad; y <= y1 + pad; y += CELL / 2) {
      const p = [x, y], k = idx(p);
      if (k < 0) continue;
      if (pointInRing(p, ring) || (pad > 0 && distToLine(p, ring.concat([ring[0]])) <= pad)) grid[k] |= flag;
    }
  };

  // ---------------- the window, the sea
  for (let i = 0; i < Wn; i++) {
    const x = X0 + (i + 0.5) * CELL, cy = coastY ? coastY(x) : Infinity;
    for (let j = 0; j < Wn; j++) {
      const y = X0 + (j + 0.5) * CELL, k = j * Wn + i;
      if (x > -MARGIN && y > -MARGIN && x < S + MARGIN && y < S + MARGIN) grid[k] |= WIN;
      if (y > cy) grid[k] |= SEA;
    }
  }

  // ---------------- THE RIVER CARRIES ON. land.mjs draws it from 200 m above the window to 200 m below it
  // (or into the sea); out here it keeps its width and meanders on [K: the window's own wavelength].
  const rv = M.river, rw = rv.width;
  const riverExt = (from, dir) => {
    const lam = rw * 12, amp = rw * (1.2 + rng()), ph = rng() * 6.28, n0 = perp(dir), out = [from];
    for (let s = 40; s <= B + 600; s += 40) {
      const ramp = Math.min(1, s / 900);
      out.push(add(add(from, mul(dir, s)), mul(n0, ramp * amp * Math.sin(2 * Math.PI * s / lam + ph))));
    }
    return chaikinOpen(out, 2);
  };
  const rp = rv.pts, nR = rp.length;
  // the way it leaves: mostly the valley's own axis (top to bottom), a little of the last bend [K]
  const axis = norm(sub(rp[nR - 1], rp[0]));
  const leave = (a, b, sgn) => norm(add(mul(norm(sub(a, b)), 0.35), mul(axis, 0.65 * sgn)));
  const up = riverExt(rp[0], leave(rp[0], rp[Math.min(12, nR - 1)], -1));
  const downEnds = !isSea(rp[nR - 1]);
  const down = downEnds ? riverExt(rp[nR - 1], leave(rp[nR - 1], rp[Math.max(0, nR - 13)], 1)) : null;
  const riverAll = up.slice().reverse().concat(rp, down ?? []);
  const halfAt = (i) => (i < up.length ? rw / 2 : i < up.length + nR ? rv.half[i - up.length] : rw / 2);
  for (let i = 0; i < riverAll.length; i++) if (!inWindow(riverAll[i], -1) || true) stampDisk(riverAll[i], halfAt(i), WATER);
  for (const c of M.creeks) stampLine(c.pts, c.w / 2, WATER);
  // the belt's water polylines, for drawing: the river past both ends of the window's
  const water = [{ pts: up.slice().reverse(), w: rw, name: rv.name }];
  if (down) water.push({ pts: down, w: rw, name: rv.name });

  // ---------------- THE ROADS CARRY ON. The interstate, a spur and the old county roads run off the window's
  // edge; out here they keep going straight to the edge of the drawn country (and stop at the sea).
  const onEdge = (p) => Math.min(p[0], p[1], S - p[0], S - p[1]) < 40;
  const extend = (end, prev, w, kind, name) => {
    const dir = norm(sub(end, prev)), out = [end];
    for (let s = 50; s <= B * 1.5; s += 50) {
      const q = add(end, mul(dir, s));
      if (!inExtent(q) || isSea(add(q, mul(dir, 150)))) break;
      if (inWindow(q, -1)) return null;   // it turned back in: not an exit
      out.push(q);
    }
    return out.length >= 3 ? { pts: out, w, kind, name } : null;
  };
  const roads = [];
  for (const h of M.highways) {
    if (!h.segs?.length) continue;
    const ends = [[h.pts[0], pointAt(h.pts, 300), h.segs[0]], [h.pts.at(-1), pointAt(h.pts, cumLen(h.pts).at(-1) - 300), h.segs.at(-1)]];
    for (const [e, pv, sg] of ends) if (sg?.built && onEdge(e)) { const r = extend(e, pv, 24, "highway", h.id); if (r) roads.push(r); }
  }
  for (const r of M.oldRoads) {
    for (const [e, pv] of [[r[0], pointAt(r, 200)], [r.at(-1), pointAt(r, cumLen(r).at(-1) - 200)]]) if (onEdge(e)) { const x = extend(e, pv, 14, "county"); if (x) roads.push(x); }
  }
  for (const r of roads) stampLine(r.pts, r.w / 2 + (r.kind === "highway" ? 30 : 15), ROAD);

  // distance to open water (river or sea), m — for the plants that need it
  const wetD = new Float32Array(grid.length).fill(Infinity);
  {
    const q = new Int32Array(grid.length); let qh = 0, qt = 0;
    for (let k = 0; k < grid.length; k++) if (grid[k] & (WATER | SEA)) { wetD[k] = 0; q[qt++] = k; }
    while (qh < qt) {
      const k = q[qh++], i = k % Wn, j = (k / Wn) | 0;
      const d = wetD[k] + CELL;
      if (i > 0 && wetD[k - 1] > d) { wetD[k - 1] = d; q[qt++] = k - 1; }
      if (i < Wn - 1 && wetD[k + 1] > d) { wetD[k + 1] = d; q[qt++] = k + 1; }
      if (j > 0 && wetD[k - Wn] > d) { wetD[k - Wn] = d; q[qt++] = k - Wn; }
      if (j < Wn - 1 && wetD[k + Wn] > d) { wetD[k + Wn] = d; q[qt++] = k + Wn; }
    }
  }
  const wetAt = (p) => { const k = idx(p); return k < 0 ? Infinity : wetD[k]; };
  const edgeDist = (p) => Math.max(-p[0], -p[1], p[0] - S, p[1] - S);   // how far out of the window, m

  /** A polyline's point at distance s along it, its length measured once (pointAt re-measures every call). */
  const sampler = (pl) => {
    const c = cumLen(pl), L = c.at(-1);
    const f = (s) => {
      s = Math.max(0, Math.min(L, s));
      let lo = 0, hi = c.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
      const t = (s - c[lo]) / ((c[hi] - c[lo]) || 1);
      return [pl[lo][0] + (pl[hi][0] - pl[lo][0]) * t, pl[lo][1] + (pl[hi][1] - pl[lo][1]) * t];
    };
    f.L = L;
    return f;
  };

  // ---------------- footprints
  const R = (c, u, w, d) => { u = norm(u); return { c, u, v: perp(u), w, d, ring: rectRing(c, u, w, d) }; };
  const at = (r, a, b) => add(add(r.c, mul(r.u, a)), mul(r.v, b));
  /** Every sample of the rectangle (grown by pad) is on the drawn land and free of `mask`. */
  const clear = (r, mask, pad = 0) => {
    const hw = r.w / 2 + pad, hd = r.d / 2 + pad;
    const na = Math.max(2, Math.ceil((2 * hw) / CELL)), nb = Math.max(2, Math.ceil((2 * hd) / CELL));
    // the centre and the corners first: most rejections are cheap
    const [cx, cy] = r.c, [ux, uy] = r.u, [vx, vy] = r.v;
    const test = (a, b) => {
      const x = cx + ux * a + vx * b, y = cy + uy * a + vy * b;
      if (x < X0 || y < X0 || x > X1 || y > X1) return false;
      const i = Math.floor((x - X0) / CELL), j = Math.floor((y - X0) / CELL);
      return i >= 0 && j >= 0 && i < Wn && j < Wn && (grid[j * Wn + i] & mask) === 0;
    };
    if (!test(0, 0) || !test(-hw, -hd) || !test(hw, -hd) || !test(hw, hd) || !test(-hw, hd)) return false;
    for (let ia = 0; ia <= na; ia++) for (let ib = 0; ib <= nb; ib++) if (!test(-hw + (2 * hw * ia) / na, -hd + (2 * hd * ib) / nb)) return false;
    return true;
  };
  const claim = (r, pad = 30) => stampRing(r.ring, FAC, pad);
  const BLOCK = WIN | WATER | SEA | ROAD | RAIL | FAC;
  /** candidate points scattered over the belt (deterministic). */
  const scatter = (n, minOut = 0, maxOut = B) => {
    const out = [];
    for (let t = 0; out.length < n && t < n * 30; t++) {
      const p = [X0 + rng() * (X1 - X0), X0 + rng() * (X1 - X0)], e = edgeDist(p);
      if (e < minOut || e > maxOut || isSea(p)) continue;
      out.push(p);
    }
    return out;
  };
  // the survey's axes, which the farms and most plants are squared to [S: PLSS]
  const AX = [[1, 0], [0, 1]];
  // every name is its own: no word of a pool is used twice in one region
  const used = new Set();
  const pickName = (pool, fmt) => {
    const free = pool.filter((w) => !used.has(w));
    const w = (free.length ? free : pool)[Math.floor(rng() * (free.length || pool.length))];
    used.add(w);
    return fmt(w);
  };
  const facilities = [];
  const add$ = (kind, name, r, parts, extra = {}) => {
    const ring = r.ring ?? r;
    const n = facilities.filter((f) => f.kind === kind).length;
    facilities.push({
      id: `fac:${kind}${["quarry", "farm", "orchard", "forest"].includes(kind) ? ":" + (n + 1) : ""}`,
      kind, name, industry: FACILITY_INDUSTRY[kind].code, industryName: FACILITY_INDUSTRY[kind].word,
      footprint: ring, centroid: ringCentroid(ring), m2: Math.round(ringAreaAbs(ring)), parts, ...extra,
    });
  };

  // ---------------- THE FREIGHT LINE. No railway reaches the window (the town's own line carries passengers and
  // the region drops it), so the railroad's main line runs through the country: parallel to one side of the
  // window, 0.7-1.1 km out, from the edge of the drawn country to the other edge or to the shore [K].
  let rail = null;
  {
    const sides = [];
    for (const side of ["left", "right", "top", "bottom"]) {
      if (side === "bottom" && coastY) continue;
      const off = 700 + rng() * 400, ph = rng() * 6.28, wob = 120 + rng() * 120;
      const pts = [];
      for (let s = X0; s <= X1; s += 100) {
        const o = off + wob * Math.sin(2 * Math.PI * (s - X0) / 7000 + ph);
        const p = side === "left" ? [-o, s] : side === "right" ? [S + o, s] : side === "top" ? [s, -o] : [s, S + o];
        if (isSea(add(p, [0, 250]))) break;
        pts.push(p);
      }
      if (pts.length < 40) continue;
      const pl = chaikinOpen(pts, 2);
      let wet = 0, cross = 0;
      for (const q of resample(pl, CELL)) { const k = idx(q); if (k >= 0 && grid[k] & WATER) wet++; if (k >= 0 && grid[k] & ROAD) cross++; }
      sides.push({ side, pl, score: wet * 4 + cross + rng() * 6 });
    }
    sides.sort((a, b) => a.score - b.score);
    if (sides.length) {
      rail = sides[0];
      stampLine(rail.pl, 22, RAIL);
    }
  }
  const railName = `${pickName(PLACES, (p) => p)} & Western`;

  // ---------------- THE YARD. A flat classification yard and an intermodal ramp beside it on the main line, on
  // the side away from the window, near a highway for the trucks [S: a regional carload yard ~1.5-2 km of
  // body tracks; an intermodal ramp ~0.6-1 km with 3-4 loading tracks].
  if (rail) {
    const rAt = sampler(rail.pl), L = rAt.L, D = 320, W = 2600;
    let best = null;
    for (let s = W / 2 + 200; s < L - W / 2 - 200; s += 100) {
      const P = rAt(s), u = norm(sub(rAt(s + 60), rAt(s - 60)));
      let n = perp(u);
      if (edgeDist(add(P, mul(n, 300))) < edgeDist(P)) n = mul(n, -1);   // the yard on the window's far side
      // the main line runs 25 m inside the yard's near edge, so the body tracks open off it
      const r = { ...R(add(P, mul(n, D / 2 - 25)), u, W, D) };
      r.v = n; r.ring = rectRing(r.c, u, W, D);
      if (!clear(r, WIN | WATER | SEA | ROAD | FAC, 20)) continue;
      // a straight piece of line: the yard's tracks are laid true
      const bend = Math.abs(dot(perp(u), norm(sub(rAt(s + W / 2), rAt(s - W / 2)))));
      if (bend > 0.06) continue;
      let hw = Infinity; for (const rd of roads) if (rd.kind === "highway") hw = Math.min(hw, distToLine(P, rd.pts));
      const sc = Math.min(hw, 6000) / 1000 + Math.abs(edgeDist(P) - 900) / 2000 + rng() * 0.6;
      if (!best || sc < best.sc) best = { sc, r, s, P, u, n };
    }
    if (best) {
      const { r } = best;
      claim(r, 20);
      const parts = [{ t: "pad", k: "ballast", ring: r.ring }];
      const tr = (b, a0, a1) => [at(r, a0, b), at(r, a1, b)];
      // the body tracks: 14 at 5.2 m centres, 1,700 m, with a ladder at each end off the main line [S: 17 ft centres]
      const bMain = -D / 2 + 25, nT = 14, a0 = -W / 2 + 260, a1 = a0 + 1700;
      const tracks = [];
      for (let i = 0; i < nT; i++) {
        const b = bMain + 14 + i * 5.2;
        tracks.push(tr(b, a0 + i * 9, a1 - i * 9));
        parts.push({ t: "line", k: "track", pts: tr(b, a0 + i * 9, a1 - i * 9), w: 3.2 });
      }
      parts.push({ t: "line", k: "track", pts: [at(r, a0 - 120, bMain), at(r, a0 + nT * 9, bMain + 14 + (nT - 1) * 5.2)], w: 3.2 });
      parts.push({ t: "line", k: "track", pts: [at(r, a1 + 120, bMain), at(r, a1 - nT * 9, bMain + 14 + (nT - 1) * 5.2)], w: 3.2 });
      // the cars standing in the yard: boxcars, covered hoppers, tank cars, gondolas [S: ~17-20 m over couplers]
      const cars = [], CAR = ["boxcar", "boxcar", "boxcar", "hopper", "hopper", "tank", "gondola"];
      for (const [A, Bp] of tracks) {
        const u = norm(sub(Bp, A)), Lt = dist(A, Bp);
        let s = 30 + rng() * 120;
        while (s < Lt - 30) {
          const run = 8 + Math.floor(rng() * 40);
          for (let c = 0; c < run && s < Lt - 30; c++, s += 17.5) {
            const p = add(A, mul(u, s)), k = CAR[Math.floor(rng() * CAR.length)];
            cars.push([p[0], p[1], u[0], u[1], 1, k === "boxcar" ? Math.floor(rng() * 4) : 0, 0, k]);
          }
          s += 40 + rng() * 260;
        }
      }
      parts.push({ t: "inst", k: "railcar", at: cars });
      // the locomotive shop and the fuelling track, at the yard's near end
      parts.push({ t: "box", k: "shop", c: at(r, a0 - 60, bMain + 95), u: r.u, w: 130, d: 32, h: 13 });
      parts.push({ t: "line", k: "track", pts: [at(r, a0 - 200, bMain + 95), at(r, a0 + 40, bMain + 95)], w: 3.2 });
      const locos = [];
      for (let i = 0; i < 4; i++) { const p = at(r, a0 - 190 + i * 23, bMain + 95); locos.push([p[0], p[1], r.u[0], r.u[1], 1, i % 2, 0, "loco"]); }
      parts.push({ t: "inst", k: "railcar", at: locos });
      parts.push({ t: "box", k: "office", c: at(r, a0 - 60, bMain + 140), u: r.u, w: 40, d: 18, h: 8 });
      // the intermodal ramp past the far end of the body tracks: loading tracks, container stacks, gantries
      const i0 = a1 + 140, i1 = W / 2 - 40, im = (i0 + i1) / 2, iw = i1 - i0;
      parts.push({ t: "pad", k: "concrete", ring: rectRing(at(r, im, bMain + 150), r.u, iw, 230) });
      const well = [];
      for (let i = 0; i < 3; i++) {
        const b = bMain + 50 + i * 5.2;
        parts.push({ t: "line", k: "track", pts: [at(r, i0 - 100, bMain + (i ? 14 : 0)), at(r, i0 + 20, b), at(r, i1 - 10, b)], w: 3.2 });
        // double-stack well cars along two of the three tracks [S: 2 x 40 ft per well, ~20 m a car]
        if (i < 2) for (let s = i0 + 40; s < i1 - 40; s += 20.5) if (rng() < 0.8) {
          const p = at(r, s, b);
          well.push([p[0], p[1], r.u[0], r.u[1], 1, Math.floor(rng() * 6), 0, "well"]);
          if (rng() < 0.85) well.push([p[0], p[1], r.u[0], r.u[1], 1, Math.floor(rng() * 6), 1, "box"]);
          if (rng() < 0.6) well.push([p[0], p[1], r.u[0], r.u[1], 1, Math.floor(rng() * 6), 2, "box"]);
        }
      }
      // two stack blocks: 40 ft boxes, five wide, one to three high [S: wheeled and grounded storage]
      for (const bs of [bMain + 95, bMain + 128]) {
        for (let s = i0 + 30; s < i1 - 30; s += 13.2) for (let j = 0; j < 5; j++) {
          const tiers = Math.floor(rng() * 4);
          for (let z = 0; z < tiers; z++) { const p = at(r, s, bs + (j - 2) * 2.7); well.push([p[0], p[1], r.u[0], r.u[1], 1, Math.floor(rng() * 6), z, "box"]); }
        }
      }
      parts.push({ t: "inst", k: "container", at: well });
      // rail-mounted gantries straddling the loading tracks and the stack lane [S: ~45 m span, ~20 m tall]
      for (let g = 0; g < 3; g++) parts.push({ t: "gantry", c: at(r, i0 + iw * (0.2 + 0.3 * g), bMain + 80), u: r.v, span: 66, h: 22, len: 14 });
      parts.push({ t: "box", k: "office", c: at(r, im, bMain + 245), u: r.u, w: 50, d: 20, h: 7 });
      parts.push({ t: "pad", k: "lot", ring: rectRing(at(r, im, bMain + 275), r.u, Math.min(400, iw), 40) });
      const yardName = pickName(SURNAMES, (s) => `${s} Yard`);
      add$("railyard", yardName, r, parts, { line: railName });
    }
  }

  // ---------------- BY THE WATER: the refinery and the power station. A refinery takes its crude by pipeline and
  // ships by barge or tanker; a steam plant draws its condenser water from the river or the sea [S]. So both
  // sit on a bank, long side to the shore, with a gap for the levee and the road.
  const shore = [];
  {
    const lines = [];
    if (coastY) { const cl = []; for (let x = X0 + 100; x <= X1 - 100; x += 50) cl.push([x, coastY(x)]); lines.push({ pl: cl, sea: true, half: 0 }); }
    for (const wl of water) lines.push({ pl: wl.pts, sea: false, half: wl.w / 2 });
    for (const ln of lines) {
      const lAt = sampler(ln.pl), L = lAt.L;
      for (let s = 150; s < L - 150; s += 120) {
        const P = lAt(s), u = norm(sub(lAt(s + 80), lAt(s - 80)));
        for (const sd of ln.sea ? [-1] : [1, -1]) {
          const n = mul(perp(u), sd);
          if (ln.sea && n[1] > 0) continue;   // landward of the coast is up the screen (−y)
          if (!inExtent(P) || inWindow(P, 300)) continue;
          shore.push({ P, u, n, sea: ln.sea, half: ln.half });
        }
      }
    }
  }
  const waterSite = (W, D, gap, avoid, score) => {
    let best = null;
    for (const sh of shore) {
      const c = add(sh.P, mul(sh.n, sh.half + gap + D / 2));
      const r = R(c, sh.u, W, D); r.v = sh.n; r.ring = rectRing(c, sh.u, W, D);
      if (!clear(r, BLOCK, 15)) continue;
      if (avoid.some((f) => dist(f.centroid, c) < f.keep)) continue;
      const sc = score(sh, r) + rng() * 0.8;
      if (!best || sc < best.sc) best = { sc, r, sh };
    }
    return best;
  };
  const railD = (p) => (rail ? distToLine(p, rail.pl) : 5000);

  // THE REFINERY [S: a mid-size Midwest refinery, 100-200k bbl/d, stands on ~1-5 km²; crude tanks 60-80 m
  // across and 15 m tall, product tanks 20-40 m, distillation and cracking columns 40-70 m, a flare 80-100 m]
  {
    const W = 1300, D = 800;
    const best = waterSite(W, D, 90, [], (sh, r) => (sh.sea ? 0 : 2) + Math.min(railD(r.c), 4000) / 1500 + Math.max(0, 1200 - edgeDist(r.c)) / 400);
    if (best) {
      const { r, sh } = best;
      claim(r, 30);
      const parts = [{ t: "pad", k: "plant", ring: r.ring }];
      const bW = -D / 2;   // the water side is −v
      // the tank farm on one half, in bunded rows
      const tf = rng() < 0.5 ? -1 : 1;
      const tankA = (x) => tf * x;
      parts.push({ t: "pad", k: "bund", ring: rectRing(at(r, tankA(W / 4), 30), r.u, W / 2 - 60, D - 160) });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const rr = 30 + rng() * 8;
        parts.push({ t: "cyl", k: "tank", c: at(r, tankA(110 + i * 160), bW + 150 + j * 170), r: rr, h: 15 + rng() * 3 });
      }
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) if (rng() < 0.85) {
        const rr = 11 + rng() * 9;
        parts.push({ t: "cyl", k: "tank", c: at(r, tankA(80 + i * 85), bW + 520 + j * 85), r: rr, h: 12 + rng() * 4 });
      }
      for (let i = 0; i < 3; i++) parts.push({ t: "sphere", k: "sphere", c: at(r, tankA(560 + i * 34), bW + 690), r: 9 });
      // the process units on the other half: columns, cracker, unit structures, cooling cells, stacks, the flare
      const P = (x) => -tankA(x);
      const units = [[120, 300], [260, 260], [400, 320], [180, 470], [360, 480]];
      for (const [a, b] of units) {
        parts.push({ t: "box", k: "unit", c: at(r, P(a), bW + b), u: r.u, w: 60 + rng() * 30, d: 34 + rng() * 14, h: 18 + rng() * 10 });
        for (let c = 0; c < 2 + Math.floor(rng() * 3); c++) parts.push({ t: "cyl", k: "column", c: at(r, P(a - 35 + c * 18), bW + b - 30), r: 2.5 + rng() * 2.5, h: 38 + rng() * 32 });
      }
      parts.push({ t: "box", k: "unit", c: at(r, P(520), bW + 360), u: r.u, w: 30, d: 30, h: 55 });   // the cat cracker's reactor-regenerator
      parts.push({ t: "cyl", k: "column", c: at(r, P(520), bW + 330), r: 6, h: 68 });
      for (let i = 0; i < 3; i++) parts.push({ t: "stack", k: "stack", c: at(r, P(200 + i * 140), bW + 390), r: 2.8, h: 70 + rng() * 20 });
      parts.push({ t: "stack", k: "flare", c: at(r, P(W / 2 - 70), D / 2 - 70), r: 1.4, h: 95 });
      parts.push({ t: "box", k: "cooling", c: at(r, P(300), bW + 620), u: r.u, w: 110, d: 18, h: 12 });
      // pipe racks tying it together
      parts.push({ t: "rack", k: "rack", pts: [at(r, P(60), bW + 390), at(r, P(W / 2 - 60), bW + 390)], w: 7, h: 7 });
      parts.push({ t: "rack", k: "rack", pts: [at(r, P(60), bW + 390), at(r, tankA(60), bW + 390)], w: 7, h: 7 });
      parts.push({ t: "box", k: "office", c: at(r, P(W / 2 - 80), D / 2 - 40), u: r.u, w: 50, d: 22, h: 9 });
      parts.push({ t: "pad", k: "lot", ring: rectRing(at(r, P(W / 2 - 200), D / 2 - 40), r.u, 120, 50) });
      // the dock: a jetty out to deep water for tankers or barges
      {
        const a = P(350), s0 = at(r, a, bW);
        let s1 = s0;
        for (let s = 20; s < 700; s += 20) { const q = add(s0, mul(r.v, -s)); const k = idx(q); s1 = q; if (k >= 0 && (grid[k] & (WATER | SEA)) && wetAt(add(q, mul(r.v, sh.sea ? -60 : 0))) === 0 && s > (sh.sea ? 160 : sh.half + 90 - 2 * sh.half / 2)) break; }
        parts.push({ t: "line", k: "jetty", pts: [s0, s1], w: 10 });
        parts.push({ t: "box", k: "pier", c: s1, u: r.u, w: 140, d: 22, h: 3, z0: 0 });
        parts.push({ t: "inst", k: "vessel", at: [[...add(s1, mul(r.v, -24)), r.u[0], r.u[1], sh.sea ? 1 : 0.55, 0, 0, sh.sea ? "tanker" : "barge"]] });
      }
      // the crude line arriving overland: a cleared right-of-way to the edge of the country
      {
        let dir = mul(r.v, 1);
        if (edgeDist(add(r.c, mul(dir, 1000))) < edgeDist(r.c)) dir = mul(r.u, edgeDist(add(r.c, mul(r.u, 1000))) > edgeDist(r.c) ? 1 : -1);
        const a = at(r, 0, D / 2), pts = [a];
        for (let s = 100; s < 6000; s += 100) { const q = add(a, mul(dir, s)); if (!inExtent(q) || isSea(q) || inWindow(q, 50)) break; pts.push(q); }
        if (pts.length > 2) parts.push({ t: "line", k: "pipeline", pts, w: 16 });
      }
      add$("refinery", pickName(PLACES, (p) => `${p} Refinery`), r, parts, { water: sh.sea ? "sea" : "river" });
    }
  }

  // THE POWER STATION [S: a Midwest coal or combined-cycle plant of 0.5-1.5 GW: a stack of 150-200 m or two
  // HRSG stacks of ~50 m, natural-draft cooling towers ~110-150 m, a coal pile, a switchyard].
  {
    const coal = rng() < 0.6, W = 700, D = 460;
    const ref = facilities.find((f) => f.kind === "refinery");
    const best = waterSite(W, D, 70, ref ? [{ centroid: ref.centroid, keep: 1500 }] : [], (sh, r) => (sh.sea ? 1 : 0) + Math.min(railD(r.c), 4000) / 2000 + Math.abs(edgeDist(r.c) - 1600) / 1500);
    if (best) {
      const { r } = best;
      claim(r, 30);
      const parts = [{ t: "pad", k: "plant", ring: r.ring }];
      const bW = -D / 2;
      parts.push({ t: "box", k: "intake", c: at(r, -60, bW + 10), u: r.u, w: 40, d: 20, h: 6 });
      parts.push({ t: "pad", k: "switchyard", ring: rectRing(at(r, W / 2 - 110, D / 2 - 80), r.u, 160, 110) });
      const posts = [];
      for (let a = W / 2 - 180; a < W / 2 - 40; a += 14) for (let b = D / 2 - 125; b < D / 2 - 35; b += 18) { const p = at(r, a, b); posts.push([p[0], p[1], r.u[0], r.u[1], 1, 0, 0, "pylon"]); }
      parts.push({ t: "inst", k: "frame", at: posts });
      if (coal) {
        parts.push({ t: "box", k: "boiler", c: at(r, -80, bW + 150), u: r.u, w: 80, d: 55, h: 62 });
        parts.push({ t: "box", k: "turbine", c: at(r, -80, bW + 85), u: r.u, w: 130, d: 36, h: 28 });
        parts.push({ t: "box", k: "unit", c: at(r, 10, bW + 155), u: r.u, w: 60, d: 40, h: 30 });   // the scrubber
        parts.push({ t: "stack", k: "chimney", c: at(r, 70, bW + 160), r: 8, r2: 5, h: 170 });
        const nCt = 1 + (rng() < 0.6 ? 1 : 0);
        for (let i = 0; i < nCt; i++) parts.push({ t: "ctower", k: "ctower", c: at(r, -240 + i * 115, bW + 300), r: 46, h: 120, steam: true });
        parts.push({ t: "mound", k: "coal", c: at(r, 160, bW + 300), u: r.u, w: 230, d: 70, h: 14 });
        if (rail) parts.push({ t: "line", k: "track", pts: [at(r, W / 2 + 40, bW + 360), at(r, -60, bW + 360)], w: 3.2 });
      } else {
        parts.push({ t: "box", k: "turbine", c: at(r, -60, bW + 110), u: r.u, w: 110, d: 34, h: 24 });
        for (let i = 0; i < 2; i++) {
          parts.push({ t: "box", k: "boiler", c: at(r, -110 + i * 70, bW + 175), u: r.v, w: 48, d: 22, h: 30 });
          parts.push({ t: "stack", k: "stack", c: at(r, -110 + i * 70, bW + 210), r: 3.6, h: 55 });
        }
        parts.push({ t: "box", k: "cooling", c: at(r, -40, bW + 300), u: r.u, w: 160, d: 22, h: 14, fans: 10, steam: true });
      }
      add$("power", pickName(PLACES, (p) => `${p} ${coal ? "Generating Station" : "Energy Center"}`), r, parts, { fuel: coal ? "coal" : "gas" });
    }
  }

  // ---------------- THE AIRPORT [S: a non-hub commercial-service airport of a ~120k county (CMI, BMI, SPI): one
  // 7,500-9,000 ft runway, 150 ft wide, a parallel taxiway ~180 m off, a terminal of a few gates, GA hangars].
  // Flat open ground well out from town, never over water, clear of the plants' stacks; near a highway [S].
  {
    const L = 2300 + Math.round(rng() * 450 / 50) * 50, W = L + 600, D = 1000;
    const plants = facilities.filter((f) => f.kind === "refinery" || f.kind === "power");
    // runway headings in the world frame: north-south and the prevailing south-west wind are most common [S: Midwest]
    const dirs = [[0, 1], [1, 0], norm([1, 1]), norm([1, -1])];
    let best = null;
    for (const c of scatter(500, 600, B)) for (const u of dirs) {
      const r = R(c, u, W, D);
      if (!clear(r, BLOCK, 30)) continue;
      if (plants.some((f) => dist(f.centroid, c) < 2500)) continue;
      const dc = dist(c, M.centre);
      let hw = Infinity; for (const rd of roads) hw = Math.min(hw, distToLine(c, rd.pts));
      const sc = Math.abs(dc - 7000) / 1500 + Math.min(hw, 5000) / 1500 + (u === dirs[0] ? 0 : 0.3) + rng() * 0.8;
      if (!best || sc < best.sc) best = { sc, r };
    }
    if (best) {
      const { r } = best;
      claim(r, 30);
      // the terminal faces the nearer road
      let tv = 1, hwBest = Infinity;
      for (const sd of [1, -1]) { const q = at(r, 0, sd * D / 2); for (const rd of roads) { const d = distToLine(q, rd.pts); if (d < hwBest) { hwBest = d; tv = sd; } } }
      const B$ = (b) => tv * b;
      const parts = [{ t: "pad", k: "airfield", ring: r.ring }];
      const bR = -D / 2 + 260, bT = bR + 180;
      parts.push({ t: "pad", k: "runway", ring: rectRing(at(r, 0, B$(bR)), r.u, L, 45), u: r.u, len: L });
      parts.push({ t: "pad", k: "taxiway", ring: rectRing(at(r, 0, B$(bT)), r.u, L - 120, 23) });
      // the connectors run from the runway's edge to the taxiway's, not over either
      for (const f of [-0.5, -0.25, 0, 0.25, 0.5]) parts.push({ t: "pad", k: "taxiway", ring: rectRing(at(r, f * (L - 140), B$((bR + 22.5 + bT - 11.5) / 2)), r.v, bT - bR - 34, 23) });
      const aT = (rng() - 0.5) * L * 0.4, bA = bT + 12 + 75;
      parts.push({ t: "pad", k: "apron", ring: rectRing(at(r, aT, B$(bA)), r.u, 460, 150) });
      const bTerm = bA + 75 + 22;
      parts.push({ t: "box", k: "terminal", c: at(r, aT, B$(bTerm)), u: r.u, w: 170, d: 44, h: 13 });
      parts.push({ t: "box", k: "terminal", c: at(r, aT - 40, B$(bTerm + 8)), u: r.u, w: 70, d: 30, h: 19 });
      parts.push({ t: "tower", k: "control", c: at(r, aT + 135, B$(bTerm + 6)), r: 4.5, h: 40 });
      parts.push({ t: "pad", k: "lot", ring: rectRing(at(r, aT, B$(bTerm + 22 + 60)), r.u, 220, 100) });
      // regional jets nose-in at four gates, a fifth on the apron [S: CRJ-900 / E175, ~36 m long, 25 m span]
      const planes = [];
      for (let g = 0; g < 4; g++) if (g < 3 || rng() < 0.6) {
        const p = at(r, aT - 105 + g * 70, B$(bTerm - 22 - 24));
        parts.push({ t: "box", k: "jetbridge", c: at(r, aT - 105 + g * 70 + 8, B$(bTerm - 22 - 7)), u: r.v, w: 14, d: 3.2, h: 4.5, z0: 0.5 });
        planes.push([p[0], p[1], ...mul(r.v, tv), 1, Math.floor(rng() * 3), 0, "jet"]);
      }
      { const p = at(r, aT + 170, B$(bA - 20)); planes.push([p[0], p[1], ...r.u, 1, Math.floor(rng() * 3), 0, "jet"]); }
      // one holding short of the runway
      { const p = at(r, -L / 2 + 140, B$(bT)); planes.push([p[0], p[1], ...r.u, 1, Math.floor(rng() * 3), 0, "jet"]); }
      // general aviation: hangars and a ramp of light singles and twins [S: ~8-12 m span]
      const aG = aT + (aT < 0 ? 560 : -560);
      parts.push({ t: "pad", k: "apron", ring: rectRing(at(r, aG, B$(bT + 12 + 55)), r.u, 300, 110) });
      for (let h = 0; h < 4; h++) parts.push({ t: "box", k: "hangar", c: at(r, aG - 120 + h * 80, B$(bT + 12 + 110 + 30)), u: r.u, w: 60, d: 50, h: 13 });
      for (let i = 0; i < 9; i++) if (rng() < 0.75) { const p = at(r, aG - 130 + i * 32, B$(bT + 12 + 40 + (i % 2) * 22)); planes.push([p[0], p[1], ...mul(r.v, -tv), 1, Math.floor(rng() * 4), 0, "ga"]); }
      parts.push({ t: "inst", k: "plane", at: planes });
      // the access road to the nearest road
      {
        const a = at(r, aT, B$(D / 2));
        let q = null, dq = Infinity;
        for (const rd of roads) for (const p of resample(rd.pts, 50)) { const d = dist(a, p); if (d < dq) { dq = d; q = p; } }
        if (q && dq < 3500) parts.push({ t: "line", k: "road", pts: [at(r, aT, B$(bTerm + 22 + 110)), a, q], w: 12 });
      }
      const heading = (u) => { const deg = ((Math.atan2(u[0], -u[1]) * 180) / Math.PI + 360) % 180; const n = Math.round(deg / 10) || 18; return `${String(n).padStart(2, "0")}/${String(n + 18).padStart(2, "0")}`; };
      add$("airport", pickName(BIRDS, (b) => `${b} Field`), r, parts, { runwayM: L, runway: heading(r.u) });
    }
  }

  // ---------------- THE METALS WORKS on the main line [S: an electric-arc mini-mill (melt shop ~250-300 m, a
  // rolling mill 600-800 m in line, 20-40 m tall) or an aluminium smelter (3-4 potlines ~1 km long), both
  // shipping and receiving by rail]. An aluminium smelter wants cheap power: near the station if there is one.
  {
    const steel = rng() < 0.65, W = steel ? 1300 : 1150, D = steel ? 420 : 380;
    const pw = facilities.find((f) => f.kind === "power"), air = facilities.find((f) => f.kind === "airport");
    let best = null;
    const tryAt = (c, u) => {
      const r = R(c, u, W, D);
      if (!clear(r, BLOCK, 25)) return;
      if (air && dist(air.centroid, c) < 2600) return;
      const sc = Math.min(railD(c), 3000) / 600 + (!steel && pw ? dist(pw.centroid, c) / 3000 : 0) + Math.max(0, 700 - edgeDist(c)) / 300 + rng() * 0.7;
      if (!best || sc < best.sc) best = { sc, r };
    };
    if (rail) {
      const rAt = sampler(rail.pl), L = rAt.L;
      for (let s = 400; s < L - 400; s += 120) {
        const P = rAt(s), u = norm(sub(rAt(s + 80), rAt(s - 80)));
        for (const sd of [1, -1]) tryAt(add(P, mul(perp(u), sd * (D / 2 + 70))), u);
      }
    }
    if (!best) for (const c of scatter(400, 400, B)) for (const u of AX) tryAt(c, u);
    if (best) {
      const { r } = best;
      claim(r, 30);
      const parts = [{ t: "pad", k: "plant", ring: r.ring }];
      // which side faces the main line
      const sideToRail = rail && distToLine(at(r, 0, D / 2), rail.pl) < distToLine(at(r, 0, -D / 2), rail.pl) ? 1 : -1;
      const B$ = (b) => sideToRail * b;
      if (steel) {
        parts.push({ t: "box", k: "melt", c: at(r, -W / 2 + 190, B$(-20)), u: r.u, w: 280, d: 70, h: 38 });
        parts.push({ t: "box", k: "shed", c: at(r, -W / 2 + 190 + 140 + 390, B$(-20)), u: r.u, w: 760, d: 48, h: 22 });
        parts.push({ t: "box", k: "shed", c: at(r, 120, B$(-120)), u: r.u, w: 420, d: 60, h: 16 });
        parts.push({ t: "box", k: "unit", c: at(r, -W / 2 + 190, B$(-95)), u: r.u, w: 90, d: 34, h: 18 });   // the baghouse
        for (let i = 0; i < 2; i++) parts.push({ t: "stack", k: "stack", c: at(r, -W / 2 + 150 + i * 70, B$(-125)), r: 3.2, h: 55 });
        parts.push({ t: "pad", k: "scrap", ring: rectRing(at(r, -W / 2 + 190, B$(110)), r.u, 300, 150) });
        for (let i = 0; i < 7; i++) parts.push({ t: "mound", k: "scrap", c: at(r, -W / 2 + 70 + i * 40 + rng() * 10, B$(95 + rng() * 40)), u: r.u, w: 28 + rng() * 14, d: 22 + rng() * 10, h: 7 + rng() * 5 });
      } else {
        for (let i = 0; i < 3; i++) parts.push({ t: "box", k: "potline", c: at(r, 60, B$(-120 + i * 62)), u: r.u, w: 980, d: 28, h: 11 });
        parts.push({ t: "box", k: "shed", c: at(r, -W / 2 + 90, B$(-60)), u: r.v, w: 200, d: 80, h: 20 });   // the carbon plant
        for (let i = 0; i < 4; i++) parts.push({ t: "cyl", k: "silo", c: at(r, -W / 2 + 60 + i * 30, B$(120)), r: 11, h: 32 });
        parts.push({ t: "stack", k: "stack", c: at(r, -W / 2 + 160, B$(110)), r: 4, h: 110 });
        parts.push({ t: "pad", k: "switchyard", ring: rectRing(at(r, W / 2 - 100, B$(130)), r.u, 160, 90) });
      }
      // the spur off the main line, along the works' rail side, with cars on it
      const cars = [];
      for (const off of [D / 2 - 28, D / 2 - 18]) {
        parts.push({ t: "line", k: "track", pts: [at(r, -W / 2 - 60, B$(off)), at(r, W / 2 - 40, B$(off))], w: 3.2 });
        for (let s = -W / 2 + 40; s < W / 2 - 80; s += 17.5) if (rng() < 0.55) { const p = at(r, s, B$(off)); cars.push([p[0], p[1], ...r.u, 1, Math.floor(rng() * 4), 0, steel ? "gondola" : "hopper"]); }
      }
      parts.push({ t: "inst", k: "railcar", at: cars });
      parts.push({ t: "box", k: "office", c: at(r, W / 2 - 60, B$(-D / 2 + 40)), u: r.u, w: 46, d: 20, h: 9 });
      add$("metals", steel ? pickName(SURNAMES, (s) => `${s} Works`) : pickName(PLACES, (p) => `${p} Aluminum`), r, parts, { metal: steel ? "steel" : "aluminum" });
    }
  }

  // ---------------- QUARRIES out at the edge [S: a limestone or sand-and-gravel pit of 20-60 ha, benches 10-15 m,
  // 30-60 m deep, a crusher, conveyors and stockpiles; the concrete and glass makers' feedstock]
  {
    const nQ = rng() < 0.55 ? 2 : 1;
    for (let q = 0; q < nQ; q++) {
      const lime = q === 0 ? rng() < 0.6 : rng() < 0.4, W = 1100, D = 800;
      let best = null;
      for (const c of scatter(400, B * 0.5, B)) for (const u of AX) {
        const r = R(c, u, W, D);
        if (!clear(r, BLOCK, 30)) continue;
        if (facilities.some((f) => dist(f.centroid, c) < 1800)) continue;
        // a gravel pit lies by the river (the old terraces); limestone where the bedrock is near the surface
        const sc = (lime ? 0 : Math.min(wetAt(c), 4000) / 800) - edgeDist(c) / 2000 + rng();
        if (!best || sc < best.sc) best = { sc, r };
      }
      if (!best) break;
      const { r } = best;
      claim(r, 30);
      const parts = [{ t: "pad", k: lime ? "quarry" : "gravel", ring: r.ring }];
      const a = 280 + rng() * 80, b = 190 + rng() * 60;
      parts.push({ t: "pit", k: lime ? "lime" : "gravel", c: at(r, -130, 0), u: r.u, a, b, steps: lime ? 4 + Math.floor(rng() * 2) : 2, bench: lime ? 12 : 8, inset: lime ? 26 : 34, pond: !lime });
      const pc = at(r, W / 2 - 170, (rng() - 0.5) * 200);
      parts.push({ t: "box", k: "crusher", c: pc, u: r.u, w: 34, d: 22, h: 24 });
      for (let i = 0; i < 5; i++) {
        const sp = add(pc, add(mul(r.u, -40 + (i % 3) * 70), mul(r.v, (i < 3 ? 1 : -1) * 120)));
        parts.push({ t: "cone", k: lime ? "stone" : "sand", c: sp, r: 18 + rng() * 12, h: 10 + rng() * 6 });
        parts.push({ t: "rack", k: "conveyor", pts: [pc, sp], w: 2.5, h: 10 });
      }
      parts.push({ t: "line", k: "haul", pts: [at(r, -130 + a * 0.7, b * 0.55), pc], w: 12 });
      const trucks = [];
      for (let i = 0; i < 4; i++) { const p = at(r, -130 + (rng() - 0.5) * a * 0.6, (rng() - 0.5) * b * 0.5); trucks.push([p[0], p[1], ...norm([rng() - 0.5, rng() - 0.5]), 1, 0, 0, "haul"]); }
      parts.push({ t: "inst", k: "truck", at: trucks });
      add$("quarry", lime ? pickName(PLACES, (p) => `${p} Quarry`) : pickName(PLACES, (p) => `${p} Sand & Gravel`), r, parts, { rock: lime ? "limestone" : "gravel", pitDepthM: (lime ? 12 : 8) * (lime ? 4 : 2) });
    }
  }

  // ---------------- FARMS, AN ORCHARD AND A TIMBER TRACT at the outer edge, squared to the survey: whole sections
  // (640 acres) of corn and beans with a farmstead, a quarter-section orchard, a section of managed woods
  // [S: Illinois grain farms of 1-2,000 acres farm several sections; orchards 40-160 acres]
  const { ox, oy } = M.survey;
  const sectionAt = (i, j, fx = 1, fy = 1) => {
    const x0 = ox + i * MILE, y0 = oy + j * MILE, ins = 18;
    const c = [x0 + (fx * MILE) / 2, y0 + (fy * MILE) / 2];
    return R(c, [1, 0], fx * MILE - 2 * ins, fy * MILE - 2 * ins);
  };
  const sectionCands = [];
  for (let i = Math.floor((X0 - ox) / MILE); i * MILE + ox < X1; i++) for (let j = Math.floor((X0 - oy) / MILE); j * MILE + oy < X1; j++) sectionCands.push([i, j]);
  // the biggest holding that fits, out where the country is open: a whole section if one is free, else
  // half of one, else a quarter
  const outer = (sizes, minOut, score) => {
    for (const [fx, fy] of sizes) {
      let best = null;
      const offs = [];
      for (let hx = 0; hx < 1; hx += 0.5) for (let hy = 0; hy < 1; hy += 0.5) if ((fx < 1 || hx === 0) && (fy < 1 || hy === 0)) offs.push([hx, hy]);
      for (const [i, j] of sectionCands) for (const [hx, hy] of offs) {
        const r = sectionAt(i + hx, j + hy, fx, fy);
        if (edgeDist(r.c) < minOut) continue;
        if (!clear(r, BLOCK, 10)) continue;
        const sc = score(r) + rng() * 1.2;
        if (!best || sc < best.sc) best = { sc, r };
      }
      if (best) { claim(best.r, 10); return best.r; }
    }
    return null;
  };
  const CROPS = ["corn", "soy", "corn", "soy", "wheat", "hay"];
  const farmstead = (parts, r, corner) => {
    const c = at(r, corner[0] * (r.w / 2 - 70), corner[1] * (r.d / 2 - 70));
    parts.push({ t: "pad", k: "farmyard", ring: rectRing(c, r.u, 120, 110) });
    parts.push({ t: "box", k: "house", c: add(c, [-35, -30]), u: r.u, w: 13, d: 10, h: 7, roof: "gable" });
    parts.push({ t: "box", k: "barn", c: add(c, [15, -25]), u: r.v, w: 34, d: 18, h: 11, roof: "gable" });
    parts.push({ t: "box", k: "machine", c: add(c, [10, 30]), u: r.u, w: 46, d: 22, h: 8 });
    for (let i = 0; i < 4; i++) parts.push({ t: "cyl", k: "bin", c: add(c, [-45 + i * 21, 15]), r: 8, h: 13, cap: true });
    parts.push({ t: "cyl", k: "silo", c: add(c, [42, -5]), r: 4.5, h: 21, cap: true });
    parts.push({ t: "scatter", k: "tree", ring: rectRing(add(c, [-40, -45]), r.u, 50, 22), step: 9 });
  };
  for (let f = 0; f < 2; f++) {
    const r = outer(f === 0 && rng() < 0.4 ? [[2, 1], [1, 1], [1, 0.5], [0.5, 1]] : [[1, 1], [1, 0.5], [0.5, 1]], B * 0.45, (r) => -edgeDist(r.c) / 1500);
    if (!r) break;
    const parts = [];
    const rowsU = rng() < 0.5 ? [1, 0] : [0, 1];
    // four quarter fields, each its own crop
    for (const [qa, qb] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const c = at(r, (qa * r.w) / 4, (qb * r.d) / 4);
      parts.push({ t: "pad", k: "crop:" + CROPS[Math.floor(rng() * CROPS.length)], ring: rectRing(c, r.u, r.w / 2 - 14, r.d / 2 - 14), rows: rowsU });
    }
    farmstead(parts, r, [rng() < 0.5 ? -1 : 1, rng() < 0.5 ? -1 : 1]);
    add$("farm", pickName(SURNAMES, (s) => `${s} Farms`), r, parts, { acres: Math.round(r.w * r.d / 4046.856) });
  }
  {
    const r = outer([[0.5, 0.5]], B * 0.35, (r) => -edgeDist(r.c) / 2500 + Math.min(wetAt(r.c), 3000) / 3000);
    if (r) {
      const parts = [{ t: "pad", k: "orchard", ring: r.ring }];
      const rowsU = rng() < 0.5 ? [1, 0] : [0, 1];
      parts.push({ t: "rows", k: "orchard", c: at(r, 0, 20), u: rowsU, w: r.w - 50, d: r.d - 90, along: 8, across: 11 });
      const c = at(r, 0, -r.d / 2 + 35);
      parts.push({ t: "box", k: "packing", c, u: r.u, w: 60, d: 26, h: 8 });
      parts.push({ t: "box", k: "barn", c: add(c, [70, 0]), u: r.u, w: 24, d: 14, h: 9, roof: "gable" });
      parts.push({ t: "box", k: "house", c: add(c, [-70, 4]), u: r.u, w: 12, d: 10, h: 7, roof: "gable" });
      add$("orchard", pickName(PLACES, (p) => `${p} Orchards`), r, parts, { acres: Math.round(r.w * r.d / 4046.856) });
    }
  }
  {
    const r = outer([[1, 1], [1, 0.5], [0.5, 1], [0.5, 0.5]], B * 0.4, (r) => -edgeDist(r.c) / 1200 + Math.min(wetAt(r.c), 3000) / 4000);
    if (r) {
      const parts = [{ t: "pad", k: "woods", ring: r.ring }];
      // a cut block being logged this year and the landing where the logs wait for the trucks
      const cut = rectRing(at(r, r.w / 4, -r.d / 4), r.u, r.w / 2 - 80, r.d / 2 - 120);
      parts.push({ t: "pad", k: "clearcut", ring: cut });
      parts.push({ t: "scatter", k: "tree", ring: r.ring, step: 24, hole: cut });
      parts.push({ t: "line", k: "haul", pts: [at(r, -r.w / 2, -r.d / 4), at(r, r.w / 2 - 60, -r.d / 4)], w: 7 });
      const logs = [];
      for (let i = 0; i < 8; i++) { const p = at(r, r.w / 4 - 100 + i * 14, -r.d / 4 + 22); logs.push([p[0], p[1], ...r.v, 1, 0, 0, "logs"]); }
      parts.push({ t: "inst", k: "logs", at: logs });
      add$("forest", pickName(SURNAMES, (s) => `${s} Timberlands`), r, parts, { acres: Math.round(r.w * r.d / 4046.856) });
    }
  }

  // ---------------- THE SURVEY CARRIES ON: section-line roads every mile [S: PLSS], stopping at the window (its
  // own roads take over), the water, the sea and the facilities' fences.
  const SEC_BLOCK = WATER | SEA | FAC;
  const secRun = (a, b) => {
    let run = [];
    const flush = () => { if (run.length > 6) roads.push({ pts: [run[0], run.at(-1)], w: 14, kind: "section" }); run = []; };
    for (const p of resample([a, b], 25)) { const k = idx(p); if (k < 0 || inWindow(p, -0.5) || (grid[k] & SEC_BLOCK)) flush(); else run.push(p); }
    flush();
  };
  for (let x = ox + Math.ceil((X0 - ox) / MILE) * MILE; x < X1; x += MILE) secRun([x, X0], [x, X1]);
  for (let y = oy + Math.ceil((X0 - oy) / MILE) * MILE; y < X1; y += MILE) secRun([X0, y], [X1, y]);
  for (const rd of roads) if (rd.kind === "section") stampLine(rd.pts, 8, ROAD);

  // ---------------- THE FIELDS: every quarter-quarter (40 acres) of open belt gets a crop, a pasture or a woodlot
  // [S: Illinois cropland ~55% corn / ~40% soybeans by area, a little wheat and hay; woodlots ~5%]
  const fields = [];
  {
    const q = MILE / 4;
    for (let x = ox + Math.floor((X0 - ox) / q) * q; x < X1; x += q) for (let y = oy + Math.floor((X0 - oy) / q) * q; y < X1; y += q) {
      const x0 = Math.max(X0, x) + 7, y0 = Math.max(X0, y) + 7, x1 = Math.min(X1, x + q) - 7, y1 = Math.min(Y1(), y + q) - 7;
      if (x1 - x0 < 120 || y1 - y0 < 120) continue;
      let ok = true;
      for (let i = 0; i <= 4 && ok; i++) for (let j = 0; j <= 4 && ok; j++) {
        const p = [x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * j) / 4], k = idx(p);
        if (k < 0 || inWindow(p, 6) || (grid[k] & (WATER | SEA | FAC | RAIL)) || isSea(p)) ok = false;
      }
      if (!ok) continue;
      const n = nz(x0 + 500, y0 + 500), r0 = rng();
      const k = r0 < 0.05 ? "woods" : r0 < 0.09 ? "hay" : r0 < 0.12 ? "wheat" : r0 < 0.14 ? "fallow" : n < 0.5 ? (r0 < 0.6 ? "corn" : "soy") : (r0 < 0.5 ? "corn" : "soy");
      fields.push({ ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], k, rows: rng() < 0.5 ? [1, 0] : [0, 1] });
    }
  }
  function Y1() { return X1; }

  // ---------------- THE LAND: the drawn country (the window's own ground excluded), and its outline with the
  // window's for the sea to stop at
  let land, shoreline;
  if (coastY) {
    const coast = []; for (let x = X1; x >= X0; x -= 40) coast.push([x, coastY(x)]);
    const yl = coastY(0), yr = coastY(S), xs = coast.filter((p) => p[0] > 0 && p[0] < S);
    // the U round the window's landward sides, down to the shore either side
    const right = coast.filter((p) => p[0] >= S), left = coast.filter((p) => p[0] <= 0);
    land = [[[X0, X0], [X1, X0], ...right, [S, yr], [S, 0], [0, 0], [0, yl], ...left]];
    shoreline = [[X0, X0], [X1, X0], ...right, ...xs, ...left];
  } else {
    land = [[[X0, X0], [X1, X0], [X1, X1], [X0, X1]], [[0, 0], [0, S], [S, S], [S, 0]]];
    shoreline = [[X0, X0], [X1, X0], [X1, X1], [X0, X1]];
  }

  return {
    facilities,
    hinterland: {
      belt: B,
      extent: [[X0, X0], [X1, X0], [X1, X1], [X0, X1]],
      land: [land],
      shoreline,
      fields,
      water,
      roads,
      rail: rail ? [{ pts: rail.pl, name: railName }] : [],
    },
  };
}
