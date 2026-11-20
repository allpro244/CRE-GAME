// non-distressed tape and holder listings: how many sellers carry a loss anchor, and how big; and what the old market-wide anchor would have said
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 40);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
let acc = { n: 0, anch: 0, mark: [], old: [], oldN: 0 };
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const s = g, e = s.econ, h = e.history ?? [];
  for (const li of s.listings ?? []) {
    if (li.listedM !== s.month || li.distress) continue;
    const rec = E.resolveRec(city.parcels, s, li.bbl);
    if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) continue;
    const b = E.sellerBasis ? E.sellerBasis(s, li.bbl) : undefined;
    const A = E.marketAppraisal(s, rec, li.bbl);
    acc.n++;
    if (b !== undefined && b > A) { acc.anch++; acc.mark.push(0.15 * (b - A) / A); }
    const then = h.length >= 13 ? h[h.length - 13]?.cap?.[rec.class] : undefined, now = e.capRate?.[rec.class];
    const o = then && now ? Math.max(1, now / then) - 1 : 0; acc.old.push(o); if (o > 0) acc.oldN++;
  }
  if (m % 60 === 0) {
    const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    console.log(`years ${m / 12 - 4}-${m / 12}: ${acc.n} listings · own-basis loss anchor on ${acc.anch} (${(100 * acc.anch / Math.max(1, acc.n)).toFixed(0)}%), mean markup when anchored ${(100 * mean(acc.mark)).toFixed(1)}%, over all ${(100 * mean(acc.mark) * acc.anch / Math.max(1, acc.n)).toFixed(2)}% · old market anchor on ${(100 * acc.oldN / Math.max(1, acc.n)).toFixed(0)}%, mean over all ${(100 * mean(acc.old)).toFixed(2)}%`);
    acc = { n: 0, anch: 0, mark: [], old: [], oldN: 0 };
  }
}
