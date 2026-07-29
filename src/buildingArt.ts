// Procedural building facades. Pure module: no React, no engine, no DOM — takes a
// params object and projected prism geometry, returns element descriptors the renderer
// maps to SVG. Everything is derived from data the engine already tracks: floors from
// square footage, glazing from construction type, dock doors for industrial,
// storefronts for retail, balconies for apartments, window density from quality,
// rooftop clutter from age, lit windows from occupancy. Nothing is hand-drawn.
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

const WIN_DARK = '#10151b';    // unlit glazing
const WIN_LIT = '#c9a04f';     // lamps on inside
const GLASS = '#3a4a5c';       // curtain-wall band
const TRIM = '#0b0f13';

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

// a parallelogram patch on a face: u along base edge a->b, v upward (negative y)
function patch(a: [number, number], b: [number, number], u0: number, u1: number, y0: number, y1: number): string {
  const p1 = lerp(a, b, u0), p2 = lerp(a, b, u1);
  return `${p1[0].toFixed(1)},${(p1[1] - y0).toFixed(1)} ${p2[0].toFixed(1)},${(p2[1] - y0).toFixed(1)} ${p2[0].toFixed(1)},${(p2[1] - y1).toFixed(1)} ${p1[0].toFixed(1)},${(p1[1] - y1).toFixed(1)}`;
}
function faceLine(a: [number, number], b: [number, number], u0: number, u1: number, y: number): { x1: number; y1: number; x2: number; y2: number } {
  const p1 = lerp(a, b, u0), p2 = lerp(a, b, u1);
  return { x1: p1[0], y1: p1[1] - y, x2: p2[0], y2: p2[1] - y };
}

export function buildingArt(p: ArtParams, g: PrismGeom): ArtEl[] {
  const out: ArtEl[] = [];
  const { bl, bb, br, ht } = g;
  if (ht < 6) return out;
  const r = rng32(p.seed);
  const q = p.quality;
  const floors = p.stories ?? Math.max(1, Math.round((ht - 5) / 4.4));
  const fh = ht / Math.max(1, floors + 0.6); // floor pitch in px

  const grid = (a: [number, number], b: [number, number], cols: number, y0frac: number, sideLit: boolean) => {
    // punched-window grid: one small quad per floor per column, some lit by occupancy
    const rows = Math.min(floors, 8);
    const rowStep = (ht * (1 - y0frac) - 3) / Math.max(1, rows);
    for (let fl = 0; fl < rows; fl++) {
      for (let c = 0; c < cols; c++) {
        const u0 = 0.12 + (c / cols) * 0.76, u1 = u0 + 0.76 / cols * 0.55;
        const y0 = ht * y0frac + 2 + fl * rowStep, y1 = Math.min(ht - 2, y0 + Math.min(3.2, rowStep * 0.55));
        if (y1 <= y0 + 0.8) continue;
        const lit = sideLit && r() < p.occ * 0.55;
        out.push({ k: 'p', pts: patch(a, b, u0, u1, y0, y1), f: lit ? WIN_LIT : WIN_DARK, o: lit ? 0.85 : 0.75 });
      }
    }
  };

  if (p.type === 'office' || (p.type === 'mixed' && ht > 20)) {
    const curtain = p.construction === 'concrete' || p.construction === 'steel' || q >= 66;
    if (curtain) {
      // glass bands: vertical stripes up the right face, floor lines across
      const bands = Math.max(2, Math.min(5, Math.round(2 + q / 30)));
      for (let i = 0; i < bands; i++) {
        const u0 = 0.10 + (i / bands) * 0.80, u1 = u0 + 0.80 / bands * 0.62;
        out.push({ k: 'p', pts: patch(bb, br, u0, u1, 2, ht - 2), f: GLASS, o: 0.55 });
      }
      for (let fl = 1; fl < Math.min(floors, 10); fl++) {
        const L = faceLine(bb, br, 0.06, 0.94, fl * fh);
        out.push({ k: 'l', ...L, s: TRIM, w: 0.45, o: 0.5 });
      }
      // a few lit floors after hours
      for (let fl = 0; fl < Math.min(floors, 10); fl++) {
        if (r() < p.occ * 0.30) {
          const L = faceLine(bb, br, 0.12, 0.5 + r() * 0.4, fl * fh + fh * 0.45);
          out.push({ k: 'l', ...L, s: WIN_LIT, w: 1.1, o: 0.5 });
        }
      }
    } else {
      grid(bb, br, Math.max(2, Math.min(5, Math.round(2 + q / 25))), p.type === 'mixed' ? 0.22 : 0.06, true);
    }
    // parapet + rooftop mechanical (older/larger buildings carry more clutter)
    if (p.sf > 15000 || p.age > 25) {
      const m0 = lerp(bb, br, 0.35), m1 = lerp(bb, br, 0.55);
      out.push({ k: 'p', pts: `${fmt([m0[0], m0[1] - ht])} ${fmt([m1[0], m1[1] - ht])} ${fmt([m1[0], m1[1] - ht - 3])} ${fmt([m0[0], m0[1] - ht - 3])}`, f: '#2c343d', s: TRIM, w: 0.4 });
    }
  }

  if (p.type === 'mixed' || p.type === 'retail') {
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
    // signage strip above the glass — occupied storefronts hang signs
    if (p.occ > 0.4) out.push({ k: 'l', ...faceLine(bb, br, 0.10, 0.10 + 0.5 * p.occ, y1 + 1.6), s: WIN_LIT, w: 1.3, o: 0.55 });
  }

  if (p.type === 'industrial') {
    // dock doors along the right face; count from size
    const doors = Math.max(1, Math.min(6, Math.round(p.sf / 10000)));
    for (let i = 0; i < doors; i++) {
      const u0 = 0.14 + (i / doors) * 0.72, u1 = u0 + 0.72 / doors * 0.6;
      out.push({ k: 'p', pts: patch(bb, br, u0, u1, 0.5, Math.min(ht - 1.5, 5.5)), f: '#222a32', s: TRIM, w: 0.4 });
    }
    // panel joints (tilt-wall) or corrugation hint
    const joints = p.construction === 'tilt' ? 5 : 9;
    for (let i = 1; i < joints; i++) {
      const u = i / joints;
      const pt = lerp(bb, br, u);
      out.push({ k: 'l', x1: pt[0], y1: pt[1] - 1, x2: pt[0], y2: pt[1] - (ht - 1), s: TRIM, w: 0.3, o: 0.4 });
    }
    // skylight strips on the roof
    const s0 = lerp(bl, bb, 0.5), s1 = lerp(bb, br, 0.5);
    out.push({ k: 'l', x1: (bl[0] + s1[0]) / 2, y1: (bl[1] + s1[1]) / 2 - ht, x2: (br[0] + s0[0]) / 2, y2: (br[1] + s0[1]) / 2 - ht, s: '#39434e', w: 1.4, o: 0.7 });
  }

  if (p.type === 'multifamily') {
    if (p.construction === 'garden' && ht < 16) {
      // pitched roof: a gable ridge over the top face
      const r0 = lerp(bl, bb, 0.5), r1 = lerp(bb, br, 0.5);
      const ridge0: [number, number] = [(bl[0] + r1[0]) / 2, (bl[1] + r1[1]) / 2 - ht - 3.5];
      const ridge1: [number, number] = [(br[0] + r0[0]) / 2, (br[1] + r0[1]) / 2 - ht - 3.5];
      out.push({ k: 'p', pts: `${fmt([bb[0], bb[1] - ht])} ${fmt([br[0], br[1] - ht])} ${fmt(ridge1)} ${fmt(ridge0)}`, f: '#2e3038', s: TRIM, w: 0.4 });
      out.push({ k: 'p', pts: `${fmt([bl[0], bl[1] - ht])} ${fmt([bb[0], bb[1] - ht])} ${fmt(ridge0)}`, f: '#23252c', s: TRIM, w: 0.4 });
      grid(bb, br, 3, 0.08, true);
    } else {
      grid(bb, br, Math.max(3, Math.min(5, Math.round(2 + q / 25))), 0.06, true);
      // balcony ticks up the left face — reads as residential at a glance
      for (let fl = 1; fl < Math.min(floors, 9); fl++) {
        const L = faceLine(bl, bb, 0.2, 0.8, fl * fh);
        out.push({ k: 'l', ...L, s: '#3a424c', w: 0.8, o: 0.7 });
      }
    }
  }

  // weathering: old buildings streak
  if (p.age > 30 && q < 60) {
    const u = 0.2 + r() * 0.5;
    const pt = lerp(bb, br, u);
    out.push({ k: 'l', x1: pt[0], y1: pt[1] - ht + 2, x2: pt[0], y2: pt[1] - 2, s: '#0e1216', w: 1.6, o: 0.25 });
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
