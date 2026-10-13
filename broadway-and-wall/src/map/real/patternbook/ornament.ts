// THE PRE-WAR ORNAMENT AND THE CIVIC SHELF. Twenty more elevations from the
// pattern books the city's architects actually worked from: the Beaux-Arts
// avenue and the Châteauesque mansion block, Ruskin's striped Gothic, the
// Sullivan skyscraper, the Second Empire hotel and the Neo-Grec row; then the
// town's public faces — temple-fronted banks, Greek Revival rows, the
// collegiate quad, the PWA post office, the armory and the 1960s arcade.
// Each paints its own wall and ornament here; the renderer adds the windows.
import { TILE, P, type FamilySpec, type Painter, type PaintCtx } from "../facades";
import type { BookEntry } from "./types";

type RGB = [number, number, number];
type Win = FamilySpec["win"];
const T = TILE;
const MK_TRIM = "rgb(0,255,0)", MK_ACC = "rgb(0,0,255)";
const rgb = (c: RGB, v = 1) => `rgb(${Math.max(0, Math.min(255, c[0] * v)) | 0},${Math.max(0, Math.min(255, c[1] * v)) | 0},${Math.max(0, Math.min(255, c[2] * v)) | 0})`;
const grey = (v: number) => `rgb(${v | 0},${v | 0},${v | 0})`;

// ---- drawing on all three canvases at once ---------------------------------
/** A rectangle on the colour; the same on the paint mask (mk) and the relief (hv, 0-255) when given. */
function box(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, x: number, y: number, w: number, h: number, mk?: string | null, hv?: number) {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  if (pc && mk) { pc.m.fillStyle = mk; pc.m.fillRect(x, y, w, h); }
  if (pc && hv !== undefined) { pc.hg.fillStyle = grey(hv); pc.hg.fillRect(x, y, w, h); }
}
/** A filled path on the colour, and on the mask and relief when given. */
function form(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, path: (c: CanvasRenderingContext2D) => void, mk?: string | null, hv?: number) {
  g.fillStyle = col; g.beginPath(); path(g); g.fill();
  if (pc && mk) { pc.m.fillStyle = mk; pc.m.beginPath(); path(pc.m); pc.m.fill(); }
  if (pc && hv !== undefined) { pc.hg.fillStyle = grey(hv); pc.hg.beginPath(); path(pc.hg); pc.hg.fill(); }
}
/** A stroked path, likewise. */
function line(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, lw: number, path: (c: CanvasRenderingContext2D) => void, mk?: string | null, hv?: number) {
  g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); path(g); g.stroke();
  if (pc && mk) { pc.m.strokeStyle = mk; pc.m.lineWidth = lw; pc.m.beginPath(); path(pc.m); pc.m.stroke(); }
  if (pc && hv !== undefined) { pc.hg.strokeStyle = grey(hv); pc.hg.lineWidth = lw; pc.hg.beginPath(); path(pc.hg); pc.hg.stroke(); }
}
const relief = (pc: PaintCtx | undefined, v: number) => { if (pc) { pc.hg.fillStyle = grey(v); pc.hg.fillRect(0, 0, 2 * T, 2 * T); } };

/** The four openings of the tile, exactly where the renderer will cut them. */
interface Bay { ox: number; oy: number; bx: number; by: number; x0: number; x1: number; y0: number; y1: number; w: number; h: number; cx: number }
function bays(win: Win): Bay[] {
  const out: Bay[] = [];
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T, oy = by * T;
    const x0 = ox + win.x0 * T, x1 = ox + win.x1 * T, y0 = oy + (1 - win.y1) * T, y1 = oy + (1 - win.y0) * T;
    out.push({ ox, oy, bx, by, x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2 });
  }
  return out;
}
/** The bay lines, where piers and columns stand (the tile wraps, so both edges). */
const LINES = [0, T, 2 * T];

// ---- the wall fields --------------------------------------------------------
/** Coursed ashlar: blocks of one height, joints in the relief. */
function ashlar(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, c: RGB, course: number, len: number, rnd: () => number, amp = 0.07, joint = 0.84) {
  g.fillStyle = rgb(c, joint); g.fillRect(0, 0, 2 * T, 2 * T);
  relief(pc, 150);
  for (let y = 0, r = 0; y < 2 * T; y += course, r++) for (let x = (r % 2) * len / 2 - len; x < 2 * T; x += len) {
    const v = 1 - amp / 2 + rnd() * amp;
    box(g, pc, rgb(c, v), x + 0.8, y + 0.8, len - 1.2, course - 1.2, null, 205);
  }
}
/** Brick in running or English bond; `amp` is how much the burn varies. */
function bricks(g: CanvasRenderingContext2D, c: RGB, rnd: () => number, o: { bw?: number; bh?: number; mortar?: string; amp?: number; english?: boolean; header?: RGB } = {}) {
  const bw = o.bw ?? 16, bh = o.bh ?? 6, amp = o.amp ?? 0.22;
  g.fillStyle = o.mortar ?? "#b4a998"; g.fillRect(0, 0, 2 * T, 2 * T);
  for (let y = 0, r = 0; y < 2 * T; y += bh, r++) {
    const head = o.english && r % 2 === 1, L = head ? bw / 2 : bw;
    for (let x = head ? -bw / 4 : -((r % 2) * bw) / 2; x < 2 * T; x += L) {
      const v = 1 - amp / 2 + rnd() * amp;
      g.fillStyle = rgb(head && o.header ? o.header : c, v); g.fillRect(x + 0.8, y + 0.8, L - 1.3, bh - 1.3);
    }
  }
}
/** A round shaft, lit from the left, optionally fluted. */
function shaft(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, c: RGB, x: number, wd: number, y0: number, y1: number, flutes = 0) {
  const gr = g.createLinearGradient(x, 0, x + wd, 0);
  gr.addColorStop(0, rgb(c, 0.8)); gr.addColorStop(0.32, rgb(c, 1.13)); gr.addColorStop(0.7, rgb(c, 0.97)); gr.addColorStop(1, rgb(c, 0.64));
  g.fillStyle = gr; g.fillRect(x, y0, wd, y1 - y0);
  g.fillStyle = "rgba(0,0,0,0.17)";
  for (let i = 1; i < flutes; i++) g.fillRect(x + (wd * i) / flutes - 0.5, y0 + 3, 1, y1 - y0 - 6);
  if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(x, y0, wd, y1 - y0); }
}
/** A Corinthian capital, simplified: a bell of leaves under a square abacus with corner volutes. */
function capital(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, c: RGB, cx: number, wd: number, y: number) {
  box(g, pc, rgb(c, 1.08), cx - wd / 2 - 4, y, wd + 8, 3, null, 255);                  // abacus
  form(g, pc, rgb(c, 0.98), (q) => { q.moveTo(cx - wd / 2 - 3, y + 3); q.lineTo(cx + wd / 2 + 3, y + 3); q.lineTo(cx + wd / 2, y + 11); q.lineTo(cx - wd / 2, y + 11); q.closePath(); }, null, 255);
  g.fillStyle = rgb(c, 0.72);
  for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(cx - wd / 3 + (k * wd) / 3, y + 8, 2, 3, 0, 0, 6.283); g.fill(); }
  for (const s of [-1, 1]) { g.fillStyle = rgb(c, 1.12); g.beginPath(); g.arc(cx + s * (wd / 2 + 1), y + 5, 2.4, 0, 6.283); g.fill(); }
}
/** Quoins straddling the bay line at x: long and short blocks, alternating. */
function quoins(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, c: RGB, course: number, long: number, short: number) {
  for (const x of [0, 2 * T]) for (let y = 0, k = 0; y < 2 * T; y += course, k++) {
    const L = k % 2 ? short : long;
    box(g, pc, rgb(c, 0.97 + (k % 3) * 0.03), x - L / 2, y + 1, L, course - 2, MK_TRIM, 255);
    g.fillStyle = rgb(c, 0.66); g.fillRect(x - L / 2, y + course - 2.5, L, 1.5);
  }
}
const speckle = (g: CanvasRenderingContext2D, rnd: () => number, n: number, dark: string, light: string) => {
  for (let i = 0; i < n; i++) { g.fillStyle = rnd() < 0.5 ? dark : light; g.fillRect(rnd() * 2 * T, rnd() * 2 * T, 1.3, 1.3); }
};

// ============================================================================
// PRE-WAR ORNAMENT
// ============================================================================

/** GRAND BEAUX-ARTS, 1890-1925: the Fifth Avenue mansion block and the École-trained office tower — channelled limestone, paired columns at every bay line, a full entablature at each storey and a garland swagged under every sill. */
const W_BEAUX: Win = { x0: 0.3, x1: 0.7, y0: 0.24, y1: 0.75 };
const beauxArts = (c: RGB, win: Win = W_BEAUX): Painter => (g, _w, _h, rnd, pc) => {
  ashlar(g, pc, c, 16, 80, rnd, 0.06, 0.92);
  // the channels: horizontal joints cut deep, the vertical ones barely seen
  for (let y = 0; y < 2 * T; y += 16) { box(g, pc, rgb(c, 0.6), 0, y, 2 * T, 2.4, null, 100); g.fillStyle = rgb(c, 1.08); g.fillRect(0, y + 2.4, 2 * T, 1); }
  for (const b of bays(win)) {
    // entablature: cornice, frieze, architrave
    box(g, pc, rgb(c, 1.07), b.ox, b.oy, T, 14, null, 255);
    g.fillStyle = rgb(c, 0.78); for (let x = b.ox + 1; x < b.ox + T; x += 5) g.fillRect(x, b.oy + 4, 2.5, 3);
    box(g, pc, rgb(c, 0.66), b.ox, b.oy + 14, T, 2, null, 120);
    // the swag under the sill: an apron, a festoon of leaves, ribbons, a cartouche
    const sy = b.y1 + 7, ey = b.oy + T - 3;
    box(g, pc, rgb(c, 0.94), b.x0 - 3, sy, b.w + 6, ey - sy, null, 190);
    for (const [col, lw, dy] of [[rgb(c, 0.66), 6, 1], [rgb(c, 1.1), 3, -1]] as [string, number, number][]) {
      line(g, pc, col, lw, (q) => { q.moveTo(b.x0 + 3, sy + 3 + dy); q.quadraticCurveTo(b.cx, ey + 4 + dy, b.x1 - 3, sy + 3 + dy); }, null, 255);
    }
    g.fillStyle = rgb(c, 0.78);
    for (let k = 0; k < 9; k++) { const t = k / 8, x = b.x0 + 3 + t * (b.w - 6), y = sy + 3 + 2 * t * (1 - t) * (ey + 4 - sy - 3); g.beginPath(); g.arc(x, y, 1.4, 0, 6.283); g.fill(); }
    box(g, pc, rgb(c, 1.04), b.x0 + 1, sy, 2.5, 9, null, 255); box(g, pc, rgb(c, 1.04), b.x1 - 3.5, sy, 2.5, 9, null, 255);
    form(g, pc, rgb(c, 1.1), (q) => q.ellipse(b.cx, sy + 6, 5, 6.5, 0, 0, 6.283), MK_TRIM, 255);
  }
  // the paired columns, one floor tall, either side of each bay line
  for (let by = 0; by < 2; by++) for (const lx of LINES) for (const dx of [-16, 5]) {
    const oy = by * T;
    shaft(g, pc, c, lx + dx, 11, oy + 26, oy + T - 5, 4);
    capital(g, pc, c, lx + dx + 5.5, 11, oy + 16);
    box(g, pc, rgb(c, 1.04), lx + dx - 2, oy + T - 5, 15, 5, null, 255);
  }
};

/** CHÂTEAUESQUE, 1885-1930: the Loire château in Indiana limestone for the Vanderbilt avenue and the apartment house after it — fine ashlar, stone-mullioned cross windows under label moulds, and a crocketed gablet of tracery breaking up through every other floor. */
const W_CHATEAU: Win = { x0: 0.33, x1: 0.67, y0: 0.16, y1: 0.68 };
const chateau = (c: RGB, win: Win = W_CHATEAU): Painter => (g, _w, _h, rnd, pc) => {
  ashlar(g, pc, c, 12, 42, rnd, 0.05, 0.86);
  for (const b of bays(win)) {
    // a string course at the sill line, run right through
    box(g, pc, rgb(c, 1.06), b.ox, b.y1 + 5, T, 4, MK_TRIM, 255);
    box(g, pc, rgb(c, 0.66), b.ox, b.y1 + 9, T, 1.5, null, 120);
    // the label mould, square-headed, with drops
    const L = b.x0 - 7, R = b.x1 + 7;
    box(g, pc, rgb(c, 1.08), L, b.y0 - 7, R - L, 4, MK_TRIM, 255);
    box(g, pc, rgb(c, 1.08), L, b.y0 - 7, 4, 15, MK_TRIM, 255); box(g, pc, rgb(c, 1.08), R - 4, b.y0 - 7, 4, 15, MK_TRIM, 255);
    box(g, pc, rgb(c, 0.55), L, b.y0 - 3, R - L, 1.8, null, 110);
    box(g, pc, rgb(c, 0.6), L, b.y0 + 8, 4, 1.5, null, 110); box(g, pc, rgb(c, 0.6), R - 4, b.y0 + 8, 4, 1.5, null, 110);
    if (b.by === 0) {
      // the gablet: a steep triangle of tracery with crockets and a finial
      const top = b.oy + 3, foot = b.y0 - 8;
      form(g, pc, rgb(c, 1.13), (q) => { q.moveTo(L - 2, foot); q.lineTo(b.cx, top); q.lineTo(R + 2, foot); q.closePath(); }, MK_TRIM, 255);
      form(g, pc, rgb(c, 0.6), (q) => { q.moveTo(L + 7, foot - 2); q.lineTo(b.cx, top + 10); q.lineTo(R - 7, foot - 2); q.closePath(); }, null, 150);
      g.fillStyle = rgb(c, 1.18);
      for (const [dx, dy] of [[0, -4], [-3.5, 1.5], [3.5, 1.5]]) { g.beginPath(); g.arc(b.cx + dx, foot - 9 + dy, 3, 0, 6.283); g.fill(); }
      g.fillStyle = rgb(c, 0.55); g.beginPath(); g.arc(b.cx, foot - 8, 1.6, 0, 6.283); g.fill();
      for (let k = 1; k < 5; k++) for (const s of [-1, 1]) {
        const t = k / 5, x = b.cx + s * (1 - t) * (R + 2 - b.cx), y = top + t * (foot - top);
        g.fillStyle = rgb(c, 1.14); g.beginPath(); g.arc(x + s * 2, y - 1, 2, 0, 6.283); g.fill();
      }
      box(g, pc, rgb(c, 1.14), b.cx - 1.5, top - 3, 3, 6, MK_TRIM, 255);
    } else {
      // the lesser floor: a blind arcade of three trefoil heads over the window
      const y = b.oy + 6, h = b.y0 - 12 - y, wd = (R - L) / 3;
      box(g, pc, rgb(c, 0.9), L, y, R - L, h, null, 180);
      for (let k = 0; k < 3; k++) {
        const x = L + k * wd;
        form(g, pc, rgb(c, 0.7), (q) => { q.moveTo(x + 2, y + h); q.lineTo(x + 2, y + 6); q.arc(x + wd / 2, y + 6, wd / 2 - 2, Math.PI, 0); q.lineTo(x + wd - 2, y + h); q.closePath(); }, null, 130);
      }
    }
  }
};

/** VENETIAN GOTHIC, 1860-1890: Ruskin's Stones of Venice built in New York and Boston — the wall striped in red brick and cream stone, pointed windows under voussoirs of alternating colour, an iron balconette and a quatrefoil between the arches. */
const W_VEN: Win = { x0: 0.32, x1: 0.68, y0: 0.24, y1: 0.8 };
const venetian = (brick: RGB, stone: RGB, win: Win = W_VEN): Painter => (g, _w, _h, rnd, pc) => {
  bricks(g, brick, rnd, { bh: 4.5, bw: 13, amp: 0.2 });
  relief(pc, 200);
  // the stripes: a stone course every three of brick
  for (let y = 9; y < 2 * T; y += 20) {
    box(g, pc, rgb(stone, 0.98 + rnd() * 0.05), 0, y, 2 * T, 6.5, null, 230);
    g.fillStyle = rgb(stone, 0.8); for (let x = rnd() * 30; x < 2 * T; x += 30 + rnd() * 14) g.fillRect(x, y, 1, 6.5);
  }
  for (const b of bays(win)) {
    // the voussoirs: the ring outside the pointed head, red and cream by turns
    const r = b.w * 0.8, spring = b.y0 + r, xa = b.x0 - 9, xb = b.x1 + 9, apex = b.y0 - 10;
    const ring = (q: CanvasRenderingContext2D) => { q.moveTo(xa, spring); q.quadraticCurveTo(xa, apex + (spring - apex) * 0.25, b.cx, apex); q.quadraticCurveTo(xb, apex + (spring - apex) * 0.25, xb, spring); q.closePath(); };
    g.save(); g.beginPath(); ring(g); g.clip();
    for (let k = 0; k < 11; k++) {
      const a0 = Math.PI + (k * Math.PI) / 11, a1 = Math.PI + ((k + 1) * Math.PI) / 11;
      g.fillStyle = k % 2 ? rgb(stone, 1.02) : rgb(brick, 0.92);
      g.beginPath(); g.moveTo(b.cx, spring + 4); g.lineTo(b.cx + Math.cos(a0) * 90, spring + 4 + Math.sin(a0) * 90); g.lineTo(b.cx + Math.cos(a1) * 90, spring + 4 + Math.sin(a1) * 90); g.closePath(); g.fill();
    }
    g.restore();
    line(g, pc, rgb(stone, 1.06), 2.2, (q) => { q.moveTo(xa - 1, spring); q.quadraticCurveTo(xa - 1, apex - 1 + (spring - apex) * 0.25, b.cx, apex - 1.5); q.quadraticCurveTo(xb + 1, apex - 1 + (spring - apex) * 0.25, xb + 1, spring); }, MK_TRIM, 255);
    // the jambs in stone, the sill a slab
    box(g, pc, rgb(stone), b.x0 - 5, spring, 5, b.y1 - spring, MK_TRIM, 240); box(g, pc, rgb(stone), b.x1, spring, 5, b.y1 - spring, MK_TRIM, 240);
    box(g, pc, rgb(stone, 1.04), b.x0 - 9, b.y1, b.w + 18, 4, MK_TRIM, 255);
    // a balconette of iron under the window
    const iron = "#2a2826";
    box(g, pc, iron, b.x0 - 6, b.y1 + 4, b.w + 12, 2, MK_ACC, 230);
    for (let x = b.x0 - 5; x < b.x1 + 6; x += 4) box(g, pc, iron, x, b.y1 + 6, 1.4, 9, MK_ACC, 230);
    box(g, pc, iron, b.x0 - 6, b.y1 + 14, b.w + 12, 1.6, MK_ACC, 230);
  }
  // the quatrefoil roundel between the arches, cream with a dark eye
  for (let by = 0; by < 2; by++) for (const lx of LINES) {
    const cy = by * T + 26;
    g.fillStyle = rgb(stone, 1.05); for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) { g.beginPath(); g.arc(lx + dx, cy + dy, 4.6, 0, 6.283); g.fill(); }
    g.fillStyle = rgb(brick, 0.5); g.beginPath(); g.arc(lx, cy, 3, 0, 6.283); g.fill();
  }
};

/** SULLIVANESQUE, 1890-1915: Adler & Sullivan's tall office building — unbroken piers rising the full height, the windows recessed between them and every spandrel a panel of foliate terra cotta. Buffalo, St Louis, Chicago, and Bleecker Street. */
const W_SULL: Win = { x0: 0.15, x1: 0.85, y0: 0.27, y1: 0.86 };
const sullivan = (ground: RGB, pier: RGB, orn: RGB, win: Win = W_SULL): Painter => (g, _w, _h, rnd, pc) => {
  g.fillStyle = rgb(ground); g.fillRect(0, 0, 2 * T, 2 * T);
  relief(pc, 150);
  for (const b of bays(win)) {
    // the spandrels, above the head and below the sill, as one ornamented field
    for (const [y0, y1] of [[b.oy, b.y0 - 1], [b.y1 + 1, b.oy + T]]) {
      const x0 = b.ox + 16, x1 = b.ox + T - 16;
      box(g, pc, rgb(orn, 0.7), x0, y0, x1 - x0, y1 - y0, MK_TRIM, 170);
      box(g, pc, rgb(orn, 1.05), x0, y0, x1 - x0, 1.6, MK_TRIM, 255); box(g, pc, rgb(orn, 1.05), x0, y1 - 1.6, x1 - x0, 1.6, MK_TRIM, 255);
      const cy = (y0 + y1) / 2, rr = Math.min(6, (y1 - y0) / 2 - 2.5);
      for (let x = x0 + 9; x < x1 - 4; x += 15) {
        // a whorl: a ring, four leaves turning round it, a seed at its eye
        line(g, pc, rgb(orn, 1.12), 1.8, (q) => q.arc(x, cy, rr, 0, 6.283), null, 255);
        g.fillStyle = rgb(orn, 1.02);
        for (let k = 0; k < 4; k++) { const a = k * 1.571 + rnd() * 0.5; g.beginPath(); g.ellipse(x + Math.cos(a) * rr * 0.5, cy + Math.sin(a) * rr * 0.5, rr * 0.5, 1.3, a + 0.8, 0, 6.283); g.fill(); }
        g.fillStyle = rgb(orn, 1.2); g.beginPath(); g.arc(x, cy, 1.4, 0, 6.283); g.fill();
        // tendrils curling into the next
        line(g, pc, rgb(orn, 0.95), 1.1, (q) => { q.moveTo(x + rr, cy); q.bezierCurveTo(x + rr + 3, cy - rr, x + 12 - rr, cy + rr, x + 15 - rr, cy); }, null, 230);
      }
    }
  }
  // the piers, rounded at the arris, running through every floor
  for (const lx of LINES) {
    const gr = g.createLinearGradient(lx - 16, 0, lx + 16, 0);
    gr.addColorStop(0, rgb(pier, 0.72)); gr.addColorStop(0.12, rgb(pier, 1.06)); gr.addColorStop(0.5, rgb(pier, 1.0)); gr.addColorStop(0.88, rgb(pier, 0.92)); gr.addColorStop(1, rgb(pier, 0.62));
    g.fillStyle = gr; g.fillRect(lx - 16, 0, 32, 2 * T);
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(lx - 16, 0, 32, 2 * T); }
    // the pier's own skin: brick or tile in thin courses
    g.fillStyle = rgb(pier, 0.86); for (let y = 0; y < 2 * T; y += 6) g.fillRect(lx - 14, y, 28, 0.8);
  }
};

/** SECOND EMPIRE, 1855-1885: Haussmann's Paris on Broadway — painted stone scored in courses, quoins at the bay lines, a belt course at every floor and segmental hoods on brackets over arched-head sash. The grand hotel and the department store of the 1870s. */
const W_SE: Win = { x0: 0.35, x1: 0.65, y0: 0.18, y1: 0.76 };
const secondEmpire = (c: RGB, quoin: RGB, win: Win = W_SE): Painter => (g, _w, _h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, 2 * T, 2 * T);
  relief(pc, 210);
  for (let i = 0; i < 160; i++) { g.fillStyle = rgb(c, 0.95 + rnd() * 0.08); g.globalAlpha = 0.4; g.fillRect(rnd() * 2 * T, rnd() * 2 * T, 10 + rnd() * 20, 3 + rnd() * 5); }
  g.globalAlpha = 1;
  // the scoring: paint over stone, the joints drawn with a rule
  for (let y = 0, r = 0; y < 2 * T; y += 18, r++) {
    g.fillStyle = rgb(c, 0.82); g.fillRect(0, y, 2 * T, 1);
    for (let x = (r % 2) * 24; x < 2 * T; x += 48) g.fillRect(x, y, 1, 18);
  }
  for (const b of bays(win)) {
    // the belt course at the floor, a cornice in small
    box(g, pc, rgb(c, 1.08), b.ox, b.oy + T - 10, T, 6, MK_TRIM, 255);
    box(g, pc, rgb(c, 0.7), b.ox, b.oy + T - 4, T, 1.6, null, 120);
    // a sunk panel under the sill
    line(g, pc, rgb(c, 0.74), 1.2, (q) => q.rect(b.x0 + 2, b.y1 + 8, b.w - 4, b.oy + T - 14 - b.y1 - 8), null, 160);
    // the segmental hood on its two brackets
    line(g, pc, rgb(c, 1.1), 6, (q) => { q.moveTo(b.x0 - 11, b.y0 - 1); q.quadraticCurveTo(b.cx, b.y0 - 26, b.x1 + 11, b.y0 - 1); }, MK_TRIM, 255);
    line(g, pc, rgb(c, 0.66), 1.4, (q) => { q.moveTo(b.x0 - 9, b.y0 + 3); q.quadraticCurveTo(b.cx, b.y0 - 21, b.x1 + 9, b.y0 + 3); }, null, 140);
    for (const x of [b.x0 - 13, b.x1 + 8]) { box(g, pc, rgb(c, 1.04), x, b.y0 - 1, 5, 12, MK_TRIM, 255); g.fillStyle = rgb(c, 0.7); g.fillRect(x, b.y0 + 9, 5, 1.5); }
  }
  quoins(g, pc, quoin, 16, 28, 18);
};

/** NEO-GREC, 1865-1890: the brownstone row that turned its back on the Italianate — smooth stone, every lintel an angular block incised with grooves and a stylised anthemion, the sills on chamfered brackets. Upper West Side, Park Slope. */
const W_NG: Win = { x0: 0.31, x1: 0.69, y0: 0.22, y1: 0.75 };
const neoGrec = (c: RGB, win: Win = W_NG): Painter => (g, _w, _h, rnd, pc) => {
  ashlar(g, pc, c, 26, 64, rnd, 0.05, 0.86);
  const cut = (x0: number, y0: number, x1: number, y1: number) => {
    // an incised line: a dark groove, a hairline of light below it
    g.strokeStyle = rgb(c, 0.5); g.lineWidth = 1.1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = rgb(c, 1.25); g.lineWidth = 0.6; g.beginPath(); g.moveTo(x0 + 0.6, y0 + 1); g.lineTo(x1 + 0.6, y1 + 1); g.stroke();
  };
  for (const b of bays(win)) {
    const st = rgb(c, 1.2), L = b.x0 - 14, R = b.x1 + 14;
    // the lintel: a flat block under a low angular cap, eared at the ends
    form(g, pc, st, (q) => { q.moveTo(L, b.y0 - 14); q.lineTo(b.cx, b.y0 - 23); q.lineTo(R, b.y0 - 14); q.lineTo(R, b.y0 + 6); q.lineTo(R - 6, b.y0 + 6); q.lineTo(R - 6, b.y0); q.lineTo(L + 6, b.y0); q.lineTo(L + 6, b.y0 + 6); q.lineTo(L, b.y0 + 6); q.closePath(); }, MK_TRIM, 255);
    box(g, pc, rgb(c, 0.62), L, b.y0 - 14, R - L, 1.3, null, 140);
    g.fillStyle = rgb(c, 0.55); g.fillRect(L, b.y0 + 6, 6, 2); g.fillRect(R - 6, b.y0 + 6, 6, 2);
    cut(L + 3, b.y0 - 6, R - 3, b.y0 - 6); cut(L + 3, b.y0 - 3, R - 3, b.y0 - 3);
    for (let k = -3; k <= 3; k++) cut(b.cx, b.y0 - 8, b.cx + k * 3.2, b.y0 - 17 + Math.abs(k) * 1.4);
    for (const x of [L + 6, R - 6]) { g.strokeStyle = rgb(c, 0.5); g.lineWidth = 1; g.beginPath(); g.arc(x, b.y0 - 9, 2.6, 0, 6.283); g.stroke(); }
    // the flat surround, a groove run down each jamb
    box(g, pc, rgb(c, 1.12), b.x0 - 6, b.y0, 6, b.h, MK_TRIM, 240); box(g, pc, rgb(c, 1.12), b.x1, b.y0, 6, b.h, MK_TRIM, 240);
    cut(b.x0 - 3, b.y0 + 3, b.x0 - 3, b.y1 - 2); cut(b.x1 + 3, b.y0 + 3, b.x1 + 3, b.y1 - 2);
    // the sill, on two chamfered brackets
    box(g, pc, st, b.x0 - 10, b.y1, b.w + 20, 6, MK_TRIM, 255);
    for (const x of [b.x0 - 8, b.x1 + 2]) form(g, pc, rgb(c, 1.02), (q) => { q.moveTo(x, b.y1 + 6); q.lineTo(x + 6, b.y1 + 6); q.lineTo(x + 6, b.y1 + 13); q.lineTo(x + 3, b.y1 + 16); q.closePath(); }, MK_TRIM, 255);
    cut(b.x0 - 6, b.y1 + 3, b.x1 + 6, b.y1 + 3);
  }
};

/** ZIGZAG MODERNE, 1925-1940: the brick setback tower dressed for the Jazz Age — tapestry brick piers, the windows stacked into vertical strips and every spandrel between them a terra-cotta panel of chevrons. The garment district, the Bronx apartment house. */
const W_ZIG: Win = { x0: 0.3, x1: 0.7, y0: 0.15, y1: 0.84 };
const zigzag = (brick: RGB, panel: RGB, chev: RGB, win: Win = W_ZIG): Painter => (g, _w, _h, rnd, pc) => {
  bricks(g, brick, rnd, { amp: 0.3, english: true, header: [brick[0] * 0.78, brick[1] * 0.74, brick[2] * 0.72] });
  relief(pc, 230);
  for (const b of bays(win)) {
    // the pier's edge: a soldier course turned up each reveal
    for (const x of [b.x0 - 7, b.x1 + 1]) { g.fillStyle = rgb(brick, 0.82); for (let y = b.oy; y < b.oy + T; y += 5) g.fillRect(x, y + 0.5, 6, 4); }
    // the spandrels: the panel above the head and the one below the sill
    for (const [y0, y1] of [[b.oy, b.y0], [b.y1, b.oy + T]]) {
      const x0 = b.x0 - 1, x1 = b.x1 + 1;
      box(g, pc, rgb(panel), x0, y0, x1 - x0, y1 - y0, null, 170);
      for (let row = 0, y = y0 + 3; y + 6 < y1; y += 7, row++) {
        line(g, pc, rgb(chev, row % 2 ? 1.0 : 0.82), 2.2, (q) => {
          q.moveTo(x0, y + 5);
          for (let x = x0, k = 0; x <= x1; x += 4.5, k++) q.lineTo(x, k % 2 ? y : y + 5);
        }, MK_ACC, 255);
      }
      box(g, pc, rgb(panel, 0.7), x0, y0, x1 - x0, 1.2, null, 120);
    }
  }
};

/** RENAISSANCE PALAZZO, 1885-1930: McKim, Mead & White's Florentine block — thin Roman brick or banded rustication, a dentilled string course at every sill, and each window an aedicule whose pediments alternate triangle and segment along the floor. The club, the bank, the Villard Houses. */
const W_PAL: Win = { x0: 0.33, x1: 0.67, y0: 0.22, y1: 0.7 };
const palazzo = (c: RGB, trim: RGB, banded: boolean, win: Win = W_PAL): Painter => (g, _w, _h, rnd, pc) => {
  if (banded) {
    g.fillStyle = rgb(c); g.fillRect(0, 0, 2 * T, 2 * T);
    relief(pc, 220);
    for (let y = 0; y < 2 * T; y += 13) {
      g.fillStyle = rgb(c, 0.96 + rnd() * 0.06); g.fillRect(0, y + 2, 2 * T, 11);
      box(g, pc, rgb(c, 0.6), 0, y, 2 * T, 2.2, null, 90);
    }
  } else {
    bricks(g, c, rnd, { bw: 30, bh: 4.3, amp: 0.14, mortar: rgb(c, 1.12) });
    relief(pc, 225);
  }
  const t = rgb(trim);
  for (const b of bays(win)) {
    // the string course with its dentils
    box(g, pc, t, b.ox, b.y1, T, 7, MK_TRIM, 255);
    box(g, pc, rgb(trim, 0.7), b.ox, b.y1 + 7, T, 1.5, null, 130);
    for (let x = b.ox + 1; x < b.ox + T; x += 5) box(g, pc, rgb(trim, 0.94), x, b.y1 + 8.5, 3, 3.5, MK_TRIM, 240);
    // the aedicule: pilaster strips, an entablature, and its pediment
    box(g, pc, t, b.x0 - 9, b.y0 - 4, 6, b.y1 - b.y0 + 4, MK_TRIM, 255); box(g, pc, t, b.x1 + 3, b.y0 - 4, 6, b.y1 - b.y0 + 4, MK_TRIM, 255);
    box(g, pc, t, b.x0 - 12, b.y0 - 10, b.w + 24, 6, MK_TRIM, 255);
    box(g, pc, rgb(trim, 0.68), b.x0 - 12, b.y0 - 4, b.w + 24, 1.2, null, 130);
    const L = b.x0 - 14, R = b.x1 + 14;
    if (b.bx === 0) form(g, pc, t, (q) => { q.moveTo(L, b.y0 - 10); q.lineTo(b.cx, b.y0 - 25); q.lineTo(R, b.y0 - 10); q.closePath(); }, MK_TRIM, 255);
    else form(g, pc, t, (q) => { q.moveTo(L, b.y0 - 10); q.quadraticCurveTo(b.cx, b.y0 - 34, R, b.y0 - 10); q.closePath(); }, MK_TRIM, 255);
    line(g, pc, rgb(trim, 0.72), 1, (q) => { if (b.bx === 0) { q.moveTo(L + 6, b.y0 - 11); q.lineTo(b.cx, b.y0 - 21); q.lineTo(R - 6, b.y0 - 11); } else { q.moveTo(L + 6, b.y0 - 11); q.quadraticCurveTo(b.cx, b.y0 - 29, R - 6, b.y0 - 11); } }, null, 160);
  }
};

// ============================================================================
// CIVIC & COLLEGIATE
// ============================================================================

/** GREEK REVIVAL, 1820-1860: the young republic's temple front on the row house, the bank and the custom house — a smooth white wall, broad antae pilasters two storeys tall under a plain entablature, six-over-six sash in eared architraves. */
const W_GR: Win = { x0: 0.34, x1: 0.66, y0: 0.22, y1: 0.72 };
const greekRevival = (c: RGB, pil: RGB, win: Win = W_GR, brick?: RGB): Painter => (g, _w, _h, rnd, pc) => {
  if (brick) { bricks(g, brick, rnd, { bw: 15, bh: 5, amp: 0.16, mortar: "#d8d0c0" }); relief(pc, 215); }
  else ashlar(g, pc, c, 24, 60, rnd, 0.03, 0.93);
  const p = rgb(pil);
  for (const b of bays(win)) {
    // the eared architrave behind the flat lintel the renderer lays on
    box(g, pc, p, b.x0 - 5, b.y0 - 4, b.w + 10, b.h + 4, MK_TRIM, 245);
    box(g, pc, p, b.x0 - 9, b.y0 - 4, b.w + 18, 9, MK_TRIM, 245);
    box(g, pc, rgb(pil, 0.74), b.x0 - 9, b.y0 + 5, 4, 1.2, null, 150); box(g, pc, rgb(pil, 0.74), b.x1 + 5, b.y0 + 5, 4, 1.2, null, 150);
  }
  // the entablature, once every two floors: cornice, frieze, architrave
  box(g, pc, rgb(pil, 1.06), 0, 0, 2 * T, 5, MK_TRIM, 255);
  box(g, pc, rgb(pil, 0.7), 0, 5, 2 * T, 1.5, null, 120);
  box(g, pc, p, 0, 6.5, 2 * T, 8, MK_TRIM, 235);
  box(g, pc, rgb(pil, 1.04), 0, 14.5, 2 * T, 4, MK_TRIM, 250);
  box(g, pc, rgb(pil, 0.72), 0, 18.5, 2 * T, 1.2, null, 130);
  // the antae: broad, flat, with a plain cap and base
  for (const lx of LINES) {
    box(g, pc, p, lx - 13, 20, 26, 2 * T - 20, MK_TRIM, 255);
    box(g, pc, rgb(pil, 0.8), lx + 11, 20, 2, 2 * T - 20, null, 200);
    box(g, pc, rgb(pil, 1.07), lx - 16, 20, 32, 6, MK_TRIM, 255);
    box(g, pc, rgb(pil, 0.74), lx - 16, 26, 32, 1.2, null, 150);
    box(g, pc, rgb(pil, 1.03), lx - 15, 2 * T - 7, 30, 7, MK_TRIM, 255);
  }
};

/** COLLEGIATE GOTHIC, 1895-1940: Princeton, Yale and every city college after them — clinker brick in English bond dressed with limestone: block jambs, label moulds, a Tudor arch cut into each stone-mullioned window and a carved shield over it. */
const W_COL: Win = { x0: 0.25, x1: 0.75, y0: 0.2, y1: 0.74 };
const collegiate = (brick: RGB, stone: RGB, allStone: boolean, win: Win = W_COL): Painter => (g, _w, _h, rnd, pc) => {
  if (allStone) ashlar(g, pc, brick, 14, 36, rnd, 0.1, 0.8);
  else { bricks(g, brick, rnd, { english: true, amp: 0.36, header: [brick[0] * 0.8, brick[1] * 0.78, brick[2] * 0.82] }); relief(pc, 210); }
  const s = rgb(stone);
  for (const b of bays(win)) {
    // block jambs: long and short stones up both sides
    for (let y = b.y0, k = 0; y < b.y1 - 2; y += 11, k++) {
      const wd = k % 2 ? 7 : 12, hh = Math.min(10, b.y1 - y);
      box(g, pc, rgb(stone, 0.96 + (k % 3) * 0.03), b.x0 - wd, y, wd, hh, MK_TRIM, 255);
      box(g, pc, rgb(stone, 0.96 + (k % 2) * 0.04), b.x1, y, wd, hh, MK_TRIM, 255);
    }
    box(g, pc, s, b.x0 - 11, b.y1, b.w + 22, 6, MK_TRIM, 255);
    box(g, pc, rgb(stone, 0.7), b.x0 - 11, b.y1 + 6, b.w + 22, 1.3, null, 130);
    // the label mould and its drops
    box(g, pc, s, b.x0 - 13, b.y0 - 9, b.w + 26, 5, MK_TRIM, 255);
    box(g, pc, s, b.x0 - 13, b.y0 - 9, 5, 15, MK_TRIM, 255); box(g, pc, s, b.x1 + 8, b.y0 - 9, 5, 15, MK_TRIM, 255);
    box(g, pc, rgb(stone, 0.66), b.x0 - 8, b.y0 - 4, b.w + 16, 1.2, null, 120);
    // a shield in the wall over the window, on the upper floor of the pair
    if (b.by === 0) form(g, pc, s, (q) => { const y = b.oy + 4, cx = b.cx; q.moveTo(cx - 8, y); q.lineTo(cx + 8, y); q.lineTo(cx + 8, y + 8); q.quadraticCurveTo(cx + 7, y + 15, cx, y + 18); q.quadraticCurveTo(cx - 7, y + 15, cx - 8, y + 8); q.closePath(); }, MK_TRIM, 255);
    if (b.by === 0) { g.fillStyle = rgb(stone, 0.7); g.fillRect(b.cx - 1, b.oy + 6, 2, 12); g.fillRect(b.cx - 6, b.oy + 9, 12, 2); }
  }
};
/** The Tudor arch: stone spandrels cut into the top corners of each opening (drawn over the glass). */
const tudorHeads = (stone: RGB, win: Win = W_COL): Painter => (g, _w, _h, _rnd, pc) => {
  for (const b of bays(win)) for (const s of [-1, 1]) {
    const x = s < 0 ? b.x0 : b.x1, run = b.w * 0.42, drop = 15;
    const path = (q: CanvasRenderingContext2D) => { q.moveTo(x, b.y0 - 1); q.lineTo(x, b.y0 + drop); q.quadraticCurveTo(x - s * 1, b.y0 + 2, x - s * run, b.y0 - 1); q.closePath(); };
    form(g, pc, rgb(stone), path, MK_TRIM, 255);
    line(g, pc, rgb(stone, 0.55), 1.4, (q) => { q.moveTo(x, b.y0 + drop); q.quadraticCurveTo(x - s * 1, b.y0 + 2, x - s * run, b.y0 - 1); });
  }
};

/** FEDERAL, 1785-1830: the Adam style of Bulfinch's Boston and the first New York rows — fine salmon brick in thin white joints, the principal windows set in blind arches with a fanlight in the tympanum, the others under splayed marble lintels. */
const W_FED: Win = { x0: 0.35, x1: 0.65, y0: 0.22, y1: 0.72 };
const federal = (brick: RGB, stone: RGB, win: Win = W_FED): Painter => (g, _w, _h, rnd, pc) => {
  bricks(g, brick, rnd, { bw: 14, bh: 5, amp: 0.14, mortar: "#e2dccf" });
  relief(pc, 220);
  const s = rgb(stone);
  for (const b of bays(win)) {
    box(g, pc, s, b.x0 - 4, b.y1, b.w + 8, 4, MK_TRIM, 255);
    if (b.by === 0) {
      // the blind arch: the brick set back round the window, a fan over it
      const R = b.w / 2 + 8;
      form(g, pc, "rgba(50,22,12,0.28)", (q) => { q.moveTo(b.x0 - 8, b.y1); q.lineTo(b.x0 - 8, b.y0); q.arc(b.cx, b.y0, R, Math.PI, 0); q.lineTo(b.x1 + 8, b.y1); q.closePath(); }, null, 150);
      form(g, pc, s, (q) => { q.moveTo(b.x0, b.y0); q.arc(b.cx, b.y0, b.w / 2, Math.PI, 0); q.closePath(); }, MK_TRIM, 235);
      g.strokeStyle = rgb(stone, 0.5); g.lineWidth = 1;
      for (let k = 1; k < 10; k++) { const a = Math.PI + (k * Math.PI) / 10; g.beginPath(); g.moveTo(b.cx + Math.cos(a) * 5, b.y0 + Math.sin(a) * 5); g.lineTo(b.cx + Math.cos(a) * (b.w / 2 - 2), b.y0 + Math.sin(a) * (b.w / 2 - 2)); g.stroke(); }
      g.beginPath(); g.arc(b.cx, b.y0, b.w / 2 - 2, Math.PI, 0); g.stroke();
      g.beginPath(); g.arc(b.cx, b.y0, 5, Math.PI, 0); g.stroke();
      // the arch's brick ring
      line(g, pc, rgb(brick, 1.08), 3, (q) => q.arc(b.cx, b.y0, R - 1.5, Math.PI, 0), null, 240);
    } else {
      // the splayed lintel, a sunk tablet at its centre
      form(g, pc, s, (q) => { q.moveTo(b.x0 - 9, b.y0 - 12); q.lineTo(b.x1 + 9, b.y0 - 12); q.lineTo(b.x1 + 3, b.y0); q.lineTo(b.x0 - 3, b.y0); q.closePath(); }, MK_TRIM, 255);
      line(g, pc, rgb(stone, 0.68), 1, (q) => q.rect(b.cx - 8, b.y0 - 9, 16, 6), null, 180);
    }
  }
};

/** PWA MODERNE, 1933-1943: the New Deal's post office, courthouse and school — stripped classical limestone, fluted piers without capitals, tall bronze sash, and in every spandrel a carved panel of eagle wings and fasces. */
const W_PWA: Win = { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.92 };
const pwa = (c: RGB, win: Win = W_PWA): Painter => (g, _w, _h, rnd, pc) => {
  ashlar(g, pc, c, 32, 64, rnd, 0.05, 0.86);
  for (const b of bays(win)) {
    // the relief panel under the sill
    const x0 = b.x0 + 2, x1 = b.x1 - 2, y0 = b.y1 + 5, y1 = b.oy + T - 5, cx = (x0 + x1) / 2;
    box(g, pc, rgb(c, 0.8), x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4, null, 110);
    box(g, pc, rgb(c, 0.96), x0, y0, x1 - x0, y1 - y0, null, 150);
    const carve = (draw: (q: CanvasRenderingContext2D) => void) => {
      g.save(); g.translate(1, 1); form(g, undefined, rgb(c, 0.68), draw); g.restore();
      form(g, pc, rgb(c, 1.12), draw, null, 255);
    };
    // the fasces: a bundle of rods, bound twice
    carve((q) => q.rect(cx - 3.5, y0 + 3, 7, y1 - y0 - 6));
    g.fillStyle = rgb(c, 0.8); g.fillRect(cx - 1, y0 + 4, 0.8, y1 - y0 - 8); g.fillRect(cx + 1.4, y0 + 4, 0.8, y1 - y0 - 8);
    g.fillRect(cx - 4, y0 + 7, 8, 1.2); g.fillRect(cx - 4, y1 - 9, 8, 1.2);
    // the wings: stepped feathers, longest at the top
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
      const len = (x1 - x0) / 2 - 8 - k * 6, y = y0 + 4 + k * 6;
      carve((q) => q.rect(s < 0 ? cx - 5 - len : cx + 5, y, len, 3.5));
    }
  }
  // the fluted piers, no capital, no base: the order stripped to its shaft
  for (const lx of LINES) {
    box(g, pc, rgb(c, 1.05), lx - 19, 0, 38, 2 * T, null, 255);
    for (let x = lx - 16; x < lx + 16; x += 4.5) {
      g.fillStyle = rgb(c, 0.68); g.fillRect(x, 0, 2, 2 * T);
      g.fillStyle = rgb(c, 1.14); g.fillRect(x + 2, 0, 0.8, 2 * T);
      if (pc) { pc.hg.fillStyle = grey(190); pc.hg.fillRect(x, 0, 2, 2 * T); }
    }
    g.fillStyle = rgb(c, 0.62); g.fillRect(lx + 18, 0, 1.5, 2 * T); g.fillRect(lx - 19, 0, 1, 2 * T);
  }
};

/** STRIPPED CLASSICISM, 1930-1955: the federal building, the state office and the Federal Reserve branch — polished granite, square-headed piers with neither base nor capital, punched windows in deep reveals over sunk spandrel panels. */
const W_STR: Win = { x0: 0.31, x1: 0.69, y0: 0.22, y1: 0.8 };
const stripped = (c: RGB, win: Win = W_STR): Painter => (g, _w, _h, rnd, pc) => {
  ashlar(g, pc, c, 32, 96, rnd, 0.06, 0.82);
  speckle(g, rnd, 1600, rgb(c, 0.74), rgb(c, 1.14));
  for (const b of bays(win)) {
    // the reveal, deep: shadow on the head and the left jamb
    box(g, pc, rgb(c, 0.5), b.x0 - 5, b.y0 - 5, b.w + 5, 5, null, 90);
    box(g, pc, rgb(c, 0.5), b.x0 - 5, b.y0 - 5, 5, b.h + 5, null, 90);
    box(g, pc, rgb(c, 1.12), b.x1, b.y0 - 5, 2, b.h + 5, null, 255);
    // the sunk spandrel panel
    line(g, pc, rgb(c, 0.62), 1.6, (q) => q.rect(b.x0 + 3, b.y1 + 8, b.w - 6, b.oy + T - b.y1 - 14), null, 120);
  }
  // the piers: plain, proud, square-headed under a flat block
  for (const lx of LINES) {
    box(g, pc, rgb(c, 1.07), lx - 18, 0, 36, 2 * T, null, 255);
    g.fillStyle = rgb(c, 0.5); g.fillRect(lx - 20, 0, 2, 2 * T); g.fillStyle = rgb(c, 1.2); g.fillRect(lx + 18, 0, 1.4, 2 * T);
    for (let by = 0; by < 2; by++) {
      box(g, pc, rgb(c, 1.12), lx - 22, by * T, 44, 9, null, 255);
      g.fillStyle = rgb(c, 0.55); g.fillRect(lx - 22, by * T + 9, 44, 1.5);
    }
  }
  speckle(g, rnd, 500, rgb(c, 0.78), rgb(c, 1.12));
};

/** BANK TEMPLE, 1895-1930: the main-street savings bank as a Roman temple — granite, a giant order of fluted columns two storeys tall, and between them one tall opening of bronze sash broken only by a bronze spandrel. */
const W_BANK: Win = { x0: 0.27, x1: 0.73, y0: 0.02, y1: 0.86 };
const bank = (c: RGB, bronze: RGB, win: Win = W_BANK): Painter => (g, _w, _h, rnd, pc) => {
  ashlar(g, pc, c, 20, 80, rnd, 0.05, 0.86);
  const [top, bot] = [bays(win)[0], bays(win)[2]];
  for (const b of [top]) for (const ox of [0, T]) {
    // the bronze spandrel between the two lights of the opening
    const x0 = ox + win.x0 * T, x1 = ox + win.x1 * T;
    box(g, pc, rgb(bronze), x0, b.y1, x1 - x0, bot.y0 - b.y1, MK_ACC, 180);
    g.fillStyle = rgb(bronze, 1.3); for (let x = x0 + 4; x < x1 - 3; x += (x1 - x0 - 8) / 4) g.fillRect(x, b.y1 + 3, 1, bot.y0 - b.y1 - 6);
    g.fillStyle = rgb(bronze, 0.6); g.fillRect(x0, b.y1 + 1, x1 - x0, 1.5);
  }
  // the entablature over the order, with dentils
  box(g, pc, rgb(c, 1.08), 0, 0, 2 * T, 12, null, 255);
  g.fillStyle = rgb(c, 0.7); for (let x = 0; x < 2 * T; x += 5) g.fillRect(x, 6, 3, 3);
  box(g, pc, rgb(c, 0.64), 0, 12, 2 * T, 1.6, null, 120);
  // the giant columns
  for (const lx of LINES) {
    shaft(g, pc, c, lx - 12, 24, 26, 2 * T - 9, 7);
    capital(g, pc, c, lx, 24, 14);
    g.fillStyle = rgb(c, 0.9); g.fillRect(lx - 14, 22, 28, 4);
    box(g, pc, rgb(c, 1.05), lx - 15, 2 * T - 9, 30, 4, null, 255);
    box(g, pc, rgb(c, 0.95), lx - 16, 2 * T - 5, 32, 5, null, 255);
  }
};

/** GEORGIAN SCHOOL, 1910-1950: the city's public school and branch library — red brick with limestone belt courses at every head and sill, a soldier course over the windows, big triple sash for the classroom light, a stone diamond set in each spandrel. */
const W_SCH: Win = { x0: 0.15, x1: 0.85, y0: 0.24, y1: 0.76 };
const schoolBrick = (brick: RGB, stone: RGB, win: Win = W_SCH): Painter => (g, _w, _h, rnd, pc) => {
  bricks(g, brick, rnd, { amp: 0.18 });
  relief(pc, 215);
  const s = rgb(stone);
  for (const b of bays(win)) {
    if (b.bx) continue;
    // soldier course, head band and sill band, the width of the wall
    for (let x = 0; x < 2 * T; x += 4.5) { g.fillStyle = rgb(brick, 0.8 + ((x * 7) % 5) / 25); g.fillRect(x + 0.5, b.y0 - 21, 3.6, 11); }
    box(g, pc, s, 0, b.y0 - 9, 2 * T, 9, MK_TRIM, 255);
    box(g, pc, rgb(stone, 0.68), 0, b.y0, 2 * T, 1.2, null, 130);
    box(g, pc, s, 0, b.y1, 2 * T, 6, MK_TRIM, 255);
    box(g, pc, rgb(stone, 0.68), 0, b.y1 + 6, 2 * T, 1.2, null, 130);
  }
  for (const b of bays(win)) {
    const cy = (b.y1 + 7 + b.oy + T) / 2;
    form(g, pc, s, (q) => { q.moveTo(b.cx, cy - 8); q.lineTo(b.cx + 10, cy); q.lineTo(b.cx, cy + 8); q.lineTo(b.cx - 10, cy); q.closePath(); }, MK_TRIM, 255);
    box(g, pc, s, b.cx - 22, cy - 1, 8, 2, MK_TRIM, 240); box(g, pc, s, b.cx + 14, cy - 1, 8, 2, MK_TRIM, 240);
  }
};

/** NEW FORMALISM, 1958-1975: Lincoln Center, Stone's embassies, Yamasaki's arcades — the modern civic building returned to the colonnade: white travertine arches on slender columns two storeys tall, dark glass behind. */
const W_NF: Win = { x0: 0.05, x1: 0.95, y0: 0.03, y1: 0.97 };
const nfBack: Painter = (g, w, h, _rnd, pc) => {
  g.fillStyle = "#3a3d40"; g.fillRect(0, 0, w, h);
  relief(pc, 60);
};
const arcade = (c: RGB, kind: "round" | "pointed" | "square" | "grille"): Painter => (g, _w, h, rnd, pc) => {
  const col = rgb(c);
  for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T, a = ox + 11, b = ox + T - 11, cx = ox + T / 2, half = (b - a) / 2;
    const open = (q: CanvasRenderingContext2D) => {
      if (kind === "round") { q.moveTo(a, h); q.lineTo(a, 16 + half); q.arc(cx, 16 + half, half, Math.PI, 0); q.lineTo(b, h); q.closePath(); }
      else if (kind === "pointed") { q.moveTo(a, h); q.lineTo(a, 96); q.quadraticCurveTo(a, 30, cx, 12); q.quadraticCurveTo(b, 30, b, 96); q.lineTo(b, h); q.closePath(); }
      else q.rect(a, 18, b - a, h - 18);
    };
    const pierce = (q: CanvasRenderingContext2D) => { q.rect(ox, 0, T, h); open(q); };
    g.fillStyle = col; g.beginPath(); pierce(g); g.fill("evenodd");
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.beginPath(); pierce(pc.hg); pc.hg.fill("evenodd"); }
    // the soffit and the column's shaded flank, so the arcade stands proud
    g.strokeStyle = rgb(c, 0.66); g.lineWidth = 2.5; g.beginPath(); open(g); g.stroke();
    if (kind === "grille") {
      // Stone's pierced screen: a lattice of white over the glass
      for (const q of pc ? [g, pc.hg] : [g]) {
        q.strokeStyle = q === g ? col : "#ffffff"; q.lineWidth = 3.2;
        q.beginPath();
        for (let y = 18; y < h; y += 14) for (let x = a; x < b; x += 14) { q.moveTo(x + 7, y); q.lineTo(x + 14, y + 7); q.lineTo(x + 7, y + 14); q.lineTo(x, y + 7); q.closePath(); }
        q.stroke();
      }
    }
  }
  // travertine: a faint pitting on the white
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(120,110,90,${rnd() * 0.12})`; const x = rnd() * 2 * T, y = rnd() * h; if ((x % T) < 11 || (x % T) > T - 11 || y < 16) g.fillRect(x, y, 2 + rnd() * 3, 1); }
};

/** EDWARDIAN BAROQUE, 1895-1915: the town hall and the railway office as Wren would have built them — bright red brick banded with Portland stone ("blood and bandages"), Gibbs surrounds of blocked jambs, a great keystone on every window. */
const W_ED: Win = { x0: 0.34, x1: 0.66, y0: 0.22, y1: 0.73 };
const edwardian = (brick: RGB, stone: RGB, win: Win = W_ED): Painter => (g, _w, _h, rnd, pc) => {
  bricks(g, brick, rnd, { amp: 0.14, mortar: "#cfc6b8" });
  relief(pc, 210);
  for (let y = 4; y < 2 * T; y += 24) {
    box(g, pc, rgb(stone, 0.98 + rnd() * 0.04), 0, y, 2 * T, 8, null, 240);
    g.fillStyle = rgb(stone, 0.8); for (let x = rnd() * 40; x < 2 * T; x += 44) g.fillRect(x, y, 1, 8);
  }
  const s = rgb(stone);
  for (const b of bays(win)) {
    // the Gibbs surround: blocks alternately long and short down both jambs
    for (let k = 0, y = b.y0; k < 5; k++, y += b.h / 5) {
      const wd = k % 2 ? 6 : 13;
      box(g, pc, rgb(stone, 1.02), b.x0 - wd, y + 0.8, wd, b.h / 5 - 1.6, MK_TRIM, 255);
      box(g, pc, rgb(stone, 1.02), b.x1, y + 0.8, wd, b.h / 5 - 1.6, MK_TRIM, 255);
    }
    // the head: voussoirs and a great keystone, a sill on blocks
    box(g, pc, s, b.x0 - 13, b.y0 - 11, b.w + 26, 11, MK_TRIM, 255);
    g.fillStyle = rgb(stone, 0.72); for (let k = 1; k < 6; k++) g.fillRect(b.x0 - 13 + (k * (b.w + 26)) / 6, b.y0 - 11, 1, 11);
    form(g, pc, rgb(stone, 1.06), (q) => { q.moveTo(b.cx - 5, b.y0 + 4); q.lineTo(b.cx + 5, b.y0 + 4); q.lineTo(b.cx + 8, b.y0 - 22); q.lineTo(b.cx - 8, b.y0 - 22); q.closePath(); }, MK_TRIM, 255);
    g.fillStyle = rgb(stone, 0.66); g.fillRect(b.cx + 7, b.y0 - 22, 1.5, 26);
    box(g, pc, s, b.x0 - 15, b.y1, b.w + 30, 6, MK_TRIM, 255);
    box(g, pc, rgb(stone, 0.65), b.x0 - 15, b.y1 + 6, b.w + 30, 1.3, null, 130);
  }
};

/** NEO-GEORGIAN, 1915-1960: the hospital, the college dormitory and the good apartment house — dark red brick, white twelve-light sash under flat arches of rubbed orange brick, stone quoins at the bay lines and a stone band at every floor. */
const W_NGEO: Win = { x0: 0.32, x1: 0.68, y0: 0.2, y1: 0.76 };
const neoGeorgian = (brick: RGB, stone: RGB, rubbed: RGB, win: Win = W_NGEO): Painter => (g, _w, _h, rnd, pc) => {
  bricks(g, brick, rnd, { amp: 0.26, mortar: "#bdb2a2" });
  relief(pc, 215);
  for (const b of bays(win)) {
    // the floor band
    box(g, pc, rgb(stone), b.ox, b.oy + T - 7, T, 7, MK_TRIM, 255);
    box(g, pc, rgb(stone, 0.68), b.ox, b.oy + T - 7, T, 1.2, null, 140);
    // the flat arch in rubbed brick, splayed, its joints radiating
    const path = (q: CanvasRenderingContext2D) => { q.moveTo(b.x0 - 8, b.y0 - 13); q.lineTo(b.x1 + 8, b.y0 - 13); q.lineTo(b.x1 + 2, b.y0); q.lineTo(b.x0 - 2, b.y0); q.closePath(); };
    form(g, pc, rgb(rubbed), path, null, 245);
    g.save(); g.beginPath(); path(g); g.clip(); g.strokeStyle = rgb(rubbed, 0.74); g.lineWidth = 0.8;
    for (let k = -8; k <= 8; k++) { g.beginPath(); g.moveTo(b.cx + k * 0.9, b.y0 + 30); g.lineTo(b.cx + k * 5.2, b.y0 - 16); g.stroke(); }
    g.restore();
    box(g, pc, rgb(stone), b.x0 - 4, b.y1, b.w + 8, 5, MK_TRIM, 255);
  }
  quoins(g, pc, stone, 14, 26, 16);
};

/** CASTELLATED ARMORY, 1875-1915: the National Guard's brick fortress on the avenue — buttresses with stone set-offs, slit windows in stone surrounds, a battlemented parapet on a corbel table running round at every second floor. */
const W_ARM: Win = { x0: 0.43, x1: 0.57, y0: 0.26, y1: 0.74 };
const armory = (brick: RGB, stone: RGB, win: Win = W_ARM): Painter => (g, _w, _h, rnd, pc) => {
  bricks(g, brick, rnd, { amp: 0.32, mortar: "#8e8478" });
  relief(pc, 200);
  const s = rgb(stone);
  for (const b of bays(win)) {
    // the slit's stone surround and sill
    box(g, pc, s, b.x0 - 5, b.y0 - 7, b.w + 10, b.h + 7, MK_TRIM, 245);
    box(g, pc, rgb(stone, 0.8), b.x0 - 5, b.y0 + b.h * 0.5, b.w + 10, 1, null, 200);
    box(g, pc, s, b.x0 - 9, b.y1, b.w + 18, 6, MK_TRIM, 255);
    box(g, pc, rgb(stone, 0.6), b.x0 - 9, b.y1 + 6, b.w + 18, 1.5, null, 120);
  }
  // the battlements and corbel table, every second floor
  box(g, pc, s, 0, 0, 2 * T, 4, MK_TRIM, 255);
  for (let x = 0; x < 2 * T; x += 32) {
    box(g, pc, rgb(brick, 0.34), x + 20, 4, 12, 13, null, 70);
    box(g, pc, s, x + 18, 2, 16, 3, MK_TRIM, 255);
  }
  box(g, pc, s, 0, 17, 2 * T, 4, MK_TRIM, 255);
  for (let x = 0; x < 2 * T; x += 8) {
    box(g, pc, rgb(stone, 0.97), x + 1, 21, 5, 7, MK_TRIM, 255);
    box(g, pc, rgb(brick, 0.42), x + 6, 21, 3, 6, null, 90);
  }
  // the buttresses at the bay lines, weathered back in stone halfway up each floor
  for (const lx of LINES) for (let by = 0; by < 2; by++) {
    const oy = by * T, ys = oy + T * 0.5;
    const y0 = by ? oy : 28;
    g.fillStyle = rgb(brick, 1.08); g.fillRect(lx - 15, y0, 30, oy + T - y0);
    g.fillStyle = rgb(brick, 0.62); g.fillRect(lx + 13, y0, 2, oy + T - y0);
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(lx - 15, y0, 30, oy + T - y0); }
    form(g, pc, s, (q) => { q.moveTo(lx - 16, ys + 7); q.lineTo(lx - 16, ys + 2); q.lineTo(lx + 16, ys - 4); q.lineTo(lx + 16, ys + 7); q.closePath(); }, MK_TRIM, 255);
    g.fillStyle = rgb(stone, 0.6); g.fillRect(lx - 16, ys + 7, 32, 1.5);
  }
};

/** EGYPTIAN REVIVAL, 1830-1935: the Tombs, the reservoir, the Masonic lodge and the cemetery gate — sandstone, battered surrounds wider at the foot than the head, papyrus columns two storeys tall and a cavetto cornice carrying the winged sun. */
const W_EGY: Win = { x0: 0.37, x1: 0.63, y0: 0.22, y1: 0.7 };
const egyptian = (c: RGB, paint: RGB, win: Win = W_EGY): Painter => (g, _w, _h, rnd, pc) => {
  ashlar(g, pc, c, 22, 70, rnd, 0.08, 0.82);
  const st = rgb(c, 1.08);
  const wingedSun = (cx: number, cy: number, span: number) => {
    form(g, pc, rgb(paint), (q) => { q.moveTo(cx - 4, cy - 1); q.lineTo(cx - span, cy - 3); q.lineTo(cx - span + 3, cy + 1.5); q.lineTo(cx - 4, cy + 2.5); q.closePath(); q.moveTo(cx + 4, cy - 1); q.lineTo(cx + span, cy - 3); q.lineTo(cx + span - 3, cy + 1.5); q.lineTo(cx + 4, cy + 2.5); q.closePath(); }, MK_ACC, 255);
    form(g, pc, rgb([214, 168, 70]), (q) => q.arc(cx, cy, 3.6, 0, 6.283), MK_TRIM, 255);
  };
  for (const b of bays(win)) {
    // the battered surround: the jambs lean in toward the head
    form(g, pc, st, (q) => { q.moveTo(b.x0 - 8, b.y0 - 4); q.lineTo(b.x1 + 8, b.y0 - 4); q.lineTo(b.x1 + 14, b.y1 + 5); q.lineTo(b.x0 - 14, b.y1 + 5); q.closePath(); }, null, 250);
    line(g, pc, rgb(c, 0.66), 1.2, (q) => { q.moveTo(b.x0 - 8, b.y0 - 4); q.lineTo(b.x0 - 14, b.y1 + 5); q.moveTo(b.x1 + 8, b.y0 - 4); q.lineTo(b.x1 + 14, b.y1 + 5); });
    // a small cavetto over it, flaring out, reeded
    form(g, pc, rgb(c, 1.12), (q) => { q.moveTo(b.x0 - 9, b.y0 - 5); q.lineTo(b.x1 + 9, b.y0 - 5); q.lineTo(b.x1 + 14, b.y0 - 17); q.lineTo(b.x0 - 14, b.y0 - 17); q.closePath(); }, null, 255);
    g.fillStyle = rgb(c, 0.72); for (let x = b.x0 - 12; x < b.x1 + 12; x += 4) g.fillRect(x, b.y0 - 16, 1, 9);
    box(g, pc, rgb(c, 0.6), b.x0 - 9, b.y0 - 6, b.w + 18, 1.5, null, 140);
    if (b.by === 1) wingedSun(b.cx, b.y0 - 11, 13);
  }
  // the cavetto cornice: the gorge in shadow under a lit flare, reeded, on a torus roll
  const gr = g.createLinearGradient(0, 0, 0, 18);
  gr.addColorStop(0, rgb(c, 1.2)); gr.addColorStop(0.5, rgb(c, 0.98)); gr.addColorStop(1, rgb(c, 0.62));
  g.fillStyle = gr; g.fillRect(0, 0, 2 * T, 18);
  if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(0, 0, 2 * T, 22); }
  g.fillStyle = rgb(c, 0.66); for (let x = 2; x < 2 * T; x += 5) g.fillRect(x, 3, 1.2, 13);
  box(g, pc, rgb(c, 1.14), 0, 18, 2 * T, 2.5, null, 255);
  box(g, pc, rgb(c, 0.6), 0, 20.5, 2 * T, 1.5, null, 130);
  for (const x of [T / 2, T * 1.5]) wingedSun(x, 9, 22);
  // the papyrus columns: bundled stems, tied under a flared bud capital
  for (const lx of LINES) {
    shaft(g, pc, c, lx - 11, 22, 44, 2 * T - 6, 5);
    for (let k = 0; k < 4; k++) box(g, pc, rgb(paint, 0.9), lx - 11, 44 + k * 3, 22, 1.6, MK_ACC, 255);
    form(g, pc, rgb(c, 1.06), (q) => { q.moveTo(lx - 11, 44); q.quadraticCurveTo(lx - 22, 34, lx - 21, 26); q.lineTo(lx + 21, 26); q.quadraticCurveTo(lx + 22, 34, lx + 11, 44); q.closePath(); }, null, 255);
    g.strokeStyle = rgb(paint); g.lineWidth = 1.3;
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(lx + k * 2, 43); g.lineTo(lx + k * 6, 27); g.stroke(); }
    box(g, pc, rgb(c, 1.1), lx - 16, 22, 32, 4, null, 255);
    box(g, pc, rgb(c, 0.98), lx - 14, 2 * T - 6, 28, 6, null, 255);
  }
};

// ---- the paints ---------------------------------------------------------------
const WHITE = "#f1ede4", CREAM = "#e8dcc2", IVORY = "#efe6d0", STONE = "#d6ccb6", GREY = "#9a9c98", BLACK = "#222324",
  CHARCOAL = "#3a3c3e", FOREST = "#2f4a3a", HUNTER = "#3d5a40", OXBLOOD = "#5c2622", NAVY = "#25324a", BRONZE = "#5a4630",
  BROWN = "#5a3e2c", SAGE = "#b8c6a4", TEAL = "#2f6a6a", GOLD = "#c9a23a", VERDIGRIS = "#4a6a5c", SILVER = "#c4c8cc";

export const BOOK_ORNAMENT: BookEntry[] = [
  // ---------------------------------------------------------------- ornament
  {
    key: "beauxarts", like: "stone",
    spec: { bayW: 3.2, floorH: 4.2, masonry: true, glass: false, win: W_BEAUX, wall: beauxArts([214, 206, 188]), lintel: "keystone",
      glassCol: "#34495a", frameCol: "#26282a", wallRough: 0.78, glassRough: 0.08, glassMetal: 0.1, trim: "#ece4d0", mullions: [2, 3], reveal: 4.2 },
    variants: [
      { wall: beauxArts([234, 230, 220]), trim: "#f4f0e6", frameCol: "#1e2226" },
      { wall: beauxArts([206, 184, 150]), winStyle: "arch", trim: "#e2d2b4" },
      { wall: beauxArts([170, 168, 162]), lintel: "pediment", trim: "#dcd8d0", frameCol: "#3a3026" },
    ],
    tints: [[1, 1, 1], [0.97, 0.95, 0.92], [1.02, 1.0, 0.97]],
    picker: { group: "ornament", name: "Grand Beaux-Arts", era: "1890-1925", maxFloors: 30, variants: ["Limestone, paired columns", "White marble", "Sandstone, arched", "Granite, pedimented"] },
    city: [
      { share: 0.14, from: 1890, to: 1925, minH: 14, cls: ["office"] },
      { share: 0.12, from: 1898, to: 1930, minH: 40, cls: ["multifamily"] },
    ],
  },
  {
    key: "chateau", like: "stone",
    spec: { bayW: 2.9, floorH: 4.0, masonry: true, glass: false, win: W_CHATEAU, wall: chateau([222, 214, 196]), lintel: "none",
      glassCol: "#2f3f4a", frameCol: "#d6ccb6", wallRough: 0.8, glassRough: 0.08, glassMetal: 0.05, trim: "#e6dcc6", mullions: [2, 2], reveal: 4.0 },
    variants: [
      { wall: chateau([194, 192, 186]), trim: "#d4d2cc", frameCol: "#cfccc4" },
      { wall: chateau([214, 196, 160]), winStyle: "segment", trim: "#e2d0ac" },
      { wall: chateau([168, 108, 86]), trim: "#b47a62", frameCol: "#e4d8c4" },
    ],
    tints: [[1, 1, 1], [0.97, 0.96, 0.94], [1.02, 1.0, 0.96]],
    style: "victorian",
    picker: { group: "ornament", name: "Châteauesque", era: "1885-1930", maxFloors: 16, variants: ["Limestone, gablets", "Grey limestone", "Buff, segmental", "Red sandstone"] },
    city: [
      { share: 0.08, from: 1885, to: 1930, minH: 14, maxH: 58, cls: ["office"] },
      { share: 0.14, from: 1890, to: 1930, minH: 40, maxH: 58, cls: ["multifamily"] },
    ],
  },
  {
    key: "venetian", like: "gothic",
    spec: { bayW: 2.8, floorH: 3.9, masonry: true, glass: false, win: W_VEN, wall: venetian([170, 78, 60], [232, 220, 192]), winStyle: "pointed",
      glassCol: "#2f3e48", frameCol: "#e6dccb", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.0, mullions: [2, 3], reveal: 3.6 },
    variants: [
      { wall: venetian([196, 120, 100], [238, 230, 212]), frameCol: "#2a2a2a" },
      { wall: venetian([150, 64, 52], [120, 132, 118]), frameCol: "#e2dccc" },
      { wall: venetian([214, 196, 160], [168, 82, 62]), frameCol: "#2e2a26" },
    ],
    tints: [[1, 1, 1], [0.94, 0.9, 0.88], [1.03, 1.0, 0.96]],
    palette: P(0, [], 0.25, [CREAM, STONE, IVORY], 0.7, [BLACK, OXBLOOD, FOREST, BROWN, CREAM]),
    picker: { group: "ornament", name: "Venetian Gothic", era: "1860-1890", maxFloors: 8, variants: ["Red and cream", "Rose and white", "Red and green stone", "Buff and red"] },
    city: [{ share: 0.25, from: 1860, to: 1890, maxH: 29 }],
  },
  {
    key: "sullivanesque", like: "terracotta",
    spec: { bayW: 4.2, floorH: 3.8, masonry: true, glass: false, win: W_SULL, wall: sullivan([150, 82, 60], [168, 86, 62], [176, 102, 74]),
      glassCol: "#304452", frameCol: "#2e2a26", wallRough: 0.6, glassRough: 0.08, glassMetal: 0.1, mullions: [1, 2], reveal: 3.4 },
    variants: [
      { wall: sullivan([196, 168, 128], [222, 198, 160], [214, 186, 146]), frameCol: "#2a2a28" },
      { wall: sullivan([218, 210, 192], [236, 230, 216], [210, 198, 170]), winStyle: "arch", frameCol: "#3a3a36" },
      { wall: sullivan([84, 110, 92], [196, 186, 160], [110, 140, 116]), frameCol: "#2a2e2a" },
    ],
    tints: [[1, 1, 1], [0.95, 0.92, 0.9], [1.03, 1.0, 0.95]],
    palette: P(0, [], 0.15, [CREAM, STONE, "#c89a7a"], 0.7, [BLACK, BRONZE, CHARCOAL, FOREST, WHITE]),
    picker: { group: "ornament", name: "Sullivanesque", era: "1890-1915", maxFloors: 20, variants: ["Red, foliate spandrels", "Buff terra cotta", "Cream, arched", "Green-glazed"] },
    city: [{ share: 0.22, from: 1890, to: 1915, maxH: 72 }],
  },
  {
    key: "secondempire", like: "stone",
    spec: { bayW: 2.8, floorH: 4.0, masonry: true, glass: false, win: W_SE, wall: secondEmpire([226, 216, 194], [238, 232, 216]), winStyle: "segment",
      glassCol: "#34444e", frameCol: "#2a2a28", wallRough: 0.7, glassRough: 0.1, glassMetal: 0.0, trim: "#ece4d2", mullions: [1, 2], reveal: 3.4 },
    variants: [
      { wall: secondEmpire([206, 206, 200], [226, 226, 220]), winStyle: "arch", trim: "#e2e2dc", frameCol: "#f0ece2" },
      { wall: secondEmpire([214, 196, 160], [236, 224, 196]), winStyle: "rect", lintel: "pediment", trim: "#f0e6d0" },
      { wall: secondEmpire([170, 150, 126], [214, 204, 184]), winStyle: "pair", trim: "#e0d4bc", frameCol: "#1e1e1e" },
    ],
    tints: [[1, 1, 1], [0.98, 0.97, 0.95], [1.02, 1.0, 0.96]],
    palette: P(0.8, [WHITE, CREAM, IVORY, "#d8cfbf", GREY, "#c9bfa4", SAGE, "#b8a888", STONE], 0.5, [WHITE, CREAM, "#6b5a48", CHARCOAL, STONE], 0.8, [BLACK, FOREST, OXBLOOD, BROWN, WHITE]),
    style: "victorian",
    picker: { group: "ornament", name: "Second Empire", era: "1855-1885", maxFloors: 8, variants: ["Painted stone, hoods", "Grey, arched", "Sand, pedimented", "Fawn, paired"] },
    city: [
      { share: 0.25, from: 1855, to: 1885, minH: 20, maxH: 31, cls: ["office"] },
      { parent: "brick", share: 0.04, from: 1860, to: 1885, minH: 9, maxH: 29 },
    ],
  },
  {
    key: "neogrec", like: "brownstone",
    spec: { bayW: 3.0, floorH: 3.6, masonry: true, glass: false, win: W_NG, wall: neoGrec([134, 92, 72]),
      glassCol: "#34444f", frameCol: "#3a2a22", wallRough: 0.8, glassRough: 0.1, glassMetal: 0.0, mullions: [1, 2], reveal: 4.0 },
    variants: [
      { wall: neoGrec([156, 116, 92]), frameCol: "#2a2a2a" },
      { wall: neoGrec([104, 72, 60]), frameCol: "#e6dfcf" },
      { wall: neoGrec([132, 118, 92]), frameCol: "#2e2a22" },
    ],
    tints: [[1, 1, 1], [0.92, 0.9, 0.88], [1.05, 1.0, 0.96]],
    picker: { group: "ornament", name: "Neo-Grec", era: "1865-1890", maxFloors: 6, variants: ["Brownstone, incised", "Light brownstone", "Chocolate, cream sash", "Olive sandstone"] },
    city: [{ share: 0.16, from: 1865, to: 1890, maxH: 22 }],
  },
  {
    key: "zigzag", like: "decobrick",
    spec: { bayW: 1.9, floorH: 3.6, masonry: true, glass: false, win: W_ZIG, wall: zigzag([196, 160, 120], [214, 176, 132], [120, 70, 50]),
      glassCol: "#2c3a44", frameCol: "#2e2824", wallRough: 0.84, glassRough: 0.1, glassMetal: 0.1, mullions: [2, 3], reveal: 3.2 },
    variants: [
      { wall: zigzag([140, 92, 70], [62, 58, 54], [200, 164, 80]), frameCol: "#1e1e1e" },
      { wall: zigzag([214, 192, 152], [176, 196, 170], [60, 110, 92]) },
      { wall: zigzag([160, 76, 56], [226, 214, 188], [150, 70, 52]), frameCol: "#2a2622" },
    ],
    tints: [[1, 1, 1], [0.95, 0.9, 0.86], [1.04, 1.0, 0.92]],
    palette: P(0.02, [CREAM], 0.3, [STONE, CREAM], 0.6, [BLACK, BRONZE, TEAL, "#8a3a2a", FOREST, GOLD]),
    picker: { group: "ornament", name: "Zigzag Moderne", era: "1925-1940", maxFloors: 99, variants: ["Tan, terra-cotta chevrons", "Brown, black and gold", "Buff, green spandrels", "Red, cream chevrons"] },
    city: [{ share: 0.2, from: 1925, to: 1940 }],
  },
  {
    key: "palazzo", like: "stone",
    spec: { bayW: 3.2, floorH: 4.0, masonry: true, glass: false, win: W_PAL, wall: palazzo([212, 184, 140], [232, 222, 200], false),
      glassCol: "#33444f", frameCol: "#3a3026", wallRough: 0.8, glassRough: 0.08, glassMetal: 0.05, mullions: [2, 3], reveal: 3.8 },
    variants: [
      { wall: palazzo([176, 168, 154], [226, 220, 208], false), winStyle: "arch", frameCol: "#26282a" },
      { wall: palazzo([216, 206, 186], [234, 228, 214], true), frameCol: "#2a2a28" },
      { wall: palazzo([204, 174, 158], [230, 216, 204], true), winStyle: "arch", mullions: [2, 4] },
    ],
    tints: [[1, 1, 1], [0.97, 0.95, 0.92], [1.03, 1.0, 0.95]],
    picker: { group: "ornament", name: "Renaissance palazzo", era: "1885-1930", maxFloors: 20, variants: ["Roman brick, aedicules", "Grey brick, arched loggia", "Banded rustication", "Pink stone, arched"] },
    city: [{ share: 0.12, from: 1885, to: 1930, minH: 14, maxH: 72, cls: ["office"] }],
  },
  // ------------------------------------------------------------------- civic
  {
    key: "greekrevival", like: "stone",
    spec: { bayW: 2.8, floorH: 3.6, masonry: true, glass: false, win: W_GR, wall: greekRevival([230, 226, 216], [242, 238, 230]), lintel: "flat",
      glassCol: "#34444e", frameCol: "#f2efe6", wallRough: 0.8, glassRough: 0.1, glassMetal: 0.0, trim: "#f4f1ea", mullions: [3, 4], reveal: 3.0 },
    variants: [
      { wall: greekRevival([178, 176, 170], [196, 194, 188]), shutter: "#2f4a3a", trim: "#d8d6d0" },
      { wall: greekRevival([234, 222, 194], [244, 236, 218]), trim: "#f4ecdc", frameCol: "#2a2a28" },
      { wall: greekRevival([0, 0, 0], [240, 236, 226], W_GR, [166, 84, 62]), shutter: "#222324" },
    ],
    tints: [[1, 1, 1], [0.98, 0.98, 0.96], [1.0, 0.98, 0.95]],
    palette: P(0.6, [WHITE, IVORY, CREAM, "#e8e2d4", STONE], 0.35, [WHITE, IVORY, CREAM], 0.8, [BLACK, FOREST, HUNTER, WHITE, NAVY]),
    picker: { group: "civic", name: "Greek Revival", era: "1820-1860", maxFloors: 6, variants: ["White, antae", "Granite, green shutters", "Cream stucco", "Red brick, white pilasters"] },
    city: [
      { parent: "georgian", share: 0.2, from: 1820, to: 1860, maxH: 22, cls: ["multifamily"] },
      { parent: "brick", share: 0.06, from: 1820, to: 1860, maxH: 22 },
    ],
  },
  {
    key: "collegiate", like: "romanesque",
    spec: { bayW: 3.2, floorH: 3.8, masonry: true, glass: false, win: W_COL, wall: collegiate([142, 72, 54], [214, 206, 186], false), over: tudorHeads([214, 206, 186]),
      glassCol: "#33424c", frameCol: "#d4ccb6", wallRough: 0.86, glassRough: 0.12, glassMetal: 0.05, mullions: [3, 2], reveal: 3.8 },
    variants: [
      { wall: collegiate([210, 200, 178], [226, 218, 200], true), over: tudorHeads([226, 218, 200]), frameCol: "#2a2a2a" },
      { wall: collegiate([96, 58, 50], [200, 194, 178], false), over: tudorHeads([200, 194, 178]) },
      { wall: collegiate([192, 162, 122], [170, 168, 160], false), over: tudorHeads([170, 168, 160]), frameCol: "#2e2c28" },
    ],
    tints: [[1, 1, 1], [0.92, 0.88, 0.86], [1.04, 1.0, 0.95]],
    palette: P(0, [], 0.1, [STONE, CREAM], 0.6, [BLACK, BRONZE, FOREST, CHARCOAL]),
    style: "tudor",
    picker: { group: "civic", name: "Collegiate Gothic", era: "1895-1940", maxFloors: 12, variants: ["Rust brick, limestone", "All limestone", "Dark clinker", "Buff brick, grey stone"] },
    city: [
      { parent: "georgian", share: 0.06, from: 1900, to: 1940, minH: 10, maxH: 43 },
      { parent: "stone", share: 0.04, from: 1895, to: 1940, minH: 14, maxH: 43, cls: ["office"] },
    ],
  },
  {
    key: "federal", like: "georgian",
    spec: { bayW: 2.6, floorH: 3.3, masonry: true, glass: false, win: W_FED, wall: federal([182, 100, 74], [236, 232, 222]),
      glassCol: "#34444e", frameCol: "#f4f1ea", wallRough: 0.86, glassRough: 0.12, glassMetal: 0.0, mullions: [3, 4], reveal: 3.0 },
    variants: [
      { wall: federal([140, 62, 48], [228, 224, 214]), shutter: "#222324" },
      { wall: federal([222, 210, 186], [242, 238, 228]), frameCol: "#2a2a28" },
      { wall: federal([196, 120, 96], [128, 90, 72]), shutter: "#2f4a3a" },
    ],
    tints: [[1, 1, 1], [0.94, 0.9, 0.88], [1.04, 0.98, 0.94]],
    picker: { group: "civic", name: "Federal", era: "1785-1830", maxFloors: 6, variants: ["Salmon brick, fanlights", "Dark red, black shutters", "Painted cream", "Pink, brownstone lintels"] },
    city: [
      { parent: "georgian", share: 0.25, from: 1785, to: 1830, maxH: 22 },
      { parent: "brick", share: 0.08, from: 1785, to: 1830, maxH: 22 },
    ],
  },
  {
    key: "pwa", like: "deco",
    spec: { bayW: 2.4, floorH: 4.0, masonry: true, glass: false, win: W_PWA, wall: pwa([214, 206, 188]),
      glassCol: "#2e3c46", frameCol: "#4a3a28", wallRough: 0.76, glassRough: 0.08, glassMetal: 0.25, mullions: [2, 4], reveal: 3.6 },
    variants: [
      { wall: pwa([212, 192, 152]), frameCol: "#9a9ea0" },
      { wall: pwa([170, 170, 166]), frameCol: "#2a2c2e" },
      { wall: pwa([212, 178, 158]), frameCol: "#3e3022" },
    ],
    tints: [[1, 1, 1], [0.97, 0.96, 0.93], [1.02, 1.0, 0.97]],
    palette: P(0, [], 0, [], 0.7, [BRONZE, BLACK, CHARCOAL, VERDIGRIS, SILVER]),
    picker: { group: "civic", name: "PWA Moderne", era: "1933-1943", maxFloors: 20, variants: ["Limestone, bronze sash", "Buff, aluminium", "Grey granite", "Pink stone"] },
    city: [
      { parent: "deco", share: 0.16, from: 1933, to: 1943, maxH: 72 },
      { parent: "moderne", share: 0.05, from: 1934, to: 1943 },
    ],
  },
  {
    key: "stripped", like: "stone",
    spec: { bayW: 2.8, floorH: 4.0, masonry: true, glass: false, win: W_STR, wall: stripped([168, 168, 166]),
      glassCol: "#2c3a44", frameCol: "#2a2a2a", wallRough: 0.5, glassRough: 0.08, glassMetal: 0.2, mullions: [2, 3], reveal: 4.6 },
    variants: [
      { wall: stripped([214, 206, 188]), frameCol: "#3a3026" },
      { wall: stripped([198, 160, 148]), frameCol: "#2a2622" },
      { wall: stripped([112, 112, 114]), frameCol: "#c4c8cc" },
    ],
    tints: [[1, 1, 1], [0.96, 0.96, 0.95], [1.02, 1.0, 0.98]],
    palette: P(0, [], 0, [], 0.6, [BRONZE, BLACK, CHARCOAL, SILVER]),
    picker: { group: "civic", name: "Stripped classical", era: "1930-1955", maxFloors: 20, variants: ["Grey granite", "Limestone", "Pink granite", "Dark granite"] },
    city: [
      { share: 0.14, from: 1930, to: 1945, minH: 30, maxH: 72, cls: ["office"] },
      { parent: "modern", share: 0.05, from: 1945, to: 1955, maxH: 72, cls: ["office"] },
    ],
  },
  {
    key: "bank", like: "stone",
    spec: { bayW: 3.6, floorH: 5.6, masonry: true, glass: false, win: W_BANK, wall: bank([196, 192, 182], [92, 72, 50]),
      glassCol: "#2e3a40", frameCol: "#5a4630", wallRough: 0.62, glassRough: 0.06, glassMetal: 0.3, mullions: [3, 4], reveal: 4.8 },
    variants: [
      { wall: bank([232, 228, 220], [86, 70, 50]), frameCol: "#4a3a28" },
      { wall: bank([200, 166, 152], [70, 58, 46]) },
      { wall: bank([156, 158, 154], [86, 116, 100]), frameCol: "#3e5a4c" },
    ],
    tints: [[1, 1, 1], [0.97, 0.96, 0.94], [1.02, 1.0, 0.97]],
    palette: P(0, [], 0, [], 0.8, [BRONZE, BLACK, CHARCOAL, VERDIGRIS]),
    picker: { group: "civic", name: "Bank temple", era: "1895-1930", maxFloors: 6, variants: ["Granite, giant columns", "White marble", "Pink granite", "Grey, verdigris"] },
    city: [
      { share: 0.18, from: 1895, to: 1930, minH: 14, maxH: 23, cls: ["office"] },
      { parent: "brick", share: 0.03, from: 1895, to: 1930, minH: 9, maxH: 15, cls: ["office", "retail"] },
    ],
  },
  {
    key: "schoolbrick", like: "georgian",
    spec: { bayW: 3.6, floorH: 4.0, masonry: true, glass: false, win: W_SCH, wall: schoolBrick([164, 76, 56], [222, 214, 194]), winStyle: "triple",
      glassCol: "#34444e", frameCol: "#f2efe6", wallRough: 0.86, glassRough: 0.1, glassMetal: 0.0, mullions: [2, 3], reveal: 3.0 },
    variants: [
      { wall: schoolBrick([204, 172, 124], [230, 224, 210]), frameCol: "#2a2a28" },
      { wall: schoolBrick([118, 72, 58], [214, 206, 186]), frameCol: "#2f4a3a" },
      { wall: schoolBrick([186, 100, 66], [228, 220, 200]), winStyle: "rect", mullions: [3, 4] },
    ],
    tints: [[1, 1, 1], [0.92, 0.88, 0.86], [1.04, 0.98, 0.94]],
    palette: P(0.04, [CREAM, GREY], 0.15, [WHITE, STONE, CREAM], 0.75, [WHITE, FOREST, BLACK, OXBLOOD, CHARCOAL]),
    picker: { group: "civic", name: "Georgian school", era: "1910-1950", maxFloors: 8, variants: ["Red brick, limestone bands", "Buff brick", "Brown, green sash", "Orange, single sash"] },
    city: [
      { parent: "georgian", share: 0.1, from: 1910, to: 1945, maxH: 29 },
      { parent: "buff", share: 0.05, from: 1945, to: 1950, maxH: 29, cls: ["office"] },
    ],
  },
  {
    key: "newformalism", like: "precast",
    spec: { bayW: 2.4, floorH: 3.8, masonry: false, glass: false, win: W_NF, wall: nfBack, over: arcade([238, 234, 224], "round"),
      glassCol: "#2a3640", frameCol: "#2a2c2e", wallRough: 0.6, glassRough: 0.06, glassMetal: 0.45, mullions: [2, 1], reveal: 5.0 },
    variants: [
      { over: arcade([242, 240, 236], "pointed"), glassCol: "#34404a" },
      { over: arcade([228, 220, 200], "square"), frameCol: "#5a4630" },
    ],
    tints: [[1, 1, 1], [0.98, 0.97, 0.95], [1.0, 0.98, 0.94]],
    palette: null,
    picker: { group: "civic", name: "New Formalism", era: "1958-1975", maxFloors: 20, variants: ["White round arcade", "Pointed, Yamasaki", "Travertine colonnade"] },
    city: [
      { share: 0.18, from: 1958, to: 1975, maxH: 72 },
      { parent: "modern", share: 0.04, from: 1958, to: 1975, maxH: 30, cls: ["office"] },
    ],
  },
  {
    key: "edwardian", like: "stone",
    spec: { bayW: 2.9, floorH: 3.9, masonry: true, glass: false, win: W_ED, wall: edwardian([178, 70, 52], [232, 226, 212]),
      glassCol: "#34444e", frameCol: "#efe9dc", wallRough: 0.82, glassRough: 0.1, glassMetal: 0.0, mullions: [2, 3], reveal: 3.6 },
    variants: [
      { wall: edwardian([128, 66, 52], [226, 220, 204]), frameCol: "#2a2a28" },
      { wall: edwardian([196, 104, 64], [218, 196, 152]) },
    ],
    tints: [[1, 1, 1], [0.94, 0.9, 0.88], [1.04, 0.99, 0.95]],
    palette: P(0, [], 0.1, [WHITE, STONE], 0.7, [WHITE, BLACK, FOREST, OXBLOOD]),
    picker: { group: "civic", name: "Edwardian baroque", era: "1895-1915", maxFloors: 10, variants: ["Red brick, Portland bands", "Brown brick", "Orange, buff bands"] },
    city: [
      { share: 0.1, from: 1895, to: 1915, minH: 14, maxH: 36, cls: ["office"] },
      { parent: "brick", share: 0.05, from: 1895, to: 1915, minH: 9, maxH: 22, cls: ["office", "retail"] },
    ],
  },
  {
    key: "neogeorgian", like: "georgian",
    spec: { bayW: 2.9, floorH: 3.6, masonry: true, glass: false, win: W_NGEO, wall: neoGeorgian([132, 62, 54], [226, 220, 204], [196, 100, 66]),
      glassCol: "#34444e", frameCol: "#f4f1ea", wallRough: 0.86, glassRough: 0.1, glassMetal: 0.0, mullions: [3, 4], reveal: 3.2 },
    variants: [
      { wall: neoGeorgian([156, 74, 56], [232, 228, 216], [204, 116, 76]), shutter: "#222324" },
      { wall: neoGeorgian([104, 56, 50], [214, 208, 192], [176, 90, 62]), frameCol: "#ece6d6" },
      { wall: neoGeorgian([196, 160, 124], [236, 230, 216], [210, 150, 110]), frameCol: "#2f4a3a" },
    ],
    tints: [[1, 1, 1], [0.92, 0.88, 0.86], [1.04, 0.99, 0.94]],
    picker: { group: "civic", name: "Neo-Georgian", era: "1915-1960", maxFloors: 16, variants: ["Plum brick, white sash", "Red, black shutters", "Dark, stone quoins", "Buff, green sash"] },
    city: [
      { share: 0.12, from: 1915, to: 1945, maxH: 58 },
      { parent: "brick", share: 0.05, from: 1945, to: 1960, minH: 10, maxH: 26, cls: ["multifamily"] },
    ],
  },
  {
    key: "armory", like: "romanesque",
    spec: { bayW: 3.0, floorH: 4.4, masonry: true, glass: false, win: W_ARM, wall: armory([140, 64, 50], [206, 198, 180]), winStyle: "arch",
      glassCol: "#2c3840", frameCol: "#2a2622", wallRough: 0.9, glassRough: 0.12, glassMetal: 0.0, mullions: [1, 2], reveal: 4.6 },
    variants: [
      { wall: armory([118, 76, 60], [196, 186, 166], { x0: 0.38, x1: 0.62, y0: 0.26, y1: 0.74 }), win: { x0: 0.38, x1: 0.62, y0: 0.26, y1: 0.74 }, winStyle: "pair" },
      { wall: armory([150, 146, 138], [196, 192, 184]), frameCol: "#1e1e1e" },
      { wall: armory([110, 50, 42], [180, 172, 156]), winStyle: "rect" },
    ],
    tints: [[1, 1, 1], [0.92, 0.88, 0.86], [1.04, 1.0, 0.96]],
    palette: P(0, [], 0.1, [STONE], 0.6, [BLACK, CHARCOAL, FOREST, OXBLOOD]),
    style: "victorian",
    picker: { group: "civic", name: "Castellated armory", era: "1875-1915", maxFloors: 6, variants: ["Red brick, lancets", "Brown, paired slits", "Grey stone", "Dark red, square slits"] },
    city: [
      { share: 0.15, from: 1880, to: 1902, maxH: 22 },
      { parent: "brick", share: 0.015, from: 1875, to: 1915, minH: 9, maxH: 22, cls: ["office"] },
    ],
  },
  {
    key: "egyptian", like: "stone",
    spec: { bayW: 2.8, floorH: 4.2, masonry: true, glass: false, win: W_EGY, wall: egyptian([206, 182, 140], [190, 160, 104]),
      glassCol: "#2f3a42", frameCol: "#2a2622", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.0, mullions: [1, 2], reveal: 4.2 },
    variants: [
      { wall: egyptian([168, 164, 156], [140, 136, 128]) },
      { wall: egyptian([214, 194, 156], [52, 104, 140]), frameCol: "#1e2a30" },
      { wall: egyptian([178, 118, 92], [150, 96, 72]) },
    ],
    tints: [[1, 1, 1], [0.96, 0.94, 0.9], [1.03, 1.0, 0.95]],
    palette: P(0, [], 0.3, [GOLD, "#d8c8a0", STONE], 0.45, ["#2f6a8a", "#3a7a5a", "#a03c2c", GOLD]),
    picker: { group: "civic", name: "Egyptian Revival", era: "1830-1935", maxFloors: 8, variants: ["Sandstone, papyrus columns", "Grey granite", "Polychrome", "Red sandstone"] },
    city: [
      { share: 0.05, from: 1830, to: 1935, minH: 14, maxH: 29, cls: ["office"] },
      { parent: "brownstone", share: 0.02, from: 1840, to: 1860, maxH: 22 },
    ],
  },
];
