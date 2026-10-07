// MDGA instrument — WHERE DOES BUILDING PAY? (MDGA_PLAN.md, F2)
// Every ten years, for a third of the vacant lots: the best scheme's finished
// value over its build cost (land excluded), its distribution, the share that
// clears the developer margin, and the split by location (demand < 40 / >= 40).
//   pnpm engine && node tools/mdga/feasibility.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(Number(process.env.SEED ?? 7919), parcels), parcels, bbls);
const USES = ["multifamily", "office", "retail", "industrial"];
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN;
const DEV_MARGIN = E.DEV_MARGIN ?? 0.15;
const row = () => {
  const r = [], whyUse = {}, dem = { lo: [], hi: [] };
  const vac = bbls.filter((b) => E.resolveRec(parcels, g, b)?.class === "land");
  for (let i = 0; i < vac.length; i += 3) {
    const b = vac[i];
    const rec = E.resolveRec(parcels, g, b);
    let best = 0, bu = "";
    for (const use of USES) {
      if (E.zoneUseBar(rec, use, g.econ)) continue;
      const cov = E.MAX_COVERAGE[use] ?? 0.7;
      const maxFl = E.maxFloorsFor(rec, cov, use);
      for (const fl of [...new Set([1, 2, 3, 5, 8, maxFl])].filter((f) => f >= 1 && f <= maxFl)) {
        const p = E.planDevelopment(g, parcels, b, use, fl, cov, "gmp", undefined, undefined, undefined, 0.5, 1);
        if (!p) continue;
        const nonLand = p.basisTotal - p.landBasis - (p.landCarry ?? 0);
        const v = (p.stabNoi / (p.exitYield / 100)) / Math.max(1, nonLand);
        if (v > best) { best = v; bu = use; }
      }
    }
    if (!best) continue;
    r.push(best); whyUse[bu] = (whyUse[bu] ?? 0) + 1;
    (rec.demandScore >= 40 ? dem.hi : dem.lo).push(best);
  }
  r.sort((a, b) => a - b); dem.lo.sort((a, b) => a - b); dem.hi.sort((a, b) => a - b);
  const clear = 1 + DEV_MARGIN;
  return `yr ${String(g.month / 12).padStart(2)} | n ${r.length} | value/build-cost p10 ${pct(r, .1).toFixed(2)} p25 ${pct(r, .25).toFixed(2)} med ${pct(r, .5).toFixed(2)} p75 ${pct(r, .75).toFixed(2)} p90 ${pct(r, .9).toFixed(2)} | clears margin (>${clear.toFixed(2)}) ${(100 * r.filter((x) => x > clear).length / r.length).toFixed(1)}% | demand<40 med ${pct(dem.lo, .5).toFixed(2)} (n${dem.lo.length}) demand>=40 med ${pct(dem.hi, .5).toFixed(2)} (n${dem.hi.length}) | best use ${JSON.stringify(whyUse)}`;
};
console.log("DEV_MARGIN", DEV_MARGIN);
console.log(row());
for (let m = 1; m <= 600; m++) { g = E.advanceMonth(g, parcels, bbls, adjacency); if (g.gameOver) g = { ...g, gameOver: null, cash: 5e6 }; if (m % 120 === 0) console.log(row()); }
