// How much cash actually leaves the account per dollar of committed equity,
// across uses and leverage levels. Uses books "dev" — which only
// startDevelopment / tickDevelopments / deliver write to.
const E = await import("./test/.engine.mjs");
const { loadCity } = await import("./test/city.mjs");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const M = (n) => `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e6).toFixed(2)}M`;

function devBooks(g) { return (g.books ?? []).reduce((a, b) => a + b.dev, 0); }

// buy one piece of dirt, then fork the state for each experiment
let base = E.firstListings(E.newGame(7919, parcels), parcels, bbls);
base = { ...base, cash: 800e6 };
for (let m = 0; m < 240 && !Object.keys(base.holdings).length; m++) {
  base = E.advanceQuarter(base, parcels, bbls, adjacency);
  if (!base.talks) {
    for (const l of base.listings) {
      const rec = E.resolveRec(parcels, base, l.bbl);
      if (!rec || rec.class !== "land" || rec.lotArea < 8000) continue;
      const r = E.negotiate(base, parcels, l.bbl, Math.round(l.ask * 1.05));
      if (!r.err) { base = r.s; break; }
    }
  }
  if (base.talks?.agreed) { const r = E.closeDeal(base, parcels, "cash", 0); if (!r.err) base = r.s; else base = E.walkAway(base, parcels).s; }
  else if (base.talks) { const r = E.acceptCounter(base, parcels); base = r.err ? E.walkAway(base, parcels).s : r.s; }
}
const bbl = Object.keys(base.holdings)[0];
const rec = E.resolveRec(parcels, base, bbl);
console.log(`site ${rec.address} lot ${rec.lotArea}sf  month ${base.month}\n`);

const hdr = ["use", "ltc", "costTotal", "equity", "atClose", "leaseUp", "OUT(constr)", "xEquity", "xAtClose", "pred.excess", "actual.excess", "peakDrawdown"];
console.log(hdr.map((h) => h.padStart(12)).join(""));

for (const use of ["office", "retail", "industrial", "multifamily", "mixed"]) {
  for (const want of [undefined, 0.5, 0.35, 0]) {
    let g = base;
    const fl = Math.min(E.maxFloorsFor(rec, 0.6, use), 12);
    const plan = E.planDevelopment(g, parcels, bbl, use, fl, 0.6, "gmp", want);
    if (!plan) continue;
    const r = E.startDevelopment(g, parcels, bbl, use, plan.floors, 0.6, "gmp", want);
    if (r.err) { console.log(`${use} ltc=${want}: ${r.err}`); continue; }
    g = r.s;
    let out = 0, back = 0, peak = 0, running = 0;
    let prev = devBooks(g);
    out += prev;                       // the day-one cheque
    running = prev; peak = prev;
    let done = false;
    for (let m = 0; m < 120 && !done; m++) {
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
      const now = devBooks(g);
      const d = now - prev; prev = now;
      if (d > 0) out += d; else back += -d;
      running += d; peak = Math.max(peak, running);
      if (!g.developments[bbl]) done = true;
    }
    const pred = plan.equityAtClose - plan.leaseUp;
    const row = [
      use, want === undefined ? "max" : want, M(plan.costTotal), M(plan.equity), M(plan.equityAtClose),
      M(plan.leaseUp), M(out), (out / plan.equity).toFixed(2) + "x",
      (out / Math.max(1, plan.equityAtClose)).toFixed(2) + "x",
      M(pred), M(out - plan.equity), M(peak),
    ];
    console.log(row.map((x) => String(x).padStart(12)).join(""));
  }
}
