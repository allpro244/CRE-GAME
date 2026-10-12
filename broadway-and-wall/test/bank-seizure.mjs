// A BANK FAILURE NEVER TAKES THE FIRM'S CASH.
//
// The owner asked for the deposit choice to go: picking a bank, an operating
// balance and a sweep was a mess, and in a regional crisis nearly every desk
// failed with the firm's money in it. Cash now sits inside the insurance limit
// and in Treasury bills (cashSplit in lenders.ts), the way a real treasury
// keeps it, so a failing desk stops lending but never seizes a deposit. And a
// claim on a receiver already carried by an OLD save still pays out, books as
// a balance-sheet inflow and closes the cash identity.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels } = loadCity(0, E.normalizeParcels);
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fail++; };

// ---- a failure with $230M of sale proceeds in the account
{
  const s = E.newGame(4242, parcels);
  s.cash = 230_000_000;
  s.cashMgmt = { sweep: false };          // an old save's "every dollar a deposit" is ignored
  const split = E.cashSplit(s);
  ok(split.exposed === 0 && split.atBank <= E.insuredLimit(s) && split.inBills > 229_000_000,
    `$${(split.inBills / 1e6).toFixed(1)}M in Treasury bills, $${(split.atBank / 1e3).toFixed(0)}K operating, nothing exposed`);
  const bank = E.bankOf(s);
  const yr = () => s.books?.find((b) => b.yr === Math.floor(s.month / 12)) ?? { ga: 0, bought: 0 };
  const nw0 = E.netWorth(s, parcels), cash0 = s.cash, b0 = { ...yr() };
  for (let i = 0; i < 400 && bank.failedM === undefined; i++) { bank.capital = -1; E.tickLenders(s); }
  ok(bank.failedM !== undefined, `${bank.name} failed`);
  ok(s.cash === cash0, "the firm's cash is untouched");
  ok(!(s.receivership ?? []).length, "no claim on a receiver");
  const b1 = yr();
  ok((b1.ga ?? 0) === (b0.ga ?? 0) && (b1.bought ?? 0) === (b0.bought ?? 0), "nothing booked");
  ok(Math.abs(E.netWorth(s, parcels) - nw0) < 1, "net worth unchanged");
  ok(!E.attentionItems(s, parcels).some((a) => a.key.startsWith("bank-")), "no bank alert stops the clock");
}

// ---- an old save's claim on a receiver still pays out
{
  const s = E.newGame(4242, parcels);
  s.cash = 5_000_000;
  const claim = { from: "First Harbor Bank", amount: 4_000_000, payM: s.month + 12, seizedM: s.month, lost: 1_000_000 };
  s.receivership = [claim];
  const yr = () => s.books?.find((b) => b.yr === Math.floor(s.month / 12)) ?? { sold: 0, interest: 0 };
  const before = s.cash;
  s.month = claim.payM;
  E.tickReceivership(s);
  const yb = yr();
  ok(Math.abs(s.cash - before - claim.amount) < 1, "an old claim comes back as cash");
  ok((yb.sold ?? 0) >= claim.amount, "redeemed as a balance-sheet inflow, not income");
  ok((yb.interest ?? 0) === 0, "no fake interest income");
}
console.log(fail ? `${fail} failed` : "a bank failure never takes the firm's cash");
process.exit(fail ? 1 : 0);
