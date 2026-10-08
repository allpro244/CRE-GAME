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
export const TOWER_FAMS = new Set(["glass", "blueglass", "bronze", "ribbon", "grid", "blackglass", "greenglass", "silverglass", "fins", "precast", "pomo", "modern",
  "diagrid", "pixel", "brutalist", "whitebrick", "metalpanel", "rainscreen"]);
/** The curtain walls: a parapet cap and a dark lobby, glass crowns, the sky in the glass. */
export const GLASSY = new Set(["glass", "bronze", "blueglass", "blackglass", "greenglass", "silverglass", "fins", "diagrid", "pixel"]);
/** Old masonry walk-ups and lofts: fire escapes, wooden water tanks, stoops, the mansard. */
export const WALKUP = new Set(["brick", "buff", "brownstone", "georgian", "gothic", "romanesque", "castiron"]);
/** Roofs that carry a wooden water tank when tall enough: pre-war and post-war masonry. */
export const TANK_FAMS = new Set([...WALKUP, "industrial", "stone", "decobrick", "deco", "terracotta", "daylight", "whitebrick", "newstone"]);
/** The masonry towers that step back and end in a setback or a spire, not a glass crown. */
export const STONE_TOWER = new Set(["stone", "terracotta", "newstone", "romanesque", "georgian"]);

/** What a painter may draw on besides the colour: the paint mask (G trim, B accent) and the relief. */
export interface PaintCtx { m: CanvasRenderingContext2D; hg: CanvasRenderingContext2D }
export type Painter = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, pc?: PaintCtx) => void;
export interface FamilySpec {
  key: string; bayW: number; floorH: number; masonry: boolean; glass: boolean;
  // window rectangle within the tile, as fractions
  win: { x0: number; x1: number; y0: number; y1: number };
  wall: Painter;
  /** drawn after the glass: what stands in front of it (columns, a diagrid, fins) */
  over?: Painter;
  glassCol: string; frameCol: string;
  wallRough: number; glassRough: number; glassMetal: number;
  trim?: string;     // painted lintel + sill colour
  mullions?: [number, number]; // vertical, horizontal glazing bars per window
  reveal: number;    // normal-map relief strength
  noWin?: boolean;   // a blank wall: monuments, sheds, hulls
  // the window's shape and dressing — what separates an Italianate walk-up
  // from a Federal row house from a 1950s slab at a glance
  winStyle?: "rect" | "arch" | "segment" | "pair" | "pointed" | "chicago" | "triple";
  lintel?: "flat" | "pediment" | "none" | "keystone" | "hood";
  shutter?: string;  // painted shutters either side
  /** windows that do not line up: each bay and floor shifted by up to this share of the bay (the 2010s staggered elevation) */
  winJitter?: number;
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
export const decoWallC = (face: string, recess: string, pier: string): Painter => (g, w, h, _rnd, pc) => {
  g.fillStyle = face; g.fillRect(0, 0, w, h);
  for (let bx = 0; bx < 2; bx++) {
    const ox = bx * TILE;
    g.fillStyle = recess; g.fillRect(ox + TILE * 0.30, 0, TILE * 0.40, h);           // the recessed bay
    // its spandrels are the accent: the cast panels a deco tower painted green, bronze or black
    if (pc) { pc.m.fillStyle = "rgb(0,0,255)"; pc.m.fillRect(ox + TILE * 0.30, 0, TILE * 0.40, h); }
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
export function familyFor(cls: string, year: number, h: number, roll = 0.5, district = 4, nb = 0.5): string {
  const dm = DISTRICT_MASONRY[((district % 5) + 5) % 5];
  // a second, independent draw from the same roll, for the revival a
  // building was put up in when its quarter had one (nb: the neighbourhood's
  // own number — a few streets went up together, in one style)
  const r2 = (roll * 7.13) % 1, r3 = (roll * 13.71) % 1;
  // a house or a shop of two storeys from before 1950 is, as often as not,
  // timber — wood frame stayed the American small building until the 1950s
  if (h <= 8.5 && year < 1950 && (cls === "multifamily" || cls === "retail") && r2 < dm.clap) return "clapboard";
  // a low pre-war masonry building is one of three brick traditions, by district
  const oldBrick = () => roll < dm.w[0] ? "brick" : roll < dm.w[0] + dm.w[1] ? "buff" : "brownstone";
  // THE REVIVALS. A quarter laid out in the 1910s-30s often went up in one
  // dress: a Colonial Revival street of Flemish-bond brick, a Tudor court, a
  // stucco court of the Spanish Revival. Outside such a quarter they still
  // turn up one building in eight.
  const revival = (lo: number) => {
    const q = nb < 0.12 ? "georgian" : nb < 0.17 ? "stucco" : nb < 0.23 ? "tudor" : "";
    if (q && r3 < 0.62 && !(q === "tudor" && h > 15)) return q;
    if (r3 < lo) return pick(r2, [["georgian", 0.6], ["stucco", 0.15], ["tudor", h <= 15 ? 0.25 : 0]]);
    return "";
  };
  if (cls === "industrial") {
    // the mill and warehouse of brick; the daylight factory of concrete and
    // steel sash; after the war the tilt-up and the metal shed
    if (year < 1905) return "industrial";
    if (year < 1940) return r2 < 0.45 ? "daylight" : "industrial";
    if (year < 1970) return pick(r2, [["industrial", 0.45], ["daylight", 0.25], ["precast", 0.3]]);
    return pick(r2, [["industrial", 0.3], ["precast", 0.35], ["metalpanel", 0.35]]);
  }
  if (cls === "office") {
    if (year >= 1958) {
      if (h <= 30) {
        if (year < 1975) return pick(roll, [["modern", 0.35], ["precast", 0.15], ["midcentury", 0.3], ["brutalist", year >= 1962 ? 0.2 : 0]]);
        if (year < 2005) return pick(roll, [["modern", 0.35], ["precast", 0.25], ["fins", 0.1], ["glass", 0.12], ["brutalist", year < 1982 ? 0.1 : 0], ["pomo", year > 1981 && year < 1998 ? 0.12 : 0]]);
        return pick(roll, [["modern", 0.12], ["precast", 0.1], ["fins", 0.12], ["glass", 0.14], ["metalpanel", 0.16], ["rainscreen", year >= 2010 ? 0.12 : 0.04], ["stackbrick", year >= 2010 ? 0.14 : 0.04], ["timber", year >= 2016 ? 0.08 : 0], ["pixel", year >= 2010 ? 0.06 : 0]]);
      }
      // by when it went up: the ribbon, the grid and the dark tower; then
      // bronze, mirror, white precast, raw concrete and postmodern granite;
      // then blue, emerald, silver, the fin, the diagrid and frit
      if (year < 1973) return pick(roll, [["ribbon", 0.24], ["grid", 0.14], ["blackglass", 0.22], ["glass", 0.14], ["precast", 0.07], ["bronze", 0.07], ["brutalist", year >= 1962 ? 0.1 : 0], ["midcentury", h < 60 ? 0.06 : 0]]);
      if (year < 1988) return pick(roll, [["bronze", 0.16], ["blackglass", 0.1], ["glass", 0.11], ["grid", 0.06], ["ribbon", 0.06], ["precast", 0.09], ["pomo", 0.16], ["silverglass", 0.13], ["greenglass", 0.04], ["brutalist", year < 1981 ? 0.08 : 0]]);
      if (year < 2005) return pick(roll, [["glass", 0.17], ["blueglass", 0.15], ["greenglass", 0.12], ["silverglass", 0.13], ["fins", 0.14], ["pomo", year < 1998 ? 0.14 : 0.02], ["bronze", 0.04], ["precast", 0.05], ["newstone", year >= 2000 ? 0.04 : 0]]);
      return pick(roll, [["glass", 0.16], ["blueglass", 0.12], ["greenglass", 0.08], ["silverglass", 0.12], ["fins", 0.14], ["diagrid", h > 90 ? 0.1 : 0.03], ["pixel", year >= 2010 ? 0.13 : 0.04], ["newstone", 0.05], ["metalpanel", h < 70 ? 0.05 : 0]]);
    }
    if (year >= 1945) return h > 30 ? pick(roll, [["modern", 0.4], ["whitebrick", 0.2], ["buff", 0.2], ["grid", 0.2]]) : pick(roll, [["modern", 0.45], ["midcentury", 0.3], ["buff", 0.25]]);
    if (year >= 1922 && h > 30) return pick(roll, [["deco", 0.3], ["decobrick", 0.28], ["stone", 0.24], ["terracotta", 0.18]]);
    // the iron front of the merchants' street; the Romanesque block of the
    // 1880s; the glazed terra cotta and limestone of the first skyscrapers
    if (year < 1890 && year >= 1848 && h <= 30 && r2 < 0.42) return "castiron";
    if (year >= 1880 && year < 1902 && h > 12 && r2 < 0.35) return "romanesque";
    if (year >= 1890 && h > 14) return pick(roll, [["terracotta", 0.32], ["stone", 0.4], ["buff", 0.14], ["brick", 0.14]]);
    return h > 22 ? "stone" : oldBrick();
  }
  if (cls === "multifamily") {
    if (h < 26) {
      if (year < 1850) return roll < 0.6 ? "brick" : "georgian";
      if (year < 1890) return year >= 1860 && r2 < 0.1 ? "gothic" : oldBrick();
      if (year < 1915) return (year >= 1880 && year < 1902 && r2 < 0.1) ? "romanesque" : (year >= 1900 && revival(0.08)) || oldBrick();
      if (year < 1945) {
        const rv = revival(0.16);
        if (rv) return rv;
        if (year >= 1933 && r2 < 0.18) return "moderne";
        return year < 1930 ? oldBrick() : roll < 0.7 ? "brick" : "buff";
      }
      if (year < 1975) return pick(roll, [["brick", 0.3], ["buff", 0.18], ["whitebrick", h > 10 ? 0.24 : 0.06], ["modern", 0.14], ["moderne", year < 1952 ? 0.12 : 0], ["stucco", 0.03]]);
      if (year < 2003) return pick(roll, [["brick", 0.38], ["buff", 0.12], ["modern", 0.18], ["precast", 0.1], ["stucco", 0.05], ["georgian", 0.1]]);
      return pick(roll, [["fibercement", 0.3], ["metalpanel", year >= 2008 ? 0.16 : 0.06], ["stackbrick", year >= 2008 ? 0.16 : 0.04], ["brick", 0.14], ["rainscreen", year >= 2010 ? 0.07 : 0], ["timber", year >= 2016 ? 0.06 : 0], ["stucco", 0.03], ["modern", 0.05]]);
    }
    if (year < 1945) return h > 40 ? pick(roll, [["deco", 0.26], ["decobrick", 0.3], ["stone", 0.26], ["georgian", h < 60 ? 0.18 : 0]]) : (revival(0.1) || oldBrick());
    if (year < 1975) return pick(roll, year < 1958 ? [["whitebrick", 0.34], ["brick", 0.26], ["buff", 0.24], ["modern", 0.16]]
      : [["grid", 0.14], ["modern", 0.18], ["precast", 0.1], ["brick", 0.16], ["buff", 0.12], ["ribbon", 0.06], ["whitebrick", 0.14], ["brutalist", year >= 1962 ? 0.1 : 0]]);
    if (year < 1996) return pick(roll, [["modern", 0.26], ["precast", 0.24], ["pomo", year > 1981 ? 0.18 : 0.04], ["buff", 0.1], ["brick", 0.08], ["silverglass", h > 40 ? 0.12 : 0.02]]);
    if (h > 40) return pick(roll, [["glass", 0.22], ["blueglass", 0.13], ["fins", 0.15], ["greenglass", 0.08], ["silverglass", 0.09], ["newstone", year >= 2002 ? 0.16 : 0.04], ["precast", 0.05], ["pixel", year >= 2010 ? 0.08 : 0], ["metalpanel", h < 70 && year >= 2008 ? 0.06 : 0]]);
    return pick(roll, [["precast", 0.14], ["modern", 0.12], ["brick", 0.14], ["newstone", year >= 2002 ? 0.12 : 0], ["fibercement", year >= 2003 ? 0.14 : 0], ["metalpanel", year >= 2008 ? 0.12 : 0], ["stackbrick", year >= 2008 ? 0.12 : 0], ["rainscreen", year >= 2010 ? 0.08 : 0], ["glass", 0.06]]);
  }
  if (cls === "retail") {
    if (year >= 1848 && year < 1890 && h > 8) return r2 < 0.45 ? "castiron" : oldBrick();
    if (year < 1925) return oldBrick();
    if (year < 1950) return h < 12 ? pick(roll, [["brick", 0.4], ["moderne", year >= 1933 ? 0.3 : 0], ["stucco", 0.1], ["buff", 0.2]]) : oldBrick();
    if (year < 1972) return pick(roll, [["midcentury", 0.35], ["modern", 0.35], ["brick", 0.24], ["stucco", 0.06]]);
    if (year < 2005) return pick(roll, [["modern", 0.45], ["stucco", 0.1], ["precast", 0.2], ["brick", 0.25]]);
    return pick(roll, [["modern", 0.2], ["metalpanel", 0.22], ["fibercement", 0.18], ["stackbrick", 0.2], ["rainscreen", 0.1], ["timber", year >= 2016 ? 0.1 : 0]]);
  }
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
  const J = (c: number[]) => [c[0] * j, c[1] * j, c[2] * j];
  if (pitched) {
    // clay tile on the Spanish Revival; on the rest slate, asphalt shingle
    // (grey, brown, green, red) and, on the odd old roof, standing-seam tin
    // painted red or a copper gone green
    if (fam === "stucco") return J(r < 0.8 ? [0.86, 0.46, 0.32] : [0.74, 0.5, 0.38]);
    if (fam === "tudor") return J(r < 0.5 ? [0.36, 0.35, 0.37] : r < 0.8 ? [0.5, 0.36, 0.3] : [0.42, 0.44, 0.4]);
    return J(r < 0.36 ? [0.48, 0.47, 0.5] : r < 0.6 ? [0.72, 0.5, 0.4] : r < 0.74 ? [0.38, 0.37, 0.38] : r < 0.84 ? [0.46, 0.52, 0.44]
      : r < 0.92 ? [0.62, 0.3, 0.26] : [0.5, 0.72, 0.62]);
  }
  if (fam === "industrial" || fam === "daylight") return J(r < 0.5 ? [0.98, 1.0, 1.03] : [0.55, 0.53, 0.52]);
  if (GLASSY.has(fam)) return J(r < 0.75 ? [1.32, 1.33, 1.34] : [0.9, 0.9, 0.92]);
  // the new century: white membrane, a planted roof in one of seven
  if (fam === "fibercement" || fam === "metalpanel" || fam === "rainscreen" || fam === "stackbrick" || fam === "timber") {
    if (r < 0.15) return J([0.72, 0.95, 0.58]);
    return J(r < 0.7 ? [1.3, 1.3, 1.3] : [0.95, 0.94, 0.92]);
  }
  if (fam === "modern" || fam === "plain" || fam === "ribbon" || fam === "grid" || fam === "midcentury" || fam === "brutalist" || fam === "whitebrick" || fam === "moderne" || cls === "retail") {
    if (r < 0.06 && fam === "modern") return J([0.72, 0.95, 0.58]);  // a planted roof
    return J(r < 0.55 ? [1.25, 1.25, 1.24] : [1.0, 0.97, 0.92]);
  }
  // masonry: tar, gravel, or a later silver-painted coat
  return J(r < 0.45 ? [0.46, 0.44, 0.42] : r < 0.85 ? [0.86, 0.79, 0.68] : [1.2, 1.2, 1.22]);
}


// ============================================================================
// THE WIDER PATTERN BOOK. Twenty more families, each a real tradition of the
// American city, at real sizes: what a photograph of SoHo, Back Bay, the Loop,
// Silver Lake or a 2015 infill block actually shows. Each paints its own
// relief and marks its own paintable parts (pc.m: green trim, blue accent).
// ============================================================================

type RGB = [number, number, number];
const rgb = (c: RGB, v = 1) => `rgb(${Math.min(255, c[0] * v) | 0},${Math.min(255, c[1] * v) | 0},${Math.min(255, c[2] * v) | 0})`;
const T2 = TILE;
/** Fill a rectangle on the colour and, when given, the same rectangle on the mask. */
function fillBoth(g: CanvasRenderingContext2D, pc: PaintCtx | undefined, col: string, mk: string | null, x: number, y: number, w: number, h: number) {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  if (pc && mk) { pc.m.fillStyle = mk; pc.m.fillRect(x, y, w, h); }
}
const MK_TRIM = "rgb(0,255,0)", MK_ACC = "rgb(0,0,255)";

/** SoHo cast iron, 1850-1890: a painted iron front of engaged columns and entablatures. */
export const castIronWall = (base: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(base, 0.9); g.fillRect(0, 0, w, h);
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T2, oy = by * T2;
    // the entablature over each storey: architrave, frieze, a dentil course
    g.fillStyle = rgb(base, 1.04); g.fillRect(ox, oy, T2, 15);
    g.fillStyle = rgb(base, 0.7); g.fillRect(ox, oy + 15, T2, 2);
    for (let x = ox + 2; x < ox + T2; x += 6) { g.fillStyle = rgb(base, 0.8); g.fillRect(x, oy + 9, 3, 4); }
    // engaged columns either side of the bay, lit on one flank
    for (const cx of [ox + 7, ox + T2 - 7]) {
      g.fillStyle = rgb(base, 1.06); g.fillRect(cx - 6, oy + 17, 12, T2 - 17);
      g.fillStyle = rgb(base, 0.78); g.fillRect(cx + 3, oy + 17, 3, T2 - 17);
      for (let fx = cx - 4; fx < cx + 3; fx += 3) { g.fillStyle = rgb(base, 0.9); g.fillRect(fx, oy + 24, 1, T2 - 30); }
      g.fillStyle = rgb(base, 1.1); g.fillRect(cx - 8, oy + 17, 16, 6);           // capital
      g.fillRect(cx - 8, oy + T2 - 6, 16, 6);                                    // base
      if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(cx - 6, oy + 17, 12, T2 - 17); }
    }
    if (pc) { pc.hg.fillStyle = "#d8d8d8"; pc.hg.fillRect(ox + 14, oy + 18, T2 - 28, T2 - 18); pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(ox, oy, T2, 15); }
  }
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
};

/** Richardsonian Romanesque, 1880-1900: rock-faced ashlar in random lengths, deep joints. */
export const rockFaced = (c: RGB, course = 18): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.62); g.fillRect(0, 0, w, h);
  if (pc) { pc.hg.fillStyle = "#c4c4c4"; pc.hg.fillRect(0, 0, w, h); }
  for (let y = 0; y < h; y += course) {
    let x = -rnd() * 30;
    while (x < w) {
      const L = 24 + rnd() * 40, v = 0.86 + rnd() * 0.22;
      g.fillStyle = rgb(c, v); g.fillRect(x + 1.5, y + 1.5, L - 3, course - 3);
      // the rock face: a lit upper edge and a pitted, shadowed lower one
      g.fillStyle = rgb(c, v * 1.12); g.fillRect(x + 2, y + 2, L - 4, 3);
      g.fillStyle = rgb(c, v * 0.8); g.fillRect(x + 2, y + course - 5, L - 4, 3);
      if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(x + 1.5, y + 1.5, L - 3, course - 3); }
      x += L;
    }
  }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.1})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
};

/** Glazed terra cotta, 1890-1930: the Chicago school's tiled skin, piers up, ornamented spandrels in the trim. */
export const terracottaWall = (glaze: RGB, orn: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(glaze); g.fillRect(0, 0, w, h);
  g.strokeStyle = rgb(glaze, 0.86); g.lineWidth = 1;
  for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let y = 0, r = 0; y < h; y += 16, r++) for (let x = (r % 2) * 16; x < w; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T2, oy = by * T2;
    // piers either side, a shade brighter, running through
    g.fillStyle = rgb(glaze, 1.06); g.fillRect(ox, oy, 9, T2); g.fillRect(ox + T2 - 9, oy, 9, T2);
    // the spandrel under the sill: a sunk panel with a run of rosettes
    fillBoth(g, pc, rgb(orn), MK_TRIM, ox + 12, oy + T2 * 0.82, T2 - 24, T2 * 0.15);
    g.fillStyle = rgb(orn, 0.82);
    for (let x = ox + 20; x < ox + T2 - 16; x += 14) { g.beginPath(); g.arc(x, oy + T2 * 0.895, 3.5, 0, 6.283); g.fill(); }
    if (pc) { pc.hg.fillStyle = "#e4e4e4"; pc.hg.fillRect(ox + 12, oy + T2 * 0.82, T2 - 24, T2 * 0.15); }
  }
  for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.08})`; g.fillRect(rnd() * w, rnd() * h, 3, 1); }
};

/** High Victorian Gothic, 1860-1895: red brick banded in black and cream courses. */
export const polyBrick = (base: RGB, band1: RGB, band2: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = "#a89c8a"; g.fillRect(0, 0, w, h);
  const bw = 16, bh = 6;
  for (let y = 0, r = 0; y < h; y += bh, r++) for (let x = -((r % 2) * bw) / 2; x < w; x += bw) {
    const v = 0.86 + rnd() * 0.22, m = r % 11;
    const c = m === 4 || m === 6 ? band1 : m === 5 ? band2 : base;
    g.fillStyle = rgb(c, v); g.fillRect(x + 1, y + 1, bw - 1.5, bh - 1.5);
  }
};

/** Stucco over block or lath: Spanish and Mediterranean Revival, the 1920s court, the moderne. Trowel marks, a hairline crack. */
export const stuccoWall = (c: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const v = 0.93 + rnd() * 0.12;
    g.fillStyle = rgb(c, v); g.globalAlpha = 0.35;
    g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 18, 3 + rnd() * 8, rnd() * 3, 0, 6.283); g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; g.fillRect(rnd() * w, rnd() * h, 1, 1); }
  g.strokeStyle = "rgba(60,50,40,0.18)"; g.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) { let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rnd() * 10 - 3; y += rnd() * 8 - 4; g.lineTo(x, y); } g.stroke(); }
};

/** Flemish bond, the Colonial Revival's brick: stretcher and header in every course, the headers burnt dark. */
export const flemishWall = (base: RGB, header: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = "#b9ad9c"; g.fillRect(0, 0, w, h);
  const bh = 6;
  for (let y = 0, r = 0; y < h; y += bh, r++) {
    let x = r % 2 ? -12 : 0, st = true;
    while (x < w) {
      const L = st ? 16 : 8, v = 0.86 + rnd() * 0.22;
      g.fillStyle = rgb(st ? base : header, v); g.fillRect(x + 1, y + 1, L - 1.5, bh - 1.5);
      x += L; st = !st;
    }
  }
};

/** Tudor Revival, 1915-1935: stucco infill between dark timbers — the timbers are the accent. */
export const tudorWall = (fill: RGB, timber: RGB): Painter => (g, w, h, rnd, pc) => {
  stuccoWall(fill)(g, w, h, rnd);
  const tm = rgb(timber);
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T2, oy = by * T2;
    fillBoth(g, pc, tm, MK_ACC, ox, oy, T2, 7);                    // top plate
    fillBoth(g, pc, tm, MK_ACC, ox, oy + T2 * 0.78, T2, 6);        // sill rail
    fillBoth(g, pc, tm, MK_ACC, ox, oy, 7, T2);                    // posts
    fillBoth(g, pc, tm, MK_ACC, ox + T2 / 2 - 3, oy + T2 * 0.78, 6, T2 * 0.22);
    // braces in the panel under the windows
    for (const [x0, x1] of [[ox + 7, ox + T2 / 2 - 3], [ox + T2 - 1, ox + T2 / 2 + 3]]) {
      for (const gg of pc ? [g, pc.m] : [g]) {
        gg.strokeStyle = gg === g ? tm : MK_ACC; gg.lineWidth = 6;
        gg.beginPath(); gg.moveTo(x0, oy + T2); gg.lineTo(x1, oy + T2 * 0.8); gg.stroke();
      }
    }
  }
};

/** Glazed white brick, 1945-1970: the post-war apartment house's wipe-clean skin. */
export const glazedBrick = (base: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(base, 0.78); g.fillRect(0, 0, w, h);
  const bw = 16, bh = 6;
  for (let y = 0, r = 0; y < h; y += bh, r++) for (let x = -((r % 2) * bw) / 2; x < w; x += bw) {
    const v = 0.95 + rnd() * 0.08;
    g.fillStyle = rgb(base, v); g.fillRect(x + 0.8, y + 0.8, bw - 1.2, bh - 1.2);
    g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x + 1, y + 1, bw - 3, 1);
  }
};

/** Board-formed concrete, 1962-1980: the brutalist slab, deep fins between deep windows. */
export const boardFormed = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 9) { const v = 0.94 + rnd() * 0.1; g.fillStyle = rgb(c, v); g.fillRect(x, 0, 8, h); g.fillStyle = rgb(c, 0.85); g.fillRect(x + 8, 0, 1, h); }
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${0.06 + rnd() * 0.1})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.8 + rnd(), 0, 6.283); g.fill(); }
  // rain streaks under every slab edge
  for (let i = 0; i < 40; i++) { const x = rnd() * w, y = (rnd() < 0.5 ? 0 : T2) + 14; g.fillStyle = `rgba(40,40,36,${0.05 + rnd() * 0.08})`; g.fillRect(x, y, 2 + rnd() * 3, 20 + rnd() * 60); }
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T2, oy = by * T2;
    g.fillStyle = rgb(c, 1.08); g.fillRect(ox, oy, T2, 14);                        // slab edge
    g.fillStyle = rgb(c, 0.7); g.fillRect(ox, oy + 14, T2, 3);
    g.fillStyle = rgb(c, 1.05); g.fillRect(ox, oy, 12, T2); g.fillRect(ox + T2 - 12, oy, 12, T2);   // fins
    g.fillStyle = rgb(c, 0.72); g.fillRect(ox + 12, oy, 3, T2); g.fillRect(ox + T2 - 15, oy, 3, T2);
    if (pc) { pc.hg.fillStyle = "#9a9a9a"; pc.hg.fillRect(ox + 15, oy + 17, T2 - 30, T2 - 17); pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(ox, oy, T2, 14); pc.hg.fillRect(ox, oy, 12, T2); pc.hg.fillRect(ox + T2 - 12, oy, 12, T2); }
  }
};

/** The 1950s curtain wall: an aluminium grid holding porcelain-enamel spandrel panels in the accent. */
export const enamelPanel = (frame: RGB, panel: RGB): Painter => (g, w, h, _rnd, pc) => {
  g.fillStyle = rgb(frame); g.fillRect(0, 0, w, h);
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T2, oy = by * T2;
    fillBoth(g, pc, rgb(panel), MK_ACC, ox + 5, oy + T2 * 0.70, T2 - 10, T2 * 0.27);
    g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(ox + 5, oy + T2 * 0.7, T2 - 10, 3);
    g.fillStyle = rgb(frame, 1.08); g.fillRect(ox, oy, 5, T2); g.fillRect(ox + T2 - 5, oy, 5, T2);
  }
};

/** Fibre-cement panels in two tones, 2005-today: the mid-rise apartment block's patchwork; the second tone is the accent. */
export const fiberCement = (c1: RGB, c2: RGB, cut = 0): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c1); g.fillRect(0, 0, w, h);
  // the second tone in whole panels: a vertical run, or a checker of floors
  const blocks: [number, number, number, number][] = cut === 0 ? [[0, 0, T2 * 0.55, h]]
    : cut === 1 ? [[0, 0, T2, T2], [T2, T2, T2, T2]] : [[T2 * 0.5, 0, T2, T2], [0, T2, T2 * 0.6, T2]];
  for (const [x, y, bw, bh] of blocks) fillBoth(g, pc, rgb(c2), MK_ACC, x, y, bw, bh);
  // panel joints and fasteners
  g.strokeStyle = "rgba(0,0,0,0.22)"; g.lineWidth = 1.2;
  for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`; g.fillRect(rnd() * w, rnd() * h, 3, 3); }
};

/** Standing-seam or flat-lock metal panel: vertical seams, a faint oil-can sheen. */
export const metalSeam = (c: RGB, pitch = 12): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += pitch) {
    const v = 0.96 + rnd() * 0.08;
    g.fillStyle = rgb(c, v); g.fillRect(x, 0, pitch - 2, h);
    g.fillStyle = rgb(c, 1.18); g.fillRect(x + pitch - 2, 0, 1, h);
    g.fillStyle = rgb(c, 0.72); g.fillRect(x + pitch - 1, 0, 1, h);
  }
};

/** Terracotta rainscreen, 2010-today: baguettes on a rail, joints every panel. */
export const baguette = (c: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(c, 0.6); g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 6) {
    const v = 0.9 + rnd() * 0.18;
    g.fillStyle = rgb(c, v); g.fillRect(x, 0, 4, h);
    g.fillStyle = rgb(c, v * 1.14); g.fillRect(x, 0, 1.2, h);
  }
  for (let y = 0; y < h; y += 64) { g.fillStyle = rgb(c, 0.5); g.fillRect(0, y, w, 2); }
};

/** Stack-bond brick, 2010-today: the joints aligned both ways, a soldier course at each floor (trim). */
export const stackBond = (base: RGB, mortar = "#5c5a56"): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = mortar; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 24) {
    const v = 0.9 + rnd() * 0.16;
    g.fillStyle = rgb(base, v); g.fillRect(x + 0.8, y + 0.8, 22.4, 4.4);
  }
  for (let by = 0; by < 2; by++) {
    const y = by * T2 + T2 - 12;
    for (let x = 0; x < w; x += 6) { const v = 0.9 + rnd() * 0.15; fillBoth(g, pc, rgb(base, v * 0.92), MK_TRIM, x + 0.6, y, 4.8, 11); }
  }
};

/** The daylight factory, 1905-1935: a concrete frame filled wall to wall with steel sash (accent). */
export const concreteFrame = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c); g.fillRect(0, 0, w, h);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T2, oy = by * T2;
    g.fillStyle = rgb(c, 1.06); g.fillRect(ox, oy, 10, T2); g.fillRect(ox + T2 - 10, oy, 10, T2);   // columns
    g.fillStyle = rgb(c, 0.95); g.fillRect(ox, oy + T2 - 16, T2, 16);                            // spandrel beam
    g.fillStyle = rgb(c, 0.75); g.fillRect(ox, oy + T2 - 17, T2, 1.5);
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(ox, oy, 10, T2); pc.hg.fillRect(ox + T2 - 10, oy, 10, T2); }
  }
};

/** Streamline Moderne, 1933-1950: smooth render with three speed lines at sill and head (trim). */
export const moderneWall = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  stuccoWall(c)(g, w, h, rnd);
  for (let by = 0; by < 2; by++) {
    const oy = by * T2;
    for (const y0 of [oy + 6, oy + T2 * 0.74]) for (let k = 0; k < 3; k++) {
      fillBoth(g, pc, rgb(c, 0.82), MK_TRIM, 0, y0 + k * 6, w, 2.4);
      if (pc) { pc.hg.fillStyle = "#c0c0c0"; pc.hg.fillRect(0, y0 + k * 6, w, 2.4); }
    }
  }
};

/** Mass timber and wood slats, 2016-today: warm vertical cladding, oiled, a little weathered. */
export const woodSlat = (c: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(c, 0.45); g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 5) {
    const v = 0.82 + rnd() * 0.3;
    g.fillStyle = rgb(c, v); g.fillRect(x, 0, 3.6, h);
    for (let k = 0; k < 4; k++) { g.fillStyle = `rgba(60,36,18,${rnd() * 0.12})`; g.fillRect(x, rnd() * h, 3.6, 4 + rnd() * 18); }
  }
};

/** Rusticated stone, the base of a Beaux-Arts or Romanesque front: long blocks and deep channels. */
export const rusticWall = (c: RGB): Painter => (g, w, h, rnd, pc) => {
  g.fillStyle = rgb(c, 0.6); g.fillRect(0, 0, w, h);
  if (pc) { pc.hg.fillStyle = "#808080"; pc.hg.fillRect(0, 0, w, h); }
  for (let y = 0, r = 0; y < h; y += 26, r++) for (let x = (r % 2) * 40 - 40; x < w; x += 80) {
    const v = 0.92 + rnd() * 0.12;
    g.fillStyle = rgb(c, v); g.fillRect(x + 2, y + 3, 76, 20);
    g.fillStyle = rgb(c, v * 1.1); g.fillRect(x + 2, y + 3, 76, 3);
    if (pc) { pc.hg.fillStyle = "#ffffff"; pc.hg.fillRect(x + 2, y + 3, 76, 20); }
  }
};

/** Fine-jointed limestone of the 2000s apartment tower: thin courses, quiet. */
export const ashlarFine = (c: RGB): Painter => (g, w, h, rnd) => {
  g.fillStyle = rgb(c, 0.9); g.fillRect(0, 0, w, h);
  for (let y = 0, r = 0; y < h; y += 16, r++) for (let x = (r % 2) * 24; x < w; x += 48) {
    const v = 0.96 + rnd() * 0.06;
    g.fillStyle = rgb(c, v); g.fillRect(x + 0.8, y + 0.8, 46.4, 14.4);
  }
};

/** A diagrid in front of the glass (drawn after the windows): the 2000s tower's crossed steel, in the accent. */
export const diagridOver = (steel: RGB): Painter => (g, w, h, _rnd, pc) => {
  for (const gg of pc ? [g, pc.m] : [g]) {
    gg.strokeStyle = gg === g ? rgb(steel) : MK_ACC; gg.lineWidth = 9;
    gg.beginPath(); gg.moveTo(0, 0); gg.lineTo(w, h); gg.moveTo(w, 0); gg.lineTo(0, h);
    gg.moveTo(-w / 2, h / 2); gg.lineTo(w / 2, -h / 2); gg.moveTo(w / 2, h * 1.5); gg.lineTo(w * 1.5, h / 2);
    gg.moveTo(w / 2, -h / 2); gg.lineTo(w * 1.5, h / 2); gg.moveTo(-w / 2, h / 2); gg.lineTo(w / 2, h * 1.5);
    gg.stroke();
  }
  g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
  if (pc) { pc.hg.strokeStyle = "#ffffff"; pc.hg.lineWidth = 9; pc.hg.beginPath(); pc.hg.moveTo(0, 0); pc.hg.lineTo(w, h); pc.hg.moveTo(w, 0); pc.hg.lineTo(0, h); pc.hg.stroke(); }
};

/** Unitised glass with opaque frit panels and pinstripe mullions (drawn after the windows), 2010-today. */
export const pixelOver = (panel: RGB, seed: number): Painter => (g, _w, _h, rnd, pc) => {
  let s = seed;
  const r2 = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T2, oy = by * T2;
    if (r2() < 0.42) fillBoth(g, pc, rgb(panel, 0.92 + rnd() * 0.12), MK_ACC, ox + 4, oy + (r2() < 0.5 ? 0 : T2 * 0.5), T2 * 0.5 - 4, T2 * 0.5);
    g.fillStyle = "rgba(220,224,228,0.85)"; g.fillRect(ox + T2 / 2 - 1.5, oy, 3, T2);
  }
};

export const NEW_FAMILY_SPECS: FamilySpec[] = [
  { key: "castiron", bayW: 3.1, floorH: 4.4, masonry: true, glass: false,
    win: { x0: 0.15, x1: 0.85, y0: 0.08, y1: 0.86 }, wall: castIronWall([214, 208, 194]), winStyle: "segment",
    glassCol: "#3a4a54", frameCol: "#2a2a28", wallRough: 0.55, glassRough: 0.08, glassMetal: 0.1, mullions: [2, 2], reveal: 3.4 },
  { key: "romanesque", bayW: 3.4, floorH: 4.0, masonry: true, glass: false,
    win: { x0: 0.24, x1: 0.76, y0: 0.18, y1: 0.84 }, wall: rockFaced([150, 84, 66]), winStyle: "arch",
    glassCol: "#34444e", frameCol: "#2a2622", wallRough: 0.92, glassRough: 0.1, glassMetal: 0.0, trim: "#7a4a3a", mullions: [2, 3], reveal: 4.2 },
  { key: "terracotta", bayW: 4.4, floorH: 3.9, masonry: true, glass: false,
    win: { x0: 0.1, x1: 0.9, y0: 0.2, y1: 0.86 }, wall: terracottaWall([236, 230, 214], [214, 200, 172]), winStyle: "chicago",
    glassCol: "#344854", frameCol: "#3a3a36", wallRough: 0.42, glassRough: 0.08, glassMetal: 0.1, mullions: [1, 2], reveal: 2.8 },
  { key: "gothic", bayW: 2.6, floorH: 3.7, masonry: true, glass: false,
    win: { x0: 0.3, x1: 0.7, y0: 0.2, y1: 0.86 }, wall: polyBrick([160, 74, 54], [52, 40, 36], [222, 204, 168]), winStyle: "pointed",
    glassCol: "#33434c", frameCol: "#e6dccb", wallRough: 0.88, glassRough: 0.12, glassMetal: 0.0, trim: "#dccdb0", mullions: [1, 2], reveal: 3.4 },
  { key: "stucco", bayW: 3.0, floorH: 3.3, masonry: false, glass: false,
    win: { x0: 0.3, x1: 0.7, y0: 0.26, y1: 0.8 }, wall: stuccoWall([238, 226, 200]),
    glassCol: "#34444e", frameCol: "#3a2e26", wallRough: 0.9, glassRough: 0.12, glassMetal: 0.0, mullions: [2, 3], reveal: 4.0 },
  { key: "georgian", bayW: 2.8, floorH: 3.4, masonry: true, glass: false,
    win: { x0: 0.3, x1: 0.7, y0: 0.22, y1: 0.82 }, wall: flemishWall([160, 70, 52], [88, 44, 38]), lintel: "keystone",
    glassCol: "#34444e", frameCol: "#f2efe6", wallRough: 0.88, glassRough: 0.12, glassMetal: 0.0, trim: "#ece6d6", mullions: [2, 3], reveal: 3.2 },
  { key: "tudor", bayW: 2.6, floorH: 3.1, masonry: false, glass: false,
    win: { x0: 0.24, x1: 0.76, y0: 0.32, y1: 0.76 }, wall: tudorWall([236, 228, 208], [62, 44, 32]), winStyle: "triple",
    glassCol: "#3a4650", frameCol: "#3a2c22", wallRough: 0.9, glassRough: 0.12, glassMetal: 0.0, mullions: [2, 3], reveal: 2.4 },
  { key: "whitebrick", bayW: 3.0, floorH: 2.9, masonry: false, glass: false,
    win: { x0: 0.16, x1: 0.84, y0: 0.26, y1: 0.82 }, wall: glazedBrick([232, 230, 222]),
    glassCol: "#3c4c56", frameCol: "#5a5e60", wallRough: 0.5, glassRough: 0.08, glassMetal: 0.2, mullions: [3, 2], reveal: 1.8 },
  { key: "brutalist", bayW: 3.0, floorH: 3.8, masonry: false, glass: false,
    win: { x0: 0.14, x1: 0.86, y0: 0.18, y1: 0.86 }, wall: boardFormed([176, 172, 164]),
    glassCol: "#2c3a44", frameCol: "#3a3c3e", wallRough: 0.92, glassRough: 0.08, glassMetal: 0.3, mullions: [1, 1], reveal: 5.0 },
  { key: "midcentury", bayW: 1.8, floorH: 3.7, masonry: false, glass: false,
    win: { x0: 0.05, x1: 0.95, y0: 0.32, y1: 0.97 }, wall: enamelPanel([196, 200, 202], [70, 150, 150]),
    glassCol: "#3a5462", frameCol: "#b8bcbe", wallRough: 0.4, glassRough: 0.06, glassMetal: 0.5, mullions: [1, 2], reveal: 1.2 },
  { key: "fibercement", bayW: 3.2, floorH: 3.1, masonry: false, glass: false,
    win: { x0: 0.22, x1: 0.78, y0: 0.18, y1: 0.86 }, wall: fiberCement([226, 224, 218], [70, 72, 74]),
    glassCol: "#3a4c58", frameCol: "#2a2c2e", wallRough: 0.75, glassRough: 0.06, glassMetal: 0.3, mullions: [1, 1], reveal: 2.2, winJitter: 0.14 },
  { key: "metalpanel", bayW: 3.4, floorH: 3.6, masonry: false, glass: false,
    win: { x0: 0.18, x1: 0.82, y0: 0.14, y1: 0.9 }, wall: metalSeam([150, 154, 156]),
    glassCol: "#46606e", frameCol: "#2e3236", wallRough: 0.4, glassRough: 0.05, glassMetal: 0.55, mullions: [1, 1], reveal: 2.0, winJitter: 0.18 },
  { key: "rainscreen", bayW: 3.2, floorH: 3.6, masonry: false, glass: false,
    win: { x0: 0.14, x1: 0.86, y0: 0.1, y1: 0.9 }, wall: baguette([182, 98, 70]),
    glassCol: "#3e5664", frameCol: "#2a2a2a", wallRough: 0.8, glassRough: 0.05, glassMetal: 0.45, mullions: [2, 1], reveal: 2.4 },
  { key: "newstone", bayW: 3.2, floorH: 3.4, masonry: true, glass: false,
    win: { x0: 0.24, x1: 0.76, y0: 0.18, y1: 0.86 }, wall: ashlarFine([222, 212, 192]),
    glassCol: "#3a4c5a", frameCol: "#3a3e40", wallRough: 0.75, glassRough: 0.06, glassMetal: 0.35, trim: "#e8e0cc", mullions: [2, 2], reveal: 3.2 },
  { key: "stackbrick", bayW: 3.6, floorH: 3.4, masonry: false, glass: false,
    win: { x0: 0.12, x1: 0.88, y0: 0.14, y1: 0.86 }, wall: stackBond([70, 66, 64]),
    glassCol: "#3e5260", frameCol: "#1e1e1e", wallRough: 0.85, glassRough: 0.05, glassMetal: 0.35, mullions: [2, 2], reveal: 2.8 },
  { key: "daylight", bayW: 4.6, floorH: 4.4, masonry: false, glass: false,
    win: { x0: 0.09, x1: 0.91, y0: 0.15, y1: 0.98 }, wall: concreteFrame([196, 190, 178]),
    glassCol: "#55666e", frameCol: "#2e3a32", wallRough: 0.9, glassRough: 0.2, glassMetal: 0.2, mullions: [6, 5], reveal: 2.6 },
  { key: "moderne", bayW: 2.4, floorH: 3.2, masonry: false, glass: false,
    win: { x0: 0.06, x1: 0.94, y0: 0.3, y1: 0.7 }, wall: moderneWall([234, 226, 206]),
    glassCol: "#3a4a56", frameCol: "#3c4044", wallRough: 0.85, glassRough: 0.08, glassMetal: 0.2, mullions: [3, 1], reveal: 2.0 },
  { key: "timber", bayW: 3.0, floorH: 3.5, masonry: false, glass: false,
    win: { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.92 }, wall: woodSlat([168, 120, 78]),
    glassCol: "#43606e", frameCol: "#2a2a2a", wallRough: 0.8, glassRough: 0.05, glassMetal: 0.45, mullions: [1, 1], reveal: 2.0, winJitter: 0.1 },
  { key: "rustic", bayW: 3.8, floorH: 5.2, masonry: true, glass: false,
    win: { x0: 0.2, x1: 0.8, y0: 0.06, y1: 0.86 }, wall: rusticWall([200, 192, 176]), winStyle: "arch",
    glassCol: "#3a4a54", frameCol: "#262626", wallRough: 0.85, glassRough: 0.08, glassMetal: 0.2, mullions: [2, 3], reveal: 4.6 },
  { key: "diagrid", bayW: 1.6, floorH: 4.0, masonry: false, glass: true,
    win: { x0: 0.03, x1: 0.97, y0: 0.08, y1: 0.99 }, wall: tintedGlassWall("#2e3e48"), over: diagridOver([150, 158, 164]),
    glassCol: "#7a9cb0", frameCol: "#8a949c", wallRough: 0.3, glassRough: 0.05, glassMetal: 0.9, reveal: 1.6 },
  { key: "pixel", bayW: 1.5, floorH: 4.0, masonry: false, glass: true,
    win: { x0: 0.02, x1: 0.98, y0: 0.06, y1: 0.99 }, wall: tintedGlassWall("#3a4a54"), over: pixelOver([226, 228, 226], 7),
    glassCol: "#86a4b4", frameCol: "#d8dcde", wallRough: 0.3, glassRough: 0.05, glassMetal: 0.85, reveal: 1.0 },
];
FAMILY_SPECS.push(...NEW_FAMILY_SPECS);

// the new families' other elevations: each still its period's own
Object.assign(VARIANTS, {
  castiron: [
    { wall: castIronWall([236, 232, 222]), winStyle: "arch" },
    { wall: castIronWall([120, 128, 118]), frameCol: "#e8e2d4" },
    { wall: castIronWall([196, 178, 150]), winStyle: "rect", mullions: [2, 3] },
    { wall: castIronWall([72, 74, 76]), winStyle: "arch", frameCol: "#d8d0c0" },
    { wall: castIronWall([226, 214, 186]), winStyle: "pair" },
  ],
  romanesque: [
    { wall: rockFaced([126, 92, 72]), trim: "#5a3e30", winStyle: "pair" },
    { wall: rockFaced([150, 146, 138], 20), trim: "#7a7670", frameCol: "#1e1e1e" },
    { wall: rockFaced([186, 160, 120]), trim: "#8a6a4a" },
    { wall: rockFaced([120, 58, 46]), winStyle: "segment", mullions: [2, 2] },
    { wall: rockFaced([168, 112, 84], 16), winStyle: "pair", trim: "#e0d0b4" },
  ],
  terracotta: [
    { wall: terracottaWall([232, 222, 196], [196, 172, 136]) },
    { wall: terracottaWall([214, 216, 210], [168, 176, 170]), frameCol: "#2a2e30" },
    { wall: terracottaWall([226, 198, 160], [180, 120, 86]), frameCol: "#3a2a20" },
    { wall: terracottaWall([196, 210, 196], [120, 150, 130]) },
    { wall: terracottaWall([240, 236, 228], [70, 96, 120]), winStyle: "triple" },
  ],
  gothic: [
    { wall: polyBrick([176, 92, 64], [214, 196, 160], [60, 46, 40]), trim: "#2e2a26", frameCol: "#2a2a2a" },
    { wall: polyBrick([140, 64, 50], [190, 170, 130], [190, 170, 130]), winStyle: "arch" },
    { wall: polyBrick([196, 160, 116], [120, 56, 44], [70, 52, 44]), trim: "#7a3a2a" },
    { wall: polyBrick([150, 80, 60], [52, 40, 36], [52, 40, 36]), winStyle: "segment", trim: "#e6d8bc" },
  ],
  stucco: [
    { winStyle: "arch", wall: stuccoWall([234, 214, 176]) },
    { shutter: "#2f4a3a", wall: stuccoWall([240, 232, 214]) },
    { winStyle: "pair", wall: stuccoWall([226, 200, 168]), frameCol: "#2a2a2a" },
    { win: { x0: 0.18, x1: 0.82, y0: 0.3, y1: 0.78 }, mullions: [3, 2], wall: stuccoWall([236, 224, 196]) },
    { winStyle: "arch", shutter: "#4a3226", wall: stuccoWall([220, 186, 150]) },
    { lintel: "hood", trim: "#ece2cc", wall: stuccoWall([214, 196, 170]) },
  ],
  georgian: [
    { shutter: "#22302a", wall: flemishWall([150, 64, 50], [80, 40, 34]) },
    { lintel: "flat", trim: "#efe9dc", wall: flemishWall([176, 96, 66], [110, 58, 44]) },
    { winStyle: "arch", wall: flemishWall([140, 60, 48], [70, 36, 32]) },
    { lintel: "pediment", shutter: "#1e1e1e", wall: flemishWall([166, 82, 58], [96, 50, 40]) },
    { lintel: "keystone", wall: flemishWall([196, 150, 110], [130, 96, 70]), trim: "#f2ede2" },
  ],
  tudor: [
    { wall: tudorWall([228, 214, 186], [52, 38, 30]) },
    { wall: tudorWall([238, 234, 222], [30, 30, 32]), winStyle: "pair" },
    { wall: tudorWall([214, 196, 160], [80, 54, 36]), mullions: [3, 4] },
  ],
  whitebrick: [
    { wall: glazedBrick([222, 222, 216]), frameCol: "#2a2c2e" },
    { wall: glazedBrick([232, 220, 196]), mullions: [2, 2] },
    { wall: glazedBrick([206, 196, 182]), win: { x0: 0.1, x1: 0.9, y0: 0.26, y1: 0.82 } },
    { wall: glazedBrick([214, 184, 160]), frameCol: "#3a3a36" },
    { wall: glazedBrick([196, 200, 202]), mullions: [4, 2] },
  ],
  brutalist: [
    { wall: boardFormed([160, 156, 148]), win: { x0: 0.2, x1: 0.8, y0: 0.28, y1: 0.82 } },
    { wall: boardFormed([196, 188, 172]), mullions: [2, 1] },
    { wall: boardFormed([150, 148, 146]), win: { x0: 0.22, x1: 0.78, y0: 0.14, y1: 0.9 } },
    { wall: boardFormed([186, 176, 158]), winStyle: "pair" },
  ],
  midcentury: [
    { wall: enamelPanel([200, 202, 204], [212, 122, 52]) },
    { wall: enamelPanel([180, 184, 186], [46, 72, 120]) },
    { wall: enamelPanel([210, 210, 206], [222, 196, 92]) },
    { wall: enamelPanel([60, 62, 64], [236, 236, 230]), frameCol: "#2a2c2e" },
    { wall: enamelPanel([196, 200, 202], [160, 56, 46]) },
  ],
  fibercement: [
    { wall: fiberCement([62, 64, 66], [176, 116, 70], 1) },
    { wall: fiberCement([196, 192, 184], [94, 112, 128], 2) },
    { wall: fiberCement([232, 230, 224], [150, 72, 50], 0), winJitter: 0.2 },
    { wall: fiberCement([120, 126, 118], [226, 222, 214], 1) },
    { wall: fiberCement([210, 200, 180], [58, 60, 62], 2), win: { x0: 0.14, x1: 0.86, y0: 0.2, y1: 0.84 } },
    { wall: fiberCement([86, 96, 108], [210, 196, 160], 0) },
  ],
  metalpanel: [
    { wall: metalSeam([70, 72, 74]), frameCol: "#1a1a1a" },
    { wall: metalSeam([196, 186, 160], 16), winJitter: 0.24 },
    { wall: metalSeam([120, 86, 64]), frameCol: "#2a2622" },
    { wall: metalSeam([214, 216, 214], 10), glassCol: "#506a78" },
    { wall: metalSeam([96, 112, 104], 14) },
  ],
  rainscreen: [
    { wall: baguette([206, 170, 120]) },
    { wall: baguette([150, 146, 140]), frameCol: "#1e1e1e" },
    { wall: baguette([200, 120, 80]), win: { x0: 0.2, x1: 0.8, y0: 0.12, y1: 0.88 } },
    { wall: baguette([226, 214, 190]), glassCol: "#4a6474" },
  ],
  newstone: [
    { wall: ashlarFine([214, 200, 174]), lintel: "keystone", trim: "#ece4d0" },
    { wall: ashlarFine([232, 226, 212]), winStyle: "pair" },
    { wall: ashlarFine([190, 176, 156]), trim: "#d8ccb4", mullions: [2, 3] },
    { wall: ashlarFine([204, 196, 186]), winStyle: "arch", frameCol: "#2a2e30" },
  ],
  stackbrick: [
    { wall: stackBond([220, 218, 210], "#9a988f") },
    { wall: stackBond([150, 74, 56], "#6a625a"), frameCol: "#2a2a2a" },
    { wall: stackBond([120, 118, 112]) },
    { wall: stackBond([186, 168, 140], "#8a8070"), mullions: [3, 2] },
    { wall: stackBond([42, 40, 40], "#4a4846") },
  ],
  daylight: [
    { wall: concreteFrame([180, 176, 168]), frameCol: "#24282a" },
    { wall: concreteFrame([206, 196, 176]), mullions: [5, 4], frameCol: "#5a2e22" },
    { wall: concreteFrame([170, 166, 160]), mullions: [8, 5] },
  ],
  moderne: [
    { wall: moderneWall([242, 240, 232]) },
    { wall: moderneWall([238, 214, 196]), frameCol: "#2a2a2a" },
    { wall: moderneWall([214, 228, 214]) },
    { wall: moderneWall([226, 204, 160]), win: { x0: 0.04, x1: 0.96, y0: 0.32, y1: 0.66 } },
  ],
  timber: [
    { wall: woodSlat([186, 146, 98]) },
    { wall: woodSlat([120, 88, 60]), frameCol: "#1e1e1e" },
    { wall: woodSlat([150, 140, 128]) },
  ],
  rustic: [
    { wall: rusticWall([176, 168, 156]) },
    { wall: rusticWall([150, 96, 76]) },
    { wall: rusticWall([214, 206, 190]), winStyle: "rect", mullions: [2, 2] },
  ],
  diagrid: [
    { wall: tintedGlassWall("#22303a"), over: diagridOver([220, 222, 224]), glassCol: "#5f8aa2" },
    { wall: tintedGlassWall("#2a3a34"), over: diagridOver([60, 64, 68]), glassCol: "#6aa094" },
    { wall: tintedGlassWall("#3e464c"), over: diagridOver([190, 196, 200]), glassCol: "#b4c4d0" },
  ],
  pixel: [
    { over: pixelOver([200, 204, 206], 11), glassCol: "#6e8ea0" },
    { over: pixelOver([62, 66, 70], 23), glassCol: "#90aab8", wall: tintedGlassWall("#2a3238") },
    { over: pixelOver([214, 196, 160], 31), glassCol: "#7a9aa8" },
    { over: pixelOver([170, 196, 204], 5), glassCol: "#a0bcc8" },
  ],
} as Record<string, Partial<FamilySpec>[]>);

// THE SKYLINE'S OTHER GLASS. Four elevations a tower family were too few for
// a downtown of curtain walls: three more each, from the same catalogues of
// tint, frame and spandrel the period actually sold.
const MORE_TOWER_VARIANTS: Record<string, Partial<FamilySpec>[]> = {
  glass: [
    { wall: tintedGlassWall("#1e2a30"), glassCol: "#4e7286", frameCol: "#1e2226", mullions: [1, 2] },
    { wall: tintedGlassWall("#56606a"), glassCol: "#a8bccb", frameCol: "#c8ced2" },
    { wall: tintedGlassWall("#2f3e46"), glassCol: "#7aa0b4", win: { x0: 0.08, x1: 0.92, y0: 0.24, y1: 0.98 } },
  ],
  blueglass: [
    { wall: tintedGlassWall("#1c3a56"), glassCol: "#3e7aa8", frameCol: "#2a3a4a" },
    { wall: tintedGlassWall("#2a4e58"), glassCol: "#5ea0a8", frameCol: "#d0d6da" },
    { wall: tintedGlassWall("#34485e"), glassCol: "#8ab0d0", mullions: [1, 2] },
  ],
  greenglass: [
    { wall: tintedGlassWall("#123830"), glassCol: "#2e7a68", frameCol: "#1a2a26" },
    { wall: tintedGlassWall("#2a5048"), glassCol: "#86c0b0", frameCol: "#c8d4d0" },
    { wall: tintedGlassWall("#244038"), glassCol: "#5a9888", mullions: [1, 2] },
  ],
  silverglass: [
    { wall: tintedGlassWall("#3a4048"), glassCol: "#98a6b2", frameCol: "#5a646c" },
    { wall: tintedGlassWall("#6a6660"), glassCol: "#d4ccbe", frameCol: "#d8d4cc" },
    { wall: tintedGlassWall("#545c66"), glassCol: "#c0ccd8", mullions: [1, 2] },
  ],
  bronze: [
    { wall: tintedGlassWall("#3a2a1e"), glassCol: "#9a7656", frameCol: "#5a4028" },
    { wall: tintedGlassWall("#2e2824"), glassCol: "#7a6650", frameCol: "#1e1a16", mullions: [1, 2] },
    { wall: tintedGlassWall("#463626"), glassCol: "#a88a66", frameCol: "#3a2a1a" },
  ],
  blackglass: [
    { wall: tintedGlassWall("#0e1012"), glassCol: "#26292e", frameCol: "#3a3026", mullions: [1, 2] },
    { wall: tintedGlassWall("#16181e"), glassCol: "#2e3440", frameCol: "#4a4a4e" },
    { wall: tintedGlassWall("#1a1612"), glassCol: "#3a332a", frameCol: "#6a5236" },
  ],
  fins: [
    { wall: panelWall("#b8a890"), glassCol: "#5a6e78", frameCol: "#a89474" },
    { wall: panelWall("#4a5a52"), glassCol: "#6a8a84", frameCol: "#3a4a42" },
    { wall: panelWall("#d8d4cc"), glassCol: "#7690a0", frameCol: "#e0ddd6", win: { x0: 0.24, x1: 0.76, y0: 0.06, y1: 0.99 } },
  ],
  pomo: [
    { wall: stoneWallC([176, 120, 104], 24), glassCol: "#2a3e48", trim: "#e8dcc8", winStyle: "pair" },
    { wall: stoneWallC([200, 190, 170], 24), glassCol: "#3a4e5a", trim: "#5a4a3a", lintel: "pediment" },
    { wall: stoneWallC([120, 124, 126], 24), glassCol: "#4a5e6a", trim: "#d8d4ce", winStyle: "arch" },
  ],
  ribbon: [
    { wall: panelWall("#3e5a6e"), glassCol: "#2a3a44", frameCol: "#c8ccd0" },
    { wall: panelWall("#e8e6de"), glassCol: "#3a4e5a", win: { x0: 0.0, x1: 1.0, y0: 0.36, y1: 0.92 } },
    { wall: panelWall("#6a7a70"), glassCol: "#2e3a36", frameCol: "#2a2e2c" },
  ],
  deco: [
    { wall: decoWallC("#d6ccb8", "#2e3e36", "#e6decc") },
    { wall: decoWallC("#bfb6a6", "#3a2e28", "#d4ccbe"), glassCol: "#2e3a40" },
    { wall: decoWallC("#e0d8c4", "#56402e", "#ece6d6") },
  ],
  decobrick: [
    { wall: brickWall([176, 130, 96]), trim: "#d8ccb4" },
    { wall: brickWall([120, 70, 56]), trim: "#c8b89c" },
    { wall: brickWall([214, 196, 166]), trim: "#5a4636" },
  ],
  stone: [
    { wall: stoneWallC([200, 188, 160]), lintel: "keystone", trim: "#efe8d8" },
    { wall: stoneWallC([170, 166, 160], 24), lintel: "hood", trim: "#e0dcd4", frameCol: "#2a2e30" },
  ],
  brick: [
    { wall: brickWall([156, 78, 58]), lintel: "hood", trim: "#d8ccb4" },
    { wall: brickWall([134, 70, 54]), lintel: "keystone", trim: "#e8e0cc", frameCol: "#f0ece2" },
  ],
  buff: [
    { wall: brickWall([214, 190, 140]), lintel: "hood", trim: "#6e4a32" },
    { wall: brickWall([190, 176, 150]), lintel: "keystone", trim: "#f0e8d6" },
  ],
  brownstone: [
    { wall: brownWallC([134, 92, 72]), lintel: "hood", trim: "#5a3e30" },
  ],
};
for (const [k, v] of Object.entries(MORE_TOWER_VARIANTS)) VARIANTS[k] = [...(VARIANTS[k] ?? []), ...v];

// per-building tints for the new families (the paint scheme does the rest)
Object.assign(TINTS, {
  castiron: [[1, 1, 1]], romanesque: [[1, 1, 1], [0.92, 0.9, 0.9], [1.04, 1.0, 0.96]],
  terracotta: [[1, 1, 1], [0.96, 0.95, 0.92], [1.02, 1.0, 0.96]], gothic: [[1, 1, 1], [0.9, 0.86, 0.84], [1.04, 0.98, 0.94]],
  stucco: [[1, 1, 1]], georgian: [[1, 1, 1], [0.9, 0.86, 0.84], [1.05, 0.98, 0.92]], tudor: [[1, 1, 1]],
  whitebrick: [[1, 1, 1], [0.96, 0.96, 0.94], [0.92, 0.92, 0.9]], brutalist: [[1, 1, 1], [0.94, 0.94, 0.92], [0.88, 0.88, 0.86], [1.04, 1.02, 0.98]],
  midcentury: [[1, 1, 1]], fibercement: [[1, 1, 1]], metalpanel: [[1, 1, 1]], rainscreen: [[1, 1, 1], [0.94, 0.92, 0.9]],
  newstone: [[1, 1, 1], [0.97, 0.95, 0.92], [1.02, 1.0, 0.97]], stackbrick: [[1, 1, 1], [0.92, 0.92, 0.92]],
  daylight: [[1, 1, 1], [0.94, 0.94, 0.92]], moderne: [[1, 1, 1]], timber: [[1, 1, 1], [0.9, 0.88, 0.86]],
  rustic: [[1, 1, 1]], diagrid: [[1, 1, 1], [0.9, 0.94, 1.0]], pixel: [[1, 1, 1], [0.92, 0.96, 1.0]],
} as Record<string, [number, number, number][]>);

// ============================================================================
// THE PAINT SCHEMES. What a building is turned out in: its wall paint (if it
// is painted at all), its trim and its accent — sash, frames, shutters,
// spandrels, cast iron. Palettes are the period's own: the historic house
// colours of a timber street, the cream-and-black of painted brick, the
// porcelain-enamel spandrels of 1955, the zinc and rust of 2015. A district
// still shares a batch of brick (TINTS); the paint is each owner's choice.
// ============================================================================

/** One building's paint, linear RGB: wall rgb + how much of it is painted, trim, accent (r < 0: as drawn). */
export interface Livery { wall: number[]; trim: number[]; accent: number[]; key: string }
export const NO_PAINT: Livery = { wall: [1, 1, 1, 0], trim: [-1, 0, 0], accent: [-1, 0, 0], key: "-" };

interface Palette {
  /** chance the wall field is painted, and the paints */
  paintP: number; walls: string[];
  /** chance the trim is repainted, and the colours */
  trimP: number; trims: string[];
  /** chance the accent is repainted, and the colours */
  accP: number; accents: string[];
}
const P = (paintP: number, walls: string[], trimP: number, trims: string[], accP: number, accents: string[]): Palette => ({ paintP, walls, trimP, trims, accP, accents });

// the paints, by name, so the palettes read as what they are
const WHITE = "#f1ede4", CREAM = "#e8dcc2", IVORY = "#efe6d0", BUTTER = "#efd68e", SAGE = "#b8c6a4", SLATE = "#7d8e9c",
  POWDER = "#a9c2d2", GREY = "#9a9c98", PEWTER = "#6c7072", CHARCOAL = "#3a3c3e", BLACK = "#222324", BARN = "#8e3b2e",
  OXBLOOD = "#5c2622", FOREST = "#2f4a3a", HUNTER = "#3d5a40", NAVY = "#25324a", TAN = "#c4ad88", OCHRE = "#d2a65a",
  SALMON = "#e0a68a", PINK = "#e6c0b8", LILAC = "#c4b6d0", TEAL = "#4f7f7c", MUSTARD = "#c99a3a", OLIVE = "#6e7048",
  BROWN = "#5a3e2c", STONE = "#d6ccb6", TERRA = "#b8664a", RUST = "#94502e", ZINC = "#8c9298", BRONZE = "#5a4630",
  SILVER = "#c4c8cc", CHAMPAGNE = "#c8b694", TURQ = "#4fa3a0", ORANGE = "#d47a34", SKY = "#7aa6c8", MINT = "#cfe2cc";

const SASH_OLD = [BLACK, WHITE, FOREST, OXBLOOD, NAVY, BROWN, HUNTER, CHARCOAL];
const TRIM_OLD = [WHITE, CREAM, IVORY, BLACK, FOREST, OXBLOOD, STONE, GREY];
const MULLION = [SILVER, CHARCOAL, BLACK, BRONZE, WHITE, ZINC, CHAMPAGNE];

const PALETTES: Record<string, Palette> = {
  // pre-war masonry: mostly raw, sometimes painted, the sash nearly always repainted
  brick: P(0.16, [WHITE, CREAM, GREY, BLACK, OXBLOOD, FOREST, TAN, SLATE, PEWTER, IVORY], 0.5, TRIM_OLD, 0.75, SASH_OLD),
  buff: P(0.07, [WHITE, CREAM, GREY, IVORY], 0.45, TRIM_OLD, 0.7, SASH_OLD),
  brownstone: P(0.03, [GREY, PEWTER], 0.3, [BROWN, "#6b4a3a", CREAM, BLACK], 0.8, [BLACK, OXBLOOD, FOREST, BROWN, CREAM, NAVY]),
  stone: P(0, [], 0.1, [STONE, CREAM], 0.7, [BLACK, BRONZE, FOREST, CHARCOAL, WHITE]),
  georgian: P(0.1, [WHITE, CREAM, GREY], 0.25, [WHITE, IVORY, CREAM], 0.8, [BLACK, FOREST, WHITE, NAVY, OXBLOOD, HUNTER]),
  gothic: P(0.04, [GREY, CREAM], 0.4, [CREAM, BLACK, STONE, OXBLOOD], 0.7, SASH_OLD),
  romanesque: P(0, [], 0.2, [BROWN, STONE], 0.75, [BLACK, BRONZE, FOREST, OXBLOOD, BROWN]),
  castiron: P(0.85, [WHITE, CREAM, IVORY, STONE, GREY, PEWTER, FOREST, BLACK, TAN, SAGE, CHARCOAL], 0, [], 0.7, [BLACK, WHITE, FOREST, OXBLOOD, CHARCOAL, BRONZE]),
  terracotta: P(0, [], 0.45, [CREAM, STONE, "#b8c8b8", "#c89a7a", SKY, IVORY], 0.7, [BLACK, BRONZE, CHARCOAL, FOREST, WHITE]),
  decobrick: P(0.03, [CREAM], 0.4, [STONE, CREAM, "#7a6a58"], 0.7, [BLACK, BRONZE, FOREST, CHARCOAL]),
  deco: P(0, [], 0, [], 0.85, [FOREST, BRONZE, BLACK, "#3a4a56", OXBLOOD, "#5a4a3a", CHARCOAL, TEAL]),
  industrial: P(0.18, [WHITE, CREAM, GREY, PEWTER, "#6e3b2e", TAN, CHARCOAL], 0.25, [WHITE, CREAM, BLACK, GREY], 0.8, [BLACK, FOREST, "#5a2e22", "#4a5560", WHITE, CHARCOAL, HUNTER]),
  daylight: P(0.3, [WHITE, CREAM, "#c8c2b4", GREY], 0, [], 0.8, [BLACK, FOREST, "#5a2e22", "#4a5560", CHARCOAL, HUNTER]),
  rustic: P(0, [], 0, [], 0.7, [BLACK, BRONZE, FOREST]),
  // timber: always painted, in the historic house colours
  clapboard: P(1, [WHITE, CREAM, BUTTER, SAGE, POWDER, SLATE, GREY, BARN, HUNTER, TAN, PINK, LILAC, TEAL, IVORY, OCHRE, "#d9d2c0", "#a8b8a0", "#c8a890"],
    0.8, [WHITE, IVORY, CREAM, CHARCOAL, FOREST, OXBLOOD], 0.85, [BLACK, FOREST, OXBLOOD, NAVY, WHITE, BARN, HUNTER, CHARCOAL, MUSTARD, TEAL]),
  stucco: P(1, [WHITE, CREAM, IVORY, "#ead6b0", "#e3c49a", SALMON, PINK, "#f3e7c9", "#cbbf9e", OCHRE, "#e0b48c", MINT, "#d8c8b4"],
    0.4, [WHITE, CREAM, TERRA, BROWN], 0.85, [FOREST, BROWN, BLACK, TEAL, NAVY, OXBLOOD, "#2a5a6a", WHITE]),
  tudor: P(1, [IVORY, CREAM, WHITE, "#e6d8b8", "#d8ccb0"], 0, [], 0.9, [BROWN, BLACK, "#3a2a20", OXBLOOD, "#4a3a2a"]),
  moderne: P(1, [WHITE, IVORY, CREAM, PINK, MINT, "#e8dcc0", POWDER, "#f0e0c8"], 0.6, [WHITE, CHARCOAL, TEAL, "#3a6a8a", OXBLOOD], 0.6, [CHARCOAL, SILVER, BLACK, TEAL]),
  // post-war
  whitebrick: P(0.05, [CREAM, GREY], 0, [], 0.65, [CHARCOAL, SILVER, BLACK, BRONZE, WHITE]),
  modern: P(0.45, [WHITE, CREAM, TAN, GREY, TERRA, SAGE, MUSTARD, POWDER, "#c99c84", STONE, PEWTER], 0, [], 0.6, [CHARCOAL, SILVER, BRONZE, BLACK, WHITE]),
  precast: P(0.35, [WHITE, "#e2d6c4", "#d6c2b4", "#c8ccc8", "#d9cdb0", STONE], 0, [], 0.55, [CHARCOAL, SILVER, BRONZE, "#2a3e4a"]),
  grid: P(0.15, ["#b9b4aa", "#cfc8bb", "#a59f95", CREAM], 0, [], 0.55, [CHARCOAL, BLACK, BRONZE, SILVER]),
  brutalist: P(0, [], 0, [], 0.5, [CHARCOAL, BRONZE, BLACK, "#4a3a2a"]),
  midcentury: P(0.3, [SILVER, WHITE, CHARCOAL, CHAMPAGNE], 0, [], 0.9, [TURQ, ORANGE, MUSTARD, "#3e5a90", "#b84a3a", WHITE, CHARCOAL, "#5a9a6a", SKY, "#d8c060"]),
  ribbon: P(0.5, [WHITE, "#8a929a", CHARCOAL, "#3c5a6e", "#6e8a7a", "#b8a27a", "#a03c2c", SILVER, "#2e4a5a"], 0, [], 0.5, MULLION),
  pomo: P(0.3, ["#c49a8e", "#9aa49a", "#d8c8b0", "#a8786a", "#c8b8a8", "#b0a090"], 0.4, [CREAM, STONE, "#e8d8d0", CHARCOAL], 0.5, [CHARCOAL, "#2c4a44", OXBLOOD, BRONZE]),
  // glass: the spandrel and the mullion
  glass: P(0.4, ["#2a3540", "#3d4a52", "#4a5058", "#22303a", "#30403a", "#5a646b", "#1e262c"], 0, [], 0.6, MULLION),
  blueglass: P(0.15, ["#244a64", "#2e4c5b", "#34485e"], 0, [], 0.5, MULLION),
  greenglass: P(0.15, ["#1a4440", "#1d3a33", "#2a4a40"], 0, [], 0.5, MULLION),
  silverglass: P(0.15, ["#5a6168", "#4a5058", "#6a6e72"], 0, [], 0.5, MULLION),
  bronze: P(0.1, ["#3e3229", "#2a1f18"], 0, [], 0.5, [BRONZE, BLACK, CHARCOAL, "#7a5a38"]),
  blackglass: P(0, [], 0, [], 0.5, [BRONZE, BLACK, "#5a4a32", CHARCOAL]),
  fins: P(0.5, ["#cdd1d4", "#2e3236", "#8a6a4a", "#f0efe9", "#5a6168", "#b08a5a", "#6a7a72"], 0, [], 0.5, MULLION),
  diagrid: P(0.2, ["#2e3e48", "#22303a", "#3a4a54"], 0, [], 0.7, [SILVER, WHITE, CHARCOAL, ZINC, BLACK]),
  pixel: P(0.2, ["#3a4a54", "#2a3238", "#46545e"], 0, [], 0.8, [WHITE, "#d8dcde", CHARCOAL, "#b8a888", "#a8c4cc", ZINC, "#8a9aa4"]),
  // the new century
  fibercement: P(0.8, [WHITE, "#e9e7e1", CHARCOAL, "#b8b2a6", "#5c6b78", "#d8d0c0", "#a8a49c", PEWTER, "#c8c0b0"],
    0, [], 1.0, [RUST, "#c8a46a", CHARCOAL, "#5c6b78", "#7a8a74", TERRA, "#d4b06a", BLACK, WHITE, "#3e6a8a", OLIVE, "#b05a3a"]),
  metalpanel: P(0.7, [ZINC, CHARCOAL, CHAMPAGNE, WHITE, "#7a5a44", "#5a6a62", SILVER, BLACK, "#a87a5a"], 0, [], 0.4, [BLACK, CHARCOAL, SILVER]),
  rainscreen: P(0.35, [TERRA, "#c88a5a", "#d8c098", GREY, CREAM, "#8a4a3a"], 0, [], 0.5, [BLACK, CHARCOAL, BRONZE]),
  newstone: P(0, [], 0.25, [CREAM, STONE, IVORY], 0.7, [CHARCOAL, BRONZE, BLACK, "#3a4a44"]),
  stackbrick: P(0.1, [WHITE, CHARCOAL, BLACK], 0, [], 0.6, [BLACK, CHARCOAL, BRONZE, "#3a4a44"]),
  timber: P(0.15, [CHARCOAL, "#4a3a2e"], 0, [], 0.5, [BLACK, CHARCOAL, BRONZE]),
};

const lin = (hex: string): number[] => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
};
const h01 = (n: number, salt: number) => { let x = Math.imul((n ^ (salt * 0x9e3779b9)) >>> 0, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; };

/**
 * One building's paint scheme, stable per deed (seedK) and family. Two
 * colours never clash by accident: a painted wall never takes its own colour
 * for trim, and dark walls take light trim (and the reverse) where the
 * palette offers it — what a painter choosing a scheme does.
 */
export function liveryFor(fam: string, seedK: number): Livery {
  const p = PALETTES[fam.split("#")[0]];
  if (!p) return NO_PAINT;
  const r = (salt: number) => h01(seedK, salt);
  const lumOf = (hex: string) => { const c = lin(hex); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  let wall = NO_PAINT.wall, wallHex = "";
  if (p.walls.length && r(0xa1) < p.paintP) {
    wallHex = p.walls[Math.floor(r(0xa2) * p.walls.length)];
    // paint is opaque, but a few old coats have worn thin on old brick
    const amt = fam.startsWith("brick") || fam.startsWith("industrial") ? 0.82 + 0.18 * r(0xa3) : 1;
    wall = [...lin(wallHex), amt];
  }
  const choose = (list: string[], salt: number) => {
    let c = list[Math.floor(r(salt) * list.length)];
    if (wallHex) {
      // contrast with a painted wall: retry once toward the other end of the scale
      const wl = lumOf(wallHex);
      if (c === wallHex || Math.abs(lumOf(c) - wl) < 0.08) c = list.reduce((best, x) => Math.abs(lumOf(x) - wl) > Math.abs(lumOf(best) - wl) ? x : best, c);
    }
    return c;
  };
  const trimHex = p.trims.length && r(0xb1) < p.trimP ? choose(p.trims, 0xb2) : "";
  const accHex = p.accents.length && r(0xc1) < p.accP ? choose(p.accents, 0xc2) : "";
  return {
    wall, trim: trimHex ? lin(trimHex) : NO_PAINT.trim, accent: accHex ? lin(accHex) : NO_PAINT.accent,
    key: `${wallHex || "-"}/${trimHex || "-"}/${accHex || "-"}`,
  };
}

// ---- what a front carries, by family (looks only) -------------------------
/** Chance a front of this family stands on a rusticated stone ground storey. */
export const RUSTIC_BASE: Record<string, number> = { stone: 0.7, newstone: 0.6, terracotta: 0.45, romanesque: 0.6, deco: 0.35, decobrick: 0.25, georgian: 0.2 };
/** Chance a row of this family pushes canted bays out over the area. */
export const BAY_P: Record<string, number> = { brownstone: 0.55, brick: 0.28, romanesque: 0.5, georgian: 0.18, gothic: 0.3, clapboard: 0.35, buff: 0.2, stucco: 0.12 };
/** Chance a front of this family has dressed quoins at its corners. */
export const QUOIN_P: Record<string, number> = { georgian: 0.7, stone: 0.35, newstone: 0.4, brick: 0.12, buff: 0.14, romanesque: 0.25, gothic: 0.15, brownstone: 0.1 };
