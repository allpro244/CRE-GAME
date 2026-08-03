// Leasing: named tenants, inbound LOIs scaled by demand and the cycle,
// counters, TI/LC signing costs, renewals where the incumbent weighs the
// market against moving costs, and rollover risk that clusters.
// Multifamily skips all of this and runs aggregate occupancy.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, Credit, GameState, Holding, LOI, Sector } from "./types";
import { logBooks, monthLabel, CAP_PLAN_RATE, serviceSpec, planSpec, SVC_SPEED, SVC_START } from "./types";
import type { Tenant } from "./types";
import { rng, rrange, NATURAL_VAC, vacancyPull, industryStress, industryPull, INDUSTRY_LABEL } from "./market";

const clampL = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
import { managedRentPsfYr, useRentPsfYr, useOccupancy, resolveRec, opexPsf, TAX_RATE, recoveryOf, demandLinear,
  condGrade, initialCondIdx, condCeiling, COND_DECAY, COND_WEAR_REF, CONDITION_RENT_MULT, holdingValue } from "./value";
import { blendBy, commercialShare, dominantUse, mixOf, uses, useSf } from "./mix";
import type { Recovery } from "./value";
import { drawLoc, locAvailable } from "./credit";

import { leasingOdds, drawRequirementSf } from "./absorption";

/**
 * What a lease of this class looks like when it is signed. Office in this
 * market is mostly full-service with a base-year stop; retail and industrial
 * are triple-net; a minority of everything is flat gross.
 */
function rollRecovery(s: GameState, cls: string): Recovery {
  const r = rng(s);
  switch (cls) {
    case "retail":     return r < 0.86 ? "nnn" : r < 0.95 ? "base" : "gross";
    case "industrial": return r < 0.92 ? "nnn" : "base";
    case "office":     return r < 0.30 ? "nnn" : r < 0.88 ? "base" : "gross";
    default:           return r < 0.45 ? "nnn" : r < 0.86 ? "base" : "gross";
  }
}

/** The expense level frozen into a base-year lease on the day it is signed. */
function stopPsfNow(rec: ParcelRecord, econ: GameState["econ"], h: Holding, use?: BuiltClass): number {
  const tax = (h.assessed ?? h.costBasis) * TAX_RATE / Math.max(1, rec.bldgArea);
  const sys = h.programsDone?.systems !== undefined;
  // A shop and an office in the same building do not have the same expense
  // stop — their expense loads are not the same and never were.
  const op = use ? opexPsf(use, econ, sys, h.service) : blendBy(rec, (u) => opexPsf(u, econ, sys, h.service));
  return op + tax;
}

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M`
  : n >= 10_000 ? `$${Math.round(n / 1000)}K`
  : `$${Math.round(n).toLocaleString()}`;

const POOL: Record<Sector, string[]> = {
  finance: ["Meridian Capital", "Harborline Securities", "Crown & Weir", "Bellamy Fund Group", "Quayside Partners"],
  law: ["Ashe & Porter LLP", "Calder Marsh", "Winslow Legal", "Tern & Rigging", "Foundry Law Group"],
  tech: ["Brightwater Systems", "Ledgerworks", "Spindrift Labs", "Cordage Software", "Beacon Analytics"],
  media: ["The Alden Ledger", "Harborcast Studios", "Gullwing Press", "Northside Signal"],
  insurance: ["Maritime Mutual", "Anchor Assurance", "Seawall Underwriters", "Garland Indemnity"],
  logistics: ["Freightline Co.", "Slipway Cargo", "Gantry Freight", "Blue Hull Shipping"],
  apparel: ["Tidewater Trading Co.", "Rowan Thread Works", "Salt & Selvedge", "Customs House Outfitters"],
  food: ["The Chandler Room", "Bell Slip Provisions", "Kiln Street Roasters", "Founders Market Hall"],
  medical: ["Harbor Medical Group", "Northside Clinic", "Beacon Dental", "Alden Diagnostics"],
  design: ["Marsh & Vane Architects", "Cooper Lane Studio", "Pier Four Design", "Whitlow Drafting"],
};
const SECTORS_BY_CLASS: Record<string, Sector[]> = {
  office: ["finance", "law", "tech", "media", "insurance", "design"],
  retail: ["apparel", "food", "medical"],
  industrial: ["logistics", "food", "apparel"],
};

/**
 * WHO IS ACTUALLY LOOKING FOR SPACE.
 *
 * Not a uniform draw across the trades that can use this class. A booming
 * industry is expanding and touring; one in a bust is handing space back, not
 * taking it. So the mix of prospects at your door tilts toward whoever is
 * hiring — which is also how a landlord ends up concentrated without ever
 * deciding to be.
 */
function pickSector(s: GameState, cls: string): Sector {
  const arr = SECTORS_BY_CLASS[cls] ?? SECTORS_BY_CLASS.office;
  const w = arr.map((k) => industryPull(s.econ, k));
  let roll = rng(s) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) { roll -= w[i]; if (roll <= 0) return arr[i]; }
  return arr[arr.length - 1];
}
function pickName(s: GameState, sector: Sector): string {
  const arr = POOL[sector];
  return arr[Math.floor(rng(s) * arr.length) % arr.length];
}
function rollCredit(s: GameState, demand: number): Credit {
  const r = rng(s) + demand / 250;
  return r > 0.95 ? 2 : r > 0.55 ? 1 : 0;
}

export function isCommercial(rec: ParcelRecord): boolean {
  // A block of flats with shops underneath has a commercial rent roll. It also
  // has apartments. Both are true, and the building is managed as both.
  return rec.class !== "land" && commercialShare(rec) > 0.02;
}

/** The commercial part of a building: the square feet with named tenants. */
export function commercialSf(rec: ParcelRecord): number {
  return (rec.bldgArea || 0) * commercialShare(rec);
}

/** Which uses in this building lease to named tenants. */
export function leasableUses(rec: ParcelRecord): BuiltClass[] {
  return uses(rec).filter((u) => u !== "multifamily");
}

// ---------------------------------------------------------------- the stack
// A building is not an undivided pile of square feet — it is a fixed number of
// leasable spaces, and that number is the thing a landlord actually manages.
// Everything downstream (the rent roll, inbound LOIs, occupancy on the
// portfolio) is expressed in whole suites, so "3 of 4 leased" is the truth
// rather than a rounding of some square-foot ratio.
//
// Typical suite by class, in sf. Bigger buildings get bigger suites — a
// 400,000 sf tower does not lease in 2,000 ft bites — but never so big that a
// tower becomes a single unit.
/** The smallest space anybody will take on a commercial lease here. */
export const COMMERCIAL_SUITE_MIN = 2_000;

export function useSuiteSf(rec: ParcelRecord, use: BuiltClass): number {
  // A building you programmed yourself is cut the way you cut it.
  const chosen = rec.suites?.[use as Exclude<BuiltClass, "land">];
  if (chosen && chosen > 0) return chosen;
  // Sized off the COMPONENT, not the building. Ground-floor retail under a
  // tower demises into shops, not into floors — sizing it off the tower gave
  // a 400,000 sf building 30,000 sf "shops", which is a department store.
  const a = Math.max(1, useSf(rec, use) || rec.bldgArea);
  switch (use) {
    case "multifamily": return 900;                                    // an apartment
    case "industrial":  return Math.max(12_000, Math.min(90_000, a / 2.2));
    // TWO THOUSAND FEET IS THE FLOOR FOR A COMMERCIAL TENANCY.
    //
    // Shops were demising to 1,400 and offices to 2,500, which produced towers
    // cut into forty tiny suites and a rent roll that read like a market stall.
    // Below about two thousand feet a commercial tenancy is not an asset —
    // it is a serviced office or a kiosk, and neither is what this game is
    // about. Flats keep their own floor, because a flat is a flat.
    case "retail":      return Math.max(COMMERCIAL_SUITE_MIN, Math.min(14_000, a / 6));
    default:            return Math.max(COMMERCIAL_SUITE_MIN, Math.min(28_000, a / 12));  // office
  }
}
/** The building's headline suite size — its dominant leasable use. */
export function suiteSf(rec: ParcelRecord): number {
  return useSuiteSf(rec, leasableUses(rec)[0] ?? dominantUse(rec));
}

// How many leasable spaces the building holds.
export function unitCount(rec: ParcelRecord): number {
  if (!rec.bldgArea) return 0;
  // The sum of the parts. A block of flats over shops has apartments AND
  // shops, and dividing the whole building by one suite size counted neither.
  let n = 0;
  for (const u of uses(rec)) {
    const sf = useSf(rec, u);
    if (sf <= 0) continue;
    n += Math.max(1, Math.round(sf / useSuiteSf(rec, u)));
  }
  return Math.max(1, n);
}

// How many of them a given lease occupies.
export function unitsOf(rec: ParcelRecord, sf: number): number {
  return Math.max(1, Math.round(sf / suiteSf(rec)));
}

/** Leased / total spaces, and the sf behind each — the tenancy at a glance. */
export interface UnitRow { use: BuiltClass; total: number; leased: number; vacant: number; notReady: number; sfPer: number }

/** Leased / total spaces per use — a mixed building has more than one answer. */
export function unitStatusByUse(rec: ParcelRecord, h: Holding, month: number): UnitRow[] {
  const out: UnitRow[] = [];
  const notReadyTotal = notReadySf(h, month);
  for (const use of uses(rec)) {
    const sf = useSf(rec, use);
    if (sf <= 0) continue;
    const sfPer = useSuiteSf(rec, use);
    const total = Math.max(1, Math.round(sf / sfPer));
    if (use === "multifamily") {
      const leased = Math.min(total, Math.round((h.occ ?? 0) * total));
      out.push({ use, total, leased, vacant: total - leased, notReady: 0, sfPer });
      continue;
    }
    const leasedSf = h.tenants.filter((t) => (t.use ?? dominantUse(rec)) === use).reduce((n, t) => n + t.sf, 0);
    const leased = Math.min(total, Math.max(leasedSf > 0 ? 1 : 0, Math.round(leasedSf / sfPer)));
    // make-ready is tracked for the building; apportion it to the commercial legs
    const nr = Math.min(Math.max(0, total - leased), Math.round((notReadyTotal * (sf / Math.max(1, commercialSf(rec)))) / sfPer));
    out.push({ use, total, leased, vacant: Math.max(0, total - leased - nr), notReady: nr, sfPer });
  }
  return out;
}

export function unitStatus(rec: ParcelRecord, h: Holding, month: number): {
  total: number; leased: number; vacant: number; notReady: number; sfPer: number; byUse: UnitRow[];
} {
  const byUse = unitStatusByUse(rec, h, month);
  const sum = (f: (r: UnitRow) => number) => byUse.reduce((a, r) => a + f(r), 0);
  const total = sum((r) => r.total);
  return {
    total, leased: sum((r) => r.leased), vacant: sum((r) => r.vacant),
    notReady: sum((r) => r.notReady), sfPer: suiteSf(rec), byUse,
  };
}

/**
 * Round a requested area to whole suites, bounded by what is actually free.
 *
 * The remainder matters. A building with one and a half suites empty must
 * still be able to let the half — demising a suite is ordinary, and refusing
 * to means a building can never lease its last ten per cent and sits at 91%
 * occupancy for a century.
 */
const PART_SUITE_MIN = COMMERCIAL_SUITE_MIN;   // below this it isn't space, it's a closet
function toSuites(rec: ParcelRecord, want: number, cap: number, use?: BuiltClass): number {
  const sfPer = use ? useSuiteSf(rec, use) : suiteSf(rec);
  // Flats have their own floor — 450 ft is a studio, not a closet.
  const floor = use === "multifamily" ? 450 : PART_SUITE_MIN;
  const maxUnits = Math.floor(cap / sfPer + 0.02);
  // A REMNANT UNDER THE FLOOR IS NOT SPACE. This read
  // `Math.min(PART_SUITE_MIN, sfPer * 0.35)`, and the Math.min quietly
  // collapsed the 2,000 ft floor to 700 the moment the demise was already at
  // the floor — which is most small commercial buildings. Thirty per cent of
  // every inherited rent roll came out below the minimum because of it. A
  // sliver nobody will lease stays vacant; that is what a floor means.
  if (maxUnits < 1) return cap >= floor ? Math.round(cap) : 0;
  const n = Math.max(1, Math.min(maxUnits, Math.round(want / sfPer)));
  const taken = n * sfPer;
  // if letting whole suites would strand an unlettable sliver, take it too
  const left = cap - taken;
  // ...and never more than there is. The 0.02 slop above absorbs float error
  // when the space divides evenly, but it can also round a whole suite up past
  // what is actually vacant — which let buildings sign leases for a few dozen
  // square feet they did not have.
  const out = Math.min(Math.floor(cap), Math.round(left > 0 && left < Math.min(floor, sfPer * 0.35) ? cap : taken));
  // The 0.02 slop can allow a whole suite when the vacancy is a couple of per
  // cent short of one, and the clamp above then trims it back BELOW the floor.
  // That is where the last handful of 1,960 ft offices were coming from.
  return out >= floor ? out : 0;
}

// In-place rent roll at acquisition. Expirations cluster around a couple of
// anchor years — a building with everything rolling at once is a visibly
// riskier asset, and that's the point.
export function genRentRoll(s: GameState, rec: ParcelRecord, holding: Holding) {
  if (!rec.bldgArea) return;
  const m = mixOf(rec);
  if ((m.multifamily ?? 0) > 0) {
    holding.occ = Math.min(0.99, Math.max(0.5, useOccupancy(rec, s.econ, "multifamily") + rrange(s, -0.05, 0.04)));
  }
  if (!isCommercial(rec)) return;
  // A building in place has a rent roll per component: the shops at grade were
  // let to shopkeepers at retail rents on retail terms, and the floors above
  // to firms at office rents. One blended roll described neither.
  const anchors = [
    s.month + Math.round(rrange(s, 9, 36)),
    s.month + Math.round(rrange(s, 39, 90)),
  ];
  for (const use of leasableUses(rec)) {
  const legSf = useSf(rec, use);
  if (legSf < 400) continue;
  // wider than the market model on the downside: a building coming to market
  // is disproportionately one with a leasing problem
  const targetOcc = Math.min(0.98, useOccupancy(rec, s.econ, use) + rrange(s, -0.14, 0.05));
  const market = useRentPsfYr(rec, s.econ, holding.condition, use);
  let leased = 0;
  let guard = 0;
  while (leased < legSf * targetOcc && guard++ < 40) {
    // whole suites only: a tenant takes one space, or knocks a few together
    const free = legSf * targetOcc - leased;
    const want = useSuiteSf(rec, use) * Math.max(1, Math.round(rrange(s, 1, use === "industrial" ? 1.6 : 2.8)));
    const sf = toSuites(rec, want, free, use);
    if (!sf) break;
    const sector = pickSector(s, use);
    const endM = rng(s) < 0.6
      ? anchors[Math.floor(rng(s) * anchors.length) % anchors.length] + Math.round(rrange(s, -3, 3))
      : s.month + Math.round(rrange(s, 6, 96));
    holding.tenants.push({
      name: pickName(s, sector),
      use,
      sector,
      credit: rollCredit(s, demandLinear(rec.demandScore)),
      sf,
      rentPsf: +(market * rrange(s, 0.82, 1.04)).toFixed(2),
      net: use === "office" ? rng(s) < 0.75 : rng(s) < 0.4,
      recovery: rollRecovery(s, use),
      // Signed in the past, so the stop is frozen at the cheaper expense level
      // of that year — the older the lease, the bigger the gap the owner eats.
      baseStopPsf: +(stopPsfNow(rec, s.econ, holding, use) * rrange(s, 0.72, 0.98)).toFixed(2),
      startM: s.month - Math.round(rrange(s, 0, 48)),
      endM: Math.max(s.month + 1, endM),
      // The in-place deposits come across on the settlement statement — cash
      // in, liability up, no effect on net worth. What it does mean is that
      // buying a fully let building hands you real money you will have to
      // give back, which is exactly how the closing works.
      deposit: depositFor(s, market, sf, rollCredit(s, demandLinear(rec.demandScore))),
    });
    s.cash += holding.tenants[holding.tenants.length - 1].deposit ?? 0;
    leased += sf;
  }
  }
}

export function vacantSf(rec: ParcelRecord, h: Holding): number {
  // Only the commercial part. The flats upstairs are not vacant office space,
  // and counting them as such let a mixed building lease its own apartments to
  // a law firm.
  return Math.max(0, commercialSf(rec) - h.tenants.reduce((sum, t) => sum + t.sf, 0));
}

/**
 * Vacant square feet in one component of a building. Space a departing tenant
 * left is NOT available until it has been turned — letting it twice was how a
 * building came to have more square feet under lease than it had floors.
 */
export function useVacantSf(rec: ParcelRecord, h: Holding, use: BuiltClass, month?: number): number {
  const taken = h.tenants.filter((t) => (t.use ?? dominantUse(rec)) === use).reduce((n, t) => n + t.sf, 0);
  const turning = month === undefined ? 0 : notReadySf(h, month, use);
  return Math.max(0, useSf(rec, use) - taken - turning);
}

// Space a departing tenant just left isn't leasable on day one — it's in
// make-ready (demo, paint, systems, demising) for a few months.
export function notReadySf(h: Holding, month: number, use?: BuiltClass): number {
  return (h.makeReady ?? []).reduce(
    (sum, m) => sum + (m.readyM > month && (use === undefined || (m.use ?? use) === use) ? m.sf : 0),
    0,
  );
}

export const MAKE_READY_PSF = 6; // turn cost, $/sf before cost inflation

// Anchor pre-lease for a development: one large credit tenant signed before
// delivery, long paper at a small discount to market for taking the risk.
/**
 * The anchor who signed before there was a building. They took delivery risk
 * and they priced it — `discount` is what that cost you, and it is locked in
 * for a decade and a half.
 */
export function genAnchorTenant(s: GameState, rec: ParcelRecord, h: Holding, sfWanted: number, discount = 1, forUse?: BuiltClass) {
  if (!isCommercial(rec)) return;
  // An anchor pre-lets COMMERCIAL space. In a stacked building the flats above
  // are not part of the deal, and letting the anchor take the whole building
  // put more square feet under lease than the building had.
  const use = (forUse && leasableUses(rec).includes(forUse) ? forUse : leasableUses(rec)[0]) ?? "office";
  const sfAnchor = Math.min(sfWanted, useVacantSf(rec, h, use, s.month));
  if (sfAnchor < 1000) return;
  const sector = pickSector(s, use);
  const market = useRentPsfYr(rec, s.econ, h.condition, use) * discount;
  h.tenants.push({
    name: pickName(s, sector),
    use,
    sector,
    credit: rng(s) > 0.4 ? 2 : 1, // anchors are credit tenants
    sf: Math.round(sfAnchor),
    rentPsf: +(market * rrange(s, 0.9, 0.97)).toFixed(2),
    net: true,
    recovery: "nnn",
    startM: s.month,
    endM: s.month + Math.round(rrange(s, 120, 180)),
  });
}

export function walt(h: Holding, q: number): number {
  const tot = h.tenants.reduce((sum, t) => sum + t.sf, 0);
  if (!tot) return 0;
  return h.tenants.reduce((sum, t) => sum + ((t.endM - q) / 12) * t.sf, 0) / tot;
}

/**
 * TENANT IMPROVEMENT, IN DOLLARS PER SQUARE FOOT PER YEAR OF TERM.
 *
 * This was a flat total-dollar band, and the level it produced was broadly
 * right — office asks averaged $37.50/sf against a real US range of $25-90.
 * The SHAPE was backwards. A fit-out is amortised across the lease, so a
 * three-year tenant gets paint and carpet and a twelve-year one gets a real
 * build-out; handing both the same total meant the short deal cost 10.5% of
 * its own lease value and the long one 5.3%. The landlord was paying most for
 * the tenants who were worth least.
 *
 * Per year of term, the arithmetic comes out at roughly 6-7% of lease value
 * across every term length, which is what a leasing agent would recognise.
 */
export const TI_ASK: Record<string, [number, number]> = {
  office: [2.6, 6.0], retail: [1.0, 2.9], industrial: [0.30, 0.95], multifamily: [0, 0.4],
};

/**
 * HOW HARD A TENANT CAN PUSH, from the state of the market they are in.
 *
 * Concessions used to key off the phase LABEL alone — 0.7 in an expansion,
 * 1.85 in a recession — which meant a class sitting at four per cent vacancy
 * in the middle of a boom still asked for half a year of free rent, because
 * the label said "expansion" and the label knew nothing about that class.
 *
 * Free rent and fit-out are the first things to move when a market turns and
 * they move long before face rents do, so they belong on the vacancy gap for
 * the tenant's OWN class. Below natural, a tenant takes what is offered and is
 * glad of it; a few points above, the landlord is buying the deal.
 *
 * Returns a multiplier on the asking concession: ~0.25 in a genuine squeeze,
 * 1 at natural, ~2.1 in a glut.
 */
export function concessionPressure(e: GameState["econ"], use: string): number {
  const k = (use === "office" || use === "retail" || use === "multifamily" || use === "industrial" ? use : "office") as keyof typeof NATURAL_VAC;
  const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
  // ten points of excess vacancy roughly doubles what a tenant can extract;
  // four points of shortage cuts it to a quarter
  const phase = e.phase === "recession" ? 0.22 : e.phase === "recovery" ? 0.08 : e.phase === "peak" ? -0.04 : -0.10;
  return Math.max(0.22, Math.min(2.1, 1 + gap * 11 + phase));
}

/**
 * HOW FAR THE FIT-OUT MONEY MOVES WITH THE MARKET, which is not as far as
 * free rent does.
 *
 * Free rent doubles in a glut because it costs the landlord nothing today. A
 * fit-out is a construction cost, and the contractor has not heard about the
 * vacancy rate. What actually moves is how much of it the landlord funds
 * rather than the tenant — a much flatter curve. 2.10 becomes 1.55, 0.22
 * becomes 0.40, and 1.00 stays 1.00.
 */
export function tiPressure(concession: number): number {
  return Math.pow(Math.max(0.01, concession), 0.6);
}

/**
 * WHETHER THEY STAY, AND WHY.
 *
 * The renewal gate was one line — `rng(s) < industryStress * 0.55` — and
 * industryStress is zero most of the time, so measured over four fifty-year
 * runs a renewal letter arrived essentially every time a lease rolled. 71% of
 * tenants renewed and the other 29% were the player declining. Nothing the
 * owner did to the building had any bearing on whether its tenants stayed,
 * which is the single largest thing an operator actually controls.
 *
 * Every term here is something the player has decided or can read: how the
 * building is run, what state it is in, whether they are over market, what
 * their own trade is doing, whether the space still fits them, their covenant,
 * and how long they have been sitting there. `why` is sorted by how much each
 * one hurt, so the news line and the rent roll can both name the real reason.
 *
 * Neutral settings on an ordinary building land at the 0.96 ceiling, which is
 * where this engine already was — the whole spread is downside, and it is
 * earned.
 */
export interface RenewalRead { p: number; why: string[] }
export function renewalIntent(s: GameState, rec: ParcelRecord, h: Holding, t: Tenant): RenewalRead {
  const svc = h.svcIdx ?? SVC_START;
  const cond = h.condIdx ?? 0.6;
  const use = t.use ?? (rec.class as BuiltClass);
  const market = Math.max(1, managedRentPsfYr(rec, s.econ, h, use));
  const over = t.rentPsf / market;
  const stress = industryStress(s.econ, t.sector);
  const boom = Math.max(0, s.econ.industryMom?.[t.sector] ?? 0);
  const need = t.sf * (t.staff ?? 1);
  const free = useVacantSf(rec, h, use, s.month);
  const fSvc = 0.74 + 0.48 * svc;
  const fCond = 0.84 + 0.30 * cond;
  const fRent = over > 1.12 ? 0.74 : over > 1.04 ? 0.88 : over < 0.88 ? 1.10 : 1;
  const fInd = clampL(1 - stress * 0.55 + boom * 5, 0.45, 1.15);
  const fFit = need > t.sf * 1.30 ? (free > COMMERCIAL_SUITE_MIN ? 0.86 : 0.55)
    : need < t.sf * 0.78 ? 0.88 : 1;
  const fCred = t.credit === 2 ? 1.06 : t.credit === 0 ? 0.94 : 1;
  const fTen = 1 + 0.05 * Math.min(2, (s.month - t.startM) / 120);
  const why: { s: string; w: number }[] = [];
  if (fSvc < 0.95) why.push({ s: "the building is not being run to their standard", w: 1 - fSvc });
  if (fSvc > 1.10) why.push({ s: "they like the way the building is run", w: fSvc - 1 });
  if (fCond < 0.98) why.push({ s: `the plant is ${h.condition}`, w: 1 - fCond });
  if (fRent < 1) why.push({ s: `they are ${Math.round((over - 1) * 100)}% over market`, w: 1 - fRent });
  if (fInd < 0.95) why.push({ s: `${INDUSTRY_LABEL[t.sector].toLowerCase()} is contracting`, w: 1 - fInd });
  if (fFit < 0.95) why.push({ s: need > t.sf ? "they have outgrown the space and there is nothing to give them" : "they are paying for space they no longer use", w: 1 - fFit });
  why.sort((a, b) => b.w - a.w);
  const p = clampL(0.94 * fSvc * fCond * fRent * fInd * fFit * fCred * fTen, 0.10, 0.96);
  return { p, why: why.length ? why.map((x) => x.s) : ["they simply moved"] };
}

export function tickLeasing(s: GameState, parcels: ParcelTable) {
  const q = s.month;
  // expire stale LOIs and LOIs on parcels no longer owned
  s.lois = s.lois.filter((l) => l.expiresM > q && s.holdings[l.bbl]);

  // A LETTER FOR SPACE THAT IS GONE DOES NOT SIT ON YOUR DESK.
  //
  // Every letter is sized against the vacancy on the day it was written, and
  // more than one can be live on the same building at once — the tour sweeps
  // its own members when one signs, but two letters from DIFFERENT tours were
  // never each other's business. So you could sign the first, take the floor
  // down to a sliver, and be left holding a second letter for space that no
  // longer existed. Accepting it ran the clamp in signLoi, found less than a
  // demisable suite left, and returned without signing anything: the letter
  // vanished off the desk and no lease appeared. From the player's chair that
  // is the game quietly eating an input, which is the worst thing software can
  // do, and it is exactly what a playtester hit on a building they had just
  // finished developing.
  //
  // The fix is at the source. A prospect whose space got let while they were
  // deciding does not wait around — they go and look at somebody else's
  // building, and they say so on the way out.
  {
    const gone: LOI[] = [];
    s.lois = s.lois.filter((l) => {
      if (l.kind !== "new" && l.kind !== "expansion") return true;
      const rec = resolveRec(parcels, s, l.bbl);
      const h = s.holdings[l.bbl];
      if (!rec || !h) return true;
      const use = l.use ?? leasableUses(rec)[0] ?? "office";
      const floor = use === "multifamily" ? 450 : COMMERCIAL_SUITE_MIN;
      if (useVacantSf(rec, h, use, q) >= floor) return true;
      gone.push(l);
      return false;
    });
    for (const l of gone) {
      const rec = resolveRec(parcels, s, l.bbl);
      s.news.unshift({
        q, kind: "info",
        text: `${l.name} have withdrawn from ${rec?.address ?? "your building"} — the space they were looking at `
          + `let while they were deciding, and what is left will not demise.`,
      });
    }
  }

  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;

    // The flats in this building — whether it is a block of flats or a block
    // of flats with shops underneath — run on aggregate occupancy.
    const resShare = mixOf(rec).multifamily ?? 0;
    if (resShare > 0) {
      const target = useOccupancy(rec, s.econ, "multifamily");
      h.occ = Math.min(0.99, Math.max(0.4, (h.occ ?? target) + (target - (h.occ ?? target)) * 0.1 + rrange(s, -0.006, 0.006)));
    }
    const renovating = h.renovatingUntilM !== undefined && q < h.renovatingUntilM;

    // --- obsolescence --------------------------------------------------------
    //
    // THIS USED TO BE A COIN FLIP WITH A FLOOR, AND IT SAT BELOW THE COMMERCIAL
    // GUARD, WHICH MEANT APARTMENTS NEVER AGED AT ALL.
    //
    // The old rule: wait 240-320 months since the last capital, then roll a 2%
    // monthly chance of dropping one named grade, and reset the clock. Measured
    // over a 600-month hold that is two steps from `good`, one from `standard`
    // and — because the ladder returned null at the bottom — NONE from `worn`.
    // 55% of this city's built stock starts worn. Half the map was immune to
    // age, and because worn carries a +70bp cap spread it was also the cheapest,
    // highest-yielding half. Buy the best yield on the tape, hold it forever,
    // spend nothing: measured at a $158.9M median over twenty seeds against a
    // $218.4M median for a policy that did everything.
    //
    // The street has always had the right model — tickAssetManagement in
    // rivals.ts decays condIdx every month and arrests it with a capital plan of
    // about 30bps of gross assets a year, and its comment says the firms that
    // skip it "are marked down for it exactly the way the player is". They were
    // not. This is the player's half of that sentence.
    //
    // The plan is automatic and has no control anywhere, because a monthly
    // maintenance prompt is a chore and this is not one: it is debited like tax
    // and overhead, it lands on the `capex` line in the Books, and the only
    // thing that stops it is running out of money — which is exactly the doom
    // loop that should follow being over-levered into a downturn. The DECISION
    // is the capital programme in dev.ts, which the plan cannot substitute for.
    if (!renovating && rec.class !== "land" && rec.bldgArea > 0) {
      h.lastCapM = h.lastCapM ?? h.boughtM;
      if (h.condIdx === undefined) h.condIdx = initialCondIdx(rec, h.boughtM, h.condition);
      const was = h.condition;

      // The bricks go down every month. Old bones go down faster: the same
      // dollar of plan buys less on a 1928 building than on a 2015 one, which
      // is the whole reason a city has to keep rebuilding itself.
      const age = 2000 + Math.floor(q / 12) - rec.yearBuilt;
      const wear = (COND_DECAY[rec.class as BuiltClass] ?? 0.0024)
        * (1 + Math.min(0.50, age / 220))
        * (s.econ.phase === "recession" ? 1.2 : 1);
      h.condIdx -= wear;

      // THE CAPITAL PLAN. 34bps of gross asset value a year, spent without being
      // asked. It is the first thing that goes when the money is short, and a
      // building whose cash flow the lender has swept does not get it at all.
      // HOW THE BUILDING IS RUN, as the tenants experience it — which is not
      // the switch, it is the average of the switch over about three years. A
      // service cut shows up in NOI next month and in the rent roll in 2007.
      const svc = serviceSpec(h.service);
      h.svcIdx = (h.svcIdx ?? SVC_START) + (svc.aim - (h.svcIdx ?? SVC_START)) * SVC_SPEED;

      // THE CAPITAL PLAN, AND IT IS A DECISION NOW. It was a constant charged
      // on every building unconditionally, and this file said so: "the plan is
      // automatic and has no control anywhere". Measured over 1,046 building-
      // years, condition improved 44 times and slipped 9 — the automatic plan
      // out-ran decay on 83% of all movement, so there was no way to run a
      // building well and no way to run one badly except by going broke.
      //
      // Priced against what THIS building consumes, so an old office eats more
      // reserve than a new shed. Defer sets no planCutM: choosing not to spend
      // is not the same as being unable to, and the annual warning in sim.ts
      // is about the second thing.
      const plan = planSpec(h.plan);
      const gav = holdingValue(rec, s.econ, h, q);
      const want = Math.round((CAP_PLAN_RATE * plan.mult * gav * (wear / COND_WEAR_REF)) / 12);
      if (want > 0 && s.cash > want * 4 && !h.loan?.sweep) {
        s.cash -= want;
        logBooks(s, "capex", want);
        h.condIdx += wear * plan.lift;
        h.lastCapM = q;
      } else if (want > 0) {
        h.planCutM = q;
      }
      // A building can never be made better than its bones allow — see
      // condCeiling. New construction is the only way to own the top of the
      // scale, which is most of what a developer is buying.
      h.condIdx = Math.max(0.20, Math.min(condCeiling(rec, q), h.condIdx));
      h.condition = condGrade(h.condIdx);
      if (h.condition !== was && CONDITION_RENT_MULT[h.condition] < CONDITION_RENT_MULT[was]) {
        s.news.unshift({
          q, kind: "warn",
          text: h.condition === "obsolete"
            ? `${rec.address} has aged out of the market. The plant is finished, the plan is not enough to bring it back, and until somebody spends real money on it nobody will lease it and no institution will lend on it.`
            : `${rec.address} has slipped to ${h.condition} condition — the systems are dated and the brokers have noticed. Rents will follow.`
              + (h.planCutM !== undefined && q - h.planCutM < 24 ? " The capital plan there has been going unfunded." : ""),
        });
      }
    }

    if (!isCommercial(rec)) continue;

    // move-outs: leases that reached expiry without a signed renewal.
    // The space goes into make-ready — a turn cost now, leasable in a few months.
    const movedOut = h.tenants.filter((t) => t.endM <= q);
    h.tenants = h.tenants.filter((t) => t.endM > q);
    if (movedOut.length) {
      const outSf = movedOut.reduce((sum, t) => sum + t.sf, 0);
      const turnCost = Math.round(outSf * MAKE_READY_PSF * s.econ.costIdx);
      s.cash -= turnCost;
      logBooks(s, "capex", turnCost);
      // THE DEPOSIT GOES BACK. It was never yours: it arrived as cash at
      // signing and sat as a liability against your net worth for the whole
      // term. A tenant who left owing you nothing takes it with them; one who
      // defaulted forfeited it when they went, and is not in this list.
      const returned = movedOut.reduce((sum, t) => sum + (t.deposit ?? 0), 0);
      if (returned > 0) s.cash -= returned;
      // Downtime is the expensive half of rollover and nobody underwrites it
      // honestly. A suite handed back in a soft office market is dark for the
      // better part of a year: demo, demise, permit, market, build out.
      const soft = s.econ.phase === "recession" ? 1.7 : s.econ.phase === "recovery" ? 1.3 : s.econ.phase === "peak" ? 0.95 : 0.8;
      // Downtime is a property of the SPACE, not the building: a shop relets
      // faster than a floor, and each turns on its own clock.
      const lagFor = (u: BuiltClass | undefined) =>
        u === "office" ? 5.5 : u === "industrial" ? 2.5 : 3.5;
      const entries = movedOut.map((mo) => ({
        sf: mo.sf,
        use: mo.use,
        readyM: q + Math.max(1, Math.round(lagFor(mo.use ?? dominantUse(rec)) * soft * rrange(s, 0.7, 1.4))),
      }));
      const down = Math.max(...entries.map((e) => e.readyM - q));
      h.makeReady = [...(h.makeReady ?? []), ...entries];
      s.news.unshift({
        q, kind: "info",
        text: `${(outSf / 1000).toFixed(1)}k sf back at ${rec.address} — $${(turnCost / 1000).toFixed(0)}K make-ready, ${down} months before it can be shown.`,
      });
    }
    // finished turns come off the books
    if (h.makeReady) {
      h.makeReady = h.makeReady.filter((m) => m.readyM > q);
      if (!h.makeReady.length) delete h.makeReady;
    }
    // leasing broker retainer: a live exclusive costs money every month it runs
    if (h.broker) {
      const vacNow = vacantSf(rec, h);
      if (vacNow > 500) {
        const fee = Math.max(400, Math.round(vacNow * 0.025));
        s.cash -= fee;
        logBooks(s, "leasing", fee);
      } else delete h.broker; // full building: the exclusive lapses
    }

    // --- credit events ------------------------------------------------------
    // Tenants fail. They fail far more often in a downturn, far more often
    // when they were weak credit to begin with, and the space comes back
    // mid-term with no notice and no termination fee worth collecting. This is
    // the risk a rent roll of unrated startups is actually carrying, and the
    // reason a boring insurance company at a lower rent underwrites better.
    for (let i = h.tenants.length - 1; i >= 0; i--) {
      const t = h.tenants[i];
      if (q - t.startM < 6) continue;                       // give them a quarter to fail
      const cycle = s.econ.phase === "recession" ? 3.4 : s.econ.phase === "recovery" ? 1.7 : s.econ.phase === "peak" ? 0.9 : 0.55;
      const grade = t.credit === 2 ? 0.14 : t.credit === 1 ? 0.55 : 1.6;   // investment grade rarely goes dark
      const sectorStress = Math.max(0, -(s.econ.sectorMom?.[rec.class as "office"] ?? 0)) * 40;
      // AND THE TENANT'S OWN TRADE. This is the whole point of modelling
      // industries: a technology bust does not take out one startup, it takes
      // out every startup you have, in every building, in the same eighteen
      // months. Concentration stops being a word and becomes a thing that
      // happens to you.
      const trade = industryStress(s.econ, t.sector) * 2.6;
      const pFail = 0.00035 * cycle * grade * (1 + sectorStress + trade);
      if (rng(s) >= pFail) continue;
      // FORFEITING A DEPOSIT IS NOT A CASH RECEIPT. It was collected at
      // signing and has been sitting in your account ever since as somebody
      // else's money; what changes on a default is that you stop owing it
      // back. This used to splice the tenant — correctly releasing the
      // liability, which is the whole forfeiture — and then ALSO credit three
      // months of contract rent as if the deposit were arriving now. You were
      // paid twice, and the news reported the phantom number as the deposit.
      const kept = Math.round(t.deposit ?? 0);
      h.tenants.splice(i, 1);
      const down = Math.max(2, Math.round((rec.class === "office" ? 6 : 4) * rrange(s, 0.8, 1.5)));
      h.makeReady = [...(h.makeReady ?? []), { sf: t.sf, readyM: q + down, use: t.use }];
      s.news.unshift({
        q, kind: "warn",
        text: `${t.name} filed and went dark at ${rec.address} — ${(t.sf / 1000).toFixed(1)}k sf back with ${(t.endM - q) / 12 > 1 ? `${((t.endM - q) / 12).toFixed(1)} years` : `${t.endM - q} months`} left on the lease. You kept their $${(kept / 1000).toFixed(0)}K deposit — which is a month of the hole, not a year of it.`,
      });
    }

    // contractual escalations: rents step up ~2.5% on each lease anniversary
    for (const t of h.tenants) {
      const age = q - t.startM;
      if (age > 0 && age % 12 === 0) {
        t.rentPsf = +(t.rentPsf * 1.025).toFixed(2);
        // AND THE COVENANT MIGRATES. Credit was frozen at signing, so a decade
        // of technology boom never improved a roll and a five-year bust never
        // degraded one — measured at zero credit changes across 163 tenancies.
        // It already drives default odds, deposit size, the renewal discount
        // and the quality spread a buyer pays. This is the only wire missing.
        const ph = s.econ.industryPhase?.[t.sector];
        if (ph === "boom" && t.credit < 2 && rng(s) < 0.055) t.credit = (t.credit + 1) as Credit;
        else if (ph === "bust" && t.credit > 0 && rng(s) < 0.075) t.credit = (t.credit - 1) as Credit;
      }
      // HEADCOUNT. Measured, a p95 boom compounds this to 1.65x over two years
      // and a bust runs it back down. Everything else in this block reads it.
      t.staff = clampL((t.staff ?? 1) * (1 + (s.econ.industryMom?.[t.sector] ?? 0) * 1.6 + rrange(s, -0.004, 0.004)), 0.40, 2.6);
    }

    // --- the roll grows -----------------------------------------------------
    //
    // A tenant who has outgrown their suite has exactly two futures and you
    // choose which: they take the space next door, or they tour. If there is
    // room, a letter arrives and it is a real decision — the certain covenant
    // coterminous with a lease you already hold, against holding the suite for
    // a full-term tenant at a better number. If there is no room, nothing
    // arrives and renewalIntent quietly halves, which is why keeping a floor of
    // slack in a building with a growing anchor is asset management and not
    // sloppiness.
    for (let i = 0; i < h.tenants.length && !h.leasingHold && !renovating; i++) {
      const t = h.tenants[i];
      const need = t.sf * (t.staff ?? 1);
      if (need < t.sf * 1.30) continue;
      if (t.endM - q < 12) continue;              // inside a year it is a renewal question
      if (t.askedM !== undefined && q - t.askedM < 24) continue;
      if (s.lois.some((l) => l.bbl === h.bbl && l.tenantIdx === i)) continue;
      const use = t.use ?? leasableUses(rec)[0] ?? "office";
      const free = useVacantSf(rec, h, use, q);
      const wantSf = toSuites(rec, Math.min(free, need - t.sf), free, use);
      if (!wantSf) continue;
      if (rng(s) > 0.16) continue;                // they get round to it
      t.askedM = q;
      const market = managedRentPsfYr(rec, s.econ, h, use);
      s.lois.push({
        id: s.nextLoiId++, arrivedM: q, bbl: h.bbl, kind: "expansion", use,
        name: t.name, sector: t.sector, credit: t.credit, sf: wantSf,
        rentPsf: +(market * rrange(s, 0.96, 1.06)).toFixed(2),
        termM: Math.max(24, t.endM - q),          // coterminous with what they hold
        tiPsf: Math.round(rrange(s, 1, 5) * concessionPressure(s.econ, use)),
        freeM: 0, net: t.net, recovery: recoveryOf(t),
        expiresM: q + 3, tenantIdx: i,
      });
      s.news.unshift({
        q, kind: "deal",
        text: `${t.name} has grown into their space at ${rec.address} and wants the ${(wantSf / 1000).toFixed(1)}k sf next door, coterminous with the lease they are on.`,
      });
    }

    // renewal talks open six months ahead of expiry — unless you have stopped
    // letting the building, in which case nobody is offered a renewal and the
    // roll simply runs off. That is how a building gets emptied for a
    // demolition, and it is slow and expensive on purpose.
    for (let i = 0; i < h.tenants.length && !h.leasingHold; i++) {
      const t = h.tenants[i];
      if (t.endM !== q + 6) continue;
      if (s.lois.some((l) => l.bbl === h.bbl && l.tenantIdx === i)) continue;
      // WHETHER THEY EVEN WRITE. This was `rng(s) < industryStress * 0.55` and
      // industryStress is zero most months, so a renewal letter arrived every
      // time a lease rolled and nothing the owner did to the building had any
      // bearing on it. See renewalIntent: how it is run, what state it is in,
      // what you are charging, what their trade is doing, whether it still
      // fits them. And the notice says which of those it was.
      const ri = renewalIntent(s, rec, h, t);
      if (rng(s) > ri.p) {
        s.news.unshift({
          q, kind: "warn",
          text: `${t.name} is not renewing at ${rec.address} — ${ri.why[0]}. `
            + `${(t.sf / 1000).toFixed(1)}k sf comes available ${monthLabel(t.endM)}.`,
        });
        continue;
      }
      const market = managedRentPsfYr(rec, s.econ, h);
      // A tenant sitting well below market knows what a move costs them and
      // renews near market. A tenant ABOVE market knows the same thing in
      // reverse and asks for a cut — and in a soft market they get it.
      const overMarket = t.rentPsf / Math.max(1, market);
      const leverage = overMarket > 1.05 ? 0.82 : overMarket < 0.9 ? 1.0 : 0.94;
      const soft = s.econ.phase === "recession" ? 0.88 : s.econ.phase === "recovery" ? 0.95 : 1;
      // Credit tenants are worth keeping and they know it.
      const creditDisc = t.credit === 2 ? 0.97 : t.credit === 1 ? 1.0 : 1.02;
      // AND WHAT THEIR OWN TRADE IS DOING. A firm in a booming industry is
      // growing into its lease and will pay to stay; one in a bust is cutting
      // headcount and either wants a discount or wants out. The building's
      // market is only half of a renewal — the other half is the tenant's.
      const stress = industryStress(s.econ, t.sector);
      const boom = Math.max(0, (s.econ.industryMom?.[t.sector] ?? 0)) * 6;
      const trade = 1 - stress * 0.14 + boom;
      const ask = market * leverage * soft * creditDisc * clampL(trade, 0.78, 1.18);
      // Renewals are cheap to do: no downtime, a fraction of the TI, no free
      // rent worth the name. That gap is why renewal economics beat a new
      // lease at a higher face rent almost every time.
      s.lois.push({
        id: s.nextLoiId++,
        arrivedM: s.month,
        bbl: h.bbl,
        kind: "renewal",
        // A renewal is for the space the tenant is ALREADY in. This carried no
        // use at all, so signing one fell through to the building's dominant
        // use — and in a residential-leaning mixed building that is the flats,
        // which put a named commercial tenant in the housing.
        use: t.use ?? leasableUses(rec)[0] ?? "office",
        name: t.name, sector: t.sector, credit: t.credit,
        // A TENANT WHO HAS SHRUNK RENEWS FOR WHAT THEY NEED. Every renewal in
        // this engine was for exactly the space that was signed, however many
        // people had left in the meantime, so a recession could only ever take
        // whole tenants and never a floor off one. It gives back a suite at a
        // time, and the giveback lands in make-ready like any other vacancy.
        sf: (() => {
          const need = t.sf * (t.staff ?? 1);
          if (need >= t.sf * 0.78) return t.sf;
          return Math.max(COMMERCIAL_SUITE_MIN, toSuites(rec, need, t.sf, t.use ?? "office") || t.sf);
        })(),
        rentPsf: +Math.max(market * 0.6, ask).toFixed(2),
        termM: Math.round(rrange(s, 36, 84)),
        // A sitting tenant asks for less than a new one — no fit-out, no
        // moving costs to cover — but the same market decides how far they get.
        tiPsf: Math.round(rrange(s, 2, 9) * concessionPressure(s.econ, t.use ?? "office")),
        freeM: rng(s) < 0.25 * concessionPressure(s.econ, t.use ?? "office")
          ? Math.round(rrange(s, 1, 3) * concessionPressure(s.econ, t.use ?? "office")) : 0,
        net: t.net,
        recovery: recoveryOf(t),
        expiresM: t.endM,
        tenantIdx: i,
      });
    }

    // inbound demand for vacant, market-ready space
    const vac = vacantSf(rec, h) - notReadySf(h, q);
    // TOURS, NOT LETTERS. Two parties chasing the same suite is ONE decision,
    // not two, so the cap counts conversations rather than envelopes — which
    // keeps the number of live decisions per building exactly where it was.
    const openTours = new Set(
      s.lois.filter((l) => l.bbl === h.bbl && l.kind === "new").map((l) => l.tourId ?? -l.id),
    ).size;
    // a big empty floorplate draws more than one prospect at a time
    const loiCap = vac > rec.bldgArea * 0.5 ? 3 : 2;
    // Same floor on the way in: a building does not go to market with 700 ft
    // of leftover, so nobody turns up asking for it.
    if (!renovating && !h.leasingHold && vac >= PART_SUITE_MIN && openTours < loiCap) {
      // WHERE A LETTER COMES FROM — see absorption.ts. Not a coin flip per
      // building any more: the city has a finite quantity of requirement in the
      // market this month, every vacant foot in town is competing for it, and
      // this building takes its share. Everything that used to be a hand-tuned
      // adjustment on a probability — the phase, the condition, your rent
      // stance, the lobby, the broker, the sector, the jobs number, everyone
      // else's deliveries — is now either a named multiplier the player can
      // read on the panel or a term in the space market itself.
      // WHICH PART of the building is empty decides who walks through the
      // door. A tower with one empty shop at grade and full floors above is
      // being toured by shopkeepers, not law firms — and the shop competes in
      // the retail market, on retail momentum, against retail supply.
      const openLegs = leasableUses(rec)
        .map((u) => ({ u, free: useVacantSf(rec, h, u, q) }))
        .filter((x) => x.free > 400);
      if (!openLegs.length) continue;
      let pickWeight = rng(s) * openLegs.reduce((a, x) => a + x.free, 0);
      let leg = openLegs[0];
      for (const x of openLegs) { pickWeight -= x.free; if (pickWeight <= 0) { leg = x; break; } }
      const use = leg.u;
      const legVac = leg.free;
      // TURNKEY SPACE LEASES. A tenant who can move in next month does not
      // tour the shell down the road, and the funnel widens for the use the
      // suites were built in — and only that one.
      const spec = h.specSuites;
      const specLive = spec !== undefined && spec.use === use && s.month >= spec.readyM;
      const odds = leasingOdds(s, parcels, rec, h, use);
      if (!odds) continue;
      const p = odds.loiOdds;
      if (rng(s) < p) {
        const [tiLo, tiHi] = TI_ASK[use] ?? TI_ASK.office;
        const concession = concessionPressure(s.econ, use);
        // ...and at the rent THAT market pays, not a blend of markets the
        // tenant is not in.
        const market = managedRentPsfYr(rec, s.econ, h, use);
        // Warehouses lease whole: one operator takes the building, or most of
        // it. Offices and shops carve into suites.
        // Prospects ask for spaces, not square feet. Warehouses tend to want
        // the whole shed; offices and shops take one suite or a few.
        // HOW BIG THE REQUIREMENT IS, drawn from the city's own distribution
        // of requirements rather than from the size of your building. A firm
        // looking for eight thousand feet is looking for eight thousand feet
        // whoever owns the floor.
        const want = Math.min(legVac, drawRequirementSf(s, use));
        const sf = toSuites(rec, want, legVac, use);
        if (!sf) continue;
        // A TOUR, NOT A LETTER.
        //
        // Measured over 945 arriving letters across four fifty-year runs:
        // 94.4% of them, if signed, IMPROVED the building's cap-rate grade,
        // 99.8% were fundable from cash, and the expected wait for a
        // replacement prospect was 25.3 months. Against a two-year void even a
        // bad lease wins, so Accept was not a decision — it was the only move
        // on the board, and it was 52% of everything the player did.
        //
        // The answer is not to make signing worse. Filling space SHOULD be
        // good. It is to stop offering the space to one person at a time. A
        // vacant suite is being shown to two or three parties, they are not the
        // same shape, and you can have exactly one of them — which turns a
        // button into a choice without adding a single click.
        //
        // How deep the tour goes is the market's answer, not a constant. In a
        // squeeze you get to be picky; in a glut one party turns up and you had
        // better sign them.
        // Written against the old per-building coin flip, this read `vacancyPull`
        // directly. That helper still exists and still means the same thing —
        // how tight this class's market is, natural vacancy over actual — so it
        // is the right input here even though the arrival above no longer uses
        // it. Depth of tour is a question about the MARKET, not about the odds
        // this particular building drew.
        const marketPull = vacancyPull(s.econ, use);
        const pTwo = Math.max(0.05, Math.min(0.72, (marketPull - 0.55) * 0.62));
        const nTour = 1 + (rng(s) < pTwo ? 1 : 0) + (rng(s) < pTwo * 0.45 ? 1 : 0);
        const tourId = s.nextTourId ?? 1;
        s.nextTourId = tourId + 1;
        for (let k = 0; k < nTour; k++) {
        // THREE SHAPES, and the whole trade-off lives in the difference between
        // them. k=0 is what the market sent. k=1 is THE COVENANT: better
        // credit, long paper, a rent under the others, and it wants a fit-out —
        // it tightens waltSpread and creditSpread and it is 11x less likely to
        // go dark (see pFail: grade 0.14 against 1.6). k=2 is THE GROWTH STORY:
        // unrated, short, and it will pay over the odds — income today against
        // a mark on the building tomorrow. Both of those are already priced by
        // rollQualitySpread. The choice was simply never offered.
        const sector = pickSector(s, use);
        const drawnCredit = rollCredit(s, demandLinear(rec.demandScore));
        const credit: Credit = k === 1 ? (Math.min(2, drawnCredit + 1) as Credit)
          : k === 2 ? 0 : drawnCredit;
        const rentBias = k === 1 ? rrange(s, 0.86, 0.95) : k === 2 ? rrange(s, 1.04, 1.16) : 1;
        const termBias = k === 1 ? 1.35 : k === 2 ? 0.6 : 1;
        // term first: the free-rent ask is a function of how long they sign for
        const termM = Math.round(
          (credit === 2 ? rrange(s, 84, 144) : credit === 1 ? rrange(s, 60, 108) : rrange(s, 36, 60))
          * (sf > useSuiteSf(rec, use) * 2.5 ? 1.15 : 1)
          * (s.econ.phase === "recession" ? 0.85 : 1) * termBias,
        );
        s.lois.push({
          id: s.nextLoiId++,
          arrivedM: s.month,
          tourId,
          bbl: h.bbl,
          use,
          kind: "new",
          name: pickName(s, sector),
          sector,
          credit,
          sf,
          // A wide spread on purpose. If every prospect offers within a few
          // per cent of asking, the accept/counter/pass modal is a formality.
          // Some of these should be worth refusing, and refusing should hurt.
          // Turnkey space is worth a premium and asks for no allowance —
          // the fit-out is already standing there, paid for, in the suite the
          // tenant just walked through.
          rentPsf: +(market * (specLive ? 1.05 : 1) * rentBias * (rng(s) < 0.3 ? rrange(s, 0.68, 0.86) : rrange(s, 0.9, 1.1))).toFixed(2),
          // Term length is not random. A credit tenant taking a whole floor
          // signs long paper and expects to be paid for it; a small unrated
          // firm wants three years and an out. WALT is the thing a buyer
          // actually underwrites, and it has to be earned tenant by tenant.
          // Real terms: an investment-grade covenant signs seven to twelve
          // years, a solid mid-market firm five to nine, a small unrated one
          // three to five with a break. The old band ran to fifteen years as a
          // matter of course, which handed the player bond-like income on
          // ordinary space and made WALT a number nobody had to work for.
          termM,
          // Concessions are the first thing to move when a market turns, and
          // they move long before face rents do. A landlord holding headline
          // rent while giving away a year of free rent is the oldest tell in
          // the business.
          // Per year of term, softened against the market, and with a narrower
          // credit spread now that term carries the work the credit multiplier
          // was doing badly.
          tiPsf: Math.round(rrange(s, tiLo, tiHi) * (termM / 12) * tiPressure(concession)
            * (credit === 2 ? 1.18 : credit === 1 ? 1.02 : 0.90) * (specLive ? 0.12 : 1)),
          // Free rent scales with the LENGTH of the deal, the way it does in
          // life — the rule of thumb is about a month a year, and it is the
          // concession a landlord gives before cutting the face rent. A flat
          // nought-to-six-and-a-half band handed a three-year tenant the same
          // holiday as a twelve-year one, and handed both of them one in a
          // market where nobody had to give anything away.
          freeM: Math.max(0, Math.round((termM / 12) * rrange(s, 0.25, 0.85) * concession)),
          net: use === "office" ? rng(s) < 0.8 : rng(s) < 0.4,
          recovery: rollRecovery(s, use),
          expiresM: q + 3,
        });
        }
        s.news.unshift({
          q, kind: "info",
          text: nTour > 1
            ? `${nTour} parties are chasing the same ${(sf / 1000).toFixed(1)}k sf at ${rec.address} — you can only have one of them.`
            : `LOI in at ${rec.address} — check the Deals desk.`,
        });
      }
    }
  }

  if (s.agent) runAgent(s, parcels);
}

// The leasing agent works the whole book for you: every LOI that clears a
// sane rent bar gets signed, at a 6% commission instead of the 4%/2% you'd
// pay negotiating it yourself. Lowballs still get passed on.
export const AGENT_FEE = 0.06;

// ------------------------------------------------------------- pre-built space
//
// The single biggest change in how office space has actually been leased in
// the last decade, and the game had no version of it: instead of handing a
// tenant an allowance and six months of drawings, you fit the space out first
// and rent it turnkey. It leases faster, it leases at a premium, and it
// carries the risk that you have just spent eighty dollars a foot on space
// nobody wants.
// Priced against TI_ASK, not against nothing. A tenant's allowance runs
// $15-40/sf on an office suite; pre-building the same space costs rather more
// per foot, because you are doing the whole job to a generic spec rather than
// contributing to theirs — and because you are doing it before anyone has
// signed. The premium over the allowance is what you pay for speed.
export const SPEC_COST_PSF: Record<string, number> = { office: 48, retail: 26, industrial: 9, multifamily: 0 };
export const SPEC_MONTHS = 4;

export function specSuiteQuote(s: GameState, rec: ParcelRecord, h: Holding, use: BuiltClass, sf: number) {
  const psf = SPEC_COST_PSF[use] ?? SPEC_COST_PSF.office;
  if (!psf) return null;
  const open = useVacantSf(rec, h, use, s.month);
  const take = Math.max(0, Math.min(Math.round(sf), Math.round(open)));
  // You cannot pre-build a closet either. 800 was a number from before the
  // floor existed.
  if (take < (use === "multifamily" ? 450 : COMMERCIAL_SUITE_MIN)) return null;
  return { sf: take, cost: Math.round(take * psf * s.econ.costIdx), readyM: s.month + SPEC_MONTHS, use };
}

export function buildSpecSuites(
  s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass, sf: number,
): { s: GameState; err?: string; msg?: string } {
  const h = s.holdings[bbl];
  const rec = h ? resolveRec(parcels, s, bbl) : null;
  if (!h || !rec) return { s, err: "You don't own that." };
  if (h.specSuites) return { s, err: "There is already pre-built space going in here." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  const q = specSuiteQuote(s, rec, h, use, sf);
  if (!q) return { s, err: "There is not enough open space to pre-build, or this class does not fit out." };
  if (s.cash < q.cost) return { s, err: `Pre-building that runs $${(q.cost / 1e6).toFixed(2)}M — you're short.` };
  const next: GameState = JSON.parse(JSON.stringify(s));
  next.cash -= q.cost;
  logBooks(next, "leasing", q.cost);
  next.holdings[bbl].specSuites = { sf: q.sf, readyM: q.readyM, use };
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Pre-building ${(q.sf / 1000).toFixed(0)}k sf of ${use} at ${rec.address} — $${(q.cost / 1e6).toFixed(2)}M, ready ${monthLabel(q.readyM)}. `
      + `Turnkey space leases faster and dearer, and it is your money sitting in an empty suite until it does.`,
  });
  return { s: next, msg: "Pre-build under way." };
}

/**
 * BLEND AND EXTEND.
 *
 * A sitting tenant with three years left is a lease expiry you can do
 * something about today. You go to them early, give up rent now, and take term
 * in exchange — which is either the cheapest WALT you will ever buy or a
 * discount you did not need to give, depending entirely on where their rent
 * sits against the market and what you think the market does next.
 *
 * They will only talk if there is something in it for them, which means a
 * tenant paying under market has no reason to pick up the phone.
 */
export function blendExtendQuote(s: GameState, rec: ParcelRecord, h: Holding, idx: number) {
  const t = h.tenants[idx];
  if (!t) return null;
  const left = (t.endM - s.month) / 12;
  if (left <= 0.75 || left > 6) return null;   // too late to be early, too early to be relevant
  const market = managedRentPsfYr(rec, s.econ, h, t.use ?? (rec.class as BuiltClass));
  // What they will accept: a cut off today's rent, deeper the further over
  // market they are, and they want real term for it.
  const over = t.rentPsf / Math.max(1, market);
  if (over < 0.92) return null;                // already a bargain — they will not reopen it
  const newRent = +(Math.max(market * 0.94, t.rentPsf * (over > 1.15 ? 0.88 : over > 1.02 ? 0.94 : 0.975))).toFixed(2);
  const addM = Math.round(clampN(36 + 48 * (over - 0.95), 24, 96));
  const annualGive = Math.round((t.rentPsf - newRent) * t.sf * left);
  return {
    idx, name: t.name, sf: t.sf, current: t.rentPsf, market, newRent,
    addM, newEndM: t.endM + addM,
    giveUp: Math.max(0, annualGive),                       // rent forgone over the remaining term
    // no fit-out on a renewal in place, but the broker still gets paid
    cost: Math.round(newRent * t.sf * ((left * 12 + addM) / 12) * 0.02),
  };
}

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function blendExtend(
  s: GameState, parcels: ParcelTable, bbl: string, idx: number,
): { s: GameState; err?: string; msg?: string } {
  const h = s.holdings[bbl];
  const rec = h ? resolveRec(parcels, s, bbl) : null;
  if (!h || !rec) return { s, err: "You don't own that." };
  const q = blendExtendQuote(s, rec, h, idx);
  if (!q) return { s, err: "There is no deal to do with that tenant right now." };
  if (s.cash < q.cost) return { s, err: "You cannot cover the commission on that." };
  const next: GameState = JSON.parse(JSON.stringify(s));
  const t = next.holdings[bbl].tenants[idx];
  next.cash -= q.cost;
  logBooks(next, "leasing", q.cost);
  t.rentPsf = q.newRent;
  t.endM = q.newEndM;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Blend and extend at ${rec.address}: ${t.name} goes to $${q.newRent.toFixed(0)}/sf from $${q.current.toFixed(0)} `
      + `and adds ${(q.addM / 12).toFixed(0)} years, out to ${monthLabel(q.newEndM)}. `
      + `You bought term with rent — whether that was clever depends on what the market does next.`,
  });
  return { s: next, msg: "Extended." };
}
function runAgent(s: GameState, parcels: ParcelTable) {
  for (const loi of [...s.lois]) {
    const h = s.holdings[loi.bbl];
    const rec = resolveRec(parcels, s, loi.bbl);
    if (!h || !rec) continue;
    const market = managedRentPsfYr(rec, s.econ, h);
    if (loi.rentPsf < market * 0.82) {
      s.lois = s.lois.filter((l) => l.id !== loi.id);
      s.news.unshift({ q: s.month, kind: "info", text: `Your agent passed on ${loi.name} at ${rec.address} — the rent was under the market.` });
      continue;
    }
    const cost = loiSigningCost(loi, AGENT_FEE);
    if (s.cash < cost) continue;   // can't fund the TI; the LOI keeps sitting
    signLoi(s, rec, h, loi, AGENT_FEE);
    s.lois = s.lois.filter((l) => l.id !== loi.id);
  }
}

function leaseCosts(loi: LOI, feeRate?: number): { ti: number; lc: number } {
  const ti = loi.tiPsf * loi.sf;
  const rate = feeRate ?? (loi.kind === "new" ? 0.04 : 0.02);
  const lc = loi.rentPsf * loi.sf * (loi.termM / 12) * rate;
  return { ti: Math.round(ti), lc: Math.round(lc) };
}

export function loiSigningCost(loi: LOI, feeRate?: number): number {
  const { ti, lc } = leaseCosts(loi, feeRate);
  return ti + lc;
}

// Put a signed lease on the rent roll. Mutates — both the player's own
// response and the agent's automatic signing come through here.
/**
 * WHAT A LANDLORD HOLDS AGAINST THE SPACE.
 *
 * One to two months of rent, and which end of that you get is a credit
 * question: a covenant everybody has heard of writes one month and argues
 * about it, a start-up with no history writes two and is glad to. It is cash
 * in and a liability on the balance sheet, never income — see Tenant.deposit.
 */
export function depositFor(s: GameState, rentPsf: number, sf: number, credit: Credit): number {
  const monthly = (rentPsf * sf) / 12;
  const months = credit === 2 ? 1.0 : credit === 1 ? rrange(s, 1.2, 1.6) : rrange(s, 1.6, 2.0);
  return Math.round(monthly * months);
}

/**
 * THE DEPOSITS ON ONE BUILDING, handed to the buyer at the closing table.
 *
 * Deposits arrive as cash and leave as cash, and the one path that had neither
 * was a DISPOSAL: the holding disappeared, the liability with it, and the
 * money stayed in your account. Over fifty years of trading that is a slow,
 * invisible subsidy — and it was worth about three times the competent
 * player's median result before the invariant caught it.
 */
export function depositsOn(h: Holding): number {
  return h.tenants.reduce((a, t) => a + (t.deposit ?? 0), 0);
}

/** Every deposit you are sitting on. Cash you hold and do not own. */
export function depositsHeld(s: GameState): number {
  let n = 0;
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) n += t.deposit ?? 0;
  }
  return n;
}

export function signLoi(s: GameState, rec: ParcelRecord, h: Holding, l: LOI, feeRate?: number) {
  // A tenant moving into pre-built space USES IT UP. The suite is theirs now;
  // the next prospect tours a shell again unless you build more.
  if (l.kind === "new" && h.specSuites && h.specSuites.use === (l.use ?? rec.class) && s.month >= h.specSuites.readyM) {
    h.specSuites.sf -= l.sf;
    if (h.specSuites.sf < 800) delete h.specSuites;
  }
  const cost = loiSigningCost(l, feeRate);
  s.cash -= cost;
  logBooks(s, "leasing", cost);
  if (l.kind === "expansion" && l.tenantIdx !== undefined && h.tenants[l.tenantIdx]) {
    // THE SPACE NEXT DOOR. The old floor keeps its rent and the new floor takes
    // today's, so what the row shows afterwards is the blend — which is what a
    // rent roll actually shows after an expansion. Same clamp as a new lease:
    // if the other live letter took the suite first, this one lost it.
    const t = h.tenants[l.tenantIdx];
    const use = l.use ?? t.use ?? (rec.class as BuiltClass);
    const add = Math.min(l.sf, Math.max(0, useVacantSf(rec, h, use, s.month)));
    if (add < COMMERCIAL_SUITE_MIN) {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${l.name} lost the expansion space at ${rec.address} — the other letter signed first, and what is left will not demise.`,
      });
      // Same flag as the new-lease branch. An expansion that signs nothing has
      // to come back to the player as an error rather than as silence.
      (s as GameState & { _signFailed?: string })._signFailed =
        `${l.name} lost the expansion space — the other letter signed first, and `
        + `the ${Math.round(add).toLocaleString()} sf left will not demise.`;
      return;
    }
    t.rentPsf = +(((t.rentPsf * t.sf) + (l.rentPsf * add)) / (t.sf + add)).toFixed(2);
    t.sf += add;
    t.staff = Math.min(t.staff ?? 1, 1.05);
    const top = depositFor(s, t.rentPsf, t.sf, t.credit) - (t.deposit ?? 0);
    s.cash += top;
    t.deposit = (t.deposit ?? 0) + top;
  } else if (l.kind === "renewal" && l.tenantIdx !== undefined && h.tenants[l.tenantIdx]) {
    const t = h.tenants[l.tenantIdx];
    // THEY ARE RENEWING FOR LESS. The space they hand back is space, and it
    // turns like any other giveback before anybody can be shown it.
    if (l.sf < t.sf) {
      h.makeReady = [...(h.makeReady ?? []), { sf: t.sf - l.sf, readyM: s.month + 3, use: t.use }];
      t.sf = l.sf;
      t.staff = Math.min(t.staff ?? 1, 1);
    }
    t.rentPsf = l.rentPsf;
    t.endM = s.month + l.termM;
    // A renewal RESETS the base year. That is the quiet half of every renewal
    // negotiation: the tenant gives up years of accumulated recovery, and the
    // owner gives up the rent they could have pushed. Rolling the stop forward
    // is often worth more than the spread on the rent.
    if (recoveryOf(t) === "base") t.baseStopPsf = +stopPsfNow(rec, s.econ, h, t.use).toFixed(2);
    // AND THE DEPOSIT IS TRUED UP. It was struck against the rent of the day it
    // was signed and then sat there while the rent escalated for twenty years
    // or got cut in a blend-and-extend — which is how a deposit ends up worth
    // four months of a reduced rent. Every renewal restates it, and the
    // difference moves in cash the way it does at a real renewal.
    const wanted = depositFor(s, t.rentPsf, t.sf, t.credit);
    s.cash += wanted - (t.deposit ?? 0);
    t.deposit = wanted;
  } else {
    // An LOI was sized against the vacancy on the day it was written. Two of
    // them can be live at once, so the second one signs against whatever is
    // left — you cannot lease the same floor twice.
    // Residential is modelled as OCCUPANCY, never as named tenants, so the
    // fallback has to come off the leasable (commercial) uses. dominantUse can
    // return multifamily, and did.
    const use = l.use ?? leasableUses(rec)[0] ?? "office";
    const sf = Math.min(l.sf, Math.max(0, useVacantSf(rec, h, use, s.month)));
    // AND THE FLOOR HOLDS HERE TOO. The clamp above shrinks a signed letter to
    // whatever is actually left after the other live one signed, and it only
    // guarded against zero — so a 4,000 ft letter could quietly become a 900 ft
    // lease against a floor that says 2,000. If what is left is not a suite,
    // the deal died when the other one signed; that is what "you cannot lease
    // the same floor twice" costs.
    const floorSf = use === "multifamily" ? 450 : COMMERCIAL_SUITE_MIN;
    if (sf < floorSf) {
      // AND IT IS SAID OUT LOUD. A news line scrolls past; what the player
      // needs is the thing they just clicked telling them why it did nothing.
      // signLoi cannot return an error, so it raises a flag the caller turns
      // into one — see respondLOI.
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${l.name} lost the space at ${rec.address} — the other letter signed first and what is left `
          + `(${Math.round(sf).toLocaleString()} sf) is under the ${floorSf.toLocaleString()} sf minimum. `
          + `Two live letters on one floor is a race, and somebody always loses it.`,
      });
      (s as GameState & { _signFailed?: string })._signFailed =
        `${l.name} lost the space — the other letter signed first, and the `
        + `${Math.round(sf).toLocaleString()} sf left will not demise.`;
      return;
    }
    const deposit = depositFor(s, l.rentPsf, sf, l.credit);
    s.cash += deposit;
    h.tenants.push({
      name: l.name, use, sector: l.sector, credit: l.credit,
      sf, rentPsf: l.rentPsf, net: l.net,
      recovery: l.recovery ?? (l.net ? "nnn" : "gross"),
      baseStopPsf: +stopPsfNow(rec, s.econ, h, use).toFixed(2),
      startM: s.month, endM: s.month + l.termM,
      freeUntilM: l.freeM ? s.month + l.freeM : undefined,
      deposit,
    });
  }
  s.news.unshift({
    q: s.month, kind: "deal",
    text: `Signed${feeRate === AGENT_FEE ? " by your agent" : ""}: ${l.name} — ${l.sf.toLocaleString()} sf at ${rec.address}, $${l.rentPsf.toFixed(0)}/sf, ${(l.termM / 12).toFixed(0)} yrs${l.kind === "renewal" ? " (renewal)" : ""}.`,
  });
}

export type LOIAction = "accept" | "counter" | "decline";

/**
 * Answer a letter of intent.
 *
 * `fund` draws the shortfall on the line of credit as part of the same action.
 * It has to happen in here rather than as two calls from the UI: signing a
 * lease you cannot fund is the one path where the player has no move left, and
 * a draw that lands without the signature following it is worse than either.
 */
export function respondLOI(
  s: GameState, parcels: ParcelTable, id: number, action: LOIAction, fund = false,
  counter?: { rentPsf?: number; tiPsf?: number; bestFinal?: boolean },
): { s: GameState; msg: string; err?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const loi = next.lois.find((l) => l.id === id);
  if (!loi) return { s, msg: "", err: "That LOI is gone." };
  const h = next.holdings[loi.bbl];
  const rec = resolveRec(parcels, next, loi.bbl);
  if (!h || !rec) return { s, msg: "", err: "You no longer control that building." };

  let drawn = 0;
  const sign = (l: LOI): string | null => {
    const cost = loiSigningCost(l);
    if (next.cash < cost) {
      const short = Math.ceil((cost - next.cash) / 1000) * 1000;
      if (!fund) return `Signing costs ${money(cost)} (TI + commission) — you're short ${money(short)}.`;
      const avail = locAvailable(next, parcels);
      if (short > avail) {
        return `Signing costs ${money(cost)}. You're short ${money(short)} and the line only has ${money(avail)} left.`;
      }
      const d = drawLoc(next, parcels, short);
      if (d.err) return d.err;
      Object.assign(next, d.s);
      drawn = short;
    }
    const flagged = next as GameState & { _signFailed?: string };
    delete flagged._signFailed;
    signLoi(next, rec, h, l);
    // signLoi has one path that legitimately signs nothing — the space it was
    // written against went while the letter sat on the desk. That has to come
    // back as an ERROR the player sees, not as silence.
    if (flagged._signFailed) {
      const why = flagged._signFailed;
      delete flagged._signFailed;
      return why;
    }
    return null;
  };
  const drawNote = () => (drawn ? ` Drew ${money(drawn)} on the line to fund it.` : "");

  // TAKING ONE PARTY MEANS LOSING THE OTHERS. Everybody on this tour was
  // chasing the same square feet; the moment it is spoken for, the rest go and
  // look at somebody else's building. This is the cost that Accept never had —
  // not that signing is bad, but that you cannot sign all of them.
  const sweepTour = (l: LOI) => {
    if (l.tourId === undefined) return;
    const lost = next.lois.filter((o) => o.tourId === l.tourId && o.id !== l.id);
    if (!lost.length) return;
    next.lois = next.lois.filter((o) => o.tourId !== l.tourId || o.id === l.id);
    next.news.unshift({
      q: next.month, kind: "info",
      text: `${lost.map((o) => o.name).join(" and ")} ${lost.length > 1 ? "were" : "was"} chasing the same space at `
        + `${rec.address}. You gave it to ${l.name}; they have gone elsewhere.`,
    });
  };

  if (action === "accept") {
    const err = sign(loi);
    if (err) return { s, msg: "", err };
    sweepTour(loi);
    next.lois = next.lois.filter((l) => l.id !== id);
    return { s: next, msg: "Lease signed." + drawNote() };
  }

  if (action === "counter") {
    // Once they have countered back, the number on the table is final —
    // accept it or lose them. No third round; nobody negotiates forever.
    if (loi.stage === "countered") return { s, msg: "", err: "Their counter was final. Take it or pass." };
    if (loi.countered) return { s, msg: "", err: "You already countered — they're deciding." };
    loi.countered = true;
    // GOING BACK TO ONE PARTY COSTS YOU THE PATIENCE OF THE OTHERS.
    //
    // Everybody on this tour knows they are being shopped. Push the one you
    // want and the fallbacks give you a month, not three — so pushing the
    // covenant for rent can leave you with the covenant gone AND the start-up
    // gone, and a 25-month wait for the next prospect. That wait used to be the
    // only outcome of being fussy; now it is the punishment for being greedy.
    for (const o of next.lois) {
      if (o.tourId !== undefined && o.tourId === loi.tourId && o.id !== loi.id) {
        o.expiresM = Math.min(o.expiresM, next.month + 1);
      }
    }
    if (loi.openRentPsf === undefined) loi.openRentPsf = loi.rentPsf;
    // The counter is YOUR terms, off the sliders — a rent and a TI number —
    // not a fixed +6%/−30% nobody chose. Backward-compatible default keeps
    // the old shape for the harness and the agent.
    const askRent = counter?.rentPsf !== undefined ? +counter.rentPsf.toFixed(2) : +(loi.rentPsf * 1.06).toFixed(2);
    const askTi = counter?.tiPsf !== undefined ? Math.round(counter.tiPsf) : Math.round(loi.tiPsf * 0.7);
    const market = managedRentPsfYr(rec, next.econ, h, loi.use);
    const f = askRent / Math.max(1, market);                 // aggression vs the market, not vs their offer
    const vacHere = (next.econ.cityVac?.[loi.use ?? "office"] ?? 0.1);
    const natHere = loi.use === "multifamily" ? 0.045 : loi.use === "retail" ? 0.085 : loi.use === "industrial" ? 0.07 : 0.115;
    const tight = Math.max(-0.3, Math.min(0.35, (natHere - vacHere) * 3));
    const stick = loi.kind === "renewal" ? 0.14 : 0;         // moving is expensive; incumbents bend
    const tiCut = loi.tiPsf > 0 ? Math.max(0, (loi.tiPsf - askTi) / Math.max(1, loi.tiPsf)) * 0.14 : 0;
    // BEST AND FINAL. Saying the number is firm is itself information: it
    // converts some hagglers, because a credible take-it-or-leave-it within
    // reach is easier to sign than to shop — and it hardens the rest, because
    // you have taken away their move. There is no counter-back branch at all:
    // one letter goes out, and the answer is a signature or an empty hallway.
    const bestFinal = counter?.bestFinal === true;
    const pAccept = Math.max(0.04, Math.min(0.95,
      1.58 - f * 1.4 + loi.credit * 0.04 + tight + stick - tiCut
      + (bestFinal ? 0.05 : 0)
      + (next.econ.phase === "expansion" ? 0.06 : next.econ.phase === "recession" ? -0.08 : 0)));
    const openedAt = loi.openRentPsf ?? loi.rentPsf;
    const openTi = loi.tiPsf;
    loi.askedRentPsf = askRent;
    loi.askedTiPsf = askTi;
    loi.rentPsf = askRent;
    loi.tiPsf = askTi;
    // WHAT THEY SAID BACK, kept where you can read it after the card is gone.
    const reply = (outcome: "took" | "walked" | "countered", theirRent: number, theirTi: number) => {
      if (!next.leaseReplies) next.leaseReplies = [];
      next.leaseReplies.unshift({
        m: next.month, bbl: loi.bbl, address: rec.address, name: loi.name, outcome,
        askedRentPsf: askRent, theirRentPsf: +theirRent.toFixed(2),
        askedTiPsf: askTi, theirTiPsf: theirTi, sf: loi.sf, marketPsf: +market.toFixed(2),
      });
      next.leaseReplies = next.leaseReplies.slice(0, 8);
    };
    if (rng(next) < pAccept) {
      const err = sign(loi);
      if (err) {
        next.lois = next.lois.filter((l) => l.id !== id);
        next.news.unshift({ q: next.month, kind: "warn", text: `${loi.name} took your counter at ${rec.address} and you could not fund the fit-out. The deal died.` });
        return { s: next, msg: "", err };
      }
      next.lois = next.lois.filter((l) => l.id !== id);
      sweepTour(loi);
      reply("took", askRent, askTi);
      next.news.unshift({
        q: next.month, kind: "deal",
        text: `${loi.name} took your counter at ${rec.address}: $${askRent.toFixed(2)}/sf against the `
          + `$${openedAt.toFixed(2)} they opened at — ${money((askRent - openedAt) * loi.sf)} a year more rent`
          + (openTi !== askTi ? ` and ${money((openTi - askTi) * loi.sf)} less fit-out.` : "."),
      });
      return { s: next, msg: `${loi.name} took your counter — $${askRent.toFixed(2)}/sf.` + drawNote() };
    }
    // the further past market you pushed, the faster the door — and a firm
    // number leaves nowhere else for a refusal to go, so on best-and-final
    // everyone who does not take it walks.
    const pWalk = bestFinal ? 1 : Math.max(0.15, Math.min(0.92, 0.24 + (f - 1.0) * 2.2));
    if (rng(next) < pWalk) {
      next.lois = next.lois.filter((l) => l.id !== id);
      reply("walked", openedAt, openTi);
      next.news.unshift({ q: next.month, kind: "warn", text: `${loi.name} walked on the counter at ${rec.address} — $${askRent.toFixed(2)}/sf was more than the space was worth to them (market ~$${market.toFixed(2)}). You had $${openedAt.toFixed(2)} on the table.` });
      return { s: next, msg: `${loi.name} walked. You asked $${askRent.toFixed(2)} against a $${market.toFixed(2)} market.` };
    }
    // they counter back once — final
    loi.stage = "countered";
    loi.counterRentPsf = +Math.min(askRent, Math.max(loi.rentPsf * 0.94, market * (0.95 + 0.04 * rng(next)))).toFixed(2);
    loi.counterTiPsf = Math.round((askTi + loi.tiPsf) / 2);
    loi.rentPsf = loi.counterRentPsf;
    loi.tiPsf = loi.counterTiPsf;
    reply("countered", loi.counterRentPsf, loi.counterTiPsf);
    next.news.unshift({ q: next.month, kind: "info", text: `${loi.name} countered at ${rec.address}: you asked $${askRent.toFixed(2)}/sf, they came back at $${loi.counterRentPsf.toFixed(2)}/sf with $${loi.counterTiPsf}/sf of TI. Final answer — take it or lose them.` });
    return { s: next, msg: `${loi.name} came back at $${loi.counterRentPsf.toFixed(2)}/sf — final.` };
  }

  next.lois = next.lois.filter((l) => l.id !== id);
  return { s: next, msg: "Passed." };
}

// --------------------------------------------------------------- vacant possession
/**
 * BUYING A BUILDING EMPTY.
 *
 * There is no legal way to knock down an occupied building, and waiting out a
 * rent roll takes a decade. So you buy the leases: every sitting tenant is
 * offered the whole remaining value of their contract, plus a quarter again on
 * top for the inconvenience of moving a business they did not want to move.
 *
 * The premium is what makes this a decision rather than a button. A building
 * full of leases with eight years to run costs a fortune to empty, which is
 * precisely why the site under a well-let building is worth less than the site
 * under a half-empty one — and why the buildings that get redeveloped in real
 * cities are the ones whose leases were about to roll anyway.
 */
export const BUYOUT_PREMIUM = 1.25;

export function buyoutQuote(s: GameState, bbl: string): {
  cost: number; tenants: number; sf: number; deposits: number;
  rows: { name: string; monthsLeft: number; annual: number; cost: number }[];
} | null {
  const h = s.holdings[bbl];
  if (!h) return null;
  const rows = h.tenants.map((t) => {
    const monthsLeft = Math.max(0, t.endM - s.month);
    const annual = t.rentPsf * t.sf;
    return { name: t.name, monthsLeft, annual, cost: Math.round((annual / 12) * monthsLeft * BUYOUT_PREMIUM) };
  });
  return {
    cost: rows.reduce((a, r) => a + r.cost, 0),
    tenants: h.tenants.length,
    sf: h.tenants.reduce((a, t) => a + t.sf, 0),
    deposits: h.tenants.reduce((a, t) => a + (t.deposit ?? 0), 0),
    rows,
  };
}

export function buyOutTenants(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  const h0 = s.holdings[bbl];
  if (!h0) return { s, err: "You don't own that." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const q = buyoutQuote(s, bbl);
  if (!q || (!q.tenants && !(h0.occ ?? 0))) return { s, err: "Nobody to buy out — it is already empty." };
  // Flats run on aggregate occupancy rather than named leases, so the cost of
  // clearing them is a year of the residential income at the same premium.
  const resSf = useSf(rec, "multifamily") * (h0.occ ?? 0);
  const resCost = Math.round(resSf * useRentPsfYr(rec, s.econ, h0.condition, "multifamily") * BUYOUT_PREMIUM);
  const total = q.cost + resCost;
  if (total <= 0) return { s, err: "Nobody to buy out — it is already empty." };
  if (s.cash < total) {
    return { s, err: `Clearing the building costs ${money(total)} — you're short ${money(total - s.cash)}.` };
  }
  const next: GameState = JSON.parse(JSON.stringify(s));
  const h = next.holdings[bbl]!;
  next.cash -= total;
  // The deposits go back with them; they were never yours.
  next.cash -= q.deposits;
  logBooks(next, "leasing", total);
  const n = h.tenants.length;
  const sf = q.sf + Math.round(resSf);
  h.tenants = [];
  h.occ = 0;
  h.makeReady = [];
  // Nobody is being let in behind them, or the whole exercise is pointless.
  h.leasingHold = true;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Bought out every lease at ${rec.address}: ${n} tenant${n === 1 ? "" : "s"} and `
      + `${(sf / 1000).toFixed(1)}k sf for ${money(total)}, at ${((BUYOUT_PREMIUM - 1) * 100).toFixed(0)}% over the remaining contracts. `
      + `The building is empty and letting is stopped — it is a site now.`,
  });
  return { s: next, msg: `Empty. ${money(total)} to clear it.` };
}

/** Stop or restart letting a building — the switch you throw before a demolition. */
export function setLeasingHold(s: GameState, bbl: string, on: boolean): GameState {
  const h = s.holdings[bbl];
  if (!h) return s;
  const next: GameState = JSON.parse(JSON.stringify(s));
  next.holdings[bbl].leasingHold = on || undefined;
  if (on) next.lois = next.lois.filter((l) => l.bbl !== bbl);
  return next;
}
