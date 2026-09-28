// WHERE YOU STAND, AND WHAT THE YEAR DID — the readings of the score agree
// with the score. Every December leaves a mark; the year's review reads the
// same net worth the history holds and the same ledger the books hold; the
// ranking is a ranking; a death closes a career the card can tell back.
//
//   pnpm engine && node test/standing.mjs
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
console.log("\nSTANDING — the year told back\n");

let g = E.firstListings(E.newGame(12007, parcels, 2_500_000), parcels, bbls);
const li = g.listings.find((l) => { const r = parcels[l.bbl]; return r && r.class !== "land" && r.bldgArea > 3000 && l.ask < 2_000_000 && !l.halfBuilt; });
if (li) { const r = E.executePurchase(g, parcels, li.bbl, li.ask, "cash", false, 1); if (!r.err) g = r.s; }
for (let m = 0; m < 36; m++) { g = E.advanceMonth(g, parcels, bbls, adjacency); if (g.gameOver) break; }

const marks = g.yearMarks ?? [];
check(marks.length === 4 && marks[0].y === -1 && marks.slice(1).map((x) => x.y).join() === "0,1,2", `an opening mark and one per December (${marks.map((x) => x.y).join(",")})`);
check(marks.slice(1).every((x) => x.m % 12 === 11 && x.nw === g.nwHistory[x.m]), "each mark is the December close the net-worth history holds");
const st = E.streetStanding(g, parcels);
check(st.rank >= 1 && st.rank <= st.of && st.of === 1 + (g.rivals ?? []).filter((r) => r.failedM === undefined).length, `a ranking: ${E.ordinal(st.rank)} of ${st.of}`);
check(st.rank === 1 ? st.above === null : !!st.above && st.above.eq >= st.equity, "the firm above you has at least your equity");

const r1 = E.yearReview(g, 1, E.MILESTONES, E.START_YEAR);
check(!!r1 && r1.year === E.START_YEAR + 1, `a review of ${r1?.year}: "${r1?.verdict}"`);
const b1 = g.books.find((e) => e.yr === 1);
check(r1 && Math.abs(r1.cashFromBuildings - Math.round(b1.noi - b1.debtSvc)) <= 1 && r1.overhead === Math.round(b1.ga), "its cash and overhead are the year's ledger");
check(r1 && r1.nw0 === marks[1].nw && r1.nw1 === marks[2].nw, "its net worth runs December to December");
check(E.yearReview(g, 7, E.MILESTONES, E.START_YEAR) === null, "no review of a year that has not closed");
const r0 = E.yearReview(g, 0, E.MILESTONES, E.START_YEAR);
check(!!r0 && r0.milestones.includes("First deed recorded") && r0.deedsIn >= 1, "year one names the first deed");

// a death closes a career; the run goes on
const n0 = g.careers?.length ?? 0;
g.principal.diesM = g.month + 1;
for (let m = 0; m < 3; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
check((g.careers?.length ?? 0) === n0 + 1 && !g.gameOver, "the principal's death closes a career and the run continues");
const c = E.careerCard(g, n0, E.MILESTONES, E.START_YEAR);
check(!!c && c.fromYear === E.START_YEAR && c.heir === g.principal.name && c.nw1 > 0, `a career card: "${c?.verdict}" — ${c?.fromYear}–${c?.toYear}, handed to ${c?.heir}`);

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
