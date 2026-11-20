/**
 * THE SMALL PARTS OF A WALL (graphics pass, Oct 2026: "go through each facade
 * type and make them more detailed"). The original families were a wall
 * texture with a window rectangle punched in it, and two families with the same
 * window proportion read alike whatever they were built of. What tells a
 * builder's wall from across the street is the joinery round the opening and
 * the lines that run along the floors, and every tradition does them its own
 * way:
 *
 * - the SILL — a stone slab with a drip shadow under masonry, a pressed-metal
 *   flashing on a panel wall, a painted wooden sill on clapboard, nothing on a
 *   flush wall;
 * - the HEAD — a soldier course of bricks stood on end over a brick opening, a
 *   steel lintel's dark line in a post-war wall, a shadow inside the head of
 *   any deep opening;
 * - the CASING — a timber house's windows are framed in boards;
 * - the FLOOR LINE — a projecting belt course on a stone front, a corbelled
 *   dentil band on a walk-up, the sealant joint between precast panels, the
 *   slab edge of a concrete frame;
 * - the PIER — fluting on a deco pier, rusticated V-joints on the base of a
 *   Beaux-Arts front, the shadow line where a brick pier meets its spandrel.
 *
 * Drawn into the texture (colour, paint mask, relief), so the far mips keep the
 * lines as value. Keyed by the original family; the later pattern-book
 * families paint their own and are left alone. Proportions by eye against
 * photographs of each type; looks only.
 */
import { TILE, shade, type FamilySpec } from "./facades";

type Sill = "stone" | "metal" | "wood" | "none";
type Head = "soldier" | "steel" | "none";
type Belt = "band" | "dentil" | "joint" | "slab" | "none";
export interface WallDetail { sill: Sill; head: Head; belt: Belt; casing?: boolean; flute?: boolean; rustic?: boolean }

export const DETAIL: Record<string, WallDetail> = {
  brick: { sill: "stone", head: "soldier", belt: "dentil" },
  buff: { sill: "stone", head: "soldier", belt: "band" },
  brownstone: { sill: "stone", head: "none", belt: "band" },
  stone: { sill: "stone", head: "none", belt: "band", rustic: true },
  deco: { sill: "metal", head: "none", belt: "none", flute: true },
  decobrick: { sill: "stone", head: "soldier", belt: "none", flute: true },
  industrial: { sill: "stone", head: "soldier", belt: "slab" },
  modern: { sill: "metal", head: "steel", belt: "joint" },
  ribbon: { sill: "metal", head: "none", belt: "joint" },
  grid: { sill: "none", head: "none", belt: "slab" },
  precast: { sill: "none", head: "none", belt: "joint" },
  pomo: { sill: "stone", head: "none", belt: "band" },
  clapboard: { sill: "wood", head: "none", belt: "none", casing: true },
  castiron: { sill: "metal", head: "none", belt: "band" },
  gothic: { sill: "stone", head: "none", belt: "band" },
  romanesque: { sill: "stone", head: "none", belt: "band", rustic: true },
  terracotta: { sill: "stone", head: "none", belt: "band" },
  daylight: { sill: "none", head: "none", belt: "slab" },
  georgian: { sill: "stone", head: "none", belt: "band" },
  tudor: { sill: "wood", head: "none", belt: "none", casing: true },
  stucco: { sill: "stone", head: "none", belt: "none" },
  moderne: { sill: "metal", head: "none", belt: "none" },
  whitebrick: { sill: "metal", head: "steel", belt: "slab" },
  midcentury: { sill: "metal", head: "none", belt: "joint" },
  brutalist: { sill: "none", head: "none", belt: "slab" },
  newstone: { sill: "stone", head: "none", belt: "band" },
  fibercement: { sill: "metal", head: "none", belt: "joint" },
  metalpanel: { sill: "metal", head: "none", belt: "joint" },
  stackbrick: { sill: "metal", head: "steel", belt: "none" },
  rainscreen: { sill: "metal", head: "none", belt: "joint" },
  timber: { sill: "metal", head: "none", belt: "none" },
};

/** The family's own detail, or null (glass, the pattern book's later pages, blank walls). */
export function detailOf(spec: FamilySpec): WallDetail | null {
  if (spec.glass || spec.noWin) return null;
  return DETAIL[spec.key.split(/[#@]/)[0]] ?? null;
}

/**
 * How deep a family's openings sit, in metres (the shader's uReveal): what a
 * window looks like from the side, the strongest far-off cue there is. From
 * the relief the family already declares — a 28 mm clapboard casing to the
 * half-metre of a board-formed concrete frame.
 */
export function revealDepth(spec: FamilySpec): number {
  if (spec.glass) return 0;
  return Math.max(0.05, Math.min(0.42, spec.reveal * 0.058 + (spec.masonry ? 0.05 : 0)));
}

type Ctx = CanvasRenderingContext2D;
const hex = (c: string): string => {
  if (c.startsWith("#")) return c;
  const m = c.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m ? "#" + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Number(x))).toString(16).padStart(2, "0")).join("") : "#808080";
};
/** The wall's own colour at a point, for the parts made of the wall's material. */
function wallAt(alb: Ctx, x: number, y: number): string {
  const d = alb.getImageData(Math.max(0, Math.min(255, x | 0)), Math.max(0, Math.min(255, y | 0)), 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}

/**
 * Paint the detail. Called after the wall is painted and BEFORE the windows,
 * for the parts the glass covers (belts, piers), and with `after` set once the
 * windows are in, for the parts that frame them (sills, heads, casings).
 */
export function paintDetail(spec: FamilySpec, d: WallDetail, alb: Ctx, msk: Ctx, hgt: Ctx, after: boolean): void {
  const T = TILE, W = T * 2;
  const win = spec.win;
  const trim = spec.trim ? hex(spec.trim) : null;
  const MK_TRIM = "rgb(0,255,0)";
  const wall = hex(wallAt(alb, 3, T * 0.04));
  if (!after) {
    for (let by = 0; by < 2; by++) {
      const oy = by * T, floor = oy + T;   // the floor line at the foot of the storey
      switch (d.belt) {
        case "band": {
          // a projecting stone course: lit top, shadow under
          const c = trim ?? shade(wall, 1.12);
          alb.fillStyle = c; alb.fillRect(0, floor - 7, W, 6);
          alb.fillStyle = "rgba(255,255,255,0.22)"; alb.fillRect(0, floor - 7, W, 1.5);
          alb.fillStyle = "rgba(0,0,0,0.28)"; alb.fillRect(0, floor - 1, W, 3);
          if (trim) { msk.fillStyle = MK_TRIM; msk.fillRect(0, floor - 7, W, 6); }
          hgt.fillStyle = "#ffffff"; hgt.fillRect(0, floor - 7, W, 6);
          break;
        }
        case "dentil": {
          // a corbelled brick band: a row of headers stepped out, each throwing a tooth of shadow
          alb.fillStyle = shade(wall, 1.06); alb.fillRect(0, floor - 9, W, 4);
          for (let x = 0; x < W; x += 8) {
            alb.fillStyle = shade(wall, 1.1); alb.fillRect(x, floor - 5, 4, 4);
            alb.fillStyle = "rgba(0,0,0,0.3)"; alb.fillRect(x + 4, floor - 5, 4, 4);
          }
          hgt.fillStyle = "#ffffff"; hgt.fillRect(0, floor - 9, W, 8);
          break;
        }
        case "joint": {
          // the sealant joint between panels: a dark hairline with a lit lip
          alb.fillStyle = "rgba(0,0,0,0.35)"; alb.fillRect(0, floor - 2, W, 2);
          alb.fillStyle = "rgba(255,255,255,0.18)"; alb.fillRect(0, floor, W, 1);
          for (let x = 0; x <= W; x += T) { alb.fillStyle = "rgba(0,0,0,0.25)"; alb.fillRect(x - 1, oy, 1.5, T); }
          hgt.fillStyle = "#9a9a9a"; hgt.fillRect(0, floor - 2, W, 2);
          break;
        }
        case "slab": {
          // the floor slab's edge, flush and a shade paler than the infill
          alb.fillStyle = shade(wall, 1.12); alb.fillRect(0, floor - 11, W, 11);
          alb.fillStyle = "rgba(0,0,0,0.22)"; alb.fillRect(0, floor - 12, W, 1.5);
          hgt.fillStyle = "#ffffff"; hgt.fillRect(0, floor - 11, W, 11);
          break;
        }
      }
      if (d.flute) {
        // fluted piers: the pier between bays carries vertical reeds
        for (let bx = 0; bx <= 2; bx++) {
          const cx = bx * T;
          for (let k = -3; k <= 3; k++) {
            const x = cx + k * 3;
            alb.fillStyle = k % 2 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"; alb.fillRect(x, oy, 1.5, T);
          }
        }
      }
      if (d.rustic && spec.key.includes("@") === false) {
        // V-jointed courses on the masonry between the windows
        for (let y = oy + 10; y < oy + T; y += 16) { alb.fillStyle = "rgba(0,0,0,0.16)"; alb.fillRect(0, y, W, 2); alb.fillStyle = "rgba(255,255,255,0.12)"; alb.fillRect(0, y + 2, W, 1); }
      }
    }
    return;
  }
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * T, oy = by * T;
    const x0 = ox + win.x0 * T, x1 = ox + win.x1 * T;
    const head = oy + (1 - win.y1) * T, sill = oy + (1 - win.y0) * T;
    const ww = x1 - x0;
    // the head's own shadow inside every deep opening: the glass under the lintel is in shade
    const dep = revealDepth(spec);
    if (dep > 0.08) {
      const g = alb.createLinearGradient(0, head, 0, head + 4 + dep * 30);
      g.addColorStop(0, `rgba(0,0,0,${Math.min(0.45, dep * 1.4)})`); g.addColorStop(1, "rgba(0,0,0,0)");
      alb.fillStyle = g; alb.fillRect(x0, head, ww, 4 + dep * 30);
    }
    if (d.casing) {
      // a board casing round the opening, in the trim's paint
      const c = trim ?? "#f2efe6";
      for (const [x, y, w, h] of [[x0 - 5, head - 6, ww + 10, 6], [x0 - 5, head, 5, sill - head], [x1, head, 5, sill - head]] as [number, number, number, number][]) {
        alb.fillStyle = c; alb.fillRect(x, y, w, h); msk.fillStyle = MK_TRIM; msk.fillRect(x, y, w, h);
        hgt.fillStyle = "#ffffff"; hgt.fillRect(x, y, w, h);
      }
      alb.fillStyle = "rgba(0,0,0,0.2)"; alb.fillRect(x1 + 5, head, 2, sill - head);
    }
    if (d.head === "soldier" && !spec.trim && spec.winStyle !== "arch" && spec.winStyle !== "segment") {
      // bricks on end over the opening
      for (let x = x0 - 3; x < x1 + 3; x += 4) {
        alb.fillStyle = shade(wall, 0.9 + ((x / 4) % 3) * 0.06); alb.fillRect(x, head - 10, 3.2, 9);
      }
      alb.fillStyle = "rgba(0,0,0,0.18)"; alb.fillRect(x0 - 3, head - 1, ww + 6, 1);
    } else if (d.head === "steel") {
      alb.fillStyle = "rgba(30,30,32,0.75)"; alb.fillRect(x0 - 4, head - 4, ww + 8, 4);
    }
    // the sill (where the family's own trim has not drawn one already)
    if (d.sill !== "none" && !spec.trim) {
      // a pale stone slab, the window frame's metal, or white-painted wood
      const col = d.sill === "stone" ? "#d8cfbd" : d.sill === "metal" ? hex(spec.frameCol) : "#efece4";
      const h = d.sill === "metal" ? 3 : 5;
      alb.fillStyle = col; alb.fillRect(x0 - 3, sill, ww + 6, h);
      alb.fillStyle = "rgba(255,255,255,0.28)"; alb.fillRect(x0 - 3, sill, ww + 6, 1);
      msk.fillStyle = d.sill === "metal" ? "rgb(0,0,255)" : MK_TRIM; msk.fillRect(x0 - 3, sill, ww + 6, h);
      hgt.fillStyle = "#ffffff"; hgt.fillRect(x0 - 3, sill, ww + 6, h);
    }
    if (d.sill !== "none") {
      // the drip: a soft shadow under the sill down the wall
      const g = alb.createLinearGradient(0, sill + 4, 0, sill + 14);
      g.addColorStop(0, "rgba(0,0,0,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
      alb.fillStyle = g; alb.fillRect(x0 - 2, sill + 4, ww + 4, 10);
    }
  }
}
