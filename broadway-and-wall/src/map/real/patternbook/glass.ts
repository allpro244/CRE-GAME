// THE GLASS SHELF AND THE CONTEMPORARY ONE. The curtain walls the originals
// left out — the double skin, the dichroic and low-iron towers, the gold and
// rose mirrors of the 1980s, the sawtooth, the louvre and the baguette — and
// the materials the 2005-2025 mid-rise was actually clad in: weathering steel,
// perforated screens, pierced brick, glazed tile, planted walls, charred wood,
// fluted precast, GFRC, channel glass and copper. Each paints its own relief
// and marks its paintable parts (pc.m: green trim, blue accent) as facades.ts
// does; what stands in front of the glass is drawn in `over`.
import type { BookEntry } from "./types";
import { TILE, P, type FamilySpec, type Painter, type PaintCtx } from "../facades";

type RGB = [number, number, number];
type Win = FamilySpec["win"];
const T = TILE;
const MK_TRIM = "rgb(0,255,0)", MK_ACC = "rgb(0,0,255)";
const cl = (x: number) => Math.max(0, Math.min(255, x)) | 0;
const rgb = (c: RGB, v = 1) => `rgb(${cl(c[0] * v)},${cl(c[1] * v)},${cl(c[2] * v)})`;
const rgba = (c: RGB, a: number, v = 1) => `rgba(${cl(c[0] * v)},${cl(c[1] * v)},${cl(c[2] * v)},${a})`;
function fillBoth(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, mk: string | null, x: number, y: number, w: number, h: number) {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  if (pc && mk) { pc.m.fillStyle = mk; pc.m.fillRect(x, y, w, h); }
}
const relief = (pc: PaintCtx | undefined, col: string, x: number, y: number, w: number, h: number) => { if (pc) { pc.hg.fillStyle = col; pc.hg.fillRect(x, y, w, h); } };
/** The window of bay bx, floor by, on the canvas (the tile is drawn head up). */
const winAt = (w: Win, bx: number, by: number) => ({ x0: bx * T + w.x0 * T, x1: bx * T + w.x1 * T, y0: by * T + (1 - w.y1) * T, y1: by * T + (1 - w.y0) * T });
const CELLS: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
/** Multiply the drawn colour by a pattern that repeats with the tile: the sky's broad reflection in a sheet of glass. */
const shimmer = (g: CanvasRenderingContext2D, w: number, h: number, f: (x: number, y: number) => number) => {
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = f(x, y), i = (y * w + x) * 4;
    d[i] = cl(d[i] * k); d[i + 1] = cl(d[i + 1] * k); d[i + 2] = cl(d[i + 2] * k);
  }
  g.putImageData(im, 0, 0);
};
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// THE GLASS
// ---------------------------------------------------------------------------

/** Inner wall of a double skin: dark rooms behind the glass and a pale slab edge at each floor. */
const dsWall = (room: RGB): Painter => (g, w, h) => {
  g.fillStyle = rgb(room); g.fillRect(0, 0, w, h);
  for (let by = 0; by < 2; by++) { g.fillStyle = rgb(room, 1.9); g.fillRect(0, by * T + T - 15, w, 6); }
};
/**
 * The outer skin of a double-skin wall (drawn after the glass): a second,
 * paler sheet hung a metre out on point fixings, its storey-high lights offset
 * half a floor from the rooms, the maintenance catwalk at every slab casting
 * a band of shadow on the floor below, and on some a dotted frit.
 */
const dsOver = (skin: RGB, a: number, walk: RGB, frit = false): Painter => (g, w, h, _r, pc) => {
  g.fillStyle = rgba(skin, a); g.fillRect(0, 0, w, h);
  for (const [bx, by] of CELLS) {
    const ox = bx * T, oy = by * T, cy = oy + T - 16;
    // the catwalk's shadow, wrapping into the next floor
    for (const dy of [0, -h]) {
      const sg = g.createLinearGradient(0, cy + 7 + dy, 0, cy + 34 + dy);
      sg.addColorStop(0, "rgba(0,0,0,0.42)"); sg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sg; g.fillRect(ox, cy + 7 + dy, T, 27);
    }
    // the grating and its outriggers
    fillBoth(g, pc, rgb(walk), MK_ACC, ox, cy, T, 7);
    g.fillStyle = "rgba(0,0,0,0.3)"; for (let x = ox; x < ox + T; x += 3) g.fillRect(x, cy + 1, 1, 6);
    g.fillStyle = rgb(walk, 1.25); g.fillRect(ox, cy, T, 1.2);
    fillBoth(g, pc, rgb(walk, 0.7), MK_ACC, ox + T / 2 - 2, cy - 5, 4, 14);
    relief(pc, "#ffffff", ox, cy, T, 7);
    if (frit) {
      // the frit: a band of dots densest at the joint, fading out
      const jy = oy + T * 0.5;
      for (let y = jy - 22; y <= jy + 22; y += 4) for (let x = ox + 2; x < ox + T; x += 4) {
        const r = 1.5 * (1 - Math.abs(y - jy) / 26);
        if (r > 0.2) { g.fillStyle = "rgba(240,242,240,0.7)"; g.beginPath(); g.arc(x + ((y / 4) % 2) * 2, y, r, 0, TAU); g.fill(); }
      }
    }
    // the outer lights' joints and the spider fixings at their corners
    g.fillStyle = "rgba(226,234,238,0.6)"; g.fillRect(ox, oy, 1.5, T); g.fillRect(ox, oy + T * 0.5, T, 1.5);
    g.fillStyle = "rgba(200,206,210,0.95)"; g.beginPath(); g.arc(ox + 1, oy + T * 0.5, 3, 0, TAU); g.fill();
  }
  // the outer sheet catches the sky on a long diagonal
  shimmer(g, w, h, (x, y) => 1 + 0.1 * Math.sin(TAU * (x + y) / 256));
};



/** Gold reflective glass (after the glass): a metallic warm sheen with a hard sun glint running across the tower. */
const goldOver = (glint: number): Painter => (g, w, h) => {
  shimmer(g, w, h, (x, y) => {
    const s = Math.sin(TAU * (x - y) / 256);
    return 0.94 + 0.1 * Math.sin(TAU * (x + y) / 256) + glint * Math.pow(Math.max(0, s), 10);
  });
};
/** A gold spandrel: the same mirror over an opaque panel, a shade deeper, with the slab joint. */
const goldWall = (c: RGB): Painter => (g, w, h) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let by = 0; by < 2; by++) {
    const gr = g.createLinearGradient(0, by * T, 0, by * T + T); gr.addColorStop(0, rgb(c, 1.08)); gr.addColorStop(1, rgb(c, 0.82));
    g.fillStyle = gr; g.fillRect(0, by * T, w, T);
    g.fillStyle = rgb(c, 0.55); g.fillRect(0, by * T + T - 2, w, 2);
  }
};

/** Rose reflective glass: a mauve spandrel band with a recessed reveal and a bright aluminium sill line (trim); granite, on the postmodern ones. */
const roseWall = (c: RGB, band: RGB, granite = false): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  if (granite) for (let i = 0; i < 2600; i++) { const v = rnd(); g.fillStyle = v < 0.5 ? rgba(c, 0.6, 0.7) : v < 0.8 ? rgba(c, 0.5, 1.25) : "rgba(30,24,26,0.5)"; g.fillRect(rnd() * w, rnd() * h, 1.4, 1.4); }
  for (let by = 0; by < 2; by++) {
    const oy = by * T;
    fillBoth(g, pc, rgb(band), MK_TRIM, 0, oy + T * 0.74, w, 5);
    g.fillStyle = "rgba(255,255,255,0.45)"; g.fillRect(0, oy + T * 0.74, w, 1);
    relief(pc, "#ffffff", 0, oy + T * 0.74, w, 5);
    g.fillStyle = rgb(c, 0.5); g.fillRect(0, oy + T * 0.9, w, 3);
    relief(pc, "#707070", 0, oy + T * 0.9, w, 3);
    g.fillStyle = rgb(band, 0.9); g.fillRect(0, oy + T * 0.06 - 3, w, 3);
  }
  if (!granite) shimmer(g, w, h, (x, y) => 1 + 0.08 * Math.sin(TAU * (x + y) / 256));
};

/**
 * The sawtooth wall (after the glass): each bay two panes set at an angle in
 * plan, one turned to the sky and bright, one turned away and dark, with the
 * slab edge folding with them and casting a triangle of shade below.
 */
const sawOver = (w0: Win, crease: number, litLeft: boolean, slab: RGB): Painter => (g, _w, h, _r, pc) => {
  for (const [bx, by] of CELLS) {
    const ox = bx * T, oy = by * T, r = winAt(w0, bx, by), cx = ox + crease * T;
    const lit = litLeft ? [ox, cx] : [cx, ox + T], dark = litLeft ? [cx, ox + T] : [ox, cx];
    let gr = g.createLinearGradient(0, oy, 0, oy + T);
    gr.addColorStop(0, "rgba(255,255,255,0.34)"); gr.addColorStop(1, "rgba(255,255,255,0.08)");
    g.fillStyle = gr; g.fillRect(lit[0], oy, lit[1] - lit[0], T);
    gr = g.createLinearGradient(0, oy, 0, oy + T);
    gr.addColorStop(0, "rgba(6,10,24,0.42)"); gr.addColorStop(1, "rgba(6,10,24,0.2)");
    g.fillStyle = gr; g.fillRect(dark[0], oy, dark[1] - dark[0], T);
    // the crease, a hairline of light; the valley at the bay line, dark
    g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(cx - 0.75, oy, 1.5, T);
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(ox, oy, 2, T);
    // the folded slab edge: lit on one face, in shade on the other
    const sy = r.y1, sh = oy + T - sy;
    fillBoth(g, pc, rgb(slab, 1.08), MK_ACC, lit[0], sy, lit[1] - lit[0], sh);
    fillBoth(g, pc, rgb(slab, 0.62), MK_ACC, dark[0], sy, dark[1] - dark[0], sh);
    relief(pc, "#ffffff", ox, sy, T, sh);
    // and the triangle of shade it throws on the glass below
    for (const dy of [0, -h]) {
      g.fillStyle = "rgba(0,0,0,0.26)"; g.beginPath();
      g.moveTo(ox, oy + T + dy); g.lineTo(cx, oy + T + 13 + dy); g.lineTo(ox + T, oy + T + dy); g.closePath(); g.fill();
    }
  }
};

/**
 * Horizontal sunshades (after the glass): extruded aluminium louvres run
 * across the head of every window on outriggers, each blade throwing a bar of
 * shade, and on some a deeper light shelf at transom height. The blades are
 * the accent.
 */
const sunOver = (w0: Win, blade: RGB, n: number, depth: number, wood = false, shelf = false): Painter => (g, _w, _h, rnd, pc) => {
  for (const [bx, by] of CELLS) {
    const ox = bx * T, r = winAt(w0, bx, by), top = r.y0 + 5, bot = r.y0 + (r.y1 - r.y0) * 0.5;
    const ys: number[] = [];
    for (let i = 0; i < n; i++) ys.push(top + ((bot - top) * i) / Math.max(1, n - 1));
    if (shelf) ys.push(r.y0 + (r.y1 - r.y0) * 0.66);
    // outriggers first, at the bay line
    fillBoth(g, pc, rgb(blade, 0.68), MK_ACC, ox + T - 3, top - 4, 5, ys[ys.length - 1] - top + 12);
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i], th = shelf && i === ys.length - 1 ? 7 : 4, d = shelf && i === ys.length - 1 ? depth * 1.6 : depth;
      const sg = g.createLinearGradient(0, y + th, 0, y + th + d);
      sg.addColorStop(0, "rgba(0,0,0,0.42)"); sg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sg; g.fillRect(ox, y + th, T, d);
      fillBoth(g, pc, rgb(blade), MK_ACC, ox, y, T, th);
      g.fillStyle = rgb(blade, 1.2); g.fillRect(ox, y, T, 1.2);
      g.fillStyle = rgb(blade, 0.72); g.fillRect(ox, y + th - 1, T, 1);
      if (wood) for (let k = 0; k < 10; k++) { g.fillStyle = `rgba(70,40,20,${0.15 + rnd() * 0.2})`; g.fillRect(ox + rnd() * T, y + 1, 6 + rnd() * 20, th - 2); }
      relief(pc, "#ffffff", ox, y, T, th);
    }
  }
};

/** 1960s strip glazing: opaque black spandrel glass between the windows, struck through with white bands at the sill and the slab (trim). */
const stripWall = (spand: RGB, band: RGB): Painter => (g, w, h, _rnd, pc) => {
  for (let by = 0; by < 2; by++) {
    const oy = by * T;
    const gr = g.createLinearGradient(0, oy, 0, oy + T);
    gr.addColorStop(0, rgb(spand, 1.35)); gr.addColorStop(0.55, rgb(spand, 1.0)); gr.addColorStop(1, rgb(spand, 0.75));
    g.fillStyle = gr; g.fillRect(0, oy, w, T);
    g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(0, oy + T * 0.62, w, 2);
    for (let x = 0; x < w; x += 32) { g.fillStyle = rgb(spand, 0.6); g.fillRect(x, oy + T * 0.5, 1, T * 0.5); }
    for (const [y, th] of [[oy + T * 0.5, 7], [oy + T - 9, 9]]) {
      fillBoth(g, pc, rgb(band), MK_TRIM, 0, y, w, th);
      g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(0, y, w, 1);
      g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, y + th - 1, w, 1);
      relief(pc, "#ffffff", 0, y, w, th);
    }
  }
  void h;
};


/**
 * Terra-cotta baguettes over glass (after the glass): ceramic rods on steel
 * outriggers a hand's breadth out, the eye-level band left clear — the
 * screen of the 2007 newspaper tower. The rods are the trim.
 */
const rodOver = (c: RGB, vertical: boolean, pitch: number, glaze = false): Painter => (g, w, h, rnd, pc) => {
  for (const [bx, by] of CELLS) {
    const ox = bx * T, oy = by * T;
    g.fillStyle = "rgba(56,60,64,0.95)"; g.fillRect(ox + 1, oy, 3, T); g.fillRect(ox + T / 2, oy, 2, T);
    if (vertical) continue;
    for (let y = oy + 3; y + 5 < oy + T; y += pitch) {
      if (y > oy + T * 0.34 && y < oy + T * 0.62) continue;
      const v = 0.92 + rnd() * 0.14;
      g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(ox, y + 5, T, 2.5);
      const gr = g.createLinearGradient(0, y, 0, y + 5);
      gr.addColorStop(0, rgb(c, v * (glaze ? 1.4 : 1.22))); gr.addColorStop(0.45, rgb(c, v)); gr.addColorStop(1, rgb(c, v * 0.6));
      fillBoth(g, pc, rgb(c, v), MK_TRIM, ox, y, T, 5);
      g.fillStyle = gr; g.fillRect(ox, y, T, 5);
      relief(pc, "#ffffff", ox, y, T, 5);
    }
  }
  if (vertical) for (let x = 2; x < w; x += pitch) {
    const v = 0.92 + rnd() * 0.14;
    g.fillStyle = "rgba(0,0,0,0.24)"; g.fillRect(x + 5, 0, 2.5, h);
    const gr = g.createLinearGradient(x, 0, x + 5, 0);
    gr.addColorStop(0, rgb(c, v * 1.22)); gr.addColorStop(0.45, rgb(c, v)); gr.addColorStop(1, rgb(c, v * 0.6));
    fillBoth(g, pc, rgb(c, v), MK_TRIM, x, 0, 5, h);
    g.fillStyle = gr; g.fillRect(x, 0, 5, h);
    relief(pc, "#ffffff", x, 0, 5, h);
  }
};

// ---------------------------------------------------------------------------
// THE CONTEMPORARY
// ---------------------------------------------------------------------------

/** Weathering steel: plate panels gone to a mottled rust, runs of rust-water under every sill. Never painted. */
const cortenWall = (base: RGB, age: number, plates: "panel" | "band"): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(base); g.fillRect(0, 0, w, h);
  const spots: RGB[] = [[base[0] * 1.18, base[1] * 1.1, base[2] * 0.9], [base[0] * 0.78, base[1] * 0.7, base[2] * 0.7], [92, 46, 32], [170, 92, 44]];
  for (let i = 0; i < 520; i++) {
    g.fillStyle = rgba(spots[(rnd() * spots.length) | 0], 0.12 + rnd() * 0.25);
    g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 9, 1.5 + rnd() * 6, rnd() * 3, 0, TAU); g.fill();
  }
  for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() < 0.6 ? "rgba(40,18,10,0.22)" : "rgba(220,140,70,0.18)"; g.fillRect(rnd() * w, rnd() * h, 1, 1); }
  // rust runs below the sills
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w, y = (rnd() < 0.5 ? 0 : T) + T * 0.86 + rnd() * 6, L = 10 + rnd() * 40;
    g.fillStyle = `rgba(96,40,18,${0.12 + rnd() * 0.18})`;
    g.fillRect(x, y % h, 1 + rnd() * 2.5, L); if (y + L > h) g.fillRect(x, y - h, 1 + rnd() * 2.5, L);
  }
  if (age > 0) { g.fillStyle = `rgba(42,20,14,${age * 0.4})`; g.fillRect(0, 0, w, h); }
  if (pc) { pc.hg.fillStyle = "#e6e6e6"; pc.hg.fillRect(0, 0, w, h); }
  // the plate joints, open and dark, a lit lip above
  const [pw, ph] = plates === "panel" ? [64, T / 3] : [T, 21];
  for (let y = 0, r = 0; y < h; y += ph, r++) {
    g.fillStyle = "rgba(20,10,6,0.75)"; g.fillRect(0, y, w, 1.5); g.fillStyle = "rgba(255,180,120,0.18)"; g.fillRect(0, y + 1.5, w, 1);
    relief(pc, "#606060", 0, y, w, 1.5);
    for (let x = plates === "band" ? (r % 2) * 64 : 0; x < w; x += pw) { g.fillStyle = "rgba(20,10,6,0.75)"; g.fillRect(x, y, 1.5, ph); relief(pc, "#606060", x, y, 1.5, ph); }
  }
};
/** A projecting box frame round each window (after the glass): timber, steel or the wall's own plate, throwing its shadow. */
const boxOver = (w0: Win, c: RGB, d: number, grain = false): Painter => (g, _w, _h, rnd, pc) => {
  for (const [bx, by] of CELLS) {
    const r = winAt(w0, bx, by), b = 6;
    g.fillStyle = "rgba(0,0,0,0.32)"; g.fillRect(r.x1 + b, r.y0 - b + d, d, r.y1 - r.y0 + 2 * b); g.fillRect(r.x0 - b + d, r.y1 + b, r.x1 - r.x0 + 2 * b, d);
    const gi = g.createLinearGradient(0, r.y0, 0, r.y0 + 14); gi.addColorStop(0, "rgba(0,0,0,0.45)"); gi.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gi; g.fillRect(r.x0, r.y0, r.x1 - r.x0, 14);
    for (const [x, y, ww, hh, v] of [[r.x0 - b, r.y0 - b, r.x1 - r.x0 + 2 * b, b, 1.1], [r.x0 - b, r.y1, r.x1 - r.x0 + 2 * b, b, 0.8], [r.x0 - b, r.y0, b, r.y1 - r.y0, 1.0], [r.x1, r.y0, b, r.y1 - r.y0, 0.88]] as [number, number, number, number, number][]) {
      fillBoth(g, pc, rgb(c, v), MK_TRIM, x, y, ww, hh);
      if (grain) for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(80,46,22,${0.1 + rnd() * 0.2})`; ww > hh ? g.fillRect(x + rnd() * ww, y + 1, 8 + rnd() * 18, 1) : g.fillRect(x + 1, y + rnd() * hh, 1, 8 + rnd() * 18); }
      relief(pc, "#ffffff", x, y, ww, hh);
    }
  }
};



/** Glazed ceramic tile: small glossy tiles in a mix of one colour's glazes, each with its own sheen. */
const tileWall = (cols: RGB[], tw: number, th: number, joint = "#d6d4ce", sparse = 0): Painter => (g, w, h, rnd) => {
  g.fillStyle = joint; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += th) for (let x = 0; x < w; x += tw) {
    const bias = 0.5 + 0.35 * Math.sin(TAU * y / 256);
    const c = sparse ? (rnd() < sparse ? cols[1 + ((rnd() * (cols.length - 1)) | 0)] : cols[0]) : cols[Math.min(cols.length - 1, ((rnd() * 0.7 + bias * 0.6) * cols.length * 0.77) | 0)];
    const v = 0.93 + rnd() * 0.12;
    g.fillStyle = rgb(c, v); g.fillRect(x + 1, y + 1, tw - 1.6, th - 1.6);
    g.fillStyle = "rgba(255,255,255,0.4)"; g.fillRect(x + 1, y + 1, tw - 2, 1);
    g.fillStyle = "rgba(0,0,0,0.14)"; g.fillRect(x + 1, y + th - 1.8, tw - 2, 1);
    g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(x + tw * 0.25, y + th * 0.3, 1.5, 1.5);
  }
};

/** A living wall: steel cables on a grey back-up wall, grown over with climbers, a planter box at every floor (accent). */
const greenWall = (leaf: RGB[], dens: number, back: RGB, planter: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(back); g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(50,52,54,0.55)";
  for (let x = 4; x < w; x += 16) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1);
  if (pc) { pc.hg.fillStyle = "#b0b0b0"; pc.hg.fillRect(0, 0, w, h); }
  for (let i = 0; i < dens * 1800; i++) {
    const x = rnd() * w, y = rnd() * h, r = 2.5 + rnd() * 5, c = leaf[(rnd() * leaf.length) | 0], v = 0.7 + rnd() * 0.5;
    g.fillStyle = rgba(c, 0.9, v); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.beginPath(); pc.hg.arc(x, y, r, 0, TAU); pc.hg.fill(); }
  }
  for (let i = 0; i < dens * 900; i++) { g.fillStyle = rgba(leaf[0], 0.6, 1.5); g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  for (let by = 0; by < 2; by++) {
    const y = by * T + T - 16;
    fillBoth(g, pc, rgb(planter), MK_ACC, 0, y, w, 16);
    g.fillStyle = rgb(planter, 1.25); g.fillRect(0, y, w, 2);
    g.fillStyle = rgb(planter, 0.7); g.fillRect(0, y + 14, w, 2);
    relief(pc, "#ffffff", 0, y, w, 16);
  }
};
/** What grows out of the planters (after the glass): shrubs over the sill, a small tree at the bay line, climbers trailing down. */
const plantsOver = (leaf: RGB[], trees: boolean, vines: boolean): Painter => (g, _w, h, rnd) => {
  for (const [bx, by] of CELLS) {
    const ox = bx * T, py = by * T + T - 16;
    for (let i = 0; i < 70; i++) {
      const x = ox + rnd() * T, y = py - rnd() * 14, r = 2.5 + rnd() * 4;
      g.fillStyle = rgba(leaf[(rnd() * leaf.length) | 0], 0.95, 0.7 + rnd() * 0.5); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    if (trees) {
      const tx = ox + T - 6;
      g.fillStyle = "rgba(70,50,36,0.95)"; g.fillRect(tx - 1.5, py - 30, 3, 30);
      for (let i = 0; i < 40; i++) { const a = rnd() * TAU, d = rnd() * 16; g.fillStyle = rgba(leaf[(rnd() * leaf.length) | 0], 0.9, 0.7 + rnd() * 0.5); g.beginPath(); g.arc(tx + Math.cos(a) * d, py - 42 + Math.sin(a) * d * 0.9, 3 + rnd() * 3, 0, TAU); g.fill(); }
    }
    if (vines) for (let k = 0; k < 5; k++) {
      let x = ox + rnd() * T;
      const L = 14 + rnd() * 30;
      for (let y = py + 16; y < py + 16 + L; y += 3) { x += rnd() * 2 - 1; g.fillStyle = rgba(leaf[(rnd() * leaf.length) | 0], 0.9, 0.8 + rnd() * 0.4); g.beginPath(); g.arc(x, y % h, 1.8 + rnd() * 1.4, 0, TAU); g.fill(); }
    }
  }
};

/** Shou sugi ban: charred boards, black with the alligator crazing of the burn and its silver sheen; brushed, the brown grain shows through. */
const charWall = (c: RGB, vertical: boolean, brushed: boolean): Painter => (g, w, h, rnd, pc) => {
  const R = (a: number, b: number, wa: number, hb: number) => (vertical ? g.fillRect(a, b, wa, hb) : g.fillRect(b, a, hb, wa));
  g.fillStyle = "#0c0b0a"; g.fillRect(0, 0, w, h);
  const L = vertical ? h : w;
  for (let a = 0; a < (vertical ? w : h); a += 9) {
    const v = 0.8 + rnd() * 0.4;
    g.fillStyle = rgb(c, v); R(a, 0, 8, L);
    if (brushed) for (let k = 0; k < 7; k++) { g.fillStyle = `rgba(122,70,38,${0.18 + rnd() * 0.3})`; R(a + rnd() * 7, rnd() * L, 1, 20 + rnd() * 60); }
    // the crazing: short cross-cracks, a lit edge on each scale
    for (let b = rnd() * 5; b < L; b += 3 + rnd() * 4) {
      g.fillStyle = "rgba(0,0,0,0.75)"; R(a + rnd() * 2, b, 4 + rnd() * 4, 1);
      g.fillStyle = brushed ? "rgba(170,120,80,0.16)" : "rgba(190,196,210,0.13)"; R(a, b + 1, 8, 1);
    }
    if (pc) { pc.hg.fillStyle = "#e0e0e0"; vertical ? pc.hg.fillRect(a, 0, 8, h) : pc.hg.fillRect(0, a, w, 8); }
  }
};

/** Fluted precast: concave flutes run the height of each floor, a plain band at the slab; the relief does the work. */
const flutedWall = (c: RGB, pitch: number): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let by = 0; by < 2; by++) {
    const oy = by * T, fh = T - 13;
    for (let x = 0; x < w; x++) {
      const t = (x % pitch) / pitch, s = Math.sin(Math.PI * t);
      g.fillStyle = rgb(c, 0.7 + 0.34 * s * (0.75 + 0.35 * t) + (t < 1 / pitch ? 0.22 : 0)); g.fillRect(x, oy, 1, fh);
      if (pc) { const k = (150 + 105 * (1 - s)) | 0; pc.hg.fillStyle = `rgb(${k},${k},${k})`; pc.hg.fillRect(x, oy, 1, fh); }
    }
    g.fillStyle = rgb(c, 1.06); g.fillRect(0, oy + fh, w, 13);
    g.fillStyle = rgb(c, 0.66); g.fillRect(0, oy + fh, w, 1.5);
    relief(pc, "#ffffff", 0, oy + fh, w, 13);
  }
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
};
/** A deep reveal (after the glass): the head and one jamb throw their shadow on the glass. */
const revealOver = (w0: Win, d: number): Painter => (g) => {
  for (const [bx, by] of CELLS) {
    const r = winAt(w0, bx, by);
    let gr = g.createLinearGradient(0, r.y0, 0, r.y0 + d); gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(r.x0, r.y0, r.x1 - r.x0, d);
    gr = g.createLinearGradient(r.x0, 0, r.x0 + d * 0.6, 0); gr.addColorStop(0, "rgba(0,0,0,0.45)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(r.x0, r.y0, d * 0.6, r.y1 - r.y0);
  }
};

/** Glass-fibre reinforced concrete, cast smooth with a faint pinhole skin. */
const gfrcWall = (c: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) { g.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)"; g.fillRect(rnd() * w, rnd() * h, 1.2, 1.2); }
};
/**
 * Parametric GFRC (after the glass): every bay's panel cast from one
 * script with its own numbers — the opening rounded, swollen, faceted or the
 * pier between drawn out into a curving fin — so no two bays quite match.
 */
const gfrcOver = (w0: Win, c: RGB, mode: 0 | 1 | 2 | 3): Painter => (g, _w, h, _r, pc) => {
  const vary = [0.1, 0.7, 0.4, 1.0];
  for (const [bx, by] of CELLS) {
    const ox = bx * T, oy = by * T, r = winAt(w0, bx, by), a = vary[bx + 2 * by];
    const x0 = r.x0 - 3, x1 = r.x1 + 3, y0 = r.y0 - 3, y1 = r.y1 + 3, my = (y0 + y1) / 2;
    if (mode === 2) {
      // a fin in the pier, curving through the floor
      const pc0 = ox + (w0.x1 + (1 - w0.x1 + w0.x0) / 2) * T;
      for (let y = oy; y < oy + T; y++) {
        const ph = TAU * (y - oy) / T + a * 2, cx = pc0 + 9 * Math.sin(ph), sl = Math.cos(ph);
        g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(cx + 7, y, 6, 1);
        g.fillStyle = rgb(c, 1.02 + 0.12 * sl); g.fillRect(cx - 8, y, 8, 1);
        g.fillStyle = rgb(c, 0.84 + 0.1 * sl); g.fillRect(cx, y, 8, 1);
        relief(pc, "#ffffff", cx - 8, y, 16, 1);
        if (cx + 8 > 2 * T) { g.fillStyle = rgb(c, 0.9); g.fillRect(cx - 8 - 2 * T, y, 16, 1); }
      }
      continue;
    }
    if (mode === 3) {
      // a faceted frame: four planes falling to a narrowed opening
      const ix0 = x0 + 6 + 8 * a, ix1 = x1 - 6 - 8 * (1 - a), iy0 = y0 + 8, iy1 = y1 - 4;
      const faces: [number[][], number][] = [
        [[[ox, oy], [ox + T, oy], [ix1, iy0], [ix0, iy0]], 1.12],
        [[[ox, oy], [ix0, iy0], [ix0, iy1], [ox, oy + T]], 1.0],
        [[[ox + T, oy], [ox + T, oy + T], [ix1, iy1], [ix1, iy0]], 0.82],
        [[[ox, oy + T], [ix0, iy1], [ix1, iy1], [ox + T, oy + T]], 0.72],
      ];
      for (const [pts, v] of faces) {
        g.fillStyle = rgb(c, v); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill();
      }
      if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(ox, oy, T, T); pc.hg.fillStyle = "#3a3a3a"; pc.hg.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0); }
      continue;
    }
    // the panel with its opening cut out: pillowed (0) or barrel-sided (1)
    const open = (gg: CanvasRenderingContext2D, grow: number, fresh = true) => {
      if (fresh) gg.beginPath();
      if (mode === 0) {
        const rr = Math.min((x1 - x0) / 2, (y1 - y0) / 2, 12 + 16 * a) + grow;
        gg.roundRect(x0 - grow, y0 - grow, x1 - x0 + 2 * grow, y1 - y0 + 2 * grow, rr);
      } else {
        const ins = 10 + 8 * a, b = -6 - 6 * a;
        gg.moveTo(x0 + ins - grow, y0 - grow); gg.lineTo(x1 - ins + grow, y0 - grow);
        gg.quadraticCurveTo(x1 - b + grow, my, x1 - ins + grow, y1 + grow); gg.lineTo(x0 + ins - grow, y1 + grow);
        gg.quadraticCurveTo(x0 + b - grow, my, x0 + ins - grow, y0 - grow); gg.closePath();
      }
    };
    g.save(); g.beginPath(); g.rect(ox, oy, T, T); open(g, 0, false); g.clip("evenodd");
    g.fillStyle = rgb(c); g.fillRect(ox, oy, T, T);
    // the cast lip round the opening: a shadow inside, a bright roll outside
    g.lineWidth = 10; g.strokeStyle = rgba([255, 255, 255], 0.22); open(g, 7); g.stroke();
    g.lineWidth = 3; g.strokeStyle = rgba([255, 255, 255], 0.5); open(g, 2); g.stroke();
    g.restore();
    g.save(); open(g, 0); g.clip();
    g.lineWidth = 12; g.strokeStyle = "rgba(0,0,0,0.42)"; open(g, 0); g.stroke();
    g.restore();
    if (pc) { pc.hg.save(); pc.hg.beginPath(); pc.hg.rect(ox, oy, T, T); open(pc.hg, 0, false); pc.hg.clip("evenodd"); pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(ox, oy, T, T); pc.hg.restore(); }
  }
  void h;
};

/** Channel glass: milky U-channels standing side by side, the slabs and a column or two looming through; polycarbonate, ribbed and amber. */
const channelWall = (c: RGB, pitch: number, poly: boolean): Painter => (g, w, h, rnd, pc) => {
  for (let by = 0; by < 2; by++) {
    const oy = by * T, gr = g.createLinearGradient(0, oy, 0, oy + T);
    gr.addColorStop(0, rgb(c, 1.06)); gr.addColorStop(1, rgb(c, 0.88));
    g.fillStyle = gr; g.fillRect(0, oy, w, T);
    // what stands behind: the slab, a column, a shelf of something
    let sg = g.createLinearGradient(0, oy + T - 20, 0, oy + T); sg.addColorStop(0, "rgba(40,44,48,0)"); sg.addColorStop(1, "rgba(40,44,48,0.3)");
    g.fillStyle = sg; g.fillRect(0, oy + T - 20, w, 20);
    sg = g.createLinearGradient(0, oy, 0, oy + 12); sg.addColorStop(0, "rgba(40,44,48,0.24)"); sg.addColorStop(1, "rgba(40,44,48,0)");
    g.fillStyle = sg; g.fillRect(0, oy, w, 12);
    for (let k = 0; k < 2; k++) { const x = rnd() * w; g.fillStyle = "rgba(50,54,58,0.09)"; g.fillRect(x, oy, 12, T); g.fillRect(x - 3, oy, 18, T); }
  }
  for (let x = 0; x < w; x += pitch) {
    g.fillStyle = "rgba(255,255,255,0.26)"; g.fillRect(x + pitch * 0.35, 0, 2, h);
    g.fillStyle = "rgba(0,0,0,0.14)"; g.fillRect(x, 0, 1, h);
    if (pc) { pc.hg.fillStyle = "#c8c8c8"; pc.hg.fillRect(x, 0, 1, h); }
  }
  if (poly) for (let y = 0; y < h; y += 3) { g.fillStyle = "rgba(255,255,255,0.07)"; g.fillRect(0, y, w, 1); }
  for (let by = 0; by < 2; by++) {
    fillBoth(g, pc, "#a8acae", MK_ACC, 0, by * T + T - 4, w, 4);
    g.fillStyle = "rgba(255,255,255,0.4)"; g.fillRect(0, by * T + T - 4, w, 1);
  }
};

/** Copper: flat-lock shingles (or standing seam), bright when new, browning, and in time streaked and then sheeted with verdigris. */
const copperWall = (c: RGB, patina: RGB | null, amt: number, seam: boolean): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.7); g.fillRect(0, 0, w, h);
  if (pc) { pc.hg.fillStyle = "#e0e0e0"; pc.hg.fillRect(0, 0, w, h); }
  if (seam) {
    for (let x = 0; x < w; x += 14) {
      const v = 0.9 + rnd() * 0.16, gr = g.createLinearGradient(x, 0, x + 12, 0);
      gr.addColorStop(0, rgb(c, v * 1.18)); gr.addColorStop(0.5, rgb(c, v)); gr.addColorStop(1, rgb(c, v * 0.86));
      g.fillStyle = gr; g.fillRect(x, 0, 12, h);
      g.fillStyle = rgb(c, 1.35); g.fillRect(x + 12, 0, 1, h); g.fillStyle = rgb(c, 0.55); g.fillRect(x + 13, 0, 1, h);
      relief(pc, "#ffffff", x + 12, 0, 2, h);
    }
  } else {
    // diamond flat-lock shingles, each lit from the upper left
    for (let y = -16, r = 0; y < h + 16; y += 16, r++) for (let x = (r % 2) * 16 - 32; x < w + 32; x += 32) {
      const v = 0.86 + rnd() * 0.24, gr = g.createLinearGradient(x - 16, y - 16, x + 16, y + 16);
      gr.addColorStop(0, rgb(c, v * 1.22)); gr.addColorStop(1, rgb(c, v * 0.82));
      g.fillStyle = gr; g.beginPath(); g.moveTo(x, y - 16); g.lineTo(x + 16, y); g.lineTo(x, y + 16); g.lineTo(x - 16, y); g.closePath(); g.fill();
      g.strokeStyle = rgb(c, 0.5); g.lineWidth = 1.2; g.stroke();
      g.strokeStyle = rgb(c, 1.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - 15, y); g.lineTo(x, y - 15); g.stroke();
      if (pc) { pc.hg.strokeStyle = "#a0a0a0"; pc.hg.lineWidth = 1.2; pc.hg.beginPath(); pc.hg.moveTo(x, y - 16); pc.hg.lineTo(x + 16, y); pc.hg.lineTo(x, y + 16); pc.hg.lineTo(x - 16, y); pc.hg.closePath(); pc.hg.stroke(); }
    }
  }
  if (patina) {
    for (let i = 0; i < 260 * amt; i++) { g.fillStyle = rgba(patina, 0.12 + rnd() * 0.4 * amt); g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 3 + rnd() * 12, 2 + rnd() * 6, 0, 0, TAU); g.fill(); }
    // the green runs down from every seam
    for (let i = 0; i < 160 * amt; i++) { const x = rnd() * w, y = seam ? rnd() * h : ((rnd() * 16) | 0) * 16 + 15, L = 6 + rnd() * 30; g.fillStyle = rgba(patina, 0.25 + rnd() * 0.35 * amt); g.fillRect(x, y, 1 + rnd() * 2.5, L); }
  }
};

// ---------------------------------------------------------------------------
// THE FAMILIES
// ---------------------------------------------------------------------------
const MULLION = ["#c4c8cc", "#3a3c3e", "#222324", "#5a4630", "#f1ede4", "#8c9298"];

const W_DS: Win = { x0: 0.02, x1: 0.98, y0: 0.13, y1: 0.99 };
const W_SAW: Win = { x0: 0.01, x1: 0.99, y0: 0.1, y1: 0.99 };
const W_SUN: Win = { x0: 0.03, x1: 0.97, y0: 0.12, y1: 0.99 };
const W_COR: Win = { x0: 0.32, x1: 0.68, y0: 0.14, y1: 0.86 };
const W_COR2: Win = { x0: 0.16, x1: 0.84, y0: 0.2, y1: 0.82 };
const W_CHAR: Win = { x0: 0.26, x1: 0.74, y0: 0.22, y1: 0.84 };
const W_FLUTE: Win = { x0: 0.28, x1: 0.72, y0: 0.16, y1: 0.86 };
const W_FLUTE2: Win = { x0: 0.24, x1: 0.76, y0: 0.16, y1: 0.86 };
const W_GF: Win = { x0: 0.2, x1: 0.8, y0: 0.18, y1: 0.84 };
const W_GF2: Win = { x0: 0.14, x1: 0.7, y0: 0.14, y1: 0.86 };

export const BOOK_GLASS: BookEntry[] = [
  // DOUBLE-SKIN GLASS, 2000-today: a second sheet of glass hung a metre in
  // front of the first, the cavity between ventilated and walked by catwalks
  // at every floor — the European office tower, then the American headquarters.
  {
    key: "doubleskin", like: "glass",
    spec: { bayW: 1.5, floorH: 4.0, masonry: false, glass: true, win: W_DS, wall: dsWall([30, 40, 48]), over: dsOver([214, 230, 236], 0.16, [168, 174, 178]),
      glassCol: "#6c8a9c", frameCol: "#3a444a", wallRough: 0.3, glassRough: 0.04, glassMetal: 0.8, mullions: [2, 1], reveal: 1.4 },
    variants: [
      { over: dsOver([180, 222, 208], 0.22, [150, 158, 156]), glassCol: "#5f8a86", wall: dsWall([26, 42, 40]) },
      { over: dsOver([236, 238, 236], 0.14, [200, 204, 206], true), glassCol: "#7896a6" },
      { over: dsOver([200, 190, 170], 0.14, [92, 72, 50]), glassCol: "#5a6670", wall: dsWall([34, 30, 26]), frameCol: "#2a2420" },
    ],
    tints: [[1, 1, 1], [0.94, 0.97, 1.02], [1.03, 1.0, 0.96]],
    palette: P(0.12, ["#1e2830", "#26323a", "#2a2a2a"], 0, [], 0.5, ["#c4c8cc", "#8c9298", "#3a3c3e", "#f1ede4"]),
    style: "futurist",
    picker: { group: "glass", name: "Double-skin glass", era: "2000-today", maxFloors: 99, variants: ["Clear, steel catwalks", "Green-edged skin", "Fritted skin", "Bronze catwalks"] },
    city: [{ share: 0.12, from: 2000, minH: 50, cls: ["office"] }],
  },
  // GOLD REFLECTIVE GLASS, 1975-1992: a film of real gold in the glass, the
  // bank tower of the oil-boom downtown blazing yellow at sunset.
  {
    key: "goldglass", like: "bronze",
    spec: { bayW: 1.5, floorH: 3.8, masonry: false, glass: true, win: { x0: 0.05, x1: 0.95, y0: 0.24, y1: 0.97 }, wall: goldWall([150, 112, 44]), over: goldOver(0.45),
      glassCol: "#d2a850", frameCol: "#8a6a30", wallRough: 0.25, glassRough: 0.03, glassMetal: 0.95, mullions: [1, 2], reveal: 1.2 },
    variants: [
      { wall: goldWall([176, 150, 96]), glassCol: "#dcc48e", frameCol: "#a89070" },
      { wall: goldWall([140, 84, 40]), glassCol: "#c8823e", frameCol: "#6a4224", over: goldOver(0.35) },
      { wall: goldWall([132, 100, 40]), glassCol: "#c8a048", frameCol: "#1e1c1a", mullions: [2, 2] },
    ],
    tints: [[1, 1, 1], [1.04, 1.0, 0.92], [0.94, 0.92, 0.9]],
    palette: P(0, [], 0, [], 0.35, ["#5a4630", "#8a6a30", "#222324"]),
    picker: { group: "glass", name: "Gold glass", era: "1975-1992", maxFloors: 99, variants: ["Gold", "Champagne gold", "Amber", "Gold, black mullions"] },
    city: [{ share: 0.16, from: 1975, to: 1992, minH: 30, cls: ["office"] }],
  },
  // ROSE REFLECTIVE GLASS, 1984-1996: the pink and mauve mirror of the
  // Sunbelt boom, banded with bright aluminium and often granite to match.
  {
    key: "roseglass", like: "silverglass",
    spec: { bayW: 1.6, floorH: 3.9, masonry: false, glass: true, win: { x0: 0.04, x1: 0.96, y0: 0.26, y1: 0.94 }, wall: roseWall([120, 84, 90], [214, 210, 212]),
      glassCol: "#caa0a2", frameCol: "#d6cccc", wallRough: 0.3, glassRough: 0.04, glassMetal: 0.92, mullions: [1, 1], reveal: 1.6 },
    variants: [
      { wall: roseWall([104, 84, 108], [206, 206, 214]), glassCol: "#b8a0bc", frameCol: "#cfcad6" },
      { wall: roseWall([140, 86, 70], [214, 196, 170]), glassCol: "#d4a08a", frameCol: "#c8b49c" },
      { wall: roseWall([176, 128, 122], [232, 224, 214], true), glassCol: "#b88c90", frameCol: "#5a4448", mullions: [2, 1] },
    ],
    tints: [[1, 1, 1], [1.03, 0.98, 0.98], [0.96, 0.96, 1.0]],
    palette: P(0.1, ["#6a4a4e", "#7a5a5a", "#6a5262"], 0.35, ["#c4c8cc", "#f1ede4", "#d8c8c4"], 0.4, ["#c4c8cc", "#8a6a6a", "#3a3c3e"]),
    picker: { group: "glass", name: "Rose glass", era: "1984-1996", maxFloors: 80, variants: ["Rose", "Mauve", "Salmon", "Rose and granite"] },
    city: [{ share: 0.12, from: 1984, to: 1996, minH: 30, maxH: 300, cls: ["office", "multifamily"] }],
  },
  // SAWTOOTH GLASS, 2008-today: every bay folded in plan, one pane turned
  // to the view and one to the sun, so the tower reads as a column of light
  // and dark stripes and its slab edges zigzag.
  {
    key: "sawtooth", like: "pixel",
    spec: { bayW: 1.8, floorH: 4.0, masonry: false, glass: true, win: W_SAW, wall: tintedGlassFlat([44, 58, 70]), over: sawOver(W_SAW, 0.6, true, [206, 210, 212]),
      glassCol: "#7c9cb2", frameCol: "#8a949c", wallRough: 0.3, glassRough: 0.04, glassMetal: 0.88, reveal: 1.6 },
    variants: [
      { over: sawOver(W_SAW, 0.5, true, [224, 226, 226]), glassCol: "#b0bcc6", wall: tintedGlassFlat([80, 88, 96]) },
      { over: sawOver(W_SAW, 0.62, false, [180, 186, 184]), glassCol: "#6aa094", wall: tintedGlassFlat([36, 60, 56]) },
      { over: sawOver(W_SAW, 0.4, false, [90, 76, 62]), glassCol: "#8e7a64", wall: tintedGlassFlat([50, 40, 32]), frameCol: "#4a3a2a" },
    ],
    tints: [[1, 1, 1], [0.96, 0.98, 1.02]],
    palette: P(0.1, ["#2c3a46", "#3a4650"], 0, [], 0.5, MULLION),
    picker: { group: "glass", name: "Sawtooth glass", era: "2008-today", maxFloors: 99, variants: ["Blue, white slabs", "Silver", "Green, reversed", "Bronze, reversed"] },
    city: [{ share: 0.15, from: 2008, minH: 30 }],
  },
  // HORIZONTAL SUNSHADES, 2005-today: extruded aluminium louvres on
  // outriggers across the head of the glass, the south face of the green-
  // rated office; in timber-look and white on the later ones.
  {
    key: "sunshade", like: "fins",
    spec: { bayW: 1.5, floorH: 3.9, masonry: false, glass: true, win: W_SUN, wall: dsWall([46, 54, 60]), over: sunOver(W_SUN, [196, 200, 204], 4, 7),
      glassCol: "#5c7c90", frameCol: "#9aa2a8", wallRough: 0.4, glassRough: 0.05, glassMetal: 0.8, mullions: [1, 2], reveal: 2.0 },
    variants: [
      { over: sunOver(W_SUN, [238, 238, 234], 5, 9), glassCol: "#6e90a4", frameCol: "#e6e6e2" },
      { over: sunOver(W_SUN, [176, 124, 78], 4, 8, true), glassCol: "#5a7078", frameCol: "#3a3430" },
      { over: sunOver(W_SUN, [74, 64, 54], 3, 12, false, true), glassCol: "#6a8494", frameCol: "#2a2622", wall: dsWall([30, 30, 30]) },
    ],
    tints: [[1, 1, 1], [0.95, 0.96, 0.98], [1.02, 1.0, 0.96]],
    palette: P(0.15, ["#2e3236", "#46505a", "#3a3c3e"], 0, [], 0.55, ["#c4c8cc", "#f1ede4", "#3a3c3e", "#5a4630", "#b08a5a", "#8c9298"]),
    picker: { group: "glass", name: "Sunshade louvres", era: "2005-today", maxFloors: 99, variants: ["Aluminium louvres", "White blades", "Timber-look blades", "Bronze, light shelf"] },
    city: [{ share: 0.14, from: 2005 }],
  },
  // STRIP GLAZING, 1958-1980: the black-glass and white-band office slab of
  // the sixties — opaque spandrel glass between bright stripes at sill and
  // slab, the windows a run of narrow aluminium-mullioned lights.
  {
    key: "stripglass", like: "ribbon",
    spec: { bayW: 1.6, floorH: 3.7, masonry: false, glass: false, win: { x0: 0, x1: 1, y0: 0.5, y1: 0.9 }, wall: stripWall([22, 24, 28], [236, 236, 230]),
      glassCol: "#4a5c66", frameCol: "#c8ccd0", wallRough: 0.3, glassRough: 0.05, glassMetal: 0.6, mullions: [4, 1], reveal: 1.4 },
    variants: [
      { wall: stripWall([228, 228, 222], [28, 28, 30]), glassCol: "#2e3a42", frameCol: "#2a2c2e" },
      { wall: stripWall([56, 60, 64], [184, 188, 192]), glassCol: "#3e4a52", frameCol: "#9aa0a6" },
      { wall: stripWall([30, 40, 70], [232, 230, 222]), glassCol: "#405668", frameCol: "#e2e2dc" },
    ],
    tints: [[1, 1, 1], [0.96, 0.96, 0.98]],
    palette: P(0.15, ["#1a1c1e", "#22303a", "#e8e6e0"], 0.4, ["#f1ede4", "#c4c8cc", "#3a3c3e"], 0.4, ["#c4c8cc", "#3a3c3e", "#222324"]),
    picker: { group: "glass", name: "Strip glazing", era: "1958-1980", maxFloors: 40, variants: ["Black, white bands", "White, black bands", "Charcoal and aluminium", "Navy and white"] },
    city: [{ share: 0.18, from: 1958, to: 1980, maxH: 150 }],
  },
  // TERRA-COTTA BAGUETTES OVER GLASS, 2010-today: ceramic rods on steel
  // outriggers a hand's breadth in front of a glass wall, the eye-level band
  // left clear — the screen of the 2007 newspaper tower and its followers.
  {
    key: "baguetteglass", like: "fins",
    spec: { bayW: 1.5, floorH: 3.9, masonry: false, glass: true, win: { x0: 0.02, x1: 0.98, y0: 0.06, y1: 0.99 }, wall: dsWall([50, 54, 56]), over: rodOver([196, 110, 74], false, 9),
      glassCol: "#6a8696", frameCol: "#4a4e52", wallRough: 0.5, glassRough: 0.05, glassMetal: 0.7, reveal: 2.6 },
    variants: [
      { over: rodOver([232, 228, 216], false, 9, true), glassCol: "#7a96a4" },
      { over: rodOver([212, 176, 128], true, 11), glassCol: "#647c88" },
      { over: rodOver([140, 156, 148], false, 7, true), glassCol: "#5e7680", frameCol: "#2a2e30" },
    ],
    tints: [[1, 1, 1], [0.96, 0.94, 0.92], [1.03, 1.0, 0.96]],
    palette: P(0.1, ["#2e3236", "#3a3c3e"], 0.3, ["#b8664a", "#d8c8a8", "#e8e4dc", "#9a9a92", "#c27a52"], 0.35, ["#c4c8cc", "#3a3c3e", "#222324"]),
    style: "contemporary",
    picker: { group: "glass", name: "Baguettes over glass", era: "2010-today", maxFloors: 60, variants: ["Terra cotta", "White ceramic", "Buff, vertical", "Glazed grey-green"] },
    city: [{ share: 0.1, from: 2010, maxH: 230 }],
  },

  // WEATHERING STEEL, 2005-today: Cor-ten plate left to rust to a stable
  // brown skin — the museum annex, the arts centre, the restaurant row.
  {
    key: "corten", like: "metalpanel",
    spec: { bayW: 3.2, floorH: 3.6, masonry: false, glass: false, win: W_COR, wall: cortenWall([150, 72, 36], 0, "panel"),
      glassCol: "#3a4a52", frameCol: "#2a2420", wallRough: 0.92, glassRough: 0.05, glassMetal: 0.5, mullions: [1, 1], reveal: 3.0 },
    variants: [
      { wall: cortenWall([120, 58, 34], 0.5, "band") },
      { wall: cortenWall([170, 84, 38], 0, "band"), win: W_COR2, mullions: [2, 1] },
      { wall: cortenWall([140, 66, 36], 0.25, "panel"), win: W_COR, over: boxOver(W_COR, [178, 132, 86], 4, true) },
    ],
    tints: [[1, 1, 1], [0.94, 0.9, 0.88], [1.04, 1.0, 0.96]],
    palette: null,
    picker: { group: "new", name: "Weathering steel", era: "2005-today", maxFloors: 12, variants: ["Fresh rust", "Aged, plate bands", "Orange, wide windows", "Timber window boxes"] },
    city: [{ share: 0.1, from: 2005, maxH: 45, cls: ["office", "retail", "multifamily", "industrial"] }],
  },
  // GLAZED CERAMIC TILE, 2010-today: a rainscreen of small glossy tiles in a
  // mix of one colour's glazes — the teal hospital, the cobalt school, the
  // yellow housing block.
  {
    key: "ceramictile", like: "rainscreen",
    spec: { bayW: 3.0, floorH: 3.5, masonry: false, glass: false, win: { x0: 0.18, x1: 0.82, y0: 0.24, y1: 0.8 },
      wall: tileWall([[40, 120, 112], [70, 150, 130], [30, 92, 96], [110, 176, 150]], 16, 16),
      glassCol: "#3e5664", frameCol: "#e8e8e4", wallRough: 0.22, glassRough: 0.05, glassMetal: 0.45, mullions: [2, 1], reveal: 1.6 },
    variants: [
      { wall: tileWall([[236, 186, 50], [230, 140, 40], [244, 214, 100], [214, 110, 40]], 16, 16), frameCol: "#3a3c3e" },
    ],
    tints: [[1, 1, 1], [0.96, 0.98, 1.0], [1.02, 1.0, 0.97]],
    palette: P(0, [], 0, [], 0.45, ["#f1ede4", "#3a3c3e", "#222324", "#c4c8cc"]),
    picker: { group: "new", name: "Glazed tile", era: "2010-today", maxFloors: 30, variants: ["Teal mix", "Saffron"] },
    city: [{ share: 0.14, from: 2010, maxH: 112 }],
  },
  // THE LIVING FACADE, 2012-today: climbers on stainless cables and a
  // planter at every floor — the green-certified office, the "vertical
  // forest" apartment house.
  {
    key: "greenwall", like: "timber",
    spec: { bayW: 3.2, floorH: 3.6, masonry: false, glass: false, win: { x0: 0.2, x1: 0.8, y0: 0.16, y1: 0.82 },
      wall: greenWall([[52, 100, 46], [70, 124, 52], [36, 80, 40], [100, 140, 60]], 1, [140, 142, 138], [96, 98, 96]), over: plantsOver([[52, 100, 46], [80, 132, 56], [36, 80, 40]], false, true),
      glassCol: "#3e5260", frameCol: "#2a2a2a", wallRough: 0.9, glassRough: 0.05, glassMetal: 0.4, mullions: [2, 1], reveal: 3.2 },
    variants: [
      { wall: greenWall([[80, 136, 60], [110, 160, 70]], 0.3, [196, 196, 190], [70, 72, 74]), over: plantsOver([[80, 136, 60], [110, 160, 70]], false, false) },
      { wall: greenWall([[60, 110, 50]], 0, [228, 226, 218], [208, 206, 198]), over: plantsOver([[46, 96, 44], [70, 124, 52], [100, 150, 64]], true, true), frameCol: "#4a4e52" },
    ],
    tints: [[1, 1, 1], [0.94, 0.98, 0.94], [1.02, 1.02, 0.96]],
    palette: P(0, [], 0, [], 0.45, ["#3a3c3e", "#94502e", "#b8b4aa", "#222324"]),
    picker: { group: "new", name: "Living green wall", era: "2012-today", maxFloors: 30, variants: ["Lush", "Young, cables showing", "Planted balconies"] },
    city: [{ share: 0.15, from: 2016, maxH: 112 }, { parent: "metalpanel", share: 0.04, from: 2012, maxH: 112, cls: ["office", "multifamily"] }],
  },
  // CHARRED TIMBER, 2015-today: shou sugi ban — boards scorched black, the
  // crazed char sealing them — on the townhouse, the cafe and the small
  // gallery; brushed, the brown grain shows through.
  {
    key: "charredwood", like: "timber",
    spec: { bayW: 2.8, floorH: 3.2, masonry: false, glass: false, win: W_CHAR, wall: charWall([34, 32, 30], true, false),
      glassCol: "#3e5260", frameCol: "#141414", wallRough: 0.85, glassRough: 0.05, glassMetal: 0.4, mullions: [1, 1], reveal: 2.2 },
    variants: [
      { wall: charWall([30, 30, 32], false, false) },
      { wall: charWall([52, 40, 32], true, true), frameCol: "#2a2622" },
      { wall: charWall([28, 28, 28], true, false), over: boxOver(W_CHAR, [196, 150, 100], 4, true) },
    ],
    tints: [[1, 1, 1], [0.92, 0.92, 0.94]],
    palette: P(0, [], 0, [], 0.35, ["#222324", "#5a4630", "#c8b694"]),
    picker: { group: "new", name: "Charred timber", era: "2015-today", maxFloors: 8, variants: ["Black, upright", "Black, lapped", "Brushed, grain showing", "Cedar window boxes"] },
    city: [{ share: 0.12, from: 2016, maxH: 30, cls: ["multifamily", "retail", "office"] }],
  },
  // FLUTED PRECAST, 2015-today: the new apartment tower's answer to
  // limestone — concave flutes cast the height of each floor, windows set
  // deep, the flutes catching the low sun.
  {
    key: "fluted", like: "newstone",
    spec: { bayW: 3.0, floorH: 3.6, masonry: true, glass: false, win: W_FLUTE, wall: flutedWall([226, 220, 206], 9), over: revealOver(W_FLUTE, 16),
      glassCol: "#3a4c58", frameCol: "#2e3236", wallRough: 0.7, glassRough: 0.05, glassMetal: 0.4, mullions: [1, 2], reveal: 4.6 },
    variants: [
      { wall: flutedWall([212, 190, 158], 9), winStyle: "arch", over: revealOver(W_FLUTE, 14), frameCol: "#3a3026" },
      { wall: flutedWall([170, 170, 166], 15), win: W_FLUTE2, over: revealOver(W_FLUTE2, 16), frameCol: "#1e1e1e" },
      { wall: flutedWall([206, 160, 136], 9), over: revealOver(W_FLUTE, 16), frameCol: "#4a3a30" },
    ],
    tints: [[1, 1, 1], [0.97, 0.95, 0.92], [1.02, 1.0, 0.97]],
    palette: P(0.05, ["#f1ede4", "#e2d6c4"], 0, [], 0.6, ["#3a3c3e", "#5a4630", "#222324", "#3a4a44"]),
    style: "contemporary",
    picker: { group: "new", name: "Fluted precast", era: "2015-today", maxFloors: 40, variants: ["Pale, square-headed", "Sand, arched", "Grey, wide flutes", "Terracotta"] },
    city: [{ share: 0.16, from: 2015, maxH: 150 }],
  },
  // PARAMETRIC GFRC, 2012-today: glass-fibre concrete cast to a script, each
  // bay's opening its own size and swell, or the piers drawn out into
  // curving fins — the computer-designed condo and the cultural centre.
  {
    key: "gfrc", like: "metalpanel",
    spec: { bayW: 3.2, floorH: 3.8, masonry: false, glass: false, win: W_GF, wall: gfrcWall([232, 230, 224]), over: gfrcOver(W_GF, [234, 232, 226], 0),
      glassCol: "#3c5462", frameCol: "#2a2e30", wallRough: 0.6, glassRough: 0.05, glassMetal: 0.5, reveal: 3.2 },
    variants: [
      { wall: gfrcWall([214, 202, 180]), over: gfrcOver(W_GF, [216, 204, 182], 1) },
      { wall: gfrcWall([150, 152, 152]), win: W_GF2, over: gfrcOver(W_GF2, [196, 196, 192], 2), glassCol: "#46606e" },
      { wall: gfrcWall([236, 236, 232]), over: gfrcOver(W_GF, [236, 236, 232], 3), frameCol: "#3a3c3e" },
    ],
    tints: [[1, 1, 1], [0.97, 0.96, 0.94]],
    palette: P(0, [], 0, [], 0.4, ["#3a3c3e", "#222324", "#5a4630"]),
    style: "futurist",
    picker: { group: "new", name: "Parametric GFRC", era: "2012-today", maxFloors: 30, variants: ["White, rounded", "Sand, barrel-sided", "Grey, wave fins", "White, faceted"] },
    city: [{ share: 0.07, from: 2012, maxH: 112, cls: ["office", "retail", "multifamily"] }],
  },
  // CHANNEL GLASS AND POLYCARBONATE, 2005-today: U-channel glass standing in
  // a frame, milky and glowing, a strip of clear glass to see out of — the
  // art school, the studio, the shed made precious.
  {
    key: "channelglass", like: "metalpanel",
    spec: { bayW: 3.0, floorH: 3.8, masonry: false, glass: false, win: { x0: 0.04, x1: 0.96, y0: 0.34, y1: 0.62 }, wall: channelWall([214, 222, 222], 8, false),
      glassCol: "#3e5260", frameCol: "#8a9094", wallRough: 0.35, glassRough: 0.04, glassMetal: 0.5, mullions: [3, 1], reveal: 1.2 },
    variants: [
      { wall: channelWall([170, 206, 200], 8, false), frameCol: "#5a6a68" },
      { wall: channelWall([226, 200, 140], 10, true), frameCol: "#3a3c3e", glassCol: "#46525a" },
      { wall: channelWall([222, 226, 228], 6, false), win: { x0: 0.08, x1: 0.92, y0: 0.18, y1: 0.7 }, mullions: [2, 1], frameCol: "#2a2c2e" },
    ],
    tints: [[1, 1, 1], [0.98, 1.0, 1.0]],
    palette: P(0, [], 0, [], 0.4, ["#c4c8cc", "#3a3c3e", "#222324"]),
    picker: { group: "new", name: "Channel glass", era: "2005-today", maxFloors: 8, variants: ["Milky white", "Sea-green edge", "Amber polycarbonate", "Frosted, wide vision"] },
    city: [{ share: 0.07, from: 2005, maxH: 30, cls: ["retail", "office", "industrial"] }],
  },
  // COPPER CLADDING, 2000-today: flat-lock shingles or standing seam, bright
  // as a new penny, browning in a year and greening in twenty — the library,
  // the concert hall, the boutique hotel.
  {
    key: "copperclad", like: "metalpanel",
    spec: { bayW: 3.2, floorH: 3.6, masonry: false, glass: false, win: { x0: 0.22, x1: 0.78, y0: 0.16, y1: 0.86 }, wall: copperWall([206, 120, 70], null, 0, false),
      glassCol: "#3e5260", frameCol: "#2a2420", wallRough: 0.38, glassRough: 0.05, glassMetal: 0.5, mullions: [1, 1], reveal: 2.2, winJitter: 0.12 },
    variants: [
      { wall: copperWall([128, 74, 50], [70, 50, 40], 0.6, false) },
      { wall: copperWall([92, 150, 132], [130, 190, 168], 0.8, true), frameCol: "#2a2e2c" },
    ],
    tints: [[1, 1, 1], [0.95, 0.94, 0.94]],
    palette: null,
    picker: { group: "new", name: "Copper", era: "2000-today", maxFloors: 20, variants: ["New copper", "Statuary brown", "Verdigris seam"] },
    city: [{ share: 0.08, from: 2003, maxH: 75 }],
  },
];

/** A plain tinted spandrel (the sawtooth and dichroic walls carry their colour in the over). */
function tintedGlassFlat(c: RGB): Painter {
  return (g, w, h) => {
    for (let by = 0; by < 2; by++) {
      const gr = g.createLinearGradient(0, by * T, 0, by * T + T); gr.addColorStop(0, rgb(c, 1.1)); gr.addColorStop(1, rgb(c, 0.85));
      g.fillStyle = gr; g.fillRect(0, by * T, w, T);
    }
    void h;
  };
}
