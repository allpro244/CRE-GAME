import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 30);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const c = [], l = [];
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const e = g.econ; c.push(E.constructionRatePct(e) - e.indexRate); l.push(E.constructionRatePct(e, undefined, 0, "land") - e.indexRate);
}
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))].toFixed(2); };
console.log(`construction spread over index: p10 ${q(c,.1)} p50 ${q(c,.5)} p90 ${q(c,.9)} max ${q(c,1)} | land: p10 ${q(l,.1)} p50 ${q(l,.5)} p90 ${q(l,.9)} max ${q(l,1)}  (was flat 2.4; takeovers 3.2)`);
