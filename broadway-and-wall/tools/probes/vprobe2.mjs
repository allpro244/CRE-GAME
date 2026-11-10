// The same buildings valued by the appraiser and by the street's bidders, with the bidder's terms broken out
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = (process.argv[4] ?? "10,20,30").split(",").map(Number);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const med = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const q = (a, p) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(p * (b.length - 1))] : NaN; };
for (let m = 1; m <= Math.max(...YEARS) * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (m % 12 || !YEARS.includes(m / 12)) continue;
  const s = g, e = s.econ, rivals = (s.rivals ?? []).filter((r) => r.failedM === undefined);
  const byK = {};
  let i = 0;
  for (const li of s.listings ?? []) { const bbl = li.bbl;
    if (li.roll === undefined && li.occ === undefined) continue;
    const rec = E.resolveRec(city.parcels, s, bbl);
    if (!rec || rec.class === "land" || !(rec.bldgArea > 0) || s.holdings[bbl]) continue;
    const A = E.marketAppraisal(s, rec, bbl);
    if (!(A > 0)) continue;
    const v = E.dealView(s, rec, bbl, A);
    if (!v) continue;
    const Vs = rivals.map((r) => E.valueTo(e, v, E.bidderOf(s, r, rec)).V);
    const nb = { ...E.bidderOf(s, rivals[0], rec), misPp: 0, lean: 0, eqPrem: med(rivals.map((r) => E.bidderOf(s, r, rec).eqPrem)), builds: false };
    const uw = E.valueTo(e, v, nb);
    // the bidder's pieces, each as a share of the appraisal
    const cap = E.capRateFor(rec, e, v.cond, v.condIdx) / 100;
    const k = rec.class;
    (byK[k] ??= []).push({ lt: Math.log(Math.max(...Vs) / A), top: Math.max(...Vs) / A, med: med(Vs) / A, neu: uw.V / A,
      req: uw.r - uw.g + v.tau + v.cx + v.prod / 100 + v.locPrem / 100, cap, tau: v.tau, cx: v.cx, lc: v.leaseCap / Math.max(1, v.stabPre), cu: v.catchUp / A,
      gap: (v.noiPre - v.stabPre) / Math.max(1, v.stabPre), rE: uw.rE, rd: uw.rd, w: uw.w, g: uw.g, stabCap: v.stabPre / A });
  }
  { const all = Object.values(byK).flat(); console.log(`ALL n ${all.length} top/A p10 ${q(all.map(x=>x.top),.1)?.toFixed(2)} p50 ${med(all.map(x=>x.top))?.toFixed(2)} p90 ${q(all.map(x=>x.top),.9)?.toFixed(2)} median-bidder/A p50 ${med(all.map(x=>x.med))?.toFixed(2)} | median |log top/A| ${med(all.map(x=>Math.abs(x.lt)))?.toFixed(3)}`); }
  console.log(`--- seed ${SEED} year ${m / 12}  index ${e.indexRate?.toFixed(2)}`);
  for (const [k, a] of Object.entries(byK)) {
    const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
    const all = Object.values(byK).flat(); void all;
    console.log(`${k.padEnd(12)} n ${String(a.length).padStart(3)} | top/A p10 ${f(q(a.map(x=>x.top),.1))} p50 ${f(med(a.map(x=>x.top)))} p90 ${f(q(a.map(x=>x.top),.9))} | median bidder ${f(med(a.map(x=>x.med)))} | neutral ${f(med(a.map(x=>x.neu)))}`
      + ` || appraiser cap ${f(100*med(a.map(x=>x.cap)))} stabNOI/A ${f(100*med(a.map(x=>x.stabCap)))} | bidder r-g+loads ${f(100*med(a.map(x=>x.req)))} (rE ${f(100*med(a.map(x=>x.rE)))} rd ${f(100*med(a.map(x=>x.rd)))} w ${f(med(a.map(x=>x.w)))} g ${f(100*med(a.map(x=>x.g)))} tau ${f(100*med(a.map(x=>x.tau)))} cx ${f(100*med(a.map(x=>x.cx)))}) relet/NOI ${f(100*med(a.map(x=>x.lc)))}% catchUp/A ${f(100*med(a.map(x=>x.cu)))}% inPlace gap ${f(100*med(a.map(x=>x.gap)))}%`);
  }
}
