// ONE BUILDING, ONE APPRAISAL.
//
//   pnpm engine && pnpm appraisal
//
// GATE. HANDOFF 0f: "one building, three appraisals in six months". Measured
// on 2856 Old State St (flats, 99% let): the parcel desk read the class
// model ($2.52M, no roll), the ask was struck on the roll taxed at nothing
// ($2.76M × the phase's denial), the deed marked at the roll taxed at the
// price ($2.43M) — and in month five the condition index ticked from 0.5195
// to 0.5200, the grade flipped worn→standard, rent read 19% higher, the cap
// 70bp lower and the mark rose 53% with the same tenants paying the same
// rent. Then apartment income read the SPOT market every month, so a 9% index
// move was a 27% NOI move the same month on a full building.
//
// Now: rent and cap read the condition index continuously; every vessel is
// taxed at the standing assessment and carries the index and the flats'
// in-place rent; `marketAppraisal` is the one reader the tape, the desk and
// the lender share; the flats' roll walks a twelfth a month to the market.
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
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const pc = (x) => `${(x * 100).toFixed(1)}%`;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// --- 1. a thousandth of condition is a thousandth of value -----------------
{
  const g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const li = g.listings.map((li) => ({ li, rec: E.resolveRec(parcels, g, li.bbl) })).find((x) => x.rec && x.rec.class === "multifamily" && x.rec.bldgArea > 0 && x.li.roll);
  const h = E.asIfOwned(g, li.li.bbl, li.li.ask, E.disclosureFor(g, li.li.bbl), li.rec);
  const at = (idx) => E.holdingValue(li.rec, g.econ, { ...h, condIdx: idx, condition: E.condGrade(idx) }, g.month);
  const below = at(0.5195), above = at(0.5205);
  ok(Math.abs(above / below - 1) < 0.01, `${li.rec.address}: value at 0.5195 ${Math.round(below / 1e3)}K vs at 0.5205 ${Math.round(above / 1e3)}K (${pc(above / below - 1)}) — no step at the band edge`);
  ok(E.capRateFor(li.rec, g.econ, "standard", 0.5205) - E.capRateFor(li.rec, g.econ, "worn", 0.5195) < 0.02, `the cap rate is continuous across worn→standard`);
  const good = at(0.865), worn = at(0.43);
  ok(good > worn * 1.25, `and the grades still price apart: good ${Math.round(good / 1e3)}K vs worn ${Math.round(worn / 1e3)}K`);
}

// --- 2. the tape, the desk, the lender and the deed read one number ----------
{
  let n = 0, bad = 0; const gaps = [];
  for (const seed of [550991, 12007, 11]) {
    let g = E.firstListings(E.newGame(seed, parcels, 400_000_000), parcels, bbls);
    const picks = g.listings.map((li) => ({ li, rec: E.resolveRec(parcels, g, li.bbl) })).filter((x) => x.rec && x.rec.class !== "land" && x.rec.bldgArea > 0 && !x.li.halfBuilt && !x.li.distress && x.li.roll).slice(0, 6);
    for (const { li, rec } of picks) {
      const grade = E.gradeOf(g, rec);
      const appraisal = E.marketAppraisal(g, rec, li.bbl, grade);
      const conveyed = E.conveyedValue(g, rec, li.bbl, false);
      const lender = E.buyQuote(g, parcels, li.bbl, li.ask, "harbor", 1).appraised;
      const r = E.executePurchase(g, parcels, li.bbl, li.ask, "cash", false, 1);
      if (r.err) continue;
      const h = r.s.holdings[li.bbl];
      const mark = E.holdingValue(rec, r.s.econ, h, r.s.month);
      // the closing resets the assessment to the price; that tax delta, capitalised, is the whole allowed gap
      const capUsed = (E.capRateFor(rec, r.s.econ, h.condition, h.condIdx) + E.rollQualitySpread(rec, h, r.s.month, r.s.econ)) / 100;
      const taxDelta = Math.max(0, li.ask - E.assetValue(rec, g.econ, li.cond ?? grade, li.condIdx)) * E.TAX_RATE;
      const allowed = 0.04 + (appraisal > 0 ? (taxDelta / capUsed) / appraisal : 0);
      const g1 = Math.abs(conveyed / appraisal - 1), g2 = Math.abs(mark / appraisal - 1), g3 = Math.abs(lender / appraisal - 1);
      gaps.push(g1, g2); n++;
      if (g1 > 0.04 || g3 > 0.001 || g2 > allowed) { bad++; console.log(`  ✗ ${rec.address} (${rec.class}): appraisal ${Math.round(appraisal / 1e3)}K conveyed ${Math.round(conveyed / 1e3)}K lender ${Math.round(lender / 1e3)}K mark after ${Math.round(mark / 1e3)}K (allowed ${pc(allowed)})`); }
      g = r.s;
    }
  }
  ok(n >= 12 && bad === 0, `${n} listings across three seeds: ask basis, market appraisal, lender's appraisal and the mark after closing agree (worst gap ${pc(Math.max(...gaps))}; ${bad} outside the tax reset)`);
}

// --- 3. the ask sits in a band around the appraisal, by phase ---------------
{
  const rows = [];
  for (const seed of [550991, 4242, 91117]) {
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    for (let q = 0; q <= 40; q++) {
      if (q % 4 === 0) for (const li of g.listings) {
        const rec = E.resolveRec(parcels, g, li.bbl); if (!rec || rec.class === "land" || !rec.bldgArea || li.halfBuilt) continue;
        rows.push({ phase: g.econ.phase, distress: !!li.distress, r: li.ask / E.marketAppraisal(g, rec, li.bbl, E.gradeOf(g, rec)) });
      }
      if (q === 40) break;
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
    }
  }
  const clean = rows.filter((r) => !r.distress).map((r) => r.r), dis = rows.filter((r) => r.distress).map((r) => r.r);
  ok(clean.length > 200 && pct(clean, .5) >= 0.94 && pct(clean, .5) <= 1.12 && pct(clean, .9) <= 1.40, `${clean.length} asks: p10 ${pct(clean, .1).toFixed(2)} p50 ${pct(clean, .5).toFixed(2)} p90 ${pct(clean, .9).toFixed(2)} of the market appraisal`);
  ok(dis.length > 10 && pct(dis, .5) < 0.97, `${dis.length} motivated sellers ask under it: p50 ${pct(dis, .5).toFixed(2)}`);
  for (const ph of ["expansion", "recession", "recovery"]) { const a = rows.filter((r) => !r.distress && r.phase === ph).map((r) => r.r); if (a.length > 30) console.log(`    ${ph.padEnd(10)} n ${a.length} p50 ${pct(a, .5).toFixed(2)} p90 ${pct(a, .9).toFixed(2)}`); }
}

// --- 4. the flats' income turns over, it does not jump ----------------------
{
  let g = E.firstListings(E.newGame(12007, parcels, 400_000_000), parcels, bbls);
  const pick = g.listings.map((li) => ({ li, rec: E.resolveRec(parcels, g, li.bbl) })).find((x) => x.rec && x.rec.class === "multifamily" && x.rec.bldgArea > 0 && !x.li.distress && (x.li.occ ?? 0) > 0.9);
  const r = E.executePurchase(g, parcels, pick.li.bbl, pick.li.ask, "cash", false, 1); g = r.s;
  const noi0 = E.holdingNOIYr(pick.rec, g.econ, g.holdings[pick.li.bbl], g.month);
  // a 10% market shock, then one month: the roll turns a twelfth
  const shocked = structuredClone(g); for (const k of Object.keys(shocked.econ.rentIdx)) { shocked.econ.rentIdx[k] *= 0.9; if (shocked.econ.effRentIdx) shocked.econ.effRentIdx[k] *= 0.9; }
  const noiSpot = E.holdingNOIYr(pick.rec, shocked.econ, shocked.holdings[pick.li.bbl], shocked.month);
  const next = E.advanceMonth(shocked, parcels, bbls, adjacency);
  const noi1 = E.holdingNOIYr(pick.rec, next.econ, next.holdings[pick.li.bbl], next.month);
  const h1 = next.holdings[pick.li.bbl];
  const mkt = E.marketRentPsfYr(pick.rec, next.econ, h1.condition, h1.condIdx);
  ok(Math.abs(noiSpot / noi0 - 1) < 0.005, `${pick.rec.address}: the shock month itself changes in-place NOI ${pc(noiSpot / noi0 - 1)} — the roll is the roll`);
  ok(h1.resRentPsf !== undefined && h1.resRentPsf > mkt * 1.04, `a month on, in-place rent $${h1.resRentPsf?.toFixed(2)} is still over the $${mkt.toFixed(2)} market — a twelfth turned (NOI ${pc(noi1 / noi0 - 1)})`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
