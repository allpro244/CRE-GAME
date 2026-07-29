import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as E from './engine';
import type { GameState, StockBuilding, Tile } from './engine';
import { Modal, Hint, BuildingSketch, blockName, pct } from './views2';
import { buildingArt, siteArt } from './buildingArt';

type Lens = 'value' | 'land' | 'office' | 'retail' | 'industrial' | 'multifamily' | 'crime' | 'pipeline' | 'comps';
const LENSES: { id: Lens; label: string }[] = [
  { id: 'value', label: 'Desirability' }, { id: 'land', label: 'Land $' }, { id: 'office', label: 'Office rents' },
  { id: 'retail', label: 'Retail rents' }, { id: 'industrial', label: 'Industrial fit' },
  { id: 'multifamily', label: 'Residential' }, { id: 'crime', label: 'Crime' },
  { id: 'pipeline', label: 'Pipeline' }, { id: 'comps', label: 'Comps' },
];

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const DARK: [number, number, number] = [19, 25, 31];
const TS = 52;   // px per tile
const SUB = 3;   // subdivision per tile for the continuous field

function lensRaw(state: GameState, t: Tile, lens: Lens): number {
  if (lens === 'value') return t.D / 100;
  if (lens === 'land') return E.landPricePerAcre(state, t) / 1e6;
  if (lens === 'office') return Math.min(1, (E.marketRentPSF(state, t, 'office') - 10) / 30);
  if (lens === 'retail') return Math.min(1, (E.marketRentPSF(state, t, 'retail') - 7) / 22);
  if (lens === 'industrial') return t.indSuit / 100;
  if (lens === 'multifamily') return Math.min(1, (E.marketRentPSF(state, t, 'multifamily') - 11) / 22);
  if (lens === 'pipeline') {
    let sf = 0;
    for (const b of state.stock) if (b.tileI === t.i && b.buildLeft) sf += b.sf;
    for (const a of state.assets) if (a.tileI === t.i && a.mode === 'construction') sf += a.sf;
    return Math.min(1, sf / 60000);
  }
  if (lens === 'comps') {
    const near = state.comps.filter(c => c.tileI === t.i && c.sf > 0);
    if (!near.length) return 0;
    const psf = near.reduce((s2, c) => s2 + c.price / c.sf, 0) / near.length;
    return Math.min(1, psf / 320);
  }
  return t.crime / 85;
}
const LENS_HUE: Record<Lens, [number, number, number]> = {
  value: [217, 166, 72], land: [188, 178, 96], office: [93, 143, 232], retail: [93, 143, 232],
  industrial: [63, 169, 126], multifamily: [186, 128, 224], crime: [222, 95, 95],
  pipeline: [232, 140, 60], comps: [120, 200, 160],
};

// The market isn't a checkerboard — value pools and drains across the city.
// Bilinear interpolation over tile centers gives the field its continuous grain.
function useTileValues(state: GameState, lens: Lens): number[] {
  return useMemo(() => {
    const landVals = state.tiles.filter(t => !t.water).map(t => lensRaw(state, t, lens)).sort((a, b) => a - b);
    const lo = landVals[Math.floor(landVals.length * 0.06)] ?? 0;
    const hi = landVals[Math.floor(landVals.length * 0.94)] ?? 1;
    return state.tiles.map(t => {
      const raw = lensRaw(state, t, lens);
      return hi > lo ? Math.max(0, Math.min(1, (raw - lo) / (hi - lo))) : 0.5;
    });
  }, [state, lens]);
}

function useField(state: GameState, lens: Lens) {
  return useMemo(() => {
    const W = E.CONFIG.GRID_W, H = E.CONFIG.GRID_H;
    // normalize against the city's own spread — a flat lens tells you nothing
    const landVals = state.tiles.filter(t => !t.water).map(t => lensRaw(state, t, lens)).sort((a, b) => a - b);
    const lo = landVals[Math.floor(landVals.length * 0.06)] ?? 0;
    const hi = landVals[Math.floor(landVals.length * 0.94)] ?? 1;
    const norm = (raw: number) => hi > lo ? Math.max(0, Math.min(1, (raw - lo) / (hi - lo))) : 0.5;
    const V: number[][] = [];
    for (let y = 0; y < H; y++) {
      V.push([]);
      for (let x = 0; x < W; x++) {
        const t = state.tiles[y * W + x];
        if (!t.water) { V[y].push(norm(lensRaw(state, t, lens))); continue; }
        // water tiles borrow neighbors so the field flows under the river
        let s = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nt = state.tiles[(y + dy) * W + (x + dx)];
          if (nt && !nt.water && nt.x === x + dx) { s += norm(lensRaw(state, nt, lens)); n++; }
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
  }, [state, lens]);
}

function riverGeometry(state: GameState) {
  const water = state.tiles.filter(t => t.water);
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
const MAX_STORIES: Record<string, number> = {
  tilt: 1, metal: 1, tin: 1,                 // industrial
  center: 2, strip: 1, pad: 1,               // retail
  concrete: 34, masonry: 6, wood: 3,         // office
  podium: 8,                                 // mixed
  garden: 3, midrise: 6, tower: 28,          // multifamily
};
// typical share of the site the building itself covers — the rest is parking,
// docks, yards, landscaping
const COVER: Record<E.PType, number> = { industrial: 0.50, retail: 0.28, office: 0.45, mixed: 0.50, multifamily: 0.40 };
function massing(type: E.PType, construction: string | undefined, sf: number, siteCells: number): { stories: number; ht: number; shrink: number } {
  const siteSF = Math.max(1, siteCells) * E.PARCEL_AC * 43_560;
  const maxSt = MAX_STORIES[construction ?? ''] ?? (type === 'industrial' || type === 'retail' ? 1 : 8);
  const stories = Math.max(1, Math.min(maxSt, Math.round(sf / (siteSF * COVER[type]))));
  const cover = Math.max(0.10, Math.min(0.92, sf / stories / siteSF));
  return { stories, ht: 4 + stories * 4.2, shrink: Math.max(0.34, Math.min(0.94, Math.sqrt(cover))) };
}
function defaultConstr(type: E.PType, sf: number): string {
  if (type === 'office') return sf > 26_000 ? 'concrete' : 'masonry';
  if (type === 'industrial') return 'metal';
  if (type === 'retail') return 'strip';
  if (type === 'multifamily') return sf > 42_000 ? 'tower' : 'midrise';
  return 'podium';
}

interface IsoBld { cx: number; cy: number; w: number; h: number; ht: number; col: string; listed: boolean; key: string; prog?: number; mine?: boolean; type?: E.PType; construction?: string; quality?: number; age?: number; sf?: number; occ?: number; seed?: number }

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
  const stamp = state.stock.length + ':' + state.assets.length + ':' + state.land.length
    + ':' + state.stock.reduce((s2, b) => s2 + (b.listedId ? 1 : 0), 0)
    + ':' + state.stock.reduce((s2, b) => s2 + (b.buildLeft ?? 0), 0)
    + ':' + state.assets.reduce((s2, a) => s2 + (a.project?.monthsLeft ?? 0) + (a.mode === 'construction' ? 1000 : 0), 0)
    + ':' + Math.round(state.stock.reduce((s2, b) => s2 + b.occ, 0) * 4);
  return useMemo(() => {
    const out: IsoBld[] = [];
    const place = (o: { tileI: number; sf: number; type: E.PType; quality?: number; age?: number; construction?: string; cells?: number[]; px?: number; py?: number; pw?: number; ph?: number }, col: string, listed: boolean, key: string, prog?: number, mine?: boolean) => {
      const cells = E.footprintCells(o);
      if (!cells.length) return;
      const t = state.tiles[o.tileI];
      const m = massing(o.type, o.construction ?? defaultConstr(o.type, o.sf), o.sf, cells.length);
      const ht = prog === undefined ? m.ht : Math.max(3, m.ht * prog);
      for (const [ri, r] of cellRects(cells).entries()) {
        const [cx, cy] = parcelCenter(t.x, t.y, r.px, r.py, r.pw, r.ph);
        const [w, h] = parcelSpan(r.pw, r.ph);
        out.push({ cx, cy, w: w * m.shrink, h: h * m.shrink, ht, col, listed, key: key + '_r' + ri, prog, mine,
          type: o.type, construction: o.construction, quality: o.quality, age: o.age, sf: o.sf, occ: (o as any).occ,
          seed: (state.seed ^ ((o.tileI + 1) * 0x9e3779b9) ^ ri) | 0 });
      }
    };
    for (const b of state.stock) {
      const prog = b.buildLeft ? 1 - b.buildLeft / Math.max(1, b.buildTotal ?? 1) : undefined;
      place(b, b.buildLeft ? '#7a6636' : b.owner !== 'private' ? '#46608c' : '#4a5560', !!b.listedId, 'b' + b.id, prog);
    }
    for (const a of state.assets) {
      const prog = a.mode === 'construction' && a.project
        ? 1 - a.project.monthsLeft / Math.max(1, a.project.monthsBuilt + a.project.monthsLeft) : undefined;
      place(a, a.mode === 'construction' ? '#8a7030' : '#d9a648', false, 'a' + a.id, prog, true);
    }
    for (const hd of state.land) {
      const t = state.tiles[hd.tileI];
      for (const [ri, r] of cellRects(hd.cells).entries()) {
        const [cx, cy] = parcelCenter(t.x, t.y, r.px, r.py, r.pw, r.ph);
        const [w, hh] = parcelSpan(r.pw, r.ph);
        out.push({ cx, cy, w: w * 0.92, h: hh * 0.92, ht: 1.5, col: '#8a6a2c', listed: false, key: 'L' + hd.id + '_r' + ri, mine: true });
      }
    }
    out.sort((p, q) => (p.cx + p.cy) - (q.cx + q.cy)); // painter's algorithm: back to front
    return out;
  }, [stamp, state.seed]); // eslint-disable-line
}

// detail=true above the LOD zoom threshold: facades and site dressing draw;
// below it every building is a cheap flat prism. Phase D plugs into the detail branch.
const IsoCity = memo(function IsoCity({ blds, detail }: { blds: IsoBld[]; detail: boolean }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      {blds.map(b => {
        const stroke = b.listed ? 'var(--green)' : '#0b0f13';
        const sw = b.listed ? 1.1 : 0.4;
        const f = prismFaces(b.cx, b.cy, b.w, b.h, b.ht);
        const st = b.prog !== undefined ? '#c98a2e' : stroke;
        const dash = b.prog !== undefined ? '3 2' : undefined;
        return (
          <g key={b.key}>
            {detail && b.ht > 3 && <polygon points={rectPoly(b.cx + b.w * 0.12, b.cy + b.h * 0.12, b.w, b.h)} fill="#000" opacity={0.22} />}
            <polygon points={f.l} fill={shade(b.col, 0.56)} stroke={st} strokeWidth={sw} strokeDasharray={dash} />
            <polygon points={f.r} fill={shade(b.col, 0.79)} stroke={st} strokeWidth={sw} strokeDasharray={dash} />
            <polygon points={f.t} fill={shade(b.col, 1.16)} stroke={st} strokeWidth={sw} strokeDasharray={dash} />
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
      ? buildingArt({ type: b.type, construction: b.construction ?? 'concrete', quality: b.quality ?? 50, age: b.age ?? 10, sf: b.sf ?? 0, occ: b.occ ?? 0, seed: b.seed ?? 1 }, geom)
      : [];
  if (!els.length) return null;
  return (
    <g>
      {els.map((e, i) => e.k === 'p'
        ? <polygon key={i} points={e.pts} fill={e.f ?? 'none'} stroke={e.s} strokeWidth={e.w} opacity={e.o} />
        : <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.s} strokeWidth={e.w} opacity={e.o} strokeDasharray={e.d} />)}
    </g>
  );
}


// ---------- pan / zoom viewport ----------
function useViewport(bx: number, by: number, bw: number, bh: number) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [vp, setVp] = useState({ z: 1, x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const clamp2 = (x: number, y: number, z: number) => ({
    x: Math.max(0, Math.min(bw - bw / z, x)),
    y: Math.max(0, Math.min(bh - bh / z, y)),
  });

  // single atomic update: zoom and recentre together, pinning the point under the cursor
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setVp(p => {
      const nz = Math.max(1, Math.min(6, p.z * factor));
      if (nz === p.z) return p;
      const vwOld = bw / p.z, vhOld = bh / p.z;
      const vwNew = bw / nz, vhNew = bh / nz;
      const fx = cx === undefined ? 0.5 : (cx - p.x) / vwOld;
      const fy = cy === undefined ? 0.5 : (cy - p.y) / vhOld;
      const c = {
        x: Math.max(0, Math.min(bw - vwNew, p.x + fx * (vwOld - vwNew))),
        y: Math.max(0, Math.min(bh - vhNew, p.y + fy * (vhOld - vhNew))),
      };
      return { z: nz, x: c.x, y: c.y };
    });
  }, [bw, bh]);

  useEffect(() => {
    const el = ref.current;
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
  }, [bw, bh, zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    moved.current = false;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: vpRef.current.x, oy: vpRef.current.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;
    const r = ref.current.getBoundingClientRect();
    setVp(p => {
      const c = clamp2(d.ox - (dx / r.width) * (bw / p.z), d.oy - (dy / r.height) * (bh / p.z), p.z);
      return { z: p.z, x: c.x, y: c.y };
    });
  };
  const onPointerUp = () => { drag.current = null; };
  const reset = () => setVp({ z: 1, x: 0, y: 0 });
  // centre the viewport on a point in base coordinates, zooming in if we're wide
  const focusOn = useCallback((p: [number, number]) => {
    setVp(prev => {
      const z = Math.max(prev.z, 2.2);
      const vw = bw / z, vh = bh / z;
      return {
        z,
        x: Math.max(0, Math.min(bw - vw, p[0] - bx - vw / 2)),
        y: Math.max(0, Math.min(bh - vh, p[1] - by - vh / 2)),
      };
    });
  }, [bw, bh, bx, by]);

  return {
    ref, viewBox: `${bx + vp.x} ${by + vp.y} ${bw / vp.z} ${bh / vp.z}`, z: vp.z, zoomAt, reset, focusOn, moved,
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
const ROAD_STYLE: Record<number, { stroke: string; w: number; dash?: string }> = {
  1: { stroke: '#242c35', w: 2.0 },
  2: { stroke: '#303a45', w: 3.0 },
  3: { stroke: '#414c58', w: 4.6 },
  4: { stroke: '#4b5763', w: 6.4 },
  5: { stroke: '#544a36', w: 1.8, dash: '7 5' },
};
const RoadsIso = memo(function RoadsIso({ runs }: { runs: RoadRun[] }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      {runs.map((r, i) => {
        const st = ROAD_STYLE[r.cls];
        const pts = r.pts.map(p => isoPt(p[0], p[1])).map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
        return (
          <g key={i}>
            <polyline points={pts} fill="none" stroke={st.stroke} strokeWidth={st.w} strokeDasharray={st.dash} strokeLinecap="round" />
            {r.cls === 3 && <polyline points={pts} fill="none" stroke="#59636f" strokeWidth={0.7} strokeDasharray="5 7" />}
            {r.cls === 4 && <polyline points={pts} fill="none" stroke="#5d6875" strokeWidth={0.8} strokeDasharray="10 4" />}
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
type TileGeom = { i: number; x: number; y: number; water: boolean };

const TileBaseIso = memo(function TileBaseIso({ tiles }: { tiles: TileGeom[] }) {
  return <g>{tiles.map(t => (
    <polygon key={'st' + t.i} points={diamond(t.x, t.y)} fill={t.water ? '#1b3149' : '#171c22'} stroke="#0b0f13" strokeWidth={0.5} />
  ))}</g>;
});

const LensCellsIso = memo(function LensCellsIso({ tiles, grids, vals, hue, zb }: {
  tiles: TileGeom[]; grids: (number | null)[][]; vals: number[]; hue: [number, number, number]; zb: number;
}) {
  return <g>{tiles.map(t => {
    if (t.water) return null;
    const base = lerpColor(DARK, hue, vals[t.i] * 0.82 + 0.03);
    const dimFill = lerpColor(DARK, hue, vals[t.i] * 0.4 + 0.02);
    const g = grids[t.i];
    const cells = [];
    for (let py = 0; py < E.PGRID; py++) for (let px = 0; px < E.PGRID; px++) {
      const occupied = g[py * E.PGRID + px] !== null;
      const [cx, cy] = parcelCenter(t.x, t.y, px, py);
      const [w, h] = parcelSpan(1, 1);
      cells.push(
        <polygon key={t.i + '-' + px + '-' + py} points={rectPoly(cx, cy, w * 0.9, h * 0.9)}
          fill={occupied ? base : dimFill}
          stroke={occupied ? '#0b0f13' : '#39434e'} strokeWidth={zb >= 2 ? 0.55 : 0.3}
          strokeOpacity={zb >= 1 ? 1 : 0.45} />
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
      fill={lerpColor(DARK, hue, Math.max(0, Math.min(1, c.v)) * 0.82 + 0.03)} />
  ))}</g>;
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

export function MapView({ state, setState, selTile, setSelTile, openDeal, openStock, openAsset, focusTile }: {
  state: GameState; setState: (s: GameState) => void; selTile: number | null; setSelTile: (i: number | null) => void;
  openDeal: (id: number) => void; openStock: (id: number) => void; openAsset: (id: number) => void;
  focusTile?: number | null;
}) {
  const [hover, setHover] = useState<{ text: string; sub: string; x: number; y: number } | null>(null);
  const [lens, setLens] = useState<Lens>('value');
  const [view, setView] = useState<'iso' | 'flat'>('iso');
  const W = E.CONFIG.GRID_W * TS, H = E.CONFIG.GRID_H * TS;
  const IW_TOT = (E.CONFIG.GRID_W + E.CONFIG.GRID_H) * (IW / 2) + IOX * 2;
  const IH_TOT = (E.CONFIG.GRID_W + E.CONFIG.GRID_H) * (IH / 2) + IOY + 40;
  const isoBlds = useIsoBuildings(state);
  const tileVals = useTileValues(state, lens);
  useEffect(() => {
    if (focusTile === null || focusTile === undefined) return;
    const t = state.tiles[focusTile];
    if (t) { setSelTile(focusTile); vpIso.focusOn(isoPt(t.x, t.y)); }
  }, [focusTile]); // eslint-disable-line
  const gridStamp = state.stock.length + ':' + state.assets.length + ':' + state.listings.length
    + ':' + state.land.length + ':' + state.land.reduce((s2, h) => s2 + h.cells.length, 0);
  const grids = useMemo(() => state.tiles.map(t => E.parcelGrid(state, t.i)), [gridStamp, state.seed]); // eslint-disable-line
  const [selCells, setSelCells] = useState<{ tileI: number; cells: number[] } | null>(null);
  // Stable per-seed geometry + a live ref so the memoized layers never re-render on hover.
  const tilesGeom = useMemo(() => state.tiles.map(t => ({ i: t.i, x: t.x, y: t.y, water: t.water })), [state.seed]); // eslint-disable-line
  const vpIso = useViewport(0, 0, IW_TOT, IH_TOT);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const vpFlat = useViewport(-20, -18, W + 24, H + 22);
  const field = useField(state, lens);
  const river = useMemo(() => riverGeometry(state), [state.seed]);
  const runs = useMemo(() => roadRuns(state.roads), [state.seed]); // eslint-disable-line
  const hue = LENS_HUE[lens];

  const sel = selTile !== null ? state.tiles[selTile] : null;
  const transitActive = state.effects.some(e => e.kind === 'transit');
  const listingsOn = (i: number) => state.listings.filter(l => l.tileI === i);
  const assetsOn = (i: number) => state.assets.filter(a => a.tileI === i);
  const stockOn = (i: number) => state.stock.filter(b => b.tileI === i);

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
  // when the clock ticks, the map acknowledges it: blocks that made news pulse briefly
  const [pulseTiles, setPulseTiles] = useState<number[]>([]);
  const prevMonth = useRef(state.month);
  useEffect(() => {
    if (state.month === prevMonth.current) return;
    prevMonth.current = state.month;
    const tiles = [...new Set(state.news.filter(n => n.m === state.month && n.tileI !== undefined).map(n => n.tileI!))];
    if (!tiles.length) return;
    setPulseTiles(tiles);
    const id = setTimeout(() => setPulseTiles([]), 1700);
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
    const best = E.PTYPES.filter(ty => !(ty === 'mixed' && state.tier < 1))
      .map(ty => ({ ty, fit: E.tileDemandFactor(state, t, ty) })).sort((a, b) => b.fit - a.fit)[0].ty;
    return { main, stray, cand: [...cand], best };
  }, [selCells, grids, state]);
  const effGhost = ghostType ?? selInfo?.best ?? null;

  const live = useRef({ state, grids, openDeal, openStock, openAsset, setSelTile });
  live.current = { state, grids, openDeal, openStock, openAsset, setSelTile };
  const hitLeave = useCallback(() => setHover(null), []);
  const hitEnter = useCallback((tileI: number, px: number, py: number, e: React.PointerEvent) => {
    const { state: s, grids: g } = live.current;
    const t = s.tiles[tileI];
    const occ = g[tileI][py * E.PGRID + px];
    const r = wrapRef.current?.getBoundingClientRect();
    let text = `Vacant · ${E.PARCEL_AC} ac`, sub2 = `Block ${blockName(t)} · ${E.fmtMoney(E.parcelPrice(s, t.i, 1, 1))}`;
    if (occ !== null) {
      if (occ >= 1_000_000) {
        const hd = s.land.find(x => x.id === occ - 1_000_000);
        text = 'Your land'; sub2 = hd ? `${Math.round(hd.cells.length * E.PARCEL_AC * 100) / 100} ac banked · basis ${E.fmtMoney(hd.basis)}` : '';
      } else if (occ < 0) {
        const l = s.listings.find(x => x.id === -occ);
        text = l?.kind === 'land' ? 'Land for sale' : 'For sale'; sub2 = l ? `${E.fmtMoney(l.price)}` : '';
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
    if (occ >= 1_000_000) return;   // your banked dirt — the block panel handles it
    const mine = s.assets.find(x => x.id === occ);
    if (mine) { oa(mine.id); return; }
    const b = s.stock.find(x => x.id === occ);
    if (b) { b.listedId ? od(b.listedId) : os(b.id); }
  }, []); // eslint-disable-line
  const zb = vpIso.z > 1.6 ? 2 : vpIso.z > 1.2 ? 1 : 0;

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
        <div className="lens-row">
          {LENSES.map(l => <button key={l.id} className={lens === l.id ? 'active' : ''} onClick={() => setLens(l.id)}>{l.label}</button>)}
          <span style={{ flex: 1 }} />
          <button className={view === 'iso' ? 'active' : ''} onClick={() => setView('iso')} title="Isometric skyline view">◪ 2.5D</button>
          <button className={view === 'flat' ? 'active' : ''} onClick={() => setView('flat')} title="Flat plan view">▦ Plan</button>
          <button onClick={() => (view === 'iso' ? vpIso : vpFlat).zoomAt(1 / 1.35)} title="Zoom out">−</button>
          <button onClick={() => (view === 'iso' ? vpIso : vpFlat).zoomAt(1.35)} title="Zoom in">+</button>
          <button onClick={() => (view === 'iso' ? vpIso : vpFlat).reset()} title="Fit the whole city">⤢ {(view === 'iso' ? vpIso.z : vpFlat.z).toFixed(1)}×</button>
        </div>
        {view === 'iso' ? (
        <svg className="map-svg" ref={vpIso.ref} viewBox={vpIso.viewBox} style={vpIso.style} {...vpIso.handlers}>
          <rect x={0} y={0} width={IW_TOT} height={IH_TOT} rx={6} fill="#0b0f13" />
          <TileBaseIso tiles={tilesGeom} />
          <LensCellsIso tiles={tilesGeom} grids={grids} vals={tileVals} hue={hue} zb={zb} />
          {(() => {
            const water = state.tiles.filter(t => t.water).sort((a, b) => (a.y - b.y) || (a.x - b.x));
            if (!water.length) return null;
            const seen = new Set<number>();
            const spine = water.filter(t => { if (seen.has(t.y)) return false; seen.add(t.y); return true; });
            const pts = spine.map(t => isoPt(t.x, t.y)).map(p => p[0].toFixed(0) + ',' + p[1].toFixed(0)).join(' ');
            return <polyline points={pts} fill="none" stroke="#23405c" strokeWidth={IH * 0.95} strokeLinecap="round" strokeLinejoin="round" />;
          })()}
          <RoadsIso runs={runs} />
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
          <IsoCity blds={isoBlds} detail={zb >= 2} />
          {state.listings.filter(l => l.kind === 'land' && !l.parentAssetId).map(l => {
            const t = state.tiles[l.tileI];
            const p = isoPt(t.x, t.y);
            return <circle key={'l' + l.id} cx={p[0]} cy={p[1] - 14} r={4.5} fill="var(--green)" stroke="#0b0f13" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />;
          })}
          {state.migrations.filter(mg => state.month - mg.m <= 3).map((mg, k) => {
            const a = state.tiles[mg.fromTileI], b = state.tiles[mg.toTileI];
            const p1 = isoPt(a.x, a.y), p2 = isoPt(b.x, b.y);
            return (
              <g key={'mg' + k} style={{ pointerEvents: 'none' }}>
                <line x1={p1[0]} y1={p1[1] - 16} x2={p2[0]} y2={p2[1] - 16} stroke="#e08c8c" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.85} />
                <circle cx={p2[0]} cy={p2[1] - 16} r={3.5} fill="#e08c8c" />
              </g>
            );
          })}
          <HitLayerIso tiles={tilesGeom} onEnter={hitEnter} onLeave={hitLeave} onClick={hitClick} />
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
                    Math.floor(selInfo.main.length * E.PARCEL_AC * 43_560 * E.FAR[effGhost] * bonus),
                    E.CONFIG.tiers[state.tier].maxSF);
                  if (sfMax < 5000) return null;
                  const ht = massing(effGhost, defaultConstr(effGhost, sfMax), sfMax, selInfo.main.length).ht;
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
          <rect x={-20} y={-18} width={W + 24} height={H + 22} rx={6} fill="#0b0f13" />
          {Array.from({ length: E.CONFIG.GRID_W }, (_, i) => (
            <text key={'cx' + i} x={(i + 0.5) * TS} y={-6} textAnchor="middle" fill="var(--dim)" fontSize={10} fontFamily="var(--mono)">{String.fromCharCode(65 + i)}</text>
          ))}
          {Array.from({ length: E.CONFIG.GRID_H }, (_, i) => (
            <text key={'cy' + i} x={-10} y={(i + 0.5) * TS + 3.5} textAnchor="middle" fill="var(--dim)" fontSize={10} fontFamily="var(--mono)">{i + 1}</text>
          ))}
          {/* continuous value field */}
          <FieldFlat field={field} hue={hue} />
          {/* faint block seams so the field reads as a city, not gradient soup */}
          {Array.from({ length: E.CONFIG.GRID_W + 1 }, (_, i) => (
            <line key={'gv' + i} x1={i * TS} y1={0} x2={i * TS} y2={H} stroke="#0b0f13" strokeWidth={0.8} opacity={0.35} />
          ))}
          {Array.from({ length: E.CONFIG.GRID_H + 1 }, (_, i) => (
            <line key={'gh' + i} x1={0} y1={i * TS} x2={W} y2={i * TS} stroke="#0b0f13" strokeWidth={0.8} opacity={0.35} />
          ))}
          {/* river */}
          {river && <path d={river} fill="none" stroke="#1c3450" strokeWidth={TS * 0.86} strokeLinecap="round" strokeLinejoin="round" />}
          {river && <path d={river} fill="none" stroke="#2d4f6e" strokeWidth={1.6} strokeDasharray="1 8" strokeLinecap="round" opacity={0.85} />}
          {/* the street network — every city's is its own */}
          <RoadsFlat runs={runs} />
          {transitActive && state.transitCorridor.map(i => {
            const t = state.tiles[i];
            return <rect key={'t' + i} x={t.x * TS + 1.5} y={t.y * TS + 1.5} width={TS - 3} height={TS - 3} rx={4}
              fill="none" stroke="var(--blue)" strokeWidth={1.5} strokeDasharray="5 4" style={{ pointerEvents: 'none' }} />;
          })}
          {/* buildings — same parcel-true geometry as the iso view */}
          <FlatBuildings blds={isoBlds} />
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
        </svg>
        )}
        <div className="faint" style={{ fontSize: 11, marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span><span style={{ color: 'var(--amber)' }}>▪</span> yours</span>
          <span><span style={{ color: '#7d95bd' }}>▪</span> institutional</span>
          <span><span style={{ color: '#8a97a3' }}>▪</span> private owners</span>
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
            Click any block. Every building in Meridian City is real and standing — most just aren't for sale.
            The gradient <i>is</i> the market: value pools around the core and drains toward the edges,
            and rents follow it.
          </div>
        ) : (
          <div>
            <h3>Block {blockName(sel)}</h3>
            <div className="metric-row" style={{ marginTop: 2 }}>
              <div className="metric"><div className="eyebrow">Desirability</div><div className="v num">{sel.D.toFixed(0)}<span className="faint">/100</span></div></div>
              <div className="metric"><div className="eyebrow">Income idx</div><div className="v num">{sel.income.toFixed(2)}×</div></div>
              <div className="metric"><div className="eyebrow">Employment</div><div className="v num">{sel.emp.toFixed(0)}</div></div>
              <div className="metric"><div className="eyebrow">Residents</div><div className="v num">{sel.pop.toFixed(0)}</div></div>
              <div className="metric"><div className="eyebrow">Crime</div><div className={'v num ' + (sel.crime > 55 ? 'neg' : '')}>{sel.crime.toFixed(0)}</div></div>
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
                      <td className="num">{E.capRatePct(state, sel, ty, 60).toFixed(1)}%</td>
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
                close={() => setSelCells(null)} openDeal={openDeal}
                ghostType={effGhost} setGhostType={setGhostType}
                mainLen={selInfo.main.length} strayLen={selInfo.stray.length} />
            )}
            {state.land.filter(h => h.tileI === sel.i).map(h => (
              <div key={h.id} className="memo" style={{ borderLeftColor: 'var(--amber)', marginTop: 10 }}>
                <div className="memo-row">
                  <span className="lbl"><b style={{ color: 'var(--ink)' }}>Your land</b> — {Math.round(h.cells.length * E.PARCEL_AC * 100) / 100} acres held since {E.monthName(h.acquiredM)}</span>
                  <span className="num">{E.fmtMoney(E.landValue(state, h))} <span className={'faint ' + (E.landValue(state, h) >= h.basis ? 'pos' : 'neg')}>vs {E.fmtMoney(h.basis)} basis</span></span>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="btn btn-sm" onClick={() => setState(E.sellLand(state, h.id).s)}>Sell the dirt</button>
                  <button className="btn btn-sm btn-amber" title={(() => {
                    const d = E.developableFrom(state, h.id);
                    return d.holdings.length > 1 ? `Builds together with ${d.holdings.length - 1} adjoining holding(s) — ${Math.round(d.cells.length * E.PARCEL_AC * 100) / 100} acres total` : undefined;
                  })()}
                    onClick={() => {
                      const r = E.developLand(state, h.id); setState(r.s); if (r.listingId) openDeal(r.listingId);
                    }}>Break ground ▸{(() => { const d = E.developableFrom(state, h.id); return d.holdings.length > 1 ? ` (${Math.round(d.cells.length * E.PARCEL_AC * 100) / 100} ac)` : ''; })()}</button>
                </div>
              </div>
            ))}
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
                    {(b.sf / 1000).toFixed(0)}K SF {E.PLABEL[b.type]} · {E.QLABEL[E.qGrade(b.quality)]}
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
                Land parcel · {l.acres} acres — {E.fmtMoney(l.price)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function ParcelBuyPanel({ state, setState, tileI, cells, close, openDeal, ghostType, setGhostType, mainLen, strayLen }: {
  state: GameState; setState: (s: GameState) => void; tileI: number; cells: number[];
  close: () => void; openDeal: (id: number) => void;
  ghostType: E.PType | null; setGhostType: (t: E.PType | null) => void;
  mainLen: number; strayLen: number;
}) {
  const [err, setErr] = useState<string | null>(null);
  const t = state.tiles[tileI];
  const acres = Math.round(cells.length * E.PARCEL_AC * 100) / 100;
  const price = E.parcelSetPrice(state, tileI, cells);
  const contiguous = E.isContiguous(cells);
  const bonus = E.upzoneBonus(mainLen);
  const siteAcres = mainLen * E.PARCEL_AC;
  const sfFor = (ty: E.PType) => Math.min(Math.floor(siteAcres * 43_560 * E.FAR[ty] * bonus), E.CONFIG.tiers[state.tier].maxSF);
  const tooSmall = !E.PTYPES.some(ty => sfFor(ty) >= 5000);
  const nextThreshold = mainLen >= 16 ? null : mainLen >= 12 ? { at: 16, pct: 35 } : mainLen >= 8 ? { at: 12, pct: 22 } : { at: 8, pct: 12 };
  return (
    <div className="memo" style={{ borderLeftColor: 'var(--amber)', marginTop: 10 }}>
      <div className="memo-row">
        <span className="lbl"><b style={{ color: 'var(--ink)' }}>{cells.length} vacant parcel{cells.length > 1 ? 's' : ''}</b> selected on block {blockName(t)}</span>
        <b className="num">{E.fmtMoney(price)}</b>
      </div>
      <div className="dim" style={{ fontSize: 11.5, margin: '4px 0 8px', lineHeight: 1.5 }}>
        Click more vacant lots to add them; click a selected lot to drop it. Esc clears. Dotted lots adjoin your site.
      </div>
      <div className="memo-row"><span className="lbl">Site</span><span className="num">{acres} acres · {E.fmtMoney(Math.round(price / Math.max(0.01, acres)))}/acre</span></div>
      {strayLen > 0 && (
        <div className="memo-row"><span className="lbl">Buildable as one site <Hint text="Parcels must share an edge. Two lots meeting only at a corner are separate sites — you can still bank both." /></span>
          <span className="num neg">{strayLen} lot{strayLen > 1 ? 's' : ''} corner-only — bridge or drop {strayLen > 1 ? 'them' : 'it'}</span></div>
      )}
      <div className="memo-row">
        <span className="lbl">Assembly upzoning <Hint text="Bigger contiguous sites earn density: 8 lots +12% FAR, 12 lots +22%, the full block +35%." /></span>
        <span className="num">{bonus > 1 ? <b className="pos">+{Math.round((bonus - 1) * 100)}% FAR</b> : '—'}
          {nextThreshold && <span className="faint"> · {nextThreshold.at - mainLen} more lot{nextThreshold.at - mainLen > 1 ? 's' : ''} → +{nextThreshold.pct}%</span>}</span>
      </div>
      <div className="memo-row"><span className="lbl">Block is {Math.round((1 - E.freeParcelCount(state, tileI) / 16) * 100)}% built out</span>
        <span className="num dim">holdout premium ×{E.holdoutMult(state, tileI, cells.length).toFixed(2)}</span></div>
      <div style={{ margin: '8px 0 2px' }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>Build preview — what this site could hold</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {E.PTYPES.map(ty => {
            const sf = sfFor(ty);
            const f = E.tileDemandFactor(state, t, ty);
            const locked = ty === 'mixed' && state.tier < 1;
            const active = ghostType === ty;
            return (
              <button key={ty} className={'btn btn-sm' + (active ? ' btn-amber' : '')} disabled={locked || sf < 5000}
                title={locked ? 'Mixed-use unlocks at Tier 2' : sf < 5000 ? 'Site too small for this use' : `Demand ${f > 1.1 ? 'strong' : f > 0.85 ? 'fair' : 'weak'} here`}
                style={{ fontSize: 10.5, padding: '3px 8px' }}
                onClick={() => setGhostType(active ? null : ty)}>
                {E.PLABEL[ty]} <span className={'num ' + (f > 1.1 ? 'pos' : f > 0.85 ? 'dim' : 'neg')}>{(sf / 1000).toFixed(0)}K</span>
              </button>
            );
          })}
        </div>
        <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>The dashed massing on the map is this choice at full envelope. Demand color: <span className="pos">strong</span> · <span className="dim">fair</span> · <span className="neg">weak</span>.</div>
      </div>
      {contiguous && tooSmall && <div className="faint" style={{ fontSize: 11, color: 'var(--amber)' }}>◈ Too small to build on — select more adjoining lots.</div>}
      {err && <div className="alert-strip red" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={close}>Clear</button>
        <button className="btn btn-sm btn-amber" title="Buy the dirt and sit on it — no building required"
          onClick={() => {
            const r = E.buyParcelsOutright(state, tileI, cells);
            if (r.err) { setErr(r.err); return; }
            setState(r.s); close();
          }}>Buy &amp; hold — {E.fmtMoney(price)}</button>
        <button className="btn btn-sm" disabled={!contiguous || tooSmall}
          title={!contiguous ? 'Selected lots only touch at a corner' : tooSmall ? 'Site is too small to build on' : undefined}
          onClick={() => {
            const r = E.buyParcelsForDev(state, tileI, cells);
            if (r.err) { setErr(r.err); return; }
            setState(r.s); close();
            if (r.listingId) openDeal(r.listingId);
          }}>Buy &amp; build now ▸</button>
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
      <h2>{E.PLABEL[b.type]} — Block {blockName(t)}</h2>
      <div className="sub">{spec.label} · built {Math.max(1950, Math.round(2026 - b.age))} · {ownerLabel}{b.blacklist ? ' (not speaking to you)' : ''}</div>
      <BuildingSketch a={b} w={360} h={120} />
      <div className="metric-row" style={{ marginTop: 10 }}>
        <div className="metric"><div className="eyebrow">Size</div><div className="v num">{(b.sf / 1000).toFixed(0)}K SF</div></div>
        <div className="metric"><div className="eyebrow">{b.type === 'multifamily' ? 'Apartments' : 'Units'}</div><div className="v num">{b.units}</div></div>
        <div className="metric"><div className="eyebrow">Occupancy</div><div className="v num">{pct(b.occ)}</div></div>
        <div className="metric"><div className="eyebrow">Grade</div><div className="v num">{E.QLABEL[E.qGrade(b.quality)]}</div></div>
        <div className="metric"><div className="eyebrow">Site</div><div className="v num">{Math.round((b.sf / E.FAR[b.type] / 43560) * 100) / 100} ac</div></div>
      </div>
      <div className="dim" style={{ fontSize: 12, margin: '10px 0 12px', lineHeight: 1.55 }}>
        Rent roll and financials are private — you can see the lights on, not the leases.
        {b.listedId ? ' This one is on the market, though: the flyer has numbers.' : ' Cold-call the owner to find out if there\u2019s a deal inside.'}
        <Hint text="Occupancy, size, age, and grade are observable from the street and public records. What each tenant pays is not." />
      </div>
      {err && <div className="alert-strip red" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {!b.listedId && !b.blacklist && b.owner === 'private' && (
          <span className="faint" style={{ fontSize: 11, marginRight: 'auto' }}>{state.approachesLeft} of 5 cold calls left this month</span>
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
  const est = (b: StockBuilding) => {
    const t = state.tiles[b.tileI];
    const cap = E.capRatePct(state, t, b.type, b.quality) / 100;
    return E.stabilizedNOI(state, { tileI: b.tileI, type: b.type, sf: b.sf, quality: b.quality, units: b.units, construction: b.construction } as any) * (0.55 + 0.45 * (b.occ / 0.9)) / cap;
  };
  const total = held.reduce((s, b) => s + est(b), 0);
  const styleTxt = f.style === 'core' ? 'buys stabilized assets in prime blocks and holds forever'
    : f.style === 'aggressive' ? 'develops speculatively with maximum leverage — brilliant until the cycle turns'
    : f.style === 'industrial' ? 'buys and builds along the rail corridor exclusively'
    : f.style === 'value-add' ? 'hunts distressed and tired buildings, fixes them, flips them'
    : 'accumulates apartments and never sells';
  return (
    <Modal close={close} wide>
      <h2>{f.name} {!f.alive && <span className="chip chip-distress">Collapsed</span>}</h2>
      <div className="sub">{styleTxt} · reported net worth {E.fmtMoney(f.netWorth)}</div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
        {held.length} buildings in Meridian City · est. portfolio value {E.fmtMoney(total)}
        <Hint text="Estimated from public records and street-level observation. Their actual basis and debt are their business." />
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {held.length === 0 && <div className="faint" style={{ fontSize: 12 }}>No holdings on record — everything is in their fund vehicles out of state.</div>}
        {held.sort((a, b) => est(b) - est(a)).map(b => {
          const t = state.tiles[b.tileI];
          return (
            <button key={b.id} className="inv-row inv-btn" onClick={() => openStock(b.id)}>
              <span className="dim">{b.type === 'office' ? '▮' : b.type === 'retail' ? '▬' : b.type === 'industrial' ? '▭' : b.type === 'multifamily' ? '▤' : '▦'}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                {(b.sf / 1000).toFixed(0)}K SF {E.PLABEL[b.type]} · Block {blockName(t)} · {E.QLABEL[E.qGrade(b.quality)]}-grade
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
