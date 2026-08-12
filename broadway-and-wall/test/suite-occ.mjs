// A one-space office is let, or it is not. Construction used to pre-let a
// 2,000 ft bite of a 26,000 ft single tenancy, and the book then read 1/1
// spaces at 8% occupancy.
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
  suites: { office: HQ },
};

let failed = 0;
const fail = (msg) => { console.error("FAIL", msg); failed++; };

{
  const bite = E.toSuites(rec, 4_000, Math.round(HQ * 0.32), "office");
  if (bite !== 0) fail(`spec-office ceiling must not demise 4k of a ${HQ} ft suite (got ${bite})`);
  else console.log("ok  toSuites refuses a bite of a one-space HQ");
}
{
  const whole = E.toSuites(rec, HQ, HQ, "office");
  if (whole !== HQ) fail(`empty one-space HQ should demise as ${HQ} (got ${whole})`);
  else console.log("ok  toSuites lets the whole HQ");
}
{
  const typical = { ...rec, suites: undefined };
  const sfPer = E.useSuiteSf(typical, "office");
  const got = E.toSuites(typical, sfPer, Math.round(HQ * 0.32), "office");
  if (got < sfPer * 0.9) fail(`typical suites should still pre-let a whole suite (~${sfPer}, got ${got})`);
  else console.log(`ok  typical ${Math.round(sfPer)} ft suite still pre-lets (${got} sf)`);
}
{
  const h = { tenants: [{ sf: 2_088, use: "office", rentPsf: 48, name: "X", sector: "professional", credit: 1, net: true, recovery: "nnn", startM: 0, endM: 120 }], occ: 0 };
  const u = E.unitStatus(rec, h, 0);
  const occ = E.physicalOcc(rec, h);
  if (u.total !== 1) fail(`programmed one space, unitStatus.total=${u.total}`);
  if (u.leased !== 0) fail(`2,088 ft of a ${HQ} ft suite is not 1/1 (leased=${u.leased})`);
  if (occ < 0.06 || occ > 0.10) fail(`occupancy should be ~8% (got ${(occ * 100).toFixed(1)}%)`);
  else console.log(`ok  unitStatus ${u.leased}/${u.total} at ${(occ * 100).toFixed(0)}% occ — not 1/1`);
}

// Build a one-space office and walk it through construction. Any pre-let must
// be a whole suite; at delivery, spaces and occupancy have to agree.
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
    fail("no land lot for a one-space office");
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
    const plan = E.planDevelopment(g, parcels, lot, "office", 6, 0.65, "gmp");
    const suites = {};
    for (const u of Object.keys(plan.mix)) {
      if (u === "multifamily") continue;
      const leg = Math.round(plan.sf * (plan.mix[u] ?? 0));
      if (leg > 0) suites[u] = leg;
    }
    const started = E.startDevelopment(g, parcels, lot, "office", 6, 0.65, "gmp", undefined, { suites });
    if (started.err) fail(`startDevelopment: ${started.err}`);
    else {
      g = started.s;
      const job = g.developments[lot];
      if (!job?.suites?.office) fail(`job missing office suite cut: ${JSON.stringify(job?.suites)}`);
      let fractional = 0;
      for (let i = 0; i < 90 && g.developments[lot]; i++) {
        g = E.advanceQuarter(g, parcels, bbls, adjacency);
        for (const sg of g.developments[lot]?.signed ?? []) {
          const cut = job.suites?.[sg.use] ?? job.suites?.office;
          if (cut && sg.sf < cut * 0.65) fractional++;
        }
      }
      if (fractional) fail(`${fractional} construction pre-let(s) smaller than 65% of the programmed space`);
      else console.log("ok  no fractional pre-let on a one-space office");
      if (!g.built?.[lot]) fail("job never delivered");
      else {
        const built = E.resolveRec(parcels, g, lot);
        const h = g.holdings[lot];
        const u = E.unitStatus(built, h, g.month);
        const office = u.byUse.find((r) => r.use === "office");
        const occ = E.physicalOcc(built, h);
        if (!office || office.total !== 1) fail(`office leg should be one space (got ${office?.total})`);
        if (office.leased === 1 && occ < 0.5) fail(`office 1/1 spaces but building occ ${(occ * 100).toFixed(0)}%`);
        if (office.leased !== 0 && office.leased !== 1) fail(`office ${office.leased}/${office.total} spaces`);
        else console.log(`ok  delivered office ${office.leased}/${office.total} · building occ ${(occ * 100).toFixed(0)}%`);
      }
    }
  }
}

if (failed) {
  console.error(`\nsuite-occ: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nsuite-occ: pass");
