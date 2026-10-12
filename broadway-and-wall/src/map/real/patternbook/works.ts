// THE WORKS AND THE POST-WAR CITY. What the industrial wards and the
// post-war boom actually put up, beyond the loft, the daylight factory and
// the slab: the power station and the cold store, the brewery and the mill,
// the shed, the tilt-up and the office park; then the drive-in, the
// sunscreen, the breeze block, the housing tower, the gold curtain wall, the
// eggcrate, the brick-pier office and the exposed steel of high tech. Each
// paints its own wall, relief and paint mask (green trim, blue accent).
import { TILE, P, stoneWallC, stuccoWall, type Painter, type PaintCtx, type FamilySpec } from "../facades";
import type { BookEntry } from "./types";

type RGB = [number, number, number];
type Win = FamilySpec["win"];
const T = TILE;
const rgb = (c: RGB, v = 1) => `rgb(${Math.max(0, Math.min(255, c[0] * v)) | 0},${Math.max(0, Math.min(255, c[1] * v)) | 0},${Math.max(0, Math.min(255, c[2] * v)) | 0})`;
const MK_TRIM = "rgb(0,255,0)", MK_ACC = "rgb(0,0,255)", MK_NONE = "rgb(0,0,0)";
const CELLS: [number, number][] = [[0, 0], [T, 0], [0, T], [T, T]];

/** A rectangle on the colour and, when given, the same rectangle on the mask. */
function fillBoth(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, mk: string | null, x: number, y: number, w: number, h: number) {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  if (pc && mk) { pc.m.fillStyle = mk; pc.m.fillRect(x, y, w, h); }
}
/** Relief: 255 stands proud, darker sits back. */
function relief(pc: PaintCtx | undefined, v: number, x: number, y: number, w: number, h: number) {
  if (!pc) return;
  const s = Math.max(0, Math.min(255, v)) | 0;
  pc.hg.fillStyle = `rgb(${s},${s},${s})`; pc.hg.fillRect(x, y, w, h);
}
function grime(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, n: number, a: number, sz = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * a})`; g.fillRect(rnd() * w, rnd() * h, sz, sz); }
}
/** A window's opening on the canvas, from its spec fractions (the tile is upright: canvas top is the head of the storey). */
const winPx = (win: Win, ox: number, oy: number) => ({ x0: ox + win.x0 * T, x1: ox + win.x1 * T, y0: oy + (1 - win.y1) * T, y1: oy + (1 - win.y0) * T });

/** Brick over a region, in running bond or American common bond (a header course every `header` courses). */
function bricks(g: CanvasRenderingContext2D, rnd: () => number, c: RGB, x0: number, y0: number, w: number, h: number,
  o: { bw?: number; bh?: number; mortar?: string; header?: number; spread?: number } = {}) {
  const bw = o.bw ?? 16, bh = o.bh ?? 6, sp = o.spread ?? 0.24;
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.fillStyle = o.mortar ?? "#b4a896"; g.fillRect(x0, y0, w, h);
  for (let y = y0, r = 0; y < y0 + h; y += bh, r++) {
    const hd = o.header && r % o.header === 0;
    const L = hd ? bw / 2 : bw;
    for (let x = x0 - ((r % 2) * L) / 2; x < x0 + w; x += L) {
      const v = 0.86 + rnd() * sp;
      g.fillStyle = rgb(c, hd ? v * 0.9 : v); g.fillRect(x + 1, y + 1, L - 1.5, bh - 1.5);
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// THE WORKS
// ---------------------------------------------------------------------------

/** Power station, 1890-1935: a brick turbine hall between proud piers, a corbelled frieze at the eaves, giant round-arched sash. */
const powerWall = (brick: RGB, pier: RGB, stone: RGB, win: Win): Painter => (g, w, h, rnd, pc) => {
  relief(pc, 200, 0, 0, w, h);
  bricks(g, rnd, brick, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    const wp = winPx(win, ox, oy);
    // a sunk panel under the sill
    g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(ox + 24, wp.y1 + 6, T - 48, oy + T - wp.y1 - 6);
    // the piers, a brick proud of the field, shadowed on the lee side
    for (const px of [ox, ox + T - 16]) { bricks(g, rnd, pier, px, oy, 16, T); relief(pc, 255, px, oy, 16, T); }
    g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(ox + 16, oy, 3, T); g.fillRect(ox + T - 19, oy, 3, T);
    // the corbel table at the head of the hall: a band, then a run of dentils
    g.fillStyle = rgb(pier, 1.06); g.fillRect(ox, oy, T, 5);
    for (let x = ox + 2; x < ox + T; x += 8) { g.fillStyle = rgb(pier, 0.98); g.fillRect(x, oy + 5, 5, 6); g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x, oy + 11, 5, 2); }
    relief(pc, 255, ox, oy, T, 11);
    // a stone sill course, run through
    fillBoth(g, pc, rgb(stone), MK_TRIM, ox, wp.y1, T, 6);
    relief(pc, 255, ox, wp.y1, T, 6);
  }
  grime(g, w, h, rnd, 500, 0.08);
};


/** Brewery, 1860-1915: German Romanesque in brick — pilaster strips, an arched corbel table at every floor, a dogtooth course. */
const breweryWall = (brick: RGB, dress: RGB): Painter => (g, w, h, rnd, pc) => {
  relief(pc, 200, 0, 0, w, h);
  bricks(g, rnd, brick, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    // the lesenes: flat pilaster strips at the bay lines
    for (const px of [ox, ox + T - 10]) { bricks(g, rnd, dress, px, oy, 10, T); relief(pc, 255, px, oy, 10, T); }
    // the arched corbel table: a band, and a run of little round arches hung under it
    fillBoth(g, pc, rgb(dress, 1.02), MK_TRIM, ox, oy + 1, T, 5);
    for (let x = ox + 10; x < ox + T - 12; x += 12) {
      g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.arc(x + 6, oy + 12, 4.2, Math.PI, 0); g.lineTo(x + 10.2, oy + 15); g.lineTo(x + 1.8, oy + 15); g.fill();
      for (const gg of pc ? [g, pc.m] : [g]) {
        gg.strokeStyle = gg === g ? rgb(dress) : MK_TRIM; gg.lineWidth = 2.4;
        gg.beginPath(); gg.arc(x + 6, oy + 12, 5, Math.PI, 0); gg.stroke();
        gg.fillStyle = gg === g ? rgb(dress, 0.96) : MK_TRIM; gg.fillRect(x - 1.2, oy + 12, 2.4, 5);
      }
    }
    relief(pc, 255, ox, oy, T, 17);
    // a dogtooth course: bricks laid corner-out
    for (let x = ox + 10; x < ox + T - 10; x += 6) {
      g.fillStyle = rgb(dress, 1.1); g.beginPath(); g.moveTo(x, oy + 24); g.lineTo(x + 3, oy + 21); g.lineTo(x + 6, oy + 24); g.lineTo(x + 3, oy + 27); g.fill();
      g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.moveTo(x + 3, oy + 27); g.lineTo(x + 6, oy + 24); g.lineTo(x + 6, oy + 26); g.fill();
    }
  }
  grime(g, w, h, rnd, 400, 0.07);
};

/** The New England mill, 1830-1920: American common bond, a header course every sixth, long-weathered. */
const millWall = (brick: RGB): Painter => (g, w, h, rnd) => {
  bricks(g, rnd, brick, 0, 0, w, h, { header: 6, mortar: "#c2b8a6" });
  // lime run and soot: pale streaks down from the sills, dark under the eaves of each floor
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(240,236,224,${0.04 + rnd() * 0.07})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 18 + rnd() * 40); }
  for (let by = 0; by < 2; by++) { const gr = g.createLinearGradient(0, by * T, 0, by * T + 18); gr.addColorStop(0, "rgba(30,24,20,0.22)"); gr.addColorStop(1, "rgba(30,24,20,0)"); g.fillStyle = gr; g.fillRect(0, by * T, w, 18); }
};
/** The granite mill of Fall River: split granite in random courses, grey and pink. */
const graniteRubble = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.6); g.fillRect(0, 0, w, h);
  relief(pc, 150, 0, 0, w, h);
  for (let y = 0; y < h;) {
    const ch = 10 + ((rnd() * 9) | 0);
    for (let x = -rnd() * 20; x < w;) {
      const L = 18 + rnd() * 34, v = 0.84 + rnd() * 0.26, pink = rnd() < 0.3 ? 1.06 : 1;
      g.fillStyle = `rgb(${Math.min(255, c[0] * v * pink) | 0},${c[1] * v | 0},${c[2] * v | 0})`; g.fillRect(x + 1.2, y + 1.2, L - 2.4, ch - 2.4);
      g.fillStyle = rgb(c, v * 1.12); g.fillRect(x + 1.5, y + 1.5, L - 3, 2);
      relief(pc, 230 + rnd() * 25, x + 1.2, y + 1.2, L - 2.4, ch - 2.4);
      x += L;
    }
    y += ch;
  }
  grime(g, w, h, rnd, 1400, 0.1, 1.5);
};

/** Corrugated iron, 1890-today: the shed's wall — sheet ribs every few inches, laps at each sheet, rust at the fixings. */
const corrugatedWall = (c: RGB, rust: number): Painter => (g, w, h, rnd, pc) => {
  for (let x = 0; x < w; x++) {
    const s = Math.sin((x / 8) * Math.PI * 2);
    g.fillStyle = rgb(c, 0.86 + 0.2 * s); g.fillRect(x, 0, 1, h);
    relief(pc, 150 + 90 * s, x, 0, 1, h);
  }
  // here and there a sheet replaced: a little brighter or duller than its neighbours
  for (let i = 0; i < 4; i++) { const x = ((rnd() * 8) | 0) * 32, y = ((rnd() * 4) | 0) * 64; g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"; g.fillRect(x, y, 32, 64); }
  for (let y = 0; y < h; y += 64) {
    g.fillStyle = "rgba(0,0,0,0.38)"; g.fillRect(0, y, w, 1.5);
    g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(0, y + 1.5, w, 1);
    for (let x = 4; x < w; x += 16) {
      g.fillStyle = "rgba(30,30,30,0.6)"; g.fillRect(x, y + 4, 1.6, 1.6);
      if (rnd() < rust) { g.fillStyle = `rgba(${120 + rnd() * 30},${58 + rnd() * 20},28,${0.2 + rnd() * 0.3})`; g.fillRect(x - 0.5, y + 5, 1.5 + rnd() * 2, 8 + rnd() * 34); }
    }
  }
  // the foot of the wall rusts first, where the rain splashes
  for (let i = 0; i < 90 * rust; i++) { g.fillStyle = `rgba(${130 + rnd() * 30},${62 + rnd() * 20},30,${0.1 + rnd() * 0.25})`; g.fillRect(rnd() * w, T - 14 + rnd() * 14 + (rnd() < 0.5 ? T : 0), 2 + rnd() * 8, 2 + rnd() * 4); }
};

/** Tilt-up concrete, 1960-today: wall panels cast on the slab and lifted, caulked joints, reveal grooves and a painted band, a dock door. */
const tiltWall = (c: RGB, band: RGB, dock: boolean): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.3;
  for (let i = 0; i < 60; i++) { g.fillStyle = rgb(c, 0.94 + rnd() * 0.1); g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 10 + rnd() * 30, 6 + rnd() * 20, 0, 0, 6.283); g.fill(); }
  g.globalAlpha = 1;
  grime(g, w, h, rnd, 500, 0.05);
  relief(pc, 230, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    // the panel joint
    g.fillStyle = "rgba(40,40,40,0.55)"; g.fillRect(ox, oy, 2.5, T); relief(pc, 120, ox, oy, 2.5, T);
    if (oy === 0) {
      // the parapet's reveals and the band between them
      fillBoth(g, pc, rgb(band), MK_ACC, ox, oy + 20, T, 16);
      for (const y of [oy + 18, oy + 36, oy + 46]) { g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(ox, y, T, 2); g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(ox, y + 2, T, 1); relief(pc, 110, ox, y, T, 2); }
    } else if (dock && ox === T) {
      // a dock-high door under a steel canopy, bumpers either side
      fillBoth(g, pc, "#cfd2d2", MK_TRIM, ox + 30, oy + 40, 68, T - 52);
      g.fillStyle = "rgba(0,0,0,0.2)"; for (let y = oy + 43; y < oy + T - 12; y += 4) g.fillRect(ox + 30, y, 68, 1);
      relief(pc, 150, ox + 30, oy + 40, 68, T - 52);
      g.fillStyle = "#3a3c3e"; g.fillRect(ox + 24, oy + 33, 80, 6); g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(ox + 24, oy + 39, 80, 4);
      g.fillStyle = "#1e1e1e"; g.fillRect(ox + 31, oy + T - 22, 7, 10); g.fillRect(ox + 90, oy + T - 22, 7, 10);
      g.fillStyle = "#6a6a66"; g.fillRect(ox + 26, oy + T - 12, 76, 12);
    } else if (dock) {
      // the man door beside it
      fillBoth(g, pc, "#cfd2d2", MK_TRIM, ox + 86, oy + 80, 18, T - 80);
      g.fillStyle = "#3a3c3e"; g.fillRect(ox + 100, oy + 104, 2, 3);
    }
  }
};

/** The 1980s office park: split-face block under a smooth fascia, a ground-face cap course at the sill. */
const splitFace = (c: RGB, cap: RGB, win: Win, smooth = false): Painter => (g, w, h, rnd, pc) => {
  if (smooth) stuccoWall(c)(g, w, h, rnd);
  else {
    g.fillStyle = rgb(c, 0.66); g.fillRect(0, 0, w, h);
    for (let y = 0, r = 0; y < h; y += 7, r++) for (let x = (r % 2) * 7 - 7; x < w; x += 14) {
      const v = 0.9 + rnd() * 0.14;
      g.fillStyle = rgb(c, v); g.fillRect(x + 0.8, y + 0.8, 12.4, 5.4);
      for (let k = 0; k < 8; k++) { g.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)"; g.fillRect(x + 1 + rnd() * 11, y + 1 + rnd() * 4, 1.5, 1.5); }
    }
    relief(pc, 200, 0, 0, w, h);
  }
  for (const [ox, oy] of CELLS) {
    const wp = winPx(win, ox, oy);
    fillBoth(g, pc, rgb(cap), MK_ACC, ox, oy, T, wp.y0 - oy);                // the fascia over the ribbon
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(ox, wp.y0 - 2, T, 2);
    fillBoth(g, pc, rgb(c, 1.1), MK_TRIM, ox, wp.y1, T, 7);                   // the cap course
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(ox, wp.y1 + 7, T, 2);
    relief(pc, 255, ox, oy, T, wp.y0 - oy); relief(pc, 255, ox, wp.y1, T, 7);
    if (smooth) { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(ox, wp.y1 + 30, T, 1.5); g.fillRect(ox + T / 2, wp.y1 + 9, 1.5, oy + T - wp.y1 - 9); }
  }
};

/** Glass block, 1930-1958: panels of pressed glass block set in a concrete frame, a steel vent sash in the middle; they glow at night. */
const glassBlockWall = (frame: RGB, block: RGB, brickPier = false): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(frame); g.fillRect(0, 0, w, h);
  grime(g, w, h, rnd, 500, 0.06);
  relief(pc, 255, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    if (brickPier) { bricks(g, rnd, frame, ox, oy, 12, T); bricks(g, rnd, frame, ox + T - 12, oy, 12, T); }
    g.fillStyle = rgb(frame, 0.92); g.fillRect(ox, oy + T - 18, T, 18);
    g.fillStyle = rgb(frame, 0.72); g.fillRect(ox, oy + T - 19, T, 1.5);
    const bx = ox + 12, byy = oy + 6, n = 8, s = 13;
    g.fillStyle = "#d4d6d0"; g.fillRect(bx, byy, n * s, n * s);
    if (pc) { pc.m.fillStyle = "rgb(70,255,0)"; pc.m.fillRect(bx, byy, n * s, n * s); }   // lit through at night; never painted (trim)
    relief(pc, 170, bx, byy, n * s, n * s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = bx + i * s + 1, y = byy + j * s + 1, v = 0.9 + rnd() * 0.16;
      const gr = g.createLinearGradient(x, y, x + s, y + s);
      gr.addColorStop(0, rgb(block, v * 1.12)); gr.addColorStop(1, rgb(block, v * 0.78));
      g.fillStyle = gr; g.fillRect(x, y, s - 2, s - 2);
      // the pressed flutes, a highlight and a shadow
      g.fillStyle = "rgba(255,255,255,0.28)"; g.fillRect(x + 2, y + 3, s - 6, 1); g.fillRect(x + 2, y + 7, s - 6, 1);
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + s - 4, y + 1, 1, s - 4);
    }
  }
};

/** Terminal warehouse, 1880-1930: the railroad's brick store — deep piers, a stone belt at every floor, iron shutters, hoist beams. */
const terminalWall = (brick: RGB, stone: RGB, hoist: boolean): Painter => (g, w, h, rnd, pc) => {
  relief(pc, 190, 0, 0, w, h);
  bricks(g, rnd, brick, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    for (const px of [ox, ox + T - 18]) { bricks(g, rnd, brick.map((c) => c * 1.07) as RGB, px, oy, 18, T); relief(pc, 255, px, oy, 18, T); }
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(ox + 18, oy, 4, T); g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(ox + T - 22, oy, 4, T);
    fillBoth(g, pc, rgb(stone), MK_TRIM, ox, oy + T - 9, T, 9);                 // the belt course
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(ox, oy + T - 1.5, T, 1.5);
    relief(pc, 255, ox, oy + T - 9, T, 9);
    if (hoist) {
      // a hoist beam out over each door, its pulley hook
      fillBoth(g, pc, "#2c2e2c", MK_ACC, ox + T / 2 - 4, oy + 2, 8, 6);
      g.fillStyle = "#2c2e2c"; g.fillRect(ox + T / 2 - 0.5, oy + 8, 1, 8); g.beginPath(); g.arc(ox + T / 2, oy + 17, 2, 0, 6.283); g.fill();
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(ox + T / 2 - 4, oy + 8, 8, 3);
    }
  }
  grime(g, w, h, rnd, 600, 0.08);
};

/** Pump house, 1870-1920: High Victorian polychrome brick — black and buff bands — round-arched sash with an oculus over each. */
const pumpWall = (base: RGB, b1: RGB, b2: RGB, stone: RGB, ashlar = false): Painter => (g, w, h, rnd, pc) => {
  if (ashlar) stoneWallC(base, 18)(g, w, h, rnd);
  else {
    g.fillStyle = "#aa9e8c"; g.fillRect(0, 0, w, h);
    for (let y = 0, r = 0; y < h; y += 6, r++) for (let x = -((r % 2) * 8); x < w; x += 16) {
      const m = r % 10, c = m === 3 || m === 5 ? b1 : m === 4 ? b2 : base, v = 0.86 + rnd() * 0.22;
      g.fillStyle = rgb(c, v); g.fillRect(x + 1, y + 1, 14.5, 4.5);
    }
  }
  relief(pc, 210, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    const cx = ox + T / 2, cy = oy + 21;
    // the oculus: a stone ring with its joints, the sash quartered
    for (const gg of pc ? [g, pc.m] : [g]) { gg.fillStyle = gg === g ? rgb(stone) : MK_TRIM; gg.beginPath(); gg.arc(cx, cy, 16, 0, 6.283); gg.fill(); }
    g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 1;
    for (let a = 0; a < 12; a++) { const t = (a / 12) * 6.283; g.beginPath(); g.moveTo(cx + Math.cos(t) * 11.5, cy + Math.sin(t) * 11.5); g.lineTo(cx + Math.cos(t) * 16, cy + Math.sin(t) * 16); g.stroke(); }
    const gr = g.createLinearGradient(0, cy - 11, 0, cy + 11); gr.addColorStop(0, "#41525c"); gr.addColorStop(1, "#28333a");
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 11, 0, 6.283); g.fill();
    if (pc) { pc.m.fillStyle = MK_NONE; pc.m.beginPath(); pc.m.arc(cx, cy, 11, 0, 6.283); pc.m.fill(); }
    g.strokeStyle = "#2a2a28"; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 11, cy); g.lineTo(cx + 11, cy); g.moveTo(cx, cy - 11); g.lineTo(cx, cy + 11); g.stroke();
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.beginPath(); pc.hg.arc(cx, cy, 16, 0, 6.283); pc.hg.fill(); pc.hg.fillStyle = "#505050"; pc.hg.beginPath(); pc.hg.arc(cx, cy, 11, 0, 6.283); pc.hg.fill(); }
    // a stone water table at the foot of each storey
    fillBoth(g, pc, rgb(stone, 0.96), MK_TRIM, ox, oy + T - 6, T, 6); relief(pc, 255, ox, oy + T - 6, T, 6);
  }
};

/** Data centre, 2000-today: insulated metal panel or precast, blank, with louvre bands for the air handlers (trim). */
const dcWall = (c: RGB, louvre: RGB, mode: "band" | "screen" | "precast"): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  relief(pc, 220, 0, 0, w, h);
  if (mode === "precast") {
    grime(g, w, h, rnd, 700, 0.05);
    for (let x = 0; x < w; x += T / 2) { g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x, 0, 1.5, h); relief(pc, 120, x, 0, 1.5, h); }
    for (let y = 0; y < h; y += T) { g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, y, w, 1.5); relief(pc, 120, 0, y, w, 1.5); }
  } else {
    // flat insulated panels, a faint oil-can sheen on each, the joints and screw lines
    for (let y = 0; y < h; y += 32) {
      const gr = g.createLinearGradient(0, y, 0, y + 32); gr.addColorStop(0, "rgba(255,255,255,0.06)"); gr.addColorStop(1, "rgba(0,0,0,0.06)");
      g.fillStyle = gr; g.fillRect(0, y, w, 32);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, y, w, 1); g.fillStyle = "rgba(255,255,255,0.2)"; g.fillRect(0, y + 1, w, 1);
      relief(pc, 150, 0, y, w, 1);
      for (let x = 6; x < w; x += 24) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x, y + 4, 1, 1); }
    }
    for (let x = 0; x < w; x += 64) { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(x, 0, 1, h); }
  }
  const slats = (x: number, y: number, ww: number, hh: number, vert: boolean) => {
    fillBoth(g, pc, rgb(louvre, 0.85), MK_TRIM, x - 3, y - 3, ww + 6, hh + 6);
    fillBoth(g, pc, rgb(louvre, 0.32), MK_TRIM, x, y, ww, hh);
    relief(pc, 255, x - 3, y - 3, ww + 6, hh + 6); relief(pc, 90, x, y, ww, hh);
    for (let k = 0; vert ? k < ww : k < hh; k += 4) {
      g.fillStyle = rgb(louvre, 1.15); vert ? g.fillRect(x + k, y, 1.5, hh) : g.fillRect(x, y + k, ww, 1.5);
      g.fillStyle = rgb(louvre, 0.9); vert ? g.fillRect(x + k + 1.5, y, 1, hh) : g.fillRect(x, y + k + 1.5, ww, 1);
      if (pc) { pc.hg.fillStyle = "#e0e0e0"; vert ? pc.hg.fillRect(x + k, y, 2, hh) : pc.hg.fillRect(x, y + k, ww, 2); }
    }
  };
  if (mode === "screen") {
    // a screen of vertical louvres along the yard, hiding the generators
    for (const [ox, oy] of CELLS) if (ox === T) slats(ox + 10, oy + 3, T - 20, T - 6, true);
  } else {
    // the continuous louvre band under the parapet
    slats(4, 26, w - 8, 46, false);
  }
  // a steel door to the plant
  fillBoth(g, pc, rgb(c, 0.9), MK_TRIM, 92, T + 74, 20, T - 74);
  g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(92, T + 74, 20, 1.5); g.fillRect(92, T + 74, 1.5, T - 74); g.fillRect(107, T + 104, 2, 3);
};

/** Self storage, 1975-today: ribbed metal panel and the operator's colour — a band, the frames, or the roll-up doors themselves (accent). */
const storageWall = (c: RGB, band: RGB, win: Win, doors: boolean): Painter => (g, w, h, _rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  relief(pc, 200, 0, 0, w, h);
  for (let x = 0; x < w; x += 12) {
    g.fillStyle = rgb(c, 1.1); g.fillRect(x, 0, 2, h); g.fillStyle = rgb(c, 0.78); g.fillRect(x + 2, 0, 1.5, h);
    relief(pc, 255, x, 0, 3, h);
  }
  for (const [ox, oy] of CELLS) {
    if (doors && oy === T) {
      // drive-up units: a roll-up door in every bay
      g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(ox + 10, oy + 20, T - 20, T - 20);
      fillBoth(g, pc, rgb(band), MK_ACC, ox + 13, oy + 25, T - 26, T - 25);
      for (let y = oy + 28; y < oy + T; y += 4) { g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(ox + 13, y, T - 26, 1); g.fillStyle = "rgba(255,255,255,0.15)"; g.fillRect(ox + 13, y + 1, T - 26, 1); }
      g.fillStyle = "#2a2a2a"; g.fillRect(ox + T / 2 - 6, oy + T - 10, 12, 3);
      relief(pc, 150, ox + 13, oy + 25, T - 26, T - 25);
      g.fillStyle = "#e8e8e4"; g.fillRect(ox + T / 2 - 7, oy + 13, 14, 7);   // the unit number
    } else if (doors) {
      fillBoth(g, pc, rgb(band), MK_ACC, ox, oy + 92, T, 12);                 // the colour stripe along the fascia
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(ox, oy + 104, T, 2);
    } else {
      // the climate-controlled block: a colour band under the windows
      const wp = winPx(win, ox, oy);
      fillBoth(g, pc, rgb(band), MK_ACC, ox, wp.y1 + 8, T, 14);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(ox, wp.y1 + 22, T, 2);
      relief(pc, 255, ox, wp.y1 + 8, T, 14);
    }
  }
};
/** What shows through the self-storage window: the slats of the orange doors in the corridor behind. */
const storageOver = (win: Win): Painter => (g) => {
  for (const [ox, oy] of CELLS) {
    const wp = winPx(win, ox, oy);
    for (let y = wp.y0 + (wp.y1 - wp.y0) * 0.3; y < wp.y1 - 3; y += 3) { g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(wp.x0 + 4, y, wp.x1 - wp.x0 - 8, 1); }
  }
};

// ---------------------------------------------------------------------------
// THE POST-WAR CITY
// ---------------------------------------------------------------------------


/** Brise-soleil, 1950-1975: a deep concrete sunscreen standing in front of the glass — an egg-crate of fins and shelves, or blades, or louvres. */
const briseOver = (c: RGB, mode: "grid" | "blade" | "shelf"): Painter => (g, w, h, _rnd, pc) => {
  const sol = (x: number, y: number, ww: number, hh: number, v: number) => { fillBoth(g, pc, rgb(c, v), MK_NONE, x, y, ww, hh); relief(pc, 255, x, y, ww, hh); };
  const shade = (x: number, y: number, ww: number, hh: number, a: number) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x, y, ww, hh); };
  const fins = mode === "grid" ? 3 : mode === "blade" ? 4 : 1;
  const shelves = mode === "grid" ? [0, 0.5] : mode === "shelf" ? [0, 0.2, 0.4, 0.6, 0.8] : [0];
  // the shadows first, then the concrete over them
  for (let k = 0; k < (w / T) * fins; k++) { const x = (k * T) / fins; shade(x + (mode === "blade" ? 3 : 7), 0, mode === "blade" ? 12 : 8, h, 0.32); }
  for (let by = 0; by < 2; by++) for (const f of shelves) { const y = by * T + f * T; shade(0, y + 8, w, mode === "shelf" ? 6 : 9, 0.34); }
  for (let k = 0; k < (w / T) * fins; k++) {
    const x = (k * T) / fins;
    if (mode === "blade") { sol(x - 2, 0, 5, h, 1.08); sol(x + 3, 0, 8, h, 0.72); }   // deep blades seen at a rake: a lit edge, a long shaded side
    else { sol(x - 3.5, 0, 7, h, 1.0); sol(x - 3.5, 0, 1.5, h, 1.14); sol(x + 2, 0, 1.5, h, 0.8); }
  }
  for (let by = 0; by < 2; by++) for (const f of shelves) {
    const y = by * T + f * T, th = mode === "shelf" ? 5 : f === 0 ? 9 : 7;
    sol(0, y - th / 2, w, 2, 1.16); sol(0, y - th / 2 + 2, w, th - 2, 1.0); sol(0, y + th / 2, w, 2, 0.66);
  }
};

/** Breeze block, 1955-1972: a screen of pierced concrete block — over the balconies, the stair, or the whole front. */
const screenOver = (face: RGB, hole: "circle" | "diamond" | "quad", cover: "half" | "full" | "lower"): Painter => (g, w, h, _rnd, pc) => {
  const s = 16;
  const regions: [number, number, number, number][] = cover === "full" ? [[0, 0, w, h]] : cover === "half" ? [[8, 0, T - 16, h]] : [[0, T * 0.4, w, T * 0.6], [0, T * 1.4, w, T * 0.6]];
  for (const [rx, ry, rw, rh] of regions) {
    // the frame round the panel
    fillBoth(g, pc, rgb(face, 0.9), MK_NONE, rx - 3, ry, rw + 6, rh);
    relief(pc, 255, rx - 3, ry, rw + 6, rh);
    for (let y = ry; y + s <= ry + rh + 0.01; y += s) for (let x = rx; x + s <= rx + rw + 0.01; x += s) {
      const cx = x + s / 2, cy = y + s / 2;
      const holePath = (gg: CanvasRenderingContext2D) => {
        if (hole === "circle") { gg.moveTo(cx + 5.4, cy); gg.arc(cx, cy, 5.4, 0, 6.283); }
        else if (hole === "diamond") { gg.moveTo(cx, y + 2.5); gg.lineTo(x + s - 2.5, cy); gg.lineTo(cx, y + s - 2.5); gg.lineTo(x + 2.5, cy); gg.closePath(); }
        else for (const [qx, qy] of [[2.6, 2.6], [9, 2.6], [2.6, 9], [9, 9]]) gg.rect(x + qx, y + qy, 4.4, 4.4);
      };
      // the shadow in the openings, then the block's face round them
      g.fillStyle = "rgba(0,0,0,0.5)"; g.beginPath(); holePath(g); g.fill();
      g.fillStyle = rgb(face, 0.94 + ((x * 7 + y * 3) % 5) * 0.02);
      g.beginPath(); g.rect(x + 0.6, y + 0.6, s - 1.2, s - 1.2); holePath(g); g.fill("evenodd");
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x, y + s - 0.8, s, 0.8); g.fillRect(x + s - 0.8, y, 0.8, s);
      if (pc) {
        pc.m.fillStyle = MK_NONE; pc.m.beginPath(); pc.m.rect(x + 0.6, y + 0.6, s - 1.2, s - 1.2); holePath(pc.m); pc.m.fill("evenodd");
        pc.hg.fillStyle = "#ffffff"; pc.hg.beginPath(); pc.hg.rect(x + 0.6, y + 0.6, s - 1.2, s - 1.2); holePath(pc.hg); pc.hg.fill("evenodd");
        pc.hg.fillStyle = "#606060"; pc.hg.beginPath(); holePath(pc.hg); pc.hg.fill();
      }
    }
  }
};

/** The housing project, 1945-1975: machine-made red brick without a moulding on it, the slab edge showing or not, through-wall air conditioners. */
const projectWall = (base: RGB, win: Win, slab: RGB | null): Painter => (g, w, h, rnd, pc) => {
  bricks(g, rnd, base, 0, 0, w, h, { bh: 5.5, spread: 0.12, mortar: "#9c968c" });
  for (const [ox, oy] of CELLS) {
    const wp = winPx(win, ox, oy);
    if (slab) { fillBoth(g, pc, rgb(slab), MK_TRIM, ox, oy + T - 9, T, 9); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(ox, oy + T - 9, T, 1); relief(pc, 255, ox, oy + T - 9, T, 9); }
    // a concrete sill, the stain it leaves
    g.fillStyle = "#b8b4aa"; g.fillRect(wp.x0 - 2, wp.y1, wp.x1 - wp.x0 + 4, 4);
    g.fillStyle = "rgba(235,232,222,0.16)"; g.fillRect(wp.x0 + 6, wp.y1 + 4, wp.x1 - wp.x0 - 12, 16);
    // an air conditioner through the wall under one window in four
    if (ox === T && oy === 0) {
      fillBoth(g, pc, "#a8aaa6", MK_NONE, ox + 50, wp.y1 + 8, 26, 12);
      g.fillStyle = "rgba(0,0,0,0.35)"; for (let x = ox + 52; x < ox + 75; x += 3) g.fillRect(x, wp.y1 + 10, 1, 8);
      g.fillStyle = "rgba(60,50,40,0.18)"; g.fillRect(ox + 56, wp.y1 + 20, 12, 30);
    }
  }
};

/** Gold anodized aluminium, 1958-1975: brushed spandrel panels in the curtain wall's colour of money. */
const goldWall = (gold: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(gold); g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) { g.fillStyle = rnd() < 0.5 ? `rgba(255,250,220,${rnd() * 0.12})` : `rgba(60,40,0,${rnd() * 0.1})`; g.fillRect(0, y, w, 1); }
  for (const [ox, oy] of CELLS) {
    // each panel's pressed edge: lit above, shaded below
    g.fillStyle = rgb(gold, 1.25); g.fillRect(ox + 3, oy + 3, T - 6, 1.5);
    g.fillStyle = rgb(gold, 0.62); g.fillRect(ox + 3, oy + T - 4, T - 6, 1.5);
  }
};
/** The gold mullion caps standing proud of the glass, a broad one at each bay and a slim one between. */
const goldOver = (gold: RGB, win: Win): Painter => (g, w, _h, _rnd, pc) => {
  const cap = (x: number, ww: number) => {
    for (let i = 0; i < ww; i++) { const t = i / (ww - 1); g.fillStyle = rgb(gold, 1.35 - t * 0.75); g.fillRect(x + i, 0, 1, 2 * T); }
    if (pc) { pc.m.fillStyle = MK_NONE; pc.m.fillRect(x, 0, ww, 2 * T); pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(x, 0, ww, 2 * T); }
  };
  for (const x of [0, T, 2 * T]) cap(x - 4, 8);
  for (const x of [T / 2, T * 1.5]) cap(x - 2, 4);
  for (const [, oy] of [[0, 0], [0, T]]) {
    const wp = winPx(win, 0, oy);
    for (const y of [wp.y0, wp.y1 - 3]) { g.fillStyle = rgb(gold, 1.15); g.fillRect(0, y, w, 3); if (pc) { pc.m.fillStyle = MK_NONE; pc.m.fillRect(0, y, w, 3); } }
  }
};

/** Precast eggcrate, 1960-1980: a wall of deep cells, each window at the back of four splayed reveals. */
const eggWall = (c: RGB, win: Win): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  grime(g, w, h, rnd, 600, 0.05);
  relief(pc, 255, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    const wp = winPx(win, ox, oy);
    const a = [ox + 8, oy + 5], b = [ox + T - 8, oy + T - 5];
    const quad = (pts: number[][], v: number, hv: number) => {
      g.fillStyle = rgb(c, v); g.beginPath(); pts.forEach(([x, y]) => g.lineTo(x, y)); g.fill();
      if (pc) { pc.hg.fillStyle = `rgb(${hv},${hv},${hv})`; pc.hg.beginPath(); pts.forEach(([x, y]) => pc.hg.lineTo(x, y)); pc.hg.fill(); }
    };
    quad([[a[0], a[1]], [b[0], a[1]], [wp.x1, wp.y0], [wp.x0, wp.y0]], 0.5, 150);      // the soffit, in shadow
    quad([[a[0], a[1]], [wp.x0, wp.y0], [wp.x0, wp.y1], [a[0], b[1]]], 0.7, 150);
    quad([[b[0], a[1]], [b[0], b[1]], [wp.x1, wp.y1], [wp.x1, wp.y0]], 1.04, 150);
    quad([[a[0], b[1]], [b[0], b[1]], [wp.x1, wp.y1], [wp.x0, wp.y1]], 1.16, 150);
    // the arris lit along the top of the cell
    g.fillStyle = rgb(c, 1.12); g.fillRect(a[0], a[1] - 1.5, b[0] - a[0], 1.5);
  }
};
/** The shadow the cell casts onto its own glass. */
const eggOver = (win: Win): Painter => (g) => {
  for (const [ox, oy] of CELLS) {
    const wp = winPx(win, ox, oy);
    g.fillStyle = "rgba(0,0,0,0.38)"; g.fillRect(wp.x0, wp.y0, wp.x1 - wp.x0, 9); g.fillRect(wp.x0, wp.y0 + 9, 6, wp.y1 - wp.y0 - 9);
  }
};

/** Brick piers and bronze glass, 1968-1990: the suburban office — broad brick piers, the glass and a dark metal spandrel set back between them. */
const brickPierWall = (brick: RGB, spandrel: RGB, win: Win): Painter => (g, w, h, rnd, pc) => {
  bricks(g, rnd, brick, 0, 0, w, h, { bw: 18, bh: 5, spread: 0.14, mortar: "#8a8076" });
  relief(pc, 255, 0, 0, w, h);
  for (const [ox, oy] of CELLS) {
    const wp = winPx(win, ox, oy);
    fillBoth(g, pc, rgb(spandrel), MK_ACC, wp.x0, oy, wp.x1 - wp.x0, T);
    for (let y = oy + 2; y < oy + T; y += 3) { g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(wp.x0, y, wp.x1 - wp.x0, 1); }
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(wp.x0, wp.y1 + 1, wp.x1 - wp.x0, 1.5);
    relief(pc, 110, wp.x0, oy, wp.x1 - wp.x0, T);
    // the pier's returns: one lit, one in shadow, so the glass reads set back
    g.fillStyle = "rgba(0,0,0,0.38)"; g.fillRect(wp.x0 - 6, oy, 6, T);
    g.fillStyle = "rgba(255,240,220,0.12)"; g.fillRect(wp.x1, oy, 5, T);
    // a soldier course at the head of each floor
    for (let x = ox; x < ox + T; x += 6) if (x + 5 <= wp.x0 - 6 || x >= wp.x1 + 5) { g.fillStyle = rgb(brick, 0.86 + rnd() * 0.16); g.fillRect(x + 0.5, oy + 1, 5, 12); }
  }
};

/** High tech, 1975-1995: grey ribbed aluminium panels behind the frame. */
const techWall = (c: RGB): Painter => (g, w, h, _rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { g.fillStyle = rgb(c, 1.12); g.fillRect(0, y, w, 1); g.fillStyle = rgb(c, 0.86); g.fillRect(0, y + 2, w, 1); }
  for (let x = 0; x < w; x += 32) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x, 0, 1, h); }
  relief(pc, 220, 0, 0, w, h);
};
/** The exposed frame in front: round steel columns, beams at every floor, crossed tension rods with their node plates (accent). */
const techOver = (steel: RGB): Painter => (g, w, h, _rnd, pc) => {
  const both = (draw: (gg: CanvasRenderingContext2D, col: (v: number) => string) => void) => {
    draw(g, (v) => rgb(steel, v));
    if (pc) { draw(pc.m, () => MK_ACC); draw(pc.hg, () => "#ffffff"); }
  };
  // the rods first, behind the frame
  g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 9; g.beginPath(); g.moveTo(0, 3); g.lineTo(w, h + 3); g.moveTo(w, 3); g.lineTo(0, h + 3); g.stroke();
  both((gg, col) => {
    gg.strokeStyle = col(0.92); gg.lineWidth = 6.5;
    gg.beginPath(); gg.moveTo(0, 0); gg.lineTo(w, h); gg.moveTo(w, 0); gg.lineTo(0, h); gg.stroke();
  });
  g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -1.5); g.lineTo(w, h - 1.5); g.moveTo(w, -1.5); g.lineTo(0, h - 1.5); g.stroke();
  // the beams at the floors
  for (const y of [0, T, 2 * T]) both((gg, col) => {
    gg.fillStyle = col(1.0); gg.fillRect(0, y - 5, w, 10);
    gg.fillStyle = col(1.18); gg.fillRect(0, y - 5, w, 2);
    gg.fillStyle = col(0.68); gg.fillRect(0, y + 3, w, 2);
  });
  // the columns, round tubes lit from the left
  for (const x of [0, T, 2 * T]) both((gg, col) => {
    for (let i = -8; i < 8; i++) { gg.fillStyle = col(0.62 + 0.62 * Math.cos(((i + 3) / 11) * 1.4)); gg.fillRect(x + i, 0, 1, h); }
  });
  // the node plates and the turnbuckle at the crossing
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [T, T]]) both((gg, col) => {
    gg.fillStyle = col(1.08); gg.beginPath(); gg.arc(x, y, 10, 0, 6.283); gg.fill();
    gg.fillStyle = col(0.75); gg.beginPath(); gg.arc(x, y, 4, 0, 6.283); gg.fill();
  });
  g.fillStyle = "rgba(0,0,0,0.25)"; for (let x = 0; x <= w; x += T) g.fillRect(x + 8, 0, 3, h);
};

// paints, by name
const WHITE = "#f1ede4", CREAM = "#e8dcc2", GREY = "#9a9c98", PEWTER = "#6c7072", CHARCOAL = "#3a3c3e", BLACK = "#222324",
  BARN = "#8e3b2e", OXBLOOD = "#5c2622", FOREST = "#2f4a3a", TAN = "#c4ad88", TEAL = "#4f7f7c", STONE = "#d6ccb6",
  ORANGE = "#d47a34",
  SIGNAL = "#c8302a", BLUE = "#2c5aa0", YELLOW = "#e8b830", SILVER = "#c4c8cc", GREEN = "#3a8a4a";

// the window rectangles the painters line up with
const W_POWER: Win = { x0: 0.22, x1: 0.78, y0: 0.1, y1: 0.86 };
const W_FLEX: Win = { x0: 0, x1: 1, y0: 0.42, y1: 0.86 };
const W_STORE: Win = { x0: 0.24, x1: 0.76, y0: 0.32, y1: 0.76 };
const W_PROJ: Win = { x0: 0.22, x1: 0.78, y0: 0.3, y1: 0.8 };
const W_GOLD: Win = { x0: 0, x1: 1, y0: 0.36, y1: 0.96 };
const W_EGG: Win = { x0: 0.24, x1: 0.76, y0: 0.2, y1: 0.8 };
const W_PIER: Win = { x0: 0.3, x1: 0.7, y0: 0.22, y1: 0.97 };

export const BOOK_WORKS: BookEntry[] = [
  // POWER STATION. The generating houses of the street railways and the
  // electric companies, 1890-1935: one tall turbine hall behind brick piers,
  // lit by round-arched windows two storeys high under a corbelled eave.
  {
    key: "powerhouse", like: "industrial",
    spec: { bayW: 5.6, floorH: 8.0, masonry: true, glass: false, win: W_POWER, wall: powerWall([156, 78, 56], [168, 88, 64], [214, 204, 184], W_POWER), winStyle: "arch",
      glassCol: "#4e5e64", frameCol: "#2a2c2c", wallRough: 0.9, glassRough: 0.22, glassMetal: 0.2, trim: "#d6ccb4", mullions: [4, 7], reveal: 3.6 },
    variants: [
      { wall: powerWall([206, 180, 132], [214, 190, 142], [180, 96, 70], W_POWER), trim: "#a85a3e", frameCol: "#2e3a32" },
      { wall: powerWall([104, 58, 48], [116, 64, 52], [168, 164, 156], W_POWER), trim: "#a8a49c", glassCol: "#3e4a4e" },
      { wall: powerWall([150, 84, 62], [160, 92, 68], [222, 214, 196], W_POWER), winStyle: "segment", mullions: [5, 6], frameCol: "#3a2e26" },
    ],
    tints: [[1, 1, 1], [0.9, 0.86, 0.84], [1.05, 0.98, 0.92]],
    picker: { group: "works", name: "Power station", era: "1890-1935", maxFloors: 10, variants: ["Red brick, stone arches", "Buff, terra cotta trim", "Sooted brick", "Segmental sash"] },
    city: [{ share: 0.06, from: 1890, to: 1935, minH: 12, maxH: 45, cls: ["industrial"] }],
  },
  // BREWERY. The lager breweries of the German wards, 1860-1915: brick
  // Rundbogenstil with pilaster strips, an arched corbel table at every
  // floor and round-arched windows in dressed brick.
  {
    key: "brewery", like: "industrial", style: "chicago",
    spec: { bayW: 3.4, floorH: 4.4, masonry: true, glass: false, win: { x0: 0.32, x1: 0.68, y0: 0.14, y1: 0.7 }, wall: breweryWall([150, 72, 54], [196, 120, 84]), winStyle: "arch",
      glassCol: "#3a4a52", frameCol: "#2e2a26", wallRough: 0.88, glassRough: 0.14, glassMetal: 0.05, trim: "#d8c6a4", mullions: [2, 3], reveal: 3.8 },
    variants: [
      { wall: breweryWall([222, 204, 156], [168, 84, 60]), trim: "#a85a3e", frameCol: "#3a2a22" },
      { wall: breweryWall([112, 56, 46], [150, 80, 60]), winStyle: "segment", trim: "#cbbd9e" },
      { wall: breweryWall([168, 96, 70], [224, 210, 176]), trim: "#ece2c8", frameCol: "#1e2a24", mullions: [2, 4] },
    ],
    tints: [[1, 1, 1], [0.92, 0.88, 0.86], [1.04, 0.98, 0.92]],
    picker: { group: "works", name: "Brewery", era: "1860-1915", maxFloors: 8, variants: ["Red, buff corbels", "Cream City brick", "Dark, segmental", "Red, white dressings"] },
    city: [{ share: 0.08, from: 1860, to: 1915, maxH: 30, cls: ["industrial"] }],
  },
  // TEXTILE MILL. The long mill of the river towns, 1830-1920: four to six
  // storeys of common-bond brick (or granite) with tall sash set close
  // together for light on the looms, granite lintels and sills.
  {
    key: "textilemill", like: "industrial",
    spec: { bayW: 2.5, floorH: 4.0, masonry: true, glass: false, win: { x0: 0.24, x1: 0.76, y0: 0.14, y1: 0.84 }, wall: millWall([158, 74, 56]),
      glassCol: "#3e4c54", frameCol: "#ece6d8", wallRough: 0.9, glassRough: 0.14, glassMetal: 0.05, trim: "#b8b2a6", mullions: [3, 4], reveal: 3.0 },
    variants: [
      { wall: millWall([222, 216, 204]), frameCol: "#3e5a48", trim: "#8a8478" },
      { wall: graniteRubble([150, 146, 140]), frameCol: "#e8e2d4", trim: "#c8c2b6", mullions: [2, 4] },
      { wall: millWall([196, 164, 116]), winStyle: "segment", frameCol: "#2e3a32", trim: "#d8ccb4" },
    ],
    tints: [[1, 1, 1], [0.9, 0.86, 0.84], [1.05, 0.98, 0.92]],
    picker: { group: "works", name: "Textile mill", era: "1830-1920", maxFloors: 6, variants: ["Red common bond", "Whitewashed", "Granite", "Buff, segmental"] },
    city: [{ share: 0.1, from: 1830, to: 1920, maxH: 24, cls: ["industrial"] }],
  },
  // CORRUGATED IRON. The shed: the foundry, the car barn, the yard store,
  // 1890 to now — galvanised sheet on a steel frame, a band of wired glass
  // under the eaves, painted when the owner cared and rusting when not.
  {
    key: "corrugated", like: "industrial",
    spec: { bayW: 4.8, floorH: 5.4, masonry: false, glass: false, win: { x0: 0.06, x1: 0.94, y0: 0.72, y1: 0.9 }, wall: corrugatedWall([176, 180, 178], 0.25),
      glassCol: "#8c9a96", frameCol: "#4a4e50", wallRough: 0.5, glassRough: 0.5, glassMetal: 0.1, mullions: [8, 1], reveal: 3.2 },
    variants: [
      { wall: corrugatedWall([150, 62, 48], 0.35), frameCol: "#e8e4dc" },
      { wall: corrugatedWall([130, 96, 70], 0.9), noWin: true },
      { wall: corrugatedWall([74, 104, 84], 0.2), frameCol: "#d8d8d0", glassCol: "#7a8c88" },
    ],
    tints: [[1, 1, 1], [0.94, 0.95, 0.96], [1.04, 1.0, 0.94]],
    palette: P(0.45, [BARN, FOREST, GREY, WHITE, TAN, TEAL, "#5a6a62", CREAM], 0, [], 0.6, [BARN, WHITE, BLACK, FOREST, CHARCOAL]),
    picker: { group: "works", name: "Corrugated shed", era: "1890-today", maxFloors: 4, variants: ["Galvanised", "Barn red", "Rusted, blank", "Green"] },
    city: [
      { share: 0.1, from: 1890, maxH: 14, cls: ["industrial"] },
      { parent: "metalpanel", share: 0.1, from: 1970, maxH: 12, cls: ["industrial"] },
    ],
  },
  // TILT-UP. The post-war warehouse and the big box, 1960 to now: wall
  // panels cast flat on the floor slab and tilted up, caulked joints,
  // reveal grooves and a painted band, a dock door and not much else.
  {
    key: "tiltup", like: "precast", style: "vernacular",
    spec: { bayW: 7.0, floorH: 4.6, masonry: false, glass: false, noWin: true, win: { x0: 0, x1: 0, y0: 0, y1: 0 }, wall: tiltWall([214, 208, 196], [60, 96, 112], true),
      glassCol: "#3e5664", frameCol: "#2a2e30", wallRough: 0.85, glassRough: 0.06, glassMetal: 0.5, reveal: 2.6 },
    variants: [
      { wall: tiltWall([196, 196, 192], [120, 50, 44], true) },
      { wall: tiltWall([222, 214, 196], [86, 90, 92], false), noWin: false, win: { x0: 0.1, x1: 0.9, y0: 0.12, y1: 0.62 }, mullions: [4, 1], glassCol: "#3a5a72", frameCol: "#c8ccd0" },
      { wall: tiltWall([206, 186, 160], [154, 92, 58], true) },
    ],
    tints: [[1, 1, 1], [0.97, 0.95, 0.92], [0.93, 0.94, 0.95]],
    palette: P(0.85, [WHITE, "#e2d8c4", "#cfc8b8", "#b8b4aa", "#d9cdb0", "#c4c8c8"], 0.5, [WHITE, GREY, CHARCOAL], 0.85, ["#2a5a6a", "#25324a", OXBLOOD, PEWTER, TEAL, "#94502e", CHARCOAL]),
    picker: { group: "works", name: "Tilt-up concrete", era: "1960-today", maxFloors: 4, variants: ["Beige, teal band", "Grey, red band", "Office front, blue glass", "Sand, rust band"] },
    city: [
      { share: 0.2, from: 1960, maxH: 14, cls: ["industrial"] },
      { share: 0.1, from: 1972, maxH: 9, cls: ["retail"] },
    ],
  },
  // FLEX SPACE. The office park and the R&D building off the beltway,
  // 1975 to now: a ribbon of reflective glass under a smooth fascia, over a
  // base of split-face block; one or two storeys, a lawn and a car park.
  {
    key: "flexspace", like: "modern",
    spec: { bayW: 3.0, floorH: 3.9, masonry: false, glass: false, win: W_FLEX, wall: splitFace([196, 178, 150], [222, 214, 198], W_FLEX),
      glassCol: "#6e5a46", frameCol: "#3a2e24", wallRough: 0.8, glassRough: 0.05, glassMetal: 0.85, mullions: [2, 1], reveal: 2.0 },
    variants: [
      { wall: splitFace([170, 172, 170], [214, 216, 216], W_FLEX), glassCol: "#46708e", frameCol: "#b8c0c6" },
      { wall: splitFace([232, 228, 218], [196, 190, 178], W_FLEX, true), glassCol: "#3e7a6c", frameCol: "#d8dad6" },
      { wall: splitFace([150, 86, 66], [204, 196, 184], W_FLEX), glassCol: "#3a3c40", frameCol: "#1e2022" },
    ],
    tints: [[1, 1, 1], [0.96, 0.94, 0.9], [1.03, 1.0, 0.96]],
    picker: { group: "works", name: "Flex / R&D", era: "1975-today", maxFloors: 3, variants: ["Tan block, bronze glass", "Grey block, blue glass", "White, green glass", "Red block, smoked glass"] },
    city: [
      { share: 0.15, from: 1975, maxH: 12, cls: ["office"] },
      { parent: "precast", share: 0.1, from: 1975, maxH: 12, cls: ["industrial"] },
    ],
  },
  // GLASS BLOCK. The streamlined factory of 1930-1958: a concrete frame
  // filled with panels of pressed glass block for an even light on the
  // floor, a small steel vent sash in each; at night the whole wall glows.
  {
    key: "glassblock", like: "daylight",
    spec: { bayW: 4.4, floorH: 4.4, masonry: false, glass: false, win: { x0: 0.38, x1: 0.62, y0: 0.32, y1: 0.62 }, wall: glassBlockWall([206, 200, 188], [176, 204, 204]),
      glassCol: "#55686e", frameCol: "#2e3a32", wallRough: 0.88, glassRough: 0.2, glassMetal: 0.2, mullions: [2, 3], reveal: 2.4 },
    variants: [
      { wall: glassBlockWall([176, 92, 66], [196, 214, 206], true), frameCol: "#2a2c2a" },
      { wall: glassBlockWall([228, 224, 214], [214, 210, 186]), frameCol: "#5a2e22" },
      { wall: glassBlockWall([170, 168, 162], [150, 186, 196]), win: { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.55 }, mullions: [3, 2] },
    ],
    tints: [[1, 1, 1], [0.95, 0.95, 0.93]],
    palette: P(0.3, [WHITE, CREAM, "#c8c2b4", GREY], 0, [], 0.8, [BLACK, FOREST, "#5a2e22", "#4a5560", CHARCOAL]),
    picker: { group: "works", name: "Glass-block factory", era: "1930-1958", maxFloors: 8, variants: ["Concrete, green block", "Brick piers", "White, amber block", "Grey, blue block"] },
    city: [{ share: 0.15, from: 1930, to: 1958, maxH: 30, cls: ["industrial"] }],
  },
  // TERMINAL WAREHOUSE. The railroad's freight house and stores on the
  // waterfront, 1880-1930: a long brick block of deep piers and stone belt
  // courses, segmental windows behind iron fire shutters, hoist doors.
  {
    key: "terminal", like: "industrial",
    spec: { bayW: 4.0, floorH: 4.2, masonry: true, glass: false, win: { x0: 0.31, x1: 0.69, y0: 0.2, y1: 0.78 }, wall: terminalWall([146, 74, 56], [200, 192, 176], false), winStyle: "segment",
      glassCol: "#46545a", frameCol: "#2c2e2c", wallRough: 0.9, glassRough: 0.2, glassMetal: 0.1, trim: "#c8bea8", shutter: "#3e463e", mullions: [2, 3], reveal: 3.4 },
    variants: [
      { wall: terminalWall([140, 70, 54], [196, 188, 172], true), win: { x0: 0.33, x1: 0.67, y0: 0.04, y1: 0.8 }, winStyle: "rect", shutter: "#5a2e24", mullions: [2, 4] },
      { wall: terminalWall([196, 170, 126], [168, 160, 146], false), shutter: "#2a2c2c", trim: "#8a7a62" },
      { wall: terminalWall([118, 62, 50], [180, 176, 168], false), shutter: undefined, mullions: [3, 3], frameCol: "#4a5a50" },
    ],
    tints: [[1, 1, 1], [0.9, 0.86, 0.84], [1.04, 0.98, 0.94]],
    picker: { group: "works", name: "Terminal warehouse", era: "1880-1930", maxFloors: 10, variants: ["Iron shutters", "Hoist doors", "Buff, black shutters", "Dark, open sash"] },
    city: [{ share: 0.08, from: 1880, to: 1930, minH: 12, maxH: 40, cls: ["industrial"] }],
  },
  // PUMP HOUSE. The waterworks' engine house, 1870-1920, built by a city
  // proud of its water: High Victorian polychrome brick, round-arched sash
  // and an oculus over each, stone dressings.
  {
    key: "pumphouse", like: "industrial", style: "victorian",
    spec: { bayW: 4.0, floorH: 6.4, masonry: true, glass: false, win: { x0: 0.33, x1: 0.67, y0: 0.08, y1: 0.64 },
      wall: pumpWall([164, 76, 56], [46, 38, 36], [222, 202, 160], [216, 206, 186]), winStyle: "arch",
      glassCol: "#3c4c56", frameCol: "#e6dfcf", wallRough: 0.88, glassRough: 0.12, glassMetal: 0.05, trim: "#ddd0b4", mullions: [2, 4], reveal: 3.6 },
    variants: [
      { wall: pumpWall([214, 190, 140], [150, 68, 50], [150, 68, 50], [206, 196, 176]), trim: "#a85a3e", frameCol: "#2e2a26" },
      { wall: pumpWall([140, 64, 50], [222, 206, 170], [222, 206, 170], [196, 186, 166]), frameCol: "#2a3a30" },
      { wall: pumpWall([186, 176, 156], [0, 0, 0], [0, 0, 0], [222, 214, 196], true), trim: "#efe6d2", frameCol: "#2a2c2c" },
    ],
    tints: [[1, 1, 1], [0.92, 0.9, 0.88], [1.04, 1.0, 0.95]],
    palette: P(0, [], 0.25, [CREAM, STONE], 0.7, [BLACK, FOREST, OXBLOOD, CHARCOAL, WHITE]),
    picker: { group: "works", name: "Pump house", era: "1870-1920", maxFloors: 3, variants: ["Red, black bands", "Buff, red bands", "Dark red, cream bands", "Ashlar"] },
    city: [{ share: 0.04, from: 1870, to: 1920, maxH: 12, cls: ["industrial"] }],
  },
  // DATA CENTRE. The server hall of 2000 on: a blank box of insulated metal
  // panel or precast, louvre bands for the air handlers, a screen round the
  // generators, a steel door. No windows; it has nobody to light.
  {
    key: "datacentre", like: "metalpanel", style: "vernacular",
    spec: { bayW: 6.0, floorH: 6.0, masonry: false, glass: false, noWin: true, win: { x0: 0, x1: 0, y0: 0, y1: 0 }, wall: dcWall([196, 198, 198], [150, 154, 156], "band"),
      glassCol: "#3a4650", frameCol: "#2a2c2e", wallRough: 0.45, glassRough: 0.1, glassMetal: 0.4, reveal: 2.0 },
    variants: [
      { wall: dcWall([226, 222, 212], [120, 124, 126], "precast"), wallRough: 0.8 },
      { wall: dcWall([66, 70, 74], [44, 46, 50], "screen") },
      { wall: dcWall([176, 182, 186], [56, 86, 120], "band") },
    ],
    tints: [[1, 1, 1], [0.96, 0.97, 0.98], [1.02, 1.0, 0.97]],
    palette: P(0.3, ["#e6e6e2", GREY, PEWTER, CHARCOAL], 0.4, [CHARCOAL, GREY, "#e6e6e2"], 0.3, [CHARCOAL, BLACK]),
    picker: { group: "works", name: "Data centre", era: "2000-today", maxFloors: 6, variants: ["Grey panel, louvre band", "White precast", "Charcoal, louvre screen", "Silver, blue louvres"] },
    city: [{ parent: "metalpanel", share: 0.12, from: 2000, maxH: 30, cls: ["industrial"] }],
  },
  // SELF STORAGE. 1975 to now: rows of drive-up units behind roll-up doors,
  // and later the climate-controlled block of ribbed panel; either way the
  // operator's colour on the doors, the band and the frames.
  {
    key: "selfstorage", like: "metalpanel", style: "vernacular",
    spec: { bayW: 3.6, floorH: 3.4, masonry: false, glass: false, win: W_STORE, wall: storageWall([222, 218, 206], [212, 112, 44], W_STORE, false), over: storageOver(W_STORE),
      glassCol: "#c8763c", frameCol: "#d47a34", wallRough: 0.5, glassRough: 0.1, glassMetal: 0.3, mullions: [1, 1], reveal: 2.0 },
    variants: [
      { wall: storageWall([206, 200, 186], [212, 112, 44], W_STORE, true), noWin: true, over: undefined },
      { wall: storageWall([200, 204, 208], [44, 100, 168], W_STORE, false), glassCol: "#4a7cb0", frameCol: "#2c64a8" },
      { wall: storageWall([214, 204, 182], [58, 130, 70], W_STORE, true), noWin: true, over: undefined },
    ],
    tints: [[1, 1, 1], [0.97, 0.96, 0.94]],
    palette: P(0.6, [WHITE, CREAM, SILVER, GREY, STONE], 0, [], 1.0, [ORANGE, "#e05a2a", BLUE, GREEN, SIGNAL, YELLOW, "#2a9aa0"]),
    picker: { group: "works", name: "Self storage", era: "1975-today", maxFloors: 5, variants: ["Orange, climate block", "Orange doors, drive-up", "Blue, climate block", "Green doors, drive-up"] },
    city: [
      { parent: "metalpanel", share: 0.1, from: 1975, maxH: 18, cls: ["industrial"] },
      { parent: "metalpanel", share: 0.06, from: 2005, maxH: 18, cls: ["retail"] },
    ],
  },
  // BRISE-SOLEIL. Le Corbusier's sunscreen as built across the Americas,
  // 1950-1975: a deep concrete grid of fins and shelves standing clear of
  // the glass — the consulate, the courthouse, the college tower.
  {
    key: "brisesoleil", like: "grid",
    spec: { bayW: 2.4, floorH: 3.6, masonry: false, glass: false, win: { x0: 0.04, x1: 0.96, y0: 0.06, y1: 0.94 }, wall: panelDark([60, 64, 66]), over: briseOver([200, 196, 186], "grid"),
      glassCol: "#3a4a52", frameCol: "#3a3c3c", wallRough: 0.85, glassRough: 0.12, glassMetal: 0.25, mullions: [2, 1], reveal: 5.0 },
    variants: [
      { over: briseOver([214, 210, 200], "blade"), glassCol: "#3e5664" },
      { over: briseOver([186, 180, 168], "shelf"), glassCol: "#2e3a40" },
      { over: briseOver([214, 196, 168], "grid"), glassCol: "#4a6a7c", frameCol: "#c8ccd0" },
    ],
    tints: [[1, 1, 1], [0.95, 0.94, 0.92], [1.03, 1.0, 0.96]],
    picker: { group: "postwar", name: "Brise-soleil", era: "1950-1975", maxFloors: 30, variants: ["Concrete grid", "Deep blades", "Horizontal louvres", "Warm grid, blue glass"] },
    city: [
      { parent: "grid", share: 0.12, from: 1950, to: 1975, cls: ["office"] },
      { parent: "grid", share: 0.08, from: 1958, to: 1975, cls: ["multifamily"] },
      { parent: "modern", share: 0.06, from: 1955, to: 1975, minH: 12, maxH: 30, cls: ["office"] },
    ],
  },
  // BREEZE BLOCK. The pierced concrete screen of 1955-1972, from the garden
  // apartment's balconies to Edward Durell Stone's whole-front grille: block
  // after block of circles, diamonds or squares in front of the glass.
  {
    key: "screenblock", like: "modern", style: (_y, h) => h > 16 ? "modernist" : "midcentury",
    spec: { bayW: 3.0, floorH: 3.2, masonry: false, glass: false, win: { x0: 0.24, x1: 0.76, y0: 0.24, y1: 0.82 }, wall: stuccoWall([226, 220, 206]), over: screenOver([240, 238, 230], "circle", "half"),
      glassCol: "#3e5260", frameCol: "#5a5e60", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.2, mullions: [2, 1], reveal: 3.4 },
    variants: [
      { over: screenOver([238, 234, 222], "quad", "full"), wall: stuccoWall([200, 196, 188]) },
      { over: screenOver([226, 206, 170], "diamond", "half"), wall: stuccoWall([238, 228, 206]), frameCol: "#3a2e26" },
      { over: screenOver([232, 232, 228], "circle", "lower"), wall: stuccoWall([170, 196, 196]), win: { x0: 0.12, x1: 0.88, y0: 0.42, y1: 0.86 } },
    ],
    tints: [[1, 1, 1], [0.98, 0.96, 0.92]],
    picker: { group: "postwar", name: "Breeze-block screen", era: "1955-1972", maxFloors: 12, variants: ["Circles, balconies", "Whole-front grille", "Diamonds, sand", "Railings, aqua"] },
    city: [
      { share: 0.08, from: 1955, to: 1972, maxH: 40, cls: ["multifamily"] },
      { share: 0.08, from: 1955, to: 1972, maxH: 12, cls: ["retail"] },
      { share: 0.05, from: 1958, to: 1972, maxH: 30, cls: ["office"] },
    ],
  },
  // HOUSING PROJECT. The tower in the park, 1945-1975: plain red brick
  // without a moulding, steel casement windows, the floor slab sometimes
  // showing, an air conditioner pushed through the wall.
  {
    key: "projectbrick", like: "whitebrick",
    spec: { bayW: 3.2, floorH: 2.8, masonry: true, glass: false, win: W_PROJ, wall: projectWall([164, 80, 58], W_PROJ, null),
      glassCol: "#3a4a52", frameCol: "#3c4a44", wallRough: 0.88, glassRough: 0.1, glassMetal: 0.15, mullions: [3, 3], reveal: 2.4 },
    variants: [
      { wall: projectWall([150, 74, 56], W_PROJ, [196, 192, 184]), frameCol: "#2e3032" },
      { wall: projectWall([120, 70, 62], W_PROJ, null), winStyle: "pair", mullions: [2, 3], frameCol: "#5a5e60" },
      { wall: projectWall([200, 172, 128], W_PROJ, [206, 202, 194]), win: { x0: 0.16, x1: 0.84, y0: 0.28, y1: 0.82 }, mullions: [4, 2], frameCol: "#7a8a84" },
    ],
    tints: [[1, 1, 1], [0.94, 0.9, 0.88], [1.04, 0.98, 0.94], [0.9, 0.86, 0.86]],
    palette: P(0, [], 0, [], 0.5, [CHARCOAL, "#3c4a44", SILVER, WHITE, "#5a6a62"]),
    picker: { group: "postwar", name: "Housing-project brick", era: "1945-1975", maxFloors: 30, variants: ["Red brick, casements", "Slab bands", "Brown, paired", "Buff, slab bands"] },
    city: [
      { share: 0.2, from: 1945, to: 1975, minH: 20, cls: ["multifamily"] },
      { parent: "brick", share: 0.15, from: 1945, to: 1975, minH: 26, cls: ["multifamily"] },
    ],
  },
  // GOLD ANODIZED. The curtain wall of 1958-1975 dressed for the bank and
  // the insurer: gold anodized spandrels and proud gold mullion caps over
  // bronze-grey glass. Anodizing is the colour; nobody repaints it.
  {
    key: "goldanodized", like: "ribbon",
    spec: { bayW: 1.5, floorH: 3.7, masonry: false, glass: false, win: W_GOLD, wall: goldWall([196, 156, 74]), over: goldOver([206, 166, 80], W_GOLD),
      glassCol: "#4a4232", frameCol: "#b8964a", wallRough: 0.3, glassRough: 0.05, glassMetal: 0.8, reveal: 1.6 },
    variants: [
      { wall: goldWall([206, 184, 132]), over: goldOver([214, 194, 142], W_GOLD), glassCol: "#3e4448" },
      { wall: goldWall([150, 112, 52]), over: goldOver([176, 136, 64], W_GOLD), glassCol: "#22201c", frameCol: "#7a5a2a" },
      { wall: goldWall([214, 176, 90]), over: goldOver([220, 184, 98], W_GOLD), glassCol: "#525a5e", win: { x0: 0, x1: 1, y0: 0.42, y1: 0.94 } },
    ],
    tints: [[1, 1, 1], [1.03, 1.0, 0.94]],
    palette: null,
    picker: { group: "postwar", name: "Gold anodized", era: "1958-1975", maxFloors: 40, variants: ["Gold, bronze glass", "Champagne", "Dark gold, black glass", "Bright gold, grey glass"] },
    city: [
      { share: 0.15, from: 1958, to: 1975, cls: ["office"] },
      { parent: "midcentury", share: 0.1, from: 1958, to: 1972, minH: 12, cls: ["office"] },
    ],
  },
  // EGGCRATE. The precast office and dormitory of 1960-1980: a wall of deep
  // cells, each window sunk behind four splayed reveals that hold the sun
  // off the glass.
  {
    key: "eggcrate", like: "grid",
    spec: { bayW: 2.4, floorH: 3.6, masonry: false, glass: false, win: W_EGG, wall: eggWall([212, 206, 194], W_EGG), over: eggOver(W_EGG),
      glassCol: "#2e3c46", frameCol: "#3a3c3c", wallRough: 0.8, glassRough: 0.1, glassMetal: 0.3, reveal: 5.0 },
    variants: [
      { wall: eggWall([232, 230, 224], W_EGG), frameCol: "#8a9094", glassCol: "#3a4c58" },
      { wall: eggWall([200, 180, 150], W_EGG), glassCol: "#4a3e32", frameCol: "#3a2e24" },
      { wall: eggWall([160, 158, 152], { x0: 0.2, x1: 0.8, y0: 0.16, y1: 0.84 }), over: eggOver({ x0: 0.2, x1: 0.8, y0: 0.16, y1: 0.84 }), win: { x0: 0.2, x1: 0.8, y0: 0.16, y1: 0.84 }, mullions: [2, 1] },
    ],
    tints: [[1, 1, 1], [0.96, 0.95, 0.93], [1.02, 1.0, 0.97]],
    picker: { group: "postwar", name: "Precast eggcrate", era: "1960-1980", maxFloors: 40, variants: ["Concrete", "White", "Sand, bronze glass", "Grey, wide cells"] },
    city: [
      { share: 0.14, from: 1960, to: 1980, cls: ["office"] },
      { share: 0.1, from: 1960, to: 1975, cls: ["multifamily"] },
    ],
  },
  // BRICK PIERS. The suburban and downtown office of 1968-1990: broad
  // brick piers with the bronze glass and a dark anodized spandrel set
  // back between them — the savings-and-loan, the medical building.
  {
    key: "brickpier", like: "modern",
    spec: { bayW: 3.0, floorH: 3.7, masonry: true, glass: false, win: W_PIER, wall: brickPierWall([150, 86, 62], [62, 48, 36], W_PIER),
      glassCol: "#6a523c", frameCol: "#2e241c", wallRough: 0.85, glassRough: 0.05, glassMetal: 0.8, mullions: [1, 2], reveal: 3.4 },
    variants: [
      { wall: brickPierWall([186, 150, 112], [62, 48, 36], W_PIER), glassCol: "#5a4836" },
      { wall: brickPierWall([96, 60, 50], [44, 46, 48], W_PIER), glassCol: "#3e4448", frameCol: "#1e2022" },
      { wall: brickPierWall([200, 176, 136], [196, 190, 178], W_PIER), glassCol: "#2e3438", frameCol: "#2a2a2a" },
    ],
    tints: [[1, 1, 1], [0.94, 0.9, 0.86], [1.04, 1.0, 0.94]],
    palette: P(0, [], 0, [], 0.4, [BLACK, CHARCOAL, "#5a4630"]),
    picker: { group: "postwar", name: "Brick piers, bronze glass", era: "1968-1990", maxFloors: 20, variants: ["Red-brown, bronze", "Tan, bronze", "Chocolate, grey glass", "Buff, concrete spandrels"] },
    city: [
      { share: 0.15, from: 1968, to: 1990, maxH: 30, cls: ["office"] },
      { parent: "precast", share: 0.08, from: 1968, to: 1990, maxH: 30, cls: ["office"] },
    ],
  },
  // HIGH TECH. 1975-1995: the frame worn outside — round steel columns,
  // beams at every floor, crossed tension rods with their node plates — in
  // front of grey ribbed panels and clear glass, the steel painted.
  {
    key: "hightech", like: "glass", style: "modernist",
    spec: { bayW: 3.6, floorH: 4.0, masonry: false, glass: true, win: { x0: 0.08, x1: 0.92, y0: 0.12, y1: 0.9 }, wall: techWall([168, 172, 176]), over: techOver([232, 232, 228]),
      glassCol: "#7f9aaa", frameCol: "#c8ccd0", wallRough: 0.35, glassRough: 0.05, glassMetal: 0.8, mullions: [2, 1], reveal: 2.6 },
    variants: [
      { over: techOver([190, 52, 44]), wall: techWall([150, 154, 158]), frameCol: "#3a3c3e" },
      { over: techOver([44, 88, 160]), wall: techWall([186, 190, 194]), glassCol: "#6a8aa0" },
      { over: techOver([70, 74, 78]), wall: techWall([200, 202, 204]), glassCol: "#8aa4b2", frameCol: "#e0e2e4" },
    ],
    tints: [[1, 1, 1], [0.96, 0.97, 1.0]],
    palette: P(0, [], 0, [], 0.7, [WHITE, SIGNAL, BLUE, YELLOW, SILVER, CHARCOAL, "#4f8a5a"]),
    picker: { group: "postwar", name: "High-tech", era: "1975-1995", maxFloors: 40, variants: ["White steel", "Red steel", "Blue steel", "Graphite steel"] },
    city: [
      { share: 0.06, from: 1975, to: 1995, minH: 20, cls: ["office"] },
      { parent: "silverglass", share: 0.05, from: 1980, to: 1995, minH: 20, cls: ["office"] },
    ],
  },
];

/** The dark wall behind a sunscreen: the shade the screen throws. */
function panelDark(c: RGB): Painter { return (g, w, h) => { g.fillStyle = rgb(c); g.fillRect(0, 0, w, h); }; }
