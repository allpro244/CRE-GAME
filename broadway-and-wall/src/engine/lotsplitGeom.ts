// THE GEOMETRY OF A LOT SPLIT (lotsplit.ts has the rules and the money).
//
// A split is a parcel's ring cut by one or more straight lines. Everything the
// rules need is measured here, from the city's own drawing and nothing else:
//
//   the pieces       the parent ring clipped by each cut line, in a fixed order,
//                    so the same ring and the same cuts give the same lots on
//                    every load (the recipe stores the cuts, never the rings);
//   street frontage  measured along the pieces' ring edges that lie on a public
//                    street: an edge counts where it runs within its street's
//                    half right-of-way of the centreline (plus 2 m of drawing
//                    tolerance) and roughly parallel to it. The city draws a
//                    lot's front line exactly half a right-of-way off the
//                    centreline (measured over the island and the region: the
//                    median front edge sits 0.02 m from w/2), so this is the
//                    street line, not a guess at it. Centrelines under 7 m are
//                    alleys and footpaths — no frontage on those.
//   the building     every footprint the city drew for the deed: a cut through
//                    one is refused, and the distance from the footprint to the
//                    new lot line is the side yard the rules test.
//
// Pure functions over plain data, so the page, the worker and a harness all
// measure the same lots.

export type LL = [number, number];
export type SplitCut = [LL, LL];
type XY = [number, number];

/** What a split needs to know about one site: its ring, what stands on it, and the streets around it. */
export interface SiteGeo {
  bbl: string;
  ring: LL[];
  footprints: LL[][];
  streets: { pts: LL[]; w: number; id: number }[];
}

export interface PieceGeo {
  ring: LL[];
  /** share of the parent's area (0..1) */
  share: number;
  /** the longest run of lot line on one public street, ft (PLUTO's LotFront) */
  frontFt: number;
  /** all street frontage, ft */
  frontAllFt: number;
  /** how many streets it touches (a corner lot touches two) */
  streets: number;
  /** extent along the frontage and behind it, ft */
  widthFt: number;
  depthFt: number;
  c: LL;
  /** the frontage run, for drawing a dimension on it */
  front: [LL, LL] | null;
  /** the parent's building stands on this piece */
  bldg: boolean;
  /** least distance from the building to a new lot line, ft (Infinity where there is no building) */
  yardFt: number;
  /** pieces sharing a new lot line with this one, and the length shared, ft */
  touches: { j: number; ft: number }[];
}

const FT = 0.3048;
const M2_SF = 10.763910417;
const STREET_MIN_W = 7;      // m: a centreline narrower than this is an alley or a path
const STREET_TOL = 2;        // m: drawing tolerance on the street line
const PARALLEL = 0.85;       // |cos| between lot edge and centreline: within ~32 degrees

// ---------------------------------------------------------------- frames
interface Frame { lon0: number; lat0: number; kx: number; ky: number }
function frameOf(ring: LL[]): Frame {
  let lon0 = 0, lat0 = 0;
  for (const p of ring) { lon0 += p[0]; lat0 += p[1]; }
  lon0 /= Math.max(1, ring.length); lat0 /= Math.max(1, ring.length);
  return { lon0, lat0, kx: 111_320 * Math.cos((lat0 * Math.PI) / 180), ky: 110_574 };
}
const toXY = (f: Frame, p: LL): XY => [(p[0] - f.lon0) * f.kx, (p[1] - f.lat0) * f.ky];
const toLL = (f: Frame, p: XY): LL => [f.lon0 + p[0] / f.kx, f.lat0 + p[1] / f.ky];
const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
/** A point in the recipe: degrees to 1e-7 (about a centimetre), so a save round-trips exactly. */
export const roundLL = (p: LL): LL => [r7(p[0]), r7(p[1])];

const open = (r: LL[]): LL[] => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

function area(r: XY[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
function centroid(r: XY[]): XY {
  const A = area(r);
  if (Math.abs(A) < 1e-9) { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / Math.max(1, r.length), y / Math.max(1, r.length)]; }
  let cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const k = p[0] * q[1] - q[0] * p[1]; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; }
  return [cx / (6 * A), cy / (6 * A)];
}
function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inRing(p: XY, r: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Signed side of a point against a cut line: >0 left, <0 right. */
function side(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  return (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / L;
}
/** One half of a ring against a line (Sutherland-Hodgman, one plane). */
function clipHalf(r: XY[], a: XY, b: XY, keepLeft: boolean): XY[] {
  const out: XY[] = [];
  const s = (p: XY) => (keepLeft ? 1 : -1) * side(p, a, b);
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    const sp = s(p), sq = s(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  // drop repeated vertices a cut through a corner leaves
  return out.filter((p, i) => { const q = out[(i + 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; });
}

// ---------------------------------------------------------------- the city
type FC = { features: { geometry: { type: string; coordinates: unknown }; properties?: Record<string, unknown> | null }[] };
function ringsOf(g: { type: string; coordinates: unknown }): LL[][] {
  if (g.type === "Polygon") return [open((g.coordinates as LL[][])[0])];
  if (g.type === "MultiPolygon") return (g.coordinates as LL[][][]).map((p) => open(p[0]));
  return [];
}
/**
 * The site as the city drew it: the deed's ring (the largest, if it was drawn
 * in parts), the footprints of everything standing on it, and every street
 * centreline within 150 m.
 */
export function siteGeometry(parcelFeatures: FC, buildingFeatures: FC | null, context: FC | null, bbl: string): SiteGeo | null {
  let ring: LL[] | null = null;
  for (const f of parcelFeatures.features) {
    if (String(f.properties?.bbl) !== bbl) continue;
    for (const r of ringsOf(f.geometry)) if (!ring || r.length > ring.length) ring = r;
  }
  if (!ring || ring.length < 3) return null;
  const footprints: LL[][] = [];
  for (const f of buildingFeatures?.features ?? []) if (String(f.properties?.bbl) === bbl) footprints.push(...ringsOf(f.geometry));
  const fr = frameOf(ring);
  const xs = ring.map((p) => toXY(fr, p));
  const minX = Math.min(...xs.map((p) => p[0])) - 150, maxX = Math.max(...xs.map((p) => p[0])) + 150;
  const minY = Math.min(...xs.map((p) => p[1])) - 150, maxY = Math.max(...xs.map((p) => p[1])) + 150;
  const streets: SiteGeo["streets"] = [];
  (context?.features ?? []).forEach((f, id) => {
    if (f.properties?.kind !== "centerline" || f.geometry.type !== "LineString") return;
    const w = Number(f.properties?.w ?? 0);
    if (!(w >= STREET_MIN_W)) return;
    const pts = f.geometry.coordinates as LL[];
    const near = pts.some((p, k) => {
      const a = toXY(fr, p), b = toXY(fr, pts[Math.min(k + 1, pts.length - 1)]);
      return Math.max(a[0], b[0]) >= minX && Math.min(a[0], b[0]) <= maxX && Math.max(a[1], b[1]) >= minY && Math.min(a[1], b[1]) <= maxY;
    });
    if (near) streets.push({ pts, w, id });
  });
  return { bbl, ring, footprints, streets };
}

// ---------------------------------------------------------------- cutting
/**
 * The pieces a set of cut lines makes of a ring, in order: each line splits
 * every piece it crosses, left side first. A line that misses a piece leaves
 * it whole. Slivers under a square metre are dropped (a line grazing a corner).
 */
export function cutPieces(ring: LL[], cuts: SplitCut[]): LL[][] {
  const fr = frameOf(ring);
  let pieces: XY[][] = [open(ring).map((p) => toXY(fr, p))];
  for (const [p, q] of cuts) {
    const a = toXY(fr, p), b = toXY(fr, q);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) continue;
    const next: XY[][] = [];
    for (const pc of pieces) {
      const L = clipHalf(pc, a, b, true), R = clipHalf(pc, a, b, false);
      const aL = L.length >= 3 ? Math.abs(area(L)) : 0, aR = R.length >= 3 ? Math.abs(area(R)) : 0;
      if (aL < 1 || aR < 1) { next.push(pc); continue; }
      next.push(L, R);
    }
    pieces = next;
  }
  return pieces.map((pc) => pc.map((p) => toLL(fr, p)));
}

/** Street frontage of one ring, measured edge by edge (see the head of the file). */
function frontage(fr: Frame, r: XY[], streets: { pts: XY[]; w: number; id: number }[]) {
  const byStreet = new Map<number, number>();
  let best: { id: number; a: XY; b: XY; len: number } | null = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.2) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const n = Math.max(1, Math.ceil(L));     // a sample a metre
    const runs = new Map<number, number>();
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, p: XY = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      let hit = -1, hd = Infinity;
      for (const st of streets) {
        for (let j = 0; j + 1 < st.pts.length; j++) {
          const s0 = st.pts[j], s1 = st.pts[j + 1];
          const d = segDist(p, s0, s1);
          if (d > st.w / 2 + STREET_TOL || d >= hd) continue;
          const sl = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
          if (Math.abs((ux * (s1[0] - s0[0]) + uy * (s1[1] - s0[1])) / sl) < PARALLEL) continue;
          hit = st.id; hd = d;
        }
      }
      if (hit >= 0) runs.set(hit, (runs.get(hit) ?? 0) + L / n);
    }
    for (const [id, len] of runs) {
      byStreet.set(id, (byStreet.get(id) ?? 0) + len);
      if (!best || len > best.len) best = { id, a, b, len };
    }
  }
  void fr;
  // one street drawn as several centreline features (a block's sides) reads as one street only if
  // the runs are collinear; a corner lot's two fronts are two streets
  let frontM = 0, allM = 0, n = 0;
  for (const len of byStreet.values()) { allM += len; if (len > frontM) frontM = len; if (len >= 3) n++; }
  return { frontM, allM, n, best };
}

/**
 * Measure the pieces a plan makes: area shares, frontage, width and depth, which
 * piece the building stands on and how far it is from the new lines, and which
 * pieces share a new line. `crosses` names a cut through a footprint.
 */
export function measurePieces(geo: SiteGeo, cuts: SplitCut[]): { pieces: PieceGeo[]; crosses: boolean; straddles: boolean } {
  const fr = frameOf(geo.ring);
  const parentA = Math.abs(area(open(geo.ring).map((p) => toXY(fr, p)))) || 1;
  const streets = geo.streets.map((s) => ({ pts: s.pts.map((p) => toXY(fr, p)), w: s.w, id: s.id }));
  const lines = cuts.map(([p, q]) => [toXY(fr, p), toXY(fr, q)] as [XY, XY]).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= 1e-3);
  const foots = geo.footprints.map((r) => r.map((p) => toXY(fr, p)));
  // A CUT THROUGH THE BUILDING: a footprint with corners on both sides of any line (a footprint lies
  // inside its lot, so a line with the building on both sides of it runs through the building)
  let crosses = false;
  for (const f of foots) for (const [a, b] of lines) {
    let pos = false, neg = false;
    for (const p of f) { const sd = side(p, a, b); if (sd > 0.05) pos = true; if (sd < -0.05) neg = true; }
    if (pos && neg) crosses = true;
  }
  const raw = cutPieces(geo.ring, cuts).map((r) => r.map((p) => toXY(fr, p)));
  const yard = foots.length && lines.length
    ? Math.min(...foots.flatMap((f) => f.map((p) => Math.min(...lines.map(([a, b]) => Math.abs(side(p, a, b))))))) / FT : Infinity;
  const fc = foots.map((f) => centroid(f));
  const holders = new Set<number>();
  const pieces: PieceGeo[] = raw.map((r, i) => {
    const A = Math.abs(area(r));
    const fg = frontage(fr, r, streets);
    // the lot's frame: along its main frontage, or along its longest side where it has none
    let ux = 1, uy = 0;
    if (fg.best) { const L = Math.hypot(fg.best.b[0] - fg.best.a[0], fg.best.b[1] - fg.best.a[1]) || 1; ux = (fg.best.b[0] - fg.best.a[0]) / L; uy = (fg.best.b[1] - fg.best.a[1]) / L; }
    else {
      let bl = 0;
      for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > bl) { bl = L; ux = (b[0] - a[0]) / L; uy = (b[1] - a[1]) / L; } }
    }
    const us = r.map((p) => p[0] * ux + p[1] * uy), vs = r.map((p) => -p[0] * uy + p[1] * ux);
    const widthM = Math.max(...us) - Math.min(...us), depthM = Math.max(...vs) - Math.min(...vs);
    const has = fc.some((c) => inRing(c, r));
    if (has) holders.add(i);
    return {
      ring: r.map((p) => toLL(fr, p)), share: A / parentA,
      frontFt: fg.frontM / FT, frontAllFt: fg.allM / FT, streets: fg.n,
      widthFt: widthM / FT, depthFt: depthM / FT, c: toLL(fr, centroid(r)),
      front: fg.best ? [toLL(fr, fg.best.a), toLL(fr, fg.best.b)] : null,
      bldg: has, yardFt: has ? yard : Infinity, touches: [],
    };
  });
  // who shares a new lot line with whom: sample each piece's edges that lie on a cut line
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const acc = new Map<number, number>();
    for (let k = 0; k < r.length; k++) {
      const a = r[k], b = r[(k + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.3) continue;
      const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!lines.some(([p, q]) => Math.abs(side(a, p, q)) < 0.05 && Math.abs(side(b, p, q)) < 0.05)) continue;
      const n = Math.max(1, Math.ceil(L));
      for (let j = 0; j < raw.length; j++) {
        if (j === i) continue;
        const o = raw[j];
        let on = 0;
        for (let t = 0; t < n; t++) {
          const p: XY = [a[0] + ((t + 0.5) / n) * (b[0] - a[0]), a[1] + ((t + 0.5) / n) * (b[1] - a[1])];
          for (let e = 0; e < o.length; e++) if (segDist(p, o[e], o[(e + 1) % o.length]) < 0.05) { on++; break; }
        }
        if (on) acc.set(j, (acc.get(j) ?? 0) + (L * on) / n);
      }
      void mid;
    }
    pieces[i].touches = [...acc].map(([j, m]) => ({ j, ft: m / FT })).filter((t) => t.ft >= 1);
  }
  return { pieces, crosses, straddles: holders.size > 1 };
}

// ---------------------------------------------------------------- helping the hand
/** The site's main frontage: the longest run of lot line on one street, as a unit vector and its ends (local metres). */
function mainFront(geo: SiteGeo): { fr: Frame; r: XY[]; u: XY; a: XY; b: XY } {
  const fr = frameOf(geo.ring);
  const r = open(geo.ring).map((p) => toXY(fr, p));
  const streets = geo.streets.map((s) => ({ pts: s.pts.map((p) => toXY(fr, p)), w: s.w, id: s.id }));
  const fg = frontage(fr, r, streets);
  let a: XY, b: XY;
  if (fg.best) { a = fg.best.a; b = fg.best.b; }
  else {
    let bl = -1; a = r[0]; b = r[1];
    for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L > bl) { bl = L; a = p; b = q; } }
  }
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { fr, r, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], a, b };
}

/**
 * N LOTS OF EQUAL AREA ALONG THE FRONTAGE: cut lines square to the main
 * frontage, placed by bisection so each lot holds 1/N of the land — on a
 * rectangle that is equal frontage; on a wedge it is the fair version of it.
 */
export function equalCuts(geo: SiteGeo, n: number): SplitCut[] {
  n = Math.max(1, Math.floor(n));
  if (n < 2) return [];
  const { fr, r, u } = mainFront(geo);
  const total = Math.abs(area(r));
  const us = r.map((p) => p[0] * u[0] + p[1] * u[1]);
  const lo = Math.min(...us), hi = Math.max(...us);
  const nrm: XY = [-u[1], u[0]];
  const lineAt = (t: number): [XY, XY] => { const o: XY = [u[0] * t, u[1] * t]; return [o, [o[0] + nrm[0], o[1] + nrm[1]]]; };
  // the left of a line pointing along nrm is the side of lower u: the land below t
  const below = (t: number) => { const [a, b] = lineAt(t); const h = clipHalf(r, a, b, true); return h.length >= 3 ? Math.abs(area(h)) : 0; };
  const cuts: SplitCut[] = [];
  for (let k = 1; k < n; k++) {
    const want = (total * k) / n;
    let a = lo, b = hi;
    for (let it = 0; it < 50; it++) { const m = (a + b) / 2; if (below(m) < want) a = m; else b = m; }
    const [p, q] = lineAt((a + b) / 2);
    cuts.push([roundLL(toLL(fr, p)), roundLL(toLL(fr, q))]);
  }
  return cuts;
}

/**
 * A STRAIGHT CUT AT A FRACTION OF THE SITE: square to the main frontage at
 * `frac` of the way along it ("width"), or parallel to it at `frac` of the way
 * back ("depth": a front lot and a rear lot).
 */
export function fracCut(geo: SiteGeo, frac: number, along: "width" | "depth"): SplitCut {
  const { fr, r, u } = mainFront(geo);
  const nrm: XY = [-u[1], u[0]];
  const ax = along === "width" ? u : nrm, dir = along === "width" ? nrm : u;
  const ts = r.map((p) => p[0] * ax[0] + p[1] * ax[1]);
  const t = Math.min(...ts) + (Math.max(...ts) - Math.min(...ts)) * Math.min(1, Math.max(0, frac));
  const o: XY = [ax[0] * t, ax[1] * t];
  return [roundLL(toLL(fr, o)), roundLL(toLL(fr, [o[0] + dir[0] * 10, o[1] + dir[1] * 10]))];
}

/** The site in its frontage frame, for a desk to draw square to the street: corners and the frontage run, local metres. */
export function siteFrame(geo: SiteGeo): { u: XY; ring: XY[]; front: [XY, XY]; toLL: (p: XY) => LL; toXY: (p: LL) => XY } {
  const { fr, r, u, a, b } = mainFront(geo);
  return { u, ring: r, front: [a, b], toLL: (p) => toLL(fr, p), toXY: (p) => toXY(fr, p) };
}

/**
 * A HAND-DRAWN CUT, CLEANED UP: within 8 degrees of square to the main
 * frontage it snaps square (the way lot lines are actually drawn), within 8
 * degrees of parallel it snaps parallel, and its ends are moved to where the
 * line crosses the parcel boundary, so the recipe holds the line, not the drag.
 */
export function snapCut(geo: SiteGeo, p: LL, q: LL, snapDeg = 8): SplitCut {
  const { fr, r, u } = mainFront(geo);
  let a = toXY(fr, p), b = toXY(fr, q);
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 1e-3) return [roundLL(p), roundLL(q)];
  const cosU = Math.abs((dx * u[0] + dy * u[1]) / L);
  const tol = Math.cos(((90 - snapDeg) * Math.PI) / 180);   // |cos| below this is within snapDeg of square
  const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let dir: XY = [dx / L, dy / L];
  if (cosU <= tol) dir = [-u[1], u[0]];
  else if (cosU >= Math.cos((snapDeg * Math.PI) / 180)) dir = u;
  // extend through the ring: the line's extent over the parcel
  const ts = r.map((pt) => (pt[0] - mid[0]) * dir[0] + (pt[1] - mid[1]) * dir[1]);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  a = [mid[0] + dir[0] * t0, mid[1] + dir[1] * t0]; b = [mid[0] + dir[0] * t1, mid[1] + dir[1] * t1];
  return [roundLL(toLL(fr, a)), roundLL(toLL(fr, b))];
}

/** Square feet of a ring in degrees (for drawing checks). */
export function ringSf(ring: LL[]): number {
  const fr = frameOf(ring);
  return Math.abs(area(open(ring).map((p) => toXY(fr, p)))) * M2_SF;
}

/**
 * THE MAP AFTER THE SPLITS: every finished split's pieces drawn in place of its
 * parent, in the order they were recorded (a piece cut again later finds its
 * own ring here). Returns the new feature list; the pieces' properties come
 * from `props(bbl)`, the parent's feature where it returns nothing.
 */
export function applySplitFeatures<F extends { type?: string; id?: unknown; geometry: { type: string; coordinates: unknown }; properties?: Record<string, unknown> | null }>(
  features: F[], splits: { parent: string; cuts: SplitCut[]; n?: number; pieces: { bbl: string }[]; done?: boolean }[],
  props?: (bbl: string) => Record<string, unknown> | null,
  /** the city's context layer: a split recorded as N equal lots (a firm's) is cut square to its frontage on these streets */
  context?: FC | null,
): F[] {
  let out = features;
  for (const sp of splits) {
    if (!sp.done) continue;
    const at = out.findIndex((f) => String(f.properties?.bbl) === sp.parent);
    if (at < 0) continue;
    const f0 = out[at];
    const rings = ringsOf(f0.geometry);
    if (!rings.length) continue;
    const ring = rings.reduce((x, y) => (y.length > x.length ? y : x));
    let cuts = sp.cuts;
    if (!cuts.length && sp.n) {
      const site = siteGeometry({ features: [f0] as FC["features"] }, null, context ?? null, sp.parent);
      cuts = site ? equalCuts(site, sp.n) : [];
    }
    const rs = cutPieces(ring, cuts);
    if (rs.length !== sp.pieces.length) continue;   // a recipe the ring cannot reproduce stays undrawn rather than drawn wrong
    const add = sp.pieces.map((pc, i) => ({
      ...f0, id: Number(pc.bbl),
      geometry: { type: "Polygon", coordinates: [[...rs[i], rs[i][0]]] },
      properties: { ...(f0.properties ?? {}), ...(props?.(pc.bbl) ?? {}), bbl: pc.bbl },
    }) as F);
    out = [...out.slice(0, at), ...add, ...out.slice(at + 1)];
  }
  return out;
}
