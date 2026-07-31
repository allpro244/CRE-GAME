// Structured debt: fixed or floating at origination, IO periods, balloon
// maturities that must refinance or repay, DSCR/LTV covenants tested every
// quarter, and cash sweeps on breach. Proceeds gate on DSCR at underwriting,
// not just LTV — a lender lends against income, not hope.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import { resolveRec } from "./value";
import type { GameState, Holding, Loan } from "./types";
import { holdingNOIYr, holdingValue } from "./value";

export interface LoanProduct {
  id: "fixed" | "float";
  label: string;
  ltv: number;
  spread: number;      // over the index
  ioQ: number;
  amortYears: number;
  termQ: number;       // balloon
}

export const PRODUCTS: LoanProduct[] = [
  { id: "fixed", label: "Fixed 65%", ltv: 0.65, spread: 1.6, ioQ: 0, amortYears: 30, termQ: 40 },
  { id: "float", label: "Floating IO 70%", ltv: 0.7, spread: 1.15, ioQ: 12, amortYears: 30, termQ: 28 },
];

const UW_DSCR = 1.25;
const REFI_FEE = 0.01;

function quarterlyPayment(principal: number, ratePct: number, years: number): number {
  const i = ratePct / 100 / 4;
  const n = years * 4;
  return (principal * i) / (1 - Math.pow(1 + i, -n));
}

export function quote(s: GameState, product: LoanProduct, price: number, noiYr: number) {
  const ratePct = +(s.econ.indexRate + product.spread).toFixed(2);
  const byLtv = product.ltv * price;
  // DSCR gate: size the loan so underwriting NOI covers debt service 1.25x
  const maxAnnualDS = Math.max(0, noiYr) / UW_DSCR;
  const i = ratePct / 100;
  const byDscrIO = maxAnnualDS / i;
  const qp = quarterlyPayment(1, ratePct, product.amortYears) * 4; // annual DS per $1
  const byDscrAmort = maxAnnualDS / qp;
  const byDscr = product.ioQ > 0 ? Math.min(byDscrIO, byDscrAmort * 1.08) : byDscrAmort;
  const principal = Math.max(0, Math.round(Math.min(byLtv, byDscr)));
  return { principal, ratePct, dscrConstrained: byDscr < byLtv };
}

export function originate(s: GameState, product: LoanProduct, price: number, noiYr: number): Loan | null {
  const qd = quote(s, product, price, noiYr);
  if (qd.principal < 100_000) return null;
  const pmt = product.ioQ > 0
    ? Math.round((qd.principal * qd.ratePct) / 100 / 4)
    : Math.round(quarterlyPayment(qd.principal, qd.ratePct, product.amortYears));
  return {
    product: product.id,
    principal: qd.principal,
    balance: qd.principal,
    ratePct: qd.ratePct,
    spread: product.spread,
    ioUntilQ: s.quarter + product.ioQ,
    amortYears: product.amortYears,
    maturityQ: s.quarter + product.termQ,
    quarterlyPmt: pmt,
    minDSCR: 1.2,
    maxLTV: 0.85,
    sweep: false,
    cleanQs: 0,
    originQ: s.quarter,
  };
}

export function dscr(rec: ParcelRecord, s: GameState, h: Holding): number | null {
  if (!h.loan) return null;
  const ds = h.loan.quarterlyPmt * 4;
  if (ds <= 0) return null;
  return holdingNOIYr(rec, s.econ, h, s.quarter) / ds;
}

export function ltv(rec: ParcelRecord, s: GameState, h: Holding): number | null {
  if (!h.loan) return null;
  const v = holdingValue(rec, s.econ, h);
  return v > 0 ? h.loan.balance / v : null;
}

// One quarter of debt life for a holding. Returns the cash the loan takes
// this quarter (debt service, plus any sweep of surplus cash flow).
export function tickLoan(s: GameState, rec: ParcelRecord | null, h: Holding, assetCF: number): number {
  const loan = h.loan;
  if (!loan || !rec) return 0;
  const q = s.quarter;

  // floating: reprice off the live index
  if (loan.product === "float") {
    loan.ratePct = +(s.econ.indexRate + loan.spread).toFixed(2);
  }
  const io = q < loan.ioUntilQ;
  if (io || loan.product === "float") {
    const yearsLeft = Math.max(1, loan.amortYears - (q - loan.originQ) / 4);
    loan.quarterlyPmt = io
      ? Math.round((loan.balance * loan.ratePct) / 100 / 4)
      : Math.round(quarterlyPayment(loan.balance, loan.ratePct, yearsLeft));
  }

  const interest = (loan.balance * loan.ratePct) / 100 / 4;
  const principalPay = io ? 0 : Math.min(loan.balance, loan.quarterlyPmt - interest);
  loan.balance = Math.max(0, loan.balance - principalPay);
  let cashOut = loan.quarterlyPmt;

  // covenants
  const d = dscr(rec, s, h);
  const l = ltv(rec, s, h);
  const breached = (d !== null && d < loan.minDSCR) || (l !== null && l > loan.maxLTV);
  if (breached) {
    if (!loan.sweep) {
      s.news.unshift({
        q, kind: "warn",
        text: `Covenant breach at ${rec.address} (${d !== null && d < loan.minDSCR ? `DSCR ${d.toFixed(2)}` : `LTV ${(100 * (l ?? 0)).toFixed(0)}%`}) — the lender trapped the cash flow.`,
      });
    }
    loan.sweep = true;
    loan.cleanQs = 0;
  } else if (loan.sweep) {
    loan.cleanQs++;
    if (loan.cleanQs >= 2) {
      loan.sweep = false;
      s.news.unshift({ q, kind: "info", text: `Covenants cured at ${rec.address} — the sweep is off.` });
    }
  }
  // sweep: surplus asset cash flow pays down principal instead of reaching you
  if (loan.sweep) {
    const surplus = Math.max(0, assetCF - loan.quarterlyPmt);
    if (surplus > 0) {
      loan.balance = Math.max(0, loan.balance - surplus);
      cashOut += surplus;
    }
  }
  if (loan.balance === 0) { h.loan = null; return cashOut; }

  // the balloon
  if (q >= loan.maturityQ) {
    const value = holdingValue(rec, s.econ, h);
    const noi = holdingNOIYr(rec, s.econ, h, q);
    const product = PRODUCTS[0];
    const qd = quote(s, product, value, noi);
    const fee = Math.round(loan.balance * REFI_FEE);
    if (qd.principal >= loan.balance + fee) {
      const cashOutRefi = qd.principal - loan.balance - fee;
      h.loan = originate(s, product, value, noi);
      if (h.loan) h.loan.balance = h.loan.principal = qd.principal;
      s.cash += cashOutRefi;
      s.news.unshift({
        q, kind: "deal",
        text: `Balloon at ${rec.address} refinanced at ${qd.ratePct.toFixed(2)}%${cashOutRefi > 100_000 ? ` — $${(cashOutRefi / 1e6).toFixed(2)}M cash-out` : ""}.`,
      });
    } else {
      const shortfall = loan.balance + fee - qd.principal;
      if (s.cash >= shortfall) {
        s.cash -= shortfall;
        h.loan = qd.principal > 100_000 ? originate(s, product, value, noi) : null;
        s.news.unshift({
          q, kind: "warn",
          text: `Balloon at ${rec.address}: today's market only refinances $${(qd.principal / 1e6).toFixed(1)}M — you wrote a $${(shortfall / 1e6).toFixed(2)}M check to close the gap.`,
        });
      } else {
        // forced sale
        const gross = Math.round(value * 0.92);
        s.cash += gross - loan.balance;
        delete s.holdings[h.bbl];
        s.news.unshift({
          q, kind: "warn",
          text: `The balloon came due at ${rec.address} with no refi and no cash — sold under pressure at $${(gross / 1e6).toFixed(2)}M.`,
        });
      }
    }
  }
  return cashOut;
}

// Player-initiated refinance at current rates and value.
export function refinance(s: GameState, parcels: ParcelTable, bbl: string, productId: "fixed" | "float"): { s: GameState; err?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const h = next.holdings[bbl];
  const rec = resolveRec(parcels, next, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  const product = PRODUCTS.find((p) => p.id === productId)!;
  const value = holdingValue(rec, next.econ, h);
  const noi = holdingNOIYr(rec, next.econ, h, next.quarter);
  const qd = quote(next, product, value, noi);
  const oldBal = h.loan?.balance ?? 0;
  const fee = Math.round(Math.max(qd.principal, oldBal) * REFI_FEE);
  if (qd.principal < 100_000) return { s, err: "No lender will size a loan against this income." };
  if (qd.principal + next.cash < oldBal + fee) return { s, err: "Proceeds don't cover the payoff — you're underwater on this refi." };
  const newLoan = originate(next, product, value, noi);
  if (!newLoan) return { s, err: "No lender will size a loan against this income." };
  next.cash += qd.principal - oldBal - fee;
  h.loan = newLoan;
  next.news.unshift({
    q: next.quarter, kind: "deal",
    text: `Refinanced ${rec.address}: $${(qd.principal / 1e6).toFixed(2)}M at ${qd.ratePct.toFixed(2)}% (${product.label}).`,
  });
  return { s: next };
}
