// A PLAYTEST, INSTRUMENTED — does this economy behave like a simulation?
//
//   pnpm playtest              6 seeds x 40 years, one pass
//   SEEDS=... YRS=60 pnpm playtest
//
// Every other harness in this repo asks whether one channel is right. This one
// asks the question a player asks, which is different and much less forgiving:
// I looked at the screen, I made a decision, did the world behave the way the
// screen said it would.
//
// WHAT IT FOUND when it was written, and why the sections are the sections.
//
// This economy has two layers and they do not agree with each other.
//
//   LAYER 1, the aggregate market model — econ.cityVac, econ.capRate,
//   econ.rentIdx, assetValue(), occupancy(rec, econ). This layer is in good
//   shape. Inflation runs 2.8%/yr, real office rent growth +0.1%/yr, the cap
//   stack is ordered the way the real one is and sits 109-266bp over the
//   policy rate, concessions open to 0.86 effective/face in a glut and close
//   again, and the cycle spends 72% of its months growing. Sections C, D and
//   E measure that and it is the part of this game that already feels real.
//
//   LAYER 2, the per-building rent roll — genRentRoll(), h.tenants,
//   occupancyRead(). This layer runs 20-31 points emptier than Layer 1 says
//   the market is.
//
// PRICES COME FROM LAYER 1. INCOME COMES FROM LAYER 2. Every one of the things
// that reads as fake sits on that seam, and section A is the sharpest cut of
// it: bucket the tape by each building's OWN roll occupancy and the ask does
// not move. 0.99-1.00x appraisal whether the building is a tenth let or fully
// let, so the going-in cap the buyer receives runs from -5.9% to +7.3% at the
// same price. The tape does not price tenancy at all.
//
// This is CLAUDE.md fake number 3 — one quantity with two answers — but it is
// worth saying why it survived so long when the repo hunts that fault
// specifically. It was found and fixed TWICE, in one consumer each time.
// actions.ts buyQuote fixed the LENDER ("measured over 3,195 listings, that
// estimate ran 89% occupancy against a real roll of 69%"). shared.tsx fixed
// the DESK DISPLAY (goingIn/inPlace). Nobody fixed the thing that sets the
// ASK — sim.ts refreshListings anchors every listing to assetValue(), which
// prices at model occupancy — or the Economy page, which still reports
// cityVac. So the player is now shown an honest going-in yield on a price
// that was set by a model which cannot see the roll, and the honest number is
// terrible.
//
// The sections are ordered by how much a player would feel them.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const SEEDS = (process.env.SEEDS ?? "7919,550991,12007,4242,91117,20603").split(",").map(Number);
const YRS = Number(process.env.YRS ?? 40);
const CL = ["office", "retail", "multifamily", "industrial"];
// Natural vacancy per class, as the engine holds it — see NATURAL_VAC in market.ts.
const NAT = { office: 11.5, retail: 8.5, multifamily: 4.5, industrial: 7.0 };

const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] : NaN);
const pad = (n, w, d = 1) => (isFinite(n) ? n.toFixed(d) : "  -  ").padStart(w);

// ---------------------------------------------------------------- collectors
const OCC_BUCKETS = [[0, 25], [25, 50], [50, 75], [75, 90], [90, 101]];
const tapeByOcc = OCC_BUCKETS.map(() => []);
const cityVsRoll = [];                       // section B
const spread = {}, conc = {}, held = {}, devSpread = {};
for (const c of CL) { spread[c] = []; conc[c] = []; held[c] = []; devSpread[c] = []; }
const labour = [], phases = {}, rentTrack = [];
let devStarted = 0, devPriced = 0, bought = 0;

for (const SEED of SEEDS) {
  let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
  const open = g.cash;
  const rent0 = { ...g.econ.rentIdx }, cpi0 = g.econ.cpi ?? 1;

  for (let m = 0; m < YRS * 12; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    // THE FROZEN WORLD (HANDOFF §4): advanceMonth returns state unchanged once
    // gameOver is set, so an un-resurrected probe silently stops and every
    // later month is a copy of the month it died in.
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    phases[e.phase] = (phases[e.phase] ?? 0) + 1;
    labour.push({ u: (e.unemployment ?? 0) * 100, jv: (e.jobVac ?? 0) * 100, phase: e.phase });

    // --- play: answer the tenants, buy income and dirt, build if it clears ---
    for (const loi of [...g.lois]) {
      const rec = E.resolveRec(parcels, g, loi.bbl); const h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      const mk = E.managedRentPsfYr(rec, e, h, loi.use);
      const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= mk * 0.88 ? "accept" : "pass");
      if (!r.err) g = r.s;
    }
    const reserve = open * 0.25;
    if (!Object.keys(g.talks ?? {}).length && g.cash > reserve) {
      let best = null;
      for (const l of g.listings) {
        if (g.holdings[l.bbl]) continue;
        const rec = E.resolveRec(parcels, g, l.bbl);
        if (!rec || !l.ask) continue;
        if (rec.class === "land") { if (rec.demandScore > 55 && l.ask < g.cash * 0.35 && !best) best = { l, rec, land: true, y: 99 }; continue; }
        const ip = E.inPlace(rec, g, l.bbl, l.ask);
        const y = ip?.noi > 0 ? ip.noi / l.ask : -1;
        if (y > (e.indexRate + 0.3) / 100 && (!best || (!best.land && y > best.y))) best = { l, rec, land: false, y };
      }
      if (best) { const r = E.negotiate(g, parcels, best.l.bbl, Math.round(best.l.ask * 0.94)); if (!r.err) g = r.s; }
    }
    for (const t of Object.values(g.talks ?? {})) {
      const rec = E.resolveRec(parcels, g, t.bbl);
      if (t.agreed) {
        let r = E.closeDeal(g, parcels, t.bbl, rec?.class === "land" ? "land" : "savings", rec?.class === "land" ? 0.5 : 0.65);
        if (r.err) r = E.closeDeal(g, parcels, t.bbl, "cash", 1);
        if (!r.err) { g = r.s; bought++; }
      } else if (t.final) { g = E.walkAway(g, parcels, t.bbl).s; }
      else { const r = E.acceptCounter(g, parcels, t.bbl); if (!r.err) g = r.s; }
    }
    if (m % 6 === 0) for (const h of Object.values(g.holdings)) {
      const rec = parcels[h.bbl];
      if (!rec || rec.class !== "land" || g.developments[h.bbl]) continue;
      for (const use of CL) {
        const fl = Math.min(E.maxFloorsFor(rec, 0.6), 12);
        const plan = E.planDevelopment(g, parcels, h.bbl, use, fl, 0.6, "gmp");
        if (!plan) continue;
        devPriced++; devSpread[use].push(plan.yieldOnCost - plan.exitCap);
        if (plan.yieldOnCost > plan.exitCap + 0.75 && plan.equityAtClose < g.cash - open * 0.15) {
          const r = E.startDevelopment(g, parcels, h.bbl, use, fl, 0.6, "gmp");
          if (!r.err) { g = r.s; devStarted++; break; }
        }
      }
    }

    // --- A: does the tape price the rent roll? --------------------------------
    if (m % 6 === 0) for (const l of g.listings) {
      const rec = E.resolveRec(parcels, g, l.bbl);
      // Distress is EXCLUDED on purpose. A receiver's building is supposed to
      // be cheap and broken — that is the bargain the player hunts for, and
      // leaving it in would let the one honest discount in the game stand in
      // for the ordinary tape not pricing tenancy at all.
      if (!rec || rec.class === "land" || !l.ask || l.distress) continue;
      const ip = E.inPlace(rec, g, l.bbl, l.ask);
      if (!ip?.disclosed) continue;
      const occ = (ip.occ ?? 0) * 100;
      const av = E.assetValue(rec, e, E.gradeOf(g, rec));
      const i = OCC_BUCKETS.findIndex(([lo, hi]) => occ >= lo && occ < hi);
      if (i >= 0) tapeByOcc[i].push({ ao: l.ask / Math.max(1, av), gi: ip.noi / l.ask * 100 });
    }

    // --- C/D/E: cap spread, concessions, rent path ---------------------------
    if (m % 12 === 6) {
      for (const c of CL) {
        spread[c].push(e.capRate[c] - e.indexRate);
        conc[c].push({ eff: (e.effRentIdx?.[c] ?? e.rentIdx[c]) / e.rentIdx[c], vac: (e.cityVac?.[c] ?? 0) * 100 });
      }
      for (const h of Object.values(g.holdings)) {
        const rec = E.resolveRec(parcels, g, h.bbl);
        if (!rec || rec.class === "land" || g.month - h.boughtM < 36) continue;
        held[rec.class].push(E.occupancyRead(rec, h).occ * 100);
      }
    }
  }

  // --- B: the Economy page against the rent rolls of the same buildings ------
  // Every standing building, no player selection — genRentRoll is deterministic
  // per parcel and drawn from a private stream, so asking costs the shared
  // world PRNG nothing and cannot re-roll the century.
  const sf = {}, let_ = {}, dead = {}, tot = {};
  for (const c of CL) { sf[c] = 0; let_[c] = 0; dead[c] = 0; tot[c] = 0; }
  for (const bbl of bbls) {
    const r = E.resolveRec(parcels, g, bbl);
    if (!r || r.class === "land" || !(r.bldgArea > 0)) continue;
    const h = { bbl, tenants: [], occ: 0, condition: E.initialCondition(r), boughtM: g.month, costBasis: 0, programsDone: {} };
    E.genRentRoll(g, r, h);
    for (const u of Object.keys(E.mixOf(r))) {
      if (u === "multifamily") continue;                 // MF occupancy is h.occ, not a tenant list
      const leg = E.useSf(r, u); if (leg < 400) continue;
      tot[u]++;
      const leased = h.tenants.filter((t) => (t.use ?? u) === u).reduce((a, t) => a + t.sf, 0);
      if (leased === 0) dead[u]++;
      sf[u] += leg; let_[u] += leased;
    }
  }
  for (const c of CL) if (sf[c] > 0) cityVsRoll.push({
    seed: SEED, cls: c, city: (1 - (g.econ.cityVac?.[c] ?? 0)) * 100,
    roll: let_[c] / sf[c] * 100, dead: dead[c] / Math.max(1, tot[c]) * 100, legs: tot[c],
  });
  rentTrack.push({ seed: SEED, rent0, rentN: { ...g.econ.rentIdx }, cpi: (g.econ.cpi ?? 1) / cpi0 });
}

const N = SEEDS.length, MO = N * YRS * 12;
console.log(`\nPLAYTEST — ${N} seeds x ${YRS} years, one player buying income and dirt at market`);
console.log(`${bought} acquisitions · ${devPriced} development plans priced · ${devStarted} started\n`);

console.log("A. DOES THE TAPE PRICE THE RENT ROLL?  (ordinary listings, distress excluded)");
console.log("   this building's own roll      n      ask / appraisal       going-in cap the buyer gets");
console.log("   occupancy                            p25   MED   p75        p25     MED     p75");
OCC_BUCKETS.forEach(([lo, hi], i) => {
  const s = tapeByOcc[i]; if (!s.length) return;
  console.log(`   ${(lo + "-" + (hi - 1) + "% let").padEnd(28)}${String(s.length).padStart(5)}   ${pad(q(s.map(x=>x.ao),.25),4,2)}  ${pad(q(s.map(x=>x.ao),.5),4,2)}  ${pad(q(s.map(x=>x.ao),.75),4,2)}     ${pad(q(s.map(x=>x.gi),.25),6)}  ${pad(q(s.map(x=>x.gi),.5),6)}  ${pad(q(s.map(x=>x.gi),.75),6)}`);
});
const flat = Math.abs(q(tapeByOcc[0].map(x=>x.ao),.5) - q(tapeByOcc[4].map(x=>x.ao),.5));
console.log(`   A tenth-let building asks ${pad(q(tapeByOcc[0].map(x=>x.ao),.5),0,2)}x appraisal; a full one asks ${pad(q(tapeByOcc[4].map(x=>x.ao),.5),0,2)}x. Difference: ${(flat*100).toFixed(0)}pp.`);
console.log(`   ${flat < 0.05 ? "THE ASK DOES NOT READ THE ROLL." : "the ask moves with the roll."} The going-in column is the emptiness, passed to the buyer at full price.\n`);

console.log("B. THE ECONOMY PAGE AGAINST THE RENT ROLLS OF THE SAME BUILDINGS (month " + YRS * 12 + ")");
console.log("   class          cityVac says occupied    the rolls say    GAP      no tenant at all    legs/seed");
for (const c of CL) {
  const s = cityVsRoll.filter((x) => x.cls === c);
  // Multifamily has no tenant list — residential occupancy is h.occ, a scalar —
  // so the leg-level roll comparison cannot be struck for it. Said out loud
  // rather than dropped, because a class that quietly vanishes from a table
  // reads as a class with nothing wrong with it.
  if (!s.length) { console.log(`   ${c.padEnd(13)} no tenant list — residential occupancy is a scalar (h.occ), not a roll`); continue; }
  const city = q(s.map(x=>x.city),.5), roll = q(s.map(x=>x.roll),.5), legs = q(s.map(x=>x.legs),.5);
  console.log(`   ${c.padEnd(13)}${pad(city,12)}%${pad(roll,17)}%${pad(city-roll,9)}pp        ${pad(q(s.map(x=>x.dead),.5),7)}%${pad(legs,13,0)}${legs < 30 ? "  <- thin, read with care" : ""}`);
}
console.log("   Prices are set on the first column. Income arrives from the second.");
// HONESTY ABOUT WHAT THIS ROW IS. genRentRoll is only ever called on a building
// COMING TO MARKET — stampListing, an approach, a closing, an auction, a note —
// and it deliberately skews ~4.5pp under the market because a building for sale
// is disproportionately one with a leasing problem. That selection is correct
// where the engine uses it and this harness applies it to the whole stock, so a
// residual gap of a few points here is the harness, not the engine. What the
// row is for is the LARGE gap: it read 16-31pp when it was written.
console.log("   A few points of residual is this harness imposing the for-sale skew on the whole");
console.log("   stock. It was written to catch the 16-31pp version.\n");

console.log("C. WHAT YOU OWN, HELD THREE YEARS OR MORE");
const REALSTAB = { office: "88-92%", retail: "92-96%", multifamily: "94-96%", industrial: "96-98%" };
console.log("   class          n     physical occupancy p10/MED/p90      real stabilised");
for (const c of CL) {
  const s = held[c]; if (!s.length) { console.log(`   ${c.padEnd(13)} none`); continue; }
  console.log(`   ${c.padEnd(13)}${String(s.length).padStart(5)}    ${pad(q(s,.1),5,0)}% ${pad(q(s,.5),5,0)}% ${pad(q(s,.9),5,0)}%              ${REALSTAB[c]}`);
}

console.log("\nD. THE LABOUR MARKET");
const atFloor = labour.filter((x) => x.u < 2.85).length / labour.length * 100;
const rec = labour.filter((x) => x.phase === "recession" || x.phase === "depression").map((x) => x.u);
const exp = labour.filter((x) => x.phase === "expansion" || x.phase === "peak").map((x) => x.u);
console.log(`   unemployment    p10 ${pad(q(labour.map(x=>x.u),.1),0,2)}%   MED ${pad(q(labour.map(x=>x.u),.5),0,2)}%   p90 ${pad(q(labour.map(x=>x.u),.9),0,2)}%`);
console.log(`   at the 2.8% frictional floor in ${atFloor.toFixed(1)}% of all months`);
console.log(`   MEDIAN in recession/depression ${pad(q(rec,.5),0,2)}%   vs in expansion/peak ${pad(q(exp,.5),0,2)}%   — a cycle needs a gap here`);
console.log(`   unfilled positions (jobVac) MED ${pad(q(labour.map(x=>x.jv),.5),0,2)}%  p90 ${pad(q(labour.map(x=>x.jv),.9),0,2)}%   of the labour force`);
console.log(`   real US metro unemployment over 50 years: ~3.4% to ~10.8%, and it is THE cyclical number.`);

console.log("\nE. WHAT ALREADY BEHAVES LIKE A MARKET");
console.log("   cap rate over the policy rate      MED bp      real: 150-350bp over the 10y, MF and industrial tightest");
for (const c of CL) console.log(`     ${c.padEnd(13)}${pad(q(spread[c],.5)*100,10,0)}bp`);
console.log("   concessions: effective / face rent");
for (const c of CL) {
  const lo = conc[c].filter((x) => x.vac < NAT[c]).map((x) => x.eff);
  const hi = conc[c].filter((x) => x.vac > NAT[c] + 5).map((x) => x.eff);
  console.log(`     ${c.padEnd(13)} tight market ${lo.length ? pad(q(lo,.5),5,3) : "  -  "}   glut ${hi.length ? pad(q(hi,.5),5,3) : "  -  "}   (n=${lo.length}/${hi.length})`);
}
const tot = Object.values(phases).reduce((a, b) => a + b, 0);
console.log(`   the cycle: ${Object.entries(phases).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${(v/tot*100).toFixed(0)}%`).join(" · ")}`);
console.log(`   real US: expansion ~70% of months, recession 10-15%`);
console.log("   rent growth over the campaign, nominal / real:");
for (const c of CL) {
  const nom = q(rentTrack.map((t) => (Math.pow(t.rentN[c] / t.rent0[c], 1 / YRS) - 1) * 100), .5);
  const cpi = q(rentTrack.map((t) => (Math.pow(t.cpi, 1 / YRS) - 1) * 100), .5);
  console.log(`     ${c.padEnd(13)}${pad(nom,7,2)}%/yr nominal  ${pad(nom - cpi,6,2)}%/yr real     (CPI ${pad(cpi,4,2)}%/yr)`);
}

console.log("\nF. DEVELOPMENT — yield on cost minus exit cap, on lots the player holds");
for (const c of CL) {
  const s = devSpread[c];
  if (!s.length) { console.log(`   ${c.padEnd(13)} no plan ever priced — the player never came to own a lot for it`); continue; }
  console.log(`   ${c.padEnd(13)}n=${String(s.length).padStart(4)}  spread p10/MED/p90 ${pad(q(s,.1),6,2)}/${pad(q(s,.5),6,2)}/${pad(q(s,.9),6,2)}pp   clears a +75bp hurdle in ${(s.filter(x=>x>0.75).length/s.length*100).toFixed(1)}% of months`);
}
console.log(`   A merchant developer needs +100-150bp of yield on cost over the exit cap to break ground.`);
console.log(`   Cross-check with pnpm pencils (who is the high bidder for dirt) and pnpm devyield (what it delivers).\n`);
