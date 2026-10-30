// THE CITY'S INDUSTRIES — ONE ECONOMY, STEP 2b (2026-10-29): THE BEA'S 71.
//
// The engine's ten trades (types.ts `Sector`) are who rents a floor. They are
// not what a city makes, buys and sells. This file is the economy's list of
// industries: the BEA's 71 summary industries — the level at which the
// government publishes who buys from whom — less the one that is not a
// business (housing: the imputed rent of owner-occupied homes, which the
// household register already carries) and with two too small to stand alone
// merged (funds and trusts into securities; federal enterprises, the Postal
// Service, into federal civilian government): 68. Each carries the facts below;
// the screens group them into about twenty tenant types (`type`).
// ONE_ECONOMY_PLAN.md §2 and "Step 2b"; playable-out/INDUSTRIES_71.md.
//
// WHERE EACH ONE LIVES (`where`, INDUSTRIES_71.md §4b). All 68 stay in the
// accounts, because every firm's costs flow through them; only those with a
// home in the metro have firms and jobs here:
//   local     firms in the town's offices, shops and sheds (named on the map,
//             or the off-map sample), or on property of their own (hospitals,
//             schools, City Hall);
//   regional  the region's background facilities, off the island and off the
//             leasable floors — the airport, the freight rail yard, the
//             refinery, the steel works, the quarries and the farms and woods
//             at the region's edge. Regional firms with books, staffed by the
//             register's regional households; never named, never let;
//   outside   no firm in the metro (oil and gas wells, mining support,
//             pipelines): always bought from out of town.
//
// Since step 2 the town's jobs and its demand for space are these industries'
// (economy.ts), so every number here bears load.
//
// WHERE THE NUMBERS COME FROM. [S] a measured fact with a source, [D] derived
// here from such a fact by stated arithmetic, [K] a shape parameter stated as
// one, [S~] a fact rounded or read from memory of the source, to be checked
// against it (CLAUDE.md, NO FAKE NUMBERS).
//
//  - BEA, Input-Output Accounts, "The Use of Commodities by Industries,
//    Before Redefinitions (Producers' Prices) — Summary", 2023 sheet
//    (IOUse_Before_Redefinitions_PRO_1997-2023_Summary.xlsx, in
//    apps.bea.gov/industry/iTables Static Files/AllTablesIO.zip, released
//    Sep 2024), read by tools/gen-industries.py into industryData.ts. Every
//    column of the table closes: inputs + compensation + taxes + gross
//    operating surplus = output (the generator prints each to 0.002).
//      IO_A[i][j]        commodity j bought by industry i, per $ of i's output   [D]
//      comp, prodTax     compensation (V001) and taxes on production (V002) per $ [D]
//      gos               gross operating surplus (V003) per $ — the industry's
//                        EBITDA margin, which the firms' books are checked
//                        against                                                  [D]
//      rent              nonresidential rent (86% of the "Other real estate" row —
//                        the rest is brokerage and management fees, Economic
//                        Census 2017 NAICS 5312-5313 receipts over ORE output,
//                        and is the brokers' industry, `realestate`, whose own
//                        column is that 14% of ORE's) plus the housing row:
//                        paid to LANDLORDS, not to an industry                    [D]
//      primary           scrap and noncomparable imports — always from outside    [D]
//      foreignImport     imports (F050) over domestic supply of the commodity     [D]
//      foreignExport     exports (F040) over commodity output                     [D]
//      buyers            the commodity's uses: households = PCE (F010); firms =
//                        intermediate use by every industry but construction plus
//                        equipment, IP and inventory investment; government =
//                        federal and state-local (F06-F10); construction =
//                        intermediate use by construction plus structures and
//                        residential investment (F02S, F02R); exports = F040       [D]
//      exposure.oil      oil and gas plus refined petroleum in inputs per $       [D]
//      exposure.credit   investment (F02*, F030) share of the commodity's uses —
//                        the borrowed-for spending a credit crunch cuts first
//                        (Bernanke & Gertler 1995); 1 for banks, securities and
//                        real-estate services by definition                       [D]
//  - Employment (empK): BLS Current Employment Statistics, 2023 annual
//    averages, thousands, by the NAICS of each summary industry, rounded to
//    10-50k [S~]; farms and forestry, which CES does not cover, from the
//    QCEW 2023 (NAICS 111-112, 113-115) [S~]. Federal: civilian defence
//    (~780k) and the rest of the federal civilian workforce with the Postal
//    Service; state and local: CES, less ~1,000k in its enterprises (transit,
//    utilities, ports). Output per worker and pay per worker are BEA output
//    and compensation over these heads.
//  - Space per worker (sfPerWorker): office, CBRE and BOMA occupier surveys
//    (~150-250 sf a worker, CBRE ~194, 2018-19; each industry's place in the
//    range [K]); plants, EIA MECS 2018 enclosed floorspace over manufacturing
//    employment (~500-1,500 sf, heavy process at the top); sheds and shops,
//    EIA CBECS 2018 floorspace per worker by building activity. Rounded,
//    [S~]: each class's demand driver is indexed to the opening, so a level
//    error cancels and a mix error does not.
//  - offFloor, remote, natTrend, cycleBeta: see OFF_FLOOR, NAT_TREND below.
import type { Sector } from "./types";
import { RAW, IO_RAW, INDUSTRY_IDS, COMP_PER_WORKER_2023, type IndustryId } from "./industryData";
export { INDUSTRY_IDS, COMP_PER_WORKER_2023, type IndustryId };

export const N_IND = INDUSTRY_IDS.length;
export const INDUSTRY_INDEX: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k, i) => [k, i])) as Record<IndustryId, number>;

/** The BEA summary industries summed into each (the IO table's columns and rows). */
export const BEA_CODES: Record<IndustryId, readonly string[]> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAW[k].bea])) as Record<IndustryId, readonly string[]>;

export type SpaceType = "office" | "industrial-mfg" | "industrial-warehouse" | "retail" | "special";
export type BuyerType = "households" | "firms" | "government" | "construction" | "exports";
export const BUYER_TYPES: readonly BuyerType[] = ["households", "firms", "government", "construction", "exports"];
export type Where = "local" | "regional" | "outside";

export interface Industry {
  id: IndustryId;
  label: string;
  /** The tenant type the screens group it under (about twenty). */
  type: string;
  group: "making" | "moving" | "selling" | "office" | "other";
  space: SpaceType;
  /** Where its firms are (see the header). */
  where: Where;
  /** Square feet a worker takes [S~]; see the header. */
  sfPerWorker: number;
  /** US employment, thousands (CES 2023) [S~]. */
  empK: number;
  /** Gross output per worker, $k of 2023 [D]. */
  outPerWorkerK: number;
  /** Compensation per worker over the all-industry average (COMP_PER_WORKER_2023) [D]. */
  wageRel: number;
  /** Per $ of output: compensation, taxes on production, gross operating surplus, rent, primary inputs [D]. */
  comp: number; prodTax: number; gos: number; rent: number; primary: number;
  /** Foreign import share of supply, and export share of output, of its commodity [D]. */
  foreignImport: number; foreignExport: number;
  /** Who buys its commodity, shares of all uses [D]. */
  buyers: Record<BuyerType, number>;
  /** What moves it, 0..1 [D]. */
  exposure: { oil: number; credit: number; construction: number; world: number };
}

export const INDUSTRIES: Record<IndustryId, Industry> = Object.fromEntries(INDUSTRY_IDS.map((id) => {
  const r = RAW[id];
  const outPerWorkerK = r.outM / r.empK;
  return [id, {
    id, label: r.label, type: r.type, group: r.group, space: r.space, where: r.where,
    sfPerWorker: r.sfPerWorker, empK: r.empK,
    outPerWorkerK, wageRel: (r.comp * outPerWorkerK * 1000) / COMP_PER_WORKER_2023,
    comp: r.comp, prodTax: r.prodTax, gos: r.gos, rent: r.rent, primary: r.primary,
    foreignImport: r.foreignImport, foreignExport: r.foreignExport,
    buyers: r.buyers, exposure: r.exposure,
  } satisfies Industry];
})) as Record<IndustryId, Industry>;

/** IO_A[i][j]: what industry i buys from industry j per dollar of i's output (INDUSTRY_IDS order). */
export const IO_A: Record<IndustryId, readonly number[]> = IO_RAW;
/** Household purchases at producer prices, 2023, $bn (BEA Use table column F010). The within-category mix of the household budget. [S] */
export const PCE_2023_BN: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAW[k].pceBn])) as Record<IndustryId, number>;

/** Share of US employment, CES 2023 [D]. */
export const NAT_EMP_SHARE: Record<IndustryId, number> = (() => {
  const tot = INDUSTRY_IDS.reduce((a, k) => a + INDUSTRIES[k].empK, 0);
  return Object.fromEntries(INDUSTRY_IDS.map((k) => [k, INDUSTRIES[k].empK / tot])) as Record<IndustryId, number>;
})();

/** Total input coefficient bought from the industries, per $ of output (row sum of IO_A) [D]. */
export const IO_ROW_SUM: Record<IndustryId, number> = Object.fromEntries(
  INDUSTRY_IDS.map((k) => [k, IO_A[k].reduce((a, x) => a + x, 0)])) as Record<IndustryId, number>;

/** The tenant types the screens group the industries under, in the order they list them. */
export const TENANT_TYPES: readonly string[] = [...new Set(INDUSTRY_IDS.map((k) => INDUSTRIES[k].type))];

// ---------------------------------------------------------------- the roles the books give some of them
/** State and local government: its heads follow the register's people (economy.ts `staff`); its output is the city's provision. */
export const IND_ID_GOV: IndustryId = "slGov";
/** The building trades: what the town builds and repairs (economy.ts `constructionBought`). */
export const IND_ID_CON: IndustryId = "construction";
/** Insurance carriers: they keep what an employer's health premium does not pay out in claims (MLR). */
export const IND_ID_INS: IndustryId = "insurance";
/** Warehousing: where the online share of a shop's margin is earned (economy.ts `spendVector`). */
export const IND_ID_ONLINE: IndustryId = "warehousing";
/** The shops whose margin the online share moves. */
export const RETAIL_IDS: readonly IndustryId[] = ["autodealers", "grocers", "genmerch", "retail"];
/**
 * HEALTH CARE, AND HOW A HEALTH DOLLAR SPLITS: the care households' own
 * spending, their employers' insurance and Washington buy, by what US
 * households' health consumption buys of each (PCE at producer prices, BEA
 * Use 2023: ambulatory $1,456bn, hospitals $1,431bn, nursing $311bn) [D].
 */
export const HEALTH_SPLIT: Partial<Record<IndustryId, number>> = (() => {
  const ids: IndustryId[] = ["ambulatory", "hospitals", "nursing"];
  const tot = ids.reduce((a, k) => a + PCE_2023_BN[k], 0);
  return Object.fromEntries(ids.map((k) => [k, PCE_2023_BN[k] / tot]));
})();

// ---------------------------------------------------------------- the old trades
/**
 * THE ENGINE'S TEN TRADES, BY THE FLOOR THEY RENT, AS INDUSTRIES. A trade on a
 * floor is drawn into the industries that rent that kind of floor, weighted
 * by their US employment (CES 2023, thousands, as INDUSTRIES' empK) [S~]:
 *   office  finance -> banks 2,620 / securities 1,030 / real-estate brokers
 *           and managers 1,172 (QCEW 2023 NAICS 5312-5313); insurance -> insurance; law -> law firms;
 *           design -> accounting, consulting, design and R&D; tech -> IT
 *           services 2,500 / data and internet 870 / software publishing 830;
 *           media -> broadcasting 900 / film and music 450 / publishing 830;
 *           medical -> doctors and clinics; logistics -> freight forwarding;
 *           a food or apparel firm's office is its head office.
 *   retail  apparel -> other shops (clothing); food -> restaurants 12,400 /
 *           grocers 3,150; medical -> doctors and clinics.
 *   sheds   logistics -> wholesale 6,100 / warehousing 1,850 / trucking 1,560
 *           / couriers and forwarding 1,865; food -> food plants 1,990 /
 *           grocery wholesalers ~850; apparel -> textile mills 210 / apparel
 *           110 / apparel wholesalers ~150.
 * A firm's industry is its trade's: a law firm is never drawn a headquarters.
 * Industries with no trade here (metal works, machinery, hospitals, City
 * Hall...) are the off-map sample's, and new firms form for them on the
 * street too (streetRolls.ts `formFor`).
 */
export type Floor = "office" | "retail" | "industrial";
export const TRADE_TO_INDUSTRY: Record<Floor, Partial<Record<Sector, readonly [IndustryId, number][]>>> = {
  office: {
    finance: [["banks", 2620], ["securities", 1030], ["realestate", 1172]], insurance: [["insurance", 1]],
    law: [["legal", 1]], design: [["professional", 1]],
    tech: [["compdesign", 2500], ["data", 870], ["publishing", 830]],
    media: [["telecom", 900], ["film", 450], ["publishing", 830]],
    medical: [["ambulatory", 1]], logistics: [["transportsup", 1]], food: [["hq", 1]], apparel: [["hq", 1]],
  },
  retail: {
    apparel: [["retail", 1]], food: [["restaurants", 12400], ["grocers", 3150]], medical: [["ambulatory", 1]],
  },
  industrial: {
    logistics: [["wholesale", 6100], ["warehousing", 1850], ["trucking", 1560], ["transportsup", 1865]],
    food: [["food", 1990], ["wholesale", 850]], apparel: [["textiles", 210], ["apparel", 110], ["wholesale", 150]],
  },
};
/** A floor's industry when its trade has no row above. */
export const FLOOR_DEFAULT: Record<Floor, IndustryId> = { office: "professional", retail: "retail", industrial: "wholesale" };

/**
 * HOW EACH INDUSTRY IS FINANCED: the engine trade whose books (market.ts
 * FIRM_PROFILE — leverage as debt over EBITDA, the floating share, the credit
 * spread) it borrows. One answer to how a trade borrows, not a second table.
 * Government — and the city's enterprises — borrow through bonds, not a bank,
 * and have none.
 */
export const FINANCE_LIKE: Record<IndustryId, Sector | null> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAW[k].financeLike])) as Record<IndustryId, Sector | null>;

// ---------------------------------------------------------------- households
/**
 * WHAT A HOUSEHOLD SPENDS ITS NON-HOUSING BUDGET ON. BLS Consumer Expenditure
 * Survey 2023 (Sep 2024 release), all consumer units, dollars a year, rounded
 * to $50 [S]: food at home 6,050; food away 3,950; alcohol 650; tobacco 350;
 * apparel and services 2,050; utilities, fuels and public services 4,600
 * (telephone ~1,500 of it); household operations 1,800; housekeeping supplies
 * 900; furnishings and equipment 2,450; vehicle purchases 4,950; gasoline
 * 2,450; other vehicle expenses 4,900; public transport 950; health care
 * 6,150; entertainment 3,650; personal care 950; reading 100; education 1,650;
 * miscellaneous 1,100. Shelter (14,950), cash contributions and personal
 * insurance and pensions are left out: shelter is the household register's
 * rent or mortgage, the other two are not purchases. Grouped [S~ where a
 * category is split, e.g. entertainment into goods and fees]:
 *   groceries   food and alcohol at home, tobacco                       6,800
 *   goods       apparel, furnishings, supplies, vehicles, gasoline,
 *               entertainment goods, personal-care products, reading,
 *               drugs                                                    15,700
 *   eatingOut   food and alcohol away                                    4,200
 *   services    utilities and phone, household operations, vehicle
 *               repair, insurance and finance, transport, admissions,
 *               personal-care services, childcare, miscellaneous        15,950
 *   health      health care                                              6,150
 *   education   education                                                1,650
 * Within each, the dollars go to industries in proportion to what US
 * households buy from them at producer prices (BEA Use table 2023, PCE column
 * F010, PCE_2023_BN) — so a dollar of goods pays the plant, the wholesaler and
 * the shop their national shares [D]. The shops' margin on groceries goes to
 * grocers and to supercentres and warehouse clubs, which sell about 30% of US
 * food at home (USDA ERS, Food Expenditure Series) [S~]; on goods, to car
 * dealers, the general merchandisers' other 70% and the other shops, by their
 * PCE. Health: providers 93%, net health insurance 7% (BEA NIPA T2.4.5 2023:
 * health care services $3.05T against net health insurance $0.21T) [S].
 */
export type SpendCategory = "groceries" | "goods" | "eatingOut" | "services" | "health" | "education";
export const CE_2023: Record<SpendCategory, number> = {
  groceries: 6800, goods: 15700, eatingOut: 4200, services: 15950, health: 6150, education: 1650,
};
export const SPEND_SHARE: Record<SpendCategory, number> = (() => {
  const tot = Object.values(CE_2023).reduce((a, x) => a + x, 0);
  return Object.fromEntries(Object.entries(CE_2023).map(([k, v]) => [k, v / tot])) as Record<SpendCategory, number>;
})();
type Bridge = Partial<Record<IndustryId | "primary", number>>;
const GROCERY: readonly IndustryId[] = ["food", "farms", "forestry"];
const GOODS: readonly IndustryId[] = [
  "apparel", "textiles", "paper", "printing", "fabmetal", "machinery", "electronics", "electrical", "vehicles", "aerospace",
  "furniture", "miscmfg", "petroleum", "chemicals", "plastics", "wood", "minerals", "primetals", "mining",
];
const SERVICES: readonly IndustryId[] = [
  "utilities", "telecom", "publishing", "film", "data", "transit", "air", "rail", "water", "trucking", "transportsup",
  "banks", "securities", "insurance", "realestate", "rental", "legal", "professional", "admin", "waste", "social",
  "otherservices", "arts", "recreation", "hotels", "slEnt", "fedCivil",
];
const pce = (k: IndustryId) => PCE_2023_BN[k] ?? 0;
function pceMix(keys: readonly IndustryId[], scale: number, w: (k: IndustryId) => number = pce): Bridge {
  const tot = keys.reduce((a, k) => a + w(k), 0);
  return Object.fromEntries(keys.map((k) => [k, scale * w(k) / tot]));
}
/** Supercentres' and warehouse clubs' share of food-at-home sales (USDA ERS) [S~]. */
const GENMERCH_GROCERY = 0.3;
const RETAIL_PCE = RETAIL_IDS.reduce((a, k) => a + pce(k), 0);
/** Margins on household goods at producer prices: PCE wholesale and retail over PCE goods plus both [D]. */
const GOODS_PRODUCER = (() => {
  const g = [...GOODS, ...GROCERY].reduce((a, k) => a + pce(k), 0);
  return g / (g + pce("wholesale") + RETAIL_PCE);
})();
const W_MARGIN = pce("wholesale") / (pce("wholesale") + RETAIL_PCE) * (1 - GOODS_PRODUCER);
const R_MARGIN = 1 - GOODS_PRODUCER - W_MARGIN;
const groceryShops = (k: IndustryId) => (k === "grocers" ? pce(k) : k === "genmerch" ? GENMERCH_GROCERY * pce(k) : 0);
const goodsShops = (k: IndustryId) => (k === "grocers" ? 0 : k === "genmerch" ? (1 - GENMERCH_GROCERY) * pce(k) : pce(k));
/**
 * A category's dollar, by industry. The shops' part is their margin, of which
 * the online share (market.ts `e.online`, the engine's own) is earned by
 * warehousing-and-fulfilment rather than a shopfront — see economy.ts.
 */
export const SPEND_BRIDGE: Record<SpendCategory, Bridge> = {
  groceries: { ...pceMix(GROCERY, GOODS_PRODUCER), wholesale: W_MARGIN, ...pceMix(["grocers", "genmerch"], R_MARGIN, groceryShops) },
  goods: { ...pceMix(GOODS, GOODS_PRODUCER), wholesale: W_MARGIN, ...pceMix(["autodealers", "genmerch", "retail"], R_MARGIN, goodsShops) },
  eatingOut: { restaurants: 1 },
  services: pceMix(SERVICES, 1),
  health: { ...pceMix(Object.keys(HEALTH_SPLIT) as IndustryId[], 0.93), insurance: 0.07 },
  education: { education: 1 },
};

// ---------------------------------------------------------------- where the work sits (step 2)
/**
 * WHERE EACH INDUSTRY'S WORKERS SIT (step 2; split by industry in 2b).
 *
 *   offFloor   on property of its own that is not the leasable stock [S~]:
 *     hospitals, nursing homes 1.0; private schools and colleges 0.9 (tutoring
 *              and training centres in rented space the rest);
 *     doctors and clinics 0.26 — offices of physicians 2,950k, dentists
 *              1,060k, other practitioners 1,170k, outpatient centres 1,070k
 *              (~6,250k of 8,400k, CES 2023) rent office or shop floor; home
 *              health and the rest do not;
 *     childcare and social services 0.75 — day-care centres and agencies'
 *              offices in rented space, home care (most of it) not;
 *     state and local government 1.0 (its own schools, offices, stations,
 *              yards); its enterprises 1.0 (depots, plants, piers); federal
 *              defence 1.0 (bases); federal civilian 0.64 — GSA FY2023 leased
 *              177M of 363M rentable sf (0.49) for the ~1,610k outside the
 *              Postal Service: 1 - 0.49 x 1,610 / 2,210;
 *     construction 1.0 (yards, depots and the sites);
 *     utilities 0.8 (plants and yards; their offices the rest); transit 0.9
 *              (depots and stations); theatres, stadiums and museums 0.7;
 *              hotels 1.0 (the game does not let hotel rooms);
 *     the region's facilities and the port 1.0 — runways, yards, refinery,
 *              mills, quarries, fields, piers.
 *   remote     whose workplace is their home: ACS 2019 (1-year), 5.7% of
 *              workers worked from home (Census, 2022); the industry split
 *              leans on BLS, "Job Flexibilities and Work Schedules 2017-18"
 *              (USDL-19-1691) — about 50% able to work at home in financial
 *              activities and professional services against about 10% in
 *              retail and leisure — the 5.7% shared in that proportion,
 *              rounded [S~]. Space is not taken for them.
 *   the rest   on the floor its industry rents (`space`): office, shop or shed.
 */
export const OFF_FLOOR: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAW[k].offFloor])) as Record<IndustryId, number>;
export const REMOTE: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAW[k].remote])) as Record<IndustryId, number>;
/** The leasable class each industry's on-floor workers rent. */
export function floorOf(i: IndustryId): Floor {
  const sp = INDUSTRIES[i].space;
  return sp === "retail" ? "retail" : sp.startsWith("industrial") ? "industrial" : "office";
}
/**
 * THE FLOOR A HEAD TAKES, BY INDUSTRY, against its class's (FORMULA_LEDGER
 * #10). A firm's space is its heads times its industry's feet a worker —
 * `sfPerWorker` less the share who work from home (`REMOTE`) — a law firm's
 * 250 sf against a call centre's 200, a restaurant's 250 against a car
 * dealer's 1,000. The engine's class constant (market.ts SF_PER_JOB) carries
 * the level and this the industry's place against the class's mean, weighted
 * by the nation's on-floor workers in each (CES 2023 × (1 - offFloor)): the
 * header's own rule — sfPerWorker is rounded, so its level error must cancel
 * and its mix must not. An industry on another class's floor (a wholesaler's
 * office), or one with no figure, takes the class's mean.
 */
const FLOOR_MEAN: Record<Floor, number> = (() => {
  const acc: Record<Floor, [number, number]> = { office: [0, 0], retail: [0, 0], industrial: [0, 0] };
  for (const k of INDUSTRY_IDS) {
    const I = INDUSTRIES[k];
    if (!(I.sfPerWorker > 0)) continue;
    const w = I.empK * (1 - OFF_FLOOR[k]);
    const a = acc[floorOf(k)];
    a[0] += w * I.sfPerWorker * (1 - REMOTE[k]); a[1] += w;
  }
  return { office: acc.office[0] / acc.office[1], retail: acc.retail[0] / acc.retail[1], industrial: acc.industrial[0] / acc.industrial[1] };
})();
export function sfMix(ind: number | undefined, k: Floor): number {
  if (ind === undefined || ind < 0 || ind >= N_IND) return 1;
  const id = INDUSTRY_IDS[ind], I = INDUSTRIES[id];
  if (!(I.sfPerWorker > 0) || floorOf(id) !== k) return 1;
  return I.sfPerWorker * (1 - REMOTE[id]) / FLOOR_MEAN[k];
}
/**
 * THE TOWN'S JOBS OFF THE COMMERCIAL FLOORS, as a share of all its jobs: the
 * national share of the industries that work from buildings of their own —
 * hospitals, schools, City Hall, depots, the region's airport and yards —
 * which a region has in proportion to its size, whatever its floors hold [D]:
 * the sum of empK x offFloor over the metro's industries (construction, left
 * to its demand, and the out-of-town ones apart) over their employment.
 */
export const OFF_FLOOR_SHARE_NAT = (() => {
  const metro = INDUSTRY_IDS.filter((k) => INDUSTRIES[k].where !== "outside");
  const tot = metro.reduce((a, k) => a + INDUSTRIES[k].empK, 0);
  return metro.filter((k) => k !== IND_ID_CON).reduce((a, k) => a + INDUSTRIES[k].empK * OFF_FLOOR[k], 0) / tot;
})();

// ---------------------------------------------------------------- what the rest of the country buys (step 2)
/**
 * THE NATION'S DEMAND FOR EACH INDUSTRY, as employment: the town is a small
 * open economy and sells its exports into the national market for them, so an
 * export industry's jobs here follow that industry's jobs in the nation —
 * through its trend, its cycle — and the town's share of them.
 *
 * NAT_TREND: US payroll growth a year, 1990 to 2019, BLS CES annual averages
 * (thousands, rounded) [S~], by summary industry: food, drink and tobacco
 * 1,640 -> 1,790 (+0.24%); textile mills 690 -> 230; apparel and leather 1,000
 * -> 120; paper 640 -> 370; printing 820 -> 420; primary metals 690 -> 380;
 * fabricated metal 1,610 -> 1,440; machinery 1,410 -> 1,090; motor vehicles and
 * parts 1,055 -> 1,000; aerospace, ships and other 1,080 -> 690; computers and
 * electronics 1,900 -> 1,070; electrical 630 -> 400; chemicals 1,040 -> 840;
 * plastics 830 -> 730; petroleum 150 -> 110; wood 540 -> 400; furniture 600 ->
 * 380; miscellaneous 690 -> 600; nonmetallic minerals 530 -> 410; wholesale
 * 5,270 -> 5,900; warehousing 410 -> 1,180; trucking 1,120 -> 1,520; transit
 * 270 -> 500; air 530 -> 500; rail 270 -> 230; utilities 740 -> 550; car
 * dealers 1,650 -> 2,050; grocers 2,780 -> 3,060; general merchandise 2,500 ->
 * 3,100; other retail 6,250 -> 7,400; restaurants 6,600 -> 12,250; hotels
 * 1,620 -> 2,100; arts 390 -> 530; recreation 790 -> 1,670; other services
 * 4,260 -> 5,900; waste 230 -> 400; publishing 870 -> 760; film 255 -> 430;
 * broadcasting and telecoms 1,250 -> 870; data and internet 250 -> 650; IT
 * services 410 -> 2,250; banks 2,250 -> 2,700; securities and funds 470 ->
 * 970; insurance 2,020 -> 2,800; real estate 1,300 -> 1,640; rental and
 * leasing 550 -> 630; legal 910 -> 1,140; other professional 2,300 -> 5,700;
 * administrative and support 3,600 -> 9,000; headquarters 1,670 -> 2,420;
 * private education 1,690 -> 3,800; ambulatory 2,850 -> 7,700; hospitals 3,510
 * -> 5,200; nursing 1,860 -> 3,400; social assistance 1,100 -> 4,300;
 * construction 5,260 -> 7,490; federal 3,100 -> 2,810; state and local 15,200
 * -> 19,800; logging 85 -> 50; oil and gas 190 -> 160; other mining 270 ->
 * 200; mining support 150 -> 320. Farms are not in CES: hired farm employment
 * roughly flat (USDA ERS), 0. These carry the labour-force growth of their
 * years (0.9% a year, 1990-2019); since they move only each trade's share of
 * the nation's labour force (NAT_LABOUR_FORCE_GROWTH, below), that common
 * part cancels.
 *
 * CYCLE_BETA: each industry's payroll swing per unit of the nation's, BLS CES
 * December 2007 to its trough against total nonfarm (-6.3%) [S~]: motor
 * vehicles and parts about -40% (6.3); wood, furniture and textiles -30%
 * (4.8); mining support -30% (4.8); primary metals -28% (4.4); construction
 * -27% (4.3); apparel -27% (4.3); nonmetallic minerals and logging -25%
 * (4.0); plastics -22% (3.5); fabricated metal -21% (3.4); car dealers and
 * printing -20% (3.2); machinery -18% (2.9); electrical -17% (2.7); rental and
 * leasing -15% (2.4); administrative and support (temp help -30%) -13% (2.1);
 * trucking and rail -13% (2.1); computers and electronics, paper and
 * publishing -12% (1.9); couriers and transport support, mining -10% (1.6);
 * misc manufacturing -10% (1.6); real estate, telecoms, hotels, other retail
 * -9% (1.4); professional services -9% (1.4); wholesale and banks -8% (1.3);
 * air -8% (1.3); warehousing -7% (1.1); insurance -7% (1.1); chemicals,
 * securities and water transport -6% (1.0); arts and recreation -5% (0.8);
 * film -5% (0.8); other services -4% (0.6); petroleum -4% (0.6); legal, IT
 * services, headquarters, aerospace and general merchandise -3% (0.5);
 * restaurants -3% (0.5); food plants and farms -2% (0.3); grocers -1% (0.2);
 * health, education, social assistance, government, utilities, transit and
 * oil and gas held or rose (0). It moves what the nation buys of the town's
 * exports; what the town buys of itself moves with the town's own incomes.
 */
/**
 * THE NATION'S LABOUR FORCE, its growth a year [S~]. The trades' trends above
 * are rates each trade grew at while the whole workforce grew 0.9% a year
 * (BLS CPS 1990-2019, 125.8M to 163.5M); compounded trade by trade for a
 * century they do not add up to a nation — at its own mix they multiply its
 * payrolls about elevenfold, the fast trades (health, IT, staffing) carrying
 * the sum, where US payrolls grew about 3.5x over the twentieth century (BLS
 * nonfarm, 1919-2019, on a labour force that more than tripled). So the
 * nation's employment in a trade is its labour force times the trade's share
 * (economy.ts `tickExports`): the trends move the shares — each trade's against
 * the rest, renormalised, so tech and care gain on apparel and print — and the
 * labour force sets the total. Its growth is CBO's projection of the potential
 * labour force, about 0.4% a year over 2024-34 and 0.3% over 2035-54 (CBO, The
 * Demographic Outlook 2024-2054 and Long-Term Budget Outlook, 2024): the
 * boomers retiring and fertility under replacement. Past 2054 nobody
 * projects; it holds there.
 */
export const NAT_LABOUR_FORCE_GROWTH = 0.0035;
export const NAT_TREND: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAW[k].natTrend])) as Record<IndustryId, number>;
export const CYCLE_BETA: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAW[k].cycleBeta])) as Record<IndustryId, number>;

/**
 * HOW LONG A TRADE'S LEAD OVER THE NATION LASTS (PROOF.md #4). NAT_TREND is
 * what each trade grew at over 1990-2019; held as the centre of its trend for
 * a century, IT services gain ~5% a year on the nation's mix for ever and a
 * town heavy in them outgrows any recession. The record says a lead fades:
 * the 1990s' fast growers grew a fraction as fast against the nation in the
 * next two decades. BLS CES annual averages (thousands) [S~], 1990 / 2000 /
 * 2019, each window's growth less total nonfarm's (109,530 / 132,020 /
 * 150,900):
 *   computer systems design      410 /  1,250 /  2,250
 *   employment services        1,510 /  3,850 /  3,750
 *   securities and funds         460 /    805 /    970
 *   health care                7,810 / 10,860 / 16,370
 *   manufacturing             17,700 / 17,260 / 12,810
 *   restaurants and bars       6,570 /  8,110 / 12,200
 *   construction               5,260 /  6,790 /  7,490
 *   retail                    13,180 / 15,280 / 15,600
 *   federal government         3,200 /  2,870 /  2,800
 *   information                2,690 /  3,630 /  2,860
 * The least-squares slope of the 2000-19 lead on the 1990s' lead (through the
 * origin: the nation's own growth carries no lead) is what of a lead is left
 * 14.5 years on, midpoint to midpoint; its half-life is NAT_TREND_HALF_Y.
 * Each trade's centre over the nation's (the opening mix's mean trend) fades
 * at that half-life from the opening (economy.ts `tickExports`); the wander
 * about it (market.ts NAT_TREND_SD, NAT_TREND_TAU_M) is untouched, so trades
 * still drift apart — no lead is promised for ever.
 */
const LEAD_RECORD: readonly (readonly [number, number, number])[] = [
  [410, 1250, 2250], [1510, 3850, 3750], [460, 805, 970], [7810, 10860, 16370], [17700, 17260, 12810],
  [6570, 8110, 12200], [5260, 6790, 7490], [13180, 15280, 15600], [3200, 2870, 2800], [2690, 3630, 2860],
];
export const NAT_TREND_HALF_Y = (() => {
  const nf = [109530, 132020, 150900];
  const g = (a: number, b: number, y: number) => Math.log(b / a) / y;
  let xy = 0, xx = 0;
  for (const [a, b, c] of LEAD_RECORD) {
    const x = g(a, b, 10) - g(nf[0], nf[1], 10), y = g(b, c, 19) - g(nf[1], nf[2], 19);
    xy += x * y; xx += x * x;
  }
  const kept = Math.min(0.99, Math.max(0.01, xy / xx));
  return 14.5 * Math.LN2 / -Math.log(kept);
})();
/** The opening mix's mean trend: the part of every trade's trend that is the nation's, not a lead over it. */
export const NAT_TREND_MEAN = (() => {
  let s = 0, w = 0;
  for (const k of INDUSTRY_IDS) { s += NAT_EMP_SHARE[k] * NAT_TREND[k]; w += NAT_EMP_SHARE[k]; }
  return w > 0 ? s / w : 0;
})();

/**
 * HOW A BUYER WEIGHS PRICE AGAINST QUALITY, ONE NUMBER AN INDUSTRY: the
 * elasticity of substitution between its suppliers, by Rauch's (1999, JIE)
 * classification of what it sells — goods traded on an organised exchange
 * (homogeneous), goods with a reference price in the trade press, and
 * differentiated goods. Services are not in Rauch's goods; they sell on
 * reputation and fit, and are classed differentiated here [K].
 *
 * Broda & Weinstein (2006, QJE, "Globalization and the gains from variety")
 * estimate these elasticities product by product and find them highest for
 * Rauch's commodities and lowest for differentiated goods, with medians round
 * three for the disaggregated goods. The levels [S~]: differentiated 3 (their
 * median); reference-priced 5 (1 + the trade elasticity of about 4,
 * Simonovska & Waugh 2014 — economy.ts used it for every industry before);
 * homogeneous 10 [K: a commodity's sellers are near-perfect substitutes, and
 * past ten price is all that matters]. A buyer's choice among suppliers
 * (economy.ts `tickExports`, `tickLinks`) weighs a supplier's quality (a
 * demand shifter, Khandelwal 2010; Hallak & Schott 2011) once and its price
 * against its kind's to the power -SUBST_ELAST: steel is bought on price, a
 * lawyer on quality.
 */
export type Rauch = "homogeneous" | "reference" | "differentiated";
const RAUCH_OF: Partial<Record<IndustryId, Rauch>> = {
  farms: "homogeneous", forestry: "homogeneous", oilgas: "homogeneous", mining: "homogeneous",
  primetals: "homogeneous", petroleum: "homogeneous", pipelines: "homogeneous", utilities: "homogeneous",
  wood: "reference", minerals: "reference", fabmetal: "reference", food: "reference", textiles: "reference",
  paper: "reference", chemicals: "reference", plastics: "reference", miningsup: "reference",
  wholesale: "reference", trucking: "reference", rail: "reference", water: "reference", warehousing: "reference",
};
export const RAUCH: Record<IndustryId, Rauch> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, RAUCH_OF[k] ?? "differentiated"])) as Record<IndustryId, Rauch>;
const SUBST_BY_RAUCH: Record<Rauch, number> = { homogeneous: 10, reference: 5, differentiated: 3 };
export const SUBST_ELAST: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k) => [k, SUBST_BY_RAUCH[RAUCH[k]]])) as Record<IndustryId, number>;

/**
 * A SAVE FROM BEFORE STEP 2b numbered its firms', earners' and tenants'
 * industries in the 24 of step 2. Each old industry's largest successor by US
 * employment (economy.ts reopens the books on the 68; households.ts and the
 * street's tenants are renumbered with this).
 */
export const OLD24_TO_68: readonly IndustryId[] = [
  "food", "textiles", "printing", "fabmetal", "machinery", "electronics", "chemicals", "wood", "minerals",
  "wholesale", "warehousing", "trucking",
  "retail", "restaurants", "otherservices",
  "banks", "insurance", "realestate", "admin", "compdesign", "hq",
  "ambulatory", "construction", "slGov",
];

// ---------------------------------------------------------------- who pays for health care (step 2)
/**
 * HEALTH CARE IS MOSTLY PAID BY SOMEONE ELSE. The household budget (CE_2023)
 * carries what households pay themselves — premiums and out of pocket — but
 * BEA's personal consumption of health care counts the care itself, most of
 * it paid by employers' insurance and by Washington. Without those two the
 * town's hospitals had a seventh of their customers. CMS National Health
 * Expenditure Accounts 2023 [S]: Medicare $1,029.8bn; Medicaid $871.7bn, of
 * which the federal share ~64% (MACPAC FMAP, FY2023) = $558bn; over 334.9M
 * people (Census) = $4,742 a person a year paid from outside the town. An
 * employer's insurance contribution (PAY_SPLIT.insurance) buys care at the
 * medical loss ratio — 80-85% of premium paid out in claims (ACA MLR rule; 85%
 * large group) — the rest is the insurer's [S].
 */
export const FED_HEALTH_PER_PERSON_2023 = (1029.8 + 0.64 * 871.7) * 1e9 / 334.9e6;
export const MLR = 0.85;

// ---------------------------------------------------------------- pay, tax and owners
/**
 * WHERE A DOLLAR OF COMPENSATION GOES. BLS Employer Costs for Employee
 * Compensation, private industry, Dec 2023: wages and salaries 70.6%, paid
 * leave 7.4%, supplemental pay 3.3% (all three cash to the worker); insurance
 * 7.6%; retirement 3.5%; legally required (Social Security, Medicare, UI)
 * 7.6% [S].
 */
export const PAY_SPLIT = { cash: 0.813, insurance: 0.076, retirement: 0.035, payrollTax: 0.076 } as const;
/** Taxes on production and imports: state and local's share, NIPA 2023 (federal excise and customs ~ $0.18T of ~$1.93T) [S~]. */
export const PROD_TAX_LOCAL = 0.91;
/** Federal corporate income tax rate (TCJA 2017) — the same 21% the engine's tenant books pay [S]. */
export const CORP_TAX = 0.21;
/** State and local income and sales taxes on a household, about 4% of income (ITEP; households.ts TAX_RATES) [S]. */
export const HH_LOCAL_TAX = 0.04;
/**
 * The share of a firm's payout that stays in town: proprietors' income
 * (~$1.9T, NIPA 2023) over proprietors' plus corporate profits (~$3.3T) —
 * owner-run firms pay their owners here; a corporation's shareholders are the
 * whole country, of which one town holds a negligible slice [D~].
 */
export const LOCAL_OWNER_SHARE = 0.37;

// ---------------------------------------------------------------- what the trades are paid for (step 1b)
/**
 * MAINTENANCE AND REPAIR OF THE STANDING STOCK. In the BEA's accounts the
 * repair of a building is construction output bought as an intermediate
 * input by whoever owns it — commodities 230301 (nonresidential maintenance
 * and repair, $204.4bn in 2017) and 230302 (residential, $84.5bn): about a
 * fifth of the construction industry's output, and none of it in the
 * pipeline of new building. The industries in IO_A already buy their own
 * share through the table's construction column; the buildings' OWNERS are
 * not an industry here (they are the landlords' account, and owner-occupiers
 * are households), so their repairs are what the first cut was missing.
 * BEA Input-Output, Use Before Redefinitions, Producers' Prices, 2017 detail
 * (IOUse_Before_Redefinitions_PRO_2017_Detail.xlsx, the 2017 sheet; the
 * benchmark year — the summary table does not split the construction row):
 *   commercial landlords  531ORE (other real estate: lessors of nonresidential
 *                         buildings and the rest) buys $43,151M of 230301 on
 *                         an output of $1,265,027M — 3.41 cents a dollar of rent  [D]
 *   flats let to tenants  531HST (tenant-occupied housing) buys $3,791M of 230302
 *                         on $480,396M — 0.79 cents a dollar of rent (improvements
 *                         to rental housing are investment, F02R, not repair)       [D]
 *   owner-occupiers       531HSO buys $71,972M of 230302; over owner-occupied real
 *                         estate at market value, $26,664,700M at end-2017 (Federal
 *                         Reserve Z.1, FL155035015) — 0.27% of the house's value a year [D]
 */
export const REPAIR_PER_COMMERCIAL_RENT = 43151 / 1265027;
export const REPAIR_PER_FLAT_RENT = 3791 / 480396;
export const REPAIR_OWNER_PER_VALUE_YR = 71972 / 26664700;

/**
 * THE PRICE OF OIL. The town opens in 2000 (types.ts START_YEAR) at that
 * year's WTI average, $30.38 a barrel (EIA, Cushing spot, annual) [S]; it
 * moves with the nation's prices (`natCpi`) and, in real terms, with the
 * nation's supply shocks — the same shocks the engine's inflation already
 * runs (market.ts, SUPPLY SHOCKS; the embargo swan sets one), read the same
 * way the engine reads them (a shock under fiscal pressure is demand, not
 * supply). OIL_PER_SHOCK is the real price, in log points, that a supply
 * shock of one point of annual inflation carries, calibrated to the two
 * oil-led episodes [K, calibrated]: 1973-74, real crude about x3 (+1.1 log;
 * EIA refiner acquisition cost) against about 7 points of excess CPI
 * inflation; 1979-80, about x2.5 (+0.9) against about 4.5 points — 16 and
 * 20, so 18. A favourable shock (a decade of cheap oil: 1986, 1998) runs it
 * the other way. The price rises over a quarter and gives back half of a
 * shock's real rise in three years [K]: real oil stayed high for a decade
 * after 1974 and fell back within months after 1990.
 */
export const OIL_PRICE_2000 = 30.38;
export const OIL_PER_SHOCK = 18;
export const OIL_RISE_M = 3, OIL_HALF_LIFE_M = 36;
