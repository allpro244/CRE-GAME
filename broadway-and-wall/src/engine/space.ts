// THE SPACE MARKET, READ OFF THE CITY.
//
// The macro sim in market.ts moves four citywide numbers per class — stock,
// occupied, vacancy, absorption. That is the engine. This file is the part a
// player can act on, and it exists because "citywide office vacancy is 12%" is
// not a decision. "Office in the Exchange is at 6% and Millside is at 21%, and
// nine hundred thousand feet deliver into the Exchange in the next two years"
// is a decision.
//
// Everything here is DERIVED — no new state, no new save fields. Submarkets
// are computed by walking the actual parcels with the same occupancy and rent
// functions the engine prices off, so the page can never disagree with the
// simulation. The forward projection runs the same absorption arithmetic the
// tick does, just with no new starts, which is exactly the honest question:
// if nothing else breaks ground, where does this land?
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState } from "./types";
import { BUILT_CLASSES } from "./types";
import { openingVac, CITY_STOCK } from "./market";
import { resolveRec, useOccupancy, useRentPsfYr, initialCondition, useRentableSf } from "./value";
import { uses, districtLabel } from "./mix";

export interface SubmarketLeg {
  sf: number;         // inventory standing in this district, this class
  occSf: number;      // square feet with somebody in them
  rentSum: number;    // sf-weighted rent, pre-divide
  demandSum: number;  // sf-weighted demand score, pre-divide
  lots: number;
}
export interface Submarket {
  district: string;
  /** what the district is called; the key above is what it is filed under */
  name: string;
  legs: Record<BuiltClass, SubmarketLeg>;
  totalSf: number;
  vacantLots: number;
  landSf: number;     // developable dirt sitting in this district
}

const emptyLeg = (): SubmarketLeg => ({ sf: 0, occSf: 0, rentSum: 0, demandSum: 0, lots: 0 });
const emptyLegs = (): Record<BuiltClass, SubmarketLeg> => ({
  office: emptyLeg(), retail: emptyLeg(), multifamily: emptyLeg(), industrial: emptyLeg(),
});

/**
 * Every district's inventory, occupancy, rent and demand, class by class.
 *
 * O(parcels) — about 1,600 records, so it is cheap enough to compute on
 * render and always current, which matters more than caching would.
 */
export function submarkets(s: GameState, parcels: ParcelTable, bbls: string[]): Submarket[] {
  const by = new Map<string, Submarket>();
  for (const bbl of bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const d = rec.district || "—";
    let m = by.get(d);
    if (!m) { m = { district: d, name: districtLabel(rec), legs: emptyLegs(), totalSf: 0, vacantLots: 0, landSf: 0 }; by.set(d, m); }
    if (rec.class === "land" || !rec.bldgArea) {
      m.vacantLots++;
      m.landSf += rec.lotArea;
      continue;
    }
    const cond = initialCondition(rec);
    for (const u of uses(rec)) {
      const sf = useRentableSf(rec, u);
      if (sf <= 0) continue;
      const leg = m.legs[u];
      leg.sf += sf;
      leg.occSf += sf * useOccupancy(rec, s.econ, u);
      leg.rentSum += sf * useRentPsfYr(rec, s.econ, cond, u);
      leg.demandSum += sf * rec.demandScore;
      leg.lots++;
      m.totalSf += sf;
    }
  }
  return [...by.values()].sort((a, b) => b.totalSf - a.totalSf);
}

export const legVacancy = (l: SubmarketLeg) => (l.sf > 0 ? 1 - l.occSf / l.sf : 0);
export const legRent = (l: SubmarketLeg) => (l.sf > 0 ? l.rentSum / l.sf : 0);
export const legDemand = (l: SubmarketLeg) => (l.sf > 0 ? l.demandSum / l.sf : 0);

/**
 * What is under construction and when it lands, bucketed into forward years.
 * `years[0]` is the next twelve months.
 */
export function deliverySchedule(e: Econ, month: number, years = 4): Record<BuiltClass, number[]> {
  const out = {} as Record<BuiltClass, number[]>;
  for (const k of BUILT_CLASSES) {
    const buckets = new Array(years).fill(0);
    for (const c of e.cohorts?.[k] ?? []) {
      const yr = Math.floor((c.m - month) / 12);
      if (yr >= 0 && yr < years) buckets[yr] += c.sf;
      else if (yr < 0) buckets[0] += c.sf;   // overdue: it is arriving now
    }
    out[k] = buckets;
  }
  return out;
}

/**
 * WHERE THIS LANDS IF NOBODY ELSE BREAKS GROUND.
 *
 * Roll the pipeline forward month by month, adding each cohort to stock as it
 * delivers, and letting occupancy grow at the trailing absorption rate. It is
 * deliberately naive about new starts — that is the point. The gap between
 * this line and the natural rate is the argument for or against building.
 */
export function projectVacancy(e: Econ, k: BuiltClass, month: number, months = 36): number[] {
  let stock = e.stock?.[k] ?? CITY_STOCK[k];
  // Standing sublet space is space to be absorbed like any other, so the line
  // starts from availability. It is assumed to drain into the same absorption
  // — which is the honest naive projection, because whether it comes back off
  // the market or gets taken by a subtenant, it is a foot that has to be filled
  // before a new building's first floor is.
  let occ = (e.occupied?.[k] ?? stock * (1 - openingVac(k))) - (e.sublet?.[k] ?? 0);
  // absorption decays toward zero over the horizon: assuming today's pace runs
  // forever is how every over-optimistic pro forma in the business is written
  const base = (e.absorb12?.[k] ?? 0) / 12;
  const cohorts = (e.cohorts?.[k] ?? []).map((c) => ({ ...c }));
  const path: number[] = [];
  for (let i = 1; i <= months; i++) {
    const m = month + i;
    for (const c of cohorts) {
      if (c.m === m || (i === 1 && c.m < m)) { stock += c.sf; c.sf = 0; }
    }
    occ = Math.min(stock * 0.995, occ + base * Math.exp(-i / 30));
    path.push(Math.max(0.004, 1 - occ / Math.max(1, stock)));
  }
  return path;
}

export type Balance = "acute shortage" | "landlord's market" | "balanced" | "tenant's market" | "glut";

/**
 * WHAT A TENANT CAN ACTUALLY GO AND LEASE, as a share of the stock — direct
 * vacancy plus everything sitting on the sublet market. This is the number a
 * broker quotes, and it is not the vacancy rate: in a bad office market a quarter of what is
 * available is somebody else's lease, and the two figures come apart by ten
 * points at exactly the moment a player most needs to know which is which.
 */
export function availability(e: Econ, k: BuiltClass): number {
  const stock = e.stock?.[k] ?? CITY_STOCK[k];
  return (e.cityVac?.[k] ?? openingVac(k)) + (e.sublet?.[k] ?? 0) / Math.max(1, stock);
}

/**
 * THE PACKAGE: the share of face the leases signing now give away in free
 * rent and allowances, 1 − effective / asking, off the town's own comps. What
 * a tenant can extract is the market's own price of slack; no vacancy norm
 * stands behind it.
 */
export function packageOf(e: Econ, k: BuiltClass): number {
  const face = e.rentIdx?.[k] ?? 0, eff = e.effRentIdx?.[k] ?? face;
  return face > 0 ? Math.max(0, 1 - eff / face) : 0;
}

/** Availability now less availability twelve months ago (0 before a year of record). */
export function availYoy(e: Econ, k: BuiltClass): number {
  const h = e.history ?? [];
  const then = h.length >= 13 ? h[h.length - 13]?.avail?.[k] : undefined;
  return then === undefined ? 0 : availability(e, k) - then;
}

/**
 * The one-word verdict, and the sentence behind it — read off what the market
 * is doing, never off a "normal" vacancy (there is none, 2026-11-08): the
 * package the leases give away (`packageOf`) and which way availability has
 * moved over twelve months (`availYoy`). The bands are display words for a
 * package size, stated in the trade's own unit — months of free rent on a
 * ten-year lease: under ~2½ months (0.02) landlords give little away, 7
 * months (0.06) is a working package, 14 months and up (0.12) is a glut's
 * (US gateway free rent ran 10-17 months through 2020-24; CBRE / JLL
 * concession surveys). Availability moving a point either way over a year
 * tips the middle band.
 */
export function marketBalance(e: Econ, k: BuiltClass): { state: Balance; soft: boolean; pkg: number; availCh: number; note: string } {
  const pkg = packageOf(e, k), availCh = availYoy(e, k);
  const state: Balance =
    pkg < 0.02 ? (availCh < 0 ? "acute shortage" : "landlord's market") :
    pkg < 0.06 ? (availCh < -0.01 ? "landlord's market" : availCh > 0.01 ? "tenant's market" : "balanced") :
    // A GLUT IS EXCESS SPACE, not a big package alone (2026-11-12): office
    // leases carry a fit-out allowance in a balanced market, and the opening's
    // office read "glut" at 3.3% vacancy on its package. A glut needs the heavy
    // package and space that is not getting scarcer over a year of record.
    pkg < 0.12 || !((e.history?.length ?? 0) >= 13 && availCh >= 0) ? "tenant's market" : "glut";
  const note =
    state === "acute shortage" ? "Leases give almost nothing away and space keeps getting scarcer. Rents run and every site pencils — which is precisely when the next glut gets started."
    : state === "landlord's market" ? "Landlords are giving little away. You can push rents and hold back on concessions; a new building here has a market waiting for it."
    : state === "balanced" ? "Neither side has the whip hand. Rents track inflation and a development has to earn its spread the hard way."
    : state === "tenant's market" ? "Tenants have choices. Expect concessions, longer voids and slower lease-up; a spec building is a bet on a turn."
    : "Too much space chasing too few tenants. Face rents hold and then break; nothing should break ground until the excess is absorbed.";
  return { state, soft: state === "tenant's market" || state === "glut", pkg, availCh, note };
}

/**
 * Months of standing vacant space at the current pace of absorption, plus the
 * pipeline. The single most quoted number in a real market report, and the one
 * that tells you whether a glut is a year of pain or a decade of it.
 */
export function monthsOfSupply(e: Econ, k: BuiltClass): number | null {
  const stock = e.stock?.[k] ?? CITY_STOCK[k];
  // Availability, not vacancy: a sublease is space your building is competing
  // with, and leaving it out is how a market report tells a landlord the glut
  // is half the size it is.
  const vacantSf = stock * availability(e, k);
  const pipe = e.pipeline?.[k] ?? 0;
  const pace = (e.absorb12?.[k] ?? 0) / 12;
  if (pace <= 0) return null;      // space is coming BACK, not being taken
  return (vacantSf + pipe) / pace;
}
