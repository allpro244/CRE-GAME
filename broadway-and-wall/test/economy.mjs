// THE CITY'S FIRM BOOKS: DETERMINISTIC, SAVABLE, AND EVERY DOLLAR ACCOUNTED FOR.
//
//   node test/economy.mjs          (pnpm economy:test)
//
// Step 1 of ONE_ECONOMY_PLAN.md (src/engine/economy.ts, sfc.ts) is a shadow
// nothing reads. What can go wrong with it, all checked here:
//   - the same seed gives the same books, month for month;
//   - its stream is mulberry32, step for step market.ts's, and it draws on
//     its own channel only;
//   - the world READS it (step 2): a world whose books are torn up every
//     month parts from one that keeps them — but a month of the books on a
//     copy writes nothing in the world (the engine reads `economyToEngine`'s
//     record, written after the books close, the month after);
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
const OPEN_MAX = 0.08;
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
let sumOk = true, mktOk = true, eqOk = true, bookOk = true, worldOk = true, worst = "", months = 0, flowsOk = true, payOk = true, fillOk = true, openMax = 0, firstHeads = NaN, firstJobs = NaN;
for (let m = 1; m <= MONTHS; m++) {
  a = tick(a); b = tick(b);
  z = tick(z);
  if (worldHash(a) !== worldHash(z)) worldOk = false;
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
  // ...and the register's earners fill each industry's heads: never more
  // (layoffs cut an industry to its heads), and fewer only by the openings a
  // labour market keeps. A month's openings are not all filled that month:
  // the jobless find work at the CPS rate, and a household moves here for a
  // job only once it has stood open a month — so an industry the town's own
  // people pass over (a low-paying one) can sit short until the arrivals
  // come. Demanding none open every month asked for a market with no
  // openings; JOLTS job openings run 4-7% of employment (2015-2023), so an
  // industry may be short up to 8% of its heads. Both to within half its
  // heaviest household's weight: each household weighs what it stands for
  // (since step 2 the region's move between renting and owning as shares of
  // their weight, so weights differ).
  const R = a.households, A = R.a, wMax = new Array(l.heads.length).fill(0);
  for (let k = 0; k < R.n; k++) for (const [emp, ind] of [[A.emp1[k], A.ind1[k]], [A.emp2[k], A.ind2[k]]]) {
    if ((emp >= 0 || emp < -16) && ind < l.heads.length) wMax[ind] = Math.max(wMax[ind], A.wt[k]);
  }
  for (let i = 0; i < l.heads.length; i++) {
    const half = Math.max(wMax[i], R.wRegion) / 2 + 1e-6, over = l.regEarners[i] - l.heads[i];
    if (!(over <= half) || !(-over <= OPEN_MAX * l.heads[i] + half)) { fillOk = false; worst ||= `month ${m}: ${E.INDUSTRY_IDS[i]} has ${l.regEarners[i].toFixed(1)} earners for ${l.heads[i].toFixed(1)} heads (heaviest earner ${wMax[i].toFixed(1)})`; break; }
    openMax = Math.max(openMax, -over / Math.max(1, l.heads[i]));
  }
  if (!Number.isFinite(firstHeads)) { firstHeads = l.heads.reduce((s, x) => s + x, 0); firstJobs = a.econ.jobs; }
}
check(months >= MONTHS - 2, `the books open with the register's first flows and run ${months} of ${MONTHS} months`);
check(hA.every((h, i) => h === hB[i]), `deterministic: the same books from the same seed every month (${hA.at(-1)})`);
check(new Set(hA).size === hA.length, "and they move: no two months' books alike");
check(!worldOk, "the world reads the books (step 2): torn up every month, the world parts from the one that keeps them");
check(sumOk, "the ledger sums to zero every month (to 1e-9 of its gross)");
check(mktOk && flowsOk, "the market clears every month: what buyers paid in, sellers were paid");
check(eqOk, "every firm's equity is its cash less its debt, and no firm holds negative cash");
check(bookOk, "the loan book is finite and non-negative");
check(payOk, "one payroll: what the firms pay in wages is what the register's earners are paid, every month (to 1e-9)");
check(fillOk, `the register's earners in each industry never exceed its heads, and fall short by no more than ${OPEN_MAX * 100}% of them (JOLTS-like openings; at most ${(openMax * 100).toFixed(1)}%), to within half its heaviest household's weight, every month`);
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
  // ONE NAME, ONE FIRM; A FIRM IS WHAT ITS NAME SAYS (the firm screens, #521:
  // two "Whitlow Drafting"s; "Ashe & Porter LLP" a company's head office).
  {
    const byName = new Map(), hqTrades = new Set(), iHq = E.INDUSTRY_IDS.indexOf("hq");
    const indOf = new Map();
    for (let n = 0; n < ec.L.slot.n; n++) if (ec.f.id[n] >= 0) indOf.set(ec.f.id[n], ec.f.ind[n]);
    for (const roll of Object.values(a.econ.streetRolls)) for (const t of roll.t) {
      if (t.fid === undefined) continue;
      (byName.get(t.name) ?? byName.set(t.name, new Set()).get(t.name)).add(t.fid);
      if (indOf.get(t.fid) === iHq) hqTrades.add(t.sector);
    }
    const shared = [...byName].filter(([, f]) => f.size > 1);
    check(shared.length === 0, `no two firms in town share a name: ${byName.size} names${shared.length ? `, shared: ${shared.slice(0, 3).map(([k, f]) => `${k} x${f.size}`).join(", ")}` : ""}`);
    const wrong = [...hqTrades].filter((k) => !["food", "apparel"].includes(k));
    check(wrong.length === 0, `a head office is a goods firm's desk, never a law, design or finance firm's${wrong.length ? `: ${wrong.join(", ")}` : ""}`);
  }
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
  // Each loaded game in a session of its own — its own parcel table, as a
  // save opened in a fresh game is. Three games ticking on ONE table part
  // ways for a reason that is not the save: the engine writes plats into the
  // table (landdev.ts restoreCuts) and keys caches on it (demand.ts
  // demandModel), so the first game's month moves the table under the next
  // one's. Measured 2026-10-29 on this branch: identical on separate tables,
  // parted in the rival and sales streams within a month on a shared one.
  const session = () => {
    const c2 = makeCity("somewhere", 1);
    E.normalizeParcels(c2.parcels);
    const b2 = Object.keys(c2.parcels);
    return (g) => { g = E.advanceQuarter(g, c2.parcels, b2, c2.adjacency); return g.gameOver ? { ...g, gameOver: null, cash: 6e6 } : g; };
  };
  const tickC = session(), tickD = session();
  let ok = true, okJ = true;
  for (let m = 0; m < 12; m++) {
    a = tick(a); c = tickC(c); d = tickD(d);
    if (ecoHash(a) !== ecoHash(c) || worldHash(a) !== worldHash(c)) ok = false;
    if (ecoHash(a) !== ecoHash(d)) okJ = false;
  }
  check(ok, "the loaded game and the running one stay identical for a year");
  check(okJ, "and books that went through JSON play on identically too");
  const kb = v8.serialize(a.economy).length / 1024;
  // (1250: each firm's national orders and what they were a year ago, two columns, since FORMULA_LEDGER #9)
  check(kb < 1250, `the books save in ${kb.toFixed(0)} KB (${a.economy.L.slot.n} firms)`);
}

// ---------------------------------------------------------------- named links (step 2d)
// Each named firm keeps a few named suppliers (economy.ts `tickLinks`). A
// customer that closes takes from its supplier what it bought: the twin in
// which one customer is gone shows its supplier's fortune down by about that
// share and the cause ledger saying so, first in its books' chain.
{
  const lk = a.economy.lk;
  const namedFids = new Set();
  for (const roll of Object.values(a.econ.streetRolls)) for (const t of roll.t) if (t.fid !== undefined && t.use !== "multifamily") namedFids.add(t.fid);
  const n = lk ? lk.s.length : 0;
  check(n > 1.5 * namedFids.size, `the named firms keep named suppliers: ${n} links among ${namedFids.size} firms (${(n / Math.max(1, namedFids.size)).toFixed(1)} a firm as a customer)`);
  // the supplier with the largest share in one customer
  let best = -1, bestShare = 0;
  const revOf = new Map();
  for (let k = 0; k < a.economy.L.slot.n; k++) if (a.economy.f.id[k] >= 0) revOf.set(a.economy.f.id[k], a.economy.f.rev[k]);
  for (let l = 0; l < n; l++) { const sh = lk.f[l] / Math.max(1, revOf.get(lk.s[l]) ?? 0); if (sh > bestShare && namedFids.has(lk.c[l]) && namedFids.has(lk.s[l])) { bestShare = sh; best = l; } }
  check(best >= 0 && bestShare > 0.03, `a link carries real money: the largest is ${(bestShare * 100).toFixed(0)}% of its supplier's sales`);
  if (best >= 0) {
    const sup = lk.s[best], cus = lk.c[best];
    const nameOfFid = (g, fid) => Object.values(g.econ.streetRolls).flatMap((r) => r.t).find((t) => t.fid === fid)?.name;
    const cusName = nameOfFid(a, cus), supName = nameOfFid(a, sup);
    const page = E.firmLinks(a, sup);
    check(page.customers.some((c) => c.fid === cus), `the supplier's page lists ${cusName} among its customers (${page.customers.length} customers, ${page.suppliers.length} suppliers)`);
    const zOf = (g) => { for (const roll of Object.values(g.econ.streetRolls)) for (const t of roll.t) if (t.fid === sup) return t.fin?.z; return undefined; };
    const ctl = structuredClone(a), trt = structuredClone(a);
    for (const roll of Object.values(trt.econ.streetRolls)) {
      const gone = roll.t.find((t) => t.fid === cus);
      if (gone) { roll.t = roll.t.filter((t) => t.fid !== cus); (trt.econ.streetFailed ??= []).push({ m: trt.month, bbl: "", name: gone.name, fid: gone.fid, sf: gone.sf, use: gone.use ?? "office", why: "dark", credit: gone.credit }); }
    }
    let c2 = ctl, t2 = trt;
    for (let m = 0; m < 2; m++) { c2 = tick(c2); t2 = tick(t2); }
    const dz = (zOf(t2) ?? 0) - (zOf(c2) ?? 0);
    const ev = (t2.why?.ev ?? []).find((x) => x.k === "firm.lostCustomer" && x.aid === String(sup) && x.t.includes(cusName));
    console.log(`    ${supName} loses ${cusName}: its fortune ${dz >= 0 ? "+" : ""}${(dz * 100).toFixed(1)} log points on its twin (the link was ${(bestShare * 100).toFixed(0)}% of its sales); "${ev?.t ?? "—"}"`);
    check(!!ev && dz < 0.5 * Math.log(1 - Math.min(0.6, bestShare)), "a customer closing costs its named supplier that share of its fortune, and the cause ledger says whom it lost");
    const tenant = Object.values(t2.econ.streetRolls).flatMap((r) => r.t).find((t) => t.fid === sup);
    if (tenant?.fin) {
      const id = E.whyTenantBooks(t2, tenant, tenant.fin);
      const chain = t2.why.ev.find((x) => x.id === id);
      const first = t2.why.ev.find((x) => x.id === chain?.c?.[0]);
      check(first?.k === "firm.lostCustomer", `...and its books' "Why?" starts with a lost customer, before its industry: "${first?.t ?? "—"}"`);
    }
  }
}

// ---------------------------------------------------------------- the wires (step 2)
// Since step 2 the town's jobs and its demand for space are the books', so a
// shock to what the town sells must travel the way a real one does. Each wire
// is a paired fork: one world, cloned, the shock in one clone only, both run
// on — every difference between them is the shock's. Vacancy is read as a
// twelve-month mean of the gap to the twin: two worlds that differ in one
// thing part ways in every random draw after it, and a single month's gap in
// one class carries a point or two of that.
const CLS = ["industrial", "office", "retail", "multifamily"];
const twin = (ctl, trt, months) => {
  const gap = [];
  for (let m = 0; m < months; m++) {
    ctl = tick(ctl); trt = tick(trt);
    gap.push(CLS.map((k) => trt.econ.cityVac[k] - ctl.econ.cityVac[k]));
  }
  // the twelve-month mean gap, month by month
  const ma = gap.map((_, m) => CLS.map((_k, c) => { const w = gap.slice(Math.max(0, m - 11), m + 1); return w.reduce((s, x) => s + x[c], 0) / w.length; }));
  return { ctl, trt, ma: Object.fromEntries(CLS.map((k, c) => [k, ma.map((r) => r[c])])) };
};
const firstOver = (series, level) => { const i = series.findIndex((v) => v >= level); return i < 0 ? Infinity : i + 1; };
const pp = (x) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}pp`;
let base24 = start();
for (let m = 0; m < 24; m++) base24 = tick(base24);

// WIRE 1: AN EXPORT SLUMP. (a) A plant the nation buys from — machinery, its
// floor a quarter of the town's industrial stock at the industry's 900 sf a
// head — comes to town and the town settles round it; then its market
// collapses to a tenth. Its floor empties most: the town's industrial
// vacancy stands a point over its twin's, and three years on its gap is the
// largest of the classes. (Which class FIRST crosses a point is not checked:
// the plant's ~240 jobs take ~600 with them, its workers' shops lose trade
// and fail in lumps, and a 12-month mean of the shops' gap crossed a point
// at month 16 against the sheds' 21 — measured 2026-10-29, seed 550991, with
// the sheds' gap 3.3pp at three years against the shops' 1.5 and the
// offices' 1.1. Before that day's fix to the firms' fortunes the shops
// crossed later; the order of two noisy crossings is not the wire.) (b) The town's
// whole export base loses 30% of its sales out of town (a Pittsburgh): every
// class ends emptier than its twin, the exporters' own floor first — on this
// map the base is offices (technology, insurance, finance, headquarters), so
// offices lead the shops the payrolls spent in. The flats are not ordered:
// a household that loses its job leaves its flat within months and flats
// turn over at ~45% a year (leasing.ts MF_TURNOVER) against offices' leases
// of five to ten, so the flats' smaller gap can reach a third of its peak
// first (measured 2026-10-29: flats month 16, offices 21).
{
  const iM = E.INDUSTRY_IDS.indexOf("machinery");
  let base = structuredClone(base24);
  base.economy.XJ0[iM] += 0.25 * base.econ.stock.industrial / E.INDUSTRIES.machinery.sfPerWorker;
  for (let m = 0; m < 36; m++) base = tick(base);
  const trt = structuredClone(base);
  trt.economy.lnNat[iM] -= Math.log(10);   // the nation stops buying the plant's product (an input; the town's share is its firms' orders)
  const { ma } = twin(structuredClone(base), trt, 36);
  const f = Object.fromEntries(CLS.map((k) => [k, firstOver(ma[k], 0.01)]));
  console.log(`    a plant's market collapses: the twelve-month vacancy gap first stands a point over the twin at month ${CLS.map((k) => `${k} ${f[k]}`).join(", ")}; industrial ${pp(Math.max(...ma.industrial))} at most`);
  const end = Object.fromEntries(CLS.map((k) => [k, ma[k].at(-1)]));
  console.log(`    ...and three years on: ${CLS.map((k) => `${k} ${pp(end[k])}`).join(", ")}`);
  // READ AT THE PEAK, NOT AT THREE YEARS (2026-10-29, after step 7). The wire
  // is that the plant's own floor empties first and most. Where the shed
  // market is tight — seed 550991 after the property market and #526 runs
  // industrial vacancy at 1-3%, near its frictional floor — other occupiers
  // take the plant's space within three years (measured: the twin's gap
  // peaks at +1.1pp at month 12 and is +0.4pp by month 36, stock identical in
  // both twins), while the lost payrolls are still emptying shops and
  // offices. Refilling a tight shed market is what one does, so the end-state
  // order is the market's answer, not the wire's.
  const peak = Object.fromEntries(CLS.map((k) => [k, Math.max(...ma[k])]));
  check(Number.isFinite(f.industrial) && CLS.every((k) => k === "industrial" || f[k] > f.industrial)
    && CLS.every((k) => k === "industrial" || peak[k] < peak.industrial),
    "a plant's slump empties its own floor most: industrial is the first class a point over its twin, and its gap peaks highest");
}
{
  const trt = structuredClone(base24);
  for (let i = 0; i < trt.economy.lnNat.length; i++) trt.economy.lnNat[i] += Math.log(0.7);
  const r = twin(structuredClone(base24), trt, 60);
  const ma = r.ma, last = Object.fromEntries(CLS.map((k) => [k, ma[k].at(-1)]));
  const third = Object.fromEntries(CLS.map((k) => { const pk = Math.max(...ma[k]); return [k, pk > 0 ? firstOver(ma[k], pk / 3) : Infinity]; }));
  const jobs = r.trt.econ.jobs / r.ctl.econ.jobs - 1;
  console.log(`    the export base loses 30%: jobs ${(100 * jobs).toFixed(1)}% on the twin after five years; vacancy gap then ${CLS.map((k) => `${k} ${pp(last[k])}`).join(", ")}; a third of each one's peak reached at month ${CLS.map((k) => `${k} ${third[k]}`).join(", ")}`);
  // The flats' landlords re-mark their asks on their own lettings (streetRolls.ts markFlatAsk, FORMULA_LEDGER #4/#5):
  // a year's leases reprice inside the five years, so the slump can show in the flats' rent rather than their vacancy.
  const mfRent = r.trt.econ.rentIdx.multifamily / r.ctl.econ.rentIdx.multifamily - 1;
  console.log(`    ...flats' asking rent ${(100 * mfRent).toFixed(1)}% on the twin`);
  check(jobs < -0.05 && CLS.every((k) => last[k] > 0 || (k === "multifamily" && mfRent < -0.02)), "an export slump costs the town jobs and leaves every class emptier than its twin (the flats emptier or cheaper)");
  check(third.office <= third.retail, "...the exporters' floor before the shops (offices, on this map)");
}

// WIRE 2: A FACTORY CLOSES. On a map with a real plant (city seed 3, its
// biggest works at month 36), its tenants shut and the floor goes dark; its
// workers no longer pass the shops within a walk of it (demand.ts
// `blockFoot`, streetRolls.ts CATCHMENT). What is checked is the wire itself
// on a FIXED COHORT: the shops trading round the plant at the closure, each
// against itself in the twin, lose staff (their trade) against the same
// comparison for the town's other shops. The neighbourhood's retail vacancy
// against its twin is printed but not checked, because one map cannot see
// it: the neighbourhood is 20-40 shops on ~100-150k sf, so one 15-20k sf shop
// failing or letting moves it 10pp, and the two twins part ways in every
// draw after the closure. Measured (2026-10-29) on game seeds 550991, 12007:
// cohort staff -2.3%, -2.0% against the far shops' +0.6%, +0.1% (the works
// is ~16% of its own block's walkers, less of its neighbours'); vacancy
// near-minus-twin on seeds 550991, 12007, 73303 -0.7, -1.7, -2.2pp, far +0.9,
// -0.5, -0.3pp — noise of a few points round an effect of a fraction of one.
// (A first cut checked the vacancy and passed at +2.0pp on one seed: luck.)
{
  const city3 = makeCity("somewhere", 3);
  E.normalizeParcels(city3.parcels);
  const b3 = Object.keys(city3.parcels);
  const tick3 = (g) => { g = E.advanceQuarter(g, city3.parcels, b3, city3.adjacency); return g.gameOver ? { ...g, gameOver: null, cash: 6e6 } : g; };
  let base = E.firstListings(E.newGame(SEED, city3.parcels), city3.parcels, b3);
  for (let m = 0; m < 36; m++) base = tick3(base);
  const held = {};
  for (const [bbl, roll] of Object.entries(base.econ.streetRolls)) for (const t of roll.t) if (t.use === "industrial") held[bbl] = (held[bbl] ?? 0) + t.sf;
  const [fac, facSf] = Object.entries(held).sort((x, y) => y[1] - x[1])[0];
  const model = E.demandModel(city3.parcels);
  const blk = model.ofBbl.get(fac);
  const near = new Set(model.blocks.get(blk).neighbours.filter((n) => n.w >= 0.15).map((n) => n.id));
  const shopVac = (g, inside) => {
    let cap = 0, let_ = 0;
    for (const [bbl, roll] of Object.entries(g.econ.streetRolls)) {
      if (near.has(model.ofBbl.get(bbl)) !== inside) continue;
      const rec = E.resolveRec(city3.parcels, g, bbl);
      const c = rec ? E.useRentableSf(rec, "retail") : 0;
      if (!(c > 0)) continue;
      cap += c; let_ += roll.t.reduce((s, t) => s + ((t.use ?? "office") === "retail" ? t.sf : 0), 0);
    }
    return cap > 0 ? 1 - Math.min(1, let_ / cap) : NaN;
  };
  let ctl = structuredClone(base), trt = structuredClone(base);
  const roll = trt.econ.streetRolls[fac];
  const shut = roll.t.filter((t) => t.use === "industrial");
  roll.t = roll.t.filter((t) => t.use !== "industrial");
  (roll.ready ??= []).push(...shut.map((t) => ({ use: "industrial", sf: t.sf, readyM: trt.month + 1 })));
  const cohort = (g, inside) => {
    const o = new Map();
    for (const [bbl, roll] of Object.entries(g.econ.streetRolls)) {
      if (near.has(model.ofBbl.get(bbl)) !== inside) continue;
      for (const t of roll.t) if ((t.use ?? "office") === "retail" && t.staff > 0) o.set(t.fid, t.staff);
    }
    return o;
  };
  const cN = cohort(ctl, true), cF = cohort(ctl, false);
  const logGap = (inside, C) => {
    const A = cohort(trt, inside), B = cohort(ctl, inside);
    let sum = 0, n = 0;
    for (const f of C.keys()) { const a = A.get(f), b = B.get(f); if (a > 0 && b > 0) { sum += Math.log(a / b); n++; } }
    return n ? sum / n : NaN;
  };
  const nearGap = [], farGap = [], nearStaff = [], farStaff = [];
  let foot = 1;
  for (let m = 0; m < 18; m++) {
    ctl = tick3(ctl); trt = tick3(trt);
    nearGap.push(shopVac(trt, true) - shopVac(ctl, true));
    farGap.push(shopVac(trt, false) - shopVac(ctl, false));
    nearStaff.push(logGap(true, cN)); farStaff.push(logGap(false, cF));
    foot = Math.min(foot, trt.blockFoot[blk] / ctl.blockFoot[blk]);
  }
  const mn = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sN = Math.expm1(mn(nearStaff)), sF = Math.expm1(mn(farStaff));
  console.log(`    a ${Math.round(facSf / 1000)}k sf works closes: its block's catchment falls to ${(100 * foot).toFixed(0)}% of the twin's; the ${cN.size} shops trading within a walk ${(100 * sN).toFixed(1)}% staff on their twins over eighteen months, the town's other ${cF.size} ${(100 * sF).toFixed(1)}%`);
  console.log(`    (retail vacancy within a walk ${pp(mn(nearGap))} on the twin, the rest of the town ${pp(mn(farGap))}: not checked, see above)`);
  check(foot < 0.95 && sN < -0.005 && sN < sF - 0.01, "a factory closing takes trade from the shops around it, beyond the rest of the town's");
}

if (bad) console.log(`\n  ${worst}`);
console.log("");
process.exit(bad ? 1 : 0);
