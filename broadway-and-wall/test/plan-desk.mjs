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
    n += Math.max(1, Math.round(sf / E.useSuiteSf(rec, u)));
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
  let prev = snapTenants(g);
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: Math.max(g.cash, OPERATING_CASH) };
    g.cash = Math.max(g.cash, 5e6);
    g.leasingPlan = structuredClone(plan);
    g.agent = true;
    g = E.advanceQuarter(g, parcels, bbls, adj);
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
  return {
    closed,
    ne: closed ? closedNe / closed : NaN,
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

  const syn = E.synthesizeFromDials({ agent: true, agentFloor: 0.90 });
  ok("synthesised quote is agentFloor, no par cap applied beyond the dial",
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
}

// ---------------------------------------------------------------------------
// (b) Monotonicity
// ---------------------------------------------------------------------------
console.log(`\nMONOTONICITY  seeds ${SEEDS.join(", ")} · ${HZ} months · ~${TARGET_SUITES} suites`);
const quoteLow = [];
const quoteHigh = [];
const holdPatient = [];
const holdNow = [];

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
ok("holdM trades vacancy for rent (more vacant-months)",
  patientVac > nowVac + 10,
  `hold18 ${patientVac.toFixed(0)} vs hold0 ${nowVac.toFixed(0)}`);
ok("holdM trades vacancy for rent (higher NE%)",
  patientNe > nowNe + 0.002,
  `hold18 ${(patientNe * 100).toFixed(1)}% vs hold0 ${(nowNe * 100).toFixed(1)}%`);

if (fails) {
  console.log(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log("\nplan-desk: all checks passed");
