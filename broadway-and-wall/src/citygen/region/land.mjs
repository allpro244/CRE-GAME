// THE REGION'S LAND, ROADS AND SURVEY.
//
// Layers 1-3 of the region-map spike (region-spikes/map/region.mjs and the
// README's "Generator rules for Phase 1"), with the spike's final ("gradient")
// options fixed: a 6 x 6 km window, a small-city site on the water, a single
// river village upriver on one bank, creeks bent round the town. Everything is
// in one canonical frame — the river runs top to bottom (+y is downstream), any
// sea is at the bottom — and index.mjs turns it a multiple of 90 degrees into
// the world frame, so the survey stays cardinal whatever the seed.
//
// Status labels on the numbers, as in the spike: [S] sourced or a measured US
// norm (approximate), [O] an owner design decision, [K] a shape parameter chosen
// by eye, to be calibrated or replaced by the growth sim of a later phase.
import {
  MILE, ACRE, FT, makeRng, makeNoise, add, sub, mul, dist, norm, perp, lerp, cumLen, resample,
  chaikinOpen, smoothMA, rdp, crossings, slicePl, oRect, Grid, astar,
} from "./util.mjs";

export const SZ = {
  window: 6000,                    // [O] 6 x 6 km
  riverWidth: [100, 250],          // [S] mid-size navigable river at a regional city (Cumberland at Nashville ~150-200 m)
  meanderPerWidth: [10, 14],       // [S] meander wavelength ~10-14x channel width (Leopold & Wolman 1960)
  floodplainExtra: [150, 700],     // [S] 100-year floodplain of a mid-size river ~0.4-1.6 km wide in total
  creekWidth: [8, 20],             // [S] small tributary creek
  creekFlood: [60, 150],           // [S] FEMA Zone A along small streams, ~100-500 ft each side
  coastFloodBand: [100, 250],      // [S] coastal AE/VE band inland of the shoreline
  site: [1600, 1000],              // [O] the small-city site, long side on the water
  townPitch: [92, 120],            // [S] island.mjs's measured "ordinary American block"
  villageBlocks: [[2, 4], [2, 3]], // [O] the river village, scaled with the small core
  townSpacing: 2 * MILE,           // [S] 19th-c. hamlets / mill villages ~2-5 mi apart (low end)
  section: MILE,                   // [S] PLSS section = 1 mile square = 640 acres
  arterialROW: 66 * FT,            // [S] section-line road ROW, one Gunter's chain
  interchangeSpacing: MILE,        // [S] FHWA / AASHTO: interchanges >= ~1 mi apart in urban areas
  highwayROW: 300 * FT,            // [S] urban freeway ROW ~250-400 ft
  interstateYears: [1958, 1974],   // [S] Interstate program 1956; urban segments mostly 1960s-early 70s
  secondYears: [1975, 1995],       // [S] later spurs, many cut short by freeway revolts
  plannedYears: [2029, 2046],      // [S] 10-20 years from study to ribbon-cutting
};
// [O] the town's reach in "story distance" (story.mjs): the built-up city, and
// how far out the old main street carries it
export const RINGS = { core: 260, mid: 480, city: 700, mainStreet: 1150 };

const RIVERS = ["Kessaw", "Ottaquin", "Saline", "Big Muddy", "Tenmile", "Wabeno", "Paquette", "Cold Spring", "Vermilion", "Embarras", "Kaskaskia", "Little Wapsi"];
export const NAME_A = ["Mill", "Ash", "Oak", "Cedar", "Fair", "Green", "Elm", "Brook", "Clay", "Stone", "Wal", "Hazel", "Red", "Kings", "Marsh", "Pine", "Har", "Lin", "Bel", "Hamp"];
export const NAME_B = ["ford", "ton", "ville", "field", "burg", "wood", " Crossing", " Mills", "dale", "port", "ridge", " Ferry", "mont", "boro"];

/** The land, the old settlements' sites, the roads, the highway plan and the survey tracts. */
export function generateLand(seed) {
  const S = SZ.window, rng = makeRng("region:" + seed), G = new Grid(S);
  const nz = makeNoise(rng, 900), nzFine = makeNoise(rng, 250);
  const M = { seed, S, G };

  // ---------------- layer 1: land and water
  const coast = rng() < 0.5;
  const coastBase = S * rng.range(0.80, 0.88);
  const coastAmp = rng.range(150, 450), coastNz = makeNoise(rng, 1400);
  const coastY = (x) => coastBase + coastAmp * (coastNz(x, 7) - 0.5) * 2;
  const isSea = (p) => coast && p[1] > coastY(p[0]);
  M.coastY = coast ? coastY : null;

  const rw = rng.range(...SZ.riverWidth);
  const lam = rw * rng.range(...SZ.meanderPerWidth);
  const p0 = [S * rng.range(0.25, 0.75), -200], p1 = [S * rng.range(0.25, 0.75), S + 200];
  const ax = norm(sub(p1, p0)), nrm = perp(ax), L = dist(p0, p1);
  const A1 = rng.range(250, 800), lam1 = S * rng.range(0.9, 1.6), ph1 = rng.range(0, 6.28); // [K] valley-scale bend
  const A2 = lam / 4, ph2 = rng.range(0, 6.28);                                              // [K] meander amplitude ~ wavelength/4
  let river = [];
  for (let s = 0; s <= L; s += 40) {
    const off = A1 * Math.sin(2 * Math.PI * s / lam1 + ph1) + A2 * (0.4 + nz(s, 50)) * Math.sin(2 * Math.PI * s / lam + ph2);
    const p = add(add(p0, mul(ax, s)), mul(nrm, off));
    river.push(p);
    if (coast && p[1] > coastY(p[0]) + 60) break;
  }
  river = chaikinOpen(river, 2);
  const rHalf = river.map((p) => rw / 2 * (0.85 + 0.3 * nzFine(p[0], p[1])));
  const fpHalf = river.map((p, i) => rHalf[i] + SZ.floodplainExtra[0] + (SZ.floodplainExtra[1] - SZ.floodplainExtra[0]) * nz(p[0] + 999, p[1]));
  M.river = { pts: river, half: rHalf, fp: fpHalf, width: rw, name: rng.pick(RIVERS) + " River" };
  M.coast = coast ? { line: Array.from({ length: Math.ceil((S + 400) / 40) + 1 }, (_, i) => [-200 + i * 40, coastY(-200 + i * 40)]), band: rng.range(...SZ.coastFloodBand) } : null;

  const creeks = [];
  for (let c = 0, n = rng.int(1, 3); c < n; c++) {
    const side = rng() < 0.5 ? -1 : 1, ry = rng.range(0.15, 0.7) * S, start = [side < 0 ? -50 : S + 50, ry];
    let best = null;
    river.forEach((p) => { if (p[1] > ry + 300 && !isSea(p) && (!best || dist(p, start) < dist(best, start))) best = p; });
    if (!best) continue;
    const d = dist(start, best), dir = norm(sub(best, start)), nn = perp(dir), wl = rng.range(500, 1000), amp = rng.range(60, 200), ph = rng.range(0, 6.28);
    const pts = []; for (let s = 0; s <= d; s += 30) pts.push(add(add(start, mul(dir, s)), mul(nn, amp * Math.sin(Math.PI * s / d) * Math.sin(2 * Math.PI * s / wl + ph))));
    creeks.push({ pts: chaikinOpen(pts, 2), w: rng.range(...SZ.creekWidth), fp: rng.range(...SZ.creekFlood) });
  }
  M.creeks = creeks;

  const water = G.layer(), flood = G.layer(), riverL = G.layer();
  const fillWater = () => {
    water.fill(0); flood.fill(0); riverL.fill(0);
    river.forEach((p, i) => { G.disk(flood, p, fpHalf[i]); G.disk(water, p, rHalf[i]); G.disk(riverL, p, rHalf[i]); });
    for (const c of creeks) { G.line(flood, c.pts, c.fp); G.line(water, c.pts, c.w / 2 + 1); }
    if (coast) for (let k = 0; k < G.N; k++) { const p = G.ctr(k); if (isSea(p)) water[k] = 1; else if (p[1] > coastY(p[0]) - M.coast.band) flood[k] = 1; }
  };
  fillWater();
  const isWater = (p) => { const k = G.idx(p); return k >= 0 ? water[k] === 1 : isSea(p); };
  const isFlood = (p) => { const k = G.idx(p); return k >= 0 && flood[k] === 1; };
  Object.assign(M, { water, flood, riverL, isSea, isWater, isFlood });

  // ---------------- layer 2: the city's site and the village
  const [CL, CW] = SZ.site;
  const siteScore = (r) => {
    let wet = 0, out = 0; for (const q of r.poly().concat([r.c])) if (q[0] < 0 || q[1] < 0 || q[0] > S || q[1] > S) out++;
    for (let a = -0.9; a <= 0.9; a += 0.3) for (let b = -0.9; b <= 0.9; b += 0.3) { const q = add(add(r.c, mul(r.u, a * r.hl)), mul(r.v, b * r.hw)); if (isWater(q) && !isSea(q)) wet++; }
    // a town pushed against the window's edge leaves half of itself off the map: the town's reach (~1 km)
    // should fit inside, so a site whose centre is nearer an edge than that pays for it
    const edge = Math.min(r.c[0], r.c[1], S - r.c[0], S - r.c[1]);
    return wet * 3 + out * 20 + Math.max(0, 1300 - edge) / 60 + rng();
  };
  let site;
  if (coast) {
    // a port fronts the sea beside the river mouth, on whichever bank is dry
    const mouth = river[river.length - 1];
    let best = null;
    for (const sd of [1, -1]) for (let k = 0; k < 10; k++) {
      const x = mouth[0] + sd * (CL / 2 + rw / 2 + 40 + k * 120);
      const r = oRect([x, coastY(x) - CW / 2 + 120], [1, 0], CL / 2, CW / 2);
      const sc = siteScore(r) + k * 0.5;
      if (!best || sc < best.sc) best = { r, sc };
    }
    site = best.r;
  } else {
    // a landing on ONE bank where the river runs straight enough; the driest site that fits wins
    let best = null;
    for (let tr = 0; tr < 40; tr++) {
      const i = Math.max(4, Math.min(river.length - 5, Math.floor(river.length * rng.range(0.3, 0.7))));
      const tan = norm(sub(river[i + 4], river[i - 4]));
      for (const sd of [1, -1]) {
        const r = oRect(add(river[i], mul(perp(tan), sd * (rHalf[i] + CW / 2 + 40))), tan, CL / 2, CW / 2);
        const sc = siteScore(r);
        if (!best || sc < best.sc) best = { r, sc };
      }
    }
    site = best.r;
  }
  // the city's centre sits near the waterfront (the landing), inset 450 m from the site's wet side [O]
  const wetSide = (sd) => { let w = 0; for (let a = -0.9; a <= 0.9; a += 0.15) if (isWater(add(add(site.c, mul(site.v, sd * site.hw * 1.05)), mul(site.u, a * site.hl)))) w++; return w; };
  const sd = wetSide(1) >= wetSide(-1) ? 1 : -1;
  site.wet = mul(site.v, sd);                      // unit vector toward the water
  site.centre = add(site.c, mul(site.v, sd * (site.hw - 450)));
  const centre = site.centre;
  // creeks bend round the town (culverted, or the town grew round their valleys) and follow its edge to the river
  const rOut = RINGS.city + 350;
  for (const c of creeks) {
    const inside = c.pts.map((p) => dist(p, centre) < rOut);
    if (!inside.some(Boolean)) continue;
    let pts = c.pts.map((p, i) => inside[i] ? add(centre, mul(norm(sub(p, centre)), rOut)) : p);
    if (inside.at(-1)) {
      const l = pts.at(-1), a0 = Math.atan2(l[1] - centre[1], l[0] - centre[0]);
      let bestArc = null;
      for (const dir of [1, -1]) {
        const arc = [];
        for (let t = 0.02; t < 3.2; t += 0.02) { const q = add(centre, [rOut * Math.cos(a0 + dir * t), rOut * Math.sin(a0 + dir * t)]); arc.push(q); const k = G.idx(q); if (k >= 0 && riverL[k]) { if (!bestArc || arc.length < bestArc.length) bestArc = arc; break; } }
      }
      if (bestArc) pts = pts.concat(bestArc);
    }
    c.pts = chaikinOpen(pts, 2);
  }
  fillWater();
  // one bank: the land reachable from the centre over dry ground
  let k0 = G.idx(centre);
  if (k0 < 0 || water[k0]) { let bd = Infinity; for (let k = 0; k < G.N; k++) if (!water[k]) { const d = dist(G.ctr(k), centre); if (d < bd) { bd = d; k0 = k; } } }
  const bank = G.bfs((k) => k === k0, (n) => !water[n]);
  M.cityBank = Uint8Array.from(bank, (d) => (d < Infinity ? 1 : 0));
  M.site = site; M.centre = centre;

  // first-pass settled area (the noisy town radius), for the road and highway costs
  const nzC = makeNoise(rng, 500);
  const settle0 = G.layer();
  for (let k = 0; k < G.N; k++) if (M.cityBank[k] && dist(G.ctr(k), centre) * (0.85 + 0.3 * nzC(...G.ctr(k))) < RINGS.city + 150) settle0[k] = 1;

  // the river village: a ferry or mill village upriver, on one bank [O]
  const towns = [];
  const okTown = (p) => p[0] > 500 && p[0] < S - 500 && p[1] > 500 && p[1] < S - 500 && !isSea(p) && dist(p, centre) > SZ.townSpacing && dist(p, site.c) > SZ.townSpacing;
  for (let tries = 0; tries < 200; tries++) {
    const i = rng.int(5, river.length - 6), p = river[i];
    if (!okTown(p)) continue;
    const u = norm(sub(river[i + 1], river[i - 1]));
    const nx = rng.int(...SZ.villageBlocks[0]), ny = rng.int(...SZ.villageBlocks[1]), pitch = rng.range(...SZ.townPitch);
    const v = perp(u), side = isWater(add(p, mul(v, rHalf[i] + ny * pitch / 2 + 20))) ? -1 : 1;
    const c = add(p, mul(v, side * (rHalf[i] + ny * pitch / 2 + 20)));
    if (isWater(c)) continue;
    const r = oRect(c, u, nx * pitch / 2, ny * pitch / 2);
    r.pitch = pitch; r.kind = "river"; r.name = rng.pick(NAME_A) + rng.pick(NAME_B); r.wet = mul(v, -side);
    towns.push(r);
    break;
  }
  M.towns = towns;
  const townL = G.layer();
  for (const t of towns) G.fill(townL, (p) => t.has(p) && !isWater(p));
  M.townL = townL;

  // ---------------- layer 3: roads
  // 3a old country roads, A* on a cost surface: noise for terrain, floodplain x2.5, water x60 except where a
  // settlement bridges it, an existing road x0.35 so later roads merge into a tree [K]
  const roadL = G.layer(), cost = new Float64Array(G.N);
  for (let k = 0; k < G.N; k++) {
    const p = G.ctr(k); let c = 1 + 0.8 * nz(p[0] * 1.7, p[1] * 1.7);
    if (flood[k]) c *= 2.5; if (water[k]) c *= (townL[k] || settle0[k]) ? 3 : 60; if (settle0[k] || townL[k]) c *= 0.6;
    cost[k] = c;
  }
  const oldRoads = [];
  const road = (a, b) => {
    const p = astar(G, cost, a, b, 0.35); if (!p) return;
    const pl = chaikinOpen(rdp(p, 18), 3);
    oldRoads.push(pl);
    for (const q of resample(pl, 10)) { const k = G.idx(q); if (k >= 0) { roadL[k] = 1; cost[k] = Math.min(cost[k], 0.35); } }
  };
  const edgePoint = (from, ang) => { const d = [Math.cos(ang), Math.sin(ang)]; let t = 0, p = from; while (p[0] > 0 && p[0] < S && p[1] > 0 && p[1] < S) { t += 20; p = add(from, mul(d, t)); } return [Math.min(S - 1, Math.max(1, p[0])), Math.min(S - 1, Math.max(1, p[1]))]; };
  const nRad = rng.int(4, 5), a0 = rng.range(0, 6.28);
  for (let i = 0; i < nRad; i++) { const e = edgePoint(centre, a0 + i * 2 * Math.PI / nRad + rng.range(-0.3, 0.3)); if (!isWater(e)) road(centre, e); }
  for (const t of towns) {
    road(t.c, centre);
    const away = Math.atan2(t.c[1] - centre[1], t.c[0] - centre[0]) + rng.range(-0.6, 0.6);
    const e = edgePoint(t.c, away); if (!isWater(e)) road(t.c, e);
  }
  M.oldRoads = oldRoads; M.roadL = roadL;

  // 3b survey grid: section lines every mile (PLSS), roads on them unless they hit water or a settlement [S]
  const ox = rng.range(0, MILE), oy = rng.range(0, MILE);
  M.survey = { ox, oy };
  const secRoads = [], xs = [], ys = [];
  for (let x = ox - MILE; x < S + MILE; x += MILE) xs.push(x);
  for (let y = oy - MILE; y < S + MILE; y += MILE) ys.push(y);
  const trySec = (a, b) => {
    a = [Math.max(0, Math.min(S, a[0])), Math.max(0, Math.min(S, a[1]))]; b = [Math.max(0, Math.min(S, b[0])), Math.max(0, Math.min(S, b[1]))];
    if (dist(a, b) < 100) return;
    let run = [];
    const flush = () => { if (run.length > 4) secRoads.push([run[0], run[run.length - 1]]); run = []; };
    for (const p of resample([a, b], 40)) { const k = G.idx(p); if (k < 0 || water[k] || settle0[k] || townL[k]) flush(); else run.push(p); }
    flush();
  };
  for (const x of xs) for (let j = 0; j < ys.length - 1; j++) trySec([x, ys[j]], [x, ys[j + 1]]);
  for (const y of ys) for (let i = 0; i < xs.length - 1; i++) trySec([xs[i], y], [xs[i + 1], y]);
  M.secRoads = secRoads;
  const artL = G.layer(); for (const r of oldRoads.concat(secRoads)) G.line(artL, r);
  M.artL = artL;

  // 3c the highway master plan
  const hcost = new Float64Array(G.N);
  for (let k = 0; k < G.N; k++) { const p = G.ctr(k); let c = 1 + 0.4 * nz(p[0], p[1] + 500); if (flood[k]) c *= 1.5; if (water[k]) c *= isSea(p) ? 1e4 : 15; if (settle0[k]) c *= 3; if (townL[k]) c *= 5; if (roadL[k]) c *= 0.8; hcost[k] = c; }
  const hwPath = (pts) => { let out = []; for (let i = 0; i < pts.length - 1; i++) { const p = astar(G, hcost, pts[i], pts[i + 1], 0.8); if (!p) return null; out = out.concat(i ? p.slice(1) : p); } return smoothMA(out, 20, 900, 4); };
  const highways = [];
  // H1, the interstate, skirting the old city on its landward side (1958-74) [S]
  const coreN = mul(site.wet, -1);
  const wp = add(site.c, mul(coreN, CW / 2 + 200));
  const h1a = rng.range(0, 6.28);
  const e1 = edgePoint(wp, h1a), e2 = edgePoint(wp, h1a + Math.PI + rng.range(-0.4, 0.4));
  const fixE = (e) => { const a = Math.atan2(e[1] - wp[1], e[0] - wp[0]); for (let k = 0; k < 12 && isWater(e); k++) e = edgePoint(wp, a + (k % 2 ? 1 : -1) * 0.25 * Math.ceil((k + 1) / 2)); return e; };
  const H1 = hwPath([fixE(e1), wp, fixE(e2)]);
  if (H1) highways.push({ id: "H1", pts: H1, kind: "interstate", built: "all", years: SZ.interstateYears });
  // later freeways do not run alongside an existing one: its flanks are dear (x6 within 350 m) [K]
  if (H1) { const near = G.layer(); G.line(near, H1, 350); for (let k = 0; k < G.N; k++) if (near[k] && dist(G.ctr(k), wp) > 500) hcost[k] *= 6; }
  // H2, a radial spur from H1 at the city, built from the city end outward, 60% stopped short [S, K]
  const angs = H1 ? [Math.atan2(H1[0][1] - wp[1], H1[0][0] - wp[0]), Math.atan2(H1.at(-1)[1] - wp[1], H1.at(-1)[0] - wp[0])] : [];
  let a2 = null; for (let tr = 0; tr < 40; tr++) { const a = rng.range(0, 6.28); const e = edgePoint(wp, a); if (!isWater(e) && angs.every((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 1.1)) { a2 = a; break; } }
  if (a2 !== null) { const H2 = hwPath([wp, edgePoint(wp, a2)]); if (H2) highways.push({ id: "H2", pts: H2, kind: "spur", built: rng() < 0.4 ? "all" : rng.range(0.3, 0.7), years: SZ.secondYears }); }
  // H3, a proposed outer bypass, an arc at 0.42-0.55 of the window (2029-46) [S]
  const R = rng.range(0.42, 0.55) * S, ac = Math.atan2(S / 2 - site.c[1], S / 2 - site.c[0]) + rng.range(-0.5, 0.5), span = rng.range(2.2, 3.6);
  let arc = [], run = [];
  for (let a = ac - span / 2; a <= ac + span / 2 + 1e-6; a += 0.2) { const p = add(site.c, [R * Math.cos(a), R * Math.sin(a)]); if (p[0] > 30 && p[0] < S - 30 && p[1] > 30 && p[1] < S - 30 && !isWater(p) && !townL[G.idx(p)] && !(coast && p[1] > coastY(p[0]) - 700)) { run.push(p); if (run.length > arc.length) arc = run; } else run = []; }
  if (arc.length >= 5) { const H3 = hwPath(arc); if (H3) highways.push({ id: "H3", pts: H3, kind: "bypass", built: "none", years: SZ.plannedYears }); }
  // interchanges at arterial and freeway crossings, at least a mile apart; each segment BUILT (year) or PROPOSED
  for (const h of highways) {
    const xs2 = [];
    for (const o of highways) if (o !== h) for (const c of crossings(h.pts, o.pts)) xs2.push({ ...c, sys: true });
    if (h.id === "H2") xs2.push({ s: 0, p: h.pts[0], sys: true });
    for (const r of oldRoads) for (const c of crossings(h.pts, r)) xs2.push({ ...c, sys: false, old: true });
    for (const r of secRoads) for (const c of crossings(h.pts, r)) xs2.push({ ...c, sys: false });
    xs2.sort((a, b) => (b.sys - a.sys) || ((b.old ? 1 : 0) - (a.old ? 1 : 0)) || (a.s - b.s));
    const kept = [];
    for (const c of xs2) if (c.sys ? kept.every((k) => Math.abs(k.s - c.s) > 50) : kept.every((k) => Math.abs(k.s - c.s) >= SZ.interchangeSpacing)) kept.push(c);
    h.ix = kept.sort((a, b) => a.s - b.s);
    const Lh = cumLen(h.pts).at(-1); const cuts = [0, ...h.ix.map((c) => c.s).filter((s) => s > 30 && s < Lh - 30), Lh];
    const nSeg = cuts.length - 1; const builtUpTo = h.built === "all" ? nSeg : h.built === "none" ? 0 : Math.max(1, Math.round(nSeg * h.built));
    let yB = h.years[0], yP = SZ.plannedYears[0] + rng.int(0, 4);
    const fromStart = dist(h.pts[0], site.c) <= dist(h.pts.at(-1), site.c);
    h.segs = [];
    for (let q = 0; q < nSeg; q++) {
      const i = fromStart ? q : nSeg - 1 - q, built = q < builtUpTo;
      const year = built ? (yB = Math.min(h.years[1], Math.round(yB + rng.range(0, (h.years[1] - h.years[0]) / Math.max(1, nSeg) * 1.6)))) : (yP = Math.min(SZ.plannedYears[1], yP + rng.int(1, 5)));
      h.segs[i] = { pts: slicePl(h.pts, cuts[i], cuts[i + 1]), built, year, s0: cuts[i], s1: cuts[i + 1] };
    }
  }
  M.highways = highways;
  const hwL = G.layer(); for (const h of highways) G.line(hwL, h.pts, SZ.highwayROW / 2);
  M.hwL = hwL;
  M.interchanges = highways.flatMap((h) => h.ix.filter((x) => !x.sys && h.segs.some((sg) => sg.built && x.s >= sg.s0 - 1 && x.s <= sg.s1 + 1)).map((x) => ({ p: x.p, hw: h.id })));

  // ---------------- the survey's tracts: aliquot parts of each section [S]
  // quarter (160 ac), half-quarter (80), quarter-quarter (40); whole sections (640) far out. Split odds
  // approximate: Midwest plat books show mostly 40-160 ac holdings.
  const tracts = [];
  const clip = (x0, y0, x1, y1) => { const a = [Math.max(0, x0), Math.max(0, y0), Math.min(S, x1), Math.min(S, y1)]; return a[2] - a[0] > 40 && a[3] - a[1] > 40 ? a : null; };
  const push = (x0, y0, x1, y1) => { const r = clip(x0, y0, x1, y1); if (r && (r[2] - r[0]) * (r[3] - r[1]) > 5 * ACRE) tracts.push({ r, acres: (r[2] - r[0]) * (r[3] - r[1]) / ACRE }); };
  for (const x of xs) for (const y of ys) {
    const c = [x + MILE / 2, y + MILE / 2];
    if (dist(c, site.c) > 3500 && rng() < 0.12) { push(x, y, x + MILE, y + MILE); continue; }
    const h = MILE / 2, q = MILE / 4;
    for (const [qx, qy] of [[x, y], [x + h, y], [x, y + h], [x + h, y + h]]) {
      const r = rng();
      if (r < 0.3) push(qx, qy, qx + h, qy + h);
      else if (r < 0.6) { if (rng() < 0.5) { push(qx, qy, qx + h, qy + q); push(qx, qy + q, qx + h, qy + h); } else { push(qx, qy, qx + q, qy + h); push(qx + q, qy, qx + h, qy + h); } }
      else if (r < 0.82) { push(qx, qy, qx + q, qy + q); push(qx + q, qy, qx + h, qy + q); push(qx, qy + q, qx + q, qy + h); push(qx + q, qy + q, qx + h, qy + h); }
      else { push(qx, qy, qx + h, qy + q); push(qx, qy + q, qx + q, qy + h); push(qx + q, qy + q, qx + h, qy + h); }
    }
  }
  for (const [i, t] of tracts.entries()) {
    t.id = i + 1;
    t.c = [(t.r[0] + t.r[2]) / 2, (t.r[1] + t.r[3]) / 2];
    t.crop = rng.int(0, 2); t.wood = rng() < 0.08; // [S] farm woodlots, approximate
  }
  M.tracts = tracts;
  return M;
}

/** Share of a tract's sample points that pass `ok` (a 6 x 6 lattice). */
export function tractShare(G, t, ok) {
  let n = 0, m = 0; const [x0, y0, x1, y1] = t.r;
  for (let i = 0.5; i < 6; i++) for (let j = 0.5; j < 6; j++) { const k = G.idx([x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * j / 6]); n++; if (k >= 0 && ok(k)) m++; }
  return m / n;
}
export { lerp };
