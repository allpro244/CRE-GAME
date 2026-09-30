// SAME STATE, TWO ENGINES: what the one-envelope residual does to land prices.
//
//   OLD=/abs/old/.engine.mjs SEEDS=9001,9005,9006 MONTHS=60,180 node tools/envelope-move.mjs
//
// The state is advanced on the OLD engine and every lot is priced by both
// (`landValue` on `resolveRec`), so any difference is the pricing rule alone.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const O = await import(process.env.OLD);
const N = await import(join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, O.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "9001,9005,9006").split(",").map(Number);
const MONTHS = (process.env.MONTHS ?? "60,180").split(",").map(Number);
const q = (xs, p) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * p)] : NaN; };
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = O.firstListings(O.newGame(seed, parcels), parcels, bbls);
  let m = 0;
  for (const M of MONTHS) {
    while (m < M) { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; g = O.advanceMonth(g, parcels, bbls, adjacency); m++; }
    const ratios = [], po = [], pn = [];
    let moved = 0, up = 0, n = 0;
    for (const bbl of bbls) {
      const ro = O.resolveRec(parcels, g, bbl), rn = N.resolveRec(parcels, g, bbl);
      if (!ro || !(ro.lotArea > 0)) continue;
      const a = O.landValue(ro, g.econ) / ro.lotArea, b = N.landValue(rn, g.econ) / rn.lotArea;
      n++; po.push(a); pn.push(b);
      if (Math.abs(b / a - 1) > 0.005) { moved++; ratios.push(b / a); if (b > a) up++; }
    }
    console.log(`seed ${seed} m${M}: ${moved} of ${n} lots moved (${up} up); moved lots new/old p10 ${q(ratios, .1).toFixed(3)} p50 ${q(ratios, .5).toFixed(3)} p90 ${q(ratios, .9).toFixed(3)}; city $/sf median ${q(po, .5).toFixed(1)} -> ${q(pn, .5).toFixed(1)}, p90 ${q(po, .9).toFixed(1)} -> ${q(pn, .9).toFixed(1)}`);
  }
}
