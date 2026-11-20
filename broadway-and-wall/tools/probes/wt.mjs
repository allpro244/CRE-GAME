import { readFileSync, readdirSync } from "fs";
const dir = process.argv[2];
for (const f of readdirSync(dir).filter(f => /^seed-\d+\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); const y = d.yr;
  const out = [];
  for (const k of ["office", "retail", "industrial"]) {
    const X = [], Y = [];
    for (let i = 0; i + 1 < y.length; i++) { if (y[i].Y < 6) continue;
      const v = y[i].vac?.[k], r0 = y[i].rentR?.[k], r1 = y[i + 1].rentR?.[k];
      if (v == null || !(r0 > 0) || !(r1 > 0)) continue; X.push(v * 100); Y.push(100 * Math.log(r1 / r0)); }
    const n = X.length, mx = X.reduce((a, b) => a + b, 0) / n, my = Y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; }
    out.push(`${k} WT ${(sxy / sxx).toFixed(2)} vac ${mx.toFixed(1)}`);
  }
  console.log(f, out.join(" | "));
}
