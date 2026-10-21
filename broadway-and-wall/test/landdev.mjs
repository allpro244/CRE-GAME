// THE LAND DEVELOPER'S GAME, PLAYED (region map, Phase 2).
//
//   pnpm landdev                 seed 1
//   BW_SEED=3 pnpm landdev
//
// A player on the region map buys a farm at its market price, files a
// rezoning, waits for the board, builds the streets, and gets lots: then
// breaks ground on one and lists another. Every month the cash is reconciled
// against the books (the conserve identity), farms are priced at farm-use
// value, and the lots exist after a reload as they did before it.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity, REGION, platTractLots } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

const seed = Number(process.env.BW_SEED ?? 1);
const city = makeCity(REGION, seed);
const parcels = city.parcels, bbls = Object.keys(parcels);
E.normalizeParcels(parcels);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;

const IN = ["noi", "sold", "interest", "borrowed", "lpCalled"], OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => Object.values(g.holdings ?? {}).reduce((a, h) => a + (h.tenants ?? []).reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
const snap = (g) => ({ cash: g.cash + (g.fund?.cash ?? 0), books: books(g), loc: g.loc?.balance ?? 0, dep: deposits(g) });
let prev, worst = 0;
const check = (g, what) => {
  const now = snap(g);
  if (prev) {
    const resid = (now.cash - prev.cash) - (now.books - prev.books) - (now.loc - prev.loc) - (now.dep - prev.dep);
    if (Math.abs(resid) > 1000) fail(`${what}: $${Math.round(resid).toLocaleString()} moved without a ledger entry`);
    worst = Math.max(worst, Math.abs(resid));
  }
  prev = now;
};

// the farms, priced
const farms = bbls.filter((b) => parcels[b].ag && parcels[b].tract).sort((a, b) => parcels[a].tract.edgeM - parcels[b].tract.edgeM);
let g = E.firstListings(E.newGame(seed, parcels, 25e6, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
const acreUsd = (b) => E.landValue(E.resolveRec(parcels, g, b), g.econ) / (parcels[b].lotArea / 43560);
console.log(`seed ${seed} — ${city.name}: ${farms.length} plattable farm tracts; farm land prices at $${Math.round(acreUsd(farms[0])).toLocaleString()}/acre (USDA 2024 Illinois cropland $9,600)`);
{ const want = 9600 * (g.econ.priceLevel ?? 1); console.log(`  (this town's price level ${(g.econ.priceLevel ?? 1).toFixed(2)}: cropland at farm-use value is $${Math.round(want).toLocaleString()}/acre here)`); const crop = farms.filter((b) => parcels[b].ag === "crop"), off = crop.filter((b) => Math.abs(acreUsd(b) - want) > 0.25 * want); console.log(`  ${crop.length - off.length} of ${crop.length} cropland tracts price at farm-use value; the rest above it: ${off.slice(0, 4).map((b) => `${parcels[b].address} $${Math.round(acreUsd(b)).toLocaleString()}/ac`).join(", ")}`); if (off.some((b) => acreUsd(b) < 0.75 * want)) fail("cropland priced under its farm-use value"); }
{ const vac = bbls.filter((b) => parcels[b].class === "land" && !parcels[b].ag); const pen = vac.filter((b) => E.landRead(E.resolveRec(parcels, g, b), g.econ).builder > 0).length; console.log(`  for scale: ${pen} of ${vac.length} vacant town lots pencil for a builder at the opening`); }
check(g, "open");

// buy the nearest farms, file, and wait for a yes
let tract = null;
for (const b of farms.slice(0, 6)) {
  const price = Math.round(E.landValue(E.resolveRec(parcels, g, b), g.econ));
  const r = E.executePurchase(g, parcels, b, price, "cash", false);
  if (r.err) { console.log(`  could not buy ${parcels[b].address}: ${r.err}`); continue; }
  g = r.s; check(g, "purchase");
  const planned = platTractLots(parcels[b].tract, 7500).lots.length;
  const q = E.entitleQuote(g, parcels, b, 7500, planned);
  const f = E.fileEntitlement(g, parcels, b, 7500, planned);
  if (f.err) { console.log(`  ${parcels[b].address}: ${f.err}`); continue; }
  g = f.s; check(g, "file");
  console.log(`  bought ${parcels[b].address} for ${M(price)} (${parcels[b].tract.edgeM} m from town); rezoning ${q.lots} lots: ${M(q.cost)}, ${q.months} months, odds ${q.odds}`);
  while (g.entitlementApps?.[b]) { g = E.advanceQuarter(g, parcels, bbls, city.adjacency); check(g, "month"); }
  if (g.rezoned?.[b]) { tract = b; console.log(`  approved in month ${g.month}: zoned ${g.rezoned[b].zone}, FAR ${g.rezoned[b].far}`); break; }
  console.log(`  refused in month ${g.month}`);
}
if (!tract) { fail("no rezoning approved on six tries"); process.exit(1); }

// plat it
const rz = g.rezoned[tract];
const geo = platTractLots(parcels[tract].tract, rz.lotSf);
const lots = geo.lots.map(({ a, f, d }) => ({ a, f, d }));
const pq = E.platQuote(g, lots);
console.log(`  plat: ${lots.length} lots (median ${lots.map((l) => l.a).sort((a, b) => a - b)[lots.length >> 1].toLocaleString()} sf), ${geo.streets.length} street runs; horizontal ${M(pq.cost)} = $${pq.perLot.toLocaleString()}/lot, ${pq.months} months`);
const sp = E.startPlat(g, parcels, tract, lots);
if (sp.err) { fail(`plat: ${sp.err}`); process.exit(1); }
g = sp.s; check(g, "plat");
const basisBefore = g.holdings[tract].costBasis;
while (!g.plats[tract].done) { g = E.advanceQuarter(g, parcels, bbls, city.adjacency); check(g, "month"); }
const mine = Object.keys(g.holdings).filter((b) => parcels[b]?.block === tract);
console.log(`  streets in, month ${g.month}: ${mine.length} lot deeds held; the tract is retired (${g.holdings[tract] ? "STILL HELD" : "gone"}); bbls ${bbls.length}`);
if (mine.length !== lots.length) fail(`${mine.length} lot deeds for ${lots.length} lots`);
if (g.holdings[tract]) fail("the tract was not retired");
const basisAfter = mine.reduce((a, b) => a + g.holdings[b].costBasis, 0);
if (Math.abs(basisAfter - basisBefore) > lots.length + 10) fail(`basis ${M(basisBefore)} became ${M(basisAfter)}`);
const lotVal = E.landValue(E.resolveRec(parcels, g, mine[0]), g.econ);
{ const lr = E.landRead(E.resolveRec(parcels, g, mine[0]), g.econ); console.log(`  lot read $/sf: builder ${lr.builder.toFixed(2)} holder ${lr.holder.toFixed(2)} texture ${lr.texture.toFixed(2)} farm ${E.farmUsePsf(parcels[tract], g.econ).toFixed(3)} -> ${lr.winner}; demand ${parcels[mine[0]].demandScore}`); }
console.log(`  a lot: ${E.resolveRec(parcels, g, mine[0]).address}, ${parcels[mine[0]].lotArea.toLocaleString()} sf, zoned ${E.resolveRec(parcels, g, mine[0]).zoneDist}; worth ${M(lotVal)} against a basis of ${M(g.holdings[mine[0]].costBasis)}`);

// a reload: the lots come back from the recipe alone
{
  const fresh = makeCity(REGION, seed).parcels, fb = Object.keys(fresh);
  E.normalizeParcels(fresh);
  const added = E.materializePlats(JSON.parse(JSON.stringify(g)), fresh, fb);
  const same = mine.every((b) => fresh[b] && fresh[b].lotArea === parcels[b].lotArea);
  console.log(`  reload: ${added.length} lots regenerated from the save, ${same ? "identical" : "DIFFERENT"}`);
  if (!same || added.length !== lots.length) fail("the lots did not regenerate identically");
}

// build on one, list another, run a year
{
  let built = false;
  for (const fl of [2, 1]) {
    const d = E.startDevelopment(g, parcels, mine[0], "multifamily", fl, 0.35, "gmp");
    if (!d.err) { g = d.s; built = true; console.log(`  broke ground on lot 1: ${fl}-storey flats`); break; }
    console.log(`  lot 1, ${fl} storeys: ${d.err}`);
  }
  check(g, "develop");
  const ask = Math.round(E.landValue(E.resolveRec(parcels, g, mine[1]), g.econ) * 1.05);
  const l = E.listForSale(g, parcels, mine[1], ask, "marketed");
  if (l.err) console.log(`  list lot 2: ${l.err}`); else { g = l.s; console.log(`  listed lot 2 at ${M(ask)}`); }
  for (let m = 0; m < 12; m++) { g = E.advanceQuarter(g, parcels, bbls, city.adjacency); check(g, "month"); }
  const sold = !g.holdings[mine[1]];
  console.log(`  a year on: lot 2 ${sold ? "sold" : "still listed"}; lot 1 ${g.developments[mine[0]] ? "under construction" : g.built?.[mine[0]] ? "delivered" : built ? "?" : "not started"}`);
}
console.log(`  ledger: worst unexplained month $${Math.round(worst).toLocaleString()}`);
console.log(fails ? `\n${fails} failure(s)` : "\nlanddev: all checks pass");
process.exit(fails ? 1 : 0);
