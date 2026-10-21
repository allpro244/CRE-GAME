// EVERYTHING AROUND THE OLD CITY (spike export-unreal.mjs: the interchange
// strip, placePockets, gradientNeighbourhoods, placeFringe, the forest belt).
//
// All of it in the canonical frame. Sizes are typical of the type [S,
// approximate]; probabilities and budgets are the spike's shape parameters [K]
// or the owner's design calls [O], labelled where they are set. How far the
// region has grown (the house budgets) is not a fact: in a later phase the
// growth sim owns it.
import { MILE, ACRE, makeRng, makeNoise, add, sub, mul, dist, norm, perp, resample, rectRing, CELL } from "./util.mjs";
import { tractShare, RINGS } from "./land.mjs";
import { platFor, ERA_YEARS } from "./plats.mjs";

const OUTER_HOUSES = 600;   // [O] houses in the outer subdivisions at the opening (spike: ~2,000 in all with the inner blocks)

export function placeOuter(M) {
  const G = M.G, St = M.story, rS = St.rS, rng = makeRng("outer:" + M.seed);
  const R = (a, b) => rng.range(a, b);
  const town = (k) => M.townMask[k] || M.townL[k];
  M.free = (p) => { const k = G.idx(p); return k >= 0 && !M.water[k] && !M.flood[k] && !town(k) && !M.hwL[k]; };
  M.taken = G.layer();       // where a pocket, a lot or a subdivision already is
  M.lotL = G.layer();        // the ordinary and rural lots themselves, cell by cell
  const lots = [];           // { kind, name, cls, year, rects:[{c,u,w,d,kind,z,cls}], u, anchor, tenure? }
  const stampRect = (L, ring) => {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys) / CELL); y <= Math.floor(Math.max(...ys) / CELL); y++)
      for (let x = Math.floor(Math.min(...xs) / CELL); x <= Math.floor(Math.max(...xs) / CELL); x++) {
        if (x < 0 || y < 0 || x >= G.W || y >= G.W) continue;
        const c = [(x + 0.5) * CELL, (y + 0.5) * CELL];
        if (insideConvex(c, ring)) L[y * G.W + x] = 1;
      }
  };

  // ---------------- the interchange strip (1985-2015): big boxes behind their parking at the first interchange out
  const c = M.centre;
  const ixs = M.highways.filter((h) => h.kind === "interstate").flatMap((h) => h.ix.filter((x) => !x.sys)).map((x) => ({ p: x.p, d: dist(x.p, c) })).filter((x) => x.d > 900 && x.d < 2800).sort((a, b) => a.d - b.d);
  if (ixs.length) {
    const I = ixs[0].p; let n = 0;
    for (const d of [140, 240, 340]) for (let a = 0; a < 2 * Math.PI && n < 8; a += 0.35) {
      const p = add(I, [d * Math.cos(a), d * Math.sin(a)]);
      if (!M.free(p) || M.isSea(p) || lots.some((s) => s.kind === "box" && dist(s.anchor, p) < 105)) continue;
      const w = R(50, 90), dd = R(35, 60), toI = norm(sub(I, p));
      const side = Math.abs(toI[0]) > Math.abs(toI[1]) ? [Math.sign(toI[0]), 0] : [0, Math.sign(toI[1])];
      const u = side[0] ? [0, 1] : [1, 0], lotDepth = 45;
      const box = { c: sub(p, mul(side, lotDepth / 2)), u, w, d: dd, kind: "bldg", z: 650, cls: "retail" };
      const park = { c: add(p, mul(side, dd / 2)), u, w: w + 10, d: lotDepth, kind: "pave" };
      const all = [box, park].flatMap((r) => rectRing(r.c, r.u, r.w, r.d));
      if (!all.every((q) => M.free(q))) continue;
      lots.push({ kind: "box", name: "Interchange strip store", cls: "retail", year: Math.round(R(1985, 2015)), rects: [box, park], anchor: p, u });
      n++;
      G.disk(M.taken, p, 90);
      for (const r of [box, park]) stampRect(M.lotL, rectRing(r.c, r.u, r.w, r.d));
    }
  }

  // ---------------- pockets out in the region, each laid against an arterial past its right-of-way
  const okPt = (p) => { const k = G.idx(p); return k >= 0 && M.free(p) && !M.isSea(p) && !M.taken[k] && !(M.phase && M.phase[k]); };
  const tryPlace = (anchor, u, pieces, meta) => {
    for (const sd of [1, -1]) {
      const v = mul(perp(u), sd);
      const rects = pieces.map((pc) => ({ ...pc, u, c: add(add(anchor, mul(u, pc.a)), mul(v, 12 + pc.o + pc.d / 2)) }));
      if (!rects.flatMap((r) => rectRing(r.c, u, r.w, r.d).concat([r.c])).every(okPt)) continue;
      if (lots.some((x) => x.gap !== undefined && dist(x.anchor, anchor) < Math.min(meta.gap ?? 500, x.gap ?? 500))) return false;
      for (const r of rects) { G.disk(M.taken, r.c, Math.max(r.w, r.d) / 2 + 15); stampRect(M.lotL, rectRing(r.c, u, r.w, r.d)); }
      lots.push({ ...meta, gap: meta.gap ?? 500, anchor, u, rects }); return true;
    }
    return false;
  };
  const pts = [];
  for (const pl of M.oldRoads.concat(M.secRoads)) {
    const r = resample(pl, 150);
    for (let i = 1; i < r.length - 1; i++) { const k = G.idx(r[i]); pts.push({ p: r[i], u: norm(sub(r[i + 1], r[i - 1])), rs: rS(r[i]), hw: k >= 0 && !!St.hwNear[k], old: k >= 0 && !!St.oldNear[k] }); }
  }
  const ix = M.interchanges.map((x) => x.p);
  const nearIx = (p, d) => ix.some((q) => dist(p, q) < d);
  const shuffle = (a) => a.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const place = (n, filter, make) => { let k = 0; for (const cnd of shuffle(pts.filter(filter))) { if (k >= n) break; if (tryPlace(cnd.p, cnd.u, ...make())) k++; } return k; };
  // distribution centres by the interchanges (1990-2020): 180-260 x 90-130 m, 10-15 m clear, truck court
  // light industry and flex sheds along the highway and the roads off its interchanges (1965-2015):
  // 50-110 x 30-55 m, 7-9 m clear, a yard and a truck dock in front [S, typical flex/light-industrial]
  place(4 + (rng() < 0.5 ? 1 : 0), (q) => q.rs > 800 && (q.hw || nearIx(q.p, 1600)), () => { const w = R(50, 110), d = R(30, 55); return [[{ a: 0, o: 0, w: w + 10, d: 30, kind: "pave" }, { a: 0, o: 30, w, d, kind: "bldg", z: Math.round(R(700, 900)), cls: "industrial" }], { kind: "pocket", name: "Light industrial building", cls: "industrial", year: Math.round(R(1965, 2015)), gap: 220 }]; });
  place(2 + (rng() < 0.5 ? 1 : 0), (q) => q.rs > 900 && nearIx(q.p, 1500), () => { const w = R(180, 260), d = R(90, 130); return [[{ a: 0, o: 0, w: w + 20, d: 50, kind: "pave" }, { a: 0, o: 50, w, d, kind: "bldg", z: Math.round(R(1000, 1500)), cls: "industrial" }], { kind: "pocket", name: "Distribution centre", cls: "industrial", year: Math.round(R(1990, 2020)) }]; });
  // strip centres on the old roads and the highway (1960-2005): 80-140 m long, 22 m deep, parking in front
  place(3 + (rng() < 0.5 ? 1 : 0), (q) => q.rs > 1000 && q.rs < 2800 && (q.old || q.hw), () => { const L = R(80, 140); return [[{ a: 0, o: 0, w: L, d: 35, kind: "pave" }, { a: 0, o: 35, w: L, d: 22, kind: "bldg", z: 520, cls: "retail" }], { kind: "pocket", name: "Strip centre", cls: "retail", year: Math.round(R(1960, 2005)) }]; });
  // a gas station and diner at a country crossroads (1935-65)
  place(1, (q) => q.rs > 1800 && !q.hw, () => [[{ a: 0, o: 0, w: 45, d: 30, kind: "pave" }, { a: -6, o: 30, w: 16, d: 11, kind: "bldg", z: 450, cls: "retail" }, { a: 34, o: 0, w: 26, d: 16, kind: "pave" }, { a: 34, o: 16, w: 18, d: 12, kind: "bldg", z: 450, cls: "retail" }], { kind: "pocket", name: "Gas station and diner", cls: "retail", year: Math.round(R(1935, 1965)) }]);
  // a farm co-op grain elevator on a country road (1910-50): three ~35 m silos and a shed
  place(1, (q) => q.rs > 2200 && !q.hw, () => [[{ a: 0, o: 0, w: 70, d: 45, kind: "pave" }, { a: -22, o: 45, w: 12, d: 12, kind: "bldg", z: 3600, cls: "industrial" }, { a: -8, o: 45, w: 12, d: 12, kind: "bldg", z: 3600, cls: "industrial" }, { a: 6, o: 45, w: 12, d: 12, kind: "bldg", z: 3200, cls: "industrial" }, { a: 32, o: 45, w: 36, d: 18, kind: "bldg", z: 700, cls: "industrial" }], { kind: "pocket", name: "Farm co-op grain elevator", cls: "industrial", year: Math.round(R(1910, 1950)) }]);
  // a small business park by the highway (1975-2000): three offices of 2-3 floors
  place(1, (q) => q.rs > 1000 && q.rs < 3200 && (q.hw || nearIx(q.p, 1500)), () => [[{ a: 0, o: 0, w: 160, d: 40, kind: "pave" }, ...[-55, 0, 55].map((a) => ({ a, o: 40, w: 38, d: 24, kind: "bldg", z: 355 * (2 + (rng() < 0.5 ? 1 : 0)), cls: "office" }))], { kind: "pocket", name: "Business park", cls: "office", year: Math.round(R(1975, 2000)) }]);
  // a church and school with its playing field (1900-60): civic, not a market
  place(1, (q) => q.rs > 900 && q.rs < 2400, () => [[{ a: -45, o: 0, w: 50, d: 30, kind: "pave" }, { a: -45, o: 30, w: 70, d: 35, kind: "bldg", z: 760, cls: "office" }, { a: 40, o: 8, w: 18, d: 32, kind: "bldg", z: 1300, cls: "office" }, { a: -10, o: 70, w: 100, d: 60, kind: "park" }], { kind: "civic", name: "Church and school", cls: "office", year: Math.round(R(1900, 1960)), tenure: "civic" }]);

  // ---------------- the subdivisions: tracts platted, built out from the city side, phase by phase
  const nearHw = St.hwNear;
  const ok = (p) => { const k = G.idx(p); return k >= 0 && M.free(p) && !M.taken[k]; };
  const cands = [];
  for (const t of M.tracts) {
    t.buildable = tractShare(G, t, (k) => !M.water[k] && !M.flood[k] && !town(k));
    t.landShare = tractShare(G, t, (k) => !M.water[k] && !M.isSea(G.ctr(k)));
    const k = G.idx(t.c);
    if (t.buildable >= 0.5 && k >= 0 && M.cityBank[k] && rS(t.c) < 3500) cands.push(t);
  }
  const roadBearing = (t) => {
    // a plat laid out along an old road takes the road's bearing; otherwise the survey's
    let best = null;
    for (const r of M.oldRoads) for (let i = 0; i + 1 < r.length; i += 3) {
      const d = dist(r[i], t.c);
      if (d < 260 && (!best || d < best.d)) best = { d, v: norm(sub(r[Math.min(r.length - 1, i + 3)], r[i])) };
    }
    return best ? (Math.atan2(best.v[1], best.v[0]) * 180) / Math.PI : undefined;
  };
  const waterNear = (t) => { let b = null; for (const p of M.river.pts) if (!b || dist(p, t.c) < dist(b, t.c)) b = p; return b; };
  // LOT SIZE GROWS WITH DISTANCE, continuing the town's own gradient past its edge (owner): a plat's lots
  // are sized to ~9,000 sf at 1 km from the landing, rising as distance^0.8 (~15,000 sf at 2 km, ~21,000
  // at 3 km) — the falling price of land outward, which every US metro's lot-size gradient shows; the
  // exponent is a shape choice [K] matched to the town's edge lots so there is no step at the seam.
  // Each plat varies +-15% around it.
  const ERA_LOT_SF = { prewar: 4600, postwar: 8050, recent: 8700 };   // the era norms platFor cuts at scale 1
  const scaleFor = (t, era) => {
    const d = Math.max(600, dist(t.c, M.centre));
    const target = 9000 * (d / 1000) ** 0.8 * rng.range(0.85, 1.15);
    return +Math.max(0.8, Math.min(3.5, target / ERA_LOT_SF[era])).toFixed(3);
  };
  const all = [];
  for (const t of cands) {
    t.era = rS(t.c) < 2000 && !nearHw[G.idx(t.c)] ? "prewar" : "postwar";
    t.recipe = { seed: M.seed, tract: t.r, era: t.era, id: t.id, bearing: roadBearing(t), waterNear: waterNear(t), scale: scaleFor(t, t.era) };
    t.plat = platFor(t.recipe, ok);
    t.plat.lots.forEach((lot, i) => all.push({ t, i, m: lot.house.c, r: rS(lot.house.c) }));
  }
  all.sort((a, b) => a.r - b.r);
  for (const t of cands) t.keep = new Set();
  M.phase = G.layer();
  // contiguous growth: a house only within ~200 m of the town or of houses already built [K]
  const grow = G.layer();
  for (let k = 0; k < G.N; k++) if (M.townMask[k]) G.disk(grow, G.ctr(k), 200);
  let n = 0;
  for (let added = 1; added && n < OUTER_HOUSES;) {
    added = 0;
    for (const a of all) {
      if (n >= OUTER_HOUSES) break;
      if (a.t.keep.has(a.i) || a.skip) continue;
      if (!grow[G.idx(a.m)]) continue;
      if (rng() < 0.06) { a.skip = true; continue; }   // [K] a few lots left vacant
      a.t.keep.add(a.i); n++;
      G.disk(M.phase, a.m, 55); G.disk(grow, a.m, 200); added++;
    }
  }
  // leapfrog (1995-2020): a developer skips the farm still holding out and builds further out, where the highway or
  // an old road gives access — at most two, 80-250 homes each [O, K]
  const built = all.filter((a) => a.t.keep.has(a.i)), front = Math.max(0, ...built.map((a) => a.r));
  const near = (t) => { const k = G.idx(t.c); return k >= 0 && (St.hwNear[k] || St.oldNear[k]); };
  const gap = (t) => built.every((a) => dist(a.m, t.c) > 450);
  const jumps = cands.filter((t) => t.keep.size === 0 && near(t) && gap(t) && rS(t.c) > front + 300 && rS(t.c) < front + 1600).sort((a, b) => rS(a.c) - rS(b.c));
  let j = 0;
  for (const t of jumps) {
    if (j >= 2) break;
    const recipe = { ...t.recipe, era: "recent", scale: scaleFor(t, "recent") };
    const plat = platFor(recipe, ok);
    const order = plat.lots.map((lot, i) => ({ i, r: rS(lot.house.c) })).sort((a, b) => a.r - b.r).slice(0, 250);
    if (order.length < 80) continue;
    t.era = "recent"; t.recipe = recipe; t.plat = plat; t.leapfrog = true; j++;
    t.keep = new Set(order.map((o) => o.i));
    for (const o of order) G.disk(M.phase, plat.lots[o.i].house.c, 55);
  }
  // no slivers: a tract is a neighbourhood of at least 20 homes, or still a farm
  for (const t of cands) if (t.keep && t.keep.size < 20) { t.era = null; t.keep = null; }
  for (const t of M.tracts) if (!t.keep || !t.keep.size) { t.era = null; t.keep = null; }
  M.phase.fill(0);
  for (const t of M.tracts) if (t.keep) for (const i of t.keep) { const lot = t.plat.lots[i]; G.disk(M.phase, lot.house.c, 45); }
  for (const t of M.tracts) if (t.keep) { const [y0, y1] = ERA_YEARS[t.era]; t.year = Math.round(R(y0, y1)); }

  // ---------------- the exurban fringe: big-lot homes on the roads out, hobby farms, crossroads farmhouses
  const builtD = G.bfs((k) => M.townMask[k] || M.phase[k]);
  const rF = (p) => { const k = G.idx(p); return k < 0 ? Infinity : builtD[k]; };
  const house = (a, o) => [{ a, o, w: 10, d: 14, kind: "house", z: rng() < 0.5 ? 650 : 450 }, { a, o: 0, w: 4, d: o, kind: "pave" }];
  const pts70 = [];
  for (const pl of M.oldRoads.concat(M.secRoads)) { const r = resample(pl, 70); for (let i = 1; i < r.length - 1; i++) pts70.push({ p: r[i], u: norm(sub(r[i + 1], r[i - 1])), d: rF(r[i]) }); }
  // [K] built with probability 0.78 -> 0.08 over the first 600 m past the edge, then 0.05 to 1.6 km
  const fringeP = (d) => d < 600 ? 0.08 + 0.7 * (1 - d / 600) : d < 1600 ? 0.05 : 0;
  for (const cnd of shuffle(pts70)) {
    if (!(cnd.d > 0) || rng() > fringeP(cnd.d)) continue;
    const far = Math.min(1, cnd.d / 600), year = Math.round(1950 + 60 * Math.min(1, far * 0.7 + 0.3 * rng()));
    if (rng() < 0.03 + 0.12 * far) { // a hobby farm, ~5 ac: house, barn, paddock
      tryPlace(cnd.p, cnd.u, [{ a: 0, o: 0, w: 110, d: 170, kind: "lawn" }, ...house(-30, 18), { a: 25, o: 45, w: 18, d: 30, kind: "barn", z: 900 }], { kind: "rural", name: "Hobby farm", cls: "multifamily", year, gap: 40, tenure: "homes", acres: 110 * 170 / ACRE });
      continue;
    }
    const ac = 0.5 + 1.5 * far * rng(), area = ac * ACRE, Fw = Math.sqrt(area / 1.6), Dd = area / Fw; // [S] rural lots 0.5-2 ac, frontage:depth ~1:1.6
    tryPlace(cnd.p, cnd.u, [{ a: 0, o: 0, w: Fw, d: Dd, kind: "lawn" }, ...house((rng() - 0.5) * Fw * 0.4, 12 + 12 * rng())], { kind: "rural", name: "Rural home", cls: "multifamily", year, gap: 40, tenure: "homes", acres: ac });
  }
  const { ox, oy } = M.survey;
  for (let x = ox - MILE; x < M.S + MILE; x += MILE) for (let y = oy - MILE; y < M.S + MILE; y += MILE) {
    const p = [x, y]; if (p[0] < 100 || p[1] < 100 || p[0] > M.S - 100 || p[1] > M.S - 100 || rF(p) < 300 || rng() > 0.4) continue;
    for (const [da, u] of [[70, [1, 0]], [-70, [1, 0]], [70, [0, 1]]]) if (rng() < 0.6) { const year = Math.round(1900 + 60 * rng()); tryPlace(add(p, mul(u, da)), u, [{ a: 0, o: 0, w: 50, d: 80, kind: "lawn" }, ...house(0, 15)], { kind: "rural", name: "Farmhouse at the crossroads", cls: "multifamily", year, gap: 40, tenure: "homes", acres: 50 * 80 / ACRE }); }
  }
  // two gravel lots on the roads out (1950-90): ordinary vacant land, paved
  place(2, (q) => { const d = rF(q.p); return d > 200 && d < 1500; }, () => [[{ a: 0, o: 0, w: 30 + 15 * rng(), d: 40, kind: "pave" }], { kind: "gravel", name: "Gravel lot", cls: "land", year: Math.round(R(1950, 1990)), gap: 300 }]);
  M.outerLots = lots;

  // ---------------- the forest belt along the back of the map, woodlots in the middle farmland [O, K]
  const nzF = makeNoise(makeRng("forest:" + M.seed), 700);
  const backEdge = (p) => Math.min(p[0], M.S - p[0], p[1], M.coast ? Infinity : M.S - p[1]);
  M.forestL = G.layer();
  for (let k = 0; k < G.N; k++) {
    const p = G.ctr(k);
    if (M.water[k] || M.isSea(p) || town(k) || M.hwL[k] || M.taken[k] || M.phase[k] || M.lotL[k]) continue;
    if (M.coast && M.coastY(p[0]) - p[1] < 900) continue;
    if (dist(p, M.centre) < 2200) continue;
    if (backEdge(p) < 600 + 700 * nzF(p[0], p[1])) M.forestL[k] = 1;
  }
  for (const t of M.tracts) if (!t.era && !t.wood && rng() < 0.06) t.wood = true;
  return M;
}

function insideConvex(p, ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c !== 0) { if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false; }
  }
  return true;
}
export { RINGS };
