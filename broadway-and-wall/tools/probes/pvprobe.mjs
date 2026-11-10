// The player's own buildings: the appraisal (ownedHoldingValueFromRec) against the street's bidders, piece by piece
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), AT = Number(process.argv[4] ?? 8);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const P = city.parcels, bbls = Object.keys(P);
let g = E.firstListings(E.newGame(SEED, P, 400_000_000), P, bbls);
const med = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
for (let m = 1; m <= AT * 12; m++) { g = E.advanceQuarter(g, P, bbls, city.adjacency); if (g.gameOver) g = { ...g, gameOver: null, cash: 4e8 }; }
let bought = 0;
for (const li of [...g.listings]) {
  if (bought >= 12) break;
  const r = E.resolveRec(P, g, li.bbl); if (!r || r.class === "land" || !(r.bldgArea > 0) || li.distress) continue;
  const b = E.buyListing(g, P, li.bbl, "cash"); if (b.err) continue; g = b.s; bought++;
}
for (let i = 0; i < 6; i++) g = E.advanceMonth(g, P, bbls, city.adjacency);
const s = g, e = s.econ, rivals = (s.rivals ?? []).filter((r) => r.failedM === undefined);
const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "—";
console.log(`seed ${SEED} year ${AT}: ${Object.keys(s.holdings).length} held`);
for (const [bbl, h] of Object.entries(s.holdings)) {
  const rec = E.resolveRec(P, s, bbl); if (!rec || rec.class === "land") continue;
  const A = E.ownedHoldingValueFromRec(s, rec, h);
  const v = E.dealView(s, rec, bbl, A, h.condition, h.condIdx); if (!v) continue;
  const Vs = rivals.map((r) => E.valueTo(e, v, E.bidderOf(s, r, rec)).V);
  const contract = E.holdingNOIYr(rec, e, h, Number.POSITIVE_INFINITY);
  const cap = E.capRateFor(rec, e, h.condition, h.condIdx), qs = E.rollQualitySpread(rec, h, s.month, e);
  const classA = E.assetValue(rec, e, h.condition, h.condIdx);
  console.log(`${rec.class.padEnd(11)} A ${(A / 1e6).toFixed(2)}M classModel/A ${f(classA / A)} | top bid/A ${f(Math.max(...Vs) / A)} median ${f(med(Vs) / A)} | appraiser: contractNOI/A ${f(100 * contract / A)} cap ${f(cap)} + rollQ ${f(qs)} · bidder: inPlace(noiPre-tau·A)/A ${f(100 * (v.noiPre - v.tau * A) / A)} stab/A ${f(100 * v.stabPre / A)} relet ${f(100 * v.leaseCap / A)} tau ${f(100 * v.tau)} cx ${f(100 * v.cx)} catchUp/A ${f(100 * v.catchUp / A)} occ ${f(100*(h.tenants?.reduce((a,t)=>a+(t.sf||0),0)||0)/Math.max(1,rec.bldgArea),0)}%`);
}
