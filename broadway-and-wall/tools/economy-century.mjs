// THE MONEY LOOP OVER A CENTURY (ONE_ECONOMY_PLAN.md step 2).
//
//   node tools/economy-century.mjs                    seed 550991, 100 years
//   SEEDS=550991,12007 YEARS=100 node tools/economy-century.mjs
//
// Since step 2 the town's jobs are its firms' heads (economy.ts) filled by the
// household register, and every class's demand for space is its tenants'. This
// asks the questions the plan's gate asks of a century: does the town grow at
// a metro's pace (0.5-1.5% a year in jobs) and can it decline for decades when
// its export industries lose out; does unemployment stay in its band; what do
// vacancy and real rents do; what is the local multiplier, and what share of
// the town's output is sold out of town. Printed per seed:
//   - every decade: jobs and their growth, the export share, the multiplier
//     (type II output; jobs per export job), unemployment, population, real
//     rents and vacancy by class;
//   - the seed's summary: job growth by decade, the share of declining
//     decades, unemployment's range, vacancy by class (min/median/max of
//     yearly readings), real rent change, mean multiplier and export share.
// Run ONE seed at a time on a shared machine (4 cores, other agents); the
// summary across seeds prints at the end.
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, "..", "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const SEEDS = (process.env.SEEDS ?? "550991").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 100);
const CLASSES = ["office", "retail", "industrial", "multifamily"];
const pc = (x, d = 1) => Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "—";
const sg = (x, d = 1) => Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(100 * x).toFixed(d)}%` : "—";
const f0 = (x) => Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—";
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };

const all = [];
for (const seed of SEEDS) {
  const city = makeCity("somewhere", 1);
  E.normalizeParcels(city.parcels);
  const bbls = Object.keys(city.parcels);
  let g = E.firstListings(E.newGame(seed, city.parcels), city.parcels, bbls);
  const t0 = Date.now();
  const yr = [];
  for (let m = 1; m <= YEARS * 12; m++) {
    g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    if (m % 12 !== 0) continue;
    const e = g.econ, mu = E.economyMultipliers(g);
    const cpi = e.cpi ?? 1;
    yr.push({
      y: m / 12, jobs: e.jobs, u: e.unemployment, pop: e.population, part: e.participation,
      outII: mu?.outputII, jobsII: mu?.jobsII, xs: mu?.exportShare,
      vac: Object.fromEntries(CLASSES.map((k) => [k, e.cityVac?.[k]])),
      rent: Object.fromEntries(CLASSES.map((k) => [k, (e.effRentIdx?.[k] ?? e.rentIdx[k]) / cpi])),
      heads: e.eco?.heads, natU: e.nat?.unemp,
    });
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`\nseed ${seed} — ${YEARS} years (${secs.toFixed(0)}s, ${(1000 * secs / (YEARS * 12)).toFixed(0)} ms a month)`);
  console.log("   yr      jobs   10y    exported  mult II  jobs/exp   unemp  (nation)   population   real rent office/retail/indust/flats        vacancy office/retail/indust/flats");
  for (const r of yr) {
    if (r.y % 10 !== 0 && r.y !== 1) continue;
    const p = yr.find((x) => x.y === r.y - 10);
    const rr0 = yr[0].rent;
    console.log(`  ${String(r.y).padStart(3)}  ${f0(r.jobs).padStart(8)}  ${p ? sg(Math.pow(r.jobs / p.jobs, 0.1) - 1) : "      "}  ${pc(r.xs, 0).padStart(6)}    ${r.outII?.toFixed(2)}     ${r.jobsII?.toFixed(2)}    ${pc(r.u).padStart(6)} (${pc(r.natU)})  ${f0(r.pop).padStart(9)}    ${CLASSES.map((k) => (r.rent[k] / rr0[k]).toFixed(2)).join(" / ")}    ${CLASSES.map((k) => pc(r.vac[k])).join(" / ")}`);
  }
  const dec = [];
  for (let y = 10; y <= YEARS; y += 10) {
    const a = yr.find((x) => x.y === y - 10) ?? yr[0], b = yr.find((x) => x.y === y);
    if (a && b) dec.push(Math.pow(b.jobs / a.jobs, 1 / (b.y - a.y)) - 1);
  }
  const last = yr.at(-1), first = yr[0];
  const res = {
    seed, dec, decline: dec.filter((x) => x < 0).length / Math.max(1, dec.length),
    cagr: Math.pow(last.jobs / first.jobs, 1 / (last.y - first.y)) - 1,
    uMin: Math.min(...yr.map((r) => r.u)), uMed: q(yr.map((r) => r.u), 0.5), uMax: Math.max(...yr.map((r) => r.u)),
    vac: Object.fromEntries(CLASSES.map((k) => { const v = yr.map((r) => r.vac[k]); return [k, [Math.min(...v), q(v, 0.5), Math.max(...v)]]; })),
    rent: Object.fromEntries(CLASSES.map((k) => [k, last.rent[k] / first.rent[k]])),
    mult: mean(yr.map((r) => r.outII).filter(Number.isFinite)), jobsII: mean(yr.map((r) => r.jobsII).filter(Number.isFinite)),
    xs: mean(yr.map((r) => r.xs).filter(Number.isFinite)), msMo: 1000 * secs / (YEARS * 12),
  };
  all.push(res);
  console.log(`  job growth by decade: ${dec.map((x) => sg(x)).join(" ")}   (century ${sg(res.cagr, 2)}/yr; ${pc(res.decline, 0)} of decades declining)`);
  console.log(`  unemployment ${pc(res.uMin)} .. ${pc(res.uMed)} .. ${pc(res.uMax)}   multiplier (type II output) ${res.mult.toFixed(2)}, jobs per export job ${res.jobsII.toFixed(2)}, exported ${pc(res.xs, 0)}`);
  console.log(`  vacancy min/median/max: ${CLASSES.map((k) => `${k} ${res.vac[k].map((v) => pc(v)).join("/")}`).join("   ")}`);
  console.log(`  real rent, last year over first: ${CLASSES.map((k) => `${k} ${res.rent[k].toFixed(2)}x`).join("  ")}`);
}
if (all.length > 1) {
  console.log(`\nACROSS ${all.length} SEEDS`);
  console.log(`  century job growth ${all.map((r) => sg(r.cagr, 2)).join(", ")}/yr; declining decades ${pc(mean(all.map((r) => r.decline)), 0)}`);
  console.log(`  unemployment range ${pc(Math.min(...all.map((r) => r.uMin)))} .. ${pc(Math.max(...all.map((r) => r.uMax)))}; multiplier ${mean(all.map((r) => r.mult)).toFixed(2)}; export share ${pc(mean(all.map((r) => r.xs)), 0)}; ${mean(all.map((r) => r.msMo)).toFixed(0)} ms a month`);
}
