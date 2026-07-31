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

// Phase 2 occupancy model: class norms breathing with the cycle and demand.
// Named tenants, LOIs, and rollover arrive in Phase 3.
const OCC_BASE: Record<BuiltClass, number> = { office: 0.87, retail: 0.91, mixed: 0.89, multifamily: 0.955 };
export function occupancy(rec: ParcelRecord, econ: Econ): number {
  const cls = rec.class as BuiltClass;
  const swing = cls === "multifamily" ? 0.02 : 0.05;
  return clamp(OCC_BASE[cls] + swing * econ.cycleDev + 0.03 * (rec.demandScore / 100 - 0.5), 0.6, 0.99);
}

const OPEX_RATIO: Record<BuiltClass, number> = { office: 0.38, retail: 0.30, mixed: 0.36, multifamily: 0.42 };

export function noiYr(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  if (rec.class === "land" || !rec.bldgArea) {
    // carry: taxes and insurance bleed on idle land
    return -landValue(rec, econ) * 0.012;
  }
  const cls = rec.class as BuiltClass;
  const gross = rec.bldgArea * marketRentPsfYr(rec, econ, condition) * occupancy(rec, econ);
  return gross * (1 - OPEX_RATIO[cls]);
}

export function assetValue(rec: ParcelRecord, econ: Econ, condition: Condition): number {
  const land = landValue(rec, econ);
  if (rec.class === "land" || !rec.bldgArea) return land;
  const cls = rec.class as BuiltClass;
  const income = noiYr(rec, econ, condition) / (econ.capRate[cls] / 100);
  // an underbuilt lot is worth the greater of its income or its dirt
  return Math.max(income, land * 0.92);
}

export function holdingValue(rec: ParcelRecord, econ: Econ, h: Holding): number {
  return assetValue(rec, econ, h.condition);
}

export function quarterlyNOI(rec: ParcelRecord, econ: Econ, h: Holding, currentQ: number): number {
  // a building under renovation runs dark
  if (h.renovatingUntilQ !== undefined && currentQ < h.renovatingUntilQ) {
    return -Math.max(0, rec.bldgArea) * 1.2 / 4; // carry costs while dark, $/sf/yr
  }
  return noiYr(rec, econ, h.condition) / 4;
}

export const RENO_COST_PSF: Record<BuiltClass, number> = { office: 210, retail: 150, mixed: 190, multifamily: 165 };
export const RENO_QUARTERS = 2;

export function renovationCost(rec: ParcelRecord): number {
  if (rec.class === "land" || !rec.bldgArea) return 0;
  return rec.bldgArea * RENO_COST_PSF[rec.class as BuiltClass];
}

export function netWorth(s: GameState, parcels: Record<string, ParcelRecord>): number {
  let nw = s.cash;
  for (const h of Object.values(s.holdings)) {
    const rec = parcels[h.bbl];
    if (!rec) continue;
    nw += holdingValue(rec, s.econ, h) - (h.loan?.balance ?? 0);
  }
  return nw;
}
