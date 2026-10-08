// A BANK FAILURE WITH THE FIRM'S MONEY IN IT: only the haircut is a loss.
//
// Reported from play: a firm holding ~$230M of sale proceeds lost all of it to
// "Firm overhead" the month its bank failed. The uninsured balance is frozen
// (it leaves the account) but the receiver pays most of it back, so the books
// must expense only the haircut, carry the claim as an asset in net worth, and
// redeem it as cash later — and the cash identity must close throughout.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels } = loadCity(0, E.normalizeParcels);
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fail++; };

const s = E.newGame(4242, parcels);
s.cash = 230_000_000;
const bank = E.bankOf(s);
const yr = () => s.books?.find((b) => b.yr === Math.floor(s.month / 12)) ?? { ga: 0, bought: 0, sold: 0, interest: 0 };
const nw0 = E.netWorth(s, parcels), cash0 = s.cash, b0 = { ...yr() };
// drive the bank under until the regulator closes it
for (let i = 0; i < 400 && bank.failedM === undefined; i++) { bank.capital = -1; E.tickLenders(s); }
ok(bank.failedM !== undefined, `${bank.name} failed`);
const claim = s.receivership?.[0];
ok(!!claim, "a claim on the receiver was filed");
const b1 = yr();
const exposed = cash0 - s.cash;
const ga = b1.ga - (b0.ga ?? 0), bought = b1.bought - (b0.bought ?? 0);
console.log(`  frozen ${(exposed / 1e6).toFixed(1)}M · expensed ${(ga / 1e6).toFixed(1)}M · claim ${(claim.amount / 1e6).toFixed(1)}M · lost ${(claim.lost / 1e6).toFixed(1)}M`);
ok(Math.abs(ga - claim.lost) < 1, "only the haircut is expensed under overhead");
ok(Math.abs(bought - claim.amount) < 1, "the claim is booked as an asset exchanged for the cash");
ok(Math.abs(ga + bought - exposed) < 1, "every frozen dollar is booked (cash identity)");
const nw1 = E.netWorth(s, parcels);
ok(Math.abs((nw0 - nw1) - claim.lost) < 2, `net worth falls by the haircut only (${((nw0 - nw1) / 1e6).toFixed(1)}M)`);
ok(E.attentionItems(s, parcels).some((a) => a.critical && a.key.startsWith("bank-seized:")), "it stops the clock as a critical item");
// the receiver pays
const before = s.cash, sold0 = yr().sold ?? 0, int0 = yr().interest ?? 0;
s.month = claim.payM;
E.tickReceivership(s);
const yb = yr();
ok(Math.abs(s.cash - before - claim.amount) < 1, "the claim comes back as cash");
ok(Math.abs((yb.sold ?? 0) - (yb.yr === Math.floor(claim.payM / 12) && Math.floor(claim.payM / 12) === Math.floor(claim.seizedM / 12) ? sold0 : 0) - claim.amount) < 1 || (yb.sold ?? 0) >= claim.amount, "redeemed as a balance-sheet inflow, not income");
ok(Math.abs((yb.interest ?? 0) - (Math.floor(claim.payM / 12) === Math.floor(claim.seizedM / 12) ? int0 : 0)) < 1, "no fake interest income");
console.log(fail ? `${fail} failed` : "bank seizure books correctly");
process.exit(fail ? 1 : 0);
