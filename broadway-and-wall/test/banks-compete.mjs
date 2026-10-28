// BANKS COMPETE (ONE_ECONOMY_PLAN.md step 5).
//
//   node test/banks-compete.mjs
//
// Each desk prices off its own books and its rivals, every borrower shops,
// every loan has a named borrower, and the credit window is what the desks
// want to lend. Each check below can fail:
//   - quotes differ by desk, and one desk's quote moves with its own funding;
//   - a desk that is losing its share of new lending sharpens its price, and
//     one winning too much widens;
//   - a borrower takes the best quote: a firm's mortgage and a private owner's
//     refinanced balloon both land at the cheapest desk that will write them;
//   - a charge-off traces to a named borrower and building;
//   - the credit window tightens after real losses, against the same town
//     without them.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
await import(join(HERE, "fresh.mjs"));
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const tick = (g) => { g = E.advanceMonth(g, parcels, bbls, adjacency); return g.gameOver ? { ...g, gameOver: null, cash: 6e6 } : g; };
console.log("\nBANKS COMPETE — own costs, rivals, shopping borrowers, named losses\n");

let g = E.firstListings(E.newGame(4242, parcels, 6_000_000), parcels, bbls);
for (let m = 0; m < 8; m++) g = tick(g);

// ---- every loan is named; the book is the loans ---------------------------
{
  // The desks close their books mid-month (tickLenders); the street keeps
  // trading after, so the count to hold them to is the one they closed on.
  const book = E.cityLoanBook(g);
  for (const l of g.lenders) {
    if (l.failedM !== undefined) continue;
    check(l.book === l.namedBook && l.anonBook === undefined,
      `${l.name}: book ${Math.round(l.book / 1e6)}M is its named loans (${Math.round((l.namedBook ?? 0) / 1e6)}M)`);
  }
  const street = book.filter((x) => x.borrower.startsWith("h:"));
  check(street.length > 50 && street.every((x) => x.name && x.bbl),
    `the private owners' mortgages are on the record by name (${street.length} loans)`);
}

// ---- quotes differ by desk and move with each desk's own funding ----------
{
  const banks = g.lenders.filter((l) => l.kind === "bank" && l.failedM === undefined && l.dep?.rate !== undefined && l.book > 0);
  const live = banks.map((l) => E.liveSpread(g.econ.deskPx[l.name], 1.7, "income"));
  const distinct = new Set(live.map((x) => x.toFixed(3))).size;
  check(distinct > 1, `the same sheet prices differently at each bank: ${banks.map((l, i) => `${l.name.split(" ")[0]} ${live[i].toFixed(2)}`).join(" · ")}`);
  const l = banks.sort((a, b) => b.book - a.book)[0];
  const p = E.PRODUCTS.find((x) => x.lender === l.name && !x.floating && x.uwDscr > 0);
  const s2 = clone(g);
  const l2 = s2.lenders.find((x) => x.name === l.name);
  const before = E.quote(s2, p, 10e6, 750e3, "office", true, undefined, "good").ratePct;
  // the bank pays a point more for its deposits: its money costs more
  l2.dep.rate += 1;
  s2.econ.deskPx[l.name] = E.deskPricing(s2, l2);
  const after = E.quote(s2, p, 10e6, 750e3, "office", true, undefined, "good").ratePct;
  const exp = l2.dep.total / l2.book;
  check(after > before + 0.5 * exp - 0.01,
    `${l.name} paying a point more for deposits quotes ${before.toFixed(2)}% → ${after.toFixed(2)}% (deposits are ${(exp * 100).toFixed(0)}% of its book)`);
  const other = E.PRODUCTS.find((x) => x.lender !== l.name && x.lender !== undefined && !x.floating && x.uwDscr > 0 && x.lender !== "Meridian Street Capital");
  const o1 = E.quote(g, other, 10e6, 750e3, "office", true, undefined, "good").ratePct;
  const o2 = E.quote(s2, other, 10e6, 750e3, "office", true, undefined, "good").ratePct;
  check(Math.abs(o1 - o2) < 1e-9, `...and ${other.lender}'s quote does not move (${o1.toFixed(2)}%)`);
}

// ---- a desk losing share sharpens; a desk winning too much widens ---------
{
  const s2 = clone(g);
  const live = s2.lenders.filter((l) => l.failedM === undefined);
  const loser = live.find((l) => l.kind === "bank" && (l.usual0 ?? 0) > 0.03);
  const winner = live.find((l) => l !== loser && (l.usual0 ?? 0) > 0.03);
  // twelve months in which the winner wrote every new loan in town
  s2.loanTape = Array.from({ length: 12 }, (_, i) => ({ m: s2.month - 12 + i, by: { [winner.name]: 5_000_000 } }));
  const c0 = { lose: loser.chase ?? 0, win: winner.chase ?? 0 };
  for (let i = 0; i < 12; i++) E.priceDesks(s2);
  // where each pitches against the other desks: its price over its sheet less theirs
  const pitch = (q) => q.dFund + (q.dEl.income ?? 0) + q.chase;
  const vsRivals = (l) => {
    const o = live.filter((x) => x !== l);
    return pitch(s2.econ.deskPx[l.name]) - o.reduce((a, x) => a + pitch(s2.econ.deskPx[x.name]), 0) / o.length;
  };
  check(loser.chase < c0.lose - 0.05 && vsRivals(loser) < 0,
    `${loser.name}, behind its share, sharpens under its rivals: ${c0.lose.toFixed(2)} → ${loser.chase.toFixed(2)} pts (${vsRivals(loser).toFixed(2)} vs the others)`);
  check(vsRivals(winner) > 0 && vsRivals(winner) > vsRivals(loser) + 0.2,
    `${winner.name}, writing everything, prices over its rivals: ${vsRivals(winner) >= 0 ? "+" : ""}${vsRivals(winner).toFixed(2)} pts`);
  const sheet = 1.7;
  check(E.liveSpread(s2.econ.deskPx[loser.name], sheet, "income") < E.liveSpread(g.econ.deskPx[loser.name], sheet, "income"),
    `...and its quote comes down (${E.liveSpread(g.econ.deskPx[loser.name], sheet, "income").toFixed(2)} → ${E.liveSpread(s2.econ.deskPx[loser.name], sheet, "income").toFixed(2)} over the index)`);
  // the floor: no desk prices below its funding, its losses and its running cost
  for (let i = 0; i < 60; i++) E.priceDesks(s2);
  const px = s2.econ.deskPx[loser.name];
  check(E.liveSpread(px, 0.2, "income") >= E.costFloor(px, "income") - 1e-9, `the floor holds: ${E.liveSpread(px, 0.2, "income").toFixed(2)} ≥ cost ${E.costFloor(px, "income").toFixed(2)}`);
}

// ---- borrowers take the best quote --------------------------------------
{
  // the biggest office building in town, so every desk's cheque size is in play
  const rec = Object.values(parcels).map((p) => E.resolveRec(parcels, g, p.bbl)).filter((r) => r && r.class === "office" && r.bldgArea > 0)
    .sort((a, b) => b.bldgArea - a.bldgArea)[0];
  const v = E.assetValue(rec, g.econ, "good"), noi = E.noiAfterTaxYr(rec, g.econ, "good", v);
  const qs = E.deskQuotes(g, v, noi, { klass: "office", condition: "good" });
  const amt = Math.round(Math.min(v * 0.5, 2_000_000 * (g.econ.priceLevel ?? 1)));
  const rival = g.rivals.find((r) => r.failedM === undefined);
  // the best quote it QUALIFIES for: a desk without the capital or the
  // single-name room to carry the loan is not writing it, whatever it quotes
  const room = (q) => E.deskRoom(g, g.lenders.find((l) => l.name === q.lender), rival.id) >= amt;
  const best = qs.find((q) => q.principal >= amt * 0.98 && room(q));
  const pick = E.pickDesk(g, rival.id, amt, v, noi, { klass: "office", condition: "good" });
  check(qs.length > 2 && best && pick.lender === best.lender && pick.ratePct <= best.ratePct + 1e-9,
    `a firm's mortgage goes to the cheapest desk with room to write it: ${pick.lender} at ${pick.ratePct.toFixed(2)}% `
    + `(quotes: ${qs.slice(0, 5).map((q) => `${q.lender.split(" ")[0]} ${q.ratePct.toFixed(2)}${room(q) ? "" : " full"}`).join(", ")})`);

  // a private owner's balloon: refinanced at the best quote in town
  const s2 = clone(g);
  const loans = Object.values(s2.streetLoans).filter((x) => x.status === "current" && x.klass !== "land" && x.noiYr > 0 && x.value > 0);
  let tested = 0, right = 0;
  for (const x of loans.slice(0, 40)) {
    const q = E.deskQuotes(s2, x.value, x.noiYr, { klass: x.klass }).find((c) => c.principal >= x.balance * 0.98);
    if (!q) continue;
    x.maturityM = s2.month + 1;
    x.expect = q.lender + "|" + q.product;
    tested++;
  }
  let s3 = clone(s2);
  s3.month += 1;
  if (s3.month % 3 === 0) s3.month += 1;
  E.tickStreetLoans(s3, parcels);
  for (const x of Object.values(s3.streetLoans)) {
    if (!x.expect) continue;
    const want = E.deskQuotes(s3, x.value, x.noiYr, { klass: x.klass }).find((c) => c.principal >= x.balance * 0.98);
    if (want && x.lender === want.lender && x.originM === s3.month) right++;
  }
  check(tested >= 5 && right >= tested * 0.8, `private owners refinance their balloons at the best quote: ${right} of ${tested}`);
}

// ---- a charge-off traces to a named borrower --------------------------------
{
  const s2 = clone(g);
  const x = Object.values(s2.streetLoans).filter((y) => y.klass !== "land" && y.value > 1e6).sort((a, b) => b.balance - a.balance)[0];
  x.balance = Math.round(x.value * 1.4);        // the building is worth less than is owed
  x.arrearsMs = E.NOTICE_M + E.FORECLOSE_M - 1;  // and the court is about to rule
  s2.holderCash[x.holderId] = 0;
  s2.holderCfads[x.holderId] = { cfads: -1e9, cap: 0 };
  s2.month += s2.month % 3 === 2 ? 2 : 1;
  const l = s2.lenders.find((y) => y.name === x.lender);
  const cap0 = l.capital;
  E.tickStreetLoans(s2, parcels);
  const hit = (l.lossLog ?? [])[0];
  check(!s2.streetLoans[x.bbl] && hit && hit.borrower === x.holder && hit.bbl === x.bbl && hit.amount > 0,
    `${x.lender} charges off ${hit ? `$${(hit.amount / 1e6).toFixed(2)}M` : "nothing"} against ${hit?.borrower ?? "?"} at ${hit?.bbl ?? "?"} (${hit?.how ?? "?"})`);
  check(l.capital < cap0, `...and it comes out of that desk's capital (${(cap0 / 1e6).toFixed(1)}M → ${(l.capital / 1e6).toFixed(1)}M)`);
  check(s2.listings.some((li) => li.bbl === x.bbl && li.receiverFor === x.lender), "...and the building is on the tape as the desk's REO");
  const line = s2.news.find((n) => n.bbl === x.bbl && n.why);
  const chain = line ? E.whyChain(s2, line.why) : [];
  check(chain.length > 0 && chain[0].t.includes(x.holder), `...and the news line's "why" names the borrower: ${chain[0]?.t ?? "none"}`);
}

// ---- the credit window tightens after real losses ---------------------------
{
  let calm = clone(g), hurt = clone(g);
  // Every private owner's building drops to two-thirds of what it owes, and
  // a third of them have already run out of road: the town's worst year.
  let n = 0;
  for (const x of Object.values(hurt.streetLoans)) {
    if (x.klass === "land") continue;
    x.balance = Math.round(Math.max(x.balance, x.value * 1.5));
    if (n++ % 3 === 0) { x.arrearsMs = E.NOTICE_M + E.FORECLOSE_M - 1; hurt.holderCash[x.holderId] = 0; }
  }
  const ci0 = calm.econ.creditIdx;
  for (let m = 0; m < 6; m++) { calm = tick(calm); hurt = tick(hurt); }
  const losses = (s) => s.lenders.reduce((a, l) => a + (l.lossLog ?? []).filter((y) => y.m >= g.month).reduce((b, y) => b + y.amount, 0), 0);
  check(losses(hurt) > losses(calm) * 2 + 1e6, `real foreclosures: $${(losses(hurt) / 1e6).toFixed(0)}M charged off vs $${(losses(calm) / 1e6).toFixed(0)}M`);
  check(hurt.econ.creditIdx < calm.econ.creditIdx - 0.02,
    `the window tightens: ${ci0.toFixed(3)} → ${hurt.econ.creditIdx.toFixed(3)} with the losses vs ${calm.econ.creditIdx.toFixed(3)} without (appetite ${hurt.bankApp} vs ${calm.bankApp})`);
  const ev = (hurt.why?.ev ?? []).filter((x) => x.k === "credit.tighten" && x.m >= g.month);
  const cause = ev.length ? E.whyGet(hurt, ev[0].c?.[0]) : undefined;
  check(ev.length > 0 && cause?.k === "bank.appetite",
    `the cause ledger says which desk shut it: ${ev[0]?.t ?? "no event"} <- ${cause?.t ?? "?"}`);
  const sp = (s) => E.liveSpread(s.econ.deskPx["Alden Savings & Trust"], 1.7, "income");
  check(sp(hurt) > sp(calm), `...and the desks price it: Alden's 1.70 sheet at ${sp(hurt).toFixed(2)} vs ${sp(calm).toFixed(2)}`);
}

console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
process.exit(bad ? 1 : 0);
