// BLIND BID BEFORE THE STACK — name a number without structuring debt.
//
//   pnpm engine && node test/blind-bid.mjs
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

console.log("\nBLIND BID / NO STACK\n");

const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(91001, parcels, 80_000_000), parcels, bbls);

// Find an unowned built parcel and force a "make me an offer" approach.
const bbl = bbls.find((b) => {
  const r = E.resolveRec(parcels, g, b);
  return r && r.class !== "land" && r.bldgArea > 0 && !g.holdings[b] && !(g.listings ?? []).some((l) => l.bbl === b);
});
if (!bbl) throw new Error("no off-market building");

const approached = E.approachOwner(g, parcels, adjacency, bbl);
if (approached.err) throw new Error(approached.err);
g = approached.s;
const ap = g.approaches[bbl];
if (!ap) throw new Error("no approach record");

// If they named an ask, rewrite into a blind conversation for the harness.
if (ap.ask !== undefined || ap.reserve === undefined) {
  const value = E.assetValue(
    E.resolveRec(parcels, g, bbl),
    g.econ,
    E.initialCondition(E.resolveRec(parcels, g, bbl)),
  );
  ap.mode = "offer";
  ap.reserve = Math.round(value * 1.4 / 1000) * 1000;
  delete ap.ask;
  delete ap.named;
  ap.probes = 0;
  delete ap.lastBid;
}

check(ap.ask === undefined && ap.reserve > 0, "fixture is a live make-me-an-offer conversation");
check(typeof E.submitBlindBid === "function", "submitBlindBid is exported");

// Soft probe — well under reserve — must not require a loan product.
{
  const soft = Math.round(ap.reserve * 0.85 / 1000) * 1000;
  const cash0 = g.cash;
  const r = E.submitBlindBid(g, parcels, bbl, soft);
  check(!r.err, `soft bid returns without stack error (${r.err ?? "ok"})`);
  g = r.s;
  check(g.cash === cash0 || g.approaches[bbl], "soft probe does not force a purchase");
  check(
    !g.holdings[bbl],
    "soft bid under reserve does not hand over the deed",
  );
}

// Winning bid — at/above reserve — goes under contract, not straight to deed.
{
  // Refresh a clean blind approach if the soft bid walked them.
  if (!g.approaches[bbl]?.reserve) {
    g.approaches[bbl] = {
      q: g.month, mode: "offer", reserve: Math.round(5_000_000 / 1000) * 1000, probes: 0,
    };
  }
  const reserve = g.approaches[bbl].reserve;
  const win = reserve + 50_000;
  const cash0 = g.cash;
  const r = E.submitBlindBid(g, parcels, bbl, win);
  check(!r.err, `winning bid accepts (${r.err ?? "ok"})`);
  g = r.s;
  const t = g.talks?.[bbl];
  check(!!t?.agreed, "winning blind bid puts the building under contract");
  check(t?.agreedPrice === win, "contract price is the bid");
  check(!g.holdings[bbl], "deed does not transfer until closeDeal funds it");
  check(!g.approaches[bbl], "approach clears once you are under contract");
  const dep = t?.deposit ?? 0;
  check(dep > 0 && g.cash === cash0 - dep, "only earnest money left the account");
  check(/under contract|structure the stack|fund/i.test(r.msg ?? ""), "toast points at funding next");
}

// Funding is the second act — closeDeal with a product.
{
  const t = g.talks?.[bbl];
  if (!t?.agreed) {
    console.log("  SKIP  closeDeal — no live contract from winning bid");
  } else {
    const closed = E.closeDeal(g, parcels, bbl, "cash", 1);
    check(!closed.err, `closeDeal funds the blind contract (${closed.err ?? "ok"})`);
    g = closed.s;
    check(!!g.holdings[bbl], "deed lands when the stack is funded");
    check(!g.talks?.[bbl]?.agreed, "contract clears after close");
  }
}

// AN OWNER ANSWERS AGAINST ITS FLOOR, NOT A DIE. The same bid or counter,
// with the random stream moved to twenty places, gets the same answer; a bid
// at or over the floor is taken and one a room under it is not.
{
  const other = bbls.find((b) => {
    const r = E.resolveRec(parcels, g, b);
    return b !== bbl && r && r.class !== "land" && r.bldgArea > 0 && !g.holdings[b] && !(g.listings ?? []).some((l) => l.bbl === b);
  });
  const floor = 4_000_000, ask = Math.round(floor * (1 + E.OWNER_ROOM) / 1000) * 1000;
  const fixture = (extra = {}) => {
    const st = structuredClone(g);
    st.cash = Math.max(st.cash, 50e6);
    st.approaches[other] = { q: st.month, refused: false, mode: "ask", ask, reserve: floor, ...extra };
    return st;
  };
  const answers = (fn) => {
    const seen = new Set();
    for (let k = 0; k < 20; k++) {
      const st = fixture();
      for (let d = 0; d <= k; d++) { E.rng(st); E.rng(st, "sales"); E.rng(st, "owners"); }
      const r = fn(st);
      const a = r.s.approaches?.[other];
      seen.add(r.err ? `err:${r.err}` : `${r.msg}|${a?.ask ?? "-"}`);
    }
    return [...seen];
  };
  const take = answers((st) => E.counterOffMarket(st, parcels, adjacency, other, floor));
  check(take.length === 1 && /accepted/i.test(take[0]), `a counter at the floor is taken, every time (${take.join(" / ")})`);
  const near = answers((st) => E.counterOffMarket(st, parcels, adjacency, other, Math.round(floor * 0.95)));
  check(near.length === 1 && /came down|held/i.test(near[0]), `a counter 5% under the floor is countered back once, every time (${near.join(" / ")})`);
  const far = answers((st) => E.counterOffMarket(st, parcels, adjacency, other, Math.round(floor * 0.6)));
  check(far.length === 1 && /walked/i.test(far[0]), `a counter 40% under the floor ends it, every time (${far.join(" / ")})`);
  const under = answers((st) => E.buyOffMarket(st, parcels, other, "cash", 1, Math.round(floor * 0.97)));
  check(under.length === 1 && !/Done/.test(under[0]), `a bid under the floor is never a sale, however often asked (${under.join(" / ")})`);
  const blind = answers((st) => { st.approaches[other] = { q: st.month, refused: false, mode: "offer", reserve: floor, probes: 0 }; return E.submitBlindBid(st, parcels, other, Math.round(floor * 0.93)); });
  check(blind.length === 1 && /named/i.test(blind[0]), `a blind bid within a room of the floor draws the number, every time (${blind.join(" / ")})`);
  const odds = E.counterTakeOdds(g, adjacency, other, { ask }, Math.round(floor * 0.95));
  check(odds > 0 && odds < 1, `the panel's odds are the player's uncertainty about the room (${odds.toFixed(2)} at 5% under the narrowest floor)`);
}

if (bad) {
  console.error(`\n${bad} check(s) failed\n`);
  process.exit(1);
}
console.log("\nAll blind-bid checks passed.\n");
