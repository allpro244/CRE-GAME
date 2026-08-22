// QUALITY CHANNELS — decompose rent and service recovery.
//
//   pnpm engine && pnpm quality-arms
//
// REPORT, not a gate. QUALITY_BALANCE_PLAN.md §2–3. Rank on NOI − capex and
// on rent/occ, never on terminal net worth. This file instruments the two
// hypotheses before anyone retunes a multiplier:
//
//   (a) a capital programme may be priced into rent twice — explicit
//       managedRentPsfYr ×1.04/×1.08 AND PROGRAM_LIFT on condIdx
//   (b) institutional service may be recovered from NNN tenants
//
// STANDING FACT: no playtest in this repo is based on Manhattan. Every
// harness run and number here is a GENERATED city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);

const office = bbls.find((b) => {
  const rec = parcels[b];
  return rec && rec.class === "office" && rec.bldgArea > 40_000 && rec.yearBuilt < 1960;
}) ?? bbls.find((b) => parcels[b]?.class === "office");
const rec = parcels[office];
const h = {
  bbl: office,
  boughtM: 0,
  costBasis: 10_000_000,
  loan: null,
  condition: "average",
  condIdx: 0.70,
  tenants: [],
  cfHistory: [],
  programsDone: {},
};

const idx = g.econ.rentIdx.office;
const base = E.managedRentPsfYr(rec, g.econ, { ...h, programsDone: {} });
const condHi = E.condGrade(Math.min(0.97, 0.70 + (E.PROGRAM_LIFT.lobby ?? 0) + (E.PROGRAM_LIFT.facade ?? 0)));
const afterLift = E.managedRentPsfYr(rec, g.econ, { ...h, condition: condHi, condIdx: 0.70 + 0.08 + 0.21, programsDone: {} });
const afterExplicit = E.managedRentPsfYr(rec, g.econ, { ...h, programsDone: { lobby: 1, facade: 1 } });
const both = E.managedRentPsfYr(rec, g.econ, {
  ...h, condition: condHi, condIdx: 0.70 + 0.08 + 0.21, programsDone: { lobby: 1, facade: 1 },
});

console.log("\nQUALITY ARMS — rent decomposition (generated city)\n");
console.log(`parcel ${rec.address}  ${rec.yearBuilt}  ${rec.bldgArea} sf  index $${idx.toFixed(2)}`);
console.log(`baseline managed rent          $${base.toFixed(2)}  (${(base / idx).toFixed(3)}× index)`);
console.log(`condition lift only            $${afterLift.toFixed(2)}  (${(afterLift / base).toFixed(3)}× baseline)  grade ${condHi}`);
console.log(`programmes flag, no cond lift  $${afterExplicit.toFixed(2)}  (${(afterExplicit / base).toFixed(3)}× baseline)  (1.000× after dropping the explicit multipliers)`);
console.log(`both channels                  $${both.toFixed(2)}  (${(both / base).toFixed(3)}× baseline)`);
const double = both / afterLift - 1;
console.log(`explicit on top of condition   +${(double * 100).toFixed(1)}%  — ${double > 0.02 ? "SAME CHEQUE TWICE" : "condition owns price"}`);

// Service recovery: letters only land on a deed you hold. Stamp one office,
// tick two years, count recoveryOf (not the legacy net flag — new letters
// set both, and recovery wins). Office rollRecovery is 30% nnn / 58% base /
// 12% gross. The owner's "~80% net" is the legacy flag in leasing.ts.
let gTick = g;
const stamp = bbls.find((b) => parcels[b]?.class === "office" && (parcels[b]?.bldgArea ?? 0) > 40_000);
if (stamp && !gTick.holdings[stamp]) {
  gTick.holdings[stamp] = {
    bbl: stamp, boughtM: 0, costBasis: 10_000_000, loan: null,
    condition: "average", condIdx: 0.70, tenants: [], cfHistory: [],
    programsDone: {}, service: 1,
  };
}
for (let i = 0; i < 24; i++) gTick = E.advanceMonth(gTick, parcels, bbls, {});
const recCounts = { nnn: 0, base: 0, gross: 0 };
let tot = 0, legacyNet = 0;
const tally = (t) => {
  tot++;
  const k = E.recoveryOf(t);
  recCounts[k] = (recCounts[k] ?? 0) + 1;
  if (t.net) legacyNet++;
};
for (const h0 of Object.values(gTick.holdings)) {
  if ((parcels[h0.bbl]?.class) !== "office") continue;
  for (const t of h0.tenants ?? []) tally(t);
}
for (const loi of gTick.lois ?? []) {
  if (loi.use !== "office") continue;
  tally(loi);
}
const mktOpex = E.opexPsf("office", g.econ, false, 0);
const instOpex = E.opexPsf("office", g.econ, false, 1);
const recovOpex = E.opexPsf("office", g.econ, false, E.recoverableService(1));
console.log("\nInstitutional service — recoverable vs spent (office, generated city)");
console.log(`  market opex $${mktOpex.toFixed(2)}/sf`);
console.log(`  institutional opex $${instOpex.toFixed(2)}/sf  (+${((instOpex / mktOpex - 1) * 100).toFixed(1)}%)`);
console.log(`  NNN recovers $${recovOpex.toFixed(2)}/sf  (landlord eats $${(instOpex - recovOpex).toFixed(2)}/sf)`);

console.log("\nOffice recovery clauses after 24 months on one stamped deed");
if (!tot) {
  console.log("  no letters on a stamped empty deed (inbound path wants a purchased roll)");
  console.log("  source draw, leasing.ts rollRecovery(office): 30% nnn / 58% base / 12% gross");
  console.log("  source draw, legacy net flag: 80%  — recoveryOf reads recovery first");
} else {
  const pct = (n) => ((n / tot) * 100).toFixed(0);
  console.log(`  recoveryOf  nnn ${recCounts.nnn} (${pct(recCounts.nnn)}%)  base ${recCounts.base} (${pct(recCounts.base)}%)  gross ${recCounts.gross} (${pct(recCounts.gross)}%)  of ${tot}`);
  console.log(`  legacy net flag ${legacyNet} of ${tot} (${pct(legacyNet)}%)  — not what recoveryOf reads`);
}
console.log("Above-market service is an unrecovered amenity. OPS_SERVICE untouched.\n");

// ---------------------------------------------------------------------------
// Six arms, paired seeds. QUALITY_BALANCE_PLAN.md step 0.
// Rank on NOI − capex, rent ÷ index, occupancy. Never terminal net worth.
// ---------------------------------------------------------------------------
const ARM_YEARS = Number(process.env.YEARS ?? 25);
const ARM_SEEDS = (process.env.SEEDS ?? "550991,12007,73303,4242,91117,20603").split(",").map(Number);
const N_BLDG = Number(process.env.N ?? 8);
const DO_LEVERED = process.env.LEVERED !== "0";
const LEV_YEARS = Number(process.env.LEV_YEARS ?? 15);
const LEV_SEEDS = ARM_SEEDS.slice(0, Number(process.env.LEV_SEEDS ?? 3));

const ARMS = [
  { id: "strip",         label: "strip — defer, lean",     service: -1, plan: 0, programs: false, gut: false },
  { id: "baseline",      label: "baseline — fund, market", service:  0, plan: 1, programs: false, gut: false },
  { id: "institutional", label: "institutional service",   service:  1, plan: 1, programs: false, gut: false },
  { id: "reposition",    label: "reposition plan",         service:  0, plan: 2, programs: false, gut: false },
  { id: "programs",      label: "capital programs",        service:  0, plan: 1, programs: true,  gut: false },
  { id: "gut",           label: "gut when eligible",       service:  0, plan: 1, programs: false, gut: true  },
];

const offices = bbls.filter((b) => {
  const r = parcels[b];
  return r && r.class === "office" && r.bldgArea > 25_000 && r.yearBuilt < 1990;
}).slice(0, N_BLDG);

function buyBook(seed) {
  let g = E.firstListings(E.newGame(seed, parcels, 5e9), parcels, bbls);
  const owned = [];
  for (const b of offices) {
    const rec = E.resolveRec(parcels, g, b);
    if (!rec) continue;
    const px = E.assetValue(rec, g.econ, E.initialCondition(rec));
    g.cash = 5e9;
    const r = E.executePurchase(g, parcels, b, Math.round(px), "cash", true, 1);
    if (!r.err) { g = r.s; owned.push(b); }
  }
  return { g, owned };
}

function leverBook(g0, owned) {
  let g = g0;
  for (const bbl of owned) {
    const { quotes } = E.refiQuotes(g, parcels, bbl);
    const q = quotes.find((x) => x.available && x.maxProceeds > 0);
    if (!q) continue;
    const r = E.refinance(g, parcels, bbl, q.id, 1);
    if (!r.err) g = r.s;
  }
  return g;
}

function kickPrograms(g0, owned) {
  let g = g0;
  for (const bbl of owned) {
    const h = g.holdings[bbl];
    if (!h || h.program) continue;
    for (const id of ["lobby", "systems", "facade"]) {
      const r = E.startProgram(g, parcels, bbl, id);
      if (!r.err) { g = r.s; break; }
    }
  }
  return g;
}

function kickGut(g0, owned) {
  let g = g0;
  for (const bbl of owned) {
    const r = E.startRenovation(g, parcels, bbl);
    if (!r.err) g = r.s;
  }
  return g;
}

function acceptOurs(g0, owned) {
  let g = g0;
  const set = new Set(owned);
  for (const loi of [...(g.lois ?? [])]) {
    if (!set.has(loi.bbl)) continue;
    const r = E.respondLOI(g, parcels, loi.id, "accept");
    if (!r.err) g = r.s;
  }
  return g;
}

function sampleBook(g, owned) {
  let rent = 0, idx = 0, occN = 0, occD = 0, n = 0;
  for (const bbl of owned) {
    const h = g.holdings[bbl];
    const rec = E.resolveRec(parcels, g, bbl);
    if (!h || !rec || !rec.bldgArea) continue;
    const ask = E.managedRentPsfYr(rec, g.econ, h);
    const ix = g.econ.rentIdx[rec.class] ?? 0;
    if (ix > 0) { rent += ask; idx += ix; n++; }
    const let_ = (h.tenants ?? []).reduce((a, t) => a + (t.sf ?? 0), 0);
    occN += let_;
    occD += rec.bldgArea;
  }
  return { rentRatio: n && idx ? rent / idx : 0, occ: occD ? occN / occD : 0 };
}

function booksSum(g, key) {
  return (g.books ?? []).reduce((a, y) => a + (y[key] ?? 0), 0);
}

function runArm(g0, owned, spec, years) {
  let g = E.cloneState(g0);
  g = E.setOpsPolicy(g, { service: spec.service, plan: spec.plan, stance: 0 });
  const rents = [], occs = [];
  for (let m = 0; m < years * 12; m++) {
    if (spec.programs) g = kickPrograms(g, owned);
    if (spec.gut) g = kickGut(g, owned);
    g = E.advanceMonth(g, parcels, bbls, {});
    g = acceptOurs(g, owned);
    if (m >= 12 && m % 12 === 11) {
      const s = sampleBook(g, owned);
      rents.push(s.rentRatio);
      occs.push(s.occ);
    }
  }
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  return {
    rent: mean(rents),
    occ: mean(occs),
    noi: booksSum(g, "noi"),
    capex: booksSum(g, "capex"),
  };
}

function printArmTable(title, bySeed) {
  const ids = ARMS.map((a) => a.id);
  const mean = (id, key) => {
    const xs = bySeed.map((s) => s[id]?.[key]).filter((x) => Number.isFinite(x));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  console.log(`\n${title}\n`);
  console.log("arm                    rent÷idx   occ     NOI      capex   NOI−capex");
  for (const a of ARMS) {
    const noi = mean(a.id, "noi"), cap = mean(a.id, "capex");
    console.log(
      `${a.label.padEnd(22)}  ${(mean(a.id, "rent")).toFixed(2).padStart(5)}   `
      + `${(mean(a.id, "occ") * 100).toFixed(0).padStart(3)}%  `
      + `$${(noi / 1e6).toFixed(0).padStart(4)}M  $${(cap / 1e6).toFixed(0).padStart(4)}M  `
      + `$${((noi - cap) / 1e6).toFixed(0).padStart(5)}M`,
    );
  }
  console.log("\nPer-seed NOI − capex vs baseline ($M)  — believe an effect on 5 of 6");
  const head = "seed      " + ARMS.filter((a) => a.id !== "baseline").map((a) => a.id.padStart(14)).join("");
  console.log(head);
  const wins = Object.fromEntries(ARMS.map((a) => [a.id, 0]));
  for (const row of bySeed) {
    const base = (row.baseline.noi - row.baseline.capex) / 1e6;
    let line = String(row.seed).padEnd(10);
    for (const a of ARMS) {
      if (a.id === "baseline") continue;
      const d = (row[a.id].noi - row[a.id].capex) / 1e6 - base;
      if (d > 0) wins[a.id]++;
      line += (d >= 0 ? "+" : "") + d.toFixed(1).padStart(13);
    }
    console.log(line);
  }
  console.log("beats base " + ARMS.filter((a) => a.id !== "baseline").map((a) => `${wins[a.id]}/${bySeed.length}`.padStart(14)).join(""));
  console.log("Never rank on terminal net worth. Per-seed cycle timing is wider than the arm gaps.\n");
}

console.log(`QUALITY ARMS — ${ARM_SEEDS.length} seeds × ${ARM_YEARS}y × ${offices.length} offices, unlevered, letters at asking (generated city)`);
const unlev = [];
for (const seed of ARM_SEEDS) {
  const { g, owned } = buyBook(seed);
  console.log(`  seed ${seed}: bought ${owned.length}`);
  const row = { seed };
  for (const a of ARMS) row[a.id] = runArm(g, owned, a, ARM_YEARS);
  unlev.push(row);
}
printArmTable(`UNLEVERED  ${ARM_SEEDS.length} seeds × ${ARM_YEARS} years`, unlev);

if (DO_LEVERED) {
  console.log(`LEVERED follow-up — max advance the desk will actually write, ${LEV_SEEDS.length} seeds × ${LEV_YEARS}y`);
  const lev = [];
  for (const seed of LEV_SEEDS) {
    const bought = buyBook(seed);
    const g = leverBook(bought.g, bought.owned);
    console.log(`  seed ${seed}: bought ${bought.owned.length}, then took the desk's max`);
    const row = { seed };
    for (const a of ARMS) row[a.id] = runArm(g, bought.owned, a, LEV_YEARS);
    lev.push(row);
  }
  printArmTable(`LEVERED  ${LEV_SEEDS.length} seeds × ${LEV_YEARS} years — max LTV the quote path allows, not a forced 60%`, lev);
}
