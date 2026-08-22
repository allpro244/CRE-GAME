// NEW FLOOR IS NOT A SUITE THE MONTH IT OPENS.
//
// addStock used to raise housable and occupied in the same tick (the pool
// cap was stock × (1 − friction)). A delivery now goes into darkSf and
// housableStock does not move until that floor ages out on reletMonths.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

const e = {
  stock: { office: 100_000, retail: 0, multifamily: 0, industrial: 0 },
  occupied: { office: 90_000, retail: 0, multifamily: 0, industrial: 0 },
  darkSf: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
};

const house0 = E.housableStock(e, "office");
E.addStock(e, "office", 8_000);
check(e.stock.office === 108_000, `stock rose by the delivery (${e.stock.office})`);
check(e.darkSf.office === 8_000, `the delivery is dark (${e.darkSf.office})`);
check(E.housableStock(e, "office") === house0, "housable is unchanged the month the floor opens");

const between = E.betweenTenantsSf(90_000, "office");
const expectBetween = 90_000 * (1 / E.LEASE_TERM_YR / 12) * E.reletMonths("office");
check(Math.abs(between - expectBetween) < 1e-6, `between-tenants is roll × relet (${between.toFixed(0)} sf)`);
check(E.reletMonths("office") === 5.5 && E.reletMonths("industrial") === 2.5 && E.reletMonths("retail") === 3.5,
  "city re-let clock matches the player's make-ready clock");

// Age the dark book the way tickSpace does: remaining *= (1 − 1/lag).
const lag = E.reletMonths("office");
for (let i = 0; i < Math.ceil(lag); i++) {
  e.darkSf.office *= (1 - 1 / lag);
}
check(e.darkSf.office < 8_000 * 0.40, `after a re-let term most of the delivery is a suite (${e.darkSf.office.toFixed(0)} still dark)`);
check(E.housableStock(e, "office") > house0 + 4_000, "housable rises as the floor comes out of lease-up");

check(E.frictionFloor("office") > 0, "frictionFloor remains the watcher the shortage harness reads");

const r = (1 / E.LEASE_TERM_YR / 12) * E.reletMonths("office");
const occCap = 100_000 / (1 + r);
const filled = {
  stock: { office: 100_000, retail: 0, multifamily: 0, industrial: 0 },
  occupied: { office: occCap, retail: 0, multifamily: 0, industrial: 0 },
  darkSf: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
};
const res = E.residenceVac(filled, "office");
const printed = 1 - filled.occupied.office / filled.stock.office;
check(Math.abs(res - printed) < 1e-9, `residence vacancy is the printed vacancy when every suite that can be let, is (${(res * 100).toFixed(2)}%)`);

console.log("");
process.exit(bad ? 1 : 0);
