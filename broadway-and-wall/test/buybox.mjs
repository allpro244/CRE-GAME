// THE BUY BOX FILTERS WHAT STOPS THE CLOCK, AND NOTHING ELSE.
//
// A broker's first look used to stop Yr/Skip/Play on anything; with a box set,
// only a first look inside it is a decision. The listing is still on the tape.
//
//   pnpm engine && node test/buybox.mjs
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
const lookKeys = (g) => E.attentionItems(g, parcels).filter((a) => a.key.startsWith("early-look:") || a.key.startsWith("broker:")).map((a) => a.key);

console.log("\nBUY BOX — only what matches stops the clock\n");
let g = E.firstListings(E.newGame(31337, parcels, 40_000_000), parcels, bbls);
let found = null;
for (let m = 0; m < 240 && !found; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 40_000_000 };
  if (lookKeys(g).length) found = g;
}
check(!!found, "a broker's first look or off-market file reaches the attention list with no box set");
if (found) {
  const keys = lookKeys(found);
  const tight = { ...found, buyBox: { maxAsk: 1 } };
  check(lookKeys(tight).length === 0, `a box no deal fits silences them (${keys.length} → ${lookKeys(tight).length})`);
  check(tight.listings.length === found.listings.length, "the tape itself is untouched");
  const wide = { ...found, buyBox: { maxAsk: 1e12 } };
  check(lookKeys(wide).length === keys.length, "a box every deal fits changes nothing");
  const li = found.listings[0];
  check(E.inBuyBox({ ...found, buyBox: undefined }, parcels, li.bbl, li.ask), "no box means everything is in it");
  const rec = E.resolveRec(parcels, found, li.bbl);
  const other = ["office", "retail", "multifamily", "industrial"].find((u) => u !== rec.class);
  check(!E.inBuyBox({ ...found, buyBox: { uses: [other] } }, parcels, li.bbl, li.ask), `a ${rec.class} listing is outside a ${other}-only box`);
}
console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
