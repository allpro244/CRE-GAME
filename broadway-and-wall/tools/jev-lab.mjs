// THE JEV LAB — is Jev making good calls, measured by the simulator itself.
//
//   pnpm jev-lab                                 dry run: mock answers, prints what it WOULD send
//   TYPESAFE_API_KEY=… pnpm jev-lab --live       the real Jev on the exact production questions
//   pnpm jev-lab --live --variant v1-timing      A/B a wording (src/ai/jevQuestions.ts WORDING_VARIANTS)
//   pnpm jev-lab --seeds 12007,11 --checkpoints 12,36,60 --firms 3 --horizon 24 --out lab.json
//
// HOW GROUND TRUTH IS MADE. At each checkpoint the scripted world is paused and,
// for each sampled firm, every decision it would be asked is FORKED: one copy of
// the world per candidate action (buy each shortlisted listing or buy nothing;
// sell each shortlisted holding or keep them all; take the cash-out or not),
// plus one copy where the firm's scripted rule decides. Each fork is rolled
// forward `horizon` months deterministically and scored by the firm's value
// (equity + distributions) against the median scripted firm in the SAME fork —
// so a fork is judged on what the decision did, not on the cycle it happened
// to get. The best fork is the label.
//
// Then the exact production request is sent (to Jev with --live and a key, to
// the rule-based mock otherwise) and scored against the forks: did Jev's raw
// pick match the best action, what did its GATED decision (thresholds and
// fallback, as the game applies them) earn against the best and against the
// scripted rule, how calibrated are its yes-probabilities, does its
// confidence track accuracy, and what did it cost.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seeds = String(arg("seeds", "12007")).split(",").map(Number);
const checkpoints = String(arg("checkpoints", "12,36,60")).split(",").map(Number);
const nFirms = Number(arg("firms", 3));
const horizon = Number(arg("horizon", 24));
const variant = arg("variant", "base");
const live = argv.includes("--live") && !!process.env.TYPESAFE_API_KEY;
const out = resolve(arg("out", "jev-lab.json"));
const V = E.WORDING_VARIANTS[variant];
if (!V) { console.error(`Unknown variant ${variant}. Variants: ${Object.keys(E.WORDING_VARIANTS).join(", ")}`); process.exit(1); }
const T = E.DEFAULT_THRESHOLDS;

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const step = (g) => { const x = E.advanceMonth(g, parcels, bbls, adjacency); return x.gameOver ? { ...x, gameOver: null } : x; };

/** Answers forcing one action; everything else low-confidence (falls back). */
function forced(req, force) {
  const answers = {};
  for (const [id, q] of Object.entries(req.questions)) {
    const opts = q.type === "choice" ? Object.keys(q.criteria) : [];
    answers[id] = q.type === "noul" ? { type: "noul", noul: 0.5 } : q.type === "choice" ? E.choiceOf(opts[0], opts, 0.01) : E.scoreAt(2, 0.01);
  }
  Object.assign(answers, force(req));
  return { model: "fork", answers };
}

/** Roll a fork and score the firm against its own world. */
async function fork(g1, firmId, force) {
  let s = await E.runJevPeriod(g1, parcels, { answer: (req) => forced(req, force) });
  const v0 = Object.fromEntries(s.rivals.filter((r) => r.failedM === undefined).map((r) => [r.id, E.rivalEquity(E.markRival(s, parcels, r), r) + (r.distributed ?? 0)]));
  for (let m = 0; m < horizon; m++) s = step(s);
  const val = (r) => (r.failedM !== undefined ? 0 : E.rivalEquity(E.markRival(s, parcels, r), r)) + (r.distributed ?? 0);
  const peers = s.rivals.filter((r) => r.id !== firmId && v0[r.id] > 1e6).map((r) => val(r) / v0[r.id]).sort((a, b) => a - b);
  const pm = peers.length ? peers[Math.floor((peers.length - 1) / 2)] : 1;
  const r = s.rivals.find((x) => x.id === firmId);
  return v0[firmId] > 0 ? (val(r) / v0[firmId]) / pm : NaN;
}

const allHigh = (req) => Object.fromEntries(Object.keys(req.questions).filter((q) => q.startsWith("buy_") && q !== "buy_pick").map((q) => [q, E.scoreAt(4, 0.99)]));
const pickOf = (id, opt) => (req) => ({ [id]: E.choiceOf(opt, Object.keys(req.questions[id].criteria), 0.99) });

const rows = { buy: [], sell: [], refi: [] };
const calls = { n: 0, ms: 0, tokens: 0, fails: 0 };
let sample = null;
const t0 = Date.now();

console.log(`\nJEV LAB — ${live ? "LIVE jev-latest" : "DRY RUN (mock answers; nothing sent)"} · wording "${variant}" (${V.note}) · questions v${E.JEV_QUESTIONS_VERSION}`);
console.log(`  seeds ${seeds.join(",")} · checkpoints ${checkpoints.join(",")} · ${nFirms} firms · ${horizon}-month forks\n`);

for (const seed of seeds) {
  let g = E.firstListings(E.newGame(seed, parcels, 2_500_000), parcels, bbls);
  for (const cp of checkpoints) {
    while (g.month < cp) g = step(g);
    for (const id of E.defaultJevFirms(g, parcels, nFirms)) {
      const g1 = E.setJevFirms(g, { firms: [{ id }] });
      const built = E.buildJevRequest(g1, parcels, id);
      const req = V.apply(built.request);
      if (!Object.keys(req.questions).length) continue;
      sample ??= req;
      // ---- what Jev (or the mock) says
      let resp;
      const c0 = Date.now();
      try {
        resp = live ? (await E.callJev(req, { apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 10000 })).response : E.mockJev(req);
        calls.n++; calls.ms += Date.now() - c0; calls.tokens += resp.usage?.input_tokens ?? E.estimateTokens(req);
      } catch (e) {
        calls.fails++; console.log(`  ! ${seed}@${cp} ${id}: ${e.message}`); continue;
      }
      const A = resp.answers;
      const firm = g1.rivals.find((r) => r.id === id);
      const scripted = await fork(g1, id, () => ({}));
      // ---- BUY: none + the top three candidates
      if (built.ctx.buy.length) {
        const opts = ["none", ...built.ctx.buy.slice(0, 3).map((x) => x.bbl)];
        const outc = {};
        for (const o of opts) outc[o] = await fork(g1, id, o === "none" ? pickOf("buy_pick", "none") : (req2) => ({ ...allHigh(req2), ...pickOf("buy_pick", o)(req2) }));
        const best = opts.reduce((a, b) => (outc[b] > outc[a] ? b : a));
        const v = E.decideBuy(A, built.ctx.buy.map((x) => x.bbl), E.CHARTERS[firm.jev.charter].weights, T);
        const took = v.path === "jev" ? v.act.bbl : v.path === "pass" ? "none" : null;
        const gated = took && took in outc ? outc[took] : scripted;
        const raw = A.buy_pick?.choice;
        rows.buy.push({ seed, cp, id, raw, conf: A.buy_pick?.confidence, best, rawRight: raw === best, path: v.path, took, gated, bestV: outc[best], scripted, outc });
      }
      // ---- SELL: each of the three weakest holdings, or keep all
      if (built.ctx.sell.length) {
        const hs = built.ctx.sell.slice(0, 3);
        const keepAll = await fork(g1, id, (req2) => Object.fromEntries(built.ctx.sell.map((b) => [`sell_${b}`, { type: "noul", noul: 0.01 }])));
        for (const h of hs) {
          const sold = await fork(g1, id, () => ({ [`sell_${h}`]: { type: "noul", noul: 0.99 } }));
          const p = A[`sell_${h}`]?.noul;
          rows.sell.push({ seed, cp, id, bbl: h, p, sellBetter: sold > keepAll, sold, keepAll, scripted });
        }
      }
      // ---- REFI: yes or no
      if (built.ctx.refi) {
        const yes = await fork(g1, id, () => ({ refi: { type: "noul", noul: 0.99 } }));
        const no = await fork(g1, id, () => ({ refi: { type: "noul", noul: 0.01 } }));
        rows.refi.push({ seed, cp, id, p: A.refi?.noul, yesBetter: yes > no, yes, no, scripted });
      }
      process.stdout.write(`  ${seed}@${cp} ${firm.name.slice(0, 22).padEnd(22)} buy ${built.ctx.buy.length} · sell ${built.ctx.sell.length} · refi ${built.ctx.refi ? 1 : 0}\n`);
    }
  }
}

// ------------------------------------------------------------------ report
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "—");
console.log(`\n  BUY — ${rows.buy.length} decisions (value multiple vs own world after ${horizon} months; 1.000 = median scripted firm)`);
if (rows.buy.length) {
  console.log(`    raw pick = best action           ${rows.buy.filter((r) => r.rawRight).length}/${rows.buy.length}   (chance ≈ ${f2(mean(rows.buy.map((r) => 1 / Object.keys(r.outc).length)))})`);
  console.log(`    gated decision earned            ${f2(mean(rows.buy.map((r) => r.gated)))}   best available ${f2(mean(rows.buy.map((r) => r.bestV)))}   scripted rule ${f2(mean(rows.buy.map((r) => r.scripted)))}`);
  console.log(`    paths                            ${["jev", "pass", "fallback"].map((p) => `${p} ${rows.buy.filter((r) => r.path === p).length}`).join(" · ")}`);
  for (const [lo, hi] of [[0, 0.45], [0.45, 0.7], [0.7, 1.01]]) {
    const b = rows.buy.filter((r) => r.conf >= lo && r.conf < hi);
    if (b.length) console.log(`    confidence ${lo.toFixed(2)}–${Math.min(1, hi).toFixed(2)}: raw pick right ${b.filter((r) => r.rawRight).length}/${b.length}`);
  }
}
function calib(name, rs, pk, yk) {
  console.log(`\n  ${name} — ${rs.length} yes/no calls: reliability (Jev's p(yes) vs how often "yes" actually won)`);
  for (const [lo, hi] of [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]]) {
    const b = rs.filter((r) => r[pk] >= lo && r[pk] < hi);
    if (b.length) console.log(`    p ${lo.toFixed(1)}–${Math.min(1, hi).toFixed(1)}: n=${String(b.length).padStart(3)}  mean p ${mean(b.map((r) => r[pk])).toFixed(2)}  yes won ${(b.filter((r) => r[yk]).length / b.length).toFixed(2)}`);
  }
  const acc = rs.filter((r) => (r[pk] >= 0.5) === r[yk]).length;
  console.log(`    accuracy at p≥0.5: ${acc}/${rs.length}`);
}
if (rows.sell.length) calib("SELL", rows.sell, "p", "sellBetter");
if (rows.refi.length) calib("REFI", rows.refi, "p", "yesBetter");
console.log(`\n  COST  ${calls.n} calls${live ? ` · ${Math.round(calls.ms / Math.max(1, calls.n))}ms mean latency` : ""} · ${calls.tokens.toLocaleString()} input tokens ≈ $${(calls.tokens * E.JEV_USD_PER_MTOK / 1e6).toFixed(4)} · ${calls.fails} failed · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (!live && sample) {
  const q = Object.entries(sample.questions);
  console.log(`\n  DRY RUN — one request as it WOULD be sent (${q.length} questions, ≈${E.estimateTokens(sample).toLocaleString()} tokens, ${E.validateJevRequest(sample).length ? "INVALID" : "valid"}):`);
  console.log("    state: " + JSON.stringify(sample.state).slice(0, 400) + "…");
  for (const [id, qq] of q.slice(0, 4)) console.log(`    ${id} (${qq.type}): ${JSON.stringify(qq).slice(0, 300)}…`);
  console.log("  Set TYPESAFE_API_KEY and pass --live to measure Jev itself.");
}
writeFileSync(out, JSON.stringify({ live, variant, version: E.JEV_QUESTIONS_VERSION, seeds, checkpoints, horizon, rows, calls }, null, 1));
console.log(`\n  Dataset: ${out}\n`);
