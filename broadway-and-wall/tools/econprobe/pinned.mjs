// Pinned-market probe: in months a class sits on its frictional floor, what
// is the order desk seeing, and what blocks starts? SEEDS, OFF, HZ.
import { join } from "node:path";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const N = Number(process.env.SEEDS ?? 2), HZ = Number(process.env.HZ ?? 600), OFF = Number(process.env.OFF ?? 0);
const K = ["office", "retail", "multifamily", "industrial"];
const acc = {}; for (const k of K) acc[k] = { n: 0, pin: 0, pinZero: 0, siteZero: 0, devLow: 0, cred: 0, rentG: [], st: [], dev: [], site: [], hur: [], starts: [], allStarts: [], allZero: 0 };
for (let i = OFF; i < OFF + N; i++) {
  const seed = 1000 + i * 7919;
  const { parcels: P0, adjacency, bbls } = loadCity(i % 4, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const hist = [];
  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    hist.push({ rent: { ...e.rentIdx }, cpi: e.cpi, stock: { ...e.stock } });
    if (m < 24) continue;
    for (const k of K) {
      const a = acc[k]; a.n++;
      const floor = E.residenceVac(e, k);
      const pinned = e.cityVac[k] <= floor + 0.003;
      const h12 = hist[hist.length - 13];
      const realG = (e.rentIdx[k] / h12.rent[k]) / (e.cpi / h12.cpi) - 1;
      const stockAdd = e.stock[k] - hist[hist.length - 2].stock[k];
      a.allStarts.push(e.starts[k] ?? 0);
      if (!pinned) continue;
      a.pin++;
      const dev = E.devPencils(e, k), site = e.sitePencil?.[k] ?? 0, cr = e.creditIdx;
      a.rentG.push(realG); a.st.push(e.structTight?.[k] ?? 0); a.dev.push(dev); a.site.push(site); a.hur.push(e.siteHurdle?.[k] ?? NaN);
      a.starts.push((e.starts[k] ?? 0) / e.stock[k] * 12);
      if (!(e.starts[k] > 0)) { a.pinZero++; if (!(site > 0)) a.siteZero++; else if (dev < 0.3) a.devLow++; else if (cr < 0.7) a.cred++; }
    }
  }
  process.stderr.write(`seed ${seed} done\n`);
}
const q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
for (const k of K) {
  const a = acc[k];
  console.log(`${k.padEnd(12)} pinned ${(100 * a.pin / a.n).toFixed(1)}% | in pinned months: zero starts ${(100 * a.pinZero / Math.max(1, a.pin)).toFixed(0)}% (sitePencil 0: ${a.siteZero}, devPencils<0.3: ${a.devLow}, credit<0.7: ${a.cred}) | starts p50 ${(100 * q(a.starts, .5)).toFixed(2)}%/yr of stock | real rent g p50 ${(100 * q(a.rentG, .5)).toFixed(1)}%/yr | structTight p50 ${q(a.st, .5).toFixed(3)} p90 ${q(a.st, .9).toFixed(3)} | devPencils p50 ${q(a.dev, .5).toFixed(2)} | sitePencil p50 ${q(a.site, .5).toFixed(2)} | siteHurdle p50 ${q(a.hur, .5).toFixed(2)} p90 ${q(a.hur, .9).toFixed(2)} | all months zero-start ${(100 * a.allStarts.filter((x) => !(x > 0)).length / a.allStarts.length).toFixed(0)}%`);
}
