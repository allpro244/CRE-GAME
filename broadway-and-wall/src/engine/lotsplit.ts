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
import type { GameState, Holding, Loan, SplitRecord, BuiltClass } from "./types";
import { monthLabel, cloneState, logBooks } from "./types";
import { resolveRec, ownedHoldingValue, ownedHoldingValueFromRec, initialCondition, landValue } from "./value";
import { farMaxFor, MAX_COVERAGE } from "./proforma";
import { recordPropertyEvent } from "./history";
import { spendable, fundAndBook, fundCashNeed } from "./credit";
import { prepayPenalty, loanLender } from "./debt";
import { recastPayment } from "./amortize";
import { consentFor } from "./vehicles";
import { RELEASE_PREMIUM } from "./facility";
import { ENTITLE_FIXED, ENTITLE_PER_LOT, ENTITLE_MONTHS, entitleOdds, REFILE_BAR_M } from "./landdev";
import { hash01 } from "./competitorTraits";
import { money } from "./money";
import { bumpTable } from "./tableVersion";
import { measurePieces, type SiteGeo, type SplitCut, type PieceGeo } from "./lotsplitGeom";

// ---------------------------------------------------------------- the code
export interface SplitZoneRule {
  /** minimum lot area, sf */
  minSf: number;
  /** minimum lot width at the street, ft */
  minFt: number;
  /** the side yard a building keeps from a new lot line, ft */
  sideFt: number;
  /** a lot no deeper than this many times its width (nor wider than this many times its depth) */
  ratio: number;
  /** what kind of district, for the desk */
  family: string;
  src: string;
}
/**
 * MINIMUM LOTS BY DISTRICT [S]. Typical US code values for districts of the
 * character this engine gives each zone (its FAR, its use):
 *   C-4..C-8  high-density downtown commercial (FAR 8-30): no lot minimum in
 *             most downtown codes beyond the residential one — NYC ZR 23-32,
 *             1,700 sf and 18 ft for any residence in R6-R10 and their
 *             commercial equivalents; zero side yard (ZR 33-25, none required).
 *   C-1, C-2  main-street and general commercial (FAR 1-5): 2,500 sf and 25 ft,
 *             the 25-ft storefront lot of most Midwestern downtown districts.
 *   C-N       a neighbourhood shopping district: 10,000 sf and 75 ft, 10 ft side
 *             yards (typical suburban B-1 / C-N districts run 7,500-20,000 sf).
 *   R6, R8    dense residential (FAR 6-11): 1,700 sf and 18 ft, no side yard for
 *             attached buildings (ZR 23-32, 23-46).
 *   R4        the old town's residential, houses and small flats: 3,800 sf and
 *             40 ft with 5-ft side yards, NYC's rule for detached houses in R4
 *             (ZR 23-32, 23-461).
 *   R-1       suburban single-family: 7,500 sf and 60 ft, 7.5-ft side yards.
 *   R-2       two-family: 5,000 sf on 40 ft, 5-ft side yards (the plat desk's
 *             own SPLIT_MIN, citygen region/platdesign.mjs).
 *   M1        light industrial: 20,000 sf and 100 ft, 10-ft side yards (typical
 *             M-1 districts, 10,000-40,000 sf).
 *   I-1       an industrial park: an acre and 150 ft (landdev.ts isIndustrialLot,
 *             NAIOP business-park lots of two acres and up).
 * DEPTH RATIO: suburban subdivision regulations commonly cap depth at three
 * times width; urban districts are platted in 20x100 and 25x100 lots (4-5:1),
 * so they cap at five.
 */
export const SPLIT_RULES: Record<string, SplitZoneRule> = {
  "C-4": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-5": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-6": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-8": { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, family: "downtown", src: "NYC ZR 23-32 / 33-25" },
  "C-1": { minSf: 2_500, minFt: 25, sideFt: 0, ratio: 5, family: "main street", src: "typical downtown business district, 25-ft lot" },
  "C-2": { minSf: 2_500, minFt: 25, sideFt: 0, ratio: 5, family: "main street", src: "typical downtown business district, 25-ft lot" },
  "C-N": { minSf: 10_000, minFt: 75, sideFt: 10, ratio: 3, family: "neighbourhood centre", src: "typical B-1 / C-N district" },
  R6: { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, family: "dense residential", src: "NYC ZR 23-32 / 23-46" },
  R8: { minSf: 1_700, minFt: 18, sideFt: 0, ratio: 5, family: "dense residential", src: "NYC ZR 23-32 / 23-46" },
  R4: { minSf: 3_800, minFt: 40, sideFt: 5, ratio: 5, family: "residential", src: "NYC ZR 23-32 / 23-461, detached" },
  "R-1": { minSf: 7_500, minFt: 60, sideFt: 7.5, ratio: 3, family: "single-family", src: "typical suburban R-1" },
  "R-2": { minSf: 5_000, minFt: 40, sideFt: 5, ratio: 3, family: "two-family", src: "typical R-2 (platdesign SPLIT_MIN)" },
  M1: { minSf: 20_000, minFt: 100, sideFt: 10, ratio: 4, family: "industrial", src: "typical M-1" },
  "I-1": { minSf: 43_560, minFt: 150, sideFt: 10, ratio: 4, family: "industrial park", src: "NAIOP park lots; landdev isIndustrialLot" },
};
/** A district this table does not name: a middling suburban rule [S, typical]. */
const DEFAULT_RULE: SplitZoneRule = { minSf: 5_000, minFt: 50, sideFt: 5, ratio: 4, family: "other", src: "typical" };
export const splitRule = (zone: string): SplitZoneRule => SPLIT_RULES[zone] ?? DEFAULT_RULE;

/** A flag lot's access easement: 20 ft, the fire apparatus access width (IFC 503.2.1) [S]. */
export const EASE_FT = 20;
/**
 * WHAT A MINOR SPLIT COSTS: a boundary survey and the new legal descriptions
 * ($2-5k on a town lot), title and counsel ($1.5-4k), the planning
 * department's application fee and county recording ($0.5-2k) [S, typical
 * 2020s fee schedules and survey quotes]: about $9k for two lots, $14k for four,
 * carried by the construction-cost index.
 */
export const MINOR_FIXED = 4_000;
export const MINOR_PER_LOT = 2_500;
/** Staff review and recording: one to three months [S]. */
export const MINOR_MONTHS = (lots: number) => Math.round(Math.min(3, Math.max(1, 1 + ((lots - 1) * 2) / 3)));
/** The most lots a minor (administrative) split may make; five and up is a subdivision [S, most US codes: 2-4]. */
export const MINOR_MAX_LOTS = 4;
/** The lender's counsel reviewing the partial release and the consent: $1.5-5k [S]. */
export const LENDER_CONSENT_FEE = 2_500;
/** The most lots one split may cut (beyond this it is a plat with streets, the land desk's business). */
export const MAX_SPLIT_LOTS = 24;

const first8 = (n: number) => String(8e9 + n);

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

/** Can this deed be split at all, and why not (before any line is drawn). */
export function splittable(s: GameState, parcels: ParcelTable, bbl: string): string | null {
  const raw = parcels[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const h = s.holdings[bbl];
  if (!raw || !rec) return "There is no parcel there.";
  if (!h) return "You have to own the lot to split it.";
  if (rec.ag || raw.tract) return "A farm tract is subdivided by plat, on the land desk: streets, a rezoning and the board.";
  if (rec.zoneDist === "OS" || rec.hoa) return "Common land of a homeowners' association is not for dividing.";
  if (s.platted?.[bbl]) return "This tract is already cut into lots.";
  if (s.merged?.[bbl]) return "This deed is folded into an assemblage; its land is the site's now.";
  if (Object.values(s.merged ?? {}).includes(bbl)) return "This is an assembled site of several deeds. Its zoning lot is the whole of it; split it before assembling, not after.";
  if (!(rec.lotArea > 0)) return "There is no land in this deed to divide.";
  if (s.landmarks?.[bbl] !== undefined || h.landmarked) return "The lot is landmarked: the commission will not let the site be divided.";
  if (s.developments[bbl]) return "Construction is under way. Split before you break ground or after delivery.";
  if (h.sale) return "It is listed for sale. Take it off the market first.";
  if (s.groundLeases?.[bbl] || h.groundLeased || h.groundRentOut) return "It is under a ground lease: the lessee's leasehold covers the whole lot.";
  if (s.facility?.bbls.includes(bbl)) return "It is pledged to your facility. Release it from the pool first — the pool lender's lien covers the whole deed.";
  if ((h.mezz?.balance ?? 0) > 0) return "The mezzanine lender holds a pledge of the whole deed. Retire the mezz first.";
  { const why = consentFor(s, h, "assemble"); if (why) return why; }
  if (s.homes?.units?.[bbl]) return "A house is going up or sold on this lot.";
  if (s.entitlementApps?.[bbl] || s.varianceApps?.[bbl]) return "An application is already in front of the board for this lot.";
  if ((s.splits ?? []).some((x) => x.parent === bbl && !x.done && !x.lapsed)) return "A split of this lot is already filed.";
  const ref = s.splitRefusedM?.[bbl];
  if (ref !== undefined && s.month - ref < REFILE_BAR_M) return `The board refused a subdivision here ${monthLabel(ref)}; a similar plat cannot come back before ${monthLabel(ref + REFILE_BAR_M)}.`;
  return null;
}

/** The strictest new-building coverage of the uses in a building (proforma.ts MAX_COVERAGE). */
function coverageMax(rec: ParcelRecord): number {
  if (rec.mix) {
    let c = 1;
    for (const [k, v] of Object.entries(rec.mix)) if ((v ?? 0) > 0.03) c = Math.min(c, MAX_COVERAGE[k as BuiltClass] ?? 1);
    return c;
  }
  return MAX_COVERAGE[rec.class as BuiltClass] ?? 1;
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
    const base: ParcelRecord = {
      ...P,
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

/** A building's footprint where the city drew none (a building put up in play): its plate, centred, the lot's shape. */
function syntheticFootprint(ring: [number, number][], cov: number): [number, number][] {
  const n = ring.length;
  const cx = ring.reduce((t, p) => t + p[0], 0) / n, cy = ring.reduce((t, p) => t + p[1], 0) / n;
  const k = Math.sqrt(Math.min(1, Math.max(0.05, cov)));
  return ring.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k] as [number, number]);
}

/**
 * WHAT THIS SPLIT WOULD BE: the lots, each against the code, the building's lot
 * against its envelope, what each lot is worth to the engine, the process, its
 * cost and months, and the lender's terms. `geo` is the site as the city drew
 * it (lotsplitGeom.ts siteGeometry); the lots are measured from it here.
 */
export function splitQuote(s: GameState, parcels: ParcelTable, bbl: string, geo: SiteGeo, plan: SplitPlan): SplitQuote {
  const rec = resolveRec(parcels, s, bbl);
  const P = parcels[bbl];
  const zone = rec?.zoneDist ?? "";
  const rule = splitRule(zone);
  const why: string[] = [];
  const empty: SplitQuote = { ok: false, why, zone, rule, kind: "minor", lots: 0, cost: 0, months: 0, odds: 1, pieces: [], parentValue: 0, piecesValue: 0, gain: 0, debt: null, cashNow: 0, cashAtRecording: 0 };
  const deny = splittable(s, parcels, bbl);
  if (deny) { why.push(deny); return empty; }
  if (!rec || !P) return empty;
  const h = s.holdings[bbl];
  const built = rec.class !== "land" && rec.bldgArea > 0;
  // what stands on the lot today: the city's drawing of it, or — for a building
  // put up in play, which the city did not draw — its plate on the lot's shape
  const cov = built ? rec.bldgArea / Math.max(1, rec.floors) / rec.lotArea : 0;
  const site: SiteGeo = !built ? { ...geo, footprints: [] }
    : s.built?.[bbl] || !geo.footprints.length ? { ...geo, footprints: [syntheticFootprint(geo.ring, cov)] } : geo;
  const m = measurePieces(site, plan.cuts);
  const n = m.pieces.length;
  empty.lots = n;
  if (n < 2) { why.push("Draw a line across the lot."); return empty; }
  if (n > MAX_SPLIT_LOTS) { why.push(`${n} lots is a subdivision with streets: plat it.`); return empty; }
  if (m.crosses) why.push("The line runs through the building.");
  if (m.straddles) why.push("The building stands on both sides of a line.");

  // AREAS: the record's lot area, shared by geometry (the drawn ring is the record's to within 1%)
  const shares = m.pieces.map((p) => p.share);
  const tot = shares.reduce((a, b) => a + b, 0) || 1;
  let left = Math.round(rec.lotArea);
  const areas = shares.map((sh, i) => { const a = i === n - 1 ? left : Math.round((rec.lotArea * sh) / tot); left -= a; return a; });
  const keepI = built ? Math.max(0, m.pieces.findIndex((p) => p.bldg)) : areas.indexOf(Math.max(...areas));

  // ACCESS: a lot on a street, or a flag lot over a neighbour that is on one
  const rows: SplitPieceRow[] = m.pieces.map((p: PieceGeo, i) => {
    const a = areas[i], f = Math.round(p.frontFt);
    return {
      i, keep: i === keepI, a, f, w: Math.round(p.widthFt), d: f > 0 ? Math.round(a / f) : Math.round(p.depthFt), corner: p.streets >= 2,
      access: f >= 1 ? "street" : "none", burden: 0,
      areaOk: a >= rule.minSf, frontOk: f >= rule.minFt, ratioOk: Math.max(p.depthFt / Math.max(1, p.widthFt), p.widthFt / Math.max(1, p.depthFt)) <= rule.ratio,
      bldg: p.bldg, conform: null, value: 0, ok: true, why: [],
    };
  });
  for (const r of rows) {
    if (r.access === "street") continue;
    const nbr = m.pieces[r.i].touches.filter((t) => t.ft >= EASE_FT && rows[t.j].access === "street").sort((x, y) => y.ft - x.ft);
    r.could = nbr[0]?.j;
    const want = plan.ease?.[r.i];
    if (want !== undefined && nbr.some((t) => t.j === want)) {
      r.access = "easement"; r.over = want;
      // the strip runs from the street to the flag lot, across the burdened lot's depth
      const host = rows[want];
      host.burden += Math.min(host.a * 0.5, Math.round(EASE_FT * m.pieces[want].depthFt));
    }
  }
  for (const r of rows) {
    if (r.access === "none") r.why.push(r.could !== undefined ? `Landlocked: record an access easement over lot ${r.could + 1}` : "Landlocked: no street and no lot of yours to reach one over");
    if (!r.areaOk) r.why.push(`${r.a.toLocaleString()} sf under the ${rule.minSf.toLocaleString()} sf minimum`);
    if (r.access === "street" && !r.frontOk) r.why.push(`${r.f} ft of frontage under the ${rule.minFt} ft minimum`);
    if (!r.ratioOk) r.why.push(`a sliver: past ${rule.ratio}:1`);
  }

  // THE BUILDING'S LOT, against its envelope on its new area
  if (built && !m.crosses && !m.straddles) {
    const r = rows[keepI];
    // on the land the lot can use: an easement strip carries no building (splitRecords)
    const usable = Math.max(1, r.a - r.burden);
    const farMax = farMaxFor(rec);
    const far = rec.bldgArea / usable;
    const covMax = coverageMax(rec);
    const covNow = rec.bldgArea / Math.max(1, rec.floors) / usable;
    const yardFt = m.pieces[keepI].yardFt;
    const cw: string[] = [];
    if (far > farMax * 1.005) cw.push(`FAR ${far.toFixed(2)} over the ${farMax.toFixed(2)} allowed`);
    if (covNow > covMax + 0.005) cw.push(`coverage ${Math.round(covNow * 100)}% over the ${Math.round(covMax * 100)}% allowed`);
    if (yardFt + 0.05 < rule.sideFt) cw.push(`${yardFt.toFixed(1)} ft from the new line; the side yard is ${rule.sideFt} ft`);
    r.conform = { ok: !cw.length, why: cw, far, farMax, cov: covNow, covMax, yardFt, yardMin: rule.sideFt };
    for (const w of cw) r.why.push(`The building would be non-conforming: ${w}`);
  }
  for (const r of rows) r.ok = !r.why.length;

  // THE PROCESS
  const kind: "minor" | "major" = n <= MINOR_MAX_LOTS ? "minor" : "major";
  const ci = s.econ.costIdx;
  const cost = Math.round((kind === "minor" ? MINOR_FIXED + MINOR_PER_LOT * n : ENTITLE_FIXED + ENTITLE_PER_LOT * n) * ci);
  const months = kind === "minor" ? MINOR_MONTHS(n) : ENTITLE_MONTHS(n);
  // a town lot is served land: the plat process's odds at the edge of service (landdev.ts entitleOdds)
  const odds = kind === "minor" ? 1 : +entitleOdds(0).toFixed(2);

  // WHAT EACH LOT IS WORTH, on the engine's own paths, as the table would hold it
  const draft: Pick<SplitRecord, "id" | "parent" | "pieces"> = {
    id: (s.splitSeq ?? 0) + 1, parent: bbl,
    pieces: rows.map((r, i) => ({
      bbl: r.keep ? bbl : first8((s.splitSeq ?? 0) + 1 + i), a: r.a, f: r.access === "easement" ? EASE_FT : r.f, d: r.d, c: m.pieces[i].c, corner: r.corner,
      ...(r.over !== undefined ? { over: "x" } : {}), ...(r.burden ? { burden: r.burden } : {}),
    })),
  };
  const recs = splitRecords(P, draft);
  const tmpParcels = Object.create(parcels) as ParcelTable;
  for (const r of recs) tmpParcels[r.bbl] = r;
  const tmpHold: Record<string, Holding> = { ...s.holdings };
  for (const r of recs) if (r.bbl !== bbl) tmpHold[r.bbl] = landHolding(h, r, 0);
  const sT = { ...s, holdings: tmpHold } as GameState;
  const parentValue = Math.round(ownedHoldingValue(s, parcels, h));
  rows.forEach((r, i) => {
    const rr = resolveRec(tmpParcels, sT, recs[i].bbl);
    r.value = rr ? Math.round(ownedHoldingValueFromRec(sT, rr, tmpHold[recs[i].bbl])) : 0;
  });
  const piecesValue = rows.reduce((t, r) => t + r.value, 0);

  // THE LENDER
  let debt: SplitQuote["debt"] = null;
  if (h.loan && h.loan.balance > 0) {
    const L = h.loan;
    const B = Math.round(L.balance);
    const V = Math.max(1, piecesValue);
    // land paper (no coverage covenant) can sit across the lots like an A&D note; a building's loan
    // cannot — a vacant lot cannot carry a coverage test — so the new lots are released from it
    const modes: ("allocate" | "release")[] = L.minDSCR > 0 ? ["release"] : ["allocate", "release"];
    const mode = plan.debt && modes.includes(plan.debt) ? plan.debt : modes[0];
    let paydown = 0;
    let after: number[];
    if (mode === "allocate") {
      paydown = Math.max(0, Math.round(B - L.maxLTV * piecesValue));
      after = rows.map((r) => Math.round(((B - paydown) * r.value) / V));
    } else {
      for (const r of rows) if (!r.keep) paydown += Math.round(RELEASE_PREMIUM * B * (r.value / V));
      paydown = Math.min(B, paydown);
      const keepV = rows[keepI].value;
      paydown = Math.min(B, paydown + Math.max(0, Math.round(B - paydown - L.maxLTV * keepV)));
      after = rows.map((r) => (r.keep ? B - paydown : 0));
    }
    const penalty = paydown > 0 ? prepayPenalty({ ...L, balance: paydown }, s.month, s.econ) : 0;
    debt = { lender: L.holder ?? loanLender(L), balance: B, maxLTV: L.maxLTV, mode, modes, paydown, penalty, fee: Math.round(LENDER_CONSENT_FEE * ci), after };
  }
  if (rows.some((r) => !r.ok)) why.push(...rows.filter((r) => !r.ok).map((r) => `Lot ${r.i + 1}: ${r.why[0]}`));
  const cashNow = cost + (debt?.fee ?? 0);
  const cashAtRecording = (debt?.paydown ?? 0) + (debt?.penalty ?? 0);
  if (!why.length) {
    const room = spendable(s, parcels);
    if (room.total < cashNow) why.push(`The filing runs ${money(cashNow)} and you can raise ${money(room.total)}.`);
    else if (cashAtRecording > 0 && Math.floor(s.cash) - cashNow < cashAtRecording) why.push(`The lender wants ${money(cashAtRecording)} at recording for the release, in cash; you will have ${money(Math.max(0, Math.floor(s.cash) - cashNow))}.`);
  }
  return {
    ok: !why.length, why, zone, rule, kind, lots: n, cost, months, odds, pieces: rows,
    parentValue, piecesValue, gain: piecesValue - parentValue, debt, cashNow, cashAtRecording,
  };
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
 * FILE A SPLIT. The fees are paid now (and capitalised into the land, like a
 * plat's); the lots exist once the staff sign off (minor) or the board approves
 * (major), at which point the lender's release payment is due.
 */
export function fileSplit(s: GameState, parcels: ParcelTable, bbl: string, geo: SiteGeo, plan: SplitPlan): { s: GameState; err?: string; msg?: string } {
  const q = splitQuote(s, parcels, bbl, geo, plan);
  if (!q.ok) return { s, err: q.why[0] ?? "That split cannot be filed." };
  const next = cloneState(s);
  const paid = fundAndBook(next, parcels, q.cashNow, "dev", { bbl });
  if (paid < q.cashNow) return { s, err: `Could not raise the ${money(q.cashNow)} filing.` };
  next.holdings[bbl].costBasis += paid;
  // the new deeds' numbers, 8e9 + n, in lot order; the lot with the building keeps the parent's
  let seq = next.splitSeq ?? 0;
  const ids = q.pieces.map((r) => (r.keep ? bbl : first8(++seq)));
  next.splitSeq = seq;
  const m = measurePieces(geo, plan.cuts);
  const rec: SplitRecord = {
    id: (next.splits?.length ?? 0) ? Math.max(...next.splits!.map((x) => x.id)) + 1 : 1,
    parent: bbl, cuts: plan.cuts.map(([p, q2]) => [[p[0], p[1]], [q2[0], q2[1]]]),
    pieces: q.pieces.map((r, i) => ({
      bbl: ids[i], a: r.a, f: r.access === "easement" ? EASE_FT : r.f, d: r.d, c: m.pieces[i].c.map((v) => Math.round(v * 1e6) / 1e6) as [number, number],
      ...(r.corner ? { corner: true } : {}),
      ...(r.over !== undefined ? { over: ids[r.over] } : {}),
      ...(r.burden ? { burden: r.burden } : {}),
    })),
    kind: q.kind, filedM: next.month, doneM: next.month + q.months, cost: q.cost, odds: q.odds,
    ...(q.debt ? { debt: { mode: q.debt.mode } } : {}),
  };
  next.splits = [...(next.splits ?? []), rec];
  const addr = parcels[bbl]?.address ?? bbl;
  next.news.unshift({
    q: next.month, kind: "info",
    text: q.kind === "minor"
      ? `Lot split filed at ${addr}: ${q.lots} lots, ${money(q.cost)} for the survey, the deeds and recording. The planning staff sign off ${monthLabel(rec.doneM)}.`
      : `Subdivision filed at ${addr}: ${q.lots} lots before the board, ${money(q.cost)}. It sits ${monthLabel(rec.doneM)}; plats like it pass about ${Math.round(q.odds * 100)}% of the time.`,
  });
  return { s: next, msg: "Filed." };
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
      logBooks(s, "debtSvc", due, sp.parent);
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
/**
 * A FIRM SPLITS AN OVERSIZED LOT, quietly and rarely: vacant dirt it owns free
 * and clear, cut into equal lots along its frontage, only where the lots apart
 * are worth more than the lot whole by more than the filing costs. The recipe
 * carries `n` instead of cuts drawn by hand; the map draws equal lots
 * (lotsplitGeom.ts equalCuts) and the engine reads the numbers.
 */
export function tickRivalSplits(s: GameState, parcels: ParcelTable) {
  if (s.month % 12 !== 5 || !s.rivals?.length) return;
  const busy = new Set((s.cityJobs ?? []).map((j) => j.bbl));
  const listed = new Set(s.listings.map((l) => l.bbl));
  const pending = new Set((s.splits ?? []).filter((x) => !x.done && !x.lapsed).map((x) => x.parent));
  for (const r of s.rivals) {
    if (r.failedM !== undefined || r.stressMs) continue;
    for (const b of r.bbls) {
      if (busy.has(b) || listed.has(b) || pending.has(b) || s.holdings[b] || s.developments[b] || s.merged?.[b] || s.cityLoans?.[b] || s.platted?.[b]) continue;
      const rec = resolveRec(parcels, s, b);
      const P = parcels[b];
      if (!rec || !P || rec.class !== "land" || rec.bldgArea > 0 || rec.ag || P.tract || rec.hoa || rec.homeLot || !(rec.lotFront! > 0)) continue;
      const rule = splitRule(rec.zoneDist);
      const n = Math.min(MINOR_MAX_LOTS, Math.floor(rec.lotArea / rule.minSf), Math.floor((rec.lotFront ?? 0) / rule.minFt));
      if (n < 2) continue;
      if (Math.max(rec.lotDepth ?? 0, 1) / Math.max(1, (rec.lotFront ?? 0) / n) > rule.ratio) continue;
      const whole = landValue(rec, s.econ);
      const cost = Math.round((MINOR_FIXED + MINOR_PER_LOT * n) * s.econ.costIdx);
      const a = Math.round(rec.lotArea / n), f = Math.round((rec.lotFront ?? 0) / n);
      const piece = { ...rec, lotArea: a, lotFront: f, lotDepth: Math.round(a / Math.max(1, f)), corner: false, bbl: `${b}:probe` };
      const apart = n * landValue(piece, s.econ);
      if (!(apart - whole > 2 * cost) || r.cash < cost) continue;
      r.cash -= cost;
      const seq0 = s.splitSeq ?? 0;
      s.splitSeq = seq0 + n - 1;
      const sp: SplitRecord = {
        id: (s.splits?.length ?? 0) ? Math.max(...s.splits!.map((x) => x.id)) + 1 : 1,
        parent: b, cuts: [], n,
        pieces: Array.from({ length: n }, (_x, i) => ({ bbl: i === 0 ? b : first8(seq0 + i), a: i === n - 1 ? rec.lotArea - a * (n - 1) : a, f, d: Math.round(a / Math.max(1, f)), c: P.centroid })),
        kind: "minor", filedM: s.month, doneM: s.month + MINOR_MONTHS(n), cost, odds: 1, by: r.id,
      };
      s.splits = [...(s.splits ?? []), sp];
      pending.add(b);
      return;   // one a year across the street: a rare move, not a strategy
    }
  }
}

function recordRivalSplit(s: GameState, parcels: ParcelTable, bbls: string[], sp: SplitRecord) {
  const r = s.rivals?.find((x) => x.id === sp.by);
  if (!r || !r.bbls.includes(sp.parent) || s.cityLoans?.[sp.parent] || s.developments[sp.parent] || s.listings.some((l) => l.bbl === sp.parent)) { lapse(s, sp, "the deed changed before recording", false); return; }
  sp.done = true;
  (s.cutOrder ??= []).push("s:" + sp.id);
  materializeSplits(s, parcels, bbls);
  for (const p of sp.pieces) if (p.bbl !== sp.parent && !r.bbls.includes(p.bbl)) r.bbls.push(p.bbl);
  recordPropertyEvent(s, sp.parent, { kind: "planning", amount: sp.cost, outcome: `Split into ${sp.pieces.length} lots by ${r.name}` });
}
