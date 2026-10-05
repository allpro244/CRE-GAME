/**
 * THE REAL-GEOMETRY CITY — a second renderer for the same game.
 *
 * ThreeBuildings draws every facade in a fragment shader on plain boxes. This
 * layer builds the city the way the WebGPU street prototype did: walls with
 * world-scale facade textures (albedo, roughness/metalness, normal relief and
 * lit-window emission per family), real cornices, string courses and lobby
 * bases, roof plant, street trees and parked cars, all lit by stock
 * physically based materials, a soft shadow map and an environment for the
 * glass to reflect. It reads exactly the inputs ThreeBuildings reads and
 * answers the same calls MapView makes, so the game, picking (MapLibre's
 * parcel layer), labels, badges and every panel work unchanged.
 *
 * It is a PREVIEW behind `realRender` in the store (Settings → Display), off
 * by default. Nothing here is read by the engine; nothing here writes state.
 */
import * as THREE from "three";
import maplibregl from "maplibre-gl";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { BuildingVolume, ThreeBuildings } from "../ThreeBuildings";

type Ctx = ConstructorParameters<typeof ThreeBuildings>[3];
type P2 = [number, number];
type PlayerItem = Parameters<ThreeBuildings["setPlayerBuildings"]>[0][number];

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
    if (spec.trim) {
      alb.g.fillStyle = spec.trim;
      alb.g.fillRect(x0 - 4, y0 - 9, ww + 8, 9);     // lintel
      alb.g.fillRect(x0 - 3, y1, ww + 6, 5);          // sill
    }
    // the glass: a vertical sky gradient with a per-pane brightness, so a
    // street of windows does not read as one sheet
    const k = 0.85 + rnd() * 0.3;
    const grad = alb.g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, spec.glassCol); grad.addColorStop(1, shade(spec.glassCol, 0.62));
    alb.g.globalAlpha = 1; alb.g.fillStyle = grad; alb.g.fillRect(x0, y0, ww, wh);
    alb.g.fillStyle = `rgba(255,255,255,${(k - 0.85) * 0.25})`; alb.g.fillRect(x0, y0, ww, wh);
    // frame and glazing bars
    alb.g.strokeStyle = spec.frameCol; alb.g.lineWidth = 3; alb.g.strokeRect(x0 + 1, y0 + 1, ww - 2, wh - 2);
    if (spec.mullions) {
      alb.g.lineWidth = 2;
      for (let i = 1; i < spec.mullions[0]; i++) { const x = x0 + (ww * i) / spec.mullions[0]; alb.g.beginPath(); alb.g.moveTo(x, y0); alb.g.lineTo(x, y1); alb.g.stroke(); }
      for (let i = 1; i < spec.mullions[1]; i++) { const y = y0 + (wh * i) / spec.mullions[1]; alb.g.beginPath(); alb.g.moveTo(x0, y); alb.g.lineTo(x1, y); alb.g.stroke(); }
    }
    orm.g.fillStyle = `rgb(0,${Math.round(spec.glassRough * 255)},${Math.round(spec.glassMetal * 255)})`;
    orm.g.fillRect(x0 + 2, y0 + 2, ww - 4, wh - 4);
    // the reveal: glass sits back in the wall
    hgt.g.fillStyle = "#3a3a3a"; hgt.g.fillRect(x0, y0, ww, wh);
    // after dark about half the rooms are lit, warm and uneven
    if (rnd() < 0.55) {
      const lum = 0.55 + rnd() * 0.45;
      emi.g.fillStyle = `rgb(${255 * lum | 0},${190 * lum | 0},${110 * lum | 0})`;
      emi.g.fillRect(x0 + 2, y0 + 2, ww - 4, wh - 4);
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
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLit = lit;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLit;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLit;");
  };
  mat.customProgramCacheKey = () => "bw-real-facade-lit";
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
const stoneWall = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#b3a790"; g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += 21, r++) for (let x = (r % 2) * 32; x < w; x += 64) {
    const v = 0.94 + rnd() * 0.09;
    g.fillStyle = `rgb(${196 * v | 0},${186 * v | 0},${166 * v | 0})`; g.fillRect(x + 1, y + 1, 62, 19);
  }
};
const panelWall = (base: string) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 1.5;
  for (let y = 0; y < h; y += TILE / 2) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`; g.fillRect(rnd() * w, rnd() * h, 3, 3); }
};
// brownstone: dressed sandstone courses, chocolate-red
const brownWall = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#5e4234"; g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += 16, r++) for (let x = (r % 2) * 24; x < w; x += 48) {
    const v = 0.9 + rnd() * 0.16;
    g.fillStyle = `rgb(${128 * v | 0},${88 * v | 0},${68 * v | 0})`; g.fillRect(x + 1, y + 1, 46, 14);
  }
};
// art deco: pale limestone with continuous piers rising between the windows
// and dark spandrel panels under them — the vertical read of the 1930s tower
const decoWall = (g: CanvasRenderingContext2D, w: number, h: number) => {
  g.fillStyle = "#cbbfa7"; g.fillRect(0, 0, w, h);
  for (let bx = 0; bx < 2; bx++) {
    const ox = bx * TILE;
    g.fillStyle = "#4c4a46"; g.fillRect(ox + TILE * 0.30, 0, TILE * 0.40, h);           // the recessed bay
    g.fillStyle = "#ddd2bb"; g.fillRect(ox, 0, TILE * 0.10, h); g.fillRect(ox + TILE * 0.9, 0, TILE * 0.1, h);   // pier faces
  }
};
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
  F.forEach((f, i) => { out[f.key] = buildFamily(f, (seed * 31 + i * 977) % 2147483646 + 1); });
  return out;
}

/** Which elevation a building wears: by what it is, when it went up and how tall — and a per-building roll among the period-correct ones. */
function familyFor(cls: string, year: number, h: number, roll = 0.5): string {
  // a low pre-war masonry building is one of three brick traditions
  const oldBrick = () => roll < 0.55 ? "brick" : roll < 0.8 ? "buff" : "brownstone";
  if (cls === "industrial") return "industrial";
  if (cls === "office") {
    if (year >= 1958) return h > 30 ? "glass" : "modern";
    if (year >= 1922 && h > 30) return roll < 0.6 ? "deco" : "stone";
    return h > 22 ? "stone" : oldBrick();
  }
  if (cls === "multifamily") {
    // low-rise apartments of every era are mostly brick; the panel and glass
    // elevations belong to the mid- and high-rise slabs
    if (h < 26) return year < 1930 ? oldBrick() : roll < 0.75 ? "brick" : "buff";
    if (year < 1945) return h > 40 ? (roll < 0.5 ? "deco" : "stone") : oldBrick();
    return year > 1995 && h > 40 ? "glass" : "modern";
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
  frame: [[1, 1, 1]],
  plain: [[1, 1, 1]],
  shop: [[1, 1, 1]],
  buff: [[1, 1, 1], [0.95, 0.92, 0.86], [1.04, 1.0, 0.92], [0.9, 0.86, 0.8]],
  brownstone: [[1, 1, 1], [0.9, 0.86, 0.84], [1.06, 1.0, 0.95]],
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
  if (fam === "glass") return r < 0.75 ? [1.32 * j, 1.33 * j, 1.34 * j] : [0.9 * j, 0.9 * j, 0.92 * j];
  if (fam === "modern" || fam === "plain" || cls === "retail") {
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

interface Mover { x: number; y: number; ux: number; uy: number; len: number; ph: number; spd: number; col: number[] }
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
  private leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true, envMapIntensity: 0.2 });
  private barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 1 });
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
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environmentIntensity = 0.5;
    pm.dispose();
    this.families = makeFamilies(this.seed || 1);
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
    const far = distM > 2600, veryFar = distM > 4200;
    for (const f of this.fleets) f.mesh.visible = f.list === this.boats ? !veryFar : !far;
    for (const k of ["lamp", "car", "lotcar"]) { const m = this.inst.get(k); if (m) m.visible = !far; }
    this.renderer.resetState();
    if ((this.fleets.length || this.cranes) && !this.paused && typeof document !== "undefined" && !document.hidden) {
      const now = performance.now();
      this.stepTraffic(now / 1000);
      // ~30 fps for the traffic; MapLibre only paints on demand
      if (now - this.lastTick > 33) { this.lastTick = now; requestAnimationFrame(() => this.map?.triggerRepaint()); }
    }
    this.renderer.render(this.scene, this.camera);
    if (this.dusk !== this.duskTarget) this.map.triggerRepaint();
  }

  // ---- lights & shadow ---------------------------------------------------
  private setupLights() {
    this.sun.castShadow = true;
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

  /** One volume: walls in its family, a roof, and its trim. */
  private addVolume(ring: P2[], z0: number, z1: number, famKey: string, tint: number[], bbl: string, crown: boolean, plant: boolean, seedK: number, shop = false, pitched = false, cls = "") {
    const fam = this.families[famKey];
    if (ringArea(ring) < 0) ring = ring.slice().reverse();     // counter-clockwise: outward normals
    const walls = (fk: string, za: number, zb: number, vOff: number, tn: number[]) => {
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
    if (shop && z0 < 0.5 && z1 > shopH + 2.5) {
      walls("shop", z0, shopH, 0, [1, 1, 1]);
      walls(famKey, shopH, z1, shopH, tint);
    } else {
      walls(famKey, z0, z1, 0, tint);
    }

    // roof
    const R = this.buf("roof");
    const r0 = R.count;
    const rc = roofTone(famKey, cls, pitched, seedK);
    if (pitched && ring.length === 4) {
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
      const Wg = this.buf("w:" + famKey);
      const g0 = Wg.count;
      const uvG = (p: number[]) => [(p[0] + p[1]) / fam.bayW * 0.7, p[2] / fam.floorH];
      Wg.face([[B[0], B[1], z1], [C[0], C[1], z1], M1], [C[1] - B[1], -(C[0] - B[0]), 0], tint, uvG);
      Wg.face([[D[0], D[1], z1], [A[0], A[1], z1], M2], [A[1] - D[1], -(A[0] - D[0]), 0], tint, uvG);
      this.note(bbl, "w:" + famKey, g0);
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
    const white = [1, 1, 1];
    if (fam.masonry) {
      if (crown && z1 - z0 > 4 && !pitched) {
        band(z1 - 0.75, 0.6, 0.55, white);              // the cornice
        band(z1 - 1.05, 0.3, 0.22, white);              // its bed moulding
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
    if (crown && !pitched && z1 - z0 > 3.5) {
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
    if (plant && crown && !pitched) {
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
      const oldWalk = famKey === "brick" || famKey === "buff" || famKey === "brownstone" || famKey === "industrial" || famKey === "stone";
      if (area > 160 && rnd() < 0.7) { const q = spot(0, 0.3); if (q) this.putInst("bulk", q[0], q[1], z1, 1, rot, bbl); }
      if (oldWalk && z1 > 17 && z1 < 95 && area > 120 && rnd() < 0.62) {
        const n = area > 900 && rnd() < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) { const q = spot(0.45, 0.75); if (q) this.putInst("tank", q[0], q[1], z1, 0.9 + rnd() * 0.3, rnd() * 6.28, bbl); }
      }
      if ((famKey === "glass" || famKey === "modern" || famKey === "plain" || cls === "retail") && area > 200) {
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
    const lotPark = new Buf(), lotGravel = new Buf();
    let ls = (this.seed * 4421) % 2147483646 + 1;
    const lrnd = () => (ls = (ls * 16807) % 2147483647) / 2147483647;
    const CARC = [[0.9, 0.9, 0.89], [0.62, 0.64, 0.67], [0.16, 0.18, 0.21], [0.16, 0.26, 0.45], [0.58, 0.16, 0.14], [0.36, 0.40, 0.34]];
    for (const v of this.volumes) {
      if (!v.k || (v.zn === 1 && (v.ds ?? 50) < 62)) continue;
      let ring = v.r.map((p) => this.project(p));
      if (ring.length < 3) continue;
      if (ringArea(ring) < 0) ring = ring.slice().reverse();
      const downtown = (v.ds ?? 50) >= 62;
      const B = downtown ? lotPark : lotGravel;
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { continue; }
      for (const t of tris) {
        for (const i of t) { B.pos.push(ring[i][0], ring[i][1], 0.03); B.nrm.push(0, 0, 1); B.uv.push(ring[i][0] / 5, ring[i][1] / 5); B.col.push(1, 1, 1); }
      }
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
      const pitched = isTop && fam === "brick" && (v.y || 1950) < 1950 && v.z1 <= 16 && v.r.length === 4
        && Math.abs(ringArea(ring)) < 450 && hash01(k ^ 0x9177, this.seed) < 0.8;
      this.addVolume(ring, v.z0, v.z1, fam, t, v.b, isTop, true, k, shop, pitched, v.c);
      // A TOWER ENDS IN SOMETHING. A deco tower steps back twice and finishes
      // in a spire; a glass tower carries a recessed mechanical crown and a
      // mast; a stone office takes one setback. Only on the building's own top.
      if (isTop && top > 60 && (fam === "glass" || fam === "deco" || fam === "stone")) {
        let cx = 0, cy = 0;
        for (const [x, y] of ring) { cx += x; cy += y; }
        cx /= ring.length; cy /= ring.length;
        const shrink = (r: P2[], f: number) => r.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as P2);
        if (fam === "deco") {
          this.addVolume(shrink(ring, 0.78), v.z1, v.z1 + 7, fam, t, v.b, false, false, k);
          this.addVolume(shrink(ring, 0.56), v.z1 + 7, v.z1 + 12, fam, t, v.b, true, false, k);
          this.putInst("spire", cx, cy, v.z1 + 12, 1 + (top - 60) / 120, 0, v.b);
        } else if (fam === "glass") {
          this.addVolume(shrink(ring, 0.86), v.z1, v.z1 + 5, "glass", t, v.b, true, false, k);
          if (hash01(k ^ 0x77, this.seed) < 0.6) this.putInst("mast", cx, cy, v.z1 + 5, 1, 0, v.b);
        } else {
          this.addVolume(shrink(ring, 0.8), v.z1, v.z1 + 6, fam, t, v.b, true, false, k);
        }
        const d2 = this.deedOf(v.b); d2.height = Math.max(d2.height, v.z1 + 8);
      }
      const d = this.deedOf(v.b);
      d.height = Math.max(d.height, v.z1);
      if (!d.ring) d.ring = ring;
    }
    this.flushBufs();
    this.flushInst();
    // a shadow catcher over MapLibre's ground: transparent except where a
    // building or a tree stands between it and the sun
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.ShadowMaterial({ opacity: 0.42, color: 0x1c2433 }));
    catcher.position.z = 0.04; catcher.receiveShadow = true; catcher.renderOrder = -1;
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
        color: 0x14425e, roughness: 0.07, metalness: 0.0, transparent: true, opacity: 0.32, envMapIntensity: 1.4, depthWrite: false,
      }));
      sea.position.z = 0.02; sea.receiveShadow = true; sea.renderOrder = -3;
      this.scene.add(sea);
    }
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), this.veil);
    veil.position.z = 0.03; veil.renderOrder = -2;
    this.scene.add(veil);
  }

  private flushBufs() {
    for (const [name, b] of this.bufs) {
      if (!b.count) continue;
      const mat = name.startsWith("w:") ? this.families[name.slice(2)].mat
        : name === "roof" ? this.roofMat : name === "dark" ? this.darkMat : this.trimMat;
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
      case "skyl": return { g: merge([box(4.2, 1.6, 0.25), new THREE.BoxGeometry(3.9, 1.3, 0.5).translate(0, 0, 0.45)]), mat: new THREE.MeshStandardMaterial({ color: 0x5d6d78, metalness: 0.3, roughness: 0.25, envMapIntensity: 1.1 }) };
      case "tank": return { g: merge([cyl(1.5, 2.6, 2.4, 12), new THREE.ConeGeometry(1.6, 0.9, 12).rotateX(Math.PI / 2).translate(0, 0, 5.4), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => box(0.18, 0.18, 2.4, a * 1.1, b * 1.1))]), mat: new THREE.MeshStandardMaterial({ color: 0x6f5a45, roughness: 0.9 }) };
      case "hvac": return { g: merge([box(4.5, 2.4, 1.6), cyl(0.7, 0.3, 1.6), cyl(0.7, 0.3, 1.6).translate(1.4, 0, 0), cyl(0.7, 0.3, 1.6).translate(-1.4, 0, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xa9adaf, metalness: 0.5, roughness: 0.45 }) };
      case "trunk": return { g: merge([cyl(0.22, 3.2, 0, 6)]), mat: this.barkMat };
      case "crown": {
        // two lumps at one subdivision: 160 triangles a tree, which is the
        // budget a city of twenty thousand of them can afford
        const a = new THREE.IcosahedronGeometry(2.4, 1).translate(0, 0, 4.7);
        const b = new THREE.IcosahedronGeometry(1.7, 0).translate(0.9, 0.5, 5.7);
        const c = new THREE.IcosahedronGeometry(1.6, 0).translate(-0.8, -0.6, 5.3);
        return { g: merge([a, b, c]), mat: this.leafMat, colored: true };
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
      const m = new THREE.Mesh(pave.geometry(), new THREE.MeshStandardMaterial({ map: this.pavingTex(), roughness: 0.86, envMapIntensity: 0.25 }));
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

  /** Concrete flags with a joint every 1.5 m and a little staining. */
  private pavingTex(): THREE.CanvasTexture {
    const { c, g } = makeCanvas(128, 128);
    let s = 91;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.fillStyle = "#b9b4aa"; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) { const v = 150 + rnd() * 60 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`; g.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
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
    const wm = new THREE.Mesh(water.geometry(), new THREE.MeshStandardMaterial({ color: 0x2f6070, roughness: 0.12, metalness: 0.05, envMapIntensity: 1.2 }));
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
    const wm = new THREE.Mesh(water.geometry(), new THREE.MeshStandardMaterial({ color: 0x2f6070, roughness: 0.12, metalness: 0.05, vertexColors: true, envMapIntensity: 1.2 }));
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
            const n = Math.max(1, Math.round(L / 28));
            for (let k = 0; k < n; k++) {
              if (rnd() < 0.3) continue;
              const fwd = rnd() < 0.5;
              const o = hw + sw * (0.35 + rnd() * 0.3);
              const sx = fwd ? a[0] : b[0], sy = fwd ? a[1] : b[1];
              this.walkers.push({
                x: sx + nx * o * side, y: sy + ny * o * side,
                ux: fwd ? ux : -ux, uy: fwd ? uy : -uy, len: L, ph: rnd() * L, spd: 1.1 + rnd() * 0.5,
                col: COAT[(rnd() * COAT.length) | 0],
              });
            }
          }
        }
        // moving traffic on the wider streets: one car per ~45 m each way,
        // in the running lane inside the parked row
        if (hw >= 5 && L > 50) {
          for (const side of [-1, 1]) {
            const n = Math.max(1, Math.round(L / 45));
            for (let k = 0; k < n; k++) {
              if (rnd() < 0.35) continue;
              const o = Math.min(hw - 3.2, Math.max(1.8, hw * 0.45));
              // keep right: one side runs a→b, the other b→a
              const fwd = side < 0;
              const sx = fwd ? a[0] : b[0], sy = fwd ? a[1] : b[1];
              this.movers.push({
                x: sx + nx * o * side, y: sy + ny * o * side,
                ux: fwd ? ux : -ux, uy: fwd ? uy : -uy, len: L, ph: rnd() * L, spd: 6 + rnd() * 5,
                col: CAR[(rnd() * CAR.length) | 0],
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
              this.putInst("trunk", x + nx * o * side, y + ny * o * side, 0.15, sz, rnd() * 6.28);
              this.putInst("crown", x + nx * o * side, y + ny * o * side, 0.15, sz, rnd() * 6.28, "", leafCol());
            }
            if (hw >= 5 && rnd() < 0.62) {
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
    for (const p of (this.ctx as { trees?: P2[] }).trees ?? []) {
      const [x, y] = this.project(p);
      const sz = 1.0 + rnd() * 0.6;
      this.putInst("trunk", x, y, 0, sz, rnd() * 6.28);
      this.putInst("crown", x, y, 0, sz, rnd() * 6.28, "", leafCol());
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
    this.stepTraffic(0);
    this.applyMonth();
  }

  /** Move every car and walker to where it is at time t (seconds): a patrol along its own block face that wraps. */
  private stepTraffic(t: number) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const f of this.fleets) {
      f.list.forEach((m, i) => {
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
            const dk = (1 - worn * 0.24) * (1 + fresh * 0.05);
            // and greyer: pull the three channels toward their mean
            k = [k[0] * dk * (1 - worn * 0.10), k[1] * dk, k[2] * dk * (1 + worn * 0.06)];
          }
          // the selected building glows warm all over; yours are warmed a touch
          if (own) k = [k[0] * 1.08, k[1], k[2] * 0.86];
          if (sel) k = [k[0] * 1.3, k[1] * 1.18, k[2] * 0.82];
          else if (hov) k = [k[0] * 1.12, k[1] * 1.12, k[2] * 1.12];
          if (r.buf === "w:shop") {
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

  setPlayerBuildings(items: PlayerItem[]) {
    const sig = items.map((i) => `${i.bbl}:${i.cls}:${i.heightM}:${i.floors}:${i.construction ? 1 : 0}:${i.cov ?? 0}`).join("|");
    if (sig === this.dynSig) return;
    this.dynSig = sig;
    for (const c of [...this.dyn.children]) { this.dyn.remove(c); if (!(c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.Mesh).geometry?.dispose(); }
    this.dynHeight.clear();
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
      const fam = it.construction ? "frame" : familyFor(it.cls, it.year && it.year > 1800 ? it.year : 2000, h, hash01(keyOf(it.bbl) ^ 0x3c1f, this.seed));
      const k = keyOf(it.bbl);
      const tints = TINTS[fam];
      this.addVolume(ring, 0, h, fam, tints[Math.floor(hash01(k, this.seed) * tints.length)], it.bbl, true, !it.construction, k, false, false, it.construction ? "" : it.cls);
      this.dynHeight.set(it.bbl, h);
      if (it.construction) craneAt.push({ x: ring[0][0] * 0.7 + cx * 0.3, y: ring[0][1] * 0.7 + cy * 0.3, r: hash01(k, 31) * 6.28 });
    }
    const dynMeshes = new Map<string, THREE.Mesh>();
    for (const [name, b] of this.bufs) {
      if (!b.count) continue;
      const mat = name.startsWith("w:") ? this.families[name.slice(2)].mat
        : name === "roof" ? this.roofMat : name === "dark" ? this.darkMat : this.trimMat;
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
    // the canopy: green in summer, turning in autumn, bare grey in winter
    const leaf = this.inst.get("crown");
    if (leaf) {
      const turn = [0, 0, 0, 0, 0, 0, 0, 0.05, 0.3, 0.85, 0.9, 0.2][this.month];
      const bare = [1, 1, 0.85, 0.4, 0.02, 0, 0, 0, 0, 0.1, 0.6, 0.95][this.month];
      this.leafMat.color.setRGB(1, 1, 1);
      const autumn = [[1.9, 0.62, 0.3], [1.8, 1.05, 0.36], [1.55, 1.25, 0.4], [0.9, 1.0, 0.8]];
      for (let i = 0; i < leaf.count; i++) {
        const h = hash01(i, 77);
        let c = new THREE.Color(0.30 + h * 0.08, 0.46 + h * 0.08, 0.20);
        if (turn > 0) { const a = autumn[Math.floor(h * 4)]; c.lerp(new THREE.Color(c.r * a[0], c.g * a[1], c.b * a[2]), turn); }
        if (bare > 0) c = c.lerp(new THREE.Color(0.30, 0.27, 0.24), bare * 0.85);
        leaf.setColorAt(i, c);
      }
      if (leaf.instanceColor) leaf.instanceColor.needsUpdate = true;
      leaf.scale.set(1, 1, 1);
    }
    this.applyLight();
  }

  setWeather(kind: "clear" | "overcast" | "rain" | "snow", precipitation: number, overcast: number) {
    this.snow = kind === "snow" ? 0.3 + Math.max(0, Math.min(1, precipitation)) * 0.5 : 0;
    this.overcast = Math.max(0, Math.min(1, overcast || 0));
    this.applyLight();
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
    for (const b of touched) this.refreshDeed(b);
    this.map?.triggerRepaint();
  }
  private ret = new Map<string, number>();
  setNotices(_b: string[]) { /* badges carry notices */ }
  setForSale(_m: string[], _o: string[]) { /* badges carry listings */ }
  setCivicWorks(_w: unknown) { /* civic works: classic renderer */ }
  setActivity(_a: number) { /* no animated walkers here */ }
  setDemandMap(_m: Record<string, number>) { /* foot traffic: classic renderer */ }
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
  setPaused(on: boolean) { this.paused = on; if (!on) this.map?.triggerRepaint(); }
  setOpacity(o: number) {
    this.visibleOn = o > 0.01;
    this.map?.triggerRepaint();
  }
}
