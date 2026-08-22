// THE SHORTAGE-SIDE MIRROR OF `pnpm glut`, AND THE SPLIT `pnpm vacdist` NEVER DID.
//
//   pnpm engine && pnpm shortage
//   SEEDS=550991 YRS=20 DOSE=0.15 node test/shortage.mjs
//
// Glut dumps empty buildings and asks what happens to YOUR rent roll. This
// dumps jobs and asks whether SUPPLY can overshoot. A real growing city
// overbuilds: the pipeline underwrites the rent it expects at delivery, land
// answers a starved use, and frictional vacancy is the months a suite sits
// between tenants. This city does none of those three, so growth is a
// permanent shortage and decline is a glut — two states, not a market.
//
// Measured first on Claude Code (8 seeds × 60y, same set as vacdist) and
// written down so the next change has something to turn green:
//
//   office sits within 2pp of natural 5.5% of months
//   on the frictional floor 13.6%; more than 10pp over 44.9%
//   industrial pinned at its floor 55.9% of months, stock ×1.01 over 59 years
//
// Four causes, read from source on this tip — not coefficients:
//
//   1. Industrial land barely answers. The plat ships 0 M lots. zonePermits
//      now lets fringe C (demand < 45) take a shed (dev.ts), which is why the
//      floor-share fell from the 89% in GLUT_FINDINGS #2 — but tickZoning's
//      scarcity signal still reads office vacancy and office rent only
//      (zoning.ts). Stock that grows 1% in six decades is not a market.
//   2. The looking pool is capped by live stock (market.ts poolTarget =
//      min(targetRaw, housable + searchFringe)). New supply raises the cap
//      and fills the same month. Desired demand never stands in a queue
//      that a crane could overshoot.
//   3. cityVac is clamp(1 - occ/stock, friction, 0.45). Friction is a rail,
//      not residence time. A growing city rests on it and the shortage
//      escalator runs off the rail.
//   4. devPencils underwrites spot effRentIdx (value.ts). rentExp already
//      exists and the land residual already reads it; the start decision
//      does not. The order book decays 17/18 a month (market.ts), so a
//      pipeline cannot hold a boom long enough to overbuild it.
//
// Two measurements, one city, no player:
//
//   CENSUS     8 seeds × 60y. Split growing vs declining by jobs. This is
//              what vacdist reports as one pile, hiding that the two states
//              are two kinds of seed.
//   JOBS SHOCK at month PRE, clone. Treatment multiplies employIdx and jobs
//              by (1+dose) — the inverse of glut's addStock. Paired control
//              continues. Read vacancy, stock, starts, pool-fill at fixed
//              horizons. A market that can overshoot goes soft after the
//              pipeline delivers; this one stays on the floor and occupies
//              new stock the month it opens.
//
// A REPORT, NOT A GATE. The clauses print FAIL on the current engine. They
// stay red until land answers industrial, friction is residence time, and
// underwriting reads rentExp at delivery. Do not put this in `pnpm check`.
//
// THE RNG STREAM. Mutating employIdx/jobs does not draw. The two arms share
// a seed and a city and differ only in those two fields, so a century
// re-roll is not the experiment. Read at fixed horizons, same reason as glut.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,11,4242,91117,73303,22,33").split(",").map(Number);
const YRS = Number(process.env.YRS ?? 60);
const PRE = Number(process.env.PRE ?? 60);
const POST = Number(process.env.POST ?? 12) * 12;
const DOSE = Number(process.env.DOSE ?? 0.15);
const KLASS = process.env.CLASS ?? "office";
const SETTLE = 60; // skip the opening five years, same as vacdist

const CLASSES = ["office", "retail", "multifamily", "industrial"];
const NAT = E.NATURAL_VAC;

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const med = (xs) => {
  const a = [...xs].filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) / 2)] : NaN;
};
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "  —  ");
const x1 = (v) => (Number.isFinite(v) ? v.toFixed(2) + "x" : "  — ");
const cloneCity = () => JSON.parse(JSON.stringify(P0));

function floorOf(k) {
  return E.frictionFloor(k);
}

function snap(e) {
  const out = { jobs: e.jobs, employIdx: e.employIdx, cpi: e.cpi || 1 };
  for (const k of CLASSES) {
    const stock = e.stock?.[k] ?? 0;
    const occ = e.occupied?.[k] ?? 0;
    const pool = e.pool?.[k] ?? 0;
    const vac = e.cityVac?.[k] ?? NAT[k];
    const fl = floorOf(k);
    out[k] = {
      vac,
      stock,
      occ,
      pool,
      starts: e.starts?.[k] ?? 0,
      owed: e.startOwed?.[k] ?? 0,
      face: e.rentIdx?.[k] ?? 0,
      eff: e.effRentIdx?.[k] ?? e.rentIdx?.[k] ?? 0,
      exp: e.rentExp?.[k] ?? e.rentIdx?.[k] ?? 0,
      pinned: vac <= fl + 0.005,
      near: Math.abs(vac - NAT[k]) <= 0.02,
      flood: vac - NAT[k] > 0.10,
      fill: stock > 0 ? occ / stock : 0,
    };
  }
  return out;
}

function zoneCensus(parcels, g) {
  let m = 0, fringeC = 0, c = 0;
  for (const raw of Object.values(parcels)) {
    if (!raw) continue;
    const rec = g ? E.resolveRec(parcels, g, raw.bbl) ?? raw : raw;
    const z = rec.zoneDist ?? "";
    if (z.startsWith("M")) m++;
    else if (z.startsWith("C")) {
      c++;
      if ((rec.demandScore ?? 100) < 45) fringeC++;
    }
  }
  return { m, fringeC, c };
}

function walk(seed, months, shockAt, dose) {
  const parcels = cloneCity();
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const jobs0 = g.econ.jobs;
  const stock0 = Object.fromEntries(CLASSES.map((k) => [k, g.econ.stock[k]]));
  let zones = zoneCensus(parcels, g);
  const months_ = [];
  let starts = Object.fromEntries(CLASSES.map((k) => [k, 0]));
  let fillOnGrowth = [];
  for (let m = 0; m < months; m++) {
    if (m === shockAt && dose > 0) {
      // THE SHOCK. Inverse of glut's addStock: raise the jobs the demand
      // equation reads, without drawing the RNG. employIdx is desire;
      // e.jobs is the driver (market.ts jobIdx = jobs / jobs0). Both move
      // or the next tick's labour block writes one back over the other.
      g = {
        ...g,
        econ: {
          ...g.econ,
          employIdx: (g.econ.employIdx ?? 1) * (1 + dose),
          jobs: Math.round((g.econ.jobs ?? jobs0) * (1 + dose)),
        },
      };
    }
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const before = Object.fromEntries(CLASSES.map((k) => [k, g.econ.stock?.[k] ?? 0]));
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    const e = g.econ;
    const s = snap(e);
    s.m = m;
    months_.push(s);
    for (const k of CLASSES) {
      starts[k] += e.starts?.[k] ?? 0;
      const grew = (e.stock?.[k] ?? 0) - before[k];
      if (grew > 200) {
        // occ/stock the month new floor appears. Instant fill at 1-friction
        // is the pool-cap fingerprint: new supply raises the cap and occupies
        // it in the same tick.
        fillOnGrowth.push({ k, grew, fill: s[k].fill, vac: s[k].vac, fl: floorOf(k) });
      }
    }
  }
  const last = months_[months_.length - 1];
  const first = months_[Math.min(SETTLE, months_.length - 1)];
  zones = zoneCensus(parcels, g);
  return {
    seed,
    zones,
    jobs0,
    stock0,
    jobsEnd: last.jobs,
    jobsX: last.jobs / jobs0,
    growing: last.jobs / jobs0 > 1.05,
    declining: last.jobs / jobs0 < 0.95,
    stockX: Object.fromEntries(CLASSES.map((k) => [k, last[k].stock / Math.max(1, stock0[k])])),
    starts,
    months: months_,
    fillOnGrowth,
    first,
    last,
  };
}

function bagOf(runs, k, pred) {
  const xs = [];
  for (const r of runs) {
    for (const s of r.months) {
      if (s.m < SETTLE) continue;
      if (pred && !pred(r)) continue;
      xs.push(s[k]);
    }
  }
  return xs;
}

function share(xs, pred) {
  if (!xs.length) return NaN;
  return xs.filter(pred).length / xs.length;
}

function printCensus(runs, label, pred) {
  const n = pred ? runs.filter(pred).length : runs.length;
  console.log(`\n  ${label}  (${n} seed${n === 1 ? "" : "s"})`);
  if (!n) { console.log("    — none"); return; }
  console.log(`    class          natural      floor     near-nat      pinned      flooded     stock×     starts`);
  for (const k of CLASSES) {
    const rows = bagOf(runs, k, pred);
    const vacs = rows.map((x) => x.vac);
    const fl = floorOf(k);
    const near = share(rows, (x) => x.near);
    const pin = share(rows, (x) => x.pinned);
    const flood = share(rows, (x) => x.flood);
    const sx = med(runs.filter((r) => !pred || pred(r)).map((r) => r.stockX[k]));
    const st = med(runs.filter((r) => !pred || pred(r)).map((r) => r.starts[k]));
    console.log(
      `    ${k.padEnd(13)} ${pct(NAT[k]).padStart(7)}   ${pct(fl).padStart(7)}`
      + `   ${pct(near).padStart(9)}   ${pct(pin).padStart(9)}   ${pct(flood).padStart(9)}`
      + `   ${x1(sx).padStart(7)}   ${Math.round(st).toString().padStart(7)}`,
    );
    void vacs;
  }
}

// ---------------------------------------------------------------------------
console.log(`SHORTAGE MIRROR — ${SEEDS.length} seeds × ${YRS}y census, then a ${pct(DOSE)} jobs shock at month ${PRE}`);
console.log(`city zones on the reference plat: counting M / fringe-C / C after the first seed generates.\n`);

const census = [];
for (const seed of SEEDS) {
  const r = walk(seed, YRS * 12, -1, 0);
  census.push(r);
  const kind = r.growing ? "growing" : r.declining ? "declining" : "flat";
  console.log(
    `  seed ${seed}: jobs ${x1(r.jobsX)}  ${kind}`
    + `   office stock ${x1(r.stockX.office)}  vac ${pct(r.last.office.vac)}`
    + `   industrial stock ${x1(r.stockX.industrial)}  vac ${pct(r.last.industrial.vac)}`
    + `   M lots ${r.zones.m}  fringe C ${r.zones.fringeC}`,
  );
}

printCensus(census, "ALL SEEDS", null);
printCensus(census, "GROWING (jobs × > 1.05)", (r) => r.growing);
printCensus(census, "DECLINING (jobs × < 0.95)", (r) => r.declining);

const officeAll = bagOf(census, "office");
const indAll = bagOf(census, "industrial");
const growN = census.filter((r) => r.growing).length;
const dropN = census.filter((r) => r.declining).length;
const officeGrow = bagOf(census, "office", (r) => r.growing);
const officeDrop = bagOf(census, "office", (r) => r.declining);
const indX = med(census.map((r) => r.stockX.industrial));
const mLots = med(census.map((r) => r.zones.m));
const fringe = med(census.map((r) => r.zones.fringeC));

const fillOffice = census.flatMap((r) => r.fillOnGrowth.filter((x) => x.k === "office"));
const fillOnFloor = share(fillOffice, (x) => x.vac <= x.fl + 0.01);

console.log(`\n  FINGERPRINTS`);
console.log(`    M-zoned lots on the plat: ${mLots.toFixed(0)}    fringe-C lots that may take a shed: ${fringe.toFixed(0)}`);
console.log(`    industrial stock over ${YRS}y: ${x1(indX)}   (a market that can build sheds is not ×1.00)`);
console.log(`    office months within 2pp of natural: ${pct(share(officeAll, (x) => x.near))}   on floor: ${pct(share(officeAll, (x) => x.pinned))}   >10pp over: ${pct(share(officeAll, (x) => x.flood))}`);
console.log(`    industrial months on floor: ${pct(share(indAll, (x) => x.pinned))}`);
console.log(`    growing seeds ${growN} / declining ${dropN} / ${SEEDS.length}`);
if (officeGrow.length) {
  console.log(`    office, GROWING seeds only: near-nat ${pct(share(officeGrow, (x) => x.near))}   floor ${pct(share(officeGrow, (x) => x.pinned))}   flood ${pct(share(officeGrow, (x) => x.flood))}`);
}
if (officeDrop.length) {
  console.log(`    office, DECLINING seeds only: near-nat ${pct(share(officeDrop, (x) => x.near))}   floor ${pct(share(officeDrop, (x) => x.pinned))}   flood ${pct(share(officeDrop, (x) => x.flood))}`);
}
if (fillOffice.length) {
  console.log(`    months new office floor opened already at the friction fill: ${pct(fillOnFloor)}   (n=${fillOffice.length})`);
  console.log(`    median occ/stock the month office stock grew: ${pct(med(fillOffice.map((x) => x.fill)))}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(78)}`);
console.log(`JOBS SHOCK — ${pct(DOSE)} of headcount at month ${PRE}, watched ${POST / 12}y, paired control\n`);

const pairs = [];
for (const seed of SEEDS) {
  const t = walk(seed, PRE + POST, PRE, DOSE);
  const c = walk(seed, PRE + POST, -1, 0);
  pairs.push({ seed, t, c });
}

const at = (run, m) => run.months.find((s) => s.m === m);
const MARKS = [PRE, PRE + 12, PRE + 36, PRE + 60, PRE + POST - 1].filter((m) => m < PRE + POST);

console.log(`  month      vac T/C          stock T/C         starts T-C      face T/C         fill T/C`);
for (const m of MARKS) {
  const rel = m - PRE;
  const tv = med(pairs.map((p) => at(p.t, m)?.[KLASS].vac));
  const cv = med(pairs.map((p) => at(p.c, m)?.[KLASS].vac));
  const ts = med(pairs.map((p) => at(p.t, m)?.[KLASS].stock));
  const cs = med(pairs.map((p) => at(p.c, m)?.[KLASS].stock));
  const startGap = med(pairs.map((p) => {
    const sum = (run, a, b) => run.months.filter((s) => s.m > a && s.m <= b).reduce((n, s) => n + s[KLASS].starts, 0);
    return sum(p.t, PRE, m) - sum(p.c, PRE, m);
  }));
  const tf = med(pairs.map((p) => at(p.t, m)?.[KLASS].face));
  const cf = med(pairs.map((p) => at(p.c, m)?.[KLASS].face));
  const tfill = med(pairs.map((p) => at(p.t, m)?.[KLASS].fill));
  const cfill = med(pairs.map((p) => at(p.c, m)?.[KLASS].fill));
  console.log(
    `  ${String(rel).padStart(4)}     ${pct(tv).padStart(6)}/${pct(cv).padStart(6)}`
    + `   ${(ts / 1e6).toFixed(2)}M/${(cs / 1e6).toFixed(2)}M`
    + `   ${Math.round(startGap).toString().padStart(10)}`
    + `   ${pct(tf / Math.max(1e-9, cf) - 1).padStart(8)}`
    + `   ${pct(tfill).padStart(6)}/${pct(cfill).padStart(6)}`,
  );
}

const m36 = PRE + 36;
const vacT36 = med(pairs.map((p) => at(p.t, m36)?.[KLASS].vac));
const vacC36 = med(pairs.map((p) => at(p.c, m36)?.[KLASS].vac));
const stockT36 = med(pairs.map((p) => at(p.t, m36)?.[KLASS].stock));
const stockC36 = med(pairs.map((p) => at(p.c, m36)?.[KLASS].stock));
const fillT36 = med(pairs.map((p) => at(p.t, m36)?.[KLASS].fill));
const pinT = share(pairs.flatMap((p) => p.t.months.filter((s) => s.m >= PRE).map((s) => s[KLASS])), (x) => x.pinned);
const overshoot = share(pairs.flatMap((p) => p.t.months.filter((s) => s.m >= PRE + 24).map((s) => s[KLASS])), (x) => x.vac > NAT[KLASS] + 0.01);

console.log(`\n  A market that can overshoot goes soft after the pipeline delivers a jobs boom.`);
console.log(`  This one, month 36 after a ${pct(DOSE)} jobs shock:`);
console.log(`    vacancy  treatment ${pct(vacT36)}   control ${pct(vacC36)}   natural ${pct(NAT[KLASS])}`);
console.log(`    stock    treatment ${(stockT36 / 1e6).toFixed(2)}M   control ${(stockC36 / 1e6).toFixed(2)}M   extra ${pct(stockT36 / Math.max(1, stockC36) - 1)}`);
console.log(`    occ/stock treatment ${pct(fillT36)}   (friction fill is ${pct(1 - floorOf(KLASS))})`);
console.log(`    months on the floor after the shock: ${pct(pinT)}`);
console.log(`    months vacancy above natural from year 3 on: ${pct(overshoot)}`);

// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(78)}`);
console.log(`CLAUSES — what a market would do. FAIL is the current engine. Not a gate.\n`);

let fail = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) fail++;
};

const officeNear = share(officeAll, (x) => x.near);
const officePin = share(officeAll, (x) => x.pinned);
const officeFlood = share(officeAll, (x) => x.flood);
const indPin = share(indAll, (x) => x.pinned);
const growPin = officeGrow.length ? share(officeGrow, (x) => x.pinned) : NaN;
const dropFlood = officeDrop.length ? share(officeDrop, (x) => x.flood) : NaN;

// A metro office market spends most of its life near natural. Two states
// (floor or flood, split by whether the seed grew) is the finding.
check(officeNear >= 0.25, `office within 2pp of natural ≥25% of months (got ${pct(officeNear)})`);
check(!(growN && dropN && growPin > 0.20 && dropFlood > 0.20),
  `growing seeds must not live on the floor while declining seeds live in glut`
  + ` (grow-pin ${pct(growPin)}, decline-flood ${pct(dropFlood)})`);
check(indPin < 0.25, `industrial on its friction floor <25% of months (got ${pct(indPin)})`);
check(indX >= 1.15, `industrial stock grows ≥15% over ${YRS}y when demand can pay for sheds (got ${x1(indX)})`);
check(mLots > 0 || fringe > 50, `the plat has M-land or enough fringe C to host a logistics wave (M=${mLots.toFixed(0)}, fringe C=${fringe.toFixed(0)})`);
check(overshoot >= 0.15, `after a jobs boom, vacancy spends ≥15% of later months above natural — supply overshot (got ${pct(overshoot)})`);
check(fillOnFloor < 0.50, `new office floor is not already at the friction fill the month it opens (got ${pct(fillOnFloor)})`);

console.log(`\n  ${fail} clause${fail === 1 ? "" : "s"} red. A REPORT, NOT A GATE — exit 0.`);
console.log(`  Next mechanisms, in this order, are what turn them green:`);
console.log(`    2. land answers industrial shortage (zonePermits residual / tickZoning reads industrial)`);
console.log(`    3. frictional vacancy as residence time, not a clamp`);
console.log(`    4. starts underwrite rentExp at delivery, not spot effRentIdx`);
console.log(`  See SHORTAGE_FINDINGS_2026-08.md. Do not retune a coefficient to silence a clause.`);
process.exit(0);
