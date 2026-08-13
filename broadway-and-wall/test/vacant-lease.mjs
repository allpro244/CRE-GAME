// A vacant office must be able to let, and the rent column must not invent a
// contract where there is no tenant.
//
// Two faults, one screenshot: 12,600 sf office, 0/1 spaces, 0% occupied,
// still printing $25.45/sf, still empty after a decade of trying to fill it.
//
//   1. A building cut as ONE suite was refused every tour: the tenant-pool
//      ceiling compared the whole floor against ~85% of itself and `continue`d.
//   2. Letters on stale space arrive marked down; the hired desk scored them
//      against last year's unmarked ask and passed every one.
//
//   pnpm engine && node test/vacant-lease.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);

let fails = 0;
const check = (ok, msg) => {
  if (!ok) { fails++; console.log("  FAIL", msg); }
  else console.log("  OK  ", msg);
};

console.log("\nVACANT OFFICE — tours, the desk, and the rent column\n");

// --- current ask is the managed number times the stale markdown -------------
{
  const d0 = E.staleDiscount(0);
  const d24 = E.staleDiscount(24);
  const d120 = E.staleDiscount(120);
  check(d0 === 1, `fresh space is unmarked (staleDiscount(0)=${d0})`);
  check(d24 < 0.95, `two years dark has cut the ask (${d24.toFixed(3)})`);
  check(d120 < 0.80 && d120 > 0.74, `a decade dark sits near the 25% floor (${d120.toFixed(3)})`);
}

// --- a one-suite fringe office must still draw tours ------------------------
{
  const src = bbls
    .map((b) => parcels[b])
    .find((r) => r && r.class === "office" && r.bldgArea > 8_000)
    ?? bbls.map((b) => parcels[b]).find((r) => r && r.class !== "land" && r.bldgArea > 8_000);
  if (!src) throw new Error("no office parcel to programme as a single suite");
  const bbl = src.bbl;
  const sf = 12_600;
  const table = {
    ...parcels,
    [bbl]: {
      ...src,
      class: "office",
      mix: { office: 1 },
      bldgArea: sf,
      suites: { office: sf },
      demandScore: 8,
    },
  };
  let g = E.newGame(12007, table, 80_000_000);
  g.leasingOddsMult = 40;
  // Pin the location pivot to the figure the ceiling was calibrated on, so a
  // town whose office mean happens to sit on the fringe cannot hide the skip.
  g.econ = { ...g.econ, locIdxMean: 0.62, locIdxMeanBy: { ...(g.econ.locIdxMeanBy ?? {}), office: 0.62 } };
  g.holdings[bbl] = {
    bbl, boughtM: 0, costBasis: 6_840_000, assessed: 6_840_000,
    loan: null, condition: "average", condIdx: 0.55, svcIdx: 0.55,
    service: 0, stance: -1, plan: 1, tenants: [], cfHistory: [], occ: 0,
  };
  g.built[bbl] = {
    class: "office", mix: { office: 1 }, bldgArea: sf, floors: 4,
    yearBuilt: 2000, suites: { office: sf },
  };

  const rec = E.resolveRec(table, g, bbl);
  const h = g.holdings[bbl];
  const units = E.unitStatus(rec, h, g.month);
  check(units.total === 1 && units.leased === 0, `programmed as 0/1 spaces (got ${units.leased}/${units.total})`);

  const sup = E.supportableOcc(g.econ, rec, "office");
  const poolSf = Math.max(0, sf - (1 - sup) * sf);
  const suite = E.useSuiteSf(rec, "office");
  const wouldSkip = sf > poolSf + suite * 0.15;
  check(wouldSkip,
    `precondition: a whole-building letter overshoots the old pool sliver `
    + `(supportable ${(sup * 100).toFixed(0)}%, pool ${Math.round(poolSf).toLocaleString()} sf, suite ${Math.round(suite).toLocaleString()})`);

  let tours = 0;
  for (let m = 0; m < 36 && tours === 0; m++) {
    g.month = m;
    E.tickLeasing(g, table);
    tours = g.lois.filter((l) => l.bbl === bbl && l.kind === "new").length;
  }
  check(tours > 0, `one-suite fringe office drew a tour within 36 months (got ${tours})`);
}

// --- the desk signs a letter at the current (marked-down) ask ---------------
{
  let g = E.firstListings(E.newGame(9001, parcels, 80_000_000), parcels, bbls);
  let bought = null;
  for (const L of g.listings ?? []) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || rec.class === "multifamily" || !rec.bldgArea || L.ask > g.cash) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    if (!r.err) { g = r.s; bought = L.bbl; break; }
  }
  if (!bought) throw new Error("no commercial building to empty");
  const rec = E.resolveRec(parcels, g, bought);
  const use = rec.class === "retail" ? "retail" : rec.class === "industrial" ? "industrial" : "office";
  g.holdings[bought].tenants = [];
  g.holdings[bought].darkMs = 120;
  const h = g.holdings[bought];
  const managed = E.managedRentPsfYr(rec, g.econ, h, use) || 40;
  const ask = E.currentAskPsfYr(rec, g.econ, h, use);
  check(ask < managed * 0.82, `decade-dark ask is marked down ($${ask.toFixed(2)} vs managed $${managed.toFixed(2)})`);

  const suite = Math.min(4000, Math.max(2000, Math.round(rec.bldgArea * 0.25)));
  const loi = {
    id: 501, bbl: bought, kind: "new", use, name: "Stale Floor LLC",
    sector: "tech", credit: 1, sf: suite, rentPsf: +ask.toFixed(2),
    termM: 96, tiPsf: 2, freeM: 0, bumpPct: 2.5, net: true,
    expiresM: g.month + 3, arrivedM: g.month,
  };
  const vsManaged = E.loiMandateScore(loi, managed);
  const vsAsk = E.loiMandateScore(loi, ask);
  check(vsManaged < 0.78, `against the unmarked ask this letter is a pass (${(vsManaged * 100).toFixed(0)}% of managed)`);
  check(vsAsk >= 0.90, `against today's ask it clears the default floor (${(vsAsk * 100).toFixed(0)}% of current ask)`);

  g.lois = [loi];
  g.agent = true;
  g.agentFloor = 0.90;
  g.agentPassBelow = 0.78;
  g.cash = Math.max(g.cash, 20_000_000);
  const before = g.holdings[bought].tenants.length;
  E.runLeasingAgent(g, parcels);
  const signed = g.holdings[bought].tenants.length > before;
  const passed = (g.news ?? []).some((n) => /passed on Stale Floor LLC/i.test(n.text ?? ""));
  check(signed && !passed, signed
    ? "desk signed the marked-down letter instead of passing it"
    : `desk did not sign (passed=${passed}, lois left=${g.lois.length})`);
}

console.log(fails ? `\n${fails} failed\n` : "\nvacant-lease pass\n");
process.exit(fails ? 1 : 0);
