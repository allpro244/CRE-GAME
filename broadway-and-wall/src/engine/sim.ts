// newGame + advanceQuarter — the pure heart of the game. No DOM, no store:
// (state, parcels) in, state out. The UI is a lens on this.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState, Listing } from "./types";
import { START_CASH, CAMPAIGN_MONTHS, monthLabel } from "./types";
import { initEcon, rng, rrange, tickEcon } from "./market";
import { assetValue, initialCondition, monthlyNOI, resolveRec } from "./value";
import { tickLeasing } from "./leasing";
import { tickSales } from "./actions";
import { tickLoan } from "./debt";
import { tickDevelopments, tickPrograms, tickCityGrowth } from "./dev";

const LISTING_LIFE_M: [number, number] = [6, 12];

// 0.5–1.5% of the city is on the market at any time: thin in expansions
// (owners hold), heavier in recessions (distress shakes assets loose).
function targetListings(s: GameState, totalLots: number): number {
  const pct = s.econ.phase === "recession" ? 0.014
    : s.econ.phase === "peak" ? 0.011
    : s.econ.phase === "recovery" ? 0.009
    : 0.006;
  return Math.max(6, Math.round(totalLots * pct));
}

export function newGame(seed: number, parcels?: ParcelTable): GameState {
  const s: GameState = {
    v: 5,
    seed,
    rng: seed,
    month: 0,
    cash: START_CASH,
    econ: null as never,
    holdings: {},
    listings: [],
    lois: [],
    nextLoiId: 1,
    approaches: {},
    developments: {},
    built: {},
    cityBuilt: [],
    landAdj: {},
    totalLots: parcels ? Object.keys(parcels).length : 0,
    builtAtStart: parcels ? Object.values(parcels).filter((p) => p.class !== "land").length : 0,
    news: [],
    gameOver: null,
    insolventMs: 0,
  };
  s.econ = initEcon(s);
  s.news.push({
    q: 0,
    kind: "info",
    text: `${monthLabel(0)}. You arrive in Ashport with $6M and a hundred years. Two-fifths of this town is still empty lots — the city will fill in around you, with or without your name on it.`,
  });
  return s;
}

// Rotating for-sale stock: mostly assets a $6–50M buyer can reach, with the
// occasional trophy so the skyline stays aspirational.
export function refreshListings(s: GameState, parcels: ParcelTable, bbls: string[]) {
  s.listings = s.listings.filter((l) => l.expiresM > s.month && !s.holdings[l.bbl]);
  const listed = new Set(s.listings.map((l) => l.bbl));
  const target = targetListings(s, bbls.length);
  let guard = 0;
  while (s.listings.length < target && guard++ < 4000) {
    const bbl = bbls[Math.floor(rng(s) * bbls.length)];
    if (listed.has(bbl) || s.holdings[bbl]) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const value = assetValue(rec, s.econ, initialCondition(rec));
    if (value <= 0) continue;
    if (value > 60_000_000 && rng(s) > 0.12) continue;
    const ask = Math.round(value * rrange(s, 0.94, 1.1) / 1000) * 1000;
    s.listings.push({
      bbl,
      ask,
      listedM: s.month,
      expiresM: s.month + Math.round(rrange(s, ...LISTING_LIFE_M)),
    } satisfies Listing);
    listed.add(bbl);
  }
}

export function advanceQuarter(
  prev: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null = null,
): GameState {
  if (prev.gameOver) return prev;
  const s: GameState = JSON.parse(JSON.stringify(prev));
  s.month++;

  tickEcon(s);
  tickCityGrowth(s, parcels, bbls, adjacency);
  tickDevelopments(s, parcels);
  tickPrograms(s, parcels);
  tickLeasing(s, parcels);
  tickSales(s, parcels);

  // holdings: collect NOI, run the debt stack, finish renovations
  let monthCF = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    if (h.renovatingUntilM !== undefined && s.month >= h.renovatingUntilM) {
      h.condition = "good";
      delete h.renovatingUntilM;
      s.news.unshift({ q: s.month, kind: "deal", text: `Renovation complete at ${rec.address} — space re-opens at the new rent.` });
    }
    const noiQ = monthlyNOI(rec, s.econ, h, s.month);
    const debtCash = tickLoan(s, rec, h, noiQ); // may refi, sweep, or force a sale
    if (!s.holdings[h.bbl]) continue; // forced sale removed it
    const cf = noiQ - debtCash;
    h.cfHistory.push(Math.round(cf));
    if (h.cfHistory.length > 40) h.cfHistory.shift();
    monthCF += cf;
  }
  s.cash += monthCF;

  // expire stale off-market asks
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (s.month > a.q + 12) delete s.approaches[bbl];
  }

  // insolvency: four straight quarters underwater ends the run
  if (s.cash < 0) {
    s.insolventMs++;
    if (s.insolventMs === 6) {
      s.news.unshift({ q: s.month, kind: "warn", text: "Your lenders have noticed the negative balance. Six more months of this and it's over." });
    }
    if (s.insolventMs >= 12) {
      s.gameOver = {
        cause: "Insolvency: cash stayed negative for a full year. The portfolio was liquidated to satisfy creditors.",
      };
      s.news.unshift({ q: s.month, kind: "warn", text: "The run is over — the creditors own it now." });
    }
  } else {
    s.insolventMs = 0;
  }

  // the century ends
  if (!s.gameOver && s.month >= CAMPAIGN_MONTHS) {
    s.gameOver = {
      complete: true,
      cause: `A hundred years in Ashport. The town you arrived in was two-fifths empty lots; ${Math.round((100 * (s.builtAtStart + Object.keys(s.built).length)) / Math.max(1, s.totalLots))}% of it stands built today, and ${Object.keys(s.holdings).length} of those buildings are yours.`,
    };
    s.news.unshift({ q: s.month, kind: "event", text: "A century of Ashport. The ledger closes." });
  }

  refreshListings(s, parcels, bbls);
  if (s.news.length > 120) s.news.length = 120;
  return s;
}

// Convenience for the UI: total quarterly cash flow at current state.
export function portfolioQuarterlyCF(s: GameState, parcels: ParcelTable): number {
  let cf = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    cf += monthlyNOI(rec, s.econ, h, s.month) - (h.loan?.monthlyPmt ?? 0);
  }
  for (const d of Object.values(s.developments ?? {})) {
    cf -= (d.loanBalance * d.ratePct) / 100 / 12; // construction interest
  }
  return cf;
}

export function firstListings(s: GameState, parcels: ParcelTable, bbls: string[]): GameState {
  const next = JSON.parse(JSON.stringify(s)) as GameState;
  refreshListings(next, parcels, bbls);
  return next;
}

export type { ParcelRecord };
