// THE CITY'S FIRM BOOKS AGAINST THE TOWN THEY SHADOW.
//
//   node tools/economy.mjs                      1 seed x 30 years, the island
//   SEEDS=550991,12007 YEARS=10 node tools/economy.mjs
//
// Steps 1-1b of ONE_ECONOMY_PLAN.md (src/engine/economy.ts, households.ts) are
// a shadow: nothing reads the books, so the questions worth asking are
// whether what they say agrees with what the engine already says, and what
// they cost. Printed, for each seed:
//   - every year: the shadow's jobs (named firms, the engine's construction
//     trades, government per resident, and every other industry from its own
//     demand) against the engine's `e.jobs`; the register's earners in work
//     and its households against the engine's; the firms' payroll against the
//     register's wages (one number since 1b — the gap must be zero); the
//     multiplier; the oil price; the CPU the books and the register add;
//   - at years 1/10/20/30: employment by industry, shadow against the
//     engine's way of sizing it (named heads plus the off-map residual of
//     e.jobs spread toward the nation's mix), and the EBITDA margin against
//     the BEA's (gross operating surplus over output, Use table 2023);
//   - what construction was bought for, and its margin against the BEA's.
// Run ONE seed at a time on a shared machine (4 cores, other agents).
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import v8 from "node:v8";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, "..", "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const SEEDS = (process.env.SEEDS ?? "550991").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 30);
const SNAP = new Set([1, 10, 20, 30, YEARS]);
const pc = (x, d = 0) => Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "—";
const sg = (x, d = 0) => Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(100 * x).toFixed(d)}%` : "—";
const f0 = (x) => Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—";
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const cpuMs = (f) => { const c0 = process.cpuUsage(); f(); const c = process.cpuUsage(c0); return (c.user + c.system) / 1000; };

const IDS = E.INDUSTRY_IDS;
const all = { outI: [], outII: [], jobsII: [], payGap: [], cpuBooks: [], cpuReg: [], margin: IDS.map(() => []), conMargin: [], conShare: [] };

for (const seed of SEEDS) {
  const city = makeCity("somewhere", 1);
  E.normalizeParcels(city.parcels);
  const bbls = Object.keys(city.parcels);
  let g = E.firstListings(E.newGame(seed, city.parcels), city.parcels, bbls);
  console.log(`\nseed ${seed} — ${YEARS} years`);
  console.log("  yr   jobs: shadow / engine        earners(reg) | households reg / eng      arrived left /yr | payroll firms / register    | mult I/II  jobs/exp  exported | oil $/bbl (real) | ms/mo books reg | save");
  const snaps = [];
  let arrY = 0, leftY = 0;
  for (let m = 1; m <= YEARS * 12; m++) {
    g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const ec = g.economy;
    const fl = g.households?.flow;
    arrY += fl?.arrived ?? 0; leftY += fl?.left ?? 0;
    if (!ec?.last) continue;
    // what the books and the register add to a month: the same month again on scratch copies
    {
      const scratch = { ...g, economy: structuredClone(ec), households: structuredClone(g.households), streams: { ...g.streams } };
      all.cpuBooks.push(cpuMs(() => E.tickFirms(scratch)));
      const reg = { ...scratch, month: g.month };
      all.cpuReg.push(cpuMs(() => E.tickHouseholdRegister(reg, city.parcels)));
      all.cpuBooks[all.cpuBooks.length - 1] += cpuMs(() => E.tickEconomy(reg));
    }
    const l = ec.last;
    if (m % 12 !== 0) continue;
    const yr = m / 12;
    const bi = E.economyByIndustry(g);
    const mu = E.economyMultipliers(g);
    const st = E.householdStats(g);
    const heads = l.heads.reduce((a, x) => a + x, 0);
    const payGap = l.hhWagesFirms / Math.max(1, l.hhWagesRegister) - 1;
    all.outI.push(mu.outputI); all.outII.push(mu.outputII); all.jobsII.push(mu.jobsII); all.payGap.push(Math.abs(payGap));
    for (let i = 0; i < IDS.length; i++) if (Number.isFinite(bi[i].margin)) all.margin[i].push(bi[i].margin);
    const con = bi[IDS.indexOf("construction")];
    all.conMargin.push(con.margin);
    const n = all.cpuBooks.length;
    const kb = v8.serialize(ec).length / 1024;
    console.log(`  ${String(yr).padStart(2)}  ${f0(heads).padStart(7)} / ${f0(l.jobsEngine).padStart(7)} ${sg(heads / l.jobsEngine - 1, 1).padStart(6)}   ${f0(st.employed).padStart(7)} | ${f0(st.households).padStart(7)} / ${f0(st.engineHouseholds).padStart(7)} ${sg(st.households / st.engineHouseholds - 1, 1).padStart(6)}   ${f0(arrY).padStart(5)} ${f0(leftY).padStart(5)} | ${(l.hhWagesFirms / 1e6).toFixed(2)}M / ${(l.hhWagesRegister / 1e6).toFixed(2)}M ${sg(payGap, 3).padStart(7)} | ${mu.outputI.toFixed(2)}/${mu.outputII.toFixed(2)}   ${mu.jobsII.toFixed(2)}     ${pc(mu.exportShare).padStart(4)}   | ${l.oil.toFixed(0).padStart(4)} (${l.oilReal.toFixed(2)})      | ${mean(all.cpuBooks.slice(n - 12)).toFixed(1).padStart(5)} ${mean(all.cpuReg.slice(n - 12)).toFixed(1).padStart(5)} | ${kb.toFixed(0)} KB`);
    arrY = 0; leftY = 0;
    if (SNAP.has(yr)) {
      // who the register's households are: retired-headed, and persons
      const r = g.households, a = r.a;
      let ret = 0, hh = 0;
      for (let i = 0; i < r.n; i++) { hh += a.wt[i]; if (a.emp1[i] === -4) ret += a.wt[i]; }
      snaps.push({ yr, bi, l, st, retired: ret / hh, pop: g.econ.population, uEng: g.econ.unemployment });
    }
  }
  console.log(`\n  WHAT THE TOWN'S OUTPUT IS BOUGHT FOR, a month ($M): households, government, building, exports; and who the households are`);
  for (const s of snaps) {
    const l = s.l, named = l.namedHeads.reduce((a, x) => a + x, 0), heads = l.heads.reduce((a, x) => a + x, 0);
    console.log(`  yr ${String(s.yr).padStart(2)}  C ${(l.C / 1e6).toFixed(1)}  G ${(l.G / 1e6).toFixed(1)}  P ${(l.P / 1e6).toFixed(2)}  X ${(l.X / 1e6).toFixed(1)}   | off-map share of jobs: shadow ${pc(1 - named / heads)}, engine ${pc(1 - named / l.jobsEngine)} | retired-headed ${pc(s.retired)}  persons ${f0(s.st.persons)} (engine population ${f0(s.pop)})  unemployment reg ${pc(s.st.unemployment, 1)} (engine ${pc(s.uEng, 1)})`);
  }
  // by industry at the snapshot years
  console.log(`\n  EMPLOYMENT BY INDUSTRY, shadow (named + demand) against the engine's way of sizing it, and the register's earners`);
  console.log(`  industry      ` + snaps.map((s) => `| yr ${String(s.yr).padStart(2)}  shadow  engine    gap   reg   `).join(""));
  for (let i = 0; i < IDS.length; i++) {
    console.log(`  ${IDS[i].padEnd(13)} ` + snaps.map((s) => { const r = s.bi[i]; return `| ${f0(r.heads).padStart(12)} ${f0(r.engHeads).padStart(7)} ${sg(r.heads / r.engHeads - 1).padStart(6)} ${f0(r.regEarners).padStart(6)}   `; }).join(""));
  }
  console.log(`\n  EBITDA MARGIN BY INDUSTRY against the BEA's (GOS / output), and its oil bill per $ of output`);
  console.log(`  industry      ` + snaps.map((s) => `| yr ${String(s.yr).padStart(2)}  margin  `).join("") + "|   BEA   | oil bill");
  for (let i = 0; i < IDS.length; i++) {
    const last = snaps.at(-1).bi[i];
    console.log(`  ${IDS[i].padEnd(13)} ` + snaps.map((s) => `| ${pc(s.bi[i].margin, 1).padStart(13)}  `).join("") + `| ${pc(last.marginBEA, 1).padStart(6)}  | ${pc(last.oilBill, 1)}`);
  }
  console.log(`\n  CONSTRUCTION BOUGHT, a month ($k): pipeline / houses / repairs: commercial, flats, owners / public works`);
  for (const s of snaps) {
    const c = s.l.con, k = (v) => (v / 1e3).toFixed(0);
    const tot = c.pipeline + c.homes + c.repairCommercial + c.repairFlats + c.repairOwners + c.publicWorks;
    const r = s.bi[IDS.indexOf("construction")];
    console.log(`  yr ${String(s.yr).padStart(2)}  ${k(c.pipeline)} / ${k(c.homes)} / ${k(c.repairCommercial)}, ${k(c.repairFlats)}, ${k(c.repairOwners)} / ${k(c.publicWorks)}  = ${k(tot)}   repairs ${pc((c.repairCommercial + c.repairFlats + c.repairOwners) / Math.max(1, tot))}  exported ${pc(r.exportShare)}  heads ${f0(r.heads)} implied ${f0(r.impliedHeads)}  margin ${pc(r.margin, 1)} (BEA ${pc(r.marginBEA, 1)})`);
  }
}

console.log(`\nSUMMARY — ${SEEDS.length} seed(s) x ${YEARS} years, yearly samples`);
console.log(`  firms' cash payroll against the register's wages, worst      ${sg(Math.max(...all.payGap), 4)}`);
console.log(`  local output multiplier, type I / type II                    ${mean(all.outI).toFixed(2)} / ${mean(all.outII).toFixed(2)}   (RIMS II metro output multipliers ~1.5-2.5)`);
console.log(`  local jobs per export job (type II)                          ${mean(all.jobsII).toFixed(2)}   (Moretti 2010: ~1.6 more per tradable job, ~2.6 in all)`);
console.log(`  construction margin, mean of years                           ${pc(mean(all.conMargin), 1)}   (BEA ${pc(E.INDUSTRIES.construction.gos, 1)})`);
const sorted = (a) => [...a].sort((x, y) => x - y);
console.log(`  ms per month added, CPU: books ${mean(all.cpuBooks).toFixed(2)} (p95 ${sorted(all.cpuBooks)[Math.floor(all.cpuBooks.length * 0.95)].toFixed(2)}), register ${mean(all.cpuReg).toFixed(2)} (p95 ${sorted(all.cpuReg)[Math.floor(all.cpuReg.length * 0.95)].toFixed(2)})`);
