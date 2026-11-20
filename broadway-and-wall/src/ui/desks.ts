import { debtBook } from "@/ui/next/derive";
import type { GameState } from "@/engine/types";
import type { Page } from "@/state/store";
import { loiNeedsPrincipal } from "@/engine/leasing";
import { liveBrokerCalls } from "@/ui/panels/broker";

/**
 * SIX DESKS, NOT FOURTEEN DOORS.
 *
 * The rail used to list every room the firm owns — fourteen of them, three of
 * which (Debt, Refinance, Fund) opened the same page — plus six lenses, four
 * city readouts and a campaign menu. A player looking for "where do I borrow"
 * had to know that the answer was any of three rows. The rooms have not gone
 * anywhere: they are tabs inside the desk whose JOB they serve, and this one
 * table is what the rail, the page header, the digit keys, the palette and the
 * Back button all read, so no two of them can drift apart again.
 */
export type DeskId = "portfolio" | "leasing" | "deals" | "market" | "capital" | "city";

export type DeskTab = {
  page: Page; label: string; note: string;
  /** Shown only while this holds — a tab with nothing on it is not a room yet. */
  when?: (g: GameState) => boolean;
};
export type Desk = {
  id: DeskId; label: string; icon: string; key: string; note: string; tabs: readonly DeskTab[];
  /** Always open on the first tab — neither a badge elsewhere nor the tab
   *  last visited moves it. City opens on Markets (owner, Oct 2026). */
  home?: boolean;
};

export const DESKS: readonly Desk[] = [
  {
    id: "portfolio", label: "Portfolio", icon: "▦", key: "1",
    note: "What you own and what it earns",
    tabs: [
      { page: "portfolio", label: "Holdings", note: "Holdings, income and concentration" },
    ],
  },
  {
    // ITS OWN DESK (UI clean-up, 2026-11): leasing is a third of the engine's
    // work on a building and the player's most frequent decision.
    id: "leasing", label: "Leasing", icon: "⊟", key: "2",
    note: "Leases, expiries, vacancy and letters",
    tabs: [{ page: "leasing", label: "Leasing", note: "Occupancy, expirations and mandate" }],
  },
  {
    id: "deals", label: "Deals", icon: "✎", key: "3",
    note: "Every live negotiation, bid, contract and job on site",
    tabs: [{ page: "deals", label: "Deals", note: "LOIs, negotiations, contracts and construction" }],
  },
  {
    id: "market", label: "Market", icon: "◎", key: "4",
    note: "What is for sale — buildings, land and distressed paper",
    tabs: [
      { page: "market", label: "For sale", note: "Listings, receiver books and the foreclosure pipeline" },
      // LAND AND BROKERS ARE THEIR OWN TABS (owner, Nov 2026: "instead of all
      // the headers dragging you down the page"): For sale is the tape alone.
      { page: "land", label: "Land", note: "The dirt that pencils, on and off the tape, and the land index" },
      { page: "brokers", label: "Brokers", note: "Off-market calls, your buy box and your standing with each brokerage" },
      // Every standing building in town, sortable — the list you shop from
      // when nothing on the tape fits.
      { page: "buildings", label: "All buildings", note: "Every standing building — size, income, value and owner" },
      // Distressed paper exists only when a bank is selling it, a rival is
      // asking for a bridge, or you hold some. Until then the tab is noise —
      // ⌘K still finds the desk, and it appears the month there is a file.
      {
        page: "notes", label: "Notes", note: "Distressed paper — claims on buildings, not the deed",
        when: (g) => (g.noteOffers?.length ?? 0) + (g.privateAsks?.length ?? 0) + (g.notes?.length ?? 0) > 0,
      },
    ],
  },
  {
    id: "capital", label: "Capital", icon: "⚖", key: "5",
    note: "Loans, lenders, investors and the ledger",
    tabs: [
      { page: "debt", label: "Debt", note: "Loans, refinancing and the line" },
      { page: "banks", label: "Lenders", note: "Every lender's books — capital, income, losses, terms, limits and its loans" },
      { page: "investors", label: "Investors", note: "Your standing with investors, outside equity deal by deal, and the fund" },
      { page: "books", label: "Books", note: "Cash movement, income statement and balance sheet" },
    ],
  },
  {
    // Markets, the Tape, the other firms and your own record: everything you
    // read rather than act on. Pulse is gone (UI clean-up, 2026-11): every
    // figure on it was on Markets or the Tape.
    id: "city", label: "City", icon: "∿", key: "6", home: true,
    note: "The markets, the tape, the players and your record",
    tabs: [
      { page: "economy", label: "Markets", note: "Each space market, rates, the city's economy and its budget" },
      { page: "industries", label: "Industries", note: "Every trade in town: jobs, sales, margins, its firms, your tenants and its supply chain" },
      { page: "news", label: "Tape", note: "Headlines and closed sales" },
      { page: "players", label: "Players", note: "Competitors and every owner in town" },
      { page: "rankings", label: "Rankings", note: "How this town ranks against real US cities" },
      { page: "firm", label: "Record", note: "Every deed, delivery, exit and refinancing since founding" },
    ],
  },
];

/** The property file belongs to the Portfolio desk even though it is not a tab. */
export function deskOf(page: Page): Desk | null {
  if (page === "property") return DESKS[0];
  return DESKS.find((d) => d.tabs.some((t) => t.page === page)) ?? null;
}

export function tabLabel(page: Page): string | null {
  for (const d of DESKS) for (const t of d.tabs) if (t.page === page) return t.label === "Holdings" ? "Portfolio" : t.label;
  return null;
}

/** The tabs a desk shows right now. The open page always keeps its tab. */
export function visibleTabs(d: Desk, g: GameState | null, page?: Page): readonly DeskTab[] {
  return d.tabs.filter((t) => !t.when || t.page === page || (g ? t.when(g) : false));
}

// The tab a desk opens on: wherever the player last was in it, this session.
const lastTab: Partial<Record<DeskId, Page>> = {};
export function rememberTab(page: Page) {
  const d = deskOf(page);
  if (d && page !== "property") lastTab[d.id] = page;
}
export function deskLanding(d: Desk, counts?: TabCounts, g?: GameState | null): Page {
  const tabs = visibleTabs(d, g ?? null);
  if (d.home) return tabs[0].page;
  // Something waiting on a tab outranks habit — the badge is why they clicked.
  if (counts) {
    const hot = tabs.find((t) => (counts[t.page] ?? 0) > 0);
    if (hot) return hot.page;
  }
  const last = lastTab[d.id];
  return last && tabs.some((t) => t.page === last) ? last : tabs[0].page;
}

/**
 * WHAT WANTS AN ANSWER, PER TAB. Moved here from the top bar so the rail badge
 * and the tab badge inside the desk count the same thing.
 */
export type TabCounts = Partial<Record<Page, number>> & {
  debtWarn?: "swept" | "wall" | null; bcallSoon?: number; debtBal?: number; debtWall?: number;
};

export function tabCounts(g: GameState): TabCounts {
  const loisOnDesk = g.lois.filter((l) => loiNeedsPrincipal(g, l)).length;
  const asksOnDesk = (g.asks ?? []).filter((a) => !g.holdings[a.bbl]?.groundLeased).length;
  // Count every decision that actually lives on Deals — tenant relief,
  // purchase counters, contracts and portfolio bids as well as LOIs.
  const deals = loisOnDesk
    + asksOnDesk
    + Object.keys(g.talks ?? {}).length
    + (g.portfolioSale?.bids?.length ?? 0)
    + Object.values(g.holdings).filter((h) => h.sale?.offer || (h.sale?.bids ?? []).some((b) => !b.dropped)).length;
  // What happened THIS MONTH that was not routine.
  const news = g.news.filter((n) => n.q === g.month && (n.kind === "warn" || n.kind === "event")).length;
  // Off-market files lapse twelve months after they land whether or not
  // anybody read them, so they are counted like News: what wants an answer.
  const bcalls = liveBrokerCalls(g);
  const booksLive = (g.portfolios ?? []).filter((p) => !p.player).length
    + ((g.auction && g.month < g.auction.m) ? 1 : 0);
  const notes = (g.noteOffers?.length ?? 0)
    + (g.privateAsks?.length ?? 0)
    + (g.notes ?? []).filter((n) => n.perf === "nonperforming" && n.filedM === undefined).length;
  // One debt list for the whole UI (ui/next/derive.ts debtBook), so the badge
  // and the new HUD cannot disagree about what is owed.
  const book = debtBook(g);
  const debtBal = book.secured, debtWall = book.wall;
  const privateBorrowLive = g.privateBorrowQuotes?.length ?? 0;
  const debtWarn = g.facility?.breachedSince ? "swept"
    : privateBorrowLive > 0 || (debtBal > 0 && debtWall / debtBal > 0.35) ? "wall" : null;
  return {
    market: booksLive,
    brokers: bcalls.length,
    deals,
    notes,
    news,
    debtWarn,
    bcallSoon: bcalls.length ? Math.max(0, bcalls[0].lapseM - g.month) : 0,
    debtBal, debtWall,
  };
}

export function deskCount(d: Desk, c: TabCounts): number {
  return d.tabs.reduce((n, t) => n + (c[t.page] ?? 0), 0);
}
