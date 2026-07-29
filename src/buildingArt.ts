// Procedural building facades. Pure module: no React, no engine, no DOM — takes a
// params object and projected prism geometry, returns element descriptors the renderer
// maps to SVG. Everything is derived from data the engine already tracks: floors from
// square footage, glazing from construction type, dock doors for industrial,
// storefronts for retail, balconies for apartments, window density from quality,
// rooftop clutter from age, lit windows from occupancy. Nothing is hand-drawn.
//
// Every building resolves to an ARCHETYPE — a family of facade treatments picked
// deterministically from its own stats (size, quality, construction, age, seed), so
// two office towers on the same block can be a glass curtain wall and a deco
// stepback, and a street of shops reads as a street of different shops. The base
// prism color stays ownership-coded (that's gameplay legibility); the archetype
// dresses the faces on top of it.
//
// Geometry contract: an isometric prism whose base corners are bl (left), bb (front,
// bottom-most), br (right), extruded up by ht pixels. The left face spans bl->bb,
// the right face bb->br; we dress the right face (the lit one), hint at the left,
// and cap the top.

export interface ArtParams {
  type: 'office' | 'retail' | 'industrial' | 'mixed' | 'multifamily';
  construction: string;
  quality: number;   // 0-100
  age: number;       // years
  sf: number;
  occ: number;       // 0-1, drives how many windows read as lit
  seed: number;      // per-building determinism
  stories?: number;  // true story count from massing; falls back to height-derived
}
export interface PrismGeom { bl: [number, number]; bb: [number, number]; br: [number, number]; ht: number }

export type ArtEl =
  | { k: 'p'; pts: string; f?: string; s?: string; w?: number; o?: number }
  | { k: 'l'; x1: number; y1: number; x2: number; y2: number; s: string; w: number; o?: number; d?: string };

export type Archetype =
  | 'curtainwall' | 'deco-stepback' | 'punched-midrise' | 'brick-loft'
  | 'garden-walkup' | 'brownstone-row' | 'podium-balcony' | 'res-tower'
  | 'storefront-row' | 'strip-parapet' | 'bigbox'
  | 'dock-shed' | 'sawtooth' | 'tilt-panel'
  | 'podium-tower' | 'main-street';

const WIN_DARK = '#10151b';    // unlit glazing
const WIN_LIT = '#c9a04f';     // lamps on inside
const GLASS = '#3a4a5c';       // curtain-wall band
const GLASS_HI = '#4d6478';    // high-grade low-iron glass
const TRIM = '#0b0f13';

// facade tints, laid over the prism face at low opacity — this is where the city
// stops being ten shades of the same box
const PALETTES = {
  brick: ['#7d4a38', '#8a5340', '#6e4234', '#93604a'],
  limestone: ['#a89a80', '#b3a68c', '#9c8f74'],
  concrete: ['#7e8790', '#6f7880', '#8d949c'],
  glass: ['#46617a', '#3d5468', '#527089'],
  stucco: ['#9a8f78', '#8f9a84', '#a09277', '#8c8296'],
  metal: ['#737d85', '#67717a', '#7d868d'],
  deco: ['#9c8a66', '#a5946f', '#8f7d5c'],
} as const;

function rng32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a: [number, number], b: [number, number], t: number): [number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const fmt = (p: [number, number]) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
const pick = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length];

// a parallelogram patch on a face: u along base edge a->b, v upward (negative y)
function patch(a: [number, number], b: [number, number], u0: number, u1: number, y0: number, y1: number): string {
  const p1 = lerp(a, b, u0), p2 = lerp(a, b, u1);
  return `${p1[0].toFixed(1)},${(p1[1] - y0).toFixed(1)} ${p2[0].toFixed(1)},${(p2[1] - y0).toFixed(1)} ${p2[0].toFixed(1)},${(p2[1] - y1).toFixed(1)} ${p1[0].toFixed(1)},${(p1[1] - y1).toFixed(1)}`;
}
function faceLine(a: [number, number], b: [number, number], u0: number, u1: number, y: number): { x1: number; y1: number; x2: number; y2: number } {
  const p1 = lerp(a, b, u0), p2 = lerp(a, b, u1);
  return { x1: p1[0], y1: p1[1] - y, x2: p2[0], y2: p2[1] - y };
}

// Which family this building belongs to. Deterministic in the params, so the same
// building always wears the same face — and a reload can't re-roll the skyline.
export function pickArchetype(p: ArtParams, stories: number, r: () => number): Archetype {
  const q = p.quality;
  if (p.type === 'office') {
    if (stories >= 7 && (q >= 62 || p.construction === 'steel' || p.construction === 'concrete')) {
      return p.age > 35 || (q >= 55 && q < 72 && r() < 0.45) ? 'deco-stepback' : 'curtainwall';
    }
    if (p.age > 28 && r() < 0.5) return 'brick-loft';
    return 'punched-midrise';
  }
  if (p.type === 'multifamily') {
    if (p.construction === 'garden' || stories <= 2) return r() < 0.4 ? 'brownstone-row' : 'garden-walkup';
    if (stories <= 3 && r() < 0.5) return 'brownstone-row';
    if (stories >= 9) return 'res-tower';
    return 'podium-balcony';
  }
  if (p.type === 'retail') {
    if (p.sf >= 14000) return 'bigbox';
    return r() < 0.5 ? 'storefront-row' : 'strip-parapet';
  }
  if (p.type === 'industrial') {
    if (p.construction === 'tilt') return 'tilt-panel';
    if (p.age > 30 && r() < 0.55) return 'sawtooth';
    return 'dock-shed';
  }
  // mixed
  return stories >= 6 ? 'podium-tower' : 'main-street';
}

const ARCH_PALETTE: Record<Archetype, keyof typeof PALETTES> = {
  'curtainwall': 'glass', 'deco-stepback': 'deco', 'punched-midrise': 'concrete', 'brick-loft': 'brick',
  'garden-walkup': 'stucco', 'brownstone-row': 'brick', 'podium-balcony': 'stucco', 'res-tower': 'concrete',
  'storefront-row': 'brick', 'strip-parapet': 'stucco', 'bigbox': 'metal',
  'dock-shed': 'metal', 'sawtooth': 'brick', 'tilt-panel': 'concrete',
  'podium-tower': 'glass', 'main-street': 'brick',
};

export function buildingArt(p: ArtParams, g: PrismGeom): ArtEl[] {
  const out: ArtEl[] = [];
  const { bl, bb, br, ht } = g;
  if (ht < 6) return out;
  const r = rng32(p.seed);
  const q = p.quality;
  const floors = p.stories ?? Math.max(1, Math.round((ht - 5) / 4.4));
  const fh = ht / Math.max(1, floors + 0.6); // floor pitch in px
  const arch = pickArchetype(p, floors, r);
  const tl: [number, number] = [bl[0] + br[0] - bb[0], bl[1] + br[1] - bb[1]]; // back corner of the roof

  // ---- facade tint: the archetype's material, weathered by age, cleaned by quality ----
  const tint = pick(r, PALETTES[ARCH_PALETTE[arch]]);
  const tintOp = Math.max(0.18, Math.min(0.46, 0.40 - p.age * 0.002 + (q - 50) * 0.0012));
  out.push({ k: 'p', pts: patch(bb, br, 0, 1, 0, ht), f: tint, o: tintOp });
  out.push({ k: 'p', pts: patch(bl, bb, 0, 1, 0, ht), f: tint, o: tintOp * 0.55 });

  // ---- roof surface: membrane, gravel, or a green roof on good new product ----
  const roofCol = q >= 74 && p.age < 12 && r() < 0.4 ? '#2c4030' : p.age > 30 ? '#3a3d40' : '#2e3338';
  out.push({ k: 'p', pts: `${fmt([bl[0], bl[1] - ht])} ${fmt([bb[0], bb[1] - ht])} ${fmt([br[0], br[1] - ht])} ${fmt([tl[0], tl[1] - ht])}`, f: roofCol, o: 0.35 });

  const grid = (a: [number, number], b: [number, number], cols: number, y0frac: number, sideLit: boolean, tall = false) => {
    // punched-window grid: one small quad per floor per column, some lit by occupancy
    const rows = Math.min(floors, 8);
    const rowStep = (ht * (1 - y0frac) - 3) / Math.max(1, rows);
    for (let fl = 0; fl < rows; fl++) {
      for (let c = 0; c < cols; c++) {
        const u0 = 0.12 + (c / cols) * 0.76, u1 = u0 + 0.76 / cols * (tall ? 0.42 : 0.55);
        const y0 = ht * y0frac + 2 + fl * rowStep, y1 = Math.min(ht - 2, y0 + Math.min(tall ? 4.0 : 3.2, rowStep * (tall ? 0.72 : 0.55)));
        if (y1 <= y0 + 0.8) continue;
        const lit = sideLit && r() < p.occ * 0.55;
        out.push({ k: 'p', pts: patch(a, b, u0, u1, y0, y1), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.75 });
      }
    }
  };
  const cornice = (y: number, wgt = 0.8) => {
    out.push({ k: 'l', ...faceLine(bb, br, 0.03, 0.97, y), s: '#1c2126', w: wgt, o: 0.9 });
    out.push({ k: 'l', ...faceLine(bl, bb, 0.03, 0.97, y), s: '#161a1f', w: wgt, o: 0.7 });
  };
  const rooftopBox = (u0: number, u1: number, h: number, col = '#2c343d') => {
    const m0 = lerp(bb, br, u0), m1 = lerp(bb, br, u1);
    out.push({ k: 'p', pts: `${fmt([m0[0], m0[1] - ht])} ${fmt([m1[0], m1[1] - ht])} ${fmt([m1[0], m1[1] - ht - h])} ${fmt([m0[0], m0[1] - ht - h])}`, f: col, s: TRIM, w: 0.4 });
  };
  const waterTower = () => {
    // the NYC silhouette: a squat tank on legs at a roof corner
    const base = lerp(lerp(bb, br, 0.72), tl, 0.25);
    const bx = base[0], by = base[1] - ht;
    out.push({ k: 'l', x1: bx - 1.6, y1: by, x2: bx - 1.2, y2: by - 3, s: '#241d16', w: 0.5 });
    out.push({ k: 'l', x1: bx + 1.6, y1: by, x2: bx + 1.2, y2: by - 3, s: '#241d16', w: 0.5 });
    out.push({ k: 'p', pts: `${(bx - 2).toFixed(1)},${(by - 3).toFixed(1)} ${(bx + 2).toFixed(1)},${(by - 3).toFixed(1)} ${(bx + 1.6).toFixed(1)},${(by - 7).toFixed(1)} ${(bx - 1.6).toFixed(1)},${(by - 7).toFixed(1)}`, f: '#4a3a2c', s: TRIM, w: 0.4 });
    out.push({ k: 'p', pts: `${(bx - 1.6).toFixed(1)},${(by - 7).toFixed(1)} ${(bx + 1.6).toFixed(1)},${(by - 7).toFixed(1)} ${bx.toFixed(1)},${(by - 9.2).toFixed(1)}`, f: '#3a2e23', s: TRIM, w: 0.4 });
  };

  // ================= OFFICE =================
  if (arch === 'curtainwall') {
    const glass = q >= 78 ? GLASS_HI : GLASS;
    const bands = Math.max(2, Math.min(5, Math.round(2 + q / 30)));
    for (let i = 0; i < bands; i++) {
      const u0 = 0.10 + (i / bands) * 0.80, u1 = u0 + 0.80 / bands * 0.62;
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, 2, ht - 2), f: glass, o: 0.55 });
    }
    out.push({ k: 'p', pts: patch(bl, bb, 0.15, 0.85, 2, ht - 2), f: glass, o: 0.3 });
    for (let fl = 1; fl < Math.min(floors, 10); fl++) {
      out.push({ k: 'l', ...faceLine(bb, br, 0.06, 0.94, fl * fh), s: TRIM, w: 0.45, o: 0.5 });
    }
    for (let fl = 0; fl < Math.min(floors, 10); fl++) {
      if (r() < p.occ * 0.30) {
        out.push({ k: 'l', ...faceLine(bb, br, 0.12, 0.5 + r() * 0.4, fl * fh + fh * 0.45), s: WIN_LIT, w: 1.1, o: 0.5 });
      }
    }
    if (p.sf > 15000 || p.age > 25) rooftopBox(0.35, 0.55, 3);
    if (floors >= 10) { // antenna on the tall ones
      const a0 = lerp(lerp(bb, br, 0.5), tl, 0.4);
      out.push({ k: 'l', x1: a0[0], y1: a0[1] - ht, x2: a0[0], y2: a0[1] - ht - 8, s: '#39434e', w: 0.6 });
      out.push({ k: 'l', x1: a0[0] - 0.6, y1: a0[1] - ht - 7.4, x2: a0[0] + 0.6, y2: a0[1] - ht - 7.4, s: '#b04a3a', w: 0.9, o: 0.9 });
    }
  }
  if (arch === 'deco-stepback') {
    // strong vertical piers, a stepped crown, a lit top band when the lights are on
    const piers = 4;
    for (let i = 0; i <= piers; i++) {
      const u = 0.10 + (i / piers) * 0.80;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 2, x2: pt[0], y2: pt[1] - (ht - 3), s: '#1a1712', w: 0.8, o: 0.7 });
    }
    grid(bb, br, piers, 0.05, true, true);
    // stepbacks: two shrinking slabs on the roof
    rooftopBox(0.30, 0.70, 3.2, tint); rooftopBox(0.40, 0.60, 6, tint);
    cornice(ht * 0.7, 0.6); cornice(ht - 2, 0.7);
    if (p.occ > 0.5) out.push({ k: 'l', ...faceLine(bb, br, 0.35, 0.65, ht - 1), s: WIN_LIT, w: 1.2, o: 0.6 });
  }
  if (arch === 'punched-midrise') {
    grid(bb, br, Math.max(2, Math.min(5, Math.round(2 + q / 25))), p.type === 'mixed' ? 0.22 : 0.06, true);
    for (let fl = 2; fl < Math.min(floors, 8); fl += 2) {
      out.push({ k: 'l', ...faceLine(bb, br, 0.06, 0.94, fl * fh), s: '#1c2126', w: 0.35, o: 0.5 });
    }
    cornice(ht - 1.5, 0.7);
    if (p.sf > 15000 || p.age > 25) rooftopBox(0.35, 0.55, 3);
  }
  if (arch === 'brick-loft') {
    // big industrial sash windows, header courses, a heavy cornice — the converted warehouse
    grid(bb, br, 3, 0.06, true, true);
    for (let fl = 1; fl < Math.min(floors, 6); fl++) {
      out.push({ k: 'l', ...faceLine(bb, br, 0.08, 0.92, fl * fh + 0.8), s: '#241a14', w: 0.5, o: 0.6 });
    }
    cornice(ht - 1.2, 1.0);
    if (p.age > 20 && r() < 0.6) waterTower();
  }

  // ================= MULTIFAMILY =================
  if (arch === 'garden-walkup') {
    const r0 = lerp(bl, bb, 0.5), r1 = lerp(bb, br, 0.5);
    const ridge0: [number, number] = [(bl[0] + r1[0]) / 2, (bl[1] + r1[1]) / 2 - ht - 3.5];
    const ridge1: [number, number] = [(br[0] + r0[0]) / 2, (br[1] + r0[1]) / 2 - ht - 3.5];
    const roofTint = pick(r, ['#2e3038', '#3a2f2a', '#2c3530'] as const);
    out.push({ k: 'p', pts: `${fmt([bb[0], bb[1] - ht])} ${fmt([br[0], br[1] - ht])} ${fmt(ridge1)} ${fmt(ridge0)}`, f: roofTint, s: TRIM, w: 0.4 });
    out.push({ k: 'p', pts: `${fmt([bl[0], bl[1] - ht])} ${fmt([bb[0], bb[1] - ht])} ${fmt(ridge0)}`, f: '#23252c', s: TRIM, w: 0.4 });
    // chimney
    if (r() < 0.5) {
      const c0 = lerp(ridge0, ridge1, 0.3);
      out.push({ k: 'l', x1: c0[0], y1: c0[1] + 1, x2: c0[0], y2: c0[1] - 2.5, s: '#514237', w: 1.4 });
    }
    grid(bb, br, 3, 0.08, true);
    // entry door
    out.push({ k: 'p', pts: patch(bb, br, 0.46, 0.54, 0.5, 4.5), f: '#241d16', s: TRIM, w: 0.3 });
  }
  if (arch === 'brownstone-row') {
    // a row of stoops and tall narrow windows — reads as townhouses even at 40px
    const units = Math.max(2, Math.min(4, Math.round(ht / 8)));
    for (let i = 0; i < units; i++) {
      const u = 0.12 + (i + 0.5) * 0.76 / units;
      out.push({ k: 'p', pts: patch(bb, br, u - 0.035, u + 0.035, 0.5, 4), f: '#241d16', s: TRIM, w: 0.3 });
      out.push({ k: 'l', ...faceLine(bb, br, u - 0.07, u + 0.07, 4.4), s: '#3d3229', w: 0.7, o: 0.8 });
    }
    grid(bb, br, units * 2, 0.28, true, true);
    cornice(ht - 1.2, 0.9);
  }
  if (arch === 'podium-balcony') {
    // podium band in a contrast tone, balconies above
    out.push({ k: 'p', pts: patch(bb, br, 0.04, 0.96, 0.5, Math.min(ht * 0.22, 7)), f: '#4a5058', o: 0.5 });
    grid(bb, br, Math.max(3, Math.min(5, Math.round(2 + q / 25))), 0.24, true);
    for (let fl = 1; fl < Math.min(floors, 9); fl++) {
      out.push({ k: 'l', ...faceLine(bl, bb, 0.2, 0.8, fl * fh), s: '#3a424c', w: 0.8, o: 0.7 });
    }
    if (q >= 68) out.push({ k: 'l', ...faceLine(bb, br, 0.3, 0.7, ht - 0.8), s: '#3f5a46', w: 1.2, o: 0.6 }); // roof deck planting
  }
  if (arch === 'res-tower') {
    grid(bb, br, 4, 0.06, true);
    for (let fl = 1; fl < Math.min(floors, 12); fl++) {
      out.push({ k: 'l', ...faceLine(bl, bb, 0.15, 0.85, fl * fh), s: '#3a424c', w: 0.8, o: 0.7 });
      if (fl % 2 === 0) out.push({ k: 'l', ...faceLine(bb, br, 0.06, 0.94, fl * fh), s: TRIM, w: 0.35, o: 0.4 });
    }
    rooftopBox(0.4, 0.6, 2.6);
    if (p.age > 18 && r() < 0.35) waterTower();
  }

  // ================= RETAIL =================
  if (arch === 'storefront-row' || arch === 'main-street' || p.type === 'mixed') {
    // storefront glazing band at street level on both faces, mullions by quality
    const y1 = Math.min(ht - 1, 6.5);
    out.push({ k: 'p', pts: patch(bb, br, 0.06, 0.94, 1, y1), f: GLASS, o: 0.7 });
    out.push({ k: 'p', pts: patch(bl, bb, 0.06, 0.94, 1, y1), f: GLASS, o: 0.45 });
    const mull = Math.max(2, Math.min(6, Math.round(2 + q / 22)));
    for (let i = 1; i < mull; i++) {
      const u = 0.06 + (i / mull) * 0.88;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - y1, s: TRIM, w: 0.5, o: 0.8 });
    }
    // awnings: occupied shops shade their glass, each its own color
    if (arch === 'storefront-row' && p.occ > 0.3) {
      const shopCols = ['#7a3b3b', '#3b5a4a', '#5a5030', '#3c4a6a'] as const;
      for (let i = 0; i < mull; i++) {
        if (r() > p.occ) continue;
        const u0 = 0.06 + (i / mull) * 0.88, u1 = 0.06 + ((i + 0.9) / mull) * 0.88;
        out.push({ k: 'p', pts: patch(bb, br, u0, Math.min(u1, 0.94), y1, y1 + 1.8), f: pick(r, shopCols), o: 0.85 });
      }
    }
    // signage strip above the glass — occupied storefronts hang signs
    if (p.occ > 0.4) out.push({ k: 'l', ...faceLine(bb, br, 0.10, 0.10 + 0.5 * p.occ, y1 + (arch === 'storefront-row' ? 2.6 : 1.6)), s: WIN_LIT, w: 1.3, o: 0.55 });
    if (arch === 'storefront-row') cornice(ht - 1, 0.8);
  }
  if (arch === 'strip-parapet') {
    // the strip center: parapet band with tenant sign ticks
    const y1 = Math.min(ht - 1, 5.5);
    out.push({ k: 'p', pts: patch(bb, br, 0.05, 0.95, 1, y1), f: GLASS, o: 0.6 });
    out.push({ k: 'p', pts: patch(bb, br, 0.03, 0.97, y1 + 0.5, Math.min(ht - 0.5, y1 + 3.5)), f: '#3d4249', o: 0.8 });
    const tenants = Math.max(2, Math.min(5, Math.round(p.sf / 3000)));
    for (let i = 0; i < tenants; i++) {
      if (r() > Math.max(0.25, p.occ)) continue;
      const u = 0.08 + (i + 0.2) * 0.84 / tenants;
      out.push({ k: 'l', ...faceLine(bb, br, u, u + 0.55 / tenants, y1 + 2), s: pick(r, [WIN_LIT, '#b0654a', '#7fae8a'] as const), w: 1.4, o: 0.8 });
    }
  }
  if (arch === 'bigbox') {
    // one entry, acres of blank wall, RTUs on the roof — you know this building
    out.push({ k: 'p', pts: patch(bb, br, 0.38, 0.62, 1, Math.min(ht - 1, 6)), f: GLASS, o: 0.7 });
    out.push({ k: 'p', pts: patch(bb, br, 0.34, 0.66, Math.min(ht - 1, 6), Math.min(ht - 0.5, 7.2)), f: '#3d4249', o: 0.9 });
    if (p.occ > 0.3) out.push({ k: 'l', ...faceLine(bb, br, 0.40, 0.60, Math.min(ht - 0.5, 6.6)), s: WIN_LIT, w: 1.6, o: 0.8 });
    for (let i = 0; i < 3; i++) rooftopBox(0.2 + i * 0.22, 0.3 + i * 0.22, 1.6, '#454c54');
  }

  // ================= INDUSTRIAL =================
  if (arch === 'dock-shed' || arch === 'tilt-panel') {
    // dock doors along the right face; count from size
    const doors = Math.max(1, Math.min(6, Math.round(p.sf / 10000)));
    for (let i = 0; i < doors; i++) {
      const u0 = 0.14 + (i / doors) * 0.72, u1 = u0 + 0.72 / doors * 0.6;
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, 0.5, Math.min(ht - 1.5, 5.5)), f: '#222a32', s: TRIM, w: 0.4 });
      // a trailer backed in at an occupied dock
      if (r() < p.occ * 0.5) {
        const d0 = lerp(bb, br, (u0 + u1) / 2);
        out.push({ k: 'p', pts: `${(d0[0] + 1).toFixed(1)},${(d0[1] + 1).toFixed(1)} ${(d0[0] + 6).toFixed(1)},${(d0[1] + 3.5).toFixed(1)} ${(d0[0] + 6).toFixed(1)},${(d0[1] + 0.5).toFixed(1)} ${(d0[0] + 1).toFixed(1)},${(d0[1] - 2).toFixed(1)}`, f: '#8b9096', s: TRIM, w: 0.3, o: 0.9 });
      }
    }
    // panel joints (tilt-wall) or corrugation hint
    const joints = arch === 'tilt-panel' ? 5 : 9;
    for (let i = 1; i < joints; i++) {
      const u = i / joints;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1), s: TRIM, w: 0.3, o: 0.4 });
    }
    if (arch === 'tilt-panel') {
      // the office corner: a glass bite out of one end
      out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.12, 1, Math.min(ht - 1, 7)), f: GLASS, o: 0.65 });
      out.push({ k: 'l', ...faceLine(bb, br, 0.0, 1.0, ht * 0.75), s: '#565e66', w: 0.6, o: 0.5 }); // reveal band
    }
    // skylight strips on the roof
    const s0 = lerp(bl, bb, 0.5), s1 = lerp(bb, br, 0.5);
    out.push({ k: 'l', x1: (bl[0] + s1[0]) / 2, y1: (bl[1] + s1[1]) / 2 - ht, x2: (br[0] + s0[0]) / 2, y2: (br[1] + s0[1]) / 2 - ht, s: '#39434e', w: 1.4, o: 0.7 });
    for (let i = 0; i < 2; i++) rooftopBox(0.25 + i * 0.3, 0.35 + i * 0.3, 1.4, '#454c54');
  }
  if (arch === 'sawtooth') {
    // the old works: a zigzag roofline with north-light clerestories
    const teeth = 4;
    for (let i = 0; i < teeth; i++) {
      const u0 = i / teeth, u1 = (i + 1) / teeth;
      const a0 = lerp(bb, br, u0), a1 = lerp(bb, br, u1);
      const peak = lerp(a0, a1, 0.35);
      out.push({ k: 'p', pts: `${fmt([a0[0], a0[1] - ht])} ${fmt([peak[0], peak[1] - ht - 2.8])} ${fmt([a1[0], a1[1] - ht])}`, f: '#33383e', s: TRIM, w: 0.35 });
      const lit = r() < p.occ * 0.7;
      out.push({ k: 'l', x1: peak[0], y1: peak[1] - ht - 2.6, x2: a1[0], y2: a1[1] - ht + 0.2, s: lit ? WIN_LIT : '#39434e', w: 0.8, o: lit ? 0.7 : 0.5 });
    }
    // small-paned old windows
    grid(bb, br, 4, 0.15, true, true);
    if (r() < 0.4) waterTower();
  }

  // ================= MIXED upper stories =================
  if (arch === 'podium-tower') {
    const glass = q >= 74 ? GLASS_HI : GLASS;
    for (let i = 0; i < 3; i++) {
      const u0 = 0.14 + i * 0.26, u1 = u0 + 0.17;
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, ht * 0.26, ht - 2), f: glass, o: 0.5 });
    }
    out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.96, ht * 0.24), s: '#1c2126', w: 0.8, o: 0.8 }); // podium line
    for (let fl = 2; fl < Math.min(floors, 9); fl++) {
      out.push({ k: 'l', ...faceLine(bb, br, 0.08, 0.92, fl * fh), s: TRIM, w: 0.35, o: 0.4 });
    }
    rooftopBox(0.38, 0.58, 2.4);
  }
  if (arch === 'main-street') {
    grid(bb, br, 3, 0.3, true);
    cornice(ht - 1.2, 0.8);
  }

  // ---- weathering: old buildings streak; poor ones streak more ----
  const streaks = p.age > 30 ? (q < 45 ? 3 : q < 65 ? 2 : 1) : p.age > 18 && q < 50 ? 1 : 0;
  for (let i = 0; i < streaks; i++) {
    const u = 0.15 + r() * 0.7;
    const pt = lerp(bb, br, u);
    out.push({ k: 'l', x1: pt[0], y1: pt[1] - ht + 2, x2: pt[0], y2: pt[1] - 2 - r() * ht * 0.3, s: '#0e1216', w: 1.2 + r(), o: 0.22 });
  }
  return out;
}

// Construction sites read as sites: fence, pad, crane once the frame is up.
export function siteArt(g: PrismGeom, prog: number, seed: number): ArtEl[] {
  const { bl, bb, br, ht } = g;
  const out: ArtEl[] = [];
  const r = rng32(seed);
  // perimeter fence posts
  for (const [a, b] of [[bl, bb], [bb, br]] as [[number, number], [number, number]][]) {
    out.push({ k: 'l', x1: a[0], y1: a[1] - 2.2, x2: b[0], y2: b[1] - 2.2, s: '#8a7030', w: 0.5, o: 0.8, d: '2 2' });
  }
  if (prog < 0.25) {
    // early days: excavator scratches and a materials laydown
    const m0 = lerp(bb, br, 0.3);
    out.push({ k: 'p', pts: `${(m0[0] - 2).toFixed(1)},${(m0[1] - 1).toFixed(1)} ${(m0[0] + 3).toFixed(1)},${(m0[1] + 1.5).toFixed(1)} ${(m0[0] + 3).toFixed(1)},${(m0[1] - 0.5).toFixed(1)} ${(m0[0] - 2).toFixed(1)},${(m0[1] - 3).toFixed(1)}`, f: '#5c5030', o: 0.7 });
  }
  if (prog > 0.25) {
    // tower crane: mast at a corner, jib across the site
    const mastBase = lerp(bb, br, 0.85);
    const mastTop: [number, number] = [mastBase[0], mastBase[1] - ht - 14];
    out.push({ k: 'l', x1: mastBase[0], y1: mastBase[1], x2: mastTop[0], y2: mastTop[1], s: '#c98a2e', w: 1.1 });
    const jibEnd: [number, number] = [mastTop[0] - 18 - r() * 8, mastTop[1] + 3];
    out.push({ k: 'l', x1: mastTop[0], y1: mastTop[1], x2: jibEnd[0], y2: jibEnd[1], s: '#c98a2e', w: 0.9 });
    out.push({ k: 'l', x1: mastTop[0], y1: mastTop[1], x2: mastTop[0] + 7, y2: mastTop[1] + 2, s: '#c98a2e', w: 0.9 });
    // hook line
    out.push({ k: 'l', x1: jibEnd[0] + 4, y1: jibEnd[1], x2: jibEnd[0] + 4, y2: jibEnd[1] + 8 + r() * 6, s: '#8a7030', w: 0.5 });
  }
  return out;
}
