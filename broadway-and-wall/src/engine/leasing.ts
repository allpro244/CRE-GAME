// Leasing: named tenants, inbound LOIs scaled by demand and the cycle,
// counters, TI/LC signing costs, renewals where the incumbent weighs the
// market against moving costs, and rollover risk that clusters.
// Multifamily skips all of this and runs aggregate occupancy.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, Credit, GameState, Holding, LOI, Sector } from "./types";
import { logBooks, monthLabel } from "./types";
import { rng, rrange , vacancyPull, NATURAL_VAC} from "./market";
import { managedRentPsfYr, useRentPsfYr, useOccupancy, resolveRec, opexPsf, TAX_RATE, recoveryOf } from "./value";
import { blendBy, commercialShare, dominantUse, mixOf, uses, useSf } from "./mix";
import type { Recovery } from "./value";
import { drawLoc, locAvailable } from "./credit";

const CAP_KEYS = { office: 0, retail: 0, multifamily: 0, industrial: 0 };

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
  const op = use ? opexPsf(use, econ, sys) : blendBy(rec, (u) => opexPsf(u, econ, sys));
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

function pickSector(s: GameState, cls: string): Sector {
  const arr = SECTORS_BY_CLASS[cls] ?? SECTORS_BY_CLASS.office;
  return arr[Math.floor(rng(s) * arr.length) % arr.length];
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
export function useSuiteSf(rec: ParcelRecord, use: BuiltClass): number {
  // Sized off the COMPONENT, not the building. Ground-floor retail under a
  // tower demises into shops, not into floors — sizing it off the tower gave
  // a 400,000 sf building 30,000 sf "shops", which is a department store.
  const a = Math.max(1, useSf(rec, use) || rec.bldgArea);
  switch (use) {
    case "multifamily": return 900;                                    // an apartment
    case "industrial":  return Math.max(12_000, Math.min(90_000, a / 2.2));
    case "retail":      return Math.max(1_400, Math.min(14_000, a / 6));
    default:            return Math.max(2_500, Math.min(28_000, a / 12));  // office
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
const PART_SUITE_MIN = 700;   // below this it isn't space, it's a closet
function toSuites(rec: ParcelRecord, want: number, cap: number, use?: BuiltClass): number {
  const sfPer = use ? useSuiteSf(rec, use) : suiteSf(rec);
  const maxUnits = Math.floor(cap / sfPer + 0.02);
  if (maxUnits < 1) return cap >= Math.min(PART_SUITE_MIN, sfPer * 0.35) ? Math.round(cap) : 0;
  const n = Math.max(1, Math.min(maxUnits, Math.round(want / sfPer)));
  const taken = n * sfPer;
  // if letting whole suites would strand an unlettable sliver, take it too
  const left = cap - taken;
  // ...and never more than there is. The 0.02 slop above absorbs float error
  // when the space divides evenly, but it can also round a whole suite up past
  // what is actually vacant — which let buildings sign leases for a few dozen
  // square feet they did not have.
  return Math.min(Math.floor(cap), Math.round(left > 0 && left < Math.min(PART_SUITE_MIN, sfPer * 0.35) ? cap : taken));
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
      credit: rollCredit(s, rec.demandScore),
      sf,
      rentPsf: +(market * rrange(s, 0.82, 1.04)).toFixed(2),
      net: use === "office" ? rng(s) < 0.75 : rng(s) < 0.4,
      recovery: rollRecovery(s, use),
      // Signed in the past, so the stop is frozen at the cheaper expense level
      // of that year — the older the lease, the bigger the gap the owner eats.
      baseStopPsf: +(stopPsfNow(rec, s.econ, holding, use) * rrange(s, 0.72, 0.98)).toFixed(2),
      startM: s.month - Math.round(rrange(s, 0, 48)),
      endM: Math.max(s.month + 1, endM),
    });
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

export const TI_ASK: Record<string, [number, number]> = {
  office: [15, 40], retail: [5, 20], industrial: [2, 8], multifamily: [0, 3],
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

export function tickLeasing(s: GameState, parcels: ParcelTable) {
  const q = s.month;
  // expire stale LOIs and LOIs on parcels no longer owned
  s.lois = s.lois.filter((l) => l.expiresM > q && s.holdings[l.bbl]);

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
    if (!isCommercial(rec)) continue;

    const renovating = h.renovatingUntilM !== undefined && q < h.renovatingUntilM;

    // --- obsolescence --------------------------------------------------------
    // Buildings age. A floorplate that was fine in 1985 is a hard sell in 2015
    // with the same bones, the same lifts and the same air handling. Left
    // alone, an asset slides from good to standard to worn, and every step
    // costs it rent, costs it a wider cap rate, and makes it harder to lease.
    // This is what makes a capital programme a decision rather than a
    // decoration — and it is the reason a portfolio cannot simply be bought
    // once and held for a century.
    if (!renovating) {
      h.lastCapM = h.lastCapM ?? h.boughtM;
      const since = q - h.lastCapM;
      // roughly: a cycle of neglect every twenty-odd years, faster on offices
      const clock = rec.class === "office" ? 240 : rec.class === "retail" ? 270 : 320;
      if (since > clock && rng(s) < 0.02) {
        const next = h.condition === "good" ? "standard" : h.condition === "standard" ? "worn" : null;
        if (next) {
          h.condition = next;
          h.lastCapM = q;
          s.news.unshift({
            q, kind: "warn",
            text: `${rec.address} has slipped to ${next} condition — the systems are dated and the brokers have noticed. Rents will follow.`,
          });
        }
      }
    }

    // move-outs: leases that reached expiry without a signed renewal.
    // The space goes into make-ready — a turn cost now, leasable in a few months.
    const movedOut = h.tenants.filter((t) => t.endM <= q);
    h.tenants = h.tenants.filter((t) => t.endM > q);
    if (movedOut.length) {
      const outSf = movedOut.reduce((sum, t) => sum + t.sf, 0);
      const turnCost = Math.round(outSf * MAKE_READY_PSF * s.econ.costIdx);
      s.cash -= turnCost;
      logBooks(s, "capex", turnCost);
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
      const pFail = 0.00035 * cycle * grade * (1 + sectorStress);
      if (rng(s) >= pFail) continue;
      h.tenants.splice(i, 1);
      // you keep whatever security deposit there was — call it three months
      const recovered = Math.round(t.rentPsf * t.sf * 0.25);
      s.cash += recovered;
      const down = Math.max(2, Math.round((rec.class === "office" ? 6 : 4) * rrange(s, 0.8, 1.5)));
      h.makeReady = [...(h.makeReady ?? []), { sf: t.sf, readyM: q + down, use: t.use }];
      s.news.unshift({
        q, kind: "warn",
        text: `${t.name} filed and went dark at ${rec.address} — ${(t.sf / 1000).toFixed(1)}k sf back with ${(t.endM - q) / 12 > 1 ? `${((t.endM - q) / 12).toFixed(1)} years` : `${t.endM - q} months`} left on the lease. You kept $${(recovered / 1000).toFixed(0)}K of deposit.`,
      });
    }

    // contractual escalations: rents step up ~2.5% on each lease anniversary
    for (const t of h.tenants) {
      const age = q - t.startM;
      if (age > 0 && age % 12 === 0) t.rentPsf = +(t.rentPsf * 1.025).toFixed(2);
    }

    // renewal talks open six months ahead of expiry
    for (let i = 0; i < h.tenants.length; i++) {
      const t = h.tenants[i];
      if (t.endM !== q + 6) continue;
      if (s.lois.some((l) => l.bbl === h.bbl && l.tenantIdx === i)) continue;
      const market = managedRentPsfYr(rec, s.econ, h);
      // A tenant sitting well below market knows what a move costs them and
      // renews near market. A tenant ABOVE market knows the same thing in
      // reverse and asks for a cut — and in a soft market they get it.
      const overMarket = t.rentPsf / Math.max(1, market);
      const leverage = overMarket > 1.05 ? 0.82 : overMarket < 0.9 ? 1.0 : 0.94;
      const soft = s.econ.phase === "recession" ? 0.88 : s.econ.phase === "recovery" ? 0.95 : 1;
      // Credit tenants are worth keeping and they know it.
      const creditDisc = t.credit === 2 ? 0.97 : t.credit === 1 ? 1.0 : 1.02;
      const ask = market * leverage * soft * creditDisc;
      // Renewals are cheap to do: no downtime, a fraction of the TI, no free
      // rent worth the name. That gap is why renewal economics beat a new
      // lease at a higher face rent almost every time.
      s.lois.push({
        id: s.nextLoiId++,
        bbl: h.bbl,
        kind: "renewal",
        // A renewal is for the space the tenant is ALREADY in. This carried no
        // use at all, so signing one fell through to the building's dominant
        // use — and in a residential-leaning mixed building that is the flats,
        // which put a named commercial tenant in the housing.
        use: t.use ?? leasableUses(rec)[0] ?? "office",
        name: t.name, sector: t.sector, credit: t.credit,
        sf: t.sf,
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
    const openLois = s.lois.filter((l) => l.bbl === h.bbl && l.kind === "new").length;
    // a big empty floorplate draws more than one prospect at a time
    const loiCap = vac > rec.bldgArea * 0.5 ? 3 : 2;
    if (!renovating && vac >= Math.min(PART_SUITE_MIN, suiteSf(rec) * 0.35) && openLois < loiCap) {
      const phaseAdj = s.econ.phase === "expansion" ? 0.14 : s.econ.phase === "recession" ? -0.14 : 0;
      const condAdj = h.condition === "good" ? 0.1 : h.condition === "worn" ? -0.1 : 0;
      const stanceAdj = -0.12 * (h.stance ?? 0);                       // pushing rents thins the funnel
      const lobbyAdj = h.programsDone?.lobby !== undefined ? 0.08 : 0; // a lobby people remember
      const brokerMult = h.broker ? 1.75 : 1;                          // an exclusive works the phones
      // A building you just finished is being actively marketed — brokers
      // have been touring it since before the ribbon was cut. Without this,
      // a new tower sat empty for years while you paid the debt service.
      const leaseUp = h.deliveredM !== undefined && q - h.deliveredM <= 30 ? 1.9 : 1;
      // Space that's mostly empty gets worked harder than one odd suite.
      const emptyPush = 1 + 0.7 * (vac / Math.max(1, rec.bldgArea));
      // What the sector is doing, and whether the city is hiring, decide how
      // many prospects walk through the door — not just the phase of the cycle.
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
      const specMult = specLive ? 1.9 : 1;
      const mom = s.econ.sectorMom?.[use] ?? 0;
      const sectorAdj = mom * 9;
      const jobsMult = Math.max(0.55, Math.min(1.6, 0.65 + 0.35 * (s.econ.employIdx ?? 1)));
      // Everyone else's deliveries are competing for the same tenant.
      const supplyMult = Math.max(0.5, 1 - 34 * (s.econ.supplyPress?.[use as keyof typeof CAP_KEYS] ?? 0));
      // The citywide vacancy for THIS class decides how many tenants are even
      // in the market. When the city runs a glut, your phone is one of many
      // that ring less — and leases stop falling into your lap, which they
      // were doing regardless of conditions.
      const marketPull = vacancyPull(s.econ, use);
      const p = Math.min(0.75, Math.max(0.015, 0.24 + rec.demandScore / 200 + phaseAdj + condAdj + stanceAdj + lobbyAdj + sectorAdj)
        / 2.7 * brokerMult * specMult * leaseUp * emptyPush * jobsMult * supplyMult * marketPull);
      if (rng(s) < p) {
        const sector = pickSector(s, use);
        const [tiLo, tiHi] = TI_ASK[use] ?? TI_ASK.office;
        const concession = concessionPressure(s.econ, use);
        // ...and at the rent THAT market pays, not a blend of markets the
        // tenant is not in.
        const market = managedRentPsfYr(rec, s.econ, h, use);
        // Warehouses lease whole: one operator takes the building, or most of
        // it. Offices and shops carve into suites.
        // Prospects ask for spaces, not square feet. Warehouses tend to want
        // the whole shed; offices and shops take one suite or a few.
        const want = use === "industrial"
          ? (rng(s) < 0.6 ? legVac : legVac * rrange(s, 0.5, 0.9))
          : useSuiteSf(rec, use) * Math.max(1, Math.round(rrange(s, 1, 3.4)));
        const sf = toSuites(rec, want, legVac, use);
        if (!sf) continue;
        const credit = rollCredit(s, rec.demandScore);
        // term first: the free-rent ask is a function of how long they sign for
        const termM = Math.round(
          (credit === 2 ? rrange(s, 84, 144) : credit === 1 ? rrange(s, 60, 108) : rrange(s, 36, 60))
          * (sf > useSuiteSf(rec, use) * 2.5 ? 1.15 : 1)
          * (s.econ.phase === "recession" ? 0.85 : 1),
        );
        s.lois.push({
          id: s.nextLoiId++,
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
          rentPsf: +(market * (specLive ? 1.05 : 1) * (rng(s) < 0.3 ? rrange(s, 0.68, 0.86) : rrange(s, 0.9, 1.1))).toFixed(2),
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
          tiPsf: Math.round(rrange(s, tiLo, tiHi) * concession * (credit === 2 ? 1.35 : credit === 1 ? 1.05 : 0.85) * (specLive ? 0.12 : 1)),
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
        s.news.unshift({ q, kind: "info", text: `LOI in at ${rec.address} — check the Deals desk.` });
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
  if (take < 800) return null;
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
  if (l.kind === "renewal" && l.tenantIdx !== undefined && h.tenants[l.tenantIdx]) {
    const t = h.tenants[l.tenantIdx];
    t.rentPsf = l.rentPsf;
    t.endM = s.month + l.termM;
    // A renewal RESETS the base year. That is the quiet half of every renewal
    // negotiation: the tenant gives up years of accumulated recovery, and the
    // owner gives up the rent they could have pushed. Rolling the stop forward
    // is often worth more than the spread on the rent.
    if (recoveryOf(t) === "base") t.baseStopPsf = +stopPsfNow(rec, s.econ, h, t.use).toFixed(2);
  } else {
    // An LOI was sized against the vacancy on the day it was written. Two of
    // them can be live at once, so the second one signs against whatever is
    // left — you cannot lease the same floor twice.
    // Residential is modelled as OCCUPANCY, never as named tenants, so the
    // fallback has to come off the leasable (commercial) uses. dominantUse can
    // return multifamily, and did.
    const use = l.use ?? leasableUses(rec)[0] ?? "office";
    const sf = Math.min(l.sf, Math.max(0, useVacantSf(rec, h, use, s.month)));
    if (sf < 1) return;
    h.tenants.push({
      name: l.name, use, sector: l.sector, credit: l.credit,
      sf, rentPsf: l.rentPsf, net: l.net,
      recovery: l.recovery ?? (l.net ? "nnn" : "gross"),
      baseStopPsf: +stopPsfNow(rec, s.econ, h, use).toFixed(2),
      startM: s.month, endM: s.month + l.termM,
      freeUntilM: l.freeM ? s.month + l.freeM : undefined,
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
  counter?: { rentPsf?: number; tiPsf?: number },
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
    signLoi(next, rec, h, l);
    return null;
  };
  const drawNote = () => (drawn ? ` Drew ${money(drawn)} on the line to fund it.` : "");

  if (action === "accept") {
    const err = sign(loi);
    if (err) return { s, msg: "", err };
    next.lois = next.lois.filter((l) => l.id !== id);
    return { s: next, msg: "Lease signed." + drawNote() };
  }

  if (action === "counter") {
    // Once they have countered back, the number on the table is final —
    // accept it or lose them. No third round; nobody negotiates forever.
    if (loi.stage === "countered") return { s, msg: "", err: "Their counter was final. Take it or pass." };
    if (loi.countered) return { s, msg: "", err: "You already countered — they're deciding." };
    loi.countered = true;
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
    const pAccept = Math.max(0.04, Math.min(0.95,
      1.58 - f * 1.4 + loi.credit * 0.04 + tight + stick - tiCut
      + (next.econ.phase === "expansion" ? 0.06 : next.econ.phase === "recession" ? -0.08 : 0)));
    loi.rentPsf = askRent;
    loi.tiPsf = askTi;
    if (rng(next) < pAccept) {
      const err = sign(loi);
      if (err) {
        next.lois = next.lois.filter((l) => l.id !== id);
        next.news.unshift({ q: next.month, kind: "warn", text: `${loi.name} took your counter at ${rec.address} and you could not fund the fit-out. The deal died.` });
        return { s: next, msg: "", err };
      }
      next.lois = next.lois.filter((l) => l.id !== id);
      return { s: next, msg: `${loi.name} took your counter.` + drawNote() };
    }
    // the further past market you pushed, the faster the door
    const pWalk = Math.max(0.15, Math.min(0.92, 0.24 + (f - 1.0) * 2.2));
    if (rng(next) < pWalk) {
      next.lois = next.lois.filter((l) => l.id !== id);
      next.news.unshift({ q: next.month, kind: "info", text: `${loi.name} walked on the counter at ${rec.address} — $${askRent.toFixed(2)}/sf was more than the space was worth to them (market ~$${market.toFixed(2)}).` });
      return { s: next, msg: `${loi.name} walked.` };
    }
    // they counter back once — final
    loi.stage = "countered";
    loi.counterRentPsf = +Math.min(askRent, Math.max(loi.rentPsf * 0.94, market * (0.95 + 0.04 * rng(next)))).toFixed(2);
    loi.counterTiPsf = Math.round((askTi + loi.tiPsf) / 2);
    loi.rentPsf = loi.counterRentPsf;
    loi.tiPsf = loi.counterTiPsf;
    next.news.unshift({ q: next.month, kind: "info", text: `${loi.name} countered at ${rec.address}: $${loi.counterRentPsf.toFixed(2)}/sf, $${loi.counterTiPsf}/sf TI. Final answer — take it or lose them.` });
    return { s: next, msg: `${loi.name} countered — final.` };
  }

  next.lois = next.lois.filter((l) => l.id !== id);
  return { s: next, msg: "Passed." };
}
