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
  check(prepared.state?.v === 32, "prepare bumps save version to current");
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

{
  const g = E.newGame(seed, parcels);
  delete g.citySeed;
  const prepared = E.prepareSaveForResume(g);
  check(prepared.ok === false, "campaign without a city seed is refused");
}

console.log("");
process.exit(bad ? 1 : 0);
