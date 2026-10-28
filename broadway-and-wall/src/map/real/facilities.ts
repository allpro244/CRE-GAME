/**
 * THE COUNTRY ROUND THE MAP (region step 2c): the hinterland's ground and the
 * region's background facilities, drawn as landmarks in the city's own style.
 *
 * citygen/region/facilities.mjs places them and says what each is made of —
 * runways and a terminal, a yard full of cars, tanks and columns, potlines,
 * a stepped pit, fields, a cooling tower. This turns that into a handful of
 * meshes: the ground in five (land, fields, pads, roads and track, water and
 * paint), each facility's structures merged into one, and the things there
 * are many of (planes, rail cars, containers, trees) instanced per facility.
 *
 * LOD: the ground always draws (it is a few thousand triangles and it is what
 * the horizon is made of). A facility's structures vanish once it is far off
 * the camera's focus for the zoom, and its small things (planes, cars,
 * containers, trees) draw only when the camera is near enough to see them, so
 * the island at street level pays for none of it. Nothing casts a shadow.
 *
 * Looks only: nothing here is read by the engine, and the facilities are not
 * parcels — the page's picker asks `pick` for them only where no lot answers.
 */
import * as THREE from "three";
import type { RegionFacility, Hinterland, FacilityPart } from "@/citygen/index.mjs";

type P2 = [number, number];
type Proj = (ll: [number, number]) => P2;

// ---------------------------------------------------------------- colours
const hex = (h: number): number[] => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const PAD: Record<string, number> = {
  airfield: 0x93a86a, runway: 0x3c3e41, taxiway: 0x55575a, apron: 0x9d9b95, lot: 0x5a5c5f,
  ballast: 0x7a7168, concrete: 0xa3a09a, plant: 0x8e8a82, bund: 0x9c978c, scrap: 0x6d4c37, switchyard: 0x8a8985,
  quarry: 0xbab3a4, gravel: 0xb39e7f, farmyard: 0x8f8470, orchard: 0x6e8c4c, woods: 0x3f5d34, clearcut: 0x7d6c52,
  pier: 0x9b978f,
};
const LINE: Record<string, number> = { track: 0x4b4239, road: 0x505255, haul: 0x9c8a6c, pipeline: 0xa3ad80 };
const ROAD: Record<string, number> = { highway: 0x4b4d50, county: 0x515356, section: 0x56585b };
const BOX: Record<string, [number, number]> = {
  // walls, roof
  terminal: [0xe9e6de, 0x9ea3a8], hangar: [0xc9ccd0, 0x8c939a], shop: [0x9a6a4e, 0x5f6266], office: [0xd8d2c4, 0x6b6e72],
  jetbridge: [0xcfd2d4, 0xb5b8bb], unit: [0x6f7377, 0x55585c], cooling: [0x9aa3a8, 0x6e767b], boiler: [0xb9b6ae, 0x7c7f83],
  turbine: [0xa8b2ba, 0x6f777e], intake: [0x9a968e, 0x77746e], melt: [0x6f8796, 0x4f5961], shed: [0x8b9ba6, 0x5e666d],
  potline: [0xb7b2a6, 0x6d6f72], crusher: [0x9a8f7a, 0x6e6a62], house: [0xefece4, 0x5a4d45], barn: [0x9b3b2f, 0x4f4a46],
  machine: [0xa9adb0, 0x7d8286], packing: [0xd9d2c0, 0x6e6a64], pier: [0x8f8b84, 0x9b978f],
};
const CYL: Record<string, number> = { tank: 0xe6e4de, column: 0xb8bcbf, silo: 0xd0ccc2, bin: 0xc4c8cb };

// ---------------------------------------------------------------- a mesh builder
class Geo {
  p: number[] = []; n: number[] = []; c: number[] = []; uv: number[] | null = null;
  get count() { return this.p.length / 3; }
  /** A triangle; with `up`, wound (and lit) so its face looks that way. */
  tri(a: number[], b: number[], d: number[], col: number[], up?: number[]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (up && nx * up[0] + ny * up[1] + nz * up[2] < 0) { [b, d] = [d, b]; nx = -nx; ny = -ny; nz = -nz; }
    for (const q of [a, b, d]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
  }
  quad(a: number[], b: number[], c: number[], d: number[], col: number[], out?: number[]) { this.tri(a, b, c, col, out); this.tri(a, c, d, col, out); }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
const UP = [0, 0, 1];

/** A box on the ground plane: centre, unit axis u (w along it), d across, z0..z1; optional gable roof along u. */
function box(g: Geo, c: P2, u: P2, w: number, d: number, z0: number, z1: number, wall: number[], roof: number[], gable = false) {
  const v: P2 = [-u[1], u[0]];
  const C = (a: number, b: number, z: number) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, z];
  const hw = w / 2, hd = d / 2, eave = gable ? z0 + (z1 - z0) * 0.66 : z1;
  const ring: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = ring[i], [a1, b1] = ring[(i + 1) % 4];
    const out = [(a0 + a1) / 2 * u[0] + (b0 + b1) / 2 * v[0], (a0 + a1) / 2 * u[1] + (b0 + b1) / 2 * v[1], 0];
    // the shady sides a touch darker, so a box reads as a box from the air
    g.quad(C(a0, b0, z0), C(a1, b1, z0), C(a1, b1, eave), C(a0, b0, eave), wall, out);
  }
  if (!gable) { g.quad(C(-hw, -hd, z1), C(hw, -hd, z1), C(hw, hd, z1), C(-hw, hd, z1), roof, UP); return; }
  // a ridge along u: two slopes and two gable ends
  g.quad(C(-hw, -hd, eave), C(hw, -hd, eave), C(hw, 0, z1), C(-hw, 0, z1), roof, [v[0] * -1, v[1] * -1, 1]);
  g.quad(C(-hw, hd, eave), C(hw, hd, eave), C(hw, 0, z1), C(-hw, 0, z1), roof, [v[0], v[1], 1]);
  g.tri(C(-hw, -hd, eave), C(-hw, hd, eave), C(-hw, 0, z1), wall, [-u[0], -u[1], 0]);
  g.tri(C(hw, -hd, eave), C(hw, hd, eave), C(hw, 0, z1), wall, [u[0], u[1], 0]);
}
/** A cylinder or frustum standing at c, from z0 to z1, radius r0 at the bottom and r1 at the top; bands paint the top. */
function cyl(g: Geo, c: P2, r0: number, r1: number, z0: number, z1: number, col: number[], top: number[] | null, n = 14, bands: number[] | null = null) {
  const nb = bands ? 4 : 0, zb = z1 - (z1 - z0) * 0.22;
  const levels = bands ? [z0, zb, ...Array.from({ length: nb }, (_, i) => zb + ((z1 - zb) * (i + 1)) / nb)] : [z0, z1];
  const rAt = (z: number) => r0 + (r1 - r0) * ((z - z0) / ((z1 - z0) || 1));
  for (let k = 0; k + 1 < levels.length; k++) {
    const za = levels[k], zt = levels[k + 1], ra = rAt(za), rt = rAt(zt);
    const cc = bands && k > 0 ? (k % 2 ? bands : col) : col;
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
      const o = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
      g.quad([c[0] + ra * Math.cos(a0), c[1] + ra * Math.sin(a0), za], [c[0] + ra * Math.cos(a1), c[1] + ra * Math.sin(a1), za],
        [c[0] + rt * Math.cos(a1), c[1] + rt * Math.sin(a1), zt], [c[0] + rt * Math.cos(a0), c[1] + rt * Math.sin(a0), zt], cc, o);
    }
  }
  if (top) for (let i = 0; i < n; i++) {
    const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
    g.tri([c[0], c[1], z1], [c[0] + r1 * Math.cos(a0), c[1] + r1 * Math.sin(a0), z1], [c[0] + r1 * Math.cos(a1), c[1] + r1 * Math.sin(a1), z1], top, UP);
  }
}
/** A revolved profile [[r, z], ...] (a cooling tower's shell). */
function lathe(g: Geo, c: P2, prof: number[][], col: number[], n = 18) {
  for (let k = 0; k + 1 < prof.length; k++) {
    const [ra, za] = prof[k], [rt, zt] = prof[k + 1];
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
      const o = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
      g.quad([c[0] + ra * Math.cos(a0), c[1] + ra * Math.sin(a0), za], [c[0] + ra * Math.cos(a1), c[1] + ra * Math.sin(a1), za],
        [c[0] + rt * Math.cos(a1), c[1] + rt * Math.sin(a1), zt], [c[0] + rt * Math.cos(a0), c[1] + rt * Math.sin(a0), zt], col, o);
    }
  }
}
function sphere(g: Geo, c: P2, r: number, z: number, col: number[], n = 10, m = 6) {
  const P = (i: number, j: number) => { const th = (Math.PI * j) / m, ph = (2 * Math.PI * i) / n; return [c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), z + r * Math.cos(th)]; };
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const a = P(i, j), b = P(i + 1, j), d = P(i + 1, j + 1), e = P(i, j + 1);
    const mid = [(a[0] + d[0]) / 2 - c[0], (a[1] + d[1]) / 2 - c[1], (a[2] + d[2]) / 2 - z];
    if (j === 0) g.tri(a, d, e, col, mid); else if (j === m - 1) g.tri(a, b, d, col, mid); else g.quad(a, b, d, e, col, mid);
  }
}
function cone(g: Geo, c: P2, r: number, h: number, col: number[], n = 10) {
  for (let i = 0; i < n; i++) {
    const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
    g.tri([c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0), 0.05], [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1), 0.05], [c[0], c[1], h], col, [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0.6]);
  }
}
/** A long heap: base w x d along u, a ridge at h. */
function mound(g: Geo, c: P2, u: P2, w: number, d: number, h: number, col: number[]) {
  const v: P2 = [-u[1], u[0]];
  const C = (a: number, b: number, z: number) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, z];
  const a0 = w / 2, a1 = w * 0.22, b0 = d / 2, b1 = d * 0.12;
  const base = [C(-a0, -b0, 0.05), C(a0, -b0, 0.05), C(a0, b0, 0.05), C(-a0, b0, 0.05)];
  const top = [C(-a1, -b1, h), C(a1, -b1, h), C(a1, b1, h), C(-a1, b1, h)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, mx = (base[i][0] + base[j][0]) / 2 - c[0], my = (base[i][1] + base[j][1]) / 2 - c[1];
    g.quad(base[i], base[j], top[j], top[i], col, [mx, my, 0.5]);
  }
  g.quad(top[0], top[1], top[2], top[3], col, UP);
}
/** A flat ribbon along a polyline at height z (the ground's roads, tracks and water). */
function ribbon(g: Geo, pts: P2[], w: number, z: number, col: number[]) {
  if (pts.length < 2) return;
  const h = w / 2;
  const nrm = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], na = nrm[i], nb = nrm[i + 1];
    g.quad([a[0] + na[0] * h, a[1] + na[1] * h, z], [a[0] - na[0] * h, a[1] - na[1] * h, z], [b[0] - nb[0] * h, b[1] - nb[1] * h, z], [b[0] + nb[0] * h, b[1] + nb[1] * h, z], col, UP);
  }
}
/** A flat polygon (with holes) at height z, triangulated. */
function flat(g: Geo, ring: P2[], holes: P2[][], z: number, col: number[], uvOf?: (p: P2) => [number, number]) {
  if (ring.length < 3) return;
  let tris: number[][] = [];
  try { tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)))); } catch { return; }
  const all = [...ring, ...holes.flat()];
  for (const t of tris) {
    const [a, b, c] = t.map((i) => all[i]);
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const q = cr >= 0 ? [a, b, c] : [a, c, b];
    for (const p of q) {
      g.p.push(p[0], p[1], z); g.n.push(0, 0, 1); g.c.push(col[0], col[1], col[2]);
      if (uvOf) { const t2 = uvOf(p); (g.uv ??= []).push(t2[0], t2[1]); }
    }
  }
}
const ellipse = (c: P2, u: P2, a: number, b: number, n = 28): P2[] => {
  const v: P2 = [-u[1], u[0]];
  return Array.from({ length: n }, (_, i) => { const t = (2 * Math.PI * i) / n; return [c[0] + u[0] * a * Math.cos(t) + v[0] * b * Math.sin(t), c[1] + u[1] * a * Math.cos(t) + v[1] * b * Math.sin(t)] as P2; });
};
const inRing = (r: P2[], x: number, y: number) => {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins; }
  return ins;
};
const hash = (n: number) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };

// ---------------------------------------------------------------- the small things, one model each (facing +x)
function propGeo(kind: string): THREE.BufferGeometry {
  const g = new Geo();
  const X: P2 = [1, 0], O: P2 = [0, 0];
  const W = hex(0xf2f2ee), GR = hex(0x8f959b), DK = hex(0x30353a);
  switch (kind) {
    case "jet": // a regional jet: 36 m, 26 m span
      box(g, O, X, 34, 3.4, 1.6, 5.0, W, W);
      box(g, [17.5, 0], X, 3, 2.6, 2.0, 4.6, W, W);
      box(g, [1, 0], X, 5, 26, 2.2, 2.7, GR, GR);
      box(g, [-15, 0], X, 4.5, 0.5, 5.0, 11, hex(0x1f4f8a), hex(0x1f4f8a));
      box(g, [-16, 0], X, 3, 9, 10.2, 10.7, GR, GR);
      break;
    case "ga": // a high-wing single: 8 m, 11 m span
      box(g, O, X, 7.5, 1.3, 0.6, 2.0, W, W);
      box(g, [0.6, 0], X, 1.6, 11, 1.9, 2.15, W, W);
      box(g, [-3.4, 0], X, 1.2, 0.2, 1.6, 3.0, hex(0xb0302a), hex(0xb0302a));
      break;
    case "boxcar": box(g, O, X, 16.5, 3.2, 1.1, 4.7, W, W); break;
    case "hopper": box(g, O, X, 16.5, 3.2, 1.0, 4.3, W, W); break;
    case "gondola": box(g, O, X, 16.5, 3.2, 1.0, 2.6, W, hex(0x2c2a28)); break;
    case "tank": for (let i = -1; i <= 1; i++) box(g, [i * 5.4, 0], X, 5.6, 3.0, 1.2, 4.2, W, W); break;
    case "loco": box(g, O, X, 21, 3.1, 1.1, 4.6, W, W); box(g, [7.5, 0], X, 4, 3.1, 4.6, 5.0, DK, DK); break;
    case "well": box(g, O, X, 19.5, 2.8, 0.8, 1.4, hex(0x3d3a37), hex(0x3d3a37)); break;
    case "box": box(g, O, X, 12.2, 2.44, 0, 2.6, W, W); break;
    case "haul": box(g, O, X, 10, 5.5, 0.8, 4.8, W, W); break;
    case "tanker": box(g, O, X, 180, 30, -6, 6, hex(0x2a2c2f), hex(0x7d3a2e)); box(g, [-78, 0], X, 18, 24, 6, 20, W, W); break;
    case "barge": box(g, O, X, 60, 15, -1, 2.2, hex(0x5a3a2a), hex(0x2a2c2f)); break;
    case "pylon": box(g, O, X, 1, 1, 0, 9, GR, GR); box(g, O, [0, 1], 9, 0.5, 8, 8.6, GR, GR); break;
    case "logs": box(g, O, X, 12, 5, 0, 3, W, W); break;
    case "tree": sphere(g, [0, 0], 1, 1.25, W, 7, 4); cyl(g, O, 0.12, 0.12, 0, 0.5, hex(0x4a3b2e), null, 5); break;
    default: box(g, O, X, 4, 2, 0, 2, W, W);
  }
  return g.geometry();
}
const RAILCAR_COL = [0x7a3b28, 0x8c5a2b, 0x5b4637, 0x2f5a3d].map(hex);
const LOCO_COL = [0x1c3f78, 0xd8742a].map(hex);
const BOX_COL = [0xb5452f, 0x2d5d8c, 0xd9a43a, 0x3f7d4f, 0x8e9599, 0xc9c4b8].map(hex);
const HOPPER_COL = hex(0x9a9690), TANK_COL = hex(0x2c2e30), GONDOLA_COL = hex(0x5a3c2c);
const JET_COL = [0xffffff, 0xf3f0ea, 0xe9eef5].map(hex), GA_COL = [0xffffff, 0xf0e7d0, 0xdfe6ee, 0xf2f2f2].map(hex);

// ---------------------------------------------------------------- the season on the fields
// [S, approximate: the Illinois crop calendar] corn and beans planted in May, full canopy by July, gold in
// September, harvested by November; winter wheat green from autumn, cut in July; hay green April-October.
const CROP_TONE: Record<string, number[][]> = {
  //          winter          spring          summer          harvest
  corn:   [[0.55, 0.47, 0.36], [0.5, 0.44, 0.32], [0.33, 0.5, 0.2], [0.72, 0.64, 0.38]],
  soy:    [[0.52, 0.45, 0.35], [0.48, 0.42, 0.31], [0.4, 0.56, 0.24], [0.66, 0.56, 0.3]],
  wheat:  [[0.42, 0.5, 0.3], [0.38, 0.56, 0.26], [0.78, 0.68, 0.4], [0.6, 0.55, 0.38]],
  hay:    [[0.5, 0.5, 0.34], [0.4, 0.55, 0.28], [0.42, 0.58, 0.28], [0.5, 0.55, 0.32]],
  fallow: [[0.5, 0.42, 0.32], [0.46, 0.44, 0.3], [0.5, 0.5, 0.33], [0.52, 0.46, 0.33]],
  woods:  [[0.36, 0.33, 0.28], [0.3, 0.42, 0.24], [0.22, 0.36, 0.18], [0.45, 0.36, 0.2]],
};
const SEASON = [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 0, 0];

export interface Backdrop {
  root: THREE.Group;
  /** The sea stops at this outline (local metres): the window's land and the drawn country together. */
  shore: P2[] | null;
  update(fx: number, fy: number, distM: number): void;
  setMonth(m: number, snow: number): void;
  /** The facility whose fence the ground point (local metres) is inside. */
  pick(x: number, y: number): RegionFacility | null;
  /** A facility's middle and reach (local metres), for framing a camera on it. */
  frameOf(id: string): { c: P2; r: number; h: number } | null;
  /** What it draws, for the frame-cost note. */
  stats(): { meshes: number; tris: number; instances: number };
}

/**
 * Build the hinterland and its facilities. `ground` is the city's own rough-grass material, so the country
 * past the window is the same grass, in the same season, as the unbuilt land inside it.
 */
export function buildBackdrop(facs: RegionFacility[], hint: Hinterland, project: Proj, ground: THREE.Material): Backdrop {
  const root = new THREE.Group();
  root.name = "region-backdrop";
  const P = (ll: [number, number]) => project(ll);
  const ring = (r: [number, number][]) => r.map(P);

  // ------------------------------------------------ materials
  const flatMat = (offset: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, envMapIntensity: 0.15, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 2, ...extra,
  });
  // the ground is layered by depth offset, not by height: from a few kilometres up a centimetre is nothing
  // to the depth buffer. Land, then fields and a facility's own ground, then its yards and aprons, then
  // the water, the roads and the track, then paint.
  const padMat = flatMat(-1), hiMat = flatMat(-1.5), roadMat = flatMat(-2.5), paintMat = flatMat(-3.5, { roughness: 0.6 });
  const fieldTex = (() => {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 4;
    const g2 = cv.getContext("2d")!;
    for (let x = 0; x < 64; x++) { const v = 205 + ((x % 8) < 4 ? 38 : 0) + ((x * 37) % 11); g2.fillStyle = `rgb(${v},${v},${v})`; g2.fillRect(x, 0, 1, 4); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  })();
  const fieldMat = flatMat(-1, { map: fieldTex });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f6a8f, roughness: 0.18, metalness: 0, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  /** a facility's whole-site ground (under its yards); everything else on a site lies over it */
  const BASE_PAD = new Set(["airfield", "plant", "ballast", "quarry", "gravel", "woods", "orchard"]);
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, flatShading: true, envMapIntensity: 0.35 });
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, flatShading: true, envMapIntensity: 0.35 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, envMapIntensity: 0.1 });
  const steamMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 0.4, flatShading: true });
  const geos = new Map<string, THREE.BufferGeometry>();
  const geoOf = (k: string) => { let g = geos.get(k); if (!g) geos.set(k, (g = propGeo(k))); return g; };

  // ------------------------------------------------ the pits are holes in the ground (it sinks; the sea does not
  // lie under the country, see RealCityLayer's sea)
  const pits: { ring: P2[]; part: FacilityPart; fac: RegionFacility }[] = [];
  for (const f of facs) for (const p of f.parts) if (p.t === "pit" && p.c && p.u) {
    const c = P(p.c), u = p.u as P2;
    pits.push({ ring: ellipse(c, u, Number(p.a), Number(p.b)), part: p, fac: f });
  }
  const holesIn = (outer: P2[]) => pits.filter((q) => inRing(outer, q.ring[0][0] * 0.5 + q.ring[14][0] * 0.5, q.ring[0][1] * 0.5 + q.ring[14][1] * 0.5)).map((q) => q.ring);

  // ------------------------------------------------ the land
  const landG = new Geo();
  for (const poly of hint.land) {
    const [outer, ...holes] = poly.map(ring);
    flat(landG, outer, [...holes, ...holesIn(outer)], 0, [1, 1, 1]);
  }
  const landMesh = new THREE.Mesh(landG.geometry(), ground);
  landMesh.renderOrder = -2.5;
  root.add(landMesh);

  // ------------------------------------------------ the fields (and the farms' own), recoloured with the season
  type Field = { ring: P2[]; k: string; tone: number; start: number; n: number };
  const fields: Field[] = [];
  const fieldG = new Geo();
  const addField = (r: P2[], k: string, rows: P2, salt: number) => {
    const start = fieldG.count, tone = 0.9 + 0.2 * hash(salt);
    const px: P2 = [-rows[1], rows[0]];
    flat(fieldG, r, [], 0.02, [1, 1, 1], (p) => [(p[0] * px[0] + p[1] * px[1]) / 12, (p[0] * rows[0] + p[1] * rows[1]) / 40]);
    fields.push({ ring: r, k, tone, start, n: fieldG.count - start });
  };
  hint.fields.forEach((f, i) => addField(ring(f.ring), f.k, f.rows as P2, i * 7919 + 13));
  for (const f of facs) for (const [j, p] of f.parts.entries()) if (p.t === "pad" && String(p.k).startsWith("crop:") && p.ring) addField(ring(p.ring), String(p.k).slice(5), (p.rows as P2) ?? [1, 0], j * 104729 + f.id.length);
  const fieldGeo = fieldG.geometry();
  const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
  fieldMesh.renderOrder = -2.4;
  root.add(fieldMesh);

  // ------------------------------------------------ roads, the main line, the river past the window
  const roadG = new Geo();
  for (const r of hint.roads) ribbon(roadG, ring(r.pts), r.w, 0.05, hex(ROAD[r.kind] ?? ROAD.section));
  for (const r of hint.rail) { const pl = ring(r.pts); ribbon(roadG, pl, 5.5, 0.05, hex(0x6f675e)); ribbon(roadG, pl, 2.4, 0.07, hex(0x3d352e)); }
  const waterG = new Geo();
  for (const w of hint.water) {
    const pl = ring(w.pts);
    ribbon(waterG, pl, w.w, 0.04, [1, 1, 1]);
    // round the bends: a disc at each vertex closes the gaps a mitre-less ribbon leaves
    for (let i = 0; i < pl.length; i += 3) flat(waterG, ellipse(pl[i], [1, 0], w.w / 2, w.w / 2, 12), [], 0.04, [1, 1, 1]);
  }

  // ------------------------------------------------ each facility
  const padG = new Geo(), hiG = new Geo(), paintG = new Geo();
  type Fac = { f: RegionFacility; group: THREE.Group; props: THREE.Group; c: P2; r: number; h: number; ring: P2[] };
  const list: Fac[] = [];
  let instances = 0;
  for (const f of facs) {
    const shell = new Geo(), steam = new Geo();
    const group = new THREE.Group(), props = new THREE.Group();
    group.name = f.id;
    const fr = ring(f.footprint);
    let cx = 0, cy = 0;
    for (const [x, y] of fr) { cx += x / fr.length; cy += y / fr.length; }
    let rad = 0;
    for (const [x, y] of fr) rad = Math.max(rad, Math.hypot(x - cx, y - cy));
    let tall = 0;
    const inst = new Map<string, { at: number[][]; col: number[][] }>();
    const putInst = (k: string, x: number, y: number, z: number, ang: number, s: number, col: number[]) => {
      let l = inst.get(k); if (!l) inst.set(k, (l = { at: [], col: [] }));
      l.at.push([x, y, z, ang, s]); l.col.push(col);
    };
    for (const p of f.parts) {
      const k = String(p.k ?? "");
      if (p.t === "pad" && p.ring) {
        if (k.startsWith("crop:")) continue;
        const r = ring(p.ring);
        flat(BASE_PAD.has(k) ? padG : hiG, r, holesIn(r), BASE_PAD.has(k) ? 0.015 : 0.03, hex(PAD[k] ?? 0x8e8a82));
        if (k === "runway" && p.u) runwayPaint(paintG, r, p.u as P2, Number(p.len) || 2400);
      } else if (p.t === "line" && p.pts) {
        const pl = ring(p.pts);
        if (k === "jetty") { for (let i = 0; i + 1 < pl.length; i++) { const a = pl[i], b = pl[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 1) box(shell, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [(b[0] - a[0]) / L, (b[1] - a[1]) / L], L, Number(p.w) || 10, 0, 3, hex(0x8f8b84), hex(0x9b978f)); } }
        else ribbon(k === "pipeline" ? hiG : roadG, pl, Number(p.w) || 4, k === "pipeline" ? 0.03 : 0.06, hex(LINE[k] ?? 0x505255));
        if (k === "track") ribbon(roadG, pl, 1.6, 0.075, hex(0x3a322b));
      } else if (p.t === "box" && p.c && p.u) {
        const [wc, rc] = BOX[k] ?? [0xa0a0a0, 0x707070];
        const z0 = Number(p.z0 ?? 0.05), h = Number(p.h);
        box(shell, P(p.c), p.u as P2, Number(p.w), Number(p.d), z0, z0 + h, hex(wc), hex(rc), p.roof === "gable");
        if (k === "cooling" && p.fans) { const c = P(p.c), u = p.u as P2; for (let i = 0; i < Number(p.fans); i++) { const a = -Number(p.w) / 2 + (Number(p.w) * (i + 0.5)) / Number(p.fans); cyl(shell, [c[0] + u[0] * a, c[1] + u[1] * a], 4.2, 4.6, z0 + h, z0 + h + 3, hex(0x7d868b), hex(0x30363a), 10); } }
        if (p.steam) puff(steam, P(p.c), Math.min(Number(p.w), 60) * 0.35, z0 + h + 6);
        tall = Math.max(tall, z0 + h);
      } else if ((p.t === "cyl") && p.c) {
        const c = P(p.c), r = Number(p.r), h = Number(p.h);
        const col = hex(CYL[k] ?? 0xc8c8c8);
        cyl(shell, c, r, r, 0.05, h, col, k === "tank" ? hex(0xd6d3cb) : hex(0x9a9ea2), r > 20 ? 24 : r > 6 ? 16 : 10);
        if (p.cap) capCone(shell, c, r, h, hex(0xb7bbbe));
        tall = Math.max(tall, h);
      } else if (p.t === "stack" && p.c) {
        const c = P(p.c), r0 = Number(p.r), r1 = Number(p.r2 ?? r0 * 0.85), h = Number(p.h);
        // [S: FAA AC 70/7460-1: a stack over 200 ft is banded orange/red and white at the top]
        const banded = h > 61;
        cyl(shell, c, r0, r1, 0.05, h, hex(k === "chimney" ? 0xb9b6ae : 0xa7a9ab), hex(0x2a2b2c), 12, banded ? hex(0xc8442f) : null);
        if (k === "flare") cyl(shell, c, r1 * 2.2, r1 * 2.2, h, h + 2.5, hex(0x55585b), hex(0x2a2b2c), 8);
        tall = Math.max(tall, h);
      } else if (p.t === "ctower" && p.c) {
        const c = P(p.c), R = Number(p.r), H = Number(p.h);
        lathe(shell, c, [[R, 0], [R * 0.88, H * 0.22], [R * 0.75, H * 0.48], [R * 0.66, H * 0.72], [R * 0.63, H * 0.82], [R * 0.66, H]], hex(0xc9c6bf), 20);
        flat(shell, ellipse(c, [1, 0], R * 0.64, R * 0.64, 20), [], H - 3, hex(0x55595c));
        if (p.steam) puff(steam, c, R * 0.7, H + 14);
        tall = Math.max(tall, H);
      } else if (p.t === "sphere" && p.c) {
        const r = Number(p.r);
        sphere(shell, P(p.c), r, r + 3, hex(0xe9e7e1), 12, 7);
        cyl(shell, P(p.c), r * 0.35, r * 0.35, 0.05, 3.5, hex(0x8a8d90), null, 8);
      } else if (p.t === "cone" && p.c) {
        cone(shell, P(p.c), Number(p.r), Number(p.h), hex(k === "sand" ? 0xc9ac80 : 0xc9c4b8), 12);
      } else if (p.t === "mound" && p.c && p.u) {
        mound(shell, P(p.c), p.u as P2, Number(p.w), Number(p.d), Number(p.h), hex(k === "coal" ? 0x2e2c2a : 0x6a4a36));
      } else if (p.t === "tower" && p.c) {
        const c = P(p.c), r = Number(p.r), h = Number(p.h);
        cyl(shell, c, r, r * 0.9, 0.05, h - 7, hex(0xdedbd3), null, 10);
        cyl(shell, c, r * 1.7, r * 2.0, h - 7, h - 2, hex(0x34434f), null, 8);
        cyl(shell, c, r * 2.1, r * 2.1, h - 2, h - 1.2, hex(0xefefea), hex(0xefefea), 8);
        cyl(shell, c, 0.25, 0.25, h - 1.2, h + 4, hex(0x9a9a9a), null, 4);
        tall = Math.max(tall, h);
      } else if (p.t === "gantry" && p.c && p.u) {
        const c = P(p.c), u = p.u as P2, v: P2 = [-u[1], u[0]], span = Number(p.span), h = Number(p.h), len = Number(p.len);
        const Y = hex(0xd9a32e);
        for (const sa of [-1, 1]) for (const sb of [-1, 1]) box(shell, [c[0] + u[0] * sa * span / 2 + v[0] * sb * len / 2, c[1] + u[1] * sa * span / 2 + v[1] * sb * len / 2], u, 1.4, 1.4, 0.05, h, Y, Y);
        for (const sb of [-1, 1]) box(shell, [c[0] + v[0] * sb * len / 2, c[1] + v[1] * sb * len / 2], u, span + 8, 1.8, h - 2.2, h, Y, Y);
        box(shell, c, u, 6, len, h - 3.5, h - 1, hex(0x2f5d8a), hex(0x2f5d8a));
      } else if (p.t === "rack" && p.pts) {
        const pl = ring(p.pts), w = Number(p.w), h = Number(p.h);
        const col = hex(k === "conveyor" ? 0x8a8f94 : 0x7b8086);
        for (let i = 0; i + 1 < pl.length; i++) {
          const a = pl[i], b = pl[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 2) continue;
          const u: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
          if (k === "conveyor") {
            // a gallery climbing from the ground at the pile to the crusher's head
            const n = Math.max(2, Math.ceil(L / 15));
            for (let j = 0; j < n; j++) { const t0 = j / n, t1 = (j + 1) / n, zA = 1 + (h - 1) * (1 - t0), zB = 1 + (h - 1) * (1 - t1); box(shell, [a[0] + (b[0] - a[0]) * (t0 + t1) / 2, a[1] + (b[1] - a[1]) * (t0 + t1) / 2], u, L / n, w, (zA + zB) / 2 - 0.6, (zA + zB) / 2 + 0.6, col, col); }
          } else {
            box(shell, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u, L, w, h - 1.4, h, col, col);
            for (let t = 0; t < L; t += 24) box(shell, [a[0] + u[0] * t, a[1] + u[1] * t], u, 0.8, w, 0.05, h - 1.4, col, col);
          }
        }
      } else if (p.t === "pit") {
        const q = pits.find((x) => x.part === p);
        if (q) pit(shell, q.part, P(p.c as [number, number]), p.u as P2);
      } else if (p.t === "inst" && p.at) {
        for (const e of p.at as (number | string)[][]) {
          const [lon, lat, ang, s, col, z, kk] = e as [number, number, number, number, number, number, string];
          const [x, y] = P([lon, lat]);
          const kind = String(kk);
          const ci = Number(col) || 0;
          const C = kind === "boxcar" ? RAILCAR_COL[ci % 4] : kind === "loco" ? LOCO_COL[ci % 2] : kind === "box" ? BOX_COL[ci % BOX_COL.length]
            : kind === "hopper" ? HOPPER_COL : kind === "tank" ? TANK_COL : kind === "gondola" ? GONDOLA_COL
            : kind === "jet" ? JET_COL[ci % 3] : kind === "ga" ? GA_COL[ci % 4] : kind === "haul" ? hex(0xe0a526) : kind === "logs" ? hex(0x8a6a48) : hex(0xffffff);
          // a container rides a well car a metre up; stacked boxes climb by their height
          const zz = kind === "box" ? (Number(z) || 0) * 2.6 + (f.kind === "railyard" && hasWell(p, lon, lat) ? 1.0 : 0.05) : 0.05;
          putInst(kind, x, y, zz, Number(ang) || 0, Number(s) || 1, C);
        }
      } else if (p.t === "scatter" && p.ring) {
        const r = ring(p.ring), hole = p.hole ? ring(p.hole) : null, step = Number(p.step) || 20;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        let n = 0;
        for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
          const hh = hash((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663)), jx = x + (hh - 0.5) * step * 0.8, jy = y + (hash(n++ * 2654435761) - 0.5) * step * 0.8;
          if (!inRing(r, jx, jy) || (hole && inRing(hole, jx, jy))) continue;
          const s = 4.5 + 3.5 * hh, g2 = 0.75 + 0.4 * hash(n * 97);
          putInst("tree", jx, jy, 0, hh * 6.28, s, [0.22 * g2, 0.36 * g2, 0.17 * g2]);
        }
      } else if (p.t === "rows" && p.c && p.u) {
        const c = P(p.c), u = p.u as P2, v: P2 = [-u[1], u[0]], w = Number(p.w), d = Number(p.d), al = Number(p.along), ac = Number(p.across);
        let n = 0;
        for (let a = -w / 2; a <= w / 2; a += al) for (let b = -d / 2; b <= d / 2; b += ac) {
          const hh = hash(n++ * 40503 + 7);
          if (hh < 0.04) continue;   // a gap where a tree was lost
          putInst("tree", c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, 0, hh * 6.28, 2.6 + hh * 0.6, [0.3, 0.42 + 0.06 * hh, 0.2]);
        }
      }
    }
    // the structures: one mesh; steam: one more
    if (shell.count) { const m = new THREE.Mesh(shell.geometry(), shellMat); group.add(m); }
    if (steam.count) { const m = new THREE.Mesh(steam.geometry(), steamMat); m.renderOrder = 3; group.add(m); }
    for (const [k, l] of inst) {
      const geo = geoOf(k);
      const mesh = new THREE.InstancedMesh(geo, k === "tree" ? leafMat : propMat, l.at.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
      l.at.forEach(([x, y, z, ang, s], i) => {
        q.setFromEuler(e.set(0, 0, ang));
        mesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q, k === "tree" ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s, s, s)));
        mesh.setColorAt(i, col.setRGB(l.col[i][0], l.col[i][1], l.col[i][2]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      props.add(mesh);
      instances += l.at.length;
    }
    group.add(props);
    root.add(group);
    list.push({ f, group, props, c: [cx, cy], r: rad, h: tall, ring: fr });
  }
  const padMesh = new THREE.Mesh(padG.geometry(), padMat); padMesh.renderOrder = -2.3; root.add(padMesh);
  if (hiG.count) { const m = new THREE.Mesh(hiG.geometry(), hiMat); m.renderOrder = -2.25; root.add(m); }
  const roadMesh = new THREE.Mesh(roadG.geometry(), roadMat); roadMesh.renderOrder = -2.2; root.add(roadMesh);
  const waterMesh = new THREE.Mesh(waterG.geometry(), waterMat); waterMesh.renderOrder = -2.2; root.add(waterMesh);
  if (paintG.count) { const m = new THREE.Mesh(paintG.geometry(), paintMat); m.renderOrder = -2.1; root.add(m); }
  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  // ------------------------------------------------ the season
  const setMonth = (m: number, snow: number) => {
    const sIdx = SEASON[((m % 12) + 12) % 12];
    const col = fieldGeo.getAttribute("color") as THREE.BufferAttribute;
    const white = [0.88, 0.9, 0.93], sn = Math.min(1, snow) * 0.55;
    for (const fd of fields) {
      const tone = (CROP_TONE[fd.k] ?? CROP_TONE.fallow)[sIdx];
      // the field texture is near white; the vertex colour is the crop's albedo, a little lifted (sRGB-ish look)
      const r = (tone[0] * fd.tone) * (1 - sn) + white[0] * sn, g = (tone[1] * fd.tone) * (1 - sn) + white[1] * sn, b = (tone[2] * fd.tone) * (1 - sn) + white[2] * sn;
      for (let i = fd.start; i < fd.start + fd.n; i++) col.setXYZ(i, r, g, b);
    }
    col.needsUpdate = true;
  };
  setMonth(6, 0);

  // ------------------------------------------------ the shore: where the sea stops (the window's land and the country)
  const shore = hint.shoreline?.length ? ring(hint.shoreline) : null;

  return {
    root,
    shore,
    update(fx, fy, distM) {
      // vanish far off the focus; small things only when the camera is near enough to see them
      const far = Math.max(5200, distM * 5), near = Math.max(1600, distM * 1.9), propsOk = distM < 9000;
      for (const F of list) {
        const d = Math.max(0, Math.hypot(F.c[0] - fx, F.c[1] - fy) - F.r);
        F.group.visible = d < far;
        F.props.visible = F.group.visible && propsOk && d < near;
      }
    },
    setMonth,
    pick(x, y) {
      for (const F of list) if (Math.hypot(x - F.c[0], y - F.c[1]) <= F.r + 1 && inRing(F.ring, x, y)) return F.f;
      return null;
    },
    frameOf(id) { const F = list.find((q) => q.f.id === id); return F ? { c: F.c, r: F.r, h: F.h } : null; },
    stats() {
      let meshes = 0, tris = 0, inst = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        const n = (m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3;
        const k = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
        tris += n * k; if (k > 1) inst += k;
      });
      return { meshes, tris: Math.round(tris), instances: inst };
    },
  };

  /** A container on a loading track stands on a well car: is there one under this point? */
  function hasWell(p: FacilityPart, lon: number, lat: number) {
    for (const e of p.at as (number | string)[][]) if (e[7] === "well" && Math.abs(Number(e[0]) - lon) < 1e-6 && Math.abs(Number(e[1]) - lat) < 1e-6) return true;
    return false;
  }
}

/** A bin's conical lid. */
function capCone(g: Geo, c: P2, r: number, h: number, col: number[]) {
  const n = 12, rise = r * 0.45;
  for (let i = 0; i < n; i++) {
    const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
    g.tri([c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0), h], [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1), h], [c[0], c[1], h + rise], col, [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 1]);
  }
}
/** A little steam over a cooling tower or a cell bank: three soft lumps, white, half see-through. */
function puff(g: Geo, c: P2, r: number, z: number) {
  const W = [1, 1, 1];
  sphere(g, c, r, z, W, 9, 5);
  sphere(g, [c[0] + r * 0.6, c[1] + r * 0.25], r * 0.75, z + r * 0.5, W, 8, 5);
  sphere(g, [c[0] + r * 1.2, c[1] + r * 0.45], r * 0.55, z + r * 0.9, W, 7, 4);
}
/** Runway paint [S: FAA AC 150/5340-1: threshold bars, a dashed centreline, aiming points, edge lines]. */
function runwayPaint(g: Geo, r: P2[], u: P2, len: number) {
  let cx = 0, cy = 0;
  for (const [x, y] of r) { cx += x / r.length; cy += y / r.length; }
  const v: P2 = [-u[1], u[0]];
  let wid = 0;
  for (const [x, y] of r) wid = Math.max(wid, Math.abs((x - cx) * v[0] + (y - cy) * v[1]));
  const W = [0.95, 0.95, 0.93], Z = 0.045;
  const strip = (a0: number, a1: number, b0: number, b1: number) => {
    const C = (a: number, b: number) => [cx + u[0] * a + v[0] * b, cy + u[1] * a + v[1] * b, Z];
    g.quad(C(a0, b0), C(a1, b0), C(a1, b1), C(a0, b1), W, UP);
  };
  const L = len / 2;
  for (const sd of [-1, 1]) {
    // threshold: eight bars each side of the centreline, 46 m long
    for (let i = 0; i < 8; i++) { const b = 2.5 + i * 2.6; for (const s2 of [-1, 1]) strip(sd * (L - 6), sd * (L - 52), s2 * b, s2 * (b + 1.8)); }
    // aiming point bars 305 m in
    for (const s2 of [-1, 1]) strip(sd * (L - 300), sd * (L - 345), s2 * 6, s2 * 15);
  }
  for (let a = -L + 70; a < L - 70; a += 61) strip(a, a + 36, -0.5, 0.5);
  for (const s2 of [-1, 1]) strip(-L + 4, L - 4, s2 * (wid - 1.6), s2 * (wid - 0.7));
}
/** A stepped pit: benches and faces down to a floor (a pond in a wet gravel pit). */
function pit(g: Geo, p: FacilityPart, c: P2, u: P2) {
  const a = Number(p.a), b = Number(p.b), steps = Number(p.steps) || 3, bench = Number(p.bench) || 10, inset = Number(p.inset) || 25;
  const lime = p.k === "lime";
  const FACE = hex(lime ? 0xcfc8b8 : 0xb89c76), BENCH = hex(lime ? 0xa8a090 : 0x9c8462), FLOOR = hex(lime ? 0x9b9384 : 0x8a7658);
  const n = 28;
  let ra = a, rb = b;
  for (let i = 0; i < steps; i++) {
    const z0 = -i * bench, z1 = -(i + 1) * bench;
    const top = ellipse(c, u, ra, rb, n), ra2 = ra - inset * 0.35, rb2 = rb - inset * 0.35;
    const bot = ellipse(c, u, ra2, rb2, n);
    // the face, inward
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n, mx = (top[k][0] + top[j][0]) / 2 - c[0], my = (top[k][1] + top[j][1]) / 2 - c[1];
      g.quad([top[k][0], top[k][1], z0], [top[j][0], top[j][1], z0], [bot[j][0], bot[j][1], z1], [bot[k][0], bot[k][1], z1], FACE, [-mx, -my, 0.3]);
    }
    // the bench below it
    ra = ra2 - inset * 0.65; rb = rb2 - inset * 0.65;
    if (i < steps - 1) {
      const inner = ellipse(c, u, ra, rb, n);
      for (let k = 0; k < n; k++) { const j = (k + 1) % n; g.quad([bot[k][0], bot[k][1], z1], [bot[j][0], bot[j][1], z1], [inner[j][0], inner[j][1], z1], [inner[k][0], inner[k][1], z1], BENCH, UP); }
    } else {
      flat(g, bot, [], z1, p.pond ? hex(0x3b6e7f) : FLOOR);
    }
  }
}
