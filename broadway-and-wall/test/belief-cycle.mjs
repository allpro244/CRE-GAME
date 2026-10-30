// BELIEFS MAKE THE CYCLE (ONE_ECONOMY_PLAN.md §6c-C). One seed, thirty years:
// when do the cranes go up against when the tenants arrive? With agents that
// extrapolate what they have seen, construction decisions should peak AFTER
// demand growth peaks, and deliveries land into rising vacancy. A probe, not a
// gate: it prints the timing and asserts nothing.
//   pnpm engine && node test/belief-cycle.mjs        (SEED=, YEARS=, ROWS=1)
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 5000);
const YEARS = Number(process.env.YEARS ?? 30);
const K = ["office", "retail", "multifamily", "industrial"];

let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
const yr = [];
let seen = new Set((g.cityJobs ?? []).map((j) => j.bbl));
let acc = null;
const t0 = Date.now();
for (let m = 1; m <= YEARS * 12; m++) {
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  acc ??= { starts: {}, decided: {} };
  for (const j of g.cityJobs ?? []) {
    if (seen.has(j.bbl)) continue;
    const k = j.use === "mixed" ? "multifamily" : j.use;
    acc.starts[k] = (acc.starts[k] ?? 0) + (j.sf ?? 0);
  }
  seen = new Set((g.cityJobs ?? []).map((j) => j.bbl));
  for (const p of g.cityPlans ?? []) if (p.decidedM === g.month) { const k = p.use === "mixed" ? "multifamily" : p.use; acc.decided[k] = (acc.decided[k] ?? 0) + 1; }
  if (m % 12 === 0) {
    const h = g.econ.history, now = h[h.length - 1], then = h[h.length - 13];
    const row = { y: m / 12 };
    for (const k of K) {
      const occ = now?.occupied?.[k], occ0 = then?.occupied?.[k];
      row[k] = {
        vac: now?.vac?.[k] ?? NaN,
        dg: occ && occ0 ? occ / occ0 - 1 : NaN,
        st: (acc.starts[k] ?? 0) / Math.max(1, now?.stock?.[k] ?? 1),
        dec: acc.decided[k] ?? 0,
        rg: now?.effRent?.[k] && then?.effRent?.[k] ? now.effRent[k] / then.effRent[k] - 1 : NaN,
      };
    }
    yr.push(row);
    acc = null;
  }
}
const corr = (a, b) => {
  const n = a.length; if (n < 4) return NaN;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(sa * sb || 1);
};
// the lag in years at which b best follows a: argmax over L of corr(a[t], b[t+L])
const lagOf = (a, b) => {
  let best = { L: 0, r: -Infinity };
  for (let L = -3; L <= 4; L++) {
    const x = [], y = [];
    for (let t = 2; t < a.length; t++) if (t + L >= 2 && t + L < b.length && Number.isFinite(a[t]) && Number.isFinite(b[t + L])) { x.push(a[t]); y.push(b[t + L]); }
    const r = corr(x, y);
    if (r > best.r) best = { L, r };
  }
  return best;
};
console.log(`seed ${SEED} · ${YEARS} years · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const k of K) {
  const dg = yr.map((r) => r[k].dg), st = yr.map((r) => r[k].st), vac = yr.map((r) => r[k].vac);
  const l1 = lagOf(dg, st), l2 = lagOf(st, vac);
  const v = vac.slice(2);
  const sd = (a) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length); };
  console.log(`${k.padEnd(12)} starts follow demand by ${l1.L}y (r ${l1.r.toFixed(2)}) · vacancy follows starts by ${l2.L}y (r ${l2.r.toFixed(2)}) · vac ${(Math.min(...v) * 100).toFixed(1)}-${(Math.max(...v) * 100).toFixed(1)}% sd ${(sd(v) * 100).toFixed(1)} · starts max ${(Math.max(...st) * 100).toFixed(1)}%/yr of stock, sd ${(sd(st.slice(2)) * 100).toFixed(2)}`);
}
if (process.env.ROWS) for (const r of yr) console.log(r.y, K.map((k) => `${k.slice(0, 3)} v${(r[k].vac * 100).toFixed(1)} d${(r[k].dg * 100).toFixed(1)} s${(r[k].st * 100).toFixed(1)} r${(r[k].rg * 100).toFixed(1)}`).join(" | "));
