// The simulation state. Everything the game knows that isn't static parcel
// data lives here, and it must stay JSON-serializable — saves are snapshots.
import type { AssetClass } from "@/data/types";

export type MarketPhase = "recovery" | "expansion" | "peak" | "recession";

export type BuiltClass = Exclude<AssetClass, "land">;
export const BUILT_CLASSES: BuiltClass[] = ["office", "retail", "mixed", "multifamily"];

export type Condition = "worn" | "standard" | "good";

export type Sector =
  | "finance" | "law" | "tech" | "media" | "insurance"
  | "logistics" | "apparel" | "food" | "medical" | "design";

export type Credit = 0 | 1 | 2; // C, B, A
export const CREDIT_LABEL = ["C", "B", "A"];

export interface Tenant {
  name: string;
  sector: Sector;
  credit: Credit;
  sf: number;
  rentPsf: number;     // $/sf/yr
  net: boolean;        // NNN (tenant pays opex) vs gross
  startQ: number;
  endQ: number;        // lease expiration
  freeUntilQ?: number; // free-rent concession
}

export interface LOI {
  id: number;
  bbl: string;
  kind: "new" | "renewal";
  name: string;
  sector: Sector;
  credit: Credit;
  sf: number;
  rentPsf: number;
  termQ: number;
  tiPsf: number;       // tenant-improvement allowance, $/sf at signing
  freeQ: number;       // free-rent quarters
  net: boolean;
  expiresQ: number;
  countered?: boolean;
  tenantIdx?: number;  // renewals: index into holding.tenants
}

export interface Loan {
  product: "fixed" | "float";
  principal: number;
  balance: number;
  ratePct: number;       // current coupon (floating reprices each quarter)
  spread: number;        // over the index, for floating
  ioUntilQ: number;      // interest-only through this quarter
  amortYears: number;
  maturityQ: number;     // the balloon
  quarterlyPmt: number;
  minDSCR: number;       // covenants, tested quarterly
  maxLTV: number;
  sweep: boolean;        // breach: cash flow trapped to principal until cured
  cleanQs: number;
  originQ: number;
}

export interface Holding {
  bbl: string;
  boughtQ: number;
  costBasis: number;
  loan: Loan | null;
  condition: Condition;
  renovatingUntilQ?: number;
  tenants: Tenant[];   // commercial rent roll
  occ?: number;        // multifamily aggregate occupancy
  cfHistory: number[];
}

export interface Listing {
  bbl: string;
  ask: number;
  listedQ: number;
  expiresQ: number;
}

export interface Approach {
  q: number;           // when the owner was approached
  refused: boolean;
  ask?: number;        // if willing: their number, good for 4 quarters
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
  indexRate: number;
  phase: MarketPhase;
  phaseQLeft: number;
  rumoredPhase: MarketPhase | null;
  cycleDev: number;
  landIdx: number;
  capRate: Record<BuiltClass, number>;
  rentIdx: Record<BuiltClass, number>;
  history: EconHistoryPoint[];
}

export interface GameState {
  v: 2;
  seed: number;
  rng: number;
  quarter: number;
  cash: number;
  econ: Econ;
  holdings: Record<string, Holding>;
  listings: Listing[];
  lois: LOI[];
  nextLoiId: number;
  approaches: Record<string, Approach>;
  news: NewsItem[];
  gameOver: { cause: string } | null;
  insolventQs: number;
}

export const START_CASH = 6_000_000;
export const START_YEAR = 2026;

export function quarterLabel(q: number): string {
  return `${START_YEAR + Math.floor(q / 4)} Q${(q % 4) + 1}`;
}
