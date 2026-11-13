// A BUILDING BOUGHT CHEAP IS LENT ON AS THE BUILDING IT IS.
//
//   pnpm engine && node test/cheap-buy-loan.mjs
//
// The owner's worked example: $1M paid for a building earning $18K a month
// ($216K a year) that the market would value near $3M. A purchase loan at
// three quarters of the price covers its payments more than three times.
//
// The desk's loss model read the PRICE as the building's value, so it sized
// this loan as if the collateral were worth $1M: 64% of cost at the hometown
// bank in an ordinary window (seed 11, month 1), 4.5x covered. The basis a
// desk's policy advance is struck on is the lesser of cost and appraisal (12
// CFR 34 Subpart D App. A) — that part is the rule — but what it would
// recover on is the building. This holds:
//   1. bought under its appraisal, the model's advance is on the appraisal and
//      the desk's policy ceiling on the price is what binds;
//   2. the loan never exceeds that ceiling on the price (no borrowing the
//      discount at closing);
//   3. bought AT its appraisal, nothing changed;
//   4. the month after, a seasoning desk still values it at cost (REFI_SEASON_M)
//      and transitional paper lends on the appraisal — more than was paid.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const pc = (x) => `${(x * 100).toFixed(0)}%`;
const PRICE = 1_000_000, NOI = 216_000, VALUE = 3_000_000;
const nw = { nw: 50_000_000 };

for (const seed of [11, 550991]) {
  const g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const bank = E.PRODUCTS.find((p) => p.id === "harbor");
  const fund = E.PRODUCTS.find((p) => p.id === "cordage");
  for (const klass of ["multifamily", "office"]) {
    const blind = E.quote(g, bank, PRICE, NOI, klass, false, undefined, "good", nw);
    const seen = E.quote(g, bank, PRICE, NOI, klass, false, undefined, "good", nw, VALUE);
    const ceiling = bank.maxLTV - 0.03;
    const pay = 12 * E.monthlyPayment(seen.principal, seen.ratePct, bank.amortYears);
    console.log(`   seed ${seed} ${klass}: price as value ${pc(blind.principal / PRICE)} of cost · on the appraisal ${pc(seen.principal / PRICE)} of cost at ${seen.ratePct.toFixed(2)}%, covered ${(NOI / pay).toFixed(2)}x`);
    ok(seen.principal >= blind.principal, `seed ${seed} ${klass}: the appraisal never lowers the loan`);
    ok(seen.principal / PRICE >= 0.75 && seen.principal / PRICE <= ceiling + 0.005,
      `seed ${seed} ${klass}: bought at a third of its appraisal, the bank lends ${pc(seen.principal / PRICE)} of the price — its policy ceiling (${pc(ceiling)}), not its loss model, is what binds`);
    ok(NOI / pay >= 2.5, `seed ${seed} ${klass}: and the loan covers its payments ${(NOI / pay).toFixed(2)}x`);
    const par = E.quote(g, bank, VALUE, NOI, klass, false, undefined, "good", nw);
    const parA = E.quote(g, bank, VALUE, NOI, klass, false, undefined, "good", nw, VALUE);
    ok(par.principal === parA.principal && par.ratePct === parA.ratePct, `seed ${seed} ${klass}: bought at its appraisal, the quote is what it was (${pc(par.principal / VALUE)})`);
  }
  // the month after: a seasoning desk at cost, transitional paper on the appraisal
  const coll = { value: VALUE, costCap: PRICE };
  ok(E.collateralFor(bank, coll) === PRICE, `seed ${seed}: inside ${E.REFI_SEASON_M} months the bank refinances on what was paid`);
  ok(E.collateralFor(fund, coll) === VALUE, `seed ${seed}: the debt fund lends on the appraisal the next month`);
  const bridge = E.quote(g, fund, E.collateralFor(fund, coll), NOI, "multifamily", false, undefined, "good", nw, VALUE);
  ok(bridge.principal > PRICE, `seed ${seed}: its refinance the next month is ${pc(bridge.principal / PRICE)} of the price paid (${pc(bridge.principal / VALUE)} of value)`);
  const seasoned = E.quote(g, bank, VALUE, NOI, "multifamily", false, undefined, "good", nw, VALUE);
  console.log(`   seed ${seed}: seasoned, the bank refinances ${pc(seasoned.principal / VALUE)} of value = ${pc(seasoned.principal / PRICE)} of the price paid`);
}
console.log(fails ? `\n${fails} FAILED` : "\nall OK");
process.exit(fails ? 1 : 0);
