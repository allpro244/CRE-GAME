// THE TAX ROLL AGAINST THE MARKET, a year at a time.
//   node tools/probes/assessprobe.mjs ROOT SEED YEARS
// Each January (after the assessor's round): the town's assessed roll over the
// market roll the same month (citygov marketRoll), the property tax the city
// levies over that market roll (the effective rate on market value), the
// player's deeds' assessed over their appraisal, and the market roll's year-
// on-year change, so a boom and a bust can be read against the lag.
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 40);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels, undefined, { inherit: 4 }), city.parcels, bbls);
let prev = 0;
const rows = [];
console.log("yr  mkt$M   yoy%   roll/mkt  effRate%  propRate%  deeds:assessed/value  deedTax/value% (n)");
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (g.month % 12 !== 0) continue;
  const e = g.econ, gov = e.gov;
  if (!gov) continue;
  const r = E.marketRoll(e), mkt = r.commercial + r.homes;
  const ratio = gov.assessed / mkt;
  const eff = gov.assessed * gov.policy.propRate / mkt;
  let a = 0, v = 0, t = 0, n = 0;
  for (const h of Object.values(g.holdings)) {
    const val = E.ownedHoldingValue(g, city.parcels, h);
    if (!(val > 0) || !(h.assessed > 0)) continue;
    const rec = E.resolveRec(city.parcels, g, h.bbl);
    a += h.assessed; v += val; t += rec ? E.grossTaxYr(rec, h, e) : 0; n++;
  }
  const yoy = prev ? (mkt / prev - 1) * 100 : 0; prev = mkt;
  rows.push({ ratio, eff });
  console.log(`${String(g.month / 12).padStart(2)} ${(mkt / 1e6).toFixed(0).padStart(7)} ${yoy.toFixed(1).padStart(6)} ${ratio.toFixed(3).padStart(9)} ${(eff * 100).toFixed(3).padStart(9)} ${(gov.policy.propRate * 100).toFixed(3).padStart(10)}   ${n ? (a / v).toFixed(3) : "  -  "}  ${n ? (t / v * 100).toFixed(3) : "  -  "} (${n})`);
}
const avg = (k) => rows.reduce((s, x) => s + x[k], 0) / rows.length;
const sd = (k) => { const mu = avg(k); return Math.sqrt(rows.reduce((s, x) => s + (x[k] - mu) ** 2, 0) / rows.length); };
console.log(`mean roll/mkt ${avg("ratio").toFixed(3)} (sd ${sd("ratio").toFixed(3)}, min ${Math.min(...rows.map((x) => x.ratio)).toFixed(3)}, max ${Math.max(...rows.map((x) => x.ratio)).toFixed(3)}) · mean effective rate ${(avg("eff") * 100).toFixed(3)}%`);
