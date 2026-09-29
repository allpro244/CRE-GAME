// THE LAND MARKET SEES THE LOW-RISE SCHEMES THE DESK CAN DRAW.
//
// On a small fringe lot the building that pencils, if any does, is a one-
// storey box or a walk-up: no lift below five storeys on a small plate, no
// stair at all on one (value.ts, `verticalCoreSf`). The Develop desk could
// always draw those; the land residual only asked 8 / 14 / envelope storeys
// of office and flats and the two-storey cap of shops and sheds. So on 41 of
// 721 vacant 3-8k sf lots (two seeds, year 10, tools/smalllot-lines.mjs) the
// desk found a scheme with a positive residual where the tape said no
// builder would bid — one quantity, two answers, CLAUDE.md fake #3.
//
// This asks the desk, at the residual's own coverage and envelope, for every
// zoning-legal use at 1, 2 and 4 storeys, and requires the engine's builder
// bid to be at least what the best of them can pay for the dirt.
//
//   pnpm engine && node test/small-lot-rungs.mjs
import { assertFreshBundle } from "./fresh.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
if (!process.env.ENGINE) assertFreshBundle();
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const SEEDS = (process.env.SEEDS ?? "550991,12007").split(",").map(Number);
const MONTHS = (process.env.MONTHS ?? "0,72").split(",").map(Number);
const USES = ["office", "multifamily", "retail", "industrial"];

console.log("\nSMALL-LOT RUNGS — the residual prices the one-to-four storey schemes the desk can build\n");
let lots = 0, lowWins = 0, bad = 0, worst = { gap: 0, what: "" };
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  let m = 0;
  for (const M of MONTHS) {
    while (m < M) { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; g = E.advanceMonth(g, parcels, bbls, adjacency); m++; }
    for (const bbl of bbls) {
      const rec = E.resolveRec(parcels, g, bbl);
      if (!rec || rec.class !== "land" || !(rec.lotArea > 0) || rec.lotArea > 8_000 || g.developments?.[bbl]) continue;
      const far = E.farMaxFor(rec) * E.envelopeRealisation(rec) * Math.min(1, Math.max(0.15, g.econ.infillShare ?? 1));
      let desk = -Infinity, deskWhat = "";
      for (const use of USES) {
        if (!E.zonePermits(rec.zoneDist, use, rec.demandScore, g.econ)) continue;
        for (const fl of [1, 2, 4]) {
          if ((use === "retail" || use === "industrial") && fl > 2) continue;
          // The use's own coverage limit — the one the desk and the residual share.
          const cov = Math.min(far, fl * E.MAX_COVERAGE[use]) / fl;
          if (!(cov > 0)) continue;
          const p = E.planDevelopment(g, parcels, bbl, use, fl, cov, "gmp", undefined, undefined, undefined, 0.5, 0);
          if (!p || !(p.requiredYield > 0) || p.floors !== fl) continue;
          const nonLand = p.basisTotal - p.landBasis - p.landCarry;
          const psf = (p.stabNoi / (p.requiredYield / 100) - nonLand) / (1 + E.landCarryFactor(p.months)) / rec.lotArea;
          if (psf > desk) { desk = psf; deskWhat = `${use} ${fl}fl @${(cov * 100).toFixed(0)}%`; }
        }
      }
      if (!(desk > 0)) continue;
      lots++;
      const read = E.landRead(rec, g.econ);
      if (read.scheme && read.scheme.floors <= 4) lowWins++;
      // The desk quotes its own lender file; the residual the market's. ±3% is
      // the tolerance residual-recon already holds the two to.
      const gap = desk - Math.max(0, read.builder) * 1.03;
      if (gap > 0.5) {
        bad++;
        if (gap > worst.gap) worst = { gap, what: `seed ${seed} m${M} ${bbl} lot ${rec.lotArea} ${rec.zoneDist}: desk ${deskWhat} pays $${desk.toFixed(0)}/sf, tape's builder bids $${read.builder.toFixed(0)}/sf` };
      }
    }
  }
}
console.log(`  ${lots} small lots where a one-to-four storey scheme can pay for its dirt; the residual's own winner is low-rise on ${lowWins}`);
if (worst.what) console.log(`  worst: ${worst.what}`);
if (lots < 20) { console.log(`  FAIL  only ${lots} lots sampled — the identity is being asked of nobody`); process.exit(1); }
if (bad) { console.log(`  FAIL  on ${bad} of them the tape's builder bids less than the desk's low-rise scheme can pay`); process.exit(1); }
console.log("  OK    the tape prices every low-rise scheme the desk can draw\n");
