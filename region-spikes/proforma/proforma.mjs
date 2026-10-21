// Spike 5 — 100-acre suburban subdivision pro forma, land developer's side.
//
// Plain ESM, no dependencies:   node region-spikes/proforma/proforma.mjs
//                               node region-spikes/proforma/proforma.mjs --json
//
// The land developer buys a raw tract, entitles it, builds infrastructure in
// phases, and sells finished lots to homebuilders. The lot price is NOT an
// input: it is the homebuilder's residual (what a builder can pay for a lot
// and still earn its normal margin on the house), recomputed every month from
// the mortgage rate that month. See README.md for the full source table.

// ============================================================================
// INPUTS — every value: unit, source URL, the reading taken.
// Anything not sourced is marked APPROX (unsourced) and listed in the README.
// ============================================================================

export const SRC = {
  // ---------------- Homebuilder side (sets the lot price) -------------------
  // NAHB, "Cost of Constructing a Home-2024" (Eric Lynch, Jan 20 2025), Table 1.
  //   https://www.nahb.org/-/media/AB4EFC742624475A97A0A62189986FF8.ashx
  //   (summary: https://eyeonhousing.org/2025/01/cost-of-constructing-a-home-in-2024/)
  // One internally consistent typical home: price, size, cost and soft-cost
  // shares all come from the same 41-builder sample, Fall 2024.
  nahbSalesPrice: 665298,        // $  Table 1 "Total Sales Price"
  nahbFinishedLot: 91057,        // $  Table 1 "Finished Lot Cost (incl. financing)" — CHECK value only, never an input
  nahbConstructionCost: 428215,  // $  Table 1 "Total Construction Cost" (2,647 sf x ~$162/sf);
                                 //    includes site work: permit $7,640, impact fee $6,367, water & sewer $6,260
  nahbFinishedSf: 2647,          // sf Table 1 "Average Finished Area"
  nahbFinancingCost: 10220,      // $  Table 1 "Financing Cost" (1.5%) — used to calibrate builder debt share
  overheadShare: 0.057,          // of price, Table 1 "Overhead and General Expenses" 5.7%
  marketingShare: 0.008,         // of price, Table 1 "Marketing Cost" 0.8%
  commissionShare: 0.028,        // of price, Table 1 "Sales Commission" 2.8%
  builderProfitShare: 0.098,     // of price, report p.7: "Since 1998, the long-run average in the
                                 //    pre-tax profit share stands at 9.8%" — the builder's required margin
  nahbProfitShare2024: 0.110,    // of price, Table 1 "Profit" 11.0% — used only to reproduce the survey lot price

  // Builder construction loan rate — NAHB AD&C Financing Survey (Eye on Housing).
  //   Q2 2024: https://eyeonhousing.org/2024/08/credit-for-builders-rates-up-availability-down-in-the-second-quarter/
  //   Q2 2026: https://eyeonhousing.org/2026/08/cost-of-credit-for-builders-up-since-the-end-of-2025/
  adcSpecRate2024: 0.1432,       // /yr effective rate, speculative SF construction, Q2 2024 (survey year)
  adcSpecRateNow: 0.1182,        // /yr effective rate, speculative SF construction, Q2 2026 (latest)

  // Build time — Census Survey of Construction via NAHB:
  //   https://eyeonhousing.org/2026/09/single-family-home-construction-time-declines-in-2025/
  //   "[built-for-sale homes] required ... 7.4 months from obtaining building permits to completion" (2025)
  buildMonths: 7.4,
  // Months on market after completion — Census/HUD series MNMFS.
  //   https://fred.stlouisfed.org/series/MNMFS — Jan 2026 = 3.2 months.
  //   WEAK: FRED was down for maintenance on 2026-10-21; reading taken from the
  //   search-result excerpt of that page, not the page itself.
  monthsForSale: 3.2,

  // Mortgage rates — Freddie Mac PMMS 30-yr fixed, weekly history CSV:
  //   https://www.freddiemac.com/pmms/docs/PMMS_history.csv
  pmms2024Avg: 0.0672,           // 2024 average of weekly readings (computed from the CSV) — the survey-year rate
  pmmsNow: 0.0740,               // 10/15/2026 reading, https://www.freddiemac.com/pmms
  pmms2022Jump: 0.0386,          // 1/6/2022 3.22% -> 10/27/2022 7.08%: the fastest rise in the series' recent history
  pmms2022JumpMonths: 10,        // over ~42 weeks
  // Down payment — NAR 2025 Profile of Home Buyers and Sellers:
  //   https://www.nar.realtor/news/real-estate-news/nar-2025-profile-of-home-buyers-sellers-reveals-market-extremes
  //   median down payment 10% first-time, 23% repeat; first-time buyers 21% of market.
  downFirstTime: 0.10, downRepeat: 0.23, firstTimeShare: 0.21,
  mortgageTermMonths: 360,

  // Builder sales pace (homes sold per community per month), FY2025 10-Ks:
  //   Tri Pointe 2.4 (2024: 3.1)  https://www.sec.gov/Archives/edgar/data/1561680/000156168026000008/tph-20251231.htm
  //   M/I Homes  3.0 (2024: 3.3)  https://www.sec.gov/Archives/edgar/data/799292/000079929226000006/mho-20251231.htm
  //   Beazer     2.0 (2024: 2.4)  https://www.sec.gov/Archives/edgar/data/915840/000091584025000075/bzh-20250930.htm
  absorptionByBuilder2025: { triPointe: 2.4, miHomes: 3.0, beazer: 2.0 },

  // ---------------- Land developer side --------------------------------------
  // "Why is the cost of a single-family home lot so expensive?", More Housing
  // Wisconsin Briefing Paper 7, Sept 2024 — line-item budgets of three actual
  // proposed 80-acre subdivisions, prepared by Steve DeCleene (Neumann Companies,
  // a residential developer) and Robert Procter (Axley Brynelson).
  //   https://action.wra.org/wp-content/uploads/2024/10/MHW-Briefing-Paper-7-September_FINAL-compressed.pdf
  // Per-lot dollars below are read straight from the p.8 budget table.
  // Land, dev-loan interest and commissions are excluded: this model computes those itself.
  jurisdictions: {
    // Dodge County (Beaver Dam), WI: modest standards, higher density.
    dodge: {
      label: 'Dodge Co. WI (modest standards)',
      lotsPerGrossAcre: 171 / 80,          // 171 lots on 80 acres (2.14/acre)
      landPerAcre: 1600000 / 80,           // $1,600,000 for 80 acres = $20,000/acre
      planningLegal: 1217,                 // $/lot "Land Planning, Due Diligence, and Legal"
      closingTaxFees: 1217,                // $/lot "Closing Cost, Property Tax, Loan Fees, LOC"
      engineeringInspection: 3833,         // $/lot "Engineering and Inspections"
      offsite: 1000,                       // $/lot "Off Site Infrastructure" (highway improvements)
      onsite: 30850,                       // $/lot "On Site Infrastructure" (grading, sewer, water, storm, roads)
      landscapingAmenities: 667,           // $/lot
      electric: 1217,                      // $/lot "Electric, net of reimbursement"
      other: 3923,                         // $/lot "Other Costs"
    },
    // Dane County (Madison area), WI: stricter standards, booster station, more storm sewer.
    dane: {
      label: 'Dane Co. WI (strict standards)',
      lotsPerGrossAcre: 151 / 80,          // 1.89/acre
      landPerAcre: 4000000 / 80,           // $50,000/acre
      planningLegal: 1507, closingTaxFees: 3778, engineeringInspection: 3868,
      offsite: 8191, onsite: 57118, landscapingAmenities: 3368, electric: 1242, other: 9290,
    },
  },
  devSalesCommission: 0.03,      // of lot price — same budget, "Sales Commissions at 3%"

  // Agricultural use value (what a denied tract is worth) — USDA NASS Land Values 2025 Summary:
  //   https://esmis.nal.usda.gov/sites/default/release-files/pn89d6567/2n49w148w/1g05hb655/land0825.txt
  agLandPerAcreWI: 7250,         // $/acre Wisconsin cropland 2025
  agLandPerAcreUS: 5830,         // $/acre U.S. cropland 2025 (context)

  // Entitlement review time — Gyourko, Hartley & Krimmel, "The Local Residential
  // Land Use Regulatory Environment Across U.S. Housing Markets" (NBER w26573, 2019):
  //   https://www.nber.org/papers/w26573.pdf  p.4: lightly-regulated places average 3.4 months
  //   from submission to decision; highly-regulated 8.4 months ("thick upper tail ... 18-24").
  //   "The average regulatory environment looks like the mean" -> ~5.9 months.
  entitleMonthsLight: 3.4, entitleMonthsHeavy: 8.4,

  // Lot developer benchmark — Forestar Group FY2025 10-K (D.R. Horton's lot developer):
  //   https://www.sec.gov/Archives/edgar/data/1406587/000162828025053125/for-20250930.htm
  //   14,240 lots at avg $108,400; cost of sales $1,298.9M on revenue $1,662.4M (21.9% gross margin);
  //   $595.3M land acquisition vs $1.1B development spend; "lots ... developed in phases".
  // CHECK values only.
  forestarAvgLot: 108400, forestarGrossMargin: 0.219,

  // ---------------- APPROX (unsourced) — flagged in README --------------------
  entitleOdds: 0.85,             // APPROX: probability the rezoning/plat is approved. No national source found.
  buildersInCommunity: 2,        // APPROX: rival builders taking lots at once (game-endogenous later).
  phases: 4,                     // APPROX: Forestar/KB confirm phasing; count is a layout choice.
  phaseDevMonths: 8,             // APPROX: months to build one phase's streets & utilities. Bounded by KB Home
                                 //   FY2025 10-K: West Coast community development "10 to 24 months", longer
                                 //   than its other segments.
  deniedSaleMonths: 3,           // APPROX: months to resell a denied tract.
  horizonMonths: 120,            // APPROX: modelling horizon. Lots still unsold then are written down to
                                 //   agricultural use value (the land's value with no builder bid) and the deal ends.
  passThrough: 1.0,              // Mechanism default: full affordability pass-through of rates to new-home
                                 //   price. 0.5 is shown as a sensitivity only (sticky prices / incentives), unsourced.
};

// Derived inputs (arithmetic on the sources above, nothing chosen) -----------
const downShare = SRC.firstTimeShare * SRC.downFirstTime + (1 - SRC.firstTimeShare) * SRC.downRepeat;
const meanAbsorption = (() => {
  const v = Object.values(SRC.absorptionByBuilder2025);
  return v.reduce((a, b) => a + b, 0) / v.length;
})();
const meanEntitleMonths = (SRC.entitleMonthsLight + SRC.entitleMonthsHeavy) / 2;

// ============================================================================
// HOMEBUILDER RESIDUAL — what a builder can pay for a finished lot
// ============================================================================

const pmtFactor = (rAnnual, n = SRC.mortgageTermMonths) => {
  const r = rAnnual / 12;
  return r / (1 - Math.pow(1 + r, -n));
};

// New-home price at mortgage rate r. Mechanism: the buyer pool's monthly
// payment and cash down payment are fixed in dollars; the loan they can carry
// moves with the rate. Calibrated at the NAHB survey home and the 2024 rate.
// This is FULL pass-through (upper bound) — real builders lag with incentives.
export function homePrice(r, passThrough = SRC.passThrough) {
  const P0 = SRC.nahbSalesPrice;
  const down = downShare * P0;
  const payment = (P0 - down) * pmtFactor(SRC.pmms2024Avg);
  const full = down + payment / pmtFactor(r);
  return P0 + passThrough * (full - P0);
}

// Builder's carry: a construction loan funds part of lot + vertical cost.
// Dollar-months: lot held for build+sale, vertical drawn evenly over the build
// then held while for sale. The debt share is CALIBRATED so that at the 2024
// AD&C rate the NAHB home's financing equals NAHB's own $10,220 — the rest of
// the capital is the builder's equity, paid by its profit margin.
const carryMonthsLot = SRC.buildMonths + SRC.monthsForSale;
const carryMonthsVert = SRC.buildMonths / 2 + SRC.monthsForSale;
const builderDebtShare = SRC.nahbFinancingCost /
  ((SRC.adcSpecRate2024 / 12) *
   ((SRC.nahbFinishedLot) * carryMonthsLot + SRC.nahbConstructionCost * carryMonthsVert));

// Residual lot value. lot = P*(1 - soft - profit) - C - carry(lot), carry linear in lot.
export function builderResidual({ price, adcRate = SRC.adcSpecRateNow, profitShare = SRC.builderProfitShare }) {
  const C = SRC.nahbConstructionCost;
  const net = price * (1 - SRC.overheadShare - SRC.marketingShare - SRC.commissionShare - profitShare);
  const i = builderDebtShare * adcRate / 12;
  const lot = (net - C - i * C * carryMonthsVert) / (1 + i * carryMonthsLot);
  return Math.max(0, lot);
}

// ============================================================================
// LAND DEVELOPER — month-by-month cash flows
// ============================================================================

export const BASE = {
  name: '(a) Sensible deal, growing exurb',
  acres: 100,
  jurisdiction: 'dodge',
  landPerAcre: null,                    // null -> jurisdiction's own sourced comp
  entitleMonths: Math.round(meanEntitleMonths),
  absorptionPerBuilder: meanAbsorption, // homes/community/month
  buildersInCommunity: SRC.buildersInCommunity,
  rateAt: () => SRC.pmmsNow,            // mortgage rate path, month -> rate
  passThrough: SRC.passThrough,
  adcRate: SRC.adcSpecRateNow,
};

export function rateShock(startRate, shockStartMonth, jump = SRC.pmms2022Jump, over = SRC.pmms2022JumpMonths) {
  return (m) => startRate + jump * Math.min(1, Math.max(0, (m - shockStartMonth) / over));
}

export function run(scn) {
  const J = SRC.jurisdictions[scn.jurisdiction];
  const lots = Math.floor(scn.acres * J.lotsPerGrossAcre);
  const landPerAcre = scn.landPerAcre ?? J.landPerAcre;
  const pace = scn.absorptionPerBuilder * scn.buildersInCommunity; // lots/month taken down
  const perPhase = Math.ceil(lots / SRC.phases);
  const hard = J.onsite + J.landscapingAmenities + J.electric + J.other; // per lot, spent over phase build

  const cf = [];            // net cash flow by month
  const rows = [];          // detail for printing
  const add = (m, k, v) => {
    while (cf.length <= m) { cf.push(0); rows.push({ m: cf.length - 1, land: 0, soft: 0, infra: 0, lotsSold: 0, revenue: 0, salvage: 0, lotPrice: 0, rate: 0 }); }
    cf[m] += v; rows[m][k] += v;
  };

  // Month 0: buy raw land, closing/tax/fees; planning & legal through entitlement.
  add(0, 'land', -landPerAcre * scn.acres);
  add(0, 'soft', -J.closingTaxFees * lots);
  const E = scn.entitleMonths;
  for (let m = 0; m < Math.max(1, E); m++) add(m, 'soft', -J.planningLegal * lots / Math.max(1, E));
  // Engineering & inspections paid at plat approval; off-site backbone with phase 1.
  add(E, 'soft', -J.engineeringInspection * lots);
  add(E, 'infra', -J.offsite * lots);

  // Phases: phase 1 starts at approval. Each later phase starts so it finishes
  // just as the previous phase's inventory would run out at the current pace.
  let finished = 0, sold = 0, nextPhase = 0, phaseStart = E, m = E;
  const phaseDone = [];
  const startPhase = (t) => {
    const n = Math.min(perPhase, lots - nextPhase * perPhase);
    for (let k = 0; k < SRC.phaseDevMonths; k++) add(t + k, 'infra', -hard * n / SRC.phaseDevMonths);
    phaseDone.push({ at: t + SRC.phaseDevMonths, n });
    nextPhase++;
  };
  startPhase(phaseStart);
  let lotPriceSum = 0, lotPriceMin = Infinity, lotPriceMax = 0, stalledMonths = 0, mothballedMonths = 0, owed = 0;
  while (sold < lots && m < SRC.horizonMonths) {
    for (const p of phaseDone) if (p.at === m) finished += p.n;
    // builders take lots as they sell homes, at the residual set by this month's rate
    const r = scn.rateAt(m);
    const price = builderResidual({ price: homePrice(r, scn.passThrough), adcRate: scn.adcRate });
    // trigger next phase — only if today's lot price, net of commission, covers the
    // phase's own per-lot infrastructure (otherwise the developer mothballs the land)
    const unsoldFinishedPlusPipeline = finished - sold + phaseDone.filter(p => p.at > m).reduce((a, p) => a + p.n, 0);
    const phasePays = price * (1 - SRC.devSalesCommission) > hard;
    if (nextPhase < SRC.phases && unsoldFinishedPlusPipeline <= pace * SRC.phaseDevMonths) {
      if (phasePays) startPhase(m); else mothballedMonths++;
    }
    const avail = finished - sold;
    if (avail > 0) {
      if (price <= 0) { stalledMonths++; }
      else {
        // fractional pace accumulates; demand never banks more than one month
        owed = Math.min(owed + pace, pace + 1);
        const whole = Math.min(avail, Math.floor(owed));
        owed -= whole;
        add(m, 'soft', 0);
        if (whole > 0) {
          add(m, 'revenue', whole * price);
          add(m, 'soft', -whole * price * SRC.devSalesCommission);
          rows[m].lotsSold = whole; rows[m].lotPrice = price;
          lotPriceSum += whole * price; lotPriceMin = Math.min(lotPriceMin, price); lotPriceMax = Math.max(lotPriceMax, price);
          sold += whole;
        }
      }
    }
    add(m, 'soft', 0);
    rows[m].rate = r;
    m++;
  }
  // Horizon reached with lots unsold: no builder will pay; write remaining land down to ag value.
  let salvage = 0;
  if (sold < lots) {
    salvage = SRC.agLandPerAcreWI * scn.acres * (lots - sold) / lots;
    add(m, 'salvage', salvage);
  }
  return summarize(scn, { salvage, lots, cf, rows, landPerAcre, lotPriceAvg: lotPriceSum / Math.max(1, sold), lotPriceMin, lotPriceMax, sold, stalledMonths, mothballedMonths, lastMonth: m - 1 });
}

// Approval fails: carry through the review, then sell at agricultural use value.
function deniedCashflows(scn) {
  const J = SRC.jurisdictions[scn.jurisdiction];
  const lots = Math.floor(scn.acres * J.lotsPerGrossAcre);
  const landPerAcre = scn.landPerAcre ?? J.landPerAcre;
  const E = Math.max(1, scn.entitleMonths);
  const cf = new Array(E + SRC.deniedSaleMonths + 1).fill(0);
  cf[0] -= landPerAcre * scn.acres + J.closingTaxFees * lots;
  for (let m = 0; m < E; m++) cf[m] -= J.planningLegal * lots / E;
  cf[E + SRC.deniedSaleMonths] += SRC.agLandPerAcreWI * scn.acres;
  return cf;
}

export function irrMonthly(cfIn) {
  let end = cfIn.length; while (end > 1 && cfIn[end - 1] === 0) end--;
  const cf = cfIn.slice(0, end);
  const npv = (r) => cf.reduce((a, c, t) => a + c / Math.pow(1 + r, t), 0);
  let lo = -0.5, hi = 1.0;   // monthly; -0.5/mo is a -99.98%/yr floor
  if (!Number.isFinite(npv(lo)) || npv(lo) * npv(hi) > 0) return NaN;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; (npv(lo) * npv(mid) <= 0) ? hi = mid : lo = mid; }
  return (lo + hi) / 2;
}
const annual = (rm) => Number.isNaN(rm) ? NaN : Math.pow(1 + rm, 12) - 1;

function summarize(scn, o) {
  // Gross, not netted by month: multiple = all money back / all money in.
  const inflow = o.rows.reduce((a, r) => a + r.revenue + r.salvage, 0);
  const outflow = -o.rows.reduce((a, r) => a + r.land + r.soft + r.infra, 0);
  let cum = 0, peak = 0, peakAt = 0;
  o.cf.forEach((c, t) => { cum += c; if (cum < peak) { peak = cum; peakAt = t; } });
  const irr = annual(irrMonthly(o.cf));
  // Probability-weighted with entitlement risk: approve -> o.cf, deny -> ag-value exit.
  const den = deniedCashflows(scn);
  const len = Math.max(o.cf.length, den.length);
  const ev = Array.from({ length: len }, (_, t) => SRC.entitleOdds * (o.cf[t] ?? 0) + (1 - SRC.entitleOdds) * (den[t] ?? 0));
  return {
    name: scn.name, jurisdiction: SRC.jurisdictions[scn.jurisdiction].label,
    lots: o.lots, sold: o.sold, landPerAcre: o.landPerAcre, months: o.lastMonth,
    lotPriceAvg: o.lotPriceAvg, lotPriceMin: o.lotPriceMin, lotPriceMax: o.lotPriceMax,
    revenue: inflow, cost: outflow, profit: inflow - outflow,
    irr, multiple: inflow / outflow, peakEquity: -peak, peakAt,
    irrRiskAdj: annual(irrMonthly(ev)), stalledMonths: o.stalledMonths, mothballedMonths: o.mothballedMonths, salvage: o.salvage, cf: o.cf, rows: o.rows,
  };
}

// ============================================================================
// SCENARIOS
// ============================================================================

const BAD_E = Math.round(SRC.entitleMonthsHeavy);
// The 2022 shock replayed starting once phase 1 has been selling ~6 months.
const BAD_SHOCK = rateShock(SRC.pmmsNow, BAD_E + SRC.phaseDevMonths + 6);
const BAD_PARTS = {
  'overpaid land ($50k/ac Dane comp)': { landPerAcre: SRC.jurisdictions.dane.landPerAcre },
  'heavy-regulation review (8 mo)': { entitleMonths: BAD_E },
  'slowest 10-K pace (Beazer 2.0)': { absorptionPerBuilder: SRC.absorptionByBuilder2025.beazer },
  '2022 rate shock mid-sales': { rateAt: BAD_SHOCK },
};

// Which bad-deal ingredient does the damage? Each one alone on the base case.
export function badAttribution() {
  return Object.entries(BAD_PARTS).map(([k, v]) => ({ x: k, ...pick(run({ ...BASE, ...v })) }));
}

export function scenarios() {
  const a = { ...BASE };
  // (b) Bad: paid a metro-core price (the Dane/Waukesha $50k/acre comps) for exurb
  // land, heavy-regulation review time, slowest 10-K sales pace, and the 2022
  // rate shock replayed starting once the first phase is on the market.
  const b = {
    ...BASE,
    name: '(b) Bad deal: overpaid, slow, 2022-style rate shock mid-sales',
    ...Object.assign({}, ...Object.values(BAD_PARTS)),
  };
  // (c) Same sensible market, strict-standards jurisdiction at its own land comp.
  const c = { ...BASE, name: '(c) Fair price, strict-standards jurisdiction', jurisdiction: 'dane' };
  return [a, b, c].map(run);
}

export function sensitivity() {
  const out = {};
  out.rate = [0.055, 0.065, SRC.pmmsNow, 0.085, 0.095, SRC.pmmsNow + SRC.pmms2022Jump]
    .map(r => ({ x: r, ...pick(run({ ...BASE, rateAt: () => r })) }));
  out.rateHalfPassThrough = [0.055, 0.065, SRC.pmmsNow, 0.085, 0.095, SRC.pmmsNow + SRC.pmms2022Jump]
    .map(r => ({ x: r, ...pick(run({ ...BASE, rateAt: () => r, passThrough: 0.5 })) }));
  out.absorption = [1.5, 2.0, meanAbsorption, 3.0, 3.7]
    .map(x => ({ x, ...pick(run({ ...BASE, absorptionPerBuilder: x })) }));
  out.entitlement = [3, 6, 9, 12, 18, 24]
    .map(x => ({ x, ...pick(run({ ...BASE, entitleMonths: x })) }));
  out.land = [SRC.agLandPerAcreWI, 10000, 20000, 35000, 50000, 75000]
    .map(x => ({ x, ...pick(run({ ...BASE, landPerAcre: x })) }));
  return out;
}
const pick = (r) => ({ irr: r.irr, irrRiskAdj: r.irrRiskAdj, multiple: r.multiple, lotPrice: r.lotPriceAvg, peakEquity: r.peakEquity, months: r.months });

// Developer's own residual: the most it could pay per acre for raw land and
// still hit a target IRR (bisection on land price). Mechanism for price discovery.
export function maxLandBid(targetIrr, scn = BASE) {
  let lo = 0, hi = 500000;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const irr = run({ ...scn, landPerAcre: mid }).irr;
    (irr >= targetIrr) ? lo = mid : hi = mid;
  }
  return lo;
}

// Checks against the sources — does the mechanism reproduce known numbers?
export function checks() {
  const lotAt2024 = builderResidual({ price: SRC.nahbSalesPrice, adcRate: SRC.adcSpecRate2024, profitShare: SRC.nahbProfitShare2024 });
  return {
    builderDebtShare,
    downShare,
    meanAbsorption,
    meanEntitleMonths,
    nahbLotReproduced: lotAt2024,                     // should be ~ $91,057
    nahbLotPublished: SRC.nahbFinishedLot,
    homePriceNow: homePrice(SRC.pmmsNow),
    homePriceDropNow: homePrice(SRC.pmmsNow) / SRC.nahbSalesPrice - 1,
    lotNow: builderResidual({ price: homePrice(SRC.pmmsNow) }),
  };
}

// ============================================================================
// REPORT
// ============================================================================

const $ = (v) => (v < 0 ? '-' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
const $k = (v) => (v < 0 ? '-' : '') + '$' + (Math.abs(v) / 1000).toFixed(0) + 'k';
const $m = (v) => (v < 0 ? '-' : '') + '$' + (Math.abs(v) / 1e6).toFixed(2) + 'M';
const pct = (v) => Number.isNaN(v) ? 'n/a (never repays)' : (v * 100).toFixed(1) + '%';

function report() {
  const c = checks();
  console.log('CHECKS (mechanism vs sources)');
  console.log(`  builder residual at 2024 conditions: ${$(c.nahbLotReproduced)}  (NAHB published lot: ${$(c.nahbLotPublished)})`);
  console.log(`  implied builder construction-loan share: ${(c.builderDebtShare * 100).toFixed(0)}%   blended down payment: ${(c.downShare * 100).toFixed(1)}%`);
  console.log(`  home price at today's ${pct(SRC.pmmsNow)} rate: ${$(c.homePriceNow)} (${pct(c.homePriceDropNow)} vs survey) -> lot residual ${$(c.lotNow)}`);
  console.log(`  Forestar FY2025 avg finished lot: ${$(SRC.forestarAvgLot)} at ${pct(SRC.forestarGrossMargin)} gross margin`);
  console.log('');
  for (const r of scenarios()) {
    console.log(r.name + '  [' + r.jurisdiction + ']');
    console.log(`  ${r.lots} lots on 100 ac, land ${$(r.landPerAcre)}/ac, sold ${r.sold} by month ${r.months}${r.stalledMonths ? `, ${r.stalledMonths} months with no lot sales (residual <= 0)` : ''}${r.mothballedMonths ? `, next phase mothballed ${r.mothballedMonths} months` : ''}`);
    console.log(`  lot price (builder residual): avg ${$(r.lotPriceAvg)}, range ${$(r.lotPriceMin)}-${$(r.lotPriceMax)}`);
    if (r.salvage) console.log(`  horizon reached: unsold land written down to ag value ${$m(r.salvage)}`);
    console.log(`  revenue ${$m(r.revenue)}  cost ${$m(r.cost)}  profit ${$m(r.profit)}  multiple ${r.multiple.toFixed(2)}x`);
    console.log(`  IRR ${pct(r.irr)}  (entitlement-risk-weighted ${pct(r.irrRiskAdj)})  peak equity ${$m(r.peakEquity)} at month ${r.peakAt}`);
    console.log('');
  }
  const s = sensitivity();
  const tbl = (title, rows, fmt) => {
    console.log(title);
    for (const r of rows) console.log(`  ${fmt(r.x).padEnd(12)} IRR ${pct(r.irr).padStart(7)}  risk-adj ${pct(r.irrRiskAdj).padStart(7)}  ${r.multiple.toFixed(2)}x  lot ${$k(r.lotPrice)}  peak eq ${$m(r.peakEquity)}  ${r.months} mo`);
  };
  tbl('SENSITIVITY: mortgage rate (flat through the deal)', s.rate, x => pct(x));
  tbl('SENSITIVITY: mortgage rate, HALF pass-through to home price (sticky prices; unsourced bound)', s.rateHalfPassThrough, x => pct(x));
  tbl('BAD-DEAL ATTRIBUTION: each ingredient alone on the base case', badAttribution(), x => x.padEnd(36));
  tbl('SENSITIVITY: builder absorption (homes/community/month, 2 builders)', s.absorption, x => x.toFixed(2));
  tbl('SENSITIVITY: entitlement months', s.entitlement, x => x + ' mo');
  tbl('SENSITIVITY: raw land $/acre', s.land, x => $(x));
  console.log('');
  console.log('MAX LAND BID ($/acre) for a target unlevered IRR, base case:');
  for (const t of [0, 0.10, 0.15, 0.20, 0.25]) console.log(`  IRR ${pct(t).padStart(6)}: ${$(maxLandBid(t))}`);
  console.log('');
  console.log('BASE CASE quarterly cash flow:');
  const a = scenarios()[0];
  let cum = 0;
  for (let q = 0; q * 3 < a.cf.length; q++) {
    const sl = a.rows.slice(q * 3, q * 3 + 3);
    const sum = (k) => sl.reduce((x, r) => x + r[k], 0);
    const net = a.cf.slice(q * 3, q * 3 + 3).reduce((x, y) => x + y, 0);
    cum += net;
    console.log(`  Q${String(q + 1).padStart(2)}  land ${$k(sum('land')).padStart(7)}  soft ${$k(sum('soft')).padStart(7)}  infra ${$k(sum('infra')).padStart(7)}  lots ${String(sum('lotsSold')).padStart(3)}  rev ${$k(sum('revenue')).padStart(7)}  net ${$k(net).padStart(7)}  cum ${$k(cum).padStart(7)}`);
  }
}

if (process.argv[1]?.endsWith('proforma.mjs')) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checks: checks(), scenarios: scenarios().map(({ cf, rows, ...r }) => r), sensitivity: sensitivity(), badAttribution: badAttribution(),
      maxLandBid: Object.fromEntries([0, 0.1, 0.15, 0.2, 0.25].map(t => [t, maxLandBid(t)])) }, null, 2));
  } else report();
}
