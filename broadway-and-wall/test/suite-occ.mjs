// Floorplate occupancy — a building is plates, not a pre-cut of N suites.
// Construction used to pre-let a 2,000 ft bite of a 26,000 ft one-space
// tenancy and then print 1/1 spaces at 8% occupancy. The cut is gone;
// identity is tenants + vacant blocks == useSf.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

const HQ = 26_100;
const base = Object.values(parcels).find((p) => p.bldgArea > 0) ?? Object.values(parcels)[0];
const rec = {
  ...base,
  class: "office",
  bldgArea: HQ,
  floors: 4,
  mix: { office: 1 },
};

let failed = 0;
const fail = (msg) => { console.error("FAIL", msg); failed++; };

{
  const hold = { tenants: [], occ: 0 };
  const ident = E.blockIdentity(rec, hold);
  if (!ident.every((r) => r.ok)) fail(`empty HQ identity ${JSON.stringify(ident)}`);
  else console.log("ok  empty 26,100 ft HQ conserves area");
  const u = E.unitStatus(rec, hold, 0);
  if (u.leased !== 0) fail(`empty HQ leased=${u.leased}`);
  else console.log(`ok  empty HQ ${u.leased}/${u.total} spaces`);
}

{
  const hold = {
    tenants: [{ sf: 4_000, use: "office", rentPsf: 48, name: "X", sector: "professional", credit: 1, net: true, recovery: "nnn", startM: 0, endM: 120 }],
    occ: 0,
  };
  const ident = E.blockIdentity(rec, hold);
  if (!ident.every((r) => r.ok)) fail(`partial HQ identity ${JSON.stringify(ident)}`);
  const u = E.unitStatus(rec, hold, 0);
  const occ = E.physicalOcc(rec, hold);
  if (u.leased !== 1) fail(`4,000 ft tenant should be one space (leased=${u.leased})`);
  if (u.total < 2) fail(`4,000 ft of 26,100 cannot be 1/1 (total=${u.total})`);
  const rentable = E.rentableSf(rec);
  const expect = 4_000 / rentable;
  if (Math.abs(occ - expect) > 0.01) fail(`occupancy should be ${ (expect * 100).toFixed(1)}% of rentable (got ${(occ * 100).toFixed(1)}%)`);
  else console.log(`ok  unitStatus ${u.leased}/${u.total} at ${(occ * 100).toFixed(0)}% occ — not 1/1`);
}

{
  const typical = { ...rec };
  const sfPer = E.typicalSuiteSf(typical, "office");
  const plate = E.stackForUse(typical, "office")?.plateSf ?? HQ;
  if (sfPer > plate + 1) fail(`market-norm suite ${sfPer} exceeds plate ${plate}`);
  else console.log(`ok  market-norm office suite ${Math.round(sfPer)} ft on a ${Math.round(plate)} ft plate`);
}

// Build an office and walk it through construction. A pre-let is a size on
// the stack; at delivery, spaces and occupancy have to agree.
{
  let g = E.firstListings(E.newGame(1, parcels), parcels, bbls);
  g = { ...g, cash: g.cash + 200e6 };
  let lot = null;
  for (const bbl of bbls) {
    const p = parcels[bbl];
    if (!p || p.class !== "land" || p.lotArea < 5000) continue;
    if (g.holdings[bbl] || g.built?.[bbl]) continue;
    const plan = E.planDevelopment(g, parcels, bbl, "office", 6, 0.65, "gmp");
    if (plan && plan.sf > 12_000 && plan.sf < 80_000 && plan.equity < 120e6) { lot = bbl; break; }
  }
  if (!lot) {
    fail("no land lot for an office");
  } else {
    const price = Math.round(E.landValue(parcels[lot], g.econ) * 1.02);
    g = {
      ...g,
      cash: g.cash - price,
      holdings: {
        ...g.holdings,
        [lot]: {
          bbl: lot, boughtM: 0, costBasis: price, condition: "average",
          tenants: [], loan: null, assessed: price, condIdx: 0.55, svcIdx: 0.55,
          service: 0, stance: 0, plan: 1, cfHistory: [],
        },
      },
    };
    const started = E.startDevelopment(g, parcels, lot, "office", 6, 0.65, "gmp");
    if (started.err) fail(`startDevelopment: ${started.err}`);
    else {
      g = started.s;
      const job = g.developments[lot];
      for (let i = 0; i < 90 && g.developments[lot]; i++) {
        g = E.advanceQuarter(g, parcels, bbls, adjacency);
      }
      if (!g.built?.[lot]) fail("job never delivered");
      else {
        const built = E.resolveRec(parcels, g, lot);
        const h = g.holdings[lot];
        const ident = E.blockIdentity(built, h);
        if (!ident.every((r) => r.ok)) fail(`delivered identity ${JSON.stringify(ident)}`);
        const u = E.unitStatus(built, h, g.month);
        const office = u.byUse.find((r) => r.use === "office");
        const occ = E.physicalOcc(built, h);
        const tenantSf = (h.tenants ?? []).filter((t) => t.use === "office").reduce((a, t) => a + t.sf, 0);
        if (office && office.leased === 1 && office.total === 1 && occ < 0.5) {
          fail(`office 1/1 spaces but building occ ${(occ * 100).toFixed(0)}%`);
        }
        if (office && office.leased > 0 && tenantSf < 1) fail("leased spaces with no tenant feet");
        else console.log(`ok  delivered office ${office?.leased}/${office?.total} · building occ ${(occ * 100).toFixed(0)}%`);
      }
    }
  }
}

// A warehouse smaller than the class's typical bay is one plate the size of
// the shed — not a 12,000 ft suite in a 9,371 ft building.
{
  const shed = 9_371;
  const ware = {
    ...base,
    class: "industrial",
    bldgArea: shed,
    floors: 1,
    mix: { industrial: 1 },
  };
  const sfPer = E.typicalSuiteSf(ware, "industrial");
  if (sfPer > shed) fail(`industrial suite ${sfPer} exceeds the ${shed} ft shed`);
  else if (sfPer !== shed) fail(`9,371 ft shed should be one ${shed} ft plate (got ${sfPer})`);
  else console.log(`ok  ${shed} ft warehouse is one ${sfPer} ft plate, not 12,000`);
  const full = { tenants: [{ sf: shed, use: "industrial" }], occ: 0 };
  const ident = E.blockIdentity(ware, full);
  if (!ident.every((r) => r.ok)) fail(`full shed identity ${JSON.stringify(ident)}`);
  const u = E.unitStatus(ware, full, 0);
  if (u.total !== 1 || u.leased !== 1) fail(`full shed should be 1/1 (got ${u.leased}/${u.total})`);
  else console.log("ok  full 9,371 ft shed is 1/1");
}

{
  let over = 0;
  let nInd = 0;
  for (const bbl of bbls) {
    const p = parcels[bbl];
    if (!p || p.class !== "industrial" || !p.bldgArea) continue;
    nInd++;
    const per = E.typicalSuiteSf(p, "industrial");
    const leg = E.useSf(p, "industrial") || p.bldgArea;
    if (per > leg + 1) over++;
  }
  if (over) fail(`${over}/${nInd} industrial buildings have a suite larger than the leg`);
  else console.log(`ok  ${nInd} industrial buildings: no suite larger than the shed`);
}

if (failed) {
  console.error(`\nsuite-occ: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nsuite-occ: pass");
