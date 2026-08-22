// STARTS CHASE THE TREND. developerOptimism was written for this and never
// wired. A jobs shock lifts spot rent ahead of the 21-month EMA; pencils
// that still underwrite spot alone cannot overshoot.
//
//   pnpm engine && node test/rentexp-pencils.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels } = loadCity(0, E.normalizeParcels);
const g = E.newGame(550991, parcels);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nDEVELOPER OPTIMISM ON THE PENCIL\n");

check(typeof E.developerOptimism === "function", "developerOptimism is exported");
check(typeof E.devPencils === "function", "devPencils is exported");

const flat = structuredClone(g.econ);
flat.rentIdx = { ...flat.rentIdx, office: 100 };
flat.rentExp = { ...flat.rentExp, office: 100 };
flat.effRentIdx = { ...flat.effRentIdx, office: 100 };

const boom = structuredClone(flat);
boom.rentIdx = { ...flat.rentIdx, office: 120 };
boom.effRentIdx = { ...flat.effRentIdx, office: 120 };

const slump = structuredClone(flat);
slump.rentIdx = { ...flat.rentIdx, office: 80 };
slump.effRentIdx = { ...flat.effRentIdx, office: 80 };

const optFlat = E.developerOptimism(flat, "office");
const optBoom = E.developerOptimism(boom, "office");
const optSlump = E.developerOptimism(slump, "office");
check(Math.abs(optFlat) < 1e-9, `no momentum when spot equals rentExp (${optFlat.toFixed(4)})`);
check(optBoom > 0, `spot above rentExp is optimism (${optBoom.toFixed(3)})`);
check(optSlump < 0, `spot below rentExp is pessimism (${optSlump.toFixed(3)})`);
check(optBoom > Math.abs(optSlump), "good news is extrapolated further than bad — the glut mechanism");

const pFlat = E.devPencils(flat, "office");
const pBoom = E.devPencils(boom, "office");
const pSlump = E.devPencils(slump, "office");
check(pBoom > pFlat, `pencils rise when spot runs ahead of rentExp  (${pFlat.toFixed(3)} → ${pBoom.toFixed(3)})`);
check(pSlump < pFlat, `pencils fall when spot sits below rentExp  (${pFlat.toFixed(3)} → ${pSlump.toFixed(3)})`);

console.log("");
process.exit(bad ? 1 : 0);
