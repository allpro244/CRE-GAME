// PLAYTEST HARNESS — ECONOMY OBSERVER (throwaway, research only)
//
// Runs a 100-year city with NO player activity and harvests the engine's own
// monthly panel (`econ.history`, one row per month) plus a fixed-cohort land
// value sample. The point is to read the economy on its own terms: rivals and
// city growth still build, trade and fail, so the world is live — there is
// just no player hand on it. Player-side effects are measured separately by
// tools/pt-strat.mjs, which harvests the same panel so the two can be diffed.
//
//   node tools/pt-econ.mjs '{"citySeed":1,"marketSeed":2,"size":"city"}'
//
// Writes JSON to stdout. Driver: tools/pt-drive.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const E = await import(join(ROOT, "test/.engine.mjs"));
const { makeCity, cityName, PROCEDURAL } = await import(join(ROOT, "src/citygen/index.mjs"));

const cfg = JSON.parse(process.argv[2]);
const MONTHS = cfg.months ?? 1200; // 100 years
const CLASSES = ["office", "retail", "multifamily", "industrial"];

const built = makeCity(PROCEDURAL, cfg.citySeed, { size: cfg.size });
E.normalizeParcels(built.parcels);
const parcels = built.parcels;
const adjacency = built.adjacency;
const bbls = Object.keys(parcels);

let g = E.firstListings(E.newGame(cfg.marketSeed, parcels, 5_000_000), parcels, bbls);
g.citySize = cfg.size;
g.citySeed = cfg.citySeed;

// FIXED COHORT for land-value dispersion. Chosen once, before the run, and
// never re-selected — a cohort re-picked each decade would report composition
// change (new parcels entering the sample) as dispersion change. Every parcel
// that is dirt-capable at t=0 is in, and stays in for the century.
const landCohort = bbls.filter((b) => {
  const p = parcels[b];
  return p && p.lotArea > 0;
});

let resurrections = 0;
const landSnaps = [];
const rivalFailM = [];
let rivalsAtStart = 0;

for (let m = 0; m < MONTHS; m++) {
  const deadBefore = (g.rivals ?? []).filter((r) => r.failedM !== undefined).length;
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (m === 0) rivalsAtStart = (g.rivals ?? []).length;
  const deadAfter = (g.rivals ?? []).filter((r) => r.failedM !== undefined).length;
  if (deadAfter > deadBefore) {
    for (const r of g.rivals ?? []) {
      if (r.failedM !== undefined && !rivalFailM.some((x) => x.name === r.name)) {
        rivalFailM.push({ name: r.name, style: r.style, m: r.failedM });
      }
    }
  }
  // A passive observer still pays G&A, so it can go insolvent. Resurrecting
  // keeps the WORLD advancing; without it advanceMonth returns state unchanged
  // and every later month is a copy of the month it died in.
  if (g.gameOver) { g = { ...g, gameOver: null, cash: 6e6 }; resurrections++; }

  // Land dispersion on the fixed cohort, every 5 years.
  if (m % 60 === 59) {
    const vals = [];
    for (const b of landCohort) {
      const rec = E.resolveRec(parcels, g, b) ?? parcels[b];
      if (!rec) continue;
      const v = E.landValue(rec, g.econ);
      if (Number.isFinite(v) && v > 0) vals.push(v / Math.max(1, rec.lotArea));
    }
    vals.sort((a, b) => a - b);
    const q = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0;
    landSnaps.push({
      m, n: vals.length,
      p10: q(0.10), p50: q(0.50), p90: q(0.90), p99: q(0.99),
      mean: vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length),
      cpi: g.econ.cpi,
    });
  }
}

// The engine's own monthly panel. Trimmed to the fields this playtest reads so
// the JSON stays small enough to hold 20 runs in memory at once.
const hist = (g.econ.history ?? []).map((h) => ({
  q: h.q,
  rate: h.indexRate, regime: h.rateRegime,
  land: h.landIdx, cost: h.costIdx, cpi: h.cpi,
  cyc: h.cycleDev, credit: h.creditIdx, emp: h.employIdx,
  pop: h.population, jobs: h.jobs, unemp: h.unemployment,
  wage: h.wageIdx, out: h.outputIdx, infl: h.inflExp,
  vac: h.vac, rent: h.rent, effRent: h.effRent, cap: h.cap,
  abs: h.abs, comp: h.comp,
}));

process.stdout.write(JSON.stringify({
  kind: "econ",
  cfg: { ...cfg, cityName: cityName(PROCEDURAL, cfg.citySeed), lots: bbls.length },
  months: MONTHS,
  resurrections,
  rivalsAtStart,
  rivalFails: rivalFailM,
  rivalsAlive: (g.rivals ?? []).filter((r) => r.failedM === undefined).length,
  landSnaps,
  hist,
  finalStock: g.econ.stock,
  built: g.built ?? 0,
  demolished: g.demolished ?? 0,
  cityBuilt: g.cityBuilt ?? 0,
}));
