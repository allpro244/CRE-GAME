// Ground-up development (Groundwork's core loop, simplified for v1) plus
// building management: capital programs and rent stance.
//
// Development: on an owned vacant lot, choose use and FAR up to the zoning
// max, pay hard+soft cost per sf, fund with a 60% interest-only construction
// loan, wait 4-6 quarters while the building rises on the map, then lease up
// from empty. A modest random cost/schedule overrun keeps it honest.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Development, GameState } from "./types";
import { quarterLabel } from "./types";
import { rng, rrange } from "./market";
import { resolveRec } from "./value";

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

// hard cost $/sf by use, before the height premium and soft costs
export const HARD_COST_PSF: Record<BuiltClass, number> = {
  office: 240, mixed: 225, multifamily: 205, retail: 185, industrial: 105,
};
const SOFT_COST = 0.18;        // design, legal, carry, contingency
const CONSTR_LTC = 0.6;        // construction loan, 60% of cost
const CONSTR_SPREAD = 2.4;     // over the index, interest-only

export interface DevPlan {
  use: BuiltClass;
  farFrac: number; // fraction of max allowed FAR
  sf: number;
  floors: number;
  costTotal: number;
  loanAmount: number;
  ratePct: number;
  equity: number;
  quarters: number;
}

export function planDevelopment(s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass, farFrac: number): DevPlan | null {
  const rec = parcels[bbl];
  if (!rec) return null;
  const farMax = use === "multifamily" ? (rec.farMaxRes || rec.farMaxComm) : (rec.farMaxComm || rec.farMaxRes);
  if (!farMax) return null;
  const sf = Math.round((rec.lotArea * farMax * farFrac) / 100) * 100;
  if (sf < 4000) return null;
  const coverage = 0.62;
  const floors = Math.max(1, Math.round(sf / (rec.lotArea * coverage)));
  const heightPrem = floors > 12 ? 1.15 : floors > 6 ? 1.06 : 1;
  const demo = rec.bldgArea > 0 ? Math.round(rec.bldgArea * 12) : 0; // teardown-class: clear it first
  const costTotal = Math.round(sf * HARD_COST_PSF[use] * heightPrem * (1 + SOFT_COST)) + demo;
  const loanAmount = Math.round(costTotal * CONSTR_LTC);
  const ratePct = +(s.econ.indexRate + CONSTR_SPREAD).toFixed(2);
  const quarters = Math.min(6, 4 + Math.floor(sf / 90_000));
  return { use, farFrac, sf, floors, costTotal, loanAmount, ratePct, equity: costTotal - loanAmount, quarters };
}

export function startDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass, farFrac: number,
): { s: GameState; err?: string } {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.holdings[bbl]) return { s, err: "Buy the dirt first." };
  if (rec.class !== "land") return { s, err: "There's already a real building here — only vacant and teardown-class lots are developable." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  const plan = planDevelopment(s, parcels, bbl, use, farFrac);
  if (!plan) return { s, err: "Zoning won't carry a project that small — try more FAR or a different use." };
  if (s.cash < plan.equity) return { s, err: `Ground-breaking needs $${(plan.equity / 1e6).toFixed(2)}M of equity — you're short.` };
  const next = clone(s);
  next.cash -= plan.equity;
  next.developments[bbl] = {
    bbl,
    use,
    sf: plan.sf,
    floors: plan.floors,
    costTotal: plan.costTotal,
    loanBalance: plan.loanAmount,
    ratePct: plan.ratePct,
    startQ: next.quarter,
    deliverQ: next.quarter + plan.quarters,
    overrunRolled: false,
  } satisfies Development;
  next.news.unshift({
    q: next.quarter, kind: "deal",
    text: `Ground broken at ${rec.address}: ${(plan.sf / 1000).toFixed(0)}k sf of ${use}, $${(plan.costTotal / 1e6).toFixed(1)}M budget, delivery ${quarterLabel(next.quarter + plan.quarters)}.`,
  });
  return { s: next };
}

// One quarter of construction across all projects: pay construction interest,
// roll the overrun die at midpoint, deliver finished buildings.
export function tickDevelopments(s: GameState, parcels: ParcelTable) {
  for (const d of Object.values(s.developments)) {
    const rec = parcels[d.bbl];
    if (!rec || !s.holdings[d.bbl]) { delete s.developments[d.bbl]; continue; }
    // construction interest, out of pocket
    s.cash -= Math.round((d.loanBalance * d.ratePct) / 100 / 4);

    const mid = Math.floor((d.startQ + d.deliverQ) / 2);
    if (!d.overrunRolled && s.quarter >= mid) {
      d.overrunRolled = true;
      if (rng(s) < 0.55) {
        const bump = rrange(s, 0.03, 0.15);
        const extra = Math.round(d.costTotal * bump);
        d.costTotal += extra;
        s.cash -= extra; // change orders are an equity check
        s.news.unshift({ q: s.quarter, kind: "warn", text: `Change orders at ${rec.address}: the budget grew $${(extra / 1e6).toFixed(2)}M (${(bump * 100).toFixed(0)}%).` });
      }
      if (rng(s) < 0.3) {
        d.deliverQ += 1;
        s.news.unshift({ q: s.quarter, kind: "warn", text: `Schedule slip at ${rec.address} — delivery moves to ${quarterLabel(d.deliverQ)}.` });
      }
    }

    if (s.quarter >= d.deliverQ) {
      // delivery: the override becomes the building; the construction loan
      // converts to a lease-up mini-perm (IO 4 quarters, 4-year balloon)
      s.built[d.bbl] = { class: d.use, bldgArea: d.sf, floors: d.floors, yearBuilt: 2026 + Math.floor(s.quarter / 4) };
      const h = s.holdings[d.bbl];
      h.condition = "good";
      h.tenants = [];
      if (d.use === "multifamily") h.occ = 0.1;
      h.costBasis += d.costTotal;
      h.loan = {
        product: "float",
        principal: d.loanBalance,
        balance: d.loanBalance,
        ratePct: +(s.econ.indexRate + 1.9).toFixed(2),
        spread: 1.9,
        ioUntilQ: s.quarter + 4,
        amortYears: 30,
        maturityQ: s.quarter + 16,
        quarterlyPmt: Math.round((d.loanBalance * (s.econ.indexRate + 1.9)) / 100 / 4),
        minDSCR: 1.05, // lease-up paper is forgiving, briefly
        maxLTV: 0.9,
        sweep: false,
        cleanQs: 0,
        originQ: s.quarter,
      };
      delete s.developments[d.bbl];
      s.news.unshift({ q: s.quarter, kind: "deal", text: `Delivered: ${(d.sf / 1000).toFixed(0)}k sf of ${d.use} at ${rec.address}. Now fill it.` });
    }
  }
}

// ---- building management ---------------------------------------------------
export interface CapProgram {
  id: string;
  label: string;
  costPsf: number;
  quarters: number;
  blurb: string;
}
export const PROGRAMS: CapProgram[] = [
  { id: "lobby", label: "Lobby refresh", costPsf: 14, quarters: 1, blurb: "+4% new-lease rents, more LOIs" },
  { id: "systems", label: "Systems & HVAC", costPsf: 22, quarters: 2, blurb: "−15% operating costs" },
  { id: "facade", label: "Facade program", costPsf: 30, quarters: 2, blurb: "+8% new-lease rents" },
];

export function startProgram(s: GameState, parcels: ParcelTable, bbl: string, programId: string): { s: GameState; err?: string } {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const p = PROGRAMS.find((x) => x.id === programId);
  if (!h || !rec || !p) return { s, err: "No such program." };
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to improve on a vacant lot." };
  if (h.program) return { s, err: "A capital program is already running." };
  if (h.programsDone?.[programId] !== undefined) return { s, err: "Already done here." };
  const cost = Math.round(rec.bldgArea * p.costPsf);
  if (s.cash < cost) return { s, err: `${p.label} costs $${(cost / 1e6).toFixed(2)}M — you're short.` };
  const next = clone(s);
  next.cash -= cost;
  const nh = next.holdings[bbl];
  nh.program = { id: programId, untilQ: next.quarter + p.quarters };
  next.news.unshift({ q: next.quarter, kind: "info", text: `${p.label} underway at ${rec.address} ($${(cost / 1e6).toFixed(2)}M).` });
  return { s: next };
}

export function tickPrograms(s: GameState, parcels: ParcelTable) {
  for (const h of Object.values(s.holdings)) {
    if (h.program && s.quarter >= h.program.untilQ) {
      h.programsDone = { ...(h.programsDone ?? {}), [h.program.id]: s.quarter };
      const rec = resolveRec(parcels, s, h.bbl);
      const p = PROGRAMS.find((x) => x.id === h.program!.id);
      if (rec && p) s.news.unshift({ q: s.quarter, kind: "info", text: `${p.label} complete at ${rec.address}.` });
      delete h.program;
    }
  }
}

export function setStance(s: GameState, bbl: string, stance: -1 | 0 | 1): GameState {
  const next = clone(s);
  if (next.holdings[bbl]) next.holdings[bbl].stance = stance;
  return next;
}
