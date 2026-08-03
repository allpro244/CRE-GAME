// PROBE 3: month-by-month trace of one job's funding, and the state of the
// player's cash at delivery when the player is capitalised the way the game
// tells them to be.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "test/.engine.mjs"));
const { loadCity } = await import(join(HERE, "test/city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
const USE = process.env.USE ?? "office";
const SEED = Number(process.env.SEED ?? 0);
const FL = Number(process.env.FL ?? 12);

let g = E.firstListings(E.newGame(4200 + SEED * 13, parcels), parcels, bbls);
g = { ...g, cash: 400_000_000 };
const cands = bbls.filter((b) => {
  const r = E.resolveRec(parcels, g, b);
  return r && r.class === "land" && r.lotArea > 9000;
}).sort((a, b) => E.resolveRec(parcels, g, b).lotArea - E.resolveRec(parcels, g, a).lotArea);
let site = null;
for (const b of cands.slice(0, 60)) {
  const rec = E.resolveRec(parcels, g, b);
  const r = E.executePurchase(g, parcels, b, Math.round(E.landValue(rec, g.econ) * 1.15), "cash", false, 1);
  if (!r.err) { g = r.s; site = b; break; }
}
const rec0 = E.resolveRec(parcels, g, site);
const fl = Math.min(E.maxFloorsFor(rec0, 0.6), FL);
const plan = E.planDevelopment(g, parcels, site, USE, fl, 0.6, "gmp");
console.log(`plan: sf ${plan.sf} costTotal ${M(plan.costTotal)} leaseUp ${M(plan.leaseUp)} conting ${M(plan.contingency)} commitment ${M(plan.commitment)} intResv ${M(plan.interestReserve)} equity ${M(plan.equity)} atClose ${M(plan.equityAtClose)}`);

// CAPITALISE THE PLAYER THE WAY startDevelopment DEMANDS: equity + 6% margin.
const stake = plan.equity + Math.round(plan.costTotal * 0.06);
g = { ...g, cash: stake };
console.log(`player starts the job with exactly what the gate demands: ${M(stake)}`);
const st = E.startDevelopment(g, parcels, site, USE, fl, 0.6, "gmp");
if (st.err) { console.log("refused:", st.err); process.exit(0); }
g = st.s;

let prev = { ...g.developments[site] };
let prevCash = g.cash;
console.log(`m | cash | equitySpent/budget | drawn | costTotal | contingUsed`);
while (g.developments[site]) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  const d = g.developments[site];
  if (!d) break;
  const dc = g.cash - prevCash;
  console.log(`${String(g.month).padStart(3)} | ${M(g.cash).padStart(8)} (${M(dc).padStart(8)}) | ${M(d.equitySpent)}/${M(d.equityBudget)} | ${M(d.drawn)} | ${M(d.costTotal)} | ${M(d.contingencyUsed)} | LOC ${M(E.locAvailable(g, parcels))}`);
  prev = { ...d }; prevCash = g.cash;
}
const cashBefore = prevCash;
const d = prev;
const h = g.holdings[site];
console.log(`\nDELIVERY m${g.month}`);
console.log(`  cash the month before delivery: ${M(cashBefore)}`);
console.log(`  cash after delivery:            ${M(g.cash)}`);
console.log(`  lease-up reserve released:      ${M(d.leaseUpReserve)}`);
console.log(`  contingency rebate:             ${M(Math.max(0, d.contingency - d.contingencyUsed))}`);
console.log(`  final costTotal ${M(d.costTotal)} vs planned ${M(plan.costTotal)}`);
console.log(`  equitySpent ${M(d.equitySpent)} vs equityBudget ${M(d.equityBudget)}  => capital calls ${M(d.equitySpent - d.equityBudget)}`);
console.log(`  loan balance ${M(h?.loan?.balance ?? 0)} of commitment ${M(d.commitment)}`);
console.log(`  LOC drawn ${M(g.loc?.drawn ?? 0)} / ${M(g.loc?.limit ?? 0)}`);
console.log(`  building ${(h ? E.resolveRec(parcels, g, site).bldgArea : 0).toLocaleString()} sf, tenants ${h?.tenants.length ?? 0}`);

// what does the first tenant cost?
console.log(`\nnow try to lease it with what you have (${M(g.cash)}):`);
let n = 0, spent = 0, refused = 0, sfL = 0;
for (let m = 0; m < 96 && g.holdings[site]; m++) {
  if (!g.holdings[site].broker) { const r = E.setBroker(g, parcels, site, true); if (!r.err) g = r.s; }
  for (const loi of [...g.lois]) {
    if (loi.bbl !== site) { const p = E.respondLOI(g, parcels, loi.id, "pass"); if (!p.err) g = p.s; continue; }
    const cost = E.loiSigningCost(loi);
    const r = E.respondLOI(g, parcels, loi.id, "accept");
    if (!r.err) { g = r.s; n++; spent += cost; sfL += loi.sf; if (n <= 10) console.log(`   lease ${n}: ${loi.sf.toLocaleString()} sf, TI $${loi.tiPsf}/sf, cost ${M(cost)}, cash left ${M(g.cash)}`); }
    else { refused++; if (refused <= 4) console.log(`   REFUSED ${loi.sf.toLocaleString()} sf, cost ${M(cost)} — cash ${M(g.cash)} — ${r.err}`); }
  }
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
}
console.log(`signed ${n} (${M(spent)}, ${sfL.toLocaleString()} sf) · refused for cash ${refused} · still own it: ${!!g.holdings[site]}`);
