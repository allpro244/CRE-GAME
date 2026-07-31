// newGame + advanceQuarter — the pure heart of the game. No DOM, no store:
// (state, parcels) in, state out. The UI is a lens on this.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { START_CASH, quarterLabel } from "./types";
import { initEcon, rng, rrange, tickEcon } from "./market";
import { assetValue, initialCondition, quarterlyNOI } from "./value";

const TARGET_LISTINGS = 44;
const LISTING_LIFE_Q: [number, number] = [2, 4];

export function newGame(seed: number): GameState {
  const s: GameState = {
    v: 1,
    seed,
    rng: seed,
    quarter: 0,
    cash: START_CASH,
    econ: null as never,
    holdings: {},
    listings: [],
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
    // keep the tape reachable: bias toward sub-$60M, allow rare whales
    if (value > 60_000_000 && rng(s) > 0.12) continue;
    const ask = Math.round(value * rrange(s, 0.94, 1.1) / 1000) * 1000;
    s.listings.push({
      bbl,
      ask,
      listedQ: s.quarter,
      expiresQ: s.quarter + Math.round(rrange(s, ...LISTING_LIFE_Q)),
    });
    listed.add(bbl);
  }
}

export function advanceQuarter(prev: GameState, parcels: ParcelTable, bbls: string[]): GameState {
  if (prev.gameOver) return prev;
  const s: GameState = JSON.parse(JSON.stringify(prev));
  s.quarter++;

  tickEcon(s);

  // holdings: collect NOI, pay debt, finish renovations
  let quarterCF = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = parcels[h.bbl];
    if (!rec) continue;
    if (h.renovatingUntilQ !== undefined && s.quarter >= h.renovatingUntilQ) {
      h.condition = "good";
      delete h.renovatingUntilQ;
      s.news.unshift({ q: s.quarter, kind: "deal", text: `Renovation complete at ${rec.address} — space re-opens at the new rent.` });
    }
    let cf = quarterlyNOI(rec, s.econ, h, s.quarter);
    if (h.loan) {
      const interest = (h.loan.balance * h.loan.ratePct) / 100 / 4;
      const principal = Math.min(h.loan.balance, h.loan.quarterlyPmt - interest);
      h.loan.balance = Math.max(0, h.loan.balance - principal);
      cf -= h.loan.quarterlyPmt;
      if (h.loan.balance === 0) h.loan = null;
    }
    h.cfHistory.push(Math.round(cf));
    if (h.cfHistory.length > 40) h.cfHistory.shift();
    quarterCF += cf;
  }
  s.cash += quarterCF;

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
