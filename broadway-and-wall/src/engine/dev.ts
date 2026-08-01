// Ground-up development (Groundwork's core loop, simplified for v1) plus
// building management: capital programs and rent stance.
//
// Development: on an owned vacant lot, choose use and FAR up to the zoning
// max, pay hard+soft cost per sf, fund with a 60% interest-only construction
// loan, wait 4-6 quarters while the building rises on the map, then lease up
// from empty. A modest random cost/schedule overrun keeps it honest.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Development, GameState } from "./types";
import { logBooks, monthLabel } from "./types";
import { rng, rrange } from "./market";
import { resolveRec } from "./value";
import { genAnchorTenant } from "./leasing";

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

// hard cost $/sf by use, before the height premium and soft costs.
// Sized so stabilized yield-on-cost lands ~150-250bps over the exit cap —
// a real development margin, not free money.
export const HARD_COST_PSF: Record<BuiltClass, number> = {
  office: 400, mixed: 375, multifamily: 330, retail: 300, industrial: 165,
};
const SOFT_COST = 0.18;        // design, legal, carry, contingency
const CONSTR_SPREAD = 2.4;     // over the index, interest-only

// Construction lenders underwrite lease risk, not blueprints. Spec commercial
// gets thin proceeds (nothing at all in a recession); an anchor pre-lease
// unlocks real leverage. Residential and industrial carry less lease risk.
function constructionLtc(use: BuiltClass, preLease: boolean, phase: string): number {
  const specRisk = use === "office" || use === "retail" || use === "mixed";
  if (!specRisk) return 0.6;
  if (preLease) return 0.65;
  return phase === "recession" ? 0 : 0.45;
}

export const PRE_LEASE_SHARE = 0.35; // anchor takes 35% of the building
export const PRE_LEASE_EXTRA_M = 3;  // months spent landing the anchor first

export interface DevPlan {
  use: BuiltClass;
  floors: number;
  coverage: number;   // share of the lot the floorplate covers
  preLease: boolean;
  sf: number;
  far: number;
  farMax: number;
  costTotal: number;
  loanAmount: number;
  ratePct: number;
  equity: number;
  months: number;
  lenderNote?: string;
}

// The buildable envelope, and nothing else. Ashport has no use districts —
// any class on any lot — so the only limit is how much floor area the FAR
// allows, and how much of the lot you choose to cover with it.
export function farMaxFor(rec: { farMaxComm: number; farMaxRes: number }): number {
  return Math.max(rec.farMaxComm, rec.farMaxRes, 2);
}
export function maxFloorsFor(rec: { farMaxComm: number; farMaxRes: number }, coverage: number): number {
  // The floor here is what a small building on a big site costs you: it must
  // be low enough that a beginner can afford SOMETHING on an acre lot, or the
  // whole development half of the game is locked until you are already rich.
  return Math.max(1, Math.floor(farMaxFor(rec) / Math.max(0.08, coverage)));
}

export function planDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass,
  floors: number, coverage = 0.6, preLease = false,
): DevPlan | null {
  const rec = parcels[bbl];
  if (!rec || !rec.lotArea) return null;
  const cov = Math.max(0.25, Math.min(0.9, coverage));
  const farMax = farMaxFor(rec);
  const fl = Math.max(1, Math.min(Math.round(floors), maxFloorsFor(rec, cov)));
  const sf = Math.round((rec.lotArea * cov * fl) / 100) * 100;
  if (sf < 2000) return null;
  const heightPrem = fl > 30 ? 1.28 : fl > 18 ? 1.18 : fl > 8 ? 1.07 : 1;
  const demo = rec.bldgArea > 0 ? Math.round(rec.bldgArea * 12 * s.econ.costIdx) : 0;
  const costTotal = Math.round(sf * HARD_COST_PSF[use] * s.econ.costIdx * heightPrem * (1 + SOFT_COST)) + demo;
  const canPreLease = use === "office" || use === "retail" || use === "mixed";
  const ltc = constructionLtc(use, preLease && canPreLease, s.econ.phase);
  const loanAmount = Math.round(costTotal * ltc);
  const ratePct = +(s.econ.indexRate + CONSTR_SPREAD).toFixed(2);
  const months = Math.min(30, 11 + Math.round(fl * 0.55)) + (preLease && canPreLease ? PRE_LEASE_EXTRA_M : 0);
  const lenderNote = ltc === 0
    ? "No construction lender will touch spec commercial in a recession — pre-lease it or build all-equity."
    : undefined;
  return {
    use, floors: fl, coverage: cov, preLease: preLease && canPreLease, sf,
    far: +(sf / rec.lotArea).toFixed(1), farMax,
    costTotal, loanAmount, ratePct, equity: costTotal - loanAmount, months, lenderNote,
  };
}

export function startDevelopment(
  s: GameState, parcels: ParcelTable, bbl: string, use: BuiltClass,
  floors: number, coverage = 0.6, preLease = false,
): { s: GameState; err?: string } {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.holdings[bbl]) return { s, err: "Buy the dirt first." };
  if (rec.class !== "land") return { s, err: "Clear the site first — demolish what's standing before you build." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, preLease);
  if (!plan) return { s, err: "That's too small to be worth building — add floors or cover more of the lot." };
  if (s.cash < plan.equity) return { s, err: `Ground-breaking needs $${(plan.equity / 1e6).toFixed(2)}M of equity — you're short.` };
  const next = clone(s);
  next.cash -= plan.equity;
  logBooks(next, "dev", plan.equity);
  next.developments[bbl] = {
    bbl, use, sf: plan.sf, floors: plan.floors,
    costTotal: plan.costTotal, loanBalance: plan.loanAmount, ratePct: plan.ratePct,
    startM: next.month, deliverM: next.month + plan.months, overrunRolled: false,
    preLeasedSf: plan.preLease ? Math.round(plan.sf * PRE_LEASE_SHARE) : undefined,
  } satisfies Development;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Ground broken at ${rec.address}: ${plan.floors} floors, ${(plan.sf / 1000).toFixed(0)}k sf of ${use} at ${plan.far} FAR, $${(plan.costTotal / 1e6).toFixed(1)}M budget${plan.preLease ? ", anchor pre-leased" : ""}, delivery ${monthLabel(next.month + plan.months)}.`,
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
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${rec.address} came down — $${(cost / 1e6).toFixed(2)}M to clear it. The site is dirt again.`,
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
    const ci = Math.round((d.loanBalance * d.ratePct) / 100 / 12);
    s.cash -= ci;
    logBooks(s, "dev", ci);

    const mid = Math.floor((d.startM + d.deliverM) / 2);
    if (!d.overrunRolled && s.month >= mid) {
      d.overrunRolled = true;
      if (rng(s) < 0.55) {
        const bump = rrange(s, 0.03, 0.15);
        const extra = Math.round(d.costTotal * bump);
        d.costTotal += extra;
        s.cash -= extra; // change orders are an equity check
        logBooks(s, "dev", extra);
        s.news.unshift({ q: s.month, kind: "warn", text: `Change orders at ${rec.address}: the budget grew $${(extra / 1e6).toFixed(2)}M (${(bump * 100).toFixed(0)}%).` });
      }
      if (rng(s) < 0.3) {
        d.deliverM += 1;
        s.news.unshift({ q: s.month, kind: "warn", text: `Schedule slip at ${rec.address} — delivery moves to ${monthLabel(d.deliverM)}.` });
      }
    }

    if (s.month >= d.deliverM) {
      // delivery: the override becomes the building; the construction loan
      // converts to a lease-up mini-perm (IO 12 months, 4-year balloon)
      s.built[d.bbl] = { class: d.use, bldgArea: d.sf, floors: d.floors, yearBuilt: 2026 + Math.floor(s.month / 12) };
      const h = s.holdings[d.bbl];
      h.condition = "good";
      h.tenants = [];
      h.deliveredM = s.month;   // new space leases with momentum
      if (d.use === "multifamily") h.occ = 0.1;
      h.costBasis += d.costTotal;
      h.assessed = (h.assessed ?? h.costBasis - d.costTotal) + d.costTotal; // improvements hit the tax roll at cost
      if (d.preLeasedSf) {
        const built = resolveRec(parcels, s, d.bbl);
        if (built) genAnchorTenant(s, built, h, d.preLeasedSf);
      }
      h.loan = {
        product: "float",
        principal: d.loanBalance,
        balance: d.loanBalance,
        ratePct: +(s.econ.indexRate + 1.9).toFixed(2),
        spread: 1.9,
        ioUntilM: s.month + 12,
        amortYears: 30,
        maturityM: s.month + 48,
        monthlyPmt: Math.round((d.loanBalance * (s.econ.indexRate + 1.9)) / 100 / 12),
        minDSCR: 1.05, // lease-up paper is forgiving, briefly
        maxLTV: 0.9,
        sweep: false,
        cleanQs: 0,
        originM: s.month,
      };
      delete s.developments[d.bbl];
      bumpLand(s, d.bbl, 1.06);
      s.news.unshift({ q: s.month, kind: "deal", text: `Delivered: ${(d.sf / 1000).toFixed(0)}k sf of ${d.use} at ${rec.address}. Now fill it.` });
    }
  }
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

function useForZone(zone: string, demand: number, r: number): BuiltClass {
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
      const score = rec.demandScore + rng(s) * 25;
      if (score > bestScore) { bestScore = score; best = { bbl, rec }; }
    }
    if (!best) continue;
    const { bbl, rec } = best;
    const use = useForZone(rec.zoneDist, rec.demandScore, rng(s));
    const farMax = farMaxFor(rec);
    // young town builds small; a mature one builds to the envelope
    const frac = Math.min(0.95, 0.22 + 0.45 * maturity + 0.3 * (rec.demandScore / 100) * maturity + rng(s) * 0.15);
    const sf = Math.max(3000, Math.round((rec.lotArea * farMax * frac) / 100) * 100);
    const floors = Math.max(1, Math.round(sf / (rec.lotArea * 0.62)));
    s.built[bbl] = { class: use, bldgArea: sf, floors, yearBuilt: 2026 + Math.floor(s.month / 12) };
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
