// THE CITY'S FIRM BOOKS: DETERMINISTIC, SAVABLE, AND EVERY DOLLAR ACCOUNTED FOR.
//
//   node test/economy.mjs          (pnpm economy:test)
//
// Step 1 of ONE_ECONOMY_PLAN.md (src/engine/economy.ts, sfc.ts) is a shadow
// nothing reads. What can go wrong with it, all checked here:
//   - the same seed gives the same books, month for month;
//   - its stream is mulberry32, step for step market.ts's, and it draws on
//     its own channel only;
//   - it writes nothing in the world it reads: a world whose books are torn
//     up every month plays on identically to one that keeps them;
//   - the payroll is one number (1b): the firms' wages are the household
//     register's earners' pay every month, and the register's earners in each
//     industry are its heads to within half a regional household's weight;
//   - the ledger sums to zero every month, the market clears, the loan book
//     is the borrowers' debts, and every firm's equity is its cash less debt;
//   - a save (structured clone, as IndexedDB stores it, and a JSON round trip,
//     as a harness's deep copy makes) loads back to the same books, and the
//     loaded game and the running one stay identical for a year.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import v8 from "node:v8";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const sha = (x) => createHash("sha256").update(x).digest("hex").slice(0, 16);
// typed columns hash by their used part, so capacity does not count
const cols = (ec) => {
  const n = ec.L.slot.n;
  const f = Object.fromEntries(Object.entries(ec.f).map(([k, v]) => [k, Array.from(v).slice(0, n)]));
  return { ...ec, f, L: { ...ec.L, slot: { ...ec.L.slot, cash: Array.from(ec.L.slot.cash).slice(0, n), debt: Array.from(ec.L.slot.debt).slice(0, n) } } };
};
const ecoHash = (g) => sha(JSON.stringify(cols(g.economy)));
const worldHash = (g) => {
  const { economy, households, streams, ...rest } = g;
  void economy; void households;
  // (the register's own stream too: since 1b it hires against the books' heads, and it is a shadow as well)
  const { economy: _e, households: _h, ...st } = streams ?? {};
  void _e; void _h;
  return sha(JSON.stringify({ ...rest, streams: st }));
};

const city = makeCity("somewhere", 1);
E.normalizeParcels(city.parcels);
const bbls = Object.keys(city.parcels);
const SEED = 550991, MONTHS = Number(process.env.MONTHS ?? 18);
const start = () => E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const tick = (g) => { g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency); return g.gameOver ? { ...g, gameOver: null, cash: 6e6 } : g; };

console.log("\nTHE CITY'S FIRM BOOKS\n");

{
  let st = 98765, ok = true;
  for (let k = 0; k < 1000; k++) {
    const r = E.mulberry32Step(st);
    if (E.economyStreamStep(st) !== r.value) { ok = false; break; }
    st = r.state;
  }
  check(ok, "the economy stream is mulberry32, step for step market.ts mulberry32Step");
}

// two runs with the books, one whose books are torn up every month
let a = start(), b = start(), z = start();
const hA = [], hB = [];
let sumOk = true, mktOk = true, eqOk = true, bookOk = true, worldOk = true, worst = "", months = 0, flowsOk = true, payOk = true, fillOk = true, firstHeads = NaN, firstJobs = NaN;
for (let m = 1; m <= MONTHS; m++) {
  a = tick(a); b = tick(b);
  z = tick(z);
  if (worldHash(a) !== worldHash(z)) { worldOk = false; worst ||= `world parted at month ${m}`; }
  delete z.economy; if (z.streams) delete z.streams.economy;
  if (!a.economy?.last) continue;
  months++;
  hA.push(ecoHash(a)); hB.push(ecoHash(b));
  const ec = a.economy, L = ec.L, l = ec.last;
  const sum = E.ledgerSum(L), gross = E.ledgerGross(L);
  if (!(Math.abs(sum) <= 1e-9 * gross)) { sumOk = false; worst ||= `month ${m}: ledger sums to ${sum} on ${gross}`; }
  if (!(Math.abs(l.market) <= 1e-6 * l.X + 1e-3)) { mktOk = false; worst ||= `month ${m}: market holds ${l.market}`; }
  // every firm: equity = cash - debt (no fixed assets on these books)
  for (let n = 0; n < L.slot.n; n++) {
    const d = ec.f.eq[n] - (L.slot.cash[n] - L.slot.debt[n]);
    if (!(Math.abs(d) <= 1e-6 * (1 + Math.abs(L.slot.cash[n]) + L.slot.debt[n]))) { eqOk = false; worst ||= `month ${m}: firm ${ec.f.id[n]} equity off by ${d}`; break; }
    if (!(L.slot.cash[n] >= -1e-6)) { eqOk = false; worst ||= `month ${m}: firm ${ec.f.id[n]} holds ${L.slot.cash[n]}`; break; }
  }
  // the flow table balances by construction: what the market took in, it paid out
  const fl = L.flow;
  const inMkt = Object.entries(fl).filter(([k]) => k.split(":")[0].endsWith(">mkt")).reduce((s, [, v]) => s + v, 0);
  const outMkt = Object.entries(fl).filter(([k]) => k.startsWith("mkt>")).reduce((s, [, v]) => s + v, 0);
  if (!(Math.abs(inMkt - outMkt) <= 1e-6 * outMkt)) { flowsOk = false; worst ||= `month ${m}: market in ${inMkt} out ${outMkt}`; }
  if (!(E.loanBook(L) >= 0) || !Number.isFinite(E.loanBook(L))) { bookOk = false; worst ||= `month ${m}: loan book ${E.loanBook(L)}`; }
  // one payroll (1b): the firms' cash wages are the register's wages
  if (!(Math.abs(l.hhWagesFirms - l.hhWagesRegister) <= 1e-9 * l.hhWagesRegister)) { payOk = false; worst ||= `month ${m}: firms pay ${l.hhWagesFirms}, the register is paid ${l.hhWagesRegister}`; }
  // ...and the register's earners are each industry's heads, to within half a regional household
  const wR = a.households.wRegion;
  for (let i = 0; i < l.heads.length; i++) {
    if (!(Math.abs(l.regEarners[i] - l.heads[i]) <= wR / 2 + 1e-6)) { fillOk = false; worst ||= `month ${m}: ${E.INDUSTRY_IDS[i]} has ${l.regEarners[i].toFixed(1)} earners for ${l.heads[i].toFixed(1)} heads (weight ${wR.toFixed(1)})`; break; }
  }
  if (!Number.isFinite(firstHeads)) { firstHeads = l.heads.reduce((s, x) => s + x, 0); firstJobs = a.econ.jobs; }
}
check(months >= MONTHS - 2, `the books open with the register's first flows and run ${months} of ${MONTHS} months`);
check(hA.every((h, i) => h === hB[i]), `deterministic: the same books from the same seed every month (${hA.at(-1)})`);
check(new Set(hA).size === hA.length, "and they move: no two months' books alike");
check(worldOk, "it writes nothing in the world: torn up every month, the world plays on identically");
check(sumOk, "the ledger sums to zero every month (to 1e-9 of its gross)");
check(mktOk && flowsOk, "the market clears every month: what buyers paid in, sellers were paid");
check(eqOk, "every firm's equity is its cash less its debt, and no firm holds negative cash");
check(bookOk, "the loan book is finite and non-negative");
check(payOk, "one payroll: what the firms pay in wages is what the register's earners are paid, every month (to 1e-9)");
check(fillOk, "the register's earners in each industry are its heads, to within half a regional household's weight, every month");
{
  const ec = a.economy;
  // The opening is sized the engine's way, construction apart (it opens at
  // what the town buys of it); from then every off-map industry follows its
  // own demand, so the books' jobs part from the engine's — a measurement
  // (tools/economy.mjs), not an identity. Checked here: the opening.
  check(Math.abs(firstHeads / firstJobs - 1) < 0.03, `the books open on the town's jobs: ${Math.round(firstHeads)} against ${firstJobs} (construction at what the town buys of it)`);
  const named = new Set();
  for (const roll of Object.values(a.econ.streetRolls)) for (const t of roll.t) if (t.fid !== undefined && t.use !== "multifamily") named.add(t.fid);
  let have = 0;
  for (let n = 0; n < ec.L.slot.n; n++) if (named.has(ec.f.id[n])) have++;
  check(have === named.size, `every named street firm has books: ${have} of ${named.size}`);
  const fb = E.firmBooks(a, [...named][0]);
  const byBuyer = Object.values(fb.revenueBy).reduce((s, v) => s + v, 0);
  check(fb && Math.abs(byBuyer - fb.revenue) < 1e-6 * fb.revenue && Math.abs(fb.equity - (fb.cash - fb.debt)) < 1e-6 * (1 + fb.cash + fb.debt),
    `a firm's books lay out: ${fb.label}, revenue ${Math.round(fb.revenue)} by buyer, cash ${Math.round(fb.cash)}, debt ${Math.round(fb.debt)}`);
}

// it reads the world and never writes it: a month of the books on a copy of
// the state changes nothing but the books and their own stream
{
  const copy = structuredClone(a);
  const before = worldHash(copy), hh = sha(JSON.stringify(E.packHouseholds(copy.households)));
  const s0 = copy.streams.economy;
  E.tickFirms(copy);
  E.tickEconomy(copy);
  check(worldHash(copy) === before && sha(JSON.stringify(E.packHouseholds(copy.households))) === hh, "a month of the books writes nothing in the world it reads (nor in the household register)");
  check(typeof copy.streams.economy === "number" && copy.streams.economy !== s0, "it draws on its own channel, s.streams.economy");
}

// save and load
{
  const viaClone = E.migrateSaveState(v8.deserialize(v8.serialize(a)));
  check(ecoHash(viaClone) === ecoHash(a), "a save (structured clone) loads back to the same books");
  const viaJson = JSON.parse(JSON.stringify(a.economy));
  check(!ArrayBuffer.isView(viaJson.f.hc), "(a JSON copy turns the columns into plain objects...)");
  E.reviveEconomy(viaJson);
  check(ArrayBuffer.isView(viaJson.f.hc) && ArrayBuffer.isView(viaJson.L.slot.cash) && ecoHash({ economy: viaJson }) === ecoHash(a), "...which revive to the same books");
  let c = viaClone, d = { ...a, economy: JSON.parse(JSON.stringify(a.economy)) };
  d.streams = { ...a.streams };
  let ok = true, okJ = true;
  for (let m = 0; m < 12; m++) {
    a = tick(a); c = tick(c); d = tick(d);
    if (ecoHash(a) !== ecoHash(c) || worldHash(a) !== worldHash(c)) ok = false;
    if (ecoHash(a) !== ecoHash(d)) okJ = false;
  }
  check(ok, "the loaded game and the running one stay identical for a year");
  check(okJ, "and books that went through JSON play on identically too");
  const kb = v8.serialize(a.economy).length / 1024;
  check(kb < 1200, `the books save in ${kb.toFixed(0)} KB (${a.economy.L.slot.n} firms)`);
}

if (bad) console.log(`\n  ${worst}`);
console.log("");
process.exit(bad ? 1 : 0);
