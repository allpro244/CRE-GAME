// THE BANKS, PLAYTESTED — every desk measured against the facts it models.
//
// A long campaign per seed, sampled every month, reported against the
// stylised facts of US commercial-real-estate lending (FDIC QBP, Fed Z.1 /
// SLOOS, ACLI, Trepp). Each line prints the measured value and the real band
// beside it; nothing here gates. Run one seed per process:
//
//   SEED=1001 YEARS=60 node tools/bankplay.mjs > out.json      (one seed, JSON)
//   node tools/bankplay.mjs --report a.json b.json ...           (aggregate)
//
// BOT=levered adds a player who buys at maximum leverage and works out its
// own defaults (the banks.mjs diet); the default is a passive player, so what
// is measured is the city's own credit cycle.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));

if (process.argv.includes("--report")) {
  report(process.argv.slice(process.argv.indexOf("--report") + 1).map((f) => JSON.parse(readFileSync(f, "utf8"))));
  process.exit(0);
}

const E = await import(process.env.ENGINE ?? join(HERE, "../test/.engine.mjs"));
const { loadCity } = await import(join(HERE, "../test/city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 1001);
const H = Number(process.env.YEARS ?? 60) * 12;
const BOT = process.env.BOT ?? "passive";

let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
const rows = [];        // desk-month samples
const mkt = [];         // market-month samples
const events = [];      // failures, reopenings
const prevFailed = {};
// a reference building for the quote sheet: the office on the tape nearest to
// six times the conduit's minimum cheque, so every desk can quote it
const ref = (() => {
  const want = 6 * E.loanMin(g, E.productById("conduit"));
  const li = g.listings.map((l) => ({ l, rec: E.resolveRec(parcels, g, l.bbl) }))
    .filter((x) => x.rec && x.rec.class === "office" && x.rec.bldgArea > 5000)
    .sort((a, b) => Math.abs(Math.log(a.l.ask / want)) - Math.abs(Math.log(b.l.ask / want)));
  return li[0];
})();

for (let m = 0; m < H; m++) {
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (BOT === "levered") g = leveredBot(g, m);
  const e = g.econ;
  const book = E.cityLoanBook(g);
  for (const l of g.lenders ?? []) {
    const failed = l.failedM !== undefined;
    if (failed && !prevFailed[l.name]) events.push({ m, kind: "fail", lender: l.name, lk: l.kind, phase: e.phase, del: l.delinquent, cr: l.capital / l.book });
    if (!failed && prevFailed[l.name]) events.push({ m, kind: "reopen", lender: l.name, lk: l.kind });
    prevFailed[l.name] = failed;
    const mine = book.filter((x) => x.holder === l.name);
    const named = mine.reduce((a, x) => a + x.balance, 0);
    const namedDef = mine.filter((x) => x.status === "default").reduce((a, x) => a + x.balance, 0);
    rows.push({
      m, gm: g.month, n: l.name, k: l.kind, f: failed ? 1 : 0, ph: e.phase,
      book: l.book, cap: l.capital, cr: l.book > 0 ? l.capital / l.book : 0,
      del: l.delinquent, adel: l.anonDelinq ?? null, ndel: named > 0 ? namedDef / named : null,
      named, app: l.appetite, nim: (l.bookYield ?? 0) - (l.fundCost ?? 0) - (l.panicBps ?? 0),
      ni: l.netIncomeYr, co: l.chargeOffsYr, div: l.divYr ?? 0,
    });
  }
  // the market: what a clean mid-size office is quoted, desk by desk
  let q = {};
  if (ref && m % 3 === 0) {
    const rec = ref.rec;
    const price = E.assetValue ? E.assetValue(rec, e, "standard") : ref.l.ask;
    const noi = price * ((e.capRate?.office ?? 7) / 100);
    for (const id of ["harbor", "savings", "pelican", "conduit", "cordage"]) {
      const p = E.productById(id);
      const qt = E.quote(g, p, price, noi, "office", true, undefined, "standard");
      const bench = p.floating ? E.shortIndexOf(e) : e.indexRate;
      q[id] = { open: E.windowOpen(g, p) && qt.principal > 0, spread: qt.ratePct - bench, ltv: price > 0 ? qt.principal / price : 0 };
    }
  }
  mkt.push({
    m, ph: e.phase, ci: e.creditIdx, idx: e.indexRate, sidx: E.shortIndexOf(e),
    st: E.underwritingStandards(g), q,
    vac: e.cityVac?.office ?? null,
    namedTot: book.reduce((a, x) => a + x.balance, 0),
    sysBook: (g.lenders ?? []).reduce((a, l) => a + l.book, 0),
    rivalsAlive: (g.rivals ?? []).filter((r) => r.failedM === undefined).length,
    rivalsFailedThisMonth: (g.rivals ?? []).filter((r) => r.failedM === g.month).length,
  });
}
console.log(JSON.stringify({ seed: SEED, H, bot: BOT, rows, mkt, events }));

function leveredBot(g, m) {
  for (const loi of [...(g.lois ?? [])]) { const r = E.respondLOI(g, parcels, loi.id, "accept", true); if (!r.err) g = r.s; }
  if (!Object.keys(g.talks ?? {}).length && m % 4 === 0 && g.cash > 1_000_000) {
    for (const l of g.listings) {
      if (g.holdings[l.bbl]) continue;
      const rec = E.resolveRec(parcels, g, l.bbl);
      if (!rec || rec.class === "land") continue;
      const r = E.negotiate(g, parcels, l.bbl, Math.round(l.ask * 0.94));
      if (!r.err) { g = r.s; break; }
    }
  }
  for (const t of Object.values(g.talks ?? {})) {
    if (t.agreed) {
      let r = E.closeDeal(g, parcels, t.bbl, "savings", 1);
      if (r.err) r = E.closeDeal(g, parcels, t.bbl, "cordage", 1);
      if (!r.err) g = r.s;
    } else {
      const r = E.acceptCounter(g, parcels, t.bbl);
      g = r.err ? E.walkAway(g, parcels, t.bbl).s : r.s;
    }
  }
  for (const w of Object.values(g.workouts ?? {})) {
    if (g.cash > w.cure * 1.6) { const r = E.cureWorkout(g, parcels, w.bbl); if (!r.err) { g = r.s; continue; } }
    if (w.asks < 1 && w.stage !== "foreclosure") { const r = E.requestForbearance(g, parcels, w.bbl); if (!r.err) { g = r.s; continue; } }
  }
  return g;
}

function report(runs) {
  const q = (a, p) => { const x = a.filter((v) => v !== null && Number.isFinite(v)).sort((u, v) => u - v); return x.length ? x[Math.min(x.length - 1, Math.floor(p * x.length))] : NaN; };
  const pct = (v, d = 1) => Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—";
  const line = (label, val, band) => console.log(`  ${label.padEnd(44)} ${String(val).padEnd(28)} ${band}`);
  const rows = runs.flatMap((r) => r.rows.map((x) => ({ ...x, seed: r.seed })));
  const mkt = runs.flatMap((r) => r.mkt.map((x) => ({ ...x, seed: r.seed })));
  const events = runs.flatMap((r) => r.events.map((x) => ({ ...x, seed: r.seed })));
  const years = runs.reduce((a, r) => a + r.H / 12, 0);
  console.log(`\n${runs.length} campaigns, ${years.toFixed(0)} city-years, bot ${runs[0].bot}\n`);
  const kinds = ["bank", "life", "conduit", "fund"];
  console.log("  BALANCE SHEETS (live desk-months)                measured p10 / p50 / p90      real band");
  for (const k of kinds) {
    const r = rows.filter((x) => x.k === k && !x.f);
    if (!r.length) continue;
    line(`${k}: capital / book`, `${pct(q(r.map((x) => x.cr), 0.1))} / ${pct(q(r.map((x) => x.cr), 0.5))} / ${pct(q(r.map((x) => x.cr), 0.9))}`,
      { bank: "8-12% (FDIC equity/assets)", life: "~10-15% (RBC-adjusted)", conduit: "warehouse, thin", fund: "~20-40% (fund equity)" }[k]);
    line(`${k}: net interest margin`, `${q(r.map((x) => x.nim), 0.1).toFixed(2)} / ${q(r.map((x) => x.nim), 0.5).toFixed(2)} / ${q(r.map((x) => x.nim), 0.9).toFixed(2)} pts`,
      { bank: "3.0-4.0 (FDIC NIM)", life: "1.5-2.5 (portfolio spread)", conduit: "gain-on-sale ~1-2", fund: "3-5" }[k]);
    // ROA from December net income
    // netIncomeYr resets in the month divisible by 12: read it the month before, eleven months in
    const dec = r.filter((x) => x.gm % 12 === 11 && x.book > 0).map((x) => ({ ...x, ni: x.ni * 12 / 11, co: x.co * 12 / 11 }));
    line(`${k}: ROA (annual)`, `${pct(q(dec.map((x) => x.ni / x.book), 0.1), 2)} / ${pct(q(dec.map((x) => x.ni / x.book), 0.5), 2)} / ${pct(q(dec.map((x) => x.ni / x.book), 0.9), 2)}`,
      { bank: "~1.0-1.3% normal, <0 in a bust", life: "~0.5-1%", conduit: "volatile", fund: "~2-4%" }[k]);
    line(`${k}: delinquency (composite)`, `${pct(q(r.map((x) => x.del), 0.1))} / ${pct(q(r.map((x) => x.del), 0.5))} / ${pct(q(r.map((x) => x.del), 0.99))} (p99)`,
      { bank: "~1% normal, 4-9% peak (2010)", life: "<0.5% even in 2010", conduit: "~3% normal, ~10% peak (2012)", fund: "higher, 5-15% peak" }[k]);
    line(`${k}: charge-offs / book (annual)`, `${pct(q(dec.map((x) => x.co / x.book), 0.5), 2)} median, ${pct(q(dec.map((x) => x.co / x.book), 0.99), 2)} p99`,
      { bank: "0.1-0.3% normal, ~3% peak", life: "~0.1%, <1% peak", conduit: "losses to bondholders", fund: "1-5% peak" }[k]);
    line(`${k}: appetite < 0.12 (not quoting)`, pct(r.filter((x) => x.app < 0.12).length / r.length), "rare; conduit shut ~2y per crisis");
  }
  console.log("\n  FAILURES");
  const fails = events.filter((x) => x.kind === "fail");
  for (const k of kinds) {
    const f = fails.filter((x) => x.lk === k);
    const deskYears = rows.filter((x) => x.k === k).length / 12;
    line(`${k}: failures / desk-year`, `${f.length} (${(f.length / Math.max(1, deskYears) * 100).toFixed(2)}%/yr)`,
      { bank: "~0.3-0.5%/yr long-run (FDIC 1934-2023), clustered", life: "~0 (a handful since 1990)", conduit: "do not fail; window shuts", fund: "wind down, not seized" }[k]);
  }
  const byPh = {}; for (const f of fails) byPh[f.phase] = (byPh[f.phase] ?? 0) + 1;
  line("failures by phase", JSON.stringify(byPh), "should cluster in recession / just after");
  // receivership length
  const durs = [];
  for (const f of fails) {
    const back = events.find((x) => x.kind === "reopen" && x.seed === f.seed && x.lender === f.lender && x.m > f.m);
    if (back) durs.push(back.m - f.m);
  }
  line("months closed after a failure", durs.length ? `${q(durs, 0.5)} median` : "—", "bank: P&A over a weekend; the branches open Monday");

  console.log("\n  THE CREDIT CYCLE (quoted on a clean mid-size office)");
  const qs = mkt.filter((x) => x.q && Object.keys(x.q).length);
  const phases = ["expansion", "peak", "recession", "depression", "recovery"];
  for (const id of ["savings", "pelican", "conduit", "cordage"]) {
    const parts = phases.map((ph) => {
      const s = qs.filter((x) => x.ph === ph && x.q[id]);
      if (!s.length) return null;
      const open = s.filter((x) => x.q[id].open);
      return `${ph.slice(0, 4)} ${open.length ? (q(open.map((x) => x.q[id].spread), 0.5) * 100).toFixed(0) + "bp/" + pct(q(open.map((x) => x.q[id].ltv), 0.5), 0) : "shut"}${open.length < s.length ? ` (${pct(1 - open.length / s.length, 0)} shut)` : ""}`;
    }).filter(Boolean);
    line(`${id}: spread / advance by phase`, "", "");
    console.log(`      ${parts.join("  ·  ")}`);
  }
  console.log(`      real: bank 175-250bp / 65-75% in a boom, 350-450bp / 50-60% in a bust; conduit window shut 2008Q4-2010; fund 400-700bp`);
  const st = mkt.map((x) => x.st);
  line("underwriting standards index p10/p50/p90", `${q(st, 0.1).toFixed(2)} / ${q(st, 0.5).toFixed(2)} / ${q(st, 0.9).toFixed(2)}`, "SLOOS: tightening clustered, easing slow");

  console.log("\n  SCALE");
  const sys = mkt.filter((x) => x.m % 12 === 11);
  line("named share of the system book", `${pct(q(sys.map((x) => x.namedTot / x.sysBook), 0.5))} median`, "the modelled firms' share of town debt");
  const growth = runs.map((r) => { const a = r.mkt[11]?.sysBook, b = r.mkt[r.mkt.length - 1]?.sysBook; return a && b ? Math.pow(b / a, 12 / (r.mkt.length - 12)) - 1 : NaN; });
  line("system book growth, nominal /yr", pct(q(growth, 0.5), 2), "~ nominal property value growth (4-6%)");
  const rf = mkt.reduce((a, x) => a + x.rivalsFailedThisMonth, 0);
  line("street firms failed", `${rf} (${(rf / years).toFixed(2)}/yr)`, "");
}
