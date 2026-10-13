// A COMPETITOR'S DEBT IS ITS LOANS (BANKING.md, handoff to the rivals revamp).
//
// Runs towns with nobody playing and asserts, every month, the identities the
// per-loan rewrite rests on — each of which can fail:
//   - a live firm's `debt` is its mortgages + its line + its construction;
//   - every mortgage sits on a deed its obligor owns, at a real desk;
//   - nothing changed a firm's debt without going through a loan (the ledger's
//     drift counter stays at zero);
//   - one bad building can default without defaulting the firm's whole book;
//   - balloons come off the rows' own maturities, and loans really renew;
//   - the line is an outstanding balance at a named bank, on the loan book.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
await import(join(HERE, "fresh.mjs"));
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const SEEDS = (process.env.SEEDS ?? "4242,77").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 30);
let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
console.log("\nRIVAL LOANS — a competitor's debt is the sum of real loans\n");

for (const [i, seed] of SEEDS.entries()) {
  const { parcels, adjacency, bbls } = loadCity(i, E.normalizeParcels);
  let g = E.firstListings(E.newGame(seed, parcels, 6_000_000), parcels, bbls);
  const desks = new Set(g.lenders.map((l) => l.name));
  let worstGap = 0, orphanRows = 0, strangers = 0, renewed = 0, partial = 0, defaultMonths = 0;
  let lineMonths = 0, lineOnBook = 0, rowsSeen = 0;
  const maturity = {};
  const drift0 = { ...E.debtDrift };
  for (let m = 0; m < YEARS * 12; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const rows = Object.values(g.cityLoans ?? {});
    rowsSeen += rows.length;
    const book = E.cityLoanBook(g);
    for (const r of g.rivals) {
      if (r.failedM !== undefined) continue;
      const mine = rows.filter((x) => x.obligorId === r.id);
      const jobs = (g.cityJobs ?? []).filter((j) => j.firmId === r.id).reduce((a, j) => a + (j.debt ?? 0), 0);
      const sum = mine.reduce((a, x) => a + x.balance, 0) + (r.lineBal ?? 0) + jobs;
      worstGap = Math.max(worstGap, Math.abs(r.debt - sum));
      for (const x of mine) {
        if (!r.bbls.includes(x.bbl)) orphanRows++;
        if (!x.heldBy && !desks.has(x.lender)) strangers++;
      }
      const dflt = mine.filter((x) => x.status === "workout").length;
      if (dflt > 0) { defaultMonths++; if (dflt < mine.length) partial++; }
      if ((r.lineBal ?? 0) > 0) {
        lineMonths++;
        if (book.some((b) => b.kind === "line" && b.borrower === r.id && b.holder === r.lineBank)) lineOnBook++;
      }
    }
    for (const x of rows) {
      const prev = maturity[x.bbl];
      if (prev && prev.obligor === x.obligorId && x.maturityM > prev.mat && prev.mat <= g.month) renewed++;
      maturity[x.bbl] = { mat: x.maturityM, obligor: x.obligorId };
    }
  }
  const drift = E.debtDrift.n - drift0.n;
  console.log(`  seed ${seed}, ${YEARS} years: ${Math.round(rowsSeen / (YEARS * 12))} mortgages a month on the record`);
  check(worstGap <= 2, `every firm's debt is its loans + line + construction (worst gap $${worstGap})`);
  check(drift === 0, `nothing moved a firm's debt outside a loan (${drift} drift corrections, $${Math.round((E.debtDrift.abs - drift0.abs) / 1e3)}K)`);
  check(orphanRows === 0, `every mortgage sits on a deed its borrower owns (${orphanRows} that do not)`);
  check(strangers === 0, `every bank-held mortgage names a real desk (${strangers} that do not)`);
  check(renewed > 0, `balloons come due on the rows and renew (${renewed} renewals)`);
  check(defaultMonths === 0 || partial > 0, `a firm can default one loan without all of them (${partial} of ${defaultMonths} firm-months with a default were partial)`);
  check(lineMonths > 0 && lineOnBook === lineMonths, `a drawn line is on its bank's book (${lineOnBook}/${lineMonths} firm-months)`);
}
console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);
