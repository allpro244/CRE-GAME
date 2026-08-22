// PLAN UI — Phase 4 of LEASING_OVERHAUL_PLAN.md.
//
//   pnpm engine && pnpm plan-ui
//
// The sheet is editable, docketed letters are the exception list, and a
// live plan does not synthesise a second clock.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const g = {
  agent: true,
  cash: 10e6,
  holdings: {},
  loc: { balance: 0 },
  lois: [{
    id: 7, bbl: "x", use: "office", kind: "expansion", name: "Acme",
    sector: "law", credit: 1, sf: 8_000, rentPsf: 40, termM: 84,
    tiPsf: 20, freeM: 2, net: true, expiresM: 3, referred: true,
    docketReason: "an incumbent expansion changes how you program the building",
  }],
  month: 4,
};

ok("planIsLive is false until a sheet exists", !E.planIsLive(g));
E.ensureLeasingPlan(g);
ok("ensureLeasingPlan posts a sheet for a desk", !!g.leasingPlan && E.planIsLive(g));
ok("leaseDocketLois lists referred exceptions",
  E.leaseDocketLois(g).length === 1 && E.leaseDocketLois(g)[0].id === 7);

E.patchPlanRow(g, "office", { quotePct: 1.12, holdM: 24 });
ok("patchPlanRow writes quotePct above par",
  Math.abs(g.leasingPlan.sheet.office.quotePct - 1.12) < 1e-9
  && g.leasingPlan.sheet.office.holdM === 24,
  `quote=${g.leasingPlan.sheet.office.quotePct} hold=${g.leasingPlan.sheet.office.holdM}`);

E.patchPlanRow(g, { bbl: "x" }, { holdBlocks: [{ floorLo: 8, floorHi: 12 }] });
ok("per-building holdBlocks override",
  g.leasingPlan.sheet.byBbl.x.holdBlocks?.[0]?.floorLo === 8);

E.setPlanAuthority(g, 25_000_000);
ok("setPlanAuthority writes dollar cap", g.leasingPlan.authority === 25_000_000);

E.rollDeskDigest(g);
ok("rollDeskDigest opens a quarter", g.deskDigest?.startM === 4);

const rec = {
  bbl: "testplate0001", address: "1 Test St", class: "office",
  bldgArea: 120_000, floors: 10, mix: { office: 1 }, lotArea: 20_000, yearBuilt: 1998,
};
const h = { bbl: rec.bbl, tenants: [
  { name: "One", use: "office", sf: 24_000, rentPsf: 40, startM: 0, endM: 60, credit: 1, sector: "law", net: true },
], darkMs: 5 };
E.assignTenantFloors(rec, h.tenants);
const blocks = E.blocksOf(rec, h);
ok("stacking has tenant floors", h.tenants[0].floorLo >= 1 && h.tenants[0].floorHi >= h.tenants[0].floorLo);
ok("stacking has vacant blocks", blocks.length >= 1 && blocks.every((b) => b.sf > 0));

if (fails) {
  console.log(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log("\nplan-ui: all checks passed");
