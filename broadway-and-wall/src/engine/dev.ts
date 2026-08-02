// Ground-up development (Groundwork's core loop, simplified for v1) plus
// building management: capital programs and rent stance.
//
// Development: on an owned vacant lot, choose use and FAR up to the zoning
// max, pay hard+soft cost per sf, fund with a 60% interest-only construction
// loan, wait 4-6 quarters while the building rises on the map, then lease up
// from empty. A modest random cost/schedule overrun keeps it honest.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Contract, DevUse, Development, GameState, UseMix } from "./types";
import { logBooks, monthLabel } from "./types";
import { demandNow } from "./demand";
import { rng, rrange } from "./market";
import { resolveRec, marketRentPsfYr, opexPsf, TAX_RATE, capRateFor, landValue, RECOVERY_RATE } from "./value";
import { genAnchorTenant } from "./leasing";

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

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
export const HARD_COST_PSF: Record<BuiltClass, number> = {
  office: 560,        // net $62/sf against a 5.3% exit
  multifamily: 345,   // net $37/sf against a 4.6% exit — the thinnest margin in the book
  retail: 865,        // net $97/sf; podium retail is expensive and earns it
  industrial: 140,    // net $17/sf against a 6.6% exit
};

/**
 * A PROGRAMME, not a class. You do not build "mixed use" — you build shops at
 * grade with offices and flats above, and the budget is the sum of those three
 * jobs. "mixed" here is shorthand for a canonical stack, and the whole of what
 * it means is the mix below: cost, rent, lease-up, lender appetite and
 * neighbourhood effect all follow from the components.
 */
export const MIXED_STACK: UseMix = { retail: 0.15, office: 0.45, multifamily: 0.40 };
export function devMix(use: DevUse): UseMix {
  return use === "mixed" ? MIXED_STACK : { [use]: 1 };
}
export function dominantOf(mix: UseMix): BuiltClass {
  return (Object.keys(mix) as BuiltClass[]).sort((a, b) => (mix[b] ?? 0) - (mix[a] ?? 0))[0] ?? "office";
}
/** Weighted average of a per-use number across a programme. */
function overMix(mix: UseMix, f: (u: BuiltClass) => number): number {
  let sum = 0, w = 0;
  for (const u of Object.keys(mix) as BuiltClass[]) { const s = mix[u] ?? 0; sum += f(u) * s; w += s; }
  return w > 0 ? sum / w : 0;
}
/** How much of a programme carries genuine leasing risk before it is built. */
function specShare(mix: UseMix): number {
  return (mix.office ?? 0) + (mix.retail ?? 0);
}
const SOFT_COST = 0.16;        // design, legal, permits, insurance, financing fees
const CONSTR_SPREAD = 2.4;     // over the index, interest-only
export const CONTINGENCY = 0.06;  // held against change orders; unspent is yours

/**
 * THE CONTRACT.
 *
 * Cost-plus is cheaper on paper and leaves you holding the bag: the price
 * moves with the market between groundbreak and topping out, and every change
 * order is yours. A guaranteed maximum price costs four points more and buys
 * the contractor's balance sheet — escalation stops being your problem and
 * most overruns die at the GMP line.
 *
 * In a boom, when costs are running, the GMP premium is the cheapest money on
 * the board. In a flat market it is four points of nothing. Reading which one
 * you are in is the job.
 */
export const CONTRACT_PREMIUM: Record<Contract, number> = { gmp: 0.04, costplus: 0 };

/**
 * Construction lenders underwrite lease risk, not blueprints, and they
 * underwrite it in a straight line: the more of the building that is already
 * spoken for, the more of the cost they will fund. Spec commercial in a
 * recession gets nothing at all. Residential and industrial carry less lease
 * risk because the space is fungible.
 */
function constructionLtc(mix: UseMix, preLeaseShare: number, phase: string): number {
  // A stack that is mostly flats over a little retail is nearly as financeable
  // as flats, which is a real and underappreciated reason developers build it.
  const spec = specShare(mix);
  const safeLtc = Math.min(0.68, 0.6 + 0.16 * preLeaseShare);
  if (spec < 0.05) return safeLtc;
  if (phase === "recession" && preLeaseShare < 0.3) return spec > 0.7 ? 0 : safeLtc * (1 - spec);
  // 45% on pure spec, rising to 70% for a building that is half let already
  const specLtc = Math.min(0.70, 0.45 + 0.5 * preLeaseShare);
  return specLtc * spec + safeLtc * (1 - spec);
}

export const MAX_PRE_LEASE = 0.6;    // nobody lets the whole thing before a slab
export const PRE_LEASE_EXTRA_M = 8;  // months spent landing anchors, at the maximum

/**
 * What an anchor charges you for signing before there is a building. They are
 * taking delivery risk and they price it — a discount to market that widens
 * with how much of the building they are taking.
 */
export function preLeaseDiscount(share: number): number {
  return 1 - 0.16 * (share / MAX_PRE_LEASE);
}

export interface DevPlan {
  use: DevUse;
  mix: UseMix;
  floors: number;
  coverage: number;   // share of the lot the floorplate covers
  contract: Contract;
  preLeaseShare: number;
  sf: number;
  far: number;
  farMax: number;
  hardCost: number;
  softCost: number;
  contingency: number;
  demo: number;
  landBasis: number;    // what the site cost you — sunk, but in the yield
  basisTotal: number;   // construction plus land: the denominator of yield on cost
  leaseUp: number;    // fit-out, commissions and carry until it is full
  costTotal: number;
  ltc: number;
  ltcMax: number;
  commitment: number;
  interestReserve: number;
  ratePct: number;
  equity: number;         // the whole equity budget
  equityAtClose: number;  // what you actually write on day one
  months: number;
  yieldOnCost: number;    // stabilised NOI ÷ total cost — the developer's number
  exitCap: number;
  lenderNote?: string;
}

// The buildable envelope, and nothing else. Ashport has no use districts —
// any class on any lot — so the only limit is how much floor area the FAR
// allows, and how much of the lot you choose to cover with it.
export function farMaxFor(rec: { farMaxComm: number; farMaxRes: number }): number {
  return Math.max(rec.farMaxComm, rec.farMaxRes, 2);
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
export function physicalMaxFloors(plateSf: number): number {
  if (plateSf < 600) return 1;
  if (plateSf < 1200) return 3;
  if (plateSf < 4000) return 6;
  return Math.min(90, Math.floor(1.2 * Math.sqrt(plateSf)));
}
export function maxFloorsFor(rec: { farMaxComm: number; farMaxRes: number; lotArea?: number }, coverage: number): number {
  const zoning = Math.max(1, Math.floor(farMaxFor(rec) / Math.max(0.08, coverage)));
  const plate = (rec.lotArea ?? 0) * Math.max(0.08, coverage);
  return rec.lotArea ? Math.max(1, Math.min(zoning, physicalMaxFloors(plate))) : zoning;
}

// The parcel as it will exist once the building is up — what the rent, the
// cap rate and the leasing costs all have to be read against.
function asBuiltRec(rec: unknown, use: DevUse, sf: number, floors: number) {
  const mix = devMix(use);
  return { ...(rec as object), class: dominantOf(mix), mix, bldgArea: sf, floors } as never;
}

export function planDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.6, preLeaseShare: number | boolean = 0,
  contract: Contract = "gmp", ltcWanted?: number,
): DevPlan | null {
  const rec = parcels[bbl];
  if (!rec || !rec.lotArea) return null;
  const cov = Math.max(0.08, Math.min(0.9, coverage));
  const farMax = farMaxFor(rec);
  const fl = Math.max(1, Math.min(Math.round(floors), maxFloorsFor(rec, cov)));
  const sf = Math.round((rec.lotArea * cov * fl) / 100) * 100;
  if (sf < 2000) return null;

  const mix = devMix(use);
  const canPreLease = specShare(mix) > 0.2;
  // the old signature took a boolean; keep it working
  const rawShare = typeof preLeaseShare === "boolean" ? (preLeaseShare ? 0.35 : 0) : preLeaseShare;
  const pre = canPreLease ? Math.max(0, Math.min(MAX_PRE_LEASE, rawShare)) : 0;

  const heightPrem = fl > 30 ? 1.28 : fl > 18 ? 1.18 : fl > 8 ? 1.07 : 1;
  // the budget is the sum of the jobs, not a number attached to a label
  const hardCost = Math.round(sf * overMix(mix, (u) => HARD_COST_PSF[u]) * s.econ.costIdx * heightPrem * (1 + CONTRACT_PREMIUM[contract]));
  const softCost = Math.round(hardCost * SOFT_COST);
  const demo = rec.bldgArea > 0 ? Math.round(rec.bldgArea * 12 * s.econ.costIdx) : 0;
  const contingency = Math.round((hardCost + softCost) * CONTINGENCY);

  // THE LEASE-UP RESERVE.
  //
  // A building is not finished when the scaffolding comes down; it is finished
  // when it is full, and getting there costs money that never appears in the
  // headline budget: fit-out for every tenant, commissions to the brokers who
  // found them, and the carry on an empty building for months. Leaving it out
  // made every pro forma flatter itself — and it is exactly the cost that
  // pre-leasing removes, which is the other half of why a developer signs an
  // anchor at a discount to market.
  const openSf = sf * (1 - pre);
  // apartments have no fit-out, but they do have concessions and marketing
  const tiPsf = overMix(mix, (u) => (u === "office" ? 32 : u === "retail" ? 22 : u === "industrial" ? 5 : 7));
  const lcPsf = overMix(mix, (u) => (u === "multifamily" ? 0 : 1))
    * marketRentPsfYr(asBuiltRec(rec, use, sf, fl), s.econ, "good") * 6 * 0.045;
  const carryMonths = overMix(mix, (u) => (u === "multifamily" ? 6 : 10));
  const carry = Math.round(openSf * overMix(mix, (u) => opexPsf(u, s.econ, false)) * (carryMonths / 12));
  const leaseUp = Math.round(openSf * (tiPsf + lcPsf) * s.econ.costIdx) + carry;

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
  // what yield on cost means.
  const landBasis = Math.round(s.holdings[bbl]?.costBasis ?? landValue(rec, s.econ));
  const buildCost = hardCost + softCost + demo + contingency + leaseUp;
  const costTotal = buildCost;
  const basisTotal = buildCost + landBasis;

  // The construction lender funds construction. It does not refinance the
  // equity you already sank into the ground.
  // The lender's max is the ceiling; how much of it you TAKE is your call.
  // Less debt is a slower clock and a smaller reserve; more is more building
  // per dollar of equity and a harder landing if lease-up runs long.
  const ltcMax = constructionLtc(mix, pre, s.econ.phase);
  const ltc = ltcWanted === undefined ? ltcMax : Math.max(0, Math.min(ltcMax, ltcWanted));
  const commitment = Math.round(costTotal * ltc);
  const ratePct = +(s.econ.indexRate + CONSTR_SPREAD).toFixed(2);
  // Foundations, core, a floor every couple of weeks, then facade and fit-out:
  // a mid-rise is a two-year job and a real tower is three to four. Nothing
  // was taking longer than 30 months, which made towers feel like sheds.
  const baseMonths = Math.min(54, 10 + Math.round(fl * 0.85));
  const months = baseMonths + Math.round(PRE_LEASE_EXTRA_M * (pre / MAX_PRE_LEASE));

  // The interest reserve: the lender sizes a pot inside the commitment to
  // carry the loan through construction, because a building under way earns
  // nothing. Roughly the average outstanding balance times the coupon times
  // the schedule — an S-curve draw averages a bit over half the commitment.
  const interestReserve = Math.round(commitment * 0.55 * (ratePct / 100) * (months / 12));

  // Yield on cost against today's stabilised rents — the number a developer
  // actually lives by, and the spread to the exit cap is the whole margin.
  const asBuilt = asBuiltRec(rec, use, sf, fl);
  const rentPsf = marketRentPsfYr(asBuilt, s.econ, "good");
  const stabOcc = overMix(mix, (u) => (u === "multifamily" ? 0.95 : 0.9));
  const opex = overMix(mix, (u) => opexPsf(u, s.econ, false));
  const recovery = overMix(mix, (u) => RECOVERY_RATE[u]);
  const taxLoad = basisTotal * TAX_RATE * (1 - recovery);
  const stabNoi = sf * (rentPsf * stabOcc - opex * (1 - recovery * stabOcc)) - taxLoad;
  // The exit is what THIS building will trade at — new, in good condition, on
  // this corner — not the citywide class average. Using the average understated
  // the spread by most of a point everywhere it mattered, which made every
  // development on the map look like a losing trade.
  const exitCap = capRateFor(asBuilt, s.econ, "good");
  const yieldOnCost = basisTotal > 0 ? (stabNoi / basisTotal) * 100 : 0;

  const lenderNote = ltc === 0
    ? "No construction lender will touch spec commercial in a recession. Pre-lease it, or fund the whole thing yourself."
    : yieldOnCost < exitCap + 0.75
      ? `Yield on cost is ${yieldOnCost.toFixed(2)}% against a ${exitCap.toFixed(2)}% exit. That is not a development spread — it is a way to build a building for more than it is worth.`
      : undefined;

  return {
    use, mix, floors: fl, coverage: cov, contract, preLeaseShare: pre, sf,
    far: +(sf / rec.lotArea).toFixed(1), farMax,
    hardCost, softCost, contingency, demo, leaseUp, costTotal, landBasis, basisTotal,
    ltc, ltcMax, commitment, interestReserve, ratePct,
    equity: costTotal - commitment,
    // Equity funds FIRST. The bank does not release a dollar until yours are
    // in the ground, which is why a development eats your balance sheet at the
    // start rather than in even slices.
    equityAtClose: Math.round((costTotal - commitment) * 0.55),
    months, yieldOnCost, exitCap, lenderNote,
  };
}

export function startDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: DevUse,
  floors: number, coverage = 0.6, preLeaseShare: number | boolean = 0,
  contract: Contract = "gmp", ltcWanted?: number,
): { s: GameState; err?: string } {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.holdings[bbl]) return { s, err: "Buy the dirt first." };
  if (rec.class !== "land") return { s, err: "Clear the site first — demolish what's standing before you build." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, preLeaseShare, contract, ltcWanted);
  if (!plan) return { s, err: "That's too small to be worth building — add floors or cover more of the lot." };
  if (s.cash < plan.equityAtClose) {
    return { s, err: `The bank funds nothing until your equity is in the ground. That is $${(plan.equityAtClose / 1e6).toFixed(2)}M at close, of $${(plan.equity / 1e6).toFixed(2)}M total — you're short.` };
  }
  const next = clone(s);
  next.cash -= plan.equityAtClose;
  logBooks(next, "dev", plan.equityAtClose);
  next.developments[bbl] = {
    bbl, use, mix: plan.mix, sf: plan.sf, floors: plan.floors,
    costTotal: plan.costTotal, hardCost: plan.hardCost, contract,
    contingency: plan.contingency, contingencyUsed: 0,
    commitment: plan.commitment, drawn: 0, loanBalance: 0,
    interestReserve: plan.interestReserve, reserveUsed: 0,
    equityBudget: plan.equity, equitySpent: plan.equityAtClose,
    ratePct: plan.ratePct,
    startM: next.month, deliverM: next.month + plan.months, baseMonths: plan.months,
    preLeaseShare: plan.preLeaseShare,
    preLeasedSf: plan.preLeaseShare > 0 ? Math.round(plan.sf * plan.preLeaseShare) : undefined,
    events: 0,
  } satisfies Development;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Ground broken at ${rec.address}: ${plan.floors} floors, ${(plan.sf / 1000).toFixed(0)}k sf of ${use === "mixed" ? "mixed-use" : use} at ${plan.far} FAR on a ${contract === "gmp" ? "guaranteed max price" : "cost-plus"} contract. $${(plan.costTotal / 1e6).toFixed(1)}M budget, ${(plan.ltc * 100).toFixed(0)}% funded${plan.preLeaseShare > 0 ? `, ${(plan.preLeaseShare * 100).toFixed(0)}% pre-let` : ", on spec"}. Delivery ${monthLabel(next.month + plan.months)}.`,
  });
  return { s: next };
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
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "There's nothing standing on it." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  if (h.sale) return { s, err: "It's on the market — pull the listing first." };
  const leased = h.tenants.reduce((sum, t) => sum + t.sf, 0);
  if (leased / Math.max(1, rec.bldgArea) > 0.2) {
    return { s, err: "You can't demolish over occupied space — let the leases roll below 20% first." };
  }
  const cost = demolitionCost(rec, s);
  if (s.cash < cost) return { s, err: `Demolition runs $${(cost / 1e6).toFixed(2)}M — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  next.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  const nh = next.holdings[bbl];
  nh.tenants = [];
  delete nh.occ;
  delete nh.makeReady;
  delete nh.deliveredM;
  nh.condition = "standard";
  nh.lastCapM = s.month;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${rec.address} came down — $${(cost / 1e6).toFixed(2)}M to clear it. The site is dirt again.`,
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
export function tickDevelopments(s: GameState, parcels: ParcelTable) {
  for (const d of Object.values(s.developments)) {
    const rec = parcels[d.bbl];
    if (!rec || !s.holdings[d.bbl]) { delete s.developments[d.bbl]; continue; }
    const span = Math.max(1, d.deliverM - d.startM);
    const t0 = Math.max(0, Math.min(1, (s.month - 1 - d.startM) / span));
    const t1 = Math.max(0, Math.min(1, (s.month - d.startM) / span));
    // the classic S-curve of spend against time
    const curve = (t: number) => t * t * (3 - 2 * t);
    const spendShare = Math.max(0, curve(t1) - curve(t0));
    const spendNow = Math.round(d.costTotal * spendShare);

    if (spendNow > 0) {
      // equity first, to the extent any is left; the bank funds the rest
      const equityLeft = Math.max(0, d.equityBudget - d.equitySpent);
      const fromEquity = Math.min(equityLeft, spendNow);
      const fromLoan = Math.min(Math.max(0, d.commitment - d.drawn), spendNow - fromEquity);
      const unfunded = spendNow - fromEquity - fromLoan;
      d.equitySpent += fromEquity;
      d.drawn += fromLoan;
      d.loanBalance += fromLoan;
      // anything neither side will fund is a capital call, today
      s.cash -= fromEquity + unfunded;
      logBooks(s, "dev", fromEquity + unfunded);
      if (unfunded > 0) d.equitySpent += unfunded;
    }

    // interest on the drawn balance, out of the reserve while it lasts
    if (d.loanBalance > 0) {
      const interest = Math.round((d.loanBalance * d.ratePct) / 100 / 12);
      const fromReserve = Math.min(Math.max(0, d.interestReserve - d.reserveUsed), interest);
      d.reserveUsed += fromReserve;
      d.loanBalance += fromReserve;              // capitalised into the loan
      const outOfPocket = interest - fromReserve;
      if (outOfPocket > 0) {
        s.cash -= outOfPocket;
        logBooks(s, "dev", outOfPocket);
        if (d.reserveUsed >= d.interestReserve && d.reserveUsed - fromReserve < d.interestReserve) {
          s.news.unshift({
            q: s.month, kind: "warn",
            text: `The interest reserve at ${rec.address} is spent. Carry comes out of your pocket from here.`,
          });
        }
      }
    }

    // COST ESCALATION. Under cost-plus the unspent balance of the job moves
    // with the market; under a guaranteed maximum price it does not, and that
    // is what the four-point premium bought.
    if (d.contract === "costplus" && s.month > d.startM) {
      const remaining = Math.max(0, d.hardCost * (1 - curve(t1)));
      const drift = s.econ.phase === "expansion" || s.econ.phase === "peak" ? rrange(s, 0.0012, 0.0038) : rrange(s, -0.001, 0.0016);
      const escal = Math.round(remaining * drift);
      if (escal > 0) { d.costTotal += escal; d.hardCost += escal; d.equityBudget += escal; }
    }

    // SITE RISK, month by month. Each is rare; a two-year job runs the gauntlet
    // twenty-odd times, which is why schedules slip and budgets grow.
    const progress = curve(t1);
    if (progress > 0.04 && progress < 0.97) {
      const roll = rng(s);
      const gmpShield = d.contract === "gmp" ? 0.35 : 1;   // the GC eats most of it
      if (roll < 0.028 * gmpShield) {
        // change order
        const bump = rrange(s, 0.015, 0.07);
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
            ? `Change orders at ${rec.address}: $${(extra / 1e6).toFixed(2)}M, of which $${(overrun / 1e6).toFixed(2)}M is past the contingency and lands on you.`
            : `Change orders at ${rec.address}: $${(extra / 1e6).toFixed(2)}M, absorbed by the contingency.`,
        });
      } else if (roll < 0.055) {
        d.deliverM += 1 + Math.round(rng(s));
        d.events++;
        s.news.unshift({ q: s.month, kind: "warn", text: `Weather and inspections at ${rec.address} — delivery moves to ${monthLabel(d.deliverM)}.` });
      } else if (roll < 0.062) {
        // a sub goes under: time AND money, and the GMP does not help much
        const extra = Math.round(d.costTotal * rrange(s, 0.03, 0.09));
        const fromContingency = Math.min(Math.max(0, d.contingency - d.contingencyUsed), extra);
        d.contingencyUsed += fromContingency;
        const overrun = extra - fromContingency;
        d.costTotal += overrun; d.hardCost += overrun; d.equityBudget += overrun;
        d.deliverM += 2 + Math.round(rng(s) * 3);
        d.events++;
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `A subcontractor at ${rec.address} defaulted. Re-tendering costs $${(extra / 1e6).toFixed(2)}M and pushes delivery to ${monthLabel(d.deliverM)}.`,
        });
      }
    }

    if (s.month >= d.deliverM) deliver(s, parcels, d, rec);
  }
}

function deliver(s: GameState, parcels: ParcelTable, d: Development, rec: { address: string }) {
  const dmix = d.mix ?? devMix(d.use);
  s.built[d.bbl] = { class: dominantOf(dmix), mix: dmix, bldgArea: d.sf, floors: d.floors, yearBuilt: 2000 + Math.floor(s.month / 12) };
  const h = s.holdings[d.bbl];
  h.condition = "good";
  h.lastCapM = s.month;
  h.tenants = [];
  h.deliveredM = s.month;
  if ((dmix.multifamily ?? 0) > 0) h.occ = 0.1;
  h.costBasis += d.costTotal;
  h.assessed = (h.assessed ?? h.costBasis - d.costTotal) + d.costTotal;

  // unspent contingency is a rebate, not a rounding error
  const saved = Math.max(0, d.contingency - d.contingencyUsed);
  if (saved > 0) {
    s.cash += saved;
    logBooks(s, "dev", -saved);
  }

  if (d.preLeasedSf) {
    const built = resolveRec(parcels, s, d.bbl);
    if (built) genAnchorTenant(s, built, h, d.preLeasedSf, preLeaseDiscount(d.preLeaseShare));
  }

  // THE TAKEOUT. The construction loan does not evaporate — it rolls into a
  // mini-perm that is interest-only for a year and matures in three, and the
  // whole job now is to stabilise the building before that clock runs out.
  // A developer's real risk is not building it. It is owning it empty.
  h.loan = {
    product: "cordage",
    floating: true,
    principal: d.loanBalance,
    balance: d.loanBalance,
    ratePct: +(s.econ.indexRate + 2.1).toFixed(2),
    spread: 2.1,
    ioUntilM: s.month + 12,
    amortYears: 30,
    maturityM: s.month + 36,
    monthlyPmt: Math.round((d.loanBalance * (s.econ.indexRate + 2.1)) / 100 / 12),
    minDSCR: 1.05,
    maxLTV: 0.9,
    sweep: false,
    cleanQs: 0,
    originM: s.month,
    // A building that delivered empty cannot cover anything, and every lender
    // who writes construction paper knows it. The lease-up holiday runs two
    // years — long enough to fill it, short enough that failing to is fatal.
    holidayUntilM: s.month + 24,
    prepay: "open",
    prepayUntilM: s.month,
  };
  delete s.developments[d.bbl];
  bumpLand(s, d.bbl, 1.06);

  const over = d.costTotal - (d.hardCost + Math.round(d.hardCost * SOFT_COST));
  void over;
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `Delivered: ${(d.sf / 1000).toFixed(0)}k sf of ${d.use} at ${rec.address}, ${d.events === 0 ? "on programme" : `after ${d.events} problem${d.events > 1 ? "s" : ""}`}, $${(d.costTotal / 1e6).toFixed(1)}M all in`
      + (saved > 0 ? `, with $${(saved / 1e6).toFixed(2)}M of contingency returned` : "")
      + `. The mini-perm matures ${monthLabel(s.month + 36)} — stabilise it before then.`,
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

export function programCost(rec: { bldgArea: number }, s: GameState, p: CapProgram): number {
  return Math.round(rec.bldgArea * p.costPsf * s.econ.costIdx);
}

export function startProgram(s: GameState, parcels: ParcelTable, bbl: string, programId: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const p = PROGRAMS.find((x) => x.id === programId);
  if (!h || !rec || !p) return { s, err: "No such program." };
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to improve on a vacant lot." };
  if (h.program) return { s, err: "A capital program is already running." };
  if (h.programsDone?.[programId] !== undefined) return { s, err: "Already done here." };
  const cost = programCost(rec, s, p);
  if (s.cash < cost) return { s, err: `${p.label} costs $${(cost / 1e6).toFixed(2)}M — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  const nh = next.holdings[bbl];
  nh.program = { id: programId, untilM: next.month + p.months };
  next.news.unshift({ q: next.month, kind: "info", text: `${p.label} underway at ${rec.address} ($${(cost / 1e6).toFixed(2)}M).` });
  return { s: next };
}

export function tickPrograms(s: GameState, parcels: ParcelTable) {
  for (const h of Object.values(s.holdings)) {
    if (h.program && s.month >= h.program.untilM) {
      h.programsDone = { ...(h.programsDone ?? {}), [h.program.id]: s.month };
      const rec = resolveRec(parcels, s, h.bbl);
      const p = PROGRAMS.find((x) => x.id === h.program!.id);
      if (rec && p) s.news.unshift({ q: s.month, kind: "info", text: `${p.label} complete at ${rec.address}.` });
      delete h.program;
    }
  }
}

export function setStance(s: GameState, bbl: string, stance: -1 | 0 | 1): GameState {
  const next = clone(s);
  if (next.holdings[bbl]) next.holdings[bbl].stance = stance;
  return next;
}

// ---- the city builds itself ------------------------------------------------
// Ashport is young. Over a century, the market fills in the vacant lots
// around you — fastest in booms, near-stalled in recessions, always working
// outward from the demand peaks. Every delivery lifts land values on its
// block, so watching where the cranes go is a market signal.
const GROWTH_RATE: Record<string, number> = {
  expansion: 0.88, peak: 0.62, recovery: 0.42, recession: 0.09,
};

function useForZone(zone: string, demand: number, r: number): DevUse {
  if (zone.startsWith("M")) return "industrial";
  if (zone.startsWith("R")) return "multifamily";
  if (demand > 70) return r < 0.55 ? "office" : r < 0.85 ? "mixed" : "retail";
  if (demand > 45) return r < 0.4 ? "mixed" : r < 0.8 ? "multifamily" : "retail";
  return r < 0.7 ? "multifamily" : "retail";
}

export function tickCityGrowth(
  s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null,
) {
  const rate = GROWTH_RATE[s.econ.phase] ?? 1;
  let n = Math.floor(rate) + (rng(s) < rate % 1 ? 1 : 0);
  // the town matures: later buildings are bigger than the first ones
  const maturity = Math.min(1, s.month / 780);

  while (n-- > 0) {
    // sample a handful of candidates, build on the most in-demand of them
    let best: { bbl: string; rec: (typeof parcels)[string] } | null = null;
    let bestScore = -1;
    for (let i = 0; i < 36; i++) {
      const bbl = bbls[Math.floor(rng(s) * bbls.length)];
      if (s.holdings[bbl] || s.built[bbl] || s.developments[bbl]) continue;
      const rec = parcels[bbl];
      if (!rec || rec.class !== "land" || rec.lotArea < 1500) continue;
      // the city builds where the neighbourhood has BECOME good, not where it
      // started good — which is how your first tower pulls the market to you
      const score = demandNow(s, rec) + rng(s) * 25;
      if (score > bestScore) { bestScore = score; best = { bbl, rec }; }
    }
    if (!best) continue;
    const { bbl, rec } = best;
    const dNow = demandNow(s, rec);
    const use = useForZone(rec.zoneDist, dNow, rng(s));
    const farMax = farMaxFor(rec);
    // young town builds small; a mature one builds to the envelope
    const frac = Math.min(0.95, 0.22 + 0.45 * maturity + 0.3 * (dNow / 100) * maturity + rng(s) * 0.15);
    const sf = Math.max(3000, Math.round((rec.lotArea * farMax * frac) / 100) * 100);
    const floors = Math.max(1, Math.round(sf / (rec.lotArea * 0.62)));
    const cmix = devMix(use);
    s.built[bbl] = { class: dominantOf(cmix), mix: cmix, bldgArea: sf, floors, yearBuilt: 2000 + Math.floor(s.month / 12) };
    s.cityBuilt.push(bbl);

    // land appreciates on the block that just got built
    bumpLand(s, bbl, 1.05);
    for (const nb of adjacency?.[bbl] ?? []) bumpLand(s, nb, 1.03);

    if (rng(s) < 0.28) {
      s.news.unshift({
        q: s.month, kind: "info",
        text: floors >= 8
          ? `A ${floors}-story ${use} building topped out at ${rec.address}.`
          : `New ${use} construction delivered at ${rec.address}.`,
      });
    }
  }
}

export function bumpLand(s: GameState, bbl: string, mult: number) {
  s.landAdj[bbl] = Math.min(4, (s.landAdj[bbl] ?? 1) * mult);
}
