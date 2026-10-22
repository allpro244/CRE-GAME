/**
 * VIEW STATE FOR THE NEW SHELL. None of it is a fact about the campaign, so
 * none of it is saved with the game: which interface is on (persisted per
 * browser, like the other display switches), the last tab in each place, the
 * session's answered Inbox rows, and the default financing for a purchase.
 *
 * Kept apart from `state/store.ts` so the classic shell is untouched by it.
 */
import { create } from "zustand";
import type { PlaceId } from "./places";

export type UiShell = "classic" | "next";
export interface BuyPreset { product: string; lev: number }
export interface DoneRow { key: string; subject: string; facts: string; verb: string; m: number }

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

function initialShell(): UiShell {
  try {
    const q = new URLSearchParams(location.search).get("ui");
    if (q === "next" || q === "classic") return q;
  } catch { /* no location */ }
  return read("bw:ui-shell") === "next" ? "next" : "classic";
}

function initialPreset(): BuyPreset {
  try {
    const v = JSON.parse(read("bw:buy-preset") ?? "null");
    if (v && typeof v.product === "string" && typeof v.lev === "number") return v;
  } catch { /* bad json */ }
  // BuyButtons' own default: the cheapest desk that quotes, at its full principal.
  return { product: "cheapest", lev: 1 };
}

interface NextState {
  uiShell: UiShell;
  setUiShell: (v: UiShell) => void;
  placeTab: Partial<Record<PlaceId, string>>;
  setPlaceTab: (p: PlaceId, tab: string) => void;
  inboxDone: DoneRow[];
  markDone: (r: DoneRow) => void;
  buyPreset: BuyPreset;
  setBuyPreset: (p: BuyPreset) => void;
  /** The Inbox is a drawer, not a classic page. */
  inboxOpen: boolean;
  setInboxOpen: (v: boolean) => void;
  /** A moment card asked for from its Inbox row (goal, exit). */
  showMoment: "goal" | "exit" | null;
  setShowMoment: (v: "goal" | "exit" | null) => void;
  /** The scheme row picked on a lot's Build tab. */
  schemePick: { bbl: string; i: number } | null;
  setSchemePick: (v: { bbl: string; i: number } | null) => void;
  /** The open drill, by anchor id; one at a time. */
  drill: { id: string; key: string; args?: Record<string, unknown>; x: number; y: number } | null;
  setDrill: (d: NextState["drill"]) => void;
}

export const useNext = create<NextState>((set) => ({
  uiShell: initialShell(),
  setUiShell: (v) => { write("bw:ui-shell", v); set({ uiShell: v }); },
  placeTab: {},
  setPlaceTab: (p, tab) => set((s) => ({ placeTab: { ...s.placeTab, [p]: tab } })),
  inboxDone: [],
  markDone: (r) => set((s) => ({ inboxDone: [r, ...s.inboxDone.filter((x) => x.key !== r.key)].slice(0, 200) })),
  buyPreset: initialPreset(),
  setBuyPreset: (p) => { write("bw:buy-preset", JSON.stringify(p)); set({ buyPreset: p }); },
  inboxOpen: false,
  setInboxOpen: (v) => set({ inboxOpen: v }),
  showMoment: null,
  setShowMoment: (v) => set({ showMoment: v }),
  schemePick: null,
  setSchemePick: (v) => set({ schemePick: v }),
  drill: null,
  setDrill: (d) => set({ drill: d }),
}));

// For the profiling harness and the screenshot driver, as `__store` is.
(window as unknown as { __nextStore?: typeof useNext }).__nextStore = useNext;
