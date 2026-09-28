// WHAT ONE COVERAGE LIMIT PER USE DID TO THE PRICE OF DIRT — same state, two engines.
//
// Runs the OLD engine forward to each sample month, then asks both engines to
// price every lot in the city on that identical state: `landRead` (the three
// bids and the winner) and `landValue` (the price the tape and the books use).
// Same state, so the difference is the rule change and nothing else — no
// re-rolled rng path, no different city. See ECONOMY.md, "One coverage limit".
//
//   OLD=/path/to/old/engine.mjs node tools/coverage-move.mjs
//   SEEDS=550991,12007,73303 MONTHS=60,180 ...
const OLD = await import(process.env.OLD);
const NEW = await import(process.env.NEW ?? "../test/.engine.mjs");
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, OLD.normalizeParcels);

const SEEDS = (process.env.SEEDS ?? "550991,12007,73303").split(",").map(Number);
const MONTHS = (process.env.MONTHS ?? "60,180").split(",").map(Number);
const q = (a, p) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };

const all = { ratio: [], oldPsf: [], newPsf: [], moved: 0, n: 0, winOld: {}, winNew: {}, useFlip: {} };
const byWinnerUse = {};
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = OLD.firstListings(OLD.newGame(seed, parcels), parcels, bbls);
  let m = 0;
  for (const M of MONTHS) {
    while (m < M) { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; g = OLD.advanceMonth(g, parcels, bbls, adjacency); m++; }
    for (const bbl of bbls) {
      const rec = OLD.resolveRec(parcels, g, bbl);
      if (!rec || !(rec.lotArea > 0)) continue;
      const a = OLD.landValue(rec, g.econ) / rec.lotArea;
      const b = NEW.landValue(rec, g.econ) / rec.lotArea;
      const ra = OLD.landRead(rec, g.econ), rb = NEW.landRead(rec, g.econ);
      all.n++;
      all.oldPsf.push(a); all.newPsf.push(b);
      if (a > 0) all.ratio.push(b / a);
      if (Math.abs(b - a) > 0.005 * Math.max(1, a)) all.moved++;
      all.winOld[ra.winner] = (all.winOld[ra.winner] ?? 0) + 1;
      all.winNew[rb.winner] = (all.winNew[rb.winner] ?? 0) + 1;
      const ua = ra.winner === "builder" ? ra.scheme?.use : ra.winner;
      const ub = rb.winner === "builder" ? rb.scheme?.use : rb.winner;
      if (ua !== ub) all.useFlip[`${ua}->${ub}`] = (all.useFlip[`${ua}->${ub}`] ?? 0) + 1;
      const k = ua;
      (byWinnerUse[k] ??= []).push(a > 0 ? b / a : NaN);
    }
  }
}
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");
console.log(`\nCOVERAGE MOVE — same state, old vs new engine, ${SEEDS.length} seeds x months ${MONTHS.join("/")}, ${all.n} lot-reads\n`);
console.log(`  land $/sf  old p10 ${f(q(all.oldPsf, .1), 1)} med ${f(q(all.oldPsf, .5), 1)} p90 ${f(q(all.oldPsf, .9), 1)}`);
console.log(`             new p10 ${f(q(all.newPsf, .1), 1)} med ${f(q(all.newPsf, .5), 1)} p90 ${f(q(all.newPsf, .9), 1)}`);
console.log(`  new/old per lot: p10 ${f(q(all.ratio, .1))} med ${f(q(all.ratio, .5))} p90 ${f(q(all.ratio, .9))} p99 ${f(q(all.ratio, .99))}; moved >0.5% on ${all.moved} (${(all.moved / all.n * 100).toFixed(1)}%)`);
console.log(`  winner old ${JSON.stringify(all.winOld)}  new ${JSON.stringify(all.winNew)}`);
console.log(`  price-setter flips (builder use or bid kind): ${JSON.stringify(all.useFlip)}`);
for (const [k, r] of Object.entries(byWinnerUse)) {
  const mv = r.filter((x) => Math.abs(x - 1) > 0.005).length;
  console.log(`  old price-setter ${String(k).padEnd(12)} n ${String(r.length).padStart(6)}  new/old med ${f(q(r, .5))} p90 ${f(q(r, .9))}  moved ${mv}`);
}
