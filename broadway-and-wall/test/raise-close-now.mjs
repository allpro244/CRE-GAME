// CLOSE THE RAISE YOURSELF (owner, Oct 2026: the raise should not be a
// waiting room). Once half the target is circled the sponsor may stop raising
// and break ground on what is in, carrying the rest; under half it may not.
//
//   pnpm engine && node test/raise-close-now.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) bad++; };
const have = (r) => Object.values(r.committed).reduce((a, v) => a + (v ?? 0), 0);

// A lot that pencils, a job the sponsor cannot build alone (test/raise.mjs findJob).
function findJob(g, parcels) {
  const own0 = E.fundableNow(g, parcels);
  let pick = null;
  for (const L of g.listings ?? []) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class !== "land" || L.ask > own0 * 0.8) continue;
    for (const u of ["multifamily", "office", "retail", "industrial"]) for (const f of [2, 3, 4, 6, 8, 12]) {
      const p = E.planDevelopment(g, parcels, L.bbl, u, f, 0.6, "gmp");
      if (!p || p.hurdleRatio < 0.9) continue;
      const need = E.devFundingNeed(p).whole;
      if (need <= own0 - L.ask || need > (own0 - L.ask) * 2.2) continue;
      if (!pick || p.hurdleRatio > pick.p.hurdleRatio) pick = { L, u, f, p };
    }
  }
  return pick;
}

let tested = false;
for (const seed of [9400, 9401, 9402, 9403, 9405, 9406]) {
  if (tested) break;
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels, 1_000_000), parcels, bbls);
  for (let m = 0; m < 36 && !tested; m++) {
    if (g.month % 3 === 0) {
      const pick = findJob(g, parcels);
      if (pick) {
        const r0 = E.executePurchase(g, parcels, pick.L.bbl, pick.L.ask, "cash", false, 1);
        if (!r0.err && r0.s.holdings[pick.L.bbl]) {
          const b = pick.L.bbl, g1 = r0.s;
          const need = E.devFundingNeed(E.planDevelopment(g1, parcels, b, pick.u, pick.f, 0.6, "gmp")).whole;
          const outside = E.maxOutside(g1, need, E.ownedHoldingValue(g1, parcels, g1.holdings[b]));
          const lr = E.launchRaise(g1, parcels, b, { use: pick.u, floors: pick.f, coverage: 0.6, contract: "gmp", spec: 0.5 }, outside);
          if (!lr.err) {
            g = lr.s;
            check(g.raises[b].deadlineM - g.month === E.RAISE_WINDOW_M, `the raise runs ${E.RAISE_WINDOW_M} months`);
            const early = E.closeRaiseNow(g, parcels, b);
            check(!!early.err && early.s === g, `under half circled, closing now is refused and nothing moves (${early.err ?? "no error"})`);
            // Circle until half is in, then close.
            for (let k = 0; k < E.RAISE_WINDOW_M && g.raises?.[b] && have(g.raises[b]) < 0.5 * g.raises[b].target; k++) {
              g = E.advanceMonth(g, parcels, bbls, adjacency);
            }
            const r = g.raises?.[b];
            if (r && have(r) >= 0.5 * r.target && have(r) < r.target) {
              const circled = have(r);
              const res = E.closeRaiseNow(g, parcels, b);
              check(!res.err, `with ${Math.round(circled / r.target * 100)}% circled, closing now works${res.err ? `: ${res.err}` : ""}`);
              if (!res.err) {
                g = res.s;
                check(!!g.developments[b], "ground is broken the same month");
                check(!g.raises?.[b], "the raise is closed");
                const lp = g.syndications?.[b]?.lpCommit ?? 0;
                check(lp > 0 && lp <= circled + 1, `the investors put in what they circled, no more (${Math.round(lp).toLocaleString()} of ${Math.round(circled).toLocaleString()})`);
              }
              tested = true;
            } else if (!r) {
              // It filled (or closed) before we could act — try another seed.
            }
          } else g = g1;
        }
      }
    }
    if (!tested) g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
}
check(tested, "found a raise to close early on one of the seeds");
console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
