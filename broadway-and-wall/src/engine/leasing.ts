// Leasing: named tenants, inbound LOIs scaled by demand and the cycle,
// counters, TI/LC signing costs, renewals where the incumbent weighs the
// market against moving costs, and rollover risk that clusters.
// Multifamily skips all of this and runs aggregate occupancy.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { Credit, GameState, Holding, LOI, Sector } from "./types";
import { logBooks } from "./types";
import { rng, rrange } from "./market";
import { marketRentPsfYr, managedRentPsfYr, occupancy, resolveRec, opexPsf, TAX_RATE, recoveryOf } from "./value";
import type { Recovery } from "./value";
import { drawLoc, locAvailable } from "./credit";

const CAP_KEYS = { office: 0, retail: 0, mixed: 0, multifamily: 0, industrial: 0 };

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
function stopPsfNow(rec: ParcelRecord, econ: GameState["econ"], h: Holding): number {
  const cls = rec.class as "office" | "retail" | "mixed" | "multifamily" | "industrial";
  const tax = (h.assessed ?? h.costBasis) * TAX_RATE / Math.max(1, rec.bldgArea);
  return opexPsf(cls, econ, h.programsDone?.systems !== undefined) + tax;
}

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M`
  : n >= 10_000 ? `$${Math.round(n / 1000)}K`
  : `$${Math.round(n).toLocaleString()}`;

const POOL: Record<Sector, string[]> = {
  finance: ["Meridian Capital", "Harborline Securities", "Crown & Weir", "Bellamy Fund Group", "Quayside Partners"],
  law: ["Ashe & Porter LLP", "Calder Marsh", "Winslow Legal", "Tern & Rigging", "Foundry Law Group"],
  tech: ["Brightwater Systems", "Ledgerworks", "Spindrift Labs", "Cordage Software", "Beacon Analytics"],
  media: ["The Ashport Ledger", "Harborcast Studios", "Gullwing Press", "Northside Signal"],
  insurance: ["Maritime Mutual", "Anchor Assurance", "Seawall Underwriters", "Garland Indemnity"],
  logistics: ["Freightline Co.", "Slipway Cargo", "Gantry Freight", "Blue Hull Shipping"],
  apparel: ["Tidewater Trading Co.", "Rowan Thread Works", "Salt & Selvedge", "Customs House Outfitters"],
  food: ["The Chandler Room", "Bell Slip Provisions", "Kiln Street Roasters", "Founders Market Hall"],
  medical: ["Harbor Medical Group", "Northside Clinic", "Beacon Dental", "Ashport Diagnostics"],
  design: ["Marsh & Vane Architects", "Cooper Lane Studio", "Pier Four Design", "Whitlow Drafting"],
};
const SECTORS_BY_CLASS: Record<string, Sector[]> = {
  office: ["finance", "law", "tech", "media", "insurance", "design"],
  retail: ["apparel", "food", "medical"],
  mixed: ["tech", "media", "design", "food", "medical", "apparel"],
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
  return rec.class === "office" || rec.class === "retail" || rec.class === "mixed" || rec.class === "industrial";
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
export function suiteSf(rec: ParcelRecord): number {
  const a = Math.max(1, rec.bldgArea);
  switch (rec.class) {
    case "multifamily": return 900;                                    // an apartment
    case "industrial":  return Math.max(12_000, Math.min(90_000, a / 2.2));
    case "retail":      return Math.max(1_400, Math.min(14_000, a / 6));
    case "mixed":       return Math.max(2_000, Math.min(18_000, a / 9));
    default:            return Math.max(2_500, Math.min(28_000, a / 12));  // office
  }
}

// How many leasable spaces the building holds.
export function unitCount(rec: ParcelRecord): number {
  if (!rec.bldgArea) return 0;
  return Math.max(1, Math.round(rec.bldgArea / suiteSf(rec)));
}

// How many of them a given lease occupies.
export function unitsOf(rec: ParcelRecord, sf: number): number {
  return Math.max(1, Math.round(sf / suiteSf(rec)));
}

/** Leased / total spaces, and the sf behind each — the tenancy at a glance. */
export function unitStatus(rec: ParcelRecord, h: Holding, month: number): {
  total: number; leased: number; vacant: number; notReady: number; sfPer: number;
} {
  const total = unitCount(rec);
  const sfPer = suiteSf(rec);
  if (rec.class === "multifamily") {
    const leased = Math.min(total, Math.round((h.occ ?? 0) * total));
    return { total, leased, vacant: total - leased, notReady: 0, sfPer };
  }
  const leasedSf = h.tenants.reduce((n, t) => n + t.sf, 0);
  const leased = Math.min(total, Math.max(h.tenants.length ? 1 : 0, Math.round(leasedSf / sfPer)));
  const notReady = Math.min(Math.max(0, total - leased), Math.round(notReadySf(h, month) / sfPer));
  return { total, leased, vacant: Math.max(0, total - leased - notReady), notReady, sfPer };
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
function toSuites(rec: ParcelRecord, want: number, cap: number): number {
  const sfPer = suiteSf(rec);
  const maxUnits = Math.floor(cap / sfPer + 0.02);
  if (maxUnits < 1) return cap >= Math.min(PART_SUITE_MIN, sfPer * 0.35) ? Math.round(cap) : 0;
  const n = Math.max(1, Math.min(maxUnits, Math.round(want / sfPer)));
  const taken = n * sfPer;
  // if letting whole suites would strand an unlettable sliver, take it too
  const left = cap - taken;
  return Math.round(left > 0 && left < Math.min(PART_SUITE_MIN, sfPer * 0.35) ? cap : taken);
}

// In-place rent roll at acquisition. Expirations cluster around a couple of
// anchor years — a building with everything rolling at once is a visibly
// riskier asset, and that's the point.
export function genRentRoll(s: GameState, rec: ParcelRecord, holding: Holding) {
  if (rec.class === "multifamily") {
    holding.occ = Math.min(0.99, Math.max(0.5, occupancy(rec, s.econ) + rrange(s, -0.05, 0.04)));
    return;
  }
  if (!isCommercial(rec) || !rec.bldgArea) return;
  const targetOcc = Math.min(0.98, occupancy(rec, s.econ) + rrange(s, -0.08, 0.05));
  const market = marketRentPsfYr(rec, s.econ, holding.condition);
  const anchors = [
    s.month + Math.round(rrange(s, 9, 36)),
    s.month + Math.round(rrange(s, 39, 90)),
  ];
  let leased = 0;
  let guard = 0;
  while (leased < rec.bldgArea * targetOcc && guard++ < 40) {
    // whole suites only: a tenant takes one space, or knocks a few together
    const free = rec.bldgArea * targetOcc - leased;
    const want = suiteSf(rec) * Math.max(1, Math.round(rrange(s, 1, rec.class === "industrial" ? 1.6 : 2.8)));
    const sf = toSuites(rec, want, free);
    if (!sf) break;
    const sector = pickSector(s, rec.class);
    const endM = rng(s) < 0.6
      ? anchors[Math.floor(rng(s) * anchors.length) % anchors.length] + Math.round(rrange(s, -3, 3))
      : s.month + Math.round(rrange(s, 6, 96));
    holding.tenants.push({
      name: pickName(s, sector),
      sector,
      credit: rollCredit(s, rec.demandScore),
      sf,
      rentPsf: +(market * rrange(s, 0.82, 1.04)).toFixed(2),
      net: rec.class === "office" ? rng(s) < 0.75 : rng(s) < 0.4,
      recovery: rollRecovery(s, rec.class),
      // Signed in the past, so the stop is frozen at the cheaper expense level
      // of that year — the older the lease, the bigger the gap the owner eats.
      baseStopPsf: +(stopPsfNow(rec, s.econ, holding) * rrange(s, 0.72, 0.98)).toFixed(2),
      startM: s.month - Math.round(rrange(s, 0, 48)),
      endM: Math.max(s.month + 1, endM),
    });
    leased += sf;
  }
}

export function vacantSf(rec: ParcelRecord, h: Holding): number {
  return Math.max(0, rec.bldgArea - h.tenants.reduce((sum, t) => sum + t.sf, 0));
}

// Space a departing tenant just left isn't leasable on day one — it's in
// make-ready (demo, paint, systems, demising) for a few months.
export function notReadySf(h: Holding, month: number): number {
  return (h.makeReady ?? []).reduce((sum, m) => sum + (m.readyM > month ? m.sf : 0), 0);
}

export const MAKE_READY_PSF = 6; // turn cost, $/sf before cost inflation

// Anchor pre-lease for a development: one large credit tenant signed before
// delivery, long paper at a small discount to market for taking the risk.
export function genAnchorTenant(s: GameState, rec: ParcelRecord, h: Holding, sfWanted: number) {
  if (!isCommercial(rec) || sfWanted < 1000) return;
  const sector = pickSector(s, rec.class);
  const market = marketRentPsfYr(rec, s.econ, h.condition);
  h.tenants.push({
    name: pickName(s, sector),
    sector,
    credit: rng(s) > 0.4 ? 2 : 1, // anchors are credit tenants
    sf: Math.round(sfWanted),
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
  office: [15, 40], retail: [5, 20], mixed: [10, 30], industrial: [2, 8],
};

export function tickLeasing(s: GameState, parcels: ParcelTable) {
  const q = s.month;
  // expire stale LOIs and LOIs on parcels no longer owned
  s.lois = s.lois.filter((l) => l.expiresM > q && s.holdings[l.bbl]);

  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;

    if (rec.class === "multifamily") {
      const target = occupancy(rec, s.econ);
      h.occ = Math.min(0.99, Math.max(0.4, (h.occ ?? target) + (target - (h.occ ?? target)) * 0.1 + rrange(s, -0.006, 0.006)));
      continue;
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
      const classLag = rec.class === "office" ? 5.5 : rec.class === "industrial" ? 2.5 : 3.5;
      const down = Math.max(1, Math.round(classLag * soft * rrange(s, 0.7, 1.4)));
      h.makeReady = [...(h.makeReady ?? []), { sf: outSf, readyM: q + down }];
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
      h.makeReady = [...(h.makeReady ?? []), { sf: t.sf, readyM: q + down }];
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
        name: t.name, sector: t.sector, credit: t.credit,
        sf: t.sf,
        rentPsf: +Math.max(market * 0.6, ask).toFixed(2),
        termM: Math.round(rrange(s, 36, 84)),
        tiPsf: Math.round(rrange(s, 2, 9) * (s.econ.phase === "recession" ? 1.5 : 1)),
        freeM: s.econ.phase === "recession" && rng(s) < 0.4 ? Math.round(rrange(s, 1, 3)) : 0,
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
      const mom = s.econ.sectorMom?.[rec.class as keyof typeof s.econ.sectorMom] ?? 0;
      const sectorAdj = mom * 9;
      const jobsMult = Math.max(0.55, Math.min(1.6, 0.65 + 0.35 * (s.econ.employIdx ?? 1)));
      // Everyone else's deliveries are competing for the same tenant.
      const supplyMult = Math.max(0.5, 1 - 34 * (s.econ.supplyPress?.[rec.class as keyof typeof CAP_KEYS] ?? 0));
      const p = Math.min(0.9, Math.max(0.02, 0.24 + rec.demandScore / 200 + phaseAdj + condAdj + stanceAdj + lobbyAdj + sectorAdj)
        / 2.1 * brokerMult * leaseUp * emptyPush * jobsMult * supplyMult);
      if (rng(s) < p) {
        const sector = pickSector(s, rec.class);
        const [tiLo, tiHi] = TI_ASK[rec.class] ?? TI_ASK.office;
        const concession = s.econ.phase === "recession" ? 1.85 : s.econ.phase === "recovery" ? 1.35
          : s.econ.phase === "peak" ? 0.9 : 0.7;
        const market = managedRentPsfYr(rec, s.econ, h);
        // Warehouses lease whole: one operator takes the building, or most of
        // it. Offices and shops carve into suites.
        // Prospects ask for spaces, not square feet. Warehouses tend to want
        // the whole shed; offices and shops take one suite or a few.
        const want = rec.class === "industrial"
          ? (rng(s) < 0.6 ? vac : vac * rrange(s, 0.5, 0.9))
          : suiteSf(rec) * Math.max(1, Math.round(rrange(s, 1, 3.4)));
        const sf = toSuites(rec, want, vac);
        if (!sf) continue;
        const credit = rollCredit(s, rec.demandScore);
        s.lois.push({
          id: s.nextLoiId++,
          bbl: h.bbl,
          kind: "new",
          name: pickName(s, sector),
          sector,
          credit,
          sf,
          // A wide spread on purpose. If every prospect offers within a few
          // per cent of asking, the accept/counter/pass modal is a formality.
          // Some of these should be worth refusing, and refusing should hurt.
          rentPsf: +(market * (rng(s) < 0.3 ? rrange(s, 0.68, 0.86) : rrange(s, 0.9, 1.1))).toFixed(2),
          // Term length is not random. A credit tenant taking a whole floor
          // signs long paper and expects to be paid for it; a small unrated
          // firm wants three years and an out. WALT is the thing a buyer
          // actually underwrites, and it has to be earned tenant by tenant.
          termM: Math.round(
            (credit === 2 ? rrange(s, 96, 180) : credit === 1 ? rrange(s, 60, 120) : rrange(s, 36, 66))
            * (sf > suiteSf(rec) * 2.5 ? 1.15 : 1)
            * (s.econ.phase === "recession" ? 0.85 : 1),
          ),
          // Concessions are the first thing to move when a market turns, and
          // they move long before face rents do. A landlord holding headline
          // rent while giving away a year of free rent is the oldest tell in
          // the business.
          tiPsf: Math.round(rrange(s, tiLo, tiHi) * concession * (credit === 2 ? 1.35 : credit === 1 ? 1.05 : 0.85)),
          freeM: Math.round(rrange(s, 0, 6.5) * concession),
          net: rec.class === "office" ? rng(s) < 0.8 : rng(s) < 0.4,
          recovery: rollRecovery(s, rec.class),
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
    if (recoveryOf(t) === "base") t.baseStopPsf = +stopPsfNow(rec, s.econ, h).toFixed(2);
  } else {
    h.tenants.push({
      name: l.name, sector: l.sector, credit: l.credit,
      sf: l.sf, rentPsf: l.rentPsf, net: l.net,
      recovery: l.recovery ?? (l.net ? "nnn" : "gross"),
      baseStopPsf: +stopPsfNow(rec, s.econ, h).toFixed(2),
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
    if (loi.countered) return { s, msg: "", err: "You already countered — they're deciding." };
    loi.countered = true;
    loi.rentPsf = +(loi.rentPsf * 1.06).toFixed(2);
    loi.tiPsf = Math.round(loi.tiPsf * 0.7);
    const phaseAdj = next.econ.phase === "expansion" ? 0.15 : next.econ.phase === "recession" ? -0.15 : 0;
    const p = 0.38 + loi.credit * 0.12 + phaseAdj + (rec.demandScore - 50) / 400 + (loi.kind === "renewal" ? 0.18 : 0);
    if (rng(next) < p) {
      const err = sign(loi);
      if (err) {
        next.lois = next.lois.filter((l) => l.id !== id);
        next.news.unshift({ q: next.month, kind: "warn", text: `${loi.name} took your counter at ${rec.address} and you could not fund the fit-out. The deal died.` });
        return { s: next, msg: "", err };
      }
      next.lois = next.lois.filter((l) => l.id !== id);
      return { s: next, msg: `${loi.name} took your counter.` + drawNote() };
    }
    next.lois = next.lois.filter((l) => l.id !== id);
    next.news.unshift({ q: next.month, kind: "info", text: `${loi.name} walked on the counter at ${rec.address}.` });
    return { s: next, msg: `${loi.name} walked.` };
  }

  next.lois = next.lois.filter((l) => l.id !== id);
  return { s: next, msg: "Passed." };
}
