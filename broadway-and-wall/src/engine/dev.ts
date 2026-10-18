// Ground-up development (Groundwork's core loop, simplified for v1) plus
// building management: capital programs and rent stance.
//
// Development: on an owned vacant lot, choose use and FAR up to the zoning
// max, pay hard+soft cost per sf, fund with a 60% interest-only construction
// loan, wait 4-6 quarters while the building rises on the map, then lease up
// from empty. A modest random cost/schedule overrun keeps it honest.
import type { ParcelTable } from "@/data/types";
import type { BtsCommitment, Builder, BuildingDesign, BuiltClass, Contract, DevUse, Development, Econ, GameState, MerchantBook, Rival, RivalStyle, UseMix } from "./types";
import { hash01 } from "./competitorTraits";
import { BUILT_CLASSES, cloneState, raiseAlert } from "./types";
import { logBooks, moveDeposit, moveFundCash, monthLabel, serviceSpec, planSpec, START_YEAR } from "./types";
import { demandNow, demandModel, nudgeBlockDemand, isCivicLand } from "./demand";
import { rng, rrange, NATURAL_VAC, forwardVacancy, rentDriftAt, CITY_STOCK, SECTOR_LABEL, devPencils, addStock, REF_PIPE_SHARE, frictionFloor, housableStock, payrollGrowth12 } from "./market";
import { firmShort } from "./firm";
import { resolveRec, marketRentPsfYr, opexPsf, taxRate, landValue, landRead, assetValue, ownedHoldingValue, RECOVERY_RATE, demandLinear, condGrade, condCeiling, openingCondIdx,
  developmentHurdle, DEV_MARGIN, HARD_COST_PSF, SOFT_COST, CONTINGENCY, RETAIL_FLOORS_MAX, INDUSTRIAL_FLOORS_MAX, heightPremium, constructionTypeMult, MGMT_FEE,
  rentableSf, rentableFromSpec, useRentableSf, zonePermits, zoneUseBar, heightCapFloors, corniceDatum, townMaturity, schemeFloorLadder, incomeValueAsIs, ownerAskPsf, hashNormal, demandIdx, buildTier } from "./value";
export { zoneUseBar };
export { blockDatumFloors, heightCapFloors, townMaturity, type DatumMemo } from "./value";
// The massing curve moved to value.ts, because land pricing needs to ask what
// a lot can physically carry and value.ts cannot import this file. Re-exported
// so it is still `physicalMaxFloors` from "@/engine/dev" everywhere else.
export { physicalMaxFloors, plateEfficiency } from "./value";
import { depositFor, depositsOn, genAnchorTenant, leasableUses, minLettableSf, pickName, pickSector, useVacantSf } from "./leasing";
import { claimJob, jobDelivered, ownerOf, gradeOf, streetHurdle, streetHasOwnMoney, anonHurdle, hurdleAt, freeCash } from "./rivals";
import { spendable, fundableNow, fundAndBook } from "./credit";
import { mixOf, districtLabel } from "./mix";
import { lenderAppetite, lenderByName, CONSTRUCTION_LENDER, reoAsk, chargeLenderLoss } from "./lenders";
import { relCurve, bumpLenderRel, payOffDue, productById } from "./debt";
import {
  cancelSupplyProject,
  programmeSf,
  queueSupplyProject,
  rescheduleSupplyProject,
  syncSupplyViews,
} from "./supply";
import { recordPropertyEvent } from "./history";

const clone = (s: GameState): GameState => cloneState(s);

// hard cost $/sf by use, before the height premium and soft costs.
// Sized so stabilized yield-on-cost lands ~150-250bps over the exit cap —
// a real development margin, not free money.
/**
 * Hard cost per square foot, before the height premium and the contract.
 *
 * These must be read against RENT_BASE, because the ratio between them decides
 * whether a class is buildable at all — and it was wildly out. Retail cost 3.4
 * times its annual rent to build and penciled on literally every site in the
 * city; industrial cost 10.3 times its rent and penciled on none. Real
 * construction runs roughly seven times stabilised rent across the board, and
 * the differences between classes should come from cap rates and location, not
 * from one class being free to build.
 */
/**
 * Calibrated against NET stabilised rent, not gross.
 *
 * The old table was set at roughly seven times each class's headline rent,
 * which sounds disciplined and is not: the classes do not carry remotely the
 * same expense load, and they do not recover it the same way. Triple-net
 * retail keeps almost every dollar it bills; an apartment building keeps
 * fifty-five cents on the dollar after payroll, turns and utilities. Pricing
 * both at seven times the number on the sign made retail free money to build
 * — a sixteen per cent yield on cost against a six per cent exit — while
 * apartments barely cleared.
 *
 * These are solved instead: the cost at which a NEW building on a MEDIAN site
 * yields about 150bp over its own exit cap, after operating cost, after what
 * a typical lease bills back, and after the property tax the owner carries.
 * A better corner still beats the hurdle comfortably; a poor one does not
 * pencil, which is why most land in a real city stays empty.
 */
// THE NUMBERS MOVED DOWN A LAYER. Land is now priced as a residual — what a
// building on this envelope is worth, less what it costs to build — and a
// residual cannot be computed without the cost of construction. value.ts sits
// below this module and cannot import it, so the constants live there and are
// re-exported here, where every existing caller still finds them.
export { HARD_COST_PSF, SOFT_COST, CONTINGENCY } from "./value";

// THE PRO FORMA MOVED DOWN A LAYER TOO, for the same reason: the land residual
// has to solve the desk's own pro forma for the price of the dirt, and it can
// only do that if there is one. See proforma.ts. Re-exported so every caller
// still finds these here.
export {
  MIXED_STACK, normalizeMix, devMix, dominantOf, CONTRACT_PREMIUM, reserveFor, specCostMult,
  farMaxFor, maxRetailShare, withStreetRetail, capRetail, maxFloorsFor,
  MAX_COVERAGE, maxCoverageFor,
} from "./proforma";
export type { ConstructionQuote } from "./proforma";
import {
  devMix, dominantOf, overMix, leaseUpMarketAt, specShare, constructionDesks, deskQuote, clamp01, farMaxFor, maxFloorsFor,
  withStreetRetail, capRetail, reserveFor,
  developmentProForma, landCarryFactor, MAX_COVERAGE, maxCoverageFor,
} from "./proforma";
import type { ConstructionQuote } from "./proforma";
import { money } from "./money";
import { consentFor, purseOf } from "./vehicles";
import { formSyndication, maxOutside, settleSyndications, syndicateBar, chargeDevFee } from "./syndicate";
import { heldByRaises, PITCH_MULT } from "./investors";
import { lpNetIrr } from "./waterfall";

/**
 * THE PLATE THE CITY DRAWS — the site coverage an autonomous start (the
 * anonymous city, a named rival, a teardown) and the order book's pencil
 * sampler put a new building of this programme on. It is the use's own
 * coverage limit (`MAX_COVERAGE`, proforma.ts), which is exactly the plate the
 * land residual prices the dirt at (`residualFloorChoices`, value.ts).
 *
 * It was a flat 0.62 for every use, while the residual struck land at 0.70 for
 * flats, 0.80 for offices and 0.85 for shops and sheds. So every autonomous
 * scheme paid for dirt priced on a building a fifth to a third bigger than the
 * one it drew, and the pencil that gates the order book could not find a
 * clearing site even on lots where that use IS the highest and best use and
 * its own residual scheme plans at 1.00 by construction. Measured (seeds 9001,
 * 9005, 9006, years 18-21, every vacant lot): at 0.62, 0 of 54 / 0 of 22
 * office-HBU lots cleared, 0 of 116 industrial, 0 of 5 retail, 1-4 of 94
 * flats; at the use's plate, 7/54 and 11/22 office, 54/116 industrial, 5/5
 * retail, 7-24 flats. `sitePencil` read zero for office, retail and industrial
 * in every annual sample on all six orderbook seeds, so `startOwed` never
 * formed for them and those markets sat welded to their frictional vacancy
 * for decades with a structural shortage and rising rents. One quantity —
 * what gets built on this lot — now has one answer. The player's desk is
 * untouched: it chooses its own footprint up to the same limit.
 */
export function cityCoverage(use: DevUse): number {
  return maxCoverageFor(use);
}


/**
 * WHICH DESK WROTE THE PAPER, for a job the player did not underwrite.
 *
 * Rival and city jobs never named a lender, which was fine while nothing ever
 * asked — and stopped being fine the moment a bank failure had to know whose
 * borrowers had just lost their funding. A developer on this street borrows
 * from one of the same three desks the player does, and they go where the
 * money is: a desk with no appetite is not writing the loan.
 *
 * THE DRAW IS PRIVATE, keyed off the site. The shared PRNG drives every other
 * outcome in the world, so one extra call to it from every groundbreaking
 * would have re-rolled fifty years of history for a change that is supposed to
 * be additive. Same technique, and the same reason, as genRentRoll.
 */
export function openConstructionDesks(s: GameState): { name: string; cap: number; appetite: number }[] {
  return constructionDesks()
    .map((d) => ({ name: d.name, cap: d.cap, appetite: lenderAppetite(s, d.name) }))
    .filter((d) => d.appetite >= 0.12);
}

export function pickConstructionDesk(s: GameState, key: string): string | undefined {
  const open = openConstructionDesks(s);
  if (!open.length) return undefined;
  const total = open.reduce((a, d) => a + d.appetite, 0);
  let h = 2166136261 ^ (s.seed >>> 0);
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  let u = (((h >>> 0) % 1_000_003) / 1_000_003) * total;
  for (const d of open) { u -= d.appetite; if (u <= 0) return d.name; }
  return open[open.length - 1].name;
}

/**
 * THE ANONYMOUS MERCHANT BUILDS ON BORROWED MONEY TOO (2026-10-13).
 *
 * Five-sixths of the space this city builds is started by builders with no
 * name — local merchants and one-building developers — and their schemes used
 * to cost nobody anything if they opened into a glut: the building simply
 * joined the stock. So overbuilding was never punished, which is the opposite
 * of every real cycle: in 1990-92 and 2009-11 the schemes that opened into
 * empty markets were handed back and their construction lenders took the hole
 * (FDIC: construction and land loans were the costliest category in both).
 *
 * Each anonymous job now carries its book: the all-in basis, the construction
 * loan at the shop's own loan-to-cost, and the desk that wrote it (the same
 * appetite-weighted pick a named firm makes). Settled at delivery.
 */
const blendRent = (e: Econ, mix: UseMix) => overMix(mix, (u) => e.effRentIdx?.[u] ?? e.rentIdx[u]);
const blendCap = (e: Econ, mix: UseMix) => overMix(mix, (u) => e.capRate?.[u] ?? 7);
function merchantBook(s: GameState, bbl: string, startM: number, plan: DevPlan, ltc: number | undefined): MerchantBook {
  const lev = Math.max(0, Math.min(0.85, ltc ?? 0.5));
  const e = s.econ;
  return {
    basis: Math.round(plan.basisTotal), loan: Math.round(plan.basisTotal * lev),
    lender: lev > 0 ? pickConstructionDesk(s, `${bbl}:${startM}:merchant`) : undefined,
    noi: plan.stabNoi, yld: Math.max(0.01, plan.exitYield / 100), leaseUp: plan.leaseUp,
    rent0: blendRent(e, plan.mix), cap0: blendCap(e, plan.mix),
    lum0: leaseUpMarketAt(e, plan.mix, (u) => forwardVacancy(e, u, plan.rentable * (plan.mix[u] ?? 0))),
    mix: plan.mix,
  };
}

/**
 * THE SCHEME OPENS AND MEETS ITS MARKET. What the building is worth the day it
 * opens — the market's own mark, which already prices the vacancy it opens
 * into, the concessions and the lease-up — against what it cost and what is
 * owed on it:
 *   worth more than the loan — the merchant sells or refinances and keeps
 *     whatever is left of its equity, which in a glut may be nothing;
 *   worth less than the loan — the merchant hands back the keys, the desk
 *     takes the shortfall against its capital, and the building is on the
 *     tape as bank REO.
 */
function settleMerchant(s: GameState, parcels: ParcelTable, bbl: string, m: MerchantBook, who?: Builder): number | undefined {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.bldgArea) return undefined;
  const e = s.econ;
  // THE SAME PRO FORMA, RESTATED FOR THE MARKET THAT ARRIVED: the NOI moves
  // with rent, the exit yield with the class's cap rate, and the lease-up
  // with the vacancy the building actually opened into instead of the one
  // forecast. In a market that did what the developer expected this is its
  // own stabilised value, which cleared its margin; it falls short only when
  // the market moved against the scheme.
  const lum1 = leaseUpMarketAt(e, m.mix, (u) => e.cityVac?.[u] ?? NATURAL_VAC[u]);
  const noi1 = m.noi * blendRent(e, m.mix) / Math.max(1e-6, m.rent0);
  const yld1 = m.yld * blendCap(e, m.mix) / Math.max(0.1, m.cap0);
  const worth = Math.max(0, Math.round(noi1 / Math.max(0.01, yld1) - m.leaseUp * Math.max(0, lum1 / Math.max(0.05, m.lum0) - 1)));
  e.merchantTotals ??= { delivered: 0, underBasis: 0, handedBack: 0, lossToLenders: 0, equityLost: 0 };
  e.merchantTotals.delivered += 1;
  // The last hundred, for the economy probes: how the street's own builders
  // actually did, opening day, against what they spent.
  (e.merchantLog ??= []).push({ m: s.month, ratio: +(worth / Math.max(1, m.basis)).toFixed(3), atStart: +((m.noi / Math.max(0.01, m.yld)) / Math.max(1, m.basis)).toFixed(3) });
  if (e.merchantLog.length > 100) e.merchantLog.shift();
  if (worth < m.basis) { e.merchantTotals.underBasis += 1; e.merchantTotals.equityLost += Math.round(Math.min(m.basis - m.loan, m.basis - worth)); }
  if (!m.lender || worth >= m.loan) return worth;
  // The desk marks it and lists it, and what it will not fetch is its loss.
  const ask = reoAsk(s, worth, m.loan, m.lender);
  chargeLenderLoss(s, m.lender, Math.max(0, m.loan - ask));
  e.merchantTotals.handedBack += 1;
  e.merchantTotals.lossToLenders += Math.round(Math.max(0, m.loan - ask));
  if (!s.holdings[bbl] && !s.listings.some((l) => l.bbl === bbl)) {
    s.listings.push({
      bbl, ask, listedM: s.month, expiresM: s.month + 12, distress: true, receiverFor: m.lender, reason: "receiver",
      loanBasis: Math.min(worth, m.loan), mark: Math.round(worth),
    });
  }
  s.news.unshift({
    q: s.month, kind: "warn",
    text: `${who ? who.name : "The builder"}${who ? `, builder of the new ${rec.address},` : ` of the new ${rec.address}`} handed back the keys the month it opened — ${money(m.loan)} owed against a building worth ${money(worth)} into this market. ${m.lender} has it on the tape at ${money(ask)}.`,
  });
  return worth;
}

// ---- THE STREET'S DEVELOPERS HAVE NAMES (2026-10-14) ----------------------
//
// Most of what a city builds is started by small local developers, and every
// one of them used to be a fresh anonymous draw: a crane went up, "The city"
// was the builder, and whatever happened to the building happened to nobody.
// The owner hated watching things get built that he could not see coming or
// put a name to. So the street is a register of developers now — each a
// name and a founder, the SAME habits the draw produced (fixed for life:
// where it builds, what, how tall, how much it borrows, how much margin it
// needs), its own money in every scheme, and a record. The supply rule is
// unchanged — each look is still one developer running the same pro forma —
// but a developer that opens into a glut loses its own money, and one that
// loses all of it, or hands two buildings back to the bank, folds. New ones
// set up when the roster thins, faster when credit is easy.
//
// THE GP'S CHEQUE. A merchant developer raises most of a scheme's equity from
// partners and puts in a slice itself — about a tenth is the common
// co-invest — and takes a promote (a fifth of the partners' profit) when it
// works; a developer building mostly with its own money (a family company)
// puts in half. Both shape parameters of the industry, stated as such. It
// cannot commit more of its own money than it has.
const BUILDER_SURNAMES = [
  "Halvorsen", "Ostrander", "Pruitt", "Castellano", "Brannigan", "Okafor", "Lindqvist", "Marchetti",
  "Delacroix", "Whitcombe", "Fairbanks", "Kowalczyk", "Ruiz", "Tremblay", "Abernathy", "Nakamura",
  "Sorensen", "Galloway", "Petrakis", "Mbeki", "Hollister", "Vasquez", "Drummond", "Kessler",
  "Albright", "Ferraro", "Quinlan", "Stavros", "Mendel", "Okonkwo", "Bergstrom", "Calloway",
  "Desmond", "Engstrom", "Fitzgerald", "Grimaldi", "Haverford", "Iverson", "Jablonski", "Kincaid",
  "Lowenthal", "Moriarty", "Novak", "Orsini", "Pendleton", "Rourke", "Szabo", "Valentine",
];
const BUILDER_FIRST = ["Ana", "Ben", "Carla", "Dev", "Elena", "Frank", "Grace", "Hugo", "Iris", "Jon", "Kai", "Lena", "Marco", "Nadia", "Omar", "Priya", "Ray", "Sofia", "Tom", "Vera"];
const BUILDER_KIND = ["Development", "Builders", "Building Co.", "Development Group", "Construction", "Homes", "Properties", "& Partners"];
function builderName(s: GameState, n: number): { name: string; founder: string } {
  const used = new Set([...(s.builders ?? []).map((b) => b.name), ...(s.rivals ?? []).map((r) => r.name)]);
  for (let k = 0; k < 40; k++) {
    const h = (x: string) => hash01(`${s.seed}:builder:${n}:${k}:${x}`);
    const sur = BUILDER_SURNAMES[Math.floor(h("s") * BUILDER_SURNAMES.length)];
    const kind = BUILDER_KIND[Math.floor(h("k") * BUILDER_KIND.length)];
    const name = kind === "& Partners" ? `${sur} & Partners` : `${sur} ${kind}`;
    if (used.has(name)) continue;
    return { name, founder: `${BUILDER_FIRST[Math.floor(h("f") * BUILDER_FIRST.length)]} ${sur}` };
  }
  return { name: `Builder No. ${n}`, founder: "unknown" };
}
/** How many developers a city this size carries: about one and a half for every look a month — so a
 *  working developer starts a scheme every two or three years, as a small local shop does. */
function builderTarget(looksF: number): number {
  return Math.max(10, Math.min(60, Math.round(1.5 * looksF)));
}
const livingBuilders = (s: GameState) => (s.builders ?? []).filter((b) => b.failedM === undefined);
export function builderById(s: GameState, id: string | undefined): Builder | undefined {
  return id ? (s.builders ?? []).find((b) => b.id === id) : undefined;
}
function newBuilder(s: GameState): Builder {
  const n = (s.nextBuilderId ?? 1);
  s.nextBuilderId = n + 1;
  const { name, founder } = builderName(s, n);
  const prof = drawDeveloper(s);
  // Own money: lognormal around $3M in the town's opening prices, carried at
  // inflation — a small shop to a family company that has built for decades.
  // A developer building mostly on its own money IS money — a family company
  // or an institution building to hold — so its purse is several times a
  // merchant's.
  const capital = Math.round(3_000_000 * Math.exp(0.9 * (hash01(`${s.seed}:bcap:${n}`) * 2 - 1) * 1.6)
    * (prof.ltc <= CASH_BUILDER_LTC ? 8 : 1) * (s.econ.priceLevel ?? 1) * (s.econ.cpi ?? 1));
  return { id: `B${n}`, name, founder, bornM: s.month, prof, capital, committed: 0,
    starts: 0, delivered: 0, sfDelivered: 0, underwater: 0, handedBack: 0, profit: 0 };
}
// ---- THE TOWN'S BUILDERS AS FIRMS (GameState.builderFirms) ------------------
//
// The owner wanted nothing built by anybody who is not on the street. With
// the flag on, each of the town's builders is a firm in `s.rivals`: the same
// name, founder, habits and purse the register draws, and from then on the
// whole firm machinery — it buys the site, raises its deal's investors, draws
// a construction facility, takes the deed and a takeout loan when the
// building opens, holds it on its book, sells it, marks it, can be stressed,
// hand back keys and fail. A merchant's habits put it in the merchant style
// (buys land, holds about three years); one building mostly on its own money
// is a developer (holds for a decade). The roster target, the entry rate and
// the fifteen-year retirement are the register's.
const isBuilderFirm = (r: Rival) => !!r.builderProf;
function livingBuilderFirms(s: GameState): Rival[] {
  return (s.rivals ?? []).filter((r) => isBuilderFirm(r) && r.failedM === undefined && r.retiredM === undefined);
}
function newBuilderFirm(s: GameState): Rival {
  const b = newBuilder(s);
  const style: RivalStyle = b.prof.ltc <= CASH_BUILDER_LTC ? "developer" : "merchant";
  const r: Rival = {
    id: `r${s.rivals.length}`, name: b.name, style, founder: b.founder, builderProf: b.prof,
    cash: b.capital, debt: 0, bbls: [], targetLtv: +Math.max(0, Math.min(0.8, b.prof.ltc)).toFixed(2), bornM: s.month,
    career: [{ m: s.month, text: `Founded by ${b.founder}, a local ${style === "developer" ? "developer building on its own money" : "merchant builder"}, with ${money(b.capital)}` }],
  };
  s.rivals.push(r);
  return r;
}
function tickBuilderFirms(s: GameState, looksF: number) {
  const live = livingBuilderFirms(s);
  const target = builderTarget(looksF);
  if (!live.length && !(s.rivals ?? []).some(isBuilderFirm)) for (let i = 0; i < target; i++) newBuilderFirm(s);
  else if (live.length < target && rng(s, "dev") < 0.25 * Math.max(0.3, Math.min(1.5, s.econ.creditIdx ?? 1))) {
    const r = newBuilderFirm(s);
    s.news.unshift({ q: s.month, kind: "info", text: `${r.name} has set up as a ${r.style === "developer" ? "developer" : "builder"} in town — ${r.founder}, with ${money(r.cash)} of the firm's own money.` });
  }
  // Fifteen years without breaking ground and nothing on the book: the founder retires.
  for (const r of livingBuilderFirms(s)) {
    const idle = s.month - (r.lastBuildM ?? r.bornM);
    if (idle > 180 && !r.bbls.length && !(s.cityJobs ?? []).some((j) => j.firmId === r.id) && rng(s, "dev") < 0.02) {
      r.retiredM = s.month;
      (r.career ??= []).push({ m: s.month, text: `${r.founder} retired; the firm closed` });
    }
  }
}
function pickBuilderFirm(s: GameState): Rival | undefined {
  const live = livingBuilderFirms(s);
  return live.length ? live[Math.floor(rng(s, "dev") * live.length)] : undefined;
}

/** The roster, once a month: entries when it thins, retirements of the idle, commitments recounted from the live jobs. */
function tickBuilders(s: GameState, looksF: number) {
  if (s.builderFirms) { tickBuilderFirms(s, looksF); return; }
  if (!s.builders) s.builders = [];
  const live = livingBuilders(s);
  const target = builderTarget(looksF);
  // The opening roster is the town's existing trade; after that a new shop
  // sets up in about a quarter of the months the roster is short, more often
  // when money is easy to raise.
  if (!live.length) for (let i = 0; i < target; i++) s.builders.push(newBuilder(s));
  else if (live.length < target && rng(s, "dev") < 0.25 * Math.max(0.3, Math.min(1.5, s.econ.creditIdx ?? 1))) {
    const b = newBuilder(s);
    s.builders.push(b);
  }
  const owed: Record<string, number> = {};
  for (const j of s.cityJobs ?? []) if (j.builderId && !j.firmId) owed[j.builderId] = (owed[j.builderId] ?? 0) + (j.coInvest ?? 0);
  for (const b of livingBuilders(s)) {
    b.committed = owed[b.id] ?? 0;
    // Fifteen years without a start and nothing in the ground: the founder retires.
    const idle = s.month - (b.lastStartM ?? b.bornM);
    if (idle > 180 && !b.committed && rng(s, "dev") < 0.02) { b.failedM = s.month; b.endReason = "retired"; }
  }
  // Keep the register readable: the long-gone fall off after twenty years.
  s.builders = s.builders.filter((b) => b.failedM === undefined || s.month - b.failedM < 240);
}
function pickBuilder(s: GameState): Builder | undefined {
  const live = livingBuilders(s);
  return live.length ? live[Math.floor(rng(s, "dev") * live.length)] : undefined;
}
/** The developer's own cheque on a scheme: a tenth of the equity, half when it builds on its own money. */
function builderCoInvest(basis: number, ltc: number): number {
  const equity = Math.max(0, basis * (1 - ltc));
  return Math.round(equity * (ltc <= CASH_BUILDER_LTC ? 0.5 : 0.1));
}
/** The scheme opened: the developer's share of what it made or lost, and the record. */
function settleBuilder(s: GameState, b: Builder, j: { coInvest?: number; sf: number; merchant?: MerchantBook }, worth: number | undefined, address: string) {
  const m = j.merchant;
  b.delivered += 1;
  b.sfDelivered += Math.round(j.sf);
  if (!m || worth === undefined) return;
  const ltc = m.basis > 0 ? m.loan / m.basis : 0;
  const share = ltc <= CASH_BUILDER_LTC ? 0.5 : 0.1;
  const gain = worth - m.basis;
  const equity = Math.max(1, m.basis - m.loan);
  // Its slice of the result, plus the promote on a winner; it can lose no
  // more than the cheque it wrote.
  const result = gain >= 0 ? share * gain + 0.2 * (1 - share) * gain : Math.max(-(j.coInvest ?? share * equity), share * gain);
  b.capital = Math.round(b.capital + result);
  b.profit = Math.round(b.profit + result);
  const ratio = worth / Math.max(1, m.basis);
  b.best = Math.max(b.best ?? ratio, ratio);
  b.worst = Math.min(b.worst ?? ratio, ratio);
  if (worth < m.basis) b.underwater += 1;
  if (m.lender && worth < m.loan) b.handedBack += 1;
  if (b.capital <= 0 || b.handedBack >= 2) {
    b.failedM = s.month; b.endReason = "folded";
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `${b.name} has folded. ${b.founder}'s firm delivered ${b.delivered} building${b.delivered === 1 ? "" : "s"} `
        + `(${Math.round(b.sfDelivered / 1000).toLocaleString()}k sf) since ${monthLabel(b.bornM)}; the last, ${address}, `
        + `opened at ${Math.round(ratio * 100)}% of what it cost${b.handedBack ? `, and ${b.handedBack === 1 ? "one has" : `${b.handedBack} have`} gone back to the lender` : ""}. `
        + `Whatever it still had in the ground goes with it.`,
    });
  }
}

export function constructionQuotes(s: GameState, mix: UseMix, costTotal: number): ConstructionQuote[] {
  return constructionDesks().map((d) => {
    const app = lenderAppetite(s, d.name);
    const bank = lenderByName(s, d.name);
    const maxCommit = d.holdShare && bank ? bank.book * d.holdShare : undefined;
    // The file at this desk, on the same convex curve every other loan it
    // writes reads (relCurve) — not a private linear one.
    const rel = d.fund ? 0 : relCurve(s, d.name);
    const q = deskQuote(s.econ, d, mix, costTotal, app, rel, maxCommit);
    const why = bank?.failedM !== undefined ? `${d.name} is in receivership — nobody is answering the phone.`
      : app < 0.12 ? `${d.name} has stopped writing new paper — their capital will not carry it.`
      : q.ltcMax <= 0.02 ? `${d.name} will not touch spec construction in this market.`
      : maxCommit && q.held ? `A job this size is past ${d.name}'s hold — they will only fund $${(maxCommit / 1e6).toFixed(0)}M of it.`
      : undefined;
    return { lender: q.lender, ratePct: q.ratePct, ltcMax: q.ltcMax, points: q.points, open: q.open, why };
  });
}


export interface DevPlan {
  use: DevUse;
  mix: UseMix;
  floors: number;
  coverage: number;   // share of the lot the floorplate covers
  contract: Contract;
  sf: number;
  /** Rentable feet of the shell (proforma's `rentable`) — what a tenant signs for; `sf` is gross. */
  rentable: number;
  far: number;
  farMax: number;
  hardCost: number;
  softCost: number;
  contingency: number;
  demo: number;
  landBasis: number;    // what the site cost you — sunk, but in the yield
  /** Holding the dirt at the land rate while the building goes up — in the basis, not the budget. */
  landCarry: number;
  basisTotal: number;   // construction plus land: the denominator of yield on cost
  leaseUp: number;    // fit-out, commissions and carry until it is full
  costTotal: number;
  ltc: number;
  ltcMax: number;
  commitment: number;
  interestReserve: number;
  ratePct: number;
  lender: string;         // whose commitment this is — the desk you picked
  points: number;         // their origination fee, as a share of the commitment
  pointsCost: number;     // ...in dollars, cash at close, on top of the equity
  equity: number;         // the whole equity budget
  equityAtClose: number;  // what you actually write on day one
  months: number;
  yieldOnCost: number;    // stabilised NOI ÷ total cost — the developer's number
  // Same NOI over construction only (basis minus land). An owner replacing
  // their own husk has already paid for the dirt; charging it again is a
  // merchant underwrite, and that is why worn anonymous fabric never came
  // down after income moved onto rentable feet.
  yieldOnCostExLand: number;
  exitCap: number;
  /** Exit yield grossed up by the same developer margin the land residual uses. */
  requiredYield: number;
  /** YoC / requiredYield. Below 1 destroys value; above 1 clears the hurdle. */
  hurdleRatio: number;
  /** Stabilised NOI, $/yr — the numerator of yield on cost. */
  stabNoi: number;
  /** The tax-loaded exit yield the mark uses (the hurdle's own), %. Value on completion = stabNoi ÷ this. */
  exitYield: number;
  /** 0..1, 0.5 = market standard. What you chose to build to. */
  spec: number;
  bts?: BtsCommitment;
  btsShare?: number;
  lenderNote?: string;
}

/**
 * How high a building can PHYSICALLY go on this floor plate — zoning is one
 * limit, engineering is the other, and the old code only knew about zoning,
 * which is how a 216-storey needle ended up permitted on a 414 sf lot.
 *
 * Real New York numbers: an ordinary residential tower runs a 7-12k sf plate;
 * an office tower 20-40k; the pencil towers on 57th Street stand on ~6k sf
 * plates at about 1:15 slenderness with hundred-million-dollar damping
 * systems, and they are the outer limit of what money can do. So:
 *
 *   - anything needs ~600 sf of plate to be a building at all
 *   - a walk-up (≤6 floors) needs 1,200 sf — a Manhattan townhouse plate
 *   - going past 6 floors takes a 4,000 sf plate — you need a core
 *   - past that, slenderness governs: height ≈ 12.5 ft/floor against a plate
 *     ~sqrt(plate) wide at ~15:1 gives floors ≤ 1.2·√plate
 *   - and 90 floors is the ceiling money has actually reached
 */
/** Floor to floor, feet. */
export const FLOOR_HEIGHT_FT = 12.5;
/** Height : plate width. The 57th Street limit, and about where money stops. */
export const MAX_SLENDERNESS = 15;
export const ABS_MAX_FLOORS = 90;

/**
 * HOW TALL THE STRUCTURE WILL GO, and why it was a cliff.
 *
 * This was a staircase — under 600 ft², one floor; under 1,200, three; under
 * 4,000, six; and then, at 4,000 exactly, `1.2·√plate`. On a 6,170 ft² lot the
 * footprint dial crosses 4,000 ft² of plate at 65% coverage, and one
 * percentage point of the slider took the building from six floors to
 * forty-five: 7.5x the floors, 7.6x the area, an $18.6M job becoming a $177.7M
 * one. The player noticed, and they were right.
 *
 * Two real constraints, both smooth, both INCREASING in plate size:
 *
 *   SLENDERNESS. A square-equivalent plate is √plate feet wide, and a tower
 *   stops being buildable past a height-to-width ratio of about fifteen. That
 *   is 15·√plate feet of height, or 1.2·√plate floors — the old formula was
 *   right, it was just fenced off behind a step.
 *
 *   THE CORE. Lifts, stairs, risers and a second means of egress take a fixed
 *   bite out of every floor. A very small plate cannot carry enough of them to
 *   serve height at all, which is what the staircase was standing in for. It
 *   belongs as a ramp, not a step.
 *
 * Zoning (farMax/coverage) is the third constraint and it DECREASES in
 * footprint. The minimum of one falling curve and two rising ones is
 * continuous and unimodal: floors climb while the plate is still too small to
 * build tall on, peak where the curves cross, then fall away as the envelope
 * spreads out. No cliffs anywhere on the dial.
 */
// (the function itself now lives in value.ts and is re-exported at the top of
// this file — see the import block. It had to move so that land pricing could
// ask the same question about a lot that the massing dial asks about a plate.)
/**
 * SHOPS DO NOT STACK.
 *
 * Zoning and structure were the only two things limiting height, and neither
 * of them knows what the building is FOR. Retail does: a shop needs the street
 * to walk into it, the second floor already trades at a discount to the first,
 * and above that nobody goes. There is no such thing as a sixty-storey shop —
 * and the planner was happily approving one, at a 6.89% yield on cost, on the
 * best corner in the city. The city's own growth loop was building them at
 * fifty and forty-eight floors, and every retail job it started in a fifty
 * year run came out over two storeys.
 *
 * What DOES stack is retail underneath something else, and the game already
 * models that as the mixed-use programme: shops at grade, offices and flats
 * above. So the cap belongs on the pure-retail programme only, and a site that
 * can carry more than two floors should be getting a mixed building rather
 * than a squashed one — see `useForZone` and `retailWantsMixed`.
 */
export { RETAIL_FLOORS_MAX } from "./value";
/**
 * AND A SHED IS NOT A TOWER EITHER.
 *
 * Industrial had no cap at all: the envelope allowed 66 storeys and the
 * planner's optimum on a median vacant lot came out at 13, which is a
 * thirteen-storey warehouse. Modern distribution is single-storey with 32-40ft
 * clear heights because forklifts do not use lifts; multi-storey industrial
 * exists only where land is so dear that nothing else pencils, and even then it
 * is two or three levels with ramps. Two floors is the same allowance retail
 * gets and for the same reason — the use has a shape, and the shape is flat.
 */
export { INDUSTRIAL_FLOORS_MAX } from "./value";
export const MAX_FLOORS_BY_USE: Partial<Record<DevUse, number>> = {
  retail: RETAIL_FLOORS_MAX,
  industrial: INDUSTRIAL_FLOORS_MAX,
};


/**
 * WHAT IT WOULD COST TO BUILD THIS BUILDING AGAIN, TODAY.
 *
 * The single most important number in development economics, and the game did
 * not have it anywhere. It is the hinge of the whole cycle:
 *
 *   When buildings trade ABOVE what it costs to replace them, you build —
 *   because you can create a dollar of value for less than a dollar. Everybody
 *   works that out at once, which is what produces a glut.
 *
 *   When they trade BELOW replacement cost, nobody builds, at any interest
 *   rate, because you would be manufacturing a loss. That is what ENDS a glut,
 *   and it is the only thing that does. Not sentiment, not the cycle turning —
 *   arithmetic.
 *
 * Without it the development cycle had no self-correcting mechanism: a class
 * could sit at 25% vacancy and construction was still governed only by yield
 * on cost against an exit cap. Now the floor is real, and it is readable — a
 * player who can see value at 0.75x replacement knows two things at once: do
 * not build, and every building you buy is worth less than the bricks in it,
 * which is the best moment in the cycle to be an owner.
 *
 * Excludes land, deliberately. Replacement cost is about the BUILDING; land is
 * what you argue about separately, and mixing them is how people talk
 * themselves into bad sites.
 */
export function replacementCostPsf(rec: { class: string; mix?: UseMix; floors: number }, econ: GameState["econ"]): number {
  const mix = rec.mix && Object.keys(rec.mix).length ? rec.mix : ({ [rec.class]: 1 } as UseMix);
  const fl = Math.max(1, rec.floors || 1);
  const base = overMix(mix, (u) => HARD_COST_PSF[u] * constructionTypeMult(u, fl));
  const hard = base * econ.costIdx * heightPremium(fl);
  return Math.round(hard * (1 + SOFT_COST) * (1 + CONTINGENCY));
}

/** The whole building, to build again from a cleared site. */
export function replacementCost(rec: { class: string; mix?: UseMix; floors: number; bldgArea: number }, econ: GameState["econ"]): number {
  if (!rec.bldgArea || rec.class === "land") return 0;
  return Math.round(replacementCostPsf(rec, econ) * rec.bldgArea);
}

/**
 * WHAT THE WHOLE CITY'S FINISHED PRODUCT TRADES AT, against what it would cost
 * to build it. Above 1.0 the town builds; below it, the town stops.
 *
 * Value per foot is derived the way a developer would: stabilised rent at
 * natural vacancy, capitalised at the class's current cap rate. Weighted by
 * how much of the pipeline each class represents, because a glut in offices
 * does not stop anyone building sheds.
 */
export function cityValueToReplacement(s: GameState): number {
  const e = s.econ;
  let vsum = 0, csum = 0;
  for (const k of BUILT_CLASSES) {
    // STABILISED NOI, COMPUTED THE WAY THIS ENGINE COMPUTES NOI.
    //
    // This was `rentIdx[k] * occ * 0.62` — one flat rent-to-NOI margin for four
    // classes whose recovery rates are 0.88 / 0.92 / 0.50 / 0 and whose
    // operating cost spans $0.80 to $8.22 a foot. Checked against the engine's
    // own NOI expression at base rents, the flat margin understated every class
    // and by wildly different amounts: office -32%, retail -37%, multifamily
    // -13%, industrial -38%. The error is not a level shift that a centring
    // constant can absorb, it is twenty-five points of spread ACROSS classes —
    // and the ratio is stock-weighted, so the size of the mistake depended on
    // what the town happened to be made of.
    //
    // It also read ASKING rent, where value.ts:757 states flatly that
    // everything which prices a deal or values an asset reads what deals
    // actually sign at; and it ignored the property tax entirely, which is a
    // real claim on a real building and is capitalised into every other value
    // in this engine.
    const rent = e.effRentIdx?.[k] ?? e.rentIdx[k];
    const occ = 1 - NATURAL_VAC[k];
    const opex = opexPsf(k, e, false);
    const recov = RECOVERY_RATE[k] ?? 0;
    const egi = rent * occ + opex * recov * occ;
    const noiPsf = egi - opex - egi * MGMT_FEE;
    // Same tax solve as the land residual: value and the tax bill define each
    // other, so V = NOI / (cap + t(1 - recovery)) rather than NOI / cap.
    const cap = Math.max(3, e.capRate[k]) / 100;
    const valuePsf = noiPsf / (cap + taxRate(e) * (1 - recov));
    // The low-rise base, deliberately: this is a citywide average against a
    // citywide stock, and weighting the height premium would need a height
    // distribution nobody has measured. It biases the ratio UP for a tall town
    // and that is worth knowing rather than papering over.
    // ...and a low-rise apartment is wood frame (constructionTypeMult)
    const costPsf = HARD_COST_PSF[k] * constructionTypeMult(k, 3) * e.costIdx * (1 + SOFT_COST) * (1 + CONTINGENCY);
    // weight by the class's share of citywide stock, so the blend reflects
    // what this town is actually made of
    const w = Math.max(1, (e.stock?.[k] ?? 1));
    vsum += valuePsf * w;
    csum += costPsf * w;
  }
  return csum > 0 ? vsum / csum : 1;
}

/**
 * HOW HARD THE CITY BUILDS, GIVEN WHAT FINISHED PRODUCT IS WORTH AGAINST WHAT
 * IT COSTS TO MAKE. One copy, because there were two.
 *
 * This expression was written out twice — dev.ts, governing every start in the
 * city, and actions.ts, governing how often somebody turns up wanting a ground
 * lease. Two copies of one brake, free to drift, and neither knew about the
 * other.
 *
 * It is Tobin's q for buildings, and the mechanism is the only thing that has
 * ever ended a glut: when finished product trades below replacement cost,
 * development stops at any interest rate in any phase, because you would be
 * manufacturing a loss.
 *
 * THE OLD SHAPE WAS `(vtr - 0.55) / 0.45`, AND THE 0.55 IS A CONFESSION. Its
 * own comment: "The first cut of this braked on (vtr - 0.80)/0.25, which reads
 * fine until you measure where the ratio actually sits: median 0.71 across real
 * runs, so the brake pinned at its 0.05 floor... centred where the game lives."
 * That is a constant moved to make an outcome come out right, and it was moved
 * to accommodate a valuation that was wrong by 13-38% by class. Fix the
 * valuation and the ratio moves to a median of 1.13 — parity, which is where a
 * value-to-replacement ratio belongs, because a market that persistently traded
 * below its own replacement cost would never have been built.
 *
 * So the centring is gone; there is nothing left to centre. What remains is the
 * ELASTICITY of construction to q, which is a measured quantity rather than a
 * fitted one: the housing-supply literature puts it between about 0.6 and 5
 * across metros with a central value near 1.5, and a land-constrained harbour
 * peninsula sits at the low end of that. Expressed as a power, which is what an
 * elasticity is, so a 10% move in q is a 12% move in starts.
 *
 * The rails are guards again rather than structure. Measured over 3 towns x 50
 * years the floor binds in 0% of months and the cap in 3%, against the old
 * form's floor binding whenever the market turned.
 */
const Q_ELASTICITY = 1.2;
export function buildClimate(s: GameState): number {
  const vtr = cityValueToReplacement(s);
  return Math.max(0.10, Math.min(2.5, Math.pow(Math.max(0.05, vtr), Q_ELASTICITY)));
}


/**
 * THE LARGEST BUILDING THE PLANNER WILL DRAW ON A LOT — the same
 * `min(plate x floors, envelope)` `planDevelopment` strikes, taken over the
 * footprints the Build desk offers (8% of the lot to each use's MAX_COVERAGE). Zoning alone
 * (lot x FAR) overstates a small lot several times over, because slenderness
 * and the core stop it going up long before the FAR runs out.
 */
export function maxBuildable(
  rec: { farMaxComm: number; farMaxRes: number; lotArea: number },
): { gsf: number; floors: number; coverage: number } {
  const envelope = rec.lotArea * farMaxFor(rec);
  let best = { gsf: 0, floors: 1, coverage: 0.6 };
  // Each use at the footprints it may take (MAX_COVERAGE) and the height it stacks to.
  for (const use of BUILT_CLASSES) {
    for (let c = 0.08; c <= MAX_COVERAGE[use] + 1e-4; c += 0.01) {
      const fl = maxFloorsFor(rec, c, use);
      const gsf = Math.min(rec.lotArea * c * fl, envelope);
      if (gsf > best.gsf + 1) best = { gsf: Math.round(gsf / 100) * 100, floors: fl, coverage: c };
    }
  }
  return best;
}

/**
 * A site that wants to be taller than a shop can be. Anything the market would
 * put more than two floors on is a mixed building with retail at grade, not a
 * two-storey shop wasting a fifteen-FAR corner.
 */
export function retailWantsMixed(rec: { farMaxComm: number; farMaxRes: number; lotArea?: number }, coverage = 0.6): boolean {
  return maxFloorsFor(rec, coverage) > RETAIL_YIELDS_ABOVE;
}
// Where standalone shops stop making sense. The median vacant lot in this
// city carries six floors — a small plate tops out there on slenderness — so
// a threshold any lower converted literally every site to mixed and the town
// stopped building standalone retail at all. Above six the envelope is worth
// too much to spend on a two-storey shop; at or below it, a shop building is
// what actually gets built, and giving up the unused FAR is the price of the
// use, which is exactly the trade a real developer weighs.
const RETAIL_YIELDS_ABOVE = 6;

export function planDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.6,
  contract: Contract = "gmp", ltcWanted?: number,
  custom?: {
    mix?: UseMix; suites?: Partial<Record<BuiltClass, number>>; bts?: BtsCommitment; groundRetail?: "auto" | "on" | "off";
    /**
     * A job already out of the ground keeps the use it was permitted under
     * (vested rights) — a takeover finishes the dead sponsor's building even
     * if the district has since been remapped. Nothing else sets this.
     */
    vested?: boolean;
    /** The massing is a structure already standing: no new-build coverage limit (MAX_COVERAGE). */
    shell?: boolean;
    /** This project's hard cost against the market index (`projectCostMult`). */
    costMult?: number;
  },
  lender?: string,
  spec = 0.5,
  landBasisOverride?: number,
): DevPlan | null {
  // THE ENVELOPE YOU ACTUALLY HAVE. Zoning moves, variances are won and lots
  // are assembled — all of which live on the resolved record. Planning against
  // the static one meant the upzoning you read about on the news, and the
  // variance you paid a year of hearings for, bought you nothing at the desk.
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea) return null;
  // A NUMBER THAT IS NOT A NUMBER IS NOT A DESIGN.
  //
  // NaN does not throw here, it propagates, and every guard downstream is a
  // COMPARISON — which against NaN is false, so each one waves it through. A
  // NaN floor count becomes a NaN square footage; `if (sf < 2000) return null`
  // does not fire; the budget, the commitment and the equity are all NaN; both
  // funding tests in startDevelopment ("can you fund it", "is the cheque in the
  // account") pass because NaN is neither less than nor greater than anything;
  // and the close does `cash -= NaN`. The state is JSON-cloned every tick, so
  // NaN comes back as null, the next `cash += x` turns null into x, and the
  // firm's entire bankroll has silently vanished with no error anywhere in the
  // chain. That is precisely what happened: it cost a merchant builder its
  // whole fund on the first groundbreak, in four seeds out of four, and read
  // as "ground-up development is value-destructive".
  //
  // ltcWanted was already defended against this below. It was never the only
  // way in — the caller supplies floors, coverage and spec too.
  if (!Number.isFinite(floors) || !Number.isFinite(coverage) || !Number.isFinite(spec)) return null;
  const farMax = farMaxFor(rec);

  // THE PRO FORMA IS THE ONE THE LAND RESIDUAL SOLVES. Everything from the
  // massing to the exit yield is `developmentProForma` (proforma.ts); what is
  // left here is the desk's own business — which lender you picked, and what
  // you paid for the dirt.
  // The quote is the chosen desk's, not the town's. Rival and city jobs never
  // pass a lender, so they land on the regional — the historical default.
  // EVERY JOB HAS ITS OWN BID (2026-10-14). The street's projects carry a
  // per-site cost draw (projectCostMult — ground conditions, a tight site, a
  // contractor's book that month), and the player's carried none: every
  // scheme the player priced came in at exactly the average, a dispersion
  // nobody else was spared. The same draw applies to every plan now; it is
  // hashed on the lot and the season, so the design desk's number and the
  // contract are the same number.
  const customC = { ...(custom ?? {}), costMult: custom?.costMult ?? projectCostMult(s, bbl, use) };
  const pf = developmentProForma(rec, s.econ, {
    use, floors, coverage, contract, spec, custom: customC, ltcWanted,
    quote: (mix, preReserve) => {
      const cqs = constructionQuotes(s, mix, preReserve);
      return cqs.find((q) => q.lender === lender) ?? cqs.find((q) => q.lender === CONSTRUCTION_LENDER)!;
    },
  });
  if (!pf) return null;
  // THE ZONING THE LAND WAS PRICED ON. The residual, the city and the rivals
  // only ever draw what `zonePermits` hosts; a desk that planned anything
  // else was quoting the player a building the tape says cannot exist here.
  // `zoneUseBar` is that rule, asked of the whole programme.
  if (!custom?.vested && zoneUseBar(rec, use, s.econ, devMix(use, custom?.mix), pf.floors)) return null;
  const { mix, hardCost, softCost, demo, contingency, leaseUp, costTotal, months, ltc, ltcMax,
    commitment, interestReserve, ratePct, pointsCost, stabNoi, exitCap, exitYieldPct, bts, btsShare } = pf;

  // THE DIRT IS PART OF THE DEAL.
  //
  // Yield on cost was computed against construction cost alone, as if the site
  // had been free. It is not: it is the first and least recoverable dollar in
  // any development, and it is the whole reason a corner that rents for twice
  // as much does not automatically build for twice the profit. Leaving it out
  // made nearly four sites in five clear a hundred-basis-point hurdle — in a
  // business where most land sits vacant precisely because it does not pencil.
  //
  // It is NOT charged as cash — you already paid for it, and charging twice
  // would be its own lie — but it belongs in the denominator, because that is
  // what yield on cost means. So does what it costs to hold it while the
  // building goes up (landCarryFactor): the residual prices dirt net of that
  // wait, and a desk that ignored it passed every lot bought at the residual.
  const landBasis = Math.round(
    landBasisOverride ?? s.holdings[bbl]?.costBasis
      ?? (rec.class === "land" && !ownerOf(s, bbl) ? ownerAskPsf(rec, s.econ) * rec.lotArea : landValue(rec, s.econ)),
  );
  const landCarry = Math.round(landBasis * pf.landCarryRate);
  // financing cost is a line in every development budget, and it belongs in
  // the basis the yield is measured against
  const projectCost = costTotal + interestReserve;
  const basisTotal = pf.nonLandBasis + landBasis + landCarry;
  const yieldOnCost = basisTotal > 0 ? (stabNoi / basisTotal) * 100 : 0;
  const buildBasis = Math.max(0, pf.nonLandBasis);
  const yieldOnCostExLand = buildBasis > 0 ? (stabNoi / buildBasis) * 100 : 0;
  // Hurdle against the tax-loaded exit the mark will actually use — not a
  // bare cap that made every tower look like 1.78x on a job that marks at 1.03x.
  const { requiredYield, hurdleRatio } = developmentHurdle(yieldOnCost, exitYieldPct);

  const lenderNote = ltc === 0
    ? "No construction lender will touch spec commercial in a recession. Pre-lease it, or fund the whole thing yourself."
    : hurdleRatio < 1
      ? `Yield on cost is ${yieldOnCost.toFixed(2)}% against a ${requiredYield.toFixed(2)}% required yield `
        + `(${exitCap.toFixed(2)}% exit, tax-loaded to ${exitYieldPct.toFixed(2)}%, plus the developer margin). `
        // WHAT A SHORT HURDLE ACTUALLY SAYS. The required yield carries the
        // developer's margin, so the finished building is worth
        // hurdle × (1 + DEV_MARGIN) of everything in the basis — the same
        // capitalisation the mark uses. This sentence used to call every plan
        // under 1.0 "a way to build a building for more than it is worth",
        // which is only true under 1/(1 + DEV_MARGIN) ≈ 0.85. Land on this
        // tape clears at the builder residual — hurdle 1.0 exactly — so a lot
        // bought a few points over it plans at 0.95-0.99: a building worth
        // 11-16% more than it cost, and the desk was telling the player it
        // would lose money.
        + (hurdleRatio * (1 + DEV_MARGIN) >= 1
          ? `Finished, it would be worth ${((hurdleRatio * (1 + DEV_MARGIN) - 1) * 100).toFixed(0)}% more than it cost — `
            + `short of the ${(DEV_MARGIN * 100).toFixed(0)}% margin a merchant builder needs, which is why nobody else is building it.`
          : `That is a way to build a building for more than it is worth.`)
      : undefined;

  const plan: DevPlan = {
    use, mix, floors: pf.floors, coverage: pf.coverage, contract, sf: pf.gsf,
    far: +(pf.gsf / rec.lotArea).toFixed(1), farMax,
    hardCost, softCost, contingency, demo, leaseUp, costTotal, landBasis, landCarry, basisTotal,
    stabNoi, exitYield: exitYieldPct,
    ltc, ltcMax, commitment, interestReserve, ratePct,
    lender: pf.lender, points: pf.points, pointsCost,
    equity: projectCost - commitment,
    // Equity funds FIRST. The bank does not release a dollar until yours are
    // in the ground, which is why a development eats your balance sheet at the
    // start rather than in even slices.
    equityAtClose: Math.round((projectCost - commitment) * 0.55),
    // `exitCap` on the plan is the tax-loaded exit yield the hurdle uses —
    // the same capitalisation `assetValue` applies — so reuse / residual
    // readers that call developmentHurdle(yoc, plan.exitCap) stay consistent.
    months, yieldOnCost, yieldOnCostExLand, exitCap: exitYieldPct, requiredYield, hurdleRatio, spec: clamp01(spec), bts, btsShare, lenderNote,
    rentable: pf.rentable,
  };
  // The second half of the NaN gate above. Bad inputs are one way to get a
  // plan full of nonsense; a divide by a zero lot, a mix that sums to nothing,
  // or an arithmetic path nobody anticipated are others. No plan leaves this
  // function unless every number in it is a number — a null here reads to the
  // caller as "this site cannot be planned", which is the truth.
  for (const v of Object.values(plan)) {
    if (typeof v === "number" && !Number.isFinite(v)) return null;
  }
  return plan;
}

export interface DevelopmentUnderwriting {
  plan: DevPlan;
  clears: boolean;
  financeable: boolean;
  appetite: number;
  why?: string;
}

export function adaptiveReuseEligibility(
  s: GameState, parcels: ParcelTable, bbl: string,
): { ok: boolean; why?: string; occupancy?: number } {
  const h = s.holdings[bbl];
  const rec = h ? resolveRec(parcels, s, bbl) : null;
  if (!h || !rec) return { ok: false, why: "You do not own that building." };
  if (rec.class === "land" || !rec.bldgArea) return { ok: false, why: "There is no shell to convert." };
  if (rec.class === "multifamily" || (mixOf(rec).multifamily ?? 0) > 0.5) {
    return { ok: false, why: "This is already predominantly housing." };
  }
  if (s.landmarks?.[bbl] !== undefined) return { ok: false, why: "Landmark controls do not permit this conversion." };
  if (s.developments[bbl]) return { ok: false, why: "A project is already under way." };
  if (h.groundLeased || s.groundLeases?.[bbl]) return { ok: false, why: "The ground lessee controls the improvement." };
  if (h.sale) return { ok: false, why: "Pull the sale process before starting a conversion." };
  if (h.loan || (h.mezz?.balance ?? 0) > 0 || s.facility?.bbls.includes(bbl)) {
    return { ok: false, why: "Existing secured debt must be paid off or released before a conversion loan closes." };
  }
  const occupied = h.tenants.reduce((a, t) => a + t.sf, 0)
    + (h.occ ?? 0) * useRentableSf(rec, "multifamily");
  const occupancy = occupied / Math.max(1, rentableSf(rec));
  if (occupancy > 0.20) {
    return { ok: false, why: `The building is ${(occupancy * 100).toFixed(0)}% occupied. Stop leasing and obtain vacant possession first.`, occupancy };
  }
  return { ok: true, occupancy };
}

export function reuseMixFor(target: "multifamily" | "mixed", customMix?: UseMix): UseMix {
  return customMix ?? (target === "multifamily"
    ? { multifamily: 0.95, retail: 0.05 }
    : { multifamily: 0.70, office: 0.20, retail: 0.10 });
}

/** A conversion is a change of use, and the new use has to be one the lot's zoning hosts. */
export function reuseZoneBar(
  s: GameState, parcels: ParcelTable, bbl: string,
  target: "multifamily" | "mixed" = "multifamily", customMix?: UseMix,
): string | null {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return null;
  return zoneUseBar(rec, "mixed", s.econ, devMix("mixed", reuseMixFor(target, customMix)), rec.floors);
}

export function planAdaptiveReuse(
  s: GameState, parcels: ParcelTable, bbl: string,
  target: "multifamily" | "mixed" = "multifamily",
  customMix?: UseMix,
): DevPlan | null {
  const eligible = adaptiveReuseEligibility(s, parcels, bbl);
  if (!eligible.ok) return null;
  return planReuseAt(s, parcels, bbl, ownedHoldingValue(s, parcels, s.holdings[bbl]), target, customMix);
}

/**
 * THE CONVERSION, PRICED — the desk's arithmetic without the player's
 * eligibility gates, given the value of the shell being converted (its
 * opportunity cost). `planAdaptiveReuse` calls it for your buildings; a
 * converter competitor calls it for its own (COMPETITORS_PLAN.md #9), so both
 * price a conversion on the same desk and the same exit.
 */
export function planReuseAt(
  s: GameState, parcels: ParcelTable, bbl: string, opportunity: number,
  target: "multifamily" | "mixed" = "multifamily",
  customMix?: UseMix,
): DevPlan | null {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.bldgArea) return null;
  const coverage = Math.max(0.08, Math.min(0.9,
    rec.bldgArea / Math.max(1, rec.lotArea * rec.floors)));
  // A housing conversion keeps a small active ground-floor allowance but does
  // not let the generic new-build rule turn a two-storey shell into mostly
  // shops (its 1.25-floor retail assumption is for ground-up podium design).
  const reuseMix = reuseMixFor(target, customMix);
  const planUse: DevUse = "mixed"; // custom programme must travel through devMix
  const base = planDevelopment(
    s, parcels, bbl, planUse, rec.floors, coverage, "gmp",
    undefined, { mix: reuseMix, shell: true }, undefined, 0.5, opportunity,
  );
  if (!base) return null;
  // Reuse keeps structure and much of the envelope, but replaces interiors,
  // risers, services and life-safety systems. Cost and time are materially
  // below demolition/new-build; lease-up remains the target programme's risk.
  const hardCost = Math.round(base.hardCost * 0.58);
  const softCost = Math.round(base.softCost * 0.70);
  const demo = Math.round(base.demo * 0.30);
  const contingency = Math.round((hardCost + softCost) * CONTINGENCY);
  const costTotal = hardCost + softCost + demo + contingency + base.leaseUp;
  const scale = costTotal / Math.max(1, base.costTotal);
  const commitment = Math.round(base.commitment * scale);
  const interestReserve = Math.round(base.interestReserve * scale);
  const pointsCost = Math.round(base.pointsCost * scale);
  const equity = Math.max(0, costTotal + interestReserve - commitment);
  // The shell is held through the conversion just as dirt is held through a
  // new build — same land-rate carry, on the conversion's shorter schedule.
  const reuseMonths = Math.max(9, Math.round(base.months * 0.70));
  const landCarry = Math.round(opportunity * landCarryFactor(reuseMonths));
  const basisTotal = opportunity + landCarry + costTotal + interestReserve + pointsCost;
  const stabilizedNoi = base.stabNoi;
  const yieldOnCost = stabilizedNoi / Math.max(1, basisTotal) * 100;
  const reuseBuild = costTotal + interestReserve + pointsCost;
  const yieldOnCostExLand = reuseBuild > 0 ? stabilizedNoi / reuseBuild * 100 : 0;
  // THE SAME EXIT THE GROUND-UP DESK AND THE MARK USE. This passed the bare
  // cap rate while planDevelopment passes the tax-loaded exit yield, so a
  // conversion cleared a lower bar than a new building on the same lot for
  // the same finished product — one hurdle, two answers.
  const { requiredYield, hurdleRatio } = developmentHurdle(yieldOnCost, base.exitYield);
  return {
    ...base,
    hardCost, softCost, demo, contingency, costTotal,
    commitment, interestReserve, pointsCost,
    equity, equityAtClose: Math.round(equity * 0.55),
    landCarry, basisTotal, yieldOnCost, yieldOnCostExLand, requiredYield, hurdleRatio,
    stabNoi: stabilizedNoi,
    months: reuseMonths,
    lenderNote: hurdleRatio < 1
      ? `Conversion yield is ${yieldOnCost.toFixed(2)}% against ${requiredYield.toFixed(2)}% required.`
      : base.lenderNote,
  };
}

export function startAdaptiveReuse(
  s: GameState, parcels: ParcelTable, bbl: string,
  target: "multifamily" | "mixed" = "multifamily", customMix?: UseMix,
): { s: GameState; err?: string; msg?: string } {
  { const why = consentFor(s, s.holdings[bbl], "redevelop"); if (why) return { s, err: why }; }
  if (s.holdings[bbl]?.groundRentOut) return { s, err: "You sold the land under this building — the fee owner's consent is not on offer. Buy the land back first." };
  const eligible = adaptiveReuseEligibility(s, parcels, bbl);
  if (!eligible.ok) return { s, err: eligible.why };
  const rec = resolveRec(parcels, s, bbl)!;
  const barred = reuseZoneBar(s, parcels, bbl, target, customMix);
  if (barred) return { s, err: barred };
  const plan = planAdaptiveReuse(s, parcels, bbl, target, customMix);
  if (!plan) return { s, err: "That conversion cannot be planned." };
  if (plan.hurdleRatio < 1) return { s, err: plan.lenderNote ?? "The conversion does not clear its economic hurdle." };
  // THE PURSE THAT OWNS THE DEED pays for its conversion, the same rule as a
  // ground-up start: a fund deed draws on the vehicle (and only while it is
  // investing); the sponsor's own money net of cash held for open raises.
  const purse = groundbreakPurse(s, parcels, bbl);
  if (purse.closed) return { s, err: purse.closed };
  const available = purse.fund ? purse.total : Math.max(0, purse.total - heldByRaises(s, bbl));
  if (available < devFundingNeed(plan).whole) {
    return { s, err: `The conversion requires ${money(plan.equity)} of equity plus a change-order margin.` };
  }
  // THE DAY-ONE CHEQUE COUNTS THE LINE TOO, and this was the odd one out: the
  // whole-job test three lines up has always counted the revolver as committed
  // money, then the closing test refused the same firm for the same money on a
  // narrower definition of it. Two answers to one question. Closing equity is
  // written from the balance sheet, and the balance sheet includes the line.
  const dayOne = plan.equityAtClose + plan.pointsCost;
  if (available < dayOne) {
    return { s, err: `${money(dayOne)} is due at closing.` };
  }
  const next = clone(s);
  const nh = next.holdings[bbl];
  payFromPurse(next, parcels, bbl, dayOne, "dev", purse.fund);
  const oldMix = mixOf(rec);
  for (const use of BUILT_CLASSES) {
    const oldSf = useRentableSf(rec, use);
    if (oldSf > 0) addStock(next.econ, use, -oldSf);
  }
  moveDeposit(next, nh, -depositsOn(nh));
  nh.tenants = [];
  nh.occ = 0;
  queueSupplyProject(next, {
    bbl, source: "reuse", deliverM: next.month + plan.months,
    sfByUse: programmeSf(rentableFromSpec(plan.sf, plan.floors), plan.mix),
  });
  next.developments[bbl] = {
    bbl, use: target, mix: plan.mix, sf: plan.sf, floors: plan.floors,
    coverage: plan.coverage, costTotal: plan.costTotal, hardCost: plan.hardCost,
    contract: "gmp", landBasis: plan.landBasis,
    contingency: plan.contingency, contingencyUsed: 0,
    lender: plan.lender, commitment: plan.commitment, drawn: 0, loanBalance: 0,
    interestReserve: plan.interestReserve, reserveUsed: 0,
    leaseUpReserve: plan.leaseUp, equityBudget: plan.equity,
    equitySpent: plan.equityAtClose, equityPrefunded: plan.equityAtClose,
    ratePct: plan.ratePct, startM: next.month, deliverM: next.month + plan.months,
    baseMonths: plan.months, piped: true, signed: [], events: 0,
    mode: "reuse", reuseFrom: oldMix,
    reuseOldSf: rentableSf(rec),
  };
  recordPropertyEvent(next, bbl, {
    kind: "build-start", use: target, sf: plan.sf, floors: plan.floors,
    party: firmShort(next), outcome: `Adaptive reuse from ${rec.class}`,
  });
  next.news.unshift({
    q: next.month, kind: "deal", bbl,
    text: `Conversion underway at ${rec.address}: ${rec.class} shell to ${target}, `
      + `${Math.round(plan.sf).toLocaleString()} sf, delivery ${monthLabel(next.month + plan.months)}.`,
  });
  return { s: next, msg: "Conversion started." };
}

/**
 * THE SAME SITE-LEVEL UNDERWRITING FOR EVERY NON-PLAYER BUILDER.
 *
 * `planDevelopment` is the complete pro forma: site rent and vacancy, hard and
 * soft cost, demolition, lease-up, land basis, construction rate, points,
 * interest reserve, stabilized NOI and exit cap. The player sees it directly;
 * city and rival starts used to substitute class indices and phase labels.
 *
 * The player may deliberately build a bad or all-cash project. Autonomous
 * builders may not: they require both the common economic hurdle and an open
 * construction desk.
 */
/**
 * NOT EVERY BUILDER GETS THE SAME PRICE (2026-10-12).
 *
 * The street's pro forma priced every project in town at the market's cost
 * index, so every site with the same rent crossed its hurdle on the same
 * month: in a 100-year developer run the city built no office for sixty years
 * (89 of 99 years with nothing delivered), then a quarter of the office stock
 * in two decades — peak year 19x the average, against roughly 2-3x in the
 * US completions record (CBRE-EA office completions, 1980s peak to mean). A
 * class sat at 1.3% vacancy for twelve years with no crane, because there was
 * no builder in town for whom the deal penciled until there was one for whom
 * it penciled everywhere at once.
 *
 * Real construction cost is not one number. Comparable buildings of the same
 * type in the same city spread about +/-15% around the median between the
 * quartiles (RSMeans square-foot costs, 25th/75th percentile), i.e. a log
 * spread near 0.2, some of which is specification this engine already models
 * separately — so each project here draws its own hard cost, lognormal with
 * sigma 0.15, a shape parameter set from that spread and stated as such. It
 * is a property of the site and of whoever controls it (ground conditions,
 * assemblage, the builder's own crews and subs), so it persists, and it turns
 * over with control of the site, about every five years, staggered by lot.
 * It is a real cost, not a belief: the job is booked at it, and a project
 * that pencils because it really is cheap really costs less.
 *
 * The player's desk is not drawn — the player gets the desk's real quotes.
 */
const PROJECT_COST_SIGMA = 0.15;
const PROJECT_TERM_M = 60;
export function projectCostMult(s: GameState, bbl: string, use: DevUse): number {
  let h = 2166136261;
  for (let i = 0; i < bbl.length; i++) { h ^= bbl.charCodeAt(i); h = Math.imul(h, 16777619); }
  const phase = (h >>> 0) % PROJECT_TERM_M;
  const epoch = Math.floor((s.month + phase) / PROJECT_TERM_M);
  return Math.exp(PROJECT_COST_SIGMA * hashNormal(`${bbl}|${use}|${epoch}|${s.seed}`));
}

export function underwriteDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.62, landBasisOverride?: number, spec = 0.5, ltcWanted?: number,
): DevelopmentUnderwriting | null {
  const plan = planDevelopment(
    s, parcels, bbl, use, floors, coverage, "gmp",
    ltcWanted, { costMult: projectCostMult(s, bbl, use) }, undefined, spec, landBasisOverride,
  );
  if (!plan) return null;
  const financeable = plan.ltcMax > 0 && plan.commitment > 0;
  const clears = financeable && plan.hurdleRatio >= 1;
  return {
    plan,
    clears,
    financeable,
    // Same land-constrained supply elasticity used by devPencils. No floor:
    // a project below its required yield has zero autonomous appetite.
    appetite: clears ? Math.min(3, Math.pow(plan.hurdleRatio, 1.2)) : 0,
    why: !financeable
      ? "No construction desk is open."
      : plan.hurdleRatio < 1
        ? `${plan.yieldOnCost.toFixed(2)}% yield on cost is below the ${plan.requiredYield.toFixed(2)}% required yield.`
        : undefined,
  };
}

/**
 * Publish what the order desk can actually build on real parcels.
 *
 * The city examines 36 candidate lots for each crane and takes the best.
 * The expected best observation is therefore about the 36/37 = 97th
 * percentile, so this is not a tuned percentile. It closes the last dual-pencil
 * seam: macro orders now know whether the same full parcel pro forma that will
 * judge the eventual groundbreak clears anywhere the city is likely to find.
 */
export function refreshDevelopmentFeasibility(
  s: GameState, parcels: ParcelTable, bbls: string[],
): void {
  if (s.econ.sitePencil && s.month % 12 !== 0) return;
  const scores: Record<BuiltClass, number[]> = {
    office: [], retail: [], multifamily: [], industrial: [],
  };
  // Every vacant site's hurdle, clearing or not: how far rent stands from the
  // level at which a competitor builds next door. See `siteHurdle`.
  const hurdles: Record<BuiltClass, number[]> = {
    office: [], retail: [], multifamily: [], industrial: [],
  };
  // DO NOT WALK THE WHOLE CITY WITH A FULL PRO FORMA. A Great City has nearly
  // six thousand lots; four plans per lot blocked the browser's main thread
  // for seconds on every annual advance. The actual city examines 36 lots for
  // one crane. Four independent crane samples (144 valid sites) estimate its
  // P97 tail without making map size a UI-latency multiplier.
  //
  // Local LCG, not the game's RNG stream: measuring feasibility must not
  // re-roll the economy. Month changes the sample each annual refresh.
  //
  // AND REDEVELOPMENT SITES COUNT. Macro orders used to sample vacant dirt
  // only, so a built-out town under chronic `structTight` looked like it had
  // nowhere to build — while worn FAR-rich lots sat unexamined. The order
  // book must see densify candidates too — but in SEPARATE quotas. A first
  // cut that mixed them filled all 144 slots with worn buildings (plentiful)
  // and zeroed the office pencil because those lots only cleared as housing.
  // Appetite is multiplicative on sitePencil; a zero pencil is a shut class.
  // THE PENCIL MUST ASK THE SAME ZONING THE SHOVEL ASKS. This sampler scored
  // all four uses on every lot, while the actual start path routes through
  // useForZone — which only ever returns industrial on M-zoned dirt. In a
  // town platted with no M zones at all (the standard city: 859 C, 439 R,
  // 0 M) that split told two stories about one question: sitePencil said
  // "sheds pencil here" every year while the crane could never once choose
  // one. Downstream, supplyShut believed the pencil, so the scarcity mute
  // stayed on and fifty years of 1.5% shed vacancy priced as if supply were
  // coming — the vacancy rail went from guard to load-bearing (measured:
  // 75% of months bound). A use a lot's zoning cannot host scores nothing.
  // ...AND A COMMERCIAL CORRIDOR ON THE FRINGE HOSTS A SHED. A town platted
  // with zero M zones (this one: 859 C, 439 R, 0 M) used to be a town where
  // industrial could never be built AT ALL — sitePencil.industrial was
  // structurally zero, starts never flowed, and the class spent 93% of an
  // 80-year campaign welded to its 1.54% vacancy floor with the strongest
  // real rent growth in the model and zero groundbreaks. That is not a
  // market, and it is not zoning either: light industrial — last-mile
  // depots, flex, self-storage-grade sheds — is an as-of-right or
  // special-permit use on low-rent commercial corridors in life, which is
  // exactly where 2018–2024 put its fulfilment build-out (dead malls and
  // strip corridors, not new M districts). Fringe C land (demand < 45, the
  // same tier useForZone treats as the corridor) permits it; prime C land
  // still refuses — nobody permits a loading dock on the hundred block.
  const LAND_N = 96;
  const REDEV_N = 72;
  const infillRatios: number[] = [];
  const ownMoney = streetHasOwnMoney(s);
  const chosen = new Set<string>();
  // nothing in this pass builds, demolishes or merges, so the cornice of a
  // block is the same number every time it is asked
  // A FIXED PANEL, NOT A FRESH DRAW (2026-10-11). The sample was re-drawn
  // every year from a month-seeded stream, and its P97 is roughly the third
  // best lot in the draw — so one year's draw held three standout sites and
  // the next held none, and the published distance to replacement cost leapt
  // with no change in the market at all: measured on map 3003, office
  // `siteHurdle` 1.00 -> 2.03 -> 0.81 in consecutive years, which switched
  // the growth premium in the office cap on and off and moved its target 3.5
  // points in six months. A repeat-measure panel is how a price index keeps
  // sampling noise out of a time series: the same lots are asked every year,
  // and a lot leaves the panel only when something is built on it.
  let x = (s.seed ^ 0x9e3779b1) >>> 0;
  const yrNow = START_YEAR + Math.floor(s.month / 12);
  let landCount = 0, redevCount = 0;
  const maxAttempts = Math.min(bbls.length * 3, (LAND_N + REDEV_N) * 24);
  for (let attempt = 0; attempt < maxAttempts && (landCount < LAND_N || redevCount < REDEV_N); attempt++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const bbl = bbls[x % bbls.length];
    if (!bbl || chosen.has(bbl)) continue;
    if (s.holdings[bbl] || s.developments[bbl] || (s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
    if (isCivicLand(s, bbl)) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.lotArea < 1_500 || ownerOf(s, bbl)) continue;
    if (rec.class === "land") {
      if (landCount >= LAND_N) continue;
      chosen.add(bbl);
      landCount++;
      for (const use of BUILT_CLASSES) {
        if (!zonePermits(rec.zoneDist, use, rec.demandScore, s.econ)) continue;
        // THE PENCIL TEST MUST PRICE THE SCHEME THE LAND IS PRICED FOR.
        //
        // This read `Math.min(14, maxFloorsFor(...))` — a flat fourteen-floor
        // sampler convenience that had become a structural constraint, because
        // the LAND under it is a residual struck on the full legal envelope
        // (`residualScheme` uses farMaxForLocal x envelopeRealisation). So on
        // any lot whose envelope exceeds fourteen floors, the dirt was priced
        // for a scheme this test was forbidden to build, and it duly reported
        // that nothing pencils. One quantity — what can be built here —
        // answered two different ways, and the disagreement fell entirely on
        // the best sites in the city.
        //
        // Measured on the reference city's prime office lot at year 15
        // (demand 100, 7,488 sf, legal max 32 floors, land $72.1M = $9,624 per
        // square foot of LAND):
        //
        //     14 fl  FAR  8.7   YoC 5.29%  vs 6.68% required   hurdle 0.79
        //     30 fl  FAR 18.6   YoC 7.03%  vs 6.68% required   hurdle 1.05
        //
        // The same lot fails at fourteen floors and clears at thirty. Yield on
        // cost EX LAND was 15.0% at fourteen floors — the building was never
        // the problem; the land was, because it was carrying an envelope the
        // scheme could not use. That is why `sitePencil.office` sat at 0.000
        // in half of all months INCLUDING the months the market was welded to
        // its frictional vacancy floor, and it is the mechanism behind
        // "supply cannot answer price".
        //
        // `cityInfillCap` is the envelope the SHOVEL actually gets
        // (tickCityGrowth and tickTeardowns both size against it), so the
        // sampler asks for that and no more. It is not the legal maximum — the
        // cornice datum and its scarcity push still bind — but it is the same
        // question the start path asks, which is the whole point.
        const infill = cityInfillCap(s, parcels, rec, use);
        const plate = cityCoverage(use);
        const floors = Math.max(2, Math.min(infill, maxFloorsFor(rec, plate, use)));
        // ...and PUBLISH what that envelope is worth against the legal one, so
        // the land market can price the building the city will actually permit.
        // See econ.infillShare in market.ts and residualScheme in value.ts.
        {
          const legalFl = maxFloorsFor(rec, plate, use);
          if (legalFl > 0) infillRatios.push(Math.max(0.05, Math.min(1, floors / legalFl)));
        }
        // ...BUT THE ENVELOPE IS THE CEILING OF THE QUESTION, NOT THE ANSWER
        // (2026-10-10). A builder picks the height that pays best, and the
        // land residual and the city's own start path already do
        // (`schemeFloorLadder`, `landRead().scheme`); this sampler priced only
        // the envelope. So it asked whether a fourteen-storey tower pencils on
        // a lot where a four-storey walk-up would, answered no, and the order
        // book it feeds read zero. Measured over 8 worlds x 40 years: in the
        // months a class sat on its vacancy floor, starts were zero in 45-100%
        // of them, and in every such month the cause was this pencil reading
        // zero while the class pro forma (low-rise, at the ninth-decile site)
        // read 0.7-2.9. On a pinned flats month the best site's envelope
        // scheme read 0.93 at free land against 1.90 for the walk-up.
        let u: ReturnType<typeof underwriteDevelopment> = null;
        let h = -Infinity;
        for (const fl of schemeFloorLadder(use, floors)) {
          const ui = underwriteDevelopment(s, parcels, bbl, use, fl, plate);
          if (!ui || (!ui.financeable && !ownMoney)) continue;
          // The pencil the order book reads is the street's — the best read
          // any builder in town takes of it, each on its own margin and money
          // (`streetHurdle`), at today's rent: outlooks pick the moment, not
          // the quantity.
          const hi = streetHurdle(s, ui.plan, use, ui.financeable, false);
          if (hi > h) { h = hi; u = ui; }
        }
        // Only clearing pencils. Pushing appetite-zero failures from densify
        // sites diluted the P97 and zeroed whole classes (office went to 0
        // while multifamily stayed live — the order book then starved office).
        if (u) {
          if (h >= 1) scores[use].push(Math.min(3, Math.pow(h, 1.2)));
          hurdles[use].push(h);
        }
      }
      continue;
    }
    if (redevCount >= REDEV_N) continue;
    if (!rec.bldgArea) continue;
    // Same question the wrecking ball asks (tickTeardowns): no birthday, no
    // grade filter — the standing building's value is charged below instead.
    void yrNow;
    // Only sites that can grow housable floor under today's cornice/shortage.
    const leadGuess = rec.class as BuiltClass;
    const infill = cityInfillCap(s, parcels, rec, leadGuess);
    const targetSf = rec.lotArea * cityCoverage(leadGuess) * infill;
    if (targetSf < rec.bldgArea * 1.12) continue;
    chosen.add(bbl);
    redevCount++;
    // Same basis tickTeardowns uses: the higher of the land and the building
    // as it stands (+ demo in plan).
    const opp = redevelopmentBasis(rec, s.econ, gradeOf(s, rec));
    for (const use of BUILT_CLASSES) {
      if (!zonePermits(rec.zoneDist, use, rec.demandScore, s.econ)) continue;
      const plate = cityCoverage(use);
      const floors = Math.min(infill, maxFloorsFor(rec, plate, use));
      // The same height ladder as vacant dirt, among the heights that still
      // add floor over what stands.
      let best = 0;
      let bestH = -Infinity;
      for (const fl of schemeFloorLadder(use, floors)) {
        if (rec.lotArea * plate * fl < rec.bldgArea * 1.08) continue;
        const u = underwriteDevelopment(s, parcels, bbl, use, fl, plate, opp);
        if (u?.clears && u.appetite > best) best = u.appetite;
        if (u && (u.financeable || ownMoney)) bestH = Math.max(bestH, streetHurdle(s, u.plan, use, u.financeable, false));
      }
      if (best > 0) scores[use].push(best);
      // A BUILT-OUT CITY'S SUPPLY PRICE IS ITS REBUILD COST (2026-10-13).
      // `siteHurdle` — the rent at which new space comes, which caps rent in
      // the rent rule (the equilibrium pull) — was read off vacant dirt only.
      // When the dirt ran out the hurdle list went empty, the cap switched
      // off, and a class held under natural vacancy compounded its shortage
      // slope for decades: office at 5% vacancy rose ~5%/yr real with nothing
      // to stop it (seed 1 Metropolis-Frontier, $36 -> $125 real by year 75).
      // Where land is full, the next building is a replacement — bought at
      // what stands there, knocked down, built bigger — so that is the price
      // at which supply comes, and it is the anchor.
      if (Number.isFinite(bestH)) hurdles[use].push(bestH);
    }
  }
  s.econ.sitePencil = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  // THE BUILDABLE SHARE OF THE LEGAL ENVELOPE — one number, so the land market
  // and the crane stop disagreeing about what fits on a lot.
  //
  // `residualScheme` (value.ts) strikes the land residual on farMaxForLocal x
  // envelopeRealisation — the LEGAL envelope — because it is handed only
  // (rec, econ) and cannot see cityInfillCap. But cityInfillCap is what the
  // shovel actually gets, and on this city's best corners it runs 5-8 floors
  // against a legal 17-56. So dirt was priced for a building the city would
  // never permit: measured at year 15 on the prime office lot, land $72.1M
  // ($9,624 per square foot of LAND) struck on a 14-floor scheme while the
  // envelope allowed six. Yield on cost ex-land was 15.0% — the BUILDING was
  // never the problem. That is one quantity, "what can be built here", with
  // two answers, and it is the mechanism behind "supply cannot answer price".
  //
  // This is the median over the same lots the sampler above already walks, so
  // it costs nothing extra, and it is a SHARE rather than a level so it cannot
  // drift with the price level.
  if (infillRatios.length >= 8) {
    const sorted = infillRatios.slice().sort((a, b) => a - b);
    s.econ.infillShare = +sorted[Math.floor(sorted.length / 2)].toFixed(4);
  }
  for (const use of BUILT_CLASSES) {
    const xs = scores[use].sort((a, b) => a - b);
    const at = xs.length ? Math.floor((xs.length - 1) * (36 / 37)) : 0;
    s.econ.sitePencil[use] = xs[at] ?? 0;
    // THE SUPPLY PRICE, AS A DISTANCE. The P97 hurdle of the vacant sites the
    // city would actually examine, including the ones that fail: 0.7 says rent
    // must rise about 40% before anybody builds; 1.0 says somebody is building
    // now. Investors read it (capTargetOf) because it bounds the rent growth
    // they can rationally pay for. Absent when no vacant site permits the use:
    // supply cannot answer at any rent, so nothing bounds the trend.
    const hs = hurdles[use].sort((a, b) => a - b);
    if (!s.econ.siteHurdle) s.econ.siteHurdle = {};
    if (hs.length >= 4) s.econ.siteHurdle[use] = +hs[Math.floor((hs.length - 1) * (36 / 37))].toFixed(4);
    else delete s.econ.siteHurdle[use];
  }
}

/**
 * WHAT AN ANCHOR WILL PAY FOR A BUILDING DESIGNED AROUND IT, over generic new
 * space of the same use on the same corner. A build-to-suit is priced off
 * the developer's cost — rent = what the shell needs to clear its hurdle —
 * and the tenant takes it only while that stays near what the open market
 * would charge it for new space: past that it leases something standing, or
 * builds its own. The premium is the fit (a floor plate, a loading court, a
 * data hall drawn to its operation) plus never moving twice. Estimate, not a
 * fit to any test: BTS deals are widely reported to price at roughly 5-15%
 * over comparable speculative space; this is the middle of that range.
 */
export const BTS_FIT_PREMIUM = 0.10;
/**
 * THE OUTSIDE DATE. A build-to-suit lease is signed before there is a
 * building, so it carries a date by which construction has to start, and the
 * tenant may terminate if it has not. Twelve months is the usual length of
 * that clause; a signature held indefinitely is not one any tenant gives.
 */
export const BTS_START_WINDOW_M = 12;
/**
 * THE TERM YOU SHOP. Build-to-suit paper runs long because the building is
 * drawn around one occupier: 15 years is the short end a lender will treat as
 * a credit lease, and 50 is the long end of ground-up net lease (big-box,
 * distribution, headquarters with the options folded in). The developer names
 * it on the listing; the anchor who signs, signs for it.
 */
export const BTS_TERM_MIN_Y = 15;
export const BTS_TERM_MAX_Y = 50;
export const BTS_TERM_DEFAULT_Y = 20;
export function btsTermY(y: number | undefined): number {
  const t = Math.round(Number.isFinite(y as number) ? (y as number) : BTS_TERM_DEFAULT_Y);
  return Math.max(BTS_TERM_MIN_Y, Math.min(BTS_TERM_MAX_Y, t));
}
/**
 * The annual bump on build-to-suit paper. Long net leases do not sit flat for
 * decades: they step, usually ~10% every five years or 1.5-2.5% a year. A
 * stronger covenant gets the lower step (the same split rollBumpPct uses for
 * ordinary leases, without the slack term — this is fixed before the building exists).
 */
function btsBumpPct(credit: 1 | 2): number {
  return credit === 2 ? 2.0 : 2.5;
}

function btsFitOut(use: BuiltClass): { tiPsf: number; recovery: "nnn" | "base" } {
  return {
    tiPsf: use === "office" ? 35 : use === "retail" ? 24 : 8,
    recovery: use === "office" ? "base" : "nnn",
  };
}

/**
 * THE RENT A BUILD-TO-SUIT HAS TO CARRY, on the listed shell, today.
 *
 *   market   effective rent for new space of this use on this corner
 *   ceiling  what an anchor will pay at most (market x (1 + BTS_FIT_PREMIUM))
 *   need     the rent at which the anchored scheme clears the development
 *            hurdle on this desk — the same planDevelopment, the same land
 *            basis, the same required yield. Infinity when no rent in reach
 *            of the market does it.
 *
 * Anchors used to sign at 78-88% of market whatever the building cost, so a
 * signed build-to-suit was a lower rent on a job that already did not
 * pencil: measured on a live city, at recovery and at peak, zero of ~420
 * vacant lots cleared the hurdle on those terms for any of the three uses.
 * The listing filled and the deal it delivered was one no developer takes.
 */
export function btsRentRead(
  s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass,
  floors: number, coverage: number, credit: 1 | 2 = 2, termY = BTS_TERM_DEFAULT_Y,
): { market: number; ceiling: number; need: number; sf: number } | null {
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, "gmp");
  if (!plan) return null;
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return null;
  const built = { ...rec, class: use, mix: { [use]: 1 }, bldgArea: plan.sf, floors: plan.floors } as never;
  const market = marketRentPsfYr(built, s.econ, "good");
  if (!(market > 0)) return null;
  // THE ANCHOR SIGNS FOR RENTABLE FEET — see the note in mintBtsCommitment.
  const sf = Math.floor(plan.rentable * (plan.mix[use] ?? 1));
  if (sf <= 0) return null;
  const ceiling = market * (1 + BTS_FIT_PREMIUM);
  const fit = btsFitOut(use);
  const hurdleAt = (rentPsf: number) => planDevelopment(s, parcels, bbl, use, floors, coverage, "gmp", undefined, {
    bts: { name: "", sector: "tech", credit, use, sf, rentPsf, termM: btsTermY(termY) * 12,
      tiPsf: fit.tiPsf, recovery: fit.recovery, signedM: s.month },
  })?.hurdleRatio ?? 0;
  // Hurdle rises with the rent. Search a band wide enough to report how far
  // off a hopeless shell is (up to four times market), to the cent.
  let lo = 0, hi = market * 4;
  if (hurdleAt(hi) < 1) return { market, ceiling, need: Infinity, sf };
  for (let i = 0; i < 24 && hi - lo > 0.005; i++) {
    const mid = (lo + hi) / 2;
    if (hurdleAt(mid) >= 1) hi = mid; else lo = mid;
  }
  return { market, ceiling, need: Math.ceil(hi * 100) / 100, sf };
}

/**
 * LIST THE SITE FOR A BUILD-TO-SUIT OCCUPIER.
 *
 * This used to mint a named tenant on the click — a headquarters for free, any
 * month you wanted one. Real BTS is a listing: you put a shell on the street
 * and wait for an anchor whose programme fits. The counterparty arrives
 * through tickBuildToSuit at odds set by demand, hiring and how much space
 * you are asking someone to take, and signs only at a rent that builds it.
 */
export function proposeBuildToSuit(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.62, termYears = BTS_TERM_DEFAULT_Y,
): { s: GameState; err?: string; msg?: string } {
  const termY = btsTermY(termYears);
  if (use !== "office" && use !== "retail" && use !== "industrial") {
    return { s, err: "Build-to-suit is for an office headquarters, anchor retail or an industrial user." };
  }
  if (!s.holdings[bbl]) return { s, err: "Buy the site before shopping it to an occupier." };
  if (s.developments[bbl]) return { s, err: "Construction is already under way." };
  if (s.btsProspects?.[bbl]) {
    return { s, err: "You already have signed terms on this site. Take them or return to spec before shopping it again." };
  }
  if (s.holdings[bbl].sale) return { s, err: "It's on the market — pull the sale listing before you shop it to an occupier." };
  if (s.holdings[bbl].groundOffer) return { s, err: "It is on offer for a ground lease. Pull that before you shop a build-to-suit." };
  if (s.groundLeases?.[bbl]) return { s, err: "That site is ground-leased. Somebody else builds on it." };
  if (s.merged?.[bbl]) return { s, err: "That lot is part of an assemblage — shop the whole site." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class !== "land" || rec.bldgArea > 0) return { s, err: "Build-to-suit starts on clear land." };
  const barred = zoneUseBar(rec, use, s.econ);
  if (barred) return { s, err: barred };
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, "gmp");
  if (!plan) return { s, err: "That programme cannot be built on this site." };
  const next = clone(s);
  const prev = next.holdings[bbl].btsOffer;
  const same = prev
    && prev.use === use
    && prev.floors === plan.floors
    && Math.abs(prev.coverage - coverage) < 0.001
    && btsTermY(prev.termY) === termY;
  next.holdings[bbl].btsOffer = {
    use, floors: plan.floors, coverage, termY, sinceM: same ? prev!.sinceM : next.month,
    ...(same && prev!.lastWalk ? { lastWalk: prev!.lastWalk } : {}),
  };
  return {
    s: next,
    msg: same
      ? "Still on the book — an anchor comes when one comes."
      : `Listed ${plan.floors} fl of ${use} (${Math.round(plan.sf).toLocaleString()} sf) for a ${termY}-year build-to-suit. Now you wait.`,
  };
}

/** Withdraw the BTS listing, or decline signed terms and go back to spec. */
export function clearBuildToSuit(s: GameState, bbl: string): GameState {
  const hadOffer = !!s.holdings[bbl]?.btsOffer;
  const hadProspect = !!s.btsProspects?.[bbl];
  if (!hadOffer && !hadProspect) return s;
  const next = clone(s);
  if (next.holdings[bbl]?.btsOffer) delete next.holdings[bbl].btsOffer;
  dropBtsProspect(next, bbl);
  return next;
}

function dropBtsProspect(s: GameState, bbl: string) {
  if (!s.btsProspects?.[bbl]) return;
  delete s.btsProspects[bbl];
  if (!Object.keys(s.btsProspects).length) delete s.btsProspects;
}

/**
 * An anchor at the table: who they are, and whether the shell's rent and
 * theirs meet. A build-to-suit is priced off cost and the building is new
 * and drawn around them, so it lets at market or better, never at a discount:
 * the developer quotes the larger of market and the rent the job needs
 * (btsRentRead), the anchor takes it if that is within its ceiling, and walks
 * if not. It signs for the term on the listing, from delivery.
 */
function mintBtsCommitment(
  s: GameState, parcels: ParcelTable, bbl: string,
  use: BuiltClass, floors: number, coverage: number, termYears: number,
): { bts: BtsCommitment } | { walked: { name: string; needPsf: number; ceilingPsf: number } } | null {
  const credit = (rng(s, "leasing") < 0.58 ? 2 : 1) as 1 | 2;
  const sector = pickSector(s, use);
  const name = pickName(s, sector);
  const termY = btsTermY(termYears);
  const read = btsRentRead(s, parcels, bbl, use, floors, coverage, credit, termY);
  if (!read) return null;
  if (read.need > read.ceiling) {
    return { walked: { name, needPsf: read.need, ceilingPsf: +read.ceiling.toFixed(2) } };
  }
  const rentPsf = +Math.max(read.market, read.need).toFixed(2);
  // THE ANCHOR SIGNS FOR RENTABLE FEET. This used to be `plan.sf` — GROSS,
  // core and stairs included — so the news told the player "Alden Foods will
  // take 7,400 sf", planDevelopment clipped the commitment to the 6,200
  // rentable feet the shell actually has (proforma's `bts.sf` guard), and the
  // tenant moved in on 6,200: one lease, two sizes, and the rent roll the
  // player was shown was 16% more than the one they got. A lease is measured
  // to the rentable standard (see rentableRatio); the proforma clip is now a
  // guard that does not bind. Floored so the clip cannot shave a rounding foot.
  const fit = btsFitOut(use);
  return {
    bts: {
      name, sector, credit, use,
      sf: read.sf,
      rentPsf,
      termM: termY * 12,
      bumpPct: btsBumpPct(credit),
      tiPsf: fit.tiPsf,
      recovery: fit.recovery,
      signedM: s.month,
      floors, coverage,
      startByM: s.month + BTS_START_WINDOW_M,
    },
  };
}

/**
 * Anchors arrive on BTS listings. Scarce on purpose — a named credit tenant
 * committing before groundbreak is rarer than a speculative lease after delivery,
 * and the button used to pretend otherwise.
 */
export function tickBuildToSuit(s: GameState, parcels: ParcelTable) {
  // SIGNED TERMS ARE A LEASE ON A SITE YOU HOLD, WITH A DATE ON IT. They used
  // to outlive the site — sold, folded into an assemblage, ground-leased away
  // — and to wait for a groundbreak forever.
  for (const [bbl, bts] of Object.entries(s.btsProspects ?? {})) {
    const h = s.holdings[bbl];
    if (!h || s.merged?.[bbl] || s.groundLeases?.[bbl]) {
      dropBtsProspect(s, bbl);
      continue;
    }
    if (bts.startByM !== undefined && s.month > bts.startByM) {
      dropBtsProspect(s, bbl);
      const rec = resolveRec(parcels, s, bbl);
      s.news.unshift({
        q: s.month, kind: "deal",
        text: `${bts.name} has walked from the build-to-suit at ${rec?.address ?? bbl}: the lease gave you until `
          + `${monthLabel(bts.startByM)} to start construction and nothing is in the ground. The site is back on spec.`,
      });
    }
  }
  for (const h of Object.values(s.holdings)) {
    const offer = h.btsOffer;
    if (!offer) continue;
    const rec = resolveRec(parcels, s, h.bbl);
    // The listing dies quietly when the lot stops being shoppable.
    if (!rec || rec.class !== "land" || rec.bldgArea > 0
      || s.developments[h.bbl] || s.merged?.[h.bbl] || h.sale
      || h.groundOffer || s.groundLeases?.[h.bbl]
      || s.btsProspects?.[h.bbl]
      || (s.built?.[h.bbl]?.bldgArea ?? 0) > 0) {
      delete h.btsOffer;
      continue;
    }
    const plan = planDevelopment(s, parcels, h.bbl, offer.use, offer.floors, offer.coverage, "gmp");
    if (!plan) { delete h.btsOffer; continue; }
    const demand = demandNow(s, rec) / 100;
    // Bigger shells need rarer anchors. A 40k pad turns over; a 250k HQ does not.
    const sizeHard = Math.max(0.55, Math.min(2.4, plan.sf / 90_000));
    // An anchor commits to a new building when it is hiring: exp(30 x payroll
    // growth) reads 0.55 at -2%/yr (the old recession) and tops out at 1.1.
    const phaseHit = Math.max(0.45, Math.min(1.1, Math.exp(30 * payrollGrowth12(s.econ))));
    // How often an occupier of this size comes looking. Whether building for
    // it pays is no longer folded in here as the city's value-to-replacement
    // (buildClimate): it is asked of THIS shell, at the table, in
    // mintBtsCommitment — the same fact counted once.
    const p = Math.min(0.09, (0.004 + 0.045 * demand) * phaseHit / sizeHard);
    if (rng(s, "leasing") >= p) continue;
    const met = mintBtsCommitment(s, parcels, h.bbl, offer.use, offer.floors, offer.coverage, btsTermY(offer.termY));
    if (!met) continue;
    if ("walked" in met) {
      const w = met.walked;
      offer.lastWalk = { m: s.month, name: w.name, needPsf: w.needPsf, ceilingPsf: w.ceilingPsf };
      s.news.unshift({
        q: s.month, kind: "deal",
        text: `${w.name} looked at your build-to-suit listing at ${rec.address} and passed. The shell needs `
          + (Number.isFinite(w.needPsf) ? `$${w.needPsf.toFixed(2)}/sf` : "more rent than any tenant pays")
          + ` to clear its hurdle; they will pay $${w.ceilingPsf.toFixed(2)}/sf at most for new ${offer.use} here. `
          + `The listing stays up — a cheaper shell, or a better market, is what closes that gap.`,
      });
      continue;
    }
    const bts = met.bts;
    delete h.btsOffer;
    if (!s.btsProspects) s.btsProspects = {};
    s.btsProspects[h.bbl] = bts;
    const waited = Math.max(1, s.month - offer.sinceM);
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `Build-to-suit at last: ${bts.name} will take ${Math.round(bts.sf).toLocaleString()} sf `
        + `of ${bts.use} at ${rec.address} for ${Math.round(bts.termM / 12)} years from delivery at $${bts.rentPsf.toFixed(2)}/sf, `
        + `${bts.bumpPct}% a year `
        + `(credit ${bts.credit === 2 ? "strong" : "solid"}), after `
        + `${waited >= 24 ? `${Math.round(waited / 12)} years` : `${waited} month${waited === 1 ? "" : "s"}`} on the book. `
        + `Break ground on their ${offer.floors}-storey shell by ${monthLabel(bts.startByM!)} or they walk — `
        + `or send them away and go back to spec.`,
    });
  }
}

/**
 * WHAT A JOB ASKS OF YOUR PURSE — one rule for the desk and the engine.
 *
 * `whole` is the full equity, the origination points and a 6%-of-cost margin
 * for change orders: overruns past the contingency land on the owner under
 * either contract (see the site-risk roll in tickDevelopment), lender or no
 * lender, so an all-cash job carries it too — and on an all-cash job it is
 * 6% of the whole building, not of a thin equity slice. `dayOne` is the
 * closing instalment plus points. The desk used to enable its button on the
 * equity alone while the engine refused on `whole`, so a sponsor with cash
 * for every dollar on the card was turned away by a number the card never
 * showed — and only when they went light on debt, where the margin is big.
 */
export function devFundingNeed(plan: { equity: number; equityAtClose: number; pointsCost: number; costTotal: number }, hedge = 0): {
  whole: number; dayOne: number; margin: number;
} {
  const margin = Math.round(plan.costTotal * 0.06);
  return { whole: plan.equity + plan.pointsCost + margin + hedge, dayOne: plan.equityAtClose + plan.pointsCost + hedge, margin };
}

/**
 * THE TAKEOUT, CHOSEN AT THE GROUNDBREAK (MDGA phase 5).
 *
 * The construction loan rolls into a floating mini-perm at index + 2.1 the
 * month the building delivers (see the takeout in tickDevelopment). Measured:
 * a $5.6M fringe apartment job started in a recession met an index that rose
 * from 8% to 13%, paid 10-15% on a $3.9M balance against $0.2M of NOI, could
 * never refinance, and took the firm with it. Nothing on the desk had said
 * the word "floating".
 *
 * Real construction lenders do not leave that to chance: a floating
 * construction loan above modest leverage closes with an interest-rate cap
 * the borrower buys, or with a forward commitment that fixes the takeout.
 * Both are offered here and priced off the desk's own cap premium:
 *
 *   cap    the index capped at today's index + 1.5 from groundbreak to the
 *          mini-perm's maturity (build months + 60). Premium: the 3-year
 *          cap desk's 1.25% of notional (rateCapCost), scaled by tenor, at
 *          60% for a strike a point further out of the money than the
 *          desk's +0.5 — a shape parameter scaled from the desk, not
 *          calibrated to a vol surface, and said so.
 *   fixed  a forward rate lock: the takeout converts at today's index + 2.1
 *          + 0.75 for the lock's optionality, for a 1% commitment fee.
 *          Forward commitments ran 50-100bp over spot with a 1-2% fee.
 *   float  naked; allowed only at or below 60% of cost.
 */
export const TAKEOUT_CAP_STRIKE_OVER = 1.5;
export const TAKEOUT_LOCK_PREMIUM = 0.75;
export const TAKEOUT_LOCK_FEE = 0.01;
export const TAKEOUT_HEDGE_LTC = 0.6;
export type TakeoutKind = "float" | "cap" | "fixed";
export const MINI_PERM_SPREAD = 2.1;
export function takeoutHedgeCost(plan: { commitment: number; months: number }, kind: TakeoutKind): number {
  if (!(plan.commitment > 0) || kind === "float") return 0;
  if (kind === "fixed") return Math.round(plan.commitment * TAKEOUT_LOCK_FEE);
  const tenor = plan.months + 60;
  return Math.round(plan.commitment * 0.0125 * (tenor / 36) * 0.6);
}
/** Does the construction lender insist on a hedge for this loan? */
export function takeoutHedgeRequired(plan: { commitment: number; ltc: number }): boolean {
  return plan.commitment > 0 && plan.ltc > TAKEOUT_HEDGE_LTC + 1e-9;
}
/**
 * WHAT THE TAKEOUT WILL COST TO CARRY, said before the groundbreak: the
 * mini-perm's rate at today's index under the chosen structure, interest-only
 * debt service on the full commitment, the stabilised DSCR on the plan's NOI,
 * the same with the index 300bp higher, and the plan's finished value over
 * the loan. Read only; the engine's own terms, not a second model.
 */
export function takeoutRead(
  econ: { indexRate: number },
  plan: { commitment: number; stabNoi: number; exitYield: number; months: number },
  kind: TakeoutKind,
): { ratePct: number; stressPct: number; debtSvc: number; dscr: number; dscrStress: number; valueToLoan: number; strike?: number } {
  const idx = econ.indexRate;
  const strike = +(idx + TAKEOUT_CAP_STRIKE_OVER).toFixed(2);
  const at = (i: number) => kind === "fixed" ? idx + MINI_PERM_SPREAD + TAKEOUT_LOCK_PREMIUM
    : kind === "cap" ? Math.min(i, strike) + MINI_PERM_SPREAD
    : i + MINI_PERM_SPREAD;
  const ratePct = +at(idx).toFixed(2);
  const stressPct = +at(idx + 3).toFixed(2);
  const debtSvc = plan.commitment * ratePct / 100;
  const debtStress = plan.commitment * stressPct / 100;
  const value = plan.exitYield > 0 ? plan.stabNoi / (plan.exitYield / 100) : 0;
  return {
    ratePct, stressPct, debtSvc,
    dscr: debtSvc > 0 ? plan.stabNoi / debtSvc : Infinity,
    dscrStress: debtStress > 0 ? plan.stabNoi / debtStress : Infinity,
    valueToLoan: plan.commitment > 0 ? value / plan.commitment : Infinity,
    ...(kind === "cap" ? { strike } : {}),
  };
}

/**
 * WHAT IS STILL OWED ON THE DIRT, AND WHO TAKES IT OUT AT GROUNDBREAK.
 *
 * The construction loan here is sized on the job's own cost (LTC excludes the
 * land), so the site is the sponsor's equity in the deal — and equity goes in
 * unencumbered: no construction lender closes behind somebody else's first
 * lien on the dirt it is lending against. So a land loan is repaid the day
 * ground breaks, as part of the cheque at close. That is the job a land loan
 * actually does — carry a site until it is built on — and its own three-year
 * term says so.
 *
 * It used to stay on the deed through the build. Its balloon could land mid-
 * construction, and on delivery the mini-perm was written straight over it,
 * so whatever was left of it was never repaid by anybody: a liability gone
 * with no cash moving, which is the one fault `pnpm conserve` cannot see.
 */
export function siteDebtAtGroundbreak(s: GameState, bbl: string): { due: number; balance: number; penalty: number; lender?: string } {
  const h = s.holdings[bbl];
  if (!h?.loan && !(h?.mezz && h.mezz.balance > 0)) return { due: 0, balance: 0, penalty: 0 };
  const senior = h.loan ? payOffDue(h.loan, s.month, s.econ) : { balance: 0, penalty: 0, due: 0 };
  const mezz = h.mezz && h.mezz.balance > 0 ? payOffDue(h.mezz, s.month, s.econ) : { balance: 0, penalty: 0, due: 0 };
  return {
    due: senior.due + mezz.due,
    balance: senior.balance + mezz.balance,
    penalty: senior.penalty + mezz.penalty,
    lender: h.loan ? (h.loan.holder ?? productById(h.loan.product).lender) : undefined,
  };
}

/**
 * WHAT THIS JOB IS UNDERWRITTEN TO RETURN, levered, on the desk's own numbers:
 * the site's cost and the equity go in, and the stabilised building is sold
 * at its value on completion (NOI ÷ exit yield), less 2% to sell and the
 * construction loan, a year after delivery (lease-up; a convention, and a
 * shape parameter). All the equity is put in at the start, which understates
 * the IRR a little: the projection a sponsor is judged against is, if
 * anything, conservative. This is the "projected" column of the track-record
 * sheet investors read (reputation.ts) and a syndicate's pitch.
 */
export function projectedDevIrr(plan: DevPlan): number {
  const inn = Math.max(1, plan.landBasis + plan.equity + plan.pointsCost);
  const value = plan.exitYield > 0 ? plan.stabNoi / (plan.exitYield / 100) : 0;
  const out = value * 0.98 - plan.commitment;
  const months = Math.max(1, plan.months + 12);
  return out > 0 ? Math.pow(out / inn, 12 / months) - 1 : -1;
}

/**
 * WHOSE MONEY BREAKS GROUND HERE, AND HOW MUCH OF IT THERE IS. A lot the fund
 * owns is built with the vehicle's cash and uncalled commitments, and only
 * while it is still investing; every other lot with the sponsor's cash and
 * line. The desk's groundbreak button and `startDevelopment` both read this,
 * so the button cannot offer what the engine refuses.
 */
/** A closing cheque from the purse that owns the deed — see `groundbreakPurse`. */
function payFromPurse(next: GameState, parcels: ParcelTable, bbl: string, amt: number, cat: "dev" | "debtSvc", vehicle: boolean): void {
  if (!(amt > 0)) return;
  const f = vehicle ? next.fund : null;
  if (!f) { fundAndBook(next, parcels, amt, cat, { bbl }); return; }
  const call = Math.max(0, Math.min(f.uncalled, amt - Math.max(0, f.cash)));
  if (call > 0) {
    f.uncalled -= call;
    f.called += call;
    moveFundCash(f, call, "call");
    logBooks(next, "lpCalled", call); // LP equity in for this job — not income
  }
  moveFundCash(f, -amt, "build");
  logBooks(next, cat, amt, bbl, true);
}

export function groundbreakPurse(s: GameState, parcels: ParcelTable, bbl: string): { total: number; fund: boolean; closed: string | null } {
  const f = purseOf(s, s.holdings[bbl]) === "fund" ? s.fund ?? null : null;
  if (!f) return { total: fundableNow(s, parcels), fund: false, closed: null };
  const closed = s.month > f.investEndM
    ? "The fund's investment period is over — it can finish and run what it owns, but it cannot start a new job."
    : null;
  return { total: Math.max(0, f.cash) + Math.max(0, f.uncalled), fund: true, closed };
}

export function startDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.6,
  contract: Contract = "gmp", ltcWanted?: number,
  custom?: {
    mix?: UseMix; suites?: Partial<Record<BuiltClass, number>>; bts?: BtsCommitment; groundRetail?: "auto" | "on" | "off"; design?: BuildingDesign; takeout?: TakeoutKind;
    /** Raise `outside` of the job's cash equity from outside investors (syndicate.ts); `sources` says who, when a raise circled it (raise.ts). */
    syndicate?: { outside: number; sources?: Partial<Record<import("./investors").InvestorSource, number>>; clamp?: boolean; pitch?: import("./investors").PitchStyle };
  },
  lender?: string,
  spec = 0.5,
): { s: GameState; err?: string } {
  let outside = Math.max(0, Math.round(custom?.syndicate?.outside ?? 0));
  let synSources = custom?.syndicate?.sources;
  if (outside > 0) { const bar = syndicateBar(s, bbl); if (bar) return { s, err: bar }; }
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.holdings[bbl]) return { s, err: "Buy the dirt first." };
  if (rec.class !== "land") return { s, err: "Clear the site first — demolish what's standing before you build." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  // You cannot break ground on a site you are trying to sell. Somebody is
  // marketing this lot to buyers right now.
  if (s.holdings[bbl].sale) return { s, err: "It's on the market — pull the listing before you put a crane on it." };
  if (s.landmarks?.[bbl] !== undefined) return { s, err: "It is landmarked — the envelope is what is already standing." };
  if (s.groundLeases?.[bbl]) return { s, err: "That site is ground-leased. Somebody else builds on it until the term runs out." };
  if (s.merged?.[bbl]) return { s, err: "That lot is part of an assemblage — build on the site, not the piece." };
  // Same rule, same answer, said before the arithmetic so the refusal names
  // the zoning rather than reading as "too small".
  const barred = zoneUseBar(rec, use, s.econ, devMix(use, custom?.mix),
    Math.min(Math.max(1, Math.round(floors)), maxFloorsFor(rec, coverage, use)));
  if (barred) return { s, err: barred };
  // THE ANCHOR IS THE ONE ON THE BOOK. A commitment comes from the signed
  // terms held against this site (tickBuildToSuit), not from whoever calls
  // this: a caller's copy that is stale — or one nobody signed — builds spec.
  if (custom?.bts) {
    const signed = s.btsProspects?.[bbl];
    custom = { ...custom, bts: signed && signed.name === custom.bts.name && signed.signedM === custom.bts.signedM ? signed : undefined };
  }
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, contract, ltcWanted, custom, lender, spec);
  if (!plan) return { s, err: "That's too small to be worth building — add floors or cover more of the lot." };
  // AND NOTHING UNPRICEABLE CLOSES. planDevelopment refuses a design it cannot
  // draw; this refuses a budget it cannot add up, whatever made it unaddable.
  // Every test below this line is a comparison, and a comparison is exactly
  // what a NaN walks through — so the arithmetic is checked once, here, before
  // any of them run.
  const unpriced = [plan.sf, plan.floors, plan.costTotal, plan.commitment, plan.interestReserve,
    plan.equity, plan.equityAtClose, plan.pointsCost, plan.months, plan.ratePct]
    .some((n) => !Number.isFinite(n));
  if (unpriced) return { s, err: "The numbers on that job do not add up — nobody can price it, so nobody will fund it." };
  // YOU HAVE TO BE ABLE TO FUND THE WHOLE THING.
  //
  // This used to test only the day-one cheque, which is 55% of the equity —
  // so a player with exactly that much could break ground on a job whose
  // remaining 45% was going to be drawn out of an account that did not have
  // it, month after month, while the building went up. That is not a hard
  // decision, it is a trap: the number on the button was not the number, and
  // the rest arrived without warning.
  //
  // No construction lender on earth closes without evidence the sponsor can
  // fund its whole share — that is the first thing they ask for. The line of
  // credit counts, because it is committed money and that is what it is for.
  // THE TAKEOUT HEDGE (MDGA phase 5). A lender that requires one closes with
  // it; a caller that names nothing on such a loan gets the cap, which is what
  // the lender's term sheet says. Float is refused above the threshold.
  const required = takeoutHedgeRequired(plan);
  let takeoutKind: TakeoutKind = custom?.takeout ?? (required ? "cap" : "float");
  if (!(plan.commitment > 0)) takeoutKind = "float";
  if (required && takeoutKind === "float") {
    return { s, err: `The construction lender wants a rate cap or a forward lock on a loan over ${Math.round(TAKEOUT_HEDGE_LTC * 100)}% of cost — floating naked into the mini-perm is not on their term sheet.` };
  }
  const hedgeCost = takeoutHedgeCost(plan, takeoutKind);
  const need = devFundingNeed(plan, hedgeCost);   // equity, points, the hedge, and a margin for change orders
  // The land loan comes off at close (siteDebtAtGroundbreak) — it is part of
  // both the whole-job test and the day-one cheque, because it is cash at the
  // closing table like everything else on it.
  const site = siteDebtAtGroundbreak(s, bbl);
  if (site.due > 0 && s.facility?.bbls.includes(bbl)) {
    return { s, err: "This site is pledged to your facility. Release it there before a construction lender will take first lien." };
  }
  if (site.due > 0) { const why = consentFor(s, s.holdings[bbl], "redevelop"); if (why) return { s, err: why }; }
  const siteNote = site.due > 0 ? ` and the ${money(site.due)} land loan, which the construction lender requires repaid at close` : "";
  const commitCap = need.whole + site.due;
  // A FUND LOT IS BUILT WITH THE FUND'S MONEY (CAPITAL_RAISING_PLAN.md §0.5).
  // The vehicle already paid the monthly draws on its deeds (settleVehicleDeedFlow
  // reimburses the sponsor), but both tests here read the SPONSOR's purse and
  // the day-one cheque was drawn from it first, so a fund with $30M could not
  // break ground on its own lot behind a sponsor holding $3M. The construction
  // lender's evidence-of-funds is the vehicle's cash and uncalled commitments;
  // a new job is a new investment, so only while the fund is still investing.
  const purse = groundbreakPurse(s, parcels, bbl);
  const vehicle = purse.fund ? s.fund ?? null : null;
  if (purse.closed) return { s, err: purse.closed };
  // A SYNDICATED JOB is underwritten on the sponsor's money plus the
  // investors' commitment, which the construction lender counts as equity in
  // the deal. The sponsor contributes the site at its equity (the mark less
  // the land loan this closing repays), and that counts toward the
  // $1-for-$1 rule an Unknown sponsor raises under.
  const landEquity = outside > 0 ? Math.max(0, Math.round(ownedHoldingValue(s, parcels, s.holdings[bbl]) - site.due)) : 0;
  if (outside > 0) {
    const most = maxOutside(s, commitCap, landEquity);
    if (outside > most + 1) {
      // A RAISE CLOSES AT WHAT THE RULES ALLOW (raise.ts). The cap moves
      // while a raise is open — the sponsor's own money in the deal, the
      // network's other commitments — so the closing takes the investors'
      // money up to it, pro rata across who circled, rather than sending
      // everyone home over the excess.
      if (!custom?.syndicate?.clamp || !(most >= 1)) {
        return { s, err: `Friends and family can put at most ${money(most)} into this job — no more than your own money in it, and only what your network has not already committed.` };
      }
      const k = Math.floor(most) / outside;
      outside = Math.floor(most);
      if (synSources) synSources = Object.fromEntries(Object.entries(synSources).map(([id, v]) => [id, Math.floor((v ?? 0) * k)]));
    }
  }
  // Money an open raise on another lot is holding is not this job's
  // (investors.ts heldByRaises): it is spoken for at that raise's closing.
  const fundable = (vehicle ? purse.total : Math.max(0, purse.total - heldByRaises(s, bbl))) + outside;
  const purseWords = vehicle ? "the fund can call" : "you can fund";
  const purseNote = vehicle ? " (its cash and uncalled commitments)" : outside > 0 ? " with your investors' commitment and the line" : " including the line";
  if (fundable < commitCap) {
    const short = commitCap - fundable;
    return {
      s,
      err: `Equity short ${money(short)} to finish this job. `
        + `Needs ${money(plan.equity)} equity all-in (${money(plan.equityAtClose)} at close) `
        + `plus change-order margin${siteNote}; ${purseWords} ${money(fundable)}${purseNote}. `
        + `Cut floors or coverage, buy cash-flowing buildings first, or bring more capital — no lender closes without evidence you can finish.`,
    };
  }
  // AND THE DAY-ONE CHEQUE IS ASKED OF THE SAME PURSE. The whole-job test
  // immediately above already counts the revolver — "it is committed money and
  // that is what it is for" — so measuring the closing instalment against cash
  // alone was the same quantity with two different answers, and the one it
  // gave was the one that stopped a developer who could plainly finish. The
  // 55% at close, the origination points and the change-order margin are all
  // where they were; a job closed on the line simply starts with less room for
  // the capital call that comes at 90% complete, which is the real discipline.
  const dayOne = need.dayOne;
  if (fundable < dayOne + site.due) {
    const short = dayOne + site.due - fundable;
    return {
      s,
      err: `Equity short ${money(short)} at close. `
        + `The bank funds nothing until ${money(dayOne)} is in the ground (equity plus origination) `
        + `of ${money((plan.equity + plan.pointsCost))} total${siteNote}. Cut the massing or raise cash first.`,
    };
  }
  const next = clone(s);
  // Every closing cheque comes out of the purse that owns the deed: the
  // sponsor's (cash, then the line), or the vehicle's (cash, then a call on
  // uncalled commitments), booked as the vehicle's own movement.
  const payAtClose = (amt: number, cat: "dev" | "debtSvc") => payFromPurse(next, parcels, bbl, amt, cat, !!vehicle);
  // The origination fee is the lender's, paid at close and never part of the
  // job's own budget — folding it into the prefund would hand it back later as
  // free construction money.
  // THE SYNDICATE IS FORMED AT THE CLOSE: its record exists before the
  // closing cheques are booked, so they are the deal's first flows, and it
  // settles before the closing ends, so the investors' share of the cheque
  // is called today. `bridge` is their share fronted for the minutes between
  // the two, so the sponsor's line is not drawn for money already committed;
  // it nets to zero inside this function and books nothing.
  let bridge = 0;
  // The job's projection is the plan the sponsor will be judged against.
  const projected = projectedDevIrr(plan);
  if (next.deedCf?.[bbl]) next.deedCf[bbl].plan = { irr: projected };
  if (outside > 0) {
    const w = formSyndication(next, bbl, outside, commitCap, landEquity, synSources);
    // Investors are pitched their own net IRR — the projection after the
    // promote this band's terms take (waterfall.ts lpNetIrr) — and judged on it.
    // ...as the sponsor chose to pitch it (investors.ts PITCH_MULT; conservative unless told otherwise).
    w.pitchIrr = lpNetIrr(projected, Math.max(1, plan.months + 12) / 12, w.hurdles, w.promotes) * PITCH_MULT[custom?.syndicate?.pitch ?? "conservative"];
    // What the offering pitched, for the quarterly reports (reviewSyndications).
    w.pitchDeliverM = next.month + plan.months;
    w.pitchNoi = plan.stabNoi;
    bridge = Math.min(outside, Math.round(w.lpShare * (dayOne + Math.max(0, site.due))));
    next.cash += bridge;
  }
  payAtClose(dayOne - hedgeCost, "dev");
  // the hedge is a financing cost, booked as such, paid at the close
  if (hedgeCost > 0) payAtClose(hedgeCost, "debtSvc");
  if (site.due > 0) {
    // Retired the way payOffLoan retires a mortgage: principal and any break
    // fee, booked as debt service, lien released.
    payAtClose(site.due, "debtSvc");
    const nh = next.holdings[bbl];
    nh.loan = null;
    if (nh.mezz) nh.mezz = null;
    if (site.lender) bumpLenderRel(next, site.lender, 0.5);
    next.news.unshift({
      q: next.month, kind: "info",
      text: `The land loan on ${rec.address} — ${money(site.balance)}${site.penalty > 0 ? ` plus ${money(site.penalty)} to break it` : ""} — `
        + `was repaid at the construction closing. The construction lender takes first lien on the site.`,
    });
  }
  if (plan.commitment > 0) bumpLenderRel(next, plan.lender, 2);   // a closed loan starts a file
  noteRecordPlan(next, parcels, bbl, dominantOf(plan.mix), plan.sf, plan.floors, firmShort(next));
  // YOUR CRANE IS IN THE SAME SKY AS EVERYBODY ELSE'S. A city job enters
  // econ.cohorts the month the hole is dug (tickCityGrowth), and a rival's own
  // job does too (startOwnJob) — but the player's never did. Two million
  // square feet of your office appeared in no delivery schedule, moved no
  // projected vacancy, and then landed on the market as a surprise the month
  // it opened. Same queue as everyone now, tagged with the parcel so a
  // schedule slip can move it and an abandoned job can pull it back out; and
  // it fills part of the order the space market has already placed
  // (startOwed), exactly as an anonymous start on the same corner would have.
  const playerProgramme = programmeSf(rentableFromSpec(plan.sf, plan.floors), plan.mix);
  queueSupplyProject(next, {
    bbl,
    source: "player",
    deliverM: next.month + plan.months,
    sfByUse: playerProgramme,
  });
  for (const [u, usf] of Object.entries(playerProgramme)) {
    if (next.econ.startOwed) {
      next.econ.startOwed[u as BuiltClass] = Math.max(0, (next.econ.startOwed[u as BuiltClass] ?? 0) - usf);
    }
  }
  next.developments[bbl] = {
    landMark: Math.round(ownedHoldingValue(s, parcels, s.holdings[bbl])),
    spec: plan.spec,
    bbl, use, mix: plan.mix, sf: plan.sf, floors: plan.floors,
    coverage: plan.coverage,
    costTotal: plan.costTotal, hardCost: plan.hardCost, contract,
    landBasis: plan.landBasis,
    contingency: plan.contingency, contingencyUsed: 0,
    lender: plan.lender,
    commitment: plan.commitment, drawn: 0, loanBalance: 0,
    interestReserve: plan.interestReserve, reserveUsed: 0,
    leaseUpReserve: plan.leaseUp,
    equityBudget: plan.equity, equitySpent: plan.equityAtClose,
    // paid on day one, not yet applied against any work
    equityPrefunded: plan.equityAtClose,
    ...(takeoutKind === "cap"
      ? { takeout: { kind: "cap" as const, strike: +(next.econ.indexRate + TAKEOUT_CAP_STRIKE_OVER).toFixed(2), expiresM: next.month + plan.months + 60 } }
      : takeoutKind === "fixed"
        ? { takeout: { kind: "fixed" as const, ratePct: +(next.econ.indexRate + MINI_PERM_SPREAD + TAKEOUT_LOCK_PREMIUM).toFixed(2) } }
        : {}),
    ratePct: plan.ratePct,
    startM: next.month, deliverM: next.month + plan.months, baseMonths: plan.months,
    piped: true,   // its cohort is in the market's queue, pushed above
    signed: [],
    bts: plan.bts,
    events: 0,
    // the look is the player's; nothing priced reads it
    ...(custom?.design ? { design: { ...custom.design } } : {}),
  } satisfies Development;
  dropBtsProspect(next, bbl);
  if (next.holdings[bbl]?.btsOffer) delete next.holdings[bbl].btsOffer;
  recordPropertyEvent(next, bbl, {
    kind: "build-start",
    use,
    sf: plan.sf,
    floors: plan.floors,
    party: firmShort(next),
  });
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Ground broken at ${rec.address}: ${plan.floors} floors, ${(plan.sf / 1000).toFixed(0)}k sf of ${use === "mixed" ? "mixed-use" : use} at ${plan.far} FAR on a ${contract === "gmp" ? "guaranteed max price" : "cost-plus"} contract. $${(plan.costTotal / 1e6).toFixed(1)}M budget, ${(plan.ltc * 100).toFixed(0)}% funded by ${plan.lender}, ${plan.bts ? `for ${plan.bts.name} on a ${Math.round(plan.bts.termM / 12)}-year build-to-suit` : "on spec"}. Delivery ${monthLabel(next.month + plan.months)}.`,
  });
  if (outside > 0) {
    settleSyndications(next, parcels, false, bbl);
    next.cash -= bridge;
    const w = next.syndications![bbl];
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `${w.investor} are in: ${money(w.lpCommit)} committed to ${rec.address}, ${Math.round(w.lpShare * 100)}% of every equity call, `
        + `on a ${Math.round(w.hurdles[0] * 100)}% preferred return. You put in the site and the rest, and you guarantee completion — `
        + `an overrun past their commitment is yours alone.`,
    });
  }
  return { s: next };
}

/**
 * YOU BOUGHT SOMEBODY ELSE'S HALF-FINISHED BUILDING.
 *
 * The frame is up, the sponsor is gone, and the receiver has taken your money
 * for the site and the steel on it. What you inherit is a job in progress: the
 * schedule that is left, the cost that is left, and a design you did not draw.
 * This is the cheapest way to own a new building and the reason a developer
 * watches the obituaries — and until the street could actually fail mid-job,
 * the game had no way to put one in front of you.
 *
 * Called from the closing, not by the player: buying the site IS taking the
 * job on. Mutates in place; the caller already cloned.
 */
/**
 * WHAT TAKING OVER A STALLED JOB COSTS ITS NEW OWNER IN EQUITY — the cost to
 * finish plus lease-up, less the takeover lender's smaller, dearer
 * commitment, plus the change-order margin any job must be able to fund.
 * The purchase is refused below it (actions.ts executePurchase): no
 * construction lender lets a buyer take the job on without evidence it can
 * finish it, the same test a groundbreaking passes.
 */
export function takeoverEquityNeed(
  s: GameState, parcels: ParcelTable, bbl: string,
  half: { use: string; sf: number; floors: number; progress: number; costToComplete: number },
): number {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea) return 0;
  const floors = Math.max(1, Math.round(half.floors));
  const coverage = Math.max(0.08, Math.min(0.9, half.sf / Math.max(1, rec.lotArea * floors)));
  const plan = planDevelopment(s, parcels, bbl, half.use as DevUse, floors, coverage, "gmp", undefined, { vested: true, shell: true });
  if (!plan) return 0;
  const remaining = Math.max(0, Math.round(half.costToComplete)) + plan.leaseUp;
  const commitment = Math.round(remaining * Math.max(0.35, plan.ltc - 0.12));
  return Math.max(0, remaining - commitment) + Math.round(remaining * 0.06);
}

export function takeoverDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string,
  half: { use: string; sf: number; floors: number; progress: number; costToComplete: number },
) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea || s.developments[bbl]) return;
  const use = half.use as DevUse;
  const floors = Math.max(1, Math.round(half.floors));
  const coverage = Math.max(0.08, Math.min(0.9, half.sf / Math.max(1, rec.lotArea * floors)));
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, "gmp", undefined, { vested: true, shell: true });
  if (!plan) return;
  const done = Math.max(0, Math.min(0.95, half.progress));
  // What is left to build, plus the lease-up money — which the dead sponsor's
  // budget no longer contains, because they spent it staying alive.
  const remaining = Math.max(0, Math.round(half.costToComplete)) + plan.leaseUp;
  const months = Math.max(3, Math.round(plan.months * (1 - done)) + 2);   // a stalled job restarts slowly
  // A takeover is financed, but not on construction-loan terms: the lender is
  // pricing a job somebody already failed at, so less of it and dearer.
  const commitment = Math.round(remaining * Math.max(0.35, plan.ltc - 0.12));
  s.developments[bbl] = {
    bbl, use, mix: plan.mix, sf: half.sf, floors,
    costTotal: remaining, hardCost: Math.round(remaining * 0.8), contract: "gmp",
    // A takeover buys the frame; what the buyer paid for the site IS their land basis.
    landBasis: s.holdings[bbl]?.costBasis ?? plan.landBasis,
    contingency: Math.round(remaining * CONTINGENCY), contingencyUsed: 0,
    commitment, drawn: 0, loanBalance: 0,
    interestReserve: Math.round(commitment * 0.05), reserveUsed: 0,
    leaseUpReserve: plan.leaseUp,
    equityBudget: Math.max(0, remaining - commitment), equitySpent: 0,
    equityPrefunded: 0,   // a takeover writes no cheque at close
    ratePct: +(s.econ.indexRate + 3.2).toFixed(2),
    startM: s.month, deliverM: s.month + months, baseMonths: months,
    // the dead sponsor's start already queued this building's square feet in
    // deliveryQueue; reschedule to the takeover finish date.
    piped: true,
    signed: [],
    events: 0,
  } satisfies Development;
  rescheduleSupplyProject(s, bbl, s.month + months);
  s.cityJobs = (s.cityJobs ?? []).filter((j) => j.bbl !== bbl);
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `You have taken over the job at ${rec.address} — ${(done * 100).toFixed(0)}% built, `
      + `$${(remaining / 1e6).toFixed(1)}M to finish and open, delivery ${monthLabel(s.month + months)}. `
      + `Somebody else paid for the hole in the ground.`,
  });
}

// Take a building down to clean dirt. The rubble costs real money, but a
// three-storey walk-up on a site that carries thirty floors is worth more as
// a hole in the ground.
export function demolitionCost(rec: { bldgArea: number }, s: GameState): number {
  return Math.round(Math.max(60_000, rec.bldgArea * 14 * s.econ.costIdx));
}

export function demolish(s: GameState, parcels: ParcelTable, bbl: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  if (h.groundLeased || s.groundLeases?.[bbl]) {
    return { s, err: "The ground lessee controls the improvement. You cannot demolish their building." };
  }
  { const why = consentFor(s, h, "redevelop"); if (why) return { s, err: why }; }
  if (h.groundRentOut) return { s, err: "You sold the land under this building — the fee owner's consent is not on offer. Buy the land back first." };
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "There's nothing standing on it." };
  if (s.landmarks?.[bbl] !== undefined) return { s, err: "It is landmarked. Nobody knocks that down, including you." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  if (h.sale) return { s, err: "It's on the market — pull the listing first." };
  if (h.loan || (h.mezz?.balance ?? 0) > 0) {
    return { s, err: "Pay off the mortgage first — nobody demolishes under a lien." };
  }
  // OCCUPIED SPACE IS OCCUPIED SPACE — including the flats, which this used to
  // ignore entirely, so a full apartment block with no commercial roll could be
  // knocked down with people living in it.
  const leased = h.tenants.reduce((sum, t) => sum + t.sf, 0)
    + useRentableSf(rec, "multifamily") * (h.occ ?? 0);
  if (leased / Math.max(1, rentableSf(rec)) > 0.2) {
    return {
      s,
      err: "You can't demolish over occupied space. Stop letting it and wait the roll out, or buy the leases out — both are on the leasing desk.",
    };
  }
  const cost = demolitionCost(rec, s);
  // Clearing a site is the first line of a development budget, and a developer
  // with an open line does not leave a dead building standing because the
  // operating account is light this month. Everything that guards this action
  // is upstream and untouched — no lien, no landmark, no occupied space, and
  // the site is dirt with no income afterwards, which is the real cost.
  const liq = spendable(s, parcels);
  if (liq.total < cost) {
    return {
      s,
      err: `Demolition runs ${money(cost)} and you can raise ${money(liq.total)} — `
        + `${money(liq.cash)} of cash and ${money(liq.line)} on the line.`,
    };
  }
  const next = clone(s);
  fundAndBook(next, parcels, cost, "capex", { bbl });
  next.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  const nh = next.holdings[bbl];
  // A demolished building's tenants are gone, and their deposits go back.
  moveDeposit(next, nh, -depositsOn(nh));
  nh.tenants = [];
  delete nh.occ;
  delete nh.makeReady;
  delete nh.deliveredM;
  delete nh.shellSf;
  // The hold emptied the building that is gone; dirt has nothing to stop letting.
  delete nh.leasingHold;
  nh.condition = "standard";
  nh.lastCapM = s.month;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${rec.address} came down — ${money(cost)} to clear it. The site is dirt again.`,
  });
  return { s: next };
}

/**
 * ONE MONTH OF CONSTRUCTION.
 *
 * A job is not a timer with a cheque at the end. Money goes out on an S-curve
 * — slow while the hole is dug, fast through the structure, slow through
 * fit-out — and the bank funds its share against work actually in place, after
 * your equity is in. Interest runs on what has been drawn and is paid from a
 * reserve inside the loan until the reserve is gone, and then it is your
 * problem. Costs move under you unless you bought a guaranteed price. And
 * things go wrong on their own schedule, not at a convenient midpoint.
 */
/**
 * REPLACING A FACILITY THAT DIED WITH ITS BANK.
 *
 * The only way off a repudiated construction loan is another desk, and what
 * that desk is buying is not a business plan — it is a half-finished building
 * with a receiver's lien on it. So it underwrites the whole job at its own
 * advance rate against total cost, uses the first draw to retire the
 * receiver's balance so it holds a clean first lien, and what is left over is
 * the money to finish. If its advance rate on the whole cost does not clear
 * the balance already outstanding, there is no deal at any price — which is
 * why a job that overran BEFORE its bank failed is usually the one that never
 * comes back.
 *
 * Nothing here rolls a die on whether a rescue "happens". The desks are the
 * same three desks, their appetite is the same appetite off the same capital,
 * and a market that has just seized a bank is a market where two of the three
 * have stopped quoting. The only thing drawn is how long the paperwork takes,
 * and that is drawn once, at repudiation.
 */
function tickRepudiation(s: GameState, d: Development, rec: { address: string }, progress: number) {
  const monthsLeft = Math.max(2, d.deliverM - s.month);
  const open = constructionQuotes(s, d.mix ?? devMix(d.use), d.costTotal)
    .filter((q) => q.open && q.lender !== (d.lender ?? CONSTRUCTION_LENDER))
    .sort((a, b) => a.ratePct - b.ratePct);

  // WHAT IT STILL COSTS TO GET A BUILDING OUT OF THIS. The S-curve has spent
  // `progress` of the construction budget; the lease-up reserve has not been
  // touched and is still ahead of the job.
  const toComplete = Math.max(0, d.costTotal - (d.leaseUpReserve ?? 0)) * (1 - progress) + (d.leaseUpReserve ?? 0);
  const equityLeft = Math.max(0, d.equityBudget - d.equitySpent) + (d.equityPrefunded ?? 0);

  let deal: { q: ConstructionQuote; gross: number; reserve: number } | undefined;
  let short = false;
  for (const q of open) {
    const gross = q.ltcMax * d.costTotal;
    const reserve = reserveFor(gross, q.ratePct, monthsLeft);
    // It has to take the receiver out AND carry itself to delivery before a
    // single dollar of it buys any steel.
    if (gross <= d.loanBalance + reserve) continue;
    // AND SOURCES HAVE TO MEET USES. This is the first test on any
    // construction loan and it was missing here: the hometown bank stops at a
    // $9M hold, and without this it would happily "rescue" a $330M job with
    // $4M of new money — a facility that pays points, retires the receiver,
    // and still leaves the building unfinished. Neither side signs that. The
    // borrower's own cash counts, because a developer with money in the bank
    // genuinely can finish a job that the bank alone cannot.
    const newMoney = gross - reserve - d.loanBalance;
    // CASH ONLY, AND IT IS THE LENDER'S TEST RATHER THAN YOURS. This is a
    // rescue desk underwriting sources against uses on a half-built job whose
    // last bank walked. A credit committee counts equity in hand; it does not
    // count an unsecured corporate revolver sized off a net worth that this
    // very job is in the middle of destroying, and it certainly does not
    // count room the borrower could draw and spend elsewhere tomorrow. The
    // borrower is free to draw the line and hold the cash — that is what
    // makes this pass — but the line is not a source on somebody else's
    // credit memo.
    if (newMoney + equityLeft + Math.max(0, s.cash) < toComplete) { short = true; continue; }
    deal = { q, gross, reserve };
    break;
  }

  if (!deal) {
    // Report it, but not every month — the borrower already knows.
    if ((s.month - (d.repudiatedM ?? s.month)) % 6 === 0 && s.holdings[d.bbl]) {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: short
          ? `The desks will look at ${rec.address} and none of them will write enough. The job is `
            + `${(progress * 100).toFixed(0)}% built, $${(d.loanBalance / 1e6).toFixed(1)}M is owed to a receiver and `
            + `$${(toComplete / 1e6).toFixed(1)}M of cost is still ahead of it — a facility that does not cover both `
            + `buys nobody a building. Find the difference or find a partner.`
          : `Nobody will refinance ${rec.address}. The job is ${(progress * 100).toFixed(0)}% built with `
            + `$${(d.loanBalance / 1e6).toFixed(1)}M outstanding to a receiver, and no desk in town is quoting `
            + `against that at any price. Until one is, every dollar of work in place is yours.`,
      });
    }
    return;
  }

  const { q, gross, reserve } = deal;
  const payoff = d.loanBalance;
  const points = Math.round(gross * q.points);
  // Points are cash at close, exactly as they were the first time.
  s.cash -= points;
  logBooks(s, "dev", points, d.bbl);
  // The takeout itself never touches the borrower's account: the new desk pays
  // the receiver directly and books the same number as its own first draw.
  d.commitment = Math.round(gross);
  d.interestReserve = Math.round(reserve);
  d.reserveUsed = 0;
  d.drawn = Math.round(payoff);
  d.loanBalance = Math.round(payoff);
  d.ratePct = q.ratePct;
  d.lender = q.lender;
  delete d.repudiatedM;
  delete d.replaceM;
  bumpLenderRel(s, q.lender, 3);   // you are their borrower now, and they took a job nobody wanted

  const toBuild = Math.round(gross - reserve - payoff);
  if (s.holdings[d.bbl]) {
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `${q.lender} has refinanced ${rec.address} at ${q.ratePct.toFixed(2)}% — $${(gross / 1e6).toFixed(1)}M, of which `
        + `$${(payoff / 1e6).toFixed(1)}M goes straight to the receiver and $${(toBuild / 1e6).toFixed(1)}M is left to finish with. `
        + `$${(points / 1e3).toFixed(0)}k of points, and a coupon you would not have signed a year ago. The crane turns again.`,
    });
  }
}

export function tickDevelopments(s: GameState, parcels: ParcelTable) {
  for (const d of Object.values(s.developments)) {
    const rec = parcels[d.bbl];
    if (!rec || !s.holdings[d.bbl]) {
      // The job dies with the deed — pull its square feet back out of the
      // pipeline too, or the market absorbs a building nobody is building.
      cancelSupplyProject(s, d.bbl);
      // A conversion retires the old shell from economic stock at start. If
      // the project dies before delivery, that standing shell still exists and
      // must return to the market rather than vanish with the cancelled queue.
      if (d.mode === "reuse" && d.reuseFrom && d.reuseOldSf) {
        for (const [use, share] of Object.entries(d.reuseFrom)) {
          if ((share ?? 0) > 0) addStock(s.econ, use as BuiltClass, d.reuseOldSf * (share ?? 0));
        }
      }
      delete s.developments[d.bbl];
      continue;
    }
    // SELF-HEAL, once, for jobs in flight from saves written before player
    // starts entered the pipeline: register the square feet now, tagged. New
    // jobs are marked at the desk (startDevelopment) or already covered by
    // their original sponsor's cohort (takeoverDevelopment). If the schedule
    // is already due, the cohort matures on the next econ tick — deliver() no
    // longer adds stock itself, so it still lands exactly once.
    if (!d.piped) {
      d.piped = true;
      queueSupplyProject(s, {
        bbl: d.bbl,
        source: d.mode === "reuse" ? "reuse" : "player",
        startM: d.startM,
        deliverM: d.deliverM,
        sfByUse: programmeSf(rentableFromSpec(d.sf, d.floors), d.mix ?? devMix(d.use)),
      });
    }
    const span = Math.max(1, d.deliverM - d.startM);
    const t0 = Math.max(0, Math.min(1, (s.month - 1 - d.startM) / span));
    const t1 = Math.max(0, Math.min(1, (s.month - d.startM) / span));
    // the classic S-curve of spend against time
    const curve = (t: number) => t * t * (3 - 2 * t);
    // The lease-up reserve is in the budget and financed with everything else,
    // but it is NOT construction spend — it does not buy steel, it buys
    // tenants, and it is released at delivery. Pouring it into the S-curve is
    // why a developer arrived at handover with an empty building and no money
    // to fit anybody out: the reserve existed on the pro forma and had already
    // been spent on the building it was supposed to fill.
    const buildSpend = Math.max(0, d.costTotal - (d.leaseUpReserve ?? 0));
    // SPEND IS BUDGET × PROGRESS LESS WHAT IS ALREADY OUT, not this month's
    // slice of the curve. The slice was recomputed against today's schedule
    // and budget, so a delay that pushed delivery out re-paid part of the curve
    // (5-15% of the job on a mid-build slip, surfacing later as a capital call
    // on a GMP job), and an overrun added to the budget was only ever paid on
    // the months still to come though the news said all of it lands on you.
    // Old saves start from the curve's own reading of last month.
    const spentSoFar = d.buildSpent ?? Math.round(buildSpend * curve(t0));
    const spendNow = Math.max(0, Math.round(buildSpend * curve(t1)) - spentSoFar);
    d.buildSpent = spentSoFar + spendNow;

    // FINDING A DESK THAT WILL TAKE THE JOB OUT. See repudiateCommitments in
    // lenders.ts for how the job got here.
    if (d.repudiatedM !== undefined && s.month >= (d.replaceM ?? 0)) {
      tickRepudiation(s, d, rec, curve(t1));
    }

    if (spendNow > 0) {
      // THE CHEQUE YOU ALREADY WROTE PAYS FIRST, and it costs nothing further.
      // Without this the S-curve spent the full build cost ON TOP of the
      // day-one equity, and the gap surfaced as a silent capital call at 90%
      // complete — the single worst bug in the game, because it emptied your
      // account in the three months before a building you were about to have
      // to fit out.
      const fromPre = Math.min(d.equityPrefunded ?? 0, spendNow);
      d.equityPrefunded = (d.equityPrefunded ?? 0) - fromPre;
      const rest = spendNow - fromPre;
      // equity next, to the extent any is left; the bank funds the remainder
      const equityLeft = Math.max(0, d.equityBudget - d.equitySpent);
      const fromEquity = Math.min(equityLeft, rest);
      // the loan's construction bucket is the commitment LESS the reserve it
      // is holding back for its own interest; interest draws are tracked in
      // reserveUsed, so construction-to-date is drawn minus that.
      // A REPUDIATED FACILITY HAS NO ROOM IN IT. The commitment is still on
      // the books of a receiver who will not fund it, so every dollar of work
      // in place falls through to the borrower as a capital call — which is
      // exactly what a developer whose bank failed woke up to.
      const hardRoom = d.repudiatedM !== undefined
        ? 0
        : Math.max(0, (d.commitment - d.interestReserve) - (d.drawn - d.reserveUsed));
      const fromLoan = Math.min(hardRoom, rest - fromEquity);
      const unfunded = rest - fromEquity - fromLoan;
      d.equitySpent += fromEquity;
      d.drawn += fromLoan;
      d.loanBalance += fromLoan;
      // anything neither side will fund is a capital call, today. On a job that
      // runs to plan this is now zero; it fires for overruns, which is what a
      // capital call is actually for.
      s.cash -= fromEquity + unfunded;
      logBooks(s, "dev", fromEquity + unfunded, d.bbl);
      // A syndicated job pays its sponsor a development fee on the month's
      // construction spend (syndicate.ts, at the band's signed rate).
      chargeDevFee(s, d.bbl, spendNow);
      if (unfunded > 0) {
        d.equitySpent += unfunded;
        d.lastCapitalCall = unfunded;
        d.lastCapitalCallM = s.month;
        s.news.unshift({
          q: s.month,
          kind: "warn",
          text: `${rec.address} called ${unfunded >= 1_000_000
            ? `$${(unfunded / 1_000_000).toFixed(2)}M`
            : `$${Math.round(unfunded / 1000)}K`} of additional equity this month. `
            + `The construction budget has outrun its remaining equity and loan commitment; cash funded the gap.`,
        });
      }
    }

    // INTEREST, AND WHO PAYS IT BEFORE THE BUILDING OPENS. Nobody. It accrues
    // on the drawn balance, capitalises into the loan, and is advanced by the
    // lender out of the reserve it sized for exactly this. Not one dollar of
    // the player's cash leaves for construction carry, which is how these are
    // structured: the whole balance, interest included, is taken out by the
    // perm lender at delivery.
    //
    // If the schedule slips far enough to exhaust the reserve, the lender
    // re-sizes it rather than calling the borrower — it wants the building
    // finished at least as much as you do — and it charges for the privilege
    // by adding it to the balance you have to refinance.
    if (d.loanBalance > 0 && d.repudiatedM !== undefined) {
      // A RECEIVER TAKES INTEREST AND ADVANCES NOTHING. The reserve that was
      // paying this carry lived inside the commitment, and the commitment is
      // dead — so the loan stops paying its own interest and the borrower
      // starts. It does not capitalise, because nobody is lending it: it is a
      // cheque, every month, on a building that is not earning anything yet.
      // On a $40M job at 9% that is $300k a month against no income, which is
      // the number that actually ended developers.
      const interest = Math.round((d.loanBalance * d.ratePct) / 100 / 12);
      s.cash -= interest;
      logBooks(s, "debtSvc", interest, d.bbl);
    } else if (d.loanBalance > 0) {
      const interest = Math.round((d.loanBalance * d.ratePct) / 100 / 12);
      if (d.reserveUsed + interest > d.interestReserve) {
        const extra = Math.round(reserveFor(d.commitment, d.ratePct, Math.max(3, d.deliverM - s.month)) * 0.5) + interest;
        d.interestReserve += extra;
        d.commitment += extra;
        s.news.unshift({
          q: s.month, kind: "info",
          text: `The schedule at ${rec.address} has run past its interest reserve. The lender topped it up — it goes on the balance the takeout has to cover, not on your cheque book.`,
        });
      }
      d.reserveUsed += interest;
      d.loanBalance += interest;   // capitalised, repaid by the mini-perm
      d.drawn += interest;         // and it is a draw against the commitment
    }

    // COST ESCALATION. Under cost-plus the unspent balance of the job moves
    // with the market; under a guaranteed maximum price it does not, and that
    // is what the four-point premium bought.
    if (d.contract === "costplus" && s.month > d.startM) {
      const remaining = Math.max(0, d.hardCost * (1 - curve(t1)));
      // Cost-plus carries what the trades are actually charging this month —
      // the market's own cost index move — not a label's guess at it.
      const hc = s.econ.history ?? [];
      const prevCost = hc.length ? hc[hc.length - 1]?.costIdx : undefined;
      const drift = (prevCost ? s.econ.costIdx / prevCost - 1 : 0) + rrange(s, -0.0008, 0.0008, "dev");
      const escal = Math.round(remaining * drift);
      if (escal > 0) { d.costTotal += escal; d.hardCost += escal; d.equityBudget += escal; }
    }

    // SITE RISK, month by month. Each is rare; a two-year job runs the gauntlet
    // twenty-odd times, which is why schedules slip and budgets grow.
    const progress = curve(t1);
    if (progress > 0.04 && progress < 0.97) {
      const roll = rng(s, "dev");
      const gmpShield = d.contract === "gmp" ? 0.35 : 1;   // the GC eats most of it
      if (roll < 0.028 * gmpShield) {
        // change order
        const bump = rrange(s, 0.015, 0.07, "dev");
        const extra = Math.round(d.costTotal * bump);
        const fromContingency = Math.min(Math.max(0, d.contingency - d.contingencyUsed), extra);
        d.contingencyUsed += fromContingency;
        const overrun = extra - fromContingency;
        d.costTotal += overrun;
        d.hardCost += overrun;
        d.equityBudget += overrun;
        d.events++;
        s.news.unshift({
          q: s.month, kind: overrun > 0 ? "warn" : "info",
          text: overrun > 0
            ? `Change orders at ${rec.address}: ${money(extra)}, of which ${money(overrun)} is past the contingency and lands on you.`
            : `Change orders at ${rec.address}: ${money(extra)}, absorbed by the contingency.`,
        });
      } else if (roll < 0.055) {
        d.deliverM += 1 + Math.round(rng(s, "dev"));
        syncDevCohorts(s, d);
        d.events++;
        s.news.unshift({ q: s.month, kind: "warn", text: `Weather and inspections at ${rec.address} — delivery moves to ${monthLabel(d.deliverM)}.` });
      } else if (roll < 0.062) {
        // a sub goes under: time AND money, and the GMP does not help much.
        // Pre-qualification is most of what stops this one, which is why the
        // manager's multiplier reaches it where the GMP barely does.
        const extra = Math.round(d.costTotal * rrange(s, 0.03, 0.09, "dev"));
        const fromContingency = Math.min(Math.max(0, d.contingency - d.contingencyUsed), extra);
        d.contingencyUsed += fromContingency;
        const overrun = extra - fromContingency;
        d.costTotal += overrun; d.hardCost += overrun; d.equityBudget += overrun;
        d.deliverM += 2 + Math.round(rng(s, "dev") * 3);
        syncDevCohorts(s, d);
        d.events++;
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `A subcontractor at ${rec.address} defaulted. Re-tendering costs ${money(extra)} and pushes delivery to ${monthLabel(d.deliverM)}.`,
        });
      }
    }

    if (s.month >= d.deliverM) deliver(s, parcels, d, rec);
  }
}

/**
 * LEASING A BUILDING THAT DOES NOT EXIST YET.
 *
 * This is the mechanic that replaces pre-letting, and it is the one that
 * actually happens. Nobody signs against a drawing, but once the structure is
 * up and a tenant can walk a floor, space in a building with a delivery date
 * lets perfectly well — at a discount, because the tenant is carrying the risk
 * that you are late, and that discount narrows as the date gets close.
 *
 * It makes the whole development arc a live decision instead of a wait. A job
 * started into a strong market and delivered into a weak one lets nothing on
 * the way up and opens empty against a mini-perm clock; one whose market holds
 * opens half-full and covers itself from month one.
 */
/**
 * HOW MUCH OF A BUILDING IS SPOKEN FOR ON THE DAY IT OPENS, by class.
 *
 * These are the two facts about pre-letting that the old model got by
 * accident and mostly got wrong. It ran one probability for every class, so
 * how full a building opened was decided by HOW LONG IT TOOK TO BUILD: a
 * 31-month office tower got twenty-odd chances to sign somebody and opened a
 * median 66% let, while a 12-month shed got eight and opened empty every
 * single time. Duration is a real influence — a longer build genuinely has
 * more time to lease — but it is not the reason retail pre-lets and sheds do
 * not, and it produced an office market where spec towers open two-thirds
 * full. Real spec office opens 0-30% pre-let.
 *
 * `rate` scales the monthly odds a prospect signs. `ceiling` is the share of
 * the building that can be spoken for at delivery, and it is a fact about how
 * each product is actually let:
 *
 *   retail      Anchors sign before ground breaks — that is what an anchor IS,
 *               and it is how the centre gets financed. An anchored scheme is
 *               well over half pre-let on opening day.
 *   office      A tenant with a lease expiring in two years will take space in
 *               a building they can walk. Most will not sign against a hole in
 *               the ground, so the honest spec number is a third at the very
 *               best and usually much less.
 *   industrial  Bimodal in life: a shed is either build-to-suit and 100% let
 *               before a spade goes in, or it is pure spec and opens empty.
 *               Build-to-suit is a different product and is not modelled yet,
 *               so what is left here is the spec leg — thin.
 *   multifamily Flats do not pre-let in the commercial sense. They lease from
 *               a trailer thirty days out, which arrives as h.occ at delivery
 *               rather than as signed leases. Nearly nothing here.
 */
const PRELET: Record<BuiltClass, { rate: number; ceiling: number }> = {
  retail: { rate: 1.15, ceiling: 0.62 },
  office: { rate: 0.55, ceiling: 0.32 },
  industrial: { rate: 0.45, ceiling: 0.22 },
  multifamily: { rate: 0.10, ceiling: 0.08 },
};

export function tickConstructionLeasing(s: GameState, parcels: ParcelTable) {
  for (const d of Object.values(s.developments)) {
    if (d.bts) continue; // named anchor already committed the building
    const rec = parcels[d.bbl];
    if (!rec) continue;
    const span = Math.max(1, d.deliverM - d.startM);
    const t = (s.month - d.startM) / span;
    // you cannot show space that is not enclosed
    if (t < 0.35) continue;
    if (!d.signed) d.signed = [];
    const takenSf = d.signed.reduce((a, x) => a + x.sf, 0);
    const leasable = Math.round(d.sf * specShare(d.mix ?? devMix(d.use)));

    const lead = dominantOf(d.mix ?? devMix(d.use));
    const pre = PRELET[lead] ?? PRELET.office;
    // THE CEILING BINDS BEFORE THE DICE DO. Past it, the space that is left is
    // the space that gets let after the building opens — which is the lease-up
    // risk the developer is being paid to carry, and the thing this model
    // exists to make real.
    const mix = d.mix ?? devMix(d.use);
    const asBuilt = {
      ...rec,
      class: dominantOf(mix),
      bldgArea: d.sf,
      floors: d.floors,
      mix,
    };
    const openSf = Math.round(leasable * pre.ceiling) - takenSf;
    // Same floor delivery uses when it converts `signed` into a rent-roll row.
    const floorSf = minLettableSf(asBuilt, lead);
    if (openSf < floorSf) continue;

    // a tight market lets a building before it opens; a glut does not
    const appetite = classAppetite(s, lead);
    const months = Math.max(1, d.deliverM - s.month);
    // interest builds as the date approaches — the risk a tenant is taking
    // shrinks, and so does what they will hold out for
    const near = clamp(1.35 - months / 18, 0.35, 1.35);
    const p = clamp(0.055 * pre.rate * appetite * near * (0.55 + demandLinear(rec.demandScore) / 130), 0, 0.42);
    if (rng(s, "dev") >= p) continue;

    // The building is plates. A construction letter is a size, not a bite of
    // a pre-cut suite — rounding a 4,000 ft letter up to a 26,000 ft HQ was
    // the 1/1-at-8% bug. Want is already drawn on the "dev" stream.
    const want = Math.round(openSf * rrange(s, 0.16, 0.5, "dev"));
    if (want < floorSf) continue;
    const sfLet = Math.min(openSf, want);
    // The delivery-risk discount: steep when the building is a frame and a
    // promise, nearly gone by the time the scaffolding comes down.
    const discount = clamp(1 - (0.16 * (months / Math.max(1, span))), 0.86, 0.99);
    d.signed.push({ sf: sfLet, use: lead, discount, name: "" });
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `Let before it opens: ${(sfLet / 1000).toFixed(0)}k sf at ${rec.address}, ${((1 - discount) * 100).toFixed(0)}% under market for taking delivery risk. `
        + `${(((takenSf + sfLet) / Math.max(1, leasable)) * 100).toFixed(0)}% of the building is spoken for.`,
    });
  }
}

/**
 * A SLIPPED JOB SLIPS ITS COHORT TOO. The month ground broke, the job's square
 * feet entered econ.cohorts tagged with this parcel; when weather or a dead
 * subcontractor moves deliverM, the pipeline's date moves with it.
 */
function syncDevCohorts(s: GameState, d: Development) {
  rescheduleSupplyProject(s, d.bbl, d.deliverM);
}

function deliver(s: GameState, parcels: ParcelTable, d: Development, rec: { address: string }) {
  // Buildings you have put up. The city notices a developer.
  s.delivered = (s.delivered ?? 0) + 1;
  const dmix = d.mix ?? devMix(d.use);
  s.built[d.bbl] = { class: dominantOf(dmix), mix: dmix, bldgArea: d.sf, floors: d.floors, yearBuilt: START_YEAR + Math.floor(s.month / 12), cov: d.coverage, ...(d.design ? { design: d.design } : {}) };
  const dBlock = demandModel(parcels).ofBbl.get(d.bbl);
  if (dBlock) nudgeBlockDemand(s, dBlock, Math.min(4, 1 + d.sf / 150_000));
  recordPropertyEvent(s, d.bbl, {
    kind: "delivered",
    use: dominantOf(dmix),
    sf: d.sf,
    floors: d.floors,
    party: firmShort(s),
  });
  // YOUR BUILDING IS SUPPLY TOO. A tower you deliver competes with everybody
  // else's space, including your own — and if you build enough of one class
  // you will move its vacancy against yourself, which is the correct lesson.
  // NOTE: no addStock here — the same rule as city deliveries in
  // tickCityGrowth. The square feet went into econ.cohorts the month ground
  // broke (startDevelopment), or with the original sponsor's start for a
  // takeover, and the cohort matures into citywide stock on its own in
  // tickEcon. Adding it again on delivery double-counted the building:
  // measured at exactly 2x the job's sf landing in stock across the delivery
  // month.
  const h = s.holdings[d.bbl];
  h.condition = "good";
  // NEW BONES. Ground-up is the only way to own the top of the condition scale —
  // see condCeiling: no amount of capital gets an old building here. That is a
  // real part of what a developer is buying and it was not modelled at all.
  // WHAT YOU BUILT IT TO. The specification is stamped on the PARCEL, not the
  // holding, because it outlives your ownership: whoever buys this building in
  // 2040 is buying the floor-to-floor and the curtain wall you paid for, and
  // condCeiling reads it forever.
  // (Stamped on `s.built` below, which resolveRec reads. It used to be written
  // onto the static parcel table too, which a reload rebuilds without it.)
  const built = parcels[d.bbl] ?? rec;
  // THE CEILING OF THE BUILDING YOU JUST BUILT, NOT OF THE DIRT IT STANDS ON.
  // `parcels[bbl]` is the STATIC record. On a lot that was land it carries
  // yearBuilt 0, so condCeiling read a two-thousand-year-old ruin and clamped
  // every ground-up delivery to 0.58 — "standard", for life — while the word
  // above said "good". Every reader takes the index, not the word: the rent
  // multiplier, the cap spread, the arrival factor on the leasing desk, and
  // the plan's own hurdle, which had priced the scheme at "good". Measured on
  // four deliveries: value at delivery 4-56% of basis. The record written to
  // s.built a few lines up carries the real year; a conversion keeps the old
  // bones' year on purpose (see condCeiling — no capital makes 1930 new).
  const bones = d.mode === "reuse" ? (built ?? { yearBuilt: START_YEAR }) : (s.built[d.bbl] as { yearBuilt: number });
  s.built[d.bbl].buildSpec = d.spec ?? 0.5;
  // Where it opens is the bones' call too — see openingCondIdx: a value box
  // is new and ordinary, not new and good.
  h.condIdx = Math.min(condCeiling({ yearBuilt: bones.yearBuilt, buildSpec: d.spec ?? 0.5 }, s.month), openingCondIdx(d.spec ?? 0.5));
  h.service = s.opsPolicy?.service ?? 0;
  h.stance = s.opsPolicy?.stance ?? 0;
  h.plan = s.opsPolicy?.plan ?? 1;
  if (s.minLeaseDefault && h.minLeaseSf === undefined) h.minLeaseSf = s.minLeaseDefault;
  h.svcIdx = 0.70;   // a building that opens this year opens well run
  h.lastCapM = s.month;
  h.tenants = [];
  h.deliveredM = s.month;
  if (d.bts) {
    const deposit = depositFor(s, d.bts.rentPsf, d.bts.sf, d.bts.credit);
    moveDeposit(s, h, deposit);
    h.tenants.push({
      name: d.bts.name,
      use: d.bts.use,
      sector: d.bts.sector,
      credit: d.bts.credit,
      sf: d.bts.sf,
      rentPsf: d.bts.rentPsf,
      net: d.bts.recovery === "nnn",
      recovery: d.bts.recovery,
      startM: s.month,
      endM: s.month + d.bts.termM,
      ...(d.bts.bumpPct !== undefined ? { bumpPct: d.bts.bumpPct } : {}),
      deposit,
      staff: 1,
    });
    recordPropertyEvent(s, d.bbl, {
      kind: "major-lease",
      party: d.bts.name,
      sf: d.bts.sf,
      amount: Math.round(d.bts.rentPsf * d.bts.sf),
      outcome: `${Math.round(d.bts.termM / 12)}-year build-to-suit`,
    });
  }
  // FLATS LEASE FROM A TRAILER. A block of flats does not pre-let the way an
  // office does — there are no leases signed against a hole in the ground —
  // but a leasing office opens thirty to sixty days before the certificate of
  // occupancy and the first residents move in on day one. In a tight market
  // that is a fifth of the building; into a glut it is nearly nobody. This was
  // a flat 0.1 and then, one month later, the 0.4 floor in tickLeasing threw it
  // away entirely — see the note there.
  //
  // ...AND THE TRAILER LEASES FROM THE SAME RENTERS EVERYONE ELSE DOES
  // (2026-10-09). The day-one share was 17-22% of the building whatever its
  // size — a 21M sf block opened with ~4M sf "let" to households that did not
  // exist. It opens empty; tickLeasing's finite-mover lease-up is the trailer.
  if ((dmix.multifamily ?? 0) > 0) h.occ = 0;
  h.costBasis += d.costTotal;
  h.assessed = (h.assessed ?? h.costBasis - d.costTotal) + d.costTotal;

  // unspent contingency is a rebate, not a rounding error
  const saved = Math.max(0, d.contingency - d.contingencyUsed);
  if (saved > 0) {
    s.cash += saved;
    logBooks(s, "dev", -saved, d.bbl);
  }

  // THE LEASE-UP RESERVE IS RELEASED. This is the money that fills the
  // building — fit-out, commissions and the carry until it is full. It was
  // financed on day one along with everything else, and now that there is a
  // building to lease it comes across as cash. Without this a developer who
  // had spent correctly to plan still could not afford the TI on the first
  // tenant through the door.
  // AND IT IS FINANCED, NOT MINTED. The reserve was handed over as free cash,
  // which quietly conjured money into the game. It is part of the loan
  // commitment — the bank is advancing it now that there is a building to
  // lease — so it draws like any other advance and the balance goes up.
  // AND ONLY WHAT THE BANK ACTUALLY ADVANCES ARRIVES. This handed over the
  // full reserve while drawing only what was left in the commitment, so any
  // gap between the two was cash from nowhere. It never showed up, because
  // the conserve identity nets it against the dev bucket and balances either
  // way — and on a job that ran to plan the gap was always exactly zero. The
  // room was a rail holding the model up. A repudiated facility has no room in
  // it at all, and a developer whose bank failed is not handed the fit-out
  // money on the way out the door.
  // AND IT STAYS WITH THE LENDER UNTIL IT IS SPENT. A construction lender
  // does not wire the fit-out budget to the sponsor on opening day; it holds
  // the TI/LC and interest lines and advances them as the costs arrive. Paying
  // it all out at delivery charged the coupon on money sitting idle in the
  // operating account, and made every lease-up read as the firm bleeding cash
  // month after month while it was only spending its own budget. Now it rides
  // on the takeout as undrawn room (Loan.leaseUpRoom) and is drawn at each
  // signing and for each month the building cannot carry itself. A vehicle
  // deed keeps the old release: its cash moves through the fund's account.
  const lease = d.leaseUpReserve ?? 0;
  let heldReserve = 0;
  if (lease > 0) {
    const room = Math.max(0, d.commitment - d.drawn);
    const advance = Math.min(lease, room);
    d.drawn += advance;
    const inFund = purseOf(s, h) === "fund";
    if (inFund) {
      d.loanBalance += advance;
      s.cash += advance;
      logBooks(s, "dev", -advance, d.bbl);
    } else heldReserve = advance;
    s.news.unshift({
      q: s.month, kind: advance < lease ? "warn" : "info",
      text: advance < lease
        ? `The lease-up reserve at ${rec.address} was ${money(lease)}, and only ${money(advance)} of it `
          + `is still fundable. The fit-out and the leasing commissions on the rest come out of your own account.`
        : inFund
          ? `The lease-up reserve at ${rec.address} — ${money(lease)} — is released. That is what fits out the first tenants.`
          : `The lease-up reserve at ${rec.address} — ${money(lease)} — stays with the lender and is drawn as tenants are fitted out `
            + `and while the building cannot carry its loan. Your own cash is not touched until it runs out.`,
    });
  }

  // TENANTS WHO SIGNED WHILE IT WAS GOING UP. They took delivery risk on a
  // hole in the ground and were paid for it in rent; now the building exists
  // and they move in. Place them on the stack at the size they signed. A job
  // that let well during construction opens part-full and covers its mini-perm;
  // one that let nothing opens empty, which is the developer's real risk.
  let placed = 0, lostSf = 0;
  for (const sg of d.signed ?? []) {
    const built = resolveRec(parcels, s, d.bbl);
    if (!built) { lostSf += sg.sf; continue; }
    const use = sg.use as BuiltClass;
    if (genAnchorTenant(s, built, h, sg.sf, sg.discount, use)) { placed++; continue; }
    const vac = useVacantSf(built, h, use, s.month);
    if (vac >= 1 && genAnchorTenant(s, built, h, vac, sg.discount, use)) {
      placed++;
      continue;
    }
    lostSf += sg.sf;
  }
  if (lostSf > 0) {
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `${rec.address} opened with ${(lostSf / 1000).toFixed(1)}k sf of construction pre-lets that could not take possession — `
        + `the space will not demise under the floor. ${placed} pre-let${placed === 1 ? "" : "s"} did move in.`,
    });
  }

  // EVERY FOOT NOBODY MOVED INTO IS SHELL. The next tenant through the door
  // needs a first-generation build-out, not a refresh of somebody else's.
  {
    const built = resolveRec(parcels, s, d.bbl);
    if (built) {
      const shell: Partial<Record<BuiltClass, number>> = {};
      for (const u of leasableUses(built)) {
        if (u === "multifamily") continue;
        const free = Math.round(useVacantSf(built, h, u, s.month));
        if (free > 0) shell[u] = free;
      }
      if (Object.keys(shell).length) h.shellSf = shell;
      else delete h.shellSf;
    }
  }

  // THE TAKEOUT. The construction loan does not evaporate — it rolls into a
  // mini-perm that is interest-only for two years and matures in five, and the
  // whole job now is to stabilise the building before that clock runs out.
  // A developer's real risk is not building it. It is owning it empty.
  // The hedge bought at the groundbreak (MDGA phase 5): a cap rides into the
  // mini-perm, a forward lock converts it fixed. Naked otherwise.
  const tk = d.takeout;
  const fixedTk = tk?.kind === "fixed" ? tk : null;
  const capTk = tk?.kind === "cap" && tk.expiresM > s.month ? tk : null;
  const takeRate = fixedTk ? fixedTk.ratePct
    : +((capTk ? Math.min(s.econ.indexRate, capTk.strike) : s.econ.indexRate) + MINI_PERM_SPREAD).toFixed(2);
  // ANYTHING STILL OWED ON THE DEED ROLLS INTO THE TAKEOUT. A ground-up job
  // retires its land loan at groundbreak (siteDebtAtGroundbreak), but a deed
  // can still reach delivery with paper on it — a takeover, or a save from
  // before that rule. Assigning the mini-perm over it wrote the old balance
  // off with no cash moving and nobody repaid. The lender converting the job
  // takes it out instead, which is what a conversion to permanent does.
  const carried = Math.max(0, Math.round((h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0)));
  if (h.mezz) h.mezz = null;
  h.loan = {
    product: "miniperm",
    floating: !fixedTk,
    principal: d.loanBalance + carried,
    balance: d.loanBalance + carried,
    ratePct: takeRate,
    spread: MINI_PERM_SPREAD,
    ...(capTk ? { cap: { strike: capTk.strike, expiresM: capTk.expiresM } } : {}),
    // A THREE-YEAR CLOCK WAS TOO SHORT. Filling a building at this market's
    // pace takes longer than that, so every job arrived at its balloon still
    // half empty and un-refinanceable. A construction takeout is a three-plus
    // -two or a five-year in practice, and interest-only while it fills.
    ioUntilM: s.month + 24,
    amortYears: 30,
    maturityM: s.month + 60,
    monthlyPmt: Math.round(((d.loanBalance + carried) * takeRate) / 100 / 12),
    minDSCR: 1.05,
    maxLTV: 0.9,
    sweep: false,
    cleanQs: 0,
    originM: s.month,
    // A building that delivered empty cannot cover anything, and every lender
    // who writes construction paper knows it. The holiday runs three years —
    // long enough to fill it, short enough that failing to is fatal.
    holidayUntilM: s.month + 36,
    prepay: "open",
    prepayUntilM: s.month,
    // The mini-perm is the construction lender rolling its own facility — the
    // balance stays on the desk that carried the job, which is what its
    // statement on Research shows and whose capital a default would eat.
    holder: d.lender ?? CONSTRUCTION_LENDER,
    ...(heldReserve > 0 ? { leaseUpRoom: heldReserve } : {}),
  };
  bumpLenderRel(s, d.lender ?? CONSTRUCTION_LENDER, 2);   // a job delivered is the best line in the file
  // A NEW BUILDING OPENS ON AUTO-LEASE, at its rent posture with no fit-out
  // cap — the leasing guidelines every lease-up runs on — unless you took it
  // off. Major leases still come to you (leasing.ts isMajorLease).
  // A NEW BUILDING LETS. "Stop letting" (leasingHold) is how the old one was
  // emptied for this — buying out the leases sets it — and nothing cleared
  // it through the demolition and the build, so the delivery opened with
  // letting stopped and its flats never let (owner, Oct 2026).
  delete h.leasingHold;
  if (h.autoLease === undefined && !h.groundLeased) {
    const built = resolveRec(parcels, s, d.bbl);
    if (built && leasableUses(built).length) h.autoLease = true;
  }
  delete s.developments[d.bbl];
  bumpLand(s, d.bbl, 1.06);

  const over = d.costTotal - (d.hardCost + Math.round(d.hardCost * SOFT_COST));
  void over;
  // YOUR BUILDING IS UP, AND THAT TAKES THE SCREEN (owner, Oct 2026): the
  // card's button flies the map to it and opens it. raiseAlert files the
  // same line in the news.
  raiseAlert(s, {
    kind: "delivered", tone: "good", bbl: d.bbl,
    title: `${rec.address} has delivered`,
    body: `${(d.sf / 1000).toFixed(0)}k sf of ${d.use}, ${d.events === 0 ? "on programme" : `after ${d.events} problem${d.events > 1 ? "s" : ""}`}, $${(d.costTotal / 1e6).toFixed(1)}M all in`
      + (saved > 0 ? `, with ${money(saved)} of contingency returned` : "")
      + `. The mini-perm matures ${monthLabel(s.month + 60)} — stabilise it before then.`,
  });
}

// ---- building management ---------------------------------------------------
export interface CapProgram {
  id: string;
  label: string;
  costPsf: number;
  months: number;
  blurb: string;
}
export const PROGRAMS: CapProgram[] = [
  { id: "lobby", label: "Lobby refresh", costPsf: 14, months: 3, blurb: "+4% new-lease rents, more LOIs" },
  { id: "systems", label: "Systems & HVAC", costPsf: 22, months: 6, blurb: "−15% operating costs" },
  { id: "facade", label: "Facade program", costPsf: 30, months: 6, blurb: "+8% new-lease rents" },
];

/**
 * WHAT A PROGRAMME IS WORTH TO THE BRICKS.
 *
 * These were three permanent stat buffs that did nothing whatever to condition
 * and did not even reset the neglect clock, which meant there was no way to
 * improve a building you actually operate: the only route back up was a gut,
 * and startRenovation refuses one until the roll burns below 35% leased. On a
 * stabilised 98k sf office that is a $20.5M job you are not allowed to do.
 *
 * A facade or a plant replacement moves a grade on its own — and at $30 and $22
 * a foot against a $210/sf gut, that is the correct real-world arithmetic: a
 * repositioning is a fraction of a rebuild. A lobby is a first impression and
 * buys a third of a grade. This is now the whole answer to age, and it is a
 * decision taken once a decade per building, not once a month.
 */
export const PROGRAM_LIFT: Record<string, number> = { lobby: 0.08, systems: 0.17, facade: 0.21 };

/** How long each job holds before the same one is due again. */
export const PROGRAM_CYCLE_M: Record<string, number> = { lobby: 180, systems: 300, facade: 420 };

export function programCost(rec: { bldgArea: number }, s: GameState, p: CapProgram): number {
  return Math.round(rec.bldgArea * p.costPsf * s.econ.costIdx);
}

export function startProgram(s: GameState, parcels: ParcelTable, bbl: string, programId: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const p = PROGRAMS.find((x) => x.id === programId);
  if (!h || !rec || !p) return { s, err: "No such program." };
  if (h.groundLeased || s.groundLeases?.[bbl]) {
    return { s, err: "The ground lessee controls the improvement — their capital plan, not yours." };
  }
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to improve on a vacant lot." };
  { const why = consentFor(s, h, "redevelop"); if (why) return { s, err: why }; }
  if (h.program) return { s, err: "A capital program is already running." };
  // A PROGRAMME COMES ROUND AGAIN. These were once-per-building-forever, which
  // over a century is three capital decisions and then nothing — no answer to
  // age, and a building whose menu was spent had only a gut left, which a full
  // rent roll forbids. Real capital is a cycle, and this is its period.
  const last = h.programsDone?.[programId];
  if (last !== undefined && s.month - last < (PROGRAM_CYCLE_M[programId] ?? 240)) {
    return { s, err: `${p.label} was done here in ${monthLabel(last)}. It does not need doing again yet.` };
  }
  const cost = programCost(rec, s, p);
  // A facade, a plant replacement or a new lobby is capital spend on a
  // building you already own and intend to keep — the exact thing a corporate
  // revolver exists to bridge until the higher rents show up on the roll. The
  // per-foot cost, the months it takes and the decade-long cycle before the
  // same job comes round again are all unchanged.
  const liq = spendable(s, parcels);
  if (liq.total < cost) {
    return {
      s,
      err: `${p.label} costs ${money(cost)} and you can raise ${money(liq.total)} — `
        + `${money(liq.cash)} of cash and ${money(liq.line)} on the line.`,
    };
  }
  const next = clone(s);
  fundAndBook(next, parcels, cost, "capex", { bbl });
  const nh = next.holdings[bbl];
  nh.program = { id: programId, untilM: next.month + p.months };
  next.news.unshift({ q: next.month, kind: "info", text: `${p.label} underway at ${rec.address} (${money(cost)}).` });
  return { s: next };
}

export function tickPrograms(s: GameState, parcels: ParcelTable) {
  for (const h of Object.values(s.holdings)) {
    if (h.program && s.month >= h.program.untilM) {
      h.programsDone = { ...(h.programsDone ?? {}), [h.program.id]: s.month };
      const rec = resolveRec(parcels, s, h.bbl);
      const p = PROGRAMS.find((x) => x.id === h.program!.id);
      // THE MONEY BUYS THE BRICKS BACK. New plant, a new skin or a new front
      // door is the difference between a building the market still rings about
      // and one it has stopped calling — capped by what the bones will carry,
      // because you cannot make a 1928 walk-up read as new construction.
      if (rec) {
        h.condIdx = Math.min(condCeiling(rec, s.month), (h.condIdx ?? 0.7) + (PROGRAM_LIFT[h.program!.id] ?? 0));
        h.condition = condGrade(h.condIdx);
        h.lastCapM = s.month;
      }
      if (rec && p) s.news.unshift({ q: s.month, kind: "info", text: `${p.label} complete at ${rec.address} — the building reads as ${h.condition} now.` });
      delete h.program;
    }
  }
}

export function setStance(s: GameState, bbl: string, stance: -1 | 0 | 1): GameState {
  const next = clone(s);
  const h = next.holdings[bbl];
  // Lessee sets the ask on their building — stamping yours on a leased fee is a no-op.
  if (!h || h.groundLeased) return next;
  h.stance = stance;
  return next;
}

/**
 * HOW THIS BUILDING IS RUN. Free to change and slow to matter, which is the
 * honest shape: you can switch the service level this afternoon and the
 * tenants will not have noticed for three years.
 */
export function setOps(
  s: GameState, bbl: string, ops: { service?: -1 | 0 | 1; plan?: 0 | 1 | 2 },
): GameState {
  const next = clone(s);
  const h = next.holdings[bbl];
  if (!h || h.groundLeased) return next;
  if (ops.service !== undefined) h.service = ops.service;
  if (ops.plan !== undefined) h.plan = ops.plan;
  return next;
}

/**
 * THE HOUSE POLICY, and it applies to the book you already own.
 *
 * This is the one control that keeps the whole system out of chore territory.
 * Set it once and every deed you close after it arrives configured; set it
 * again and the existing book follows, because a firm that decides to start
 * running its buildings properly does not do it one address at a time.
 */
export function setOpsPolicy(
  s: GameState, ops: { service: -1 | 0 | 1; plan: 0 | 1 | 2; stance?: -1 | 0 | 1 }, applyToBook = true,
): GameState {
  const next = clone(s);
  next.opsPolicy = ops;
  if (applyToBook) {
    const st = ops.stance ?? 0;
    for (const h of Object.values(next.holdings)) {
      // Lessee runs the bricks — stamping your capital plan onto a leased fee
      // used to charge YOUR cash for THEIR building once resolveRec showed SF.
      if (h.groundLeased) continue;
      h.service = ops.service; h.plan = ops.plan; h.stance = st;
    }
    // THE ASK IS PART OF HOW YOU RUN A BUILDING, and it was the one standing
    // decision this policy did not carry — so a principal could set service and
    // the capital plan for the whole book in one move and still had to open
    // twenty buildings to say "push rents". It is the same kind of decision as
    // the other two: taken once, lived with for years, overridden per asset
    // where one building needs different treatment.
    next.news.unshift({
      q: next.month, kind: "info",
      text: `House policy: ${st > 0 ? "push rents" : st < 0 ? "fill space" : "ask the market"}, `
        + `buildings run ${serviceSpec(ops.service).label.toLowerCase()}, capital plan ${planSpec(ops.plan).label.toLowerCase()}. `
        + `It applies to everything on the book from this month.`,
    });
  }
  return next;
}

// ---- the city builds itself ------------------------------------------------
// Over a lifetime the market fills in the vacant lots around you — fastest in
// booms, near-stalled in recessions, always working outward from the demand
// peaks. Every delivery lifts land values on its block, so watching where the
// cranes go is a market signal.
//
// TWO THINGS WERE WRONG WITH THIS.
//
// It ran at 0.88 deliveries a MONTH in an expansion — better than ten new
// buildings a year in a town of sixteen hundred lots, which is a construction
// boom in perpetuity and nothing like a real small city, where two or three a
// year is a busy market and a bad year has none.
//
// And a building appeared the instant it was decided, its square feet landing
// on the market complete. Nothing works that way. The decision to build is
// taken in one market and the building arrives in a different one, two or
// three years later, and that lag is the entire reason property cycles
// overshoot: everybody starts at the top and everybody delivers into the
// bottom. Now a city start is a hole in the ground with a delivery date, its
// space enters the pipeline the day it starts, and it competes with you only
// when it opens.
// How often anybody breaks ground now falls out of the economic order book and
// the physical crew pool. There is no phase-specific start rate here: adding
// one would be a second answer layered over the common pro forma.

/**
 * THE BLOCK'S CORNICE DATUM, ENGINE SIDE.
 *
 * The citygen has a cornice-datum machine that makes the GENERATED town read
 * as a town; the engine had nothing, so infill was sized off the ZONING
 * envelope. Under the default "village" preset the standing city is p50 3
 * floors, p99 8, max 14 — while vacant-lot farMax is p50 15.6, p90 30.5.
 * Measured over 20 years x 2 seeds: 51 city/rival groundbreaks per run at
 * MEDIAN 15-17 floors, max 32, with 26-35 of them more than twice the tallest
 * standing neighbour. A village sprouted a forest of towers in a decade.
 *
 * No speculative builder does that. Infill is priced off the block's comps,
 * and the comp set is what is standing: a developer builds one increment above
 * the cornice line, because the increment is what the lenders and the tenants
 * have already underwritten. Tall arrives the way it arrives in life — block
 * by block, each cycle ratcheting the datum a few floors, over decades.
 *
 * The PLAYER is deliberately not capped: zoning is their envelope and
 * overbuilding their own market is their risk to take.
 */
/**
 * How high the market will speculatively build on this lot TODAY. The rule is
 * `heightCapFloors` (value.ts), shared with the land residual; this supplies
 * the block's cornice datum and the town's maturity from the state, through
 * the same per-state reads `resolveRec` stamps on the record — so a lot's
 * height and its land price cannot be asked two different questions.
 */
export function cityInfillCap(
  s: GameState, parcels: ParcelTable,
  rec: { block: string; lotArea: number; farMaxComm?: number; farMaxRes?: number },
  use: BuiltClass = "office",
): number {
  return heightCapFloors(corniceDatum(s, parcels, rec.block), townMaturity(s), s.econ, rec, use);
}


/**
 * WHAT GETS BUILT HERE — AND THE CITY REZONES WHEN A SECTOR LEAVES.
 *
 * This was five lines of pure zoning, and the first one, `M -> industrial`,
 * was a life sentence: a cleared lot on M-zoned land rebuilt an industrial
 * building forever, however much industry was left in the town.
 *
 * That is the missing half of the sector-exit ratchet in market.ts, and it was
 * the expensive half. The ratchet models tenants being priced out and never
 * coming back — measured over 50 years it takes the demand anchor to 0.63x for
 * office, 0.62x for industrial and 0.78x for retail — while the buildings they
 * left go on standing and the city goes on replacing them in kind. Office stock
 * reached 1.38x against demand of 0.63x. A 2.2x permanent overhang impairs every
 * landlord in the class for good, which is most of why 90% of rival firms died
 * and the street fell from 31 firms to 9.
 *
 * The ratchet's own comment cites the right fact and the code implemented half
 * of it: New York, San Francisco and London each lost more than half their
 * manufacturing FLOOR SPACE between 1970 and 2010. The floor space left. It was
 * converted and rebuilt — Long Island City, Williamsburg, the Brooklyn
 * waterfront, SoMa, the Docklands — because when the industry went, the city
 * rezoned the land it had been sitting on. None of it was kept zoned for
 * manufacturing and held empty for forty years.
 *
 * SO THE REZONED SHARE IS THE SECTOR-EXIT SHARE. Not a new constant: the same
 * quantity the ratchet already wrote down, read back. A sector that has lost a
 * third of its demand has a third of its land rezoned as that land turns over.
 * With nothing shed the weights below reduce to exactly the old thresholds, so
 * this is a strict generalisation of what was here.
 *
 * INDUSTRIAL HAS A SECOND EXIT CHANNEL — and this used to be blind to it.
 * Manufacturing's secular decline is carried by `industComp` in market.ts
 * (NY/SF/London floor-space half-life), not by the price ratchet. Measured on
 * null-player centuries before this wire: `industComp` fell to ~0.42 while
 * `baseStock` stayed at 1.0× forever, because falling demand MADE space cheap
 * and the price ratchet only fires on dear space. `gone()` read only
 * baseStock, so M-land stayed a life sentence, sheds sat at 20–35% vacancy
 * for decades, and real industrial rent ran about −2%/yr. The composition
 * index IS the sector-exit share for sheds; rezoning must read it. Cap and
 * residual floor unchanged — somebody still needs a last-mile bay.
 *
 * WHERE THE REZONED LAND GOES is multifamily, and that is the mechanism being
 * right rather than a preference. Housing is the one class the ratchet exempts,
 * for the reason stated there: people priced out of a city's housing leave and
 * the housing does not — demand for shelter in a place is not a footprint that
 * can relocate. So it is the one demand still standing when a sector goes, and
 * it is what the lofts, the warehouses and the emptied office floors became.
 */
export function useForZone(zone: string, demand: number, r: number, e?: Econ): DevUse {
  // The share of a sector that has structurally left. Capped below 1 because a
  // city never rezones the last of anything — somebody still needs a garage.
  const gone = (k: BuiltClass) => {
    const b0 = e?.baseStock0?.[k], b = e?.baseStock?.[k];
    const fromBase = b0 && b ? clamp(1 - b / b0, 0, 0.8) : 0;
    // Composition decline is sector exit for sheds — see block comment above.
    const fromComp = k === "industrial"
      ? clamp(1 - (e?.industComp ?? 1), 0, 0.8)
      : 0;
    return Math.max(fromBase, fromComp);
  };
  const here = (k: BuiltClass) => 1 - gone(k);
  /**
   * THE CRANE FILLS THE ORDER BOOK. Which is what an order book is for.
   *
   * The weights below are a programme mix — what a city of this demand level
   * builds on average — and until now they were the whole decision. The draw
   * never once asked which class the market was actually short of. Measured,
   * `pnpm mixmatch` read three of four classes at a NEGATIVE correlation
   * between what was ordered and what went in the ground, and industrial at a
   * third of every order and two per cent of every groundbreak. The book was
   * decoration, and the `orders -> breaks` leg of `pnpm leadlag` could only
   * ever be identified through the rent term that drove both ends of it.
   *
   * `econ.startOwed` is the queue: square feet ordered by the space market, per
   * class, expiring after eighteen months, decremented by every groundbreak.
   * `tickCityDev` already reads its TOTAL to size the crane count. This reads
   * its COMPOSITION to pick the use, which is the other half of the same
   * sentence, and it makes the leg a genuine fill relationship — breaks respond
   * to the book and then DRAIN it, so the feedback is negative and the lag is
   * the queue's own.
   *
   * NO CONSTANT ENTERS HERE. `pick` normalises, so only the ratios matter, and
   * the ratios are the order book's own. Two earlier attempts got that wrong in
   * opposite directions and both are worth keeping in mind:
   *
   *   - Weighting by each class's share of the book CLAMPED to [0.33, 2.5].
   *     Instrumented over 9,084 draws the clamp bound 52.7% of the time, so in
   *     half the city's decisions the mechanism was the clamp — CLAUDE.md fake
   *     number five, a rail that is load-bearing rather than a guard.
   *   - Weighting by `classAppetite` instead. That reads far better on the
   *     headline numbers and is still wrong, because `e.starts` — the thing
   *     that FILLED the book in that experiment — was itself
   *     `vacGate(vacancy) x credit x margin`
   *     and `classAppetite` is `tight(vacancy) x credit x devPencils`. They are
   *     the same formula. Wiring one to the other does not build a mechanism,
   *     it builds a mirror: `orders -> breaks` duly went to r 0.39 and BACKWARDS
   *     at -17 months, which is two copies of one series arguing about phase.
   *     That is the exact fault this whole line of work exists to find.
   */
  const owed = (u: DevUse): number =>
    Math.max(0, e?.startOwed?.[dominantOf(devMix(u))] ?? 0);
  // Weighted pick over [0,1), so a class's mass shrinks by exactly what has
  // left and the remainder falls to housing. One draw, same as before.
  //
  // If the book is empty of everything this zone permits there is nothing to
  // normalise, and the programme weights stand alone. That is a guard rather
  // than a rail — an empty book means the market has not asked for anything,
  // and the appetite gate in the caller rejects the site a line later anyway,
  // so what this returns in that case rarely reaches a shovel.
  const pick = (w0: [DevUse, number][]): DevUse => {
    const wo = w0.map(([u, x]) => [u, x * owed(u)] as [DevUse, number]);
    const w = wo.reduce((t, [, x]) => t + x, 0) > 0 ? wo : w0;
    const total = w.reduce((t, [, x]) => t + x, 0);
    let acc = 0;
    for (const [use, x] of w) { acc += x / total; if (r < acc) return use; }
    return w[w.length - 1][0];
  };
  if (zone.startsWith("R")) return "multifamily";
  if (zone.startsWith("M")) {
    // Housing on M only where `zonePermits` says so — the rule the land was
    // priced on. This weighted flats by how much industry had left even while
    // sheds were short, so a rival drew flats on M that no desk could plan
    // (measured: 2 rival starts in 3 seeds x 25 years, all refused a line
    // later by the pro forma's zoning check, rolls already spent).
    return pick([["industrial", here("industrial")],
                 ["multifamily", zonePermits(zone, "multifamily", demand, e) ? gone("industrial") : 0]]);
  }
  if (demand > 70) {
    return pick([["office", 0.55 * here("office")], ["mixed", 0.30], ["retail", 0.15 * here("retail")],
                 ["multifamily", 0.55 * gone("office") + 0.15 * gone("retail")]]);
  }
  if (demand > 45) {
    return pick([["mixed", 0.40], ["multifamily", 0.40 + 0.20 * gone("retail")], ["retail", 0.20 * here("retail")]]);
  }
  // THE SHOVEL MUST ASK THE SAME ZONING THE PENCIL ASKS (the sitePencil
  // comment above, in the other direction): fringe C corridors permit light
  // industrial now, so the low-demand branch must be able to CHOOSE one, or
  // the pencil says "sheds clear here" while the crane never once picks one —
  // the exact split that kept supplyShut believing supply was coming. The
  // weight only carries when the order book owes industrial (pick() multiplies
  // by owed), so a town with no shed shortage builds exactly what it built.
  return pick([["multifamily", 0.70 + 0.30 * gone("retail")], ["retail", 0.30 * here("retail")],
               ["industrial", zonePermits(zone, "industrial", demand, e) ? 0.25 * here("industrial") : 0]]);
}

/**
 * Would anybody sensibly break ground in this class right now?
 *
 * Vacancy against its natural rate, softened by what is already coming. A
 * class three points tight gets built hard; a class in a glut with a full
 * pipeline does not get built at all, which is what stops the city cheerfully
 * paving itself through a downturn.
 */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Split from `classAppetite` so `useForZone` can read it: the whole computation
// only ever touched `s.econ`, and the use-picker has the Econ but not the state.
// Same function, one caller deeper — nothing about the number changed.
function classAppetiteE(e: Econ, k: BuiltClass): number {
  const vac = e.cityVac?.[k] ?? NATURAL_VAC[k];
  const gap = vac - NATURAL_VAC[k];
  const stk = e.stock?.[k] ?? CITY_STOCK[k];
  const coming = (e.pipeline?.[k] ?? 0) / Math.max(1, stk);   // pipeline as a share of stock
  const tight = clamp(1 - gap * 13 - coming * 5, 0, 2.1);
  // ...AND WHETHER IT PENCILS. The city's own infill read vacancy, the
  // pipeline and the credit window, and never once read what money cost — so
  // a three-hundred-basis-point shock left the municipal cranes turning at
  // exactly the same rate. See market.devPencils: one hurdle, read by the
  // quota, by the street, and by the city.
  return tight * clamp(e.creditIdx ?? 1, 0.25, 1.25) * devPencils(e, k);
}

function classAppetite(s: GameState, k: BuiltClass): number {
  return classAppetiteE(s.econ, k);
}

/**
 * A RECORD GOES ON THE TAPE, AND THE TAPE TAKES YOU THERE.
 *
 * A city notices when somebody plans the biggest office building it has ever
 * seen — that is front-page news in any real town, and it is exactly the event
 * a principal wants to fly to and stare at, because the supply it represents is
 * pointed at their rent roll. The record is seeded LAZILY from the standing
 * stock, so the first two-storey shop of a young campaign does not make the
 * tape: a plan is only news when it beats everything built as well as
 * everything planned.
 */
export function noteRecordPlan(
  s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass, sf: number, floors: number, who: string,
) {
  if (!s.recordPlan) {
    s.recordPlan = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    for (const b in parcels) {
      const r = parcels[b];
      if (!r || r.class === "land" || !r.bldgArea) continue;
      const k = r.class as BuiltClass;
      if (k in s.recordPlan && r.bldgArea > s.recordPlan[k]) s.recordPlan[k] = r.bldgArea;
    }
  }
  if (sf <= (s.recordPlan[use] ?? 0)) return;
  s.recordPlan[use] = sf;
  const rec = resolveRec(parcels, s, bbl);
  s.news.unshift({
    q: s.month, kind: "event", bbl,
    text: `${who} filed plans for the largest ${SECTOR_LABEL[use].toLowerCase()} building this city has ever ` +
      `seen: ${Math.round(sf).toLocaleString()} sf, ${floors} floors, at ${rec?.address ?? bbl}. ` +
      `Every landlord in the class just read the same paragraph you did.`,
  });
}

/**
 * THE CITY TEARS ITS WORST BUILDINGS DOWN.
 *
 * Nothing in this town was ever demolished. The audit put it in one line:
 * mean building age rose fifty years over fifty years, in every seed, which
 * means the 1890 walk-up standing at the start is the 1890 walk-up standing at
 * the end and the stock is a museum rather than a market. Real cities lose
 * about half a per cent of their building stock a year to the wrecking ball,
 * and they lose a very specific half per cent: the buildings whose LAND is
 * worth conspicuously more than the building standing on it. That is the
 * teardown test, it is the oldest calculation in this business, and it is what
 * turns a neighbourhood over.
 *
 * Player buildings are never touched — your asset is yours to run into the
 * ground or not. Everything else is fair game, and what goes is what fails the
 * test worst: obsolete, old, and sitting on dirt that wants a better building.
 */
/**
 * HOW MANY JOBS THIS TOWN CAN HAVE IN THE GROUND AT ONCE. General contractors,
 * tower cranes and steel crews are finite and they are shared: the teardown
 * pipeline, the quota and a rival's tower all draw on the same pool.
 *
 * IT SCALES WITH THE TOWN, AND IT DID NOT BEFORE. This was `bbls.length / 165`
 * and the comment claimed it was "scaled to the size of the town" — but the lot
 * count is a property of the PLAT, fixed the day the map is drawn. A city that
 * doubled its population and its built stock had exactly the same number of
 * cranes it started with, for ever.
 *
 * That constant was the binding constraint on the whole city's construction,
 * and it is the third mechanism behind the owner's report that land prices run
 * away. Measured on the shipped island over sixty years, before this change:
 *
 *   cranes in the ground   8 -> 9      pinned at capacity for 55 of 60 years
 *   population         43,451 -> 80,813   (+86%)
 *   housing stock        4.62M -> 6.45M sf  (+40%)
 *   housing sf a head      106 -> 73       (-31%)
 *   multifamily vacancy   7.06% -> 1.35%   and pinned on its frictional floor
 *                                          for 50 of those 60 years
 *   real housing rent     24.8 -> 82.6     (3.3x)
 *
 * Unmet demand was NOT accumulating — `startOwed` sat flat at about 0.3M sf —
 * so this was not a market that failed to ask for housing. It asked every
 * month and the trade could not answer, because the trade was a constant. Rents
 * then compounded, and since land is the residual after construction cost,
 * compounding rents are what detonate land prices.
 *
 * A real construction industry grows with the economy it serves: more people
 * and more buildings mean more firms, more crews and more equipment. So the
 * plat sets the starting scale and the town's own growth carries it from there.
 * The bounds are wide and are guards, not policy — a town cannot lose its
 * builders entirely, and it cannot conjure a boomtown's worth of them overnight.
 */
function crewCapacity(bbls: string[], e?: Econ): number {
  // WHAT A TOWN THIS SIZE CARRIES IN AN ORDINARY YEAR, IN SIMULTANEOUS JOBS.
  //
  // This was `lots / 165` scaled by population growth: a proxy for the size of
  // the place, with no units and nothing real behind the divisor. The quantity
  // it is trying to name has a definition. A city has some floor area standing
  // and some share of it under construction at any moment, and that share is
  // just how fast the stock turns over multiplied by how long a building takes:
  // a growing US metro delivers on the order of 1.8% of its stock a year, and
  // the stock-weighted build here runs about two and a half years (BUILD_MONTHS
  // — office 30-44, retail 18-28, multifamily 22-34, industrial 12-20). So
  // roughly four and a half per cent of a real city's floor area is in the air,
  // and divided by what a building here weighs, that is the crew count.
  //
  // Measured, the difference is the whole of the fault: the lot-count base gave
  // this town 8-10 crews and it wanted 26. `crewIdx` then ran to its ceiling
  // and STAYED there in 26-57% of months — the same load-bearing rail one level
  // up, which is what a base number that is wrong by a factor of three looks
  // like from the inside.
  let stock = 0;
  for (const k of BUILT_CLASSES) stock += e?.stock?.[k] ?? 0;
  // The lot count is the fallback before the first tick has set a stock, and
  // the floor of 4 is a guard for the smallest island.
  const base = stock > 0 ? (stock * NORMAL_PIPE_SHARE) / TYPICAL_SF : bbls.length / 165;
  // ...AND THE TRADES FOLLOW THE WORK — see `tickCrews`. `crewIdx` is how far
  // the town's construction workforce sits above or below ordinary because of
  // how busy it has been.
  // No floor of four crews and no bounds on the index (2026-10-13): the
  // workforce follows its order book (tickCrews), and more crews means lower
  // utilisation, so it settles on its own. One is arithmetic — a ratio's
  // denominator.
  return Math.max(1, Math.round(base * (e?.crewIdx ?? 1)));
}

/**
 * Share of a city's floor area under construction in an ordinary year — the
 * delivery rate times the build duration, both measured above.
 *
 * The same quantity `market.ts` calls `REF_PIPE_SHARE`, and it is imported from
 * there rather than restated. These used to be two constants — 0.045 here from
 * the world, 0.018 there measured off this model while the old crew wall was
 * suppressing the pipeline — and the note that used to sit here explained the
 * gap as "the factor the wall was suppressing". The wall is gone; the gap was a
 * bug waiting for somebody to notice, and it was pinning the construction
 * employment term on its ceiling in 56.6% of all months.
 */
const NORMAL_PIPE_SHARE = REF_PIPE_SHARE;

/**
 * Repair, renovation and fit-out as a share of all construction work — the part
 * of the trades' order book that is not speculative new build and does not stop
 * when the cranes do. Roughly 45% of US construction spend.
 */
const MAINTENANCE_SHARE = 0.45;

// (CREW_MIN 0.3 / CREW_MAX 3.0 and a floor of four crews bounded the
// workforce index until 2026-10-13. The maintenance load already holds a town
// with no new build near 0.45 of its base crew, and a busy one grows its
// trades until utilisation falls, so the bounds only ever described a
// quantity that does not leave them by itself.)

/**
 * THE BUILDING TRADES ARE A STOCK, AND IT ANSWERS THE ORDER BOOK.
 *
 * The crew count used to be a fixed function of lots and population, which
 * made it a hard quantity ceiling on everything the city could build. That is
 * a real constraint modelled as the wrong KIND of thing. There genuinely are
 * only so many general contractors in a harbour town — but when they are all
 * booked and there is a queue out the door, two things happen and this engine
 * modelled neither: their price goes up, and more of them show up.
 *
 * What it cost, measured before this existed:
 *
 *   - the town wanted 1.5-2.8x the cranes it could run, in 69-97% of months,
 *     with an order book of ~0.7M sf standing permanently unbuilt;
 *   - stock grew 0.4-0.65%/yr for fifty years against a population growing
 *     24-96%, so square feet per resident fell from 261 to as low as 170;
 *   - and REAL construction cost FELL 0.3-2.2%/yr across half a century in a
 *     town that was desperate to build, because the cost index reads how much
 *     IS being built and the wall made that number nearly constant. Excess
 *     demand accumulated in `startOwed`, sat at its 18-month cap, and was
 *     thrown away without ever touching a price.
 *
 * A market that cannot clear on quantity clears on price, and the price it
 * reached for was rent: real office rent ran a ~30-year cycle with a 40-70%
 * drawdown, against a real office cycle of ~10-12 years. The rent oscillation
 * was the symptom; this was the cause.
 *
 * So the trades migrate. The workforce grows toward the size that would clear
 * the book and shrinks when there is nothing to do, at about a per cent a
 * month per unit of excess utilisation — a workforce that doubles in six years
 * under a sustained doubling of the order book, and sheds 6%/yr when half its
 * men are idle. US construction employment rose 45% over 2011-2019 and fell
 * 30% over 2006-2011, which is that order of speed.
 */
function tickCrews(s: GameState, bbls: string[]) {
  const e = s.econ;
  const owed = e.startOwed ? Object.values(e.startOwed).reduce((a, v) => a + Math.max(0, v), 0) : 0;
  const live = jobLoad(s);
  const capacity = crewCapacity(bbls, e);
  // Everything the town is trying to have built — the jobs running plus the
  // floor area ordered and not yet broken ground on — against what it can
  // carry at once. One means the trades are exactly fully employed.
  //
  // ...OVER A FLOOR OF WORK THAT IS NOT SPECULATIVE NEW BUILD. Measured
  // against new construction alone this ran to 0.05 at the p05, which says a
  // town's entire building industry stands idle in a downturn, and no town's
  // does: repair, renovation and fit-out are about 45% of all construction
  // work and they do not stop when the cranes do. Carrying that load means the
  // trades bottom out around 45% employed rather than at nothing, which is
  // both the real number and the reason construction costs do not swing as
  // violently as new-build volume does.
  //
  // ...AND THAT FLOOR OF WORK IS SIZED BY THE BUILDINGS, NOT BY THE BUILDERS
  // (2026-10-09). This read `capacity x 0.45/0.55` — repair work proportional
  // to the size of the WORKFORCE — so with no new build utilisation was
  // `steady / (capacity + steady)` = 0.45 whatever size the trades shrank
  // to. The workforce could therefore never shrink to fit its work: crewIdx
  // slid to its 0.5 guard (21% of months in seed 1000) with utilisation
  // still under one, and the cost index read permanently idle trades. Measured
  // over 2 cities x 50 years, `heat` took 0.7-1.9%/yr off real construction
  // cost for the whole century, and an asserted "fair" real-cost path in
  // market.ts was pushing 0.1-0.7%/yr back (active in 41-89% of months,
  // 8 cities). Two rails holding each other up.
  //
  // Repair and fit-out are a property of the standing stock: the town's
  // buildings need the same maintenance however many contractors are in it.
  // So the load is the stock-sized base crew count's maintenance share, and
  // the workforce that carries it scales with crewIdx. Utilisation then reads
  // the order book against the trades actually present, and a town with no
  // new build sheds builders until the ones left are fully employed —
  // which is what US construction employment did in 2006-11.
  const baseNew = capacity / Math.max(1e-6, e.crewIdx ?? 1);
  const steadyLoad = baseNew * (MAINTENANCE_SHARE / (1 - MAINTENANCE_SHARE));
  const workforce = Math.max(1, capacity + steadyLoad * (e.crewIdx ?? 1));
  const util = (live + owed / TYPICAL_SF + steadyLoad) / workforce;
  // A year's memory: a contractor hires on a book, not on a month.
  e.crewUtil = (e.crewUtil ?? util) + 0.08 * (util - (e.crewUtil ?? util));
  // The workforce that WOULD clear the book is the current one times how
  // oversubscribed it is; the industry walks toward it rather than jumping.
  const idx = e.crewIdx ?? 1;
  // ...AND CONTRACTORS GO UNDER WHEN THEY BID BELOW COST (2026-10-14). A lull
  // does not only idle men; a firm that wins work at a loss to keep its crew
  // together runs out of capital, and its crew leaves the trade. US
  // construction lost ~30% of its workforce over 2006-11, faster than idle
  // time alone explains. The loss scales with how far under cost bids are
  // (`bidPremium`, market.ts), and it is what makes the rebound sharp: the
  // order book returns to a smaller industry.
  const failing = Math.min(0, e.bidPremium ?? 0);
  e.crewIdx = idx * (1 + 0.010 * ((e.crewUtil ?? 1) - 1) + 0.06 * failing);
  // Land buyers are builders: the new-build book against what a town this
  // size ordinarily builds is how many bidders a lot has.
  const newBook = (live + owed / TYPICAL_SF) / Math.max(1e-6, baseNew);
  e.buildDemand = (e.buildDemand ?? newBook) + 0.08 * (newBook - (e.buildDemand ?? newBook));
  // ...against what THIS town has been building, over about a decade: a
  // built-out island and a frontier town each have their own normal year.
  e.buildNorm = (e.buildNorm ?? e.buildDemand) + 0.008 * (e.buildDemand - (e.buildNorm ?? e.buildDemand));
}

/**
 * Floor area of a typical building here, so the order book converts to a crane
 * count. 42,000 sf was right when infill was sized off the zoning envelope;
 * under the cornice-datum cap the measured median city building is ~26,000 sf,
 * and leaving the old figure in place silently halved the square footage the
 * space market ordered. The market's demand arrives as more, smaller buildings
 * now — which is what a low town growing visibly looks like.
 */
const TYPICAL_SF = 26_000;

/**
 * THE CREWS A TOWN HAS IN THE GROUND, IN TYPICAL BUILDINGS (2026-10-12).
 *
 * Capacity is sized in floor area — the share of the stock a town carries
 * under construction, divided by a typical building — and it was SPENT in
 * job counts: a 26,000 sf shed and an 800,000 sf tower each took one slot. So
 * the moment office pencilled, a handful of slots went to towers and a
 * quarter of the office stock went up in a few years (developer run, years
 * 61-80), while the shed that needed a twentieth of the crews waited behind
 * them for the same slot. A tower takes more crews, steel and cranes than a
 * shed in proportion to what it puts up; the load is the floor area.
 */
function jobLoad(s: GameState): number {
  let load = 0;
  for (const j of s.cityJobs ?? []) if (!j.orphaned) load += Math.max(0, j.sf ?? 0) / TYPICAL_SF;
  return load;
}

/**
 * The market still wants floor of this class, on the frictional rail.
 *
 * `startOwed` alone missed the catch-22: sitePencil is 0 when nothing
 * clears the parcel pro forma, so the monthly order is zero, so the book
 * is empty, so densify (which required a live book) never broke ground —
 * while `structTight` said jobs wanted 40% more floors than housable.
 * Measured seed 550991: 23 years of office vacancy at 3.68%, pipeline 0,
 * startOwed 0, office stock falling as teardowns converted it to housing
 * (the one class that still penciled).
 *
 * `structTight` alone missed the other seeds: vacancy on the rail with a
 * full book but employment-gap under 0.06. Either instrument is enough.
 */
/**
 * WHAT A REDEVELOPMENT GIVES UP (2026-10-10): the standing building as a
 * building — its income, capitalised — or, where no builder can use the dirt,
 * what a holder would pay for it. Not the land's builder residual.
 *
 * This was max(land value, asset value). A standing building's asset value is
 * floored at its land value, and where a builder wins the auction that land
 * value IS the residual of the best new building on the vacant lot, the
 * developer's margin already taken. So a replacement was charged its own value
 * as the price of the site, then the demolition on top, and read just under
 * its hurdle on exactly the lots that most needed redeveloping: cheap old
 * buildings on dear land. Measured on a 100-year Frontier town: in the ring
 * 300-450 m from the towers, 141-167 buildings of two storeys or less stood
 * on land priced at $1,700-5,900/sf with a 13-floor allowance, at year 100.
 * The redevelopment pays when the new building is worth more than the old
 * one plus the cost of clearing it, which is the teardown test in life.
 */
function redevelopmentBasis(rec: NonNullable<ReturnType<typeof resolveRec>>, e: Econ, grade: ReturnType<typeof gradeOf>): number {
  const asBuilding = incomeValueAsIs(rec, e, grade);
  const lr = landRead(rec, e);
  return lr.winner === "builder" ? asBuilding : Math.max(asBuilding, lr.psf * rec.lotArea);
}

function classPinnedOwed(e: Econ, k: BuiltClass, slack = 0.02): boolean {
  const vac = e.cityVac?.[k] ?? NATURAL_VAC[k];
  if (vac > frictionFloor(k) + slack) return false;
  return (e.structTight?.[k] ?? 0) > 0.06;
}

function tickTeardowns(s: GameState, parcels: ParcelTable, bbls: string[]) {
  // A slow clock. Roughly one candidate examined a month, and only the worst
  // offender in a sample gets the notice — a city does not clear a block a
  // month, it clears one building every year or two.
  // Calibrated against the real rate of loss. A city demolishes something like
  // half a per cent of its building stock a year; at the first cut of these
  // numbers the mean building age still rose forty-one years over fifty, which
  // is a town that replaces a tenth of itself in half a century and is still
  // mostly a museum.
  const e = s.econ;
  // Chronic shortage: examine more often. Employment gap (`structTight`) OR
  // a pinned class with unpaid orders — both mean the wrecking ball is how a
  // built-out city answers. Not a vac-coefficient hike.
  const chronicShort = BUILT_CLASSES.some((k) => {
    const pinned = (e.cityVac?.[k] ?? NATURAL_VAC[k]) <= frictionFloor(k) + 0.015;
    return pinned && ((e.structTight?.[k] ?? 0) > 0.08 || (e.startOwed?.[k] ?? 0) > 0);
  });
  // ONE CANDIDATE A MONTH, which is what the comment above has always said.
  // The skip used to be 0.85 — 15% of months, ~1.8 looks a year — so a
  // thousand-building town replaced ~0.1%/yr against a ~0.5% real-world
  // anchor and mean age climbed with the calendar. The roll is the same
  // draw as before (RNG-NOTE: more months now enter the sample below).
  // RETIRED (2026-10-09): the monthly skip. Teardowns were examined in 15% of
  // months (5% skipped in a shortage) and at most one went ahead — a clock,
  // not a decision. Measured over 4 worlds x 50 years: 29-43 of ~865 opening
  // buildings rebuilt (~0.1%/yr against the ~0.5% this block cites), and mean
  // building age 65 -> 99-107. (A parallel fix on main found the comparison
  // had also run backwards — skipping 85-95% of months, most in a shortage —
  // and measured Manhattan's floor area +42-60% by year 100 once it examined
  // 85-95% of months.) Every month now looks at its sample, and every site
  // whose replacement beats what is standing goes ahead, until the crews are
  // spoken for. RNG-NOTE: one fewer draw per month on "dev".
  void chronicShort;
  // A REPLACEMENT IS BUILT BY THE SAME CREWS AS EVERYTHING ELSE.
  //
  // This path is 96% of all the square footage this city builds, and it broke
  // ground without ever asking whether there was a contractor free. The quota
  // below it does ask — `Math.max(0, capacity - live)` — so teardowns were
  // spending the town's construction capacity from OUTSIDE the budget that was
  // supposed to ration it. The quota was therefore clipped to zero most
  // months by jobs it had no say over, which is why the vacancy gate on
  // starts — the line market.ts calls "the real control" — was measurably
  // inert: halving its gain produced byte-identical output over three seeds
  // and fifty years, because the thing it controlled was already pinned at
  // zero and the building was happening somewhere else.
  //
  // There is one crane pool in a town this size and every job queues in it.
  // Measured over 6 seeds x 50 years, this line plus the order-book fix below:
  // the share of stock under construction goes from a 0.0214 median with a
  // 0.126 maximum to a 0.0185 median with a 0.064 maximum — i.e. onto the
  // 0.018 the rest of the engine says this town builds at — the construction
  // employment term stops sitting on its clamp (31.5% of months -> 5.5%), and
  // starts stop being a relay pinned at hard zero (45.2% of months -> 12.7%).
  // Office sd(log) of real effective rent moves 0.356 -> 0.263 with it, and
  // retail 0.497 -> 0.259.
  // No crew wall on teardowns (2026-10-12): busy trades price the job through
  // the cost index (`heat`, market.ts), which the redevelopment test reads.
  // How MANY go in a month is the order book's, the same rule as new starts:
  // the floor ordered, in typical buildings, and at least one when called.
  // As many as developers are looking — the same `developerLooksPerMonth`
  // the vacant-lot search reads; each still has to clear its own pro forma.
  const crewRoom = Math.max(1, Math.round(developerLooksPerMonth(s.econ)));
  // Score by DENSIFICATION SURPLUS, not land/building alone. A cash-flowing
  // worn walk-up on a FAR-rich corner is the real redevelopment candidate in
  // a shortage; the old land/built ratio only found husks, and century nulls
  // rebuilt ~zero lots while jobs outran floors (ECONOMY.md §F #2 / CENTURY #6).
  type TearCand = {
    bbl: string;
    rec: NonNullable<ReturnType<typeof resolveRec>>;
    ratio: number;
    score: number;
    probeUse: DevUse;
    probeLead: BuiltClass;
  };
  const pool: TearCand[] = [];
  const sampleN = chronicShort ? 40 : 26;
  // After rentable, the single highest-score lot is the one that least
  // pencils: unused FAR is a bigger gross box, hard cost is on gross, income
  // is on rentable. Underwriting only that lot is why L fell to ~0.04%/yr.
  // The sample is the candidate set — underwrite them in score order and
  // take the first whose replacement actually clears.
  for (let i = 0; i < sampleN; i++) {
    const bbl = bbls[Math.floor(rng(s, "dev") * bbls.length)];
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    if (s.holdings[bbl] || s.developments[bbl]) continue;        // never yours
    if (s.cityGroundLeases?.[bbl]) continue;                     // leased fee sold off-book — lessee still controls
    if (s.landmarks?.[bbl] !== undefined) continue;              // and never a landmark
    if ((s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
    if (ownerOf(s, bbl)) continue;                               // named firm path is startOwnJob
    // NO BIRTHDAY AND NO GRADE TEST (2026-10-09). `age < 45` and "worn or
    // worse" were rules standing where a price belongs: a young or good
    // building is spared because what it is worth AS IT STANDS — the
    // opportunity cost the underwriting below now charges — is more than any
    // replacement can earn over its cost. That is the teardown test, and it
    // already says no to a sound building without being told to.
    const cond = gradeOf(s, rec);
    const land = landValue(rec, e);
    const built = Math.max(1, assetValue(rec, e, cond));
    const ratio = land / built;
    const probeUse = useForZone(rec.zoneDist ?? "C", rec.demandScore, rng(s, "dev"), e);
    const probeLead = dominantOf(devMix(probeUse));
    const infill = cityInfillCap(s, parcels, rec, probeLead);
    const targetSf = Math.max(3000, Math.round(rec.lotArea * cityCoverage(probeUse) * infill));
    const densify = targetSf / Math.max(1, rec.bldgArea);
    const st = e.structTight?.[probeLead] ?? 0;
    const condW = cond === "obsolete" ? 1.35 : cond === "worn" ? 1.15 : 1.0;
    // Land/built still matters (option value of dirt), but unused legal FAR
    // under a chronic short is the densify pressure the century was missing.
    // Structural manufacturing exit is NOT scored here — boosting soft sheds
    // into this sample wasted densify months on fringe sites whose MF/office
    // replacement does not pencil (measured: office pin and structTight
    // regressed). Surplus empty sheds clear via tickIndustrialExit instead.
    const score = (0.35 + Math.max(0, ratio)) * densify * condW * (1 + 2.2 * st);
    if (!pool.some((p) => p.bbl === bbl)) pool.push({ bbl, rec, ratio, score, probeUse, probeLead });
  }
  if (!pool.length) return;
  pool.sort((a, b) => b.score - a.score);
  // RNG-NOTE: one shared stream for the month, not one per candidate. The
  // second useForZone (a second answer for the same site) is gone — the
  // programme is the probe already drawn in the sample. inKind / share /
  // duration draws stay at one each, as before.
  const teardownRoll = rng(s, "dev");
  const inKindRoll = rng(s, "dev");
  const shareJitter = rng(s, "dev");
  const formerBuildRoll = rng(s, "dev");
  const formerDemoRoll = rng(s, "dev");
  void formerBuildRoll; void formerDemoRoll;

  // WHAT WOULD GO UP HERE IS DECIDED BEFORE THE BUILDING COMES DOWN, because
  // the only question that licenses a teardown is whether the REPLACEMENT
  // pencils, and that is a question about the replacement's class.
  //
  // This read `devPencils(e)` — and the signature is `devPencils(e, k =
  // "office")`, so the whole city's wrecking ball was gated on office
  // economics by an accident of a default argument. A glut in one class
  // therefore froze the recycling of every other, which is the wire running
  // backwards: a glut should raise the pressure to clear obsolete space, not
  // switch off the only mechanism that can clear it. Measured by decade over
  // five seeds, teardowns tracked office pencilling and nothing else —
  //
  //   teardowns          66.2  24.6  37.8  66.6  12.2
  //   devPencils(office)  1.22  0.48  0.72  1.38  0.22
  //
  // — while industrial demand fell to 0.62x with its stock sitting at 1.04x,
  // untouched, because office happened to be soft at the time.
  const yr0 = START_YEAR + Math.floor(s.month / 12);

  const chosen: {
    rec: TearCand["rec"]; ratio: number; bbl: string; oldSf: number;
    nextUse: DevUse; lead: BuiltClass; nsf: number; nfl: number;
    opportunityCost: number; plan: DevPlan; ltc: number;
  }[] = [];

  let examinedRedev = 0;
  for (const cand of pool) {
    const rec = cand.rec;
    let nextUse = cand.probeUse;
    let lead = cand.probeLead;
    const bbl = rec.bbl;
    const oldSf = rec.bldgArea;
    const cls = rec.class;
    // When the standing class is pinned and still wanted, densify IN KIND.
    // useForZone's programme mix was converting short office into multifamily
    // — supply answering the wrong demand, and (once the office book went
    // empty because nothing penciled) dismantling the class the city was
    // short of. classPinnedOwed now fires on the book OR on structTight.
    if (cls !== "land" && (CITY_STOCK as Record<string, number>)[cls] !== undefined) {
      const standing = cls;
      const stStand = e.structTight?.[standing] ?? 0;
      if (classPinnedOwed(e, standing) && inKindRoll < Math.min(0.92, 0.70 + stStand * 1.2)) {
        nextUse = standing;
        lead = standing;
      }
    }
    const stood = gradeOf(s, rec);
    const stoodAge = START_YEAR + Math.floor(s.month / 12) - (rec.yearBuilt || 1900);
    // US commercial economic life is 50–60 years (IRS depreciation is 39;
    // appraisers and BOMA use the longer life). Anonymous fabric never
    // starts obsolete, so "worn and 70" left the wrecking ball waiting on
    // a grade that nobody can earn. Sixty is the birthday, not a volume dial.
    // The order book and the age rule no longer gate this: a replacement that
    // beats the standing building's value is worth building whether or not
    // the space market has filed an order for it, and one that does not is
    // not, at any age. Vacancy reaches it through rent, exit cap and lease-up.
    void stood; void stoodAge;
    const leadShort = classPinnedOwed(e, lead)
      || ((e.structTight?.[lead] ?? 0) > 0.06
        && (e.cityVac?.[lead] ?? NATURAL_VAC[lead]) <= frictionFloor(lead) + 0.02);

    // NOBODY DEMOLISHES A BUILDING AND LEAVES A HOLE.
    //
    // A wrecking ball is the first line item of a development budget, not an end
    // in itself: you clear a site BECAUSE you have a project, financing and a
    // contractor, and the hoarding goes up the same season. This used to clear
    // the lot and trust that "the existing city and street builders will find it
    // like any other site" — and measured over 50 years with no player, they did
    // not. The city tore down 343 buildings and delivered 115, and the standing
    // stock fell from 1,030 to 802. That is not a city recycling itself, it is a
    // city being quietly dismantled.
    //
    // So the teardown IS the groundbreaking. The replacement is sized off the
    // envelope the site can now reach rather than off what stood here — which is
    // the entire reason the old building came down — and it is bound by the same
    // cornice datum and per-use floor caps every other city job respects, so a
    // three-storey town does not sprout a tower on one cleared lot.
    void farMaxFor;
    // HOW MUCH BIGGER IS A MARKET QUESTION. An unconditional 45-80% of the
    // envelope once grew the city's floor area ~50% in fifty years whatever
    // the vacancy (office rent at year 50 anywhere from $34 to $505 across
    // seven seeds). A share read off vacancy replaced it; the replacement
    // below answers the same question through the pro forma itself, which
    // prices a glut in effective rent and lease-up, so a building into slack
    // does not clear.
    // THE REPLACEMENT IS THE BEST BUILDING THE SITE WILL TAKE (2026-10-10),
    // not a use rolled off the zoning table's programme mix and sized as a
    // share of the envelope. A redeveloper asks what pays most here — every
    // use the zoning hosts, at every height on the shared ladder that adds at
    // least 8% to what stands — and builds that, if anything clears.
    //
    // Measured on a 100-year Frontier town over its first 50 years: 6,897
    // replacement plans examined, 2 approved, the rejected ones at a median
    // hurdle of 0.43 — while vacant lots in the same ring cleared at 1.6-2.8
    // on free land. The rolled use was often a class in glut and the share-
    // of-envelope height was rarely the one that pays, so the two-storey
    // fabric around the towers (141-168 buildings in the ring 300-450 m out,
    // on land at $1,700-15,000/sf) stood for a century. Ten candidates a
    // pass, in the order of the teardown score above.
    void examinedRedev;
    const opportunityCost = redevelopmentBasis(rec, e, gradeOf(s, rec));
    // THE SAME DEVELOPERS AS ON VACANT DIRT (2026-10-12): each candidate is
    // looked at by one shop drawn from the same population (`drawDeveloper`),
    // on its own spec, leverage, outlook and bar. A built-out city grows
    // through this path, so it cannot answer to one fixed hurdle while the
    // vacant lots answer to the whole spread of appetites.
    const rdev = drawDeveloper(s);
    if (demandIdx(rec.demandScore) < rdev.minDemand) continue;
    let bestU: ReturnType<typeof underwriteDevelopment> = null;
    let bestH = -Infinity;
    for (const k of BUILT_CLASSES) {
      if (!zonePermits(rec.zoneDist, k, rec.demandScore, e)) continue;
      const plate = cityCoverage(k);
      const env = Math.max(1, Math.min(cityInfillCap(s, parcels, rec, k), maxFloorsFor(rec, plate, k)));
      // THE MARKET ORDERED SO MANY FEET, HERE TOO (2026-10-10). The start path
      // caps a building at what is owed for its use; this path took the
      // best-clearing height whatever the book said and netted it off after.
      // Measured on a 100-year Frontier town: one replacement put 1.65M sf of
      // flats in the pipeline in a three-year window when the book had
      // ordered 92k and owed none, and flats vacancy went to 44%. The space a
      // replacement ADDS — less what stood, when it stood in the same use — is
      // held to the order, one storey always allowed.
      const owedK = Number.POSITIVE_INFINITY;   // no order cap: the pro forma's delivery vacancy sizes it
      const standsAsK = cls === k ? oldSf : 0;
      for (const fl of schemeFloorLadder(k, env)) {
        if (rec.lotArea * plate * fl < oldSf * 1.08) continue;
        if (fl > 1 && rec.lotArea * plate * fl - standsAsK > Math.max(owedK, rec.lotArea * plate)) continue;
        if (fl > rdev.maxFloors) continue;
        const u = underwriteDevelopment(s, parcels, bbl, k, fl, plate, opportunityCost, rdev.spec, rdev.ltc);
        if (!u || (!u.financeable && rdev.ltc > CASH_BUILDER_LTC)) continue;
        // Same size discipline as on vacant dirt: no bigger than this shop's
        // share of the class's standing stock.
        if (fl > 1 && u.plan.sf * (u.plan.mix?.[k] ?? 1) > rdev.maxShare * Math.max(1, e.stock?.[k] ?? 0)) continue;
        if (forwardVacancy(e, k, u.plan.sf * (u.plan.mix?.[k] ?? 1), u.plan.months) > NATURAL_VAC[k] + rdev.vacTol) continue;
        const h = hurdleAt(u.plan, DEV_MARGIN) * rdev.outlook * momentumRead(s, k, rdev.momentum) / rdev.bar;
        if (h < 1) continue;
        if (!bestU || h > bestH) { bestU = u; bestH = h; nextUse = k; lead = k; }
      }
    }
    if (!bestU) continue;
    void teardownRoll; void shareJitter; void stood; void stoodAge; void leadShort;
    const plan = bestU.plan;
    const nsf = plan.sf;
    const nfl = plan.floors;
    chosen.push({
      rec, ratio: cand.ratio, bbl, oldSf, nextUse, lead, nsf, nfl,
      opportunityCost, plan, ltc: rdev.ltc,
    });
    if (chosen.length >= crewRoom) break;
  }
  for (const pick of chosen) {
  const { rec, ratio, bbl, oldSf, nextUse, lead, nsf, nfl, opportunityCost, plan, ltc } = pick;
  const yr = yr0;
  const tprog = plan.mix;
  const months = plan.months;

  // With the town's builders as firms, a teardown is a firm's scheme: one of
  // the builders takes the site (or the street does) before anything comes
  // down, and if nobody named can carry it the building stands.
  // A redevelopment needs a balance sheet: it goes to the builder with the
  // most free cash, not to whichever shop happened to be looking.
  let teardownFirm: Rival | null = null;
  if (s.builderFirms) {
    const f = livingBuilderFirms(s).reduce<Rival | undefined>((a, r) => (!a || freeCash(s, r) > freeCash(s, a) ? r : a), undefined);
    (s.cityJobs ??= []).push({ bbl, use: nextUse, sf: nsf, floors: nfl, startM: s.month, deliverM: s.month + months, mix: tprog, spec: plan.spec });
    teardownFirm = (f ? claimJob(s, parcels, bbl, nextUse as DevUse, nsf, nfl, s.month + months, false, plan, f) : null)
      ?? claimJob(s, parcels, bbl, nextUse as DevUse, nsf, nfl, s.month + months, false, plan);
    if (!teardownFirm) { s.cityJobs = s.cityJobs.filter((j) => !(j.bbl === bbl && j.startM === s.month)); continue; }
  }

  // Off the record and off the stock only AFTER the replacement is funded.
  s.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  const stoodAs = rec.class !== "land" ? (rec.class as BuiltClass) : null;
  if (stoodAs && (CITY_STOCK as Record<string, number>)[stoodAs] !== undefined) {
    addStock(e, stoodAs as keyof typeof CITY_STOCK, -rentableSf(rec));
  }
  s.demolished = (s.demolished ?? 0) + 1;
  recordPropertyEvent(s, bbl, {
    kind: "demolished",
    sf: oldSf,
    use: stoodAs ?? undefined,
    outcome: `${rec.yearBuilt || "Older"} building cleared for ${nextUse}`,
  });

  // A teardown is a developer's scheme like any other — one of the town's.
  const tb = teardownFirm ? undefined : pickBuilder(s);
  if (tb) { tb.starts += 1; tb.lastStartM = s.month; }
  if (!teardownFirm) (s.cityJobs ??= []).push({ bbl, use: nextUse, sf: nsf, floors: nfl, startM: s.month, deliverM: s.month + months, mix: tprog, spec: plan.spec,
    merchant: merchantBook(s, bbl, s.month, plan, ltc),
    ...(tb ? { builderId: tb.id, coInvest: builderCoInvest(plan.basisTotal, ltc ?? 0.5) } : {}) });
  recordPropertyEvent(s, bbl, {
    kind: "build-start",
    use: nextUse,
    sf: nsf,
    floors: nfl,
    party: teardownFirm?.name ?? tb?.name ?? "The city",
  });
  // ...and the one delivery queue carries that same programme, whole.
  const teardownProgramme = programmeSf(rentableFromSpec(nsf, nfl), tprog);
  queueSupplyProject(s, {
    bbl,
    source: "teardown",
    deliverM: s.month + months,
    sfByUse: teardownProgramme,
  });
  // Public the day the wrecking ball swings: the next look this month sees it.
  syncSupplyViews(e, true);
  for (const [u, usf] of Object.entries(teardownProgramme)) {
    // ...AND THE ORDER BOOK IS TOLD. `startOwed` is the square footage the space
    // market has asked for and not yet seen broken ground on, and the quota
    // block downstream spends it. A replacement that goes up on this path fills
    // exactly the same order — it is the same crews, the same class, the same
    // month — and it was never netted off, so the city carried a permanent
    // phantom backlog and kept ordering cranes against demand it had already
    // met. Every other start path in this file already does this; this one did
    // not, and it is the biggest of them.
    if (s.econ.startOwed) {
      s.econ.startOwed[u as BuiltClass] = Math.max(0, (s.econ.startOwed[u as BuiltClass] ?? 0) - usf);
    }
  }

  {
    // A COIN FLIP IS NOT A RELEVANCE TEST, AND IT WAS STANDING IN FOR ONE.
    //
    // This read `rng(s, "dev") < 0.30`: file three teardowns in ten, chosen at random.
    // That number is not a fact about the world — it is a volume dial, put here
    // so the paper would not overflow, and it throttles the SIGNAL at exactly
    // the same rate as the noise. The city tears down about 6.4 buildings a
    // year and this printed a random 1.9 of them, which made it the single
    // loudest line on the tape while still managing to miss two thirds of the
    // demolitions on the player's own street.
    //
    // Every teardown is recorded now — the tape gets MORE complete, not less —
    // and it interrupts only when the wrecking ball is on a block the player
    // owns something on. Block, not district: the city has four districts, so
    // "somewhere in your district" is true of half the parcels in town and gets
    // truer as the player grows, which is why the paper was noisiest for the
    // busiest players. A block is about 3% of the city and is what a person
    // means by "near me".
    const yoursHere = Object.keys(s.holdings).some((b) => parcels[b]?.block === rec.block);
    const densifyX = nsf / Math.max(1, oldSf);
    const why = densifyX >= 1.25
      ? `the site densifies ${(densifyX).toFixed(1)}x under a ${lead} shortage`
      : ratio >= 0.85
        ? `the land under it is worth ${ratio.toFixed(1)}x the standing building`
        : `the replacement clears its full hurdle after charging $${(opportunityCost / 1e6).toFixed(1)}M for the building being sacrificed`;
    s.news.unshift({
      q: s.month, kind: yoursHere ? "event" : "info",
      text: `${rec.address} is coming down. It went up in ${rec.yearBuilt}, and ${why}. `
        + `${(nsf / 1000).toFixed(0)}k sf of ${nextUse} replaces it, opening ${monthLabel(s.month + months)}.`,
    });
  }
  void yr;
  }
}

/**
 * STRUCTURAL INDUSTRIAL EXIT — the mothballing half of manufacturing's leave.
 *
 * `industComp` (market.ts) declines at the NY/SF/London manufacturing
 * floor-space half-life. Rezoning via `useForZone` reads that decline, but
 * conversion still requires a replacement that pencils — and on this island's
 * M-land fringe, multifamily often does not. Measured before this path, on
 * five of six century seeds: industComp → 0.42, baseStock stuck at 1.0×,
 * physical stock −0.1%/yr, industrial vacancy soft 84% of months, real rent
 * ≈ −2.2%/yr. The composition index said the floor space had left; the map
 * kept every shed.
 *
 * Real cities did not wait for a midrise pro forma on every bay. Surplus empty
 * manufacturing stock was cleared to land (and later rebuilt when housing
 * penciled) — LIC, Williamsburg, Docklands. This retires EMPTY surplus toward
 * the composition envelope at the same historical rate industComp already
 * uses. It does not touch occupied space, player/rival holdings, or require a
 * replacement project. Teardown-for-replacement remains the conversion path
 * when a project clears.
 */
function tickIndustrialExit(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const e = s.econ;
  const ic = e.industComp ?? 1;
  // ANY SURPLUS, NOT ONLY THE SECULAR KIND (2026-10-15). This returned unless
  // the composition index had fallen under 0.92, so sheds emptied by the
  // town's own trades leaving (a logistics or apparel base in decline) had no
  // door at all: one seed sat on the 0.45 vacancy clamp for fifteen years
  // with composition at 0.94-0.81 and the shed stock 18% down from opening.
  // A deep glut that has lasted two years now qualifies whatever emptied it;
  // a shallower soft patch still needs the secular signal.
  const deepOld = (e.cityVac?.industrial ?? 0) > NATURAL_VAC.industrial + 0.05
    && (e.vacOverM?.industrial ?? 0) >= 24;
  if (ic > 0.92 && !deepOld) return;
  // DEFER TO EMPLOYMENT SHORTAGE, DON'T FREEZE. Clearing sheds onto the plat
  // while office cannot house its jobs hands vacant M-lots to multifamily
  // (useForZone reads industComp) and the shared crane pool follows them —
  // measured office structTight and real rent both worsened under a full-rate
  // clear. A hard freeze while office is pinned (~half a century) left
  // industrial soft 61% of months. Trickle clearance (~1/8 the ordinary rate)
  // still retires surplus floor space; densify keeps the crane priority.
  const officeShort = (e.structTight?.office ?? 0) > 0.08
    && (e.cityVac?.office ?? NATURAL_VAC.office) <= frictionFloor("office") + 0.015;
  const stock = e.stock?.industrial ?? 0;
  const occ = e.occupied?.industrial ?? 0;
  const vac = e.cityVac?.industrial ?? NATURAL_VAC.industrial;
  if (vac <= NATURAL_VAC.industrial + 0.015) return;
  // Envelope from OCCUPIED demand: stock that would put vacancy at natural
  // given today's tenants. Composition has already cut the looking pool;
  // what remains empty above natural is the surplus floor space that left
  // with manufacturing. (An absolute `stock0 × industComp` envelope ignored
  // job growth and aimed at a level the residual logistics market still
  // needed — clearance then either stalled or overshot.)
  const need = occ / Math.max(0.5, 1 - NATURAL_VAC.industrial);
  const empty = Math.max(0, stock - occ);
  const surplus = Math.min(Math.max(0, stock - need * 1.03), empty);
  if (surplus < 4000) return;
  // Clearance is lumpy (one building). Own RNG channel — must not steal
  // draws from teardown densify (`dev`).
  // The pace follows how much of the stock is surplus, as the all-class
  // valve does: a market a third empty clears most months.
  const share = surplus / Math.max(1, stock);
  if (rng(s, "indust") > (officeShort ? 0.12 : Math.min(0.9, 0.3 + 2.2 * share))) return;

  // Pick the worst empty-ish anon shed: old, worn, low demand, preferably M.
  // Thirty-six SHEDS looked at, not thirty-six lots: sheds are a few per cent
  // of the map, so a lot sample saw one or two a month and usually none fit.
  let worst: { bbl: string; rec: NonNullable<ReturnType<typeof resolveRec>>; score: number } | null = null;
  for (let i = 0, seen = 0; i < 600 && seen < 36; i++) {
    const bbl = bbls[Math.floor(rng(s, "indust") * bbls.length)];
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class !== "industrial" || !rec.bldgArea) continue;
    seen++;
    // Never scrap more empty surplus than exists — a single large bay can
    // overshoot; skip if it would cut into occupied stock.
    if (rec.bldgArea > surplus * 1.05) continue;
    if (s.holdings[bbl] || s.developments[bbl]) continue;
    if (s.cityGroundLeases?.[bbl]) continue;
    if (s.landmarks?.[bbl] !== undefined) continue;
    if ((s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
    if (ownerOf(s, bbl)) continue;
    const age = START_YEAR + Math.floor(s.month / 12) - (rec.yearBuilt || 1900);
    if (age < 35) continue;
    const cond = gradeOf(s, rec);
    if (cond !== "obsolete" && cond !== "worn" && cond !== "standard") continue;
    const condW = cond === "obsolete" ? 1.4 : cond === "worn" ? 1.15 : 1.0;
    const mZone = (rec.zoneDist ?? "").startsWith("M") ? 1.25 : 1.0;
    const score = condW * mZone * age * (1.15 - Math.min(1, rec.demandScore / 80));
    if (!worst || score > worst.score) worst = { bbl, rec, score };
  }
  if (!worst) return;
  const { bbl, rec } = worst;
  const oldSf = rec.bldgArea;
  s.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  addStock(e, "industrial", -rentableSf(rec));
  // Vacancy accounting: we cleared empty surplus. Keep occupied; next market
  // tick recomputes cityVac from occ/stock. Clamp occupied into housable if
  // a large shed somehow overshot (guard only).
  const house = housableStock(e, "industrial");
  if ((e.occupied?.industrial ?? 0) > house) {
    e.occupied!.industrial = house;
  }
  s.demolished = (s.demolished ?? 0) + 1;
  recordPropertyEvent(s, bbl, {
    kind: "demolished",
    sf: oldSf,
    use: "industrial",
    outcome: `${rec.yearBuilt || "Older"} industrial cleared — manufacturing footprint has left`,
  });
  if (rng(s, "indust") < 0.18) {
    s.news.unshift({
      q: s.month, kind: "info",
      text: `${rec.address} is coming down empty. The manufacturing that filled it is gone, `
        + `and nothing has taken the bay. The lot waits.`,
    });
  }
}

/**
 * SURPLUS EXIT FOR EVERY CLASS — the down half of the cycle finally has a door.
 *
 * A building that stops paying its keep leaves the market in life: demolition
 * with no replacement pro forma, abandonment, the land bank. US cities remove
 * roughly half a per cent of stock a year all-cause; a city in genuine decline
 * clears 1–2%/yr for decades (Detroit, Youngstown). This engine had that valve
 * for industrial only (`tickIndustrialExit`), so a secular office or housing
 * glut was an ABSORBING STATE: measured on the 80-year campaign, one seed sat
 * ON the 0.45 cityVac clamp for 23 straight years with true vacancy ~56%,
 * concessions pinned at their cap for 38 years, and the stock fell 3% while
 * the demand pool fell 45%. The 0.45 clamp, the concession cap and the
 * cap-rate ceiling were all load-bearing over exactly this hole (CLAUDE.md
 * fake #5, three times over) — the rails were standing in for the wrecking
 * ball.
 *
 * The decision here is the one an owner of a dead building actually makes —
 * a carrying-cost decision, NOT a development hurdle. Demolition-for-
 * replacement stays in `tickTeardowns`; this clears EMPTY surplus in a market
 * that has been deep over natural for years, one worn old low-demand building
 * at a time, on its own RNG channel so the main dice never re-roll.
 *
 * Gates, in order: the glut must be DEEP (5pp over natural — nobody clears a
 * cyclical soft patch) and OLD (two years past the capitulation clock's last
 * renewal — owners wait, then concede), and the surplus must survive the same
 * occupied-demand envelope the industrial valve uses, so clearance can never
 * cut into space tenants are using. The pace scales with how much of the
 * stock is surplus — a 50%-empty market clears ~5–6 buildings a year, a
 * marginally-soft one almost none — which is the historical range, cited
 * above, not a balance choice.
 */
function tickSurplusExit(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const e = s.econ;
  // ONE WRECKING BALL, CITY-WIDE — not one per glutted class. The first cut
  // ran this loop per class with independent dice, and a seed whose office,
  // retail AND housing were all in secular decline cleared ~8 buildings a
  // year for decades: 2 of 5 procedural seeds lost 42-50% of their building
  // count in 50 years (city:accept J), which is past the worst sustained
  // record anywhere — Detroit's clearance peaked near 1%/yr of structures,
  // with public land banks doing the work, and took sixty years to remove a
  // third of the city. A month has one demolition story at most; the deepest
  // class gets it. That caps distress clearance near ~6 buildings a year on
  // this map — the historical worst case — as a consequence of the draw
  // structure rather than a quota.
  const cand: { use: BuiltClass; surplus: number; stock: number }[] = [];
  // NOT INDUSTRIAL (tried 2026-10-14, reverted): the shed trades leave town
  // when there is no shed space for them (market.ts, "SHEDS THE SAME WAY"),
  // so clearing sheds here shrank demand with the stock — measured on one
  // seed, 40% of the shed stock gone and real industrial rent still fell
  // from 1.36x to 0.59x. Industrial has its own valve.
  for (const use of ["office", "retail", "multifamily"] as BuiltClass[]) {
    const natural = NATURAL_VAC[use];
    const vac = e.cityVac?.[use] ?? natural;
    if (vac <= natural + 0.05) continue;                    // deep, not cyclical
    if ((e.vacOverM?.[use] ?? 0) < 24) continue;            // old, not new
    const stock = e.stock?.[use] ?? 0;
    const occ = e.occupied?.[use] ?? 0;
    // Stock that would put vacancy at natural given today's tenants — same
    // envelope as the industrial valve. Clearance never touches occupied space.
    const need = occ / Math.max(0.5, 1 - natural);
    const empty = Math.max(0, stock - occ);
    const surplus = Math.min(Math.max(0, stock - need * 1.03), empty);
    if (surplus < 8000) continue;
    cand.push({ use, surplus, stock });
  }
  if (!cand.length) return;
  // Odds scale with the worst class's surplus share; the pick follows the
  // surplus square footage, so the deepest glut clears first.
  const worstShare = Math.max(...cand.map((c) => c.surplus / Math.max(1, c.stock)));
  const p = Math.min(0.5, Math.max(0.06, worstShare * 2.2));
  if (rng(s, "exit") > p) return;
  const totSurplus = cand.reduce((a, c) => a + c.surplus, 0);
  let roll = rng(s, "exit") * totSurplus;
  let chosen = cand[0];
  for (const c of cand) { roll -= c.surplus; if (roll <= 0) { chosen = c; break; } }
  {
    const { use, surplus } = chosen;

    // The worst empty-ish anonymous building: old, worn, off the good corners.
    let worst: { bbl: string; rec: NonNullable<ReturnType<typeof resolveRec>>; score: number } | null = null;
    for (let i = 0; i < 36; i++) {
      const bbl = bbls[Math.floor(rng(s, "exit") * bbls.length)];
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || rec.class !== use || !rec.bldgArea) continue;
      if (rec.bldgArea > surplus * 1.05) continue;          // never overshoot into occupied
      if (s.holdings[bbl] || s.developments[bbl]) continue;
      if (s.cityGroundLeases?.[bbl]) continue;
      if (s.landmarks?.[bbl] !== undefined) continue;
      if ((s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
      if (ownerOf(s, bbl)) continue;
      const age = START_YEAR + Math.floor(s.month / 12) - (rec.yearBuilt || 1900);
      if (age < 30) continue;
      const cond = gradeOf(s, rec);
      if (cond !== "obsolete" && cond !== "worn" && cond !== "standard") continue;
      const condW = cond === "obsolete" ? 1.4 : cond === "worn" ? 1.15 : 1.0;
      const score = condW * age * (1.15 - Math.min(1, rec.demandScore / 80));
      if (!worst || score > worst.score) worst = { bbl, rec, score };
    }
    if (!worst) return;
    const { bbl, rec } = worst;
    const oldSf = rec.bldgArea;
    s.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
    addStock(e, use, -rentableSf(rec));
    const house = housableStock(e, use);
    if ((e.occupied?.[use] ?? 0) > house) e.occupied![use] = house;
    s.demolished = (s.demolished ?? 0) + 1;
    recordPropertyEvent(s, bbl, {
      kind: "demolished",
      sf: oldSf,
      use,
      outcome: `${rec.yearBuilt || "Older"} ${use} cleared empty — the market it was built for has left`,
    });
    if (rng(s, "exit") < 0.18) {
      s.news.unshift({
        q: s.month, kind: "info",
        text: `${rec.address} is coming down empty. ${use === "multifamily" ? "The flats" : "The floors"} `
          + `have sat dark for years and nobody is coming back for them. The lot waits.`,
      });
    }
  }
}

/**
 * THE STOCK NOBODY CAN POINT AT LEAVES TOO (2026-10-15).
 *
 * The market's inventory is the island's buildings plus, for a class the map
 * shows thinly, a regional floor (`stockFromParcels`: 7.8% of the town) — the
 * mainland sheds and strip retail the island's tenants also take. The two exit
 * valves above demolish MAPPED buildings, so the floor's share of a glut had no
 * door: measured on one seed, a town whose logistics and apparel base emptied
 * its sheds sat on the 0.45 vacancy clamp for fifteen years with 482k sf of
 * industrial stock of which 18k stood on the map. Mainland sheds are cleared
 * and converted like any others — SoHo and Tribeca lofts, Brooklyn's
 * waterfront, the Rust Belt's land banks.
 *
 * Same gates as the all-class valve (deep and two years old) and the same
 * envelope (never into occupied space), on the off-map share of the surplus
 * only. The pace is proportional to how empty the class is: a market 40%
 * empty retires ~5%/yr of its off-map stock, the clearance rate of a city in
 * genuine decline (Detroit, Youngstown); a shallow glut almost none. No dice.
 */
function retireOffMapSurplus(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const e = s.econ;
  if (!e.offMapSf) {
    const mapped: Record<BuiltClass, number> = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    for (const bbl of bbls) {
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      // Counted as stockFromParcels counts it: by mix where there is one.
      const letSf = rentableSf(rec);
      if (rec.mix) for (const k of BUILT_CLASSES) mapped[k] += letSf * (rec.mix[k] ?? 0);
      else if (rec.class in mapped) mapped[rec.class as BuiltClass] += letSf;
    }
    e.offMapSf = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    for (const k of BUILT_CLASSES) e.offMapSf[k] = Math.max(0, (e.stock?.[k] ?? 0) - mapped[k]);
  }
  for (const k of BUILT_CLASSES) {
    const off = e.offMapSf[k] ?? 0;
    if (off < 1000) continue;
    const natural = NATURAL_VAC[k];
    if ((e.cityVac?.[k] ?? natural) <= natural + 0.05) continue;
    if ((e.vacOverM?.[k] ?? 0) < 24) continue;
    const stock = Math.max(1, e.stock?.[k] ?? 0);
    const occ = e.occupied?.[k] ?? 0;
    const need = occ / Math.max(0.5, 1 - natural);
    const surplus = Math.min(Math.max(0, stock - need * 1.03), Math.max(0, stock - occ));
    if (surplus <= 0) continue;
    const share = surplus / stock;
    const cut = Math.min(surplus * (off / stock), off * Math.min(0.004, share * 0.01));
    if (cut <= 0) continue;
    addStock(e, k, -cut);
    e.offMapSf[k] = off - cut;
  }
}

export function tickCityGrowth(
  s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null,
) {
  if (!s.cityJobs) s.cityJobs = [];
  // The trades read their own order book before the month's work is placed, so
  // the crew count this month reflects the queue they have been staring at.
  tickCrews(s, bbls);
  tickIndustrialExit(s, parcels, bbls);
  tickSurplusExit(s, parcels, bbls);
  retireOffMapSurplus(s, parcels, bbls);
  tickTeardowns(s, parcels, bbls);
  // Extra densify passes when the book is pinned short — one wrecking ball a
  // month cannot catch a multi-decade capacity shortfall.
  {
    const e2 = s.econ;
    const bookShort = BUILT_CLASSES.some((k) => classPinnedOwed(e2, k, 0.015));
    const shortOf = (th: number) => BUILT_CLASSES.some((k) => (e2.structTight?.[k] ?? 0) > th
      && (e2.cityVac?.[k] ?? NATURAL_VAC[k]) <= frictionFloor(k) + 0.015);
    if (bookShort || shortOf(0.08)) tickTeardowns(s, parcels, bbls);
    if (shortOf(0.16)) tickTeardowns(s, parcels, bbls);
  }

  // ---- deliveries first: today's opening was somebody's decision years ago --
  const still: NonNullable<GameState["cityJobs"]> = [];
  for (const j of s.cityJobs) {
    // An orphaned frame does not finish itself. It stands there until the
    // receiver sells it, and the buyer decides whether it ever opens.
    // (A cleared marker is not a building — see A CLEARED LOT below: reading
    // the key's presence dropped every orphaned teardown frame on the spot.)
    if (j.orphaned) { if (!((s.built[j.bbl]?.bldgArea ?? 0) > 0) && !s.holdings[j.bbl]) still.push(j); continue; }
    if (s.month < j.deliverM) { still.push(j); continue; }
    const rec = parcels[j.bbl];
    // A CLEARED LOT IS NOT A BUILT ONE. This read `s.built[j.bbl]` as "somebody
    // has already put something here" — but tickTeardowns writes a CLEARED
    // marker into exactly that map ({class:"land", bldgArea:0}) to take the old
    // building off the record. So every redevelopment job died silently on the
    // day it was due to open: measured, the city started 200-odd replacements
    // over fifty years and delivered eight. Test the square footage, not the
    // presence of a key.
    const standing = s.built[j.bbl];
    // A ground lessee builds on YOUR deed — the holding stays; the improvement
    // is theirs until reversion. Ordinary city jobs still refuse to deliver
    // onto a holding (that would gift the player a free building).
    if (!rec || (s.holdings[j.bbl] && !j.groundLease) || (standing && standing.bldgArea > 0)) continue;
    // THE CITY'S BUILDINGS GET THEIR GROUND FLOOR TOO. This is where the
    // volume is — the street starts 250-odd jobs a century against the
    // player's handful — so a shops-at-grade rule the city did not follow
    // would supply almost no retail at all.
    const cmix = j.mix ?? capRetail(
      withStreetRetail(devMix(j.use as DevUse), j.floors, rec.demandScore ?? 50, s.econ), j.floors);
    s.built[j.bbl] = {
      class: dominantOf(cmix), mix: cmix, bldgArea: j.sf, floors: j.floors,
      yearBuilt: START_YEAR + Math.floor(s.month / 12),
      ...(j.spec !== undefined ? { buildSpec: j.spec } : {}),
    };
    const cBlock = demandModel(parcels).ofBbl.get(j.bbl);
    if (cBlock) nudgeBlockDemand(s, cBlock, Math.min(3, 0.8 + j.sf / 180_000));
    recordPropertyEvent(s, j.bbl, {
      kind: "delivered",
      use: dominantOf(cmix),
      sf: j.sf,
      floors: j.floors,
      party: j.groundLease
        ? (s.groundLeases?.[j.bbl]?.tenant
          ?? s.cityGroundLeases?.[j.bbl]?.tenant
          ?? "Ground lessee")
        : j.firmId
          ? (s.rivals.find((r) => r.id === j.firmId)?.name ?? "Developer")
          : "The city",
    });
    s.cityBuilt.push(j.bbl);
    if (j.groundLease) {
      const gl = s.groundLeases?.[j.bbl] ?? s.cityGroundLeases?.[j.bbl];
      if (gl) {
        gl.builtM = s.month;
        gl.sf = j.sf;
        gl.floors = j.floors;
        gl.use = dominantOf(cmix);
      }
      // Only news when the fee is still yours — an off-book leased fee topping
      // out is the buyer's story, not a line in your paper.
      if (s.groundLeases?.[j.bbl]) {
        s.news.unshift({
          q: s.month, kind: "info",
          text: `Your ground lessee topped out at ${rec.address}: ${j.floors} fl of ${dominantOf(cmix)} `
            + `(${Math.round(j.sf).toLocaleString()} sf). The coupon does not change — the bones revert with the land.`,
        });
      }
    } else if (j.firmId) {
      // If it had a name on it, the name now owns a building.
      jobDelivered(s, parcels, j.bbl, j.firmId, j.cost ?? 0);
    } else if (j.merchant) {
      const b = builderById(s, j.builderId);
      const worth = settleMerchant(s, parcels, j.bbl, j.merchant, b);
      if (b && b.failedM === undefined) settleBuilder(s, b, j, worth, rec.address);
      // ...AND SO IS ITS OPENING, against what it cost.
      const lead = dominantOf(j.mix ?? devMix(j.use as DevUse));
      if (b && worth !== undefined && j.sf * (j.mix?.[lead] ?? 1) >= 0.015 * Math.max(1, s.econ.stock?.[lead] ?? 0)
          && !(j.merchant.lender && worth < j.merchant.loan)) {
        const r = worth / Math.max(1, j.merchant.basis);
        s.news.unshift({
          q: s.month, kind: r >= 1 ? "info" : "warn", bbl: j.bbl,
          text: `${b.name} opened ${rec.address} — ${Math.round(j.sf).toLocaleString()} sf of ${lead} into `
            + `${((s.econ.cityVac?.[lead] ?? 0) * 100).toFixed(1)}% vacancy, worth ${Math.round(r * 100)}% of what it cost to build`
            + (r >= 1.15 ? ". A good one." : r < 1 ? ". The partners will not be pleased." : "."),
        });
      }
    } else if (j.builderId) {
      const b = builderById(s, j.builderId);
      if (b && b.failedM === undefined) settleBuilder(s, b, j, undefined, rec.address);
    }
    // NOTE: no addStock here. The square feet went into the econ pipeline the
    // month the job STARTED and land in the citywide stock when its cohort
    // matures — counting them again on delivery would double the building.
    bumpLand(s, j.bbl, 1.05);
    for (const nb of adjacency?.[j.bbl] ?? []) bumpLand(s, nb, 1.03);
    // AND AN ORDINARY BUILDING OPENING IS NOT NEWS EITHER. Same reasoning as
    // the sale line in actions.ts: the city delivers 115-150 buildings in fifty
    // years and printing every one of them crowds out the paper. What stays is
    // what a principal would be told — supply landing in a submarket where you
    // own something and will be competing with it for tenants, or a building
    // tall enough to be the tallest thing anyone has put up lately.
    const near = Object.keys(s.holdings).some((b2) => {
      const r2 = resolveRec(parcels, s, b2);
      return r2 && r2.district === rec.district;
    });
    const tall = j.floors >= 8 && !(s.cityJobs ?? []).some((o) => o.bbl !== j.bbl && (o.floors ?? 0) > j.floors);
    // Ground-lessee toppings already filed their own line above.
    if (!j.firmId && !j.groundLease && (near || tall)) {
      s.news.unshift({
        q: s.month, kind: "info",
        text: near
          ? `${j.floors} floors of ${j.use} opened at ${rec.address}, in ${districtLabel(rec)} — that is space competing with yours.`
          : `A ${j.floors}-story ${j.use} building opened at ${rec.address}, the tallest thing to top out in a while.`,
      });
    }
  }
  s.cityJobs = still;

  // DEVELOPERS LOOK, AND BUILD WHAT PAYS (2026-10-12) — see `developerLook`.
  // There is no order to fill: what gets started is whatever clears its own
  // pro forma at the owner's asking price for the dirt, with the pipeline and
  // the building itself in the vacancy it will lease into.
  const looksF = developerLooksPerMonth(s.econ);
  tickBuilders(s, looksF);
  breakCommittedPlans(s, parcels, adjacency);
  let looks = Math.floor(looksF) + (rng(s, "dev") < looksF % 1 ? 1 : 0);
  while (looks-- > 0) developerLook(s, parcels, bbls, adjacency);
}

/**
 * A DEVELOPER LOOKS AT SITES (2026-10-12).
 *
 * The owner's description of development, and the whole of it: a developer
 * sees a site and the price the owner wants for the land, works out the rent
 * the building would get and the vacancy now and when it delivers, runs the
 * numbers, and builds if it pays. How much the town builds is the sum of
 * those decisions — there is no order book, no queue, no gate.
 *
 * This replaced a relay of eight stages (an order sized by the class pencil
 * and zeroed unless the 97th-percentile site cleared, an entitlement queue,
 * an eighteen-month shelf, a class chosen by the largest order, a lot
 * contest, a size cap at the order, the claim, the build) that behaved like a
 * dam: nothing for years at 1% vacancy, then a third of the stock at once.
 *
 * Three things keep a crowd of developers from all building on the same day,
 * and all three are real: each underwrites delivery vacancy including the
 * pipeline already started and their own building (`forwardVacancy`), so
 * every start makes the next one harder; each project has its own cost
 * (`projectCostMult`) and each lot its own land price; and only a few
 * developers are looking in any month (`developerLooksPerMonth`).
 */
function developerLook(
  s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null,
  opts?: { backdate?: number; quiet?: boolean },
): boolean {
  if (!s.cityJobs) s.cityJobs = [];
  const ownMoney = streetHasOwnMoney(s);
  // ONE OF THE TOWN'S DEVELOPERS is looking — with its own habits, and its
  // rent read moving a little from one look to the next.
  // The frames already standing when the game opens (a backdated look) are
  // history and stay the city's; every look after that is one of the firms.
  const firm = s.builderFirms && opts?.backdate === undefined ? pickBuilderFirm(s) : undefined;
  if (s.builderFirms && opts?.backdate === undefined && !firm) return false;
  const who = firm ? undefined : pickBuilder(s);
  const habits = firm?.builderProf ?? who?.prof;
  const dev: DeveloperProfile = habits ? { ...habits, outlook: habits.outlook * Math.exp(0.03 * (2 * rng(s, "dev") - 1)) } : drawDeveloper(s);
  // A firm's purse is its free cash: what it holds less what its live jobs still need.
  const purse = firm ? Math.max(0, freeCash(s, firm)) : who ? Math.max(0, who.capital - who.committed) : Infinity;
  let best: { bbl: string; rec: (typeof parcels)[string]; use: DevUse; floors: number; plate: number; h: number; coInvest: number } | null = null;
  let examined = 0;
  for (let draw = 0; draw < SITES_PER_LOOK * 8 && examined < SITES_PER_LOOK; draw++) {
    const bbl = bbls[Math.floor(rng(s, "dev") * bbls.length)];
    // A lot that is land again — burned (blackswans.ts) or knocked down and
    // never rebuilt — is a site like any other; an override that is a
    // building is not.
    const over = s.built[bbl] as { class?: string } | undefined;
    if (s.holdings[bbl] || (over && over.class !== "land") || s.developments[bbl]) continue;
    if (s.cityJobs.some((j) => j.bbl === bbl)) continue;
    if ((s.cityPlans ?? []).some((p) => p.bbl === bbl)) continue;   // tied up by another developer
    if (isCivicLand(s, bbl)) continue;
    if (ownerOf(s, bbl)) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class !== "land" || rec.lotArea < 1500) continue;
    examined++;
    // Where this developer works: a prime-site developer passes over the fringe.
    if (demandIdx(rec.demandScore) < dev.minDemand) continue;
    for (const base of dev.uses) {
      const use: DevUse = base === "retail" && retailWantsMixed(rec) ? "mixed" : base;
      const lead = dominantOf(devMix(use));
      const plate = cityCoverage(use);
      const env = Math.max(1, Math.min(cityInfillCap(s, parcels, rec, lead), maxFloorsFor(rec, plate, use)));
      const top = Math.max(1, Math.min(env, dev.maxFloors));
      for (const fl of schemeFloorLadder(lead, top)) {
        const u = underwriteDevelopment(s, parcels, bbl, use, fl, plate, undefined, dev.spec, dev.ltc);
        // A developer writing most of the cheque from its own money does not
        // need the construction desk open: when the banks will not lend, the
        // cash-heavy ones still build what pencils.
        if (!u || (!u.financeable && !ownMoney && dev.ltc > CASH_BUILDER_LTC)) continue;
        // A MERCHANT BUILDER BUILDS ON THE BANK'S NUMBERS (2026-10-14). The
        // construction advance is now capped at 75% of the bank's appraisal
        // of the finished building (developmentProForma); a shop that runs on
        // borrowed money and cannot get near the leverage it runs on does not
        // write the difference out of hope. Only the equity builders — about
        // a quarter of the street — can still back a scheme the bank will not.
        if (dev.ltc > CASH_BUILDER_LTC && u.plan.ltcMax < dev.ltc - 0.05) continue;
        // SIZE AGAINST THE MARKET: no bigger than the share of the class's
        // stock this shop will put into one building.
        const ownSf = u.plan.sf * (u.plan.mix?.[lead] ?? 1);
        if (ownSf > dev.maxShare * Math.max(1, s.econ.stock?.[lead] ?? 0) && fl > 1) continue;
        // VACANCY AT DELIVERY THIS SHOP WILL LEASE INTO, its own building
        // and everything already in the ground included.
        // TO ITS OWN DELIVERY DATE (2026-10-13). The tenant base's trend
        // growth was extrapolated over a fixed 18 months, but a scheme decided
        // today opens after its lead time and its build — three to five years
        // for a tower. Every developer in a boom underwrites the boom running
        // to the day its own building opens; that shared extrapolation, read
        // over the real horizon, is what fills a market faster than demand
        // turns out to grow (Wheaton 1999). Read over 18 months, every shop
        // was more cautious than any real one and no market overshot.
        if (forwardVacancy(s.econ, lead, ownSf, u.plan.months + PLAN_LEAD_M[lead]) > NATURAL_VAC[lead] + dev.vacTol) continue;
        // THEIR OWN READ: yield on cost over the exit cap at the trade margin,
        // through their rent outlook and how they read the market's direction.
        // ...but only on a scheme that already clears its spread on today's
        // rent, whatever it believes about tomorrow's.
        if (hurdleAt(u.plan, DEV_MARGIN) * (1 + DEV_MARGIN) < spreadFloor(dev)) continue;
        // ...and only what its own money can carry its share of.
        const coInvest = builderCoInvest(u.plan.basisTotal, dev.ltc);
        if (coInvest > purse) continue;
        const h = hurdleAt(u.plan, DEV_MARGIN) * dev.outlook * momentumRead(s, lead, dev.momentum);
        if (!best || h > best.h) best = { bbl, rec, use, floors: fl, plate, h, coInvest };
      }
    }
  }
  // Built only if the deal clears THIS developer's bar.
  if (!best || best.h < dev.bar) return false;
  // COMMITTED NOW, STARTED LATER (2026-10-13). The deal is decided here; the
  // hole is dug after the design, the permits and the construction loan —
  // months in which nobody else can see it. A pipeline report counts starts,
  // so every developer looking during a boom saw the same empty room and
  // nobody saw the others coming; that blindness, with the lag to delivery,
  // is how real markets overbuild (Wheaton 1999; the 1980s office wave was
  // decided in 1981-84 and delivered into 1986-90). Without it a start was
  // public the month it was decided, every developer underwrote everyone
  // else's building exactly, and gluts formed only when a recession arrived
  // after the cranes — office sat in excess vacancy 3-21% of years against
  // ~40-50% for US office since 1985. The lead time to a start is a shape
  // parameter, stated as such: about 15 months for an office scheme, 9 for
  // flats and shops, 6 for a shed.
  // (The opening's backdated pipeline still starts at once: it is history.)
  if (!opts?.backdate) {
    const lead = dominantOf(devMix(best.use));
    (s.cityPlans ??= []).push({
      bbl: best.bbl, use: best.use, floors: best.floors, plate: best.plate, spec: dev.spec, ltc: dev.ltc,
      decidedM: s.month, breakM: s.month + PLAN_LEAD_M[lead], ...(who ? { builderId: who.id } : {}), ...(firm ? { firmId: firm.id } : {}),
    });
    if (who) who.committed += best.coInvest;
    return true;
  }
  const started = breakCityGround(s, parcels, adjacency, best.bbl, best.rec, best.use, best.floors, best.plate, { ...opts, spec: dev.spec, ltc: dev.ltc, decided: true, builderId: who?.id, firmId: firm?.id });
  // THE NEXT DEVELOPER HEARS ABOUT THIS ONE (2026-10-12). Every look reads
  // the pipeline in its delivery vacancy, but that figure was last month's
  // snapshot, so the thirty-odd developers looking in one month all saw the
  // same room and a hot month started a third of a year's building at once.
  // A start is public the day the hole is dug — the permit, the crane, the
  // broker's pipeline report — so it counts for whoever looks next.
  if (started) syncSupplyViews(s.econ, true);
  return started;
}

/**
 * WHO IS LOOKING (2026-10-12). The owner: "some people okay with worse market
 * conditions and some with better ones, some who only want very high demand
 * parcels and build high quality buildings, and others okay with fringe
 * sites and smaller, plainer buildings ... a very large array of appetites."
 *
 * Every look is one developer drawn from a wide population, and it is the
 * population — not a rule — that decides where, what, when and how big:
 *   - BAR: the return over cost they need (lognormal around the trade margin,
 *     sigma 0.25). Aggressive ones build into a soft market; cautious ones
 *     wait for a strong one. When rents are high, vacancy low and debt cheap,
 *     more of them clear their bar and building surges; when it is hard, only
 *     the aggressive few do.
 *   - WHERE: a minimum site quality. About four in ten take any lot, a third
 *     want better-than-middling ground, a quarter work prime ground only.
 *   - QUALITY: prime-site developers build to a high spec (dearer to build,
 *     better rent); fringe developers to a plain one.
 *   - SIZE: prime developers build out the envelope; fringe operators one to
 *     four storeys.
 *   - WHAT: each specialises in one or two property types.
 * All of these are shape parameters for the spread of the industry, stated
 * as such; the pro forma — rent, vacancy now and at delivery, land at the
 * owner's ask, debt, cost — decides every deal.
 */
type DeveloperProfile = {
  bar: number; minDemand: number; spec: number; maxFloors: number; ltc: number; uses: DevUse[];
  /** The value/cost this shop needs on TODAY's numbers, before any outlook — see spreadFloor. */
  floor?: number;
  outlook: number; momentum: number; vacTol: number; maxShare: number;
};
function drawDeveloper(s: GameState): DeveloperProfile {
  const u = () => rng(s, "dev");
  const nrm = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, u()))) * Math.cos(2 * Math.PI * u());
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  // Every trait a sliding scale. Traits that travel together in the real
  // industry (prime ground, high spec, tall buildings, big projects) are
  // correlated through one "ambition" draw, each with its own noise; the
  // rest are independent, so two shops that agree on where can disagree on
  // when.
  const ambition = u();
  // HOW MUCH THEY BORROW: all cash (a family office, a REIT building to hold)
  // to a merchant builder's construction loan.
  // TWO POPULATIONS, NOT A UNIFORM SPREAD (2026-10-13). This was uniform
  // 0-75%, a mean of 37.5% — but spec construction is mostly bank-financed at
  // 55-80% of cost (MBA / Fed SLOOS construction terms; the legal ceiling is
  // 80%), and only a minority builds mostly with its own money. At 37.5%
  // nearly every scheme that opened into a glut still covered its loan, so
  // overbuilding cost its lenders almost nothing (measured: under $1.2M of
  // construction losses per five years with office at 14-18% vacancy).
  // About a quarter build on equity (0-25%), the rest borrow 55-80%. The
  // shares are stated, not fitted.
  const ltc = u() < 0.25 ? 0.25 * u() : 0.55 + 0.25 * u();
  // BAR: the margin over the trade spread they need. The hurdle already
  // carries the trade margin (DEV_MARGIN), so 1.0 is the standard shop.
  // Patient cash builds to a thinner spread over the cap rate than a levered
  // merchant who must also carry the construction loan's risk (~100bp vs
  // ~150-200bp over a ~7% cap: 0.92x to 1.07x the trade margin).
  const bar = (0.92 + 0.2 * ltc) * Math.exp(0.20 * nrm());
  // THE SPREAD ON TODAY'S RENT (2026-10-14). The bar above is a belief —
  // it rides on the shop's rent outlook and its read of momentum — and it had
  // no floor: with dozens of shops looking at every site, the scheme was
  // built by whichever drew the lowest bar, and measured, the median start
  // was worth 0.90-0.96 of its cost on its own untrended pro forma the day it
  // was decided. No merchant builder's lender or investment committee signs
  // that: the development spread is underwritten on current rents — a
  // stabilised yield on cost 100-200bp over the exit cap for levered merchant
  // builders (value/cost ~1.15-1.30), thinner for patient cash (~1.05).
  // Market practice (NCREIF / Green Street development-spread surveys; the
  // "untrended yield on cost" line of every merchant-build memo).
  const floor = Math.max(1.0, Math.min(1.25, 1.05 + 0.10 * (ltc / 0.8) + 0.04 * nrm()));
  // WHERE: a minimum site quality; ~4 in 10 take any lot.
  const pref = Math.max(0, ambition + 0.25 * nrm() - 0.25);
  const minDemand = Math.min(0.8, pref * 0.9);
  // QUALITY: one of the build tiers (`BUILD_TIERS`: Value, Standard, Premium,
  // Trophy). Prime-ground shops build up; so does patient money — a levered
  // merchant builder value-engineers to the exit, a cash-heavy core or
  // institutional builder builds the plant it will own for decades.
  const spec = buildTier(0.15 + 0.8 * clamp01(0.5 * ambition + 0.3 * (1 - ltc / 0.75) + 0.2 * u())).spec;
  // HEIGHT: two storeys to forty.
  const maxFloors = Math.max(1, Math.round(Math.exp(Math.log(2) + Math.log(40) * clamp01(0.7 * ambition + 0.3 * u()))));
  // SIZE AGAINST THE MARKET: the largest share of the class's standing stock
  // one project may be — 0.5% for a small shop to ~8% for a big one's tower.
  const maxShare = Math.exp(Math.log(0.005) + Math.log(16) * clamp01(0.6 * ambition + 0.4 * u()));
  // RENT OUTLOOK: the same rent read +/-10% (heterogeneous beliefs — Miller
  // 1977; Harrison & Kreps 1978). Optimists move first, pessimists wait.
  const outlook = Math.exp(0.10 * nrm());
  // MOMENTUM: -1 a contrarian (builds into a falling market, when land and
  // trades are cheap and it will deliver into the recovery) .. +1 a trend
  // follower (extrapolates where rent is heading).
  const momentum = 2 * u() - 1;
  // VACANCY TOLERANCE: how far over the class's natural vacancy at delivery
  // they will still lease into — from needing a tight market to not caring.
  const vacTol = -0.03 + 0.18 * u();
  // WHAT: random weights over the four types, keeping those that carry real
  // weight — most shops do one or two things.
  const types: DevUse[] = ["multifamily", "office", "industrial", "retail"];
  const base = [0.40, 0.22, 0.20, 0.18];
  const w = types.map((_, i) => base[i] * -Math.log(Math.max(1e-9, u())));
  const top = Math.max(...w);
  const uses = types.filter((_, i) => w[i] >= 0.45 * top);
  return { bar, floor, minDemand, spec, maxFloors, ltc, uses, outlook, momentum, vacTol, maxShare };
}

/**
 * HOW A SHOP READS WHERE RENT IS HEADING: the market's own rent rule at
 * today's vacancy (`rentDriftAt`), over the two years to delivery, weighted
 * by their momentum — a trend follower adds it, a contrarian leans against
 * it. Capped at +/-25% so a belief is never larger than a cycle.
 */
function momentumRead(s: GameState, k: BuiltClass, momentum: number): number {
  const gap = (s.econ.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
  const drift = Math.max(-0.25, Math.min(0.25, rentDriftAt(k, gap) * 24));
  return Math.exp(momentum * drift);
}

/** Developers SITES_PER_LOOK examines in one look — a broker's shortlist. */
const SITES_PER_LOOK = 24;
/** At or below this loan-to-cost a developer funds the job without the construction desk. */
const CASH_BUILDER_LTC = 0.25;
/** Months from a developer's commitment to the start on site, by lead use (see `developerLook`). */
const PLAN_LEAD_M: Record<BuiltClass, number> = { office: 15, multifamily: 9, retail: 9, industrial: 6 };

/**
 * THE COMMITTED SCHEMES BREAK GROUND. A plan whose lead time is up starts
 * on site whatever the market has done meanwhile — the land is bought and
 * the design paid for — unless the lot has gone to someone else, or the
 * construction desk will not lend and the developer cannot fund it alone
 * (the schemes that died in 2008 were the levered ones).
 */
function breakCommittedPlans(s: GameState, parcels: ParcelTable, adjacency: Record<string, string[]> | null) {
  if (!s.cityPlans?.length) return;
  const keep: NonNullable<GameState["cityPlans"]> = [];
  const ownMoney = streetHasOwnMoney(s);
  for (const p of s.cityPlans) {
    // A developer that has folded takes its unstarted schemes with it.
    if (p.builderId && builderById(s, p.builderId)?.failedM !== undefined) continue;
    if (p.firmId) { const f = (s.rivals ?? []).find((r) => r.id === p.firmId); if (!f || f.failedM !== undefined || f.retiredM !== undefined) continue; }
    if (s.month < p.breakM) { keep.push(p); continue; }
    if (s.holdings[p.bbl] || (s.built[p.bbl]?.bldgArea ?? 0) > 0 || s.developments[p.bbl] || (s.cityJobs ?? []).some((j) => j.bbl === p.bbl) || ownerOf(s, p.bbl)) continue;
    const rec = resolveRec(parcels, s, p.bbl);
    if (!rec || rec.class !== "land") continue;
    const u = underwriteDevelopment(s, parcels, p.bbl, p.use as DevUse, p.floors, p.plate, undefined, p.spec, p.ltc);
    if (!u || (!u.financeable && !ownMoney && p.ltc > CASH_BUILDER_LTC)) continue;
    // SHELVED AT THE LAST LOOK. The scheme is re-priced at ground-break —
    // land at today's ask, today's trades — and a builder whose spread has
    // gone negative in the months of design and permits does not dig: the
    // deposit on the land and the drawings are written off and the site
    // waits (the shelved-scheme lists of 1990, 2008-09).
    if (hurdleAt(u.plan, DEV_MARGIN) * (1 + DEV_MARGIN) < SHELVE_AT) continue;
    if (breakCityGround(s, parcels, adjacency, p.bbl, rec, p.use as DevUse, p.floors, p.plate, { spec: p.spec, ltc: p.ltc, decided: true, builderId: p.builderId, firmId: p.firmId })) syncSupplyViews(s.econ, true);
  }
  s.cityPlans = keep;
}
/**
 * HOW MANY DEVELOPERS ARE LOOKING THIS MONTH. A growing US metro delivers
 * about 1.8% of its stock a year (see `crewCapacity`), in buildings of about
 * TYPICAL_SF; most looks find nothing that pays, so four looks for every
 * ordinary start — a shape parameter, stated as such. The number only sets
 * how often the market is sampled: what gets built is decided by the pro
 * forma, and a hot market converts more of its looks.
 */
/** A shop's untrended value/cost floor; old saves derive it from leverage. */
function spreadFloor(dev: { floor?: number; ltc: number }): number {
  return dev.floor ?? Math.max(1.0, Math.min(1.25, 1.05 + 0.10 * (dev.ltc / 0.8)));
}
/** Below this value/cost on the re-priced plan, a decided scheme is shelved rather than started. */
const SHELVE_AT = 0.97;
function developerLooksPerMonth(e: Econ): number {
  let stock = 0;
  for (const k of BUILT_CLASSES) stock += e.stock?.[k] ?? 0;
  return Math.max(0.5, (stock * 0.018 / 12 / TYPICAL_SF) * 32);
}

function breakCityGround(
  s: GameState, parcels: ParcelTable, adjacency: Record<string, string[]> | null,
  bbl: string, rec: NonNullable<ParcelTable[string]>, use: DevUse, floors: number, plate: number,
  opts?: { backdate?: number; quiet?: boolean; spec?: number; ltc?: number; decided?: boolean; builderId?: string; firmId?: string },
): boolean {
  let sf = Math.max(3000, Math.round((rec.lotArea * plate * floors) / 100) * 100);
  const lead = dominantOf(devMix(use));
  const underwriting = underwriteDevelopment(s, parcels, bbl, use, floors, plate, undefined, opts?.spec ?? 0.5, opts?.ltc);
  // The anonymous merchants build at the trade's margin, each on its own read
  // of rent (`anonHurdle`). Below that, the job goes ahead only if a named
  // firm that would build it takes it (`firmWouldBuild` in rivals.ts) —
  // otherwise it is unwound below.
  // A developer who drew this deal in `developerLook` has already run it
  // against their own bar and their own money; it is theirs to build.
  const merchantOk = !!underwriting && (!!opts?.decided || anonHurdle(s, underwriting.plan, use, underwriting.financeable) >= 1);
  // A plan the desk will not lend on can still be built by a firm with its
  // own money; claimJob decides who, and the start unwinds if nobody does.
  if (!underwriting) return false;
  if (!merchantOk && (opts?.backdate || streetHurdle(s, underwriting.plan, use, underwriting.financeable) < 1)) return false;
  const plan = underwriting.plan;
  sf = plan.sf;
  floors = plan.floors;
  const prog = plan.mix;
  // Preserve the old duration draw count. Duration itself now comes from the
  // same massing/schedule calculation as the player's project.
  const formerDurationRoll = rng(s, "dev");
  void formerDurationRoll;
  const months = plan.months;
  // A JOB STARTED BEFORE THE GAME DID. The opening pipeline (seedOpeningPipeline)
  // asks for a start some way into its build; everything below is stamped as
  // of that month so the record, the ledger and the delivery queue agree
  // with the frame that is already standing.
  const backM = opts?.backdate ? Math.floor(opts.backdate * Math.max(0, months - 1)) : 0;
  const nowM = s.month;
  const startM = nowM - backM;
  // An opening frame is one asked for with a backdate, whatever the draw: a
  // small draw rounds backM down to 0, and reading `backM > 0` below handed
  // such a frame to the street as if it had broken ground today.
  const opening = opts?.backdate !== undefined;
  const deliverM = startM + months;
  const builder = builderById(s, opts?.builderId);
  (s.cityJobs ??= []).push({ bbl, use, sf, floors, startM, deliverM, mix: prog, ...(opts?.spec !== undefined ? { spec: opts.spec } : {}),
    merchant: merchantBook(s, bbl, startM, plan, opts?.ltc),
    ...(builder ? { builderId: builder.id, coInvest: builderCoInvest(plan.basisTotal, opts?.ltc ?? 0.5) } : {}) });
  s.month = startM;
  noteRecordPlan(s, parcels, bbl, lead, sf, floors, builder?.name ?? "The city");

  // Into the pipeline the day the hole is dug: the Economy page's delivery
  // schedule and forward vacancy are reading this queue, so what is coming
  // is visible for years before it lands.
  const cityProgramme = programmeSf(rentableFromSpec(sf, floors), prog);
  queueSupplyProject(s, {
    bbl,
    source: "city",
    deliverM,
    sfByUse: cityProgramme,
  });

  // Before it is anonymous, it is offered to the street. A developer with
  // the dry powder buys the dirt and puts their name on the crane; if
  // nobody takes it, the city builds it the way it always did.
  const nearPlayer = (adjacency?.[bbl] ?? []).some((a) => !!s.holdings[a]);
  // A backdated start is the city's: a named firm's claim stamps its own
  // day-one draw against today's cash, which a job forty per cent built
  // eighteen months ago did not take today.
  // A BUILDER FIRM THAT DREW THE DEAL builds it if its balance sheet will
  // carry it; if not, the street may take it; with the town's builders as
  // firms, if nobody named can carry it, it is not built.
  const ownFirm = opts?.firmId ? (s.rivals ?? []).find((r) => r.id === opts.firmId && r.failedM === undefined) : undefined;
  const claimed = opening ? null
    : (ownFirm ? claimJob(s, parcels, bbl, use, sf, floors, deliverM, nearPlayer, plan, ownFirm) : null)
      ?? claimJob(s, parcels, bbl, use, sf, floors, deliverM, nearPlayer, plan);
  if (s.builderFirms && !claimed && !opening) {
    s.cityJobs = (s.cityJobs ?? []).filter((j) => !(j.bbl === bbl && j.startM === startM));
    cancelSupplyProject(s, bbl);
    s.month = nowM;
    return false;
  }
  // The firm's own start, with the market's context, when it is big enough to move it.
  if (claimed && claimed === ownFirm && !opts?.quiet && sf * (prog[lead] ?? 1) >= 0.015 * Math.max(1, s.econ.stock?.[lead] ?? 0)) {
    s.news.unshift({
      q: s.month, kind: "info", bbl,
      text: `${claimed.name} broke ground at ${rec.address}: ${Math.round(sf).toLocaleString()} sf of ${lead}, ${floors} floors, `
        + `opening ${monthLabel(deliverM)}. ${lead === "multifamily" ? "Flats" : SECTOR_LABEL[lead] ?? lead} vacancy is `
        + `${((s.econ.cityVac?.[lead] ?? 0) * 100).toFixed(1)}% today; this is ${(100 * sf * (prog[lead] ?? 1) / Math.max(1, s.econ.stock?.[lead] ?? 1)).toFixed(1)}% more space.`,
    });
  }
  // A START BIG ENOUGH TO MOVE ITS MARKET IS NEWS, with a name on it.
  if (!claimed && builder && !backM && !opts?.quiet && sf * (prog[lead] ?? 1) >= 0.015 * Math.max(1, s.econ.stock?.[lead] ?? 0)) {
    s.news.unshift({
      q: s.month, kind: "info", bbl,
      text: `${builder.name} broke ground at ${rec.address}: ${Math.round(sf).toLocaleString()} sf of ${lead}, ${floors} floors, `
        + `opening ${monthLabel(deliverM)}. ${lead === "multifamily" ? "Flats" : SECTOR_LABEL[lead] ?? lead} vacancy is `
        + `${((s.econ.cityVac?.[lead] ?? 0) * 100).toFixed(1)}% today; this is ${(100 * sf * (prog[lead] ?? 1) / Math.max(1, s.econ.stock?.[lead] ?? 1)).toFixed(1)}% more space.`,
    });
  }
  if (!claimed && builder) { builder.starts += 1; builder.lastStartM = nowM; }
  if (!claimed && !merchantOk) {
    // Nobody whose margin it clears would take it: unwind the start.
    s.cityJobs = (s.cityJobs ?? []).filter((j) => !(j.bbl === bbl && j.startM === startM));
    cancelSupplyProject(s, bbl);
    return false;
  }
  // ANONYMOUS IS NOT FREE. Named firms already stamp cost/equity/commitment
  // in claimJob. An unclaimed job used to deliver on schedule with no capital
  // at all — the largest remaining competitor asymmetry. Stamp the same
  // underwriting ledger; fundJobs draws it from the city construction pool.
  if (!claimed) {
    const job = (s.cityJobs ?? []).find((j) => j.bbl === bbl);
    if (job && !(job.cost ?? 0)) {
      job.cost = plan.costTotal;
      // ...and a frame part-built before the opening bell has spent its
      // way along the same S-curve fundJobs draws on: equity first, then
      // the construction desk.
      const t1 = backM > 0 ? Math.min(1, (backM + 1) / Math.max(1, months)) : 0;
      const progress = t1 * t1 * (3 - 2 * t1);
      const equity = Math.round(plan.costTotal * (1 - plan.ltc));
      job.spent = Math.round(plan.costTotal * progress);
      job.equityLeft = Math.max(0, equity - job.spent);
      job.debt = Math.max(0, job.spent - equity);
      job.commitment = plan.commitment;
      job.ratePct = plan.ratePct;
      job.lender = "Merchant builders";
    }
  }
  recordPropertyEvent(s, bbl, {
    kind: "build-start",
    use,
    sf,
    floors,
    party: claimed?.name ?? "The city",
  });
  if (!claimed && !opts?.quiet && rng(s, "dev") < 0.4) {
    s.news.unshift({
      q: s.month, kind: "info",
      text: `Ground broken at ${rec.address} — ${(sf / 1000).toFixed(0)}k sf of ${use}, due ${monthLabel(deliverM)}.`,
    });
  }
  s.month = nowM;
  return true;
}

/**
 * THE CRANES THAT WERE ALREADY UP.
 *
 * Every city opened with nothing under construction — the Economy page read
 * "0 sf" in all four sectors in every era, a boom included, and the first
 * groundbreak came a year or three in. Measured, eight seeds: 0 jobs at month
 * zero, 0-1 at twelve, 0-6 at thirty-six. A real city carries one to three
 * per cent of its floor area in the air at any moment, more at the top of a
 * cycle and less at the bottom, and some of it is half built on the day you
 * arrive.
 *
 * Nothing here is a new number. The crew count is `crewCapacity` — the
 * contractors a town this size supports; how busy they were is the same
 * appetite the growth loop reads off slack (1 - 7 × vacancy over natural,
 * floored at 0.18); each start goes through `startCityJob`, so the site
 * contest and the pro forma decide what actually broke ground, and in a
 * dear-money opening most of it does not. Starts are backdated a random way
 * into their build with the ledger and the delivery queue stamped as of that
 * month, so the first deliveries land in the opening year or two the way
 * somebody else's decisions always do.
 */
export function seedOpeningPipeline(s: GameState, parcels: ParcelTable, bbls: string[]): void {
  if (s.month !== 0 || (s.cityJobs?.length ?? 0) > 0 || s.openingPipelineSeeded) return;
  s.openingPipelineSeeded = true;
  if (!s.cityJobs) s.cityJobs = [];
  const e = s.econ;
  let slack = 0;
  for (const k of BUILT_CLASSES) slack += Math.max(0, (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k]);
  slack /= BUILT_CLASSES.length;
  const util = Math.max(0.18, Math.min(1, 1 - slack * 7));
  const want = Math.round(crewCapacity(bbls, e) * util);
  let started = 0;
  for (let i = 0; i < want * 4 && started < want; i++) {
    if (developerLook(s, parcels, bbls, null, { backdate: rng(s, "dev"), quiet: true })) started++;
  }
  // The Research page reads `econ.pipeline`, which the queue only refreshes
  // once a month so that construction cannot depend on iteration order
  // inside a tick. Before the first tick there is no order to depend on, and
  // an opening screen that says "0 sf under construction" over nine live
  // frames is the fault this function exists to fix.
  syncSupplyViews(e, true);
}

export function bumpLand(s: GameState, bbl: string, mult: number) {
  s.landAdj[bbl] = Math.min(4, (s.landAdj[bbl] ?? 1) * mult);
}

/**
 * HOW SMALL AND HOW LARGE A SPACE CAN BE.
 *
 * Setting the unit count is a real programming decision and it has physical
 * bounds. You cannot put ten shops in three thousand square feet — a shop
 * needs frontage, a lavatory, a back of house and a door onto the street, and
 * two thousand feet is the floor for any commercial tenancy. Nor can you sell a single
 * "unit" that is an entire two-hundred-thousand-foot tower and call it a
 * building of one: at the top end you are describing a single-tenant
 * headquarters, which is a real product and a rare one.
 *
 * Flats are the tightest band in the book, because a flat is a flat: a studio
 * is about four hundred and fifty feet and anything past two thousand is a
 * penthouse, not a unit type you programme a whole building around.
 */
export const SUITE_BOUNDS: Record<BuiltClass, { min: number; max: number; typical: number }> = {
  // 2,000 sf is the floor for any commercial tenancy — see COMMERCIAL_SUITE_MIN
  // in leasing.ts. Below it you are describing a kiosk or a serviced desk.
  office:      { min: 2_000, max: 60_000,  typical: 4_500 },
  retail:      { min: 2_000, max: 30_000,  typical: 3_200 },
  industrial:  { min: 5_000, max: 200_000, typical: 25_000 },
  multifamily: { min: 450,   max: 2_200,   typical: 850 },
};

/** The legal range of unit counts for a given amount of floor area in a use. */
export function unitRange(useSfArea: number, use: BuiltClass): { min: number; max: number; typical: number } {
  const b = SUITE_BOUNDS[use];
  const sfArea = Math.max(0, useSfArea);
  if (sfArea <= 0) return { min: 1, max: 1, typical: 1 };
  // Class floors (5,000 ft industrial, 2,000 ft office) are a programming
  // preference, not a physical constant. A 4,000 ft shed is one space the
  // size of the shed — floor(4000/5000) used to say zero, then max(1,0)
  // invented a 5,000 ft suite the building does not have.
  const minSuite = Math.min(b.min, sfArea);
  const maxSuite = Math.min(b.max, sfArea);
  return {
    min: Math.max(1, Math.floor(sfArea / maxSuite)),
    max: Math.max(1, Math.floor(sfArea / minSuite)),
    typical: Math.max(1, Math.round(sfArea / Math.min(b.typical, sfArea))),
  };
}

/**
 * A unit count, turned back into the sf-per-space the engine actually uses,
 * clamped to what is physically possible.
 */
export function suiteSfForUnits(useSfArea: number, use: BuiltClass, units: number): number {
  const b = SUITE_BOUNDS[use];
  const r = unitRange(useSfArea, use);
  const n = Math.max(r.min, Math.min(r.max, Math.round(units)));
  const per = Math.round(useSfArea / Math.max(1, n));
  const minSuite = Math.min(b.min, useSfArea);
  const maxSuite = Math.min(b.max, useSfArea);
  return Math.max(minSuite, Math.min(maxSuite, per));
}
