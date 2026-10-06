// THE CLOCK STOPS FOR DECISIONS, NOT FOR NOTICES.
//
//   pnpm engine && node test/quiet-clock.mjs
//
// Three things the fifty-year $1M playthrough (PLAYTHROUGH_2026-10-06.md)
// found stopping the clock with nothing to decide:
//   1. a balloon any desk would renew — the tick already rolls it, so the
//      notice is soft; one that would NOT roll still stops the clock;
//   2. a clean sale contract — it closes itself on its date, through the
//      ledger, instead of asking for the same price twice;
//   3. first looks with no buy box — the box the book implies is offered.
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
  return h;
}

let g = structuredClone(E.firstListings(E.newGame(4242, parcels, 5_000_000), parcels, bbls));
const recs = bbls.map((b) => E.resolveRec(parcels, g, b))
  .filter((r) => r && r.bldgArea > 8000 && r.class === "office" && !E.isCivicLand(g, r.bbl))
  .slice(0, 3);
for (const r of recs) gift(g, r);
const [a, b] = recs;

// ---------------------------------------------------------------- 1. balloons
console.log("balloons");
{
  const s = structuredClone(g);
  const h = s.holdings[a.bbl];
  const value = E.ownedHoldingValue(s, parcels, h);
  h.loan = { product: "savings", principal: value * 0.4, balance: value * 0.4, ratePct: 6, amortYears: 30, monthlyPmt: 1000, maturityM: s.month + 10, startM: s.month - 50 };
  const it = E.attentionItems(s, parcels).find((x) => x.key.startsWith(`balloon:${a.bbl}`));
  ok(it && it.soft && it.key.endsWith(":rolls"), `a 40% LTV balloon that any desk renews is a soft notice (${it?.key})`);
  ok(/Renews on its own/.test(it?.label ?? ""), `and says who renews it: "${(it?.label ?? "").slice(0, 110)}"`);
  const stop = E.stopRule(structuredClone(g), parcels);
  ok(!stop(s) || !stop(s).key.startsWith("balloon"), "it does not stop the clock");
  h.loan.balance = h.loan.principal = value * 1.4;
  const it2 = E.attentionItems(s, parcels).find((x) => x.key.startsWith(`balloon:${a.bbl}`));
  ok(it2 && !it2.soft && it2.key.endsWith(":gap"), `a 140% LTV balloon nobody renews is a hard stop (${it2?.key})`);
  ok(stop(s)?.key.startsWith("balloon"), "and it stops the clock");
}

// ---------------------------------------------------------------- 2. contracts
console.log("clean contracts close on their date");
{
  let s = structuredClone(g);
  const h = s.holdings[b.bbl];
  const px = Math.round(E.ownedHoldingValue(s, parcels, h));
  h.sale = { ask: px, listedM: s.month, mode: "marketed", offer: { price: px, expiresM: s.month + 2, from: "Test Buyer", contract: true } };
  const it = E.attentionItems(s, parcels).find((x) => x.key.includes(b.bbl));
  ok(it?.soft && it.key.startsWith("contract-close"), `under contract is a soft docket row (${it?.key})`);
  const cash0 = s.cash;
  s = E.advanceMonth(s, parcels, bbls, adjacency);
  ok(!!s.holdings[b.bbl], "month 1: not closed yet");
  s = E.advanceMonth(s, parcels, bbls, adjacency);
  ok(!s.holdings[b.bbl], "month 2: closed on the contract date with no click");
  ok(s.news.some((n) => /^Closed: .* on the contract you signed/.test(n.text)), "the tape says so");
  ok(s.cash > cash0 + px * 0.5, `the proceeds arrived (${Math.round((s.cash - cash0) / 1000)}K on a ${Math.round(px / 1000)}K sale)`);
  const sold = (s.books ?? []).reduce((acc, y) => acc + (y.sold ?? 0), 0);
  ok(sold > 0, "through the ledger (`sold` booked)");
}

// ---------------------------------------------------------------- 3. buy box
console.log("a buy box from the book");
{
  const box = E.suggestBuyBox(g, parcels);
  ok(box && box.uses?.includes("office") && box.maxAsk > 0, `suggested: ${JSON.stringify(box)}`);
  const empty = structuredClone(E.newGame(4242, parcels, 1e6));
  ok(E.suggestBuyBox(empty, parcels) === null, "no suggestion with nothing bought");
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
