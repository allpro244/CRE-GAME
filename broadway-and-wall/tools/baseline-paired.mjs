// A BASELINE MOVE, ATTRIBUTED: two builds measured on the same seeds, paired.
//
//   SEEDS=... ENGINE=/abs/old/.engine.mjs DUMP=old.json node tools/baseline.mjs
//   SEEDS=... DUMP=new.json node tools/baseline.mjs
//   node tools/baseline-paired.mjs old.json new.json
//
// Per metric: mean before -> after, the mean paired change as a share of the
// old mean with its standard error, the paired t, and how many seeds moved up.
// A re-roll moves seeds both ways and reads |t| < 2; a level shift does not.
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
if (a.seeds.join() !== b.seeds.join()) { console.error("different seed sets — not a paired comparison"); process.exit(1); }
const n = a.seeds.length;
console.log(`\n  ${n} seeds, paired. metric: mean before -> after | change ± s.e. | t | seeds up\n`);
const rows = [];
for (const k of Object.keys(a.rows)) {
  const x = a.rows[k], y = b.rows[k];
  if (!y) continue;
  const d = x.map((v, i) => y[i] - v);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  const md = d.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - md) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  const t = se > 0 ? md / se : (md === 0 ? 0 : Infinity);
  const up = d.filter((v) => v > 0).length;
  rows.push({ k, mx, my, rel: mx !== 0 ? md / Math.abs(mx) : 0, relSe: mx !== 0 ? se / Math.abs(mx) : 0, t, up });
}
rows.sort((p, q) => Math.abs(q.t) - Math.abs(p.t));
for (const r of rows) {
  const f = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4));
  console.log(`  ${r.k.padEnd(28)} ${f(r.mx).padStart(10)} -> ${f(r.my).padStart(10)}  ${(r.rel * 100).toFixed(1).padStart(6)}% ± ${(r.relSe * 100).toFixed(1).padStart(5)}%  t ${Number.isFinite(r.t) ? r.t.toFixed(2).padStart(6) : "   inf"}  up ${r.up}/${n}`);
}
