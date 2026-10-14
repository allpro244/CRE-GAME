// A SHOP THAT IS ONE SUITE LETS, AND A BRIDGE PLAN HAS A DATE ON IT.
//
//   pnpm engine && node test/one-suite-leg.mjs
//
// GATE. Two faults found together on a Great City developer run (seed 760449,
// tools/mdga/century-dev.mjs):
//
// 1. The new-letter path required the address's remaining tenant pool to
//    cover a whole suite. supportableOcc never exceeds 0.985, so a commercial
//    leg that IS one suite — the shop under a small walk-up — could never be
//    toured, at any corner, in any market. It sat dark for sixteen years at
//    80% monthly letter odds and the building read 66% let.
// 2. The bridge desk sized on the stabilised plan for ever, so that building
//    was refinanced on a plan it never met four times, three for cash out.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

// ---- 1. a one-suite shop leg lets
let g = E.firstListings(E.newGame(550991, parcels, 400_000_000), parcels, bbls);
const lots = bbls.filter((b) => {
  const r = parcels[b];
  return r.class === "land" && r.lotArea >= 1200 && r.lotArea <= 3000 && (r.demandScore ?? 0) >= 45 && !g.holdings[b] && !E.isCivicLand(g, b);
});
let built = null;
for (const b of lots) {
  const p = E.planDevelopment(g, parcels, b, "multifamily", 4, 0.6, "gmp", undefined, { groundRetail: "on" });
  if (!p || !((p.mix.retail ?? 0) > 0)) continue;
  // Handed over, as in test/bts.mjs: purchase is not what this file tests.
  const basis = Math.round(E.landValue(parcels[b], g.econ));
  g.holdings[b] = {
    bbl: b, boughtM: 0, costBasis: basis, assessed: basis, loan: null,
    condition: "average", condIdx: 0.55, svcIdx: 0.55,
    service: 0, stance: 0, plan: 1, tenants: [], cfHistory: [],
  };
  const d = E.startDevelopment(g, parcels, b, "multifamily", 4, 0.6, "gmp", undefined, { groundRetail: "on", takeout: "cap" });
  if (d.err) { delete g.holdings[b]; continue; }
  g = d.s; built = b; break;
}
ok(!!built, `broke ground on a small walk-up with a shop at grade (${built ?? "none found"})`);
if (built) {
  g.developments[built].deliverM = g.month + 1;   // the structure is not the subject; the lease-up is
  let rec = null, legs = null, signedAt = null;
  for (let i = 0; i < 48 && signedAt === null; i++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    for (const l of g.lois.filter((l) => l.bbl === built && E.loiNeedsPrincipal(g, l))) { const r = E.respondLOI(g, parcels, l.id, "accept"); if (!r.err) g = r.s; }
    const h = g.holdings[built];
    if (!h || g.developments[built]) continue;
    rec = E.resolveRec(parcels, g, built);
    legs ??= E.unitStatusByUse(rec, h, g.month);
    if (h.tenants.some((t) => t.use === "retail")) signedAt = g.month - h.deliveredM;
  }
  const shop = legs?.find((x) => x.use === "retail");
  ok(shop?.total === 1, `the shop leg is one suite (${shop?.total} × ${Math.round(shop?.sfPer ?? 0)} sf)`);
  ok(signedAt !== null, `the one-suite shop let within four years of delivery (month ${signedAt ?? "never"})`);
}

// ---- 2. the bridge plan expires
const plan = { noiYr: 200_000, value: 3_300_000 };
ok(E.seasonPlan(plan, 12) === plan, "inside one bridge term the plan carries full credit");
ok(E.seasonPlan(plan, E.PLAN_CREDIT_M) === plan, `through month ${E.PLAN_CREDIT_M} the plan carries full credit`);
const mid = E.seasonPlan(plan, E.PLAN_CREDIT_M + E.PLAN_FADE_M / 2);
ok(mid && Math.abs(mid.value - plan.value / 2) < 1, `half way through the extensions half the plan is credited (${Math.round(mid?.value ?? 0)})`);
ok(E.seasonPlan(plan, E.PLAN_CREDIT_M + E.PLAN_FADE_M) === undefined, "after the extensions there is no plan leg at all");
ok(E.planStartM({ boughtM: 10, deliveredM: 40, renovatingUntilM: 25 }) === 40, "the plan clock runs from the latest of purchase, delivery and renovation");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
