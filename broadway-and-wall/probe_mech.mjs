const E = await import("./test/.engine.mjs");
const { loadCity } = await import("./test/city.mjs");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const M = (n) => `${n < 0 ? "-" : " "}$${(Math.abs(n) / 1e6).toFixed(2)}M`;

let base = E.firstListings(E.newGame(7919, parcels), parcels, bbls);
base = { ...base, cash: 800e6 };
for (let m = 0; m < 240 && !Object.keys(base.holdings).length; m++) {
  base = E.advanceQuarter(base, parcels, bbls, adjacency);
  if (!base.talks) for (const l of base.listings) {
    const rec = E.resolveRec(parcels, base, l.bbl);
    if (!rec || rec.class !== "land" || rec.lotArea < 8000) continue;
    const r = E.negotiate(base, parcels, l.bbl, Math.round(l.ask * 1.05));
    if (!r.err) { base = r.s; break; }
  }
  if (base.talks?.agreed) { const r = E.closeDeal(base, parcels, "cash", 0); base = r.err ? E.walkAway(base, parcels).s : r.s; }
  else if (base.talks) { const r = E.acceptCounter(base, parcels); base = r.err ? E.walkAway(base, parcels).s : r.s; }
}
const bbl = Object.keys(base.holdings)[0];
const rec = E.resolveRec(parcels, base, bbl);

// ---------- A: mechanism ledger --------------------------------------------
{
  const use = "office";
  const fl = Math.min(E.maxFloorsFor(rec, 0.6, use), 12);
  const plan = E.planDevelopment(base, parcels, bbl, use, fl, 0.6, "gmp");
  const bucket = plan.commitment - plan.interestReserve;
  console.log(`=== A. MECHANISM (${use}, ${plan.floors}fl, ${plan.sf}sf) ===`);
  console.log(`costTotal ${M(plan.costTotal)}  leaseUpReserve ${M(plan.leaseUp)}  => S-curve buildSpend ${M(plan.costTotal - plan.leaseUp)}`);
  console.log(`equityBudget ${M(plan.equity)}  equityAtClose ${M(plan.equityAtClose)}  loan bucket (commitment-reserve) ${M(bucket)}`);
  console.log(`equityBudget + loan bucket = ${M(plan.equity + bucket)}  (== costTotal ${M(plan.costTotal)})`);
  console.log(`equity LEFT for the S-curve after the close cheque = ${M(plan.equity - plan.equityAtClose)}`);
  console.log(`S-curve can be funded: ${M(plan.equity - plan.equityAtClose)} equity + ${M(bucket)} loan = ${M(plan.equity - plan.equityAtClose + bucket)}`);
  console.log(`S-curve needs:         ${M(plan.costTotal - plan.leaseUp)}`);
  console.log(`=> UNFUNDED (capital calls) = ${M(plan.costTotal - plan.leaseUp - (plan.equity - plan.equityAtClose) - bucket)}  == equityAtClose - leaseUpReserve = ${M(plan.equityAtClose - plan.leaseUp)}\n`);

  let g = E.startDevelopment(base, parcels, bbl, use, plan.floors, 0.6, "gmp").s;
  let devB = g.books.reduce((a, b) => a + b.dev, 0);
  console.log(`${"m".padStart(4)} ${"prog%".padStart(6)} ${"devCash".padStart(9)} ${"cum".padStart(9)} ${"eqSpent".padStart(9)} ${"eqBudget".padStart(9)} ${"eqLeftUI".padStart(9)} ${"constrDraw".padStart(11)} ${"bucketLeft".padStart(11)} ${"UNFUNDED".padStart(10)}`);
  let cum = plan.equityAtClose;
  console.log(`${String(g.month).padStart(4)} ${"close".padStart(6)} ${M(plan.equityAtClose).padStart(9)} ${M(cum).padStart(9)} ${M(plan.equityAtClose).padStart(9)} ${M(plan.equity).padStart(9)} ${M(plan.equity - plan.equityAtClose).padStart(9)} ${M(0).padStart(11)} ${M(bucket).padStart(11)} ${M(0).padStart(10)}`);
  for (let m = 0; m < 60; m++) {
    const before = g.developments[bbl];
    const startM = before.startM, deliverM = before.deliverM;
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const nb = g.books.reduce((a, b) => a + b.dev, 0);
    const dc = nb - devB; devB = nb; cum += dc;
    const d = g.developments[bbl];
    const t = Math.min(1, (g.month - startM) / Math.max(1, deliverM - startM));
    const prog = t * t * (3 - 2 * t);
    if (!d) { console.log(`${String(g.month).padStart(4)} ${"DELIV".padStart(6)} ${M(dc).padStart(9)} ${M(cum).padStart(9)}   <- lease-up reserve + unspent contingency released`); break; }
    const cd = d.drawn - d.reserveUsed;
    const unf = Math.max(0, d.equitySpent - d.equityBudget);
    console.log(`${String(g.month).padStart(4)} ${(prog * 100).toFixed(0).padStart(6)} ${M(dc).padStart(9)} ${M(cum).padStart(9)} ${M(d.equitySpent).padStart(9)} ${M(d.equityBudget).padStart(9)} ${M(Math.max(0, d.equityBudget - d.equitySpent)).padStart(9)} ${M(cd).padStart(11)} ${M(d.commitment - d.interestReserve - cd).padStart(11)} ${M(unf).padStart(10)}`);
  }
  console.log(`\ntotal dev cash out (net of delivery release) ${M(cum)}   vs plan.equity ${M(plan.equity)}`);
}

// ---------- B: a player funded exactly to the engine's own gate -------------
{
  console.log(`\n=== B. A PLAYER FUNDED TO THE ENGINE'S OWN "you can finish it" GATE ===`);
  const use = "office";
  const fl = Math.min(E.maxFloorsFor(rec, 0.6, use), 12);
  const plan = E.planDevelopment(base, parcels, bbl, use, fl, 0.6, "gmp");
  const gate = plan.equity + Math.round(plan.costTotal * 0.06);
  let g = { ...base, cash: gate };            // exactly what startDevelopment demands
  console.log(`cash set to the gate: ${M(gate)} = equity ${M(plan.equity)} + 6% change-order margin`);
  const r = E.startDevelopment(g, parcels, bbl, use, plan.floors, 0.6, "gmp");
  if (r.err) { console.log("refused:", r.err); }
  else {
    g = r.s;
    let minCash = g.cash, minM = g.month;
    for (let m = 0; m < 60; m++) {
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
      if (g.cash < minCash) { minCash = g.cash; minM = g.month; }
      if (!g.developments[bbl]) break;
      if (g.gameOver) break;
    }
    console.log(`lowest cash reached ${M(minCash)} at month ${minM}${minCash < 0 ? "  <-- INSOLVENT" : ""}`);
    console.log(`cash at delivery ${M(g.cash)}   gameOver: ${g.gameOver?.cause ?? "no"}`);
  }
}
