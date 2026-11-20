// street tenants going dark (closures, not leaving town) as a share of the street's let feet a year, by class
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 15);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const K = ["office", "retail", "industrial"]; let dark = {}, left = {}, let_ = {}, n = 0; const tot = { dark: {}, let: {} };
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const e = g.econ;
  for (const f of e.streetFailed ?? []) if (f.m === g.month) { const o = f.why === "left" ? left : dark; o[f.use] = (o[f.use] ?? 0) + (f.sf ?? 0); }
  for (const k of K) let_[k] = (let_[k] ?? 0) + (e.streetSpace?.[k]?.let ?? 0);
  n++;
  if (m % 60 === 0) {
    console.log(`years ${m / 12 - 4}-${m / 12}: ` + K.map((k) => `${k} dark ${(100 * 12 * (dark[k] ?? 0) / Math.max(1, let_[k])).toFixed(1)}%/yr left ${(100 * 12 * (left[k] ?? 0) / Math.max(1, let_[k])).toFixed(1)}%`).join(" · "));
    for (const k of K) { tot.dark[k] = (tot.dark[k] ?? 0) + (dark[k] ?? 0); tot.let[k] = (tot.let[k] ?? 0) + let_[k]; }
    dark = {}; left = {}; let_ = {};
  }
}
console.log("ALL: " + K.map((k) => `${k} dark ${(100 * 12 * tot.dark[k] / Math.max(1, tot.let[k])).toFixed(1)}%/yr`).join(" · "));
