// WHICH LEDGER EVENT STANDS BEHIND A NUMBER ON A SCREEN (ONE_ECONOMY_PLAN §6e).
// The engine marks the latest move of every market-wide number (whyReads.ts,
// market.ts `market.rent`, propmarket.ts `market.cap`, citygov.ts); these read
// the marks, and write the one line a screen puts on top of the chain: how
// its own number is made from the market's. Pure reads.
import type { BuiltClass, GameState } from "@/engine/types";
import { whyAt, whyGet, whyLatest } from "@/engine/why";
import { lenderByName } from "@/engine/lenders";

const pc = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const m$ = (x: number) => Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${Math.round(x / 1000)}k`;
const WORD: Record<BuiltClass, string> = { office: "office", retail: "retail", multifamily: "apartment", industrial: "industrial" };

/** A class's cap rate: the read off its trades. */
export const capWhy = (g: GameState, k: BuiltClass) => g.econ.capRead?.[k]?.why ?? whyAt(g, `cap:${k}`);
/** A class's market rent: the leases signed (apartments: the flats' own rent). */
export const rentWhy = (g: GameState, k: BuiltClass) => whyAt(g, `rent:${k}`);
/** A class's availability. */
export const vacWhy = (g: GameState, k: BuiltClass) => whyAt(g, `vac:${k}`);
export const landWhy = (g: GameState) => whyAt(g, "land");
export const costWhy = (g: GameState) => whyAt(g, "cost");
export const wageWhy = (g: GameState) => whyAt(g, "wage");
export const taxWhy = (g: GameState) => whyAt(g, "tax");
export const rateWhy = (g: GameState) => whyAt(g, "rate");
/** An industry's latest month in the ledger (economy.ts `whyIndustry`), within a year. */
export const industryWhy = (g: GameState, id: string) => whyLatest(g, `industry:${id}`, 12);

/** "Appraisal $4.10M · NOI $270k a year, 6.59% of value · office cap 6.50%" */
export function valueLead(g: GameState, k: BuiltClass, value: number, noi: number): string {
  const cap = g.econ.capRate[k];
  return `Appraisal ${m$(value)} · NOI ${m$(noi)} a year, ${value > 0 ? pc(noi / value) : "—"} of value · ${WORD[k]} cap ${cap.toFixed(2)}%`;
}

/** "Market rent here $48/sf = office $42.10 after concessions × 1.14 for this building" (value.ts marketLegRent) */
export function rentLead(g: GameState, k: BuiltClass, here: number): string {
  const idx = g.econ.effRentIdx?.[k] ?? g.econ.rentIdx[k];
  return `Market rent here $${here.toFixed(0)}/sf = ${WORD[k]} rent $${idx.toFixed(2)} after concessions × ${idx > 0 ? (here / idx).toFixed(2) : "—"} for this building's address, floor plate and quality`;
}

/** A desk's loan price: its own last repricing (lenders.ts `bank.widen`/`bank.sharpen`), else the base rate's move. */
export function loanWhy(g: GameState, lender: string): number | undefined {
  const l = lenderByName(g, lender);
  return (l?.pitchWhy && whyGet(g, l.pitchWhy) ? l.pitchWhy : undefined) ?? rateWhy(g);
}
/** "Coupon 6.80% = base rate 4.58% + 2.22 pts from First Harbor" */
export function loanLead(g: GameState, lender: string, ratePct: number): string {
  const base = g.econ.indexRate, d = ratePct - base;
  return `Coupon ${ratePct.toFixed(2)}% = base rate ${base.toFixed(2)}% ${d >= 0 ? "+" : "−"} ${Math.abs(d).toFixed(2)} pts from ${lender}`;
}
