// A BUILDING DEMOLISHED AND THEN FOLDED INTO A SITE IS GONE.
// The owner's report: two lots demolished and assembled into a site still
// showed on the Leasing desk as their original buildings (a 79,000 sf office
// that had been knocked down). resolveRec returned the static parcel for a
// merged child, skipping the `built` record demolition writes.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) bad++; };
const own = (g, bbl) => {
  const rec = parcels[bbl];
  const price = Math.round(E.landValue(rec, g.econ) * 1.02);
  g.holdings[bbl] = {
    bbl, boughtM: 0, costBasis: price, condition: "average",
    tenants: [], loan: null, assessed: price, condIdx: 0.55, svcIdx: 0.55,
    service: 0, stance: 0, plan: 1, cfHistory: [],
  };
};
// two adjacent lots, both with a building on them
let pair = null;
for (const a of bbls) {
  const ra = parcels[a];
  if (!ra || ra.class === "land" || !(ra.bldgArea > 0) || ra.bldgArea > 60000) continue;
  const b = (adjacency[a] ?? []).find((n) => parcels[n] && parcels[n].class !== "land" && parcels[n].bldgArea > 0 && parcels[n].bldgArea < 60000);
  if (b) { pair = [a, b]; break; }
}
if (!pair) { console.error("no built pair"); process.exit(1); }
const [A, B] = pair;
let g = E.firstListings(E.newGame(7, parcels), parcels, bbls);
g.cash += 50e6;
own(g, A); own(g, B);
for (const x of [A, B]) {
  const r = E.demolish(g, parcels, x);
  if (r.err) { console.error("demolish", x, r.err); process.exit(1); }
  g = r.s;
}
const r = E.assembleLots(g, parcels, adjacency, [A, B]);
if (r.err) { console.error("assemble", r.err); process.exit(1); }
g = r.s;
const child = Object.keys(g.merged ?? {}).find((k) => k === A || k === B);
ok(!!child, `one lot is a merged child (${child})`);
const rc = E.resolveRec(parcels, g, child);
ok(rc && !(rc.bldgArea > 0), `the demolished child has no building (bldgArea ${rc?.bldgArea}, class ${rc?.class})`);
ok(E.portfolioOccupancy(g, parcels) === null, "no phantom building in portfolio occupancy");
if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log("\nassemble-razed ok");
