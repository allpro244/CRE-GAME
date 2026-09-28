// BEING IN TROUBLE, AS A PROCESS.
//
// A default used to be an event. The balloon came due, you had no cash and no
// refinancing, and in the same tick the building was sold at a distress price
// and a black mark went on your record. That is the ENDING of a foreclosure,
// not a foreclosure — and everything interesting about being in trouble
// happens in the eighteen months before it, across a table, with a lender who
// has problems of their own.
//
// So there is a table now, and four ways off it:
//
//   CURE        pay the arrears or the balloon and it goes away. Expensive and
//               always available if you have the money.
//   FORBEARANCE ask them to wait. They charge for it — fees, a default-rate
//               bump, sometimes a paydown — and whether they say yes depends
//               on THEIR capital, not your charm. A bank with capital would
//               rather extend than own your building; one that is impaired has
//               regulators to answer to and takes the keys.
//   DEED IN LIEU hand it over. No auction, no deficiency even on recourse
//               paper, and a smaller mark than a foreclosure — this is the
//               civilised exit and it is nearly always the right one.
//   FORECLOSURE do nothing, and they sell it at auction. The auction gets less
//               than a distress sale because it is a legal process with a
//               calendar, and on recourse paper the shortfall follows you.
//
// The lender's own book decides which of these is even on offer, which is the
// entire reason engine/lenders.ts exists.
import type { ParcelTable } from "@/data/types";
import type { Exit, GameState, Workout } from "./types";
import { logBooks, moveDeposit, monthLabel, nextJulyAfter, cloneState, closeDeedLedger } from "./types";
import { firmShort } from "./firm";
import { rrange } from "./market";
import { ownedHoldingValue, resolveRec } from "./value";
import { productById, bumpLenderRel, equityCureNeed, monthlyPayment } from "./debt";
import { capitalRatio, chargeLenderLoss, lenderByName } from "./lenders";
import { markSponsor } from "./sponsor";
import { recordComp } from "./comps";
import { depositsOn } from "./leasing";
import { fundCashNeed, fundableNow, fundAndBook } from "./credit";
import { recordPropertyEvent } from "./history";
import { transferGroundLeaseOffBook } from "./actions";
import { money } from "./money";

const clone = (s: GameState): GameState => cloneState(s);

/**
 * Every cure may draw the revolver. Cash-only equity cures were how a firm
 * with an open line still lost a building it could reinstate — the owner's
 * rule is that if the line can fund the cure OR the monthly coupon, the
 * property is not taken. Covenant cures are still "equity" in the paperwork
 * sense; they are not a reason to ignore undrawn credit.
 */
function cureAllowsLoc(_cause: Workout["cause"]): boolean {
  return true;
}

/**
 * How long they let it run before the auction, by stage.
 *
 * EXPORTED BECAUSE THE STREET RUNS ON THE SAME CALENDAR. A firm on this street
 * that stops paying is not on a different clock from the player who stops
 * paying — the notice period is a statute and the filing calendar is a court's,
 * and neither one asks whose name is on the mortgage. `rivals.ts` reads the sum
 * of these two as the months a delinquent firm gets before the desks take the
 * book, so there is one answer to "how long from a missed payment to losing the
 * building" rather than one for you and an invented one for them.
 */
export const NOTICE_M = 6;        // the cure period
export const FORECLOSE_M = 8;     // once they have filed

/**
 * HOW MUCH TIME AN EXTENSION ACTUALLY BUYS, in months.
 *
 * A maturity-default extension is a short-dated instrument. The desk is not
 * re-underwriting a ten-year mortgage on a borrower who has just failed to
 * repay one; it is papering twelve to twenty-four months of forbearance against
 * a fee, a rate bump and a cash sweep, and expecting to be back at this table
 * inside two years. That is what the workout desks do and it is the reason the
 * phrase for it is "extend and pretend" rather than "extend and forget".
 *
 * EXPORTED FOR THE SAME REASON `NOTICE_M` IS. The street was getting a
 * different answer: `rivals.tickMaturities` had no way to record a new maturity
 * date, so an extended firm simply fell back onto its term ladder and the next
 * test came a FULL TERM later. Measured over 965 street extensions on six
 * unplayed centuries: a mean 78.5 months and a maximum of 120 — six and a half
 * years for a one-to-two-point fee, while the news line the same branch printed
 * said "they have bought time, not a solution". At six and a half years it was
 * a solution, and the tape was simply lying. One answer, two borrowers.
 */
export const EXTENSION_M: [number, number] = [18, 30];

/** A drawn extension term, in months. */
export function extensionMonths(s: GameState): number {
  return Math.round(rrange(s, ...EXTENSION_M));
}

/**
 * IS THIS DESK IN A MOOD TO EXTEND ANYBODY — the borrower-independent half of
 * `workoutMood`.
 *
 * A bank with capital would far rather carry a performing loan than own a
 * building; one that is impaired has a regulator reading the same balance
 * sheet it is. That test is about the LENDER, and it is the same test whether
 * the borrower is the player or a firm on the street — so it lives here once
 * and both callers read it. `rel` is the borrower's file with the desk, which
 * only matters in the middle band where the desk is stretched but not broken.
 *
 * Measured before it had a second caller: over 24,000 lender-months the desks
 * sit below their capital target 25.4% of the time and below 0.7x target 5.5%,
 * so an extension is usually available and is not available in exactly the
 * years everybody needs one. That is the shape a refinancing cliff needs.
 */
export function deskWillExtend(s: GameState, lenderName: string, rel = 20): boolean {
  const l = lenderByName(s, lenderName);
  if (!l || l.failedM !== undefined) return false;   // a receiver liquidates; it does not extend
  const cr = capitalRatio(l);
  const healthy = cr > 0.075 && l.delinquent < 0.06;
  return healthy || (cr > 0.05 && rel > 45);
}

/**
 * WHAT AN EXTENSION COSTS, as a share of the balance being extended.
 *
 * The price of time, and it is not small. A desk with capital charges a point
 * to re-paper a loan it was happy to have; a stretched one charges two, because
 * it is being asked to carry something its regulator is already asking about.
 * Both are ordinary modification fees on real term paper.
 *
 * Lifted out of `workoutMood` so the street pays the same point the player pays
 * — a firm on this street rolling a balloon at First Harbor and a player asking
 * First Harbor for six months are buying the same thing from the same desk, and
 * two numbers for it would be two answers to one question.
 */
export function extensionFeePct(s: GameState, lenderName: string): number {
  const l = lenderByName(s, lenderName);
  if (!l) return 0.02;
  return capitalRatio(l) > 0.075 && l.delinquent < 0.06 ? 0.01 : 0.02;
}

/** Is this lender in a mood to work with anybody? */
export function workoutMood(s: GameState, lenderName: string): {
  willExtend: boolean; why: string; feePct: number; bumpPct: number; paydownPct: number;
} {
  const l = lenderByName(s, lenderName);
  const rel = s.lenderRel?.[lenderName] ?? 20;
  // THE MAN ACROSS THE TABLE BOUGHT YOUR LOAN ON PURPOSE.
  //
  // A bank would rather have a performing loan than your building — that is the
  // whole reason forbearance exists. A fund that bought the paper at a discount
  // underwrote to OWNING the building, and every month it waits is a month off
  // its return. There is no conversation to have.
  const bought = (s.lenders ?? []).some((x) => x.name === lenderName && x.kind === "fund")
    && Object.values(s.holdings).some((h) => h.loan?.holder === lenderName);
  if (bought) {
    return {
      willExtend: false, feePct: 0, bumpPct: 0, paydownPct: 0,
      why: `${lenderName} bought this loan; they did not write it. They paid a discount for the right to own the `
        + `building and an extension is the one thing that costs them money. They are not going to help you.`,
    };
  }
  if (!l || l.failedM !== undefined) {
    return {
      willExtend: false, feePct: 0, bumpPct: 0, paydownPct: 0,
      why: "The lender is in receivership. A receiver does not grant extensions — they liquidate.",
    };
  }
  const cr = capitalRatio(l);
  const healthy = cr > 0.075 && l.delinquent < 0.06;
  const stretched = cr > 0.05;
  // A bank with capital would far rather extend than own a building. One that
  // is impaired has a regulator reading the same balance sheet you are. The
  // test itself is `deskWillExtend` above — one answer, two borrowers.
  const willExtend = deskWillExtend(s, lenderName, rel);
  return {
    willExtend,
    why: healthy
      ? `${lenderName} has the capital to be patient. They would rather have a performing loan than your building.`
      : stretched
        ? `${lenderName} is stretched — ${(l.delinquent * 100).toFixed(1)}% of their book is not paying. `
          + (rel > 45 ? "Your record with them is the only reason this is a conversation." : "They have no reason to carry you.")
        : `${lenderName} is undercapitalised. They cannot carry a non-performing loan; the regulators are counting.`,
    // The price of time, and it is not small. See extensionFeePct above.
    feePct: extensionFeePct(s, lenderName),
    bumpPct: healthy ? 1.5 : 3.0,
    paydownPct: healthy ? 0.03 : 0.08,
  };
}

/** Open a file on a loan that has stopped working. */
export function openWorkout(
  s: GameState, bbl: string, cause: Workout["cause"], cure: number,
) {
  if (s.workouts?.[bbl]) return;
  const h = s.holdings[bbl];
  // Mezz can open a file even when the senior is current (or already gone).
  if (!h?.loan && !(h?.mezz && h.mezz.balance > 0)) return;
  if (!s.workouts) s.workouts = {};
  // WHOEVER IS HOLDING IT TODAY. A loan can be sold, and the firm that bought
  // your mortgage at a discount is not the bank you signed with. See notes.ts.
  // Mezz-only files name Cordage (or the junior holder).
  const lender = h.loan
    ? (h.loan.holder ?? productById(h.loan.product).lender)
    : (h.mezz!.holder ?? "Cordage Debt Partners");
  s.workouts[bbl] = {
    bbl, lender, startM: s.month, stage: "notice", cause,
    cure: Math.round(cure), decideM: s.month + NOTICE_M, asks: 0, missedMs: 0,
  };
  bumpLenderRel(s, lender, -6);
}

/** Pay it off and make it go away. */
/**
 * Elect, or stop electing, to keep a defaulted loan current out of the firm's
 * other income. Free to switch on — the cost is the payment, every month, and
 * it is charged in tickWorkouts where every other payment is charged.
 */
export function serviceWorkout(s: GameState, bbl: string, on: boolean, parcels?: ParcelTable): { s: GameState; err?: string; msg?: string } {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  if (on && w.stage === "foreclosure") {
    return { s, err: "They have filed. A payment is not a cure any more — it takes the arrears in full, a deed in lieu, or the auction." };
  }
  const next = clone(s);
  const nw = next.workouts![bbl];
  nw.servicing = on;
  if (on) nw.decideM = Math.max(nw.decideM, next.month + 1);
  const where = (parcels && resolveRec(parcels, s, bbl)?.address) || bbl;
  next.news.unshift({
    q: next.month, kind: on ? "deal" : "warn",
    text: on
      ? `You will keep ${where} current out of the rest of the book — ${money(Math.round(h.loan.monthlyPmt * 1.15))} a month `
        + `at the default rate. The clock stops while the cheques clear.`
      : `You have stopped paying on ${where}. ${w.lender}'s clock is running again.`,
  });
  return { s: next, msg: on ? "The lender will wait while you pay." : "Stopped." };
}

/**
 * Apply a funded cure to the loan and close the file. Caller has already
 * verified the dollars are fundable under the right allowLoc rule.
 */
function applyCurePayment(
  s: GameState, w: Workout, paid: number, recAddress: string,
): void {
  const h = s.holdings[w.bbl]!;
  logBooks(s, "debtSvc", paid, w.bbl);
  if (w.cause === "balloon") {
    h.loan = null;
  } else if (w.cause === "covenant" && h.loan) {
    // An equity cure is a principal paydown — burning cash without touching
    // the balance was how "cured" files reopened the next month.
    h.loan.balance = Math.max(0, h.loan.balance - paid);
    if (h.loan.balance <= 0) h.loan = null;
    else {
      const io = s.month < h.loan.ioUntilM;
      const yearsLeft = Math.max(1, h.loan.amortYears - (s.month - h.loan.originM) / 12);
      h.loan.monthlyPmt = io
        ? Math.ceil((h.loan.balance * h.loan.ratePct) / 100 / 12)
        : Math.round(monthlyPayment(h.loan.balance, h.loan.ratePct, yearsLeft));
      h.loan.sweep = false;
      h.loan.cleanQs = 0;
      h.loan.breachMs = 0;
      h.loan.arrearsMs = 0;
    }
  } else if (h.loan) {
    h.loan.sweep = false;
    h.loan.cleanQs = 0;
    h.loan.breachMs = 0;
    h.loan.arrearsMs = 0;
  }
  delete s.workouts![w.bbl];
  bumpLenderRel(s, w.lender, 4);
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `Cured the default at ${recAddress} — ${money(paid)} to ${w.lender}. `
      + `A funded sponsor does not lose a building to a calendar.`,
  });
}

/** Refresh the cure dollars on an open file so the desk asks for today's gap. */
function refreshCureAmount(s: GameState, parcels: ParcelTable, w: Workout): void {
  const h = s.holdings[w.bbl];
  const rec = resolveRec(parcels, s, w.bbl);
  if (!h?.loan || !rec) return;
  if (w.cause === "covenant") {
    w.cure = Math.max(equityCureNeed(rec, s, h), Math.round(h.loan.balance * 0.03));
  } else if (w.cause === "balloon") {
    // Once filed, default interest has been running against the collateral —
    // reinstatement is principal plus what the meter added, not last quarter's
    // notice number.
    w.cure = Math.round(h.loan.balance * 1.01 + (w.accrued ?? 0));
  } else if (w.cause === "arrears") {
    const months = Math.max(3, h.loan.arrearsMs ?? 3);
    w.cure = Math.round(h.loan.monthlyPmt * months + (w.accrued ?? 0));
  }
}

/**
 * Can the firm write this month's coupon out of cash and the line?
 *
 * The owner's standing rule: a property in default is NOT at risk of
 * foreclosure while the sponsor can fund the monthly debt service (and, when
 * a catch-up is sitting on the file, the accumulated principal and interest).
 * Lenders trap cash and demand a cure; they do not auction a note that is
 * being paid. monthCF already books the coupon — this only asks whether the
 * cheque can clear.
 */
export function couponFundable(
  s: GameState, parcels: ParcelTable, h: { loan: { monthlyPmt: number } | null },
): boolean {
  return !!h.loan && fundableNow(s, parcels) >= h.loan.monthlyPmt;
}

/** Cure cheque OR monthly coupon — either keeps the deed off the steps. */
export function canDefendWorkout(
  s: GameState, parcels: ParcelTable, w: Workout,
): boolean {
  const h = s.holdings[w.bbl];
  if (!h?.loan) return false;
  if (couponFundable(s, parcels, h)) return true;
  refreshCureAmount(s, parcels, w);
  return fundableNow(s, parcels, { allowLoc: true }) >= w.cure;
}

export function cureWorkout(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string; msg?: string } {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone(s);
  const nw = next.workouts![bbl];
  refreshCureAmount(next, parcels, nw);
  const allowLoc = cureAllowsLoc(nw.cause);
  const have = fundableNow(next, parcels, { allowLoc });
  if (have < nw.cure) {
    return {
      s,
      err: `Curing it takes ${money(nw.cure)} — ${allowLoc ? "liquidity" : "cash"} is short ${money(nw.cure - have)}.`,
    };
  }
  const paid = fundCashNeed(next, parcels, nw.cure, { allowLoc });
  applyCurePayment(next, nw, paid, rec.address);
  return { s: next, msg: "Cured." };
}

/**
 * A SPONSOR WHO CAN PAY DOES PAY — without waiting for the modal.
 *
 * Lenders do not file on a borrower who can clear the arrears or retire the
 * balloon; the desk takes the money. Covenant equity cures stay cash-only;
 * arrears and balloons may draw the line. Returns true if the file closed.
 */
function autoCureIfFunded(s: GameState, parcels: ParcelTable, w: Workout): boolean {
  const h = s.holdings[w.bbl];
  const rec = resolveRec(parcels, s, w.bbl);
  if (!h?.loan || !rec) return false;
  refreshCureAmount(s, parcels, w);
  const allowLoc = cureAllowsLoc(w.cause);
  if (fundableNow(s, parcels, { allowLoc }) < w.cure) return false;
  const paid = fundCashNeed(s, parcels, w.cure, { allowLoc });
  if (paid < w.cure) return false;
  applyCurePayment(s, w, paid, rec.address);
  return true;
}

/**
 * A FILED BALLOON WHOSE HOLDOVER YEAR IS SPENT IS NOT SAVED BY ITS COUPON.
 *
 * Both pull-backs from foreclosure (the monthly tick and the July docket) put
 * a filed note back to notice the moment the coupon is fundable: lenders do
 * not auction a note that is being paid. On a balloon that is only half true.
 * The default is the maturity, not the coupon — interest does not retire the
 * principal that fell due — and a year past the date the desk extends once or
 * files (holdoverDecision). Pulling that filing back put the note on a
 * one-year clock it had already run out. Measured in `test/invariants.mjs`
 * (levered bot, seed 4000): matured m99 on its one extension, filed m106 when
 * the coupon bounced, pulled back to notice at m114 when a sale refilled the
 * account — 15 months past maturity with neither an extension nor a filing,
 * which is the state the balloon invariant forbids.
 *
 * Returns true when the file is such a note, after giving it the holdover
 * decision the clock owes it: the one extension if it has not had it and the
 * desk will still write it, otherwise it stays on the docket.
 */
function holdoverSpentOnFiling(s: GameState, parcels: ParcelTable, w: Workout, address: string): boolean {
  const l = s.holdings[w.bbl]?.loan;
  if (!l || w.cause !== "balloon" || s.month - l.maturityM < 12) return false;
  if ((l.extensions ?? 0) < 1 && workoutMood(s, w.lender).willExtend) holdoverDecision(s, parcels, w, address);
  return true;
}

/**
 * Pull every foreclosure the firm can reinstate — or keep current — off the
 * docket BEFORE the August hammer. The county used to settle the sale in the
 * same tick the cure cheque would have cleared after NOI hit; later a
 * coupon-current file still crossed the block because only a full reinstate
 * pulled it. If the line can fund the cure OR the monthly coupon, the deed
 * stays yours.
 */
export function reinstateFundedForeclosures(s: GameState, parcels: ParcelTable): void {
  if (!s.workouts) return;
  for (const w of Object.values(s.workouts)) {
    if (w.stage !== "foreclosure") continue;
    if (autoCureIfFunded(s, parcels, w)) continue;
    const h = s.holdings[w.bbl];
    const rec = resolveRec(parcels, s, w.bbl);
    if (!h?.loan || !rec) continue;
    if (!couponFundable(s, parcels, h)) continue;
    // A matured note past its holdover year is not saved by its coupon.
    if (holdoverSpentOnFiling(s, parcels, w, rec.address)) continue;
    // Coupon clears — pull off the steps back to notice. They can demand a
    // cure again; they do not auction a note that is being paid.
    w.stage = "notice";
    delete w.saleM;
    w.decideM = s.month + NOTICE_M;
    h.loan.arrearsMs = 0;
    s.news.unshift({
      q: s.month, kind: "info",
      text: `${w.lender} pulled ${rec.address} off the foreclosure docket — the coupon is fundable `
        + `(cash and the line). The file stays open until you reinstate in full, but the hammer does not fall `
        + `on a note that is being paid.`,
    });
  }
}

/** Ask them to wait. */
export function requestForbearance(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  if (w.stage === "foreclosure") return { s, err: "They have filed. That conversation is over." };
  if (w.asks >= 1 || (h.loan.extensions ?? 0) >= 1) return { s, err: "You have already been to them once on this building. Nobody extends twice." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const mood = workoutMood(s, w.lender);
  const next = clone(s);
  const nw = next.workouts![bbl];
  nw.asks++;

  if (!mood.willExtend) {
    next.news.unshift({ q: next.month, kind: "warn", text: `${w.lender} refused to extend at ${rec.address}. ${mood.why}` });
    return { s: next, msg: "They said no." };
  }
  const bal = h.loan.balance;
  const fee = Math.round(bal * mood.feePct);
  const paydown = Math.round(bal * mood.paydownPct);
  const due = fee + paydown;
  // THE LAST UNCONVERTED CHEQUE ON THIS DESK. Every other path in this file
  // already asks `fundableNow` — the coupon, the cure, the auto-cure, the
  // reinstatement — because a sponsor who can fund the payment does not lose
  // the building. The extension fee and its paydown are the same instrument
  // bought a different way, and refusing the line here meant the one workout
  // you negotiate rather than simply pay was the one the revolver could not
  // reach. This is not a voluntary paydown of cheap paper: it is the price of
  // an extension on a loan already in default, and the rate bump, the cash
  // sweep, the one-ask-per-building limit and the mood test that decides
  // whether the desk extends at all are all untouched.
  if (fundableNow(next, parcels) < due) {
    return {
      s,
      err: `${w.lender} will extend — for a ${(mood.feePct * 100).toFixed(0)}% fee and a `
        + `${(mood.paydownPct * 100).toFixed(0)}% paydown, ${money(due)} in total. You do not have it.`,
    };
  }
  fundAndBook(next, parcels, due, "debtSvc", { bbl });
  const nh = next.holdings[bbl]!;
  nh.loan!.balance = Math.max(0, nh.loan!.balance - paydown);
  nh.loan!.ratePct = +(nh.loan!.ratePct + mood.bumpPct).toFixed(2);
  nh.loan!.maturityM = next.month + extensionMonths(next);
  nh.loan!.sweep = true;                    // extended paper is swept paper
  nh.loan!.extensions = (nh.loan!.extensions ?? 0) + 1;
  // The coupon moved; the cheque has to cover it (the invariants test exactly that).
  nh.loan!.monthlyPmt = Math.round(next.month < nh.loan!.ioUntilM
    ? (nh.loan!.balance * nh.loan!.ratePct) / 100 / 12
    : monthlyPayment(nh.loan!.balance, nh.loan!.ratePct, nh.loan!.amortYears));
  nw.stage = "forbearance";
  nw.decideM = nh.loan!.maturityM;
  next.news.unshift({
    q: next.month, kind: "info",
    text: `${w.lender} extended at ${rec.address} to ${monthLabel(nh.loan!.maturityM)}: ${money(fee)} of fees, `
      + `${money(paydown)} paid down, and the coupon goes to ${nh.loan!.ratePct.toFixed(2)}% with cash flow swept. `
      + `You bought time and it was not cheap.`,
  });
  return { s: next, msg: "Extended." };
}

/** Hand back the keys. The civilised exit, and usually the right one. */
export function deedInLieu(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || (!h?.loan && !(h?.mezz && h.mezz.balance > 0))) {
    return { s, err: "There is nothing in default there." };
  }
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone(s);
  const value = ownedHoldingValue(next, parcels, h);
  // Deed in lieu settles the whole stack — senior and Cordage junior.
  const bal = (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0);
  const loss = Math.max(0, bal - value * 0.88);
  // A deed in lieu settles the debt in full — that is the entire consideration
  // for handing it over without a fight, and it is why it beats an auction
  // even on recourse paper.
  const seniorBal = h.loan?.balance ?? 0;
  const seniorLoss = Math.min(loss, Math.max(0, seniorBal - value * 0.88));
  const mezzLoss = loss - seniorLoss;
  if (seniorLoss > 0 && h.loan) {
    chargeLenderLoss(next, w.lender, seniorLoss);
  }
  if (mezzLoss > 0) {
    chargeLenderLoss(next, h.mezz?.holder ?? "Cordage Debt Partners", mezzLoss);
  }
  if (loss === 0) chargeLenderLoss(next, w.lender, 0);
  bumpLenderRel(next, w.lender, -12);
  if (h.mezz) bumpLenderRel(next, h.mezz.holder ?? "Cordage Debt Partners", -8);
  {
    const ex: Exit = {
      bbl, address: rec.address, boughtM: h.boughtM, soldM: next.month,
      price: Math.round(bal), basis: h.costBasis, gain: Math.round(bal - h.costBasis), forced: true,
    };
    closeDeedLedger(next, ex);
    next.exits.push(ex);
  }
  recordPropertyEvent(next, bbl, {
    kind: "default",
    party: w.lender,
    amount: Math.round(bal),
    outcome: "Deed in lieu; debt settled and control transferred to lender",
  });
  recordComp(next, rec, Math.round(bal), w.lender, firmShort(next), true, h.condition);
  if (next.groundLeases?.[bbl]) transferGroundLeaseOffBook(next, bbl);
  moveDeposit(next, next.holdings[bbl], -depositsOn(next.holdings[bbl]!));
  next.lastTradeM = next.lastTradeM ?? {};
  next.lastTradeM[bbl] = next.month;
  delete next.holdings[bbl];
  delete next.workouts![bbl];
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  markSponsor(next, "forced", rec.address, 0);
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `Handed ${rec.address} back to ${w.lender} — deed in lieu. The debt is settled in full, there is no deficiency `
      + `and no auction, and it still goes on your record. ${loss > 0 ? `They took a ${money(loss)} loss on it.` : "They came out whole."}`,
  });
  return { s: next, msg: "Keys handed over." };
}

/** One month of every file that is open. */
/**
 * A YEAR OF HOLDOVER IS ALL A DESK GIVES.
 *
 * A balloon that could not be taken out used to sit past its maturity for as
 * long as the coupon kept clearing: the file said "still waiting on a takeout"
 * every six months, the Debt page printed a maturity years in the past, and
 * the loan was never extended, never called, never re-priced. Measured over
 * three thirty-year campaigns: 61 building-months of matured paper carried
 * that way, one note for years. No lender does that. After twelve serviced
 * months of holdover the desk does one of the two ordinary things. A desk
 * with capital DOCUMENTS the extension — the same fee, coupon bump and cash
 * sweep `requestForbearance` charges when the borrower asks, with the fee
 * capitalised onto the note if the account cannot write it. A desk without
 * capital, a receiver, or a fund that bought the paper files. Once: a note
 * that has been extended is not extended twice, which is the standing rule
 * the forbearance desk already applies to the borrower.
 */
function holdoverDecision(s: GameState, parcels: ParcelTable, w: Workout, address: string): void {
  const h = s.holdings[w.bbl];
  if (!h?.loan) return;
  const mood = workoutMood(s, w.lender);
  const already = (h.loan.extensions ?? 0) >= 1;
  if (mood.willExtend && !already) {
    const l = h.loan;
    const fee = Math.round(l.balance * mood.feePct);
    const paid = fundCashNeed(s, parcels, fee);
    logBooks(s, "debtSvc", paid, w.bbl);
    if (paid < fee) {
      l.balance += fee - paid;
      l.principal = Math.max(l.principal, l.balance);
    }
    l.ratePct = +(l.ratePct + mood.bumpPct).toFixed(2);
    l.maturityM = s.month + extensionMonths(s);
    l.sweep = true;
    l.extensions = (l.extensions ?? 0) + 1;
    l.monthlyPmt = Math.round(s.month < l.ioUntilM
      ? (l.balance * l.ratePct) / 100 / 12
      : monthlyPayment(l.balance, l.ratePct, l.amortYears));
    w.stage = "forbearance";
    w.decideM = l.maturityM;
    w.asks = Math.max(w.asks, 1);
    w.servicedMs = 0;
    s.news.unshift({
      q: s.month, kind: "info",
      text: `${w.lender} documented an extension at ${address} to ${monthLabel(l.maturityM)}: a year of holdover on a `
        + `matured note and no takeout in sight, so they re-papered it themselves — ${money(fee)} of fee`
        + `${paid < fee ? " added to the note" : ""}, the coupon to ${l.ratePct.toFixed(2)}%, cash flow swept. `
        + `That is the one extension this paper gets.`,
    });
    return;
  }
  w.stage = "foreclosure";
  w.saleM = nextJulyAfter(s.month, FORECLOSE_M);
  w.decideM = w.saleM;
  bumpLenderRel(s, w.lender, -10);
  s.news.unshift({
    q: s.month, kind: "warn",
    text: `${w.lender} has filed to foreclose on ${address}: a year of holdover on a matured note and no takeout. `
      + `${already ? "They extended once already, and nobody extends twice." : mood.why} `
      + `It is down for the ${monthLabel(w.saleM)} auction — cure it, refinance it, or hand back the keys before the hammer.`,
  });
}

export function tickWorkouts(s: GameState, parcels: ParcelTable) {
  if (!s.workouts) return;
  for (const w of Object.values(s.workouts)) {
    const h = s.holdings[w.bbl];
    const rec = resolveRec(parcels, s, w.bbl);
    if (!h?.loan || !rec) { delete s.workouts[w.bbl]; continue; }

    // A file where the loan has quietly started performing again closes itself.
    // A MATURED NOTE IS A BALLOON FILE, WHATEVER THE FILE STARTED AS. A
    // covenant file open across the maturity date used to keep the takeout
    // ladder from running (tickLoan only quotes an unfiled note), then close
    // itself the month the sweep cleared — leaving a matured loan on the book
    // with no file at all until the ladder noticed it a month later. Once the
    // date has passed, the file is about the balloon: it stays open, the
    // holdover clock runs, and the desk extends or files inside a year.
    if (w.cause !== "balloon" && s.month >= h.loan.maturityM) {
      w.cause = "balloon";
      w.servicing = true;
      w.servicedMs = 0;
      refreshCureAmount(s, parcels, w);
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The note at ${rec.address} has matured with ${w.lender}'s file still open. `
          + `The file is now about the balloon: ${money(w.cure)} takes it out, and the coupon buys a year of patience, not more.`,
      });
    }

    if (w.cause === "covenant" && !h.loan.sweep) {
      delete s.workouts[w.bbl];
      s.news.unshift({ q: s.month, kind: "info", text: `${rec.address} is performing again — ${w.lender} has closed the file.` });
      continue;
    }

    // FUNDED AUTO-CURE — equity cures cash-only; arrears/balloons cash then
    // line. Runs before the clock can file, and again while foreclosure is
    // pending, because a cheque that clears ends the conversation.
    if (autoCureIfFunded(s, parcels, w)) continue;

    // THE EXTENSION RAN OUT. Extended paper that matures again is an ordinary
    // balloon: close the file so tickLoan quotes the takeout ladder fresh next
    // month, and if nobody will write it a new file opens — with the one
    // extension this note gets already spent (holdoverDecision reads it).
    // Ahead of the servicing branch on purpose: the month it matures is the
    // ladder's, not the holdover clock's.
    if (w.stage === "forbearance" && (h.loan.extensions ?? 0) >= 1 && s.month >= h.loan.maturityM) {
      delete s.workouts[w.bbl];
      continue;
    }

    // KEEPING IT CURRENT (opt-in). Charged here at the default rate; monthCF
    // still books the note coupon while the file is in notice — that premium
    // is the price of asking the desk to wait. See Workout.servicing.
    const due = Math.round(h.loan.monthlyPmt * 1.15);
    if (w.servicing && w.stage !== "foreclosure" && h.loan) {
      if (fundableNow(s, parcels) >= due) {
        const paid = fundCashNeed(s, parcels, due);
        logBooks(s, "debtSvc", paid, w.bbl);
        w.servicedMs = (w.servicedMs ?? 0) + 1;
        w.decideM = s.month + 1;
        h.loan.arrearsMs = 0;
        if ((w.servicedMs ?? 0) >= 12 && w.cause !== "balloon") {
          delete s.workouts[w.bbl];
          bumpLenderRel(s, w.lender, 6);
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `${w.lender} has closed the file on ${rec.address}. A year of payments arriving on time is `
              + `the only argument that ever worked on a credit committee.`,
          });
        } else if (w.cause === "balloon" && s.month - h.loan.maturityM >= 12) {
          // Holdover is months PAST MATURITY, not months serviced: an
          // extended note is current again until its new date.
          holdoverDecision(s, parcels, w, rec.address);
        }
        continue;
      }
      w.servicing = false;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The payment on ${rec.address} did not go out — ${money(due)} and you did not have it. `
          + `${w.lender} is no longer waiting.`,
      });
    }

    // FUNDED KEEP-ALIVE — without a second coupon. monthCF already took the
    // note payment; if the firm can still fund that payment from cash/line,
    // the notice clock does not run into a filing. This is the owner's rule
    // in one line: DS fundable ⇒ not at risk of foreclosure. Applies to
    // arrears, balloons (maturity default while the coupon still clears), and
    // every other cause — a maturity default where the borrower keeps paying
    // is the commonest CRE workout and almost never goes to the steps.
    //
    // ...BUT A MATURED NOTE STILL GETS ONE YEAR, NOT FOREVER. The holdover
    // clock below this ran only on files the borrower had opted into
    // servicing, so a balloon file whose coupon simply kept clearing out of
    // the firm's cash rolled month after month past its maturity with no
    // extension and no filing — the exact state `test/balloon-holdover.mjs`
    // and the balloon invariant exist to forbid (found when a different
    // purchase in that harness's receivership scenario reached maturity). A
    // year past the date, the desk extends once or files, whoever is paying.
    if (w.cause === "balloon" && w.stage !== "foreclosure" && !w.servicing
      && s.month - h.loan.maturityM >= 12 && couponFundable(s, parcels, h)) {
      holdoverDecision(s, parcels, w, rec.address);
      continue;
    }
    if (w.stage !== "foreclosure" && couponFundable(s, parcels, h)) {
      w.decideM = Math.max(w.decideM, s.month + 1);
      if (h.loan) h.loan.arrearsMs = 0;
    }

    if (s.month < w.decideM) continue;

    if (w.stage === "notice" || w.stage === "forbearance") {
      // Last look: take a funded cure rather than file.
      if (autoCureIfFunded(s, parcels, w)) continue;

      // A LOAN THE SPONSOR CAN KEEP CURRENT IS NOT A FORECLOSURE.
      //
      // Covenant, arrears, AND balloon files used to roll into filing on the
      // notice calendar while the firm could still write the monthly cheque —
      // the exact "I can pay the debt service and the arrears, why did they
      // take my building?" report, repeated. Lenders trap cash and demand a
      // cure (or a takeout on a balloon); they do not auction a note that is
      // being paid. Roll the window and keep asking for the cheque.
      if (couponFundable(s, parcels, h)) {
        w.decideM = w.cause === "covenant" ? s.month + NOTICE_M : s.month + 1;
        if (h.loan) h.loan.arrearsMs = 0;
        if (w.cause === "covenant" && (s.month - w.startM) % 6 === 0) {
          s.news.unshift({
            q: s.month, kind: "warn",
            text: `${w.lender} is still waiting on the equity cure at ${rec.address} (${money(w.cure)}). `
              + `The note is current, so they have not filed — but the sweep stays on until the covenant clears.`,
          });
        } else if (w.cause === "balloon" && (s.month - w.startM) % 6 === 0) {
          s.news.unshift({
            q: s.month, kind: "warn",
            text: `${w.lender} is still waiting on a takeout at ${rec.address}. `
              + `The coupon is clearing, so they have not filed — find a refinancing, sell it, or retire the note.`,
          });
        }
        continue;
      }

      // The clock ran out and the firm cannot fund the coupon. They file —
      // filing is not a sale; the July auction is. See engine/auction.ts.
      w.stage = "foreclosure";
      w.saleM = nextJulyAfter(s.month, FORECLOSE_M);
      w.decideM = w.saleM;
      bumpLenderRel(s, w.lender, -10);
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${w.lender} has filed to foreclose on ${rec.address}. It is down for the ${monthLabel(w.saleM)} auction — `
          + `you can still cure it or hand back the keys until the hammer falls, and a deed in lieu is worth `
          + `far more to you than the steps are.`,
      });
      continue;
    }
    // stage === "foreclosure": the hammer belongs to the July docket — unless
    // the firm can still fund the coupon or the cure. Auto-cure ran above;
    // a coupon-current file is pulled back to notice so the steps never see it.
    //
    // ...except a matured note past its holdover year (holdoverSpentOnFiling).
    if (w.stage === "foreclosure" && couponFundable(s, parcels, h)
      && holdoverSpentOnFiling(s, parcels, w, rec.address)) continue;
    if (w.stage === "foreclosure" && couponFundable(s, parcels, h)) {
      w.stage = "notice";
      delete w.saleM;
      w.decideM = s.month + NOTICE_M;
      h.loan.arrearsMs = 0;
      s.news.unshift({
        q: s.month, kind: "info",
        text: `${w.lender} pulled ${rec.address} back from foreclosure — the monthly debt service is fundable. `
          + `Cure the file when you can; they will not take a building that is current.`,
      });
    }
  }
}

