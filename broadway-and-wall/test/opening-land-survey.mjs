// THE OPENING'S LAND LEVEL IS THE STREET'S BIDS, AS THE CAP RATES ARE.
//
//   pnpm engine && node test/opening-land-survey.mjs
//
// The land texture level opened at a formula (opening office rent over
// construction cost, to the 1.15) and the first survey, six months in, pulled
// it to what the street's builders and land funds would bid: across twelve
// towns it opened at 1.55 against a survey of 0.71, and the town's land fell
// 57% peak to trough in five years. The opening now runs the same survey.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK  " : "FAIL"}  ${msg}`); if (!cond) bad++; };
console.log("\nTHE OPENING LAND SURVEY\n");

for (const seed of [99, 20261]) {
  const parcels = E.normalizeParcels(makeCity("somewhere", seed, { size: "city" }).parcels);
  const bbls = Object.keys(parcels);
  const g = E.newGame(seed, parcels, 2_500_000, undefined, { citySize: "city", cityLots: bbls.length });
  const tape = (g.landTape ?? []).filter((p) => p.m === g.month && p.kind === "s");
  ok(tape.length >= 12, `seed ${seed}: the opening carries the survey's indications (${tape.length})`);
  const Ls = tape.map((p) => p.L).sort((a, b) => a - b);
  const lo = Ls[Math.floor((Ls.length - 1) / 2)], hi = Ls[Math.ceil((Ls.length - 1) / 2)];
  ok(g.econ.landIdx >= lo - 1e-9 && g.econ.landIdx <= hi + 1e-9, `seed ${seed}: the opening level is the survey's median (${g.econ.landIdx.toFixed(3)}; middle indications ${lo.toFixed(3)}-${hi.toFixed(3)})`);
  ok(g.econ.landIx?.ref === "s" && Math.abs(Math.exp(g.econ.landIx.x) - g.econ.landIdx) < 1e-9, `seed ${seed}: the appraisers start from it`);
  // the first annual survey, six months in, reads near the opening's, not half of it
  let g2 = E.firstListings(g, parcels, bbls);
  for (let m = 0; m < 7; m++) g2 = E.advanceQuarter(g2, parcels, bbls);
  const r = g2.econ.landIdx / g.econ.landIdx;
  ok(r > 0.6 && r < 1.6, `seed ${seed}: month 7's level is x${r.toFixed(2)} of the opening's (it was x0.5-1.3 off the formula)`);
}
console.log(bad ? `\nopening-land-survey: ${bad} FAILED\n` : "\nopening-land-survey: ok\n");
process.exit(bad ? 1 : 0);
