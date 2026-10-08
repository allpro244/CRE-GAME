// CLEAR THE TRAY AGAINST MY TERMS — the principal's own pen, in one pass.
//
//   pnpm engine && node test/tray.mjs
//
// The principal runs the one clearing engine over every letter waiting on
// them. Checked:
//   1. the preview sorts every waiting letter into a pile, and a competing
//      tour or an expansion stays with the principal;
//   2. a pass moves money only through the ledger: for every pass over five
//      years, Δcash = −Δleasing −Δcapex + Δline + Δdeposits, to the dollar;
//   3. the principal pays the principal's 4% on a new lease, not a desk's 6%;
//   4. no desk scorecard moves — no desk acted;
//   5. what the principal signs is remembered, so a desk taking over later
//      is briefed from it.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const ok = (c, msg) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${msg}`); if (!c) bad++; };

function gift(g, rec) {
  const worth = E.assetValue(rec, g.econ, E.initialCondition(rec));
  const grade = E.gradeOf(g, rec);
  const h = {
    bbl: rec.bbl, boughtM: g.month, costBasis: worth, assessed: worth, loan: null,
    condition: grade, condIdx: E.initialCondIdx(rec, g.month, grade),
    service: 0, stance: 0, plan: 1, svcIdx: 0.55, tenants: [], cfHistory: [],
  };
  E.genRentRoll(g, rec, h, false, true);
  g.holdings[rec.bbl] = h;
  E.clearRivalClaims(g, rec.bbl);
  g.listings = (g.listings ?? []).filter((l) => l.bbl !== rec.bbl);
}
const books = (g, k) => (g.books ?? []).reduce((a, y) => a + (y[k] ?? 0), 0);
const deposits = (g) => Object.values(g.holdings).reduce((a, h) => a + h.tenants.reduce((b, t) => b + (t.deposit ?? 0), 0), 0);

let g = structuredClone(E.firstListings(E.newGame(550991, parcels, 5_000_000), parcels, bbls));
g.cash = 30e6;
const recs = bbls.map((b) => E.resolveRec(parcels, g, b))
  .filter((r) => r && r.bldgArea > 6000 && E.isCommercial(r) && !E.isCivicLand(g, r.bbl))
  .slice(0, 25);
for (const r of recs) gift(g, r);
for (const h of Object.values(g.holdings)) { h.tenants = h.tenants.filter((_, i) => i % 2 === 0); delete h.blocks; }

// ------------------------------------------------------------- 1. the preview
console.log("the preview");
for (let m = 0; m < 24 && g.lois.filter((l) => E.loiNeedsPrincipal(g, l)).length < 4; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
const waiting = g.lois.filter((l) => E.loiNeedsPrincipal(g, l));
const rows = E.previewTray(g, parcels);
ok(waiting.length >= 2, `letters arrived on the desk (${waiting.length})`);
ok(rows.length === waiting.length, `every waiting letter is in a pile (${rows.length} of ${waiting.length})`);
const piles = rows.reduce((a, r) => { a[r.pile] = (a[r.pile] ?? 0) + 1; return a; }, {});
console.log(`      piles: ${JSON.stringify(piles)}`);
ok(rows.filter((r) => r.loi.kind === "expansion").every((r) => r.pile === "yours"), "an incumbent expansion stays with you");
ok(rows.filter((r) => r.pile === "counter").every((r) => r.counter && r.counter.tiPsf === (r.loi.tiPsf ?? 0)),
  "a counter keeps the tenant's allowance (nobody turned away for the package)");

// ------------------------------------------------------------- 2-4. five years of passes
console.log("five years of passes reconcile");
let passes = 0, worst = 0, deskMoved = 0, signedTotal = 0, signedNew = 0;
for (let m = 0; m < 60; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) break;
  if (!g.lois.some((l) => E.loiNeedsPrincipal(g, l))) continue;
  const before = { cash: g.cash, leasing: books(g, "leasing"), capex: books(g, "capex"), loc: g.loc?.balance ?? 0, dep: deposits(g), desk: JSON.stringify(g.deskMonth ?? null) };
  const pendingNew = g.lois.filter((l) => E.loiNeedsPrincipal(g, l) && l.kind === "new");
  const r = E.clearTrayAgainstPlan(g, parcels);
  const s = r.s;
  signedNew += pendingNew.filter((l) => s.holdings[l.bbl]?.tenants.some((x) => x.name === l.name)).length;
  passes++;
  signedTotal += r.signed;
  const explained = -(books(s, "leasing") - before.leasing) - (books(s, "capex") - before.capex)
    + ((s.loc?.balance ?? 0) - before.loc) + (deposits(s) - before.dep);
  worst = Math.max(worst, Math.abs((s.cash - before.cash) - explained));
  if (JSON.stringify(s.deskMonth ?? null) !== before.desk) deskMoved++;
  g = s;
}
ok(passes >= 5, `the tray was cleared ${passes} times (${signedTotal} leases signed)`);
ok(worst < 1, `every pass reconciles to the dollar (worst residual $${worst.toFixed(2)})`);
ok(deskMoved === 0, "no desk scorecard moved — no desk acted");

// the fee, on one planted letter that signs as written
let probeRemembered = -1;
{
  const t = structuredClone(g);
  const bbl = Object.keys(t.holdings).find((b) => !t.holdings[b].broker && E.vacantSf(E.resolveRec(parcels, t, b), t.holdings[b]) > 3000);
  if (bbl) {
    const rec = E.resolveRec(parcels, t, bbl);
    const h = t.holdings[bbl];
    const use = E.leasableUses(rec)[0];
    const mk = E.managedRentPsfYr(rec, t.econ, h, use);
    const L = { id: 99001, bbl, use, kind: "new", name: "Fee Probe", sector: "law", credit: 2, sf: 2500, rentPsf: +(mk * 1.3).toFixed(2), termM: 60, tiPsf: 5, freeM: 0, bumpPct: 3, net: true, expiresM: t.month + 3, arrivedM: t.month };
    t.lois = [L];
    const lea0 = books(t, "leasing");
    const r = E.clearTrayAgainstPlan(t, parcels);
    const paid = books(r.s, "leasing") - lea0;
    probeRemembered = (r.s.principalSigned ?? []).length;
    ok(r.signed === 1 && Math.abs(paid - E.loiSigningCost(L, 0.04)) < 2,
      `signed as written at the principal's 4% (paid ${Math.round(paid)}, 4% would be ${Math.round(E.loiSigningCost(L, 0.04))}, 6% ${Math.round(E.loiSigningCost(L, 0.06))})`);
  } else ok(true, "no vacant non-broker building for the fee probe");
}

// ------------------------------------------------------------- 5. the record
console.log("the record briefs a desk later");
// Only NEW leases brief a desk (renewals say nothing about the market), so the
// five-year record is checked against the new leases actually signed, and the
// planted new letter above must be remembered whatever the market produced.
ok(probeRemembered !== 0 && ((g.principalSigned ?? []).length > 0 || signedNew === 0),
  `signings remembered (${(g.principalSigned ?? []).length} of ${signedNew} new leases signed in five years; planted letter ${probeRemembered < 0 ? "not run" : probeRemembered})`);
const plan = E.seedPlanFromRecord(g);
console.log(`      a desk hired now would be briefed: ${JSON.stringify(plan.sheet.office)} from ${JSON.stringify(plan.seededFrom)}`);
ok(!!plan.sheet.office, "the brief exists");

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
