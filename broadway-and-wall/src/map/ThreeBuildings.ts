// The beautiful-buildings renderer: a Three.js custom layer inside MapLibre.
// Every building is a real mesh with a procedural facade — window grids
// aligned to actual floor counts, palettes by age and class, distinct roofs,
// and instanced rooftop furniture (water towers, AC units, bulkheads,
// helipads). MapLibre still owns the ground map, camera, and picking.
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
  r: [number, number][]; // footprint ring, lon/lat
}

// facade styles
const S_GLASS = 0;     // modern curtain wall
const S_PREWAR = 1;    // punched limestone
const S_BRICK = 2;     // residential masonry
const S_MILL = 3;      // industrial sash
const S_DARK = 4;      // dark premium tower
const S_DECO = 5;      // ships, cranes, sheds — plain

function styleFor(v: BuildingVolume): number {
  if (v.d) return S_DECO;
  if (v.z1 >= 110 && v.y >= 1975) return S_DARK;
  if (v.c === "office" || v.c === "mixed") return v.y >= 1968 ? S_GLASS : S_PREWAR;
  if (v.c === "multifamily") return v.y >= 1985 ? S_GLASS : S_BRICK;
  if (v.c === "retail") return S_PREWAR;
  return S_MILL;
}

const VERT = /* glsl */ `
attribute float aU;      // distance along facade, meters
attribute float aStyle;
attribute float aRand;
attribute float aTop;    // building top, meters
attribute float aFh;     // floor height, meters
attribute vec3 aTint;    // selection/ownership tint
varying vec3 vNormal;
varying vec3 vTint;
varying float vU, vZ, vStyle, vRand, vTop, vFh;
void main() {
  vNormal = normal;
  vTint = aTint;
  vU = aU; vZ = position.z; vStyle = aStyle; vRand = aRand; vTop = aTop; vFh = aFh;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vTint;
varying float vU, vZ, vStyle, vRand, vTop, vFh;
uniform float uOpacity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  int s = int(vStyle + 0.5);
  vec3 sun = normalize(vec3(0.45, -0.32, 0.62));
  float diff = max(dot(normalize(vNormal), sun), 0.0);
  float up = clamp(vNormal.z, 0.0, 1.0);
  float shade = 0.50 + 0.42 * diff + 0.14 * up;

  // palette
  vec3 wall; vec3 glassA; vec3 glassB; float colW; vec2 win; // win = window fraction (x,y)
  if (s == 0)      { wall = vec3(0.85, 0.86, 0.87); glassA = vec3(0.42, 0.62, 0.70); glassB = vec3(0.66, 0.80, 0.84); colW = 2.5; win = vec2(0.80, 0.62); }
  else if (s == 1) { wall = vec3(0.86, 0.81, 0.70); glassA = vec3(0.30, 0.36, 0.42); glassB = vec3(0.44, 0.52, 0.58); colW = 3.0; win = vec2(0.46, 0.52); }
  else if (s == 2) { wall = vec3(0.74, 0.53, 0.42); glassA = vec3(0.32, 0.38, 0.44); glassB = vec3(0.50, 0.57, 0.62); colW = 2.9; win = vec2(0.42, 0.50); }
  else if (s == 3) { wall = vec3(0.72, 0.63, 0.52); glassA = vec3(0.40, 0.48, 0.54); glassB = vec3(0.58, 0.66, 0.70); colW = 4.4; win = vec2(0.58, 0.50); }
  else if (s == 4) { wall = vec3(0.27, 0.29, 0.33); glassA = vec3(0.72, 0.60, 0.34); glassB = vec3(0.88, 0.78, 0.52); colW = 2.7; win = vec2(0.62, 0.58); }
  else             { wall = vec3(0.82, 0.82, 0.80); glassA = wall; glassB = wall; colW = 100.0; win = vec2(0.0); }

  // brick tone variety
  wall *= 0.90 + 0.20 * vRand;

  float fh = max(vFh, 2.6);
  float u = vU / colW;
  float v = vZ / fh;
  vec2 f = vec2(fract(u), fract(v));
  vec2 m = (1.0 - win) * 0.5;

  // analytic anti-aliasing: soften window edges by pixel footprint, and
  // when a window cell is subpixel, dissolve to the facade's average color
  float aaX = fwidth(f.x) * 0.9 + 1e-4;
  float aaY = fwidth(f.y) * 0.9 + 1e-4;
  float wx = smoothstep(m.x - aaX, m.x + aaX, f.x) * (1.0 - smoothstep(1.0 - m.x - aaX, 1.0 - m.x + aaX, f.x));
  float wy = smoothstep(m.y + 0.04 - aaY, m.y + 0.04 + aaY, f.y) * (1.0 - smoothstep(1.0 - m.y - aaY, 1.0 - m.y + aaY, f.y));
  float winMask = wx * wy;

  // ground floor: storefront glazing for commercial styles
  if (vZ < fh * 1.15 && (s == 0 || s == 1 || s == 4)) {
    winMask = (f.x > 0.08 && f.x < 0.92 && vZ > 0.8 && vZ < fh * 0.92) ? 1.0 : 0.0;
  }
  // parapet band — no windows in the top meter
  if (vZ > vTop - 1.0) winMask = 0.0;

  // per-window shade variety (blinds, life)
  float wid = hash(vec2(floor(u) + vRand * 61.0, floor(v)));
  vec3 glass = mix(glassA, glassB, clamp(vZ / max(vTop, 1.0), 0.0, 1.0));
  glass = mix(glass, glass * 1.25, step(0.82, wid));
  glass = mix(glass, glass * 0.72, step(wid, 0.14));

  vec3 col = mix(wall, glass, winMask);
  // mullion shadow line under each floor
  col *= 1.0 - 0.10 * (1.0 - winMask) * (1.0 - smoothstep(0.08, 0.12, f.y)) * (1.0 - step(4.5, vStyle));

  // distance dissolve: far away, the facade settles to its blended tone
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
varying float vU, vZ, vStyle, vRand, vTop, vFh;
uniform float uOpacity;
void main() {
  int s = int(vStyle + 0.5);
  vec3 roof;
  if (s == 0)      roof = vec3(0.72, 0.74, 0.76);
  else if (s == 1) roof = vec3(0.66, 0.63, 0.57);
  else if (s == 2) roof = vec3(0.62, 0.55, 0.48);
  else if (s == 3) roof = vec3(0.60, 0.62, 0.63);
  else if (s == 4) roof = vec3(0.22, 0.24, 0.27);
  else             roof = vec3(0.78, 0.78, 0.76);
  roof *= 0.92 + 0.16 * vRand;
  gl_FragColor = vec4(roof * (0.86 + 0.14 * clamp(vNormal.z, 0.0, 1.0)) * vTint, uOpacity);
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
    // meters east/north of city center (equirectangular — city is 3 km wide)
    const kx = 111320 * Math.cos((this.center[1] * Math.PI) / 180);
    return [(lon - this.center[0]) * kx, (lat - this.center[1]) * 111320];
  }

  private buildCity() {
    const wallPos: number[] = [], wallNorm: number[] = [], wallU: number[] = [];
    const wallMeta: number[] = [], wallRand: number[] = [], wallTop: number[] = [], wallFh: number[] = [];
    const roofPos: number[] = [], roofNorm: number[] = [], roofMeta: number[] = [], roofRand: number[] = [];
    const roofTop: number[] = [], roofU: number[] = [], roofFh: number[] = [];
    const wallRanges: { bbl: string; r: Ranges }[] = [], roofRanges: { bbl: string; r: Ranges }[] = [];
    const props: { kind: number; x: number; y: number; z: number; s: number; rot: number }[] = [];

    for (const v of this.volumes) {
      const style = styleFor(v);
      const rnd = ((v.t + 1) * 0.19 + (Number(v.b) % 97) / 97) % 1;
      const fh = v.f > 0 && v.z1 > 0 ? Math.max(2.6, (v.z1 - (v.z0 > 0 ? 0 : 0)) / Math.max(v.f, 1)) : 3.55;
      let ring = v.r.map((p) => this.project(p));
      // ensure CCW so outward normals face out
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
        area += x1 * y2 - x2 * y1;
      }
      if (area < 0) ring = ring.slice().reverse();

      const wallStart = wallPos.length / 3;
      let perim = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const nx = dy / len, ny = -dx / len;
        const u0 = perim, u1 = perim + len;
        perim += len;
        // two triangles: a0 b0 b1 / a0 b1 a1
        const quad = [
          [a[0], a[1], v.z0, u0], [b[0], b[1], v.z0, u1], [b[0], b[1], v.z1, u1],
          [a[0], a[1], v.z0, u0], [b[0], b[1], v.z1, u1], [a[0], a[1], v.z1, u0],
        ];
        for (const [x, y, z, u] of quad) {
          wallPos.push(x, y, z);
          wallNorm.push(nx, ny, 0);
          wallU.push(u);
          wallMeta.push(style);
          wallRand.push(rnd);
          wallTop.push(v.z1);
          wallFh.push(fh);
        }
      }
      if (v.b) wallRanges.push({ bbl: v.b, r: { start: wallStart, count: wallPos.length / 3 - wallStart } });

      // roof cap
      const roofStart = roofPos.length / 3;
      const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { tris = []; }
      for (const t of tris) {
        for (const idx of t) {
          roofPos.push(ring[idx][0], ring[idx][1], v.z1);
          roofNorm.push(0, 0, 1);
          roofMeta.push(style);
          roofRand.push(rnd);
          roofTop.push(v.z1);
          roofU.push(0);
          roofFh.push(fh);
        }
      }
      if (v.b) roofRanges.push({ bbl: v.b, r: { start: roofStart, count: roofPos.length / 3 - roofStart } });

      // rooftop furniture (top volume of real buildings only)
      if (v.b && v.z1 >= 12 && style !== S_DECO) {
        let cx = 0, cy = 0;
        for (const [x, y] of ring) { cx += x; cy += y; }
        cx /= ring.length; cy /= ring.length;
        const seed = Number(v.b) % 1000;
        const jit = (k: number, amp: number) => (((seed * (k + 3) * 2654435761) % 1000) / 1000 - 0.5) * amp;
        // bulkhead on everything mid-rise and up
        if (v.z1 >= 20) props.push({ kind: 2, x: cx + jit(1, 6), y: cy + jit(2, 6), z: v.z1, s: 1 + (v.z1 > 60 ? 0.6 : 0), rot: jit(3, 3) });
        // water tower on older mid/tall stock
        if (v.y < 1968 && v.z1 >= 22) props.push({ kind: 0, x: cx + jit(4, 8), y: cy + jit(5, 8), z: v.z1, s: 1, rot: 0 });
        // AC units
        const nAc = v.z1 > 40 ? 3 : 1;
        for (let k = 0; k < nAc; k++) props.push({ kind: 1, x: cx + jit(6 + k, 10), y: cy + jit(9 + k, 10), z: v.z1, s: 0.8 + 0.4 * ((seed >> k) % 2), rot: jit(12 + k, 3) });
        // helipad on the tallest modern towers
        if (v.z1 >= 105 && v.y >= 1975) props.push({ kind: 3, x: cx, y: cy, z: v.z1, s: 1, rot: 0 });
      }
    }

    const mkGeom = (pos: number[], norm: number[], u: number[], meta: number[], rand: number[], top: number[], fhArr: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
      g.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
      g.setAttribute("aStyle", new THREE.Float32BufferAttribute(meta, 1));
      g.setAttribute("aRand", new THREE.Float32BufferAttribute(rand, 1));
      g.setAttribute("aTop", new THREE.Float32BufferAttribute(top, 1));
      g.setAttribute("aFh", new THREE.Float32BufferAttribute(fhArr, 1));
      const tint = new Float32Array((pos.length / 3) * 3).fill(1);
      const tintAttr = new THREE.Float32BufferAttribute(tint, 3);
      tintAttr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aTint", tintAttr);
      return g;
    };

    // DoubleSide: the mercator transform mirrors Y, which flips winding —
    // single-sided faces would all be culled
    this.wallMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uOpacity: { value: 1 } }, side: THREE.DoubleSide });
    this.roofMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ROOF_FRAG, uniforms: { uOpacity: { value: 1 } }, side: THREE.DoubleSide });

    const wallGeom = mkGeom(wallPos, wallNorm, wallU, wallMeta, wallRand, wallTop, wallFh);
    const roofGeom = mkGeom(roofPos, roofNorm, roofU, roofMeta, roofRand, roofTop, roofFh);
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

    // instanced rooftop furniture
    const propDefs: { geom: THREE.BufferGeometry; color: number }[] = [
      { geom: waterTowerGeom(), color: 0x8a7a63 },
      { geom: new THREE.BoxGeometry(2.2, 1.6, 1.3).translate(0, 0, 0.65), color: 0x9aa0a4 },
      { geom: new THREE.BoxGeometry(4.6, 3.4, 2.9).translate(0, 0, 1.45), color: 0xb9b5a8 },
      { geom: new THREE.CylinderGeometry(4.2, 4.2, 0.25, 20).rotateX(Math.PI / 2).translate(0, 0, 0.12), color: 0x7d8489 },
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

  // gold for owned, bright gold selected, teal neighbors, warm hover
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
  const g = mergeGeoms([tank, cone, legs]);
  return g;
}

function mergeGeoms(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // minimal merge: concatenate position/normal of non-indexed copies
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
