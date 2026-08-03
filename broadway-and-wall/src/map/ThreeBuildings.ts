// The beautiful-buildings renderer: a Three.js custom layer inside MapLibre.
// Every building is a real mesh with a procedural facade — window grids
// aligned to actual floor counts, ~12 skin families by age and class,
// view-dependent sky reflections on glass, cornices, gabled colonial roofs,
// and instanced rooftop furniture. MapLibre still owns the ground map,
// camera, and picking.
import * as THREE from "three";
import maplibregl from "maplibre-gl";

/** A context point that knows which way it is pointing. Bearing in degrees. */
export interface Oriented { p: [number, number]; r: number }

/**
 * Points scattered inside a ring, deterministically.
 *
 * A jittered lattice over the ring's bounding box, rejecting anything outside
 * the polygon. Lattice-then-reject rather than uniform random because a lot
 * wants its cars and its trees SPREAD — pure random clumps, and a clump of
 * cars in the corner of an acre of gravel reads as a wreck yard.
 */
function scatterInRing(ring: [number, number][], n: number, seed: number): [number, number][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const inside = (px: number, py: number) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * ((maxX - minX) / Math.max(1, maxY - minY)))));
  const rows = Math.max(1, Math.ceil(n / cols));
  let s = Math.floor(seed * 1e6) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out: [number, number][] = [];
  for (let r = 0; r < rows && out.length < n; r++) {
    for (let c = 0; c < cols && out.length < n; c++) {
      const px = minX + ((c + 0.5 + (rnd() - 0.5) * 0.7) / cols) * (maxX - minX);
      const py = minY + ((r + 0.5 + (rnd() - 0.5) * 0.7) / rows) * (maxY - minY);
      // 1.6 m in from the fence, so nothing straddles it
      if (inside(px, py) && inside(px + 1.6, py) && inside(px - 1.6, py) &&
          inside(px, py + 1.6) && inside(px, py - 1.6)) out.push([px, py]);
    }
  }
  return out;
}

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
  x?: number;  // 1 = this volume is the ROOF of its building, not a setback
               //     terrace under it. Bulkheads, masts and stepped crowns
               //     go here and nowhere else.
  dk?: string; // decorative kind: hull0-2, super, funnel, box0-2, crane, shed, light, boat, mast...
  r: [number, number][]; // footprint ring, lon/lat
}

// What each decorative kind is painted. The harbor used to be a fleet of
// uniform grey boxes; a hull is navy or rust, a wheelhouse is white, a crane
// is safety-ochre, containers come in shipping-line colors, the lighthouse
// is whitewashed. Small flat colors, same light rig as everything else.
const DECO_TINT: Record<string, [number, number, number]> = {
  hull0: [0.20, 0.24, 0.33], hull1: [0.48, 0.22, 0.17], hull2: [0.16, 0.17, 0.19],
  super: [1.12, 1.10, 1.05], funnel: [0.55, 0.20, 0.16],
  box0: [0.75, 0.38, 0.16], box1: [0.24, 0.38, 0.58], box2: [0.30, 0.52, 0.34],
  crane: [0.95, 0.72, 0.25], shed: [0.86, 0.83, 0.74],
  light: [1.14, 1.12, 1.06], lightcap: [0.55, 0.20, 0.16],
  boat: [1.06, 1.03, 0.96], mast: [0.90, 0.90, 0.88],
  // the bandstand's posts are one octagonal ring, not eight separate columns,
  // so painting them white made a drum. Dark, they read as the shadow you
  // actually see under a bandstand roof from any distance worth drawing at.
  banddeck: [0.92, 0.88, 0.78], bandroof: [0.40, 0.52, 0.43], bandpost: [0.30, 0.28, 0.26],
  // whitewashed clapboard and slate — the meeting house and the town hall
  civic: [1.16, 1.15, 1.10], civicroof: [0.44, 0.46, 0.50],
  // raw concrete and the galvanised headhouse on top of it — grain elevators
  // are the one industrial building taller than the district around them, and
  // they are not painted, they are poured
  silo: [0.80, 0.79, 0.75], siloroof: [0.52, 0.54, 0.55],
};

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
const S_LAWN = 12;   // park turf
const S_PATH = 13;   // park walk: compacted buff gravel
const S_POND = 14;   // park water

function styleFor(v: BuildingVolume): number {
  if (v.d) return S_PLAIN;
  // THE DARK PREMIUM TOWER NOBODY HAS EVER SEEN.
  //
  // S_DARK — bronze glass, gold-tinted glazing, the best modern building on
  // the block — was gated on a volume clearing 110 m. No modern volume in any
  // generated city clears 110 m: measured over three towns, the tallest were
  // 96, 98 and 126 m and every one of those was prewar. The style existed in
  // the shader, in the palette, in the tint table, and it had never once been
  // drawn. Gate it on the BUILDING's floor count instead — which every volume
  // of a stacked building shares, so a tower does not change material halfway
  // up the way a height test on each volume would make it.
  if (v.f >= 15 && v.y >= 1975) return S_DARK;
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
attribute float aEra;
attribute vec2 aSeg;   // wall segment span in perimeter units (u0, u1)
attribute vec2 aCcv;   // corner sign at each end: +1 convex, -1 concave
attribute vec3 aTint;
attribute float aLit;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying vec2 vSeg, vCcv;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh, vEra;
varying float vLit;
void main() {
  vNormal = normal;
  vTint = aTint;
  vPos = position;
  vSeg = aSeg; vCcv = aCcv;
  vLit = aLit;
  vU = aU; vZ = position.z; vStyle = aStyle; vRand = aRand; vVar = aVar; vTop = aTop; vFh = aFh; vEra = aEra;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The light rig. One sun, a sky dome, and a warm bounce off the pavement —
// which is what actually makes massing read: cool light from above, warm
// light from below, and a real shadow between them. Everything lands in a
// filmic curve so highlights roll off instead of clipping to paper white.
const LIGHT_GLSL = /* glsl */ `
// THE SUN SITS LOW. It used to stand at forty-eight degrees — near noon, the
// one hour no architectural photographer would ever shoot in. Twenty-eight
// degrees is late afternoon: shadows run nearly twice the height of what casts
// them, every west face lights up, every east face falls into shade, and the
// massing of the city finally has something to read against. The sun is warmer
// to match, and the sky fill is lifted so the long shadows stay blue and
// legible instead of going black.
uniform vec3 uSunDir;
uniform vec3 uSunCol;
#define SUN_DIR uSunDir
#define SUN_COL uSunCol
const vec3 SKY_COL = vec3(0.53, 0.635, 0.83);
const vec3 GND_COL = vec3(0.48, 0.405, 0.31);

vec3 hemiLight(vec3 n, float ao) {
  vec3 amb = mix(GND_COL, SKY_COL, clamp(n.z * 0.5 + 0.5, 0.0, 1.0));
  return amb * ao;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// filmic roll-off plus a gentle split-tone: cool in the shadows, warm in the
// light. Keeps the pale architectural-model palette but stops it going chalky.
vec3 grade(vec3 c) {
  vec3 t = aces(c * 1.06);
  t = mix(c * 0.92, t, 0.9);
  float lum = dot(t, vec3(0.2126, 0.7152, 0.0722));
  t = mix(vec3(lum), t, 1.16);                 // ACES eats chroma; put it back
  t = clamp(t, 0.0, 1.0);
  lum = dot(t, vec3(0.2126, 0.7152, 0.0722));
  t *= mix(vec3(0.935, 0.972, 1.082), vec3(1.062, 1.007, 0.926), smoothstep(0.16, 0.84, lum));
  return t;
}`;

const SEASON_GLSL = /* glsl */ `
uniform vec4 uSeason;
#define SNOW   uSeason.x
#define AUTUMN uSeason.y
#define BARE   uSeason.z
#define VIGOUR uSeason.w

vec3 seasonGreen(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 gold = l * vec3(1.62, 1.16, 0.42);
  vec3 dorm = l * vec3(1.32, 1.20, 0.86);
  c = mix(c, gold, AUTUMN * 0.72);
  c = mix(c, dorm, (1.0 - VIGOUR) * 0.42);
  return c;
}

vec3 snowOn(vec3 c, float up, float k) {
  return mix(c, vec3(0.905, 0.925, 0.975), clamp(SNOW * up * k, 0.0, 1.0));
}
`;

// AERIAL PERSPECTIVE. Air is not transparent. Over a mile of it, contrast
// drains out of everything and the color creeps toward the sky — which is the
// single strongest depth cue human vision has, and the one thing separating a
// city from a diorama. Every fragment shader below ends with it. The falloff
// is scaled by how high the camera sits, so the effect reads the same whether
// you are looking down a street or across the whole harbor.
const HAZE_GLSL = /* glsl */ `
const vec3 HAZE_COL = vec3(0.772, 0.836, 0.902);
vec3 aerial(vec3 c, vec3 p, vec3 cam) {
  float d = length(p - cam);
  float k = max(cam.z, 140.0);
  float f = 1.0 - exp(-(d / k) * 0.070);
  return mix(c, HAZE_COL, clamp(f, 0.0, 1.0) * 0.47);
}`;

/**
 * A 32-bit key from a BBL, in EXACT integer arithmetic.
 *
 * The obvious `Number(bbl) * 2654435761` is 2.7e18 for a ten-digit BBL, which
 * is three hundred times past the 2^53 where doubles stop counting by ones —
 * so the bottom nine bits of the product are always zero and anything mixed in
 * below that granularity is silently discarded before the hash ever sees it.
 * It happens to survive here because every term is large, which is a bad
 * reason for a hash to work. FNV over the digits costs ten iterations and is
 * correct for any BBL anyone ever invents.
 */
function keyOf(bbl: string): number {
  let h = 2166136261;
  for (let i = 0; i < bbl.length; i++) { h ^= bbl.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * A well-mixed [0,1) from two integers. Two calls with different constants give
 * two INDEPENDENT streams, which is the whole point — the old scheme derived
 * its second scalar from its first, so colour and detail moved together.
 */
function hash01(a: number, b: number): number {
  let x = (Math.imul(a, 2654435761) ^ Math.imul(b, 2246822519)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Twice the signed area of a ring — enough to compare two footprints. */
function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a);
}

const PROP_VERT = /* glsl */ `
// instanceColor is declared for us when the mesh carries one
uniform vec4 uSeason;
uniform float uFoliage;   // 0 = not a leaf, 1 = deciduous canopy, 2 = conifer
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
void main() {
  float bare = uSeason.z * step(0.5, uFoliage) * step(uFoliage, 1.5);
  vec3 p = position;
  p.xy *= mix(1.0, 0.32, bare);
  p.z  *= mix(1.0, 0.94, bare);
  vN = normalize(mat3(instanceMatrix) * normal);
  vW = (instanceMatrix * vec4(p, 1.0)).xyz;
  vC = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}`;

// same rig, for props that aren't instanced (the construction crane)
const PROP_VERT_PLAIN = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
void main() {
  vN = normalize(normal);
  vW = position;
  vC = vec3(1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SHADOW_GLSL = /* glsl */ `
uniform sampler2D uShadow;
uniform mat4 uSunVP;
uniform float uShadowOn;
float unpackDepth(vec4 c) {
  return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}
// THE SHADOWS DID NOT TOUCH THE GROUND.
//
// The depth bias was 0.0028 in NDC. The sun camera runs near 1 to far 6000,
// so NDC depth is linear over 5,999 metres and that constant was
// 0.0028 x 5999 = SIXTEEN POINT EIGHT METRES of depth pushed along the light
// ray. At the shader's own sun elevation (asin(0.496) = 29.7 degrees) that is
// 14.6 m of it horizontal.
//
// The median building in this city is 13.0 m tall and throws a 22.8 m shadow.
// So 64% of the median building's shadow was erased before it was drawn, and
// anything under about 8.3 m cast NO SHADOW AT ALL — which is most of the
// city. Every building floated a car's length above its own footprint.
//
// A bias belongs in metres, where it can be reasoned about. 1.6 m is a little
// over one shadow texel (the sun camera covers 4,400 m across a 3,072 map, so
// a texel is 1.43 m) and that is what a constant bias is for. The rest of the
// acne is handled where acne actually comes from — surfaces seen edge-on to
// the light — by offsetting the sample along the surface normal instead of
// burying the whole scene deeper into the light.
const float SHADOW_SPAN_M = 5999.0;   // the sun camera's far minus its near
const float SHADOW_BIAS_M = 1.6;      // was 0.0028 NDC == 16.80 m
const float SHADOW_NORMAL_M = 1.15;   // ~one texel, along the surface normal

// 1.0 = fully sunlit, 0.0 = fully shadowed (4-tap PCF)
float sunVis(vec3 p, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uSunVP * vec4(p + n * SHADOW_NORMAL_M, 1.0);
  vec3 ndc = sc.xyz / sc.w * 0.5 + 0.5;
  if (ndc.x < 0.0 || ndc.x > 1.0 || ndc.y < 0.0 || ndc.y > 1.0 || ndc.z > 1.0) return 1.0;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 off = vec2(float(i - (i / 2) * 2) - 0.5, float(i / 2) - 0.5) * (1.4 / 3072.0);
    float d = unpackDepth(texture2D(uShadow, ndc.xy + off));
    sum += step(ndc.z - SHADOW_BIAS_M / SHADOW_SPAN_M, d);
  }
  return sum * 0.25;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying vec2 vSeg, vCcv;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh, vEra;
varying float vLit;
uniform float uOpacity;
uniform vec3 uCam;
${"" /* shadow sampling */}
` + SHADOW_GLSL + LIGHT_GLSL + HAZE_GLSL + SEASON_GLSL + /* glsl */ `

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  int s = int(vStyle + 0.5);
  vec3 n = normalize(vNormal);
  float vis = sunVis(vPos, n);

  // ---- ambient occlusion --------------------------------------------------
  // Light doesn't reach the bottom of a street wall, and it doesn't reach into
  // an inside corner. Without these two terms a building looks pasted onto
  // the ground instead of standing on it.
  float aoGround = mix(0.64, 1.0, smoothstep(0.0, 7.5, vZ));
  // A TIGHT CONTACT LINE, which is a different thing from the soft gradient
  // above it. The 7.5 m falloff is the street canyon losing sky; what makes a
  // wall look like it is STANDING on the pavement rather than hovering a
  // centimetre above it is a hard dark band in the bottom metre and a half,
  // and it has to survive into the direct term or a sunlit facade floats.
  float contact = mix(0.55, 1.0, smoothstep(0.0, 1.6, vZ));
  float dA = vU - vSeg.x, dB = vSeg.y - vU;
  float wA = 1.0 - smoothstep(0.0, 1.7, dA);
  float wB = 1.0 - smoothstep(0.0, 1.7, dB);
  float edge = clamp(wA * vCcv.x + wB * vCcv.y, -1.0, 1.0);
  float aoCorner = edge < 0.0 ? mix(1.0, 0.58, -edge) : 1.0;
  float edgeLift = edge > 0.0 ? 1.0 + 0.055 * edge : 1.0;   // convex arris catches light
  // the underside of a cornice or setback keeps its own shade
  float aoEave = mix(0.80, 1.0, smoothstep(0.0, 1.6, vTop - vZ));
  float ao = aoGround * aoCorner * aoEave * contact;

  // ---- palette by style + variant -----------------------------------------
  vec3 wall; vec3 glassA; vec3 glassB; float colW; vec2 win;
  bool glassy = false;
  if (s == 0) { // curtain wall — the "wall" is dark spandrel glass
    glassy = true; colW = 1.7; win = vec2(0.93, 0.78);
    if (vVar < 0.35)      { glassA = vec3(0.38, 0.58, 0.62); glassB = vec3(0.62, 0.80, 0.80); wall = vec3(0.20, 0.30, 0.32); } // blue-green
    else if (vVar < 0.7)  { glassA = vec3(0.55, 0.60, 0.66); glassB = vec3(0.78, 0.83, 0.88); wall = vec3(0.32, 0.35, 0.39); } // silver
    else                  { glassA = vec3(0.52, 0.44, 0.34); glassB = vec3(0.76, 0.66, 0.52); wall = vec3(0.30, 0.24, 0.18); } // bronze
  } else if (s == 1) { colW = 3.0; win = vec2(0.46, 0.52);
    // SEVEN STONES, NOT THREE. A street of pre-war masonry is never three
    // colours repeated — it is limestone next to brownstone next to granite
    // next to something somebody painted in 1954, and the eye reads the
    // variety long before it reads any single building.
    // ERA CHOOSES THE STONE. These seven ran off vVar alone, so a building
    // finished in 1885 and one finished in 2018 drew from the same hat — and
    // this one style carries 1,655 buildings across 133 years. Sorted here
    // dark-to-pale against age: brownstone and granite are what the 1880s
    // built with, limestone and pale ashlar are the 1910s, and paint is what
    // somebody did to all of it in 1954.
    float pk = clamp(vVar * 0.58 + vEra * 0.42, 0.0, 0.999);
    if (pk < 0.14)        { wall = vec3(0.46, 0.35, 0.31); } // dark brownstone
    else if (pk < 0.30)   { wall = vec3(0.55, 0.40, 0.33); } // brownstone
    else if (pk < 0.44)   { wall = vec3(0.63, 0.60, 0.57); } // grey granite
    else if (pk < 0.58)   { wall = vec3(0.70, 0.66, 0.61); } // soot-washed
    else if (pk < 0.72)   { wall = vec3(0.79, 0.75, 0.66); } // pale ashlar
    else if (pk < 0.87)   { wall = vec3(0.86, 0.81, 0.70); } // limestone
    else                  { wall = vec3(0.78, 0.79, 0.72); } // painted
    glassA = vec3(0.30, 0.36, 0.42); glassB = vec3(0.44, 0.52, 0.58);
  } else if (s == 2) { colW = 2.9; win = vec2(0.42, 0.50);
    // The same for brick, which carries 2,403 buildings across 109 years on
    // one palette. Deep red and dark brown are 19th-century common brick; tan
    // and buff are the 1920s; whitewash and grey paint are what happened later.
    float pk = clamp(vVar * 0.60 + vEra * 0.40, 0.0, 0.999);
    if (pk < 0.15)        { wall = vec3(0.63, 0.34, 0.28); } // deep red
    else if (pk < 0.29)   { wall = vec3(0.49, 0.38, 0.34); } // dark brown
    else if (pk < 0.43)   { wall = vec3(0.72, 0.46, 0.36); } // red brick
    else if (pk < 0.57)   { wall = vec3(0.58, 0.42, 0.34); } // brown
    else if (pk < 0.71)   { wall = vec3(0.76, 0.62, 0.46); } // tan
    else if (pk < 0.83)   { wall = vec3(0.80, 0.71, 0.55); } // buff
    else if (pk < 0.93)   { wall = vec3(0.83, 0.80, 0.74); } // whitewash
    else                  { wall = vec3(0.60, 0.55, 0.53); } // grey-painted
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
  // The wall's own tangent frame: T runs along the facade, Z is up. Everything
  // that gives a window depth — parallax, jamb shading, the sun's angle across
  // the opening — is computed in this frame.
  vec3 T = normalize(cross(vec3(0.0, 0.0, 1.0), n));
  vec3 Vw = normalize(uCam - vPos);
  float facing = max(dot(n, Vw), 0.18);
  // reveal depth: masonry punches deep openings, curtain wall is nearly flush
  float revealM = (s == 0 || s == 7) ? 0.10 : (s == 4 ? 0.16 : 0.30);

  float u = vU / colW;
  float v = vZ / fh;
  // how many pixels a floor spans: everything expensive below is skipped once
  // the facade is too small on screen for it to read
  float lod = clamp(max(fwidth(u), fwidth(v)) * 2.6 - 0.3, 0.0, 1.0);
  float near = 1.0 - lod;
  // parallax: shift the opening against the view so glass sits behind the wall
  float par = revealM * near / facing;
  u -= (dot(Vw, T) * par) / colW;
  v -= (dot(Vw, vec3(0.0, 0.0, 1.0)) * par) / fh;
  vec2 f = vec2(fract(u), fract(v));
  vec2 m = (1.0 - win) * 0.5;
  float aaX = fwidth(f.x) * 0.9 + 1e-4;
  float aaY = fwidth(f.y) * 0.9 + 1e-4;
  float wx = smoothstep(m.x - aaX, m.x + aaX, f.x) * (1.0 - smoothstep(1.0 - m.x - aaX, 1.0 - m.x + aaX, f.x));
  float wy = smoothstep(m.y + 0.04 - aaY, m.y + 0.04 + aaY, f.y) * (1.0 - smoothstep(1.0 - m.y - aaY, 1.0 - m.y + aaY, f.y));
  float winMask = wx * wy;

  if (vZ > vTop - 1.0) winMask = 0.0; // parapet

  // pre-war character: darker stone base and a cornice shadow line
  if (s == 1 || s == 6) {
    if (vZ < fh * 2.0 && vZ > fh * 1.15) wall *= 0.88;
    if (vZ > vTop - 2.3 && vZ < vTop - 1.0) wall *= 0.82;
  }

  // ---- ARCHITECTURE, not just colour --------------------------------------
  // Three details that carry almost all of the character of nineteenth and
  // early twentieth century masonry, and that the fabric had none of: a
  // string course banding the facade at a floor line, arched window heads on
  // the older stock, and quoins running up the corners of the good addresses.
  // They cost nothing — the shader already knows where the floors and the
  // window openings are — and they are what stops a brick wall reading as a
  // grid of holes.
  bool masonry = (s == 1 || s == 2 || s == 3);
  if (masonry && near > 0.15) {
    // STRING COURSE. A projecting band of stone at one floor line, on maybe
    // half the buildings, at a height that varies with the building.
    if (vRand > 0.46) {
      float bandFl = floor(2.0 + vRand * 3.0);          // 2nd to 4th floor
      float bz = vZ - bandFl * fh;
      if (bz > -0.34 && bz < 0.14) {
        // lit on top, shadowed underneath, the way a projecting course reads
        wall *= bz > -0.12 ? 1.12 : 0.80;
        winMask *= smoothstep(0.0, 0.10, abs(bz + 0.10));
      }
    }
    // ARCHED HEADS. Round-topped openings on the older stock: cut the top
    // corners off the window by pushing the mask in as it nears the head.
    if (vVar > 0.55 && s != 3) {
      float wyA = clamp((f.y - m.y - 0.04) / max(win.y, 0.001), 0.0, 1.0);
      float wxA = abs(f.x - 0.5) / max(win.x * 0.5, 0.001);
      // the arch springs at 70% of the opening height
      float spring = smoothstep(0.70, 1.0, wyA);
      float rad = sqrt(max(0.0, 1.0 - spring * spring));
      winMask *= 1.0 - smoothstep(rad - 0.16, rad + 0.02, wxA * spring);
      // a keystone-and-voussoir band follows the arch
      if (wyA > 0.86 && wyA < 1.06) wall *= 1.07;
    }
    // QUOINS. Alternating blocks up the corner, on the better buildings. vSeg
    // carries where this fragment sits along the wall, so "near the end" is
    // known exactly.
    if (vRand > 0.62 && vTop > fh * 2.2) {
      // A quoin is a corner, so it has to be measured as a FRACTION of the
      // wall it is on. At a flat 0.9 m from each end, a short return wall was
      // entirely quoin — which is why whole facades came out banded like a
      // deckchair and lost their windows to it.
      float segLen = max(1.0, vSeg.y - vSeg.x);
      float dEnd = min(vU - vSeg.x, vSeg.y - vU);
      if (segLen > 8.0 && dEnd < min(0.85, segLen * 0.09)) {
        float course = step(0.5, fract(vZ / (fh * 0.34)));
        wall *= mix(0.94, 1.09, course);
        winMask = 0.0;
      }
    }
  }
  // art deco: recessed spandrels keep the vertical piers running
  if (s == 6 && f.y < 0.18) wall *= 0.84;

  // ---- glass: per-window life + sky reflection ----------------------------
  float wid = hash(vec2(floor(u) + vRand * 61.0, floor(v)));
  vec3 glass = mix(glassA, glassB, clamp(vZ / max(vTop, 1.0), 0.0, 1.0));
  glass = mix(glass, glass * 1.25, step(0.82, wid));
  glass = mix(glass, glass * 0.72, step(wid, 0.14));

  vec3 V = Vw;
  vec3 R = reflect(-V, n);
  float skyT = clamp(R.z * 0.9 + 0.35, 0.0, 1.0);
  vec3 sky = mix(vec3(0.80, 0.78, 0.72), vec3(0.56, 0.72, 0.86), skyT);
  float fres = pow(1.0 - abs(dot(n, V)), 2.0);
  float refl = glassy ? (0.30 + 0.38 * fres) : (0.10 + 0.18 * fres);
  glass = mix(glass, sky, refl);
  if (glassy) wall = mix(wall, sky, 0.16 + 0.22 * fres); // spandrel sheen

  // window inset depth: lintel shadow above, bright sill below
  float winV = clamp((f.y - m.y - 0.04) / max(1.0 - 2.0 * m.y - 0.02, 0.001), 0.0, 1.0);
  glass *= mix(1.06, 0.74, winV);

  // ---- the reveal: a window is a hole with sides ---------------------------
  if (near > 0.02) {
  // Position within the opening, then shade the jamb the sun is behind and
  // the head it hangs under. This is what sells masonry depth.
  float wxr = clamp((f.x - m.x) / max(win.x, 0.001), 0.0, 1.0);
  float wyr = clamp((f.y - m.y - 0.04) / max(win.y, 0.001), 0.0, 1.0);
  float sunAlong = dot(SUN_DIR, T);
  float jambSide = sunAlong > 0.0 ? wxr : 1.0 - wxr;
  float jamb = 1.0 - smoothstep(0.0, 0.26, jambSide);
  float head = smoothstep(0.62, 1.0, wyr);
  float depthK = revealM / 0.30;                 // 1.0 for deep masonry
  float reveal = 1.0 - (0.42 * jamb + 0.34 * head) * depthK * abs(sunAlong) - 0.10 * head * depthK;
  glass *= mix(1.0, reveal, winMask);
  // the sill catches light kicked back off the pavement
  glass *= 1.0 + 0.16 * depthK * (1.0 - smoothstep(0.0, 0.16, wyr));

  // curtain-wall mullions: vertical caps between the lites
  if (glassy && winMask > 0.5) {
    float mull = 1.0 - smoothstep(0.0, 0.055, min(wxr, 1.0 - wxr));
    glass = mix(glass, glass * 0.66 + vec3(0.06), mull * 0.8);
  }
  // spandrel band reads as its own panel, not more wall
  if (glassy && winMask < 0.5) {
    float band = 1.0 - smoothstep(0.0, 0.10, min(f.y, 1.0 - f.y));
    wall *= 1.0 - 0.14 * band;
  }
  }

  vec3 col = mix(wall, glass, winMask);
  // sill highlight just under the window row
  col *= 1.0 + 0.10 * (1.0 - winMask) * smoothstep(0.0, 0.04, f.y) * (1.0 - smoothstep(0.04, 0.09, f.y)) * step(0.5, float(s != 0));
  // mullion shadow line under each floor
  col *= 1.0 - 0.10 * (1.0 - winMask) * (1.0 - smoothstep(0.08, 0.12, f.y)) * (1.0 - step(7.5, vStyle));

  // ---- the ground floor ---------------------------------------------------
  // Where the building meets the street it stops being a facade and becomes
  // shopfronts: a stone plinth, a bulkhead, deep glazing bay by bay, a signage
  // band, awnings, and one bay given over to the entrance.
  // THE BROWNSTONE STOOP. A residential row is not a shopping street, and
  // giving it shopfronts was the last wrong thing about the old fabric. What
  // it has instead is a rusticated basement at grade with an areaway, a
  // PARLOUR floor lifted a metre and a half above the pavement, and a door
  // with a stone surround at the top of a stoop. Getting the front door off
  // the ground is the whole silhouette of the type.
  bool row = (s == 2 && vTop < 26.0 && vTop > fh * 1.6);
  if (row && near > 0.25 && vZ < fh * 1.9) {
    float dw = 7.4;                                  // one house wide
    float du = vU / dw, df = fract(du);
    float hh = hash(vec2(floor(du) + 3.0, floor(vRand * 29.0)));
    vec3 stone = wall * (0.80 + 0.14 * hh);          // brownstone base course
    float areaTop = 1.45;                            // top of the basement
    float parlour = areaTop + fh * 0.16;             // parlour floor level
    bool doorBay = df > 0.63 && df < 0.86;

    if (vZ < areaTop) {
      // rusticated basement, with coursing and the areaway well in front
      col = stone * (0.86 + 0.09 * step(0.5, fract(vZ * 2.2)));
      if (df > 0.16 && df < 0.44 && vZ > 0.55 && vZ < areaTop - 0.15) {
        col = vec3(0.20, 0.21, 0.22);                // areaway window
      }
      if (doorBay) col = vec3(0.15, 0.145, 0.14);    // the well under the stoop
      winMask = 0.0;
    } else if (doorBay && vZ < parlour + fh * 0.62) {
      // the doorway: stone surround, dark leaf, fanlight over
      float dEdge = min(df - 0.63, 0.86 - df);
      if (dEdge < 0.035 || vZ < parlour) col = stone * 1.06;      // surround / step
      else if (vZ > parlour + fh * 0.52) col = vec3(0.34, 0.38, 0.42);  // fanlight
      else col = vec3(0.16, 0.13, 0.11) * (1.0 + 0.5 * (vZ - parlour));
      winMask = 0.0;
    } else if (vZ < parlour) {
      col = stone;                                    // plinth under the parlour
      winMask = 0.0;
    }
  }

  bool trade = (s <= 4 || s == 6 || s == 7) && !row;
  float gfTop = fh * 1.04;

  if (trade && near > 0.25 && vZ < gfTop && vTop > fh * 1.7) {
    float bw = 4.7;                                   // one shopfront bay
    float bu = vU / bw;
    float bf = fract(bu);
    float bayH = hash(vec2(floor(bu) + 0.5, floor(vRand * 53.0)));
    float doorBay = step(0.90, hash(vec2(floor(bu) + 11.0, vRand * 17.0)));

    vec3 base = wall * 0.86;                          // stone plinth
    vec3 frame = wall * 0.66;                         // shopfront framing
    vec3 shopGlass = mix(vec3(0.30, 0.33, 0.36), sky, 0.36 + 0.28 * fres);
    // a lit interior behind the glass, warmer and brighter deeper in the bay
    shopGlass = mix(shopGlass, vec3(0.80, 0.70, 0.52), 0.40 + 0.22 * bayH);

    float pierW = 0.14;                               // masonry between bays
    bool pier = bf < pierW || bf > 1.0 - pierW;
    float sillZ = 0.62, headZ = fh * 0.80, signTop = gfTop;

    vec3 gf;
    if (vZ < sillZ)            gf = base;                       // plinth
    else if (vZ > signTop)     gf = wall;                       // back to facade
    else if (vZ > headZ) {
      // signage band: each shop paints its own
      vec3 signCol = vec3(0.34 + 0.20 * bayH, 0.31 + 0.16 * fract(bayH * 7.3), 0.28 + 0.16 * fract(bayH * 3.1));
      gf = mix(wall * 0.86, signCol, 0.62);
    }
    else if (pier)             gf = frame;
    else if (doorBay > 0.5 && bf > 0.38 && bf < 0.62) {
      gf = vec3(0.13, 0.12, 0.12);                              // recessed doorway
      gf *= 1.0 + 0.5 * smoothstep(0.0, 0.5, vZ / max(headZ, 1.0));
    }
    else {
      gf = shopGlass;
      // transom bar and the bulkhead below the display window
      if (vZ < sillZ + 0.42) gf = frame * 1.06;
      if (abs(vZ - headZ * 0.82) < 0.09) gf = frame;
    }

    // awnings: a canvas over roughly half the bays, with its shadow on the glass
    float hasAwn = step(0.46, bayH);
    float awnZ0 = headZ * 0.86, awnZ1 = headZ * 1.02;
    if (hasAwn > 0.5 && !pier) {
      if (vZ > awnZ0 && vZ < awnZ1) {
        vec3 awn = vec3(0.44 + 0.22 * fract(bayH * 5.7), 0.34 + 0.16 * fract(bayH * 2.3), 0.30 + 0.14 * bayH);
        // scalloped valance
        float scallop = 0.5 + 0.5 * sin(bf * 34.0);
        gf = mix(awn, awn * 0.78, scallop * smoothstep(awnZ1 - 0.22, awnZ1, vZ));
      } else if (vZ < awnZ0) {
        gf *= mix(0.62, 1.0, smoothstep(0.0, 1.5, awnZ0 - vZ));   // the awning's shade
      }
    }
    col = gf;
    winMask = (vZ > sillZ && vZ < headZ && !pier) ? 1.0 : 0.0;
  }

  // THE DISSOLVE, AND WHAT HAS TO SURVIVE IT.
  //
  // A floor is roughly two pixels tall at the camera this game actually sits
  // at, so the window grid has to go before it aliases into noise. Measured
  // there: mean lod 0.959, and 85.4% of every wall pixel in the frame above
  // 0.9. That is the dissolve doing its job.
  //
  // It was also doing it to everything else. Every line above this one —
  // the reveals, the shopfronts, the stoops, a century of soot — was being
  // averaged out to within four per cent of a flat colour before it reached
  // the screen, and only came back when you put your nose on a single block.
  // A magenta test band on the ground floor rendered THIRTY-SEVEN PIXELS out
  // of a million at the default camera. It was not the ground-floor gate. It
  // was this line, eating the whole facade.
  //
  // So the shader is now in two halves. Above: PATTERN — window grids, bay
  // hashing, transom bars, things made of edges, which genuinely cannot be
  // drawn at two pixels a floor and are correctly dissolved. Below: VALUE —
  // tone, not edges, which is exactly what a facade still has at two pixels a
  // floor, and which now runs after the dissolve so distance cannot erase it.
  vec3 facadeAvg = mix(wall, mix(glassA, glassB, 0.5), win.x * win.y * 0.8);
  col = mix(col, facadeAvg, lod);

  // ---- value: the half of the facade that reads from the air --------------

  // A GROUND FLOOR. Eighty-five lines of shopfront sit above, behind a
  // near > 0.25 gate that only 7.1% of wall pixels clear at the default
  // camera. What a shopfront is at that distance is not a transom bar, it is
  // a band of dark at the bottom of the wall, because glazing is a hole in a
  // building. So: one smoothstep, and a plinth line where the base stops —
  // crossfaded against lod so it carries the ground floor when the detailed
  // version cannot be drawn, and steps aside when it can.
  if (trade && vZ < gfTop && vTop > fh * 1.7) {
    float gfk = 1.0 - smoothstep(gfTop * 0.72, gfTop, vZ);
    col = mix(col, mix(col * 0.70, mix(glassA, glassB, 0.35), 0.42), gfk * 0.66 * lod);
    float plinth = smoothstep(0.55, 0.75, vZ / gfTop) * (1.0 - smoothstep(0.75, 0.95, vZ / gfTop));
    col *= 1.0 - plinth * 0.22 * lod;
  }

  // OCCUPANCY YOU CAN SEE FROM THE AIR.
  //
  // Nothing about the economy reached this renderer. You could own half the
  // waterfront and be bleeding on every foot of it, and the map that fills the
  // screen would look exactly the same as the map of a full building — so the
  // simulation and the picture were two things sharing a window rather than
  // one object. A principal does not read a spreadsheet to know which of his
  // towers is empty. He looks at it.
  //
  // What a vacant floor actually is, from the air and in daylight, is a floor
  // with no fit-out in it: no ceiling, no blinds, no furniture, nothing behind
  // the glass to catch the light. It reads flat, cool and a little dark, and
  // it is the flatness that gives it away rather than the darkness. Let floors
  // read normal. In the low winter sun the let ones pick up a warm interior,
  // because at four o'clock in December the lights are already on.
  //
  // The bands are about three floors deep and their split is per building, so
  // a half-let tower reads as half dark and fills up over the quarters you
  // spend leasing it. They are deliberately NOT the window grid, which is two
  // pixels tall at the camera this game sits at and correctly dissolved a few
  // lines above — this has to survive the distance, so it is built out of
  // value at a frequency that can.
  if (vLit >= 0.0) {
    float bandH = fh * 3.0;
    float band = floor(vZ / bandH + hash(vec2(vRand * 91.0, 7.0)) * 5.0);
    float roll = hash(vec2(band, vRand * 47.0 + 3.0));
    // the bottom of a building lets first and stays let longest — ground-floor
    // retail and the anchor above it are the last space to go dark
    float low = 1.0 - smoothstep(0.0, vTop * 0.55, vZ);
    float let_ = smoothstep(roll - 0.14, roll + 0.14, clamp(vLit + low * 0.22, 0.0, 1.0));
    float dark = 1.0 - let_;
    // flatter, cooler, dimmer where nobody is
    col = mix(col, vec3(dot(col, vec3(0.34, 0.38, 0.28))) * vec3(0.92, 0.97, 1.08) * 0.78, dark * 0.80);
    // and warm behind the glass where somebody is, hardest when the sun is low
    float dusk = 1.0 - smoothstep(0.10, 0.42, SUN_DIR.z);
    col += vec3(0.085, 0.058, 0.022) * let_ * dusk * (0.35 + 0.65 * winMask);
  }

  // A CENTURY LEAVES A MARK.
  //
  // Not a dirt texture — the two things that actually make an old wall look
  // old at this distance. Airborne carbon darkens and warms everything that
  // has stood through it, hardest on the masonry styles that were there for
  // the coal. And it collects: rain washes the exposed field of a wall and
  // never reaches the sheltered courses, so an old building is streaked
  // light-and-dark down its own height while a new one is flat.
  if (!glassy) {
    float age = 1.0 - vEra;                             // 0 = new, 1 = 1870
    // age^1.5 rather than age^2: the median building sits at age 0.43, and a
    // square law put only four per cent of darkening on it, which is nothing.
    float soot = pow(age, 1.5) * 0.42;
    col = mix(col, col * vec3(0.80, 0.78, 0.74), soot);
    // washed where the weather gets at it, dirty where it does not
    vec2 wp = vec2(vU * 0.09, vZ * 0.055);
    vec2 wi = floor(wp), wf = fract(wp);
    wf = wf * wf * (3.0 - 2.0 * wf);
    float wash = mix(mix(hash(wi), hash(wi + vec2(1.0, 0.0)), wf.x),
                     mix(hash(wi + vec2(0.0, 1.0)), hash(wi + vec2(1.0, 1.0)), wf.x), wf.y);
    col *= 1.0 + age * 0.22 * (wash - 0.5);
  }


  // ---- light --------------------------------------------------------------
  float ndl = max(dot(n, SUN_DIR), 0.0);
  vec3 light = SUN_COL * (ndl * vis * 0.92 * mix(0.72, 1.0, smoothstep(0.0, 1.9, vZ))) + hemiLight(n, ao);
  // glass throws a specular back at the sun; masonry doesn't
  if (glassy) {
    vec3 V = normalize(uCam - vPos);
    vec3 H = normalize(SUN_DIR + V);
    light += SUN_COL * pow(max(dot(n, H), 0.0), 48.0) * 0.55 * vis * winMask;
  }
  col *= light * edgeLift;
  col *= vTint;
  gl_FragColor = vec4(aerial(grade(col), vPos, uCam), uOpacity);
}`;

const ROOF_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying vec2 vSeg, vCcv;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh, vEra;
varying float vLit;
uniform float uOpacity;
uniform vec3 uCam;
` + SHADOW_GLSL + LIGHT_GLSL + HAZE_GLSL + SEASON_GLSL + /* glsl */ `
float rhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rhash(i), rhash(i + vec2(1.0, 0.0)), f.x),
             mix(rhash(i + vec2(0.0, 1.0)), rhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  int s = int(vStyle + 0.5);
  vec3 roof;
  if (s == 0)       roof = vec3(0.70, 0.715, 0.735);
  else if (s == 1)  roof = vec3(0.64, 0.605, 0.545);
  else if (s == 2)  roof = vec3(0.60, 0.53, 0.46);
  else if (s == 3)  roof = vec3(0.58, 0.60, 0.615);
  else if (s == 4)  roof = vec3(0.21, 0.225, 0.255);
  else if (s == 6)  roof = vec3(0.585, 0.545, 0.455);
  else if (s == 7)  roof = vec3(0.66, 0.68, 0.68);
  else if (s == 8)  roof = vec3(0.60, 0.56, 0.48);   // cornice cap
  else if (s == 9)  roof = vec3(0.47, 0.62, 0.36);   // green roof
  else if (s == 10) roof = vec3(0.575, 0.545, 0.475); // gravel lot
  else if (s == 12) roof = vec3(0.455, 0.585, 0.335); // park turf
  else if (s == 13) roof = vec3(0.760, 0.720, 0.630); // park walk
  else if (s == 14) roof = vec3(0.272, 0.400, 0.436); // park water
  else if (s == 11) {                                 // shingles
    if (vVar < 0.34)      roof = vec3(0.205, 0.135, 0.108);  // weathered red asphalt
    else if (vVar < 0.62) roof = vec3(0.150, 0.162, 0.185);  // slate
    else if (vVar < 0.84) roof = vec3(0.245, 0.340, 0.295);  // oxidised copper
    else                  roof = vec3(0.330, 0.306, 0.268);  // grey weathered wood
  }
  else              roof = vec3(0.76, 0.76, 0.74);
  roof *= 0.92 + 0.16 * vRand;

  // ---- surface: membrane seams, gravel, patches, shingle courses ----------
  vec2 wp = vPos.xy;
  if (s == 9) {
    // planting beds read as clumped growth, not a green sheet
    float g = rnoise(wp * 0.55) * 0.6 + rnoise(wp * 1.7) * 0.4;
    roof *= 0.82 + 0.36 * g;
    roof = mix(roof, vec3(0.58, 0.55, 0.44), smoothstep(0.62, 0.78, rnoise(wp * 0.3)) * 0.35);
  } else if (s == 11) {
    // shingle courses run with the slope
    float course = fract(vPos.z * 1.6);
    roof *= 0.90 + 0.13 * step(0.5, course);
    roof *= 0.94 + 0.12 * rnoise(wp * 3.1);
  } else if (s == 12) {
    // TURF. Mown in bands, blond where it bakes, damper and darker under the
    // trees, worn through to dirt on the desire lines. A lawn is the largest
    // uniform surface in the city and the one the eye rests on longest, so it
    // is the last place a flat fill survives contact with a low sun.
    float band = sin(wp.x * 0.115 + wp.y * 0.052);
    roof *= 0.955 + 0.075 * step(0.0, band);
    float clump = rnoise(wp * 0.09) * 0.55 + rnoise(wp * 0.42) * 0.45;
    roof = mix(roof, vec3(0.545, 0.578, 0.375), smoothstep(0.52, 0.86, clump) * 0.55);
    roof = mix(roof, vec3(0.330, 0.455, 0.290), smoothstep(0.46, 0.14, clump) * 0.50);
    roof *= 0.94 + 0.12 * rnoise(wp * 1.9);
    roof = mix(roof, vec3(0.560, 0.515, 0.415), smoothstep(0.80, 0.96, rnoise(wp * 0.6 + 41.0)) * 0.45);
  } else if (s == 13) {
    roof *= 0.94 + 0.13 * rnoise(wp * 2.6);              // raked gravel
    roof *= 0.97 + 0.06 * rnoise(wp * 0.5);
  } else if (s == 14) {
    float rip = rnoise(wp * 0.9) * 0.6 + rnoise(wp * 3.3) * 0.4;
    roof *= 0.90 + 0.20 * rip;                            // ripple and depth
    roof = mix(roof, vec3(0.44, 0.55, 0.47), smoothstep(0.62, 0.88, rnoise(wp * 1.4)) * 0.30);
  } else if (s == 10) {
    // not every empty lot is gravel: some have gone to grass and weeds, and a
    // few are packed dirt — the patchwork a real city's vacant land actually is
    // Value separation matters more than hue here. Vacant ground was pitched
    // within a few percent of the sidewalk, so lots and streets merged into
    // one pale field and whole districts read as a blank apron. Ground is
    // DARKER than paving — it always is — and the city snaps into blocks the
    // moment it is.
    if (vVar > 0.62)      roof = mix(vec3(0.435, 0.520, 0.305), vec3(0.505, 0.560, 0.350), rnoise(wp * 1.1));
    else if (vVar < 0.18) roof = vec3(0.515, 0.435, 0.335);
    roof *= 0.88 + 0.24 * rnoise(wp * 2.4);   // gravel / scrub texture
  } else {
    int dk = int(max(vSeg.x, 0.0) + 0.5);
    vec3 deck;
    if (dk == 1)      deck = vec3(0.095, 0.091, 0.086);  // hot-mopped tar, weathered BUR
    else if (dk == 2) deck = vec3(0.118, 0.124, 0.134);  // black EPDM sheet
    else if (dk == 3) deck = vec3(0.190, 0.183, 0.172);  // dark slag ballast
    else if (dk == 4) deck = vec3(0.352, 0.362, 0.375);  // weathered galvanised / terne
    else if (dk == 5) deck = vec3(0.550, 0.553, 0.542);  // aluminised asphalt coating
    else if (dk == 6) deck = vec3(0.445, 0.458, 0.474);  // grey PVC
    else if (dk == 7) deck = vec3(0.780, 0.785, 0.768);  // white TPO cool roof
    else if (dk == 8) deck = vec3(0.470, 0.418, 0.340);  // tan mineral-cap mod-bit
    else              deck = vec3(0.300, 0.283, 0.250);  // gravel-ballasted built-up
    deck += (1.0 - deck) * (0.10 * (0.30 + 0.55 * vRand) * (1.0 - vEra));
    roof = deck * (0.90 + 0.20 * vRand);

    vec2 dir = vCcv;
    float dl = length(dir);
    dir = dl > 0.5 ? dir / dl : vec2(1.0, 0.0);
    vec2 rp = vec2(dot(wp, dir), dot(wp, vec2(-dir.y, dir.x)));
    roof *= 1.0 + 0.034 * cos(rp.x * 0.6866);
    roof *= 1.0 + 0.015 * cos(rp.y * 0.5150);
    // SEAM PITCH IS A PROPERTY OF THE MATERIAL, and it was one number for the
    // whole city: 0.3279, which is a seam every 3.05 m on every roof in town
    // whatever it is made of. A roll of modified bitumen is a metre wide. A
    // standing-seam metal pan is four hundred millimetres. A ballasted
    // built-up roof has no seams you can see at all, because there is four
    // inches of gravel on top of them. Getting this wrong makes every roof in
    // the city the same roof seen from different angles.
    float pitch =
        dk == 4 ? 2.42                    // standing-seam metal: narrow pans
      : dk == 7 ? 0.98                    // TPO sheet, welded laps
      : dk == 6 ? 0.86                    // PVC, wider sheet
      : dk == 2 ? 0.62                    // EPDM comes in big sheets
      : dk == 8 ? 1.06                    // mod-bit roll
      : dk == 1 ? 0.44                    // hot-mopped BUR: felt laps, coarse
      :           0.0;                    // ballast and slag: nothing shows
    float fine = 1.0 - smoothstep(0.30, 0.85, fwidth(rp.x));
    if (pitch > 0.0) {
      float sf = fract(rp.x * pitch);
      roof *= 1.0 - 0.13 * fine * (1.0 - smoothstep(0.0, 0.075, min(sf, 1.0 - sf)));
    }

    float ws = fract(abs(vSeg.y) * 0.61803399) * 40.0;
    float p1 = rnoise(wp * 0.115 + ws);
    float p2 = rnoise(wp * 0.27 + ws * 1.7);
    float pond = p1 * 0.62 + p2 * 0.38;
    // PONDING IS A SHEEN, NOT A HOLE. This mixed 45% toward half-brightness
    // inside a soft noise blob, and stacked with the repairs below it turned
    // every roof in the city into a field of dark amoebas — the single ugliest
    // thing in the render. Standing water on a roof is DAMP: a few per cent
    // darker, a little cooler, with no edge you could point at. That is all it
    // has ever looked like from the air.
    float stain = 0.10 + 0.20 * dot(deck, vec3(0.2126, 0.7152, 0.0722));
    roof = mix(roof, roof * vec3(0.90, 0.93, 0.96), smoothstep(0.50, 0.86, pond) * stain);
    if (dk == 0 || dk == 3) roof = mix(roof, roof * vec3(0.86, 0.85, 0.83), smoothstep(0.58, 0.86, p2) * 0.30);
    roof *= 0.955 + 0.09 * rnoise(wp * 0.7);
    roof = mix(roof, roof * 0.92, smoothstep(0.52, 0.86, rnoise(wp * 0.22 + 17.0)) * 0.42);

    // ---- what forty years on a roof actually looks like ------------------
    //
    // A roof is not resurfaced, it is PATCHED, over and over, by different
    // contractors in different decades with whatever was on the truck. That
    // map of repairs is the one thing that separates an old roof from a new
    // one at this distance — but only if it has the right SHAPE.
    //
    // I built it first as a threshold on smooth noise mixed 72% toward black,
    // and it read as holes: round dark amoebas sitting on every roof in town,
    // which is nothing like a roof and was the worst-looking thing in the
    // game. Two mistakes. A repair is not round — somebody rolls a STRIP of
    // membrane along the run and cuts it square, so a patched roof is a
    // patchwork of rectangles aligned to the same direction the seams are.
    // And a repair is not dark — it is the same material as the roof, laid at
    // a different time, so it differs from its neighbour by about a tenth of
    // its value, not by three quarters. Newer bitumen is darker; anything that
    // has been coated is lighter. Both happen.
    float wear = clamp(abs(vSeg.y), 0.0, 1.0) * (0.35 + 0.65 * (1.0 - vEra));
    vec2 pc = vec2(rp.x / 3.6, rp.y / 6.2);          // the roll grid, seam-aligned
    vec2 pcell = floor(pc), pf = fract(pc);
    float ph = rhash(pcell + ws);
    float patched = step(1.0 - (0.06 + 0.30 * wear), ph);
    // the strip does not fill its cell, and it is cut square
    float pw = 0.34 + 0.46 * rhash(pcell + 7.3);
    float phh = 0.40 + 0.44 * rhash(pcell + 13.1);
    float inPat = patched
      * step(abs(pf.x - 0.5), pw * 0.5)
      * step(abs(pf.y - 0.5), phh * 0.5);
    // a hard edge at three pixels is aliasing, not detail — fade the whole
    // thing out as the cell shrinks on screen, the same way the window grid does
    float pFine = 1.0 - smoothstep(0.22, 0.70, max(fwidth(pc.x), fwidth(pc.y)));
    float tone = rhash(pcell + 21.7) < 0.60 ? -1.0 : 1.0;
    roof *= 1.0 + tone * inPat * pFine * (0.055 + 0.075 * rhash(pcell + 31.0));

    // ALGAE AND BALD GRAVEL. A white roof does not stay white — it grows
    // gloeocapsa in streaks running down to the drains — and a ballasted roof
    // loses its stones wherever anybody walks or the wind scours, showing the
    // black felt underneath. Both are the deck telling you which deck it is.
    float lum = dot(deck, vec3(0.2126, 0.7152, 0.0722));
    if (lum > 0.45) {
      float alg = rnoise(vec2(rp.x * 0.5, rp.y * 0.09) + ws);
      roof = mix(roof, vec3(0.318, 0.352, 0.300), smoothstep(0.56, 0.86, alg) * wear * 0.62);
    }
    if (dk == 0 || dk == 3) {
      float bald = rnoise(wp * 0.44 + ws * 2.1);
      roof = mix(roof, vec3(0.135, 0.128, 0.120), smoothstep(0.68, 0.88, bald) * (0.25 + 0.5 * wear));
    }
    // (The drain sump used to be here — a darkened disc at every low point. At
    // the distance this game is played from it was a two-pixel dark dot, which
    // is a speck on a roof and not a roof detail, and it was a third of the
    // spotting problem. A roof drains; you cannot see it from an aeroplane.)
  }

  if (s == 9 || s == 12 || (s == 10 && vVar > 0.62)) roof = seasonGreen(roof);
  vec3 n = normalize(vNormal);
  if (SNOW > 0.001) {
    float up = smoothstep(0.28, 0.80, n.z);
    float drift = 0.62 + 0.55 * rnoise(wp * 0.22) + 0.20 * rnoise(wp * 1.3);
    if (s == 14) roof = mix(roof, vec3(0.63, 0.70, 0.76), clamp(SNOW * 1.15, 0.0, 1.0));
    roof = snowOn(roof, up, drift);
  }
  float vis = sunVis(vPos, n);
  // vU carries distance to the roof edge: the parapet shades its own deck
  float aoEdge = mix(0.78, 1.0, smoothstep(0.0, 2.8, vU));
  float ndl = max(dot(n, SUN_DIR), 0.0);
  vec3 light = SUN_COL * (ndl * vis * 0.92) + hemiLight(n, aoEdge);
  gl_FragColor = vec4(aerial(grade(roof * light * vTint), vPos, uCam), uOpacity);
}`;

// transparent quad over the whole city: darkens the MapLibre ground where
// buildings block the sun — streets get real cast shadows
const CATCHER_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform vec4 uSeason;
` + SHADOW_GLSL + /* glsl */ `
void main() {
  // The ground is flat and faces straight up; its own normal is the offset.
  float vis = sunVis(vPos, vec3(0.0, 0.0, 1.0));
  // A SHADOW YOU CAN SEE. This was 40% of a pale blue-grey, which was the
  // right call while the depth bias was erasing two thirds of every shadow
  // anyway — a faint smudge is less wrong than a faint smudge in the wrong
  // place. The bias is metres now and the shadows land where the buildings
  // are, so they are allowed to read: deeper, and cooler, because a shadow
  // outdoors is lit by the sky and the sky is blue.
  float sa = uSeason.x * 0.42;
  float a  = (1.0 - vis) * 0.60;
  vec3  sc = vec3(0.800, 0.828, 0.880);
  vec3  hc = mix(vec3(0.155, 0.185, 0.30), vec3(0.42, 0.49, 0.66), uSeason.x);
  float outA = sa + a * (1.0 - sa);
  vec3  outC = outA > 0.0001 ? (sc * sa * (1.0 - a) + hc * a) / outA : sc;
  gl_FragColor = vec4(outC, outA);
}`;

const CATCHER_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// LIVING WATER. Two crossed wave trains give a normal that actually moves,
// and everything else falls out of it: a Fresnel mix between deep water and
// sky, a sun glitter that breaks into sparkles on the wave faces, and a band
// of paler shallows near the shore. It is a few dozen instructions on one
// mesh, and it is the difference between a harbour and a blue rectangle.
const WATER_VERT = /* glsl */ `
attribute float aDepth;
varying vec2 vXY;
varying float vDepth;
void main() {
  vXY = position.xy;
  vDepth = aDepth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const WATER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vXY;
varying float vDepth;
uniform float uTime;
uniform vec3 uCam;
` + LIGHT_GLSL + HAZE_GLSL + /* glsl */ `
float wave(vec2 p, vec2 dir, float len, float spd, float t) {
  return sin(dot(p, dir) / len + t * spd);
}
void main() {
  vec2 p = vXY;
  float t = uTime;
  // three trains at different bearings and scales: one swell, two chop
  float h = wave(p, vec2(0.92, 0.39), 26.0, 1.05, t) * 0.55
          + wave(p, vec2(-0.44, 0.90), 13.0, 1.55, t) * 0.30
          + wave(p, vec2(0.68, -0.73), 6.2, 2.35, t) * 0.15;
  float dx = (wave(p + vec2(0.9, 0.0), vec2(0.92, 0.39), 26.0, 1.05, t) * 0.55
            + wave(p + vec2(0.9, 0.0), vec2(-0.44, 0.90), 13.0, 1.55, t) * 0.30
            + wave(p + vec2(0.9, 0.0), vec2(0.68, -0.73), 6.2, 2.35, t) * 0.15) - h;
  float dy = (wave(p + vec2(0.0, 0.9), vec2(0.92, 0.39), 26.0, 1.05, t) * 0.55
            + wave(p + vec2(0.0, 0.9), vec2(-0.44, 0.90), 13.0, 1.55, t) * 0.30
            + wave(p + vec2(0.0, 0.9), vec2(0.68, -0.73), 6.2, 2.35, t) * 0.15) - h;
  vec3 n = normalize(vec3(-dx * 0.66, -dy * 0.66, 1.0));

  vec3 V = normalize(uCam - vec3(p, 0.0));
  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);

  // SHALLOWS FOLLOW THE COAST. vDepth carries distance to the land edge, baked
  // per vertex, so the water genuinely pales where it runs up on the shore
  // instead of being one flat sheet with a painted band around it.
  float shoal = 1.0 - smoothstep(0.0, 190.0, vDepth);
  vec3 deep    = vec3(0.243, 0.418, 0.553);
  vec3 shallow = vec3(0.451, 0.639, 0.729);
  vec3 sky     = vec3(0.741, 0.843, 0.918);
  vec3 body = mix(deep, shallow, shoal * 0.85);
  vec3 col = mix(body, sky, 0.16 + 0.58 * fres);

  // the sun's road across the water — broad sheen, then hard sparkles on the
  // faces that happen to be pointing at it
  vec3 H = normalize(normalize(SUN_DIR) + V);
  float spec = pow(max(dot(n, H), 0.0), 220.0);
  float sheen = pow(max(dot(n, H), 0.0), 24.0);
  col += SUN_COL * (spec * 1.9 + sheen * 0.20);

  // foam: only on the real crests, and heavier in the shallows where the
  // swell actually breaks
  col += vec3(0.085) * smoothstep(0.86, 1.02, h) * (0.5 + 0.9 * shoal);
  // the far sea has to dissolve into the horizon or the plane's own edge
  // shows up as a hard line across the sky
  gl_FragColor = vec4(aerial(grade(col), vec3(vXY, 0.0), uCam), 1.0);
}`;

const PROP_FRAG = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uCam;
uniform float uFoliage;   // 0 = not a leaf, 1 = deciduous canopy, 2 = conifer
` + SHADOW_GLSL + LIGHT_GLSL + HAZE_GLSL + SEASON_GLSL + /* glsl */ `
void main() {
  vec3 n = normalize(vN);
  vec3 base = uColor * vC;
  if (uFoliage > 0.5 && uFoliage < 1.5) {
    base = seasonGreen(base);
    base = mix(base, vec3(0.068, 0.045, 0.030), BARE * 0.80);
  } else if (uFoliage > 1.5) {
    base = mix(base, base * vec3(0.82, 0.90, 0.94), (1.0 - VIGOUR) * 0.45);
  }
  if (SNOW > 0.001) base = snowOn(base, smoothstep(0.30, 0.85, n.z), 0.85);
  float vis = sunVis(vW, n);
  float ao = mix(0.62, 1.0, clamp(vW.z / 5.0, 0.0, 1.0));
  vec3 light = SUN_COL * (max(dot(n, SUN_DIR), 0.0) * vis * 0.92) + hemiLight(n, ao);
  gl_FragColor = vec4(aerial(grade(base * light), vW, uCam), uOpacity);
}`;

const SUN_LEN = 1.05799;
const SUN_EL_MID = 27.96, SUN_EL_AMP = 6.0;
const SUN_AZ_MID = 125.38, SUN_AZ_AMP = 12;
const SUN_COL_SUMMER: readonly [number, number, number] = [1.260, 1.090, 0.820];
const SUN_COL_WINTER: readonly [number, number, number] = [1.470, 0.772, 0.236];
const SUN_WARMTH = 0.55;

const SEASON_TABLE: readonly (readonly [number, number, number, number])[] = [
  [0.95, 0.00, 1.00, 0.00],  // Jan
  [1.00, 0.00, 1.00, 0.00],  // Feb
  [0.50, 0.00, 0.90, 0.12],  // Mar
  [0.08, 0.00, 0.42, 0.55],  // Apr
  [0.00, 0.00, 0.04, 0.90],  // May
  [0.00, 0.00, 0.00, 1.00],  // Jun
  [0.00, 0.00, 0.00, 1.00],  // Jul
  [0.00, 0.05, 0.00, 0.96],  // Aug
  [0.00, 0.28, 0.00, 0.82],  // Sep
  [0.00, 0.80, 0.12, 0.52],  // Oct
  [0.10, 0.95, 0.68, 0.16],  // Nov
  [0.62, 0.55, 0.96, 0.02],  // Dec
];

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
  private litAttrs: THREE.BufferAttribute[] = [];
  private baseTints: Float32Array[] = [];
  // ONE camera uniform, shared by every material — walls, roofs and props all
  // have to haze against the same eye point or the city separates into layers.
  private camUni = { value: new THREE.Vector3(0, 0, 800) };
  private timeUni = { value: 0 };
  private waterMat: THREE.ShaderMaterial | null = null;
  private lastFrame = 0;
  /** Exposed for playtests: the only way to assert a demolition really happened. */
  posAttrs: THREE.BufferAttribute[] = [];
  rangesByBBL = new Map<string, { attr: number; r: Ranges }[]>();
  private lotRings = new Map<string, [number, number][]>(); // vacant-lot footprints (meters)
  private ringByBBL = new Map<string, [number, number][]>(); // EVERY lot's footprint, built or not
  /** Exposed (not private) so a playtest can assert a demolition actually happened. */
  propsByBBL = new Map<string, { mesh: THREE.InstancedMesh; i: number }[]>();
  private flattened = new Set<string>();
  private dynGroup = new THREE.Group();
  private shadowTex: THREE.Texture | null = null;
  private water: THREE.Mesh | null = null;
  // dressing for the unbuilt half of the city, collected while the volumes are
  // walked and instanced along with the street planting
  private lotTrees: { x: number; y: number; s: number; rot: number }[] = [];
  private lotCars: { x: number; y: number; s: number; rot: number }[] = [];
  private sunVP = new THREE.Matrix4();
  private sunDirUni = { value: new THREE.Vector3(0.762, -0.541, 0.496) };
  private sunColUni = { value: new THREE.Vector3(1.26, 1.09, 0.82) };
  private seasonUni = { value: new THREE.Vector4(0, 0, 0, 1) };
  private simMonth = -1;
  private sunDirty = false;
  private shadowTarget: THREE.WebGLRenderTarget | null = null;
  private depthMat: THREE.MeshDepthMaterial | null = null;
  private groundCatcher: THREE.Mesh | null = null;
  visible = true;

  constructor(
    private volumes: BuildingVolume[],
    private center: [number, number],
    private curbs: [number, number][][] = [],
    private ctxPoints: {
      trees?: [number, number][];
      piles?: [number, number][];
      land?: [number, number][];
      // street furniture arrives with a baked bearing: a bench that does not
      // face its walk, or a railing post turned across the seawall, is worse
      // than no bench and no railing at all
      benches?: Oriented[];
      rails?: Oriented[];
      parks?: [number, number][][];
      ponds?: [number, number][][];
      paths?: [number, number][][];
    } = {},
    /**
     * The town's seed, mixed into every per-building hash. Without it a reroll
     * gave block 40 lot 3 the identical facade it had in the last city — the
     * geometry changed and the skin did not.
     */
    private citySeed = 1,
  ) {}

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
    const blank = () => ({
      pos: [] as number[], norm: [] as number[], u: [] as number[], style: [] as number[],
      rand: [] as number[], varr: [] as number[], top: [] as number[], fh: [] as number[],
      seg: [] as number[], ccv: [] as number[], era: [] as number[],
    });
    const W = blank();
    const R = blank();
    /**
     * THE RENDERER DID NOT KNOW HOW OLD ANY BUILDING WAS.
     *
     * `v.y` — the year the thing was built — sits on every volume record and
     * is used to gate gable, mansard and hip massing. Then it is thrown away.
     * meta is [style, rand, varr, top, fh]; there is no room in it for a date
     * and the fragment shader has never seen one.
     *
     * Measured over 5,697 built volumes in five cities: S_BRICK carries 2,403
     * buildings spanning 1885 to 1994 — a hundred and nine years, five
     * construction eras — through ONE eight-hue palette. S_PREWAR carries
     * 1,655 spanning 1885 to 2018 through one seven-stone palette. That is
     * 71.2% OF EVERY CITY painted by a style whose era span exceeds a century.
     * A house finished the year Grover Cleveland took office and a block of
     * flats finished the year the iPhone shipped are the same eight colours.
     *
     * One float fixes it. Set once per volume, read by every triangle that
     * volume emits, so a building's cornice ages with its wall.
     */
    let curEra = 0.5;
    let curDeck = 0, curWear = 0.5, curBearX = 1, curBearY = 0;
    const wallRanges: { bbl: string; r: Ranges }[] = [], roofRanges: { bbl: string; r: Ranges }[] = [];
    // EVERY PROP KNOWS WHICH BUILDING IT IS STANDING ON. Water tanks, cooling
    // towers, aerials and fire escapes were pushed into scene-level instanced
    // meshes with no reference back to a deed, so when a building came down
    // its roof furniture stayed hanging in the air over the empty lot. One
    // field fixes that.
    const props: { kind: number; x: number; y: number; z: number; s: number; rot: number; b?: string }[] = [];

    const volsPerBBL = new Map<string, number>();
    for (const v of this.volumes) if (v.b && !v.k) volsPerBBL.set(v.b, (volsPerBBL.get(v.b) ?? 0) + 1);

    const pushWallTri = (
      T: typeof W, a: number[], b: number[], c: number[], n: number[], us: number[], meta: number[],
      seg: [number, number] = [-1e6, 1e6], ccv: [number, number] = [0, 0],
    ) => {
      T.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) T.norm.push(n[0], n[1], n[2]);
      T.u.push(us[0], us[1], us[2]);
      for (let i = 0; i < 3; i++) {
        T.style.push(meta[0]); T.rand.push(meta[1]); T.varr.push(meta[2]); T.top.push(meta[3]); T.fh.push(meta[4]);
        T.era.push(curEra);
        T.seg.push(seg[0], seg[1]);
        T.ccv.push(ccv[0], ccv[1]);
      }
    };

    // +1 at a convex ring vertex, -1 at a reflex one. Inside corners collect
    // shadow; outside corners catch light.
    const cornerSigns = (ring: [number, number][]): number[] => {
      const n = ring.length;
      return ring.map((p, i) => {
        const prev = ring[(i - 1 + n) % n], next = ring[(i + 1) % n];
        const cross = (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]);
        return cross >= 0 ? 1 : -1;   // rings are wound CCW by this point
      });
    };

    const extrudeWalls = (T: typeof W, ring: [number, number][], z0: number, z1: number, meta: number[]) => {
      const signs = cornerSigns(ring);
      let perim = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const n = [dy / len, -dx / len, 0];
        const u0 = perim, u1 = perim + len;
        perim += len;
        const seg: [number, number] = [u0, u1];
        const cc: [number, number] = [signs[i], signs[(i + 1) % ring.length]];
        pushWallTri(T, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], n, [u0, u1, u1], meta, seg, cc);
        pushWallTri(T, [a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], n, [u0, u1, u0], meta, seg, cc);
      }
    };

    // On a roof, aU carries distance to the nearest edge — the shader uses it
    // to sink the deck into shade under its own parapet.
    const edgeDist = (ring: [number, number][], p: [number, number]): number => {
      let best = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
      }
      return best;
    };

    const capRoof = (T: typeof R, ring: [number, number][], z: number, meta: number[]) => {
      const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { tris = []; }
      // subdivide big triangles so the edge-distance gradient is smooth
      for (const t of tris) {
        const P = t.map((i) => ring[i]);
        const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const emit = (q: [number, number][]) => {
          const d = q.map((p) => edgeDist(ring, p));
          T.pos.push(q[0][0], q[0][1], z, q[1][0], q[1][1], z, q[2][0], q[2][1], z);
          for (let i = 0; i < 3; i++) T.norm.push(0, 0, 1);
          T.u.push(d[0], d[1], d[2]);
          for (let i = 0; i < 3; i++) {
            T.style.push(meta[0]); T.rand.push(meta[1]); T.varr.push(meta[2]); T.top.push(meta[3]); T.fh.push(meta[4]);
            T.era.push(curEra);
            T.seg.push(curDeck, curWear); T.ccv.push(curBearX, curBearY);
          }
        };
        const area = Math.abs((P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1])) / 2;
        if (area > 90) {
          const m01 = mid(P[0], P[1]), m12 = mid(P[1], P[2]), m20 = mid(P[2], P[0]);
          emit([P[0], m01, m20]); emit([m01, P[1], m12]); emit([m20, m12, P[2]]); emit([m01, m12, m20]);
        } else emit(P as [number, number][]);
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

    /**
     * A PITCHED CAP: loft the footprint up and inward to a smaller ring, then
     * lay a deck across the top.
     *
     * One construction covers both roofs the old city is actually made of.
     * Pull the top ring in hard and the slopes nearly meet — a hip. Leave it
     * wide and make the rise steep and you get a mansard, its flat deck hidden
     * behind the slope, which is exactly what a Second Empire roof is. It
     * works on any convex footprint, unlike the four-sided gable path, so it
     * reaches most of the fabric instead of a handful of cottages.
     *
     * Returns false when the inset ate the whole footprint, so the caller can
     * fall back to a flat roof rather than emit a cone of slivers.
     */
    const pitchCap = (ring: [number, number][], z: number, rise: number, inset: number, meta: number[]) => {
      const top = insetRing(ring, inset);
      if (!top) return false;
      let span = 0;
      for (let i = 0; i < top.length; i++) {
        const a = top[i], b = top[(i + 1) % top.length];
        span = Math.max(span, Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      if (span < 1.0) return false;   // insetRing clamps at the centroid
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const c = top[(i + 1) % top.length], d = top[i];
        const A = [a[0], a[1], z], B = [b[0], b[1], z];
        const C = [c[0], c[1], z + rise], D = [d[0], d[1], z + rise];
        const ux = B[0] - A[0], uy = B[1] - A[1];
        const wx = D[0] - A[0], wy = D[1] - A[1];
        // cross of the eave run (ux, uy, 0) with the rake (wx, wy, rise)
        let n = [uy * rise, -ux * rise, ux * wy - uy * wx];
        const L = Math.hypot(n[0], n[1], n[2]) || 1;
        n = n.map((q) => q / L);
        if (n[2] < 0) n = n.map((q) => -q);
        // u = 3 keeps the slope out of the parapet's edge-shading term, which
        // only means anything on a flat deck
        pushWallTri(R, A, B, C, n, [3, 3, 3], meta);
        pushWallTri(R, A, C, D, n, [3, 3, 3], meta);
      }
      capRoof(R, top, z + rise, meta);
      return true;
    };

    const decoTintRanges: { attr: number; r: Ranges; c: [number, number, number] }[] = [];
    for (const v of this.volumes) {
      const style = styleFor(v);
      // EVERY FACADE CHOICE IN THE CITY CAME OUT OF 485 NUMBERS.
      //
      // This was `((v.t + 1) * 0.19 + (bbl % 97) / 97) % 1`, with varr a pure
      // function of rnd — so the entire per-building random state was ONE
      // scalar with period lcm(5, 97) = 485. Four hundred and eighty-five
      // values existed, ever, in any city. And it never read the city seed, so
      // rerolling the town gave block 40 lot 3 the identical tone, banding,
      // quoins and parapet height it had before.
      //
      // Worse, it was periodic ON THE GROUND. bbl encodes block*10000 + lot,
      // so lot -> lot+5 moved rnd by 5/97 = 0.0515. Measured across every
      // parcel, mean |delta rnd| at lag 5 was 0.0515 against 0.333 for uniform
      // random — a row of houses ran light, mid, dark, light, mid and started
      // over every fifth lot. That stripe is what a street actually looks
      // like from above, and it is why the city read as wallpaper.
      //
      // Two independent hashes now, mixed with the city seed, so a reroll is a
      // genuinely different town and neighbours are uncorrelated.
      // 0 = 1870, 1 = 2030. Every triangle this volume emits carries it.
      curEra = Math.max(0, Math.min(1, ((v.y || 1950) - 1870) / 160));
      const key = keyOf(v.b) ^ Math.imul(v.t + 1, 0x9e3779b1);
      const rnd = hash01(key, this.citySeed);
      const varr = hash01(key ^ 0x5bf03635, Math.imul(this.citySeed, 3) + 1);
      const fh = v.f > 0 && v.z1 > 0 ? Math.max(2.6, v.z1 / Math.max(v.f, 1)) : 3.55;
      let ring = v.r.map((p) => this.project(p));
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
        area += x1 * y2 - x2 * y1;
      }
      if (area < 0) ring = ring.slice().reverse();

      {
        const yr = v.y || 1950;
        const modernCls = style === S_GLASS || style === S_DARK || style === S_RIBBON;
        const bigPlate = v.f >= 6 || v.z1 >= 24;
        const pool: number[] = [];
        if (yr < 1930)      pool.push(1, 1, 1, 0, 0, 0, 0, 3, 3, 4, 4, 5);
        else if (yr < 1960) pool.push(1, 1, 1, 0, 0, 0, 3, 3, 5, 5, 4, 8);
        else if (yr < 1982) pool.push(1, 1, 0, 0, 0, 3, 3, 5, 5, 8, 8, 4);
        else if (yr < 2003) pool.push(2, 2, 2, 2, 0, 3, 5, 5, 8, 8, 6, 6);
        else                pool.push(7, 7, 7, 6, 6, 6, 8, 8, 2, 5, 4);
        if (modernCls && bigPlate && yr >= 1982) pool.push(6, 6, 7, 7, 2, 2);
        if (style === S_MILL && yr < 1975) pool.push(0, 0, 4, 1, 1);
        curDeck = pool[Math.min(pool.length - 1, Math.floor(hash01(key ^ 0x2f7d3a11, this.citySeed ^ 0x5eed100f) * pool.length))];
        if (v.d) curDeck = 8;
        curWear = hash01(key ^ 0x7a1c9d3f, this.citySeed ^ 0x0badf00d);
        let bi = 0, bl = -1;
        for (let i = 0; i < ring.length; i++) {
          const p0 = ring[i], p1 = ring[(i + 1) % ring.length];
          const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          if (L > bl) { bl = L; bi = i; }
        }
        const p0 = ring[bi], p1 = ring[(bi + 1) % ring.length];
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        curBearX = (p1[0] - p0[0]) / L; curBearY = (p1[1] - p0[1]) / L;
      }

      const wallStart = W.pos.length / 3;
      const roofStart = R.pos.length / 3;

      // A FOOTPRINT FOR EVERY DEED. lotRings only ever recorded VACANT lots,
      // which is why demolishing a building you bought did nothing: the code
      // that clears a lot looked the ring up first and gave up when it was
      // missing. Keep the largest volume's ring for buildings made of several.
      if (v.b) {
        const prev = this.ringByBBL.get(v.b);
        if (!prev || Math.abs(area) > ringArea(prev)) this.ringByBBL.set(v.b, ring);
      }
      const propStart = props.length;

      // ---- vacant lot: gravel pad + low fence ------------------------------
      if (v.k) {
        if (v.b) this.lotRings.set(v.b, ring);
        capRoof(R, ring, 0.06, [S_LOT, rnd, varr, 1, fh]);
        const fence = insetRing(ring, 0.5);
        if (fence) extrudeWalls(W, fence, 0, 1.15, [S_LOT, rnd, varr, 1.15, fh]);
        // WHAT VACANT LAND ACTUALLY DOES. Nearly half this city is unbuilt —
        // that is the game's whole surface — and all of it read as blank plate
        // from the air, which is what turned whole districts into pale voids.
        // Empty ground in a real city is never empty: downtown lots get paved
        // and parked on, and the ones nobody bothers with go to weeds and
        // volunteer trees inside five years. The shader already splits gravel
        // / grass / dirt on vVar; this dresses each to match.
        const m2 = Math.abs(area) / 2;
        if (varr > 0.62) {
          // gone to scrub: small self-seeded trees, thicker toward the middle
          const n = Math.min(48, Math.max(3, Math.round(m2 / 85)));
          for (const p of scatterInRing(ring, n, rnd)) {
            this.lotTrees.push({ x: p[0], y: p[1], s: 0.55 + ((p[0] * 7.3 + p[1] * 3.1) % 1) * 0.45, rot: (p[1] * 2.1) % 6.28 });
          }
        } else if (varr > 0.18 && m2 > 380) {
          // surface parking, which is what a downtown hole in the ground earns
          // until somebody builds on it. Rows share one bearing — scattered
          // cars read as a junkyard, aligned ones read as a lot.
          let bi = 0, bl = -1;
          for (let i = 0; i < ring.length; i++) {
            const a2 = ring[i], b2 = ring[(i + 1) % ring.length];
            const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
            if (L > bl) { bl = L; bi = i; }
          }
          const a2 = ring[bi], b2 = ring[(bi + 1) % ring.length];
          const rot = Math.atan2(b2[1] - a2[1], b2[0] - a2[0]) + Math.PI / 2;
          // a stall plus its share of aisle is about 85 m2; the cap only
          // bites on the full-block lots, which really do hold that many
          const n = Math.min(90, Math.max(3, Math.round(m2 / 85)));
          for (const p of scatterInRing(ring, n, rnd + 0.37)) {
            this.lotCars.push({ x: p[0], y: p[1], s: 1, rot });
          }
        }
        if (v.b) {
          wallRanges.push({ bbl: v.b, r: { start: wallStart, count: W.pos.length / 3 - wallStart } });
          roofRanges.push({ bbl: v.b, r: { start: roofStart, count: R.pos.length / 3 - roofStart } });
        }
        continue;
      }

      const meta = [style, rnd, varr, v.z1, fh];
      const dWall0 = W.pos.length / 3, dRoof0 = R.pos.length / 3;
      extrudeWalls(W, ring, v.z0, v.z1, meta);

      // ---- gabled colonial roofs in the old fabric -------------------------
      const gable = ring.length === 4 && v.z1 > 0 && v.z1 <= 15 && v.y > 0 && v.y < 1945 &&
        (style === S_PREWAR || style === S_BRICK) && volsPerBBL.get(v.b) === 1;
      // the rest of the old stock, which the gable path could never reach
      const oldStock = !v.d && !v.k && !gable && v.y > 0 &&
        (style === S_PREWAR || style === S_BRICK) && ring.length >= 3;
      const mansard = oldStock && v.y < 1935 && v.z1 >= 11 && v.z1 <= 28 && varr > 0.66;
      const hip = oldStock && !mansard && v.y < 1945 && v.z1 > 3 && v.z1 <= 14 && varr > 0.34;
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
      } else if (mansard || hip) {
        // THE ROOFSCAPE OF THE OLD CITY. From the angle this game is played
        // at you look at roofs far more than facades, and every one of them
        // was the same flat grey plate. The four-sided gable path above only
        // ever reached detached quadrilaterals — a fraction of the fabric.
        //
        // A mansard is steep and shallow-inset, so the deck hides behind it;
        // that is the 1870s commercial block and the Second Empire townhouse.
        // A hip pulls in hard and reads as a cottage roof. Both are gated to
        // a minority of the pre-war stock on purpose: brownstones and
        // tenements really did have flat roofs, and a city where every
        // building is pitched is a village, not a downtown.
        // Decorrelate the slate colour from the roof-type gate. S_GABLE picks
        // its shingle out of vVar, and both gates below are vVar thresholds —
        // so every mansard in the city came out the same copper green and no
        // hip was ever brown. Re-hash it and the three slates spread evenly
        // across both.
        const slate = (varr * 3.71 + rnd * 1.93) % 1;
        const rMeta = [S_GABLE, rnd, slate, v.z1 + 4, fh];
        const span = Math.sqrt(Math.abs(area) / 2);
        const rise = mansard ? Math.min(4.2, Math.max(2.6, span * 0.30)) : Math.min(3.4, Math.max(1.9, span * 0.34));
        const inset = mansard ? Math.min(2.4, span * 0.16) : Math.max(1.6, span * 0.34);
        if (!pitchCap(ring, v.z1, rise, inset, rMeta)) capRoof(R, ring, v.z1, meta);
        else if (mansard) {
          // the cornice a mansard sits on — the eave line is the whole point
          const lip = insetRing(ring, -0.32);
          if (lip) {
            const cMeta = [S_CORNICE, rnd, varr, v.z1 + 0.3, fh];
            extrudeWalls(W, lip, v.z1 - 0.6, v.z1 + 0.1, cMeta);
            capRoof(R, lip, v.z1 + 0.1, cMeta);
          }
        }
      } else {
        capRoof(R, ring, v.z1, meta);
        // ------------------------------------------------- THE FIFTH FACADE
        //
        // FOUR CROWNS FOR A WHOLE CITY.
        //
        // A flat-roofed building could end in exactly four ways: a stone
        // cornice if it was prewar or deco, a plain parapet otherwise, plus an
        // optional green roof and — on deco towers over 45 m only — a three
        // step cap. Everything else in the city stopped at the same rim, at
        // the same 0.35 m projection, at the same height.
        //
        // That is why the skyline reads as one building. Project the game's
        // own camera at pitch 55 over the measured stock: for the median LOW
        // building — 279 m2 plate, three floors, 11 m, which is 92% of this
        // city — the roof is 160 m2 of projected area against 219 m2 of wall.
        // FORTY-TWO PER CENT OF THAT BUILDING'S PIXELS ARE ITS ROOF. For a
        // tower the flat deck is only 12%, but the top three floors of wall
        // are another 191 m2, so the CROWN ZONE IS 29% OF A TOWER'S PIXELS —
        // and it is the 29% that sits against the sky, where silhouette reads.
        //
        // "They all look similar" is a complaint about crowns, not facades.
        //
        // Twelve families now, offered by era, style and height, each built
        // out of the primitives already here. Independent hash streams, so a
        // building's crown does not move when its wall colour does.
        const cs = (n: number) => hash01(key ^ Math.imul(n + 1, 0x9e3779b1), this.citySeed ^ 0x00c0ffee);
        const tall = v.z1 >= 26 && !!v.x;
        const deco = style === S_ARTDECO;
        const modern = style === S_GLASS || style === S_DARK || style === S_RIBBON;
        const stone = style === S_PREWAR || deco || style === S_CORNICE;
        // WHAT THIS BUILDING'S TOP COULD PLAUSIBLY BE. Repeats are weights.
        const crowns: string[] = [];
        if (v.z1 >= 12) {
          if (stone) crowns.push("cornice", "cornice", "corbel", "decapitated");
          if (stone && tall) crowns.push("temple", "pyramid", "lantern");
          if (deco && tall) crowns.push("ziggurat", "ziggurat", "fin", "fin");
          if (modern) crowns.push("mech", "mech", "slope");
          if (modern && tall) crowns.push("amenity", "mech");
          if (!stone && !modern) crowns.push("coping", "corbel");
        }
        crowns.push("coping");                       // a plain parapet is a real answer
        const crown = crowns[Math.min(crowns.length - 1, Math.floor(cs(1) * crowns.length))];

        // The material a crown is made of is rarely the material of the wall
        // under it — that is most of what makes a top read as a top.
        const CROWN_MAT = [S_CORNICE, S_CORNICE, S_PLAIN, S_GABLE, S_BRICK, S_MILL];
        const cmat = deco || stone
          ? (cs(2) > 0.72 ? S_GABLE : S_CORNICE)     // copper and slate among the stone
          : CROWN_MAT[Math.floor(cs(2) * CROWN_MAT.length)];
        // Beta-ish: most crowns are shallow, a few are enormous.
        const ch = Math.max(1.2, Math.min(14, v.z1 * (0.028 + 0.087 * cs(3) * cs(4))));
        const M = (z: number, st = cmat) => [st, rnd, varr, z, fh];

        if (crown === "cornice") {
          // A PROJECTING CORNICE, in one to three courses. The projection was
          // hard-coded at 0.35 m on every cornice in the game; a real one runs
          // to two metres and throws a shadow you can see from the street.
          const courses = 1 + Math.floor(cs(5) * 3);
          let z = v.z1 - 0.55, proj = 0.35 + 1.75 * cs(6);
          for (let k = 0; k < courses; k++) {
            const lip = insetRing(ring, -proj);
            if (!lip) break;
            const zt = z + 0.5 + 0.35 * cs(7 + k);
            extrudeWalls(W, lip, z, zt, M(zt));
            capRoof(R, lip, zt, M(zt));
            z = zt; proj *= 0.55;
          }
        } else if (crown === "corbel") {
          // CORBELLED BRICK — courses stepping OUT as they rise, under a
          // coping. The commonest top in any nineteenth-century city and the
          // game had no way to draw it.
          let z = v.z1 - 0.3;
          for (let k = 0; k < 3; k++) {
            const lip = insetRing(ring, -(0.12 + k * 0.14));
            if (!lip) break;
            const zt = z + 0.42;
            extrudeWalls(W, lip, z, zt, [style, rnd, varr, zt, fh]);
            z = zt;
          }
          const cap = insetRing(ring, -(0.54 + 0.3 * cs(8)));
          if (cap) { extrudeWalls(W, cap, z, z + 0.3, M(z + 0.3)); capRoof(R, cap, z + 0.3, M(z + 0.3)); }
        } else if (crown === "decapitated") {
          // THE CORNICE CAME OFF. Half the prewar stock in every American city
          // lost its cornice to a leak, a fire code or a bill, and what is
          // left is a raw parapet with a crude concrete cap and a scar of
          // clean brick where the brackets were.
          const ph = 0.9 + 0.7 * cs(9);
          extrudeWalls(W, ring, v.z1 - 0.1, v.z1 + ph, [style, rnd, varr, v.z1, fh]);
          const cap = insetRing(ring, -0.10);
          if (cap) { extrudeWalls(W, cap, v.z1 + ph, v.z1 + ph + 0.22, M(v.z1 + ph + 0.22, S_PLAIN)); capRoof(R, cap, v.z1 + ph + 0.22, M(v.z1 + ph + 0.22, S_PLAIN)); }
          const inner = insetRing(ring, 0.28);
          if (inner) capRoof(R, inner, v.z1 + ph, M(v.z1 + ph, S_PLAIN));
        } else if (crown === "ziggurat") {
          // Two to four stepped setbacks with usable terraces. This existed
          // for deco towers over 45 m at a fixed three steps of fixed height;
          // now the count, the depth and the taper all move.
          const n = 2 + Math.floor(cs(10) * 3);
          let step0 = ring, zc = v.z1 + 0.2, depth = 0.9 + 3.6 * cs(11);
          for (let k = 0; k < n; k++) {
            const inset = insetRing(step0, depth);
            if (!inset) break;
            const hStep = Math.max(1.4, ch * (0.55 - k * 0.09));
            extrudeWalls(W, inset, zc, zc + hStep, [style, rnd, varr, zc + hStep, fh]);
            capRoof(R, inset, zc + hStep, M(zc + hStep));
            step0 = inset; zc += hStep; depth *= 0.75;
          }
        } else if (crown === "fin") {
          // VERTICAL PIERS OVERRUN THE ROOFLINE. The deco move: the shaft's
          // own mullions keep going past the last floor and the wall between
          // them stops, so the building ends in teeth rather than a line.
          const back = insetRing(ring, 0.55);
          if (back) { extrudeWalls(W, back, v.z1, v.z1 + ch * 0.55, [style, rnd, varr, v.z1 + ch, fh]); capRoof(R, back, v.z1 + ch * 0.55, M(v.z1 + ch * 0.55)); }
          const nF = ring.length;
          for (let i = 0; i < nF; i++) {
            const a2 = ring[i], b2 = ring[(i + 1) % nF];
            const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
            const steps = Math.max(1, Math.floor(L / 4.2));
            for (let k = 0; k < steps; k++) {
              const t = (k + 0.5) / steps;
              const px = a2[0] + (b2[0] - a2[0]) * t, py = a2[1] + (b2[1] - a2[1]) * t;
              const w = 0.62;
              const pier: [number, number][] = [[px - w, py - w], [px + w, py - w], [px + w, py + w], [px - w, py + w]];
              const hP = ch * (0.7 + 0.5 * hash01(key ^ Math.imul(i * 31 + k, 2654435761), this.citySeed));
              extrudeWalls(W, pier, v.z1 - 1.0, v.z1 + hP, M(v.z1 + hP));
              capRoof(R, pier, v.z1 + hP, M(v.z1 + hP));
            }
          }
        } else if (crown === "temple") {
          // A COLONNADED BELVEDERE — the open loggia on top of a 1920s bank.
          const base = insetRing(ring, 1.1 + 1.6 * cs(12));
          if (base) {
            extrudeWalls(W, base, v.z1, v.z1 + 0.5, M(v.z1 + 0.5));
            const colH = Math.max(2.6, ch * 1.1);
            const nT = base.length;
            for (let i = 0; i < nT; i++) {
              const a2 = base[i], b2 = base[(i + 1) % nT];
              const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
              const steps = Math.max(1, Math.floor(L / 3.4));
              for (let k = 0; k < steps; k++) {
                const t = (k + 0.5) / steps;
                const px = a2[0] + (b2[0] - a2[0]) * t, py = a2[1] + (b2[1] - a2[1]) * t, w = 0.44;
                const col: [number, number][] = [[px - w, py - w], [px + w, py - w], [px + w, py + w], [px - w, py + w]];
                extrudeWalls(W, col, v.z1 + 0.5, v.z1 + 0.5 + colH, M(v.z1 + 0.5 + colH));
              }
            }
            const roofR = insetRing(base, -0.45) ?? base;
            extrudeWalls(W, roofR, v.z1 + 0.5 + colH, v.z1 + 0.5 + colH + 0.55, M(v.z1 + colH + 1.05));
            capRoof(R, roofR, v.z1 + 0.5 + colH + 0.55, M(v.z1 + colH + 1.05));
          }
        } else if (crown === "pyramid") {
          const cap = insetRing(ring, 0.35);
          const span = Math.sqrt(Math.abs(area) / 2);
          if (cap) pitchCap(cap, v.z1, Math.max(2.4, Math.min(13, ch * 1.5)), Math.max(0.8, span * 0.42), [S_GABLE, rnd, (varr * 3.71 + rnd * 1.93) % 1, v.z1 + ch, fh]);
        } else if (crown === "lantern") {
          // A TIERED TOWER: two shrinking stages and a cupola. What a spire
          // actually is, close up.
          let r0 = ring, z = v.z1;
          for (let k = 0; k < 3; k++) {
            const inset = insetRing(r0, k === 0 ? 1.6 + 1.4 * cs(13) : 0.9);
            if (!inset) break;
            const hS = Math.max(1.6, ch * (0.9 - k * 0.22));
            extrudeWalls(W, inset, z, z + hS, M(z + hS));
            capRoof(R, inset, z + hS, M(z + hS));
            r0 = inset; z += hS;
          }
        } else if (crown === "mech") {
          // A LOUVRED MECHANICAL SCREEN wrapping the plate — what the top of
          // every postwar tower in the world actually is.
          const ph = Math.max(2.2, ch * 0.9);
          extrudeWalls(W, ring, v.z1 - 0.1, v.z1 + ph, M(v.z1 + ph, S_MILL));
          const inner = insetRing(ring, 0.3);
          if (inner) capRoof(R, inner, v.z1 + ph, M(v.z1 + ph, S_PLAIN));
        } else if (crown === "slope") {
          // A CHAMFERED TOP. The last floor pulls in on every side and the
          // building ends on a slope instead of a plane.
          const cap = insetRing(ring, Math.max(0.9, Math.min(4.5, ch * 0.8)));
          if (cap) {
            extrudeWalls(W, ring, v.z1 - 0.1, v.z1 + 0.2, [style, rnd, varr, v.z1, fh]);
            capRoof(R, cap, v.z1 + ch * 0.8, M(v.z1 + ch, style));
            extrudeWalls(W, cap, v.z1 + 0.2, v.z1 + ch * 0.8, M(v.z1 + ch, style));
          }
        } else if (crown === "amenity") {
          // A GLASS PENTHOUSE SET BACK BEHIND A TERRACE.
          const deck = insetRing(ring, 0.8);
          const box = insetRing(ring, 3.2 + 2.4 * cs(14));
          if (deck) capRoof(R, deck, v.z1 + 0.1, M(v.z1, S_GREEN));
          if (box) {
            const hB = Math.max(3.0, ch * 1.1);
            extrudeWalls(W, box, v.z1 + 0.1, v.z1 + hB, [S_GLASS, rnd, varr, v.z1 + hB, fh]);
            capRoof(R, box, v.z1 + hB, M(v.z1 + hB, S_PLAIN));
          }
          extrudeWalls(W, ring, v.z1 - 0.1, v.z1 + 1.05, M(v.z1, S_CORNICE));
        } else {
          // FLAT COPING — a parapet with a cap on it, and the cap is not the
          // same stuff as the wall.
          const ph = 0.75 + 0.9 * cs(15) + (v.z1 > 45 ? 0.5 : 0);
          extrudeWalls(W, ring, v.z1 - 0.1, v.z1 + ph, [style, rnd, varr, v.z1, fh]);
          const cop = insetRing(ring, -0.09);
          if (cop) { extrudeWalls(W, cop, v.z1 + ph, v.z1 + ph + 0.18, M(v.z1 + ph + 0.18)); capRoof(R, cop, v.z1 + ph + 0.18, M(v.z1 + ph + 0.18)); }
          const inner = insetRing(ring, 0.28);
          if (inner) capRoof(R, inner, v.z1 + ph, [style === S_GLASS || style === S_DARK ? S_CORNICE : style, rnd, varr, v.z1 + ph, fh]);
        }
        // some modern mid-rises grow a green roof
        if (style === S_GLASS && crown !== "amenity" && v.z1 >= 15 && v.z1 <= 60 && varr > 0.62) {
          const g = insetRing(ring, 1.6);
          if (g) capRoof(R, g, v.z1 + 0.08, [S_GREEN, rnd, varr, v.z1, fh]);
        }
        // bulkheads: the stair and lift overrun every tall building carries.
        // v.x gates it to the roof: dropped on the base tier of a wedding cake
        // it is a box drawn inside the tower standing on that tier.
        if (v.z1 >= 26 && !v.d && v.x) {
          const pent = insetRing(ring, Math.min(6, Math.max(2.2, Math.sqrt(v.z1) * 0.55)));
          if (pent) {
            const ph2 = v.z1 > 70 ? 5.2 : 3.6;
            const pm = [style === S_GLASS || style === S_DARK ? S_PLAIN : style, rnd, varr, v.z1 + ph2, fh];
            extrudeWalls(W, pent, v.z1 + 0.4, v.z1 + ph2, pm);
            capRoof(R, pent, v.z1 + ph2, [pm[0], rnd, varr, v.z1 + ph2, fh]);
          }
        }
      }

      if (v.b) {
        wallRanges.push({ bbl: v.b, r: { start: wallStart, count: W.pos.length / 3 - wallStart } });
        roofRanges.push({ bbl: v.b, r: { start: roofStart, count: R.pos.length / 3 - roofStart } });
      }
      // paint the decoratives: the color is baked into the base tint so
      // ownership highlights (setTints) never wash it away
      if (v.dk && DECO_TINT[v.dk]) {
        decoTintRanges.push({ attr: 0, r: { start: dWall0, count: W.pos.length / 3 - dWall0 }, c: DECO_TINT[v.dk] });
        decoTintRanges.push({ attr: 1, r: { start: dRoof0, count: R.pos.length / 3 - dRoof0 }, c: DECO_TINT[v.dk] });
      }

      // ---- rooftop furniture ----------------------------------------------
      // Everything up here keys off how tall the BUILDING is, not how high its
      // roof happens to sit. A two-storey house on a hillside terrace is still
      // a two-storey house; giving it a broadcast mast because the ground under
      // it is 90 m up put an antenna forest on every hill.
      const hgt = v.z1 - v.z0;
      if (v.b && hgt >= 12 && !gable && !hip) {
        let cx = 0, cy = 0;
        for (const [x, y] of ring) { cx += x; cy += y; }
        cx /= ring.length; cy /= ring.length;
        const seed = Number(v.b) % 1000;
        const jit = (k: number, amp: number) => (((seed * (k + 3) * 2654435761) % 1000) / 1000 - 0.5) * amp;
        // Deck-mounted plant needs a deck. A mansard's roof is a slope with a
        // small terrace hidden behind it, so a cooling tower dropped at the
        // parapet line ends up buried inside the slate — its fire escape and
        // its chimneys are what it gets.
        if (!mansard) {
          if (hgt >= 20) props.push({ kind: 2, x: cx + jit(1, 6), y: cy + jit(2, 6), z: v.z1, s: 1 + (hgt > 60 ? 0.6 : 0), rot: jit(3, 3) });
          if (v.y < 1968 && hgt >= 22) props.push({ kind: 0, x: cx + jit(4, 8), y: cy + jit(5, 8), z: v.z1, s: 1, rot: 0 });
          const nAc = hgt > 40 ? 3 : 1;
          for (let k = 0; k < nAc; k++) props.push({ kind: 1, x: cx + jit(6 + k, 10), y: cy + jit(9 + k, 10), z: v.z1, s: 0.8 + 0.4 * ((seed >> k) % 2), rot: jit(12 + k, 3) });
          if (hgt >= 105 && v.y >= 1975) props.push({ kind: 3, x: cx, y: cy, z: v.z1, s: 1, rot: 0 });
          // antennas crown the tallest towers
          if (hgt >= 95) props.push({ kind: 4, x: cx + jit(15, 5), y: cy + jit(16, 5), z: v.z1, s: 1 + (hgt - 95) / 60, rot: 0 });

          // ---- THE MACHINE DECK ------------------------------------------
          //
          // Each of these is placed by the rule the real one obeys, so what is
          // standing on a roof tells you what KIND of building it is and
          // roughly when anybody last spent money on it.
          const R = (k: number) => hash01(keyOf(v.b ?? "x") ^ Math.imul(k + 1, 0x9e3779b1), this.citySeed);
          const bear = R(41) * Math.PI * 2;
          const floors = Math.max(1, Math.round(hgt / Math.max(2.6, fh)));

          // Somebody has to be able to get out here. Every flat roof has a way
          // up, and it is the most characteristic silhouette on the deck.
          if (hgt >= 9) {
            props.push({ kind: 13, x: cx + jit(31, 9), y: cy + jit(32, 9), z: v.z1, s: 0.9 + 0.3 * R(3), rot: bear });
          }
          // A lift overrun exists where there is a lift, which is six floors
          // and up before the war and four floors and up after it.
          if (floors >= (v.y >= 1955 ? 4 : 6) && hgt >= 16) {
            props.push({ kind: 14, x: cx + jit(33, 11), y: cy + jit(34, 11), z: v.z1, s: 0.9 + 0.25 * R(5), rot: bear + 0.4 });
          }
          // Chilled water needs somewhere to reject the heat. Post-war, and
          // only on a building big enough to have a central plant.
          if (v.y >= 1948 && hgt >= 34 && R(7) < 0.72) {
            props.push({ kind: 15, x: cx + jit(35, 13), y: cy + jit(36, 13), z: v.z1, s: 0.85 + 0.55 * R(9), rot: bear + 1.1 });
          }
          // The steel pressure tank replaced the timber one after the war —
          // the two do not share a roof.
          if (v.y >= 1962 && hgt >= 26 && R(11) < 0.45) {
            props.push({ kind: 16, x: cx + jit(37, 10), y: cy + jit(38, 10), z: v.z1, s: 0.85 + 0.3 * R(13), rot: 0 });
          }
          // Standby power: hospitals, exchanges, anything with a computer
          // room in it, so tall and late.
          if (v.y >= 1972 && hgt >= 48 && R(15) < 0.5) {
            props.push({ kind: 17, x: cx + jit(39, 12), y: cy + jit(40, 12), z: v.z1, s: 1, rot: bear + 2.3 });
          }
          // Daylight into the top floor: a loft conversion or a studio.
          if (hgt >= 12 && hgt <= 34 && R(17) < 0.30) {
            props.push({ kind: 18, x: cx + jit(41, 8), y: cy + jit(42, 8), z: v.z1, s: 0.8 + 0.5 * R(19), rot: bear + 1.57 });
          }
          // Nobody put panels on a roof before somebody was selling them.
          if (v.y >= 1996 && hgt >= 10 && R(21) < 0.34) {
            props.push({ kind: 19, x: cx + jit(43, 9), y: cy + jit(44, 9), z: v.z1, s: 0.9 + 0.4 * R(23), rot: bear });
          }
          // And a rail round the edge, which is nearly all EDGE and therefore
          // the one roof part that reads at a distance no box does.
          if (hgt >= 14) {
            const rl = Math.min(1.8, Math.max(0.55, Math.sqrt(Math.abs(area)) / 26));
            for (let e = 0; e < ring.length; e++) {
              const p0 = ring[e], p1 = ring[(e + 1) % ring.length];
              const ex = p1[0] - p0[0], ey = p1[1] - p0[1];
              const L = Math.hypot(ex, ey);
              if (L < 9) continue;
              const nx = -ey / L, ny = ex / L;      // inward is whichever way the ring winds
              const sgn = area > 0 ? 1 : -1;
              const n = Math.min(4, Math.floor(L / 7.2));
              for (let i = 0; i < n; i++) {
                const t = (i + 0.5) / n;
                props.push({
                  kind: 20,
                  x: p0[0] + ex * t + nx * sgn * 1.5,
                  y: p0[1] + ey * t + ny * sgn * 1.5,
                  z: v.z1,
                  s: rl,
                  rot: Math.atan2(ey, ex),
                });
              }
            }
          }
        }
        // FIRE ESCAPES. The single most characteristic thing on a brick
        // walk-up street and the game had none. One stack per building, on
        // the longest wall — which is the street wall — projecting off the
        // facade so it catches the low sun and throws a real shadow down the
        // brick. A tenement block without them looks like a rendering of a
        // tenement block.
        if (style === S_BRICK && v.f >= 3 && hgt >= 9) {
          let bi = 0, bl = -1;
          for (let i = 0; i < ring.length; i++) {
            const a2 = ring[i], b2 = ring[(i + 1) % ring.length];
            const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
            if (L > bl) { bl = L; bi = i; }
          }
          if (bl > 9) {
            const a2 = ring[bi], b2 = ring[(bi + 1) % ring.length];
            const dx = b2[0] - a2[0], dy = b2[1] - a2[1];
            const L = Math.hypot(dx, dy) || 1;
            const ox = dy / L, oy = -dx / L;          // outward from a CCW ring
            const levels = Math.max(2, Math.min(5, v.f - 1));
            props.push({
              kind: 7 + levels,                        // 9..12
              x: (a2[0] + b2[0]) / 2 + ox * 0.55,
              y: (a2[1] + b2[1]) / 2 + oy * 0.55,
              z: v.z0,
              s: Math.min(1.25, fh / 3.4),
              rot: Math.atan2(dy, dx),
            });
          }
        }
        // ROOFTOP SIGNAGE. The painted sign on the parapet is what a
        // commercial building did with its roof before anyone thought to put
        // plant up there — and it sits on the LONGEST edge, facing the street,
        // because that is the whole point of it.
        if (!mansard && (v.c === "retail" || v.c === "office") && hgt >= 19 && hgt <= 52 && seed % 7 < 2) {
          let bi = 0, bl = -1;
          for (let i = 0; i < ring.length; i++) {
            const a2 = ring[i], b2 = ring[(i + 1) % ring.length];
            const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
            if (L > bl) { bl = L; bi = i; }
          }
          if (bl > 11) {
            const a2 = ring[bi], b2 = ring[(bi + 1) % ring.length];
            props.push({
              kind: 7,
              x: (a2[0] + b2[0]) / 2, y: (a2[1] + b2[1]) / 2, z: v.z1 + 0.6,
              s: Math.min(0.95, bl / 22),
              rot: Math.atan2(b2[1] - a2[1], b2[0] - a2[0]),
            });
          }
        }
        // skylight monitors on industrial sheds
        if (style === S_MILL && hgt < 15) {
          for (let k = 0; k < 2; k++) props.push({ kind: 6, x: cx + jit(20 + k, 12), y: cy + jit(23 + k, 12), z: v.z1, s: 1, rot: jit(26, 1) });
        }
      }
      // Chimneys on everything with a pitched roof. A stack is the one thing
      // that tells you a roof is a roof over rooms rather than a lid, and a
      // mansard block carries several — it is a building full of fireplaces.
      if (v.b && (gable || hip || mansard)) {
        let cx = 0, cy = 0;
        for (const [x, y] of ring) { cx += x; cy += y; }
        cx /= ring.length; cy /= ring.length;
        const seed = Number(v.b) % 1000;
        const jit = (k: number, amp: number) => (((seed * (k + 3) * 2654435761) % 1000) / 1000 - 0.5) * amp;
        const stacks = mansard ? 3 : gable ? 1 : 2;
        const zc = mansard ? v.z1 + 3.4 : hip ? v.z1 + 1.4 : v.z1 + 0.8;
        for (let k = 0; k < stacks; k++) {
          props.push({ kind: 5, x: cx + jit(1 + k * 2, 7), y: cy + jit(2 + k * 2, 6), z: zc, s: 1, rot: 0 });
        }
      }
      if (v.b) for (let i = propStart; i < props.length; i++) props[i].b = v.b;
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
      g.setAttribute("aEra", new THREE.Float32BufferAttribute(T.era, 1));
      g.setAttribute("aSeg", new THREE.Float32BufferAttribute(T.seg, 2));
      g.setAttribute("aCcv", new THREE.Float32BufferAttribute(T.ccv, 2));
      g.setAttribute("aLit", (() => {
        const a = new THREE.Float32BufferAttribute(new Float32Array(T.pos.length / 3).fill(-1), 1);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
      })());
      const tint = new Float32Array((T.pos.length / 3) * 3).fill(1);
      const tintAttr = new THREE.Float32BufferAttribute(tint, 3);
      tintAttr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aTint", tintAttr);
      return g;
    };

    const uniforms = () => ({
      uOpacity: { value: 1 },
      uCam: this.camUni,
      uSunDir: this.sunDirUni,
      uSunCol: this.sunColUni,
      uSeason: this.seasonUni,
      uShadow: { value: null as THREE.Texture | null },
      uSunVP: { value: new THREE.Matrix4() },
      uShadowOn: { value: 0 },
    });
    this.wallMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(), side: THREE.DoubleSide });
    this.roofMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: ROOF_FRAG, uniforms: uniforms(), side: THREE.DoubleSide });

    const wallGeom = mkGeom(W);
    const roofGeom = mkGeom(R);
    this.scene.add(new THREE.Mesh(wallGeom, this.wallMat));
    this.scene.add(new THREE.Mesh(roofGeom, this.roofMat));
    this.tintAttrs = [wallGeom.getAttribute("aTint") as THREE.BufferAttribute, roofGeom.getAttribute("aTint") as THREE.BufferAttribute];
    this.litAttrs = [wallGeom.getAttribute("aLit") as THREE.BufferAttribute, roofGeom.getAttribute("aLit") as THREE.BufferAttribute];
    this.baseTints = this.tintAttrs.map((a) => {
      const arr = new Float32Array(a.array.length);
      arr.fill(1);
      return arr;
    });
    for (const { attr, r, c } of decoTintRanges) {
      const arr = this.baseTints[attr];
      for (let i = r.start; i < r.start + r.count; i++) {
        arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
      }
    }
    for (let i = 0; i < this.tintAttrs.length; i++) {
      (this.tintAttrs[i].array as Float32Array).set(this.baseTints[i]);
      this.tintAttrs[i].needsUpdate = true;
    }
    this.posAttrs = [wallGeom.getAttribute("position") as THREE.BufferAttribute, roofGeom.getAttribute("position") as THREE.BufferAttribute];
    this.scene.add(this.dynGroup);
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
      { geom: billboardGeom(), color: 0xffffff },
      { geom: new THREE.BufferGeometry(), color: 0x000000 },  // 8: unused slot
      { geom: fireEscapeGeom(2), color: 0x4a4238 },
      { geom: fireEscapeGeom(3), color: 0x4a4238 },
      { geom: fireEscapeGeom(4), color: 0x4a4238 },
      { geom: fireEscapeGeom(5), color: 0x4a4238 },
      { geom: bulkheadGeom(), color: 0x9d9382 },        // 13
      { geom: overrunGeom(), color: 0x93897a },         // 14
      { geom: coolingTowerGeom(), color: 0xa8ada9 },    // 15
      { geom: pressureTankGeom(), color: 0x7f868a },    // 16
      { geom: generatorGeom(), color: 0x8b8f86 },       // 17
      { geom: skylightGeom(), color: 0xbfd0d6 },        // 18
      { geom: pvRowGeom(), color: 0x2b3550 },           // 19
      { geom: guardrailGeom(), color: 0x6f7377 },       // 20
    ];
    // painted signs come in painted-sign colours
    const SIGN_COLORS: [number, number, number][] = [
      [0.72, 0.24, 0.20], [0.20, 0.32, 0.50], [0.92, 0.88, 0.80],
      [0.24, 0.40, 0.32], [0.82, 0.66, 0.28], [0.32, 0.30, 0.34],
    ];
    for (let kind = 0; kind < propDefs.length; kind++) {
      const items = props.filter((p) => p.kind === kind);
      if (!items.length) continue;
      const mesh = new THREE.InstancedMesh(propDefs[kind].geom, this.propMaterial(propDefs[kind].color), items.length);
      const icol = new Float32Array(items.length * 3).fill(1);
      if (kind === 7) {
        for (let i = 0; i < items.length; i++) {
          const c = SIGN_COLORS[(Math.round(items[i].x * 7 + items[i].y * 13) % SIGN_COLORS.length + SIGN_COLORS.length) % SIGN_COLORS.length];
          icol[i * 3] = c[0]; icol[i * 3 + 1] = c[1]; icol[i * 3 + 2] = c[2];
        }
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(icol, 3);
      const m = new THREE.Matrix4();
      items.forEach((p, i) => {
        m.compose(
          new THREE.Vector3(p.x, p.y, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.rot)),
          new THREE.Vector3(p.s, p.s, p.s),
        );
        mesh.setMatrixAt(i, m);
        // so a demolition can find this instance again
        if (p.b) {
          const list = this.propsByBBL.get(p.b);
          if (list) list.push({ mesh, i });
          else this.propsByBBL.set(p.b, [{ mesh, i }]);
        }
      });
      this.scene.add(mesh);
    }
    this.plantStreets();
    this.buildWater();
    this.buildSeawall();
    this.buildLawns();

    this.bakeShadows();
  }

  // Street trees and lamp standards along the curb. Nothing sells the scale of
  // a building like something human-sized standing next to it, and an empty
  // pavement is what made the city read as a model rather than a place.
  private plantStreets() {
    const c = this.ctxPoints;
    if (!this.curbs.length && !c.trees?.length && !c.benches?.length && !c.rails?.length) return;
    // ctx: where this thing stands — 0 street, 1 park, 2 a lot nobody tends.
    // Only the trees read it, and only to choose a species.
    type Item = { x: number; y: number; s: number; rot: number; ctx?: number };
    const trees: Item[] = [], lamps: Item[] = [], cars: Item[] = [], people: Item[] = [];
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (const curb of this.curbs) {
      const ring = curb.map((p) => this.project(p));
      if (ring.length < 3) continue;
      let cx = 0, cy = 0;
      for (const [x, y] of ring) { cx += x; cy += y; }
      cx /= ring.length; cy /= ring.length;
      let carry = rnd() * 14;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 2) continue;
        // step along the frontage, planting into the pavement side
        for (let d = carry; d < len; d += 17 + rnd() * 9) {
          const t = d / len;
          const px = a[0] + dx * t, py = a[1] + dy * t;
          let nx = -dy / len, ny = dx / len;
          if ((px - cx) * nx + (py - cy) * ny < 0) { nx = -nx; ny = -ny; }  // point outward
          const off = 2.1 + rnd() * 0.7;
          const item = { x: px + nx * off, y: py + ny * off, s: 0.92 + rnd() * 0.55, rot: rnd() * 6.28, ctx: 0 };
          if (rnd() < 0.76) trees.push(item);
          else lamps.push({ ...item, s: 0.9 + rnd() * 0.2 });
        }
        // PEOPLE. A city with cars but nobody in it reads as an evacuation.
        // These are two boxes and a dot each, but at street level they are the
        // difference between a model and a place — and they are the only thing
        // in the scene at human scale, which is what everything else gets
        // measured against.
        for (let d = rnd() * 5; d < len - 2; d += 3.1 + rnd() * 6.5) {
          if (rnd() > 0.42) continue;
          const t = d / len;
          const px = a[0] + dx * t, py = a[1] + dy * t;
          let nx = -dy / len, ny = dx / len;
          if ((px - cx) * nx + (py - cy) * ny < 0) { nx = -nx; ny = -ny; }
          const off = 0.9 + rnd() * 1.1;             // on the pavement, not the road
          people.push({ x: px + nx * off, y: py + ny * off, s: 0.92 + rnd() * 0.2, rot: rnd() * 6.28 });
        }
        // CARS AT THE KERB. Nothing gives a street its scale like the row of
        // parked cars along it — a building is abstract until there is
        // something four metres long standing next to it. They sit in the
        // parking lane, nose-to-tail, aligned with the frontage.
        for (let d = rnd() * 6; d < len - 5; d += 5.4 + rnd() * 3.4) {
          if (rnd() > 0.62) continue;              // gaps: hydrants, drives, luck
          const t = d / len;
          const px = a[0] + dx * t, py = a[1] + dy * t;
          let nx = -dy / len, ny = dx / len;
          if ((px - cx) * nx + (py - cy) * ny < 0) { nx = -nx; ny = -ny; }
          cars.push({
            x: px + nx * (4.4 + rnd() * 0.4),
            y: py + ny * (4.4 + rnd() * 0.4),
            s: 0.94 + rnd() * 0.16,
            rot: Math.atan2(dy, dx) + (rnd() - 0.5) * 0.06,
          });
        }
        carry = Math.max(0, carry - len);
        if (carry === 0) carry = rnd() * 6;
      }
    }

    // Cars carry a real per-instance colour rather than a jitter around one
    // hue: a kerb of identical grey boxes reads as packaging, not traffic.
    const CAR_COLORS: [number, number, number][] = [
      [0.88, 0.88, 0.87], [0.72, 0.73, 0.75], [0.22, 0.24, 0.28], [0.17, 0.27, 0.42],
      [0.55, 0.19, 0.17], [0.40, 0.42, 0.38], [0.78, 0.72, 0.58], [0.20, 0.34, 0.29],
      [0.62, 0.62, 0.64], [0.35, 0.20, 0.16],
    ];
    const addCars = (items: Item[]) => {
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(carGeom(), this.propMaterial(0xffffff), items.length);
      const m = new THREE.Matrix4();
      const cols = new Float32Array(items.length * 3);
      items.forEach((p, i) => {
        m.compose(
          new THREE.Vector3(p.x, p.y, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.rot)),
          new THREE.Vector3(p.s, p.s, p.s * (0.94 + rnd() * 0.16)),
        );
        mesh.setMatrixAt(i, m);
        const c = CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length) % CAR_COLORS.length];
        cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
      });
      mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    };

    // Clothes, in the muted range a crowd actually averages to.
    const COAT: [number, number, number][] = [
      [0.30, 0.32, 0.38], [0.62, 0.58, 0.52], [0.20, 0.24, 0.30], [0.52, 0.28, 0.24],
      [0.86, 0.84, 0.80], [0.28, 0.36, 0.32], [0.44, 0.40, 0.46], [0.70, 0.62, 0.44],
    ];
    const addPeople = (items: Item[]) => {
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(personGeom(), this.propMaterial(0xffffff), items.length);
      const m = new THREE.Matrix4();
      const cols = new Float32Array(items.length * 3);
      items.forEach((p, i) => {
        m.compose(
          new THREE.Vector3(p.x, p.y, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.rot)),
          new THREE.Vector3(p.s, p.s, p.s * (0.93 + rnd() * 0.14)),
        );
        mesh.setMatrixAt(i, m);
        const c = COAT[Math.floor(rnd() * COAT.length) % COAT.length];
        cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
      });
      mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    };

    // context points that carry their own bearing, put into world space. The
    // generator works in metres and Mercator scales uniformly, so a bearing in
    // its frame is the same bearing here — degrees to radians and nothing else.
    const oriented = (pts?: Oriented[]): Item[] =>
      (pts ?? []).map((o) => {
        const [x, y] = this.project(o.p);
        return { x, y, s: 1, rot: (o.r * Math.PI) / 180 };
      });

    const addRigid = (geom: THREE.BufferGeometry, color: number, items: Item[]) => {
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(geom, this.propMaterial(color), items.length);
      const m = new THREE.Matrix4();
      const one = new THREE.Vector3(1, 1, 1);
      items.forEach((p, i) => {
        m.compose(
          new THREE.Vector3(p.x, p.y, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.rot)),
          one,
        );
        mesh.setMatrixAt(i, m);
      });
      // PROP_VERT reads instanceColor unconditionally, so every instanced prop
      // has to carry one even when it has nothing to say: a flat 1 leaves the
      // material's own colour alone.
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(items.length * 3).fill(1), 3,
      );
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    };

    const add = (geom: THREE.BufferGeometry, color: number, items: Item[], vary = 0, foliage = 0) => {
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(geom, this.propMaterial(color, true, foliage), items.length);
      const m = new THREE.Matrix4();
      const cols = new Float32Array(items.length * 3);
      items.forEach((p, i) => {
        m.compose(
          new THREE.Vector3(p.x, p.y, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.rot)),
          new THREE.Vector3(p.s, p.s * (0.9 + rnd() * 0.3), p.s * (0.85 + rnd() * 0.4)),
        );
        mesh.setMatrixAt(i, m);
        // no two street trees are the same green
        const k = vary * (rnd() - 0.5);
        cols[i * 3] = 1 + k * 1.5;
        cols[i * 3 + 1] = 1 + k * 0.4;
        cols[i * 3 + 2] = 1 - k * 0.9;
      });
      mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    };
    // the parks and the esplanade get REAL trees, not map dots: same instanced
    // canopies as the street planting, denser and a touch bigger. This is most
    // of what makes a park read as a place from the game camera.
    for (const p of this.ctxPoints.trees ?? []) {
      const [x, y] = this.project(p);
      trees.push({ x, y, s: 1.02 + rnd() * 0.75, rot: rnd() * 6.28, ctx: 1 });
    }
    // the scrub that has taken the abandoned lots, planted a size down from
    // street trees because nobody chose these and nobody prunes them
    for (const t of this.lotTrees) trees.push({ ...t, ctx: 2 });
    for (const c2 of this.lotCars) cars.push(c2);
    // pier piles: short dark timbers standing at the deck edge over the water
    const piles: Item[] = (this.ctxPoints.piles ?? []).map((p) => {
      const [x, y] = this.project(p);
      return { x, y, s: 0.9 + rnd() * 0.3, rot: 0 };
    });
    // THREE SPECIES, not one. Every tree in the city was the same two lumps
    // at a different size, which reads as wallpaper from the air. A spreading
    // shade tree, a narrow columnar one for tight frontages, and a conifer —
    // split deterministically so a street keeps its planting between reloads.
    // Weighted, not thirds. A third of the city in conifers turned a New
    // England common into a Christmas tree farm: streets and parks are mostly
    // spreading shade trees, with columnar ones where the frontage is tight
    // and a few evergreens for winter structure.
    // A STREET IS NOT A PARK IS NOT A VACANT LOT.
    //
    // The three species already vary, and every tree already gets its own
    // green out of `add`'s vary term — that part was never the problem. What
    // WAS the problem is that the split was a hash of position and nothing
    // else, so all three populations drew from one 63/25/12 mix: the same
    // planting on a tight commercial frontage, in the middle of the Common,
    // and on a lot nobody has touched in thirty years.
    //
    // Nobody plants a spreading shade tree on a twenty-foot frontage — it goes
    // columnar or it goes in a tub. A park is mostly canopy with a few
    // evergreens for winter structure. And scrub on an abandoned lot is
    // whatever seeded itself, which in New England is a lot of white pine.
    const MIX: Record<number, [number, number]> = {
      0: [46, 90],   // street: columnar over half of it, a few conifers
      1: [78, 92],   // park: canopy, some columnar, evergreen structure
      2: [40, 62],   // scrub: scrappy, and heavily self-seeded pine
    };
    const sp: Item[][] = [[], [], []];
    for (let i = 0; i < trees.length; i++) {
      const h = (Math.abs(Math.round(trees[i].x * 3 + trees[i].y * 7)) + i * 11) % 100;
      const [a, b] = MIX[trees[i].ctx ?? 1];
      sp[h < a ? 0 : h < b ? 1 : 2].push(trees[i]);
    }
    add(treeTrunkGeom(), 0x6b5744, trees, 0.12, 0);
    add(treeCanopyGeom(), 0x71904f, sp[0], 0.34, 1);
    add(columnarCanopyGeom(), 0x6d8a4c, sp[1], 0.30, 1);
    add(coniferCanopyGeom(), 0x4e6f4a, sp[2], 0.26, 2);
    add(lampGeom(), 0x4e5459, lamps, 0.06);
    add(pileGeom(), 0x5c4a34, piles, 0.08);
    // Manufactured things do not come in random proportions. Benches and
    // railings go in rigid — uniform scale, exact bearing — because a rail
    // whose posts are each a different height is a fence, not an esplanade.
    addRigid(benchGeom(), 0x6d5a45, oriented(this.ctxPoints.benches));
    addRigid(railGeom(), 0x3f464b, oriented(this.ctxPoints.rails));
    addCars(cars);
    addPeople(people);
  }

  /**
   * The sea, as one mesh with the land punched out of it.
   *
   * MapLibre draws its fills and then this layer draws on top, so a water
   * plane laid over everything would bury the city. The land ring becomes a
   * HOLE in the water polygon instead — triangulated once, drawn under
   * everything else at z = 0.01. Added before the shadow bake would matter,
   * and excluded from casting, because a flat sheet casts nothing.
   */
  /**
   * THE SEAWALL.
   *
   * The city and the sea are the two biggest surfaces on screen and until now
   * the join between them was a paper cut — the land plate simply stopped and
   * the water started. A harbour town's edge is BUILT: coursed granite with a
   * coping, standing a metre or so proud of the promenade behind it.
   *
   * One extruded band around the land ring — a couple of hundred segments, so
   * it is free — and because it goes in before the sun bake it lays a thin
   * hard shadow onto the water, which is most of what sells it.
   */
  private buildSeawall() {
    const land = this.ctxPoints.land;
    if (!land || land.length < 4) return;
    const ring = land.map((p) => this.project(p));
    // which way is out to sea? The land ring's winding decides it, and getting
    // it backwards leaves the sunlit face of the wall shaded and the coping
    // hanging over the water instead of the walk.
    let signed = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      signed += p[0] * q[1] - q[0] * p[1];
    }
    const out = signed > 0 ? 1 : -1;
    const pos: number[] = [], norm: number[] = [];
    // LOW. A first attempt stood 1 m proud and dropped 1.6 m below the water,
    // and because the sun sits in the south-east most of the island's seaward
    // face is in shade — the whole coast ringed itself in a black band that
    // read as a city wall. What was wanted is a stone EDGE: a course you can
    // see, catching light where the shore turns toward the sun.
    const TOP = 0.62, BOT = -0.3;
    const push = (a: number[], b: number[], c: number[], n: number[]) => {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) norm.push(n[0], n[1], n[2]);
    };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy);
      if (L < 0.4) continue;
      const n = [(dy / L) * out, (-dx / L) * out, 0];
      push([a[0], a[1], BOT], [b[0], b[1], BOT], [b[0], b[1], TOP], n);
      push([a[0], a[1], BOT], [b[0], b[1], TOP], [a[0], a[1], TOP], n);
      // the coping: a narrow flat course along the top, laid landward over the
      // walk, so the wall reads as stone somebody set rather than an outline
      const ox = -n[0] * 0.42, oy = -n[1] * 0.42;
      const up = [0, 0, 1];
      push([a[0], a[1], TOP], [b[0], b[1], TOP], [b[0] + ox, b[1] + oy, TOP], up);
      push([a[0], a[1], TOP], [b[0] + ox, b[1] + oy, TOP], [a[0] + ox, a[1] + oy, TOP], up);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
    const mesh = new THREE.Mesh(g, this.propMaterial(0xb0aa99, false));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /**
   * THE LAWNS.
   *
   * A park was a flat mint plate — the single largest uniform surface on land,
   * and the one place the eye rests longest. Real turf under a low sun is
   * never one value: it is mown in bands, worn to dirt on the desire lines,
   * greener where it is shaded and blonder where it bakes.
   *
   * The green-roof shader already knows how to make growth read as growth, so
   * the lawn borrows it — laid a few centimetres over the MapLibre fill so
   * the flat colour underneath only ever shows through the gaps.
   */
  private buildLawns() {
    const parks = this.ctxPoints.parks;
    if (!parks?.length) return;
    const T = { pos: [] as number[], norm: [] as number[], u: [] as number[], style: [] as number[] };
    const emit = (q: [number, number][], z: number, style: number) => {
      for (const v of q) { T.pos.push(v[0], v[1], z); T.norm.push(0, 0, 1); T.u.push(6); T.style.push(style); }
    };
    // subdivide: the shader varies with world position, so a park drawn as
    // four huge triangles still shades smoothly, but the mown bands want
    // enough vertices that nothing interpolates across a whole lawn
    const split = (q: [number, number][], z: number, style: number, depth: number) => {
      const a = Math.abs((q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1])) / 2;
      if (a < 400 || depth > 5) { emit(q, z, style); return; }
      const m = (u: [number, number], v: [number, number]): [number, number] => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
      const m01 = m(q[0], q[1]), m12 = m(q[1], q[2]), m20 = m(q[2], q[0]);
      split([q[0], m01, m20], z, style, depth + 1); split([m01, q[1], m12], z, style, depth + 1);
      split([m20, m12, q[2]], z, style, depth + 1); split([m01, m12, m20], z, style, depth + 1);
    };
    const fillRing = (ll: [number, number][], z: number, style: number, sub: boolean) => {
      const ring = ll.map((q) => this.project(q));
      if (ring.length < 3) return;
      const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { return; }
      for (const t of tris) {
        const q = t.map((i) => ring[i]) as [number, number][];
        if (sub) split(q, z, style, 0); else emit(q, z, style);
      }
    };

    for (const p of parks) fillRing(p, 0.07, S_LAWN, true);

    // The lawn is a real surface now, so it BURIES whatever MapLibre was
    // drawing on the ground beneath it — which was the pond and every path
    // through the park. They come up with it. Laid in metres rather than
    // screen pixels, they also hold their width properly at any pitch, which
    // the line layers never did.
    for (const p of this.ctxPoints.ponds ?? []) fillRing(p, 0.09, S_POND, false);
    for (const line of this.ctxPoints.paths ?? []) {
      const pts = line.map((q) => this.project(q));
      const HW = 1.35;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L < 0.2) continue;
        // run each segment a half-width long at both ends so the corners of a
        // dog-leg close instead of showing a wedge of grass
        const ex = (dx / L) * HW, ey = (dy / L) * HW;
        const nx = (-dy / L) * HW, ny = (dx / L) * HW;
        const a0: [number, number] = [a[0] - ex + nx, a[1] - ey + ny];
        const a1: [number, number] = [a[0] - ex - nx, a[1] - ey - ny];
        const b0: [number, number] = [b[0] + ex + nx, b[1] + ey + ny];
        const b1: [number, number] = [b[0] + ex - nx, b[1] + ey - ny];
        emit([a0, a1, b1], 0.11, S_PATH);
        emit([a0, b1, b0], 0.11, S_PATH);
      }
    }

    if (!T.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(T.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(T.norm, 3));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(T.u, 1));
    g.setAttribute("aStyle", new THREE.Float32BufferAttribute(T.style, 1));
    const n = T.pos.length / 3;
    const fill = (v: number, k: number) => new THREE.Float32BufferAttribute(new Float32Array(n * k).fill(v), k);
    g.setAttribute("aRand", fill(0.5, 1));
    g.setAttribute("aVar", fill(0.5, 1));
    g.setAttribute("aTop", fill(1, 1));
    g.setAttribute("aFh", fill(3.5, 1));
    g.setAttribute("aEra", fill(0.55, 1));
    g.setAttribute("aTint", fill(1, 3));
    g.setAttribute("aSeg", fill(0, 2));
    g.setAttribute("aCcv", fill(0, 2));
    const mesh = new THREE.Mesh(g, this.roofMat!);
    mesh.frustumCulled = false;
    mesh.userData.noShadow = true;
    this.scene.add(mesh);
  }

  private buildWater() {
    const land = this.ctxPoints.land;
    if (!land || land.length < 4) return;
    const ring = land.map((p) => this.project(p));
    // wind the hole opposite to the outer boundary or the triangulator fills it
    let a2 = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a2 += p[0] * q[1] - q[0] * p[1];
    }
    const hole = (a2 > 0 ? ring.slice().reverse() : ring).map(([x, y]) => new THREE.Vector2(x, y));
    const R = 6000;
    const outer = [
      new THREE.Vector2(-R, -R), new THREE.Vector2(R, -R),
      new THREE.Vector2(R, R), new THREE.Vector2(-R, R),
    ];
    let tris: number[][] = [];
    try { tris = THREE.ShapeUtils.triangulateShape(outer, [hole]); } catch { return; }
    if (!tris.length) return;
    const pts = [...outer, ...hole];
    // distance from each vertex to the shoreline — the shallows gradient
    const depthOf = (v: THREE.Vector2) => {
      let best = Infinity;
      for (let i = 0; i < hole.length; i++) {
        const a = hole[i], b = hole[(i + 1) % hole.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((v.x - a.x) * dx + (v.y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(v.x - (a.x + t * dx), v.y - (a.y + t * dy)));
      }
      return best;
    };
    const depths = pts.map(depthOf);
    const pos: number[] = [];
    const dep: number[] = [];
    for (const t of tris) for (const i of t) { pos.push(pts[i].x, pts[i].y, 0.01); dep.push(depths[i]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aDepth", new THREE.Float32BufferAttribute(dep, 1));
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: { uTime: this.timeUni, uCam: this.camUni, uSunDir: this.sunDirUni, uSunCol: this.sunColUni },
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, this.waterMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    // a flat sheet has no business in the shadow map
    mesh.userData.noShadow = true;
    this.scene.add(mesh);
    this.water = mesh;
  }

  // Props share the buildings' light rig so a water tower and the roof it
  // stands on are lit by the same sun.
  private propMaterial(color: number, instanced = true, foliage = 0): THREE.ShaderMaterial {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      vertexShader: instanced ? PROP_VERT : PROP_VERT_PLAIN,
      fragmentShader: PROP_FRAG,
      uniforms: {
        uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
        uOpacity: { value: 1 },
        uCam: this.camUni,
        uSunDir: this.sunDirUni,
        uSunCol: this.sunColUni,
        uSeason: this.seasonUni,
        uFoliage: { value: foliage },
        uShadow: { value: this.shadowTex },
        uSunVP: { value: this.sunVP },
        uShadowOn: { value: this.shadowTex ? 1 : 0 },
      },
      side: THREE.DoubleSide,
    });
  }

  // One-time sun depth pass — the city is static, so shadows are free at
  // runtime: a single texture sample per fragment.
  private bakeShadows() {
    this.sunDirty = false;
    try {
      // must be the SAME direction the shader lights with, or the shadows
      // detach from the shading that produced them
      const sunDir = this.sunDirUni.value.clone().normalize();
      const look = new THREE.Vector3(0, 150, 0);
      // a low sun throws long shadows: the frustum has to be wide enough to
      // hold them, or buildings at the edge cast into nothing
      const cam = new THREE.OrthographicCamera(-2200, 2200, 1900, -1900, 1, 6000);
      cam.position.copy(look.clone().add(sunDir.clone().multiplyScalar(3000)));
      cam.up.set(0, 0, 1);
      cam.lookAt(look);
      cam.updateMatrixWorld(true);

      if (!this.shadowTarget) {
        this.shadowTarget = new THREE.WebGLRenderTarget(3072, 3072, {
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
        });
      }
      if (!this.depthMat) {
        this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      }
      const target = this.shadowTarget;
      if (this.water) this.water.visible = false;   // a flat sea casts nothing
      if (this.groundCatcher) this.groundCatcher.visible = false;
      const prevClear = new THREE.Color();
      this.renderer.getClearColor(prevClear);
      const prevAlpha = this.renderer.getClearAlpha();
      this.scene.overrideMaterial = this.depthMat;
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0xffffff, 1);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(prevClear, prevAlpha);
      this.scene.overrideMaterial = null;
      if (this.water) this.water.visible = true;
      if (this.groundCatcher) this.groundCatcher.visible = true;

      this.sunVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.shadowTex = target.texture;
      const sunVP = this.sunVP;
      // anything already instanced (roof furniture, trees) picks up the map
      this.scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (mat && mat.uniforms && mat.uniforms.uShadow && !mat.uniforms.uShadow.value) {
          mat.uniforms.uShadow.value = target.texture;
          mat.uniforms.uSunVP.value = sunVP;
          mat.uniforms.uShadowOn.value = 1;
        }
      });
      for (const mat of [this.wallMat, this.roofMat]) {
        mat.uniforms.uShadow.value = target.texture;
        mat.uniforms.uSunVP.value = sunVP;
        mat.uniforms.uShadowOn.value = 1;
      }
      // ground shadow catcher — added AFTER the depth pass so it never self-shadows
      if (!this.groundCatcher) {
        const catcherMat = new THREE.ShaderMaterial({
          vertexShader: CATCHER_VERT,
          fragmentShader: CATCHER_FRAG,
          uniforms: {
            uShadow: { value: target.texture }, uSunVP: { value: sunVP },
            uShadowOn: { value: 1 }, uSeason: this.seasonUni,
          },
          transparent: true,
          depthWrite: false,
        });
        this.groundCatcher = new THREE.Mesh(new THREE.PlaneGeometry(3800, 3200).translate(0, 150, 0.07), catcherMat);
        this.scene.add(this.groundCatcher);
      }
    } catch {
      // shadows are enhancement, never a blocker — flat lighting still ships
    }
  }

  // Player construction and deliveries: a small dynamic mesh set rebuilt on
  // change (a handful of buildings — cheap), sharing the facade materials.
  setPlayerBuildings(items: { bbl: string; cls: string; heightM: number; floors: number; construction: boolean }[]) {
    this.dynGroup.clear();
    for (const item of items) {
      // FLATTEN FIRST, ALWAYS — and BEFORE the ring lookup, which is the whole
      // bug. Whatever the generator put on this lot comes off the moment the
      // game says something else is there, including when what is there is
      // nothing. This line used to sit below a `continue` that fired for every
      // building the player had BOUGHT rather than built, so demolishing a
      // purchased building flattened precisely nothing.
      if (!this.flattened.has(item.bbl)) this.flattenLot(item.bbl);
      const ring = this.lotRings.get(item.bbl) ?? this.ringByBBL.get(item.bbl);
      if (!ring) continue;
      // A DEMOLISHED LOT IS A LOT. `Math.max(3, heightM)` below meant a cleared
      // site drew a three-metre glass box where the building had been, so
      // knocking something down appeared to do nothing at all. Nought height
      // means nought: the original mesh is already flattened by the line above,
      // and now nothing replaces it.
      if (!(item.heightM > 0) || item.cls === "land") continue;
      let cx = 0, cy = 0;
      for (const [x, y] of ring) { cx += x; cy += y; }
      cx /= ring.length; cy /= ring.length;
      const fp = ring.map(([x, y]) => [cx + (x - cx) * 0.78, cy + (y - cy) * 0.78] as [number, number]);
      const h = Math.max(3, item.heightM);
      const style = item.construction ? 5          // bare structure while it rises
        : item.cls === "industrial" ? 3             // sash-window shed
        : item.cls === "multifamily" ? 2            // modern brick
        : item.cls === "retail" ? 7                 // ribbon storefront
        : 0;                                        // office / mixed: curtain wall
      const fh2 = item.floors > 0 ? Math.max(2.6, item.heightM / item.floors) : 3.5;
      const meta = [style, 0.5, 0.4, h, fh2];
      const mkBuf = () => ({
        pos: [] as number[], norm: [] as number[], u: [] as number[], style: [] as number[],
        rand: [] as number[], varr: [] as number[], top: [] as number[], fh: [] as number[],
        seg: [] as number[], ccv: [] as number[], era: [] as number[],
      });
      // A building the player just finished is brand new, by definition, and
      // the campaign runs from 2000 — so it sits at the young end of the
      // 1870-2030 scale rather than anywhere in the middle of it.
      const nowEra = 0.82;
      const T = mkBuf();
      const R2 = mkBuf();
      let perim = 0;
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i], b = fp[(i + 1) % fp.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const n = [dy / len, -dx / len, 0];
        const u0 = perim, u1 = perim + len;
        perim += len;
        const quad = [
          [a[0], a[1], 0, u0], [b[0], b[1], 0, u1], [b[0], b[1], h, u1],
          [a[0], a[1], 0, u0], [b[0], b[1], h, u1], [a[0], a[1], h, u0],
        ];
        for (const [x, y, z, u] of quad) {
          T.pos.push(x, y, z); T.norm.push(n[0], n[1], n[2]); T.u.push(u);
          T.style.push(meta[0]); T.rand.push(meta[1]); T.varr.push(meta[2]); T.top.push(meta[3]); T.fh.push(meta[4]);
          T.era.push(nowEra);
          T.seg.push(u0, u1); T.ccv.push(1, 1);
        }
      }
      let hb = 2166136261;
      for (let i = 0; i < item.bbl.length; i++) { hb ^= item.bbl.charCodeAt(i); hb = Math.imul(hb, 16777619); }
      hb = hb >>> 0;
      const deck2 = item.construction ? 0 : [7, 7, 6, 6, 8, 5][hb % 6];
      const wear2 = ((hb >>> 8) % 1024) / 1024;
      let bi2 = 0, bl2 = -1;
      for (let i = 0; i < fp.length; i++) {
        const q0 = fp[i], q1 = fp[(i + 1) % fp.length];
        const L2 = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
        if (L2 > bl2) { bl2 = L2; bi2 = i; }
      }
      const bx2 = bl2 > 0 ? (fp[(bi2 + 1) % fp.length][0] - fp[bi2][0]) / bl2 : 1;
      const by2 = bl2 > 0 ? (fp[(bi2 + 1) % fp.length][1] - fp[bi2][1]) / bl2 : 0;
      const pts = fp.map(([x, y]) => new THREE.Vector2(x, y));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { tris = []; }
      for (const t of tris) {
        for (const idx of t) {
          R2.pos.push(fp[idx][0], fp[idx][1], h); R2.norm.push(0, 0, 1); R2.u.push(4);
          R2.style.push(item.construction ? 5 : meta[0]); R2.rand.push(0.5); R2.varr.push(0.4); R2.top.push(h); R2.fh.push(fh2);
          R2.era.push(nowEra);
          R2.seg.push(deck2, wear2); R2.ccv.push(bx2, by2);
        }
      }
      const mk = (D: typeof T) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(D.pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(D.norm, 3));
        g.setAttribute("aU", new THREE.Float32BufferAttribute(D.u, 1));
        g.setAttribute("aStyle", new THREE.Float32BufferAttribute(D.style, 1));
        g.setAttribute("aRand", new THREE.Float32BufferAttribute(D.rand, 1));
        g.setAttribute("aVar", new THREE.Float32BufferAttribute(D.varr, 1));
        g.setAttribute("aTop", new THREE.Float32BufferAttribute(D.top, 1));
        g.setAttribute("aFh", new THREE.Float32BufferAttribute(D.fh, 1));
        g.setAttribute("aEra", new THREE.Float32BufferAttribute(D.era, 1));
        g.setAttribute("aSeg", new THREE.Float32BufferAttribute(D.seg, 2));
        g.setAttribute("aCcv", new THREE.Float32BufferAttribute(D.ccv, 2));
        g.setAttribute("aTint", new THREE.Float32BufferAttribute(new Float32Array(D.pos.length).fill(1), 3));
        g.setAttribute("aLit", new THREE.Float32BufferAttribute(new Float32Array(D.pos.length / 3).fill(-1), 1));
        return g;
      };
      this.dynGroup.add(new THREE.Mesh(mk(T), this.wallMat));
      this.dynGroup.add(new THREE.Mesh(mk(R2), this.roofMat));
      if (item.construction) {
        // A TOWER CRANE, AND NOT THE SAME ONE TWICE.
        //
        // There was a crane here already — a smooth cylinder and a 26 m box —
        // but it stood at cx+6, cy+6 with its jib pointing down +x on EVERY
        // site in the city, forever. Identical and identically oriented, which
        // is the same wallpaper problem the facades had: the eye reads the
        // repetition long before it reads any single object.
        //
        // A real one slews. It has a counter-jib with a concrete block on it
        // to balance the load, a trolley somewhere out along the jib, and a
        // hook on a line hanging from the trolley — and the hook is the part
        // that tells you the thing is working rather than parked.
        const orange = this.propMaterial(0xc2803a, false);
        const grey = this.propMaterial(0x8d9096, false);
        const k = keyOf(item.bbl);
        const bear = hash01(k, this.citySeed ^ 0x517) * Math.PI * 2;
        const ca = Math.cos(bear), sa = Math.sin(bear);
        // stand it off a corner of the site rather than in the middle of it
        const off = 4.5 + hash01(k ^ 0x31, this.citySeed) * 3.5;
        const mx = cx + ca * off, my = cy + sa * off;
        const mastH = h + 12 + hash01(k ^ 0x77, this.citySeed) * 10;
        const jib = 22 + hash01(k ^ 0x99, this.citySeed) * 16;
        const back = jib * 0.34;
        // the trolley runs out along the jib, and the hook hangs off it
        const tro = 0.35 + hash01(k ^ 0xab, this.citySeed) * 0.5;
        const tx = mx + ca * jib * tro, ty = my + sa * jib * tro;
        const hook = mastH - 4 - hash01(k ^ 0xcd, this.citySeed) * (mastH - h * 0.4 - 6);
        const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) =>
          g.rotateZ(bear).translate(x, y, z);
        this.dynGroup.add(
          // mast, on a wider foot so it does not look balanced on a pin
          new THREE.Mesh(at(new THREE.CylinderGeometry(0.42, 0.55, mastH, 6).rotateX(Math.PI / 2), mx, my, mastH / 2), orange),
          new THREE.Mesh(at(new THREE.BoxGeometry(3.2, 3.2, 1.0), mx, my, 0.5), grey),
          // jib forward, counter-jib back, and the counterweight that pays for it
          new THREE.Mesh(at(new THREE.BoxGeometry(jib, 1.1, 1.3), mx + ca * jib / 2, my + sa * jib / 2, mastH - 1.4), orange),
          new THREE.Mesh(at(new THREE.BoxGeometry(back, 1.3, 1.5), mx - ca * back / 2, my - sa * back / 2, mastH - 1.4), orange),
          new THREE.Mesh(at(new THREE.BoxGeometry(3.0, 2.2, 2.0), mx - ca * back, my - sa * back, mastH - 1.6), grey),
          // operator's cab, at the slewing ring
          new THREE.Mesh(at(new THREE.BoxGeometry(1.8, 1.8, 1.9), mx + ca * 1.6, my + sa * 1.6, mastH - 3.4), grey),
          // the hoist line and the hook block — the part that says it is working
          new THREE.Mesh(at(new THREE.CylinderGeometry(0.09, 0.09, mastH - 1.4 - hook, 4).rotateX(Math.PI / 2), tx, ty, (mastH - 1.4 + hook) / 2), grey),
          new THREE.Mesh(at(new THREE.BoxGeometry(1.0, 0.8, 1.0), tx, ty, hook), grey),
        );
        // SITE HOARDING. A job with no fence around it is a building that grew.
        for (let i = 0; i < ring.length; i++) {
          const a2 = ring[i], b2 = ring[(i + 1) % ring.length];
          const dx = b2[0] - a2[0], dy = b2[1] - a2[1];
          const L = Math.hypot(dx, dy);
          if (L < 3) continue;
          this.dynGroup.add(new THREE.Mesh(
            new THREE.BoxGeometry(L, 0.22, 2.2)
              .rotateZ(Math.atan2(dy, dx))
              .translate((a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2, 1.1),
            orange));
        }
      }
    }
    this.sunDirty = true;
    this.map.triggerRepaint();
  }

  /**
   * TAKE THE WHOLE BUILDING DOWN.
   *
   * This flattened attribute 0 only — the walls — and left the roof cap
   * floating at forty metres with its water tower still on it. A demolition
   * that leaves the roof in the sky is not a demolition. Walls, roof and every
   * piece of rooftop furniture go together, which is what a wrecking crew does.
   */
  private flattenLot(bbl: string) {
    this.flattened.add(bbl);
    const ranges = this.rangesByBBL.get(bbl);
    if (ranges) {
      for (const { attr, r } of ranges) {
        const pa = this.posAttrs[attr];
        if (!pa) continue;
        const arr = pa.array as Float32Array;
        for (let i = r.start; i < r.start + r.count; i++) arr[i * 3 + 2] = Math.min(arr[i * 3 + 2], 0.02);
        pa.needsUpdate = true;
      }
    }
    this.hideProps(bbl);
    this.map.triggerRepaint();
  }

  /** Scale a building's rooftop and facade props to nothing. */
  private hideProps(bbl: string) {
    const list = this.propsByBBL.get(bbl);
    if (!list) return;
    const m = new THREE.Matrix4();
    for (const { mesh, i } of list) {
      mesh.getMatrixAt(i, m);
      m.scale(new THREE.Vector3(0, 0, 0));
      mesh.setMatrixAt(i, m);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setTints(tints: Map<string, [number, number, number]>) {
    for (let i = 0; i < this.tintAttrs.length; i++) {
      (this.tintAttrs[i].array as Float32Array).set(this.baseTints[i]);
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

  /**
   * WHICH FLOORS ARE LET. -1 means "not yours to know" and switches the whole
   * treatment off for that building; 0..1 is the leased share. Uses the same
   * per-BBL vertex ranges the ownership tints already walk, so it costs one
   * pass over the buildings you actually have a number for.
   */
  setOccupancy(occ: Map<string, number>) {
    if (!this.litAttrs.length) return;
    for (const a of this.litAttrs) (a.array as Float32Array).fill(-1);
    for (const [bbl, v] of occ) {
      const ranges = this.rangesByBBL.get(bbl);
      if (!ranges) continue;
      const f = Math.max(0, Math.min(1, v));
      for (const { attr, r } of ranges) {
        const arr = this.litAttrs[attr].array as Float32Array;
        arr.fill(f, r.start, r.start + r.count);
      }
    }
    for (const a of this.litAttrs) a.needsUpdate = true;
    this.map.triggerRepaint();
  }

  setMonth(m: number) {
    if (!Number.isFinite(m) || m === this.simMonth) return;
    this.simMonth = m;
    const mo = ((Math.floor(m) % 12) + 12) % 12;
    const w2 = Math.cos((2 * Math.PI * (mo - 6)) / 12);
    const w = 0.5 + 0.5 * w2;
    const el = ((SUN_EL_MID + SUN_EL_AMP * w2) * Math.PI) / 180;
    const az = ((SUN_AZ_MID + SUN_AZ_AMP * w2) * Math.PI) / 180;
    this.sunDirUni.value.set(
      Math.sin(az) * Math.cos(el) * SUN_LEN,
      Math.cos(az) * Math.cos(el) * SUN_LEN,
      Math.sin(el) * SUN_LEN,
    );
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const sc = (i: 0 | 1 | 2) =>
      lerp(SUN_COL_SUMMER[i], lerp(SUN_COL_WINTER[i], SUN_COL_SUMMER[i], w), SUN_WARMTH);
    this.sunColUni.value.set(sc(0), sc(1), sc(2));
    const [snow, turn, bare, vigour] = SEASON_TABLE[mo];
    this.seasonUni.value.set(snow, turn, bare, vigour);
    this.sunDirty = true;
    if (this.map) this.map.triggerRepaint();
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
    if (this.sunDirty) this.bakeShadows();
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
      this.camUni.value.set(
        cx0 - Math.sin(bearing) * back,
        cy0 - Math.cos(bearing) * back,
        distM * Math.cos(pitch),
      );
    }
    // THE ONLY ANIMATED THING IN THE GAME, and it pays its way: ~30fps, and
    // only while the layer is actually visible. MapLibre repaints on demand,
    // so without this call the city would be a still photograph — and with it
    // uncapped, it would burn a core to redraw water nobody is looking at.
    if (this.waterMat) {
      const now = performance.now();
      this.timeUni.value = now / 1000;
      if (now - this.lastFrame > 33) {
        this.lastFrame = now;
        this.map.triggerRepaint();
      }
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

// A car in eleven boxes' worth of triangles: bonnet, cabin, boot. Length runs
// along +x so it can be dropped straight onto a kerb bearing.
// A painted parapet sign: the panel, and the two legs holding it up.
/**
 * A fire escape: two rails, a platform per floor, and a stair slanting between
 * them. Built projecting along -Y so it can be dropped on a wall with the
 * edge's own bearing and nothing else.
 */
function fireEscapeGeom(levels: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const H = 3.4;
  const top = H * levels + 1.2;
  parts.push(new THREE.BoxGeometry(0.11, 0.11, top).translate(-1.35, -1.5, top / 2 + H * 0.55));
  parts.push(new THREE.BoxGeometry(0.11, 0.11, top).translate(1.35, -1.5, top / 2 + H * 0.55));
  for (let i = 0; i < levels; i++) {
    const z = H * (i + 1.55);
    parts.push(new THREE.BoxGeometry(2.9, 1.5, 0.09).translate(0, -0.9, z));        // platform
    parts.push(new THREE.BoxGeometry(2.9, 0.07, 0.07).translate(0, -1.62, z + 0.95)); // handrail
    if (i < levels - 1) {
      // the stair, leaning back against the wall on alternate sides
      const side = i % 2 === 0 ? 0.85 : -0.85;
      // ROTATE, THEN TRANSLATE. BufferGeometry.rotateX turns the geometry about
      // the ORIGIN, so tilting an already-translated stair swung it out on a
      // radius equal to its height — every brick walk-up in the city had a
      // black spar the length of a ship's mast lancing off the fourth floor.
      const stair = new THREE.BoxGeometry(0.95, 0.1, H * 1.22)
        .rotateX(0.52)
        .translate(side, -1.1, z + H / 2);
      parts.push(stair);
    }
  }
  return mergeGeoms(parts);
}

function billboardGeom(): THREE.BufferGeometry {
  const panel = new THREE.BoxGeometry(9, 0.3, 2.4).translate(0, 0, 2.6);
  const legA = new THREE.BoxGeometry(0.24, 0.24, 1.5).translate(-2.9, 0, 0.75);
  const legB = new THREE.BoxGeometry(0.24, 0.24, 1.5).translate(2.9, 0, 0.75);
  return mergeGeoms([panel, legA, legB]);
}

function carGeom(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(4.35, 1.78, 0.82).translate(0, 0, 0.62);
  const cabin = new THREE.BoxGeometry(2.15, 1.62, 0.62).translate(-0.15, 0, 1.32);
  const bonnet = new THREE.BoxGeometry(1.15, 1.66, 0.22).translate(1.5, 0, 1.05);
  return mergeGeoms([body, cabin, bonnet]);
}

function pileGeom(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.22, 0.26, 1.7, 5).rotateX(Math.PI / 2).translate(0, 0, 0.85);
}

// A park bench, lying along +X so the baked bearing turns it to face its walk.
// Slat seat, low back, two cast ends — 1.85 m, which is the length a bench has
// been since before anybody was measuring them.
function benchGeom(): THREE.BufferGeometry {
  const seat = new THREE.BoxGeometry(1.85, 0.50, 0.07).translate(0, 0.02, 0.45);
  const back = new THREE.BoxGeometry(1.85, 0.06, 0.32).translate(0, -0.21, 0.67);
  const rail = new THREE.BoxGeometry(1.85, 0.05, 0.05).translate(0, -0.19, 0.86);
  const endA = new THREE.BoxGeometry(0.08, 0.46, 0.45).translate(-0.80, 0, 0.225);
  const endB = new THREE.BoxGeometry(0.08, 0.46, 0.45).translate(0.80, 0, 0.225);
  return mergeGeoms([seat, back, rail, endA, endB]);
}

// One bay of waterfront railing: a post, and the run of top and middle rail
// that reaches forward to the next one. Posts are dropped every 3.2 m and the
// rail is 3.3 m, so the bays overlap slightly and the line never breaks.
function railGeom(): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(0.10, 0.10, 1.02).translate(0, 0, 0.51);
  const cap = new THREE.BoxGeometry(0.16, 0.16, 0.08).translate(0, 0, 1.05);
  const top = new THREE.BoxGeometry(3.30, 0.08, 0.08).translate(1.6, 0, 0.99);
  const mid = new THREE.BoxGeometry(3.30, 0.05, 0.05).translate(1.6, 0, 0.62);
  return mergeGeoms([post, cap, top, mid]);
}

function treeTrunkGeom(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.16, 0.26, 3.1, 5).rotateX(Math.PI / 2).translate(0, 0, 1.55);
}

// three overlapping lumps read as a canopy from any angle and cost 60 tris
function treeCanopyGeom(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(1.85, 0).translate(0, 0, 4.3);
  const b = new THREE.IcosahedronGeometry(1.25, 0).translate(0.85, 0.3, 3.5);
  return mergeGeoms([a, b]);
}

// the narrow street tree that fits where a spreading one would not
function columnarCanopyGeom(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(1.1, 0).scale(1, 1, 2.1).translate(0, 0, 5.0);
  const b = new THREE.IcosahedronGeometry(0.85, 0).scale(1, 1, 1.5).translate(0.2, -0.15, 3.4);
  return mergeGeoms([a, b]);
}

function coniferCanopyGeom(): THREE.BufferGeometry {
  const a = new THREE.ConeGeometry(1.55, 4.2, 6).rotateX(Math.PI / 2).translate(0, 0, 4.6);
  const b = new THREE.ConeGeometry(1.05, 2.4, 6).rotateX(Math.PI / 2).translate(0, 0, 6.6);
  return mergeGeoms([a, b]);
}

// A person: legs, coat, head. Twenty-two triangles, and the only thing in the
// city at a scale everybody already knows.
function personGeom(): THREE.BufferGeometry {
  const legs = new THREE.BoxGeometry(0.34, 0.24, 0.82).translate(0, 0, 0.41);
  const coat = new THREE.BoxGeometry(0.46, 0.30, 0.62).translate(0, 0, 1.13);
  const head = new THREE.BoxGeometry(0.22, 0.22, 0.24).translate(0, 0, 1.56);
  return mergeGeoms([legs, coat, head]);
}

function lampGeom(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.09, 0.13, 4.6, 5).rotateX(Math.PI / 2).translate(0, 0, 2.3);
  const arm = new THREE.BoxGeometry(1.15, 0.12, 0.12).translate(0.5, 0, 4.55);
  const head = new THREE.BoxGeometry(0.52, 0.3, 0.26).translate(1.0, 0, 4.42);
  return mergeGeoms([post, arm, head]);
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

// ---------------------------------------------------------------- roof parts
//
// SEVEN THINGS EVER REACHED A ROOF, and roofs are 9.5% of the frame — a bigger
// surface than the walls. A real roof is a machine deck: the thing that gets
// you onto it, the thing that lifts you to it, the plant that keeps the
// building alive, and a rail round the edge so nobody falls off. None of that
// was there, so every roof in the city was a bare plane with a tank and two
// boxes on it.
//
// Each one is placed by the rule the real one obeys — a lift overrun only
// exists where there is a lift, a cooling tower only where there is a chiller,
// PV only after somebody was selling it — so the parts on a roof tell you what
// KIND of building you are looking at and roughly when it was last touched.

/** The stair bulkhead: the door out onto the roof, with a hood over it. */
function bulkheadGeom(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(3.2, 2.6, 2.7).translate(0, 0, 1.35);
  const hood = new THREE.BoxGeometry(3.7, 3.1, 0.26).translate(0, 0, 2.82);
  const door = new THREE.BoxGeometry(0.12, 1.0, 2.0).translate(1.62, 0, 1.0);
  return mergeGeoms([box, hood, door]);
}

/** The lift overrun: taller than the bulkhead, and it always has a vent. */
function overrunGeom(): THREE.BufferGeometry {
  const shaft = new THREE.BoxGeometry(3.6, 3.0, 4.4).translate(0, 0, 2.2);
  const cap = new THREE.BoxGeometry(4.0, 3.4, 0.3).translate(0, 0, 4.55);
  const vent = new THREE.BoxGeometry(0.9, 0.9, 0.7).translate(0.9, 0, 5.05);
  return mergeGeoms([shaft, cap, vent]);
}

/** Open-cell cooling tower: louvred body, fan deck, and the stack over it. */
function coolingTowerGeom(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.BoxGeometry(4.4, 3.2, 2.5).translate(0, 0, 1.25));
  for (let i = 0; i < 4; i++) parts.push(new THREE.BoxGeometry(4.6, 0.14, 0.26).translate(0, -1.6, 0.5 + i * 0.5));
  parts.push(new THREE.CylinderGeometry(1.5, 1.7, 1.5, 12).rotateX(Math.PI / 2).translate(0, 0, 3.25));
  parts.push(new THREE.CylinderGeometry(1.55, 1.55, 0.18, 12).rotateX(Math.PI / 2).translate(0, 0, 4.09));
  for (const l of [[-1.9, -1.3], [1.9, -1.3], [-1.9, 1.3], [1.9, 1.3]])
    parts.push(new THREE.BoxGeometry(0.22, 0.22, 0.55).translate(l[0], l[1], 0.27));
  return mergeGeoms(parts);
}

/** The steel pressure tank — the timber tank's post-war replacement, on legs. */
function pressureTankGeom(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(1.5, 1.5, 4.2, 14).rotateX(Math.PI / 2).translate(0, 0, 4.4));
  parts.push(new THREE.SphereGeometry(1.5, 12, 6).scale(1, 1, 0.55).translate(0, 0, 6.5));
  for (const a of [0, 1, 2, 3]) {
    const th = (a / 4) * Math.PI * 2 + 0.4;
    parts.push(new THREE.BoxGeometry(0.2, 0.2, 2.4).translate(Math.cos(th) * 1.2, Math.sin(th) * 1.2, 1.2));
  }
  return mergeGeoms(parts);
}

/** Standby generator in its weather housing, with the exhaust stack beside it. */
function generatorGeom(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(3.8, 1.9, 1.9).translate(0, 0, 0.95);
  const stack = new THREE.CylinderGeometry(0.24, 0.28, 3.4, 8).rotateX(Math.PI / 2).translate(1.6, 0, 2.6);
  const cap = new THREE.CylinderGeometry(0.34, 0.34, 0.14, 8).rotateX(Math.PI / 2).translate(1.6, 0, 4.35);
  return mergeGeoms([body, stack, cap]);
}

/** A ribbon skylight — a low glazed hump running the length of a bay. */
function skylightGeom(): THREE.BufferGeometry {
  const kerb = new THREE.BoxGeometry(6.4, 1.9, 0.34).translate(0, 0, 0.17);
  const glass = new THREE.CylinderGeometry(1.05, 1.05, 6.2, 8, 1, false, Math.PI, Math.PI)
    .rotateZ(Math.PI / 2).translate(0, 0, 0.34);
  return mergeGeoms([kerb, glass]);
}

/** A rank of photovoltaic panels on tilted rails. Modern roofs only. */
function pvRowGeom(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    parts.push(new THREE.BoxGeometry(3.0, 1.5, 0.09).rotateX(-0.42).translate(0, i * 2.1 - 3.15, 0.62));
    parts.push(new THREE.BoxGeometry(0.09, 0.09, 0.62).translate(-1.3, i * 2.1 - 3.15, 0.31));
    parts.push(new THREE.BoxGeometry(0.09, 0.09, 0.62).translate(1.3, i * 2.1 - 3.15, 0.31));
  }
  return mergeGeoms(parts);
}

/**
 * The guardrail. Set back from the parapet the way the code says, and the one
 * roof part that is nearly all EDGE — which is why it reads at a distance no
 * box does: a long horizontal line floating above the deck is unmistakably a
 * roof even when the roof itself is nine pixels of flat colour.
 */
function guardrailGeom(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.BoxGeometry(7.0, 0.07, 0.07).translate(0, 0, 1.05));
  parts.push(new THREE.BoxGeometry(7.0, 0.06, 0.06).translate(0, 0, 0.55));
  for (let i = 0; i < 5; i++) parts.push(new THREE.BoxGeometry(0.07, 0.07, 1.05).translate(i * 1.75 - 3.5, 0, 0.52));
  return mergeGeoms(parts);
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
