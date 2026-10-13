// THE PARKS, DRESSED (park revamp). A park was a flat MapLibre fill with
// hairline walks, a sprinkle of trees and a hedge: a green card. This is what
// makes it a place — real turf with the mower's stripes in it, gravel walks
// with stone edging, a paved round where the walks meet, ponds with coping and
// reeds, Victorian lamps, benches facing the walks, beds of flowers in turned
// soil, a bandstand and a playground on a big common, headstones in a burying
// ground, stalls on a market, cannon on a battery. Looks only: nothing here is
// read by the sim, and nothing here moves a lot line.
//
// The geometry builders and textures live here; RealCityLayer.buildParkGround
// and RealCityLayer.dressParks place them.
import * as THREE from "three";

type P2 = [number, number];

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return { c, g: c.getContext("2d")! };
}
const finish = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
};

/**
 * Crushed-stone walk: buff hoggin with darker and lighter grit and the faint
 * ruts of wheels and feet along it. u runs along the walk, v across it.
 * White-based near the middle so the material colour can warm or wet it.
 */
export function walkTex(): THREE.CanvasTexture {
  const W = 128, H = 64;
  const { c, g } = makeCanvas(W, H);
  let s = 4409; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = "#d2c3a0"; g.fillRect(0, 0, W, H);
  // two worn lines where the feet go, a shade lighter and smoother
  for (const y of [H * 0.36, H * 0.64]) { g.fillStyle = "rgba(240,230,205,0.35)"; g.fillRect(0, y - 5, W, 10); }
  for (let i = 0; i < 2600; i++) {
    const v = rnd(); const d = v < 0.5;
    g.fillStyle = d ? `rgba(${120 + rnd() * 40 | 0},${105 + rnd() * 30 | 0},${80 + rnd() * 20 | 0},0.45)` : `rgba(245,238,220,0.5)`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd(), 1 + rnd());
  }
  // a few damp patches
  for (let i = 0; i < 6; i++) {
    const x = rnd() * W, y = H * 0.2 + rnd() * H * 0.6, r = 4 + rnd() * 8;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(120,100,70,0.22)"); gr.addColorStop(1, "rgba(120,100,70,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c);
}

/** Granite setts in rows, for a market square: 0.2 x 0.12 m stones, a 2 m tile. */
export function settsTex(): THREE.CanvasTexture {
  const N = 256;
  const { c, g } = makeCanvas(N, N);
  let s = 7717; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = "#6f6a62"; g.fillRect(0, 0, N, N);
  const rh = 16, rw = 26;
  for (let r = 0; r < N / rh; r++) {
    const off = (r % 2) * rw / 2;
    for (let k = -1; k < N / rw + 1; k++) {
      const v = 150 + rnd() * 50 | 0, w = (rnd() - 0.5) * 10 | 0;
      g.fillStyle = `rgb(${v + w},${v - 3},${v - 10 - w})`;
      const x = k * rw + off;
      g.fillRect(x + 1.5, r * rh + 1.5, rw - 3, rh - 3);
      g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(x + 2, r * rh + 2, rw - 5, 2);
    }
  }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(40,38,34,${0.08 + rnd() * 0.12})`; g.fillRect(rnd() * N, rnd() * N, 1, 1); }
  return finish(c);
}

/**
 * The turf material: the lawn texture, multiplied by two octaves of soft
 * world-space noise (sun, soil and wear vary across a common), and the
 * mower's stripes — light and dark bands 4 m wide laid along each park's own
 * long axis, read from the `stripe` attribute (metres across the stripes).
 */
/** How much of the lawn is under fallen leaves (0-1), set by the season. */
export const TURF_U = {
  uLeaves: { value: 0 },
  /** the streams through the parks (RealCityLayer.buildWetMask): white is water, and the turf is cut away there */
  uWet: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t as THREE.Texture; })() },
  uWetBox: { value: new THREE.Vector4(0, 0, 1, 1) },
};
export function turfMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0.1, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, TURF_U);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float stripe;\nvarying float vStripe;\nvarying vec2 vTw;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvStripe = stripe;\nvTw = (modelMatrix * vec4(transformed, 1.0)).xy;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying float vStripe;
varying vec2 vTw;
uniform float uLeaves;
uniform sampler2D uWet;
uniform vec4 uWetBox;
float tH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tH(i), tH(i + vec2(1.0, 0.0)), f.x), mix(tH(i + vec2(0.0, 1.0)), tH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
if (texture2D(uWet, (vTw - uWetBox.xy) / uWetBox.zw).r > 0.5) discard;
{ float n = tN(vTw / 46.0) * 0.6 + tN(vTw / 13.0) * 0.4;
  diffuseColor.rgb *= mix(vec3(0.82, 0.86, 0.9), vec3(1.14, 1.1, 0.92), n);
  // the mower's stripes, softened at their edges and fading where the grass is worn
  float st = smoothstep(-0.25, 0.25, sin(vStripe * 3.14159265 / 4.0));
  diffuseColor.rgb *= mix(0.93, 1.05, st);
  // fallen leaves: small drifts, thicker in hollows (the low-frequency noise), in three autumn colours
  float lf = tH(floor(vTw * 5.0)), drift = tN(vTw / 9.0);
  if (uLeaves > 0.0 && lf < uLeaves * (0.15 + 0.6 * drift)) {
    float k = tH(floor(vTw * 5.0) + 7.0);
    diffuseColor.rgb = k < 0.4 ? vec3(0.62, 0.32, 0.1) : k < 0.75 ? vec3(0.7, 0.5, 0.14) : vec3(0.42, 0.22, 0.1);
  } }`);
  };
  m.customProgramCacheKey = () => "park-turf";
  return m;
}

/** Point-in-polygon, even-odd. */
export function inRing(x: number, y: number, ring: P2[]): boolean {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-15) + xi) ins = !ins;
  }
  return ins;
}
/** Distance from a point to a segment. */
export function segDist(x: number, y: number, a: P2, b: P2): number {
  const vx = b[0] - a[0], vy = b[1] - a[1], ll = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / ll));
  return Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y);
}

/** A flat geometry builder with position, normal, uv, colour and the stripe coordinate. */
export class FlatBuf {
  pos: number[] = []; uv: number[] = []; col: number[] = []; st: number[] = [];
  get count() { return this.pos.length / 3; }
  v(x: number, y: number, z: number, u: number, w: number, c: number[], s = 0) { this.pos.push(x, y, z); this.uv.push(u, w); this.col.push(c[0], c[1], c[2]); this.st.push(s); }
  /** Triangulate a polygon with holes at height z, upward-facing. uv and stripe from the point. */
  poly(ring: P2[], holes: P2[][], z: number, c: number[], uvOf: (p: P2) => [number, number], stOf: (p: P2) => number = () => 0): boolean {
    let tris: number[][] = [];
    try {
      tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
    } catch { return false; }
    if (!tris.length) return false;
    const all = [...ring, ...holes.flat()];
    for (const t of tris) {
      const p = t.map((i) => all[i]);
      const cr = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
      const q = cr >= 0 ? p : [p[0], p[2], p[1]];
      for (const v of q) { const [u, w] = uvOf(v); this.v(v[0], v[1], z, u, w, c, stOf(v)); }
    }
    return true;
  }
  /** A ribbon of width w along a-b at height z, with round ends; u along (metres / uL), v 0..1 across. */
  ribbon(a: P2, b: P2, w: number, z: number, c: number[], uL: number, caps = true) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) return;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * w / 2, ny = ux * w / 2;
    const A0: P2 = [a[0] + nx, a[1] + ny], A1: P2 = [a[0] - nx, a[1] - ny], B0: P2 = [b[0] + nx, b[1] + ny], B1: P2 = [b[0] - nx, b[1] - ny];
    const u0 = 0, u1 = L / uL;
    this.v(A1[0], A1[1], z, u0, 0, c); this.v(B1[0], B1[1], z, u1, 0, c); this.v(B0[0], B0[1], z, u1, 1, c);
    this.v(A1[0], A1[1], z, u0, 0, c); this.v(B0[0], B0[1], z, u1, 1, c); this.v(A0[0], A0[1], z, u0, 1, c);
    if (caps) { this.disc(a, w / 2, z, c, uL); this.disc(b, w / 2, z, c, uL); }
  }
  /** A flat disc (fan), its uv mid-walk so it matches a ribbon's middle. */
  disc(p: P2, r: number, z: number, c: number[], uL = 4, seg = 12) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this.v(p[0], p[1], z, p[0] / uL, 0.5, c);
      this.v(p[0] + Math.cos(a0) * r, p[1] + Math.sin(a0) * r, z, (p[0] + Math.cos(a0) * r) / uL, 0.5 + Math.sin(a0) * 0.45, c);
      this.v(p[0] + Math.cos(a1) * r, p[1] + Math.sin(a1) * r, z, (p[0] + Math.cos(a1) * r) / uL, 0.5 + Math.sin(a1) * 0.45, c);
    }
  }
  /** An annulus between radii r0 and r1, uv in world metres / uL. */
  annulus(p: P2, r0: number, r1: number, z: number, c: number[], uL = 2, seg = 32) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const P = (r: number, a: number): P2 => [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r];
      const q = [P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a0), P(r1, a1), P(r0, a1)];
      for (const v of q) this.v(v[0], v[1], z, v[0] / uL, v[1] / uL, c);
    }
  }
  geometry(withStripe = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(this.count * 3).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (withStripe) g.setAttribute("stripe", new THREE.Float32BufferAttribute(this.st, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---- the furniture ---------------------------------------------------------

/** Parts with fixed vertex colours, merged into one non-indexed geometry. */
function mc(parts: [THREE.BufferGeometry, number[]][]): THREE.BufferGeometry {
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
const bx = (w: number, d: number, h: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, d, h).translate(x, y, z + h / 2);
const cy = (r: number, h: number, z = 0, seg = 10, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg).rotateX(Math.PI / 2).translate(0, 0, z + h / 2);
const cone = (r: number, h: number, z: number, seg = 8) => new THREE.ConeGeometry(r, h, seg).rotateX(Math.PI / 2).translate(0, 0, z + h / 2);

const IRON = [0.13, 0.15, 0.15], STONE = [0.72, 0.7, 0.66], WOOD = [0.45, 0.32, 0.2], WHITE = [0.92, 0.91, 0.88];
const SOIL = [0.3, 0.22, 0.16], COPPER = [0.38, 0.6, 0.52];

/**
 * The geometry of a park kind. `mat` names the material: "vc" a plain
 * vertex-coloured standard material, "lamp" the layer's lamp material (dark
 * painted iron). `colored` means the instance colour multiplies it.
 */
export function parkGeom(kind: string): { g: THREE.BufferGeometry; mat: "vc" | "lamp" | "water" | "leaf"; colored?: boolean } | null {
  switch (kind) {
    // a Victorian park lamp: a fluted iron post on a plinth; the lantern is plhead
    case "plpost": return { g: mc([[cy(0.17, 0.55, 0, 8, 0.12), IRON], [cy(0.065, 3.1, 0.55, 6), IRON], [cy(0.12, 0.12, 3.6, 8), IRON], [bx(0.5, 0.05, 0.05, 0, 0, 3.3), IRON]]), mat: "vc" };
    case "plhead": return { g: mc([[cy(0.2, 0.45, 3.72, 6, 0.13), [1, 1, 1]], [cone(0.27, 0.32, 4.17, 6), [0.35, 0.35, 0.35]], [cy(0.03, 0.18, 4.49, 4), [0.35, 0.35, 0.35]]]), mat: "lamp" };
    // a park bench: slatted seat and back on cast-iron ends, facing local -y
    case "pbench": {
      const parts: [THREE.BufferGeometry, number[]][] = [];
      for (const y of [-0.18, -0.02, 0.14]) parts.push([bx(1.9, 0.12, 0.04, 0, y, 0.44), WOOD]);
      for (const z of [0.62, 0.78]) parts.push([new THREE.BoxGeometry(1.9, 0.04, 0.11).rotateX(-0.25).translate(0, 0.27, z), WOOD]);
      for (const x of [-0.88, 0.88]) { parts.push([bx(0.06, 0.5, 0.06, x, 0, 0.4), IRON]); parts.push([bx(0.06, 0.06, 0.44, x, -0.2, 0), IRON]); parts.push([bx(0.06, 0.06, 0.9, x, 0.24, 0), IRON]); }
      return { g: mc(parts), mat: "vc" };
    }
    // the turned soil and stone edging of a bed: there all year
    case "bedsoil": return { g: mc([[cy(1.95, 0.16, 0, 16), [0.6, 0.58, 0.54]], [cy(1.78, 0.22, 0, 16), SOIL]]), mat: "vc" };
    // a headstone: a slab with a rounded head, in the instance's stone
    case "headstone": return { g: mc([[bx(0.62, 0.14, 0.62), [1, 1, 1]], [new THREE.CylinderGeometry(0.31, 0.31, 0.14, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, 0.62), [1, 1, 1]], [bx(0.8, 0.4, 0.08, 0, 0, 0), [0.8, 0.8, 0.8]]]), mat: "vc", colored: true };
    case "obelisk": return { g: mc([[bx(1.3, 1.3, 0.5), [0.9, 0.9, 0.9]], [bx(0.95, 0.95, 0.9, 0, 0, 0.5), [1, 1, 1]], [cy(0.42, 3.0, 1.4, 4, 0.24).rotateZ(Math.PI / 4), [1, 1, 1]], [cone(0.3, 0.5, 4.4, 4).rotateZ(Math.PI / 4), [1, 1, 1]]]), mat: "vc", colored: true };
    // a market stall: a trestle of produce under a white canopy; the colour is in stallstripe
    case "stall": {
      const parts: [THREE.BufferGeometry, number[]][] = [];
      for (const x of [-1.4, 1.4]) for (const y of [-0.9, 0.9]) parts.push([cy(0.04, 2.3, 0, 5).translate(x, y, 0), WOOD]);
      parts.push([bx(2.8, 1.2, 0.08, 0, -0.1, 0.8), WOOD]);
      parts.push([bx(2.7, 1.1, 0.12, 0, -0.1, 0.88), [0.62, 0.42, 0.22]]);
      // the produce: crates of greens, apples, oranges
      parts.push([bx(0.8, 0.5, 0.14, -0.9, -0.2, 1.0), [0.32, 0.55, 0.2]]);
      parts.push([bx(0.8, 0.5, 0.14, 0, -0.2, 1.0), [0.75, 0.16, 0.12]]);
      parts.push([bx(0.8, 0.5, 0.14, 0.9, -0.2, 1.0), [0.95, 0.55, 0.12]]);
      parts.push([new THREE.BoxGeometry(3.2, 2.3, 0.05).rotateX(0.12).translate(0, 0, 2.38), WHITE]);
      return { g: mc(parts), mat: "vc" };
    }
    case "stallstripe": {
      const parts: [THREE.BufferGeometry, number[]][] = [];
      for (let k = 0; k < 4; k++) parts.push([new THREE.BoxGeometry(0.4, 2.32, 0.05).rotateX(0.12).translate(-1.4 + 0.2 + k * 0.8, 0, 2.41), [1, 1, 1]]);
      return { g: mc(parts), mat: "vc", colored: true };
    }
    // a playground: sandpit, swings and a slide, in the bright paints they come in
    case "playset": {
      const RED = [0.78, 0.2, 0.15], BLUE = [0.16, 0.36, 0.66], YEL = [0.92, 0.72, 0.15], SAND = [0.86, 0.78, 0.6], RUB = [0.42, 0.28, 0.24];
      const parts: [THREE.BufferGeometry, number[]][] = [
        [bx(14, 10, 0.06, 0, 0, 0), RUB],
        [bx(4.2, 4.2, 0.12, -3.6, 2, 0), [0.55, 0.5, 0.45]], [bx(3.8, 3.8, 0.16, -3.6, 2, 0), SAND],
      ];
      // swings: an A-frame each end and a top bar, two seats
      for (const x of [1.0, 5.4]) { parts.push([new THREE.BoxGeometry(0.1, 0.1, 2.6).rotateX(0.32).translate(x, 2.4, 1.25), RED]); parts.push([new THREE.BoxGeometry(0.1, 0.1, 2.6).rotateX(-0.32).translate(x, 1.6, 1.25), RED]); }
      parts.push([bx(4.6, 0.1, 0.1, 3.2, 2.0, 2.45), RED]);
      for (const x of [2.3, 4.1]) { parts.push([bx(0.02, 0.02, 1.9, x - 0.2, 2.0, 0.55), IRON]); parts.push([bx(0.02, 0.02, 1.9, x + 0.2, 2.0, 0.55), IRON]); parts.push([bx(0.5, 0.2, 0.05, x, 2.0, 0.5), [0.1, 0.1, 0.1]]); }
      // the slide: a deck on four posts, a ladder, the chute
      for (const x of [-1.2, 0.2]) for (const y of [-3.2, -1.8]) parts.push([bx(0.1, 0.1, 1.6, x, y, 0), BLUE]);
      parts.push([bx(1.6, 1.6, 0.1, -0.5, -2.5, 1.5), BLUE]);
      parts.push([bx(1.6, 0.05, 0.7, -0.5, -3.3, 1.6), YEL]);
      parts.push([new THREE.BoxGeometry(3.4, 0.7, 0.06).rotateY(0.45).translate(1.8, -2.5, 0.85), YEL]);
      parts.push([new THREE.BoxGeometry(0.6, 0.06, 1.7).rotateX(0).translate(-0.5, -1.6, 0.8), BLUE]);
      // a climbing frame
      for (const x of [-5.5, -4.1]) for (const y of [-3.4, -2.0]) parts.push([bx(0.08, 0.08, 1.8, x, y, 0), YEL]);
      for (const z of [0.6, 1.2, 1.8]) { parts.push([bx(1.5, 0.06, 0.06, -4.8, -3.4, z), YEL]); parts.push([bx(1.5, 0.06, 0.06, -4.8, -2.0, z), YEL]); }
      return { g: mc(parts), mat: "vc" };
    }
    // a bandstand: a stone plinth with steps, eight slender iron columns, an ogee copper roof
    case "bandstand": {
      const parts: [THREE.BufferGeometry, number[]][] = [[cy(5.6, 0.9, 0, 8), STONE], [cy(5.9, 0.12, 0.9, 8), [0.82, 0.8, 0.76]], [bx(2.4, 1.6, 0.45, 0, -6.1, 0), STONE]];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        parts.push([cy(0.1, 3.4, 1.0, 6).translate(Math.cos(a) * 5.1, Math.sin(a) * 5.1, 0), [0.9, 0.9, 0.88]]);
        parts.push([bx(0.08, 0.08, 0.9, Math.cos(a) * 5.15, Math.sin(a) * 5.15, 1.0), IRON]);
      }
      parts.push([cy(5.7, 0.35, 4.4, 8), WHITE]);
      parts.push([cone(6.2, 1.6, 4.75, 8), COPPER]);
      parts.push([cone(2.6, 1.6, 6.3, 8), COPPER]);
      parts.push([cy(0.08, 1.2, 7.8, 5), IRON]);
      return { g: mc(parts), mat: "vc" };
    }
    // a clump of reeds at the water's edge
    case "reeds": {
      const parts: [THREE.BufferGeometry, number[]][] = [];
      let s = 91; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 14; k++) {
        const a = r() * 6.28, d = r() * 0.9, h = 0.9 + r() * 0.9;
        parts.push([new THREE.ConeGeometry(0.06, h, 3).rotateX(Math.PI / 2).rotateY((r() - 0.5) * 0.4).translate(Math.cos(a) * d, Math.sin(a) * d, h / 2), r() < 0.25 ? [0.55, 0.5, 0.3] : [0.3 + r() * 0.1, 0.45 + r() * 0.1, 0.18]]);
        if (r() < 0.25) parts.push([cy(0.045, 0.22, h * 0.75, 5).translate(Math.cos(a) * d, Math.sin(a) * d, 0), [0.35, 0.22, 0.14]]);
      }
      return { g: mc(parts), mat: "vc" };
    }
    // lily pads: a few flat discs on the water, one or two in flower
    case "lily": {
      const parts: [THREE.BufferGeometry, number[]][] = [];
      let s = 37; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 7; k++) {
        const a = r() * 6.28, d = r() * 1.6, rr = 0.25 + r() * 0.25;
        parts.push([new THREE.CylinderGeometry(rr, rr, 0.02, 9, 1, false, 0.4, Math.PI * 1.85).rotateX(Math.PI / 2).translate(Math.cos(a) * d, Math.sin(a) * d, 0.01), [0.24 + r() * 0.08, 0.42 + r() * 0.1, 0.18]]);
        if (r() < 0.3) parts.push([new THREE.SphereGeometry(0.1, 6, 4).scale(1, 1, 0.6).translate(Math.cos(a) * d, Math.sin(a) * d, 0.05), r() < 0.5 ? [0.95, 0.9, 0.92] : [0.95, 0.6, 0.72]]);
      }
      return { g: mc(parts), mat: "vc" };
    }
    case "rock": {
      const g = new THREE.IcosahedronGeometry(0.7, 0).scale(1.3, 1, 0.6);
      return { g: mc([[g, [0.58, 0.56, 0.52]]]), mat: "vc", colored: true };
    }
    // a person sitting on a bench or the grass, facing local -y; the coat is the instance colour
    case "sitter": {
      const SKIN = [0.62, 0.48, 0.4], HAIR = [0.22, 0.2, 0.2], LEG = [0.32, 0.33, 0.36], C = [1, 1, 1];
      return {
        g: mc([
          [bx(0.13, 0.46, 0.13, -0.09, -0.2, 0.42), LEG], [bx(0.13, 0.46, 0.13, 0.09, -0.2, 0.42), LEG],
          [bx(0.13, 0.13, 0.44, -0.09, -0.4, 0), LEG], [bx(0.13, 0.13, 0.44, 0.09, -0.4, 0), LEG],
          [bx(0.42, 0.24, 0.6, 0, 0.02, 0.5), C], [bx(0.1, 0.11, 0.5, -0.27, -0.06, 0.6), C], [bx(0.1, 0.11, 0.5, 0.27, -0.06, 0.6), C],
          [new THREE.SphereGeometry(0.11, 8, 6).translate(0, 0.0, 1.26), SKIN],
          [new THREE.SphereGeometry(0.115, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.02, 1.27), HAIR],
        ]), mat: "vc", colored: true,
      };
    }
    case "cannon": return {
      g: mc([[bx(1.5, 1.0, 0.45, 0, 0, 0.15), [0.32, 0.24, 0.16]], [cy(0.42, 0.12, 0, 10).rotateX(Math.PI / 2).translate(0.35, -0.55, 0.42), [0.15, 0.13, 0.12]], [cy(0.42, 0.12, 0, 10).rotateX(Math.PI / 2).translate(0.35, 0.55, 0.42), [0.15, 0.13, 0.12]],
        [new THREE.CylinderGeometry(0.16, 0.24, 2.6, 10).rotateZ(Math.PI / 2 - 0.08).translate(0.6, 0, 0.82), [0.12, 0.13, 0.13]]]), mat: "vc",
    };
    case "blanket": return { g: mc([[bx(1.9, 1.5, 0.02), [1, 1, 1]]]), mat: "vc", colored: true };
    // a stone kerb round a pond: drawn as instanced blocks along its edge
    case "coping": return { g: mc([[bx(1.05, 0.55, 0.22, 0, 0, -0.04), [0.74, 0.72, 0.68]]]), mat: "vc" };
    case "drinking": return { g: mc([[cy(0.32, 0.9, 0, 8, 0.24), [0.25, 0.32, 0.3]], [cy(0.36, 0.12, 0.9, 8), [0.25, 0.32, 0.3]]]), mat: "vc" };
    // a refreshment kiosk: a little hexagonal hut with a pointed roof and a striped awning
    case "kiosk": return {
      g: mc([[cy(1.8, 2.6, 0, 6), [0.88, 0.84, 0.74]], [cy(1.85, 0.5, 1.0, 6), [0.18, 0.35, 0.26]], [cone(2.5, 1.5, 2.6, 6), [0.28, 0.3, 0.32]], [cy(0.06, 0.6, 4.1, 4), IRON],
        [new THREE.BoxGeometry(2.2, 0.9, 0.05).rotateX(0.5).translate(0, -1.95, 2.3), [0.75, 0.2, 0.18]]]), mat: "vc",
    };
    // a doubles tennis court with its run-off, lines, net and a chain-link
    // fence on posts: 17 x 35 m, the long axis along local y
    case "tennis": {
      const CRT = [0.22, 0.42, 0.34], RUN = [0.6, 0.32, 0.24], LINE = [0.95, 0.95, 0.93], FEN = [0.2, 0.26, 0.22];
      const parts: [THREE.BufferGeometry, number[]][] = [[bx(17.4, 35.4, 0.05), RUN], [bx(10.97, 23.77, 0.02, 0, 0, 0.05), CRT]];
      const ln = (w: number, d: number, x: number, y: number) => parts.push([bx(w, d, 0.01, x, y, 0.07), LINE]);
      for (const y of [-11.835, 11.835]) ln(10.97, 0.1, 0, y);
      for (const x of [-5.435, 5.435, -4.065, 4.065]) ln(0.1, 23.77, x, 0);
      for (const y of [-6.4, 6.4]) ln(8.23, 0.08, 0, y);
      ln(0.08, 12.8, 0, 0);
      parts.push([bx(12.8, 0.04, 0.95, 0, 0, 0.05), [0.12, 0.12, 0.12]], [bx(12.8, 0.06, 0.07, 0, 0, 0.98), LINE]);
      for (const x of [-6.4, 6.4]) parts.push([cy(0.05, 1.07, 0.05, 5).translate(x, 0, 0), [0.25, 0.3, 0.28]]);
      // the fence: posts every 3.5 m, a top rail, a translucent-dark mesh panel low down
      for (let x = -8.7; x <= 8.71; x += 3.48) for (const y of [-17.7, 17.7]) parts.push([cy(0.04, 3.2, 0, 4).translate(x, y, 0), FEN]);
      for (let y = -17.7; y <= 17.71; y += 3.54) for (const x of [-8.7, 8.7]) parts.push([cy(0.04, 3.2, 0, 4).translate(x, y, 0), FEN]);
      for (const y of [-17.7, 17.7]) { parts.push([bx(17.4, 0.04, 0.04, 0, y, 3.15), FEN]); parts.push([bx(17.4, 0.02, 1.0, 0, y, 0.05), [0.28, 0.33, 0.3]]); }
      for (const x of [-8.7, 8.7]) { parts.push([bx(0.04, 35.4, 0.04, x, 0, 3.15), FEN]); parts.push([bx(0.02, 35.4, 1.0, x, 0, 0.05), [0.28, 0.33, 0.3]]); }
      return { g: mc(parts), mat: "vc" };
    }
    // a bronze figure on a granite pedestal, facing local -y
    case "statue": {
      const BR = [0.26, 0.33, 0.28], GR = [0.62, 0.6, 0.57];
      return {
        g: mc([[bx(2.2, 2.2, 0.35), GR], [bx(1.5, 1.5, 1.7, 0, 0, 0.35), [0.7, 0.68, 0.64]], [bx(1.8, 1.8, 0.25, 0, 0, 2.05), GR],
          [bx(0.32, 0.26, 0.9, -0.12, 0, 2.3), BR], [bx(0.32, 0.26, 0.9, 0.12, 0, 2.3), BR], [bx(0.62, 0.42, 0.95, 0, 0, 3.2), BR],
          [bx(0.16, 0.18, 0.8, -0.38, 0, 3.3), BR], [new THREE.BoxGeometry(0.16, 0.7, 0.16).rotateX(0.9).translate(0.38, -0.25, 4.05), BR],
          [new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0, 4.36), BR]]), mat: "vc",
      };
    }
    // a dog: body, head, legs, tail; the coat is the instance colour
    case "dog": return {
      g: mc([[bx(0.62, 0.22, 0.24, 0, 0, 0.3), [1, 1, 1]], [bx(0.22, 0.18, 0.2, 0.36, 0, 0.46), [1, 1, 1]], [bx(0.1, 0.1, 0.06, 0.5, 0, 0.5), [0.6, 0.6, 0.6]],
        ...[[-0.24, -0.08], [-0.24, 0.08], [0.22, -0.08], [0.22, 0.08]].map(([x, y]) => [bx(0.06, 0.06, 0.3, x, y, 0), [0.9, 0.9, 0.9]] as [THREE.BufferGeometry, number[]]),
        [new THREE.BoxGeometry(0.22, 0.04, 0.04).rotateY(-0.6).translate(-0.38, 0, 0.6), [1, 1, 1]]]), mat: "vc", colored: true,
    };
    // a fountain's jet and the water falling back into its upper bowl
    case "spray": return { g: mc([[cy(0.09, 1.9, 3.45, 6, 0.04), [1, 1, 1]], [new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1, 0.5).translate(0, 0, 5.2), [1, 1, 1]],
      [new THREE.CylinderGeometry(0.55, 2.2, 2.75, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 3.85), [1, 1, 1]], [new THREE.CylinderGeometry(2.3, 4.4, 1.7, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, 1.4), [1, 1, 1]]]), mat: "water" };
    // a gate pier: a dressed stone pillar with a capstone and a ball finial
    case "gatepier": return { g: mc([[bx(0.75, 0.75, 2.0), [0.74, 0.71, 0.66]], [bx(0.95, 0.95, 0.18, 0, 0, 2.0), [0.66, 0.63, 0.58]], [new THREE.SphereGeometry(0.28, 10, 8).translate(0, 0, 2.45), [0.66, 0.63, 0.58]]]), mat: "vc" };
    // a mallard on the water: body, head, bill; the body is the instance colour
    case "duck": return { g: mc([[new THREE.SphereGeometry(0.18, 8, 6).scale(1.5, 0.9, 0.7).translate(0, 0, 0.05), [1, 1, 1]], [new THREE.SphereGeometry(0.09, 8, 6).translate(0.2, 0, 0.2), [0.16, 0.36, 0.2]], [bx(0.09, 0.05, 0.03, 0.31, 0, 0.17), [0.9, 0.72, 0.2]]]), mat: "vc", colored: true };
    // a weeping willow's crown: a dome and a long skirt of hanging leaf down
    // to head height, darker inside; the trunk is the ordinary trunk
    case "willow": {
      const parts: [THREE.BufferGeometry, number[]][] = [];
      parts.push([new THREE.SphereGeometry(3.4, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1, 0.55).translate(0, 0, 6.6), [1.05, 1.08, 0.9]]);
      let s2 = 71; const r = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r() * 0.2, R = 2.9 + r() * 0.6, h = 3.6 + r() * 1.6;
        parts.push([new THREE.CylinderGeometry(0.75, 0.35, h, 5, 1, false).rotateX(Math.PI / 2).translate(Math.cos(a) * R, Math.sin(a) * R, 6.7 - h / 2), [0.78 + r() * 0.2, 0.82 + r() * 0.2, 0.7]]);
      }
      parts.push([new THREE.SphereGeometry(2.6, 10, 6).scale(1, 1, 0.6).translate(0, 0, 5.8), [0.55, 0.58, 0.5]]);
      return { g: mc(parts), mat: "leaf", colored: true };
    }
    // a section of square railing: spear-topped iron bars on a stone kerb, 2.5 m
    case "parkrail": {
      const parts: [THREE.BufferGeometry, number[]][] = [[bx(2.5, 0.36, 0.3), [0.66, 0.64, 0.6]], [bx(2.5, 0.05, 0.05, 0, 0, 0.42), IRON], [bx(2.5, 0.05, 0.05, 0, 0, 1.25), IRON]];
      for (let x = -1.18; x < 1.2; x += 0.16) { parts.push([bx(0.025, 0.025, 1.2, x, 0, 0.3), IRON]); parts.push([cone(0.035, 0.12, 1.5, 4).translate(x, 0, 0), IRON]); }
      parts.push([bx(0.12, 0.12, 1.55, -1.22, 0, 0.3), IRON]);
      return { g: mc(parts), mat: "vc" };
    }
    // A FORMAL GARDEN: a gravel square inside a clipped box hedge open at
    // each side, four hedged beds (their roses are flowerbed instances), a
    // sundial at the crossing. 18 m square.
    case "parterre": {
      const BOX = [0.16, 0.3, 0.15], GRAV = [1.2, 1.1, 0.88];
      const parts: [THREE.BufferGeometry, number[]][] = [[bx(18, 18, 0.03), GRAV]];
      const hedge = (x0: number, y0: number, x1: number, y1: number) => {
        const w = Math.abs(x1 - x0) || 0.4, d = Math.abs(y1 - y0) || 0.4;
        parts.push([bx(w, d, 0.5, (x0 + x1) / 2, (y0 + y1) / 2, 0.03), BOX]);
      };
      // the outer hedge, with a 2.4 m opening mid-side
      for (const sd of [-1, 1]) {
        hedge(-8.8, sd * 8.8, -1.2, sd * 8.8); hedge(1.2, sd * 8.8, 8.8, sd * 8.8);
        hedge(sd * 8.8, -8.8, sd * 8.8, -1.2); hedge(sd * 8.8, 1.2, sd * 8.8, 8.8);
      }
      // four beds: soil inside a low box edging
      for (const qx of [-1, 1]) for (const qy of [-1, 1]) {
        const cx = qx * 4.6, cy = qy * 4.6;
        parts.push([bx(5.6, 5.6, 0.12, cx, cy, 0.03), [0.3, 0.22, 0.16]]);
        for (const sd of [-1, 1]) {
          parts.push([bx(6.0, 0.3, 0.32, cx, cy + sd * 2.95, 0.03), BOX]);
          parts.push([bx(0.3, 6.0, 0.32, cx + sd * 2.95, cy, 0.03), BOX]);
        }
      }
      parts.push([cy(0.45, 0.9, 0.03, 8), [0.72, 0.7, 0.66]], [cy(0.32, 0.06, 0.93, 12), [0.55, 0.45, 0.25]], [bx(0.04, 0.3, 0.2, 0, 0.05, 0.99), [0.55, 0.45, 0.25]]);
      return { g: mc(parts), mat: "vc" };
    }
    // a stone cross over a grave, and a flat ledger stone
    case "gcross": return { g: mc([[bx(0.5, 0.35, 0.3), [0.8, 0.8, 0.8]], [bx(0.14, 0.12, 1.25, 0, 0, 0.3), [1, 1, 1]], [bx(0.62, 0.12, 0.14, 0, 0, 1.15), [1, 1, 1]]]), mat: "vc", colored: true };
    case "ledger": return { g: mc([[bx(0.95, 2.0, 0.22), [1, 1, 1]], [bx(0.85, 1.9, 0.04, 0, 0, 0.22), [0.92, 0.92, 0.92]]]), mat: "vc", colored: true };
    // a rowing boat for hire, oars shipped
    case "rowboat": return {
      g: mc([[new THREE.CylinderGeometry(0.62, 0.42, 3.2, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI).scale(1, 1, 0.55).translate(0, 0, 0.3), [1, 1, 1]],
        [bx(0.08, 1.1, 0.06, 0.2, 0, 0.22), [0.5, 0.36, 0.22]], [bx(0.08, 1.1, 0.06, -0.8, 0, 0.22), [0.5, 0.36, 0.22]],
        [new THREE.BoxGeometry(0.05, 2.6, 0.04).rotateX(0.1).translate(0.1, 0, 0.32), [0.62, 0.48, 0.3]]]), mat: "vc", colored: true,
    };
    // a single jet in the middle of a big pond
    // a single jet in the middle of a big pond: a slim plume, its crown, and
    // a ring of thin streams falling back with a splash where they land
    case "pondjet": {
      const parts: [THREE.BufferGeometry, number[]][] = [[cy(0.1, 6.2, 0, 6, 0.04), [1, 1, 1]], [new THREE.SphereGeometry(0.45, 8, 6).scale(1, 1, 1.4).translate(0, 0, 6.2), [1, 1, 1]]];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const arc = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 6.2), new THREE.Vector3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 6.6), new THREE.Vector3(Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0)), 8, 0.06, 4, false);
        parts.push([arc, [1, 1, 1]]);
        parts.push([new THREE.SphereGeometry(0.28, 6, 4).scale(1, 1, 0.4).translate(Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0.03), [1, 1, 1]]);
      }
      parts.push([new THREE.SphereGeometry(0.6, 8, 4).scale(1, 1, 0.3).translate(0, 0, 0.05), [1, 1, 1]]);
      return { g: mc(parts), mat: "water" };
    }
    // the park's notice board at a gate: a framed green board on two posts, facing local -y
    case "parksign": return { g: mc([[bx(0.08, 0.08, 1.9, -0.65, 0, 0), IRON], [bx(0.08, 0.08, 1.9, 0.65, 0, 0), IRON], [bx(1.4, 0.07, 0.95, 0, 0, 0.85), [0.86, 0.82, 0.7]], [bx(1.28, 0.08, 0.83, 0, -0.01, 0.91), [0.13, 0.3, 0.2]], [bx(1.5, 0.2, 0.08, 0, 0, 1.82), IRON]]), mat: "vc" };
    case "flagpole": return { g: mc([[bx(1.6, 1.6, 0.5), STONE], [cy(0.09, 11, 0.5, 6, 0.05), WHITE], [new THREE.SphereGeometry(0.14, 6, 4).translate(0, 0, 11.6), [0.8, 0.65, 0.25]], [bx(0.02, 1.8, 1.1, 0, 0.95, 10.2), [0.7, 0.18, 0.16]]]), mat: "vc" };
  }
  return null;
}

/** Long meadow grass, a few metres a tile: tussocks and seed heads, white-based so the season tints it. */
export function longGrassTex(): THREE.CanvasTexture {
  const N = 256;
  const { c, g } = makeCanvas(N, N);
  let s = 5113; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = "#e6ead2"; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 5000; i++) {
    const x = rnd() * N, y = rnd() * N, l = 3 + rnd() * 6, d = rnd() < 0.55;
    g.strokeStyle = d ? `rgba(${70 + rnd() * 30 | 0},${90 + rnd() * 30 | 0},${40},0.4)` : `rgba(255,250,215,0.35)`;
    g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y - l); g.stroke();
  }
  return finish(c);
}
/** Wildflowers on a transparent ground: buttercup, ox-eye daisy, cornflower, clover, poppy. */
export function bloomTex(): THREE.CanvasTexture {
  const N = 256;
  const { c, g } = makeCanvas(N, N);
  let s = 6007; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const COLS = ["#f4d23a", "#f7f5ec", "#5c78d6", "#c56aa6", "#d8362c"];
  for (let i = 0; i < 2400; i++) {
    const x = rnd() * N, y = rnd() * N, r = 1.2 + rnd() * 2;
    g.fillStyle = COLS[(rnd() * rnd() * COLS.length) | 0];
    g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
  }
  return finish(c);
}
