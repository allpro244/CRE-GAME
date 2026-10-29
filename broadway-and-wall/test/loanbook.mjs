// THE LOAN BOOK AND THE ONE PRICE LAW (BANKING.md).
//
// Asserts the identities the banking revamp rests on, each of which can fail:
//   - a desk's book is the named loans it holds, and nothing else;
//   - every lien the player has is on the book, under the right holder;
//   - the junior and private money widen when the window shuts;
//   - the line answers to its bank's own losses and appetite;
//   - the conduit can extend (it could not), the bought-note test is per note.
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
console.log("\nLOAN BOOK — every named loan on a real desk, one price law\n");

let g = E.firstListings(E.newGame(4242, parcels, 6_000_000), parcels, bbls);
for (let m = 0; m < 4; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);

// ---- the book is the loans ----------------------------------------------
for (const l of g.lenders) {
  if (l.failedM !== undefined) continue;
  check(l.anonBook === undefined && Math.abs(l.book - (l.namedBook ?? 0)) <= 2,
    `${l.name}: book ${Math.round(l.book / 1e6)}M = its named loans ${Math.round((l.namedBook ?? 0) / 1e6)}M`);
}
const street = E.cityLoanBook(g).filter((x) => x.borrower !== "player");
check(street.length > 0, `the street's mortgages are on the book (${street.length} loans)`);
// no desk opens the game below its own capital target by more than a rounding
for (const l of g.lenders) {
  if (l.failedM !== undefined) continue;
  check(l.capital / l.book >= E.targetCapital(l.name) * 0.85,
    `${l.name} opens near its own target: ${(100 * l.capital / l.book).toFixed(1)}% vs ${(100 * E.targetCapital(l.name)).toFixed(1)}%`);
}

// ---- the player's liens, all of them, under the right holder ------------
{
  const li = g.listings.map((l) => ({ l, rec: E.resolveRec(parcels, g, l.bbl) }))
    .filter((x) => x.rec && x.rec.class !== "land" && x.rec.bldgArea > 6000 && x.l.ask < 4_000_000)
    .sort((a, b) => b.l.ask - a.l.ask)[0];
  const r = E.executePurchase(g, parcels, li.l.bbl, li.l.ask, "harbor", false, 1);
  check(!r.err && r.s.holdings[li.l.bbl]?.loan, `a First Harbor purchase closes with a loan${r.err ? ` (${r.err})` : ""}`);
  if (!r.err && r.s.holdings[li.l.bbl]?.loan) {
    const s = clone(r.s);
    s.loc.balance = 250_000;
    s.holdings[li.l.bbl].mezz = { ...s.holdings[li.l.bbl].loan, product: "mezz", holder: "Cordage Debt Partners", balance: 100_000, principal: 100_000 };
    const mine = E.cityLoanBook(s).filter((x) => x.borrower === "player");
    const kinds = new Set(mine.map((x) => x.kind));
    check(kinds.has("senior") && kinds.has("mezz") && kinds.has("line"), `senior, mezz and the line are all on the book (${[...kinds].join(", ")})`);
    check(mine.find((x) => x.kind === "senior")?.holder === "First Harbor Bank", "the senior sits with First Harbor");
    check(mine.find((x) => x.kind === "line")?.holder === E.lineLender(s)?.name, `the line sits with its bank (${E.lineLender(s)?.name})`);
    const by = E.deskTotals(E.cityLoanBook(s));
    check((by["Cordage Debt Partners"]?.yours ?? 0) >= 100_000, "the mezz counts toward Cordage's single-name exposure to you");
  }
}

// ---- one price law: the expensive money widens most when the window shuts
{
  const open = clone(g); open.econ.creditIdx = 1.0;
  const shut = clone(g); shut.econ.creditIdx = 0.6;
  const st = E.sponsorStanding(open);
  void st;
  const senior = (s) => E.deskRatePct(s.econ.indexRate, E.productById("savings").spread, { ci: s.econ.creditIdx, app: 1 });
  const mezz = (s) => E.deskRatePct(s.econ.indexRate, E.productById("mezz").spread, { ci: s.econ.creditIdx, app: 1 });
  const dS = senior(shut) - senior(open), dM = mezz(shut) - mezz(open);
  check(dM > dS && dS > 0, `a shut window widens the junior (+${dM.toFixed(2)}) more than the senior (+${dS.toFixed(2)})`);
  // THE LINE PRICES OFF ITS OWN BANK (pricing.ts liveSpread): a bank that
  // has been writing off its income-property book charges more for the line.
  const lr = (s) => E.locRate(s);
  const burnt = clone(g);
  const lb = burnt.lenders.find((l) => l.id === E.lineLender(burnt).id);
  lb.lossEw = { ...(lb.lossEw ?? {}), income: (lb.balEw?.income ?? lb.book) * 0.03 };
  E.priceDesks(burnt);
  check(lr(burnt) > lr(open), `the line reprices with its bank's losses: ${lr(open).toFixed(2)}% → ${lr(burnt).toFixed(2)}%`);
  // The line needs a borrowing base (credit.ts locLimit: income after the
  // mortgages, or land) — a firm that owns nothing has no line to cut. Own
  // one building free and clear first.
  const li = g.listings.map((l) => ({ l, rec: E.resolveRec(parcels, g, l.bbl) }))
    .filter((x) => x.rec && x.rec.class !== "land" && x.rec.bldgArea > 6000 && x.l.ask < 4_000_000)
    .sort((a, b) => b.l.ask - a.l.ask)[0];
  const owned = E.executePurchase(g, parcels, li.l.bbl, li.l.ask, "cash", false, 1);
  const base = owned.err ? g : owned.s;
  const weak = clone(base);
  const bank = E.lineLender(weak);
  const flush = clone(base);
  weak.lenders.find((l) => l.id === bank.id).appetite = 0.2;
  flush.lenders.find((l) => l.id === bank.id).appetite = 1.0;
  E.priceDesks(weak); E.priceDesks(flush);
  check(E.locRate(weak) > E.locRate(flush), `a line at a rationing bank costs more: ${E.locRate(flush).toFixed(2)}% vs ${E.locRate(weak).toFixed(2)}%`);
  check(E.locLimit(weak, parcels) < E.locLimit(flush, parcels), "and advances less");
  const failed = clone(g);
  failed.loc.balance = 50_000; failed.loc.lender = bank.name;
  failed.lenders.find((l) => l.id === bank.id).failedM = failed.month;
  check(E.locLimit(failed, parcels) === 50_000, "a receiver neither advances nor calls the drawn line");
}

// ---- the workout table, by who is across it ------------------------------
{
  const s = clone(g);
  const conduit = s.lenders.find((l) => l.kind === "conduit");
  conduit.capital = conduit.book * E.targetCapital(conduit.name) * 1.0; conduit.delinquent = 0.01; delete conduit.failedM;
  check(E.deskWillExtend(s, conduit.name, 20), "a healthy conduit's special servicer will modify (it never could)");
  const life = s.lenders.find((l) => l.kind === "life");
  life.capital = life.book * E.targetCapital(life.name) * 0.5; life.delinquent = 0.01;
  check(!E.deskWillExtend(s, life.name, 20), "a life company at half its own target is not 'healthy' for a stranger");
  check(E.isPrivatePaper({ product: "private", holder: "Anyone" }) && E.isPrivatePaper({ product: "cordage", holder: "Some Rival LP" })
    && !E.isPrivatePaper({ product: "cordage", holder: "Alden Savings & Trust" }) && !E.isPrivatePaper({ product: "miniperm", holder: "Alden Savings & Trust" }),
    "a bank-held mini-perm is not private paper; a firm's note is");
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
