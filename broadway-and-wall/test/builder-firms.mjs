// EVERY BUILDER IS A COMPETITOR — the town's developers as firms on the street.
//   pnpm engine && node test/builder-firms.mjs
//
// GameState.builderFirms (on for new games). The town's builders are firms in
// s.rivals with the register's habits and purses: every start after the
// opening is a named firm's, the firm owns the site and then the building,
// and a builder between schemes is not wound up as a husk. Off, the builder
// register and the anonymous merchants are exactly as they were.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fails++; };

function run(seed, months, setup) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels, 2_500_000, setup), parcels, bbls);
  const starts = [];
  // The opening frames are seeded by firstListings, before the first tick. A
  // firm's start in that first tick is stamped month 0 too, so the opening is
  // these keys, not `startM <= 0`.
  const opening = new Set((g.cityJobs ?? []).map((j) => j.bbl + ":" + j.startM));
  const seen = new Set();
  const delivered = [];
  for (let m = 0; m < months; m++) {
    const live = new Map((g.cityJobs ?? []).map((j) => [j.bbl + ":" + j.startM, j]));
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const now = new Set((g.cityJobs ?? []).map((j) => j.bbl + ":" + j.startM));
    for (const j of g.cityJobs ?? []) {
      const k = j.bbl + ":" + j.startM;
      if (!seen.has(k)) { seen.add(k); starts.push({ ...j, seenM: g.month, opening: opening.has(k) }); }
    }
    for (const [k, j] of live) if (!now.has(k) && j.firmId && g.month >= j.deliverM) delivered.push({ bbl: j.bbl, firmId: j.firmId, m: g.month });
  }
  return { g, starts, delivered };
}

console.log("\nOff: the builder register, as it was");
{
  const { g, starts } = run(7101, 60, { builderFirms: false });
  ok(!g.builderFirms && !(g.rivals ?? []).some((r) => r.builderProf), "no builder firms on the street");
  ok((g.builders ?? []).length > 0 && starts.some((j) => !j.firmId && j.builderId), `the register builds as before (${(g.builders ?? []).length} builders, ${starts.filter((j) => !j.firmId).length} unnamed starts)`);
}

console.log("\nOn (the default): every builder is a firm");
{
  const { g, starts, delivered } = run(7101, 120);
  const firms = g.rivals.filter((r) => r.builderProf);
  const live = firms.filter((r) => r.failedM === undefined && r.retiredM === undefined);
  const after = starts.filter((j) => !j.opening);
  const anon = after.filter((j) => !j.firmId);
  console.log(`  ten years: ${firms.length} builder firms (${live.length} living, ${firms.length - live.length} gone) · ${after.length} starts after the opening, ${after.filter((j) => firms.some((r) => r.id === j.firmId)).length} by builder firms · ${delivered.length} delivered to firms`);
  ok(g.builderFirms === true, "on by default for a new game");
  ok(firms.length > 0 && firms.every((r) => r.founder && r.builderProf && ["merchant", "developer"].includes(r.style)), "the builders are firms: a founder, the register's habits, a merchant or developer style");
  ok(after.length > 0 && anon.length === 0, `nothing started after the opening is anonymous (${anon.length} of ${after.length})`);
  // Owner, Oct 2026: "Every developer needs to be a visible player as well, as soon as the game starts."
  ok(starts.filter((j) => j.opening).every((j) => firms.some((r) => r.id === j.firmId)), "the frames already standing at the opening belong to builder firms on the list");
  const owned = delivered.filter((d) => g.rivals.find((r) => r.id === d.firmId)?.builderProf);
  ok(owned.length > 0, `builder firms take the deed to what they build (${owned.length} buildings)`);
  ok(live.every((r) => r.endReason !== "woundUp"), "a builder between schemes is not wound up as a husk");
  ok(!(g.builders ?? []).some((b) => b.starts > 0), "the old register starts nothing");
  // The street's own reads count investors and operators, not the builders:
  // counted, they halved fund entry's product term (a seed went from 9 first
  // closes in thirty years to 2) and kept every estate's heir seat filled.
  const funds = g.rivals.filter((r) => r.failedM === undefined && !r.builderProf).length;
  ok(E.firmEntryPitch(g).firms === funds, `fund entry counts the funds, not the builders (${E.firmEntryPitch(g).firms} of ${funds + live.length} firms)`);
}

console.log(fails ? "\nFAIL" : "\nPASS — the town's builders are firms on the street, and own what they build");
process.exit(fails ? 1 : 0);
