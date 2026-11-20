// The July foreclosure auctions: for each lot, the debt against the as-is estimate, and who took it at what price.
// Asks: when the loan is worth more than the building, how often does a competitor pay the lender's number?
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 40);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const rows = [];
for (let m = 1; m <= YEARS * 12; m++) {
  const lots = (g.auction?.lots ?? []).map((l) => ({ address: l.address, kind: l.kind, debt: l.debt, est: l.est, upset: l.upset }));
  const n0 = g.news.length;
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (!lots.length) continue;
  const fresh = g.news.slice(0, Math.max(0, g.news.length - n0 + 40)).map((x) => x.text);
  for (const l of lots) {
    const sold = fresh.find((t) => t.includes(`took ${l.address} on the steps at`));
    const reo = fresh.find((t) => t.includes(l.address) && /credit bid|REO|struck to/i.test(t));
    if (!sold && !reo) continue;
    const px = sold ? Number((sold.match(/\$([\d.]+)([KM])/) ?? [0, 0, "K"]).slice(1).reduce((a, b) => a * (b === "M" ? 1e6 : 1e3))) : NaN;
    rows.push({ ...l, to: sold ? "third party" : "lender (REO)", px });
  }
}
const under = rows.filter((r) => r.debt > r.est), over = rows.filter((r) => r.debt <= r.est);
const share = (a) => a.length ? (100 * a.filter((r) => r.to === "third party").length / a.length).toFixed(0) + "%" : "—";
const med = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)].toFixed(2) : "—"; };
console.log(`lots resolved: ${rows.length}. Under water (debt > as-is estimate): ${under.length}, of which a competitor bought ${share(under)}; median price/estimate when it did ${med(under.filter((r) => r.to === "third party").map((r) => r.px / r.est))}, price/debt ${med(under.filter((r) => r.to === "third party").map((r) => r.px / r.debt))}`);
console.log(`Above water: ${over.length}, competitor bought ${share(over)}; median price/estimate ${med(over.filter((r) => r.to === "third party").map((r) => r.px / r.est))}`);
console.log(`median debt/estimate of under-water lots ${med(under.map((r) => r.debt / r.est))}`);
