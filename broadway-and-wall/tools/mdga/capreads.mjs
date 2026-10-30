// MDGA instrument — CAP AND LAND READS, year to year (PROOF.md #6).
// A 50-year run with no player per seed: the mean absolute year-on-year change
// of each class's cap read (pp) and of the land level (|log| change), plus the
// fitted grid's condition coefficient. OUT=file.json also dumps every print.
//   pnpm engine && SEEDS=22,55 YEARS=50 node tools/mdga/capreads.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "22,55").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 50);
const K = ["office", "retail", "multifamily", "industrial"];
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const dump = {};
for (const seed of SEEDS) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  g = { ...g, cash: 6e6 };
  const yr = []; const prints = []; const seen = new Set(); const condB = Object.fromEntries(K.map((k) => [k, []]));
  for (let m = 1; m <= YEARS * 12; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    for (const p of g.capTape ?? []) { const key = `${p.m}|${p.bbl}|${p.kind}|${p.c}`; if (!seen.has(key)) { seen.add(key); prints.push(p); } }
    for (const k of K) if (g.econ.capFit?.[k]) condB[k].push(g.econ.capFit[k][1]);
    if (m % 12 === 0) yr.push({ cap: { ...g.econ.capRate }, land: g.econ.landIdx });
  }
  const out = { seed };
  for (const k of K) {
    const d = yr.slice(2).map((y, i) => Math.abs(y.cap[k] - yr[i + 1].cap[k]));
    const dlk = yr.slice(2).map((y, i) => Math.abs(Math.log(y.cap[k] / yr[i + 1].cap[k])));
    out[k] = { dYr: +mean(d).toFixed(2), dLog: +mean(dlk).toFixed(3), p90: +[...d].sort((a, b) => a - b)[Math.floor(d.length * 0.9)].toFixed(2), level: +med(yr.map((y) => y.cap[k])).toFixed(2), condB: +med(condB[k]).toFixed(2) };
  }
  const dl = yr.slice(2).map((y, i) => Math.abs(Math.log(y.land / yr[i + 1].land)));
  out.land = { dLogYr: +mean(dl).toFixed(3), maxRatio: +Math.exp(Math.max(...dl)).toFixed(2), level: +med(yr.map((y) => y.land)).toFixed(3) };
  out.printsPerYr = Object.fromEntries(K.map((k) => [k, +(prints.filter((p) => p.k === k).reduce((a, p) => a + p.w, 0) / YEARS).toFixed(1)]));
  console.log(JSON.stringify(out));
  dump[seed] = { prints, yr };
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(dump));
