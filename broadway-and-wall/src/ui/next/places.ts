/**
 * THE FIVE PLACES AND THE INBOX (ui-revamp PLAN §2, BUILD_SPEC 2.2).
 *
 * Each tab names the classic page it hosts until a later step replaces it.
 * `jump` scrolls the hosted page to a section by its heading.
 */
import type { GameState } from "@/engine/types";
import { useStore, type Page } from "@/state/store";

export type PlaceId = "inbox" | "holdings" | "pipeline" | "leasing" | "market" | "capital" | "markets" | "city";
export interface PlaceTab { id: string; label: string; page: Page; jump?: string; width: "std" | "wide"; when?: (g: GameState) => boolean;
  /** A ui/next table drawn instead of the classic page (Shell NEXT_VIEW). */
  view?: string }
export interface Place { id: PlaceId; label: string; key: string; icon: string; tabs: PlaceTab[] }

/** The region's land game: a tract held, at the board, platted, or lots on the book. */
const hasLand = (g: GameState) => !!(g.entitlementApps || g.plats || g.rezoned || g.homes?.offers || g.homes?.contracts)
  || Object.keys(g.holdings).some((b) => !!useStore.getState().parcels?.[b]?.tract);
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
      { id: "buildings", label: "Buildings", page: "portfolio", view: "holdings", width: "wide" },
      { id: "land", label: "Land", page: "portfolio", view: "land", width: "wide", when: hasLand },
      { id: "returns", label: "Returns", page: "portfolio", jump: "Returns to date", width: "wide" },
    ],
  },
  {
    id: "pipeline", label: "Pipeline", key: "2", icon: "✎",
    tabs: [
      { id: "board", label: "Board", page: "deals", view: "pipe-board", width: "wide" },
      { id: "buying", label: "Buying", page: "deals", view: "pipe-buy", width: "wide" },
      { id: "building", label: "Building", page: "deals", view: "pipe-build", width: "wide" },
      { id: "selling", label: "Selling", page: "deals", view: "pipe-sell", width: "wide" },
      { id: "land", label: "Land", page: "deals", view: "land", width: "wide", when: hasLand },
    ],
  },
  {
    // leases, its own place (owner): letters to sign, the roll, the empty space
    id: "leasing", label: "Leasing", key: "3", icon: "✍",
    tabs: [
      { id: "offers", label: "Offers", page: "leasing", view: "l-offers", width: "wide" },
      { id: "expiring", label: "Expiring", page: "leasing", view: "l-expiring", width: "wide" },
      { id: "vacancy", label: "Vacancy", page: "leasing", view: "l-vacancy", width: "wide" },
      { id: "desk", label: "Desk", page: "leasing", width: "wide" },
    ],
  },
  {
    id: "market", label: "Buy", key: "4", icon: "◎",
    tabs: [
      { id: "forsale", label: "For sale", page: "market", view: "forsale", width: "wide" },
      { id: "all", label: "All buildings", page: "buildings", width: "wide" },
      { id: "sites", label: "Sites", page: "market", view: "sites", width: "wide" },
      { id: "distressed", label: "Distressed", page: "market", view: "distressed", width: "wide" },
      { id: "books", label: "Books", page: "market", view: "books", width: "wide" },
      // the lender's desk on paper held or offered (private credit), hosted until it has its own table
      { id: "notes", label: "Notes", page: "notes", width: "wide", when: hasNotes },
    ],
  },
  {
    id: "capital", label: "Capital", key: "5", icon: "⚖",
    tabs: [
      { id: "overview", label: "Overview", page: "debt", view: "capital", width: "wide" },
      { id: "loans", label: "Loans", page: "debt", view: "loans", width: "wide" },
      { id: "debt", label: "Debt desk", page: "debt", width: "wide" },
      { id: "lenders", label: "Lenders", page: "banks", view: "lenders", width: "wide" },
      { id: "investors", label: "Investors", page: "investors", view: "investors", width: "wide" },
      { id: "books", label: "Books", page: "books", view: "fbooks", width: "wide" },
    ],
  },
  {
    // the economy, drawn (owner: its own place, out of City)
    id: "markets", label: "Markets", key: "6", icon: "▲",
    tabs: [
      { id: "overview", label: "Overview", page: "economy", view: "m-overview", width: "wide" },
      { id: "sectors", label: "Sectors", page: "economy", view: "c-markets", width: "wide" },
      { id: "districts", label: "Districts", page: "economy", view: "m-districts", width: "wide" },
      { id: "building", label: "Construction", page: "economy", view: "m-building", width: "wide" },
    ],
  },
  {
    id: "city", label: "City", key: "7", icon: "∿",
    tabs: [
      { id: "news", label: "News", page: "news", view: "c-news", width: "wide" },
      { id: "players", label: "Players", page: "players", view: "c-players", width: "wide" },
      { id: "rankings", label: "Rankings", page: "rankings", view: "c-rankings", width: "wide" },
      { id: "record", label: "Record", page: "firm", view: "c-record", width: "wide" },
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
  if (page === "none") return null;
  for (const p of PLACES) {
    if (p.id === "inbox") continue;
    const hits = p.tabs.filter((t) => t.page === page);
    if (!hits.length) continue;
    const r = remembered?.[p.id];
    const t = hits.find((h) => h.id === r) ?? hits[0];
    return { place: p.id, tab: t.id };
  }
  return null;
}
