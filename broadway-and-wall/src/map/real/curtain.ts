/**
 * HOW A GLASS WALL IS HELD UP. The curtain-wall families used to differ only
 * by tint: every one was a full-bay pane over a plain spandrel, so a 1960s
 * stick wall, a 1980s mirror tower and a 1990s flush blue box read as the same
 * building in three colours. A real glass wall is a SYSTEM, and the system is
 * what you see from across the street before you see the colour:
 *
 * - **stick** — pressure-plate caps on every mullion and transom, the 1960s-
 *   today office default; a grid of proud aluminium lines.
 * - **band** — the 1970s-80s unitised wall: a deep opaque spandrel band at
 *   every floor between bright horizontal caps, joints only between units.
 *   Reads horizontal.
 * - **ssg** — four-sided structural silicone, the 1990s: no caps at all, the
 *   lites butt-jointed with a hairline of black silicone, the spandrel glass
 *   nearly the vision glass. Reads as one smooth sheet.
 * - **ibeam** — the 1958 dark tower: bronze I-beam mullions standing proud of
 *   every bay, each throwing a stripe of shadow. Reads vertical.
 * - **mirror** — the 1980s mirror tower: reflective glass on every face, the
 *   storey split into two equal lites so vision and spandrel cannot be told
 *   apart, light grey joints.
 * - **fin** — the 2000s blade: a deep aluminium fin on every mullion with a
 *   long shadow beside it.
 * - **frit** — ceramic dot frit fired onto the glass, dense at the head and
 *   spandrel and fading down the vision lite.
 *
 * Each family also says how its glass REFLECTS (the shader's uGlassP): the
 * reflectance face-on (a clear low-e lite ~0.1, a pyrolytic reflective coat
 * ~0.3, a true mirror ~0.6), how far the panes are set off true (oil-canning),
 * how much each pane's polish varies, and how strongly the coat tints what it
 * reflects (a bronze coat tints the sky bronze; a silver one barely at all).
 * Real coatings, by eye against photographs; looks only.
 */
import { TILE, shade, type FamilySpec } from "./facades";

export type CurtainKind = "stick" | "band" | "ssg" | "ibeam" | "mirror" | "fin" | "frit";
export interface CurtainSys {
  kind: CurtainKind;
  /** extra vertical lites per bay (1 = the bay is one lite) */
  lites?: number;
  /** a transom at this share of the vision lite's height, from its head (0 = none) */
  transom?: number;
  /** the cap's width in texels (a texel is ~1.2 cm on a 1.5 m bay) */
  cap?: number;
  /** spandrel colour; absent = the family's own wall */
  spand?: string;
  /** [reflectance face-on, oil-canning, per-pane polish spread, coat tint] */
  refl: [number, number, number, number];
}

/**
 * The systems, by family and elevation (index 0 is the family's own, 1-3 its
 * variants). An elevation without its own entry wears the family's.
 */
export const CURTAIN: Record<string, CurtainSys[]> = {
  glass: [
    { kind: "stick", cap: 5, transom: 0.72, refl: [0.26, 0.09, 0.03, 0.5] },
    { kind: "stick", cap: 6, lites: 2, refl: [0.22, 0.08, 0.04, 0.4] },
    { kind: "stick", cap: 4, transom: 0.5, refl: [0.34, 0.1, 0.02, 0.3] },
    { kind: "stick", cap: 5, lites: 2, transom: 0.7, refl: [0.24, 0.08, 0.03, 0.65] },
  ],
  bronze: [
    { kind: "band", cap: 7, refl: [0.32, 0.07, 0.02, 0.85] },
    { kind: "band", cap: 8, refl: [0.36, 0.06, 0.02, 0.9] },
    { kind: "band", cap: 6, lites: 2, refl: [0.3, 0.07, 0.02, 0.6] },
    { kind: "band", cap: 7, refl: [0.4, 0.06, 0.01, 0.5] },
  ],
  blueglass: [
    { kind: "ssg", refl: [0.3, 0.05, 0.02, 0.75] },
    { kind: "ssg", lites: 2, refl: [0.28, 0.05, 0.02, 0.85] },
    { kind: "ssg", transom: 0.5, refl: [0.3, 0.05, 0.02, 0.8] },
    { kind: "ssg", lites: 2, refl: [0.42, 0.06, 0.01, 0.45] },
  ],
  blackglass: [
    { kind: "ibeam", cap: 7, refl: [0.16, 0.04, 0.01, 0.35] },
    { kind: "ibeam", cap: 6, refl: [0.2, 0.04, 0.01, 0.2] },
    { kind: "ibeam", cap: 8, refl: [0.16, 0.04, 0.01, 0.5] },
    { kind: "ibeam", cap: 6, lites: 2, refl: [0.18, 0.04, 0.01, 0.45] },
  ],
  greenglass: [
    { kind: "band", cap: 5, lites: 2, transom: 0.3, refl: [0.26, 0.06, 0.02, 0.8] },
    { kind: "band", cap: 5, transom: 0.3, refl: [0.26, 0.06, 0.02, 0.9] },
    { kind: "ssg", lites: 2, refl: [0.24, 0.05, 0.02, 0.75] },
    { kind: "band", cap: 6, refl: [0.22, 0.06, 0.02, 0.9] },
  ],
  silverglass: [
    { kind: "mirror", refl: [0.62, 0.15, 0.01, 0.2] },
    { kind: "mirror", lites: 2, refl: [0.66, 0.16, 0.01, 0.15] },
    { kind: "mirror", refl: [0.58, 0.14, 0.01, 0.45] },
    { kind: "mirror", lites: 2, refl: [0.6, 0.15, 0.01, 0.35] },
  ],
  fins: [
    { kind: "fin", cap: 5, refl: [0.2, 0.05, 0.04, 0.5] },
    { kind: "fin", cap: 6, refl: [0.18, 0.05, 0.04, 0.5] },
    { kind: "fin", cap: 6, refl: [0.24, 0.05, 0.03, 0.6] },
    { kind: "fin", cap: 7, refl: [0.18, 0.05, 0.04, 0.4] },
  ],
  diagrid: [
    { kind: "stick", cap: 2, transom: 0.5, refl: [0.3, 0.06, 0.02, 0.55] },
  ],
  pixel: [
    { kind: "frit", cap: 3, refl: [0.16, 0.05, 0.08, 0.4] },
  ],
};

/** A family's reflection, whether or not it has a system drawn (book families derive one from their glass). */
export function curtainOf(spec: FamilySpec): CurtainSys | null {
  if (!spec.glass || spec.noWin) return null;
  const [base, v] = spec.key.split("@")[0].split("#");
  const list = CURTAIN[base];
  if (list) return list[Math.min(list.length - 1, Number(v ?? 0) || 0)] ?? list[0];
  return null;
}
/** The shader's uGlassP for a family: a drawn system's, else one derived from its glass. */
export function glassReflOf(spec: FamilySpec): [number, number, number, number] {
  const c = curtainOf(spec);
  if (c) return c.refl;
  if (spec.glass) return [0.12 + 0.4 * spec.glassMetal * spec.glassMetal, 0.07, 0.02, 0.6];
  // the glass of a ribbon window or a modern panel: a clear lite, not a coat
  if (spec.key.startsWith("ribbon")) return [0.18, 0.05, 0.03, 0.5];
  return [0, 0, 0, 0];
}

type Ctx = CanvasRenderingContext2D;
/**
 * Draw a family's system over its glass (buildFamily, after the panes and
 * before `over`). `alb` colour, `msk` paint mask (blue: the accent the
 * owner's livery paints), `hgt` relief (white is proud), `orm` the material
 * (R pane, G roughness, B metal).
 */
export function paintCurtain(spec: FamilySpec, sys: CurtainSys, alb: Ctx, msk: Ctx, hgt: Ctx, orm: Ctx): void {
  const T = TILE, W = T * 2;
  const win = spec.win;
  const cap = sys.cap ?? 4, lites = Math.max(1, sys.lites ?? 1);
  const capCol = spec.frameCol;
  const ACC = "rgb(0,0,255)";
  // the caps are anodised aluminium: fairly rough, half metal; not glass
  const ormCap = "rgb(0,120,150)";
  const both = (x: number, y: number, w: number, h: number, col: string, proud = true) => {
    alb.fillStyle = col; alb.fillRect(x, y, w, h);
    msk.fillStyle = ACC; msk.fillRect(x, y, w, h);
    orm.fillStyle = ormCap; orm.fillRect(x, y, w, h);
    if (proud) { hgt.fillStyle = "#ffffff"; hgt.fillRect(x, y, w, h); }
  };
  // a vertical cap, with its lit edge and the shadow it throws on the glass
  const vcap = (x: number, y0: number, y1: number, w: number, shadow: number) => {
    // the shadow first (it falls on the glass), then the cap over it
    if (shadow > 0) {
      const g = alb.createLinearGradient(x + w / 2, 0, x + w / 2 + shadow, 0);
      g.addColorStop(0, "rgba(0,0,0,0.38)"); g.addColorStop(1, "rgba(0,0,0,0)");
      alb.fillStyle = g; alb.fillRect(x + w / 2, y0, shadow, y1 - y0);
    }
    both(x - w / 2, y0, w, y1 - y0, capCol);
    alb.fillStyle = shade(hex(capCol), 1.35); alb.fillRect(x - w / 2, y0, Math.max(1, w * 0.25), y1 - y0);
    alb.fillStyle = shade(hex(capCol), 0.7); alb.fillRect(x + w / 2 - Math.max(1, w * 0.2), y0, Math.max(1, w * 0.2), y1 - y0);
  };
  const hcap = (y: number, w: number, x0 = 0, x1 = W) => {
    both(x0, y - w / 2, x1 - x0, w, capCol);
    alb.fillStyle = shade(hex(capCol), 1.3); alb.fillRect(x0, y - w / 2, x1 - x0, Math.max(1, w * 0.3));
    // the cap's drip shadow on the glass under it
    const g = alb.createLinearGradient(0, y + w / 2, 0, y + w / 2 + w * 1.4);
    g.addColorStop(0, "rgba(0,0,0,0.28)"); g.addColorStop(1, "rgba(0,0,0,0)");
    alb.fillStyle = g; alb.fillRect(x0, y + w / 2, x1 - x0, w * 1.4);
  };
  const joint = (x: number, y: number, w: number, h: number, col: string) => {
    alb.fillStyle = col; alb.fillRect(x, y, w, h);
    orm.fillStyle = "rgb(0,90,40)"; orm.fillRect(x, y, w, h);
  };
  // the spandrel: the band between one floor's sill and the next floor's head
  const spandrel = (oy: number, col: string, glassy: boolean) => {
    const sill = oy + (1 - win.y0) * T, head = oy + (1 - win.y1) * T;
    const paint = (y0: number, y1: number) => {
      if (y1 <= y0) return;
      const g = alb.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, shade(hex(col), 1.06)); g.addColorStop(1, shade(hex(col), 0.84));
      alb.fillStyle = g; alb.fillRect(0, y0, W, y1 - y0);
      // spandrel glass reflects like the vision lite; an opaque panel less
      orm.fillStyle = glassy ? `rgb(110,${Math.round(spec.glassRough * 255 + 10)},${Math.round(spec.glassMetal * 255)})` : "rgb(0,110,120)";
      orm.fillRect(0, y0, W, y1 - y0);
    };
    paint(sill, oy + T);
    paint(oy, head);
  };
  const shadowBox = (oy: number) => {
    // a shadow box: the floor slab's edge seen through the spandrel glass
    const sill = oy + (1 - win.y0) * T;
    const slab = sill + (oy + T - sill) * 0.55;
    alb.fillStyle = "rgba(0,0,0,0.18)"; alb.fillRect(0, slab, W, 3);
    alb.fillStyle = "rgba(255,255,255,0.06)"; alb.fillRect(0, slab - 1, W, 1);
  };

  for (let by = 0; by < 2; by++) {
    const oy = by * T;
    const sill = oy + (1 - win.y0) * T, head = oy + (1 - win.y1) * T;
    const hgtWin = sill - head;
    const spandCol = sys.spand ?? spec.glassCol;
    switch (sys.kind) {
      case "stick": {
        spandrel(oy, sys.spand ?? shade(hex(spec.glassCol), 0.55).replace(/^rgb/, "rgb"), true);
        shadowBox(oy);
        for (let bx = 0; bx <= 2; bx++) vcap(bx * T, oy, oy + T, cap, cap * 0.9);
        for (let bx = 0; bx < 2; bx++) for (let l = 1; l < lites; l++) vcap(bx * T + (T * l) / lites, oy, oy + T, cap * 0.7, cap * 0.6);
        hcap(head, cap * 0.9); hcap(sill, cap);
        if (sys.transom) hcap(head + hgtWin * sys.transom, cap * 0.6);
        break;
      }
      case "band": {
        // the deep band: an opaque panel in the spandrel glass's colour, darker
        spandrel(oy, sys.spand ?? spandCol, false);
        const sillY = sill, nextHead = oy + T + (1 - win.y1) * T;
        // a cast line across the band's middle, and the band's own sheen
        const mid = (sillY + Math.min(oy + T, nextHead)) / 2;
        alb.fillStyle = "rgba(255,255,255,0.07)"; alb.fillRect(0, mid - 4, W, 2);
        hcap(head, cap); hcap(sill, cap * 1.1);
        // unit joints: thin, only at the bays
        for (let bx = 0; bx <= 2; bx++) for (let l = 0; l < lites; l++) {
          const x = bx * T + (T * l) / lites;
          if (bx === 2 && l > 0) continue;
          joint(x - 1, head, 2, hgtWin, shade(hex(capCol), 0.8));
        }
        if (sys.transom) hcap(head + hgtWin * sys.transom, cap * 0.5);
        break;
      }
      case "ssg": {
        // flush: the spandrel is the same coat over a dark back-pan
        spandrel(oy, shade(hex(spec.glassCol), 0.78), true);
        const jc = "rgba(14,18,22,0.85)";
        for (let bx = 0; bx <= 2; bx++) for (let l = 0; l < lites; l++) {
          if (bx === 2 && l > 0) continue;
          joint(bx * T + (T * l) / lites - 0.75, oy, 1.5, T, jc);
        }
        joint(0, head - 0.75, W, 1.5, jc); joint(0, sill - 0.75, W, 1.5, jc);
        if (sys.transom) joint(0, head + hgtWin * sys.transom - 0.75, W, 1.5, jc);
        // butt-jointed lites are never quite coplanar: each a hair lighter or darker
        for (let bx = 0; bx < 2; bx++) for (let l = 0; l < lites; l++) {
          const k = ((bx * 7 + by * 3 + l * 5) % 4) / 4;
          alb.fillStyle = `rgba(255,255,255,${0.02 + 0.04 * k})`;
          alb.fillRect(bx * T + (T * l) / lites + 1, head, T / lites - 2, hgtWin);
        }
        break;
      }
      case "ibeam": {
        spandrel(oy, sys.spand ?? shade(hex(spec.glassCol), 0.6), true);
        for (let bx = 0; bx <= 2; bx++) vcap(bx * T, oy, oy + T, cap, cap * 2.2);
        for (let bx = 0; bx < 2; bx++) for (let l = 1; l < lites; l++) vcap(bx * T + (T * l) / lites, oy, oy + T, cap * 0.6, cap);
        // the head and sill are slim bronze lines, not caps
        joint(0, head - 1, W, 2, shade(hex(capCol), 0.9));
        joint(0, sill - 1, W, 2, shade(hex(capCol), 0.9));
        break;
      }
      case "mirror": {
        // the whole storey is reflective glass in two equal lites
        spandrel(oy, spec.glassCol, true);
        const jc = shade(hex(capCol), 0.95);
        const half = oy + T / 2;
        joint(0, oy - 0.5, W, 1.5, jc); joint(0, half - 0.5, W, 1.2, jc);
        for (let bx = 0; bx <= 2; bx++) for (let l = 0; l < lites; l++) {
          if (bx === 2 && l > 0) continue;
          joint(bx * T + (T * l) / lites - 0.6, oy, 1.2, T, jc);
        }
        // the panes of a mirror wall are never one mirror: each reflects a
        // shade differently, which is the giveaway of the type
        for (let bx = 0; bx < 2; bx++) for (let l = 0; l < lites; l++) for (let hh = 0; hh < 2; hh++) {
          const k = ((bx * 5 + by * 3 + l * 7 + hh * 2) % 5) / 5;
          alb.fillStyle = k > 0.5 ? `rgba(255,255,255,${0.05 * k})` : `rgba(0,0,0,${0.06 * (1 - k)})`;
          alb.fillRect(bx * T + (T * l) / lites + 1, oy + hh * T / 2 + 1, T / lites - 2, T / 2 - 2);
          orm.fillStyle = `rgb(255,${Math.round((spec.glassRough + 0.01 * k) * 255)},${Math.round(spec.glassMetal * 255)})`;
          orm.fillRect(bx * T + (T * l) / lites + 1, oy + hh * T / 2 + 1, T / lites - 2, T / 2 - 2);
        }
        break;
      }
      case "fin": {
        // the fin stands out of the mullion line, throwing a long shadow
        for (let bx = 0; bx <= 2; bx++) {
          const x = bx * T;
          const g = alb.createLinearGradient(x, 0, x + T * 0.22, 0);
          g.addColorStop(0, "rgba(0,0,0,0.34)"); g.addColorStop(1, "rgba(0,0,0,0)");
          alb.fillStyle = g; alb.fillRect(x, oy, T * 0.22, T);
          both(x - cap / 2, oy, cap, T, shade(hex(capCol), 1.08));
          alb.fillStyle = shade(hex(capCol), 1.4); alb.fillRect(x - cap / 2, oy, 1.5, T);
        }
        hcap(head, 3); hcap(sill, 4);
        break;
      }
      case "frit": {
        spandrel(oy, shade(hex(spec.glassCol), 0.7), true);
        // dots fired on the glass: dense at the head, thinning down the lite
        const dot = "rgba(236,238,236,0.75)";
        for (let y = head + 3; y < sill - 2; y += 5) {
          const t = (y - head) / hgtWin;
          const r = 1.9 * Math.max(0, 1 - t * 1.6);
          if (r < 0.25) continue;
          alb.fillStyle = dot;
          for (let x = 2 + ((y / 5) % 2) * 2.5; x < W; x += 5) { alb.beginPath(); alb.arc(x, y, r, 0, Math.PI * 2); alb.fill(); }
        }
        // the frit is matte: rougher where it is dense
        const g = orm.createLinearGradient(0, head, 0, head + hgtWin * 0.6);
        g.addColorStop(0, `rgb(255,${Math.round(Math.min(1, spec.glassRough + 0.35) * 255)},${Math.round(spec.glassMetal * 140)})`);
        g.addColorStop(1, `rgba(255,${Math.round(spec.glassRough * 255)},${Math.round(spec.glassMetal * 255)},0)`);
        orm.fillStyle = g; orm.fillRect(0, head, W, hgtWin * 0.6);
        for (let bx = 0; bx <= 2; bx++) vcap(bx * T, oy, oy + T, cap, cap * 0.8);
        hcap(sill, cap);
        break;
      }
    }
  }
}

/** shade() takes "#rrggbb"; the painters above sometimes hold an rgb() string. */
function hex(c: string): string {
  if (c.startsWith("#")) return c;
  const m = c.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (!m) return "#808080";
  return "#" + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Number(x))).toString(16).padStart(2, "0")).join("");
}
