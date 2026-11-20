// THE REGISTER'S PEOPLE OVER DECADES (households stages 4-5).
//
//   node tools/households-life.mjs                 1 seed x 40 years
//   SEEDS=550991,12007 YEARS=50 node tools/households-life.mjs
//
// Does the age pyramid hold its shape without being forced: every ten years
// the register's people by age band against the US (Census 2023 population
// estimates), the year's births, deaths, unions and splits per 1,000 people
// against the CDC's, households living alone, adults a household, ownership
// overall and by the householder's age against Census HVS, evictions a year
// per renter household against Eviction Lab, and the households' spending by
// category against the BLS Consumer Expenditure Survey's all-units shares.
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, "..", "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const SEEDS = (process.env.SEEDS ?? "550991").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 40);
const pc = (x, d = 1) => Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "—";
// (US resident population by age, July 2023, Census Vintage 2023: 0-17 21.7%, 18-34 22.6%, 35-64 38.3%, 65+ 17.7%)
// Census HVS 2023 ownership by householder's age
const US_OWN = [0.26, 0.39, 0.62, 0.70, 0.75, 0.79];

for (const seed of SEEDS) {
  const city = makeCity("somewhere", 1);
  E.normalizeParcels(city.parcels);
  const bbls = Object.keys(city.parcels);
  let g = E.firstListings(E.newGame(seed, city.parcels), city.parcels, bbls);
  console.log(`\nseed ${seed} — ${YEARS} years`);
  console.log("  yr  persons  | 0-17   18-34  35-64  65+   (US 21.7 22.6 38.3 17.7) | births deaths unions splits /1000 (US 10.7 9.2) | alone  adults/hh | own   <25  25-34 35-44 45-54 55-64 65+ | evict/yr (island, jobless share) | spend: groc goods eat serv health edu");
  const yr = { births: 0, deaths: 0, unions: 0, splits: 0, evict: 0, evIsl: 0, evJob: 0, rentHh: 0, islHh: 0, months: 0, cat: null };
  for (let m = 1; m <= YEARS * 12; m++) {
    g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const r = g.households, f = r.flow, a = r.a;
    yr.births += f.births ?? 0; yr.deaths += f.deaths ?? 0; yr.unions += f.unions ?? 0; yr.splits += f.splits ?? 0;
    yr.evict += f.evictions; yr.evIsl += f.evictIsland ?? 0; yr.evJob += f.evictJobless ?? 0;
    let rent = 0, isl = 0;
    for (let i = 0; i < r.n; i++) { if (a.ten[i] === 0 || a.ten[i] === 3) rent += a.wt[i]; if (a.ten[i] === 0) isl += a.wt[i]; }
    yr.rentHh += rent; yr.islHh += isl; yr.months++;
    if (f.spendCat) { yr.cat ??= {}; for (const [k, v] of Object.entries(f.spendCat)) yr.cat[k] = (yr.cat[k] ?? 0) + v; }
    if (m % 120 === 0 || m === 12) {
      const py = E.registerPyramid ? E.registerPyramid(g) : null;
      let persons = 0, hh = 0, alone = 0, adults = 0, own = 0;
      const ob = [0, 0, 0, 0, 0, 0], oo = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < r.n; i++) {
        const w = a.wt[i];
        hh += w; persons += w * (a.adults[i] + a.kids[i]); adults += w * a.adults[i];
        if (a.adults[i] === 1 && a.kids[i] === 0) alone += w;
        const b = E.ageBand(a.age[i]);
        ob[b] += w; if (a.ten[i] === 1) { own += w; oo[b] += w; }
      }
      const bands = py ? (() => {
        const t = py.reduce((x, y) => x + y, 0);
        const s = (lo, hi) => py.slice(lo, hi).reduce((x, y) => x + y, 0) / t;
        return [s(0, 18), s(18, 35), s(35, 65), s(65, 120)];
      })() : [NaN, NaN, NaN, NaN];
      const per = (x) => (1000 * x / persons / (yr.months / 12)).toFixed(1).padStart(5);
      const cat = yr.cat ? (() => { const t = Object.values(yr.cat).reduce((x, y) => x + y, 0); return Object.values(yr.cat).map((v) => (100 * v / t).toFixed(0).padStart(4)).join(""); })() : "  —";
      console.log(`  ${String(Math.round(m / 12)).padStart(2)}  ${Math.round(persons).toLocaleString("en-US").padStart(8)} | ${bands.map((x) => pc(x).padStart(6)).join("")} | ${per(yr.births)} ${per(yr.deaths)} ${per(yr.unions)} ${per(yr.splits)} | ${pc(alone / hh)}  ${(adults / hh).toFixed(2)} | ${pc(own / hh)} ${oo.map((x, k) => pc(x / Math.max(1, ob[k]), 0).padStart(5)).join("")} | ${pc(yr.evict / Math.max(1, yr.rentHh / yr.months) / (yr.months / 12), 2)} (${pc(yr.evIsl / Math.max(1, yr.islHh / yr.months) / (yr.months / 12), 2)}, ${pc(yr.evJob / Math.max(1e-9, yr.evict), 0)}) |${cat}`);
      const notes = (g.why?.ev ?? []).filter((x) => x.k === "households.spend" && x.m > m - 120);
      if (notes.length) console.log(`        cause ledger: ${notes.length} household spending falls written in the decade, e.g. "${notes.at(-1).t}"`);
      Object.assign(yr, { births: 0, deaths: 0, unions: 0, splits: 0, evict: 0, evIsl: 0, evJob: 0, rentHh: 0, islHh: 0, months: 0, cat: null });
    }
  }
  console.log(`  (US: ownership 65.6%, by age ${US_OWN.map((x) => (100 * x).toFixed(0)).join(" ")}; living alone 28%; ~1.95 adults a household; evictions ~2.3% of renter households a year; CE 2023 shares groc 13 goods 31 eat 8 serv 32 health 12 edu 3)`);
}
