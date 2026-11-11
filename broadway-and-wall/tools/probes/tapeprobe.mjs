// the tape's flow: new listings a year (all / distressed / lender sales), trades a year, standing listings — ROOT SEED YEARS; ENGINE= overrides test/.engine.mjs
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 30);
const E = await import(pathToFileURL(process.env.ENGINE ?? join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const seen = new Set(); const y = { n: 0, d: 0, rcv: 0, trades: 0, stand: 0 }; const all = { n: 0, d: 0, rcv: 0, trades: 0, stand: 0 };
const t0 = Date.now();
console.log(`lots ${bbls.length}`);
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  for (const l of g.listings) {
    const k = l.bbl + ":" + l.listedM; if (seen.has(k)) continue; seen.add(k);
    y.n++; if (l.distress) y.d++; if (l.reason === "receiver" || l.receiverFor) y.rcv++;
  }
  for (const b in g.lastTradeM ?? {}) if (g.lastTradeM[b] === g.month) y.trades++;
  y.stand += g.listings.length / 12;
  if (m % 12 === 0) {
    console.log(`yr ${m / 12}: listed ${y.n} (distressed ${y.d}, lender ${y.rcv}) trades ${y.trades} standing ${y.stand.toFixed(1)} phase ${g.econ.phase ?? ""} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const k in y) { all[k] += y[k]; y[k] = 0; }
  }
}
console.log(`ALL/yr: listed ${(all.n / YEARS).toFixed(1)} distressed ${(all.d / YEARS).toFixed(1)} (${(100 * all.d / Math.max(1, all.n)).toFixed(0)}%) lender ${(all.rcv / YEARS).toFixed(1)} trades ${(all.trades / YEARS).toFixed(1)} standing ${(all.stand / YEARS).toFixed(1)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
