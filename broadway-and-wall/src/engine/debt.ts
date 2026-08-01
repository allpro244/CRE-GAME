// Structured debt: fixed or floating at origination, IO periods, balloon
// maturities that must refinance or repay, DSCR/LTV covenants tested every
// quarter, and cash sweeps on breach. Proceeds gate on DSCR at underwriting,
// not just LTV — a lender lends against income, not hope.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import { resolveRec } from "./value";
import type { GameState, Holding, Loan } from "./types";
import { logBooks } from "./types";
import { holdingNOIYr, holdingValue } from "./value";

export type PrepayKind = "open" | "stepdown" | "yieldmaint";

export interface LoanProduct {
  id: string;
  label: string;
  blurb: string;       // what this money is FOR, in one line
  ltv: number;
  spread: number;      // over the index
  floating: boolean;
  ioM: number;
  amortYears: number;
  termM: number;       // balloon
  uwDscr: number;      // the coverage the desk underwrites to
  points: number;      // origination fee, as a share of principal
  recourse: boolean;   // a personal guarantee, and a cheaper coupon for it
  prepay: PrepayKind;
  prepayM: number;     // months the penalty runs
  mezz?: boolean;      // sits behind a senior loan rather than replacing it
  kicker?: number;     // participating paper: the lender's share of the gain
  minDSCR: number;     // the covenant
  maxLTV: number;
}

// The desk. Every line is a different answer to the same question — how much
// certainty are you buying, and what are you paying for it? Cheap money is
// short, or recourse, or takes a piece of your upside. Long money costs more
// and locks you in. There is no dominant choice here on purpose.
export const PRODUCTS: LoanProduct[] = [
  {
    id: "agency", label: "Agency fixed · 10 yr", blurb: "The default. Long, quiet, expensive to leave early.",
    ltv: 0.65, spread: 1.60, floating: false, ioM: 0, amortYears: 30, termM: 120,
    uwDscr: 1.25, points: 0.010, recourse: false, prepay: "yieldmaint", prepayM: 96,
    minDSCR: 1.20, maxLTV: 0.85,
  },
  {
    id: "insurance", label: "Insurance co. fixed · 15 yr", blurb: "Longest money on the desk. Low leverage, no surprises.",
    ltv: 0.58, spread: 1.30, floating: false, ioM: 0, amortYears: 30, termM: 180,
    uwDscr: 1.40, points: 0.008, recourse: false, prepay: "yieldmaint", prepayM: 144,
    minDSCR: 1.30, maxLTV: 0.80,
  },
  {
    id: "float", label: "Floating IO · 7 yr", blurb: "Cheap today, repriced every quarter. Buy a cap or don't sleep.",
    ltv: 0.70, spread: 1.15, floating: true, ioM: 36, amortYears: 30, termM: 84,
    uwDscr: 1.25, points: 0.010, recourse: false, prepay: "open", prepayM: 0,
    minDSCR: 1.20, maxLTV: 0.85,
  },
  {
    id: "bank", label: "Bank fixed · 5 yr, recourse", blurb: "Sharpest coupon on the board — because you signed for it.",
    ltv: 0.68, spread: 0.95, floating: false, ioM: 12, amortYears: 25, termM: 60,
    uwDscr: 1.20, points: 0.006, recourse: true, prepay: "stepdown", prepayM: 36,
    minDSCR: 1.25, maxLTV: 0.82,
  },
  {
    id: "bridge", label: "Bridge IO · 3 yr", blurb: "For a building that doesn't cover yet. Fast, dear, and it matures.",
    ltv: 0.75, spread: 4.00, floating: true, ioM: 36, amortYears: 30, termM: 36,
    uwDscr: 1.00, points: 0.020, recourse: false, prepay: "open", prepayM: 0,
    minDSCR: 1.00, maxLTV: 0.92,
  },
  {
    id: "mezz", label: "Mezzanine · behind the senior", blurb: "Stacks to 85%. The coupon is why nobody does this twice.",
    ltv: 0.85, spread: 8.00, floating: false, ioM: 120, amortYears: 30, termM: 84,
    uwDscr: 1.05, points: 0.025, recourse: false, prepay: "stepdown", prepayM: 48,
    mezz: true, minDSCR: 1.00, maxLTV: 0.95,
  },
  {
    // Land has no income, so nothing else on this desk will touch it. That
    // left a hole you could fall through: buy a site for cash, and you are
    // now poorer, paying tax on dirt, with less equity for the building you
    // bought it to put there. This is expensive, short and recourse — but it
    // means a site can be assembled without eating the whole balance sheet.
    id: "land", label: "Land loan · 3 yr, recourse", blurb: "The only money that will look at dirt. Half the price, and you sign for it.",
    ltv: 0.50, spread: 3.60, floating: true, ioM: 36, amortYears: 30, termM: 36,
    uwDscr: 0, points: 0.015, recourse: true, prepay: "open", prepayM: 0,
    minDSCR: 0, maxLTV: 0.70,
  },
  {
    id: "particip", label: "Participating · 25% of the gain", blurb: "Almost no coupon. The lender takes a quarter of your upside on sale.",
    ltv: 0.78, spread: 0.35, floating: false, ioM: 60, amortYears: 30, termM: 120,
    uwDscr: 1.05, points: 0.010, recourse: false, prepay: "stepdown", prepayM: 60,
    kicker: 0.25, minDSCR: 1.05, maxLTV: 0.90,
  },
];

export const productById = (id: string): LoanProduct => PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0];

const REFI_FEE = 0.01;

/**
 * What it costs to get out of a loan early.
 *  open        — nothing, walk away
 *  stepdown    — 5% of the balance, falling a point a year
 *  yieldmaint  — the lender is made whole on the coupon it was promised, which
 *                is brutal early in the term and the reason long money is a
 *                commitment rather than a preference
 */
export function prepayPenalty(loan: Loan, month: number): number {
  const p = loan.prepay ?? "open";
  const left = Math.max(0, (loan.prepayUntilM ?? 0) - month);
  if (p === "open" || left <= 0) return 0;
  if (p === "stepdown") {
    const yearsLeft = Math.ceil(left / 12);
    return Math.round(loan.balance * Math.min(0.05, 0.01 * yearsLeft));
  }
  // yield maintenance: the coupon the lender loses, discounted roughly
  const yrs = left / 12;
  return Math.round(loan.balance * (loan.ratePct / 100) * yrs * 0.62);
}

function monthlyPayment(principal: number, ratePct: number, years: number): number {
  const i = ratePct / 100 / 12;
  const n = years * 12;
  return (principal * i) / (1 - Math.pow(1 + i, -n));
}

export function quote(s: GameState, product: LoanProduct, price: number, noiYr: number) {
  // Capital availability moves the terms, not just the index. When the credit
  // window closes, spreads widen, advance rates come down and the desk
  // underwrites to a fatter coverage — all at once, which is what makes a
  // crunch a crunch rather than a slightly worse quote.
  const ci = s.econ.creditIdx ?? 1;
  const tight = Math.max(0, 1 - ci);
  const ratePct = +(s.econ.indexRate + product.spread * (1 + 1.1 * tight) + 0.9 * tight).toFixed(2);
  const byLtv = product.ltv * (1 - 0.30 * tight) * price;
  // A site produces no income, so a coverage test would size every land loan
  // at zero. This one is underwritten on the dirt alone, which is why it is
  // half-leverage, short, and comes with a guarantee.
  if (product.uwDscr <= 0) {
    return { principal: Math.max(0, Math.round(byLtv)), ratePct, dscrConstrained: false };
  }
  // DSCR gate: size the loan so underwriting NOI covers debt service
  const maxAnnualDS = Math.max(0, noiYr) / (product.uwDscr + 0.25 * tight);
  const i = ratePct / 100;
  const byDscrIO = maxAnnualDS / i;
  const qp = monthlyPayment(1, ratePct, product.amortYears) * 12; // annual DS per $1
  const byDscrAmort = maxAnnualDS / qp;
  const byDscr = product.ioM >= 12 ? Math.min(byDscrIO, byDscrAmort * 1.08) : byDscrAmort;
  const principal = Math.max(0, Math.round(Math.min(byLtv, byDscr)));
  return { principal, ratePct, dscrConstrained: byDscr < byLtv };
}

// `lev` scales the loan down from the lender's maximum — the player's dial.
export function originate(s: GameState, product: LoanProduct, price: number, noiYr: number, lev = 1): Loan | null {
  const full = quote(s, product, price, noiYr);
  const qd = { ...full, principal: Math.round(full.principal * Math.max(0, Math.min(1, lev))) };
  if (qd.principal < 100_000) return null;
  const pmt = product.ioM > 0
    ? Math.round((qd.principal * qd.ratePct) / 100 / 12)
    : Math.round(monthlyPayment(qd.principal, qd.ratePct, product.amortYears));
  return {
    product: product.id,
    floating: product.floating,
    points: product.points,
    recourse: product.recourse,
    prepay: product.prepay,
    prepayUntilM: s.month + product.prepayM,
    kicker: product.kicker,
    principal: qd.principal,
    balance: qd.principal,
    ratePct: qd.ratePct,
    spread: product.spread,
    ioUntilM: s.month + product.ioM,
    amortYears: product.amortYears,
    maturityM: s.month + product.termM,
    monthlyPmt: pmt,
    minDSCR: product.minDSCR,
    maxLTV: product.maxLTV,
    sweep: false,
    cleanQs: 0,
    originM: s.month,
  };
}

export function dscr(rec: ParcelRecord, s: GameState, h: Holding): number | null {
  if (!h.loan) return null;
  const ds = h.loan.monthlyPmt * 12;
  if (ds <= 0) return null;
  return holdingNOIYr(rec, s.econ, h, s.month) / ds;
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
  const q = s.month;

  // floating: reprice off the live index — through the cap, if one was bought
  if (loan.floating ?? loan.product === "float") {
    if (loan.cap && q >= loan.cap.expiresM) {
      delete loan.cap;
      s.news.unshift({ q, kind: "info", text: `The rate cap at ${rec.address} expired — you're floating naked again.` });
    }
    const effIndex = loan.cap ? Math.min(s.econ.indexRate, loan.cap.strike) : s.econ.indexRate;
    loan.ratePct = +(effIndex + loan.spread).toFixed(2);
  }
  const io = q < loan.ioUntilM;
  if (io || (loan.floating ?? loan.product === "float")) {
    const yearsLeft = Math.max(1, loan.amortYears - (q - loan.originM) / 12);
    loan.monthlyPmt = io
      ? Math.round((loan.balance * loan.ratePct) / 100 / 12)
      : Math.round(monthlyPayment(loan.balance, loan.ratePct, yearsLeft));
  }

  const interest = (loan.balance * loan.ratePct) / 100 / 12;
  const principalPay = io ? 0 : Math.min(loan.balance, loan.monthlyPmt - interest);
  loan.balance = Math.max(0, loan.balance - principalPay);
  let cashOut = loan.monthlyPmt;

  // covenants — after a 12-month stabilization holiday, so a building you
  // just bought with honest vacancy isn't in default before the ink dries
  const holiday = q < loan.originM + 12;
  const d = dscr(rec, s, h);
  const l = ltv(rec, s, h);
  const breached = !holiday && ((d !== null && d < loan.minDSCR) || (l !== null && l > loan.maxLTV));
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
    const surplus = Math.max(0, assetCF - loan.monthlyPmt);
    if (surplus > 0) {
      loan.balance = Math.max(0, loan.balance - surplus);
      cashOut += surplus;
    }
  }
  if (loan.balance === 0) { h.loan = null; return cashOut; }

  // the balloon. An automatic refi rolls the SAME balance — the bank isn't
  // in the business of handing you equity unasked. Cash-out is a choice you
  // make with the Refi button.
  if (q >= loan.maturityM) {
    const value = holdingValue(rec, s.econ, h);
    const noi = holdingNOIYr(rec, s.econ, h, q);
    const product = PRODUCTS[0];
    const qd = quote(s, product, value, noi);
    const fee = Math.round(loan.balance * REFI_FEE);
    if (qd.principal >= loan.balance + fee) {
      const rolled = loan.balance;
      h.loan = originate(s, product, value, noi);
      if (h.loan) {
        h.loan.balance = h.loan.principal = rolled;
        h.loan.monthlyPmt = Math.round(monthlyPayment(rolled, h.loan.ratePct, h.loan.amortYears));
      }
      s.cash -= fee;
      logBooks(s, "debtSvc", fee);
      s.news.unshift({
        q, kind: "deal",
        text: `Balloon at ${rec.address} rolled into new paper at ${qd.ratePct.toFixed(2)}% (fee $${(fee / 1000).toFixed(0)}K). Want equity out? That's a refi you choose.`,
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
        const net = gross - loan.balance;
        // Non-recourse means the keys are the whole answer: a sale that does
        // not cover the loan is the lender's problem. Recourse means it is
        // yours, and that is exactly what the cheaper coupon bought.
        const deficiency = net < 0 ? -net : 0;
        s.cash += loan.recourse ? net : Math.max(0, net);
        logBooks(s, "sold", loan.recourse ? net : Math.max(0, net));
        s.exits = s.exits ?? [];
        s.exits.push({ bbl: h.bbl, address: rec.address, boughtM: h.boughtM, soldM: q, price: gross, basis: h.costBasis, gain: gross - h.costBasis, forced: true });
        delete s.holdings[h.bbl];
        s.news.unshift({
          q, kind: "warn",
          text: `The balloon came due at ${rec.address} with no refi and no cash — sold under pressure at $${(gross / 1e6).toFixed(2)}M.`
            + (deficiency > 0
              ? loan.recourse
                ? ` You signed for this one: the $${(deficiency / 1e6).toFixed(2)}M deficiency came out of your account.`
                : ` The loan was non-recourse, so the $${(deficiency / 1e6).toFixed(2)}M shortfall stayed with the lender.`
              : ""),
        });
      }
    }
  }
  return cashOut;
}

// A 3-year rate cap on a floating loan: pay ~1.25% of balance today, and the
// index leg can't reprice above (current index + 0.5) until it expires.
export const CAP_TERM_M = 36;
export function rateCapCost(loan: Loan): number {
  return Math.round(loan.balance * 0.0125);
}

export function buyRateCap(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const h = next.holdings[bbl];
  const rec = resolveRec(parcels, next, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  if (!h.loan || h.loan.product !== "float") return { s, err: "Caps hedge floating debt — this loan is fixed." };
  if (h.loan.cap) return { s, err: "This loan already carries a live cap." };
  const cost = rateCapCost(h.loan);
  if (next.cash < cost) return { s, err: `The cap desk wants $${(cost / 1e6).toFixed(2)}M premium — you're short.` };
  const strike = +(next.econ.indexRate + 0.5).toFixed(2);
  next.cash -= cost;
  logBooks(next, "debtSvc", cost);
  h.loan.cap = { strike, expiresM: next.month + CAP_TERM_M };
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Rate cap bought at ${rec.address}: index capped at ${strike.toFixed(2)}% for three years ($${(cost / 1e6).toFixed(2)}M premium).`,
  });
  return { s: next };
}

// What the desk will actually quote you today, per product, so the refinance
// screen can show real choices instead of two buttons.
export interface RefiQuote {
  id: string;
  label: string;
  blurb: string;
  ratePct: number;
  maxProceeds: number;
  ltvAtMax: number;
  dscrAtMax: number;
  ioM: number;
  termM: number;
  amortYears: number;
  points: number;
  recourse: boolean;
  prepay: PrepayKind;
  prepayM: number;
  kicker?: number;
  floating: boolean;
  available: boolean;      // mezzanine needs a senior in place first
  why?: string;            // ...and says so when it isn't
}

export function refiQuotes(s: GameState, parcels: ParcelTable, bbl: string): { quotes: RefiQuote[]; value: number; payoff: number } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { quotes: [], value: 0, payoff: 0 };
  const value = holdingValue(rec, s.econ, h);
  const noi = holdingNOIYr(rec, s.econ, h, s.month);
  const quotes = PRODUCTS.map((p) => {
    const q = quote(s, p, value, noi);
    const annualDs = p.ioM > 0
      ? (q.principal * q.ratePct) / 100
      : monthlyPayment(Math.max(1, q.principal), q.ratePct, p.amortYears) * 12;
    const senior = h.loan && !h.loan.kicker && h.loan.product !== "mezz";
    return {
      id: p.id,
      label: p.label,
      blurb: p.blurb,
      ratePct: q.ratePct,
      maxProceeds: q.principal,
      ltvAtMax: value > 0 ? q.principal / value : 0,
      dscrAtMax: annualDs > 0 ? noi / annualDs : 0,
      ioM: p.ioM,
      termM: p.termM,
      amortYears: p.amortYears,
      points: p.points,
      recourse: p.recourse,
      prepay: p.prepay,
      prepayM: p.prepayM,
      kicker: p.kicker,
      floating: p.floating,
      available: p.mezz ? !!senior : p.uwDscr <= 0 ? rec.class === "land" : rec.class !== "land",
      why: p.mezz && !senior ? "Mezzanine sits behind a senior loan — put one on first."
        : p.uwDscr <= 0 && rec.class !== "land" ? "Land money is for dirt. This one has a building on it."
        : p.uwDscr > 0 && rec.class === "land" ? "No income to underwrite — a vacant site only gets a land loan."
        : undefined,
    } satisfies RefiQuote;
  });
  return { quotes, value, payoff: h.loan?.balance ?? 0 };
}

// Player-initiated refinance at current rates and value. `lev` scales the new
// loan down from the lender's maximum — the dial on the refinance screen.
export function refinance(s: GameState, parcels: ParcelTable, bbl: string, productId: string, lev = 1): { s: GameState; err?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const h = next.holdings[bbl];
  const rec = resolveRec(parcels, next, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  const product = productById(productId);
  const value = holdingValue(rec, next.econ, h);
  const noi = holdingNOIYr(rec, next.econ, h, next.month);
  const full = quote(next, product, value, noi);
  const qd = { ...full, principal: Math.round(full.principal * Math.max(0, Math.min(1, lev))) };
  if (product.mezz && !h.loan) return { s, err: "Mezzanine sits behind a senior loan — put one on first." };
  const oldBal = h.loan?.balance ?? 0;
  const penalty = h.loan ? prepayPenalty(h.loan, next.month) : 0;
  const points = Math.round(qd.principal * product.points);
  const fee = Math.round(Math.max(qd.principal, oldBal) * REFI_FEE) + points + penalty;
  if (qd.principal < 100_000) return { s, err: "No lender will size a loan against this income." };
  if (qd.principal + next.cash < oldBal + fee) {
    return {
      s,
      err: penalty > 0
        ? `Proceeds don't cover the payoff. Breaking the old loan early costs $${(penalty / 1e6).toFixed(2)}M in ${h.loan?.prepay === "yieldmaint" ? "yield maintenance" : "prepayment"}.`
        : "Proceeds don't cover the payoff — you're underwater on this refi.",
    };
  }
  const newLoan = originate(next, product, value, noi, lev);
  if (!newLoan) return { s, err: "No lender will size a loan against this income." };
  next.cash += qd.principal - oldBal - fee;
  logBooks(next, "debtSvc", fee);
  h.loan = newLoan;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Refinanced ${rec.address}: $${(qd.principal / 1e6).toFixed(2)}M at ${qd.ratePct.toFixed(2)}% (${product.label})`
      + (penalty > 0 ? `, after $${(penalty / 1e6).toFixed(2)}M to break the old paper.` : "."),
  });
  return { s: next };
}
