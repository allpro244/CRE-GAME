// A WONDERFUL CASH-FLOWING ASSET BORROWS LIKE ONE.
//
//   pnpm engine && pnpm refi-strong
//
// GATE. The owner: "I have a wonderful cashflowing asset yet the best loan I
// can get is a 2.2 DSCR." Reproduced on four seeds: full buildings refinanced
// at 2-7.5x coverage and 24-52% of the mark, from four stacked cuts — the
// credit window counted twice (standards band AND advanceFactor), a
// collateral haircut that took up to half the loan for "100% of the income
// is the law firms" or graded two shops at grade as an apartment block's
// roll, a bank "full" of the class its own town is made of, and a debt-yield
// floor that did not know apartments from offices. This holds the fixed
// shape: the haircut is a few points, never on the flats; in an ordinary
// window a stabilised building's best permanent quote is sized to the sheet
// or to 1.25-1.35x on the amortising payment; the window is one cut.
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
const near = (a, b, tol = 0.006) => Math.abs(a - b) <= tol;
const pc = (x) => `${(x * 100).toFixed(0)}%`;

// --- 1. the haircut is a committee's notch, weighted by what is commercial --
{
  const t = (sf, rentPsf, credit, endM, sector = "law") => ({ name: "t", use: "office", sector, credit, sf, rentPsf, startM: 0, endM });
  const office = { bbl: "x", class: "office", bldgArea: 20000, floors: 4, unitsRes: 0, lotArea: 5000 };
  const flats = { bbl: "y", class: "multifamily", bldgArea: 40000, floors: 6, unitsRes: 40, lotArea: 6000 };
  const econ = E.newGame(1, parcels).econ;
  const H = (tenants, extra = {}) => ({ bbl: "x", tenants, occ: 0.95, condition: "standard", boughtM: 0, costBasis: 0, programsDone: {}, ...extra });
  const single = E.collateralHaircut(H([t(20000, 40, 2, 130)]), 0, econ, office);
  ok(near(single.mult, 1), `one A tenant on a ten-year lease: no haircut (${single.mult.toFixed(2)}) — a credit-tenant lease is the most financeable income there is`);
  const weakShort = E.collateralHaircut(H([t(20000, 40, 0, 40)]), 0, econ, office);
  ok(near(weakShort.mult, 0.90) || near(weakShort.mult, 0.80), `one C tenant on three years: ${weakShort.mult.toFixed(2)} — ten points for the name, ten more only if it rolls inside two years`);
  const weakRolling = E.collateralHaircut(H([t(20000, 40, 0, 12)]), 0, econ, office);
  ok(near(weakRolling.mult, 0.80), `one C tenant rolling in a year: ${weakRolling.mult.toFixed(2)} — twenty points, the reserve in proceeds`);
  const lawFirms = E.collateralHaircut(H([t(5000, 40, 1, 90), t(5000, 40, 1, 100), t(5000, 40, 1, 110), t(5000, 40, 1, 120)]), 0, econ, office);
  ok(lawFirms.mult >= 0.93, `four law firms on long leases: ${lawFirms.mult.toFixed(2)} — one trade is a few points, not half the loan`);
  const twoFirms = E.collateralHaircut(H([t(10000, 40, 1, 90), t(10000, 40, 1, 100)]), 0, econ, office);
  ok(near(twoFirms.mult, 1, 0.03), `two firms in one line: ${twoFirms.mult.toFixed(2)} — every small building in town, no trade test under four names`);
  const shops = E.collateralHaircut(H([t(1500, 60, 0, 10, "food"), t(500, 60, 0, 12, "food")]), 0, econ, flats);
  ok(shops.mult >= 0.97, `a block of flats with two shops at grade: ${shops.mult.toFixed(2)} — the shops are graded as the share of income they are, the flats never`);
  const floor = E.collateralHaircut(H([t(20000, 40, 0, 6, "media")]), 0, { ...econ, industryStress: undefined }, office);
  ok(floor.mult >= 0.75, `the floor is 0.75 (${floor.mult.toFixed(2)}), not 0.5`);
}

// --- 2. the window is one cut -----------------------------------------------
{
  const g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const shut = structuredClone(g); shut.econ.creditIdx = 0.5; shut.bankApp = 0.5;
  const h = E.productById("harbor");
  const app = E.advanceFactor(shut, "First Harbor Bank");
  ok(near(app, Math.min(1.02, 0.55 + 0.45 * E.lenderAppetite(shut, "First Harbor Bank"))), `advanceFactor is the desk's appetite alone (${app.toFixed(3)}); the window moves the sheet`);
  const q = E.quote(shut, h, 4_000_000, 300_000, "office", false, undefined, "standard");
  ok(near(q.byLtv / 4_000_000, 0.58 * app, 0.01), `shut window: the hometown bank's advance leg is 58% × appetite = ${pc(q.byLtv / 4e6)} of value, not 58% × 0.86 × appetite`);
  const mid = structuredClone(g); mid.econ.creditIdx = 0.9; mid.bankApp = 0.9;
  const qm = E.quote(mid, h, 4_000_000, 300_000, "office", false, undefined, "standard");
  // coverage 1.40x shut vs 1.25x mid, on the same coupon basis
  const sv = E.productById("savings");
  const a = structuredClone(g); a.econ.creditIdx = 1.0; a.bankApp = 0.9;
  const b = structuredClone(g); b.econ.creditIdx = 1.0; b.bankApp = 0.65;
  const qa = E.quote(a, sv, 10_000_000, 700_000, "office", false, undefined, "standard");
  const qb = E.quote(b, sv, 10_000_000, 700_000, "office", false, undefined, "standard");
  const sa = E.underwritingStandards(a), sb = E.underwritingStandards(b);
  // the looser state underwrites to LESS coverage, so its leg is the larger one
  const uw = (st) => 1.25 + 0.15 * Math.max(0, -st) - 0.07 * Math.max(0, st);
  const expDscr = uw(sb) / uw(sa);
  ok(near(qa.ratePct, qb.ratePct, 0.011) && near(qa.byDscr / qb.byDscr, expDscr, 0.004), `coverage moves on standards (${sb.toFixed(2)} → ${sa.toFixed(2)}): DSCR leg ${(qa.byDscr / qb.byDscr).toFixed(3)}x (expected ${expDscr.toFixed(3)}x), same coupon`);
  void qm;
  // apartments: a lower debt-yield floor
  const qo = E.quote(mid, h, 4_000_000, 300_000, "office", false, undefined, "standard");
  const qf = E.quote(mid, h, 4_000_000, 300_000, "multifamily", false, undefined, "standard");
  ok(near(qf.byDebtYield / qo.byDebtYield, 1 / 0.85, 0.005), `the debt-yield floor on flats is 85% of the office floor (${(qf.byDebtYield / qo.byDebtYield).toFixed(3)}x proceeds on that leg)`);
}

// --- 3. from the owner's chair: stabilised buildings in an ordinary window ---
{
  let bad = 0, n = 0; const lines = [];
  for (const seed of [12007, 4242, 11, 550991]) {
    let g = E.firstListings(E.newGame(seed, parcels, 400_000_000), parcels, bbls);
    const cands = g.listings.map((li) => { const r = E.resolveRec(parcels, g, li.bbl); if (!r || r.class === "land" || !r.bldgArea || li.halfBuilt) return null; const ip = E.inPlace(r, g, li.bbl, li.ask); return { bbl: li.bbl, ask: li.ask, noi: ip.noi, occ: ip.occ, y: ip.noi / li.ask }; })
      .filter((x) => x && x.noi > 0 && x.ask > 1.5e6 && x.occ >= 0.85).sort((a, b) => b.y - a.y).slice(0, 5);
    for (const c of cands) { const r = E.executePurchase(g, parcels, c.bbl, c.ask, "cash", false, 1); if (!r.err) g = r.s; }
    for (let q = 0; q < 4; q++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
    // an ORDINARY window, whatever the era opened in
    g = structuredClone(g); g.econ.creditIdx = 0.95; g.bankApp = 0.95;
    for (const bbl of Object.keys(g.holdings)) {
      const h = g.holdings[bbl]; const rec = E.resolveRec(parcels, g, bbl);
      if (E.physicalOcc(rec, h) < 0.85) continue;
      const { value, noi, hair } = E.debtCollateral(g, parcels, h, rec);
      if (noi <= 0 || value <= 0) continue;
      const { quotes } = E.refiQuotes(g, parcels, bbl);
      const perm = quotes.filter((x) => x.available && x.maxProceeds > 0 && !["cordage", "mezz", "land"].includes(x.id)).sort((a, b) => b.maxProceeds - a.maxProceeds)[0];
      if (!perm) continue;
      n++;
      const sizedToSheet = perm.ltvAtMax >= perm.advanceLtv * hair.mult * 0.9 * 0.85;   // sheet × haircut × the desk's own appetite, less a little
      const sizedToCover = perm.dscrAtMax <= 1.40;
      const line = `${(rec.address ?? bbl).padEnd(22)} ${rec.class.padEnd(11)} occ ${pc(E.physicalOcc(rec, h))} NOI/mark ${pc(noi / value)} → ${perm.id.padEnd(9)} ${pc(perm.ltvAtMax)} of mark, DSCR ${perm.dscrAtMax.toFixed(2)} (${perm.binding}${perm.bindingWhy ? ": " + perm.bindingWhy : ""}) hair ${hair.mult.toFixed(2)}`;
      lines.push(line);
      if (!(sizedToSheet || sizedToCover)) { bad++; console.log("  ✗ " + line); }
    }
  }
  for (const l of lines.slice(0, 8)) console.log("    " + l);
  ok(n >= 5 && bad === 0, `${n} stabilised buildings in an ordinary window: every best permanent quote is sized to the sheet or to coverage (${bad} were neither)`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
