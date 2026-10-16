// THE TAPE AND THE DESK CROSS TOGETHER.
//
// The land market's builder residual (`landRead` → `residualScheme`: what a
// builder can pay for a foot of dirt after cost, carry and margin) and the
// Develop desk (`planDevelopment`, whose hurdle is yield on cost over the
// required yield) are the same pro forma asked from two ends. Buy the lot at
// exactly the residual, plan the residual's own scheme, and the desk must read
// breakeven: hurdle 1.0. Anything else means the PENCILS chip on the tape and
// the desk it opens are pricing two different buildings.
//
// Measured before they shared `developmentProForma` (proforma.ts): 867 lots,
// hurdle p05 0.81 / p50 1.10 / p95 1.54, 13% within ±3%. This holds every
// sampled lot with a positive residual to ±3%.
//
//   pnpm engine && node test/residual-recon.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);

// FOUR MARKETS AT THREE DATES. Housing wins the residual on nearly every
// vacant lot that pencils, so two markets at two dates passed the "more than
// one use" guard on a single retail lot (158 lots: 157 flats, 1 shop) and
// failed it outright once street plan 4 recut the reference town (280 flats).
// The identity is only worth asking of every use the residual can choose:
// this sample reaches all four (764 lots, about a minute).
// ...and it drifted back to one: by Oct 2026 the four markets at three dates
// gave 827 flats and a single shop, and smoothing the height premium
// (value.ts heightPremium) took the shop. Six markets at four dates reach
// flats, offices and warehouses (1,514 lots, measured), so the identity is
// asked of three uses again rather than of whichever lot happens to win.
const SEEDS = (process.env.SEEDS ?? "550991,12007,11,7919,4242,9001").split(",").map(Number);
const MONTHS = (process.env.MONTHS ?? "0,72,144,216").split(",").map(Number);
const TOL = 0.03;

console.log("\nRESIDUAL RECON — a lot bought at its builder residual plans at hurdle 1.0\n");
const hs = [];
const uses = {};
let worst = { dev: 0, what: "" };
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  let m = 0;
  for (const M of MONTHS) {
    while (m < M) { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; g = E.advanceMonth(g, parcels, bbls, adjacency); m++; }
    for (const bbl of bbls) {
      const rec = E.resolveRec(parcels, g, bbl);
      if (!rec || rec.class !== "land" || !(rec.lotArea > 0) || g.developments?.[bbl]) continue;
      // THE BUILD-NOW RESIDUAL. Since round 13 the land market prices a lot's
      // residual at the date its turn in the redevelopment queue comes
      // (value.ts `queueFactor`), so the tape sits under the build-now
      // residual on lots behind better sites — and a builder who CAN build
      // today on that dirt clears above 1.0, which is the economics, not a
      // disagreement. The identity this file protects is the pro forma
      // algebra, so it is asked of the build-now residual: the queue's
      // positions are emptied, its absorption rate (which the desk's lease-up
      // also reads) is kept, and both ends run one pro forma.
      // Both queue reads are emptied — this year's and the one it is gliding
      // from (value.ts queueFactor blends them over the year); emptying only
      // this year's left last year's wait on a few big office schemes.
      const emptyQ = (Q) => Object.fromEntries(Object.entries(Q ?? {}).map(([u, q]) => [u, { ...q, psf: [], ahead: [] }]));
      const nowEcon = { ...g.econ, landQueue: emptyQ(g.econ.landQueue), landQueuePrev: emptyQ(g.econ.landQueuePrev) };
      const sc = E.landRead(rec, nowEcon).scheme;
      if (!sc || !(sc.psf > 0)) continue;
      // The scheme is the desk's own dials. (`coverage` is new with the
      // reconciliation; before it the residual built at usable/floors.)
      const cov = sc.coverage ?? sc.usable / sc.floors;
      // AT THE AVERAGE BID. Every job carries its own construction draw
      // (dev.ts projectCostMult: the contractor's book that season, re-drawn
      // every term), and the land market cannot see a builder's quote before
      // it is struck — it prices the average. Measured: with the draw in, the
      // desk's non-land cost ran 0.78-1.29x the tape's on the same scheme
      // while value matched to the dollar, so the identity is asked at the
      // average bid (costMult 1), which is what the tape prices.
      const plan = E.planDevelopment(g, parcels, bbl, sc.use, sc.floors, cov, "gmp",
        undefined, { costMult: 1 }, undefined, 0.5, sc.psf * rec.lotArea);
      const h = plan ? plan.hurdleRatio : NaN;
      hs.push(h);
      uses[sc.use] = (uses[sc.use] ?? 0) + 1;
      const dev = Number.isFinite(h) ? Math.abs(h - 1) : Infinity;
      if (dev > worst.dev) worst = { dev, what: `seed ${seed} m${M} ${bbl} ${sc.use} ${sc.floors}fl @${(cov * 100).toFixed(0)}% residual $${sc.psf.toFixed(0)}/sf → hurdle ${Number.isFinite(h) ? h.toFixed(3) : "no plan"}` };
    }
  }
}
const q = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const ok = hs.filter(Number.isFinite);
const inside = ok.filter((h) => Math.abs(h - 1) <= TOL).length;
console.log(`  ${hs.length} lots with a positive residual (${Object.entries(uses).map(([k, v]) => `${k} ${v}`).join(", ")})`);
if (ok.length) console.log(`  hurdle p05 ${q(ok, .05).toFixed(3)}  p50 ${q(ok, .5).toFixed(3)}  p95 ${q(ok, .95).toFixed(3)}  — ${inside} of ${hs.length} within ±${TOL * 100}%`);
console.log(`  worst: ${worst.what || "—"}`);
let bad = 0;
// A test that samples nothing cannot fail. Demand a real population and more
// than one use, or the identity is being asked of nobody.
if (hs.length < 40 || Object.keys(uses).length < 2) {
  console.log(`  FAIL  sampled ${hs.length} lots across ${Object.keys(uses).length} uses — too few to mean anything`);
  bad++;
}
if (inside !== hs.length) {
  console.log(`  FAIL  ${hs.length - inside} lots outside ±${TOL * 100}% — the tape and the desk disagree`);
  bad++;
}
if (bad) process.exit(1);
console.log("  OK    the residual and the desk are one pro forma\n");
