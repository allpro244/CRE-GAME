// VARIANCE APPLICATIONS ARE PER SITE, NOT PER FIRM.
//
//   pnpm engine && pnpm exec node test/variance.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g = E.newGame(44119, parcels, 50_000_000);
const lots = bbls.filter((b) =>
  parcels[b]?.lotArea > 2_000 && !g.landmarks?.[b]).slice(0, 2);
if (lots.length < 2) throw new Error("Need two sites for variance harness.");

for (const bbl of lots) {
  const rec = parcels[bbl];
  const basis = Math.round(E.landValue(rec, g.econ));
  g.holdings[bbl] = {
    bbl, boughtM: g.month, costBasis: basis, assessed: basis,
    condition: "average", condIdx: 0.55, svcIdx: 0.55,
    tenants: [], loan: null, cfHistory: [], service: 0, stance: 0, plan: 1,
  };
}

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nCONCURRENT VARIANCE APPLICATIONS\n");

const first = E.fileVariance(g, parcels, lots[0]);
check(!first.err, "first site files");
g = first.s;
const second = E.fileVariance(g, parcels, lots[1]);
check(!second.err, "second site files while the first is pending");
g = second.s;
check(Object.keys(g.varianceApps ?? {}).length === 2, "both hearings remain independently pending");

const duplicate = E.fileVariance(g, parcels, lots[0]);
check(!!duplicate.err, "the same site cannot file twice concurrently");

g.month = Math.max(...Object.values(g.varianceApps).map((a) => a.decideM));
E.tickPlanning(g, parcels, bbls);
check(Object.keys(g.varianceApps ?? {}).length === 0, "both due hearings resolve");
check(lots.every((b) => !!g.varianceLog?.[b]), "each site records its own board decision");

console.log("");
process.exit(bad ? 1 : 0);
