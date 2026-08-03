// PROBE 2: what actually eats the released lease-up reserve, and how many
// leases does it really buy? One development, nothing else owned.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "test/.engine.mjs"));
const { loadCity } = await import(join(HERE, "test/city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
const K = (n) => `$${Math.round(n / 1e3)}k`;
const USE = process.env.USE ?? "office";
const SEED = Number(process.env.SEED ?? 0);

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
const fl = Math.min(E.maxFloorsFor(rec0, 0.6), 12);
const plan = E.planDevelopment(g, parcels, site, USE, fl, 0.6, "gmp");
g = E.startDevelopment(g, parcels, site, USE, fl, 0.6, "gmp").s;

console.log(`site ${rec0.address} · ${USE} ${fl}fl ${(plan.sf/1000).toFixed(0)}k sf`);
console.log(`plan: costTotal ${M(plan.costTotal)} leaseUp ${M(plan.leaseUp)} commitment ${M(plan.commitment)} intResv ${M(plan.interestReserve)} equity ${M(plan.equity)}`);

let dev = null;
while (g.developments[site]) { dev = { ...g.developments[site] }; g = E.advanceQuarter(g, parcels, bbls, adjacency); }
const h = g.holdings[site];
const rec = E.resolveRec(parcels, g, site);
console.log(`delivered m${g.month}: loanBalance ${M(h.loan.balance)} of commitment ${M(dev.commitment)} (undrawn ${M(dev.commitment - h.loan.balance)})`);
console.log(`  equityBudget ${M(dev.equityBudget)} equitySpent ${M(dev.equitySpent)} drawn ${M(dev.drawn)} reserveUsed ${M(dev.reserveUsed)}`);
console.log(`  reserve released ${M(dev.leaseUpReserve)} · mini-perm rate ${h.loan.ratePct}% · assessed ${M(h.assessed)}`);
console.log(`  tenants at delivery ${h.tenants.length}, leased ${h.tenants.reduce((a,t)=>a+t.sf,0).toLocaleString()} of ${rec.bldgArea.toLocaleString()} sf`);

// Now: cash = exactly the reserve. Nothing else owned but this. Sign everything.
const resv = dev.leaseUpReserve;
g = { ...g, cash: resv };
let signed = 0, tiSpent = 0, sfLeased = 0, refusedCash = 0, refusedSf = 0;
console.log(`\nmonth | cash | lease spend | other (carry) | leased sf`);
for (let m = 0; m < 120; m++) {
  const c0 = g.cash;
  let leaseCost = 0;
  if (!h.broker) { const r = E.setBroker(g, parcels, site, true); if (!r.err) g = r.s; }
  for (const loi of [...g.lois]) {
    if (loi.bbl !== site) { const p = E.respondLOI(g, parcels, loi.id, "pass"); if (!p.err) g = p.s; continue; }
    const cost = E.loiSigningCost(loi);
    const r = E.respondLOI(g, parcels, loi.id, "accept");
    if (!r.err) { g = r.s; signed++; leaseCost += cost; tiSpent += cost; sfLeased += loi.sf; }
    else { refusedCash++; refusedSf += loi.sf; }
  }
  const cMid = g.cash;
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  const c1 = g.cash;
  const carry = c1 - cMid;
  if (m < 40 || leaseCost > 0)
    console.log(`  ${String(m).padStart(3)} | ${M(c1).padStart(8)} | ${K(-leaseCost).padStart(8)} | ${K(carry).padStart(8)} | ${g.holdings[site].tenants.reduce((a,t)=>a+t.sf,0).toLocaleString()}`);
  if (g.cash < 0) { console.log(`  *** went negative at month ${m} (${M(g.cash)})`); break; }
}
const leased = g.holdings[site].tenants.reduce((a,t)=>a+t.sf,0);
console.log(`\nSIGNED ${signed} leases, ${M(tiSpent)} of TI+LC, ${sfLeased.toLocaleString()} sf`);
console.log(`REFUSED for cash: ${refusedCash} letters, ${refusedSf.toLocaleString()} sf`);
console.log(`building ${rec.bldgArea.toLocaleString()} sf, now ${((leased/rec.bldgArea)*100).toFixed(0)}% leased`);
console.log(`reserve ${M(resv)}; TI+LC per sf actually paid $${(tiSpent/Math.max(1,sfLeased)).toFixed(2)}`);
console.log(`to fill the whole building at that rate: ${M((tiSpent/Math.max(1,sfLeased))*rec.bldgArea)}`);
