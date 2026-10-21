// THE LAND DEVELOPER'S GAME (the region map, Phase 2).
//
// One farm becomes a street of lots in the steps it takes in life, and most
// land deals die at the second of them:
//
//   BUY        a farm tract, at its farm-use value (value.ts farmUsePsf), from
//              the land market like any other parcel;
//   ENTITLE    ask the board to rezone it from agriculture to a residential
//              district and approve a preliminary plat: counsel, studies,
//              hearings — a year or two and a real chance of refusal, with the
//              carry running the whole time;
//   PLAT       build the horizontal: streets, water, sewer, storm and power,
//              and pay the impact fees, lot by lot; months later the tract is
//              retired into its lots, each a deed of its own;
//   THEN       develop a lot through the ordinary development desk, or list it
//              and sell it to the street.
//
// The lots are a RECIPE (types.ts PlatRecord): the parent, the lot size and
// each lot's area and frontage, regenerated on every load by
// `materializePlats`, so a save stores one record per subdivision and the
// engine's parcel table grows by the lots only once the work is finished.
// The geometry — which street, which corner — is citygen's (region
// platTractLots), drawn from the same tract and lot size.
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { GameState, EntitlementApplication, PlatRecord, Holding } from "./types";
import { monthLabel, cloneState } from "./types";
import { rng } from "./market";
import { resolveRec } from "./value";
import { recordPropertyEvent } from "./history";
import { spendable, fundAndBook } from "./credit";
import { money } from "./money";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- the facts
/**
 * Soft costs of a rezoning and a preliminary and final plat: land-use counsel,
 * traffic and drainage studies, the annexation agreement and the hearings
 * (about $50-150k for a small suburban subdivision), plus the civil
 * engineering of the plat itself at about $2-4k a lot. Approximate industry
 * ranges [S]; carried by the construction-cost index.
 */
const ENTITLE_FIXED = 75_000;
const ENTITLE_PER_LOT = 2_500;
/** A rezoning and plat approval takes one to two years in most US suburbs [S]. */
const ENTITLE_MONTHS = (lots: number) => Math.round(clamp(12 + lots / 25, 12, 24));
/**
 * The odds a board says yes. Near the town's edge, where water and sewer reach
 * and annexation is routine, most applications pass (with conditions); a farm
 * three kilometres out asks the town to extend its mains to it, and many are
 * refused. A shape parameter [K], not a measurement: 0.80 at the edge, 0.45 at
 * 3 km and beyond.
 */
const entitleOdds = (edgeM: number) => clamp(0.80 - 0.35 * clamp(edgeM / 3000, 0, 1), 0.45, 0.80);
/**
 * What the board grants: a two-family residential district. A finished lot of
 * 5,000-10,000 sf carries a house or a two-flat; FAR 0.6 is a 2,500-sf house
 * with a garage on a 5,000-sf lot or a fourplex on 7,500 [S, typical R-2].
 */
const REZONE = { zone: "R-2", far: 0.6 };
/** Streets, stormwater ponds and required open space take 20-30% of a plat's gross land [S]; 25% here. */
export const PLAT_STREET_SHARE = 0.25;
/**
 * HORIZONTAL DEVELOPMENT, per lot: streets, curb, water, sewer, storm and
 * power, about $30-60k for a 60-70 ft lot in the 2020s (Zonda / John Burns
 * finished-lot cost surveys) — $40,000 at 65 ft of frontage, scaled by
 * frontage because pipe and pavement run along it — plus the impact fees, a
 * national average of $13,772 a single-family lot (Duncan Associates, 2019).
 * Carried by the construction-cost index.
 */
const INFRA_PER_FRONT_FT = 40_000 / 65;
const IMPACT_FEE = 13_772;
/** Months to build a plat's infrastructure: about six for a small section, longer for a big one [S]. */
const INFRA_MONTHS = (lots: number) => Math.round(clamp(6 + lots / 30, 6, 18));

export const PLAT_LOT_SIZES = [5_000, 7_500, 10_000] as const;

// ---------------------------------------------------------------- entitlement
/** Can this tract be entitled and platted at all, and why not. */
function plattable(s: GameState, parcels: ParcelTable, bbl: string): { rec: ParcelRecord } | { err: string } {
  const rec = parcels[bbl];
  if (!rec) return { err: "There is no parcel there." };
  if (!rec.ag || !rec.tract) return { err: "Only a whole farm or woodlot tract can be entitled and platted." };
  if (s.platted?.[bbl]) return { err: "This tract is already cut into lots." };
  return { rec };
}

export function lotsOn(lotArea: number, lotSf: number): number {
  return Math.max(0, Math.floor((lotArea * (1 - PLAT_STREET_SHARE)) / lotSf));
}

/** What a rezoning would cost here, how long the board takes, and how often it says yes. */
/** `planned`: the lot count of the plat citygen draws for this tract (region platTractLots); absent, an estimate. */
export function entitleQuote(s: GameState, parcels: ParcelTable, bbl: string, lotSf = 7_500, planned?: number) {
  const p = plattable(s, parcels, bbl);
  if ("err" in p) return null;
  const lots = planned ?? lotsOn(p.rec.lotArea, lotSf);
  if (lots < 4) return null;
  const cost = Math.round((ENTITLE_FIXED + ENTITLE_PER_LOT * lots) * s.econ.costIdx);
  return { cost, months: ENTITLE_MONTHS(lots), odds: +entitleOdds(p.rec.tract!.edgeM).toFixed(2), lots, lotSf, zone: REZONE.zone, far: REZONE.far };
}

export function fileEntitlement(s: GameState, parcels: ParcelTable, bbl: string, lotSf = 7_500, planned?: number): { s: GameState; err?: string; msg?: string } {
  if (!s.holdings[bbl]) return { s, err: "You have to own the tract to ask the board for anything." };
  const p = plattable(s, parcels, bbl);
  if ("err" in p) return { s, err: p.err };
  if (s.rezoned?.[bbl]) return { s, err: "The board has already rezoned it." };
  if (s.entitlementApps?.[bbl]) return { s, err: "The application is already in front of the board." };
  const q = entitleQuote(s, parcels, bbl, lotSf, planned);
  if (!q) return { s, err: "The tract is too small to plat." };
  const room = spendable(s, parcels);
  if (room.total < q.cost) return { s, err: `The application runs ${money(q.cost)} and you can raise ${money(room.total)}.` };
  const next = cloneState(s);
  fundAndBook(next, parcels, q.cost, "dev", { bbl });
  next.holdings[bbl].costBasis += q.cost;
  const app: EntitlementApplication = { bbl, filedM: next.month, decideM: next.month + q.months, cost: q.cost, odds: q.odds, lotSf, lots: q.lots };
  next.entitlementApps = { ...(next.entitlementApps ?? {}), [bbl]: app };
  next.news.unshift({
    q: next.month, kind: "info",
    text: `Rezoning filed for ${p.rec.address}: ${q.lots} lots of ${lotSf.toLocaleString()} sf. The board sits ${monthLabel(app.decideM)}; applications like it pass about ${Math.round(q.odds * 100)}% of the time.`,
  });
  return { s: next, msg: "Filed." };
}

function decideEntitlements(s: GameState, parcels: ParcelTable) {
  const apps = s.entitlementApps;
  if (!apps) return;
  const due = Object.values(apps).filter((a) => s.month >= a.decideM).sort((a, b) => a.decideM - b.decideM || a.bbl.localeCompare(b.bbl));
  for (const app of due) {
    delete apps[app.bbl];
    if (!s.holdings[app.bbl]) continue;           // sold while the board deliberated
    const granted = rng(s) < app.odds;
    const rec = resolveRec(parcels, s, app.bbl);
    recordPropertyEvent(s, app.bbl, { kind: "planning", amount: app.cost, outcome: granted ? `Rezoned ${REZONE.zone}: ${app.lots} lots approved` : "Rezoning refused" });
    if (granted) {
      s.rezoned = { ...(s.rezoned ?? {}), [app.bbl]: { zone: REZONE.zone, far: REZONE.far, lotSf: app.lotSf, m: s.month } };
      s.news.unshift({ q: s.month, kind: "deal", text: `The board rezoned ${rec?.address ?? app.bbl} ${REZONE.zone}, ${app.lots} lots approved. Plat it when you are ready to build the streets.` });
    } else {
      s.news.unshift({ q: s.month, kind: "warn", text: `The board refused the rezoning at ${rec?.address ?? app.bbl}. The fees are spent; it is still a farm.` });
    }
  }
  if (!Object.keys(apps).length) delete s.entitlementApps;
}

// ---------------------------------------------------------------- platting
/** The horizontal: what the streets and pipes for these lots cost, and how long they take. */
export function platQuote(s: GameState, lots: { a: number; f: number; d: number }[]) {
  const frontage = lots.reduce((t, l) => t + l.f, 0);
  const cost = Math.round((INFRA_PER_FRONT_FT * frontage + IMPACT_FEE * lots.length) * s.econ.costIdx);
  return { cost, months: INFRA_MONTHS(lots.length), lots: lots.length, perLot: Math.round(cost / Math.max(1, lots.length)) };
}

/**
 * Break ground on the streets. `lots` is the plat citygen drew for this tract
 * at the rezoned lot size (region platTractLots) — the engine takes its count,
 * areas and frontages and nothing else.
 */
export function startPlat(s: GameState, parcels: ParcelTable, bbl: string, lots: { a: number; f: number; d: number }[]): { s: GameState; err?: string; msg?: string } {
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You have to own the tract." };
  const p = plattable(s, parcels, bbl);
  if ("err" in p) return { s, err: p.err };
  const rz = s.rezoned?.[bbl];
  if (!rz) return { s, err: "It is still zoned for farming. The board has to rezone it before you can cut it into lots." };
  if (s.plats?.[bbl]) return { s, err: "The streets are already going in." };
  if (h.loan) return { s, err: "Pay off the loan on the tract first: a lender's lien on a farm does not follow it into three hundred lots." };
  if (h.sale) return { s, err: "It is listed for sale. Take it off the market before you build streets on it." };
  const area = lots.reduce((t, l) => t + l.a, 0);
  if (lots.length < 2 || !(area > 0) || area > p.rec.lotArea * 1.001) return { s, err: "That plat does not fit the tract." };
  const q = platQuote(s, lots);
  const room = spendable(s, parcels);
  if (room.total < q.cost) return { s, err: `The streets, pipes and impact fees run ${money(q.cost)} and you can raise ${money(room.total)}.` };
  const next = cloneState(s);
  fundAndBook(next, parcels, q.cost, "dev", { bbl });
  next.holdings[bbl].costBasis += q.cost;
  const rec: PlatRecord = { parent: bbl, template: "grid", lotSf: rz.lotSf, startM: next.month, doneM: next.month + q.months, cost: q.cost, lots: lots.map((l) => ({ a: Math.round(l.a), f: Math.round(l.f), d: Math.round(l.d) })) };
  next.plats = { ...(next.plats ?? {}), [bbl]: rec };
  next.news.unshift({ q: next.month, kind: "info", text: `Streets going in at ${p.rec.address}: ${lots.length} lots, ${money(q.cost)} of horizontal (${money(q.perLot)} a lot). Finished ${monthLabel(rec.doneM)}.` });
  return { s: next, msg: "Under way." };
}

/** The BBL of a plat's nth lot: 6 + the tract's survey number (5 digits) + the lot (4). Numeric, like every deed. */
export function lotBbl(parent: ParcelRecord, n: number): string {
  return String(6e9 + (parent.tract!.id % 1e5) * 1e4 + n);
}

/** The lot records of one finished plat, regenerated from the recipe and the parent. */
function lotRecords(parent: ParcelRecord, plat: PlatRecord, rz: { zone: string; far: number } | undefined): ParcelRecord[] {
  // A FINISHED LOT KEEPS THE FARM'S TEXTURE. The land read floors a lot at
  // 30% of its generation stamp — "what dirt clears at here", from the
  // town's comparable sales. A new lot on what was a field has no such sales
  // behind it: stamping it like a town lot ($30/sf and up, build.mjs) priced
  // a finished lot at ~$26/sf on farmland bought at $0.06, a money pump
  // nobody bid for. What it is worth is what a builder would pay for it
  // (the residual), and the farm under it.
  const landPsf = parent.landPsf;
  return plat.lots.map((l, i) => ({
    ...parent,
    bbl: lotBbl(parent, i + 1),
    address: `${parent.address.replace(/ \(.*\)$/, "").replace(/ tract$/, "")} lot ${i + 1}`,
    block: parent.bbl, lot: String(i + 1),
    zoneDist: rz?.zone ?? REZONE.zone, farMaxComm: rz?.far ?? REZONE.far, farMaxRes: rz?.far ?? REZONE.far,
    bldgClass: "V1", class: "land" as const, mix: undefined,
    lotArea: l.a, bldgArea: 0, floors: 0, yearBuilt: 0, unitsRes: 0,
    landPsf, assessedLand: Math.round(l.a * landPsf * 0.45), assessedTotal: Math.round(l.a * landPsf * 0.45),
    landPsfHistory: [landPsf], imputed: [],
    lotFront: l.f, lotDepth: l.d, corner: false,
    ag: undefined, tract: undefined,
  }));
}

/**
 * Put every finished plat's lots into the parcel table and the BBL list, in
 * place. Idempotent and a pure function of the state, so the page, the worker
 * and a harness all arrive at the same table: call it after loading a save and
 * after every tick (sim.ts does, at the top and bottom of the month).
 * Returns the BBLs it added.
 */
export function materializePlats(s: GameState, parcels: ParcelTable, bbls?: string[]): string[] {
  const added: string[] = [];
  for (const plat of Object.values(s.plats ?? {})) {
    if (!plat.done) continue;
    const parent = parcels[plat.parent];
    if (!parent?.tract) continue;
    for (const r of lotRecords(parent, plat, s.rezoned?.[plat.parent])) {
      if (parcels[r.bbl]) continue;
      parcels[r.bbl] = r;
      bbls?.push(r.bbl);
      added.push(r.bbl);
    }
  }
  return added;
}

function completePlats(s: GameState, parcels: ParcelTable, bbls: string[]) {
  for (const plat of Object.values(s.plats ?? {})) {
    if (plat.done || s.month < plat.doneM) continue;
    plat.done = true;
    s.platted = { ...(s.platted ?? {}), [plat.parent]: s.month };
    const added = materializePlats(s, parcels, bbls);
    const parentH = s.holdings[plat.parent];
    const parent = parcels[plat.parent];
    const mine = parent ? lotRecords(parent, plat, s.rezoned?.[plat.parent]).map((r) => r.bbl) : added;
    if (parentH) {
      // THE DEED BECOMES DEEDS. No money moves: the tract's whole cost — the
      // land, the hearings, the streets — is spread over its lots by area, and
      // the farm's own deed is retired into them.
      const total = plat.lots.reduce((t, l) => t + l.a, 0);
      plat.lots.forEach((l, i) => {
        const share = l.a / Math.max(1, total);
        const h: Holding = {
          ...parentH, bbl: mine[i], boughtM: s.month,
          costBasis: Math.round(parentH.costBasis * share), assessed: Math.round((parentH.assessed ?? 0) * share),
          loan: null, tenants: [], cfHistory: [],
        };
        s.holdings[mine[i]] = h;
      });
      delete s.holdings[plat.parent];
    }
    recordPropertyEvent(s, plat.parent, { kind: "planning", amount: plat.cost, outcome: `Platted into ${plat.lots.length} lots` });
    s.news.unshift({ q: s.month, kind: "deal", text: `The streets are in at ${parent?.address ?? plat.parent}: ${plat.lots.length} finished lots, each its own deed. Build on them, or sell them to the street.` });
  }
}

/** The month's land-development business: the board's decisions and the streets that finished. */
export function tickLandDev(s: GameState, parcels: ParcelTable, bbls: string[]) {
  if (!s.entitlementApps && !s.plats) return;
  decideEntitlements(s, parcels);
  completePlats(s, parcels, bbls);
}
