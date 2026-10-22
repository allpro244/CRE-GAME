// THE HOMEBUILDER'S GAME, PLAYED (region map, Phase 3).
//
//   pnpm homebuild                 seed 2
//   BW_SEED=3 pnpm homebuild
//
// A player on the region map buys the farm whose finished lots a homebuilder
// would pay most for, rezones it, builds the streets, and then builds and
// sells houses on half the lots while a homebuilder takes down the rest.
// Every month the cash is reconciled against the books (the conserve
// identity). It checks: lots are worth something where houses pencil, the
// R-2 envelope stays low-density, houses sell at a few a month, the closings
// and the takedowns land in the ledger, and the plat's P&L adds up.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity, REGION, platTractLots } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

const seed = Number(process.env.BW_SEED ?? 2);
const HORIZON = Number(process.env.HZ ?? 72);
const city = makeCity(REGION, seed);
const parcels = city.parcels, bbls = Object.keys(parcels);
E.normalizeParcels(parcels);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const K = (n) => `$${Math.round(n / 1000).toLocaleString()}k`;
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;

const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"], OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => Object.values(g.holdings ?? {}).reduce((a, h) => a + (h.tenants ?? []).reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
const snap = (g) => ({ cash: g.cash + (g.fund?.cash ?? 0), books: books(g), loc: g.loc?.balance ?? 0, dep: deposits(g) });
let prev, worst = 0;
const check = (g, what) => {
  const now = snap(g);
  if (prev) {
    const resid = (now.cash - prev.cash) - (now.books - prev.books) - (now.loc - prev.loc) - (now.dep - prev.dep);
    if (Math.abs(resid) > 1000) fail(`${what} (month ${g.month}): $${Math.round(resid).toLocaleString()} moved without a ledger entry`);
    worst = Math.max(worst, Math.abs(resid));
  }
  prev = now;
};
const tick = (g) => { const n = E.advanceQuarter(g, parcels, bbls, city.adjacency); check(n, "month"); return n; };

let g = E.firstListings(E.newGame(seed, parcels, 25e6, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
check(g, "open");
g = tick(g);   // the homes market reads its first month
const e = g.econ;
const inc = E.medianIncome(e), rate = E.mortgageRate(e);
console.log(`seed ${seed} — ${city.name}: price level ${e.priceLevel.toFixed(2)}, cost index ${e.costIdx.toFixed(2)}, median household ${K(inc)}, mortgage ${(rate * 100).toFixed(2)}%, ${Math.round(e.population).toLocaleString()} people`);
console.log(`  the new-house buyer (${E.NEW_BUYER_MULT.toFixed(2)}x median, ${K(inc * E.NEW_BUYER_MULT)}) carries ${K(E.qualifyingPrice(inc * E.NEW_BUYER_MULT, rate))}: $${e.homes.fund.toFixed(0)}/sf on the ${E.REF_HOME.sf.toLocaleString()}-sf house; vertical $${(E.VERTICAL_PSF * e.costIdx).toFixed(0)}/sf`);

// every farm, priced as a subdivision before anyone buys it
const farms = bbls.filter((b) => parcels[b].ag && parcels[b].tract).sort((a, b) => parcels[a].tract.edgeM - parcels[b].tract.edgeM);
const reads = farms.map((b) => {
  const lots = platTractLots(parcels[b].tract, 7500).lots.length;
  const q = E.tractLotQuote(g, parcels, b, 7500, lots);
  return { b, edgeM: parcels[b].tract.edgeM, lots, ...q };
});
for (const [lo, hi] of [[0, 1], [1, 1000], [1000, 2000], [2000, 3000], [3000, 9e9]]) {
  const r = reads.filter((x) => x.edgeM >= lo && x.edgeM < hi);
  if (!r.length) continue;
  const med = (f) => { const v = r.map(f).sort((a, b) => a - b); return v[v.length >> 1]; };
  console.log(`  farms ${lo}-${hi === 9e9 ? "" : hi} m out (${r.length}): house ${K(med((x) => x.quote.price))}, lot residual ${K(med((x) => x.quote.residual))}, location x${med((x) => x.loc).toFixed(3)} (commute x${med((x) => x.commute).toFixed(3)}), pace ${med((x) => x.pace).toFixed(1)}/mo, lot after sell-out ${K(med((x) => x.lotValue))}`);
}
const pick = reads.filter((r) => r.lots >= 12 && r.lots <= 80).sort((a, b) => b.lotValue * b.lots - a.lotValue * a.lots)[0] ?? reads[0];
console.log(`  pick ${parcels[pick.b].address}: ${pick.lots} lots, ${pick.edgeM} m out; a lot ${K(pick.quote.residual)} at the residual, ${K(pick.lotValue)} after the sell-out at ${pick.pace.toFixed(1)}/mo`);

// buy, rezone (retrying the board), plat
let tract = null;
for (const r of [pick, ...reads.filter((x) => x !== pick && x.lots >= 12 && x.lots <= 80 && x.quote.residual > 0).slice(0, 5)]) {
  const b = r.b;
  const price = Math.round(E.landValue(E.resolveRec(parcels, g, b), g.econ));
  const p = E.executePurchase(g, parcels, b, price, "cash", false);
  if (p.err) { console.log(`  could not buy ${parcels[b].address}: ${p.err}`); continue; }
  g = p.s; check(g, "purchase");
  const f = E.fileEntitlement(g, parcels, b, 7500, r.lots);
  if (f.err) { console.log(`  ${f.err}`); continue; }
  g = f.s; check(g, "file");
  while (g.entitlementApps?.[b]) g = tick(g);
  if (g.rezoned?.[b]) { tract = b; console.log(`  bought ${parcels[b].address} for ${K(price)}; rezoned R-2 in month ${g.month}`); break; }
  console.log(`  ${parcels[b].address}: refused`);
}
if (!tract) { fail("no rezoning approved"); process.exit(1); }
const lots = platTractLots(parcels[tract].tract, g.rezoned[tract].lotSf).lots.map(({ a, f, d }) => ({ a, f, d }));
const sp = E.startPlat(g, parcels, tract, lots);
if (sp.err) { fail(`plat: ${sp.err}`); process.exit(1); }
g = sp.s; check(g, "plat");
while (!g.plats[tract].done) g = tick(g);
g = tick(g);
const mine = E.platLots(g, parcels, tract);
const basis0 = mine.reduce((a, b) => a + (g.holdings[b]?.costBasis ?? 0), 0);
const v0 = E.platHomesView(g, parcels, tract);
{
  const r = E.resolveRec(parcels, g, mine[0]);
  const lr = E.landRead(r, g.econ);
  const val = mine.reduce((a, b) => a + E.landValue(E.resolveRec(parcels, g, b), g.econ), 0);
  console.log(`  streets in, month ${g.month}: ${mine.length} lots, basis ${M(basis0)} (${K(basis0 / mine.length)} a lot), marked ${M(val)} (${K(val / mine.length)} a lot: the residual ${K(v0.quote.residual)} x sell-out ${v0.disc.toFixed(2)})`);
  console.log(`  lot read $/sf: homes ${(lr.homes ?? 0).toFixed(2)} builder ${lr.builder.toFixed(2)} texture ${lr.texture.toFixed(2)} -> ${lr.winner}`);
  if (v0.quote.residual > 0 && !(lr.homes > 0)) fail("a lot where the house pencils has no homebuilder bid");
  if (v0.quote.residual > 0 && lr.winner !== "homes") fail(`lot priced by ${lr.winner}, not the homebuilder`);
  // the R-2 envelope is the board's FAR, not the town's floor of 2
  const far = E.farMaxFor(r);
  console.log(`  envelope: ${r.zoneDist} FAR ${far}`);
  if (far > 0.61) fail(`R-2 lot carries FAR ${far}`);
}
const q = v0.quote;
console.log(`  the house: ${q.sf.toLocaleString()} sf at ${K(q.price)}; vertical ${K(q.vertical)}, overhead ${K(q.overhead)}, selling ${K(q.selling)}, carry ${K(q.carry)}, margin ${K(q.margin)} -> lot ${K(q.residual)} (${(q.residual / q.price * 100).toFixed(1)}% of price; NAHB 13.7%)`);

// build on half, let the builders take the rest
const half = Math.floor(mine.length / 2);
let built = 0;
for (const n of [half, 10, 4]) {
  const r = E.startHomes(g, parcels, tract, n);
  if (!r.err) { g = r.s; built = n; break; }
  console.log(`  ${n} houses: ${r.err}`);
}
check(g, "start");
console.log(`  started ${built} spec houses`);
if (!built) fail("could not start a house");

let offerSeen = false, months = 0;
const closedAt = [];
while (months < HORIZON) {
  g = tick(g); months++;
  if (g.gameOver) { fail(`game over in month ${g.month}`); break; }
  const o = g.homes?.offers?.[tract];
  if (o && !g.homes.contracts?.[tract]) {
    offerSeen = true;
    const r = E.acceptLotOffer(g, parcels, tract);
    if (!r.err) { g = r.s; console.log(`  month ${g.month}: ${o.builder} takes down ${o.lots} lots at $${o.psf.toFixed(2)}/sf (accepted)`); }
  }
  const v = E.platHomesView(g, parcels, tract);
  closedAt.push(v.closed);
  // keep building your share as your houses sell
  if (v.forSale < 2 && v.mine > (g.homes?.contracts?.[tract]?.left ?? 0) + 0 && v.quote.residual > 0) {
    const r = E.startHomes(g, parcels, tract, 3); if (!r.err) { g = r.s; check(g, "start"); }
  }
  const left = E.platLots(g, parcels, tract).filter((b) => g.holdings[b]).length;
  if (!left) break;
}
const v = E.platHomesView(g, parcels, tract);
const pl = v.pl;
console.log(`  after ${months} months: you closed ${pl.closed} houses (${(pl.closed / months).toFixed(2)}/mo), revenue ${M(pl.revenue)}; sold ${pl.lotsSold} lots to builders for ${M(pl.lotProceeds)}`);
for (const b of v.builders) console.log(`    ${b.name}: ${b.closed} closed, ${b.building} building`);
const units = Object.values(g.homes.units).filter((u) => u.parent === tract);
const closedAll = units.filter((u) => u.closedM !== undefined).length;
console.log(`  the plat: ${closedAll} houses closed in ${months} months = ${(closedAll / months).toFixed(2)} a month across every builder`);
if (!(pl.closed > 0)) fail("you sold no houses");
const profit = pl.net - pl.cost - pl.lotCost;
console.log(`  your houses: ${pl.closed} sold, gross ${M(pl.revenue)}, net of selling ${M(pl.net)}, frames ${M(pl.cost)}, lots ${M(pl.lotCost)} -> ${M(profit)} before tax (${(profit / Math.max(1, pl.revenue) * 100).toFixed(1)}% of revenue)`);
console.log(`  your lots to builders: ${pl.lotsSold} for ${M(pl.lotProceeds)} net against basis ${M(pl.lotBasis)} -> ${M(pl.lotProceeds - pl.lotBasis)}`);
if (!offerSeen && v.quote.residual > 0) console.log("  (no builder offered in the window)");
const exits = (g.exits ?? []).filter((x) => mine.includes(x.bbl)).length;
console.log(`  exits on the plat: ${exits}; ledger: worst unexplained month $${Math.round(worst).toLocaleString()}`);
if (exits !== pl.closed + pl.lotsSold) fail(`${exits} exits for ${pl.closed} closings and ${pl.lotsSold} takedowns`);
// a sold house is a family's: off the market
const fam = units.find((u) => u.closedM !== undefined);
if (fam && !E.isCivicLand(g, fam.bbl)) fail("a sold house is still on the land market");
if (fam && g.holdings[fam.bbl]) fail("a sold house is still in your book");
// a reload regenerates the lots
{
  const fresh = makeCity(REGION, seed).parcels, fb = Object.keys(fresh);
  E.normalizeParcels(fresh);
  E.materializePlats(JSON.parse(JSON.stringify(g)), fresh, fb);
  if (!mine.every((b) => fresh[b] && fresh[b].lotArea === parcels[b].lotArea)) fail("the lots did not regenerate after a reload");
}
console.log(fails ? `\n${fails} failure(s)` : "\nhomebuild: all checks pass");
process.exit(fails ? 1 : 0);
