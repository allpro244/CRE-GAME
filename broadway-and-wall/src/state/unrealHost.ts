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
import { useStore } from "@/state/store";
import { renderView } from "@/engine/renderView";
import { toBwCity } from "@/citygen/unrealExport.mjs";
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

let started = false;
export function startUnrealHost(): void {
  if (!UNREAL_HOST || started) return;
  started = true;
  document.documentElement.classList.add("host-unreal");

  let lastCity: unknown = null, lastGame: unknown = null, lastMonth = -1;
  let lastSel: string | null | undefined;
  let lastGfx: string | undefined;
  const push = () => {
    const b = bridge();
    if (!b) return false;
    const s = useStore.getState();
    if (s.city && s.city !== lastCity) {
      lastCity = s.city; lastGame = null; lastMonth = -1;
      void b.city(JSON.stringify(toBwCity(s.city, { familyFor, tints: TINTS })));
    }
    if (s.game && s.city && s.game !== lastGame) {
      const since = lastMonth;
      lastGame = s.game; lastMonth = s.game.month;
      void b.view(JSON.stringify(renderView(s.game, since)));
    }
    // the Settings page's graphics level drives Unreal's scalability (Phase 6)
    if (s.graphics !== lastGfx) {
      lastGfx = s.graphics;
      void b.input(JSON.stringify({ t: "quality", k: s.graphics }));
    }
    if (s.selectedBBL !== lastSel) {
      lastSel = s.selectedBBL;
      void b.select(lastSel ?? "");
    }
    return true;
  };
  useStore.subscribe(() => { push(); });
  // the bridge object is re-bound by Unreal after each page load, so it can
  // arrive a moment after this runs: keep trying until it answers
  const wait = window.setInterval(() => { if (push()) window.clearInterval(wait); }, 250);

  (window as unknown as { bwUnreal: unknown }).bwUnreal = {
    select: (bbl: string) => useStore.getState().select(bbl || null),
  };

  // camera keys go to Unreal unless the player is typing in a field
  const CAMERA = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Digit1", "Digit2", "Digit3"]);
  const key = (e: KeyboardEvent, down: boolean) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || !CAMERA.has(e.code)) return;
    sendInput({ t: down ? "kd" : "ku", k: e.code });
  };
  window.addEventListener("keydown", (e) => key(e, true));
  window.addEventListener("keyup", (e) => key(e, false));
}
