// C. LEASING MICROSTRUCTURE — tests 6-10.
//
//   node test/stress/C-leasing.mjs
//   SEEDS=550991,12007 HZ=240 node test/stress/C-leasing.mjs      a cheap pass
//   SEEDS=550991,12007,73303,11,22 HZ=600 node test/stress/C-leasing.mjs
//
// The space market in market.ts is an aggregate: stock, occupied, pool,
// cityVac, four numbers per class for a whole city. The rent roll in
// leasing.ts is a list of named tenants on named parcels. Those are two
// different accounts of the same thing, and the ONLY place they are supposed
// to meet is absorption.ts — `marketRequirement` says how much space the city
// is looking for this month, and every vacant foot in town is meant to be
// competing for a share of it.
//
// This file asks whether that meeting actually happens, and then asks four
// smaller questions about the terms of the leases that come out of it:
//
//   6  TENANT POOL CONSERVATION   triple the vacant space in one submarket.
//                                 Does total leased sf triple with it?
//   7  CONCESSIONS                do free rent and TI widen in a glut while
//                                 the face rent stays sticky?
//   8  ROLLOVER RISK              a 70%-in-one-year expiry cliff landing in a
//                                 recession, against the same building on a
//                                 ladder. How much does the cliff cost?
//   9  CREDIT QUALITY             do weak covenants actually fail more in a
//                                 downturn, and does that reach VALUE?
//  10  LEASE-UP CURVES            months to 85% let, by use, by location, by
//                                 what the market was doing on delivery day.
//
// WHAT WOULD MAKE EACH ONE A FAILURE is written above each section. The verdict
// words are the audit's: WIRED, WEAK, BROKEN, BACKWARDS, EXPLOITABLE.
//
// House rules this file obeys, each of which has cost this project time before:
//   - every arm gets its OWN deep copy of the parcel table, because the table
//     is mutated in place and two arms sharing one would build each other's
//     city;
//   - `advanceQuarter` returns state UNCHANGED once gameOver is set, so every
//     loop resurrects;
//   - money is deflated by g.econ.cpi before it is compared across decades;
//   - cohorts are held CONSTANT across arms — the shared-building measurement
//     in test 6 is the same twelve buildings in both arms, not "whatever was
//     owned";
//   - and every verdict is checked against a control that says the metric CAN
//     move, because a number that cannot move is not evidence either way.
import { assertFreshBundle } from "../fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "../.engine.mjs"));
const { loadCity } = await import(join(HERE, "../city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,11").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 480);          // months for the long instrumented runs
const DEEP = process.env.DEEP === "1";

// ---------------------------------------------------------------- plumbing
const clone = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => clone(P0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const qtl = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const k = (x) => `${(x / 1000).toFixed(0)}k`;

/** Deep-pocketed, so the question is the SPACE market and never the capital one. */
const RICH = 3e9;
function keepSolvent(g) {
  if (g.gameOver) g = { ...g, gameOver: null, cash: RICH };
  if (g.cash < RICH / 6) g = { ...g, cash: RICH };
  return g;
}
/** Sign everything on the desk — so what is measured is how many prospects
 *  turn up at all, not how picky a bot is. `fund` draws the line if short. */
function signAll(g, parcels) {
  for (const loi of [...g.lois]) {
    const r = E.respondLOI(g, parcels, loi.id, "accept", true);
    if (!r.err) g = r.s;
  }
  return g;
}
function buyAndEmpty(g, parcels, bbl, { deliveredNew = false } = {}) {
  const rec = E.resolveRec(parcels, g, bbl);
  if (!rec) return { g, ok: false };
  const px = Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)));
  const r = E.executePurchase(g, parcels, bbl, px, "cash", false, 1);
  if (r.err) return { g, ok: false };
  g = r.s;
  // A BOUGHT BUILDING COMES WITH ITS ROLL, which is correct and is not what
  // these tests are about. Empty it: what gets measured is the thing a
  // developer actually lives through, a finished building with nobody in it.
  g.holdings[bbl].tenants = [];
  g.holdings[bbl].occ = 0;
  delete g.holdings[bbl].makeReady;
  // `deliveredM` is the only thing leaseFactors reads to know a building is
  // new (a 1.45x "brokers have been touring it since the steel" factor for 30
  // months). Test 10 wants both arms of that.
  if (deliveredNew) g.holdings[bbl].deliveredM = g.month;
  return { g, ok: true };
}
const leasedSf = (g, list) => list.reduce((a, b) => {
  const h = g.holdings[b];
  return a + (h ? h.tenants.reduce((x, t) => x + t.sf, 0) : 0);
}, 0);

/** Commercial buildings big enough to have a leasing problem, in one seed's city. */
function commercialStock(g, parcels, minSf = 12_000) {
  const out = [];
  for (const b of bbls) {
    const r = E.resolveRec(parcels, g, b);
    if (!r || r.class === "land" || !r.bldgArea || !E.isCommercial(r)) continue;
    if (r.bldgArea < minSf) continue;
    out.push({ bbl: b, sf: r.bldgArea, use: E.dominantUse(r), d: r.demandScore ?? 50, block: r.block });
  }
  return out;
}

const FINDINGS = [];
const note = (id, name, verdict, line) => FINDINGS.push({ id, name, verdict, line });

// ==========================================================================
// 6. TENANT POOL CONSERVATION
//
// The one that decides whether anything else here means anything. If the city
// has a finite quantity of tenant requirement, then vacant space competes for
// it: put three times as much empty space on one corner and the corner does
// not lease three times as much, it leases about the same amount spread over
// more landlords. If instead every building draws its own prospects on demand,
// leased sf scales with SUPPLY, demand is a mirage, and every development
// decision in the game is underwritten against a number that cannot say no.
//
// The experiment is paired and the cohort is constant:
//   CTRL   the player owns 12 emptied commercial buildings in one submarket
//   SHOCK  the player owns those SAME 12 plus 12 more in the same submarket
// and the reported quantity is leased sf on the SHARED TWELVE, plus the total.
//
// PASS looks like: shared-cohort leasing falls by nearly the whole of the
// supply increase, and the total is roughly flat. FAIL looks like: the total
// scales 1:1 with supply and the shared twelve barely notice.
//
// Two controls, because a null result here would otherwise be unreadable:
//   - the subject building's own `loiOdds` and `competingSf` are printed, so
//     "nothing moved" can be distinguished from "the wire is not connected";
//   - so is the change in the CITYWIDE occupied stock, which is the aggregate
//     the parcel-level rent rolls are supposed to be an account of.
// ==========================================================================
function pickCluster(g, parcels) {
  // The block with the most commercial buildings within reach, on the same
  // neighbour weights the demand surface uses — so "submarket" means here what
  // it means in absorption.ts and not something this file invented.
  const model = E.demandModel(parcels);
  const byBlock = new Map();
  for (const s of commercialStock(g, parcels)) {
    if (!byBlock.has(s.block)) byBlock.set(s.block, []);
    byBlock.get(s.block).push(s.bbl);
  }
  let best = null, bestN = -1;
  for (const [, blk] of model.blocks) {
    let n = 0;
    for (const nb of blk.neighbours) n += (byBlock.get(nb.id) ?? []).length;
    if (n > bestN) { bestN = n; best = blk; }
  }
  const out = [], seen = new Set();
  for (const nb of [...best.neighbours].sort((a, b) => b.w - a.w)) {
    for (const b of byBlock.get(nb.id) ?? []) if (!seen.has(b)) { seen.add(b); out.push(b); }
  }
  return out;
}

function test6() {
  const HZ6 = 48;
  const probeP = fresh();
  const probe = E.firstListings(E.newGame(SEEDS[0], probeP), probeP, bbls);
  const cands = pickCluster(probe, probeP);
  const SHARED = cands.slice(0, 12), EXTRA = cands.slice(12, 24);
  if (EXTRA.length < 8) { console.log("  (city too small for the supply shock — skipped)"); return; }

  function arm(seed, list) {
    const parcels = fresh();
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    g = { ...g, cash: RICH };
    const owned = [];
    for (const b of list) {
      const r = buyAndEmpty(g, parcels, b);
      if (r.ok) { g = r.g; owned.push(b); }
    }
    let vac0 = 0;
    for (const b of owned) vac0 += E.commercialSf(E.resolveRec(parcels, g, b));
    const occ0 = g.econ.occupied.office, vac0City = g.econ.cityVac.office;
    // The subject is the first shared building, and it is the same parcel in
    // both arms — the control that says the competition wire exists at all.
    const subj = owned[0];
    let odds = null;
    for (let m = 1; m <= HZ6; m++) {
      g = signAll(g, parcels);
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
      g = keepSolvent(g);
      if (m === 12) {
        const rec = E.resolveRec(parcels, g, subj), h = g.holdings[subj];
        odds = rec && h ? E.leasingOdds(g, parcels, rec, h, E.leasableUses(rec)[0]) : null;
      }
    }
    return {
      vac0, owned: owned.length,
      shared: leasedSf(g, SHARED.filter((b) => owned.includes(b))),
      all: leasedSf(g, owned),
      cityOccD: g.econ.occupied.office - occ0,
      cityVacD: g.econ.cityVac.office - vac0City,
      req: E.marketRequirement(g.econ, "office"),
      odds,
    };
  }

  const C = [], S = [];
  for (const seed of SEEDS) { C.push(arm(seed, SHARED)); S.push(arm(seed, [...SHARED, ...EXTRA])); }
  const M = (rs, f) => mean(rs.map(f));
  const vC = M(C, (r) => r.vac0), vS = M(S, (r) => r.vac0);
  const shC = M(C, (r) => r.shared), shS = M(S, (r) => r.shared);
  const tC = M(C, (r) => r.all), tS = M(S, (r) => r.all);
  const supplyX = vS / vC, leaseX = tS / tC, cann = shS / shC - 1;

  console.log(`6. TENANT POOL CONSERVATION — ${SEEDS.length} seeds, ${HZ6} months, every LOI signed on sight`);
  console.log(`   one submarket, the shared cohort is the same 12 buildings in both arms\n`);
  console.log(`   arm      buildings   vacant sf   leased on the SHARED 12   total leased`);
  console.log(`   control  ${String(M(C, (r) => r.owned).toFixed(0)).padStart(9)}   ${k(vC).padStart(9)}   ${k(shC).padStart(23)}   ${k(tC).padStart(12)}`);
  console.log(`   +supply  ${String(M(S, (r) => r.owned).toFixed(0)).padStart(9)}   ${k(vS).padStart(9)}   ${k(shS).padStart(23)}   ${k(tS).padStart(12)}`);
  console.log(`\n   vacant space  x${supplyX.toFixed(2)}      total leased sf  x${leaseX.toFixed(2)}      shared cohort  ${(100 * cann).toFixed(1)}%`);
  // The share of the supply increase that the market refused to absorb. 1.0 is
  // a perfectly conserved pool (all new supply cannibalises), 0.0 is a pool
  // that mints a tenant for every empty foot.
  const conserved = 1 - (leaseX - 1) / (supplyX - 1);
  console.log(`   conservation ${conserved.toFixed(2)}   (1.00 = a finite pool that all the new space had to share;`);
  console.log(`                        0.00 = a tenant appears for every empty foot you create)`);
  console.log(`\n   CONTROLS — can these numbers move at all?`);
  const oC = C.map((r) => r.odds).filter(Boolean), oS = S.map((r) => r.odds).filter(Boolean);
  console.log(`     subject building at month 12   loiOdds ${mean(oC.map((o) => o.loiOdds)).toFixed(3)} -> ${mean(oS.map((o) => o.loiOdds)).toFixed(3)}`
    + `   competing sf ${(mean(oC.map((o) => o.competingSf)) / 1e6).toFixed(2)}M -> ${(mean(oS.map((o) => o.competingSf)) / 1e6).toFixed(2)}M`
    + `   local vac ${pct(mean(oC.map((o) => o.localVac)))} -> ${pct(mean(oS.map((o) => o.localVac)))}`);
  console.log(`     the city's whole monthly office requirement is ${k(mean(S.map((r) => r.req)))} sf;`
    + ` the ${M(S, (r) => r.owned).toFixed(0)} shocked buildings leased ${k(tS / HZ6)} sf/month between them`);
  console.log(`     citywide OCCUPIED office stock moved ${k(M(C, (r) => r.cityOccD))} (control) vs ${k(M(S, (r) => r.cityOccD))} (shock)`
    + `   — cityVac ${(100 * M(C, (r) => r.cityVacD)).toFixed(2)}pp vs ${(100 * M(S, (r) => r.cityVacD)).toFixed(2)}pp`);

  const verdict = conserved > 0.7 ? "WIRED" : conserved > 0.3 ? "WEAK" : "BROKEN";
  note("6", "Tenant pool conservation", verdict,
    `${supplyX.toFixed(2)}x vacant sf in one submarket produced ${leaseX.toFixed(2)}x total leased sf; `
    + `the shared 12-building cohort gave up only ${(-100 * cann).toFixed(1)}%. Conservation ${conserved.toFixed(2)} of 1.00.`);
  return { conserved, supplyX, leaseX, cann };
}

// ==========================================================================
// 7. CONCESSIONS
//
// Face rents are sticky and concessions are not. That is the oldest tell in
// the business: a landlord will hold the headline number on the comp sheet
// long after he has started giving away a year of free rent and a full
// fit-out to get it. So asking and NET EFFECTIVE should DIVERGE in a downturn
// and CONVERGE in a boom.
//
// Every arriving new-lease LOI in a long run is recorded with the state of the
// market on the day it arrived, and net effective is computed the way a broker
// computes it and the way this engine already charges it:
//
//   NER = (face x (term - free)/12 - TI - LC) / (term/12)      $/sf/yr
//
// with TI and LC taken from the engine's own `loiSigningCost`, so the number
// in this report is the money that actually leaves the player's account.
//
// FAILURE looks like: the gap between asking and NER is the same in a 5%
// vacancy market as in a 15% one (concessions are decorative), or the gap runs
// the wrong way (BACKWARDS). WEAK looks like: it moves, but by so little that
// no decision could ever turn on it.
// ==========================================================================
function test7() {
  const deals = [];
  for (const seed of SEEDS) {
    const parcels = fresh();
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    g = { ...g, cash: RICH };
    const stock = commercialStock(g, parcels, 15_000);
    const owned = [];
    // Spread across the city so the sample is not one corner's local market.
    for (let i = 0; i < stock.length && owned.length < 26; i += Math.max(1, Math.floor(stock.length / 26))) {
      const rec = E.resolveRec(parcels, g, stock[i].bbl);
      const px = Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)));
      const r = E.executePurchase(g, parcels, stock[i].bbl, px, "cash", false, 1);
      if (!r.err) { g = r.s; owned.push(stock[i].bbl); }
    }
    const seenLoi = new Set();
    for (let m = 0; m < HZ; m++) {
      // Record BEFORE signing, because signing removes the letter.
      for (const l of g.lois) {
        if (l.kind !== "new" || seenLoi.has(l.id)) continue;
        seenLoi.add(l.id);
        const rec = E.resolveRec(parcels, g, l.bbl), h = g.holdings[l.bbl];
        if (!rec || !h) continue;
        const use = l.use ?? "office";
        const ask = E.managedRentPsfYr(rec, g.econ, h, use);
        const yrs = l.termM / 12;
        const cost = E.loiSigningCost(l);             // TI + leasing commission, in dollars
        const ner = (l.rentPsf * (l.termM - (l.freeM ?? 0)) / 12 - cost / l.sf) / yrs;
        const nat = E.NATURAL_VAC[use] ?? 0.1;
        deals.push({
          use, cpi: g.econ.cpi || 1,
          ask, face: l.rentPsf, ner, yrs,
          freePerYr: (l.freeM ?? 0) / yrs, ti: l.tiPsf,
          gap: (g.econ.cityVac?.[use] ?? nat) - nat,
          conc: g.econ.concIdx?.[use] ?? NaN,
          phase: g.econ.phase,
        });
      }
      g = signAll(g, parcels);
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
      g = keepSolvent(g);
    }
  }
  const off = deals.filter((d) => d.use === "office");
  const sample = off.length > 200 ? off : deals;
  const label = off.length > 200 ? "office" : "all classes";
  console.log(`7. CONCESSIONS — ${deals.length} arriving new-lease letters across ${SEEDS.length} seeds x ${HZ} months`);
  console.log(`   ${label}, n=${sample.length}. Money is deflated by CPI; NER nets free rent, TI and commission.\n`);
  const gaps = sample.map((d) => d.gap).sort((a, b) => a - b);
  const cut = [qtl(gaps, 1 / 3), qtl(gaps, 2 / 3)];
  const buckets = [
    ["tight   (vac gap < " + (100 * cut[0]).toFixed(1) + "pp)", sample.filter((d) => d.gap < cut[0])],
    ["middle", sample.filter((d) => d.gap >= cut[0] && d.gap < cut[1])],
    ["glut    (vac gap > " + (100 * cut[1]).toFixed(1) + "pp)", sample.filter((d) => d.gap >= cut[1])],
  ];
  console.log(`   market       n     vac gap   real ask   real face   real NER   NER discount   free mo/yr   TI $/sf`);
  const rows = [];
  for (const [name, set] of buckets) {
    if (!set.length) continue;
    const ask = mean(set.map((d) => d.ask / d.cpi)), face = mean(set.map((d) => d.face / d.cpi));
    const ner = mean(set.map((d) => d.ner / d.cpi));
    const disc = 1 - ner / ask;
    rows.push({ name, ask, face, ner, disc, gap: mean(set.map((d) => d.gap)) });
    console.log(`   ${name.padEnd(12)}${String(set.length).padStart(5)}  ${(100 * mean(set.map((d) => d.gap))).toFixed(1).padStart(7)}pp`
      + `${ask.toFixed(2).padStart(11)}${face.toFixed(2).padStart(12)}${ner.toFixed(2).padStart(11)}`
      + `${pct(disc).padStart(15)}${mean(set.map((d) => d.freePerYr)).toFixed(2).padStart(13)}${mean(set.map((d) => d.ti)).toFixed(1).padStart(10)}`);
  }
  // The whole question in one number: how much wider the NER discount gets
  // between the tightest third of months and the loosest third.
  const spread = rows.length >= 2 ? rows[rows.length - 1].disc - rows[0].disc : NaN;
  // ...and whether the FACE rent held while it did. Sticky means face fell by
  // less than effective; if face falls just as far, concessions are decoration.
  const faceDrop = rows.length >= 2 ? 1 - rows[rows.length - 1].face / rows[0].face : NaN;
  const nerDrop = rows.length >= 2 ? 1 - rows[rows.length - 1].ner / rows[0].ner : NaN;
  console.log(`\n   glut minus tight:  NER discount widens ${(100 * spread).toFixed(1)}pp`
    + `   ·  real face rent falls ${(100 * faceDrop).toFixed(1)}%   ·  real NER falls ${(100 * nerDrop).toFixed(1)}%`);
  console.log(`   stickiness ratio ${(nerDrop / faceDrop).toFixed(2)}x  (>1 means effective rent moves further than the headline, which is the real behaviour)`);
  const verdict = !(spread > 0) ? "BACKWARDS" : spread > 0.08 ? "WIRED" : spread > 0.03 ? "WEAK" : "WEAK";
  note("7", "Concessions", verdict,
    `net-effective discount runs ${pct(rows[0]?.disc ?? NaN)} in the tightest third of months and ${pct(rows[rows.length - 1]?.disc ?? NaN)} in the loosest — `
    + `a ${(100 * spread).toFixed(1)}pp swing. Real face rent gave up ${(100 * faceDrop).toFixed(1)}% against NER's ${(100 * nerDrop).toFixed(1)}% (${(nerDrop / faceDrop).toFixed(2)}x).`);
  return { spread, faceDrop, nerDrop };
}

// ==========================================================================
// 8. ROLLOVER RISK
//
// Two identical buildings, the same parcel, the same tenants, the same rents,
// the same seed and the same market. The only difference is WHEN the leases
// expire: one on a ladder, one with ~70% of its square footage rolling inside
// a single year that lands on a recession.
//
// Rollover risk is the largest thing a buyer of a stabilised building is
// actually underwriting, and the cliff has to be visibly punished — a year of
// downtime at make-ready cost, a re-let into a soft market at a soft rent, and
// a wider exit cap because the roll got shorter. If the two arms end within a
// per cent of each other, the expiry schedule is decoration and WALT is a
// number nobody has to work for.
//
// The recession is FOUND, not assumed: a phase scan runs first on the same
// seed with no player, and the cliff is placed on the first downturn after
// year five.
// ==========================================================================
function firstRecession(seed, after = 60) {
  const parcels = fresh();
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let m = 1; m <= 360; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    g = keepSolvent(g);
    if (m >= after && g.econ.phase === "recession") return m;
  }
  return null;
}

function test8() {
  const rows = [];
  for (const seed of SEEDS) {
    const R = firstRecession(seed);
    if (R === null) continue;
    const END = R + 84;

    function arm(cliff) {
      const parcels = fresh();
      let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
      g = { ...g, cash: RICH };
      // The biggest well-let commercial building in town: a real rent roll to
      // put a cliff into.
      const stock = commercialStock(g, parcels, 40_000).sort((a, b) => b.sf - a.sf);
      let bbl = null;
      for (const s of stock) {
        const rec = E.resolveRec(parcels, g, s.bbl);
        const px = Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)));
        const r = E.executePurchase(g, parcels, s.bbl, px, "cash", false, 1);
        if (r.err) continue;
        if (r.s.holdings[s.bbl].tenants.length >= 4) { g = r.s; bbl = s.bbl; break; }
      }
      if (!bbl) return null;
      const h = g.holdings[bbl];
      // REWRITE ONLY THE EXPIRY DATES. Same names, same sf, same rents, same
      // credit — so the only thing the two arms can differ by is the schedule.
      const ts = [...h.tenants].sort((a, b) => b.sf - a.sf);
      const total = ts.reduce((a, t) => a + t.sf, 0);
      let piled = 0;
      ts.forEach((t, i) => {
        if (cliff && piled < total * 0.70) {
          // inside the twelve months around the downturn
          t.endM = R - 4 + ((i * 7) % 12);
          piled += t.sf;
        } else {
          // a ladder: evenly spread over the ten years around it
          t.endM = R - 54 + Math.round((i / Math.max(1, ts.length - 1)) * 108);
        }
        t.endM = Math.max(g.month + 4, t.endM);
      });
      const rollSf = ts.filter((t) => t.endM >= R - 6 && t.endM <= R + 6).reduce((a, t) => a + t.sf, 0);

      let noiReal = 0, occMin = 1, occAtEnd = 0;
      const rec0 = E.resolveRec(parcels, g, bbl);
      const commSf = E.commercialSf(rec0);
      for (let m = 1; m <= END; m++) {
        g = signAll(g, parcels);                    // a competent operator renews everything offered
        g = E.advanceQuarter(g, parcels, bbls, adjacency);
        g = keepSolvent(g);
        const rec = E.resolveRec(parcels, g, bbl), hh = g.holdings[bbl];
        if (!rec || !hh) break;
        const cpi = g.econ.cpi || 1;
        noiReal += E.holdingNOIYr(rec, g.econ, hh, g.month) / 12 / cpi;
        const occ = hh.tenants.reduce((a, t) => a + t.sf, 0) / Math.max(1, commSf);
        if (m > R - 12) { occMin = Math.min(occMin, occ); occAtEnd = occ; }
      }
      const rec = E.resolveRec(parcels, g, bbl), hh = g.holdings[bbl];
      const cpi = g.econ.cpi || 1;
      return {
        rollSf, rollShare: rollSf / total, noiReal,
        occMin, occAtEnd,
        valueReal: rec && hh ? E.holdingValue(rec, g.econ, hh, g.month) / cpi : NaN,
        spread: rec && hh ? E.rollQualitySpread(rec, hh, g.month, g.econ) : NaN,
        walt: hh ? E.walt(hh, g.month) : NaN,
      };
    }
    const ladder = arm(false), cliff = arm(true);
    if (ladder && cliff) rows.push({ seed, R, ladder, cliff });
  }
  console.log(`8. ROLLOVER RISK — a 70% expiry cliff on a recession, against the same building on a ladder`);
  console.log(`   ${rows.length} seeds. Same parcel, same tenants, same rents; only the expiry dates differ.\n`);
  console.log(`   seed      recession   arm      sf rolling +/-6mo   cumulative real NOI   occ trough   real value at end   exit spread`);
  for (const r of rows) {
    for (const [nm, a] of [["ladder", r.ladder], ["CLIFF ", r.cliff]]) {
      console.log(`   ${String(r.seed).padEnd(10)}${String("m" + r.R).padEnd(12)}${nm}   ${(pct(a.rollShare)).padStart(17)}`
        + `   $${(a.noiReal / 1e6).toFixed(2).padStart(18)}M${pct(a.occMin).padStart(13)}`
        + `   $${(a.valueReal / 1e6).toFixed(2).padStart(16)}M${(a.spread * 100).toFixed(0).padStart(12)}bp`);
    }
  }
  const dNoi = mean(rows.map((r) => r.cliff.noiReal / r.ladder.noiReal - 1));
  const dVal = mean(rows.map((r) => r.cliff.valueReal / r.ladder.valueReal - 1));
  const dOcc = mean(rows.map((r) => r.cliff.occMin - r.ladder.occMin));
  const dSpr = mean(rows.map((r) => (r.cliff.spread - r.ladder.spread) * 100));
  console.log(`\n   CLIFF minus LADDER:  real NOI over the window ${(100 * dNoi).toFixed(1)}%`
    + `   ·  occupancy trough ${(100 * dOcc).toFixed(1)}pp   ·  real value at end ${(100 * dVal).toFixed(1)}%`
    + `   ·  exit cap ${dSpr.toFixed(0)}bp`);
  const hit = Math.max(Math.abs(dNoi), Math.abs(dVal));
  const verdict = dNoi > 0 && dVal > 0 ? "BACKWARDS" : hit > 0.06 ? "WIRED" : hit > 0.02 ? "WEAK" : "BROKEN";
  note("8", "Rollover risk", verdict,
    `concentrating 70% of the roll into the recession year cost ${(-100 * dNoi).toFixed(1)}% of real NOI over ${rows[0]?.R ? "the following seven years" : "the window"}, `
    + `${(-100 * dOcc).toFixed(1)}pp of occupancy at the trough and ${(-100 * dVal).toFixed(1)}% of real terminal value.`);
  return { dNoi, dVal, dOcc, dSpr };
}

// ==========================================================================
// 9. CREDIT QUALITY
//
// Two halves, because "the credit field is cosmetic" can fail in two different
// places and they need different evidence.
//
// 9a  DOES IT FAIL?  A long instrumented run counts every tenant that went
//     dark MID-TERM, against tenant-months of exposure, split by covenant
//     grade and by the phase of the cycle it happened in. What comes out is an
//     annualised default rate per cell. If unrated and investment grade
//     default at the same rate, or if a recession does not raise either, the
//     field is a label.
//
// 9b  DOES IT REACH VALUE?  The same building, the same rents, the same
//     expiries, with the roll graded all-investment-grade in one arm and
//     all-unrated in the other — through the same recession. Reported as the
//     exit cap spread in basis points and the difference in real value.
// ==========================================================================
function test9() {
  // ---- 9a: default rates by grade and phase, on exposure ------------------
  const cell = {};   // `${credit}|${phase}` -> { months, fails }
  const bump = (c, p, f, n) => {
    const key = `${c}|${p}`;
    cell[key] = cell[key] ?? { months: 0, fails: 0 };
    cell[key].months += n; cell[key].fails += f;
  };
  for (const seed of SEEDS) {
    const parcels = fresh();
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    g = { ...g, cash: RICH };
    const stock = commercialStock(g, parcels, 15_000);
    const owned = [];
    for (let i = 0; i < stock.length && owned.length < 26; i += Math.max(1, Math.floor(stock.length / 26))) {
      const rec = E.resolveRec(parcels, g, stock[i].bbl);
      const r = E.executePurchase(g, parcels, stock[i].bbl,
        Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec))), "cash", false, 1);
      if (!r.err) { g = r.s; owned.push(stock[i].bbl); }
    }
    let prev = snapshotRoll(g, owned);
    for (let m = 0; m < HZ; m++) {
      g = signAll(g, parcels);
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
      g = keepSolvent(g);
      const now = snapshotRoll(g, owned), phase = g.econ.phase;
      // Exposure: one tenant-month for every tenant that was on the roll and
      // was not simply expiring. Fails: gone with term left to run — the only
      // way out of the roll mid-term is `pFail` in tickLeasing.
      const counted = {};
      for (const [key, t] of prev) {
        if (t.endM <= g.month) continue;            // an expiry is not a default
        counted[t.credit] = (counted[t.credit] ?? 0) + 1;
        if (!now.has(key)) bump(t.credit, phase, 1, 0);
      }
      for (const c of [0, 1, 2]) if (counted[c]) bump(c, phase, 0, counted[c]);
      prev = now;
    }
  }
  console.log(`9. CREDIT QUALITY`);
  console.log(`   9a — mid-term failures per tenant-year of exposure, ${SEEDS.length} seeds x ${HZ} months\n`);
  console.log(`   covenant          expansion        peak     recovery    recession    recession / expansion`);
  const grade = ["unrated (0)", "mid-market (1)", "inv grade (2)"];
  const rate = (c, p) => { const x = cell[`${c}|${p}`]; return x && x.months ? (12 * x.fails) / x.months : NaN; };
  const ratios = [];
  for (const c of [0, 1, 2]) {
    const r = ["expansion", "peak", "recovery", "recession"].map((p) => rate(c, p));
    const ratio = r[0] > 0 ? r[3] / r[0] : NaN;
    ratios.push(ratio);
    console.log(`   ${grade[c].padEnd(16)}` + r.map((x) => (Number.isFinite(x) ? pct(x) : "  —  ").padStart(12)).join("")
      + `${(Number.isFinite(ratio) ? ratio.toFixed(1) + "x" : "—").padStart(25)}`);
  }
  const junkRec = rate(0, "recession"), igRec = rate(2, "recession");
  const junkExp = rate(0, "expansion");
  console.log(`\n   unrated vs investment grade IN A RECESSION: ${pct(junkRec)} vs ${pct(igRec)}`
    + `  (${Number.isFinite(igRec) && igRec > 0 ? (junkRec / igRec).toFixed(1) + "x" : "n/a"})`);
  console.log(`   exposure: ` + [0, 1, 2].map((c) => `grade ${c} ${(["expansion", "peak", "recovery", "recession"]
    .reduce((a, p) => a + (cell[`${c}|${p}`]?.months ?? 0), 0) / 12).toFixed(0)} tenant-yrs`).join("  ·  "));

  // ---- 9b: does the covenant reach the exit? ------------------------------
  const vrows = [];
  for (const seed of SEEDS) {
    const R = firstRecession(seed);
    if (R === null) continue;
    function arm(credit) {
      const parcels = fresh();
      let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
      g = { ...g, cash: RICH };
      const stock = commercialStock(g, parcels, 40_000).sort((a, b) => b.sf - a.sf);
      let bbl = null;
      for (const s of stock) {
        const rec = E.resolveRec(parcels, g, s.bbl);
        const r = E.executePurchase(g, parcels, s.bbl,
          Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec))), "cash", false, 1);
        if (r.err) continue;
        if (r.s.holdings[s.bbl].tenants.length >= 4) { g = r.s; bbl = s.bbl; break; }
      }
      if (!bbl) return null;
      const h = g.holdings[bbl];
      for (const t of h.tenants) t.credit = credit;   // ONLY the covenant differs
      const rec0 = E.resolveRec(parcels, g, bbl);
      const spread0 = E.rollQualitySpread(rec0, h, g.month, g.econ);
      const v0 = E.holdingValue(rec0, g.econ, h, g.month);
      let noiReal = 0, fails = 0, tracked = new Map(h.tenants.map((t) => [t.name + t.startM, t]));
      for (let m = 1; m <= R + 60; m++) {
        g = signAll(g, parcels);
        g = E.advanceQuarter(g, parcels, bbls, adjacency);
        g = keepSolvent(g);
        const rec = E.resolveRec(parcels, g, bbl), hh = g.holdings[bbl];
        if (!rec || !hh) break;
        noiReal += E.holdingNOIYr(rec, g.econ, hh, g.month) / 12 / (g.econ.cpi || 1);
        const now = new Map(hh.tenants.map((t) => [t.name + t.startM, t]));
        for (const [key, t] of tracked) if (!now.has(key) && t.endM > g.month) fails++;
        tracked = now;
      }
      const rec = E.resolveRec(parcels, g, bbl), hh = g.holdings[bbl];
      const cpi = g.econ.cpi || 1;
      return {
        spread0, v0, fails, noiReal,
        spreadEnd: rec && hh ? E.rollQualitySpread(rec, hh, g.month, g.econ) : NaN,
        valueReal: rec && hh ? E.holdingValue(rec, g.econ, hh, g.month) / cpi : NaN,
      };
    }
    const ig = arm(2), junk = arm(0);
    if (ig && junk) vrows.push({ seed, ig, junk });
  }
  console.log(`\n   9b — the same building, the same rents and expiries, graded IG against unrated (${vrows.length} seeds through a recession)\n`);
  console.log(`   arm            exit spread at t0   mid-term failures   cumulative real NOI   real value at end`);
  for (const nm of ["ig", "junk"]) {
    const a = vrows.map((r) => r[nm]);
    console.log(`   ${(nm === "ig" ? "investment gr" : "unrated      ").padEnd(15)}${(100 * mean(a.map((x) => x.spread0))).toFixed(0).padStart(15)}bp`
      + `${mean(a.map((x) => x.fails)).toFixed(1).padStart(20)}`
      + `   $${(mean(a.map((x) => x.noiReal)) / 1e6).toFixed(2).padStart(18)}M`
      + `   $${(mean(a.map((x) => x.valueReal)) / 1e6).toFixed(2).padStart(16)}M`);
  }
  const dSpread = 100 * (mean(vrows.map((r) => r.junk.spread0)) - mean(vrows.map((r) => r.ig.spread0)));
  const dValue = mean(vrows.map((r) => r.junk.valueReal / r.ig.valueReal - 1));
  const dFails = mean(vrows.map((r) => r.junk.fails - r.ig.fails));
  console.log(`\n   unrated minus investment grade:  exit cap +${dSpread.toFixed(0)}bp at t0`
    + `   ·  ${dFails.toFixed(1)} more mid-term failures   ·  real terminal value ${(100 * dValue).toFixed(1)}%`);
  const wiredA = Number.isFinite(junkRec / igRec) && junkRec / igRec > 3 && junkRec / junkExp > 2;
  const verdict = !wiredA ? "WEAK" : Math.abs(dValue) > 0.03 || dSpread > 25 ? "WIRED" : "WEAK";
  note("9", "Credit quality", verdict,
    `unrated tenants go dark at ${pct(junkRec)}/yr in a recession against ${pct(igRec)} for investment grade `
    + `(${(junkRec / igRec).toFixed(1)}x) and ${pct(junkExp)} for unrated in an expansion (${(junkRec / junkExp).toFixed(1)}x cycle lift). `
    + `An all-unrated roll prices ${dSpread.toFixed(0)}bp wider and ends ${(100 * dValue).toFixed(1)}% below the same building on IG paper.`);
  return { junkRec, igRec, junkExp, dSpread, dValue, dFails };
}
function snapshotRoll(g, owned) {
  const m = new Map();
  for (const b of owned) {
    const h = g.holdings[b];
    if (!h) continue;
    for (const t of h.tenants) m.set(`${b}|${t.name}|${t.startM}`, t);
  }
  return m;
}

// ==========================================================================
// 10. LEASE-UP CURVES
//
// How long an empty building takes to stabilise, and what that answer depends
// on. This is the number a developer's whole business rests on, and the owner
// already suspects it is too fast: a new tower filling in eight months in a
// soft market is not lease-up risk, it is a formality with a delay on it.
//
// The design is a BRANCH. Each seed's world is warmed for W months, then
// cloned — state AND parcel table, because the table is mutated in place — and
// in the clone the player buys eight buildings, empties them, marks them
// delivered (which is what `leaseFactors` reads to give a new building its
// 1.45x tour traffic) and signs every letter that arrives for ten years.
// Branching at several W is what produces a spread of MARKET CONDITIONS from
// the engine's own cycle rather than from a dial.
//
// Reported by use, by location tercile and by the availability gap on the day
// the doors opened. FAILURE looks like: the medians are all the same, or a
// building delivered into a 15% vacancy market stabilises as fast as one
// delivered into a 5% one.
// ==========================================================================
function test10() {
  const EPOCHS = DEEP ? [12, 60, 120, 180, 240, 300] : [12, 84, 168, 252];
  const WATCH = 120;
  const rows = [];
  const dScores = commercialStock(
    E.firstListings(E.newGame(SEEDS[0], P0), P0, bbls), P0, 12_000).map((s) => s.d).sort((a, b) => a - b);
  const dCut = [qtl(dScores, 1 / 3), qtl(dScores, 2 / 3)];

  for (const seed of SEEDS) {
    const parcels = fresh();
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    let last = 0;
    for (const W of EPOCHS) {
      for (let m = last; m < W; m++) { g = E.advanceQuarter(g, parcels, bbls, adjacency); g = keepSolvent(g); }
      last = W;
      // BRANCH. Its own parcel table, so the probe cannot build in the trunk's
      // city and the trunk cannot build in the probe's.
      const bp = clone(parcels);
      let bg = clone(g);
      bg = { ...bg, cash: RICH };
      const stock = commercialStock(bg, bp, 12_000);
      // Spread the eight across the location range so the tercile split has a
      // sample in every bucket.
      const picks = [];
      for (let i = 0; i < stock.length && picks.length < 8; i += Math.max(1, Math.floor(stock.length / 8))) picks.push(stock[i]);
      const owned = [];
      for (const s of picks) {
        const r = buyAndEmpty(bg, bp, s.bbl, { deliveredNew: true });
        if (r.ok) { bg = r.g; owned.push(s); }
      }
      if (!owned.length) continue;
      const start = bg.month;
      const cond = {};
      for (const u of ["office", "retail", "industrial"]) {
        cond[u] = (bg.econ.cityVac?.[u] ?? 0) + (bg.econ.sublet?.[u] ?? 0) / Math.max(1, bg.econ.stock?.[u] ?? 1)
          - (E.NATURAL_VAC[u] ?? 0.1);
      }
      const hit85 = {}, hit50 = {};
      for (let m = 0; m < WATCH; m++) {
        bg = signAll(bg, bp);
        bg = E.advanceQuarter(bg, bp, bbls, adjacency);
        bg = keepSolvent(bg);
        for (const s of owned) {
          const rec = E.resolveRec(bp, bg, s.bbl), h = bg.holdings[s.bbl];
          if (!rec || !h) continue;
          const occ = h.tenants.reduce((a, t) => a + t.sf, 0) / Math.max(1, E.commercialSf(rec));
          if (hit50[s.bbl] === undefined && occ >= 0.50) hit50[s.bbl] = bg.month - start;
          if (hit85[s.bbl] === undefined && occ >= 0.85) hit85[s.bbl] = bg.month - start;
        }
      }
      for (const s of owned) {
        rows.push({
          seed, W, use: s.use, d: s.d, sf: s.sf,
          gap: cond[s.use] ?? cond.office,
          m85: hit85[s.bbl] ?? null, m50: hit50[s.bbl] ?? null,
        });
      }
    }
  }
  console.log(`10. LEASE-UP CURVES — ${rows.length} buildings emptied and marked newly delivered, ten years each,`);
  console.log(`    every letter signed on sight. "never" means still under 85% let after ${WATCH / 12} years.\n`);
  const report = (label, set) => {
    if (!set.length) return null;
    const done = set.filter((r) => r.m85 !== null).map((r) => r.m85).sort((a, b) => a - b);
    const half = set.filter((r) => r.m50 !== null).map((r) => r.m50);
    console.log(`    ${label.padEnd(28)}n=${String(set.length).padStart(3)}`
      + `   to 50%: ${(half.length ? med(half).toFixed(0) : "—").padStart(4)}mo`
      + `   to 85%: p25 ${(done.length ? qtl(done, 0.25) : "—").toString().padStart(3)}`
      + `  MEDIAN ${(done.length ? med(done) : "—").toString().padStart(3)}`
      + `  p75 ${(done.length ? qtl(done, 0.75) : "—").toString().padStart(3)}`
      + `   never: ${set.length - done.length}`);
    return done.length ? med(done) : null;
  };
  console.log(`  BY USE`);
  for (const u of ["office", "retail", "industrial", "multifamily"]) report(u, rows.filter((r) => r.use === u));
  console.log(`\n  BY LOCATION (demand score terciles: fringe < ${dCut[0].toFixed(0)} < middle < ${dCut[1].toFixed(0)} < prime)`);
  const locs = [
    ["fringe", rows.filter((r) => r.d < dCut[0])],
    ["middle", rows.filter((r) => r.d >= dCut[0] && r.d < dCut[1])],
    ["prime", rows.filter((r) => r.d >= dCut[1])],
  ].map(([n, s]) => [n, s, report(n, s)]);
  console.log(`\n  BY MARKET ON DELIVERY DAY (availability over the natural rate for that class)`);
  const gaps = rows.map((r) => r.gap).sort((a, b) => a - b);
  const gCut = [qtl(gaps, 1 / 3), qtl(gaps, 2 / 3)];
  const mkts = [
    [`tight  (< ${(100 * gCut[0]).toFixed(1)}pp)`, rows.filter((r) => r.gap < gCut[0])],
    [`middle`, rows.filter((r) => r.gap >= gCut[0] && r.gap < gCut[1])],
    [`soft   (> ${(100 * gCut[1]).toFixed(1)}pp)`, rows.filter((r) => r.gap >= gCut[1])],
  ].map(([n, s]) => [n, s, report(n, s)]);

  const all = rows.filter((r) => r.m85 !== null).map((r) => r.m85);
  const medAll = all.length ? med(all) : NaN;
  const locSpread = locs[2][2] && locs[0][2] ? locs[0][2] / locs[2][2] : NaN;
  const mktSpread = mkts[2][2] && mkts[0][2] ? mkts[2][2] / mkts[0][2] : NaN;
  console.log(`\n    citywide median months to 85% let: ${medAll}`
    + `   ·  fringe / prime ${Number.isFinite(locSpread) ? locSpread.toFixed(2) + "x" : "—"}`
    + `   ·  soft market / tight market ${Number.isFinite(mktSpread) ? mktSpread.toFixed(2) + "x" : "—"}`);
  // A new building filling in under a year is a formality; the real thing for a
  // speculative office tower is 24-48 months, longer into a soft market.
  const verdict = medAll <= 12 ? "BROKEN" : medAll <= 20 ? "WEAK" : "WIRED";
  note("10", "Lease-up curves", verdict,
    `median new building reaches 85% let in ${medAll} months (p25 ${qtl(all, 0.25)}, p75 ${qtl(all, 0.75)}), `
    + `${Number.isFinite(mktSpread) ? mktSpread.toFixed(2) + "x" : "n/a"} slower delivering into the softest third of markets than the tightest, `
    + `${Number.isFinite(locSpread) ? locSpread.toFixed(2) + "x" : "n/a"} slower on the fringe than prime.`);
  return { medAll, locSpread, mktSpread };
}

// ============================================================== the report
console.log(`\nC. LEASING MICROSTRUCTURE — tests 6-10`);
console.log(`seeds ${SEEDS.join(",")}   ·   horizon ${HZ} months   ·   city ${process.env.BW_CITY ?? "newalden"}`);
console.log("=".repeat(100) + "\n");
const t = {};
t[6] = test6(); console.log("\n" + "-".repeat(100) + "\n");
t[7] = test7(); console.log("\n" + "-".repeat(100) + "\n");
t[8] = test8(); console.log("\n" + "-".repeat(100) + "\n");
t[9] = test9(); console.log("\n" + "-".repeat(100) + "\n");
t[10] = test10();

console.log("\n" + "=".repeat(100));
console.log(`VERDICTS\n`);
for (const f of FINDINGS) {
  console.log(`  ${f.id}. ${f.name.padEnd(28)} ${f.verdict}`);
  for (const line of wrap(f.line, 92)) console.log(`       ${line}`);
  console.log();
}
function wrap(s, w) {
  const out = []; let cur = "";
  for (const word of s.split(/\s+/)) {
    if ((cur + " " + word).trim().length > w) { out.push(cur.trim()); cur = word; } else cur += " " + word;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
