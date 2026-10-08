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
import { TILE, TOWER_FAMS, FAMILY_SPECS, VARIANTS, TINTS, familyFor, roofTone, shade, pick, liveryFor, GLASSY, WALKUP, TANK_FAMS, STONE_TOWER, RUSTIC_BASE, BAY_P, QUOIN_P, styleOf, type ArchStyle, NO_PAINT, type FamilySpec, type Livery } from "./facades";
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

/** Props too small to read from far off; Low and Medium drop the garden-scale ones too. */
const FAR_PROPS = ["lamp", "car", "lotcar", "suv", "lotsuv", "van", "taxi"];
/** taxi yellow and transit-authority blue-white: the two vehicle colours that are a fact, not a draw */
const TAXI = [0.95, 0.72, 0.12], BUS = [0.82, 0.84, 0.86];
/** Shop trades: canopy and fascia colours. Looks only. */
interface Trade { awn: number[]; sign: number[] }
const T = (awn: number[], sign: number[]): Trade => ({ awn, sign });
const CAFE = T([0.55, 0.13, 0.12], [0.14, 0.11, 0.09]), GROCER = T([0.18, 0.42, 0.22], [0.94, 0.92, 0.85]);
const BANK = T([0.12, 0.18, 0.35], [0.80, 0.70, 0.42]), APPAREL = T([0.08, 0.08, 0.09], [0.92, 0.92, 0.90]);
const PHARMACY = T([0.90, 0.90, 0.87], [0.10, 0.52, 0.34]), DINER = T([0.42, 0.12, 0.22], [0.86, 0.72, 0.40]);
const HARDWARE = T([0.78, 0.44, 0.12], [0.16, 0.16, 0.16]), BAKERY = T([0.86, 0.76, 0.48], [0.38, 0.22, 0.12]);
const SHOP_TRADES_UPTOWN = [BANK, BANK, APPAREL, APPAREL, CAFE, PHARMACY, DINER];
const SHOP_TRADES_STREET = [CAFE, GROCER, GROCER, PHARMACY, DINER, HARDWARE, BAKERY, APPAREL];
const FAR_PROPS_LOW = [...FAR_PROPS, "hedge", "fence", "railing", "bench", "parkhedge", "awning", "shopsign", "boards", "stoop", "dock", "hydrant", "bin", "shelter", "sigpost", "door", "marquee", "entcanopy", "dish", "solar", "pile", "bulk", "hvac", "tank", "skyl"];

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
export function skyEnvironment(): THREE.Scene {
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

const WINDOW_VARIATION = `
float winM = texelRoughness.r;
vec2 bayC = vMapUv * 2.0;
vec2 cellC = floor(bayC);
float wh1 = fract(sin(dot(cellC + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
float wh2 = fract(wh1 * 17.31 + 0.137);
vec2 fC = fract(bayC);
float tW = clamp((fC.y - (1.0 - uWin.w)) / max(uWin.w - uWin.z, 0.01), 0.0, 1.0);
float xW = clamp((fC.x - uWin.x) / max(uWin.y - uWin.x, 0.01), 0.0, 1.0);
float blindK = step(wh1, 0.3) * step(1.0 - tW, 0.2 + 0.7 * wh2);
float curtK = step(0.3, wh1) * step(wh1, 0.46) * (step(xW, 0.24 + 0.12 * wh2) + step(0.76 - 0.12 * wh2, xW));
// a curtain wall is one tinted, mirrored sheet: in daylight the blinds and
// rooms behind it do not show, so its panes do not vary (uGlassy)
blindK *= 1.0 - uGlassy; curtK *= 1.0 - uGlassy;
float winShade = clamp(blindK + curtK, 0.0, 1.0);
vec3 blindCol = mix(vec3(0.74, 0.7, 0.62), vec3(0.58, 0.57, 0.55), wh2);
vec3 curtCol = mix(vec3(0.62, 0.5, 0.42), vec3(0.5, 0.52, 0.5), wh2);
vec3 paneCol = diffuseColor.rgb * (1.0 + (wh2 - 0.5) * mix(0.36, 0.03, uGlassy));
paneCol = mix(paneCol, blindCol * 0.42, blindK);
paneCol = mix(paneCol, curtCol * 0.4, curtK * (1.0 - blindK));
diffuseColor.rgb = mix(diffuseColor.rgb, paneCol, winM * (1.0 - farK * 0.7));
roughnessFactor = mix(roughnessFactor, mix(clamp(roughnessFactor + (wh2 - 0.5) * mix(0.14, 0.01, uGlassy), 0.02, 1.0), 0.85, winShade), winM);
`;

/**
 * THE PAINT. A facade texture is drawn once per elevation, but a city's
 * buildings are not turned out in one colour: the same Italianate walk-up
 * stands in raw brick, painted cream, or painted black with white trim, its
 * sash and shutters green on one house and oxblood on the next. The
 * elevation's paint mask marks what can be painted — the wall field, the
 * trim (lintels, sills, voussoirs, quoins), and the accent (frames, sash,
 * shutters, spandrels, cast iron) — and three per-vertex colours carry one
 * building's scheme (liveryFor). The wall keeps the texture's light and
 * shade (mortar joints still read through paint); trim and accent take the
 * colour outright. A building with no scheme draws exactly the texture.
 */
const PAINT_FRAG = `
vec4 mskT = texture2D(emissiveMap, vEmissiveMapUv);
float paneP = texture2D(roughnessMap, vRoughnessMapUv).r;
float lumA = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float wallP = (1.0 - paneP) * (1.0 - mskT.g) * (1.0 - mskT.b) * vPaint.a;
diffuseColor.rgb = mix(diffuseColor.rgb, vPaint.rgb * clamp(lumA / uWallLum, 0.55, 1.5), wallP);
float trimP = mskT.g * (1.0 - paneP) * step(0.0, vTrimC.r);
diffuseColor.rgb = mix(diffuseColor.rgb, vTrimC * clamp(0.75 + 0.5 * lumA / max(uTrimLum, 0.02), 0.85, 1.15), trimP);
float accP = mskT.b * step(0.0, vAccC.r);
diffuseColor.rgb = mix(diffuseColor.rgb, vAccC * clamp(0.75 + 0.5 * lumA / max(uAccLum, 0.02), 0.8, 1.2), accP);
`;
const MASK_TRIM = "rgb(0,255,0)", MASK_ACC = "rgb(0,0,255)";
/** sRGB 0-255 → linear luminance, for the paint's light-and-shade ratio. */
function linLum(r: number, g: number, b: number) {
  const L = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * L(r) + 0.7152 * L(g) + 0.0722 * L(b);
}
/** Mean linear luminance of the canvas pixels the mask channel selects (or all, ch < 0). */
function meanLum(alb: CanvasRenderingContext2D, msk: CanvasRenderingContext2D | null, ch: number, W: number, H: number): number {
  const a = alb.getImageData(0, 0, W, H).data, m = msk ? msk.getImageData(0, 0, W, H).data : null;
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 16) {
    if (m && ch >= 0 && m[i + ch] < 128) continue;
    s += linLum(a[i], a[i + 1], a[i + 2]); n++;
  }
  return n ? s / n : 0.3;
}

function buildFamily(spec: FamilySpec, seed: number): Family {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // a 2 x 2 tile — two bays by two floors — so neighbouring windows differ
  const W = TILE * 2, H = TILE * 2;
  const alb = makeCanvas(W, H), orm = makeCanvas(W, H), hgt = makeCanvas(W, H), msk = makeCanvas(W, H);
  orm.g.fillStyle = `rgb(0,${Math.round(spec.wallRough * 255)},0)`; orm.g.fillRect(0, 0, W, H);
  hgt.g.fillStyle = "#ffffff"; hgt.g.fillRect(0, 0, W, H);
  // a curtain wall, or any non-masonry tower, reads as one sheet of tinted glass in daylight
  const fk0 = spec.key.split("#")[0];
  const glassy = spec.glass || GLASSY.has(fk0) || (!spec.masonry && TOWER_FAMS.has(fk0));
  // the paint mask: R lit room after dark, G trim, B accent (see PAINT_FRAG)
  msk.g.fillStyle = "#000000"; msk.g.fillRect(0, 0, W, H);
  const pc = { m: msk.g, hg: hgt.g };
  spec.wall(alb.g, W, H, rnd, pc);
  const wallLum = meanLum(alb.g, null, -1, W, H);
  // both canvases at once: the colour, and the same shape in the mask
  const both = (col: string, mk: string, draw: (g: CanvasRenderingContext2D) => void) => {
    alb.g.fillStyle = col; draw(alb.g);
    msk.g.fillStyle = mk; draw(msk.g);
  };
  const style = spec.winStyle ?? "rect";
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2 && !spec.noWin; bx++) {
    // canvas y runs down; v runs up — the tile is drawn upside down so the
    // sill sits at the bottom of the floor in world space
    const ox = bx * TILE, oy = by * TILE;
    // a staggered elevation slides each window along its bay, never out of it
    const jit = spec.winJitter ? [-1, 0.6, 0.3, -0.8][bx + 2 * by] * spec.winJitter : 0;
    const jx = Math.max(-spec.win.x0 + 0.03, Math.min(1 - spec.win.x1 - 0.03, jit)) * TILE;
    const x0 = ox + spec.win.x0 * TILE + jx, x1 = ox + spec.win.x1 * TILE + jx;
    const y0 = oy + (1 - spec.win.y1) * TILE, y1 = oy + (1 - spec.win.y0) * TILE;
    const ww = x1 - x0, wh = y1 - y0;
    // the openings in this bay: one; a pair split by a narrow pier; or the
    // Chicago window — a wide fixed light between two narrow sashes
    const ops: [number, number][] = style === "pair" ? [[x0, x0 + ww * 0.44], [x1 - ww * 0.44, x1]]
      : style === "chicago" ? [[x0, x0 + ww * 0.22], [x0 + ww * 0.26, x1 - ww * 0.26], [x1 - ww * 0.22, x1]]
      : style === "triple" ? [[x0, x0 + ww * 0.3], [x0 + ww * 0.35, x1 - ww * 0.35], [x1 - ww * 0.3, x1]] : [[x0, x1]];
    // the head of each opening: square, a full round arch, a shallow
    // segment, or a Gothic point
    const rise = (a: number, b: number) => style === "arch" ? (b - a) / 2 : style === "segment" ? (b - a) * 0.18 : style === "pointed" ? (b - a) * 0.8 : 0;
    const shape = (g: CanvasRenderingContext2D, a: number, b: number, inset = 0) => {
      const r = rise(a, b), ya = y0 + inset, yb = y1 - inset, xa = a + inset, xb = b - inset;
      g.beginPath();
      if (r > 0) {
        const cx = (xa + xb) / 2, half = (xb - xa) / 2;
        g.moveTo(xa, yb); g.lineTo(xa, ya + r);
        if (style === "arch") g.arc(cx, ya + r, half, Math.PI, 0);
        else if (style === "pointed") { g.quadraticCurveTo(xa, ya + r * 0.25, cx, ya); g.quadraticCurveTo(xb, ya + r * 0.25, xb, ya + r); }
        else g.quadraticCurveTo(cx, ya - r * 0.9, xb, ya + r);
        g.lineTo(xb, yb); g.closePath();
      } else g.rect(xa, ya, xb - xa, yb - ya);
    };
    if (spec.shutter) {
      const sw = ww * 0.32;
      both(spec.shutter, MASK_ACC, (g) => { g.fillRect(x0 - sw - 2, y0, sw, wh); g.fillRect(x1 + 2, y0, sw, wh); });
      alb.g.fillStyle = "rgba(0,0,0,0.18)";
      for (let yy = y0 + 4; yy < y1; yy += 6) { alb.g.fillRect(x0 - sw - 2, yy, sw, 1.5); alb.g.fillRect(x1 + 2, yy, sw, 1.5); }
    }
    if (spec.trim) {
      const lt = spec.lintel ?? "flat";
      for (const [a, b] of ops) both(spec.trim, MASK_TRIM, (g) => {
        if (style === "arch" || style === "segment" || style === "pointed") {
          // a ring of voussoirs round the head, keyed at the crown
          g.save(); shape(g, a - 5, b + 5); g.fill(); g.restore();
        } else if (lt === "flat") g.fillRect(a - 4, y0 - 9, b - a + 8, 9);
        else if (lt === "keystone") {
          // a flat arch of splayed voussoirs with a keystone proud of it
          g.beginPath(); g.moveTo(a - 7, y0 - 12); g.lineTo(b + 7, y0 - 12); g.lineTo(b + 2, y0); g.lineTo(a - 2, y0); g.closePath(); g.fill();
          g.fillRect((a + b) / 2 - 5, y0 - 16, 10, 17);
        } else if (lt === "hood") {
          // a projecting hood moulding on brackets: the Italianate window head
          g.fillRect(a - 8, y0 - 13, b - a + 16, 7); g.fillRect(a - 5, y0 - 6, b - a + 10, 4);
          g.fillRect(a - 8, y0 - 13, 5, 16); g.fillRect(b + 3, y0 - 13, 5, 16);
        }
        if (lt === "pediment") {
          g.beginPath(); g.moveTo(a - 7, y0 - 4); g.lineTo((a + b) / 2, y0 - 20); g.lineTo(b + 7, y0 - 4); g.closePath(); g.fill();
        }
        g.fillRect(a - 3, y1, b - a + 6, 5);          // sill
      });
      if (lt === "keystone" || lt === "hood") for (const [a, b] of ops) { hgt.g.fillStyle = "#ffffff"; hgt.g.fillRect(a - 6, y0 - 14, b - a + 12, 3); }
    }
    // the glass: a vertical sky gradient with a per-pane brightness, so a
    // street of windows does not read as one sheet
    // (a curtain wall's panes are one sheet: no per-pane brightness)
    const k = glassy ? 0.85 : 0.85 + rnd() * 0.3;
    const grad = alb.g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, spec.glassCol); grad.addColorStop(1, shade(spec.glassCol, 0.62));
    const lit = rnd() < 0.55, lum = 0.55 + rnd() * 0.45;
    for (const [a, b] of ops) {
      alb.g.globalAlpha = 1; alb.g.fillStyle = grad; shape(alb.g, a, b); alb.g.fill();
      alb.g.fillStyle = `rgba(255,255,255,${(k - 0.85) * 0.25})`; alb.g.fill();
      msk.g.fillStyle = "#000000"; shape(msk.g, a, b); msk.g.fill();
      // frame and glazing bars, in the accent
      for (const g of [alb.g, msk.g]) {
        g.strokeStyle = g === alb.g ? spec.frameCol : MASK_ACC;
        g.lineWidth = 3; shape(g, a, b, 1); g.stroke();
        if (spec.mullions) {
          const w2 = b - a;
          g.lineWidth = 2;
          for (let i = 1; i < spec.mullions[0]; i++) { const x = a + (w2 * i) / spec.mullions[0]; g.beginPath(); g.moveTo(x, y0 + rise(a, b)); g.lineTo(x, y1); g.stroke(); }
          for (let i = 1; i < spec.mullions[1]; i++) { const y = y0 + (wh * i) / spec.mullions[1]; g.beginPath(); g.moveTo(a, y); g.lineTo(b, y); g.stroke(); }
        }
      }
      // red marks the pane, for the per-window variation in the shader
      orm.g.fillStyle = `rgb(255,${Math.round(spec.glassRough * 255)},${Math.round(spec.glassMetal * 255)})`;
      shape(orm.g, a, b, 2); orm.g.fill();
      // the reveal: glass sits back in the wall
      hgt.g.fillStyle = "#3a3a3a"; shape(hgt.g, a, b); hgt.g.fill();
      // after dark about half the rooms are lit, warm and uneven
      if (lit) { msk.g.fillStyle = `rgb(${255 * lum | 0},0,0)`; shape(msk.g, a, b, 3); msk.g.fill(); }
    }
  }
  // what stands in front of the glass: cast-iron columns, a diagrid, fins
  spec.over?.(alb.g, W, H, rnd, pc);
  const trimLum = spec.trim ? meanLum(alb.g, msk.g, 1, W, H) : 0.5;
  const accLum = meanLum(alb.g, msk.g, 2, W, H);
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
    roughness: 1, metalness: 1, emissiveMap: tex(msk.c, false), emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0, vertexColors: true,
    // the studio environment is for the glass to reflect; on matte walls its
    // diffuse share only washes them out
    envMapIntensity: spec.glassMetal > 0.5 ? 0.8 : 0.3,
  });
  // The window glow is the mask's red, shared by every building in the
  // family; the per-vertex `lit` scales it, so an empty building goes dark at
  // night and a full one blazes.
  const winU = new THREE.Vector4(spec.win.x0, spec.win.x1, spec.win.y0, spec.win.y1);
  const seedU = new THREE.Vector2((seed % 997) / 7.3, (seed % 613) / 5.1);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWin = { value: winU };
    sh.uniforms.uSeed = { value: seedU };
    sh.uniforms.uWallLum = { value: Math.max(0.01, wallLum) };
    sh.uniforms.uTrimLum = { value: trimLum };
    sh.uniforms.uAccLum = { value: accLum };
    sh.uniforms.uGlassy = { value: glassy ? 1 : 0 };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float lit;\nattribute float aoh;\nattribute vec4 paint;\nattribute vec3 trimc;\nattribute vec3 accent;\nvarying float vLit;\nvarying float vAoH;\nvarying vec4 vPaint;\nvarying vec3 vTrimC;\nvarying vec3 vAccC;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLit = lit;\nvGz = position.z;\nvAoH = aoh;\nvPaint = paint;\nvTrimC = trimc;\nvAccC = accent;")
      .replace("varying float vLit;", "varying float vLit;\nvarying float vGz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLit;\nvarying float vGz;\nvarying float vAoH;\nvarying vec4 vPaint;\nvarying vec3 vTrimC;\nvarying vec3 vAccC;\nuniform vec4 uWin;\nuniform vec2 uSeed;\nuniform float uWallLum, uTrimLum, uAccLum, uGlassy;")
      // the street darkens the foot of every wall: bounce light from the sky
      // is blocked by the pavement and the buildings across the way. How far
      // up it climbs is the street's own: a few metres on an open avenue,
      // most of the way up the lower floors in a canyon of towers (vAoH).
      // The first metre is darkest, where wall meets pavement.
      .replace("#include <color_fragment>", PAINT_FRAG + "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, max(vAoH, 1.0), vGz)) * mix(0.82, 1.0, smoothstep(0.0, 1.2, vGz));")
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance *= vec3(1.0, 0.745, 0.43) * mskT.r * vLit;")
      // FAR AWAY, CALM DOWN. Past a few hundred metres a window is a pixel,
      // and its relief and mirror-glass reflection alias into shimmering
      // stripes. Fade the normal map out and rough the glass up with
      // distance — what a camera sees of a far tower anyway.
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nfloat farK = smoothstep(320.0, 1300.0, length(vViewPosition));\nroughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.62), farK);\n" + WINDOW_VARIATION)
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - farK * 0.6;\nmetalnessFactor *= 1.0 - winShade * winM;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, farK));");
  };
  mat.customProgramCacheKey = () => "bw-real-facade-lit-ao-far-win-paint";
  return { key: spec.key, bayW: spec.bayW, floorH: spec.floorH, mat, masonry: spec.masonry, glass: spec.glass };
}


/**
 * Every elevation in the pattern book, built on first use. The book holds
 * several hundred elevations and a town wears a fraction of them (a young
 * town has no curtain walls, an old one no mass timber), so an elevation's
 * canvases, textures and material are made the first time a building asks
 * for it, and only then cost memory on the GPU.
 */
function makeFamilies(seed: number, onBuild?: (f: Family) => void): Record<string, Family> {
  const specs = new Map<string, () => Family>();
  FAMILY_SPECS.forEach((f, i) => {
    specs.set(f.key, () => buildFamily(f, (seed * 31 + i * 977) % 2147483646 + 1));
    // the family's other elevations, keyed "brick#1", "brick#2"...
    (VARIANTS[f.key] ?? []).forEach((v, j) => {
      const key = `${f.key}#${j + 1}`;
      specs.set(key, () => ({ ...buildFamily({ ...f, ...v, key }, (seed * 31 + i * 977 + (j + 1) * 7919) % 2147483646 + 1), key: f.key }));
    });
  });
  const built: Record<string, Family> = {};
  return new Proxy(built, {
    get(t, k) {
      if (typeof k !== "string") return undefined;
      let f = t[k];
      if (!f) { const mk = specs.get(k); if (!mk) return undefined; f = t[k] = mk(); onBuild?.(f); }
      return f;
    },
    has: (_t, k) => typeof k === "string" && specs.has(k),
  });
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
  { key: "blackglass", name: "Dark tower", era: "1958-1975", maxFloors: 99, variants: ["Bronze I-beams", "Jet", "Green-black", "Blue-black"] },
  { key: "greenglass", name: "Emerald glass", era: "1985-today", maxFloors: 99, variants: ["Emerald", "Aqua", "Sea green", "Deep green"] },
  { key: "silverglass", name: "Mirror glass", era: "1980-today", maxFloors: 99, variants: ["Silver", "Steel", "Champagne", "Ice blue"] },
  { key: "fins", name: "Vertical fins", era: "2000-today", maxFloors: 99, variants: ["Aluminium fins", "Black fins", "Bronze fins", "White fins"] },
  { key: "precast", name: "White precast", era: "1975-2000", maxFloors: 60, variants: ["White", "Sand", "Rose", "Grey, paired"] },
  { key: "pomo", name: "Postmodern granite", era: "1982-1998", maxFloors: 80, variants: ["Rose granite", "Green granite", "Red, arched", "Beige"] },
  { key: "castiron", name: "Cast iron", era: "1850-1890", maxFloors: 8, variants: ["Cream, segmental", "White, arched", "Verdigris grey", "Tan, square-headed"] },
  { key: "gothic", name: "Victorian Gothic", era: "1860-1895", maxFloors: 8, variants: ["Red, banded", "Cream bands", "Dark red, round", "Buff and red"] },
  { key: "romanesque", name: "Romanesque", era: "1880-1900", maxFloors: 12, variants: ["Red sandstone", "Brown, paired", "Granite", "Buff"] },
  { key: "terracotta", name: "Glazed terra cotta", era: "1890-1930", maxFloors: 60, variants: ["White", "Cream", "Grey-white", "Buff and orange"] },
  { key: "daylight", name: "Daylight factory", era: "1905-1935", maxFloors: 10, variants: ["Concrete, green sash", "Grey, dark sash", "Buff, red sash", "Fine sash"] },
  { key: "georgian", name: "Colonial Revival", era: "1900-1945", maxFloors: 16, variants: ["Flemish bond, keystones", "Shuttered", "Light, flat lintels", "Dark, arched"] },
  { key: "tudor", name: "Tudor Revival", era: "1915-1935", maxFloors: 4, variants: ["Dark timbers", "Tan stucco", "Black and white", "Brown timbers"] },
  { key: "stucco", name: "Spanish Revival", era: "1915-today", maxFloors: 6, variants: ["Cream", "Sand, arched", "White, shuttered", "Tan, paired"] },
  { key: "moderne", name: "Streamline Moderne", era: "1933-1950", maxFloors: 10, variants: ["Cream", "White", "Pink", "Mint"] },
  { key: "whitebrick", name: "White brick", era: "1945-1970", maxFloors: 30, variants: ["Glazed white", "Grey", "Cream", "Greige, wide"] },
  { key: "midcentury", name: "Enamel panel", era: "1950-1972", maxFloors: 12, variants: ["Turquoise", "Orange", "Blue", "Yellow"] },
  { key: "brutalist", name: "Board-formed concrete", era: "1962-1980", maxFloors: 40, variants: ["Concrete", "Dark, small lights", "Warm", "Grey, tall lights"] },
  { key: "newstone", name: "New limestone", era: "2000-today", maxFloors: 70, variants: ["Limestone", "Keystoned", "Pale, paired", "Warm"] },
  { key: "fibercement", name: "Two-tone panel", era: "2003-today", maxFloors: 7, variants: ["White and charcoal", "Charcoal and wood", "Grey and blue", "White and rust"] },
  { key: "metalpanel", name: "Metal panel", era: "2005-today", maxFloors: 30, variants: ["Zinc", "Black", "Champagne", "Weathered bronze"] },
  { key: "stackbrick", name: "Stack-bond brick", era: "2008-today", maxFloors: 14, variants: ["Charcoal", "White", "Red", "Grey"] },
  { key: "rainscreen", name: "Terracotta rainscreen", era: "2010-today", maxFloors: 40, variants: ["Terracotta", "Buff", "Grey", "Orange"] },
  { key: "timber", name: "Mass timber", era: "2016-today", maxFloors: 18, variants: ["Cedar", "Light", "Dark", "Silvered"] },
  { key: "diagrid", name: "Diagrid", era: "2005-today", maxFloors: 99, variants: ["Blue, silver steel", "White steel", "Green, dark steel", "Silver"] },
  { key: "pixel", name: "Fritted glass", era: "2010-today", maxFloors: 99, variants: ["White frit", "Grey", "Charcoal", "Champagne"] },
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

/** Parts with fixed vertex colours, merged into one non-indexed geometry. */
function mergeColored(parts: [THREE.BufferGeometry, number[]][]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  for (const [g0, c] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const P = g.getAttribute("position").array as Float32Array, N = g.getAttribute("normal").array as Float32Array;
    for (let i = 0; i < P.length; i += 3) { pos.push(P[i], P[i + 1], P[i + 2]); nrm.push(N[i], N[i + 1], N[i + 2]); col.push(c[0], c[1], c[2]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}
/** A side profile (x along the car, z up) extruded across its width w, centred. */
function profile(pts: [number, number][], w: number): THREE.BufferGeometry {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  return new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, w / 2, 0);
}
const PAINT = [1, 1, 1], GLASS = [0.07, 0.08, 0.1], TYRE = [0.04, 0.04, 0.04], HEAD = [2.2, 2.2, 2.0], TAIL = [1.6, 0.12, 0.1], TRIMC = [0.12, 0.12, 0.13];
function vehicle(kind: "sedan" | "suv" | "van" | "taxi" | "bus"): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, number[]][] = [];
  const wheel = (x: number, y: number, r: number) => parts.push([new THREE.CylinderGeometry(r, r, 0.24, 8).translate(x, y, r), TYRE]);
  const box = (w: number, d: number, h: number, x: number, y: number, z: number, c: number[]) => parts.push([new THREE.BoxGeometry(w, d, h).translate(x, y, z + h / 2), c]);
  if (kind === "sedan" || kind === "taxi") {
    const L = 2.3;
    parts.push([profile([[-L, 0.3], [L, 0.3], [L, 0.72], [L - 0.15, 0.82], [1.15, 0.92], [-1.55, 0.95], [-L + 0.05, 0.86], [-L, 0.72]], 1.78), PAINT]);
    parts.push([profile([[1.15, 0.92], [0.45, 1.38], [-0.95, 1.4], [-1.6, 0.95]], 1.6), GLASS]);
    box(1.3, 1.46, 0.06, -0.25, 0, 1.36, PAINT);
    for (const x of [1.45, -1.4]) for (const y of [-0.8, 0.8]) wheel(x, y, 0.32);
    box(0.06, 0.4, 0.14, L + 0.02, -0.6, 0.62, HEAD); box(0.06, 0.4, 0.14, L + 0.02, 0.6, 0.62, HEAD);
    box(0.06, 0.36, 0.12, -L - 0.02, -0.62, 0.66, TAIL); box(0.06, 0.36, 0.12, -L - 0.02, 0.62, 0.66, TAIL);
    box(0.1, 1.8, 0.12, L - 0.02, 0, 0.36, TRIMC); box(0.1, 1.8, 0.12, -L + 0.02, 0, 0.36, TRIMC);
    if (kind === "taxi") box(0.5, 0.24, 0.2, -0.25, 0, 1.42, [1.1, 1.1, 1.0]);
  } else if (kind === "suv") {
    const L = 2.4;
    parts.push([profile([[-L, 0.38], [L, 0.38], [L, 0.95], [1.5, 1.08], [-L, 1.12]], 1.9), PAINT]);
    parts.push([profile([[1.5, 1.08], [0.9, 1.68], [-L + 0.15, 1.7], [-L, 1.12]], 1.76), GLASS]);
    box(3.0, 1.8, 0.07, -0.75, 0, 1.68, PAINT);
    for (const x of [1.55, -1.5]) for (const y of [-0.85, 0.85]) wheel(x, y, 0.38);
    box(0.06, 0.42, 0.16, L + 0.02, -0.62, 0.82, HEAD); box(0.06, 0.42, 0.16, L + 0.02, 0.62, 0.82, HEAD);
    box(0.06, 0.2, 0.36, -L - 0.02, -0.78, 0.8, TAIL); box(0.06, 0.2, 0.36, -L - 0.02, 0.78, 0.8, TAIL);
    box(0.12, 1.92, 0.2, L - 0.02, 0, 0.42, TRIMC);
  } else if (kind === "van") {
    const L = 2.6;
    parts.push([profile([[-L, 0.35], [L, 0.35], [L, 1.0], [1.9, 1.25], [1.5, 2.3], [-L, 2.3]], 2.0), PAINT]);
    parts.push([profile([[1.86, 1.3], [1.52, 2.12], [1.0, 2.12], [1.0, 1.3]], 2.02), GLASS]);
    for (const x of [1.75, -1.7]) for (const y of [-0.9, 0.9]) wheel(x, y, 0.36);
    box(0.06, 0.4, 0.16, L + 0.02, -0.66, 0.85, HEAD); box(0.06, 0.4, 0.16, L + 0.02, 0.66, 0.85, HEAD);
    box(0.06, 0.18, 0.4, -L - 0.02, -0.86, 0.9, TAIL); box(0.06, 0.18, 0.4, -L - 0.02, 0.86, 0.9, TAIL);
  } else {
    // the city bus: a long box on small wheels, a band of glass down each side
    const L = 6;
    box(12, 2.55, 2.75, 0, 0, 0.35, PAINT);
    box(10.2, 2.57, 1.05, -0.6, 0, 1.6, GLASS);
    box(0.06, 2.3, 1.5, L + 0.01, 0, 1.25, GLASS);
    box(3, 2.2, 0.3, -2, 0, 3.1, [0.75, 0.75, 0.75]);
    for (const x of [4.3, -3.3]) for (const y of [-1.05, 1.05]) wheel(x, y, 0.5);
    box(0.06, 0.4, 0.2, L + 0.03, -0.9, 0.7, HEAD); box(0.06, 0.4, 0.2, L + 0.03, 0.9, 0.7, HEAD);
  }
  return mergeColored(parts);
}
function person(): THREE.BufferGeometry {
  const SKIN = [0.62, 0.48, 0.4], HAIR = [0.22, 0.2, 0.2], LEG = [0.32, 0.33, 0.36], SHOE = [0.12, 0.12, 0.12];
  const b = (w: number, d: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, d, h).translate(x, y, z + h / 2);
  return mergeColored([
    [b(0.13, 0.15, 0.82, 0, -0.09, 0.06), LEG], [b(0.13, 0.15, 0.82, 0, 0.09, 0.06), LEG],
    [b(0.24, 0.13, 0.07, 0.04, -0.09, 0), SHOE], [b(0.24, 0.13, 0.07, 0.04, 0.09, 0), SHOE],
    [b(0.24, 0.42, 0.62, 0, 0, 0.86), PAINT],
    [b(0.11, 0.1, 0.6, 0, -0.27, 0.86), PAINT], [b(0.11, 0.1, 0.6, 0, 0.27, 0.86), PAINT],
    [b(0.08, 0.12, 0.1, 0, 0, 1.48), SKIN],
    [new THREE.SphereGeometry(0.11, 10, 8).translate(0, 0, 1.64), SKIN],
    [new THREE.SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0, 1.65), HAIR],
  ]);
}

/** Cut (or round) each convex corner of a counter-clockwise ring by frac of its shorter edge, at most maxM metres. */
function chamferRing(r: P2[], frac: number, maxM: number, round: boolean): P2[] {
  const n = r.length, out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n], c = r[i], q = r[(i + 1) % n];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cross <= 0 || l1 < 1 || l2 < 1) { out.push(c); continue; }
    const d = Math.min(maxM, frac * Math.min(l1, l2));
    const a: P2 = [c[0] - ((c[0] - p[0]) / l1) * d, c[1] - ((c[1] - p[1]) / l1) * d];
    const b: P2 = [c[0] + ((q[0] - c[0]) / l2) * d, c[1] + ((q[1] - c[1]) / l2) * d];
    if (!round) { out.push(a, b); continue; }
    // a quadratic curve from a to b with the corner as its control point
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  }
  return out;
}
/** A square re-entrant notch d metres into each convex corner of a counter-clockwise ring. */
function notchRing(r: P2[], d: number): P2[] {
  const n = r.length, out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n], c = r[i], q = r[(i + 1) % n];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cross <= 0 || l1 < d * 3 || l2 < d * 3) { out.push(c); continue; }
    const u1: P2 = [(c[0] - p[0]) / l1, (c[1] - p[1]) / l1], u2: P2 = [(q[0] - c[0]) / l2, (q[1] - c[1]) / l2];
    const a: P2 = [c[0] - u1[0] * d, c[1] - u1[1] * d];
    out.push(a, [a[0] + u2[0] * d, a[1] + u2[1] * d], [c[0] + u2[0] * d, c[1] + u2[1] * d]);
  }
  return out;
}

/** Polygons (with optional holes) in a coarse grid, for point-in-polygon queries. */
class PolyGrid {
  private g = new Map<number, { r: P2[]; h: P2[][]; x0: number; y0: number; x1: number; y1: number }[]>();
  constructor(private C: number) {}
  add(r: P2[], h: P2[][] = []) {
    if (r.length < 3) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const e = { r, h, x0, y0, x1, y1 }, C = this.C;
    for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++)
      for (let cy = Math.floor(y0 / C); cy <= Math.floor(y1 / C); cy++) {
        const k = cx * 100003 + cy;
        let a = this.g.get(k); if (!a) this.g.set(k, (a = [])); a.push(e);
      }
  }
  hit(x: number, y: number): boolean {
    const cell = this.g.get(Math.floor(x / this.C) * 100003 + Math.floor(y / this.C));
    if (!cell) return false;
    for (const e of cell) {
      if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) continue;
      if (PolyGrid.inRing(e.r, x, y) && !e.h.some((h) => PolyGrid.inRing(h, x, y))) return true;
    }
    return false;
  }
  static inRing(r: P2[], x: number, y: number) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) inside = !inside;
    }
    return inside;
  }
}

class Buf {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; ao: number[] = [];
  pt: number[] = []; tc: number[] = []; ac: number[] = [];
  /** how high (m) the street's shade climbs the walls written next (see the facade shader) */
  aoH = 3.5;
  /** the paint scheme of the walls written next (PAINT_FRAG): wall rgb + amount, trim, accent (r < 0: as drawn) */
  paint: number[] = NO_PAINT.wall; trimc: number[] = NO_PAINT.trim; accent: number[] = NO_PAINT.accent;
  get count() { return this.pos.length / 3; }
  private v(p: number[], n: number[], t: number[], col: number[]) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(t[0], t[1]); this.col.push(col[0], col[1], col[2]); this.ao.push(this.aoH);
    const w = this.paint, tc = this.trimc, ac = this.accent;
    this.pt.push(w[0], w[1], w[2], w[3]); this.tc.push(tc[0], tc[1], tc[2]); this.ac.push(ac[0], ac[1], ac[2]);
  }
  /** Write with this scheme, then put the plain one back. */
  painted(l: Livery | null, f: () => void) {
    if (!l) { f(); return; }
    this.paint = l.wall; this.trimc = l.trim; this.accent = l.accent;
    try { f(); } finally { this.paint = NO_PAINT.wall; this.trimc = NO_PAINT.trim; this.accent = NO_PAINT.accent; }
  }
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][], col: number[]) {
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]] as [number[], number[]][]) this.v(p, n, t, col);
  }
  tri(a: number[], b: number[], c: number[], n: number[], col: number[]) {
    for (const p of [a, b, c]) this.v(p, n, [p[0] * 0.25, p[1] * 0.25], col);
  }
  /** A planar polygon (fan), wound so its normal leans toward `want`. */
  face(pts: number[][], want: number[], col: number[], uvOf: (p: number[]) => number[] = (p) => [p[0] * 0.25, p[1] * 0.25]) {
    const ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1], uz = pts[1][2] - pts[0][2];
    const vx = pts[2][0] - pts[0][0], vy = pts[2][1] - pts[0][1], vz = pts[2][2] - pts[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    for (let i = 1; i + 1 < pts.length; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) this.v(p, [nx, ny, nz], uvOf(p), col);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aoh", new THREE.Float32BufferAttribute(this.ao.length === this.count ? this.ao : new Array(this.count).fill(3.5), 1));
    // the paint scheme rides only on walls; a buffer filled by hand (ground,
    // water) carries none, and gets the plain one at every vertex
    const n = this.count, fill = (a: number[], d: number[]) => a.length === n * d.length ? a : Array.from({ length: n }, () => d).flat();
    g.setAttribute("paint", new THREE.Float32BufferAttribute(fill(this.pt, NO_PAINT.wall), 4));
    g.setAttribute("trimc", new THREE.Float32BufferAttribute(fill(this.tc, NO_PAINT.trim), 3));
    g.setAttribute("accent", new THREE.Float32BufferAttribute(fill(this.ac, NO_PAINT.accent), 3));
    // how many of this building's rooms are lit after dark (see setOccupancy)
    g.setAttribute("lit", new THREE.Float32BufferAttribute(new Float32Array(this.count).fill(1), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** A roof colour from sRGB hex, as the roof material's vertex colour (its own grey divided out). */
const ROOF_LIN = (() => { const c = new THREE.Color(0x6b6862); return [c.r, c.g, c.b]; })();
function roofLin(hex: string): number[] { const c = new THREE.Color(hex); return [c.r / ROOF_LIN[0], c.g / ROOF_LIN[1], c.b / ROOF_LIN[2]]; }
/** The trim material's own colour, linear — a painted cornice's vertex colour divides it out. */
const TRIM_LIN = (() => { const c = new THREE.Color(0xd8d0be); return [c.r, c.g, c.b]; })();

/** A scheme built as a model for the Build desk's viewer (RealCityLayer.schemeModel). Metres, lot-centred, z up. */
export interface SchemeModel {
  group: THREE.Group; height: number; lot: P2[]; neighbours: { ring: P2[]; h: number }[];
  sun: { dir: THREE.Vector3; color: THREE.Color; intensity: number };
  sky: { sky: THREE.Color; ground: THREE.Color; intensity: number };
}
/** The city layer on the map now, for the Build desk's viewer (null when no map is up). */
export let activeCity: RealCityLayer | null = null;

interface Mover { x: number; y: number; ux: number; uy: number; len: number; ph: number; spd: number; col: number[]; draw?: number; dem?: number; kind?: string }
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
    _curbs: [number, number][][],   // street centre lines: furniture now reads the drawn footways instead
    private ctx: Ctx,
    private seed: number,
  ) {
    this.lotRingLL = (ctx as { lots?: Record<string, P2[]> }).lots ?? {};
  }

  /** Every deed with a building drawn (MapView walks its keys to push state). */
  get rangesByBBL(): Map<string, unknown> { return this.deeds; }

  // ---- MapLibre custom layer --------------------------------------------
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    activeCity = this;
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
    this.families = makeFamilies(this.seed || 1, (f) => { if (f.glass || f.key === "ribbon") f.mat.envMap = this.skyEnv; });
    this.setupLights();
    this.buildCity();
    this.pickGrid = null;   // shop bays indexed the lots mid-build; heights are final now
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
    if (activeCity === this) activeCity = null;
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
   * A LONG BLOCK IS A ROW OF BUILDINGS. A frontage of 80 m and more on one
   * deed was drawn as one prism in one elevation, which from the air is a
   * quarter-mile of identical windows. In life that frontage is a run of
   * separate houses or lofts built at different times: each 18-40 m piece
   * here takes its own elevation, paint and parapet height from the
   * district's palette. Same deed, same footprint and roughly the same
   * height; looks only. Returns false (and draws nothing) when the volume
   * is not a long four-sided block.
   */
  private rowOf(ring0: P2[], v: BuildingVolume, fam: string, k: number, shop: boolean, tall = false): boolean {
    // drop the in-line vertices a long frontage collects, then it must be four-sided
    const ring = ring0.filter((c, i) => {
      const p = ring0[(i + ring0.length - 1) % ring0.length], q = ring0[(i + 1) % ring0.length];
      const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(q[0] - c[0], q[1] - c[1]);
      const cr = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
      return l1 > 0.3 && l2 > 0.3 && Math.abs(cr) / (l1 * l2) > 0.03;
    });
    if (ring.length < 4) return false;
    // the long axis: the direction of the ring's longest side
    let li = 0, lmax = -1;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > lmax) { lmax = L; li = i; } }
    const ux = (ring[(li + 1) % ring.length][0] - ring[li][0]) / lmax, uy = (ring[(li + 1) % ring.length][1] - ring[li][1]) / lmax;
    let t0 = Infinity, t1 = -Infinity;
    for (const [x, y] of ring) { const t = x * ux + y * uy; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const ll = t1 - t0;
    // a tall block only when it is absurdly long: a 600 m slab is a row of towers
    if (ll < (tall ? 160 : 80)) return false;
    // one slice of the ring between two cuts across the long axis (Sutherland-Hodgman, two half-planes)
    const clip = (r: P2[], t: number, keepAbove: boolean): P2[] => {
      const out: P2[] = [];
      const side = (p: P2) => (p[0] * ux + p[1] * uy - t) * (keepAbove ? 1 : -1);
      for (let i = 0; i < r.length; i++) {
        const p = r[i], q = r[(i + 1) % r.length], sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) { const f = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
      }
      return out;
    };
    const cuts = [0];
    let at = 0, i = 0;
    const step = tall ? 32 : 18, spread = tall ? 26 : 22;
    while (at < ll - step) { at += step + spread * hash01(k ^ (0x9e1 + i++), this.seed); cuts.push(Math.min(1, at / ll)); }
    if (cuts[cuts.length - 1] < 1) cuts[cuts.length - 1] = 1;
    const fh = this.families[fam]?.floorH ?? 3.4;
    for (let j = 0; j + 1 < cuts.length; j++) {
      const kj = (k * 31 + j * 7919) >>> 0;
      // a row of towers stands apart: an 8 m slot between neighbours, so a
      // 600 m frontage reads as towers along a street, not one wall
      const gap = tall ? 4 : 0;
      const r = clip(clip(ring, t0 + cuts[j] * ll + gap, true), t0 + cuts[j + 1] * ll - gap, false);
      if (r.length < 3 || Math.abs(ringArea(r)) < 20) continue;
      const f2 = familyFor(v.c, v.y || 1950, v.z1, hash01(kj ^ 0x3c1f, this.seed), v.t ?? 4, this.nbOf(r));
      const fk = f2 === "industrial" || f2 === "daylight" || (!tall && TOWER_FAMS.has(f2)) ? fam : f2;
      const tints = TINTS[fk] ?? [[1, 1, 1]];
      const tn = tints[Math.floor(hash01(kj, this.seed) * tints.length)];
      // a storey up or down now and then, never below two floors
      const dz = tall ? -(v.z1 - v.z0) * 0.55 * hash01(kj ^ 0x5f, this.seed)
        : hash01(kj ^ 0x5d, this.seed) < 0.35 ? (hash01(kj ^ 0x5e, this.seed) < 0.5 ? -fh : fh) : 0;
      const z1 = Math.max(v.z0 + 2 * fh, v.z1 + dz);
      if (tall && TOWER_FAMS.has(fk)) {
        const tr = this.massing(r, v.z0, z1, fk, tn, v.b, kj, shop, v.c, v.y || 0);
        this.towerTop(tr, z1, z1, fk, tn, v.b, kj, "auto");
      } else {
        this.addVolume(r, v.z0, z1, fk, tn, v.b, true, true, kj, shop || fk === "castiron" || (WALKUP.has(fk) && hash01(kj ^ 0x51ab, this.seed) < 0.4), false, v.c, v.y || 0);
      }
      const d = this.deedOf(v.b); d.height = Math.max(d.height, z1);
    }
    this.lookSig.set(v.b, `${fam}|row${cuts.length - 1}`);
    return true;
  }

  /** Every elevation in the pattern book on one contact sheet, a scheme on each (a review instrument; builds them all). */
  elevationSheet(cols = 12, painted = false): string {
    const keys: string[] = [];
    for (const f of FAMILY_SPECS) { keys.push(f.key); (VARIANTS[f.key] ?? []).forEach((_v, j) => keys.push(`${f.key}#${j + 1}`)); }
    const S = 128, rows = Math.ceil(keys.length / cols);
    const { c, g } = makeCanvas(cols * S, rows * (S + 14));
    g.fillStyle = "#222"; g.fillRect(0, 0, c.width, c.height);
    keys.forEach((k, i) => {
      const img = this.families[k]?.mat.map?.image as HTMLCanvasElement | undefined;
      if (!img) return;
      const x = (i % cols) * S, y = Math.floor(i / cols) * (S + 14);
      g.drawImage(img, 0, 0, img.width, img.height, x, y, S, S);
      if (painted) {
        const m = this.families[k].mat.emissiveMap?.image as HTMLCanvasElement | undefined;
        const l = liveryFor(k.split("#")[0], i * 7919 + 13);
        if (m && l !== NO_PAINT) {
          // a rough preview: flat paint where the mask says, over the texture
          const sr = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
          const md = m.getContext("2d")!.getImageData(0, 0, m.width, m.height).data;
          const tmp = makeCanvas(img.width, img.height); tmp.g.drawImage(img, 0, 0);
          const td = tmp.g.getImageData(0, 0, img.width, img.height);
          for (let p = 0; p < td.data.length; p += 4) {
            const col = md[p + 1] > 128 && l.trim[0] >= 0 ? l.trim : md[p + 2] > 128 && l.accent[0] >= 0 ? l.accent : l.wall[3] > 0 && md[p + 1] < 128 && md[p + 2] < 128 ? l.wall : null;
            if (!col) continue;
            const lum = (td.data[p] + td.data[p + 1] + td.data[p + 2]) / 600;
            const k2 = col === l.wall ? Math.max(0.6, Math.min(1.4, lum * 2.2)) : 1;
            td.data[p] = sr(col[0] * k2); td.data[p + 1] = sr(col[1] * k2); td.data[p + 2] = sr(col[2] * k2);
          }
          tmp.g.putImageData(td, 0, 0);
          g.drawImage(tmp.c, 0, 0, img.width, img.height, x, y, S, S);
        }
      }
      g.fillStyle = "#ddd"; g.font = "10px sans-serif"; g.fillText(k, x + 2, y + S + 11);
    });
    return c.toDataURL("image/png");
  }

  /** Each style feature and the deeds that got it, for the review shots and the count. */
  features = new Map<string, string[]>();
  private feat(f: string, bbl: string) { if (!bbl || this.sandbox) return; let l = this.features.get(f); if (!l) this.features.set(f, (l = [])); if (!l.includes(bbl)) l.push(bbl); }
  /** Where to look at one building per feature: [lng, lat, height]. */
  featureSpots(): Record<string, { n: number; at: number[][] }> {
    const out: Record<string, { n: number; at: number[][] }> = {};
    const byB = new Map<string, BuildingVolume>();
    for (const v of this.volumes) if (v.b && !byB.has(v.b)) byB.set(v.b, v);
    for (const [f, l] of this.features) {
      out[f] = { n: l.length, at: l.slice(0, 4).map((b) => { const v = byB.get(b); if (!v) return [0, 0, 0]; let x = 0, y = 0; for (const p of v.r) { x += p[0] / v.r.length; y += p[1] / v.r.length; } return [x, y, this.deeds.get(b)?.height ?? 0]; }) };
    }
    return out;
  }
  /** elevation | paint scheme of every building's base volume, for the variety audit. */
  looks = new Map<string, string>();
  /** What each tower ended up as — family#elevation | massing | crown | tint — for the variety audit. */
  lookSig = new Map<string, string>();
  /** family | height | year | use of every building's top volume, for the variety audit. */
  famOf = new Map<string, string>();
  /**
   * NO TWO TOWERS THE SAME SHAPE. A post-war tower was an extruded footprint
   * here, so the skyline was a forest of one prism in different paint. Now
   * each draws a massing from the period's real repertoire, by hash of its
   * deed: the plain slab; a tower on a podium (the plaza-and-base of the
   * 1960s-80s); stepped tiers; a slow taper; chamfered or rounded corners;
   * notched, re-entrant corners; twin tops of unequal height off a shared
   * base — and combinations. Mid-rise buildings (24-40 m) take the gentler
   * ones. The height and footprint are the building's own; only the shape of
   * the volume within them changes. Looks only.
   */
  private massing(ring0: P2[], z0: number, H: number, fam: string, t: number[], bbl: string, k: number, shop: boolean, cls: string, year: number): P2[] {
    if (ringArea(ring0) < 0) ring0 = ring0.slice().reverse();
    let cx = 0, cy = 0;
    for (const [x, y] of ring0) { cx += x / ring0.length; cy += y / ring0.length; }
    let rad = Infinity;
    for (let i = 0; i < ring0.length; i++) {
      const a = ring0[i], b = ring0[(i + 1) % ring0.length];
      rad = Math.min(rad, Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const shrink = (r: P2[], f: number) => r.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as P2);
    // an upper tier must stand inside the one below: an inset that leaves the
    // parent (a sharp triangle's mitres do) shrinks about the parent's own centre instead
    const inset = (r: P2[], d: number): P2[] => {
      const q = insetRing(r, d);
      if (q && ringArea(q) > 0 && q.every(([x, y]) => PolyGrid.inRing(r, x, y))) return q;
      let px = 0, py = 0; for (const [x, y] of r) { px += x / r.length; py += y / r.length; }
      return r.map(([x, y]) => [px + (x - px) * 0.82, py + (y - py) * 0.82] as P2);
    };
    const simple = ring0.length <= 8 && rad > 7;
    const quad = ring0.length === 4 && rad > 10;
    const tall = H >= 40;
    const h = (n: number) => hash01(k ^ n, this.seed);
    type M = "straight" | "podium" | "tiers" | "taper" | "chamfer" | "round" | "notch" | "twin" | "podium+chamfer" | "podium+tiers" | "round+tiers" | "twist";
    const futurist = styleOf(fam, year, H) === "futurist";
    const opts: [M, number][] = tall
      ? [["straight", 0.1], ["podium", 0.15], ["tiers", 0.13], ["taper", simple ? 0.08 : 0], ["chamfer", simple ? 0.1 : 0], ["round", simple ? 0.08 : 0],
         ["notch", quad ? 0.08 : 0], ["twin", quad && H > 70 ? 0.07 : 0], ["podium+chamfer", simple ? 0.08 : 0], ["podium+tiers", 0.08], ["round+tiers", simple ? 0.05 : 0],
         ["twist", futurist && simple && H > 80 ? 0.22 : 0], ["taper", futurist && simple ? 0.08 : 0]]
      : [["straight", 0.4], ["podium", 0.2], ["chamfer", simple ? 0.15 : 0], ["round", simple ? 0.1 : 0], ["notch", quad ? 0.08 : 0], ["tiers", 0.1]];
    const m = pick(h(0x6a55), opts) as M;
    let ring = ring0;
    if (m === "chamfer" || m === "podium+chamfer") ring = chamferRing(ring, 0.12 + 0.12 * h(0x1c), 7, false);
    if (m === "round" || m === "round+tiers") ring = chamferRing(ring, 0.18 + 0.1 * h(0x1d), 9, true);
    if (m === "notch") ring = notchRing(ring, Math.min(5, rad * (0.12 + 0.08 * h(0x1e))));
    const vol = (r: P2[], za: number, zb: number, top: boolean, sh = false, fk = fam) =>
      this.addVolume(r, za, zb, fk, t, bbl, true, top, k, sh, false, top || sh ? cls : "", year);
    let topRing = ring;
    const podiumH = Math.min(24, Math.max(8, H * (0.12 + 0.08 * h(0x2a))));
    const podFam = GLASSY.has(fam)
      ? pick(h(0x2b), [["precast", 0.35], ["pomo", 0.25], [fam, 0.4]]) : fam;
    if (m === "podium" || m === "podium+chamfer" || m === "podium+tiers") {
      vol(m === "podium+chamfer" ? ring0 : ring, z0, podiumH, false, shop, podFam);
      topRing = inset(ring, 3 + 4 * h(0x2c));
      if (m === "podium+tiers") {
        const z1 = podiumH + (H - podiumH) * (0.6 + 0.15 * h(0x2d));
        vol(topRing, podiumH, z1, false);
        topRing = inset(topRing, 2.5 + 2 * h(0x2e));
        vol(topRing, z1, H, true);
      } else vol(topRing, podiumH, H, true);
    } else if (m === "tiers" || m === "round+tiers") {
      const n = 2 + Math.floor(h(0x3a) * 3);   // two to four tiers
      let za = z0, r = ring;
      for (let i = 0; i < n; i++) {
        const zb = i === n - 1 ? H : z0 + (H - z0) * (0.45 + (0.5 * (i + 1)) / n) * (0.9 + 0.1 * h(0x3b + i));
        vol(r, za, Math.min(H, zb), i === n - 1, i === 0 && shop);
        za = Math.min(H, zb); topRing = r;
        r = inset(r, 2 + 2.5 * h(0x3f + i));
      }
    } else if (m === "taper") {
      const n = 7;
      let za = z0;
      for (let i = 0; i < n; i++) {
        const zb = z0 + ((H - z0) * (i + 1)) / n;
        const r = shrink(ring, 1 - 0.3 * (i / (n - 1)));
        vol(r, za, zb, i === n - 1, i === 0 && shop);
        za = zb; topRing = r;
      }
    } else if (m === "twist") {
      // THE TWISTING TOWER: each band of floors turned a few degrees on the
      // one below, about the core, a quarter-turn or less top to bottom
      const n = 12, turn = (0.35 + 0.5 * h(0x7f1)) * (h(0x7f2) < 0.5 ? -1 : 1);
      let za = z0;
      for (let i = 0; i < n; i++) {
        const zb = z0 + ((H - z0) * (i + 1)) / n, a = (turn * i) / (n - 1), ca = Math.cos(a), sa = Math.sin(a);
        const r = ring.map(([x, y]) => [cx + ((x - cx) * ca - (y - cy) * sa) * 0.86, cy + ((x - cx) * sa + (y - cy) * ca) * 0.86] as P2);
        vol(r, za, zb, i === n - 1, i === 0 && shop);
        za = zb; topRing = r;
      }
      this.feat("twist", bbl);
    } else if (m === "twin") {
      // a shared base, then two towers of unequal height with a slot between
      const base = H * (0.35 + 0.2 * h(0x4a));
      vol(ring, z0, base, false, shop);
      let li = 0, ll = -1;
      for (let i = 0; i < 4; i++) { const a = ring[i], b = ring[(i + 1) % 4]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
      const A = ring[li], B = ring[(li + 1) % 4], C = ring[(li + 2) % 4], D = ring[(li + 3) % 4];
      const lerp = (p: P2, q: P2, f: number): P2 => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
      const g = 0.06 + 0.06 * h(0x4b);
      const t1: P2[] = [A, lerp(A, B, 0.5 - g), lerp(D, C, 0.5 - g), D];
      const t2: P2[] = [lerp(A, B, 0.5 + g), B, C, lerp(D, C, 0.5 + g)];
      const h2 = base + (H - base) * (0.7 + 0.15 * h(0x4c));
      vol(t1, base, H, true);
      vol(t2, base, h2, true);
      topRing = t1;
    } else {
      vol(ring, z0, H, true, shop);
    }
    this.lookSig.set(bbl, `${this.variantOf(fam, k)}|${m}`);
    return topRing;
  }

  /**
   * A TOWER ENDS IN SOMETHING. A deco tower steps back twice and finishes in a
   * spire; a glass tower carries a recessed mechanical crown and a mast; the
   * International Style a plain penthouse; a stone office one setback. "auto"
   * is the period's choice; the player's design can name one instead.
   */
  private towerTop(ring: P2[], z1: number, top: number, fam: string, t: number[], bbl: string, k: number,
    kind: "auto" | "none" | "setback" | "spire" | "mast", ov?: VolumeOv) {
    const glassy = GLASSY.has(fam);
    if (kind === "none") return;
    if (kind === "auto" && !(top > 45 && (glassy || TOWER_FAMS.has(fam) || fam === "deco" || fam === "decobrick" || STONE_TOWER.has(fam)))) return;
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length; cy /= ring.length;
    const shrink = (r: P2[], f: number) => r.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as P2);
    const deco = fam === "deco" || fam === "decobrick";
    let rad = 0; for (const [x, y] of ring) rad = Math.max(rad, Math.hypot(x - cx, y - cy));
    // the bearing of the ring's longest side, so a cap squares up with the walls
    let li = 0, ll = -1;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
    const bear = Math.atan2(ring[(li + 1) % ring.length][1] - ring[li][1], ring[(li + 1) % ring.length][0] - ring[li][0]);
    const note = (c: string) => { const sg = this.lookSig.get(bbl); if (sg && !sg.includes("|c:")) this.lookSig.set(bbl, `${sg}|c:${c}`); };
    // THE CROWNS OF THE LATER SKYLINE. Not every glass tower ends in a
    // plant box and a mast: a stepped crown, a lantern of
    // glass, a frame of fins carried up past the roof, a helipad, a sloped
    // top. By hash, among the ones its family would have worn.
    if (kind === "auto" && !deco && !STONE_TOWER.has(fam) && TOWER_FAMS.has(fam)) {
      const opts: [string, number][] = glassy
        ? [["mech", 0.2], ["mech2", 0.15], ["stepped", 0.13], ["lantern", 0.11], ["fins", 0.11], ["helipad", rad > 14 ? 0.1 : 0], ["flat", 0.06], ["gable", ring.length === 4 ? 0.06 : 0], ["slant", ring.length === 4 ? 0.09 : 0]]
        : [["penthouse", 0.3], ["mech", 0.2], ["stepped", 0.15], ["fins", fam === "precast" || fam === "pomo" ? 0.1 : 0.04], ["flat", 0.15]];
      const c = pick(hash01(k ^ 0x7c0, this.seed), opts);
      note(c); this.feat("crown:" + c, bbl);
      const mastTop = (z: number) => { if (hash01(k ^ 0x77, this.seed) < 0.5) this.putInst("mast", cx, cy, z, 1, 0, bbl); };
      if (c === "mech" || c === "mech2") {
        this.addVolume(shrink(ring, 0.86), z1, z1 + 5, fam, t, bbl, c === "mech", false, k, false, false, "", 0, ov);
        if (c === "mech2") this.addVolume(shrink(ring, 0.62), z1 + 5, z1 + 11, fam, t, bbl, true, false, k, false, false, "", 0, ov);
        mastTop(z1 + (c === "mech2" ? 11 : 5));
      } else if (c === "stepped") {
        let r = ring, z = z1;
        for (let i = 0; i < 3; i++) { r = shrink(r, 0.8); this.addVolume(r, z, z + 3.4, fam, t, bbl, true, false, k, false, false, "", 0, ov); z += 3.4; }
        mastTop(z);
      } else if (c === "lantern") {
        this.addVolume(shrink(ring, 0.72), z1, z1 + 9, glassy ? "silverglass" : "glass", [1, 1, 1], bbl, true, false, k, false, false, "", 0, ov);
        this.putInst("mast", cx, cy, z1 + 9, 1.2, 0, bbl);
      } else if (c === "fins") {
        const fh = 6 + 5 * hash01(k ^ 0x7c2, this.seed);
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.max(1, Math.round(L / 2.6)), r2 = Math.atan2(b[1] - a[1], b[0] - a[0]);
          for (let j = 0; j <= n; j++) this.putInst("fin", a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n, z1, 1, r2, bbl, undefined, fh);
        }
      } else if (c === "helipad") {
        this.addVolume(shrink(ring, 0.8), z1, z1 + 3.5, fam, t, bbl, true, false, k, false, false, "", 0, ov);
        this.putInst("helipad", cx, cy, z1 + 3.55, 1, bear, bbl);
      } else if (c === "gable") {
        this.addVolume(shrink(ring, 0.94), z1, z1 + Math.min(14, rad * 0.6), fam, t, bbl, true, false, k, false, true, "", 0, ov);
      } else if (c === "slant") {
        // THE WEDGE. A top sliced off at forty-five degrees across the short
        // way, the slope glazed or clad: the 1977 tower that hid its plant
        // in its own roof, and every tower that copied it.
        const r = shrink(ring, 0.98);
        let li = 0, lmax = -1;
        for (let i = 0; i < 4; i++) { const L = Math.hypot(r[(i + 1) % 4][0] - r[i][0], r[(i + 1) % 4][1] - r[i][1]); if (L > lmax) { lmax = L; li = i; } }
        const A = r[li], B = r[(li + 1) % 4], C = r[(li + 2) % 4], D = r[(li + 3) % 4];
        const short = Math.hypot(C[0] - B[0], C[1] - B[1]);
        const rise = Math.min(30, short * 0.9);
        this.prismTop(A, B, C, D, z1, rise, fam, t, bbl, k, ov);
        this.putInst("mast", (C[0] + D[0]) / 2 * 0.7 + cx * 0.3, (C[1] + D[1]) / 2 * 0.7 + cy * 0.3, z1 + rise, 0.6, 0, bbl);
        const d3 = this.deedOf(bbl); d3.height = Math.max(d3.height, z1 + rise);
        return;
      } else if (c === "penthouse") {
        this.addVolume(shrink(ring, 0.62), z1, z1 + 4.5, "plain", [0.9, 0.9, 0.9], bbl, true, true, k);
      }
      const d2 = this.deedOf(bbl); d2.height = Math.max(d2.height, z1 + 8);
      return;
    }
    // THE MASONRY CROWNS. A deco tower ends in a spire, a ziggurat of
    // narrowing tiers, or a frame of piers carried up past the roof; a
    // Beaux-Arts or terra-cotta tower in a setback, a steep château roof of
    // copper or slate with dormers, or a Gothic crown of corner pinnacles.
    // Every pitched roof is built on the top's own outline, inset, so it can
    // never overhang the walls.
    if (kind === "auto" && (deco || STONE_TOWER.has(fam))) {
      const c = deco ? pick(hash01(k ^ 0x7c1, this.seed), [["spire", 0.45], ["ziggurat", 0.3], ["piers", 0.25]])
        : pick(hash01(k ^ 0x7c1, this.seed), [["setback", 0.32], ["chateau", ring.length === 4 ? 0.3 : 0], ["setchateau", ring.length === 4 ? 0.18 : 0], ["pinnacles", fam === "terracotta" || fam === "stone" ? 0.2 : 0.05]]);
      note(c); this.feat("crown:" + c, bbl);
      const d2 = this.deedOf(bbl);
      if (c === "ziggurat") {
        let r = ring, z = z1;
        for (let i = 0; i < 4; i++) { r = shrink(r, 0.82); this.addVolume(r, z, z + 4.2 - i * 0.4, fam, t, bbl, true, false, k, false, false, "", 0, ov); z += 4.2 - i * 0.4; }
        this.putInst("mast", cx, cy, z, 0.45, 0, bbl);
        d2.height = Math.max(d2.height, z + 6);
        return;
      }
      if (c === "piers") {
        this.addVolume(shrink(ring, 0.8), z1, z1 + 6, fam, t, bbl, true, false, k, false, false, "", 0, ov);
        const fh = 7 + 6 * hash01(k ^ 0x7c3, this.seed);
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.max(1, Math.round(L / 3.2)), r2 = Math.atan2(b[1] - a[1], b[0] - a[0]);
          for (let j = 0; j < n; j++) this.putInst("crownpier", a[0] + ((b[0] - a[0]) * (j + 0.5)) / n, a[1] + ((b[1] - a[1]) * (j + 0.5)) / n, z1, 1, r2, bbl, undefined, fh);
        }
        d2.height = Math.max(d2.height, z1 + fh);
        return;
      }
      if (c === "chateau" || c === "setchateau") {
        let r = ring, z = z1;
        if (c === "setchateau") { r = shrink(ring, 0.8); this.addVolume(r, z1, z1 + 5, fam, t, bbl, true, false, k, false, false, "", 0, ov); z = z1 + 5; }
        const roofC = pick(hash01(k ^ 0x7c4, this.seed), [["#6f9f8a", 0.5], ["#5a5c62", 0.3], ["#5a4a3e", 0.1], ["#8aa898", 0.1]]);
        const rise = this.hipRoof(shrink(r, 0.94), z + 0.9, roofLin(roofC), bbl, 1.5, true);
        this.putInst("mast", cx, cy, z + 0.9 + rise, 0.3, 0, bbl);
        d2.height = Math.max(d2.height, z + rise + 4);
        return;
      }
      if (c === "pinnacles") {
        const r = shrink(ring, 0.84);
        this.addVolume(r, z1, z1 + 5, fam, t, bbl, true, false, k, false, false, "", 0, ov);
        const tcol = [0.96, 0.93, 0.86];
        for (const [x, y] of ring) this.putInst("pinnacle", cx + (x - cx) * 0.93, cy + (y - cy) * 0.93, z1, 1, bear, bbl, tcol);
        for (const [x, y] of r) this.putInst("pinnacle", cx + (x - cx) * 0.93, cy + (y - cy) * 0.93, z1 + 5, 0.8, bear, bbl, tcol);
        if (r.length === 4) {
          const rise = this.hipRoof(shrink(r, 0.9), z1 + 5.6, roofLin(hash01(k ^ 0x7c5, this.seed) < 0.6 ? "#6f9f8a" : "#5a5c62"), bbl, 2.4, false);
          d2.height = Math.max(d2.height, z1 + 5.6 + rise);
        } else d2.height = Math.max(d2.height, z1 + 9);
        return;
      }
      // "setback" and "spire" fall through to the original two below
    }
    note(deco ? "spire" : "setback");
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

  /**
   * SHOPFRONTS BY TRADE. Every street-facing ground-floor bay of a shop
   * storey gets a canopy and a fascia sign in the colours of what trades
   * there — a cafe, a grocer, a bank, a pharmacy — and a plywood hoarding
   * for when it is empty. Which bays are boarded is read live from the
   * building's let share of retail (setRetail), the same number that papers
   * over the glass; which trade a bay belongs to is looks only (the market's
   * buildings carry no tenant roll), drawn by hash so it is stable, with
   * downtown stone and glass leaning to banks and boutiques and the brick
   * streets to grocers, cafes and hardware.
   */
  private shopBays(ring: P2[], bbl: string, seedK: number, shopH: number, famKey: string) {
    const BAY = 5.5;
    const uptown = famKey === "stone" || famKey === "modern" || famKey === "deco" || famKey === "castiron" || famKey === "terracotta" || famKey === "newstone" || GLASSY.has(famKey);
    const trades = uptown ? SHOP_TRADES_UPTOWN : SHOP_TRADES_STREET;
    const sz = shopH / 4.4;
    let bayN = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < BAY) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const nx = uy, ny = -ux;                          // outward, counter-clockwise ring
      // only a wall that fronts a street: six metres out is nobody's lot
      const mx = (a[0] + b[0]) / 2 + nx * 6, my = (a[1] + b[1]) / 2 + ny * 6;
      if (this.lotAt2D(mx, my)) continue;
      const n = Math.floor(L / BAY), r = Math.atan2(uy, ux);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) * (L / n);
        const x = a[0] + ux * t, y = a[1] + uy * t;
        // a canopy hangs over a forecourt or the footway, not into a
        // neighbour's wall and not out over the carriageway
        const under = this.groundAt(x + nx * 1.5, y + ny * 1.5);
        if (under === "bld" || under === "road") continue;
        const tr = trades[Math.floor(hash01(seedK ^ (bayN * 0x9e37 + 0x51), 13) * trades.length)];
        this.putInst("awning", x, y, 0, 1, r, bbl, tr.awn, sz);
        this.putInst("shopsign", x, y, 0, 1, r, bbl, tr.sign, sz);
        this.putInst("boards", x, y, 0, 1, r, bbl, undefined, sz);
        bayN++;
      }
    }
  }
  /** The walls of a ring that front a street: six metres out is nobody's lot. */
  private streetEdges(ring: P2[], minL: number) {
    const out: { a: P2; ux: number; uy: number; L: number; r: number }[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < minL) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      if (this.lotAt2D((a[0] + b[0]) / 2 + uy * 6, (a[1] + b[1]) / 2 - ux * 6)) continue;
      out.push({ a, ux, uy, L, r: Math.atan2(uy, ux) });
    }
    return out;
  }
  /**
   * WHAT THE STREET FRONT SAYS. The brownstone and brick rows climb to their
   * doors up a stoop, one to a house; the works quarter's sheds face the road
   * with loading docks. Read off the building's own family and use.
   */
  private streetDress(ring: P2[], bbl: string, famKey: string, cls: string, seedK: number, z1: number) {
    // A STOOP IS A ROW HOUSE'S. Only a low brownstone or brick walk-up, and
    // only on a front that stands at the footway — a stoop out in a forecourt
    // is a staircase to nowhere. It comes up in the house's own stone.
    if (cls === "multifamily" && z1 <= 16 && (famKey === "brownstone" || famKey === "brick" || famKey === "georgian" || famKey === "gothic" || famKey === "romanesque")) {
      if (famKey !== "brownstone" && hash01(seedK ^ 0x570f, 9) < 0.5) return;
      for (const e of this.streetEdges(ring, 5)) {
        const nx = e.uy, ny = -e.ux;
        const n = Math.max(1, Math.floor(e.L / 6.2));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) * (e.L / n);
          const x = e.a[0] + e.ux * t, y = e.a[1] + e.uy * t;
          const foot = this.groundAt(x + nx * 2.9, y + ny * 2.9), beyond = this.groundAt(x + nx * 4.5, y + ny * 4.5);
          const step = this.groundAt(x + nx * 1.5, y + ny * 1.5);
          if (step === "bld" || foot === "bld" || foot === "road" || (beyond !== "walk" && beyond !== "road")) continue;
          this.putInst("stoop", x, y, 0, 1, e.r, bbl, famKey === "brownstone" ? [0.36, 0.24, 0.19] : [0.42, 0.38, 0.35]);
        }
      }
    } else if (cls === "industrial") {
      for (const e of this.streetEdges(ring, 10)) {
        const n = Math.min(4, Math.floor(e.L / 12));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) * (e.L / n);
          const x = e.a[0] + e.ux * t, y = e.a[1] + e.uy * t;
          // the apron and canopy need open yard or road in front of them
          const f = this.groundAt(x + e.uy * 2.6, y - e.ux * 2.6);
          if (f === "bld" || f === "walk") continue;
          this.putInst("dock", x, y, 0, 1, e.r, bbl);
        }
      }
    }
  }
  // ---- the styles' pieces (see styleOf) ----------------------------------

  /**
   * ONE BUILDING IN ITS STYLE'S SHAPE. Most styles stand as their footprint
   * extruded; three do not. Brutalism turns the ziggurat upside down — a
   * recessed base under floors that cantilever out over it. The contemporary
   * block sets its top floor back behind a terrace and pushes boxes of a
   * second cladding out of its face. Streamline Moderne rounds its corners.
   * Same height and footprint as the deed's; only the shape changes.
   */
  private styledVolume(ring: P2[], z0: number, z1: number, fam: string, t: number[], bbl: string, k: number, shop: boolean, cls: string, year: number, ov?: VolumeOv) {
    if (ringArea(ring) < 0) ring = ring.slice().reverse();
    const style = styleOf(fam, year, z1);
    let rad = Infinity;
    for (let i = 0; i < ring.length; i++) rad = Math.min(rad, Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]));
    const simple = ring.length <= 8 && rad > 6;
    const h = (n: number) => hash01(k ^ n, this.seed);
    const fh = this.families[fam]?.floorH ?? 3.4;
    const ok = (r: P2[] | null): r is P2[] => !!r && r.length === ring.length && ringArea(r) > 0.3 * ringArea(ring) && r.every(([x, y]) => PolyGrid.inRing(ring, x, y));
    if (!ov && simple && z0 < 0.5) {
      if (style === "brutalist" && z1 > 12 && h(0xb701) < 0.7) {
        const base = insetRing(ring, 2.4 + 1.6 * h(0xb702));
        if (ok(base)) {
          const b1 = z0 + Math.max(4.6, (z1 - z0) * (0.18 + 0.12 * h(0xb703)));
          this.addVolume(base, z0, b1, fam, t, bbl, false, false, k, false, false, cls, year);
          // a second step out on the taller ones
          const mid = z1 > 30 && h(0xb704) < 0.5 ? insetRing(ring, 1.1) : null;
          if (ok(mid)) {
            const b2 = b1 + (z1 - b1) * 0.3;
            this.addVolume(mid, b1, b2, fam, t, bbl, false, false, k, false, false, "", year);
            this.soffit(mid, base, b1, bbl, [0.62, 0.61, 0.58]);
            this.addVolume(ring, b2, z1, fam, t, bbl, true, true, k, false, false, cls, year);
            this.soffit(ring, mid, b2, bbl, [0.62, 0.61, 0.58]);
          } else {
            this.addVolume(ring, b1, z1, fam, t, bbl, true, true, k, false, false, cls, year);
            this.soffit(ring, base, b1, bbl, [0.62, 0.61, 0.58]);
          }
          this.lookSig.set(bbl, `${this.variantOf(fam, k)}|cantilever`); this.feat("cantilever", bbl);
          return ring;
        }
      }
      if (style === "contemporary" && z1 > 10 && h(0xc701) < 0.6) {
        const top = insetRing(ring, 2.2 + 1.2 * h(0xc702));
        if (ok(top)) {
          const zt = z1 - fh;
          this.addVolume(ring, z0, zt, fam, t, bbl, true, false, k, shop, false, cls, year);
          this.addVolume(top, zt, z1, fam, t, bbl, true, true, k, false, false, cls, year);
          this.popOuts(ring, fam, k, zt, bbl);
          this.lookSig.set(bbl, `${this.variantOf(fam, k)}|setback`); this.feat("setback", bbl);
          return top;
        }
      }
      if (style === "moderne" && h(0x30d1) < 0.75) { ring = chamferRing(ring, 0.24, 5.5, true); this.feat("rounded", bbl); }
    }
    this.addVolume(ring, z0, z1, fam, t, bbl, true, true, k, shop, false, cls, year, ov);
    if (style === "contemporary" && !ov && z0 < 0.5 && z1 > 7) this.popOuts(ring, fam, k, z1, bbl);
    return ring;
  }

  /**
   * Boxes pushed out of a contemporary front: one or two on the main street
   * wall, a storey up, two or three floors tall, 0.9 m proud, clad in a
   * second material — the move every 2010s apartment block makes.
   */
  private popOuts(ring: P2[], fam: string, k: number, zTop: number, bbl: string) {
    const h = (n: number) => hash01(k ^ n, this.seed);
    if (h(0x9091) > 0.65) return;
    const edges = this.streetEdges(ring, 12);
    if (!edges.length) return;
    const e = edges.reduce((x, y) => (y.L > x.L ? y : x));
    const alt = pick(h(0x9092), fam === "metalpanel" ? [["fibercement#3", 0.4], ["timber", 0.3], ["metalpanel#2", 0.3]]
      : fam === "timber" ? [["metalpanel#1", 0.6], ["metalpanel", 0.4]] : [["metalpanel#1", 0.35], ["metalpanel#3", 0.25], ["timber", 0.2], ["metalpanel#2", 0.2]]);
    const f = this.families[alt]; if (!f) return;
    const fh = this.families[fam]?.floorH ?? 3.3;
    const W = this.buf("w:" + alt), R = this.buf("roof"), T = this.buf("trim");
    const w0 = W.count, r0 = R.count, t0 = T.count;
    const nx = e.uy, ny = -e.ux, D = 0.9, q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const nBox = e.L > 30 && h(0x9093) < 0.6 ? 2 : 1;
    const g = this.groundIndex();
    for (let b = 0; b < nBox; b++) {
      const wd = Math.min(7, Math.max(3.5, e.L * 0.18));
      const tc = e.L * (nBox === 1 ? 0.3 + 0.4 * h(0x9094) : b === 0 ? 0.25 : 0.72);
      const floors = 2 + Math.floor(h(0x9095 + b) * 2);
      const za = fh * (1 + Math.floor(h(0x9097 + b) * 2)), zb = Math.min(zTop - 0.3, za + floors * fh);
      if (zb - za < fh * 1.5 || tc - wd / 2 < 0.5 || tc + wd / 2 > e.L - 0.5) continue;
      const P = (t: number, o: number): P2 => [e.a[0] + e.ux * t + nx * o, e.a[1] + e.uy * t + ny * o];
      const A = P(tc - wd / 2, 0), B = P(tc - wd / 2, D), C = P(tc + wd / 2, D), Dd = P(tc + wd / 2, 0);
      const faces: [P2, P2, number][] = [[A, B, D], [B, C, wd], [C, Dd, D]];
      let u = 0;
      for (const [a, c, L] of faces) {
        const nn = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L, 0];
        W.quad([a[0], a[1], za], [c[0], c[1], za], [c[0], c[1], zb], [a[0], a[1], zb], nn, [[u, za / f.floorH], [u + L / f.bayW, za / f.floorH], [u + L / f.bayW, zb / f.floorH], [u, zb / f.floorH]], [1, 1, 1]);
        u += L / f.bayW;
      }
      R.face([[A[0], A[1], zb], [B[0], B[1], zb], [C[0], C[1], zb], [Dd[0], Dd[1], zb]], [0, 0, 1], [0.9, 0.9, 0.9]);
      T.quad([A[0], A[1], za], [Dd[0], Dd[1], za], [C[0], C[1], za], [B[0], B[1], za], [0, 0, -1], q, [0.6, 0.6, 0.6]);
      if (!this.sandbox) g.bld.add([A, B, C, Dd]); this.feat("popout", bbl);
    }
    this.note(bbl, "w:" + alt, w0); this.note(bbl, "roof", r0); this.note(bbl, "trim", t0);
  }

  /** The underside between an outer outline and an inner one at height z (a soffit over a recessed base). */
  private soffit(outer: P2[], inner: P2[], z: number, bbl: string, col: number[]) {
    const T = this.buf("trim"); const t0 = T.count;
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < outer.length && i < inner.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length], bi = inner[(i + 1) % inner.length], ai = inner[i];
      T.quad([a[0], a[1], z], [ai[0], ai[1], z], [bi[0], bi[1], z], [b[0], b[1], z], [0, 0, -1], q, col);
    }
    this.note(bbl, "trim", t0);
  }

  /** Columns round an outline, `inset` in from it, one at each corner and every `spacing` metres between. */
  private colonnade(ring: P2[], inset: number, spacing: number, h: number, kind: string, bbl: string) {
    const r = insetRing(ringArea(ring) < 0 ? ring.slice().reverse() : ring, inset);
    if (!r) return;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / spacing));
      for (let j = 0; j < n; j++) this.putInst(kind, a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n, 0, 1, 0, bbl, undefined, h);
    }
  }

  /** An outline pushed out by d (a counter-clockwise ring), mitred, the mitre capped. */
  private outset(ring: P2[], d: number): P2[] {
    const n = ring.length, out: P2[] = [];
    for (let i = 0; i < n; i++) {
      const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
      const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, l2 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
      const n1 = [(c[1] - p[1]) / l1, -(c[0] - p[0]) / l1], n2 = [(q[1] - c[1]) / l2, -(q[0] - c[0]) / l2];
      const mx = n1[0] + n2[0], my = n1[1] + n2[1], ml = Math.hypot(mx, my);
      const k = ml < 1e-6 ? d : Math.min(d * 2.5, (d * 2) / ml);
      out.push(ml < 1e-6 ? [c[0] + n2[0] * d, c[1] + n2[1] * d] : [c[0] + (mx / ml) * k, c[1] + (my / ml) * k]);
    }
    return out;
  }

  /** The mid-century roof: a thin slab run out past the walls, a white edge, a shaded soffit. */
  private roofSlab(ring: P2[], z: number, over: number, bbl: string, rc: number[]) {
    const o = this.outset(ring, over), th = 0.38;
    const R = this.buf("roof"), T = this.buf("trim"); const r0 = R.count, t0 = T.count;
    let tris: number[][] = [];
    try { tris = THREE.ShapeUtils.triangulateShape(o.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { tris = []; }
    for (const t of tris) R.tri([o[t[0]][0], o[t[0]][1], z + th], [o[t[1]][0], o[t[1]][1], z + th], [o[t[2]][0], o[t[2]][1], z + th], [0, 0, 1], rc);
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]], edge = [1.18, 1.18, 1.16];
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      T.quad([a[0], a[1], z], [b[0], b[1], z], [b[0], b[1], z + th], [a[0], a[1], z + th], [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0], q, edge);
    }
    this.soffit(o, ring, z, bbl, [0.8, 0.8, 0.78]);
    this.note(bbl, "roof", r0); this.note(bbl, "trim", t0);
  }

  /** A balustrade round a flat roof: plinth, balusters every 0.32 m, posts every bay or so, a rail. */
  private balustrade(ring: P2[], z: number, col: number[], bbl: string) {
    const T = this.buf("trim"); const t0 = T.count;
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.8) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = uy, ny = -ux;
      const P = (t: number, o: number, zz: number) => [a[0] + ux * t + nx * o, a[1] + uy * t + ny * o, zz];
      const box = (t0b: number, t1b: number, o0: number, o1: number, za: number, zb: number) => {
        T.quad(P(t0b, o1, za), P(t1b, o1, za), P(t1b, o1, zb), P(t0b, o1, zb), [nx, ny, 0], q, col);
        T.quad(P(t1b, o0, za), P(t0b, o0, za), P(t0b, o0, zb), P(t1b, o0, zb), [-nx, -ny, 0], q, [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85]);
        T.quad(P(t0b, o0, zb), P(t0b, o1, zb), P(t1b, o1, zb), P(t1b, o0, zb), [0, 0, 1], q, col);
      };
      box(0, L, -0.1, 0.12, z, z + 0.22);                     // plinth
      box(0, L, -0.12, 0.14, z + 0.86, z + 1.02);             // rail
      for (let t = 0.25; t < L - 0.1; t += 0.32) box(t - 0.05, t + 0.05, -0.04, 0.06, z + 0.22, z + 0.86);
      const np = Math.max(1, Math.round(L / 2.8));
      for (let j = 0; j <= np; j++) { const t = Math.min(L - 0.2, Math.max(0.2, (L * j) / np)); box(t - 0.18, t + 0.18, -0.14, 0.16, z, z + 1.12); }
    }
    this.note(bbl, "trim", t0);
  }

  /** The temple front: a giant order of engaged columns, an architrave and a pediment, on the main street front. */
  private templeFront(ring: P2[], baseH: number, zw: number, col: number[], bbl: string) {
    const edges = this.streetEdges(ring, 14);
    if (!edges.length) return;
    const e = edges.reduce((x, y) => (y.L > x.L ? y : x));
    const nx = e.uy, ny = -e.ux;
    const span = Math.min(e.L * 0.62, 26);
    const n = Math.max(4, Math.min(8, Math.round(span / 3.4) + 1));
    const sp = span / (n - 1), t0 = e.L / 2 - span / 2;
    const r = Math.max(0.3, Math.min(0.55, sp * 0.13)), off = 0.42 + r;
    const g1 = this.groundAt(e.a[0] + e.ux * (e.L / 2) + nx * (off + 0.8), e.a[1] + e.uy * (e.L / 2) + ny * (off + 0.8));
    if (g1 === "road" || g1 === "bld") return;
    const T = this.buf("trim"); const tt = T.count;
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const P = (t: number, o: number, zz: number) => [e.a[0] + e.ux * t + nx * o, e.a[1] + e.uy * t + ny * o, zz];
    const block = (ta: number, tb: number, oa: number, ob: number, za: number, zb: number, c: number[]) => {
      T.quad(P(ta, ob, za), P(tb, ob, za), P(tb, ob, zb), P(ta, ob, zb), [nx, ny, 0], q, c);
      T.quad(P(ta, oa, za), P(ta, ob, za), P(ta, ob, zb), P(ta, oa, zb), [-e.ux, -e.uy, 0], q, c);
      T.quad(P(tb, ob, za), P(tb, oa, za), P(tb, oa, zb), P(tb, ob, zb), [e.ux, e.uy, 0], q, c);
      T.quad(P(ta, oa, zb), P(ta, ob, zb), P(tb, ob, zb), P(tb, oa, zb), [0, 0, 1], q, c);
      T.quad(P(ta, oa, za), P(tb, oa, za), P(tb, ob, za), P(ta, ob, za), [0, 0, -1], q, c);
    };
    const zc0 = baseH, zc1 = zw - 1.85;
    if (zc1 - zc0 < 5) return;
    for (let i = 0; i < n; i++) {
      const tc = t0 + i * sp;
      // an octagonal shaft, a square base and capital
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * 6.2832, a1 = ((k + 1) / 8) * 6.2832;
        const p0 = [Math.cos(a0) * r, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, Math.sin(a1) * r];
        const A = P(tc + p0[0], off + p0[1], zc0 + 0.45), B = P(tc + p1[0], off + p1[1], zc0 + 0.45);
        const C = P(tc + p1[0], off + p1[1], zc1 - 0.5), D = P(tc + p0[0], off + p0[1], zc1 - 0.5);
        const am = (a0 + a1) / 2, nn = [e.ux * Math.cos(am) + nx * Math.sin(am), e.uy * Math.cos(am) + ny * Math.sin(am), 0];
        T.quad(A, B, C, D, nn, q, col);
      }
      block(tc - r * 1.4, tc + r * 1.4, off - r * 1.4, off + r * 1.4, zc0, zc0 + 0.45, col);
      block(tc - r * 1.5, tc + r * 1.5, off - r * 1.5, off + r * 1.5, zc1 - 0.5, zc1, col);
    }
    const ta = t0 - r * 2, tb = t0 + span + r * 2, fo = off + r * 1.5;
    block(ta, tb, 0, fo, zc1, zw - 0.95, col);                                        // architrave and frieze
    block(ta - 0.2, tb + 0.2, 0, fo + 0.25, zw - 0.95, zw - 0.6, col);                // cornice
    // the pediment: a low triangle over the cornice, front and back faces and its raking tops
    const rise = (tb - ta) * 0.15, zp = zw - 0.6, mid = (ta + tb) / 2;
    const F1 = P(ta - 0.2, fo + 0.25, zp), F2 = P(tb + 0.2, fo + 0.25, zp), FA = P(mid, fo + 0.25, zp + rise);
    const B1 = P(ta - 0.2, -1.2, zp), B2 = P(tb + 0.2, -1.2, zp), BA = P(mid, -1.2, zp + rise);
    T.face([F1, F2, FA], [nx, ny, 0], [col[0] * 0.92, col[1] * 0.92, col[2] * 0.92]);
    T.face([B2, B1, BA], [-nx, -ny, 0], col);
    T.face([F1, FA, BA, B1], [-e.ux, -e.uy, 1], col);
    T.face([FA, F2, B2, BA], [e.ux, e.uy, 1], col);
    this.note(bbl, "trim", tt);
  }

  /** The deco parapet: the middle of the longest front raised in two steps. */
  private stepParapet(ring: P2[], z: number, col: number[], bbl: string) {
    let li = 0, ll = -1;
    for (let i = 0; i < ring.length; i++) { const L = Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]); if (L > ll) { ll = L; li = i; } }
    if (ll < 10) return;
    const a = ring[li], b = ring[(li + 1) % ring.length];
    const ux = (b[0] - a[0]) / ll, uy = (b[1] - a[1]) / ll, nx = uy, ny = -ux;
    const T = this.buf("trim"); const t0 = T.count;
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const P = (t: number, o: number, zz: number) => [a[0] + ux * t + nx * o, a[1] + uy * t + ny * o, zz];
    for (const [w, h] of [[0.5, 1.9], [0.26, 3.6]]) {
      const ta = ll * (0.5 - w / 2), tb = ll * (0.5 + w / 2), oa = -0.5, ob = 0.12;
      T.quad(P(ta, ob, z), P(tb, ob, z), P(tb, ob, z + h), P(ta, ob, z + h), [nx, ny, 0], q, col);
      T.quad(P(tb, oa, z), P(ta, oa, z), P(ta, oa, z + h), P(tb, oa, z + h), [-nx, -ny, 0], q, col);
      T.quad(P(ta, oa, z + h), P(ta, ob, z + h), P(tb, ob, z + h), P(tb, oa, z + h), [0, 0, 1], q, col);
      T.quad(P(ta, oa, z), P(ta, ob, z), P(ta, ob, z + h), P(ta, oa, z + h), [-ux, -uy, 0], q, col);
      T.quad(P(tb, ob, z), P(tb, oa, z), P(tb, oa, z + h), P(tb, ob, z + h), [ux, uy, 0], q, col);
    }
    this.note(bbl, "trim", t0);
  }

  /** Where a corner turret stands: a convex corner with a street on both sides; an octagon of radius r over it. */
  private turretAt(ring: P2[], r: number): { c: P2; ring: P2[] } | null {
    const n = ring.length;
    const street = (a: P2, b: P2) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return L >= 5 && !this.lotAt2D((a[0] + b[0]) / 2 + ((b[1] - a[1]) / L) * 6, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / L) * 6);
    };
    for (let i = 0; i < n; i++) {
      const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
      if (!street(p, c) || !street(c, q)) continue;
      const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(q[0] - c[0], q[1] - c[1]);
      const d1 = [(c[0] - p[0]) / l1, (c[1] - p[1]) / l1], d2 = [(q[0] - c[0]) / l2, (q[1] - c[1]) / l2];
      if (d1[0] * d2[1] - d1[1] * d2[0] <= 0.5) continue;               // a real corner, turning left
      const inw = [d2[0] - d1[0], d2[1] - d1[1]], il = Math.hypot(inw[0], inw[1]) || 1;
      const cc: P2 = [c[0] + (inw[0] / il) * r * 0.6, c[1] + (inw[1] / il) * r * 0.6];
      const outer: P2 = [cc[0] - (inw[0] / il) * r, cc[1] - (inw[1] / il) * r];
      const g = this.groundAt(outer[0], outer[1]);
      if (g === "road" || g === "bld") continue;
      const a0 = Math.atan2(-inw[1], -inw[0]);
      const oct: P2[] = Array.from({ length: 8 }, (_, k) => [cc[0] + Math.cos(a0 + (k / 8) * 6.2832 + 0.3927) * r, cc[1] + Math.sin(a0 + (k / 8) * 6.2832 + 0.3927) * r] as P2);
      return { c: cc, ring: oct };
    }
    return null;
  }

  /**
   * A HIPPED ROOF on a four-sided top, built on its own outline: every side a
   * slope at `pitch` (rise over run), up to a flat crest where the slopes
   * would meet, so a square top is a truncated pyramid with a deck rather than
   * a spike, and nothing can overhang. Dormers on the slopes if asked. Returns
   * the rise.
   */
  private hipRoof(r: P2[], z: number, col: number[], bbl: string, pitch: number, dormers: boolean): number {
    if (ringArea(r) < 0) r = r.slice().reverse();
    let short = Infinity;
    for (let i = 0; i < r.length; i++) short = Math.min(short, Math.hypot(r[(i + 1) % r.length][0] - r[i][0], r[(i + 1) % r.length][1] - r[i][1]));
    const d = Math.min(short * 0.5 * 0.72, 9);
    const top = insetRing(r, d);
    if (!top || top.length !== r.length || ringArea(top) <= 0) return 0;
    const rise = d * pitch;
    const R = this.buf("roof"); const r0 = R.count;
    let cx = 0, cy = 0; for (const [x, y] of r) { cx += x / r.length; cy += y / r.length; }
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], ta = top[i], tb = top[(i + 1) % r.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      R.face([[a[0], a[1], z], [b[0], b[1], z], [tb[0], tb[1], z + rise], [ta[0], ta[1], z + rise]], [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0.6], col);
      if (dormers && rise > 2.5) {
        const n = Math.floor(L / 5.5), rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          const ex = a[0] + (b[0] - a[0]) * t, ey = a[1] + (b[1] - a[1]) * t;
          const ix = ta[0] + (tb[0] - ta[0]) * t, iy = ta[1] + (tb[1] - ta[1]) * t;
          this.putInst("dormer", ex + (ix - ex) * 0.3, ey + (iy - ey) * 0.3, z + rise * 0.3 - 0.6, 1.5, rot, bbl);
        }
      }
    }
    let tris: number[][] = [];
    try { tris = THREE.ShapeUtils.triangulateShape(top.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { tris = []; }
    for (const t of tris) R.tri([top[t[0]][0], top[t[0]][1], z + rise], [top[t[1]][0], top[t[1]][1], z + rise], [top[t[2]][0], top[t[2]][1], z + rise], [0, 0, 1], col);
    this.note(bbl, "roof", r0);
    return rise;
  }

  /** A wedge top: the slope rising from edge AB at z to edge DC at z + rise, clad in the tower's own elevation. */
  private prismTop(A: P2, B: P2, C: P2, D: P2, z: number, rise: number, fam: string, tint: number[], bbl: string, k: number, ov?: VolumeOv) {
    const fk = ov?.variant ?? this.variantOf(fam, k);
    const f = this.families[fk];
    const W = this.buf("w:" + fk); const w0 = W.count;
    const out = (a: P2, b: P2) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0]; };
    const uvW = (p: number[]) => [(p[0] + p[1]) / f.bayW * 0.7, p[2] / f.floorH];
    const L1 = Math.hypot(B[0] - A[0], B[1] - A[1]), slope = Math.hypot(Math.hypot(D[0] - A[0], D[1] - A[1]), rise);
    W.painted(ov ? null : liveryFor(fam, k), () => {
      W.quad([C[0], C[1], z], [D[0], D[1], z], [D[0], D[1], z + rise], [C[0], C[1], z + rise], out(C, D), [[0, z / f.floorH], [L1 / f.bayW, z / f.floorH], [L1 / f.bayW, (z + rise) / f.floorH], [0, (z + rise) / f.floorH]], tint);
      W.face([[B[0], B[1], z], [C[0], C[1], z], [C[0], C[1], z + rise]], out(B, C), tint, uvW);
      W.face([[D[0], D[1], z], [A[0], A[1], z], [D[0], D[1], z + rise]], out(D, A), tint, uvW);
      const n = out(A, B), sl = [n[0] * rise / slope, n[1] * rise / slope, Math.hypot(D[0] - A[0], D[1] - A[1]) / slope];
      W.quad([A[0], A[1], z], [B[0], B[1], z], [C[0], C[1], z + rise], [D[0], D[1], z + rise], sl, [[0, 0], [L1 / f.bayW, 0], [L1 / f.bayW, slope / f.floorH], [0, slope / f.floorH]], tint);
    });
    this.note(bbl, "w:" + fk, w0);
  }

  /**
   * A canted bay per house front on the street walls of a row: a wide front
   * light and two narrow cheeks, in the house's own elevation and paint, from
   * the area to the cornice, with its own little cornice and lead-flat top.
   * Beside the stoop where there is one, and only where it projects over the
   * house's own area or the footway, never the carriageway or a neighbour.
   */
  private bayWindows(ring: P2[], bbl: string, famKey: string, seedK: number, zw: number, tint: number[], livery: Livery | null, ov?: VolumeOv) {
    const fk = ov?.variant ?? this.variantOf(famKey, seedK);
    const f = this.families[fk];
    const W = this.buf("w:" + fk), R = this.buf("roof"), T = this.buf("trim");
    const w0 = W.count, r0 = R.count, t0 = T.count;
    const D = 0.75, FW = 0.9, BW = 1.45;            // depth, half front, half back (m)
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const cap = livery && livery.trim[0] >= 0 ? livery.trim.map((c, i) => c / TRIM_LIN[i]) : [1, 1, 1];
    const side = hash01(seedK ^ 0xba2, 3) < 0.5 ? -1 : 1;
    const g = this.groundIndex();
    for (const e of this.streetEdges(ring, 5.5)) {
      const nx = e.uy, ny = -e.ux;
      const n = Math.max(1, Math.floor(e.L / 6.2));
      for (let k = 0; k < n; k++) {
        const tc = (k + 0.5) * (e.L / n) + side * 1.65;
        if (tc - BW < 0.4 || tc + BW > e.L - 0.4) continue;
        const P = (t: number, o: number): P2 => [e.a[0] + e.ux * t + nx * o, e.a[1] + e.uy * t + ny * o];
        const BL = P(tc - BW, 0), FL = P(tc - FW, D), FR = P(tc + FW, D), BR = P(tc + BW, 0);
        const out = this.groundAt(...P(tc, D + 0.6));
        if (out === "bld" || out === "road" || this.groundAt(...FL) === "bld" || this.groundAt(...FR) === "bld") continue;
        // the three faces: a narrow cheek, the front light, a narrow cheek
        const faces: [P2, P2, number, number][] = [[BL, FL, 0.17, 0.83], [FL, FR, 0, 1], [FR, BR, 0.17, 0.83]];
        W.painted(livery, () => {
          for (const [a, b, u0, u1] of faces) {
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const nn = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0];
            W.quad([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], zw], [a[0], a[1], zw], nn, [[u0, 0], [u1, 0], [u1, zw / f.floorH], [u0, zw / f.floorH]], tint);
          }
        });
        // its top, and a small cornice round its three faces
        R.face([[BL[0], BL[1], zw], [FL[0], FL[1], zw], [FR[0], FR[1], zw], [BR[0], BR[1], zw]], [0, 0, 1], [0.5, 0.48, 0.46]);
        for (const [a, b] of faces) {
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const ox = (b[1] - a[1]) / L * 0.22, oy = -(b[0] - a[0]) / L * 0.22;
          T.quad([a[0] + ox, a[1] + oy, zw - 0.45], [b[0] + ox, b[1] + oy, zw - 0.45], [b[0] + ox, b[1] + oy, zw + 0.05], [a[0] + ox, a[1] + oy, zw + 0.05], [ox, oy, 0], q, cap);
          T.quad([a[0], a[1], zw + 0.05], [a[0] + ox, a[1] + oy, zw + 0.05], [b[0] + ox, b[1] + oy, zw + 0.05], [b[0], b[1], zw + 0.05], [0, 0, 1], q, cap);
        }
        // a tree or a parked car must not stand in it
        if (!this.sandbox) g.bld.add([BL, FL, FR, BR]);
      }
    }
    this.note(bbl, "w:" + fk, w0); this.note(bbl, "roof", r0); this.note(bbl, "trim", t0);
  }

  /**
   * THE FRONT DOOR. An apartment house or an office building has an entrance
   * on its main street front: a door in a stone surround, and above it on
   * an apartment house of six floors or more a fabric marquee (the dark
   * green, burgundy, navy or black of the city's canopies); on a tower a
   * steel-and-glass canopy over the lobby doors. One per building, on its
   * longest street-facing wall. Row houses keep their stoops instead.
   */
  private entrance(ring: P2[], bbl: string, famKey: string, cls: string, seedK: number, z1: number, tower: boolean) {
    if (cls !== "multifamily" && cls !== "office" && cls !== "mixed") return;
    if (famKey === "industrial" || famKey === "plain" || famKey === "clapboard" || famKey === "brownstone") return;
    if (z1 < 9) return;
    const edges = this.streetEdges(ring, 8);
    if (!edges.length) return;
    const e = edges.reduce((a, b) => (b.L > a.L ? b : a));
    const t = e.L * (0.35 + 0.3 * hash01(seedK ^ 0xd00, 5));
    const x = e.a[0] + e.ux * t, y = e.a[1] + e.uy * t;
    const nx = e.uy, ny = -e.ux;
    // the doorstep must open on a footway or a forecourt, not a neighbour's wall or the road
    const front = this.groundAt(x + nx * 1.5, y + ny * 1.5);
    if (front === "bld" || front === "road") return;
    this.putInst("door", x, y, 0.15, 1, e.r, bbl);
    if (tower) this.putInst("entcanopy", x, y, 0, 1, e.r, bbl);
    else if (cls === "multifamily" && z1 >= 18) {
      const MC = [[0.16, 0.26, 0.2], [0.36, 0.12, 0.14], [0.14, 0.17, 0.28], [0.1, 0.1, 0.11]];
      this.putInst("marquee", x, y, 0, 1, e.r, bbl, MC[Math.floor(hash01(seedK ^ 0xd01, 5) * MC.length)]);
    }
  }
  private lotAt2D(x: number, y: number): boolean {
    const grid = this.pickIndex(), C = RealCityLayer.PICK_CELL;
    const cell = grid.get(Math.floor(x / C) * 100003 + Math.floor(y / C));
    if (!cell) return false;
    for (const e of cell) {
      if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) continue;
      const r = e.ring;
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
  /** Shop bays per deed: canopy, sign and hoarding, by instanced mesh and index. */
  private bays = new Map<string, { awn: [THREE.InstancedMesh, number]; sign: [THREE.InstancedMesh, number]; board: [THREE.InstancedMesh, number]; m: THREE.Matrix4[]; o: number; st: boolean }[]>();
  private registerBays(meshes: Map<string, THREE.InstancedMesh>, items: Map<string, { bbl: string }[]>, st: boolean) {
    const by = new Map<string, Record<string, number[]>>();
    for (const kind of ["awning", "shopsign", "boards"]) {
      (items.get(kind) ?? []).forEach((it, i) => {
        if (!it.bbl) return;
        let r = by.get(it.bbl); if (!r) by.set(it.bbl, (r = { awning: [], shopsign: [], boards: [] }));
        r[kind].push(i);
      });
    }
    const A = meshes.get("awning"), S = meshes.get("shopsign"), B = meshes.get("boards");
    if (!A || !S || !B) return;
    for (const [bbl, r] of by) {
      const list = r.awning.map((ai, k) => {
        const m = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
        A.getMatrixAt(ai, m[0]); S.getMatrixAt(r.shopsign[k], m[1]); B.getMatrixAt(r.boards[k], m[2]);
        return { awn: [A, ai] as [THREE.InstancedMesh, number], sign: [S, r.shopsign[k]] as [THREE.InstancedMesh, number], board: [B, r.boards[k]] as [THREE.InstancedMesh, number], m, o: hash01(k * 7919 + bbl.length, 5), st };
      });
      // a building's empties fall on a stable set of bays: lowest draw first
      list.sort((p, q) => p.o - q.o);
      this.bays.set(bbl, list);
    }
  }
  /** Board up as many bays as the building's retail is empty; open the rest. */
  private applyBays(bbl: string) {
    const list = this.bays.get(bbl);
    if (!list) return;
    const flat = list[0]?.st && this.flattened.has(bbl);
    const rt = this.ret.get(bbl);
    const dead = rt === undefined ? 0 : Math.round((1 - Math.max(0, Math.min(1, rt))) * list.length);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    list.forEach((b, i) => {
      const shut = i < dead;
      b.awn[0].setMatrixAt(b.awn[1], flat || shut ? zero : b.m[0]);
      b.sign[0].setMatrixAt(b.sign[1], flat || shut ? zero : b.m[1]);
      b.board[0].setMatrixAt(b.board[1], flat || !shut ? zero : b.m[2]);
      b.awn[0].instanceMatrix.needsUpdate = b.sign[0].instanceMatrix.needsUpdate = b.board[0].instanceMatrix.needsUpdate = true;
    });
  }

  // ---- ambient shade ---------------------------------------------------------
  // HOW DEEP A STREET IS. Mean building height on a 60 m grid, from the
  // volumes themselves; the shade at the foot of a wall climbs about a third
  // of the way up its neighbours (an avenue of walk-ups: ~4 m; a canyon of
  // towers: ~25 m). Calibrated by eye against street photographs, not a
  // measured constant.
  private canyonGrid: Map<number, number> | null = null;
  private canyonAt(x: number, y: number): number {
    if (!this.canyonGrid) {
      const sum = new Map<number, number>(), n = new Map<number, number>(), C = 60;
      for (const v of this.volumes) {
        if (v.d || v.k || !v.b || v.z0 > 0.5) continue;
        const [px, py] = this.project(v.r[0]);
        const key = Math.floor(px / C) * 100003 + Math.floor(py / C);
        sum.set(key, (sum.get(key) ?? 0) + v.z1); n.set(key, (n.get(key) ?? 0) + 1);
      }
      this.canyonGrid = new Map();
      for (const [k2, sm] of sum) this.canyonGrid.set(k2, sm / (n.get(k2) ?? 1));
    }
    const C = 60, cx = Math.floor(x / C), cy = Math.floor(y / C);
    let acc = 0, cnt = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const h = this.canyonGrid.get((cx + i) * 100003 + (cy + j));
      if (h !== undefined) { acc += h; cnt++; }
    }
    const mean = cnt ? acc / cnt : 10;
    return Math.min(26, Math.max(3.5, mean * 0.35));
  }
  /** 1 for a wall that looks out on open ground; darker the closer another building stands in front of it. */
  private facing(a: P2, b: P2, n: number[]): number {
    const g = this.groundIndex();
    let k = 1;
    for (const f of [0.3, 0.7]) {
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      if (g.bld.hit(x + n[0] * 3, y + n[1] * 3)) k = Math.min(k, 0.72);
      else if (g.bld.hit(x + n[0] * 7, y + n[1] * 7)) k = Math.min(k, 0.84);
      else if (g.bld.hit(x + n[0] * 12, y + n[1] * 12)) k = Math.min(k, 0.93);
    }
    return k;
  }
  /**
   * WHERE A BUILDING MEETS THE GROUND. A soft dark band on the ground round
   * every footprint, darkest at the wall, gone two to four metres out (wider
   * for a taller building): the contact shade sky light leaves at the foot of
   * any wall, which is what seats a building on its street instead of
   * pasting it on. Drawn just above the footway slab, never casting.
   */
  private contactShadow(ring0: P2[], bbl: string, z1: number) {
    const ring = ringArea(ring0) < 0 ? ring0.slice().reverse() : ring0;
    const B = this.buf("contact"), c0 = B.count;
    const w = Math.min(4, 1.8 + z1 * 0.025), Z = 0.17, A = 0.36;
    const n = ring.length;
    const nOf = (i: number) => { const a = ring[i], b = ring[(i + 1) % n]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]; };
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.2) continue;
      const [nx, ny] = nOf(i);
      B.quad([a[0], a[1], Z], [b[0], b[1], Z], [b[0] + nx * w, b[1] + ny * w, Z], [a[0] + nx * w, a[1] + ny * w, Z], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [A, 0, 0]);
      // fix the far edge to transparent: the quad's last two vertices carry alpha 0
      const end = B.col.length;
      for (const vi of [2, 4, 5]) B.col[end - (6 - vi) * 3] = 0;
      // the convex corner after this edge: a fan between the two bands
      const [mx, my] = nOf((i + 1) % n);
      const cr = nx * my - ny * mx;
      if (cr > 0.01) {   // convex: the outward normal turns counter-clockwise
        for (let s2 = 0; s2 < 3; s2++) {
          const t1 = s2 / 3, t2 = (s2 + 1) / 3;
          const d1 = [nx + (mx - nx) * t1, ny + (my - ny) * t1], d2 = [nx + (mx - nx) * t2, ny + (my - ny) * t2];
          const l1 = Math.hypot(d1[0], d1[1]) || 1, l2 = Math.hypot(d2[0], d2[1]) || 1;
          B.tri([b[0], b[1], Z], [b[0] + (d1[0] / l1) * w, b[1] + (d1[1] / l1) * w, Z], [b[0] + (d2[0] / l2) * w, b[1] + (d2[1] / l2) * w, Z], [0, 0, 1], [A, 0, 0]);
          const e2 = B.col.length;
          B.col[e2 - 6] = 0; B.col[e2 - 3] = 0;
        }
      }
    }
    this.note(bbl, "contact", c0);
  }
  private vehMat: THREE.MeshStandardMaterial | null = null;
  private vehicleMat() {
    if (!this.vehMat) this.vehMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.38, vertexColors: true, envMapIntensity: 0.9 });
    return this.vehMat;
  }
  private contactMat = (() => {
    const m = new THREE.MeshBasicMaterial({ color: 0x0c0f14, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // the vertex colour's red channel is the shade's opacity
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", "diffuseColor.a *= vColor.r;");
    };
    m.customProgramCacheKey = () => "bw-contact";
    return m;
  })();

  /**
   * The neighbourhood's own number: a few streets (a ~380 m cell) that were
   * laid out and built together, so a revival quarter is a quarter and not a
   * scatter (familyFor's nb). Stable per town.
   */
  private nbOf(ring: P2[]): number {
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x / ring.length; cy += y / ring.length; }
    return hash01((Math.floor(cx / 380) * 7919) ^ (Math.floor(cy / 380) * 104729) ^ 0x6e62, this.seed);
  }

  /** Which of the family's elevations this deed wears (stable per deed). */
  private variantOf(fk: string, seedK: number): string {
    const n = Math.floor(hash01(seedK ^ 0x7a11, 3) * (1 + (VARIANTS[fk.split("#")[0]]?.length ?? 3)));
    const key = n ? `${fk}#${n}` : fk;
    return this.families[key] ? key : fk;
  }

  /** One volume: walls in its family, a roof, and its trim. */
  private addVolume(ring: P2[], z0: number, z1: number, famKey: string, tint: number[], bbl: string, crown: boolean, plant: boolean, seedK: number, shop = false, pitched = false, cls = "", year = 0, ov?: VolumeOv) {
    const fam = this.families[famKey];
    if (bbl && !this.sandbox) { let l = this.volLog.get(bbl); if (!l) this.volLog.set(bbl, (l = [])); l.push({ r: ring, z0, z1 }); }
    if (ringArea(ring) < 0) ring = ring.slice().reverse();     // counter-clockwise: outward normals
    // THE MANSARD. A Second Empire walk-up finishes its top storey as a steep
    // slate roof with dormers rather than a wall — the "French flat" of the
    // 1860s-1900s. The walls stop a storey short and the cornice sits there.
    let ringC = [0, 0];
    for (const [x, y] of ring) { ringC[0] += x / ring.length; ringC[1] += y / ring.length; }
    let rad = 0; for (const [x, y] of ring) rad += Math.hypot(x - ringC[0], y - ringC[1]) / ring.length;
    const mans = ov?.roof ? ov.roof === "mansard" && crown && rad > 4 && z1 - z0 > 6
      : crown && plant && !pitched && year > 1855 && year < 1915 && rad > 5
      && (famKey === "brick" || famKey === "buff" || famKey === "brownstone" || famKey === "stone" || famKey === "castiron")
      && z1 - z0 > 9 && z1 < 34 && hash01(seedK ^ 0x3a5, 7) < 0.4;
    const zw = mans ? z1 - fam.floorH * 0.95 : z1;            // where the walls stop
    const style: ArchStyle = styleOf(famKey, year, z1);
    // the owner's paint: a scheme per deed, only on the building's own
    // elevation (a shop storey and a lobby keep theirs), and never over a
    // design the player chose from a swatch
    const livery = ov ? null : liveryFor(famKey, seedK);
    if (bbl && z0 < 0.5 && !this.sandbox) this.looks.set(bbl, `${ov?.variant ?? this.variantOf(famKey, seedK)}|${tint.join(",")}|${livery?.key ?? "-"}`);
    const walls = (fk0: string, za: number, zb: number, vOff: number, tn: number[], rr: P2[] = ring) => {
      const fk = fk0.includes("#") ? fk0 : fk0 === famKey && ov?.variant ? ov.variant : this.variantOf(fk0, seedK);
      const f = this.families[fk];
      const wallName = "w:" + fk;
      const W = this.buf(wallName);
      W.painted(fk0 === famKey ? livery : null, () => wallsOf(wallName, f, W, za, zb, vOff, tn, rr));
    };
    const wallsOf = (wallName: string, f: Family, W: Buf, za: number, zb: number, vOff: number, tn: number[], rr: P2[]) => {
      const w0 = W.count;
      let uRun = 0;
      const canyon = this.canyonAt(ringC[0], ringC[1]);
      for (let i = 0; i < rr.length; i++) {
        const a = rr[i], b = rr[(i + 1) % rr.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < 0.05) continue;
        const n = [dy / L, -dx / L, 0];
        // A WALL THAT FACES A WALL is in shade all day: a light well, an
        // alley, a courtyard. Probe out from the middle of the wall.
        const close = bbl ? this.facing(a, b, n) : 1;
        const tE = close < 1 ? [tn[0] * close, tn[1] * close, tn[2] * close] : tn;
        W.aoH = za < 0.5 ? canyon * (close < 1 ? 1.4 : 1) : 3.5;
        // whole bays per run, so every corner falls between two windows
        const bays = Math.max(1, Math.round(L / f.bayW));
        const u0 = uRun, u1 = uRun + bays;
        uRun = u1;
        const v0 = (za - vOff) / f.floorH, v1 = (zb - vOff) / f.floorH;
        W.quad([a[0], a[1], za], [b[0], b[1], za], [b[0], b[1], zb], [a[0], a[1], zb], n,
          [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], tE);
      }
      W.aoH = 3.5;
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
      if (WALKUP.has(famKey) && z1 > 8 && z1 < 34 && ll > 7 && roll < 0.6) {
        const t = ll * (0.3 + 0.4 * ((seedK >> 3) % 100) / 100);
        for (let fl = 1; fl < floors; fl++) {
          this.putInst("fesc", A[0] + ux * t + nx * 0.6, A[1] + uy * t + ny * 0.6, z0 + fl * f.floorH + 0.05, 1, rot + (fl % 2 ? Math.PI : 0), bbl, undefined, f.floorH / 3.2);
        }
      } else if ((famKey === "modern" || famKey === "fibercement" || famKey === "metalpanel" || famKey === "whitebrick" || famKey === "precast") && z1 < 48 && ll > 9 && roll < 0.65) {
        const bays = Math.max(1, Math.round(ll / f.bayW));
        for (let bi = 1; bi < bays; bi += 2) {
          const t = (bi + 0.5) * (ll / bays);
          for (let fl = 1; fl < floors; fl++) {
            this.putInst("balc", A[0] + ux * t, A[1] + uy * t, z0 + fl * f.floorH, 1, rot, bbl);
          }
        }
      }
    }
    if (z0 < 0.5 && bbl) this.contactShadow(ring, bbl, z1);
    const fh = fam.floorH;
    let baseH = 0;                                           // a rusticated base storey's height, if it has one
    // A trading ground floor is its own storey: display glass under awnings,
    // the upper floors' windows starting above it.
    const shopH = this.families.shop.floorH;
    // THE MODERNIST GROUND FLOOR. The International Style lifted its slab
    // off the street on columns — pilotis — and set the lobby glass back
    // behind them, so the tower floats over a shaded colonnade.
    const pil = z0 < 0.5 && style === "modernist" && zw > 14 && ring.length <= 12 && !shop
      && hash01(seedK ^ 0x9111, 3) < (zw > 36 ? 0.5 : 0.3) ? insetRing(ring, 2.6) : null;
    if (pil && Math.abs(ringArea(pil)) > 0.35 * Math.abs(ringArea(ring)) && pil.every(([x, y]) => PolyGrid.inRing(ring, x, y))) {
      const lh = zw > 36 ? this.families.lobby.floorH : Math.min(6, fam.floorH * 1.5);
      walls("lobby", z0, lh, 0, [1, 1, 1], pil);
      walls(famKey, lh, zw, lh, tint);
      this.soffit(ring, pil, lh, bbl, [0.86, 0.86, 0.84]); this.feat("pilotis", bbl);
      this.colonnade(ring, 0.55, 6.5, lh, "piloti", bbl);
    } else if (style === "spanish" && shop && z0 < 0.5 && zw > 7.5) {
      // the Spanish Revival shop row trades behind an arcade
      const ah = this.families.arcade.floorH;
      walls("arcade", z0, ah, 0, [1, 1, 1]); this.feat("arcade", bbl);
      walls(famKey, ah, zw, ah, tint);
    } else if (shop && z0 < 0.5 && zw > shopH + 2.5) {
      walls("shop", z0, shopH, 0, [1, 1, 1]);
      walls(famKey, shopH, zw, shopH, tint);
      if (bbl) this.shopBays(ring, bbl, seedK, shopH, famKey);
    } else if (TOWER_FAMS.has(famKey) && z0 < 0.5 && zw > 36) {
      // a tower stands on a double-height glass lobby
      const lh = this.families.lobby.floorH;
      walls("lobby", z0, lh, 0, [1, 1, 1]);
      walls(famKey, lh, zw, lh, tint);
      if (bbl) this.entrance(ring, bbl, famKey, cls, seedK, z1, true);
    } else if (z0 < 0.5 && zw > 16 && !ov && hash01(seedK ^ 0x5b5, 3) < (RUSTIC_BASE[famKey] ?? 0)) {
      // A STONE FRONT STANDS ON A RUSTICATED BASE: the ground storey in long
      // channelled blocks with round-headed openings, the string course over
      // it, the elevation proper above — Beaux-Arts, Romanesque, deco.
      const rv = famKey === "romanesque" ? "rustic#2" : famKey === "deco" || famKey === "decobrick" ? "rustic#1" : this.variantOf("rustic", seedK);
      baseH = this.families.rustic.floorH;
      walls(rv, z0, baseH, 0, tint);
      walls(famKey, baseH, zw, baseH, tint);
      if (bbl) this.entrance(ring, bbl, famKey, cls, seedK, z1, false);
    } else {
      walls(famKey, z0, zw, 0, tint);
      if (bbl && z0 < 0.5) this.streetDress(ring, bbl, famKey, cls, seedK, z1);
      if (bbl && z0 < 0.5) this.entrance(ring, bbl, famKey, cls, seedK, z1, false);
      // BAY WINDOWS. A row house's front is not a flat wall: the brownstone
      // and the Victorian brick row push a canted bay out over the area,
      // one to a house beside the stoop, ground to cornice.
      if (bbl && z0 < 0.5 && plant && !mans && cls === "multifamily" && zw > 6 && zw <= 22 && hash01(seedK ^ 0xba1, 3) < (BAY_P[famKey] ?? 0)) {
        this.bayWindows(ring, bbl, famKey, seedK, zw, tint, livery, ov);
      }
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
      Wg.painted(livery, () => {
        Wg.face([[B[0], B[1], z1], [C[0], C[1], z1], M1], [C[1] - B[1], -(C[0] - B[0]), 0], tint, uvG);
        Wg.face([[D[0], D[1], z1], [A[0], A[1], z1], M2], [A[1] - D[1], -(A[0] - D[0]), 0], tint, uvG);
      });
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
    // a repainted trim carries up to the cornice, so a house is one scheme
    // (vertex colours multiply the trim material's own cream: divide it out)
    const liv = livery && livery.trim[0] >= 0 && (fam.masonry || famKey === "clapboard") ? livery.trim.map((c, i) => c / TRIM_LIN[i]) : null;
    const white = ov?.trim !== undefined ? TRIM_PAINTS[ov.trim]?.rgb ?? [1, 1, 1]
      : liv ?? (fam.masonry || famKey === "clapboard" ? TRIM[Math.floor(hash01(seedK ^ 0x71a, 5) * TRIM.length)] : [1, 1, 1]);
    // the Chicago school always crowns its block with a deep projecting
    // cornice; the rest draw one of four
    const corn = style === "chicago" ? 1 : Math.floor(hash01(seedK ^ 0xc0e, 9) * 4);   // 0 standard, 1 deep, 2 stripped, 3 double
    if (fam.masonry) {
      if (crown && zw - z0 > 4 && !pitched) {
        if (corn === 1 || mans) {
          band(zw - 1.1, 0.95, style === "chicago" ? 1.3 : 0.85, white);            // a deep bracketed cornice
          band(zw - 1.45, 0.35, 0.3, white);
        } else if (corn === 2) {
          band(zw - 0.45, 0.4, 0.12, white);            // stripped back to a coping
        } else {
          band(zw - 0.75, 0.6, 0.55, white);            // the cornice
          band(zw - 1.05, 0.3, 0.22, white);            // its bed moulding
          if (corn === 3 && zw - z0 > fh * 3) band(zw - fh - 0.4, 0.3, 0.25, white);   // a second course a floor down
        }
      }
      if (z0 < 0.5 && z1 > fh * 1.6) band((baseH || fh) + 0.05, baseH ? 0.45 : 0.28, baseH ? 0.22 : 0.14, white);   // string course
      // MODILLIONS. A deep cornice is carried on brackets — a row of small
      // scrolled blocks under the soffit, about a metre apart.
      if (crown && !pitched && zw - z0 > 4 && (corn === 1 || mans)) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 1.5) continue;
          const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = uy, ny = -ux;
          const n = Math.floor(L / 0.95), zb = zw - 1.1, zt = zb, zl = zb - 0.42;
          for (let j = 0; j < n; j++) {
            const t = (j + 0.5) * (L / n), x = a[0] + ux * t, y = a[1] + uy * t, hw = 0.09, d = 0.7;
            const p = (s0: number, o: number, z: number) => [x + ux * s0 * hw + nx * o, y + uy * s0 * hw + ny * o, z];
            const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
            T.quad(p(-1, d, zl), p(1, d, zl), p(1, d * 0.6, zt), p(-1, d * 0.6, zt), [nx, ny, -0.4], q, white);
            T.quad(p(-1, 0, zl), p(-1, d, zl), p(-1, d, zt), p(-1, 0, zt), [-ux, -uy, 0], q, white);
            T.quad(p(1, d, zl), p(1, 0, zl), p(1, 0, zt), p(1, d, zt), [ux, uy, 0], q, white);
            T.quad(p(-1, 0, zl), p(1, 0, zl), p(1, d, zl), p(-1, d, zl), [0, 0, -1], q, white);
          }
        }
      }
      // QUOINS. The corners of a Georgian or Beaux-Arts front are dressed in
      // alternating long and short blocks, proud of the wall.
      if (z0 < 0.5 && zw - z0 > 5 && !ov && hash01(seedK ^ 0x9017, 3) < (QUOIN_P[famKey] ?? 0)) {
        const qz0 = baseH || 0, qh = 0.62;
        for (let i = 0; i < ring.length; i++) {
          const pv = ring[(i + ring.length - 1) % ring.length], c = ring[i], nx0 = ring[(i + 1) % ring.length];
          const l1 = Math.hypot(c[0] - pv[0], c[1] - pv[1]), l2 = Math.hypot(nx0[0] - c[0], nx0[1] - c[1]);
          if (l1 < 3 || l2 < 3) continue;
          const d1 = [(c[0] - pv[0]) / l1, (c[1] - pv[1]) / l1], d2 = [(nx0[0] - c[0]) / l2, (nx0[1] - c[1]) / l2];
          // a convex corner of a counter-clockwise ring turns left, and not too gently
          if (d1[0] * d2[1] - d1[1] * d2[0] <= 0.35) continue;
          const n1 = [d1[1], -d1[0]], n2 = [d2[1], -d2[0]], o = 0.07, q = [[0, 0], [1, 0], [1, 1], [0, 1]];
          for (let z = qz0 + 0.1, k = 0; z + qh < zw - 1.2; z += qh + 0.04, k++) {
            const w1 = k % 2 ? 0.55 : 0.95, w2 = k % 2 ? 0.95 : 0.55;
            // face one: back along the incoming wall; face two: on along the outgoing
            const A = [c[0] - d1[0] * w1 + n1[0] * o, c[1] - d1[1] * w1 + n1[1] * o], B = [c[0] + n1[0] * o, c[1] + n1[1] * o];
            T.quad([A[0], A[1], z], [B[0], B[1], z], [B[0], B[1], z + qh], [A[0], A[1], z + qh], [n1[0], n1[1], 0], q, white);
            const C = [c[0] + n2[0] * o, c[1] + n2[1] * o], D = [c[0] + d2[0] * w2 + n2[0] * o, c[1] + d2[1] * w2 + n2[1] * o];
            T.quad([C[0], C[1], z], [D[0], D[1], z], [D[0], D[1], z + qh], [C[0], C[1], z + qh], [n2[0], n2[1], 0], q, white);
            T.quad([A[0], A[1], z + qh], [B[0], B[1], z + qh], [c[0], c[1], z + qh], [c[0] - d1[0] * w1, c[1] - d1[1] * w1, z + qh], [0, 0, 1], q, white);
          }
        }
      }
    } else if (fam.glass) {
      if (crown) band(z1 - 0.5, 0.5, 0.08, white);      // parapet cap
      if (z0 < 0.5 && z1 > 20) band(0, 5.2, 0.35, white); // lobby
    } else if (crown) {
      band(z1 - 0.35, 0.35, 0.12, white);               // coping
    }
    // A FLAT ROOF IS FENCED BY ITS PARAPET: a knee-high wall standing above
    // the deck, its inside face toward the roof so the far side reads from
    // above, and a coping on top. A masonry parapet sits behind its cornice.
    // THE MID-CENTURY ROOF is a thin slab run out past the walls on every
    // side, its edge a crisp white line and its soffit in shade.
    const slab = crown && !pitched && !mans && style === "midcentury" && zw - z0 <= 18 && hash01(seedK ^ 0x51ab2, 3) < 0.7;
    if (slab) { this.roofSlab(ring, z1, 1.3, bbl, roofTone(famKey, cls, false, seedK)); this.feat("slab", bbl); }
    // A CLASSICAL ROOF IS FENCED BY A BALUSTRADE: posts at the bays and turned
    // balusters between, on a plinth, under a rail.
    const balus = crown && !pitched && !mans && !slab && style === "classical" && fam.masonry && zw - z0 > 6 && hash01(seedK ^ 0xba7, 3) < 0.6;
    if (balus) { this.balustrade(ring, z1, white, bbl); this.feat("balustrade", bbl); }
    if (crown && !pitched && !mans && !saw && !slab && !balus && z1 - z0 > 3.5) {
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
    if (bbl && z0 < 0.5 && crown && !pitched && !mans) {
      // THE TEMPLE FRONT: a giant order of engaged columns across the middle
      // of the main street front, base to cornice, and a pediment over them.
      if (style === "classical" && zw <= 45 && zw - (baseH || 0) > 8 && hash01(seedK ^ 0x7e3, 3) < (famKey === "georgian" ? 0.25 : 0.4)) { this.templeFront(ring, baseH, zw, white, bbl); this.feat("temple", bbl); }
      // THE DECO PARAPET steps up in the middle of the front, twice.
      if (style === "deco" && zw - z0 > 10 && zw < 90) { this.stepParapet(ring, zw + (fam.masonry ? 1 : 0.6), white, bbl); this.feat("decoparapet", bbl); }
    }
    // THE QUEEN ANNE TURRET: a round-ish tower on the street corner, a
    // storey taller than the eaves, under its own steep roof.
    if (bbl && z0 < 0.5 && crown && style === "victorian" && zw > 6 && zw <= 18 && (cls === "multifamily" || cls === "retail") && hash01(seedK ^ 0x7a1, 3) < 0.3) {
      const t = this.turretAt(ring, 2.2);
      if (t) {
        const zt = zw + fam.floorH * 0.9; this.feat("turret", bbl);
        walls(famKey, z0, zt, 0, tint, t.ring);
        const rr = t.ring.map(([x, y]: P2) => [t.c[0] + (x - t.c[0]) * 1.08, t.c[1] + (y - t.c[1]) * 1.08] as P2);
        const R2 = this.buf("roof"); const q0 = R2.count;
        const rise = 2.2 * 2.3, top = [t.c[0], t.c[1], zt + rise];
        const rc2 = roofLin(hash01(seedK ^ 0x7a2, 3) < 0.6 ? "#4e5056" : hash01(seedK ^ 0x7a3, 3) < 0.5 ? "#7a4a3a" : "#6f9f8a");
        for (let i = 0; i < rr.length; i++) {
          const a = rr[i], b = rr[(i + 1) % rr.length];
          R2.face([[a[0], a[1], zt], [b[0], b[1], zt], top], [(a[0] + b[0]) / 2 - t.c[0], (a[1] + b[1]) / 2 - t.c[1], 0.5], rc2);
        }
        this.note(bbl, "roof", q0);
        this.putInst("pinnacle", t.c[0], t.c[1], zt + rise - 1.2, 0.3, 0, bbl, [0.3, 0.3, 0.32]);
      }
    }

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
      const oldWalk = TANK_FAMS.has(famKey);
      if (area > 160 && rnd() < 0.7) { const q = spot(0, 0.3); if (q) this.putInst("bulk", q[0], q[1], z1, 1, rot, bbl); }
      if (oldWalk && z1 > 17 && z1 < 95 && area > 120 && rnd() < 0.62) {
        const n = area > 900 && rnd() < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) { const q = spot(0.45, 0.75); if (q) this.putInst("tank", q[0], q[1], z1, 0.9 + rnd() * 0.3, rnd() * 6.28, bbl); }
      }
      // WHAT ELSE IS ON A ROOF. A deck of boards with planters on an
      // apartment block (a third of those under 60 m); solar panels in tilted
      // rows on a newer low building; the odd satellite dish on a walk-up.
      if (cls === "multifamily" && z1 < 60 && area > 220 && famKey !== "industrial" && rnd() < 0.33) {
        const q = spot(0.15, 0.45); if (q) this.putInst("roofdeck", q[0], q[1], z1, 1, rot, bbl);
      }
      if (year >= 1990 && z1 < 26 && area > 300 && (TOWER_FAMS.has(famKey) || cls === "retail" || cls === "industrial") && rnd() < 0.4) {
        const n = Math.min(8, 2 + Math.floor(area / 400));
        for (let i = 0; i < n; i++) { const q = spot(0.2, 0.75); if (q) this.putInst("solar", q[0], q[1], z1, 1, rot, bbl); }
      }
      if (oldWalk && cls === "multifamily" && z1 < 30 && rnd() < 0.18) { const q = spot(0.6, 0.85); if (q) this.putInst("dish", q[0], q[1], z1, 1, rnd() * 6.28, bbl); }
      if ((TOWER_FAMS.has(famKey) || famKey === "plain" || cls === "retail") && area > 200) {
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
          if (!this.clearOfBuildings(x, y, 2.6)) continue;
          this.putInst(lrnd() < 0.62 ? "lotcar" : "lotsuv", x, y, 0.04, 1, Math.atan2(uy, ux) + Math.PI / 2, "", CARC[(lrnd() * CARC.length) | 0]);
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
      const fam = familyFor(v.c, v.y || 1950, top, hash01(k ^ 0x3c1f, this.seed), v.t ?? 4, this.nbOf(ring));
      if (v.z1 >= top - 0.01 && v.b) this.famOf.set(v.b, `${fam}|${Math.round(top)}|${v.y || 0}|${v.c}`);
      const tints = TINTS[fam];
      // a district's buildings mostly share a batch of the same brick or paint
      const tr = hash01(k, this.seed);
      const t = tints[tr < 0.55 ? ((v.t ?? 0) * 3 + 1) % tints.length : Math.floor(((tr - 0.55) / 0.45) * tints.length)];
      // a trading ground floor, by what the building is: the iron front
      // always; the old walk-up often; the new mixed-use block as a rule
      const shopP = ({ castiron: 1, brick: 0.5, gothic: 0.3, georgian: 0.2, romanesque: 0.3, buff: 0.3, stone: 0.3, terracotta: 0.4, modern: 0.35, whitebrick: 0.2,
        stucco: 0.25, moderne: 0.4, midcentury: 0.3, fibercement: 0.5, metalpanel: 0.45, stackbrick: 0.5, rainscreen: 0.4, timber: 0.4 } as Record<string, number>)[fam] ?? 0;
      const shop = v.c === "retail" || (v.c !== "industrial" && hash01(k ^ 0x51ab, this.seed) < shopP);
      // old low brick houses keep a pitched roof: a row of 1890s three-storey
      // walk-ups is a run of gables, not a run of flat decks
      const isTop = v.z1 >= top - 0.01 || v.x === 1;
      const pitched = isTop && (fam === "brick" || fam === "clapboard" || fam === "georgian" || fam === "tudor" || fam === "stucco" || fam === "gothic") && (v.y || 1950) < 1950 && v.z1 <= 16 && v.r.length === 4
        && Math.abs(ringArea(ring)) < 450 && hash01(k ^ 0x9177, this.seed) < 0.8;
      // THE WEDDING CAKE. Under the 1916 zoning resolution a tower could rise
      // straight only so far before it had to step back from the street, and
      // the pre-war skyline is those setbacks: a full-lot base, one or two
      // terraces, a slimmer shaft. Three in four of the pre-war masonry
      // towers step back; the tiers keep the volume's own height and wear
      // cornices on their terraces.
      const preWarTower = isTop && v.z0 < 0.5 && top > 70 && (v.y || 1950) < 1946
        && (fam === "deco" || fam === "decobrick" || fam === "stone" || fam === "terracotta") && hash01(k ^ 0x1916, this.seed) < 0.75
        // the 2000s limestone apartment tower revived the setback on purpose
        || isTop && v.z0 < 0.5 && top > 60 && fam === "newstone" && hash01(k ^ 0x1916, this.seed) < 0.7;
      let topRing = ring;
      let rowDone = false;
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
      } else if (isTop && v.z0 < 0.5 && fam !== "industrial" && fam !== "daylight" && fam !== "plain" && (top < 40 ? !TOWER_FAMS.has(fam) : true) && this.rowOf(ring, v, fam, k, shop, top >= 40)) {
        // drawn as a row of houses (rowOf), each with its own top: the
        // building-wide crown below would float a footprint-long penthouse
        // over the row at the original height
        rowDone = true;
      } else if (isTop && v.z0 < 0.5 && !pitched && fam !== "brutalist" && ((top >= 24 && TOWER_FAMS.has(fam)) || (top > 30 && (v.y || 0) >= 1945 && (fam === "brick" || fam === "buff")))) {
        topRing = this.massing(ring, v.z0, v.z1, fam, t, v.b, k, shop, v.c, v.y || 0);
      } else if (isTop && v.z0 < 0.5 && !pitched) {
        topRing = this.styledVolume(ring, v.z0, v.z1, fam, t, v.b, k, shop, v.c, v.y || 0);
      } else {
        this.addVolume(ring, v.z0, v.z1, fam, t, v.b, isTop, true, k, shop, pitched, v.c, v.y || 0);
      }
      // A TOWER ENDS IN SOMETHING. A deco tower steps back twice and finishes
      // in a spire; a glass tower carries a recessed mechanical crown and a
      // mast; a stone office takes one setback. Only on the building's own top.
      if (isTop && !rowDone) this.towerTop(topRing.length ? topRing : ring, v.z1, top, fam, t, v.b, k, "auto");
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
        : name === "roof" ? this.roofMat : name === "dark" ? this.darkMat : name === "pier" ? this.pierMat() : name === "contact" ? this.contactMat : this.trimMat;
      const old = this.meshes.get(name);
      if (old) { this.scene.remove(old); old.geometry.dispose(); }
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.castShadow = name !== "contact"; mesh.receiveShadow = name !== "contact"; mesh.frustumCulled = false;
      if (name === "contact") { mesh.renderOrder = 2; mesh.visible = this.quality !== "low"; }
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
      // the shop bay, facing local -y (out of a counter-clockwise wall)
      case "awning": {
        const canopy = new THREE.BoxGeometry(4.6, 1.5, 0.07).rotateX(0.42).translate(0, -0.72, 3.05);
        return { g: merge([canopy, box(4.6, 0.05, 0.32, 0, -1.42, 2.42)]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), colored: true };
      }
      // a stoop: three flights of brownstone up to a dark door, facing local -y
      case "stoop": return { g: merge([box(1.9, 2.6, 0.45, 0, -1.3, 0), box(1.9, 1.75, 0.45, 0, -0.88, 0.45), box(1.9, 0.9, 0.45, 0, -0.45, 0.9),
        box(0.14, 2.6, 0.95, -1.0, -1.3, 0.35), box(0.14, 2.6, 0.95, 1.0, -1.3, 0.35)]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), colored: true };
      // a loading dock: a raised apron, a roll-up door, a canopy over it
      case "dock": return { g: merge([box(4.2, 1.4, 1.15, 0, -0.7, 0), box(3.6, 0.07, 3.6, 0, -0.04, 1.15), box(4.8, 2.0, 0.12, 0, -1.0, 5.0),
        box(0.25, 0.25, 0.5, -1.6, -1.45, 0.45), box(0.25, 0.25, 0.5, 1.6, -1.45, 0.45)]), mat: new THREE.MeshStandardMaterial({ color: 0x6a6c6c, roughness: 0.75, metalness: 0.2 }) };
      // a crown fin: a slim blade carried up past the roof, height via sz
      // a Gothic pinnacle: a shaft, a gabled cap and a crocketed spirelet, ~6 m
      case "pinnacle": return { g: merge([box(0.9, 0.9, 2.6), box(1.1, 1.1, 0.3, 0, 0, 2.6), new THREE.ConeGeometry(0.62, 3.2, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, 4.5), cyl(0.06, 0.8, 6.1, 4)]),
        mat: new THREE.MeshStandardMaterial({ color: 0xd8d0be, roughness: 0.75 }), colored: true };
      // a stone pier carried past the roof, height via sz: the deco crown's frame
      // a round concrete column under a lifted slab, height via sz
      case "piloti": return { g: merge([cyl(0.38, 1, 0, 12)]), mat: new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.8 }) };
      case "crownpier": return { g: merge([box(0.9, 0.75, 1, 0, -0.1, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.8 }) };
      case "fin": return { g: merge([box(0.35, 0.9, 1, 0, -0.2, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.4, metalness: 0.6 }) };
      case "helipad": return { g: merge([cyl(8, 0.25, 0, 20), box(1.0, 6, 0.06, -2, 0, 0.25), box(1.0, 6, 0.06, 2, 0, 0.25), box(3, 1.0, 0.06, 0, 0, 0.25)]), mat: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.8 }) };
      // street hardware, at real sizes; local +x points over the road
      case "signal": return { g: mergeColored([[cyl(0.1, 6.0, 0, 8), [0.2, 0.22, 0.22]], [box(4.6, 0.14, 0.16, 2.3, 0, 5.6), [0.2, 0.22, 0.22]],
        [box(0.32, 0.34, 1.0, 3.2, 0, 4.7), [0.1, 0.1, 0.08]], [box(0.32, 0.34, 1.0, 4.4, 0, 4.7), [0.1, 0.1, 0.08]], [box(0.26, 0.3, 0.6, 0.2, 0, 2.6), [0.1, 0.1, 0.08]]]),
        mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4, vertexColors: true }) };
      case "sigpost": return { g: mergeColored([[cyl(0.08, 3.2, 0, 8), [0.2, 0.22, 0.22]], [box(0.3, 0.32, 0.9, 0.18, 0, 2.3), [0.1, 0.1, 0.08]]]),
        mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4, vertexColors: true }) };
      case "hydrant": return { g: merge([cyl(0.14, 0.55, 0, 10), cyl(0.18, 0.1, 0.5, 10), cyl(0.1, 0.12, 0.6, 8), box(0.4, 0.09, 0.09, 0, 0, 0.36)]), mat: new THREE.MeshStandardMaterial({ color: 0xa8392c, roughness: 0.55 }) };
      case "bin": return { g: merge([cyl(0.28, 0.95, 0, 10)]), mat: new THREE.MeshStandardMaterial({ color: 0x2e4034, roughness: 0.7, metalness: 0.2 }) };
      case "shelter": return { g: mergeColored([[box(3.8, 1.5, 0.08, 0, 0, 2.45), [0.3, 0.32, 0.34]], [box(3.8, 0.04, 2.2, 0, 0.7, 0.25), [0.55, 0.65, 0.7]],
        [box(0.04, 1.4, 2.2, -1.88, 0, 0.25), [0.55, 0.65, 0.7]], [box(0.04, 1.4, 2.2, 1.88, 0, 0.25), [0.55, 0.65, 0.7]],
        [box(0.08, 0.08, 2.45, -1.86, 0.72, 0), [0.25, 0.27, 0.28]], [box(0.08, 0.08, 2.45, 1.86, 0.72, 0), [0.25, 0.27, 0.28]], [box(2.6, 0.4, 0.08, 0, 0.45, 0.48), [0.35, 0.3, 0.26]]]),
        mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.3, vertexColors: true, transparent: true, opacity: 0.92 }) };
      // a front door in a stone surround, facing local -y (out of the wall)
      case "door": return { g: mergeColored([[box(2.4, 0.18, 3.1, 0, -0.06, 0), [0.78, 0.74, 0.66]], [box(1.7, 0.08, 2.6, 0, -0.16, 0.05), [0.16, 0.12, 0.1]], [box(1.6, 0.4, 0.15, 0, -0.35, 0), [0.6, 0.58, 0.55]]]),
        mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, vertexColors: true }) };
      // the apartment marquee: a fabric box over the door, 2.4 m out
      case "marquee": return { g: merge([box(2.2, 2.4, 0.5, 0, -1.2, 3.2)]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), colored: true };
      // a tower's entrance canopy: a thin steel-edged glass plate on two rods
      case "entcanopy": return { g: mergeColored([[box(6.0, 2.6, 0.18, 0, -1.3, 4.4), [0.62, 0.66, 0.7]], [box(6.1, 0.06, 0.3, 0, -2.6, 4.3), [0.3, 0.32, 0.34]],
        [new THREE.CylinderGeometry(0.03, 0.03, 2.9, 4).rotateX(1.1).translate(-2.4, -1.3, 5.6), [0.3, 0.32, 0.34]], [new THREE.CylinderGeometry(0.03, 0.03, 2.9, 4).rotateX(1.1).translate(2.4, -1.3, 5.6), [0.3, 0.32, 0.34]]]),
        mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, vertexColors: true }) };
      // a roof deck: boards, a rail of planters along one side, two chairs
      case "roofdeck": return { g: mergeColored([[box(7, 4.5, 0.14, 0, 0, 0.05), [0.4, 0.29, 0.2]], [box(7, 0.6, 0.55, 0, 2.0, 0.19), [0.4, 0.34, 0.3]],
        [box(6.6, 0.45, 0.35, 0, 2.0, 0.74), [0.26, 0.42, 0.2]], [box(0.6, 0.6, 0.45, -2.5, -1.2, 0.19), [0.3, 0.3, 0.32]], [box(0.6, 0.6, 0.45, -1.6, -1.2, 0.19), [0.3, 0.3, 0.32]]]),
        mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }) };
      // a solar panel, 2 x 1 m, tilted 25 degrees on a low frame
      case "solar": return { g: mergeColored([[new THREE.BoxGeometry(2.0, 1.05, 0.05).rotateX(0.44).translate(0, 0, 0.55), [0.12, 0.16, 0.26]], [box(1.9, 0.08, 0.5, 0, 0.35, 0), [0.6, 0.62, 0.64]]]),
        mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.5, vertexColors: true }) };
      case "dish": return { g: merge([cyl(0.04, 0.8, 0, 5), new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-1.2).translate(0, 0.1, 0.9)]), mat: new THREE.MeshStandardMaterial({ color: 0xd4d6d8, roughness: 0.5 }) };
      case "shopsign": return { g: merge([box(4.3, 0.1, 0.6, 0, -0.06, 3.62)]), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), colored: true };
      case "boards": return { g: merge([box(4.5, 0.06, 2.9, 0, -0.05, 0.12), box(4.5, 0.08, 0.1, 0, -0.09, 1.5)]), mat: new THREE.MeshStandardMaterial({ color: 0xb59a72, roughness: 0.95 }) };
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
      // the trunk forks below the crown: two limbs leaning out
      case "trunk": return { g: merge([cyl(0.22, 3.4, 0, 6),
        new THREE.CylinderGeometry(0.07, 0.12, 1.8, 5).rotateX(Math.PI / 2).rotateY(0.55).translate(0.45, 0.1, 3.7),
        new THREE.CylinderGeometry(0.07, 0.12, 1.6, 5).rotateX(Math.PI / 2).rotateY(-0.6).rotateZ(1.9).translate(-0.35, 0.3, 3.6)]), mat: this.barkMat };
      case "crown": {
        // two lumps at one subdivision: 160 triangles a tree, which is the
        // budget a city of twenty thousand of them can afford
        // Shaded as soft lumps, not facets: each vertex's normal leans out from
        // its lump's centre, and the foliage darkens toward the underside where
        // the canopy shades itself — what turns crumpled paper into a tree.
        const pos: number[] = [], nrm: number[] = [], col: number[] = [];
        // A CANOPY OF CLUSTERS. Two big masses and five smaller clusters set
        // round and above them, so the crown has a broken, leafy outline with
        // sky through it rather than one blob; each vertex carries a little
        // dapple of light and shade, and the crown's top a warmer, lighter
        // green where the sun comes through. ~260 triangles.
        let dap = 0;
        for (const [r, det, cx, cy, cz] of [[2.2, 1, 0, 0, 4.6], [1.7, 1, 0.7, 0.5, 5.9], [1.15, 0, -1.5, -0.4, 4.9], [1.05, 0, 1.6, -0.7, 4.5], [1.0, 0, -0.6, 1.5, 5.0], [0.95, 0, 0.3, -1.6, 5.6], [0.9, 0, -0.9, -0.9, 6.3]] as number[][]) {
          const g = new THREE.IcosahedronGeometry(r, det);   // already one vertex per corner
          // each cluster its own light: one dapple per cluster, so the surface stays smooth
          const d = 0.86 + 0.28 * (((Math.sin(++dap * 12.9898) * 43758.5453) % 1 + 1) % 1);
          const P = g.getAttribute("position").array as Float32Array;
          for (let i = 0; i < P.length; i += 3) {
            // a little lumpiness so no two vertices sit on one perfect sphere
            const w = 1 + 0.12 * Math.sin(P[i] * 3.1 + P[i + 1] * 2.3 + P[i + 2] * 1.7);
            const x = P[i] * w, y = P[i + 1] * w, z = P[i + 2] * w;
            const l = Math.hypot(x, y, z) || 1;
            pos.push(x + cx, y + cy, z + cz);
            nrm.push(x / l, y / l, z / l);
            const up = Math.max(0, Math.min(1, (z / r + 1) / 2));   // 0 underneath, 1 on top
            const k = (0.46 + 0.54 * up) * d;
            // the sunlit top runs a touch warmer and lighter
            col.push(k * (1 + 0.08 * up), k * (1 + 0.04 * up), k * 0.94);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        return { g, mat: this.leafMat, colored: true };
      }
      // REAL CARS. A shaped body (bonnet, windscreen, roof, boot) in the
      // instance's paint, dark glass, black tyres, light lenses: the paint is
      // the instance colour and every other part a fixed vertex colour that the
      // paint multiplies, so the glass stays glass. Sizes are real: a sedan
      // 4.6 x 1.8 m, an SUV 4.8 x 1.9 x 1.75, a van 5.2 x 2.0 x 2.3, a city bus
      // 12 x 2.55 x 3.1.
      case "lotcar":
      case "car": return { g: vehicle("sedan"), mat: this.vehicleMat(), colored: true };
      case "lotsuv":
      case "suv": return { g: vehicle("suv"), mat: this.vehicleMat(), colored: true };
      case "van": return { g: vehicle("van"), mat: this.vehicleMat(), colored: true };
      case "taxi": return { g: vehicle("taxi"), mat: this.vehicleMat(), colored: true };
      case "bus": return { g: vehicle("bus"), mat: this.vehicleMat(), colored: true };
      // A PERSON: legs, coat, arms, head with hair — coat in the instance
      // colour, trousers and hair darker. 1.75 m.
      case "person": return { g: person(), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }), colored: true };
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
    this.registerBays(this.inst, this.instItems, true);
    for (const b of this.bays.keys()) this.applyBays(b);
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
      // TRAFFIC SIGNALS where a crossing meets the kerb: a mast arm reaching
      // over a wide street from one side, a plain post with a head on the
      // other (and on a narrow street, posts both sides). On the footway only.
      for (const [P, d, arm] of [[A, -1, L > 9], [B, 1, false]] as [P2, number, boolean][]) {
        const x = P[0] + ux * d * 1.1, y = P[1] + uy * d * 1.1;
        if (this.groundAt(x, y) !== "walk") continue;
        this.putInst(arm ? "signal" : "sigpost", x, y, 0.15, 1, d < 0 ? r : r + Math.PI);
      }
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

  /**
   * THE FOOTWAY'S FURNITURE, FROM THE FOOTWAY. Street trees, lamps, the
   * people walking and the cars parked at the kerb are laid along the drawn
   * footway's own kerb edge, not offset from a street's centre line, so they
   * stand where the pavement and the carriageway actually are. Each one is
   * then checked against the ground (groundAt): a tree must stand on the
   * footway with its crown clear of every wall, a lamp on the footway, a
   * parked car wholly on the carriageway with a running lane beside it.
   */
  private dressFootways(rnd: () => number, leafCol: () => number[], CAR: number[][], COAT: number[][]) {
    const c = this.ctx as { sidewalks?: { ring: P2[]; holes: P2[][] }[] };
    for (const sw of c.sidewalks ?? []) {
      let ring = sw.ring.map((q) => this.project(q));
      if (ring.length < 3) continue;
      if (ringArea(ring) < 0) ring = ring.slice().reverse();   // counter-clockwise: the band is on the left
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 14) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        const ix = -uy, iy = ux;                   // into the footway
        const rot = Math.atan2(uy, ux);
        // how wide the footway is here, probed at the edge's middle
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        let w = 0;
        while (w < 8 && this.groundAt(mx + ix * (w + 0.25), my + iy * (w + 0.25)) === "walk") w += 0.5;
        if (w < 1) continue;                       // a sliver, or the band is on the other side
        const at = (t: number, off: number): P2 => [a[0] + ux * t + ix * off, a[1] + uy * t + iy * off];
        // people, a few per block face, at a walking pace along the middle of the footway
        if (w >= 1.5) {
          const n = Math.max(1, Math.round(L / 16));
          for (let k = 0; k < n; k++) {
            const fwd = rnd() < 0.5;
            const [sx, sy] = at(fwd ? 0 : L, w * (0.3 + rnd() * 0.4));
            this.walkers.push({ x: sx, y: sy, ux: fwd ? ux : -ux, uy: fwd ? uy : -uy, len: L, ph: rnd() * L, spd: 1.1 + rnd() * 0.5, col: COAT[(rnd() * COAT.length) | 0], draw: rnd() });
          }
        }
        // street trees in the kerb strip; a footway under two metres has none
        if (w >= 2) {
          const off = Math.min(1.1, w * 0.3);
          for (let t = 7; t < L - 7; t += 11) {
            const [x, y] = at(t, off);
            const sz = 0.72 + rnd() * 0.3;
            const col = rnd() < 0.33;
            if (this.groundAt(x, y) !== "walk" || !this.clearOfBuildings(x, y, (col ? 1.9 : 2.7) * sz)) continue;
            this.putInst("trunk", x, y, 0.15, sz, rnd() * 6.28);
            this.putInst("crown", x, y, 0.15, col ? sz * 0.75 : sz, rnd() * 6.28, "", leafCol(), col ? 1.55 : 1);
          }
        }
        // THE KERB'S HARDWARE: a hydrant every ~77 m, a litter bin by the
        // corner, and on a long busy avenue with a wide footway a bus shelter
        // at the back of the pavement. Each between the trees, on the footway.
        for (let t = 23.5; t < L - 6; t += 77) {
          const [x, y] = at(t, 0.55);
          if (this.groundAt(x, y) === "walk") this.putInst("hydrant", x, y, 0.15, 1, rot);
        }
        if (L > 30) {
          const [x, y] = at(4, 0.6);
          if (this.groundAt(x, y) === "walk" && this.clearOfBuildings(x, y, 0.6)) this.putInst("bin", x, y, 0.15, 1, rot);
        }
        if (L > 100 && w >= 3.0) {
          const [x, y] = at(L / 2, w - 1.0);
          if (this.demandAt(x, y) > 0.4 && this.footprintOn(x, y, rot, 1.5, 3.8, ["walk"]) && this.clearOfBuildings(x, y, 2.2)) this.putInst("shelter", x, y, 0.15, 1, rot);
        }
        // lamps at the kerb, between the trees
        for (let t = 12; t < L - 6; t += 27) {
          const [x, y] = at(t, 0.45);
          if (this.groundAt(x, y) === "walk") this.putInst("lamp", x, y, 0.15, 1, rot + Math.PI / 2);
        }
        // moving traffic in the lane outside the parked row, kerb on its right
        // (the footway is left of this edge, so the kerb lane runs against it)
        if (L > 40) {
          const n = Math.max(1, Math.round(L / 34));
          for (let k = 0; k < n; k++) {
            const [sx, sy] = at(L, -3.4), [ex, ey] = at(0, -3.4);
            if (![0, 0.25, 0.5, 0.75, 1].every((f) => this.groundAt(sx + (ex - sx) * f, sy + (ey - sy) * f) === "road")) break;
            const vk = rnd();
            const kind = L > 160 && vk < 0.04 ? "bus" : vk < 0.5 ? "car" : vk < 0.78 ? "suv" : vk < 0.88 ? "van" : "taxi";
            this.movers.push({ x: sx, y: sy, ux: -ux, uy: -uy, len: L, ph: rnd() * L, spd: (kind === "bus" ? 4.5 : 6) + rnd() * 5, col: kind === "taxi" ? TAXI : kind === "bus" ? BUS : CAR[(rnd() * CAR.length) | 0], draw: rnd(), kind });
          }
        }
        // KERBSIDE PARKING where the demand is, wholly on the carriageway, and
        // only where a running lane is left beside it
        for (let t = 9; t < L - 9; t += 6.5) {
          const [x, y] = at(t, -1.25);
          if (rnd() >= 0.62 * Math.min(1, 0.15 + 1.1 * this.demandAt(x, y))) continue;
          const [lx, ly] = at(t, -5.2);
          if (!this.footprintOn(x, y, rot, 2.2, 5.2, ["road"]) || this.groundAt(lx, ly) !== "road") continue;
          const vk = rnd(), dt = this.demandAt(x, y);
          const kind = vk < 0.52 ? "car" : vk < 0.82 ? "suv" : vk < 0.93 ? "van" : dt > 0.55 ? "taxi" : "car";
          this.putInst(kind, x, y, 0.05, 1, rot + (rnd() < 0.5 ? 0 : Math.PI), "", kind === "taxi" ? TAXI : CAR[(rnd() * CAR.length) | 0]);
        }
      }
    }
  }

  // ---- street life --------------------------------------------------------
  private buildStreetLife() {
    let s = (this.seed * 7919) % 2147483646 + 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const CAR = [[0.9, 0.9, 0.89], [0.62, 0.64, 0.67], [0.16, 0.18, 0.21], [0.16, 0.26, 0.45], [0.58, 0.16, 0.14], [0.36, 0.40, 0.34], [0.78, 0.72, 0.56], [0.75, 0.76, 0.78]];
    // a street tree is a deeper, cleaner green than the grey-olive it was
    const leafCol = () => [0.24 + rnd() * 0.08, 0.42 + rnd() * 0.1, 0.13 + rnd() * 0.05];
    const COAT = [[0.30, 0.32, 0.38], [0.62, 0.58, 0.52], [0.20, 0.24, 0.30], [0.52, 0.28, 0.24], [0.86, 0.84, 0.80], [0.28, 0.36, 0.32], [0.44, 0.40, 0.46], [0.70, 0.62, 0.44]];
    this.dressFootways(rnd, leafCol, CAR, COAT);
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
      // a tree stands on a lawn, a yard or a footway — never in the
      // carriageway, and never with its crown through a wall
      if (this.groundAt(x, y) === "road" || !this.clearOfBuildings(x, y, 2.2 * sz)) continue;
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
    for (const kind of ["car", "suv", "van", "taxi", "bus"]) fleet(kind, this.movers.filter((m) => (m.kind ?? "car") === kind), 0.05);
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
      if (!r.mesh || !r.base || r.buf === "contact") continue;
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
      // a demolished building's ground shade goes with it: collapse the band to a point
      if (r.buf === "contact") { for (let i = r.start; i < r.start + r.count; i++) { arr[i * 3] = arr[r.start * 3]; arr[i * 3 + 1] = arr[r.start * 3 + 1]; } }
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

  /** Building into a sandbox (schemeModel): no audit logs, no props pushed off the footprint, no variety counts. */
  private sandbox = false;
  private geomCache = new Map<string, { g: THREE.BufferGeometry; mat: THREE.Material; colored?: boolean }>();

  /**
   * THE SCHEME AS A MODEL. The building the Build desk is designing, built by
   * the very code that will draw it on the map when it delivers (buildItem —
   * same elevation, paint, style, crown, roof plant and street dress), into
   * its own group centred on the lot, with the lot outline and its standing
   * neighbours for scale, and the city's sun and sky of the month. The desk's
   * viewer renders it; nothing on the map changes.
   */
  schemeModel(it: PlayerItem): SchemeModel | null {
    const lot = this.lotRing(it.bbl) ?? this.deeds.get(it.bbl)?.ring ?? null;
    if (!lot || !(it.heightM > 0)) return null;
    let cx = 0, cy = 0;
    for (const [x, y] of lot) { cx += x / lot.length; cy += y / lot.length; }
    const saveBufs = this.bufs, saveDeeds = this.deeds, saveInst = this.instItems, saveDyn = new Map(this.dynHeight);
    this.bufs = new Map(); this.deeds = new Map(); this.instItems = new Map(); this.sandbox = true;
    const group = new THREE.Group();
    let height = it.heightM;
    try {
      this.buildItem({ ...it, construction: false, fresh: false }, saveDeeds, []);
      height = Math.max(height, this.deeds.get(it.bbl)?.height ?? 0);
      for (const [name, b] of this.bufs) {
        if (!b.count) continue;
        const mat = name.startsWith("w:") ? this.families[name.slice(2)].mat
          : name === "roof" ? this.roofMat : name === "dark" ? this.darkMat : name === "pier" ? this.pierMat() : name === "contact" ? this.contactMat : this.trimMat;
        const mesh = new THREE.Mesh(b.geometry(), mat);
        mesh.castShadow = mesh.receiveShadow = name !== "contact";
        if (name === "contact") mesh.renderOrder = 2;
        group.add(mesh);
      }
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
      for (const [kind, list] of this.instItems) {
        if (!list.length) continue;
        let gm = this.geomCache.get(kind);
        if (!gm) { gm = this.geomFor(kind); this.geomCache.set(kind, gm); }
        const im = new THREE.InstancedMesh(gm.g, gm.mat, list.length);
        list.forEach((p, i) => {
          q.setFromEuler(e.set(0, 0, p.r)); im.setMatrixAt(i, m4.compose(pv.set(p.x, p.y, p.z), q, sc.set(p.s, p.s, p.s * (p.sz ?? 1))));
          if (gm!.colored) im.setColorAt(i, new THREE.Color(...(p.col ?? [1, 1, 1]) as [number, number, number]));
        });
        im.castShadow = im.receiveShadow = true;
        group.add(im);
      }
    } finally {
      this.bufs = saveBufs; this.deeds = saveDeeds; this.instItems = saveInst; this.dynHeight = saveDyn; this.sandbox = false;
    }
    group.position.set(-cx, -cy, 0);
    // the street around it, for scale: standing neighbours as plain masses
    const reach = Math.max(90, height * 0.9);
    const neighbours: { ring: P2[]; h: number }[] = [];
    for (const [b, d] of this.deeds) {
      if (b === it.bbl || !d.ring || this.flattened.has(b)) continue;
      let nx = 0, ny = 0; for (const [x, y] of d.ring) { nx += x / d.ring.length; ny += y / d.ring.length; }
      if (Math.hypot(nx - cx, ny - cy) > reach) continue;
      neighbours.push({ ring: d.ring.map(([x, y]) => [x - cx, y - cy] as P2), h: this.dynHeight.get(b) ?? d.height });
    }
    return {
      group, height, lot: lot.map(([x, y]) => [x - cx, y - cy] as P2), neighbours,
      sun: { dir: this.sunDir.clone(), color: this.sun.color.clone(), intensity: this.sun.intensity },
      sky: { sky: this.hemi.color.clone(), ground: this.hemi.groundColor.clone(), intensity: this.hemi.intensity },
    };
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

  /** One player or rival building into the current buffers: a job site by stage, or the finished building in its design. */
  private buildItem(it: PlayerItem, saveDeeds: Map<string, Deed>, craneAt: { x: number; y: number; r: number }[]) {
    if (!(it.heightM > 0) || it.cls === "land") return;
    const lot = this.lotRing(it.bbl) ?? saveDeeds.get(it.bbl)?.ring ?? null;
    if (!lot) return;
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
    // a design counts as the player's only where they chose something: an
    // untouched design is the street's choice, paint scheme and style shape
    // included, exactly as an undesigned building
    const ov: VolumeOv | undefined = d && (d.facade || d.trim !== undefined || d.roof) ? { variant, trim: d.trim, roof: d.roof } : undefined;
    const pitched = !!d && (d.roof === "gable" || d.roof === "hip") && ring.length === 4;
    const tints = TINTS[fam];
    const tint = d?.facade ? [1, 1, 1] : tints[Math.floor(hash01(k, this.seed) * tints.length)];
    const shop = it.shops ?? (it.cls === "retail" || it.cls === "mixed");
    let topRing = ring;
    if (it.construction) {
      // a job site goes up in stages, not as a grey box (buildSite)
      this.buildSite(ring, it, k, cx, cy);
      this.dynHeight.set(it.bbl, h);
      craneAt.push({ x: ring[0][0] * 0.7 + cx * 0.3, y: ring[0][1] * 0.7 + cy * 0.3, r: hash01(k, 31) * 6.28 });
      return;
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
      const yr = it.year && it.year > 1800 ? it.year : 2000;
      // a tower nobody designed takes its period's massing, as the
      // generator's towers do; a designed one keeps the player's shape
      if (!ov && !d?.crown && h >= 40 && TOWER_FAMS.has(fam) && fam !== "brutalist") topRing = this.massing(ring, 0, h, fam, tint, it.bbl, k, shop, it.cls, yr);
      else if (!pitched && !(d?.roof)) topRing = this.styledVolume(ring, 0, h, fam, tint, it.bbl, k, shop, it.cls, yr, ov);
      else this.addVolume(ring, 0, h, fam, tint, it.bbl, true, true, k, shop, pitched, it.cls, yr, ov);
    }
    if (!it.construction) {
      // a crown the player named (towers only); otherwise the period's own
      const kind = d?.crown && d.crown !== "cake" && it.floors >= CROWN_MIN_FLOORS ? d.crown : "auto";
      this.towerTop(topRing, h, h, fam, tint, it.bbl, k, kind as "auto" | "none" | "setback" | "spire" | "mast", ov);
    }
    this.dynHeight.set(it.bbl, h);
    if (it.construction) craneAt.push({ x: ring[0][0] * 0.7 + cx * 0.3, y: ring[0][1] * 0.7 + cy * 0.3, r: hash01(k, 31) * 6.28 });
  }

  setPlayerBuildings(items0: PlayerItem[], force = false) {
    this.lastItems = items0;
    const items = this.preview ? [...items0.filter((i) => i.bbl !== this.preview!.bbl), this.preview] : items0;
    const sig = items.map((i) => `${i.bbl}:${i.cls}:${i.heightM}:${i.floors}:${i.construction ? 1 : 0}:${i.cov ?? 0}:${i.year ?? 0}:${i.shops ?? ""}:${i.design ? JSON.stringify(i.design) : ""}`).join("|");
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
      this.buildItem(it, saveDeeds, craneAt);
    }
    const dynMeshes = new Map<string, THREE.Mesh>();
    for (const [name, b] of this.bufs) {
      if (!b.count) continue;
      const mat = name.startsWith("w:") ? this.families[name.slice(2)].mat
        : name === "roof" ? this.roofMat : name === "dark" ? this.darkMat : name === "pier" ? this.pierMat() : name === "contact" ? this.contactMat : this.trimMat;
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.castShadow = mesh.receiveShadow = name !== "contact";
      if (name === "contact") mesh.renderOrder = 2;
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
      const dynInst = new Map<string, THREE.InstancedMesh>();
      for (const [kind, list] of this.instItems) {
        if (!list.length) continue;
        const { g, mat, colored } = this.geomFor(kind);
        const im = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((it, i) => {
          q.setFromEuler(e.set(0, 0, it.r)); im.setMatrixAt(i, m4.compose(pv.set(it.x, it.y, it.z), q, sc.set(it.s, it.s, it.s * (it.sz ?? 1))));
          if (colored) im.setColorAt(i, new THREE.Color(...(it.col ?? [1, 1, 1]) as [number, number, number]));
        });
        im.castShadow = im.receiveShadow = true;
        this.dyn.add(im); dynInst.set(kind, im);
      }
      for (const b of this.dynBays) this.bays.delete(b);
      const before = new Set(this.bays.keys());
      this.registerBays(dynInst, this.instItems, false);
      for (const b of this.bays.keys()) this.applyBays(b);
      this.dynBays = [...this.bays.keys()].filter((b) => !before.has(b));
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

  // ---- what ground is this? -----------------------------------------------
  // THE GROUND TRUTH every prop is checked against. A tree belongs on a
  // footway, a lawn or a yard, never in a carriageway or inside a wall; a
  // parked car belongs on the carriageway or in a car park, never on the
  // footway. The street furniture used to be placed by offset from a street's
  // centre line, which is right on a straight block and wrong at every
  // junction, bend and odd-width street. Now each placement is tested against
  // the polygons themselves: building footprints, footways (with their
  // holes), parks and lots. Anything else is road.
  private groundIx: {
    bld: PolyGrid; walk: PolyGrid; park: PolyGrid; open: PolyGrid;
  } | null = null;
  private groundIndex() {
    if (this.groundIx) return this.groundIx;
    const bld = new PolyGrid(30), walk = new PolyGrid(40), park = new PolyGrid(60), open = new PolyGrid(60);
    for (const pg of (this.ctx as { opens?: P2[][][] }).opens ?? []) {
      if (pg[0]?.length >= 3) open.add(pg[0].map((q) => this.project(q)), pg.slice(1).map((h) => h.map((q) => this.project(q))));
    }
    for (const v of this.volumes) {
      if (v.d || v.k || !v.b || v.z0 > 0.5) continue;
      bld.add(v.r.map((q) => this.project(q)));
    }
    const c = this.ctx as { sidewalks?: { ring: P2[]; holes: P2[][] }[]; parks?: ({ ring: P2[] } | P2[])[] };
    for (const sw of c.sidewalks ?? []) walk.add(sw.ring.map((q) => this.project(q)), sw.holes.map((h) => h.map((q) => this.project(q))));
    for (const pk of c.parks ?? []) {
      const r = Array.isArray(pk) ? pk : pk.ring;
      if (r && r.length >= 3) park.add(r.map((q) => this.project(q)));
    }
    this.groundIx = { bld, walk, park, open };
    return this.groundIx;
  }
  /** building | walk | park | open | lot | road */
  groundAt(x: number, y: number): "bld" | "walk" | "park" | "open" | "lot" | "road" {
    const g = this.groundIndex();
    if (g.bld.hit(x, y)) return "bld";
    if (g.walk.hit(x, y)) return "walk";
    if (g.park.hit(x, y)) return "park";
    if (g.open.hit(x, y)) return "open";
    if (this.lotAt2D(x, y)) return "lot";
    return "road";
  }
  /** Is a circle of radius r at (x, y) clear of every building? (centre and eight points on the rim) */
  private clearOfBuildings(x: number, y: number, r: number) {
    const g = this.groundIndex();
    if (g.bld.hit(x, y)) return false;
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; if (g.bld.hit(x + Math.cos(a) * r, y + Math.sin(a) * r)) return false; }
    return true;
  }
  /** Every corner of a w x l footprint at (x, y), bearing r, on one of the allowed grounds. */
  private footprintOn(x: number, y: number, r: number, w: number, l: number, ok: string[]) {
    const ux = Math.cos(r), uy = Math.sin(r);
    for (const [a, b] of [[0, 0], [l / 2, w / 2], [l / 2, -w / 2], [-l / 2, w / 2], [-l / 2, -w / 2]]) {
      if (!ok.includes(this.groundAt(x + ux * a - uy * b, y + uy * a + ux * b))) return false;
    }
    return true;
  }
  /** Every volume drawn, by deed — for the floating-geometry audit. */
  private volLog = new Map<string, { r: P2[]; z0: number; z1: number }[]>();
  /**
   * NOTHING FLOATS. Every raised volume (a tier, a crown, a penthouse) must
   * stand on a lower volume of the same deed: its centre inside a footprint
   * whose top reaches its base. Returns the deeds that break that, so the
   * harness can fail on a floating penthouse before a player sees one.
   */
  auditFloating(): { volumes: number; floating: number; deeds: string[] } {
    let volumes = 0, floating = 0; const deeds: string[] = [];
    for (const [bbl, list] of this.volLog) {
      for (const v of list) {
        volumes++;
        if (v.z0 < 0.6) continue;
        let cx = 0, cy = 0; for (const [x, y] of v.r) { cx += x / v.r.length; cy += y / v.r.length; }
        const ok = list.some((u) => u !== v && u.z0 < v.z0 && u.z1 >= v.z0 - 0.6 && PolyGrid.inRing(u.r, cx, cy));
        if (!ok) { floating++; if (deeds.length < 20 && !deeds.includes(bbl)) deeds.push(bbl); }
      }
    }
    return { volumes, floating, deeds };
  }
  /** For the harness: where each placed prop actually stands, by kind. */
  auditGround(kinds = ["trunk", "pine", "car", "suv", "van", "taxi", "lotcar", "lotsuv", "lamp", "hydrant", "bin", "shelter", "signal", "sigpost", "door", "stoop", "dock", "awning", "bench", "railing", "hedge", "fence", "parkhedge", "flowerbed", "pile"]) {
    const out: Record<string, Record<string, number>> = {};
    const e = new THREE.Matrix4();
    for (const k of kinds) {
      const m = this.inst.get(k);
      if (!m) continue;
      const row: Record<string, number> = {};
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, e);
        const el = e.elements;
        if (el[0] === 0 && el[1] === 0 && el[5] === 0) continue;   // hidden
        // wall-mounted kinds: where they stand is a pace out from the wall
        let px = el[12], py = el[13];
        if (k === "stoop" || k === "dock" || k === "awning" || k === "door") { const l = Math.hypot(el[4], el[5]) || 1; px -= (el[4] / l) * 1.5; py -= (el[5] / l) * 1.5; }
        const gk = this.groundAt(px, py);
        row[gk] = (row[gk] ?? 0) + 1;
      }
      out[k] = row;
    }
    return out;
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
    this.map?.triggerRepaint();
  }
  private occ = new Map<string, number>();
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
    for (const b of touched) { this.refreshDeed(b); this.applyBays(b); }
    this.map?.triggerRepaint();
  }
  private ret = new Map<string, number>();
  private dynBays: string[] = [];
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
    // the ground contact shade is transparent overdraw under every building
    const cm = this.meshes.get("contact"); if (cm) cm.visible = q !== "low";
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
