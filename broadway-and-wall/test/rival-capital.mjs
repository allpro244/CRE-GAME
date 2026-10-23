// RIVALS RAISE ON THEIR RECORD — the plan's last three rival steps.
//   pnpm engine && node test/rival-capital.mjs
//
// CAPITAL_RAISING_PLAN.md §3.4 "Rivals". A. An offering is pitched to its
// investors net of the promote (waterfall.ts lpNetIrr), for the player and
// rivals alike, so a deal delivered on plan reads as a promise met. B. A
// rival's syndicated deal carries that pitch and is judged on the investors'
// realised IRR against it. C. A spinout carries part of its team's record.
// D. A deal-by-deal rival raises on the player's terms table for its band
// (GameState.rivalDealTerms, a setup choice, on by default since Oct 2026). E. In a real game: jobs carry
// their pitch and their terms, and the street's bands set them.
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
console.log("\nA. the pitch is the investors' own, net of the promote");
{
  const p = 0.18, yrs = 3;
  ok(near(E.lpNetIrr(p, yrs, [0.08], [0]), p, 1e-9), "no promote: the investors are pitched the project's IRR");
  const net = E.lpNetIrr(p, yrs, [0.08], [0.20]);
  ok(net < p && net > 0.08, `8% pref, 20% promote: 18.0% on the project is ${(net * 100).toFixed(1)}% to the investors`);
  ok(near(E.lpNetIrr(0.06, yrs, [0.08], [0.20]), 0.06, 1e-9), "below the pref nothing is promoted: the pitch is the project's");
  // The tiers: Proven terms, 9% pref, 20% above 12%, 30% above 18%.
  const t = E.BAND_TERMS.Proven;
  const a = E.lpNetIrr(0.15, 3, t.hurdles, t.promotes), b = E.lpNetIrr(0.25, 3, t.hurdles, t.promotes);
  ok(a > 0.12 && a < 0.15 && b > 0.18 && b < 0.25, `Proven tiers: 15% → ${(a * 100).toFixed(1)}%, 25% → ${(b * 100).toFixed(1)}%`);
  ok(E.outcomeEvidence(net, net, 1.6) === 4, "a deal that delivers its projection exactly is a promise met (+4), not a miss");
}

// ── B ───────────────────────────────────────────────────────────────────────
console.log("\nB. a rival's syndicated deal is judged against its pitch");
const mk = (over = {}) => ({ id: "t", name: "Test Co", style: "merchant", cash: 0, debt: 0, bbls: [], targetLtv: 0.6, bornM: 24, aum: 10e6, ...over });
const game = { month: 120, econ: { priceLevel: 1, cpi: 1, history: [] }, rivals: [], news: [] };
{
  const r = mk();
  // In at month 72 (money-weighted), out at 120: four years. 1.6x is 12.5% a year.
  E.noteRealised(game, r, { lp: 9e6, gp: 1e6, m: 60, mw: 72, pitch: 0.125 }, 0, 14.4e6);
  const row = r.realised[0];
  ok(near(row.irr, 0.125, 0.002) && row.pitch === 0.125, `the row carries the investors' realised IRR (${(row.irr * 100).toFixed(1)}%) and the pitch`);
  ok(E.rivalEvidence(game, r)[0].ev > 0, "delivered on its pitch: a promise met");
  const miss = mk();
  E.noteRealised(game, miss, { lp: 9e6, gp: 1e6, m: 60, mw: 72, pitch: 0.20 }, 0, 14.4e6);
  ok(E.rivalEvidence(game, miss)[0].ev < 0, "the same money against a 20% pitch is a miss, though the investors made 1.6x");
  const old = mk();
  E.noteRealised(game, old, { lp: 9e6, gp: 1e6, m: 60 }, 0, 14.4e6);
  ok(old.realised[0].pitch === undefined && E.rivalEvidence(game, old)[0].ev > 0, "a deal raised before pitches were recorded is judged on the money alone");
}

// ── C ───────────────────────────────────────────────────────────────────────
console.log("\nC. a spinout carries part of its team's record");
{
  const parent = mk({ id: "p", name: "Parent & Co", style: "pe", bornM: 0, eqHist: [[0, 30e6]] });
  for (let i = 0; i < 5; i++) { game.month = 70 + 10 * i; E.noteRealised(game, parent, undefined, 8e6, 0); }
  game.month = 112; E.noteRealised(game, parent, undefined, 8e6, 0, true);   // a deed lost to its lender
  game.month = 120;
  const pe = E.rivalEvidence(game, parent);
  const her = E.inheritRecord(game, parent);
  // Inside the thirty-year window the score reads; older evidence is already gone.
  const pos = pe.filter((e) => e.ev > 0 && game.month - e.m <= 360).reduce((a, e) => a + e.ev, 0);
  const got = her.reduce((a, h) => a + h.ev, 0);
  ok(her.length > 0 && her.every((h) => h.ev > 0), `only the positive evidence comes (${her.length} rows; the parent's loss stays behind)`);
  ok(near(got, pos * E.HERITAGE_SHARE, 0.05), `at ${E.HERITAGE_SHARE * 100}% of it (${got.toFixed(1)} of ${pos.toFixed(1)})`);
  const kid = mk({ id: "k", bornM: 120, heritage: her, spawnedFrom: { firmId: "p", firmName: "Parent & Co" } });
  const sk = E.scoreOf(E.rivalEvidence(game, kid), game.month);
  const fresh = E.scoreOf(E.rivalEvidence(game, mk({ id: "f", bornM: 120 })), game.month);
  ok(sk.score > fresh.score && fresh.score === 0, `the spinout opens on ${sk.score.toFixed(1)}; a new name opens on 0`);
}

// ── D ───────────────────────────────────────────────────────────────────────
console.log("\nD. a deal-by-deal builder raises on the player's terms for its band");
{
  const g = { ...game, rivalDealTerms: true, reputation: { band: "Unknown", score: 0, rank: 1, of: 1, m: 120, street: { a: "Institutional", b: "Unknown", c: "Questioned", d: "Toxic", e: "Blue-chip" } } };
  const share = (id, style = "merchant") => E.sponsorShareOf(g, mk({ id, style }));
  ok(near(share("a"), 0.10, 1e-9), "Institutional: $9 per $1 — the 90/10 JV");
  ok(near(share("b"), 0.50, 1e-9), "Unknown: $1 per $1");
  ok(near(share("c"), 1 / 1.5, 1e-9), "Questioned: fifty cents per $1");
  ok(share("d") === 1, "Toxic: nobody — the firm writes the whole cheque");
  ok(near(share("e"), 0.05, 1e-9), "Blue-chip: $19 per $1");
  ok(share("a", "pe") === 1, "a fund vehicle raised at the fund and writes its own cheques, whatever its band");
  ok(E.sponsorShareOf({ ...g, rivalDealTerms: false }, mk({ id: "d" })) === 0.10, "off, every builder raises 90/10 as before");
}

// ── E ───────────────────────────────────────────────────────────────────────
console.log("\nE. in a real game");
{
  const { loadCity } = await import(join(HERE, "city.mjs"));
  const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(7101, parcels, 2_500_000), parcels, bbls);
  ok(g.rivalReputation === true && g.rivalDealTerms === true, "record-raised first closes and deal terms by band are both on by default");
  const formed = [];
  for (let m = 0; m < 72; m++) {
    const before = new Map(g.rivals.map((r) => [r.id, new Set(Object.keys(r.jvs ?? {}))]));
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    for (const r of g.rivals) for (const [b, jv] of Object.entries(r.jvs ?? {})) if (!before.get(r.id)?.has(b)) formed.push({ r: r.id, band: g.reputation?.street?.[r.id] ?? "Unknown", jv });
  }
  const priced = formed.filter((f) => f.jv.pitch !== undefined);
  console.log(`  six years: ${formed.length} syndicated jobs formed · ${priced.length} with a pitch · terms ${[...new Set(formed.map((f) => `${f.band}:${(1 - f.jv.g) / f.jv.g}`))].join(" ")}`);
  ok(formed.length > 0 && formed.every((f) => f.jv.g > 0 && f.jv.g < 1), "every deal formed records the sponsor's share it was raised on");
  ok(priced.length > 0 && priced.every((f) => Number.isFinite(f.jv.pitch)), "jobs that break ground on a plan carry the offering's pitch");
  ok(Object.keys(g.reputation?.street ?? {}).length > 0, "the quarterly ranking leaves every rival's band where a raise can read it");
  const rows = g.rivals.flatMap((r) => r.realised ?? []).filter((x) => x.lp && x.pitch !== undefined);
  console.log(`  syndicated exits judged against a pitch: ${rows.length}${rows.length ? ` (investors ${rows.map((x) => `${(x.irr * 100).toFixed(0)}% vs ${(x.pitch * 100).toFixed(0)}%`).slice(0, 6).join(", ")})` : ""}`);
}

console.log(fails ? "\nFAIL" : "\nPASS — rivals pitch, deliver, inherit and raise on the same record as the player");
process.exit(fails ? 1 : 0);
