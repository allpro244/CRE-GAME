// THE PROOF SUITE (ONE_ECONOMY_PLAN.md §6c-F). A REPORT, NOT A GATE.
//
//   SEEDS=11,22,33,44,55,66 YEARS=100 OUT=/some/dir node tools/proof.mjs
//   node tools/proof.mjs --report /some/dir        (re-read saved runs, print the table)
//
// The whole economy, with no player, for a century per seed: firms with books,
// the household register, the banks, City Hall, the tenant and property
// markets, land, contractors and the national swans. Sampled once a year
// (monthly where a yearly sample would miss the event: construction starts,
// national recessions, bank failures, charge-offs, firms going dark). Each
// reading is set against a band read off the historical record, and graded:
//
//   PASS   the seeds' typical reading sits inside the band, and most years do
//   WATCH  the typical reading is inside but the years stray, or it sits just outside
//   FAIL   the typical reading is well outside the band
//
// Nothing here fails the build. A band is a reading of history, not a target:
// never tune a coefficient until a row turns green (CLAUDE.md).
//
// Probe rules kept (CLAUDE.md): the bundle must be fresh; the world is
// resurrected on gameOver (no player — an un-resurrected run freezes and every
// later month copies the month it died in); every series is read off the same
// city each year (a constant cohort of seeds — no seed is dropped mid-run).
//
// Each seed's yearly readings are written to OUT/seed-<n>.json as soon as the
// seed finishes, so a long run can be read before it ends and re-reported.
import { assertFreshBundle } from "../test/fresh.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const HERE = dirname(fileURLToPath(import.meta.url));

const CLASSES = ["office", "retail", "industrial", "multifamily"];
const COMM = ["office", "retail", "industrial"];
const mean = (a) => { const b = a.filter(Number.isFinite); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : NaN; };
const q = (a, p) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
const median = (a) => q(a, 0.5);
const sd = (a) => { const m = mean(a); const b = a.filter(Number.isFinite); return b.length > 1 ? Math.sqrt(b.reduce((s, x) => s + (x - m) ** 2, 0) / (b.length - 1)) : NaN; };
const growth = (a, b, n) => (a > 0 && b > 0 && n > 0) ? Math.pow(b / a, 1 / n) - 1 : NaN;

// ---------------------------------------------------------------- the ledger
/** Open rows in FORMULA_LEDGER.md: the aggregates still set from the top. */
function formulaLedger() {
  const txt = readFileSync(join(HERE, "..", "FORMULA_LEDGER.md"), "utf8");
  const open = txt.split(/^## Open\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const rows = open.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
  return { open: rows.length, ids: rows.map((l) => Number(l.split("|")[1])) };
}

// ---------------------------------------------------------------- the run
async function run(SEEDS, YEARS, OUT) {
  assertFreshBundle();
  const E = await import(pathToFileURL(join(HERE, "..", "test", ".engine.mjs")).href);
  const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);
  mkdirSync(OUT, { recursive: true });

  // A non-finite anywhere in the econ's scalars, three levels down (the big
  // per-building tables are skipped: their fields are read by the rest).
  const SKIP = new Set(["streetRolls", "flatRolls", "heldFlats", "heldTenants", "comps", "deals", "streetFailed", "seekers", "history", "demandAt", "deskPx", "capRead", "locSeen", "landQueue", "landQueuePrev", "streetSpace", "bands", "bandStamp", "gov", "eco", "eco0", "firmBooks", "tierCtx"]);
  const nonFinite = (o, path, out, d = 0) => {
    if (!o || typeof o !== "object" || d > 3) return;
    for (const [k, v] of Object.entries(o)) {
      if (d === 0 && SKIP.has(k)) continue;
      if (typeof v === "number" && !Number.isFinite(v)) out.push(path + k);
      else if (v && typeof v === "object" && !ArrayBuffer.isView(v)) nonFinite(v, path + k + ".", out, d + 1);
    }
  };
  // The scalars a frozen world would hold still for a whole year.
  const pulse = (g) => [g.econ.jobs, g.econ.population, g.econ.cpi, g.econ.indexRate, g.econ.landMkt, ...CLASSES.map((k) => g.econ.effRentIdx?.[k] ?? g.econ.rentIdx[k])].map((x) => Number(x).toPrecision(10)).join("|");

  for (const seed of SEEDS) {
    const city = makeCity("somewhere", 1);
    E.normalizeParcels(city.parcels);
    const bbls = Object.keys(city.parcels);
    let g = E.firstListings(E.newGame(seed, city.parcels), city.parcels, bbls);
    const t0 = Date.now();
    const yr = [];
    let starts = Object.fromEntries(CLASSES.map((k) => [k, 0]));
    let recStarts = 0, recMonths = 0, dark = 0, left = 0, failures = 0, resurrect = 0;
    let prevRec = (g.econ.nat?.recM ?? 0) > 0;
    const failedSeen = new Set((g.lenders ?? []).filter((l) => l.failedM !== undefined).map((l) => l.name));
    let coPrev = Object.fromEntries((g.lenders ?? []).map((l) => [l.name, l.chargeOffsTotal ?? 0]));
    let chargeOffs = 0;
    let fidsPrev = null, pulsePrev = null, frozenYrs = 0;
    const nanPaths = new Set();
    const why = {};
    for (let m = 1; m <= YEARS * 12; m++) {
      g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
      if (g.gameOver) { g = { ...g, gameOver: null, cash: 6e6 }; resurrect++; }
      const e = g.econ;
      for (const k of CLASSES) starts[k] += e.starts?.[k] ?? 0;
      const inRec = (e.nat?.recM ?? 0) > 0;
      if (inRec && !prevRec) recStarts++;
      if (inRec) recMonths++;
      prevRec = inRec;
      for (const f of e.streetFailed ?? []) if (f.m === g.month) { if (f.why === "left") left++; else dark++; }
      for (const l of g.lenders ?? []) {
        if (l.failedM !== undefined && !failedSeen.has(l.name)) { failedSeen.add(l.name); failures++; }
        if (l.failedM === undefined && failedSeen.has(l.name) && l.reopenM !== undefined) failedSeen.delete(l.name);
        const c = l.chargeOffsTotal ?? 0;
        chargeOffs += Math.max(0, c - (coPrev[l.name] ?? 0));
        coPrev[l.name] = c;
      }
      if (m % 12 !== 0) continue;

      // ---- the year's reading
      const y = m / 12;
      const hs = E.householdStats(g);
      const fids = new Set();
      for (const r of Object.values(e.streetRolls ?? {})) for (const t of r.t ?? []) if (t.fid !== undefined) fids.add(t.fid);
      for (const sk of e.seekers ?? []) if (sk.fid !== undefined) fids.add(sk.fid);
      let entry = NaN, exit = NaN;
      if (fidsPrev) {
        let inn = 0, out = 0;
        for (const f of fids) if (!fidsPrev.has(f)) inn++;
        for (const f of fidsPrev) if (!fids.has(f)) out++;
        entry = inn / Math.max(1, fidsPrev.size); exit = out / Math.max(1, fidsPrev.size);
      }
      const book = (g.lenders ?? []).reduce((s, l) => s + (l.anonBook ?? 0) + (l.namedBook ?? 0), 0);
      const nan = []; nonFinite(e, "econ.", nan);
      for (const p of nan) nanPaths.add(p);
      const pz = pulse(g);
      if (pz === pulsePrev) frozenYrs++;
      const cpi = e.cpi ?? 1;
      yr.push({
        y, jobs: e.jobs, u: e.unemployment, natU: e.nat?.unemp, pop: e.population,
        realPayRel: E.realPayRel(e), wageIdx: e.wageIdx, natWageIdx: e.natWageIdx,
        cpi, natCpi: e.natCpi, policy: e.nat?.policy, tenY: e.indexRate,
        vac: Object.fromEntries(CLASSES.map((k) => [k, e.cityVac?.[k]])),
        rentR: Object.fromEntries(CLASSES.map((k) => [k, (e.effRentIdx?.[k] ?? e.rentIdx[k]) / cpi])),
        cap: Object.fromEntries(CLASSES.map((k) => [k, e.capRate?.[k]])),
        capDeal: Object.fromEntries(CLASSES.map((k) => [k, e.capRead?.[k]?.win ? e.capRead[k].med : null])),
        capTrades: Object.fromEntries(CLASSES.map((k) => [k, e.capRead?.[k]?.trades ?? 0])),
        landR: (e.landMkt ?? NaN) / cpi, landIdx: e.landIdx,
        starts: { ...starts }, stock: { ...e.stock }, absorb12: { ...e.absorb12 }, completions12: { ...e.completions12 },
        recStarts, recMonths, failures, chargeOffs, book,
        hh: hs?.households, owners: hs?.owners, doubled: hs?.doubledUp, islandRenters: hs?.islandRenters, mainlandRenters: hs?.mainlandRenters,
        firms: fids.size, entry, exit, dark, left,
        nan: nan.length, frozen: pz === pulsePrev ? 1 : 0, resurrect,
      });
      // The cause ledger's account of each moving number, once a decade.
      if (y % 10 === 0 || y === YEARS) {
        const keys = Object.keys(g.why?.key ?? {}).filter((k) => k.startsWith("@"));
        why[y] = Object.fromEntries(keys.filter((k) => /^@(rent|vac|land|wage|rate|town|city|nation|cost|tax|trade|industry|exports)/.test(k)).slice(0, 40)
          .map((k) => [k.slice(1), E.whyChain(g, E.whyAt ? E.whyAt(g, k.slice(1)) : g.why.key[k], 4).map((ev) => `${ev.k}@${ev.m}: ${ev.t}`)]));
      }
      starts = Object.fromEntries(CLASSES.map((k) => [k, 0]));
      recStarts = 0; recMonths = 0; dark = 0; left = 0; failures = 0; chargeOffs = 0; resurrect = 0;
      fidsPrev = fids; pulsePrev = pz;
      if (y % 10 === 0) console.error(`  seed ${seed} year ${y}  jobs ${Math.round(e.jobs)}  u ${(100 * e.unemployment).toFixed(1)}%  ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
    const secs = (Date.now() - t0) / 1000;
    writeFileSync(join(OUT, `seed-${seed}.json`), JSON.stringify({ seed, years: YEARS, secs, nanPaths: [...nanPaths], frozenYrs, why, yr }));
    console.error(`seed ${seed}: ${YEARS} years in ${(secs / 60).toFixed(1)} min`);
  }
}

// ---------------------------------------------------------------- the bands
// Each check reads every seed's yearly series and returns { val, lo, hi, inShare }:
// the typical value (median across seeds of the seed's statistic), the band,
// and the share of years (or seeds) inside it.
const pc = (x, d = 1) => Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "—";
const pp = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) + "pp" : "—";
const nm = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "—";

/** yearly level band: share of all seed-years inside, median of seeds' medians */
function levelCheck(runs, get, lo, hi) {
  const per = runs.map((r) => r.yr.map(get).filter(Number.isFinite));
  const all = per.flat();
  const inShare = all.length ? all.filter((x) => x >= lo && x <= hi).length / all.length : NaN;
  const meds = per.map(median);
  return { val: median(meds), p10: q(all, 0.1), p90: q(all, 0.9), seedVals: meds, lo, hi, inShare };
}
/** a per-seed statistic against a band */
function seedCheck(runs, stat, lo, hi) {
  const v = runs.map(stat).filter(Number.isFinite);
  return { val: median(v), p10: Math.min(...v), p90: Math.max(...v), seedVals: v, lo, hi, inShare: v.length ? v.filter((x) => x >= lo && x <= hi).length / v.length : NaN };
}
function grade(c) {
  if (!Number.isFinite(c.val)) return "FAIL";
  const w = c.hi - c.lo;
  const inside = c.val >= c.lo && c.val <= c.hi;
  if (inside && c.inShare >= 0.75) return "PASS";
  if (inside || (c.val >= c.lo - 0.25 * w && c.val <= c.hi + 0.25 * w)) return "WATCH";
  return "FAIL";
}

/** lag (years) at which yearly starts correlate best with yearly demand (jobs growth): + = starts follow demand */
function leadLag(xs, ys, maxLag = 5) {
  let best = { lag: NaN, r: -Infinity };
  for (let L = -maxLag; L <= maxLag; L++) {
    const a = [], b = [];
    for (let i = 0; i < xs.length; i++) { const j = i + L; if (j >= 0 && j < ys.length && Number.isFinite(xs[i]) && Number.isFinite(ys[j])) { a.push(xs[i]); b.push(ys[j]); } }
    if (a.length < 10) continue;
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    const r = sab / Math.sqrt(saa * sbb || 1);
    if (r > best.r) best = { lag: L, r };
  }
  return best;
}
const diff = (a) => a.map((x, i) => i ? x - a[i - 1] : NaN);
const lgr = (a) => a.map((x, i) => (i && a[i - 1] > 0 && x > 0) ? Math.log(x / a[i - 1]) : NaN);
const trendG = (a) => { // log-linear trend growth a year
  const p = a.map((x, i) => [i, Math.log(x)]).filter(([, v]) => Number.isFinite(v));
  if (p.length < 5) return NaN;
  const mx = mean(p.map((z) => z[0])), my = mean(p.map((z) => z[1]));
  let sxy = 0, sxx = 0; for (const [x, v] of p) { sxy += (x - mx) * (v - my); sxx += (x - mx) ** 2; }
  return Math.exp(sxy / sxx) - 1;
};
const burn = (r) => r.yr.filter((x) => x.y > 5);   // the opening five years are the start's settling, not the economy

function checks(runs) {
  const R = runs.map((r) => ({ ...r, yr: burn(r) }));
  const rows = [];
  const add = (group, name, c, fmt, src) => rows.push({ group, name, ...c, grade: c.grade ?? grade(c), fmt, src });

  add("Labour", "Unemployment rate (yearly)", levelCheck(R, (x) => x.u, 0.03, 0.11), pc,
    "BLS CPS 1948-2024: 2.5-10.8%; metro rates rarely outside 3-11%");
  add("Labour", "Unemployment, century mean", seedCheck(R, (r) => mean(r.yr.map((x) => x.u)), 0.045, 0.07), pc,
    "BLS 1948-2024 mean 5.7%");
  add("Labour", "Job growth, trend %/yr", seedCheck(R, (r) => trendG(r.yr.map((x) => x.jobs)), 0.0, 0.02), pc,
    "BLS CES metro payrolls 1990-2024: most large metros 0-2%/yr (plan gate: 0.5-1.5%)");
  add("Labour", "Job growth acceleration (last 30 yrs minus first 30, pp/yr)", seedCheck(R, (r) => {
    const j = r.yr.map((x) => x.jobs), n = Math.min(30, Math.floor(j.length / 3));
    return trendG(j.slice(-n)) - trendG(j.slice(0, n));
  }, -0.01, 0.01), pc, "metros mature: growth slows as a place fills and grows dear (Glaeser-Gyourko 2005); a century that speeds up is compounding");
  add("Labour", "Population growth, trend %/yr", seedCheck(R, (r) => trendG(r.yr.map((x) => x.pop)), -0.005, 0.02), pc,
    "Census metro population 1950-2020: -0.5 to +2%/yr for established cities");
  add("Labour", "Real pay vs nation (local/national, CPI-adjusted)", levelCheck(R, (x) => x.realPayRel, 0.85, 1.3), nm,
    "BEA RPP-adjusted per-capita income, MSAs 2008-2022: ~0.85-1.3 of US");
  add("Labour", "Real pay vs nation, drift %/yr", seedCheck(R, (r) => trendG(r.yr.map((x) => x.realPayRel)), -0.005, 0.005), pc,
    "metro pay premia persist for decades (Moretti 2012): drift within ±0.5%/yr");

  add("Prices", "CPI inflation, century mean %/yr", seedCheck(R, (r) => growth(r.yr[0].cpi, r.yr.at(-1).cpi, r.yr.length - 1), 0.015, 0.04), pc,
    "BLS CPI-U 1925-2024 ~3.0%/yr; post-1983 2.8%");
  add("Prices", "CPI inflation, yearly range", levelCheck(R, (x, i) => x._infl, -0.02, 0.10), pc,
    "BLS CPI-U Dec/Dec 1948-2024: -1% (1949) to 13.3% (1979)");
  add("Prices", "Local CPI vs national, drift %/yr", seedCheck(R, (r) => trendG(r.yr.map((x) => x.cpi / x.natCpi)), -0.005, 0.005), pc,
    "BLS metro CPI vs US 1984-2024: within about ±0.5%/yr");

  for (const k of CLASSES) {
    const band = { office: [0.05, 0.20, "CBRE/REIS US office 1980-2024: 8-19%; metro 5-25%"], retail: [0.04, 0.13, "REIS/CoStar US retail 1990-2024: 4-13%"],
      industrial: [0.03, 0.14, "CBRE US industrial 1989-2024: 3-14%"], multifamily: [0.03, 0.10, "Census HVS rental vacancy 1965-2024: 5-11%; managed (NMHC) 3-8%"] }[k];
    add("Space", `Vacancy, ${k}`, levelCheck(R, (x) => x.vac[k], band[0], band[1]), pc, band[2]);
  }
  for (const k of CLASSES) {
    add("Space", `Real rent growth, ${k}, %/yr`, seedCheck(R, (r) => trendG(r.yr.map((x) => x.rentR[k])), -0.01, 0.015), pc,
      "NCREIF/CBRE real rents 1978-2024: about -1 to +1.5%/yr long-run (Eichholtz et al.: real rents near flat over centuries)");
  }
  add("Space", "Occupied office sf per job, end over start", seedCheck(R, (r) => { const f = (x) => x.stock.office * (1 - x.vac.office) / x.jobs; return f(r.yr.at(-1)) / f(r.yr[0]); }, 0.7, 1.3), nm,
    "office sf per office worker fell ~250→~190 over 1990-2020 (CBRE/NAIOP): space follows jobs within ±30% over a century");
  add("Space", "Real rent, yearly swing sd", seedCheck(R, (r) => median(COMM.map((k) => sd(lgr(r.yr.map((x) => x.rentR[k]))))), 0.02, 0.10), pc,
    "NCREIF/CBRE market rent growth sd ~3-8%/yr");
  add("Space", "Rent and vacancy move opposite (corr of Δlog rent, vacancy)", seedCheck(R, (r) => median(CLASSES.map((k) => {
    const a = lgr(r.yr.map((x) => x.rentR[k])), b = r.yr.map((x) => x.vac[k]);
    const p = a.map((v, i) => [v, b[i]]).filter(([u, w]) => Number.isFinite(u) && Number.isFinite(w));
    const ma = mean(p.map((z) => z[0])), mb = mean(p.map((z) => z[1]));
    let s = 0, sa = 0, sb = 0; for (const [u, w] of p) { s += (u - ma) * (w - mb); sa += (u - ma) ** 2; sb += (w - mb) ** 2; }
    return s / Math.sqrt(sa * sb || 1);
  })), -0.9, -0.15), nm, "Wheaton-Torto rent adjustment: rent growth falls with vacancy (r ~ -0.3 to -0.7)");

  add("Capital", "Cap rate level (all classes, yearly)", levelCheck(R.map((r) => ({ ...r, yr: r.yr.flatMap((x) => CLASSES.map((k) => ({ v: x.cap[k] }))) })), (x) => x.v, 4, 11), (x) => Number.isFinite(x) ? x.toFixed(2) + "%" : "—",
    "NCREIF/RCA 1980-2024: 4-11%");
  add("Capital", "Cap spread over 10Y (all classes, yearly)", levelCheck(R.map((r) => ({ ...r, yr: r.yr.flatMap((x) => CLASSES.map((k) => ({ v: x.cap[k] - x.tenY }))) })), (x) => x.v, 1, 6), pp,
    "NCREIF/RCA cap rate minus UST10 1990-2024: ~1.5-5.5pp");
  add("Capital", "Cap rates lag the 10Y (best lag, years)", seedCheck(R, (r) => leadLag(diff(r.yr.map((x) => x.tenY)), diff(r.yr.map((x) => mean(CLASSES.map((k) => x.cap[k])))), 4).lag, 0, 3), nm,
    "cap rates follow rates with a 0-3 year lag and partial pass-through (Chervachidze-Wheaton 2013)");
  add("Capital", "Cap rate yearly move, mean abs change (median of classes)", seedCheck(R, (r) => median(CLASSES.map((k) => mean(diff(r.yr.map((x) => x.cap[k])).map(Math.abs)))), 0.1, 0.6), pp,
    "NCREIF/ACLI cap rates 1985-2024: typical annual move 0.2-0.5pp; 2009's +1.5pp was the extreme");
  add("Capital", "Deal-read share (years a sale priced the cap)", seedCheck(R, (r) => mean(r.yr.flatMap((x) => CLASSES.map((k) => x.capDeal[k] != null ? 1 : 0))), 0.6, 1), pc,
    "a cap rate read off closed deals needs deals: RCA tracks trades in every class in every major metro each year");
  add("Capital", "Real land price growth, trend %/yr", seedCheck(R, (r) => trendG(r.yr.map((x) => x.landR)), -0.01, 0.03), pc,
    "Davis-Heathcote / Knoll et al. (2017): real land prices ~0-3%/yr long-run, most of house-price growth");
  add("Capital", "Bank charge-offs %/yr of book", levelCheck(R, (x) => x.book > 0 ? x.chargeOffs / x.book : NaN, 0, 0.03), pc,
    "FDIC QBP CRE net charge-offs 1991-2024: ~0-3%/yr (peak ~3% 2010)");
  add("Capital", "Bank failures per century (9 lenders)", seedCheck(R, (r) => r.yr.reduce((s, x) => s + x.failures, 0) * 100 / r.yr.length, 0.5, 10), nm,
    "FDIC 1934-2024: failures cluster in crises (S&L, 2008-12); a town's few lenders: some, not none and not one a decade");
  add("Capital", "Peak yearly charge-off rate", seedCheck(R, (r) => Math.max(...r.yr.map((x) => x.book > 0 ? x.chargeOffs / x.book : 0)), 0.01, 0.08), pc,
    "FDIC CRE charge-offs peak 2-4% (1991, 2010); C&D loans to ~8%");

  add("Cycle", "National recessions per decade", seedCheck(R, (r) => r.yr.reduce((s, x) => s + x.recStarts, 0) * 10 / r.yr.length, 1.0, 1.7), nm,
    "NBER 1945-2020: 12 in 75 years (1 per 6.3); post-1982: 1 per 8-10 years");
  add("Cycle", "Share of months in national recession", seedCheck(R, (r) => r.yr.reduce((s, x) => s + x.recMonths, 0) / (12 * r.yr.length), 0.08, 0.2), pc,
    "NBER 1945-2020: ~14% of months");
  add("Cycle", "City job-loss years per decade", seedCheck(R, (r) => { const j = r.yr.map((x) => x.jobs); let n = 0; for (let i = 1; i < j.length; i++) if (j[i] < j[i - 1] * 0.995) n++; return n * 10 / (j.length - 1); }, 1, 3.5), nm,
    "BLS CES metros 1990-2024: payrolls fall in ~1-3 years a decade");
  add("Cycle", "Construction follows demand (lag, years: starts after jobs growth)", seedCheck(R, (r) => leadLag(lgr(r.yr.map((x) => x.jobs)), r.yr.map((x) => CLASSES.reduce((s, k) => s + x.starts[k], 0))).lag, 0, 3), nm,
    "Wheaton (1987, 1999): starts peak 1-3 years after demand; deliveries land as demand fades (overbuilding)");
  add("Cycle", "Vacancy rises after starts (lag, years: vacancy after starts)", seedCheck(R, (r) => leadLag(r.yr.map((x) => COMM.reduce((s, k) => s + x.starts[k], 0)), r.yr.map((x) => mean(COMM.map((k) => x.vac[k]))), 5).lag, 1, 4), nm,
    "Wheaton-Torto: completions 2-3 yrs after starts push vacancy up");
  add("Cycle", "Construction starts %/yr of stock", levelCheck(R, (x) => { const s = CLASSES.reduce((a, k) => a + x.starts[k], 0), st = CLASSES.reduce((a, k) => a + (x.stock[k] ?? 0), 0); return st > 0 ? s / st : NaN; }, 0.005, 0.04), pc,
    "Census/Dodge: commercial + multifamily starts ~1-3% of stock a year");

  add("Households", "Home ownership (owners / households)", levelCheck(R, (x) => x.hh > 0 ? x.owners / x.hh : NaN, 0.45, 0.70), pc,
    "Census HVS 1965-2024: 62-69% US; large metros 45-65%");
  add("Households", "Doubled-up share", levelCheck(R, (x) => x.hh > 0 ? x.doubled / x.hh : NaN, 0.02, 0.12), pc,
    "Census CPS: ~5-10% of households doubled up (Pew 2017, Harvard JCHS)");

  add("Firms", "Firm entry rate %/yr (firms with space)", levelCheck(R, (x) => x.entry, 0.05, 0.15), pc,
    "Census BDS 1978-2020: establishment entry 8-13%/yr");
  add("Firms", "Firm exit rate %/yr (firms with space)", levelCheck(R, (x) => x.exit, 0.05, 0.15), pc,
    "Census BDS 1978-2020: establishment exit 7-11%/yr");
  add("Firms", "Tenant failures (went dark) %/yr of firms", levelCheck(R, (x) => x.firms > 0 ? x.dark / x.firms : NaN, 0.01, 0.08), pc,
    "BDS firm deaths ~8%/yr, mostly small; tenants failing in place a few %");

  const L = formulaLedger();
  add("Integrity", "Formula ledger: aggregates still set from the top", { val: L.open, lo: 0, hi: 0, inShare: L.open ? 0 : 1, p10: L.open, p90: L.open, seedVals: [], grade: L.open ? "WATCH" : "PASS" }, (x) => Number.isFinite(x) ? String(x) : "—",
    `FORMULA_LEDGER.md open rows: #${L.ids.join(", #")} — target zero (plan §6c-F)`);
  add("Integrity", "Non-finite econ fields (seed-years)", { val: runs.reduce((s, r) => s + r.yr.reduce((a, x) => a + (x.nan > 0 ? 1 : 0), 0), 0), lo: 0, hi: 0, inShare: NaN, p10: NaN, p90: NaN, seedVals: [], grade: runs.some((r) => r.yr.some((x) => x.nan)) ? "FAIL" : "PASS" }, (x) => Number.isFinite(x) ? String(x) : "—",
    "a NaN anywhere is a bug: " + [...new Set(runs.flatMap((r) => r.nanPaths))].slice(0, 6).join(", "));
  add("Integrity", "Frozen years (rents, jobs, prices, rates all unchanged)", { val: runs.reduce((s, r) => s + r.frozenYrs, 0), lo: 0, hi: 0, inShare: NaN, p10: NaN, p90: NaN, seedVals: [], grade: runs.some((r) => r.frozenYrs) ? "FAIL" : "PASS" }, (x) => Number.isFinite(x) ? String(x) : "—",
    "the frozen world (CLAUDE.md): resurrected on gameOver; any frozen year is a bug");
  return rows;
}

function report(runs) {
  for (const r of runs) for (let i = 0; i < r.yr.length; i++) r.yr[i]._infl = i ? r.yr[i].cpi / r.yr[i - 1].cpi - 1 : NaN;
  const rows = checks(runs);
  const lines = [];
  lines.push(`Seeds ${runs.map((r) => r.seed).join(", ")} · ${runs[0]?.years} years each · ${(runs.reduce((s, r) => s + r.secs, 0) / 60).toFixed(0)} min of run · first 5 years dropped as settling`);
  lines.push("");
  lines.push("| | Check | Typical | Seed spread (p10-p90 of years, or min-max of seeds) | In band | Band | Grade | Source of band |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const x of rows) {
    lines.push(`| ${x.group} | ${x.name} | ${x.fmt(x.val)} | ${x.fmt(x.p10)} – ${x.fmt(x.p90)} | ${Number.isFinite(x.inShare) ? Math.round(100 * x.inShare) + "%" : "—"} | ${x.fmt(x.lo)} – ${x.fmt(x.hi)} | **${x.grade}** | ${x.src} |`);
  }
  const tally = { PASS: 0, WATCH: 0, FAIL: 0 };
  for (const x of rows) tally[x.grade]++;
  lines.push("");
  lines.push(`PASS ${tally.PASS} · WATCH ${tally.WATCH} · FAIL ${tally.FAIL}`);
  // per seed, per decade digest
  lines.push("");
  lines.push("Per seed, every 20 years: jobs · u · pop · real pay rel · CPI · vac O/R/I/M · real rent O/R/I/M · cap O/R/I/M vs 10Y · real land · own · firms");
  for (const r of runs) {
    lines.push(`seed ${r.seed}:`);
    for (const x of r.yr.filter((x) => x.y % 20 === 0 || x.y === 1)) {
      lines.push(`  y${String(x.y).padStart(3)} ${Math.round(x.jobs).toLocaleString("en-US").padStart(8)} u${pc(x.u)} pop ${Math.round(x.pop).toLocaleString("en-US")} pay ${nm(x.realPayRel)} cpi ${nm(x.cpi)} vac ${CLASSES.map((k) => pc(x.vac[k], 0)).join("/")} rent ${CLASSES.map((k) => nm(x.rentR[k], 1)).join("/")} cap ${CLASSES.map((k) => nm(x.cap[k], 1)).join("/")} vs ${nm(x.tenY, 1)} land ${nm(x.landR, 1)} own ${pc(x.hh > 0 ? x.owners / x.hh : NaN, 0)} firms ${x.firms}`);
    }
  }
  return { text: lines.join("\n"), rows };
}

// ---------------------------------------------------------------- main
const args = process.argv.slice(2);
if (args[0] === "--report") {
  const dir = args[1];
  const runs = readdirSync(dir).filter((f) => /^seed-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  console.log(report(runs).text);
} else {
  const SEEDS = (process.env.SEEDS ?? "11,22,33,44,55,66").split(",").map(Number);
  const YEARS = Number(process.env.YEARS ?? 100);
  const OUT = process.env.OUT ?? join(tmpdir(), `proof-${process.pid}`);
  console.error(`proof: seeds ${SEEDS.join(",")} · ${YEARS} years · writing ${OUT}`);
  await run(SEEDS, YEARS, OUT);
  const runs = SEEDS.map((s) => JSON.parse(readFileSync(join(OUT, `seed-${s}.json`), "utf8")));
  console.log(report(runs).text);
}
