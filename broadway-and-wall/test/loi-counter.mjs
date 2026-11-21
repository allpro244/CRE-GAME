// WHAT MOVES THE NEEDLE ON A COUNTER.
//
//   pnpm exec node test/loi-counter.mjs
//
// Asserts the quantities the counter desk claims to price:
//   1. Free rent is inside net effective (cutting it raises NE)
//   2. TI cuts raise NE; TI adds lower it
//   3. Tenant counter-back rent floors off the OPENER, not the landlord ask
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const fail = (msg) => { bad++; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  OK    ${msg}`);

console.log("\nLOI COUNTER — what moves the needle\n");

// --- 1–2. netEffectivePsf includes free rent and TI ------------------
{
  const loi = {
    id: 1, bbl: "x", kind: "new", name: "Acme", sector: "tech", credit: 2,
    sf: 10000, rentPsf: 40, termM: 120, tiPsf: 40, freeM: 6, bumpPct: 2.5, net: true,
  };
  const base = E.netEffectivePsf(loi, 40, 40, 6, 2.5);
  const cutFree = E.netEffectivePsf(loi, 40, 40, 0, 2.5);
  const cutTi = E.netEffectivePsf(loi, 40, 0, 6, 2.5);
  const addTi = E.netEffectivePsf(loi, 40, 60, 6, 2.5);
  if (!(cutFree > base + 1.5)) fail(`cutting 6mo free should lift NE (base ${base.toFixed(2)} → ${cutFree.toFixed(2)})`);
  else ok(`free rent moves NE (${base.toFixed(2)} → ${cutFree.toFixed(2)} with free cut)`);
  if (!(cutTi > base + 2)) fail(`cutting TI should lift NE (${base.toFixed(2)} → ${cutTi.toFixed(2)})`);
  else ok(`TI cut moves NE (${base.toFixed(2)} → ${cutTi.toFixed(2)})`);
  if (!(addTi < base - 1)) fail(`adding TI should lower NE (${base.toFixed(2)} → ${addTi.toFixed(2)})`);
  else ok(`extra TI buys rent (${base.toFixed(2)} → ${addTi.toFixed(2)})`);
}

// --- 2b. Annual bump vs the 2.5% standard moves NE -------------------
{
  const loi = {
    id: 2, bbl: "x", kind: "new", name: "Acme", sector: "tech", credit: 2,
    sf: 10000, rentPsf: 40, termM: 120, tiPsf: 0, freeM: 0, bumpPct: 2.5, net: true,
    openTiPsf: 0,
  };
  const atStd = E.netEffectivePsf(loi, 40, 0, 0, 2.5);
  const steeper = E.netEffectivePsf(loi, 40, 0, 0, 3.5);
  const flatter = E.netEffectivePsf(loi, 40, 0, 0, 1.5);
  if (!(Math.abs(atStd - 40) < 0.05)) fail(`standard 2.5% bump should not move NE off face (got ${atStd.toFixed(2)})`);
  else ok(`2.5% bump is NE-neutral vs face (${atStd.toFixed(2)})`);
  if (!(steeper > atStd + 1)) fail(`3.5% bump should lift NE (${atStd.toFixed(2)} → ${steeper.toFixed(2)})`);
  else ok(`steeper bump lifts NE (${atStd.toFixed(2)} → ${steeper.toFixed(2)})`);
  if (!(flatter < atStd - 1)) fail(`1.5% bump should cut NE (${atStd.toFixed(2)} → ${flatter.toFixed(2)})`);
  else ok(`flatter bump cuts NE (${atStd.toFixed(2)} → ${flatter.toFixed(2)})`);
}

// --- 3. Real letters: the reservation is stored, re-asking cannot flip it,
//        and a counter-back sits between their opener and your ask ---------
// Four empty commercial buildings handed over at the open (as
// tools/mdga/auto-lease-audit.mjs does), the city run only until letters arrive.
{
  const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);
  let g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  g.cash = Math.max(g.cash, 80e6);
  let n = 0;
  for (const b of bbls) {
    const rec = E.resolveRec(parcels, g, b);
    if (!rec || !(rec.bldgArea > 20000) || !E.isCommercial(rec) || g.holdings[b] || E.isCivicLand(g, b)) continue;
    const worth = E.assetValue(rec, g.econ, E.initialCondition(rec));
    const grade = E.gradeOf(g, rec);
    g.holdings[b] = {
      bbl: b, boughtM: g.month, costBasis: worth, assessed: worth, loan: null,
      condition: grade, condIdx: E.initialCondIdx(rec, g.month, grade),
      service: 0, stance: 0, plan: 1, svcIdx: 0.55, tenants: [], cfHistory: [],
    };
    E.clearRivalClaims(g, b);
    g.listings = (g.listings ?? []).filter((l) => l.bbl !== b);
    if (++n >= 4) break;
  }
  let tried = 0, flipped = 0, notTaken = 0, counterBack = null, bad3 = 0;
  for (let m = 0; m < 12 && tried < 4; m++) {
    g = E.advanceMonth({ ...g, cash: Math.max(g.cash, 80e6) }, parcels, bbls, adjacency);
    for (const loi of g.lois ?? []) {
      if (loi.kind === "renewal" || loi.countered || loi.stage === "countered" || tried >= 4) continue;
      if (typeof loi.resNE !== "number") { fail(`a ${loi.kind} letter carries no stored reservation (resNE)`); bad3++; continue; }
      tried++;
      for (const mult of [1.03, 1.08, 1.20]) {
        const outs = new Set();
        for (let k = 0; k < 6; k++) {
          const st = structuredClone(g);
          // move the random streams: the answer must not care
          for (let d = 0; d <= k; d++) { E.rng(st); E.rng(st, "leasing"); }
          const askRent = +(loi.rentPsf * mult).toFixed(2);
          const r = E.respondLOI(st, parcels, loi.id, "counter", true, { rentPsf: askRent, tiPsf: loi.tiPsf, freeM: loi.freeM });
          const w = (r.s.lois ?? []).find((l) => l.id === loi.id);
          outs.add(w ? `${w.stage ?? "open"}:${w.counterRentPsf ?? ""}` : (r.err ? "err" : "gone"));
          if (w?.stage === "countered" && !counterBack) counterBack = { opened: loi.rentPsf, askRent, their: w.counterRentPsf };
        }
        if (outs.size > 1) flipped++;
        if (![...outs].every((o) => o === "gone")) notTaken++;
      }
    }
  }
  if (!tried) console.log("  SKIP  real letters — none arrived in the sample");
  else if (flipped) fail(`${flipped} counters got different answers as the random stream moved — the answer is still a die`);
  else ok(`${tried} letters x 3 counters x 6 stream positions: one answer each — re-asking cannot flip a refusal`);
  if (counterBack) {
    if (!(counterBack.their < counterBack.askRent - 0.001)) fail(`counter-back ${counterBack.their} did not come under ask ${counterBack.askRent}`);
    else ok(`counter-back $${counterBack.their.toFixed(2)} under your ask $${counterBack.askRent.toFixed(2)} (they opened $${counterBack.opened.toFixed(2)})`);
  } else console.log("  SKIP  counter-back — none in the sample (took or walked)");
}


// --- 4. The answer is a comparison against a stored reservation ---------
// The same counter, asked from the same letter with the random stream in
// twenty different places, gets the same answer: a refusal cannot be fished
// into a yes by asking again. And the answer is the reservation's: an ask at
// or under it is taken, one over it is not.
{
  const loi = {
    id: 4, bbl: "x", kind: "new", name: "Acme", sector: "tech", credit: 1,
    sf: 10000, rentPsf: 40, termM: 84, tiPsf: 30, freeM: 4, bumpPct: 2.5, net: true, resNE: 41,
  };
  const neOpen = E.netEffectivePsf(loi, 40, 30, 4, 2.5);
  const under = E.tenantAnswer(loi, neOpen, loi.resNE - 0.01);
  const over = E.tenantAnswer(loi, neOpen, loi.resNE + 3);
  const way = E.tenantAnswer({ ...loi, resNE: neOpen }, neOpen, neOpen + 3);
  const baf = E.tenantAnswer(loi, neOpen, loi.resNE + 0.5, true);
  if (under.outcome !== "took") fail(`an ask under the reservation should be taken (got ${under.outcome})`);
  else ok("an ask under the reservation is taken");
  if (over.outcome !== "countered" || !(over.target <= loi.resNE + 1e-9)) fail(`an ask over it should be countered at no more than the reservation (got ${over.outcome} ${over.target})`);
  else ok(`an ask over it is countered at $${over.target.toFixed(2)} (reservation $${loi.resNE})`);
  if (way.outcome !== "walked") fail(`a tenant that opened at its most should walk on a raise (got ${way.outcome})`);
  else ok("a tenant that opened at its most walks on a raise");
  if (baf.outcome !== "walked") fail(`best-and-final over the reservation should walk (got ${baf.outcome})`);
  else ok("best-and-final over the reservation walks");
}

console.log("");
process.exit(bad ? 1 : 0);
