// Who builds, and when: one century, no player. Logs every groundbreak with the
// firm's style (or "anon"), the phase, and credit; samples the street every
// year. Answers "does the whole street decide to build at the same moment?"
//   pnpm engine && RUN_SEED=4242 node tools/econprobe/firmtiming.mjs
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(process.env.ENGINE ?? join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const HZ = Number(process.env.HZ ?? 1200);
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(Number(process.env.RUN_SEED ?? 4242), parcels), parcels, bbls);
const seen = new Set(), starts = [], years = [], compSeen = new Set(), buys = [];
const t0 = Date.now();
for (let m = 0; m < HZ; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  for (const j of g.cityJobs ?? []) {
    const k = j.bbl + "@" + j.startM;
    if (seen.has(k)) continue;
    seen.add(k);
    const r = j.firmId ? (g.rivals ?? []).find((x) => x.id === j.firmId) : null;
    starts.push({ m: j.startM, use: j.use, sf: j.sf, style: r ? r.style : j.firmId === "you" ? "you" : "anon",
      phase: g.econ.phase, ci: +(g.econ.creditIdx ?? 1).toFixed(2), ovac: +(g.econ.cityVac?.office ?? 0).toFixed(3) });
  }
  const firmNames = new Set((g.rivals ?? []).map((r) => r.name));
  for (const c of g.comps ?? []) {
    const k = `${c.bbl}@${c.m}@${c.price}`;
    if (compSeen.has(k)) continue;
    compSeen.add(k);
    buys.push({ m: c.m, firm: firmNames.has(c.buyer), off: !!c.offMarket, cls: c.cls, sellerFirm: firmNames.has(c.seller) });
  }
  if (m % 12 === 11) {
    const p = E.firmEntryPitch(g);
    const live = (g.rivals ?? []).filter((r) => r.failedM === undefined);
    const st = {}; for (const r of live) st[r.style] = (st[r.style] ?? 0) + 1;
    years.push({ y: (m + 1) / 12, ovac: +(g.econ.cityVac?.office ?? 0).toFixed(3), mvac: +(g.econ.cityVac?.multifamily ?? 0).toFixed(3), u: +((g.econ.unemployment ?? 0) * 100).toFixed(1), firms: live.length, styles: st, traded: p.traded, lev: +p.leverage.toFixed(2), prod: +p.product.toFixed(2), pitch: +p.pitch.toFixed(2),
      phase: g.econ.phase, ci: +(g.econ.creditIdx ?? 1).toFixed(2), pop: Math.round(g.econ.population ?? 0) });
  }
  if (m % 120 === 119) process.stderr.write(`year ${(m + 1) / 12} ${((Date.now() - t0) / 1000).toFixed(0)}s firms ${years.at(-1).firms}\n`);
}
// Timing dispersion: annual started sf, by builder class.
const yrs = Math.ceil(HZ / 12), by = {};
for (const s of starts) { const c = s.style; (by[c] ??= new Array(yrs).fill(0))[Math.min(yrs - 1, Math.floor(s.m / 12))] += s.sf; }
const all = new Array(yrs).fill(0); for (const s of starts) all[Math.min(yrs - 1, Math.floor(s.m / 12))] += s.sf;
const cv = (a) => { const mu = a.reduce((p, q) => p + q, 0) / a.length; return mu ? Math.sqrt(a.reduce((p, q) => p + (q - mu) ** 2, 0) / a.length) / mu : NaN; };
const top5 = (a) => { const t = a.reduce((p, q) => p + q, 0); return t ? [...a].sort((p, q) => q - p).slice(0, Math.ceil(a.length / 10)).reduce((p, q) => p + q, 0) / t : NaN; };
const phaseSf = {}; for (const s of starts) phaseSf[s.phase] = (phaseSf[s.phase] ?? 0) + s.sf;
const crunch = starts.filter((s) => s.ci < 0.8);
console.log(`starts ${starts.length}  sf ${(all.reduce((p, q) => p + q, 0) / 1e6).toFixed(2)}M  annual-sf CV ${cv(all).toFixed(2)}  top-decile-years share ${top5(all).toFixed(2)}`);
console.log("by builder:", Object.entries(by).map(([k, a]) => `${k} ${starts.filter((s) => s.style === k).length}/${(a.reduce((p, q) => p + q, 0) / 1e6).toFixed(2)}M`).join("  "));
console.log("sf by phase:", JSON.stringify(Object.fromEntries(Object.entries(phaseSf).map(([k, v]) => [k, +(v / 1e6).toFixed(2)]))));
console.log(`starts in credit crunch (ci<0.8): ${crunch.length}  by: ${JSON.stringify(crunch.reduce((o, s) => (o[s.style] = (o[s.style] ?? 0) + 1, o), {}))}`);
for (const y of years.filter((y) => y.y % 10 === 0)) console.log(`y${y.y} firms ${y.firms} traded ${y.traded} lev ${y.lev} prod ${y.prod} pitch ${y.pitch} ci ${y.ci} pop ${y.pop} ${JSON.stringify(y.styles)}`);
const fb = buys.filter((b) => b.firm);
console.log(`trades ${buys.length} (${(buys.length / (HZ / 12)).toFixed(1)}/yr)  firm buys ${fb.length}  off-market ${fb.filter((b) => b.off).length} (${(100 * fb.filter((b) => b.off).length / Math.max(1, fb.length)).toFixed(0)}% of firm buys; from private holders ${fb.filter((b) => b.off && !b.sellerFirm).length})  all off-market ${buys.filter((b) => b.off).length}`);
console.log(`office vacancy, year-end: max ${(Math.max(...years.map((y) => y.ovac)) * 100).toFixed(1)}%  years over 20%: ${years.filter((y) => y.ovac > 0.2).length}`);
console.log(`flats vacancy, year-end: max ${(Math.max(...years.map((y) => y.mvac)) * 100).toFixed(1)}%  years over 10%: ${years.filter((y) => y.mvac > 0.1).length}   unemployment max ${Math.max(...years.map((y) => y.u))}%  pop y50 ${years[49]?.pop} y100 ${years.at(-1).pop}`);
console.log(`office cap swing: ${g.econ.capRate.office}`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ starts, years }));
