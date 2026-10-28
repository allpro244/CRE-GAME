// THE CITY'S FIRM BOOKS AGAINST THE TOWN THEY SHADOW.
//
//   node tools/economy.mjs                      3 seeds x 30 years, the island
//   SEEDS=550991 YEARS=10 node tools/economy.mjs
//
// Step 1 of ONE_ECONOMY_PLAN.md (src/engine/economy.ts) is a shadow: nothing
// reads the books, so the questions worth asking are whether what they say
// agrees with what the engine already says, and what they cost. Printed:
//   - employment by industry: the engine's heads (named firms' headcount, the
//     off-map sample sized to the town's jobs) against the heads the solved
//     output implies (output over output per worker) — where demand and the
//     engine's payrolls part company;
//   - the local multiplier the leakages imply (type I: firms only; type II:
//     households' spending closed in), output and jobs per export job;
//   - the share of the town's output sold out of town;
//   - EBITDA margins by industry against the BEA's (gross operating surplus
//     over output, Use table 2023 — industries.ts `gos`);
//   - the payroll the firms pay against the wages the household register's
//     households earn (two answers to one quantity: step 2's first job);
//   - the ledger's identity residual, and the CPU a month of the books adds.
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import v8 from "node:v8";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, "..", "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const SEEDS = (process.env.SEEDS ?? "550991,12007,73303").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 30);
const pc = (x, d = 0) => Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "—";
const sg = (x, d = 0) => Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(100 * x).toFixed(d)}%` : "—";
const f0 = (x) => Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—";
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;

const IDS = E.INDUSTRY_IDS;
const acc = { gap: IDS.map(() => []), margin: IDS.map(() => []), heads: IDS.map(() => []), implied: IDS.map(() => []),
  outI: [], outII: [], jobsII: [], expShare: [], payGap: [], cpu: [], clone: [], resid: [], saveKB: [], totGap: [] };

for (const seed of SEEDS) {
  const city = makeCity("somewhere", 1);
  E.normalizeParcels(city.parcels);
  const bbls = Object.keys(city.parcels);
  let g = E.firstListings(E.newGame(seed, city.parcels), city.parcels, bbls);
  console.log(`\nseed ${seed} — ${YEARS} years`);
  console.log("  yr  firms  jobs(eng)  jobs(implied)   mult I/II  jobs/exp-job  exported | payroll firms/register | ledger resid/gross  market | ms/mo cpu  clone | save");
  for (let m = 1; m <= YEARS * 12; m++) {
    g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const ec = g.economy;
    if (!ec?.last) continue;
    // what the books add to a month, timed on a scratch copy (the same month again)
    const c0 = process.cpuUsage();
    const t1 = performance.now();
    const copy = structuredClone(ec);      // advanceMonth's state clone copies it the same way
    const t2 = performance.now();
    const scratch = { ...g, economy: copy, streams: { ...g.streams } };
    E.tickEconomy(scratch);
    const c1 = process.cpuUsage(c0);
    acc.clone.push(t2 - t1);
    acc.cpu.push((c1.user + c1.system) / 1000 - (t2 - t1));
    const l = ec.last;
    acc.resid.push(Math.abs(l.ledgerSum) / Math.max(1, l.ledgerGross));
    if (m % 12 !== 0) continue;
    const yr = m / 12;
    const bi = E.economyByIndustry(g);
    const mu = E.economyMultipliers(g);
    const heads = bi.reduce((a, r) => a + r.heads, 0), implied = bi.reduce((a, r) => a + r.impliedHeads, 0);
    const payGap = l.hhWagesFirms / Math.max(1, l.hhWagesRegister) - 1;
    for (let i = 0; i < IDS.length; i++) {
      const r = bi[i];
      if (r.heads > 1) acc.gap[i].push(r.impliedHeads / r.heads - 1);
      if (Number.isFinite(r.margin)) acc.margin[i].push(r.margin);
      acc.heads[i].push(r.heads); acc.implied[i].push(r.impliedHeads);
    }
    acc.outI.push(mu.outputI); acc.outII.push(mu.outputII); acc.jobsII.push(mu.jobsII); acc.expShare.push(mu.exportShare);
    acc.payGap.push(payGap); acc.totGap.push(implied / heads - 1);
    if (yr % 5 === 0 || yr === 1) {
      const kb = v8.serialize(ec).length / 1024;   // a save goes to IndexedDB by structured clone
      acc.saveKB.push(kb);
      const n = acc.cpu.length, cpu = mean(acc.cpu.slice(Math.max(0, n - 12))), cl = mean(acc.clone.slice(Math.max(0, n - 12)));
      console.log(`  ${String(yr).padStart(2)}  ${String(ec.L.slot.n).padStart(5)}  ${f0(heads).padStart(9)}  ${f0(implied).padStart(9)} ${sg(implied / heads - 1, 1).padStart(6)}   ${mu.outputI.toFixed(2)}/${mu.outputII.toFixed(2)}     ${mu.jobsII.toFixed(2)}       ${pc(mu.exportShare).padStart(4)}   |  ${(l.hhWagesFirms / 1e6).toFixed(1)}M / ${(l.hhWagesRegister / 1e6).toFixed(1)}M ${sg(payGap).padStart(5)}    | ${(Math.abs(l.ledgerSum) / l.ledgerGross).toExponential(1)}  ${l.market.toFixed(2).padStart(7)} | ${cpu.toFixed(1).padStart(5)}  ${cl.toFixed(1).padStart(5)} | ${kb.toFixed(0)} KB`);
    }
  }
}

console.log(`\nBY INDUSTRY — ${SEEDS.length} seeds x ${YEARS} years, yearly samples`);
console.log("  industry       heads(eng)  implied   implied/eng   EBITDA margin  BEA (GOS/output)");
for (let i = 0; i < IDS.length; i++) {
  console.log(`  ${IDS[i].padEnd(13)} ${f0(mean(acc.heads[i])).padStart(9)}  ${f0(mean(acc.implied[i])).padStart(8)}   ${sg(mean(acc.gap[i])).padStart(6)}        ${pc(mean(acc.margin[i]), 1).padStart(6)}        ${pc(E.INDUSTRIES[IDS[i]].gos, 1).padStart(6)}`);
}
console.log(`\nSUMMARY`);
console.log(`  shadow employment against the engine's (all industries)   ${sg(mean(acc.totGap), 1)} mean, ${sg(Math.min(...acc.totGap), 1)} .. ${sg(Math.max(...acc.totGap), 1)}`);
console.log(`  local output multiplier, type I / type II                 ${mean(acc.outI).toFixed(2)} / ${mean(acc.outII).toFixed(2)}   (RIMS II metro output multipliers ~1.5-2.5)`);
console.log(`  local jobs per export job (type II)                       ${mean(acc.jobsII).toFixed(2)}   (Moretti 2010: ~1.6 more per tradable job, ~2.6 in all)`);
console.log(`  share of output exported                                  ${pc(mean(acc.expShare), 1)}`);
console.log(`  firms' cash payroll over the register's wages             ${sg(mean(acc.payGap), 1)}`);
console.log(`  ledger residual / gross, worst                            ${Math.max(...acc.resid).toExponential(2)}`);
console.log(`  ms per month added: books ${mean(acc.cpu).toFixed(2)} cpu (p95 ${acc.cpu.sort((a, b) => a - b)[Math.floor(acc.cpu.length * 0.95)].toFixed(2)}) + state clone ${mean(acc.clone).toFixed(2)}   (target <= 20)`);
console.log(`  economy state in a save                                   ${Math.max(...acc.saveKB).toFixed(0)} KB at most`);
