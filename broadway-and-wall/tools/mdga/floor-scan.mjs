// MDGA instrument — DOES ONE MORE FLOOR MOVE THE PRO FORMA SMOOTHLY?
// Plans the same lot at every floor count and prints each line of the budget
// per gross foot, flagging any step in yield on cost bigger than STEP points.
//   pnpm engine && node tools/mdga/floor-scan.mjs
//   USE=multifamily FLOORS=60 STEP=0.15 node tools/mdga/floor-scan.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);
const USE = process.env.USE ?? "office";
const MAXF = Number(process.env.FLOORS ?? 50);
const STEP = Number(process.env.STEP ?? 0.15);
const g = E.firstListings(E.newGame(Number(process.env.SEED ?? 7919), parcels), parcels, bbls);
// the lot with the most room above it that permits the use
let best = null;
for (const b of bbls) {
  const rec = E.resolveRec(parcels, g, b);
  if (rec?.class !== "land" || !rec.lotArea || E.zoneUseBar(rec, USE, g.econ)) continue;
  const fl = E.maxFloorsFor(rec, E.MAX_COVERAGE[USE] ?? 0.7, USE);
  if (!best || fl > best.fl || (fl === best.fl && rec.lotArea > best.rec.lotArea)) best = { b, rec, fl };
}
console.log(`${USE} on ${best.b}: lot ${best.rec.lotArea} sf, envelope ${best.fl} floors`);
const cov = E.MAX_COVERAGE[USE] ?? 0.7;
let prev = null;
console.log(" fl |  YoC  | hard/sf | soft/sf | cont/sf | lease/sf | intRes/sf | NOI/sf | months | rate | ltc");
for (let fl = 1; fl <= Math.min(MAXF, best.fl); fl++) {
  const p = E.planDevelopment(g, parcels, best.b, USE, fl, cov, "gmp");
  if (!p) { console.log(`${String(fl).padStart(3)} | no plan`); continue; }
  const f = (n) => (n / p.sf).toFixed(1).padStart(7);
  const jump = prev && Math.abs(p.yieldOnCost - prev.yieldOnCost) > STEP ? "  <<< step" : "";
  console.log(`${String(fl).padStart(3)} | ${p.yieldOnCost.toFixed(2)} | ${f(p.hardCost)} | ${f(p.softCost)} | ${f(p.contingency)} | ${f(p.leaseUp)}  | ${f(p.interestReserve)}   | ${f(p.stabNoi)} | ${String(p.months).padStart(6)} | ${p.ratePct.toFixed(2)} | ${p.ltc.toFixed(2)}${jump}`);
  prev = p;
}
