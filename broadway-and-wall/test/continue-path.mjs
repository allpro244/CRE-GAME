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
  live.cityIsland = "somewhere";
  live.citySize = "standard";
  live.cityDev = "established";
  live.v = 37;
  for (let i = 0; i < 18 && !live.gameOver; i++) {
    live = E.advanceMonth(live, parcels, bbls, adjacency);
  }
  const snap = structuredClone(live);
  snap.varianceApp = {
    bbl: Object.keys(snap.holdings)[0] ?? Object.keys(parcels)[0],
    filedM: snap.month, decideM: snap.month + 6, cost: 12_000, grant: 1.5, odds: 0.4,
  };

  const prepared = E.prepareSaveForResume(snap);
  check(prepared.ok === true, "v37 campaign prepares for resume after migration");
  check(prepared.state?.v === 37, "prepare keeps save version at current");
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
{
  const base = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  base.citySeed = seed; base.citySize = "standard"; base.cityDev = "established";

  const gen = structuredClone(base); gen.cityIsland = "somewhere"; gen.v = 31;
  const genOut = E.prepareSaveForResume(gen);
  check(genOut.ok === false, "a pre-v37 campaign on a GENERATED island is refused");
  check(/older map generator/.test(genOut.reason ?? ""),
    "...and says the island moved, not just 'older build'");

  const drawn = structuredClone(base); drawn.cityIsland = "newalden"; drawn.v = 34;
  check(E.prepareSaveForResume(drawn).ok === false,
    "a campaign on a removed hand-drawn island is refused");

  const other33 = structuredClone(base); other33.cityIsland = "somewhere"; other33.v = 33;
  check(E.prepareSaveForResume(other33).ok === false,
    "a v33 campaign on a generated island is refused too — that 33 was the Principal break, not this one");

  const now = structuredClone(base); now.cityIsland = "somewhere"; now.v = 37;
  check(E.prepareSaveForResume(now).ok === true,
    "a v37 campaign on a generated island opens normally");

  const old36 = structuredClone(base); old36.cityIsland = "somewhere"; old36.v = 36;
  check(E.prepareSaveForResume(old36).ok === false,
    "a v36 campaign is refused — creek capsules recut the lots");

  const old35 = structuredClone(base); old35.cityIsland = "somewhere"; old35.v = 35;
  check(E.prepareSaveForResume(old35).ok === false,
    "a v35 campaign is refused — coast programmes recut the lots");
}

{
  const g = E.newGame(seed, parcels);
  delete g.citySeed;
  const prepared = E.prepareSaveForResume(g);
  check(prepared.ok === false, "campaign without a city seed is refused");
}

console.log("");
process.exit(bad ? 1 : 0);
