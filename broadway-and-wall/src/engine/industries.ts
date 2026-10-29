// THE CITY'S INDUSTRIES — ONE ECONOMY, STEP 0 (2026-10-28).
//
// The engine's ten trades (types.ts `Sector`) are who rents a floor. They are
// not what a city makes, buys and sells: nobody in them makes anything, and
// the jobs that are not on a commercial floor (the hospital, the school, the
// trades on a site, City Hall) are not in them at all. This file is the
// economy's list of industries — 24, the plan's ~18 with manufacturing kept
// apart where its cycles differ (oil-heavy chemicals, construction-led
// building materials, world-led machinery and electronics) — and the facts
// each one carries. ONE_ECONOMY_PLAN.md §2.
//
// Since step 2 (2026-10-28) the town's jobs and its demand for space are these
// industries' (economy.ts), so every number here bears load.
//
// WHERE THE NUMBERS COME FROM. Constants carry [S] when they are a measured
// fact with a source, [D] when they are DERIVED here from such a fact by
// stated arithmetic, and [K] when they are a shape parameter, stated as one
// (CLAUDE.md, NO FAKE NUMBERS).
//
//  - BEA, Input-Output Accounts, "The Use of Commodities by Industries,
//    Before Redefinitions (Producers' Prices) — Summary", 2023 sheet
//    (IOUse_Before_Redefinitions_PRO_1997-2023_Summary.xlsx, in
//    apps.bea.gov/industry/iTables Static Files/AllTablesIO.zip, released
//    Sep 2024). The 71 summary industries are summed into the 24 below (the
//    BEA codes are listed with each). Every column of the table closes
//    exactly: inputs + compensation + taxes + gross operating surplus = output.
//      IO_A[i][j]        commodity j bought by industry i, per $ of i's output   [D]
//      comp, prodTax     compensation (V001) and taxes on production (V002) per $ [D]
//      gos               gross operating surplus (V003) per $ — the industry's
//                        EBITDA margin, which is what the shadow books' margins
//                        are checked against                                      [D]
//      rent              nonresidential rent (86% of the "Other real estate" row —
//                        the rest is brokerage and management fees, Economic
//                        Census 2017 NAICS 5312-5313 receipts over ORE output)
//                        plus housing rows: paid to LANDLORDS, not to an industry [D]
//      primary           farms, forestry, oil and gas, mining, scrap and
//                        noncomparable imports — always bought from outside       [D]
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
//                        (Bernanke & Gertler 1995); 1 for banking and real-estate
//                        services by definition, their product IS credit and
//                        financed transactions                                    [D]
//      exposure.construction  = buyers.construction                               [D]
//      exposure.world    = foreignExport                                          [D]
//  - BLS Current Employment Statistics, 2023 annual averages, thousands,
//    rounded to the nearest 5-50k (empK). Output per worker and pay per worker
//    are BEA output and compensation over these heads.                            [S]
//  - Space per worker (sfPerWorker). Load-bearing since step 2: each class's
//    demand driver is its industries' heads on the floor at these feet a head.
//    Office: CBRE and BOMA occupier surveys put US office space at about
//    150-250 sf per worker (CBRE ~194 average, 2018-19), dense for tech and
//    back offices, roomy for law and headquarters — each industry's place in
//    that range is [K]. Manufacturing: EIA MECS 2018 enclosed floorspace over
//    BLS manufacturing employment runs ~500-1,500 sf a worker, heavy process
//    industries at the top; warehouses and retail: EIA CBECS 2018 floorspace
//    per worker by building activity. Rounded to 50-100 sf and approximate —
//    [S~], to be checked against the tables (the drivers are indexed to the
//    opening, so a level error cancels; a mix error does not). The engine's own
//    SF_PER_JOB (market.ts: 230 / 420 / 550) still turns a STREET firm's feet
//    into heads.
import type { Sector } from "./types";

export type IndustryId =
  | "food" | "apparel" | "printing" | "metals" | "machinery" | "electronics" | "chemicals" | "wood" | "bldgmat"
  | "wholesale" | "fulfil" | "transport"
  | "shops" | "restaurants" | "personal"
  | "finance" | "insurance" | "realestate" | "professional" | "techmedia" | "hq"
  | "healthedu" | "construction" | "government";

export const INDUSTRY_IDS: readonly IndustryId[] = [
  "food", "apparel", "printing", "metals", "machinery", "electronics", "chemicals", "wood", "bldgmat",
  "wholesale", "fulfil", "transport",
  "shops", "restaurants", "personal",
  "finance", "insurance", "realestate", "professional", "techmedia", "hq",
  "healthedu", "construction", "government",
];
export const N_IND = INDUSTRY_IDS.length;
export const INDUSTRY_INDEX: Record<IndustryId, number> = Object.fromEntries(INDUSTRY_IDS.map((k, i) => [k, i])) as Record<IndustryId, number>;

/** The BEA summary industries summed into each (the IO table's columns and rows). */
export const BEA_CODES: Record<IndustryId, readonly string[]> = {
  food: ["311FT"], apparel: ["313TT", "315AL"], printing: ["322", "323"], metals: ["331", "332"],
  machinery: ["333", "3361MV", "3364OT"], electronics: ["334", "335"], chemicals: ["324", "325", "326"],
  wood: ["321", "337", "339"], bldgmat: ["327"],
  wholesale: ["42"], fulfil: ["493"], transport: ["22", "481", "482", "483", "484", "485", "486", "487OS"],
  shops: ["441", "445", "452", "4A0"], restaurants: ["721", "722"], personal: ["81", "711AS", "713", "562"],
  finance: ["521CI", "523", "525"], insurance: ["524"], realestate: ["532RL", "ORE x0.14"],
  professional: ["5411", "5412OP", "561"], techmedia: ["511", "512", "513", "514", "5415"], hq: ["55"],
  healthedu: ["61", "621", "622", "623", "624"], construction: ["23"],
  government: ["GFGD", "GFGN", "GFE", "GSLG", "GSLE"],
};

export type SpaceType = "office" | "industrial-mfg" | "industrial-warehouse" | "retail" | "special";
export type BuyerType = "households" | "firms" | "government" | "construction" | "exports";
export const BUYER_TYPES: readonly BuyerType[] = ["households", "firms", "government", "construction", "exports"];

export interface Industry {
  id: IndustryId;
  label: string;
  group: "making" | "moving" | "selling" | "office" | "other";
  space: SpaceType;
  /** Square feet a worker takes [S~]; see the header. */
  sfPerWorker: number;
  /** US employment, thousands (CES 2023) [S]. */
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

/** Compensation per worker, all 24 industries, 2023 dollars: BEA compensation (V001) over BLS CES employment. [S] */
export const COMP_PER_WORKER_2023 = 89100;
export const INDUSTRIES: Record<IndustryId, Industry> = {
  food: { id: "food", label: "Food and drink plants", group: "making", space: "industrial-mfg", sfPerWorker: 900,
    empK: 1720, outPerWorkerK: 686, wageRel: 1.00,
    comp: 0.129, prodTax: 0.024, gos: 0.131, rent: 0.005, primary: 0.248,
    foreignImport: 0.11, foreignExport: 0.06,
    buyers: { households: 0.59, firms: 0.36, government: 0.00, construction: 0.00, exports: 0.06 },
    exposure: { oil: 0.003, credit: 0.00, construction: 0.00, world: 0.06 } },
  apparel: { id: "apparel", label: "Apparel and textiles", group: "making", space: "industrial-mfg", sfPerWorker: 600,
    empK: 320, outPerWorkerK: 231, wageRel: 0.72,
    comp: 0.279, prodTax: 0.016, gos: 0.104, rent: 0.011, primary: 0.024,
    foreignImport: 0.71, foreignExport: 0.16,
    buyers: { households: 0.78, firms: 0.17, government: 0.00, construction: 0.01, exports: 0.05 },
    exposure: { oil: 0.001, credit: 0.00, construction: 0.01, world: 0.16 } },
  printing: { id: "printing", label: "Paper and printing", group: "making", space: "industrial-mfg", sfPerWorker: 800,
    empK: 740, outPerWorkerK: 392, wageRel: 0.94,
    comp: 0.215, prodTax: 0.012, gos: 0.179, rent: 0.014, primary: 0.019,
    foreignImport: 0.10, foreignExport: 0.09,
    buyers: { households: 0.09, firms: 0.82, government: 0.00, construction: 0.01, exports: 0.08 },
    exposure: { oil: 0.007, credit: 0.00, construction: 0.01, world: 0.09 } },
  metals: { id: "metals", label: "Metals and metal products", group: "making", space: "industrial-mfg", sfPerWorker: 1000,
    empK: 1845, outPerWorkerK: 407, wageRel: 0.99,
    comp: 0.217, prodTax: 0.011, gos: 0.135, rent: 0.009, primary: 0.056,
    foreignImport: 0.21, foreignExport: 0.10,
    buyers: { households: 0.04, firms: 0.74, government: 0.00, construction: 0.14, exports: 0.08 },
    exposure: { oil: 0.005, credit: 0.02, construction: 0.14, world: 0.10 } },
  machinery: { id: "machinery", label: "Machinery and vehicles", group: "making", space: "industrial-mfg", sfPerWorker: 900,
    empK: 2890, outPerWorkerK: 569, wageRel: 1.20,
    comp: 0.188, prodTax: 0.009, gos: 0.148, rent: 0.004, primary: 0.003,
    foreignImport: 0.31, foreignExport: 0.21,
    buyers: { households: 0.14, firms: 0.63, government: 0.06, construction: 0.02, exports: 0.14 },
    exposure: { oil: 0.001, credit: 0.32, construction: 0.02, world: 0.21 } },
  electronics: { id: "electronics", label: "Electronics and electrical equipment", group: "making", space: "industrial-mfg", sfPerWorker: 600,
    empK: 1520, outPerWorkerK: 383, wageRel: 1.79,
    comp: 0.416, prodTax: 0.022, gos: 0.222, rent: 0.007, primary: 0.004,
    foreignImport: 0.53, foreignExport: 0.26,
    buyers: { households: 0.18, firms: 0.62, government: 0.02, construction: 0.06, exports: 0.12 },
    exposure: { oil: 0.002, credit: 0.24, construction: 0.06, world: 0.26 } },
  chemicals: { id: "chemicals", label: "Chemicals, plastics and pharma", group: "making", space: "industrial-mfg", sfPerWorker: 1300,
    empK: 1745, outPerWorkerK: 1195, wageRel: 1.37,
    comp: 0.102, prodTax: 0.015, gos: 0.289, rent: 0.005, primary: 0.203,
    foreignImport: 0.20, foreignExport: 0.19,
    buyers: { households: 0.26, firms: 0.55, government: 0.00, construction: 0.04, exports: 0.15 },
    exposure: { oil: 0.201, credit: 0.01, construction: 0.04, world: 0.19 } },
  wood: { id: "wood", label: "Wood, furniture and other goods", group: "making", space: "industrial-mfg", sfPerWorker: 1100,
    empK: 1355, outPerWorkerK: 327, wageRel: 1.03,
    comp: 0.280, prodTax: 0.009, gos: 0.188, rent: 0.010, primary: 0.041,
    foreignImport: 0.32, foreignExport: 0.11,
    buyers: { households: 0.31, firms: 0.44, government: 0.00, construction: 0.17, exports: 0.07 },
    exposure: { oil: 0.005, credit: 0.15, construction: 0.17, world: 0.11 } },
  bldgmat: { id: "bldgmat", label: "Building materials", group: "making", space: "industrial-mfg", sfPerWorker: 1400,
    empK: 420, outPerWorkerK: 385, wageRel: 1.00,
    comp: 0.232, prodTax: 0.013, gos: 0.229, rent: 0.008, primary: 0.069,
    foreignImport: 0.17, foreignExport: 0.05,
    buyers: { households: 0.08, firms: 0.38, government: 0.00, construction: 0.49, exports: 0.04 },
    exposure: { oil: 0.004, credit: 0.00, construction: 0.49, world: 0.05 } },
  wholesale: { id: "wholesale", label: "Wholesale and distribution", group: "moving", space: "industrial-warehouse", sfPerWorker: 1500,
    empK: 6100, outPerWorkerK: 466, wageRel: 1.30,
    comp: 0.249, prodTax: 0.108, gos: 0.225, rent: 0.038, primary: 0.003,
    foreignImport: 0.00, foreignExport: 0.10,
    buyers: { households: 0.29, firms: 0.54, government: 0.02, construction: 0.05, exports: 0.10 },
    exposure: { oil: 0.002, credit: 0.12, construction: 0.05, world: 0.10 } },
  fulfil: { id: "fulfil", label: "E-commerce fulfilment and storage", group: "moving", space: "industrial-warehouse", sfPerWorker: 900,
    empK: 1850, outPerWorkerK: 97, wageRel: 0.68,
    comp: 0.621, prodTax: 0.008, gos: 0.025, rent: 0.053, primary: 0.003,
    foreignImport: 0.00, foreignExport: 0.00,
    buyers: { households: 0.00, firms: 1.00, government: 0.00, construction: 0.00, exports: 0.00 },
    exposure: { oil: 0.019, credit: 0.00, construction: 0.00, world: 0.00 } },
  transport: { id: "transport", label: "Trucking, transport and utilities", group: "moving", space: "industrial-warehouse", sfPerWorker: 1200,
    empK: 5260, outPerWorkerK: 420, wageRel: 1.13,
    comp: 0.239, prodTax: 0.060, gos: 0.277, rent: 0.015, primary: 0.026,
    foreignImport: 0.02, foreignExport: 0.06,
    buyers: { households: 0.36, firms: 0.56, government: 0.00, construction: 0.02, exports: 0.06 },
    exposure: { oil: 0.054, credit: 0.02, construction: 0.02, world: 0.06 } },
  shops: { id: "shops", label: "Shops and groceries", group: "selling", space: "retail", sfPerWorker: 600,
    empK: 15600, outPerWorkerK: 178, wageRel: 0.58,
    comp: 0.290, prodTax: 0.121, gos: 0.228, rent: 0.078, primary: 0.003,
    foreignImport: 0.00, foreignExport: 0.00,
    buyers: { households: 0.87, firms: 0.08, government: 0.00, construction: 0.05, exports: 0.00 },
    exposure: { oil: 0.001, credit: 0.05, construction: 0.05, world: 0.00 } },
  restaurants: { id: "restaurants", label: "Restaurants and hotels", group: "selling", space: "retail", sfPerWorker: 250,
    empK: 16700, outPerWorkerK: 100, wageRel: 0.36,
    comp: 0.323, prodTax: 0.076, gos: 0.147, rent: 0.057, primary: 0.011,
    foreignImport: 0.00, foreignExport: 0.00,
    buyers: { households: 0.75, firms: 0.25, government: 0.00, construction: 0.00, exports: 0.00 },
    exposure: { oil: 0.003, credit: 0.00, construction: 0.00, world: 0.00 } },
  personal: { id: "personal", label: "Personal services, leisure and repair", group: "selling", space: "retail", sfPerWorker: 450,
    empK: 8820, outPerWorkerK: 193, wageRel: 0.78,
    comp: 0.362, prodTax: 0.045, gos: 0.165, rent: 0.082, primary: 0.042,
    foreignImport: 0.00, foreignExport: 0.00,
    buyers: { households: 0.65, firms: 0.34, government: 0.00, construction: 0.01, exports: 0.00 },
    exposure: { oil: 0.004, credit: 0.00, construction: 0.01, world: 0.00 } },
  finance: { id: "finance", label: "Banking and securities", group: "office", space: "office", sfPerWorker: 200,
    empK: 3650, outPerWorkerK: 659, wageRel: 2.13,
    comp: 0.288, prodTax: 0.014, gos: 0.236, rent: 0.034, primary: 0.024,
    foreignImport: 0.00, foreignExport: 0.07,
    buyers: { households: 0.39, firms: 0.53, government: 0.00, construction: 0.01, exports: 0.07 },
    exposure: { oil: 0.003, credit: 1.00, construction: 0.01, world: 0.07 } },
  insurance: { id: "insurance", label: "Insurance", group: "office", space: "office", sfPerWorker: 190,
    empK: 2950, outPerWorkerK: 467, wageRel: 1.40,
    comp: 0.268, prodTax: 0.033, gos: 0.223, rent: 0.016, primary: 0.001,
    foreignImport: 0.04, foreignExport: 0.02,
    buyers: { households: 0.34, firms: 0.64, government: 0.00, construction: 0.00, exports: 0.02 },
    exposure: { oil: 0.000, credit: 0.00, construction: 0.00, world: 0.02 } },
  realestate: { id: "realestate", label: "Real estate services and leasing", group: "office", space: "office", sfPerWorker: 230,
    empK: 2450, outPerWorkerK: 380, wageRel: 0.86,
    comp: 0.203, prodTax: 0.037, gos: 0.256, rent: 0.055, primary: 0.003,
    foreignImport: 0.00, foreignExport: 0.10,
    buyers: { households: 0.10, firms: 0.73, government: 0.00, construction: 0.07, exports: 0.10 },
    exposure: { oil: 0.003, credit: 1.00, construction: 0.07, world: 0.10 } },
  professional: { id: "professional", label: "Law, accounting, consulting and business services", group: "office", space: "office", sfPerWorker: 210,
    empK: 17100, outPerWorkerK: 229, wageRel: 1.10,
    comp: 0.429, prodTax: 0.016, gos: 0.202, rent: 0.033, primary: 0.003,
    foreignImport: 0.03, foreignExport: 0.05,
    buyers: { households: 0.07, firms: 0.81, government: 0.05, construction: 0.02, exports: 0.05 },
    exposure: { oil: 0.002, credit: 0.17, construction: 0.02, world: 0.05 } },
  techmedia: { id: "techmedia", label: "Technology and media", group: "office", space: "office", sfPerWorker: 175,
    empK: 5550, outPerWorkerK: 581, wageRel: 1.94,
    comp: 0.297, prodTax: 0.024, gos: 0.289, rent: 0.024, primary: 0.005,
    foreignImport: 0.02, foreignExport: 0.05,
    buyers: { households: 0.24, firms: 0.67, government: 0.04, construction: 0.01, exports: 0.05 },
    exposure: { oil: 0.001, credit: 0.26, construction: 0.01, world: 0.05 } },
  hq: { id: "hq", label: "Company headquarters", group: "office", space: "office", sfPerWorker: 225,
    empK: 2450, outPerWorkerK: 320, wageRel: 2.03,
    comp: 0.566, prodTax: 0.016, gos: 0.059, rent: 0.052, primary: 0.003,
    foreignImport: 0.00, foreignExport: 0.01,
    buyers: { households: 0.00, firms: 0.97, government: 0.00, construction: 0.03, exports: 0.01 },
    exposure: { oil: 0.001, credit: 0.00, construction: 0.03, world: 0.01 } },
  healthedu: { id: "healthedu", label: "Health and education", group: "other", space: "special", sfPerWorker: 500,
    empK: 25450, outPerWorkerK: 148, wageRel: 0.84,
    comp: 0.506, prodTax: 0.013, gos: 0.106, rent: 0.066, primary: 0.001,
    foreignImport: 0.00, foreignExport: 0.00,
    buyers: { households: 0.97, firms: 0.02, government: 0.00, construction: 0.00, exports: 0.00 },
    exposure: { oil: 0.002, credit: 0.00, construction: 0.00, world: 0.00 } },
  construction: { id: "construction", label: "Construction trades", group: "other", space: "special", sfPerWorker: 400,
    empK: 7950, outPerWorkerK: 294, wageRel: 1.05,
    comp: 0.319, prodTax: 0.006, gos: 0.198, rent: 0.011, primary: 0.013,
    foreignImport: 0.00, foreignExport: 0.00,
    buyers: { households: 0.00, firms: 0.15, government: 0.18, construction: 0.66, exports: 0.00 },
    exposure: { oil: 0.022, credit: 0.66, construction: 0.66, world: 0.00 } },
  government: { id: "government", label: "Government", group: "other", space: "office", sfPerWorker: 230,
    empK: 22950, outPerWorkerK: 222, wageRel: 1.18,
    comp: 0.473, prodTax: 0.000, gos: 0.137, rent: 0.010, primary: 0.009,
    foreignImport: 0.00, foreignExport: 0.00,
    buyers: { households: 0.03, firms: 0.03, government: 0.94, construction: 0.00, exports: 0.00 },
    exposure: { oil: 0.032, credit: 0.00, construction: 0.00, world: 0.00 } },
};
/** IO_A[i][j]: what industry i buys from industry j per dollar of i's output (INDUSTRY_IDS order). */
export const IO_A: Record<IndustryId, readonly number[]> = {
  food: [0.159, 0.000, 0.023, 0.017, 0.008, 0.004, 0.029, 0.000, 0.002, 0.090, 0.003, 0.052, 0.002, 0.001, 0.004, 0.006, 0.005, 0.006, 0.019, 0.005, 0.025, 0.000, 0.003, 0.001],
  apparel: [0.005, 0.152, 0.006, 0.011, 0.001, 0.007, 0.147, 0.003, 0.000, 0.060, 0.018, 0.030, 0.001, 0.001, 0.003, 0.016, 0.005, 0.042, 0.029, 0.005, 0.021, 0.000, 0.002, 0.001],
  printing: [0.003, 0.012, 0.184, 0.027, 0.013, 0.011, 0.068, 0.016, 0.001, 0.065, 0.012, 0.054, 0.006, 0.003, 0.007, 0.007, 0.002, 0.009, 0.035, 0.010, 0.010, 0.000, 0.006, 0.001],
  metals: [0.000, 0.000, 0.005, 0.307, 0.011, 0.018, 0.022, 0.001, 0.005, 0.075, 0.001, 0.044, 0.001, 0.002, 0.005, 0.012, 0.003, 0.007, 0.033, 0.009, 0.008, 0.000, 0.004, 0.001],
  machinery: [0.000, 0.003, 0.005, 0.111, 0.242, 0.052, 0.035, 0.006, 0.005, 0.090, 0.000, 0.020, 0.006, 0.001, 0.002, 0.008, 0.004, 0.009, 0.022, 0.008, 0.017, 0.000, 0.002, 0.000],
  electronics: [0.000, 0.000, 0.003, 0.075, 0.007, 0.101, 0.017, 0.003, 0.003, 0.048, 0.001, 0.011, 0.001, 0.000, 0.001, 0.008, 0.002, 0.004, 0.025, 0.003, 0.012, 0.000, 0.001, 0.000],
  chemicals: [0.004, 0.001, 0.005, 0.010, 0.005, 0.005, 0.198, 0.002, 0.002, 0.059, 0.003, 0.037, 0.002, 0.001, 0.003, 0.005, 0.002, 0.005, 0.019, 0.002, 0.010, 0.000, 0.005, 0.001],
  wood: [0.000, 0.011, 0.010, 0.054, 0.010, 0.013, 0.056, 0.116, 0.004, 0.070, 0.004, 0.031, 0.004, 0.002, 0.004, 0.013, 0.003, 0.006, 0.034, 0.010, 0.012, 0.000, 0.002, 0.001],
  bldgmat: [0.004, 0.001, 0.012, 0.028, 0.004, 0.005, 0.038, 0.002, 0.103, 0.050, 0.012, 0.084, 0.002, 0.003, 0.009, 0.007, 0.008, 0.008, 0.029, 0.014, 0.016, 0.000, 0.007, 0.001],
  wholesale: [0.001, 0.001, 0.006, 0.002, 0.004, 0.019, 0.012, 0.004, 0.000, 0.027, 0.014, 0.042, 0.000, 0.006, 0.012, 0.017, 0.016, 0.024, 0.095, 0.016, 0.049, 0.001, 0.002, 0.008],
  fulfil: [0.000, 0.000, 0.001, 0.006, 0.020, 0.002, 0.020, 0.001, 0.000, 0.014, 0.039, 0.060, 0.000, 0.002, 0.005, 0.002, 0.012, 0.032, 0.048, 0.005, 0.010, 0.000, 0.006, 0.004],
  transport: [0.000, 0.000, 0.002, 0.004, 0.009, 0.001, 0.049, 0.002, 0.000, 0.016, 0.006, 0.118, 0.010, 0.007, 0.010, 0.020, 0.018, 0.036, 0.047, 0.009, 0.008, 0.000, 0.006, 0.004],
  shops: [0.002, 0.002, 0.004, 0.001, 0.005, 0.002, 0.005, 0.002, 0.001, 0.014, 0.024, 0.034, 0.004, 0.004, 0.008, 0.010, 0.007, 0.022, 0.076, 0.021, 0.023, 0.001, 0.005, 0.004],
  restaurants: [0.052, 0.001, 0.007, 0.004, 0.002, 0.001, 0.010, 0.002, 0.002, 0.022, 0.001, 0.028, 0.008, 0.018, 0.017, 0.024, 0.008, 0.034, 0.046, 0.031, 0.055, 0.000, 0.005, 0.008],
  personal: [0.005, 0.001, 0.003, 0.007, 0.016, 0.007, 0.011, 0.003, 0.001, 0.015, 0.001, 0.020, 0.004, 0.005, 0.043, 0.014, 0.006, 0.022, 0.074, 0.022, 0.014, 0.006, 0.004, 0.002],
  finance: [0.000, 0.000, 0.002, 0.000, 0.000, 0.002, 0.004, 0.000, 0.000, 0.002, 0.000, 0.014, 0.000, 0.016, 0.010, 0.190, 0.016, 0.014, 0.085, 0.030, 0.012, 0.000, 0.004, 0.002],
  insurance: [0.000, 0.000, 0.005, 0.000, 0.000, 0.000, 0.002, 0.000, 0.000, 0.001, 0.000, 0.002, 0.000, 0.003, 0.005, 0.005, 0.357, 0.006, 0.056, 0.011, 0.005, 0.000, 0.001, 0.000],
  realestate: [0.000, 0.000, 0.002, 0.004, 0.005, 0.001, 0.009, 0.002, 0.001, 0.023, 0.002, 0.028, 0.002, 0.023, 0.029, 0.050, 0.030, 0.039, 0.131, 0.013, 0.032, 0.000, 0.011, 0.007],
  professional: [0.001, 0.000, 0.005, 0.003, 0.008, 0.007, 0.023, 0.002, 0.002, 0.014, 0.004, 0.014, 0.002, 0.014, 0.014, 0.010, 0.006, 0.017, 0.117, 0.039, 0.012, 0.000, 0.001, 0.002],
  techmedia: [0.000, 0.000, 0.004, 0.006, 0.002, 0.016, 0.005, 0.001, 0.001, 0.015, 0.001, 0.015, 0.000, 0.009, 0.019, 0.014, 0.003, 0.018, 0.113, 0.111, 0.007, 0.000, 0.002, 0.001],
  hq: [0.000, 0.000, 0.002, 0.001, 0.002, 0.014, 0.004, 0.000, 0.000, 0.011, 0.000, 0.010, 0.000, 0.009, 0.019, 0.054, 0.001, 0.058, 0.110, 0.008, 0.000, 0.000, 0.001, 0.001],
  healthedu: [0.009, 0.001, 0.004, 0.002, 0.003, 0.004, 0.031, 0.013, 0.002, 0.021, 0.001, 0.017, 0.000, 0.024, 0.012, 0.011, 0.014, 0.015, 0.073, 0.016, 0.019, 0.011, 0.002, 0.002],
  construction: [0.000, 0.001, 0.002, 0.057, 0.021, 0.025, 0.047, 0.040, 0.040, 0.058, 0.000, 0.025, 0.047, 0.001, 0.006, 0.007, 0.000, 0.019, 0.043, 0.008, 0.008, 0.000, 0.000, 0.000],
  government: [0.020, 0.001, 0.006, 0.004, 0.020, 0.008, 0.047, 0.003, 0.001, 0.022, 0.002, 0.029, 0.000, 0.008, 0.024, 0.014, 0.006, 0.005, 0.065, 0.048, 0.000, 0.008, 0.028, 0.003],
};
/** Household purchases at producer prices, 2023, $bn (BEA Use table column F010). The within-category mix of HH_SPEND. [S] */
export const PCE_2023_BN: Partial<Record<IndustryId | "primary", number>> = {food: 784, apparel: 199, printing: 28, metals: 33, machinery: 330, electronics: 188, chemicals: 655, wood: 193, bldgmat: 16, wholesale: 787, fulfil: 0, transport: 868, shops: 2316, restaurants: 1338, personal: 1300, finance: 939, insurance: 497, realestate: 107, professional: 341, techmedia: 707, healthedu: 3995, government: 99, primary: 188};

/** Share of US employment, CES 2023 [D]. */
export const NAT_EMP_SHARE: Record<IndustryId, number> = (() => {
  const tot = INDUSTRY_IDS.reduce((a, k) => a + INDUSTRIES[k].empK, 0);
  return Object.fromEntries(INDUSTRY_IDS.map((k) => [k, INDUSTRIES[k].empK / tot])) as Record<IndustryId, number>;
})();

/** Total input coefficient bought from the 24 industries, per $ of output (row sum of IO_A) [D]. */
export const IO_ROW_SUM: Record<IndustryId, number> = Object.fromEntries(
  INDUSTRY_IDS.map((k) => [k, IO_A[k].reduce((a, x) => a + x, 0)])) as Record<IndustryId, number>;

// ---------------------------------------------------------------- the old trades
/**
 * THE ENGINE'S TEN TRADES, BY THE FLOOR THEY RENT, AS INDUSTRIES. A trade on a
 * floor is drawn into the industries that rent that kind of floor, weighted
 * by their US employment (CES 2023, thousands) [S]:
 *   office  finance -> banking 3,650 / real-estate services 2,450 (the FIRE
 *           desks that are not insurance); law and design -> professional
 *           services; tech and media -> technology and media; insurance ->
 *           insurance; medical -> health; a food or apparel firm's office
 *           is its head office (management of companies). A firm's industry
 *           is its trade's: a law firm is never drawn a headquarters.
 *   retail  apparel -> shops; food -> restaurants 16,700 / groceries 3,100
 *           (CES food and beverage stores); medical -> health.
 *   sheds   logistics -> wholesale 6,100 / fulfilment 1,850 / transport
 *           5,260; food -> food plants 1,720 / grocery wholesalers ~850;
 *           apparel -> apparel mills 320 / apparel wholesalers ~150.
 * Manufacturing beyond food and apparel, government, construction, personal
 * services and most of health and education have no trade on the street:
 * they are the off-map sample (economy.ts).
 */
export type Floor = "office" | "retail" | "industrial";
export const TRADE_TO_INDUSTRY: Record<Floor, Partial<Record<Sector, readonly [IndustryId, number][]>>> = {
  office: {
    finance: [["finance", 3650], ["realestate", 2450]], insurance: [["insurance", 1]],
    law: [["professional", 1]], design: [["professional", 1]], tech: [["techmedia", 1]], media: [["techmedia", 1]],
    medical: [["healthedu", 1]], logistics: [["transport", 1]], food: [["hq", 1]], apparel: [["hq", 1]],
  },
  retail: {
    apparel: [["shops", 1]], food: [["restaurants", 16700], ["shops", 3100]], medical: [["healthedu", 1]],
  },
  industrial: {
    logistics: [["wholesale", 6100], ["fulfil", 1850], ["transport", 5260]],
    food: [["food", 1720], ["wholesale", 850]], apparel: [["apparel", 320], ["wholesale", 150]],
  },
};
/** A floor's industry when its trade has no row above. */
export const FLOOR_DEFAULT: Record<Floor, IndustryId> = { office: "professional", retail: "shops", industrial: "wholesale" };

/**
 * HOW EACH INDUSTRY IS FINANCED: the engine trade whose books (market.ts
 * FIRM_PROFILE — leverage as debt over EBITDA, the floating share, the credit
 * spread) it borrows. One answer to how a trade borrows, not a second table.
 * Government borrows through the city's bonds, not a bank, and has none.
 */
export const FINANCE_LIKE: Record<IndustryId, Sector | null> = {
  food: "food", apparel: "apparel", printing: "logistics", metals: "logistics", machinery: "logistics",
  electronics: "tech", chemicals: "logistics", wood: "logistics", bldgmat: "logistics",
  wholesale: "logistics", fulfil: "logistics", transport: "logistics",
  shops: "apparel", restaurants: "food", personal: "food",
  finance: "finance", insurance: "insurance", realestate: "finance", professional: "law", techmedia: "tech", hq: "insurance",
  healthedu: "medical", construction: "logistics", government: null,
};

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
 *               personal-care services, miscellaneous                   15,950
 *   health      health care                                              6,150
 *   education   education                                                1,650
 * Within each, the dollars go to industries in proportion to what US
 * households buy from them at producer prices (BEA Use table 2023, PCE column
 * F010, PCE_2023_BN) — so a dollar of goods pays the plant, the wholesaler and
 * the shop their national shares (producers 46%, wholesale 14%, retail 41%) [D].
 * Health: providers 93%, net health insurance 7% (BEA NIPA T2.4.5 2023: health
 * care services $3.05T against net health insurance $0.21T) [S].
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
const GOODS: readonly (IndustryId | "primary")[] = ["apparel", "printing", "metals", "machinery", "electronics", "chemicals", "wood", "bldgmat"];
const GROCERY: readonly (IndustryId | "primary")[] = ["food", "primary"];
const SERVICES: readonly (IndustryId | "primary")[] = ["transport", "personal", "finance", "insurance", "realestate", "professional", "techmedia", "government"];
function pceMix(keys: readonly (IndustryId | "primary")[], scale: number): Bridge {
  const tot = keys.reduce((a, k) => a + (PCE_2023_BN[k] ?? 0), 0);
  return Object.fromEntries(keys.map((k) => [k, scale * (PCE_2023_BN[k] ?? 0) / tot]));
}
/** Margins on household goods at producer prices: PCE wholesale and retail over PCE goods plus both [D]. */
const GOODS_PRODUCER = (() => {
  const g = [...GOODS, ...GROCERY].reduce((a, k) => a + (PCE_2023_BN[k] ?? 0), 0);
  return g / (g + (PCE_2023_BN.wholesale ?? 0) + (PCE_2023_BN.shops ?? 0));
})();
const W_MARGIN = (PCE_2023_BN.wholesale ?? 0) / ((PCE_2023_BN.wholesale ?? 0) + (PCE_2023_BN.shops ?? 0)) * (1 - GOODS_PRODUCER);
const R_MARGIN = 1 - GOODS_PRODUCER - W_MARGIN;
/**
 * A category's dollar, by industry. `shops` is the retail margin, of which the
 * online share (market.ts `e.online`, the engine's own) is earned by
 * fulfilment-and-shipping sellers rather than a shopfront — see economy.ts.
 */
export const SPEND_BRIDGE: Record<SpendCategory, Bridge> = {
  groceries: { ...pceMix(GROCERY, GOODS_PRODUCER), wholesale: W_MARGIN, shops: R_MARGIN },
  goods: { ...pceMix(GOODS, GOODS_PRODUCER), wholesale: W_MARGIN, shops: R_MARGIN },
  eatingOut: { restaurants: 1 },
  services: pceMix(SERVICES, 1),
  health: { healthedu: 0.93, insurance: 0.07 },
  education: { healthedu: 1 },
};

// ---------------------------------------------------------------- where the work sits (step 2)
/**
 * WHERE EACH INDUSTRY'S WORKERS SIT (2026-10-28, ONE_ECONOMY_PLAN.md step 2).
 *
 * Step 1b found the engine sizing about 92% of the town's jobs as street firms
 * on commercial floors, when health and education, government and
 * construction are about 36% of US employment (CES 2023: 25,450k + 22,950k +
 * 7,950k of 157,000k) and mostly do not rent commercial floor at all. Each
 * industry's heads are split three ways:
 *
 *   offFloor   on property of its own that is not the leasable stock: the
 *              hospital, the school, the nursing home; City Hall, the police
 *              station, the depot; the contractor's yard and the site [S~]:
 *     health & education  0.75 — ambulatory practices that do rent office or
 *              shop floor (offices of physicians 2,950k, dentists 1,060k, other
 *              practitioners 1,170k, outpatient centres 1,070k: ~6,250k, CES
 *              2023) are a quarter of the industry; hospitals, nursing and
 *              residential care, private schools and colleges, social
 *              assistance and home health are the rest.
 *     government  0.95 — state and local government (20,000k of 22,950k, CES
 *              2023) works in publicly owned schools, offices, stations and
 *              yards; the federal civilian workforce outside the Postal
 *              Service (~2,400k) sits about half in leased space (GSA FY2023:
 *              177M of 363M rentable sf leased) — 2,400 x 0.49 / 22,950 = 0.05
 *              of the industry in leased office.
 *     construction  1.0 — yards, depots and the sites themselves.
 *   remote     whose workplace is their home: ACS 2019 (1-year), 5.7% of
 *              workers worked from home (Census, "The Number of People
 *              Primarily Working From Home Tripled Between 2019 and 2021",
 *              2022); the industry split leans on BLS, "Job Flexibilities and
 *              Work Schedules 2017-18" (USDL-19-1691), where the share able to
 *              work at home runs about 50% in financial activities and
 *              professional services against about 10% in retail and leisure
 *              — the 5.7% shared in that proportion, rounded [S~]. Space is
 *              not taken for them. (A pandemic's shift is a swan's, swans.ts.)
 *   the rest   on the floor its industry rents (`space`): office, shop or shed.
 */
export const OFF_FLOOR: Record<IndustryId, number> = {
  food: 0, apparel: 0, printing: 0, metals: 0, machinery: 0, electronics: 0, chemicals: 0, wood: 0, bldgmat: 0,
  wholesale: 0, fulfil: 0, transport: 0, shops: 0, restaurants: 0, personal: 0,
  finance: 0, insurance: 0, realestate: 0, professional: 0, techmedia: 0, hq: 0,
  healthedu: 0.75, construction: 1, government: 0.95,
};
export const REMOTE: Record<IndustryId, number> = {
  food: 0.02, apparel: 0.02, printing: 0.03, metals: 0.02, machinery: 0.03, electronics: 0.04, chemicals: 0.03, wood: 0.02, bldgmat: 0.02,
  wholesale: 0.05, fulfil: 0.01, transport: 0.03, shops: 0.02, restaurants: 0.01, personal: 0.08,
  finance: 0.09, insurance: 0.10, realestate: 0.10, professional: 0.11, techmedia: 0.12, hq: 0.08,
  healthedu: 0.03, construction: 0.04, government: 0.03,
};
/** The leasable class each industry's on-floor workers rent. */
export function floorOf(i: IndustryId): Floor {
  const sp = INDUSTRIES[i].space;
  return sp === "retail" ? "retail" : sp.startsWith("industrial") ? "industrial" : "office";
}
/**
 * THE TOWN'S JOBS OFF THE COMMERCIAL FLOORS, as a share of all its jobs: the
 * national share of the industries that serve a region's people from their
 * own buildings — health and education's off-floor part and government's —
 * which every region has in proportion to its size, whatever its floors hold
 * [D]: (25,450 x 0.75 + 22,950 x 0.95) / 157,000 = 0.26. Construction is left
 * to its demand (economy.ts `openingConstruction`), and the off-map plants and
 * sheds rent the region's industrial floor.
 */
export const OFF_FLOOR_SHARE_NAT = (() => {
  const tot = INDUSTRY_IDS.reduce((a, k) => a + INDUSTRIES[k].empK, 0);
  return (INDUSTRIES.healthedu.empK * OFF_FLOOR.healthedu + INDUSTRIES.government.empK * OFF_FLOOR.government) / tot;
})();

// ---------------------------------------------------------------- what the rest of the country buys (step 2)
/**
 * THE NATION'S DEMAND FOR EACH INDUSTRY, as employment: the town is a small
 * open economy and sells its exports into the national market for them, so an
 * export industry's jobs here follow that industry's jobs in the nation —
 * through its trend, its cycle — and the town's share of them.
 *
 * NAT_TREND: US payroll growth, a year, 1990 to 2019, BLS CES annual averages
 * (thousands, rounded) [S~]: food manufacturing 1,510 -> 1,620; textiles and
 * apparel 1,630 -> 320; paper and printing 1,460 -> 790; primary and fabricated
 * metals 2,300 -> 1,820; machinery and transport equipment 3,540 -> 2,780;
 * computers, electronics and electrical 2,530 -> 1,470; chemicals, plastics and
 * petroleum 2,020 -> 1,690; wood, furniture and miscellaneous 1,830 -> 1,400;
 * nonmetallic minerals 530 -> 410; wholesale 5,270 -> 5,900; warehousing 410 ->
 * 1,180; transport and utilities 3,810 -> 5,020; retail 13,180 -> 15,620;
 * accommodation and food 8,160 -> 13,750; other services, arts and waste 5,600
 * -> 8,840; credit, securities and funds 2,950 -> 3,740; insurance 2,020 ->
 * 2,800; real estate and leasing 1,640 -> 2,250; professional (less computer
 * design) and administrative services 8,800 -> 16,200; information and
 * computer design 3,100 -> 5,060; management of companies 1,670 -> 2,420;
 * health and education 10,980 -> 24,160; construction 5,260 -> 7,490;
 * government 18,410 -> 22,600. These carry the labour-force growth of their
 * years (0.9% a year, 1990-2019); market.ts LABOUR_FORCE_SLOWDOWN takes the
 * half point that has stopped arriving (CBO 2024), the same correction the
 * engine's trades carried.
 *
 * CYCLE_BETA: each industry's payroll swing per unit of the nation's, BLS CES
 * December 2007 to its trough against total nonfarm (-6.3%) [S~]: durable
 * manufacturing about -21% (3.4), nondurable -9% (1.5; food barely moved, 0.3);
 * construction -27% (4.3); wholesale -8% (1.3); transport and warehousing -10%
 * (1.6); retail -8% (1.3); leisure and hospitality -4% (0.7); other services
 * -4% (0.6); information -8% (1.3); financial activities -7% (1.1);
 * professional and business services -9% (1.4); management of companies -3%
 * (0.5); education and health +3% (0); government +1% (0). It moves what the
 * nation buys of the town's exports; what the town buys of itself moves with
 * the town's own incomes.
 */
export const NAT_TREND: Record<IndustryId, number> = {
  food: 0.0024, apparel: -0.056, printing: -0.021, metals: -0.008, machinery: -0.008, electronics: -0.019, chemicals: -0.006, wood: -0.009, bldgmat: -0.009,
  wholesale: 0.004, fulfil: 0.036, transport: 0.0095, shops: 0.006, restaurants: 0.018, personal: 0.016,
  finance: 0.008, insurance: 0.011, realestate: 0.011, professional: 0.021, techmedia: 0.017, hq: 0.013,
  healthedu: 0.027, construction: 0.012, government: 0.007,
};
export const CYCLE_BETA: Record<IndustryId, number> = {
  food: 0.3, apparel: 1.5, printing: 1.5, metals: 3.4, machinery: 3.4, electronics: 3.4, chemicals: 1.5, wood: 3.4, bldgmat: 3.4,
  wholesale: 1.3, fulfil: 1.6, transport: 1.6, shops: 1.3, restaurants: 0.7, personal: 0.6,
  finance: 1.1, insurance: 1.1, realestate: 1.1, professional: 1.4, techmedia: 1.3, hq: 0.5,
  healthedu: 0, construction: 4.3, government: 0,
};

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
