// THE NEXT CHEQUE SAYS HOW MUCH OF THE LINE IT DRAWS.
//
//   pnpm engine && node test/loc-draw.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels } = loadCity(0, E.normalizeParcels);
const g = E.newGame(44101, parcels, 80_000_000);
g.cash = 400_000;
g.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nLOC DRAW SPLIT\n");
check(typeof E.locDrawFor === "function", "locDrawFor is exported");

const allCash = E.locDrawFor(g, parcels, 250_000);
check(allCash.cash === 250_000 && allCash.draw === 0 && allCash.short === 0,
  `need under cash is all cash  (${allCash.cash} / ${allCash.draw} / ${allCash.short})`);

const mixed = E.locDrawFor(g, parcels, 700_000);
check(mixed.cash === 400_000 && mixed.draw > 0,
  `need over cash draws the line  (cash ${mixed.cash}  draw ${mixed.draw}  short ${mixed.short})`);
check(mixed.rate > g.econ.indexRate,
  `quoted rate is index + 400  (${mixed.rate.toFixed(2)} vs index ${g.econ.indexRate.toFixed(2)})`);

const noLine = E.locDrawFor(g, parcels, 700_000, { allowLoc: false });
check(noLine.draw === 0 && noLine.short === 300_000,
  "cash-only close does not pretend the line will fund it");

console.log("");
process.exit(bad ? 1 : 0);
