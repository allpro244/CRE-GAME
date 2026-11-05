// THE NATION UNDER A PEG, AND UNDER A VOLCKER (REAL_ECONOMY_PLAN Phase 1).
//
//   node tools/econprobe/nation-peg.mjs            SEEDS=40 by default
//
// The national block alone (tickNation), as tools/econprobe/nation.mjs runs it.
// Three readings, each a property the record pins down — not a target to tune to:
//
//  1. BASELINE, 40 seeds x 100 years, no intervention: mean inflation, share of
//     months over 6%, the median century peak, deflation (< -2%) share, months
//     at the zero floor. A fix to the peg must leave these about where they are.
//  2. THE PEG: policy held at 0.25% for 120 months from year 10 (re-imposed
//     before every month, as tools/shocks/capital.mjs does), then released.
//     Read: peak 12-month inflation during and after, and months from release
//     until 12-month inflation is back under 5%. The record: easy money into
//     full employment ran US inflation to 5-14% over 1965-81, never triple
//     digits; high inflations under an independent bank end within 1-3 years
//     of a positive real rate (Volcker 1980-83; Israel and Bolivia 1985).
//  3. VOLCKER: from a 12% inflation, policy held 8 points over inflation for
//     36 months, then released. Read: months until 12-month inflation is
//     under 5%, and the peak unemployment it costs. The record: 1980-83, CPI
//     ~13% -> ~3% in about three years at a peak unemployment of 10.8%.
import { join } from "node:path";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(process.env.ENGINE ?? join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const { parcels: P0 } = loadCity(0, E.normalizeParcels);
const N = Number(process.env.SEEDS ?? 40);

function fresh(i) {
  const g0 = E.newGame(5000 + i * 7919, JSON.parse(JSON.stringify(P0)));
  return { ...g0, econ: { ...g0.econ, nat: { ...g0.econ.nat } } };
}
function step(s, m, pre) {
  s.month = m; s.econ.unemployment = s.econ.nat.unemp; s.news = [];
  if (pre) pre(s.econ.nat, m);
  E.tickNation(s);
  return s.econ.nat;
}
const q = (a, p) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(p * (b.length - 1))] : NaN; };
const mean = (a) => { const b = a.filter(Number.isFinite); return b.reduce((x, y) => x + y, 0) / Math.max(1, b.length); };
const pct = (x) => (100 * x).toFixed(1) + "%";
// 12-month inflation from the monthly annualised prints
const yoy = (hist) => { const h = hist.slice(-12); return h.reduce((p, x) => p * Math.pow(1 + x, 1 / 12), 1) - 1; };

// 1. baseline
let infl = [], peaks = [], over6 = 0, defl = 0, zero = 0, months = 0;
for (let i = 0; i < N; i++) {
  const s = fresh(i);
  const h = []; let pk = -1;
  for (let m = 0; m < 1200; m++) {
    const n = step(s, m);
    h.push(n.infl); const y = yoy(h);
    if (m >= 12) { infl.push(y); pk = Math.max(pk, y); months++; if (y > 0.06) over6++; if (y < -0.02) defl++; }
    if (n.policy <= 0.26) zero++;
  }
  peaks.push(pk);
}
console.log(`BASELINE ${N} seeds x 100y: 12m inflation mean ${pct(mean(infl))} p90 ${pct(q(infl, 0.9))}; months >6% ${pct(over6 / months)}; century peak p50 ${pct(q(peaks, 0.5))} p90 ${pct(q(peaks, 0.9))}; deflation (<-2%) ${pct(defl / months)}; policy at the zero floor ${pct(zero / (N * 1200))}`);

// 2. the peg
const PEG_AT = 120, PEG_M = 120, AFTER = 180;
let pkIn = [], pkAfter = [], breakM = [], uMin = [];
for (let i = 0; i < N; i++) {
  const s = fresh(i);
  const h = []; let a = -1, b = -1, br = NaN, um = 1;
  for (let m = 0; m < PEG_AT + PEG_M + AFTER; m++) {
    const pegged = m >= PEG_AT && m < PEG_AT + PEG_M;
    const n = step(s, m, pegged ? (nat) => { nat.policy = 0.25; } : null);
    h.push(n.infl); const y = yoy(h);
    if (pegged) { a = Math.max(a, y); um = Math.min(um, n.unemp); }
    if (m >= PEG_AT + PEG_M) {
      b = Math.max(b, y);
      if (!Number.isFinite(br) && y < 0.05) br = m - (PEG_AT + PEG_M);
    }
  }
  pkIn.push(a); pkAfter.push(b); breakM.push(Number.isFinite(br) ? br : AFTER); uMin.push(um);
}
console.log(`PEG 0.25% for ${PEG_M}m from year 10, ${N} seeds: peak 12m inflation during p50 ${pct(q(pkIn, 0.5))} p90 ${pct(q(pkIn, 0.9))} max ${pct(Math.max(...pkIn))}; after release p50 ${pct(q(pkAfter, 0.5))} max ${pct(Math.max(...pkAfter))}; months from release to <5% p50 ${q(breakM, 0.5)} p90 ${q(breakM, 0.9)} (${breakM.filter((x) => x >= AFTER).length} seeds never in ${AFTER}); min unemployment under the peg p50 ${pct(q(uMin, 0.5))}`);

// 3. Volcker: drive inflation to ~12% with a peg first, then hold real policy +8 for 36 months
let vBreak = [], vU = [], vStart = [];
for (let i = 0; i < N; i++) {
  const s = fresh(i);
  const h = []; let started = -1, br = NaN, u0 = 0, upk = 0;
  for (let m = 0; m < 900; m++) {
    const n0 = s.econ.nat;
    const y0 = h.length >= 12 ? yoy(h) : 0.02;
    let pre = null;
    if (started < 0 && m >= 120) {
      if (y0 >= 0.12) { started = m; u0 = n0.unemp; }
      else pre = (nat) => { nat.policy = 0.25; };
    }
    if (started >= 0 && m < started + 36) pre = (nat) => { nat.policy = Math.max(nat.policy, 100 * (yoy(h) + 0.08)); };
    const n = step(s, m, pre);
    h.push(n.infl); const y = yoy(h);
    if (started >= 0) {
      upk = Math.max(upk, n.unemp);
      if (!Number.isFinite(br) && y < 0.05) br = m - started;
      if (m > started + 120) break;
    }
  }
  if (started >= 0) { vStart.push(started); vBreak.push(Number.isFinite(br) ? br : 120); vU.push(upk - u0); }
}
console.log(`VOLCKER from 12% (reached on ${vStart.length}/${N} seeds): months to <5% p50 ${q(vBreak, 0.5)} p90 ${q(vBreak, 0.9)} (${vBreak.filter((x) => x >= 120).length} never in 10y); unemployment rise p50 ${pct(q(vU, 0.5))} p90 ${pct(q(vU, 0.9))}`);
