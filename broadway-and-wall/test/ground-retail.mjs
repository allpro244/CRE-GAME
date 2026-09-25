// SHOPS AT GRADE ARE THE OWNER'S CALL.
//
//   pnpm engine && pnpm ground-retail
//
// GATE. The planner programmed a shop floor on every office and apartment
// building wherever the street's footfall and the retail market allowed,
// and the owner had no say. DevDraft.groundRetail: "auto" is the street's
// call as before, "on" programmes the ground floor as shops whatever the
// street says, "off" is a lobby.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "FAIL" : "PASS"}`.replace(cond ? "FAIL" : "PASS", cond ? "PASS" : "FAIL") + `  ${msg}`); if (!cond) fails++; };
const g = E.firstListings(E.newGame(550991, parcels, 400_000_000), parcels, bbls);
// a vacant lot on a busy block: the street would put shops there on its own
const lots = bbls.map((b) => ({ b, rec: parcels[b] })).filter((x) => x.rec.class === "land" && x.rec.lotArea >= 5000 && (x.rec.demandScore ?? 0) >= 60 && !g.holdings[x.b]).slice(0, 6);
let tested = 0;
for (const { b } of lots) {
  for (const use of ["office", "multifamily"]) {
    const auto = E.planDevelopment(g, parcels, b, use, 6, 0.6, "gmp", undefined, { groundRetail: "auto" });
    const on = E.planDevelopment(g, parcels, b, use, 6, 0.6, "gmp", undefined, { groundRetail: "on" });
    const off = E.planDevelopment(g, parcels, b, use, 6, 0.6, "gmp", undefined, { groundRetail: "off" });
    if (!auto || !on || !off) continue;
    tested++;
    const want = Math.min(E.maxRetailShare(6), 1.25 / 6);
    ok((off.mix.retail ?? 0) === 0, `${use} on ${b}: "off" programmes no shops (${((off.mix.retail ?? 0) * 100).toFixed(1)}%)`);
    ok(Math.abs((on.mix.retail ?? 0) - want) < 0.005, `${use} on ${b}: "on" programmes the geometry's share, ${((on.mix.retail ?? 0) * 100).toFixed(1)}% (one tall floor of six)`);
    ok((auto.mix.retail ?? 0) <= (on.mix.retail ?? 0) + 1e-9 && (auto.mix.retail ?? 0) >= 0, `${use} on ${b}: "auto" is the street's call, ${((auto.mix.retail ?? 0) * 100).toFixed(1)}%`);
    ok(off.sf === on.sf && off.floors === on.floors, `the envelope does not move with the choice (${off.sf} sf, ${off.floors} floors)`);
    if (tested >= 3) break;
  }
  if (tested >= 3) break;
}
ok(tested >= 3, `${tested} lot/use pairs planned three ways`);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
