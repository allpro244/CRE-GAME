// WHAT ADVANCE THE MARKET ACTUALLY OFFERS, AND WHEN IT MOVES.
//
//   pnpm engine && pnpm ltvdist            (six seeds x 30 years, ~10 min)
//   SEEDS=550991,12007 YEARS=10 pnpm ltvdist
//
// REPORT, not a gate. Every income desk is quoted on every built listing
// (sampled), the best available senior advance per listing is cut by credit
// window, phase, era, class, occupancy, size, index and condition, and the
// advance factor and appetite of every desk are printed. Before the sheet
// moved (Sep 2026) the best advance sat at 53-62% between the quartiles in
// every cut; after, 60-76%, with the credit window the strongest gradient.
//
// STANDING FACT: no playtest in this repo is based on Manhattan. Every
// harness run and number here is a GENERATED city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,11,4242,91117,20603").split(",").map(Number);
const YEARS = +(process.env.YEARS ?? 30);
const DESKS = ["harbor", "savings", "pelican", "conduit", "cordage"];
const LENDERS = [...new Set(DESKS.map((d) => E.productById(d).lender))];
const rows = []; const advRows = [];
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "—";
for (const seed of SEEDS) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let q = 0; q <= YEARS * 4; q++) {
    if (q % 2 === 0) {
      const ci = g.econ.creditIdx ?? 1;
      const advs = {}; for (const L of LENDERS) advs[L] = { adv: E.advanceFactor(g, L), app: E.lenderAppetite(g, L) };
      advRows.push({ seed, m: g.month, ci, era: g.econ.eraKey, phase: g.econ.phase, idx: g.econ.indexRate, ...Object.fromEntries(LENDERS.map((L) => [L, advs[L]])) });
      const live = g.listings.filter((li) => { const r = E.resolveRec(parcels, g, li.bbl); return r && r.bldgArea > 0 && r.class !== "land" && !li.halfBuilt; });
      // cap the sample so the run stays bounded
      const take = live.length > 30 ? live.filter((_, i) => i % Math.ceil(live.length / 30) === 0) : live;
      for (const li of take) {
        const rec = E.resolveRec(parcels, g, li.bbl);
        const ip = E.inPlace(rec, g, li.bbl, li.ask);
        const grade = E.gradeOf(g, rec);
        const per = {}; let best = null;
        for (const d of DESKS) {
          const qq = E.buyQuote(g, parcels, li.bbl, li.ask, d, 1);
          const ltvAsk = qq.principal / li.ask, ltvBasis = qq.uwBasis > 0 ? qq.principal / qq.uwBasis : 0;
          per[d] = { p: qq.principal, ltvAsk, ltvBasis, bind: qq.bind, rate: qq.ratePct };
          if (qq.principal > 0 && (!best || qq.principal > best.p)) best = { d, ...per[d] };
        }
        rows.push({ seed, m: g.month, ci, era: g.econ.eraKey, phase: g.econ.phase, idx: g.econ.indexRate, cls: rec.class, grade, occ: ip.occ, ask: li.ask, per, best });
      }
    }
    if (q === YEARS * 4) break;
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
  }
  console.error(`seed ${seed} done: ${rows.filter((r) => r.seed === seed).length} listing-quotes`);
}
// ---------------------------------------------------------------- report
console.log(`listings quoted: ${rows.length} over ${SEEDS.length} seeds x ${YEARS}y (sampled every 2 quarters, <=30 per sample)`);
console.log("\n== per desk: advance as % of ASK and of UW BASIS, and what bound ==");
for (const d of DESKS) {
  const qs = rows.map((r) => r.per[d]); const open = qs.filter((x) => x.p > 0);
  const binds = {}; for (const x of qs) binds[x.bind] = (binds[x.bind] ?? 0) + 1;
  console.log(`${d.padEnd(8)} quoted ${String(open.length).padStart(5)}/${qs.length}  ltv/ask p10 ${f(pct(open.map((x) => x.ltvAsk), .1))} p50 ${f(pct(open.map((x) => x.ltvAsk), .5))} p90 ${f(pct(open.map((x) => x.ltvAsk), .9))}` +
    `  ltv/basis p10 ${f(pct(open.map((x) => x.ltvBasis), .1))} p50 ${f(pct(open.map((x) => x.ltvBasis), .5))} p90 ${f(pct(open.map((x) => x.ltvBasis), .9))}` +
    `  bind: ${Object.entries(binds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / qs.length * 100).toFixed(0)}%`).join(", ")}`);
}
const withBest = rows.filter((r) => r.best);
console.log(`\n== best available senior advance per listing (${withBest.length} with any quote; ${rows.length - withBest.length} unfinanceable) ==`);
const cut = (label, keyFn, order) => {
  const groups = {}; for (const r of withBest) { const k = keyFn(r); (groups[k] ??= []).push(r); }
  const keys = order ?? Object.keys(groups).sort();
  console.log(`\n-- by ${label} --`);
  for (const k of keys) { const g = groups[k]; if (!g) continue; const a = g.map((r) => r.best.ltvBasis); const desks = {}; for (const r of g) desks[r.best.d] = (desks[r.best.d] ?? 0) + 1;
    console.log(`${String(k).padEnd(22)} n ${String(g.length).padStart(5)}  ltv/basis p10 ${f(pct(a, .1))} p50 ${f(pct(a, .5))} p90 ${f(pct(a, .9))}  sd ${f(Math.sqrt(a.reduce((s, x) => s + (x - a.reduce((p, q) => p + q, 0) / a.length) ** 2, 0) / a.length), 3)}  desk: ${Object.entries(desks).sort((x, y) => y[1] - x[1]).map(([d, n]) => `${d} ${(n / g.length * 100).toFixed(0)}%`).join(", ")}`);
  }
};
cut("credit window", (r) => r.ci >= 0.95 ? "open ≥0.95" : r.ci >= 0.8 ? "0.80-0.95" : r.ci >= 0.6 ? "0.60-0.80" : r.ci >= 0.4 ? "0.40-0.60" : "shut <0.40", ["open ≥0.95", "0.80-0.95", "0.60-0.80", "0.40-0.60", "shut <0.40"]);
cut("phase", (r) => r.phase);
cut("era", (r) => r.era);
cut("class", (r) => r.cls);
cut("occupancy", (r) => r.occ >= 0.9 ? "≥90%" : r.occ >= 0.75 ? "75-90%" : r.occ >= 0.5 ? "50-75%" : "<50%", ["≥90%", "75-90%", "50-75%", "<50%"]);
cut("ask size", (r) => r.ask < 2.5e6 ? "<$2.5M" : r.ask < 6e6 ? "$2.5-6M" : r.ask < 15e6 ? "$6-15M" : r.ask < 40e6 ? "$15-40M" : "≥$40M", ["<$2.5M", "$2.5-6M", "$6-15M", "$15-40M", "≥$40M"]);
cut("index rate", (r) => r.idx < 2 ? "<2%" : r.idx < 4 ? "2-4%" : r.idx < 6 ? "4-6%" : r.idx < 9 ? "6-9%" : "≥9%", ["<2%", "2-4%", "4-6%", "6-9%", "≥9%"]);
cut("condition", (r) => r.grade);
console.log("\n== advance factor & appetite by lender over all sampled months ==");
for (const L of LENDERS) {
  const a = advRows.map((r) => r[L].adv), ap = advRows.map((r) => r[L].app);
  console.log(`${L.padEnd(24)} adv p5 ${f(pct(a, .05))} p50 ${f(pct(a, .5))} p95 ${f(pct(a, .95))}  <0.97 in ${(a.filter((x) => x < 0.97).length / a.length * 100).toFixed(0)}% of months;  appetite p5 ${f(pct(ap, .05))} p50 ${f(pct(ap, .5))} p95 ${f(pct(ap, .95))}  <0.12 (shut) ${(ap.filter((x) => x < 0.12).length / ap.length * 100).toFixed(0)}%`);
}
const cis = advRows.map((r) => r.ci);
console.log(`creditIdx p5 ${f(pct(cis, .05))} p50 ${f(pct(cis, .5))} p95 ${f(pct(cis, .95))}; <0.8 in ${(cis.filter((x) => x < 0.8).length / cis.length * 100).toFixed(0)}% of months`);
// how much of the LTV variance is explained by anything at all?
const all = withBest.map((r) => r.best.ltvBasis);
console.log(`\nbest ltv/basis overall: p5 ${f(pct(all, .05))} p25 ${f(pct(all, .25))} p50 ${f(pct(all, .5))} p75 ${f(pct(all, .75))} p95 ${f(pct(all, .95))}`);
const hist = {}; for (const x of all) { const b = (Math.floor(x * 20) / 20).toFixed(2); hist[b] = (hist[b] ?? 0) + 1; }
console.log("histogram (5-pt bins): " + Object.entries(hist).sort().map(([b, n]) => `${b}:${n}`).join(" "));
