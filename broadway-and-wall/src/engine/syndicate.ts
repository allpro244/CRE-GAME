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
import { playerTerms } from "./reputation";
import { openSources, investorPool, SOURCE_LABEL, type InvestorSource } from "./investors";

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
  for (const w of Object.values(s.syndications ?? {})) {
    // Only the friends-and-family share of a deal ties up the network.
    const ff = w.sources ? (w.sources.ff ?? 0) / Math.max(1, w.lpCommit) : 1;
    committed += ff * Math.max(0, w.lpCommit - w.lpDist);
  }
  return Math.max(0, cap - committed);
}

/** Everything the player could raise today: the network, and every investor pool the band opens. */
export function outsideCapacity(s: GameState): number {
  let t = 0;
  for (const src of openSources(s, playerTerms(s).band, ffAvailable(s))) t += src.left;
  return t;
}

/**
 * Split an outside commitment across the sources that can carry it: the
 * network first (people who know you write first), then each open pool in
 * the band's order. For the engine's instant path; a launched raise records
 * who actually circled (raise.ts).
 */
export function allocateSources(s: GameState, amount: number): Partial<Record<InvestorSource, number>> {
  const out: Partial<Record<InvestorSource, number>> = {};
  let rest = Math.max(0, Math.round(amount));
  for (const src of openSources(s, playerTerms(s).band, ffAvailable(s))) {
    const take = Math.min(rest, Math.floor(src.left));
    if (take > 0) { out[src.id] = take; rest -= take; }
    if (rest <= 0) break;
  }
  return out;
}

/**
 * The most outside equity this job can take. `cashNeed` is the whole cash the
 * job needs from its owners (equity, change-order margin and any land loan
 * repaid at close); `landEquity` is what the sponsor contributes in kind.
 * Bound by the network, by the $1-per-$1 rule on the sponsor's whole capital
 * (land plus its own cash), and by the cash need itself.
 */
export function maxOutside(s: GameState, cashNeed: number, landEquity: number): number {
  // The ratio is the band's (reputation.ts): $1 per $1 for an Unknown
  // sponsor, more as the record and the rank earn it, nothing for a Toxic one.
  const perOwn = playerTerms(s).perOwn;
  if (!(perOwn > 0)) return 0;
  // outside ≤ perOwn × (land + cashNeed − outside)
  const byRule = (perOwn * (Math.max(0, landEquity) + cashNeed)) / (1 + perOwn);
  return Math.max(0, Math.floor(Math.min(outsideCapacity(s), byRule, cashNeed)));
}

/** Why this deed cannot be syndicated, or null. */
export function syndicateBar(s: GameState, bbl: string): string | null {
  const h = s.holdings[bbl];
  if (!h) return "You don't own that.";
  if (h.fundOwned) return "It is a fund deed — the fund's LPs are its investors.";
  if (h.jv) return "There is a partner in it already.";
  if (s.syndications?.[bbl]) return "It is syndicated already.";
  if (s.facility?.bbls.includes(bbl)) return "Pledged to your facility — release it there first.";
  if (!(playerTerms(s).perOwn > 0)) return "Nobody will put money in a deal with you — your record with investors is toxic.";
  return null;
}

/**
 * FORM THE DEAL. Mutates `s`. The sponsor contributes the deed at its equity
 * (`landEquity`, at the mark less any land loan the job repays) as capital;
 * the investors commit `lpCommit` of cash, called pro rata (`lpShare` of
 * every call) alongside the sponsor's own.
 */
export function formSyndication(s: GameState, bbl: string, lpCommit: number, cashNeed: number, landEquity: number, sources?: Partial<Record<InvestorSource, number>>): Syndication {
  ffNetwork(s);
  // Who wrote the cheques, and the pools they came out of this year.
  const src = sources ?? allocateSources(s, lpCommit);
  const pool = investorPool(s);
  for (const [id, v] of Object.entries(src)) if (id !== "ff" && v) pool.used[id] = (pool.used[id] ?? 0) + v;
  const lead = (Object.entries(src) as [InvestorSource, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ff";
  // The terms are the sponsor's band's on the day the deal closes, and they
  // stay with the deal: investors do not reprice a signed agreement.
  const t = playerTerms(s);
  const n = t.hurdles.length;
  const w: Syndication = {
    bbl, investor: SOURCE_LABEL[lead], formedM: s.month, sources: src,
    lpShare: cashNeed > 0 ? Math.min(1, lpCommit / cashNeed) : 0,
    lpCommit: Math.round(lpCommit), lpCalled: 0, lpDist: 0, gpIn: 0, gpDist: 0,
    hurdles: [...t.hurdles], promotes: [...t.promotes],
    devFee: t.devFee, amFee: t.amFee, feesPaid: 0,
    lpBal: new Array(n).fill(0), gpBal: 0, lpCap: 0, gpCap: 0,
    pending: 0, tagged: 0, settled: 0, lpFlows: [],
  };
  const land = Math.max(0, Math.round(landEquity));
  if (land > 0) { contribute(w, 0, land); w.gpIn += land; }
  (s.syndications ??= {})[bbl] = w;
  return w;
}

/**
 * A FEE THE DEAL PAYS ITS SPONSOR (§4.1). No cash moves when it is charged:
 * the deal owes it (a cost booked to the deed, so it nets into the month's
 * settlement and the investors fund their share in the call), and the
 * sponsor earns it (fee income, taxed as the firm's own). What the
 * investors actually pay is their share of it, through the waterfall.
 * Mutates `s`.
 */
export function chargeDealFee(s: GameState, w: Syndication, fee: number): void {
  const f = Math.round(fee);
  if (!(f > 0)) return;
  logBooks(s, "dev", f, w.bbl);
  logBooks(s, "fees", f);
  w.feesPaid = (w.feesPaid ?? 0) + f;
  s.feeIncomeYr = (s.feeIncomeYr ?? 0) + f;
}

/**
 * The development fee on a month's construction spend (dev.ts calls it with
 * the month's build cost). Market: 3–5% of hard and soft cost, paid over
 * construction (§4.1); the rate is the band's, signed into the deal.
 */
export function chargeDevFee(s: GameState, bbl: string, spend: number): void {
  const w = s.syndications?.[bbl];
  if (!w || !(w.devFee && w.devFee > 0) || !(spend > 0)) return;
  chargeDealFee(s, w, w.devFee * spend);
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
    // The asset-management fee: a twelfth of the band's annual rate on the
    // investors' capital still out (called less paid back), while the deal
    // holds its deed (§4.1; market 1–1.5% of equity a year).
    if (accrue && held && w.amFee && w.amFee > 0) chargeDealFee(s, w, (w.amFee / 12) * Math.max(0, w.lpCalled - w.lpDist));
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
    gpIn: w.gpIn, gpOut: w.gpDist, pitchIrr: w.pitchIrr,
  });
  if (s.synClosed.length > 200) s.synClosed.shift();
  const net = ffNetwork(s);
  // The network keeps what it made and loses most of who lost (see ffNetwork)
  // — its own share of the deal, not the institutions'.
  const ffShare = w.sources ? (w.sources.ff ?? 0) / Math.max(1, w.lpCommit) : 1;
  if (lpOut >= lpIn) net.cap += Math.round(ffShare * (lpOut - lpIn));
  else net.cap = Math.max(0, net.cap - Math.round(0.7 * ffShare * lpIn));
  const multiple = lpIn > 0 ? lpOut / lpIn : 1;
  s.news.unshift({
    q: s.month, kind: lpOut >= lpIn ? "deal" : "warn",
    text: `The syndicate on ${resolveRec(parcels, s, w.bbl)?.address ?? w.bbl} is wound up. `
      + `Your ${w.investor.toLowerCase()} put in $${Math.round(lpIn).toLocaleString()} and took back $${Math.round(lpOut).toLocaleString()} (${multiple.toFixed(2)}x)`
      + (lpOut >= lpIn ? " — and they will tell people." : ". Most of them will not invest with you again."),
  });
  delete s.syndications![w.bbl];
}
