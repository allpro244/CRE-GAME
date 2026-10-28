// THE HOUSEHOLD REGISTER AGAINST THE TOWN IT SHADOWS.
//
//   pnpm households                       3 seeds x 30 years, the island
//   SEEDS=550991 YEARS=10 REGION=1 pnpm households
//
// Stage 1 of the household micro-simulation (src/engine/households.ts) is a
// shadow: nothing reads it, so the only question worth asking of it is whether
// its households add up to the aggregates the engine already keeps, and what
// it costs. Every five years this prints the register's sums beside the
// engine's own numbers — households, persons, the island's renter households,
// the jobless rate, the renters' median rent burden — and the distributions
// the engine has no answer to yet (savings, debt, arrears). Last, the time
// the register adds to a month: its tick and the copy of its columns that
// advanceMonth's state clone now makes.
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, "..", "test", ".engine.mjs")).href);
const { makeCity, REGION } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const SEEDS = (process.env.SEEDS ?? "550991,12007,73303").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 30);
const REG = process.env.REGION === "1";
const f = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—";
const pc = (x, d = 1) => Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "—";
const dev = (a, b) => b ? `${a >= b ? "+" : ""}${(100 * (a / b - 1)).toFixed(1)}%` : "—";

let worstCpu = 0;
const allMs = [], allCpu = [];
for (const seed of SEEDS) {
  const city = REG ? makeCity(REGION, 1) : makeCity("somewhere", 1);
  E.normalizeParcels(city.parcels);
  const bbls = Object.keys(city.parcels);
  let g = E.firstListings(E.newGame(seed, city.parcels, undefined, undefined, REG ? { citySize: "region" } : undefined), city.parcels, bbls);
  console.log(`\nseed ${seed}${REG ? " (region)" : ""} — ${YEARS} years`);
  console.log("  yr  agents  w_isl  w_reg | households (eng)        | persons (eng pop)       | island renters (eng)  | unemp reg/eng  | burden p50 (eng)  >30% | arrears  evict/yr | sav p10/p50/p90 (mo p50)     | debt p50/p90  share");
  let tick = 0, copy = 0, cpu = 0, months = 0, adv = 0, evictY = 0;
  for (let m = 1; m <= YEARS * 12; m++) {
    const t0 = performance.now();
    g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
    adv += performance.now() - t0;
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    // what the register adds to a month, timed on a scratch copy of it
    const c0 = process.cpuUsage();
    const t1 = performance.now();
    const hh = structuredClone(g.households);   // cloneState copies the columns the same way (a slice each)
    const t2 = performance.now();
    // (as next month: the register memoises a block's flat size from one month to the next)
    const scratch = { ...g, month: g.month + 1, households: hh, streams: { ...g.streams } };
    E.tickHouseholdRegister(scratch, city.parcels);
    const t3 = performance.now();
    const c1 = process.cpuUsage(c0);
    if (m > 1) { copy += t2 - t1; tick += t3 - t2; cpu += (c1.user + c1.system) / 1000; months++; }
    const st = E.householdStats(g);
    evictY += st.flow.evictions;
    if (m % 60 === 0 || m === 1) {
      const e = g.econ;
      const H = st.engineHouseholds;
      const rent = E.islandRenterHouseholds(g, city.parcels);
      console.log(`  ${String(Math.round(m / 12)).padStart(2)}  ${String(st.agents).padStart(6)}  ${st.wIsland.toFixed(0).padStart(5)}  ${st.wRegion.toFixed(2).padStart(5)} | ${f(st.households).padStart(7)} (${f(H).padStart(7)}) ${dev(st.households, H).padStart(6)} | ${f(st.persons).padStart(7)} (${f(e.population).padStart(7)}) ${dev(st.persons, e.population).padStart(6)} | ${f(st.islandRenters).padStart(6)} (${f(rent).padStart(6)}) ${dev(st.islandRenters, rent).padStart(6)} | ${pc(st.unemployment)} / ${pc(e.unemployment)} | ${pc(st.medianBurden)} (${pc(st.engineBurden)}) ${pc(st.costBurdened, 0).padStart(4)} | ${pc(st.arrearsRate)}  ${f(m === 1 ? 0 : evictY).padStart(6)} | ${f(st.savP10).padStart(6)} / ${f(st.savP50).padStart(6)} / ${f(st.savP90).padStart(7)} (${st.savMonthsP50.toFixed(1)}) | ${f(st.debtP50).padStart(5)} / ${f(st.debtP90).padStart(6)}  ${pc(st.debtShare, 0)}`);
    }
    if (m % 12 === 0) evictY = 0;
  }
  const ms = (tick + copy) / Math.max(1, months);
  allMs.push(ms); allCpu.push(cpu / months); worstCpu = Math.max(worstCpu, cpu / months);
  console.log(`  time: register tick ${(tick / months).toFixed(2)} ms + column copy ${(copy / months).toFixed(2)} ms = ${ms.toFixed(2)} ms a month added (process CPU ${(cpu / months).toFixed(2)} ms), against ${(adv / (YEARS * 12)).toFixed(0)} ms for the whole month; load average ${(await import("node:os")).loadavg()[0].toFixed(1)}`);
  const packed = JSON.stringify(E.packHouseholds(g.households));
  console.log(`  save: the register packs to ${(packed.length / 1024).toFixed(0)} KB (${g.households.n} agents)`);
}
// The verdict is on CPU time: wall-clock on a shared machine reads the other
// processes' load (a load average of 16 on 4 cores put wall at ~4.5x CPU).
console.log(`\nms per month added, CPU: ${allCpu.map((x) => x.toFixed(2)).join(" / ")}; wall: ${allMs.map((x) => x.toFixed(2)).join(" / ")} (target <= 15) — ${worstCpu <= 15 ? "OK" : "OVER"}`);
