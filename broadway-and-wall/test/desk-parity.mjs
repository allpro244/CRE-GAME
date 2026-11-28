// THE BUILD DESK AND THE TOWN'S BUILDERS UNDERWRITE ONE WAY (F9, 2026-11-28).
//
//   1. The exit yield is the market's cap plus the property tax, and says so:
//      exitYield == marketCap + taxLoadPct; the tax load is the tax bill's own
//      rate (COMMERCIAL_EFFECTIVE x the council's levy x the owner's share);
//      worth == NOI before tax / exit yield == NOI after tax / cap.
//   2. Asking the town (townBuilderRead) writes nothing: a desk render must
//      never move the sim.
//   3. On the city's own starts, the desk's pro forma on the same lot, the
//      month before, matches the builder's book, and townBuilderRead says a
//      builder in town would start it (and how many of them the desk's 17%
//      verdict calls "does not pencil" is printed, not asserted).
//
// Run: node test/desk-parity.mjs   (SEED, MONTHS to override; about 40 s)
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 12007);
const MONTHS = Number(process.env.MONTHS ?? 18);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log(`\nDESK PARITY — seed ${SEED}\n`);

let parcels = structuredClone(P0);
let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
const USES = ["office", "multifamily", "retail", "industrial"];
// The share of the tax bill the owner bears, by class (value.ts taxBorneShare): flats pay it all.
const share = (u) => 1 - (u === "multifamily" ? 0 : E.RECOVERY_RATE[u]);

// ---------------------------------------------------------------------------
// 1. The yield's parts, on every land listing at month 0.
// ---------------------------------------------------------------------------
{
  const rich = { ...g, cash: 5e8 };
  const tm = g.econ.taxMult ?? 1;
  const plans = [];
  for (const li of g.listings) {
    const rec = E.resolveRec(parcels, g, li.bbl);
    if (!rec || rec.class !== "land") continue;
    for (const use of USES) {
      if (E.zoneUseBar(rec, use, g.econ)) continue;
      const top = E.maxFloorsFor(rec, 0.6, use);
      for (const fl of [1, 2, 3, 4, 6, 8].filter((x) => x <= top)) {
        const p = E.planDevelopment(rich, parcels, li.bbl, use, fl, 0.6, "gmp", undefined, undefined, undefined, 0.5, li.ask);
        if (p) plans.push({ p, use, bbl: li.bbl });
      }
    }
  }
  let sumErr = 0, taxErr = 0, worthErr = 0, pure = 0, capEq = 0, capIdx = 0, abated = 0;
  for (const { p, use } of plans) {
    sumErr = Math.max(sumErr, Math.abs(p.exitYield - (p.marketCap + p.taxLoadPct)));
    if (p.taxAbate && p.taxAbate.pct > 0) { abated++; continue; }
    const worth = p.stabNoi / (p.exitYield / 100);
    worthErr = Math.max(worthErr, Math.abs(worth - (p.stabNoi - p.taxYr1) / (p.marketCap / 100)) / worth);
    // a single-use building (no shops at grade folded in) carries its class's share exactly
    if ((p.mix?.[use] ?? 0) > 1 - 1e-12) {
      pure++;
      taxErr = Math.max(taxErr, Math.abs(p.taxLoadPct - E.COMMERCIAL_EFFECTIVE * 100 * tm * share(use)));
    }
    if (Math.abs(p.marketCap - p.capToday) < 1e-9) capEq++;
    if (Math.abs(p.marketCap - g.econ.capRate[use]) < 1e-9) capIdx++;
  }
  const mf = plans.find((x) => x.use === "multifamily" && (x.p.mix?.multifamily ?? 0) > 1 - 1e-12)?.p;
  console.log(`  ${plans.length} plans on ${new Set(plans.map((x) => x.bbl)).size} listings; ${pure} single-use, ${abated} abated; levy ${tm.toFixed(3)}`);
  if (mf) console.log(`  e.g. flats: worth = NOI before tax / (${mf.marketCap.toFixed(2)}% cap + ${mf.taxLoadPct.toFixed(2)}% tax = ${mf.exitYield.toFixed(2)}%); today's cap ${mf.capToday.toFixed(2)}%, Markets ${g.econ.capRate.multifamily.toFixed(2)}%`);
  check(plans.length >= 40, `the listings plan (${plans.length} plans)`);
  check(sumErr < 1e-9, `exit yield = market cap + tax load on every plan (worst ${sumErr.toExponential(1)})`);
  check(pure >= 20 && taxErr < 1e-9, `the tax load is ${(E.COMMERCIAL_EFFECTIVE * 100).toFixed(3)}% x levy x the owner's share on ${pure} single-use plans (worst ${taxErr.toExponential(1)})`);
  check(worthErr < 1e-6, `worth = NOI before tax / exit yield = NOI after tax / cap (worst ${worthErr.toExponential(1)})`);
  // At the opening the through-cycle read has not moved off today's tape.
  const capExpAtTape = USES.every((u) => Math.abs((g.econ.capExp?.[u] ?? g.econ.capRate[u]) - g.econ.capRate[u]) < 1e-9);
  if (capExpAtTape) check(capEq === plans.length, `month 0: the through-cycle cap is today's cap on every plan (${capEq}/${plans.length})`);
  console.log(`  (${capIdx}/${plans.length} plans sit exactly on the Markets cap${capIdx < plans.length ? "; the rest carry the cap grid's adjustment for a new building at the lot" : ""})`);

  // -------------------------------------------------------------------------
  // 2. Asking the town writes nothing — on a fresh month-0 game, where the
  //    equity-stretch memory has not been started yet.
  // -------------------------------------------------------------------------
  const before = JSON.stringify(g);
  const memo0 = g.econ.ltcUsualM;
  let reads = 0, yes = 0;
  for (const { p, use, bbl } of plans) {
    const r = E.townBuilderRead(g, parcels, bbl, p, use);
    reads++;
    if (r.h >= 1) yes++;
    if (!Number.isFinite(r.vc)) { check(false, `townBuilderRead returns a value/cost on ${bbl}`); break; }
  }
  check(JSON.stringify(g) === before, `${reads} town reads leave the game byte-identical (memory month ${memo0 ?? "unset"})`);
  // The memory a screen must not start or advance: unset, and a month stale.
  for (const [tag, edit] of [["unset", (e) => { delete e.ltcUsualM; delete e.ltcUsual; delete e.ltcNow; }], ["stale", (e) => { e.ltcUsualM = -1; e.ltcUsual = (e.ltcUsual ?? 0.6) - 0.15; }]]) {
    const c1 = structuredClone(g);
    edit(c1.econ);
    const c2 = structuredClone(c1);
    const snap = JSON.stringify(c1);
    const peek = E.equityStretchPeek(c1);
    check(JSON.stringify(c1) === snap && peek === E.equityStretch(c2), `equityStretchPeek on a ${tag} memory gives equityStretch's number (${peek.toFixed(4)}) and writes nothing`);
  }
  console.log(`  month 0: the town would start ${yes} of ${reads} listing plans; the desk's 17% passes ${plans.filter((x) => x.p.hurdleRatio >= 1).length}`);
}

// ---------------------------------------------------------------------------
// 3. The city's own starts: the desk's pro forma on the same lot and month.
// ---------------------------------------------------------------------------
{
  const seen = new Set((g.cityJobs ?? []).map((j) => j.bbl + ":" + j.startM));
  const rows = [];
  let impure = 0;
  for (let m = 1; m <= MONTHS; m++) {
    const prev = structuredClone(g);
    const prevParcels = structuredClone(parcels);
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    for (const j of g.cityJobs ?? []) {
      const key = j.bbl + ":" + j.startM;
      if (seen.has(key)) continue;
      seen.add(key);
      const rec = E.resolveRec(prevParcels, prev, j.bbl);
      if (!rec || rec.class !== "land" || !j.merchant) continue;
      const p = E.planDevelopment({ ...prev, cash: 5e8 }, prevParcels, j.bbl, j.use, j.floors, E.cityCoverage(j.use), "gmp", undefined, undefined, undefined, j.spec ?? 0.5);
      if (!p) continue;
      const snap = JSON.stringify(prev);
      const t = E.townBuilderRead(prev, prevParcels, j.bbl, p, j.use);
      if (JSON.stringify(prev) !== snap) impure++;
      const st = E.streetHurdle(prev, p, j.use, p.ltcMax > 0 && p.commitment > 0, true);
      rows.push({ m, j, p, t, st });
      console.log(`  m${m} ${j.bbl} ${j.use}/${j.floors}fl: book ${(j.merchant.yld * 100).toFixed(2)}% noi ${Math.round(j.merchant.noi)} | desk ${p.exitYield.toFixed(2)}% noi ${Math.round(p.stabNoi)} hurdle ${p.hurdleRatio.toFixed(2)} | street ${st.toFixed(2)} town ${t.h.toFixed(2)} ${t.who ?? "(merchants)"}`);
    }
  }
  const n = rows.length;
  const yldOk = rows.filter((r) => Math.abs(r.p.exitYield - 100 * r.j.merchant.yld) <= 0.35).length;
  const noiOk = rows.filter((r) => Math.abs(r.p.stabNoi / r.j.merchant.noi - 1) <= 0.05).length;
  const townOk = rows.filter((r) => r.t.h >= 0.95).length;
  const under = rows.filter((r) => r.p.hurdleRatio < 1).length;
  const atLeastStreet = rows.filter((r) => r.t.h >= r.st - 1e-12).length;
  check(n >= 5, `${n} city starts on vacant land to compare`);
  check(yldOk === n, `the desk's exit yield is the builder's within 0.35 points on ${yldOk}/${n}`);
  check(noiOk === n, `the desk's NOI is the builder's within 5% on ${noiOk}/${n}`);
  check(atLeastStreet === n, `the town read is never below the street's own start test (${atLeastStreet}/${n})`);
  check(townOk >= Math.ceil(0.85 * n), `the town would start ${townOk}/${n} of the plans it did start (town read >= 0.95)`);
  // An observation, not a requirement: how many of the town's own starts the
  // merchant's 17% would have called short. Pinning it would fail the day the
  // town's builders happen to start only schemes that clear 17%.
  console.log(`  (the desk's 17% margin calls ${under}/${n} of them short — the town builds under it)`);
  check(impure === 0, `town reads on ${n} mid-game states write nothing`);
}

console.log("");
process.exit(bad ? 1 : 0);
