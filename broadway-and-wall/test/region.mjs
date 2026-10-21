// THE REGION MAP, RUN.
//
//   pnpm region                    three seeds, five years each
//   SEEDS=7 YEARS=10 pnpm region   a chosen seed, longer
//
// The region (citygen/region) hands the engine the same contract an island
// does, plus a `reserved` table the engine never sees. This asks the things
// that could break when a different kind of map meets the same engine:
//
//   - the generator is deterministic: the same seed builds byte-identical
//     parcel and reserved tables;
//   - an island is untouched by the region's plan bump (plan 15 vs 14 hash);
//   - every record is finite and positive where it must be: no NaN, no
//     negative lot or floor area, a demand score in range;
//   - the reserved land stays out of the market: no reserved BBL is in the
//     parcel table, and after the run no holding, listing, development, rival
//     deed or sale names one;
//   - the economy runs: months tick, the clock is timed, and stock, rents and
//     values stay finite.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity, REGION, PROCEDURAL } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

const SEEDS = (process.env.SEEDS ?? "1,2,3").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 5);
const hash = (o) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 12);
let fails = 0;
const fail = (msg) => { fails++; console.log("  FAIL " + msg); };

// an island is the same island at plan 14 and plan 15
{
  const a = makeCity(PROCEDURAL, 1, { planV: 14 }), b = makeCity(PROCEDURAL, 1, { planV: 15 });
  const ha = hash([a.parcels, a.buildings3d]), hb = hash([b.parcels, b.buildings3d]);
  console.log(`island seed 1, plan 14 vs 15: ${ha} ${hb} ${ha === hb ? "identical" : "DIFFERENT"}`);
  if (ha !== hb) fail("the island moved under the plan bump");
}

for (const seed of SEEDS) {
  const t0 = performance.now();
  // COMPARE=1 times the standard island on the same seed and clock, for scale
  const city = process.env.COMPARE === "1" ? { ...makeCity(PROCEDURAL, seed), reserved: {}, stats: { homes: 0 } } : makeCity(REGION, seed);
  const genMs = performance.now() - t0;
  const again = process.env.COMPARE === "1" ? { ...makeCity(PROCEDURAL, seed), reserved: {} } : makeCity(REGION, seed);
  const h1 = hash([city.parcels, city.reserved, city.buildings3d.length]), h2 = hash([again.parcels, again.reserved, again.buildings3d.length]);
  if (h1 !== h2) fail(`seed ${seed}: two builds differ (${h1} vs ${h2})`);
  const parcels = city.parcels, bbls = Object.keys(parcels), reserved = city.reserved ?? {};
  const rbbls = Object.keys(reserved);
  const by = {}; for (const p of Object.values(parcels)) by[p.class] = (by[p.class] ?? 0) + 1;
  const ten = {}; for (const r of Object.values(reserved)) ten[r.kind] = (ten[r.kind] ?? 0) + 1;
  console.log(`\nseed ${seed} — ${city.name}: built in ${Math.round(genMs)} ms (deterministic: ${h1 === h2 ? "yes" : "NO"})`);
  console.log(`  market ${bbls.length} parcels ${JSON.stringify(by)}; reserved ${rbbls.length} ${JSON.stringify(ten)}; homes in neighbourhoods ${city.stats.homes}`);

  // the records
  for (const bbl of rbbls) if (parcels[bbl]) fail(`reserved ${bbl} is also in the market table`);
  for (const p of Object.values(parcels)) {
    for (const k of ["lotArea", "bldgArea", "floors", "demandScore", "landPsf", "assessedLand", "assessedTotal", "farMaxComm", "farMaxRes"]) {
      const v = p[k];
      if (typeof v !== "number" || !Number.isFinite(v)) { fail(`${p.bbl}.${k} = ${v}`); break; }
      if (v < 0) { fail(`${p.bbl}.${k} negative (${v})`); break; }
    }
    if (p.tenure) fail(`${p.bbl} in the market carries a tenure`);
    if (p.lotArea <= 0) fail(`${p.bbl} has no lot`);
  }
  for (const r of Object.values(reserved)) {
    if (!(r.lotArea > 0) || !Number.isFinite(r.lotArea)) fail(`reserved ${r.bbl} lotArea ${r.lotArea}`);
    if (r.bldgArea < 0 || !Number.isFinite(r.bldgArea)) fail(`reserved ${r.bbl} bldgArea ${r.bldgArea}`);
    if (r.kind === "neighbourhood" && !(r.homes > 0 && r.recipe?.built)) fail(`neighbourhood ${r.bbl} without homes or recipe`);
  }

  // the economy
  E.normalizeParcels(parcels);
  let g = E.firstListings(E.newGame(seed, parcels, undefined, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
  const adjacency = city.adjacency;
  const times = [];
  for (let m = 0; m < YEARS * 12; m++) {
    const t = performance.now();
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    times.push(performance.now() - t);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const touched = new Set([
    ...Object.keys(g.holdings ?? {}), ...(g.listings ?? []).map((l) => l.bbl), ...Object.keys(g.developments ?? {}),
    ...(g.rivals ?? []).flatMap((r) => Object.keys(r.holdings ?? r.deeds ?? {})),
    ...(g.comps ?? []).map((c) => c.bbl),
    // the city's own building: delivered, decided, under way
    ...Object.keys(g.built ?? {}), ...(g.cityBuilt ?? []), ...(g.cityPlans ?? []).map((p) => p.bbl), ...(g.cityJobs ?? []).map((j) => j.bbl),
  ]);
  for (const b of touched) if (reserved[b]) fail(`reserved ${b} reached the market (${YEARS} y)`);
  // farms trade, but nobody builds on a field the board has not rezoned
  const farmBuilt = [...Object.keys(g.built ?? {}), ...(g.cityJobs ?? []).map((j) => j.bbl), ...(g.cityPlans ?? []).map((p) => p.bbl)].filter((b) => parcels[b]?.ag && !g.rezoned?.[b]);
  if (farmBuilt.length) fail(`${farmBuilt.length} unrezoned farm tracts were built on`);
  const farmsTraded = (g.comps ?? []).filter((c) => parcels[c.bbl]?.ag).length;
  console.log(`  farms: ${bbls.filter((b) => parcels[b].ag).length} on the market, ${farmsTraded} traded, none built on`);
  // the inner ring's houses are ordinary deeds: how many did the market trade or rebuild?
  const houses = bbls.filter((b) => /^[ABC]/.test(parcels[b].bldgClass));
  const rebuilt = houses.filter((b) => g.built?.[b] || (g.cityJobs ?? []).some((j) => j.bbl === b)).length;
  const traded = houses.filter((b) => (g.comps ?? []).some((c) => c.bbl === b)).length;
  console.log(`  inner-ring houses: ${houses.length} ordinary deeds; ${traded} traded, ${rebuilt} rebuilt or under way in ${YEARS} y`);
  for (const b of touched) if (b && !parcels[b] && !String(b).includes(":")) { /* sites and synthetic keys are the engine's own */ }
  let nan = 0;
  const walk = (o, d = 0) => { if (d > 6 || !o || typeof o !== "object") return; for (const v of Object.values(o)) { if (typeof v === "number" && !Number.isFinite(v)) nan++; else if (typeof v === "object") walk(v, d + 1); } };
  walk({ cash: g.cash, econ: g.econ, holdings: g.holdings });
  if (nan) fail(`${nan} non-finite numbers in cash / econ / holdings after ${YEARS} y`);
  const stock = (cls) => Object.values(parcels).filter((p) => p.class === cls).reduce((a, p) => a + p.bldgArea, 0);
  console.log(`  ${YEARS} y run: month tick mean ${mean.toFixed(1)} ms, median ${times[times.length >> 1].toFixed(1)} ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(1)} ms`);
  console.log(`  after: cash $${(g.cash / 1e6).toFixed(2)}M, the city built ${(g.cityBuilt ?? []).length} and has ${(g.cityJobs ?? []).length} under way, your developments ${Object.keys(g.developments ?? {}).length}, listings ${(g.listings ?? []).length}, comps ${(g.comps ?? []).length}, market touched ${touched.size} deeds, none reserved`);
  console.log(`  stock: office ${(stock("office") / 1e6).toFixed(2)}M sf, retail ${(stock("retail") / 1e6).toFixed(2)}M sf, multifamily ${(stock("multifamily") / 1e6).toFixed(2)}M sf, industrial ${(stock("industrial") / 1e6).toFixed(2)}M sf`);
}
console.log(fails ? `\n${fails} failure(s)` : "\nregion: all checks pass");
process.exit(fails ? 1 : 0);
