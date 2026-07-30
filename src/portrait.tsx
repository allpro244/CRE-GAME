// Building portraits: a painted front elevation of any building in the city, drawn
// large for the places where you actually study a deal — the underwriting memo, the
// asset drawer, the block inspector, the development desk. Same seed and the same
// archetype resolution as the map's iso art, so the drawing IS the building you
// clicked, not a stock photo of one.
//
// The scene is honest about scale: one foot is the same number of pixels for the
// tower, the person on the sidewalk, and the car at the curb. A 4K SF pad site
// portrait has a big person in it; a 30-story portrait has specks. That contrast is
// the point — the sketch never lies about what you're buying.
//
// Everything derives from data the engine already tracks. Occupancy decides which
// windows glow and which storefronts have papered glass. Age streaks the sills and
// clutters the roof. Quality buys ornament, glass, and planting. Nothing here is a
// score; it's what you'd see from across the street at dusk.

import type { ReactElement } from 'react';
import { pickArchetype, storiesFor, PALETTES, ARCH_PALETTE } from './buildingArt';
import type { ArtParams, Archetype } from './buildingArt';
import * as E from './engine';
import type { PType } from './engine';

export interface PortraitSubject {
  type: PType; construction: string; sf: number; units: number; quality: number;
  age?: number;              // years standing; 0 for new
  occ?: number;              // 0-1; undefined = unknown → drawn at a working 70%
  seed?: number;             // building identity; MUST match the map's per-building seed
  siteCells?: number;        // parcels under it — drives the story count like the map
  stories?: number;          // explicit override when the caller already knows
  tenants?: { name: string; sf: number }[];   // real names go on the signs
  proposed?: boolean;        // architect's rendering: pristine, no weathering
  progress?: number;         // 0-1 → construction site scene instead of a facade
  designTier?: 've' | 'std' | 'signature';
  month?: number;            // campaign month → season: the portrait shares the map's calendar
}

type PSeason = 'winter' | 'spring' | 'summer' | 'fall';
const seasonOfMonth = (m: number): PSeason => {
  const k = ((m % 12) + 12) % 12;
  return k <= 1 || k === 11 ? 'winter' : k <= 4 ? 'spring' : k <= 7 ? 'summer' : 'fall';
};
const LEAF: Record<PSeason, [string, string]> = {
  summer: ['#3d5a41', '#39494a'], spring: ['#4a6a4c', '#456052'],
  fall: ['#8a6a2e', '#7a5a30'], winter: ['#5c564e', '#524e46'],
};

// map identity seed for a building standing on a tile — the same expression the iso
// layer uses for its first prism, so portrait and map roll the same archetype dice
export function mapSeed(stateSeed: number, tileI: number): number {
  return (stateSeed ^ ((tileI + 1) * 0x9e3779b9)) | 0;
}

function rng32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// dusk palette — the hour when occupancy is visible from the street
const SKY_TOP = '#151c27';
const SKY_MID = '#233248';
const SKY_GLOW = '#54453c';
const WIN_LIT = '#e8b25c';
const WIN_DARK = '#11161d';
const GLASS = '#2e4256';
const GLASS_LIT = '#4a6a86';
const TRIM = '#0a0e12';
const SIDEWALK = '#3a3f46';
const ROAD = '#20242a';

// shade a hex color toward black (f<1) or white-ish (f>1)
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => clamp(Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1)), 0, 255);
  const rr = ch((n >> 16) & 255), gg = ch((n >> 8) & 255), bb = ch(n & 255);
  return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1);
}

type El = ReactElement;

// The elevation families. Every archetype maps to one drawing routine plus flags —
// the routine carries the family's bones, the flags carry the archetype's face.
type Family = 'tower' | 'midrise' | 'house' | 'rowhouse' | 'garden' | 'retailrun'
  | 'bigbox' | 'pad' | 'shed' | 'sawtooth' | 'quonset' | 'yard';

const FAMILY: Record<Archetype, Family> = {
  'curtainwall': 'tower', 'crown-tower': 'tower', 'ribbon-slab': 'tower', 'deco-stepback': 'tower',
  'res-tower': 'tower', 'point-tower': 'tower', 'terrace-tower': 'tower', 'podium-tower': 'tower',
  'flatiron-corner': 'tower',
  'punched-midrise': 'midrise', 'brick-loft': 'midrise', 'stone-base': 'midrise',
  'courtyard-brick': 'midrise', 'bay-midrise': 'midrise', 'gallery-midrise': 'midrise',
  'podium-balcony': 'midrise', 'main-street': 'midrise', 'market-hall': 'midrise',
  'wood-office': 'house', 'porch-office': 'house', 'stucco-court': 'house',
  'brownstone-row': 'rowhouse', 'townhome-row': 'rowhouse',
  'garden-walkup': 'garden', 'courtyard-garden': 'garden',
  'storefront-row': 'retailrun', 'strip-parapet': 'retailrun', 'awning-strip': 'retailrun',
  'tower-strip': 'retailrun', 'anchor-center': 'retailrun', 'arcade-center': 'retailrun',
  'lifestyle-center': 'retailrun',
  'bigbox': 'bigbox',
  'pad-site': 'pad', 'drive-thru': 'pad', 'bank-pad': 'pad',
  'tilt-panel': 'shed', 'cross-dock': 'shed', 'cold-store': 'shed', 'pemb': 'shed',
  'twin-gable': 'shed', 'flex-rd': 'shed', 'tin-shed': 'shed', 'dock-shed': 'shed',
  'sawtooth': 'sawtooth', 'quonset': 'quonset', 'yard-shed': 'yard',
};

// frontage in feet: how wide the building presents to the street. Shape truth per
// family — retail is long and shallow, towers are compact, sheds sprawl.
function frontageFt(fam: Family, sf: number, stories: number): number {
  const plate = sf / Math.max(1, stories);
  switch (fam) {
    case 'tower': return clamp(Math.sqrt(plate) * 1.15, 75, 150);
    case 'midrise': return clamp(Math.sqrt(plate) * 1.35, 60, 190);
    case 'house': return clamp(Math.sqrt(sf) * 0.9, 34, 70);
    case 'rowhouse': return clamp(sf / 950, 70, 190);
    case 'garden': return clamp(Math.sqrt(sf) * 1.5, 110, 240);
    case 'retailrun': return clamp(sf / 62, 90, 430);
    case 'bigbox': return clamp(Math.sqrt(sf) * 1.15, 130, 330);
    case 'pad': return clamp(Math.sqrt(sf) * 1.05, 40, 80);
    case 'sawtooth': case 'shed': return clamp(Math.sqrt(sf) * 1.25, 120, 460);
    case 'quonset': return clamp(Math.sqrt(sf) * 1.0, 60, 140);
    case 'yard': return clamp(Math.sqrt(sf) * 1.5, 100, 220);
  }
}

// ---------- entourage: the things that give the drawing scale ----------
function person(x: number, gy: number, fpx: number, key: string, tone = '#0e1319'): El[] {
  const h = 5.9 * fpx;                       // a six-footer, honestly scaled
  if (h < 2.2) return [];                    // specks aren't people
  const w = h * 0.3;
  return [
    <circle key={key + 'h'} cx={x} cy={gy - h + h * 0.1} r={h * 0.11} fill={tone} />,
    <path key={key + 'b'} d={`M${x - w / 2} ${gy} L${x - w * 0.18} ${gy - h * 0.5} L${x - w * 0.4} ${gy - h * 0.78} L${x} ${gy - h * 0.8} L${x + w * 0.4} ${gy - h * 0.78} L${x + w * 0.18} ${gy - h * 0.5} L${x + w / 2} ${gy}`} fill={tone} />,
  ];
}
function tree(x: number, gy: number, fpx: number, r: () => number, key: string, lush: boolean, season: PSeason = 'summer'): El[] {
  const h = (18 + r() * 10) * fpx;
  if (h < 5) return [];
  const bare = season === 'winter';
  const cr = h * (0.34 + r() * 0.1) * (bare ? 0.7 : 1);
  const leaf = LEAF[season][lush ? 0 : 1];
  return [
    <line key={key + 't'} x1={x} y1={gy} x2={x} y2={gy - h + cr * 0.7} stroke="#2c2620" strokeWidth={Math.max(0.6, fpx * 0.9)} />,
    <circle key={key + 'c1'} cx={x} cy={gy - h + cr * 0.5} r={cr} fill={leaf} opacity={bare ? 0.55 : 0.92} />,
    <circle key={key + 'c2'} cx={x - cr * 0.55} cy={gy - h + cr * 0.85} r={cr * 0.7} fill={shade(leaf, 0.85)} opacity={bare ? 0.5 : 0.9} />,
    <circle key={key + 'c3'} cx={x + cr * 0.5} cy={gy - h + cr * 0.9} r={cr * 0.65} fill={shade(leaf, 1.08)} opacity={bare ? 0.5 : 0.9} />,
  ];
}
function car(x: number, gy: number, fpx: number, r: () => number, key: string): El[] {
  const L = 15 * fpx, H = 4.6 * fpx;
  if (H < 2) return [];
  const col = pick(r, ['#54606c', '#6a5c50', '#465a6a', '#6e6a64', '#5c4848'] as const);
  return [
    <path key={key + 'b'} d={`M${x} ${gy} L${x} ${gy - H * 0.55} L${x + L * 0.16} ${gy - H * 0.6} L${x + L * 0.3} ${gy - H} L${x + L * 0.72} ${gy - H} L${x + L * 0.86} ${gy - H * 0.58} L${x + L} ${gy - H * 0.5} L${x + L} ${gy} Z`} fill={col} />,
    <path key={key + 'w'} d={`M${x + L * 0.33} ${gy - H * 0.62} L${x + L * 0.38} ${gy - H * 0.92} L${x + L * 0.68} ${gy - H * 0.92} L${x + L * 0.8} ${gy - H * 0.58} Z`} fill="#1a2129" opacity={0.9} />,
    <circle key={key + 'w1'} cx={x + L * 0.22} cy={gy} r={H * 0.24} fill="#0d1116" />,
    <circle key={key + 'w2'} cx={x + L * 0.8} cy={gy} r={H * 0.24} fill="#0d1116" />,
  ];
}
function streetlight(x: number, gy: number, fpx: number, key: string, lit: boolean): El[] {
  const h = 22 * fpx;
  if (h < 8) return [];
  return [
    <line key={key + 'p'} x1={x} y1={gy} x2={x} y2={gy - h} stroke="#2c3138" strokeWidth={Math.max(0.7, fpx * 0.7)} />,
    <line key={key + 'a'} x1={x} y1={gy - h} x2={x + h * 0.22} y2={gy - h} stroke="#2c3138" strokeWidth={Math.max(0.7, fpx * 0.6)} />,
    <circle key={key + 'l'} cx={x + h * 0.22} cy={gy - h + 1} r={Math.max(1, fpx * 1.1)} fill={lit ? '#f0c37a' : '#3a4048'} opacity={lit ? 0.95 : 1} />,
    ...(lit ? [<circle key={key + 'g'} cx={x + h * 0.22} cy={gy - h + 1} r={Math.max(2.5, fpx * 3)} fill="#f0c37a" opacity={0.10} />] : []),
  ];
}

// ---------- shared facade vocabulary ----------
interface Ctx {
  r: () => number; q: number; age: number; occ: number; fpx: number;
  weather: boolean;    // age is allowed to show
  season: PSeason;     // the portrait shares the map's calendar
  els: El[]; k: number;
}
function key(c: Ctx) { return 'e' + (c.k++); }

// a grid of punched windows on a wall rect; returns nothing below legible size
function windows(c: Ctx, x: number, y: number, w: number, h: number, rows: number, cols: number,
  opts: { tall?: boolean; sillStreaks?: boolean; litBias?: number } = {}) {
  if (rows < 1 || cols < 1 || w < 4 || h < 3) return;
  const cw = w / cols, ch = h / rows;
  const ww = cw * (opts.tall ? 0.42 : 0.52), wh = ch * (opts.tall ? 0.62 : 0.5);
  if (ww < 1.1 || wh < 1.1) {
    // too small to punch: render as banded texture so distant facades still read
    for (let i = 1; i < rows; i++) {
      c.els.push(<line key={key(c)} x1={x} y1={y + i * ch} x2={x + w} y2={y + i * ch} stroke={TRIM} strokeWidth={0.35} opacity={0.35} />);
    }
    return;
  }
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const wx = x + ci * cw + (cw - ww) / 2, wy = y + ri * ch + (ch - wh) / 2;
      const lit = c.r() < c.occ * (opts.litBias ?? 0.55);
      if (lit && wh > 3) c.els.push(<rect key={key(c)} x={wx - ww * 0.18} y={wy - wh * 0.18} width={ww * 1.36} height={wh * 1.36} fill={WIN_LIT} opacity={0.14} />);
      c.els.push(<rect key={key(c)} x={wx} y={wy} width={ww} height={wh}
        fill={lit ? WIN_LIT : WIN_DARK} opacity={lit ? 0.95 : 0.88} />);
      if (opts.sillStreaks && c.weather && c.age > 18 && c.r() < 0.35 && wh > 2.5) {
        c.els.push(<path key={key(c)} d={`M${wx} ${wy + wh} L${wx + ww} ${wy + wh} L${wx + ww * 0.7} ${wy + wh + ch * 0.5} L${wx + ww * 0.3} ${wy + wh + ch * 0.5} Z`}
          fill="#000" opacity={0.13} />);
      }
    }
  }
}
// a storefront run along the base of a wall: glass bays, sign band, occupancy truth
function storefronts(c: Ctx, x: number, gy: number, w: number, hFt: number,
  tenants: { name: string; sf: number }[] | undefined, bays: number, opts: { awnings?: boolean; arcade?: boolean } = {}) {
  const h = hFt * c.fpx;
  const bw = w / bays;
  const signH = clamp(3.2 * c.fpx, 3, 9);
  const names = (tenants ?? []).filter(t => t.name).slice(0, bays);
  for (let i = 0; i < bays; i++) {
    const bx = x + i * bw;
    const open = c.r() < Math.max(0.12, c.occ);
    // glass
    c.els.push(<rect key={key(c)} x={bx + bw * 0.08} y={gy - h * 0.82} width={bw * 0.84} height={h * 0.82}
      fill={open ? GLASS_LIT : GLASS} opacity={open ? 0.95 : 0.8} />);
    if (open && c.occ > 0) {
      c.els.push(<rect key={key(c)} x={bx + bw * 0.08} y={gy - h * 0.55} width={bw * 0.84} height={h * 0.55} fill={WIN_LIT} opacity={0.22} />);
    }
    if (!open) {
      // papered glass and a leasing placard — vacancy you can see from the car
      c.els.push(<line key={key(c)} x1={bx + bw * 0.14} y1={gy - h * 0.7} x2={bx + bw * 0.86} y2={gy - h * 0.2} stroke="#4a4438" strokeWidth={0.7} opacity={0.6} />);
      if (bw > 14) c.els.push(<rect key={key(c)} x={bx + bw * 0.3} y={gy - h * 0.62} width={bw * 0.4} height={h * 0.28} fill="#d8cba6" opacity={0.85} />);
    }
    // mullions
    if (bw > 10) c.els.push(<line key={key(c)} x1={bx + bw / 2} y1={gy - h * 0.82} x2={bx + bw / 2} y2={gy} stroke={TRIM} strokeWidth={0.5} opacity={0.7} />);
    if (i > 0) c.els.push(<line key={key(c)} x1={bx} y1={gy - h} x2={bx} y2={gy} stroke={TRIM} strokeWidth={0.6} opacity={0.5} />);
    // awning
    if (opts.awnings && open) {
      const aw = pick(c.r, ['#7a3b3b', '#3b5a4a', '#5a5030', '#3c4a6a', '#6e4a58'] as const);
      c.els.push(<path key={key(c)} d={`M${bx + bw * 0.05} ${gy - h * 0.82} L${bx + bw * 0.95} ${gy - h * 0.82} L${bx + bw * 0.88} ${gy - h * 0.66} L${bx + bw * 0.12} ${gy - h * 0.66} Z`}
        fill={aw} opacity={0.95} />);
    }
    // sign: a real tenant name goes on one bay each — never cycled, cycling reads
    // as a typo across the whole run. Bays past the rent roll get a lit bar.
    const nm = open ? names[i]?.name : undefined;
    const sy = gy - h - signH * 0.35;
    if (open) {
      // a name only goes up whole — a truncated sign reads as a glitch, not a shop
      const maxChars = Math.floor(bw / (signH * 0.62));
      if (nm && signH >= 4.5 && nm.length <= maxChars) {
        c.els.push(<text key={key(c)} x={bx + bw / 2} y={sy + signH * 0.28} textAnchor="middle" fill={WIN_LIT}
          fontSize={signH * 0.72} fontFamily="var(--mono, monospace)" opacity={0.9} letterSpacing={0.4}>
          {nm.toUpperCase()}</text>);
      } else {
        c.els.push(<line key={key(c)} x1={bx + bw * 0.18} y1={sy} x2={bx + bw * 0.82} y2={sy}
          stroke={pick(c.r, [WIN_LIT, '#c9764f', '#7fae8a', '#8a9fd0'] as const)} strokeWidth={clamp(signH * 0.4, 1, 2.6)} opacity={0.9} />);
      }
    }
  }
  // arcade columns in front of everything
  if (opts.arcade) {
    for (let i = 0; i <= bays; i++) {
      const cx2 = x + i * bw;
      c.els.push(<line key={key(c)} x1={cx2} y1={gy} x2={cx2} y2={gy - h} stroke="#6e5836" strokeWidth={clamp(c.fpx * 2, 1.8, 4.2)} opacity={0.98} />);
      c.els.push(<line key={key(c)} x1={cx2 - clamp(c.fpx * 1.6, 1.4, 3)} y1={gy - h + 0.6} x2={cx2 + clamp(c.fpx * 1.6, 1.4, 3)} y2={gy - h + 0.6} stroke="#5a4830" strokeWidth={1} opacity={0.95} />);
      if (i < bays) c.els.push(<path key={key(c)} d={`M${cx2} ${gy - h * 0.78} Q${cx2 + bw / 2} ${gy - h * 1.14} ${cx2 + bw} ${gy - h * 0.78}`}
        fill="none" stroke="#6e5836" strokeWidth={clamp(c.fpx * 1.3, 1.1, 2.6)} opacity={0.95} />);
    }
  }
}
// age grime running down from the parapet
function parapetStreaks(c: Ctx, x: number, y: number, w: number, depth: number) {
  if (!c.weather || c.age < 22) return;
  const n = Math.round(w / 26);
  for (let i = 0; i < n; i++) {
    const sx = x + c.r() * w;
    c.els.push(<path key={key(c)} d={`M${sx - 1.2} ${y} L${sx + 1.2} ${y} L${sx + 0.4} ${y + depth * (0.5 + c.r() * 0.5)} L${sx - 0.4} ${y + depth * 0.4} Z`}
      fill="#000" opacity={0.10 + c.r() * 0.08} />);
  }
}
function rooftopUnits(c: Ctx, x: number, y: number, w: number, count: number) {
  for (let i = 0; i < count; i++) {
    const uw = clamp(c.fpx * (6 + c.r() * 5), 4, 16), uh = clamp(c.fpx * 3.4, 2.5, 8);
    const ux = x + w * (0.12 + (i + c.r() * 0.4) / (count + 0.5) * 0.8);
    c.els.push(<rect key={key(c)} x={ux} y={y - uh} width={uw} height={uh} fill="#39404a" stroke={TRIM} strokeWidth={0.4} />);
  }
}
function waterTank(c: Ctx, x: number, y: number) {
  const s = clamp(c.fpx * 2.2, 0.9, 2.2);
  c.els.push(<line key={key(c)} x1={x - 3 * s} y1={y} x2={x - 2 * s} y2={y - 4 * s} stroke="#241d16" strokeWidth={0.7} />);
  c.els.push(<line key={key(c)} x1={x + 3 * s} y1={y} x2={x + 2 * s} y2={y - 4 * s} stroke="#241d16" strokeWidth={0.7} />);
  c.els.push(<rect key={key(c)} x={x - 3 * s} y={y - 10 * s} width={6 * s} height={6 * s} fill="#4a3a2c" stroke={TRIM} strokeWidth={0.5} />);
  c.els.push(<path key={key(c)} d={`M${x - 3 * s} ${y - 10 * s} L${x + 3 * s} ${y - 10 * s} L${x} ${y - 13 * s} Z`} fill="#3a2e23" stroke={TRIM} strokeWidth={0.5} />);
}

// ---------- the families ----------
interface Draw { x: number; gy: number; w: number; hPx: number; stories: number; tint: string; arch: Archetype; sf: number; tenants?: { name: string; sf: number }[] }

function drawTower(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, stories, tint, arch } = d;
  const floorPx = hPx / stories;
  const lobbyH = clamp(floorPx * 1.6, floorPx, 16 * c.fpx);
  const glass = c.q >= 114 ? shade(GLASS, 1.25) : GLASS;

  // podium-tower & flatiron get a wider retail base
  const hasPodium = arch === 'podium-tower' || arch === 'flatiron-corner' || arch === 'point-tower';
  const podW = hasPodium ? w * 1.3 : w;
  const podX = x - (podW - w) / 2;
  const podH = hasPodium ? Math.min(clamp(floorPx * 2, 10, 30 * c.fpx), hPx * 0.42) : 0;

  if (hasPodium) {
    c.els.push(<rect key={key(c)} x={podX} y={gy - podH} width={podW} height={podH} fill={shade(tint, 0.8)} stroke={TRIM} strokeWidth={0.7} />);
    storefronts(c, podX, gy, podW, Math.min(14, podH / c.fpx * 0.8), d.tenants, clamp(Math.round(podW / 34), 2, 7), { awnings: arch !== 'point-tower' });
    c.els.push(<line key={key(c)} x1={podX} y1={gy - podH} x2={podX + podW} y2={gy - podH} stroke={TRIM} strokeWidth={1} />);
  }

  const bodyTop = gy - hPx;
  const bodyBot = gy - podH;
  const bodyH = bodyBot - bodyTop;

  // deco & terrace step; flatiron narrows
  if (arch === 'deco-stepback' || arch === 'terrace-tower') {
    const steps = arch === 'deco-stepback' ? [1, 0.78, 0.55] : [1, 0.82, 0.64, 0.46];
    const segH = bodyH / (arch === 'deco-stepback' ? 1.55 : 1.9);
    let y1 = bodyBot;
    for (const [si, sw] of steps.entries()) {
      const sh = si === 0 ? segH : segH * (arch === 'deco-stepback' ? 0.38 : 0.35);
      const sx = x + (w - w * sw) / 2;
      c.els.push(<rect key={key(c)} x={sx} y={y1 - sh} width={w * sw} height={sh} fill={tint} stroke={TRIM} strokeWidth={0.7} />);
      const rows = Math.max(1, Math.round(sh / floorPx));
      if (arch === 'deco-stepback') {
        // strong piers between tall window slots
        const cols2 = clamp(Math.round(w * sw / 13), 3, 9);
        windows(c, sx + w * sw * 0.06, y1 - sh + 3, w * sw * 0.88, sh - 5, rows, cols2, { tall: true, sillStreaks: true });
        for (let i = 0; i <= cols2; i++) {
          const px2 = sx + w * sw * 0.06 + (w * sw * 0.88 / cols2) * i;
          c.els.push(<line key={key(c)} x1={px2} y1={y1 - sh + 2} x2={px2} y2={y1 - 1} stroke={shade(tint, 0.6)} strokeWidth={1.1} opacity={0.8} />);
        }
      } else {
        windows(c, sx + w * sw * 0.06, y1 - sh + 3, w * sw * 0.88, sh - 5, rows, clamp(Math.round(w * sw / 15), 2, 7), { sillStreaks: true });
        // planted terrace edge on each setback
        if (si > 0) c.els.push(<line key={key(c)} x1={sx - 2} y1={y1 - sh} x2={sx + w * sw + 2} y2={y1 - sh} stroke="#3f5a46" strokeWidth={2} opacity={0.85} />);
      }
      y1 -= sh;
    }
    if (arch === 'deco-stepback') {
      // ziggurat crown with a warm lantern
      const cw = w * 0.3;
      c.els.push(<rect key={key(c)} x={x + (w - cw) / 2} y={y1 - floorPx * 1.4} width={cw} height={floorPx * 1.4} fill={tint} stroke={TRIM} strokeWidth={0.6} />);
      c.els.push(<path key={key(c)} d={`M${x + (w - cw) / 2} ${y1 - floorPx * 1.4} L${x + w / 2} ${y1 - floorPx * 2.6} L${x + (w + cw) / 2} ${y1 - floorPx * 1.4} Z`} fill={shade(tint, 0.85)} stroke={TRIM} strokeWidth={0.6} />);
      if (c.occ > 0.4) c.els.push(<circle key={key(c)} cx={x + w / 2} cy={y1 - floorPx * 2.4} r={clamp(floorPx * 0.3, 1.2, 3)} fill={WIN_LIT} opacity={0.9} />);
    }
  } else if (arch === 'flatiron-corner') {
    // the prow: a trapezoid narrowing skyward on one side
    c.els.push(<path key={key(c)} d={`M${x} ${bodyBot} L${x} ${bodyTop} L${x + w * 0.82} ${bodyTop} L${x + w} ${bodyBot} Z`} fill={tint} stroke={TRIM} strokeWidth={0.7} />);
    const rows = clamp(Math.round(bodyH / floorPx), 2, 24);
    windows(c, x + w * 0.05, bodyTop + 3, w * 0.75, bodyH - 6, rows, clamp(Math.round(w / 13), 3, 8), { tall: true, sillStreaks: true });
    c.els.push(<line key={key(c)} x1={x} y1={bodyTop + 2} x2={x + w * 0.82} y2={bodyTop + 2} stroke={shade(tint, 0.6)} strokeWidth={1.4} />);
  } else {
    // straight shaft
    c.els.push(<rect key={key(c)} x={x} y={bodyTop} width={w} height={bodyH} fill={tint} stroke={TRIM} strokeWidth={0.7} />);
    const rows = clamp(Math.round(bodyH / floorPx), 2, 30);
    if (arch === 'curtainwall' || arch === 'crown-tower' || arch === 'podium-tower') {
      // full-height glass: vertical mullion bands, spandrel lines, a diagonal sheen
      c.els.push(<rect key={key(c)} x={x + w * 0.04} y={bodyTop + 2} width={w * 0.92} height={bodyH - 4} fill={glass} opacity={0.9} />);
      const cols2 = clamp(Math.round(w / 9), 4, 12);
      for (let i = 1; i < cols2; i++) {
        c.els.push(<line key={key(c)} x1={x + w * 0.04 + (w * 0.92 / cols2) * i} y1={bodyTop + 2} x2={x + w * 0.04 + (w * 0.92 / cols2) * i} y2={bodyBot - 2} stroke={TRIM} strokeWidth={0.4} opacity={0.6} />);
      }
      for (let i = 1; i < rows; i++) {
        c.els.push(<line key={key(c)} x1={x + w * 0.04} y1={bodyTop + 2 + (bodyH - 4) / rows * i} x2={x + w * 0.96} y2={bodyTop + 2 + (bodyH - 4) / rows * i} stroke={TRIM} strokeWidth={0.35} opacity={0.5} />);
      }
      // scattered lit offices behind the glass — cell by cell, the way a tower
      // actually looks after dark
      const cellW = (w * 0.92) / cols2, cellH = (bodyH - 4) / rows;
      for (let ri = 0; ri < rows; ri++) {
        for (let ci = 0; ci < cols2; ci++) {
          if (c.r() < c.occ * 0.38) {
            c.els.push(<rect key={key(c)} x={x + w * 0.04 + ci * cellW + 0.6} y={bodyTop + 2 + ri * cellH + 0.6}
              width={cellW - 1.2} height={cellH - 1.2} fill={WIN_LIT} opacity={0.3} />);
          }
        }
      }
      c.els.push(<path key={key(c)} d={`M${x + w * 0.1} ${bodyBot} L${x + w * 0.3} ${bodyBot} L${x + w * 0.75} ${bodyTop + 2} L${x + w * 0.55} ${bodyTop + 2} Z`} fill="#fff" opacity={0.05} />);
    } else if (arch === 'ribbon-slab') {
      // alternating strip windows and spandrel — the 60s slab
      for (let i = 0; i < rows; i++) {
        const ry = bodyTop + (bodyH / rows) * i;
        const lit = c.r() < c.occ * 0.5;
        c.els.push(<rect key={key(c)} x={x + w * 0.04} y={ry + (bodyH / rows) * 0.18} width={w * 0.92} height={(bodyH / rows) * 0.5}
          fill={lit ? WIN_LIT : WIN_DARK} opacity={lit ? 0.55 : 0.85} />);
      }
    } else {
      // res-tower / point-tower: punched grid + balconies
      windows(c, x + w * 0.05, bodyTop + 3, w * 0.9, bodyH - 6, rows, clamp(Math.round(w / 12), 3, 9), { sillStreaks: true });
      const balSide = c.r() < 0.5 ? 0 : 1;
      for (let i = 1; i < rows; i++) {
        const by = bodyTop + (bodyH / rows) * i;
        c.els.push(<line key={key(c)} x1={balSide ? x + w : x - w * 0.06} y1={by} x2={balSide ? x + w * 1.06 : x} y2={by} stroke="#39434e" strokeWidth={1.2} opacity={0.9} />);
      }
    }
  }

  // crown & roof gear
  const topY = arch === 'deco-stepback' || arch === 'terrace-tower' ? bodyTop : bodyTop;
  if (arch === 'crown-tower') {
    const cw = w * 0.5;
    const chh = clamp(floorPx * 1.2, 4, 14);
    c.els.push(<rect key={key(c)} x={x + (w - cw) / 2} y={topY - chh} width={cw} height={chh}
      fill={GLASS_LIT} stroke={TRIM} strokeWidth={0.6} />);
    for (let i = 1; i < 5; i++) {
      c.els.push(<line key={key(c)} x1={x + (w - cw) / 2 + (cw / 5) * i} y1={topY - chh + 0.5} x2={x + (w - cw) / 2 + (cw / 5) * i} y2={topY - 0.5} stroke={TRIM} strokeWidth={0.4} opacity={0.7} />);
    }
    c.els.push(<path key={key(c)} d={`M${x + (w - cw) / 2} ${topY - chh} L${x + w / 2} ${topY - chh - clamp(floorPx * 0.5, 2, 5)} L${x + (w + cw) / 2} ${topY - chh} Z`} fill={shade(tint, 0.8)} stroke={TRIM} strokeWidth={0.5} />);
    if (c.occ > 0.3) c.els.push(<rect key={key(c)} x={x + (w - cw) / 2} y={topY - chh} width={cw} height={chh} fill={WIN_LIT} opacity={0.45} />);
    c.els.push(<line key={key(c)} x1={x + w / 2} y1={topY - clamp(floorPx * 1.2, 4, 14)} x2={x + w / 2} y2={topY - clamp(floorPx * 1.2, 4, 14) - 14 * c.fpx * 2} stroke="#39434e" strokeWidth={0.8} />);
    c.els.push(<circle key={key(c)} cx={x + w / 2} cy={topY - clamp(floorPx * 1.2, 4, 14) - 14 * c.fpx * 2} r={1} fill="#c94a3a" opacity={0.95} />);
  } else if (arch !== 'deco-stepback') {
    rooftopUnits(c, x, topY, w, w > 70 ? 2 : 1);
    if (stories >= 12 && (arch === 'curtainwall' || arch === 'podium-tower')) {
      c.els.push(<line key={key(c)} x1={x + w * 0.5} y1={topY} x2={x + w * 0.5} y2={topY - 16 * c.fpx * 2.2} stroke="#39434e" strokeWidth={0.7} />);
      c.els.push(<circle key={key(c)} cx={x + w * 0.5} cy={topY - 16 * c.fpx * 2.2} r={0.9} fill="#c94a3a" />);
    }
  }
  // lobby: double-height glass entry + canopy, on non-podium towers
  if (!hasPodium) {
    c.els.push(<rect key={key(c)} x={x + w * 0.3} y={gy - lobbyH} width={w * 0.4} height={lobbyH} fill={GLASS_LIT} opacity={0.95} />);
    if (c.occ > 0.15) c.els.push(<rect key={key(c)} x={x + w * 0.3} y={gy - lobbyH} width={w * 0.4} height={lobbyH} fill={WIN_LIT} opacity={0.3} />);
    c.els.push(<line key={key(c)} x1={x + w * 0.24} y1={gy - lobbyH - 1.5} x2={x + w * 0.76} y2={gy - lobbyH - 1.5} stroke={TRIM} strokeWidth={2} opacity={0.9} />);
  }
  parapetStreaks(c, x, topY + 1, w, hPx * 0.2);
}

function drawMidrise(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, stories, tint, arch } = d;
  const floorPx = hPx / stories;
  const mixedBase = arch === 'main-street' || arch === 'market-hall';
  const baseH = mixedBase ? clamp(floorPx * 1.5, 8, 24 * c.fpx) : 0;
  c.els.push(<rect key={key(c)} x={x} y={gy - hPx} width={w} height={hPx} fill={tint} stroke={TRIM} strokeWidth={0.7} />);

  // brick coursing / stucco texture
  if (ARCH_PALETTE[arch] === 'brick') {
    for (let i = 1; i < Math.min(hPx / 4, 26); i++) {
      c.els.push(<line key={key(c)} x1={x} y1={gy - hPx + i * 4} x2={x + w} y2={gy - hPx + i * 4} stroke="#000" strokeWidth={0.25} opacity={0.10} />);
    }
  }
  const upRows = clamp(stories - (mixedBase ? 1 : 0), 1, 12);
  const upTop = gy - hPx + 3;
  const upH = hPx - baseH - 6;

  if (arch === 'brick-loft') {
    // big three-pane sash windows, heavy cornice, the converted works
    windows(c, x + w * 0.05, upTop, w * 0.9, upH, clamp(upRows, 1, 6), clamp(Math.round(w / 26), 2, 6), { tall: true, sillStreaks: true, litBias: 0.5 });
    for (let i = 1; i <= clamp(upRows, 1, 6); i++) {
      c.els.push(<line key={key(c)} x1={x + w * 0.03} y1={upTop + (upH / clamp(upRows, 1, 6)) * i} x2={x + w * 0.97} y2={upTop + (upH / clamp(upRows, 1, 6)) * i} stroke="#241a14" strokeWidth={0.6} opacity={0.7} />);
    }
    if (c.age > 18) waterTank(c, x + w * 0.78, gy - hPx);
  } else if (arch === 'stone-base') {
    // rusticated two-story base, arched entry, dressed upper floors
    const bH = clamp(floorPx * 2, 10, hPx * 0.4);
    c.els.push(<rect key={key(c)} x={x} y={gy - bH} width={w} height={bH} fill={shade(tint, 0.82)} stroke={TRIM} strokeWidth={0.5} />);
    for (let i = 1; i < 4; i++) c.els.push(<line key={key(c)} x1={x} y1={gy - (bH / 4) * i} x2={x + w} y2={gy - (bH / 4) * i} stroke="#000" strokeWidth={0.5} opacity={0.2} />);
    c.els.push(<path key={key(c)} d={`M${x + w * 0.42} ${gy} L${x + w * 0.42} ${gy - bH * 0.55} Q${x + w * 0.5} ${gy - bH * 0.85} ${x + w * 0.58} ${gy - bH * 0.55} L${x + w * 0.58} ${gy} Z`}
      fill={c.occ > 0.2 ? WIN_LIT : WIN_DARK} opacity={c.occ > 0.2 ? 0.75 : 0.9} />);
    windows(c, x + w * 0.06, gy - hPx + 3, w * 0.88, hPx - bH - 6, clamp(stories - 2, 1, 8), clamp(Math.round(w / 16), 3, 8), { sillStreaks: true });
    c.els.push(<line key={key(c)} x1={x - 2} y1={gy - hPx + 1.5} x2={x + w + 2} y2={gy - hPx + 1.5} stroke={shade(tint, 0.55)} strokeWidth={2} />);
  } else if (arch === 'bay-midrise') {
    // projecting bay stacks — San Francisco bones
    const bays = clamp(Math.round(w / 30), 2, 5);
    windows(c, x + w * 0.04, upTop, w * 0.92, upH, upRows, bays * 2, { sillStreaks: true });
    for (let i = 0; i < bays; i++) {
      const bx = x + w * (0.12 + (i / bays) * 0.8);
      c.els.push(<rect key={key(c)} x={bx - 4} y={gy - hPx + floorPx} width={8} height={hPx - floorPx * 1.6} fill={shade(tint, 1.1)} stroke={TRIM} strokeWidth={0.5} opacity={0.98} />);
      windows(c, bx - 3.4, gy - hPx + floorPx + 2, 6.8, hPx - floorPx * 1.6 - 4, clamp(upRows, 1, 8), 1, { litBias: 0.6 });
    }
  } else if (arch === 'gallery-midrise') {
    // open walkways with rail lines and an end stair tower
    for (let i = 1; i < upRows; i++) {
      const wy = gy - (hPx / stories) * i;
      c.els.push(<line key={key(c)} x1={x + w * 0.04} y1={wy} x2={x + w * 0.86} y2={wy} stroke="#39424c" strokeWidth={1.4} opacity={0.95} />);
      c.els.push(<line key={key(c)} x1={x + w * 0.04} y1={wy - floorPx * 0.35} x2={x + w * 0.86} y2={wy - floorPx * 0.35} stroke="#39424c" strokeWidth={0.5} opacity={0.7} />);
    }
    windows(c, x + w * 0.06, upTop, w * 0.76, upH, upRows, clamp(Math.round(w / 18), 3, 8), { litBias: 0.6 });
    c.els.push(<rect key={key(c)} x={x + w * 0.88} y={gy - hPx} width={w * 0.12} height={hPx} fill={shade(tint, 0.75)} stroke={TRIM} strokeWidth={0.6} />);
    windows(c, x + w * 0.9, upTop + floorPx * 0.4, w * 0.08, upH - floorPx * 0.6, clamp(upRows - 1, 1, 7), 1, { litBias: 0.3 });
  } else if (arch === 'podium-balcony') {
    const pH = clamp(floorPx * 1.2, 6, hPx * 0.28);
    c.els.push(<rect key={key(c)} x={x} y={gy - pH} width={w} height={pH} fill="#4a5058" stroke={TRIM} strokeWidth={0.5} />);
    storefronts(c, x, gy, w, Math.min(11, pH / c.fpx * 0.8), d.tenants, clamp(Math.round(w / 40), 2, 4), {});
    windows(c, x + w * 0.05, upTop, w * 0.9, hPx - pH - 6, clamp(stories - 1, 1, 9), clamp(Math.round(w / 15), 3, 8), { sillStreaks: true, litBias: 0.6 });
    for (let i = 2; i < upRows; i++) {
      const by = gy - (hPx / stories) * i;
      c.els.push(<line key={key(c)} x1={x - w * 0.04} y1={by} x2={x + w * 0.12} y2={by} stroke="#39424c" strokeWidth={1.2} opacity={0.9} />);
    }
    if (c.q >= 102) c.els.push(<line key={key(c)} x1={x + w * 0.2} y1={gy - hPx - 1.5} x2={x + w * 0.8} y2={gy - hPx - 1.5} stroke="#3f5a46" strokeWidth={2.2} opacity={0.85} />);
  } else if (mixedBase) {
    // main-street / market-hall: shops below, life above
    storefronts(c, x, gy, w, 13, d.tenants, clamp(Math.round(w / 30), 2, 6), { awnings: arch === 'main-street' });
    if (arch === 'market-hall') {
      // arched center entry, kept inside the base storey
      c.els.push(<path key={key(c)} d={`M${x + w * 0.42} ${gy} L${x + w * 0.42} ${gy - baseH * 0.82} Q${x + w * 0.5} ${gy - baseH * 1.12} ${x + w * 0.58} ${gy - baseH * 0.82} L${x + w * 0.58} ${gy} Z`}
        fill={c.occ > 0.2 ? GLASS_LIT : GLASS} opacity={0.85} stroke="#8a7a5c" strokeWidth={1} />);
      if (c.occ > 0.2) c.els.push(<path key={key(c)} d={`M${x + w * 0.42} ${gy} L${x + w * 0.42} ${gy - baseH * 0.6} L${x + w * 0.58} ${gy - baseH * 0.6} L${x + w * 0.58} ${gy} Z`} fill={WIN_LIT} opacity={0.3} />);
    }
    windows(c, x + w * 0.05, upTop, w * 0.9, hPx - baseH - floorPx * 0.4, clamp(stories - 1, 1, 5), clamp(Math.round(w / 17), 3, 9), { sillStreaks: true, litBias: 0.6 });
    c.els.push(<line key={key(c)} x1={x - 2} y1={gy - hPx + 1.2} x2={x + w + 2} y2={gy - hPx + 1.2} stroke={shade(tint, 0.55)} strokeWidth={1.8} />);
  } else {
    // punched-midrise / courtyard-brick: the honest grid
    const cols2 = clamp(Math.round(w / (arch === 'courtyard-brick' ? 20 : 15)), 3, 9);
    windows(c, x + w * 0.05, upTop, w * 0.9, upH, upRows, cols2, { sillStreaks: true });
    if (arch === 'courtyard-brick') {
      // the light court: a dark slot up the middle
      c.els.push(<rect key={key(c)} x={x + w * 0.46} y={gy - hPx + floorPx} width={w * 0.08} height={hPx - floorPx * 1.8} fill="#000" opacity={0.3} />);
    }
    // entry
    c.els.push(<rect key={key(c)} x={x + w * 0.45} y={gy - clamp(9 * c.fpx, 5, floorPx)} width={w * 0.1} height={clamp(9 * c.fpx, 5, floorPx)} fill="#241d16" stroke={TRIM} strokeWidth={0.4} />);
    c.els.push(<line key={key(c)} x1={x - 2} y1={gy - hPx + 1.2} x2={x + w + 2} y2={gy - hPx + 1.2} stroke={shade(tint, 0.55)} strokeWidth={1.6} />);
  }
  if (!mixedBase && arch !== 'brick-loft') rooftopUnits(c, x, gy - hPx, w, w > 120 ? 2 : 1);
  parapetStreaks(c, x, gy - hPx + 1, w, hPx * 0.3);
}

function drawHouse(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint, arch } = d;
  const wallH = hPx * 0.72, roofH = hPx * 0.28;
  c.els.push(<rect key={key(c)} x={x} y={gy - wallH} width={w} height={wallH} fill={tint} stroke={TRIM} strokeWidth={0.7} />);
  // clapboard
  for (let i = 1; i < wallH / 3; i++) {
    c.els.push(<line key={key(c)} x1={x} y1={gy - i * 3} x2={x + w} y2={gy - i * 3} stroke="#000" strokeWidth={0.25} opacity={0.12} />);
  }
  // gable roof
  c.els.push(<path key={key(c)} d={`M${x - w * 0.06} ${gy - wallH} L${x + w / 2} ${gy - wallH - roofH} L${x + w * 1.06} ${gy - wallH} Z`}
    fill="#33363e" stroke={TRIM} strokeWidth={0.7} />);
  if (c.r() < 0.6) c.els.push(<rect key={key(c)} x={x + w * 0.68} y={gy - wallH - roofH * 0.9} width={clamp(c.fpx * 2.4, 2, 5)} height={roofH * 0.65} fill="#514237" stroke={TRIM} strokeWidth={0.4} />);
  if (arch === 'porch-office') {
    // full-width porch: posts and a shed roof
    const pH = wallH * 0.42;
    c.els.push(<line key={key(c)} x1={x - w * 0.03} y1={gy - pH} x2={x + w * 1.03} y2={gy - pH} stroke="#3d3229" strokeWidth={1.8} />);
    for (const u of [0.04, 0.35, 0.65, 0.96]) {
      c.els.push(<line key={key(c)} x1={x + w * u} y1={gy} x2={x + w * u} y2={gy - pH} stroke="#3d3229" strokeWidth={1.1} />);
    }
    // the shingle out front
    c.els.push(<line key={key(c)} x1={x - w * 0.14} y1={gy} x2={x - w * 0.14} y2={gy - pH * 0.8} stroke="#3d3229" strokeWidth={0.9} />);
    c.els.push(<rect key={key(c)} x={x - w * 0.2} y={gy - pH * 0.8} width={w * 0.12} height={pH * 0.28} fill="#d8cba6" opacity={0.9} stroke={TRIM} strokeWidth={0.3} />);
  }
  if (arch === 'stucco-court') {
    // exterior stair and gallery rail
    c.els.push(<path key={key(c)} d={`M${x + w * 0.9} ${gy} L${x + w * 1.06} ${gy - wallH * 0.55}`} fill="none" stroke="#3d3229" strokeWidth={1.4} />);
    c.els.push(<line key={key(c)} x1={x + w * 0.05} y1={gy - wallH * 0.52} x2={x + w * 0.95} y2={gy - wallH * 0.52} stroke="#3d3229" strokeWidth={1.1} opacity={0.9} />);
  }
  windows(c, x + w * 0.08, gy - wallH + 3, w * 0.84, wallH - 6, 2, 3, { tall: true, litBias: 0.5 });
  c.els.push(<rect key={key(c)} x={x + w * 0.44} y={gy - clamp(7.5 * c.fpx, 5, wallH * 0.4)} width={w * 0.12} height={clamp(7.5 * c.fpx, 5, wallH * 0.4)} fill="#241d16" stroke={TRIM} strokeWidth={0.4} />);
}

function drawRowhouse(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint } = d;
  const units = clamp(Math.round(w / (22 * c.fpx * 2.2)), 3, 6);
  const uw = w / units;
  for (let i = 0; i < units; i++) {
    const ux = x + i * uw;
    const ut = i % 2 === 0 ? tint : shade(tint, 0.9 + c.r() * 0.2);
    c.els.push(<rect key={key(c)} x={ux} y={gy - hPx} width={uw} height={hPx} fill={ut} stroke={TRIM} strokeWidth={0.6} />);
    // stoop
    c.els.push(<path key={key(c)} d={`M${ux + uw * 0.32} ${gy} L${ux + uw * 0.32} ${gy - hPx * 0.14} L${ux + uw * 0.52} ${gy - hPx * 0.14} L${ux + uw * 0.58} ${gy} Z`} fill="#3d3229" opacity={0.95} />);
    c.els.push(<rect key={key(c)} x={ux + uw * 0.34} y={gy - hPx * 0.32} width={uw * 0.16} height={hPx * 0.18} fill="#241d16" />);
    windows(c, ux + uw * 0.1, gy - hPx + 3, uw * 0.8, hPx * 0.6, 2, 2, { tall: true, sillStreaks: true, litBias: 0.6 });
    // cornice
    c.els.push(<line key={key(c)} x1={ux - 1} y1={gy - hPx + 1.2} x2={ux + uw + 1} y2={gy - hPx + 1.2} stroke={shade(tint, 0.5)} strokeWidth={1.6} />);
  }
}

function drawGarden(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint, arch } = d;
  const wings = arch === 'courtyard-garden' ? 2 : clamp(Math.round(w / 90), 2, 3);
  const gap = arch === 'courtyard-garden' ? w * 0.18 : w * 0.06;
  const ww = (w - gap * (wings - 1)) / wings;
  for (let i = 0; i < wings; i++) {
    const wx = x + i * (ww + gap);
    const wallH = hPx * 0.75, roofH = hPx * 0.25;
    c.els.push(<rect key={key(c)} x={wx} y={gy - wallH} width={ww} height={wallH} fill={tint} stroke={TRIM} strokeWidth={0.6} />);
    c.els.push(<path key={key(c)} d={`M${wx - 4} ${gy - wallH} L${wx + ww / 2} ${gy - wallH - roofH} L${wx + ww + 4} ${gy - wallH} Z`}
      fill={pick(c.r, ['#2e3038', '#3a2f2a', '#2c3530'] as const)} stroke={TRIM} strokeWidth={0.6} />);
    const rows = Math.max(1, Math.round(wallH / (11 * c.fpx * 2.2)));
    windows(c, wx + ww * 0.07, gy - wallH + 3, ww * 0.86, wallH - 6, clamp(rows, 1, 3), clamp(Math.round(ww / 20), 2, 5), { litBias: 0.6, sillStreaks: true });
    c.els.push(<rect key={key(c)} x={wx + ww * 0.44} y={gy - clamp(7.5 * c.fpx, 4.5, wallH * 0.35)} width={ww * 0.12} height={clamp(7.5 * c.fpx, 4.5, wallH * 0.35)} fill="#241d16" />);
  }
  // the court: trees between the wings
  if (arch === 'courtyard-garden') {
    const cx2 = x + w / 2;
    c.els.push(...tree(cx2 - 6, gy, c.fpx * 0.8, c.r, 'ct1', true, c.season));
    c.els.push(...tree(cx2 + 7, gy, c.fpx * 0.7, c.r, 'ct2', true, c.season));
    c.els.push(<line key={key(c)} x1={cx2 - gap / 2 + 2} y1={gy} x2={cx2 + gap / 2 - 2} y2={gy} stroke="#4a5544" strokeWidth={2} opacity={0.6} />);
  }
}

function drawRetailRun(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint, arch } = d;
  const isAnchor = arch === 'anchor-center';
  const anchorW = isAnchor ? w * 0.28 : 0;
  const runX = x + anchorW, runW = w - anchorW;
  const parapetY = gy - hPx;
  // the run
  c.els.push(<rect key={key(c)} x={runX} y={parapetY} width={runW} height={hPx} fill={tint} stroke={TRIM} strokeWidth={0.7} />);
  if (arch === 'lifestyle-center') {
    // parapet steps bay to bay — the varied roofline is the brand
    const bays = 5;
    for (let i = 0; i < bays; i++) {
      const bx = runX + (runW / bays) * i;
      const lift = (i % 2 === 0 ? 1 : 0.4) * hPx * 0.22 + c.r() * 2;
      c.els.push(<rect key={key(c)} x={bx} y={parapetY - lift} width={runW / bays} height={lift} fill={shade(tint, 0.94 + (i % 3) * 0.06)} stroke={TRIM} strokeWidth={0.5} />);
    }
  }
  if (arch === 'tower-strip') {
    // the corner tower with the center's name — grounded, rising past the parapet
    const tw = clamp(runW * 0.12, 14, 30);
    const th = hPx * 1.7;
    c.els.push(<rect key={key(c)} x={runX + runW - tw} y={gy - th} width={tw} height={th} fill={shade(tint, 0.85)} stroke={TRIM} strokeWidth={0.6} />);
    if (c.occ > 0.25) c.els.push(<rect key={key(c)} x={runX + runW - tw + 2} y={gy - th + 3} width={tw - 4} height={hPx * 0.4} fill={WIN_LIT} opacity={0.8} />);
  }
  const bays = clamp(Math.round(runW / 34), 3, 10);
  storefronts(c, runX, gy, runW, Math.min(13, (hPx / c.fpx) * 0.72), isAnchor ? d.tenants?.slice(1) : d.tenants, bays,
    { awnings: arch === 'awning-strip' || arch === 'storefront-row', arcade: arch === 'arcade-center' });
  // the anchor box
  if (isAnchor) {
    const aH = hPx * 1.5;
    c.els.push(<rect key={key(c)} x={x} y={gy - aH} width={anchorW} height={aH} fill={shade(tint, 0.88)} stroke={TRIM} strokeWidth={0.7} />);
    c.els.push(<rect key={key(c)} x={x + anchorW * 0.25} y={gy - aH * 0.42} width={anchorW * 0.5} height={aH * 0.42} fill={c.occ > 0.2 ? GLASS_LIT : GLASS} opacity={0.9} />);
    const anchorName = d.tenants?.[0]?.name;
    const signH2 = clamp(aH * 0.14, 4, 11);
    if (c.occ > 0.2) {
      if (anchorName && signH2 >= 5 && anchorName.length <= Math.floor(anchorW / (signH2 * 0.66))) {
        c.els.push(<text key={key(c)} x={x + anchorW / 2} y={gy - aH * 0.62} textAnchor="middle" fill={WIN_LIT}
          fontSize={signH2 * 0.85} fontFamily="var(--mono, monospace)" opacity={0.95} letterSpacing={0.5}>
          {anchorName.toUpperCase()}</text>);
      } else {
        c.els.push(<line key={key(c)} x1={x + anchorW * 0.18} y1={gy - aH * 0.66} x2={x + anchorW * 0.82} y2={gy - aH * 0.66} stroke={WIN_LIT} strokeWidth={clamp(signH2 * 0.5, 1.5, 4)} opacity={0.9} />);
      }
    } else {
      // a dark anchor drags the whole center — show the ghost sign
      c.els.push(<rect key={key(c)} x={x + anchorW * 0.2} y={gy - aH * 0.72} width={anchorW * 0.6} height={signH2} fill="#000" opacity={0.18} />);
    }
    rooftopUnits(c, x, gy - aH, anchorW, 2);
  }
  rooftopUnits(c, runX, arch === 'lifestyle-center' ? parapetY - hPx * 0.22 : parapetY, runW, Math.round(runW / 70));
  parapetStreaks(c, runX, parapetY + 1, runW, hPx * 0.5);
  // lifestyle centers plant the sidewalk
  if (arch === 'lifestyle-center' || (c.q >= 105 && FAMILY[arch] === 'retailrun')) {
    c.els.push(...tree(runX + runW * 0.25, gy, c.fpx * 0.7, c.r, 'rt1', true, c.season));
    c.els.push(...tree(runX + runW * 0.7, gy, c.fpx * 0.65, c.r, 'rt2', true, c.season));
  }
}

function drawBigbox(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint } = d;
  c.els.push(<rect key={key(c)} x={x} y={gy - hPx} width={w} height={hPx} fill={tint} stroke={TRIM} strokeWidth={0.8} />);
  // entry portal
  const pw = w * 0.2;
  c.els.push(<rect key={key(c)} x={x + w * 0.4} y={gy - hPx * 1.14} width={pw} height={hPx * 1.14} fill={shade(tint, 0.8)} stroke={TRIM} strokeWidth={0.6} />);
  c.els.push(<rect key={key(c)} x={x + w * 0.43} y={gy - hPx * 0.62} width={pw * 0.7} height={hPx * 0.62} fill={c.occ > 0.2 ? GLASS_LIT : GLASS} opacity={0.95} />);
  if (c.occ > 0.2) {
    c.els.push(<rect key={key(c)} x={x + w * 0.43} y={gy - hPx * 0.62} width={pw * 0.7} height={hPx * 0.62} fill={WIN_LIT} opacity={0.3} />);
    c.els.push(<line key={key(c)} x1={x + w * 0.42} y1={gy - hPx * 0.88} x2={x + w * 0.58} y2={gy - hPx * 0.88} stroke={WIN_LIT} strokeWidth={clamp(hPx * 0.08, 2, 5)} opacity={0.9} />);
  } else {
    c.els.push(<rect key={key(c)} x={x + w * 0.42} y={gy - hPx * 0.92} width={w * 0.16} height={hPx * 0.1} fill="#000" opacity={0.18} />);
  }
  // acres of blank wall get one reveal line
  c.els.push(<line key={key(c)} x1={x} y1={gy - hPx * 0.72} x2={x + w} y2={gy - hPx * 0.72} stroke="#000" strokeWidth={0.4} opacity={0.2} />);
  rooftopUnits(c, x, gy - hPx, w, 4);
  parapetStreaks(c, x, gy - hPx + 1, w, hPx * 0.5);
  // cart corral & a stray cart — you know this parking lot
  if (c.fpx > 0.35) {
    c.els.push(<rect key={key(c)} x={x + w * 0.16} y={gy - 3.4 * c.fpx} width={10 * c.fpx} height={3.4 * c.fpx} fill="none" stroke="#4a525a" strokeWidth={0.6} />);
  }
}

function drawPad(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint, arch } = d;
  const bandCol = pick(c.r, ['#7a3b3b', '#3b5a4a', '#5a4a30', '#3c4a6a'] as const);
  c.els.push(<rect key={key(c)} x={x} y={gy - hPx} width={w} height={hPx} fill={tint} stroke={TRIM} strokeWidth={0.7} />);
  // glass wrap
  c.els.push(<rect key={key(c)} x={x + w * 0.06} y={gy - hPx * 0.72} width={w * 0.88} height={hPx * 0.72} fill={c.occ > 0.2 ? GLASS_LIT : GLASS} opacity={0.92} />);
  if (c.occ > 0.2) c.els.push(<rect key={key(c)} x={x + w * 0.06} y={gy - hPx * 0.5} width={w * 0.88} height={hPx * 0.5} fill={WIN_LIT} opacity={0.3} />);
  // brand band
  c.els.push(<rect key={key(c)} x={x - 1.5} y={gy - hPx - clamp(hPx * 0.22, 3, 8)} width={w + 3} height={clamp(hPx * 0.22, 3, 8)} fill={bandCol} stroke={TRIM} strokeWidth={0.5} />);
  const nm = d.tenants?.[0]?.name;
  if (c.occ > 0.2 && nm && hPx * 0.2 >= 4) {
    c.els.push(<text key={key(c)} x={x + w / 2} y={gy - hPx - clamp(hPx * 0.22, 3, 8) * 0.25} textAnchor="middle" fill="#f2e3c2"
      fontSize={clamp(hPx * 0.18, 4, 8)} fontFamily="var(--mono, monospace)" opacity={0.95}>{nm.toUpperCase().slice(0, 16)}</text>);
  }
  if (arch === 'bank-pad') {
    // columns and a drive-up canopy off the side
    for (const u of [0.12, 0.32, 0.68, 0.88]) {
      c.els.push(<line key={key(c)} x1={x + w * u} y1={gy} x2={x + w * u} y2={gy - hPx * 0.72} stroke="#b8ab8e" strokeWidth={clamp(c.fpx * 1.6, 1.4, 3)} />);
    }
    c.els.push(<line key={key(c)} x1={x + w} y1={gy - hPx * 0.6} x2={x + w * 1.35} y2={gy - hPx * 0.6} stroke={shade(tint, 0.8)} strokeWidth={2.4} />);
    c.els.push(<line key={key(c)} x1={x + w * 1.3} y1={gy - hPx * 0.6} x2={x + w * 1.3} y2={gy} stroke="#3c4249" strokeWidth={1} />);
  }
  if (arch === 'drive-thru') {
    // the lane, the menu board, a car in the queue
    c.els.push(<path key={key(c)} d={`M${x - w * 0.4} ${gy} Q${x - w * 0.15} ${gy - 2} ${x + w * 0.1} ${gy}`} fill="none" stroke="#32383f" strokeWidth={3} opacity={0.7} />);
    c.els.push(<rect key={key(c)} x={x - w * 0.32} y={gy - clamp(6 * c.fpx, 4, 9)} width={clamp(4 * c.fpx, 3, 6)} height={clamp(6 * c.fpx, 4, 9)} fill="#2c343d" stroke={TRIM} strokeWidth={0.4} />);
    if (c.occ > 0.3) c.els.push(...car(x - w * 0.24, gy, c.fpx * 0.9, c.r, 'dtc'));
  }
  // monument sign
  const mx = x + w * 1.18;
  c.els.push(<line key={key(c)} x1={mx} y1={gy} x2={mx} y2={gy - clamp(12 * c.fpx, 7, 16)} stroke="#3c4249" strokeWidth={1.4} />);
  c.els.push(<rect key={key(c)} x={mx - clamp(6 * c.fpx, 4, 9)} y={gy - clamp(12 * c.fpx, 7, 16) - clamp(5 * c.fpx, 3.5, 7)} width={clamp(12 * c.fpx, 8, 18)} height={clamp(5 * c.fpx, 3.5, 7)}
    fill={c.occ > 0.2 ? WIN_LIT : '#2c333b'} opacity={c.occ > 0.2 ? 0.9 : 1} stroke={TRIM} strokeWidth={0.4} />);
}

function drawShed(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint, arch } = d;
  const white = arch === 'cold-store';
  const body = white ? '#c3c1b8' : tint;
  c.els.push(<rect key={key(c)} x={x} y={gy - hPx} width={w} height={hPx} fill={body} stroke={TRIM} strokeWidth={0.8} />);
  // profile: gables for metal, parapet for tilt
  const isMetal = arch === 'pemb' || arch === 'twin-gable' || arch === 'tin-shed' || arch === 'flex-rd';
  if (arch === 'pemb' || arch === 'tin-shed') {
    c.els.push(<path key={key(c)} d={`M${x - 2} ${gy - hPx} L${x + w / 2} ${gy - hPx - hPx * 0.16} L${x + w + 2} ${gy - hPx} Z`} fill={shade(body, 0.85)} stroke={TRIM} strokeWidth={0.6} />);
  }
  if (arch === 'twin-gable') {
    for (const u of [0.25, 0.75]) {
      c.els.push(<path key={key(c)} d={`M${x + w * (u - 0.25)} ${gy - hPx} L${x + w * u} ${gy - hPx - hPx * 0.14} L${x + w * (u + 0.25)} ${gy - hPx} Z`} fill={shade(body, 0.85)} stroke={TRIM} strokeWidth={0.6} />);
    }
  }
  // skin: panel joints (tilt) or ribs (metal)
  const joints = arch === 'tilt-panel' || arch === 'cross-dock' ? Math.round(w / 26) : white ? 5 : Math.round(w / 9);
  for (let i = 1; i < joints; i++) {
    c.els.push(<line key={key(c)} x1={x + (w / joints) * i} y1={gy - hPx + 1} x2={x + (w / joints) * i} y2={gy - 1}
      stroke={white ? '#9aa0a6' : TRIM} strokeWidth={isMetal ? 0.3 : 0.45} opacity={isMetal ? 0.4 : 0.5} />);
  }
  // two-tone wainscot on metal
  if (isMetal && arch !== 'flex-rd') {
    c.els.push(<rect key={key(c)} x={x} y={gy - hPx * 0.24} width={w} height={hPx * 0.24} fill={pick(c.r, ['#4a5560', '#5c5248', '#4e5a50'] as const)} opacity={0.85} />);
  }
  // office bite: glass corner on tilt & flex
  if (arch === 'tilt-panel' || arch === 'flex-rd') {
    const ow = arch === 'flex-rd' ? w * 0.3 : w * 0.14;
    c.els.push(<rect key={key(c)} x={x + 2} y={gy - hPx * 0.8} width={ow} height={hPx * 0.8} fill={c.occ > 0.25 ? GLASS_LIT : GLASS} opacity={0.9} />);
    if (c.occ > 0.25) c.els.push(<rect key={key(c)} x={x + 2} y={gy - hPx * 0.55} width={ow} height={hPx * 0.55} fill={WIN_LIT} opacity={0.28} />);
    c.els.push(<line key={key(c)} x1={x} y1={gy - hPx * 0.82} x2={x + w} y2={gy - hPx * 0.82} stroke="#565e66" strokeWidth={0.6} opacity={0.6} />);
  }
  // docks
  const dockStart = arch === 'flex-rd' ? 0.38 : arch === 'tilt-panel' ? 0.2 : 0.1;
  const doors = arch === 'cold-store' ? 2 : clamp(Math.round(d.sf / 11000), 2, 9);
  const dh = clamp(hPx * 0.42, 5, 13 * c.fpx * 2.2);
  for (let i = 0; i < doors; i++) {
    const u0 = dockStart + ((i + 0.25) / doors) * (0.96 - dockStart);
    const dw2 = ((0.96 - dockStart) / doors) * w * 0.42;
    const dx2 = x + u0 * w;
    const open = c.r() < c.occ * 0.4;
    c.els.push(<rect key={key(c)} x={dx2} y={gy - dh} width={dw2} height={dh} fill={open ? '#171d24' : '#262e36'} stroke={TRIM} strokeWidth={0.5} />);
    // door slats
    if (!open && dh > 5) for (let s2 = 1; s2 < 4; s2++) {
      c.els.push(<line key={key(c)} x1={dx2} y1={gy - (dh / 4) * s2} x2={dx2 + dw2} y2={gy - (dh / 4) * s2} stroke="#000" strokeWidth={0.3} opacity={0.3} />);
    }
    if (open && c.fpx > 0.18) {
      // a trailer backed in
      c.els.push(<rect key={key(c)} x={dx2 - dw2 * 0.15} y={gy - dh * 0.85} width={dw2 * 1.3} height={dh * 0.62} fill="#8b9096" stroke={TRIM} strokeWidth={0.4} />);
      c.els.push(<circle key={key(c)} cx={dx2 + dw2 * 0.9} cy={gy - 1} r={clamp(dh * 0.1, 0.8, 2)} fill="#0d1116" />);
    }
  }
  // rust on old tin
  if (arch === 'tin-shed' && c.weather && c.age > 12) {
    for (let i = 0; i < 4; i++) {
      c.els.push(<ellipse key={key(c)} cx={x + w * (0.1 + c.r() * 0.8)} cy={gy - hPx * (0.2 + c.r() * 0.6)}
        rx={3 + c.r() * 6} ry={2 + c.r() * 3} fill="#6e4a30" opacity={0.25 + c.r() * 0.15} />);
    }
  }
  // roof gear
  if (white) {
    // compressor plant + steam
    for (let i = 0; i < 3; i++) {
      c.els.push(<rect key={key(c)} x={x + w * (0.5 + i * 0.12)} y={gy - hPx - clamp(hPx * 0.2, 3, 7)} width={clamp(w * 0.07, 5, 12)} height={clamp(hPx * 0.2, 3, 7)} fill="#4e565e" stroke={TRIM} strokeWidth={0.4} />);
    }
    if (c.occ > 0.35) c.els.push(<circle key={key(c)} cx={x + w * 0.58} cy={gy - hPx - clamp(hPx * 0.32, 5, 10)} r={2.4} fill="#c8cdd2" opacity={0.25} />);
  } else {
    rooftopUnits(c, x, gy - hPx - (arch === 'pemb' || arch === 'tin-shed' ? hPx * 0.12 : 0), w, Math.round(w / 90) + 1);
  }
  // stack on the old ones
  if ((arch === 'tin-shed' || arch === 'dock-shed') && c.age > 15) {
    const sx = x + w * 0.82;
    c.els.push(<line key={key(c)} x1={sx} y1={gy - hPx} x2={sx} y2={gy - hPx * 1.5} stroke="#3c4249" strokeWidth={1.8} />);
    if (c.occ > 0.35) for (let i = 0; i < 3; i++) {
      c.els.push(<circle key={key(c)} cx={sx + 1 + i} cy={gy - hPx * 1.5 - 3 - i * 3.4} r={1.4 + i * 0.7} fill="#8a9097" opacity={0.2 - i * 0.05} />);
    }
  }
  parapetStreaks(c, x, gy - hPx + 1, w, hPx * 0.4);
}
function drawSawtooth(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint } = d;
  c.els.push(<rect key={key(c)} x={x} y={gy - hPx} width={w} height={hPx} fill={tint} stroke={TRIM} strokeWidth={0.8} />);
  const teeth = clamp(Math.round(w / 46), 3, 7);
  const toothH = clamp(hPx * 0.42, 6, 20);
  for (let i = 0; i < teeth; i++) {
    const u0 = x + (w / teeth) * i, u1 = x + (w / teeth) * (i + 1);
    const peak = u0 + (u1 - u0) * 0.3;
    const lit = c.r() < c.occ * 0.7;
    // the solid slope, then the north-light glazing on the steep face
    c.els.push(<path key={key(c)} d={`M${u0} ${gy - hPx} L${peak} ${gy - hPx - toothH} L${u1} ${gy - hPx} Z`} fill={shade(tint, 0.62)} stroke={TRIM} strokeWidth={0.5} />);
    c.els.push(<path key={key(c)} d={`M${peak} ${gy - hPx - toothH} L${u1} ${gy - hPx} L${u1 - (u1 - peak) * 0.12} ${gy - hPx} Z`}
      fill={lit ? WIN_LIT : '#26313c'} opacity={lit ? 0.85 : 0.95} />);
  }
  windows(c, x + w * 0.06, gy - hPx * 0.72, w * 0.88, hPx * 0.5, 1, clamp(Math.round(w / 22), 3, 8), { litBias: 0.5, tall: true });
  for (let i = 1; i < Math.round(w / 30); i++) {
    c.els.push(<line key={key(c)} x1={x + (w / Math.round(w / 30)) * i} y1={gy - hPx + 1} x2={x + (w / Math.round(w / 30)) * i} y2={gy - 1} stroke={TRIM} strokeWidth={0.35} opacity={0.4} />);
  }
  // brick weathering: efflorescence at grade
  if (c.weather && c.age > 25) c.els.push(<rect key={key(c)} x={x} y={gy - hPx * 0.1} width={w} height={hPx * 0.1} fill="#d8d2c2" opacity={0.1} />);
  const sx = x + w * 0.16;
  c.els.push(<line key={key(c)} x1={sx} y1={gy - hPx} x2={sx} y2={gy - hPx * 1.7} stroke="#3c4249" strokeWidth={2} />);
  if (c.occ > 0.35) for (let i = 0; i < 3; i++) {
    c.els.push(<circle key={key(c)} cx={sx + 1 + i * 1.2} cy={gy - hPx * 1.7 - 3 - i * 3.6} r={1.5 + i * 0.8} fill="#8a9097" opacity={0.2 - i * 0.05} />);
  }
}

function drawQuonset(c: Ctx, d: Draw) {
  const { x, gy, hPx, tint } = d;
  // the surplus hut, seen down its length: a modest half-cylinder, not a hangar
  const w = Math.min(d.w, hPx * 2.6);
  const bx = x + (d.w - w) / 2;
  const vh = hPx * 0.85;
  c.els.push(<path key={key(c)} d={`M${bx} ${gy} Q${bx} ${gy - vh} ${bx + w / 2} ${gy - vh} Q${bx + w} ${gy - vh} ${bx + w} ${gy} Z`}
    fill={tint} stroke={TRIM} strokeWidth={0.8} />);
  // corrugation ribs following the vault
  for (let i = 1; i < 9; i++) {
    const u = i / 9;
    c.els.push(<line key={key(c)} x1={bx + w * u} y1={gy} x2={bx + w * u} y2={gy - vh * Math.sin(u * Math.PI) * 0.96 - (u > 0.2 && u < 0.8 ? vh * 0.04 : 0)} stroke={TRIM} strokeWidth={0.3} opacity={0.35} />);
  }
  // sheen along the crown
  c.els.push(<path key={key(c)} d={`M${bx + w * 0.2} ${gy - vh * 0.78} Q${bx + w / 2} ${gy - vh * 1.02} ${bx + w * 0.8} ${gy - vh * 0.78}`}
    fill="none" stroke="#8a939a" strokeWidth={1} opacity={0.6} />);
  // end door
  c.els.push(<rect key={key(c)} x={bx + w * 0.38} y={gy - vh * 0.62} width={w * 0.24} height={vh * 0.62} fill="#262c33" stroke={TRIM} strokeWidth={0.5} />);
  if (c.weather && c.age > 18) c.els.push(<path key={key(c)} d={`M${bx + w * 0.08} ${gy - 2} L${bx + w * 0.92} ${gy - 2}`} stroke="#6e4a30" strokeWidth={1.2} opacity={0.4} />);
}

function drawYard(c: Ctx, d: Draw) {
  const { x, gy, w, hPx, tint } = d;
  const shedW = w * 0.42;
  c.els.push(<rect key={key(c)} x={x} y={gy - hPx} width={shedW} height={hPx} fill={tint} stroke={TRIM} strokeWidth={0.7} />);
  c.els.push(<path key={key(c)} d={`M${x - 2} ${gy - hPx} L${x + shedW / 2} ${gy - hPx - hPx * 0.2} L${x + shedW + 2} ${gy - hPx} Z`} fill={shade(tint, 0.85)} stroke={TRIM} strokeWidth={0.5} />);
  c.els.push(<rect key={key(c)} x={x + shedW * 0.3} y={gy - hPx * 0.6} width={shedW * 0.32} height={hPx * 0.6} fill="#262c33" stroke={TRIM} strokeWidth={0.5} />);
  // the fenced yard: posts, wire, stacked material
  const yx = x + shedW + w * 0.04, yw = w - shedW - w * 0.04;
  const fh = clamp(hPx * 0.5, 5, 8 * c.fpx * 2.2);
  for (let i = 0; i <= 4; i++) {
    c.els.push(<line key={key(c)} x1={yx + (yw / 4) * i} y1={gy} x2={yx + (yw / 4) * i} y2={gy - fh} stroke="#54493c" strokeWidth={0.8} />);
  }
  c.els.push(<line key={key(c)} x1={yx} y1={gy - fh} x2={yx + yw} y2={gy - fh} stroke="#6b6154" strokeWidth={0.5} strokeDasharray="1.5 1.5" opacity={0.9} />);
  c.els.push(<line key={key(c)} x1={yx} y1={gy - fh * 0.55} x2={yx + yw} y2={gy - fh * 0.55} stroke="#6b6154" strokeWidth={0.4} strokeDasharray="1.5 1.5" opacity={0.7} />);
  for (let i = 0; i < 3; i++) {
    const px2 = yx + yw * (0.12 + i * 0.3);
    const ph2 = fh * (0.4 + c.r() * 0.5);
    c.els.push(<rect key={key(c)} x={px2} y={gy - ph2} width={yw * 0.18} height={ph2} fill={pick(c.r, ['#6e5a40', '#5c5248', '#556052'] as const)} stroke={TRIM} strokeWidth={0.3} />);
  }
}

// ---------- construction site ----------
function drawSite(c: Ctx, d: Draw, progress: number) {
  const { x, gy, w, hPx, stories } = d;
  const doneFl = clamp(Math.round(stories * progress), 1, stories);
  const floorPx = hPx / stories;
  const builtH = doneFl * floorPx;
  // the pit & pad
  c.els.push(<rect key={key(c)} x={x - w * 0.1} y={gy - 2} width={w * 1.2} height={2} fill="#4a4438" opacity={0.8} />);
  // core rises ahead of the slabs on towers
  if (stories >= 6) {
    const coreH = Math.min(hPx, builtH + floorPx * 2.5);
    c.els.push(<rect key={key(c)} x={x + w * 0.42} y={gy - coreH} width={w * 0.16} height={coreH} fill="#6a6f75" stroke={TRIM} strokeWidth={0.5} />);
  }
  // slab stack: clad below, bare frame on the top two working floors
  const bareFrom = doneFl <= 2 ? doneFl : doneFl - 2;
  for (let i = 0; i < doneFl; i++) {
    const fy = gy - (i + 1) * floorPx;
    if (i < bareFrom) {
      c.els.push(<rect key={key(c)} x={x} y={fy} width={w} height={floorPx} fill={d.tint} opacity={0.55} />);
    } else {
      // open frame: columns between the plates
      const nCol = clamp(Math.round(w / 24), 3, 9);
      for (let cx2 = 0; cx2 <= nCol; cx2++) {
        c.els.push(<line key={key(c)} x1={x + (w / nCol) * cx2} y1={fy} x2={x + (w / nCol) * cx2} y2={fy + floorPx} stroke="#7a7f86" strokeWidth={1} opacity={0.95} />);
      }
    }
    c.els.push(<line key={key(c)} x1={x - 1.5} y1={fy} x2={x + w + 1.5} y2={fy} stroke="#8a8f96" strokeWidth={1.5} opacity={0.95} />);
  }
  c.els.push(<rect key={key(c)} x={x} y={gy - builtH} width={w} height={builtH} fill="none" stroke="#8a8f96" strokeWidth={0.6} opacity={0.7} />);
  // safety wrap on the working floor
  if (doneFl >= 2) {
    c.els.push(<rect key={key(c)} x={x - 1} y={gy - builtH} width={w + 2} height={floorPx * 0.85} fill="#d9782e" opacity={0.3} />);
  }
  // the crane: base, mast, jib, counter-jib, cable, hook — always on the canvas
  const craneX = x + w * (stories >= 6 ? 0.78 : 0.88);
  const craneTop = Math.max(16, gy - builtH - floorPx * 2 - 14);
  c.els.push(<line key={key(c)} x1={craneX} y1={gy} x2={craneX} y2={craneTop} stroke="#c9a04f" strokeWidth={1.6} />);
  for (let i = 1; i < (gy - craneTop) / 7; i++) {
    c.els.push(<line key={key(c)} x1={craneX - 1.6} y1={gy - i * 7} x2={craneX + 1.6} y2={gy - i * 7 - 5} stroke="#c9a04f" strokeWidth={0.4} opacity={0.8} />);
  }
  const jibL = Math.min(w * 0.55, 90);
  c.els.push(<line key={key(c)} x1={craneX - jibL * 0.35} y1={craneTop} x2={craneX + jibL} y2={craneTop} stroke="#c9a04f" strokeWidth={1.3} />);
  c.els.push(<line key={key(c)} x1={craneX} y1={craneTop - 6} x2={craneX + jibL} y2={craneTop} stroke="#c9a04f" strokeWidth={0.5} />);
  c.els.push(<line key={key(c)} x1={craneX} y1={craneTop - 6} x2={craneX - jibL * 0.35} y2={craneTop} stroke="#c9a04f" strokeWidth={0.5} />);
  c.els.push(<line key={key(c)} x1={craneX} y1={craneTop} x2={craneX} y2={craneTop - 6} stroke="#c9a04f" strokeWidth={1} />);
  const hookX = craneX + jibL * (0.35 + c.r() * 0.4);
  const hookDrop = Math.min(gy - craneTop - 6, 14 + c.r() * 10);
  c.els.push(<line key={key(c)} x1={hookX} y1={craneTop} x2={hookX} y2={craneTop + hookDrop} stroke="#8a8f96" strokeWidth={0.5} />);
  c.els.push(<rect key={key(c)} x={hookX - 2} y={craneTop + hookDrop} width={4} height={2.6} fill="#6a6f75" />);
  // fence + gate + a materials pile
  for (let i = 0; i <= Math.round(w / 12) + 2; i++) {
    const fx = x - w * 0.1 + i * 12;
    if (fx > x + w * 1.1) break;
    c.els.push(<line key={key(c)} x1={fx} y1={gy} x2={fx} y2={gy - 4.5} stroke="#5a5244" strokeWidth={0.6} />);
  }
  c.els.push(<line key={key(c)} x1={x - w * 0.1} y1={gy - 4.5} x2={x + w * 1.1} y2={gy - 4.5} stroke="#5a5244" strokeWidth={0.7} />);
  c.els.push(<rect key={key(c)} x={x - w * 0.06} y={gy - 3.2} width={9} height={3.2} fill="#8a6d3a" opacity={0.9} />);
  c.els.push(<rect key={key(c)} x={x + w * 0.06} y={gy - 2.4} width={7} height={2.4} fill="#6a6f75" opacity={0.9} />);
}

// ---------- the component ----------
export function Portrait({ b, w = 460, h = 210, caption = true }: { b: PortraitSubject; w?: number; h?: number; caption?: boolean }) {
  const W = w, H = h;
  const seed = b.seed ?? ((b.sf | 0) * 31 + b.type.length * 7 + Math.round(b.quality));
  const r = rng32(seed);
  const occ = b.progress !== undefined ? 0 : (b.proposed ? 0.62 : clamp(b.occ ?? 0.7, 0, 1));
  const age = b.proposed ? 0 : (b.age ?? 10);
  const stories = b.stories ?? storiesFor(b.type, b.construction, b.sf, Math.max(1, b.siteCells ?? Math.ceil(b.sf / 12000)));

  const params: ArtParams = { type: b.type, construction: b.construction, quality: b.quality, age, sf: b.sf, occ, seed };
  const arch = pickArchetype(params, stories, r);
  const fam = FAMILY[arch];
  let tint: string = pick(r, PALETTES[ARCH_PALETTE[arch]]);
  if (b.designTier === 've') tint = shade(tint, 0.92);

  // scene metrics: feet → pixels, one scale for everything
  const gy = H - (caption ? 34 : 22);            // ground line
  const skyH = gy;
  const hFt = stories * 13 + 6;                  // + parapet
  const wFt = frontageFt(fam, b.sf, stories);
  const usable = gy - 22;                        // headroom for cranes and crowns
  const fpx = clamp(usable / hFt, 0.16, 2.4);   // feet-per-pixel — capped so pads don't loom
  const hPx = hFt * fpx;
  const wPxRaw = wFt * fpx;
  const wPx = clamp(wPxRaw, 30, W * 0.78);
  const x = (W - wPx) / 2 - (fam === 'pad' ? W * 0.05 : 0);   // pads shift left for the sign

  const pseason: PSeason = b.proposed || b.month === undefined ? 'summer' : seasonOfMonth(b.month);
  const c: Ctx = { r, q: b.quality, age, occ, fpx, weather: !b.proposed, season: pseason, els: [], k: 0 };
  const d: Draw = { x, gy, w: wPx, hPx, stories, tint, arch, sf: b.sf, tenants: b.tenants };

  // --- sky ---
  const gid = 'pg' + (seed >>> 0).toString(36);
  const sky = (
    <g key="sky">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={SKY_TOP} />
          <stop offset="62%" stopColor={SKY_MID} />
          <stop offset="100%" stopColor={SKY_GLOW} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={W} height={skyH} fill={`url(#${gid})`} />
      {Array.from({ length: 7 }, (_, i) => {
        const su = seed >>> 0;   // unsigned everywhere — a negative seed once fed % and produced negative rects
        const sx = (su % 97 + i * 61.7) % W, sy = ((su >>> 3) % 53 + i * 23.3) % (skyH * 0.5);
        return <circle key={'st' + i} cx={sx} cy={sy} r={0.7} fill="#cdd6e2" opacity={0.35} />;
      })}
      {/* a far skyline behind everything — the city the building lives in */}
      {Array.from({ length: 9 }, (_, i) => {
        const su = seed >>> 0;
        const bw2 = 18 + ((su >>> i) % 23), bh2 = 12 + ((su >>> (i + 2)) % 44);
        const bx2 = (i / 9) * W + ((su >>> i) % 11) - 8;
        return <rect key={'bg' + i} x={bx2} y={gy - bh2} width={bw2} height={bh2} fill="#1b2431" opacity={0.75} />;
      })}
    </g>
  );

  // --- ground ---
  const ground = (
    <g key="gnd">
      <rect x={0} y={gy} width={W} height={8} fill={SIDEWALK} />
      {pseason === 'winter' && <rect x={0} y={gy} width={W} height={8} fill="#dfe5ea" opacity={0.28} />}
      <line x1={0} y1={gy} x2={W} y2={gy} stroke="#565c64" strokeWidth={0.8} />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={'sj' + i} x1={(i + 0.5) * (W / 8)} y1={gy} x2={(i + 0.4) * (W / 8)} y2={gy + 8} stroke="#2c3138" strokeWidth={0.5} opacity={0.7} />
      ))}
      <rect x={0} y={gy + 8} width={W} height={H - gy - 8} fill={ROAD} />
      <line x1={0} y1={gy + 8} x2={W} y2={gy + 8} stroke="#3a3f46" strokeWidth={1} />
      {Array.from({ length: 6 }, (_, i) => (
        <line key={'ln' + i} x1={i * (W / 5.5) + 6} y1={gy + Math.min(16, (H - gy) * 0.75)} x2={i * (W / 5.5) + 20} y2={gy + Math.min(16, (H - gy) * 0.75)} stroke="#4a4f38" strokeWidth={1.2} opacity={0.6} />
      ))}
    </g>
  );

  // --- the building ---
  if (b.progress !== undefined) {
    drawSite(c, d, clamp(b.progress, 0.04, 0.97));
  } else {
    switch (fam) {
      case 'tower': drawTower(c, d); break;
      case 'midrise': drawMidrise(c, d); break;
      case 'house': drawHouse(c, d); break;
      case 'rowhouse': drawRowhouse(c, d); break;
      case 'garden': drawGarden(c, d); break;
      case 'retailrun': drawRetailRun(c, d); break;
      case 'bigbox': drawBigbox(c, d); break;
      case 'pad': drawPad(c, d); break;
      case 'shed': drawShed(c, d); break;
      case 'sawtooth': drawSawtooth(c, d); break;
      case 'quonset': drawQuonset(c, d); break;
      case 'yard': drawYard(c, d); break;
    }
  }

  // --- winter: snow settles on the flat parapets and the sidewalk ---
  if (pseason === 'winter' && b.progress === undefined && (fam === 'tower' || fam === 'midrise' || fam === 'retailrun' || fam === 'bigbox' || fam === 'shed' || fam === 'pad')) {
    c.els.push(<line key="snowcap" x1={x + 1} y1={gy - hPx + 0.4} x2={x + wPx - 1} y2={gy - hPx + 0.4}
      stroke="#e2e8ec" strokeWidth={clamp(fpx * 1.6, 1.2, 2.6)} opacity={0.85} strokeLinecap="round" />);
  }

  // --- entourage, scaled by the same feet ---
  const ent: El[] = [];
  const entR = rng32(seed ^ 0x5f5f5f);
  if (b.progress === undefined) {
    // trees flank unless it's an industrial pad
    if (fam !== 'shed' && fam !== 'sawtooth' && fam !== 'yard' && fam !== 'quonset' && fam !== 'bigbox') {
      ent.push(...tree(x - 18, gy, Math.max(fpx, 0.5), entR, 'tl', b.quality >= 95 || !!b.proposed, pseason));
      if (entR() < 0.7) ent.push(...tree(x + wPx + 16, gy, Math.max(fpx, 0.45), entR, 'tr', b.quality >= 95, pseason));
    }
    ent.push(...streetlight(x - 34, gy, Math.max(fpx, 0.42), 'sl', occ > 0.05 || !!b.proposed));
    // people in proportion to occupancy; a dead building has a dead sidewalk
    const nPeople = occ > 0.6 ? 3 : occ > 0.25 ? 2 : occ > 0.05 ? 1 : 0;
    for (let i = 0; i < nPeople; i++) {
      ent.push(...person(x + wPx * (0.15 + entR() * 0.75), gy + 3 + entR() * 3, Math.max(fpx, 0.42), 'pp' + i));
    }
    if (entR() < 0.75 && fam !== 'pad') ent.push(...car(x + wPx + 26 + entR() * 20, gy + Math.min(14, (H - gy) * 0.65), Math.max(fpx, 0.4), entR, 'cc'));
  } else {
    // a site gets a worker and a pickup
    ent.push(...person(x - 10, gy, Math.max(fpx, 0.42), 'wk', '#8a5a20'));
    ent.push(...car(x + wPx + 18, gy + Math.min(12, (H - gy) * 0.6), Math.max(fpx, 0.42), entR, 'tk'));
  }

  // --- caption ---
  const grade = E.QLABEL[E.qGrade(b.quality)];
  const spec = (E.CONSTR[b.type] ?? []).find(s2 => s2.id === b.construction);
  const specLabel = (spec?.label ?? b.construction).toUpperCase();
  const year = 2026 - Math.round(age);
  const capText = b.progress !== undefined
    ? `${specLabel} · ${(b.sf / 1000).toFixed(0)}K SF · ${Math.round(clamp(b.progress, 0, 1) * 100)}% BUILT`
    : b.proposed
      ? `PROPOSED · ${specLabel} · ${(b.sf / 1000).toFixed(0)}K SF · ${stories} FL`
      : `${specLabel} · CLASS ${grade} · ${(b.sf / 1000).toFixed(0)}K SF · ${stories} FL · BUILT ${year}`;
  const capRight = b.progress !== undefined ? '' : b.proposed ? (b.designTier === 'signature' ? 'SIGNATURE DESIGN' : b.designTier === 've' ? 'VALUE-ENGINEERED' : '') : b.occ !== undefined ? `${Math.round(occ * 100)}% LEASED` : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block', borderRadius: 6, border: '1px solid var(--line, #2a2f36)' }}>
      {sky}
      {ground}
      <g>{c.els}</g>
      <g>{ent}</g>
      {caption && (
        <g>
          <rect x={0} y={H - 15} width={W} height={15} fill="#0d1116" opacity={0.92} />
          <text x={7} y={H - 4.5} fill="#8a93a0" fontSize={8} fontFamily="var(--mono, monospace)" letterSpacing={0.5}>{capText}</text>
          {capRight && <text x={W - 7} y={H - 4.5} textAnchor="end" fill={occ >= 0.75 ? '#7fae8a' : occ >= 0.4 ? '#c9a04f' : '#b0654a'} fontSize={8} fontFamily="var(--mono, monospace)" letterSpacing={0.5}>{capRight}</text>}
        </g>
      )}
    </svg>
  );
}
