// Valuation: honest economics, legible causality. Value = NOI ÷ cap rate;
// land = lot area × evolved land $/sf. Every number here is traceable from
// the parcel record and the market state — no hidden multipliers.
import type { ParcelRecord } from "@/data/types";
import type { Condition, Econ, GameState, Holding } from "./types";
import type { BuiltClass } from "./types";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// How hard a parcel's land value rides the cycle: prime demand swings harder.
export function demandBeta(demandScore: number): number {
  return 0.25 + 0.9 * (demandScore / 100);
}

export function landPsfNow(rec: ParcelRecord, econ: Econ): number {
  return rec.landPsf * econ.landIdx * (1 + 0.22 * demandBeta(rec.demandScore) * econ.cycleDev);
}

export function landValue(rec: ParcelRecord, econ: Econ): number {
  return rec.lotArea * landPsfNow(rec, econ);
}

export const CONDITION_RENT_MULT: Record<Condition, number> = {
  worn: 0.82, standard: 1.0, good: 1.2,
};

// A condition that isn't one of the three silently produced NaN rent, which
// then propagated through NOI, value, DSCR and the lender's sizing without a
// single error. Numbers that quietly become NaN are worse than numbers that
// throw, so this collapses to the honest middle instead.
function condMult(c: Condition): number {
  return CONDITION_RENT_MULT[c] ?? 1.0;
}

export function initialCondition(rec: ParcelRecord): Condition {
  if (rec.yearBuilt >= 2000) return "good";
  if (rec.yearBuilt >= 1965) return "standard";
  return "worn";
}

// Location multiplier on citywide class rent: demand is the location.
export function locationRentMult(rec: ParcelRecord): number {
  return 0.62 + 0.76 * (rec.demandScore / 100);
}

export function marketRentPsfYr(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  if (rec.class === "land") return 0;
  const cls = rec.class as BuiltClass;
  return econ.rentIdx[cls] * locationRentMult(rec) * condMult(condition);
}

// A delivered development overrides the static record — resolve before use.
export function resolveRec(parcels: Record<string, ParcelRecord>, s: GameState, bbl: string): ParcelRecord | null {
  const rec = parcels[bbl];
  if (!rec) return null;
  const b = s.built?.[bbl];
  const adj = s.landAdj?.[bbl];
  if (!b && !adj) return rec;
  const out = { ...rec };
  if (adj) out.landPsf = rec.landPsf * adj;
  if (b) { out.class = b.class; out.bldgArea = b.bldgArea; out.floors = b.floors; out.yearBuilt = b.yearBuilt; }
  return out;
}

// Achievable rent for NEW leases in a managed building: capital programs and
// the owner's rent stance move it off the pure market number.
export function managedRentPsfYr(rec: ParcelRecord, econ: Econ, h: Holding): number {
  let m = marketRentPsfYr(rec, econ, h.condition);
  const done = h.programsDone ?? {};
  if (done.lobby !== undefined) m *= 1.04;
  if (done.facade !== undefined) m *= 1.08;
  m *= 1 + 0.08 * (h.stance ?? 0);
  return m;
}

// Phase 2 occupancy model: class norms breathing with the cycle and demand.
// Named tenants, LOIs, and rollover arrive in Phase 3.
const OCC_BASE: Record<BuiltClass, number> = { office: 0.87, retail: 0.91, mixed: 0.89, multifamily: 0.955, industrial: 0.9 };
export function occupancy(rec: ParcelRecord, econ: Econ): number {
  const cls = rec.class as BuiltClass;
  const swing = cls === "multifamily" ? 0.02 : 0.05;
  return clamp(OCC_BASE[cls] + swing * econ.cycleDev + 0.03 * (rec.demandScore / 100 - 0.5), 0.6, 0.99);
}

const OPEX_RATIO: Record<BuiltClass, number> = { office: 0.38, retail: 0.30, mixed: 0.36, multifamily: 0.42, industrial: 0.24 };

// ---------------------------------------------------------------- the opex stack
// A single blended $/sf hides the two things that actually matter: which line
// items a tenant reimburses, and which ones the owner can do anything about.
// Split them, because the split is what a recovery clause is written against.
//
//   controllable — R&M, utilities, cleaning, admin. Systems capex bites here.
//   fixed        — insurance and the like. Property tax is separate; it has
//                  its own assessment and its own reimbursement treatment.
//
// $/sf/yr at costIdx 1.
export const OPEX_CONTROLLABLE: Record<BuiltClass, number> = { office: 9.2, retail: 5.4, mixed: 7.6, multifamily: 7.1, industrial: 2.3 };
export const OPEX_FIXED: Record<BuiltClass, number> = { office: 3.8, retail: 2.6, mixed: 3.4, multifamily: 2.9, industrial: 1.2 };
export const MGMT_FEE = 0.04;   // of effective gross income, industry standard

/** Total operating cost per sf/yr before management fee and property tax. */
export function opexPsf(cls: BuiltClass, econ: Econ, systemsDone: boolean): number {
  return (OPEX_CONTROLLABLE[cls] * (systemsDone ? 0.82 : 1) + OPEX_FIXED[cls]) * econ.costIdx;
}

// Kept for compatibility with anything still asking the old question.
export const OPEX_PSF: Record<BuiltClass, number> = { office: 13, retail: 8, mixed: 11, multifamily: 10, industrial: 3.5 };

/**
 * How a lease reimburses operating cost. This is the difference between an
 * office building that keeps its margin through an inflation decade and one
 * that quietly gives it all back.
 *
 *   nnn   — tenant pays its pro-rata share of opex AND taxes. Owner is flat.
 *   base  — base-year stop. The tenant reimburses only the growth in expenses
 *           above the level in the year it signed. Signed cheap in a cheap
 *           year and you carry that gap for the whole term; sign in an
 *           expensive year and the stop protects you.
 *   gross — the owner eats everything. Priced into the rent, in theory.
 */
export type Recovery = "nnn" | "base" | "gross";

export function recoveryOf(t: { recovery?: Recovery; net?: boolean }): Recovery {
  return t.recovery ?? (t.net ? "nnn" : "gross");
}

/**
 * What a tenant actually reimburses this year, in dollars, for opex and for
 * property tax. `baseStopPsf` is the expense level frozen at signing.
 */
export function recoveryFor(
  t: { sf: number; recovery?: Recovery; net?: boolean; baseStopPsf?: number },
  opexNowPsf: number,
  taxNowPsf: number,
): { opex: number; tax: number } {
  const kind = recoveryOf(t);
  if (kind === "nnn") return { opex: t.sf * opexNowPsf, tax: t.sf * taxNowPsf };
  if (kind === "gross") return { opex: 0, tax: 0 };
  const stop = t.baseStopPsf ?? opexNowPsf + taxNowPsf;
  const overage = Math.max(0, opexNowPsf + taxNowPsf - stop);
  // a base-year stop recovers the growth, not the base — and it recovers it
  // against the combined bill, which is how the clause is actually written
  const total = overage * t.sf;
  const share = opexNowPsf + taxNowPsf > 0 ? opexNowPsf / (opexNowPsf + taxNowPsf) : 1;
  return { opex: total * share, tax: total * (1 - share) };
}

// Property tax: ~1.1% of assessed value a year. On net leases the tenant
// reimburses it; the landlord eats the share on vacant space and gross leases.
export const TAX_RATE = 0.011;

// Cap rates aren't one number per class: a trophy on the square trades tighter
// than a tired walk-up on the edge of town. Demand is location; condition is
// quality. Spread runs roughly ±0.6 points around the citywide class cap.
export function capRateFor(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  const cls = rec.class as BuiltClass;
  const base = econ.capRate[cls] ?? 6;
  const locSpread = -((rec.demandScore - 50) / 100) * 0.8;
  const qualSpread = condition === "good" ? -0.22 : condition === "worn" ? 0.35 : 0;
  return clamp(base + locSpread + qualSpread, 2.8, 12);
}

// Appraisals are opinions. Each parcel's appraisal carries a stable bias off
// true value, and the honest range around it is about ±6%. Offers and lender
// sizing run off true value — the band is what YOU get to see.
export function appraise(bbl: string, value: number): { lo: number; mid: number; hi: number } {
  let hsh = 2166136261;
  for (let i = 0; i < bbl.length; i++) { hsh ^= bbl.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
  const bias = (((hsh >>> 8) % 1000) / 1000 - 0.5) * 0.07; // ±3.5%, fixed per parcel
  const mid = value * (1 + bias);
  return { lo: mid * 0.94, mid, hi: mid * 1.06 };
}

// market-implied NOI before property tax (unowned parcels; also the
// stabilized case for owned). Tax is capitalized in assetValue.
export function noiYr(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  if (rec.class === "land" || !rec.bldgArea) {
    // carry: taxes and insurance bleed on idle land
    return -landValue(rec, econ) * 0.012;
  }
  const cls = rec.class as BuiltClass;
  const gross = rec.bldgArea * marketRentPsfYr(rec, econ, condition) * occupancy(rec, econ);
  // opex share drifts up as cost inflation outpaces the rent share it eats
  const ratio = Math.min(0.6, OPEX_RATIO[cls] * Math.pow(econ.costIdx / (econ.rentIdx[cls] / (cls === "office" ? 62 : cls === "retail" ? 88 : cls === "mixed" ? 58 : cls === "multifamily" ? 46 : 16)), 0.5));
  return gross * (1 - ratio);
}

/**
 * NET OPERATING INCOME, the way the industry defines it: after real estate
 * taxes. `noiYr` above deliberately stops short of them, because valuation
 * capitalises pre-tax income at a tax-loaded cap rate — algebraically the same
 * answer, and it avoids the circularity of taxing a value you have not
 * computed yet. But that number must never reach a player or a lender.
 *
 * It was reaching both. The tape, the acquisition panel and the loan desk were
 * all quoting income that ignored a bill running about 1.1% of value a year,
 * so every building looked roughly 110 basis points better than it was, every
 * loan was sized against income the building would never earn, and NOI fell
 * the moment you closed — because owned assets were computed correctly and
 * unowned ones were not.
 */
export function noiAfterTaxYr(rec: ParcelRecord, econ: Econ, condition: Condition, price: number): number {
  if (rec.class === "land" || !rec.bldgArea) return noiYr(rec, econ, condition);
  return noiYr(rec, econ, condition) - price * TAX_RATE;
}

// The landlord's share of the property-tax bill: net leases reimburse it,
// so you pay on the vacant + gross-leased fraction of the building.
/** The gross property-tax bill, before anyone reimburses anything. */
export function grossTaxYr(rec: ParcelRecord, h: Holding): number {
  const assessed = h.assessed ?? h.costBasis;
  if (rec.class === "land" || !rec.bldgArea) return 0; // land carry already covers it
  return assessed * TAX_RATE;
}

/**
 * The landlord's net share of the tax bill after recoveries. NNN tenants pay
 * their pro-rata share in full; base-year tenants pay only the growth above
 * their stop; gross tenants and vacant space are the owner's problem.
 */
export function propertyTaxYr(rec: ParcelRecord, h: Holding, econ?: Econ): number {
  const bill = grossTaxYr(rec, h);
  if (!bill) return 0;
  if (rec.class === "multifamily") return bill;   // residential leases are gross
  const taxPsf = bill / Math.max(1, rec.bldgArea);
  const opexNowPsf = econ ? opexPsf(rec.class as BuiltClass, econ, h.programsDone?.systems !== undefined) : taxPsf;
  let recovered = 0;
  for (const t of h.tenants) recovered += recoveryFor(t, opexNowPsf, taxPsf).tax;
  return Math.max(0, bill - recovered);
}

// in-place NOI from the actual rent roll (owned assets, Phase 3 onward)
export function holdingNOIYr(rec: ParcelRecord, econ: Econ, h: Holding, currentQ: number): number {
  if (h.renovatingUntilM !== undefined && currentQ < h.renovatingUntilM) {
    return -Math.max(0, rec.bldgArea) * 1.2; // dark during the gut
  }
  if (rec.class === "land" || !rec.bldgArea) return -landValue(rec, econ) * 0.012;
  const cls = rec.class as BuiltClass;
  if (cls === "multifamily") {
    // units turn over and things break: a 7% reserve off collections for
    // turns, appliances, roofs. Appraisers skip it; owners never get to.
    const occ = h.occ ?? occupancy(rec, econ);
    const egi = rec.bldgArea * marketRentPsfYr(rec, econ, h.condition) * occ;
    return egi * 0.93 - rec.bldgArea * OPEX_PSF[cls] * econ.costIdx - propertyTaxYr(rec, h);
  }
  // Rent first, then the expense stack, then what comes back through the
  // recovery clauses. Vacant space reimburses nothing and still costs money —
  // that gap is the whole reason occupancy matters more than headline rent.
  const systemsDone = h.programsDone?.systems !== undefined;
  const opexNowPsf = opexPsf(cls, econ, systemsDone);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);

  let baseRent = 0, leasedSf = 0, recoveredOpex = 0, recoveredTax = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    // Recoveries keep running through a free-rent period — free rent is a
    // concession on BASE rent, not on the tenant's share of the boiler.
    const r = recoveryFor(t, opexNowPsf, taxNowPsf);
    recoveredOpex += r.opex;
    recoveredTax += r.tax;
    if (t.freeUntilM !== undefined && currentQ < t.freeUntilM) continue;
    baseRent += t.rentPsf * t.sf;
  }
  const egi = baseRent + recoveredOpex + recoveredTax;
  const opexBill = opexNowPsf * rec.bldgArea;                 // the owner pays it all, then bills it out
  const mgmt = egi * MGMT_FEE;
  return egi - opexBill - mgmt - taxBill;
}

/**
 * The operating statement, line by line, the way it would be presented in an
 * offering memorandum. The number that matters and never gets shown anywhere
 * is `leakage` — the share of the expense bill that no lease reimburses. On a
 * building full of triple-net paper it is nearly nothing; on a gross-leased
 * building in year twelve of an inflation run it is the whole margin.
 */
export function operatingStatement(rec: ParcelRecord, econ: Econ, h: Holding, month: number) {
  const cls = rec.class as BuiltClass;
  const systemsDone = h.programsDone?.systems !== undefined;
  const opexNowPsf = opexPsf(cls, econ, systemsDone);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);
  let baseRent = 0, leasedSf = 0, recOpex = 0, recTax = 0, free = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    const r = recoveryFor(t, opexNowPsf, taxNowPsf);
    recOpex += r.opex; recTax += r.tax;
    if (t.freeUntilM !== undefined && month < t.freeUntilM) { free += t.rentPsf * t.sf; continue; }
    baseRent += t.rentPsf * t.sf;
  }
  const opexBill = opexNowPsf * rec.bldgArea;
  const egi = baseRent + recOpex + recTax;
  const mgmt = egi * MGMT_FEE;
  const noi = egi - opexBill - mgmt - taxBill;
  const billed = opexBill + taxBill;
  return {
    baseRent, freeRent: free, recoveredOpex: recOpex, recoveredTax: recTax, egi,
    opex: opexBill, mgmt, tax: taxBill, noi,
    leasedSf, vacantSf: Math.max(0, rec.bldgArea - leasedSf),
    // what you pay and never bill back, as a share of the whole expense stack
    leakage: billed > 0 ? Math.max(0, billed - recOpex - recTax) / billed : 0,
    opexPsf: opexNowPsf, taxPsf: taxNowPsf,
  };
}

export function assetValue(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  const land = landValue(rec, econ);
  if (rec.class === "land" || !rec.bldgArea) return land;
  // pre-tax NOI capitalized at cap + tax rate — the buyer prices in the bill
  const income = noiYr(rec, econ, condition) / (capRateFor(rec, econ, condition) / 100 + TAX_RATE);
  // an underbuilt lot is worth the greater of its income or its dirt
  return Math.max(income, land * 0.92);
}

// owned assets appraise on a blend of in-place income and stabilized market —
// an empty building isn't worthless, but it isn't stabilized either
/**
 * What a BUYER pays for this specific rent roll, expressed as a spread to the
 * class cap. Two buildings with identical NOI are not worth the same money:
 * one let to investment-grade covenants on ten-year paper is bond-like, and
 * one rolling forty per cent of its income next year is a leasing project. The
 * market prices that difference in basis points, and so should this.
 */
export function rollQualitySpread(rec: ParcelRecord, h: Holding, month: number): number {
  if (rec.class === "land" || !rec.bldgArea || !h.tenants.length) return 0.55;   // an empty building is a project
  let sfTot = 0, wCredit = 0, wYears = 0, nnnSf = 0;
  for (const t of h.tenants) {
    sfTot += t.sf;
    wCredit += t.credit * t.sf;
    wYears += Math.max(0, (t.endM - month) / 12) * t.sf;
    if (recoveryOf(t) === "nnn") nnnSf += t.sf;
  }
  if (!sfTot) return 0.55;
  const occ = sfTot / rec.bldgArea;
  const walt = wYears / sfTot;
  const credit = wCredit / sfTot;                       // 0..2
  // long paper and good covenants compress the cap; short paper widens it
  const waltSpread = clamp(0.45 - 0.11 * walt, -0.30, 0.55);
  const creditSpread = 0.18 - 0.20 * credit;            // +0.18 unrated, −0.22 investment grade
  const occSpread = clamp((0.9 - occ) * 1.4, -0.10, 0.75);
  const structSpread = -0.10 * (nnnSf / sfTot);         // net paper is easier to finance
  return waltSpread + creditSpread + occSpread + structSpread;
}

export function holdingValue(rec: ParcelRecord, econ: Econ, h: Holding, month?: number): number {
  if (rec.class === "land" || !rec.bldgArea) return landValue(rec, econ);
  const quality = month === undefined ? 0 : rollQualitySpread(rec, h, month);
  const cap = clamp(capRateFor(rec, econ, h.condition) + quality, 2.8, 13) / 100;
  const inPlace = holdingNOIYr(rec, econ, h, h.renovatingUntilM ?? -1) / cap; // after-tax NOI, plain cap
  const stabilized = noiYr(rec, econ, h.condition) / (cap + TAX_RATE);       // pre-tax NOI, tax-loaded cap
  return Math.max(landValue(rec, econ) * 0.92, inPlace * 0.55 + stabilized * 0.45);
}

export function monthlyNOI(rec: ParcelRecord, econ: Econ, h: Holding, currentQ: number): number {
  return holdingNOIYr(rec, econ, h, currentQ) / 12;
}

export const RENO_COST_PSF: Record<BuiltClass, number> = { office: 210, retail: 150, mixed: 190, multifamily: 165, industrial: 90 };
export const RENO_MONTHS = 6;

export function renovationCost(rec: ParcelRecord, econ: Econ): number {
  if (rec.class === "land" || !rec.bldgArea) return 0;
  return Math.round(rec.bldgArea * RENO_COST_PSF[rec.class as BuiltClass] * econ.costIdx);
}

export function netWorth(s: GameState, parcels: Record<string, ParcelRecord>): number {
  let nw = s.cash;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    nw += holdingValue(rec, s.econ, h, s.month) - (h.loan?.balance ?? 0);
  }
  // construction in progress carries at cost minus construction debt
  for (const d of Object.values(s.developments ?? {})) {
    nw += d.costTotal - d.loanBalance;
  }
  nw -= s.loc?.balance ?? 0;   // the line is real money owed
  return nw;
}
