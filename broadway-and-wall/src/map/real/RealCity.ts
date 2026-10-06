/**
 * THE CITY — the game's 3D renderer.
 *
 * Builds the city as real geometry: walls with world-scale facade textures
 * (albedo, roughness/metalness, normal relief and lit-window emission per
 * family and elevation), real cornices, parapets, setbacks and crowns, roofs
 * by material, roof plant, street trees, parked and moving cars, people,
 * water in channels and a rippled harbour, all lit by stock physically based
 * materials, a soft shadow map, aerial perspective and a sky for the glass to
 * reflect. It replaced the classic shader-on-boxes renderer (ThreeBuildings,
 * retired) as the only map. Picking (MapLibre's parcel layer), labels, badges
 * and every panel are MapView's. Nothing here is read by the engine; nothing
 * here writes state.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import maplibregl from "maplibre-gl";
import type { BuildingVolume } from "../volume";
import type { BuildingDesign } from "@/engine/types";
import type { CityCtx, PlayerItem } from "./ctx";
export type { CityCtx, PlayerItem };

type Ctx = CityCtx;
type P2 = [number, number];

// ---- small helpers ---------------------------------------------------------

function hash01(n: number, seed: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function keyOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** A counter-clockwise ring pulled in by d metres (mitred, capped); null if it collapses. */
function insetRing(r: P2[], d: number): P2[] | null {
  const n = r.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n], c = r[i], q = r[(i + 1) % n];
    const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
    // inward (left-hand) normals of the two edges meeting here
    const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];
    const mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { out.push([c[0] + n2[0] * d, c[1] + n2[1] * d]); continue; }
    // the mitre: d / cos(half the turn) = 2d / |n1 + n2|, capped at 4d
    const s = Math.min(d * 4, (d * 2) / ml);
    out.push([c[0] + (mx / ml) * s, c[1] + (my / ml) * s]);
  }
  return ringArea(out) > 1 ? out : null;
}
function ringArea(r: P2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- facade families -------------------------------------------------------
//
// A family is one bay by one floor of a real elevation, drawn once on a
// canvas and tiled in metres along every wall it is given to: so a window is
// a window-sized window at any zoom, and corners always land between bays.

interface Family {
  key: string;
  bayW: number;      // metres per bay
  floorH: number;    // metres per floor
  mat: THREE.MeshStandardMaterial;
  masonry: boolean;  // gets a cornice and a string course
  glass: boolean;    // gets a dark lobby base and a parapet cap
}

const TILE = 128;
/** Props too small to read from far off; Low and Medium drop the garden-scale ones too. */
const FAR_PROPS = ["lamp", "car", "lotcar"];
const FAR_PROPS_LOW = [...FAR_PROPS, "hedge", "fence", "railing", "bench", "parkhedge", "pile", "bulk", "hvac", "tank", "skyl"];

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return { c, g: c.getContext("2d")! };
}

/** Height field → tangent-space normal map (Sobel), for the window reveals. */
function normalFromHeight(hc: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const w = hc.width, h = hc.height;
  const src = hc.getContext("2d")!.getImageData(0, 0, w, h).data;
  const { c, g } = makeCanvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    out.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
    out.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
    out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** Wind ripples: a tileable height field of crossing wave trains, as normals. */
function rippleNormal(): THREE.CanvasTexture {
  const N = 256;
  const { c, g } = makeCanvas(N, N);
  const img = g.createImageData(N, N);
  let s = 4243; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // whole wave numbers only, so the tile wraps without a seam; most of the
  // energy in one wind direction, a little cross-sea
  const waves = Array.from({ length: 14 }, (_, i) => {
    const main = i < 9;
    const kx = main ? 2 + ((rnd() * 9) | 0) : ((rnd() * 7) | 0) - 3;
    const ky = main ? ((rnd() * 7) | 0) - 3 : 2 + ((rnd() * 7) | 0);
    return { kx, ky, a: (main ? 1 : 0.5) / Math.hypot(kx, ky, 1), p: rnd() * 6.283 };
  });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let h = 0;
    for (const w of waves) h += w.a * Math.sin(((w.kx * x + w.ky * y) / N) * 6.283 + w.p);
    const v = Math.max(0, Math.min(255, 128 + h * 70));
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return normalFromHeight(c, 3.0);
}

/**
 * WHAT THE GLASS SEES. A studio light box made every curtain wall reflect a
 * photographer's softboxes; a city's glass reflects the sky — deep blue
 * overhead, paling to a warm haze at the horizon — the hazy blocks across
 * the street, and the low sun. Built once as a little scene and prefiltered
 * (PMREM) for every material's reflections and ambient light. Up is +z.
 */
function skyEnvironment(): THREE.Scene {
  const sc = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: "varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `varying vec3 vD;
      void main() {
        float z = vD.z;
        vec3 zenith = vec3(0.16, 0.34, 0.66), horizon = vec3(0.86, 0.88, 0.86), city = vec3(0.42, 0.42, 0.42), ground = vec3(0.24, 0.23, 0.22);
        vec3 c = z > 0.0 ? mix(horizon, zenith, pow(clamp(z, 0.0, 1.0), 0.55))
                         : mix(city, ground, clamp(-z * 3.0, 0.0, 1.0));
        // a band of hazy buildings just below and above the horizon
        c = mix(c, city * 1.15, smoothstep(0.08, 0.0, abs(z - 0.02)) * 0.6);
        gl_FragColor = vec4(c * 1.6, 1.0);
      }`,
  });
  sc.add(new THREE.Mesh(geo, mat));
  // the sun as a small bright disc where the key light comes from
  const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 9) }));
  sun.position.set(0.45, -0.55, 0.7).normalize().multiplyScalar(90);   // the light's default sunDir
  sc.add(sun);
  return sc;
}

interface FamilySpec {
  key: string; bayW: number; floorH: number; masonry: boolean; glass: boolean;
  // window rectangle within the tile, as fractions
  win: { x0: number; x1: number; y0: number; y1: number };
  wall: (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;
  glassCol: string; frameCol: string;
  wallRough: number; glassRough: number; glassMetal: number;
  trim?: string;     // painted lintel + sill colour
  mullions?: [number, number]; // vertical, horizontal glazing bars per window
  reveal: number;    // normal-map relief strength
  noWin?: boolean;   // a blank wall: monuments, sheds, hulls
  // the window's shape and dressing — what separates an Italianate walk-up
  // from a Federal row house from a 1950s slab at a glance
  winStyle?: "rect" | "arch" | "segment" | "pair";
  lintel?: "flat" | "pediment" | "none";
  shutter?: string;  // painted shutters either side
}

function buildFamily(spec: FamilySpec, seed: number): Family {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // a 2 x 2 tile — two bays by two floors — so neighbouring windows differ
  const W = TILE * 2, H = TILE * 2;
  const alb = makeCanvas(W, H), orm = makeCanvas(W, H), hgt = makeCanvas(W, H), emi = makeCanvas(W, H);
  spec.wall(alb.g, W, H, rnd);
  orm.g.fillStyle = `rgb(0,${Math.round(spec.wallRough * 255)},0)`; orm.g.fillRect(0, 0, W, H);
  hgt.g.fillStyle = "#ffffff"; hgt.g.fillRect(0, 0, W, H);
  emi.g.fillStyle = "#000000"; emi.g.fillRect(0, 0, W, H);
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2 && !spec.noWin; bx++) {
    // canvas y runs down; v runs up — the tile is drawn upside down so the
    // sill sits at the bottom of the floor in world space
    const ox = bx * TILE, oy = by * TILE;
    const x0 = ox + spec.win.x0 * TILE, x1 = ox + spec.win.x1 * TILE;
    const y0 = oy + (1 - spec.win.y1) * TILE, y1 = oy + (1 - spec.win.y0) * TILE;
    const ww = x1 - x0, wh = y1 - y0;
    const style = spec.winStyle ?? "rect";
    // the openings in this bay: one, or a pair split by a narrow pier
    const ops: [number, number][] = style === "pair"
      ? [[x0, x0 + ww * 0.44], [x1 - ww * 0.44, x1]] : [[x0, x1]];
    // the head of each opening: square, a full round arch, or a shallow segment
    const rise = (a: number, b: number) => style === "arch" ? (b - a) / 2 : style === "segment" ? (b - a) * 0.18 : 0;
    const shape = (g: CanvasRenderingContext2D, a: number, b: number, inset = 0) => {
      const r = rise(a, b), ya = y0 + inset, yb = y1 - inset, xa = a + inset, xb = b - inset;
      g.beginPath();
      if (r > 0) {
        const cx = (xa + xb) / 2, half = (xb - xa) / 2;
        g.moveTo(xa, yb); g.lineTo(xa, ya + r);
        if (style === "arch") g.arc(cx, ya + r, half, Math.PI, 0);
        else g.quadraticCurveTo(cx, ya - r * 0.9, xb, ya + r);
        g.lineTo(xb, yb); g.closePath();
      } else g.rect(xa, ya, xb - xa, yb - ya);
    };
    if (spec.shutter) {
      alb.g.fillStyle = spec.shutter;
      const sw = ww * 0.32;
      alb.g.fillRect(x0 - sw - 2, y0, sw, wh); alb.g.fillRect(x1 + 2, y0, sw, wh);
      alb.g.fillStyle = "rgba(0,0,0,0.18)";
      for (let yy = y0 + 4; yy < y1; yy += 6) { alb.g.fillRect(x0 - sw - 2, yy, sw, 1.5); alb.g.fillRect(x1 + 2, yy, sw, 1.5); }
    }
    if (spec.trim) {
      alb.g.fillStyle = spec.trim;
      const lt = spec.lintel ?? "flat";
      for (const [a, b] of ops) {
        if (style === "arch" || style === "segment") {
          // a ring of voussoirs round the head, keyed at the crown
          alb.g.save(); shape(alb.g, a - 5, b + 5); alb.g.fill(); alb.g.restore();
        } else if (lt === "flat") alb.g.fillRect(a - 4, y0 - 9, b - a + 8, 9);
        if (lt === "pediment") {
          alb.g.beginPath(); alb.g.moveTo(a - 7, y0 - 4); alb.g.lineTo((a + b) / 2, y0 - 20); alb.g.lineTo(b + 7, y0 - 4); alb.g.closePath(); alb.g.fill();
        }
        alb.g.fillRect(a - 3, y1, b - a + 6, 5);          // sill
      }
    }
    // the glass: a vertical sky gradient with a per-pane brightness, so a
    // street of windows does not read as one sheet
    const k = 0.85 + rnd() * 0.3;
    const grad = alb.g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, spec.glassCol); grad.addColorStop(1, shade(spec.glassCol, 0.62));
    const lit = rnd() < 0.55, lum = 0.55 + rnd() * 0.45;
    for (const [a, b] of ops) {
      alb.g.globalAlpha = 1; alb.g.fillStyle = grad; shape(alb.g, a, b); alb.g.fill();
      alb.g.fillStyle = `rgba(255,255,255,${(k - 0.85) * 0.25})`; alb.g.fill();
      // frame and glazing bars
      alb.g.strokeStyle = spec.frameCol; alb.g.lineWidth = 3; shape(alb.g, a, b, 1); alb.g.stroke();
      if (spec.mullions) {
        const w2 = b - a;
        alb.g.lineWidth = 2;
        for (let i = 1; i < spec.mullions[0]; i++) { const x = a + (w2 * i) / spec.mullions[0]; alb.g.beginPath(); alb.g.moveTo(x, y0 + rise(a, b)); alb.g.lineTo(x, y1); alb.g.stroke(); }
        for (let i = 1; i < spec.mullions[1]; i++) { const y = y0 + (wh * i) / spec.mullions[1]; alb.g.beginPath(); alb.g.moveTo(a, y); alb.g.lineTo(b, y); alb.g.stroke(); }
      }
      orm.g.fillStyle = `rgb(0,${Math.round(spec.glassRough * 255)},${Math.round(spec.glassMetal * 255)})`;
      shape(orm.g, a, b, 2); orm.g.fill();
      // the reveal: glass sits back in the wall
      hgt.g.fillStyle = "#3a3a3a"; shape(hgt.g, a, b); hgt.g.fill();
      // after dark about half the rooms are lit, warm and uneven
      if (lit) { emi.g.fillStyle = `rgb(${255 * lum | 0},${190 * lum | 0},${110 * lum | 0})`; shape(emi.g, a, b, 2); emi.g.fill(); }
    }
  }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    // the tile holds two bays by two floors
    t.repeat.set(0.5, 0.5);
    return t;
  };
  const nrm = normalFromHeight(hgt.c, spec.reveal); nrm.repeat.set(0.5, 0.5); nrm.anisotropy = 8;
  const ormT = tex(orm.c, false);
  const mat = new THREE.MeshStandardMaterial({
    map: tex(alb.c, true), roughnessMap: ormT, metalnessMap: ormT, normalMap: nrm,
    roughness: 1, metalness: 1, emissiveMap: tex(emi.c, true), emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0, vertexColors: true,
    // the studio environment is for the glass to reflect; on matte walls its
    // diffuse share only washes them out
    envMapIntensity: spec.glassMetal > 0.5 ? 0.8 : 0.3,
  });
  // The window glow is a texture shared by every building in the family; the
  // per-vertex `lit` scales it, so an empty building goes dark at night and a
  // full one blazes.
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float lit;\nvarying float vLit;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLit = lit;\nvGz = position.z;")
      .replace("varying float vLit;", "varying float vLit;\nvarying float vGz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLit;\nvarying float vGz;")
      // the street darkens the foot of every wall: bounce light from the sky
      // is blocked by the pavement and the buildings across the way
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 3.5, vGz));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLit;")
      // FAR AWAY, CALM DOWN. Past a few hundred metres a window is a pixel,
      // and its relief and mirror-glass reflection alias into shimmering
      // stripes. Fade the normal map out and rough the glass up with
      // distance — what a camera sees of a far tower anyway.
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nfloat farK = smoothstep(320.0, 1300.0, length(vViewPosition));\nroughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.62), farK);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - farK * 0.6;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, farK));");
  };
  mat.customProgramCacheKey = () => "bw-real-facade-lit-ao-far";
  return { key: spec.key, bayW: spec.bayW, floorH: spec.floorH, mat, masonry: spec.masonry, glass: spec.glass };
}

function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) * k, g = ((v >> 8) & 255) * k, b = (v & 255) * k;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const brickWall = (base: [number, number, number]) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#b8ab98"; g.fillRect(0, 0, w, h);
  const bw = 16, bh = 6;
  for (let y = 0, r = 0; y < h; y += bh, r++) for (let x = -((r % 2) * bw) / 2; x < w; x += bw) {
    const v = 0.84 + rnd() * 0.26;
    g.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
    g.fillRect(x + 1, y + 1, bw - 1.5, bh - 1.5);
  }
};
const stoneWallC = (c: [number, number, number], course = 21) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = `rgb(${c[0] * 0.9 | 0},${c[1] * 0.9 | 0},${c[2] * 0.87 | 0})`; g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += course, r++) for (let x = (r % 2) * 32; x < w; x += 64) {
    const v = 0.94 + rnd() * 0.09;
    g.fillStyle = `rgb(${c[0] * v | 0},${c[1] * v | 0},${c[2] * v | 0})`; g.fillRect(x + 1, y + 1, 62, course - 2);
  }
};
const stoneWall = stoneWallC([196, 186, 166]);
const panelWall = (base: string) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 1.5;
  for (let y = 0; y < h; y += TILE / 2) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`; g.fillRect(rnd() * w, rnd() * h, 3, 3); }
};
// brownstone: dressed sandstone courses, chocolate-red
const brownWallC = (c: [number, number, number]) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = `rgb(${c[0] * 0.73 | 0},${c[1] * 0.75 | 0},${c[2] * 0.76 | 0})`; g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += 16, r++) for (let x = (r % 2) * 24; x < w; x += 48) {
    const v = 0.9 + rnd() * 0.16;
    g.fillStyle = `rgb(${c[0] * v | 0},${c[1] * v | 0},${c[2] * v | 0})`; g.fillRect(x + 1, y + 1, 46, 14);
  }
};
const brownWall = brownWallC([128, 88, 68]);
// art deco: pale limestone with continuous piers rising between the windows
// and dark spandrel panels under them — the vertical read of the 1930s tower
const decoWallC = (face: string, recess: string, pier: string) => (g: CanvasRenderingContext2D, w: number, h: number) => {
  g.fillStyle = face; g.fillRect(0, 0, w, h);
  for (let bx = 0; bx < 2; bx++) {
    const ox = bx * TILE;
    g.fillStyle = recess; g.fillRect(ox + TILE * 0.30, 0, TILE * 0.40, h);           // the recessed bay
    g.fillStyle = pier; g.fillRect(ox, 0, TILE * 0.10, h); g.fillRect(ox + TILE * 0.9, 0, TILE * 0.1, h);   // pier faces
  }
};
const decoWall = decoWallC("#cbbfa7", "#4c4a46", "#ddd2bb");
// a shopfront storey: painted fascia and an awning band over each display window
const AWN = ["#7a2f2a", "#2f4f3e", "#2c3d5a", "#8a6a2c", "#5a2f4a", "#3b3b3b"];
const shopWall = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#4a3f36"; g.fillRect(0, 0, w, h);
  for (let bx = 0; bx < 2; bx++) for (let by = 0; by < 2; by++) {
    const ox = bx * TILE, oy = by * TILE;
    g.fillStyle = AWN[(rnd() * AWN.length) | 0];
    g.fillRect(ox + 4, oy + TILE * 0.18, TILE - 8, TILE * 0.13);          // awning
    g.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 8; i++) g.fillRect(ox + 4 + i * (TILE - 8) / 8, oy + TILE * 0.18, (TILE - 8) / 16, TILE * 0.13);
  }
};
const glassWall = (g: CanvasRenderingContext2D, w: number, h: number) => {
  // a curtain wall's "wall" is its spandrel band and its mullions
  g.fillStyle = "#3d4a52"; g.fillRect(0, 0, w, h);
};

// painted clapboard: lapped horizontal boards, each casting a hairline shadow
const clapWallC = (board: number) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#ece8de"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += board) {
    const v = 0.97 + rnd() * 0.05;
    g.fillStyle = `rgb(${236 * v | 0},${232 * v | 0},${222 * v | 0})`; g.fillRect(0, y + 1.5, w, board - 1.5);
    g.fillStyle = "rgba(60,55,45,0.28)"; g.fillRect(0, y, w, 1.5);
  }
  // corner boards at the tile edges
  g.fillStyle = "#f6f4ee"; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
};
const clapWall = clapWallC(7);
// a curtain wall's spandrel in another glass: bronze, or the blue-green of the 1990s
const tintedGlassWall = (col: string) => (g: CanvasRenderingContext2D, w: number, h: number) => { g.fillStyle = col; g.fillRect(0, 0, w, h); };

function makeFamilies(seed: number): Record<string, Family> {
  const F: FamilySpec[] = [
    { key: "brick", bayW: 2.7, floorH: 3.2, masonry: true, glass: false,
      win: { x0: 0.27, x1: 0.73, y0: 0.24, y1: 0.80 }, wall: brickWall([168, 96, 70]),
      glassCol: "#3f5562", frameCol: "#e9e2d2", wallRough: 0.88, glassRough: 0.12, glassMetal: 0.0,
      trim: "#ddd3c0", mullions: [1, 2], reveal: 3.2 },
    { key: "stone", bayW: 2.9, floorH: 3.8, masonry: true, glass: false,
      win: { x0: 0.25, x1: 0.75, y0: 0.22, y1: 0.80 }, wall: stoneWall,
      glassCol: "#34495a", frameCol: "#2c2a26", wallRough: 0.8, glassRough: 0.1, glassMetal: 0.0,
      trim: "#efe8d8", mullions: [2, 2], reveal: 3.0 },
    { key: "glass", bayW: 1.6, floorH: 3.9, masonry: false, glass: true,
      win: { x0: 0.04, x1: 0.96, y0: 0.20, y1: 0.98 }, wall: glassWall,
      glassCol: "#86a6b8", frameCol: "#5a646b", wallRough: 0.35, glassRough: 0.06, glassMetal: 0.85,
      reveal: 1.2 },
    { key: "modern", bayW: 3.2, floorH: 3.5, masonry: false, glass: false,
      win: { x0: 0.08, x1: 0.92, y0: 0.32, y1: 0.84 }, wall: panelWall("#c9c0b0"),
      glassCol: "#55707e", frameCol: "#555b60", wallRough: 0.7, glassRough: 0.08, glassMetal: 0.4,
      mullions: [3, 1], reveal: 2.0 },
    { key: "industrial", bayW: 4.2, floorH: 5.0, masonry: true, glass: false,
      win: { x0: 0.16, x1: 0.84, y0: 0.20, y1: 0.86 }, wall: brickWall([150, 82, 60]),
      glassCol: "#54646a", frameCol: "#2b2e30", wallRough: 0.9, glassRough: 0.2, glassMetal: 0.2,
      trim: "#9a8e7c", mullions: [6, 4], reveal: 2.6 },
    { key: "buff", bayW: 2.6, floorH: 3.2, masonry: true, glass: false,
      win: { x0: 0.28, x1: 0.72, y0: 0.24, y1: 0.80 }, wall: brickWall([206, 172, 120]),
      glassCol: "#3c5160", frameCol: "#3a2e24", wallRough: 0.88, glassRough: 0.12, glassMetal: 0.0,
      trim: "#8f4a32", mullions: [1, 2], reveal: 3.2 },
    { key: "brownstone", bayW: 3.0, floorH: 3.6, masonry: true, glass: false,
      win: { x0: 0.26, x1: 0.74, y0: 0.20, y1: 0.84 }, wall: brownWall,
      glassCol: "#37495a", frameCol: "#e6dfcf", wallRough: 0.82, glassRough: 0.1, glassMetal: 0.0,
      trim: "#6b4a3a", mullions: [1, 2], reveal: 3.8 },
    { key: "deco", bayW: 1.8, floorH: 3.7, masonry: true, glass: false,
      win: { x0: 0.30, x1: 0.70, y0: 0.10, y1: 0.92 }, wall: decoWall,
      glassCol: "#30404c", frameCol: "#1f2326", wallRough: 0.75, glassRough: 0.08, glassMetal: 0.2,
      mullions: [1, 3], reveal: 3.4 },
    // THE TOWERS OF THE SECOND HALF OF THE CENTURY were not one glass box.
    // 1960s International Style: ribbon windows between white aluminium
    // spandrel bands, the floors reading as horizontal stripes.
    { key: "ribbon", bayW: 1.6, floorH: 3.7, masonry: false, glass: false,
      win: { x0: 0.0, x1: 1.0, y0: 0.42, y1: 0.95 }, wall: panelWall("#d9d7d0"),
      glassCol: "#2b3943", frameCol: "#a3a8ab", wallRough: 0.45, glassRough: 0.06, glassMetal: 0.55,
      mullions: [2, 1], reveal: 1.2 },
    // 1960s-70s exposed concrete grid: deep square-ish punched windows
    { key: "grid", bayW: 2.2, floorH: 3.6, masonry: false, glass: false,
      win: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 }, wall: panelWall("#b8b4ab"),
      glassCol: "#2f3d47", frameCol: "#6b6a65", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.3,
      mullions: [1, 1], reveal: 4.4 },
    // 1970s-80s bronze-tinted curtain wall with dark mullions
    { key: "bronze", bayW: 1.5, floorH: 3.8, masonry: false, glass: true,
      win: { x0: 0.06, x1: 0.94, y0: 0.18, y1: 0.98 }, wall: tintedGlassWall("#3e3229"),
      glassCol: "#8a6c52", frameCol: "#4a3828", wallRough: 0.35, glassRough: 0.05, glassMetal: 0.85,
      reveal: 1.4 },
    // 1990s-2000s blue-green reflective glass, light silver frames
    { key: "blueglass", bayW: 1.5, floorH: 4.0, masonry: false, glass: true,
      win: { x0: 0.03, x1: 0.97, y0: 0.12, y1: 0.99 }, wall: tintedGlassWall("#2e4c5b"),
      glassCol: "#6f9fb0", frameCol: "#9aaab2", wallRough: 0.3, glassRough: 0.05, glassMetal: 0.9,
      reveal: 1.0 },
    // the other 1920s-30s setback tower: tan brick with tall, narrow,
    // vertically linked windows and dark spandrels between the piers
    { key: "decobrick", bayW: 1.9, floorH: 3.6, masonry: true, glass: false,
      win: { x0: 0.3, x1: 0.7, y0: 0.1, y1: 0.93 }, wall: brickWall([190, 156, 116]),
      glassCol: "#2c3a44", frameCol: "#3a3029", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.1,
      trim: "#6a5a48", mullions: [1, 2], reveal: 3.0 },
    // THE TIMBER TOWN. Before brick, the first streets of a young town were
    // wood: one- and two-storey clapboard houses and shops, painted, with
    // white-trimmed sash windows and a gable.
    { key: "clapboard", bayW: 2.8, floorH: 3.0, masonry: false, glass: false,
      win: { x0: 0.32, x1: 0.68, y0: 0.26, y1: 0.80 }, wall: clapWall,
      glassCol: "#34444e", frameCol: "#f4f1ea", wallRough: 0.8, glassRough: 0.12, glassMetal: 0.0,
      trim: "#f4f1ea", mullions: [1, 2], reveal: 1.6 },
    { key: "shop", bayW: 3.4, floorH: 4.2, masonry: false, glass: false,
      win: { x0: 0.06, x1: 0.94, y0: 0.04, y1: 0.66 }, wall: shopWall,
      glassCol: "#5d7380", frameCol: "#2a2622", wallRough: 0.7, glassRough: 0.06, glassMetal: 0.3,
      mullions: [2, 1], reveal: 2.2 },
    { key: "plain", bayW: 3.0, floorH: 3.6, masonry: true, glass: false, noWin: true,
      win: { x0: 0, x1: 0, y0: 0, y1: 0 }, wall: stoneWall,
      glassCol: "#556066", frameCol: "#2c2a26", wallRough: 0.8, glassRough: 0.8, glassMetal: 0,
      reveal: 1.0 },
    { key: "frame", bayW: 4.0, floorH: 3.6, masonry: false, glass: false,
      win: { x0: 0.08, x1: 0.92, y0: 0.10, y1: 0.92 }, wall: panelWall("#a7a49c"),
      glassCol: "#2a2b2c", frameCol: "#8d8a83", wallRough: 0.9, glassRough: 0.9, glassMetal: 0.0,
      reveal: 2.4 },
  ];
  const out: Record<string, Family> = {};
  F.forEach((f, i) => {
    out[f.key] = buildFamily(f, (seed * 31 + i * 977) % 2147483646 + 1);
    // the family's other three elevations, keyed "brick#1".."brick#3"
    (VARIANTS[f.key] ?? []).forEach((v, j) => {
      const key = `${f.key}#${j + 1}`;
      out[key] = { ...buildFamily({ ...f, ...v, key }, (seed * 31 + i * 977 + (j + 1) * 7919) % 2147483646 + 1), key: f.key };
    });
  });
  return out;
}

// FOUR ELEVATIONS A FAMILY. A family was one painted texture, so every
// brick walk-up on the island wore the same brick, the same sash and the
// same lintel. Each family now has three more, art-directed rather than
// random and each true to its period: the Italianate segmental arch and the
// Federal pediment and shutters on the walk-ups, white and sandstone and
// granite on the Beaux-Arts stone, smoked, silver and green glass on the
// curtain walls. A building draws one from a hash of its own deed.
const VARIANTS: Record<string, Partial<FamilySpec>[]> = {
  brick: [
    { wall: brickWall([130, 62, 48]), winStyle: "segment", trim: "#d9cdb5", frameCol: "#2a2a2a" },
    { wall: brickWall([188, 112, 72]), lintel: "pediment", trim: "#e8e2d4", shutter: "#2f4a3a", frameCol: "#f0ece2" },
    { wall: brickWall([205, 200, 190]), winStyle: "arch", trim: "#8a8478", frameCol: "#222222", glassCol: "#3a4a55" },
  ],
  buff: [
    { wall: brickWall([218, 196, 150]), winStyle: "segment", trim: "#6e4a32" },
    { wall: brickWall([176, 148, 108]), winStyle: "pair", trim: "#efe6d2", frameCol: "#2c2a26" },
    { wall: brickWall([196, 170, 140]), lintel: "pediment", trim: "#5a4636", shutter: "#3a3f46" },
  ],
  brownstone: [
    { wall: brownWallC([148, 104, 80]), winStyle: "arch", trim: "#5a3e30" },
    { wall: brownWallC([110, 74, 60]), lintel: "pediment", trim: "#7b5a48", frameCol: "#d8d0c0" },
    { wall: brownWallC([140, 96, 84]), winStyle: "segment", frameCol: "#2a2a2a" },
  ],
  stone: [
    { wall: stoneWallC([212, 206, 190]), winStyle: "arch", frameCol: "#1e2226", mullions: [2, 3] },
    { wall: stoneWallC([176, 160, 138]), lintel: "pediment", trim: "#e8e0cc" },
    { wall: stoneWallC([160, 150, 140], 26), winStyle: "pair", frameCol: "#2b2e30" },
  ],
  deco: [
    { wall: decoWallC("#d8cdb5", "#3b4248", "#e8dfcb") },
    { wall: decoWallC("#b9b2a6", "#5a4b40", "#ccc5b8"), glassCol: "#3a3a33" },
    { wall: decoWallC("#c9a98a", "#40352e", "#d8bc9c") },
  ],
  decobrick: [
    { wall: brickWall([160, 120, 92]) },
    { wall: brickWall([205, 175, 140]), trim: "#4a3e34" },
    { wall: brickWall([150, 80, 60]), trim: "#d8ccb4" },
  ],
  industrial: [
    { wall: brickWall([130, 72, 58]), winStyle: "segment", mullions: [6, 5] },
    { wall: brickWall([170, 150, 120]), mullions: [4, 3], trim: "#7a6a58" },
    { wall: panelWall("#9a9a94"), frameCol: "#4a4e52", mullions: [8, 4], trim: undefined },
  ],
  modern: [
    { wall: panelWall("#d6d2c8"), win: { x0: 0.05, x1: 0.95, y0: 0.32, y1: 0.84 }, frameCol: "#33393e" },
    { wall: panelWall("#a69a8a"), winStyle: "pair" },
    { wall: brickWall([150, 86, 66]), win: { x0: 0.1, x1: 0.9, y0: 0.3, y1: 0.8 }, frameCol: "#d8d8d8" },
  ],
  ribbon: [
    { wall: panelWall("#8a929a"), glassCol: "#22303a" },
    { wall: panelWall("#3a3f44"), glassCol: "#4a6070", frameCol: "#20242a" },
    { wall: panelWall("#c9b89a"), glassCol: "#3a3528" },
  ],
  grid: [
    { wall: panelWall("#d4cfc4"), win: { x0: 0.14, x1: 0.86, y0: 0.2, y1: 0.8 } },
    { wall: panelWall("#9c968c"), win: { x0: 0.2, x1: 0.8, y0: 0.3, y1: 0.75 } },
    { wall: brickWall([120, 90, 75]), frameCol: "#2a2a2a" },
  ],
  glass: [
    { wall: tintedGlassWall("#2a3540"), glassCol: "#5c7f94" },
    { wall: tintedGlassWall("#465058"), glassCol: "#9fb4bf", frameCol: "#7a8890" },
    { wall: tintedGlassWall("#253a3a"), glassCol: "#6a9a8f" },
  ],
  bronze: [
    { wall: tintedGlassWall("#2a1f18"), glassCol: "#5e4a38" },
    { wall: tintedGlassWall("#3a3a38"), glassCol: "#6e6a60", frameCol: "#2a2a28" },
    { wall: tintedGlassWall("#1e2228"), glassCol: "#3e4c58", frameCol: "#15181c" },
  ],
  blueglass: [
    { wall: tintedGlassWall("#244a64"), glassCol: "#4f8fb8" },
    { wall: tintedGlassWall("#3a5a5a"), glassCol: "#7fb4ae" },
    { wall: tintedGlassWall("#4a5a6a"), glassCol: "#a8c4d4", frameCol: "#c4ccd2" },
  ],
  clapboard: [
    { wall: clapWallC(9), shutter: "#2f4a3a" },
    { wall: clapWallC(6), lintel: "pediment" },
    { wall: clapWallC(8), shutter: "#3a2a26", winStyle: "pair" },
  ],
  shop: [
    { glassCol: "#4a6470", frameCol: "#1f2a24" },
    { glassCol: "#607884", frameCol: "#5a2a26" },
    { glassCol: "#55707e", frameCol: "#d8d0c0" },
  ],
};

/** Which elevation a building wears: by what it is, when it went up and how tall — and a per-building roll among the period-correct ones. */
function familyFor(cls: string, year: number, h: number, roll = 0.5): string {
  // a house or a shop of two storeys from before 1950 is, as often as not,
  // timber — wood frame stayed the American small building until the 1950s
  if (h <= 8.5 && year < 1950 && (cls === "multifamily" || cls === "retail") && ((roll * 7.13) % 1) < 0.5) return "clapboard";
  // a low pre-war masonry building is one of three brick traditions
  const oldBrick = () => roll < 0.55 ? "brick" : roll < 0.8 ? "buff" : "brownstone";
  if (cls === "industrial") return "industrial";
  if (cls === "office") {
    if (year >= 1958) {
      if (h <= 30) return "modern";
      // by when it went up: the ribbon and the grid, then bronze, then blue
      if (year < 1973) return roll < 0.4 ? "ribbon" : roll < 0.65 ? "grid" : "glass";
      if (year < 1988) return roll < 0.4 ? "bronze" : roll < 0.65 ? "glass" : roll < 0.82 ? "grid" : "ribbon";
      return roll < 0.45 ? "glass" : roll < 0.85 ? "blueglass" : "bronze";
    }
    if (year >= 1922 && h > 30) return roll < 0.35 ? "deco" : roll < 0.65 ? "decobrick" : "stone";
    return h > 22 ? "stone" : oldBrick();
  }
  if (cls === "multifamily") {
    // low-rise apartments of every era are mostly brick; the panel and glass
    // elevations belong to the mid- and high-rise slabs
    if (h < 26) return year < 1930 ? oldBrick() : roll < 0.75 ? "brick" : "buff";
    if (year < 1945) return h > 40 ? (roll < 0.3 ? "deco" : roll < 0.65 ? "decobrick" : "stone") : oldBrick();
    if (year > 1995 && h > 40) return roll < 0.6 ? "glass" : "blueglass";
    // the post-war slab blocks: panel, or a concrete grid
    return year < 1985 && h > 30 && roll < 0.4 ? "grid" : "modern";
  }
  if (cls === "retail") return year < 1965 || h < 12 ? oldBrick() : "modern";
  return year < 1945 || h < 14 ? oldBrick() : "modern";
}

// per-building wall tints within a family: brick hues, stone creams, glass casts
const TINTS: Record<string, [number, number, number][]> = {
  brick: [[1, 1, 1], [0.86, 0.80, 0.78], [1.06, 0.96, 0.86], [0.78, 0.66, 0.62], [1.1, 1.0, 0.92], [0.92, 0.9, 0.94]],
  stone: [[1, 1, 1], [0.96, 0.94, 0.9], [1.02, 0.98, 0.92], [0.9, 0.9, 0.9]],
  glass: [[1, 1, 1], [0.85, 0.95, 0.92], [1.05, 0.96, 0.84], [0.82, 0.86, 0.95]],
  modern: [[1, 1, 1], [0.93, 0.86, 0.78], [0.84, 0.86, 0.88], [1.0, 0.92, 0.82], [0.78, 0.76, 0.74], [0.95, 0.82, 0.72]],
  industrial: [[1, 1, 1], [0.9, 0.86, 0.82], [0.82, 0.78, 0.76]],
  ribbon: [[1, 1, 1], [0.92, 0.93, 0.95], [1.0, 0.97, 0.92], [0.84, 0.85, 0.86]],
  grid: [[1, 1, 1], [0.94, 0.92, 0.88], [0.86, 0.86, 0.86], [1.04, 1.0, 0.94]],
  bronze: [[1, 1, 1], [0.9, 0.86, 0.8], [1.08, 1.0, 0.9]],
  blueglass: [[1, 1, 1], [0.86, 0.98, 0.94], [0.9, 0.94, 1.04]],
  frame: [[1, 1, 1]],
  // white, cream, butter, sage, slate blue, barn red, grey
  clapboard: [[1, 1, 1], [1.0, 0.96, 0.86], [1.0, 0.93, 0.7], [0.78, 0.86, 0.74], [0.7, 0.8, 0.9], [0.72, 0.36, 0.3], [0.8, 0.8, 0.8]],
  plain: [[1, 1, 1]],
  shop: [[1, 1, 1]],
  buff: [[1, 1, 1], [0.95, 0.92, 0.86], [1.04, 1.0, 0.92], [0.9, 0.86, 0.8]],
  brownstone: [[1, 1, 1], [0.9, 0.86, 0.84], [1.06, 1.0, 0.95]],
  decobrick: [[1, 1, 1], [0.94, 0.88, 0.82], [1.06, 1.0, 0.9], [0.86, 0.78, 0.72]],
  deco: [[1, 1, 1], [0.96, 0.93, 0.88], [0.9, 0.9, 0.92], [1.03, 0.99, 0.92]],
};

// WHAT A ROOF IS MADE OF. Pre-war masonry carries tar and gravel, dark and
// warm; a post-war slab a paler ballast; the glass towers and new blocks a
// white membrane; a shed galvanised sheet; a gable slate or asphalt shingle.
// Each building draws its own shade within its kind, so a block of roofs
// reads as a patchwork rather than one grey sheet. (Vertex colours: the roof
// material's own colour — snow, season — multiplies them.)
function roofTone(fam: string, cls: string, pitched: boolean, seedK: number): number[] {
  const r = ((seedK * 2654435761) >>> 0) / 4294967296;
  const j = 0.92 + ((seedK >>> 5) % 17) / 100;            // ±8% per building
  if (pitched) return r < 0.6 ? [0.48 * j, 0.47 * j, 0.5 * j] : [0.72 * j, 0.5 * j, 0.4 * j];
  if (fam === "industrial") return r < 0.5 ? [0.98 * j, 1.0 * j, 1.03 * j] : [0.55 * j, 0.53 * j, 0.52 * j];
  if (fam === "glass" || fam === "bronze" || fam === "blueglass") return r < 0.75 ? [1.32 * j, 1.33 * j, 1.34 * j] : [0.9 * j, 0.9 * j, 0.92 * j];
  if (fam === "modern" || fam === "plain" || fam === "ribbon" || fam === "grid" || cls === "retail") {
    if (r < 0.06 && fam === "modern") return [0.72 * j, 0.95 * j, 0.58 * j];  // a planted roof
    return r < 0.55 ? [1.25 * j, 1.25 * j, 1.24 * j] : [1.0 * j, 0.97 * j, 0.92 * j];
  }
  // masonry: tar, gravel, or a later silver-painted coat
  return r < 0.45 ? [0.46 * j, 0.44 * j, 0.42 * j] : r < 0.85 ? [0.86 * j, 0.79 * j, 0.68 * j] : [1.2 * j, 1.2 * j, 1.22 * j];
}

/** Roofing at 16 m a repeat: strips with lapped seams, patching, grit. */
function roofTex(): THREE.CanvasTexture {
  const { c, g } = makeCanvas(256, 256);
  let s = 57; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = "#f2f2f2"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {                           // patches and ponding stains
    const v = 200 + rnd() * 50 | 0;
    g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`;
    g.fillRect(rnd() * 256, rnd() * 256, 10 + rnd() * 50, 8 + rnd() * 30);
  }
  for (let i = 0; i < 5000; i++) { const v = 170 + rnd() * 85 | 0; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5); }
  for (let y = 0; y < 256; y += 32) { g.fillStyle = "rgba(120,120,120,0.35)"; g.fillRect(0, y, 256, 1.5); g.fillStyle = "rgba(255,255,255,0.4)"; g.fillRect(0, y + 1.5, 256, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(0.25, 0.25);
  return t;
}

// AERIAL PERSPECTIVE. Air between the eye and a far building scatters sky
// light into the view, so distance reads as a fade toward the haze colour —
// the same #bdd1e6 the MapLibre sky fogs its ground to (style.ts skySpec), so
// the far city dissolves into the air the sky is made of. Without it every
// block is as crisp and contrasty a kilometre off as at the kerb, which is
// what makes a city look like a model on a table. Mixed in after the colour
// space conversion, in display sRGB, where the sky colour is defined.
const HAZE = {
  hazeCol: { value: new THREE.Color(0.742, 0.818, 0.9) },
  hazeNear: { value: 300 },
  hazeFar: { value: 4000 },
  hazeCap: { value: 0.5 },
};
const hazed = new WeakSet<THREE.Material>();
function addHaze(mat: THREE.Material) {
  if (hazed.has(mat)) return;
  hazed.add(mat);
  const m = mat as THREE.Material & { isShadowMaterial?: boolean };
  const k0 = mat.customProgramCacheKey();
  const prev = mat.onBeforeCompile;
  // a shadow catcher is all alpha: its shadows thin out with distance instead
  const mix = m.isShadowMaterial ? "gl_FragColor.a *= 1.0 - hz;" : "gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, hz);";
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, HAZE);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHazeP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvHazeP = mvPosition.xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHazeP;\nuniform vec3 hazeCol;\nuniform float hazeNear, hazeFar, hazeCap;")
      .replace("#include <fog_fragment>", `{ float hz = smoothstep(hazeNear, hazeFar, length(vHazeP)) * hazeCap; ${mix} }\n#include <fog_fragment>`);
  };
  mat.customProgramCacheKey = () => k0 + "+haze" + (m.isShadowMaterial ? "s" : "");
  mat.needsUpdate = true;
}

// ---- the player's design --------------------------------------------------
// What the Build desk offers. The facade names are the elevations VARIANTS
// paints, in order (#0 is the family's own); the paints are the trim colours
// the generator already uses; nothing here is priced (BuildingDesign).
export const TRIM_PAINTS: { name: string; rgb: number[] }[] = [
  { name: "Stone", rgb: [1, 1, 1] },
  { name: "Green", rgb: [0.42, 0.55, 0.45] },
  { name: "Black", rgb: [0.3, 0.3, 0.32] },
  { name: "Terracotta", rgb: [0.98, 0.66, 0.5] },
  { name: "Grey", rgb: [0.8, 0.8, 0.8] },
];
export const FACADE_STYLES: { key: string; name: string; era: string; maxFloors: number; variants: string[] }[] = [
  { key: "clapboard", name: "Clapboard", era: "timber, to 1950", maxFloors: 3, variants: ["Painted boards", "Wide boards, shutters", "Pedimented", "Paired sash, shutters"] },
  { key: "brick", name: "Red brick", era: "walk-up, 1870-1930", maxFloors: 14, variants: ["Common red", "Italianate arches", "Federal, shuttered", "Painted, round-arched"] },
  { key: "buff", name: "Buff brick", era: "1890-1940", maxFloors: 16, variants: ["Buff", "Pale, segmental", "Tan, paired", "Grey-buff, pedimented"] },
  { key: "brownstone", name: "Brownstone", era: "row house, 1850-1900", maxFloors: 8, variants: ["Chocolate", "Light, arched", "Dark, pedimented", "Mauve, segmental"] },
  { key: "stone", name: "Limestone", era: "Beaux-Arts, 1890-1930", maxFloors: 40, variants: ["Limestone", "White, arched", "Sandstone, pedimented", "Granite, paired"] },
  { key: "deco", name: "Art deco", era: "1925-1940", maxFloors: 99, variants: ["Cream piers", "Pale, green spandrels", "Grey, bronze spandrels", "Terracotta pink"] },
  { key: "decobrick", name: "Deco brick", era: "1925-1945", maxFloors: 99, variants: ["Tan", "Brown", "Light buff", "Red"] },
  { key: "industrial", name: "Loft / warehouse", era: "1880-1950", maxFloors: 12, variants: ["Red factory", "Dark, segmental", "Buff", "Concrete frame"] },
  { key: "modern", name: "Post-war panel", era: "1950-1990", maxFloors: 40, variants: ["Beige panel", "White, wide glass", "Tan, paired", "Brick and glass"] },
  { key: "ribbon", name: "Ribbon windows", era: "International Style, 1955-1975", maxFloors: 99, variants: ["White bands", "Grey bands", "Black tower", "Tan bands"] },
  { key: "grid", name: "Concrete grid", era: "1960-1980", maxFloors: 99, variants: ["Concrete", "White grid", "Deep-set, grey", "Brown brick grid"] },
  { key: "glass", name: "Glass curtain wall", era: "1960-today", maxFloors: 99, variants: ["Blue-grey", "Dark", "Silver", "Green"] },
  { key: "bronze", name: "Bronze glass", era: "1970-1990", maxFloors: 99, variants: ["Bronze", "Deep bronze", "Smoked grey", "Black glass"] },
  { key: "blueglass", name: "Blue glass", era: "1990-today", maxFloors: 99, variants: ["Blue-green", "Deep blue", "Teal", "Silver-blue"] },
];
export const ROOF_CHOICES: { key: NonNullable<BuildingDesign["roof"]>; name: string; maxFloors: number }[] = [
  { key: "flat", name: "Flat", maxFloors: 999 },
  { key: "gable", name: "Gable", maxFloors: 4 },
  { key: "hip", name: "Hipped", maxFloors: 4 },
  { key: "mansard", name: "Mansard", maxFloors: 12 },
];
export const CROWN_CHOICES: { key: NonNullable<BuildingDesign["crown"]>; name: string }[] = [
  { key: "none", name: "Flat top" },
  { key: "setback", name: "Setback" },
  { key: "mast", name: "Crown and mast" },
  { key: "spire", name: "Spire" },
  { key: "cake", name: "Wedding cake" },
];
/** Crowns are offered from this many floors. */
export const CROWN_MIN_FLOORS = 15;

type VolumeOv = { variant?: string; trim?: number; roof?: BuildingDesign["roof"] };

let swatchCache: Record<string, string> | null = null;
/** A small picture of every elevation, for the Build desk's facade picker. */
export function facadeSwatches(): Record<string, string> {
  if (swatchCache) return swatchCache;
  const fams = makeFamilies(1);
  const out: Record<string, string> = {};
  for (const st of FACADE_STYLES) for (let v = 0; v < 4; v++) {
    const key = v ? `${st.key}#${v}` : st.key;
    const img = (fams[key]?.mat.map?.image ?? null) as HTMLCanvasElement | null;
    if (!img || typeof img.toDataURL !== "function") continue;
    const { c, g } = makeCanvas(96, 96);
    g.drawImage(img, 0, 0, img.width, img.height, 0, 0, 96, 96);
    out[key] = c.toDataURL("image/png");
  }
  for (const f of Object.values(fams)) { f.mat.map?.dispose(); f.mat.dispose(); }
  swatchCache = out;
  return out;
}

// ---- geometry accumulation -------------------------------------------------

class Buf {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = [];
  get count() { return this.pos.length / 3; }
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][], col: number[]) {
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]] as [number[], number[]][]) {
      this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(t[0], t[1]); this.col.push(col[0], col[1], col[2]);
    }
  }
  tri(a: number[], b: number[], c: number[], n: number[], col: number[]) {
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(p[0] * 0.25, p[1] * 0.25); this.col.push(col[0], col[1], col[2]); }
  }
  /** A planar polygon (fan), wound so its normal leans toward `want`. */
  face(pts: number[][], want: number[], col: number[], uvOf: (p: number[]) => number[] = (p) => [p[0] * 0.25, p[1] * 0.25]) {
    const ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1], uz = pts[1][2] - pts[0][2];
    const vx = pts[2][0] - pts[0][0], vy = pts[2][1] - pts[0][1], vz = pts[2][2] - pts[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    for (let i = 1; i + 1 < pts.length; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        const t = uvOf(p);
        this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.uv.push(t[0], t[1]); this.col.push(col[0], col[1], col[2]);
      }
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    // how many of this building's rooms are lit after dark (see setOccupancy)
    g.setAttribute("lit", new THREE.Float32BufferAttribute(new Float32Array(this.count).fill(1), 1));
    g.computeBoundingSphere();
    return g;
  }
}

interface Mover { x: number; y: number; ux: number; uy: number; len: number; ph: number; spd: number; col: number[]; draw?: number; dem?: number }
interface Range { buf: string; start: number; count: number; mesh?: THREE.Mesh; base?: number[] }
interface Deed { ranges: Range[]; height: number; ring: P2[] | null; inst: { mesh: string; i: number }[] }

// ---- the layer -------------------------------------------------------------

export class RealCityLayer {
  id = "bw-three-buildings";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map!: maplibregl.Map;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private origin = { x: 0, y: 0, z: 0, s: 1 };
  private sun = new THREE.DirectionalLight(0xffe6c8, 3.4);
  private hemi = new THREE.HemisphereLight(0xc6d8ee, 0x8a7d6a, 0.6);
  private families: Record<string, Family> = {};
  private trimMat = new THREE.MeshStandardMaterial({ color: 0xd8d0be, roughness: 0.75, vertexColors: true, envMapIntensity: 0.3 });
  private darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.5, metalness: 0.4, vertexColors: true });
  private roofMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.95, vertexColors: true, envMapIntensity: 0.15, map: roofTex() });
  private veil = new THREE.MeshBasicMaterial({ color: 0x0b1020, transparent: true, opacity: 0, depthWrite: false });
  private leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true, envMapIntensity: 0.2 });
  private barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 1 });
  private pineMat = new THREE.MeshStandardMaterial({ color: 0x2e4a32, roughness: 1, flatShading: true, envMapIntensity: 0.08 });
  private bedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  private meadowMat = new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0.1 });
  private lampMat = new THREE.MeshStandardMaterial({ color: 0x2b3033, metalness: 0.6, roughness: 0.4, emissive: new THREE.Color(1.0, 0.72, 0.38), emissiveIntensity: 0 });
  private meshes = new Map<string, THREE.Mesh>();
  private bufs = new Map<string, Buf>();
  private deeds = new Map<string, Deed>();
  private flattened = new Set<string>();
  private inst = new Map<string, THREE.InstancedMesh>();
  private dyn = new THREE.Group();
  private dynSig = "";
  private dynHeight = new Map<string, number>();
  private dynDeeds = new Map<string, Deed>();
  private shadowFocus = new THREE.Vector3(1e9, 0, 0);
  private shadowSpan = 0;
  private sunDir = new THREE.Vector3(0.45, -0.55, 0.7).normalize();
  private dusk = 0;
  private duskTarget = 0;
  private month = 0;
  private snow = 0;
  private owned = new Set<string>();
  private selected = new Set<string>();
  private hover: string | null = null;
  private lens: Map<string, number> | null = null;
  private lensRamp: THREE.Color[] = [];
  private tints = new Map<string, [number, number, number]>();
  private viewH = 900;

  private preferFps = false;
  /** Graphics quality: how much of the city's small detail is drawn, how far. */
  private quality: "low" | "medium" | "high" = "high";
  private crowdK = 1;
  private cullM = 2600;
  private catcher: THREE.Mesh | null = null;
  private lotRingLL: Record<string, P2[]>;
  private visibleOn = true;

  constructor(
    private volumes: BuildingVolume[],
    private center: [number, number],
    private curbs: [number, number][][],
    private ctx: Ctx,
    private seed: number,
  ) {
    this.lotRingLL = (ctx as { lots?: Record<string, P2[]> }).lots ?? {};
  }

  /** Every deed with a building drawn (MapView walks its keys to push state). */
  get rangesByBBL(): Map<string, unknown> { return this.deeds; }

  // ---- MapLibre custom layer --------------------------------------------
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: this.center[0], lat: this.center[1] }, 0);
    this.origin = { x: mc.x, y: mc.y, z: mc.z, s: mc.meterInMercatorCoordinateUnits() };
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.camera.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = true;
    const pm = new THREE.PMREMGenerator(this.renderer);
    // matte surfaces take their ambient light from a neutral light box; the
    // glass and the water reflect the sky (skyEnvironment)
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    this.skyEnv = pm.fromScene(skyEnvironment(), 0.02).texture;
    this.scene.environmentIntensity = 0.5;
    pm.dispose();
    this.families = makeFamilies(this.seed || 1);
    for (const f of Object.values(this.families)) if (f.glass || f.key === "ribbon") f.mat.envMap = this.skyEnv;
    this.setupLights();
    this.buildCity();
    this.buildGround();
    this.buildChannels();
    this.buildBridges();
    this.buildStreetLife();
    this.scene.add(this.dyn);
    const measure = () => { this.viewH = map.getContainer().clientHeight || 900; };
    measure(); map.on("resize", measure);
    map.on("moveend", () => this.map.triggerRepaint());
  }

  onRemove() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.renderer?.dispose();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: maplibregl.CustomRenderMethodInput) {
    if (!this.visibleOn) return;
    // where the eye is, in local metres (same derivation ThreeBuildings uses)
    const c = this.map.getCenter();
    const z = this.map.getZoom();
    const bearing = (this.map.getBearing() * Math.PI) / 180;
    const pitch = (this.map.getPitch() * Math.PI) / 180;
    const mpp = (78271.517 * Math.cos((c.lat * Math.PI) / 180)) / Math.pow(2, z);
    const distM = ((0.5 * this.viewH) / Math.tan(0.32175)) * mpp;
    const [fx, fy] = this.project([c.lng, c.lat]);
    const back = distM * Math.sin(pitch);
    const eye = new THREE.Vector3(fx - Math.sin(bearing) * back, fy - Math.cos(bearing) * back, distM * Math.cos(pitch));

    // The camera stands AT the eye with no rotation; MapLibre's matrix (with
    // that translation folded back in) does the projecting. So lighting runs
    // in an axis-aligned, eye-centred space and the stock materials see a real
    // camera position for their reflections and Fresnel.
    const m = new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix as unknown as number[]);
    const l = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, this.origin.z)
      .scale(new THREE.Vector3(this.origin.s, -this.origin.s, this.origin.s));
    const proj = m.multiply(l).multiply(new THREE.Matrix4().makeTranslation(eye.x, eye.y, eye.z));
    this.camera.projectionMatrix.copy(proj);
    this.camera.projectionMatrixInverse.copy(proj).invert();
    this.camera.matrix.makeTranslation(eye.x, eye.y, eye.z);
    this.camera.matrixWorldNeedsUpdate = true;

    this.stepDusk();
    this.fitShadow(fx, fy, distM);
    // from the whole-island camera a person, a lamp or a car is a fraction of
    // a pixel: stop drawing them there rather than paying for grain
    // The graphics setting pulls that horizon in, and on Medium and Low takes
    // the garden-scale furniture with it.
    const far = distM > this.cullM, veryFar = distM > Math.max(4200, this.cullM * 1.6);
    for (const f of this.fleets) f.mesh.visible = f.list === this.boats ? !veryFar : !far;
    for (const k of this.quality === "high" ? FAR_PROPS : FAR_PROPS_LOW) { const m = this.inst.get(k); if (m) m.visible = !far; }
    const beds = this.inst.get("flowerbed");
    if (beds) beds.visible = this.month >= 3 && this.month <= 9 && !(far && this.quality !== "high");
    this.renderer.resetState();
    if ((this.fleets.length || this.cranes) && !this.paused && typeof document !== "undefined" && !document.hidden) {
      const now = performance.now();
      this.stepTraffic(now / 1000);
      // ~30 fps for the traffic; MapLibre only paints on demand
      if (now - this.lastTick > 33) { this.lastTick = now; requestAnimationFrame(() => this.map?.triggerRepaint()); }
    }
    this.hazeFor(distM);
    if (this.precip) this.stepPrecip(fx, fy, distM, performance.now() / 1000);
    if (this.waves.length) {
      // about half a metre a second downwind, a little across
      const tt = performance.now() / 1000;
      for (const w of this.waves) w.tex.offset.set((tt * 0.5) / w.tile, (tt * 0.12) / w.tile);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.dusk !== this.duskTarget) this.map.triggerRepaint();
  }

  // ---- aerial perspective ------------------------------------------------
  // Scaled to the view: the fade starts a little past the focus and reaches
  // its cap several view-distances out, so a street view hazes the far
  // skyline and the island view keeps its far shore readable.
  private hazeSheet: THREE.Mesh | null = null;
  private skyEnv: THREE.Texture | null = null;
  // the water's ripple maps, drifting downwind (UV units per tile differ by mesh)
  private waves: { tex: THREE.Texture; tile: number }[] = [];
  private waveTex(uvPerMetre: number): THREE.Texture {
    const base = this.waves[0]?.tex;
    const t = base ? base.clone() : rippleNormal();
    const TILE_M = 28;
    t.repeat.set(1 / (TILE_M * uvPerMetre), 1 / (TILE_M * uvPerMetre));
    this.waves.push({ tex: t, tile: TILE_M });
    return t;
  }
  private hazeFor(distM: number) {
    HAZE.hazeNear.value = distM * 0.35;
    HAZE.hazeFar.value = distM * 2.6 + 400;
    if (!this.hazeSheet) {
      // MapLibre's ground is not ours to shade: a sheet over it carries the
      // same fade, so a far street hazes with the buildings standing on it
      const mat = new THREE.ShaderMaterial({
        uniforms: HAZE, transparent: true, depthWrite: false,
        vertexShader: "varying vec3 vP; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }",
        fragmentShader: "uniform vec3 hazeCol; uniform float hazeNear, hazeFar, hazeCap; varying vec3 vP; void main() { gl_FragColor = vec4(hazeCol, smoothstep(hazeNear, hazeFar, length(vP)) * hazeCap); }",
      });
      hazed.add(mat);
      hazed.add(this.veil);
      this.hazeSheet = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000, 8, 8), mat);
      this.hazeSheet.position.z = 0.035; this.hazeSheet.renderOrder = -2; this.hazeSheet.frustumCulled = false;
      this.scene.add(this.hazeSheet);
    }
    this.scene.traverse((o) => {
      const mm = (o as THREE.Mesh).material;
      if (!mm) return;
      for (const x of Array.isArray(mm) ? mm : [mm]) if (!hazed.has(x)) addHaze(x);
    });
  }

  // ---- lights & shadow ---------------------------------------------------
  private setupLights() {
    this.sun.castShadow = this.quality !== "low";
    const sz = this.preferFps ? 2048 : 4096;
    this.sun.shadow.mapSize.set(sz, sz);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.applyMonth();
  }

  /** The shadow box follows the view, sized to what the camera can see. */
  private fitShadow(fx: number, fy: number, distM: number) {
    const span = Math.max(260, Math.min(2600, distM * 1.6));
    const moved = Math.hypot(fx - this.shadowFocus.x, fy - this.shadowFocus.y);
    if (moved < span * 0.12 && Math.abs(span - this.shadowSpan) < this.shadowSpan * 0.15) return;
    this.shadowFocus.set(fx, fy, 0);
    this.shadowSpan = span;
    const cam = this.sun.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 10; cam.far = 6000;
    cam.updateProjectionMatrix();
    this.sun.target.position.set(fx, fy, 0);
    this.sun.position.set(fx, fy, 0).addScaledVector(this.sunDir, 2500);
    this.sun.target.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ---- coordinates -------------------------------------------------------
  private project([lon, lat]: [number, number]): P2 {
    const kx = 111320 * Math.cos((this.center[1] * Math.PI) / 180);
    return [(lon - this.center[0]) * kx, (lat - this.center[1]) * 111320];
  }

  // ---- the buildings -----------------------------------------------------
  private buf(name: string): Buf {
    let b = this.bufs.get(name);
    if (!b) { b = new Buf(); this.bufs.set(name, b); }
    return b;
  }

  private note(bbl: string, name: string, start: number) {
    if (!bbl) return;
    const d = this.deedOf(bbl);
    const b = this.bufs.get(name)!;
    if (b.count > start) d.ranges.push({ buf: name, start, count: b.count - start });
  }

  private deedOf(bbl: string): Deed {
    let d = this.deeds.get(bbl);
    if (!d) { d = { ranges: [], height: 0, ring: null, inst: [] }; this.deeds.set(bbl, d); }
    return d;
  }

  /**
   * A TOWER ENDS IN SOMETHING. A deco tower steps back twice and finishes in a
   * spire; a glass tower carries a recessed mechanical crown and a mast; the
   * International Style a plain penthouse; a stone office one setback. "auto"
   * is the period's choice; the player's design can name one instead.
   */
  private towerTop(ring: P2[], z1: number, top: number, fam: string, t: number[], bbl: string, k: number,
    kind: "auto" | "none" | "setback" | "spire" | "mast", ov?: VolumeOv) {
    const glassy = fam === "glass" || fam === "bronze" || fam === "blueglass";
    if (kind === "none") return;
    if (kind === "auto" && !(top > 60 && (glassy || fam === "deco" || fam === "decobrick" || fam === "stone" || fam === "ribbon" || fam === "grid"))) return;
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length; cy /= ring.length;
    const shrink = (r: P2[], f: number) => r.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as P2);
    const deco = fam === "deco" || fam === "decobrick";
    if (kind === "spire" || (kind === "auto" && deco)) {
      this.addVolume(shrink(ring, 0.78), z1, z1 + 7, fam, t, bbl, false, false, k, false, false, "", 0, ov);
      this.addVolume(shrink(ring, 0.56), z1 + 7, z1 + 12, fam, t, bbl, true, false, k, false, false, "", 0, ov);
      this.putInst("spire", cx, cy, z1 + 12, 1 + Math.max(0, top - 60) / 120, 0, bbl);
    } else if (kind === "mast" || (kind === "auto" && glassy)) {
      // a recessed mechanical crown; one in three steps back twice
      const two = kind === "auto" && hash01(k ^ 0x5e7, this.seed) < 0.33;
      this.addVolume(shrink(ring, 0.86), z1, z1 + 5, fam, t, bbl, !two, false, k, false, false, "", 0, ov);
      if (two) this.addVolume(shrink(ring, 0.62), z1 + 5, z1 + 11, fam, t, bbl, true, false, k, false, false, "", 0, ov);
      if (kind === "mast" || hash01(k ^ 0x77, this.seed) < 0.6) this.putInst("mast", cx, cy, z1 + (two ? 11 : 5), 1, 0, bbl);
    } else if (kind === "auto" && (fam === "ribbon" || fam === "grid")) {
      // the International Style keeps its plant in a plain penthouse box
      this.addVolume(shrink(ring, 0.62), z1, z1 + 4.5, "plain", [0.9, 0.9, 0.9], bbl, true, true, k);
    } else {
      this.addVolume(shrink(ring, 0.8), z1, z1 + 6, fam, t, bbl, true, false, k, false, false, "", 0, ov);
    }
    const d2 = this.deedOf(bbl); d2.height = Math.max(d2.height, z1 + 8);
  }

  /**
   * A BUILDING SITE, BY STAGE. Plywood hoarding round the lot from the first
   * day. Under a fifth of the way: a dug pit with an excavator in it. Past
   * that: a frame rising floor by floor — columns and slabs — with the
   * cladding following two floors behind it, so the top of a rising tower is
   * always open steel and concrete, and the cladding closes the last of it
   * just before delivery. Progress is the job's own (heightM / full height).
   */
  private buildSite(ring: P2[], it: PlayerItem, k: number, cx: number, cy: number) {
    const FL = 3.55;
    const full = Math.max(FL, it.floors * FL);
    const h = Math.max(1, it.heightM);
    const prog = Math.min(1, h / full);
    // the hoarding, 1.5 m outside the footprint
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 2) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const ox = uy * 1.5, oy = -ux * 1.5;      // outward for a counter-clockwise ring
      for (let t = 1.2; t < L; t += 2.44) this.putInst("hoard", a[0] + ux * t + ox, a[1] + uy * t + oy, 0.15, 1, Math.atan2(uy, ux), it.bbl);
    }
    const tri = (z: number, buf: string, col: number[]) => {
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { return; }
      const B = this.buf(buf); const b0 = B.count;
      for (const t of tris) B.tri([ring[t[0]][0], ring[t[0]][1], z], [ring[t[1]][0], ring[t[1]][1], z], [ring[t[2]][0], ring[t[2]][1], z], [0, 0, 1], col);
      this.note(it.bbl, buf, b0);
    };
    if (prog < 0.2) {
      tri(0.05, "trim", [0.62, 0.47, 0.33]);                   // the pit, raw earth
      this.putInst("digger", cx, cy, 0.06, 1, hash01(k, 3) * 6.28, it.bbl);
      return;
    }
    // the clad part, two floors (more early on) behind the frame
    const lag = FL * (prog < 0.5 ? 3 : 2);
    const clad = prog > 0.97 ? h : Math.max(0, h - lag);
    if (clad > FL) this.addVolume(ring, 0, clad, "frame", [1, 1, 1], it.bbl, false, false, k);
    // the open frame above it: a slab every floor, a column every 6 m round the edge
    for (let z = Math.max(FL, Math.ceil(clad / FL) * FL); z <= h + 0.01; z += FL) tri(z, "trim", [0.82, 0.82, 0.8]);
    if (h - clad > 0.5) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.round(L / 6));
        for (let j = 0; j < n; j++) {
          const t = j / n;
          this.putInst("steel", a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, clad, 1, 0, it.bbl, undefined, (h - clad) / 3.55);
        }
      }
    }
  }

  /**
   * THE WORKING HARBOUR. The quay was a grey line on the map. Every ~80 m
   * along it a timber pier now runs out into the water on pilings, boats
   * moored down both sides; on a long quay the pier nearest its middle ends
   * in a ferry terminal with a ferry alongside. Which side is water is read
   * off the land ring. Railings along the seawalls and benches on the
   * promenades are the generator's own (rails, benches), drawn at last.
   */
  private buildWaterfront() {
    const c = this.ctx;
    const landLL = c.land;
    const land = landLL && landLL.length >= 4 ? landLL.map((q) => this.project(q)) : null;
    const onLand = (x: number, y: number) => {
      if (!land) return true;
      let ins = false;
      for (let i = 0, j = land.length - 1; i < land.length; j = i++) { const xi = land[i][0], yi = land[i][1], xj = land[j][0], yj = land[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins; }
      return ins;
    };
    let s = (this.seed * 6007) % 2147483646 + 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const deck = this.buf("pier"); const DZ = 1.1;
    const HULL = [[0.92, 0.92, 0.9], [0.86, 0.85, 0.8], [0.16, 0.22, 0.34], [0.2, 0.32, 0.26], [0.52, 0.2, 0.17], [0.3, 0.3, 0.31]];
    for (const line of c.quays ?? []) {
      const pts = line.map((q) => this.project(q));
      let total = 0; const segs: { a: P2; b: P2; L: number; s0: number }[] = [];
      for (let i = 0; i + 1 < pts.length; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push({ a: pts[i], b: pts[i + 1], L, s0: total }); total += L; }
      const piers: { x: number; y: number; ox: number; oy: number; ux: number; uy: number; d: number }[] = [];
      for (let d = 40; d < total - 30; d += 70 + rnd() * 30) {
        const sg = segs.find((g) => d >= g.s0 && d < g.s0 + g.L);
        if (!sg || sg.L < 1) continue;
        const ux = (sg.b[0] - sg.a[0]) / sg.L, uy = (sg.b[1] - sg.a[1]) / sg.L;
        const t = d - sg.s0, x = sg.a[0] + ux * t, y = sg.a[1] + uy * t;
        // the water side
        let ox = -uy, oy = ux;
        if (onLand(x + ox * 25, y + oy * 25)) { ox = -ox; oy = -oy; }
        if (onLand(x + ox * 25, y + oy * 25)) continue;
        piers.push({ x, y, ox, oy, ux, uy, d });
      }
      const mid = total / 2;
      const term = total > 400 && piers.length ? piers.reduce((p, q) => Math.abs(q.d - mid) < Math.abs(p.d - mid) ? q : p) : null;
      for (const p of piers) {
        const len = 30 + rnd() * 14, w = 7;
        const corner = (along: number, across: number, z: number) => [p.x + p.ox * along + p.ux * across, p.y + p.oy * along + p.uy * across, z];
        const A = corner(0, -w / 2, DZ), B = corner(0, w / 2, DZ), C = corner(len, w / 2, DZ), D = corner(len, -w / 2, DZ);
        const d0 = deck.count;
        // wound whichever way the pier points; the boards run across it
        deck.face([A, B, C, D], [0, 0, 1], [1, 1, 1], (q) => [(q[0] * p.ux + q[1] * p.uy) / 3, (q[0] * p.ox + q[1] * p.oy) / 3]);
        const mx = (A[0] + C[0]) / 2, my = (A[1] + C[1]) / 2;
        for (const [P, Q] of [[B, C], [C, D], [D, A]] as number[][][]) {
          // the fascia faces away from the deck's middle
          const n = [(P[0] + Q[0]) / 2 - mx, (P[1] + Q[1]) / 2 - my, 0];
          deck.face([P, Q, [Q[0], Q[1], DZ - 0.45], [P[0], P[1], DZ - 0.45]], n, [0.75, 0.75, 0.75]);
        }
        void d0;
        for (let a = 2; a < len; a += 4) for (const side of [-1, 1]) {
          const q = corner(a, side * (w / 2 - 0.3), 0);
          this.putInst("pile", q[0], q[1], -1.6, 1, 0);
        }
        // boats along both sides
        for (let a = 6; a < len - 4; a += 9) for (const side of [-1, 1]) {
          if (rnd() < 0.45) continue;
          const q = corner(a, side * (w / 2 + 2.6), 0);
          this.putInst("hull", q[0], q[1], 0.05, 1.2 + rnd() * 0.7, Math.atan2(p.oy, p.ox), "", HULL[(rnd() * HULL.length) | 0]);
        }
        if (p === term) {
          // the ferry terminal at the pier head, and a ferry alongside
          const h0 = corner(len - 2, -6, 0), h1 = corner(len - 2, 6, 0), h2 = corner(len + 9, 6, 0), h3 = corner(len + 9, -6, 0);
          const ring: P2[] = [[h0[0], h0[1]], [h1[0], h1[1]], [h2[0], h2[1]], [h3[0], h3[1]]];
          const ccw = ringArea(ring) > 0 ? ring : ring.slice().reverse();
          this.addVolume(ccw, DZ, DZ + 6.5, "clapboard", [0.9, 0.92, 0.95], "", true, false, keyOf("ferry-terminal"), false, true, "", 1905);
          const f = corner(len + 4, 13, 0);
          this.putInst("ferry", f[0], f[1], 0.05, 1, Math.atan2(p.uy, p.ux));
        }
      }
    }
    // railings and benches, as the generator laid them out
    for (const r of c.rails ?? []) {
      const [x, y] = this.project(r.p);
      this.putInst("railing", x, y, 0.15, 1, (r.r * Math.PI) / 180);
    }
    for (const b of c.benches ?? []) {
      const [x, y] = this.project(b.p);
      this.putInst("bench", x, y, 0.15, 1, (b.r * Math.PI) / 180);
    }
  }

  /** Which of the family's four elevations this deed wears (stable per deed). */
  private variantOf(fk: string, seedK: number): string {
    const n = Math.floor(hash01(seedK ^ 0x7a11, 3) * 4);
    const key = n ? `${fk}#${n}` : fk;
    return this.families[key] ? key : fk;
  }

  /** One volume: walls in its family, a roof, and its trim. */
  private addVolume(ring: P2[], z0: number, z1: number, famKey: string, tint: number[], bbl: string, crown: boolean, plant: boolean, seedK: number, shop = false, pitched = false, cls = "", year = 0, ov?: VolumeOv) {
    const fam = this.families[famKey];
    if (ringArea(ring) < 0) ring = ring.slice().reverse();     // counter-clockwise: outward normals
    // THE MANSARD. A Second Empire walk-up finishes its top storey as a steep
    // slate roof with dormers rather than a wall — the "French flat" of the
    // 1860s-1900s. The walls stop a storey short and the cornice sits there.
    let ringC = [0, 0];
    for (const [x, y] of ring) { ringC[0] += x / ring.length; ringC[1] += y / ring.length; }
    let rad = 0; for (const [x, y] of ring) rad += Math.hypot(x - ringC[0], y - ringC[1]) / ring.length;
    const mans = ov?.roof ? ov.roof === "mansard" && crown && rad > 4 && z1 - z0 > 6
      : crown && plant && !pitched && year > 1855 && year < 1915 && rad > 5
      && (famKey === "brick" || famKey === "buff" || famKey === "brownstone" || famKey === "stone")
      && z1 - z0 > 9 && z1 < 34 && hash01(seedK ^ 0x3a5, 7) < 0.4;
    const zw = mans ? z1 - fam.floorH * 0.95 : z1;            // where the walls stop
    const walls = (fk0: string, za: number, zb: number, vOff: number, tn: number[]) => {
      const fk = fk0 === famKey && ov?.variant ? ov.variant : this.variantOf(fk0, seedK);
      const f = this.families[fk];
      const wallName = "w:" + fk;
      const W = this.buf(wallName);
      const w0 = W.count;
      let uRun = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < 0.05) continue;
        const n = [dy / L, -dx / L, 0];
        // whole bays per run, so every corner falls between two windows
        const bays = Math.max(1, Math.round(L / f.bayW));
        const u0 = uRun, u1 = uRun + bays;
        uRun = u1;
        const v0 = (za - vOff) / f.floorH, v1 = (zb - vOff) / f.floorH;
        W.quad([a[0], a[1], za], [b[0], b[1], za], [b[0], b[1], zb], [a[0], a[1], zb], n,
          [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], tn);
      }
      this.note(bbl, wallName, w0);
    };
    // ---- what hangs on the street front ------------------------------------
    // Fire escapes zig-zag down the old brick walk-ups; balconies stack up
    // the modern apartment slabs. Both on the longest wall, which is the
    // street front far more often than not.
    if (cls === "multifamily" && z0 < 0.5 && plant) {
      let li = 0, ll = -1;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
      const A = ring[li], B = ring[(li + 1) % ring.length];
      const ux = (B[0] - A[0]) / ll, uy = (B[1] - A[1]) / ll, nx = uy, ny = -ux;
      const rot = Math.atan2(uy, ux);
      const f = this.families[famKey];
      const floors = Math.floor((z1 - z0) / f.floorH);
      const roll = (seedK % 1000) / 1000;
      if ((famKey === "brick" || famKey === "buff" || famKey === "brownstone") && z1 > 8 && z1 < 34 && ll > 7 && roll < 0.6) {
        const t = ll * (0.3 + 0.4 * ((seedK >> 3) % 100) / 100);
        for (let fl = 1; fl < floors; fl++) {
          this.putInst("fesc", A[0] + ux * t + nx * 0.6, A[1] + uy * t + ny * 0.6, z0 + fl * f.floorH + 0.05, 1, rot + (fl % 2 ? Math.PI : 0), bbl, undefined, f.floorH / 3.2);
        }
      } else if (famKey === "modern" && z1 < 48 && ll > 9 && roll < 0.65) {
        const bays = Math.max(1, Math.round(ll / f.bayW));
        for (let bi = 1; bi < bays; bi += 2) {
          const t = (bi + 0.5) * (ll / bays);
          for (let fl = 1; fl < floors; fl++) {
            this.putInst("balc", A[0] + ux * t, A[1] + uy * t, z0 + fl * f.floorH, 1, rot, bbl);
          }
        }
      }
    }
    const fh = fam.floorH;
    // A trading ground floor is its own storey: display glass under awnings,
    // the upper floors' windows starting above it.
    const shopH = this.families.shop.floorH;
    if (shop && z0 < 0.5 && zw > shopH + 2.5) {
      walls("shop", z0, shopH, 0, [1, 1, 1]);
      walls(famKey, shopH, zw, shopH, tint);
    } else {
      walls(famKey, z0, zw, 0, tint);
    }

    // roof
    const R = this.buf("roof");
    const r0 = R.count;
    const rc = roofTone(famKey, cls, pitched || mans, seedK);
    // the long side of a four-sided footprint, for the gable, hip and sawtooth
    const longSide = () => {
      let li = 0, ll = -1;
      for (let i = 0; i < 4; i++) { const a = ring[i], b = ring[(i + 1) % 4]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
      return { A: ring[li], B: ring[(li + 1) % 4], C: ring[(li + 2) % 4], D: ring[(li + 3) % 4], ll };
    };
    // a SAWTOOTH: a factory roof of north lights, a pitch of sheet and a
    // vertical strip of glass, repeated down the long side. Rectangles only.
    let saw = false;
    if (!ov?.roof && crown && plant && famKey === "industrial" && ring.length === 4 && z1 < 18 && Math.abs(ringArea(ring)) > 450 && hash01(seedK ^ 0x5a3, 11) < 0.55) {
      const { A, B, C, D, ll } = longSide();
      const ad = [D[0] - A[0], D[1] - A[1]], bc = [C[0] - B[0], C[1] - B[1]];
      saw = Math.hypot(ad[0] - bc[0], ad[1] - bc[1]) < 1.0 && ll > 16;
      if (saw) {
        const ux = (B[0] - A[0]) / ll, uy = (B[1] - A[1]) / ll;
        const P = (t: number, sv: number, z: number) => [A[0] + ux * t + ad[0] * sv, A[1] + uy * t + ad[1] * sv, z];
        const pitch = 7.5, hgt = 2.6;
        const Dk = this.buf("dark"); const d0 = Dk.count;
        for (let t0 = 0; t0 < ll - 0.5; t0 += pitch) {
          const t1 = Math.min(ll, t0 + pitch);
          R.face([P(t0, 0, z1), P(t0, 1, z1), P(t1, 1, z1 + hgt), P(t1, 0, z1 + hgt)], [-ux * 0.5, -uy * 0.5, 1], rc);
          Dk.face([P(t1, 0, z1), P(t1, 1, z1), P(t1, 1, z1 + hgt), P(t1, 0, z1 + hgt)], [ux, uy, 0], [0.8, 0.9, 1.0]);
          R.face([P(t0, 0, z1), P(t1, 0, z1), P(t1, 0, z1 + hgt)], [ad[1], -ad[0], 0], rc);
          R.face([P(t0, 1, z1), P(t1, 1, z1), P(t1, 1, z1 + hgt)], [-ad[1], ad[0], 0], rc);
        }
        this.note(bbl, "dark", d0);
      }
    }
    if (saw) {
      // drawn above
    } else if (mans) {
      // the mansard: steep slate from the cornice to an inset deck, dormers on it
      const k = Math.max(0.55, 1 - 1.4 / rad);
      const inner = ring.map(([x, y]) => [ringC[0] + (x - ringC[0]) * k, ringC[1] + (y - ringC[1]) * k] as P2);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], ai = inner[i], bi = inner[(i + 1) % ring.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.3) continue;
        R.face([[a[0], a[1], zw], [b[0], b[1], zw], [bi[0], bi[1], z1], [ai[0], ai[1], z1]], [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0.35], rc);
        const n = Math.floor(L / 3.4);
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          const ex = a[0] + (b[0] - a[0]) * t, ey = a[1] + (b[1] - a[1]) * t;
          const ix = ai[0] + (bi[0] - ai[0]) * t, iy = ai[1] + (bi[1] - ai[1]) * t;
          this.putInst("dormer", ex + (ix - ex) * 0.45, ey + (iy - ey) * 0.45, zw + 0.35, 1, Math.atan2(b[1] - a[1], b[0] - a[0]), bbl);
        }
      }
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(inner.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { tris = []; }
      for (const t of tris) R.tri([inner[t[0]][0], inner[t[0]][1], z1], [inner[t[1]][0], inner[t[1]][1], z1], [inner[t[2]][0], inner[t[2]][1], z1], [0, 0, 1], rc);
    } else if (pitched && ring.length === 4 && (ov?.roof ? ov.roof === "hip"
      : famKey === "clapboard" ? hash01(seedK ^ 0x41b, 5) < 0.5 : hash01(seedK ^ 0x41b, 5) < 0.3)) {
      // A HIP: the same ridge, pulled in from both ends, every side a slope
      const { A, B, C, D, ll } = longSide();
      const short = Math.min(Math.hypot(C[0] - B[0], C[1] - B[1]), Math.hypot(A[0] - D[0], A[1] - D[1]));
      const rise = Math.min(4.0, short * 0.38);
      const M1 = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2], M2 = [(D[0] + A[0]) / 2, (D[1] + A[1]) / 2];
      const t = Math.min(0.45, (short / 2) / Math.max(ll, 1));
      const H1 = [M1[0] + (M2[0] - M1[0]) * t, M1[1] + (M2[1] - M1[1]) * t, z1 + rise];
      const H2 = [M2[0] + (M1[0] - M2[0]) * t, M2[1] + (M1[1] - M2[1]) * t, z1 + rise];
      R.face([[A[0], A[1], z1], [B[0], B[1], z1], H1, H2], [B[1] - A[1], -(B[0] - A[0]), 0.6], rc);
      R.face([[C[0], C[1], z1], [D[0], D[1], z1], H2, H1], [D[1] - C[1], -(D[0] - C[0]), 0.6], rc);
      R.face([[B[0], B[1], z1], [C[0], C[1], z1], H1], [C[1] - B[1], -(C[0] - B[0]), 0.6], rc);
      R.face([[D[0], D[1], z1], [A[0], A[1], z1], H2], [A[1] - D[1], -(A[0] - D[0]), 0.6], rc);
    } else if (pitched && ring.length === 4) {
      // A GABLE. The ridge runs the long way, a rafter's rise above the eaves;
      // the two gable ends are wall, in the building's own brick.
      let li = 0, ll = -1;
      for (let i = 0; i < 4; i++) { const a = ring[i], b = ring[(i + 1) % 4]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
      const A = ring[li], B = ring[(li + 1) % 4], C = ring[(li + 2) % 4], D = ring[(li + 3) % 4];
      const short = Math.min(Math.hypot(C[0] - B[0], C[1] - B[1]), Math.hypot(A[0] - D[0], A[1] - D[1]));
      const rise = Math.min(4.5, short * 0.42);
      const M1 = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2, z1 + rise], M2 = [(D[0] + A[0]) / 2, (D[1] + A[1]) / 2, z1 + rise];
      const out1 = [B[1] - A[1], -(B[0] - A[0]), 0.6], out2 = [D[1] - C[1], -(D[0] - C[0]), 0.6];
      R.face([[A[0], A[1], z1], [B[0], B[1], z1], M1, M2], out1, rc);
      R.face([[C[0], C[1], z1], [D[0], D[1], z1], M2, M1], out2, rc);
      const vk = ov?.variant ?? this.variantOf(famKey, seedK);
      const Wg = this.buf("w:" + vk);
      const g0 = Wg.count;
      const uvG = (p: number[]) => [(p[0] + p[1]) / fam.bayW * 0.7, p[2] / fam.floorH];
      Wg.face([[B[0], B[1], z1], [C[0], C[1], z1], M1], [C[1] - B[1], -(C[0] - B[0]), 0], tint, uvG);
      Wg.face([[D[0], D[1], z1], [A[0], A[1], z1], M2], [A[1] - D[1], -(A[0] - D[0]), 0], tint, uvG);
      this.note(bbl, "w:" + vk, g0);
    } else {
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { tris = []; }
      for (const t of tris) {
        const p = t.map((i) => [ring[i][0], ring[i][1], z1]);
        R.tri(p[0], p[1], p[2], [0, 0, 1], rc);
      }
    }
    this.note(bbl, "roof", r0);

    // trim: a cornice on masonry crowns, a string course over the shopfronts,
    // a parapet cap and a dark lobby on the curtain walls
    const T = this.buf(fam.glass ? "dark" : "trim");
    const t0 = T.count;
    const band = (z: number, h: number, out: number, col: number[]) => {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < 0.3) continue;
        const nx = dy / L, ny = -dx / L;
        const A = [a[0] + nx * out, a[1] + ny * out], B = [b[0] + nx * out, b[1] + ny * out];
        T.quad([A[0], A[1], z], [B[0], B[1], z], [B[0], B[1], z + h], [A[0], A[1], z + h], [nx, ny, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
        T.quad([a[0], a[1], z + h], [A[0], A[1], z + h], [B[0], B[1], z + h], [b[0], b[1], z + h], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
        T.quad([b[0], b[1], z], [B[0], B[1], z], [A[0], A[1], z], [a[0], a[1], z], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
      }
    };
    // THE TRIM IS PAINTED, AND NOT ALL THE SAME. Stone-coloured on most, but
    // a walk-up's cornice was as often galvanised iron painted dark green,
    // black or a terracotta red; and the cornice itself is deep and bracketed,
    // a modest band, a double course, or long since stripped off.
    const TRIM = [TRIM_PAINTS[0].rgb, ...TRIM_PAINTS.map((p) => p.rgb)];   // stone twice as likely
    const white = ov?.trim !== undefined ? TRIM_PAINTS[ov.trim]?.rgb ?? [1, 1, 1]
      : fam.masonry || famKey === "clapboard" ? TRIM[Math.floor(hash01(seedK ^ 0x71a, 5) * TRIM.length)] : [1, 1, 1];
    const corn = Math.floor(hash01(seedK ^ 0xc0e, 9) * 4);   // 0 standard, 1 deep, 2 stripped, 3 double
    if (fam.masonry) {
      if (crown && zw - z0 > 4 && !pitched) {
        if (corn === 1 || mans) {
          band(zw - 1.1, 0.95, 0.85, white);            // a deep bracketed cornice
          band(zw - 1.45, 0.35, 0.3, white);
        } else if (corn === 2) {
          band(zw - 0.45, 0.4, 0.12, white);            // stripped back to a coping
        } else {
          band(zw - 0.75, 0.6, 0.55, white);            // the cornice
          band(zw - 1.05, 0.3, 0.22, white);            // its bed moulding
          if (corn === 3 && zw - z0 > fh * 3) band(zw - fh - 0.4, 0.3, 0.25, white);   // a second course a floor down
        }
      }
      if (z0 < 0.5 && z1 > fh * 1.6) band(fh + 0.05, 0.28, 0.14, white);   // string course
    } else if (fam.glass) {
      if (crown) band(z1 - 0.5, 0.5, 0.08, white);      // parapet cap
      if (z0 < 0.5 && z1 > 20) band(0, 5.2, 0.35, white); // lobby
    } else if (crown) {
      band(z1 - 0.35, 0.35, 0.12, white);               // coping
    }
    // A FLAT ROOF IS FENCED BY ITS PARAPET: a knee-high wall standing above
    // the deck, its inside face toward the roof so the far side reads from
    // above, and a coping on top. A masonry parapet sits behind its cornice.
    if (crown && !pitched && !mans && !saw && z1 - z0 > 3.5) {
      const ph = fam.masonry ? 1.0 : fam.glass ? 0.5 : 0.75;
      const po = fam.masonry ? 0.18 : 0.1;
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]], zt = z1 + ph;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < 0.3) continue;
        const nx = dy / L, ny = -dx / L;
        const A = [a[0] + nx * po, a[1] + ny * po], B = [b[0] + nx * po, b[1] + ny * po];
        // outside, coping, inside — its underside sits on the wall and is never seen
        T.quad([A[0], A[1], z1], [B[0], B[1], z1], [B[0], B[1], zt], [A[0], A[1], zt], [nx, ny, 0], q, white);
        T.quad([a[0], a[1], zt], [A[0], A[1], zt], [B[0], B[1], zt], [b[0], b[1], zt], [0, 0, 1], q, white);
        T.quad([b[0], b[1], z1], [a[0], a[1], z1], [a[0], a[1], zt], [b[0], b[1], zt], [-nx, -ny, 0], q, [0.82, 0.82, 0.82]);
      }
    }
    this.note(bbl, fam.glass ? "dark" : "trim", t0);

    // ROOF PLANT on the building's top volume, by what the building is. A
    // pre-war walk-up or loft over six storeys needs a wooden water tank on
    // legs — city mains only lift water about that high — beside the stair
    // bulkhead; a modern block carries condensers; a shed, rows of skylights.
    if (plant && crown && !pitched && !mans && !saw) {
      let cx = 0, cy = 0;
      for (const [x, y] of ring) { cx += x; cy += y; }
      cx /= ring.length; cy /= ring.length;
      const area = Math.abs(ringArea(ring));
      let rs = (seedK * 7919) % 2147483646 + 1;
      const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
      const inside = (x: number, y: number) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins; } return ins; };
      // a spot on the deck: from the middle toward a corner, kept a margin in
      const spot = (lo: number, hi: number): P2 | null => {
        for (let k = 0; k < 6; k++) {
          const v = ring[(rnd() * ring.length) | 0], f = lo + rnd() * (hi - lo);
          const x = cx + (v[0] - cx) * f, y = cy + (v[1] - cy) * f;
          if (inside(x, y) && inside(x + 2, y) && inside(x - 2, y) && inside(x, y + 2) && inside(x, y - 2)) return [x, y];
        }
        return null;
      };
      const rot = (seedK % 360) * Math.PI / 180;
      const oldWalk = famKey === "brick" || famKey === "buff" || famKey === "brownstone" || famKey === "industrial" || famKey === "stone" || famKey === "decobrick";
      if (area > 160 && rnd() < 0.7) { const q = spot(0, 0.3); if (q) this.putInst("bulk", q[0], q[1], z1, 1, rot, bbl); }
      if (oldWalk && z1 > 17 && z1 < 95 && area > 120 && rnd() < 0.62) {
        const n = area > 900 && rnd() < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) { const q = spot(0.45, 0.75); if (q) this.putInst("tank", q[0], q[1], z1, 0.9 + rnd() * 0.3, rnd() * 6.28, bbl); }
      }
      if ((famKey === "glass" || famKey === "bronze" || famKey === "blueglass" || famKey === "ribbon" || famKey === "grid" || famKey === "modern" || famKey === "plain" || cls === "retail") && area > 200) {
        const n = Math.min(7, 1 + Math.floor(area / 650));
        for (let i = 0; i < n; i++) { const q = spot(0.15, 0.7); if (q) this.putInst("hvac", q[0], q[1], z1, 0.8 + rnd() * 0.4, rot + (rnd() < 0.5 ? 0 : Math.PI / 2), bbl); }
      }
      if ((famKey === "industrial" || famKey === "plain") && z1 < 20 && area > 500) {
        // skylights in rows along the long side
        let li = 0, ll = -1;
        for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
        const A = ring[li], B = ring[(li + 1) % ring.length];
        const ux = (B[0] - A[0]) / ll, uy = (B[1] - A[1]) / ll;
        const ang = Math.atan2(uy, ux);
        let made = 0;
        for (let row = 4; row < 80 && made < 60; row += 7) for (let t = 4; t < ll - 4 && made < 60; t += 6) {
          const x = A[0] + ux * t - uy * row, y = A[1] + uy * t + ux * row;
          if (!inside(x, y) || !inside(x + ux * 2.5, y + uy * 2.5) || !inside(x - ux * 2.5, y - uy * 2.5)) continue;
          this.putInst("skyl", x, y, z1, 1, ang, bbl); made++;
        }
      }
    }
  }

  private instItems = new Map<string, { x: number; y: number; z: number; s: number; r: number; bbl: string; col?: number[]; sz?: number }[]>();
  private putInst(kind: string, x: number, y: number, z: number, s: number, r: number, bbl = "", col?: number[], sz?: number) {
    let l = this.instItems.get(kind);
    if (!l) { l = []; this.instItems.set(kind, l); }
    l.push({ x, y, z, s, r, bbl, col, sz });
  }

  private buildCity() {
    // the top volume per deed takes the cornice and the plant
    const topZ = new Map<string, number>();
    for (const v of this.volumes) if (v.b && !v.k) topZ.set(v.b, Math.max(topZ.get(v.b) ?? 0, v.z1));
    // VACANT LOTS. Downtown a hole in the street wall is a surface car park;
    // elsewhere it is a gravel yard. Residential lots stay as MapLibre's lawn.
    const lotPark = new Buf(), lotGravel = new Buf(), lotMeadow = new Buf(), lotCrop = new Buf();
    let ls = (this.seed * 4421) % 2147483646 + 1;
    const lrnd = () => (ls = (ls * 16807) % 2147483647) / 2147483647;
    const CARC = [[0.9, 0.9, 0.89], [0.62, 0.64, 0.67], [0.16, 0.18, 0.21], [0.16, 0.26, 0.45], [0.58, 0.16, 0.14], [0.36, 0.40, 0.34]];
    for (const v of this.volumes) {
      // a residential lot in town stays MapLibre's lawn; out on the fringe it is country like the rest
      if (!v.k || (v.zn === 1 && (v.ds ?? 50) < 62 && (v.ds ?? 50) >= 38)) continue;
      let ring = v.r.map((p) => this.project(p));
      if (ring.length < 3) continue;
      if (ringArea(ring) < 0) ring = ring.slice().reverse();
      // THREE KINDS OF EMPTY. Downtown a hole in the street wall is a surface
      // car park; in the working middle a gravel yard; out past where the town
      // has reached, land nobody has built on yet is rough grass.
      const downtown = (v.ds ?? 50) >= 62;
      const outskirts = (v.ds ?? 50) < 38;   // the classic map's fringe line
      // THE COUNTRY PAST THE TOWN. Out on the fringe an empty lot is not a
      // lawn: it is a market garden in rows, a hedged pasture, or a fenced
      // scrub lot, and the bigger holdings carry a farmhouse and a barn and a
      // track in from the road. All of it hangs on the lot's deed, so it is
      // cleared the day somebody builds there.
      const kk = keyOf(v.b || `${v.r[0][0]},${v.r[0][1]}`);
      const roll = hash01(kk ^ 0xfa12, this.seed);
      const farmKind = !outskirts ? "" : roll < 0.35 ? "crop" : roll < 0.75 ? "pasture" : "scrub";
      const B = downtown ? lotPark : farmKind === "crop" ? lotCrop : outskirts ? lotMeadow : lotGravel;
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { continue; }
      // crops run in rows along the lot's long side
      let ld = [1, 0];
      {
        let ll = -1;
        for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; ld = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } }
      }
      for (const t of tris) {
        for (const i of t) {
          const [x, y] = ring[i];
          const uv = farmKind === "crop" ? [(x * ld[0] + y * ld[1]) / 16, (-x * ld[1] + y * ld[0]) / 3.2] : [x / 5, y / 5];
          B.pos.push(x, y, 0.03); B.nrm.push(0, 0, 1); B.uv.push(uv[0], uv[1]); B.col.push(1, 1, 1);
        }
      }
      if (farmKind) this.dressFarm(ring, farmKind, kk, v.b || "", lotGravel);
      if (downtown) {
        // rows of parked cars squared to the longest side
        let li = 0, ll = -1;
        for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
        const a = ring[li], b = ring[(li + 1) % ring.length];
        const ux = (b[0] - a[0]) / ll, uy = (b[1] - a[1]) / ll, nx = -uy, ny = ux;
        const inP = (x: number, y: number) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins; } return ins; };
        for (let row = 3.5; row < 60; row += 6.2) for (let t = 2; t < ll - 2; t += 2.6) {
          const x = a[0] + ux * t + nx * row, y = a[1] + uy * t + ny * row;
          if (!inP(x, y) || !inP(x + nx * 2.4, y + ny * 2.4) || !inP(x - nx * 2.4, y - ny * 2.4) || lrnd() < 0.3) continue;
          this.putInst("lotcar", x, y, 0.04, 1, Math.atan2(uy, ux) + Math.PI / 2, "", CARC[(lrnd() * CARC.length) | 0]);
        }
      }
    }
    if (lotPark.count) {
      const m = new THREE.Mesh(lotPark.geometry(), new THREE.MeshStandardMaterial({ map: this.parkingTex(), roughness: 0.9, envMapIntensity: 0.2 }));
      m.receiveShadow = true; this.scene.add(m);
    }
    if (lotMeadow.count) {
      const m = new THREE.Mesh(lotMeadow.geometry(), this.meadowMat);
      this.meadowMat.map = this.meadowTex();
      m.receiveShadow = true; this.scene.add(m);
    }
    if (lotCrop.count) {
      this.cropMat.map = this.cropTex();
      const m = new THREE.Mesh(lotCrop.geometry(), this.cropMat);
      m.receiveShadow = true; this.scene.add(m);
    }
    if (lotGravel.count) {
      const m = new THREE.Mesh(lotGravel.geometry(), new THREE.MeshStandardMaterial({ map: this.gravelTex(), roughness: 1, envMapIntensity: 0.15 }));
      m.receiveShadow = true; this.scene.add(m);
    }
    for (const v of this.volumes) {
      if (v.k) continue;                                   // vacant lots: dressed above
      const ring = v.r.map((p) => this.project(p));
      if (ring.length < 3) continue;
      const k = keyOf(v.b || `${v.r[0][0]},${v.r[0][1]}`);
      if (v.d) {
        // ships, cranes and sheds: plain painted steel
        this.addVolume(ring, v.z0, v.z1, "plain", [1, 1, 1], "", true, false, k);
        continue;
      }
      const top = topZ.get(v.b) ?? v.z1;
      const fam = familyFor(v.c, v.y || 1950, top, hash01(k ^ 0x3c1f, this.seed));
      const tints = TINTS[fam];
      const t = tints[Math.floor(hash01(k, this.seed) * tints.length)];
      const shop = v.c === "retail" || (fam === "brick" && hash01(k ^ 0x51ab, this.seed) < 0.5)
        || (fam === "stone" && hash01(k ^ 0x51ab, this.seed) < 0.3) || (fam === "modern" && v.c !== "industrial" && hash01(k ^ 0x51ab, this.seed) < 0.35);
      // old low brick houses keep a pitched roof: a row of 1890s three-storey
      // walk-ups is a run of gables, not a run of flat decks
      const isTop = v.z1 >= top - 0.01 || v.x === 1;
      const pitched = isTop && (fam === "brick" || fam === "clapboard") && (v.y || 1950) < 1950 && v.z1 <= 16 && v.r.length === 4
        && Math.abs(ringArea(ring)) < 450 && hash01(k ^ 0x9177, this.seed) < 0.8;
      // THE WEDDING CAKE. Under the 1916 zoning resolution a tower could rise
      // straight only so far before it had to step back from the street, and
      // the pre-war skyline is those setbacks: a full-lot base, one or two
      // terraces, a slimmer shaft. Three in four of the pre-war masonry
      // towers step back; the tiers keep the volume's own height and wear
      // cornices on their terraces.
      const preWarTower = isTop && v.z0 < 0.5 && top > 70 && (v.y || 1950) < 1946
        && (fam === "deco" || fam === "decobrick" || fam === "stone") && hash01(k ^ 0x1916, this.seed) < 0.75;
      let topRing = ring;
      if (preWarTower) {
        let cx = 0, cy = 0;
        for (const [x, y] of ring) { cx += x; cy += y; }
        cx /= ring.length; cy /= ring.length;
        const at = (f: number) => ring.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as P2);
        const h1 = v.z1 * (0.5 + 0.15 * hash01(k ^ 0x51, this.seed)), h2 = v.z1 * 0.82;
        this.addVolume(ring, v.z0, h1, fam, t, v.b, true, false, k, shop, false, v.c);
        this.addVolume(at(0.84), h1, h2, fam, t, v.b, true, false, k);
        topRing = at(0.68);
        this.addVolume(topRing, h2, v.z1, fam, t, v.b, true, true, k);
      } else {
        this.addVolume(ring, v.z0, v.z1, fam, t, v.b, isTop, true, k, shop, pitched, v.c, v.y || 0);
      }
      // A TOWER ENDS IN SOMETHING. A deco tower steps back twice and finishes
      // in a spire; a glass tower carries a recessed mechanical crown and a
      // mast; a stone office takes one setback. Only on the building's own top.
      if (isTop) this.towerTop(topRing.length ? topRing : ring, v.z1, top, fam, t, v.b, k, "auto");
      const d = this.deedOf(v.b);
      d.height = Math.max(d.height, v.z1);
      if (!d.ring) d.ring = ring;
    }
    this.buildWaterfront();
    this.flushBufs();
    this.flushInst();
    // a shadow catcher over MapLibre's ground: transparent except where a
    // building or a tree stands between it and the sun
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), this.catcherMat);
    catcher.position.z = 0.04; catcher.receiveShadow = true; catcher.renderOrder = -1;
    catcher.visible = this.quality !== "low";
    this.catcher = catcher;
    this.scene.add(catcher);
    // THE HARBOUR CATCHES THE LIGHT. MapLibre paints the water flat; a thin
    // glossy veneer over it — the land cut out — gives the sun a road on the
    // sea and the sky something to reflect in, and leaves the shoal colours
    // underneath showing through.
    const landLL = (this.ctx as { land?: P2[] }).land;
    if (landLL && landLL.length >= 4) {
      const land = landLL.map((q) => this.project(q));
      const outer = new THREE.Shape([new THREE.Vector2(-30000, -30000), new THREE.Vector2(30000, -30000), new THREE.Vector2(30000, 30000), new THREE.Vector2(-30000, 30000)]);
      const holePts = (ringArea(land) > 0 ? land.slice().reverse() : land).map(([x, y]) => new THREE.Vector2(x, y));
      outer.holes.push(new THREE.Path(holePts));
      const sea = new THREE.Mesh(new THREE.ShapeGeometry(outer), new THREE.MeshStandardMaterial({
        color: 0x14425e, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.4, envMapIntensity: 1.5, depthWrite: false,
        normalMap: this.waveTex(1), normalScale: new THREE.Vector2(0.7, 0.7), envMap: this.skyEnv,
      }));
      sea.position.z = 0.02; sea.receiveShadow = true; sea.renderOrder = -3;
      this.scene.add(sea);
      // the park ponds take the same glossy, rippled skin
      const ponds = (this.ctx as { ponds?: P2[][] }).ponds ?? [];
      const shapes: THREE.Shape[] = [];
      for (const pr of ponds) {
        const r = pr.map((q) => this.project(q));
        if (r.length >= 3) shapes.push(new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, y))));
      }
      if (shapes.length) {
        const pm = new THREE.Mesh(new THREE.ShapeGeometry(shapes), sea.material);
        pm.position.z = 0.025; pm.receiveShadow = true; pm.renderOrder = -3;
        this.scene.add(pm);
      }
    }
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), this.veil);
    veil.position.z = 0.03; veil.renderOrder = -2;
    this.scene.add(veil);
  }

  private flushBufs() {
    for (const [name, b] of this.bufs) {
      if (!b.count) continue;
      const mat = name.startsWith("w:") ? this.families[name.slice(2)].mat
        : name === "roof" ? this.roofMat : name === "dark" ? this.darkMat : name === "pier" ? this.pierMat() : this.trimMat;
      const old = this.meshes.get(name);
      if (old) { this.scene.remove(old); old.geometry.dispose(); }
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.scene.add(mesh); this.meshes.set(name, mesh);
    }
    this.bindRanges(this.deeds, this.meshes);
  }

  /** Point each deed's ranges at the mesh they live in, and keep their base colours so state tints can be undone. */
  private bindRanges(deeds: Map<string, Deed>, meshes: Map<string, THREE.Mesh>) {
    for (const [, d] of deeds) {
      for (const r of d.ranges) {
        r.mesh = meshes.get(r.buf);
        if (!r.mesh) continue;
        const col = r.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
        r.base = Array.from((col.array as Float32Array).slice(r.start * 3, (r.start + r.count) * 3));
      }
    }
  }

  private geomFor(kind: string): { g: THREE.BufferGeometry; mat: THREE.Material; colored?: boolean } {
    const merge = (parts: THREE.BufferGeometry[]) => {
      const pos: number[] = [], nrm: number[] = [];
      for (const p of parts) {
        const q = p.index ? p.toNonIndexed() : p;
        pos.push(...(q.getAttribute("position").array as Float32Array));
        nrm.push(...(q.getAttribute("normal").array as Float32Array));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      return g;
    };
    const box = (w: number, d: number, h: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, d, h).translate(x, y, z + h / 2);
    const cyl = (r: number, h: number, z = 0, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2).translate(0, 0, z + h / 2);
    switch (kind) {
      case "bulk": return { g: merge([box(3.2, 4.2, 2.8), box(3.6, 4.6, 0.25, 0, 0, 2.8)]), mat: new THREE.MeshStandardMaterial({ color: 0x9a9284, roughness: 0.85 }) };
      case "pile": return { g: merge([cyl(0.28, 2.8, 0, 8)]), mat: new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 0.95 }) };
      case "railing": return { g: merge([box(0.08, 0.08, 1.05, -1.6, 0, 0), box(3.3, 0.06, 0.06, 0, 0, 1.0), box(3.3, 0.04, 0.04, 0, 0, 0.55)]), mat: new THREE.MeshStandardMaterial({ color: 0x2c3236, roughness: 0.5, metalness: 0.6 }) };
      case "bench": return { g: merge([box(1.8, 0.5, 0.08, 0, 0, 0.42), box(1.8, 0.06, 0.45, 0, 0.24, 0.5), box(0.08, 0.45, 0.42, -0.8, 0, 0), box(0.08, 0.45, 0.42, 0.8, 0, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 }) };
      case "steel": return { g: merge([box(0.45, 0.45, 3.55, 0, 0, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.6, metalness: 0.3 }) };
      case "hoard": return { g: merge([box(2.42, 0.06, 2.4, 0, 0, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.9 }) };
      case "digger": {
        // an excavator: tracks, cab, boom
        const g = merge([box(3.2, 2.6, 0.9, 0, 0, 0), box(2.2, 2.2, 1.6, 0, 0, 0.9), box(3.6, 0.5, 0.5, 2.4, 0, 2.2), box(0.5, 0.5, 2.2, 4.0, 0, 0.3)]);
        return { g, mat: new THREE.MeshStandardMaterial({ color: 0xe0a21a, roughness: 0.6 }) };
      }
      case "pine": {
        // a conifer: a short trunk and three tiers of needles
        const cone = (r: number, h: number, z: number) => new THREE.ConeGeometry(r, h, 8).rotateX(Math.PI / 2).translate(0, 0, z + h / 2);
        return { g: merge([cyl(0.22, 1.6, 0, 6), cone(2.3, 3.4, 1.4), cone(1.8, 3.0, 3.3), cone(1.15, 2.6, 5.1)]), mat: this.pineMat };
      }
      case "parkhedge": return { g: merge([box(2.6, 0.8, 0.85, 0, 0, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0x46663a, roughness: 0.95 }) };
      case "flowerbed": {
        const g = new THREE.CylinderGeometry(1.7, 1.8, 0.3, 12).rotateX(Math.PI / 2).translate(0, 0, 0.15);
        return { g: merge([g]), mat: this.bedMat, colored: true };
      }
      case "hedge": return { g: merge([box(2.7, 1.1, 1.3, 0, 0, 0), box(2.3, 0.8, 0.35, 0, 0, 1.3)]), mat: new THREE.MeshStandardMaterial({ color: 0x3f5a32, roughness: 0.95, flatShading: true }) };
      case "fence": return { g: merge([box(0.14, 0.14, 1.25, -1.45, 0, 0), box(3.0, 0.07, 0.1, 0, 0, 0.55), box(3.0, 0.07, 0.1, 0, 0, 1.05)]), mat: new THREE.MeshStandardMaterial({ color: 0x8c7a62, roughness: 0.9 }) };
      case "dormer": {
        // a slate-cheeked dormer: a small box with its own little gable
        const g = merge([box(1.3, 0.9, 1.5, 0, 0, 0), new THREE.ConeGeometry(0.95, 0.7, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, 1.85)]);
        return { g, mat: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.8 }) };
      }
      case "skyl": return { g: merge([box(4.2, 1.6, 0.25), new THREE.BoxGeometry(3.9, 1.3, 0.5).translate(0, 0, 0.45)]), mat: new THREE.MeshStandardMaterial({ color: 0x5d6d78, metalness: 0.3, roughness: 0.25, envMapIntensity: 1.1 }) };
      case "tank": return { g: merge([cyl(1.5, 2.6, 2.4, 12), new THREE.ConeGeometry(1.6, 0.9, 12).rotateX(Math.PI / 2).translate(0, 0, 5.4), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => box(0.18, 0.18, 2.4, a * 1.1, b * 1.1))]), mat: new THREE.MeshStandardMaterial({ color: 0x6f5a45, roughness: 0.9 }) };
      case "hvac": return { g: merge([box(4.5, 2.4, 1.6), cyl(0.7, 0.3, 1.6), cyl(0.7, 0.3, 1.6).translate(1.4, 0, 0), cyl(0.7, 0.3, 1.6).translate(-1.4, 0, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xa9adaf, metalness: 0.5, roughness: 0.45 }) };
      case "trunk": return { g: merge([cyl(0.22, 3.2, 0, 6)]), mat: this.barkMat };
      case "crown": {
        // two lumps at one subdivision: 160 triangles a tree, which is the
        // budget a city of twenty thousand of them can afford
        // Shaded as soft lumps, not facets: each vertex's normal leans out from
        // its lump's centre, and the foliage darkens toward the underside where
        // the canopy shades itself — what turns crumpled paper into a tree.
        const pos: number[] = [], nrm: number[] = [], col: number[] = [];
        for (const [r, det, cx, cy, cz] of [[2.4, 1, 0, 0, 4.7], [1.8, 1, 0.9, 0.6, 5.8], [1.6, 0, -0.9, -0.6, 5.2], [1.4, 0, 0.2, -1.1, 4.4]] as number[][]) {
          const g = new THREE.IcosahedronGeometry(r, det);   // already one vertex per corner
          const P = g.getAttribute("position").array as Float32Array;
          for (let i = 0; i < P.length; i += 3) {
            // a little lumpiness so no two vertices sit on one perfect sphere
            const w = 1 + 0.12 * Math.sin(P[i] * 3.1 + P[i + 1] * 2.3 + P[i + 2] * 1.7);
            const x = P[i] * w, y = P[i + 1] * w, z = P[i + 2] * w;
            const l = Math.hypot(x, y, z) || 1;
            pos.push(x + cx, y + cy, z + cz);
            nrm.push(x / l, y / l, z / l);
            const up = Math.max(0, Math.min(1, (z / r + 1) / 2));   // 0 underneath, 1 on top
            const k = 0.5 + 0.5 * up;
            col.push(k, k, k * 0.96);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        return { g, mat: this.leafMat, colored: true };
      }
      case "lotcar":
      case "car": {
        const body = box(4.35, 1.78, 0.78, 0, 0, 0.22);
        const cab = box(2.2, 1.62, 0.62, -0.2, 0, 1.0);
        return { g: merge([body, cab]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.32 }), colored: true };
      }
      case "lamp": return { g: merge([cyl(0.09, 6, 0, 6), box(1.4, 0.18, 0.14, 0.6, 0, 5.9)]), mat: this.lampMat };
      case "person": return { g: merge([box(0.42, 0.3, 0.95, 0, 0, 0), box(0.46, 0.34, 0.6, 0, 0, 0.9), new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0, 1.68)]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), colored: true };
      case "fountain": return { g: merge([cyl(5.2, 0.55, 0, 24), cyl(1.1, 1.6, 0.55, 12), cyl(2.4, 0.3, 2.1, 16), cyl(0.5, 1.1, 2.4, 10)]), mat: new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.7 }) };
      case "basin": return { g: merge([cyl(4.6, 0.08, 0.5, 24), cyl(2.1, 0.06, 2.38, 16)]), mat: new THREE.MeshStandardMaterial({ color: 0x3b6f82, roughness: 0.08, metalness: 0.1, envMapIntensity: 1.3 }) };
      case "column": return { g: merge([box(7, 7, 1.2), box(4.4, 4.4, 2.4, 0, 0, 1.2), cyl(0.95, 14, 3.6, 16), box(2.4, 2.4, 0.8, 0, 0, 17.6), cyl(0.5, 2.2, 18.4, 10)]), mat: new THREE.MeshStandardMaterial({ color: 0xbdb5a5, roughness: 0.65 }) };
      case "hull": return { g: merge([box(5.0, 1.9, 0.6, -0.3, 0, -0.25), box(1.3, 1.25, 0.55, 2.75, 0, -0.2), box(1.7, 1.35, 0.85, -0.9, 0, 0.35)]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), colored: true };
      case "ferry": return { g: merge([box(16, 5, 1.6, 0, 0, -0.6), box(4, 3.6, 1.4, 6.8, 0, -0.5), box(9, 4.2, 2.4, -1, 0, 1.0), box(6, 3.6, 1.6, -1.5, 0, 3.4), box(1.2, 1.2, 2.2, -3.5, 0, 5.0)]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), colored: true };
      case "spire": return { g: merge([box(3.0, 3.0, 4.0), box(1.8, 1.8, 4.0, 0, 0, 4.0), new THREE.ConeGeometry(0.9, 12, 8).rotateX(Math.PI / 2).translate(0, 0, 14)]),
        mat: new THREE.MeshStandardMaterial({ color: 0xbfc4c6, roughness: 0.3, metalness: 0.8 }) };
      case "mast": return { g: merge([cyl(0.35, 18, 0, 8), cyl(0.12, 10, 18, 6)]), mat: new THREE.MeshStandardMaterial({ color: 0x9a9fa3, roughness: 0.4, metalness: 0.7 }) };
      case "fesc": {
        // one flight of a fire escape: a grated landing, its railing, and the
        // stair down to the landing below (local x along the wall, +y out)
        const stair = new THREE.BoxGeometry(3.6, 0.7, 0.08).rotateY(-Math.atan2(3.2, 3.0)).translate(0, 0.45, -1.6);
        return { g: merge([box(3.4, 1.0, 0.08, 0, 0.5, 0), box(3.4, 0.05, 0.9, 0, 1.0, 0.08), box(0.05, 1.0, 0.9, -1.7, 0.5, 0.08), box(0.05, 1.0, 0.9, 1.7, 0.5, 0.08), stair]),
          mat: new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.6, metalness: 0.5 }) };
      }
      case "balc": return { g: merge([box(2.2, 1.3, 0.16, 0, 0.65, 0), box(2.2, 0.04, 1.0, 0, 1.28, 0.16), box(0.04, 1.3, 1.0, -1.1, 0.65, 0.16), box(0.04, 1.3, 1.0, 1.1, 0.65, 0.16)]),
        mat: new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.6, metalness: 0.1 }) };
      case "crane": {
        // a tower crane: lattice mast as a slim box, slewing jib and counter-jib, cab and counterweight
        const H = 46;
        return { g: merge([box(1.6, 1.6, H), box(26, 1.0, 1.0, 9, 0, H), box(10, 1.0, 1.0, -7, 0, H), box(3.2, 1.8, 2.0, -10, 0, H - 2.0), box(1.8, 1.8, 2.2, 0.8, 0, H - 2.4), box(0.9, 0.9, 4, 0, 0, H + 1)]),
          mat: new THREE.MeshStandardMaterial({ color: 0xd9a821, roughness: 0.55, metalness: 0.3 }) };
      }
      default: return { g: box(1, 1, 1), mat: this.trimMat };
    }
  }

  private flushInst() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [kind, items] of this.instItems) {
      if (!items.length) continue;
      const old = this.inst.get(kind);
      if (old) { this.scene.remove(old); old.dispose(); }
      const { g, mat, colored } = this.geomFor(kind);
      const mesh = new THREE.InstancedMesh(g, mat, items.length);
      items.forEach((it, i) => {
        q.setFromEuler(e.set(0, 0, it.r));
        mesh.setMatrixAt(i, m4.compose(p.set(it.x, it.y, it.z), q, sc.set(it.s, it.s, it.s * (it.sz ?? 1))));
        if (colored) mesh.setColorAt(i, new THREE.Color(...(it.col ?? [1, 1, 1]) as [number, number, number]));
        if (it.bbl) this.deedOf(it.bbl).inst.push({ mesh: kind, i });
      });
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh); this.inst.set(kind, mesh);
    }
    this.instItems.clear();
  }

  // ---- the ground: raised footways, kerbs, zebra crossings ----------------
  // MapLibre still paints the asphalt and the yards. On top of it the
  // footway is a real slab fifteen centimetres up, paved in flags, with a
  // granite kerb face along the street edge, and every gridded corner gets
  // painted zebra bars standing on the carriageway.
  private buildGround() {
    const c = this.ctx as {
      sidewalks?: { ring: P2[]; holes: P2[][] }[]; kerbs?: P2[][]; zebras?: P2[][];
    };
    const H = 0.15;
    const pave = new Buf(), kerb = new Buf();
    const white = [1, 1, 1];
    for (const sw of c.sidewalks ?? []) {
      const ring = sw.ring.map((q) => this.project(q));
      const holes = sw.holes.map((h) => h.map((q) => this.project(q)));
      if (ring.length < 3) continue;
      let tris: number[][] = [];
      try {
        tris = THREE.ShapeUtils.triangulateShape(
          ring.map(([x, y]) => new THREE.Vector2(x, y)),
          holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))),
        );
      } catch { continue; }
      const all = [...ring, ...holes.flat()];
      for (const t of tris) {
        const p = t.map((i) => [all[i][0], all[i][1], H]);
        // wound upward whichever way earcut returned it
        const cr = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
        const q = cr >= 0 ? p : [p[0], p[2], p[1]];
        for (const v of q) { pave.pos.push(v[0], v[1], v[2]); pave.nrm.push(0, 0, 1); pave.uv.push(v[0] / 1.5, v[1] / 1.5); pave.col.push(1, 1, 1); }
      }
    }
    // EVERY PARK HAS AN EDGE. Blocks stand on raised footways with a kerb; a
    // park's lawn met the frontage road with nothing between them, a green
    // field pasted on the asphalt. The same 15 cm footway, 2.6 m wide, runs
    // round the inside of every park outline, with its kerb on the road side.
    const parkKerbs: P2[][] = [];
    for (const pk of (this.ctx.parks ?? []) as ({ ring: P2[] } | P2[])[]) {
      const ringLL = Array.isArray(pk) ? pk : pk.ring;
      if (!ringLL || ringLL.length < 3) continue;
      let ring = ringLL.map((q) => this.project(q));
      if (ringArea(ring) < 0) ring = ring.slice().reverse();
      if (Math.abs(ringArea(ring)) < 120) continue;
      const inner = insetRing(ring, 2.6);
      if (!inner) continue;
      let tris: number[][] = [];
      try {
        tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), [inner.map(([x, y]) => new THREE.Vector2(x, y))]);
      } catch { continue; }
      const all = [...ring, ...inner];
      for (const t of tris) {
        const p = t.map((i) => [all[i][0], all[i][1], H]);
        const cr = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
        const q = cr >= 0 ? p : [p[0], p[2], p[1]];
        for (const v of q) { pave.pos.push(v[0], v[1], v[2]); pave.nrm.push(0, 0, 1); pave.uv.push(v[0] / 1.5, v[1] / 1.5); pave.col.push(1, 1, 1); }
      }
      parkKerbs.push([...ring, ring[0]]);
    }
    for (const pts of parkKerbs) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.05) continue;
        const n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0];
        kerb.quad([a[0], a[1], -0.02], [b[0], b[1], -0.02], [b[0], b[1], H + 0.005], [a[0], a[1], H + 0.005], n, [[0, 0], [L, 0], [L, 1], [0, 1]], white);
      }
    }
    for (const line of c.kerbs ?? []) {
      const pts = line.map((q) => this.project(q));
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.05) continue;
        const n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0];
        kerb.quad([a[0], a[1], -0.02], [b[0], b[1], -0.02], [b[0], b[1], H + 0.005], [a[0], a[1], H + 0.005], n, [[0, 0], [L, 0], [L, 1], [0, 1]], white);
      }
    }
    if (pave.count) {
      this.paveMat = new THREE.MeshStandardMaterial({ map: this.pavingTex(), roughness: 0.86, envMapIntensity: 0.25 });
      const m = new THREE.Mesh(pave.geometry(), this.paveMat);
      m.receiveShadow = true;
      this.scene.add(m);
    }
    if (kerb.count) {
      const m = new THREE.Mesh(kerb.geometry(), new THREE.MeshStandardMaterial({ color: 0x9a968f, roughness: 0.75, side: THREE.DoubleSide, envMapIntensity: 0.25 }));
      m.receiveShadow = true;
      this.scene.add(m);
    }
    // zebras: bars 0.5 m wide every 1.1 m along the crossing, each 3 m long
    // in the direction the traffic runs
    const bars: { x: number; y: number; r: number }[] = [];
    for (const line of c.zebras ?? []) {
      if (line.length < 2) continue;
      const A = this.project(line[0]), B = this.project(line[line.length - 1]);
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 1.5) continue;
      const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
      const r = Math.atan2(uy, ux);
      for (let t = 0.45; t < L - 0.2; t += 1.1) bars.push({ x: A[0] + ux * t, y: A[1] + uy * t, r });
    }
    if (bars.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 3.0, 0.02), new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.55 }), bars.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      bars.forEach((b, i) => { q.setFromEuler(e.set(0, 0, b.r)); mesh.setMatrixAt(i, m4.compose(new THREE.Vector3(b.x, b.y, 0.035), q, new THREE.Vector3(1, 1, 1))); });
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  /** Asphalt with white bay lines every 2.6 m (5 m tile). */
  private parkingTex(): THREE.CanvasTexture {
    const { c, g } = makeCanvas(128, 128);
    let s = 17; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = "#45474b"; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1500; i++) { const v = 55 + rnd() * 35 | 0; g.fillStyle = `rgba(${v},${v},${v + 3},0.5)`; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
    g.fillStyle = "rgba(230,228,220,0.75)"; g.fillRect(0, 0, 3, 64);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  /** Patchy gravel with weeds coming through. */
  private gravelTex(): THREE.CanvasTexture {
    const { c, g } = makeCanvas(128, 128);
    let s = 29; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = "#8f8676"; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2500; i++) { const v = 110 + rnd() * 60 | 0; g.fillStyle = `rgba(${v},${v - 6},${v - 18},0.6)`; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${90 + rnd() * 30 | 0},${110 + rnd() * 30 | 0},${60},0.45)`; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 3 + rnd() * 8, 0, 6.28); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  /** Hedges or fences round a fringe lot, and on the big ones a farmhouse, a barn and a track. */
  private dressFarm(ring: P2[], kind: string, k: number, bbl: string, track: Buf) {
    let rs = (k * 2246822519) % 2147483646 + 1;
    const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
    const area = Math.abs(ringArea(ring));
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length; cy /= ring.length;
    // the boundary: a hedgerow round pasture and gardens, a post-and-rail
    // fence round the scrub lots, gaps where the gate is
    const item = kind === "scrub" ? "fence" : "hedge";
    const step = item === "hedge" ? 2.5 : 3;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 4) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const nx = -uy, ny = ux;   // inward for a counter-clockwise ring
      const gate = rnd() * L;
      for (let t = step / 2; t < L - step / 2; t += step) {
        if (Math.abs(t - gate) < 3.5 || rnd() < (item === "hedge" ? 0.08 : 0.04)) continue;
        this.putInst(item, a[0] + ux * t + nx * 0.9, a[1] + uy * t + ny * 0.9, 0.03, item === "hedge" ? 0.85 + rnd() * 0.35 : 1, Math.atan2(uy, ux), bbl);
      }
    }
    if (kind === "scrub" || area < 1200 || hash01(k ^ 0xba12, this.seed) > 0.6) return;
    // a farmstead near the road side: the house facing the street, the barn behind
    let li = 0, ll = -1;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
    const A = ring[li], Bp = ring[(li + 1) % ring.length];
    const ux = (Bp[0] - A[0]) / ll, uy = (Bp[1] - A[1]) / ll, nx = -uy, ny = ux;
    const inside = (x: number, y: number) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins; } return ins; };
    const rect = (t: number, d: number, w: number, h: number): P2[] => {
      const ox = A[0] + ux * t + nx * d, oy = A[1] + uy * t + ny * d;
      return [[ox, oy], [ox + ux * w, oy + uy * w], [ox + ux * w + nx * h, oy + uy * w + ny * h], [ox + nx * h, oy + ny * h]];
    };
    const fits = (r: P2[]) => r.every(([x, y]) => inside(x, y));
    const t0 = ll * (0.25 + rnd() * 0.3);
    const house = rect(t0, 6, 10, 8);
    if (!fits(house)) return;
    const HOUSE = [[1, 1, 1], [1.0, 0.95, 0.84], [0.78, 0.86, 0.74], [0.7, 0.8, 0.9]];
    this.addVolume(house, 0, 6.2, "clapboard", HOUSE[(rnd() * HOUSE.length) | 0], bbl, true, false, k, false, true, "", 1890);
    const barn = rect(t0 + 14, 14, 16, 11);
    if (fits(barn)) this.addVolume(barn, 0, 7.5, "clapboard", [0.72, 0.36, 0.3], bbl, true, false, k ^ 0x5, false, true, "", 1890);
    // the track in from the road to the yard
    const tx = A[0] + ux * (t0 + 5) , ty = A[1] + uy * (t0 + 5);
    const q = [[tx - ux * 1.6, ty - uy * 1.6], [tx + ux * 1.6, ty + uy * 1.6], [tx + ux * 1.6 + nx * 6, ty + uy * 1.6 + ny * 6], [tx - ux * 1.6 + nx * 6, ty - uy * 1.6 + ny * 6]];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const i of tri) { track.pos.push(q[i][0], q[i][1], 0.045); track.nrm.push(0, 0, 1); track.uv.push(q[i][0] / 5, q[i][1] / 5); track.col.push(1, 1, 1); }
    void cx; void cy;
  }

  private cropMat = new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0.1 });
  private paveMat: THREE.MeshStandardMaterial | null = null;
  private catcherMat = new THREE.ShadowMaterial({ opacity: 0.42, color: 0x1c2433 });
  private wetMat = new THREE.MeshStandardMaterial({ color: 0x1e2329, roughness: 0.12, metalness: 0, transparent: true, opacity: 0, depthWrite: false });
  private wetSheet: THREE.Mesh | null = null;
  private precip: THREE.LineSegments | null = null;
  private precipKind: "" | "rain" | "snow" = "";
  private wet = 0;
  /**
   * WEATHER YOU CAN SEE. The sky and the sun already followed it; now the
   * ground does. Overcast: shadows soften to a smudge. Rain: the streets and
   * footways go dark and glossy (a sheet of wet sheen over the ground,
   * reflecting the sky) and rain streaks fall round the view. Snow: flakes
   * drift down, and the footways, fields and rough grass whiten with the
   * yards and lawns MapLibre paints (MapView) — the carriageways stay dark.
   */
  private applyWeather() {
    const oc = this.overcast;
    this.catcherMat.opacity = 0.42 * (1 - oc * 0.72);
    const snowG = this.snowGround;
    if (this.paveMat) {
      this.paveMat.roughness = 0.86 - this.wet * 0.55;
      const k = 1 - this.wet * 0.28;
      this.paveMat.color.setRGB(k + (1.25 - k) * snowG, k + (1.25 - k) * snowG, k + (1.28 - k) * snowG);
    }
    this.wetMat.opacity = this.wet * 0.18;
    if (this.wetMat.opacity > 0 && !this.wetSheet) {
      this.wetMat.envMap = this.skyEnv;
      this.wetSheet = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), this.wetMat);
      this.wetSheet.position.z = 0.032; this.wetSheet.renderOrder = -2; this.wetSheet.receiveShadow = true;
      this.scene.add(this.wetSheet);
    }
    if (this.wetSheet) this.wetSheet.visible = this.wetMat.opacity > 0.001;
    // the falling stuff
    const want = this.wet > 0 ? "rain" : snowG > 0 ? "snow" : "";
    if (want !== this.precipKind) {
      if (this.precip) { this.scene.remove(this.precip); this.precip.geometry.dispose(); this.precip = null; }
      this.precipKind = want;
      if (want) {
        const N = 5000, B = 1, H = 2;
        const pos = new Float32Array(N * 6);
        let s2 = 12345; const rnd = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
        const len = want === "rain" ? 0.012 : 0.0015;
        for (let i = 0; i < N; i++) {
          const x = (rnd() * 2 - 1) * B, y = (rnd() * 2 - 1) * B, z = rnd() * H;
          pos.set([x, y, z, x + len * 0.15, y, z + len], i * 6);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.LineBasicMaterial({ color: want === "rain" ? 0xbfc8d2 : 0xffffff, transparent: true, opacity: want === "rain" ? 0.45 : 0.9, depthWrite: false });
        this.precip = new THREE.LineSegments(g, mat);
        this.precip.frustumCulled = false;
        this.precip.visible = this.quality !== "low";
        this.scene.add(this.precip);
      }
    }
    // the fields and rough grass under snow
    this.meadowMat.color.lerp(new THREE.Color(1.15, 1.17, 1.2), snowG * 0.85);
    this.cropMat.color.lerp(new THREE.Color(1.15, 1.17, 1.2), snowG * 0.85);
    this.map?.triggerRepaint();
  }
  private snowGround = 0;
  /** Each frame: the precipitation box follows the view and falls. */
  private stepPrecip(fx: number, fy: number, distM: number, t: number) {
    if (!this.precip) return;
    const B = Math.max(160, Math.min(900, distM * 0.7)), H = Math.max(120, Math.min(600, distM * 0.45));
    const spd = this.precipKind === "rain" ? 14 : 1.6;
    const off = (t * spd) % H;
    this.precip.scale.set(B, B, H);
    this.precip.position.set(fx, fy, -off);
  }
  private pierMatC: THREE.MeshStandardMaterial | null = null;
  /** Weathered timber decking, boards across the pier. */
  private pierMat(): THREE.MeshStandardMaterial {
    if (this.pierMatC) return this.pierMatC;
    const { c, g } = makeCanvas(64, 64);
    let s = 31; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < 64; y += 8) { const v = 0.85 + rnd() * 0.2; g.fillStyle = `rgb(${128 * v | 0},${108 * v | 0},${84 * v | 0})`; g.fillRect(0, y, 64, 7); g.fillStyle = "rgba(40,30,20,0.6)"; g.fillRect(0, y + 7, 64, 1); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    this.pierMatC = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, vertexColors: true, envMapIntensity: 0.2 });
    return this.pierMatC;
  }
  /** A market garden: rows of plants on furrowed soil, 16 m along by 3.2 m across a tile. */
  private cropTex(): THREE.CanvasTexture {
    const { c, g } = makeCanvas(256, 64);
    let s = 997; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = "#8a7356"; g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 900; i++) { const v = rnd(); g.fillStyle = `rgba(${110 + v * 40 | 0},${88 + v * 30 | 0},${62 + v * 20 | 0},0.5)`; g.fillRect(rnd() * 256, rnd() * 64, 2, 1.5); }
    for (const row of [16, 48]) {
      for (let x = 0; x < 256; x += 3) {
        const v = rnd();
        g.fillStyle = `rgb(${96 + v * 30 | 0},${132 + v * 30 | 0},${62 + v * 18 | 0})`;
        g.beginPath(); g.arc(x + rnd() * 2, row + (rnd() - 0.5) * 4, 5 + rnd() * 3, 0, 6.28); g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  /** Rough grass on unbuilt land: tussocks, a worn path, the odd bare patch. */
  private meadowTex(): THREE.CanvasTexture {
    const { c, g } = makeCanvas(128, 128);
    let s = 613; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = "#9a9c78"; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) { const v = rnd(); g.fillStyle = `rgba(${150 + v * 30 | 0},${140 + v * 20 | 0},${100},0.35)`; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 4 + rnd() * 10, 0, 6.28); g.fill(); }
    for (let i = 0; i < 1800; i++) { const v = rnd(); g.fillStyle = `rgba(${90 + v * 50 | 0},${105 + v * 45 | 0},${60 + v * 20 | 0},0.55)`; g.fillRect(rnd() * 128, rnd() * 128, 1.5, 2.5); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  /** Concrete flags with a joint every 1.5 m and a little staining. */
  private pavingTex(): THREE.CanvasTexture {
    const { c, g } = makeCanvas(128, 128);
    let s = 91;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    // weathered concrete, a step darker and cooler than new: a footway that
    // outshines the buildings beside it pulls the eye to the gaps between them
    g.fillStyle = "#a6a39c"; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) { const v = 135 + rnd() * 60 | 0; g.fillStyle = `rgba(${v},${v - 2},${v - 6},0.35)`; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(60,58,54,${0.05 + rnd() * 0.08})`; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 4 + rnd() * 14, 0, 6.28); g.fill(); }
    g.fillStyle = "rgba(70,66,60,0.55)"; g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  // ---- creeks and canals in a channel ------------------------------------
  // The water lies 1.2 m below the street between banks: dressed stone for a
  // canal, a rougher rubble face for a creek. MapLibre's ground is not in
  // this layer's depth buffer, so the near bank would let the water show
  // through it; every bank wall is drawn twice — once depth-only from behind,
  // ahead of the water, to stand in for the ground at the lip — and once in
  // colour facing the water. Harbour slips stay at sea level.
  private buildChannels() {
    const streams = ((this.ctx as { streams?: { ring: P2[]; water: string }[] }).streams ?? []).filter((s) => s.water !== "slip");
    if (!streams.length) return;
    const Z = RealCityLayer.WATER_Z, BED = Z - 0.4, TOP = 0.1;
    const water = new Buf(), stone = new Buf(), rubble = new Buf();
    const one = [1, 1, 1];
    // every piece of water a bank must not wall off: the other streams, the
    // flooded bridge gaps and the slips
    const wet: P2[][] = [
      ...((this.ctx as { streams?: { ring: P2[] }[] }).streams ?? []).map((x) => x.ring.map((q) => this.project(q))),
      ...((this.ctx as { bridges?: { ring: P2[] }[] }).bridges ?? []).map((x) => x.ring.map((q) => this.project(q))),
    ];
    const inPoly = (x: number, y: number, P: P2[]) => {
      let ins = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins;
      }
      return ins;
    };
    for (const st of streams) {
      let r = st.ring.map((q) => this.project(q));
      if (r.length < 3) continue;
      if (ringArea(r) < 0) r = r.slice().reverse();
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { continue; }
      for (const t of tris) for (const i of t) { water.pos.push(r[i][0], r[i][1], Z); water.nrm.push(0, 0, 1); water.uv.push(r[i][0] / 6, r[i][1] / 6); water.col.push(1, 1, 1); }
      const B = st.water === "canal" ? stone : rubble;
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.05) continue;
        // ring is counter-clockwise: the water is on the left, so the face looks inward
        const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
        const mx = (a[0] + b[0]) / 2 - nx * 0.6, my = (a[1] + b[1]) / 2 - ny * 0.6;
        if (wet.some((P) => P.length >= 3 && inPoly(mx, my, P))) continue;   // water on both sides
        B.quad([b[0], b[1], BED], [a[0], a[1], BED], [a[0], a[1], TOP], [b[0], b[1], TOP], [nx, ny, 0], [[L, 0], [0, 0], [0, 1.7], [L, 1.7]], one);
      }
    }
    const wm = new THREE.Mesh(water.geometry(), new THREE.MeshStandardMaterial({ color: 0x2f6070, roughness: 0.12, metalness: 0.05, envMapIntensity: 1.2, normalMap: this.waveTex(0.25), normalScale: new THREE.Vector2(0.3, 0.3), envMap: this.skyEnv }));
    wm.receiveShadow = true; wm.renderOrder = -4;
    this.scene.add(wm);
    for (const [buf, col, rough] of [[stone, 0xa69d8b, 0.75], [rubble, 0x7d776c, 0.95]] as [Buf, number, number][]) {
      if (!buf.count) continue;
      const g = buf.geometry();
      const depth = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide }));
      depth.renderOrder = -5;
      const face = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: rough, side: THREE.FrontSide, envMapIntensity: 0.25 }));
      face.receiveShadow = true; face.renderOrder = -4;
      this.scene.add(depth, face);
    }
  }
  static readonly WATER_Z = -1.2;

  // ---- bridges ------------------------------------------------------------
  // The generator lays each creek crossing as a dry gap in the water. Flood
  // the gap, then span it: a stone deck a metre up with parapets along the
  // two sides that run with the bridge's axis.
  private buildBridges() {
    const list = (this.ctx as { bridges?: { ring: P2[]; deg: number }[] }).bridges ?? [];
    if (!list.length) return;
    const water = new Buf(), stone = new Buf();
    const wc = [1, 1, 1], sc = [1, 1, 1];
    for (const br of list) {
      let r = br.ring.map((q) => this.project(q));
      if (r.length < 3) continue;
      if (ringArea(r) < 0) r = r.slice().reverse();
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { continue; }
      const WZ = RealCityLayer.WATER_Z;
      for (const t of tris) water.tri([r[t[0]][0], r[t[0]][1], WZ], [r[t[1]][0], r[t[1]][1], WZ], [r[t[2]][0], r[t[2]][1], WZ], [0, 0, 1], wc);
      const deck0 = 0.55, deck1 = 1.05, par = 1.9;
      for (const t of tris) {
        stone.tri([r[t[0]][0], r[t[0]][1], deck1], [r[t[1]][0], r[t[1]][1], deck1], [r[t[2]][0], r[t[2]][1], deck1], [0, 0, 1], sc);
        stone.tri([r[t[0]][0], r[t[0]][1], deck0], [r[t[2]][0], r[t[2]][1], deck0], [r[t[1]][0], r[t[1]][1], deck0], [0, 0, -1], sc);
      }
      // deg is the creek's flow (maths convention); the deck and its
      // parapets run ACROSS the flow
      const ft = (br.deg * Math.PI) / 180;
      const ax = -Math.sin(ft), ay = Math.cos(ft);
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < 0.2) continue;
        const nx = dy / L, ny = -dx / L;
        // the deck's edge face, all the way round
        stone.quad([a[0], a[1], deck0], [b[0], b[1], deck0], [b[0], b[1], deck1], [a[0], a[1], deck1], [nx, ny, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], sc);
        // a parapet only where the edge runs along the bridge
        if (Math.abs((dx * ax + dy * ay) / L) > 0.7) {
          const ix = -nx * 0.35, iy = -ny * 0.35;
          stone.quad([a[0], a[1], deck1], [b[0], b[1], deck1], [b[0], b[1], par], [a[0], a[1], par], [nx, ny, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], sc);
          stone.quad([b[0] + ix, b[1] + iy, deck1], [a[0] + ix, a[1] + iy, deck1], [a[0] + ix, a[1] + iy, par], [b[0] + ix, b[1] + iy, par], [-nx, -ny, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], sc);
          stone.quad([a[0], a[1], par], [b[0], b[1], par], [b[0] + ix, b[1] + iy, par], [a[0] + ix, a[1] + iy, par], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], sc);
        }
      }
    }
    const wm = new THREE.Mesh(water.geometry(), new THREE.MeshStandardMaterial({ color: 0x2f6070, roughness: 0.12, metalness: 0.05, vertexColors: true, envMapIntensity: 1.2, normalMap: this.waveTex(0.25), normalScale: new THREE.Vector2(0.3, 0.3), envMap: this.skyEnv }));
    wm.receiveShadow = true; wm.renderOrder = -4;
    const sm = new THREE.Mesh(stone.geometry(), new THREE.MeshStandardMaterial({ color: 0xb5ab98, roughness: 0.8, vertexColors: true, envMapIntensity: 0.3 }));
    sm.castShadow = sm.receiveShadow = true;
    this.scene.add(wm, sm);
  }

  // ---- street life --------------------------------------------------------
  private buildStreetLife() {
    let s = (this.seed * 7919) % 2147483646 + 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const meta = (this.ctx as { curbMeta?: { hw: number[]; sw: number[] }[] }).curbMeta ?? [];
    const CAR = [[0.9, 0.9, 0.89], [0.62, 0.64, 0.67], [0.16, 0.18, 0.21], [0.16, 0.26, 0.45], [0.58, 0.16, 0.14], [0.36, 0.40, 0.34], [0.78, 0.72, 0.56], [0.75, 0.76, 0.78]];
    const leafCol = () => [0.32 + rnd() * 0.08, 0.46 + rnd() * 0.1, 0.20 + rnd() * 0.06];
    const COAT = [[0.30, 0.32, 0.38], [0.62, 0.58, 0.52], [0.20, 0.24, 0.30], [0.52, 0.28, 0.24], [0.86, 0.84, 0.80], [0.28, 0.36, 0.32], [0.44, 0.40, 0.46], [0.70, 0.62, 0.44]];
    this.curbs.forEach((line, li) => {
      const pts = line.map((p) => this.project(p));
      const hwA = meta[li]?.hw ?? [], swA = meta[li]?.sw ?? [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < 20) continue;
        const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
        const hw = hwA[i] ?? 6, sw = swA[i] ?? 2.5;
        const rot = Math.atan2(uy, ux);
        // people on the footway, a few per block face, at a walking pace
        if (sw >= 1.8) {
          for (const side of [-1, 1]) {
            const n = Math.max(1, Math.round(L / 14));
            for (let k = 0; k < n; k++) {
              const fwd = rnd() < 0.5;
              const o = hw + sw * (0.35 + rnd() * 0.3);
              const sx = fwd ? a[0] : b[0], sy = fwd ? a[1] : b[1];
              this.walkers.push({
                x: sx + nx * o * side, y: sy + ny * o * side,
                ux: fwd ? ux : -ux, uy: fwd ? uy : -uy, len: L, ph: rnd() * L, spd: 1.1 + rnd() * 0.5,
                col: COAT[(rnd() * COAT.length) | 0], draw: rnd(),
              });
            }
          }
        }
        // moving traffic on the wider streets: one car per ~45 m each way,
        // in the running lane inside the parked row
        if (hw >= 5 && L > 50) {
          for (const side of [-1, 1]) {
            const n = Math.max(1, Math.round(L / 30));
            for (let k = 0; k < n; k++) {
              const o = Math.min(hw - 3.2, Math.max(1.8, hw * 0.45));
              // keep right: one side runs a→b, the other b→a
              const fwd = side < 0;
              const sx = fwd ? a[0] : b[0], sy = fwd ? a[1] : b[1];
              this.movers.push({
                x: sx + nx * o * side, y: sy + ny * o * side,
                ux: fwd ? ux : -ux, uy: fwd ? uy : -uy, len: L, ph: rnd() * L, spd: 6 + rnd() * 5,
                col: CAR[(rnd() * CAR.length) | 0], draw: rnd(),
              });
            }
          }
        }
        for (let t = 9; t < L - 9; t += 11) {
          for (const side of [-1, 1]) {
            const x = a[0] + ux * t, y = a[1] + uy * t;
            if (sw >= 2) {
              const o = hw + Math.max(0.8, sw * 0.45);
              const sz = 0.75 + rnd() * 0.3;
              // a third of the street trees are columnar — lindens and hornbeams
              // pruned tall and narrow, as a city plants them
              const col = rnd() < 0.33;
              this.putInst("trunk", x + nx * o * side, y + ny * o * side, 0.15, sz, rnd() * 6.28);
              this.putInst("crown", x + nx * o * side, y + ny * o * side, 0.15, col ? sz * 0.75 : sz, rnd() * 6.28, "", leafCol(), col ? 1.55 : 1);
            }
            // kerbside parking fills where the demand is; a country road is clear
            if (hw >= 5 && rnd() < 0.62 * Math.min(1, 0.15 + 1.1 * this.demandAt(x, y))) {
              const o = hw - 1.15;
              this.putInst("car", x + ux * 3 + nx * o * side, y + uy * 3 + ny * o * side, 0.05, 0.95 + rnd() * 0.12, rot + (side > 0 ? Math.PI : 0), "", CAR[(rnd() * CAR.length) | 0]);
            }
          }
          if (rnd() < 0.35 && sw >= 1.6) {
            const o = hw + 0.5;
            this.putInst("lamp", a[0] + ux * t + nx * o, a[1] + uy * t + ny * o, 0.15, 1, rot - Math.PI / 2);
          }
        }
      }
    });
    // what the park walks converge on: a column in the big parks, a fountain
    // in the squares
    for (const pk of (this.ctx as { parks?: { ring: P2[]; flavour?: string }[] }).parks ?? []) {
      if (!pk.ring || pk.ring.length < 3) continue;
      if (pk.flavour === "cemetery" || pk.flavour === "market" || pk.flavour === "battery") continue;
      const r = pk.ring.map((q) => this.project(q));
      let a2 = 0, cx = 0, cy = 0;
      for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; const cr = x1 * y2 - x2 * y1; a2 += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr; }
      if (Math.abs(a2) < 1e-6) continue;
      const area = Math.abs(a2) / 2;
      cx /= 3 * a2; cy /= 3 * a2;
      if (area > 9000) this.putInst("column", cx, cy, 0.07, 1, 0);
      else if (area > 1800) { this.putInst("fountain", cx, cy, 0.07, 1, 0); this.putInst("basin", cx, cy, 0.07, 1, 0); }
    }
    // launches tied up along canal and slip walls, every ~14 m with gaps
    const HULL = [[0.92, 0.92, 0.9], [0.86, 0.85, 0.8], [0.16, 0.22, 0.34], [0.2, 0.32, 0.26], [0.52, 0.2, 0.17], [0.3, 0.3, 0.31]];
    for (const st of (this.ctx as { streams?: { ring: P2[]; water: string }[] }).streams ?? []) {
      if (st.water !== "slip" && st.water !== "canal") continue;
      const r = st.ring.map((q) => this.project(q));
      const ccw = ringArea(r) > 0;
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 12) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        // inward normal of the water ring
        const nx = ccw ? -uy : uy, ny = ccw ? ux : -ux;
        for (let t = 6; t < L - 6; t += 14) {
          if (rnd() < 0.45) continue;
          const off = st.water === "slip" ? 2.4 : 1.8;
          const s = st.water === "slip" ? 1.3 + rnd() * 0.5 : 0.9 + rnd() * 0.3;
          this.putInst("hull", a[0] + ux * t + nx * off, a[1] + uy * t + ny * off, st.water === "slip" ? 0.05 : RealCityLayer.WATER_Z + 0.1, s, Math.atan2(uy, ux) + (rnd() < 0.5 ? Math.PI : 0), "", HULL[(rnd() * HULL.length) | 0]);
        }
      }
    }
    // the harbour traffic: launches and a ferry or two running parallel to
    // the shore a couple of hundred metres out
    const landLL2 = (this.ctx as { land?: P2[] }).land;
    if (landLL2 && landLL2.length >= 4) {
      const land = landLL2.map((q) => this.project(q));
      const ccw = ringArea(land) > 0;
      for (let i = 0; i < land.length; i++) {
        const a = land[i], b = land[(i + 1) % land.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 220 || rnd() < 0.4) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        const ox = ccw ? uy : -uy, oy = ccw ? -ux : ux;        // outward, into the water
        const off = 140 + rnd() * 260;
        const fwd = rnd() < 0.5;
        this.boats.push({
          x: (fwd ? a[0] : b[0]) + ox * off, y: (fwd ? a[1] : b[1]) + oy * off,
          ux: fwd ? ux : -ux, uy: fwd ? uy : -uy, len: L, ph: rnd() * L, spd: 4 + rnd() * 4,
          col: HULL[(rnd() * HULL.length) | 0],
        });
      }
    }
    // THE PARKS AND THE OPEN GROUND: big round canopies of every size, and
    // evergreens — a fifth of the trees in the parks, half in the cemeteries
    const parksP = ((this.ctx as { parks?: ({ ring: P2[]; flavour?: string } | P2[])[] }).parks ?? [])
      .map((pk) => Array.isArray(pk) ? { ring: pk.map((q) => this.project(q)), flavour: "park" } : { ring: (pk.ring ?? []).map((q) => this.project(q)), flavour: pk.flavour ?? "park" })
      .filter((pk) => pk.ring.length >= 3);
    const inRingP = (x: number, y: number, ring: P2[]) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins; } return ins; };
    for (const p of (this.ctx as { trees?: P2[] }).trees ?? []) {
      const [x, y] = this.project(p);
      const pk = parksP.find((q) => inRingP(x, y, q.ring));
      const pineP = pk?.flavour === "cemetery" ? 0.5 : pk ? 0.2 : 0.08;
      const sz = 0.8 + rnd() * 1.0;
      if (rnd() < pineP) {
        this.putInst("pine", x, y, 0, sz * 0.9, rnd() * 6.28, "", undefined, 1 + rnd() * 0.4);
      } else {
        this.putInst("trunk", x, y, 0, sz, rnd() * 6.28);
        this.putInst("crown", x, y, 0, sz, rnd() * 6.28, "", leafCol());
      }
    }
    // A PARK HAS BEDS AND BORDERS: a clipped low hedge just inside its edge,
    // open where a walk comes in, and flower beds round its fountain or column
    const paths = ((this.ctx as { paths?: P2[][] }).paths ?? []).map((l) => l.map((q) => this.project(q)));
    const nearPath = (x: number, y: number, d: number) => paths.some((l) => {
      for (let i = 0; i + 1 < l.length; i++) {
        const a = l[i], b = l[i + 1], vx = b[0] - a[0], vy = b[1] - a[1];
        const L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
        if (Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t) < d) return true;
      }
      return false;
    });
    const BED = [[0.86, 0.22, 0.2], [0.95, 0.78, 0.2], [0.62, 0.36, 0.72], [0.95, 0.92, 0.88], [0.95, 0.5, 0.62]];
    for (const pk of parksP) {
      if (pk.flavour === "market" || pk.flavour === "battery") continue;
      let ring = pk.ring;
      if (ringArea(ring) < 0) ring = ring.slice().reverse();
      if (Math.abs(ringArea(ring)) < 900) continue;
      const inner = insetRing(ring, 3.6);
      if (!inner) continue;
      for (let i = 0; i < inner.length; i++) {
        const a = inner[i], b = inner[(i + 1) % inner.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 3) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        for (let t = 1.3; t < L - 1.3; t += 2.5) {
          const x = a[0] + ux * t, y = a[1] + uy * t;
          if (nearPath(x, y, 3.2)) continue;
          this.putInst("parkhedge", x, y, 0.03, 0.75, Math.atan2(uy, ux));
        }
      }
      let a2 = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; const cr = x1 * y2 - x2 * y1; a2 += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr; }
      if (Math.abs(a2) < 1e-6) continue;
      cx /= 3 * a2; cy /= 3 * a2;
      const n = Math.abs(a2) / 2 > 9000 ? 8 : 6;
      for (let j = 0; j < n; j++) {
        const t = (j / n) * Math.PI * 2 + 0.3;
        const x = cx + Math.cos(t) * 9, y = cy + Math.sin(t) * 9;
        if (nearPath(x, y, 1.8)) continue;
        this.putInst("flowerbed", x, y, 0.03, 1, t, "", BED[(rnd() * BED.length) | 0]);
      }
    }
    this.flushInst();
    const fleet = (kind: string, list: Mover[], z: number) => {
      if (!list.length) return;
      const { g, mat } = this.geomFor(kind);
      const mesh = new THREE.InstancedMesh(g, mat, list.length);
      list.forEach((m, i) => mesh.setColorAt(i, new THREE.Color(m.col[0], m.col[1], m.col[2])));
      mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.scene.add(mesh); this.fleets.push({ mesh, list, z });
    };
    fleet("car", this.movers, 0.05);
    fleet("person", this.walkers, 0.15);
    fleet("ferry", this.boats, 0.05);
    this.applyCrowd();
    this.applyMonth();
  }

  /** Move every car and walker to where it is at time t (seconds): a patrol along its own block face that wraps. */
  private stepTraffic(t: number) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const f of this.fleets) {
      f.list.forEach((m, i) => {
        if (i >= f.mesh.count) return;
        const d = (m.ph + t * m.spd) % m.len;
        p.set(m.x + m.ux * d, m.y + m.uy * d, f.z);
        q.setFromEuler(e.set(0, 0, Math.atan2(m.uy, m.ux)));
        f.mesh.setMatrixAt(i, m4.compose(p, q, one));
      });
      f.mesh.instanceMatrix.needsUpdate = true;
    }
    // a crane driver works a load: sweep, hesitate, reverse
    if (this.cranes) {
      this.cranes.at.forEach((c, i) => {
        const r = c.r + 1.1 * Math.sin(t * 0.11 + c.r * 3) + 0.45 * Math.sin(t * 0.29 + c.r);
        q.setFromEuler(e.set(0, 0, r));
        this.cranes!.mesh.setMatrixAt(i, m4.compose(p.set(c.x, c.y, 0), q, one));
      });
      this.cranes.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  private cranes: { mesh: THREE.InstancedMesh; at: { x: number; y: number; r: number }[] } | null = null;
  private movers: Mover[] = [];
  private walkers: Mover[] = [];
  private boats: Mover[] = [];
  private fleets: { mesh: THREE.InstancedMesh; list: Mover[]; z: number }[] = [];
  private paused = false;
  private lastTick = 0;

  // ---- state on the buildings ---------------------------------------------
  private refreshDeed(bbl: string) {
    for (const d of [this.deeds.get(bbl), this.dynDeeds.get(bbl)]) if (d) this.paintDeed(bbl, d);
  }

  private paintDeed(bbl: string, d: Deed) {
    const own = this.owned.has(bbl), sel = this.selected.has(bbl), hov = this.hover === bbl;
    const lv = this.lens?.get(bbl);
    const tint = this.tints.get(bbl);
    for (const r of d.ranges) {
      if (!r.mesh || !r.base) continue;
      const col = r.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      const arr = col.array as Float32Array;
      const base = r.base;
      const roof = r.buf === "roof";
      if (this.lens && roof) {
        // the lens lives on the roofs, in the same ramp as the ground
        const c = lv === undefined ? new THREE.Color(0.8, 0.79, 0.76) : this.rampAt(lv);
        for (let i = 0; i < r.count; i++) { arr[(r.start + i) * 3] = c.r * 1.6; arr[(r.start + i) * 3 + 1] = c.g * 1.6; arr[(r.start + i) * 3 + 2] = c.b * 1.6; }
      } else {
        let k = tint ? [tint[0], tint[1], tint[2]] : [1, 1, 1];
        if (!roof) {
          const cn = this.cond.get(bbl);
          if (cn !== undefined) {
            const worn = 1 - smooth(0.28, 0.62, cn), fresh = smooth(0.74, 0.94, cn);
            const dk = (1 - worn * 0.34) * (1 + fresh * 0.08);
            // and greyer: pull the three channels toward their mean
            const mean = (k[0] + k[1] + k[2]) / 3;
            const g2 = worn * 0.45;
            k = [(k[0] + (mean - k[0]) * g2) * dk * (1 - worn * 0.06), (k[1] + (mean - k[1]) * g2) * dk, (k[2] + (mean - k[2]) * g2) * dk * (1 + worn * 0.04)];
          }
          // the selected building glows warm all over; yours are warmed a touch
          if (own) k = [k[0] * 1.08, k[1], k[2] * 0.86];
          if (sel) k = [k[0] * 1.3, k[1] * 1.18, k[2] * 0.82];
          else if (hov) k = [k[0] * 1.12, k[1] * 1.12, k[2] * 1.12];
          if (r.buf.startsWith("w:shop")) {
            // kraft paper behind unlit glass: duller and browner the emptier
            const rt = this.ret.get(bbl);
            if (rt !== undefined) {
              const dead = 1 - Math.max(0, Math.min(1, rt));
              k = [k[0] * (1 - dead * 0.18), k[1] * (1 - dead * 0.24), k[2] * (1 - dead * 0.36)];
            }
          }
          for (let i = 0; i < r.count * 3; i++) arr[r.start * 3 + i] = base[i] * k[i % 3];
        } else if (own || sel) {
          // YOURS WEAR A GOLD ROOF, whatever the roof or the weather: the
          // target is an absolute gilt, divided by the roof material's own
          // colour because the material multiplies whatever is written here
          const rc = this.roofMat.color;
          const g = sel ? [1.0, 0.80, 0.30] : [0.86, 0.64, 0.20];
          const v = [g[0] / Math.max(rc.r, 0.05), g[1] / Math.max(rc.g, 0.05), g[2] / Math.max(rc.b, 0.05)];
          for (let i = 0; i < r.count * 3; i++) arr[r.start * 3 + i] = v[i % 3];
        } else {
          const h = hov ? 1.15 : 1;
          for (let i = 0; i < r.count * 3; i++) arr[r.start * 3 + i] = base[i] * k[i % 3] * h;
        }
      }
      col.addUpdateRange(r.start * 3, r.count * 3); col.needsUpdate = true;
    }
  }

  private rampAt(t: number): THREE.Color {
    const n = this.lensRamp.length;
    if (!n) return new THREE.Color(0.8, 0.8, 0.8);
    const x = Math.max(0, Math.min(1, t)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    return this.lensRamp[i].clone().lerp(this.lensRamp[i + 1] ?? this.lensRamp[i], x - i);
  }

  setOwned(owned: Set<string>, _status?: Map<string, { listed?: boolean; distress?: 0 | 1 | 2 }>) {
    const touched = new Set<string>([...this.owned, ...owned]);
    this.owned = new Set(owned);
    for (const b of touched) this.refreshDeed(b);
    this.map?.triggerRepaint();
  }
  setHighlight(selected: string[], hover: string | null) {
    const touched = new Set<string>([...this.selected, ...selected]);
    if (this.hover) touched.add(this.hover);
    if (hover) touched.add(hover);
    this.selected = new Set(selected);
    this.hover = hover;
    for (const b of touched) this.refreshDeed(b);
    this.map?.triggerRepaint();
  }
  setLens(values: Map<string, number> | null, ramp: string[] = []) {
    const had = this.lens;
    this.lens = values ? new Map(values) : null;
    this.lensRamp = ramp.map((h) => new THREE.Color(h));
    const touched = new Set<string>([...(had?.keys() ?? []), ...(values?.keys() ?? [])]);
    if (!!had !== !!values) for (const b of this.deeds.keys()) touched.add(b);
    for (const b of touched) this.refreshDeed(b);
    this.map?.triggerRepaint();
  }
  setTints(tints: Map<string, [number, number, number]>) {
    const touched = new Set<string>([...this.tints.keys(), ...tints.keys()]);
    this.tints = new Map(tints);
    for (const b of touched) this.refreshDeed(b);
    this.map?.triggerRepaint();
  }

  // ---- the game building and demolishing ------------------------------------
  private lotRing(bbl: string): P2[] | null {
    const ll = this.lotRingLL[bbl];
    if (ll && ll.length >= 3) return ll.map((p) => this.project(p));
    return this.deeds.get(bbl)?.ring ?? null;
  }

  private flatten(bbl: string) {
    if (this.flattened.has(bbl)) return;
    this.flattened.add(bbl);
    const d = this.deeds.get(bbl);
    if (!d) return;
    for (const r of d.ranges) {
      const pa = r.mesh?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!pa) continue;
      const arr = pa.array as Float32Array;
      for (let i = r.start; i < r.start + r.count; i++) arr[i * 3 + 2] = Math.min(arr[i * 3 + 2], 0.01);
      pa.addUpdateRange(r.start * 3, r.count * 3); pa.needsUpdate = true;
    }
    const m4 = new THREE.Matrix4();
    for (const it of d.inst) {
      const mesh = this.inst.get(it.mesh);
      if (!mesh) continue;
      mesh.getMatrixAt(it.i, m4); m4.scale(new THREE.Vector3(0, 0, 0)); mesh.setMatrixAt(it.i, m4);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.renderer && (this.renderer.shadowMap.needsUpdate = true);
  }

  /**
   * THE SCHEME ON THE DESK, STANDING ON ITS LOT. While the player designs a
   * building it is drawn finished, in its chosen look, where it will stand —
   * among its real neighbours, at its real height — and redrawn on every
   * change. Cleared when the desk closes or the ground breaks.
   */
  setPreview(item: PlayerItem | null) {
    const sig = item ? JSON.stringify(item) : "";
    if (sig === this.previewSig) return;
    this.previewSig = sig;
    this.preview = item;
    this.setPlayerBuildings(this.lastItems, true);
  }
  private preview: PlayerItem | null = null;
  private previewSig = "";
  private lastItems: PlayerItem[] = [];

  setPlayerBuildings(items0: PlayerItem[], force = false) {
    this.lastItems = items0;
    const items = this.preview ? [...items0.filter((i) => i.bbl !== this.preview!.bbl), this.preview] : items0;
    const sig = items.map((i) => `${i.bbl}:${i.cls}:${i.heightM}:${i.floors}:${i.construction ? 1 : 0}:${i.cov ?? 0}:${i.design ? JSON.stringify(i.design) : ""}`).join("|");
    if (sig === this.dynSig && !force) return;
    this.dynSig = sig;
    for (const c of [...this.dyn.children]) { this.dyn.remove(c); if (!(c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.Mesh).geometry?.dispose(); }
    this.dynHeight.clear();
    this.pickGrid = null;
    // the new stock is built into its own small set of buffers
    const saveBufs = this.bufs, saveDeeds = this.deeds, saveInst = this.instItems;
    this.bufs = new Map(); this.deeds = new Map(); this.instItems = new Map();
    const craneAt: { x: number; y: number; r: number }[] = [];
    this.cranes = null;
    for (const it of items) {
      this.flattenStatic(saveDeeds, it.bbl);
      if (!(it.heightM > 0) || it.cls === "land") continue;
      const lot = this.lotRing(it.bbl) ?? saveDeeds.get(it.bbl)?.ring ?? null;
      if (!lot) continue;
      let cx = 0, cy = 0;
      for (const [x, y] of lot) { cx += x; cy += y; }
      cx /= lot.length; cy /= lot.length;
      const B = it.cov && it.cov > 0 ? Math.min(0.97, Math.sqrt(it.cov)) : 0.82;
      const ring = lot.map(([x, y]) => [cx + (x - cx) * B, cy + (y - cy) * B] as P2);
      const h = Math.max(3, it.heightM);
      let fam = it.construction ? "frame" : familyFor(it.cls, it.year && it.year > 1800 ? it.year : 2000, h, hash01(keyOf(it.bbl) ^ 0x3c1f, this.seed));
      const k = keyOf(it.bbl);
      // the developer's own design, where there is one (BuildingDesign)
      const d = it.construction ? undefined : it.design;
      let variant: string | undefined;
      if (d?.facade) {
        const base = d.facade.split("#")[0];
        if (this.families[base]) { fam = base; variant = this.families[d.facade] ? d.facade : base; }
      }
      const ov: VolumeOv | undefined = d ? { variant, trim: d.trim, roof: d.roof } : undefined;
      const pitched = !!d && (d.roof === "gable" || d.roof === "hip") && ring.length === 4;
      const tints = TINTS[fam];
      const tint = d?.facade ? [1, 1, 1] : tints[Math.floor(hash01(k, this.seed) * tints.length)];
      const shop = it.cls === "retail" || it.cls === "mixed";
      let topRing = ring;
      if (it.construction) {
        // a job site goes up in stages, not as a grey box (buildSite)
        this.buildSite(ring, it, k, cx, cy);
        this.dynHeight.set(it.bbl, h);
        craneAt.push({ x: ring[0][0] * 0.7 + cx * 0.3, y: ring[0][1] * 0.7 + cy * 0.3, r: hash01(k, 31) * 6.28 });
        continue;
      }
      if (d?.crown === "cake" && it.floors >= CROWN_MIN_FLOORS) {
        // the wedding cake: a full-lot base, a terrace, a slim shaft
        const at = (f: number) => ring.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as P2);
        const h1 = h * 0.55, h2 = h * 0.82;
        this.addVolume(ring, 0, h1, fam, tint, it.bbl, true, false, k, shop, false, it.cls, 0, ov);
        this.addVolume(at(0.84), h1, h2, fam, tint, it.bbl, true, false, k, false, false, "", 0, ov);
        topRing = at(0.68);
        this.addVolume(topRing, h2, h, fam, tint, it.bbl, true, true, k, false, false, it.cls, 0, ov);
      } else {
        this.addVolume(ring, 0, h, fam, tint, it.bbl, true, !it.construction, k, !it.construction && shop, pitched, it.construction ? "" : it.cls, 0, ov);
      }
      if (!it.construction) {
        // a crown the player named (towers only); otherwise the period's own
        const kind = d?.crown && d.crown !== "cake" && it.floors >= CROWN_MIN_FLOORS ? d.crown : "auto";
        this.towerTop(topRing, h, h, fam, tint, it.bbl, k, kind as "auto" | "none" | "setback" | "spire" | "mast", ov);
      }
      this.dynHeight.set(it.bbl, h);
      if (it.construction) craneAt.push({ x: ring[0][0] * 0.7 + cx * 0.3, y: ring[0][1] * 0.7 + cy * 0.3, r: hash01(k, 31) * 6.28 });
    }
    const dynMeshes = new Map<string, THREE.Mesh>();
    for (const [name, b] of this.bufs) {
      if (!b.count) continue;
      const mat = name.startsWith("w:") ? this.families[name.slice(2)].mat
        : name === "roof" ? this.roofMat : name === "dark" ? this.darkMat : name === "pier" ? this.pierMat() : this.trimMat;
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.dyn.add(mesh); dynMeshes.set(name, mesh);
    }
    if (craneAt.length) {
      const { g, mat } = this.geomFor("crane");
      const cm = new THREE.InstancedMesh(g, mat, craneAt.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      craneAt.forEach((c, i) => { q.setFromEuler(e.set(0, 0, c.r)); cm.setMatrixAt(i, m4.compose(new THREE.Vector3(c.x, c.y, 0), q, new THREE.Vector3(1, 1, 1))); });
      cm.castShadow = cm.receiveShadow = true;
      this.dyn.add(cm);
      this.cranes = { mesh: cm, at: craneAt };
    }
    // the new buildings' own plant, fire escapes and balconies
    {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
      for (const [kind, list] of this.instItems) {
        if (!list.length) continue;
        const { g, mat } = this.geomFor(kind);
        const im = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((it, i) => { q.setFromEuler(e.set(0, 0, it.r)); im.setMatrixAt(i, m4.compose(pv.set(it.x, it.y, it.z), q, sc.set(it.s, it.s, it.s * (it.sz ?? 1)))); });
        im.castShadow = im.receiveShadow = true;
        this.dyn.add(im);
      }
    }
    this.bindRanges(this.deeds, dynMeshes);
    this.dynDeeds = this.deeds;
    this.bufs = saveBufs; this.deeds = saveDeeds; this.instItems = saveInst;
    for (const [b, d] of this.dynDeeds) { this.refreshDeed(b); this.paintLit(b, d); }
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    this.map?.triggerRepaint();
  }

  private flattenStatic(deeds: Map<string, Deed>, bbl: string) {
    const keep = this.deeds; this.deeds = deeds;
    this.flatten(bbl);
    this.deeds = keep;
  }

  // ---- picking -------------------------------------------------------------
  // WHAT IS UNDER THE POINTER, IN 3D. The flat parcel layer answers with the
  // lot whose FOOTPRINT is under the cursor, which from a pitched camera is
  // the street behind a tower, not the tower you are pointing at. This walks
  // the pointer's ray down from the eye and stops at the first lot whose
  // building stands taller than the ray at that spot — or, failing that, the
  // lot the ray lands on.
  private pickGrid: Map<number, { bbl: string; ring: P2[]; x0: number; y0: number; x1: number; y1: number }[]> | null = null;
  private static PICK_CELL = 60;
  private pickMax = 0;
  private pickTop() { return this.pickMax; }
  private pickIndex() {
    if (this.pickGrid) return this.pickGrid;
    const g = new Map<number, { bbl: string; ring: P2[]; x0: number; y0: number; x1: number; y1: number }[]>();
    const C = RealCityLayer.PICK_CELL;
    const bbls = new Set<string>([...Object.keys(this.lotRingLL), ...this.deeds.keys(), ...this.dynDeeds.keys()]);
    for (const bbl of bbls) {
      const ring = this.lotRing(bbl);
      if (!ring || ring.length < 3) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const e = { bbl, ring, x0, y0, x1, y1 };
      for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++)
        for (let cy = Math.floor(y0 / C); cy <= Math.floor(y1 / C); cy++) {
          const k = cx * 100003 + cy;
          let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(e);
        }
    }
    let m = 0;
    for (const d of this.deeds.values()) m = Math.max(m, d.height);
    for (const v of this.dynHeight.values()) m = Math.max(m, v);
    this.pickMax = m + 1;
    this.pickGrid = g;
    return g;
  }
  /** The lot under a pointer at (px, py) CSS pixels in the map container, building first. */
  pickAt(px: number, py: number): string | null {
    const el = this.map?.getContainer();
    if (!el) return null;
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    const nx = (px / w) * 2 - 1, ny = 1 - (py / h) * 2;
    const toWorld = (z: number) => new THREE.Vector3(nx, ny, z).applyMatrix4(this.camera.projectionMatrixInverse).applyMatrix4(this.camera.matrix);
    const a = toWorld(-1), b = toWorld(1);
    if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return null;
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len <= 0) return null;
    dir.divideScalar(len);
    // start at the eye, not the near plane
    const o = new THREE.Vector3().setFromMatrixPosition(this.camera.matrix);
    if (dir.z >= 0) return null;   // pointing at the sky
    const grid = this.pickIndex(), C = RealCityLayer.PICK_CELL;
    const inRing = (r: P2[], x: number, y: number) => {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const lotAt = (x: number, y: number, z: number | null) => {
      const cell = grid.get(Math.floor(x / C) * 100003 + Math.floor(y / C));
      if (!cell) return null;
      for (const e of cell) {
        if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) continue;
        if (z !== null) {
          const ht = this.dynHeight.get(e.bbl) ?? (this.flattened.has(e.bbl) ? 0 : this.deeds.get(e.bbl)?.height ?? 0);
          if (ht < z) continue;
        }
        if (inRing(e.ring, x, y)) return e.bbl;
      }
      return null;
    };
    // walk until the ray reaches the ground; finer near the eye
    const tGround = -o.z / dir.z;
    const p = new THREE.Vector3();
    for (let t = 0, n = 0; t < tGround && n < 4000; n++) {
      p.copy(o).addScaledVector(dir, t);
      if (p.z < this.pickTop()) { const hit = lotAt(p.x, p.y, p.z); if (hit) return hit; }
      t += Math.max(1.5, t * 0.003);
    }
    p.copy(o).addScaledVector(dir, tGround);
    return lotAt(p.x, p.y, null);
  }

  buildingFrame(bbl: string): { radius: number; height: number } | null {
    const ring = this.lotRing(bbl);
    if (!ring || ring.length < 3) return null;
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length; cy /= ring.length;
    let radius = 0;
    for (const [x, y] of ring) radius = Math.max(radius, Math.hypot(x - cx, y - cy));
    const height = this.dynHeight.get(bbl) ?? (this.flattened.has(bbl) ? 0 : this.deeds.get(bbl)?.height ?? 0);
    return { radius, height };
  }

  // ---- sun, season, hour, weather -----------------------------------------
  setMonth(m: number) {
    if (!Number.isFinite(m)) return;
    this.month = ((Math.floor(m) % 12) + 12) % 12;
    this.applyMonth();
  }

  private applyMonth() {
    const w2 = Math.cos((2 * Math.PI * (this.month - 6)) / 12);     // 1 in June, -1 in December
    const el = ((35 + 11 * w2) * Math.PI) / 180;
    const az = ((200 - 12 * w2) * Math.PI) / 180;
    // the vector points from the ground toward the sun (x east, y north)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)).normalize();
    this.shadowSpan = 0;   // force a refit
    // the rough grass on unbuilt land: straw in winter, green by June
    const vig = [0, 0, 0.12, 0.55, 0.9, 1, 1, 0.96, 0.82, 0.52, 0.16, 0.02][this.month];
    // the gardens: bare soil in winter, green rows through summer, gold at harvest
    const ripe = [0, 0, 0, 0, 0, 0, 0.1, 0.45, 0.85, 0.3, 0, 0][this.month];
    this.cropMat.color.setRGB(0.9 + vig * 0.1 + ripe * 0.35, 0.82 + vig * 0.18 + ripe * 0.15, 0.78 + vig * 0.05 - ripe * 0.3);
    this.meadowMat.color.setRGB(0.98 - vig * 0.22, 0.95 + vig * 0.1, 0.84 - vig * 0.14);
    // the canopy: green in summer, turning in autumn, bare grey in winter
    const leaf = this.inst.get("crown");
    if (leaf) {
      const turn = [0, 0, 0, 0, 0, 0, 0, 0.05, 0.3, 0.85, 0.9, 0.2][this.month];
      const bare = [1, 1, 0.85, 0.4, 0.02, 0, 0, 0, 0, 0.1, 0.6, 0.95][this.month];
      this.leafMat.color.setRGB(1, 1, 1);
      const autumn = [[1.9, 0.62, 0.3], [1.8, 1.05, 0.36], [1.55, 1.25, 0.4], [0.9, 1.0, 0.8]];
      // five greens and the odd copper beech, by tree
      const PAL = [[0.30, 0.47, 0.20], [0.38, 0.53, 0.19], [0.22, 0.40, 0.22], [0.27, 0.42, 0.29], [0.34, 0.50, 0.24], [0.42, 0.26, 0.24]];
      for (let i = 0; i < leaf.count; i++) {
        const h = hash01(i, 77);
        const pc = PAL[h < 0.04 ? 5 : Math.floor(hash01(i, 91) * 5)];
        let c = new THREE.Color(pc[0] * (0.92 + h * 0.16), pc[1] * (0.92 + h * 0.16), pc[2]);
        if (turn > 0) { const a = autumn[Math.floor(h * 4)]; c.lerp(new THREE.Color(c.r * a[0], c.g * a[1], c.b * a[2]), turn); }
        if (bare > 0) c = c.lerp(new THREE.Color(0.30, 0.27, 0.24), bare * 0.85);
        leaf.setColorAt(i, c);
      }
      if (leaf.instanceColor) leaf.instanceColor.needsUpdate = true;
      leaf.scale.set(1, 1, 1);
    }
    // the beds are bare earth November to March
    const beds = this.inst.get("flowerbed");
    if (beds) beds.visible = this.month >= 3 && this.month <= 9;
    // evergreens keep their needles; a dusting of snow lightens them
    this.pineMat.color.setRGB(0.1 + this.snow * 0.25, 0.2 + this.snow * 0.2, 0.12 + this.snow * 0.28);
    this.applyLight();
    this.applyWeather();
  }

  setWeather(kind: "clear" | "overcast" | "rain" | "snow", precipitation: number, overcast: number) {
    this.snow = kind === "snow" ? 0.3 + Math.max(0, Math.min(1, precipitation)) * 0.5 : 0;
    this.overcast = Math.max(0, Math.min(1, overcast || 0));
    const pr = Math.max(0, Math.min(1, precipitation || 0));
    this.wet = kind === "rain" ? 0.5 + pr * 0.5 : 0;
    this.snowGround = kind === "snow" ? 0.35 + pr * 0.55 : 0;
    this.applyLight();
    this.applyMonth();   // which re-applies the weather on top of the season
  }
  private overcast = 0;

  setDayPhase(target: number, instant = false) {
    this.duskTarget = Math.max(0, Math.min(1, Number.isFinite(target) ? target : 0));
    if (instant) this.dusk = this.duskTarget;
    this.applyLight();
    this.map?.triggerRepaint();
  }
  private stepDusk() {
    if (this.dusk === this.duskTarget) return;
    const d = this.duskTarget - this.dusk;
    this.dusk = Math.abs(d) < 0.01 ? this.duskTarget : this.dusk + d * 0.08;
    this.applyLight();
  }

  private applyLight() {
    const night = smooth(0.35, 0.95, this.dusk);
    const golden = smooth(0.0, 0.5, this.dusk) * (1 - night);
    const sunK = (1 - night * 0.97) * (1 - this.overcast * 0.6);
    this.sun.intensity = 3.4 * sunK;
    this.sun.color.setRGB(1, 0.9 - golden * 0.25, 0.78 - golden * 0.4);
    this.hemi.intensity = 0.6 * (1 - night * 0.8) + this.overcast * 0.25;
    this.hemi.color.setRGB(0.78 - night * 0.45, 0.85 - night * 0.45, 0.93 - night * 0.3);
    this.scene.environmentIntensity = 0.5 * (1 - night * 0.85);
    // lit rooms after dark
    for (const f of Object.values(this.families)) f.mat.emissiveIntensity = night * 1.4;
    this.lampMat.emissiveIntensity = night * 2.2;
    // snow lies on the roofs
    // tar and gravel is dark (albedo ~0.2); snow lifts it toward white
    // a dusting, not a blanket: January opens every campaign
    this.roofMat.color.setRGB(0.21 + this.snow * 0.22, 0.205 + this.snow * 0.23, 0.20 + this.snow * 0.26);
    for (const b of [...this.owned, ...this.selected]) this.refreshDeed(b);
    if (this.renderer) this.renderer.toneMappingExposure = 0.82 - night * 0.15;
    // MapLibre's ground knows nothing of the hour: a blue-black veil over it
    // after dusk, a warm one as the sun goes down
    this.veil.color.setRGB(0.05 + golden * 0.35, 0.07 + golden * 0.16, 0.14);
    this.veil.opacity = night * 0.62 + golden * 0.08;
    // the haze: sky blue by day (greyer overcast, warmer at golden hour),
    // a blue-black murk at night
    const oc = this.overcast;
    const day = [0.742 + (0.643 - 0.742) * oc + golden * 0.1, 0.818 + (0.694 - 0.818) * oc + golden * 0.02, 0.9 + (0.722 - 0.9) * oc - golden * 0.08];
    const nightC = [0.08, 0.1, 0.16];
    HAZE.hazeCol.value.setRGB(day[0] + (nightC[0] - day[0]) * night, day[1] + (nightC[1] - day[1]) * night, day[2] + (nightC[2] - day[2]) * night);
    HAZE.hazeCap.value = (0.55 + oc * 0.2) * (1 - night * 0.35);
    this.map?.triggerRepaint();
  }

  sunBackBearing(): number {
    return (Math.atan2(-this.sunDir.x, -this.sunDir.y) * 180) / Math.PI;
  }

  // ---- calls this renderer accepts and has nothing to draw for (yet) -------
  /**
   * The engine's own condition index (read, never written): a neglected
   * building is the same building under decades of soot — greyer and darker
   * on every wall; a refit is a touch cleaner.
   */
  setCondition(c: Map<string, number>) {
    const touched = new Set<string>([...this.cond.keys(), ...c.keys()]);
    this.cond = new Map(c);
    for (const b of touched) this.refreshDeed(b);
    this.map?.triggerRepaint();
  }
  private cond = new Map<string, number>();
  /** Share of each building that is let (read only): sets how much of it is lit after dark. */
  setOccupancy(o: Map<string, number>) {
    this.occ = new Map(o);
    for (const d of [this.deeds, this.dynDeeds]) for (const [bbl, deed] of d) this.paintLit(bbl, deed);
    this.paintBanners();
    this.map?.triggerRepaint();
  }
  private occ = new Map<string, number>();
  private leaseMeshes: THREE.InstancedMesh[] = [];
  /**
   * EMPTY SPACE ADVERTISES ITSELF. With no night there are no dark floors to
   * read vacancy off, so a building with space to let does what one does on
   * a real street: hangs a banner. One under 80% let (a fifth of the space
   * empty — about one building in six at a normal vacancy), two on its two
   * longest walls under 55%; red FOR LEASE or yellow SPACE AVAILABLE by the
   * building's own hash. Read from the same occupancy map the windows use.
   */
  private paintBanners() {
    for (const m of this.leaseMeshes) { this.scene.remove(m); m.dispose(); }
    this.leaseMeshes = [];
    const spots: { x: number; y: number; z: number; r: number; w: number; kind: number }[][] = [[], []];
    for (const deeds of [this.deeds, this.dynDeeds]) for (const [bbl, d] of deeds) {
      const o = this.occ.get(bbl);
      if (o === undefined || o >= 0.8 || !d.ring || d.height < 6) continue;
      if (this.dynHeight.has(bbl) && deeds === this.deeds) continue;   // redeveloped: the new building speaks
      let ring = d.ring;
      if (ringArea(ring) < 0) ring = ring.slice().reverse();
      const edges = ring.map((a, i) => { const b = ring[(i + 1) % ring.length]; return { a, b, L: Math.hypot(b[0] - a[0], b[1] - a[1]) }; })
        .filter((e) => e.L > 5).sort((p, q) => q.L - p.L);
      const k = keyOf(bbl);
      const kind = hash01(k ^ 0x1ea5e, this.seed) < 0.6 ? 0 : 1;
      for (const e of edges.slice(0, o < 0.55 ? 2 : 1)) {
        const nx = (e.b[1] - e.a[1]) / e.L, ny = -(e.b[0] - e.a[0]) / e.L;
        const w = Math.max(5, Math.min(13, e.L * 0.7));
        const t = 0.3 + 0.4 * hash01(k ^ 0x5a1, 7);
        const z = Math.max(3.2, d.height - 2.4 - (d.height > 20 ? hash01(k, 9) * 6 : 0));
        spots[kind].push({ x: e.a[0] + (e.b[0] - e.a[0]) * t + nx * 0.18, y: e.a[1] + (e.b[1] - e.a[1]) * t + ny * 0.18, z, r: Math.atan2(ny, nx) + Math.PI / 2, w, kind });
      }
    }
    spots.forEach((list, kind) => {
      if (!list.length) return;
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, this.bannerMat(kind), list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      list.forEach((b, i) => { q.setFromEuler(e.set(0, 0, b.r)); mesh.setMatrixAt(i, m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, 1, b.w * 0.24))); });
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.scene.add(mesh); this.leaseMeshes.push(mesh);
    });
  }
  private bannerMats: THREE.Material[] = [];
  private bannerMat(kind: number): THREE.Material {
    if (this.bannerMats[kind]) return this.bannerMats[kind];
    const { c, g } = makeCanvas(512, 128);
    g.fillStyle = kind === 0 ? "#b5121b" : "#f2c230"; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = kind === 0 ? "#f4f0e6" : "#1d1d1d"; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
    g.fillStyle = kind === 0 ? "#f8f5ee" : "#1d1d1d";
    g.font = "bold 70px Arial, Helvetica, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(kind === 0 ? "FOR LEASE" : "SPACE TO LET", 256, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    this.bannerMats[kind] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.2 });
    return this.bannerMats[kind];
  }
  private paintLit(bbl: string, d: Deed) {
    const o = this.occ.get(bbl);
    // the tile itself is ~55% lit rooms; full let reads ~1.6x that, empty near dark
    const k = o === undefined ? 1 : 0.08 + 1.5 * Math.max(0, Math.min(1, o));
    for (const r of d.ranges) {
      if (!r.mesh || !r.buf.startsWith("w:")) continue;
      const a = r.mesh.geometry.getAttribute("lit") as THREE.BufferAttribute;
      (a.array as Float32Array).fill(k, r.start, r.start + r.count);
      a.addUpdateRange(r.start, r.count); a.needsUpdate = true;
    }
  }
  /** Let share of each building's shopfronts (read only): a dead frontage is papered over and dark. */
  setRetail(r: Map<string, number>) {
    const touched = new Set<string>([...this.ret.keys(), ...r.keys()]);
    this.ret = new Map(r);
    for (const b of touched) this.refreshDeed(b);
    this.map?.triggerRepaint();
  }
  private ret = new Map<string, number>();
  setNotices(_b: string[]) { /* badges carry notices */ }
  setForSale(_m: string[], _o: string[]) { /* badges carry listings */ }
  setCivicWorks(_w: unknown) { /* civic works: classic renderer */ }
  /**
   * CROWDS FOLLOW THE ECONOMY. Every person and car on the street carries a
   * draw and the demand of the ground under it; it is on the street when
   * draw < activity x (0.3 + 0.9 x local demand). A thriving downtown
   * throngs, a district losing its tenants empties out, and the whole town
   * thins in a slump (cityVisuals' activity, 0.38-1.05).
   */
  setActivity(a: number) {
    this.activity = Math.max(0.2, Math.min(1.1, a));
    this.applyCrowd();
  }
  private activity = 0.8;
  setDemandMap(m: Record<string, number>) { this.demand = m; this.demandGrid = null; }
  private demand: Record<string, number> = {};
  private demandGrid: Map<string, number> | null = null;
  /** Demand (0-1) near a point, from the lots' scores averaged on an 80 m grid. */
  private demandAt(x: number, y: number): number {
    if (!this.demandGrid) {
      const sum = new Map<string, [number, number]>();
      for (const [bbl, ringLL] of Object.entries(this.lotRingLL)) {
        const sc = this.demand[bbl];
        if (sc === undefined || !ringLL.length) continue;
        let cx = 0, cy = 0;
        for (const q of ringLL) { const [px, py] = this.project(q); cx += px; cy += py; }
        cx /= ringLL.length; cy /= ringLL.length;
        const key = `${Math.floor(cx / 80)},${Math.floor(cy / 80)}`;
        const r = sum.get(key) ?? [0, 0]; r[0] += sc; r[1]++; sum.set(key, r);
      }
      this.demandGrid = new Map([...sum].map(([k, [a, n]]) => [k, a / n / 100]));
    }
    const gx = Math.floor(x / 80), gy = Math.floor(y / 80);
    let acc = 0, n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const v = this.demandGrid.get(`${gx + i},${gy + j}`); if (v !== undefined) { acc += v; n++; } }
    return n ? acc / n : 0.5;
  }
  private applyCrowd() {
    for (const f of this.fleets) {
      if (f.list === this.boats) continue;
      for (const m of f.list) if (m.dem === undefined) m.dem = this.demandAt(m.x, m.y);
      const on = (m: Mover) => (m.draw ?? 0) < this.activity * (0.3 + 0.9 * (m.dem ?? 0.5)) * this.crowdK;
      // the walkers on the street first, so the mesh can simply draw a prefix
      f.list.sort((p, q) => Number(on(q)) - Number(on(p)));
      f.list.forEach((m, i) => f.mesh.setColorAt(i, new THREE.Color(m.col[0], m.col[1], m.col[2])));
      if (f.mesh.instanceColor) f.mesh.instanceColor.needsUpdate = true;
      f.mesh.count = f.list.filter(on).length;
    }
    this.stepTraffic(performance.now() / 1000);
    this.map?.triggerRepaint();
  }
  setPreferFps(on: boolean) {
    this.preferFps = on;
    const sz = on ? 2048 : 4096;
    if (this.sun.shadow.mapSize.x !== sz) {
      this.sun.shadow.mapSize.set(sz, sz);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
      this.shadowSpan = 0;
    }
  }
  /**
   * Graphics quality. High is everything; Medium halves the shadow map, thins
   * the crowds and stops drawing street furniture sooner; Low also drops cast
   * shadows and the falling rain and snow. Looks only — nothing here reads the
   * game state, and the city underneath is the same city.
   */
  setQuality(q: "low" | "medium" | "high") {
    this.quality = q;
    this.setPreferFps(q !== "high");
    this.crowdK = q === "high" ? 1 : q === "medium" ? 0.6 : 0.3;
    this.cullM = q === "high" ? 2600 : q === "medium" ? 1800 : 1100;
    this.sun.castShadow = q !== "low";
    if (this.catcher) this.catcher.visible = q !== "low";
    if (this.precip) this.precip.visible = q !== "low";
    if (this.fleets.length) this.applyCrowd();
    this.map?.triggerRepaint();
  }
  setPaused(on: boolean) { this.paused = on; if (!on) this.map?.triggerRepaint(); }
  setOpacity(o: number) {
    this.visibleOn = o > 0.01;
    this.map?.triggerRepaint();
  }
}
