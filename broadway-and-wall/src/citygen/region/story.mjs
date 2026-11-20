// THE TOWN'S HISTORY AS FIELDS (spike export-unreal.mjs storyPrep).
//
// Density follows history and access, not only distance: a "story distance"
// is the distance from the landing, shortened along the old country roads
// (the streetcar and wagon routes the town grew out along first) and near the
// first interstate, and lengthened on the far side of the water from where the
// town began. The town's outline, the old main street, the river's mill strip
// and the freeway's cut through the old city are all read off it.
//
// The strengths (x0.72 along old roads, x0.85 near the interstate, the
// waterfront term) are the spike's shape parameters, chosen by eye [K]; they
// are not calibrated, and in a later phase the growth sim owns them.
import { makeRng, makeNoise, dist, sub, norm, dot, CELL, maskOutline, rdp, chaikinClosed, ringAreaAbs } from "./util.mjs";

export function storyPrep(M) {
  const G = M.G, c = M.centre;
  const waterD = G.bfs((k) => M.water[k] === 1);
  const riverD = G.bfs((k) => M.riverL[k] === 1);
  const oldNear = G.layer(); for (const r of M.oldRoads) G.line(oldNear, r, 120);
  const hwNear = G.layer(); for (const h of M.highways) if (h.kind === "interstate") for (const s of h.segs) if (s.built) G.line(hwNear, s.pts, 450);
  const nz = makeNoise(makeRng("story:" + M.seed), 450);
  const rS = (p) => {
    const k = G.idx(p); if (k < 0) return Infinity;
    let f = 0.82 + 0.36 * nz(p[0], p[1]);
    if (oldNear[k]) f *= 0.72; else if (hwNear[k]) f *= 0.85;
    f *= 0.85 + 0.3 * Math.min(1, waterD[k] / 1800); // oldest by the water, thinner away from it
    return dist(p, c) * f;
  };
  // the old main street: the old road that leaves the landing most directly inland
  const inland = norm(sub(M.site.c, c));
  let best = null;
  for (const r of M.oldRoads) {
    if (Math.min(...r.map((p) => dist(p, c))) > 700) continue;
    let sc = -Infinity; for (const p of r) { const d = dist(p, c); if (d > 600 && d < 1800) sc = Math.max(sc, dot(sub(p, c), inland) / d); }
    if (!best || sc > best.sc) best = { r, sc };
  }
  const mainL = G.layer();
  if (best) G.line(mainL, best.r.filter((p) => dist(p, c) < 2000), 70);
  // the mill strip along the river, past the landing (1890-1945)
  const ind = (p) => { const k = G.idx(p); return k >= 0 && riverD[k] < 260 && dist(p, c) > 250; };
  // the freeway cut: its corridor (~80 m, ragged where it nicked blocks) and the band beside it [S, widths K]
  const corr = G.layer(), beside = G.layer();
  for (const h of M.highways) for (const sg of h.segs) if (sg.built) { G.line(corr, sg.pts, 40); G.line(beside, sg.pts, 130); }
  M.story = { rS, mainL, ind, waterD, riverD, oldNear, hwNear, main: best?.r ?? null, corr, beside };
  return M.story;
}

/**
 * THE TOWN'S OUTLINE: the dry land on the landing's bank within the city's
 * story distance, plus the old main street out to its own reach, smoothed by a
 * morphological close-and-open (60 m) so the plat has no one-cell fingers, and
 * traced as one simple ring. This is the "coast" the island generator cuts the
 * town inside — water on the river side, the town's edge on the land side.
 */
export function townFootprint(M) {
  const G = M.G, St = M.story, c = M.centre, S = M.S;
  const raw = G.layer();
  for (let k = 0; k < G.N; k++) {
    if (!M.cityBank[k] || M.water[k]) continue;
    const p = G.ctr(k);
    if (p[0] < 150 || p[1] < 150 || p[0] > S - 150 || p[1] > S - 150) continue;
    if (M.isSea(p)) continue;
    const r = St.rS(p);
    if (r <= M.rings.city || (St.mainL[k] && dist(p, c) < M.rings.mainStreet)) raw[k] = 1;
  }
  const R = 60;
  const keep = (L) => (k) => !!L[k];
  const dil = G.bfs(keep(raw));
  const closed = Uint8Array.from(dil, (d, k) => (d <= R && !M.water[k] && M.cityBank[k] ? 1 : 0));
  const er = G.bfs((k) => !closed[k]);
  const opened0 = Uint8Array.from(er, (d) => (d > R ? 1 : 0));
  const d2 = G.bfs(keep(opened0));
  const mask = Uint8Array.from(d2, (d, k) => (d <= R && closed[k] ? 1 : 0));
  const ring0 = maskOutline(G, mask);
  if (!ring0) throw new Error("region: no town site");
  // cell-edge staircase -> simplified, gently rounded ring; a closed RDP keeps the start vertex
  // (split at the vertex farthest from the start, so neither half is a degenerate loop)
  const closedRdp = (r, eps) => {
    let far = 0; for (let i = 1; i < r.length; i++) if (dist(r[i], r[0]) > dist(r[far], r[0])) far = i;
    const a = rdp(r.slice(0, far + 1), eps), b = rdp(r.slice(far).concat([r[0]]), eps);
    return a.slice(0, -1).concat(b.slice(0, -1));
  };
  let ring = closedRdp(ring0, CELL * 0.9);
  ring = chaikinClosed(ring, 2);
  ring = closedRdp(ring, 3);
  M.townMask = mask;
  M.townRing = ring;
  M.townArea = ringAreaAbs(ring);
  return ring;
}
