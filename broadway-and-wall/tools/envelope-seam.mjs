// ONE LOT, TWO ENVELOPES? — the land residual's scheme against the height the
// city's shovel gets on the same lot (`cityInfillCap`).
//
//   pnpm engine && SEEDS=9001,9005 MONTHS=120,216 node tools/envelope-seam.mjs
//
// For every vacant lot with a positive builder residual: the residual's
// floors, the cap for its use on that lot, and — where the residual is taller
// — what the city/rival start path's own plan (floors cut to the cap) reads at
// a land basis of the residual.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? (process.env.ENGINE.startsWith("/") ? process.env.ENGINE : join(HERE, "..", process.env.ENGINE)) : join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "9001,9005").split(",").map(Number);
const MONTHS = (process.env.MONTHS ?? "120,216").split(",").map(Number);
const q = (xs, p) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * p)] : NaN; };
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  let m = 0;
  for (const M of MONTHS) {
    while (m < M) { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; g = E.advanceMonth(g, parcels, bbls, adjacency); m++; }
    let n = 0, taller = 0, shorter = 0, equal = 0;
    const hTall = [], hEq = [];
    const byUse = {};
    for (const bbl of bbls) {
      const rec = E.resolveRec(parcels, g, bbl);
      if (!rec || rec.class !== "land" || !(rec.lotArea > 0) || g.developments?.[bbl]) continue;
      const read = E.landRead(rec, g.econ);
      const sc = read.scheme;
      if (!sc || !(sc.psf > 0)) continue;
      n++;
      const cap = E.cityInfillCap(g, parcels, rec, Math.min(1, g.month / 780), sc.use);
      const plan = (fl) => E.planDevelopment(g, parcels, bbl, sc.use, fl, sc.coverage, "gmp", undefined, undefined, undefined, 0.5, sc.psf * rec.lotArea);
      if (sc.floors > cap) {
        taller++;
        byUse[sc.use] = (byUse[sc.use] ?? 0) + 1;
        const p = plan(cap);
        if (p) hTall.push(p.hurdleRatio);
      } else {
        if (sc.floors < cap) shorter++; else equal++;
        const p = plan(sc.floors);
        if (p) hEq.push(p.hurdleRatio);
      }
    }
    console.log(`seed ${seed} m${M} infillShare ${g.econ.infillShare}: ${n} lots with a builder bid; residual taller than the cap on ${taller} (${JSON.stringify(byUse)}), at/below on ${equal}/${shorter}`);
    console.log(`   hurdle at the residual, capped to the city's height: p10 ${q(hTall, .1).toFixed(3)} p50 ${q(hTall, .5).toFixed(3)} p90 ${q(hTall, .9).toFixed(3)} | uncapped lots p50 ${q(hEq, .5).toFixed(3)}`);
  }
}
