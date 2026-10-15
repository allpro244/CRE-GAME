// INVESTOR REPUTATION — the score, the street's ranking and the bands.
//   pnpm engine && node test/reputation.mjs
//
// A. The evidence machinery against the worked tables in
//    CAPITAL_RAISING_PLAN.md §3.4 (shrinkage, size weights, fading).
// B. The street in a real game: a new player starts at 0 near the bottom,
//    incumbents open on a derived prehistory, the ranking is strict.
// C. A player's record moving its band: clean deals build it slowly, an
//    upgrade waits out a second quarter, a loss takes it down at once, and the
//    band sets the syndication terms.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= t;

// ── A ───────────────────────────────────────────────────────────────────────
console.log("\nA. the evidence machinery, against the plan's worked tables");
ok(E.outcomeEvidence(0.20, 0.13, 2.0) === 8, "exceptional: beat by 5+ points at 2.0x → +8");
ok(E.outcomeEvidence(0.16, 0.13, 1.5) === 6, "beat by 3 points → +6");
ok(E.outcomeEvidence(0.13, 0.13, 1.5) === 4, "met → +4");
ok(E.outcomeEvidence(0.10, 0.13, 1.3) === -8, "missed by 3, still made money → −8");
ok(E.outcomeEvidence(0.05, 0.13, 1.1) === -15, "missed by 8, money back → −15");
ok(E.outcomeEvidence(0.10, 0.13, 0.8) === -30 && E.outcomeEvidence(0, 0, 0.3) === -60, "losses by the multiple: 0.8x → −30, 0.3x → −60");
const deals = (k, ev, equity, m0 = 0) => Array.from({ length: k }, (_, i) => {
  const size = E.sizeWeight(equity);
  return { m: m0 + i, ev: ev > 0 ? ev * size : ev, size: ev > 0 ? size : 0, kind: "investor", label: "t" };
});
const sc = (ev, now = 20) => E.scoreOf(ev, now);
ok(near(sc(deals(5, 4, 2e6)).score, 11.1, 0.2), `5 clean small deals → +11 (got ${sc(deals(5, 4, 2e6)).score.toFixed(1)})`);
ok(near(sc(deals(10, 4, 2e6)).score, 28.6, 0.2), `10 clean small deals → +29 (got ${sc(deals(10, 4, 2e6)).score.toFixed(1)})`);
ok(near(sc(deals(4, 8, 25e6)).score, 52, 1), `4 big ($25M) exceptional deals → +52 (got ${sc(deals(4, 8, 25e6)).score.toFixed(1)})`);
ok(near(sc(deals(1, 8, 100e6)).score, 14, 1), `1 huge exceptional deal → +14, still luck (got ${sc(deals(1, 8, 100e6)).score.toFixed(1)})`);
{
  const rec = deals(12, 4, 2e6);
  const before = sc(rec).score;
  const after = sc([...rec, { m: 20, ev: -30, size: 0, kind: "investor", label: "loss" }]).score;
  ok(near(before - after, 30, 0.01), `a loss lands in full, unshrunk: ${before.toFixed(1)} → ${after.toFixed(1)}`);
  ok(near(sc(rec, 11 + 84).score, sc(rec, 20).score, 0.01), "a record holds its weight through seven quiet years");
  ok(sc(rec, 11 + 84 + 120).score === 0, "and is gone ten years after that");
}
ok(E.floorBand({ score: 30, n: 10, deals: 10, investorDeals: 0 }) === "Proven" && E.floorBand({ score: 45, n: 10, deals: 10, investorDeals: 0 }) === "Proven",
  "Institutional needs a realised investor vehicle; the floor holds the rest at Proven");
ok(E.floorBand({ score: -20, n: 0, deals: 0, investorDeals: 0 }) === "Questioned" && E.floorBand({ score: -50, n: 0, deals: 0, investorDeals: 0 }) === "Toxic", "Questioned and Toxic are absolute");
ok(E.rankBand(1, 30) === "Blue-chip" && E.rankBand(30, 30) === "Unknown", "rank bands: #1 is Blue-chip by rank, last is Unknown");
ok(E.termsLine(E.BAND_TERMS.Proven) === "9% pref · 20% to you above a 12% IRR · 30% above a 18% IRR", `terms read: ${E.termsLine(E.BAND_TERMS.Proven)}`);

// ── B ───────────────────────────────────────────────────────────────────────
console.log("\nB. the street, in a real game");
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);
const parcels = JSON.parse(JSON.stringify(P0));
let g = E.firstListings(E.newGame(9501, parcels, 2_500_000), parcels, bbls);
for (let m = 0; m < 3; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
{
  const st = E.rankStreet(g);
  const me = st.find((x) => x.id === "you");
  const ranks = new Set(st.map((x) => x.rank));
  const bands = {}; for (const f of st) bands[f.band] = (bands[f.band] ?? 0) + 1;
  console.log(`  ${st.length} firms · ${JSON.stringify(bands)} · you #${me.rank} at ${me.score}`);
  ok(ranks.size === st.length && Math.min(...ranks) === 1, "the ranking is strict: one #1, no shared places");
  ok(me.score === 0 && me.rank > st.length * 0.8, `a new player starts at 0, near the bottom (#${me.rank} of ${st.length})`);
  ok(st[0].score > 5, `incumbents open on a record their capital implies (#1 ${st[0].name} at ${st[0].score})`);
  ok(g.reputation?.band === "Unknown", "and the player's band is Unknown");
}

// ── C ───────────────────────────────────────────────────────────────────────
console.log("\nC. a record moving the band, and the band setting the terms");
{
  // Clean own-money deals, $6M of equity each, met their plans.
  const add = (k, irr, plan, mult, eq = 6e6) => {
    for (let i = 0; i < k; i++) g.exits.push({ bbl: `x${g.exits.length}`, address: `Test ${g.exits.length}`, boughtM: g.month - 36, soldM: g.month, price: 1, basis: 1, gain: 0, equityIn: eq, equityOut: eq * mult, irr, planIrr: plan });
  };
  add(6, 0.16, 0.15, 1.6);
  E.updateReputation(g);
  const r1 = E.reputationNow(g);
  console.log(`  after 6 met deals: score ${r1.score} · #${r1.rank} of ${r1.of} · today ${r1.bandNow} · held ${g.reputation.band} (pending ${g.reputation.pending ?? "—"})`);
  ok(r1.score > 10, `six clean deals build a score (${r1.score})`);
  const firstBand = g.reputation.band;
  ok(firstBand === "Unknown" || E.bandIdx(r1.bandNow) <= E.bandIdx("Unknown"), "an upgrade does not land on the first quarter it is earned");
  g.month += 3; E.updateReputation(g);
  console.log(`  a quarter later: held ${g.reputation.band}`);
  ok(E.bandIdx(g.reputation.band) >= E.bandIdx(r1.bandNow), `two quarters at the new band and it holds (${g.reputation.band})`);
  const terms = E.playerTerms(g);
  ok(terms.perOwn >= 3 && terms.hurdles[0] <= 0.10, `the band sets the terms: $${terms.perOwn} per $1 at a ${terms.hurdles[0] * 100}% pref`);
  // A heavy loss on a deal as big as the rest together.
  g.exits.push({ bbl: "loss", address: "Test loss", boughtM: g.month - 36, soldM: g.month, price: 1, basis: 1, gain: 0, equityIn: 36e6, equityOut: 36e6 * 0.5, irr: -0.2, planIrr: 0.15 });
  E.updateReputation(g);
  console.log(`  after a 0.5x loss: score ${E.reputationNow(g).score} · held ${g.reputation.band}`);
  ok(E.bandIdx(g.reputation.band) < E.bandIdx(terms.band), `a loss takes the band down at once (${terms.band} → ${g.reputation.band})`);
}

console.log(fails ? "\nFAIL" : "\nPASS — the record, the rank and the terms agree");
process.exit(fails ? 1 : 0);
