// Structured debt: fixed or floating at origination, IO periods, balloon
// maturities that must refinance or repay, DSCR/LTV covenants tested every
// quarter, and cash sweeps on breach. Proceeds gate on DSCR at underwriting,
// not just LTV — a lender lends against income, not hope.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import { resolveRec, concentration, industryConcentration } from "./value";
import type { Econ, GameState, Holding, Loan } from "./types";
import { logBooks } from "./types";
import { holdingNOIYr, holdingValue, assetValue, noiAfterTaxYr } from "./value";
import { walt, depositsOn } from "./leasing";
import { INDUSTRY_LABEL } from "./market";
import { recordComp } from "./comps";
import { sponsorStanding, markSponsor, distressPrice } from "./sponsor";

export type PrepayKind = "open" | "stepdown" | "yieldmaint";

export interface LoanProduct {
  id: string;
  label: string;
  lender: string;      // the institution behind the sheet
  blurb: string;       // what this money is FOR, in one line
  ltv: number;
  spread: number;      // over the index
  floating: boolean;
  ioM: number;
  amortYears: number;
  termM: number;       // balloon
  uwDscr: number;      // the coverage the desk underwrites to
  debtYield: number;   // minimum NOI ÷ loan proceeds — the post-2009 backstop
  points: number;      // origination fee, as a share of principal
  recourse: boolean;   // a personal guarantee, and a cheaper coupon for it
  prepay: PrepayKind;
  prepayM: number;     // months the penalty runs
  mezz?: boolean;      // sits behind a senior loan rather than replacing it
  kicker?: number;     // participating paper: the lender's share of the gain
  minDSCR: number;     // the covenant
  maxLTV: number;
  minLoan?: number;    // below this they do not underwrite anything
  maxLoan?: number;    // above this is past the desk's hold size
  minCondition?: "good";  // the life company does not finance tired buildings
  window?: boolean;    // a desk that CLOSES with the cycle instead of tightening
}

// THE DESKS, WITH NAMES ON THE DOORS.
//
// The old sheet was eight abstract products — "agency fixed", "floating IO" —
// which is how a spreadsheet thinks about debt and not how anybody borrows.
// You do not call a product; you call a PERSON at an institution with a
// balance sheet, a lending limit, a house view and a memory. Groundwork got
// this right and this desk is rebuilt on its pattern: five named lenders, each
// with a personality, a check size, standards, and a posture that moves with
// the cycle. The hometown bank answers the phone in a crunch — for friends.
// The life company writes the cheapest paper in town and will not look at a
// tired building. The conduit has the sharpest big-loan pricing on the street
// and the window slams shut the day markets wobble. The debt fund will lend on
// anything, at a price, in any market. The price is the point.
//
// Amortization is a choice, not a property of the product: the banks quote a
// 25-year schedule 25bps inside their 30-year sheet (faster paydown, less
// cash flow, safer loan — priced accordingly), and IO periods cost real
// spread. Both are listed as separate lines because that is how a term sheet
// arrives.
export const PRODUCTS: LoanProduct[] = [
  {
    id: "harbor", label: "First Harbor Bank · 5 yr, 25-yr am", lender: "First Harbor Bank",
    blurb: "The hometown bank. Small checks, honest spreads, recourse — and they answer the phone in a crunch, for their friends.",
    ltv: 0.68, spread: 1.95, floating: false, ioM: 0, amortYears: 25, termM: 60,
    uwDscr: 1.25, debtYield: 0.09, points: 0.006, recourse: true, prepay: "stepdown", prepayM: 36,
    minDSCR: 1.25, maxLTV: 0.82, maxLoan: 6_000_000,
  },
  {
    id: "savings", label: "Alden Savings & Trust · 7 yr, 30-yr am", lender: "Alden Savings & Trust",
    blurb: "The regional. Bigger checks, covenant-happy, and they tighten fast when the cycle turns.",
    ltv: 0.72, spread: 2.10, floating: false, ioM: 0, amortYears: 30, termM: 84,
    uwDscr: 1.25, debtYield: 0.085, points: 0.008, recourse: false, prepay: "stepdown", prepayM: 48,
    minDSCR: 1.25, maxLTV: 0.85, maxLoan: 25_000_000,
  },
  {
    // the 25-year sheet: same desk, sharper rate, faster paydown
    id: "savings25", label: "Alden Savings & Trust · 7 yr, 25-yr am · −25bps", lender: "Alden Savings & Trust",
    blurb: "Faster paydown buys a sharper rate. Less cash flow, more equity, and the bank sleeps better than you do.",
    ltv: 0.72, spread: 1.85, floating: false, ioM: 0, amortYears: 25, termM: 84,
    uwDscr: 1.25, debtYield: 0.085, points: 0.008, recourse: false, prepay: "stepdown", prepayM: 48,
    minDSCR: 1.25, maxLTV: 0.85, maxLoan: 25_000_000,
  },
  {
    id: "pelican", label: "Pelican Life Insurance · 15 yr, 30-yr am", lender: "Pelican Life Insurance",
    blurb: "Life-company money: the cheapest debt in town, for well-kept product only. Low leverage, long memory, brutal to leave early.",
    ltv: 0.58, spread: 1.50, floating: false, ioM: 0, amortYears: 30, termM: 180,
    uwDscr: 1.35, debtYield: 0.095, points: 0.008, recourse: false, prepay: "yieldmaint", prepayM: 144,
    minDSCR: 1.30, maxLTV: 0.80, minLoan: 4_000_000, minCondition: "good",
  },
  {
    id: "conduit", label: "Meridian Street conduit · 10 yr, 5 yr IO", lender: "Meridian Street Capital",
    blurb: "The CMBS desk. Sharp pricing on big loans, five interest-only years — and the window slams shut the day markets wobble.",
    ltv: 0.75, spread: 1.90, floating: false, ioM: 60, amortYears: 30, termM: 120,
    uwDscr: 1.20, debtYield: 0.08, points: 0.010, recourse: false, prepay: "yieldmaint", prepayM: 108,
    minDSCR: 1.15, maxLTV: 0.85, minLoan: 10_000_000, window: true,
  },
  {
    id: "cordage", label: "Cordage Debt Partners · 3 yr, floating IO", lender: "Cordage Debt Partners",
    blurb: "The debt fund. They will lend on anything, at a price, in any market. The price is the point.",
    ltv: 0.80, spread: 4.10, floating: true, ioM: 36, amortYears: 30, termM: 36,
    uwDscr: 0.90, debtYield: 0.055, points: 0.020, recourse: false, prepay: "open", prepayM: 0,
    minDSCR: 0.90, maxLTV: 0.92,
  },
  {
    id: "mezz", label: "Cordage mezzanine · behind the senior", lender: "Cordage Debt Partners",
    blurb: "Stacks to 85%. The coupon is why nobody does this twice.",
    ltv: 0.85, spread: 8.00, floating: false, ioM: 120, amortYears: 30, termM: 84,
    uwDscr: 1.05, debtYield: 0.055, points: 0.025, recourse: false, prepay: "stepdown", prepayM: 48,
    mezz: true, minDSCR: 1.00, maxLTV: 0.95,
  },
  {
    // Land has no income, so nobody else on this street will touch it. Small,
    // short, recourse — the hometown bank doing a favor it expects returned.
    id: "land", label: "First Harbor land loan · 3 yr, recourse", lender: "First Harbor Bank",
    blurb: "The only money that will look at dirt. Half the price, and you sign for it.",
    ltv: 0.50, spread: 3.60, floating: true, ioM: 36, amortYears: 30, termM: 36,
    uwDscr: 0, debtYield: 0, points: 0.015, recourse: true, prepay: "open", prepayM: 0,
    minDSCR: 0, maxLTV: 0.70,
  },
];

/**
 * Is this desk's window open at all today? The conduit is the one that closes
 * outright: securitization needs buyers for the bonds, and in a crunch or a
 * recession there are none, at any price. Banks tighten instead of closing —
 * the existing credit-cycle machinery already cuts their advance rates.
 */
export function windowOpen(s: GameState, p: LoanProduct): boolean {
  if (!p.window) return true;
  return (s.econ.creditIdx ?? 1) >= 0.78 && s.econ.phase !== "recession";
}

// ------------------------------------------------------- lender relationships
/**
 * A name they trust is worth basis points. Quiet, performing paper builds the
 * file; a closed loan opens it; a tripped covenant sours the coffee. Worth up
 * to 40bps at the banks and the life company. The conduit gives nothing —
 * the bonds don't know you — and the debt fund prices risk, not friendship.
 */
export function lenderRelOf(s: GameState, lender: string): number {
  return s.lenderRel?.[lender] ?? 20;
}
export function relDiscount(s: GameState, p: LoanProduct): number {
  if (p.window || p.id === "cordage" || p.id === "mezz") return 0;
  return Math.min(0.4, Math.max(0, (lenderRelOf(s, p.lender) - 20) * 0.005));
}
export function bumpLenderRel(s: GameState, lender: string | undefined, amt: number) {
  if (!lender) return;
  if (!s.lenderRel) s.lenderRel = {};
  s.lenderRel[lender] = Math.max(0, Math.min(100, (s.lenderRel[lender] ?? 20) + amt));
}

export const productById = (id: string): LoanProduct => PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0];

const REFI_FEE = 0.01;

/** Whether this desk will look at you at all today. */
export function productOpen(s: GameState, p: LoanProduct): boolean {
  if (sponsorStanding(s).institutional) return true;
  // hard money does not care about your history; it prices it
  return p.id === "cordage" || p.id === "mezz" || p.id === "land";
}

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
  // Your name moves the price twice: the market-wide record (a foreclosure
  // follows you everywhere) and the file at THIS desk — quiet, performing
  // paper with one lender is worth up to 40bps with that lender and nothing
  // anywhere else, which is why real borrowers go back to the same banks.
  const st = sponsorStanding(s);
  const rel = relDiscount(s, product);
  // the hometown bank cuts its friends slack in a crunch instead of cutting them off
  const crunchEase = product.id === "harbor" && lenderRelOf(s, product.lender) >= 55 ? 0.5 : 1;
  const ratePct = +(s.econ.indexRate + product.spread * (1 + 1.1 * tight * crunchEase) + 0.9 * tight * crunchEase + st.spreadAdd - rel).toFixed(2);
  const byLtv = product.ltv * (1 - 0.30 * tight * crunchEase) * (1 - st.advanceCut) * price;
  // a desk that is not in the market for this deal quotes nothing at all
  if (!windowOpen(s, product)) return { principal: 0, ratePct, dscrConstrained: false, dyConstrained: false, debtYield: 0 };
  if (product.maxLoan && byLtv > product.maxLoan) {
    // they participate up to the hold size rather than walking — a smaller
    // check from a lender who wants the file is still a real quote
    return sizeRest(s, product, Math.min(byLtv, product.maxLoan), price, noiYr, ratePct, tight);
  }
  if (product.minLoan && byLtv < product.minLoan) return { principal: 0, ratePct, dscrConstrained: false, dyConstrained: false, debtYield: 0 };
  // A site produces no income, so a coverage test would size every land loan
  // at zero. This one is underwritten on the dirt alone, which is why it is
  // half-leverage, short, and comes with a guarantee.
  if (product.uwDscr <= 0) {
    return { principal: Math.max(0, Math.round(byLtv)), ratePct, dscrConstrained: false, dyConstrained: false, debtYield: 0 };
  }
  return sizeRest(s, product, byLtv, price, noiYr, ratePct, tight);
}

function sizeRest(s: GameState, product: LoanProduct, byLtv: number, price: number, noiYr: number, ratePct: number, tight: number) {
  void s; void price;
  // DSCR gate: size the loan so underwriting NOI covers debt service
  const maxAnnualDS = Math.max(0, noiYr) / (product.uwDscr + 0.25 * tight);
  const i = ratePct / 100;
  const byDscrIO = maxAnnualDS / i;
  const qp = monthlyPayment(1, ratePct, product.amortYears) * 12; // annual DS per $1
  const byDscrAmort = maxAnnualDS / qp;
  const byDscr = product.ioM >= 12 ? Math.min(byDscrIO, byDscrAmort * 1.08) : byDscrAmort;
  // DEBT YIELD. Coverage flatters a loan when rates are low and cap rates are
  // lower — you can cover 1.25x on a building yielding four points, and the
  // lender still has no equity underneath them. Since 2009 the desk also
  // sizes on NOI ÷ proceeds, and in a cheap-money market this is the binding
  // constraint far more often than LTV is.
  const dyFloor = product.debtYield * (1 + 0.35 * tight);
  const byDebtYield = dyFloor > 0 ? Math.max(0, noiYr) / dyFloor : Infinity;
  const principal = Math.max(0, Math.round(Math.min(byLtv, byDscr, byDebtYield)));
  return {
    principal: product.minLoan && principal < product.minLoan ? 0 : principal,
    ratePct,
    dscrConstrained: byDscr < byLtv && byDscr <= byDebtYield,
    dyConstrained: byDebtYield < byLtv && byDebtYield < byDscr,
    debtYield: principal > 0 ? Math.max(0, noiYr) / principal : 0,
  };
}


// `lev` scales the loan down from the lender's maximum — the player's dial.
export function originate(s: GameState, product: LoanProduct, price: number, noiYr: number, lev = 1, condition?: string): Loan | null {
  if (!productOpen(s, product)) return null;
  if (!windowOpen(s, product)) return null;
  if (product.minCondition === "good" && condition !== undefined && condition !== "good") return null;
  const full = quote(s, product, price, noiYr);
  const qd = { ...full, principal: Math.round(full.principal * Math.max(0, Math.min(1, lev))) };
  if (qd.principal < 100_000) return null;
  const pmt = product.ioM > 0
    ? Math.round((qd.principal * qd.ratePct) / 100 / 12)
    : Math.round(monthlyPayment(qd.principal, qd.ratePct, product.amortYears));
  // No lender writes floating paper without a cap in place at closing. The
  // premium is a real cost of choosing the cheaper coupon, and it comes out of
  // the same equity cheque — which is the honest way to compare a floater to a
  // fixed loan rather than pretending the coupon is the whole story.
  const capStrike = product.floating ? +(s.econ.indexRate + 1.0).toFixed(2) : undefined;
  const loanOut: Loan = {
    product: product.id,
    floating: product.floating,
    cap: capStrike !== undefined ? { strike: capStrike, expiresM: s.month + Math.min(product.termM, CAP_TERM_M) } : undefined,
    capPremium: capStrike !== undefined ? Math.round(qd.principal * 0.0125) : undefined,
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
  bumpLenderRel(s, product.lender, 2);   // a closed loan starts a file
  return loanOut;
}

export function dscr(rec: ParcelRecord, s: GameState, h: Holding): number | null {
  if (!h.loan) return null;
  const ds = h.loan.monthlyPmt * 12;
  if (ds <= 0) return null;
  return holdingNOIYr(rec, s.econ, h, s.month) / ds;
}

export function ltv(rec: ParcelRecord, s: GameState, h: Holding): number | null {
  if (!h.loan) return null;
  const v = holdingValue(rec, s.econ, h, s.month);
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
  // The payment is re-cut every month, and it has to be: a loan that leaves
  // its interest-only period must start amortising. This used to recompute
  // only for floating paper, so every FIXED loan with an IO period — the bank
  // five-year, the participating paper, the mezzanine — quietly stayed
  // interest-only for its whole term, understating debt service for years.
  // Worse, the IO payment was rounded down, so the balance crept UPWARD a few
  // cents a month forever. Recomputing over the remaining amortisation term
  // reproduces the same schedule a level-payment loan would follow, and it
  // cannot drift below the interest.
  const io = q < loan.ioUntilM;
  {
    const yearsLeft = Math.max(1, loan.amortYears - (q - loan.originM) / 12);
    loan.monthlyPmt = io
      ? Math.ceil((loan.balance * loan.ratePct) / 100 / 12)
      : Math.round(monthlyPayment(loan.balance, loan.ratePct, yearsLeft));
  }

  const interest = (loan.balance * loan.ratePct) / 100 / 12;
  const principalPay = io ? 0 : Math.max(0, Math.min(loan.balance, loan.monthlyPmt - interest));
  if (!loan.sweep && s.month % 12 === 0) bumpLenderRel(s, productById(loan.product).lender, 0.6);
  loan.balance = Math.max(0, loan.balance - principalPay);
  let cashOut = loan.monthlyPmt;

  // covenants — after a 12-month stabilization holiday, so a building you
  // just bought with honest vacancy isn't in default before the ink dries
  const holiday = q < (loan.holidayUntilM ?? loan.originM + 12);
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
    if (!loan.sweep) bumpLenderRel(s, productById(loan.product).lender, -3);  // a tripped covenant sours the coffee
    loan.sweep = true;
    loan.cleanQs = 0;
  } else if (loan.sweep) {
    loan.cleanQs++;
    bumpLenderRel(s, productById(loan.product).lender, 0.1);
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
    const value = holdingValue(rec, s.econ, h, s.month);
    const noi = holdingNOIYr(rec, s.econ, h, q);
    // A takeout is underwritten on the roll you actually have on the day the
    // balloon lands — which for a building that delivered empty and never
    // stabilised is exactly the moment the concentration and rollover
    // haircuts hurt most.
    const hair = collateralHaircut(h, q, s.econ);
    // Walk DOWN the desk, not off a cliff. A maturing loan is refinanced by
    // whoever will write it: the agency first, then the bank, and if neither
    // will, hard money at hard-money prices. That last one is not a rescue —
    // it is a coupon that eats the building's cash flow — but it is what
    // actually happens, and it turns "you got unlucky at the balloon" into
    // "you are now paying for how you financed this".
    const ladder = ["savings", "harbor", "cordage"].map(productById)
      .filter((p) => productOpen(s, p) && windowOpen(s, p));
    let product = ladder[ladder.length - 1] ?? PRODUCTS[0];
    let qd = { ...quote(s, product, value, noi), principal: 0 };
    const fee = Math.round(loan.balance * REFI_FEE);
    for (const cand of ladder) {
      const raw = quote(s, cand, value, noi);
      const sized = { ...raw, principal: Math.round(raw.principal * hair.mult) };
      product = cand; qd = sized;
      if (sized.principal >= loan.balance + fee) break;
    }
    if (qd.principal >= loan.balance + fee) {
      const rolled = loan.balance;
      h.loan = originate(s, product, value, noi, hair.mult);
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
        // forced sale, at the price a forced sale actually gets
        const gross = Math.round(value * distressPrice(s));
        const net = gross - loan.balance;
        // Non-recourse means the keys are the whole answer: a sale that does
        // not cover the loan is the lender's problem. Recourse means it is
        // yours, and that is exactly what the cheaper coupon bought.
        const deficiency = net < 0 ? -net : 0;
        s.cash += loan.recourse ? net : Math.max(0, net);
        logBooks(s, "sold", loan.recourse ? net : Math.max(0, net));
        s.exits = s.exits ?? [];
        s.exits.push({ bbl: h.bbl, address: rec.address, boughtM: h.boughtM, soldM: q, price: gross, basis: h.costBasis, gain: gross - h.costBasis, forced: true });
        // The partnership is wound up out of whatever the lender left, which
        // on a distressed sale is usually nothing. Losing somebody else's
        // money this way is the single most expensive thing you can do to a
        // reputation, and it is settled here rather than quietly forgotten.
        // A distressed sale is still a print, and the most informative kind:
        // it is the only number in the city that nobody chose.
        recordComp(s, rec, gross, "a distressed buyer", "You", true, h.condition);
        if (s.groundLeases?.[h.bbl]) delete s.groundLeases[h.bbl];
        s.cash -= depositsOn(s.holdings[h.bbl]);   // the deposits go with the deed
        delete s.holdings[h.bbl];
        // the tenants who were mid-negotiation are now somebody else's problem
        s.lois = s.lois.filter((l) => l.bbl !== h.bbl);
        markSponsor(s, deficiency > 0 && loan.recourse ? "deficiency" : "forced", rec.address, deficiency);
        s.news.unshift({
          q, kind: "warn",
          text: `The balloon came due at ${rec.address} with no refi and no cash — sold under pressure at $${(gross / 1e6).toFixed(2)}M, ${(100 * (1 - distressPrice(s))).toFixed(0)}% under the mark. It goes on your record.`
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
  if (!h.loan || !(h.loan.floating ?? h.loan.product === "float")) return { s, err: "Caps hedge floating debt — this loan is fixed." };
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
  debtYieldAtMax: number;
  binding: string;      // which of the three tests actually capped the loan
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

/**
 * The haircut a lender takes for concentration and rollover.
 *
 * A credit committee does not lend against a rent roll — it lends against the
 * covenants in it. One tenant at eighty per cent of the income with three
 * years to run is a bullet loan against that tenant's credit, and it gets
 * sized like one. Long paper from a strong name earns most of it back, which
 * is why single-tenant net-lease deals can be financed to the eyebrows and
 * multi-tenant buildings with the same NOI cannot.
 */
export function collateralHaircut(h: Holding, month: number, econ?: Econ): { mult: number; why?: string } {
  if (!h.tenants.length) return { mult: 1 };
  const conc = concentration(h);
  const w = walt(h, month);
  let sfTot = 0, wCredit = 0, rollSf = 0;
  for (const t of h.tenants) {
    sfTot += t.sf;
    wCredit += t.credit * t.sf;
    if (t.endM - month <= 24) rollSf += t.sf;
  }
  const credit = sfTot ? wCredit / sfTot : 0;
  const rollShare = sfTot ? rollSf / sfTot : 0;
  // concentration bites past a third of the roll, and long strong paper undoes it
  const concHit = Math.max(0, conc - 0.35) / 0.65 * (credit >= 1.6 && w >= 8 ? 0.10 : credit >= 1.6 ? 0.20 : 0.32);
  // and the desk discounts income that walks out the door inside the term
  const rollHit = Math.max(0, rollShare - 0.3) / 0.7 * 0.18;
  // AND WHAT THE TENANTS DO FOR A LIVING. Five names in one trade is one
  // cycle, and a credit committee has seen what happens to a building let
  // entirely to an industry that is contracting. This is the same question the
  // single-name test asks, one level up, and it is the one that catches the
  // rent roll that looks diversified and is not.
  const ind = econ ? industryConcentration(h, econ) : { share: 0, sector: null, stressed: 0 };
  const indHit = Math.max(0, ind.share - 0.5) / 0.5 * 0.16 + ind.stressed * 0.26;
  const mult = Math.max(0.5, 1 - concHit - rollHit - indHit);
  const why = indHit > 0.08 && ind.sector
    ? `${(ind.share * 100).toFixed(0)}% of the income is ${INDUSTRY_LABEL[ind.sector].toLowerCase()}${ind.stressed > 0.25 ? ", and that trade is contracting" : ""}`
    : concHit > 0.08 && rollHit > 0.05
    ? `the biggest tenant is ${(conc * 100).toFixed(0)}% of the roll and ${(rollShare * 100).toFixed(0)}% of it rolls inside two years`
    : concHit > 0.08 ? `the biggest tenant is ${(conc * 100).toFixed(0)}% of the roll`
    : rollHit > 0.05 ? `${(rollShare * 100).toFixed(0)}% of the roll expires inside two years`
    : undefined;
  return { mult, why };
}

export function refiQuotes(s: GameState, parcels: ParcelTable, bbl: string): { quotes: RefiQuote[]; value: number; payoff: number } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { quotes: [], value: 0, payoff: 0 };
  // UNDERWRITING A BUILDING THAT IS STILL FILLING UP.
  //
  // A newly delivered building is empty, so its actual NOI is nothing and its
  // value marked off that NOI is a fraction of what it cost. Underwritten on
  // today's income, no lender quotes a penny — which is exactly what was
  // happening: a job would finish carrying a $15M construction balance against
  // a building marked at $9M, every income lender would quote zero, the
  // mini-perm would balloon, and the developer would lose a building that was
  // worth nearly twice its cost the moment it was full.
  //
  // That is not how a construction takeout is underwritten. The lender knows
  // it is buying a lease-up: they underwrite to STABILISED income and hold
  // back a chunk against the risk that it does not get there. So during the
  // lease-up window that is what they do here, at a 25% holdback.
  const leaseUpM = h.deliveredM !== undefined ? s.month - h.deliveredM : Infinity;
  const inLeaseUp = leaseUpM <= 48;
  const actualNoi = holdingNOIYr(rec, s.econ, h, s.month);
  const actualValue = holdingValue(rec, s.econ, h, s.month);
  let value = actualValue, noi = actualNoi;
  if (inLeaseUp && rec.class !== "land" && rec.bldgArea > 0) {
    const stabValue = assetValue(rec, s.econ, "good");
    const stabNoi = noiAfterTaxYr(rec, s.econ, "good", stabValue);
    // the holdback tightens as the window runs out — a building still empty
    // after four years is not a lease-up, it is a problem
    const trust = 0.75 * Math.max(0.3, 1 - leaseUpM / 60);
    value = Math.max(actualValue, stabValue * trust);
    noi = Math.max(actualNoi, stabNoi * trust);
  }
  const hair = collateralHaircut(h, s.month, s.econ);
  const quotes = PRODUCTS.map((p) => {
    const raw = quote(s, p, value, noi);
    const q = { ...raw, principal: Math.round(raw.principal * hair.mult) };
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
      debtYieldAtMax: q.principal > 0 ? noi / q.principal : 0,
      binding: q.dyConstrained ? "debt yield" : q.dscrConstrained ? "coverage" : "advance rate",
      ioM: p.ioM,
      termM: p.termM,
      amortYears: p.amortYears,
      points: p.points,
      recourse: p.recourse,
      prepay: p.prepay,
      prepayM: p.prepayM,
      kicker: p.kicker,
      floating: p.floating,
      available: !productOpen(s, p) || !windowOpen(s, p) ? false
        : p.minCondition === "good" && h.condition !== "good" ? false
        : p.mezz ? !!senior : p.uwDscr <= 0 ? rec.class === "land" : rec.class !== "land" && q.principal > 0,
      why: !productOpen(s, p)
        ? `This desk won't look at you — ${sponsorStanding(s).label}.`
        : !windowOpen(s, p)
        ? "The securitization window is closed — nobody is buying the bonds until markets reopen."
        : p.minCondition === "good" && h.condition !== "good"
        ? "Life-company money wants a well-kept building. Renovate first."
        : p.minLoan && q.principal === 0 && rec.class !== "land"
        ? `Below their minimum check — ${p.lender} doesn't underwrite anything under $${((p.minLoan) / 1e6).toFixed(0)}M.`
        : hair.why && hair.mult < 0.95 && !p.mezz
        ? `Proceeds cut ${((1 - hair.mult) * 100).toFixed(0)}% — ${hair.why}.`
        : p.mezz && !senior ? "Mezzanine sits behind a senior loan — put one on first."
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
  if (!productOpen(next, product)) {
    return { s, err: `${product.label} won't quote you — ${sponsorStanding(next).label}. Bridge and mezzanine money will still talk.` };
  }
  const value = holdingValue(rec, next.econ, h, next.month);
  const noi = holdingNOIYr(rec, next.econ, h, next.month);
  // The quote screen already told you the desk was cutting proceeds for a
  // concentrated or fast-rolling rent roll. The close has to agree with it.
  const hair = collateralHaircut(h, next.month, next.econ);
  const full = quote(next, product, value, noi);
  const qd = { ...full, principal: Math.round(full.principal * hair.mult * Math.max(0, Math.min(1, lev))) };
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
  const newLoan = originate(next, product, value, noi, lev * hair.mult);
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
