/**
 * THE STREET'S ACQUISITIONS DESKS (2026-10-10).
 *
 * Firms bought what was listed and nothing else. The off-market call — ring
 * the owner of a building that is not for sale and ask — was the player's
 * alone, though it is how a large share of small and mid-market property
 * actually trades (a third to a half, on the brokerage industry's own
 * accounts), and the firms the player competes with are ringing the same
 * owners. So each month a firm's desk may make one call:
 *
 *  - WHO CALLS. How hard a style hunts is its appetite (STYLE.appetite) moved
 *    by the credit window the way its listed buying is (procyclical, contra).
 *    A firm under stress, or one whose decisions Jev makes, does not cold-call.
 *  - WHAT THEY RING ABOUT. A handful of privately held lots sampled from the
 *    map, kept to what the style buys and can afford, and the one the firm
 *    can pay most for against its appraisal (`firmMaxPrice`) gets the call.
 *  - WHAT THE OWNER SAYS. Exactly what the owner says to the player
 *    (`ownerAnswersCall`): refusal, a named number, or "make me an offer",
 *    priced off a private valuation that may be years stale.
 *  - WHAT THE FIRM DOES. It pays a named number up to its own limit. Asked to
 *    make an offer, it opens a little under its limit and, if the owner comes
 *    back with a figure it can meet, meets it. Opportunistic, PE and vulture
 *    money fishes: when the number is far over its limit it counters low
 *    anyway, and an owner who is insulted does not take that firm's call
 *    again for years — the same memory the player is subject to.
 *  - WHO FINDS OUT. A building bought from under a conversation the player
 *    had open is news to the player, and goes on the beaten list, so the
 *    firm rings the player first when it sells (`s.beaten`).
 *
 * The owner's draws come from the "owners" stream and the firm's from
 * "rivals"; the player's own approaches keep the "sales" stream they had.
 */
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState, Rival, RivalStyle } from "./types";
import { rng, rrange } from "./market";
import { assetValue, initialCondition, resolveRec } from "./value";
import { isCivicLand } from "./demand";
import { holderOf } from "./owners";
import { ownerAnswersCall } from "./actions";
import { livingRivals, ownerOf, rivalBuys, firmMaxPrice, styleHunt } from "./rivals";
import { money } from "./money";

/**
 * Calls a month for a firm of appetite 1 in an ordinary credit market. A
 * shape parameter, stated as such. Measured at this setting over two
 * 100-year Frontier towns, no player: 20-21% of what firms buy closes
 * off-market with a private holder, against 2% before (firm-to-firm quiet
 * sales only). Deliberately under the third-to-a-half brokers quote for the
 * whole market, because private holders also sell to each other off-market
 * and nothing models those trades.
 */
const CALLS_MO = 0.6;
/** A building a firm walked away from is not rung again for this long. */
const REDIAL_M = 12;
/** Lots sampled per call. */
const SAMPLE = 8;
/** Styles that counter far under a number rather than walk away. */
const FISHES: Partial<Record<RivalStyle, boolean>> = { opportunistic: true, pe: true, vulture: true };

let keyCache: { p: ParcelTable; keys: string[] } | null = null;
function lotKeys(parcels: ParcelTable): string[] {
  if (keyCache?.p !== parcels) keyCache = { p: parcels, keys: Object.keys(parcels) };
  return keyCache.keys;
}

export function tickOffMarketCalls(s: GameState, parcels: ParcelTable): void {
  const keys = lotKeys(parcels);
  if (!keys.length) return;
  const ci = s.econ.creditIdx ?? 1;
  for (const r of livingRivals(s)) {
    if (r.stressMs || r.jev) continue;
    const st = styleHunt(r.style);
    const cyc = Math.max(0.05, 1 + st.procyclical * (ci - 1) + st.contra * (1 - ci));
    if (rng(s, "rivals") >= Math.min(0.9, CALLS_MO * st.appetite * cyc)) continue;
    let best: { rec: ParcelRecord; max: number; fit: number; held: NonNullable<ReturnType<typeof holderOf>> } | null = null;
    for (let i = 0; i < SAMPLE; i++) {
      const bbl = keys[Math.floor(rng(s, "rivals") * keys.length)];
      if ((r.doors?.[bbl] ?? 0) > s.month) continue;
      if (s.holdings[bbl] || ownerOf(s, bbl) || isCivicLand(s, bbl)) continue;
      if (s.listings.some((l) => l.bbl === bbl)) continue;
      if (s.developments[bbl] || (s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
      if (s.month - (s.lastTradeM?.[bbl] ?? -999) < 24) continue;
      const held = holderOf(s, parcels, bbl);
      if (!held || (r.coldHolders?.[held.id] ?? 0) > s.month) continue;
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || !(rec.lotArea > 0)) continue;
      const max = firmMaxPrice(s, r, rec);
      if (!(max > 0)) continue;
      // A call about a building the firm could never close is not a call.
      if (max > (r.aum ?? 0) * 0.6 + r.cash * 4) continue;
      // Headroom: what the firm can pay against what the building appraises at.
      const fit = max / Math.max(1, assetValue(rec, s.econ, initialCondition(rec)));
      if (!best || fit > best.fit) best = { rec, max, fit, held };
    }
    if (best) callOwner(s, parcels, r, best.rec, best.held, best.max);
  }
}

function callOwner(
  s: GameState, parcels: ParcelTable, r: Rival, rec: ParcelRecord,
  held: NonNullable<ReturnType<typeof holderOf>>, max: number,
): void {
  const bbl = rec.bbl;
  const walk = () => { (r.doors ??= {})[bbl] = s.month + REDIAL_M; };
  const ans = ownerAnswersCall(s, rec, held, "owners");
  if (ans.refused) { walk(); return; }
  let price = 0;
  if (ans.quotes) {
    if (ans.reserve <= max) price = ans.reserve;
  } else {
    // "Make me an offer": open under the limit; an owner whose number is
    // within reach names it, and the firm meets it if it can.
    const bid = Math.round(max * rrange(s, 0.88, 0.96, "rivals") / 1000) * 1000;
    if (bid >= ans.reserve) price = bid;
    else if (bid >= ans.reserve * 0.9 && ans.reserve <= max) price = ans.reserve;
  }
  if (!price) {
    if (FISHES[r.style] && max < ans.reserve * 0.8) {
      // The low counter. An owner told their building is worth three
      // quarters of what they think does not forget who said it.
      (r.coldHolders ??= {})[held.id] = s.month + Math.round(rrange(s, 24, 60, "rivals"));
    }
    walk();
    return;
  }
  const playerTalk = s.approaches?.[bbl];
  const buyer = rivalBuys(s, parcels, rec, price, r, held.name, true);
  if (!buyer) { walk(); return; }
  (s.lastTradeM ??= {})[bbl] = s.month;
  if (playerTalk && !playerTalk.refused && s.month - playerTalk.q <= 6) {
    // Somebody else was on the phone too.
    delete s.approaches[bbl];
    (s.beaten ??= []).push({
      bbl, firmId: r.id, firm: r.name, m: s.month,
      yours: playerTalk.lastBid ?? playerTalk.ask ?? 0, theirs: price,
    });
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `${r.name} bought ${rec.address} from ${held.name} for ${money(price)} while you were still talking to them. `
        + `It never listed. Your conversation is over.`,
    });
  } else if (rng(s, "rivals") < 0.3) {
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `${r.name} bought ${rec.address} off-market from ${held.name} for ${money(price)}. Nobody else saw it.`,
    });
  }
}
