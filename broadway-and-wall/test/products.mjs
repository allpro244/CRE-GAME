// PRODUCT TYPES (engine/products.ts), CHECKED AGAINST THE WORLD.
//
//   pnpm -s exec node test/products.mjs            seed 1, region map
//   BW_SEED=3 pnpm -s exec node test/products.mjs
//
// For a sample lot of each type — a vacant town lot on the region map, given
// the acreage the type is built on — it plans the product through the desk's
// own planDevelopment and asserts the shape against published figures:
//
//   SITE      the solved coverage (FAR, one storey) sits in the type's
//             published band; parking land is stalls x stall size; building,
//             paving and open ground fit on the lot.
//   COST      hard cost per sf, in 2024 dollars (divided by the town's
//             construction index), sits between the shell and the shell plus
//             the site work at twice the paved share — no more, no less.
//   RENT      inline / spec rent per sf in 2024 dollars sits in the observed
//             range for the class (CoStar / CBRE 2024 asking rents: strip and
//             centre inline $10-50 NNN across US markets, industrial $5-36
//             NNN, infill flex at the top); an anchor pays its table fraction.
//   VALUE     value on completion = stabilised NOI / tax-loaded exit yield; the
//             exit caps order the way the CBRE / Boulder surveys do.
//   RESIDUAL  yield on cost ex land is 3-20%, and the land residual is a
//             plausible number of dollars per sf of dirt (-$80..+$80, 2024 $):
//             most of this does not pencil at the opening, and that is
//             reported, not asserted away.
//
// Then the mechanisms: an anchor raises inline rent and occupancy where its
// trade area is a better address than the lot (co-tenancy), and loses it
// when the anchor goes; a delivered centre carries its anchors as tenants and
// the money moves through the ledger; an industrial park is bought, rezoned,
// platted into 2-20 acre lots and built on.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity, REGION, platTractLots } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const seed = Number(process.env.BW_SEED ?? 1);
const city = makeCity(REGION, seed);
const parcels = city.parcels, bbls = Object.keys(parcels);
E.normalizeParcels(parcels);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const ok = (c, m) => { if (!c) fail(m); };
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;

// the ledger, as test/landdev.mjs and test/conserve.mjs reconcile it
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled"], OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => Object.values(g.holdings ?? {}).reduce((a, h) => a + (h.tenants ?? []).reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
const snap = (g) => ({ cash: g.cash + (g.fund?.cash ?? 0), books: books(g), loc: g.loc?.balance ?? 0, dep: deposits(g) });
let prev, worst = 0;
const check = (g, what) => {
  const now = snap(g);
  if (prev) {
    const resid = (now.cash - prev.cash) - (now.books - prev.books) - (now.loc - prev.loc) - (now.dep - prev.dep);
    if (Math.abs(resid) > 1) fail(`${what}: $${Math.round(resid).toLocaleString()} moved without a ledger entry`);
    worst = Math.max(worst, Math.abs(resid));
  }
  prev = now;
};

let g = E.firstListings(E.newGame(seed, parcels, 60e6, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
const PL = g.econ.costIdx;           // construction cost index: 2024 $ = engine $ / PL
const RL = g.econ.priceLevel ?? 1;   // the town's price level, for rents and land
console.log(`seed ${seed} — ${city.name}: construction index ${PL.toFixed(3)}, price level ${RL.toFixed(3)} (2024 dollars = engine dollars / these)`);

// the sample site: a vacant town lot at the region's median demand, given each type's acreage
const vacant = bbls.filter((b) => parcels[b].class === "land" && !parcels[b].ag && parcels[b].centroid).sort((a, b) => parcels[a].demandScore - parcels[b].demandScore);
// ...on the town's commercial ground (a C district: where the generator put the
// arterials and the shops), at its upper-quartile demand — where a developer
// puts a centre: the arterial, not the back street. A strip on a dead field with
// no footfall is a real thing and does not pencil; it is not the sample.
const commercial = vacant.filter((b) => /^C/.test(parcels[b].zoneDist ?? ""));
const pool = commercial.length >= 10 ? commercial : vacant;
const site = pool[Math.floor(pool.length * 0.75)];
const orig = { ...parcels[site] };
const ACRES = { pad: 1.2, strip: 3, neighborhood: 9, community: 28, power: 45, flex: 3.5, bulk: 25, manufacturing: 12 };
const setLot = (acres) => {
  const a = Math.round(acres * 43560), side = Math.round(Math.sqrt(a));
  parcels[site] = { ...orig, lotArea: a, lotFront: side, lotDepth: side, bldgArea: 0, class: "land" };
};
console.log(`sample site ${orig.address}, demand ${orig.demandScore}\n`);

const rows = [];
console.log("type           acres  bldg sf   FAR   stalls doors paved ac  hard $/sf  inline $/sf  NOI $/sf  exit cap  value      YoC-xL  resid $/sf  months");
for (const k of E.PRODUCT_KEYS) {
  const P = E.PRODUCT_TYPES[k];
  setLot(ACRES[k]);
  const p = E.planDevelopment(g, parcels, site, P.use, 1, 1, "gmp", undefined, { product: k }, undefined, 0.5, 0);
  if (!p?.product) { fail(`${k}: no plan on a ${ACRES[k]} acre lot`); continue; }
  const st = p.product.site, lot = parcels[site].lotArea;
  // SITE
  ok(p.floors === 1, `${k}: ${p.floors} floors`);
  ok(p.coverage >= P.coverBand[0] - 1e-9 && p.coverage <= P.coverBand[1] + 1e-9, `${k}: coverage ${p.coverage.toFixed(3)} outside the published band ${P.coverBand}`);
  ok(st.gsf >= P.sf[0] && st.gsf <= P.sf[1], `${k}: ${st.gsf} sf outside the type's ${P.sf}`);
  ok(st.stalls === Math.ceil(st.gsf / 1000 * P.parkPer1000), `${k}: ${st.stalls} stalls for ${st.gsf} sf at ${P.parkPer1000}/1000`);
  ok(Math.abs(st.parkingSf - (st.stalls * P.stallSf + P.fixedPavedSf)) < 1, `${k}: parking land ${st.parkingSf} is not stalls x ${P.stallSf}`);
  ok(st.gsf + st.pavedSf + st.openSf <= lot * 1.001, `${k}: building ${st.gsf} + paving ${st.pavedSf} + open ${st.openSf} > lot ${lot}`);
  // COST — before the contract premium and the site's own bid
  const raw = p.hardCost / PL / 1.04;
  const shell = P.shellPsf + P.powerPsf;
  const perSf = raw / st.gsf;
  const costMult = E.projectCostMult(g, site, P.use);
  const adj = perSf / costMult;
  ok(adj >= shell && adj <= shell + 2 * (st.pavedSf / st.gsf) * P.pavePsf + 2 * (st.openSf / st.gsf) * P.openPsf + 1, `${k}: hard cost $${adj.toFixed(0)}/sf (2024) against a $${shell} shell`);
  // RENT
  const ab = { ...E.resolveRec(parcels, g, site), class: P.use, mix: { [P.use]: 1 }, bldgArea: p.sf, floors: 1, buildSpec: 0.5, product: k,
    ...(p.product.draw !== undefined ? { retailDraw: p.product.draw } : {}) };
  const inline = E.useRentPsfYr(ab, E.underwritingEcon(g.econ), "good", P.use);
  const inline24 = inline / RL;
  const band = P.use === "retail" ? [10, 50] : [5, 36];
  ok(inline24 >= band[0] && inline24 <= band[1], `${k}: inline/spec rent $${inline24.toFixed(2)}/sf (2024) outside ${band}`);
  for (const a of p.product.anchors) {
    const spec0 = P.anchors.find((x) => x.termY * 12 === a.termM);
    ok(spec0 && Math.abs(a.rentPsf - inline * spec0.rentRatio) <= 0.02 * inline + 0.02, `${k}: anchor at $${a.rentPsf} against inline $${inline.toFixed(2)} x ${spec0?.rentRatio}`);
  }
  // VALUE
  const value = p.stabNoi / (p.exitYield / 100);
  ok(value > 0 && Number.isFinite(value), `${k}: value ${value}`);
  // RESIDUAL
  const nonLand = p.basisTotal - p.landBasis - p.landCarry;
  const carry = p.landCarry / Math.max(1, p.landBasis);
  const residual = (value / (1 + E.DEV_MARGIN) - nonLand) / (1 + (Number.isFinite(carry) ? carry : 0));
  const resid24 = residual / lot / RL;
  ok(p.yieldOnCostExLand >= 3 && p.yieldOnCostExLand <= 20, `${k}: yield on cost ex land ${p.yieldOnCostExLand.toFixed(2)}%`);
  ok(resid24 >= -80 && resid24 <= 80, `${k}: residual $${resid24.toFixed(2)}/sf of land (2024)`);
  rows.push({ k, P, p, value, resid24, inline24 });
  console.log(`${k.padEnd(14)} ${String(ACRES[k]).padStart(5)} ${String(st.gsf).padStart(8)}  ${p.coverage.toFixed(2)}  ${String(st.stalls).padStart(6)} ${String(st.doors).padStart(5)} ${(st.pavedSf / 43560).toFixed(1).padStart(8)}  ${(adj).toFixed(0).padStart(9)}  ${inline24.toFixed(2).padStart(11)}  ${(p.stabNoi / p.rentable / RL).toFixed(2).padStart(8)}  ${p.exitYield.toFixed(2).padStart(8)}  ${M(value / RL).padStart(9)}  ${p.yieldOnCostExLand.toFixed(2).padStart(6)}  ${resid24.toFixed(2).padStart(10)}  ${p.months}`);
}
console.log("(money columns in 2024 dollars; exit cap tax-loaded, at the opening's own rates)");

// the cap rates order the way the surveys do: a credit pad inside a grocery
// centre inside a strip; a box inside flex inside a single-purpose plant
const cap = Object.fromEntries(rows.map((r) => [r.k, r.p.exitCap]));
ok(cap.pad < cap.neighborhood && cap.neighborhood < cap.strip && cap.community < cap.power, `retail caps out of order: ${JSON.stringify(cap)}`);
ok(cap.bulk < cap.flex && cap.flex < cap.manufacturing, `industrial caps out of order: ${JSON.stringify(cap)}`);

// a product does not exist where it cannot be laid out
setLot(0.15);
ok(!E.planDevelopment(g, parcels, site, "retail", 1, 1, "gmp", undefined, { product: "neighborhood" }), "a grocery centre on a 6,500 sf lot");
setLot(12);
ok(!E.planDevelopment(g, parcels, site, "retail", 1, 1, "gmp", undefined, { product: "pad" }), "a pad on a twelve-acre lot");
parcels[site] = orig;

// ---------------------------------------------------------------- co-tenancy
// The lot in town whose own demand sits furthest under the trade area an
// anchor here would draw from: its inline shops should let higher and fuller
// with the grocer than without it, through the market's own curves.
{
  const lowest = vacant.slice(0, 40);
  let best = null;
  for (const b of lowest) {
    const d = E.tradeAreaDemand(g, parcels, b, E.PRODUCT_TYPES.neighborhood.tradeRadiusM);
    const own = E.resolveRec(parcels, g, b).demandScore;
    if (!best || d - own > best.gap) best = { b, gap: d - own, d, own };
  }
  const r0 = { ...E.resolveRec(parcels, g, best.b), class: "retail", mix: { retail: 1 }, bldgArea: 90_000, floors: 1, buildSpec: 0.5, product: "neighborhood" };
  const r1 = { ...r0, retailDraw: best.d };
  const uw = E.underwritingEcon(g.econ);
  const rent0 = E.useRentPsfYr(r0, uw, "good", "retail"), rent1 = E.useRentPsfYr(r1, uw, "good", "retail");
  const occ0 = E.useOccupancy(r0, uw, "retail", true), occ1 = E.useOccupancy(r1, uw, "retail", true);
  console.log(`\nco-tenancy at ${parcels[best.b].address}: own demand ${best.own.toFixed(1)}, the grocer's 3-mile trade area ${best.d.toFixed(1)}`);
  console.log(`  inline rent $${(rent0 / RL).toFixed(2)} -> $${(rent1 / RL).toFixed(2)}/sf (2024), stabilised occupancy ${(occ0 * 100).toFixed(1)}% -> ${(occ1 * 100).toFixed(1)}%`);
  ok(best.gap > 0, "no lot in town sits under its trade area (the mechanism cannot be exercised)");
  ok(rent1 > rent0, "the anchor's draw did not raise inline rent");
  ok(occ1 >= occ0, "the anchor's draw lowered inline occupancy");
  // and a strip, unanchored, gets nothing of it
  ok(E.retailDemandOf({ demandScore: best.own }) === best.own, "an unanchored record read a draw");
}

// ---------------------------------------------------------------- a delivered centre
{
  setLot(9);
  parcels[site] = { ...parcels[site], landPsf: 0.5, assessedLand: 1000, assessedTotal: 1000 };
  const price = Math.round(E.landValue(E.resolveRec(parcels, g, site), g.econ));
  const r = E.executePurchase(g, parcels, site, price, "cash", false);
  if (r.err) fail(`buy the centre site: ${r.err}`);
  else {
    g = r.s; check(g, "purchase");
    const plan = E.planDevelopment(g, parcels, site, "retail", 1, 1, "gmp", undefined, { product: "neighborhood" });
    const d = E.startDevelopment(g, parcels, site, "retail", 1, 1, "gmp", undefined, { product: "neighborhood" });
    if (d.err) fail(`break ground on the centre: ${d.err}`);
    else {
      g = d.s; check(g, "groundbreak");
      const dev = g.developments[site];
      console.log(`\nbroke ground: ${dev.sf.toLocaleString()} sf neighbourhood centre, ${dev.anchors.map((a) => `${a.name} ${a.sf.toLocaleString()} sf at $${a.rentPsf}`).join("; ")}, ${M(plan.costTotal)} budget, ${plan.months} months`);
      ok(dev.product === "neighborhood" && dev.anchors?.length === 1 && dev.anchors[0].name, "the development lost its product or its anchor");
      let m = 0;
      while (g.developments[site] && m++ < 40) { g = E.advanceMonth(g, parcels, bbls, city.adjacency); if (g.gameOver) g = { ...g, gameOver: null }; check(g, "month"); }
      const h = g.holdings[site];
      const built = g.built[site];
      ok(!g.developments[site], "the centre never delivered");
      ok(built?.product === "neighborhood" && built.draw !== undefined && built.anchors?.length === 1, `delivered record ${JSON.stringify(built)}`);
      const grocer = h?.tenants?.find((t) => t.name === dev.anchors[0].name);
      ok(grocer && grocer.endM - grocer.startM === 240 && grocer.net, "the grocer is not on the roll on a 20-year NNN lease");
      const live = E.resolveRec(parcels, g, site);
      ok(live.product === "neighborhood" && live.retailDraw === built.draw, "the delivered record does not carry the anchor's draw");
      const capNow = E.capRateFor(live, g.econ, "good");
      console.log(`  delivered month ${g.month}: ${h.tenants.length} tenants, grocer to month ${grocer?.endM}; draw ${built.draw}; cap ${capNow.toFixed(2)}%`);
      // the grocer goes dark: the co-tenancy goes with it
      const dark = { ...g, holdings: { ...g.holdings, [site]: { ...h, tenants: h.tenants.filter((t) => t !== grocer) } } };
      const gone = E.resolveRec(parcels, dark, site);
      ok(gone.retailDraw === undefined, "the draw outlived the anchor");
      console.log(`  grocer gone: the shops read demand ${E.retailDemandOf(gone).toFixed(1)} instead of ${E.retailDemandOf(live).toFixed(1)}`);
    }
  }
}

// ---------------------------------------------------------------- an industrial park
{
  const farms = bbls.filter((b) => parcels[b].ag && parcels[b].tract).sort((a, b) => parcels[a].tract.edgeM - parcels[b].tract.edgeM);
  const lotSf = 217_800;   // five acres
  let tract = null;
  for (const b of farms) {
    const planned = platTractLots(parcels[b].tract, lotSf).lots.length;
    if (planned < 3) continue;
    const price = Math.round(E.landValue(E.resolveRec(parcels, g, b), g.econ));
    const r = E.executePurchase(g, parcels, b, price, "cash", false);
    if (r.err) continue;
    g = r.s; check(g, "farm purchase");
    const q = E.entitleQuote(g, parcels, b, lotSf, planned);
    ok(q?.zone === "I-1" && q.kind === "industrial", `an industrial park files for ${q?.zone}`);
    const f = E.fileEntitlement(g, parcels, b, lotSf, planned);
    if (f.err) { fail(`file: ${f.err}`); break; }
    g = f.s; check(g, "file");
    while (g.entitlementApps?.[b]) { g = E.advanceMonth(g, parcels, bbls, city.adjacency); if (g.gameOver) g = { ...g, gameOver: null }; check(g, "month"); }
    console.log(`\nindustrial park: ${parcels[b].address}, ${Math.round(parcels[b].lotArea / 43560)} acres bought for ${M(price)}; ${planned} five-acre lots filed; ${g.rezoned?.[b] ? "rezoned I-1" : "refused"} in month ${g.month}`);
    if (g.rezoned?.[b]) { tract = b; break; }
  }
  if (!tract) fail("no industrial rezoning granted");
  else {
    const lots = platTractLots(parcels[tract].tract, lotSf).lots.map(({ a, f, d }) => ({ a, f, d }));
    const pq = E.platQuote(g, lots, lotSf);
    const sp = E.startPlat(g, parcels, tract, lots);
    if (sp.err) fail(`plat: ${sp.err}`);
    else {
      g = sp.s; check(g, "plat");
      ok(g.plats[tract].template === "industrial", "the park was platted as house lots");
      while (!g.plats[tract].done) { g = E.advanceMonth(g, parcels, bbls, city.adjacency); if (g.gameOver) g = { ...g, gameOver: null }; check(g, "month"); }
      const mine = Object.keys(g.holdings).filter((b) => parcels[b]?.block === tract);
      const lot = E.resolveRec(parcels, g, mine[0]);
      console.log(`  spine road in: ${mine.length} lots (median ${Math.round(lots.map((l) => l.a).sort((a, b) => a - b)[lots.length >> 1] / 43560 * 10) / 10} ac), ${M(pq.cost)} of road and pipe ($${Math.round(pq.cost / Math.max(1, lots.reduce((t, l) => t + l.f, 0)) / PL).toLocaleString()} a front foot, 2024); lot 1 zoned ${lot.zoneDist} FAR ${lot.farMaxComm}`);
      ok(mine.length === lots.length && lot.zoneDist === "I-1", "the park's lots did not materialise as I-1 deeds");
      const plans = ["flex", "bulk", "manufacturing"].map((k) => [k, E.planDevelopment(g, parcels, mine[0], "industrial", 1, 1, "gmp", undefined, { product: k })]);
      for (const [k, p] of plans) console.log(`  ${k.padEnd(13)} on lot 1: ${p ? `${p.sf.toLocaleString()} sf, cov ${p.coverage.toFixed(2)}, ${M(p.costTotal / PL)} (2024), YoC ${p.yieldOnCost.toFixed(2)}% on a ${M(p.landBasis / PL)} lot basis, hurdle ${p.hurdleRatio.toFixed(2)}` : "does not fit"}`);
      ok(plans.some(([, p]) => p), "no industrial product fits a five-acre park lot");
      const rs = E.residualScheme(lot, g.econ);
      console.log(`  the tape's read of lot 1: ${rs ? `${rs.product ?? rs.use} at $${(rs.psf / RL).toFixed(2)}/sf (2024)` : "no scheme pencils"}; bids ${JSON.stringify((rs?.all ?? []).map((x) => [x.use, +(x.psf / RL).toFixed(2)]))}`);
      const d = E.startDevelopment(g, parcels, mine[0], "industrial", 1, 1, "gmp", undefined, { product: "bulk" });
      if (d.err) console.log(`  bulk on lot 1: ${d.err}`);
      else { g = d.s; check(g, "park groundbreak"); console.log(`  broke ground on a ${g.developments[mine[0]].sf.toLocaleString()} sf box`); }
      for (let m = 0; m < 6; m++) { g = E.advanceMonth(g, parcels, bbls, city.adjacency); if (g.gameOver) g = { ...g, gameOver: null }; check(g, "month"); }
    }
  }
}

console.log(`\nledger: worst unexplained month $${Math.round(worst).toLocaleString()}`);
console.log(fails ? `\n${fails} failure(s)` : "\nproducts: all checks pass");
process.exit(fails ? 1 : 0);
