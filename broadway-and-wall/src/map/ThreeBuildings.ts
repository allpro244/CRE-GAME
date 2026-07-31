// The beautiful-buildings renderer: a Three.js custom layer inside MapLibre.
// Every building is a real mesh with a procedural facade — window grids
// aligned to actual floor counts, ~12 skin families by age and class,
// view-dependent sky reflections on glass, cornices, gabled colonial roofs,
// and instanced rooftop furniture. MapLibre still owns the ground map,
// camera, and picking.
import * as THREE from "three";
import maplibregl from "maplibre-gl";

export interface BuildingVolume {
  b: string;   // bbl ("" for decorative props like ships and cranes)
  c: string;   // asset class
  y: number;   // year built
  t: number;   // tone jitter 0-4
  f: number;   // floors (whole building)
  z0: number;  // base meters
  z1: number;  // top meters
  d: number;   // 1 = decorative
  k?: number;  // 1 = vacant lot (dress with gravel + fence)
  r: [number, number][]; // footprint ring, lon/lat
}

// facade / surface styles
const S_GLASS = 0;   // modern curtain wall (sky-reflecting)
const S_PREWAR = 1;  // punched masonry: limestone / brownstone / painted
const S_BRICK = 2;   // residential brick, four hues
const S_MILL = 3;    // industrial sash
const S_DARK = 4;    // dark premium tower, gold glazing
const S_PLAIN = 5;   // ships, cranes, sheds
const S_ARTDECO = 6; // vertical stone piers, 1920s–50s towers
const S_RIBBON = 7;  // mid-century ribbon windows
const S_CORNICE = 8; // cornice stonework
const S_GREEN = 9;   // green roof
const S_LOT = 10;    // vacant lot: gravel + fence
const S_GABLE = 11;  // pitched shingle roof

function styleFor(v: BuildingVolume): number {
  if (v.d) return S_PLAIN;
  if (v.z1 >= 110 && v.y >= 1975) return S_DARK;
  const office = v.c === "office" || v.c === "mixed";
  if (office && v.y >= 1920 && v.y < 1958 && v.z1 >= 40) return S_ARTDECO;
  if (office) return v.y >= 1980 ? S_GLASS : v.y >= 1958 ? S_RIBBON : S_PREWAR;
  if (v.c === "multifamily") return v.y >= 1995 ? S_GLASS : S_BRICK;
  if (v.c === "retail") return S_PREWAR;
  return S_MILL;
}

const VERT = /* glsl */ `
attribute float aU;
attribute float aStyle;
attribute float aRand;
attribute float aVar;
attribute float aTop;
attribute float aFh;
attribute vec3 aTint;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh;
void main() {
  vNormal = normal;
  vTint = aTint;
  vPos = position;
  vU = aU; vZ = position.z; vStyle = aStyle; vRand = aRand; vVar = aVar; vTop = aTop; vFh = aFh;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh;
uniform float uOpacity;
uniform vec3 uCam;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  int s = int(vStyle + 0.5);
  vec3 n = normalize(vNormal);
  vec3 sun = normalize(vec3(0.45, -0.32, 0.62));
  float diff = max(dot(n, sun), 0.0);
  float up = clamp(n.z, 0.0, 1.0);
  float shade = 0.50 + 0.42 * diff + 0.14 * up;

  // ---- palette by style + variant -----------------------------------------
  vec3 wall; vec3 glassA; vec3 glassB; float colW; vec2 win;
  bool glassy = false;
  if (s == 0) { // curtain wall — the "wall" is dark spandrel glass
    glassy = true; colW = 1.7; win = vec2(0.93, 0.78);
    if (vVar < 0.35)      { glassA = vec3(0.38, 0.58, 0.62); glassB = vec3(0.62, 0.80, 0.80); wall = vec3(0.20, 0.30, 0.32); } // blue-green
    else if (vVar < 0.7)  { glassA = vec3(0.55, 0.60, 0.66); glassB = vec3(0.78, 0.83, 0.88); wall = vec3(0.32, 0.35, 0.39); } // silver
    else                  { glassA = vec3(0.52, 0.44, 0.34); glassB = vec3(0.76, 0.66, 0.52); wall = vec3(0.30, 0.24, 0.18); } // bronze
  } else if (s == 1) { colW = 3.0; win = vec2(0.46, 0.52);
    if (vVar < 0.4)       { wall = vec3(0.86, 0.81, 0.70); } // limestone
    else if (vVar < 0.7)  { wall = vec3(0.55, 0.40, 0.33); } // brownstone
    else                  { wall = vec3(0.78, 0.79, 0.72); } // painted
    glassA = vec3(0.30, 0.36, 0.42); glassB = vec3(0.44, 0.52, 0.58);
  } else if (s == 2) { colW = 2.9; win = vec2(0.42, 0.50);
    if (vVar < 0.3)       { wall = vec3(0.72, 0.46, 0.36); } // red brick
    else if (vVar < 0.55) { wall = vec3(0.58, 0.42, 0.34); } // brown
    else if (vVar < 0.8)  { wall = vec3(0.76, 0.62, 0.46); } // tan
    else                  { wall = vec3(0.83, 0.80, 0.74); } // whitewash
    glassA = vec3(0.32, 0.38, 0.44); glassB = vec3(0.50, 0.57, 0.62);
  } else if (s == 3) { colW = 4.4; win = vec2(0.58, 0.50);
    wall = mix(vec3(0.72, 0.63, 0.52), vec3(0.62, 0.58, 0.55), step(0.5, vVar));
    glassA = vec3(0.40, 0.48, 0.54); glassB = vec3(0.58, 0.66, 0.70);
  } else if (s == 4) { glassy = true; colW = 2.7; win = vec2(0.62, 0.58);
    wall = vec3(0.25, 0.27, 0.31); glassA = vec3(0.72, 0.60, 0.34); glassB = vec3(0.88, 0.78, 0.52);
  } else if (s == 6) { colW = 2.4; win = vec2(0.48, 0.60);
    wall = mix(vec3(0.84, 0.78, 0.64), vec3(0.72, 0.64, 0.50), step(0.5, vVar));
    glassA = vec3(0.28, 0.33, 0.38); glassB = vec3(0.42, 0.48, 0.54);
  } else if (s == 7) { glassy = true; colW = 6.5; win = vec2(0.94, 0.46);
    wall = mix(vec3(0.80, 0.80, 0.77), vec3(0.72, 0.74, 0.72), step(0.5, vVar));
    glassA = vec3(0.36, 0.48, 0.52); glassB = vec3(0.55, 0.68, 0.70);
  } else if (s == 8) { wall = vec3(0.60, 0.56, 0.48); glassA = wall; glassB = wall; colW = 100.0; win = vec2(0.0); }
  else if (s == 10) { wall = vec3(0.58, 0.55, 0.50); glassA = wall; glassB = wall; colW = 100.0; win = vec2(0.0); }
  else              { wall = vec3(0.82, 0.82, 0.80); glassA = wall; glassB = wall; colW = 100.0; win = vec2(0.0); }

  wall *= 0.90 + 0.20 * vRand;

  // ---- window grid with analytic AA --------------------------------------
  float fh = max(vFh, 2.6);
  float u = vU / colW;
  float v = vZ / fh;
  vec2 f = vec2(fract(u), fract(v));
  vec2 m = (1.0 - win) * 0.5;
  float aaX = fwidth(f.x) * 0.9 + 1e-4;
  float aaY = fwidth(f.y) * 0.9 + 1e-4;
  float wx = smoothstep(m.x - aaX, m.x + aaX, f.x) * (1.0 - smoothstep(1.0 - m.x - aaX, 1.0 - m.x + aaX, f.x));
  float wy = smoothstep(m.y + 0.04 - aaY, m.y + 0.04 + aaY, f.y) * (1.0 - smoothstep(1.0 - m.y - aaY, 1.0 - m.y + aaY, f.y));
  float winMask = wx * wy;

  // storefront glazing on commercial ground floors
  if (vZ < fh * 1.15 && (s == 0 || s == 1 || s == 4 || s == 6)) {
    winMask = (f.x > 0.08 && f.x < 0.92 && vZ > 0.8 && vZ < fh * 0.92) ? 1.0 : 0.0;
  }
  if (vZ > vTop - 1.0) winMask = 0.0; // parapet

  // pre-war character: darker stone base and a cornice shadow line
  if (s == 1 || s == 6) {
    if (vZ < fh * 2.0 && vZ > fh * 1.15) wall *= 0.88;
    if (vZ > vTop - 2.3 && vZ < vTop - 1.0) wall *= 0.82;
  }
  // art deco: recessed spandrels keep the vertical piers running
  if (s == 6 && f.y < 0.18) wall *= 0.84;

  // ---- glass: per-window life + sky reflection ----------------------------
  float wid = hash(vec2(floor(u) + vRand * 61.0, floor(v)));
  vec3 glass = mix(glassA, glassB, clamp(vZ / max(vTop, 1.0), 0.0, 1.0));
  glass = mix(glass, glass * 1.25, step(0.82, wid));
  glass = mix(glass, glass * 0.72, step(wid, 0.14));

  vec3 V = normalize(uCam - vPos);
  vec3 R = reflect(-V, n);
  float skyT = clamp(R.z * 0.9 + 0.35, 0.0, 1.0);
  vec3 sky = mix(vec3(0.78, 0.76, 0.70), vec3(0.56, 0.72, 0.85), skyT);
  float fres = pow(1.0 - abs(dot(n, V)), 2.0);
  float refl = glassy ? (0.30 + 0.38 * fres) : (0.10 + 0.18 * fres);
  glass = mix(glass, sky, refl);
  if (glassy) wall = mix(wall, sky, 0.16 + 0.22 * fres); // spandrel sheen

  // window inset depth: lintel shadow above, bright sill below
  float winV = clamp((f.y - m.y - 0.04) / max(1.0 - 2.0 * m.y - 0.02, 0.001), 0.0, 1.0);
  glass *= mix(1.06, 0.74, winV);

  vec3 col = mix(wall, glass, winMask);
  // sill highlight just under the window row
  col *= 1.0 + 0.10 * (1.0 - winMask) * smoothstep(0.0, 0.04, f.y) * (1.0 - smoothstep(0.04, 0.09, f.y)) * step(0.5, float(s != 0));
  // mullion shadow line under each floor
  col *= 1.0 - 0.10 * (1.0 - winMask) * (1.0 - smoothstep(0.08, 0.12, f.y)) * (1.0 - step(7.5, vStyle));

  // distance dissolve
  float lod = clamp(max(fwidth(u), fwidth(v)) * 2.6 - 0.3, 0.0, 1.0);
  vec3 facadeAvg = mix(wall, mix(glassA, glassB, 0.5), win.x * win.y * 0.8);
  col = mix(col, facadeAvg, lod);

  col *= shade;
  col *= vTint;
  gl_FragColor = vec4(col, uOpacity);
}`;

const ROOF_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh;
uniform float uOpacity;
void main() {
  int s = int(vStyle + 0.5);
  vec3 roof;
  if (s == 0)       roof = vec3(0.72, 0.74, 0.76);
  else if (s == 1)  roof = vec3(0.66, 0.63, 0.57);
  else if (s == 2)  roof = vec3(0.62, 0.55, 0.48);
  else if (s == 3)  roof = vec3(0.60, 0.62, 0.63);
  else if (s == 4)  roof = vec3(0.22, 0.24, 0.27);
  else if (s == 6)  roof = vec3(0.60, 0.56, 0.47);
  else if (s == 7)  roof = vec3(0.68, 0.70, 0.70);
  else if (s == 8)  roof = vec3(0.58, 0.54, 0.46);   // cornice cap
  else if (s == 9)  roof = vec3(0.55, 0.67, 0.42);   // green roof
  else if (s == 10) roof = vec3(0.68, 0.65, 0.58);   // gravel lot
  else if (s == 11) {                                 // shingles
    if (vVar < 0.4)      roof = vec3(0.50, 0.31, 0.25);
    else if (vVar < 0.7) roof = vec3(0.36, 0.39, 0.43);
    else                 roof = vec3(0.42, 0.52, 0.44);
  }
  else              roof = vec3(0.78, 0.78, 0.76);
  roof *= 0.92 + 0.16 * vRand;
  vec3 n = normalize(vNormal);
  vec3 sun = normalize(vec3(0.45, -0.32, 0.62));
  float lit = 0.62 + 0.38 * max(dot(n, sun), 0.0);
  gl_FragColor = vec4(roof * lit * vTint, uOpacity);
}`;

interface Ranges { start: number; count: number }

export class ThreeBuildings implements maplibregl.CustomLayerInterface {
  id = "bw-three-buildings";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map!: maplibregl.Map;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private origin!: { x: number; y: number; z: number; s: number };
  private wallMat!: THREE.ShaderMaterial;
  private roofMat!: THREE.ShaderMaterial;
  private tintAttrs: THREE.BufferAttribute[] = [];
  private rangesByBBL = new Map<string, { attr: number; r: Ranges }[]>();
  visible = true;

  constructor(private volumes: BuildingVolume[], private center: [number, number]) {}

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: this.center[0], lat: this.center[1] }, 0);
    this.origin = { x: mc.x, y: mc.y, z: mc.z, s: mc.meterInMercatorCoordinateUnits() };
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.camera.matrixAutoUpdate = false;
    this.buildCity();
  }

  private project([lon, lat]: [number, number]): [number, number] {
    const kx = 111320 * Math.cos((this.center[1] * Math.PI) / 180);
    return [(lon - this.center[0]) * kx, (lat - this.center[1]) * 111320];
  }

  private buildCity() {
    const W = { pos: [] as number[], norm: [] as number[], u: [] as number[], style: [] as number[], rand: [] as number[], varr: [] as number[], top: [] as number[], fh: [] as number[] };
    const R = { pos: [] as number[], norm: [] as number[], u: [] as number[], style: [] as number[], rand: [] as number[], varr: [] as number[], top: [] as number[], fh: [] as number[] };
    const wallRanges: { bbl: string; r: Ranges }[] = [], roofRanges: { bbl: string; r: Ranges }[] = [];
    const props: { kind: number; x: number; y: number; z: number; s: number; rot: number }[] = [];

    const volsPerBBL = new Map<string, number>();
    for (const v of this.volumes) if (v.b && !v.k) volsPerBBL.set(v.b, (volsPerBBL.get(v.b) ?? 0) + 1);

    const pushWallTri = (T: typeof W, a: number[], b: number[], c: number[], n: number[], us: number[], meta: number[]) => {
      T.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) T.norm.push(n[0], n[1], n[2]);
      T.u.push(us[0], us[1], us[2]);
      for (let i = 0; i < 3; i++) { T.style.push(meta[0]); T.rand.push(meta[1]); T.varr.push(meta[2]); T.top.push(meta[3]); T.fh.push(meta[4]); }
    };

    const extrudeWalls = (T: typeof W, ring: [number, number][], z0: number, z1: number, meta: number[]) => {
      let perim = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const n = [dy / len, -dx / len, 0];
        const u0 = perim, u1 = perim + len;
        perim += len;
        pushWallTri(T, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], n, [u0, u1, u1], meta);
        pushWallTri(T, [a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], n, [u0, u1, u0], meta);
      }
    };

    const capRoof = (T: typeof R, ring: [number, number][], z: number, meta: number[]) => {
      const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { tris = []; }
      for (const t of tris) {
        pushWallTri(T, [ring[t[0]][0], ring[t[0]][1], z], [ring[t[1]][0], ring[t[1]][1], z], [ring[t[2]][0], ring[t[2]][1], z], [0, 0, 1], [0, 0, 0], meta);
      }
    };

    const insetRing = (ring: [number, number][], m: number): [number, number][] | null => {
      let cx = 0, cy = 0;
      for (const [x, y] of ring) { cx += x; cy += y; }
      cx /= ring.length; cy /= ring.length;
      const out = ring.map(([x, y]) => {
        const vx = x - cx, vy = y - cy;
        const len = Math.hypot(vx, vy) || 1;
        const k = Math.max(0, 1 - m / len);
        return [cx + vx * k, cy + vy * k] as [number, number];
      });
      return out;
    };

    for (const v of this.volumes) {
      const style = styleFor(v);
      const rnd = ((v.t + 1) * 0.19 + (Number(v.b) % 97) / 97) % 1;
      const varr = (rnd * 7.13) % 1;
      const fh = v.f > 0 && v.z1 > 0 ? Math.max(2.6, v.z1 / Math.max(v.f, 1)) : 3.55;
      let ring = v.r.map((p) => this.project(p));
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
        area += x1 * y2 - x2 * y1;
      }
      if (area < 0) ring = ring.slice().reverse();

      const wallStart = W.pos.length / 3;
      const roofStart = R.pos.length / 3;

      // ---- vacant lot: gravel pad + low fence ------------------------------
      if (v.k) {
        capRoof(R, ring, 0.06, [S_LOT, rnd, varr, 1, fh]);
        const fence = insetRing(ring, 0.5);
        if (fence) extrudeWalls(W, fence, 0, 1.15, [S_LOT, rnd, varr, 1.15, fh]);
        if (v.b) {
          wallRanges.push({ bbl: v.b, r: { start: wallStart, count: W.pos.length / 3 - wallStart } });
          roofRanges.push({ bbl: v.b, r: { start: roofStart, count: R.pos.length / 3 - roofStart } });
        }
        continue;
      }

      const meta = [style, rnd, varr, v.z1, fh];
      extrudeWalls(W, ring, v.z0, v.z1, meta);

      // ---- gabled colonial roofs in the old fabric -------------------------
      const gable = ring.length === 4 && v.z1 > 0 && v.z1 <= 15 && v.y > 0 && v.y < 1945 &&
        (style === S_PREWAR || style === S_BRICK) && volsPerBBL.get(v.b) === 1;
      if (gable) {
        const [v0, v1, v2, v3] = ring;
        const len = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
        let q = [v0, v1, v2, v3];
        if (len(v0, v1) + len(v2, v3) < len(v1, v2) + len(v3, v0)) q = [v1, v2, v3, v0];
        const [a0, a1, b0, b1] = [q[0], q[1], q[2], q[3]]; // eaves: a0→a1 and b0→b1
        const shortLen = Math.min(len(a1, b0), len(b1, a0));
        const rise = Math.min(3.4, Math.max(1.8, shortLen * 0.45));
        const m1 = [(a1[0] + b0[0]) / 2, (a1[1] + b0[1]) / 2, v.z1 + rise];
        const m3 = [(b1[0] + a0[0]) / 2, (b1[1] + a0[1]) / 2, v.z1 + rise];
        const rMeta = [S_GABLE, rnd, varr, v.z1 + rise, fh];
        const slope = (p1: number[], p2: number[], p3: number[]) => {
          const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
          const wx = p3[0] - p1[0], wy = p3[1] - p1[1], wz = p3[2] - p1[2];
          let n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
          const l = Math.hypot(n[0], n[1], n[2]) || 1;
          n = n.map((c) => c / l);
          if (n[2] < 0) n = n.map((c) => -c);
          return n;
        };
        const A0 = [a0[0], a0[1], v.z1], A1 = [a1[0], a1[1], v.z1];
        const B0 = [b0[0], b0[1], v.z1], B1 = [b1[0], b1[1], v.z1];
        let n1 = slope(A0, A1, m1);
        pushWallTri(R, A0, A1, m1, n1, [0, 0, 0], rMeta);
        pushWallTri(R, A0, m1, m3, n1, [0, 0, 0], rMeta);
        let n2 = slope(B0, B1, m3);
        pushWallTri(R, B0, B1, m3, n2, [0, 0, 0], rMeta);
        pushWallTri(R, B0, m3, m1, n2, [0, 0, 0], rMeta);
        // gable-end walls (plain — aTop below them keeps windows out)
        const gMeta = [style, rnd, varr, v.z1, fh];
        const gnorm = (p: number[], qq: number[]) => {
          const dx = qq[0] - p[0], dy = qq[1] - p[1];
          const l = Math.hypot(dx, dy) || 1;
          return [dy / l, -dx / l, 0];
        };
        pushWallTri(W, A1, B0, m1, gnorm(A1, B0), [0, 0, 0], gMeta);
        pushWallTri(W, B1, A0, m3, gnorm(B1, A0), [0, 0, 0], gMeta);
      } else {
        capRoof(R, ring, v.z1, meta);
        // pre-war and deco volumes wear a projecting stone cornice
        if ((style === S_PREWAR || style === S_ARTDECO) && v.z1 >= 10) {
          const lip = insetRing(ring, -0.35);
          if (lip) {
            const cMeta = [S_CORNICE, rnd, varr, v.z1 + 0.35, fh];
            extrudeWalls(W, lip, v.z1 - 0.55, v.z1 + 0.15, cMeta);
            capRoof(R, lip, v.z1 + 0.15, cMeta);
          }
        }
        // some modern mid-rises grow a green roof
        if (style === S_GLASS && v.z1 >= 15 && v.z1 <= 60 && varr > 0.62) {
          const g = insetRing(ring, 1.6);
          if (g) capRoof(R, g, v.z1 + 0.08, [S_GREEN, rnd, varr, v.z1, fh]);
        }
      }

      if (v.b) {
        wallRanges.push({ bbl: v.b, r: { start: wallStart, count: W.pos.length / 3 - wallStart } });
        roofRanges.push({ bbl: v.b, r: { start: roofStart, count: R.pos.length / 3 - roofStart } });
      }

      // ---- rooftop furniture ----------------------------------------------
      if (v.b && v.z1 >= 12 && !gable) {
        let cx = 0, cy = 0;
        for (const [x, y] of ring) { cx += x; cy += y; }
        cx /= ring.length; cy /= ring.length;
        const seed = Number(v.b) % 1000;
        const jit = (k: number, amp: number) => (((seed * (k + 3) * 2654435761) % 1000) / 1000 - 0.5) * amp;
        if (v.z1 >= 20) props.push({ kind: 2, x: cx + jit(1, 6), y: cy + jit(2, 6), z: v.z1, s: 1 + (v.z1 > 60 ? 0.6 : 0), rot: jit(3, 3) });
        if (v.y < 1968 && v.z1 >= 22) props.push({ kind: 0, x: cx + jit(4, 8), y: cy + jit(5, 8), z: v.z1, s: 1, rot: 0 });
        const nAc = v.z1 > 40 ? 3 : 1;
        for (let k = 0; k < nAc; k++) props.push({ kind: 1, x: cx + jit(6 + k, 10), y: cy + jit(9 + k, 10), z: v.z1, s: 0.8 + 0.4 * ((seed >> k) % 2), rot: jit(12 + k, 3) });
        if (v.z1 >= 105 && v.y >= 1975) props.push({ kind: 3, x: cx, y: cy, z: v.z1, s: 1, rot: 0 });
        // antennas crown the tallest towers
        if (v.z1 >= 95) props.push({ kind: 4, x: cx + jit(15, 5), y: cy + jit(16, 5), z: v.z1, s: 1 + (v.z1 - 95) / 60, rot: 0 });
        // skylight monitors on industrial sheds
        if (style === S_MILL && v.z1 < 15) {
          for (let k = 0; k < 2; k++) props.push({ kind: 6, x: cx + jit(20 + k, 12), y: cy + jit(23 + k, 12), z: v.z1, s: 1, rot: jit(26, 1) });
        }
      }
      // chimneys on the gabled colonial stock
      if (v.b && gable) {
        let cx = 0, cy = 0;
        for (const [x, y] of ring) { cx += x; cy += y; }
        cx /= ring.length; cy /= ring.length;
        const seed = Number(v.b) % 1000;
        const jit = (k: number, amp: number) => (((seed * (k + 3) * 2654435761) % 1000) / 1000 - 0.5) * amp;
        props.push({ kind: 5, x: cx + jit(1, 5), y: cy + jit(2, 4), z: v.z1 + 0.8, s: 1, rot: 0 });
      }
    }

    const mkGeom = (T: typeof W) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(T.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(T.norm, 3));
      g.setAttribute("aU", new THREE.Float32BufferAttribute(T.u, 1));
      g.setAttribute("aStyle", new THREE.Float32BufferAttribute(T.style, 1));
      g.setAttribute("aRand", new THREE.Float32BufferAttribute(T.rand, 1));
      g.setAttribute("aVar", new THREE.Float32BufferAttribute(T.varr, 1));
      g.setAttribute("aTop", new THREE.Float32BufferAttribute(T.top, 1));
      g.setAttribute("aFh", new THREE.Float32BufferAttribute(T.fh, 1));
      const tint = new Float32Array((T.pos.length / 3) * 3).fill(1);
      const tintAttr = new THREE.Float32BufferAttribute(tint, 3);
      tintAttr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aTint", tintAttr);
      return g;
    };

    const uniforms = () => ({ uOpacity: { value: 1 }, uCam: { value: new THREE.Vector3(0, 0, 800) } });
    this.wallMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(), side: THREE.DoubleSide });
    this.roofMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ROOF_FRAG, uniforms: uniforms(), side: THREE.DoubleSide });

    const wallGeom = mkGeom(W);
    const roofGeom = mkGeom(R);
    this.scene.add(new THREE.Mesh(wallGeom, this.wallMat));
    this.scene.add(new THREE.Mesh(roofGeom, this.roofMat));
    this.tintAttrs = [wallGeom.getAttribute("aTint") as THREE.BufferAttribute, roofGeom.getAttribute("aTint") as THREE.BufferAttribute];
    for (const { bbl, r } of wallRanges) {
      if (!this.rangesByBBL.has(bbl)) this.rangesByBBL.set(bbl, []);
      this.rangesByBBL.get(bbl)!.push({ attr: 0, r });
    }
    for (const { bbl, r } of roofRanges) {
      if (!this.rangesByBBL.has(bbl)) this.rangesByBBL.set(bbl, []);
      this.rangesByBBL.get(bbl)!.push({ attr: 1, r });
    }

    const propDefs: { geom: THREE.BufferGeometry; color: number }[] = [
      { geom: waterTowerGeom(), color: 0x8a7a63 },
      { geom: new THREE.BoxGeometry(2.2, 1.6, 1.3).translate(0, 0, 0.65), color: 0x9aa0a4 },
      { geom: new THREE.BoxGeometry(4.6, 3.4, 2.9).translate(0, 0, 1.45), color: 0xb9b5a8 },
      { geom: new THREE.CylinderGeometry(4.2, 4.2, 0.25, 20).rotateX(Math.PI / 2).translate(0, 0, 0.12), color: 0x7d8489 },
      { geom: antennaGeom(), color: 0x6d7276 },
      { geom: new THREE.BoxGeometry(0.9, 0.9, 2.4).translate(0, 0, 1.2), color: 0x8a5c48 },
      { geom: new THREE.BoxGeometry(6.5, 1.8, 1.3).translate(0, 0, 0.65), color: 0xaab4b8 },
    ];
    for (let kind = 0; kind < propDefs.length; kind++) {
      const items = props.filter((p) => p.kind === kind);
      if (!items.length) continue;
      const mesh = new THREE.InstancedMesh(
        propDefs[kind].geom,
        new THREE.MeshLambertMaterial({ color: propDefs[kind].color, side: THREE.DoubleSide }),
        items.length,
      );
      const m = new THREE.Matrix4();
      items.forEach((p, i) => {
        m.compose(
          new THREE.Vector3(p.x, p.y, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.rot)),
          new THREE.Vector3(p.s, p.s, p.s),
        );
        mesh.setMatrixAt(i, m);
      });
      this.scene.add(mesh);
    }
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.45, -0.32, 0.62);
    this.scene.add(sun, new THREE.AmbientLight(0xf4efe4, 1.4));
  }

  setTints(tints: Map<string, [number, number, number]>) {
    for (const attr of this.tintAttrs) {
      (attr.array as Float32Array).fill(1);
    }
    for (const [bbl, [r, g, b]] of tints) {
      const ranges = this.rangesByBBL.get(bbl);
      if (!ranges) continue;
      for (const { attr, r: range } of ranges) {
        const arr = this.tintAttrs[attr].array as Float32Array;
        for (let i = range.start; i < range.start + range.count; i++) {
          arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b;
        }
      }
    }
    for (const attr of this.tintAttrs) attr.needsUpdate = true;
    this.map.triggerRepaint();
  }

  setOpacity(o: number) {
    this.wallMat.uniforms.uOpacity.value = o;
    this.roofMat.uniforms.uOpacity.value = o;
    const transparent = o < 1;
    this.wallMat.transparent = transparent;
    this.roofMat.transparent = transparent;
    this.map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: maplibregl.CustomRenderMethodInput) {
    if (!this.visible) return;
    // approximate camera position in city meters (for glass reflections):
    // derived from center/zoom/bearing/pitch — MapLibre has no free-camera getter
    {
      const c = this.map.getCenter();
      const z = this.map.getZoom();
      const bearing = (this.map.getBearing() * Math.PI) / 180;
      const pitch = (this.map.getPitch() * Math.PI) / 180;
      const mpp = (78271.517 * Math.cos((c.lat * Math.PI) / 180)) / Math.pow(2, z);
      const h = this.map.getContainer().clientHeight || 900;
      const distM = (0.5 * h) / Math.tan(0.32175) * mpp; // default fov ≈ 36.87°
      const [cx0, cy0] = this.project([c.lng, c.lat]);
      const back = distM * Math.sin(pitch);
      this.wallMat.uniforms.uCam.value.set(
        cx0 - Math.sin(bearing) * back,
        cy0 - Math.cos(bearing) * back,
        distM * Math.cos(pitch),
      );
    }
    const m = new THREE.Matrix4().fromArray(Array.from(options.defaultProjectionData.mainMatrix));
    const l = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, this.origin.z)
      .scale(new THREE.Vector3(this.origin.s, -this.origin.s, this.origin.s));
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove() {
    this.scene.clear();
  }
}

function waterTowerGeom(): THREE.BufferGeometry {
  const tank = new THREE.CylinderGeometry(1.7, 1.5, 3.2, 12).rotateX(Math.PI / 2).translate(0, 0, 3.4);
  const cone = new THREE.ConeGeometry(1.8, 1.2, 12).rotateX(Math.PI / 2).translate(0, 0, 5.6);
  const legs = new THREE.CylinderGeometry(0.9, 1.1, 1.9, 6).rotateX(Math.PI / 2).translate(0, 0, 0.95);
  return mergeGeoms([tank, cone, legs]);
}

function antennaGeom(): THREE.BufferGeometry {
  const mast = new THREE.CylinderGeometry(0.28, 0.42, 11, 6).rotateX(Math.PI / 2).translate(0, 0, 5.5);
  const tip = new THREE.CylinderGeometry(0.1, 0.16, 4, 5).rotateX(Math.PI / 2).translate(0, 0, 13);
  return mergeGeoms([mast, tip]);
}

function mergeGeoms(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], norm: number[] = [];
  for (const g of geoms) {
    const ng = g.toNonIndexed();
    pos.push(...Array.from(ng.getAttribute("position").array as Float32Array));
    norm.push(...Array.from(ng.getAttribute("normal").array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  return out;
}
