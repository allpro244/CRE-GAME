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

// LAND THAT PENCILS — a lot is in a land box only when its ask plus closing sits
// inside a builder's residual; the same test the Marketplace chip reads.
{
  // Searched across three economies: whether dirt pencils in a given twenty
  // years is the cycle's call (one seed's draw found none after the opening
  // policy rate moved to the bank's rule, Oct 2026), and the test is about
  // the box, not about one town's land market.
  let yes = null, no = null;
  for (const seed of [777, 12007, 550991]) {
    let gl = E.firstListings(E.newGame(seed, parcels, 40_000_000), parcels, bbls);
    for (let m = 0; m < 240 && !(yes && no); m++) {
      gl = E.advanceMonth(gl, parcels, bbls, adjacency);
      if (gl.gameOver) gl = { ...gl, gameOver: null, cash: 40_000_000 };
      for (const li of gl.listings) {
        const rec = E.resolveRec(parcels, gl, li.bbl);
        if (rec?.class !== "land" || !(rec.lotArea > 0)) continue;
        const p = E.landPencils(rec, gl.econ, li.ask);
        if (p.pencils && !yes) yes = { g: gl, li };
        if (!p.pencils && !no) no = { g: gl, li };
      }
    }
    if (yes && no) break;
  }
  check(!!yes && !!no, `the tape shows lots that pencil and lots that do not (${!!yes} / ${!!no})`);
  const box = { land: true };
  if (yes) check(E.inBuyBox({ ...yes.g, buyBox: box }, parcels, yes.li.bbl, yes.li.ask), "a lot that pencils is inside a land box");
  if (no) check(!E.inBuyBox({ ...no.g, buyBox: box }, parcels, no.li.bbl, no.li.ask), "a lot that does not pencil is outside it");
  if (yes) {
    // Hand-check the residual test: at exactly the residual less closing it
    // pencils; a dollar a foot over and it does not.
    const rec = E.resolveRec(parcels, yes.g, yes.li.bbl);
    const lr = E.landRead(rec, yes.g.econ);
    const at = Math.floor((lr.builder / 1.02) * rec.lotArea);
    check(E.landPencils(rec, yes.g.econ, at).pencils && !E.landPencils(rec, yes.g.econ, (lr.builder / 1.02 + 1) * rec.lotArea).pencils,
      "the line is the builder's residual less 2% closing");
    check(!E.inBuyBox({ ...yes.g, buyBox: { uses: ["office"] } }, parcels, yes.li.bbl, yes.li.ask), "a product box without land leaves the dirt out");
    const built = yes.g.listings.find((l) => E.resolveRec(parcels, yes.g, l.bbl)?.class !== "land");
    if (built) check(!E.inBuyBox({ ...yes.g, buyBox: box }, parcels, built.bbl, built.ask), "a land-only box leaves standing buildings out");
  }
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
