// LEGAL FAR IS TWICE THE FABRIC-ANCHORED ZONEFAR.
//
//   pnpm engine && pnpm far-envelope
//
// The owner asked for the stamped max to be double whatever the typical lot
// was showing (6.1 → 12.2, 10.2 → 20.4). Buildings are not restamped.
// Residual land still prices what the plate can carry, so unused legal FAR
// on a lot that cannot physically reach it must not explode the dirt.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const ok = (pass, msg) => {
  console.log(`  ${pass ? "OK  " : "FAIL"}  ${msg}`);
  if (!pass) bad++;
};

const q = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))];
};
const med = (a) => q(a, 0.5);
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

console.log("\nFAR ENVELOPE — legal max is 2× fabric\n");

ok(E.FAR_ENVELOPE_MULT === 2, `FAR_ENVELOPE_MULT is 2 (got ${E.FAR_ENVELOPE_MULT})`);
ok(E.FAR_CEILING === 80, `FAR_CEILING is 80 so a doubled 38-FAR lot is not clipped (got ${E.FAR_CEILING})`);

const { parcels } = loadCity(0, E.normalizeParcels);
const g = E.firstListings(E.newGame(4242, parcels), parcels, Object.keys(parcels));

const maxs = [];
const builts = [];
const lands = [];
for (const rec of Object.values(parcels)) {
  if (!rec?.lotArea) continue;
  const live = E.resolveRec(parcels, g, rec.bbl) ?? rec;
  const farMax = Math.max(live.farMaxComm ?? 0, live.farMaxRes ?? 0);
  maxs.push(farMax);
  if (rec.bldgArea > 0) {
    builts.push(rec.bldgArea / rec.lotArea);
    lands.push(E.landValue(live, g.econ) / rec.lotArea);
  }
}

const medMax = med(maxs);
const meanMax = mean(maxs);
const medBuilt = med(builts);
const p90 = q(maxs, 0.9);
ok(medMax >= 10 && medMax <= 16,
  `median legal FAR is ~2× the old 6.1 fabric stamp (got ${medMax.toFixed(1)})`);
ok(meanMax >= 14 && meanMax <= 22,
  `mean legal FAR is ~2× the old 8.7 (got ${meanMax.toFixed(1)})`);
ok(p90 <= E.FAR_CEILING,
  `p90 legal FAR ${p90.toFixed(1)} sits under the city ceiling ${E.FAR_CEILING}`);
ok(medBuilt > 0 && medBuilt < medMax * 0.4,
  `buildings were not restamped — median built ${medBuilt.toFixed(2)} FAR vs legal ${medMax.toFixed(1)}`);

const landMed = med(lands);
ok(landMed > 20 && landMed < 250,
  `median land $/sf stays in a real band after the double (got ${landMed.toFixed(0)})`);

console.log("");
process.exit(bad ? 1 : 0);
