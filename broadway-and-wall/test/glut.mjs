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
// No "natural" vacancy to be under or over (owner, 2026-11-07): the pencil
// falls as the vacancy the scheme opens into rises — lower occupancy and a
// longer lease-up at the market's own lettings — every step of the way, and a
// deep glut is well under half of a tight market.
{
  const g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const at = (vac) => { const e = structuredClone(g.econ); e.cityVac.office = vac; return { p: E.devPencils(e, "office"), f: E.forwardVacancy(e, "office") }; };
  const pts = [0.03, 0.06, 0.09, 0.12, 0.16, 0.20, 0.25, 0.30, 0.35].map(at);
  let mono = true;
  for (let i = 1; i < pts.length; i++) if (!(pts[i].f >= pts[i - 1].f && pts[i].p < pts[i - 1].p)) mono = false;
  ok(mono, `the pencil falls monotonically in forward vacancy: ${pts.map((x) => `${(x.f * 100).toFixed(0)}%:${x.p.toFixed(2)}`).join(" ")}`);
  const tight = pts[0].p, glut = pts[pts.length - 1].p;
  ok(glut < tight * 0.5, `a deep glut (${(pts[pts.length - 1].f * 100).toFixed(0)}% forward) pencils under half a tight market (${glut.toFixed(3)} vs ${tight.toFixed(3)})`);
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
