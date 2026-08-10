// LEASING AGENT — hire clears the desk; tours do not dump every letter on you.
//
//   pnpm engine && pnpm exec node test/agent-desk.mjs
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

console.log("\nLEASING AGENT DESK\n");

check(typeof E.runLeasingAgent === "function", "runLeasingAgent is exported");

const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(9001, parcels, 80_000_000), parcels, bbls);
// Buy a commercial building with vacancy potential.
let boughtBbl = null;
for (const L of g.listings ?? []) {
  const rec = E.resolveRec(parcels, g, L.bbl);
  if (!rec || rec.class === "land" || rec.class === "multifamily" || !rec.bldgArea || L.ask > g.cash) continue;
  const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
  if (!r.err) { g = r.s; boughtBbl = L.bbl; break; }
}
if (!boughtBbl) throw new Error("no commercial building");

const rec = E.resolveRec(parcels, g, boughtBbl);
const use = rec.class === "retail" ? "retail" : rec.class === "industrial" ? "industrial" : "office";
// Empty the roll so the tour has space to demise into.
g.holdings[boughtBbl].tenants = [];
const market = E.managedRentPsfYr(rec, g.econ, g.holdings[boughtBbl], use) || 40;
const suite = Math.min(4000, Math.max(2000, Math.round(rec.bldgArea * 0.25)));
g.lois = [
  {
    id: 101, bbl: boughtBbl, kind: "new", use, tourId: 7, name: "Lowball LLC",
    sector: "tech", credit: 0, sf: suite, rentPsf: +(market * 0.55).toFixed(2),
    termM: 36, tiPsf: 50, freeM: 8, net: true, expiresM: g.month + 3, arrivedM: g.month,
  },
  {
    id: 102, bbl: boughtBbl, kind: "new", use, tourId: 7, name: "Mandate Clear Co",
    sector: "tech", credit: 1, sf: suite, rentPsf: +(market * 1.02).toFixed(2),
    termM: 96, tiPsf: 4, freeM: 0, net: true, expiresM: g.month + 3, arrivedM: g.month,
  },
  {
    id: 103, bbl: boughtBbl, kind: "new", use, tourId: 7, name: "Soft Middle Inc",
    sector: "tech", credit: 1, sf: suite, rentPsf: +(market * 0.82).toFixed(2),
    termM: 60, tiPsf: 15, freeM: 3, net: true, expiresM: g.month + 3, arrivedM: g.month,
  },
];
g.agent = true;
g.agentFloor = 0.90;
g.agentPassBelow = 0.78;
g.cash = Math.max(g.cash, 20_000_000);

const beforeTenants = g.holdings[boughtBbl].tenants.length;
E.runLeasingAgent(g, parcels);
const afterIds = g.lois.map((l) => l.id);
const signed = g.holdings[boughtBbl].tenants.length > beforeTenants;
check(signed, "agent signed the clear tour winner");
check(!afterIds.includes(101) && !afterIds.includes(102) && !afterIds.includes(103),
  "entire contested tour cleared off the desk after a clear winner");
check(!E.attentionItems(g).some((a) => a.key.startsWith("loi:")),
  "no LOI attention items when agent left an empty referred pile");

// Hire-path: open letters, agent off → runLeasingAgent after flag.
{
  g.agent = false;
  g.lois = [{
    id: 201, bbl: boughtBbl, kind: "new", use, name: "Cheap Ask",
    sector: "tech", credit: 0, sf: suite, rentPsf: +(market * 0.5).toFixed(2),
    termM: 36, tiPsf: 60, freeM: 10, net: true, expiresM: g.month + 3, arrivedM: g.month,
  }, {
    id: 202, bbl: boughtBbl, kind: "new", use, name: "Good Ask",
    sector: "finance", credit: 2, sf: suite, rentPsf: +(market * 1.05).toFixed(2),
    termM: 120, tiPsf: 2, freeM: 0, net: true, expiresM: g.month + 3, arrivedM: g.month,
  }];
  g.agent = true;
  E.runLeasingAgent(g, parcels);
  check(!g.lois.some((l) => !l.referred), "after the desk runs, every surviving letter is referred");
  check(E.attentionItems(g).every((a) => !a.key.startsWith("loi:") || g.lois.some((l) => l.referred && a.key === `loi:${l.id}`)),
    "attention only tracks referred letters while the agent holds the book");
}

// Mid-band single letter: desk counters instead of dumping it on you.
{
  g.agent = true;
  g.agentFloor = 0.90;
  g.agentPassBelow = 0.78;
  g.holdings[boughtBbl].tenants = [];
  g.lois = [{
    id: 301, bbl: boughtBbl, kind: "new", use, name: "Soft But Close LLC",
    sector: "tech", credit: 1, sf: suite, rentPsf: +(market * 0.84).toFixed(2),
    termM: 84, tiPsf: 8, freeM: 2, net: true, expiresM: g.month + 3, arrivedM: g.month,
  }];
  g.cash = Math.max(g.cash, 20_000_000);
  const score0 = E.loiMandateScore(g.lois[0], market);
  check(score0 >= 0.78 && score0 < 0.90, `fixture sits in the counter band (score ${score0.toFixed(3)})`);
  E.runLeasingAgent(g, parcels);
  const still = g.lois.find((l) => l.id === 301);
  const signed = g.holdings[boughtBbl].tenants.some((t) => t.name === "Soft But Close LLC");
  const news = (g.news ?? []).slice(0, 12).map((n) => n.text).join(" ");
  const negotiated = signed
    || /countered|walked|came back|took .* final/i.test(news)
    || (still?.referred && /counter/i.test(news));
  check(negotiated, "mid-band letter was negotiated (signed, walked, or referred only after a counter)");
  check(!(still && !still.referred && !still.countered),
    "soft letter did not sit untouched on the open pile");
}

// Exclusive broker covers a building without the firm-wide agent toggle.
{
  g.agent = false;
  g.holdings[boughtBbl].broker = { name: "Street & Co", hiredM: g.month };
  g.holdings[boughtBbl].tenants = [];
  g.lois = [{
    id: 401, bbl: boughtBbl, kind: "new", use, name: "Exclusive Soft Co",
    sector: "tech", credit: 1, sf: suite, rentPsf: +(market * 0.84).toFixed(2),
    termM: 84, tiPsf: 8, freeM: 2, net: true, expiresM: g.month + 3, arrivedM: g.month,
  }];
  E.runLeasingAgent(g, parcels, { onlyDelegated: true });
  const still = g.lois.find((l) => l.id === 401);
  const news = (g.news ?? []).slice(0, 12).map((n) => n.text).join(" ");
  check(
    !still || still.referred || still.countered || /exclusive|countered|walked/i.test(news),
    "exclusive broker works soft paper without the firm agent toggle",
  );
  delete g.holdings[boughtBbl].broker;
}

console.log("");
process.exit(bad ? 1 : 0);
