/**
 * THE PATTERN BOOK — every elevation the city can wear, and who wears which.
 *
 * A family is one bay by one floor of a real elevation, painted on a canvas by
 * a wall painter and dressed with windows by RealCity.buildFamily. This file
 * holds the painters, the families and their elevations (VARIANTS), the paint
 * schemes a building is turned out in (liveryFor), the period/district rules
 * that decide what a building is made of (familyFor), and what its roof is
 * made of (roofTone). It imports nothing from three.js. Looks only: nothing
 * here is read by the engine.
 */

export const TILE = 128;
/** The families a tower can wear above its lobby. */
export const TOWER_FAMS = new Set(["glass", "blueglass", "bronze", "ribbon", "grid", "blackglass", "greenglass", "silverglass", "fins", "precast", "pomo", "modern"]);

export interface FamilySpec {
  key: string; bayW: number; floorH: number; masonry: boolean; glass: boolean;
  // window rectangle within the tile, as fractions
  win: { x0: number; x1: number; y0: number; y1: number };
  wall: (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;
  glassCol: string; frameCol: string;
  wallRough: number; glassRough: number; glassMetal: number;
  trim?: string;     // painted lintel + sill colour
  mullions?: [number, number]; // vertical, horizontal glazing bars per window
  reveal: number;    // normal-map relief strength
  noWin?: boolean;   // a blank wall: monuments, sheds, hulls
  // the window's shape and dressing — what separates an Italianate walk-up
  // from a Federal row house from a 1950s slab at a glance
  winStyle?: "rect" | "arch" | "segment" | "pair";
  lintel?: "flat" | "pediment" | "none";
  shutter?: string;  // painted shutters either side
}

/**
 * NO TWO WINDOWS ALIKE. The facade texture repeats every two bays and two
 * floors, so a wall was the same four windows tiled. Each pane (marked in
 * the ORM map's red channel) now draws its own state from a hash of its cell:
 * under a third with a blind down to some height, a sixth with curtains
 * drawn to the sides, the rest bare glass a little lighter or darker and a
 * little rougher or smoother — what any street elevation looks like.
 */

export function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) * k, g = ((v >> 8) & 255) * k, b = (v & 255) * k;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export const brickWall = (base: [number, number, number]) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#b8ab98"; g.fillRect(0, 0, w, h);
  const bw = 16, bh = 6;
  for (let y = 0, r = 0; y < h; y += bh, r++) for (let x = -((r % 2) * bw) / 2; x < w; x += bw) {
    const v = 0.84 + rnd() * 0.26;
    g.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
    g.fillRect(x + 1, y + 1, bw - 1.5, bh - 1.5);
  }
};
export const stoneWallC = (c: [number, number, number], course = 21) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = `rgb(${c[0] * 0.9 | 0},${c[1] * 0.9 | 0},${c[2] * 0.87 | 0})`; g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += course, r++) for (let x = (r % 2) * 32; x < w; x += 64) {
    const v = 0.94 + rnd() * 0.09;
    g.fillStyle = `rgb(${c[0] * v | 0},${c[1] * v | 0},${c[2] * v | 0})`; g.fillRect(x + 1, y + 1, 62, course - 2);
  }
};
export const stoneWall = stoneWallC([196, 186, 166]);
export const panelWall = (base: string) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 1.5;
  for (let y = 0; y < h; y += TILE / 2) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`; g.fillRect(rnd() * w, rnd() * h, 3, 3); }
};
// brownstone: dressed sandstone courses, chocolate-red
export const brownWallC = (c: [number, number, number]) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = `rgb(${c[0] * 0.73 | 0},${c[1] * 0.75 | 0},${c[2] * 0.76 | 0})`; g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += 16, r++) for (let x = (r % 2) * 24; x < w; x += 48) {
    const v = 0.9 + rnd() * 0.16;
    g.fillStyle = `rgb(${c[0] * v | 0},${c[1] * v | 0},${c[2] * v | 0})`; g.fillRect(x + 1, y + 1, 46, 14);
  }
};
export const brownWall = brownWallC([128, 88, 68]);
// art deco: pale limestone with continuous piers rising between the windows
// and dark spandrel panels under them — the vertical read of the 1930s tower
export const decoWallC = (face: string, recess: string, pier: string) => (g: CanvasRenderingContext2D, w: number, h: number) => {
  g.fillStyle = face; g.fillRect(0, 0, w, h);
  for (let bx = 0; bx < 2; bx++) {
    const ox = bx * TILE;
    g.fillStyle = recess; g.fillRect(ox + TILE * 0.30, 0, TILE * 0.40, h);           // the recessed bay
    g.fillStyle = pier; g.fillRect(ox, 0, TILE * 0.10, h); g.fillRect(ox + TILE * 0.9, 0, TILE * 0.1, h);   // pier faces
  }
};
export const decoWall = decoWallC("#cbbfa7", "#4c4a46", "#ddd2bb");
// a shopfront storey: painted fascia and an awning band over each display window
export const AWN = ["#7a2f2a", "#2f4f3e", "#2c3d5a", "#8a6a2c", "#5a2f4a", "#3b3b3b"];
export const shopWall = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#4a3f36"; g.fillRect(0, 0, w, h);
  for (let bx = 0; bx < 2; bx++) for (let by = 0; by < 2; by++) {
    const ox = bx * TILE, oy = by * TILE;
    g.fillStyle = AWN[(rnd() * AWN.length) | 0];
    g.fillRect(ox + 4, oy + TILE * 0.18, TILE - 8, TILE * 0.13);          // awning
    g.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 8; i++) g.fillRect(ox + 4 + i * (TILE - 8) / 8, oy + TILE * 0.18, (TILE - 8) / 16, TILE * 0.13);
  }
};
export const glassWall = (g: CanvasRenderingContext2D, w: number, h: number) => {
  // a curtain wall's "wall" is its spandrel band and its mullions
  g.fillStyle = "#3d4a52"; g.fillRect(0, 0, w, h);
};

// painted clapboard: lapped horizontal boards, each casting a hairline shadow
export const clapWallC = (board: number) => (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => {
  g.fillStyle = "#ece8de"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += board) {
    const v = 0.97 + rnd() * 0.05;
    g.fillStyle = `rgb(${236 * v | 0},${232 * v | 0},${222 * v | 0})`; g.fillRect(0, y + 1.5, w, board - 1.5);
    g.fillStyle = "rgba(60,55,45,0.28)"; g.fillRect(0, y, w, 1.5);
  }
  // corner boards at the tile edges
  g.fillStyle = "#f6f4ee"; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
};
export const clapWall = clapWallC(7);
// a curtain wall's spandrel in another glass: bronze, or the blue-green of the 1990s
export const tintedGlassWall = (col: string) => (g: CanvasRenderingContext2D, w: number, h: number) => { g.fillStyle = col; g.fillRect(0, 0, w, h); };

/** The base elevation of every family, in the order their seeds are drawn. */
export const FAMILY_SPECS: FamilySpec[] = [
    { key: "brick", bayW: 2.7, floorH: 3.2, masonry: true, glass: false,
      win: { x0: 0.27, x1: 0.73, y0: 0.24, y1: 0.80 }, wall: brickWall([168, 96, 70]),
      glassCol: "#3f5562", frameCol: "#e9e2d2", wallRough: 0.88, glassRough: 0.12, glassMetal: 0.0,
      trim: "#ddd3c0", mullions: [1, 2], reveal: 3.2 },
    { key: "stone", bayW: 2.9, floorH: 3.8, masonry: true, glass: false,
      win: { x0: 0.25, x1: 0.75, y0: 0.22, y1: 0.80 }, wall: stoneWall,
      glassCol: "#34495a", frameCol: "#2c2a26", wallRough: 0.8, glassRough: 0.1, glassMetal: 0.0,
      trim: "#efe8d8", mullions: [2, 2], reveal: 3.0 },
    { key: "glass", bayW: 1.6, floorH: 3.9, masonry: false, glass: true,
      win: { x0: 0.04, x1: 0.96, y0: 0.20, y1: 0.98 }, wall: glassWall,
      glassCol: "#86a6b8", frameCol: "#5a646b", wallRough: 0.35, glassRough: 0.06, glassMetal: 0.85,
      reveal: 1.2 },
    { key: "modern", bayW: 3.2, floorH: 3.5, masonry: false, glass: false,
      win: { x0: 0.08, x1: 0.92, y0: 0.32, y1: 0.84 }, wall: panelWall("#c9c0b0"),
      glassCol: "#55707e", frameCol: "#555b60", wallRough: 0.7, glassRough: 0.08, glassMetal: 0.4,
      mullions: [3, 1], reveal: 2.0 },
    { key: "industrial", bayW: 4.2, floorH: 5.0, masonry: true, glass: false,
      win: { x0: 0.16, x1: 0.84, y0: 0.20, y1: 0.86 }, wall: brickWall([150, 82, 60]),
      glassCol: "#54646a", frameCol: "#2b2e30", wallRough: 0.9, glassRough: 0.2, glassMetal: 0.2,
      trim: "#9a8e7c", mullions: [6, 4], reveal: 2.6 },
    { key: "buff", bayW: 2.6, floorH: 3.2, masonry: true, glass: false,
      win: { x0: 0.28, x1: 0.72, y0: 0.24, y1: 0.80 }, wall: brickWall([206, 172, 120]),
      glassCol: "#3c5160", frameCol: "#3a2e24", wallRough: 0.88, glassRough: 0.12, glassMetal: 0.0,
      trim: "#8f4a32", mullions: [1, 2], reveal: 3.2 },
    { key: "brownstone", bayW: 3.0, floorH: 3.6, masonry: true, glass: false,
      win: { x0: 0.26, x1: 0.74, y0: 0.20, y1: 0.84 }, wall: brownWall,
      glassCol: "#37495a", frameCol: "#e6dfcf", wallRough: 0.82, glassRough: 0.1, glassMetal: 0.0,
      trim: "#6b4a3a", mullions: [1, 2], reveal: 3.8 },
    { key: "deco", bayW: 1.8, floorH: 3.7, masonry: true, glass: false,
      win: { x0: 0.30, x1: 0.70, y0: 0.10, y1: 0.92 }, wall: decoWall,
      glassCol: "#30404c", frameCol: "#1f2326", wallRough: 0.75, glassRough: 0.08, glassMetal: 0.2,
      mullions: [1, 3], reveal: 3.4 },
    // THE TOWERS OF THE SECOND HALF OF THE CENTURY were not one glass box.
    // 1960s International Style: ribbon windows between white aluminium
    // spandrel bands, the floors reading as horizontal stripes.
    { key: "ribbon", bayW: 1.6, floorH: 3.7, masonry: false, glass: false,
      win: { x0: 0.0, x1: 1.0, y0: 0.42, y1: 0.95 }, wall: panelWall("#d9d7d0"),
      glassCol: "#2b3943", frameCol: "#a3a8ab", wallRough: 0.45, glassRough: 0.06, glassMetal: 0.55,
      mullions: [2, 1], reveal: 1.2 },
    // 1960s-70s exposed concrete grid: deep square-ish punched windows
    { key: "grid", bayW: 2.2, floorH: 3.6, masonry: false, glass: false,
      win: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 }, wall: panelWall("#b8b4ab"),
      glassCol: "#2f3d47", frameCol: "#6b6a65", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.3,
      mullions: [1, 1], reveal: 4.4 },
    // 1970s-80s bronze-tinted curtain wall with dark mullions
    { key: "bronze", bayW: 1.5, floorH: 3.8, masonry: false, glass: true,
      win: { x0: 0.06, x1: 0.94, y0: 0.18, y1: 0.98 }, wall: tintedGlassWall("#3e3229"),
      glassCol: "#8a6c52", frameCol: "#4a3828", wallRough: 0.35, glassRough: 0.05, glassMetal: 0.85,
      reveal: 1.4 },
    // 1990s-2000s blue-green reflective glass, light silver frames
    { key: "blueglass", bayW: 1.5, floorH: 4.0, masonry: false, glass: true,
      win: { x0: 0.03, x1: 0.97, y0: 0.12, y1: 0.99 }, wall: tintedGlassWall("#2e4c5b"),
      glassCol: "#6f9fb0", frameCol: "#9aaab2", wallRough: 0.3, glassRough: 0.05, glassMetal: 0.9,
      reveal: 1.0 },
    // the other 1920s-30s setback tower: tan brick with tall, narrow,
    // vertically linked windows and dark spandrels between the piers
    { key: "decobrick", bayW: 1.9, floorH: 3.6, masonry: true, glass: false,
      win: { x0: 0.3, x1: 0.7, y0: 0.1, y1: 0.93 }, wall: brickWall([190, 156, 116]),
      glassCol: "#2c3a44", frameCol: "#3a3029", wallRough: 0.85, glassRough: 0.1, glassMetal: 0.1,
      trim: "#6a5a48", mullions: [1, 2], reveal: 3.0 },
    // THE TIMBER TOWN. Before brick, the first streets of a young town were
    // wood: one- and two-storey clapboard houses and shops, painted, with
    // white-trimmed sash windows and a gable.
    { key: "clapboard", bayW: 2.8, floorH: 3.0, masonry: false, glass: false,
      win: { x0: 0.32, x1: 0.68, y0: 0.26, y1: 0.80 }, wall: clapWall,
      glassCol: "#34444e", frameCol: "#f4f1ea", wallRough: 0.8, glassRough: 0.12, glassMetal: 0.0,
      trim: "#f4f1ea", mullions: [1, 2], reveal: 1.6 },
    // MORE OF THE SKYLINE'S VOCABULARY. The 1958 dark tower of bronze
    // I-beams and smoked glass; the 1980s mirror and emerald curtain walls;
    // the 2000s vertical fin; the 1980s white precast slab and the
    // postmodern granite tower with its banded windows.
    { key: "blackglass", bayW: 1.45, floorH: 3.8, masonry: false, glass: true,
      win: { x0: 0.07, x1: 0.93, y0: 0.16, y1: 0.98 }, wall: tintedGlassWall("#17191c"),
      glassCol: "#3a3f44", frameCol: "#4a3a2a", wallRough: 0.35, glassRough: 0.05, glassMetal: 0.85, reveal: 1.6 },
    { key: "greenglass", bayW: 1.5, floorH: 3.9, masonry: false, glass: true,
      win: { x0: 0.04, x1: 0.96, y0: 0.14, y1: 0.99 }, wall: tintedGlassWall("#1d3a33"),
      glassCol: "#5f9e8c", frameCol: "#8aa69c", wallRough: 0.3, glassRough: 0.05, glassMetal: 0.9, reveal: 1.0 },
    { key: "silverglass", bayW: 1.5, floorH: 4.0, masonry: false, glass: true,
      win: { x0: 0.03, x1: 0.97, y0: 0.12, y1: 0.99 }, wall: tintedGlassWall("#5a6168"),
      glassCol: "#c3ccd3", frameCol: "#d4d8dc", wallRough: 0.3, glassRough: 0.04, glassMetal: 0.95, reveal: 0.9 },
    { key: "fins", bayW: 1.25, floorH: 4.0, masonry: false, glass: true,
      win: { x0: 0.14, x1: 0.86, y0: 0.06, y1: 0.99 }, wall: panelWall("#cdd1d4"),
      glassCol: "#4f6e7e", frameCol: "#c9cdd0", wallRough: 0.45, glassRough: 0.05, glassMetal: 0.8, reveal: 2.4 },
    { key: "precast", bayW: 2.0, floorH: 3.7, masonry: false, glass: false,
      win: { x0: 0.18, x1: 0.82, y0: 0.28, y1: 0.80 }, wall: panelWall("#e6e2da"),
      glassCol: "#3b4c58", frameCol: "#9aa0a4", wallRough: 0.7, glassRough: 0.08, glassMetal: 0.35, mullions: [1, 1], reveal: 3.6 },
    { key: "pomo", bayW: 2.2, floorH: 3.8, masonry: true, glass: false,
      win: { x0: 0.12, x1: 0.88, y0: 0.30, y1: 0.86 }, wall: stoneWallC([196, 158, 146], 24),
      glassCol: "#2f4656", frameCol: "#2a2a2a", wallRough: 0.6, glassRough: 0.06, glassMetal: 0.5, trim: "#ece4d4", mullions: [2, 1], reveal: 2.6 },
    // a tower's double-height glass lobby
    { key: "lobby", bayW: 3.0, floorH: 6.5, masonry: false, glass: false,
      win: { x0: 0.05, x1: 0.95, y0: 0.03, y1: 0.90 }, wall: panelWall("#3a3e42"),
      glassCol: "#5d7380", frameCol: "#202428", wallRough: 0.5, glassRough: 0.05, glassMetal: 0.5, mullions: [2, 1], reveal: 1.6 },
    { key: "shop", bayW: 3.4, floorH: 4.2, masonry: false, glass: false,
      win: { x0: 0.06, x1: 0.94, y0: 0.04, y1: 0.66 }, wall: shopWall,
      glassCol: "#5d7380", frameCol: "#2a2622", wallRough: 0.7, glassRough: 0.06, glassMetal: 0.3,
      mullions: [2, 1], reveal: 2.2 },
    { key: "plain", bayW: 3.0, floorH: 3.6, masonry: true, glass: false, noWin: true,
      win: { x0: 0, x1: 0, y0: 0, y1: 0 }, wall: stoneWall,
      glassCol: "#556066", frameCol: "#2c2a26", wallRough: 0.8, glassRough: 0.8, glassMetal: 0,
      reveal: 1.0 },
    { key: "frame", bayW: 4.0, floorH: 3.6, masonry: false, glass: false,
      win: { x0: 0.08, x1: 0.92, y0: 0.10, y1: 0.92 }, wall: panelWall("#a7a49c"),
      glassCol: "#2a2b2c", frameCol: "#8d8a83", wallRough: 0.9, glassRough: 0.9, glassMetal: 0.0,
      reveal: 2.4 },
];

// FOUR ELEVATIONS A FAMILY. A family was one painted texture, so every
// brick walk-up on the island wore the same brick, the same sash and the
// same lintel. Each family now has three more, art-directed rather than
// random and each true to its period: the Italianate segmental arch and the
// Federal pediment and shutters on the walk-ups, white and sandstone and
// granite on the Beaux-Arts stone, smoked, silver and green glass on the
// curtain walls. A building draws one from a hash of its own deed.
export const VARIANTS: Record<string, Partial<FamilySpec>[]> = {
  brick: [
    { wall: brickWall([130, 62, 48]), winStyle: "segment", trim: "#d9cdb5", frameCol: "#2a2a2a" },
    { wall: brickWall([188, 112, 72]), lintel: "pediment", trim: "#e8e2d4", shutter: "#2f4a3a", frameCol: "#f0ece2" },
    { wall: brickWall([205, 200, 190]), winStyle: "arch", trim: "#8a8478", frameCol: "#222222", glassCol: "#3a4a55" },
  ],
  buff: [
    { wall: brickWall([218, 196, 150]), winStyle: "segment", trim: "#6e4a32" },
    { wall: brickWall([176, 148, 108]), winStyle: "pair", trim: "#efe6d2", frameCol: "#2c2a26" },
    { wall: brickWall([196, 170, 140]), lintel: "pediment", trim: "#5a4636", shutter: "#3a3f46" },
  ],
  brownstone: [
    { wall: brownWallC([148, 104, 80]), winStyle: "arch", trim: "#5a3e30" },
    { wall: brownWallC([110, 74, 60]), lintel: "pediment", trim: "#7b5a48", frameCol: "#d8d0c0" },
    { wall: brownWallC([140, 96, 84]), winStyle: "segment", frameCol: "#2a2a2a" },
  ],
  stone: [
    { wall: stoneWallC([212, 206, 190]), winStyle: "arch", frameCol: "#1e2226", mullions: [2, 3] },
    { wall: stoneWallC([176, 160, 138]), lintel: "pediment", trim: "#e8e0cc" },
    { wall: stoneWallC([160, 150, 140], 26), winStyle: "pair", frameCol: "#2b2e30" },
  ],
  deco: [
    { wall: decoWallC("#d8cdb5", "#3b4248", "#e8dfcb") },
    { wall: decoWallC("#b9b2a6", "#5a4b40", "#ccc5b8"), glassCol: "#3a3a33" },
    { wall: decoWallC("#c9a98a", "#40352e", "#d8bc9c") },
  ],
  decobrick: [
    { wall: brickWall([160, 120, 92]) },
    { wall: brickWall([205, 175, 140]), trim: "#4a3e34" },
    { wall: brickWall([150, 80, 60]), trim: "#d8ccb4" },
  ],
  industrial: [
    { wall: brickWall([130, 72, 58]), winStyle: "segment", mullions: [6, 5] },
    { wall: brickWall([170, 150, 120]), mullions: [4, 3], trim: "#7a6a58" },
    { wall: panelWall("#9a9a94"), frameCol: "#4a4e52", mullions: [8, 4], trim: undefined },
  ],
  modern: [
    { wall: panelWall("#d6d2c8"), win: { x0: 0.05, x1: 0.95, y0: 0.32, y1: 0.84 }, frameCol: "#33393e" },
    { wall: panelWall("#a69a8a"), winStyle: "pair" },
    { wall: brickWall([150, 86, 66]), win: { x0: 0.1, x1: 0.9, y0: 0.3, y1: 0.8 }, frameCol: "#d8d8d8" },
  ],
  ribbon: [
    { wall: panelWall("#8a929a"), glassCol: "#22303a" },
    { wall: panelWall("#3a3f44"), glassCol: "#4a6070", frameCol: "#20242a" },
    { wall: panelWall("#c9b89a"), glassCol: "#3a3528" },
  ],
  grid: [
    { wall: panelWall("#d4cfc4"), win: { x0: 0.14, x1: 0.86, y0: 0.2, y1: 0.8 } },
    { wall: panelWall("#9c968c"), win: { x0: 0.2, x1: 0.8, y0: 0.3, y1: 0.75 } },
    { wall: brickWall([120, 90, 75]), frameCol: "#2a2a2a" },
  ],
  glass: [
    { wall: tintedGlassWall("#2a3540"), glassCol: "#5c7f94" },
    { wall: tintedGlassWall("#465058"), glassCol: "#9fb4bf", frameCol: "#7a8890" },
    { wall: tintedGlassWall("#253a3a"), glassCol: "#6a9a8f" },
  ],
  bronze: [
    { wall: tintedGlassWall("#2a1f18"), glassCol: "#5e4a38" },
    { wall: tintedGlassWall("#3a3a38"), glassCol: "#6e6a60", frameCol: "#2a2a28" },
    { wall: tintedGlassWall("#1e2228"), glassCol: "#3e4c58", frameCol: "#15181c" },
  ],
  blueglass: [
    { wall: tintedGlassWall("#244a64"), glassCol: "#4f8fb8" },
    { wall: tintedGlassWall("#3a5a5a"), glassCol: "#7fb4ae" },
    { wall: tintedGlassWall("#4a5a6a"), glassCol: "#a8c4d4", frameCol: "#c4ccd2" },
  ],
  blackglass: [
    { wall: tintedGlassWall("#101214"), glassCol: "#2a2e33", frameCol: "#1a1a1a" },
    { wall: tintedGlassWall("#1c2420"), glassCol: "#34423c", frameCol: "#5a4a32" },
    { wall: tintedGlassWall("#1a1d26"), glassCol: "#3a4252", frameCol: "#2e3036" },
  ],
  greenglass: [
    { wall: tintedGlassWall("#1a4440"), glassCol: "#58a8a0" },
    { wall: tintedGlassWall("#2a4a30"), glassCol: "#7aa880", frameCol: "#a8b8a8" },
    { wall: tintedGlassWall("#164038"), glassCol: "#3e8a7a", frameCol: "#2a3a36" },
  ],
  silverglass: [
    { wall: tintedGlassWall("#4a5058"), glassCol: "#a8b4bf", frameCol: "#e2e4e6" },
    { wall: tintedGlassWall("#666a6e"), glassCol: "#d8d8d2", frameCol: "#bfc2c4" },
    { wall: tintedGlassWall("#505a64"), glassCol: "#b4c4d4", frameCol: "#8a949c" },
  ],
  fins: [
    { wall: panelWall("#2e3236"), glassCol: "#5e7c8a", frameCol: "#2a2e32" },
    { wall: panelWall("#8a6a4a"), glassCol: "#6a6458", frameCol: "#7a5c40" },
    { wall: panelWall("#f0efe9"), glassCol: "#86a2b0", frameCol: "#f2f2ee", win: { x0: 0.2, x1: 0.8, y0: 0.06, y1: 0.99 } },
  ],
  precast: [
    { wall: panelWall("#d8c8b8"), glassCol: "#334450" },
    { wall: panelWall("#c9b4a6"), win: { x0: 0.14, x1: 0.86, y0: 0.32, y1: 0.78 }, frameCol: "#5a5450" },
    { wall: panelWall("#b8bcbf"), winStyle: "pair", frameCol: "#3a3e42" },
  ],
  pomo: [
    { wall: stoneWallC([150, 160, 150], 24), glassCol: "#2c4a44", trim: "#d8d4c8" },
    { wall: stoneWallC([150, 92, 84], 24), winStyle: "arch", frameCol: "#1e1e1e" },
    { wall: stoneWallC([214, 200, 176], 24), glassCol: "#3a5a6a", trim: "#8a6a50" },
  ],
  lobby: [
    { wall: stoneWallC([206, 198, 182]), frameCol: "#2a2a2a" },
    { wall: panelWall("#5a4a3a"), frameCol: "#6a5236", glassCol: "#6a7a80" },
    { wall: panelWall("#d8dadc"), frameCol: "#c0c4c8", glassCol: "#7a96a6" },
  ],
  clapboard: [
    { wall: clapWallC(9), shutter: "#2f4a3a" },
    { wall: clapWallC(6), lintel: "pediment" },
    { wall: clapWallC(8), shutter: "#3a2a26", winStyle: "pair" },
  ],
  shop: [
    { glassCol: "#4a6470", frameCol: "#1f2a24" },
    { glassCol: "#607884", frameCol: "#5a2a26" },
    { glassCol: "#55707e", frameCol: "#d8d0c0" },
  ],
};

// THREE MORE ELEVATIONS for the families that make up most of the city, so
// a block of walk-ups is seven builders' work rather than four. Each still
// true to its period. (The Build desk offers the first four; the street
// draws from all of them.)
export const MORE_VARIANTS: Record<string, Partial<FamilySpec>[]> = {
  brick: [
    { wall: brickWall([112, 54, 44]), lintel: "pediment", trim: "#cfc3ad", frameCol: "#f0ece2" },
    { wall: brickWall([176, 88, 60]), winStyle: "pair", trim: "#3a3a3a", frameCol: "#2a2a2a" },
    { wall: brickWall([150, 110, 96]), winStyle: "arch", shutter: "#5a2a26", frameCol: "#e8e2d4" },
  ],
  buff: [
    { wall: brickWall([228, 210, 170]), winStyle: "arch", trim: "#5a4636", frameCol: "#2a2a2a" },
    { wall: brickWall([186, 160, 112]), shutter: "#2f4a3a", frameCol: "#efe6d2" },
    { wall: brickWall([200, 184, 160]), winStyle: "pair", trim: "#8f4a32" },
  ],
  brownstone: [
    { wall: brownWallC([126, 88, 66]), winStyle: "pair", frameCol: "#2a2a2a" },
    { wall: brownWallC([160, 116, 92]), lintel: "pediment", shutter: "#2a3a2e" },
    { wall: brownWallC([98, 70, 58]), winStyle: "arch", frameCol: "#e6dfcf", trim: "#4a3428" },
  ],
  stone: [
    { wall: stoneWallC([226, 220, 206]), winStyle: "segment", frameCol: "#2a2e30" },
    { wall: stoneWallC([190, 170, 140]), winStyle: "arch", trim: "#f4eedc" },
    { wall: stoneWallC([140, 136, 132], 28), lintel: "pediment", frameCol: "#1e2226" },
  ],
  modern: [
    { wall: panelWall("#e8e4dc"), winStyle: "pair", frameCol: "#2a3036" },
    { wall: panelWall("#8a8e90"), win: { x0: 0.12, x1: 0.88, y0: 0.3, y1: 0.86 }, frameCol: "#d8d8d8" },
    { wall: brickWall([190, 160, 120]), win: { x0: 0.14, x1: 0.86, y0: 0.28, y1: 0.82 }, frameCol: "#2a2a2a" },
  ],
  clapboard: [
    { wall: clapWallC(7), lintel: "pediment", shutter: "#5a2a26" },
    { wall: clapWallC(10), winStyle: "segment" },
    { wall: clapWallC(8), shutter: "#2a3a4a", lintel: "pediment" },
  ],
  industrial: [
    { wall: brickWall([110, 60, 50]), winStyle: "arch", mullions: [6, 4] },
    { wall: panelWall("#b8b2a6"), mullions: [10, 4], frameCol: "#3a3e42" },
    { wall: brickWall([196, 176, 140]), winStyle: "segment", mullions: [5, 4], trim: "#5a4a3a" },
  ],
  grid: [
    { wall: panelWall("#c4b8a4"), win: { x0: 0.24, x1: 0.76, y0: 0.24, y1: 0.76 } },
    { wall: panelWall("#a8aeb2"), win: { x0: 0.16, x1: 0.84, y0: 0.18, y1: 0.86 }, frameCol: "#2a2a2a" },
    { wall: panelWall("#d8c8b0"), winStyle: "pair" },
  ],
  precast: [
    { wall: panelWall("#cfd4d6"), win: { x0: 0.1, x1: 0.9, y0: 0.3, y1: 0.8 }, frameCol: "#2a3e4a" },
    { wall: panelWall("#d6b89a"), glassCol: "#2e3e48" },
    { wall: panelWall("#9aa4a8"), win: { x0: 0.2, x1: 0.8, y0: 0.22, y1: 0.84 }, frameCol: "#d0d0d0" },
  ],
};
for (const [k, v] of Object.entries(MORE_VARIANTS)) VARIANTS[k] = [...(VARIANTS[k] ?? []), ...v];

/** Which elevation a building wears: by what it is, when it went up and how tall — and a per-building roll among the period-correct ones. */
/**
 * NEIGHBOURHOODS HAVE A MATERIAL. A city's old districts were each put up by
 * a handful of builders out of whatever the nearest kiln or quarry sold, so a
 * street of brownstones is a street of brownstones and the buff-brick quarter
 * is buff brick, not a random draw per lot. Keyed by the district's tone
 * family (BuildingVolume.t, the same FNV of the district name the ground's
 * pavement reads), each district leans hard on one tradition: brownstone
 * rows, red brick, buff brick, a timber-frame quarter, and one mixed. Weights
 * are [brick, buff, brownstone] and the share of small pre-1950 buildings
 * that are clapboard. Looks only.
 */
export const DISTRICT_MASONRY: { w: [number, number, number]; clap: number }[] = [
  { w: [0.12, 0.08, 0.80], clap: 0.15 },   // the brownstone rows
  { w: [0.82, 0.08, 0.10], clap: 0.30 },   // red brick
  { w: [0.18, 0.72, 0.10], clap: 0.30 },   // buff brick
  { w: [0.60, 0.25, 0.15], clap: 0.85 },   // the timber-frame quarter
  { w: [0.55, 0.25, 0.20], clap: 0.50 },   // mixed, as it was
];
/** A weighted draw: roll in [0,1) against [key, weight] pairs (weights need not sum to one). */
export function pick(roll: number, w: [string, number][]): string {
  const tot = w.reduce((a, [, x]) => a + x, 0);
  let acc = 0;
  for (const [k, x] of w) { acc += x / tot; if (roll < acc) return k; }
  return w[w.length - 1][0];
}
export function familyFor(cls: string, year: number, h: number, roll = 0.5, district = 4): string {
  const dm = DISTRICT_MASONRY[((district % 5) + 5) % 5];
  // a house or a shop of two storeys from before 1950 is, as often as not,
  // timber — wood frame stayed the American small building until the 1950s
  if (h <= 8.5 && year < 1950 && (cls === "multifamily" || cls === "retail") && ((roll * 7.13) % 1) < dm.clap) return "clapboard";
  // a low pre-war masonry building is one of three brick traditions, by district
  const oldBrick = () => roll < dm.w[0] ? "brick" : roll < dm.w[0] + dm.w[1] ? "buff" : "brownstone";
  if (cls === "industrial") return "industrial";
  if (cls === "office") {
    if (year >= 1958) {
      if (h <= 30) return pick(roll, year < 1980 ? [["modern", 0.7], ["precast", 0.3]] : [["modern", 0.45], ["precast", 0.25], ["fins", 0.15], ["glass", 0.15]]);
      // by when it went up: the ribbon, the grid and the dark tower; then
      // bronze, mirror, white precast and postmodern granite; then blue,
      // emerald, silver and the fin
      if (year < 1973) return pick(roll, [["ribbon", 0.28], ["grid", 0.16], ["blackglass", 0.24], ["glass", 0.16], ["precast", 0.08], ["bronze", 0.08]]);
      if (year < 1988) return pick(roll, [["bronze", 0.17], ["blackglass", 0.12], ["glass", 0.12], ["grid", 0.07], ["ribbon", 0.07], ["precast", 0.1], ["pomo", 0.17], ["silverglass", 0.14], ["greenglass", 0.04]]);
      return pick(roll, [["glass", 0.18], ["blueglass", 0.16], ["greenglass", 0.14], ["silverglass", 0.14], ["fins", 0.16], ["pomo", year < 1998 ? 0.12 : 0.02], ["bronze", 0.05], ["precast", 0.05]]);
    }
    if (year >= 1922 && h > 30) return roll < 0.35 ? "deco" : roll < 0.65 ? "decobrick" : "stone";
    return h > 22 ? "stone" : oldBrick();
  }
  if (cls === "multifamily") {
    // low-rise apartments of every era are mostly brick; the panel and glass
    // elevations belong to the mid- and high-rise slabs
    if (h < 26) return year < 1930 ? oldBrick() : roll < 0.75 ? "brick" : "buff";
    if (year < 1945) return h > 40 ? (roll < 0.3 ? "deco" : roll < 0.65 ? "decobrick" : "stone") : oldBrick();
    if (year > 1995 && h > 40) return pick(roll, [["glass", 0.3], ["blueglass", 0.18], ["fins", 0.2], ["greenglass", 0.12], ["silverglass", 0.12], ["precast", 0.08]]);
    // the post-war slab blocks: panel, a concrete grid, or white precast
    // (the post-war apartment tower was as often brick-clad as concrete)
    if (h > 30) return pick(roll, year < 1985 ? [["grid", 0.18], ["modern", 0.22], ["precast", 0.14], ["brick", 0.2], ["buff", 0.18], ["ribbon", 0.08]] : [["modern", 0.3], ["precast", 0.25], ["pomo", 0.2], ["buff", 0.12], ["silverglass", 0.13]]);
    return "modern";
  }
  if (cls === "retail") return year < 1965 || h < 12 ? oldBrick() : "modern";
  return year < 1945 || h < 14 ? oldBrick() : "modern";
}

// per-building wall tints within a family: brick hues, stone creams, glass casts
export const TINTS: Record<string, [number, number, number][]> = {
  brick: [[1, 1, 1], [0.86, 0.80, 0.78], [1.06, 0.96, 0.86], [0.78, 0.66, 0.62], [1.1, 1.0, 0.92], [0.92, 0.9, 0.94]],
  stone: [[1, 1, 1], [0.96, 0.94, 0.9], [1.02, 0.98, 0.92], [0.9, 0.9, 0.9]],
  glass: [[1, 1, 1], [0.85, 0.95, 0.92], [1.05, 0.96, 0.84], [0.82, 0.86, 0.95], [0.7, 0.74, 0.8], [1.1, 1.08, 1.04], [0.8, 0.92, 1.0], [0.92, 0.88, 0.8]],
  blackglass: [[1, 1, 1], [1.2, 1.1, 0.95], [0.9, 1.0, 1.1], [1.3, 1.3, 1.3]],
  greenglass: [[1, 1, 1], [0.86, 1.0, 1.08], [1.08, 1.04, 0.88], [0.8, 0.86, 0.84]],
  silverglass: [[1, 1, 1], [0.94, 0.96, 1.04], [1.04, 1.0, 0.94], [0.84, 0.86, 0.9]],
  fins: [[1, 1, 1], [0.9, 0.9, 0.92], [1.04, 1.0, 0.94], [0.82, 0.84, 0.86]],
  precast: [[1, 1, 1], [0.96, 0.92, 0.86], [0.92, 0.94, 0.96], [1.02, 0.96, 0.9], [0.88, 0.86, 0.84]],
  pomo: [[1, 1, 1], [0.94, 0.9, 0.88], [1.04, 1.0, 0.96], [0.9, 0.94, 0.92]],
  lobby: [[1, 1, 1]],
  modern: [[1, 1, 1], [0.93, 0.86, 0.78], [0.84, 0.86, 0.88], [1.0, 0.92, 0.82], [0.78, 0.76, 0.74], [0.95, 0.82, 0.72]],
  industrial: [[1, 1, 1], [0.9, 0.86, 0.82], [0.82, 0.78, 0.76]],
  ribbon: [[1, 1, 1], [0.92, 0.93, 0.95], [1.0, 0.97, 0.92], [0.84, 0.85, 0.86], [0.72, 0.74, 0.78]],
  grid: [[1, 1, 1], [0.94, 0.92, 0.88], [0.86, 0.86, 0.86], [1.04, 1.0, 0.94], [0.96, 0.9, 0.84]],
  bronze: [[1, 1, 1], [0.9, 0.86, 0.8], [1.08, 1.0, 0.9], [1.16, 1.04, 0.86], [0.8, 0.78, 0.76]],
  blueglass: [[1, 1, 1], [0.86, 0.98, 0.94], [0.9, 0.94, 1.04], [0.76, 0.86, 1.0], [1.06, 1.06, 1.08]],
  frame: [[1, 1, 1]],
  // white, cream, butter, sage, slate blue, barn red, grey
  clapboard: [[1, 1, 1], [1.0, 0.96, 0.86], [1.0, 0.93, 0.7], [0.78, 0.86, 0.74], [0.7, 0.8, 0.9], [0.72, 0.36, 0.3], [0.8, 0.8, 0.8]],
  plain: [[1, 1, 1]],
  shop: [[1, 1, 1]],
  buff: [[1, 1, 1], [0.95, 0.92, 0.86], [1.04, 1.0, 0.92], [0.9, 0.86, 0.8]],
  brownstone: [[1, 1, 1], [0.9, 0.86, 0.84], [1.06, 1.0, 0.95]],
  decobrick: [[1, 1, 1], [0.94, 0.88, 0.82], [1.06, 1.0, 0.9], [0.86, 0.78, 0.72]],
  deco: [[1, 1, 1], [0.96, 0.93, 0.88], [0.9, 0.9, 0.92], [1.03, 0.99, 0.92]],
};

// WHAT A ROOF IS MADE OF. Pre-war masonry carries tar and gravel, dark and
// warm; a post-war slab a paler ballast; the glass towers and new blocks a
// white membrane; a shed galvanised sheet; a gable slate or asphalt shingle.
// Each building draws its own shade within its kind, so a block of roofs
// reads as a patchwork rather than one grey sheet. (Vertex colours: the roof
// material's own colour — snow, season — multiplies them.)
export function roofTone(fam: string, cls: string, pitched: boolean, seedK: number): number[] {
  const r = ((seedK * 2654435761) >>> 0) / 4294967296;
  const j = 0.92 + ((seedK >>> 5) % 17) / 100;            // ±8% per building
  if (pitched) return r < 0.6 ? [0.48 * j, 0.47 * j, 0.5 * j] : [0.72 * j, 0.5 * j, 0.4 * j];
  if (fam === "industrial") return r < 0.5 ? [0.98 * j, 1.0 * j, 1.03 * j] : [0.55 * j, 0.53 * j, 0.52 * j];
  if (fam === "glass" || fam === "bronze" || fam === "blueglass") return r < 0.75 ? [1.32 * j, 1.33 * j, 1.34 * j] : [0.9 * j, 0.9 * j, 0.92 * j];
  if (fam === "modern" || fam === "plain" || fam === "ribbon" || fam === "grid" || cls === "retail") {
    if (r < 0.06 && fam === "modern") return [0.72 * j, 0.95 * j, 0.58 * j];  // a planted roof
    return r < 0.55 ? [1.25 * j, 1.25 * j, 1.24 * j] : [1.0 * j, 0.97 * j, 0.92 * j];
  }
  // masonry: tar, gravel, or a later silver-painted coat
  return r < 0.45 ? [0.46 * j, 0.44 * j, 0.42 * j] : r < 0.85 ? [0.86 * j, 0.79 * j, 0.68 * j] : [1.2 * j, 1.2 * j, 1.22 * j];
}

