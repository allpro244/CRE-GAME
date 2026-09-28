// A GLUT IS A PROPERTY EVENT, NOT A DEPRESSION.
//
//   pnpm engine && pnpm glut
//
// GATE. Harness seed 20603 sat in "depression" for twelve years with office
// vacancy at 30%: the local phase bled jobs at 1.2% a year while the nation
// expanded, and the pipeline delivered 78 buildings into the glut because
// the developer's pro forma assumed 90% occupancy whatever the market. The
// city lost 28% of its jobs and 22% of its people. Now the local phase's job
// drift runs at less than half its rate outside a national recession, and
// the pro forma reads the market's vacancy. Same seed after: jobs −7%,
// people −4%, office vacancy peaks at 21%.
//
// STANDING FACT: no playtest in this repo is based on Manhattan. Every
// harness run and number here is a GENERATED city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

// --- 1. the pro forma reads the market's vacancy ----------------------------
{
  const g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const at = (vac) => { const e = structuredClone(g.econ); e.cityVac.office = vac; return E.devPencils(e, "office"); };
  const nat = E.NATURAL_VAC.office;
  const base = at(nat), mild = at(nat * 1.4), glut = at(nat * 3), worse = at(nat * 4);
  ok(Math.abs(mild / base - 1) < 0.01, `up to 1.4× natural vacancy the pencil is untouched (${base.toFixed(3)} → ${mild.toFixed(3)})`);
  ok(glut < base * 0.5 && worse <= glut, `at 3× natural it is under half (${glut.toFixed(3)}); at 4× no better (${worse.toFixed(3)})`);
}

// --- 2. the local phase alone does not bleed a city out ---------------------
{
  // three towns, forced into "depression" with no national recession, two years on: jobs move less than a few per cent
  const moves = [];
  for (const seed of [12007, 11, 4242]) {
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    g = structuredClone(g); g.econ.phase = "depression"; g.econ.phaseMLeft = 36; if (g.econ.nat) { g.econ.nat.recM = 0; g.econ.nat.deep = false; }
    const j0 = g.econ.employIdx;
    for (let q = 0; q < 8; q++) { g = E.advanceQuarter(g, parcels, bbls, adjacency); if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; if (g.econ.nat) { g.econ.nat.recM = 0; g.econ.nat.deep = false; } }
    moves.push(g.econ.employIdx / j0 - 1);
  }
  const worst = Math.min(...moves);
  ok(worst > -0.05, `two years of local depression with the nation expanding: employment ${moves.map((x) => (x * 100).toFixed(1) + "%").join(", ")} (was about −2.4% a year on the phase alone)`);
}

// --- 3. the seed that started it ---------------------------------------------
{
  const built = (await import(join(HERE, "..", "src", "citygen", "index.mjs"))).makeCity;
  void built;
  let g = E.firstListings(E.newGame(20603, parcels), parcels, bbls);
  let peakJobs = g.econ.jobs, worstVac = 0;
  for (let q = 0; q < 100; q++) { g = E.advanceQuarter(g, parcels, bbls, adjacency); if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; peakJobs = Math.max(peakJobs, g.econ.jobs); worstVac = Math.max(worstVac, g.econ.cityVac.office); }
  ok(g.econ.jobs / peakJobs > 0.85, `seed 20603 twenty-five years on: jobs ${g.econ.jobs} against a peak of ${peakJobs} (${((g.econ.jobs / peakJobs - 1) * 100).toFixed(0)}%), office vacancy peaked at ${(worstVac * 100).toFixed(0)}% (was −28% and 30%)`);
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
