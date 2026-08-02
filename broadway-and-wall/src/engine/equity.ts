// THIRD-PARTY EQUITY: THE OTHER HALF OF THE BUSINESS.
//
// Until this file existed you played entirely off your own balance sheet, and
// your growth rate was capped by arithmetic. That is not what a principal does
// and it is not how anyone in this industry gets big. The defining structure
// of private real estate is somebody else's money: a limited partner writes
// most of the equity, takes a preferred return on it, and the sponsor — you —
// puts in a slice, runs the asset, and earns a promote on what is left after
// the partner has been made whole.
//
// It is not free money. Everything about it is a trade:
//
//   • You keep a fraction of a bigger thing. Ninety per cent of one building
//     is often worth less than twenty per cent of five.
//   • The pref accrues whether the building performs or not. A deal that
//     stalls does not stop owing; it compounds, and it eats the promote from
//     underneath before it ever touches your capital.
//   • The partner is paid before you are. In a bad year your distribution is
//     zero and theirs is not.
//   • And they remember. Every deal you return above the pref makes the next
//     raise cheaper and bigger; every one that comes back short, or comes back
//     asking for more, makes it dearer and smaller — and enough of them and
//     nobody picks up the phone.
//
// The structure modelled here is the standard one: a straight preferred return
// on unreturned capital, capital back, then a promote to the sponsor over the
// hurdle. No catch-up tier, no multiple-based waterfall, no clawback — those
// are real and they are variations on this, and this is the one that decides
// whether the whole idea is worth playing with.
import type { ParcelTable } from "@/data/types";
import type { GameState, JointVenture } from "./types";
import { logBooks } from "./types";
import { holdingValue, resolveRec } from "./value";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Where a sponsor with no history starts: able to raise, on unfriendly terms. */
export const LP_REP_START = 50;

/**
 * WHAT THE MONEY COSTS YOU, given what you have done with it before.
 *
 * A first-time sponsor gets a hard pref, a small promote and a partner who
 * will not go past two-thirds of the equity. A sponsor with a decade of
 * realised deals behind them raises ninety per cent at eight and keeps a
 * quarter of the upside — and that difference, compounded over a career, is
 * larger than any single deal in this game.
 */
export function lpTerms(s: GameState) {
  const rep = clamp(s.lpRep ?? LP_REP_START, 0, 100);
  const t = rep / 100;
  return {
    rep,
    // the pref falls as they trust you; it rises when the risk-free does,
    // because a partner prices against what they can get elsewhere
    prefPct: +(11.5 - 4.0 * t + Math.max(0, s.econ.indexRate - 5) * 0.35).toFixed(2),
    promotePct: +(0.12 + 0.16 * t).toFixed(3),
    maxShare: +(0.55 + 0.37 * t).toFixed(3),
    // Nobody backs a sponsor who has handed back keys twice. Below this the
    // phone does not get picked up at all.
    open: rep >= 18,
  };
}

/** Verdict on the market's appetite, in words, for the raise screen. */
export function lpMood(s: GameState): string {
  const rep = clamp(s.lpRep ?? LP_REP_START, 0, 100);
  if (rep >= 82) return "Institutions call you. You set the terms.";
  if (rep >= 62) return "You have a track record and they price it.";
  if (rep >= 40) return "They will look at it. They will not be generous.";
  if (rep >= 18) return "Family money and friends. Expensive, and they want control.";
  return "Nobody is returning your calls. Fix the book you have.";
}

/**
 * SELL A STAKE IN A BUILDING YOU ALREADY OWN.
 *
 * A recapitalisation, which is how most sponsor equity is actually raised: the
 * building exists, it has a value, and a partner buys into that value at that
 * value. You take their cheque as cash today and keep operating control; what
 * you give up is their share of every dollar the building produces from here,
 * and their pref, which starts accruing the moment the money lands.
 *
 * The quote is against EQUITY, not value. A partner buys the equity in the
 * deal, not the building — the debt stays exactly where it is.
 */
export function recapQuote(s: GameState, parcels: ParcelTable, bbl: string, share: number) {
  const h = s.holdings[bbl];
  const rec = h ? resolveRec(parcels, s, bbl) : null;
  const t = lpTerms(s);
  if (!h || !rec) return null;
  const value = holdingValue(rec, s.econ, h, s.month);
  const equity = Math.max(0, value - (h.loan?.balance ?? 0));
  const sh = clamp(share, 0.05, t.maxShare);
  // They pay a small discount to appraisal, because nobody buys into somebody
  // else's deal at the number the sponsor's own spreadsheet produced.
  const disc = 0.965 - 0.05 * (1 - t.rep / 100);
  const cheque = Math.round(equity * sh * disc);
  return { value, equity, share: sh, cheque, ...t };
}

export function recapitalise(
  s: GameState, parcels: ParcelTable, bbl: string, share: number,
): { s: GameState; err?: string; msg?: string } {
  const t = lpTerms(s);
  if (!t.open) return { s, err: "No partner will look at you right now. Return some capital first." };
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You don't own that." };
  if (s.jvs?.[bbl]) return { s, err: "There is already a partner in this deal." };
  if (h.sale) return { s, err: "It's on the market — pull the listing first." };
  const q = recapQuote(s, parcels, bbl, share);
  if (!q || q.cheque <= 0) return { s, err: "There is no equity in it to sell." };
  const next: GameState = JSON.parse(JSON.stringify(s));
  next.cash += q.cheque;
  logBooks(next, "sold", -q.cheque);
  if (!next.jvs) next.jvs = {};
  next.jvs[bbl] = {
    bbl,
    lpShare: q.share,
    prefPct: q.prefPct,
    promotePct: q.promotePct,
    lpCapital: q.cheque,
    accruedPref: 0,
    lpDistributed: 0,
    promoteEarned: 0,
    openedM: next.month,
  };
  const rec = resolveRec(parcels, next, bbl);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Partner in at ${rec?.address ?? bbl}: $${(q.cheque / 1e6).toFixed(2)}M for ${(q.share * 100).toFixed(0)}% of the equity, `
      + `${q.prefPct.toFixed(1)}% preferred, ${(q.promotePct * 100).toFixed(0)}% promote to you over the hurdle. `
      + `Their money is out and it starts counting today.`,
  });
  return { s: next, msg: `Raised ${(q.cheque / 1e6).toFixed(2)}M.` };
}

/**
 * A MONTH OF PARTNERSHIP.
 *
 * The pref accrues on unreturned capital — every month, whether or not the
 * building made a dollar. Then, if the building distributed anything, the
 * partner's share of it goes to them: accrued pref first, then capital, and
 * only what is left over is split with your promote on top.
 *
 * `cf` is this building's cash flow after debt service. It has already been
 * added to your cash by the caller; what comes back is what has to come out
 * of it again.
 */
export function tickJV(s: GameState, bbl: string, cf: number): number {
  const jv = s.jvs?.[bbl];
  if (!jv) return 0;
  const unreturned = Math.max(0, jv.lpCapital - jv.lpDistributed);
  jv.accruedPref += (unreturned * jv.prefPct) / 100 / 12;
  if (cf <= 0) return 0;

  // OPERATING CASH GOES TO THE PREF FIRST, all of it, not just their share.
  // That is the whole meaning of the word: until the preferred return is
  // current the sponsor takes nothing out of the building. Only once it is
  // caught up does the split become a split.
  let left = cf;
  const prefPay = Math.min(left, jv.accruedPref);
  jv.accruedPref -= prefPay;
  left -= prefPay;
  // Residual operating cash is shared by ownership, and the promote comes off
  // the partner's half. Return OF capital happens on the sale, not out of
  // operations — an operating distribution is a return ON it.
  const lpResidual = left * jv.lpShare;
  const promote = Math.round(lpResidual * jv.promotePct);
  jv.promoteEarned += promote;
  const lpCash = Math.round(prefPay + lpResidual - promote);
  return Math.max(0, Math.min(Math.round(cf), lpCash));
}

/**
 * THE WATERFALL ON A SALE.
 *
 * Net proceeds after debt and costs. The partner is made whole — capital, then
 * every dollar of pref that ever accrued — and only then is there a profit to
 * promote on. A deal that sold for less than the partner put in pays you
 * nothing at all, no matter how long you ran it, which is the entire risk of
 * being the sponsor and the reason the promote is worth what it is.
 *
 * Returns what leaves your pocket, and closes the partnership.
 */
export function settleJV(s: GameState, bbl: string, netProceeds: number): { lpCash: number; promote: number; note: string } {
  const jv = s.jvs?.[bbl];
  if (!jv) return { lpCash: 0, promote: 0, note: "" };
  // Their share of the proceeds, run through the capital account: capital,
  // then pref, then profit less the promote.
  const w = lpSide(jv, netProceeds);
  const promote = Math.round(w.promote);
  const lpCash = Math.round(w.lpCash);

  // REPUTATION IS SETTLED HERE, and only here. Money you told them you would
  // make is not money; a wire is money.
  const put = jv.lpCapital;
  const got = jv.lpDistributed + lpCash;
  const mult = put > 0 ? got / put : 1;
  const yrs = Math.max(0.5, (s.month - jv.openedM) / 12);
  // an annualised return against the pref they were promised
  const ann = (Math.pow(Math.max(0.05, mult), 1 / yrs) - 1) * 100;
  const beat = ann - jv.prefPct;
  s.lpRep = clamp((s.lpRep ?? LP_REP_START) + clamp(beat * 1.6, -22, 12), 0, 100);

  const note = mult >= 1.6 ? "They made money with you and they will remember it."
    : mult >= 1.05 ? "Capital back and a return. Nobody is unhappy."
    : mult >= 0.9 ? "They got most of it back. That conversation was not pleasant."
    : "They lost money in your deal. That follows you.";
  delete s.jvs![bbl];
  return { lpCash: Math.max(0, lpCash), promote, note };
}

/**
 * A CAPITAL CALL.
 *
 * When a partnered building needs money it does not have — a loan paydown, a
 * roof, a lease-up that ran long — the partnership is called on for it. The
 * partner funds their share IF they still believe in you; otherwise you fund
 * the whole thing yourself, and the shortfall is added to their unreturned
 * capital as if they had put it in, because that is what a non-contributing
 * partner's dilution protection actually costs the sponsor.
 *
 * Returns what the partner put in. Mutates in place.
 */
export function capitalCall(s: GameState, bbl: string, need: number): number {
  const jv = s.jvs?.[bbl];
  if (!jv || need <= 0) return 0;
  const rep = clamp(s.lpRep ?? LP_REP_START, 0, 100);
  const willing = rep > 35;
  // Being called on is never a good sign, but the damage is in the SIZE of the
  // ask, not the frequency of the wire. Charging a flat penalty every month a
  // building bled took a sponsor from fifty to nothing inside a decade on one
  // mediocre asset, which is not how anybody's reputation works.
  const bite = clamp((need / Math.max(1, jv.lpCapital)) * 90, 0.02, 3.5);
  s.lpRep = clamp(rep - bite, 0, 100);
  if (!willing) return 0;
  const put = Math.round(need * jv.lpShare);
  jv.lpCapital += put;
  return put;
}

/**
 * YOUR SHARE OF A PARTNERED BUILDING, marked today.
 *
 * Net worth was counting the whole equity in every building, which on a deal
 * where somebody else wrote most of the cheque is not your money. This runs
 * the same waterfall the sale would: their capital and their pref come off the
 * top, the residual is split by ownership, and your promote comes back to you.
 */
export function gpEquity(s: GameState, bbl: string, equity: number): number {
  const jv = s.jvs?.[bbl];
  if (!jv) return equity;
  return equity - lpSide(jv, equity).lpCash;
}

/**
 * THE CAPITAL ACCOUNT, and the only place the waterfall is written.
 *
 * The partner owns `lpShare` of the equity. Out of THAT share — not out of the
 * whole deal — comes their capital back, then the preferred return they are
 * owed, and whatever is left is profit, of which your promote is a slice.
 *
 * Running capital back off the top of the WHOLE deal and then also giving them
 * their share of the residual paid them twice: a recapitalisation that should
 * have been net-worth neutral on the day it closed instead knocked nearly
 * three million off it, because the sponsor was handing over their own retained
 * equity as well as the stake they had sold. Their money is at risk in their
 * share of the building; yours is at risk in yours. That is the deal.
 */
function lpSide(jv: JointVenture, equity: number) {
  const side = Math.max(0, equity) * jv.lpShare;
  const unreturned = Math.max(0, jv.lpCapital - jv.lpDistributed);
  const capBack = Math.min(side, unreturned);
  const afterCap = side - capBack;
  const prefPay = Math.min(afterCap, jv.accruedPref);
  const profit = afterCap - prefPay;
  const promote = profit * jv.promotePct;
  return { side, capBack, prefPay, profit, promote, lpCash: capBack + prefPay + profit - promote };
}

/** Everything you owe a partner today, for the books. */
export function jvSummary(s: GameState) {
  const jvs = Object.values(s.jvs ?? {}) as JointVenture[];
  let raised = 0, unreturned = 0, pref = 0, promote = 0;
  for (const j of jvs) {
    raised += j.lpCapital;
    unreturned += Math.max(0, j.lpCapital - j.lpDistributed);
    pref += j.accruedPref;
    promote += j.promoteEarned;
  }
  return { count: jvs.length, raised, unreturned, pref, promote };
}
