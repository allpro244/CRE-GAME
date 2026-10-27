/**
 * THE GAME INSIDE UNREAL (UE58_PLAN.md §2, host A).
 *
 * Loaded with ?host=unreal, the page runs exactly as it does in a browser —
 * engine, worker, saves, desks — but draws no map of its own: Unreal draws the
 * city behind a transparent page. This module is the page's half of the seam:
 *
 *  - when a city is generated it goes to Unreal once, as the same "bw-city/1"
 *    document the command-line exporter writes (citygen/unrealExport.mjs);
 *  - after every state change the month's render view goes over
 *    (engine/renderView.ts, "bw-render/1") — what stands on each lot;
 *  - the selected lot is shared both ways: Unreal calls window.bwUnreal.select
 *    when the player clicks a building, the page tells Unreal when a desk
 *    selects one;
 *  - the transparent surface behind the desks forwards the pointer and the
 *    camera keys, because the page sits on top of the 3D view and would
 *    otherwise swallow every click.
 *
 * The C++ end is UBWBridge in unreal/BroadwayWall (BindUObject("bridge")):
 * its UFUNCTIONs City, View, Select and Input arrive here as
 * window.ue.bridge.city / view / select / input.
 */
import { useNext } from "@/ui/next/nextStore";
import { lensValues } from "@/ui/next/lensData";
import { useStore } from "@/state/store";
import { renderView, lookOf } from "@/engine/renderView";
import { gfxString } from "./graphics";
import { hoverBasics } from "@/map/hoverCard";
import { toBwCity } from "@/citygen/unrealExport.mjs";
import { formTiers, formMetrics, formsFor } from "@/citygen/forms.mjs";
import "@/map/real/patternbook/register";
import { familyFor, TINTS } from "@/map/real/facades";

export const UNREAL_HOST = typeof location !== "undefined" && new URLSearchParams(location.search).get("host") === "unreal";

interface Bridge {
  city(json: string): Promise<void>;
  view(json: string): Promise<void>;
  select(bbl: string): Promise<void>;
  input(json: string): Promise<void>;
}
const bridge = (): Bridge | undefined => (window as unknown as { ue?: { bridge?: Bridge } }).ue?.bridge;

export function sendInput(ev: Record<string, unknown>): void {
  void bridge()?.input(JSON.stringify(ev));
}

// THE FORMS ARE SOLVED HERE, where the lot's geometry and the game meet: the
// deed's ring from the exported city (cm), the building's footprint the lot
// scaled by sqrt(coverage) about its centre (Unreal's rule for a delivered
// building), the height its floors make. The desk's numbers and the drawn
// building come from the same tiers.
let rings = new Map<string, number[]>();
function lotGeom(bbl: string, cov: number) {
  const flat = rings.get(bbl);
  if (!flat || flat.length < 6) return null;
  const lot: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) lot.push([flat[i] / 100, flat[i + 1] / 100]);
  const c = lot.reduce((a, p) => [a[0] + p[0] / lot.length, a[1] + p[1] / lot.length], [0, 0]);
  const k = cov > 0 ? Math.min(0.97, Math.sqrt(cov)) : 0.82;
  const footprint = lot.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k] as [number, number]);
  return { lot, footprint };
}
const heightOf = (floors: number) => Math.max(1, floors) * 3.55 + 1.5;
/** The tiers of a chosen form on a lot, in cm for Unreal, and its measured numbers; null where it does not fit. */
export function solveForm(bbl: string, form: string, floors: number, cov: number, cls: string, year: number) {
  const g = lotGeom(bbl, cov);
  if (!g) return null;
  const hM = heightOf(floors);
  const tiers = formTiers({ bbl, footprint: g.footprint, lotRing: g.lot, hM, year, klass: cls, form });
  if (!tiers) return null;
  return {
    tiers: tiers.map((t) => ({ ring: t.ring.flatMap(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]), z0: Math.round(t.base * 100), z1: Math.round(t.top * 100) })),
    ...formMetrics(g.footprint, tiers, hM),
  };
}
/** Every form that fits this lot at these floors, with what it keeps and what it adds. */
export function formsForLot(bbl: string, floors: number, cov: number, cls: string, year: number) {
  const g = lotGeom(bbl, cov);
  if (!g) return [];
  return formsFor({ bbl, footprint: g.footprint, lotRing: g.lot, hM: heightOf(floors), year, klass: cls, floors });
}

let started = false;
export function startUnrealHost(): void {
  if (!UNREAL_HOST || started) return;
  started = true;
  document.documentElement.classList.add("host-unreal");

  let lastCity: unknown = null, lastGame: unknown = null, lastMonth = -1;
  let lastSel: string | null | undefined;
  let lastGfx: string | undefined;
  let lastPreview: unknown = undefined;
  let lastLens: string | undefined, lastLensGame: unknown = null, lastFly = 0;
  const push = () => {
    const b = bridge();
    if (!b) return false;
    const s = useStore.getState();
    if (s.city && s.city !== lastCity) {
      lastCity = s.city; lastGame = null; lastMonth = -1;
      const bw = toBwCity(s.city, { familyFor, tints: TINTS }) as { parcels: { bbl: string; ring: number[] }[] };
      rings = new Map(bw.parcels.map((p: { bbl: string; ring: number[] }) => [p.bbl, p.ring]));
      void b.city(JSON.stringify(bw));
    }
    if (s.game && s.city && s.game !== lastGame) {
      const since = lastMonth;
      lastGame = s.game; lastMonth = s.game.month;
      const view = renderView(s.game, since);
      view.lots = view.lots.map((l) => {
        if (!l.form || l.construction) return l;
        const f = solveForm(l.bbl, l.form, l.floors, l.cov ?? 0.6, l.cls, l.year);
        return f ? { ...l, tiers: f.tiers } : l;
      });
      void b.view(JSON.stringify(view));
    }
    // the Settings page's graphics level drives Unreal's scalability (Phase 6)
    // the full graphics settings, as Unreal's option string (state/graphics.ts)
    const gfx = gfxString(s.gfx);
    if (gfx !== lastGfx) {
      lastGfx = gfx;
      void b.input(JSON.stringify({ t: "gfx", k: gfx }));
    }
    // the Build desk's scheme: Unreal draws it on its lot (the desk's model box
    // is a window onto that view: ui/panels/SchemeViewer.tsx HostSchemeWindow)
    if (s.designPreview !== lastPreview) {
      lastPreview = s.designPreview;
      const p = s.designPreview;
      void b.input(JSON.stringify(p
        ? { t: "preview", bbl: p.bbl, floors: p.floors, cov: p.cov, cls: p.cls ?? p.use, year: p.year ?? 0, facade: p.design.facade?.split("#")[0] ?? "", ...(lookOf(p.design) ? { look: lookOf(p.design) } : {}),
            ...(p.design.form ? { tiers: solveForm(p.bbl, p.design.form, p.floors, p.cov, p.cls ?? String(p.use), p.year ?? 0)?.tiers ?? [] } : {}) }
        : { t: "preview-off" }));
    }
    if (s.selectedBBL !== lastSel) {
      lastSel = s.selectedBBL;
      void b.select(lastSel ?? "");
    }
    // THE LENS BRIDGE (ui-revamp step 7): the lens and its number per deed,
    // from the same lensData the browser map paints; resent when the month
    // moves. Unreal tints the lots (BWGame.cpp "lens", the C++ side's to add).
    if (s.lens !== lastLens || (s.lens !== "none" && s.game !== lastLensGame)) {
      lastLens = s.lens; lastLensGame = s.game;
      const v = s.lens !== "none" && s.game && s.parcels ? Object.fromEntries(lensValues(s.game, s.parcels, s.lens)) : {};
      sendInput({ t: "lens", k: s.lens, v });
    }
    // a row or a notice that names a building puts the camera on it
    if (s.flyTo && s.flyTo.n !== lastFly) {
      lastFly = s.flyTo.n;
      sendInput({ t: "fly", bbl: s.flyTo.bbl });
    }
    return true;
  };
  useStore.subscribe(() => { push(); });
  // the bridge object is re-bound by Unreal after each page load, so it can
  // arrive a moment after this runs: keep trying until it answers
  const wait = window.setInterval(() => { if (push()) window.clearInterval(wait); }, 250);

  (window as unknown as { bwUnreal: unknown }).bwUnreal = {
    select: (bbl: string) => useStore.getState().select(bbl || null, true),
    // THE HOVER CARD'S FOUR NUMBERS (map/hoverCard.ts hoverBasics), asked for
    // one lot at a time as the pointer lands on it; Unreal draws them natively
    hover: (bbl: string) => {
      const { game, parcels } = useStore.getState();
      const rec = bbl && parcels ? parcels[game?.merged?.[bbl] ?? bbl] : undefined;
      if (!game || !parcels || !rec) return;
      const h = hoverBasics(game, parcels, rec);
      sendInput({ t: "hoverinfo", bbl, a: Math.round(h.appraised), o: h.occ == null ? -1 : Math.round(h.occ * 100), d: h.demand, s: h.bldgSf, ac: +h.acres.toFixed(2) });
    },
  };

  // camera keys go to Unreal unless the player is typing in a field
  const CAMERA = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Digit1", "Digit2", "Digit3"]);
  // THE NEW SHELL GIVES 1-5 TO THE PLACES (ui/next/keys.ts), so its camera
  // presets are F1-F3. They reach Unreal under the preset names it already
  // reads (BWGame.cpp: Digit1-3), so the C++ side needs no change.
  const PRESET: Record<string, string> = { F1: "Digit1", F2: "Digit2", F3: "Digit3" };
  const key = (e: KeyboardEvent, down: boolean) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (useNext.getState().uiShell === "next") {
      if (PRESET[e.code]) { e.preventDefault(); sendInput({ t: down ? "kd" : "ku", k: PRESET[e.code] }); return; }
      if (e.code.startsWith("Digit")) return;
    }
    if (!CAMERA.has(e.code)) return;
    sendInput({ t: down ? "kd" : "ku", k: e.code });
  };
  window.addEventListener("keydown", (e) => key(e, true));
  window.addEventListener("keyup", (e) => key(e, false));
}
