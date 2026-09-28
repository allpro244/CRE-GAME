// TAKING A RIVAL PRIVATE — buying a competitor whole.
//
// A 38-year playtest ended with nowhere to put the money: the tape had thinned
// to a few dozen small listings, cash was 67-90% of net worth, and deposit
// interest out-earned the buildings. That is not a balance problem, it is a
// missing trade. A firm at that stage does not wait for one-building listings;
// it buys somebody's book — or the somebody. Entity deals are how most large
// portfolios in this business actually change hands (a fund buys a platform, a
// REIT is taken private, a founder with no successor sells the company).
//
// THE PRICE is the firm's NAV — its deeds marked as they convey, less the debt
// against them, plus the cash in the account — with a control premium on the
// property equity that depends on why the board is selling (see premiumFor).
// Cash trades at par: nobody pays a premium for a dollar.
//
// WHAT TRANSFERS: every deed, each through the ordinary closing
// (`executePurchase`), so the roll, the grade, the deposits, the per-deed
// ledger and any acquisition loan are exactly what an individual purchase of
// that building would convey. The firm's cash comes across at par, and its
// mortgages are PAID OFF at the closing — see `DUE ON SALE` below. The
// allocation of the price to each deed is by value, which is how a purchase
// price allocation on an entity deal is written for basis and transfer tax.
//
// WHAT IT COSTS ON TOP: the closing costs an ordinary purchase pays (2% of the
// real estate — which is also the 1-2% of enterprise value an entity deal pays
// its advisers, lawyers and title company), and transfer tax on the real estate
// at the deed-stamp rate. An entity deal does not dodge the stamps: New York
// and most states tax a controlling-interest transfer as a conveyance of the
// underlying property, and this codebase already charges the buyer of an
// interest the stamps (jv.ts `buyoutCost`).
//
// NOTHING HERE DRAWS ON THE WORLD'S RANDOM STREAM. The board's private floor
// and the unsolicited approach are both hashed off the seed, the firm and the
// month, so a city in which the player never picks up the phone is the same
// city whether this file exists or not.
import type { ParcelTable } from "../data/types";
import type { GameState, Rival, RivalStyle, TakePrivateRecord } from "./types";
import { cloneState } from "./types";
import { resolveRec, holdingNOIYr, heldOccupancy } from "./value";
import { conveyedDeed, depositsOn } from "./leasing";
import { assetGrade, livingRivals, marketAppetite, markRival, STYLE_OF, tie } from "./rivals";
import { buyQuote, executePurchase, TRANSFER_TAX } from "./actions";
import { fundableNow, fundAndBook } from "./credit";
import { rivalPrincipalOf, ageYears } from "./people";
import { isCivicLand } from "./demand";
import { PRODUCTS, allInCostPct, productById } from "./debt";
import { newsChance } from "./market";

const money = (n: number) =>
  Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

/** Deterministic 0..1 — the board's number must not perturb the world's RNG. */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * THE CONTROL PREMIUM A HEALTHY BOARD ASKS, by kind of firm, over the equity in
 * its buildings. JUDGEMENT, CALIBRATED: private real-estate platform sales and
 * REIT take-privates clear in a band from about NAV to roughly a quarter over
 * it — public REIT buyouts have priced near 0-15% over consensus NAV (the
 * headline 20-30% "premium" is over a share price that sat below NAV), and a
 * private platform with a team, a pipeline and a name adds something for the
 * going concern. Where in the band depends on what the owners give up:
 *
 *  - core / REIT: institutional books with a management platform; they sell
 *    only for a full price because their capital is patient.
 *  - foreign: trophy-seeking capital with a low hurdle; it has to be paid to
 *    leave, because its reason for owning was never the yield.
 *  - developer: the pipeline and the entitlement machine are worth something.
 *  - PE / merchant: on a clock to sell anyway — an entity exit is their exit.
 *  - opportunistic / vulture: they know what a buyer of a book pays.
 *  - slumlord: nobody pays for that franchise.
 *  - family: holds for a generation and sells only at succession (see below).
 *  - owner-user: a company's own premises, not a real estate firm at all.
 */
const BASE_PREMIUM: Record<RivalStyle, number | null> = {
  core: 1.12, reit: 1.12, foreign: 1.15, developer: 1.10,
  pe: 1.06, merchant: 1.05, opportunistic: 1.08, vulture: 1.08,
  slumlord: 1.02, family: 1.20, owneruser: null,
};

/** A founder this age with nobody behind them is running a succession, not a firm. */
const SUCCESSION_AGE = 70;

export type TakePrivateSituation = "distressed" | "strained" | "succession" | "healthy";

export interface TakePrivateDeed {
  bbl: string;
  address: string;
  cls: string;
  sf: number;
  land: boolean;
  /** As the deed conveys it — `conveyedValue`, the same number the tape's asks use. */
  value: number;
  noi: number;
  occ: number;
  deposits: number;
}

export interface TakePrivateQuote {
  firmId: string;
  name: string;
  style: RivalStyle;
  available: boolean;
  /** Why the board will not take the call, or why it cannot be done. */
  why?: string;
  situation: TakePrivateSituation;
  situationWhy: string;
  deeds: TakePrivateDeed[];
  gross: number;
  /** What the street table marks their book at — their own portfolio occupancy, not the deeds' rolls. */
  bookMark: number;
  debt: number;
  cash: number;
  propertyEquity: number;
  nav: number;
  premium: number;
  premiumWhy: string[];
  /** What the board asks for the equity. */
  ask: number;
  noi: number;
  deposits: number;
}

function situationOf(s: GameState, r: Rival, ltv: number): { sit: TakePrivateSituation; why: string } {
  if ((r.stressMs ?? 0) > 0) {
    return { sit: "distressed", why: `${r.name} is ${r.stressMs} month${r.stressMs === 1 ? "" : "s"} behind on debt service. The board would rather sell the company than hand the lenders the keys one building at a time.` };
  }
  const st = STYLE_OF(r.style);
  if (ltv > st.maxLtv * 0.92) {
    return { sit: "strained", why: `${r.name} is at ${(ltv * 100).toFixed(0)}% leverage against a ${(st.maxLtv * 100).toFixed(0)}% ceiling — one bad year from being a forced seller, and the board knows it.` };
  }
  if (r.occ !== undefined && r.mktOcc !== undefined && r.occ < r.mktOcc - 0.08) {
    return { sit: "strained", why: `${r.name}'s book is ${(r.occ * 100).toFixed(0)}% let against a market running ${(r.mktOcc * 100).toFixed(0)}%. They are losing the leasing war.` };
  }
  const p = rivalPrincipalOf(s, r.id);
  if (p && ageYears(p, s.month) >= SUCCESSION_AGE) {
    return { sit: "succession", why: `${p.name} is ${ageYears(p, s.month)} and there is nobody behind them. An orderly sale of the company is the alternative to an estate selling it.` };
  }
  return { sit: "healthy", why: `${r.name} is performing and does not need to sell. A board that does not need to sell is paid to.` };
}

/**
 * THE PREMIUM OVER PROPERTY EQUITY, AND WHY.
 *
 * Situation first, because it is what decides the board's alternative:
 *  - DISTRESSED (in arrears): 0.90. `rivalAsk` quotes a stressed firm's single
 *    buildings at 0.80-0.95 of their conveyed value; selling the company whole
 *    avoids the fire sale on each deed, so the book clears near the top of that
 *    band — still under NAV, because the alternative is the lenders.
 *  - STRAINED (near its covenant, or losing the leasing war): 1.00. It can wait
 *    a little, not long.
 *  - SUCCESSION: at most 1.03. The alternative is an orderly liquidation.
 *  - HEALTHY: the style's base (above), plus up to 4 points for a book leasing
 *    ahead of its market (a platform that outperforms is worth paying for), plus
 *    up to ±5 points for the room: with more competing money about, the board
 *    has other buyers to call — the same appetite the tape reads.
 * Then the relationship, on the same arithmetic `rivalAsk` uses: a firm you
 * have closed with is friendlier, one you have insulted remembers.
 * Clamped to [0.85, 1.30] — a guard at the edges of the calibrated band, not a
 * rail the ordinary case rests on.
 */
function premiumFor(s: GameState, r: Rival, sit: TakePrivateSituation): { premium: number; why: string[] } {
  const why: string[] = [];
  const base = BASE_PREMIUM[r.style] ?? 1;
  let p: number;
  if (sit === "distressed") { p = 0.90; why.push("in arrears: sells under NAV rather than to its lenders"); }
  else if (sit === "strained") { p = 1.00; why.push("near its limits: sells at NAV"); }
  else if (sit === "succession") { p = Math.min(base, 1.03); why.push("succession: priced against an orderly wind-down"); }
  else {
    p = base;
    why.push(`control premium for a ${r.style === "reit" ? "REIT" : r.style === "pe" ? "PE shop" : `${r.style} firm`}: ${((base - 1) * 100).toFixed(0)}%`);
    if (r.occ !== undefined && r.mktOcc !== undefined) {
      const op = Math.max(-1, Math.min(1, (r.occ - r.mktOcc) / 0.05)) * 0.04;
      if (Math.abs(op) >= 0.005) { p += op; why.push(`${op > 0 ? "leasing ahead of" : "leasing behind"} its market: ${op > 0 ? "+" : ""}${(op * 100).toFixed(0)} pts`); }
    }
    const room = Math.max(-0.05, Math.min(0.05, (marketAppetite(s) - 1) * 0.10));
    if (Math.abs(room) >= 0.005) { p += room; why.push(`${room > 0 ? "other buyers in the room" : "few other buyers about"}: ${room > 0 ? "+" : ""}${(room * 100).toFixed(0)} pts`); }
  }
  const t = s.street?.[r.id];
  if (t) {
    const known = Math.min(0.03, 0.01 * t.deals) - Math.min(0.06, 0.03 * t.insults);
    if (Math.abs(known) >= 0.005) {
      p -= known;
      why.push(known > 0 ? `you have traded with them: −${(known * 100).toFixed(0)} pts` : `they remember your last number: +${(-known * 100).toFixed(0)} pts`);
    }
  }
  return { premium: Math.max(0.85, Math.min(1.30, p)), why };
}

/** Deeds the entity deal would have to move, and anything that stops one moving. */
function blockers(s: GameState, parcels: ParcelTable, r: Rival): string | null {
  if ((s.cityJobs ?? []).some((j) => j.firmId === r.id && !j.orphaned)) {
    return `${r.name} has a building under construction. A construction lender does not consent to a change of control mid-job — wait for it to top out.`;
  }
  for (const bbl of r.bbls) {
    const addr = resolveRec(parcels, s, bbl)?.address ?? bbl;
    if (s.holdings[bbl]) return `The record shows you already own ${addr}. The title company will not close this until that is straightened out.`;
    if (s.cityGroundLeases?.[bbl] || isCivicLand(s, bbl)) return `${addr} is not freehold — it cannot convey with the company.`;
    if ((s.notes ?? []).some((n) => n.bbl === bbl)) return `You hold the paper on ${addr}. Settle the note before buying the borrower.`;
    if (s.talks?.[bbl]) return `You are already negotiating for ${addr}. Finish or walk from that deal first.`;
  }
  return null;
}

/**
 * WHAT THE FIRM IS WORTH AND WHAT ITS BOARD WANTS FOR IT. Pure: reads the
 * state, draws nothing, writes nothing.
 */
export function takePrivateQuote(s: GameState, parcels: ParcelTable, firmId: string): TakePrivateQuote | null {
  const r = (s.rivals ?? []).find((x) => x.id === firmId);
  if (!r) return null;
  const deeds: TakePrivateDeed[] = [];
  let gross = 0, noi = 0, deposits = 0;
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const land = rec.class === "land" || !rec.bldgArea;
    // AS THE DEED CONVEYS IT: the grade this firm has run the plant to, and the
    // roll the closing will hand over — the same vessel `executePurchase` will
    // write (genRentRoll is deterministic per parcel). Pricing the company on
    // the street table's mark instead would pay for the firm's portfolio
    // occupancy and receive each building's own roll: two answers to one
    // quantity, and a pump whichever way they differed.
    const { value, vessel } = conveyedDeed(s, rec, bbl, false, assetGrade(r, rec));
    const dn = land ? 0 : Math.round(holdingNOIYr(rec, s.econ, vessel, s.month));
    const dep = depositsOn(vessel);
    deeds.push({
      bbl, address: rec.address ?? bbl, cls: land ? "land" : rec.class, sf: land ? 0 : rec.bldgArea, land,
      value: Math.round(value), noi: dn, occ: land ? 0 : heldOccupancy(rec, s.econ, vessel), deposits: dep,
    });
    gross += Math.round(value); noi += dn; deposits += dep;
  }
  deeds.sort((a, b) => b.value - a.value);
  const m = markRival(s, parcels, r);
  const debt = Math.max(0, Math.round(r.debt));
  const cash = Math.round(r.cash);
  const propertyEquity = gross - debt;
  const { sit, why: situationWhy } = situationOf(s, r, m.ltv);
  const { premium, why: premiumWhy } = premiumFor(s, r, sit);
  const ask = Math.round((Math.max(0, propertyEquity) * premium + cash) / 1000) * 1000;
  const q: TakePrivateQuote = {
    firmId: r.id, name: r.name, style: r.style, available: true,
    situation: sit, situationWhy, deeds, gross, bookMark: Math.round(m.aum), debt, cash,
    propertyEquity, nav: propertyEquity + cash, premium, premiumWhy, ask, noi, deposits,
  };
  const no = (why: string) => { q.available = false; q.why = why; return q; };
  if (r.failedM !== undefined) return no(r.takenPrivateM !== undefined ? "You already own this firm." : `${r.name} is gone. What is left is the receiver's.`);
  if (!deeds.length) return no(`${r.name} owns nothing. There is no book to buy.`);
  if (BASE_PREMIUM[r.style] === null) return no(`${r.name} is a company that owns its own premises, not a real estate firm. There is no book for sale — only a business you do not want.`);
  if (r.style === "family" && sit !== "succession" && sit !== "distressed") {
    return no(`${r.name} has held for two generations and is not for sale. Families sell at succession or in trouble, and they are in neither.`);
  }
  if (propertyEquity <= 0) {
    return no(`${r.name}'s buildings no longer cover their paper. The equity is worth nothing and the board cannot sell what the lenders own — that conversation is with the receiver.`);
  }
  const coolUntil = s.takePrivate?.cool?.[r.id];
  if (coolUntil !== undefined && s.month < coolUntil) {
    return no(`${r.name}'s board turned you down. They will not take the call again before month ${coolUntil}.`);
  }
  const block = blockers(s, parcels, r);
  if (block) return no(block);
  return q;
}

/** One deed's share of the closing, at a struck price. */
export interface TakePrivateLeg {
  bbl: string;
  address: string;
  /** Allocated real-estate price — basis, and what the closing is run at. */
  price: number;
  transferTax: number;
  product: string;
  principal: number;
  /** The cheque at this deed's closing table (price + 2% − loan + fees). */
  equity: number;
}

export interface TakePrivateTerms {
  price: number;
  /** Premium the struck price implies over property equity. */
  premium: number;
  realEstatePrice: number;
  closingCosts: number;
  transferTax: number;
  loans: number;
  deposits: number;
  /** Cash and line the closing draws, before deposits come across. */
  need: number;
  purse: number;
  short: number;
  legs: TakePrivateLeg[];
}

/** The same working copy the closing runs on — the firm's own marketing withdrawn. */
function prepared<T extends GameState>(s: T, bbls: Set<string>): T {
  return {
    ...s,
    listings: s.listings.filter((l) => !bbls.has(l.bbl)),
    approaches: Object.fromEntries(Object.entries(s.approaches ?? {}).filter(([b]) => !bbls.has(b))),
  };
}

/**
 * THE DESK THAT WOULD LEND ON EACH DEED. Acquisition financing on an entity
 * deal is written deed by deed against the same appraisal a single purchase
 * gets (a take-private is funded with property-level mortgages, not a loan
 * against the shares). The cheapest all-in term desk that will size a loan;
 * land goes to the land desk; the bridge and the mezzanine are not a default
 * anybody would choose for a book of stabilised buildings.
 */
function bestProduct(s: GameState, parcels: ParcelTable, bbl: string, price: number, land: boolean): { id: string; principal: number; equity: number } {
  const cash = buyQuote(s, parcels, bbl, price, "cash", 1);
  let best = { id: "cash", principal: 0, equity: cash.equity, allIn: Infinity };
  for (const p of PRODUCTS) {
    if (p.mezz || p.bridge) continue;
    if (land ? p.id !== "land" : p.id === "land") continue;
    const q = buyQuote(s, parcels, bbl, price, p.id, 1);
    if (!(q.principal > 0)) continue;
    const allIn = allInCostPct(productById(p.id), q.ratePct);
    if (allIn < best.allIn) best = { id: p.id, principal: q.principal, equity: q.equity, allIn };
  }
  return best;
}

/**
 * WHAT A GIVEN PRICE COSTS YOU, deed by deed. `price` is for the equity; the
 * real estate is then `price − cash + debt` (the cash comes across, the paper
 * is paid off), allocated across the deeds by value.
 */
export function takePrivateTerms(
  s: GameState, parcels: ParcelTable, q: TakePrivateQuote, price: number, financing: "cash" | "debt",
): TakePrivateTerms {
  const px = Math.max(0, Math.round(price));
  const realEstatePrice = Math.max(0, px - q.cash + q.debt);
  const set = new Set(q.deeds.map((d) => d.bbl));
  const w = prepared(s, set);
  const legs: TakePrivateLeg[] = [];
  let loans = 0, need = 0, tt = 0, closing = 0, allocated = 0;
  q.deeds.forEach((d, i) => {
    // Last deed takes the rounding so the legs sum to the price exactly.
    const share = i === q.deeds.length - 1
      ? realEstatePrice - allocated
      : Math.round(realEstatePrice * (d.value / Math.max(1, q.gross)));
    allocated += share;
    const legTt = Math.round(d.value * TRANSFER_TAX);
    const pick = financing === "cash"
      ? { id: "cash", principal: 0, equity: buyQuote(w, parcels, d.bbl, share, "cash", 1).equity }
      : bestProduct(w, parcels, d.bbl, share, d.land);
    legs.push({ bbl: d.bbl, address: d.address, price: share, transferTax: legTt, product: pick.id, principal: pick.principal, equity: pick.equity });
    loans += pick.principal; need += pick.equity + legTt; tt += legTt;
    closing += Math.round(share * 0.02);
  });
  const purse = fundableNow(s, parcels);
  return {
    price: px,
    premium: q.propertyEquity > 0 ? (px - q.cash) / q.propertyEquity : 0,
    realEstatePrice, closingCosts: closing, transferTax: tt, loans, deposits: q.deposits,
    need, purse, short: Math.max(0, need - purse), legs,
  };
}

/**
 * THE BOARD'S FLOOR — private, like every seller's. Two to six points under
 * the premium it asked, hashed off the seed, the firm and the year so asking
 * twice in a month gets the same answer and the world's RNG is untouched.
 */
function boardFloor(s: GameState, q: TakePrivateQuote): number {
  const slack = 0.02 + 0.04 * hash01(`${s.seed}:${q.firmId}:${Math.floor(s.month / 12)}:tp`);
  const prem = Math.max(0.80, q.premium - slack);
  return Math.round(Math.max(0, q.propertyEquity) * prem + q.cash);
}

/**
 * MAKE THE OFFER. At or over the ask the board takes the ask. Under it, the
 * board takes your number if it clears its private floor; otherwise it says no
 * and will not take the call for a year — two if the number was an insult.
 * The money is checked BEFORE the board is asked, as `buyListing` does: an
 * offer you could not fund is not an offer.
 */
export function offerTakePrivate(
  s: GameState, parcels: ParcelTable, firmId: string, price: number, financing: "cash" | "debt",
): { s: GameState; err?: string; msg?: string; refused?: boolean } {
  const q = takePrivateQuote(s, parcels, firmId);
  if (!q) return { s, err: "No such firm." };
  if (!q.available) return { s, err: q.why };
  const offered = Math.round(price);
  if (!(offered > 0)) return { s, err: "Name a price." };
  const struck = Math.min(offered, q.ask);
  const t = takePrivateTerms(s, parcels, q, struck, financing);
  if (t.short > 0) {
    return { s, err: `The closing needs ${money(t.need)} of cash and line and you can raise ${money(t.purse)} — ${money(t.short)} short.` };
  }
  const floor = boardFloor(s, q);
  if (struck < floor) {
    const next = cloneState(s);
    next.takePrivate ??= {};
    const insult = struck < floor * 0.9;
    (next.takePrivate.cool ??= {})[firmId] = next.month + (insult ? 24 : 12);
    if (insult) tie(next, firmId).insults++;
    if (next.takePrivate.offer?.firmId === firmId) delete next.takePrivate.offer;
    next.news.unshift({
      q: next.month, kind: "info",
      text: insult
        ? `${q.name}'s board has thrown out your ${money(struck)} for the company. They asked ${money(q.ask)}, and they will remember the number.`
        : `${q.name}'s board has turned down ${money(struck)} for the company. The ask was ${money(q.ask)}; they will not take the call again for a year.`,
    });
    return { s: next, refused: true, msg: insult ? "Thrown out — and they will remember it." : "Refused. The board will not talk again for a year." };
  }
  return closeTakePrivate(s, parcels, q, t);
}

function closeTakePrivate(
  s: GameState, parcels: ParcelTable, q: TakePrivateQuote, t: TakePrivateTerms,
): { s: GameState; err?: string; msg?: string } {
  const set = new Set(q.deeds.map((d) => d.bbl));
  // THE FIRM'S OWN MARKETING IS WITHDRAWN at signing: a building of theirs on
  // the tape, a package with a receiver's name on it, a file on your desk —
  // the company is selling everything to you, so none of those sales happen.
  // Withdrawn on the working copy, so the deeds convey on the paper the quote
  // read (see `prepared`).
  let cur = prepared(cloneState(s), set);
  cur.portfolios = (cur.portfolios ?? []).filter((p) => p.player || !p.bbls.some((b) => set.has(b)));
  for (const leg of t.legs) {
    const r = executePurchase(cur, parcels, leg.bbl, leg.price, leg.product, true, 1, { entity: true });
    if (r.err) return { s, err: `${leg.address} could not convey (${r.err}). Nothing has closed.` };
    cur = r.s;
    if (leg.transferTax > 0) {
      const paid = fundAndBook(cur, parcels, leg.transferTax, "bought", { bbl: leg.bbl });
      if (paid < leg.transferTax) return { s, err: `The transfer tax on ${leg.address} could not be funded. Nothing has closed.` };
      const h = cur.holdings[leg.bbl];
      if (h) h.costBasis += leg.transferTax;   // stamps are capitalised, like the rest of the closing
    }
  }
  // THE FIRM IS RETIRED FROM THE STREET. Its deeds are yours, its mortgages
  // were paid off out of the price (DUE ON SALE — see the file header and
  // `takePrivateTerms`: the real estate price is the equity price plus the
  // paper), and its cash came across netted in the same arithmetic. What is
  // left on its own sheet is zero by construction; the per-deed settlement in
  // `executePurchase` paid the firm as if it were selling buildings, and that
  // money is the money you just paid, so the shell is cleared rather than left
  // holding it.
  //
  // DUE ON SALE. Commercial mortgages carry a due-on-sale clause, and the
  // standard loan documents define a change of control of the borrower as a
  // transfer. Assumption needs the lender's consent, a fee (typically 1%) and
  // a fresh underwrite. The street carries one aggregate debt number per firm
  // with no per-loan terms to assume, so the honest default is the one most
  // entity deals take: the paper is repaid at par at the closing and the
  // buyer's own lenders write new loans on each deed. No prepayment premium is
  // charged because the street's debt is priced at the index plus a spread
  // (floating), which prepays at par.
  const r = (cur.rivals ?? []).find((x) => x.id === q.firmId)!;
  r.bbls = [];
  r.debt = 0;
  r.cash = 0;
  r.uncalled = 0;
  r.aum = 0;
  r.stressMs = 0;
  r.heldSince = {};
  delete r.extendedTo;
  delete r.deliveredM;
  r.failedM = cur.month;
  r.takenPrivateM = cur.month;
  // A firm that was bought is not a firm that failed: no courthouse-steps
  // epilogue years later. -1 never matches a month, and setting it means the
  // epilogue's scheduling draw is never taken either.
  r.epilogueM = -1;
  const rec: TakePrivateRecord = {
    m: cur.month, firmId: q.firmId, name: q.name, style: q.style, deeds: q.deeds.length,
    gross: q.gross, debtRetired: q.debt, cashAcquired: q.cash, nav: q.nav, premium: t.premium,
    equityPrice: t.price, realEstatePrice: t.realEstatePrice, closingCosts: t.closingCosts,
    transferTax: t.transferTax, newLoans: t.loans, situation: q.situation,
  };
  cur.takePrivate ??= {};
  (cur.takePrivate.done ??= []).push(rec);
  if (cur.takePrivate.offer?.firmId === q.firmId) delete cur.takePrivate.offer;
  const vsNav = q.propertyEquity > 0 ? (t.premium - 1) * 100 : 0;
  cur.news.unshift({
    q: cur.month, kind: "deal",
    text: `${q.name} is yours. ${q.deeds.length} building${q.deeds.length === 1 ? "" : "s"} marked at ${money(q.gross)} came across in one closing: `
      + `${money(t.price)} to the owners — ${Math.abs(vsNav).toFixed(0)}% ${vsNav >= 0 ? "over" : "under"} the equity in the buildings, cash at par — `
      + `${money(q.debt)} of their paper repaid at the table${t.loans > 0 ? `, ${money(t.loans)} of new mortgages written deed by deed` : ""}, `
      + `and ${money(t.closingCosts + t.transferTax)} to the advisers, the title company and the stamps. The name comes off the street.`,
  });
  return { s: cur, msg: `${q.name} taken private — ${q.deeds.length} buildings, ${money(t.price)} for the equity.` };
}

/**
 * THE BOARD RINGS YOU. A firm that is struggling or running a succession
 * retains a banker, and the banker calls the buyers who could close. Once a
 * year at most is checked (July), no more than one conversation every three
 * years, and only the firms whose situation is a reason to sell. The call
 * comes to you only when the equity cheque on ordinary acquisition leverage
 * (about 60% loans, the typical term desk) plus costs is inside what you could
 * raise today — a banker does not waste a board's time on a buyer who cannot
 * close. Gated by a hash, not the RNG, so an unplayed city is untouched.
 */
export function tickTakePrivateApproach(s: GameState, parcels: ParcelTable) {
  const tp = s.takePrivate;
  if (tp?.offer && s.month > tp.offer.expiresM) delete tp.offer;
  if (s.gameOver || s.month % 12 !== 6) return;
  if (tp?.offer) return;
  if (tp?.lastApproachM !== undefined && s.month - tp.lastApproachM < 36) return;
  if (!newsChance(s, "take-private-approach", 0.5)) return;
  const purse = fundableNow(s, parcels);
  if (purse <= 0) return;
  let best: { r: Rival; q: TakePrivateQuote } | null = null;
  for (const r of livingRivals(s)) {
    if (r.bbls.length < 2 || BASE_PREMIUM[r.style] === null) continue;
    if ((s.cityJobs ?? []).some((j) => j.firmId === r.id && !j.orphaned)) continue;
    const cool = tp?.cool?.[r.id];
    if (cool !== undefined && s.month < cool) continue;
    // Cheap screen on the street's own mark before the full quote reads the rolls.
    const aum = r.aum ?? 0;
    const eq = aum - r.debt;
    if (eq <= 0) continue;
    const est = (eq + r.debt) * 0.40 + aum * 0.026;
    if (est > purse) continue;
    const q = takePrivateQuote(s, parcels, r.id);
    if (!q?.available || q.situation === "healthy") continue;
    const needEst = (q.ask - q.cash + q.debt) * 0.42 + q.gross * TRANSFER_TAX;
    if (needEst > purse) continue;
    if (!best || q.gross > best.q.gross) best = { r, q };
  }
  if (!best) return;
  const { r, q } = best;
  s.takePrivate ??= {};
  s.takePrivate.lastApproachM = s.month;
  s.takePrivate.offer = { firmId: r.id, name: r.name, m: s.month, expiresM: s.month + 4, ask: q.ask, why: q.situationWhy };
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `${r.name}'s board has retained a banker, and the banker has called you. ${q.situationWhy} `
      + `They will talk about ${money(q.ask)} for the company — ${q.deeds.length} buildings marked at ${money(q.gross)}, ${money(q.debt)} of debt, ${money(q.cash)} in the account. The Street desk has the book.`,
  });
}
