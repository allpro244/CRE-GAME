// THE LOOK IS YOURS, AND IT IS ONLY A LOOK.
//
//   pnpm engine && node test/design.mjs
//
// The Build desk's Design tab lets the developer choose a facade, trim, roof
// and crown (BuildingDesign). Two things must hold:
//   - the choice survives: draft -> job -> the finished building the map draws;
//   - nothing priced reads it: the same scheme with and without a design runs
//     to the same state, month for month, apart from the design itself.
import { permittedUse } from "./permitted-use.mjs";
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
console.log("\nDESIGN — the developer's look survives to delivery and moves no money\n");

let g = E.firstListings(E.newGame(12007, parcels, 120_000_000), parcels, bbls);
const lotsNow = () => g.listings.map((l) => ({ l, rec: parcels[l.bbl] })).filter((x) => x.rec?.class === "land" && x.rec.lotArea > 4000).sort((a, b) => b.rec.demandScore - a.rec.demandScore);
for (let m = 0; m < 48 && lotsNow().length === 0; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
const lots = lotsNow();
check(lots.length > 0, `a lot on the tape (${lots.length})`);
const { l, rec } = lots[0];
g = E.executePurchase(g, parcels, l.bbl, l.ask, "cash", false, 1).s;
const use = permittedUse(E, E.resolveRec(parcels, g, l.bbl), g.econ, ["office", "multifamily"]);
const fl = Math.max(2, Math.round(E.maxFloorsFor(rec, 0.6, use) * 0.8));
const design = { facade: "decobrick#3", trim: 3, roof: "mansard", crown: "spire" };

const plain = E.startDevelopment(g, parcels, l.bbl, use, fl, 0.6, "gmp");
const styled = E.startDevelopment(g, parcels, l.bbl, use, fl, 0.6, "gmp", undefined, { design });
check(!plain.err && !styled.err, `ground breaks both ways${plain.err || styled.err ? `: ${plain.err ?? styled.err}` : ""}`);
check(JSON.stringify(styled.s.developments[l.bbl].design) === JSON.stringify(design), "the job carries the design");
check(plain.s.developments[l.bbl].design === undefined, "and a job built without one carries none");

// Strip the design and the two worlds must be the same world, every month.
const strip = (s) => {
  const t = structuredClone(s);
  if (t.developments?.[l.bbl]) delete t.developments[l.bbl].design;
  if (t.built?.[l.bbl]) delete t.built[l.bbl].design;
  return JSON.stringify(t);
};
let a = plain.s, b = styled.s, same = true, deliveredAt = -1;
for (let m = 0; m < 72; m++) {
  a = E.advanceMonth(a, parcels, bbls, adjacency);
  b = E.advanceMonth(b, parcels, bbls, adjacency);
  if (a.gameOver || b.gameOver) break;
  if (strip(a) !== strip(b)) { same = false; console.log(`    diverged in month ${a.month}`); break; }
  if (deliveredAt < 0 && !b.developments[l.bbl]) { deliveredAt = m; if (m > 6) break; }
}
check(deliveredAt >= 0, `delivered (${deliveredAt + 1} months)`);
check(same, "with and without a design, the state is identical month for month — nothing priced reads the look");
check(JSON.stringify(b.built?.[l.bbl]?.design) === JSON.stringify(design), "the finished building carries the design the map draws");
check(a.built?.[l.bbl] && a.built[l.bbl].design === undefined, "the undesigned one leaves the look to the street");

console.log(bad ? `\n${bad} FAILED\n` : "\nall clear\n");
process.exit(bad ? 1 : 0);
