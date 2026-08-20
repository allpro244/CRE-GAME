// RECEIVER BOOKS ARE BUYABLE ON MARKETPLACE — not a news dead end.
//
//   pnpm engine && pnpm exec node test/reo-books.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nREO / STREET BOOKS\n");

check(typeof E.buyPortfolio === "function", "buyPortfolio is exported");
check(typeof E.openReoPortfolio === "function", "openReoPortfolio is exported");

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g = E.newGame(44101, parcels, 80_000_000);

// Pick four standing commercial buildings the player does not own.
const pack = [];
for (const b of bbls) {
  const rec = parcels[b];
  if (!rec || rec.class === "land" || !rec.bldgArea || rec.bldgArea < 20_000) continue;
  if (g.holdings[b]) continue;
  pack.push(b);
  if (pack.length >= 4) break;
}
if (pack.length < 4) throw new Error("need four buildings for REO package fixture");

// Put them on a living rival so ownership is coherent, then seize the book.
const rival = (g.rivals ?? []).find((r) => r.failedM === undefined) ?? g.rivals?.[0];
if (!rival) throw new Error("no rival");
rival.bbls = [...new Set([...(rival.bbls ?? []), ...pack])];
rival.failedM = undefined;

E.openReoPortfolio(g, parcels, "First Harbor", pack, rival.name, 12_000_000);
const p = (g.portfolios ?? []).find((x) => x.reoBorrower === rival.name);
check(!!p, "openReoPortfolio puts a package on game.portfolios");
check(!!p?.reo && p.sellerLender === "First Harbor", "package is marked REO with the desk");
check(pack.every((b) => !g.listings.some((l) => l.bbl === b)),
  "packaged BBLs are pulled off the single-asset tape");
check((g.news ?? []).some((n) => /Marketplace|Books for sale/i.test(n.text)),
  "news points the player at Marketplace · Books for sale");

const attn = E.attentionItems(g);
check(attn.some((a) => a.key === `street-book:${p.id}`),
  "attentionItems stops Skip for a buyable street book");
check(/Marketplace/i.test(attn.find((a) => a.key === `street-book:${p.id}`)?.label ?? ""),
  "attention label names Marketplace");

// Rich enough to close — buyPortfolio is one cash cheque + 2% closing.
g.cash = Math.max(g.cash, p.ask + Math.round(p.ask * 0.02) + 1_000_000);
const before = Object.keys(g.holdings).length;
const r = E.buyPortfolio(g, parcels, p.id);
check(!r.err, `buyPortfolio succeeds (${r.err ?? "ok"})`);
g = r.s;
check(!(g.portfolios ?? []).some((x) => x.id === p.id), "package leaves the street book after purchase");
check(Object.keys(g.holdings).length > before, "player takes deeds from the package");
const taken = pack.filter((b) => g.holdings[b]).length;
check(taken >= 2, `at least two deeds conveyed (${taken} of ${pack.length})`);
check(!E.attentionItems(g).some((a) => a.key === `street-book:${p.id}`),
  "attention clears once the book is bought");

// A second book — the receiver talks. Take-it-or-leave-it at the ask is the
// wrong market for a lender that just took the package.
const pack2 = [];
for (const b of bbls) {
  const rec = parcels[b];
  if (!rec || rec.class === "land" || !rec.bldgArea || rec.bldgArea < 12_000) continue;
  if (g.holdings[b] || pack.includes(b) || pack2.includes(b)) continue;
  pack2.push(b);
  if (pack2.length >= 4) break;
}
check(pack2.length >= 4, "second REO fixture has four buildings");
if (pack2.length >= 4) {
  E.openReoPortfolio(g, parcels, "First Harbor", pack2, rival.name, 9_000_000);
  const p2 = (g.portfolios ?? []).find((x) => x.reo && x.bbls.some((b) => pack2.includes(b)));
  check(!!p2, "second REO package lists");
  check(typeof E.offerStreetBook === "function" && typeof E.bookReservation === "function",
    "offerStreetBook / bookReservation are exported");
  if (p2) {
    const reservation = E.bookReservation(p2);
    check(reservation < p2.ask && reservation >= Math.round(p2.ask * 0.85),
      `REO reservation is inside 88% of ask (${reservation} vs ask ${p2.ask})`);
    const insult = E.offerStreetBook(g, parcels, p2.id, Math.round(p2.ask * 0.50));
    check(!!insult.err, `insult is refused (${insult.err ?? "closed?"})`);
    const mid = E.offerStreetBook(g, parcels, p2.id, Math.round(p2.ask * 0.86));
    const still = (mid.s.portfolios ?? []).find((x) => x.id === p2.id);
    if (still) {
      check(!!still.talks, "86% of ask opens a counter (under the 88% reservation)");
      check(still.talks.theirPrice <= p2.ask, "their number is at or under the ask");
      mid.s.cash = Math.max(mid.s.cash, still.talks.theirPrice * 1.05);
      const acc = E.acceptStreetBook(mid.s, parcels, p2.id);
      check(!acc.err, `accepting their number closes (${acc.err ?? "ok"})`);
      check(!(acc.s.portfolios ?? []).some((x) => x.id === p2.id), "book leaves the tape after the counter");
    } else {
      check(!mid.err, `86% of ask closed (${mid.err ?? "ok"})`);
    }
    // At or above the ask they take the ask — even if you overbid.
    E.openReoPortfolio(g, parcels, "First Harbor", pack2.filter((b) => !g.holdings[b]).slice(0, 4), rival.name, 6_000_000);
    const p3 = (g.portfolios ?? []).find((x) => x.reo && x.id !== p2.id);
    if (p3) {
      g.cash = Math.max(g.cash, p3.ask * 1.1);
      const pay = E.offerStreetBook(g, parcels, p3.id, Math.round(p3.ask * 1.05));
      check(!pay.err, `offer at the ask closes (${pay.err ?? "ok"})`);
    }
  }
}

console.log("");
process.exit(bad ? 1 : 0);
