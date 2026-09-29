// A HEADLESS MATCH — outside AIs running rival firms, no browser, no player.
//
//   pnpm ai-match                                   four scripted mock firms, 10 years
//   pnpm ai-match --config my-match.json            your firms and APIs
//   pnpm ai-match --years 20 --seed 7 --out log.json
//
// Config (JSON). Keys are NEVER written in it — name the environment variable:
//
//   {
//     "seed": 12007, "years": 10, "cash": 25000000, "everyMonths": 3, "maxCalls": 2000,
//     "firms": [
//       { "name": "JEV Capital", "provider": "webhook", "baseUrl": "http://127.0.0.1:8787/turn", "keyEnv": "JEV_API_KEY" },
//       { "name": "GPT Partners", "provider": "openai-compatible", "model": "gpt-4o-mini", "keyEnv": "OPENAI_API_KEY" },
//       { "name": "Claude & Co",  "provider": "anthropic", "model": "claude-sonnet-5", "keyEnv": "ANTHROPIC_API_KEY" },
//       { "name": "Index Fund",   "provider": "mock", "mock": "hold" }
//     ]
//   }
//
// Prints a leaderboard each year and a final report; writes the whole match
// (every turn's reasoning and verdicts, the ledger, quarterly marks) to --out.
// The engine is the same bundle every harness uses (`pnpm engine`).
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const cfgPath = arg("config");
const cfg = cfgPath ? JSON.parse(readFileSync(resolve(cfgPath), "utf8")) : {
  firms: [
    { name: "Yield Mock", provider: "mock", mock: "yield" },
    { name: "Contrarian Mock", provider: "mock", mock: "contrarian" },
    { name: "Builder Mock", provider: "mock", mock: "builder" },
    { name: "Hold Mock", provider: "mock", mock: "hold" },
  ],
};
const seed = Number(arg("seed", cfg.seed ?? 12007));
const years = Number(arg("years", cfg.years ?? 10));
const cash0 = Number(arg("cash", cfg.cash ?? 25_000_000));
const every = Number(cfg.everyMonths ?? 3);
const out = resolve(arg("out", cfg.out ?? `ai-match-${seed}.json`));
const budget = { used: 0, max: Number(cfg.maxCalls ?? 5000) };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (m) => `${MON[((m % 12) + 12) % 12]} ${2000 + Math.floor(m / 12)}`;
const M = (x) => `$${(x / 1e6).toFixed(1)}M`;
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(seed, parcels, 2_500_000), parcels, bbls);
g.spectator = true;
g = E.createAiFirms(g, cfg.firms.map((f) => ({
  name: f.name, provider: f.provider === "mock" ? `mock:${f.mock ?? "hold"}` : f.provider, model: f.model, cash: f.cash,
})), cash0);
const ids = E.aiFirmIds(g);
const configs = {};
for (const [i, f] of cfg.firms.entries()) {
  const id = ids[i];
  if (f.provider === "mock") {
    const play = E.mockPlayers[f.mock ?? "hold"];
    if (!play) throw new Error(`Unknown mock "${f.mock}". Mocks: ${Object.keys(E.mockPlayers).join(", ")}`);
    configs[id] = { kind: "mock", script: play };
    continue;
  }
  const apiKey = f.keyEnv ? process.env[f.keyEnv] : undefined;
  if (f.keyEnv && !apiKey) console.warn(`  ! ${f.name}: environment variable ${f.keyEnv} is not set — calling without a key.`);
  configs[id] = {
    kind: f.provider, baseUrl: f.baseUrl, model: f.model, apiKey, headers: f.headers,
    timeoutMs: f.timeoutMs ?? 90_000, maxTokens: f.maxTokens, jsonMode: f.jsonMode,
  };
}

console.log(`\nAI MATCH — ${cfg.firms.length} firms, ${years} years, seed ${seed}, ${M(cash0)} each, a turn every ${every} months\n`);
console.log(cfg.firms.map((f, i) => `  ${ids[i].padEnd(24)} ${f.name.padEnd(22)} ${f.provider}${f.model ? ` · ${f.model}` : ""}${f.mock ? ` · ${f.mock}` : ""}`).join("\n"));
console.log("");

const calls = {}, fails = {}, latency = {};
const t0 = Date.now();
for (let m = 0; m < years * 12; m++) {
  if (E.aiTurnDue(g, every)) {
    g = await E.runAiTurn(g, parcels, configs, {
      everyMonths: every, budget,
      onTurn: (id, r) => {
        calls[id] = (calls[id] ?? 0) + 1;
        if (!r.ok) { fails[id] = (fails[id] ?? 0) + 1; console.log(`  ! ${label(g.month)} ${id}: ${r.error}`); }
        if (r.ms !== undefined) latency[id] = (latency[id] ?? 0) + r.ms;
      },
    });
  }
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  // Spectator: the player's own firm sits out, and its principal's mortality
  // must not end the match. See CLAUDE.md, "watch for the frozen world".
  if (g.gameOver) g = { ...g, gameOver: null };
  if ((m + 1) % 12 === 0) {
    const st = E.aiStandings(g, parcels);
    console.log(`  ${label(g.month).padEnd(9)} ${st.map((x) => `${x.name} ${M(x.equity)}${x.failedM !== undefined ? " (wound up)" : ` ${x.buildings}b`}`).join(" · ")}`);
  }
}

// ------------------------------------------------------------------ report
const st = E.aiStandings(g, parcels);
const yrs = years;
const street = g.rivals.filter((r) => !r.aiControlled && r.failedM === undefined)
  .map((r) => E.rivalEquity(E.markRival(g, parcels, r), r)).sort((a, b) => a - b);
console.log(`\nFINAL — ${label(g.month)} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${budget.used} provider calls)\n`);
console.log("  rank  firm                     equity     multiple  IRR/yr   bldgs  debt       buys  sales  refused  failed calls");
const rows = st.map((x, i) => {
  const start = g.rivals.find((r) => r.id === x.id)?.aiControlled ? cash0 : cash0;
  const mult = x.equity / start;
  // AI firms distribute nothing, so equity at the end is the only cash flow
  // back: the IRR is the compound annual growth of equity.
  const irr = mult > 0 ? Math.pow(mult, 1 / yrs) - 1 : -1;
  const book = g.aiBooks?.[x.id] ?? [];
  const turns = (g.aiTurns ?? []).filter((t) => t.firmId === x.id);
  const refused = turns.flatMap((t) => t.results).filter((r) => !r.ok).length;
  const line = `  ${String(i + 1).padStart(4)}  ${x.name.padEnd(24)} ${M(x.equity).padStart(9)}  ${mult.toFixed(2).padStart(8)}x ${(irr * 100).toFixed(1).padStart(6)}%  ${String(x.buildings).padStart(5)}  ${M(x.debt).padStart(9)}  ${String(book.filter((e) => e.kind === "buy").length).padStart(4)}  ${String(book.filter((e) => e.kind === "sale").length).padStart(5)}  ${String(refused).padStart(7)}  ${String(fails[x.id] ?? 0).padStart(6)}`;
  console.log(line + (x.failedM !== undefined ? `  WOUND UP ${label(x.failedM)}` : ""));
  return { ...x, multiple: mult, irr, refused, failedCalls: fails[x.id] ?? 0, calls: calls[x.id] ?? 0, avgMs: calls[x.id] ? Math.round((latency[x.id] ?? 0) / calls[x.id]) : undefined };
});
console.log(`\n  For scale: the scripted street's median firm equity is ${M(street[Math.floor(street.length / 2)] ?? 0)} across ${street.length} firms.`);

console.log("\n  BIGGEST DEALS");
for (const x of st) {
  const book = (g.aiBooks?.[x.id] ?? []).filter((e) => e.kind === "buy" || e.kind === "sale" || e.kind === "develop")
    .sort((a, b) => b.amount - a.amount).slice(0, 3);
  for (const e of book) {
    const rec = E.resolveRec(parcels, g, e.bbl);
    console.log(`    ${x.name.padEnd(22)} ${label(e.m).padEnd(9)} ${e.kind.padEnd(8)} ${M(e.amount).padStart(8)}  ${rec?.address ?? e.bbl}${e.with ? ` · ${e.with}` : ""}`);
  }
}
console.log("\n  IN THEIR OWN WORDS (latest reasoning)");
for (const x of st) {
  const t = [...(g.aiTurns ?? [])].reverse().find((q) => q.firmId === x.id && (q.reasoning || q.error));
  if (!t) continue;
  const said = (t.reasoning || `[${t.error}]`).replace(/\s+/g, " ");
  console.log(`    ${x.name} (${label(t.m)}): ${said.slice(0, 220)}${said.length > 220 ? "…" : ""}`);
}

writeFileSync(out, JSON.stringify({
  protocol: "broadway-wall-ai/1", seed, years, cash0, everyMonths: every,
  firms: cfg.firms.map((f, i) => ({ id: ids[i], name: f.name, provider: f.provider, model: f.model, mock: f.mock })),
  final: rows, history: g.aiHistory, turns: g.aiTurns, ledger: g.aiBooks, providerCalls: budget.used,
}, null, 1));
console.log(`\n  Match log: ${out}\n`);
