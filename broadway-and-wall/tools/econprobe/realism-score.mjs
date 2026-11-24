// REALISM SCORECARD — a smoke alarm, not a scoreboard.
//
//   SEEDS=1 OFF=0 HZ=360 OUT=s0.json node tools/econprobe/series.mjs   (one per seed, in parallel)
//   node tools/econprobe/realism-score.mjs s0.json s1.json ...
//
// Prints each statistic of the no-player series next to a US reference range
// (1960-2024 unless stated). CLAUDE.md: the goal is simulation, not history.
// A row outside its range is a prompt to look for a broken MECHANISM, never a
// number to tune toward; do not report "n in range" as progress.
//
// Definitions that bit the first cut (2026-11-24):
//  - `land` (econ.landIdx) is already a REAL index — value.ts multiplies it by
//    cpi x priceLevel — so it is not deflated again here.
//  - `part` (econ.participation) is labour force / ALL residents, children
//    included; the US comparison on that definition is LF / total population.
//  - wage growth is read net of expected inflation; the town's pay responds to
//    slack as a wage curve (level vs national), so this is a weak test.
import { readFileSync } from "node:fs";
const runs = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
const K = ["office", "retail", "multifamily", "industrial"];
const q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => { const f = a.filter(Number.isFinite); return f.reduce((x, y) => x + y, 0) / f.length; };
const sd = (a) => { const m = mean(a); const f = a.filter(Number.isFinite); return Math.sqrt(f.reduce((x, y) => x + (y - m) ** 2, 0) / (f.length - 1)); };
const corr = (x, y) => { const p = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)); const mx = mean(p.map((z) => z[0])), my = mean(p.map((z) => z[1])); let a = 0, b = 0, c = 0; for (const [u, v] of p) { a += (u - mx) * (v - my); b += (u - mx) ** 2; c += (v - my) ** 2; } return a / Math.sqrt(b * c); };
const P = (x) => (100 * x).toFixed(1);
const rows = [];
const line = (name, sim, ref, ok) => rows.push([name, sim, ref, ok === undefined ? "" : ok ? "in" : "OUT"]);
const all = (fn) => runs.flatMap((r) => r.rows.map((x, i) => fn(x, i, r.rows)));
const yoy = (fn) => runs.flatMap((r) => r.rows.slice(12).map((x, i) => fn(x) / fn(r.rows[i]) - 1));
const dist = (name, v, ref, lo, hi, scale = 100) => { const m = mean(v); line(name, `p5 ${(q(v, .05) * scale).toFixed(1)} · p50 ${(q(v, .5) * scale).toFixed(1)} · p95 ${(q(v, .95) * scale).toFixed(1)} · mean ${(m * scale).toFixed(1)}`, ref, m >= lo && m <= hi); };

console.log("Reference ranges are US history: a smoke alarm, not targets (CLAUDE.md: simulation, not history).");
console.log(`${runs.length} runs × ${runs[0].rows.length} months\n`);
// MACRO
dist("10y loan index %", all((x) => x.idx / 100), "1962-2024: 0.5–15.8, mean ~5.9", 0.035, 0.08);
dist("policy rate %", all((x) => x.policy / 100), "0–20, mean ~4.6", 0.02, 0.07);
dist("national inflation %", all((x) => x.nInfl), "mean ~3.5, p95 ~10", 0.015, 0.05);
dist("national unemployment %", all((x) => x.nUnemp), "mean 5.8, range 2.5–14.8, p95 ~9.5", 0.04, 0.075);
dist("local unemployment %", all((x) => x.unemp), "metros: mean 5–7, p95 ~11", 0.04, 0.08);
dist("labour force ÷ all residents %", all((x) => x.part), "US same definition ~49–51 (LF ÷ total pop)", 0.44, 0.56);
const tp = all((x) => x.idx - x.policy);
line("10y − policy (pp)", `mean ${mean(tp).toFixed(2)} · inverted ${P(tp.filter((v) => v < 0).length / tp.length)}% of months`, "mean ~+1.2; inverted ~10–15% of months", mean(tp) > 0.3 && mean(tp) < 2.5);
// recessions
let recM = 0, n = 0, spells = [], cur = 0;
for (const r of runs) { cur = 0; for (const x of r.rows) { n++; if (x.phase === "recession") { recM++; cur++; } else if (cur) { spells.push(cur); cur = 0; } } }
line("share of months in 'recession'", P(recM / n) + "%", "NBER 1960-2024: ~13%", recM / n > 0.08 && recM / n < 0.2);
{ let ch = 0; for (const r of runs) for (let i = 1; i < r.rows.length; i++) if (r.rows[i].phase !== r.rows[i - 1].phase) ch++; const per = ch / (n / 120); line("cycle label changes per decade", per.toFixed(1), "NBER: ~3–4 (peak+trough per ~6-yr cycle)", per < 8); }
line("recession length (mo)", `mean ${mean(spells).toFixed(1)} · n=${spells.length} over ${(n / 12).toFixed(0)} yrs`, "postwar mean ~10, one per ~6 yrs", mean(spells) > 6 && mean(spells) < 18);
// Okun / Phillips
const du = runs.flatMap((r) => r.rows.slice(12).map((x, i) => x.unemp - r.rows[i].unemp));
const dj = runs.flatMap((r) => r.rows.slice(12).map((x, i) => x.jobs / r.rows[i].jobs - 1));
dist("local job growth y/y %", dj, "metro: mean ~1.2, sd ~2", -0.005, 0.025);
line("job growth y/y sd", P(sd(dj)), "metro ~1.5–2.5", sd(dj) > 0.01 && sd(dj) < 0.035);
line("corr(Δunemp, job growth)", corr(du, dj).toFixed(2), "strongly negative (~-0.8)", corr(du, dj) < -0.5);
const ph = runs.flatMap((r) => r.rows.slice(12).map((x, i) => [x.unemp, (x.wage / r.rows[i].wage) - 1 - (x.inflExp ?? 0)]));
const pc = corr(ph.map((z) => z[0]), ph.map((z) => z[1]));
line("wage Phillips corr(unemp, wage g − expected infl)", pc.toFixed(2), "negative (-0.3 to -0.6)", pc < -0.15);
// real drift
const cagrs = (fn) => runs.map((r) => { const a = r.rows[0], b = r.rows.at(-1); return Math.pow(fn(b) / fn(a), 12 / (b.m - a.m)) - 1; });
line("real wage growth %/yr", cagrs((x) => x.wage / x.cpi).map(P).join(" / "), "~0.5–1.5", mean(cagrs((x) => x.wage / x.cpi)) > 0 && mean(cagrs((x) => x.wage / x.cpi)) < 0.02);
line("real construction cost %/yr", cagrs((x) => x.cost / x.cpi).map(P).join(" / "), "~0 to +1", Math.abs(mean(cagrs((x) => x.cost / x.cpi))) < 0.015);
// landIdx is already REAL (value.ts multiplies it by cpi × priceLevel), so it is not deflated again
line("real land index %/yr", cagrs((x) => x.land).map(P).join(" / "), "growing metros ~+1–3", mean(cagrs((x) => x.land)) > -0.01 && mean(cagrs((x) => x.land)) < 0.04);
line("population %/yr", cagrs((x) => x.pop).map(P).join(" / "), "US ~0.9; metros -1..+3", true);
// CRE
const NATREF = { office: ["8–20, mean ~14", 0.08, 0.2], retail: ["5–13, mean ~9", 0.05, 0.13], multifamily: ["4–8, mean ~6", 0.035, 0.09], industrial: ["3–12, mean ~8", 0.03, 0.12] };
const CAPREF = { office: ["5–9.5 (1985-2024), mean ~7.3", 5, 9.5], retail: ["5.5–9.5, mean ~7.3", 5.5, 9.5], multifamily: ["4–9, mean ~6.3", 4, 9], industrial: ["4–9.5, mean ~7", 4, 9.5] };
const RVOL = { office: [0.04, 0.12], retail: [0.02, 0.08], multifamily: [0.02, 0.07], industrial: [0.02, 0.09] };
for (const k of K) {
  dist(`${k} vacancy %`, all((x) => x[k].vac), NATREF[k][0], NATREF[k][1], NATREF[k][2]);
  dist(`${k} cap rate %`, all((x) => x[k].cap / 100), CAPREF[k][0], CAPREF[k][1] / 100, CAPREF[k][2] / 100);
  const ry = yoy((x) => x[k].eff / x.cpi);
  line(`${k} real eff-rent y/y`, `mean ${P(mean(ry))} · sd ${P(sd(ry))} · min ${P(q(ry, 0.01))} · max ${P(q(ry, 0.99))}`, `real ~ -1..+1 mean; sd ${P(RVOL[k][0])}–${P(RVOL[k][1])}`, Math.abs(mean(ry)) < 0.02 && sd(ry) >= RVOL[k][0] && sd(ry) <= RVOL[k][1]);
  const gap = runs.flatMap((r) => r.rows.slice(12).map((x) => x[k].vac)), gr = yoy((x) => x[k].eff / x.cpi);
  line(`${k} corr(vacancy, real rent growth)`, corr(gap, gr).toFixed(2), "negative (-0.4 to -0.8)", corr(gap, gr) < -0.25);
  const sp = all((x) => x[k].cap - x.idx);
  line(`${k} cap − 10y spread (pp)`, `mean ${mean(sp).toFixed(2)} · p5 ${q(sp, .05).toFixed(2)} · p95 ${q(sp, .95).toFixed(2)}`, "~+1 to +4; negative only in high-inflation 1980s", mean(sp) > 0 && mean(sp) < 5);
  const dcap = runs.flatMap((r) => r.rows.slice(12).map((x, i) => x[k].cap - r.rows[i][k].cap)), didx = runs.flatMap((r) => r.rows.slice(12).map((x, i) => x.idx - r.rows[i].idx));
  line(`${k} corr(Δcap, Δ10y) y/y`, corr(dcap, didx).toFixed(2), "positive, ~0.3–0.6 (sticky)", corr(dcap, didx) > 0.15 && corr(dcap, didx) < 0.9);
  // value proxy: eff rent / cap — price drawdown
  const dd = runs.map((r) => { let pk = 0, mdd = 0; for (const x of r.rows) { const v = x[k].eff * (1 - x[k].vac) / x[k].cap / x.cpi; pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); } return mdd; });
  line(`${k} max real value drawdown (NOI/cap)`, dd.map(P).join(" / "), "CPPI 1990/2009: -30 to -45 real; office 2020s -40+", Math.min(...dd) < -0.15 && Math.max(...dd) > -0.75);
  const st = runs.map((r) => { const s = r.rows.map((x) => x[k].comp12 / x[k].stock).filter(Number.isFinite); return mean(s); });
  line(`${k} completions % of stock/yr`, st.map(P).join(" / "), "office ~1–2.5, MF ~1.5–3, ind ~1.5–3, retail ~0.5–1.5", true);
}
const w = [0, 0, 0];
for (const r of rows) for (let i = 0; i < 3; i++) w[i] = Math.max(w[i], String(r[i]).length);
console.log(["statistic", "sim", "US reference"].map((c, i) => c.padEnd(w[i])).join(" │ "));
for (const r of rows) console.log(r.slice(0, 3).map((c, i) => String(c).padEnd(w[i])).join(" │ "));
