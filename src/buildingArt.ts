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
  quality: number;   // 1-150
  age: number;       // years
  sf: number;
  occ: number;       // 0-1, drives how many windows read as lit
  seed: number;      // per-building determinism
  tight?: boolean;   // street-walled: lot-line to lot-line, no apron room
  stories?: number;  // true story count from massing; falls back to height-derived
}
export interface PrismGeom { bl: [number, number]; bb: [number, number]; br: [number, number]; ht: number }

export type ArtEl =
  | { k: 'p'; pts: string; f?: string; s?: string; w?: number; o?: number; cls?: string; dly?: number }
  | { k: 'l'; x1: number; y1: number; x2: number; y2: number; s: string; w: number; o?: number; d?: string; cls?: string; dly?: number }
  | { k: 'c'; cx: number; cy: number; r: number; f: string; o?: number; cls?: string; dly?: number };

export type Archetype =
  | 'curtainwall' | 'deco-stepback' | 'punched-midrise' | 'brick-loft' | 'wood-office'
  | 'garden-walkup' | 'brownstone-row' | 'podium-balcony' | 'res-tower'
  | 'storefront-row' | 'strip-parapet' | 'bigbox' | 'anchor-center' | 'pad-site'
  | 'dock-shed' | 'sawtooth' | 'tilt-panel' | 'pemb' | 'tin-shed'
  | 'podium-tower' | 'main-street'
  // the second wave: two more faces for every construction spec
  | 'cross-dock' | 'cold-store'          // tilt-wall
  | 'twin-gable' | 'flex-rd'             // metal
  | 'quonset' | 'yard-shed'              // tin
  | 'arcade-center' | 'lifestyle-center' // shopping center
  | 'awning-strip' | 'tower-strip'       // retail strip
  | 'drive-thru' | 'bank-pad'            // pad site
  | 'ribbon-slab' | 'crown-tower'        // concrete office
  | 'stone-base' | 'courtyard-brick'     // masonry office
  | 'porch-office' | 'stucco-court'      // wood office
  | 'flatiron-corner' | 'market-hall'    // mixed podium
  | 'courtyard-garden' | 'townhome-row'  // garden apartments
  | 'bay-midrise' | 'gallery-midrise'    // wood-podium midrise
  | 'point-tower' | 'terrace-tower';     // concrete residential tower

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
  white: ['#c9c5ba', '#bfbdb2', '#cfccc2'],   // insulated panel, painted precast
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
  // construction is DESTINY: the spec it was built to is the building people see.
  // A tilt-wall warehouse looks like tilt-wall; a metal building looks like metal.
  if (p.type === 'industrial') {
    if (p.construction === 'tilt') {
      if (p.sf >= 28000 && r() < 0.38) return 'cross-dock';    // the big ones ship from both sides
      if (r() < 0.28) return 'cold-store';                     // white panels, no windows, big compressors
      return 'tilt-panel';
    }
    if (p.construction === 'metal') {
      if (p.age > 35 && r() < 0.35) return 'sawtooth';
      if (q >= 82 && r() < 0.4) return 'flex-rd';              // the office-fronted flex building
      if (r() < 0.4) return 'twin-gable';
      return 'pemb';
    }
    if (p.construction === 'tin') {
      if (p.age > 30 && r() < 0.35) return 'sawtooth';
      if (r() < 0.32) return 'quonset';                        // the barrel-roof surplus hut
      if (p.sf < 14000 && r() < 0.45) return 'yard-shed';      // half shed, half laydown yard
      return 'tin-shed';
    }
    return 'dock-shed';
  }
  if (p.type === 'retail') {
    if (p.construction === 'pad') {
      if (r() < 0.38) return 'drive-thru';                     // the lane and the menu board
      if (q >= 96 && r() < 0.5) return 'bank-pad';             // columns and a drive-up canopy
      return 'pad-site';
    }
    if (p.construction === 'center') {
      if (p.sf >= 12000) {
        if (q >= 100 && r() < 0.45) return 'lifestyle-center'; // varied parapets, trees, an entry tower
        if (r() < 0.4) return 'arcade-center';                 // the colonnade walk
        return 'anchor-center';
      }
      return 'bigbox';
    }
    // strip construction
    if (p.sf >= 14000) return 'bigbox';
    if (p.age > 30 && r() < 0.4) return 'storefront-row';
    if (r() < 0.35) return 'awning-strip';                     // striped canvas over every door
    if (r() < 0.45) return 'tower-strip';                      // the corner tower with the sign panel
    return 'strip-parapet';
  }
  if (p.type === 'office') {
    if (p.construction === 'wood') {
      if (stories > 2) return 'punched-midrise';
      if (r() < 0.38) return 'porch-office';                   // gable, porch posts, a shingle out front
      if (r() < 0.5) return 'stucco-court';                    // exterior stair, gallery rail
      return 'wood-office';
    }
    if (p.construction === 'masonry') {
      if (p.age > 28 && r() < 0.4) return 'brick-loft';
      if (q >= 92 && r() < 0.42) return 'stone-base';          // rusticated base, arched entry
      if (r() < 0.38) return 'courtyard-brick';                // paired bays around a light court
      return 'punched-midrise';
    }
    // concrete & steel
    if (stories >= 7 || q >= 93) {
      if (p.age > 35 || (q >= 83 && q < 108 && r() < 0.45)) return 'deco-stepback';
      if (q >= 114 && r() < 0.45) return 'crown-tower';        // set-back lit crown
      if (r() < 0.3) return 'ribbon-slab';                     // the 60s horizontal-band slab
      return 'curtainwall';
    }
    return r() < 0.35 ? 'ribbon-slab' : 'punched-midrise';
  }
  if (p.type === 'multifamily') {
    if (p.construction === 'garden') {
      if (stories <= 2 && r() < 0.28) return 'brownstone-row';
      if (r() < 0.34) return 'courtyard-garden';               // two wings around a green court
      if (r() < 0.5) return 'townhome-row';                    // gables, stoops, painted panels
      return 'garden-walkup';
    }
    if (p.construction === 'tower') {
      if (r() < 0.35) return 'point-tower';                    // slim glass on a townhouse base
      if (q >= 104 && r() < 0.5) return 'terrace-tower';       // planted setbacks stepping down
      return 'res-tower';
    }
    // midrise
    if (stories <= 3 && r() < 0.4) return r() < 0.5 ? 'brownstone-row' : 'townhome-row';
    if (stories >= 9) return 'res-tower';
    if (r() < 0.33) return 'bay-midrise';                      // projecting bay stacks
    if (r() < 0.5) return 'gallery-midrise';                   // open walkways, a stair tower
    return 'podium-balcony';
  }
  // mixed (podium construction)
  if (stories >= 6) return r() < 0.32 ? 'flatiron-corner' : 'podium-tower';
  return r() < 0.36 ? 'market-hall' : 'main-street';
}

const ARCH_PALETTE: Record<Archetype, keyof typeof PALETTES> = {
  'curtainwall': 'glass', 'deco-stepback': 'deco', 'punched-midrise': 'concrete', 'brick-loft': 'brick', 'wood-office': 'stucco',
  'garden-walkup': 'stucco', 'brownstone-row': 'brick', 'podium-balcony': 'stucco', 'res-tower': 'concrete',
  'storefront-row': 'brick', 'strip-parapet': 'stucco', 'bigbox': 'metal', 'anchor-center': 'stucco', 'pad-site': 'brick',
  'dock-shed': 'metal', 'sawtooth': 'brick', 'tilt-panel': 'concrete', 'pemb': 'metal', 'tin-shed': 'metal',
  'podium-tower': 'glass', 'main-street': 'brick',
  'cross-dock': 'concrete', 'cold-store': 'white',
  'twin-gable': 'metal', 'flex-rd': 'metal',
  'quonset': 'metal', 'yard-shed': 'metal',
  'arcade-center': 'limestone', 'lifestyle-center': 'stucco',
  'awning-strip': 'stucco', 'tower-strip': 'stucco',
  'drive-thru': 'brick', 'bank-pad': 'limestone',
  'ribbon-slab': 'concrete', 'crown-tower': 'glass',
  'stone-base': 'limestone', 'courtyard-brick': 'brick',
  'porch-office': 'stucco', 'stucco-court': 'stucco',
  'flatiron-corner': 'brick', 'market-hall': 'limestone',
  'courtyard-garden': 'stucco', 'townhome-row': 'brick',
  'bay-midrise': 'brick', 'gallery-midrise': 'stucco',
  'point-tower': 'glass', 'terrace-tower': 'concrete',
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
  const tintOp = Math.max(0.18, Math.min(0.46, 0.40 - p.age * 0.002 + (q - 75) * 0.0008));
  out.push({ k: 'p', pts: patch(bb, br, 0, 1, 0, ht), f: tint, o: tintOp });
  out.push({ k: 'p', pts: patch(bl, bb, 0, 1, 0, ht), f: tint, o: tintOp * 0.55 });

  // ---- roof surface: membrane, gravel, or a green roof on good new product ----
  const roofCol = q >= 111 && p.age < 12 && r() < 0.4 ? '#2c4030' : p.age > 30 ? '#3a3d40' : '#2e3338';
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
        out.push({ k: 'p', pts: patch(a, b, u0, u1, y0, y1), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.75,
          cls: lit && r() < 0.3 ? 'twk' : undefined, dly: lit ? Math.round(r() * 40) / 10 : undefined });
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
  // paved apron in front of the building — parking rows for retail, truck court for docks
  const apron = (kind: 'park' | 'truck') => {
    if (p.tight) return;   // wall-to-wall buildings have no forecourt
    const dx = 6.5, dy = 3.2;   // toward the viewer in iso space
    out.push({ k: 'p', pts: `${fmt(bb)} ${fmt(br)} ${(br[0] + dx).toFixed(1)},${(br[1] + dy).toFixed(1)} ${(bb[0] + dx).toFixed(1)},${(bb[1] + dy).toFixed(1)}`, f: '#20242a', o: 0.85 });
    if (kind === 'park') {
      for (let i = 1; i < 7; i++) {
        const u = i / 7;
        const px0 = lerp(bb, br, u);
        out.push({ k: 'l', x1: px0[0] + dx * 0.25, y1: px0[1] + dy * 0.25, x2: px0[0] + dx * 0.75, y2: px0[1] + dy * 0.75, s: '#3d434b', w: 0.5, o: 0.9 });
      }
      // a few parked cars, seeded — an empty lot reads as a dead store
      for (let i = 0; i < 6; i++) {
        if (r() > p.occ * 0.8) continue;
        const u = 0.08 + (i / 6) * 0.84 + r() * 0.04;
        const c0 = lerp(bb, br, u);
        out.push({ k: 'p', pts: `${(c0[0] + 1.2).toFixed(1)},${(c0[1] + 0.9).toFixed(1)} ${(c0[0] + 3.4).toFixed(1)},${(c0[1] + 2.0).toFixed(1)} ${(c0[0] + 3.4).toFixed(1)},${(c0[1] + 0.8).toFixed(1)} ${(c0[0] + 1.2).toFixed(1)},${(c0[1] - 0.3).toFixed(1)}`, f: pick(r, ['#5a6570', '#6e5f52', '#4a5a6a', '#75706a', '#5f4a4a'] as const), o: 0.95 });
      }
    } else {
      out.push({ k: 'l', x1: bb[0] + dx * 0.5, y1: bb[1] + dy * 0.5, x2: br[0] + dx * 0.5, y2: br[1] + dy * 0.5, s: '#32383f', w: 0.5, o: 0.7, d: '3 3' });
    }
  };
  // a working stack: smoke drifts while the building is earning
  const smokeStack = (u: number) => {
    const base = lerp(lerp(bb, br, u), tl, 0.3);
    const sx = base[0], sy = base[1] - ht;
    out.push({ k: 'l', x1: sx, y1: sy + 1, x2: sx, y2: sy - 4.5, s: '#3c4249', w: 1.4 });
    if (p.occ > 0.35) for (let i = 0; i < 3; i++) {
      out.push({ k: 'c', cx: sx + 0.4 + i * 0.5, cy: sy - 5.5 - i * 2.2, r: 1.1 + i * 0.5, f: '#8a9097', o: 0.22 - i * 0.05, cls: 'smk', dly: i * 1.3 + r() * 2 });
    }
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
    const glass = q >= 117 ? GLASS_HI : GLASS;
    const bands = Math.max(2, Math.min(5, Math.round(2 + q / 45)));
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
    grid(bb, br, Math.max(2, Math.min(5, Math.round(2 + q / 37))), p.type === 'mixed' ? 0.22 : 0.06, true);
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
    grid(bb, br, Math.max(3, Math.min(5, Math.round(2 + q / 37))), 0.24, true);
    for (let fl = 1; fl < Math.min(floors, 9); fl++) {
      out.push({ k: 'l', ...faceLine(bl, bb, 0.2, 0.8, fl * fh), s: '#3a424c', w: 0.8, o: 0.7 });
    }
    if (q >= 102) out.push({ k: 'l', ...faceLine(bb, br, 0.3, 0.7, ht - 0.8), s: '#3f5a46', w: 1.2, o: 0.6 }); // roof deck planting
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
    const mull = Math.max(2, Math.min(6, Math.round(2 + q / 33)));
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
    apron('park');
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
    apron('park');
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
    apron('truck');
  }
  if (arch === 'pemb') {
    // pre-engineered metal: ribbed panels, exposed frame lines, a shallow gable
    // profile, roll-up doors — nobody mistakes this for concrete
    for (let i = 1; i < 12; i++) {
      const u = i / 12;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1.5), s: TRIM, w: 0.25, o: 0.5 });
    }
    for (let i = 1; i < 4; i++) {   // main frames read through the skin
      const u = i / 4;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 0.5, x2: pt[0], y2: pt[1] - ht, s: '#565e66', w: 0.7, o: 0.8 });
    }
    // wainscot band in a contrast tone — the classic two-tone metal building
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, 0.5, 3.2), f: pick(r, ['#4a5560', '#5c5248', '#4e5a50'] as const), o: 0.8 });
    const doors = Math.max(1, Math.min(4, Math.round(p.sf / 12000)));
    for (let i = 0; i < doors; i++) {
      const u0 = 0.2 + (i / doors) * 0.6;
      out.push({ k: 'p', pts: patch(bb, br, u0, u0 + 0.6 / doors * 0.55, 0.5, Math.min(ht - 2, 6)), f: '#262e36', s: TRIM, w: 0.4 });
      out.push({ k: 'l', ...faceLine(bb, br, u0, u0 + 0.6 / doors * 0.55, Math.min(ht - 2, 6) * 0.55), s: '#39434e', w: 0.4, o: 0.8 });
    }
    // shallow gable ridge along the roof
    const g0 = lerp([bl[0], bl[1] - ht], [bb[0], bb[1] - ht], 0.5);
    const g1 = lerp([br[0], br[1] - ht], [tl[0], tl[1] - ht], 0.5);
    out.push({ k: 'l', x1: g0[0], y1: g0[1] - 1.6, x2: g1[0], y2: g1[1] - 1.6, s: '#4a525a', w: 1.0, o: 0.9 });
    apron('truck');
  }
  if (arch === 'tin-shed') {
    // the old tin building: rust patches, a patched roof, one sliding door, a
    // stack that still smokes when there's work
    for (let i = 1; i < 10; i++) {
      const u = i / 10;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 0.5, x2: pt[0], y2: pt[1] - (ht - 1), s: TRIM, w: 0.3, o: 0.45 });
    }
    for (let i = 0; i < 4; i++) {   // rust blooms where the coating gave up
      const u0 = 0.1 + r() * 0.75;
      const y0 = 1 + r() * (ht - 4);
      out.push({ k: 'p', pts: patch(bb, br, u0, u0 + 0.08 + r() * 0.1, y0, y0 + 1.5 + r() * 2.5), f: '#6e4a30', o: 0.35 + r() * 0.2 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.35, 0.62, 0.5, Math.min(ht - 1.5, 6.5)), f: '#262c33', s: TRIM, w: 0.5 });
    out.push({ k: 'l', ...faceLine(bb, br, 0.35, 0.62, Math.min(ht - 1.5, 6.5)), s: '#4a525a', w: 0.8, o: 0.9 });
    // patched roof panels in mismatched tones
    for (let i = 0; i < 3; i++) {
      const u0 = 0.15 + r() * 0.6, v0 = 0.2 + r() * 0.5;
      const a0 = lerp([bl[0], bl[1] - ht], [bb[0], bb[1] - ht], u0);
      const b0 = lerp([br[0], br[1] - ht], [tl[0], tl[1] - ht], u0);
      const c0 = lerp(a0, b0, v0);
      out.push({ k: 'p', pts: `${fmt(c0)} ${(c0[0] + 3).toFixed(1)},${(c0[1] + 1.5).toFixed(1)} ${(c0[0] + 5.5).toFixed(1)},${(c0[1] + 0.2).toFixed(1)} ${(c0[0] + 2.5).toFixed(1)},${(c0[1] - 1.3).toFixed(1)}`, f: pick(r, ['#565d64', '#4e4a42', '#5e6067'] as const), o: 0.7 });
    }
    if (p.age > 15) smokeStack(0.78);
    apron('truck');
  }
  if (arch === 'pad-site') {
    // the freestanding pad: glass box, a canopy band, a drive-thru lane and a
    // monument sign — you have eaten at this building
    out.push({ k: 'p', pts: patch(bb, br, 0.08, 0.92, 1, Math.min(ht - 1, 5.5)), f: GLASS, o: 0.75 });
    out.push({ k: 'p', pts: patch(bl, bb, 0.15, 0.85, 1, Math.min(ht - 1, 5.5)), f: GLASS, o: 0.5 });
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, Math.min(ht - 1, 5.5), Math.min(ht + 0.5, 7.5)), f: pick(r, ['#7a3b3b', '#3b5a4a', '#5a4a30'] as const), o: 0.9 });
    if (p.occ > 0.3) out.push({ k: 'l', ...faceLine(bb, br, 0.3, 0.7, Math.min(ht - 0.2, 6.6)), s: WIN_LIT, w: 1.5, o: 0.85, cls: 'twk', dly: r() * 3 });
    // monument sign out front
    const m0 = lerp(bb, br, 0.9);
    out.push({ k: 'l', x1: m0[0] + 3.5, y1: m0[1] + 2, x2: m0[0] + 3.5, y2: m0[1] - 2.5, s: '#3c4249', w: 0.9 });
    out.push({ k: 'p', pts: `${(m0[0] + 2.4).toFixed(1)},${(m0[1] - 2.5).toFixed(1)} ${(m0[0] + 4.6).toFixed(1)},${(m0[1] - 2.5).toFixed(1)} ${(m0[0] + 4.6).toFixed(1)},${(m0[1] - 4.3).toFixed(1)} ${(m0[0] + 2.4).toFixed(1)},${(m0[1] - 4.3).toFixed(1)}`, f: WIN_LIT, o: p.occ > 0.3 ? 0.8 : 0.25 });
    apron('park');
  }
  if (arch === 'anchor-center') {
    // the neighborhood center: a taller anchor volume at one end, an inline run
    // with a continuous canopy, tenant signs, and a field of parking
    out.push({ k: 'p', pts: patch(bb, br, 0.0, 0.3, 0, ht), f: tint, o: 0.25 });   // anchor mass reads heavier
    out.push({ k: 'l', x1: lerp(bb, br, 0.3)[0], y1: lerp(bb, br, 0.3)[1] - 0.5, x2: lerp(bb, br, 0.3)[0], y2: lerp(bb, br, 0.3)[1] - ht, s: TRIM, w: 0.8, o: 0.9 });
    out.push({ k: 'p', pts: patch(bb, br, 0.04, 0.27, 2, Math.min(ht - 1, 7)), f: GLASS, o: 0.6 });   // anchor entry glass
    if (p.occ > 0.25) out.push({ k: 'l', ...faceLine(bb, br, 0.06, 0.25, Math.min(ht - 0.5, 7.8)), s: WIN_LIT, w: 1.7, o: 0.85 });
    // inline run: storefront glass under a continuous canopy line
    out.push({ k: 'p', pts: patch(bb, br, 0.33, 0.96, 1, Math.min(ht * 0.55, 5)), f: GLASS, o: 0.65 });
    out.push({ k: 'l', ...faceLine(bb, br, 0.31, 0.97, Math.min(ht * 0.55, 5) + 0.8), s: '#3d434b', w: 1.1, o: 0.9 });
    const tenants = Math.max(3, Math.min(7, Math.round(p.sf / 3500)));
    for (let i = 0; i < tenants; i++) {
      if (r() > Math.max(0.3, p.occ)) continue;
      const u = 0.34 + (i + 0.15) * 0.62 / tenants;
      out.push({ k: 'l', ...faceLine(bb, br, u, u + 0.4 / tenants, Math.min(ht * 0.55, 5) + 2), s: pick(r, [WIN_LIT, '#b0654a', '#7fae8a', '#8a9fd0'] as const), w: 1.2, o: 0.85, cls: r() < 0.25 ? 'twk' : undefined, dly: r() * 4 });
    }
    for (let i = 0; i < 2; i++) rooftopBox(0.4 + i * 0.25, 0.5 + i * 0.25, 1.5, '#454c54');
    apron('park');
  }
  if (arch === 'wood-office') {
    // the converted-house office: clapboard lines, a pitched roof, a shingle
    // out front — the lawyer, the dentist, the insurance agency
    for (let i = 1; i < Math.min(ht - 2, 9); i++) {
      out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.96, i * 1.1), s: TRIM, w: 0.25, o: 0.35 });
    }
    grid(bb, br, 3, 0.12, true, true);
    const r0 = lerp(bl, bb, 0.5), r1 = lerp(bb, br, 0.5);
    const ridge0: [number, number] = [(bl[0] + r1[0]) / 2, (bl[1] + r1[1]) / 2 - ht - 3];
    const ridge1: [number, number] = [(br[0] + r0[0]) / 2, (br[1] + r0[1]) / 2 - ht - 3];
    out.push({ k: 'p', pts: `${fmt([bb[0], bb[1] - ht])} ${fmt([br[0], br[1] - ht])} ${fmt(ridge1)} ${fmt(ridge0)}`, f: '#3a3d44', s: TRIM, w: 0.4 });
    out.push({ k: 'p', pts: `${fmt([bl[0], bl[1] - ht])} ${fmt([bb[0], bb[1] - ht])} ${fmt(ridge0)}`, f: '#2c2f36', s: TRIM, w: 0.4 });
    out.push({ k: 'p', pts: patch(bb, br, 0.42, 0.58, 0.5, 4.2), f: '#241d16', s: TRIM, w: 0.3 });
    if (p.occ > 0.3) out.push({ k: 'l', ...faceLine(bb, br, 0.62, 0.85, 3.4), s: WIN_LIT, w: 1.0, o: 0.7 });
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
    smokeStack(0.25);
  }

  // ================= MIXED upper stories =================
  if (arch === 'podium-tower') {
    const glass = q >= 111 ? GLASS_HI : GLASS;
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

  // ================= INDUSTRIAL, second wave =================
  if (arch === 'cross-dock') {
    // ships from both long sides: doors on BOTH faces, trailers queued at the lit one
    const doors = Math.max(2, Math.min(7, Math.round(p.sf / 9000)));
    for (let i = 0; i < doors; i++) {
      const u0 = 0.10 + (i / doors) * 0.80, u1 = u0 + 0.80 / doors * 0.58;
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, 0.5, Math.min(ht - 1.5, 5.2)), f: '#222a32', s: TRIM, w: 0.4 });
      if (r() < p.occ * 0.55) {
        const d0 = lerp(bb, br, (u0 + u1) / 2);
        out.push({ k: 'p', pts: `${(d0[0] + 1).toFixed(1)},${(d0[1] + 1).toFixed(1)} ${(d0[0] + 6).toFixed(1)},${(d0[1] + 3.5).toFixed(1)} ${(d0[0] + 6).toFixed(1)},${(d0[1] + 0.5).toFixed(1)} ${(d0[0] + 1).toFixed(1)},${(d0[1] - 2).toFixed(1)}`, f: '#8b9096', s: TRIM, w: 0.3, o: 0.9 });
      }
    }
    for (let i = 0; i < Math.min(4, doors - 1); i++) {   // far-side doors read as dark ticks
      const u0 = 0.15 + (i / 4) * 0.7;
      out.push({ k: 'p', pts: patch(bl, bb, u0, u0 + 0.10, 0.5, Math.min(ht - 1.5, 4.6)), f: '#1c232b', o: 0.85 });
    }
    for (let i = 1; i < 6; i++) {   // tilt panel joints
      const pt = lerp(bb, br, i / 6);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1), s: TRIM, w: 0.3, o: 0.4 });
    }
    // guard shack at the gate
    const gs = lerp(bb, br, 1.02);
    out.push({ k: 'p', pts: `${(gs[0] + 2).toFixed(1)},${(gs[1] + 1.5).toFixed(1)} ${(gs[0] + 4.4).toFixed(1)},${(gs[1] + 2.6).toFixed(1)} ${(gs[0] + 4.4).toFixed(1)},${(gs[1] - 0.6).toFixed(1)} ${(gs[0] + 2).toFixed(1)},${(gs[1] - 1.7).toFixed(1)}`, f: '#5a6068', s: TRIM, w: 0.3 });
    for (let i = 0; i < 3; i++) rooftopBox(0.2 + i * 0.25, 0.3 + i * 0.25, 1.4, '#454c54');
    apron('truck');
  }
  if (arch === 'cold-store') {
    // the freezer box: white insulated panel, no glass anywhere, a compressor plant
    // humming on the roof and a frost-grey pipe run at grade
    for (let i = 1; i < 5; i++) {   // wide panel joints
      const pt = lerp(bb, br, i / 5);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1), s: '#9aa0a6', w: 0.35, o: 0.5 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, 0.5, 2.6), f: '#8f979e', o: 0.55 });   // bumper-scarred base band
    // one dock cluster at the left end, doors sealed with shelters
    for (let i = 0; i < 2; i++) {
      const u0 = 0.08 + i * 0.13;
      out.push({ k: 'p', pts: patch(bb, br, u0, u0 + 0.09, 0.5, Math.min(ht - 1.5, 4.8)), f: '#2a3138', s: TRIM, w: 0.4 });
    }
    // refrigeration plant: a row of fat units and a pipe rack over the roof
    for (let i = 0; i < 3; i++) rooftopBox(0.45 + i * 0.16, 0.57 + i * 0.16, 2.4, '#4e565e');
    const pr0 = lerp(lerp(bb, br, 0.42), tl, 0.2), pr1 = lerp(lerp(bb, br, 0.9), tl, 0.2);
    out.push({ k: 'l', x1: pr0[0], y1: pr0[1] - ht - 2.8, x2: pr1[0], y2: pr1[1] - ht - 2.8, s: '#7d868d', w: 0.7, o: 0.9 });
    if (p.occ > 0.35) {   // condenser steam on a working box
      const st = lerp(lerp(bb, br, 0.55), tl, 0.2);
      for (let i = 0; i < 2; i++) out.push({ k: 'c', cx: st[0] + i * 1.2, cy: st[1] - ht - 4 - i * 1.8, r: 1.0 + i * 0.4, f: '#c8cdd2', o: 0.25 - i * 0.07, cls: 'smk', dly: i * 1.7 });
    }
    apron('truck');
  }
  if (arch === 'twin-gable') {
    // two shallow gables side by side with a center gutter — the doubled metal building
    for (let i = 1; i < 12; i++) {
      const pt = lerp(bb, br, i / 12);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1.5), s: TRIM, w: 0.25, o: 0.5 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, 0.5, 3.0), f: pick(r, ['#4a5560', '#5c5248', '#4e5a50'] as const), o: 0.8 });
    for (const uu of [0.25, 0.75]) {   // twin ridges run front-to-back, parallel
      const g0 = lerp([bl[0], bl[1] - ht], [bb[0], bb[1] - ht], uu);
      const g1 = lerp([tl[0], tl[1] - ht], [br[0], br[1] - ht], uu);
      out.push({ k: 'l', x1: g0[0], y1: g0[1] - 1.5, x2: g1[0], y2: g1[1] - 1.5, s: '#4a525a', w: 1.0, o: 0.9 });
    }
    const v0 = lerp([bl[0], bl[1] - ht], [bb[0], bb[1] - ht], 0.5);   // valley gutter between them
    const v1 = lerp([tl[0], tl[1] - ht], [br[0], br[1] - ht], 0.5);
    out.push({ k: 'l', x1: v0[0], y1: v0[1] - 0.3, x2: v1[0], y2: v1[1] - 0.3, s: '#31383f', w: 0.6, o: 0.8 });
    for (let i = 0; i < 2; i++) {
      const u0 = 0.14 + i * 0.44;
      out.push({ k: 'p', pts: patch(bb, br, u0, u0 + 0.22, 0.5, Math.min(ht - 2, 5.8)), f: '#262e36', s: TRIM, w: 0.4 });
    }
    apron('truck');
  }
  if (arch === 'flex-rd') {
    // flex/R&D: the front third is a glass office, the back is honest metal shed —
    // one building, two jobs
    out.push({ k: 'p', pts: patch(bb, br, 0.04, 0.36, 1, ht - 1.5), f: q >= 100 ? GLASS_HI : GLASS, o: 0.6 });
    for (let i = 1; i < 3; i++) {   // office mullions
      const pt = lerp(bb, br, 0.04 + (i / 3) * 0.32);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1.5), s: TRIM, w: 0.4, o: 0.7 });
    }
    if (p.occ > 0.3) out.push({ k: 'l', ...faceLine(bb, br, 0.07, 0.30, ht * 0.55), s: WIN_LIT, w: 1.1, o: 0.6, cls: 'twk', dly: r() * 3 });
    for (let i = 1; i < 8; i++) {   // shed ribs on the working end
      const pt = lerp(bb, br, 0.38 + (i / 8) * 0.58);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1.5), s: TRIM, w: 0.25, o: 0.5 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.44, 0.58, 0.5, Math.min(ht - 2, 5.5)), f: '#262e36', s: TRIM, w: 0.4 });   // one roll-up
    out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.96, ht - 1.2), s: '#565e66', w: 0.6, o: 0.6 });   // parapet reveal
    rooftopBox(0.55, 0.68, 1.5, '#454c54');
    apron('park');   // engineers drive sedans, not semis
  }
  if (arch === 'quonset') {
    // the surplus barrel hut: a curved corrugated vault, an arched end wall, one door
    const end = [];   // arched end on the right face, drawn as a 7-point vault outline
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const pt = lerp(bb, br, u);
      const rise = Math.sin(u * Math.PI) * 3.2;   // the barrel adds height at midspan
      end.push(`${pt[0].toFixed(1)},${(pt[1] - ht + 1.2 - rise).toFixed(1)}`);
    }
    out.push({ k: 'p', pts: `${fmt(bb)} ${end.join(' ')} ${fmt(br)}`, f: pick(r, PALETTES.metal), o: 0.35 });
    for (let i = 1; i <= 5; i++) {   // corrugation follows the curve
      const u = i / 6;
      const a0 = lerp(bb, br, u), rise = Math.sin(u * Math.PI) * 3.2;
      out.push({ k: 'l', x1: a0[0], y1: a0[1] - 0.5, x2: a0[0], y2: a0[1] - ht + 1 - rise, s: TRIM, w: 0.3, o: 0.5 });
    }
    // the vault itself: three sheen lines arcing along the roof, parallel to the ridge
    for (const uu of [0.3, 0.5, 0.7]) {
      const g0 = lerp([bl[0], bl[1] - ht], [bb[0], bb[1] - ht], uu);
      const g1 = lerp([tl[0], tl[1] - ht], [br[0], br[1] - ht], uu);
      const lift = Math.sin(uu * Math.PI) * 3.0;
      out.push({ k: 'l', x1: g0[0], y1: g0[1] - lift, x2: g1[0], y2: g1[1] - lift, s: uu === 0.5 ? '#8a939a' : '#5a636b', w: uu === 0.5 ? 1.1 : 0.7, o: 0.85 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.40, 0.60, 0.5, Math.min(ht - 1, 5)), f: '#262c33', s: TRIM, w: 0.5 });
    if (p.age > 20) {   // rust line where water runs off the barrel
      out.push({ k: 'l', ...faceLine(bb, br, 0.1, 0.9, 1.5), s: '#6e4a30', w: 0.8, o: 0.4 });
    }
    apron('truck');
  }
  if (arch === 'yard-shed') {
    // the contractor's yard: a small shed on the left, a fenced laydown yard on the
    // right full of stacked material — half this business is outdoors
    for (let i = 1; i < 6; i++) {
      const pt = lerp(bb, br, (i / 6) * 0.55);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 0.5, x2: pt[0], y2: pt[1] - (ht - 1), s: TRIM, w: 0.3, o: 0.45 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.12, 0.38, 0.5, Math.min(ht - 1.5, 5.5)), f: '#262c33', s: TRIM, w: 0.5 });
    // the yard: fence posts and wire along the right 40% of the frontage
    const f0 = lerp(bb, br, 0.58);
    out.push({ k: 'l', x1: f0[0], y1: f0[1] - 3.4, x2: br[0], y2: br[1] - 3.4, s: '#6b6154', w: 0.5, o: 0.9, d: '1.5 1.5' });
    for (const uu of [0.58, 0.72, 0.86, 1.0]) {
      const pt = lerp(bb, br, uu);
      out.push({ k: 'l', x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1] - 3.4, s: '#54493c', w: 0.6 });
    }
    // stacked pallets and a pipe rack, seeded
    for (let i = 0; i < 3; i++) {
      const c0 = lerp(bb, br, 0.62 + i * 0.12);
      const hgt = 1.4 + r() * 1.4;
      out.push({ k: 'p', pts: `${fmt([c0[0], c0[1] - 0.5])} ${(c0[0] + 2.6).toFixed(1)},${(c0[1] + 0.8).toFixed(1)} ${(c0[0] + 2.6).toFixed(1)},${(c0[1] + 0.8 - hgt).toFixed(1)} ${c0[0].toFixed(1)},${(c0[1] - 0.5 - hgt).toFixed(1)}`, f: pick(r, ['#6e5a40', '#5c5248', '#556052'] as const), s: TRIM, w: 0.3, o: 0.95 });
    }
    if (p.occ > 0.4) smokeStack(0.2);
    apron('truck');
  }

  // ================= RETAIL, second wave =================
  if (arch === 'arcade-center') {
    // the colonnade center: an arched walkway shading the storefronts, tile on the parapet
    const y1 = Math.min(ht - 1, 5.8);
    out.push({ k: 'p', pts: patch(bb, br, 0.04, 0.96, 1.5, y1), f: GLASS, o: 0.55 });   // glass in shadow behind the arches
    const bays = Math.max(4, Math.min(8, Math.round(p.sf / 2800)));
    for (let i = 0; i <= bays; i++) {
      const u = 0.04 + (i / bays) * 0.92;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 0.5, x2: pt[0], y2: pt[1] - y1 + 0.8, s: tint, w: 1.2, o: 0.95 });   // columns
      if (i < bays) {   // arch spring between columns
        const mid = lerp(bb, br, u + 0.46 / bays);
        out.push({ k: 'l', x1: pt[0], y1: pt[1] - y1 + 1.2, x2: mid[0], y2: mid[1] - y1 + 0.2, s: tint, w: 0.8, o: 0.9 });
        const nxt = lerp(bb, br, 0.04 + ((i + 1) / bays) * 0.92);
        out.push({ k: 'l', x1: mid[0], y1: mid[1] - y1 + 0.2, x2: nxt[0], y2: nxt[1] - y1 + 1.2, s: tint, w: 0.8, o: 0.9 });
      }
    }
    // tiled parapet band
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, y1 + 0.6, Math.min(ht - 0.3, y1 + 3.2)), f: pick(r, ['#8a4a34', '#7a5a3a', '#6e4a44'] as const), o: 0.75 });
    const tenants = Math.max(3, Math.min(6, Math.round(p.sf / 4000)));
    for (let i = 0; i < tenants; i++) {
      if (r() > Math.max(0.3, p.occ)) continue;
      const u = 0.08 + (i + 0.2) * 0.84 / tenants;
      out.push({ k: 'l', ...faceLine(bb, br, u, u + 0.5 / tenants, y1 + 2), s: pick(r, [WIN_LIT, '#d8ccb0', '#7fae8a'] as const), w: 1.2, o: 0.85 });
    }
    apron('park');
  }
  if (arch === 'lifestyle-center') {
    // the open-air lifestyle center: parapets step bay to bay, an entry tower carries
    // the name, and the landscaping budget was real
    const y1 = Math.min(ht - 1, 6);
    out.push({ k: 'p', pts: patch(bb, br, 0.05, 0.95, 1, y1), f: q >= 110 ? GLASS_HI : GLASS, o: 0.65 });
    const bays = 4;
    for (let i = 0; i < bays; i++) {   // stepped parapet volumes in alternating tones
      const u0 = 0.05 + (i / bays) * 0.90, u1 = u0 + 0.90 / bays;
      const hpar = y1 + 1.2 + ((i % 2 === 0) ? 2.6 : 1.2) + (i === 1 ? 1.2 : 0);
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, y1, Math.min(ht + 2, hpar)), f: pick(r, ['#9a8f78', '#8f9a84', '#a09277', '#8a5340'] as const), o: 0.85 });
    }
    // the entry tower: a taller volume with a lit blade sign
    out.push({ k: 'p', pts: patch(bb, br, 0.42, 0.56, y1, Math.min(ht + 4.5, y1 + 7)), f: pick(r, ['#7a5a3a', '#6e4a44'] as const), o: 0.95 });
    if (p.occ > 0.3) out.push({ k: 'l', ...faceLine(bb, br, 0.45, 0.53, y1 + 4.5), s: WIN_LIT, w: 1.6, o: 0.9, cls: 'twk', dly: r() * 2 });
    // street trees along the walk — the giveaway that rents are higher here
    for (const uu of [0.15, 0.35, 0.65, 0.85]) {
      const c0 = lerp(bb, br, uu);
      out.push({ k: 'c', cx: c0[0] + 2.2, cy: c0[1] + 0.4, r: 1.3, f: '#4e7d40', o: 0.95 });
      out.push({ k: 'l', x1: c0[0] + 2.2, y1: c0[1] + 1.6, x2: c0[0] + 2.2, y2: c0[1] + 0.6, s: '#5a4a36', w: 0.4 });
    }
    apron('park');
  }
  if (arch === 'awning-strip') {
    // striped canvas over every storefront — the sunbelt strip in its Sunday best
    const y1 = Math.min(ht - 1, 5.2);
    out.push({ k: 'p', pts: patch(bb, br, 0.05, 0.95, 1, y1), f: GLASS, o: 0.6 });
    const shops = Math.max(3, Math.min(6, Math.round(p.sf / 2600)));
    const canvases = [['#8a3b3b', '#c9c0ae'], ['#3b5a4a', '#c9c0ae'], ['#3c4a6a', '#c9c0ae'], ['#8a6a30', '#c9c0ae']] as const;
    for (let i = 0; i < shops; i++) {
      const u0 = 0.05 + (i / shops) * 0.90, u1 = 0.05 + ((i + 0.92) / shops) * 0.90;
      const cset = pick(r, canvases);
      const stripes = 4;
      for (let sN = 0; sN < stripes; sN++) {   // alternating canvas stripes, angled out
        const su0 = u0 + (sN / stripes) * (u1 - u0), su1 = u0 + ((sN + 1) / stripes) * (u1 - u0);
        const a0 = lerp(bb, br, su0), a1 = lerp(bb, br, su1);
        out.push({ k: 'p', pts: `${a0[0].toFixed(1)},${(a0[1] - y1).toFixed(1)} ${a1[0].toFixed(1)},${(a1[1] - y1).toFixed(1)} ${(a1[0] + 1.6).toFixed(1)},${(a1[1] - y1 + 2.2).toFixed(1)} ${(a0[0] + 1.6).toFixed(1)},${(a0[1] - y1 + 2.2).toFixed(1)}`, f: cset[sN % 2], o: 0.95 });
      }
      if (r() < p.occ) out.push({ k: 'l', ...faceLine(bb, br, u0 + 0.01, u1 - 0.02, y1 + 3.4), s: WIN_LIT, w: 1.0, o: 0.7 });
    }
    cornice(ht - 1, 0.6);
    apron('park');
  }
  if (arch === 'tower-strip') {
    // the EIFS strip with a corner tower — the sign panel does the advertising
    const y1 = Math.min(ht - 1, 5.4);
    out.push({ k: 'p', pts: patch(bb, br, 0.04, 0.80, 1, y1), f: GLASS, o: 0.6 });
    for (let i = 1; i < 4; i++) {
      const pt = lerp(bb, br, 0.04 + (i / 4) * 0.76);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - y1, s: TRIM, w: 0.4, o: 0.7 });
    }
    out.push({ k: 'l', ...faceLine(bb, br, 0.02, 0.82, y1 + 1.4), s: '#3d434b', w: 1.0, o: 0.9 });   // canopy line
    // the tower: a taller corner volume with a stacked sign
    out.push({ k: 'p', pts: patch(bb, br, 0.82, 0.98, 0.5, Math.min(ht + 5, y1 + 9)), f: pick(r, ['#8a5340', '#7a5a3a', '#4e5a50'] as const), o: 0.95 });
    out.push({ k: 'l', ...faceLine(bb, br, 0.85, 0.95, Math.min(ht + 3.4, y1 + 7.4)), s: p.occ > 0.25 ? WIN_LIT : '#3d434b', w: 1.6, o: 0.9, cls: p.occ > 0.25 ? 'twk' : undefined, dly: r() * 3 });
    out.push({ k: 'l', ...faceLine(bb, br, 0.85, 0.95, Math.min(ht + 1.6, y1 + 5.6)), s: '#c9c0ae', w: 1.0, o: 0.7 });
    const tenants = Math.max(2, Math.min(4, Math.round(p.sf / 3200)));
    for (let i = 0; i < tenants; i++) {
      if (r() > Math.max(0.25, p.occ)) continue;
      const u = 0.07 + (i + 0.2) * 0.7 / tenants;
      out.push({ k: 'l', ...faceLine(bb, br, u, u + 0.45 / tenants, y1 + 2.6), s: pick(r, [WIN_LIT, '#b0654a'] as const), w: 1.2, o: 0.8 });
    }
    apron('park');
  }
  if (arch === 'drive-thru') {
    // the lane is the business: canopy over the window, menu board, cars queued at lunch
    out.push({ k: 'p', pts: patch(bb, br, 0.10, 0.90, 1, Math.min(ht - 1, 5.2)), f: GLASS, o: 0.75 });
    out.push({ k: 'p', pts: patch(bb, br, 0.04, 0.96, Math.min(ht - 1, 5.2), Math.min(ht + 0.5, 7.2)), f: pick(r, ['#7a3b3b', '#8a6a30', '#3b5a4a'] as const), o: 0.9 });
    // canopy off the left face where the pickup window lives
    const c0 = lerp(bl, bb, 0.35), c1 = lerp(bl, bb, 0.75);
    out.push({ k: 'p', pts: `${c0[0].toFixed(1)},${(c0[1] - 5).toFixed(1)} ${c1[0].toFixed(1)},${(c1[1] - 5).toFixed(1)} ${(c1[0] - 3.2).toFixed(1)},${(c1[1] - 4.0).toFixed(1)} ${(c0[0] - 3.2).toFixed(1)},${(c0[1] - 4.0).toFixed(1)}`, f: '#3d434b', s: TRIM, w: 0.4, o: 0.95 });
    out.push({ k: 'l', x1: c0[0] - 2.4, y1: c0[1] - 4.2, x2: c0[0] - 2.4, y2: c0[1], s: '#3c4249', w: 0.7 });
    out.push({ k: 'l', x1: c1[0] - 2.4, y1: c1[1] - 4.2, x2: c1[0] - 2.4, y2: c1[1], s: '#3c4249', w: 0.7 });
    // menu board and the queue
    const mb = lerp(bl, bb, 0.15);
    out.push({ k: 'l', x1: mb[0] - 3, y1: mb[1] + 1, x2: mb[0] - 3, y2: mb[1] - 2.2, s: '#3c4249', w: 0.7 });
    out.push({ k: 'p', pts: `${(mb[0] - 3.9).toFixed(1)},${(mb[1] - 2.2).toFixed(1)} ${(mb[0] - 2.1).toFixed(1)},${(mb[1] - 2.2).toFixed(1)} ${(mb[0] - 2.1).toFixed(1)},${(mb[1] - 3.6).toFixed(1)} ${(mb[0] - 3.9).toFixed(1)},${(mb[1] - 3.6).toFixed(1)}`, f: p.occ > 0.3 ? WIN_LIT : '#3d434b', o: p.occ > 0.3 ? 0.85 : 0.5 });
    if (p.occ > 0.4) for (let i = 0; i < 2; i++) {
      const cq = lerp(bl, bb, 0.3 + i * 0.28);
      out.push({ k: 'p', pts: `${(cq[0] - 4.5).toFixed(1)},${(cq[1] - 0.2).toFixed(1)} ${(cq[0] - 2.3).toFixed(1)},${(cq[1] + 0.9).toFixed(1)} ${(cq[0] - 2.3).toFixed(1)},${(cq[1] - 0.3).toFixed(1)} ${(cq[0] - 4.5).toFixed(1)},${(cq[1] - 1.4).toFixed(1)}`, f: pick(r, ['#5a6570', '#6e5f52', '#5f4a4a'] as const), o: 0.95 });
    }
    if (p.occ > 0.3) out.push({ k: 'l', ...faceLine(bb, br, 0.35, 0.65, Math.min(ht - 0.2, 6.3)), s: WIN_LIT, w: 1.4, o: 0.85, cls: 'twk', dly: r() * 3 });
    apron('park');
  }
  if (arch === 'bank-pad') {
    // the branch bank: columns, a formal entry, a drive-up canopy off the side —
    // built to say your money is safe here
    for (const uu of [0.22, 0.40, 0.60, 0.78]) {   // columns with capital ticks
      const pt = lerp(bb, br, uu);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 0.8, x2: pt[0], y2: pt[1] - (ht - 2.4), s: tint, w: 1.3, o: 0.95 });
      out.push({ k: 'l', x1: pt[0] - 0.8, y1: pt[1] - (ht - 2.4), x2: pt[0] + 0.8, y2: pt[1] - (ht - 2.4), s: tint, w: 0.7, o: 0.9 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.44, 0.56, 0.5, Math.min(ht - 3, 5)), f: '#1c232b', s: TRIM, w: 0.4 });   // tall entry
    // shallow pediment over the entry
    const pd0 = lerp(bb, br, 0.34), pd1 = lerp(bb, br, 0.66), pdm = lerp(bb, br, 0.5);
    out.push({ k: 'p', pts: `${pd0[0].toFixed(1)},${(pd0[1] - ht + 2).toFixed(1)} ${pd1[0].toFixed(1)},${(pd1[1] - ht + 2).toFixed(1)} ${pdm[0].toFixed(1)},${(pdm[1] - ht - 1.4).toFixed(1)}`, f: tint, s: TRIM, w: 0.4, o: 0.95 });
    // drive-up canopy off the left face: flat roof on thin posts over the teller lanes
    const dc0 = lerp(bl, bb, 0.25), dc1 = lerp(bl, bb, 0.7);
    out.push({ k: 'p', pts: `${dc0[0].toFixed(1)},${(dc0[1] - 6).toFixed(1)} ${dc1[0].toFixed(1)},${(dc1[1] - 6).toFixed(1)} ${(dc1[0] - 4).toFixed(1)},${(dc1[1] - 4.8).toFixed(1)} ${(dc0[0] - 4).toFixed(1)},${(dc0[1] - 4.8).toFixed(1)}`, f: '#4a5058', s: TRIM, w: 0.4, o: 0.95 });
    for (const uu of [0.3, 0.65]) {
      const pt = lerp(bl, bb, uu);
      out.push({ k: 'l', x1: pt[0] - 3.2, y1: pt[1] - 5.1, x2: pt[0] - 3.2, y2: pt[1], s: '#3c4249', w: 0.6 });
    }
    cornice(ht - 1.6, 0.9);
    if (p.occ > 0.25) out.push({ k: 'l', ...faceLine(bb, br, 0.40, 0.60, ht - 3.4), s: WIN_LIT, w: 1.1, o: 0.7 });
    apron('park');
  }

  // ================= OFFICE, second wave =================
  if (arch === 'ribbon-slab') {
    // the mid-century slab: unbroken horizontal ribbons of glass between spandrel
    // bands, heavy end piers — filing cabinets never looked so confident
    const rows = Math.min(floors, 9);
    const rowStep = (ht - 5) / Math.max(1, rows);
    for (let fl = 0; fl < rows; fl++) {
      const y0 = 2.5 + fl * rowStep;
      const lit = r() < p.occ * 0.5;
      out.push({ k: 'p', pts: patch(bb, br, 0.10, 0.90, y0, y0 + Math.min(2.6, rowStep * 0.55)), f: lit ? WIN_LIT : GLASS, o: lit ? 0.5 : 0.6, cls: lit && r() < 0.3 ? 'twk' : undefined, dly: lit ? r() * 4 : undefined });
      out.push({ k: 'p', pts: patch(bl, bb, 0.14, 0.86, y0, y0 + Math.min(2.6, rowStep * 0.55)), f: GLASS, o: 0.35 });
    }
    for (const uu of [0.05, 0.95]) {   // end piers carry the whole composition
      const pt = lerp(bb, br, uu);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 0.8, x2: pt[0], y2: pt[1] - (ht - 0.8), s: tint, w: 1.6, o: 0.9 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.30, 0.70, 0.5, 2.2), f: '#1c232b', o: 0.8 });   // recessed lobby
    rooftopBox(0.38, 0.56, 2.2);
  }
  if (arch === 'crown-tower') {
    // the trophy tower: curtain wall to the sky, then a set-back crown that stays lit —
    // the one on the postcard
    const glass = GLASS_HI;
    for (let i = 0; i < 4; i++) {
      const u0 = 0.08 + (i / 4) * 0.80, u1 = u0 + 0.80 / 4 * 0.66;
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, 2, ht - 2), f: glass, o: 0.55 });
    }
    out.push({ k: 'p', pts: patch(bb, br, 0.86, 0.97, 1, ht - 1), f: glass, o: 0.75 });   // corner glass accent runs brighter
    out.push({ k: 'p', pts: patch(bl, bb, 0.15, 0.85, 2, ht - 2), f: glass, o: 0.3 });
    for (let fl = 1; fl < Math.min(floors, 12); fl++) {
      out.push({ k: 'l', ...faceLine(bb, br, 0.05, 0.95, fl * fh), s: TRIM, w: 0.4, o: 0.45 });
    }
    for (let fl = 0; fl < Math.min(floors, 12); fl++) {
      if (r() < p.occ * 0.32) out.push({ k: 'l', ...faceLine(bb, br, 0.12, 0.45 + r() * 0.4, fl * fh + fh * 0.45), s: WIN_LIT, w: 1.0, o: 0.5 });
    }
    // the crown: two setbacks and a lit band under the top one
    rooftopBox(0.28, 0.72, 3.4, tint); rooftopBox(0.38, 0.62, 6.4, tint);
    if (p.occ > 0.3) {
      const cr0 = lerp(bb, br, 0.38), cr1 = lerp(bb, br, 0.62);
      out.push({ k: 'l', x1: cr0[0], y1: cr0[1] - ht - 5.6, x2: cr1[0], y2: cr1[1] - ht - 5.6, s: WIN_LIT, w: 1.3, o: 0.85, cls: 'twk', dly: r() * 2 });
    }
    const a0 = lerp(lerp(bb, br, 0.5), tl, 0.4);
    out.push({ k: 'l', x1: a0[0], y1: a0[1] - ht - 6.4, x2: a0[0], y2: a0[1] - ht - 13, s: '#39434e', w: 0.6 });
    out.push({ k: 'c', cx: a0[0], cy: a0[1] - ht - 13, r: 0.7, f: '#b04a3a', o: 0.9, cls: 'twk', dly: 1.2 });
  }
  if (arch === 'stone-base') {
    // the civic block: two rusticated stories, an arched entry, tall windows above,
    // a dentil cornice — banks built these when banks built things
    const baseH = Math.min(ht * 0.32, 8);
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, 0.5, baseH), f: tint, o: 0.55 });
    for (let i = 1; i < 4; i++) {   // rustication joints
      out.push({ k: 'l', ...faceLine(bb, br, 0.03, 0.97, (baseH / 4) * i), s: '#241a14', w: 0.35, o: 0.55 });
    }
    // arched entry cut into the stone
    const e0 = lerp(bb, br, 0.42), e1 = lerp(bb, br, 0.58), em = lerp(bb, br, 0.5);
    out.push({ k: 'p', pts: `${e0[0].toFixed(1)},${(e0[1] - 0.5).toFixed(1)} ${e1[0].toFixed(1)},${(e1[1] - 0.5).toFixed(1)} ${e1[0].toFixed(1)},${(e1[1] - baseH * 0.6).toFixed(1)} ${em[0].toFixed(1)},${(em[1] - baseH * 0.85).toFixed(1)} ${e0[0].toFixed(1)},${(e0[1] - baseH * 0.6).toFixed(1)}`, f: '#1c232b', s: TRIM, w: 0.4 });
    grid(bb, br, 4, baseH / ht + 0.03, true, true);
    cornice(baseH + 0.4, 0.7);
    out.push({ k: 'l', ...faceLine(bb, br, 0.03, 0.97, ht - 1.6), s: '#1c2126', w: 1.1, o: 0.9 });
    out.push({ k: 'l', ...faceLine(bb, br, 0.05, 0.95, ht - 2.6), s: '#241a14', w: 0.5, o: 0.7, d: '1 1.2' });   // dentils
    if (p.occ > 0.4) out.push({ k: 'l', ...faceLine(bb, br, 0.44, 0.56, baseH * 0.5), s: WIN_LIT, w: 1.0, o: 0.7 });
  }
  if (arch === 'courtyard-brick') {
    // paired window bays around a recessed light court — the pre-war office that
    // wanted every desk near a window
    const ctr0 = 0.42, ctr1 = 0.58;
    out.push({ k: 'p', pts: patch(bb, br, ctr0, ctr1, 2, ht - 2), f: '#1a1510', o: 0.4 });   // the court reads as shadow
    // window grids on each wing
    const rows = Math.min(floors, 7);
    const rowStep = (ht - 5) / Math.max(1, rows);
    for (let fl = 0; fl < rows; fl++) {
      for (const [w0, w1] of [[0.08, ctr0 - 0.03], [ctr1 + 0.03, 0.92]] as const) {
        for (let c = 0; c < 2; c++) {
          const u0 = w0 + (c / 2) * (w1 - w0), u1 = u0 + (w1 - w0) / 2 * 0.6;
          const y0 = 2.5 + fl * rowStep, y1 = y0 + Math.min(3.4, rowStep * 0.6);
          const lit = r() < p.occ * 0.5;
          out.push({ k: 'p', pts: patch(bb, br, u0, u1, y0, y1), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.75, cls: lit && r() < 0.25 ? 'twk' : undefined, dly: lit ? r() * 4 : undefined });
        }
      }
    }
    for (let fl = 2; fl < rows; fl += 2) {   // string courses
      out.push({ k: 'l', ...faceLine(bb, br, 0.05, 0.95, 2.5 + fl * rowStep - 0.8), s: '#241a14', w: 0.5, o: 0.6 });
    }
    cornice(ht - 1.2, 1.0);
    if (p.age > 22 && r() < 0.5) waterTower();
  }
  if (arch === 'porch-office') {
    // the converted house with the full porch: posts, a swing-height rail, a gable
    // over everything, and a hanging shingle — hours by appointment
    for (let i = 1; i < Math.min(ht - 2, 8); i++) {
      out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.96, i * 1.15), s: TRIM, w: 0.25, o: 0.35 });
    }
    // porch: roof line and posts across the whole front
    out.push({ k: 'l', ...faceLine(bb, br, 0.02, 0.98, 4.6), s: '#3a3229', w: 1.1, o: 0.95 });
    for (const uu of [0.08, 0.32, 0.56, 0.80]) {
      const pt = lerp(bb, br, uu);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 0.5, x2: pt[0], y2: pt[1] - 4.4, s: '#4a4036', w: 0.8 });
    }
    out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.96, 1.8), s: '#4a4036', w: 0.5, o: 0.8 });   // rail
    grid(bb, br, 3, 0.42, true, true);
    out.push({ k: 'p', pts: patch(bb, br, 0.44, 0.56, 0.5, 4.2), f: '#241d16', s: TRIM, w: 0.3 });
    // steep gable
    const r0 = lerp(bl, bb, 0.5), r1 = lerp(bb, br, 0.5);
    const ridge0: [number, number] = [(bl[0] + r1[0]) / 2, (bl[1] + r1[1]) / 2 - ht - 4.2];
    const ridge1: [number, number] = [(br[0] + r0[0]) / 2, (br[1] + r0[1]) / 2 - ht - 4.2];
    out.push({ k: 'p', pts: `${fmt([bb[0], bb[1] - ht])} ${fmt([br[0], br[1] - ht])} ${fmt(ridge1)} ${fmt(ridge0)}`, f: pick(r, ['#3a3d44', '#4a3a32', '#37413a'] as const), s: TRIM, w: 0.4 });
    out.push({ k: 'p', pts: `${fmt([bl[0], bl[1] - ht])} ${fmt([bb[0], bb[1] - ht])} ${fmt(ridge0)}`, f: '#2c2f36', s: TRIM, w: 0.4 });
    // the shingle out front, lit when someone's practicing
    const sg = lerp(bb, br, 0.92);
    out.push({ k: 'l', x1: sg[0] + 2.6, y1: sg[1] + 1.4, x2: sg[0] + 2.6, y2: sg[1] - 1.8, s: '#4a4036', w: 0.6 });
    out.push({ k: 'p', pts: `${(sg[0] + 1.8).toFixed(1)},${(sg[1] - 1.8).toFixed(1)} ${(sg[0] + 3.4).toFixed(1)},${(sg[1] - 1.8).toFixed(1)} ${(sg[0] + 3.4).toFixed(1)},${(sg[1] - 3).toFixed(1)} ${(sg[0] + 1.8).toFixed(1)},${(sg[1] - 3).toFixed(1)}`, f: p.occ > 0.3 ? WIN_LIT : '#3d434b', o: p.occ > 0.3 ? 0.8 : 0.5 });
  }
  if (arch === 'stucco-court') {
    // the two-story garden office: exterior stair, gallery rail, a door per suite —
    // your accountant is up the stairs on the left
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, 0.5, 2), f: '#8f8574', o: 0.4 });   // base course
    const mid = ht * 0.52;
    out.push({ k: 'l', ...faceLine(bb, br, 0.10, 0.98, mid), s: '#4a5058', w: 1.0, o: 0.95 });      // gallery deck
    out.push({ k: 'l', ...faceLine(bb, br, 0.10, 0.98, mid + 1.6), s: '#4a5058', w: 0.4, o: 0.8, d: '1.2 1.2' });  // rail
    // exterior stair up the left end
    const st0 = lerp(bb, br, 0.02), st1 = lerp(bb, br, 0.12);
    out.push({ k: 'l', x1: st0[0], y1: st0[1] - 0.5, x2: st1[0], y2: st1[1] - mid, s: '#4a5058', w: 1.1 });
    out.push({ k: 'l', x1: st0[0], y1: st0[1] - 2.1, x2: st1[0], y2: st1[1] - mid - 1.6, s: '#4a5058', w: 0.4, o: 0.8 });
    // suite doors and windows on both levels
    for (const lv of [0.5, mid + 0.5]) {
      for (let i = 0; i < 3; i++) {
        const u = 0.2 + i * 0.26;
        out.push({ k: 'p', pts: patch(bb, br, u, u + 0.05, lv, lv + 3.4), f: '#241d16', s: TRIM, w: 0.3 });
        const lit = r() < p.occ * 0.6;
        out.push({ k: 'p', pts: patch(bb, br, u + 0.09, u + 0.18, lv + 0.6, lv + 3), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.7 });
      }
    }
    out.push({ k: 'l', ...faceLine(bb, br, 0.02, 0.98, ht - 0.8), s: '#7a4a34', w: 1.2, o: 0.8 });  // tile coping
    for (const uu of [0.3, 0.7]) {   // planters by the doors
      const c0 = lerp(bb, br, uu);
      out.push({ k: 'c', cx: c0[0] + 1.4, cy: c0[1] + 0.5, r: 0.9, f: '#4e7d40', o: 0.9 });
    }
  }

  // ================= MIXED, second wave =================
  if (arch === 'flatiron-corner') {
    // the corner building that knows it's on a corner: heavy quoined piers flank the
    // prow, the entry cuts the corner itself, and the cornice wraps both streets
    out.push({ k: 'p', pts: patch(bb, br, 0.0, 0.10, 1, ht - 1), f: tint, o: 0.5 });   // corner pier, lit face
    out.push({ k: 'p', pts: patch(bl, bb, 0.90, 1.0, 1, ht - 1), f: tint, o: 0.35 });  // corner pier, shade face
    for (let i = 0; i < 3; i++) {   // quoin ticks up the prow
      out.push({ k: 'l', ...faceLine(bb, br, 0.01, 0.09, ht * 0.25 * (i + 1)), s: '#241a14', w: 0.5, o: 0.7 });
    }
    // corner entry: a dark cut with a lit transom right at the prow
    out.push({ k: 'p', pts: patch(bb, br, 0.0, 0.07, 0.5, 5), f: '#1c232b', s: TRIM, w: 0.4 });
    if (p.occ > 0.3) out.push({ k: 'l', ...faceLine(bb, br, 0.0, 0.07, 5.5), s: WIN_LIT, w: 1.1, o: 0.85 });
    grid(bb, br, 4, 0.30, true);
    cornice(ht - 1.4, 1.0);
    cornice(ht * 0.28, 0.6);
    // flagpole on the prow — every flatiron has one
    const fp: [number, number] = [bb[0], bb[1] - ht];
    out.push({ k: 'l', x1: fp[0], y1: fp[1], x2: fp[0], y2: fp[1] - 7, s: '#39434e', w: 0.6 });
    out.push({ k: 'p', pts: `${fp[0].toFixed(1)},${(fp[1] - 7).toFixed(1)} ${(fp[0] + 3).toFixed(1)},${(fp[1] - 6.4).toFixed(1)} ${fp[0].toFixed(1)},${(fp[1] - 5.8).toFixed(1)}`, f: '#8a3b3b', o: 0.9 });
  }
  if (arch === 'market-hall') {
    // the market hall: a double-height glazed hall with arched bays at street level,
    // apartments over the stalls, banners when the market is trading
    const hallH = Math.min(ht * 0.42, 10);
    out.push({ k: 'p', pts: patch(bb, br, 0.05, 0.95, 1, hallH), f: q >= 105 ? GLASS_HI : GLASS, o: 0.7 });
    const bays = 4;
    for (let i = 0; i <= bays; i++) {
      const u = 0.05 + (i / bays) * 0.90;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - hallH, s: tint, w: 1.0, o: 0.9 });
      if (i < bays) {   // arch across each bay head
        const mid = lerp(bb, br, u + 0.45 / bays);
        out.push({ k: 'l', x1: pt[0], y1: pt[1] - hallH + 1.2, x2: mid[0], y2: mid[1] - hallH - 0.4, s: tint, w: 0.7, o: 0.85 });
        const nxt = lerp(bb, br, 0.05 + ((i + 1) / bays) * 0.90);
        out.push({ k: 'l', x1: mid[0], y1: mid[1] - hallH - 0.4, x2: nxt[0], y2: nxt[1] - hallH + 1.2, s: tint, w: 0.7, o: 0.85 });
      }
    }
    // market banners between the arches when the stalls are leased
    if (p.occ > 0.35) for (let i = 0; i < bays; i++) {
      if (r() > p.occ) continue;
      const u = 0.05 + (i + 0.5) * 0.90 / bays;
      const pt = lerp(bb, br, u);
      out.push({ k: 'p', pts: `${(pt[0] - 0.7).toFixed(1)},${(pt[1] - hallH + 2).toFixed(1)} ${(pt[0] + 0.7).toFixed(1)},${(pt[1] - hallH + 2).toFixed(1)} ${(pt[0] + 0.7).toFixed(1)},${(pt[1] - hallH + 5).toFixed(1)} ${pt[0].toFixed(1)},${(pt[1] - hallH + 6).toFixed(1)} ${(pt[0] - 0.7).toFixed(1)},${(pt[1] - hallH + 5).toFixed(1)}`, f: pick(r, ['#8a3b3b', '#3b5a4a', '#8a6a30', '#3c4a6a'] as const), o: 0.9 });
    }
    grid(bb, br, 4, hallH / ht + 0.06, true);
    out.push({ k: 'l', ...faceLine(bb, br, 0.03, 0.97, hallH + 0.5), s: '#1c2126', w: 0.9, o: 0.9 });
    cornice(ht - 1.2, 0.8);
  }

  // ================= MULTIFAMILY, second wave =================
  if (arch === 'courtyard-garden') {
    // two gabled wings around a planted court — the leasing agent calls it a mews
    for (const [w0, w1] of [[0.02, 0.36], [0.64, 0.98]] as const) {
      // wing gable: a small ridge over each wing
      const g0 = lerp(bb, br, w0), g1 = lerp(bb, br, w1), gm = lerp(bb, br, (w0 + w1) / 2);
      out.push({ k: 'p', pts: `${g0[0].toFixed(1)},${(g0[1] - ht).toFixed(1)} ${g1[0].toFixed(1)},${(g1[1] - ht).toFixed(1)} ${gm[0].toFixed(1)},${(gm[1] - ht - 2.8).toFixed(1)}`, f: pick(r, ['#3a2f2a', '#2c3530', '#2e3038'] as const), s: TRIM, w: 0.35 });
      // wing windows, two floors
      for (let fl = 0; fl < 2; fl++) {
        for (let c = 0; c < 2; c++) {
          const u0 = w0 + 0.05 + c * 0.14, y0 = 1.5 + fl * (ht / 2.3);
          const lit = r() < p.occ * 0.55;
          out.push({ k: 'p', pts: patch(bb, br, u0, u0 + 0.09, y0, y0 + 2.6), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.7 });
        }
      }
      out.push({ k: 'p', pts: patch(bb, br, (w0 + w1) / 2 - 0.03, (w0 + w1) / 2 + 0.03, 0.5, 3.6), f: '#241d16', s: TRIM, w: 0.3 });
    }
    // the court between: green, a path, shrubs
    out.push({ k: 'p', pts: patch(bb, br, 0.38, 0.62, 0.2, Math.min(ht * 0.5, 6)), f: '#4e6c40', o: 0.5 });
    const pth = lerp(bb, br, 0.5);
    out.push({ k: 'l', x1: pth[0], y1: pth[1], x2: pth[0], y2: pth[1] - Math.min(ht * 0.45, 5.4), s: '#a89a80', w: 0.8, o: 0.8 });
    for (const uu of [0.42, 0.58]) {
      const c0 = lerp(bb, br, uu);
      out.push({ k: 'c', cx: c0[0], cy: c0[1] - 1.6, r: 1.0, f: '#4e7d40', o: 0.95 });
    }
  }
  if (arch === 'townhome-row') {
    // the fee-simple row: gable after gable, a stoop and a painted panel each —
    // same house four times, four different colors
    const units = Math.max(3, Math.min(5, Math.round(ht / 6.5)));
    const cols = ['#8a5340', '#5c6a52', '#4e5a72', '#8a6a4a', '#6e4a44'] as const;
    for (let i = 0; i < units; i++) {
      const u0 = 0.04 + (i / units) * 0.92, u1 = 0.04 + ((i + 1) / units) * 0.92;
      // per-unit painted panel
      out.push({ k: 'p', pts: patch(bb, br, u0 + 0.008, u1 - 0.008, 1, ht - 1), f: cols[(i + Math.floor(r() * 5)) % 5], o: 0.4 });
      // gable peak above each unit
      const g0 = lerp(bb, br, u0), g1 = lerp(bb, br, u1), gm = lerp(bb, br, (u0 + u1) / 2);
      out.push({ k: 'p', pts: `${g0[0].toFixed(1)},${(g0[1] - ht).toFixed(1)} ${g1[0].toFixed(1)},${(g1[1] - ht).toFixed(1)} ${gm[0].toFixed(1)},${(gm[1] - ht - 2.4).toFixed(1)}`, f: '#33353c', s: TRIM, w: 0.35 });
      // door + stoop + one window per floor
      const du = (u0 + u1) / 2;
      out.push({ k: 'p', pts: patch(bb, br, du - 0.025, du + 0.025, 0.8, 3.8), f: '#241d16', s: TRIM, w: 0.3 });
      out.push({ k: 'l', ...faceLine(bb, br, du - 0.05, du + 0.05, 0.6), s: '#3d3229', w: 0.8, o: 0.9 });
      for (let fl = 0; fl < 2; fl++) {
        const lit = r() < p.occ * 0.55;
        out.push({ k: 'p', pts: patch(bb, br, du - 0.09 + (fl === 0 ? -0.02 : 0), du - 0.03 + (fl === 0 ? -0.02 : 0), 2 + fl * (ht * 0.42), 4.2 + fl * (ht * 0.42)), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.7 });
      }
    }
  }
  if (arch === 'bay-midrise') {
    // projecting bay stacks: three vertical bays stand proud of the wall, windows
    // wrap them — the San Francisco trick for stealing light
    out.push({ k: 'p', pts: patch(bb, br, 0.04, 0.96, 0.5, Math.min(ht * 0.14, 4.5)), f: '#4a5058', o: 0.5 });   // base
    for (const uu of [0.18, 0.46, 0.74]) {
      // the bay: a lighter panel with hard edges, windows inside
      out.push({ k: 'p', pts: patch(bb, br, uu, uu + 0.16, Math.min(ht * 0.14, 4.5), ht - 2), f: tint, o: 0.45 });
      const e0 = lerp(bb, br, uu), e1 = lerp(bb, br, uu + 0.16);
      out.push({ k: 'l', x1: e0[0], y1: e0[1] - Math.min(ht * 0.14, 4.5), x2: e0[0], y2: e0[1] - (ht - 2), s: '#1c2126', w: 0.7, o: 0.8 });
      out.push({ k: 'l', x1: e1[0], y1: e1[1] - Math.min(ht * 0.14, 4.5), x2: e1[0], y2: e1[1] - (ht - 2), s: '#1c2126', w: 0.7, o: 0.8 });
      const rows = Math.min(floors - 1, 7);
      const rowStep = (ht - Math.min(ht * 0.14, 4.5) - 4) / Math.max(1, rows);
      for (let fl = 0; fl < rows; fl++) {
        const y0 = Math.min(ht * 0.14, 4.5) + 1.5 + fl * rowStep;
        const lit = r() < p.occ * 0.5;
        out.push({ k: 'p', pts: patch(bb, br, uu + 0.03, uu + 0.13, y0, y0 + Math.min(2.6, rowStep * 0.6)), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.75, cls: lit && r() < 0.25 ? 'twk' : undefined, dly: lit ? r() * 4 : undefined });
      }
    }
    cornice(ht - 1.4, 1.0);
  }
  if (arch === 'gallery-midrise') {
    // open-gallery apartments: the walkway IS the corridor — railings every floor,
    // a stair tower bookending the run, doors straight to the outside
    const rows = Math.min(floors, 6);
    const rowStep = (ht - 4) / Math.max(1, rows);
    for (let fl = 1; fl <= rows; fl++) {
      const y = 1.5 + fl * rowStep;
      out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.82, y), s: '#4a5058', w: 1.0, o: 0.95 });
      out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.82, y + 1.4), s: '#4a5058', w: 0.35, o: 0.75, d: '1 1.1' });
    }
    // doors and kitchen windows along each gallery
    for (let fl = 0; fl < rows; fl++) {
      for (let i = 0; i < 3; i++) {
        const u = 0.10 + i * 0.24;
        const y0 = 2.2 + fl * rowStep;
        out.push({ k: 'p', pts: patch(bb, br, u, u + 0.035, y0, y0 + Math.min(3, rowStep * 0.7)), f: '#241d16', o: 0.85 });
        const lit = r() < p.occ * 0.55;
        out.push({ k: 'p', pts: patch(bb, br, u + 0.06, u + 0.13, y0 + 0.4, y0 + Math.min(2.6, rowStep * 0.55)), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.7 });
      }
    }
    // the stair tower: a solid vertical volume past the gallery end
    out.push({ k: 'p', pts: patch(bb, br, 0.86, 0.98, 0.5, ht - 0.5), f: pick(r, ['#8a5340', '#4e5a50', '#5c5248'] as const), o: 0.7 });
    const z0 = lerp(bb, br, 0.88), z1 = lerp(bb, br, 0.96);
    for (let fl = 0; fl < rows; fl++) {   // zigzag stair reads through
      const ya = 2 + fl * rowStep, yb = 2 + (fl + 1) * rowStep;
      out.push({ k: 'l', x1: z0[0], y1: z0[1] - ya, x2: z1[0], y2: z1[1] - yb, s: '#33383e', w: 0.5, o: 0.8 });
    }
  }
  if (arch === 'point-tower') {
    // the point tower: a slim glass shaft with balcony ribs trading sides, standing
    // on a two-story townhouse base that meets the street politely
    const baseH = Math.min(ht * 0.16, 7);
    out.push({ k: 'p', pts: patch(bb, br, 0.02, 0.98, 0.5, baseH), f: pick(r, ['#8a5340', '#5c5248'] as const), o: 0.55 });   // townhouse base
    for (let i = 0; i < 3; i++) {
      out.push({ k: 'p', pts: patch(bb, br, 0.12 + i * 0.28, 0.155 + i * 0.28, 0.8, baseH * 0.62), f: '#241d16', s: TRIM, w: 0.3 });
    }
    // the shaft: two tall glass strips
    for (const [u0, u1] of [[0.16, 0.44], [0.56, 0.84]] as const) {
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, baseH + 1, ht - 1.5), f: GLASS_HI, o: 0.6 });
    }
    // balcony ribs alternate sides floor by floor
    const rows = Math.min(floors - 2, 11);
    const rowStep = (ht - baseH - 4) / Math.max(1, rows);
    for (let fl = 0; fl < rows; fl++) {
      const y = baseH + 2 + fl * rowStep;
      const side = fl % 2 === 0 ? [0.14, 0.46] : [0.54, 0.86];
      out.push({ k: 'l', ...faceLine(bb, br, side[0], side[1], y), s: '#3a424c', w: 0.9, o: 0.85 });
      if (r() < p.occ * 0.4) out.push({ k: 'l', ...faceLine(bb, br, side[0] + 0.04, side[0] + 0.16, y + rowStep * 0.4), s: WIN_LIT, w: 1.0, o: 0.6 });
    }
    out.push({ k: 'l', ...faceLine(bb, br, 0.02, 0.98, baseH + 0.4), s: '#1c2126', w: 0.9, o: 0.9 });
    // slender roof spire with a beacon
    const sp = lerp(lerp(bb, br, 0.5), tl, 0.35);
    out.push({ k: 'l', x1: sp[0], y1: sp[1] - ht, x2: sp[0], y2: sp[1] - ht - 6.5, s: '#39434e', w: 0.5 });
    out.push({ k: 'c', cx: sp[0], cy: sp[1] - ht - 6.5, r: 0.6, f: '#b04a3a', o: 0.9, cls: 'twk', dly: 0.8 });
  }
  if (arch === 'terrace-tower') {
    // the wedding cake: the tower steps back twice and every step grows a planted
    // terrace — the penthouse pays for the landscaping
    grid(bb, br, 4, 0.05, true);
    for (let fl = 1; fl < Math.min(floors, 10); fl++) {
      out.push({ k: 'l', ...faceLine(bl, bb, 0.15, 0.85, fl * fh), s: '#3a424c', w: 0.8, o: 0.7 });
    }
    // setbacks with planting on each shoulder
    rooftopBox(0.24, 0.76, 3.0, tint);
    rooftopBox(0.36, 0.64, 5.8, tint);
    for (const [u0, u1, hh] of [[0.24, 0.34, 0.4], [0.66, 0.76, 0.4], [0.36, 0.44, 3.4], [0.56, 0.64, 3.4]] as const) {
      const t0 = lerp(bb, br, u0), t1 = lerp(bb, br, u1);
      out.push({ k: 'l', x1: t0[0], y1: t0[1] - ht - hh, x2: t1[0], y2: t1[1] - ht - hh, s: '#3f5a46', w: 1.4, o: 0.9 });
    }
    // lit penthouse band under the top step
    if (p.occ > 0.35) {
      const ph0 = lerp(bb, br, 0.38), ph1 = lerp(bb, br, 0.62);
      out.push({ k: 'l', x1: ph0[0], y1: ph0[1] - ht - 5.0, x2: ph1[0], y2: ph1[1] - ht - 5.0, s: WIN_LIT, w: 1.2, o: 0.85, cls: 'twk', dly: r() * 2 });
    }
    out.push({ k: 'l', ...faceLine(bb, br, 0.04, 0.96, ht - 0.8), s: '#3f5a46', w: 1.2, o: 0.7 });   // roof-line planting
  }

  // ================= micro-detail passes: every building, every roof =================
  // Rooftop clutter: real flat roofs are a mess of RTUs, vents, and hatches. Gabled
  // and ridged archetypes keep their clean rooflines.
  const GABLED = new Set<Archetype>(['garden-walkup', 'wood-office', 'porch-office', 'courtyard-garden', 'townhome-row', 'quonset', 'sawtooth', 'pemb', 'twin-gable']);
  if (!GABLED.has(arch) && ht > 8) {
    const nV = Math.min(5, 1 + Math.floor(p.sf / 18000) + (p.age > 25 ? 1 : 0));
    for (let i = 0; i < nV; i++) {
      const c0 = lerp(lerp(bb, br, 0.15 + r() * 0.68), tl, 0.12 + r() * 0.45);
      if (r() < 0.45) {   // mushroom vent
        out.push({ k: 'c', cx: c0[0], cy: c0[1] - ht - 0.4, r: 0.5 + r() * 0.4, f: '#4e565e', o: 0.9 });
      } else {            // a small RTU with its shadow edge
        out.push({ k: 'p', pts: `${(c0[0] - 1.1).toFixed(1)},${(c0[1] - ht).toFixed(1)} ${(c0[0] + 1.1).toFixed(1)},${(c0[1] - ht).toFixed(1)} ${(c0[0] + 1.1).toFixed(1)},${(c0[1] - ht - 1.1).toFixed(1)} ${(c0[0] - 1.1).toFixed(1)},${(c0[1] - ht - 1.1).toFixed(1)}`, f: '#454c54', s: TRIM, w: 0.3 });
      }
    }
    if (p.age > 18 && r() < 0.35) {   // the satellite dish nobody removed
      const d0 = lerp(lerp(bb, br, 0.82), tl, 0.15);
      out.push({ k: 'l', x1: d0[0], y1: d0[1] - ht, x2: d0[0], y2: d0[1] - ht - 0.8, s: '#4e565e', w: 0.4 });
      out.push({ k: 'c', cx: d0[0] + 0.3, cy: d0[1] - ht - 1.0, r: 0.7, f: '#c8cdd2', o: 0.9 });
    }
  }
  // Fire escapes: the pre-war brick wears its exit stairs on the outside
  if ((arch === 'brick-loft' || arch === 'brownstone-row' || arch === 'courtyard-brick') && p.age > 30 && ht > 12) {
    const u0 = 0.60, u1 = 0.76;
    const zRows = Math.min(floors - 1, 5);
    const step = (ht - 7) / Math.max(1, zRows);
    const a1 = lerp(bb, br, u0), b1 = lerp(bb, br, u1);
    for (let fl = 0; fl < zRows; fl++) {
      const ya = 4.5 + fl * step;
      out.push({ k: 'l', x1: a1[0], y1: a1[1] - ya, x2: b1[0], y2: b1[1] - ya, s: '#1a1d21', w: 0.5, o: 0.8 });
      out.push({ k: 'l', x1: fl % 2 ? a1[0] : b1[0], y1: (fl % 2 ? a1[1] : b1[1]) - ya, x2: fl % 2 ? b1[0] : a1[0], y2: (fl % 2 ? b1[1] : a1[1]) - ya - step, s: '#1a1d21', w: 0.4, o: 0.7 });
    }
    out.push({ k: 'l', x1: a1[0], y1: a1[1] - 4.5, x2: a1[0], y2: a1[1] - 4.5 - zRows * step, s: '#1a1d21', w: 0.35, o: 0.6 });
    out.push({ k: 'l', x1: b1[0], y1: b1[1] - 4.5, x2: b1[0], y2: b1[1] - 4.5 - zRows * step, s: '#1a1d21', w: 0.35, o: 0.6 });
  }
  // Window AC units: old workforce housing cools itself one window at a time
  if ((p.type === 'multifamily' || p.type === 'mixed') && p.age > 25 && q < 85 && !GABLED.has(arch)) {
    const nAC = 2 + Math.floor(r() * 3);
    for (let i = 0; i < nAC; i++) {
      const u = 0.15 + r() * 0.68, y = 3 + r() * Math.max(2, ht - 7);
      out.push({ k: 'p', pts: patch(bb, br, u, u + 0.035, y, y + 0.9), f: '#c8cdd2', o: 0.85 });
    }
  }
  // Blade signs: occupied street retail hangs its name out over the sidewalk
  if ((arch === 'storefront-row' || arch === 'main-street' || arch === 'market-hall') && p.occ > 0.4) {
    for (let i = 0; i < 2; i++) {
      if (r() > p.occ) continue;
      const u = 0.22 + i * 0.42 + r() * 0.1;
      const s0 = lerp(bb, br, u);
      out.push({ k: 'l', x1: s0[0], y1: s0[1] - 7.6, x2: s0[0] + 1.6, y2: s0[1] - 7.3, s: '#3c4249', w: 0.4 });
      out.push({ k: 'p', pts: `${(s0[0] + 0.9).toFixed(1)},${(s0[1] - 7.5).toFixed(1)} ${(s0[0] + 2.2).toFixed(1)},${(s0[1] - 7.2).toFixed(1)} ${(s0[0] + 2.2).toFixed(1)},${(s0[1] - 5.5).toFixed(1)} ${(s0[0] + 0.9).toFixed(1)},${(s0[1] - 5.8).toFixed(1)}`, f: pick(r, ['#8a3b3b', '#3b5a4a', '#3c4a6a', '#8a6a30'] as const), o: 0.95, cls: r() < 0.4 ? 'twk' : undefined, dly: r() * 3 });
    }
  }

  // ---- weathering: old buildings streak; poor ones streak more ----
  const streaks = p.age > 30 ? (q < 68 ? 3 : q < 98 ? 2 : 1) : p.age > 18 && q < 75 ? 1 : 0;
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
