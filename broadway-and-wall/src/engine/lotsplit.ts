// SPLITTING A LOT (any deed, downtown or not).
//
// A US lot split, as a planning department runs one:
//
//   MINOR       two to four lots, no new street: a survey, a deed description
//               for each lot, the planning staff's sign-off against the zoning
//               code, recording at the county. Administrative, a month to three,
//               and it is approved if it meets the code and refused if it does
//               not — there is no hearing to win or lose.
//   MAJOR       five lots or more: a subdivision. Preliminary and final plat in
//               front of the board, the plat process the farm tracts go through
//               (landdev.ts: its fees, its months, its odds).
//
// The code a split is checked against (SPLIT_RULES, by district):
//
//   FRONTAGE    every lot abuts a public street for at least the district's
//               minimum lot width, measured on the lot lines that lie on the
//               street (lotsplitGeom.ts). A lot with none is landlocked and
//               refused — unless it is a flag lot: an access easement recorded
//               over a neighbouring lot of the same split, at least 20 ft wide
//               (IFC 503.2.1, the fire apparatus access minimum, the width most
//               codes require of a flag lot's pole). The strip cannot be built
//               on, so the burdened lot loses that much of its envelope, and
//               the market prices it so.
//   AREA, WIDTH the district's minimum lot area and lot width.
//   NO SLIVERS  depth no more than DEPTH_RATIO times width, nor width that many
//               times depth.
//   THE BUILDING a line through a building is refused. The lot that keeps the
//               building must still hold it: its FAR, its coverage (proforma.ts
//               MAX_COVERAGE, the engine's own envelope) and the side yard on
//               the new line. A split may not create a non-conformity or worsen
//               one, so a building that already overruns its lot cannot shed
//               land at all. Leases, condition and the building stay on that
//               lot, which keeps the parent's BBL (the remainder parcel).
//   THE LENDER  a mortgaged deed needs the lender's consent and a partial
//               release (BANKING.md): land paper splits across the lots by
//               value and the lender wants the note back inside its LTV; on a
//               building's loan the new lots are released for a release price
//               of 115% of their share (facility.ts RELEASE_PREMIUM) and the
//               loan stays on the building.
//
// THE NEW DEEDS ARE PRICED BY THE ENGINE'S OWN PATHS: a vacant lot by the land
// read (value.ts landValue) on its own area, frontage and depth, the building's
// lot by ownedHoldingValue. Nothing here sets a price. A split creates value
// only where the pieces are worth more apart — usually excess land beside a
// building, which the whole parcel's appraisal does not carry (the income value
// of the building does not grow with the dirt it does not use) — and destroys
// it where small lots cannot carry what one big lot could.
//
// The recipe (types.ts SplitRecord) is stored in the save; `materializeSplits`
// regenerates the lots from it alone on every load, like the plats.
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { GameState, Holding, Loan, SplitRecord } from "./types";
import { cloneState, logBooks, logPrincipal } from "./types";
import { resolveRec, ownedHoldingValue, initialCondition } from "./value";
import { SPLIT_RULES, splitRule, MINOR_FIXED, MINOR_PER_LOT, CORNER_K, DEMAND_GAMMA, coverageMax, type SplitZoneRule } from "./lotcode";
export { SPLIT_RULES, splitRule, MINOR_FIXED, MINOR_PER_LOT, coverageMax, type SplitZoneRule };
import { recordPropertyEvent } from "./history";
import { fundCashNeed } from "./credit";
import { prepayPenalty } from "./debt";
import { recastPayment } from "./amortize";
import { RELEASE_PREMIUM } from "./facility";
import { hash01 } from "./competitorTraits";
import { money } from "./money";
import { bumpTable } from "./tableVersion";
import { type SplitCut } from "./lotsplitGeom";


/** A flag lot's access easement: 20 ft, the fire apparatus access width (IFC 503.2.1) [S]. */
export const EASE_FT = 20;
/** Staff review and recording: one to three months [S]. */
export const MINOR_MONTHS = (lots: number) => Math.round(Math.min(3, Math.max(1, 1 + ((lots - 1) * 2) / 3)));
/** The most lots a minor (administrative) split may make; five and up is a subdivision [S, most US codes: 2-4]. */
export const MINOR_MAX_LOTS = 4;
/** The lender's counsel reviewing the partial release and the consent: $1.5-5k [S]. */
export const LENDER_CONSENT_FEE = 2_500;
/** The most lots one split may cut (beyond this it is a plat with streets, the land desk's business). */
export const MAX_SPLIT_LOTS = 24;


// ---------------------------------------------------------------- the plan
export interface SplitPlan {
  cuts: SplitCut[];
  /** landlocked lot index -> the lot its access easement runs over */
  ease?: Record<number, number>;
  debt?: "allocate" | "release";
}

export interface SplitPieceRow {
  i: number;
  /** the lot that keeps the parent's BBL (and its building) */
  keep: boolean;
  a: number; f: number; w: number; d: number; corner: boolean;
  access: "street" | "easement" | "none";
  /** the lot this one's easement runs over */
  over?: number;
  /** a neighbour an easement could run over, for the desk to offer */
  could?: number;
  /** sf of this lot under another lot's easement */
  burden: number;
  areaOk: boolean; frontOk: boolean; ratioOk: boolean;
  bldg: boolean;
  /** the building's lot: does it still conform, and if not, which rule fails */
  conform: { ok: boolean; why: string[]; far: number; farMax: number; cov: number; covMax: number; yardFt: number; yardMin: number } | null;
  value: number;
  ok: boolean;
  why: string[];
}

export interface SplitQuote {
  ok: boolean;
  /** why it cannot be filed, in the order a planner would say it */
  why: string[];
  zone: string;
  rule: SplitZoneRule;
  kind: "minor" | "major";
  lots: number;
  cost: number;
  months: number;
  odds: number;
  pieces: SplitPieceRow[];
  parentValue: number;
  piecesValue: number;
  /** the pieces apart less the whole, before costs */
  gain: number;
  debt: null | {
    lender: string; balance: number; maxLTV: number;
    mode: "allocate" | "release"; modes: ("allocate" | "release")[];
    /** principal the lender wants back at recording, and the prepayment charge on it */
    paydown: number; penalty: number; fee: number;
    /** the loan each lot carries after recording */
    after: number[];
  };
  /** at filing: the fees; at recording: the release payment */
  cashNow: number;
  cashAtRecording: number;
}


/** "16 Cortland St" -> "16A Cortland St"; an address without a number gets "lot B". */
function pieceAddress(addr: string, k: number): string {
  const L = String.fromCharCode(65 + Math.min(25, k));
  const m = /^(\d+)([A-Z]?)(\s.*)$/.exec(addr);
  return m ? `${m[1]}${m[2]}${L}${m[3]}` : `${addr} lot ${L}`;
}

/**
 * THE LOTS OF ONE SPLIT AS PARCEL RECORDS, from the parent's record and the
 * recipe — the one place a split lot is made, for the quote and for the table.
 * The lot that keeps the parent's BBL keeps everything that stands on it; the
 * others are vacant land with the parent's district, texture and address.
 * An easement strip comes off its lot's envelope (nothing can be built on it).
 */
export function splitRecords(P: ParcelRecord, sp: Pick<SplitRecord, "id" | "parent" | "pieces">): ParcelRecord[] {
  let k = 0;
  return sp.pieces.map((pc) => {
    const keep = pc.bbl === sp.parent;
    const share = pc.a / Math.max(1, P.lotArea);
    const land = Math.round(P.assessedLand * share);
    // AN EASEMENT STRIP IS THE NEIGHBOUR'S DRIVEWAY. The fee owner keeps title
    // and nothing else of use: nothing can be built on it, parked on it or
    // fenced across it. Appraisers value land under an exclusive access
    // easement at 75-100% off its fee value [S, appraisal practice for
    // easement takings]; the record carries the land its owner can use, so the
    // land read, the envelope and the lender all see the lot as it is.
    const usable = Math.max(1, pc.a - (pc.burden ?? 0));
    // A LOT CUT OFF A CORNER IS NOT ON THE CORNER. The city put the corner into
    // the parent's hedonic premium (citygen build.mjs: x1.18 in locPremium) and
    // through it into the demand score (raised to DEMAND_GAMMA 1.05); a lot
    // that lost the corner loses exactly that, and nothing else.
    const lost = P.corner && !pc.corner;
    const base: ParcelRecord = {
      ...P,
      ...(lost ? {
        locPremium: P.locPremium !== undefined ? +(P.locPremium / CORNER_K).toFixed(4) : undefined,
        demandScore: Math.max(4, Math.min(100, Math.round(P.demandScore * Math.pow(CORNER_K, -DEMAND_GAMMA)))),
      } : {}),
      bbl: pc.bbl, lotArea: usable, lotFront: pc.f, lotDepth: pc.d, centroid: pc.c, corner: !!pc.corner,
      assessedLand: land,
      assessedTotal: keep ? Math.max(land, Math.round(P.assessedTotal - P.assessedLand * (1 - share))) : land,
      landPsfHistory: [...(P.landPsfHistory ?? [P.landPsf])], imputed: [...(P.imputed ?? [])],
      split: sp.id,
      ...(pc.over ? { flag: true } : { flag: undefined }),
    };
    if (keep) return base;
    k++;
    return {
      ...base, address: pieceAddress(P.address, k), lot: `${P.lot}-${k}`,
      bldgClass: "V1", class: "land" as const, mix: undefined, suites: undefined, product: undefined,
      bldgArea: 0, floors: 0, yearBuilt: 0, unitsRes: 0, buildSpec: undefined, centre: undefined,
    };
  });
}

/** A vacant lot's deed, cut from its parent's: the same vehicle and holding period, no building, no tenants. */
function landHolding(parentH: Holding, rec: ParcelRecord, basis: number): Holding {
  return {
    bbl: rec.bbl, boughtM: parentH.boughtM, costBasis: basis, assessed: 0, loan: null,
    condition: initialCondition(rec), tenants: [], cfHistory: [],
    ...(parentH.fundOwned ? { fundOwned: true } : {}),
  };
}

/**
 * Put every recorded split's lots into the parcel table and the BBL list, in
 * place, in the order they were recorded (a lot cut again later is cut from
 * its own record). Idempotent and a pure function of the state: the page, the
 * worker and a harness arrive at the same table. Returns the BBLs it added.
 */
export function materializeSplits(s: GameState, parcels: ParcelTable, bbls?: string[]): string[] {
  const added: string[] = [];
  for (const sp of s.splits ?? []) materializeSplit(parcels, bbls, sp, added);
  return added;
}
/** One recorded split's lots into the table (sim.ts restoreCuts replays them in the order they were cut). */
export function materializeSplit(parcels: ParcelTable, bbls: string[] | undefined, sp: SplitRecord | undefined, added: string[] = []): string[] {
  if (!sp?.done) return added;
  const P = parcels[sp.parent];
  if (!P || (P.split ?? 0) >= sp.id) return added;
  bumpTable(parcels);
  for (const r of splitRecords(P, sp)) {
    if (r.bbl !== sp.parent && parcels[r.bbl]) continue;
    const isNew = !parcels[r.bbl];
    parcels[r.bbl] = r;
    if (isNew) { bbls?.push(r.bbl); added.push(r.bbl); }
  }
  return added;
}

function lapse(s: GameState, sp: SplitRecord, why: string, player: boolean) {
  sp.lapsed = why;
  if (player) s.news.unshift({ q: s.month, kind: "warn", text: `The split at ${sp.parent} lapsed: ${why}. The fees are spent.` });
}

/** Record one split whose sign-off has come: the deeds, the money, the loan. */
function recordSplit(s: GameState, parcels: ParcelTable, bbls: string[], sp: SplitRecord) {
  const h = s.holdings[sp.parent];
  const P = parcels[sp.parent];
  if (!h || !P) { lapse(s, sp, "the deed changed hands before it was recorded", !sp.by); return; }
  if (s.developments[sp.parent] || h.sale || s.facility?.bbls.includes(sp.parent)) { lapse(s, sp, "the lot was committed elsewhere before recording", true); return; }
  const before = resolveRec(parcels, s, sp.parent);
  const builtNow = !!before && before.class !== "land" && before.bldgArea > 0;
  if (!sp.pieces.some((p) => p.bbl === sp.parent) || (builtNow && sp.pieces.length < 2)) { lapse(s, sp, "the recipe no longer fits the deed", true); return; }
  // THE RELEASE PAYMENT is due at recording, in cash
  const L = h.loan;
  sp.done = true;
  (s.cutOrder ??= []).push("s:" + sp.id);
  materializeSplits(s, parcels, bbls);
  const recs = sp.pieces.map((p) => parcels[p.bbl]);
  for (const r of recs) if (r.bbl !== sp.parent) s.holdings[r.bbl] = landHolding(h, r, 0);
  // the land's other per-deed facts follow the dirt
  for (const r of recs) {
    if (r.bbl === sp.parent) continue;
    if (s.landAdj?.[sp.parent] !== undefined) s.landAdj[r.bbl] = s.landAdj[sp.parent];
    if (s.zoneUse?.[sp.parent] !== undefined) s.zoneUse = { ...s.zoneUse, [r.bbl]: s.zoneUse[sp.parent] };
  }
  const vals = recs.map((r) => Math.max(0, ownedHoldingValue(s, parcels, s.holdings[r.bbl])));
  const V = vals.reduce((a, b) => a + b, 0) || 1;
  // COST AND ASSESSMENT BY RELATIVE VALUE (the relative-sales-value method, ASC 970-360-30-1): no
  // dollar of basis appears or disappears, and the assessor's roll carries each new deed its share
  const basis0 = h.costBasis, assessed0 = h.assessed ?? 0;
  let bLeft = basis0, aLeft = assessed0;
  const keepI = sp.pieces.findIndex((p) => p.bbl === sp.parent);
  recs.forEach((r, i) => {
    if (i === keepI) return;
    const sh = vals[i] / V;
    const hb = s.holdings[r.bbl];
    hb.costBasis = Math.round(basis0 * sh); bLeft -= hb.costBasis;
    hb.assessed = Math.round(assessed0 * sh); aLeft -= hb.assessed;
  });
  h.costBasis = bLeft; h.assessed = aLeft;
  if (L && L.balance > 0) {
    const mode = sp.debt?.mode ?? (L.minDSCR > 0 ? "release" : "allocate");
    const B = L.balance;
    let paydown = 0;
    if (mode === "allocate") paydown = Math.max(0, Math.round(B - L.maxLTV * V));
    else {
      for (let i = 0; i < recs.length; i++) if (i !== keepI) paydown += Math.round(RELEASE_PREMIUM * B * (vals[i] / V));
      paydown = Math.min(B, paydown);
      paydown = Math.min(B, paydown + Math.max(0, Math.round(B - paydown - L.maxLTV * vals[keepI])));
    }
    const penalty = paydown > 0 ? prepayPenalty({ ...L, balance: paydown }, s.month, s.econ) : 0;
    if (paydown > 0) {
      const due = Math.round(paydown + penalty);
      // could not pay: the caller puts the deed back as it was and the split lapses
      if (Math.floor(s.cash) < due) throw new SplitShort(due);
      if (fundCashNeed(s, parcels, due, { allowLoc: false }) < due) throw new SplitShort(due);
      // the release paydown is principal; only the prepayment is a cost
      logPrincipal(s, -paydown, sp.parent);
      if (due - paydown > 0) logBooks(s, "debtSvc", due - paydown, sp.parent);
      L.balance = Math.max(0, L.balance - paydown);
    }
    if (mode === "allocate" && L.balance > 0) {
      // THE NOTE FOLLOWS THE LAND INTO ITS LOTS, by value, to the dollar (as an A&D note follows a plat's lots)
      const Bk = L.balance, Pk = L.principal;
      let leftB = Bk, leftP = Pk;
      recs.forEach((r, i) => {
        if (i === keepI) return;
        const sh = vals[i] / V;
        const b = Math.round(Bk * sh), pr = Math.round(Pk * sh);
        leftB -= b; leftP -= pr;
        const ln: Loan = { ...L, balance: b, principal: pr, monthlyPmt: Math.round(L.monthlyPmt * sh * 100) / 100 };
        recastPayment(ln, s.month);
        s.holdings[r.bbl].loan = ln;
      });
      L.balance = leftB; L.principal = leftP;
    }
    if (L.balance <= 0.5) h.loan = null;
    else recastPayment(L, s.month);
  }
  const kids = recs.filter((r) => r.bbl !== sp.parent);
  recordPropertyEvent(s, sp.parent, { kind: "planning", amount: sp.cost, outcome: `Split into ${recs.length} lots` });
  for (const r of kids) recordPropertyEvent(s, r.bbl, { kind: "planning", amount: 0, outcome: `Split from ${P.address}` });
  if (!sp.by) {
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `Recorded: ${P.address} is ${recs.length} lots — ${kids.map((r) => r.address).join(", ")} are deeds of their own. `
        + `Each is worth ${vals.map((v) => money(v)).join(" / ")} on today's market.`,
    });
  }
}
class SplitShort extends Error { constructor(public due: number) { super("short"); } }

/** The month's splits: the staff's sign-offs and the board's decisions. */
export function tickSplits(s: GameState, parcels: ParcelTable, bbls: string[]) {
  if (!s.splits?.length) return;
  for (const sp of s.splits) {
    if (sp.done || sp.lapsed || s.month < sp.doneM) continue;
    if (sp.kind === "major") {
      // the board: a draw keyed to the application, not the month's random stream
      const yes = hash01(`split:${s.seed}:${sp.parent}:${sp.id}`) < sp.odds;
      recordPropertyEvent(s, sp.parent, { kind: "planning", amount: sp.cost, outcome: yes ? `Subdivision approved: ${sp.pieces.length} lots` : "Subdivision refused" });
      if (!yes) {
        s.splitRefusedM = { ...(s.splitRefusedM ?? {}), [sp.parent]: s.month };
        lapse(s, sp, "the board refused the plat", !sp.by);
        continue;
      }
    }
    if (sp.by) { recordRivalSplit(s, parcels, bbls, sp); continue; }
    // all or nothing: a release the cash cannot pay leaves the deed as it was
    const snap = { holdings: s.holdings, parcelsBefore: sp.pieces.map((p) => [p.bbl, parcels[p.bbl]] as const), bbN: bbls.length };
    const hClone = cloneState(s.holdings);
    try {
      s.holdings = hClone;
      recordSplit(s, parcels, bbls, sp);
    } catch (e) {
      if (!(e instanceof SplitShort)) throw e;
      s.holdings = snap.holdings;
      for (const [b, r] of snap.parcelsBefore) { if (r) parcels[b] = r; else delete parcels[b]; }
      bumpTable(parcels);
      bbls.length = snap.bbN;
      sp.done = undefined;
      if (s.cutOrder?.at(-1) === "s:" + sp.id) s.cutOrder.pop();
      lapse(s, sp, `the lender's release payment of ${money(e.due)} was not there in cash`, true);
    }
  }
}

// ---------------------------------------------------------------- the street
function recordRivalSplit(s: GameState, parcels: ParcelTable, bbls: string[], sp: SplitRecord) {
  const r = s.rivals?.find((x) => x.id === sp.by);
  if (!r || !r.bbls.includes(sp.parent) || s.cityLoans?.[sp.parent] || s.developments[sp.parent] || s.listings.some((l) => l.bbl === sp.parent)) { lapse(s, sp, "the deed changed before recording", false); return; }
  sp.done = true;
  (s.cutOrder ??= []).push("s:" + sp.id);
  materializeSplits(s, parcels, bbls);
  for (const p of sp.pieces) if (p.bbl !== sp.parent && !r.bbls.includes(p.bbl)) r.bbls.push(p.bbl);
  recordPropertyEvent(s, sp.parent, { kind: "planning", amount: sp.cost, outcome: `Split into ${sp.pieces.length} lots by ${r.name}` });
}
