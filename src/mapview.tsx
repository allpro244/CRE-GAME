import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as E from './engine';
import type { GameState, StockBuilding, Tile } from './engine';
import { Modal, Hint, blockName, pct } from './views2';
import { Portrait, mapSeed } from './portrait';
import { AMBIENT_LABELS, loadAmbient, saveAmbient, prefersReducedMotion } from './ambient';
import type { AmbientLevel } from './ambient';
import { buildingArt, siteArt, storiesFor } from './buildingArt';

type Lens = 'city' | 'land' | 'zoning' | 'office' | 'retail' | 'industrial' | 'multifamily' | 'crime' | 'comps';
const LENSES: { id: Lens; label: string }[] = [
  { id: 'city', label: 'City' }, { id: 'land', label: 'Land $' }, { id: 'zoning', label: 'Zoning' },
  { id: 'office', label: 'Office rents' },
  { id: 'retail', label: 'Retail rents' }, { id: 'industrial', label: 'Industrial fit' },
  { id: 'multifamily', label: 'Residential rents' }, { id: 'crime', label: 'Crime' },
  { id: 'comps', label: 'Comps' },
];
// the colors every zoning map has used since 1926
const ZONE_COL: Record<E.ZoneUse, string> = { R: '#8fb872', C: '#c9604f', MU: '#d29a44', M: '#8579bd' };

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const TS = 52;   // px per tile
const SUB = 3;   // subdivision per tile for the continuous field

function lensRaw(state: GameState, t: Tile, lens: Lens): number {
  if (lens === 'city') return 0;
  if (lens === 'zoning') return t.zone.tier / 3;
  if (lens === 'land') return E.landPricePerAcre(state, t) / 1e6;
  if (lens === 'office') return Math.min(1, (E.marketRentPSF(state, t, 'office') - 10) / 30);
  if (lens === 'retail') return Math.min(1, (E.marketRentPSF(state, t, 'retail') - 7) / 22);
  if (lens === 'industrial') return t.indSuit / 100;
  if (lens === 'multifamily') return Math.min(1, (E.marketRentPSF(state, t, 'multifamily') - 11) / 22);
  if (lens === 'comps') {
    const near = state.comps.filter(c => c.tileI === t.i && c.sf > 0);
    if (!near.length) return 0;
    const psf = near.reduce((s2, c) => s2 + c.price / c.sf, 0) / near.length;
    return Math.min(1, psf / 320);
  }
  return t.crime / 85;
}
const LENS_HUE: Record<Lens, [number, number, number]> = {
  city: [206, 210, 198], land: [150, 106, 20], zoning: [160, 160, 160], office: [140, 74, 210], retail: [40, 106, 220],
  industrial: [30, 140, 92], multifamily: [212, 72, 150], crime: [210, 60, 60],
  comps: [70, 170, 120],
};

// Lens inputs move on the quarterly tile tick plus slow composition changes — a heat
// map doesn't need to repaint 4,480 parcels because an unrelated action cloned the state.
function lensStamp(state: GameState, lens: Lens): string {
  return lens + ':' + state.seed + ':' + Math.floor(state.month / 3) + ':' + state.stock.length
    + ':' + state.assets.length + ':' + ((state.comps?.length ?? 0)) + ':' + state.land.length;
}

// The market isn't a checkerboard — value pools and drains across the city.
// Bilinear interpolation over tile centers gives the field its continuous grain.
function useTileValues(state: GameState, lens: Lens): number[] {
  const stamp = lensStamp(state, lens);
  return useMemo(() => {
    const rawOf = (t: Tile) => lensRaw(state, t, lens);
    const landVals = state.tiles.filter(t => !t.water).map(rawOf).sort((a, b) => a - b);
    const lo = landVals[Math.floor(landVals.length * 0.10)] ?? 0;
    const hi = landVals[Math.floor(landVals.length * 0.90)] ?? 1;
    return state.tiles.map(t => {
      const raw = rawOf(t);
      return hi > lo ? Math.max(0, Math.min(1, (raw - lo) / (hi - lo))) : 0.5;
    });
  }, [stamp]); // eslint-disable-line
}

function useField(state: GameState, lens: Lens) {
  const stamp = lensStamp(state, lens);
  return useMemo(() => {
    const W = E.CONFIG.GRID_W, H = E.CONFIG.GRID_H;
    const lensRaw2 = (st: GameState, t: Tile, ln: Lens) => lensRaw(st, t, ln);
    // normalize against the city's own spread — a flat lens tells you nothing
    const landVals = state.tiles.filter(t => !t.water).map(t => lensRaw2(state, t, lens)).sort((a, b) => a - b);
    const lo = landVals[Math.floor(landVals.length * 0.06)] ?? 0;
    const hi = landVals[Math.floor(landVals.length * 0.94)] ?? 1;
    const norm = (raw: number) => hi > lo ? Math.max(0, Math.min(1, (raw - lo) / (hi - lo))) : 0.5;
    const V: number[][] = [];
    for (let y = 0; y < H; y++) {
      V.push([]);
      for (let x = 0; x < W; x++) {
        const t = state.tiles[y * W + x];
        if (!t.water) { V[y].push(norm(lensRaw2(state, t, lens))); continue; }
        // water tiles borrow neighbors so the field flows under the river
        let s = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nt = state.tiles[(y + dy) * W + (x + dx)];
          if (nt && !nt.water && nt.x === x + dx) { s += norm(lensRaw2(state, nt, lens)); n++; }
        }
        V[y].push(n ? s / n : 0.2);
      }
    }
    const sample = (px: number, py: number) => {
      const gx = Math.min(W - 1.001, Math.max(0, px - 0.5));
      const gy = Math.min(H - 1.001, Math.max(0, py - 0.5));
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const v00 = V[y0][x0], v10 = V[y0][Math.min(W - 1, x0 + 1)];
      const v01 = V[Math.min(H - 1, y0 + 1)][x0], v11 = V[Math.min(H - 1, y0 + 1)][Math.min(W - 1, x0 + 1)];
      return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
    };
    const cells: { x: number; y: number; v: number }[] = [];
    const step = 1 / SUB;
    for (let y = 0; y < H * SUB; y++) for (let x = 0; x < W * SUB; x++) {
      cells.push({ x: x * step, y: y * step, v: sample((x + 0.5) * step, (y + 0.5) * step) });
    }
    return cells;
  }, [stamp]); // eslint-disable-line
}

function riverGeometry(state: GameState) {
  const water = state.tiles.filter(t => t.water && !t.park);
  if (water.length > 20) return '';   // island city: shores, not a river
  const byRow = new Map<number, number[]>();
  for (const t of water) { if (!byRow.has(t.y)) byRow.set(t.y, []); byRow.get(t.y)!.push(t.x); }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  if (!rows.length) return '';
  const pts = rows.map(y => {
    const xs = byRow.get(y)!;
    return [(Math.min(...xs) + Math.max(...xs) + 1) / 2 * TS, (y + 0.5) * TS] as [number, number];
  });
  let d = `M${pts[0][0]} ${(rows[0]) * TS - 8}`;
  for (const p of pts) d += `L${p[0]} ${p[1]}`;
  d += `L${pts[pts.length - 1][0]} ${(rows[rows.length - 1] + 1) * TS + 8}`;
  return d;
}



// ================= isometric (2.5D) renderer =================
const IW = 64, IH = 32;              // diamond tile footprint
const IOX = 40, IOY = 96;            // origin padding: room for towers above row 0
function isoPt(x: number, y: number): [number, number] {
  return [IOX + (x - y) * (IW / 2) + (E.CONFIG.GRID_H - 1) * (IW / 2), IOY + (x + y) * (IH / 2)];
}
const PG = E.PGRID, STREET = 0.16; // fraction of the block given to surrounding streets
// map a parcel (px,py) within block (bx,by) to fractional tile coords
function parcelCenter(bx: number, by: number, px: number, py: number, pw = 1, ph = 1): [number, number] {
  const inner = 1 - STREET;
  const cx = (px + pw / 2) / PG, cy = (py + ph / 2) / PG;
  return [bx - 0.5 + STREET / 2 + cx * inner, by - 0.5 + STREET / 2 + cy * inner];
}
function parcelSpan(pw: number, ph: number): [number, number] {
  const inner = 1 - STREET;
  return [(pw / PG) * inner, (ph / PG) * inner];
}
function rectPoly(cx: number, cy: number, w: number, h: number, lift = 0): string {
  const p = (x: number, y: number) => isoPt(x, y);
  const a = p(cx - w / 2, cy - h / 2), b = p(cx + w / 2, cy - h / 2);
  const c = p(cx + w / 2, cy + h / 2), d = p(cx - w / 2, cy + h / 2);
  return [a, b, c, d].map(q => `${q[0].toFixed(1)},${(q[1] - lift).toFixed(1)}`).join(' ');
}
function prismFaces(cx: number, cy: number, w: number, h: number, ht: number): { l: string; r: string; t: string } {
  const p = (x: number, y: number) => isoPt(x, y);
  const bl = p(cx - w / 2, cy + h / 2), bb = p(cx + w / 2, cy + h / 2), br = p(cx + w / 2, cy - h / 2);
  const L = [bl, bb, [bb[0], bb[1] - ht], [bl[0], bl[1] - ht]];
  const R = [bb, br, [br[0], br[1] - ht], [bb[0], bb[1] - ht]];
  const fmt = (arr: any[]) => arr.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  return { l: fmt(L), r: fmt(R), t: rectPoly(cx, cy, w, h, ht) };
}

function diamond(x: number, y: number, f = 1, lift = 0): string {
  const [cx, cy] = isoPt(x, y);
  return `${cx},${cy - (IH * f) / 2 - lift} ${cx + (IW * f) / 2},${cy - lift} ${cx},${cy + (IH * f) / 2 - lift} ${cx - (IW * f) / 2},${cy - lift}`;
}
function shade(hex: string, m: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * m));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * m));
  const b = Math.min(255, Math.round((n & 255) * m));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
// True massing: stories and footprint derived from the building's actual square
// footage against its actual land. A 60K SF warehouse sprawls one story across the
// site; 60K SF of Class-A office stands 12 stories on a partial footprint. Height
// and bulk are honest — you can read a building's SF off the skyline.
// (story caps and coverage live in buildingArt so the portrait module shares them)
// Fabric is what the eye reads as urban: downtown buildings meet their lot lines and
// each other (adjacent prisms share edges EXACTLY at shrink 1.0 — verified), houses
// keep yards, industry sits on flat pads. Which fabric applies comes from the zoning.
type Fabric = 'wall' | 'yard' | 'pad';
function fabricOf(zone: E.Zone | undefined, type: E.PType): Fabric {
  if (type === 'industrial' || zone?.use === 'M') return 'pad';
  if (zone && (zone.use === 'C' || zone.use === 'MU') && zone.tier >= 2) return 'wall';
  return 'yard';
}
function massing(type: E.PType, construction: string | undefined, sf: number, siteCells: number, fabric: Fabric = 'yard'): { stories: number; ht: number; shrink: number } {
  const siteSF = Math.max(1, siteCells) * E.PARCEL_AC * 43_560;
  const stories = storiesFor(type, construction, sf, siteCells);
  const cover = Math.max(fabric === 'wall' ? 0.55 : 0.10, Math.min(0.92, sf / stories / siteSF));
  const shrink = fabric === 'wall' ? 1.0 : fabric === 'pad' ? 0.96 : Math.max(0.34, Math.min(0.88, Math.sqrt(cover)));
  return { stories, ht: 4 + stories * 4.2, shrink };
}
function defaultConstr(type: E.PType, sf: number): string {
  if (type === 'office') return sf > 26_000 ? 'concrete' : 'masonry';
  if (type === 'industrial') return 'metal';
  if (type === 'retail') return 'strip';
  if (type === 'multifamily') return sf > 42_000 ? 'tower' : 'midrise';
  return 'podium';
}

interface IsoBld { tight?: boolean; roof?: string; cx: number; cy: number; w: number; h: number; ht: number; col: string; listed: boolean; key: string; prog?: number; mine?: boolean; type?: E.PType; construction?: string; quality?: number; age?: number; sf?: number; occ?: number; seed?: number; stories?: number; fw?: number; fh?: number; hiCrime?: boolean; works?: boolean }

// Greedy maximal-rectangle decomposition of a cell set: one prism per rectangle
// instead of one per quarter-acre cell. An L-shaped assembly becomes two prisms.
function cellRects(cells: number[]): { px: number; py: number; pw: number; ph: number }[] {
  const set = new Set(cells);
  const used = new Set<number>();
  const out: { px: number; py: number; pw: number; ph: number }[] = [];
  for (const c of [...cells].sort((a, b) => a - b)) {
    if (used.has(c)) continue;
    const px = c % E.PGRID, py = Math.floor(c / E.PGRID);
    let pw = 1;
    while (px + pw < E.PGRID && set.has(c + pw) && !used.has(c + pw)) pw++;
    let ph = 1;
    grow: while (py + ph < E.PGRID) {
      for (let dx = 0; dx < pw; dx++) {
        const cc = c + ph * E.PGRID + dx;
        if (!set.has(cc) || used.has(cc)) break grow;
      }
      ph++;
    }
    for (let dy = 0; dy < ph; dy++) for (let dx = 0; dx < pw; dx++) used.add(c + dy * E.PGRID + dx);
    out.push({ px, py, pw, ph });
  }
  return out;
}

function useIsoBuildings(state: GameState): IsoBld[] {
  // Geometry changes when counts change, something (de)lists, or construction advances —
  // not merely because the month ticked. Progress sums capture growing heights.
  // appearance terms are quantized to visible bands (occ in fifths, quality in
  // 5-point steps) so the random walk of 300 buildings doesn't rebuild the whole
  // layer every quarter — only a band crossing does
  const stamp = state.stock.length + ':' + state.assets.length + ':' + state.land.length
    + ':' + state.land.reduce((s2, h) => s2 + h.cells.length + (h.id % 97) * h.cells.length, 0)
    + ':' + state.stock.reduce((s2, b) => s2 + (b.listedId ? 1 : 0), 0)
    + ':' + state.stock.reduce((s2, b) => s2 + (b.buildLeft ?? 0), 0)
    + ':' + state.assets.reduce((s2, a) => s2 + (a.project?.monthsLeft ?? 0) + (a.mode === 'construction' ? 1000 : 0), 0)
    + ':' + state.stock.reduce((s2, b) => s2 + Math.round(b.occ * 5), 0)
    + ':' + state.assets.reduce((s2, a) => s2 + Math.round(a.quality / 5) * 7 + Math.round(a.occ * 5) + (a.repair ? 9 : 0), 0)
    + ':' + state.tiles.reduce((s2, t) => s2 + (t.water ? 0 : ({ R: 1, C: 2, MU: 3, M: 4 } as const)[t.zone.use] * t.zone.tier * ((t.i % 13) + 1)), 0)
    + ':' + state.firmLand.length + ':' + state.firmLand.reduce((s2, e) => s2 + e.cells.length, 0)
    + ':' + state.tiles.reduce((s2, t) => s2 + (t.crime > 60 ? 1 : 0), 0)
    + ':' + state.assets.reduce((s2, a) => s2 + ((a.renovMonthsLeft || a.repair || a.programActive) ? a.id : 0), 0);
  return useMemo(() => {
    const out: IsoBld[] = [];
    // Walls follow the build, not the owner: tilt-wall is white precast, Class A office
    // is blue curtain glass, Class B is brick, retail is tan EIFS, garden walk-ups are
    // painted stucco. Three seeded shades per material so no two blocks match exactly.
    const WALLS: Record<string, string[]> = {
      tilt: ['#dcd9d0', '#d1cfc4', '#d7d1c2'],       // white precast panels
      metal: ['#b9c5cb', '#c6cbd0', '#aebcb3'],       // PEMB steel skins
      tin: ['#b3a184', '#a99a86', '#a0a691'],         // weathered light steel
      center: ['#dcc9a4', '#d3b78e', '#cab798'],      // EIFS tan
      strip: ['#d8c6a6', '#c9ad85', '#cec19f'],
      pad: ['#e2d8c2', '#dbcbb0', '#ded4bc'],
      concrete: ['#4f7396', '#42678a', '#5d80a3'],    // Class A curtain glass
      masonry: ['#b7876a', '#a67858', '#c19a7e'],     // brick and stone
      wood: ['#d6cdb4', '#cbc2a8', '#c2b89e'],        // painted Class C
      podium: ['#c9b9a0', '#5d80a3', '#b7876a'],      // podium mixed: varied
      garden: ['#cfc3a2', '#c4b28e', '#d3c9ae'],
      midrise: ['#d9d2be', '#cfc5ac', '#c6bda6'],
      tower: ['#7a94ac', '#6b869e', '#8aa2b8'],       // residential glass
    };
    const place = (o: { tileI: number; sf: number; type: E.PType; quality?: number; age?: number; construction?: string; cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }, col: string | undefined, listed: boolean, key: string, prog?: number, mine?: boolean, works?: boolean) => {
      const cells = E.footprintCells(o);
      if (!cells.length) return;
      const t = state.tiles[o.tileI];
      const ROOFS: Record<E.PType, string[]> = {
        retail: ['#c56a4a', '#b8574a', '#c9895a'], office: ['#8d99a6', '#7a8a99', '#a3adb5'],
        industrial: ['#b5b9bd', '#a9aeb3', '#c2c5c8'], mixed: ['#a58a6a', '#c56a4a', '#8d99a6'],
        multifamily: ['#b0654a', '#7a8a99', '#9a7a5a'],
      };
      const constr = o.construction ?? defaultConstr(o.type, o.sf);
      const wallPick = Math.abs((state.seed ^ (o.tileI * 53)) + ((o.sf | 0) >> 6)) % 3;
      // the wear layer: fresh deliveries read conspicuously clean, old cheap
      // product reads dingy — same wall, different decade
      const age = (o as any).age ?? 10, qual = (o as any).quality ?? 80;
      const wear = age < 3 ? 1.08 : age > 40 && qual < 60 ? 0.88 : age > 25 && qual < 75 ? 0.94 : 1;
      const wcol = col ?? shade((WALLS[constr] ?? WALLS.wood)[wallPick], wear);
      const fab = fabricOf(t.zone, o.type);
      const m = massing(o.type, constr, o.sf, cells.length, fab);
      const ht = prog === undefined ? m.ht : Math.max(3, m.ht * prog);
      for (const [ri, r] of cellRects(cells).entries()) {
        const [cx, cy] = parcelCenter(t.x, t.y, r.px, r.py, r.pw, r.ph);
        const [w, h] = parcelSpan(r.pw, r.ph);
        out.push({ cx, cy, w: w * m.shrink, h: h * m.shrink, fw: w, fh: h, ht, col: wcol, listed, key: key + '_r' + ri, prog, mine, stories: m.stories, tight: fab === 'wall', roof: prog !== undefined ? undefined : ROOFS[o.type][Math.abs((state.seed ^ (o.tileI * 31)) + ri) % 3],
          type: o.type, construction: o.construction, quality: o.quality, age: o.age, sf: o.sf, occ: (o as any).occ,
          hiCrime: t.crime > 60, works,
          seed: (state.seed ^ ((o.tileI + 1) * 0x9e3779b9) ^ ri) | 0 });
      }
    };
    for (const b of state.stock) {
      const prog = b.buildLeft ? 1 - b.buildLeft / Math.max(1, b.buildTotal ?? 1) : undefined;
      place(b, b.buildLeft ? '#d9b87a' : undefined, !!b.listedId, 'b' + b.id, prog);
    }
    for (const a of state.assets) {
      const prog = a.mode === 'construction' && a.project
        ? 1 - a.project.monthsLeft / Math.max(1, a.project.monthsBuilt + a.project.monthsLeft) : undefined;
      place(a, a.mode === 'construction' ? '#dcc07e' : '#f0c464', false, 'a' + a.id, prog, true,
        !!(a.renovMonthsLeft || a.repair || a.programActive));
    }
    for (const hd of state.land) {
      const t = state.tiles[hd.tileI];
      for (const [ri, r] of cellRects(hd.cells).entries()) {
        const [cx, cy] = parcelCenter(t.x, t.y, r.px, r.py, r.pw, r.ph);
        const [w, hh] = parcelSpan(r.pw, r.ph);
        out.push({ cx, cy, w: w * 0.92, h: hh * 0.92, ht: 1.5, col: '#8a6a2c', listed: false, key: 'L' + hd.id + '_r' + ri, mine: true });
      }
    }
    // rival assemblies: same low pad, claret instead of your amber. Two of these
    // side by side on a block is the tell — somebody wants the whole thing.
    for (const [ei, e] of state.firmLand.entries()) {
      const t = state.tiles[e.tileI];
      for (const [ri, r] of cellRects(e.cells).entries()) {
        const [cx, cy] = parcelCenter(t.x, t.y, r.px, r.py, r.pw, r.ph);
        const [w, hh] = parcelSpan(r.pw, r.ph);
        out.push({ cx, cy, w: w * 0.92, h: hh * 0.92, ht: 1.5, col: '#79394a', listed: false, key: 'F' + ei + '_' + e.tileI + '_' + e.short + '_r' + ri });
      }
    }
    out.sort((p, q) => (p.cx + p.cy) - (q.cx + q.cy)); // painter's algorithm: back to front
    return out;
  }, [stamp, state.seed]); // eslint-disable-line
}

// detail=true above the LOD zoom threshold: facades and site dressing draw;
// below it every building is a cheap flat prism. Phase D plugs into the detail branch.
const IsoCity = memo(function IsoCity({ blds, detail, snow = false, winterSun = false }: {
  blds: IsoBld[]; detail: boolean; snow?: boolean; winterSun?: boolean;
}) {
  // the low winter sun throws longer shadows; snow settles on flat roofs
  const shOff = winterSun ? 0.2 : 0.12;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {blds.map(b => {
        const stroke = b.listed ? '#1f9d55' : b.mine ? '#b07d1e' : '#6a6f66';
        const sw = b.listed ? 1.1 : 0.4;
        const f = prismFaces(b.cx, b.cy, b.w, b.h, b.ht);
        const st = b.prog !== undefined ? '#c98a2e' : stroke;
        const dash = b.prog !== undefined ? '3 2' : undefined;
        return (
          <g key={b.key}>
            {detail && b.ht > 3 && !b.tight && <polygon points={rectPoly(b.cx + b.w * shOff, b.cy + b.h * shOff, b.w, b.h)} fill="#000" opacity={0.22} />}
            <polygon points={f.l} fill={shade(b.col, 0.66)} stroke={st} strokeWidth={sw} strokeDasharray={dash} />
            <polygon points={f.r} fill={shade(b.col, 0.98)} stroke={st} strokeWidth={sw} strokeDasharray={dash} />
            <polygon points={f.t} fill={b.roof ?? shade(b.col, 1.12)} stroke={st} strokeWidth={sw} strokeDasharray={dash} />
            {snow && b.prog === undefined && <polygon points={f.t} fill="#dde4ea" opacity={0.55} />}
            {b.works && detail && (() => {
              // scaffolding and netting on a building under renovation or repair
              const bb2 = isoPt(b.cx + b.w / 2, b.cy + b.h / 2), br2 = isoPt(b.cx + b.w / 2, b.cy - b.h / 2);
              const rows2 = Math.max(2, Math.min(5, Math.round(b.ht / 8)));
              const out2: React.ReactNode[] = [
                <polygon key="net" points={`${bb2[0]},${bb2[1]} ${br2[0]},${br2[1]} ${br2[0]},${br2[1] - b.ht} ${bb2[0]},${bb2[1] - b.ht}`}
                  fill="#8a9a6a" opacity={0.14} />,
              ];
              for (let i2 = 0; i2 <= rows2; i2++) {
                const y2 = (b.ht / rows2) * i2;
                out2.push(<line key={'sh' + i2} x1={bb2[0] - 0.6} y1={bb2[1] - y2 + 0.3} x2={br2[0] + 0.6} y2={br2[1] - y2 + 0.3} stroke="#b0a890" strokeWidth={0.45} opacity={0.9} />);
              }
              for (const u2 of [0, 0.33, 0.66, 1]) {
                const xx = bb2[0] + (br2[0] - bb2[0]) * u2, yy = bb2[1] + (br2[1] - bb2[1]) * u2;
                out2.push(<line key={'sv' + u2} x1={xx} y1={yy + 0.5} x2={xx} y2={yy - b.ht - 0.3} stroke="#b0a890" strokeWidth={0.45} opacity={0.9} />);
              }
              return <g>{out2}</g>;
            })()}
            {detail && <BldDetail b={b} />}
          </g>
        );
      })}
    </g>
  );
});

// Facades and site dressing from the pure art module — only rendered above the
// LOD zoom threshold, so the far view stays cheap.
function BldDetail({ b }: { b: IsoBld }) {
  const p = (x: number, y: number) => isoPt(x, y);
  const geom = {
    bl: p(b.cx - b.w / 2, b.cy + b.h / 2),
    bb: p(b.cx + b.w / 2, b.cy + b.h / 2),
    br: p(b.cx + b.w / 2, b.cy - b.h / 2),
    ht: b.ht,
  };
  const els = b.prog !== undefined
    ? siteArt(geom, b.prog, b.seed ?? 1)
    : b.type
      ? buildingArt({ type: b.type, construction: b.construction ?? 'concrete', quality: b.quality ?? 75, age: b.age ?? 10, sf: b.sf ?? 0, occ: b.occ ?? 0, seed: b.seed ?? 1, stories: b.stories, tight: b.tight, hiCrime: b.hiCrime }, geom)
      : [];
  if (!els.length) return null;
  return (
    <g>
      {els.map((e, i) => e.k === 'p'
        ? <polygon key={i} points={e.pts} fill={e.f ?? 'none'} stroke={e.s} strokeWidth={e.w} opacity={e.o}
            className={e.cls} style={e.dly !== undefined ? { animationDelay: e.dly + 's' } : undefined} />
        : e.k === 'l'
          ? <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.s} strokeWidth={e.w} opacity={e.o} strokeDasharray={e.d}
              className={e.cls} style={e.dly !== undefined ? { animationDelay: e.dly + 's' } : undefined} />
          : <circle key={i} cx={e.cx} cy={e.cy} r={e.r} fill={e.f} opacity={e.o}
              className={e.cls} style={e.dly !== undefined ? { animationDelay: e.dly + 's' } : undefined} />)}
    </g>
  );
}


// ---------- pan / zoom viewport ----------
function useViewport(bx: number, by: number, bw: number, bh: number) {
  const ref = useRef<SVGSVGElement | null>(null);
  // callback ref so the wheel listener attaches when THIS svg mounts — the flat view
  // mounts late (only when you switch to it), and a plain effect never saw its element
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  const refCb = useCallback((n: SVGSVGElement | null) => { ref.current = n; setEl(n); }, []);
  const [vp, setVp] = useState({ z: 1.25, x: (bw - bw / 1.25) / 2, y: (bh - bh / 1.25) / 2 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const clamp2 = (x: number, y: number, z: number) => ({
    x: Math.max(0, Math.min(bw - bw / z, x)),
    y: Math.max(0, Math.min(bh - bh / z, y)),
  });

  // eased camera: one rAF loop drives button zooms and fly-tos; reduced-motion
  // (and every wheel tick, which is already incremental) goes instant
  const rafId = useRef<number | null>(null);
  const stopAnim = useCallback(() => { if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null; } }, []);
  const animateTo = useCallback((target: { z: number; x: number; y: number }, ms = 260) => {
    stopAnim();
    if (prefersReducedMotion()) { setVp(target); return; }
    const start = { ...vpRef.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      const e2 = 1 - Math.pow(1 - u, 3);
      const z = start.z + (target.z - start.z) * e2;
      const c = clamp2(start.x + (target.x - start.x) * e2, start.y + (target.y - start.y) * e2, z);
      setVp({ z, x: c.x, y: c.y });
      if (u < 1) rafId.current = requestAnimationFrame(step); else rafId.current = null;
    };
    rafId.current = requestAnimationFrame(step);
  }, [bw, bh]); // eslint-disable-line

  // single atomic update: zoom and recentre together, pinning the point under the cursor
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number, eased = false) => {
    stopAnim();
    const p = vpRef.current;
    const nz = Math.max(1, Math.min(8, p.z * factor));
    if (nz === p.z) return;
    const vwOld = bw / p.z, vhOld = bh / p.z;
    const vwNew = bw / nz, vhNew = bh / nz;
    const fx = cx === undefined ? 0.5 : (cx - p.x) / vwOld;
    const fy = cy === undefined ? 0.5 : (cy - p.y) / vhOld;
    const c = {
      x: Math.max(0, Math.min(bw - vwNew, p.x + fx * (vwOld - vwNew))),
      y: Math.max(0, Math.min(bh - vhNew, p.y + fy * (vhOld - vhNew))),
    };
    if (eased) animateTo({ z: nz, x: c.x, y: c.y }, 240);
    else setVp({ z: nz, x: c.x, y: c.y });
  }, [bw, bh, animateTo, stopAnim]);

  useEffect(() => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = vpRef.current;
      const r = el.getBoundingClientRect();
      const cx = p.x + ((e.clientX - r.left) / r.width) * (bw / p.z);
      const cy = p.y + ((e.clientY - r.top) / r.height) * (bh / p.z);
      zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, cx, cy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [el, bw, bh, zoomAt]);

  const vel = useRef({ vx: 0, vy: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    stopAnim();
    moved.current = false;
    vel.current = { vx: 0, vy: 0 };
    drag.current = { sx: e.clientX, sy: e.clientY, ox: vpRef.current.x, oy: vpRef.current.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;
    vel.current = { vx: e.movementX ?? 0, vy: e.movementY ?? 0 };
    const r = ref.current.getBoundingClientRect();
    setVp(p => {
      const c = clamp2(d.ox - (dx / r.width) * (bw / p.z), d.oy - (dy / r.height) * (bh / p.z), p.z);
      return { z: p.z, x: c.x, y: c.y };
    });
  };
  const onPointerUp = () => {
    const wasDrag = drag.current !== null && moved.current;
    drag.current = null;
    // momentum: the throw carries, decaying — a released pan settles, never stops dead
    const { vx, vy } = vel.current;
    if (!wasDrag || Math.abs(vx) + Math.abs(vy) < 5 || prefersReducedMotion() || !ref.current) return;
    let gx = vx, gy = vy;
    const glide = () => {
      if (!ref.current || drag.current) { rafId.current = null; return; }
      const r = ref.current.getBoundingClientRect();
      setVp(p => {
        const c = clamp2(p.x - (gx / r.width) * (bw / p.z), p.y - (gy / r.height) * (bh / p.z), p.z);
        return { z: p.z, x: c.x, y: c.y };
      });
      gx *= 0.9; gy *= 0.9;
      if (Math.abs(gx) + Math.abs(gy) > 0.6) rafId.current = requestAnimationFrame(glide);
      else rafId.current = null;
    };
    stopAnim();
    rafId.current = requestAnimationFrame(glide);
  };
  const reset = () => animateTo({ z: 1.25, x: (bw - bw / 1.25) / 2, y: (bh - bh / 1.25) / 2 }, 300);
  // centre the viewport on a point in base coordinates, zooming in if we're wide —
  // a located news item now flies you there instead of teleporting
  const focusOn = useCallback((p: [number, number]) => {
    const prev = vpRef.current;
    const z = Math.max(prev.z, 2.2);
    const vw = bw / z, vh = bh / z;
    animateTo({
      z,
      x: Math.max(0, Math.min(bw - vw, p[0] - bx - vw / 2)),
      y: Math.max(0, Math.min(bh - vh, p[1] - by - vh / 2)),
    }, 460);
  }, [bw, bh, bx, by, animateTo]);

  return {
    ref: refCb, viewBox: `${bx + vp.x} ${by + vp.y} ${bw / vp.z} ${bh / vp.z}`, z: vp.z, zoomAt, reset, focusOn, moved,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp },
    style: { cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' } as React.CSSProperties,
  };
}

// ---------- roads ----------
// Merge collinear same-class segments into polyline runs; streets draw in the
// gutter between blocks (boundary coords are at ±0.5 in tile-center space).
type RoadRun = { cls: number; pts: [number, number][] };
function roadRuns(roads: E.RoadNet): RoadRun[] {
  const runs: RoadRun[] = [];
  const W = E.CONFIG.GRID_W, H = E.CONFIG.GRID_H;
  for (let y = 0; y <= H; y++) {
    let x = 0;
    while (x < W) {
      const c = roads.hz[y][x];
      if (!c) { x++; continue; }
      let x2 = x;
      while (x2 + 1 < W && roads.hz[y][x2 + 1] === c) x2++;
      runs.push({ cls: c, pts: [[x - 0.5, y - 0.5], [x2 + 0.5, y - 0.5]] });
      x = x2 + 1;
    }
  }
  for (let x = 0; x <= W; x++) {
    let y = 0;
    while (y < H) {
      const c = roads.vt[y][x];
      if (!c) { y++; continue; }
      let y2 = y;
      while (y2 + 1 < H && roads.vt[y2 + 1][x] === c) y2++;
      runs.push({ cls: c, pts: [[x - 0.5, y - 0.5], [x - 0.5, y2 + 0.5]] });
      y = y2 + 1;
    }
  }
  return runs;
}
// Street rhythm: locals are lanes, arterials are rooms — the hierarchy should be
// legible from across the map, not a set of near-identical grey lines.
const ROAD_STYLE: Record<number, { stroke: string; w: number; dash?: string }> = {
  1: { stroke: '#949aa1', w: 1.5 },
  2: { stroke: '#82888f', w: 2.9 },
  3: { stroke: '#71767c', w: 5.2 },
  4: { stroke: '#666b72', w: 7.2 },
  5: { stroke: '#8a7a5c', w: 1.8, dash: '7 5' },
};
const StreetLife = memo(function StreetLife({ runs, seed, detail, season = 'summer', loD, hiD, busy, retailish }: {
  runs: RoadRun[]; seed: number; detail: boolean; season?: Season; loD?: Set<number>; hiD?: Set<number>;
  busy?: Set<number>; retailish?: Set<number>;
}) {
  const els: React.ReactNode[] = [];
  let a = seed | 0;
  const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const CAR_COLS = ['#5a6570', '#6e5f52', '#4a5a6a', '#75706a', '#5f4a4a', '#57636a'];
  let cars = 0, trees = 0, xwalks = 0, lamps = 0, peds = 0;
  let trainPlaced = false;
  const xwSeen = new Set<string>();
  for (const run of runs) {
    const [p0, p1] = run.pts;
    const len = Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]);
    const horiz = Math.abs(p1[0] - p0[0]) > Math.abs(p1[1] - p0[1]);
    const runMid = (() => {
      const mx = Math.round((p0[0] + p1[0]) / 2), my = Math.round((p0[1] + p1[1]) / 2);
      return Math.max(0, Math.min(E.CONFIG.GRID_H - 1, my)) * E.CONFIG.GRID_W + Math.max(0, Math.min(E.CONFIG.GRID_W - 1, mx));
    })();
    if (run.cls === 3 || run.cls === 2) {
      // traffic scales with road class — and with the jobs on the adjoining blocks:
      // the arterial past the employment core carries real volume, the one past
      // empty land carries a stray sedan
      const empAdj = busy?.has(runMid) ? 2 : 0;
      const n = Math.min(6, Math.round(len * (run.cls === 3 ? 0.55 : 0.3) * (0.5 + r())) + empAdj);
      for (let i = 0; i < n && cars < 260; i++) {
        const u = 0.06 + r() * 0.88;
        const gx = p0[0] + (p1[0] - p0[0]) * u, gy = p0[1] + (p1[1] - p0[1]) * u;
        const side = r() < 0.5 ? -0.055 : 0.055;
        const [cx, cy] = isoPt(gx + (horiz ? 0 : side), gy + (horiz ? side : 0));
        const roll = r();
        if (roll < 0.10 && run.cls === 3) {
          // a bus: long, liveried, unmistakable
          els.push(<g key={'c' + cars}>
            <polygon points={`${(cx - 2.6).toFixed(1)},${(cy - 0.3).toFixed(1)} ${(cx + 0.6).toFixed(1)},${(cy + 1.2).toFixed(1)} ${(cx + 2.6).toFixed(1)},${(cy + 0.2).toFixed(1)} ${(cx - 0.6).toFixed(1)},${(cy - 1.3).toFixed(1)}`} fill={r() < 0.5 ? '#a86a2a' : '#3c5a7a'} opacity={0.95} />
            <line x1={cx - 1.6} y1={cy - 0.1} x2={cx + 1.2} y2={cy + 0.6} stroke="#d8dde0" strokeWidth={0.4} opacity={0.8} />
          </g>);
        } else if (roll < 0.24) {
          // a box truck: cab + white body
          els.push(<g key={'c' + cars}>
            <polygon points={`${(cx - 2.0).toFixed(1)},${(cy - 0.2).toFixed(1)} ${(cx + 0.6).toFixed(1)},${(cy + 1.1).toFixed(1)} ${(cx + 2.0).toFixed(1)},${(cy + 0.3).toFixed(1)} ${(cx - 0.6).toFixed(1)},${(cy - 1.0).toFixed(1)}`} fill="#c8cdd2" opacity={0.95} />
            <polygon points={`${(cx + 1.4).toFixed(1)},${(cy + 0.6).toFixed(1)} ${(cx + 2.4).toFixed(1)},${(cy + 1.1).toFixed(1)} ${(cx + 2.9).toFixed(1)},${(cy + 0.8).toFixed(1)} ${(cx + 1.9).toFixed(1)},${(cy + 0.3).toFixed(1)}`} fill={pick2(r, CAR_COLS)} opacity={0.95} />
          </g>);
        } else {
          els.push(<polygon key={'c' + cars} points={`${(cx - 1.5).toFixed(1)},${(cy - 0.2).toFixed(1)} ${(cx + 0.3).toFixed(1)},${(cy + 0.7).toFixed(1)} ${(cx + 1.5).toFixed(1)},${(cy + 0.1).toFixed(1)} ${(cx - 0.3).toFixed(1)},${(cy - 0.8).toFixed(1)}`}
            fill={CAR_COLS[Math.floor(r() * CAR_COLS.length)]} opacity={0.9} />);
        }
        cars++;
      }
    }
    if (run.cls === 1 || run.cls === 2) {
      // street trees: thick on locals, a planted median's worth on collectors —
      // and the canopy follows the money: dense frontage on desirable blocks,
      // sparse to bare where nobody's watering anything
      const midTile = (() => {
        const mx = Math.round((p0[0] + p1[0]) / 2), my = Math.round((p0[1] + p1[1]) / 2);
        return Math.max(0, Math.min(E.CONFIG.GRID_H - 1, my)) * E.CONFIG.GRID_W + Math.max(0, Math.min(E.CONFIG.GRID_W - 1, mx));
      })();
      const dAdj = hiD?.has(midTile) ? 2 : loD?.has(midTile) ? -2 : 0;
      const n = Math.min((run.cls === 1 ? 3 : 2) + Math.max(0, dAdj), Math.max(0, Math.round(len * (run.cls === 1 ? 0.26 : 0.14) * (0.4 + r())) + dAdj));
      for (let i = 0; i < n && trees < 340; i++) {
        const u = 0.1 + r() * 0.8;
        const gx = p0[0] + (p1[0] - p0[0]) * u, gy = p0[1] + (p1[1] - p0[1]) * u;
        const side = r() < 0.5 ? -0.09 : 0.09;
        const [cx, cy] = isoPt(gx + (horiz ? 0 : side), gy + (horiz ? side : 0));
        const TREE_BY: Record<Season, [string, string]> = {
          summer: ['#4a7a40', '#578a4a'], spring: ['#5a8c4c', '#679a58'],
          fall: ['#a3722c', '#8a6530'], winter: ['#6a625a', '#5e5850'],
        };
        const [tA, tB] = TREE_BY[season];
        els.push(<g key={'t' + trees}>
          <circle cx={cx} cy={cy - 1.6} r={(1.5 + r()) * (season === 'winter' ? 0.5 : 1)} fill={r() < 0.5 ? tA : tB} opacity={season === 'winter' ? 0.5 : 0.95} />
          <line x1={cx} y1={cy} x2={cx} y2={cy - 1.2} stroke="#5a4a36" strokeWidth={0.5} />
        </g>);
        trees++;
      }
    }
    // one freight consist WORKS the rail line — a slow shuttle move, back and
    // forth along the mainline. Reduced-motion pins it in place.
    if (run.cls === 5 && !trainPlaced && len >= 4) {
      trainPlaced = true;
      const u0 = 0.25 + r() * 0.2;
      const cars2: React.ReactNode[] = [];
      for (let i = 0; i < 5; i++) {
        const u = u0 + i * (0.55 / len);
        const gx = p0[0] + (p1[0] - p0[0]) * u, gy = p0[1] + (p1[1] - p0[1]) * u;
        const [cx, cy] = isoPt(gx, gy);
        cars2.push(<polygon key={'tr' + i} points={`${(cx - 1.9).toFixed(1)},${(cy - 0.3).toFixed(1)} ${(cx + 0.4).toFixed(1)},${(cy + 0.85).toFixed(1)} ${(cx + 1.9).toFixed(1)},${(cy + 0.1).toFixed(1)} ${(cx - 0.4).toFixed(1)},${(cy - 1.05).toFixed(1)}`}
          fill={i === 0 ? '#5a4a3a' : pick2(r, ['#6e4a34', '#4a5a52', '#54586a', '#6a5a44'])} opacity={0.95} />);
      }
      els.push(<g key="train" className={horiz ? 'train-roll' : undefined}>{cars2}</g>);
    }
    if (!detail) continue;
    // ---------- close-zoom dressing ----------
    if (run.cls >= 3) {
      // crosswalks at both ends of every arterial run — the ladder is one dashed stroke
      for (const end of [0, 1] as const) {
        if (xwalks >= 150) break;
        const ex = end === 0 ? p0 : p1, other = end === 0 ? p1 : p0;
        const key = ex[0].toFixed(1) + ':' + ex[1].toFixed(1) + (horiz ? 'h' : 'v');
        if (xwSeen.has(key)) continue;
        xwSeen.add(key);
        const dirx = Math.sign(other[0] - ex[0]), diry = Math.sign(other[1] - ex[1]);
        const cxg = ex[0] + dirx * 0.34, cyg = ex[1] + diry * 0.34;
        const w2 = 0.13;
        const a2 = isoPt(cxg + (horiz ? 0 : w2), cyg + (horiz ? w2 : 0));
        const b2 = isoPt(cxg - (horiz ? 0 : w2), cyg - (horiz ? w2 : 0));
        els.push(<line key={'xw' + xwalks} x1={a2[0]} y1={a2[1]} x2={b2[0]} y2={b2[1]} stroke="#eee9d6" strokeWidth={1.6} strokeDasharray="0.9 0.7" opacity={0.85} />);
        xwalks++;
      }
      // streetlights march the arterial, alternating sides
      const nL = Math.min(4, Math.floor(len / 1.4));
      for (let i = 0; i < nL && lamps < 120; i++) {
        const u = (i + 0.5) / nL;
        const side = i % 2 === 0 ? -0.085 : 0.085;
        const gx = p0[0] + (p1[0] - p0[0]) * u, gy = p0[1] + (p1[1] - p0[1]) * u;
        const [cx, cy] = isoPt(gx + (horiz ? 0 : side), gy + (horiz ? side : 0));
        els.push(<g key={'lp' + lamps}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - 3.1} stroke="#4a5058" strokeWidth={0.45} />
          <line x1={cx} y1={cy - 3.1} x2={cx + (i % 2 === 0 ? 1.0 : -1.0)} y2={cy - 2.9} stroke="#4a5058" strokeWidth={0.4} />
          <circle cx={cx + (i % 2 === 0 ? 1.0 : -1.0)} cy={cy - 2.9} r={0.45} fill="#e8d9a0" opacity={0.9} />
        </g>);
        lamps++;
      }
    }
    if (run.cls <= 2 && peds < 96) {
      // people on the sidewalk — two dots and they read as a person; retail
      // frontage draws a few more, and that's the foot traffic you underwrote
      const n = Math.min(retailish?.has(runMid) ? 4 : 2, Math.round(len * 0.2 * r()) + (retailish?.has(runMid) ? 2 : 0));
      for (let i = 0; i < n && peds < 96; i++) {
        const u = 0.15 + r() * 0.7;
        const side = r() < 0.5 ? -0.075 : 0.075;
        const gx = p0[0] + (p1[0] - p0[0]) * u, gy = p0[1] + (p1[1] - p0[1]) * u;
        const [cx, cy] = isoPt(gx + (horiz ? 0 : side), gy + (horiz ? side : 0));
        els.push(<g key={'pd' + peds}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - 1.1} stroke={pick2(r, ['#5a4a4a', '#3c4a6a', '#4a5a44', '#6a5444'])} strokeWidth={0.55} />
          <circle cx={cx} cy={cy - 1.4} r={0.35} fill="#c9a985" opacity={0.95} />
        </g>);
        peds++;
      }
    }
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});
const pick2 = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length];

// ---------- street names ----------
// Arterials and collectors get names at close zoom — dry surveyor stock, painted
// faint on the asphalt. East-west runs take names, north-south runs take numbers,
// so "corner of Meridian and 12th" actually means something.
const AVE_NAMES = ['MERIDIAN AVE', 'UNION AVE', 'BEACON AVE', 'CASCADE AVE', 'HARBOR AVE', 'FOUNDERS AVE', 'COMMERCE AVE', 'GRANITE AVE', 'STERLING AVE', 'KEYSTONE AVE'];
const ordSuffix = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'ST' : n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH';
const StreetNames = memo(function StreetNames({ runs, seed }: { runs: RoadRun[]; seed: number }) {
  const els: React.ReactNode[] = [];
  const ANG = Math.atan2(IH / 2, IW / 2) * 180 / Math.PI;   // the iso grade
  let n = 0;
  for (const run of runs) {
    if (run.cls < 3 || run.cls === 5 || n >= 24) continue;
    const [p0, p1] = run.pts;
    const len = Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]);
    if (len < 3) continue;
    const horiz = Math.abs(p1[0] - p0[0]) > Math.abs(p1[1] - p0[1]);
    const name = horiz
      ? AVE_NAMES[(Math.round(p0[1] + 0.5) * 3 + (seed & 7)) % AVE_NAMES.length]
      : `${Math.round(p0[0] + 0.5)}${ordSuffix(Math.round(p0[0] + 0.5))} ST`;
    const u = 0.38;
    const [tx, ty] = isoPt(p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u);
    els.push(<text key={'sn' + n} x={tx} y={ty + 1.4} textAnchor="middle" fontSize={5}
      fontFamily="var(--mono)" fill="#4c5348" opacity={0.85} letterSpacing={1.2}
      transform={`rotate(${horiz ? ANG : -ANG} ${tx} ${ty})`}>{name}</text>);
    n++;
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// ---------- civic fabric ----------
// The city stops being 100% product: a domed hall and a bandstand in the parks, a
// fountain, a marina on the riverbank, water towers on the industrial band, a
// couple of spires in the neighborhoods. All view-only, all on ground the player
// can't buy (parks, water) or on vacant corners that yield if someone builds.
const CivicLayer = memo(function CivicLayer({ tiles, grids, seed }: {
  tiles: (TileGeom & { rz?: boolean })[]; grids: (number | null)[][]; seed: number;
}) {
  const els: React.ReactNode[] = [];
  const parks = tiles.filter(t => t.park);
  const cornerFree = (t: TileGeom, c: number) => grids[t.i] && grids[t.i][c] === null;

  // City Hall: the first park block — limestone mass, portico, a green dome
  if (parks.length > 0) {
    const t = parks[0];
    const [cx, cy] = isoPt(t.x - 0.14, t.y - 0.1);
    els.push(<g key="hall">
      <polygon points={`${cx - 7},${cy} ${cx},${cy + 3.5} ${cx + 7},${cy} ${cx},${cy - 3.5}`} fill="#b3a68c" stroke="#6b6154" strokeWidth={0.5} />
      <polygon points={`${cx - 7},${cy} ${cx - 7},${cy - 5} ${cx},${cy - 1.5} ${cx},${cy + 3.5}`} fill="#9c8f74" stroke="#6b6154" strokeWidth={0.4} />
      <polygon points={`${cx + 7},${cy} ${cx + 7},${cy - 5} ${cx},${cy - 1.5} ${cx},${cy + 3.5}`} fill="#a89a80" stroke="#6b6154" strokeWidth={0.4} />
      <polygon points={`${cx - 7},${cy - 5} ${cx},${cy - 8.5} ${cx + 7},${cy - 5} ${cx},${cy - 1.5}`} fill="#b8ab8e" stroke="#6b6154" strokeWidth={0.4} />
      {[-3.6, -1.8, 1.8, 3.6].map(o => <line key={'c' + o} x1={cx + o} y1={cy + 2 - Math.abs(o) * 0.22} x2={cx + o} y2={cy - 2.2 - Math.abs(o) * 0.22} stroke="#d5cab0" strokeWidth={0.7} />)}
      <ellipse cx={cx} cy={cy - 8.6} rx={2.6} ry={1.5} fill="#5a7d68" stroke="#3d5a4a" strokeWidth={0.4} />
      <path d={`M${cx - 2.6} ${cy - 8.6} Q${cx} ${cy - 12} ${cx + 2.6} ${cy - 8.6}`} fill="#6b8f78" stroke="#3d5a4a" strokeWidth={0.4} />
      <line x1={cx} y1={cy - 11.4} x2={cx} y2={cy - 13.6} stroke="#54493c" strokeWidth={0.5} />
      <polygon points={`${cx},${cy - 13.6} ${cx + 2.2},${cy - 13.1} ${cx},${cy - 12.6}`} fill="#c9a04f" />
    </g>);
  }
  // Bandstand: a light hexagonal pavilion in another park
  if (parks.length > 2) {
    const t = parks[Math.floor(parks.length / 2)];
    const [cx, cy] = isoPt(t.x + 0.18, t.y + 0.16);
    els.push(<g key="band">
      <ellipse cx={cx} cy={cy} rx={3.4} ry={1.7} fill="#cfc4a4" stroke="#8a7a5c" strokeWidth={0.4} />
      {[-2.6, 0, 2.6].map(o => <line key={'p' + o} x1={cx + o} y1={cy + (o === 0 ? 1.5 : 0.4)} x2={cx + o} y2={cy - 2.6 + (o === 0 ? 0 : 0.4)} stroke="#8a7a5c" strokeWidth={0.5} />)}
      <path d={`M${cx - 3.6} ${cy - 2.4} Q${cx} ${cy - 5.4} ${cx + 3.6} ${cy - 2.4} Z`} fill="#7d5a4a" stroke="#54493c" strokeWidth={0.4} />
    </g>);
  }
  // Fountain: rings and spray in the last park
  if (parks.length > 4) {
    const t = parks[parks.length - 1];
    const [cx, cy] = isoPt(t.x - 0.2, t.y + 0.22);
    els.push(<g key="ftn">
      <ellipse cx={cx} cy={cy} rx={3} ry={1.5} fill="#5b9ec9" stroke="#8a8f80" strokeWidth={0.6} />
      <ellipse cx={cx} cy={cy} rx={1.2} ry={0.6} fill="#7ab4d8" />
      <line x1={cx} y1={cy} x2={cx} y2={cy - 2} stroke="#cfe4f0" strokeWidth={0.5} opacity={0.9} />
      <circle cx={cx} cy={cy - 2.2} r={0.5} fill="#cfe4f0" opacity={0.7} />
    </g>);
  }
  // Marina: docks and moored hulls on the first riverbank tile with land behind it
  const W = E.CONFIG.GRID_W;
  const marina = tiles.find(t => t.water && !t.canal && t.y > 1 && t.y < E.CONFIG.GRID_H - 2
    && tiles[t.i - 1] && !tiles[t.i - 1].water && ((seed ^ t.i) & 3) !== 0);
  if (marina) {
    const [cx, cy] = isoPt(marina.x - 0.28, marina.y);
    els.push(<g key="marina">
      {[0, 1].map(d => {
        const oy = d * 3.2;
        return <g key={d}>
          <line x1={cx - 2} y1={cy + oy} x2={cx + 6} y2={cy + oy + 3} stroke="#8a7050" strokeWidth={1.1} />
          {[0.3, 0.62].map(u => <polygon key={u} points={`${cx - 2 + 8 * u - 1.1},${cy + oy + 3 * u - 1.6} ${cx - 2 + 8 * u + 1.1},${cy + oy + 3 * u - 1.1} ${cx - 2 + 8 * u + 1.4},${cy + oy + 3 * u - 1.9} ${cx - 2 + 8 * u - 0.8},${cy + oy + 3 * u - 2.4}`}
            fill={((seed >> d) & 1) ? '#e8e6dd' : '#6a8296'} stroke="#4a5560" strokeWidth={0.3} />)}
        </g>;
      })}
    </g>);
  }
  // Water towers on the industrial band; spires in the neighborhoods — both sit
  // on vacant corners and give way the day somebody builds there
  let towers = 0, spires = 0;
  for (const t of tiles) {
    if (towers < 2 && t.dust && !t.water && cornerFree(t, 0) && ((seed ^ (t.i * 7)) & 7) === 0) {
      const [cx, cy] = isoPt(t.x - 0.3, t.y - 0.3);
      els.push(<g key={'wt' + t.i}>
        {[-1.4, 1.4].map(o => <line key={o} x1={cx + o} y1={cy} x2={cx + o * 0.55} y2={cy - 4.5} stroke="#54493c" strokeWidth={0.6} />)}
        <ellipse cx={cx} cy={cy - 5.6} rx={2.2} ry={1.1} fill="#7d8690" stroke="#3a4048" strokeWidth={0.4} />
        <rect x={cx - 2.2} y={cy - 6.6} width={4.4} height={1.6} fill="#8a939c" stroke="#3a4048" strokeWidth={0.4} />
        <path d={`M${cx - 2.2} ${cy - 6.6} Q${cx} ${cy - 8.4} ${cx + 2.2} ${cy - 6.6}`} fill="#6e7780" stroke="#3a4048" strokeWidth={0.4} />
      </g>);
      towers++;
    }
    if (spires < 2 && (t as any).rz && !t.water && cornerFree(t, 15) && ((seed ^ (t.i * 13)) & 7) === 0) {
      const [cx, cy] = isoPt(t.x + 0.3, t.y + 0.3);
      els.push(<g key={'sp' + t.i}>
        <polygon points={`${cx - 2.4},${cy} ${cx},${cy + 1.2} ${cx + 2.4},${cy} ${cx},${cy - 1.2}`} fill="#cfc8b6" stroke="#8a8274" strokeWidth={0.4} />
        <polygon points={`${cx - 2.4},${cy} ${cx - 2.4},${cy - 3} ${cx},${cy - 1.8} ${cx},${cy + 1.2}`} fill="#b8b0a0" stroke="#8a8274" strokeWidth={0.3} />
        <polygon points={`${cx + 2.4},${cy} ${cx + 2.4},${cy - 3} ${cx},${cy - 1.8} ${cx},${cy + 1.2}`} fill="#c4bcac" stroke="#8a8274" strokeWidth={0.3} />
        <polygon points={`${cx - 2.4},${cy - 3} ${cx},${cy - 5.6} ${cx + 2.4},${cy - 3} ${cx},${cy - 1.8}`} fill="#7d5a4a" stroke="#54493c" strokeWidth={0.3} />
        <line x1={cx} y1={cy - 5.4} x2={cx} y2={cy - 8} stroke="#54493c" strokeWidth={0.7} />
      </g>);
      spires++;
    }
    if (towers >= 2 && spires >= 2) break;
  }
  void W;
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// ---------- bridges ----------
// Where a road crosses water it stops being paint and becomes structure: a deck
// wider than the roadway, railings, and a shadow on the river. Crossings are the
// whole reason the far bank prices the way it does — they should look the part.
const Bridges = memo(function Bridges({ runs, tiles }: { runs: RoadRun[]; tiles: TileGeom[] }) {
  const W = E.CONFIG.GRID_W, H = E.CONFIG.GRID_H;
  const waterAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const t = tiles[y * W + x];
    return !!t && !!t.water;
  };
  const els: React.ReactNode[] = [];
  let n = 0;
  for (const run of runs) {
    if (run.cls === 5) continue;   // the rail line has its own trestle look via ballast
    const [p0, p1] = run.pts;
    const horiz = Math.abs(p1[0] - p0[0]) > Math.abs(p1[1] - p0[1]);
    const len = Math.round(Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]));
    const st = ROAD_STYLE[run.cls];
    for (let i = 0; i < len; i++) {
      const u0 = i / len, u1 = (i + 1) / len;
      const mx = p0[0] + (p1[0] - p0[0]) * (u0 + u1) / 2, my = p0[1] + (p1[1] - p0[1]) * (u0 + u1) / 2;
      // a gutter segment is a crossing when the blocks on both sides are water
      const wet = horiz
        ? waterAt(Math.round(mx), Math.floor(my)) && waterAt(Math.round(mx), Math.ceil(my))
        : waterAt(Math.floor(mx), Math.round(my)) && waterAt(Math.ceil(mx), Math.round(my));
      if (!wet) continue;
      const a0 = isoPt(p0[0] + (p1[0] - p0[0]) * u0, p0[1] + (p1[1] - p0[1]) * u0);
      const a1 = isoPt(p0[0] + (p1[0] - p0[0]) * u1, p0[1] + (p1[1] - p0[1]) * u1);
      const railOff = 0.055;
      const r0 = isoPt(p0[0] + (p1[0] - p0[0]) * u0 + (horiz ? 0 : railOff), p0[1] + (p1[1] - p0[1]) * u0 + (horiz ? railOff : 0));
      const r1 = isoPt(p0[0] + (p1[0] - p0[0]) * u1 + (horiz ? 0 : railOff), p0[1] + (p1[1] - p0[1]) * u1 + (horiz ? railOff : 0));
      const q0 = isoPt(p0[0] + (p1[0] - p0[0]) * u0 - (horiz ? 0 : railOff), p0[1] + (p1[1] - p0[1]) * u0 - (horiz ? railOff : 0));
      const q1 = isoPt(p0[0] + (p1[0] - p0[0]) * u1 - (horiz ? 0 : railOff), p0[1] + (p1[1] - p0[1]) * u1 - (horiz ? railOff : 0));
      els.push(<g key={'br' + n++}>
        {/* shadow on the water, then deck, then railings and piers */}
        <line x1={a0[0] + 2} y1={a0[1] + 3.5} x2={a1[0] + 2} y2={a1[1] + 3.5} stroke="#2d4f6e" strokeWidth={st.w + 1.5} opacity={0.35} strokeLinecap="butt" />
        <line x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]} stroke="#8a8378" strokeWidth={st.w + 2.4} strokeLinecap="butt" />
        <line x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]} stroke={st.stroke} strokeWidth={st.w} strokeLinecap="butt" />
        <line x1={r0[0]} y1={r0[1] - 1} x2={r1[0]} y2={r1[1] - 1} stroke="#4a4438" strokeWidth={0.6} />
        <line x1={q0[0]} y1={q0[1] - 1} x2={q1[0]} y2={q1[1] - 1} stroke="#4a4438" strokeWidth={0.6} />
        <line x1={(a0[0] + a1[0]) / 2 - 1.5} y1={(a0[1] + a1[1]) / 2 + 1} x2={(a0[0] + a1[0]) / 2 - 1.5} y2={(a0[1] + a1[1]) / 2 + 4} stroke="#5c564c" strokeWidth={1.2} />
        <line x1={(a0[0] + a1[0]) / 2 + 1.5} y1={(a0[1] + a1[1]) / 2 + 1.6} x2={(a0[0] + a1[0]) / 2 + 1.5} y2={(a0[1] + a1[1]) / 2 + 4.6} stroke="#5c564c" strokeWidth={1.2} />
      </g>);
    }
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// ---------- weather ----------
// A month is rainy or foggy or clear, seeded off the campaign — you can't schedule
// around it, and it never touches the numbers. Roughly one month in five gets rain,
// one in eight fog.
type WeatherKind = 'clear' | 'rain' | 'fog';
function weatherOf(seed: number, month: number): WeatherKind {
  let a = (seed ^ Math.imul(month + 11, 0x85ebca6b)) | 0;
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return r < 0.20 ? 'rain' : r < 0.32 ? 'fog' : 'clear';
}

// Boats on the water: hulls and wakes, seeded per tile — the river works too.
const WaterLife = memo(function WaterLife({ tiles, seed }: { tiles: TileGeom[]; seed: number }) {
  const els: React.ReactNode[] = [];
  let boats = 0;
  for (const t of tiles) {
    if (!t.water || t.canal || t.marsh || boats >= 14) continue;   // nothing bigger than a duck fits the canal
    let a = (seed ^ Math.imul(t.i + 1, 2654435761)) | 0;
    const r = () => { a = (a + 0x6D2B79F5) | 0; let v = Math.imul(a ^ (a >>> 15), 1 | a); v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v; return ((v ^ (v >>> 14)) >>> 0) / 4294967296; };
    if (r() > 0.30) continue;
    const [cx, cy] = isoPt(t.x + (r() - 0.5) * 0.5, t.y + (r() - 0.5) * 0.5);
    const barge = r() < 0.3;
    els.push(<g key={'bt' + t.i}>
      <line x1={cx - 3.5} y1={cy + 1.4} x2={cx - 0.8} y2={cy + 0.3} stroke="#dfeaf2" strokeWidth={0.5} opacity={0.55} />
      <line x1={cx - 2.7} y1={cy + 2.2} x2={cx - 0.4} y2={cy + 1.1} stroke="#dfeaf2" strokeWidth={0.4} opacity={0.4} />
      {barge ? (
        <polygon points={`${(cx - 0.6).toFixed(1)},${(cy - 0.4).toFixed(1)} ${(cx + 2.6).toFixed(1)},${(cy + 1.2).toFixed(1)} ${(cx + 3.6).toFixed(1)},${(cy + 0.7).toFixed(1)} ${(cx + 0.4).toFixed(1)},${(cy - 0.9).toFixed(1)}`} fill="#6a5a44" stroke="#3a332a" strokeWidth={0.3} opacity={0.95} />
      ) : (
        <>
          <polygon points={`${(cx - 0.4).toFixed(1)},${(cy - 0.2).toFixed(1)} ${(cx + 1.6).toFixed(1)},${(cy + 0.8).toFixed(1)} ${(cx + 2.3).toFixed(1)},${(cy + 0.4).toFixed(1)} ${(cx + 0.3).toFixed(1)},${(cy - 0.6).toFixed(1)}`} fill="#e8e6dd" stroke="#8a8f94" strokeWidth={0.3} opacity={0.95} />
          <line x1={cx + 0.9} y1={cy + 0.1} x2={cx + 0.9} y2={cy - 1.6} stroke="#5a5148" strokeWidth={0.4} />
        </>
      )}
    </g>);
    boats++;
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// Surface parking on the unbuilt slack of occupied parcels: an asphalt pad with
// painted stalls beside the building, cars in proportion to occupancy. A vacant
// building's empty lot says more about it than any badge. Yard-fabric commercial
// only — street-wall blocks have no forecourt and industrial keeps truck courts.
const ParcelLots = memo(function ParcelLots({ blds, seed, level = 2 }: { blds: IsoBld[]; seed: number; level?: number }) {
  const els: React.ReactNode[] = [];
  const CAR_COLS = ['#5a6570', '#6e5f52', '#4a5a6a', '#75706a', '#5f4a4a'];
  let lots = 0, bins = 0;
  for (const b of blds) {
    if (!b.type || b.prog !== undefined || b.fw === undefined || b.fh === undefined) continue;
    // dense street-wall blocks run on alleys: a dumpster tucked at the side wall
    if (b.tight) {
      if (level >= 3 && bins < 70 && ((b.seed ?? 0) & 3) === 0) {
        const [dx2, dy2] = isoPt(b.cx - b.w / 2 - 0.02, b.cy + b.h * 0.18);
        els.push(<g key={'bin' + bins}>
          <polygon points={`${(dx2 - 1.2).toFixed(1)},${(dy2 - 0.2).toFixed(1)} ${(dx2 + 0.2).toFixed(1)},${(dy2 + 0.5).toFixed(1)} ${(dx2 + 1.2).toFixed(1)},${dy2.toFixed(1)} ${(dx2 - 0.2).toFixed(1)},${(dy2 - 0.7).toFixed(1)}`} fill="#3e4a3c" stroke="#252c24" strokeWidth={0.3} />
          <line x1={dx2 - 1.0} y1={dy2 - 0.9} x2={dx2 + 1.0} y2={dy2 - 0.4} stroke="#252c24" strokeWidth={0.35} />
        </g>);
        bins++;
      }
      continue;
    }
    if (b.type === 'industrial') continue;
    const slackW = b.fw - b.w;
    if (slackW < 0.14 || lots >= 150) continue;
    let a = ((b.seed ?? 1) ^ Math.imul(seed, 0x27d4eb2f)) | 0;
    const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // the pad sits in the slack strip on the parcel's +x side (screen lower-right)
    const padW = slackW * 0.42, padH = b.fh * 0.62;
    const pcx = b.cx + b.w / 2 + padW / 2 + slackW * 0.04, pcy = b.cy;
    els.push(<polygon key={'lp' + lots} points={rectPoly(pcx, pcy, padW, padH)} fill="#585d64" opacity={0.92} />);
    // stall striping: short ticks off a center aisle
    const stalls = Math.max(2, Math.min(5, Math.round(padH / 0.16)));
    const occCars = Math.round((b.occ ?? 0) * stalls * (0.55 + r() * 0.45));
    for (let i = 0; i < stalls; i++) {
      const v = -padH / 2 + (i + 0.5) * (padH / stalls);
      const s0 = isoPt(pcx - padW / 2 + padW * 0.12, pcy + v);
      const s1 = isoPt(pcx + padW / 2 - padW * 0.12, pcy + v);
      els.push(<line key={'ls' + lots + '_' + i} x1={s0[0]} y1={s0[1]} x2={s1[0]} y2={s1[1]} stroke="#9aa0a8" strokeWidth={0.4} opacity={0.7} />);
      if (i < occCars) {
        const [cx2, cy2] = isoPt(pcx + (r() - 0.5) * padW * 0.3, pcy + v + padH / stalls * 0.22);
        els.push(<polygon key={'lc' + lots + '_' + i} points={`${(cx2 - 1.4).toFixed(1)},${(cy2 - 0.2).toFixed(1)} ${(cx2 + 0.3).toFixed(1)},${(cy2 + 0.65).toFixed(1)} ${(cx2 + 1.4).toFixed(1)},${(cy2 + 0.1).toFixed(1)} ${(cx2 - 0.3).toFixed(1)},${(cy2 - 0.75).toFixed(1)}`}
          fill={CAR_COLS[Math.floor(r() * CAR_COLS.length)]} opacity={0.92} />);
      }
    }
    lots++;
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// A parked cruiser on the worst blocks — the city's answer to a number the
// player can already read on the crime lens, made visible on the ground.
const PoliceLayer = memo(function PoliceLayer({ tiles, seed }: { tiles: { i: number; x: number; y: number }[]; seed: number }) {
  const els: React.ReactNode[] = [];
  for (const [k, t] of tiles.entries()) {
    if (k >= 10) break;
    const flip = ((seed ^ t.i) & 1) === 0;
    const [cx, cy] = isoPt(t.x + (flip ? 0.38 : -0.38), t.y + 0.34);
    els.push(<g key={'pc' + t.i}>
      <polygon points={`${(cx - 1.7).toFixed(1)},${(cy - 0.2).toFixed(1)} ${(cx + 0.3).toFixed(1)},${(cy + 0.8).toFixed(1)} ${(cx + 1.7).toFixed(1)},${(cy + 0.1).toFixed(1)} ${(cx - 0.3).toFixed(1)},${(cy - 0.9).toFixed(1)}`} fill="#dfe3e6" stroke="#26303a" strokeWidth={0.35} />
      <line x1={cx - 0.5} y1={cy - 0.5} x2={cx + 0.4} y2={cy - 0.05} stroke="#26303a" strokeWidth={0.5} />
      <circle cx={cx - 0.15} cy={cy - 0.55} r={0.32} fill="#c04a3a" />
      <circle cx={cx + 0.35} cy={cy - 0.3} r={0.32} fill="#3c6ac0" />
    </g>);
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// Street furniture: median planting on the arterials, bus shelters and benches
// where the buses actually run, hydrants and leaning utility poles on the blocks
// the money forgot. Small props, so they only exist at detail zoom.
const StreetFurniture = memo(function StreetFurniture({ runs, seed, level, loD }: {
  runs: RoadRun[]; seed: number; level: number; loD: Set<number>;
}) {
  const els: React.ReactNode[] = [];
  let a = (seed ^ 0x5bd1e995) | 0;
  const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let buses = 0, poles = 0, hyds = 0;
  for (const [ri2, run] of runs.entries()) {
    const [p0, p1] = run.pts;
    const horiz = Math.abs(p1[0] - p0[0]) > Math.abs(p1[1] - p0[1]);
    const len = Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]);
    const midTile = (() => {
      const mx = Math.round((p0[0] + p1[0]) / 2), my = Math.round((p0[1] + p1[1]) / 2);
      return Math.max(0, Math.min(E.CONFIG.GRID_H - 1, my)) * E.CONFIG.GRID_W + Math.max(0, Math.min(E.CONFIG.GRID_W - 1, mx));
    })();
    // median planting down the arterial centerline
    if (run.cls >= 3 && len >= 2) {
      const q0 = isoPt(p0[0], p0[1]), q1 = isoPt(p1[0], p1[1]);
      els.push(<line key={'md' + ri2} x1={q0[0]} y1={q0[1]} x2={q1[0]} y2={q1[1]} stroke="#55703f" strokeWidth={1.0} strokeDasharray="2.2 7" opacity={0.75} />);
    }
    // a bus shelter and bench partway down some collectors and arterials
    if (run.cls === 3 && buses < 26 && r() < 0.5) {
      const u = 0.3 + r() * 0.4;
      const side = r() < 0.5 ? -0.1 : 0.1;
      const [bx, by] = isoPt(p0[0] + (p1[0] - p0[0]) * u + (horiz ? 0 : side), p0[1] + (p1[1] - p0[1]) * u + (horiz ? side : 0));
      els.push(<g key={'bs' + ri2}>
        <rect x={bx - 1.3} y={by - 2.2} width={2.6} height={1.7} fill="#3c4a54" stroke="#28323a" strokeWidth={0.3} opacity={0.95} />
        <line x1={bx - 1.5} y1={by - 2.4} x2={bx + 1.5} y2={by - 2.4} stroke="#8a939c" strokeWidth={0.4} />
        <line x1={bx + 2.2} y1={by - 0.5} x2={bx + 3.4} y2={by - 0.5} stroke="#6b6154" strokeWidth={0.5} />
      </g>);
      buses++;
    }
    // the blocks the money forgot: hydrants and utility poles with a sagging line
    if (level >= 3 && run.cls <= 2 && loD.has(midTile)) {
      if (hyds < 40 && r() < 0.55) {
        const u = 0.15 + r() * 0.3;
        const side = r() < 0.5 ? -0.09 : 0.09;
        const [hx, hy] = isoPt(p0[0] + (p1[0] - p0[0]) * u + (horiz ? 0 : side), p0[1] + (p1[1] - p0[1]) * u + (horiz ? side : 0));
        els.push(<circle key={'hy' + ri2} cx={hx} cy={hy - 0.5} r={0.55} fill="#a34432" opacity={0.95} />);
        hyds++;
      }
      if (poles < 60 && len >= 1.5) {
        const pts: [number, number][] = [];
        for (const u of [0.25, 0.7]) {
          const side = 0.095;
          const [px2, py2] = isoPt(p0[0] + (p1[0] - p0[0]) * u + (horiz ? 0 : side), p0[1] + (p1[1] - p0[1]) * u + (horiz ? side : 0));
          els.push(<g key={'up' + ri2 + '_' + u}>
            <line x1={px2} y1={py2} x2={px2 + 0.2} y2={py2 - 3.4} stroke="#4a4136" strokeWidth={0.5} />
            <line x1={px2 - 0.8} y1={py2 - 3.0} x2={px2 + 1.2} y2={py2 - 3.1} stroke="#4a4136" strokeWidth={0.35} />
          </g>);
          pts.push([px2 + 0.2, py2 - 3.2]);
          poles++;
        }
        if (pts.length === 2) {
          els.push(<path key={'uw' + ri2} d={`M${pts[0][0]} ${pts[0][1]} Q${(pts[0][0] + pts[1][0]) / 2} ${Math.max(pts[0][1], pts[1][1]) + 1.2} ${pts[1][0]} ${pts[1][1]}`}
            fill="none" stroke="#3a352c" strokeWidth={0.3} opacity={0.8} />);
        }
      }
    }
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// Vacant parcels stop reading as lawn and start reading as what they are:
// neglected potential. Gravel scatter, weed tufts, a run of chain-link on some,
// and the occasional billboard earning its ground rent. Seeded per cell.
const VacantLots = memo(function VacantLots({ tiles, grids, seed, season }: {
  tiles: TileGeom[]; grids: (number | null)[][]; seed: number; season: Season;
}) {
  const els: React.ReactNode[] = [];
  const weedCol = season === 'winter' ? '#8a8474' : season === 'fall' ? '#9a8f5a' : '#7a8a52';
  let n = 0, boards = 0;
  for (const t of tiles) {
    if (t.water || t.park || t.canal || n > 380) continue;
    const g = grids[t.i];
    for (let c = 0; c < g.length; c++) {
      if (g[c] !== null || n > 380) continue;
      let a = (seed ^ Math.imul(t.i * 16 + c + 1, 0x9e3779b9)) | 0;
      const r = () => { a = (a + 0x6D2B79F5) | 0; let v = Math.imul(a ^ (a >>> 15), 1 | a); v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v; return ((v ^ (v >>> 14)) >>> 0) / 4294967296; };
      const roll = r();
      if (roll > 0.34) continue;   // most vacant cells stay plain grass — sparse reads better
      const px = c % E.PGRID, py = Math.floor(c / E.PGRID);
      const [ccx, ccy] = parcelCenter(t.x, t.y, px, py);
      // gravel + weeds on all textured cells
      for (let k = 0; k < 3; k++) {
        const [gx, gy] = isoPt(ccx + (r() - 0.5) * 0.14, ccy + (r() - 0.5) * 0.14);
        els.push(k < 2
          ? <circle key={'vg' + n + '_' + k} cx={gx} cy={gy} r={0.5 + r() * 0.4} fill="#9a9788" opacity={0.7} />
          : <path key={'vg' + n + '_' + k} d={`M${gx} ${gy} l${(r() - 0.5).toFixed(1)} ${(-1 - r()).toFixed(1)} M${gx} ${gy} l${(r() - 0.5).toFixed(1)} ${(-0.8 - r()).toFixed(1)}`}
              stroke={weedCol} strokeWidth={0.4} opacity={0.85} />);
      }
      if (roll < 0.075) {
        // chain-link along the street edge: posts and a dashed wire
        const [f0x, f0y] = isoPt(ccx + 0.1, ccy - 0.1);
        const [f1x, f1y] = isoPt(ccx + 0.1, ccy + 0.1);
        els.push(<line key={'vf' + n} x1={f0x} y1={f0y - 1.6} x2={f1x} y2={f1y - 1.6} stroke="#6b6154" strokeWidth={0.4} strokeDasharray="0.9 0.9" opacity={0.9} />);
        for (const [fx, fy] of [[f0x, f0y], [f1x, f1y]] as const) {
          els.push(<line key={'vp' + n + '_' + fx.toFixed(0)} x1={fx} y1={fy} x2={fx} y2={fy - 1.6} stroke="#54493c" strokeWidth={0.5} />);
        }
      }
      if (roll >= 0.075 && roll < 0.09 && boards < 6) {
        // a billboard: two posts and a pale panel, blank — the ad market is soft
        const [bx, by] = isoPt(ccx, ccy);
        els.push(<g key={'vb' + n}>
          <line x1={bx - 1.4} y1={by} x2={bx - 1.4} y2={by - 3.2} stroke="#4a4438" strokeWidth={0.6} />
          <line x1={bx + 1.4} y1={by + 0.6} x2={bx + 1.4} y2={by - 2.6} stroke="#4a4438" strokeWidth={0.6} />
          <polygon points={`${bx - 2.6},${by - 3.2} ${bx + 2.6},${by - 2.2} ${bx + 2.6},${by - 5.2} ${bx - 2.6},${by - 6.2}`}
            fill="#c9c2b2" stroke="#3a332a" strokeWidth={0.4} opacity={0.95} />
        </g>);
        boards++;
      }
      n++;
    }
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

// Sidewalks: a pale concrete band each side of every street, with a darker curb
// line against the asphalt. Drawn under the roads so the road surface reads on
// top; only above the detail zoom threshold — from far out they'd just be noise.
const Sidewalks = memo(function Sidewalks({ runs }: { runs: RoadRun[] }) {
  const els: React.ReactNode[] = [];
  for (const [i, run] of runs.entries()) {
    if (run.cls === 5) continue;   // rail has ballast, not pavement
    const [p0, p1] = run.pts;
    const horiz = Math.abs(p1[0] - p0[0]) > Math.abs(p1[1] - p0[1]);
    const walkOff = 0.115, curbOff = 0.078;
    for (const s of [-1, 1] as const) {
      const w0 = isoPt(p0[0] + (horiz ? 0 : s * walkOff), p0[1] + (horiz ? s * walkOff : 0));
      const w1 = isoPt(p1[0] + (horiz ? 0 : s * walkOff), p1[1] + (horiz ? s * walkOff : 0));
      const c0 = isoPt(p0[0] + (horiz ? 0 : s * curbOff), p0[1] + (horiz ? s * curbOff : 0));
      const c1 = isoPt(p1[0] + (horiz ? 0 : s * curbOff), p1[1] + (horiz ? s * curbOff : 0));
      els.push(<line key={'sw' + i + s} x1={w0[0]} y1={w0[1]} x2={w1[0]} y2={w1[1]} stroke="#b2b6ab" strokeWidth={1.3} opacity={0.55} strokeLinecap="round" />);
      els.push(<line key={'cb' + i + s} x1={c0[0]} y1={c0[1]} x2={c1[0]} y2={c1[1]} stroke="#878c81" strokeWidth={0.45} opacity={0.7} />);
    }
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>;
});

const RoadsIso = memo(function RoadsIso({ runs, wet = false, plowed = false }: { runs: RoadRun[]; wet?: boolean; plowed?: boolean }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      {runs.map((r, i) => {
        const st = ROAD_STYLE[r.cls];
        const pts = r.pts.map(p => isoPt(p[0], p[1])).map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
        return (
          <g key={i}>
            {/* winter: the plow berm sits just outside the travel lanes */}
            {plowed && r.cls >= 2 && r.cls !== 5 && <polyline points={pts} fill="none" stroke="#dfe5e9" strokeWidth={st.w + 2.2} opacity={0.4} strokeLinecap="round" />}
            <polyline points={pts} fill="none" stroke={st.stroke} strokeWidth={st.w} strokeDasharray={st.dash} strokeLinecap="round" />
            {r.cls === 3 && <polyline points={pts} fill="none" stroke="#e8e4d0" strokeWidth={0.7} strokeDasharray="5 7" />}
            {r.cls === 4 && <polyline points={pts} fill="none" stroke="#f0ead6" strokeWidth={0.8} strokeDasharray="10 4" />}
            {wet && r.cls >= 2 && <polyline points={pts} fill="none" stroke="#cfd8e2" strokeWidth={st.w * 0.45} opacity={0.12} strokeLinecap="round" />}
          </g>
        );
      })}
    </g>
  );
});
const RoadsFlat = memo(function RoadsFlat({ runs }: { runs: RoadRun[] }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      {runs.map((r, i) => {
        const st = ROAD_STYLE[r.cls];
        const [a, b] = r.pts;
        return (
          <g key={i}>
            <line x1={(a[0] + 0.5) * TS} y1={(a[1] + 0.5) * TS} x2={(b[0] + 0.5) * TS} y2={(b[1] + 0.5) * TS}
              stroke={st.stroke} strokeWidth={st.w * 0.8} strokeDasharray={st.dash} strokeLinecap="round" />
            {r.cls >= 3 && <line x1={(a[0] + 0.5) * TS} y1={(a[1] + 0.5) * TS} x2={(b[0] + 0.5) * TS} y2={(b[1] + 0.5) * TS}
              stroke="#59636f" strokeWidth={0.6} strokeDasharray="5 7" />}
          </g>
        );
      })}
    </g>
  );
});

// ---------- memoized layers ----------
// The map draws thousands of SVG nodes. Splitting it into layers memoized on stable
// identities means hover, pan and zoom re-render a tooltip div — not the city.
type TileGeom = { i: number; x: number; y: number; water: boolean; park?: boolean; dust?: boolean; canal?: boolean; marsh?: boolean };

// Ground: grass, not pavement. Three seeded lawn tones so the field doesn't read
// flat, dusty hardpan under the industrial zoning, and parks get real canopies.
// The lawn follows the calendar: frost-grey in winter, straw in fall.
export type Season = 'winter' | 'spring' | 'summer' | 'fall';
export const seasonOf = (month: number): Season => {
  const m = ((month % 12) + 12) % 12;   // month 0 = January
  return m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'fall';
};
const GRASS_BY: Record<Season, string[]> = {
  summer: ['#8fb168', '#96b76f', '#87aa60'],
  spring: ['#93b874', '#9cbe7d', '#8bb06b'],
  fall: ['#a3a468', '#aaa96e', '#9a9c60'],
  winter: ['#a4ada0', '#aab3a6', '#9da699'],
};
const PARK_BY: Record<Season, string> = { summer: '#6f9e53', spring: '#77a55e', fall: '#8b9153', winter: '#93a08f' };
const CANOPY_BY: Record<Season, [string, string]> = {
  summer: ['#4e7d40', '#5b8a4a'], spring: ['#5d8f4c', '#6a9c58'],
  fall: ['#a3762f', '#8c6a30'], winter: ['#7d746a', '#6e6a62'],
};
const DUST = ['#b5ac8b', '#aea687', '#bab190'];
const TileBaseIso = memo(function TileBaseIso({ tiles, season = 'summer' }: { tiles: TileGeom[]; season?: Season }) {
  const GRASS = GRASS_BY[season];
  return <g>{tiles.map(t => {
    const gi = ((t.x * 7 + t.y * 13) | 0) % 3;
    // canal tiles paint as banks — the water itself is a narrow spine drawn on top
    const fill = t.park ? PARK_BY[season] : t.canal ? GRASS[gi] : t.marsh ? (season === 'winter' ? '#8a9188' : '#7d8d6b') : t.water ? '#5b9ec9' : t.dust ? DUST[gi] : GRASS[gi];
    const trees: React.ReactNode[] = [];
    if (t.marsh) {
      // wetland: standing water glints and reed clumps — the land nobody drained
      let a3 = (t.i * 0x85ebca6b) | 0;
      const r3 = () => { a3 = (a3 + 0x6D2B79F5) | 0; let v = Math.imul(a3 ^ (a3 >>> 15), 1 | a3); v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v; return ((v ^ (v >>> 14)) >>> 0) / 4294967296; };
      for (let k = 0; k < 3; k++) {
        const [mx, my] = isoPt(t.x + (r3() - 0.5) * 0.6, t.y + (r3() - 0.5) * 0.6);
        trees.push(<ellipse key={'mw' + t.i + '_' + k} cx={mx} cy={my} rx={2.2 + r3() * 2} ry={1 + r3()} fill="#5b8aa4" opacity={0.5} />);
        trees.push(<path key={'mr' + t.i + '_' + k} d={`M${mx - 2} ${my} l0.3 -2.2 M${mx - 1.2} ${my + 0.4} l0.2 -1.8 M${mx - 2.7} ${my + 0.3} l0.1 -1.7`}
          stroke="#5e6a45" strokeWidth={0.45} fill="none" opacity={0.9} />);
      }
    }
    if (t.park) {
      let a = (t.i * 2654435761) | 0;
      const r = () => { a = (a + 0x6D2B79F5) | 0; let v = Math.imul(a ^ (a >>> 15), 1 | a); v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v; return ((v ^ (v >>> 14)) >>> 0) / 4294967296; };
      // paths cross the lawn; every third park keeps a pond
      const [pc0, pc1] = [isoPt(t.x - 0.42, t.y), isoPt(t.x + 0.42, t.y)];
      const [pc2, pc3] = [isoPt(t.x, t.y - 0.42), isoPt(t.x, t.y + 0.42)];
      trees.push(<line key={'pp0' + t.i} x1={pc0[0]} y1={pc0[1]} x2={pc1[0]} y2={pc1[1]} stroke="#cfc4a4" strokeWidth={1.1} opacity={0.8} />);
      trees.push(<line key={'pp1' + t.i} x1={pc2[0]} y1={pc2[1]} x2={pc3[0]} y2={pc3[1]} stroke="#cfc4a4" strokeWidth={1.1} opacity={0.8} />);
      if (r() < 0.34) {
        const [px2, py2] = isoPt(t.x + 0.2, t.y + 0.18);
        trees.push(<ellipse key={'pd' + t.i} cx={px2} cy={py2} rx={4.6} ry={2.2} fill="#5b9ec9" stroke="#4a86ad" strokeWidth={0.6} opacity={0.95} />);
      }
      for (let k = 0; k < 6; k++) {
        const [cx, cy] = isoPt(t.x + (r() - 0.5) * 0.62, t.y + (r() - 0.5) * 0.62);
        const [cA, cB] = CANOPY_BY[season];
        trees.push(<circle key={'pt' + t.i + '_' + k} cx={cx} cy={cy - 1.8} r={(1.7 + r() * 1.3) * (season === 'winter' ? 0.75 : 1)}
          fill={r() < 0.5 ? cA : cB} opacity={season === 'winter' ? 0.7 : 0.95} />);
      }
    }
    // winter lays unplowed snow in the middle of every block — the lawns hold it
    const mottle: React.ReactNode[] = [];
    if (season === 'winter' && !t.water && !t.canal) {
      let a2 = (t.i * 0x9e3779b9) | 0;
      const r2 = () => { a2 = (a2 + 0x6D2B79F5) | 0; let v = Math.imul(a2 ^ (a2 >>> 15), 1 | a2); v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v; return ((v ^ (v >>> 14)) >>> 0) / 4294967296; };
      const [mx, my] = isoPt(t.x + (r2() - 0.5) * 0.4, t.y + (r2() - 0.5) * 0.4);
      mottle.push(<ellipse key={'sn' + t.i} cx={mx} cy={my} rx={6 + r2() * 5} ry={3 + r2() * 2.4} fill="#e6ebee" opacity={0.28} />);
    }
    // land tiles draw unstroked: the streets themselves delineate the blocks now,
    // so two blocks with no street between them read as one superblock
    const strokeCol = t.marsh ? '#6d7a5e' : t.water && !t.canal ? '#5b9ec9' : undefined;
    return <g key={'st' + t.i}>
      <polygon points={diamond(t.x, t.y)} fill={fill} stroke={strokeCol} strokeWidth={strokeCol ? 0.5 : undefined} />
      {mottle}
      {trees}
    </g>;
  })}</g>;
});

const LensCellsIso = memo(function LensCellsIso({ tiles, grids, vals, hue, zb }: {
  tiles: TileGeom[]; grids: (number | null)[][]; vals: number[]; hue: [number, number, number]; zb: number;
}) {
  // Heat maps are analysis, not scenery: the lens paints OPAQUE from a neutral
  // light base to the full hue, so the gradient reads instantly — the grass lives
  // in the City view, and the data doesn't have to fight it.
  const BASE: [number, number, number] = [214, 215, 208];
  return <g>{tiles.map(t => {
    if (t.water) return null;
    const v = Math.pow(vals[t.i], 0.72);
    const fill = lerpColor(BASE, hue, 0.06 + v * 0.94);
    const dim = lerpColor(BASE, hue, 0.04 + v * 0.62);
    // zoomed out, one diamond per block carries the lens — 280 polygons instead of 4,480.
    // The per-parcel weave only earns its cost once you can actually see parcels.
    if (zb === 0) return <polygon key={'p' + t.i} points={diamond(t.x, t.y, 0.97)} fill={dim} stroke="#8a8f80" strokeWidth={0.5} strokeOpacity={0.5} />;
    const g = grids[t.i];
    const cells = [];
    for (let py = 0; py < E.PGRID; py++) for (let px = 0; px < E.PGRID; px++) {
      const occupied = g[py * E.PGRID + px] !== null;
      const [cx, cy] = parcelCenter(t.x, t.y, px, py);
      const [w, h] = parcelSpan(1, 1);
      cells.push(
        <polygon key={t.i + '-' + px + '-' + py} points={rectPoly(cx, cy, w * 0.9, h * 0.9)}
          fill={occupied ? fill : dim}
          stroke={occupied ? '#8f947f' : '#9aa088'} strokeWidth={zb >= 2 ? 0.55 : 0.3}
          strokeOpacity={zb >= 1 ? 0.6 : 0.3} />
      );
    }
    return <g key={'p' + t.i}>{cells}</g>;
  })}</g>;
});

const HitLayerIso = memo(function HitLayerIso({ tiles, onEnter, onLeave, onClick }: {
  tiles: TileGeom[];
  onEnter: (tileI: number, px: number, py: number, e: React.PointerEvent) => void;
  onLeave: () => void;
  onClick: (tileI: number, px: number, py: number) => void;
}) {
  return <g>{tiles.map(t => {
    if (t.water) return null;
    const hits = [];
    for (let py = 0; py < E.PGRID; py++) for (let px = 0; px < E.PGRID; px++) {
      const [cx, cy] = parcelCenter(t.x, t.y, px, py);
      const [w, h] = parcelSpan(1, 1);
      hits.push(
        <polygon key={t.i + '-h-' + px + '-' + py} points={rectPoly(cx, cy, w, h)} fill="transparent"
          style={{ cursor: 'pointer' }}
          onPointerEnter={e => onEnter(t.i, px, py, e)}
          onPointerLeave={onLeave}
          onClick={() => onClick(t.i, px, py)} />
      );
    }
    return <g key={'hit' + t.i}>{hits}</g>;
  })}</g>;
});

const FieldFlat = memo(function FieldFlat({ field, hue }: { field: { x: number; y: number; v: number }[]; hue: [number, number, number] }) {
  const sub = TS / SUB;
  return <g>{field.map((c, k) => (
    <rect key={k} x={c.x * TS} y={c.y * TS} width={sub + 0.5} height={sub + 0.5}
      fill={lerpColor([214, 215, 208], hue, 0.05 + Math.pow(Math.max(0, Math.min(1, c.v)), 0.72) * 0.95)} />
  ))}</g>;
});

// Flat-view ground under the lens wash — same grass/dust/park read as the iso
// view, and the same calendar: the plan sheet is no longer stuck in July.
const FlatGround = memo(function FlatGround({ tiles, season = 'summer' }: { tiles: TileGeom[]; season?: Season }) {
  return <g>{tiles.map(t => {
    if (t.water && !t.canal) return null;
    const gi = ((t.x * 7 + t.y * 13) | 0) % 3;
    return <rect key={'fg' + t.i} x={t.x * TS} y={t.y * TS} width={TS} height={TS}
      fill={t.park ? PARK_BY[season] : t.dust ? DUST[gi] : GRASS_BY[season][gi]} stroke="#c3c5b4" strokeWidth={0.8} />;
  })}</g>;
});

// The zoning map: categorical, not scalar — use class sets the color, tier sets how
// loud it is. Blocks before the council get a dashed ring; nothing here predicts,
// it just shows you the paper.
// tiles/rezonings arrive as fresh identities after every engine clone — the stamp is
// the real change signal, so the memo compares only it
const zoneEq = (a: { zoneStamp: string }, b: { zoneStamp: string }) => a.zoneStamp === b.zoneStamp;
const ZoningIso = memo(function ZoningIso({ tiles, rezonings, zoneStamp }: {
  tiles: Tile[]; rezonings: E.Rezoning[]; zoneStamp: string;
}) {
  void zoneStamp;
  const pend = new Set(rezonings.map(r => r.tileI));
  return <g style={{ pointerEvents: 'none' }}>{tiles.map(t => {
    if (t.water) return null;
    const op = t.zone.tier === 1 ? 0.26 : t.zone.tier === 2 ? 0.44 : 0.62;
    const p = isoPt(t.x, t.y);
    return <g key={'z' + t.i}>
      <polygon points={diamond(t.x, t.y, 0.96)} fill={ZONE_COL[t.zone.use]} opacity={op} />
      {pend.has(t.i) && <polygon points={diamond(t.x, t.y, 0.9)} fill="none" stroke="#4a4438" strokeWidth={1.4} strokeDasharray="5 4" opacity={0.9} />}
      <text x={p[0]} y={p[1] + 3} textAnchor="middle" fontSize={8} fontFamily="var(--mono)" fontWeight={600}
        fill="#2e3328" opacity={0.8}>{E.zoneCode(t.zone)}</text>
    </g>;
  })}</g>;
}, zoneEq);
const ZoningFlat = memo(function ZoningFlat({ tiles, rezonings, zoneStamp }: {
  tiles: Tile[]; rezonings: E.Rezoning[]; zoneStamp: string;
}) {
  void zoneStamp;
  const pend = new Set(rezonings.map(r => r.tileI));
  return <g style={{ pointerEvents: 'none' }}>{tiles.map(t => {
    if (t.water) return null;
    const op = t.zone.tier === 1 ? 0.3 : t.zone.tier === 2 ? 0.5 : 0.68;
    return <g key={'z' + t.i}>
      <rect x={t.x * TS + 1} y={t.y * TS + 1} width={TS - 2} height={TS - 2} fill={ZONE_COL[t.zone.use]} opacity={op} />
      {pend.has(t.i) && <rect x={t.x * TS + 4} y={t.y * TS + 4} width={TS - 8} height={TS - 8} fill="none" stroke="#4a4438" strokeWidth={1.4} strokeDasharray="5 4" />}
      <text x={(t.x + 0.5) * TS} y={(t.y + 0.5) * TS + 3} textAnchor="middle" fontSize={9} fontFamily="var(--mono)" fontWeight={600}
        fill="#2e3328" opacity={0.85}>{E.zoneCode(t.zone)}</text>
    </g>;
  })}</g>;
});

// Flat-view buildings from the same parcel-true geometry as the iso view —
// the two views finally agree about where every building stands.
const FlatBuildings = memo(function FlatBuildings({ blds }: { blds: IsoBld[] }) {
  return <g style={{ pointerEvents: 'none' }}>{blds.map(b => (
    <rect key={b.key} x={(b.cx + 0.5 - b.w / 2) * TS} y={(b.cy + 0.5 - b.h / 2) * TS}
      width={b.w * TS} height={b.h * TS}
      fill={b.col} stroke={b.listed ? 'var(--green)' : '#10151a'} strokeWidth={b.listed ? 1.4 : 0.7}
      strokeDasharray={b.prog !== undefined ? '3 2' : undefined} />
  ))}</g>;
});

// Break ground on all of it — or open the parcel picker and stake out just the
// corner you want. The rest of the dirt stays banked, basis pro-rata.
function OwnLandDev({ state, setState, holding, openDeal }: {
  state: GameState; setState: (s: GameState) => void; holding: E.LandHolding;
  openDeal: (id: number) => void;
}) {
  const d = E.developableFrom(state, holding.id);
  const dset = new Set(d.cells);
  const [open, setOpen] = useState(false);
  const [selCells, setSelCells] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // picker open: exactly what's selected (deselect-all means nothing, not everything)
  const picked = (open ? selCells : d.cells).filter(c => dset.has(c));
  const toggle = (c: number) => setSelCells(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  const acres = Math.round(picked.length * E.PARCEL_AC * 100) / 100;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {holding.loan && (
          <span className="chip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
            title={`Interest-only at ${holding.loan.ratePct.toFixed(2)}% — balloons ${E.monthName(holding.loan.maturityMonth)}. Repaid at sale or groundbreaking; repayable early from the Debt tab.`}>
            Land loan {E.fmtMoney(holding.loan.balance)} · due {E.monthName(holding.loan.maturityMonth)}
          </span>
        )}
        {holding.forSale && <span className="chip chip-agreed">Listed · ask {E.fmtMoney(holding.forSale.ask)}</span>}
        {holding.forSale
          ? <button className="btn btn-sm" onClick={() => setState(E.delistLand(state, holding.id))}>Delist</button>
          : <button className="btn btn-sm" title="Land sells slowly — list it and field the offers as they trickle in" onClick={() => setState(E.listLandForSale(state, holding.id).s)}>List for sale</button>}
        <button className="btn btn-sm" onClick={() => { setSelCells(open ? [] : [...d.cells]); setOpen(!open); setErr(null); }}>{open ? 'Whole site' : 'Choose parcels ▾'}</button>
        <button className="btn btn-sm btn-amber"
          title={d.holdings.length > 1 && !open ? `Builds together with ${d.holdings.length - 1} adjoining holding(s) — ${Math.round(d.cells.length * E.PARCEL_AC * 100) / 100} acres total` : undefined}
          disabled={picked.length === 0}
          onClick={() => {
            const r = picked.length === d.cells.length ? E.developLand(state, holding.id) : E.developLandCells(state, holding.id, picked);
            if (r.err) { setErr(r.err); return; }
            setErr(null);
            setState(r.s); if (r.listingId) openDeal(r.listingId);
          }}>Break ground ▸ ({acres} ac)</button>
      </div>
      {err && <div className="alert-strip red" style={{ marginTop: 6 }}>{err}</div>}
      {open && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 }}>
          <span className="faint" style={{ fontSize: 10.5, maxWidth: 190, textAlign: 'right' }}>
            Click parcels to stake the site — it must stay contiguous. The rest stays banked.
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${E.PGRID}, 17px)`, gap: 2 }}>
            {Array.from({ length: E.PGRID * E.PGRID }, (_, c) => {
              const owned = dset.has(c);
              const on = owned && picked.includes(c);
              return (
                <button key={c} disabled={!owned} onClick={() => toggle(c)}
                  title={owned ? (on ? 'In the site' : 'Left banked') : 'Not yours'}
                  style={{
                    width: 17, height: 17, borderRadius: 3, cursor: owned ? 'pointer' : 'default', padding: 0,
                    border: '1px solid ' + (on ? 'var(--amber)' : owned ? 'var(--line)' : 'var(--line2)'),
                    background: on ? 'rgba(217,166,72,0.45)' : owned ? 'var(--panel3)' : 'transparent',
                  }} />
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export function MapView({ state, setState, selTile, setSelTile, openDeal, openStock, openAsset, focusTile, advance, advanceUntil, devGhost }: {
  state: GameState; setState: (s: GameState) => void; selTile: number | null; setSelTile: (i: number | null) => void;
  openDeal: (id: number) => void; openStock: (id: number) => void; openAsset: (id: number) => void;
  focusTile?: number | null; advance?: (n: number) => void; advanceUntil?: () => void;
  devGhost?: { tileI: number; cells?: number[]; parcel?: { px: number; py: number; pw: number; ph: number }; type: E.PType; construction: string; sf: number } | null;
}) {
  const [hover, setHover] = useState<{ text: string; sub: string; x: number; y: number } | null>(null);
  const [hoverCell, setHoverCell] = useState<{ tileI: number; px: number; py: number } | null>(null);
  const [lens, setLens] = useState<Lens>('city');
  const [view, setView] = useState<'iso' | 'flat'>('iso');
  const [showBldgs, setShowBldgs] = useState(true);
  // one knob for everything atmospheric; every ambient layer below gates on this
  const [ambient, setAmbient] = useState<AmbientLevel>(loadAmbient);
  const cycleAmbient = () => setAmbient(a => { const n = ((a + 1) % 4) as AmbientLevel; saveAmbient(n); return n; });
  const noMotion = prefersReducedMotion();
  void noMotion; // consumed by the ambient layers as they land tonight
  const W = E.CONFIG.GRID_W * TS, H = E.CONFIG.GRID_H * TS;
  const IW_TOT = (E.CONFIG.GRID_W + E.CONFIG.GRID_H) * (IW / 2) + IOX * 2;
  const IH_TOT = (E.CONFIG.GRID_W + E.CONFIG.GRID_H) * (IH / 2) + IOY + 40;
  const isoBlds = useIsoBuildings(state);
  const mixAll = useMemo(() => E.computeMix(state), [state]);
  const tileVals = useTileValues(state, lens);
  useEffect(() => {
    if (focusTile === null || focusTile === undefined) return;
    const t = state.tiles[focusTile];
    if (t) { setSelTile(focusTile); vpIso.focusOn(isoPt(t.x, t.y)); }
  }, [focusTile]); // eslint-disable-line
  const gridStamp = state.stock.length + ':' + state.assets.length + ':' + state.listings.length
    + ':' + state.listings.reduce((s2, l) => s2 + (l.parcel || l.parcelCells ? l.id : 0), 0)
    + ':' + state.land.length + ':' + state.land.reduce((s2, h) => s2 + h.cells.length + (h.id % 97) * h.cells.length, 0)
    + ':' + state.firmLand.map(e => e.short + e.tileI + '.' + e.cells.length).join('|');
  const grids = useMemo(() => state.tiles.map(t => E.parcelGrid(state, t.i)), [gridStamp, state.seed]); // eslint-disable-line
  const [selCells, setSelCells] = useState<{ tileI: number; cells: number[] } | null>(null);
  const zoneStamp = state.tiles.map(t => t.water ? '' : t.zone.use + t.zone.tier).join('')
    + ':' + state.rezonings.length + ':' + state.rezonings.reduce((s2, r) => s2 + r.tileI, 0);
  // Per-seed geometry + a live ref so the memoized layers never re-render on hover;
  // the dust flag encodes M-zoning, so a rezoning has to re-cut the ground too.
  const tilesGeom = useMemo(() => state.tiles.map(t => ({ i: t.i, x: t.x, y: t.y, water: t.water, park: t.park, canal: t.canal, dust: !t.water && t.zone.use === 'M', rz: !t.water && t.zone.use === 'R', marsh: t.marsh })), [state.seed, zoneStamp]); // eslint-disable-line
  const vpIso = useViewport(0, 0, IW_TOT, IH_TOT);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const vpFlat = useViewport(-20, -18, W + 24, H + 22);
  const field = useField(state, lens);
  const river = useMemo(() => riverGeometry(state), [state.seed]);
  const runs = useMemo(() => roadRuns(state.roads), [state.seed]); // eslint-disable-line
  // the blocks the money forgot — recomputed only when the count shifts, so the
  // furniture layer doesn't churn on every desirability drift
  const loDStamp = state.tiles.reduce((s2, t) => s2 + (!t.water && t.D < 45 ? 1 : 0), 0);
  const loD = useMemo(() => new Set(state.tiles.filter(t => !t.water && t.D < 45).map(t => t.i)), [loDStamp, state.seed]); // eslint-disable-line
  const hiDStamp = state.tiles.reduce((s2, t) => s2 + (!t.water && t.D > 70 ? 1 : 0), 0);
  const hiD = useMemo(() => new Set(state.tiles.filter(t => !t.water && t.D > 70).map(t => t.i)), [hiDStamp, state.seed]); // eslint-disable-line
  const busyStamp = state.tiles.reduce((s2, t) => s2 + (!t.water && t.emp > 55 ? 1 : 0), 0);
  const busy = useMemo(() => new Set(state.tiles.filter(t => !t.water && t.emp > 55).map(t => t.i)), [busyStamp, state.seed]); // eslint-disable-line
  const rtStamp = state.tiles.reduce((s2, t) => s2 + (!t.water && (t.supply.retail ?? 0) > 14000 ? 1 : 0), 0);
  const retailish = useMemo(() => new Set(state.tiles.filter(t => !t.water && (t.supply.retail ?? 0) > 14000).map(t => t.i)), [rtStamp, state.seed]); // eslint-disable-line
  const copStamp = state.tiles.reduce((s2, t) => s2 + (!t.water && t.crime > 65 ? 1 : 0), 0);
  const copTiles = useMemo(() => state.tiles.filter(t => !t.water && t.crime > 65).map(t => ({ i: t.i, x: t.x, y: t.y })), [copStamp, state.seed]); // eslint-disable-line
  const hue = LENS_HUE[lens];
  // and the season rides the same calendar — Off pins the city to summer
  const season: Season = ambient >= 1 ? seasonOf(state.month) : 'summer';
  const weather: WeatherKind = ambient >= 2 ? weatherOf(state.seed, state.month) : 'clear';

  const sel = selTile !== null ? state.tiles[selTile] : null;
  const transitActive = state.effects.some(e => e.kind === 'transit');
  const listingsOn = (i: number) => state.listings.filter(l => l.tileI === i);
  const assetsOn = (i: number) => state.assets.filter(a => a.tileI === i);
  const stockOn = (i: number) => state.stock.filter(b => b.tileI === i);

  // ---- rezoning desk: what you ask the council for ----
  const [rzUse, setRzUse] = useState<E.ZoneUse>('MU');
  const [rzTier, setRzTier] = useState<1 | 2 | 3>(2);
  const [rzErr, setRzErr] = useState<string | null>(null);
  useEffect(() => {
    setRzErr(null);
    if (selTile !== null) { const z = state.tiles[selTile].zone; setRzUse(z.use); setRzTier(Math.min(3, z.tier + 1) as 1 | 2 | 3); }
  }, [selTile]); // eslint-disable-line

  // ---- assembly: contiguity analysis, ghost preview, escape to clear ----
  const [ghostType, setGhostType] = useState<E.PType | null>(null);
  useEffect(() => { setGhostType(null); }, [selCells?.tileI]); // eslint-disable-line
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelCells(null); return; }
      const el = e.target as HTMLElement;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if (document.querySelector('.modal-back')) return;
      const idx = '123456789'.indexOf(e.key);
      if (idx >= 0 && idx < LENSES.length) { setLens(LENSES[idx].id); return; }
      if (e.key === 'v' || e.key === 'V') setView(v => v === 'iso' ? 'flat' : 'iso');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // deliveries get their moment: track what left construction this month and
  // ring it gold — the most important event on the map deserves more than
  // silently existing
  const [delivered, setDelivered] = useState<{ tileI: number; cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }[]>([]);
  const prevUC = useRef<Set<string>>(new Set());
  useEffect(() => {
    const uc = new Set<string>();
    for (const b of state.stock) if (b.buildLeft) uc.add('b' + b.id);
    for (const a of state.assets) if (a.mode === 'construction') uc.add('a' + a.id);
    const out: { tileI: number; cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }[] = [];
    for (const k of prevUC.current) {
      if (uc.has(k)) continue;
      if (k[0] === 'b') { const b = state.stock.find(x => x.id === Number(k.slice(1))); if (b) out.push(b); }
      else { const a = state.assets.find(x => x.id === Number(k.slice(1))); if (a) out.push(a); }
    }
    prevUC.current = uc;
    if (out.length) {
      setDelivered(out);
      const id = setTimeout(() => setDelivered([]), 3200);
      return () => clearTimeout(id);
    }
  }, [state.month]); // eslint-disable-line
  // when the clock ticks, the map acknowledges it: blocks that made news pulse briefly
  // and a one-line digest reports what the month brought
  const [pulseTiles, setPulseTiles] = useState<number[]>([]);
  const [digest, setDigest] = useState<string | null>(null);
  const prevMonth = useRef(state.month);
  useEffect(() => {
    if (state.month === prevMonth.current) return;
    prevMonth.current = state.month;
    const items = state.news.filter(n => n.m === state.month);
    const tiles = [...new Set(items.filter(n => n.tileI !== undefined).map(n => n.tileI!))];
    if (tiles.length) setPulseTiles(tiles);
    const kinds: Record<string, number> = {};
    for (const n of items) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
    const bits = Object.entries(kinds).map(([k, c]) => `${c} ${k}${c > 1 ? 's' : ''}`);
    setDigest(`${E.monthName(state.month)} · ${bits.length ? bits.join(' · ') : 'a quiet month'}`);
    const id = setTimeout(() => { setPulseTiles([]); setDigest(null); }, 2400);
    return () => clearTimeout(id);
  }, [state.month, state.news]);
  const selInfo = useMemo(() => {
    if (!selCells) return null;
    const remaining = new Set(selCells.cells);
    const groups: number[][] = [];
    while (remaining.size) {
      const start = remaining.values().next().value as number;
      const g2 = E.connectedGroup([...remaining], start);
      for (const c of g2) remaining.delete(c);
      groups.push(g2);
    }
    groups.sort((a, b) => b.length - a.length);
    const main = groups[0] ?? [];
    const stray = selCells.cells.filter(c => !main.includes(c));
    // vacant lots adjoining the main site — the natural next moves
    const g = grids[selCells.tileI];
    const cand = new Set<number>();
    for (const c of main) {
      const cx = c % E.PGRID, cy = Math.floor(c / E.PGRID);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= E.PGRID || ny >= E.PGRID) continue;
        const n = ny * E.PGRID + nx;
        if (g[n] === null && !selCells.cells.includes(n)) cand.add(n);
      }
    }
    const t = state.tiles[selCells.tileI];
    const legal = E.PTYPES.filter(ty => !(ty === 'mixed' && state.tier < 1) && E.zoneAllows(t.zone, ty));
    const best = (legal.length ? legal : E.ZONE_ALLOWS[t.zone.use])
      .map(ty => ({ ty, fit: E.tileDemandFactor(state, t, ty) })).sort((a, b) => b.fit - a.fit)[0].ty;
    return { main, stray, cand: [...cand], best };
  }, [selCells, grids, state]);
  const effGhost = ghostType ?? selInfo?.best ?? null;

  const live = useRef({ state, grids, openDeal, openStock, openAsset, setSelTile });
  live.current = { state, grids, openDeal, openStock, openAsset, setSelTile };
  const hitLeave = useCallback(() => { setHover(null); setHoverCell(null); }, []);
  const hitEnter = useCallback((tileI: number, px: number, py: number, e: React.PointerEvent) => {
    const { state: s, grids: g } = live.current;
    const t = s.tiles[tileI];
    setHoverCell({ tileI, px, py });
    const occ = g[tileI][py * E.PGRID + px];
    const r = wrapRef.current?.getBoundingClientRect();
    let text = `Unlisted · ${E.PARCEL_AC} ac`, sub2 = `Block ${blockName(t)} · owner not marketing`;
    {
      const rec = E.parcelApproachState(s, tileI, py * E.PGRID + px);
      if (rec?.outcome === 'refused') { text = 'Not for sale'; sub2 = `owner refused ${E.monthName(rec.m)} — try again in a few months`; }
    }
    if (occ !== null) {
      if (occ >= 2_000_000) {
        const fe = s.firmLand[occ - 2_000_000];
        const f = fe ? s.firms.find(x => x.short === fe.short) : undefined;
        text = `${f?.name ?? 'A rival'} holds this dirt`;
        sub2 = fe ? `${fe.cells.length} parcel${fe.cells.length > 1 ? 's assembled' : ''} · buying since ${E.monthName(fe.m)}` : '';
      } else if (occ >= 1_000_000) {
        const hd = s.land.find(x => x.id === occ - 1_000_000);
        text = 'Your land'; sub2 = hd ? `${Math.round(hd.cells.length * E.PARCEL_AC * 100) / 100} ac banked · basis ${E.fmtMoney(hd.basis)}` : '';
      } else if (occ < 0) {
        const l = s.listings.find(x => x.id === -occ);
        text = (l as any)?.omLead ? 'Known ask — off-market' : l?.kind === 'land' ? 'Land for sale' : 'For sale'; sub2 = l ? `${E.fmtMoney(l.price)}` : '';
      } else {
        const b = s.stock.find(x => x.id === occ);
        const a = s.assets.find(x => x.id === occ);
        if (b) {
          text = `${(b.sf / 1000).toFixed(0)}K SF ${E.PLABEL[b.type]}`;
          sub2 = b.buildLeft ? `Under construction · ${b.buildLeft} mo left${b.builder ? ' · ' + b.builder : ''}`
            : `${b.owner === 'private' ? 'Private owner' : b.owner} · ${pct(b.occ)} leased · ${E.QLABEL[E.qGrade(b.quality)]}-grade`;
        } else if (a) {
          text = a.name;
          sub2 = a.mode === 'construction' ? `Your project · ${a.project?.monthsLeft ?? 0} mo left`
            : `Yours · ${pct(a.occ)} leased · ${E.fmtMoney(E.assetValue(s, a))}`;
        }
      }
    }
    setHover({ text, sub: sub2, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  }, []); // eslint-disable-line
  const hitClick = useCallback((tileI: number, px: number, py: number) => {
    if (vpIso.moved.current) return;
    const { state: s, grids: g, openDeal: od, openStock: os, openAsset: oa, setSelTile: st } = live.current;
    const occ = g[tileI][py * E.PGRID + px];
    st(tileI);
    if (occ === null) {
      const cell = py * E.PGRID + px;
      setSelCells(prev => {
        if (!prev || prev.tileI !== tileI) return { tileI, cells: [cell] };
        const has = prev.cells.includes(cell);
        const cells = has ? prev.cells.filter(c => c !== cell) : [...prev.cells, cell];
        return cells.length ? { tileI, cells } : null;
      });
      return;
    }
    setSelCells(null);
    if (occ < 0) { od(-occ); return; }
    if (occ >= 1_000_000) return;   // banked dirt, yours or a rival's — the block panel handles it
    const mine = s.assets.find(x => x.id === occ);
    if (mine) { oa(mine.id); return; }
    const b = s.stock.find(x => x.id === occ);
    if (b) { b.listedId ? od(b.listedId) : os(b.id); }
  }, []); // eslint-disable-line
  const zb = vpIso.z > 2.3 ? 2 : vpIso.z > 1.7 ? 1 : 0;

  return (
    <div className="map-wrap">
      <div className="panel" ref={wrapRef} style={{ position: 'relative' }}>
        {hover && (
          <div style={{ position: 'absolute', left: Math.min(hover.x + 14, 460), top: hover.y + 12, zIndex: 5,
            background: 'var(--panel3)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px',
            pointerEvents: 'none', fontSize: 11.5, maxWidth: 240 }}>
            <div style={{ color: 'var(--ink)' }}>{hover.text}</div>
            <div className="faint" style={{ fontSize: 10.5 }}>{hover.sub}</div>
          </div>
        )}
        {digest && <div className="month-digest num">{digest}</div>}
        <div className="lens-row">
          {LENSES.map(l => <button key={l.id} className={lens === l.id ? 'active' : ''} onClick={() => setLens(l.id)}>{l.label}</button>)}
          <span style={{ flex: 1 }} />
          <button className={showBldgs ? '' : 'active'} onClick={() => setShowBldgs(b => !b)} title="Hide the buildings to read the lens and the vacant dirt underneath">{showBldgs ? '◻ hide bldgs' : '◼ show bldgs'}</button>
          <button onClick={cycleAmbient} className={ambient === 0 ? 'active' : ''}
            title="Ambient detail — streetscape, seasons, weather. Off silences all of it.">◦ {AMBIENT_LABELS[ambient]}</button>
          <button className={view === 'iso' ? 'active' : ''} onClick={() => setView('iso')} title="Isometric skyline view">◪ 2.5D</button>
          <button className={view === 'flat' ? 'active' : ''} onClick={() => setView('flat')} title="Flat plan view">▦ Plan</button>
          <button onClick={() => (view === 'iso' ? vpIso : vpFlat).zoomAt(1 / 1.35, undefined, undefined, true)} title="Zoom out">−</button>
          <button onClick={() => (view === 'iso' ? vpIso : vpFlat).zoomAt(1.35, undefined, undefined, true)} title="Zoom in">+</button>
          <button onClick={() => (view === 'iso' ? vpIso : vpFlat).reset()} title="Fit the whole city">⤢ {(view === 'iso' ? vpIso.z : vpFlat.z).toFixed(1)}×</button>
          {advance && <>
            <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 2px' }} />
            <button className="active" style={{ fontWeight: 700 }} title="Advance one month (Space)"
              disabled={state.pending.length > 0 || state.gameOver} onClick={() => advance(1)}>▸ month</button>
            <button title="Run until something needs you" disabled={state.pending.length > 0 || state.gameOver}
              onClick={advanceUntil}>⏭ event</button>
          </>}
        </div>
        {view === 'iso' ? (
        <svg className="map-svg" ref={vpIso.ref} viewBox={vpIso.viewBox} style={vpIso.style} {...vpIso.handlers}>
          <rect x={0} y={0} width={IW_TOT} height={IH_TOT} rx={6} fill={season === 'winter' ? '#aeb4ae' : '#a8b7ab'} />
          <TileBaseIso tiles={tilesGeom} season={season} />
          {lens === 'zoning'
            ? <ZoningIso tiles={state.tiles} rezonings={state.rezonings} zoneStamp={zoneStamp} />
            : lens === 'city' ? null
            : <LensCellsIso tiles={tilesGeom} grids={grids} vals={tileVals} hue={hue} zb={zb} />}
          {(() => {
            const water = state.tiles.filter(t => t.water && !t.park && !t.canal).sort((a, b) => (a.y - b.y) || (a.x - b.x));
            if (!water.length || water.length > 20) return null;
            const seen = new Set<number>();
            const spine = water.filter(t => { if (seen.has(t.y)) return false; seen.add(t.y); return true; });
            const pts = spine.map(t => isoPt(t.x, t.y)).map(p => p[0].toFixed(0) + ',' + p[1].toFixed(0)).join(' ');
            return <g><polyline points={pts} fill="none" stroke="#4e93c4" strokeWidth={IH * 0.95} strokeLinecap="round" strokeLinejoin="round" />
              <polyline className="shim" points={pts} fill="none" stroke="#3c608a" strokeWidth={2} strokeDasharray="2 14" strokeLinecap="round" opacity={0.7} /></g>;
          })()}
          {(() => {
            // the canal: half a river, drawn as a narrow spine over its grassy banks —
            // extended a tile past each end so it visibly drains into both rivers
            const canal = state.tiles.filter(t => t.canal).sort((a, b) => a.y - b.y);
            if (!canal.length) return null;
            const nodes = [
              isoPt(canal[0].x, canal[0].y - 1),
              ...canal.map(t => isoPt(t.x, t.y)),
              isoPt(canal[canal.length - 1].x, canal[canal.length - 1].y + 1),
            ];
            const pts = nodes.map(p => p[0].toFixed(0) + ',' + p[1].toFixed(0)).join(' ');
            return <g><polyline points={pts} fill="none" stroke="#5b9ec9" strokeWidth={IH * 0.45} strokeLinecap="round" strokeLinejoin="round" />
              <polyline className="shim" points={pts} fill="none" stroke="#3c608a" strokeWidth={1.3} strokeDasharray="2 11" strokeLinecap="round" opacity={0.6} /></g>;
          })()}
          {ambient >= 1 && zb >= 2 && <g className="lod-fade"><Sidewalks runs={runs} /></g>}
          <RoadsIso runs={runs} wet={weather === 'rain'} plowed={ambient >= 2 && season === 'winter'} />
          {ambient >= 1 && <Bridges runs={runs} tiles={tilesGeom} />}
          {ambient >= 2 && zb >= 2 && <g className="lod-fade"><StreetNames runs={runs} seed={state.seed} /></g>}
          {ambient >= 1 && zb >= 1 && <WaterLife tiles={tilesGeom} seed={state.seed} />}
          {ambient >= 1 && zb >= 1 && <StreetLife runs={runs} seed={state.seed} detail={zb >= 2} season={season} loD={loD} hiD={hiD} busy={busy} retailish={retailish} />}
          {ambient >= 2 && zb >= 2 && <g className="lod-fade"><PoliceLayer tiles={copTiles} seed={state.seed} /></g>}
          {transitActive && (() => {
            const ef = state.effects.find(e => e.kind === 'transit')!;
            const done = 1 - ef.monthsLeft / 14;
            const n = Math.round(state.transitCorridor.length * Math.max(0, Math.min(1, done)));
            return state.transitCorridor.map((i, k) => {
              const t = state.tiles[i];
              const built = k < n;
              return <polygon key={'tr' + i} points={diamond(t.x, t.y, 0.94)} fill={built ? 'rgba(93,143,232,0.13)' : 'none'}
                stroke="var(--blue)" strokeWidth={built ? 2 : 1.2} strokeDasharray={built ? undefined : '4 5'}
                opacity={built ? 1 : 0.6} style={{ pointerEvents: 'none' }} />;
            });
          })()}
          {ambient >= 1 && <CivicLayer tiles={tilesGeom} grids={grids} seed={state.seed} />}
          {ambient >= 2 && zb >= 2 && lens === 'city' && <g className="lod-fade"><VacantLots tiles={tilesGeom} grids={grids} seed={state.seed} season={season} /></g>}
          {ambient >= 2 && zb >= 2 && <g className="lod-fade"><StreetFurniture runs={runs} seed={state.seed} level={ambient} loD={loD} /></g>}
          {ambient >= 2 && zb >= 2 && showBldgs && <g className="lod-fade"><ParcelLots blds={isoBlds} seed={state.seed} level={ambient} /></g>}
          {showBldgs && <IsoCity blds={isoBlds} detail={zb >= 2} snow={ambient >= 2 && season === 'winter'} winterSun={season === 'winter'} />}
          {/* weather: rain wets the ground and streams past; fog sits on the far view */}
          {weather === 'rain' && (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={0} y={0} width={IW_TOT} height={IH_TOT} rx={6} fill="#5a6470" opacity={0.22} style={{ mixBlendMode: 'multiply' }} />
              {ambient >= 3 && Array.from({ length: 26 }, (_, i) => {
                const rx0 = (i / 26) * IW_TOT + ((state.seed >> (i % 13)) % 37);
                return <line key={'rn' + i} className={noMotion ? undefined : 'rainfall'} x1={rx0} y1={-20} x2={rx0 - IH_TOT * 0.22} y2={IH_TOT + 20}
                  stroke="#c8d2dc" strokeWidth={0.7} strokeDasharray="7 30" opacity={0.16}
                  style={noMotion ? undefined : { animationDelay: ((i * 0.23) % 2.2).toFixed(2) + 's' }} />;
              })}
            </g>
          )}
          {weather === 'fog' && zb === 0 && (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={0} y={0} width={IW_TOT} height={IH_TOT} rx={6} fill="#c3cad2" opacity={0.15} />
              <ellipse cx={IW_TOT * 0.35} cy={IH_TOT * 0.42} rx={IW_TOT * 0.4} ry={IH_TOT * 0.12} fill="#ccd3da" opacity={0.10} />
              <ellipse cx={IW_TOT * 0.68} cy={IH_TOT * 0.6} rx={IW_TOT * 0.36} ry={IH_TOT * 0.1} fill="#ccd3da" opacity={0.09} />
            </g>
          )}
          {/* banners: the map tells you what's happening without a legend */}
          {(() => {
            const out: React.ReactElement[] = [];
            const banner = (key: string, x: number, y: number, text: string, bg: string, fg = '#14180f') => {
              const w = text.length * 4.6 + 10;
              out.push(
                <g key={key} style={{ pointerEvents: 'none' }}>
                  <polygon points={`${x},${y - 9} ${x - 3.5},${y - 14} ${x + 3.5},${y - 14}`} fill={bg} opacity={0.95} />
                  <rect x={x - w / 2} y={y - 25} width={w} height={11.5} rx={2.5} fill={bg} stroke="#0b0f13" strokeWidth={0.7} opacity={0.95} />
                  <text x={x} y={y - 16.6} textAnchor="middle" fontSize={7} fontWeight={700} fontFamily="var(--mono)" fill={fg} letterSpacing={0.4}>{text}</text>
                </g>
              );
            };
            // the quiet cousin: status tags (SOLD, FOR LEASE) at 70% chrome so a hot
            // month doesn't wallpaper the map
            const tag = (key: string, x: number, y: number, text: string, bg: string, fg = '#14180f') => {
              const w = text.length * 3.6 + 7;
              out.push(
                <g key={key} style={{ pointerEvents: 'none' }} opacity={0.88}>
                  <rect x={x - w / 2} y={y - 17} width={w} height={8.5} rx={2} fill={bg} stroke="#0b0f13" strokeWidth={0.5} />
                  <text x={x} y={y - 10.8} textAnchor="middle" fontSize={5.4} fontWeight={700} fontFamily="var(--mono)" fill={fg} letterSpacing={0.3}>{text}</text>
                </g>
              );
            };
            const ctrOf = (tileI: number, cells?: number[], parcel?: { px: number; py: number; pw: number; ph: number }) => {
              const t = state.tiles[tileI];
              if (parcel) { const [cx, cy] = parcelCenter(t.x, t.y, parcel.px, parcel.py, parcel.pw, parcel.ph); return isoPt(cx, cy); }
              if (cells?.length) { const r = cellRects(cells)[0]; const [cx, cy] = parcelCenter(t.x, t.y, r.px, r.py, r.pw, r.ph); return isoPt(cx, cy); }
              return isoPt(t.x, t.y);
            };
            for (const l of state.listings) {
              if (l.parentAssetId || l.fromLandId) continue;
              const p = ctrOf(l.tileI, l.parcelCells, l.parcel);
              if (l.kind === 'land') banner('bl' + l.id, p[0], p[1], (l as any).omLead ? 'OWNER ASKING' : 'LAND FOR SALE', (l as any).omLead ? '#e0c070' : '#8fd08f');
              else if (l.yourSale) banner('bl' + l.id, p[0], p[1] - 8, 'FOR SALE — YOURS', '#f0c464');
              else banner('bl' + l.id, p[0], p[1] - 8, l.kind === 'offmarket' ? 'OFF-MARKET' : 'FOR SALE', l.kind === 'offmarket' ? '#e0c070' : '#8fd08f');
            }
            for (const b of state.stock) {
              if (!b.buildLeft) continue;
              const p = ctrOf(b.tileI, b.cells, b.px !== undefined ? { px: b.px, py: b.py!, pw: b.pw!, ph: b.ph! } : undefined);
              banner('bu' + b.id, p[0], p[1] - 8, 'UNDER CONSTRUCTION', '#e0a35c');
            }
            for (const a of state.assets) {
              if (a.mode !== 'construction') continue;
              const p = ctrOf(a.tileI, a.cells, a.px !== undefined ? { px: a.px, py: a.py!, pw: a.pw!, ph: a.ph! } : undefined);
              banner('ba' + a.id, p[0], p[1] - 8, a.project?.stage === 'building' ? 'UNDER CONSTRUCTION' : (a.project?.stage ?? 'planning').toUpperCase(), '#f0c464');
            }
            if (ambient >= 1) {
              // the market's receipts: a SOLD card sits on last month's trades
              let solds = 0;
              for (const [ci, c] of state.comps.entries()) {
                if (state.month - c.m > 1 || solds >= 10) continue;
                const t2 = state.tiles[c.tileI];
                if (!t2) continue;
                const p = isoPt(t2.x, t2.y);
                tag('sd' + ci, p[0], p[1] + 4, 'SOLD', '#b8b2a4');
                solds++;
              }
              // chronic vacancy hangs its own banner — the building is asking for help
              let leases = 0;
              const leaseTag = (key: string, tileI: number, cells?: number[], parcel?: { px: number; py: number; pw: number; ph: number }) => {
                const p = ctrOf(tileI, cells, parcel);
                tag(key, p[0], p[1] - 2, 'FOR LEASE', '#9db4c9');
              };
              for (const b of state.stock) {
                if (b.buildLeft || b.listedId !== undefined || b.occ >= 0.3 || leases >= 12) continue;
                leaseTag('fl' + b.id, b.tileI, b.cells, b.px !== undefined ? { px: b.px, py: b.py!, pw: b.pw!, ph: b.ph! } : undefined);
                leases++;
              }
              for (const a of state.assets) {
                if (a.mode !== 'operating' || a.forSale || a.occ >= 0.3 || leases >= 14) continue;
                leaseTag('fla' + a.id, a.tileI, a.cells, a.px !== undefined ? { px: a.px, py: a.py!, pw: a.pw!, ph: a.ph! } : undefined);
                leases++;
              }
            }
            return out;
          })()}
          {/* owners who said no — assembly planning has memory */}
          {Object.entries(state.parcelApproach ?? {}).map(([k, rec]) => {
            const [ti, c] = k.split(':').map(Number);
            if (rec.outcome !== 'refused' || state.month - rec.m >= E.parcelApproachFade(state, ti, c)) return null;
            const t = state.tiles[ti];
            if (!t) return null;
            const [cx, cy] = parcelCenter(t.x, t.y, c % E.PGRID, Math.floor(c / E.PGRID));
            const p = isoPt(cx, cy);
            return <text key={'ref' + k} x={p[0]} y={p[1] + 2.5} textAnchor="middle" fontSize={8.5}
              fill="var(--red)" opacity={0.75} style={{ pointerEvents: 'none' }} fontFamily="var(--mono)">✕</text>;
          })}
          {state.migrations.filter(mg => state.month - mg.m <= 3).map((mg, k) => {
            const a = state.tiles[mg.fromTileI], b = state.tiles[mg.toTileI];
            const p1 = isoPt(a.x, a.y), p2 = isoPt(b.x, b.y);
            return (
              <g key={'mg' + k} style={{ pointerEvents: 'none' }}>
                <line className={ambient >= 1 ? 'mig-flow' : undefined} x1={p1[0]} y1={p1[1] - 16} x2={p2[0]} y2={p2[1] - 16} stroke="#e08c8c" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.85} />
                <circle cx={p2[0]} cy={p2[1] - 16} r={3.5} fill="#e08c8c" />
              </g>
            );
          })}
          {/* a fresh listing announces itself for its first month */}
          {ambient >= 1 && state.listings.filter(l => !l.parentAssetId && l.listMonth !== undefined && state.month - l.listMonth < 1).slice(0, 12).map(l => {
            const t = state.tiles[l.tileI];
            return <polygon key={'nl' + l.id} className="tile-pulse" points={diamond(t.x, t.y, 0.96)} fill="none"
              stroke="#8fd08f" strokeWidth={1.6} style={{ pointerEvents: 'none', animationIterationCount: 'infinite', animationDuration: '2.8s' }} />;
          })}
          <HitLayerIso tiles={tilesGeom} onEnter={hitEnter} onLeave={hitLeave} onClick={hitClick} />
          {/* the parcel under the cursor lifts a hair off the ground */}
          {ambient >= 1 && hoverCell && zb >= 1 && (() => {
            const t = state.tiles[hoverCell.tileI];
            if (!t || t.water) return null;
            const [ccx, ccy] = parcelCenter(t.x, t.y, hoverCell.px, hoverCell.py);
            const [w2, h2] = parcelSpan(1, 1);
            return (
              <g style={{ pointerEvents: 'none' }} transform="translate(0 -1.6)">
                <polygon points={rectPoly(ccx, ccy, w2 * 0.96, h2 * 0.96)} fill="rgba(217,166,72,0.10)" stroke="var(--amber-dim)" strokeWidth={1.1} />
              </g>
            );
          })()}
          {sel && <polygon points={diamond(sel.x, sel.y, 0.99)} fill="none" stroke="var(--amber-dim)" strokeWidth={1.4} style={{ pointerEvents: 'none' }} />}
          {selCells && selInfo && (() => {
            const t = state.tiles[selCells.tileI];
            const cellPoly = (c: number, fill: string, stroke: string, sw: number, dash?: string) => {
              const px = c % E.PGRID, py = Math.floor(c / E.PGRID);
              const [cx, cy] = parcelCenter(t.x, t.y, px, py);
              const [w, h] = parcelSpan(1, 1);
              return <polygon key={'sc' + c} points={rectPoly(cx, cy, w, h)} fill={fill} stroke={stroke}
                strokeWidth={sw} strokeDasharray={dash} style={{ pointerEvents: 'none' }} />;
            };
            return (
              <g>
                {/* the site you're forming */}
                {selInfo.main.map(c => cellPoly(c, 'rgba(217,166,72,0.24)', 'var(--amber)', 1.8))}
                {/* stragglers that only touch at a corner — not part of the site */}
                {selInfo.stray.map(c => cellPoly(c, 'rgba(222,95,95,0.16)', 'var(--red)', 1.5, '4 3'))}
                {/* vacant lots that would extend the site */}
                {selInfo.cand.map(c => cellPoly(c, 'none', 'var(--amber-dim)', 0.8, '2 3'))}
                {/* ghost of what this site could hold */}
                {effGhost && (() => {
                  const bonus = E.upzoneBonus(selInfo.main.length);
                  const sfMax = Math.min(
                    Math.floor(selInfo.main.length * E.PARCEL_AC * 43_560 * E.FAR[effGhost] * E.zoneTierMult(t.zone.tier) * bonus),
                    E.CONFIG.tiers[state.tier].maxSF);
                  if (sfMax < E.MIN_BUILD_SF) return null;
                  const ht = massing(effGhost, defaultConstr(effGhost, sfMax), sfMax, selInfo.main.length, fabricOf(t.zone, effGhost)).ht;
                  return cellRects(selInfo.main).map((r, i) => {
                    const [cx, cy] = parcelCenter(t.x, t.y, r.px, r.py, r.pw, r.ph);
                    const [w, h] = parcelSpan(r.pw, r.ph);
                    const f = prismFaces(cx, cy, w * 0.88, h * 0.88, ht);
                    return (
                      <g key={'ghost' + i} style={{ pointerEvents: 'none' }}>
                        <polygon points={f.l} fill="rgba(217,166,72,0.07)" stroke="var(--amber)" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.75} />
                        <polygon points={f.r} fill="rgba(217,166,72,0.12)" stroke="var(--amber)" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.75} />
                        <polygon points={f.t} fill="rgba(217,166,72,0.20)" stroke="var(--amber)" strokeWidth={1} strokeDasharray="4 3" opacity={0.9} />
                      </g>
                    );
                  });
                })()}
              </g>
            );
          })()}
          {pulseTiles.map(i => {
            const t = state.tiles[i];
            return <polygon key={'pu' + i} className="tile-pulse" points={diamond(t.x, t.y, 0.98)} fill="none"
              stroke="var(--amber)" strokeWidth={2} style={{ pointerEvents: 'none' }} />;
          })}
          {/* the dev memo's live ghost: what this program would stand like, right here */}
          {devGhost && (() => {
            const t = state.tiles[devGhost.tileI];
            if (!t) return null;
            const cells = devGhost.cells?.length ? devGhost.cells
              : devGhost.parcel ? (() => { const out: number[] = []; for (let dy = 0; dy < devGhost.parcel!.ph; dy++) for (let dx = 0; dx < devGhost.parcel!.pw; dx++) out.push((devGhost.parcel!.py + dy) * E.PGRID + devGhost.parcel!.px + dx); return out; })()
              : [5, 6, 9, 10];
            const ht = massing(devGhost.type, devGhost.construction, devGhost.sf, cells.length, fabricOf(t.zone, devGhost.type)).ht;
            return cellRects(cells).map((r2, i2) => {
              const [ccx, ccy] = parcelCenter(t.x, t.y, r2.px, r2.py, r2.pw, r2.ph);
              const [w2, h2] = parcelSpan(r2.pw, r2.ph);
              const f2 = prismFaces(ccx, ccy, w2 * 0.88, h2 * 0.88, ht);
              return (
                <g key={'dg' + i2} style={{ pointerEvents: 'none' }}>
                  <polygon points={f2.l} fill="rgba(93,143,232,0.08)" stroke="var(--blue)" strokeWidth={0.9} strokeDasharray="4 3" opacity={0.8} />
                  <polygon points={f2.r} fill="rgba(93,143,232,0.13)" stroke="var(--blue)" strokeWidth={0.9} strokeDasharray="4 3" opacity={0.8} />
                  <polygon points={f2.t} fill="rgba(93,143,232,0.22)" stroke="var(--blue)" strokeWidth={1.1} strokeDasharray="4 3" opacity={0.9} />
                </g>
              );
            });
          })()}
          {/* delivery: a gold double-ring settles on the finished building */}
          {ambient >= 1 && delivered.map((d2, k) => {
            const t = state.tiles[d2.tileI];
            if (!t) return null;
            const cells = E.footprintCells(d2 as any);
            const r0 = cells.length ? cellRects(cells)[0] : { px: 1, py: 1, pw: 2, ph: 2 };
            const [ccx, ccy] = parcelCenter(t.x, t.y, r0.px, r0.py, r0.pw, r0.ph);
            const [w2, h2] = parcelSpan(r0.pw, r0.ph);
            return (
              <g key={'dv' + k} style={{ pointerEvents: 'none' }}>
                <polygon className="tile-pulse" points={rectPoly(ccx, ccy, w2 * 1.06, h2 * 1.06)} fill="none" stroke="#f0c464" strokeWidth={2.4}
                  style={{ animationIterationCount: 3, animationDuration: '1.05s' }} />
                <polygon className="tile-pulse" points={rectPoly(ccx, ccy, w2 * 0.8, h2 * 0.8)} fill="none" stroke="#f0c464" strokeWidth={1.2}
                  style={{ animationIterationCount: 3, animationDuration: '1.05s', animationDelay: '0.25s' }} />
              </g>
            );
          })}
          {Array.from({ length: E.CONFIG.GRID_W }, (_, i) => {
            const p = isoPt(i, -0.75);
            return <text key={'cx' + i} x={p[0]} y={p[1]} textAnchor="middle" fill="var(--dim)" fontSize={10} fontFamily="var(--mono)">{String.fromCharCode(65 + i)}</text>;
          })}
          {Array.from({ length: E.CONFIG.GRID_H }, (_, i) => {
            const p = isoPt(-0.8, i);
            return <text key={'cy' + i} x={p[0]} y={p[1] + 4} textAnchor="middle" fill="var(--dim)" fontSize={10} fontFamily="var(--mono)">{i + 1}</text>;
          })}
        </svg>
        ) : (
        <svg className="map-svg" ref={vpFlat.ref} viewBox={vpFlat.viewBox} style={vpFlat.style} {...vpFlat.handlers}>
          <rect x={-20} y={-18} width={W + 24} height={H + 22} rx={6} fill="#a8b7ab" />
          {Array.from({ length: E.CONFIG.GRID_W }, (_, i) => (
            <text key={'cx' + i} x={(i + 0.5) * TS} y={-6} textAnchor="middle" fill="var(--dim)" fontSize={10} fontFamily="var(--mono)">{String.fromCharCode(65 + i)}</text>
          ))}
          {Array.from({ length: E.CONFIG.GRID_H }, (_, i) => (
            <text key={'cy' + i} x={-10} y={(i + 0.5) * TS + 3.5} textAnchor="middle" fill="var(--dim)" fontSize={10} fontFamily="var(--mono)">{i + 1}</text>
          ))}
          {/* grass under everything, then the value field — or the zoning map, which is paper */}
          <FlatGround tiles={tilesGeom} season={season} />
          {lens === 'zoning'
            ? <ZoningFlat tiles={state.tiles} rezonings={state.rezonings} zoneStamp={zoneStamp} />
            : lens === 'city' ? null
            : <FieldFlat field={field} hue={hue} />}
          {/* faint block seams so the field reads as a city, not gradient soup */}
          {Array.from({ length: E.CONFIG.GRID_W + 1 }, (_, i) => (
            <line key={'gv' + i} x1={i * TS} y1={0} x2={i * TS} y2={H} stroke="#8f958a" strokeWidth={0.8} opacity={0.5} />
          ))}
          {Array.from({ length: E.CONFIG.GRID_H + 1 }, (_, i) => (
            <line key={'gh' + i} x1={0} y1={i * TS} x2={W} y2={i * TS} stroke="#8f958a" strokeWidth={0.8} opacity={0.5} />
          ))}
          {/* river */}
          {river && <path d={river} fill="none" stroke="#4e93c4" strokeWidth={TS * 0.86} strokeLinecap="round" strokeLinejoin="round" />}
          {river && <path d={river} fill="none" stroke="#2d4f6e" strokeWidth={1.6} strokeDasharray="1 8" strokeLinecap="round" opacity={0.85} />}
          {state.tiles.filter(t => t.park).map(t => (
            <rect key={'pk' + t.i} x={t.x * TS} y={t.y * TS} width={TS} height={TS} fill="#79a865" />
          ))}
          {state.tiles.filter(t => t.water && !t.park && !t.canal).length > 20 && state.tiles.filter(t => t.water && !t.park && !t.canal).map(t => (
            <rect key={'wa' + t.i} x={t.x * TS} y={t.y * TS} width={TS} height={TS} fill={t.marsh ? '#7d8d6b' : '#5b9ec9'} />
          ))}
          {(() => {
            const canal = state.tiles.filter(t => t.canal).sort((a, b) => a.y - b.y);
            if (!canal.length) return null;
            const xs = [[canal[0].x, canal[0].y - 1], ...canal.map(t => [t.x, t.y]), [canal[canal.length - 1].x, canal[canal.length - 1].y + 1]];
            const d = xs.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${(x + 0.5) * TS} ${(y + 0.5) * TS}`).join(' ');
            return <path d={d} fill="none" stroke="#5b9ec9" strokeWidth={TS * 0.4} strokeLinecap="round" strokeLinejoin="round" />;
          })()}
          {/* the street network — every city's is its own */}
          <RoadsFlat runs={runs} />
          {transitActive && state.transitCorridor.map(i => {
            const t = state.tiles[i];
            return <rect key={'t' + i} x={t.x * TS + 1.5} y={t.y * TS + 1.5} width={TS - 3} height={TS - 3} rx={4}
              fill="none" stroke="var(--blue)" strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }} />;
          })}
          {/* buildings — same parcel-true geometry as the iso view */}
          {showBldgs && <FlatBuildings blds={isoBlds} />}
          {state.listings.filter(l => l.kind === 'land' && !l.parentAssetId).map(l => {
            const t = state.tiles[l.tileI];
            return <circle key={'l' + l.id} cx={(t.x + 0.78) * TS} cy={(t.y + 0.22) * TS} r={4.5}
              fill="var(--green)" stroke="#0b0f13" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />;
          })}
          {/* hit targets + selection */}
          {state.tiles.map(t => t.water ? null : (
            <rect key={'h' + t.i} x={t.x * TS} y={t.y * TS} width={TS} height={TS} fill="transparent"
              style={{ cursor: 'pointer' }} onClick={() => { if (!vpFlat.moved.current) setSelTile(t.i); }} />
          ))}
          {sel && (
            <rect x={sel.x * TS + 1} y={sel.y * TS + 1} width={TS - 2} height={TS - 2} rx={5}
              fill="none" stroke="var(--amber)" strokeWidth={2.2} style={{ pointerEvents: 'none' }} />
          )}
          {/* the same weather the iso view gets — the plan sheet is outdoors too */}
          {weather === 'rain' && (
            <rect x={-20} y={-18} width={W + 24} height={H + 22} rx={6} fill="#5a6470" opacity={0.20}
              style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }} />
          )}
          {weather === 'fog' && vpFlat.z < 1.7 && (
            <rect x={-20} y={-18} width={W + 24} height={H + 22} rx={6} fill="#c3cad2" opacity={0.14} style={{ pointerEvents: 'none' }} />
          )}
        </svg>
        )}
        <div className="faint" style={{ fontSize: 11, marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {lens === 'zoning' && (['R', 'C', 'MU', 'M'] as E.ZoneUse[]).map(u => (
            <span key={u}><span style={{ color: ZONE_COL[u] }}>▪</span> {u} {E.ZONE_LABEL[u].toLowerCase()}</span>
          ))}
          {lens === 'zoning' && <span style={{ color: '#e8e0c8' }}>▨ before the council</span>}
          <span><span style={{ color: '#f0c464' }}>▪</span> yours</span>
          <span><span style={{ color: '#a05468' }}>▪</span> rival land banks</span>
          <span>walls follow the build — glass, brick, precast, EIFS</span>
          {weather !== 'clear' && view === 'iso' && <span className="faint">{weather === 'rain' ? '∕∕ rain this month' : '≋ fog in the valley'}</span>}
          <span style={{ color: 'var(--green)' }}>▪ on the market</span>
          {transitActive && <span style={{ color: 'var(--blue)' }}>▦ new transit corridor</span>}
          {view === 'iso' && <span>massing is honest: towers stand tall, sheds sprawl</span>}
          <span style={{ color: '#c98a2e' }}>▨ under construction</span>
          <span className="faint">scroll to zoom · drag to pan · 1-9 lenses · V view · Space advances</span>
        </div>
      </div>
      <div className="panel">
        {!sel ? (
          <div className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <h3>Block detail</h3>
            Click any block. Every building in this city is real and standing — most just aren't for sale.
            The lenses (1-9) are your market read: land pricing, rents by asset class, zoning,
            crime, comps. Value pools around the cores and the canal — and rents follow it.
          </div>
        ) : (
          <div>
            <h3>Block {blockName(sel)}</h3>
            <div className="metric-row" style={{ marginTop: 2 }}>
              <div className="metric"><div className="eyebrow">Zoned <Hint text={`${E.ZONE_LABEL[sel.zone.use]} at ${E.zoneTierMult(sel.zone.tier)}× density. Permits: ${E.ZONE_ALLOWS[sel.zone.use].map(ty => E.PLABEL[ty].toLowerCase()).join(', ')}. Standing stock that violates the zone is grandfathered — the paper only governs what gets built next.`} /></div>
                <div className="v num" style={{ color: ZONE_COL[sel.zone.use] }}>{E.zoneCode(sel.zone)}</div></div>
              <div className="metric"><div className="eyebrow">Desirability</div><div className="v num">{sel.D.toFixed(0)}<span className="faint">/100</span></div></div>
              <div className="metric"><div className="eyebrow">Income idx</div><div className="v num">{sel.income.toFixed(2)}×</div></div>
              <div className="metric"><div className="eyebrow">Employment</div><div className="v num">{sel.emp.toFixed(0)}</div></div>
              <div className="metric"><div className="eyebrow">Residents</div><div className="v num">{sel.pop.toFixed(0)}</div></div>
              <div className="metric"><div className="eyebrow">Crime</div><div className={'v num ' + (sel.crime > 55 ? 'neg' : '')}>{sel.crime.toFixed(0)}</div></div>
              <div className="metric"><div className="eyebrow">Live·Work·Shop <Hint text="How much the blend of homes, jobs and shops within walking distance is adding to this block's desirability right now. Balance compounds; monoculture scores nothing. Quality of the product weighs in." /></div>
                <div className={'v num ' + (mixAll[sel.i] > 14 ? 'pos' : '')}>{Math.round(Math.min(100, mixAll[sel.i] / 34 * 100))}<span className="faint">/100</span>
                  <span className="faint" style={{ fontSize: 9.5 }}> +{mixAll[sel.i].toFixed(0)}D</span></div></div>
            </div>
            {(() => {
              // What's actually standing within a short walk — the raw facts a surveyor
              // would note. Whether the blend is an opportunity is your call, not ours.
              const near = { office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 } as Record<E.PType, number>;
              let qSum = 0, qSF = 0;
              const count = (ty: E.PType, sf: number, q: number, w: number) => {
                near[ty] += sf * w; qSum += q * sf * w; qSF += sf * w;
              };
              for (const b of state.stock) {
                if (b.buildLeft) continue;
                const bt = state.tiles[b.tileI];
                const ring = Math.max(Math.abs(bt.x - sel.x), Math.abs(bt.y - sel.y));
                if (ring <= 1) count(b.type, b.sf, b.quality, ring === 0 ? 1 : 0.5);
              }
              for (const a of state.assets) {
                if (a.mode === 'construction') continue;
                const at = state.tiles[a.tileI];
                const ring = Math.max(Math.abs(at.x - sel.x), Math.abs(at.y - sel.y));
                if (ring <= 1) count(a.type, a.sf, a.quality, ring === 0 ? 1 : 0.5);
              }
              const tot = E.PTYPES.reduce((s2, ty) => s2 + near[ty], 0);
              if (tot < 1000) return <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>Nothing built within a block of here. Blank slates set their own tone.</div>;
              const grade = qSF > 0 ? E.QLABEL[E.qGrade(qSum / qSF)] : '—';
              return (
                <div style={{ marginTop: 8 }}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Within a block's walk · avg {grade}-grade</div>
                  <div style={{ display: 'flex', height: 8, borderRadius: 3, overflow: 'hidden', background: 'var(--panel3)' }}>
                    {E.PTYPES.map(ty => near[ty] > 0 && (
                      <div key={ty} title={`${E.PLABEL[ty]} ${(near[ty] / 1000).toFixed(0)}K SF`}
                        style={{ width: `${(near[ty] / tot) * 100}%`, background: ty === 'office' ? 'var(--blue)' : ty === 'retail' ? 'var(--amber)' : ty === 'industrial' ? 'var(--green)' : ty === 'mixed' ? '#b07fd9' : '#e88bb8' }} />
                    ))}
                  </div>
                  <div className="faint" style={{ fontSize: 10.5, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {E.PTYPES.map(ty => near[ty] >= 1000 ? <span key={ty}>{E.PLABEL[ty]} {(near[ty] / 1000).toFixed(0)}K</span> : null)}
                  </div>
                </div>
              );
            })()}
            <table className="sc" style={{ marginTop: 10 }}>
              <thead><tr><th>Use</th><th>Mkt rent</th><th>Cap</th><th>Balance</th></tr></thead>
              <tbody>
                {E.PTYPES.map(ty => {
                  const over = E.oversupplyPenalty(sel, ty);
                  const df = E.tileDemandFactor(state, sel, ty);
                  return (
                    <tr key={ty}>
                      <td>{E.PLABEL[ty]}</td>
                      <td className="num">${E.marketRentPSF(state, sel, ty).toFixed(2)}</td>
                      <td className="num">{E.capRatePct(state, sel, ty, 90).toFixed(1)}%</td>
                      <td className={over > 0.02 ? 'neg' : df > 1.05 ? 'pos' : 'dim'}>
                        {over > 0.02 ? 'Oversupplied' : df > 1.05 ? 'Undersupplied' : 'Balanced'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selCells && selCells.tileI === sel.i && selInfo && (
              <ParcelBuyPanel state={state} setState={setState} tileI={sel.i} cells={selCells.cells}
                close={() => setSelCells(null)}
                ghostType={effGhost} setGhostType={setGhostType}
                mainLen={selInfo.main.length} strayLen={selInfo.stray.length} />
            )}
            {state.land.filter(h => h.tileI === sel.i).map(h => (
              <div key={h.id} className="memo" style={{ borderLeftColor: 'var(--amber)', marginTop: 10 }}>
                <div className="memo-row">
                  <span className="lbl"><b style={{ color: 'var(--ink)' }}>Your land</b> — {Math.round(h.cells.length * E.PARCEL_AC * 100) / 100} acres held since {E.monthName(h.acquiredM)}</span>
                  <span className="num">{E.fmtMoney(E.landValue(state, h))} <span className={'faint ' + (E.landValue(state, h) >= h.basis ? 'pos' : 'neg')}>vs {E.fmtMoney(h.basis)} basis</span></span>
                </div>
                <OwnLandDev state={state} setState={setState} holding={h} openDeal={openDeal} />
              </div>
            ))}
            {state.firmLand.filter(e => e.tileI === sel.i).map((e, i) => {
              const f = state.firms.find(x => x.short === e.short);
              return (
                <div key={'fl' + i} className="memo" style={{ borderLeftColor: '#a05468', marginTop: 10 }}>
                  <div className="memo-row">
                    <span className="lbl"><b style={{ color: 'var(--ink)' }}>{f?.name ?? e.short}</b> holds {Math.round(e.cells.length * E.PARCEL_AC * 100) / 100} acres here — buying since {E.monthName(e.m)}</span>
                  </div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                    {e.cells.length >= 2 ? 'An assembly in progress. Take a connecting lot and their math changes.' : 'One parcel so far. Could be a land bank; could be the first piece of something.'}
                  </div>
                </div>
              );
            })}
            {(() => {
              const app = state.rezonings.find(r => r.tileI === sel.i);
              if (app) {
                return (
                  <div className="memo" style={{ borderLeftColor: '#e8e0c8', marginTop: 10 }}>
                    <div className="memo-row">
                      <span className="lbl"><b style={{ color: 'var(--ink)' }}>Before the council</b> — rezone to {app.toUse}-{app.toTier}</span>
                      <span className="num">hearing ~{E.monthName(app.decideM)}</span>
                    </div>
                    <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{E.rezoneOdds(state, sel.i, app.toUse, app.toTier).read} The room can change between now and the vote.</div>
                  </div>
                );
              }
              if (!E.playerStandingOn(state, sel.i)) return null;
              const gate = E.canApplyRezone(state, sel.i);
              const cost = E.rezoneCost(state, sel.i, rzUse, rzTier);
              const noop = sel.zone.use === rzUse && sel.zone.tier === rzTier;
              return (
                <div className="memo" style={{ borderLeftColor: '#e8e0c8', marginTop: 10 }}>
                  <div className="memo-row"><span className="lbl"><b style={{ color: 'var(--ink)' }}>Rezoning</b> — you have standing on this block</span></div>
                  {!gate.ok ? (
                    <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{gate.why}</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                        <select value={rzUse} onChange={e => setRzUse(e.target.value as E.ZoneUse)}
                          style={{ background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '5px 8px', borderRadius: 4, fontSize: 12 }}>
                          {(['R', 'C', 'MU', 'M'] as E.ZoneUse[]).map(u => <option key={u} value={u}>{u} — {E.ZONE_LABEL[u]}</option>)}
                        </select>
                        <select value={rzTier} onChange={e => setRzTier(Number(e.target.value) as 1 | 2 | 3)}
                          style={{ background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '5px 8px', borderRadius: 4, fontSize: 12 }}>
                          {[1, 2, 3].map(ti => <option key={ti} value={ti}>Tier {ti} — {E.zoneTierMult(ti as 1 | 2 | 3)}× density</option>)}
                        </select>
                        <button className="btn btn-sm btn-amber" disabled={noop}
                          onClick={() => {
                            const r = E.applyRezoning(state, sel.i, rzUse, rzTier);
                            if (r.err) setRzErr(r.err); else { setState(r.s); setRzErr(null); }
                          }}>File — {E.fmtMoney(cost)}</button>
                      </div>
                      <div className="faint" style={{ fontSize: 11, marginTop: 5 }}>
                        {noop ? 'That’s what the block is already zoned.' : E.rezoneOdds(state, sel.i, rzUse, rzTier).read + ' Filing fees stay spent either way; the hearing lands in 5–9 months.'}
                      </div>
                      {rzErr && <div className="alert-strip red" style={{ marginTop: 6 }}>{rzErr}</div>}
                    </>
                  )}
                </div>
              );
            })()}
            <h3 style={{ marginTop: 12 }}>Standing inventory</h3>
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {assetsOn(sel.i).map(a => (
                <button key={'a' + a.id} className="inv-row inv-btn" style={{ borderLeft: '2px solid var(--amber)' }}
                  onClick={() => openAsset(a.id)}>
                  <span style={{ color: 'var(--amber)' }}>◆</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{a.name} — {(a.sf / 1000).toFixed(0)}K SF {E.PLABEL[a.type]}
                    {a.mode === 'construction' ? <span style={{ color: '#e08c3c' }}> · building, {a.project?.monthsLeft ?? 0} mo</span> : ''}</span>
                  <span className="num dim">{pct(a.occ)}</span>
                </button>
              ))}
              {stockOn(sel.i).map(b => (
                <button key={b.id} className="inv-row inv-btn" onClick={() => openStock(b.id)}>
                  <span className="dim">{b.type === 'office' ? '▮' : b.type === 'retail' ? '▬' : b.type === 'industrial' ? '▭' : b.type === 'multifamily' ? '▤' : '▦'}</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    {E.stockName(state, b)} · {(b.sf / 1000).toFixed(0)}K SF {E.PLABEL[b.type]} · {E.QLABEL[E.qGrade(b.quality)]}
                    {b.buildLeft ? <span style={{ color: '#e08c3c' }}> · building, {b.buildLeft} mo</span>
                      : b.listedId ? <span style={{ color: 'var(--green)' }}> · for sale</span>
                        : b.owner !== 'private' ? <span style={{ color: '#7d95bd' }}> · {b.owner}</span> : ''}
                  </span>
                  <span className="num dim">{pct(b.occ)}</span>
                </button>
              ))}
              {stockOn(sel.i).length === 0 && assetsOn(sel.i).length === 0 && (
                <div className="faint" style={{ fontSize: 12 }}>Nothing built here yet — raw dirt and potential.</div>
              )}
            </div>
            {listingsOn(sel.i).filter(l => l.kind === 'land' && !l.parentAssetId).map(l => (
              <button key={l.id} className="btn btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 8 }} onClick={() => openDeal(l.id)}>
                {(l as any).omLead ? 'Their ask' : 'Listed'} · {l.acres} acres — {E.fmtMoney(l.price)}{(l as any).omLead ? ' (off-market)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function ParcelBuyPanel({ state, setState, tileI, cells, close, ghostType, setGhostType, mainLen, strayLen }: {
  state: GameState; setState: (s: GameState) => void; tileI: number; cells: number[];
  close: () => void;
  ghostType: E.PType | null; setGhostType: (t: E.PType | null) => void;
  mainLen: number; strayLen: number;
}) {
  const [err, setErr] = useState<string | null>(null);
  const t = state.tiles[tileI];
  const acres = Math.round(cells.length * E.PARCEL_AC * 100) / 100;
  const bonus = E.upzoneBonus(mainLen);
  const siteAcres = mainLen * E.PARCEL_AC;
  // same math as the ghost prism: zoning tier caps density, and forbidden uses show 0
  const sfFor = (ty: E.PType) => !E.zoneAllows(t.zone, ty) ? 0
    : Math.min(Math.floor(siteAcres * 43_560 * E.FAR[ty] * E.zoneTierMult(t.zone.tier) * bonus), E.CONFIG.tiers[state.tier].maxSF);
  const nextThreshold = mainLen >= 16 ? null : mainLen >= 12 ? { at: 16, pct: 35 } : mainLen >= 8 ? { at: 12, pct: 22 } : { at: 8, pct: 12 };
  return (
    <div className="memo" style={{ borderLeftColor: 'var(--amber)', marginTop: 10 }}>
      <div className="memo-row">
        <span className="lbl"><b style={{ color: 'var(--ink)' }}>{cells.length} unlisted parcel{cells.length > 1 ? 's' : ''}</b> selected on block {blockName(t)}</span>
        <span className="num dim">{acres} acres</span>
      </div>
      <div className="dim" style={{ fontSize: 11.5, margin: '4px 0 8px', lineHeight: 1.5 }}>
        Nobody's marketing these. There is no price until you call the owners — some will name a number,
        some won't sell at any price. Esc clears. Dotted lots adjoin your site.
      </div>
      {(() => {
        const recs = cells.map(cc => E.parcelApproachState(state, tileI, cc));
        const refused = recs.filter(r => r?.outcome === 'refused').length;
        const unknown = recs.filter(r => !r).length;
        return (
          <>
            <div className="memo-row"><span className="lbl">Owners</span>
              <span className="num">{unknown > 0 && <span>{unknown} unknown</span>}{refused > 0 && <span className="neg"> · {refused} refused</span>}</span></div>
            {unknown > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 8px' }}>
                <button className="btn btn-sm btn-amber" disabled={state.approachesLeft <= 0}
                  onClick={() => {
                    let st = state, asks = 0, refs = 0;
                    for (const c of cells) {
                      if (E.parcelApproachState(st, tileI, c)) continue;
                      if (st.approachesLeft <= 0) break;
                      const r = E.approachParcelOwner(st, tileI, c);
                      st = r.s;   // the call happened even when nobody answered
                      if (r.err) { setErr(r.err); break; }
                      if (r.refused) refs++; else asks++;
                    }
                    setState(st);
                    setErr(asks + refs > 0 ? `${asks} owner${asks === 1 ? '' : 's'} will talk · ${refs} refused outright.` : null);
                  }}>
                  Approach owner{unknown > 1 ? 's' : ''} — {Math.min(unknown, state.approachesLeft)} of {state.approachesLeft} calls
                </button>
                <span className="faint" style={{ fontSize: 10.5 }}>Willing owners drop an amber pin — click it to negotiate or close.</span>
              </div>
            )}
          </>
        );
      })()}
      <div className="memo-row">
        <span className="lbl">Assembly upzoning <Hint text="Bigger contiguous sites earn density: 8 lots +12% FAR, 12 lots +22%, the full block +35%." /></span>
        <span className="num">{bonus > 1 ? <b className="pos">+{Math.round((bonus - 1) * 100)}% FAR</b> : '—'}
          {nextThreshold && <span className="faint"> · {nextThreshold.at - mainLen} more lot{nextThreshold.at - mainLen > 1 ? 's' : ''} → +{nextThreshold.pct}%</span>}</span>
      </div>
      {strayLen > 0 && (
        <div className="memo-row"><span className="lbl">Buildable as one site</span>
          <span className="num neg">{strayLen} lot{strayLen > 1 ? 's' : ''} corner-only — bridge or drop {strayLen > 1 ? 'them' : 'it'}</span></div>
      )}
      <div style={{ margin: '8px 0 2px' }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>Build preview — what this site could hold</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {E.PTYPES.map(ty => {
            const sf = sfFor(ty);
            const f = E.tileDemandFactor(state, t, ty);
            const locked = ty === 'mixed' && state.tier < 1;
            const active = ghostType === ty;
            return (
              <button key={ty} className={'btn btn-sm' + (active ? ' btn-amber' : '')} disabled={locked || sf < E.MIN_BUILD_SF}
                title={locked ? 'Mixed-use unlocks at Tier 2' : !E.zoneAllows(t.zone, ty) ? `Not permitted in ${E.zoneCode(t.zone)} — rezone first` : sf < E.MIN_BUILD_SF ? 'Zoned density won\'t carry a building this small a site — assemble more lots or upzone' : `Demand ${f > 1.1 ? 'strong' : f > 0.85 ? 'fair' : 'weak'} here`}
                style={{ fontSize: 10.5, padding: '3px 8px' }}
                onClick={() => setGhostType(active ? null : ty)}>
                {E.PLABEL[ty]} <span className={'num ' + (f > 1.1 ? 'pos' : f > 0.85 ? 'dim' : 'neg')}>{(sf / 1000).toFixed(0)}K</span>
              </button>
            );
          })}
        </div>
        <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>The dashed massing is what these lots could hold — if you can get them.</div>
      </div>

      {err && <div className="alert-strip" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-sm" onClick={close}>Clear</button>
      </div>
    </div>
  );
}

export function StockCard({ state, setState, stockId, close, openDeal, variant = 'dialog' }: {
  state: GameState; setState: (s: GameState) => void; stockId: number; close: () => void;
  openDeal: (id: number) => void; variant?: 'dialog' | 'drawer';
}) {
  const [err, setErr] = useState<string | null>(null);
  const b = state.stock.find(x => x.id === stockId);
  if (!b) return null;
  const t = state.tiles[b.tileI];
  const spec = E.constrSpec(b);
  const chk = E.canApproach(state, b.id);
  const ownerLabel = b.owner === 'private' ? 'Private owner' : (state.firms.find(f => f.short === b.owner)?.name ?? b.owner);
  return (
    <Modal close={close} variant={variant}>
      <h2>{E.stockName(state, b)}</h2>
      <div className="sub">{E.PLABEL[b.type]} · Block {blockName(t)} · {spec.label} · built {Math.max(1950, Math.round(2026 - b.age))} · {ownerLabel}{b.blacklist ? ' (not speaking to you)' : ''}</div>
      <Portrait b={{ type: b.type, construction: b.construction, sf: b.sf, units: b.units, quality: b.quality,
        age: b.age, occ: b.occ, month: state.month, seed: mapSeed(state.seed, b.tileI), siteCells: E.footprintCells(b).length || 1,
        progress: b.buildLeft ? 1 - b.buildLeft / Math.max(1, b.buildTotal ?? 1) : undefined }} w={380} h={185} />
      <div className="metric-row" style={{ marginTop: 10 }}>
        <div className="metric"><div className="eyebrow">Size</div><div className="v num">{(b.sf / 1000).toFixed(0)}K SF</div></div>
        <div className="metric"><div className="eyebrow">{b.type === 'multifamily' ? 'Apartments' : 'Units'}</div><div className="v num">{b.units}</div></div>
        <div className="metric"><div className="eyebrow">Occupancy</div><div className="v num">{pct(b.occ)}</div></div>
        <div className="metric"><div className="eyebrow">Grade</div><div className="v num">{E.QLABEL[E.qGrade(b.quality)]}</div></div>
        <div className="metric"><div className="eyebrow">Site</div><div className="v num">{Math.round(E.footprintCells(b).length * E.PARCEL_AC * 100) / 100} ac</div></div>
      </div>
      <div className="dim" style={{ fontSize: 12, margin: '10px 0 12px', lineHeight: 1.55 }}>
        Rent roll and financials are private — you can see the lights on, not the leases.
        {b.listedId ? ' This one is on the market, though: the flyer has numbers.' : ' Cold-call the owner to find out if there\u2019s a deal inside.'}
        <Hint text="Occupancy, size, age, and grade are observable from the street and public records. What each tenant pays is not." />
      </div>
      {err && <div className="alert-strip red" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {!b.listedId && !b.blacklist && b.owner === 'private' && (
          <span className="faint" style={{ fontSize: 11, marginRight: 'auto' }}>{state.approachesLeft} of 3 cold calls left this month</span>
        )}
        <button className="btn" onClick={close}>Close</button>
        {b.listedId ? (
          <button className="btn btn-amber" onClick={() => { close(); openDeal(b.listedId!); }}>View listing ▸</button>
        ) : (
          <button className="btn btn-amber" disabled={!chk.ok} title={chk.ok ? undefined : chk.why}
            onClick={() => {
              const r = E.approachOwner(state, b.id);
              setState(r.s);
              if (r.lead) { close(); openDeal(r.lead.id); }
              else setErr(r.err ?? 'No luck.');
            }}>
            Cold-call the owner (free)
          </button>
        )}
      </div>
      {!chk.ok && !err && <div className="faint" style={{ fontSize: 11, marginTop: 8, textAlign: 'right' }}>{chk.why}</div>}
    </Modal>
  );
}

export function FirmPortfolioModal({ state, short, close, openStock }: {
  state: GameState; short: string; close: () => void; openStock: (id: number) => void;
}) {
  const f = state.firms.find(x => x.short === short);
  if (!f) return null;
  const held = state.stock.filter(b => b.owner === short);
  const est = (b: StockBuilding) => E.stockValue(state, b);
  const total = E.firmPortfolioValue(state, short);
  const landBank = E.firmLandBankValue(state, short);
  const landEntries = state.firmLand.filter(e => e.short === short);
  const nw = E.firmNetWorth(state, f);
  const lev = total + landBank > 0 ? f.debt / (total + landBank) : 0;
  const styleTxt = f.style === 'core' ? 'buys stabilized assets in prime blocks and holds forever'
    : f.style === 'aggressive' ? 'develops speculatively with maximum leverage — brilliant until the cycle turns'
    : f.style === 'industrial' ? 'buys and builds along the rail corridor exclusively'
    : f.style === 'value-add' ? 'hunts distressed and tired buildings, fixes them, flips them'
    : 'accumulates apartments and never sells';
  return (
    <Modal close={close} wide>
      <h2>{f.name} {!f.alive && <span className="chip chip-distress">Collapsed</span>}</h2>
      <div className="sub">{styleTxt}</div>
      <div className="metric-row" style={{ marginTop: 6 }}>
        <div className="metric"><div className="eyebrow">Net worth</div><div className={'v num ' + (nw < 0 ? 'neg' : '')}>{E.fmtMoney(nw)}</div></div>
        <div className="metric"><div className="eyebrow">Cash</div><div className={'v num ' + (f.cash < 0 ? 'neg' : '')}>{E.fmtMoney(Math.round(f.cash))}</div></div>
        <div className="metric"><div className="eyebrow">Debt</div><div className="v num">{E.fmtMoney(Math.round(f.debt))}</div></div>
        <div className="metric"><div className="eyebrow">Portfolio</div><div className="v num">{E.fmtMoney(Math.round(total))}</div></div>
        <div className="metric"><div className="eyebrow">Land bank</div><div className="v num">{E.fmtMoney(Math.round(landBank))}</div></div>
        <div className="metric"><div className="eyebrow">Leverage <Hint text="Debt against everything they hold. Past ~75% they're one bad quarter from deleveraging — watch for their buildings hitting the market priced to move." /></div>
          <div className={'v num ' + (lev > 0.75 ? 'neg' : lev > 0.6 ? '' : 'pos')}>{Math.round(lev * 100)}%</div></div>
      </div>
      <div className="dim" style={{ fontSize: 12, margin: '6px 0 10px' }}>
        {held.length} building{held.length === 1 ? '' : 's'}{landEntries.length ? ` · assembling on ${landEntries.length} block${landEntries.length > 1 ? 's' : ''} (${Math.round(landEntries.reduce((s2, e) => s2 + e.cells.length, 0) * E.PARCEL_AC * 100) / 100} ac)` : ''} —
        same rules you play under: rent comes in, debt service goes out, and the cycle does not care about the name on the door.
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {held.length === 0 && <div className="faint" style={{ fontSize: 12 }}>No holdings on record — everything is in their fund vehicles out of state.</div>}
        {held.sort((a, b) => est(b) - est(a)).map(b => {
          const t = state.tiles[b.tileI];
          return (
            <button key={b.id} className="inv-row inv-btn" onClick={() => openStock(b.id)}>
              <span className="dim">{b.type === 'office' ? '▮' : b.type === 'retail' ? '▬' : b.type === 'industrial' ? '▭' : b.type === 'multifamily' ? '▤' : '▦'}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                {E.stockName(state, b)} · {(b.sf / 1000).toFixed(0)}K SF {E.PLABEL[b.type]} · Block {blockName(t)} · {E.QLABEL[E.qGrade(b.quality)]}-grade
                {b.listedId ? <span style={{ color: 'var(--green)' }}> · listed for sale</span> : ''}
              </span>
              <span className="num dim">{pct(b.occ)} · ~{E.fmtMoney(est(b))}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn" onClick={close}>Close</button>
      </div>
    </Modal>
  );
}
