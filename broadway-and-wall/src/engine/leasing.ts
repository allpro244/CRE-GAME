// Leasing: named tenants, inbound LOIs scaled by demand and the cycle,
// counters, TI/LC signing costs, renewals where the incumbent weighs the
// market against moving costs, and rollover risk that clusters.
// Multifamily skips all of this and runs aggregate occupancy.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { Credit, GameState, Holding, LOI, Sector } from "./types";
import { logBooks } from "./types";
import { rng, rrange } from "./market";
import { marketRentPsfYr, managedRentPsfYr, occupancy, resolveRec } from "./value";

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
    const suiteMax = rec.class === "industrial" ? rec.bldgArea : rec.bldgArea * 0.35;
    const sf = Math.round(Math.min(
      rec.bldgArea * targetOcc - leased,
      Math.round(rrange(s, rec.class === "industrial" ? 6000 : 1800, Math.max(2600, suiteMax)) / 100) * 100,
    ));
    if (sf < (rec.class === "industrial" ? 2500 : 800)) break;
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

    // move-outs: leases that reached expiry without a signed renewal.
    // The space goes into make-ready — a turn cost now, leasable in a few months.
    const movedOut = h.tenants.filter((t) => t.endM <= q);
    h.tenants = h.tenants.filter((t) => t.endM > q);
    if (movedOut.length) {
      const outSf = movedOut.reduce((sum, t) => sum + t.sf, 0);
      const turnCost = Math.round(outSf * MAKE_READY_PSF * s.econ.costIdx);
      s.cash -= turnCost;
      logBooks(s, "capex", turnCost);
      h.makeReady = [...(h.makeReady ?? []), { sf: outSf, readyM: q + Math.round(rrange(s, 2, 5)) }];
      s.news.unshift({
        q, kind: "info",
        text: `${(outSf / 1000).toFixed(1)}k sf back at ${rec.address} — $${(turnCost / 1000).toFixed(0)}K make-ready, showable in a few months.`,
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
      const market = marketRentPsfYr(rec, s.econ, h.condition);
      s.lois.push({
        id: s.nextLoiId++,
        bbl: h.bbl,
        kind: "renewal",
        name: t.name, sector: t.sector, credit: t.credit,
        sf: t.sf,
        rentPsf: +(t.rentPsf * 0.3 + market * 0.7).toFixed(2),
        termM: Math.round(rrange(s, 36, 84)),
        tiPsf: Math.round(rrange(s, 4, 14)),
        freeM: 0,
        net: t.net,
        expiresM: t.endM,
        tenantIdx: i,
      });
    }

    // inbound demand for vacant, market-ready space
    const vac = vacantSf(rec, h) - notReadySf(h, q);
    const openLois = s.lois.filter((l) => l.bbl === h.bbl && l.kind === "new").length;
    // a big empty floorplate draws more than one prospect at a time
    const loiCap = vac > rec.bldgArea * 0.5 ? 3 : 2;
    if (!renovating && vac > 1200 && openLois < loiCap) {
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
      const p = Math.min(0.9, Math.max(0.03, 0.24 + rec.demandScore / 200 + phaseAdj + condAdj + stanceAdj + lobbyAdj)
        / 2.1 * brokerMult * leaseUp * emptyPush);
      if (rng(s) < p) {
        const sector = pickSector(s, rec.class);
        const [tiLo, tiHi] = TI_ASK[rec.class] ?? TI_ASK.office;
        const market = managedRentPsfYr(rec, s.econ, h);
        // Warehouses lease whole: one operator takes the building, or most of
        // it. Offices and shops carve into suites.
        const sf = rec.class === "industrial"
          ? (rng(s) < 0.6 ? vac : Math.round(rrange(s, 0.45, 0.85) * vac / 100) * 100)
          : Math.min(vac, Math.round(rrange(s, 1800, Math.min(24000, Math.max(2600, vac * 0.7))) / 100) * 100);
        s.lois.push({
          id: s.nextLoiId++,
          bbl: h.bbl,
          kind: "new",
          name: pickName(s, sector),
          sector,
          credit: rollCredit(s, rec.demandScore),
          sf: Math.round(Math.max(500, Math.min(vac, sf))),
          rentPsf: +(market * rrange(s, 0.88, 1.04)).toFixed(2),
          termM: Math.round(rrange(s, 36, 120)),
          tiPsf: Math.round(rrange(s, tiLo, tiHi)),
          freeM: Math.round(rrange(s, 0, 6.5)),
          net: rec.class === "office" ? rng(s) < 0.8 : rng(s) < 0.4,
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
  } else {
    h.tenants.push({
      name: l.name, sector: l.sector, credit: l.credit,
      sf: l.sf, rentPsf: l.rentPsf, net: l.net,
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

export function respondLOI(
  s: GameState, parcels: ParcelTable, id: number, action: LOIAction,
): { s: GameState; msg: string; err?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const loi = next.lois.find((l) => l.id === id);
  if (!loi) return { s, msg: "", err: "That LOI is gone." };
  const h = next.holdings[loi.bbl];
  const rec = resolveRec(parcels, next, loi.bbl);
  if (!h || !rec) return { s, msg: "", err: "You no longer control that building." };

  const sign = (l: LOI): string | null => {
    const cost = loiSigningCost(l);
    if (next.cash < cost) return `Signing costs $${(cost / 1e6).toFixed(2)}M (TI + commission) — you're short.`;
    signLoi(next, rec, h, l);
    return null;
  };

  if (action === "accept") {
    const err = sign(loi);
    if (err) return { s, msg: "", err };
    next.lois = next.lois.filter((l) => l.id !== id);
    return { s: next, msg: "Lease signed." };
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
      if (err) return { s, msg: "", err };
      next.lois = next.lois.filter((l) => l.id !== id);
      return { s: next, msg: `${loi.name} took your counter.` };
    }
    next.lois = next.lois.filter((l) => l.id !== id);
    next.news.unshift({ q: next.month, kind: "info", text: `${loi.name} walked on the counter at ${rec.address}.` });
    return { s: next, msg: `${loi.name} walked.` };
  }

  next.lois = next.lois.filter((l) => l.id !== id);
  return { s: next, msg: "Passed." };
}
