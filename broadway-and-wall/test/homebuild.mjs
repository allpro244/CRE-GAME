// THE LAND DEVELOPER SELLS TO THE HOMEBUILDERS (region map, Phase 3).
//
//   pnpm homebuild                 seed 2
//   BW_SEED=3 pnpm homebuild
//
// The player is the land developer: buy the farm whose finished lots a
// homebuilder would pay most for, rezone it, build the streets, then sell the
// lots — half on a builder's takedown, the rest listed whole — while the
// builders build and sell the houses. Every month the cash is reconciled
// against the books (the conserve identity). It checks:
//   - an R-2 lot hosts no commercial scheme and is worth the homebuilder's bid,
//     and every reading of its value (land, appraisal, holding) is that number;
//   - platting moves net worth by the honest lot value less the cash spent
//     (the regression for the $5.8M phantom gain flats-on-R-2 once booked);
//   - a refused rezoning waits a year before it can be filed again;
//   - builders buy the lots, build and sell the houses at a few a month, and
//     the lot sales land in the ledger.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity, REGION, platTractLots } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const seed = Number(process.env.BW_SEED ?? 2);
const HORIZON = Number(process.env.HZ ?? 72);
const city = makeCity(REGION, seed);
const parcels = city.parcels, bbls = Object.keys(parcels);
E.normalizeParcels(parcels);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const K = (n) => `$${Math.round(n / 1000).toLocaleString()}k`;
const mLabel = (m) => `m${m}`;
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
g = tick(g);
const e = g.econ;
const inc = E.medianIncome(e), rate = E.mortgageRate(e);
console.log(`seed ${seed} — ${city.name}: price level ${e.priceLevel.toFixed(2)}, cost index ${e.costIdx.toFixed(2)}, median household ${K(inc)}, mortgage ${(rate * 100).toFixed(2)}%, ${Math.round(e.population).toLocaleString()} people`);
console.log(`  the new-house buyer (${E.NEW_BUYER_MULT.toFixed(2)}x median) carries ${K(E.qualifyingPrice(inc * E.NEW_BUYER_MULT, rate))}: $${e.homes.fund.toFixed(0)}/sf on the ${E.REF_HOME.sf.toLocaleString()}-sf house; vertical $${(E.VERTICAL_PSF * e.costIdx).toFixed(0)}/sf`);

const farms = bbls.filter((b) => parcels[b].ag && parcels[b].tract).sort((a, b) => parcels[a].tract.edgeM - parcels[b].tract.edgeM);
const reads = farms.map((b) => {
  const lots = platTractLots(parcels[b].tract, 7500).lots.length;
  return { b, edgeM: parcels[b].tract.edgeM, lots, ...E.tractLotQuote(g, parcels, b, 7500, lots) };
});
for (const [lo, hi] of [[0, 1000], [1000, 2000], [2000, 3000], [3000, 9e9]]) {
  const r = reads.filter((x) => x.edgeM >= lo && x.edgeM < hi);
  if (!r.length) continue;
  const med = (f) => { const v = r.map(f).sort((a, b) => a - b); return v[v.length >> 1]; };
  console.log(`  farms ${lo}-${hi === 9e9 ? "" : hi} m out (${r.length}): house ${K(med((x) => x.quote.price))}, lot residual ${K(med((x) => x.quote.residual))}, location x${med((x) => x.loc).toFixed(3)}, pace ${med((x) => x.pace).toFixed(1)}/mo, lot after sell-out ${K(med((x) => x.lotValue))}`);
}
const pick = reads.filter((r) => r.lots >= 12 && r.lots <= 80).sort((a, b) => b.lotValue * b.lots - a.lotValue * a.lots)[0] ?? reads[0];

// buy, rezone (a refusal waits a year), plat
const nw0 = E.netWorth(g, parcels), cash0 = g.cash;
let tract = null, refusalChecked = false;
for (const r of [pick, ...reads.filter((x) => x !== pick && x.lots >= 12 && x.lots <= 80 && x.quote.residual > 0).slice(0, 6)]) {
  const b = r.b;
  const price = Math.round(E.landValue(E.resolveRec(parcels, g, b), g.econ));
  const p = E.executePurchase(g, parcels, b, price, "cash", false);
  if (p.err) { console.log(`  could not buy ${parcels[b].address}: ${p.err}`); continue; }
  g = p.s; check(g, "purchase");
  const f = E.fileEntitlement(g, parcels, b, 7500, r.lots);
  if (f.err) { console.log(`  ${f.err}`); continue; }
  g = f.s; check(g, "file");
  while (g.entitlementApps?.[b]) g = tick(g);
  if (g.rezoned?.[b]) { tract = b; console.log(`  bought ${parcels[b].address} (${r.lots} lots, ${r.edgeM} m out) for ${K(price)}; rezoned R-2 in month ${g.month}`); break; }
  console.log(`  ${parcels[b].address}: refused`);
  if (!refusalChecked) {
    refusalChecked = true;
    const again = E.fileEntitlement(g, parcels, b, 7500, r.lots);
    if (!again.err) fail("a refused rezoning was refiled the next month");
    else console.log(`  refile at once: "${again.err}"`);
  }
}
if (!tract) { fail("no rezoning approved"); process.exit(1); }
const lots = platTractLots(parcels[tract].tract, g.rezoned[tract].lotSf).lots.map(({ a, f, d }) => ({ a, f, d }));
const sp = E.startPlat(g, parcels, tract, lots);
if (sp.err) { fail(`plat: ${sp.err}`); process.exit(1); }
g = sp.s; check(g, "plat");
while (!g.plats[tract].done) g = tick(g);
g = tick(g);
const mine = E.platLots(g, parcels, tract);
const v0 = E.platHomesView(g, parcels, tract);
{
  const r = E.resolveRec(parcels, g, mine[0]);
  const lr = E.landRead(r, g.econ);
  console.log(`  streets in, month ${g.month}: ${mine.length} lots; lot read $/sf homes ${(lr.homes ?? 0).toFixed(2)} builder ${lr.builder.toFixed(2)} holder ${lr.holder.toFixed(2)} texture ${lr.texture.toFixed(2)} -> ${lr.winner}; scheme ${lr.scheme ? lr.scheme.use : "none"}`);
  if (lr.scheme || lr.builder > 0) fail(`an R-2 lot carries a ${lr.scheme?.use} scheme`);
  if (E.zoneUseBar(r, "multifamily", g.econ) === null) fail("R-2 permits flats");
  if (v0.quote.residual > 0 && lr.winner !== "homes") fail(`lot priced by ${lr.winner}, not the homebuilder`);
  const far = E.farMaxFor(r);
  if (far > 0.61) fail(`R-2 lot carries FAR ${far}`);
  // one number: land, appraisal, holding value, the book
  const lv = E.landValue(r, g.econ), ap = E.marketAppraisal(g, r, mine[0]), hv = E.ownedHoldingValueFromRec(g, r, g.holdings[mine[0]]);
  console.log(`  lot 1: land ${K(lv)} · appraisal ${K(ap)} · holding ${K(hv)} · bid ${K((lr.homes ?? 0) * r.lotArea)}`);
  for (const [k, x] of [["appraisal", ap], ["holding value", hv]]) if (Math.abs(x - lv) > 0.01 * Math.max(1, lv)) fail(`${k} ${K(x)} against land value ${K(lv)}`);
  // islands keep their zoning-free Houston rule
  if (E.zoneUseBar({ zoneDist: "R6" }, "office", g.econ) !== null) fail("an island district started barring uses");
}
// THE REGRESSION: net worth moved by what the lots are honestly worth, less the cash spent
{
  const honest = mine.reduce((t, b) => { const r = E.resolveRec(parcels, g, b); return t + Math.max((E.landRead(r, g.econ).homes ?? 0), E.landRead(r, g.econ).texture) * r.lotArea; }, 0);
  const nw1 = E.netWorth(g, parcels), spent = cash0 - g.cash;
  // anything else still on the book (a farm the board refused), at its own mark
  const other = Object.values(g.holdings).filter((h) => !mine.includes(h.bbl)).reduce((t, h) => t + E.ownedHoldingValueFromRec(g, E.resolveRec(parcels, g, h.bbl), h), 0);
  const want = honest + other - spent, got = nw1 - nw0;
  console.log(`  net worth ${M(nw0)} -> ${M(nw1)} (${M(got)}); cash spent ${M(spent)} (net of interest earned), lots honestly ${M(honest)}, other land ${M(other)} -> expected ${M(want)}`);
  if (Math.abs(got - want) > 0.05 * Math.max(honest, spent)) fail(`net worth moved ${M(got)}, the lots and the cash say ${M(want)}`);
}
const q = v0.quote;
console.log(`  the house: ${q.sf.toLocaleString()} sf at ${K(q.price)}; vertical ${K(q.vertical)}, overhead ${K(q.overhead)}, selling ${K(q.selling)}, carry ${K(q.carry)}, margin ${K(q.margin)} -> lot ${K(q.residual)} (${(q.residual / q.price * 100).toFixed(1)}% of price; NAHB 13.7%)`);
console.log(`  bids: takedown $${v0.bids.takedownPsf.toFixed(2)}/sf at ~${v0.bids.pace.toFixed(1)}/mo (${Math.ceil(v0.bids.months)} months for ${v0.free}); whole plat $${v0.bids.bulkPsf.toFixed(2)}/sf`);
{
  // THE PACE, decomposed: households, growth, affordability
  const hh = e.population / E.HH_SIZE, g12 = g.econ.homesG12 ?? E.HH_GROWTH_NAT;
  const aff = E.affordShare(q.price / v0.loc, E.mortgageRate(g.econ), E.medianIncome(g.econ)) / E.AFFORD_REF;
  console.log(`  pace = ${Math.round(hh).toLocaleString()} households x ${(E.NEW_HOME_RATE * 100).toFixed(2)}%/yr / 12 x growth ${(0.4 + 0.6 * Math.max(0, Math.min(4, g12 / E.HH_GROWTH_NAT))).toFixed(2)} (pop ${(g12 * 100).toFixed(2)}%/yr) x afford ${aff.toFixed(2)} = ${v0.bids.pace.toFixed(1)}/mo`);
}

// sell: takedown to the first builder who offers; list the rest whole at the bid
let months = 0, listed = false;
while (months < HORIZON) {
  g = tick(g); months++;
  if (g.gameOver) { fail(`game over in month ${g.month}`); break; }
  const o = g.homes?.offers?.[tract];
  if (o) {
    const r = E.acceptLotOffer(g, parcels, tract);
    if (!r.err) { g = r.s; check(g, "sign"); console.log(`  month ${g.month}: signed ${o.builder}, ${o.kind} of ${o.lots} at $${o.psf.toFixed(2)}/sf`); }
  }
  const v = E.platHomesView(g, parcels, tract);
  if (!listed && v.contract && v.free > v.contract.left) {
    const r = E.listLotsToBuilders(g, parcels, tract, v.bids.bulkPsf * 0.98, true);
    if (!r.err) { g = r.s; listed = true; console.log(`  month ${g.month}: listed the rest whole at $${(v.bids.bulkPsf * 0.98).toFixed(2)}/sf`); }
  }
  const units = Object.values(g.homes.units).filter((u) => u.parent === tract);
  if (!mine.some((b) => g.holdings[b]) && units.every((u) => u.closedM !== undefined) && !Object.values(g.homes.held ?? {}).length) break;
}
const v = E.platHomesView(g, parcels, tract);
const pl = v.pl ?? { lotsSold: 0, lotRevenue: 0, lotProceeds: 0, lotBasis: 0 };
console.log(`  after ${months} months: you sold ${pl.lotsSold} of ${mine.length} lots for ${M(pl.lotRevenue)} (${M(pl.lotProceeds)} net) against basis ${M(pl.lotBasis)} -> ${M(pl.lotProceeds - pl.lotBasis)} before tax`);
for (const b of v.builders) {
  const bk = g.homes.builders[b.name];
  console.log(`    ${b.name}: ${b.closed} sold, ${b.building} building, ${b.held} held; revenue ${M(bk.revenue)}, cost ${M(bk.cost)} (houses and lots of those sold) -> ${((bk.revenue - bk.cost) / Math.max(1, bk.revenue) * 100).toFixed(1)}% before selling costs`);
}
const units = Object.values(g.homes.units).filter((u) => u.parent === tract);
const closed = units.filter((u) => u.closedM !== undefined).map((u) => u.closedM).sort((a, b) => a - b);
if (closed.length) console.log(`  houses: ${closed.length} closed between ${mLabel(closed[0])} and ${mLabel(closed[closed.length - 1])} = ${(closed.length / Math.max(1, closed[closed.length - 1] - closed[0] + 1)).toFixed(2)} a month`);
if (!(pl.lotsSold > 0)) fail("no lot sold");
if (!closed.length) fail("no builder sold a house");
const exits = (g.exits ?? []).filter((x) => mine.includes(x.bbl)).length;
console.log(`  exits on the plat: ${exits}; ledger: worst unexplained month $${Math.round(worst).toLocaleString()}`);
if (exits !== pl.lotsSold) fail(`${exits} exits for ${pl.lotsSold} lots sold`);
const fam = units.find((u) => u.closedM !== undefined);
if (fam && !E.isCivicLand(g, fam.bbl)) fail("a sold house is still on the land market");
{
  const fresh = makeCity(REGION, seed).parcels, fb = Object.keys(fresh);
  E.normalizeParcels(fresh);
  E.materializePlats(JSON.parse(JSON.stringify(g)), fresh, fb);
  if (!mine.every((b) => fresh[b] && fresh[b].lotArea === parcels[b].lotArea)) fail("the lots did not regenerate after a reload");
}
console.log(fails ? `\n${fails} failure(s)` : "\nhomebuild: all checks pass");
process.exit(fails ? 1 : 0);
