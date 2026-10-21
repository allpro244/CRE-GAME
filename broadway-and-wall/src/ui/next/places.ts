/**
 * THE FIVE PLACES AND THE INBOX (ui-revamp PLAN §2, BUILD_SPEC 2.2).
 *
 * Each tab names the classic page it hosts until a later step replaces it.
 * `jump` scrolls the hosted page to a section by its heading.
 */
import type { GameState } from "@/engine/types";
import type { Page } from "@/state/store";

export type PlaceId = "inbox" | "holdings" | "pipeline" | "market" | "capital" | "city";
export interface PlaceTab { id: string; label: string; page: Page; jump?: string; width: "std" | "wide"; when?: (g: GameState) => boolean }
export interface Place { id: PlaceId; label: string; key: string; icon: string; tabs: PlaceTab[] }

const hasNotes = (g: GameState) => (g.noteOffers?.length ?? 0) + (g.privateAsks?.length ?? 0) + (g.notes?.length ?? 0) > 0;

export const PLACES: Place[] = [
  {
    id: "inbox", label: "Inbox", key: "I", icon: "✉",
    tabs: [
      { id: "needs", label: "Needs you", page: "none", width: "std" },
      { id: "later", label: "Later", page: "none", width: "std" },
      { id: "done", label: "Done", page: "none", width: "std" },
    ],
  },
  {
    id: "holdings", label: "Holdings", key: "1", icon: "▦",
    tabs: [
      { id: "buildings", label: "Buildings", page: "portfolio", width: "wide" },
      { id: "leasing", label: "Leasing", page: "leasing", width: "wide" },
      { id: "returns", label: "Returns", page: "portfolio", jump: "Returns to date", width: "wide" },
    ],
  },
  {
    id: "pipeline", label: "Pipeline", key: "2", icon: "✎",
    tabs: [{ id: "all", label: "All deals", page: "deals", width: "wide" }],
  },
  {
    id: "market", label: "Market", key: "3", icon: "◎",
    tabs: [
      { id: "forsale", label: "For sale", page: "market", width: "wide" },
      { id: "all", label: "All buildings", page: "buildings", width: "wide" },
      { id: "sites", label: "Sites", page: "market", jump: "Land", width: "wide" },
      { id: "distressed", label: "Distressed", page: "notes", width: "wide", when: hasNotes },
      { id: "books", label: "Books", page: "market", jump: "Books for sale", width: "wide" },
    ],
  },
  {
    id: "capital", label: "Capital", key: "4", icon: "⚖",
    tabs: [
      { id: "overview", label: "Overview", page: "debt", width: "wide" },
      { id: "loans", label: "Loans", page: "debt", jump: "Loan by loan", width: "wide" },
      { id: "lenders", label: "Lenders", page: "banks", width: "wide" },
      { id: "investors", label: "Investors", page: "investors", width: "wide" },
      { id: "books", label: "Books", page: "books", width: "wide" },
    ],
  },
  {
    id: "city", label: "City", key: "5", icon: "∿",
    tabs: [
      { id: "markets", label: "Markets", page: "economy", width: "wide" },
      { id: "news", label: "News", page: "news", width: "wide" },
      { id: "players", label: "Players", page: "players", width: "wide" },
      { id: "rankings", label: "Rankings", page: "rankings", width: "wide" },
      { id: "record", label: "Record", page: "firm", width: "wide" },
    ],
  },
];

/** Pages reached from the rail foot, not a place. */
export const FOOT_PAGES: { page: Page; label: string; icon: string }[] = [
  { page: "saves", label: "Saves", icon: "⛁" },
  { page: "settings", label: "Settings", icon: "⚙" },
];

export const placeById = (id: PlaceId): Place => PLACES.find((p) => p.id === id)!;

export function visibleTabs(p: Place, g: GameState | null): PlaceTab[] {
  return p.tabs.filter((t) => !t.when || (g ? t.when(g) : false));
}

/**
 * Which place and tab a classic page belongs to. A page that two tabs share
 * (Portfolio is Buildings and Returns) resolves to the remembered tab when it
 * is one of them, else the first.
 */
export function placeOf(page: Page, remembered?: Partial<Record<PlaceId, string>>): { place: PlaceId; tab: string } | null {
  for (const p of PLACES) {
    const hits = p.tabs.filter((t) => t.page === page);
    if (!hits.length) continue;
    const r = remembered?.[p.id];
    const t = hits.find((h) => h.id === r) ?? hits[0];
    return { place: p.id, tab: t.id };
  }
  return null;
}
