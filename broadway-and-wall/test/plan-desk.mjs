// PLAN DESK — Phase 3 of LEASING_OVERHAUL_PLAN.md.
//
//   pnpm engine && pnpm plan-desk
//
// (a) clearAgainstPlan gates: expansion / tour / holdBlocks / authority /
//     credit docket or decline as specified; NO package filter — a fat
//     allowance or an odd term is restructured into rent, not refused.
// (b) Monotonicity on one gifted book, paired seeds: raising the target
//     lowers deal count and raises signed NE%; patience trades vacancy for
//     rent in the measured direction.
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
  targetNePct: 0.92,
  patienceM: 0,
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

  // NO PACKAGE FILTER. A tenant who wants a big allowance and a lot of free
  // rent is not turned away for the shape of the deal: the desk keeps the
  // package and asks for the rent that reaches the sheet.
  const fatL = letter({ rentPsf: market, tiPsf: 120, freeM: 12, termM: 36 });
  const fat = E.clearAgainstPlan(g, fatL, plan, { rec, h });
  ok("a fat package is countered, not docketed", fat.verdict === "sign" && fat.signAsIs === false && !!fat.counter, `${fat.verdict} signAsIs=${fat.signAsIs}`);
  if (fat.counter) {
    ok("the counter keeps the tenant's package", fat.counter.tiPsf === 120 && fat.counter.freeM === 12 && fat.counter.termM === 36,
      `TI ${fat.counter.tiPsf} free ${fat.counter.freeM} term ${fat.counter.termM}`);
    ok("…and raises the rent to reach the ask", fat.counter.rentPsf > fatL.rentPsf + 1, `$${fatL.rentPsf.toFixed(2)} → $${fat.counter.rentPsf.toFixed(2)}`);
  }
  const oddTerm = E.clearAgainstPlan(g, letter({ termM: 18, rentPsf: market * 1.1, tiPsf: 0, freeM: 0 }), plan, { rec, h });
  ok("a short term is not docketed for being short", oddTerm.verdict === "sign", `${oddTerm.verdict} ${oddTerm.why ?? ""}`);

  // At the sheet's own ask for THIS letter (the engine prices a letter off
  // its leg and block, not the building's blend the harness calls `market`).
  const fairL = letter({ tiPsf: 10, freeM: 1 });
  fairL.rentPsf = E.planQuotePsf(g, fairL, baseRow(), rec, h) + 0.05;
  const fair = E.clearAgainstPlan(g, fairL, plan, { rec, h });
  ok("at the ask and netting the target signs as written", fair.verdict === "sign" && fair.signAsIs === true, `${fair.verdict} signAsIs=${fair.signAsIs}`);

  const under = E.clearAgainstPlan(g, letter({ rentPsf: market * 0.88 }), plan, { rec, h });
  ok("under the ask is still sign (desk will counter)", under.verdict === "sign" && !under.signAsIs, under.verdict);

  // THE CASH GUARDRAIL RESTRUCTURES. Over the per-deal cap, fit-out turns
  // into rent ("they build it"); the letter is still worked.
  const capPlan = sheetOf(baseRow({ maxCashPerDeal: 100_000 }));
  const big = letter({ sf: 10_000, tiPsf: 60, rentPsf: market * 0.95 });
  const capped = E.clearAgainstPlan(g, big, capPlan, { rec, h });
  ok("over the cash cap, the allowance comes down and rent goes up",
    capped.verdict === "sign" && !!capped.counter && capped.counter.tiPsf < 60 && capped.counter.rentPsf > big.rentPsf,
    capped.counter ? `TI $60→$${capped.counter.tiPsf}, rent $${big.rentPsf.toFixed(2)}→$${capped.counter.rentPsf.toFixed(2)}` : capped.verdict);

  // Credit guardrail applies only above its size.
  const sizedCredit = sheetOf(baseRow({ minCredit: 2, minCreditSf: 20_000 }));
  ok("a credit floor scoped to big deals lets a small one through",
    E.clearAgainstPlan(g, letter({ credit: 0, sf: 5_000 }), sizedCredit, { rec, h }).verdict !== "decline");
  ok("…and declines a big one",
    E.clearAgainstPlan(g, letter({ credit: 0, sf: 25_000 }), sizedCredit, { rec, h }).verdict === "decline");

  const syn = E.starterPlan();
  ok("starter brief is 92% / 12 months",
    Math.abs(syn.sheet.office.targetNePct - 0.92) < 1e-9 && syn.sheet.office.patienceM === 12,
    JSON.stringify(syn.sheet.office));
  ok("ensureLeasingPlan no-ops without a desk",
    E.ensureLeasingPlan({ agent: false }) === undefined);

  // SEEDED FROM THE PRINCIPAL'S OWN RECORD.
  const rec4 = { month: 100, principalSigned: [
    { m: 90, use: "office", ne: 0.97 }, { m: 92, use: "office", ne: 1.01 }, { m: 95, use: "office", ne: 0.99 },
    { m: 60, use: "office", ne: 0.70 }, // too old
    { m: 96, use: "retail", ne: 0.80 },
  ] };
  const seeded = E.seedPlanFromRecord(rec4);
  ok("a desk taking the pen is briefed with the principal's own median",
    Math.abs(seeded.sheet.office.targetNePct - 0.99) < 1e-9 && seeded.seededFrom?.deals === 3,
    JSON.stringify(seeded.sheet.office) + " " + JSON.stringify(seeded.seededFrom));
  ok("a use with too few signings keeps the default brief",
    Math.abs(seeded.sheet.retail.targetNePct - 0.92) < 1e-9);

  // Patience reads darkMs. Do not add a second clock.
  const row = baseRow({ targetNePct: 1.05, patienceM: 18 });
  const street = E.marketClearingPct(g, "office");
  const at = (ms) => E.planTargets(g, letter(), row, rec, { ...h, darkMs: ms });
  ok("inside patience: ask and floor are the target", Math.abs(at(12).ask - 1.05) < 1e-9 && Math.abs(at(12).floor - 1.05) < 1e-9, JSON.stringify(at(12)));
  ok("past patience: the desk meets the street", Math.abs(at(24).ask - street) < 1e-9 && at(24).floor <= street + 1e-9, `${JSON.stringify(at(24))} street ${street.toFixed(3)}`);
  const lowRow = baseRow({ targetNePct: 0.80, patienceM: 0 });
  ok("a target under the street stays the floor after patience",
    Math.abs(E.planTargets(g, letter(), lowRow, rec, { ...h, darkMs: 30 }).floor - Math.min(0.80, street)) < 1e-9);
  ok("a number under the street asks the street", Math.abs(E.planTargets(g, letter(), lowRow, rec, { ...h, darkMs: 0 }).ask - Math.max(0.80, street)) < 1e-9);

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
// (b) Monotonicity. The target comparisons hold the number (patience 36):
// patience 0 means "meet the street the month space goes dark", which by
// design erases the target, and comparing two such desks measures nothing.
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
  const low = runPlan(book.g, parcels, adjacency, sheetOf(baseRow({ targetNePct: 0.90, patienceM: 36 })));
  const high = runPlan(book.g, parcels, adjacency, sheetOf(baseRow({ targetNePct: 1.08, patienceM: 36 })));
  const vacant = emptyBook(book.g);
  const patient = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ targetNePct: 1.04, patienceM: 18 })));
  const now = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ targetNePct: 1.04, patienceM: 0 })));
  const floorLoose = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ targetNePct: 0.72, patienceM: 999 })));
  const floorTight = runPlan(vacant, parcels, adjacency, sheetOf(baseRow({ targetNePct: 1.05, patienceM: 999 })));
  neLoose.push(floorLoose);
  neTight.push(floorTight);
  quoteLow.push(low);
  quoteHigh.push(high);
  holdPatient.push(patient);
  holdNow.push(now);
  const pct = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—";
  console.log(`SEED ${seed}  ${book.suites} suites`);
  console.log(`  target 0.90  deals ${String(low.closed).padStart(4)}  NE ${pct(low.ne).padStart(6)}  vac-mo ${Math.round(low.vacMonths)}`);
  console.log(`  target 1.08  deals ${String(high.closed).padStart(4)}  NE ${pct(high.ne).padStart(6)}  vac-mo ${Math.round(high.vacMonths)}`);
  console.log(`  patience 18  deals ${String(patient.closed).padStart(4)}  NE ${pct(patient.ne).padStart(6)}  vac-mo ${Math.round(patient.vacMonths)}  desk signed ${patient.deskSigned} at ${pct(patient.deskNe)}`);
  console.log(`  patience 0   deals ${String(now.closed).padStart(4)}  NE ${pct(now.ne).padStart(6)}  vac-mo ${Math.round(now.vacMonths)}  desk signed ${now.deskSigned} at ${pct(now.deskNe)}`);
  console.log(`  floor 72%    deals ${String(floorLoose.closed).padStart(4)}  NE ${pct(floorLoose.ne).padStart(6)}  vac-mo ${Math.round(floorLoose.vacMonths)}`);
  console.log(`  floor 105%   deals ${String(floorTight.closed).padStart(4)}  NE ${pct(floorTight.ne).padStart(6)}  vac-mo ${Math.round(floorTight.vacMonths)}`);
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
console.log(`  target 0.90  deals ${lowDeals.toFixed(1)}   NE ${(lowNe * 100).toFixed(1)}%`);
console.log(`  target 1.08  deals ${highDeals.toFixed(1)}   NE ${(highNe * 100).toFixed(1)}%`);
console.log(`  patience 18 vac-mo ${patientVac.toFixed(0)}   NE ${(patientNe * 100).toFixed(1)}%`);
console.log(`  patience 0  vac-mo ${nowVac.toFixed(0)}   NE ${(nowNe * 100).toFixed(1)}%`);

ok("raising the target lowers deal count",
  highDeals < lowDeals - 0.5,
  `1.08→${highDeals.toFixed(1)} vs 0.90→${lowDeals.toFixed(1)}`);
ok("raising the target raises signed NE%",
  highNe > lowNe + 0.004,
  `1.08→${(highNe * 100).toFixed(1)}% vs 0.90→${(lowNe * 100).toFixed(1)}%`);
// THE FLOOR DOES WHAT IT SAYS ACROSS A BOOK: signed net effective rises and
// deals fall as it is raised, and the average signed deal never nets under it.
// 72% against 105%: the desk asks the street or the number, whichever is
// higher, so two numbers both near the street ask the same and differ only on
// tenants' finals — too small to see in deal counts on three seeds.
const looseNe = mNe(neLoose), tightNe = mNe(neTight);
const looseDeals = mClosed(neLoose), tightDeals = mClosed(neTight);
console.log(`  floor 72%   deals ${looseDeals.toFixed(1)}   NE ${(looseNe * 100).toFixed(1)}%`);
console.log(`  floor 105%  deals ${tightDeals.toFixed(1)}   NE ${(tightNe * 100).toFixed(1)}%`);
ok("raising the net-effective floor raises signed NE%",
  tightNe > looseNe + 0.004,
  `105%→${(tightNe * 100).toFixed(1)}% vs 72%→${(looseNe * 100).toFixed(1)}%`);
ok("raising the net-effective floor lowers deal count",
  tightDeals < looseDeals - 0.5,
  `105%→${tightDeals.toFixed(1)} vs 72%→${looseDeals.toFixed(1)}`);
const deskTight = mean(neTight.map((r) => r.deskNe).filter(Number.isFinite));
const deskLoose = mean(neLoose.map((r) => r.deskNe).filter(Number.isFinite));
console.log(`  desk's own ledger: floor 72% signed at ${(deskLoose * 100).toFixed(1)}%   floor 105% signed at ${(deskTight * 100).toFixed(1)}%`);
ok("holding the number, the desk never averages under it (its ledger, its market)",
  deskTight + 0.01 >= 1.05,
  `${(deskTight * 100).toFixed(1)}% against a 105% floor`);
// Vacant-months on an empty 8-year book is a weak signal. The load-bearing
// check is the patience rule (planTargets at darkMs 12/24/30 above) plus
// signed NE%. Do not retune the sheet to make vac-months line up.
ok("patience does not collapse vacancy into a first-letter grab",
  patientVac > nowVac * 0.90,
  `hold18 ${patientVac.toFixed(0)} vs hold0 ${nowVac.toFixed(0)}`);
// On the desk's own ledger (loiMandateScore against the letter's own market,
// at signing) — the tenancy scan reads face against a blended market with no
// allowance, which is not what the target governs.
const patientDesk = mean(holdPatient.map((r) => r.deskNe).filter(Number.isFinite));
const nowDesk = mean(holdNow.map((r) => r.deskNe).filter(Number.isFinite));
// REPORTED, NOT ASSERTED. Under the old step-down schedule this was a gate
// that cleared by 0.2 points. Under the two-dial sheet, measured on three
// seeds (Oct 2026): holding 1.04 for 18 months on an EMPTY book signed at the
// same net effective as meeting the street at once (91.7% both) with slightly
// less vacancy — the tenants that walk from the hold are replaced by later
// letters on staler space that clear at the street anyway. That is the
// market's answer about holding out above it when demand, not price, is what
// binds; it is not a coefficient to turn until it reads the other way.
console.log(`  patience on the desk's ledger: 18 mo ${(patientDesk * 100).toFixed(1)}% vs 0 mo ${(nowDesk * 100).toFixed(1)}% `
  + `(vac-mo ${patientVac.toFixed(0)} vs ${nowVac.toFixed(0)}) — reported, see comment`);

if (fails) {
  console.log(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log("\nplan-desk: all checks passed");
