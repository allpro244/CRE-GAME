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
import type { GameState, Workout } from "./types";
import { logBooks, monthLabel, nextJulyAfter } from "./types";
import { firmShort } from "./firm";
import { rrange } from "./market";
import { holdingValue, resolveRec } from "./value";
import { productById, bumpLenderRel } from "./debt";
import { capitalRatio, chargeLenderLoss, lenderByName } from "./lenders";
import { markSponsor } from "./sponsor";
import { recordComp } from "./comps";
import { depositsOn } from "./leasing";

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** How long they let it run before the auction, by stage. */
const NOTICE_M = 6;        // the cure period
const FORECLOSE_M = 8;     // once they have filed

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
    // The price of time, and it is not small.
    feePct: healthy ? 0.01 : 0.02,
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
  if (!h?.loan) return;
  if (!s.workouts) s.workouts = {};
  // WHOEVER IS HOLDING IT TODAY. A loan can be sold, and the firm that bought
  // your mortgage at a discount is not the bank you signed with. See notes.ts.
  const lender = h.loan.holder ?? productById(h.loan.product).lender;
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
export function serviceWorkout(s: GameState, bbl: string, on: boolean): { s: GameState; err?: string; msg?: string } {
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
  next.news.unshift({
    q: next.month, kind: on ? "deal" : "warn",
    text: on
      ? `You will keep ${bbl} current out of the rest of the book — ${money(Math.round(h.loan.monthlyPmt * 1.15))} a month `
        + `at the default rate. The clock stops while the cheques clear.`
      : `You have stopped paying on ${bbl}. ${w.lender}'s clock is running again.`,
  });
  return { s: next, msg: on ? "The lender will wait while you pay." : "Stopped." };
}

export function cureWorkout(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string; msg?: string } {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.cash < w.cure) return { s, err: `Curing it takes ${money(w.cure)} — you are short ${money(w.cure - s.cash)}.` };
  const next = clone(s);
  next.cash -= w.cure;
  logBooks(next, "debtSvc", w.cure);
  const nh = next.holdings[bbl]!;
  if (w.cause === "balloon") { nh.loan = null; }
  else { nh.loan!.sweep = false; nh.loan!.cleanQs = 0; }
  delete next.workouts![bbl];
  bumpLenderRel(next, w.lender, 4);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Cured the default at ${rec.address} — ${money(w.cure)} to ${w.lender}. `
      + `They will remember that you found it, which is most of what a relationship is.`,
  });
  return { s: next, msg: "Cured." };
}

/** Ask them to wait. */
export function requestForbearance(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  if (w.stage === "foreclosure") return { s, err: "They have filed. That conversation is over." };
  if (w.asks >= 1) return { s, err: "You have already been to them once on this building. Nobody extends twice." };
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
  if (next.cash < due) {
    return {
      s,
      err: `${w.lender} will extend — for a ${(mood.feePct * 100).toFixed(0)}% fee and a `
        + `${(mood.paydownPct * 100).toFixed(0)}% paydown, ${money(due)} in total. You do not have it.`,
    };
  }
  next.cash -= due;
  logBooks(next, "debtSvc", due);
  const nh = next.holdings[bbl]!;
  nh.loan!.balance = Math.max(0, nh.loan!.balance - paydown);
  nh.loan!.ratePct = +(nh.loan!.ratePct + mood.bumpPct).toFixed(2);
  nh.loan!.maturityM = next.month + Math.round(rrange(next, 18, 30));
  nh.loan!.sweep = true;                    // extended paper is swept paper
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
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone(s);
  const value = holdingValue(rec, next.econ, h, next.month);
  const bal = h.loan.balance;
  const loss = Math.max(0, bal - value * 0.88);
  // A deed in lieu settles the debt in full — that is the entire consideration
  // for handing it over without a fight, and it is why it beats an auction
  // even on recourse paper.
  chargeLenderLoss(next, w.lender, loss);
  bumpLenderRel(next, w.lender, -12);
  next.exits.push({
    bbl, address: rec.address, boughtM: h.boughtM, soldM: next.month,
    price: Math.round(bal), basis: h.costBasis, gain: Math.round(bal - h.costBasis), forced: true,
  });
  recordComp(next, rec, Math.round(bal), w.lender, firmShort(next), true, h.condition);
  if (next.groundLeases?.[bbl]) delete next.groundLeases[bbl];
  next.cash -= depositsOn(next.holdings[bbl]!);
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
export function tickWorkouts(s: GameState, parcels: ParcelTable) {
  if (!s.workouts) return;
  for (const w of Object.values(s.workouts)) {
    const h = s.holdings[w.bbl];
    const rec = resolveRec(parcels, s, w.bbl);
    if (!h?.loan || !rec) { delete s.workouts[w.bbl]; continue; }

    // A file where the loan has quietly started performing again closes itself.
    if (w.cause === "covenant" && !h.loan.sweep) {
      delete s.workouts[w.bbl];
      s.news.unshift({ q: s.month, kind: "info", text: `${rec.address} is performing again — ${w.lender} has closed the file.` });
      continue;
    }
    // KEEPING IT CURRENT. See Workout.servicing. While the lender has not
    // filed, a borrower who goes on paying is a borrower the lender would
    // rather keep — so every month the cheque clears, the clock moves with it
    // and nothing is decided. The payment is the ordinary one plus the default
    // spread, because a loan in default does not accrue at the note rate.
    if (w.servicing && w.stage !== "foreclosure" && h.loan) {
      const due = Math.round(h.loan.monthlyPmt * 1.15);
      if (s.cash >= due) {
        s.cash -= due;
        logBooks(s, "debtSvc", due);
        w.servicedMs = (w.servicedMs ?? 0) + 1;
        w.decideM = s.month + 1;
        h.loan.arrearsMs = 0;
        // A file that has been performing for a year stops being a file. The
        // lender has what they wanted and no reason to spend money on lawyers.
        if ((w.servicedMs ?? 0) >= 12 && w.cause !== "balloon") {
          delete s.workouts[w.bbl];
          bumpLenderRel(s, w.lender, 6);
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `${w.lender} has closed the file on ${rec.address}. A year of payments arriving on time is `
              + `the only argument that ever worked on a credit committee.`,
          });
        }
        continue;
      }
      // The cheque did not clear. That is the end of the arrangement.
      w.servicing = false;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The payment on ${rec.address} did not go out — ${money(due)} and you did not have it. `
          + `${w.lender} is no longer waiting.`,
      });
    }
    if (s.month < w.decideM) continue;

    if (w.stage === "notice" || w.stage === "forbearance") {
      // The clock ran out. They file — and a filing is not a sale. The sale
      // is the county's, once a year, in July, on the courthouse steps with
      // everything else that finished the process. See engine/auction.ts.
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
    // stage === "foreclosure": the hammer belongs to the July docket now —
    // engine/auction.ts settles it, credit bid, surplus, deficiency and all.
  }
}

const money = (n: number) =>
  Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
