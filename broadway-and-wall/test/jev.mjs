// JEV — the TypeSafe System One integration, held to the engine's rules.
//
//   pnpm engine && node test/jev.mjs
//
// No key is needed: a deterministic mock stands in for Jev, and fixtures pin
// exact answers where a test needs a specific verdict. Asserted:
//
//   (a) ANSWERS DRIVE DECISIONS EXACTLY AS MAPPED — a confident pick buys that
//       listing through rivalBuys; a confident `none` keeps the firm off the
//       tape; a sure sale lists at the mapped ask; a yes to refinance takes the
//       scripted room; a chosen scheme breaks ground; a distress pick sells
//       that building.
//   (b) LOW CONFIDENCE FALLS BACK — Jev firms whose every answer is below its
//       threshold play out bit-identically to the same firms without Jev.
//   (c) NO JEV, NO CHANGE — every Jev entry point exercised on a run with no
//       Jev firm hashes identically to a plain run; building a request never
//       moves the world.
//   (d) THE BOOKS BALANCE — every ledger entry of a Jev firm satisfies its
//       identity (buy: Δcash−Δdebt = −(price+closing); sale: price−tax;
//       refi: 0; develop: −equity).
//   (e) THE PAYLOAD IS VALID — every request passes the API's rules (Choice
//       2-255 options, Score 2-10 levels, context budget); buckets say what
//       they should; the client retries a 429 and the breaker opens.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0, n = 0;
const check = (ok, msg) => { n++; console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const hash = (g) => {
  const s = JSON.stringify(g);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + ":" + s.length;
};
const fresh = (seed = 12007) => E.firstListings(E.newGame(seed, parcels, 2_500_000), parcels, bbls);
const step = (g) => { const x = E.advanceMonth(g, parcels, bbls, adjacency); return x.gameOver ? { ...x, gameOver: null, cash: 6e6 } : x; };
const rival = (g, id) => g.rivals.find((r) => r.id === id);
/** Answer a built request: fixtures where given, a low-confidence default elsewhere. */
const fixture = (fix = {}, dflt = "low") => (req) => {
  const answers = {};
  for (const [id, q] of Object.entries(req.questions)) {
    if (fix[id]) { answers[id] = typeof fix[id] === "function" ? fix[id](q) : fix[id]; continue; }
    if (dflt === "mock") { answers[id] = E.mockJev({ ...req, questions: { [id]: q } }).answers[id]; continue; }
    const opts = q.type === "choice" ? Object.keys(q.criteria) : [];
    answers[id] = q.type === "noul" ? { type: "noul", noul: 0.5 }
      : q.type === "choice" ? E.choiceOf(opts[0], opts, 0.05) : E.scoreAt(2, 0.1);
  }
  return { model: "fixture", answers, usage: { input_tokens: E.estimateTokens(req) } };
};

console.log("\nJEV — TypeSafe System One informs the street's own decisions\n");

// (e) buckets ---------------------------------------------------------------
{
  const B = E.buckets;
  check(B.yieldVs(0.074, 0.061, "the market cap rate") === "well above the market cap rate (7.4% vs 6.1%)", `yieldVs: ${B.yieldVs(0.074, 0.061, "the market cap rate")}`);
  check(B.yieldVs(0.061, 0.06, "x").startsWith("about the same as"), "yieldVs: ±0.25pp is 'about the same'");
  check(B.priceVs(880_000, 1_000_000).startsWith("below appraisal"), `priceVs: ${B.priceVs(880_000, 1_000_000)}`);
  check(B.priceVs(1_010_000, 1_000_000).startsWith("at appraisal"), "priceVs: within 3% is 'at'");
  check(B.dscrVs(1.18, 1.2).startsWith("below the lender minimum") && B.dscrVs(1.25, 1.2).startsWith("thin"), `dscrVs: ${B.dscrVs(1.25, 1.2)}`);
  check(B.monthsAway(5).startsWith("within 6 months") && B.monthsAway(40).startsWith("more than 3 years"), `monthsAway: ${B.monthsAway(5)}`);
  check(B.leverage(0.7).startsWith("high") && B.leverage(0) === "no debt", `leverage: ${B.leverage(0.7)}`);
  check(B.vacancyVs(0.16, 0.115).startsWith("soft"), `vacancyVs: ${B.vacancyVs(0.16, 0.115)}`);
  check(B.marginOnCost(6.24, 6.19).startsWith("barely clears"), `marginOnCost: ${B.marginOnCost(6.24, 6.19)}`);
}

// (c) no Jev, no change -------------------------------------------------------
{
  const M = 36;
  let a = fresh(), b = fresh();
  for (let m = 0; m < M; m++) {
    a = step(a);
    if (m % 3 === 0) {
      if (E.jevDue(b)) check(false, "a Jev period was due with no Jev firm");
      b = await E.runJevPeriod(b, parcels, { answer: E.mockJev });
      b = E.stampJevHistory(b, parcels);
    }
    b = step(b);
  }
  check(hash(a) === hash(b), `no Jev firm: ${M} months with every Jev entry point exercised hash identically to a plain run (${hash(a)})`);
  check(!("jev" in b) && !("jevBooks" in b) && !("jevHistory" in b), "and leave no Jev fields on the state");
  const g = E.setJevFirms(fresh(), { firms: E.defaultJevFirms(fresh(), parcels, 3).map((id) => ({ id })) });
  const h0 = hash(g);
  for (const r of g.rivals.filter((x) => x.jev)) E.buildJevRequest(g, parcels, r.id);
  check(hash(g) === h0, "building Jev requests never moves the world");
}

// (e) payloads ----------------------------------------------------------------
{
  let g = fresh();
  const ids = g.rivals.filter((r) => r.failedM === undefined).map((r) => r.id);
  g = E.setJevFirms(g, { firms: ids.map((id) => ({ id })) });
  let reqs = 0, errs = [], maxQ = 0, maxChars = 0, maxOpts = 0, types = new Set();
  for (let m = 0; m < 48; m++) {
    if (m % 12 === 0) {
      for (const r of g.rivals.filter((x) => x.jev && x.failedM === undefined)) {
        const { request } = E.buildJevRequest(g, parcels, r.id);
        if (!Object.keys(request.questions).length) continue;   // nothing to ask: the controller sends nothing
        reqs++;
        const e = E.validateJevRequest(request);
        if (e.length) errs.push(`${r.id}@${m}: ${e.join("; ")}`);
        const qs = Object.values(request.questions);
        maxQ = Math.max(maxQ, qs.length);
        maxChars = Math.max(maxChars, JSON.stringify(request).length);
        for (const q of qs) { types.add(q.type); if (q.type === "choice") maxOpts = Math.max(maxOpts, Object.keys(q.criteria).length); if (q.type === "score" && (q.criteria.length < 2 || q.criteria.length > 10)) errs.push("score levels"); }
      }
    }
    g = step(g);
  }
  check(reqs > 50 && errs.length === 0, `${reqs} requests across every firm and four years validate against the API's rules${errs.length ? ": " + errs.slice(0, 2).join(" | ") : ""}`);
  check(types.has("choice") && types.has("score") && types.has("noul"), `all three primitives used; up to ${maxQ} questions, ${maxOpts} choice options, ${Math.round(maxChars / 4)} est. tokens per request (≤ 64k)`);
  // Every builder in the library, on its own.
  const lib = [
    E.qBuyPick({ a: "x", b: "y" }), E.qBuyValue({ a: 1 }), E.qBuyLocation({ a: 1 }), E.qBuyIncome({ a: 1 }), E.qBuyFit({ a: 1 }),
    E.qBuyTiming(), E.qSell({ a: 1 }), E.qRefi({ a: 1 }), E.qBuildPick({ a: "x" }), E.qClaim({ a: 1 }), E.qDistressPick({ a: "x", b: "y" }, "$1M"),
  ];
  const libErrs = E.validateJevRequest({ state: { x: 1 }, model: E.JEV_MODEL, questions: Object.fromEntries(lib.map((q, i) => [`q${i}`, q])) });
  check(libErrs.length === 0, `every question in the library (${lib.length} builders, version ${E.JEV_QUESTIONS_VERSION}) is a valid API question`);
  const over = E.validateJevRequest({ state: "x", model: "jev-latest", questions: { c: { type: "choice", instructions: "?", criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, null])) }, s: { type: "score", instructions: "?", criteria: ["one"] } } });
  check(over.length === 2, `the validator refuses 256 options and a one-level score (${over.length} errors)`);
}

// (a) answers drive decisions --------------------------------------------------
{
  // BUY — a confident pick with strong scores is bought through rivalBuys.
  let g = fresh();
  const id = E.defaultJevFirms(g, parcels, 1)[0];
  g = E.setJevFirms(g, { firms: [{ id, charter: "valueadd" }] });
  const built = E.buildJevRequest(g, parcels, id);
  const pick = built.ctx.buy[0];
  check(!!pick, `the firm is offered ${built.ctx.buy.length} affordable listings`);
  const strong = Object.fromEntries(Object.keys(built.request.questions).filter((q) => q.startsWith("buy_") && q !== "buy_pick").map((q) => [q, E.scoreAt(4, 0.9)]));
  let s1 = await E.runJevPeriod(g, parcels, { answer: fixture({ ...strong, buy_pick: (q) => E.choiceOf(pick.bbl, Object.keys(q.criteria), 0.9) }) });
  const before = rival(s1, id).cash;
  s1 = step(s1);
  const r1 = rival(s1, id);
  check(r1.bbls.includes(pick.bbl) && !s1.listings.some((l) => l.bbl === pick.bbl), `a confident pick (0.9) with a composite of 1.0 buys ${pick.bbl}`);
  const e1 = s1.jevBooks[id].find((e) => e.kind === "buy" && e.bbl === pick.bbl);
  check(!!e1 && e1.by === "jev" && e1.amount === pick.ask, `booked as a Jev buy at the ask ${pick.ask}`);
  check(s1.jev.log.some((l) => l.firmId === id && l.point === "buy" && l.action?.startsWith("bought")), "and the log records what code did");
  void before;

  // BUY — composite under the bar is a pass (no purchase, off the tape).
  const weak = Object.fromEntries(Object.keys(strong).map((q) => [q, E.scoreAt(1, 0.9)]));
  let s2 = await E.runJevPeriod(g, parcels, { answer: fixture({ ...weak, buy_pick: (q) => E.choiceOf(pick.bbl, Object.keys(q.criteria), 0.9) }) });
  s2 = step(s2);
  const v2 = s2.jev.log.find((l) => l.firmId === id && l.point === "buy");
  check(!rival(s2, id).bbls.includes(pick.bbl) && v2?.path === "pass", `a composite of 0.25 < 0.6 passes (${v2?.why})`);

  // BUY — `none` keeps the firm off the tape for the whole period.
  let s3 = await E.runJevPeriod(g, parcels, { answer: fixture({ buy_pick: (q) => E.choiceOf("none", Object.keys(q.criteria), 0.8) }) });
  const name = rival(s3, id).name;
  const comps0 = (s3.comps ?? []).length;
  for (let m = 0; m < 3; m++) s3 = step(s3);
  const bought = (s3.comps ?? []).slice(comps0).filter((c) => c.buyer === name).length;
  check(bought === 0 && s3.jev.log.some((l) => l.firmId === id && l.point === "buy" && l.path === "pass"), `a confident 'none' keeps the firm off the tape all period (${bought} tape purchases)`);

  // SELL — a sure sale lists at the mapped ask. (A year in, so the book has been held twelve months.)
  let gy = fresh();
  for (let m = 0; m < 13; m++) gy = step(gy);
  gy = E.setJevFirms(gy, { firms: [{ id, charter: "valueadd" }] });
  const builtY = E.buildJevRequest(gy, parcels, id);
  const sellQ = Object.keys(builtY.request.questions).find((q) => q.startsWith("sell_"));
  check(!!sellQ, `a year in, the firm is asked about ${builtY.ctx.sell.length} holdings`);
  const sbbl = sellQ.slice(5);
  let s4 = await E.runJevPeriod(gy, parcels, { answer: fixture({ [sellQ]: { type: "noul", noul: 0.95 } }) });
  s4 = step(s4);
  const li = s4.listings.find((l) => l.bbl === sbbl && l.sellerId === id);
  const rec = E.resolveRec(parcels, s4, sbbl);
  const conv = E.conveyedValue(s4, rec, sbbl, false, E.assetGrade(rival(s4, id), rec));
  const mult = 1.14 - 0.14 * (0.95 - 0.8) / 0.2;
  check(!!li && li.ask === Math.round(conv * mult / 1000) * 1000, `sell p=0.95 lists ${sbbl} at ${mult.toFixed(3)}x conveyed value (${li?.ask})`);
  let s5 = await E.runJevPeriod(gy, parcels, { answer: fixture(Object.fromEntries(Object.keys(builtY.request.questions).filter((q) => q.startsWith("sell_")).map((q) => [q, { type: "noul", noul: 0.05 }]))) });
  s5 = step(s5);
  check(s5.jev.log.some((l) => l.firmId === id && l.point === "sell" && l.path === "pass"), "every holding at p=0.05 is a hold: the scripted trim is skipped");
}

// (a) REFI, BUILD, DISTRESS — found by walking a scripted run to where each is asked.
{
  let g = fresh();
  let refiDone = false, buildDone = false;
  for (let y = 0; y < 14 && !(refiDone && buildDone); y++) {
    const probe = E.setJevFirms(g, { firms: g.rivals.filter((r) => r.failedM === undefined).map((r) => ({ id: r.id })) });
    // Street developers rarely hold both dirt and dry powder at once, so the
    // build decision is staged: the first living developer is handed the six
    // best unowned vacant lots and $60M, the way a land bank looks at a raise.
    const dev = probe.rivals.find((x) => x.jev && x.failedM === undefined && x.style === "developer");
    if (dev && !buildDone) {
      const owned = new Set([...probe.rivals.flatMap((x) => x.bbls), ...probe.listings.map((l) => l.bbl), ...(probe.cityJobs ?? []).map((j) => j.bbl)]);
      const lots = Object.values(parcels).filter((p) => (probe.built?.[p.bbl]?.class ?? p.class) === "land" && !owned.has(p.bbl) && p.lotArea >= 5000)
        .sort((a, b) => b.demandScore - a.demandScore).slice(0, 6);
      dev.bbls.push(...lots.map((p) => p.bbl));
      dev.cash += 60_000_000;
    }
    for (const r of probe.rivals.filter((x) => x.jev)) {
      const b = E.buildJevRequest(probe, parcels, r.id);
      if (!refiDone && b.ctx.refi) {
        let s = await E.runJevPeriod(probe, parcels, { answer: fixture({ refi: { type: "noul", noul: 0.9 } }) });
        const d0 = rival(s, r.id).debt;
        s = step(s);
        const e = (s.jevBooks?.[r.id] ?? []).find((x) => x.kind === "refi" && x.by === "jev");
        check(!!e && e.debtDelta === e.cashDelta && e.amount > 1_000_000, `refi yes (0.9) takes the scripted room: +${e ? (e.amount / 1e6).toFixed(2) : "?"}M debt on ${r.name} (year ${y})`);
        void d0;
        refiDone = true;
      }
      if (!buildDone && b.ctx.build.length) {
        const o = b.ctx.build[0];
        let s = await E.runJevPeriod(probe, parcels, { answer: fixture({ build_pick: (q) => E.choiceOf(o.id, Object.keys(q.criteria), 0.9) }) });
        s = step(s);
        const job = (s.cityJobs ?? []).find((j) => j.bbl === o.bbl && j.firmId === r.id);
        const e = (s.jevBooks?.[r.id] ?? []).find((x) => x.kind === "develop");
        check(!!job && !!e && e.cashDelta - e.debtDelta - (e.partners ?? 0) === -e.amount, `build pick (0.9) breaks ground on ${o.id} for ${r.name} (year ${y})`);
        buildDone = true;
      }
    }
    for (let m = 0; m < 12; m++) g = step(g);
  }
  check(refiDone, "a refinancing decision was found and exercised");
  check(buildDone, "a build decision was found and exercised");

  // DISTRESS — a firm one month from missing a payment, with the line full.
  let d = fresh();
  const r = [...d.rivals].filter((x) => x.bbls.length >= 4).sort((a, b) => a.id < b.id ? -1 : 1)[0];
  d = E.setJevFirms(d, { firms: [{ id: r.id }] });
  const t = rival(d, r.id);
  const m0 = E.markRival(d, parcels, t);
  t.cash = -300_000; t.stressMs = 1; t.distributed = 0; t.uncalled = 0; t.debt = Math.round(m0.aum * 0.85);
  const b = E.buildJevRequest(d, parcels, t.id);
  check(b.ctx.distress.length >= 2, `a stressed firm is asked which of ${b.ctx.distress.length} buildings to sell`);
  if (b.ctx.distress.length >= 2) {
    const want = b.ctx.distress[1];
    let s = await E.runJevPeriod(d, parcels, { answer: fixture({ distress_pick: (q) => E.choiceOf(want, Object.keys(q.criteria), 0.8) }) });
    s = step(s);
    const li = s.listings.find((l) => l.bbl === want && l.sellerId === t.id && l.distress);
    check(!!li, `the distress pick (0.8) goes on the tape: ${want}${li ? "" : " — " + JSON.stringify(s.jev.log.filter((l) => l.point === "distress"))}`);
  }
}

// (b) low confidence falls back --------------------------------------------------
{
  let a = fresh(), b = fresh();
  const ids = E.defaultJevFirms(b, parcels, 6);
  b = E.setJevFirms(b, { firms: ids.map((id) => ({ id })) });
  for (let m = 0; m < 36; m++) {
    if (E.jevDue(b)) b = await E.runJevPeriod(b, parcels, { answer: fixture({}, "low") });
    a = step(a); b = step(b);
  }
  const strip = (g) => ({ ...g, jev: undefined, jevBooks: undefined, jevHistory: undefined, rivals: g.rivals.map((r) => ({ ...r, jev: undefined })) });
  const paths = new Set(b.jev.log.map((l) => l.path));
  check(hash(strip(a)) === hash(strip(b)) && !paths.has("jev") && !paths.has("pass"),
    `six firms whose every answer is below threshold play out bit-identically to their scripted selves over 3 years (${b.jev.log.length} fallbacks logged)`);
}

// (d) the books balance, (e) determinism -------------------------------------------
async function run(months) {
  let g = fresh();
  g = E.setJevFirms(g, { firms: E.defaultJevFirms(g, parcels, 6).map((id) => ({ id })) });
  for (let m = 0; m < months; m++) {
    if (E.jevDue(g)) g = await E.runJevPeriod(g, parcels, { answer: E.mockJev });
    g = step(g);
  }
  return g;
}
{
  const g = await run(96);
  const all = Object.values(g.jevBooks ?? {}).flat();
  const kinds = {};
  let broken = 0;
  for (const e of all) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    // A syndicated deal's investors move money in the same event (their
    // equity in at a groundbreak, their take out of a sale): `partners`.
    const net = e.cashDelta - e.debtDelta - (e.partners ?? 0);
    const want = e.kind === "buy" ? -(e.amount + (e.closing ?? 0)) : e.kind === "sale" ? e.amount - (e.tax ?? 0)
      : e.kind === "develop" ? -e.amount : 0;
    if (Math.abs(net - want) > 1) { broken++; if (broken < 4) console.log("   ", JSON.stringify(e)); }
  }
  console.log(`          ledger: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  check(all.length > 10 && broken === 0, `every one of ${all.length} Jev-firm ledger entries satisfies its identity`);
  check(kinds.buy > 0 && kinds.sale > 0, "buys and sales were exercised");
  const paths = {};
  for (const l of g.jev.log) paths[`${l.point}:${l.path}`] = (paths[`${l.point}:${l.path}`] ?? 0) + 1;
  console.log(`          verdicts: ${Object.entries(paths).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  check(Object.keys(paths).some((k) => k.endsWith(":jev")) && Object.keys(paths).some((k) => k.endsWith(":pass")), "the mock drives acts and passes");
  const again = await run(96);
  check(hash(again) === hash(g), "two runs with the same answers are identical");
}

// (e) the client ----------------------------------------------------------------
{
  const g = E.setJevFirms(fresh(), { firms: E.defaultJevFirms(fresh(), parcels, 1).map((id) => ({ id })) });
  const { request } = E.buildJevRequest(g, parcels, g.rivals.find((r) => r.jev).id);
  let calls = 0, sawAuth = "";
  const flaky = async (url, init) => {
    calls++;
    sawAuth = init.headers.authorization;
    if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after-ms": "10" } });
    return E.mockJevFetch()(url, init);
  };
  const r = await E.callJev(request, { apiKey: "test-key", fetchImpl: flaky });
  check(calls === 2 && r.attempts === 2 && Object.keys(r.response.answers).length === Object.keys(request.questions).length, "a 429 is retried once (honouring retry-after) and every question is answered");
  check(sawAuth === "Bearer test-key", "the key travels only as a Bearer header");
  let threw = false;
  try { await E.callJev(request, { fetchImpl: async () => new Response(JSON.stringify({ model: "x", answers: {} }), { status: 200 }) }); } catch { threw = true; }
  check(threw, "a response missing answers is refused");
  const br = new E.JevBreaker(3, 4);
  br.fail(10); br.fail(10); br.fail(10);
  check(!br.allow(11) && br.allow(14), "the breaker opens after 3 failures and lets a trial through 4 periods later");
  let st = E.setJevFirms(fresh(), { firms: E.defaultJevFirms(fresh(), parcels, 2).map((id) => ({ id })) });
  st = await E.runJevPeriod(st, parcels, { fetchImpl: async () => new Response("down", { status: 503 }), retries: 0 });
  check(Object.values(st.jev.firms).every((f) => f.error) && st.jev.errors === 2, "a failed call is filed per firm and its decisions fall back");
}

console.log(`\n${bad ? `${bad} of ${n} FAILED` : `all ${n} checks passed`}\n`);
process.exit(bad ? 1 : 0);
