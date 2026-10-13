import { readFileSync } from "node:fs";
const runs = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
const K = ["office", "retail", "multifamily", "industrial"];
const NAT = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const mean = (a) => { const f = a.filter(Number.isFinite); return f.reduce((x, y) => x + y, 0) / f.length; };
const corr = (x, y) => { const p = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)); const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1])); let sxy = 0, sxx = 0, syy = 0; for (const [a, b] of p) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const ols = (x, y) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; }); return sxy / sxx; };
const pct = (x) => (100 * x).toFixed(2) + "%";
const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "—";
const cagr = (a, b, yrs) => Math.pow(b / a, 1 / yrs) - 1;

console.log(`${runs.length} runs`);
console.log("\n== 1. REAL DRIFT over 50y (CAGR of X/CPI), per run");
console.log("seed     cpi/yr  wage_r  cost_r  land_r  rentO_r rentR_r rentM_r rentI_r pop/yr  jobs/yr");
for (const r of runs) {
  const a = r.rows[11], b = r.rows[r.rows.length - 1], yrs = (b.m - a.m) / 12;
  const rr = (k) => cagr(a[k].rent / a.cpi, b[k].rent / b.cpi, yrs);
  console.log(String(r.seed).padEnd(8), [cagr(a.cpi, b.cpi, yrs), cagr(a.wage / a.cpi, b.wage / b.cpi, yrs), cagr(a.cost / a.cpi, b.cost / b.cpi, yrs), cagr(a.land / a.cpi, b.land / b.cpi, yrs), rr("office"), rr("retail"), rr("multifamily"), rr("industrial"), cagr(a.pop, b.pop, yrs), cagr(a.jobs, b.jobs, yrs)].map((x) => pct(x).padStart(7)).join(" "));
}

console.log("\n== 2. RENT RESPONSE TO VACANCY GAP: slope of 12m real eff-rent growth on (vac - natural), and share of months rent rises while vac > nat+5pp");
for (const k of K) {
  const xs = [], ys = []; let bad = 0, soft = 0;
  for (const r of runs) for (let i = 12; i < r.rows.length; i++) {
    const a = r.rows[i - 12], b = r.rows[i];
    const g = (b[k].eff / b.cpi) / (a[k].eff / a.cpi) - 1, gap = b[k].vac - NAT[k];
    xs.push(gap); ys.push(g);
    if (gap > 0.05) { soft++; if (b[k].eff / a[k].eff - 1 > 0) bad++; }
  }
  console.log(`${k.padEnd(12)} slope ${f(ols(xs, ys), 3)} (real 12m growth per unit gap) corr ${f(corr(xs, ys))} · nominal eff rent rising in ${soft ? pct(bad / soft) : "—"} of ${soft} glut months`);
}

console.log("\n== 3. VACANCY distribution per class (all months): p5/p50/p95, share of months within 0.3pp of the run's min");
for (const k of K) {
  const all = []; let atMin = 0, n = 0;
  for (const r of runs) { const v = r.rows.map((x) => x[k].vac); const mn = Math.min(...v); for (const x of v) { all.push(x); n++; if (x < mn + 0.003) atMin++; } }
  all.sort((a, b) => a - b);
  console.log(`${k.padEnd(12)} p5 ${pct(all[Math.floor(0.05 * all.length)])} p50 ${pct(all[all.length >> 1])} p95 ${pct(all[Math.floor(0.95 * all.length)])} natural ${pct(NAT[k])} · at-floor ${pct(atMin / n)}`);
}

console.log("\n== 4. CAP RATES vs LOAN INDEX: level, slope, spread");
for (const k of K) {
  const x = [], y = [];
  for (const r of runs) for (const row of r.rows) { x.push(row.idx); y.push(row[k].cap); }
  const spr = y.map((c, i) => c - x[i]);
  console.log(`${k.padEnd(12)} cap p50 ${f(med(y))} · slope dCap/dIdx ${f(ols(x, y))} · spread p10/p50/p90 ${f(spr.slice().sort((a,b)=>a-b)[Math.floor(.1*spr.length)])}/${f(med(spr))}/${f(spr.slice().sort((a,b)=>a-b)[Math.floor(.9*spr.length)])} · months negative leverage (cap<idx) ${pct(spr.filter((s) => s < 0).length / spr.length)}`);
}

console.log("\n== 5. VALUE vs REPLACEMENT (Tobin's q proxy): q = (effRent*(1-vac)*0.6/cap) / (rent0*(1-vac0)*0.6/cap0 * cost)  normalized to month 12 = 1");
for (const k of K) {
  const qs = [], st = [];
  let corrQ = [];
  for (const r of runs) {
    const a = r.rows[11];
    const v0 = a[k].eff * (1 - a[k].vac) / a[k].cap / a.cost;
    for (let i = 12; i < r.rows.length - 24; i++) {
      const b = r.rows[i];
      const q = (b[k].eff * (1 - b[k].vac) / b[k].cap / b.cost) / v0;
      qs.push(q);
      // forward 24m starts as share of stock
      let s = 0; for (let j = i; j < i + 24; j++) s += r.rows[j][k].starts; st.push(s / b[k].stock);
    }
  }
  const sorted = qs.slice().sort((a, b) => a - b);
  console.log(`${k.padEnd(12)} q p10/p50/p90 ${f(sorted[Math.floor(.1*sorted.length)])}/${f(med(qs))}/${f(sorted[Math.floor(.9*sorted.length)])} · corr(q, fwd 24m starts/stock) ${f(corr(qs, st))}`);
}

console.log("\n== 6. STARTS & STOCK: share of months with zero starts; 50y stock growth vs jobs/pop growth");
for (const k of K) {
  let zero = 0, n = 0; const sg = [], dg = [];
  for (const r of runs) {
    for (const row of r.rows) { n++; if (!(row[k].starts > 0)) zero++; }
    const a = r.rows[11], b = r.rows[r.rows.length - 1];
    sg.push(b[k].stock / a[k].stock - 1); dg.push(b[k].occ / a[k].occ - 1);
  }
  console.log(`${k.padEnd(12)} zero-start months ${pct(zero / n)} · stock growth med ${pct(med(sg))} · occupied growth med ${pct(med(dg))}`);
}
{ const jg = runs.map((r) => r.rows.at(-1).jobs / r.rows[11].jobs - 1), pg = runs.map((r) => r.rows.at(-1).pop / r.rows[11].pop - 1); console.log(`jobs growth med ${pct(med(jg))} · pop growth med ${pct(med(pg))}`); }

console.log("\n== 7. MACRO: policy rate, national inflation, unemployment");
for (const r of runs) {
  const p = r.rows.map((x) => x.policy), inf = r.rows.map((x) => x.nInfl), u = r.rows.map((x) => x.unemp), nu = r.rows.map((x) => x.nUnemp);
  const realPol = r.rows.map((x) => x.policy / 100 - x.nInfl);
  console.log(`${r.seed}: policy p50 ${f(med(p))} · natInfl p50 ${pct(med(inf))} max ${pct(Math.max(...inf))} · local u p50 ${pct(med(u))} min ${pct(Math.min(...u))} max ${pct(Math.max(...u))} · nat u p50 ${pct(med(nu))} · real policy p50 ${pct(med(realPol))} · corr(policy, natInfl) ${f(corr(p, inf))} · credit p50 ${f(med(r.rows.map(x=>x.credit)))}`);
}

console.log("\n== 8. PHASE mix & credit steps");
{ const ph = {}; let n = 0, jumps = []; for (const r of runs) { for (let i = 0; i < r.rows.length; i++) { const x = r.rows[i]; ph[x.phase] = (ph[x.phase] ?? 0) + 1; n++; if (i) jumps.push(Math.abs(x.credit - r.rows[i - 1].credit)); } }
  console.log(Object.entries(ph).map(([k, v]) => `${k} ${pct(v / n)}`).join(" · "), `· |Δcredit| p99 ${f(jumps.sort((a,b)=>a-b)[Math.floor(.99*jumps.length)],3)}`); }

console.log("\n== 9. LAND: landIdx vs implied residual; parcel median landPsf; building age");
for (const r of runs) {
  const yr = r.rows.filter((x) => x.age !== undefined);
  console.log(`${r.seed}: landIdx ${f(r.rows[11].land)} -> ${f(r.rows.at(-1).land)} · landMed ${f(yr[0].landMed)} -> ${f(yr.at(-1).landMed)} (real ${pct(cagr(yr[0].landMed / yr[0].cpi, yr.at(-1).landMed / yr.at(-1).cpi, yr.length - 1))}/yr) · mean bldg age ${f(yr[0].age, 0)} -> ${f(yr.at(-1).age, 0)} · built ${yr[0].nBuilt} -> ${yr.at(-1).nBuilt} · rivals ${yr[0].rivals} -> ${yr.at(-1).rivals}`);
}

console.log("\n== 10. DEMAND INTENSITY: occupied sf per job (office) and per capita (mf, retail) — 50y change");
for (const r of runs) {
  const a = r.rows[11], b = r.rows.at(-1);
  console.log(`${r.seed}: office sf/job ${f(a.office.occ / a.jobs, 0)} -> ${f(b.office.occ / b.jobs, 0)} · mf sf/cap ${f(a.multifamily.occ / a.pop, 1)} -> ${f(b.multifamily.occ / b.pop, 1)} · retail sf/cap ${f(a.retail.occ / a.pop, 1)} -> ${f(b.retail.occ / b.pop, 1)} · ind sf/job ${f(a.industrial.occ / a.jobs, 1)} -> ${f(b.industrial.occ / b.jobs, 1)}`);
}

console.log("\n== 11. RENT/INCOME: (rent/cpi)/(wage/cpi) i.e. rent/wage ratio change over 50y");
for (const r of runs) {
  const a = r.rows[11], b = r.rows.at(-1);
  console.log(`${r.seed}: ` + K.map((k) => `${k} ${f((b[k].rent / b.wage) / (a[k].rent / a.wage))}`).join(" · "));
}
