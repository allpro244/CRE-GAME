// Finance decisions a year: paper brought to market and who took it, bank
// foreclosures noticed / reinstated, July lots, private-credit asks to the
// player, holder-exit rumours, lenders shutting. Counted off the news wire and
// state, so the same probe reads main and a branch.
// node tools/probes/finprobe.mjs $PWD 11 35
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 35);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const pats = {
  offerNPL: /is offering the defaulted loan/, offerPerf: /is offering the loan on/, receiverSale: /The receiver for .* is selling/,
  ltoEarly: /before anyone else moved/, nplTaken: /has about a year to repay/, bondTaken: /bought the performing loan/,
  deedByPaper: /by foreclosing on the loan it bought/,
  fclNoticed: /has noticed a foreclosure sale/, reinstated: /to reinstate at/,
  holderRumor: /Word at the courthouse|under review|lawyered up|quietly shopping/, stopped: /stopped lending:/,
  pcLapse: /Loan request lapsed/,
};
const tot = {}; for (const k in pats) tot[k] = 0;
let lots = 0, outcomes = {}, asks = 0, lastAsk = 0;
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  for (const n of g.news) { if (n.q !== g.month) continue; for (const k in pats) if (pats[k].test(n.text)) tot[k]++; }
  for (const a of g.privateAsks ?? []) { const v = Number(String(a.id).slice(1)); if (v > lastAsk) { asks++; lastAsk = v; } }
  if (g.auction && g.auction.m === g.month + 1) for (const l of g.auction.lots) { lots++; outcomes[l.kind] = (outcomes[l.kind] ?? 0) + 1; }
}
console.log(`seed ${SEED} ${YEARS}y, per year (total):`);
for (const k in tot) console.log(`  ${k.padEnd(14)} ${(tot[k] / YEARS).toFixed(2)}  (${tot[k]})`);
console.log(`  pcAsks         ${(asks / YEARS).toFixed(2)}  (${asks})`);
console.log(`  julyLots       ${(lots / YEARS).toFixed(2)}  (${lots}) ${JSON.stringify(outcomes)}`);
