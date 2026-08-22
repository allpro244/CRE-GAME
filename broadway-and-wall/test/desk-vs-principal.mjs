// DESK VS PATIENT PRINCIPAL — the number the leasing overhaul exists to move.
//
//   pnpm engine && pnpm desk-vs-principal
//   SEEDS=11,22 HZ=120 pnpm desk-vs-principal
//
// Phase 0 of LEASING_OVERHAUL_PLAN.md. No engine change. Two policies, one
// book, paired seeds, ten years:
//
//   desk        firm agent on, default mandate (floor 90%, AGENT_FLOOR_MAX = 1.00)
//   principal   counters every letter to tenantIndifferenceMult; the rest walk
//
// Same starting 100-suite commercial book on both arms (gifted, not bought —
// the fixture is the portfolio, not an acquisition strategy). Record signed
// net-effective as a share of market, vacancy-months burned, and net income.
//
// THE 4% FLOOR is not patched out of the engine here. That would be an engine
// change, and this phase forbids one. Instead every principal counter records
// the accept probability the engine will actually draw (floor 0.04) and the
// same logistic with only the 0.005 numerical guard. The gap is the exploit
// share of THIS strategy, measured on the letters that arrived. A farming
// ask at 1.20 × market is printed as a diagnostic on the same stream — that
// is the strategy the floor is rumoured to subsidise, and it is not the
// bot this harness runs.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,11,4242").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 120);
const TARGET_SUITES = Number(process.env.SUITES ?? 100);
const OPERATING_CASH = 80e6;

const NAT = { multifamily: 0.045, retail: 0.085, industrial: 0.07, office: 0.115 };
const W_ACCEPT = 0.085;
const P_FLOOR = 0.04;
const P_GUARD = 0.005;
const FARM_MULT = 1.20;

const money = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${n < 0 ? "−" : ""}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${n < 0 ? "−" : ""}$${(a / 1e3).toFixed(0)}k`;
  return `${n < 0 ? "−" : ""}$${a.toFixed(0)}`;
};
const pct = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—";
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

const tightOf = (g, use) => {
  const u = use ?? "office";
  const vac = g.econ.cityVac?.[u] ?? 0.1;
  const nat = NAT[u] ?? NAT.office;
  return Math.max(-0.3, Math.min(0.35, (nat - vac) * 3));
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
  let vacant = 0, total = 0, vacantSf = 0, totalSf = 0;
  for (const [bbl, h] of Object.entries(g.holdings ?? {})) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec || !E.isCommercial(rec)) continue;
    const st = E.unitStatus(rec, h, g.month);
    for (const row of st.byUse ?? []) {
      if (row.use === "multifamily") continue;
      vacant += row.vacant;
      total += row.total;
      vacantSf += row.vacant * row.sfPer;
      totalSf += row.total * row.sfPer;
    }
  }
  return { vacant, total, vacantSf, totalSf };
};

const bookNoi = (g) => (g.books ?? []).reduce((a, y) => a + (y.noi ?? 0), 0);

const pAcceptOf = (f, fStar, bestFinal = false) => {
  const logistic = 1 / (1 + Math.exp((f - fStar) / W_ACCEPT)) + (bestFinal ? 0.05 : 0);
  return {
    logistic,
    withFloor: Math.max(P_FLOOR, Math.min(0.95, logistic)),
    noFloor: Math.max(P_GUARD, Math.min(0.95, logistic)),
  };
};

/** Rent / package that puts landlord NE on the tenant's indifference multiple. No par cap. */
const indifferenceTerms = (loi, market, fStar) => {
  const years = Math.max(1, loi.termM / 12);
  const tiPsf = loi.tiPsf ?? 0;
  const freeM = loi.freeM ?? 0;
  const bumpPct = E.bumpOf(loi);
  const paid = 1 - Math.min(0.45, freeM / Math.max(1, loi.termM));
  const openTi = loi.openTiPsf ?? loi.tiPsf ?? 0;
  let rentPsf = market * fStar;
  for (let i = 0; i < 6; i++) {
    const bumpPrem = E.bumpPremiumPsf(rentPsf, bumpPct, loi.termM);
    const need = fStar * market - (E.TI_VALUE * (openTi - tiPsf)) / years - bumpPrem;
    rentPsf = paid > 0.05 ? need / paid : need;
  }
  return {
    rentPsf: +Math.max(1, rentPsf).toFixed(2),
    tiPsf,
    freeM,
    bumpPct,
    termM: loi.termM,
  };
};

const scoreOf = (loi, market, terms) => {
  const probe = { ...loi, ...terms };
  return E.netEffectivePsf(probe, terms.rentPsf, terms.tiPsf, terms.freeM, terms.bumpPct)
    / Math.max(1, market);
};

/**
 * Gift a commercial book. Buying would spend world-stream RNG on closings and
 * make the two arms' starting cities depend on who listed what. genRentRoll
 * uses the private per-parcel stream and restores it, so this does not re-roll
 * the century. clearRivalClaims drops the street's claim so the building is
 * not ticked twice.
 */
const takeBook = (g0, parcels, target) => {
  const g = structuredClone(g0);
  g.cash = Math.max(g.cash, OPERATING_CASH);
  let suites = 0;
  const buildings = [];
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
      svcIdx: 0.55, // SVC_START — types.ts is not on the harness bundle
      tenants: [],
      cfHistory: [],
    };
    E.genRentRoll(g, rec, holding, false, true);
    g.holdings[rec.bbl] = holding;
    E.clearRivalClaims(g, rec.bbl);
    g.listings = (g.listings ?? []).filter((l) => l.bbl !== rec.bbl);
    if (g.approaches) delete g.approaches[rec.bbl];
    suites += n;
    buildings.push(rec.bbl);
    if (suites >= target) break;
  }
  return { g, suites, buildings: buildings.length };
};

const patientPrincipal = (g, parcels, stats, onlyReferred = false) => {
  const letters = [...(g.lois ?? [])].filter((l) => !onlyReferred || l.referred);
  for (const loi of letters) {
    if (!(g.lois ?? []).some((l) => l.id === loi.id)) continue;
    const rec = E.resolveRec(parcels, g, loi.bbl);
    const h = g.holdings[loi.bbl];
    if (!rec || !h) continue;
    const market = E.managedRentPsfYr(rec, g.econ, h, loi.use);
    const tight = tightOf(g, loi.use);
    const fStar = E.tenantIndifferenceMult(g, loi, loi.termM, tight);
    const opened = {
      rentPsf: loi.rentPsf,
      tiPsf: loi.tiPsf ?? 0,
      freeM: loi.freeM ?? 0,
      bumpPct: E.bumpOf(loi),
      termM: loi.termM,
    };
    const openScore = scoreOf(loi, market, opened);
    stats.letters += 1;
    if (tight > 0.02) stats.tightLetters += 1;
    else stats.softLetters += 1;

    if (openScore + 0.005 >= fStar) {
      const r = E.respondLOI(g, parcels, loi.id, "accept");
      if (!r.err) {
        g = r.s;
        stats.accepted += 1;
        stats.signed += 1;
        stats.signedNe += openScore;
        stats.signedSf += loi.sf;
        if (tight > 0.02) { stats.tightSigned += 1; stats.tightNe += openScore; }
        else { stats.softSigned += 1; stats.softNe += openScore; }
      }
      continue;
    }

    const terms = indifferenceTerms(loi, market, fStar);
    const f = scoreOf(loi, market, terms);
    const p = pAcceptOf(f, fStar, false);
    const farm = pAcceptOf(FARM_MULT, fStar, false);
    stats.countered += 1;
    stats.pFloor += p.withFloor;
    stats.pNoFloor += p.noFloor;
    stats.pFarmFloor += farm.withFloor;
    stats.pFarmNoFloor += farm.noFloor;
    if (p.logistic < P_FLOOR - 1e-9) stats.floorBinds += 1;

    const r = E.respondLOI(g, parcels, loi.id, "counter", false, terms);
    if (r.err) continue;
    g = r.s;
    if (/took your counter/i.test(r.msg)) {
      stats.signed += 1;
      stats.signedNe += f;
      stats.signedSf += loi.sf;
      if (tight > 0.02) { stats.tightSigned += 1; stats.tightNe += f; }
      else { stats.softSigned += 1; stats.softNe += f; }
    } else if (/walked/i.test(r.msg)) {
      stats.walked += 1;
    }
  }
  return g;
};

const tenantKey = (bbl, t) => `${bbl}|${t.name}|${t.startM}`;

const snapTenants = (g) => {
  const m = new Map();
  for (const [bbl, h] of Object.entries(g.holdings ?? {})) {
    for (const t of h.tenants ?? []) m.set(tenantKey(bbl, t), { bbl, t: { ...t } });
  }
  return m;
};

/** Headline signed NE for BOTH arms. TI is not stored on the tenant, so this
 *  is face after free months and the bump — the same missing-TI bias on each
 *  side. The principal's letter-level `signedNe` still includes TI. */
const recordClosings = (g, parcels, prev, stats) => {
  const now = snapTenants(g);
  for (const [k, { bbl, t }] of now) {
    const rec = E.resolveRec(parcels, g, bbl);
    const h = g.holdings[bbl];
    if (!rec || !h) continue;
    const old = prev.get(k);
    const isNew = t.startM === g.month && !old;
    // A bump moves rentPsf on the anniversary. That is not a signing.
    const isRenew = !!old && old.t.endM !== t.endM;
    if (!isNew && !isRenew) continue;
    const market = E.managedRentPsfYr(rec, g.econ, h, t.use);
    const tight = tightOf(g, t.use);
    const origin = isNew ? t.startM : g.month;
    const termM = Math.max(12, t.endM - origin);
    const freeM = t.freeUntilM ? Math.max(0, t.freeUntilM - origin) : 0;
    const ne = E.netEffectivePsf(
      { termM, tiPsf: 0, freeM, rentPsf: t.rentPsf, bumpPct: E.bumpOf(t) },
      t.rentPsf, 0, freeM, E.bumpOf(t),
    );
    const score = ne / Math.max(1, market);
    stats.closed += 1;
    stats.closedNe += score;
    stats.closedFace += t.rentPsf / Math.max(1, market);
    if (tight > 0.02) { stats.tightClosed += 1; stats.tightClosedNe += score; }
    else { stats.softClosed += 1; stats.softClosedNe += score; }
  }
  return now;
};

const freshStats = () => ({
  letters: 0, tightLetters: 0, softLetters: 0,
  accepted: 0, countered: 0, walked: 0, signed: 0,
  signedNe: 0, signedSf: 0,
  tightSigned: 0, tightNe: 0, softSigned: 0, softNe: 0,
  closed: 0, closedNe: 0, closedFace: 0,
  tightClosed: 0, tightClosedNe: 0, softClosed: 0, softClosedNe: 0,
  pFloor: 0, pNoFloor: 0, pFarmFloor: 0, pFarmNoFloor: 0, floorBinds: 0,
  vacMonths: 0, vacSfMonths: 0, suiteMonths: 0,
  tightMonths: 0, softMonths: 0,
  deskSigned: 0, deskPassed: 0, deskReferred: 0, deskWalked: 0, deskCountered: 0,
  referredHandled: 0,
});

const runArm = (g0, parcels, adj, policy) => {
  let g = structuredClone(g0);
  const stats = freshStats();
  if (policy === "desk") {
    g.agent = true;
    delete g.agentFloor;
    delete g.agentPassBelow;
    g = structuredClone(g);
    E.workLeasingDesk(g, parcels);
  } else {
    g.agent = false;
    delete g.teamLeasing;
    delete g.renewalMgmt;
  }

  let prevTenants = snapTenants(g);
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: Math.max(g.cash, OPERATING_CASH) };
    g.cash = Math.max(g.cash, 5e6);
    g = E.advanceQuarter(g, parcels, bbls, adj);
    const vac = vacantSuites(g, parcels);
    stats.vacMonths += vac.vacant;
    stats.vacSfMonths += vac.vacantSf;
    stats.suiteMonths += vac.total;
    const officeTight = tightOf(g, "office");
    if (officeTight > 0.02) stats.tightMonths += 1;
    else stats.softMonths += 1;

    if (policy === "desk") {
      const card = E.deskMonthNow(g);
      if (card) {
        stats.deskSigned += card.signed;
        stats.deskPassed += card.passed;
        stats.deskReferred += card.referred;
        stats.deskWalked += card.walked;
        stats.deskCountered += card.countered;
      }
      // Referred letters are the principal's remaining job under the current
      // product. Handle them with the same indifference rule so the desk arm
      // measures "desk + exceptions", not "desk plus three months of rot".
      const referred = (g.lois ?? []).filter((l) => l.referred);
      if (referred.length) {
        const before = stats.signed;
        g = patientPrincipal(g, parcels, stats, true);
        stats.referredHandled += stats.signed - before;
      }
    } else {
      g = patientPrincipal(g, parcels, stats);
    }
    prevTenants = recordClosings(g, parcels, prevTenants, stats);
  }
  return { g, stats };
};

const summarise = (label, start, end, stats) => {
  const ne = stats.closed ? stats.closedNe / stats.closed : NaN;
  const face = stats.closed ? stats.closedFace / stats.closed : NaN;
  const letterNe = stats.signed ? stats.signedNe / stats.signed : NaN;
  const tightNe = stats.tightClosed ? stats.tightClosedNe / stats.tightClosed : NaN;
  const softNe = stats.softClosed ? stats.softClosedNe / stats.softClosed : NaN;
  const vacRate = stats.suiteMonths ? stats.vacMonths / stats.suiteMonths : NaN;
  const noi = bookNoi(end) - bookNoi(start);
  const counters = stats.countered;
  return {
    label,
    signed: stats.closed,
    letterSigned: stats.signed,
    ne,
    face,
    letterNe,
    tightNe,
    softNe,
    tightSigned: stats.tightSigned,
    softSigned: stats.softSigned,
    vacMonths: stats.vacMonths,
    vacRate,
    noi,
    cash: end.cash - start.cash,
    letters: stats.letters,
    accepted: stats.accepted,
    countered: counters,
    walked: stats.walked,
    pFloor: counters ? stats.pFloor / counters : NaN,
    pNoFloor: counters ? stats.pNoFloor / counters : NaN,
    pFarmFloor: counters ? stats.pFarmFloor / counters : NaN,
    pFarmNoFloor: counters ? stats.pFarmNoFloor / counters : NaN,
    floorBindRate: counters ? stats.floorBinds / counters : NaN,
    deskSigned: stats.deskSigned,
    deskReferred: stats.deskReferred,
    referredHandled: stats.referredHandled,
    tightMonths: stats.tightMonths,
    softMonths: stats.softMonths,
  };
};

console.log("\nDESK VS PATIENT PRINCIPAL — Phase 0, no engine change");
console.log(`  seeds ${SEEDS.join(", ")} · ${HZ} months · target ${TARGET_SUITES} commercial suites`);
console.log("  desk = default mandate (floor 90%, cap at par)");
console.log("  principal = counter every letter to tenantIndifferenceMult");
console.log("  signed NE% is face after free months and the bump; TI is not on the tenant\n");

const rows = [];
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  const raw = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const book = takeBook(raw, parcels, TARGET_SUITES);
  if (book.suites < TARGET_SUITES * 0.8) {
    console.log(`  SEED ${seed}  SKIP  only ${book.suites} commercial suites available`);
    continue;
  }
  const startVac = vacantSuites(book.g, parcels);
  const desk = runArm(book.g, parcels, adjacency, "desk");
  const princ = runArm(book.g, parcels, adjacency, "principal");
  const d = summarise("desk", book.g, desk.g, desk.stats);
  const p = summarise("principal", book.g, princ.g, princ.stats);
  rows.push({ seed, suites: book.suites, buildings: book.buildings, startVac, desk: d, princ: p });

  console.log(`SEED ${seed}  ${book.buildings} bldgs / ${book.suites} suites`
    + `  start vacant ${startVac.vacant}/${startVac.total}`
    + `  office vac ${(book.g.econ.cityVac?.office ?? 0) * 100 | 0}%`);
  const line = (tag, s) =>
    `  ${tag.padEnd(10)}  signed ${String(s.signed).padStart(4)}`
    + `  NE ${pct(s.ne).padStart(6)}`
    + `  tight NE ${pct(s.tightNe).padStart(6)}`
    + `  soft NE ${pct(s.softNe).padStart(6)}`
    + `  vac-mo ${String(Math.round(s.vacMonths)).padStart(5)}`
    + `  vac ${pct(s.vacRate).padStart(6)}`
    + `  NOI ${money(s.noi).padStart(9)}`;
  console.log(line("desk", d));
  console.log(line("principal", p)
    + (Number.isFinite(p.letterNe) ? `  letter-NE(with TI) ${pct(p.letterNe)}` : ""));
  const gapNe = p.ne - d.ne;
  const gapNoi = p.noi - d.noi;
  const gapVac = p.vacMonths - d.vacMonths;
  console.log(`  gap        principal − desk   NE ${gapNe >= 0 ? "+" : ""}${pct(gapNe)}`
    + `   vac-mo ${gapVac >= 0 ? "+" : ""}${Math.round(gapVac)}`
    + `   NOI ${gapNoi >= 0 ? "+" : ""}${money(gapNoi)}`);
  if (p.countered) {
    const lift = p.pFloor - p.pNoFloor;
    const share = p.pFloor > 0 ? lift / p.pFloor : 0;
    console.log(`  floor      principal counters ${p.countered}`
      + `  E[p|floor] ${pct(p.pFloor)}  E[p|0.005] ${pct(p.pNoFloor)}`
      + `  bind ${pct(p.floorBindRate)}  exploit share of E[p] ${pct(share)}`);
    console.log(`  farm 1.20× E[p|floor] ${pct(p.pFarmFloor)}  E[p|0.005] ${pct(p.pFarmNoFloor)}`
      + `  (diagnostic — this bot does not ask 1.20×)`);
  }
  if (d.deskSigned || d.deskReferred) {
    console.log(`  desk card  signed ${d.deskSigned}  referred ${d.deskReferred}`
      + `  principal-on-referral signed ${d.referredHandled}`);
  }
  console.log("");
}

if (!rows.length) {
  console.log("no seeds produced a book — nothing measured");
  process.exit(1);
}

const col = (pick) => rows.map(pick).filter((x) => Number.isFinite(x));
const deskNe = mean(col((r) => r.desk.ne));
const princNe = mean(col((r) => r.princ.ne));
const deskTight = mean(col((r) => r.desk.tightNe));
const princTight = mean(col((r) => r.princ.tightNe));
const deskSoft = mean(col((r) => r.desk.softNe));
const princSoft = mean(col((r) => r.princ.softNe));
const deskVac = mean(col((r) => r.desk.vacMonths));
const princVac = mean(col((r) => r.princ.vacMonths));
const deskNoi = mean(col((r) => r.desk.noi));
const princNoi = mean(col((r) => r.princ.noi));
const deskSigned = mean(col((r) => r.desk.signed));
const princSigned = mean(col((r) => r.princ.signed));
const pFloor = mean(col((r) => r.princ.pFloor));
const pNoFloor = mean(col((r) => r.princ.pNoFloor));
const farmFloor = mean(col((r) => r.princ.pFarmFloor));
const farmNo = mean(col((r) => r.princ.pFarmNoFloor));
const bind = mean(col((r) => r.princ.floorBindRate));

console.log("PAIRED MEANS");
console.log("────────────────────────────────────────────────────────────────────────");
console.log("                  desk        principal   principal − desk");
console.log(`  signed NE%      ${pct(deskNe).padStart(8)}    ${pct(princNe).padStart(8)}    ${((princNe - deskNe) >= 0 ? "+" : "") + pct(princNe - deskNe)}`);
console.log(`  tight NE%       ${pct(deskTight).padStart(8)}    ${pct(princTight).padStart(8)}    ${((princTight - deskTight) >= 0 ? "+" : "") + pct(princTight - deskTight)}`);
console.log(`  soft NE%        ${pct(deskSoft).padStart(8)}    ${pct(princSoft).padStart(8)}    ${((princSoft - deskSoft) >= 0 ? "+" : "") + pct(princSoft - deskSoft)}`);
console.log(`  deals / seed    ${deskSigned.toFixed(1).padStart(8)}    ${princSigned.toFixed(1).padStart(8)}    ${(princSigned - deskSigned >= 0 ? "+" : "") + (princSigned - deskSigned).toFixed(1)}`);
console.log(`  vac-months      ${deskVac.toFixed(0).padStart(8)}    ${princVac.toFixed(0).padStart(8)}    ${(princVac - deskVac >= 0 ? "+" : "") + (princVac - deskVac).toFixed(0)}`);
console.log(`  10y NOI         ${money(deskNoi).padStart(8)}    ${money(princNoi).padStart(8)}    ${(princNoi - deskNoi >= 0 ? "+" : "") + money(princNoi - deskNoi)}`);
console.log("");
console.log("4% pAccept FLOOR — on the principal's actual counters (not an engine patch)");
console.log(`  E[pAccept] with 0.04 floor     ${pct(pFloor)}`);
console.log(`  E[pAccept] with 0.005 guard    ${pct(pNoFloor)}`);
console.log(`  floor bind rate                ${pct(bind)}`);
console.log(`  exploit share of E[p]          ${pct(pFloor > 0 ? (pFloor - pNoFloor) / pFloor : 0)}`);
console.log(`  farming 1.20× with floor       ${pct(farmFloor)}   without ${pct(farmNo)}   (diagnostic)`);
console.log("");

const princBeatsDeskTight = Number.isFinite(princTight) && Number.isFinite(deskTight) && princTight > deskTight + 0.005;
const princBeatsDesk = Number.isFinite(princNe) && Number.isFinite(deskNe) && princNe > deskNe + 0.005;
const exploitShare = pFloor > 0 ? (pFloor - pNoFloor) / pFloor : 0;
console.log("READ AGAINST THE PLAN'S EXPECTED FINDING");
console.log(`  bot beats desk on signed NE%                 ${princBeatsDesk ? "YES" : "NO"}  (${pct(princNe)} vs ${pct(deskNe)})`);
console.log(`  bot beats desk in tight months               ${princBeatsDeskTight ? "YES" : "NO"}  (${pct(princTight)} vs ${pct(deskTight)})`);
console.log(`  a large share of that edge is the 4% floor   ${exploitShare > 0.15 ? "YES" : "NO"}  (exploit share of E[p] ${pct(exploitShare)})`);
if (exploitShare <= 0.15) {
  console.log("  The patient-principal bot counters TO indifference, where the");
  console.log("  logistic is ~0.50 and the 0.04 floor does not bind. The floor's");
  console.log("  subsidy shows up on the farming 1.20× diagnostic, not on this bot.");
}
console.log("");
