// yearly office: vacancy, the landlords' clock M, lettings, seekers in the market, inflow
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 40), K = process.argv[5] ?? "office";
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
let acc = null; const rows = [];
const seen = new Set();
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const e = g.econ; const stk = e.stock?.[K] ?? 1; const v = e.cityVac?.[K] ?? 0;
  acc ??= { n: 0, v: 0, M: 0, L: 0, seek: 0, inflow: 0, rent: 0 };
  acc.n++; acc.v += v; acc.M += E.leaseUpMonthsOf(e, K, 0, 0, v, false);
  acc.L += 12 * E.grossLettingsMo(e, K) / stk;
  let sk = 0, inf = 0;
  for (const s of e.seekers ?? []) if (s.use === K) { sk += s.want ?? 0; const key = s.fid + ":" + s.since; if (!seen.has(key)) { seen.add(key); inf += s.want ?? 0; } }
  for (const s of e.seekers ?? []) if (s.use === K) { const b = (s.from ? "housed" : "unhoused") + "-" + s.why; acc.br ??= {}; acc.br[b] = (acc.br[b] ?? 0) + (s.want ?? 0) / stk; acc.age ??= {}; acc.age[b] = (acc.age[b] ?? 0) + (m - s.since) * (s.want ?? 0) / stk; }
  acc.seek += sk / stk; acc.inflow += 12 * inf / stk;
  acc.rent += (e.effRentIdx?.[K] ?? 0) / (e.cpi ?? 1);
  if (m % 12 === 0) { const n = acc.n; const brk = acc.br ?? {}, ag = acc.age ?? {}; rows.push({ y: m / 12, v: acc.v / n, M: acc.M / n, L: acc.L / n, seek: acc.seek / n, inflow: acc.inflow / n, rent: acc.rent / n }); acc = null;
    const r = rows.at(-1); console.log(`y${r.y} vac ${(100*r.v).toFixed(1)} M ${r.M.toFixed(1)} lettings ${(100*r.L).toFixed(1)}%/yr seekers ${(100*r.seek).toFixed(1)}% inflow ${(100*r.inflow).toFixed(1)}%/yr  V/inflow ${(12*r.v/Math.max(1e-6,r.inflow)).toFixed(1)}mo rent ${r.rent.toFixed(2)}`);
    if (r.y % 5 === 0) console.log("   pool by kind (% stock, mean age mo):", Object.entries(brk).map(([b, x]) => `${b} ${(100 * x / n).toFixed(1)} (${(ag[b] / Math.max(1e-9, x)).toFixed(0)})`).join(", ")); }
}
const reg = (X, Y) => { const n = X.length, mx = X.reduce((a,b)=>a+b,0)/n, my = Y.reduce((a,b)=>a+b,0)/n; let a=0,b=0; for (let i=0;i<n;i++){a+=(X[i]-mx)*(Y[i]-my);b+=(X[i]-mx)**2;} return a/b; };
const R = rows.filter(r => r.y >= 6);
console.log("dlnM/dvac(pt)", reg(R.map(r=>100*r.v), R.map(r=>Math.log(r.M))).toFixed(3),
  " dln(V/inflow)/dvac", reg(R.map(r=>100*r.v), R.map(r=>Math.log(r.v/Math.max(1e-6,r.inflow)))).toFixed(3),
  " dln lettings/dvac", reg(R.map(r=>100*r.v), R.map(r=>Math.log(r.L))).toFixed(3),
  " dln inflow/dvac", reg(R.map(r=>100*r.v), R.map(r=>Math.log(Math.max(1e-6,r.inflow)))).toFixed(3));
