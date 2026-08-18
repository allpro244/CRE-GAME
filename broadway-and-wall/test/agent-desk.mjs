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

// (ti/rent + years × 6% fee) × 12 ≤ the 12-month default signing cap.
// Cheap industrial on this tape is a valid buy; planted TI has to fit
// that building's rent or every "should sign" letter refers instead.
function tiUnderCap(rentPsf, termMo, wantTi, cap = 12) {
  const slack = cap / 12 - (termMo / 12) * 0.06;
  const maxTi = Math.max(0.25, slack * rentPsf * 0.9);
  return +Math.min(wantTi, maxTi).toFixed(2);
}

// Buy a commercial building with vacancy potential. Prefer enough floor
// to demise a 2k suite; fall back to whatever commercial is on the tape.
let boughtBbl = null;
function tryBuy(minSf) {
  for (const L of g.listings ?? []) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || rec.class === "multifamily" || L.ask > g.cash) continue;
    if (!(rec.bldgArea >= minSf)) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    if (!r.err) { g = r.s; boughtBbl = L.bbl; return true; }
  }
  return false;
}
if (!tryBuy(8_000)) tryBuy(1);
if (!boughtBbl) throw new Error("no commercial building");

const rec = E.resolveRec(parcels, g, boughtBbl);
const use = rec.class === "retail" ? "retail" : rec.class === "industrial" ? "industrial" : "office";
// Empty the roll so the tour has space to demise into.
g.holdings[boughtBbl].tenants = [];
const market = E.managedRentPsfYr(rec, g.econ, g.holdings[boughtBbl], use) || 40;
const suite = Math.min(
  Math.round(rec.bldgArea * 0.85),
  Math.min(4000, Math.max(2000, Math.round(rec.bldgArea * 0.25))),
);
g.lois = [
  {
    id: 101, bbl: boughtBbl, kind: "new", use, tourId: 7, name: "Lowball LLC",
    sector: "tech", credit: 0, sf: suite, rentPsf: +(market * 0.55).toFixed(2),
    termM: 36, tiPsf: 50, freeM: 8, net: true, expiresM: g.month + 3, arrivedM: g.month,
  },
  {
    id: 102, bbl: boughtBbl, kind: "new", use, tourId: 7, name: "Mandate Clear Co",
    sector: "tech", credit: 1, sf: suite, rentPsf: +(market * 1.02).toFixed(2),
    termM: 96, tiPsf: tiUnderCap(market * 1.02, 96, 4), freeM: 0, net: true, expiresM: g.month + 3, arrivedM: g.month,
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
    termM: 120, tiPsf: tiUnderCap(market * 1.05, 120, 2), freeM: 0, net: true, expiresM: g.month + 3, arrivedM: g.month,
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

// A leasing broker sources tenants. They do not hold the pen.
{
  g.agent = false;
  g.teamLeasing = false;
  g.renewalMgmt = false;
  g.holdings[boughtBbl].broker = true;
  g.holdings[boughtBbl].tenants = [];
  g.lois = [{
    id: 401, bbl: boughtBbl, kind: "new", use, name: "Exclusive Soft Co",
    sector: "tech", credit: 1, sf: suite, rentPsf: +(market * 0.84).toFixed(2),
    termM: 84, tiPsf: 8, freeM: 2, net: true, expiresM: g.month + 3, arrivedM: g.month,
  }];
  check(E.loiNeedsPrincipal(g, g.lois[0]),
    "loiNeedsPrincipal is true while a leasing broker is on the building");
  check(!E.deskCoverage(g, boughtBbl),
    "deskCoverage is null — a broker is not a cover");
  check(!E.deskHoldsPen(g),
    "deskHoldsPen is false when only a leasing broker is hired");
  check(E.exclusiveFeeRate(g.holdings[boughtBbl]) === E.AGENT_FEE,
    "broker still takes 6% when you sign");
  const before = g.lois.length;
  E.runLeasingAgent(g, parcels, { onlyDelegated: true });
  check(g.lois.length === before && !g.lois[0].referred && !g.lois[0].countered,
    "leasing broker does not auto-work paper — you still decide");
  check(g.holdings[boughtBbl].tenants.length === 0,
    "leasing broker did not auto-sign");
  delete g.holdings[boughtBbl].broker;
}

// Hiring staff alone does not take the pen — you must hand them the book.
{
  g.agent = false;
  g.teamLeasing = false;
  g.renewalMgmt = false;
  delete g.holdings[boughtBbl].broker;
  g.holdings[boughtBbl].tenants = [];
  g.staff = [{
    id: 1, name: "Test Leaser", role: "leasing", hiredM: 0, salary: 90_000, band0: 20,
    attrs: { urgency: 70, relationships: 70, marketKnowledge: 70, negotiation: 70, judgment: 70 },
    obs: { urgency: 70, relationships: 70, marketKnowledge: 70, negotiation: 70, judgment: 70 },
    assignedBbls: [],
  }];
  g.lois = [{
    id: 451, bbl: boughtBbl, kind: "new", use, name: "Principal Owns This",
    sector: "tech", credit: 1, sf: suite, rentPsf: +(market * 1.0).toFixed(2),
    termM: 84, tiPsf: tiUnderCap(market, 84, 4), freeM: 0, net: true, expiresM: g.month + 3, arrivedM: g.month,
  }];
  check(E.loiNeedsPrincipal(g, g.lois[0]),
    "loiNeedsPrincipal is true with leasing staff until you hand over the book");
  check(!E.deskCoverage(g, boughtBbl),
    "deskCoverage is null for staff until teamLeasing is on");
  check(!E.deskHoldsPen(g),
    "deskHoldsPen is false when staff are hired but the book was not handed over");
  const before = g.lois.length;
  E.workLeasingDesk(g, parcels);
  check(g.lois.length === before && !g.lois[0].referred,
    "workLeasingDesk leaves letters alone when the principal holds the book");
  check(g.holdings[boughtBbl].tenants.length === 0,
    "staff did not auto-sign while the player has leasing");

  // Hand the book to the team — quiet desk, in-house rates.
  g.teamLeasing = true;
  check(!!E.deskCoverage(g, boughtBbl) && E.deskCoverage(g, boughtBbl).kind === "staff",
    "deskCoverage is staff after handing the book over");
  check(E.deskHoldsPen(g), "deskHoldsPen is true when the team has the book");
  check(!E.loiNeedsPrincipal(g, g.lois[0]),
    "unreferred LOI is quiet once the team has the book");
  E.workLeasingDesk(g, parcels);
  check(
    g.holdings[boughtBbl].tenants.some((t) => t.name === "Principal Owns This")
      || g.lois.some((l) => l.id === 451 && l.referred)
      || !g.lois.some((l) => l.id === 451),
    "team desk worked the letter (signed, passed, or referred)",
  );
  g.staff = [];
  delete g.teamLeasing;
}

console.log("\nQUIET DESK SCORECARD\n");
{
  g.agent = true;
  g.holdings[boughtBbl].tenants = [];
  g.deskMonth = undefined;
  g.lois = [
    {
      id: 501, bbl: boughtBbl, kind: "new", use, name: "Junk Pass Co",
      sector: "tech", credit: 0, sf: suite, rentPsf: +(market * 0.5).toFixed(2),
      termM: 36, tiPsf: 80, freeM: 12, net: true, expiresM: g.month + 3, arrivedM: g.month,
    },
    {
      id: 502, bbl: boughtBbl, kind: "new", use, name: "Clear Sign Co",
      sector: "finance", credit: 2, sf: suite, rentPsf: +(market * 1.05).toFixed(2),
      termM: 120, tiPsf: tiUnderCap(market * 1.05, 120, 2), freeM: 0, net: true, expiresM: g.month + 3, arrivedM: g.month,
    },
  ];
  g.cash = Math.max(g.cash, 20_000_000);
  E.runLeasingAgent(g, parcels);
  const dm = E.deskMonthNow(g);
  check(!!dm, "deskMonthNow reports activity after the desk runs");
  check((dm?.signed ?? 0) + (dm?.passed ?? 0) + (dm?.referred ?? 0) + (dm?.walked ?? 0) > 0,
    "scorecard recorded at least one desk action");
  check(E.deskHoldsPen(g), "deskHoldsPen is true with the firm agent on");
  // Unreferred leftover (if any) must not need the principal while agent is on.
  for (const l of g.lois) {
    if (!l.referred) check(!E.loiNeedsPrincipal(g, l), `unreferred ${l.name} stays quiet under the agent`);
    else check(E.loiNeedsPrincipal(g, l), `referred ${l.name} still needs the principal`);
  }
}

console.log("");
process.exit(bad ? 1 : 0);
