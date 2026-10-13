// THE PAYMENT ARITHMETIC, ONCE.
//
// The level-payment annuity and the interest-only/amortising recast were
// written out by hand in eleven places — tickLoan, the equity cure, the
// partial paydown, both balloon branches, the workout cure, both extension
// paths, the purchase close and the facility (which kept its own private copy
// of the annuity). Each copy rounded a little differently and two of them
// recut on the ORIGINAL amortisation rather than what was left of it, so the
// same loan had a different payment depending on which door it last came
// through, until tickLoan overwrote it the next month. One quantity, one
// function. This module imports nothing so every debt file can use it.

/** Level monthly payment on a fully amortising loan. A zero rate is straight-line, not NaN. */
export function monthlyPayment(principal: number, ratePct: number, years: number): number {
  const i = ratePct / 100 / 12;
  const n = Math.max(1, years * 12);
  if (i <= 0) return principal / n;
  return (principal * i) / (1 - Math.pow(1 + i, -n));
}

/**
 * THIS MONTH'S CHEQUE. Interest-only rounds UP (rounding down let the balance
 * creep upward a few cents a month forever — see tickLoan); amortising paper
 * is the level payment over the years given.
 */
export function scheduledPayment(balance: number, ratePct: number, io: boolean, amortYears: number): number {
  return io
    ? Math.ceil((balance * ratePct) / 100 / 12)
    : Math.round(monthlyPayment(balance, ratePct, amortYears));
}

/** The shape of a loan this needs — `Loan` in types.ts satisfies it. */
export interface Amortising {
  balance: number;
  ratePct: number;
  ioUntilM: number;
  amortYears: number;
  originM: number;
  monthlyPmt: number;
}

/**
 * RE-CUT THE PAYMENT ON WHAT IS LEFT. Interest-only until `ioUntilM`, then the
 * level payment over the amortisation REMAINING since origination (never less
 * than a year) — which reproduces the schedule a level-payment loan follows
 * through any paydown, cure or reprice. This is the rule tickLoan applies every
 * month; every other path that changes a balance or a coupon now applies the
 * same one, so the payment a news line quotes is the payment that is charged.
 */
export function recastPayment(loan: Amortising, month: number): number {
  const io = month < loan.ioUntilM;
  const yearsLeft = Math.max(1, loan.amortYears - (month - loan.originM) / 12);
  loan.monthlyPmt = scheduledPayment(loan.balance, loan.ratePct, io, yearsLeft);
  return loan.monthlyPmt;
}

/**
 * WHAT A RATE CAP COSTS AT CLOSING, as a share of the notional. A
 * three-year cap struck about a point over the index on SOFR paper priced
 * around 1-1.5% of notional through the 2010s; 1.25% is the middle of that.
 * A calibrated market fact, not a tuning knob — it lived as a bare 0.0125 in
 * eight places (the close, the refi, the cap desk, the purchase card and three
 * UI cells), which is how a card and a close come to disagree.
 */
export const CAP_PREMIUM_PCT = 0.0125;
export const capPremiumOn = (notional: number): number => Math.round(notional * CAP_PREMIUM_PCT);
