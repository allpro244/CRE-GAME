// National block alone: 40 seeds x 100 years of tickNation. Unemployment distribution,
// recession frequency and length, and the mean Phillips terms at the natural rate.
import { join } from "node:path";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const { parcels: P0, bbls } = loadCity(0, E.normalizeParcels);
const N = Number(process.env.SEEDS ?? 40), HZ = 1200;
let us = [], recs = 0, recMonths = 0, expLens = [], rises = [], realPol = [], infl = [], hazPol = [];
for (let i = 0; i < N; i++) {
  const g0 = E.newGame(5000 + i * 7919, JSON.parse(JSON.stringify(P0)));
  const s = { ...g0, econ: { ...g0.econ, nat: { ...g0.econ.nat } } };
  let inRec = false, expStart = 0, uStart = 0, maxU = 0;
  for (let m = 0; m < HZ; m++) {
    s.month = m; s.econ.unemployment = s.econ.nat.unemp; s.news = [];
    E.tickNation(s);
    const n = s.econ.nat; const r = (n.recM ?? 0) > 0;
    us.push(n.unemp); infl.push(n.infl); realPol.push(n.policy / 100 - n.infl);
    hazPol.push(Math.min(0.09, Math.max(0, (n.policy / 100 - n.infl - 0.022) * 0.7)));
    if (r) recMonths++;
    if (r && !inRec) { recs++; expLens.push(m - expStart); uStart = n.unemp; maxU = n.unemp; }
    if (r) maxU = Math.max(maxU, n.unemp);
    if (!r && inRec) { expStart = m; }
    if (inRec || r) maxU = Math.max(maxU, n.unemp);
    if (!r && inRec) rises.push(maxU - uStart);
    inRec = r;
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
console.log(`u mean ${mean(us).toFixed(4)} p10 ${q(us,.1).toFixed(3)} p50 ${q(us,.5).toFixed(3)} p90 ${q(us,.9).toFixed(3)} share<4.8 ${(us.filter(x=>x<0.048).length/us.length).toFixed(2)}`);
console.log(`recessions per century ${(recs / N * 100 / (HZ/12)).toFixed(1)}  share of months in rec ${(recMonths/us.length).toFixed(3)}  mean expansion ${mean(expLens.slice(1)).toFixed(0)}m  mean rise ${mean(rises).toFixed(3)}`);
console.log(`infl mean ${mean(infl).toFixed(4)} realPolicy mean ${mean(realPol).toFixed(4)} policy-hazard mean ${mean(hazPol).toFixed(4)} /mo`);
const ph = us.map(u => { const g = Number(process.env.US ?? 0.048) - u; return g > 0 ? 0.38 * g + 4.5 * g * g : 0.20 * g; });
const lin = us.map(u => Math.max(-0.06, Math.min(0.055, Number(process.env.US ?? 0.048) - u)) * 0.144);
console.log(`mean price-phillips ${(mean(ph)*100).toFixed(3)}%/yr  mean wage-gap term ${(mean(lin)*100).toFixed(3)}%/yr`);
