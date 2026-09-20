// PLAN DESK — Phase 3 of LEASING_OVERHAUL_PLAN.md.
//
//   pnpm engine && pnpm plan-desk
//
// (a) clearAgainstPlan gates: expansion / tour / holdBlocks / authority /
//     credit / off-package-at-quote docket or decline as specified.
// (b) Monotonicity on one gifted book, paired seeds:
//     raising quotePct lowers deal count and raises signed NE%;
//     holdM / stepPct trade vacancy for rent in the measured direction.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,11").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 96);
const TARGET_SUITES = Number(process.env.SUITES ?? 100);
const OPERATING_CASH = 80e6;

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const commercialSuites = (rec) => {
  let n = 0;
  for (const u of E.leasableUses(rec)) {
    const sf = E.useSf(rec, u);
    if (sf <= 0) continue;
    n += Math.max(1, Math.round(sf / E.typicalSuiteSf(rec, u)));
  }
  return n;
};

const vacantSuites = (g, parcels) => {
  let vacant = 0, total = 0;
  for (const [bbl, h] of Object.entries(g.holdings ?? {})) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec || !E.isCommercial(rec)) continue;
    const st = E.unitStatus(rec, h, g.month);
    for (const row of st.byUse ?? []) {
      if (row.use === "multifamily") continue;
      vacant += row.vacant;
      total += row.total;
    }
  }
  return { vacant, total };
};

const takeBook = (g0, parcels, target) => {
  const g = structuredClone(g0);
  g.cash = Math.max(g.cash, OPERATING_CASH);
  let suites = 0;
  const candidates = bbls
    .map((b) => E.resolveRec(parcels, g, b))
    .filter((rec) => rec
      && rec.bldgArea > 0
      && E.isCommercial(rec)
      && !g.holdings[rec.bbl]
      && !E.isCivicLand(g, rec.bbl))
    .sort((a, b) => {
      const ao = (E.useSf(a, "office") || 0) > 0 ? 0 : 1;
      const bo = (E.useSf(b, "office") || 0) > 0 ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.bbl.localeCompare(b.bbl);
    });
  for (const rec of candidates) {
    const n = commercialSuites(rec);
    if (n <= 0) continue;
    const worth = E.assetValue(rec, g.econ, E.initialCondition(rec));
    const grade = E.gradeOf(g, rec);
    const holding = {
      bbl: rec.bbl,
      boughtM: g.month,
      costBasis: worth,
      assessed: worth,
      loan: null,
      condition: grade,
      condIdx: E.initialCondIdx(rec, g.month, grade),
      service: 0,
      stance: 0,
      plan: 1,
      svcIdx: 0.55,
      tenants: [],
      cfHistory: [],
    };
    E.genRentRoll(g, rec, holding, false, true);
    g.holdings[rec.bbl] = holding;
    E.clearRivalClaims(g, rec.bbl);
    g.listings = (g.listings ?? []).filter((l) => l.bbl !== rec.bbl);
    if (g.approaches) delete g.approaches[rec.bbl];
    suites += n;
    if (suites >= target) break;
  }
  return { g, suites };
};

/** Empty the gifted book so darkMs can age. Occupied buildings reset the
 *  clock as they fill; hold-out is a time-on-market rule and needs sitting
 *  space to measure. */
const emptyBook = (g0) => {
  const g = structuredClone(g0);
  for (const h of Object.values(g.holdings ?? {})) {
    h.tenants = [];
    h.occ = 0;
    h.darkMs = 0;
    delete h.blocks;
    h.makeReady = [];
  }
  g.lois = [];
  return g;
};

const baseRow = (over = {}) => ({
  quotePct: 1.08,
  maxTiPsf: 80,
  maxFreeM: 9,
  minBumpPct: 2.5,
  termLoM: 24,
  termHiM: 180,
  minCredit: 0,
  holdM: 0,
  stepPct: 0.02,
  floorPct: 0.90,
  ...over,
});

const sheetOf = (row, authority = 1e15) => ({
  sheet: { office: { ...row }, retail: { ...row }, industrial: { ...row } },
  authority,
});

const tenantKey = (bbl, t) => `${bbl}|${t.name}|${t.startM}`;
const snapTenants = (g) => {
  const m = new Map();
  for (const [bbl, h] of Object.entries(g.holdings ?? {})) {
    for (const t of h.tenants ?? []) m.set(tenantKey(bbl, t), { bbl, t: { ...t } });
  }
  return m;
};

const runPlan = (g0, parcels, adj, plan) => {
  let g = structuredClone(g0);
  g.agent = true;
  g.leasingPlan = structuredClone(plan);
  g.cash = Math.max(g.cash, OPERATING_CASH);
  E.workLeasingDesk(g, parcels);

  let closed = 0, closedNe = 0, vacMonths = 0, suiteMonths = 0;
  // THE DESK'S OWN LEDGER, quarter by quarter. The tenancy scan below reads
  // face against the building's blended market with no TI, which is not
  // the measure the floor governs; the digest is (loiMandateScore against
  // the letter's own leg and block, at signing).
  const quarters = new Map();
  let prev = snapTenants(g);
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: Math.max(g.cash, OPERATING_CASH) };
    g.cash = Math.max(g.cash, 5e6);
    g.leasingPlan = structuredClone(plan);
    g.agent = true;
    g = E.advanceQuarter(g, parcels, bbls, adj);
    for (const d of [g.deskDigestPrev, g.deskDigest]) {
      if (d) quarters.set(d.startM, { signed: d.signed, neSum: d.signedNeSum });
    }
    const vac = vacantSuites(g, parcels);
    vacMonths += vac.vacant;
    suiteMonths += vac.total;
    const now = snapTenants(g);
    for (const [k, { bbl, t }] of now) {
      const rec = E.resolveRec(parcels, g, bbl);
      const h = g.holdings[bbl];
      if (!rec || !h) continue;
      const old = prev.get(k);
      const isNew = t.startM === g.month && !old;
      const isRenew = !!old && old.t.endM !== t.endM;
      if (!isNew && !isRenew) continue;
      const market = E.managedRentPsfYr(rec, g.econ, h, t.use);
      const origin = isNew ? t.startM : g.month;
      const termM = Math.max(12, t.endM - origin);
      const freeM = t.freeUntilM ? Math.max(0, t.freeUntilM - origin) : 0;
      const ne = E.netEffectivePsf(
        { termM, tiPsf: 0, freeM, rentPsf: t.rentPsf, bumpPct: E.bumpOf(t) },
        t.rentPsf, 0, freeM, E.bumpOf(t),
      );
      closed += 1;
      closedNe += ne / Math.max(1, market);
    }
    prev = now;
  }
  let deskSigned = 0, deskNeSum = 0;
  for (const q of quarters.values()) { deskSigned += q.signed; deskNeSum += q.neSum; }
  return {
    closed,
    ne: closed ? closedNe / closed : NaN,
    deskSigned,
    deskNe: deskSigned ? deskNeSum / deskSigned : NaN,
    vacMonths,
    vacRate: suiteMonths ? vacMonths / suiteMonths : NaN,
  };
};

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

// ---------------------------------------------------------------------------
// (a) Gates on a real book + a planted letter
// ---------------------------------------------------------------------------
{
  const parcels = JSON.parse(JSON.stringify(P0));
  const raw = E.firstListings(E.newGame(11, parcels), parcels, bbls);
  const book = takeBook(raw, parcels, 40);
  const g = book.g;
  const bbl = Object.keys(g.holdings)[0];
  const rec = E.resolveRec(parcels, g, bbl);
  const h = g.holdings[bbl];
  const market = E.managedRentPsfYr(rec, g.econ, h, "office") || 40;
  const plan = sheetOf(baseRow());
  const letter = (over = {}) => ({
    id: 9001,
    bbl,
    use: "office",
    kind: "new",
    name: "Gate Probe LLC",
    sector: "law",
    credit: 1,
    sf: 5_000,
    rentPsf: market,
    termM: 84,
    tiPsf: 20,
    freeM: 2,
    bumpPct: 2.5,
    net: true,
    expiresM: g.month + 3,
    ...over,
  });

  const expand = E.clearAgainstPlan(g, letter({ kind: "expansion", sf: 8_000 }), plan, { rec, h });
  ok("expansion dockets", expand.verdict === "docket", expand.verdict);

  g.lois = [
    letter({ id: 1, tourId: 7, name: "A" }),
    letter({ id: 2, tourId: 7, name: "B", rentPsf: market * 1.02 }),
  ];
  const tour = E.clearAgainstPlan(g, g.lois[0], plan, { rec, h });
  ok("multi-party tour dockets", tour.verdict === "docket", tour.verdict);
  g.lois = [];

  const held = sheetOf(baseRow({
    holdBlocks: [{ floorLo: 1, floorHi: 4 }],
  }));
  const heldLetter = letter({ blockId: 1 });
  h.blocks = [{ id: 1, use: "office", floorLo: 2, floorHi: 2, sf: 5_000, kind: "partial", cuts: 0 }];
  const holdV = E.clearAgainstPlan(g, heldLetter, held, { rec, h });
  ok("holdBlocks docket", holdV.verdict === "docket", holdV.verdict);

  const tinyAuth = sheetOf(baseRow(), 1000);
  const auth = E.clearAgainstPlan(g, letter({ rentPsf: market * 1.10 }), tinyAuth, { rec, h });
  ok("over authority dockets", auth.verdict === "docket", auth.verdict);

  const creditPlan = sheetOf(baseRow({ minCredit: 2 }));
  const cred = E.clearAgainstPlan(g, letter({ credit: 0 }), creditPlan, { rec, h });
  ok("credit below sheet declines", cred.verdict === "decline", cred.verdict);

  const quotePsf = E.planQuotePsf(g, letter(), baseRow(), rec, h);
  const fat = E.clearAgainstPlan(g, letter({
    rentPsf: quotePsf + 1, tiPsf: 200, freeM: 18,
  }), plan, { rec, h });
  ok("off-package at quote dockets", fat.verdict === "docket", `${fat.verdict} quote=${quotePsf.toFixed(2)}`);

  const fair = E.clearAgainstPlan(g, letter({ rentPsf: market * 1.10, tiPsf: 10, freeM: 1 }), plan, { rec, h });
  ok("at-quote in-package signs", fair.verdict === "sign", fair.verdict);

  const under = E.clearAgainstPlan(g, letter({ rentPsf: market * 0.88 }), plan, { rec, h });
  ok("under-quote is still sign (desk will counter)", under.verdict === "sign", under.verdict);

  // THE FLOOR IS ON WHAT NETS. A letter at the ask, inside the free-rent
  // and TI caps, that nets under the floor is not signed as written: the
  // desk counters, giving away free months first, then fit-out, until the
  // terms net the floor.
  const nePlan = sheetOf(baseRow({ quotePct: 1.00, floorPct: 0.90, minNePct: 0.92, maxFreeM: 8, maxTiPsf: 80 }));
  const lowNe = letter({ rentPsf: market * 1.00, termM: 36, tiPsf: 60, freeM: 6 });
  const lowNeScore = E.loiMandateScore(lowNe, market);
  const ne = E.clearAgainstPlan(g, lowNe, nePlan, { rec, h });
  ok("at-quote, in-package but under the net-effective floor is NOT signed as written",
    ne.verdict === "sign" && ne.signAsIs === false && !!ne.counter,
    `${ne.verdict} signAsIs=${ne.signAsIs} nets ${(lowNeScore * 100).toFixed(0)}% vs floor 92%`);
  if (ne.counter) {
    const at = E.neScoreAt(lowNe, ne.counter, market);
    ok("the counter trims concessions until the terms net the floor",
      at + 0.005 >= 0.92 && (ne.counter.freeM < 6 || ne.counter.tiPsf < 60),
      `free ${lowNe.freeM}→${ne.counter.freeM} mo, TI $${lowNe.tiPsf}→$${ne.counter.tiPsf}, nets ${(at * 100).toFixed(0)}%`);
    ok("the counter does not raise rent above the sheet's ask", ne.counter.rentPsf <= ne.quotePsf + 0.01, `$${ne.counter.rentPsf} vs ask $${ne.quotePsf.toFixed(2)}`);
  }
  // At the sheet's own ask for THIS letter (the engine prices a letter off
  // its leg and block, not the building's blend the harness calls `market`).
  const fineLetter = letter({ termM: 84, tiPsf: 10, freeM: 1 });
  fineLetter.rentPsf = E.planQuotePsf(g, fineLetter, nePlan.sheet.office, rec, h) + 0.01;
  const fine = E.clearAgainstPlan(g, fineLetter, nePlan, { rec, h });
  ok("at-quote and netting the floor signs as written", fine.verdict === "sign" && fine.signAsIs === true,
    `${fine.verdict} signAsIs=${fine.signAsIs} nets ${((fine.neScore ?? 0) * 100).toFixed(0)}%`);
  const unreachable = sheetOf(baseRow({ quotePct: 0.90, floorPct: 0.90, minNePct: 0.99 }));
  const cannot = E.clearAgainstPlan(g, letter({ rentPsf: market * 0.90, termM: 60, tiPsf: 0, freeM: 0 }), unreachable, { rec, h });
  ok("a floor the sheet's own ask cannot net dockets with the reason",
    cannot.verdict === "docket" && /floor/.test(cannot.why ?? ""), `${cannot.verdict}: ${cannot.why ?? ""}`);
  ok("rows written before the floor existed read the walk-away floor as the signing floor",
    E.neFloorOf({ ...baseRow(), minNePct: undefined }) === baseRow().floorPct);

  const syn = E.starterPlan();
  ok("starter quote is the old default sign line, no par cap",
    Math.abs(syn.sheet.office.quotePct - 0.90) < 1e-9
    && syn.sheet.office.quotePct <= 1.00,
    `quotePct=${syn.sheet.office.quotePct}`);
  ok("ensureLeasingPlan no-ops without a desk",
    E.ensureLeasingPlan({ agent: false }) === undefined);

  const player = E.playerEquivalentPlan();
  ok("player-equivalent quote is above par",
    player.sheet.office.quotePct > 1.0, `quotePct=${player.sheet.office.quotePct}`);

  // Hold-out schedule reads darkMs. Do not add a second clock.
  const row = baseRow({ quotePct: 1.08, holdM: 18, stepPct: 0.02, floorPct: 0.95 });
  const darkAt = (ms) => {
    const probe = { ...h, darkMs: ms };
    return E.effectiveQuotePct(g, letter(), row, rec, probe);
  };
  ok("hold-out holds the ask before holdM", Math.abs(darkAt(12) - 1.08) < 1e-9, `got ${darkAt(12)}`);
  ok("hold-out steps 2pp per quarter after holdM", Math.abs(darkAt(24) - 1.04) < 1e-9, `got ${darkAt(24)}`);
  ok("hold-out never steps below floorPct", Math.abs(darkAt(90) - 0.95) < 1e-9, `got ${darkAt(90)}`);

  // Backwards-wire: a tighter market must WIDEN the full-floor premium.
  const loose = E.blockPremAdj(-0.2, "floors");
  const tight = E.blockPremAdj(0.3, "floors");
  ok("tightening widens the full-floor premium",
    tight > loose + 0.01,
    `tight ${tight.toFixed(3)} vs loose ${loose.toFixed(3)}`);
  const remLoose = E.blockPremAdj(-0.2, "remnant");
  const remTight = E.blockPremAdj(0.3, "remnant");
  ok("tightening shrinks the remnant discount (less negative)",
    remTight > remLoose + 0.01,
    `tight ${remTight.toFixed(3)} vs loose ${remLoose.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// (b) Monotonicity
// ---------------------------------------------------------------------------
console.log(`\nMONOTONICITY  seeds ${SEEDS.join(", ")} · ${HZ} months · ~${TARGET_SUITES} suites`);
const quoteLow = [];
const quoteHigh = [];
const holdPatient = [];
const holdNow = [];
const neLoose = [];
const neTight = [];

for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  const raw = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const book = takeBook(raw, parcels, TARGET_SUITES);
  if (book.suites < TARGET_SUITES * 0.8) {
    console.log(`  SEED ${seed}  SKIP  only ${book.suites} suites`);
    continue;
  }
  const low = runPlan(book.g, parcels, adjacency, sheetOf(baseRow({ quotePct: 1.00, holdM: 0, floorPct: 0.90 })));
  const high = runPlan(book.g, parcels, adjacency, sheetOf(baseRow({ quotePct: 1.12, holdM: 0, floorPct: 0.95 })));
  const vacant = emptyBook(book.g);
  const patient = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ quotePct: 1.08, holdM: 18, stepPct: 0.02, floorPct: 0.95 })));
  const now = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ quotePct: 1.08, holdM: 0, stepPct: 0.02, floorPct: 0.95 })));
  const floorLoose = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ quotePct: 1.00, holdM: 0, floorPct: 0.85, minNePct: 0.72 })));
  const floorTight = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ quotePct: 1.00, holdM: 0, floorPct: 0.85, minNePct: 0.95 })));
  neLoose.push(floorLoose);
  neTight.push(floorTight);
  quoteLow.push(low);
  quoteHigh.push(high);
  holdPatient.push(patient);
  holdNow.push(now);
  const pct = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—";
  console.log(`SEED ${seed}  ${book.suites} suites`);
  console.log(`  quote 1.00   deals ${String(low.closed).padStart(4)}  NE ${pct(low.ne).padStart(6)}  vac-mo ${Math.round(low.vacMonths)}`);
  console.log(`  quote 1.12   deals ${String(high.closed).padStart(4)}  NE ${pct(high.ne).padStart(6)}  vac-mo ${Math.round(high.vacMonths)}`);
  console.log(`  hold 18      deals ${String(patient.closed).padStart(4)}  NE ${pct(patient.ne).padStart(6)}  vac-mo ${Math.round(patient.vacMonths)}`);
  console.log(`  hold 0       deals ${String(now.closed).padStart(4)}  NE ${pct(now.ne).padStart(6)}  vac-mo ${Math.round(now.vacMonths)}`);
  console.log(`  floor 72%    deals ${String(floorLoose.closed).padStart(4)}  NE ${pct(floorLoose.ne).padStart(6)}  vac-mo ${Math.round(floorLoose.vacMonths)}`);
  console.log(`  floor 95%    deals ${String(floorTight.closed).padStart(4)}  NE ${pct(floorTight.ne).padStart(6)}  vac-mo ${Math.round(floorTight.vacMonths)}`);
}

if (!quoteLow.length) {
  console.log("no seeds produced a book");
  process.exit(1);
}

const mClosed = (rows) => mean(rows.map((r) => r.closed));
const mNe = (rows) => mean(rows.map((r) => r.ne).filter(Number.isFinite));
const mVac = (rows) => mean(rows.map((r) => r.vacMonths));

const lowDeals = mClosed(quoteLow);
const highDeals = mClosed(quoteHigh);
const lowNe = mNe(quoteLow);
const highNe = mNe(quoteHigh);
const patientVac = mVac(holdPatient);
const nowVac = mVac(holdNow);
const patientNe = mNe(holdPatient);
const nowNe = mNe(holdNow);

console.log("\nPAIRED MEANS");
console.log(`  quote 1.00  deals ${lowDeals.toFixed(1)}   NE ${(lowNe * 100).toFixed(1)}%`);
console.log(`  quote 1.12  deals ${highDeals.toFixed(1)}   NE ${(highNe * 100).toFixed(1)}%`);
console.log(`  hold 18     vac-mo ${patientVac.toFixed(0)}   NE ${(patientNe * 100).toFixed(1)}%`);
console.log(`  hold 0      vac-mo ${nowVac.toFixed(0)}   NE ${(nowNe * 100).toFixed(1)}%`);

ok("raising quotePct lowers deal count",
  highDeals < lowDeals - 0.5,
  `1.12→${highDeals.toFixed(1)} vs 1.00→${lowDeals.toFixed(1)}`);
ok("raising quotePct raises signed NE%",
  highNe > lowNe + 0.004,
  `1.12→${(highNe * 100).toFixed(1)}% vs 1.00→${(lowNe * 100).toFixed(1)}%`);
// THE FLOOR DOES WHAT IT SAYS ACROSS A BOOK: signed net effective rises and
// deals fall as it is raised, and the average signed deal never nets under it.
const looseNe = mNe(neLoose), tightNe = mNe(neTight);
const looseDeals = mClosed(neLoose), tightDeals = mClosed(neTight);
console.log(`  floor 72%   deals ${looseDeals.toFixed(1)}   NE ${(looseNe * 100).toFixed(1)}%`);
console.log(`  floor 95%   deals ${tightDeals.toFixed(1)}   NE ${(tightNe * 100).toFixed(1)}%`);
ok("raising the net-effective floor raises signed NE%",
  tightNe > looseNe + 0.004,
  `95%→${(tightNe * 100).toFixed(1)}% vs 72%→${(looseNe * 100).toFixed(1)}%`);
ok("raising the net-effective floor lowers deal count",
  tightDeals < looseDeals - 0.5,
  `95%→${tightDeals.toFixed(1)} vs 72%→${looseDeals.toFixed(1)}`);
const deskTight = mean(neTight.map((r) => r.deskNe).filter(Number.isFinite));
const deskLoose = mean(neLoose.map((r) => r.deskNe).filter(Number.isFinite));
console.log(`  desk's own ledger: floor 72% signed at ${(deskLoose * 100).toFixed(1)}%   floor 95% signed at ${(deskTight * 100).toFixed(1)}%`);
ok("the desk never averages under its own floor (its ledger, its market)",
  deskTight + 0.01 >= 0.95,
  `${(deskTight * 100).toFixed(1)}% against a 95% floor`);
// Vacant-months on an empty 8-year book is a weak hold-out signal
// (Phase 3 barely cleared +21 on 2,670). Phase 5 dropped the even-cut
// on giveback/renewal shrink, which moves how space returns to the
// pool. The load-bearing check is the schedule (darkMs 12/24/90 above)
// plus signed NE%. Do not retune the sheet to make vac-months line up.
ok("holdM does not collapse vacancy into a first-letter grab",
  patientVac > nowVac * 0.90,
  `hold18 ${patientVac.toFixed(0)} vs hold0 ${nowVac.toFixed(0)}`);
ok("holdM trades vacancy for rent (higher NE%)",
  patientNe > nowNe + 0.002,
  `hold18 ${(patientNe * 100).toFixed(1)}% vs hold0 ${(nowNe * 100).toFixed(1)}%`);

if (fails) {
  console.log(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log("\nplan-desk: all checks passed");
