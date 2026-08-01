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
  return econ.rentIdx[cls] * locationRentMult(rec) * CONDITION_RENT_MULT[condition];
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
// landlord operating cost per sf/yr — paid on vacant space and gross leases
export const OPEX_PSF: Record<BuiltClass, number> = { office: 13, retail: 8, mixed: 11, multifamily: 10, industrial: 3.5 };

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

// The landlord's share of the property-tax bill: net leases reimburse it,
// so you pay on the vacant + gross-leased fraction of the building.
export function propertyTaxYr(rec: ParcelRecord, h: Holding): number {
  const assessed = h.assessed ?? h.costBasis;
  if (rec.class === "land" || !rec.bldgArea) return 0; // land carry already covers it
  if (rec.class === "multifamily") return assessed * TAX_RATE; // residential leases are gross
  const netSf = h.tenants.reduce((sum, t) => sum + (t.net ? t.sf : 0), 0);
  const landlordShare = 1 - Math.min(1, netSf / rec.bldgArea);
  return assessed * TAX_RATE * landlordShare;
}

// in-place NOI from the actual rent roll (owned assets, Phase 3 onward)
export function holdingNOIYr(rec: ParcelRecord, econ: Econ, h: Holding, currentQ: number): number {
  if (h.renovatingUntilM !== undefined && currentQ < h.renovatingUntilM) {
    return -Math.max(0, rec.bldgArea) * 1.2; // dark during the gut
  }
  if (rec.class === "land" || !rec.bldgArea) return -landValue(rec, econ) * 0.012;
  const cls = rec.class as BuiltClass;
  if (cls === "multifamily") {
    const occ = h.occ ?? occupancy(rec, econ);
    return rec.bldgArea * (marketRentPsfYr(rec, econ, h.condition) * occ - OPEX_PSF[cls] * econ.costIdx) - propertyTaxYr(rec, h);
  }
  let egi = 0, grossLeasedSf = 0, leasedSf = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    if (t.freeUntilM !== undefined && currentQ < t.freeUntilM) continue; // free-rent burn-off
    egi += t.rentPsf * t.sf;
    if (!t.net) grossLeasedSf += t.sf; // gross leases: landlord absorbs opex
  }
  const vacant = Math.max(0, rec.bldgArea - leasedSf);
  const systems = h.programsDone?.systems !== undefined ? 0.85 : 1; // HVAC/systems program cuts opex
  const opex = OPEX_PSF[cls] * econ.costIdx * (vacant + grossLeasedSf) * systems + egi * 0.04;
  return egi - opex - propertyTaxYr(rec, h);
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
export function holdingValue(rec: ParcelRecord, econ: Econ, h: Holding): number {
  if (rec.class === "land" || !rec.bldgArea) return landValue(rec, econ);
  const cap = capRateFor(rec, econ, h.condition) / 100;
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
    nw += holdingValue(rec, s.econ, h) - (h.loan?.balance ?? 0);
  }
  // construction in progress carries at cost minus construction debt
  for (const d of Object.values(s.developments ?? {})) {
    nw += d.costTotal - d.loanBalance;
  }
  return nw;
}
