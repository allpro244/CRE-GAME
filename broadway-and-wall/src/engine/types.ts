// The simulation state. Everything the game knows that isn't static parcel
// data lives here, and it must stay JSON-serializable — saves are snapshots.
import type { AssetClass } from "@/data/types";

export type MarketPhase = "recovery" | "expansion" | "peak" | "recession";

export type BuiltClass = Exclude<AssetClass, "land">;
export const BUILT_CLASSES: BuiltClass[] = ["office", "retail", "mixed", "multifamily"];

export type Condition = "worn" | "standard" | "good";

export interface Loan {
  principal: number;
  balance: number;
  ratePct: number;       // fixed at origination
  quarterlyPmt: number;  // 30-year amortization, quarterly
  originQ: number;
}

export interface Holding {
  bbl: string;
  boughtQ: number;
  costBasis: number;      // price + closing costs
  loan: Loan | null;
  condition: Condition;
  renovatingUntilQ?: number;
  cfHistory: number[];    // net cash flow per quarter, capped
}

export interface Listing {
  bbl: string;
  ask: number;
  listedQ: number;
  expiresQ: number;
}

export interface NewsItem {
  q: number;
  kind: "rumor" | "event" | "deal" | "info" | "warn";
  text: string;
}

export interface EconHistoryPoint {
  q: number;
  indexRate: number;
  landIdx: number;
  cycleDev: number;
  capOffice: number;
  rentOffice: number;
}

export interface Econ {
  indexRate: number;                    // loan index, pct
  phase: MarketPhase;
  phaseQLeft: number;
  rumoredPhase: MarketPhase | null;     // the ticker whispers before the turn
  cycleDev: number;                     // -1 (trough) … +1 (froth)
  landIdx: number;                      // citywide land value index, 1.0 at start
  capRate: Record<BuiltClass, number>;  // pct
  rentIdx: Record<BuiltClass, number>;  // $/sf/yr, citywide average for the class
  history: EconHistoryPoint[];
}

export interface GameState {
  v: 1;
  seed: number;
  rng: number;            // mulberry32 state — save it, replay stays honest
  quarter: number;        // 0 = 2026 Q1
  cash: number;
  econ: Econ;
  holdings: Record<string, Holding>;
  listings: Listing[];
  news: NewsItem[];
  gameOver: { cause: string } | null;
  insolventQs: number;    // consecutive quarters cash < 0
}

export const START_CASH = 6_000_000;
export const START_YEAR = 2026;

export function quarterLabel(q: number): string {
  return `${START_YEAR + Math.floor(q / 4)} Q${(q % 4) + 1}`;
}
