// A FIRM WITH NOTHING LEFT IS NOT STILL ON THE STREET.
//
// A rival that has sold or handed back its last building holds no collateral,
// so whatever is still on `r.debt` is unsecured and gets called: paid out of
// the account, or — if the account cannot cover it — the firm goes onto the
// arrears calendar and is wound up. A solvent empty firm then gets two years
// to redeploy before the vehicle is wound up.
//
// Measured before (seed 22, no player): at year 38, 13 of 25 "live" firms held
// no building and still owed $1k-$501k, the retirement clock (`emptyMs`) was 0
// on every one of them because it needs a clear balance, and they sat with
// cash distributed down to the $2M working-reserve floor — so the street's
// median equity read $2.00-2.02M for the last twelve years of the run. A
// statistic measuring a floor. On the old engine this file fails 7 of 8.
//
// The last check (median off the floor) cannot fail inside 16 years on this
// seed — the floor only became the median after year 27 — and is kept as a
// guard for a longer YEARS=; the three street checks above it are
// the ones that catch the fault (782, 51 and 399 firm-months on the old engine).
//
//   pnpm engine && node test/rival-husks.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
console.log("\nRIVAL HUSKS — an empty book is paid off and wound up, not carried\n");

// 1. The mechanism, on one firm. Strip a firm's book, leave it a crumb of debt
//    and cash on the reserve floor, and run a month.
{
  let g = E.firstListings(E.newGame(12007, parcels, 2_500_000), parcels, bbls);
  const r = (g.rivals ?? []).find((x) => x.failedM === undefined && !(g.cityJobs ?? []).some((j) => j.firmId === x.id));
  r.bbls = []; r.debt = 48_000; r.cash = 2_010_000; r.stressMs = 0; r.basis = 1; r.extendedTo = {};
  const id = r.id;
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  const r1 = g.rivals.find((x) => x.id === id);
  check(r1.debt === 0, `the $48k crumb is called and repaid (debt now $${r1.debt.toLocaleString()})`);
  check(r1.cash < 2_010_000 - 40_000, `out of the account ($${(r1.cash / 1e6).toFixed(3)}M left)`);
  check((r1.emptyMs ?? 0) >= 1, `and the wind-up clock has started (emptyMs ${r1.emptyMs ?? 0})`);

  // A firm that cannot cover the call does not sit on the street with
  // negative equity: it is in arrears, and the calendar winds it up.
  let h = E.firstListings(E.newGame(12007, parcels, 2_500_000), parcels, bbls);
  const q = (h.rivals ?? []).find((x) => x.failedM === undefined && !(h.cityJobs ?? []).some((j) => j.firmId === x.id));
  q.bbls = []; q.debt = 900_000; q.cash = 300_000; q.stressMs = 0; q.basis = 1; q.extendedTo = {}; q.uncalled = 0;
  const qid = q.id;
  let gone = null;
  for (let m = 0; m < 24 && gone === null; m++) {
    h = E.advanceMonth(h, parcels, bbls, adjacency);
    if (h.gameOver) h = { ...h, gameOver: null, cash: 6e6 };
    const x = h.rivals.find((y) => y.id === qid);
    if (x.failedM !== undefined) gone = m + 1;
  }
  check(gone !== null && gone <= 16, `an insolvent shell is wound up on the arrears calendar (${gone ?? "never"} months)`);
}

// 2. The street, unplayed. Nobody may sit on the board with no building,
//    money still owed and cash in the bank, and the median firm may not be
//    the reserve floor.
{
  const SEED = Number(process.env.SEED ?? 22);
  const YEARS = Number(process.env.YEARS ?? 16);
  let g = E.firstListings(E.newGame(SEED, parcels, 5_000_000), parcels, bbls);
  let carried = 0, carriedWorst = "", negEmpty = 0, stuck = 0;
  const meds = [];
  const emptySince = {};
  const owedRun = {};
  for (let m = 0; m < YEARS * 12; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 5e6 };
    for (const r of g.rivals ?? []) {
      if (r.failedM !== undefined) { delete emptySince[r.id]; continue; }
      const building = (g.cityJobs ?? []).some((j) => j.firmId === r.id && !j.orphaned);
      if (r.bbls.length || building) { delete emptySince[r.id]; continue; }
      emptySince[r.id] ??= g.month;
      // One month is allowed: a deed that leaves by a path settled inside the
      // tick (a deed in lieu, a receiver) is paid off at the next one.
      if (r.debt > 0 && r.cash > 0) {
        owedRun[r.id] = (owedRun[r.id] ?? 0) + 1;
        if (owedRun[r.id] > 1) { carried++; carriedWorst = `${r.name} m${g.month} debt $${r.debt.toLocaleString()} cash $${r.cash.toLocaleString()}`; }
      } else delete owedRun[r.id];
      if (E.rivalEquity(E.markRival(g, parcels, r), r) < 0 && !(r.stressMs > 0)) negEmpty++;
      // Two years to redeploy, plus the arrears calendar for one that cannot
      // pay, plus a year for a new fund that has not yet called its capital.
      if (g.month - emptySince[r.id] > 24 + 14 + 12) stuck++;
    }
    if (g.month % 12 === 11) meds.push(E.streetStanding(g, parcels).medianRival);
  }
  const live = (g.rivals ?? []).filter((r) => r.failedM === undefined);
  const empty = live.filter((r) => !r.bbls.length);
  check(carried === 0, `no empty-book firm carries debt with cash in the bank past the next month (${carried} firm-months${carried ? `; e.g. ${carriedWorst}` : ""})`);
  check(negEmpty === 0, `no empty-book firm sits at negative equity outside arrears (${negEmpty} firm-months)`);
  check(stuck === 0, `no empty-book firm outlives its wind-up window (${stuck} firm-months)`);
  const late = meds.slice(-6);
  const onFloor = late.filter((x) => Math.abs(x - 2_000_000) < 30_000).length;
  check(onFloor <= 1, `the median firm is not the $2M reserve floor (last six Decembers: ${late.map((x) => (x / 1e6).toFixed(2)).join(", ")}M)`);
  console.log(`\n  seed ${SEED}, ${YEARS} years: ${live.length} live firms, ${empty.length} with an empty book, ${(g.rivals ?? []).length - live.length} wound up`);
}

console.log(bad ? `\n${bad} FAILED\n` : "\nAll husk checks pass.\n");
process.exit(bad ? 1 : 0);
