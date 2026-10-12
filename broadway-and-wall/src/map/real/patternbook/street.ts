// THE STREET AND THE REGIONS. The row house, the two-flat and the walk-up as
// each city built its own; and the regional dress of the American house and
// small block — the Craftsman bungalow street, the adobe of Santa Fe, the
// stucco of Coral Gables and Santa Barbara, the pastel hotels of Miami Beach,
// the single houses of Charleston. Each paints its own wall: shingle courses,
// Roman brick, Formstone, adobe and vigas, gingerbread, iron grilles.
import { TILE, P, stuccoWall, type FamilySpec, type Painter, type PaintCtx } from "../facades";
import type { BookEntry } from "./types";

type RGB = [number, number, number];
type Win = FamilySpec["win"];
const T = TILE;
const MK_TRIM = "rgb(0,255,0)", MK_ACC = "rgb(0,0,255)";
const cl = (x: number) => Math.max(0, Math.min(255, x)) | 0;
const rgb = (c: RGB, v = 1) => `rgb(${cl(c[0] * v)},${cl(c[1] * v)},${cl(c[2] * v)})`;

/** Fill a rectangle on the colour and, when given, the same rectangle on the paint mask. */
function fillBoth(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, mk: string | null, x: number, y: number, w: number, h: number) {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  if (pc && mk) { pc.m.fillStyle = mk; pc.m.fillRect(x, y, w, h); }
}
/** Fill a path on the colour and the mask. */
function pathBoth(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, mk: string | null, path: (g: CanvasRenderingContext2D) => void, rule: CanvasFillRule = "nonzero") {
  for (const gg of pc && mk ? [g, pc.m] : [g]) { gg.fillStyle = gg === g ? col : mk!; gg.beginPath(); path(gg); gg.fill(rule); }
}
/** Stroke a path on the colour and the mask. */
function strokeBoth(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, mk: string | null, lw: number, path: (g: CanvasRenderingContext2D) => void) {
  for (const gg of pc && mk ? [g, pc.m] : [g]) { gg.strokeStyle = gg === g ? col : mk!; gg.lineWidth = lw; gg.beginPath(); path(gg); gg.stroke(); }
}
const relief = (pc: PaintCtx | undefined, col: string, x: number, y: number, w: number, h: number) => { if (pc) { pc.hg.fillStyle = col; pc.hg.fillRect(x, y, w, h); } };
const specks = (g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, a: number, s = 1.5, light = false) => {
  for (let i = 0; i < n; i++) { g.fillStyle = light ? `rgba(255,255,255,${rnd() * a})` : `rgba(0,0,0,${rnd() * a})`; g.fillRect(rnd() * w, rnd() * h, s, s); }
};
/** The window opening of bay bx, floor by on the canvas — the renderer's own arithmetic, stagger included. */
const winBox = (wn: Win, bx: number, by: number, jitter = 0) => {
  const jit = jitter ? [-1, 0.6, 0.3, -0.8][bx + 2 * by] * jitter : 0;
  const jx = Math.max(-wn.x0 + 0.03, Math.min(1 - wn.x1 - 0.03, jit)) * T;
  return { x0: bx * T + wn.x0 * T + jx, x1: bx * T + wn.x1 * T + jx, y0: by * T + (1 - wn.y1) * T, y1: by * T + (1 - wn.y0) * T };
};
const BAYS: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];

// ---- the walls ---------------------------------------------------------------

/** Lapped boards with a hairline shadow under each lap. */
function boards(g: CanvasRenderingContext2D, rnd: () => number, c: RGB, x: number, y0: number, w: number, y1: number, board: number, shadow = 0.3) {
  for (let y = y0; y < y1; y += board) {
    g.fillStyle = rgb(c, 0.96 + rnd() * 0.06); g.fillRect(x, y, w, Math.min(board, y1 - y));
    g.fillStyle = `rgba(50,44,36,${shadow})`; g.fillRect(x, y, w, 1.4);
    g.fillStyle = "rgba(255,255,255,0.10)"; g.fillRect(x, y + 1.4, w, 1);
  }
}

/** Sawn wood shingles in courses; ragged and weathered, or even and painted. */
function shingles(g: CanvasRenderingContext2D, rnd: () => number, c: RGB, y0: number, y1: number, w: number, exp: number, rag: number, var_: number, minW = 5, maxW = 14) {
  for (let y = y0; y < y1; y += exp) {
    let x = -rnd() * maxW;
    while (x < w) {
      const sw = minW + rnd() * (maxW - minW), dy = (rnd() - 0.5) * rag, v = 1 - var_ / 2 + rnd() * var_;
      g.fillStyle = rgb(c, v); g.fillRect(x + 0.5, y, sw - 0.8, Math.min(exp + dy, y1 - y));
      // a weathered shingle streaks darker from its butt up
      if (var_ > 0.2 && rnd() < 0.3) { g.fillStyle = "rgba(40,34,28,0.16)"; g.fillRect(x + 1 + rnd() * (sw - 3), y, 1.2, exp); }
      g.fillStyle = "rgba(20,16,12,0.45)"; g.fillRect(x, y, 0.9, exp);                      // the keyway
      if (y + exp + dy < y1) { g.fillStyle = "rgba(20,16,12,0.42)"; g.fillRect(x + 0.5, y + exp + dy - 1.2, sw - 0.8, 1.4); }  // the butt's shadow
      x += sw;
    }
  }
}

/** CHICAGO FACE BRICK: pressed, thin-jointed, banded by continuous limestone sill and lintel courses. */
const twoFlatWall = (brick: RGB, stone: RGB, wn: Win, mortar = "#5c5048"): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = mortar; g.fillRect(0, 0, w, h);
  relief(pc, "#d0d0d0", 0, 0, w, h);
  const bh = h / 44;
  for (let y = 0, r = 0; y < h - 0.5; y += bh, r++) for (let x = -((r % 2) * 8); x < w; x += 16) {
    g.fillStyle = rgb(brick, 0.9 + rnd() * 0.16); g.fillRect(x + 0.7, y + 0.7, 15.3, bh - 0.9);
    relief(pc, "#ffffff", x + 0.7, y + 0.7, 15.3, bh - 0.9);
  }
  for (let by = 0; by < 2; by++) {
    const b = winBox(wn, 0, by);
    for (const [y, hh] of [[b.y0 - 10, 9], [b.y1, 7]] as [number, number][]) {
      fillBoth(g, pc, rgb(stone), MK_TRIM, 0, y, w, hh);
      g.fillStyle = rgb(stone, 1.08); g.fillRect(0, y, w, 1.5);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, y + hh, w, 1.6);
      relief(pc, "#ffffff", 0, y, w, hh);
    }
  }
};

/** CHICAGO GREYSTONE: Bedford limestone, rock-faced courses between smooth bands. */
const greystoneWall = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.72); g.fillRect(0, 0, w, h);
  relief(pc, "#a8a8a8", 0, 0, w, h);
  for (let y = 0; y < h; y += 32) {
    // the rock-faced course
    let x = -rnd() * 40;
    while (x < w) {
      const L = 30 + rnd() * 34, v = 0.9 + rnd() * 0.14;
      g.fillStyle = rgb(c, v); g.fillRect(x + 1, y + 1, L - 2, 20);
      g.fillStyle = rgb(c, v * 1.1); g.fillRect(x + 2, y + 2, L - 4, 3);
      g.fillStyle = rgb(c, v * 0.82); g.fillRect(x + 2, y + 17, L - 4, 3);
      for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(0,0,0,${0.06 + rnd() * 0.1})`; g.fillRect(x + 2 + rnd() * (L - 5), y + 4 + rnd() * 13, 2, 1.5); }
      relief(pc, "#f0f0f0", x + 1, y + 1, L - 2, 20);
      relief(pc, "#ffffff", x + 4, y + 5, L - 8, 11);
      x += L;
    }
    // the smooth band
    for (let x2 = ((y / 32) % 2) * 32 - 32; x2 < w; x2 += 64) {
      g.fillStyle = rgb(c, 1.02 + rnd() * 0.04); g.fillRect(x2 + 1, y + 22, 62, 9);
      relief(pc, "#e8e8e8", x2 + 1, y + 22, 62, 9);
    }
  }
};

/** TRIPLE-DECKER: narrow clapboard, corner boards at every angle of the bay, a frieze board at each floor. */
const deckerWall = (c: RGB, trim: RGB, board = 5): Painter => (g, w, h, rnd, pc) => {
  boards(g, rnd, c, 0, 0, w, h, board, 0.34);
  for (let by = 0; by < 2; by++) {
    const oy = by * T;
    fillBoth(g, pc, rgb(trim), MK_TRIM, 0, oy, w, 9);
    g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(0, oy + 9, w, 2);
    relief(pc, "#ffffff", 0, oy, w, 9);
  }
  for (let bx = 0; bx < 2; bx++) { fillBoth(g, pc, rgb(trim), MK_TRIM, bx * T, 0, 6, h); fillBoth(g, pc, rgb(trim), MK_TRIM, bx * T + T - 6, 0, 6, h); }
};

/** Asbestos-cement shingle, the 1940s re-siding: striated grey-green slabs with a deckled butt. */
const cementShingle = (c: RGB, trim: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.7); g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += 16, r++) for (let x = (r % 2) * 16 - 16; x < w; x += 32) {
    g.fillStyle = rgb(c, 0.95 + rnd() * 0.08); g.fillRect(x + 0.6, y, 31, 15);
    for (let sx = x + 1; sx < x + 31; sx += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`; g.fillRect(sx, y, 0.8, 15); }
    g.fillStyle = "rgba(20,20,20,0.4)";
    for (let sx = x; sx < x + 32; sx += 4) g.fillRect(sx, y + 14.2 + (sx % 8 ? 0.7 : 0), 4, 1.3);
  }
  for (let by = 0; by < 2; by++) { fillBoth(g, pc, rgb(trim), MK_TRIM, 0, by * T, w, 7); relief(pc, "#ffffff", 0, by * T, w, 7); }
  for (let bx = 0; bx < 2; bx++) { fillBoth(g, pc, rgb(trim), MK_TRIM, bx * T, 0, 5, h); fillBoth(g, pc, rgb(trim), MK_TRIM, bx * T + T - 5, 0, 5, h); }
};

/** PHILADELPHIA PRESSED BRICK: smooth, even, buttered red joints; or Flemish bond with glazed headers. */
const pressedBrick = (c: RGB, header?: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.66); g.fillRect(0, 0, w, h);
  relief(pc, "#e0e0e0", 0, 0, w, h);
  const bh = h / 48;
  for (let y = 0, r = 0; y < h - 0.5; y += bh, r++) {
    let x = header ? (r % 2 ? -12 : 0) : -((r % 2) * 8), st = true;
    while (x < w) {
      const L = header && !st ? 8 : 16, glaze = header && !st;
      g.fillStyle = rgb(glaze ? header! : c, 0.95 + rnd() * 0.08); g.fillRect(x + 0.45, y + 0.45, L - 0.7, bh - 0.7);
      g.fillStyle = glaze ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)"; g.fillRect(x + 1, y + 0.8, L - 2.5, 0.8);
      x += L; if (header) st = !st;
    }
  }
};

/** FORMSTONE: Baltimore's sprayed-and-moulded cement stone over brick — rounded fake stones, mica sparkle, fat light joints. */
const formstoneWall = (cols: RGB[], mortar: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(mortar); g.fillRect(0, 0, w, h);
  relief(pc, "#9a9a9a", 0, 0, w, h);
  const rr = (gg: CanvasRenderingContext2D, x: number, y: number, ww: number, hh: number, r: number) => {
    gg.beginPath(); gg.moveTo(x + r, y); gg.lineTo(x + ww - r, y); gg.quadraticCurveTo(x + ww, y, x + ww, y + r); gg.lineTo(x + ww, y + hh - r);
    gg.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh); gg.lineTo(x + r, y + hh); gg.quadraticCurveTo(x, y + hh, x, y + hh - r); gg.lineTo(x, y + r); gg.quadraticCurveTo(x, y, x + r, y); gg.fill();
  };
  let y = 0;
  while (y < h) {
    let rh = 12 + Math.floor(rnd() * 3) * 5;
    if (y + rh > h - 9) rh = h - y;
    let x = -rnd() * 24;
    while (x < w) {
      const L = 16 + rnd() * 30, c = cols[Math.floor(rnd() * cols.length)], v = 0.86 + rnd() * 0.2;
      g.fillStyle = rgb(c, v); rr(g, x + 1.8, y + 1.8, L - 3.6, rh - 3.6, 3.5);
      g.fillStyle = rgb(c, v * 1.12); rr(g, x + 2.5, y + 2.2, L - 6, 3, 1.5);
      g.fillStyle = rgb(c, v * 0.82); rr(g, x + 3, y + rh - 5, L - 6, 2.5, 1.2);
      for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.1})`; g.fillRect(x + 3 + rnd() * (L - 6), y + 3 + rnd() * (rh - 6), 1.5, 1.5); }
      for (let k = 0; k < 3; k++) { g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(x + 3 + rnd() * (L - 6), y + 3 + rnd() * (rh - 6), 0.9, 0.9); }
      if (pc) { pc.hg.fillStyle = "#ffffff"; rr(pc.hg, x + 2.5, y + 2.5, L - 5, rh - 5, 4); }
      x += L;
    }
    y += rh;
  }
};

/** THE DUMBBELL TENEMENT: common brick with a corbelled brick band under each floor line. */
const tenementWall = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = "#a89c8c"; g.fillRect(0, 0, w, h);
  relief(pc, "#c8c8c8", 0, 0, w, h);
  const bh = h / 40;
  for (let y = 0, r = 0; y < h - 0.5; y += bh, r++) for (let x = -((r % 2) * 8); x < w; x += 16) {
    g.fillStyle = rgb(c, 0.84 + rnd() * 0.26); g.fillRect(x + 1, y + 1, 14.5, bh - 1.5);
    relief(pc, "#ffffff", x + 1, y + 1, 14.5, bh - 1.5);
  }
  for (let by = 0; by < 2; by++) {
    const oy = by * T;
    // a projecting course, a row of dentils, a second course: the brick cornice of every floor
    g.fillStyle = rgb(c, 1.05); g.fillRect(0, oy, w, 5);
    for (let x = 0; x < w; x += 8) { g.fillStyle = rgb(c, 0.95 + rnd() * 0.12); g.fillRect(x, oy + 5, 5, 6); g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(x + 5, oy + 5, 3, 6); }
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, oy + 11, w, 2);
    relief(pc, "#ffffff", 0, oy, w, 11);
    for (let x = 5; x < w; x += 8) relief(pc, "#909090", x, oy + 5, 3, 6);
  }
};

/** The fire escape, drawn in front of the glass: a railed balcony at every floor of one bay, a stair zigzagging between. */
const fireEscapeOver = (iron: RGB, wn: Win): Painter => (g, _w, _h, _rnd, pc) => {
  const col = rgb(iron), xa = 3, xb = T + 22;
  const plat = (by: number) => winBox(wn, 0, by).y1 + 2;
  for (let by = 0; by < 2; by++) {
    const y = plat(by);
    g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(xa, y + 3, xb - xa, 5);                     // its shadow on the wall
    fillBoth(g, pc, col, MK_ACC, xa, y, xb - xa, 3.2);                                         // the deck
    fillBoth(g, pc, col, MK_ACC, xa, y - 30, xb - xa, 2);                                      // the top rail
    fillBoth(g, pc, col, MK_ACC, xa, y - 16, xb - xa, 1.2);
    for (let x = xa; x <= xb; x += 3.5) fillBoth(g, pc, col, MK_ACC, x, y - 30, 0.9, 30);      // balusters
    fillBoth(g, pc, col, MK_ACC, xa, y - 30, 2.2, 33); fillBoth(g, pc, col, MK_ACC, xb - 2, y - 30, 2.2, 33);
    relief(pc, "#ffffff", xa, y - 30, xb - xa, 2); relief(pc, "#ffffff", xa, y, xb - xa, 3);
  }
  // the stair from each deck down to the next, alternating direction; drawn twice so it wraps
  const stair = (x0: number, y0: number, x1: number, y1: number) => {
    for (const dy of [0, -2 * T, 2 * T]) {
      strokeBoth(g, pc, col, MK_ACC, 1.6, (gg) => { gg.moveTo(x0, y0 + dy); gg.lineTo(x1, y1 + dy); gg.moveTo(x0, y0 + dy - 5); gg.lineTo(x1, y1 + dy - 5); });
      const n = 16;
      for (let i = 1; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, y = y0 + dy + ((y1 - y0) * i) / n;
        strokeBoth(g, pc, col, MK_ACC, 1, (gg) => { gg.moveTo(x, y); gg.lineTo(x, y - 5); });
      }
    }
  };
  stair(xa + 14, plat(0), xb - 18, plat(1));
  stair(xb - 18, plat(1), xa + 14, plat(0) + 2 * T);
};

/** NEW ORLEANS DROP SIDING: wide boards with a coved top, under a jigsawn gingerbread frieze with brackets. */
const shotgunWall = (c: RGB, trim: RGB, acc: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 10) {
    g.fillStyle = rgb(c, 0.97 + rnd() * 0.05); g.fillRect(0, y, w, 10);
    g.fillStyle = "rgba(40,30,20,0.34)"; g.fillRect(0, y, w, 1.2);
    g.fillStyle = "rgba(40,30,20,0.18)"; g.fillRect(0, y + 1.2, w, 1.4);
    g.fillStyle = "rgba(40,30,20,0.08)"; g.fillRect(0, y + 2.6, w, 1.4);
    g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(0, y + 8.5, w, 1);
  }
  for (let by = 0; by < 2; by++) {
    const oy = by * T;
    // the frieze: a board, a row of drilled holes, a scalloped valance
    fillBoth(g, pc, rgb(trim), MK_TRIM, 0, oy, w, 13);
    for (let x = 4; x < w; x += 8) { g.fillStyle = "rgba(30,24,20,0.6)"; g.beginPath(); g.arc(x, oy + 7, 2.2, 0, 6.283); g.fill(); }
    pathBoth(g, pc, rgb(trim), MK_TRIM, (gg) => { for (let x = 0; x < w + 16; x += 16) { gg.moveTo(x + 8, oy + 13); gg.arc(x, oy + 13, 8, 0, Math.PI); } });
    for (let x = 0; x < w + 16; x += 16) { g.fillStyle = "rgba(30,24,20,0.55)"; g.beginPath(); g.arc(x, oy + 16, 2.4, 0, 6.283); g.fill(); }
    g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(0, oy + 21, w, 2);
    relief(pc, "#ffffff", 0, oy, w, 20);
    // jigsawn scroll brackets at the bay edges, in the accent
    for (const x of [0, T, 2 * T]) {
      pathBoth(g, pc, rgb(acc), MK_ACC, (gg) => {
        gg.moveTo(x - 20, oy + 13); gg.lineTo(x + 20, oy + 13);
        gg.quadraticCurveTo(x + 5, oy + 17, x + 4, oy + 40); gg.lineTo(x - 4, oy + 40); gg.quadraticCurveTo(x - 5, oy + 17, x - 20, oy + 13);
      });
      g.fillStyle = rgb(c, 0.5); g.beginPath(); g.arc(x - 8, oy + 18, 3, 0, 6.283); g.arc(x + 8, oy + 18, 3, 0, 6.283); g.fill();
    }
  }
};

/** SAN FRANCISCO STICK: channel-rustic boards, stick strips, a bracketed frieze and a carved apron under every window. */
const ladyWall = (body: RGB, trim: RGB, acc: RGB, wn: Win, fish = false): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(body); g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) {
    g.fillStyle = rgb(body, 0.97 + rnd() * 0.05); g.fillRect(0, y, w, 8);
    g.fillStyle = "rgba(30,24,20,0.35)"; g.fillRect(0, y + 6.4, w, 1.6);
    g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(0, y, w, 1);
  }
  const tc = rgb(trim), ac = rgb(acc);
  for (const [bx, by] of BAYS) {
    const ox = bx * T, oy = by * T, b = winBox(wn, bx, by);
    // fishscale shingles in the frieze zone of a Queen Anne front
    if (fish) {
      for (let r = 0; r < 2; r++) for (let x = ox + (r % 2) * 4; x < ox + T; x += 8) {
        pathBoth(g, pc, rgb(body, r % 2 ? 0.86 : 0.94), null, (gg) => { gg.moveTo(x, oy + 12 + r * 6); gg.arc(x + 4, oy + 12 + r * 6, 4, Math.PI, 0, true); });
      }
    }
    // stick: the bay's edge boards and a band at the sill
    fillBoth(g, pc, tc, MK_TRIM, ox, oy, 6, T); fillBoth(g, pc, tc, MK_TRIM, ox + T - 6, oy, 6, T);
    fillBoth(g, pc, tc, MK_TRIM, ox, b.y1 + 4, T, 5);
    // the apron under the window: a sunk panel with a sunburst
    const px0 = b.x0 + 2, px1 = b.x1 - 2, py0 = b.y1 + 13, py1 = oy + T - 6;
    fillBoth(g, pc, ac, MK_ACC, px0, py0, px1 - px0, py1 - py0);
    strokeBoth(g, pc, tc, MK_TRIM, 1.6, (gg) => {
      gg.rect(px0 + 2, py0 + 2, px1 - px0 - 4, py1 - py0 - 4);
      const cx = (px0 + px1) / 2;
      for (let k = 0; k <= 6; k++) { const a = Math.PI + (Math.PI * k) / 6; gg.moveTo(cx, py1 - 3); gg.lineTo(cx + Math.cos(a) * 14, py1 - 3 + Math.sin(a) * 8); }
    });
    relief(pc, "#bdbdbd", px0 + 3, py0 + 3, px1 - px0 - 6, py1 - py0 - 6);
    // the frieze and its paired brackets
    fillBoth(g, pc, tc, MK_TRIM, ox, oy, T, 8);
    for (let x = ox + 4; x < ox + T; x += 7) fillBoth(g, pc, ac, MK_ACC, x, oy + 8, 3.5, 3.5);
    for (const x of [ox + 3, ox + T - 13]) fillBoth(g, pc, ac, MK_ACC, x, oy + 8, 10, 12);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(ox, oy + 11.5, T, 1.5);
    relief(pc, "#ffffff", ox, oy, T, 8);
  }
};

/** CRAFTSMAN: dark-stained ragged shingle over painted lap siding, a belt course, knee braces under the eaves. */
const craftsmanWall = (shingle: RGB, lap: RGB, trim: RGB, brace: RGB): Painter => (g, w, _h, rnd, pc) => {
  shingles(g, rnd, shingle, 0, T, w, 9, 1.6, 0.3, 6, 15);
  boards(g, rnd, lap, 0, T, w, 2 * T, 11, 0.42);
  fillBoth(g, pc, rgb(trim), MK_TRIM, 0, T - 11, w, 11);
  g.fillStyle = "rgba(0,0,0,0.38)"; g.fillRect(0, T, w, 3);
  relief(pc, "#ffffff", 0, T - 11, w, 11);
  // the knee braces: a post, a strut, the rafter tail above
  for (const x of [0, T, 2 * T]) {
    fillBoth(g, pc, rgb(brace), MK_ACC, x - 3, 0, 6, 26);
    strokeBoth(g, pc, rgb(brace), MK_ACC, 4.5, (gg) => { gg.moveTo(x - 1, 24); gg.lineTo(x + 20, 2); gg.moveTo(x + 1, 24); gg.lineTo(x - 20, 2); });
    fillBoth(g, pc, rgb(brace), MK_ACC, x - 24, 0, 48, 4);
  }
};

/** PRAIRIE ROMAN BRICK: long thin bricks, deep-raked bed joints and flush heads — the wall reads as horizontal lines. */
const romanBrick = (c: RGB, band: RGB, wn: Win): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.42); g.fillRect(0, 0, w, h);
  relief(pc, "#707070", 0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += 4, r++) {
    let x = -((r * 13) % 32);
    while (x < w) {
      const L = 28 + Math.floor(rnd() * 3) * 4;
      g.fillStyle = rgb(c, 0.88 + rnd() * 0.2); g.fillRect(x, y + 1.3, L - 0.6, 2.7);
      relief(pc, "#ffffff", x, y + 1.3, L, 2.7);
      x += L;
    }
  }
  for (let by = 0; by < 2; by++) {
    const b = winBox(wn, 0, by);
    for (const [y, hh] of [[b.y0 - 7, 7], [b.y1, 9]] as [number, number][]) {
      fillBoth(g, pc, rgb(band), MK_TRIM, 0, y, w, hh);
      g.fillStyle = "rgba(0,0,0,0.32)"; g.fillRect(0, y + hh, w, 2.2);
      relief(pc, "#ffffff", 0, y, w, hh);
    }
  }
};
/** Prairie stucco between dark wood bands, the band running at sill and head. */
const prairieStucco = (c: RGB, wood: RGB, wn: Win): Painter => (g, w, h, rnd, pc) => {
  stuccoWall(c)(g, w, h, rnd);
  for (let by = 0; by < 2; by++) {
    const b = winBox(wn, 0, by);
    for (const [y, hh] of [[b.y0 - 6, 6], [b.y1, 7], [by * T + T - 5, 5]] as [number, number][]) {
      fillBoth(g, pc, rgb(wood), MK_TRIM, 0, y, w, hh); relief(pc, "#ffffff", 0, y, w, hh);
    }
  }
  for (let bx = 0; bx < 2; bx++) fillBoth(g, pc, rgb(wood), MK_TRIM, bx * T + T / 2 - 2.5, winBox(wn, 0, 0).y1, 5, h);
};
/** Prairie art glass, drawn over the casements: a lead-lined motif at the head of each light. */
const artGlassOver = (wn: Win, lights: number, lead: RGB, jewel: RGB[]): Painter => (g) => {
  for (const [bx, by] of BAYS) {
    const b = winBox(wn, bx, by), lw = (b.x1 - b.x0) / lights;
    for (let i = 0; i < lights; i++) {
      const cx = b.x0 + lw * (i + 0.5), y = b.y0 + 5;
      g.strokeStyle = rgb(lead); g.lineWidth = 0.9;
      g.beginPath(); g.rect(cx - lw * 0.3, y, lw * 0.6, 14); g.moveTo(cx, y + 14); g.lineTo(cx, b.y1 - 4); g.moveTo(cx - lw * 0.3, y + 7); g.lineTo(cx + lw * 0.3, y + 7); g.stroke();
      g.fillStyle = rgb(jewel[i % jewel.length]); g.fillRect(cx - 2, y + 2, 4, 4);
    }
  }
};

/** SHINGLE STYLE: cedar left to weather silver, every course a little ragged; fishscale bands on the fancier fronts. */
const shingleWall = (c: RGB, weather: number, fish = false): Painter => (g, w, h, rnd, _pc) => {
  shingles(g, rnd, c, 0, h, w, 8, 1.4, weather, 5, 13);
  if (fish) for (let by = 0; by < 2; by++) {
    for (let r = 0; r < 4; r++) for (let x = (r % 2) * 5 - 5; x < w + 10; x += 10) {
      const y = by * T + 2 + r * 6;
      g.fillStyle = rgb(c, 0.85 + rnd() * 0.25); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 4); g.arc(x + 5, y + 4, 5, Math.PI, 0, true); g.lineTo(x + 10, y); g.fill();
      g.strokeStyle = "rgba(20,16,12,0.4)"; g.lineWidth = 0.9; g.beginPath(); g.arc(x + 5, y + 4, 5, Math.PI, 0, true); g.stroke();
    }
  }
};

/** MISSION REVIVAL: lime stucco, splayed reveals round every arch, a quatrefoil pierced between them. */
const missionWall = (c: RGB, wn: Win, quatre: boolean, tile?: RGB): Painter => (g, w, h, rnd, pc) => {
  stuccoWall(c)(g, w, h, rnd);
  for (const [bx, by] of BAYS) {
    const b = winBox(wn, bx, by), half = (b.x1 - b.x0) / 2, cx = (b.x0 + b.x1) / 2;
    for (const [k, v] of [[7, 0.84], [3.5, 0.92]] as [number, number][]) {
      g.fillStyle = rgb(c, v); g.beginPath(); g.moveTo(b.x0 - k, b.y1 + 2); g.lineTo(b.x0 - k, b.y0 + half); g.arc(cx, b.y0 + half, half + k, Math.PI, 0); g.lineTo(b.x1 + k, b.y1 + 2); g.fill();
    }
    if (pc) { pc.hg.fillStyle = "#b0b0b0"; pc.hg.beginPath(); pc.hg.moveTo(b.x0 - 7, b.y1 + 2); pc.hg.lineTo(b.x0 - 7, b.y0 + half); pc.hg.arc(cx, b.y0 + half, half + 7, Math.PI, 0); pc.hg.lineTo(b.x1 + 7, b.y1 + 2); pc.hg.fill(); }
  }
  if (quatre) {
    const cx = T, cy = winBox(wn, 0, 0).y0 + 8, r = 5.5;
    const foil = (gg: CanvasRenderingContext2D, k: number) => { for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { gg.moveTo(cx + dx * 5 + r + k, cy + dy * 5); gg.arc(cx + dx * 5, cy + dy * 5, r + k, 0, 6.283); } };
    g.fillStyle = rgb(c, 1.06); g.beginPath(); foil(g, 3); g.fill();
    g.fillStyle = "rgb(46,38,32)"; g.beginPath(); foil(g, 0); g.fill();
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.beginPath(); foil(pc.hg, 3); pc.hg.fill(); pc.hg.fillStyle = "#303030"; pc.hg.beginPath(); foil(pc.hg, 0); pc.hg.fill(); }
  }
  // a clay-tile pent roof run along the floor line
  if (tile) for (let by = 0; by < 2; by++) {
    const y = by * T;
    fillBoth(g, pc, rgb(tile, 0.8), MK_ACC, 0, y, w, 9);
    for (let x = 0; x < w; x += 8) { pathBoth(g, pc, rgb(tile, 0.95 + rnd() * 0.15), MK_ACC, (gg) => { gg.moveTo(x + 7.6, y + 9); gg.arc(x + 3.8, y + 9, 3.8, 0, Math.PI); gg.rect(x + 0.4, y, 7, 9); }); g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x + 2, y, 1.5, 11); }
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, y + 13, w, 4);
    relief(pc, "#ffffff", 0, y, w, 13);
  }
};

/** ADOBE: earth plaster laid on by hand — mottled, straw-flecked, soft; vigas through the wall at the roof line. */
const adobeWall = (c: RGB, vigas: RGB | null, rough: number, coping?: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  relief(pc, "#d8d8d8", 0, 0, w, h);
  for (let i = 0; i < 260 * rough; i++) {
    const x = rnd() * w, y = rnd() * h, rx = 8 + rnd() * 26, ry = 4 + rnd() * 12;
    g.fillStyle = rgb(c, 0.88 + rnd() * 0.2); g.globalAlpha = 0.4; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 6.283); g.fill();
    if (pc) { pc.hg.fillStyle = rnd() < 0.5 ? "#ffffff" : "#c0c0c0"; pc.hg.globalAlpha = 0.5; pc.hg.beginPath(); pc.hg.ellipse(x, y, rx, ry, 0, 0, 6.283); pc.hg.fill(); pc.hg.globalAlpha = 1; }
  }
  g.globalAlpha = 1;
  // straw in the plaster
  for (let i = 0; i < 520 * rough; i++) {
    const x = rnd() * w, y = rnd() * h, a = rnd() * 3.14, L = 2 + rnd() * 4;
    g.strokeStyle = `rgba(236,206,150,${0.25 + rnd() * 0.3})`; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  specks(g, rnd, w, h, 900, 0.07, 1.2);
  if (vigas) {
    // the beam ends at the head of the upper floor, each staining the wall under it
    for (let x = 16; x < w; x += 32) {
      g.fillStyle = "rgba(60,40,24,0.18)"; g.fillRect(x - 2, 14, 4, 22 + rnd() * 18);
      g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(x + 1.5, 11, 7, 6.5, 0, 0, 6.283); g.fill();
      pathBoth(g, pc, rgb(vigas), MK_TRIM, (gg) => { gg.moveTo(x + 6, 9); gg.arc(x, 9, 6, 0, 6.283); });
      g.strokeStyle = rgb(vigas, 0.7); g.lineWidth = 0.8; g.beginPath(); g.arc(x, 9, 3.5, 0, 6.283); g.moveTo(x + 1.5, 9); g.arc(x, 9, 1.5, 0, 6.283); g.stroke();
      if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.beginPath(); pc.hg.arc(x, 9, 6, 0, 6.283); pc.hg.fill(); }
    }
  }
  if (coping) {
    // Territorial: a brick coping of three courses, the middle one dentilled
    const y = 0;
    for (const [yy, hh] of [[y, 5], [y + 11, 5]] as [number, number][]) for (let x = (yy % 2) * 8; x < w; x += 16) fillBoth(g, pc, rgb(coping, 0.88 + rnd() * 0.2), MK_TRIM, x + 0.6, yy + 0.6, 15, hh - 0.8);
    for (let x = 0; x < w; x += 10) { fillBoth(g, pc, rgb(coping, 0.92 + rnd() * 0.16), MK_TRIM, x + 0.6, y + 5.4, 6, 5.2); fillBoth(g, pc, "rgb(56,40,32)", MK_TRIM, x + 6.6, y + 5.4, 3.4, 5.2); }
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, y + 16, w, 3);
    relief(pc, "#ffffff", 0, y, w, 16);
  }
};

/** MEDITERRANEAN REVIVAL: warm stucco, a cast-stone string course, and a panel of glazed tile under every window. */
const medWall = (c: RGB, wn: Win, tiles: [RGB, RGB, RGB], stone: RGB): Painter => (g, w, h, rnd, pc) => {
  stuccoWall(c)(g, w, h, rnd);
  for (const [bx, by] of BAYS) {
    const b = winBox(wn, bx, by), x0 = b.x0 + 3, x1 = b.x1 - 3, y0 = b.y1 + 9, n = Math.floor((x1 - x0) / 7), tx = (x0 + x1) / 2 - (n * 7) / 2;
    fillBoth(g, pc, rgb(stone), MK_TRIM, tx - 2, y0 - 2, n * 7 + 4, 18);
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
      const x = tx + i * 7, y = y0 + j * 7;
      fillBoth(g, pc, rgb(tiles[(i + j) % 2]), MK_TRIM, x + 0.4, y + 0.4, 6.2, 6.2);
      pathBoth(g, pc, rgb(tiles[2]), MK_TRIM, (gg) => { gg.moveTo(x + 3.5, y + 1); gg.lineTo(x + 6, y + 3.5); gg.lineTo(x + 3.5, y + 6); gg.lineTo(x + 1, y + 3.5); gg.closePath(); });
      g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(x + 1, y + 1, 2, 1);
    }
    relief(pc, "#d8d8d8", tx, y0, n * 7, 14);
  }
  for (let by = 0; by < 2; by++) {
    const y = by * T + T - 7;
    fillBoth(g, pc, rgb(stone), MK_TRIM, 0, y, w, 5);
    for (let x = 0; x < w; x += 4) { g.fillStyle = rgb(stone, 0.78); g.fillRect(x, y + 1, 2, 3); }       // a rope moulding
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, y + 5, w, 2);
    relief(pc, "#ffffff", 0, y, w, 5);
  }
};

/** MIAMI BEACH DECO: smooth pastel render, an eyebrow shade over every window, fluted fins and a porthole on the piers. */
const beachWall = (c: RGB, fin: RGB, wn: Win, port = true): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) { g.fillStyle = rgb(c, 0.96 + rnd() * 0.06); g.globalAlpha = 0.4; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 10 + rnd() * 20, 5 + rnd() * 8, 0, 0, 6.283); g.fill(); }
  g.globalAlpha = 1;
  specks(g, rnd, w, h, 700, 0.03, 1);
  for (const [bx, by] of BAYS) {
    const b = winBox(wn, bx, by), y = b.y0 - 12, x0 = bx * T + 12, x1 = bx * T + T - 12;
    const sh = g.createLinearGradient(0, y + 7, 0, y + 26); sh.addColorStop(0, "rgba(0,0,0,0.42)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sh; g.fillRect(x0 + 3, y + 7, x1 - x0, 19);
    fillBoth(g, pc, rgb(c, 1.12), MK_TRIM, x0, y, x1 - x0, 7);
    g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(x0, y + 5.5, x1 - x0, 1.5);
    relief(pc, "#ffffff", x0, y, x1 - x0, 7);
  }
  // three raised flutes running up every other pier
  for (const x of [0, w]) for (const dx of [-11, -2.5, 6]) {
    fillBoth(g, pc, rgb(fin), MK_ACC, x + dx, 0, 5, h);
    g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(x + dx, 0, 1, h);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x + dx + 5, 0, 1.5, h);
    relief(pc, "#ffffff", x + dx, 0, 5, h);
  }
  if (port) {
    const cx = T, cy = T + T * 0.5;
    pathBoth(g, pc, "rgb(232,232,226)", MK_TRIM, (gg) => { gg.moveTo(cx + 16, cy); gg.arc(cx, cy, 16, 0, 6.283); });
    const gl = g.createLinearGradient(0, cy - 12, 0, cy + 12); gl.addColorStop(0, "#5a7a8a"); gl.addColorStop(1, "#24343e");
    g.fillStyle = gl; g.beginPath(); g.arc(cx, cy, 12, 0, 6.283); g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.arc(cx - 4, cy - 4, 3.5, 0, 6.283); g.fill();
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.beginPath(); pc.hg.arc(cx, cy, 16, 0, 6.283); pc.hg.fill(); pc.hg.fillStyle = "#505050"; pc.hg.beginPath(); pc.hg.arc(cx, cy, 12, 0, 6.283); pc.hg.fill(); }
  }
};

/** MIAMI MODERN: smooth painted concrete, a thin cantilevered slab at each floor and a fascia pierced with cheese-holes. */
const mimoWall = (c: RGB, fascia: RGB, wn: Win): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  specks(g, rnd, w, h, 800, 0.035, 1);
  const holes: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) holes.push([8 + i * 16, i % 2 ? 0.25 : 0.75, i % 4 === 0 ? 7 : 4.5]);
  for (let by = 0; by < 2; by++) {
    const oy = by * T, y0 = winBox(wn, 0, by).y1 + 3, y1 = oy + T - 3;
    fillBoth(g, pc, rgb(fascia), MK_TRIM, 0, y0, w, y1 - y0);
    g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(0, y0, w, 1.5);
    relief(pc, "#ffffff", 0, y0, w, y1 - y0);
    for (const [x, fy, r] of holes) {
      const y = y0 + r + 2 + fy * (y1 - y0 - 2 * r - 4);
      const hg2 = g.createRadialGradient(x - 1, y - 1, 0, x, y, r); hg2.addColorStop(0, "#2a2c2e"); hg2.addColorStop(1, "#4a4c4e");
      g.fillStyle = hg2; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      if (pc) { pc.hg.fillStyle = "#383838"; pc.hg.beginPath(); pc.hg.arc(x, y, r, 0, 6.283); pc.hg.fill(); }
    }
    // the floor slab's thin white edge, its shadow under it
    fillBoth(g, pc, "rgb(246,246,242)", MK_TRIM, 0, oy, w, 4);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, oy + 4, w, 3);
    relief(pc, "#ffffff", 0, oy, w, 4);
  }
};
/** The breeze-block screen, drawn in front of the glass of the bays given: blocks pierced with a circle and four petals. */
const screenOver = (col: RGB, bays: number[], wn: Win): Painter => (g, _w, _h, _rnd, pc) => {
  for (const bx of bays) for (let by = 0; by < 2; by++) {
    const x0 = bx * T + 6, x1 = bx * T + T - 6, y0 = by * T + 5, y1 = winBox(wn, bx, by).y1 + 1, s = 13;
    const nx = Math.floor((x1 - x0) / s), ox = (x0 + x1) / 2 - (nx * s) / 2, ny = Math.floor((y1 - y0) / s), oy = y1 - ny * s;
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(ox + 2, oy + 2, nx * s, ny * s);
    pathBoth(g, pc, rgb(col), MK_ACC, (gg) => {
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = ox + i * s, y = oy + j * s, cx = x + s / 2, cy = y + s / 2;
        gg.rect(x, y, s, s);
        gg.moveTo(cx + 3.6, cy); gg.arc(cx, cy, 3.6, 0, 6.283);
        for (const [dx, dy] of [[0, 0], [s, 0], [0, s], [s, s]]) { gg.moveTo(x + dx + (dx ? -2.6 : 2.6), y + dy); gg.arc(x + dx, y + dy, 2.6, dx ? Math.PI : 0, dx ? Math.PI * 1.5 : Math.PI * 0.5, !!dx !== !!dy); }
      }
    }, "evenodd");
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(ox, oy, nx * s, ny * s); }
  }
};

/** DUTCH COLONIAL: even painted shingle above a flared skirt; clapboard, red sandstone or brick below. */
const dutchWall = (upper: RGB, lower: RGB, kind: "clap" | "stone" | "brick", trim: RGB): Painter => (g, w, _h, rnd, pc) => {
  shingles(g, rnd, upper, 0, T, w, 10, 0.3, 0.07, 12, 18);
  if (kind === "clap") boards(g, rnd, lower, 0, T, w, 2 * T, 8, 0.32);
  else if (kind === "brick") {
    g.fillStyle = "#b0a492"; g.fillRect(0, T, w, T);
    for (let y = T, r = 0; y < 2 * T; y += 6.4, r++) for (let x = -((r % 2) * 8); x < w; x += 16) { g.fillStyle = rgb(lower, 0.84 + rnd() * 0.26); g.fillRect(x + 1, y + 1, 14.5, 5); }
  } else {
    // Jersey Dutch red sandstone, roughly squared, in irregular courses
    g.fillStyle = rgb(lower, 0.55); g.fillRect(0, T, w, T);
    let y = T;
    while (y < 2 * T) {
      const rh = Math.min(13 + rnd() * 9, 2 * T - y);
      let x = -rnd() * 20;
      while (x < w) {
        const L = 20 + rnd() * 26, v = 0.86 + rnd() * 0.24;
        g.fillStyle = rgb(lower, v); g.fillRect(x + 1.5, y + 1.5, L - 3, rh - 3);
        g.fillStyle = rgb(lower, v * 1.1); g.fillRect(x + 2, y + 2, L - 4, 2);
        relief(pc, "#ffffff", x + 1.5, y + 1.5, L - 3, rh - 3);
        x += L;
      }
      y += rh;
    }
  }
  // the flared skirt between the storeys
  fillBoth(g, pc, rgb(trim), MK_TRIM, 0, T - 7, w, 7);
  const sh = g.createLinearGradient(0, T, 0, T + 12); sh.addColorStop(0, "rgba(0,0,0,0.42)"); sh.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = sh; g.fillRect(0, T, w, 12);
  relief(pc, "#ffffff", 0, T - 7, w, 7);
  for (const x of [0, w - 5]) fillBoth(g, pc, rgb(trim), MK_TRIM, x, T, 5, T);
};

/** SANTA BARBARA WHITEWASH: thick, hand-troweled lime over deep-set openings — the reveal is a shadow round every window. */
const whitewashWall = (c: RGB, wn: Win, jitter: number): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rgb(c, 0.95 + rnd() * 0.07); g.globalAlpha = 0.5;
    g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 12 + rnd() * 26, 6 + rnd() * 12, rnd() * 3, 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
  specks(g, rnd, w, h, 600, 0.03, 1.2);
  for (const [bx, by] of BAYS) {
    const b = winBox(wn, bx, by, jitter);
    g.fillStyle = rgb(c, 0.74); g.fillRect(b.x0 - 6, b.y0 - 6, b.x1 - b.x0 + 9, 6); g.fillRect(b.x0 - 6, b.y0 - 6, 6, b.y1 - b.y0 + 8);
    g.fillStyle = rgb(c, 0.88); g.fillRect(b.x1, b.y0 - 3, 4, b.y1 - b.y0 + 5); g.fillRect(b.x0 - 6, b.y1, b.x1 - b.x0 + 10, 4);
    relief(pc, "#7a7a7a", b.x0 - 6, b.y0 - 6, b.x1 - b.x0 + 10, b.y1 - b.y0 + 10);
  }
};
/** Wrought-iron rejas in front of the glass: bars with collars, a rail top and bottom, scrolls on the crest. */
const rejaOver = (iron: RGB, wn: Win, jitter: number, which: number[]): Painter => (g, _w, _h, _rnd, pc) => {
  const col = rgb(iron);
  BAYS.forEach(([bx, by], i) => {
    if (!which.includes(i)) return;
    const b = winBox(wn, bx, by, jitter), x0 = b.x0 - 3, x1 = b.x1 + 3, y0 = b.y0 + 2, y1 = b.y1 + 2;
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let x = x0 + 4; x < x1 - 2; x += 6) g.fillRect(x + 2, y0 + 2, 1.6, y1 - y0);
    for (let x = x0 + 4; x < x1 - 2; x += 6) {
      fillBoth(g, pc, col, MK_ACC, x, y0, 1.7, y1 - y0);
      for (const f of [0.33, 0.66]) fillBoth(g, pc, col, MK_ACC, x - 1, y0 + (y1 - y0) * f - 1.5, 3.7, 3);
    }
    for (const y of [y0, y1 - 2]) fillBoth(g, pc, col, MK_ACC, x0, y, x1 - x0, 2);
    const cx = (x0 + x1) / 2;
    strokeBoth(g, pc, col, MK_ACC, 1.5, (gg) => {
      gg.moveTo(cx, y0); gg.bezierCurveTo(cx - 4, y0 - 9, cx - 14, y0 - 7, cx - 12, y0 - 2);
      gg.moveTo(cx, y0); gg.bezierCurveTo(cx + 4, y0 - 9, cx + 14, y0 - 7, cx + 12, y0 - 2);
      gg.moveTo(cx, y0); gg.lineTo(cx, y0 - 10);
    });
  });
};
/** A Monterey balcony of turned wood running across the front at the sill of the upper floor. */
const balconyOver = (wood: RGB, wn: Win): Painter => (g, _w, _h, _rnd, pc) => {
  const y = winBox(wn, 0, 0).y1 + 1, col = rgb(wood);
  g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, y + 4, 2 * T, 6);
  fillBoth(g, pc, col, MK_ACC, 0, y, 2 * T, 4.5);
  fillBoth(g, pc, col, MK_ACC, 0, y - 26, 2 * T, 3.5);
  for (let x = 2; x < 2 * T; x += 6) { fillBoth(g, pc, col, MK_ACC, x, y - 23, 2.4, 23); fillBoth(g, pc, col, MK_ACC, x - 0.6, y - 13, 3.6, 3); }
  relief(pc, "#ffffff", 0, y - 26, 2 * T, 30);
};

/** CHARLESTON STUCCO: lime render scored into ashlar blocks, the joints picked out. */
const scoredStucco = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  stuccoWall(c)(g, w, h, rnd);
  const ch = h / 12;
  for (let y = 0, r = 0; y < h - 0.5; y += ch, r++) {
    g.fillStyle = "rgba(70,56,44,0.32)"; g.fillRect(0, y, w, 1);
    g.fillStyle = "rgba(255,255,255,0.22)"; g.fillRect(0, y + 1, w, 0.8);
    relief(pc, "#b0b0b0", 0, y, w, 1);
    for (let x = (r % 2) * 32; x < w; x += 64) { g.fillStyle = "rgba(70,56,44,0.3)"; g.fillRect(x, y, 1, ch); relief(pc, "#b0b0b0", x, y, 1, ch); }
  }
};
/** Beaded weatherboard: the Lowcountry's wide clapboard with a bead run along each lower edge. */
const beadedBoard = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 10.667) {
    g.fillStyle = rgb(c, 0.97 + rnd() * 0.05); g.fillRect(0, y, w, 10.667);
    g.fillStyle = "rgba(40,36,30,0.36)"; g.fillRect(0, y, w, 1.4);
    g.fillStyle = "rgba(40,36,30,0.25)"; g.fillRect(0, y + 8.6, w, 0.9);         // the bead's quirk
    g.fillStyle = "rgba(255,255,255,0.22)"; g.fillRect(0, y + 9.5, w, 0.9);
    relief(pc, "#c0c0c0", 0, y, w, 1.4);
  }
};

// ---- the paints ----------------------------------------------------------------
const WHITE = "#f1ede4", CREAM = "#e8dcc2", IVORY = "#efe6d0", BLACK = "#222324", CHARCOAL = "#3a3c3e", FOREST = "#2f4a3a",
  OXBLOOD = "#5c2622", NAVY = "#25324a", BROWN = "#5a3e2c", STONE = "#d6ccb6", SILVER = "#c4c8cc", GREY = "#9a9c98",
  CHAS_GREEN = "#1f2b25", TAOS_BLUE = "#3f6f8f", TURQ = "#4fa3a0";

// ---- the families --------------------------------------------------------------
const W_TWO: Win = { x0: 0.27, x1: 0.73, y0: 0.22, y1: 0.80 };
const W_TWO3: Win = { x0: 0.12, x1: 0.88, y0: 0.22, y1: 0.80 };
const W_GREY: Win = { x0: 0.27, x1: 0.73, y0: 0.2, y1: 0.82 };
const W_TEN: Win = { x0: 0.3, x1: 0.7, y0: 0.24, y1: 0.8 };
const W_SHOT: Win = { x0: 0.33, x1: 0.67, y0: 0.05, y1: 0.8 };
const W_LADY: Win = { x0: 0.33, x1: 0.67, y0: 0.38, y1: 0.84 };
const W_PRAIRIE: Win = { x0: 0.0, x1: 1.0, y0: 0.36, y1: 0.76 };
const W_PRAIRIE2: Win = { x0: 0.08, x1: 0.92, y0: 0.36, y1: 0.76 };
const W_MISSION: Win = { x0: 0.31, x1: 0.69, y0: 0.18, y1: 0.8 };
const W_MISSION2: Win = { x0: 0.2, x1: 0.8, y0: 0.18, y1: 0.78 };
const W_MED: Win = { x0: 0.3, x1: 0.7, y0: 0.32, y1: 0.86 };
const W_BEACH: Win = { x0: 0.2, x1: 0.8, y0: 0.3, y1: 0.72 };
const W_MIMO: Win = { x0: 0.06, x1: 0.94, y0: 0.36, y1: 0.93 };
const W_SC: Win = { x0: 0.33, x1: 0.67, y0: 0.3, y1: 0.74 };
const W_SC2: Win = { x0: 0.3, x1: 0.7, y0: 0.24, y1: 0.8 };
const W_CHAS: Win = { x0: 0.31, x1: 0.69, y0: 0.12, y1: 0.86 };

export const BOOK_STREET: BookEntry[] = [
  // CHICAGO TWO-FLAT, 1895-1930: one flat over another behind a front of
  // pressed face brick, banded by limestone sill and lintel courses — the
  // bungalow belt and the South and West Sides by the tens of thousands.
  {
    key: "twoflat", like: "brick",
    spec: { bayW: 2.6, floorH: 3.4, masonry: true, glass: false, win: W_TWO, wall: twoFlatWall([150, 62, 44], [214, 206, 186], W_TWO),
      glassCol: "#3a4e5a", frameCol: "#f0ece2", wallRough: 0.82, glassRough: 0.1, glassMetal: 0.0, trim: "#d6ceba", mullions: [1, 2], reveal: 3.0 },
    variants: [
      { wall: twoFlatWall([206, 168, 112], [226, 220, 204], W_TWO3, "#7a6a58"), win: W_TWO3, winStyle: "triple", trim: "#e2dccc", frameCol: "#2a2a2a" },
      { wall: twoFlatWall([104, 58, 46], [196, 184, 160], W_TWO, "#3e3632"), winStyle: "segment", trim: "#c4b8a0", frameCol: "#e8e2d4" },
      { wall: twoFlatWall([184, 96, 60], [220, 212, 194], W_TWO, "#6a5a4e"), winStyle: "pair", trim: "#dcd4c0", frameCol: "#2a3a2e" },
    ],
    tints: [[1, 1, 1], [0.92, 0.88, 0.86], [1.05, 1.0, 0.94], [0.88, 0.84, 0.84]],
    palette: P(0.04, [CREAM, GREY], 0.2, [STONE, CREAM, IVORY], 0.75, [BLACK, WHITE, FOREST, BROWN, CHARCOAL, OXBLOOD]),
    picker: { group: "street", name: "Chicago two-flat", era: "1895-1930", maxFloors: 3, variants: ["Red face brick, stone bands", "Buff, three-light bay", "Dark brown, segmental", "Orange brick, paired"] },
    city: [
      { parent: "brick", share: 0.1, from: 1895, to: 1930, minH: 5, maxH: 12, cls: ["multifamily"] },
      { parent: "buff", share: 0.08, from: 1895, to: 1930, minH: 5, maxH: 12, cls: ["multifamily"] },
    ],
  },
  // CHICAGO GREYSTONE, 1890-1920: the same flat building fronted in Bedford
  // limestone from Indiana, rock-faced courses between smooth bands.
  {
    key: "greystone", like: "brownstone",
    spec: { bayW: 3.0, floorH: 3.6, masonry: true, glass: false, win: W_GREY, wall: greystoneWall([188, 182, 166]), lintel: "keystone",
      glassCol: "#34485a", frameCol: "#2a2a28", wallRough: 0.86, glassRough: 0.1, glassMetal: 0.0, trim: "#d8d2c2", mullions: [1, 3], reveal: 4.0 },
    variants: [
      { wall: greystoneWall([206, 200, 186]), winStyle: "arch", trim: "#e2dcd0", frameCol: "#e8e4da" },
      { wall: greystoneWall([196, 178, 148]), lintel: "pediment", trim: "#e0d4bc", frameCol: "#3a2e24" },
      { wall: greystoneWall([150, 152, 150]), lintel: "hood", trim: "#c8c8c2", frameCol: "#1e2226", mullions: [2, 2] },
    ],
    tints: [[1, 1, 1], [0.96, 0.95, 0.92], [1.03, 1.01, 0.97]],
    palette: P(0, [], 0.15, [STONE, CREAM], 0.8, [BLACK, OXBLOOD, FOREST, BROWN, WHITE, NAVY]),
    picker: { group: "street", name: "Chicago greystone", era: "1890-1920", maxFloors: 4, variants: ["Rock-faced, keystoned", "Pale, arched", "Buff, pedimented", "Blue-grey, hooded"] },
    city: [{ parent: "brownstone", share: 0.16, from: 1890, to: 1920, minH: 6, maxH: 15, cls: ["multifamily"] }],
  },
  // TRIPLE-DECKER, 1880-1930: three flats stacked under a flat roof, each
  // with its porch — Worcester, Dorchester, Pawtucket, the New England mill
  // town's own house. Narrow clapboard, corner boards, a frieze at each floor;
  // re-sided in asbestos shingle after the war.
  {
    key: "tripledecker", like: "clapboard",
    spec: { bayW: 2.6, floorH: 3.0, masonry: false, glass: false, win: { x0: 0.33, x1: 0.67, y0: 0.2, y1: 0.78 }, wall: deckerWall([214, 208, 190], [242, 238, 228]),
      glassCol: "#34444e", frameCol: "#f4f1ea", wallRough: 0.8, glassRough: 0.12, glassMetal: 0.0, trim: "#f2eee4", mullions: [1, 2], reveal: 1.6 },
    variants: [
      { wall: cementShingle([170, 182, 168], [236, 234, 226]), frameCol: "#2a2c2a", trim: "#ece8dc" },
      { wall: deckerWall([196, 176, 120], [90, 50, 40], 6), winStyle: "pair", trim: "#5a3428", frameCol: "#f0ece2", win: { x0: 0.18, x1: 0.82, y0: 0.2, y1: 0.78 } },
      { wall: deckerWall([150, 166, 178], [238, 234, 222]), lintel: "hood", trim: "#ece8dc", frameCol: "#2a2a2a" },
    ],
    tints: [[1, 1, 1], [1.0, 0.96, 0.88], [0.9, 0.94, 0.9]],
    palette: P(0.9, [WHITE, "#d8d2c0", "#b8c2b0", "#a9b8c4", "#c9b48a", GREY, "#8e9a8a", "#c8a890", "#7d8e9c"],
      0.7, [WHITE, IVORY, CREAM, "#5a3428"], 0.8, [BLACK, FOREST, OXBLOOD, NAVY, WHITE, CHARCOAL]),
    style: "vernacular",
    picker: { group: "street", name: "Triple-decker", era: "1880-1930", maxFloors: 3, variants: ["Narrow clapboard", "Asbestos shingle", "Mustard, paired", "Blue-grey, hooded"] },
    city: [
      { parent: "brick", share: 0.06, from: 1880, to: 1930, minH: 8.5, maxH: 12, cls: ["multifamily"] },
      { parent: "clapboard", share: 0.08, from: 1880, to: 1930, minH: 6, cls: ["multifamily"] },
    ],
  },
  // THE PHILADELPHIA ROW, 1820-1920: a city of two- and three-storey brick
  // rows, Baltimore's the same — smooth pressed red brick with buttered
  // joints, white marble lintels and steps, panelled shutters; the Federal
  // fronts in Flemish bond with glazed headers.
  {
    key: "phillyrow", like: "brick",
    spec: { bayW: 2.2, floorH: 3.3, masonry: true, glass: false, win: { x0: 0.3, x1: 0.7, y0: 0.2, y1: 0.8 }, wall: pressedBrick([166, 56, 40]),
      glassCol: "#32424c", frameCol: "#f4f1ea", wallRough: 0.6, glassRough: 0.1, glassMetal: 0.0, trim: "#f2f0ea", lintel: "flat", shutter: "#1e2422", mullions: [2, 3], reveal: 2.8 },
    variants: [
      { wall: pressedBrick([150, 60, 44], [92, 66, 66]), lintel: "keystone", trim: "#f0eee6", shutter: undefined, mullions: [3, 3] },
      { wall: pressedBrick([188, 84, 56]), trim: "#ffffff", shutter: "#f0eee6", frameCol: "#f4f1ea" },
      { wall: pressedBrick([128, 54, 42]), winStyle: "pair", lintel: "hood", trim: "#d8d0bc", shutter: undefined, frameCol: "#2a2a2a", mullions: [1, 2], win: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 } },
    ],
    tints: [[1, 1, 1], [0.94, 0.9, 0.9], [1.05, 0.98, 0.94]],
    palette: P(0.1, [WHITE, CREAM, GREY, "#8a3a2e"], 0.15, [WHITE, IVORY], 0.8, [BLACK, CHAS_GREEN, WHITE, OXBLOOD, NAVY, FOREST]),
    picker: { group: "street", name: "Philadelphia row", era: "1820-1920", maxFloors: 3, variants: ["Pressed red, marble lintels", "Federal, glazed headers", "Baltimore, white shutters", "Porch-front, paired"] },
    city: [{ parent: "brick", share: 0.1, from: 1820, to: 1920, maxH: 12, cls: ["multifamily", "retail"] }],
  },
  // FORMSTONE, 1937-1965: "the polyester of brick" — cement sprayed over the
  // old row-house front and moulded into fake stone, sold door to door in
  // Baltimore and East Baltimore's rows still wear it. Aluminium sash.
  {
    key: "formstone", like: "brick",
    spec: { bayW: 2.3, floorH: 3.1, masonry: true, glass: false, win: { x0: 0.3, x1: 0.7, y0: 0.24, y1: 0.78 },
      wall: formstoneWall([[176, 172, 164], [196, 184, 162], [150, 148, 146], [206, 198, 184]], [222, 218, 210]),
      glassCol: "#3c4e58", frameCol: "#c8ccd0", wallRough: 0.88, glassRough: 0.08, glassMetal: 0.3, trim: "#d4d0c8", mullions: [1, 2], reveal: 3.2 },
    variants: [
      { wall: formstoneWall([[190, 150, 140], [206, 172, 156], [170, 140, 132], [214, 196, 184]], [226, 218, 210]), frameCol: "#e8e8e4", trim: "#d8ccc4" },
      { wall: formstoneWall([[196, 170, 128], [176, 150, 116], [214, 192, 150], [160, 140, 116]], [210, 200, 182]), frameCol: "#b8bcc0", trim: "#cfc4b0", winStyle: "pair", win: { x0: 0.18, x1: 0.82, y0: 0.24, y1: 0.78 } },
      { wall: formstoneWall([[140, 150, 160], [160, 166, 172], [120, 128, 138], [176, 180, 182]], [206, 208, 210]), frameCol: "#f0f0ee", trim: "#c8ccd0" },
    ],
    tints: [[1, 1, 1], [0.95, 0.95, 0.95]],
    palette: P(0.06, [WHITE, CREAM], 0.2, [WHITE, SILVER], 0.5, [WHITE, SILVER, BLACK, CHARCOAL, "#8a2a24"]),
    style: "vernacular",
    picker: { group: "street", name: "Formstone", era: "applied 1937-1965", maxFloors: 4, variants: ["Grey and buff", "Rose", "Tan, paired sash", "Slate blue"] },
    city: [{ parent: "brick", share: 0.05, from: 1860, to: 1925, maxH: 12, cls: ["multifamily", "retail"] }],
  },
  // THE DUMBBELL TENEMENT, 1879-1901: five to seven storeys of walk-up flats
  // on a 25-foot lot under the Old Law, the Lower East Side's own —
  // common brick, a corbelled brick cornice at each floor, stone lintels,
  // and the iron fire escape zigzagging down the front.
  {
    key: "tenement", like: "brick",
    spec: { bayW: 2.4, floorH: 3.1, masonry: true, glass: false, win: W_TEN, wall: tenementWall([164, 80, 58]), over: fireEscapeOver([38, 38, 38], W_TEN),
      glassCol: "#34444e", frameCol: "#e6e0d2", wallRough: 0.9, glassRough: 0.12, glassMetal: 0.0, trim: "#d4c8b0", lintel: "hood", mullions: [1, 2], reveal: 3.2 },
    variants: [
      { wall: tenementWall([200, 168, 120]), over: fireEscapeOver([30, 34, 32], W_TEN), winStyle: "segment", trim: "#7a5a44", frameCol: "#2a2a2a" },
      { wall: tenementWall([120, 66, 52]), over: fireEscapeOver([40, 40, 42], W_TEN), lintel: "pediment", trim: "#c8b8a0", frameCol: "#f0ece2" },
      { wall: tenementWall([150, 150, 142]), over: fireEscapeOver([46, 74, 56], W_TEN), lintel: "flat", trim: "#e8e2d4", frameCol: "#2a3a2e" },
    ],
    tints: [[1, 1, 1], [0.88, 0.82, 0.8], [1.06, 0.98, 0.9], [0.8, 0.7, 0.66]],
    style: "vernacular",
    picker: { group: "street", name: "Dumbbell tenement", era: "1879-1910", maxFloors: 7, variants: ["Red, black fire escape", "Buff, segmental", "Brown, pedimented", "Painted, green iron"] },
    city: [
      { parent: "brick", share: 0.12, from: 1879, to: 1910, minH: 13, maxH: 25, cls: ["multifamily"] },
      { parent: "buff", share: 0.06, from: 1879, to: 1910, minH: 13, maxH: 25, cls: ["multifamily"] },
    ],
  },
  // SHOTGUN COTTAGE, 1850-1920: New Orleans' one-room-wide house, rooms in
  // a line front to back — tall floor-length openings behind louvered
  // shutters, drop siding, a jigsawn gingerbread frieze on brackets.
  {
    key: "shotgun", like: "clapboard",
    spec: { bayW: 2.3, floorH: 4.0, masonry: false, glass: false, win: W_SHOT, wall: shotgunWall([226, 218, 196], [244, 240, 230], [244, 240, 230]),
      glassCol: "#34444e", frameCol: "#f4f1ea", wallRough: 0.82, glassRough: 0.12, glassMetal: 0.0, trim: "#f4f1ea", lintel: "flat", shutter: "#2c5a46", mullions: [2, 4], reveal: 2.0 },
    variants: [
      { wall: shotgunWall([186, 168, 200], [244, 240, 232], [96, 54, 96]), shutter: "#3e2a44", lintel: "pediment", trim: "#f2eee6" },
      { wall: shotgunWall([236, 204, 110], [246, 242, 232], [64, 110, 92]), shutter: "#2f5a4a" },
      { wall: shotgunWall([172, 210, 186], [246, 242, 232], [190, 80, 66]), shutter: "#b85040", frameCol: "#2a2a2a" },
    ],
    tints: [[1, 1, 1], [1.02, 0.96, 0.92], [0.94, 0.98, 1.02]],
    palette: P(1, ["#e8b4a4", "#b9a8cc", "#e8cf7e", "#a8cfb6", "#9ec2d6", "#f0e6d0", "#d88a70", "#c9d58e", "#e0a0b0", WHITE],
      0.6, [WHITE, IVORY, "#f6efe0"], 0.9, ["#2c5a46", "#1f3a4a", "#5a2a3a", "#b85040", "#3e6e8e", CHAS_GREEN, "#7a4a8a", "#c88a2a"]),
    style: "vernacular",
    picker: { group: "street", name: "Shotgun cottage", era: "1850-1920", maxFloors: 2, variants: ["Cream, green louvres", "Lavender, Eastlake", "Creole yellow", "Mint, red shutters"] },
    city: [{ parent: "clapboard", share: 0.1, from: 1850, to: 1920, maxH: 8, cls: ["multifamily"] }],
  },
  // PAINTED LADY, 1870-1905: San Francisco's Italianate and Stick row
  // houses, bay over bay, every board and bracket picked out — body, trim
  // and accent in three colours, the carved aprons and the frieze in a fourth.
  {
    key: "paintedlady", like: "clapboard",
    spec: { bayW: 2.4, floorH: 3.7, masonry: false, glass: false, win: W_LADY, wall: ladyWall([136, 158, 132], [236, 226, 196], [120, 40, 42], W_LADY),
      glassCol: "#2e3e48", frameCol: "#f0e6cc", wallRough: 0.78, glassRough: 0.1, glassMetal: 0.0, trim: "#ece2c4", lintel: "pediment", mullions: [1, 2], reveal: 2.4 },
    variants: [
      { wall: ladyWall([232, 220, 190], [110, 72, 52], [64, 92, 72], W_LADY), winStyle: "segment", trim: "#6e4834", frameCol: "#3a5a46" },
      { wall: ladyWall([206, 150, 120], [242, 232, 206], [80, 56, 92], W_LADY, true), lintel: "hood", trim: "#f0e6cc", frameCol: "#50385c" },
      { wall: ladyWall([92, 116, 150], [218, 182, 92], [242, 236, 220], W_LADY), winStyle: "segment", lintel: "hood", trim: "#d8b45c", frameCol: "#f2ecdc" },
    ],
    tints: [[1, 1, 1], [0.96, 0.98, 1.02], [1.03, 1.0, 0.95]],
    palette: P(1, ["#8a9e84", "#c9a24a", "#7d8ea6", "#b07a6a", "#6a5a7a", "#a8946a", "#5e7a72", "#d8c8a0", "#b8846e", "#6e7f52", "#c4a8b8"],
      1, [IVORY, CREAM, "#e8d4a0", "#d8b45c", WHITE, "#7a4a3a", "#f0e0c8"], 1, [OXBLOOD, "#3e5a46", "#5a3a5c", "#2a3e5a", "#c88a2a", "#7a2a2a", "#1e4a4a", "#a8402e"]),
    picker: { group: "street", name: "Painted lady", era: "1870-1905", maxFloors: 4, variants: ["Stick, three colours", "Italianate, segmental", "Queen Anne, fishscale", "Blue and gold"] },
    city: [
      { parent: "clapboard", share: 0.1, from: 1870, to: 1905, maxH: 8.5, cls: ["multifamily", "retail"] },
      { parent: "brick", share: 0.03, from: 1870, to: 1905, minH: 8.5, maxH: 14, cls: ["multifamily"] },
    ],
  },

  // ===== Regional & revival =====

  // CRAFTSMAN, 1905-1930: the bungalow and its two-storey cousin of
  // Pasadena, Portland and every streetcar suburb — stained shingle over
  // lap siding, a wide belt course, knee braces, windows ganged in threes.
  {
    key: "craftsman", like: "clapboard",
    spec: { bayW: 3.2, floorH: 2.9, masonry: false, glass: false, win: { x0: 0.14, x1: 0.86, y0: 0.3, y1: 0.76 }, wall: craftsmanWall([112, 84, 58], [150, 142, 104], [222, 210, 178], [76, 54, 38]),
      winStyle: "triple", glassCol: "#34403e", frameCol: "#e6dcc0", wallRough: 0.86, glassRough: 0.12, glassMetal: 0.0, trim: "#e2d6b8", mullions: [1, 2], reveal: 2.2 },
    variants: [
      { wall: craftsmanWall([96, 102, 70], [176, 160, 120], [236, 226, 198], [60, 48, 34]), frameCol: "#3a2a20", trim: "#ece2c8" },
      { wall: craftsmanWall([130, 92, 60], [120, 84, 58], [226, 214, 180], [90, 62, 40]), winStyle: "pair", trim: "#e6d8b8", frameCol: "#e8dcc0" },
      { wall: craftsmanWall([96, 110, 102], [150, 160, 144], [214, 206, 186], [70, 50, 40]), frameCol: "#7a2e24", trim: "#d8ccb0" },
    ],
    tints: [[1, 1, 1], [0.95, 0.94, 0.9], [1.04, 1.0, 0.94]],
    palette: P(0.85, ["#8a8a5e", "#7a6a4a", "#9aa284", "#a8845a", "#6e7a6a", "#b8a47a", "#5e5a44", "#8c6a52", "#a4a890"],
      0.6, [CREAM, IVORY, "#d8ccb0", "#3a2a20"], 0.85, ["#5a3a26", "#3a2a20", "#7a2e24", "#2f4a3a", "#3e4a3a", "#7a5a2a"]),
    style: "vernacular",
    picker: { group: "regional", name: "Craftsman", era: "1905-1930", maxFloors: 3, variants: ["Shingle over lap", "Olive, dark sash", "Brown, paired", "Grey-green, red sash"] },
    city: [{ parent: "clapboard", share: 0.12, from: 1905, to: 1930, cls: ["multifamily"] }],
  },
  // PRAIRIE SCHOOL, 1900-1925: Wright, Sullivan's office, Griffin, Purcell
  // and Elmslie — Roman brick with raked bed joints, sill and head running
  // as continuous bands, casements in a ribbon under art glass.
  {
    key: "prairie", like: "buff",
    spec: { bayW: 3.4, floorH: 3.2, masonry: true, glass: false, win: W_PRAIRIE, wall: romanBrick([176, 134, 92], [222, 208, 178], W_PRAIRIE),
      over: artGlassOver(W_PRAIRIE, 4, [70, 60, 44], [[200, 150, 60], [96, 130, 80]]),
      glassCol: "#3a4a48", frameCol: "#4a3a2a", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.0, trim: "#ddd0b0", mullions: [4, 1], reveal: 2.6 },
    variants: [
      { wall: prairieStucco([222, 208, 178], [92, 66, 44], W_PRAIRIE2), win: W_PRAIRIE2, over: artGlassOver(W_PRAIRIE2, 4, [60, 50, 40], [[180, 70, 50], [200, 160, 70]]), trim: "#5c4230", frameCol: "#5c4230" },
      { wall: romanBrick([110, 72, 56], [196, 184, 160], W_PRAIRIE), over: artGlassOver(W_PRAIRIE, 4, [40, 36, 30], [[110, 140, 90]]), trim: "#c8bca0", frameCol: "#2a2622" },
      { wall: romanBrick([212, 188, 140], [140, 110, 76], W_PRAIRIE), over: artGlassOver(W_PRAIRIE, 4, [60, 50, 40], [[200, 150, 60], [160, 70, 50]]), trim: "#8c6c4a", frameCol: "#3a2e24", mullions: [3, 1] },
    ],
    tints: [[1, 1, 1], [0.95, 0.93, 0.9], [1.04, 1.0, 0.95]],
    palette: P(0.03, [CREAM], 0.3, [STONE, CREAM, "#5c4230"], 0.7, [BROWN, "#4a3a2a", "#3e4a3a", BLACK, "#6a4a2a"]),
    style: "midcentury",
    picker: { group: "regional", name: "Prairie School", era: "1900-1925", maxFloors: 4, variants: ["Roman brick, ribbon", "Stucco and wood bands", "Iron-spot brick", "Buff, art glass"] },
    city: [{ parent: "buff", share: 0.1, from: 1900, to: 1925, maxH: 15, cls: ["multifamily", "office", "retail"] }],
  },
  // SHINGLE STYLE, 1880-1910: Newport, the North Shore, the summer colony
  // and the suburb after it — the whole house wrapped in cedar shingle left
  // to weather silver, small-paned sash, fishscale on the fancier fronts.
  {
    key: "shingle", like: "clapboard",
    spec: { bayW: 2.8, floorH: 3.0, masonry: false, glass: false, win: { x0: 0.24, x1: 0.76, y0: 0.28, y1: 0.78 }, wall: shingleWall([150, 142, 128], 0.36),
      winStyle: "pair", glassCol: "#34444e", frameCol: "#f2f0ea", wallRough: 0.92, glassRough: 0.12, glassMetal: 0.0, trim: "#f0ece2", mullions: [2, 3], reveal: 2.0 },
    variants: [
      { wall: shingleWall([172, 120, 76], 0.24), frameCol: "#2f4a3a", trim: "#ece4d0" },
      { wall: shingleWall([140, 136, 128], 0.3, true), frameCol: "#f2f0ea", winStyle: "rect", win: { x0: 0.3, x1: 0.7, y0: 0.28, y1: 0.78 }, mullions: [2, 4] },
      { wall: shingleWall([88, 70, 56], 0.26), frameCol: "#8a2e22", trim: "#d8c8a8" },
    ],
    tints: [[1, 1, 1], [0.94, 0.94, 0.96], [1.04, 1.0, 0.94]],
    palette: P(0.1, ["#8a8478", "#6a5e50"], 0.5, [WHITE, IVORY, CREAM, "#2f4a3a"], 0.85, [WHITE, "#2f4a3a", "#8a2e22", BLACK, "#3e4a5a", "#c8b890"]),
    picker: { group: "regional", name: "Shingle style", era: "1880-1910", maxFloors: 4, variants: ["Weathered cedar", "Fresh cedar, green sash", "Fishscale bands", "Dark stain, red sash"] },
    city: [{ parent: "clapboard", share: 0.06, from: 1880, to: 1910, cls: ["multifamily"] }],
  },
  // MISSION REVIVAL, 1890-1930: California's first regional style, after
  // the Franciscan missions — plain lime stucco, deep round arches, a
  // quatrefoil pierced in the wall, the odd tile-roofed pent.
  {
    key: "mission", like: "stucco",
    spec: { bayW: 3.2, floorH: 3.6, masonry: false, glass: false, win: W_MISSION, wall: missionWall([240, 234, 220], W_MISSION, true), winStyle: "arch",
      glassCol: "#30404a", frameCol: "#4a3424", wallRough: 0.92, glassRough: 0.12, glassMetal: 0.0, mullions: [2, 3], reveal: 5.4 },
    variants: [
      { wall: missionWall([222, 202, 166], W_MISSION2, false), win: W_MISSION2, frameCol: "#3a2a20", mullions: [3, 3] },
      { wall: missionWall([236, 222, 196], W_MISSION, true, [176, 82, 52]), frameCol: "#2f4a3a" },
      { wall: missionWall([214, 176, 120], W_MISSION, false), frameCol: "#3a2a20", mullions: [1, 2] },
    ],
    tints: [[1, 1, 1], [1.0, 0.97, 0.92], [0.97, 0.96, 0.95]],
    palette: P(0.9, [WHITE, IVORY, CREAM, "#e6d4b0", "#dcc49a", "#efe4cc", "#d8b888"], 0, [], 0.8, [BROWN, "#3a2a20", FOREST, "#5a2a1e", "#2a3a4a"]),
    picker: { group: "regional", name: "Mission Revival", era: "1890-1930", maxFloors: 4, variants: ["White, quatrefoil", "Buff, wide arches", "Cream, tile pent", "Ochre, plain arches"] },
    city: [{ parent: "stucco", share: 0.15, from: 1895, to: 1930, maxH: 15 }],
  },
  // PUEBLO REVIVAL, 1905-today: Santa Fe and Albuquerque after the pueblos
  // of the Rio Grande — battered adobe (or stucco over block made to look
  // it), small deep openings, the vigas run out through the wall.
  {
    key: "pueblo", like: "stucco", flatRoof: true,
    spec: { bayW: 2.8, floorH: 3.0, masonry: true, glass: false, win: { x0: 0.36, x1: 0.64, y0: 0.32, y1: 0.7 }, wall: adobeWall([178, 128, 88], [96, 70, 48], 1),
      glassCol: "#2a3238", frameCol: TAOS_BLUE, wallRough: 0.96, glassRough: 0.12, glassMetal: 0.0, trim: "#5e4028", lintel: "flat", mullions: [2, 2], reveal: 6.0 },
    variants: [
      { wall: adobeWall([206, 172, 132], [110, 82, 56], 0.8), frameCol: "#5a3a26", trim: "#6a4a30" },
      { wall: adobeWall([164, 98, 70], [86, 60, 42], 1), frameCol: TURQ, trim: "#5a3c26", win: { x0: 0.3, x1: 0.7, y0: 0.32, y1: 0.7 }, mullions: [3, 2] },
      { wall: adobeWall([140, 104, 76], [70, 52, 36], 1.2), frameCol: "#2c5a8a", trim: "#4a3220" },
    ],
    tints: [[1, 1, 1], [1.04, 1.0, 0.94], [0.94, 0.92, 0.9]],
    palette: P(0.5, ["#b8865a", "#c89c70", "#a8704e", "#d0aa80", "#9a6a48", "#c4a07a"], 0, [], 0.8, [TAOS_BLUE, TURQ, "#5a3a26", "#2c5a8a", "#3a6a5a", "#8a3a2a"]),
    style: "vernacular",
    picker: { group: "regional", name: "Pueblo Revival", era: "1905-today", maxFloors: 4, variants: ["Adobe with vigas", "Pale earth, brown sash", "Red earth, turquoise", "Dark adobe, blue sash"] },
    city: [{ parent: "stucco", share: 0.07, from: 1905, maxH: 13 }],
  },
  // MEDITERRANEAN REVIVAL, 1918-1940: the boom-time hotels and apartment
  // houses of Palm Beach, Coral Gables, St. Petersburg and Los Angeles —
  // warm stucco, cast-stone arches and string courses, glazed tile aprons.
  {
    key: "mediterranean", like: "stucco",
    spec: { bayW: 2.8, floorH: 3.4, masonry: false, glass: false, win: W_MED, wall: medWall([228, 178, 146], W_MED, [[40, 84, 140], [232, 196, 92], [244, 240, 228]], [234, 226, 206]), winStyle: "arch",
      glassCol: "#2e3e48", frameCol: "#2f4a3a", wallRough: 0.88, glassRough: 0.1, glassMetal: 0.0, trim: "#ece4d0", mullions: [2, 4], reveal: 4.2 },
    variants: [
      { wall: medWall([238, 226, 200], W_MED, [[30, 100, 110], [230, 230, 220], [214, 160, 60]], [214, 200, 172]), winStyle: "pair", trim: "#d8c8a8", frameCol: "#3a2a20" },
      { wall: medWall([222, 186, 120], W_MED, [[160, 60, 40], [236, 220, 180], [40, 90, 70]], [236, 228, 208]), winStyle: "rect", lintel: "keystone", trim: "#ece4d0", frameCol: "#2a3a4a", mullions: [2, 3] },
      { wall: medWall([232, 188, 182], W_MED, [[50, 70, 130], [240, 236, 226], [200, 80, 60]], [240, 234, 220]), winStyle: "segment", shutter: "#2f5a4a", trim: "#f0eadc", frameCol: "#f0eadc" },
    ],
    tints: [[1, 1, 1], [1.02, 0.98, 0.94], [0.97, 0.96, 0.96]],
    palette: P(0.9, ["#e4b494", "#ecd8b8", "#e8c8a0", "#e6bcb4", "#f0e4cc", "#dcb070", "#e8d0b0", IVORY], 0, [], 0.85, [FOREST, "#2a3a4a", "#3a2a20", "#2f5a4a", BLACK, "#5a2a1e"]),
    picker: { group: "regional", name: "Mediterranean Revival", era: "1918-1940", maxFloors: 12, variants: ["Salmon, tiled aprons", "Cream, paired sash", "Ochre, keystoned", "Pink, shuttered"] },
    city: [{ parent: "stucco", share: 0.15, from: 1918, to: 1940, maxH: 42 }],
  },
  // TROPICAL DECO, 1930-1948: Miami Beach's hotels along Ocean Drive and
  // Collins Avenue — pastel stucco, a concrete eyebrow over every window
  // against the sun, fluted fins, porthole windows, keystone and glass block.
  {
    key: "beachdeco", like: "moderne",
    spec: { bayW: 2.6, floorH: 3.1, masonry: false, glass: false, win: W_BEACH, wall: beachWall([240, 200, 196], [92, 180, 176], W_BEACH),
      glassCol: "#2e4048", frameCol: "#f2f2ee", wallRough: 0.82, glassRough: 0.08, glassMetal: 0.2, mullions: [1, 3], reveal: 2.4 },
    variants: [
      { wall: beachWall([196, 228, 222], [236, 150, 140], W_BEACH, false), frameCol: "#f2f2ee" },
      { wall: beachWall([244, 228, 160], [90, 150, 196], W_BEACH), frameCol: "#2a3a4a", mullions: [2, 3] },
      { wall: beachWall([244, 242, 236], [176, 150, 206], W_BEACH), frameCol: "#3a4a5a" },
    ],
    tints: [[1, 1, 1], [1.0, 0.98, 1.02], [1.02, 1.0, 0.96]],
    palette: P(1, ["#f2c8c2", "#c4e4dc", "#f4e4a0", "#f4f2ec", "#d8cce8", "#bcd8ec", "#f6dcc0", "#d4ecc4"],
      0.4, [WHITE, "#f6f4ee"], 1, ["#5cb4b0", "#ec968c", "#5a96c4", "#b096ce", "#e8b04a", "#4a9a6a", "#d86a8a", "#3a6a8a"]),
    style: (year) => (year < 1937 ? "deco" : "moderne"),
    picker: { group: "regional", name: "Tropical deco", era: "1930-1948", maxFloors: 8, variants: ["Pink, eyebrows", "Aqua, coral fins", "Lemon, porthole", "White, lavender fins"] },
    city: [{ parent: "moderne", share: 0.2, from: 1933, to: 1948, maxH: 27 }],
  },
  // MIAMI MODERN, 1945-1968: the post-war resort hotels and motels of Miami
  // Beach and the 79th Street causeway — thin cantilevered slabs, fascias
  // pierced with cheese-holes, breeze-block screens, pastel and white.
  {
    key: "mimo", like: "midcentury",
    spec: { bayW: 3.0, floorH: 3.0, masonry: false, glass: false, win: W_MIMO, wall: mimoWall([236, 236, 230], [244, 244, 240], W_MIMO), over: screenOver([246, 246, 242], [1], W_MIMO),
      glassCol: "#2e4652", frameCol: "#c4c8cc", wallRough: 0.7, glassRough: 0.06, glassMetal: 0.3, mullions: [3, 1], reveal: 2.0 },
    variants: [
      { wall: mimoWall([170, 214, 210], [244, 244, 240], W_MIMO), over: screenOver([244, 244, 240], [1], W_MIMO), frameCol: "#e2e4e4" },
      { wall: mimoWall([238, 200, 196], [214, 186, 120], W_MIMO), over: screenOver([214, 186, 120], [0], W_MIMO), frameCol: "#c8b694" },
      { wall: mimoWall([226, 226, 220], [92, 160, 170], W_MIMO), over: screenOver([240, 240, 236], [0, 1], W_MIMO), frameCol: "#3a3c3e" },
    ],
    tints: [[1, 1, 1], [0.98, 0.99, 1.0]],
    palette: P(0.6, [WHITE, "#f4f2ec", "#c4e4dc", "#f2d4cc", "#f4e8c0", "#d4e4ec", "#e8e4dc"], 0.6, [WHITE, "#5cb4b0", "#d8b878", "#e8908a", "#4a7aa8"], 0.7, [WHITE, SILVER, "#c8b694", CHARCOAL, "#5cb4b0"]),
    picker: { group: "regional", name: "Miami Modern", era: "1945-1968", maxFloors: 16, variants: ["White, cheese-holes", "Aqua, white screen", "Pink and gold", "Teal fascia, full screen"] },
    city: [
      { parent: "midcentury", share: 0.15, from: 1948, to: 1968, maxH: 55 },
      { parent: "modern", share: 0.05, from: 1948, to: 1968, maxH: 55, cls: ["multifamily"] },
    ],
  },
  // DUTCH COLONIAL REVIVAL, 1900-1940: the gambrel-roofed suburban house
  // of the Sears catalogue and the Hudson Valley's own memory of it — even
  // painted shingle above a flared skirt, clapboard, sandstone or brick below,
  // six-over-six sash and shutters.
  {
    key: "dutchcolonial", like: "georgian",
    spec: { bayW: 2.8, floorH: 2.9, masonry: false, glass: false, win: { x0: 0.32, x1: 0.68, y0: 0.24, y1: 0.8 }, wall: dutchWall([214, 212, 204], [240, 238, 230], "clap", [244, 242, 236]),
      glassCol: "#32424c", frameCol: "#f4f2ec", wallRough: 0.82, glassRough: 0.12, glassMetal: 0.0, trim: "#f2f0ea", lintel: "flat", shutter: "#2f4a3a", mullions: [2, 3], reveal: 1.8 },
    variants: [
      { wall: dutchWall([226, 222, 210], [150, 92, 74], "stone", [240, 238, 230]), shutter: "#22302a", trim: "#eeeae0" },
      { wall: dutchWall([150, 158, 162], [176, 182, 184], "clap", [240, 240, 236]), shutter: "#1e1e1e", frameCol: "#f2f2ee" },
      { wall: dutchWall([190, 174, 140], [156, 76, 56], "brick", [236, 232, 220]), shutter: "#5a2a26", lintel: "pediment" },
    ],
    tints: [[1, 1, 1], [1.0, 0.98, 0.94], [0.96, 0.97, 0.98]],
    palette: P(0.9, [WHITE, "#e6e2d6", "#c8ccc4", "#b8c0c4", "#d8ccaa", "#e8dcc2", "#a8b4a4", "#8e9aa4"], 0.6, [WHITE, IVORY], 0.9, [FOREST, BLACK, OXBLOOD, NAVY, "#3d5a40", CHARCOAL]),
    style: "vernacular",
    picker: { group: "regional", name: "Dutch Colonial", era: "1900-1940", maxFloors: 3, variants: ["Shingle over clapboard", "Red sandstone below", "Grey, black shutters", "Brick below, pedimented"] },
    city: [
      { parent: "georgian", share: 0.12, from: 1900, to: 1940, maxH: 10 },
      { parent: "clapboard", share: 0.06, from: 1900, to: 1940, cls: ["multifamily"] },
    ],
  },
  // TERRITORIAL, 1850-1920 and revived since the 1930s: New Mexico's adobe
  // dressed by the Santa Fe Trail and the Army forts — a fired-brick coping
  // to shed the rain, white pedimented trim round larger double-hung sash.
  {
    key: "territorial", like: "stucco", flatRoof: true,
    spec: { bayW: 2.8, floorH: 3.2, masonry: true, glass: false, win: { x0: 0.32, x1: 0.68, y0: 0.24, y1: 0.76 }, wall: adobeWall([196, 156, 112], null, 0.45, [156, 70, 50]),
      glassCol: "#32424c", frameCol: "#f4f2ec", wallRough: 0.9, glassRough: 0.12, glassMetal: 0.0, trim: "#f4f2ec", lintel: "pediment", mullions: [2, 3], reveal: 4.0 },
    variants: [
      { wall: adobeWall([206, 176, 136], null, 0.45, [146, 66, 48]), shutter: "#3f6f8f", trim: "#f4f2ec" },
      { wall: adobeWall([222, 196, 150], null, 0.4, [170, 84, 58]), frameCol: "#2f4a3a", trim: "#f2f0e8" },
      { wall: adobeWall([186, 132, 108], null, 0.5, [140, 60, 44]), trim: "#f4f2ec", frameCol: TAOS_BLUE, mullions: [3, 3] },
    ],
    tints: [[1, 1, 1], [1.03, 1.0, 0.95], [0.96, 0.95, 0.94]],
    palette: P(0.5, ["#c49c70", "#d0b08a", "#b88c66", "#dcc4a0", "#c8a07c"], 0, [], 0.7, [WHITE, TAOS_BLUE, FOREST, TURQ, "#5a3a26"]),
    style: "vernacular",
    picker: { group: "regional", name: "Territorial", era: "1850-1920, revival to today", maxFloors: 3, variants: ["Tan adobe, brick coping", "Blue shutters", "Pale ochre, green sash", "Rose earth, blue sash"] },
    city: [{ parent: "stucco", share: 0.05, from: 1900, maxH: 10 }],
  },
  // SPANISH COLONIAL REVIVAL, 1920-today: Santa Barbara rebuilt after the
  // 1925 earthquake, and Hope Ranch and Montecito after it — whitewashed
  // stucco a foot thick, windows set deep and not quite in line, wrought-iron
  // rejas, a Monterey balcony of turned wood.
  {
    key: "spanishcolonial", like: "stucco",
    spec: { bayW: 3.0, floorH: 3.3, masonry: false, glass: false, win: W_SC, wall: whitewashWall([246, 244, 238], W_SC, 0.12), over: rejaOver([30, 28, 26], W_SC, 0.12, [0, 3]),
      glassCol: "#2a3640", frameCol: "#3a2a20", wallRough: 0.94, glassRough: 0.12, glassMetal: 0.0, mullions: [2, 3], reveal: 6.4, winJitter: 0.12 },
    variants: [
      { wall: whitewashWall([244, 240, 230], W_SC2, 0.1), win: W_SC2, winJitter: 0.1, winStyle: "arch", over: rejaOver([26, 26, 26], W_SC2, 0.1, [1]), frameCol: "#2f4a3a" },
      { wall: whitewashWall([238, 228, 206], W_SC, 0.14), winJitter: 0.14, over: rejaOver([34, 30, 28], W_SC, 0.14, [0, 1, 2, 3]), frameCol: "#2a3a5a" },
      { wall: whitewashWall([246, 244, 238], W_SC2, 0), win: W_SC2, winJitter: 0, over: balconyOver([80, 52, 34], W_SC2), frameCol: "#4a3020", shutter: "#4a3020" },
    ],
    tints: [[1, 1, 1], [1.0, 0.98, 0.95], [0.98, 0.98, 0.98]],
    palette: P(0.35, [WHITE, IVORY, "#f2ead8", "#ece0c8"], 0, [], 0.8, ["#3a2a20", "#2f4a3a", "#2a3a5a", BLACK, "#4a3020", "#2c5a6a"]),
    picker: { group: "regional", name: "Spanish Colonial", era: "1920-today", maxFloors: 6, variants: ["White, iron grilles", "Arched, one grille", "Cream, all grilled", "Monterey balcony"] },
    city: [{ parent: "stucco", share: 0.14, from: 1920, maxH: 20 }],
  },
  // CHARLESTON SINGLE HOUSE, 1790-1900: one room wide to the street, the
  // long side to the piazza — scored stucco or beaded weatherboard in the
  // Rainbow Row colours, tall nine-over-nine sash behind Charleston-green
  // louvered shutters.
  {
    key: "lowcountry", like: "clapboard",
    spec: { bayW: 2.6, floorH: 3.9, masonry: false, glass: false, win: W_CHAS, wall: scoredStucco([232, 214, 168]),
      glassCol: "#2e3c46", frameCol: "#f4f2ec", wallRough: 0.88, glassRough: 0.1, glassMetal: 0.0, trim: "#f2eee4", lintel: "flat", shutter: CHAS_GREEN, mullions: [3, 3], reveal: 2.8 },
    variants: [
      { wall: beadedBoard([240, 238, 230]), shutter: CHAS_GREEN, trim: "#f4f2ec", lintel: "pediment" },
      { wall: pressedBrick([150, 136, 120]), shutter: CHAS_GREEN, trim: "#ece8dc", lintel: "keystone" },
      { wall: scoredStucco([232, 184, 176]), shutter: "#26332c", trim: "#f4f0e8" },
    ],
    tints: [[1, 1, 1], [1.0, 0.98, 0.96], [0.97, 0.98, 1.0]],
    palette: P(0.85, ["#e8d4a0", "#e6b8b0", "#b8d0d8", "#c8d8b8", "#f0e6d0", "#e8c890", "#d8b8c8", WHITE, "#b4c8c0"], 0.4, [WHITE, IVORY], 0.9, [CHAS_GREEN, CHAS_GREEN, BLACK, "#26332c", FOREST]),
    style: "vernacular",
    picker: { group: "regional", name: "Charleston single house", era: "1790-1900", maxFloors: 3, variants: ["Scored stucco, green shutters", "Beaded weatherboard", "Carolina grey brick", "Pink stucco"] },
    city: [
      { parent: "clapboard", share: 0.06, from: 1790, to: 1900, cls: ["multifamily"] },
      { parent: "georgian", share: 0.1, from: 1790, to: 1850, maxH: 12, cls: ["multifamily"] },
    ],
  },
];
