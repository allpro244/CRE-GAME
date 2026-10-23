// PRODUCT TYPES: what a retail or industrial developer actually builds.
//
// "Retail, one storey, 85% of the lot" is not a building anybody puts up off
// a downtown street. Off it, a shop is a PRODUCT with a shape the trade has
// standardised over seventy years: a pad on an outparcel, a strip, a
// grocery-anchored neighbourhood centre, a community centre with junior
// anchors, a power centre of big boxes; a flex building, a bulk distribution
// box, a plant. Each has its own size, its own site plan (the car park and the
// truck court take most of the land), its own cost, its own lease, its own
// buyer pool and so its own cap rate. This file is the table of those facts,
// in one place, with where each came from.
//
// WHAT IS A FACT AND WHAT IS NOT. Every number below is a published industry
// figure or the middle of a published range, stated as such, in 2024 US
// dollars before the engine's construction-cost index (`econ.costIdx`, which
// carries the town's price level and the century of building inflation). None
// was moved to make a scheme pencil. Rents are NOT here: a product's rent is
// the engine's own market rent for its class, read at the address
// (value.ts `useRentPsfYr`). What the table supplies is the shape the rent is
// read through — how deep an inline shop is, what share of a centre the
// anchor takes and at what fraction of the inline rent it signs.
//
// THE SITE PLAN IS SOLVED, NOT ASSERTED. Coverage — the building's share of
// the lot — falls out of the parking ratio, the stall size, the truck court
// and the share of a site that codes and stormwater keep open:
//
//     cover * (1 + parking land per sf + court per sf) + open + fixed / lot = 1
//
// The published coverage band for each product (`coverBand`) is NOT an input.
// It is what test/products.mjs checks the solved coverage against: a parking
// ratio and a stall size that put a strip centre at 0.6 coverage would be
// wrong, and the band is how we would know.
//
// SOURCES (abbreviations used in the table):
//   [ULI-P]   Urban Land Institute / ICSC, "Parking Requirements for Shopping
//             Centers" (2nd ed., 1999): 4.0 spaces per 1,000 sf GLA for centres
//             of 25-400k sf, 4.5 for 400-600k, 5.0 above; grocery and
//             restaurant-heavy centres plan nearer 5.
//   [ULI-D]   ULI, "The Dimensions of Parking" (5th ed.): an efficient
//             90-degree layout takes 300-350 sf a space including aisles;
//             retail lots with landscape islands sit at the top of it.
//   [ICSC]    ICSC shopping-centre definitions (2017 US typology): strip /
//             convenience <30k sf unanchored; neighbourhood 30-125k,
//             supermarket-anchored, 3-mile trade area; community 125-400k,
//             junior anchors / discount department store, 3-6 mile trade
//             area; power 250-600k, 3+ category-killer anchors, 5-10 miles.
//   [NAIOP]   NAIOP / developer specifications for modern industrial: bulk
//             32-40 ft clear, one dock door per 5-10k sf, 130-185 ft truck
//             courts for 53 ft trailers, trailer stalls 12 x 55 ft; flex
//             18-24 ft clear with 20-50% office finish; typical site coverage
//             40-50% bulk, 30-40% flex.
//   [RSM]     RSMeans Square Foot Costs 2024, national averages: retail store
//             ~$214/sf, supermarket ~$195/sf, fast-food restaurant ~$350/sf,
//             bank ~$350/sf, 1-storey warehouse ~$150/sf, 1-storey factory
//             ~$185/sf (all building only, site work separate); site work —
//             asphalt paving on base, curb, lighting, storm sewer — about
//             $8-12 per sf of paved area, concrete truck aprons $12-15.
//   [CW]      Cushman & Wakefield, Industrial Construction Cost Guide
//             (2023-24): shell hard cost for 100k-1M sf distribution roughly
//             $65-$120/sf across US markets, the low end in the Midwest and
//             South (a river town's market), site work on top.
//   [CBRE-C]  CBRE U.S. Cap Rate Survey, H2 2024 (midpoints, class A/B):
//             grocery-anchored neighbourhood/community 6.8-7.1%, power centre
//             7.4-7.6%, unanchored strip 7.3-7.6%; industrial class A
//             distribution 5.6-5.9%, class B 6.3-6.6%.
//   [BG]      The Boulder Group, Net Lease Market Report Q4 2024: single-
//             tenant retail median asking cap ~6.4-6.6% (QSR ~6.0, pharmacy
//             ~6.7, bank ~5.4); new-construction single-tenant leases 10-20
//             years NNN with 10% every five years.
//   [LEASE]   Typical new-deal lease terms, US 2023-24 (CBRE / JLL / Marcus &
//             Millichap retail and industrial reports): inline shops 3-7 years
//             NNN with 2-3%/yr bumps and $25-60/sf of landlord work; grocery
//             anchors 15-20 years at roughly half the inline rent (anchors
//             $10-16/sf against inline $20-30), 5% every five years; junior
//             anchors and big boxes 10-15 years at 50-65% of inline; bulk
//             industrial 5-10 years NNN with 3.5-4.5%/yr bumps and about half
//             a month free per year of term; flex 3-5 years.
//   [ABS]     Lease-up: spec big-box industrial averaged 9-15 months on the
//             market after completion in 2023-24 (CBRE / Cushman industrial
//             reports); lenders underwrite 12-24 months for inline retail and
//             flex. These are the base durations at natural vacancy; the pro
//             forma scales them by the vacancy the scheme will open into, the
//             same way it scales every other class.
//   [BUILD]   Construction durations: a pad 6-9 months, a strip 9-12, a
//             neighbourhood centre 12-15, a community or power centre 14-18;
//             a tilt-up warehouse 9-14 months by size, flex 9-12, a plant
//             12-18 (NAIOP / general-contractor schedules).
//   [PWR]     Heavy manufacturing electrical service (3,000-4,000 A at 480 V,
//             pad-mount transformer, switchgear, bus duct) and an 8 in. slab:
//             about $15-25/sf over a distribution shell (RSMeans electrical
//             and concrete divisions).
import type { BuiltClass } from "./types";

export type ProductKey =
  | "pad" | "strip" | "neighborhood" | "community" | "power" | "grocery"
  | "flex" | "bulk" | "manufacturing";

/** A tenant signed before the shell goes up: an anchor, a junior anchor, a big box, or the one tenant of a single-tenant building. */
export interface AnchorSpec {
  label: string;
  /** How many of them (a power centre has several boxes). */
  n: number;
  /** Their combined share of the building's rentable feet. */
  share: number;
  /** Their rent as a fraction of the inline market rent at this address [LEASE]. */
  rentRatio: number;
  termY: number;
  bumpPct: number;
  /** Landlord allowance on their space, $/sf before the cost index. */
  tiPsf: number;
  /** Months free (fixturing) at the start of the term. */
  freeM: number;
  credit: 1 | 2;
}

export interface ProductType {
  key: ProductKey;
  /** A word or two for a button. */
  short: string;
  label: string;
  use: Extract<BuiltClass, "retail" | "industrial">;
  /** Gross building area the product comes in, sf [ICSC] [NAIOP]. */
  sf: [number, number];
  /** Site the product sits on, acres — only where the type is defined by its site (a pad). */
  siteAc?: [number, number];
  /** The published coverage band: a CHECK on the solved site plan, never an input. */
  coverBand: [number, number];
  /** Clear height, ft (industrial) — descriptive; the cost per sf carries it. */
  clearFt?: [number, number];
  /** Share of the building finished as office (industrial). */
  officeShare?: number;
  parkPer1000: number;
  /** Land per parking space including aisles [ULI-D]. */
  stallSf: number;
  /** Dock or grade doors per 10,000 sf, and the court + trailer stall each takes [NAIOP]. */
  doorsPer10k: number;
  courtSfPerDoor: number;
  /** Fixed paved area independent of size (a drive-through's stacking lane). */
  fixedPavedSf: number;
  /** Share of the site kept open: landscape setbacks, buffers, stormwater detention. */
  openShare: number;
  /** Building shell incl. base MEP, $/sf of building [RSM] [CW]. */
  shellPsf: number;
  /** Heavy power and slab (manufacturing) [PWR]. */
  powerPsf: number;
  /** Paving, curbs, lighting, storm per sf of paved area [RSM]. */
  pavePsf: number;
  /** Landscape and detention per sf of open ground. */
  openPsf: number;
  /** Landlord work on the spec / inline space, $/sf [LEASE]. */
  tiPsf: number;
  /** Lease commission as a share of the aggregate base rent of a typical term. */
  lcPct: number;
  /** The spec / inline space's typical lease [LEASE]. */
  lease: { recovery: "nnn"; termY: number; bumpPct: number; freeMPerYr: number };
  anchors: AnchorSpec[];
  /** Inline shop depth for the zoning method of shop rent (value.ts shopFrontMult), ft [ICSC]. */
  shopDepthFt?: number;
  /** The anchor's trade area, metres: inline shops trade on the shoppers it pulls from it [ICSC]. */
  tradeRadiusM?: number;
  /** Cap-rate spread against the class's base cap, percentage points [CBRE-C] [BG]. */
  capSpread: number;
  /** Months for the spec / inline space to fill at natural vacancy [ABS]. */
  leaseUpM: number;
  /** Construction months at the bottom and top of the size range [BUILD]. */
  buildM: [number, number];
  /** Typical suite the spec / inline space is demised into, sf. */
  suiteSf: number;
  /** One sentence for the desk. */
  blurb: string;
}

const RETAIL_STALL = 350;   // [ULI-D] top of 300-350: landscape islands
const INDUS_STALL = 330;    // [ULI-D] efficient layout, no islands
// [NAIOP] a door at 13 ft on centre with a 130 ft court (1,690 sf) plus a
// trailer stall and its share of the drive (~1,400 sf).
const BULK_COURT = 3_100;

export const PRODUCT_TYPES: Record<ProductKey, ProductType> = {
  pad: {
    key: "pad", short: "Pad", label: "Pad / single-tenant net lease", use: "retail",
    sf: [2_000, 15_000], siteAc: [0.5, 2], coverBand: [0.08, 0.26],
    // QSR codes run 10+ a thousand, pharmacies and banks 4-5 [ULI-P]; six is
    // the middle of the mix, plus a twelve-car drive-through lane (12 x 200 sf).
    parkPer1000: 6, stallSf: RETAIL_STALL, doorsPer10k: 0, courtSfPerDoor: 0, fixedPavedSf: 2_400,
    openShare: 0.25,
    // [RSM] fast food / bank ~$350, pharmacy ~$200: a blend of the three as a shell.
    shellPsf: 240, powerPsf: 0, pavePsf: 11, openPsf: 3, tiPsf: 0, lcPct: 0.04,
    lease: { recovery: "nnn", termY: 15, bumpPct: 2.0, freeMPerYr: 0 },
    anchors: [{ label: "single tenant", n: 1, share: 1, rentRatio: 1.0, termY: 15, bumpPct: 2.0, tiPsf: 40, freeM: 3, credit: 2 }],
    shopDepthFt: 60, capSpread: -0.5, leaseUpM: 0, buildM: [6, 9], suiteSf: 15_000,
    blurb: "One credit tenant on a 15-year NNN lease; trades tightest of the retail types.",
  },
  strip: {
    key: "strip", short: "Strip", label: "Strip / convenience centre", use: "retail",
    sf: [10_000, 30_000], coverBand: [0.2, 0.35],
    parkPer1000: 4.5, stallSf: RETAIL_STALL, doorsPer10k: 0, courtSfPerDoor: 0, fixedPavedSf: 0,
    // landscape ordinances (10-15%) and on-site detention (5-10%)
    openShare: 0.2,
    shellPsf: 165, powerPsf: 0, pavePsf: 10, openPsf: 3, tiPsf: 45, lcPct: 0.06,
    lease: { recovery: "nnn", termY: 5, bumpPct: 3.0, freeMPerYr: 0.5 },
    anchors: [],
    shopDepthFt: 60, capSpread: 0.4, leaseUpM: 18, buildM: [9, 12], suiteSf: 1_800,
    blurb: "Unanchored small shops on short leases: lets on the street's own footfall, and nothing else.",
  },
  neighborhood: {
    key: "neighborhood", short: "Grocery centre", label: "Neighbourhood centre (grocery-anchored)", use: "retail",
    sf: [30_000, 125_000], coverBand: [0.2, 0.33],
    parkPer1000: 5, stallSf: RETAIL_STALL, doorsPer10k: 0, courtSfPerDoor: 0, fixedPavedSf: 0,
    openShare: 0.2,
    shellPsf: 150, powerPsf: 0, pavePsf: 10, openPsf: 3, tiPsf: 45, lcPct: 0.06,
    lease: { recovery: "nnn", termY: 5, bumpPct: 3.0, freeMPerYr: 0.5 },
    anchors: [{ label: "grocer", n: 1, share: 0.45, rentRatio: 0.5, termY: 20, bumpPct: 1.0, tiPsf: 40, freeM: 6, credit: 2 }],
    shopDepthFt: 70, tradeRadiusM: 4_800, capSpread: -0.1, leaseUpM: 15, buildM: [12, 15], suiteSf: 2_000,
    blurb: "A grocer at half the inline rent for twenty years; its shoppers are what the shops pay for.",
  },
  community: {
    key: "community", short: "Community centre", label: "Community centre (junior anchors)", use: "retail",
    sf: [125_000, 400_000], coverBand: [0.2, 0.33],
    parkPer1000: 4.5, stallSf: RETAIL_STALL, doorsPer10k: 0, courtSfPerDoor: 0, fixedPavedSf: 0,
    openShare: 0.2,
    shellPsf: 140, powerPsf: 0, pavePsf: 10, openPsf: 3, tiPsf: 40, lcPct: 0.06,
    lease: { recovery: "nnn", termY: 5, bumpPct: 3.0, freeMPerYr: 0.5 },
    anchors: [{ label: "junior anchor", n: 3, share: 0.5, rentRatio: 0.6, termY: 12, bumpPct: 1.5, tiPsf: 30, freeM: 4, credit: 1 }],
    shopDepthFt: 75, tradeRadiusM: 8_000, capSpread: 0.1, leaseUpM: 18, buildM: [14, 18], suiteSf: 2_500,
    blurb: "Three junior anchors pull from five miles out; more inline space to fill behind them.",
  },
  power: {
    key: "power", short: "Power centre", label: "Power centre (big boxes)", use: "retail",
    sf: [250_000, 600_000], coverBand: [0.2, 0.32],
    parkPer1000: 5, stallSf: RETAIL_STALL, doorsPer10k: 0, courtSfPerDoor: 0, fixedPavedSf: 0,
    openShare: 0.2,
    shellPsf: 125, powerPsf: 0, pavePsf: 10, openPsf: 3, tiPsf: 35, lcPct: 0.06,
    lease: { recovery: "nnn", termY: 5, bumpPct: 3.0, freeMPerYr: 0.5 },
    anchors: [{ label: "big box", n: 4, share: 0.8, rentRatio: 0.55, termY: 10, bumpPct: 1.5, tiPsf: 25, freeM: 4, credit: 2 }],
    shopDepthFt: 80, tradeRadiusM: 12_000, capSpread: 0.5, leaseUpM: 15, buildM: [14, 18], suiteSf: 3_000,
    blurb: "Four category killers on ten-year leases; little inline, a regional draw, a wider cap.",
  },
  // THE GROCER'S OWN STORE: a free-standing supermarket built to suit for the
  // grocer that signs before the slab, on a twenty-year net lease. This is how
  // most new grocery stores get built in the 2020s (spec neighbourhood centres
  // rarely pencil; shopping-centre construction has run near record lows): the grocer
  // sizes the store to the trade area and the rent is what its sales carry
  // (proforma.ts, rec.grocerSales). No inline space: shops and pads can follow
  // on their own sites if they pencil. Region only (value.ts reads it where
  // a grocer's sales are known).
  grocery: {
    key: "grocery", short: "Grocery store", label: "Grocery store (built to suit)", use: "retail",
    // limited-assortment boxes run 12-20k sf, a conventional supermarket 40-50k (FMI median ~45k) [S, approximate]
    sf: [12_000, 70_000], coverBand: [0.2, 0.33],
    parkPer1000: 5, stallSf: RETAIL_STALL, doorsPer10k: 0, courtSfPerDoor: 0, fixedPavedSf: 0,
    openShare: 0.2,
    // [RSM] supermarket ~$195/sf building only
    shellPsf: 195, powerPsf: 0, pavePsf: 10, openPsf: 3, tiPsf: 0, lcPct: 0.04,
    lease: { recovery: "nnn", termY: 20, bumpPct: 1.0, freeMPerYr: 0 },
    anchors: [{ label: "grocer", n: 1, share: 1, rentRatio: 0.5, termY: 20, bumpPct: 1.0, tiPsf: 40, freeM: 6, credit: 2 }],
    // [BG] single-tenant net lease trades ~6.4-6.6% against grocery-anchored centres' 6.8-7.1% [CBRE-C]
    capSpread: -0.5, leaseUpM: 0, buildM: [9, 12], suiteSf: 70_000,
    blurb: "A supermarket built for its grocer on a twenty-year lease, its rent what its sales carry.",
  },
  flex: {
    key: "flex", short: "Flex", label: "Flex / light industrial", use: "industrial",
    sf: [10_000, 60_000], coverBand: [0.3, 0.42], clearFt: [18, 24], officeShare: 0.3,
    // [NAIOP] flex with ~30% office parks 2-3.5 a thousand; grade doors
    // every ~5,000 sf with a 60 ft apron (14 x 60 = 840 sf).
    parkPer1000: 2.5, stallSf: INDUS_STALL, doorsPer10k: 2, courtSfPerDoor: 840, fixedPavedSf: 0,
    openShare: 0.25,
    shellPsf: 105, powerPsf: 0, pavePsf: 9, openPsf: 3,
    // 30% office at ~$65 of finish plus warehouse lighting: [LEASE]
    tiPsf: 22, lcPct: 0.05,
    lease: { recovery: "nnn", termY: 4, bumpPct: 3.5, freeMPerYr: 0.5 },
    anchors: [], capSpread: 0.4, leaseUpM: 15, buildM: [9, 12], suiteSf: 5_000,
    blurb: "Small bays with office up front for trades and light assembly; short leases, many tenants.",
  },
  bulk: {
    key: "bulk", short: "Distribution", label: "Bulk warehouse / distribution", use: "industrial",
    sf: [100_000, 1_000_000], coverBand: [0.35, 0.5], clearFt: [32, 40], officeShare: 0.03,
    parkPer1000: 0.5, stallSf: INDUS_STALL, doorsPer10k: 1, courtSfPerDoor: BULK_COURT, fixedPavedSf: 0,
    // [NAIOP] detention 8-12% of a big site plus 50-100 ft landscaped
    // setbacks and buffers: 25-30% of the gross site kept open.
    openShare: 0.28,
    shellPsf: 72, powerPsf: 0, pavePsf: 11, openPsf: 3,
    // 3% office at ~$120 plus dock equipment and LED: [LEASE]
    tiPsf: 6, lcPct: 0.04,
    lease: { recovery: "nnn", termY: 7, bumpPct: 4.0, freeMPerYr: 0.5 },
    anchors: [], capSpread: -0.4, leaseUpM: 12, buildM: [9, 14], suiteSf: 1_000_000,
    blurb: "A low-cost tilt-up shell and a truck court, let whole to one user on a long NNN lease.",
  },
  manufacturing: {
    key: "manufacturing", short: "Plant", label: "Manufacturing plant", use: "industrial",
    sf: [50_000, 500_000], coverBand: [0.35, 0.52], clearFt: [24, 32], officeShare: 0.1,
    // shift workforce parks ~1 a thousand; a door per 20k sf
    parkPer1000: 1.0, stallSf: INDUS_STALL, doorsPer10k: 0.5, courtSfPerDoor: BULK_COURT, fixedPavedSf: 0,
    openShare: 0.25,
    shellPsf: 90, powerPsf: 20, pavePsf: 11, openPsf: 3, tiPsf: 0, lcPct: 0.04,
    lease: { recovery: "nnn", termY: 15, bumpPct: 3.0, freeMPerYr: 0 },
    // A plant is built for its user: the one tenant signs before the slab.
    anchors: [{ label: "manufacturer", n: 1, share: 1, rentRatio: 1.0, termY: 15, bumpPct: 3.0, tiPsf: 35, freeM: 3, credit: 1 }],
    // single-purpose, a narrow buyer pool: 50-100 bp over distribution [CBRE-C]
    capSpread: 0.7, leaseUpM: 0, buildM: [12, 18], suiteSf: 500_000,
    blurb: "Heavy power and a thick slab, built for one manufacturer: a narrow resale market.",
  },
};

export const PRODUCT_KEYS = Object.keys(PRODUCT_TYPES) as ProductKey[];
export const productOf = (k: string | undefined | null): ProductType | undefined =>
  k ? PRODUCT_TYPES[k as ProductKey] : undefined;

/** The products a use can be built as. */
export function productsForUse(use: string): ProductType[] {
  return PRODUCT_KEYS.map((k) => PRODUCT_TYPES[k]).filter((p) => p.use === use);
}

/** Paved land each square foot of building needs: parking and truck court. */
export function pavedPerSf(p: ProductType): number {
  return (p.parkPer1000 * p.stallSf) / 1000 + (p.doorsPer10k * p.courtSfPerDoor) / 10_000;
}

/**
 * THE SITE PLAN: the most of this lot a product's building can cover once its
 * car park, truck court and open ground are on it. One storey, so coverage is
 * also FAR.
 */
export function productFitCoverage(p: ProductType, lotSf: number): number {
  if (!(lotSf > 0)) return 0;
  return Math.max(0, (1 - p.openShare - p.fixedPavedSf / lotSf) / (1 + pavedPerSf(p)));
}

export interface ProductSite {
  /** Building footprint = gross area (one storey). */
  gsf: number;
  coverage: number;
  /** Parking, truck court and fixed paving, sf. */
  pavedSf: number;
  parkingSf: number;
  courtSf: number;
  /** Open ground (landscape, detention), sf. */
  openSf: number;
  /** Land left over beyond the product's plan (a big lot under a small product). */
  excessSf: number;
  stalls: number;
  doors: number;
}

/**
 * Lay the product out on a lot at a coverage no more than `coverage` (the
 * desk's dial) and no more than the site plan allows. Null when the lot cannot
 * carry the product's smallest building, or the site is outside its type
 * (a pad is defined by its outparcel).
 */
export function layoutProduct(p: ProductType, lotSf: number, coverage?: number): ProductSite | null {
  if (!(lotSf > 0)) return null;
  if (p.siteAc && (lotSf > p.siteAc[1] * 43_560 * 1.25 || lotSf < p.siteAc[0] * 43_560 * 0.8)) return null;
  const fit = productFitCoverage(p, lotSf);
  const cov = Math.max(0, Math.min(fit, coverage ?? fit));
  const openSf = Math.round(lotSf * p.openShare);
  // Whole stalls and whole doors: step the building down a hundred feet at a
  // time until they fit beside it.
  let gsf = Math.floor(Math.min(lotSf * cov, p.sf[1]) / 100) * 100;
  let stalls = 0, doors = 0, parkingSf = 0, courtSf = 0, pavedSf = 0;
  for (let i = 0; i < 400; i++) {
    stalls = Math.ceil((gsf / 1000) * p.parkPer1000);
    doors = Math.ceil((gsf / 10_000) * p.doorsPer10k);
    parkingSf = stalls * p.stallSf + p.fixedPavedSf;
    courtSf = doors * p.courtSfPerDoor;
    pavedSf = parkingSf + courtSf;
    if (gsf + pavedSf + openSf <= lotSf) break;
    gsf -= 100;
  }
  if (gsf < p.sf[0] || gsf + pavedSf + openSf > lotSf) return null;
  const excessSf = Math.max(0, Math.round(lotSf - gsf - pavedSf - openSf));
  return { gsf, coverage: gsf / lotSf, pavedSf, parkingSf, courtSf, openSf, excessSf, stalls, doors };
}

/** Months to build, by where the building sits in the product's size range [BUILD]. */
export function productBuildMonths(p: ProductType, gsf: number): number {
  const t = Math.max(0, Math.min(1, (gsf - p.sf[0]) / Math.max(1, p.sf[1] - p.sf[0])));
  return Math.round(p.buildM[0] + (p.buildM[1] - p.buildM[0]) * t);
}

/** Hard cost of the product before the cost index, contract premium and spec: shell, power, paving, landscape. */
export function productHardCostBase(p: ProductType, site: ProductSite): number {
  return site.gsf * (p.shellPsf + p.powerPsf) + site.pavedSf * p.pavePsf + site.openSf * p.openPsf;
}

/**
 * WHO SIGNS. Fictional names for the tenants a product is let to before it is
 * built, by the kind of anchor (dev.ts picks one by a hash of the site, so
 * pricing a scheme draws nothing from the world's random stream).
 */
export const ANCHOR_NAMES: Record<string, string[]> = {
  "grocer": ["Harvest Table Market", "County Fresh Foods", "Riverside Grocers", "Green Basket", "Prairie Pantry"],
  "junior anchor": ["Homestead Supply", "Northgate Outfitters", "Bramble Home", "Pinecrest Sports", "Linden Pet and Feed", "Cobalt Office Supply"],
  "big box": ["Keystone Home Center", "Atlas Electronics", "Summit Warehouse Club", "Fieldstone Furniture", "Granary Discount", "Mainline Hardware"],
  "single tenant": ["Corner Rx Pharmacy", "First Prairie Bank", "Burger Depot", "Morning Grind Coffee", "Tidewater Credit Union", "Quick Lube and Tire"],
  "manufacturer": ["Halvorsen Precision", "Ridgeway Plastics", "Ironbridge Fabrication", "Calder Food Processing", "Westfield Components"],
};

/** Share of the building's rentable feet let to anchors / the single tenant before ground breaks. */
export function anchorShare(p: ProductType): number {
  return p.anchors.reduce((a, x) => a + x.share, 0);
}
