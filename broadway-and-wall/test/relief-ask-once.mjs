// A RELIEF REQUEST THE AUTO-LEASE DESK ANSWERS IS ANSWERED ONCE.
//
//   pnpm engine && pnpm exec node test/relief-ask-once.mjs
//
// Found in play (seed 20261, 137 Quimby St): the desk declined a tenant's
// request, and because the answer was handed back with Object.assign — which
// copies keys and cannot remove the deleted `asks` — the request stayed on the
// desk. It was "declined" again the next month, the card kept asking the player
// to answer by May after the tenant had filed and gone, and Deals still offered
// Grant / Decline ("That tenant is no longer on the roll"). A request the desk
// GRANTED was logged "lapsed unanswered" a month later and strained the tenant.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
console.log("\nA RELIEF REQUEST IS ANSWERED ONCE\n");

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g0 = E.firstListings(E.newGame(9001, parcels, 80_000_000), parcels, bbls);
let bbl = null;
for (const L of g0.listings ?? []) {
  const rec = E.resolveRec(parcels, g0, L.bbl);
  if (!rec || rec.class === "land" || rec.class === "multifamily" || L.ask > g0.cash) continue;
  const r = E.executePurchase(g0, parcels, L.bbl, L.ask, "cash", false, 1);
  if (!r.err && r.s.holdings[L.bbl].tenants.length) { g0 = r.s; bbl = L.bbl; break; }
}
if (!bbl) throw new Error("no let commercial building on the opening tape");
g0.holdings[bbl].autoLease = true;
g0.holdings[bbl].stance = 0;
g0.lois = [];
const t0 = g0.holdings[bbl].tenants[0];
const ask = (cut) => ({
  id: 1, bbl, name: t0.name, tenantStartM: t0.startM, sf: t0.sf,
  currentPsf: t0.rentPsf, askPsf: +(t0.rentPsf * cut).toFixed(2), addM: 24,
  arrivedM: g0.month, expiresM: g0.month + 3,
});
const said = (g, what) => g.news.filter((n) => n.text.startsWith(what) && n.text.includes(t0.name)).length;

// a deep cut: the desk on Market declines it
{
  const g = structuredClone(g0);
  g.asks = [ask(0.5)];
  E.autoLeaseDesk(g, parcels);
  check(!(g.asks?.length), `declined: the request is off the desk (${g.asks?.length ?? 0} left)`);
  E.autoLeaseDesk(g, parcels);
  check(said(g, "Relief declined") === 1, `declined once, said once (${said(g, "Relief declined")} news lines after a second month)`);
}
// a request at the rent the desk would sign anyway: granted, and the term is added once
{
  const g = structuredClone(g0);
  const rec = E.resolveRec(parcels, g, bbl);
  const a = ask(1);
  a.askPsf = +Math.max(t0.rentPsf, E.managedRentPsfYr(rec, g.econ, { ...g.holdings[bbl], stance: 0 }, t0.use ?? rec.class) * 1.01).toFixed(2);
  g.asks = [a];
  const end0 = t0.endM;
  E.autoLeaseDesk(g, parcels);
  const t = g.holdings[bbl].tenants.find((x) => x.name === t0.name && x.startM === t0.startM);
  if (said(g, "Relief granted") === 1) {
    check(!(g.asks?.length), `granted: the request is off the desk (${g.asks?.length ?? 0} left)`);
    E.autoLeaseDesk(g, parcels);
    check(t.endM === end0 + 24, `granted once: the lease runs ${t.endM - end0} months longer (24 asked)`);
  } else {
    check(!(g.asks?.length), `answered (declined at this rent): the request is off the desk`);
  }
}
console.log(bad ? `\nrelief-ask-once: ${bad} FAILED\n` : "\nrelief-ask-once: ok\n");
process.exit(bad ? 1 : 0);
