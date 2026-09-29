// ONE LOT, ONE ENVELOPE — the land residual prices the building the city's
// height rule permits on THAT lot.
//
// The residual used to strike every lot on the town's median buildable share
// of the legal envelope (`infillShare`), while every autonomous start is held
// to the lot's own height cap (`cityInfillCap`: the block's cornice datum plus
// the market's push). Where the lot's comp set is short, the dirt was priced
// for more floors than anybody would be permitted to build, and its residual
// scheme — cut to the cap — planned at hurdle 0.93-0.99 at the land's own
// price: the same lot with two answers. On the old engine this fails on both
// seeds (11 and 3 lots).
//
//   pnpm engine && node test/one-envelope.mjs
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? (process.env.ENGINE.startsWith("/") ? process.env.ENGINE : join(HERE, "..", process.env.ENGINE)) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const SEEDS = (process.env.SEEDS ?? "9001,9005").split(",").map(Number);
const MONTH = +(process.env.MONTH ?? 216);
console.log("\nONE ENVELOPE — the residual's scheme fits the lot's own height cap\n");
let bad = 0, n = 0, over = 0;
const uses = {};
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let m = 0; m < MONTH; m++) { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; g = E.advanceMonth(g, parcels, bbls, adjacency); }
  let seedOver = 0;
  for (const bbl of bbls) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec || rec.class !== "land" || !(rec.lotArea > 0) || g.developments?.[bbl]) continue;
    const sc = E.landRead(rec, g.econ).scheme;
    if (!sc || !(sc.psf > 0)) continue;
    n++;
    uses[sc.use] = (uses[sc.use] ?? 0) + 1;
    // (the old engine's cityInfillCap took the maturity as an argument)
    const cap = E.townMaturity ? E.cityInfillCap(g, parcels, rec, sc.use) : E.cityInfillCap(g, parcels, rec, Math.min(1, g.month / 780), sc.use);
    if (sc.floors > cap) {
      seedOver++;
      const plan = E.planDevelopment(g, parcels, bbl, sc.use, cap, sc.coverage, "gmp", undefined, undefined, undefined, 0.5, sc.psf * rec.lotArea);
      if (seedOver <= 3) console.log(`    seed ${seed} ${bbl}: residual ${sc.use} ${sc.floors} fl, cap ${cap} → hurdle at the cap ${plan ? plan.hurdleRatio.toFixed(3) : "no plan"}`);
    }
  }
  over += seedOver;
  console.log(`  seed ${seed} month ${MONTH}: residual taller than the lot's height cap on ${seedOver} lots`);
}
console.log(`  ${n} builder-priced vacant lots (${Object.entries(uses).map(([k, v]) => `${k} ${v}`).join(", ")})`);
if (n < 40 || Object.keys(uses).length < 2) { console.log(`  FAIL  sampled ${n} lots across ${Object.keys(uses).length} uses — too few to mean anything`); bad++; }
if (over > 0) { console.log(`  FAIL  ${over} lots priced for more floors than the city permits on them`); bad++; }
if (bad) process.exit(1);
console.log("  OK    the land residual and the shovel read one height rule\n");
