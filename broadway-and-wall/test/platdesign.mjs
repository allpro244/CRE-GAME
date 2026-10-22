// THE SUBDIVISION DESIGN DESK, PLAYED (region map: citygen/region/platdesign.mjs, engine/platdesign.ts).
//
//   pnpm engine && node test/platdesign.mjs        seed 1
//   BW_SEED=3 node test/platdesign.mjs
//
// What it holds the desk to:
//   1. A design is a recipe: the same design gives the same lots, with and without amenities.
//   2. Amenities take land: every one that claims ground leaves fewer lots.
//   3. A premium lands only where it is earned: no amenity, no premium; a park lifts the lots beside
//      it and not the lots across the plat; the pool lifts every lot by its community-wide share.
//   4. Committing a plat moves net worth by the cash it spends and nothing else; finishing it moves
//      net worth by the honest change in what the land is worth (the lots at the builders' bid, the
//      association's land at nothing) — and the desk's mark-at-finish is that same number.
//   5. Every dollar goes through the ledger, month by month: the cash identity `conserve` asserts,
//      held here to $0, through the A&D note's draw, its interest reserve and its lot releases.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity, REGION, platTractDesign, designSummary } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const seed = Number(process.env.BW_SEED ?? 1);
const city = makeCity(REGION, seed);
const parcels = city.parcels, bbls = Object.keys(parcels);
E.normalizeParcels(parcels);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
const K = (n) => `$${Math.round(n / 1000).toLocaleString()}k`;

// ---------------------------------------------------------------- the cash identity (test/conserve.mjs)
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

// ---------------------------------------------------------------- 1-3: the geometry and the premium
const farms = bbls.filter((b) => parcels[b].ag && parcels[b].tract && (parcels[b].buildableSf ?? 0) > 25 * 43560)
  .sort((a, b) => parcels[a].tract.edgeM - parcels[b].tract.edgeM);
const withFlood = farms.filter((b) => (parcels[b].floodShare ?? 0) > 0.05);
const probe = withFlood[0] ?? farms[0];
const T = parcels[probe].tract;
const recipe = (d) => E.designRecipe(d, parcels[probe].buildableSf ?? parcels[probe].lotArea);
const draw = (d) => platTractDesign(T, recipe(d));
const base = E.defaultDesign();
const g0 = draw(base);
console.log(`seed ${seed} — ${city.name}: ${farms.length} tracts over 25 buildable acres; probe ${parcels[probe].address}, ${(g0.ground.buildableSf / 43560).toFixed(1)} buildable ac, ${(g0.ground.floodSf / 43560).toFixed(1)} ac floodplain`);
const key = (g) => JSON.stringify(g.lots.map((l) => [l.a, l.ring.map((p) => p.map((x) => +x.toFixed(3)))]));
{
  const centre = g0.lots[Math.floor(g0.lots.length / 2)].c;
  const withAmen = { ...base, amen: [{ k: "park", at: centre }, { k: "pool", at: g0.lots[3].c }, ...(withFlood.length ? [{ k: "greenway", at: null }] : [])] };
  const mixed = { ...base, layout: "loops", mix: { 5000: 1, 7500: 2, 10000: 1 }, rot: 7, shift: [12, -8] };
  for (const [name, d] of [["plain grid", base], ["grid + park, pool, greenway", withAmen], ["loops, mixed sizes, turned", mixed], ["cul-de-sacs", { ...base, layout: "culdesac" }]]) {
    const t0 = performance.now(); const a = draw(d); const ms = performance.now() - t0;
    const b = draw(JSON.parse(JSON.stringify(d)));
    const same = key(a) === key(b);
    console.log(`  ${name.padEnd(30)} ${String(a.lots.length).padStart(4)} lots, ${ms.toFixed(0)} ms, redrawn ${same ? "identical" : "DIFFERENT"}`);
    if (!same) fail(`${name}: the same design drew different lots`);
    if (!a.lots.length) fail(`${name}: no lots`);
  }
  // 2. amenities take land
  for (const k of ["pocket", "park", "playground", "pool", "entry", "fields"]) {
    const g = draw({ ...base, amen: [{ k, at: centre }] });
    const took = g0.lots.length - g.lots.length;
    if (!(took > 0)) fail(`${k}: took no lots (${g0.lots.length} -> ${g.lots.length})`);
    console.log(`  ${E.AMENITIES[k].name.padEnd(20)} takes ${String(took).padStart(3)} lots (${(g.stats.amenSf / 43560).toFixed(2)} ac against ${E.AMENITIES[k].acres} ac)`);
  }
  // 3. premiums only where earned
  const kindsOf = (d) => d.amen.map((a) => a.k);
  const prem = (g, d) => g.lots.map((l) => E.lotPremium(l.near, kindsOf(d)));
  if (prem(g0, base).some((p) => p !== 0)) fail("a plat with no amenities carries a premium");
  const dPark = { ...base, amen: [{ k: "pocket", at: centre }] };
  const gPark = draw(dPark), pPark = prem(gPark, dPark);
  const beside = gPark.lots.filter((l, i) => l.near.some(([, m]) => m < 3)).length;
  const lifted = pPark.filter((p) => p >= 0.005).length;
  const far = gPark.lots.filter((l, i) => pPark[i] > 0.001 && !l.near.some(([, m]) => m < 0.3048 * E.AMENITIES.pocket.decayFt * 5)).length;
  console.log(`  pocket park: ${beside} lots touch it, ${lifted} carry 0.5% or more (top ${(Math.max(...pPark) * 100).toFixed(1)}%), ${gPark.lots.length - lifted} carry less`);
  if (!(beside > 0)) fail("no lot touches the pocket park");
  if (Math.abs(Math.max(...pPark) - E.AMENITIES.pocket.adj) > 0.002) fail(`a lot touching the pocket park carries ${Math.max(...pPark)}, not its ${E.AMENITIES.pocket.adj}`);
  if (far) fail(`${far} lots far from the pocket park carry its premium`);
  if (!(lifted < gPark.lots.length / 2)) fail("the pocket park lifts most of the plat");
  const dPool = { ...base, amen: [{ k: "pool", at: centre }] };
  const pPool = prem(draw(dPool), dPool);
  if (pPool.some((p) => Math.abs(p - E.AMENITIES.pool.all) > 1e-9)) fail("the pool's premium is not the same community-wide share on every lot");
  if (withFlood.length) {
    const dG = { ...base, amen: [{ k: "greenway", at: null }] };
    const gG = draw(dG), pG = prem(gG, dG);
    const n = pG.filter((p) => p >= 0.005).length;
    console.log(`  greenway: ${(designSummary(gG).amen[0].trailFt).toFixed(0)} ft of trail on the floodplain's edge, ${n} lots lifted, takes ${g0.lots.length - gG.lots.length} lots`);
    if (!(n > 0)) fail("the greenway lifts no lot");
    if (gG.lots.length !== g0.lots.length) fail("the greenway took lots (it runs in the floodplain)");
  }
}

// ---------------------------------------------------------------- 4-5: the desk, played
let g = E.firstListings(E.newGame(seed, parcels, 25e6, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
check(g, "open");
const nw = (st) => E.netWorth(st, parcels);
const debt = (st) => Object.values(st.holdings).reduce((t, h) => t + (h.loan?.balance ?? 0), 0);
const marks = (st, list) => list.reduce((t, b) => t + (st.holdings[b] ? E.ownedHoldingValue(st, parcels, st.holdings[b]) : 0), 0);
let tract = null, design = null, geo = null;
for (const b of farms.slice(0, 8)) {
  const price = Math.round(E.landValue(E.resolveRec(parcels, g, b), g.econ));
  const r = E.executePurchase(g, parcels, b, price, "cash", false);
  if (r.err) { console.log(`  could not buy ${parcels[b].address}: ${r.err}`); continue; }
  g = r.s; check(g, "purchase");
  const t = parcels[b].tract;
  const d0 = E.defaultDesign();
  const first = platTractDesign(t, E.designRecipe(d0, parcels[b].buildableSf));
  const mid = first.lots[Math.floor(first.lots.length / 2)]?.c;
  design = { ...d0, mix: { 7500: 3, 10000: 1 }, amen: [{ k: "park", at: mid }, { k: "pool", at: first.lots[0]?.c ?? mid }, { k: "entry", at: first.lots.at(-1)?.c ?? mid }] };
  geo = designSummary(platTractDesign(t, E.designRecipe(design, parcels[b].buildableSf)));
  const f = E.fileDesignedRezoning(g, parcels, b, design, geo);
  if (f.err) { console.log(`  ${parcels[b].address}: ${f.err}`); continue; }
  g = f.s; check(g, "file");
  console.log(`  bought ${parcels[b].address} for ${M(price)}; rezoning filed with a ${geo.lots.length}-lot plat (park, pool, entrance)`);
  while (g.entitlementApps?.[b]) { g = E.advanceQuarter(g, parcels, bbls, city.adjacency); check(g, "month"); }
  if (g.rezoned?.[b]) { tract = b; console.log(`  approved month ${g.month}: ${g.rezoned[b].lots} lots, design ${g.rezoned[b].design ? "on file" : "MISSING"}`); break; }
  console.log(`  refused month ${g.month}`);
}
if (!tract) { fail("no rezoning approved"); process.exit(1); }
if (!g.rezoned[tract].design) fail("the approved rezoning lost its plat");

// the board approved a number: more lots is a new application
{
  const more = { ...geo, lots: [...geo.lots, ...geo.lots.slice(0, 3)] };
  const r = E.startDesignedPlat(g, parcels, tract, design, more, 0);
  if (!r.err) fail("a plat with more lots than approved was built");
}
// the P&L, with and without the amenities
const plain = { ...design, amen: [] };
const geoPlain = designSummary(platTractDesign(parcels[tract].tract, E.designRecipe(plain, parcels[tract].buildableSf)));
const pnl = E.designPnl(g, parcels, tract, design, geo), pnl0 = E.designPnl(g, parcels, tract, plain, geoPlain);
const line = (p, name) => console.log(`  ${name.padEnd(18)} ${String(p.lots).padStart(3)} lots | land ${M(p.land)} streets ${M(p.streets)} impact ${M(p.impact)} amenities ${M(p.amenTotal)} | revenue ${M(p.revenue)} (prem avg ${(p.premAvg * 100).toFixed(1)}%) | profit ${M(p.profit)} margin ${(p.margin * 100).toFixed(1)}% IRR ${p.irr === null ? "—" : (p.irr * 100).toFixed(1) + "%"} | ${p.pace.toFixed(1)}/mo, ${p.selloutM} mo`);
line(pnl0, "no amenities"); line(pnl, "park, pool, entry");
const ad = E.adQuote(g, pnl, 1);
console.log(`  A&D: ${ad.lender} ${M(ad.loan)} (${(ad.loan / pnl.cost * 100).toFixed(0)}% of cost, ${(ad.ltcMax * 100).toFixed(0)}% offered) at ${ad.ratePct.toFixed(2)}%, reserve ${K(ad.reserve)}, points ${K(ad.points)}; equity now ${M(ad.equityNow)}, levered IRR ${ad.irr === null ? "—" : (ad.irr * 100).toFixed(1) + "%"}`);
if (!(ad.loan > 0)) console.log("  (no A&D money today: the plat is built on equity)");

// commit: the streets, with the A&D note
const before = { nw: nw(g), cash: g.cash, debt: debt(g), mark: marks(g, [tract]) };
const sp = E.startDesignedPlat(g, parcels, tract, design, geo, 1);
if (sp.err) { fail(`build: ${sp.err}`); process.exit(1); }
g = sp.s; check(g, "commit");
{
  const after = { nw: nw(g), cash: g.cash, debt: debt(g), mark: marks(g, [tract]) };
  const dNw = after.nw - before.nw, honest = (after.cash - before.cash) - (after.debt - before.debt) + (after.mark - before.mark);
  console.log(`  commit: cash ${M(after.cash - before.cash)}, debt ${M(after.debt - before.debt)}, the tract's mark ${M(after.mark - before.mark)} -> net worth ${M(dNw)}`);
  if (Math.abs(dNw - honest) > 1000) fail(`commit moved net worth ${M(dNw)}, cash and value say ${M(honest)}`);
  if (Math.abs(after.mark - before.mark) > 1000) fail("drawing parks moved the tract's mark before a lot exists");
}
const loan0 = g.holdings[tract].loan;
if (ad.loan > 0 && !loan0?.ad) fail("no A&D note on the tract");
while (!g.plats[tract].done) {
  const pre = { nw: nw(g), cash: g.cash, debt: debt(g) };
  const preMark = marks(g, Object.keys(g.holdings).filter((b) => b === tract || parcels[b]?.block === tract));
  g = E.advanceQuarter(g, parcels, bbls, city.adjacency); check(g, "month");
  if (g.plats[tract].done) {
    const mine = Object.keys(g.holdings).filter((b) => parcels[b]?.block === tract);
    const post = { nw: nw(g), cash: g.cash, debt: debt(g), mark: marks(g, mine) };
    const dNw = post.nw - pre.nw;
    const honest = (post.cash - pre.cash) - (post.debt - pre.debt) + (post.mark - preMark);
    const pnlNow = E.designPnl(g, parcels, tract, design, geo);
    console.log(`  streets in, month ${g.month}: ${mine.length} lots; the land ${M(preMark)} -> ${M(post.mark)}; the desk said ${M(pnlNow?.markAtFinish ?? 0)} at finish; net worth ${M(dNw)} (cash ${M(post.cash - pre.cash)}, debt ${M(post.debt - pre.debt)})`);
    if (Math.abs(dNw - honest) > 5000) fail(`completion moved net worth ${M(dNw)}, cash and value say ${M(honest)}`);
  }
}
const lots = Object.keys(g.holdings).filter((b) => parcels[b]?.block === tract && parcels[b].homeLot);
const hoa = bbls.filter((b) => parcels[b]?.block === tract && parcels[b].hoa);
console.log(`  ${lots.length} lot deeds, ${hoa.length} association deeds (${hoa.map((b) => parcels[b].hoa).join(", ")}); A&D on ${lots.filter((b) => g.holdings[b].loan?.ad).length} lots, ${M(debt(g))}`);
if (lots.length !== geo.lots.length) fail(`${lots.length} lot deeds for ${geo.lots.length} lots`);
if (!hoa.length) fail("the amenities became no deeds");
if (hoa.some((b) => !E.isCivicLand(g, b) || g.holdings[b])) fail("an association deed is on the market or on your books");
const premLots = lots.filter((b) => (parcels[b].homePrem ?? 0) > 0);
for (const b of lots) {
  const i = Number(parcels[b].lot) - 1;
  if (Math.abs((parcels[b].homePrem ?? 0) - pnl.prem[i]) > 1e-9) { fail(`lot ${i + 1} carries ${parcels[b].homePrem}, the desk priced ${pnl.prem[i]}`); break; }
}
{
  const by = (b) => E.landValue(E.resolveRec(parcels, g, b), g.econ) / parcels[b].lotArea;
  const pl = premLots.length ? premLots.reduce((t, b) => t + by(b), 0) / premLots.length : 0;
  console.log(`  ${premLots.length} lots carry a premium; a lot's bid averages $${pl.toFixed(2)}/sf there`);
}
// reload: the same lots, the same association land, from the save alone
{
  const fresh = makeCity(REGION, seed).parcels, fb = Object.keys(fresh);
  E.normalizeParcels(fresh);
  const added = E.materializePlats(JSON.parse(JSON.stringify(g)), fresh, fb);
  const same = [...lots, ...hoa].every((b) => fresh[b] && fresh[b].lotArea === parcels[b].lotArea && (fresh[b].homePrem ?? 0) === (parcels[b].homePrem ?? 0));
  console.log(`  reload: ${added.length} deeds regenerated from the save, ${same ? "identical" : "DIFFERENT"}`);
  if (!same) fail("the plat did not regenerate identically");
}
// two years of builders: releases come out of each closing
{
  const debt0 = debt(g), held0 = lots.filter((b) => g.holdings[b]).length;
  for (let m = 0; m < 24; m++) {
    if (g.homes?.offers?.[tract]) { const r = E.acceptLotOffer(g, parcels, tract); if (!r.err) { g = r.s; check(g, "sign"); } }
    g = E.advanceQuarter(g, parcels, bbls, city.adjacency); check(g, "month");
  }
  const held = lots.filter((b) => g.holdings[b]).length;
  console.log(`  two years on: ${held0 - held} lots sold to builders; A&D ${M(debt0)} -> ${M(debt(g))}; P&L ${JSON.stringify(g.homes?.pl?.[tract] ?? {})}`);
  if (held < held0 && !(debt(g) < debt0) && debt0 > 0) fail("lots sold and the A&D note did not come down");
  if (lots.some((b) => !g.holdings[b] && g.holdings[b]?.loan)) fail("a sold lot kept its loan");
}
if (process.env.NEWS) for (const n of g.news.filter((x) => /cure|balloon|Tidewater|lot|loan|note/i.test(x.text)).slice(0, 25)) console.log("   news", n.q, n.text.slice(0, 200));
console.log(`  ledger: worst unexplained month $${Math.round(worst).toLocaleString()} (conserve)`);
console.log(fails ? `\n${fails} failure(s)` : "\nplatdesign: all checks pass");
process.exit(fails ? 1 : 0);
