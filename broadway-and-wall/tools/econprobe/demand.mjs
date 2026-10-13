// DEMAND PROBE — what demand for each class of space is made of, and how it
// answers each of its arguments when that argument alone is moved.
//
//   SEEDS=4 node tools/econprobe/demand.mjs            (decomposition + shocks)
//   PART=decomp|shocks   APP=<other checkout>
//
// 1. DECOMPOSITION: over 50 years, the change in log demand target split into
//    the driver (jobs / households / shoppers), affordability (price),
//    income, the structural level (eras + swans) and the base.
// 2. SHOCKS: a world is forked at year 15 and ONE thing is moved in the
//    treatment — a class's rent, the town's population, real pay, the cost of
//    money. Occupied space and demand are compared with the control at
//    1, 3 and 10 years, and expressed as an elasticity where one applies.
import { join } from "node:path";
const APP = process.env.APP ?? new URL("../..", import.meta.url).pathname;
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const N = Number(process.env.SEEDS ?? 4), PART = process.env.PART ?? "all";
const K = ["office", "retail", "multifamily", "industrial"];
const ELASTIC = { office: 1.0, industrial: 0.9, retail: 0.7, multifamily: 0.75 };
const clone = (x) => JSON.parse(JSON.stringify(x));
const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "—";
const step = (g, P, bbls, adj) => { g = E.advanceQuarter(g, P, bbls, adj); if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; return g; };

function snap(e) {
  const o = {};
  for (const k of K) o[k] = {
    occ: e.occupied[k], stock: e.stock[k], vac: e.cityVac[k], rent: e.rentIdx[k], drv: e.classDrv?.[k] ?? 1,
    aff: e.affordEff[k], inc: e.incomeEff?.[k] ?? 1, sec: e.secular?.[k]?.idx ?? 1, base: e.baseStock?.[k] ?? e.stock[k],
    st: e.structTight?.[k] ?? 0, sublet: e.sublet?.[k] ?? 0,
  };
  o.pop = e.population; o.jobs = e.jobs; o.cpi = e.cpi; o.wage = e.wageIdx; o.idx = e.indexRate; o.u = e.unemployment;
  return o;
}

if (PART === "all" || PART === "decomp") {
  console.log("== 1. WHAT 50 YEARS OF DEMAND IS MADE OF (change in log target, by argument) ==");
  console.log("seed   class         total   driver  afford  income  struct  | occupied  vac0->vac50");
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i * 7919;
    const { parcels: P0, adjacency, bbls } = loadCity(i % 4, E.normalizeParcels);
    const P = clone(P0);
    let g = E.firstListings(E.newGame(seed, P), P, bbls);
    let a = null;
    for (let m = 0; m < 600; m++) { g = step(g, P, bbls, adjacency); if (m === 11) a = snap(g.econ); }
    const b = snap(g.econ);
    for (const k of K) {
      const A = a[k], B = b[k];
      const drv = ELASTIC[k] * Math.log((B.drv / B.sec) / (A.drv / A.sec));
      const aff = Math.log(B.aff / A.aff), inc = Math.log(B.inc / A.inc), sec = Math.log(B.sec / A.sec);
      const base = Math.log(B.base / A.base);
      const tot = drv + aff + inc + sec + base;
      console.log(`${seed} ${k.padEnd(12)} ${f(tot).padStart(6)}  ${f(drv).padStart(6)}  ${f(aff).padStart(6)}  ${f(inc).padStart(6)}  ${f(sec + base).padStart(6)}  | ${f(Math.log(B.occ / A.occ)).padStart(6)}   ${f(100 * A.vac, 1)}%->${f(100 * B.vac, 1)}%   (aff ${f(B.aff)} inc ${f(B.inc)} sec ${f(B.sec)})`);
    }
  }
}

if (PART === "all" || PART === "shocks") {
  console.log("\n== 2. ONE ARGUMENT MOVED AT YEAR 15 (treatment vs control, log points of occupied space) ==");
  const SHOCKS = {
    "rent +20% (that class only)": { per: true, apply: (g, k) => { g.econ.rentIdx[k] *= 1.2; g.econ.effRentIdx[k] *= 1.2; } },
    "population +10%": { apply: (g) => { const e = g.econ; e.population = Math.round(e.population * 1.1); if (e.ages) for (const a of ["kids", "work", "old"]) e.ages[a] *= 1.1; } },
    "real pay +10% (nominal wage)": { apply: (g) => { g.econ.wageIdx *= 1.1; } },
    "money +200bp (neutral rate)": { apply: (g) => { const n = g.econ.nat; n.neutralAnchor += 0.02; n.neutralReal += 0.02; } },
  };
  const H = [12, 36, 120];
  const acc = {};
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i * 7919;
    const { parcels: P0, adjacency, bbls } = loadCity(i % 4, E.normalizeParcels);
    const P = clone(P0);
    let g = E.firstListings(E.newGame(seed, P), P, bbls);
    for (let m = 0; m < 180; m++) g = step(g, P, bbls, adjacency);
    const g0 = clone(g), P1 = clone(P);
    // control path
    const ctrl = []; { let c = clone(g0), Pc = clone(P1); for (let m = 1; m <= 120; m++) { c = step(c, Pc, bbls, adjacency); if (H.includes(m)) ctrl.push(snap(c.econ)); } }
    for (const [name, sh] of Object.entries(SHOCKS)) {
      const targets = sh.per ? K : [null];
      for (const k0 of targets) {
        let t = clone(g0), Pt = clone(P1);
        sh.apply(t, k0);
        const rows = [];
        for (let m = 1; m <= 120; m++) { t = step(t, Pt, bbls, adjacency); if (H.includes(m)) rows.push(snap(t.econ)); }
        const key = sh.per ? `${name} :: ${k0}` : name;
        (acc[key] ??= []).push({ rows, ctrl, k0 });
      }
    }
    process.stderr.write(`seed ${seed} done\n`);
  }
  const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  for (const [key, runs] of Object.entries(acc)) {
    const k0 = runs[0].k0;
    const cls = k0 ? [k0] : K;
    for (const k of cls) {
      const cells = H.map((h, j) => {
        const dOcc = med(runs.map((r) => Math.log(r.rows[j][k].occ / r.ctrl[j][k].occ)));
        const dRent = med(runs.map((r) => Math.log(r.rows[j][k].rent / r.ctrl[j][k].rent)));
        const dVac = med(runs.map((r) => r.rows[j][k].vac - r.ctrl[j][k].vac));
        return `${h}m occ ${f(100 * dOcc, 1).padStart(5)}% rent ${f(100 * dRent, 1).padStart(6)}% vac ${f(100 * dVac, 1).padStart(5)}pp${k0 && Math.abs(dRent) > 0.005 ? ` ε=${f(dOcc / dRent)}` : ""}`;
      });
      console.log(`${key.padEnd(40)} ${k.padEnd(12)} ${cells.join(" | ")}`);
    }
  }
}
