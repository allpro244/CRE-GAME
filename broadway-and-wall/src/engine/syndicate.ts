/**
 * DEAL-BY-DEAL SYNDICATION — outside equity in one job (CAPITAL_RAISING_PLAN.md
 * §4). This is how a small developer actually builds something bigger than
 * its own balance sheet: it puts in what it has, and people who know it put
 * in the rest of the equity on a pref-and-promote deal.
 *
 * WHAT IS BUILT HERE (the first slice of §0.5 step 4):
 *   - a syndication is formed when ground is broken (startDevelopment's
 *     `syndicate` option), on a deed the sponsor owns outright;
 *   - the money is FRIENDS AND FAMILY only, on the terms the plan gives an
 *     Unknown sponsor (§3.4): at most $1 of outside equity per $1 of the
 *     sponsor's own, a 12% pref, a 10% promote only above a 15% IRR, and the
 *     sponsor guarantees completion — overruns past the investors'
 *     commitment are the sponsor's alone;
 *   - the network is finite (`ffNetwork`), shrinks when its money is lost and
 *     grows by what it earned when it is paid back.
 * NOT YET: the reputation score and the bands above Unknown, the investor
 * market and raise times, fees, the capital-source picker beyond the build
 * desk, recaps. Each is its own step in §0.5.
 *
 * HOW THE MONEY MOVES. The deed stays on the sponsor's books and every cheque
 * still moves through `s.cash`, so nothing else in the engine changes. Every
 * owner-side flow booked to the deed nets into `pending` (types.ts logBooks);
 * once a month (and at formation) the net settles with the investors through
 * the waterfall (waterfall.ts): a surplus is a distribution, a shortfall a
 * capital call. Netting first is what stops a sponsor taking promote on
 * gross rent while sharing costs pro rata. The record lives in
 * `s.syndications`, off the holding, so the last settlement after ANY exit —
 * a sale, a foreclosure, an auction — is the same code.
 *
 * The settlement books `lpCalled` / `lpDistributed` WITHOUT the deed: the
 * deed's own equity ledger stays the whole deal's (the gross deal IRR on its
 * exit record), and the investors' net IRR is written when the deal closes
 * (`synClosed`), which is the record investors read.
 */
import type { ParcelTable } from "@/data/types";
import type { GameState, Syndication } from "./types";
import { logBooks } from "./types";
import { accrueMonth, contribute, settlePeriod, seriesIrr, sponsorPosition, lpCapShare } from "./waterfall";
import { resolveRec, ownedHoldingValue, cipEquity } from "./value";

/** The investors a first-time sponsor can call. */
export const FF_INVESTOR = "Friends and family";
/**
 * Terms for an Unknown sponsor (CAPITAL_RAISING_PLAN.md §3.4, the band table):
 * a 12% pref, nothing extra until the investors clear a 15% IRR, 10% of what
 * is above it. Starting design values from the plan, cited there against
 * small-sponsor syndication practice; not tuned.
 */
export const FF_TERMS = { hurdles: [0.12, 0.15], promotes: [0, 0.10] } as const;
/** At most $1 of outside equity per $1 of the sponsor's own (§3.4, Unknown). */
export const FF_MAX_OUTSIDE_PER_OWN = 1;

/**
 * THE FRIENDS-AND-FAMILY NETWORK. A shape parameter (§3.4: "sized at the start
 * of the game"): people who know a founder tend to have money on the
 * founder's own scale, so it opens at the founder's opening bankroll. It is
 * not refilled by the clock — only by paying it back with a profit (the money
 * it made comes back to be reinvested), and it shrinks by 70% of what it
 * loses (§3.4: 70% of friends and family who lose money leave for good).
 */
export function ffNetwork(s: GameState): { cap: number } {
  if (!s.ffNetwork) s.ffNetwork = { cap: Math.max(0, Math.round(s.nwHistory?.[0] ?? 0)) };
  return s.ffNetwork;
}

/** What the network has not already committed to the sponsor's live deals. */
export function ffAvailable(s: GameState): number {
  const cap = s.ffNetwork?.cap ?? Math.max(0, Math.round(s.nwHistory?.[0] ?? 0));
  let committed = 0;
  for (const w of Object.values(s.syndications ?? {})) committed += Math.max(0, w.lpCommit - w.lpDist);
  return Math.max(0, cap - committed);
}

/**
 * The most outside equity this job can take. `cashNeed` is the whole cash the
 * job needs from its owners (equity, change-order margin and any land loan
 * repaid at close); `landEquity` is what the sponsor contributes in kind.
 * Bound by the network, by the $1-per-$1 rule on the sponsor's whole capital
 * (land plus its own cash), and by the cash need itself.
 */
export function maxOutside(s: GameState, cashNeed: number, landEquity: number): number {
  const perOwn = FF_MAX_OUTSIDE_PER_OWN;
  // outside ≤ perOwn × (land + cashNeed − outside)
  const byRule = (perOwn * (Math.max(0, landEquity) + cashNeed)) / (1 + perOwn);
  return Math.max(0, Math.floor(Math.min(ffAvailable(s), byRule, cashNeed)));
}

/** Why this deed cannot be syndicated, or null. */
export function syndicateBar(s: GameState, bbl: string): string | null {
  const h = s.holdings[bbl];
  if (!h) return "You don't own that.";
  if (h.fundOwned) return "It is a fund deed — the fund's LPs are its investors.";
  if (h.jv) return "There is a partner in it already.";
  if (s.syndications?.[bbl]) return "It is syndicated already.";
  if (s.facility?.bbls.includes(bbl)) return "Pledged to your facility — release it there first.";
  return null;
}

/**
 * FORM THE DEAL. Mutates `s`. The sponsor contributes the deed at its equity
 * (`landEquity`, at the mark less any land loan the job repays) as capital;
 * the investors commit `lpCommit` of cash, called pro rata (`lpShare` of
 * every call) alongside the sponsor's own.
 */
export function formSyndication(s: GameState, bbl: string, lpCommit: number, cashNeed: number, landEquity: number): Syndication {
  ffNetwork(s);
  const n = FF_TERMS.hurdles.length;
  const w: Syndication = {
    bbl, investor: FF_INVESTOR, formedM: s.month,
    lpShare: cashNeed > 0 ? Math.min(1, lpCommit / cashNeed) : 0,
    lpCommit: Math.round(lpCommit), lpCalled: 0, lpDist: 0, gpIn: 0, gpDist: 0,
    hurdles: [...FF_TERMS.hurdles], promotes: [...FF_TERMS.promotes],
    lpBal: new Array(n).fill(0), gpBal: 0, lpCap: 0, gpCap: 0,
    pending: 0, tagged: 0, settled: 0, lpFlows: [],
  };
  const land = Math.max(0, Math.round(landEquity));
  if (land > 0) { contribute(w, 0, land); w.gpIn += land; }
  (s.syndications ??= {})[bbl] = w;
  return w;
}

/**
 * THE MONTH'S SETTLEMENT for every live deal. Mutates `s`. `accrue` grows the
 * hurdle balances a month (the month tick); formation settles without it.
 * A deal whose deed has left the book closes after its last settlement.
 */
export function settleSyndications(s: GameState, parcels: ParcelTable, accrue = true, only?: string) {
  const all = s.syndications;
  if (!all) return;
  for (const bbl of Object.keys(all)) {
    if (only && bbl !== only) continue;
    const w = all[bbl];
    if (accrue) accrueMonth(w);
    const held = !!s.holdings[bbl];
    if (!held && w.goneM === undefined) w.goneM = s.month;
    const r = settlePeriod(w, s.month, held);
    if (r.cash > 0) { s.cash += r.cash; logBooks(s, "lpCalled", r.cash); }
    else if (r.cash < 0) { s.cash += r.cash; logBooks(s, "lpDistributed", -r.cash); }
    if (!held) closeSyndication(s, parcels, w);
  }
}

/** One syndicated deed as its sponsor reads it — the property page and the books. */
export interface SyndicateView {
  investor: string;
  formedM: number;
  lpCommit: number;
  lpCalled: number;
  lpDist: number;
  /** Their share of each call while their commitment lasts. */
  lpShare: number;
  /** Their share of the capital in (the pro-rata share below the promote). */
  capShare: number;
  /** What they are still owed before the sponsor earns any promote: capital plus pref. */
  owedAtPref: number;
  /** …and to reach the hurdle where the promote starts. */
  owedAtHurdle: number;
  pref: number;
  hurdle: number;
  promote: number;
  /** The deal's equity at the mark (work in progress at money sunk), and the waterfall's split of it. */
  equity: number;
  yours: number;
  theirs: number;
}

export function syndicateView(s: GameState, parcels: ParcelTable, bbl: string): SyndicateView | null {
  const w = s.syndications?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h) return null;
  const equity = ownedHoldingValue(s, parcels, h) - (h.loan?.balance ?? 0) - (h.mezz?.balance ?? 0) + cipEquity(s, bbl);
  const yours = sponsorPosition(w, equity, s.month, true);
  return {
    investor: w.investor, formedM: w.formedM, lpCommit: w.lpCommit, lpCalled: w.lpCalled, lpDist: w.lpDist,
    lpShare: w.lpShare, capShare: lpCapShare(w),
    owedAtPref: Math.round(w.lpBal[0]), owedAtHurdle: Math.round(w.lpBal[w.lpBal.length - 1]),
    pref: w.hurdles[0], hurdle: w.hurdles[w.hurdles.length - 1], promote: w.promotes[w.promotes.length - 1],
    equity: Math.round(equity), yours: Math.round(yours), theirs: Math.round(equity - yours),
  };
}

function closeSyndication(s: GameState, parcels: ParcelTable, w: Syndication) {
  const lpIn = w.lpCalled, lpOut = w.lpDist;
  (s.synClosed ??= []).push({
    bbl: w.bbl, address: resolveRec(parcels, s, w.bbl)?.address ?? w.bbl, investor: w.investor,
    formedM: w.formedM, closedM: s.month, lpIn, lpOut, lpIrr: seriesIrr(w.lpFlows),
    gpIn: w.gpIn, gpOut: w.gpDist,
  });
  if (s.synClosed.length > 200) s.synClosed.shift();
  const net = ffNetwork(s);
  // The network keeps what it made and loses most of who lost (see ffNetwork).
  if (lpOut >= lpIn) net.cap += lpOut - lpIn;
  else net.cap = Math.max(0, net.cap - Math.round(0.7 * lpIn));
  const multiple = lpIn > 0 ? lpOut / lpIn : 1;
  s.news.unshift({
    q: s.month, kind: lpOut >= lpIn ? "deal" : "warn",
    text: `The syndicate on ${resolveRec(parcels, s, w.bbl)?.address ?? w.bbl} is wound up. `
      + `Your ${w.investor.toLowerCase()} put in $${Math.round(lpIn).toLocaleString()} and took back $${Math.round(lpOut).toLocaleString()} (${multiple.toFixed(2)}x)`
      + (lpOut >= lpIn ? " — and they will tell people." : ". Most of them will not invest with you again."),
  });
  delete s.syndications![w.bbl];
}
