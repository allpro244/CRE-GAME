// ONE OUTLINE FOR AN ASSEMBLED SITE.
//
// An assemblage is one lot on several deeds (engine/actions.assembleLots), and
// the building that goes up on it stands on all of them at once. The renderer
// only has each deed's own outline, so this dissolves the shared property
// lines and returns the outer boundary of the whole site.
//
// The generator's lots meet edge-to-edge but rarely vertex-to-vertex — a
// neighbour's corner usually lands part-way along this lot's side (a
// T-junction). So every edge is first split at any vertex that lies on it,
// after which a shared stretch of property line is the same segment walked in
// opposite directions by the two lots, and cancels. What survives is the
// perimeter.

export type P2 = [number, number];

function signedArea(r: P2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function ringArea(r: P2[]): number {
  return Math.abs(signedArea(r));
}

/** Area-weighted centroid — a vertex average leans toward whichever side has more corners. */
export function ringCentroid(r: P2[]): P2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const [x, y] of r) { sx += x; sy += y; }
    return [sx / r.length, sy / r.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function convexHull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], hi: P2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Drop vertices that sit on the straight line between their neighbours (the dissolved lot lines leave them behind). */
function simplify(r: P2[], tol: number): P2[] {
  let out = r;
  for (let pass = 0; pass < 4; pass++) {
    const keep: P2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], p = out[i], b = out[(i + 1) % out.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const off = len > 1e-9 ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len : 0;
      if (off > tol) keep.push(p);
    }
    if (keep.length === out.length || keep.length < 3) return keep.length < 3 ? out : keep;
    out = keep;
  }
  return out;
}

/**
 * The outer boundary of several touching lots, or null when they do not
 * dissolve into one piece (a gap, a corner-only touch). `tol` is in the
 * rings' own units — metres in the renderer.
 */
export function unionRings(rings: P2[][], tol = 0.5): P2[] | null {
  // Where two lots meet only at a corner the boundary pinches through that
  // point. Turning left there splits it into one loop per lobe; turning right
  // walks it as a single figure-eight, which is the outline of one building
  // that happens to have a waist.
  return dissolve(rings, tol, "left") ?? dissolve(rings, tol, "right");
}

function dissolve(rings: P2[][], tol: number, turnRule: "left" | "right"): P2[] | null {
  const src = rings.filter((r) => r && r.length >= 3);
  if (!src.length) return null;
  if (src.length === 1) return src[0];
  const total = src.reduce((a, r) => a + ringArea(r), 0);

  // one vertex per location: corners within tol of each other are the same corner
  const verts: P2[] = [];
  const idOf = (p: P2): number => {
    for (let i = 0; i < verts.length; i++) {
      if (Math.hypot(verts[i][0] - p[0], verts[i][1] - p[1]) <= tol) return i;
    }
    verts.push([p[0], p[1]]);
    return verts.length - 1;
  };
  const loops = src.map((r) => {
    const ccw = signedArea(r) > 0 ? r : [...r].reverse();
    const ids: number[] = [];
    for (const p of ccw) { const id = idOf(p); if (ids[ids.length - 1] !== id) ids.push(id); }
    if (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    return ids;
  });

  // split every edge at every vertex lying on it — the T-junctions
  const edges = new Map<string, number>();   // "u>v" -> multiplicity
  const add = (u: number, v: number) => {
    if (u === v) return;
    const back = `${v}>${u}`;
    const nb = edges.get(back) ?? 0;
    if (nb > 0) { if (nb === 1) edges.delete(back); else edges.set(back, nb - 1); return; }
    const k = `${u}>${v}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  };
  for (const ids of loops) {
    for (let i = 0; i < ids.length; i++) {
      const u = ids[i], v = ids[(i + 1) % ids.length];
      const [ax, ay] = verts[u], [bx, by] = verts[v];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      if (L2 < 1e-12) continue;
      const on: { t: number; id: number }[] = [];
      for (let w = 0; w < verts.length; w++) {
        if (w === u || w === v) continue;
        const t = ((verts[w][0] - ax) * dx + (verts[w][1] - ay) * dy) / L2;
        if (t <= 0 || t >= 1) continue;
        const d = Math.hypot(verts[w][0] - (ax + t * dx), verts[w][1] - (ay + t * dy));
        if (d <= tol) on.push({ t, id: w });
      }
      on.sort((a, b) => a.t - b.t);
      let prev = u;
      for (const o of on) { add(prev, o.id); prev = o.id; }
      add(prev, v);
    }
  }

  // walk what is left into closed loops
  const out = new Map<number, number[]>();
  let left = 0;
  for (const [k, n] of edges) {
    const [u, v] = k.split(">").map(Number);
    for (let i = 0; i < n; i++) { const arr = out.get(u); if (arr) arr.push(v); else out.set(u, [v]); left++; }
  }
  const walked: P2[][] = [];
  while (left > 0) {
    const start = [...out.entries()].find(([, vs]) => vs.length)![0];
    const ring: P2[] = [];
    let cur = start, guard = 0;
    do {
      ring.push(verts[cur]);
      const vs = out.get(cur)!;
      // where the boundary pinches through one corner, the turn rule decides
      // between one loop per lobe and one figure-eight (see unionRings)
      let pick = 0;
      if (vs.length > 1 && ring.length >= 2) {
        const [px, py] = ring[ring.length - 2];
        const inA = Math.atan2(verts[cur][1] - py, verts[cur][0] - px);
        let best = -Infinity;
        vs.forEach((v, i) => {
          let turn = Math.atan2(verts[v][1] - verts[cur][1], verts[v][0] - verts[cur][0]) - inA;
          while (turn <= -Math.PI) turn += 2 * Math.PI;
          while (turn > Math.PI) turn -= 2 * Math.PI;
          const score = turnRule === "left" ? turn : -turn;
          if (score > best) { best = score; pick = i; }
        });
      }
      const nxt = vs.splice(pick, 1)[0];
      left--;
      cur = nxt;
      if (++guard > 10_000) return null;
    } while (cur !== start && (out.get(cur)?.length ?? 0) > 0);
    if (cur !== start) return null;
    walked.push(ring);
  }
  const outer = walked.filter((r) => r.length >= 3 && signedArea(r) > 0).sort((a, b) => signedArea(b) - signedArea(a));
  // exactly one piece, the size of the lots that went into it — anything else
  // means the lots did not actually share their lines
  if (outer.length === 1 && Math.abs(ringArea(outer[0]) - total) <= total * 0.03) {
    return simplify(outer[0], tol * 0.5);
  }
  return null;
}

/**
 * The site's footprint: the dissolved outline when the lots share their lines;
 * otherwise snapped across a sliver gap; failing both, their convex hull.
 */
export function siteOutline(rings: P2[][], tol = 0.5): P2[] | null {
  const src = rings.filter((r) => r && r.length >= 3);
  if (src.length <= 1) return src[0] ?? null;
  // a sliver the generator left between two lots (under two metres) is
  // still one site: snap across it
  const u = unionRings(src, tol) ?? unionRings(src, Math.max(tol, 2));
  if (u) return u;
  // Last resort (a handful of sites in a thousand): the hull. It can reach a
  // little past the deeds, but one building slightly too wide is the lesser
  // fault — several buildings on one site is the thing assembling undoes.
  const hull = convexHull(src.flat());
  return hull.length >= 3 ? hull : null;
}

type LotFeature = { id?: string | number; type: "Feature"; properties: Record<string, unknown> | null; geometry: { type: string; coordinates: unknown } };

/**
 * THE MAP'S LOT LINES FOR ASSEMBLED SITES. The parcel source carries every
 * deed's own polygon, so a site of three lots was outlined as three lots —
 * gold when selected, teal for the join — long after the deeds were folded
 * into one. This returns the collection with each site drawn as one polygon
 * (the dissolved outline, under the parent's id, so feature-state keyed on
 * the parent still applies) and its folded deeds removed. Rings are lon/lat;
 * the dissolve runs in local metres so the snapping tolerance means metres.
 */
export function mergeLotFeatures<F extends LotFeature>(
  features: F[], merged: Record<string, string>,
): F[] {
  const kids = new Map<string, string[]>();
  for (const [c, p] of Object.entries(merged)) {
    const arr = kids.get(p);
    if (arr) arr.push(c); else kids.set(p, [c]);
  }
  if (!kids.size) return features;
  const byBbl = new Map<string, F>();
  for (const f of features) {
    const b = f.properties?.bbl;
    if (typeof b === "string") byBbl.set(b, f);
  }
  const out: F[] = [];
  for (const f of features) {
    const b = f.properties?.bbl as string | undefined;
    if (b && merged[b]) continue;   // folded into its site
    const ks = b ? kids.get(b) : undefined;
    if (!ks || f.geometry?.type !== "Polygon") { out.push(f); continue; }
    const deeds = [f, ...ks.map((k) => byBbl.get(k)).filter((x): x is F => !!x && x.geometry?.type === "Polygon")];
    const ll = deeds.map((d) => (d.geometry.coordinates as P2[][])[0].slice(0, -1));
    const [lon0, lat0] = ll[0][0];
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
    const ring = siteOutline(ll.map((r) => r.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * ky] as P2)));
    if (!ring) { out.push(f); continue; }
    const back = ring.map(([x, y]) => [lon0 + x / kx, lat0 + y / ky] as P2);
    out.push({ ...f, geometry: { type: "Polygon", coordinates: [[...back, back[0]]] } });
  }
  return out;
}
