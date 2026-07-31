// newGame + advanceQuarter — the pure heart of the game. No DOM, no store:
// (state, parcels) in, state out. The UI is a lens on this.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState, Listing } from "./types";
import { START_CASH, quarterLabel } from "./types";
import { initEcon, rng, rrange, tickEcon } from "./market";
import { assetValue, initialCondition, quarterlyNOI } from "./value";
import { tickLeasing } from "./leasing";
import { tickLoan } from "./debt";

const TARGET_LISTINGS = 44;
const LISTING_LIFE_Q: [number, number] = [2, 4];

export function newGame(seed: number): GameState {
  const s: GameState = {
    v: 2,
    seed,
    rng: seed,
    quarter: 0,
    cash: START_CASH,
    econ: null as never,
    holdings: {},
    listings: [],
    lois: [],
    nextLoiId: 1,
    approaches: {},
    news: [],
    gameOver: null,
    insolventQs: 0,
  };
  s.econ = initEcon(s);
  s.news.push({
    q: 0,
    kind: "info",
    text: `${quarterLabel(0)}. You arrive in Ashport with $6M and an appetite. This town is young — half of it hasn't been built yet, and everything has a price.`,
  });
  return s;
}

// Rotating for-sale stock: mostly assets a $6–50M buyer can reach, with the
// occasional trophy so the skyline stays aspirational.
export function refreshListings(s: GameState, parcels: ParcelTable, bbls: string[]) {
  s.listings = s.listings.filter((l) => l.expiresQ > s.quarter && !s.holdings[l.bbl]);
  const listed = new Set(s.listings.map((l) => l.bbl));
  let guard = 0;
  while (s.listings.length < TARGET_LISTINGS && guard++ < 4000) {
    const bbl = bbls[Math.floor(rng(s) * bbls.length)];
    if (listed.has(bbl) || s.holdings[bbl]) continue;
    const rec = parcels[bbl];
    if (!rec) continue;
    const value = assetValue(rec, s.econ, initialCondition(rec));
    if (value <= 0) continue;
    if (value > 60_000_000 && rng(s) > 0.12) continue;
    const ask = Math.round(value * rrange(s, 0.94, 1.1) / 1000) * 1000;
    s.listings.push({
      bbl,
      ask,
      listedQ: s.quarter,
      expiresQ: s.quarter + Math.round(rrange(s, ...LISTING_LIFE_Q)),
    } satisfies Listing);
    listed.add(bbl);
  }
}

export function advanceQuarter(prev: GameState, parcels: ParcelTable, bbls: string[]): GameState {
  if (prev.gameOver) return prev;
  const s: GameState = JSON.parse(JSON.stringify(prev));
  s.quarter++;

  tickEcon(s);
  tickLeasing(s, parcels);

  // holdings: collect NOI, run the debt stack, finish renovations
  let quarterCF = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = parcels[h.bbl];
    if (!rec) continue;
    if (h.renovatingUntilQ !== undefined && s.quarter >= h.renovatingUntilQ) {
      h.condition = "good";
      delete h.renovatingUntilQ;
      s.news.unshift({ q: s.quarter, kind: "deal", text: `Renovation complete at ${rec.address} — space re-opens at the new rent.` });
    }
    const noiQ = quarterlyNOI(rec, s.econ, h, s.quarter);
    const debtCash = tickLoan(s, parcels, h, noiQ); // may refi, sweep, or force a sale
    if (!s.holdings[h.bbl]) continue; // forced sale removed it
    const cf = noiQ - debtCash;
    h.cfHistory.push(Math.round(cf));
    if (h.cfHistory.length > 40) h.cfHistory.shift();
    quarterCF += cf;
  }
  s.cash += quarterCF;

  // expire stale off-market asks
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (s.quarter > a.q + 4) delete s.approaches[bbl];
  }

  // insolvency: four straight quarters underwater ends the run
  if (s.cash < 0) {
    s.insolventQs++;
    if (s.insolventQs === 2) {
      s.news.unshift({ q: s.quarter, kind: "warn", text: "Your lenders have noticed the negative balance. Two more quarters of this and it's over." });
    }
    if (s.insolventQs >= 4) {
      s.gameOver = {
        cause: "Insolvency: cash stayed negative for four consecutive quarters. The portfolio was liquidated to satisfy creditors.",
      };
      s.news.unshift({ q: s.quarter, kind: "warn", text: "The run is over — the creditors own it now." });
    }
  } else {
    s.insolventQs = 0;
  }

  refreshListings(s, parcels, bbls);
  if (s.news.length > 120) s.news.length = 120;
  return s;
}

// Convenience for the UI: total quarterly cash flow at current state.
export function portfolioQuarterlyCF(s: GameState, parcels: ParcelTable): number {
  let cf = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = parcels[h.bbl];
    if (!rec) continue;
    cf += quarterlyNOI(rec, s.econ, h, s.quarter) - (h.loan?.quarterlyPmt ?? 0);
  }
  return cf;
}

export function firstListings(s: GameState, parcels: ParcelTable, bbls: string[]): GameState {
  const next = JSON.parse(JSON.stringify(s)) as GameState;
  refreshListings(next, parcels, bbls);
  return next;
}

export type { ParcelRecord };
