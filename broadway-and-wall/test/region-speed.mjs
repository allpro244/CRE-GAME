// REGION SPEED: month ticks on the 6 km region (seed 1).  M=36 pnpm -s exec node test/region-speed.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity, REGION } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));
const city = makeCity(REGION, 1);
const parcels = city.parcels, bbls = Object.keys(parcels);
E.normalizeParcels(parcels);
let g = E.firstListings(E.newGame(1, parcels, undefined, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
const M = Number(process.env.M ?? 36); const t0 = performance.now(); const ts = [];
for (let m = 0; m < M; m++) { const t = performance.now(); g = E.advanceQuarter(g, parcels, bbls, city.adjacency); ts.push(performance.now() - t); if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; }
ts.sort((a,b)=>a-b);
console.log(`${M} months: mean ${((performance.now()-t0)/M).toFixed(0)} ms, median ${ts[M>>1].toFixed(0)}, max ${ts[M-1].toFixed(0)}`);
