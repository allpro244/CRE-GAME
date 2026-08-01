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
attribute vec2 aSeg;   // wall segment span in perimeter units (u0, u1)
attribute vec2 aCcv;   // corner sign at each end: +1 convex, -1 concave
attribute vec3 aTint;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying vec2 vSeg, vCcv;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh;
void main() {
  vNormal = normal;
  vTint = aTint;
  vPos = position;
  vSeg = aSeg; vCcv = aCcv;
  vU = aU; vZ = position.z; vStyle = aStyle; vRand = aRand; vVar = aVar; vTop = aTop; vFh = aFh;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The light rig. One sun, a sky dome, and a warm bounce off the pavement —
// which is what actually makes massing read: cool light from above, warm
// light from below, and a real shadow between them. Everything lands in a
// filmic curve so highlights roll off instead of clipping to paper white.
const LIGHT_GLSL = /* glsl */ `
const vec3 SUN_DIR = vec3(0.5735, -0.4077, 0.7899);
const vec3 SUN_COL = vec3(1.14, 1.035, 0.87);
const vec3 SKY_COL = vec3(0.50, 0.605, 0.78);
const vec3 GND_COL = vec3(0.44, 0.385, 0.30);

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

const PROP_VERT = /* glsl */ `
// instanceColor is declared for us when the mesh carries one
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
void main() {
  vN = normalize(mat3(instanceMatrix) * normal);
  vW = (instanceMatrix * vec4(position, 1.0)).xyz;
  vC = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
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
// 1.0 = fully sunlit, 0.0 = fully shadowed (4-tap PCF)
float sunVis(vec3 p) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uSunVP * vec4(p, 1.0);
  vec3 ndc = sc.xyz / sc.w * 0.5 + 0.5;
  if (ndc.x < 0.0 || ndc.x > 1.0 || ndc.y < 0.0 || ndc.y > 1.0 || ndc.z > 1.0) return 1.0;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 off = vec2(float(i - (i / 2) * 2) - 0.5, float(i / 2) - 0.5) * (1.4 / 2048.0);
    float d = unpackDepth(texture2D(uShadow, ndc.xy + off));
    sum += step(ndc.z - 0.0028, d);
  }
  return sum * 0.25;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying vec2 vSeg, vCcv;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh;
uniform float uOpacity;
uniform vec3 uCam;
${"" /* shadow sampling */}
` + SHADOW_GLSL + LIGHT_GLSL + /* glsl */ `

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  int s = int(vStyle + 0.5);
  vec3 n = normalize(vNormal);
  float vis = sunVis(vPos + n * 0.7 + vec3(0.0, 0.0, 0.4));

  // ---- ambient occlusion --------------------------------------------------
  // Light doesn't reach the bottom of a street wall, and it doesn't reach into
  // an inside corner. Without these two terms a building looks pasted onto
  // the ground instead of standing on it.
  float aoGround = mix(0.64, 1.0, smoothstep(0.0, 7.5, vZ));
  float dA = vU - vSeg.x, dB = vSeg.y - vU;
  float wA = 1.0 - smoothstep(0.0, 1.7, dA);
  float wB = 1.0 - smoothstep(0.0, 1.7, dB);
  float edge = clamp(wA * vCcv.x + wB * vCcv.y, -1.0, 1.0);
  float aoCorner = edge < 0.0 ? mix(1.0, 0.58, -edge) : 1.0;
  float edgeLift = edge > 0.0 ? 1.0 + 0.055 * edge : 1.0;   // convex arris catches light
  // the underside of a cornice or setback keeps its own shade
  float aoEave = mix(0.80, 1.0, smoothstep(0.0, 1.6, vTop - vZ));
  float ao = aoGround * aoCorner * aoEave;

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
  bool trade = (s <= 4 || s == 6 || s == 7);
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

  // distance dissolve
  vec3 facadeAvg = mix(wall, mix(glassA, glassB, 0.5), win.x * win.y * 0.8);
  col = mix(col, facadeAvg, lod);

  // ---- light --------------------------------------------------------------
  float ndl = max(dot(n, SUN_DIR), 0.0);
  vec3 light = SUN_COL * (ndl * vis * 0.92) + hemiLight(n, ao);
  // glass throws a specular back at the sun; masonry doesn't
  if (glassy) {
    vec3 V = normalize(uCam - vPos);
    vec3 H = normalize(SUN_DIR + V);
    light += SUN_COL * pow(max(dot(n, H), 0.0), 48.0) * 0.55 * vis * winMask;
  }
  col *= light * edgeLift;
  col *= vTint;
  gl_FragColor = vec4(grade(col), uOpacity);
}`;

const ROOF_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vTint;
varying vec3 vPos;
varying vec2 vSeg, vCcv;
varying float vU, vZ, vStyle, vRand, vVar, vTop, vFh;
uniform float uOpacity;
` + SHADOW_GLSL + LIGHT_GLSL + /* glsl */ `
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
  else if (s == 10) roof = vec3(0.66, 0.63, 0.56);   // gravel lot
  else if (s == 11) {                                 // shingles
    if (vVar < 0.4)      roof = vec3(0.48, 0.29, 0.235);
    else if (vVar < 0.7) roof = vec3(0.34, 0.37, 0.415);
    else                 roof = vec3(0.40, 0.50, 0.42);
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
  } else if (s == 10) {
    roof *= 0.88 + 0.24 * rnoise(wp * 2.4);   // gravel
  } else {
    // the roof someone actually specified: dark EPDM, white TPO, silver
    // coating or plain gravel — the roofscape should read as a patchwork
    if (vVar < 0.26)       roof = mix(roof, vec3(0.255, 0.265, 0.285), 0.80);
    else if (vVar < 0.48)  roof = mix(roof, vec3(0.760, 0.765, 0.750), 0.72);
    else if (vVar < 0.68)  roof = mix(roof, vec3(0.545, 0.560, 0.575), 0.66);
    else if (vVar < 0.85)  roof = mix(roof, vec3(0.520, 0.470, 0.395), 0.58);
    // built-up membrane: rolled seams plus weathering blotches
    float seam = min(fract(wp.x * 0.32), fract(wp.y * 0.32));
    roof *= 1.0 - 0.07 * (1.0 - smoothstep(0.0, 0.06, seam));
    roof *= 0.955 + 0.09 * rnoise(wp * 0.7);
    roof = mix(roof, roof * 0.92, smoothstep(0.55, 0.85, rnoise(wp * 0.22 + 17.0)) * 0.45);
  }

  vec3 n = normalize(vNormal);
  float vis = sunVis(vPos + vec3(0.0, 0.0, 0.5));
  // vU carries distance to the roof edge: the parapet shades its own deck
  float aoEdge = mix(0.78, 1.0, smoothstep(0.0, 2.8, vU));
  float ndl = max(dot(n, SUN_DIR), 0.0);
  vec3 light = SUN_COL * (ndl * vis * 0.92) + hemiLight(n, aoEdge);
  gl_FragColor = vec4(grade(roof * light * vTint), uOpacity);
}`;

// transparent quad over the whole city: darkens the MapLibre ground where
// buildings block the sun — streets get real cast shadows
const CATCHER_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
` + SHADOW_GLSL + /* glsl */ `
void main() {
  float vis = sunVis(vPos);
  gl_FragColor = vec4(0.20, 0.23, 0.33, (1.0 - vis) * 0.34);
}`;

const CATCHER_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PROP_FRAG = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
uniform vec3 uColor;
uniform float uOpacity;
` + SHADOW_GLSL + LIGHT_GLSL + /* glsl */ `
void main() {
  vec3 n = normalize(vN);
  float vis = sunVis(vW + n * 0.4 + vec3(0.0, 0.0, 0.3));
  float ao = mix(0.62, 1.0, clamp(vW.z / 5.0, 0.0, 1.0));
  vec3 light = SUN_COL * (max(dot(n, SUN_DIR), 0.0) * vis * 0.92) + hemiLight(n, ao);
  gl_FragColor = vec4(grade(uColor * vC * light), uOpacity);
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
  private posAttrs: THREE.BufferAttribute[] = [];
  private rangesByBBL = new Map<string, { attr: number; r: Ranges }[]>();
  private lotRings = new Map<string, [number, number][]>(); // vacant-lot footprints (meters)
  private flattened = new Set<string>();
  private dynGroup = new THREE.Group();
  private shadowTex: THREE.Texture | null = null;
  private sunVP = new THREE.Matrix4();
  visible = true;

  constructor(
    private volumes: BuildingVolume[],
    private center: [number, number],
    private curbs: [number, number][][] = [],
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
      seg: [] as number[], ccv: [] as number[],
    });
    const W = blank();
    const R = blank();
    const wallRanges: { bbl: string; r: Ranges }[] = [], roofRanges: { bbl: string; r: Ranges }[] = [];
    const props: { kind: number; x: number; y: number; z: number; s: number; rot: number }[] = [];

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
            T.seg.push(-1e6, 1e6); T.ccv.push(0, 0);
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
        if (v.b) this.lotRings.set(v.b, ring);
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
        } else if (v.z1 >= 6) {
          // everything else gets a real parapet, so the roof deck sits down
          // inside a rim instead of ending at a bare edge
          const ph = 0.75 + (rnd % 0.5) + (v.z1 > 45 ? 0.5 : 0);
          extrudeWalls(W, ring, v.z1 - 0.1, v.z1 + ph, [style, rnd, varr, v.z1, fh]);
          const inner = insetRing(ring, 0.28);
          if (inner) capRoof(R, inner, v.z1 + ph, [style === S_GLASS || style === S_DARK ? S_CORNICE : style, rnd, varr, v.z1 + ph, fh]);
        }
        // some modern mid-rises grow a green roof
        if (style === S_GLASS && v.z1 >= 15 && v.z1 <= 60 && varr > 0.62) {
          const g = insetRing(ring, 1.6);
          if (g) capRoof(R, g, v.z1 + 0.08, [S_GREEN, rnd, varr, v.z1, fh]);
        }
        // a deco tower steps to its crown instead of stopping flat
        if (style === S_ARTDECO && v.z1 >= 45) {
          let step0 = ring, zc = v.z1 + 0.2;
          for (let k = 0; k < 3; k++) {
            const inset = insetRing(step0, 1.5 + k * 0.9);
            if (!inset) break;
            const hStep = 3.4 - k * 0.7;
            const cm = [style, rnd, varr, zc + hStep, fh];
            extrudeWalls(W, inset, zc, zc + hStep, cm);
            capRoof(R, inset, zc + hStep, [S_CORNICE, rnd, varr, zc + hStep, fh]);
            step0 = inset; zc += hStep;
          }
        }
        // bulkheads: the stair and lift overrun every tall building carries
        if (v.z1 >= 26 && !v.d) {
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
      g.setAttribute("aSeg", new THREE.Float32BufferAttribute(T.seg, 2));
      g.setAttribute("aCcv", new THREE.Float32BufferAttribute(T.ccv, 2));
      const tint = new Float32Array((T.pos.length / 3) * 3).fill(1);
      const tintAttr = new THREE.Float32BufferAttribute(tint, 3);
      tintAttr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aTint", tintAttr);
      return g;
    };

    const uniforms = () => ({
      uOpacity: { value: 1 },
      uCam: { value: new THREE.Vector3(0, 0, 800) },
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
    ];
    for (let kind = 0; kind < propDefs.length; kind++) {
      const items = props.filter((p) => p.kind === kind);
      if (!items.length) continue;
      const mesh = new THREE.InstancedMesh(propDefs[kind].geom, this.propMaterial(propDefs[kind].color), items.length);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3).fill(1), 3);
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
    this.plantStreets();

    this.bakeShadows();
  }

  // Street trees and lamp standards along the curb. Nothing sells the scale of
  // a building like something human-sized standing next to it, and an empty
  // pavement is what made the city read as a model rather than a place.
  private plantStreets() {
    if (!this.curbs.length) return;
    type Item = { x: number; y: number; s: number; rot: number };
    const trees: Item[] = [], lamps: Item[] = [];
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
          const item = { x: px + nx * off, y: py + ny * off, s: 0.92 + rnd() * 0.55, rot: rnd() * 6.28 };
          if (rnd() < 0.76) trees.push(item);
          else lamps.push({ ...item, s: 0.9 + rnd() * 0.2 });
        }
        carry = Math.max(0, carry - len);
        if (carry === 0) carry = rnd() * 6;
      }
    }

    const add = (geom: THREE.BufferGeometry, color: number, items: Item[], vary = 0) => {
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(geom, this.propMaterial(color), items.length);
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
    add(treeTrunkGeom(), 0x6b5744, trees, 0.12);
    add(treeCanopyGeom(), 0x71904f, trees, 0.34);
    add(lampGeom(), 0x4e5459, lamps, 0.06);
  }

  // Props share the buildings' light rig so a water tower and the roof it
  // stands on are lit by the same sun.
  private propMaterial(color: number, instanced = true): THREE.ShaderMaterial {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      vertexShader: instanced ? PROP_VERT : PROP_VERT_PLAIN,
      fragmentShader: PROP_FRAG,
      uniforms: {
        uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
        uOpacity: { value: 1 },
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
    try {
      const sunDir = new THREE.Vector3(0.45, -0.32, 0.62).normalize();
      const look = new THREE.Vector3(0, 150, 0);
      const cam = new THREE.OrthographicCamera(-1900, 1900, 1600, -1600, 1, 5000);
      cam.position.copy(look.clone().add(sunDir.clone().multiplyScalar(2400)));
      cam.up.set(0, 0, 1);
      cam.lookAt(look);
      cam.updateMatrixWorld(true);

      const target = new THREE.WebGLRenderTarget(2048, 2048, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      this.scene.overrideMaterial = depthMat;
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0xffffff, 1);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      this.renderer.setRenderTarget(null);
      this.scene.overrideMaterial = null;

      const sunVP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.shadowTex = target.texture;
      this.sunVP = sunVP;
      // anything already instanced (roof furniture, trees) picks up the map
      this.scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (mat && mat.uniforms && mat.uniforms.uShadow && !mat.uniforms.uShadow.value) {
          mat.uniforms.uShadow.value = target.texture;
          mat.uniforms.uSunVP.value = sunVP;
          mat.uniforms.uShadowOn.value = 1;
        }
      });
      const catcherMat = new THREE.ShaderMaterial({
        vertexShader: CATCHER_VERT,
        fragmentShader: CATCHER_FRAG,
        uniforms: { uShadow: { value: target.texture }, uSunVP: { value: sunVP }, uShadowOn: { value: 1 } },
        transparent: true,
        depthWrite: false,
      });
      for (const mat of [this.wallMat, this.roofMat]) {
        mat.uniforms.uShadow.value = target.texture;
        mat.uniforms.uSunVP.value = sunVP;
        mat.uniforms.uShadowOn.value = 1;
      }
      // ground shadow catcher — added AFTER the depth pass so it never self-shadows
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(3800, 3200).translate(0, 150, 0.07), catcherMat);
      this.scene.add(ground);
    } catch {
      // shadows are enhancement, never a blocker — flat lighting still ships
    }
  }

  // Player construction and deliveries: a small dynamic mesh set rebuilt on
  // change (a handful of buildings — cheap), sharing the facade materials.
  setPlayerBuildings(items: { bbl: string; cls: string; heightM: number; floors: number; construction: boolean }[]) {
    this.dynGroup.clear();
    for (const item of items) {
      const ring = this.lotRings.get(item.bbl);
      if (!ring) continue;
      if (!this.flattened.has(item.bbl)) this.flattenLot(item.bbl);
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
        seg: [] as number[], ccv: [] as number[],
      });
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
          T.seg.push(u0, u1); T.ccv.push(1, 1);
        }
      }
      const pts = fp.map(([x, y]) => new THREE.Vector2(x, y));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { tris = []; }
      for (const t of tris) {
        for (const idx of t) {
          R2.pos.push(fp[idx][0], fp[idx][1], h); R2.norm.push(0, 0, 1); R2.u.push(4);
          R2.style.push(item.construction ? 5 : meta[0]); R2.rand.push(0.5); R2.varr.push(0.4); R2.top.push(h); R2.fh.push(fh2);
          R2.seg.push(-1e6, 1e6); R2.ccv.push(0, 0);
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
        g.setAttribute("aSeg", new THREE.Float32BufferAttribute(D.seg, 2));
        g.setAttribute("aCcv", new THREE.Float32BufferAttribute(D.ccv, 2));
        g.setAttribute("aTint", new THREE.Float32BufferAttribute(new Float32Array(D.pos.length).fill(1), 3));
        return g;
      };
      this.dynGroup.add(new THREE.Mesh(mk(T), this.wallMat));
      this.dynGroup.add(new THREE.Mesh(mk(R2), this.roofMat));
      if (item.construction) {
        const orange = this.propMaterial(0xc2803a, false);
        this.dynGroup.add(
          new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, h + 16, 6).rotateX(Math.PI / 2).translate(cx + 6, cy + 6, (h + 16) / 2), orange),
          new THREE.Mesh(new THREE.BoxGeometry(26, 1.4, 1.4).translate(cx + 14, cy + 6, h + 15), orange),
        );
      }
    }
    this.map.triggerRepaint();
  }

  // collapse a vacant lot's fence when construction starts (gravel stays)
  private flattenLot(bbl: string) {
    this.flattened.add(bbl);
    const ranges = this.rangesByBBL.get(bbl);
    if (!ranges) return;
    for (const { attr, r } of ranges) {
      if (attr !== 0) continue;
      const arr = this.posAttrs[0].array as Float32Array;
      for (let i = r.start; i < r.start + r.count; i++) arr[i * 3 + 2] = Math.min(arr[i * 3 + 2], 0.02);
    }
    this.posAttrs[0].needsUpdate = true;
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

function treeTrunkGeom(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.16, 0.26, 3.1, 5).rotateX(Math.PI / 2).translate(0, 0, 1.55);
}

// three overlapping lumps read as a canopy from any angle and cost 60 tris
function treeCanopyGeom(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(1.85, 0).translate(0, 0, 4.3);
  const b = new THREE.IcosahedronGeometry(1.25, 0).translate(0.85, 0.3, 3.5);
  return mergeGeoms([a, b]);
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
