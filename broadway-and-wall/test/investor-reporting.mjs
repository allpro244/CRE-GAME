// INVESTOR REPORTING — warning signs on live deals, misconduct, re-ups.
//   pnpm engine && node test/investor-reporting.mjs
//
// On a real syndicated job (a $1M sponsor, seed 9401 or the next that funds one):
// A. the quarterly report raises a flag when the job runs late; each flag is
//    −3 of provisional evidence, at most −10 a deal (CAPITAL_RAISING_PLAN.md
//    §3.4, "warning signs before the end");
// B. a deed lost while its job is still in the ground is a broken completion
//    guarantee: −25 on top of the outcome, and the sponsor is Toxic while the
//    mark lives (twenty years);
// C. investors who were paid back re-up faster; those who lost money stay
//    mostly out for a decade (§3.2, relationship).
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fails++; };

// A syndicated job in the first two years: seed 9401 first (the deal
// test/syndicate.mjs plays), then the next seed if a re-rolled world gives
// 9401 nothing to fund — which seed carries the deal is not under test.
let parcels, g, lot = null;
// (the lots that pencil move with the city: the plan-13 plates let a lot
// carry more floors, so dirt prices up and the early cheap lot comes later)
for (const seed of [9401, 7101, 9404, 550991, 9402, 9405, 12007]) {
parcels = JSON.parse(JSON.stringify(P0));
g = E.firstListings(E.newGame(seed, parcels, 1_000_000), parcels, bbls);
for (let m = 0; m < 36 && !lot; m++) {
  if (g.month % 3 === 0) {
    const own0 = E.fundableNow(g, parcels);
    let pick = null;
    for (const L of g.listings ?? []) {
      const rec = E.resolveRec(parcels, g, L.bbl);
      if (!rec || rec.class !== "land" || L.ask > own0 * 0.8) continue;
      for (const u of ["multifamily", "office", "retail", "industrial"]) for (const f of [2, 3, 4, 6, 8, 12]) {
        const p = E.planDevelopment(g, parcels, L.bbl, u, f, 0.6, "gmp");
        if (!p || p.hurdleRatio < 0.9) continue;
        const need = E.devFundingNeed(p).whole;
        if (need <= own0 - L.ask || need > (own0 - L.ask) * 2.2) continue;
        if (!pick || p.hurdleRatio > pick.p.hurdleRatio) pick = { L, u, f, p };
      }
    }
    if (pick) {
      const r = E.executePurchase(g, parcels, pick.L.bbl, pick.L.ask, "cash", false, 1);
      const g1 = r.s, b = pick.L.bbl;
      const outside = E.maxOutside(g1, E.devFundingNeed(pick.p).whole, E.ownedHoldingValue(g1, parcels, g1.holdings[b]));
      const rr = E.startDevelopment(g1, parcels, b, pick.u, pick.f, 0.6, "gmp", undefined, { syndicate: { outside } });
      if (!rr.err) { g = rr.s; lot = b; }
    }
  }
  if (!lot) g = E.advanceMonth(g, parcels, bbls, adjacency);
}
if (lot) break;
}
ok(!!lot, `a syndicated job to report on (${lot})`);
const w = g.syndications[lot];
ok(w.pitchDeliverM > g.month && w.pitchNoi > 0 && w.cashNeed > 0 && w.building === true, `the pitch is on the deal: delivery m${w.pitchDeliverM}, NOI $${Math.round(w.pitchNoi).toLocaleString()}, cash need $${Math.round(w.cashNeed).toLocaleString()}`);

console.log("\nA. warning signs");
{
  const t = structuredClone(g);
  E.reviewSyndications(t, parcels);
  ok(!(t.syndications[lot].flags?.length), "a job on schedule raises no flag");
  t.syndications[lot].pitchDeliverM = t.month - 7;   // running seven months past what was pitched
  E.reviewSyndications(t, parcels);
  const tw = t.syndications[lot];
  ok(tw.flags?.includes("late"), `a job past its pitched delivery is flagged (${tw.flags?.join(", ")})`);
  const ev = E.playerEvidence(t).filter((e) => e.kind === "warning");
  ok(ev.length === 1 && ev[0].ev === -3, `one flag is −3 provisional (${ev.map((e) => e.ev).join(", ")})`);
  tw.flags = ["late", "over", "leaseup", "dist"];
  ok(E.playerEvidence(t).find((e) => e.kind === "warning").ev === -10, "four flags cap at −10 a deal");
}

console.log("\nB. a broken completion guarantee");
{
  const t = structuredClone(g);
  // The deed is lost while the job is still in the ground.
  delete t.holdings[lot];
  delete t.developments[lot];
  E.settleSyndications(t, parcels, false, lot);
  const rec = t.synClosed.at(-1);
  ok(rec?.misconduct === true && !t.syndications[lot], "the deal closes with the guarantee broken");
  const ev = E.playerEvidence(t);
  ok(ev.some((e) => e.kind === "misconduct" && e.ev === -25), "−25 for the misconduct itself");
  E.updateReputation(t);
  ok(t.reputation.band === "Toxic", `the sponsor is Toxic while the mark lives (${t.reputation.band})`);
  ok(!(E.playerTerms(t).perOwn > 0) && E.syndicateBar(t, Object.keys(t.holdings)[0] ?? "x") !== null, "and nobody will invest");
  const later = E.scoreOf(ev, t.month + 241);
  ok(!later.misconduct, "the mark fades out after twenty years");
}

console.log("\nC. re-ups");
{
  const t = structuredClone(g);
  t.synClosed = [
    { bbl: "a", address: "A", investor: "x", formedM: t.month - 60, closedM: t.month, lpIn: 1e6, lpOut: 1.6e6, lpIrr: 0.15, gpIn: 1e6, gpOut: 1.5e6, sources: { family: 1e6 } },
    { bbl: "b", address: "B", investor: "x", formedM: t.month - 60, closedM: t.month, lpIn: 1e6, lpOut: 0.8e6, lpIrr: -0.05, gpIn: 1e6, gpOut: 0.5e6, sources: { local: 1e6 } },
  ];
  const fam = E.relationshipFactor(t, "family"), loc = E.relationshipFactor(t, "local"), end = E.relationshipFactor(t, "endowment");
  console.log(`  family offices paid 1.6x: ×${fam} · local money that lost 20%: ×${loc} · endowments, no history: ×${end}`);
  ok(fam === 1.5, "investors paid back well re-up fastest (capped at +50%)");
  ok(loc === 0.3, "investors who lost money mostly stay out");
  ok(end === 1, "investors with no history with you read only your rank");
  t.month += 121;
  ok(E.relationshipFactor(t, "local") === 1, "and the memory fades after ten years");
}

console.log(fails ? "\nFAIL" : "\nPASS — investors read the reports, remember the broken promise, and re-up with the ones who paid");
process.exit(fails ? 1 : 0);
