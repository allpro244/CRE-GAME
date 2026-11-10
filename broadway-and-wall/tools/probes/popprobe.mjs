// Yearly: population, households, jobs, unemployment, flats vacancy, real wage — the town's people side
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 20);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const row = (y) => { const e = g.econ; return `y${y} pop ${Math.round(e.population)} jobs ${Math.round(e.jobs)} u ${(100 * (e.unemployment ?? 0)).toFixed(1)}% flats vac ${(100 * (e.cityVac?.multifamily ?? 0)).toFixed(1)}% flat rent ${(e.effRentIdx?.multifamily ?? e.rentIdx?.multifamily ?? 0).toFixed(2)} cpi ${(e.cpi ?? 1).toFixed(2)}`; };
console.log(row(0));
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (m === 1 || m % 60 === 0) console.log(row(m / 12));
}
