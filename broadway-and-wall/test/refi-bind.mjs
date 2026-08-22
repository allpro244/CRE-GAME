// WHICH TEST SIZES THE LOAN — DSCR, debt yield, or LTV.
//
//   pnpm engine && pnpm refi-bind
//
// REPORT, not a gate. OWNER_PLAYTEST_NOTES: at 2% coupon, 5.0x DSCR, LTV
// printed 23%. If the appraisal is small because it reads effective rent
// (CONC_DEPTH = 0.30), the sizing rules are not the fault. This logs the
// three legs in dollars against the mark, so the binding name is not a
// guess.
//
// STANDING FACT: no playtest in this repo is based on Manhattan. Every
// harness run and number here is a GENERATED city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);

function buySome(seed, n = 6, cash = 250_000_000) {
  const out = [];
  let g = E.firstListings(E.newGame(seed, parcels, cash), parcels, bbls);
  const errs = [];
  for (const L of g.listings ?? []) {
    if (out.length >= n) break;
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    if (L.ask < 2_000_000 || L.ask > 80_000_000) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    if (r.err) { errs.push(r.err); continue; }
    g = r.s;
    out.push(L.bbl);
  }
  // Closing a listing can refuse for reasons that are not about sizing.
  // Stamp unencumbered deeds so the quote path is still measured.
  if (out.length === 0) {
    for (const bbl of bbls) {
      if (out.length >= n) break;
      const rec = parcels[bbl];
      if (!rec || rec.class === "land" || !rec.bldgArea || rec.bldgArea < 20_000) continue;
      g.holdings[bbl] = {
        bbl, boughtM: 0, costBasis: 8_000_000, loan: null,
        condition: rec.yearBuilt < 1960 ? "worn" : "average",
        condIdx: rec.yearBuilt < 1960 ? 0.45 : 0.70,
        tenants: [], cfHistory: [],
      };
      out.push(bbl);
    }
    if (errs[0]) console.log(`(executePurchase refused: ${errs[0]} — stamped ${out.length} deeds to quote)\n`);
  }
  return { g, bbls: out };
}

function quoteBook(g, owned, label) {
  console.log(`\n${label}`);
  console.log(`index ${g.econ.indexRate.toFixed(2)}%  creditIdx ${(g.econ.creditIdx ?? 1).toFixed(2)}  month ${g.month}\n`);
  const counts = { "debt yield": 0, coverage: 0, "advance rate": 0, "their hold size": 0, "stabilised plan": 0, other: 0 };
  let n = 0;
  for (const bbl of owned) {
    const h = g.holdings[bbl];
    const rec = E.resolveRec(parcels, g, bbl);
    const v = E.ownedHoldingValue(g, parcels, h);
    const noi = E.ownedHoldingNoiYr(g, parcels, h);
    const cap = v > 0 ? (noi / v) * 100 : 0;
    const { quotes } = E.refiQuotes(g, parcels, bbl);
    const open = quotes.filter((q) => q.available && q.maxProceeds > 0);
    console.log(`${rec?.address ?? bbl}  ${rec?.class}  value $${(v / 1e6).toFixed(2)}M  NOI $${(noi / 1e6).toFixed(2)}M  implied cap ${cap.toFixed(2)}%`);
    for (const q of open.slice(0, 5)) {
      const raw = E.quote(g, E.productById(q.id), v, noi, rec?.class);
      const ltvPct = v > 0 ? (q.maxProceeds / v) * 100 : 0;
      console.log(
        `  ${q.label.padEnd(22)} ${q.ratePct.toFixed(2)}%  proceeds $${(q.maxProceeds / 1e6).toFixed(2)}M  `
        + `LTV ${ltvPct.toFixed(0)}%  DSCR ${q.dscrAtMax.toFixed(2)}  DY ${(q.debtYieldAtMax * 100).toFixed(1)}%  `
        + `binds ${q.binding}`
        + (raw.byLtv != null
          ? `  legs LTV $${(raw.byLtv / 1e6).toFixed(2)}M / DSCR $${(raw.byDscr / 1e6).toFixed(2)}M / DY $${(raw.byDebtYield / 1e6).toFixed(2)}M`
          : ""),
      );
      counts[q.binding] = (counts[q.binding] ?? 0) + 1;
      n++;
    }
  }
  console.log("Binding counts");
  for (const [k, v] of Object.entries(counts)) {
    if (v) console.log(`  ${k}: ${v}  (${n ? ((v / n) * 100).toFixed(0) : 0}%)`);
  }
  return { counts, n };
}

const bought = buySome(77011);
console.log("\nREFI BINDING — generated city, cash purchases\n");
console.log(`owned ${bought.bbls.length} deeds`);
quoteBook(bought.g, bought.bbls, "Month 0 — opening credit window");

let later = bought.g;
for (let i = 0; i < 60; i++) later = E.advanceMonth(later, parcels, bbls, {});
quoteBook(later, bought.bbls, "Month 60 — same deeds, five years on");

let late = later;
for (let i = 0; i < 60; i++) late = E.advanceMonth(late, parcels, bbls, {});
quoteBook(late, bought.bbls, "Month 120 — same deeds, ten years on");

console.log("\nIf LTV at max is far below the desk's advance rate and the DY/DSCR");
console.log("legs are the small ones, the sizing rules bound — not a small appraisal.");
console.log("If proceeds/value is small AND the LTV leg is the smallest, the mark is small.");
console.log("A 23% advance at 5.0x / 2% on a later, looser window would be a sizing bug.\n");
