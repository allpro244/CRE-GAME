// CONTINUE PATH WITHOUT INDEXEDDB — migrate, bump, rebuild twin, fingerprint.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls, seed } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

const fingerprint = (g) => JSON.stringify({
  month: g.month,
  cash: Math.round(g.cash),
  holdings: Object.keys(g.holdings).sort(),
  listings: g.listings.map((l) => l.bbl).sort(),
  rentOffice: +(g.econ.rentIdx.office).toFixed(4),
  vacOffice: +(g.econ.cityVac?.office ?? 0).toFixed(5),
});

console.log("\nCONTINUE PATH\n");

{
  let live = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  live.citySeed = seed;
  live.cityIsland = "newalden";
  live.citySize = "standard";
  live.cityDev = "established";
  for (let i = 0; i < 18 && !live.gameOver; i++) {
    live = E.advanceMonth(live, parcels, bbls, adjacency);
  }
  const snap = structuredClone(live);
  snap.v = 31;
  snap.varianceApp = {
    bbl: Object.keys(snap.holdings)[0] ?? Object.keys(parcels)[0],
    filedM: snap.month, decideM: snap.month + 6, cost: 12_000, grant: 1.5, odds: 0.4,
  };

  const prepared = E.prepareSaveForResume(snap);
  check(prepared.ok === true, "v31 campaign prepares for resume after migration");
  check(prepared.state?.v === 34, "prepare bumps save version to current");
  check(!prepared.state?.varianceApp && prepared.state?.varianceApps, "prepare migrates singular variance");

  let resumed = prepared.state;
  let twin = structuredClone(live);
  for (let i = 0; i < 12 && !resumed.gameOver; i++) {
    resumed = E.advanceMonth(resumed, parcels, bbls, adjacency);
    twin = E.advanceMonth(twin, parcels, bbls, adjacency);
  }
  check(fingerprint(resumed) === fingerprint(twin),
    "migrated Continue path matches an uninterrupted twin over 12 months");
}

// THE HARD BREAK, AND PROOF THAT IT FIRES.
//
// From v34 the generated island's lot lines are cut differently — park shapes,
// the esplanade and the linear park all change what the obstacle subtraction
// removes. A campaign cut on `somewhere` before that rebuilds onto ground its
// deeds no longer describe: measured across three seeds, ~30% of deeds vanish
// and 99% of the survivors are a DIFFERENT parcel under the same number. So
// `migrateSaveState` deliberately refuses to bump those, and this asserts it,
// because a gate nobody has watched fail is not a gate.
//
// The drawn islands are byte-identical across the same change and must still
// open — that is the second half, and it is the half that would break if
// somebody widened the refusal to every old save.
{
  const base = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  base.citySeed = seed; base.citySize = "standard"; base.cityDev = "established";

  const gen = structuredClone(base); gen.cityIsland = "somewhere"; gen.v = 31;
  const genOut = E.prepareSaveForResume(gen);
  check(genOut.ok === false, "a pre-v34 campaign on a GENERATED island is refused");
  check(/older map generator/.test(genOut.reason ?? ""),
    "...and says the island moved, not just 'older build'");

  const drawn = structuredClone(base); drawn.cityIsland = "newalden"; drawn.v = 31;
  check(E.prepareSaveForResume(drawn).ok === true,
    "a pre-v34 campaign on a DRAWN island still opens — that ground did not move");

  // THE VERSION COLLISION, ASSERTED. Two branches both shipped a v33: the
  // Principal break, and this one. A save stamped 33 by the other branch has
  // people but was still cut by the OLD generator, so its ground moved and it
  // must be refused on exactly the same terms as a v31. If somebody ever
  // "tidies" ISLAND_GROUND_MOVED_AT back down to 33, this is the line that
  // notices — and what it protects is a campaign opening with every deed
  // silently pointing at somebody else's lot.
  const other33 = structuredClone(base); other33.cityIsland = "somewhere"; other33.v = 33;
  check(E.prepareSaveForResume(other33).ok === false,
    "a v33 campaign on a generated island is refused too — that 33 was the Principal break, not this one");

  const now = structuredClone(base); now.cityIsland = "somewhere"; now.v = 34;
  check(E.prepareSaveForResume(now).ok === true,
    "a v34 campaign on a generated island opens normally");
}

{
  const g = E.newGame(seed, parcels);
  delete g.citySeed;
  const prepared = E.prepareSaveForResume(g);
  check(prepared.ok === false, "campaign without a city seed is refused");
}

console.log("");
process.exit(bad ? 1 : 0);
