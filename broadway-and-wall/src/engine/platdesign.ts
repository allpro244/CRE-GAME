// THE SUBDIVISION DESIGN DESK'S ECONOMICS (region map; the desk is
// ui/panels/LandDesk.tsx, the geometry citygen/region/platdesign.mjs).
//
// The player is a land developer: buy a farm, entitle it, plat it, sell the
// finished lots to homebuilders. This file prices a plat the player has
// drawn — what its amenities cost and take, what living next to one is worth,
// what the lots fetch from a builder, what the whole job earns over the
// months it takes to sell — and commits it: the rezoning filed with the plat,
// or the streets built from it with an acquisition-and-development loan.
//
// AMENITIES ARE A MECHANISM, NOT A BONUS. A park does not raise "lot value".
// It raises what a household pays for the HOUSE beside it (the hedonic
// premium, below), and the builder's residual — the price of the house less
// the cost of building and selling it (homeprice.ts homeQuote) — is what the
// builder can then pay for the lot. A 6% premium on a $420k house is ~$25k,
// most of which reaches the lot, because the build cost does not change. The
// land the amenity takes is lots that are not there to sell, and its cost is
// cash out on day one: whether a park pays is the arithmetic of those three.
import type { ParcelTable, ParcelRecord } from "@/data/types";
import { platTractDesign, designSummary, platTractLots } from "@/citygen/index.mjs";
import type { GameState, PlatDesign, AmenityKind, PlatRecord, Loan } from "./types";
import { cloneState, monthLabel, logBooks } from "./types";
import { homeQuote, forwardHomeEcon } from "./homeprice";
import { tractLotQuote } from "./homes";
import { entitleQuote, fileEntitlement, plattable, INFRA_PER_FRONT_FT, IMPACT_FEE, INFRA_MONTHS } from "./landdev";
import { landValue, resolveRec } from "./value";
import { spendable, fundAndBook } from "./credit";
import { productById, quote, originate, capPremiumOn } from "./debt";
import { scheduledPayment } from "./amortize";
import { money } from "./money";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const FT = 0.3048;

// ---------------------------------------------------------------- the amenities [S]
export type AmenityFact = {
  name: string;
  /** land it takes, acres (0: the greenway runs in the floodplain, on land no lot could use) */
  acres: number;
  /** what it costs to build, 2024 dollars at costIdx 1 (the greenway: per linear foot of trail) */
  cost: number; perFt?: number;
  /**
   * The hedonic premium on the price of a house whose lot fronts or backs onto
   * it, and the e-folding distance (ft) over which that falls away. A
   * community-wide amenity carries `all` on every house in the plat instead.
   */
  adj: number; decayFt: number; all: number;
  /** what the premium and the cost rest on */
  src: string;
};
/**
 * THE PALETTE. Costs are approximate 2024 US ranges [S, approximate], carried
 * by the construction-cost index. Premiums are on the house's price, read
 * from the hedonic literature; the decay lengths are shape parameters [K]
 * placed so the premium is mostly gone by the distance each study found it
 * gone.
 *
 * - Crompton (2005), "The impact of parks on property values: empirical
 *   evidence from the past two decades in the United States", Managing
 *   Leisure 10(4): a premium of about 8-10% on houses abutting or fronting a
 *   passive park, largely gone by 500-600 ft for a small park and reaching
 *   ~2,000 ft for a large one; heavily used active facilities (lit ball
 *   fields) show little or even negative effect on the houses right beside
 *   them and a positive one a block or two away.
 * - Lutzenhiser & Netusil (2001), "The effect of open spaces on a home's sale
 *   price", Contemporary Economic Policy 19(3) (Portland): natural-area parks
 *   lift prices within 1,500 ft, the largest effects for the largest parks.
 * - Nicholls & Crompton (2005), "The impact of greenways on property values:
 *   evidence from Austin, Texas", Journal of Leisure Research 37(3): a
 *   significant premium for lots adjoining the greenbelt in two of the three
 *   neighbourhoods studied; Asabere & Huffman (2009), "The relative impacts
 *   of trails and greenbelts on home price", JREFE 38(4): a premium of a few
 *   percent for a greenbelt with a trail.
 * - Benefield (2009), "Neighborhood amenity packages, property price, and
 *   marketing time", Property Management 27(5): community pools and
 *   clubhouses carry a small premium on every house in the neighbourhood,
 *   on the order of 2-5% (and sell faster, which is not modelled here).
 * - Park development costs: municipal capital plans and NRPA park-metric
 *   ranges, a mini-park $150-400k, a neighbourhood park $250-500k an acre
 *   developed; a 10 ft asphalt trail $0.6-1.5M a mile ($115-285 a foot);
 *   a commercial play structure with safety surfacing $75-250k; a
 *   community amenity centre (3-4,000 sf clubhouse and a 25 m pool) $2-4M;
 *   an entry monument and landscaped entrance $75-250k; a natural-turf
 *   youth field $150-300k.
 * - Land takes: NRPA classification — a mini-park under an acre, a
 *   neighbourhood park 1-5 acres (3 here), two youth fields with parking
 *   about 4 acres.
 */
export const AMENITIES: Record<AmenityKind, AmenityFact> = {
  pocket: { name: "Pocket park", acres: 0.5, cost: 200_000, adj: 0.05, decayFt: 150, all: 0,
    src: "Crompton 2005 (8-10% abutting a passive park, gone by ~500 ft for a small one); mini-park $150-400k" },
  park: { name: "Neighbourhood park", acres: 3, cost: 1_050_000, adj: 0.09, decayFt: 350, all: 0,
    src: "Crompton 2005 (8-10% abutting, reaching further for larger parks); Lutzenhiser & Netusil 2001; $350k/ac developed" },
  greenway: { name: "Greenway trail", acres: 0, cost: 0, perFt: 175, adj: 0.07, decayFt: 250, all: 0,
    src: "Nicholls & Crompton 2005 (greenbelt adjacency, Austin); Asabere & Huffman 2009; 10 ft asphalt trail ~$175/ft" },
  playground: { name: "Playground", acres: 0.25, cost: 150_000, adj: 0.02, decayFt: 200, all: 0,
    src: "Crompton 2005 (active facilities: small or negative right beside, positive a block away); $75-250k installed" },
  pool: { name: "Pool & clubhouse", acres: 1.5, cost: 2_500_000, adj: 0, decayFt: 1, all: 0.03,
    src: "Benefield 2009 (community pool/clubhouse ~2-5% on every house); amenity centre $2-4M" },
  entry: { name: "Entry monument", acres: 0.15, cost: 150_000, adj: 0, decayFt: 1, all: 0.01,
    src: "[K] no clean hedonic estimate for an entrance alone; a small community-wide premium as a shape parameter; $75-250k" },
  fields: { name: "Sports fields", acres: 4, cost: 600_000, adj: 0.03, decayFt: 400, all: 0,
    src: "Crompton 2005 (lit, busy fields: little beside them, positive a block or two off); two youth fields ~$300k each" },
};
export const AMENITY_KINDS = Object.keys(AMENITIES) as AmenityKind[];
/**
 * STORMWATER DETENTION. A suburban plat must hold back the extra runoff its
 * roofs and streets make; the ponds take about 3-5% of the site in the
 * Midwest's flat ground [S, approximate; plats.mjs uses the same range] — 4%
 * of the buildable land here. The pond's earthwork is in the horizontal cost
 * (the Zonda / John Burns finished-lot surveys behind landdev.ts include storm).
 */
export const DETENTION_SHARE = 0.04;

/** The nominal lot sizes the desk offers (citygen DESIGN_SIZES). */
export const DESIGN_LOT_SIZES = [5_000, 7_500, 10_000, 15_000] as const;

/** The design a fresh desk opens on: a grid of 7,500 sf lots, square to the tract, no amenities. */
export function defaultDesign(): PlatDesign {
  return { layout: "grid", mix: { 7500: 1 }, rot: 0, shift: [0, 0], amen: [], open: [], merge: [], split: [] };
}

/**
 * HOW MANY LOTS A TRACT YIELDS — the one count. The plat the desk draws by
 * default (a grid of `lotSf` lots, no amenities: defaultDesign), kept off the
 * floodplain, the pond and the streets by citygen's designPlat, on the
 * tract's buildable land. The file's Overview, the land desk, a rezoning
 * filed from either, and the land developers' reads (growth.ts) all count
 * lots with this, so they cannot disagree. Pure in the tract: memoised.
 */
const YIELD = new Map<string, { n: number; frontage: number; lots: { a: number; f: number; d: number }[] }>();
export function tractYield(rec: Pick<ParcelRecord, "tract" | "buildableSf" | "lotArea">, lotSf = 7_500) {
  const t = rec.tract!;
  const buildable = rec.buildableSf ?? rec.lotArea;
  const key = `${t.seed}:${t.id}:${lotSf}:${Math.round(buildable)}`;
  let y = YIELD.get(key);
  if (!y) {
    // an industrial park (acre lots and up) is cut by citygen's spine-road plat, not the house desk
    const lots = lotSf >= 43_560
      ? platTractLots(t, lotSf).lots.map(({ a, f, d }) => ({ a, f, d }))
      : designSummary(platTractDesign(t, designRecipe({ ...defaultDesign(), mix: { [lotSf]: 1 } }, buildable))).lots
        .map((l) => ({ a: Math.round(l.a), f: Math.round(l.w), d: Math.round(l.d) }));
    y = { n: lots.length, frontage: lots.reduce((s, l) => s + l.f, 0), lots };
    if (YIELD.size > 4000) YIELD.clear();
    YIELD.set(key, y);
  }
  return y;
}
/** The default design at a lot size (what the classic Rezone / Build streets steps file). */
export function designAt(lotSf: number): PlatDesign {
  return { ...defaultDesign(), mix: { [lotSf]: 1 } };
}
/** The tract's lot count as things stand: the plat built, the plat before the board or approved, else its yield. */
export function plannedLots(s: GameState, parcels: ParcelTable, bbl: string): { n: number; lotSf: number } {
  const plat = s.plats?.[bbl], app = s.entitlementApps?.[bbl], rz = s.rezoned?.[bbl];
  const lotSf = plat?.lotSf ?? rz?.lotSf ?? app?.lotSf ?? 7_500;
  if (plat) return { n: plat.lots.length, lotSf };
  if (app) return { n: app.lots, lotSf };
  if (rz?.lots !== undefined) return { n: rz.lots, lotSf };
  const rec = parcels[bbl];
  return { n: rec?.tract ? tractYield(rec, lotSf).n : 0, lotSf };
}

/**
 * What citygen needs to draw the plat (citygen platTractDesign): the design
 * with every land take resolved to square feet — the pond as a share of the
 * buildable land, each amenity's acres.
 */
export function designRecipe(design: PlatDesign, buildableSf: number) {
  return {
    ...design,
    pondSf: Math.round(DETENTION_SHARE * Math.max(0, buildableSf)),
    amen: design.amen.map((a) => ({ k: a.k, at: a.at, sf: Math.round(AMENITIES[a.k].acres * 43_560) })),
  };
}

/**
 * THE PREMIUM ON ONE HOUSE. `near`: [amenity index, edge-to-edge metres] (the
 * geometry's), `kinds`: the design's amenities by index. Parks do not stack —
 * the studies measure the nearest — so the lot takes the best park premium
 * at its distance; community-wide amenities add, once each.
 */
export function lotPremium(near: [number, number][], kinds: AmenityKind[]): number {
  let park = 0;
  for (const [k, m] of near) {
    const f = AMENITIES[kinds[k]];
    if (!f || !(f.adj > 0)) continue;
    park = Math.max(park, f.adj * Math.exp(-(m / FT) / f.decayFt));
  }
  const all = [...new Set(kinds)].reduce((t, k) => t + (AMENITIES[k]?.all ?? 0), 0);
  return +(park + all).toFixed(4);
}

// ---------------------------------------------------------------- the plat, priced
/** What the desk hands the engine from the geometry: the lots and what the plan puts on the land. */
export type DesignGeo = {
  lots: { a: number; w: number; d: number; near: [number, number][] }[];
  /** street right-of-way length, ft, by kind */
  streets: { lenFt: number; rowFt: number }[];
  /** each amenity: its kind, the land it took (sf), the trail it runs (ft), whether it could be placed */
  amen: { k: AmenityKind; sf: number; trailFt: number; ok: boolean }[];
  grossSf: number; buildableSf: number; floodSf: number;
  lotSf: number; streetSf: number; pondSf: number; amenSf: number; openSf: number;
};

/**
 * HORIZONTAL DEVELOPMENT, BY THE STREET. landdev.ts prices a plat at $40,000
 * a 65 ft lot ($615 a foot of lot frontage), inside the $30-60k a lot that
 * finished-lot development runs in the 2020s [S, approximate: developer pro
 * formas cite $40-65k a lot; Midwest municipal assessment schedules put
 * street, curb, sanitary and water alone at about $330-360 a front foot —
 * Oshkosh WI 2024, Portage MI — before storm, grading, power and
 * engineering]. That is per LOT on an ordinary plat, so it already pays for
 * an ordinary plat's cross streets: a 65 x 115 ft lot on a double-loaded
 * 50 ft street carries 32.5 ft of street, and a cross street every 1,200 ft
 * (2 x 115 + 50 = 280 ft of it per 36 lots) adds 7.8 ft — 40.3 ft a lot. A
 * foot of street therefore costs $40,000 / 40.3 = $993, derived from that
 * geometry and not tuned. (This read $1,230 — two frontages a foot — which
 * charged the cross streets twice.) A drawn plat pays for its own feet of
 * street: a collector no house fronts, a single-loaded edge and a cul-de-sac
 * bulb cost what they cost, so a plat that buys its lots with more street
 * pays more a lot. A 66 ft collector carries proportionally more pavement
 * than a 50 ft local. Plus the impact fee on every lot (landdev.ts). All in
 * this town's construction dollars (costIdx).
 */
const REF_STREET_FT_PER_LOT = 65 / 2 + (2 * 115 + 50) / (2 * Math.floor(1200 / 65));
export const STREET_COST_PER_FT = (INFRA_PER_FRONT_FT * 65) / REF_STREET_FT_PER_LOT;
export function designHorizontal(s: GameState, geo: Pick<DesignGeo, "streets" | "lots">) {
  const ci = s.econ.costIdx ?? 1;
  const streets = Math.round(geo.streets.reduce((t, st) => t + st.lenFt * STREET_COST_PER_FT * (st.rowFt / 50), 0) * ci);
  const impact = Math.round(IMPACT_FEE * geo.lots.length * ci);
  return { streets, impact, months: INFRA_MONTHS(geo.lots.length) };
}
export function amenityCost(s: GameState, a: { k: AmenityKind; trailFt: number }): number {
  const f = AMENITIES[a.k];
  return Math.round(((f.cost ?? 0) + (f.perFt ?? 0) * a.trailFt) * (s.econ.costIdx ?? 1));
}

export type DesignPnl = {
  lots: number;
  /** each lot's premium, and its builder residual with and without it */
  prem: number[]; resid: number[]; residStd: number[];
  premLots: number; premAvg: number;
  /** the house the standard lot carries, and where the plat sits */
  house: { sf: number; price: number; psf: number; loc: number };
  land: number; entitle: number; entitleSpent: boolean; streets: number; impact: number;
  amenity: { k: AmenityKind; cost: number; sf: number }[];
  amenTotal: number; cost: number;
  /** gross lot revenue at the builders' residual, with the premiums; and without them */
  revenue: number; revenueStd: number;
  pace: number; selloutM: number; entitleM: number; infraM: number;
  /** what the lots would be marked at the day they are finished (the residual discounted for the sell-out) */
  markAtFinish: number;
  profit: number; margin: number; irr: number | null;
  /** monthly cash flows, unlevered, from today */
  flows: number[];
  density: { gross: number; net: number; buildableAc: number };
  shares: { lots: number; streets: number; open: number; pond: number; flood: number; other: number };
};

/** The annual IRR of monthly flows (bisection on the monthly rate); null where it does not exist. */
export function irrOf(flows: number[]): number | null {
  const npv = (r: number) => flows.reduce((t, f, i) => t + f / Math.pow(1 + r, i), 0);
  if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) return null;
  let lo = -0.0833, hi = 0.25;               // -64% to +1,355% a year
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  void fhi;
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

/**
 * THE PLAT, PRICED, from the engine's own functions: the builder's residual
 * on every lot (homeprice.ts homeQuote, the house price lifted by the lot's
 * premium), the pace builders sell at here (homes.ts tractLotQuote), the
 * rezoning and horizontal at the engine's quotes, the land at its basis.
 * Every number on the desk's P&L strip comes from here.
 */
export function designPnl(s: GameState, parcels: ParcelTable, bbl: string, design: PlatDesign, geo: DesignGeo): DesignPnl | null {
  const rec = parcels[bbl];
  if (!rec?.tract) return null;
  const e = s.econ;
  const n = geo.lots.length;
  const kinds = design.amen.map((a) => a.k);
  const rz = s.rezoned?.[bbl];
  const far = rz?.far ?? 0.6;
  const sorted = geo.lots.map((l) => l.a).sort((a, b) => a - b);
  const median = sorted.length ? sorted[sorted.length >> 1] : 7_500;
  const tq = tractLotQuote(s, parcels, bbl, median, Math.max(1, n));
  // THE SCHEDULE: the board (if it has not ruled), the streets, then the builders take lots at their pace
  const eq0 = entitleQuote(s, parcels, bbl, median, Math.max(4, n));
  const entitleM = rz ? 0 : s.entitlementApps?.[bbl] ? Math.max(0, s.entitlementApps[bbl].decideM - s.month) : eq0?.months ?? 12;
  const hz = designHorizontal(s, geo);
  const infraM = hz.months;
  // A FORWARD VIEW. The builders bid for these lots when the streets are in,
  // not today: priced on the market the engine expects then (homeprice.ts
  // forwardHomeEcon) — the house price closing on what the town's buyers can
  // carry, costs and pay carried at expected inflation, today's rates.
  const fwd = forwardHomeEcon(e, entitleM + infraM);
  const psfEdge = fwd.psf;
  const psfHere = psfEdge * tq.loc;
  const prem: number[] = [], resid: number[] = [], residStd: number[] = [];
  for (const l of geo.lots) {
    const p = lotPremium(l.near, kinds);
    prem.push(p);
    resid.push(Math.max(0, homeQuote(fwd, l.a, psfHere * (1 + p), far).residual));
    residStd.push(Math.max(0, homeQuote(fwd, l.a, psfHere, far).residual));
  }
  const revenue = resid.reduce((a, b) => a + b, 0), revenueStd = residStd.reduce((a, b) => a + b, 0);
  // the land: what the tract stands you, or what it would cost to buy
  const h = s.holdings[bbl];
  const land = Math.round(h ? h.costBasis : landValue(resolveRec(parcels, s, bbl) ?? rec, e));
  const app = s.entitlementApps?.[bbl];
  const eq = eq0;
  const entitleSpent = !!(rz || app);
  const entitle = entitleSpent ? 0 : eq?.cost ?? 0;
  const amenity = geo.amen.map((a) => ({ k: a.k, cost: a.ok ? amenityCost(s, a) : 0, sf: a.sf }));
  const amenTotal = amenity.reduce((t, a) => t + a.cost, 0);
  const cost = land + entitle + hz.streets + hz.impact + amenTotal;
  const pace = tq.pace;
  const selloutM = pace > 0 ? Math.ceil(n / pace) : Infinity;
  const flows: number[] = [-(land + entitle)];
  const put = (m: number, v: number) => { while (flows.length <= m) flows.push(0); flows[m] += v; };
  put(entitleM, -(hz.streets + hz.impact + amenTotal));
  if (Number.isFinite(selloutM) && n > 0) {
    // lots go in the order the builders take them: a takedown runs at the pace, the average lot each month
    const per = revenue / n;
    let left = n;
    for (let m = entitleM + infraM + 1; left > 1e-9 && m < entitleM + infraM + 1 + 600; m++) { const k = Math.min(left, pace); put(m, k * per); left -= k; }
  }
  const irr = irrOf(flows);
  const ac = (sf: number) => sf / 43_560;
  const G = Math.max(1, geo.grossSf);
  const q0 = homeQuote(fwd, median, psfHere, far);
  return {
    lots: n, prem, resid, residStd,
    premLots: prem.filter((p) => p >= 0.005).length,
    premAvg: n ? prem.reduce((a, b) => a + b, 0) / n : 0,
    house: { sf: q0.sf, price: q0.price, psf: psfHere, loc: tq.loc },
    land, entitle, entitleSpent, streets: hz.streets, impact: hz.impact,
    amenity, amenTotal, cost,
    revenue: Math.round(revenue), revenueStd: Math.round(revenueStd),
    pace, selloutM, entitleM, infraM,
    markAtFinish: Math.round(revenue * tq.disc),
    profit: Math.round(revenue - cost), margin: revenue > 0.02 * cost ? (revenue - cost) / revenue : NaN, irr,
    flows,
    density: { gross: n / Math.max(1e-9, ac(geo.grossSf)), net: n / Math.max(1e-9, ac(geo.lotSf)), buildableAc: ac(geo.buildableSf) },
    shares: {
      lots: geo.lotSf / G, streets: geo.streetSf / G, open: (geo.amenSf + geo.openSf) / G, pond: geo.pondSf / G, flood: geo.floodSf / G,
      other: Math.max(0, 1 - (geo.lotSf + geo.streetSf + geo.amenSf + geo.openSf + geo.pondSf + geo.floodSf) / G),
    },
  };
}

// ---------------------------------------------------------------- the A&D loan
/**
 * THE ACQUISITION-AND-DEVELOPMENT LOAN. A&D money is the bank's riskiest
 * real-estate paper — the regulators' "high volatility" category — and is
 * written at 50-65% of cost with recourse, an interest reserve so the coupon
 * is paid out of the loan while nothing sells, and a release price on every
 * lot: each closing pays down the note (FDIC / OCC Comptroller's Handbook,
 * "Commercial Real Estate Lending", A&D loans) [S]. The desk is the town's
 * own: Tidewater's land-and-development sheet (debt.ts, 60%), quoted on the
 * plat's whole cost through `quote` — today's appetite, standing and window
 * included — so the advance is a loan-to-cost.
 *
 * The note sits on the tract while the streets go in and splits across the
 * finished lots by area, as the basis does; a lot sold to a builder pays off
 * its share (homes.ts sellLot). Interest-only; the reserve is undrawn room
 * on the note, drawn as the coupon falls due (sim.ts, Loan.leaseUpRoom). Its
 * covenants hold off until a year past the streets: an A&D note is
 * underwritten on cost and the as-completed lots, not a monthly mark of a
 * construction site.
 */
export const AD_PRODUCT = "tideLand";

export type AdQuote = {
  lender: string; ratePct: number; termM: number; points: number;
  /** the rate cap a floating note must carry at closing (debt.ts originate) */
  cap: number;
  /** the most the desk would write on this cost today, and what is taken */
  ltcMax: number; loan: number; funded: number; reserve: number;
  /** the cheque at closing, and the levered return */
  equityNow: number; equityAll: number; irr: number | null; flows: number[];
  why?: string;
};

/**
 * The A&D quote for a priced plat. `lev` 0..1 of the most the desk writes.
 * The interest reserve is sized to the note's term: the coupon on the funded
 * balance through the streets, then on a balance falling as lots are released.
 */
export function adQuote(s: GameState, pnl: DesignPnl, lev = 1): AdQuote {
  const p = productById(AD_PRODUCT);
  const dev = pnl.streets + pnl.impact + pnl.amenTotal;
  const q = quote(s, p, pnl.cost, 0, "land");
  const r = q.ratePct / 100 / 12;
  const T = p.termM;
  // the balance profile as a share of the funded amount, month by month to the balloon
  const profile: number[] = [];
  for (let m = 0; m < T; m++) {
    const sold = m < pnl.infraM ? 0 : Math.min(1, ((m - pnl.infraM) * pnl.pace) / Math.max(1, pnl.lots));
    profile.push(1 - sold);
  }
  const resPer = r * profile.reduce((a, b) => a + b, 0);   // reserve per dollar funded
  const max = Math.max(0, Math.min(q.principal, dev * (1 + resPer)));
  const total = Math.round(max * clamp(lev, 0, 1));
  const funded = Math.round(total / (1 + resPer));
  const reserve = total - funded;
  const points = Math.round(total * p.points);
  const cap = p.floating && total > 0 ? capPremiumOn(total) : 0;
  // levered flows: today's cheque, the streets less the advance; the coupon from the reserve, then from
  // you; each lot's release out of its price
  const flows = pnl.flows.map((f) => f);
  const put = (m: number, v: number) => { while (flows.length <= m) flows.push(0); flows[m] += v; };
  const start = pnl.entitleM;
  put(start, funded - points - cap);
  let bal = funded, res = reserve;
  const n = Math.max(1, pnl.lots), release = (total) / n;
  for (let m = start + 1; m < flows.length + 1 && bal > 1; m++) {
    const int = bal * r;
    if (res >= int) { res -= int; bal += int; } else { put(m, -(int - res)); bal += res; res = 0; }
    const lotsThis = m > start + pnl.infraM ? Math.min(pnl.pace, n) : 0;
    if (lotsThis > 0) { const pay = Math.min(bal, lotsThis * release); put(m, -pay); bal -= pay; }
    if (m >= start + T && bal > 1) { put(m, -bal); bal = 0; }   // the balloon, if the lots have not paid it
  }
  const equityNow = Math.max(0, dev - funded) + points + cap;
  return {
    lender: p.lender, ratePct: q.ratePct, termM: T, points, cap,
    ltcMax: pnl.cost > 0 ? q.principal / pnl.cost : 0, loan: total, funded, reserve,
    equityNow, equityAll: pnl.land + pnl.entitle + equityNow,
    irr: irrOf(flows), flows,
    why: q.principal <= 0 ? (q.advanceWhy ?? q.concWhy ?? "Tidewater is not writing land paper today.") : q.advanceWhy,
  };
}

// ---------------------------------------------------------------- commit
/** The plat's lot count and lot size the board is asked for (the median lot), filed with the design. */
export function fileDesignedRezoning(s: GameState, parcels: ParcelTable, bbl: string, design: PlatDesign, geo: DesignGeo) {
  const n = geo.lots.length;
  const sorted = geo.lots.map((l) => l.a).sort((a, b) => a - b);
  const median = sorted.length ? sorted[sorted.length >> 1] : 7_500;
  const r = fileEntitlement(s, parcels, bbl, Math.round(median), n);
  if (r.err) return r;
  const app = r.s.entitlementApps?.[bbl];
  if (app) app.design = JSON.parse(JSON.stringify(design));
  return r;
}

/**
 * BUILD THE STREETS from the design: the horizontal and the amenities paid
 * (from cash and the line, less the A&D advance if one is taken), the plat
 * recorded with its design, each lot's premium and the amenity land, and the
 * note placed on the tract. `lev` 0 takes no loan.
 */
export function startDesignedPlat(
  s: GameState, parcels: ParcelTable, bbl: string, design: PlatDesign, geo: DesignGeo, lev = 0,
): { s: GameState; err?: string; msg?: string } {
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You have to own the tract." };
  const p = plattable(s, parcels, bbl);
  if ("err" in p) return { s, err: p.err };
  const rz = s.rezoned?.[bbl];
  if (!rz) return { s, err: "It is still zoned for farming. File the rezoning with this plat first." };
  if (s.plats?.[bbl]) return { s, err: "The streets are already going in." };
  if (h.loan) return { s, err: "Pay off the loan on the tract first: the A&D lender takes the first lien." };
  if (h.sale) return { s, err: "It is listed for sale. Take it off the market before you build streets on it." };
  const n = geo.lots.length;
  // THE BOARD APPROVED A NUMBER. A final plat must conform to the preliminary one: fewer lots, or a
  // different mix, is a minor change staff signs off; more lots than were approved goes back to the board.
  if (rz.lots !== undefined && n > rz.lots) return { s, err: `The board approved ${rz.lots} lots; this plat has ${n}. More lots is a new application.` };
  const area = geo.lots.reduce((t, l) => t + l.a, 0);
  if (n < 2 || !(area > 0) || area > p.rec.lotArea * 1.001) return { s, err: "That plat does not fit the tract." };
  const pnl = designPnl(s, parcels, bbl, design, geo);
  if (!pnl) return { s, err: "That plat does not fit the tract." };
  const dev = pnl.streets + pnl.impact + pnl.amenTotal;
  const ad = lev > 0 ? adQuote(s, pnl, lev) : null;
  const loanFunded = ad && ad.loan > 0 ? ad.funded : 0;
  const points = ad && ad.loan > 0 ? ad.points + ad.cap : 0;   // origination and the rate cap, both at the table
  const room = spendable(s, parcels);
  const need = dev - loanFunded + points;
  if (room.total < need) return { s, err: `The streets, pipes, impact fees and amenities run ${money(dev)}${loanFunded ? `, ${money(loanFunded)} of it lent` : ""}; you can raise ${money(room.total)} of the ${money(need)} that is yours.` };
  const next = cloneState(s);
  const H = next.holdings[bbl];
  if (ad && ad.loan > 0) {
    const prod = productById(AD_PRODUCT);
    const base = originate(next, prod, pnl.cost, 0, 1, undefined, "land");
    if (!base) return { s, err: "Tidewater will not write the note today." };
    const doneM = next.month + pnl.infraM;
    const loan: Loan = {
      ...base,
      principal: loanFunded, balance: loanFunded,
      monthlyPmt: scheduledPayment(loanFunded, base.ratePct, true, prod.amortYears),
      leaseUpRoom: ad.reserve,
      holidayUntilM: doneM + 12,
      points: prod.points,
      ...(ad.cap > 0 ? { capPremium: ad.cap } : {}),
      ad: true,
    };
    H.loan = loan;
    next.cash += loanFunded;
    logBooks(next, "borrowed", loanFunded, bbl);
    if (points > 0) { next.cash -= points; logBooks(next, "debtSvc", points, bbl); }
  }
  fundAndBook(next, parcels, dev, "dev", { bbl });
  H.costBasis += dev;
  const kinds = design.amen.map((a) => a.k);
  const rec: PlatRecord = {
    parent: bbl, template: "design", lotSf: rz.lotSf, startM: next.month, doneM: next.month + pnl.infraM, cost: dev,
    lots: geo.lots.map((l, i) => ({ a: Math.round(l.a), f: Math.round(l.w), d: Math.round(l.d), ...(pnl.prem[i] > 0 ? { p: pnl.prem[i] } : {}) })),
    design: JSON.parse(JSON.stringify(design)),
    amen: geo.amen.map((a, i) => ({ k: a.k, sf: Math.round(a.sf), cost: pnl.amenity[i].cost })).filter((_a, i) => geo.amen[i].ok),
    common: { pond: Math.round(geo.pondSf), open: Math.round(geo.openSf) },
  };
  next.plats = { ...(next.plats ?? {}), [bbl]: rec };
  const amenWords = rec.amen?.length ? `, with ${rec.amen.map((a) => AMENITIES[a.k].name.toLowerCase()).join(", ")}` : "";
  next.news.unshift({ q: next.month, kind: "info", text: `Streets going in at ${p.rec.address}: ${n} lots${amenWords}. ${money(dev)} of horizontal and amenities (${money(dev / Math.max(1, n))} a lot)${loanFunded ? `, ${money(ad!.loan)} of it on a ${ad!.lender} A&D note at ${ad!.ratePct.toFixed(2)}%` : ""}. Finished ${monthLabel(rec.doneM)}.` });
  void kinds;
  return { s: next, msg: "Under way." };
}

/** Is this deed common land a plat gave its homeowners' association (landdev.ts hoaBbl)? */
export { isHoaBbl } from "./landdev";
