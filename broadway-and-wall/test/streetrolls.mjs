// EVERY BUILDING ON THE STREET HAS TENANTS (streetRolls.ts).
//
//   pnpm engine && pnpm streetrolls
//
// A building the player does not own keeps a real rent roll month to month.
// This asserts the rolls are the street: they add up to the market's
// occupancy, a building's as-is occupancy IS its roll, a buyer closes on the
// tenants who were there, a building the player sells carries its tenants
// back to the street, and the tenants' books stay finite.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};
const COMM = ["office", "retail", "industrial"];

let g = E.firstListings(E.newGame(7, parcels, 3e7, { sandbox: true }, { citySize: "small", cityLots: bbls.length }), parcels, bbls);
// 0. The opening tape discloses the tenants who are actually there.
{
  const L = g.listings.filter((l) => g.econ.streetRolls?.[l.bbl]?.t.length && l.roll);
  const same = L.filter((l) => JSON.stringify(l.roll.map((t) => t.name).sort()) === JSON.stringify(g.econ.streetRolls[l.bbl].t.map((t) => t.name).sort()));
  ok("opening listings disclose the street's own tenants", L.length > 0 && same.length === L.length, `${same.length} of ${L.length}`);
}
let moved = 0;
for (let m = 0; m < 30; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency); if (g.gameOver) g = { ...g, gameOver: null, cash: 1e9 };
  moved += (g.econ.streetFailed ?? []).filter((x) => x.m === g.month - 1 && x.to).length;
}
const e = g.econ;
const R = e.streetRolls ?? {};
const n = Object.values(R).reduce((a, r) => a + r.t.length, 0);
ok("the street carries named tenants", Object.keys(R).length > 200 && n > 500, `${Object.keys(R).length} buildings, ${n} tenants`);

// 1. The rolls ARE the market for offices and shops — every foot of both is
//    on the map; sheds carry the region's off-map stock on the aggregate.
for (const k of ["office", "retail"]) {
  let cap = 0, let_ = 0;
  for (const [bbl, r] of Object.entries(R)) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec) continue;
    cap += E.useRentableSf(rec, k);
    for (const t of r.t) if ((t.use ?? "office") === k) let_ += t.sf;
  }
  if (cap < 50_000) continue;
  const occ = let_ / cap, mkt = 1 - (e.streetVac?.[k] ?? 0);
  ok(`${k}: the street's rolls are the market's occupancy`, Math.abs(occ - mkt) < 0.002, `rolls ${(occ * 100).toFixed(1)}% vs market ${(mkt * 100).toFixed(1)}%`);
}

// 1b. Firms move between named buildings, and new ones form and look.
ok("firms move between the street's buildings", moved > 20, `${moved} moves in 30 months`);
ok("firms are looking for space", (e.seekers ?? []).length > 0, `${(e.seekers ?? []).length} looking`);
// 1c. The blocks of flats house the town's renters.
{
  const flats = Object.values(e.flatRolls ?? {}).reduce((a, f) => a + f.occ, 0);
  const housed = e.occupied.multifamily - (e.playerNow?.occ?.multifamily ?? 0);
  ok("the street's blocks of flats house the town's renters", Math.abs(flats - housed) / housed < 0.01, `${Math.round(flats)} vs ${Math.round(housed)}`);
  const occ = Object.entries(e.flatRolls).map(([b, f]) => f.occ / E.useRentableSf(E.resolveRec(parcels, g, b), "multifamily")).sort((a, b) => a - b);
  const med = occ[Math.floor(occ.length / 2)];
  ok("blocks of flats run near the market, with a spread", med > 0.85 && occ[Math.floor(occ.length * 0.1)] < med, `p10 ${occ[Math.floor(occ.length * 0.1)].toFixed(2)} median ${med.toFixed(2)}`);
}

// 2. A street building's as-is occupancy is its roll.
{
  let bad = 0, seen = 0;
  for (const [bbl, r] of Object.entries(R)) {
    const rec = E.resolveRec(parcels, g, bbl);
    for (const k of COMM) {
      const cap = rec ? E.useRentableSf(rec, k) : 0;
      if (!(cap > 0)) continue;
      const l = r.t.reduce((a, t) => a + ((t.use ?? "office") === k ? t.sf : 0), 0);
      seen++;
      if (Math.abs(E.useOccupancy(rec, e, k) - Math.min(1, l / cap)) > 1e-9) bad++;
    }
  }
  ok("as-is occupancy reads the building's own roll", seen > 100 && bad === 0, `${seen} checked, ${bad} off`);
}

// 3. The books stay finite.
{
  let bad = 0;
  for (const r of Object.values(R)) for (const t of r.t) {
    if (!Number.isFinite(t.sf) || !Number.isFinite(t.rentPsf)) bad++;
    else if (t.fin && ["debt", "cash", "cover", "liqM"].some((f) => !Number.isFinite(t.fin[f]))) bad++;
    else if (t.baseStopPsf !== undefined && !Number.isFinite(t.baseStopPsf)) bad++;
  }
  ok("every street tenant's books are finite", bad === 0, `${bad} bad`);
}

// 4. A buyer closes on the tenants who are there, and the street lets go of them.
const target = Object.keys(R).find((b) => {
  const rec = E.resolveRec(parcels, g, b);
  return rec?.class === "office" && rec.bldgArea > 20_000 && rec.bldgArea < 200_000 && R[b].t.length >= 2
    && !(g.rivals ?? []).some((r) => r.bbls.includes(b));
});
if (!target) throw new Error("no unowned street office building with a roll");
{
  const names = R[target].t.map((t) => t.name + "|" + t.startM).sort();
  const v = E.assetValue(E.resolveRec(parcels, g, target), e, "average");
  const r = E.executePurchase(g, parcels, target, Math.round(v), "cash", false, 1);
  ok("the purchase closes", !r.err, r.err ?? "");
  if (!r.err) {
    g = r.s;
    const got = (g.holdings[target]?.tenants ?? []).map((t) => t.name + "|" + t.startM).sort();
    ok("the deed carries the street's tenants", JSON.stringify(got) === JSON.stringify(names), `${got.length} on the deed, ${names.length} on the street`);
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    ok("a building the player holds leaves the street", !g.econ.streetRolls?.[target]);
    // 5. ...and comes back with its tenants when it goes.
    const held = (g.holdings[target]?.tenants ?? []).map((t) => t.name + "|" + t.startM);
    const holdings = { ...g.holdings }; delete holdings[target];
    g = E.advanceMonth({ ...g, holdings }, parcels, bbls, adjacency);
    const back = (g.econ.streetRolls?.[target]?.t ?? []).map((t) => t.name + "|" + t.startM);
    const carried = back.filter((k) => held.includes(k)).length;
    ok("a building sold carries its tenants back to the street", held.length > 0 && carried >= Math.min(held.length, back.length) - 1, `${carried} of ${held.length} carried`);
  }
}

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
