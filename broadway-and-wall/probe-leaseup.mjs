// PROBE: does the lease-up reserve cover the fit-out of the building it delivers?
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "test/.engine.mjs"));
const { loadCity } = await import(join(HERE, "test/city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
const SEEDS = Number(process.env.SEEDS ?? 3);
const USE = process.env.USE ?? "office";

for (let seed = 0; seed < SEEDS; seed++) {
  let g = E.firstListings(E.newGame(4200 + seed * 13, parcels), parcels, bbls);
  // Plenty of cash so nothing here is about being poor at the start.
  g = { ...g, cash: 400_000_000 };

  // find a big vacant lot we can buy outright
  const cands = bbls.filter((b) => {
    const r = E.resolveRec(parcels, g, b);
    return r && r.class === "land" && r.lotArea > 9000;
  }).sort((a, b) => E.resolveRec(parcels, g, b).lotArea - E.resolveRec(parcels, g, a).lotArea);

  let site = null;
  for (const b of cands.slice(0, 60)) {
    const rec = E.resolveRec(parcels, g, b);
    const px = Math.round(E.landValue(rec, g.econ) * 1.15);
    const r = E.executePurchase(g, parcels, b, px, "cash", false, 1);
    if (!r.err) { g = r.s; site = b; break; }
  }
  if (!site) { console.log("seed", seed, "no site"); continue; }
  const rec0 = E.resolveRec(parcels, g, site);

  const fl = Math.min(E.maxFloorsFor(rec0, 0.6), 12);
  const plan = E.planDevelopment(g, parcels, site, USE, fl, 0.6, "gmp");
  if (!plan) { console.log("seed", seed, "no plan"); continue; }
  const st = E.startDevelopment(g, parcels, site, USE, fl, 0.6, "gmp");
  if (st.err) { console.log("seed", seed, "start refused:", st.err); continue; }
  g = st.s;
  const d0 = g.developments[site];

  console.log(`\n=== seed ${seed} · ${rec0.address} · ${USE} ${fl}fl · ${(plan.sf / 1000).toFixed(0)}k sf ===`);
  console.log(`  costTotal ${M(plan.costTotal)}  leaseUpReserve ${M(plan.leaseUp)} (${(plan.leaseUp / plan.sf).toFixed(2)}/sf of ${(plan.sf / 1000).toFixed(0)}k sf)`);
  console.log(`  commitment ${M(plan.commitment)} equity ${M(plan.equity)} atClose ${M(plan.equityAtClose)} months ${plan.months}`);

  // run to delivery, doing NOTHING else. Track cash each month.
  let before = null, after = null, deliverM = null, reserveAtDelivery = null;
  for (let m = 0; m < 200; m++) {
    const dev = g.developments[site];
    const cashBefore = g.cash;
    const resv = dev ? (dev.leaseUpReserve ?? 0) : null;
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (dev && !g.developments[site]) {
      before = cashBefore; after = g.cash; deliverM = g.month; reserveAtDelivery = resv;
      break;
    }
  }
  if (deliverM === null) { console.log("  never delivered"); continue; }
  const h = g.holdings[site];
  const rec = E.resolveRec(parcels, g, site);
  console.log(`  DELIVERED m${deliverM}: cash before ${M(before)} -> after ${M(after)} (delta ${M(after - before)})`);
  console.log(`  reserve on the dev record at delivery: ${M(reserveAtDelivery)}`);
  console.log(`  bldgArea ${rec.bldgArea.toLocaleString()} sf · pre-let tenants ${h.tenants.length} · leased ${h.tenants.reduce((a, t) => a + t.sf, 0).toLocaleString()} sf`);

  // Zero the player's other money so what we measure is what the reserve buys.
  g = { ...g, cash: reserveAtDelivery };
  console.log(`  --- resetting cash to exactly the released reserve ${M(g.cash)}; now sign every LOI ---`);

  let signed = 0, spent = 0, refused = 0, sfLeased = 0;
  const costs = [];
  for (let m = 0; m < 240; m++) {
    // market the space hard, like a developer would
    if (!h.broker) { const r = E.setBroker(g, parcels, site, true); if (!r.err) g = r.s; }
    for (const loi of [...g.lois]) {
      if (loi.bbl !== site) { const p = E.respondLOI(g, parcels, loi.id, "pass"); if (!p.err) g = p.s; continue; }
      const cost = E.loiSigningCost(loi);
      const r = E.respondLOI(g, parcels, loi.id, "accept");
      if (!r.err) {
        g = r.s; signed++; spent += cost; costs.push({ sf: loi.sf, ti: loi.tiPsf, cost });
        sfLeased += loi.sf;
        if (signed <= 12) console.log(`    lease ${signed}: ${loi.sf.toLocaleString()} sf @ TI $${loi.tiPsf}/sf -> cost ${M(cost)} · cash after ${M(g.cash)}`);
      } else {
        refused++;
        if (refused <= 3) console.log(`    REFUSED (${loi.sf.toLocaleString()} sf, cost ${M(cost)}, cash ${M(g.cash)}): ${r.err}`);
      }
    }
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.cash < 0) break;
  }
  const leasable = rec.bldgArea;
  const need = signed > 0 ? (spent / Math.max(1, sfLeased)) * leasable : 0;
  console.log(`  RESULT: reserve ${M(reserveAtDelivery)} · signed ${signed} leases costing ${M(spent)} over ${sfLeased.toLocaleString()} sf`);
  console.log(`  avg lease cost ${M(spent / Math.max(1, signed))} · $${(spent / Math.max(1, sfLeased)).toFixed(2)}/sf actual vs $${(reserveAtDelivery / leasable).toFixed(2)}/sf reserved`);
  console.log(`  to fill ${leasable.toLocaleString()} sf at that rate costs ${M(need)} — reserve covers ${((reserveAtDelivery / Math.max(1, need)) * 100).toFixed(0)}%`);
  console.log(`  leases the reserve covers: ~${(reserveAtDelivery / Math.max(1, spent / Math.max(1, signed))).toFixed(1)} · refusals for cash: ${refused}`);
}
