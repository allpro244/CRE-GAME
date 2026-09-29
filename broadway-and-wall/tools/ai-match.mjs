// THE JEV MATCH — the same firms, the same seeds, with and without Jev.
//
//   pnpm ai-match                          mock Jev, 3 seeds × 10 years, the 6 largest firms
//   TYPESAFE_API_KEY=… pnpm ai-match       the real Jev (jev-latest)
//   pnpm ai-match --seeds 11,22,33,44 --years 15 --firms 8 --every 3 --out match.json
//   pnpm ai-match --mock                   force the mock even with a key set
//
// For each seed the town is run twice from the same start: once with every
// firm on its scripted rules (the control), once with the chosen firms'
// judgement informed by Jev. Because a Jev-run firm IS the scripted firm with
// Jev at its decision points, the difference between the two runs is exactly
// what Jev's answers changed. Reported per firm and in aggregate: equity plus
// everything distributed (scripted firms pay their partners; that money
// counts), IRR on those flows, worst drawdown, whether it failed, deeds
// bought/sold, the share of decisions where code acted on Jev vs fell back,
// the mean confidence of the choices, and the cost.
//
// The mock is a rule-based stand-in, not Jev: a mock match proves the plumbing
// and the accounting, not Jev's judgement. Run with a key for the real thing.
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
const seeds = String(arg("seeds", "12007,550991,73303")).split(",").map(Number);
const years = Number(arg("years", 10));
const nFirms = Number(arg("firms", 6));
const every = Number(arg("every", 3));
const out = resolve(arg("out", "ai-match-jev.json"));
const key = process.env.TYPESAFE_API_KEY;
const useMock = argv.includes("--mock") || !key;
const opts = useMock
  ? { answer: E.mockJev }
  : { apiKey: key, url: process.env.TYPESAFE_URL ?? E.TYPESAFE_URL, timeoutMs: Number(arg("timeout", 8000)), concurrency: 4, breaker: new E.JevBreaker() };

const M = (x) => `${x < 0 ? "-" : ""}$${(Math.abs(x) / 1e6).toFixed(1)}M`;
const P = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

/** IRR of yearly flows by bisection (flows[0] negative). */
function irr(flows) {
  const npv = (r) => flows.reduce((a, f, t) => a + f / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 2;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

async function play(seed, ids, withJev) {
  let g = E.firstListings(E.newGame(seed, parcels, 2_500_000), parcels, bbls);
  g.spectator = true;
  if (withJev) g = E.setJevFirms(g, { firms: ids.map((id) => ({ id })), every });
  // Every firm's starting value (equity + anything already distributed), for the same-world benchmark.
  const start0 = Object.fromEntries(g.rivals.filter((r) => r.failedM === undefined).map((r) => [r.id, E.rivalEquity(E.markRival(g, parcels, r), r) + (r.distributed ?? 0)]));
  const track = Object.fromEntries(ids.map((id) => {
    const r = g.rivals.find((x) => x.id === id);
    return [id, { e0: E.rivalEquity(E.markRival(g, parcels, r), r), flows: [], peak: -Infinity, dd: 0, dist: r.distributed ?? 0, owned: new Set(r.bbls), bought: 0, sold: 0 }];
  }));
  const calls = { n: 0, ms: 0, tokens: 0, fails: 0 };
  for (let m = 0; m < years * 12; m++) {
    if (withJev && E.jevDue(g)) {
      g = await E.runJevPeriod(g, parcels, { ...opts, onFirm: (_id, i) => { calls.n++; calls.ms += i.ms; calls.tokens += i.tokens; if (!i.ok) calls.fails++; } });
    }
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null };
    if ((m + 1) % 3 === 0) {
      for (const id of ids) {
        const r = g.rivals.find((x) => x.id === id), t = track[id];
        const eq = r.failedM !== undefined ? 0 : E.rivalEquity(E.markRival(g, parcels, r), r);
        const val = eq + (r.distributed ?? 0);
        t.peak = Math.max(t.peak, val);
        if (t.peak > 0) t.dd = Math.max(t.dd, 1 - val / t.peak);
        const now = new Set(r.bbls);
        for (const b of now) if (!t.owned.has(b)) t.bought++;
        for (const b of t.owned) if (!now.has(b)) t.sold++;
        t.owned = now;
        if ((m + 1) % 12 === 0) { t.flows.push((r.distributed ?? 0) - t.dist); t.dist = r.distributed ?? 0; }
      }
    }
  }
  // THE SAME-WORLD BENCHMARK. One firm's different decisions change the tape,
  // and the tape feeds the cycle, so a Jev run and its scripted twin do not
  // live through the same macro path (measured: seed 73303 with one Jev firm
  // hit a recession at month 42 where its twin was still at the peak).
  // Dividing each firm's multiple by the median multiple of the scripted
  // firms IN ITS OWN WORLD takes the market out of the comparison.
  const valueNow = (r) => (r.failedM !== undefined ? 0 : E.rivalEquity(E.markRival(g, parcels, r), r)) + (r.distributed ?? 0);
  const peers = g.rivals.filter((r) => !ids.includes(r.id) && start0[r.id] > 1e6).map((r) => valueNow(r) / start0[r.id]).sort((a, b) => a - b);
  const peerMult = peers.length ? peers[Math.floor((peers.length - 1) / 2)] : 1;
  const res = {};
  for (const id of ids) {
    const r = g.rivals.find((x) => x.id === id), t = track[id];
    const eq = r.failedM !== undefined ? 0 : E.rivalEquity(E.markRival(g, parcels, r), r);
    const flows = [-t.e0, ...t.flows];
    flows[flows.length - 1] += eq;
    res[id] = { name: r.name, style: r.style, charter: r.jev?.charter ?? E.charterForStyle(r.style), e0: t.e0, equity: eq, distributed: r.distributed ?? 0,
      value: eq + (r.distributed ?? 0), irr: t.e0 > 0 ? irr(flows) : NaN,
      adj: start0[id] > 0 && peerMult > 0 ? (valueNow(r) / start0[id]) / peerMult : NaN, peerMult, maxDD: t.dd, failed: r.failedM !== undefined, bought: t.bought, sold: t.sold };
  }
  const log = g.jev?.log ?? [];
  const confs = [];
  for (const f of Object.values(g.jev?.firms ?? {})) for (const a of Object.values(f.answers ?? {})) if (a.type !== "noul") confs.push(a.confidence);
  return { res, calls, paths: log.reduce((a, l) => { a[l.path] = (a[l.path] ?? 0) + 1; return a; }, {}),
    acted: log.filter((l) => l.action && l.path === "jev").length, meanConf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : NaN, tokens: g.jev?.tokens ?? 0, log };
}

console.log(`\nJEV MATCH — ${useMock ? "MOCK Jev (rule-based stand-in; plumbing, not judgement)" : "jev-latest via api.typesafe.ai"} · ${seeds.length} seeds × ${years} years · ${nFirms} firms · a decision period every ${every} months\n`);
const rows = [];
const report = { mock: useMock, seeds, years, nFirms, every, runs: [] };
for (const seed of seeds) {
  const g0 = E.firstListings(E.newGame(seed, parcels, 2_500_000), parcels, bbls);
  const ids = E.defaultJevFirms(g0, parcels, nFirms);
  const t0 = Date.now();
  const A = await play(seed, ids, false);
  const B = await play(seed, ids, true);
  const decided = (B.paths.jev ?? 0) + (B.paths.pass ?? 0) + (B.paths.fallback ?? 0);
  console.log(`  seed ${seed}  (${((Date.now() - t0) / 1000).toFixed(0)}s; ${B.calls.n} calls, ${B.calls.fails} failed, ${Math.round(B.calls.ms / Math.max(1, B.calls.n))}ms avg, ${B.tokens.toLocaleString()} tokens ≈ $${(B.tokens * E.JEV_USD_PER_MTOK / 1e6).toFixed(4)}; `
    + `verdicts ${B.paths.jev ?? 0} act / ${B.paths.pass ?? 0} pass / ${B.paths.fallback ?? 0} fallback = ${P((B.paths.fallback ?? 0) / Math.max(1, decided))} fallback; mean choice/score confidence ${B.meanConf.toFixed(2)})`);
  console.log("    firm                      charter        value: scripted →   Jev      IRR: scripted →  Jev    max DD: scr → Jev   deeds +/−: scr → Jev   failed     vs own world");
  for (const id of ids) {
    const a = A.res[id], b = B.res[id];
    rows.push({ seed, id, a, b });
    console.log(`    ${a.name.slice(0, 24).padEnd(24)}  ${b.charter.padEnd(13)}  ${M(a.value).padStart(9)} → ${M(b.value).padStart(8)}   ${P(a.irr).padStart(7)} → ${P(b.irr).padStart(6)}   ${P(a.maxDD).padStart(6)} → ${P(b.maxDD).padStart(6)}   ${`${a.bought}/${a.sold}`.padStart(7)} → ${`${b.bought}/${b.sold}`.padEnd(7)}   ${a.failed ? "yes" : "no"} → ${b.failed ? "yes" : "no"}    ${a.adj.toFixed(2)} → ${b.adj.toFixed(2)}`);
  }
  report.runs.push({ seed, ids, scripted: A.res, jev: B.res, calls: B.calls, paths: B.paths, meanConf: B.meanConf, tokens: B.tokens, log: B.log.slice(-400) });
}

const med = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const better = rows.filter((r) => r.b.value > r.a.value).length;
const same = rows.filter((r) => Math.abs(r.b.value - r.a.value) < 1).length;
console.log(`\n  VERDICT over ${rows.length} firm-runs`);
console.log(`    value created (equity + distributions): Jev ahead in ${better}, identical in ${same}, behind in ${rows.length - better - same}`);
console.log(`    median value   scripted ${M(med(rows.map((r) => r.a.value)))}   Jev ${M(med(rows.map((r) => r.b.value)))}`);
console.log(`    median IRR     scripted ${P(med(rows.map((r) => r.a.irr)))}   Jev ${P(med(rows.map((r) => r.b.irr)))}`);
console.log(`    median max DD  scripted ${P(med(rows.map((r) => r.a.maxDD)))}   Jev ${P(med(rows.map((r) => r.b.maxDD)))}`);
console.log(`    vs own world   scripted ${med(rows.map((r) => r.a.adj)).toFixed(2)}   Jev ${med(rows.map((r) => r.b.adj)).toFixed(2)}   (the firm's multiple ÷ the median scripted firm's multiple in the same run: 1.00 = the street's median, controlling for the cycle each run got)`);
console.log(`    ahead of own world: scripted ${rows.filter((r) => r.a.adj > 1).length}/${rows.length}   Jev ${rows.filter((r) => r.b.adj > 1).length}/${rows.length}`);
console.log(`    failures       scripted ${rows.filter((r) => r.a.failed).length}   Jev ${rows.filter((r) => r.b.failed).length}`);
console.log(`    deeds bought   scripted ${rows.reduce((a, r) => a + r.a.bought, 0)}   Jev ${rows.reduce((a, r) => a + r.b.bought, 0)}   ·   sold  scripted ${rows.reduce((a, r) => a + r.a.sold, 0)}   Jev ${rows.reduce((a, r) => a + r.b.sold, 0)}`);
if (useMock) console.log("\n    (MOCK: these numbers measure the mock's fixed rules, not Jev. Set TYPESAFE_API_KEY to measure Jev.)");
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(`\n  Match log: ${out}\n`);
