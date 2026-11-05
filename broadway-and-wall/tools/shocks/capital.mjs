// CAPITAL-MARKET SHOCKS (SHOCK_TESTS_PLAN.md group 3): the price of money and
// how much of it a lender will advance. Entered through the nation (the
// central bank's policy rate, market.ts tickNation), the lenders' own product
// terms (debt.ts PRODUCTS / INTERNAL_PRODUCTS, proforma.ts constructionDesks)
// and the capital-wave swan's state (blackswans.ts capWave, which rivals.ts
// tickForeignMoney raises as named foreign funds). No rent, vacancy, cap rate
// or value is written; no RNG is drawn by an injector.
const CLASSES = ["office", "retail", "industrial", "multifamily"];
const LABEL = { office: "office", retail: "retail", industrial: "industrial", multifamily: "apartments" };
const near = (g, list) => list.includes(g.month - 120);

// The probes every capital shock records (in every run, the control included).
// Rates and caps are stored by the engine in percent; these read them as
// fractions so a `pp` scorecard reads in points (1.0pp = 100bp).
function probesFor() {
  const p = {
    pol: (g) => (g.econ.nat?.policy ?? NaN) / 100,
    ten: (g) => (g.econ.indexRate ?? NaN) / 100,
    short: (g) => (g.econ.shortIndex ?? NaN) / 100,
    // the street's mortgage book: every first mortgage on s.cityLoans (the rivals' and private owners' loans)
    debt: (g) => { let x = 0; for (const k in g.cityLoans ?? {}) x += g.cityLoans[k]?.balance ?? 0; return x; },
    trades: (g) => (g.capTape ?? []).filter((t) => t.m === g.month && t.kind === "t").length,
    starts: (g) => CLASSES.reduce((a, k) => a + (g.econ.starts?.[k] ?? 0), 0),
  };
  for (const k of CLASSES) p[`cap_${k}`] = (g) => (g.econ.capRate?.[k] ?? NaN) / 100;
  return p;
}
const P = (id, name) => `${id}.${name}`;
const at = (rows, i, id, name) => rows[i]?.probe?.[P(id, name)];
const meanGap = (c, t, id, name, a, b) => {
  let s = 0, n = 0;
  for (let i = a; i <= Math.min(b, c.length - 1, t.length - 1); i++) {
    const x = at(c, i, id, name), y = at(t, i, id, name);
    if (Number.isFinite(x) && Number.isFinite(y)) { s += y - x; n++; }
  }
  return n ? s / n : NaN;
};
const bp = (x) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${Math.round(x * 1e4)}bp` : "—");

// ------------------------------------------------------------------ 3a
const UP = "capital-rates-up300";
const ratesUp = {
  id: UP, group: "capital", title: "Rates +300bp, held",
  what: "The central bank's policy rate (econ.nat.policy, market.ts tickNation) floored, before every month, at what the CONTROL twin's rate was that month + 3 points (the framework runs the controls first and hands a shocked run its twin's path: `needsControl`). Inside a month the committee still meets (8 months in 12) and steps from the floor toward its own rule, a quarter to three-quarters of a point down, so the month runs a little under the floor; the floor is restored before the next month. The ten-year and the short index are left to the engine. The audit's old indexRate floor (econaudit.mjs exp. 4) is not used: tickNation rewrites indexRate later in the same month, so it never took.",
  sources: "2022-24: fed funds +4.25 points, the ten-year +2.5; cap rates widened 100-200bp over 1-3 years with partial pass-through (Chervachidze & Wheaton 2013); values fell 15-30% (apartments about −20%, office −30% or more); 2023 US deal volume about −50% (MSCI RCA); refinancing failures where balloons fell due; starts down after 1-2 years.",
  needsControl: true,
  inject(g, city, i, ctx) {
    const n = g.econ.nat;
    if (!n) return;
    const twin = ctx.ctrl?.[i]?.policy;
    if (!Number.isFinite(twin)) return;
    const floor = twin + 3;
    if (i === 0) ctx.notes.push(`policy floored at the control's rate + 3 before every month (${floor.toFixed(2)}% at the shock)`);
    if (n.policy < floor) n.policy = floor;
  },
  probes: probesFor(),
  land(c, t) {
    const d1 = at(t, 1, UP, "pol") - at(c, 1, UP, "pol"), t1 = at(t, 1, UP, "ten") - at(c, 1, UP, "ten");
    const avg = meanGap(c, t, UP, "pol", 1, 12);
    return { ok: d1 >= 0.025 && avg >= 0.02 && t1 > 0, msg: `policy ${bp(d1)} and ten-year ${bp(t1)} at +1 month; policy ${bp(avg)} over the first year` };
  },
  hold(c, t) {
    const d = at(t, 60, UP, "pol") - at(c, 60, UP, "pol");
    const avg = meanGap(c, t, UP, "pol", 1, 60), ten = meanGap(c, t, UP, "ten", 1, 60);
    return { ok: d >= 0.02 && avg >= 0.02, msg: `policy ${bp(d)} at +5 years (${bp(avg)} averaged over years 0-5; ten-year ${bp(ten)})` };
  },
  expect: [
    { obs: `probe.${UP}.ten`, unit: "pp", win: "impact", sign: +1, lo: 1.0, hi: 2.5, label: "ten-year (loan index)", want: "+1 to +2.5 points (2022: +2.5 on a +4.25 policy move)", trace: "market.ts expectedPolicyAvg / endShift: does the bond market believe a held rate?" },
    ...["office", "multifamily"].map((k) => ({ obs: `probe.${UP}.cap_${k}`, unit: "pp", win: "impact", sign: +1, lo: 0.5, hi: 2.0, label: `${LABEL[k]} cap rate`, want: "+50 to +200bp over 1-3 years, less than the rate move", trace: "cap-rate formation off the tape (propmarket.ts bids, the street's debt rate)" })),
    { obs: "val.office", unit: "rel", win: "impact", sign: -1, lo: -0.45, hi: -0.15, label: "office values", want: "fall 15-45%" },
    { obs: "val.multifamily", unit: "rel", win: "impact", sign: -1, lo: -0.30, hi: -0.10, label: "apartment values", want: "fall 10-30% (about −20%)" },
    { obs: `probe.${UP}.trades`, unit: "rel", win: "impact", sign: -1, lo: -0.8, hi: -0.2, tiny: 0.05, label: "deal volume (sales a month)", want: "falls 20-80% (2023: about −50%)" },
    { obs: "distress", unit: "rel", win: "impact", sign: +1, lo: 0.2, hi: 5, label: "distressed listings", want: "rise: balloons that cannot refinance" },
    // Charge-offs booked since the shock, against the control's over the same months. Bank CRE net
    // charge-off rates rose about tenfold or more 2021-24 and about thirtyfold 2006-10 (FDIC QBP), so a
    // flow can rise far more than the lifetime total this row once read (hi was 3 on that total).
    { obs: "chargeOffsNew", unit: "rel", win: "mid", sign: +1, lo: 0.05, hi: 30, label: "lenders' charge-offs since the shock, years 3-8", want: "rise" },
    { obs: `probe.${UP}.starts`, unit: "rel", win: "mid", sign: -1, lo: -0.8, hi: -0.1, tiny: 0.05, label: "starts, all classes, years 3-8", want: "fall 10-80% after 1-2 years" },
    ...CLASSES.map((k) => ({ obs: `eff.${k}`, unit: "rel", win: "impact", sign: 0, hi: 0.05, label: `${LABEL[k]} effective rent, years 0-3`, want: "barely moves at first (within ±5%); NOI is not the channel" })),
  ],
  charts: [
    { title: "policy rate and ten-year, %", obs: `probe.${UP}.ten`, scale: 100 },
    { title: "office cap rate, %", obs: `probe.${UP}.cap_office`, scale: 100 },
    { title: "office values (sample)", obs: "val.office" },
  ],
};

// ------------------------------------------------------------------ 3b
const ZERO = "capital-rates-zero10y";
const ZERO_RATE = 0.25, ZERO_M = 120;
const ratesZero = {
  id: ZERO, group: "capital", title: "Rates near zero for 10 years",
  what: `The central bank's policy rate (econ.nat.policy, market.ts tickNation) set to ${ZERO_RATE}% before every month for ${ZERO_M} months, then released to the committee's own rule. Inside a month the committee still meets and steps from ${ZERO_RATE}% toward its rule (up a quarter to three-quarters of a point at a meeting); the peg is restored before the next month. The ten-year and the short index are the engine's.`,
  sources: "2009-15 and 2020-21: policy at the zero bound; the ten-year near 2%; US cap rates compressed over years (about 8% to 5.5% 2009-2019); land prices and leverage rose; starts rose. When rates normalised (2022-24), the reverse, and distress concentrated in loans written at the top.",
  inject(g, city, i, ctx) {
    const n = g.econ.nat;
    if (!n || i >= ZERO_M) return;
    if (i === 0) ctx.notes.push(`policy pegged at ${ZERO_RATE}% (snapshot ${n.policy.toFixed(2)}%) before each of the first ${ZERO_M} months, then released`);
    n.policy = ZERO_RATE;
  },
  probes: probesFor(),
  land(c, t) {
    const p1 = at(t, 1, ZERO, "pol"), d1 = p1 - at(c, 1, ZERO, "pol"), t1 = at(t, 1, ZERO, "ten") - at(c, 1, ZERO, "ten");
    // the shock is "policy held near zero": that is what lands (the gap to the control is whatever the control's rate is)
    return { ok: p1 <= 0.0125, msg: `policy ${(100 * p1).toFixed(2)}% (${bp(d1)}) and ten-year ${bp(t1)} at +1 month` };
  },
  hold(c, t) {
    const p = at(t, 60, ZERO, "pol"), avg = meanGap(c, t, ZERO, "pol", 1, 60), ten = meanGap(c, t, ZERO, "ten", 1, 60);
    // THE WHOLE PEG, not its first five years (audit 2026-11-05): read only to
    // +60 months the hold passed while the end-of-month rate climbed to 6-21%
    // in years 6-10, so everything after year 5 was graded as a zero-rate
    // decade that did not happen.
    let mx = 0, mxAt = 0, off = 0;
    for (let i = 1; i <= Math.min(ZERO_M, t.length - 1); i++) {
      const v = at(t, i, ZERO, "pol");
      if (v > mx) { mx = v; mxAt = i; }
      if (v > 0.0125) off++;
    }
    return { ok: p <= 0.0125 && mx <= 0.0125, msg: `policy ${(100 * p).toFixed(2)}% at +5 years; over the ${ZERO_M}-month peg at most ${(100 * mx).toFixed(2)}% (month +${mxAt}), above 1.25% in ${off} months (${bp(avg)} against the control over years 0-5; ten-year ${bp(ten)})` };
  },
  expect: [
    { obs: `probe.${ZERO}.ten`, unit: "pp", win: "mid", sign: -1, lo: -3.5, hi: -0.75, label: "ten-year (loan index), years 3-8", want: "falls 0.75-3.5 points as the market learns the bank rests at zero" },
    ...["office", "multifamily"].map((k) => ({ obs: `probe.${ZERO}.cap_${k}`, unit: "pp", win: "mid", sign: -1, lo: -2.5, hi: -0.5, label: `${LABEL[k]} cap rate, years 3-8`, want: "compresses 50-250bp over years", trace: "a cap under what any lender's spread allows is the failure signature" })),
    { obs: "land", unit: "rel", win: "mid", sign: +1, lo: 0.1, hi: 1.5, label: "land value, years 3-8", want: "inflates (10-150%)" },
    { obs: `probe.${ZERO}.debt`, unit: "rel", win: "mid", sign: +1, lo: 0.1, hi: 1.0, label: "the street's mortgage book, years 3-8", want: "leverage builds up (10-100%)" },
    { obs: `probe.${ZERO}.starts`, unit: "rel", win: "mid", sign: +1, lo: 0.1, hi: 1.5, tiny: 0.05, label: "starts, all classes, years 3-8", want: "rise" },
    { obs: "val.office", unit: "rel", win: "mid", sign: +1, lo: 0.1, hi: 0.8, label: "office values, years 3-8", want: "rise" },
    { obs: "distress", unit: "rel", win: "late", sign: +1, lo: 0.1, hi: 5, label: "distressed listings, years 8-15 (after release at year 10)", want: "rise when rates normalise: loans written at the top" },
  ],
  charts: [
    { title: "policy rate, %", obs: `probe.${ZERO}.pol`, scale: 100 },
    { title: "office cap rate, %", obs: `probe.${ZERO}.cap_office`, scale: 100 },
    { title: "land value index", obs: "land" },
  ],
};

// ------------------------------------------------------------------ 3c
const CRUNCH = "capital-credit-crunch";
const CRUNCH_M = 36;
// MODULE-LEVEL CONSTANTS. PRODUCTS, INTERNAL_PRODUCTS and the construction
// desks are shared by every run in a process; each twin runs in its own
// process (tools/shocks.mjs spawns one per run), so mutating them here touches
// only the shocked run. Applied at i === 0, restored at i === CRUNCH_M.
let saved = null;
function crunchApply(E) {
  saved = { prod: [], desk: [] };
  for (const p of [...E.PRODUCTS, ...E.INTERNAL_PRODUCTS]) {
    saved.prod.push([p, { ltv: p.ltv, uwDscr: p.uwDscr, debtYield: p.debtYield }]);
    p.ltv = p.ltv / 2;                          // the advance rate (debt.ts statedLtv starts here)
    if (p.uwDscr > 0) p.uwDscr = p.uwDscr * 2;  // coverage sizing: NOI / (uwDscr + standards) — about half the proceeds
    if (p.debtYield > 0) p.debtYield = p.debtYield * 2;  // debt-yield sizing: NOI / floor — exactly half
  }
  for (const d of E.constructionDesks()) {
    saved.desk.push([d, { scale: d.scale, cap: d.cap }]);
    d.scale = d.scale / 2; d.cap = d.cap / 2;   // construction LTC = min(cap, base x scale): half
  }
  return { products: saved.prod.length, desks: saved.desk.length };
}
function crunchRestore() {
  if (!saved) return;
  for (const [p, v] of saved.prod) Object.assign(p, v);
  for (const [d, v] of saved.desk) Object.assign(d, v);
  saved = null;
}
// What the street can borrow today on a fixed reference building (a $10M
// building earning a 7% NOI): debt.ts streetRefiProceeds, the best of the
// desks a non-player refinances or buys with, through the same `quote` every
// borrower is sized on. Read-only: it draws nothing and writes nothing.
const REF = { value: 10_000_000, noi: 700_000 };
function refAdvance(g, E) {
  return (E.streetRefiProceeds(g, REF.value, REF.noi, 0.95).principal ?? 0) / REF.value;
}
const crunch = {
  id: CRUNCH, group: "capital", title: "Credit crunch: max LTV and loan sizing halved for 3 years",
  what: `For ${CRUNCH_M} months every lender's product terms are cut through the sheets themselves: each permanent, bridge, land and mezzanine sheet's advance rate (debt.ts PRODUCTS and INTERNAL_PRODUCTS \`ltv\`) halved, its underwriting coverage (\`uwDscr\`) and debt-yield floor (\`debtYield\`) doubled, so each of the three sizing tests in \`quote\` writes about half the loan; and every construction desk's advance (proforma.ts constructionDesks \`scale\` and \`cap\`) halved. Every loan in town is sized through these: the player's quotes, the street's refinancings and acquisition loans (streetRefiProceeds, rivalDebt deskQuotes), the bidders' debt in a sale (propmarket dealView), facilities (facility.ts statedLtv) and construction loans (deskQuote). Covenants on loans already written (\`maxLTV\`, \`minDSCR\`, copied onto each loan at origination) are not touched. Restored at +${CRUNCH_M} months.`,
  sources: "2008-10: CMBS issuance stopped, bank advance rates fell from 75-80% to 50-60% and coverage tests rose (Fed SLOOS); US commercial deal volume fell about 70-80% 2007-09 (RCA); distressed and forced sales rose as balloons could not refinance; prices fell more than rents (Moody's/RCA CPPI −35-40%); equity-rich buyers bought cheap.",
  inject(g, city, i, ctx, E) {
    if (i === 0) {
      const before = refAdvance(g, E);
      const n = crunchApply(E);
      ctx.notes.push(`${n.products} loan sheets and ${n.desks} construction desks halved for ${CRUNCH_M} months; the street's best advance on a reference building ${(100 * before).toFixed(0)}% → ${(100 * refAdvance(g, E)).toFixed(0)}% of value`);
    }
    if (i === CRUNCH_M) crunchRestore();
  },
  probes: { ...probesFor(), adv: (g, city, E) => refAdvance(g, E) },
  land(c, t) {
    const r = at(t, 1, CRUNCH, "adv") / at(c, 1, CRUNCH, "adv");
    return { ok: r <= 0.6 && r >= 0.3, msg: `the street's best advance on a reference building ×${Number.isFinite(r) ? r.toFixed(2) : "—"} at +1 month (${(100 * at(t, 1, CRUNCH, "adv")).toFixed(0)}% against ${(100 * at(c, 1, CRUNCH, "adv")).toFixed(0)}%)` };
  },
  hold(c, t) {
    // in force through month 35, released at 36: by +5 years the sheets match again
    const r30 = at(t, 30, CRUNCH, "adv") / at(c, 30, CRUNCH, "adv");
    const r60 = at(t, 60, CRUNCH, "adv") / at(c, 60, CRUNCH, "adv");
    return { ok: r30 <= 0.6 && r60 >= 0.8, msg: `advance ×${Number.isFinite(r30) ? r30.toFixed(2) : "—"} at +30 months (in force), ×${Number.isFinite(r60) ? r60.toFixed(2) : "—"} at +5 years (released at +3)` };
  },
  expect: [
    { obs: `probe.${CRUNCH}.trades`, unit: "rel", win: "impact", sign: -1, lo: -0.85, hi: -0.3, tiny: 0.05, label: "deal volume (sales a month)", want: "collapses 30-85%" },
    { obs: "distress", unit: "rel", win: "impact", sign: +1, lo: 0.3, hi: 5, label: "distressed listings", want: "rise: balloons that cannot refinance" },
    { obs: "chargeOffsNew", unit: "rel", win: "impact", sign: +1, lo: 0.05, hi: 30, label: "lenders' charge-offs since the shock", want: "rise" },
    { obs: `probe.${CRUNCH}.debt`, unit: "rel", win: "impact", sign: -1, lo: -0.5, hi: -0.05, label: "the street's mortgage book", want: "shrinks as loans pay down and are not rewritten" },
    { obs: "val.office", unit: "rel", win: "impact", sign: -1, lo: -0.45, hi: -0.1, label: "office values", want: "fall 10-45%, more than rents" },
    { obs: "val.multifamily", unit: "rel", win: "impact", sign: -1, lo: -0.4, hi: -0.1, label: "apartment values", want: "fall 10-40%" },
    { obs: `probe.${CRUNCH}.starts`, unit: "rel", win: "impact", sign: -1, lo: -0.9, hi: -0.2, tiny: 0.05, label: "starts, all classes", want: "fall 20-90% (construction loans halved)" },
    ...CLASSES.map((k) => ({ obs: `eff.${k}`, unit: "rel", win: "impact", sign: 0, hi: 0.05, label: `${LABEL[k]} effective rent`, want: "within ±5%: prices fall more than rents" })),
  ],
  charts: [
    { title: "sales a month, all classes", obs: `probe.${CRUNCH}.trades` },
    { title: "distressed listings", obs: "distress" },
    { title: "office values (sample)", obs: "val.office" },
  ],
};

// ------------------------------------------------------------------ 3d
const WAVE = "capital-foreign-wave";
const WAVE_DEPTH = -1.5, WAVE_SHARE = 0.10;   // the top of startCapitalWave's range: depth −(0.8 + 0.7), share 0.03 + 0.07
const waveFunds = (g) => (g.rivals ?? []).filter((r) => r.wave);
const wave = {
  id: WAVE, group: "capital", title: "Foreign capital wave, high end",
  what: `The capital-wave swan's state set directly, as blackswans.ts startCapitalWave sets it, with its one draw fixed at the top of its range: econ.capWave = { phase "in", 36 months, depth ${WAVE_DEPTH}, share ${WAVE_SHARE} } — money abroad worth 10% of the street's book, which rivals.ts tickForeignMoney raises as named foreign funds (one first close a month, cash, no buildings) and which reaches prices only through what they bid. (startCapitalWave itself draws its depth from the shock stream, so it is not called.) From there the swan runs its own life: hold 12-24 months, then the money goes home and the funds sell.`,
  sources: "Japan 1985-91: Japanese investors held about 5-10% of US institutional commercial property at the peak, a third of downtown Los Angeles offices (Farrell 1993); trophy assets first; prices up with rents flat (caps compressed); reversal 1991-95 with heavy losses for late buyers.",
  inject(g, city, i, ctx) {
    if (i !== 0) return;
    const e = g.econ;
    if (e.capWave) { ctx.notes.push(`a wave was already live at the snapshot (${e.capWave.phase}); not restarted`); return; }
    e.capWave = { phase: "in", leftM: 36, len: 36, from: e.capitalWave ?? 0, to: WAVE_DEPTH, share: WAVE_SHARE };
    (e.blackSwans ??= []).push({ m: g.month, kind: "wave", size: Math.round(-WAVE_DEPTH * 100), sf: 0, title: "foreign capital found the city" });
    const aum = (g.rivals ?? []).filter((r) => !r.failedM && !r.goneM).reduce((a, r) => a + Math.max(0, r.aum ?? 0), 0);
    ctx.notes.push(`capWave set: phase in, 36 months, share ${WAVE_SHARE} of a street book of about $${(aum / 1e6).toFixed(0)}M`);
  },
  probes: {
    ...probesFor(),
    funds: (g) => waveFunds(g).length,
    raised: (g) => (g.econ.capWave?.raised ?? waveFunds(g).reduce((a, r) => a + (r.cash ?? 0) + (r.uncalled ?? 0), 0)),
    target: (g) => g.econ.capWave?.money ?? NaN,
    owned: (g) => waveFunds(g).reduce((a, r) => a + (r.bbls?.length ?? 0), 0),
  },
  land(c, t) {
    const f1 = at(t, 1, WAVE, "funds"), c1 = at(c, 1, WAVE, "funds");
    return { ok: f1 >= 1 && c1 === 0, msg: `${f1} foreign fund(s) raised at +1 month (control ${c1}); the wave's money $${((at(t, 1, WAVE, "target") || 0) / 1e6).toFixed(0)}M` };
  },
  hold(c, t) {
    let best = 0, iBest = 0, money = NaN;
    for (let i = 1; i <= Math.min(60, t.length - 1); i++) {
      const r = at(t, i, WAVE, "raised"); if (r > best) { best = r; iBest = i; }
      const m = at(t, i, WAVE, "target"); if (Number.isFinite(m)) money = m;
    }
    const share = best / money, own = Math.max(...t.slice(1, 61).map((r) => r.probe?.[P(WAVE, "owned")] ?? 0));
    return { ok: share >= 0.8 && own > 0, msg: `${(100 * share).toFixed(0)}% of the wave's $${(money / 1e6).toFixed(0)}M raised by +${iBest} months, in ${at(t, iBest, WAVE, "funds")} funds; at most ${own} deeds held by them` };
  },
  expect: [
    { obs: "val.office", unit: "rel", win: "impact", sign: +1, lo: 0.05, hi: 0.5, label: "office values", want: "rise 5-50%, trophy first" },
    { obs: `probe.${WAVE}.cap_office`, unit: "pp", win: "impact", sign: -1, lo: -1.5, hi: -0.2, label: "office cap rate", want: "compresses 20-150bp" },
    { obs: `probe.${WAVE}.cap_multifamily`, unit: "pp", win: "impact", sign: -1, lo: -1.5, hi: -0.1, label: "apartment cap rate", want: "compresses" },
    { obs: `probe.${WAVE}.trades`, unit: "rel", win: "impact", sign: +1, lo: 0.05, hi: 1.5, tiny: 0.05, label: "deal volume", want: "rises: the funds buy" },
    ...CLASSES.map((k) => ({ obs: `eff.${k}`, unit: "rel", win: "impact", sign: 0, hi: 0.05, label: `${LABEL[k]} effective rent`, want: "unchanged (within ±5%): rents moving is a miswiring" })),
    { obs: "val.office", unit: "rel", win: "late", sign: 0, hi: 0.1, label: "office values, years 8-15", want: "back to the control (±10%) once the money has gone" },
  ],
  charts: [
    { title: "office cap rate, %", obs: `probe.${WAVE}.cap_office`, scale: 100 },
    { title: "office values (sample)", obs: "val.office" },
    { title: "foreign funds' deeds", obs: `probe.${WAVE}.owned` },
  ],
};

export const SHOCKS = [ratesUp, ratesZero, crunch, wave];
