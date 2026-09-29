// WHAT DRAWING EACH USE ON ITS OWN PLATE DID — same state, then paired runs.
//
// `cityCoverage` (dev.ts) replaced a flat 0.62 site coverage in the pencil
// sampler and every autonomous start path. Two questions, two instruments:
//
//   SAME STATE — run the OLD engine to each sample month, then ask both
//   engines for `sitePencil` on that identical state (refreshDevelopmentFeasibility
//   on a clone). Only the rule differs. Land prices are not re-asked: no
//   pricing function reads the city's plate, so `landRead` is identical on
//   identical state by construction, and every land move in the baseline is
//   second-order — through what got built.
//
//   PAIRED — the baseline's own city and seeds, each run forward on both
//   engines to month 300, per-seed values side by side, so a move can be read
//   as "n of 6 seeds, same sign" rather than off one median.
//
//   OLD=/path/to/old/engine.mjs node tools/plate-move.mjs
//   (build OLD by setting cityCoverage to return 0.62 and running mkengine)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const OLD = await import(process.env.OLD);
const NEW = await import(process.env.NEW ?? join(HERE, "..", "test", ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,4242,91117,20603").split(",").map(Number);
const MONTHS = +(process.env.MONTHS ?? 300);
const SAME_AT = (process.env.SAME_AT ?? "60,180,300").split(",").map(Number);
const U = ["office", "retail", "industrial", "multifamily"];
const fresh = (E) => {
  const b = makeCity("somewhere", 1);
  E.normalizeParcels(b.parcels);
  return { parcels: b.parcels, adjacency: b.adjacency, bbls: Object.keys(b.parcels) };
};
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");

// ---- same state
console.log(`\nSAME STATE — sitePencil on the old engine's state, ${SEEDS.length} seeds x months ${SAME_AT.join("/")}`);
const cnt = { old: {}, new: {} };
let reads = 0;
for (const seed of SEEDS) {
  const c = fresh(OLD);
  let g = OLD.firstListings(OLD.newGame(seed, c.parcels), c.parcels, c.bbls);
  let m = 0;
  for (const M of SAME_AT) {
    while (m < M) { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; g = OLD.advanceMonth(g, c.parcels, c.bbls, c.adjacency); m++; }
    reads++;
    for (const [name, E] of [["old", OLD], ["new", NEW]]) {
      const s = structuredClone(g);
      s.month = Math.ceil(s.month / 12) * 12;   // the refresh runs on the annual tick
      delete s.econ.sitePencil;
      E.refreshDevelopmentFeasibility(s, c.parcels, c.bbls);
      for (const k of U) if ((s.econ.sitePencil?.[k] ?? 0) > 0) cnt[name][k] = (cnt[name][k] ?? 0) + 1;
    }
  }
}
for (const k of U) console.log(`  ${k.padEnd(12)} pencil > 0 in  old ${cnt.old[k] ?? 0}/${reads}   new ${cnt.new[k] ?? 0}/${reads}`);

// ---- paired
function run(E, seed) {
  const c = fresh(E);
  let g = E.firstListings(E.newGame(seed, c.parcels), c.parcels, c.bbls);
  const acc = { owedMonths: {}, vac: {}, rent: {} };
  let n = 0;
  for (let m = 0; m < MONTHS; m++) {
    g = E.advanceQuarter(g, c.parcels, c.bbls, c.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    for (const k of U) if ((g.econ.startOwed?.[k] ?? 0) > 0) acc.owedMonths[k] = (acc.owedMonths[k] ?? 0) + 1;
    if (m >= MONTHS - 120) {
      n++;
      for (const k of U) { acc.vac[k] = (acc.vac[k] ?? 0) + g.econ.cityVac[k]; acc.rent[k] = (acc.rent[k] ?? 0) + g.econ.rentIdx[k] / (g.econ.cpi ?? 1); }
    }
  }
  const row = {};
  for (const k of U) {
    row[`owed>0.${k}`] = (acc.owedMonths[k] ?? 0) / MONTHS;
    row[`vac.${k}`] = acc.vac[k] / n;
    row[`realRent.${k}`] = acc.rent[k] / n;
    row[`stock.${k}`] = (g.econ.stock?.[k] ?? 0) / 1e6;
  }
  return row;
}
console.log(`\nPAIRED — baseline city and seeds, ${MONTHS} months; vac and real rent are last-120-month means, stock at the end (M sf)`);
const rows = [];
for (const seed of SEEDS) rows.push({ seed, old: run(OLD, seed), new: run(NEW, seed) });
for (const key of Object.keys(rows[0].old)) {
  const d = rows.map((r) => r.new[key] - r.old[key]);
  const up = d.filter((x) => x > 1e-9).length, dn = d.filter((x) => x < -1e-9).length;
  const sd = [...d].sort((a, b) => a - b);
  console.log(`  ${key.padEnd(24)} old ${rows.map((r) => f(r.old[key])).join(" ")}\n  ${"".padEnd(24)} new ${rows.map((r) => f(r.new[key])).join(" ")}   up ${up} down ${dn}  median Δ ${f(sd[Math.floor((sd.length - 1) / 2)])}`);
}
