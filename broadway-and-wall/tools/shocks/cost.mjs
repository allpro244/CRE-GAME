// COST SHOCKS (SHOCK_TESTS_PLAN.md group 4): construction cost +40%, the
// owner's insurance and energy doubled, and City Hall's property-tax rate
// doubled, each held. Entered at the inputs, never at a response:
//
//   4a  the contractors' DIRECT COST — materials at the nation's prices and
//       oil, site labour at the town's wage (market.ts, the cost block above
//       tickContractors). The input index `costInputIdx` is a level that
//       compounds its inputs' monthly growth from `costInputsPrev`; lowering
//       last month's materials price and site wage by 1.4 makes this month's
//       growth +40% on both, so direct cost steps up 40% and stays there. The
//       bid markup over it (contractors.ts) and `costIdx` are left to answer.
//   4b  the PROPERTY-INSURANCE MARKET's capital and price (inputs.ts
//       tickOpexInputs: `opexIdx.ins`, `insCap`) and the ENERGY PRICE the
//       owner's utilities index follows (`opexPrev.energy`, same function).
//   4c  CITY HALL's adopted property-tax rate (citygov.ts `policy.propRate`,
//       published as `econ.taxMult`), held by an outside mandate.
//
// No rent, vacancy, cap rate, land value or asset value is written; no RNG
// is drawn (every mutation is plain arithmetic on state).
const CLASSES = ["office", "retail", "industrial", "multifamily"];
const LABEL = { office: "office", retail: "retail", industrial: "industrial", multifamily: "apartments" };
const AT = 120;   // the snapshot month (shocks.mjs SETTLE_M)
const near = (g, list) => list.includes(g.month - AT);
const fx = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const ratio = (c, t, row, p) => t[row]?.probe?.[p] / c[row]?.probe?.[p];

// ---------------------------------------------------------------- 4a
// WHY MATERIALS AND LABOUR TOGETHER. Direct cost is 45% site labour and 55%
// materials (market.ts LABOUR_SHARE), so +40% on materials alone is +22% of
// direct cost, and since soft costs and contingency are a share of hard cost
// (value.ts SOFT_COST, CONTINGENCY) it is +22% of all-in cost too. The plan's
// "+40% construction cost" is a 40% rise in what a building costs to put up
// (the 2021-22 episode: materials and trades' pay both up), so both inputs
// are raised 40%: (0.55 x 0.40) + (0.45 x 0.40) = +40% of direct cost.
const COST_UP = 1.4;
const costUp = {
  id: "cost-construction-up40", group: "cost", title: "Construction cost +40%, held",
  what: "The contractors' direct cost raised 40% overnight and left there: last month's materials price and site wage in the cost block (market.ts, `costInputsPrev.mat` and `.wage`) are divided by 1.4, so the input index's own monthly growth step (55% materials, 45% labour) adds exactly +40%, and the level compounds from there like the control's. Materials alone would be +22% of cost (they are 55% of direct cost), so both inputs move. The bid markup (contractors.ts) and the cost index `costIdx` are not written: they answer.",
  sources: "2021-22: US construction input prices +35-40% (BLS PPI inputs to construction), Turner index +16% over two years; residual land value = value − cost, so a cost rise falls on land first (DiPasquale & Wheaton 1996 ch. 7); starts fall when replacement cost exceeds value (Tobin's q for buildings); existing buildings gain as replacement cost rises.",
  inject(g, city, i, ctx, E) {
    if (i !== 0) return;   // a level: once stepped up, it compounds with its inputs and nothing pulls it back
    const e = g.econ, p = e.costInputsPrev;
    if (!p || !(e.costInputIdx > 0)) { ctx.notes.push("no costInputsPrev/costInputIdx in the snapshot: not injected"); return; }
    e.costInputsPrev = { ...p, mat: (p.mat ?? p.cpi) / COST_UP, wage: p.wage / COST_UP };
    ctx.notes.push(`materials and site wage both ÷${COST_UP} in costInputsPrev at the snapshot: direct cost ${fx(e.costInputIdx, 4)} steps +40% on the next tick (costIdx was ${fx(e.costIdx, 4)}, markup ${fx(e.gcs?.idx, 4)})`);
  },
  probes: {
    inIdx: (g) => (near(g, [0, 1, 12, 60]) ? g.econ.costInputIdx : NaN),
    markup: (g) => (near(g, [0, 1, 12, 60]) ? g.econ.gcs?.idx : NaN),
  },
  land(c, t) {
    const r = ratio(c, t, 1, "cost-construction-up40.inIdx"), k = t[1].costIdx / c[1].costIdx;
    return { ok: r >= 1.38 && r <= 1.42, msg: `direct cost (costInputIdx) ×${fx(r)}, costIdx ×${fx(k)} at +1 month` };
  },
  hold(c, t) {
    const r = ratio(c, t, 60, "cost-construction-up40.inIdx"), k = t[60]?.costIdx / c[60]?.costIdx;
    const m = [c[60]?.probe?.["cost-construction-up40.markup"], t[60]?.probe?.["cost-construction-up40.markup"]];
    return { ok: r >= 1.3, msg: `direct cost ×${fx(r)}, costIdx ×${fx(k)} (markup ${fx(m[0])} → ${fx(m[1])}) at +5 years` };
  },
  expect: [
    { obs: "costIdx", unit: "rel", win: "impact", sign: +1, lo: 0.25, hi: 0.45, label: "construction cost index (bids)", want: "+25 to +45%: the 40% input rise, less what idle contractors shave off their markup" },
    { obs: "starts.office", unit: "rel", win: "mid", sign: -1, lo: -1, hi: -0.3, tiny: 0.1, label: "office starts, years 3-8", want: "fall sharply: −30 to −100%", trace: "builders' pro formas (dev.ts developerLook): does cost reach the go/no-go?" },
    { obs: "starts.multifamily", unit: "rel", win: "mid", sign: -1, lo: -1, hi: -0.3, tiny: 0.1, label: "apartment starts, years 3-8", want: "fall sharply: −30 to −100%" },
    // on the stock's scale (tools/shocks.mjs MIN_EVENTS): a rise of a tenth of a point of the stock a year or more is a backwards wire
    { obs: "startsYr.multifamily", unit: "pp", win: "mid", sign: -1, lo: -100, hi: 0, tiny: 0.1, label: "apartment starts, % of the stock a year, years 3-8", want: "no higher than without the shock (≤ 0pp)" },
    { obs: "starts.industrial", unit: "rel", win: "mid", sign: -1, lo: -1, hi: -0.3, tiny: 0.1, label: "industrial starts, years 3-8", want: "fall sharply: −30 to −100%" },
    { obs: "land", unit: "rel", win: "impact", sign: -1, lo: -0.8, hi: -0.05, label: "land value", want: "FALLS 5-80% (residual = value − cost); a rise is a backwards wire", trace: "land pricing off the residual (land market / dev.ts residual)" },
    { obs: "land", unit: "rel", win: "mid", sign: -1, lo: -0.8, hi: -0.05, label: "land value, years 3-8", want: "stays down" },
    { obs: "val.office", unit: "rel", win: "mid", sign: +1, lo: 0.01, hi: 0.25, label: "office values (existing buildings)", want: "rise somewhat (replacement cost up): +1 to +25%" },
    { obs: "val.multifamily", unit: "rel", win: "mid", sign: +1, lo: 0.01, hi: 0.25, label: "apartment values (existing)", want: "rise somewhat: +1 to +25%" },
    { obs: "eff.multifamily", unit: "rel", win: "late", sign: +1, lo: 0.02, hi: 0.4, label: "apartment rent, years 8-15", want: "drifts up as supply stops answering demand: +2 to +40%" },
    { obs: "eff.office", unit: "rel", win: "late", sign: +1, lo: 0.02, hi: 0.4, label: "office rent, years 8-15", want: "drifts up: +2 to +40%" },
  ],
  charts: [
    { title: "construction cost index", obs: "costIdx" },
    { title: "apartment starts, sf a month", obs: "starts.multifamily" },
    { title: "land value", obs: "land" },
  ],
};

// ---------------------------------------------------------------- 4b
// THE INSURANCE MARKET (inputs.ts). The premium is costIdx × exp(ins), and
// `ins` follows a rate target −insCap + (yield term) over a year of renewals,
// while premium above normal rebuilds capital. Doubling the price of cover,
// held, is the market's capital held ln 2 below its unshocked path (a lasting
// repricing of risk, which the cycle on its own would earn back), with the
// book repriced at once: `ins` + ln 2 and `insCap` − ln 2 at the snapshot.
// The engine's monthly step then keeps `ins` exactly ln 2 above the control
// (its target is too), and rebuilds the capital gap by ln 2 × (1/12 + 1/36);
// that rebuild is taken away again every month, so the gap stays ln 2. This
// is exact for the engine's linear recursion (cat years are a hash of the
// seed, the same in both twins); only the ten-year's own response can move it.
const LN2 = Math.log(2);
const INS_RENEW_M = 12, INS_PAYOUT_M = 36;   // inputs.ts: the rebuild rate each month is ln2 × (1/12 + 1/36)
const insEnergy = {
  id: "cost-insurance-energy-x2", group: "cost", title: "Insurance ×2 and energy ×2, held",
  what: "The owner's two outside bills doubled and held (inputs.ts tickOpexInputs). Insurance: the property-insurance market's price `opexIdx.ins` raised by ln 2 and its capital `insCap` held ln 2 below its own path (each month the engine's capital rebuild, ln 2 × (1/12 + 1/36), is taken back), so the rate target and the premium both stay ×2 against the control. Energy: last month's energy price in `opexPrev.energy` halved at the snapshot, so the utilities index steps ×2 on its own growth rule and compounds from there. Labour, repairs and the cost index are not touched; leases decide who pays.",
  sources: "US commercial property insurance rates +60% cumulatively 2019-23, multifamily premiums roughly doubled in Florida/Texas (Marsh Global Insurance Market Index; NMHC 2023); European energy 2022 (commercial power ×2-3). Under NNN leases tenants pay taxes, insurance and utilities (landlords barely notice); gross and apartment owners eat it until leases roll; values fall with NOI (BOMA EER: utilities ~25% of office controllable opex).",
  inject(g, city, i, ctx, E) {
    const o = g.econ.opexIdx;
    if (!o || !g.econ.opexPrev) { if (i === 0) ctx.notes.push("no opexIdx/opexPrev in the snapshot: not injected"); return; }
    if (i === 0) {
      const was = { ins: o.ins, cap: o.insCap, en: o.energy };
      o.ins += LN2; o.insCap -= LN2;
      g.econ.opexPrev = { ...g.econ.opexPrev, energy: g.econ.opexPrev.energy / 2 };
      ctx.notes.push(`insurance: ins ${fx(was.ins)} → ${fx(o.ins)} (premium ×2), insCap ${fx(was.cap)} → ${fx(o.insCap)}; energy: opexPrev.energy halved, utilities index ${fx(was.en, 4)} steps ×2 next tick`);
      return;
    }
    // hold the capital gap at ln 2: take back the month's rebuild of it
    o.insCap -= LN2 * (1 / INS_RENEW_M + 1 / INS_PAYOUT_M);
  },
  probes: {
    insRate: (g) => (near(g, [0, 1, 12, 60]) ? Math.exp(g.econ.opexIdx?.ins ?? NaN) : NaN),
    energy: (g) => (near(g, [0, 1, 12, 60]) ? g.econ.opexIdx?.energy : NaN),
    fixedIdx: (g, city, E) => (near(g, [0, 1, 60]) ? E.opexFixedIdx(g.econ) : NaN),
    ctrlOffice: (g, city, E) => (near(g, [0, 1, 60]) ? E.opexCtrlIdx("office", g.econ) : NaN),
  },
  land(c, t) {
    const p = "cost-insurance-energy-x2.";
    const ri = ratio(c, t, 1, p + "insRate"), re = ratio(c, t, 1, p + "energy"), rf = ratio(c, t, 1, p + "fixedIdx"), ro = ratio(c, t, 1, p + "ctrlOffice");
    return { ok: ri >= 1.95 && ri <= 2.05 && re >= 1.95 && re <= 2.05, msg: `insurance rate ×${fx(ri)}, energy ×${fx(re)} at +1 month (fixed stack ×${fx(rf)}, office controllable ×${fx(ro)})` };
  },
  hold(c, t) {
    const p = "cost-insurance-energy-x2.";
    const ri = ratio(c, t, 60, p + "insRate"), re = ratio(c, t, 60, p + "energy");
    return { ok: ri >= 1.9 && re >= 1.9, msg: `insurance rate ×${fx(ri)}, energy ×${fx(re)} at +5 years` };
  },
  expect: [
    // WHO PAYS, read on the income channel (`inc`: the sample at the
    // snapshot's cap read) in the first year. Run 1 graded `val`, the market
    // read, over three years, and there a single closed print moves a class's
    // cap read 4-5 points in a month (the placebo row shows the floor that
    // leaves): office "+1%" and retail "-7.5%" were which twin closed which
    // deal. Appraised on the same state with only the bills doubled
    // (snapshot, seeds 11/22/33) the engine's order is the record's:
    // apartments -8 to -16%, office -3.5 to -4.1%, retail -1.1 to -1.5%,
    // industrial -0.3 to -0.9%.
    //
    // OFFICE IS NOT GROSS HERE, and in the US mostly is not either: it is
    // full-service with a base-year stop (BOMA; CBRE lease-structure surveys),
    // so in-place tenants pay the growth over their stop and the owner keeps
    // the step once each lease rolls and resets it. rollRecovery (leasing.ts)
    // writes 30% NNN / 58% base-year / 12% gross, which value.ts RECOVERY_RATE
    // carries as half of the stack recovered across a roll; the appraisal
    // capitalises that half. A fall well short of an apartment's is the record.
    { obs: "inc.office", unit: "rel", win: "year1", sign: -1, lo: -0.25, hi: -0.01, tiny: 0.01, label: "office values, cap read held (base-year leases)", want: "fall 1-25%, less than apartments: the owner keeps about half the step once leases roll and reset their stops", trace: "expense recoveries by lease type (value.ts RECOVERY_RATE, noiYr; leasing.ts rollRecovery)" },
    { obs: "inc.multifamily", unit: "rel", win: "year1", sign: -1, lo: -0.25, hi: -0.02, label: "apartment values, cap read held (gross)", want: "fall 2-25%: a flat's lease is gross" },
    { obs: "inc.industrial", unit: "rel", win: "year1", sign: 0, hi: 0.04, label: "industrial values, cap read held (NNN)", want: "barely move: within ±4% (tenants pay it)" },
    { obs: "inc.retail", unit: "rel", win: "year1", sign: 0, hi: 0.05, label: "retail values, cap read held (NNN / CAM)", want: "barely move: within ±5%" },
    { obs: "starts.multifamily", unit: "rel", win: "mid", sign: -1, lo: -0.6, hi: -0.05, tiny: 0.05, label: "apartment starts, years 3-8", want: "fall (lower NOI on a new block)" },
  ],
  charts: [
    { title: "office values, sample (cap read held)", obs: "inc.office" },
    { title: "apartment values, sample (cap read held)", obs: "inc.multifamily" },
    { title: "retail values, sample (cap read held)", obs: "inc.retail" },
  ],
};

// ---------------------------------------------------------------- 4c
// CITY HALL'S RATE, held by a state mandate. The council still adopts a
// budget every July and may cut the rate (by up to STEP_PROP of it) within
// the month; the mandate puts it back at the start of the next. The probe
// reads the rate at the END of each month, after the council has acted, so
// the hold check sees any pull-back. `econ.taxMult` is what citygov.ts
// publishes from the adopted rate; it is set with it so the month's readers
// before City Hall's tick see the mandated rate too.
const taxUp = {
  id: "cost-proptax-x2", group: "cost", title: "Property tax rate ×2, held",
  what: "City Hall's adopted property-tax rate (citygov.ts `policy.propRate`, published as `econ.taxMult`) set to twice its snapshot value and re-imposed at the start of every month as an outside mandate (a state law). The council's budget logic still runs each July and may try to cut it; the end-of-month rate is recorded so a pull-back shows. Assessments, abatements and leases are not touched.",
  sources: "Tax capitalisation: a rise in the effective rate falls on value by about Δtax ÷ cap rate (Oates 1969; Yinger et al. 1988, 30-90% capitalisation), less what NNN leases pass to tenants; Tiebout sorting: a little out-migration over years (ledger #14); Proposition 13-era California and New Jersey's high rates as the record of a held rate.",
  inject(g, city, i, ctx, E) {
    const gov = g.econ.gov;
    if (!gov?.policy) { if (i === 0) ctx.notes.push("no City Hall (econ.gov) in the snapshot: not injected"); return; }
    if (i === 0) { ctx.rate0 = gov.policy.propRate; ctx.taxRate = gov.policy.propRate / Math.max(1e-9, g.econ.taxMult ?? 1); }
    const want = 2 * ctx.rate0;
    if (i === 0) ctx.notes.push(`propRate ${(100 * ctx.rate0).toFixed(3)}% → ${(100 * want).toFixed(3)}% (statutory ${(100 * ctx.taxRate).toFixed(2)}%, rail ${(50).toFixed(0)}-${(250).toFixed(0)}% of it), re-imposed monthly`);
    if (Math.abs(gov.policy.propRate - want) > 1e-12) {
      ctx.pulled = (ctx.pulled ?? 0) + (i > 0 ? 1 : 0);
      if (i > 0 && ctx.pulled <= 3) ctx.notes.push(`month +${i}: council had moved the rate to ${(100 * gov.policy.propRate).toFixed(3)}%; restored`);
    }
    gov.policy.propRate = want;
    g.econ.taxMult = want / Math.max(1e-9, ctx.taxRate);
  },
  probes: {
    rate: (g) => g.econ.gov?.policy?.propRate ?? NaN,
    taxMult: (g) => g.econ.taxMult ?? NaN,
  },
  land(c, t) {
    const p = "cost-proptax-x2.rate", r0 = c[0].probe[p], r1 = t[1].probe[p];
    return { ok: Math.abs(r1 / r0 - 2) < 0.01, msg: `rate ${(100 * r0).toFixed(3)}% → ${(100 * r1).toFixed(3)}% at +1 month (×${fx(r1 / r0)}; control ${(100 * c[1].probe[p]).toFixed(3)}%)` };
  },
  hold(c, t) {
    const p = "cost-proptax-x2.rate", want = 2 * c[0].probe[p];
    let off = 0, worst = 1;
    for (let i = 1; i <= Math.min(60, t.length - 1); i++) { const r = t[i].probe[p] / want; if (Math.abs(r - 1) > 0.001) off++; worst = Math.min(worst, r); }
    const r60 = t[60]?.probe[p] / want;
    return { ok: r60 >= 0.999, msg: `rate ×${fx(2 * r60)} of snapshot at +5 years; end-of-month rate off the mandate in ${off}/60 months (lowest ${fx(2 * worst)}×), restored each next month; control at +5y ×${fx(c[60]?.probe[p] / c[0].probe[p])}` };
  },
  expect: [
    // THE TAX CAPITALISES on the income channel (`inc`, cap read held) in the
    // first year: V = NOI / (cap + t x owner's share), so the fall is about
    // dt x share / (cap + t). With this town's caps (office 8-17%, apartments
    // 8-15%; snapshot, seeds 11/22/33) and the council's 0.55% doubled to
    // 1.10%: apartments (share 1) 0.55 / 8.5-15 = 4-6.5%, office (share 0.5,
    // RECOVERY_RATE: base-year and NNN leases pass part through) 1.5-3.5%,
    // industrial (share 0.08) under 1%. Appraised on the snapshot with only
    // the rate doubled the engine gives -2.2 to -5.4%, -1.4 to -2.9% and
    // -0.3 to -1.0%. Run 1 graded `val` (the market read) over three years and
    // read +4%: the placebo row is that noise floor.
    { obs: "inc.office", unit: "rel", win: "year1", sign: -1, lo: -0.15, hi: -0.005, tiny: 0.005, label: "office values, cap read held", want: "fall by Δtax × owner's share ÷ (cap + tax): 0.55pt × ½ ÷ 8-17% ≈ 1.5-3.5% (Yinger et al. 1988: 30-90% capitalised)", trace: "tax line in NOI (value.ts grossTaxYr, taxRate, taxBorneShare) and its recovery by lease" },
    { obs: "inc.multifamily", unit: "rel", win: "year1", sign: -1, lo: -0.15, hi: -0.01, tiny: 0.01, label: "apartment values, cap read held", want: "fall 0.55pt ÷ (cap + tax) ≈ 4-6.5%; 1-15%" },
    { obs: "inc.industrial", unit: "rel", win: "year1", sign: -1, lo: -0.08, hi: 0, tiny: 0.002, label: "industrial values, cap read held (NNN)", want: "fall less: 0-8% (tenants pay the tax at today's rents)" },
    { obs: "lots", unit: "rel", win: "year1", sign: -1, lo: -0.3, hi: -0.02, label: "land, lot panel", want: "falls 2-30% (the tax capitalises into land)", trace: "land read (value.ts readLand): most lots price at the sales-comparison texture, which learns a tax only through land prints" },
    { obs: "listings", unit: "rel", win: "impact", sign: +1, lo: 0.02, hi: 1, label: "listings", want: "rise: marginal owners sell" },
    { obs: "pop", unit: "rel", win: "late", sign: -1, lo: -0.05, hi: -0.002, tiny: 0.002, label: "population, years 8-15", want: "a little out-migration (Tiebout): −0.2 to −5%" },
  ],
  charts: [
    { title: "property tax rate, %", obs: "probe.cost-proptax-x2.rate", scale: 100 },
    { title: "office values, sample (cap read held)", obs: "inc.office" },
    { title: "land, lot panel", obs: "lots" },
  ],
};

export const SHOCKS = [costUp, insEnergy, taxUp];
