// HOW CROWDED IS THE TOP OF THE DEMAND SCALE?
//
//   node tools/demand-top.mjs                    three seeds, fifty years
//   SEEDS=1,2,3,4,5,6 YEARS=80 node tools/demand-top.mjs
//
// Owner: "it should be pretty hard to get from 80 demand to 100, too many
// sites have 100 demand at one given time, especially as the city gets built
// up." Prime is scarce by definition, so the share of the town at the top of
// the scale should stay small as the town grows — not inflate with it.
//
// Every decade, over every parcel, from the engine's own live reading
// (liveDemand — the same number rent, land and the map read):
//
//   =100 ≥90 ≥80     share of parcels at or above each line
//   p99 / median     the top and the middle of the distribution
//   raw>100          share whose generated score + block drift in plain
//                    points would exceed 100 — what the old clamp was holding
//   driftMean        lot-area-weighted mean of the emergent drift
//                    (blockD − blockA). The surface is meant to REDISTRIBUTE
//                    desirability, so this should sit near zero; a positive
//                    mean is the city-wide boom counted a second time.
//   poles            the hidden centres' fortunes, and their mean
//
// Two seeds' worth of noise either way is normal; read the decade trend.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const E = await import(process.env.ENGINE ?? join(ROOT, "test", ".engine.mjs"));
const { makeCity } = await import(join(ROOT, "src", "citygen", "index.mjs"));
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 50);

const rows = {};
for (const seed of SEEDS) {
  const b = makeCity("somewhere", 1, {});
  E.normalizeParcels(b.parcels);
  const bbls = Object.keys(b.parcels);
  let g = E.firstListings(E.newGame(seed, b.parcels), b.parcels, bbls);
  for (let m = 0; ; m++) {
    if (m % 120 === 0) {
      const ds = [];
      let raw100 = 0, dW = 0, aW = 0;
      for (const bbl of bbls) {
        const r = b.parcels[bbl];
        ds.push(E.liveDemand(g, r.demandScore, r.block));
        const dd = g.blockD?.[r.block] ?? 0;
        if (r.demandScore + dd > 100) raw100++;
        const a = Math.max(0, r.lotArea ?? 0);
        dW += a * (dd - (g.blockA?.[r.block] ?? 0));
        aW += a;
      }
      ds.sort((x, y) => x - y);
      const n = ds.length;
      const poles = (g.poles ?? []).map((p) => p.level);
      (rows[m / 12] ??= []).push({
        at100: ds.filter((d) => d >= 99.95).length / n,
        ge90: ds.filter((d) => d >= 90).length / n,
        ge80: ds.filter((d) => d >= 80).length / n,
        over: raw100 / n,
        p99: ds[Math.floor(0.99 * (n - 1))],
        med: ds[Math.floor(0.5 * (n - 1))],
        drift: aW > 0 ? dW / aW : 0,
        poleMean: poles.length ? poles.reduce((x, y) => x + y, 0) / poles.length : 0,
        poleMax: poles.length ? Math.max(...poles) : 0,
      });
    }
    if (m >= YEARS * 12) break;
    g = E.advanceQuarter(g, b.parcels, bbls, b.adjacency);
    // The frozen world: see CLAUDE.md.
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  }
}

const pc = (v) => `${(100 * v).toFixed(1)}%`.padStart(6);
const f = (v, w = 6) => v.toFixed(1).padStart(w);
console.log(`\nDEMAND AT THE TOP — ${SEEDS.length} seed(s), ${YEARS} years, mean over seeds\n`);
console.log("  year   =100    ≥90    ≥80  raw>100    p99  median  driftMean  poleMean  poleMax");
for (const [y, rs] of Object.entries(rows)) {
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  console.log(`  ${y.padStart(4)} ${pc(m("at100"))} ${pc(m("ge90"))} ${pc(m("ge80"))}  ${pc(m("over"))} ${f(m("p99"))} ${f(m("med"), 7)} ${f(m("drift"), 10)} ${f(m("poleMean"), 9)} ${f(m("poleMax"), 8)}`);
}
console.log("");
