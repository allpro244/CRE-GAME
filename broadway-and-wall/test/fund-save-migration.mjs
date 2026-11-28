// A FUND FROM AN OLD SAVE IS MEASURED HONESTLY, OR NOT JUDGED (PR #883 review).
//
// The LPs' review (fund.ts lpWouldEndPeriod) reads what the vehicle deployed
// off its ledger, including the construction draws `deedInvested` counts. A
// save from before that field cannot say what a building fund drew, so the
// review would read it as idle and end a period that was on pace. save.ts
// marks such a fund `deployUnmeasured` and the review leaves it alone; a fund
// that had deployed nothing reads zero and keeps its review (F10). The old
// overdraft migration must not start a ledger on a fund saved before one.
//
// Run: node test/fund-save-migration.mjs   (a few seconds)
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(12007, parcels, 20_000_000), parcels, bbls);
g.econ.phase = "expansion"; g.econ.creditIdx = 1;
g.reputation = { band: "Institutional", score: 45, rank: 2, of: 30, m: 0 };
g.sponsor = { events: [] };
const r = E.raiseFund(g); if (r.err) throw new Error(r.err);
g = r.s;
let bad = 0; const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) bad++; };
ok(g.fund.deedInvested === 0, `a new raise starts deedInvested at 0 (${g.fund.deedInvested})`);
const mig = (edit) => { const c = structuredClone(g); edit(c.fund, c); return E.migrateSaveState(c); };
const at = (f) => f.raisedM + 24;
// 1. new save, fund bought something: stays measured
let m = mig((f) => { f.flows.purchase = -500_000; f.cash -= 500_000; });
ok(!m.fund.deployUnmeasured, "a new-code save is never marked");
// 2. old save (no deedInvested) that built: marked, no vote
m = mig((f) => { delete f.deedInvested; f.flows.purchase = -200_000; f.flows.build = -300_000; f.cash -= 500_000; });
ok(m.fund.deployUnmeasured === true, "an old save whose fund built is marked unmeasured");
ok(!E.lpWouldEndPeriod(m.fund, at(m.fund)), "and the LPs' review leaves it alone at month 24");
// 3. old save, fund deployed nothing: measured (zero), vote still possible
m = mig((f) => { delete f.deedInvested; });
ok(!m.fund.deployUnmeasured, "an old save whose fund deployed nothing stays measurable");
ok(E.lpWouldEndPeriod(m.fund, at(m.fund)), "and an idle fund is still voted out at month 24 (F10)");
// 4. pre-ledger save (no flows) with an overdraft: no ledger created, marked, advance booked
const cash0 = g.cash;
m = mig((f) => { delete f.deedInvested; delete f.flows; f.cash = -46_000; });
ok(m.fund.flows === undefined, `the overdraft move does not start a ledger (flows ${JSON.stringify(m.fund.flows)})`);
ok(m.fund.cash === 0 && m.fund.gpAdvance === 46_000 && Math.abs(m.cash - (cash0 - 46_000)) < 1, `cash 0, GP advance 46,000, sponsor paid it (${m.fund.cash}, ${m.fund.gpAdvance}, ${Math.round(cash0 - m.cash)})`);
ok(m.fund.deployUnmeasured === true && !E.lpWouldEndPeriod(m.fund, at(m.fund)), "a pre-ledger fund is unmeasured and not voted");
// 5. ledgered fund with overdraft: advance on its ledger
m = mig((f) => { f.cash = -10_000; });
ok((m.fund.flows.advance ?? 0) === 10_000, `a ledgered fund books the advance on its ledger (${m.fund.flows.advance})`);
// 5b. an idle old fund, measured at load, that then buys, is still measured on the next load
{
  const c = structuredClone(g); delete c.fund.deedInvested;
  let a = E.migrateSaveState(c);
  ok(a.fund.deedInvested === 0 && !a.fund.deployUnmeasured, `an idle old fund is stamped measurable at load (deedInvested ${a.fund.deedInvested})`);
  E.chargeFundEquity(a, 1_000_000);
  a = E.migrateSaveState(JSON.parse(JSON.stringify(a)));
  ok(!a.fund.deployUnmeasured, "after it buys and the game is saved and loaded again, it is still measured");
  ok(E.fundDeployment(a.fund, at(a.fund)).deployed >= 1_000_000, `and its purchase counts (${E.fundDeployment(a.fund, at(a.fund)).deployed})`);
}
// 5c. an old fund that holds a deed but whose purchase never reached flows.purchase is unmeasured
{
  const c = structuredClone(g); delete c.fund.deedInvested;
  const b0 = Object.keys(c.holdings)[0] ?? bbls.find((b) => parcels[b].bldgArea > 0);
  c.holdings[b0] = { ...(c.holdings[b0] ?? { bbl: b0, tenants: [], loan: null }), fundOwned: true };
  ok(E.migrateSaveState(c).fund.deployUnmeasured === true, "an old fund holding a deed off its purchase ledger is marked unmeasured");
}
// 6. migration is idempotent
const m2 = E.migrateSaveState(structuredClone(m));
ok(JSON.stringify(m2.fund) === JSON.stringify(m.fund), "running the migration twice changes nothing");
process.exit(bad ? 1 : 0);
