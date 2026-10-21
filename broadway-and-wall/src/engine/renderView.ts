/**
 * WHAT A RENDERER NEEDS TO DRAW THE CITY THIS MONTH — and nothing else.
 *
 * The Unreal build (UE58_PLAN.md §2, "the render contract") does not want the
 * GameState: it is megabytes, mostly ledgers. It wants, per lot, what stands
 * there and what is happening to it, plus the month's events for set-pieces.
 * This is that view, as one pure function of the state, read with exactly the
 * rules the web map uses in map/MapView.tsx (the skyline and parapet effects)
 * so the two renderers cannot disagree about what a lot looks like:
 *
 *  - a player's job rises floors × FLOOR_M × progress, progress floored at 0.15;
 *  - a city job the same, floored at 0.12, and an orphaned frame stops at 0.75;
 *    a job on a lot that already has floor area, or under a player job, is not
 *    drawn (a teardown marker is `built` with bldgArea 0 — not a building);
 *  - a delivered building (`built`) stands floors × FLOOR_M; a lot with a
 *    player job shows the job, not the old shell;
 *  - `built` with class "land" is a cleared lot: whatever the generator put
 *    there is gone — unless a job is already rising on it (a rival's teardown
 *    leaves the marker and the crane together), when the frame is what stands.
 *    One entry per lot.
 *
 * Lots with none of that keep the generator's building (the static half of the
 * contract, unreal/tools/export-city.mjs). The contract's types are mirrored in
 * C++ (unreal/BroadwayWall/Source/BroadwayWall/RenderView.h) and checked by
 * test/render-view.mjs.
 */
import type {GameState, PropertyEventKind, BuildingDesign } from "./types";
import { START_YEAR } from "./types";
import { ownerOf } from "./rivals";
import { STYLE_KITS } from "./styleKits";

/** Storey height the generator and both renderers build with (citygen, MapView). */
export const FLOOR_M = 3.55;

export const RENDER_VIEW_FORMAT = "bw-render/1";

export interface RenderLot {
  bbl: string;
  /** Use class of what stands (or is going up); "land" = cleared. */
  cls: string;
  floors: number;
  /** Drawn height now, metres: the frame's height while it rises. */
  heightM: number;
  construction: boolean;
  /** 0..1 while building; 1 when standing. */
  progress: number;
  /** Footprint coverage the job was planned at, when the engine kept it. */
  cov?: number;
  /** The year whose skin it wears: delivery year, or this year for a frame. */
  year: number;
  /** Delivered within the last three months — bunting. */
  fresh?: boolean;
  /** Ground-floor shops in the mix. */
  shops?: boolean;
  /** The facade family the player chose (BuildingDesign.facade, variant stripped), when they designed it. */
  facade?: string;
  /** The Unreal facade kit the player chose, when they chose one (lookOf). */
  look?: RenderLook;
  /** The building form the player chose (BuildingDesign.form); the host solves its tiers on the lot. */
  form?: string;
  /** Its tiers, rings in cm, heights in cm (state/unrealHost.ts solves them). */
  tiers?: { ring: number[]; z0: number; z1: number }[];
}

export interface RenderOwner {
  bbl: string;
  owner: "player" | "rival";
  /** The rival firm's id, when a rival owns it. */
  firm?: string;
  listed?: boolean;
  /** 1 = cash swept by a covenant, 2 = a workout file is open. */
  distress?: 1 | 2;
}

export interface RenderEvent {
  m: number;
  bbl: string;
  kind: PropertyEventKind;
}

export interface RenderView {
  format: typeof RENDER_VIEW_FORMAT;
  month: number;
  year: number;
  /** The market's phase (econ.phase). */
  phase: string;
  /** Lots whose building differs from the generator's. */
  lots: RenderLot[];
  /** Owned lots (player and rivals). Street owners are not listed. */
  owners: RenderOwner[];
  /** Assembled sites: child deed -> the parent lot that carries the building. */
  merged: Record<string, string>;
  /** Deed events with sinceMonth < m <= month. */
  events: RenderEvent[];
}

/**
 * THE FACADE KITS the Unreal renderer can build (unreal/BroadwayWall/Data/kit-*.json),
 * as the Build desk offers them: grouped by era, each with the web family it
 * stands nearest (BuildingDesign.facade, so the browser map draws the same
 * building in its own pattern book).
 */
export const KITS: { key: string; name: string; era: string; group: "prewar" | "interwar" | "postwar" | "contemporary"; family: string }[] = [
  // named for what each kit builds (Unreal renders: unreal/BroadwayWall/Data/kit-thumbs)
  { key: "NYA", name: "Painted brick walk-up", era: "1880-1930", group: "prewar", family: "brick" },
  { key: "NYH", name: "Arched red brick", era: "1860-1900", group: "prewar", family: "brick" },
  { key: "CHG", name: "Brick & cast iron", era: "1860-1910", group: "prewar", family: "castiron" },
  { key: "SFA", name: "Brick on a stone base", era: "1900-1930", group: "prewar", family: "buff" },
  { key: "SFJ", name: "Romanesque stone", era: "1885-1905", group: "prewar", family: "romanesque" },
  { key: "CHA", name: "Terra cotta commercial", era: "1890-1925", group: "prewar", family: "terracotta" },
  { key: "CHC", name: "Gothic terra cotta", era: "1900-1930", group: "prewar", family: "terracotta" },
  { key: "NYG", name: "Collegiate Gothic", era: "1900-1930", group: "prewar", family: "gothic" },
  { key: "CHB", name: "Deco stone", era: "1925-1940", group: "interwar", family: "deco" },
  { key: "CHI", name: "Deco brick", era: "1920-1940", group: "interwar", family: "decobrick" },
  { key: "CHH", name: "Moderne, bronze bays", era: "1935-1955", group: "interwar", family: "moderne" },
  { key: "CHF", name: "Mid-century frame", era: "1945-1965", group: "postwar", family: "midcentury" },
  { key: "CHE", name: "Stone base, glass top", era: "1950-1975", group: "postwar", family: "modern" },
  { key: "SFE", name: "Modern strip", era: "1955-1990", group: "postwar", family: "modern" },
  { key: "SFC", name: "Punched grid", era: "1960-1990", group: "postwar", family: "grid" },
  { key: "CHJ", name: "Dark glass curtain wall", era: "1960-1985", group: "postwar", family: "blackglass" },
  // (CHD and SFB were retired after review: blank slabs at any height)
  // and Broadway & Wall's own styles, built from recipes (unreal/tools/make-styles.py)
  ...STYLE_KITS,
];
export const KIT_GROUPS: { key: (typeof KITS)[number]["group"]; name: string }[] = [
  { key: "prewar", name: "Pre-war" }, { key: "interwar", name: "Inter-war" }, { key: "postwar", name: "Post-war" }, { key: "contemporary", name: "Contemporary" },
];
/** Wall colours: multipliers on the kit's own wall material (its brick, stone or panel). */
export const KIT_COLOURS: { name: string; rgb: [number, number, number] }[] = [
  { name: "As built", rgb: [1, 1, 1] },
  { name: "Warm", rgb: [1.12, 1.0, 0.84] },
  { name: "Red", rgb: [1.18, 0.82, 0.74] },
  { name: "Pale", rgb: [1.25, 1.22, 1.16] },
  { name: "Grey", rgb: [0.9, 0.92, 0.95] },
  { name: "Dark", rgb: [0.68, 0.66, 0.66] },
];
/** Window rhythms: indices into the Unreal facade builder's bay patterns. */
export const KIT_BAYS: { name: string; i: number }[] = [
  { name: "Even", i: 0 }, { name: "Alternating", i: 1 }, { name: "Grouped", i: 2 }, { name: "Varied", i: 3 },
];
export interface RenderLook { kit: string; tint?: [number, number, number]; ground?: string; top?: string; bays?: number }
/** What the Unreal renderer needs of a design's kit choice, or nothing when the player left it to the street. */
export function lookOf(d: BuildingDesign | undefined): RenderLook | undefined {
  if (!d?.kit) return undefined;
  const c = d.kitColour !== undefined ? KIT_COLOURS[d.kitColour] : undefined;
  return {
    kit: d.kit,
    ...(c && d.kitColour ? { tint: c.rgb } : {}),
    ...(d.ground ? { ground: d.ground } : {}),
    ...(d.top ? { top: d.top } : {}),
    ...(d.bays !== undefined ? { bays: d.bays } : {}),
  };
}

export function renderView(s: GameState, sinceMonth = s.month - 1): RenderView {
  const nowYear = START_YEAR + Math.floor(s.month / 12);
  const lots: RenderLot[] = [];

  for (const d of Object.values(s.developments ?? {})) {
    const total = Math.max(1, d.deliverM - d.startM);
    const progress = Math.min(1, Math.max(0.15, (s.month - d.startM + 1) / total));
    lots.push({ bbl: d.bbl, cls: d.use, floors: d.floors, heightM: d.floors * FLOOR_M * progress, construction: true, progress, year: nowYear,
      ...(d.coverage !== undefined ? { cov: d.coverage } : {}),
      ...(d.design?.facade ? { facade: d.design.facade.split("#")[0] } : {}),
      ...(lookOf(d.design) ? { look: lookOf(d.design) } : {}), ...(d.design?.form ? { form: d.design.form } : {}) });
  }
  for (const j of s.cityJobs ?? []) {
    if ((s.built?.[j.bbl]?.bldgArea ?? 0) > 0 || s.developments?.[j.bbl]) continue;
    const total = Math.max(1, j.deliverM - j.startM);
    const raw = (s.month - j.startM + 1) / total;
    const progress = Math.min(1, Math.max(0.12, j.orphaned ? Math.min(raw, 0.75) : raw));
    const cov = (j as { coverage?: number }).coverage;
    lots.push({ bbl: j.bbl, cls: j.use, floors: j.floors, heightM: j.floors * FLOOR_M * progress, construction: true, progress, year: nowYear,
      ...(cov !== undefined ? { cov } : {}) });
  }
  const rising = new Set(lots.map((l) => l.bbl));
  for (const [bbl, b] of Object.entries(s.built ?? {})) {
    if (s.developments?.[bbl] || rising.has(bbl)) continue;
    const dM = s.holdings[bbl]?.deliveredM;
    lots.push({ bbl, cls: b.class, floors: b.floors, heightM: b.floors * FLOOR_M, construction: false, progress: 1, year: b.yearBuilt || nowYear,
      ...(b.cov !== undefined ? { cov: b.cov } : {}),
      ...(dM !== undefined && s.month - dM <= 3 ? { fresh: true } : {}),
      ...(b.mix ? { shops: (b.mix.retail ?? 0) > 0.001 } : {}),
      ...(b.design?.facade ? { facade: b.design.facade.split("#")[0] } : {}),
      ...(lookOf(b.design) ? { look: lookOf(b.design) } : {}), ...(b.design?.form ? { form: b.design.form } : {}) });
  }

  const owners: RenderOwner[] = [];
  for (const h of Object.values(s.holdings)) {
    const distress = s.workouts?.[h.bbl] ? 2 : (h.loan?.sweep || h.mezz?.sweep) ? 1 : 0;
    owners.push({ bbl: h.bbl, owner: "player", ...(h.sale && !h.sale.unsolicited ? { listed: true } : {}), ...(distress ? { distress } : {}) });
  }
  for (const r of s.rivals ?? []) {
    if (r.failedM !== undefined) continue;
    for (const bbl of r.bbls) if (!s.holdings[bbl] && ownerOf(s, bbl) === r) owners.push({ bbl, owner: "rival", firm: r.id });
  }

  const events: RenderEvent[] = [];
  for (const [bbl, log] of Object.entries(s.propertyLog ?? {}))
    for (const e of log) if (e.m > sinceMonth && e.m <= s.month) events.push({ m: e.m, bbl, kind: e.kind });
  events.sort((a, b) => a.m - b.m || (a.bbl < b.bbl ? -1 : 1));

  return { format: RENDER_VIEW_FORMAT, month: s.month, year: nowYear, phase: String(s.econ?.phase ?? ""), lots, owners, merged: { ...(s.merged ?? {}) }, events };
}
