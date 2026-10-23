/**
 * THE NEGOTIATION, READ ONCE (owner, 2026-10-22: "the bidding approach on a
 * property could use a more interactive, feel-good UI"). Every buy path — a
 * listing (offer, counter, best and final, pay ask), an off-market approach
 * (a named ask and its one counter, or "make me an offer" and a blind bid) and
 * the contract that follows — is reduced here to one view: the numbers on the
 * ladder, the engine's odds at a price, the stage, and the one next move.
 *
 * The band and odds are the engine's own. On a listing the band is
 * `closingBand` (where this kind of seller's reservation sits, acquire.ts)
 * moved by `phaseShift`, the same centre and the same cycle the negotiation
 * reads; the reservation itself is never shown, so a listing has no odds
 * figure. An off-market counter is one roll against `counterTakeOdds`, so it
 * shows where that roll is even or better, and the odds at your price. A
 * "make me an offer" owner shows none, by design (types.ts Approach.reserve).
 * The insult line drawn is the public part of negotiate's (`insultShareOfAsk`).
 */
import type { GameState, Talks } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import type { Adjacency } from "@/data/types";
import { counterTakeOdds } from "@/engine/actions";
import { closingBand, insultShareOfAsk, phaseShift, sellerOf, sellerProfile } from "@/engine/acquire";
import { initialCondition, marketAppraisal, resolveRec } from "@/engine/value";
import { useStore } from "@/state/store";
import { useNext, type DealLine } from "./nextStore";

export type Stage =
  | "approach"   // not for sale, not yet rung
  | "refused"    // the owner said no (or the door is shut)
  | "blind"      // "make me an offer": no number from them
  | "named"      // off-market, they named an ask
  | "listed"     // on the market, no conversation yet
  | "talks"      // offers and counters going back and forth
  | "final"      // their last word
  | "agreed";    // under contract: fund it

export interface DealView {
  stage: Stage;
  offMarket: boolean;
  /** the listing's ask, or the owner's named ask */
  ask: number | null;
  appraisal: number;
  /** their number on the table in a live conversation */
  theirs: number | null;
  yours: number | null;
  round: number | null;
  maxRounds: number | null;
  agreed: number | null;
  closeByM: number | null;
  deposit: number | null;
  seller: string;
  sellerKind: string;
  /** odds a price is taken, from the engine; null where the game hides them */
  odds: ((px: number) => number) | null;
  /** a listing: where this kind of seller usually closes; an off-market counter: where the odds are even or better */
  band: { lo: number; hi: number } | null;
  /** under this, the conversation ends */
  insult: number | null;
  /** an off-market counter is spent */
  countered: boolean;
  /** the door shut until this month */
  shutUntil: number | null;
  defaultPx: number;
}

const lenderSaleOf = (l: { distress?: boolean; reason?: string; receiverFor?: string; loanBasis?: number } | undefined) =>
  !!l?.distress && (l.reason === "receiver" || !!l.receiverFor || !!l.loanBasis);

/** From where the odds first reach even, up to `ref` (their ask): the prices they more likely take than not. */
function bandOf(odds: (px: number) => number, ref: number): { lo: number; hi: number } | null {
  for (let r = 0.5; r <= 1; r += 0.0025) if (odds(ref * r) >= 0.5) return { lo: ref * r, hi: ref };
  return null;
}

export function dealView(game: GameState, parcels: ParcelTable, adjacency: Adjacency | null, bbl: string): DealView | null {
  const rec = resolveRec(parcels, game, bbl);
  if (!rec) return null;
  const appraisal = marketAppraisal(game, rec, bbl, initialCondition(rec));
  const listing = game.listings.find((l) => l.bbl === bbl);
  const t: Talks | undefined = game.talks?.[bbl];
  const ap = game.approaches[bbl];
  const who = sellerOf(game, parcels, bbl);
  const base: DealView = {
    stage: "approach", offMarket: !listing, ask: null, appraisal, theirs: null, yours: null, round: null, maxRounds: null,
    agreed: null, closeByM: null, deposit: null, seller: who.name, sellerKind: sellerProfile(who.kind).label,
    odds: null, band: null, insult: null, countered: false, shutUntil: null, defaultPx: Math.round(appraisal / 1000) * 1000,
  };
  if (t?.agreed) {
    const px = t.agreedPrice ?? t.theirPrice;
    return { ...base, stage: "agreed", ask: listing?.ask ?? null, agreed: px, theirs: px, yours: px, closeByM: t.closeByM ?? null, deposit: t.deposit ?? null, seller: t.sellerName, defaultPx: px };
  }
  if (listing) {
    const cb = closingBand(who.kind, { distress: !!listing.distress, lenderSale: lenderSaleOf(listing) });
    const ph = phaseShift(game);
    const insult = Math.round(listing.ask * insultShareOfAsk(!!listing.distress, lenderSaleOf(listing)));
    const shut = ap?.insultedUntilM !== undefined && game.month < ap.insultedUntilM ? ap.insultedUntilM : null;
    const v: DealView = { ...base, stage: "listed", ask: listing.ask, band: { lo: listing.ask * (cb.lo + ph), hi: listing.ask * (cb.hi + ph) }, insult, shutUntil: shut,
      defaultPx: Math.round((listing.ask * (listing.distress ? 0.9 : 0.96)) / 1000) * 1000 };
    if (shut !== null) return { ...v, stage: "refused" };
    if (t) {
      return { ...v, stage: t.final ? "final" : "talks", theirs: t.theirPrice, yours: t.yourPrice, round: t.round, maxRounds: t.maxRounds,
        seller: t.sellerName, defaultPx: Math.round((t.yourPrice + (t.theirPrice - t.yourPrice) * 0.5) / 1000) * 1000 };
    }
    return v;
  }
  if (!ap) return base;
  const cold = (ap.coldUntilM ?? 0) > game.month;
  if (ap.refused || cold) return { ...base, stage: "refused", shutUntil: Math.max(ap.coldUntilM ?? 0, ap.insultedUntilM ?? 0, ap.q + 6) };
  if (ap.ask !== undefined) {
    const a = ap;
    const odds = adjacency && !ap.countered
      ? (px: number) => (px >= a.ask! ? 1 : counterTakeOdds(game, adjacency, bbl, a, px))
      : null;
    return { ...base, stage: "named", ask: ap.ask, theirs: ap.ask, odds, band: odds ? bandOf(odds, ap.ask) : null, countered: !!ap.countered,
      yours: ap.lastBid ?? null, defaultPx: ap.countered ? ap.ask : Math.round((ap.ask * 0.94) / 1000) * 1000 };
  }
  if (game.month > ap.q + 6) return { ...base, stage: "approach" };
  return { ...base, stage: "blind", yours: ap.lastBid ?? null, defaultPx: ap.lastBid ? Math.round((ap.lastBid * 1.05) / 1000) * 1000 : base.defaultPx };
}

// ---------------------------------------------------------------- acting, and saying what happened
export type DealAct = "offer" | "final" | "take" | "walk" | "approach" | "counterOff" | "bid" | "close";

const fmtM = (v: number) => "$" + (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1e3) + "K");

/** Run a move through the store and log both sides of it to the thread. */
export function dealAct(bbl: string, act: DealAct, px?: number, finance?: { product: string; lev: number }) {
  const st = useStore.getState();
  const g0 = st.game;
  if (!g0) return;
  const t0 = g0.talks?.[bbl];
  const a0 = g0.approaches[bbl];
  const ask0 = g0.listings.find((l) => l.bbl === bbl)?.ask;
  switch (act) {
    case "offer": st.offer(bbl, px!, false); break;
    case "final": st.offer(bbl, px!, true); break;
    case "take": st.acceptCounter(bbl); break;
    case "walk": st.walkAway(bbl); break;
    case "approach": st.approach(bbl); break;
    case "counterOff": st.counterOff(bbl, px); break;
    case "bid": st.bidBlind(bbl, px!); break;
    case "close":
      if (t0?.agreed) st.closeDeal(bbl, finance!.product, finance!.lev || 1);
      else st.buyOff(bbl, finance!.product as never, finance!.lev || 1);
      break;
  }
  const g = useStore.getState().game;
  if (!g || g === g0) return; // refused before anything happened: the toast says why
  const m = g.month;
  const lines: DealLine[] = [];
  const you = (what: string, p?: number) => lines.push({ who: "you", what, px: p, m });
  const them = (what: string, p?: number, tone?: DealLine["tone"]) => lines.push({ who: "them", what, px: p, tone, m });
  const t = g.talks?.[bbl];
  const a = g.approaches[bbl];
  const afterTalk = () => {
    if (t?.agreed) them("Accepted", t.agreedPrice ?? t.theirPrice, "ok");
    else if (t) them(t.final ? "Final" : "Counter", t.theirPrice, t.final ? "warn" : undefined);
    else if (a?.insultedUntilM !== undefined && a.insultedUntilM > m) them("Insulted · out", undefined, "bad");
    else them("Walked away", undefined, "bad");
  };
  switch (act) {
    case "offer": you(ask0 !== undefined && px! >= ask0 ? "Pay ask" : t0 ? "Counter" : "Offer", px); afterTalk(); break;
    case "final": you("Best & final", px); afterTalk(); break;
    case "take": you("Take", t0?.theirPrice); afterTalk(); break;
    case "walk": you("Walk"); break;
    case "approach":
      you("Ring owner");
      if (!a || a.refused) them("Not selling", undefined, "bad");
      else if (a.ask !== undefined) them("Asks", a.ask);
      else them("Make an offer");
      break;
    case "counterOff":
      you("Counter", px);
      if (!a || a.refused || a.ask === undefined) them("Ended it", undefined, "bad");
      else if (a.ask === a0?.ask) them("Held", a.ask, "warn");
      else if (Math.abs(a.ask - Math.round(px! / 1000) * 1000) < 1) them("Accepted", a.ask, "ok");
      else them("Came down", a.ask);
      break;
    case "bid":
      you("Bid", px);
      if (t?.agreed) them("Accepted", t.agreedPrice ?? t.theirPrice, "ok");
      else if (a && !a.refused && a.ask !== undefined) them("Named", a.ask);
      else if (!a || a.refused || a.reserve === undefined) them("Ended it", undefined, "bad");
      else them("No", undefined, "warn");
      break;
    case "close":
      you("Close", t0?.agreedPrice ?? a0?.ask);
      if (g.holdings[bbl]) them("Closed", undefined, "ok");
      break;
  }
  useNext.getState().logDeal(bbl, lines);
  useNext.getState().setDealPx(bbl, null);
}

/** The last answer, in words for the banner, and the next step. */
export function dealHeadline(v: DealView, last: DealLine | undefined, month: number): { head: string; px?: number; tone: "ok" | "warn" | "bad" | "info"; next: string } {
  switch (v.stage) {
    case "agreed": return { head: "Accepted", px: v.agreed!, tone: "ok", next: v.closeByM !== null ? `Fund in ${Math.max(0, v.closeByM - month)} mo` : "Fund it" };
    case "final": return { head: "Final offer", px: v.theirs!, tone: "warn", next: "Take it or walk" };
    case "talks": return { head: "Countered", px: v.theirs!, tone: "info", next: `Round ${v.round} of ${v.maxRounds}` };
    case "refused": return { head: last?.what === "Insulted · out" ? "Insulted" : "Refused", tone: "bad", next: v.shutUntil ? `Shut ${Math.max(0, v.shutUntil - month)} mo` : "Try later" };
    case "named": return v.countered
      ? { head: last?.what === "Accepted" ? "Accepted" : last?.what === "Came down" ? "Came down" : "Their number", px: v.ask!, tone: last?.what === "Accepted" ? "ok" : "info", next: "Buy or leave" }
      : { head: "Owner asks", px: v.ask!, tone: "info", next: "One counter" };
    case "blind": return { head: last?.what === "No" ? "No" : "Make an offer", tone: last?.what === "No" ? "warn" : "info", next: "Bid blind" };
    case "listed": return last?.who === "them" && last.tone === "bad"
      ? { head: last.what, tone: "bad", next: "Still listed" }
      : { head: "Listed", px: v.ask!, tone: "info", next: v.sellerKind };
    default: return { head: "Off market", tone: "info", next: "Ring the owner" };
  }
}

export { fmtM };
