// District rezoning over a century — zoneAdj moves, variance still per-site.
//   pnpm engine && pnpm zoning
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const startAdj = { ...(g.zoneAdj ?? {}) };
for (let m = 0; m < 600; m++) {
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
}

const endAdj = g.zoneAdj ?? {};
const distCount = new Set(bbls.map((b) => parcels[b]?.district).filter(Boolean)).size;
const needTouched = Math.min(3, Math.max(2, distCount - 1));
ok("rezoning touched districts", Object.keys(endAdj).length >= needTouched,
  `${Object.keys(endAdj).length} districts (city has ${distCount}, need ${needTouched})`);
const moved = Object.keys(endAdj).some((d) => (endAdj[d] ?? 1) !== (startAdj[d] ?? 1));
ok("at least one district envelope changed", moved);

// THE BAND IS READ OFF THE ENGINE, not written down here. It was hardcoded at
// 0.72-2.6 and the engine's ceiling moved to 3.8; the harness then failed for
// a year of commits about a promise nobody had made since. A test that carries
// its own copy of a constant is a test that measures the day it was written.
const vals = Object.values(endAdj);
ok("envelope stays within the rezoning process's own band",
  vals.every((v) => v >= E.FAR_FLOOR && v <= E.FAR_CEIL),
  `min=${Math.min(...vals).toFixed(2)} max=${Math.max(...vals).toFixed(2)} · band ${E.FAR_FLOOR}-${E.FAR_CEIL}`);

// Variance path still independent (see test/variance.mjs for filing detail).
const lot = bbls.find((b) => parcels[b]?.lotArea > 2_000 && !g.landmarks?.[b]);
let room;
ok("city has a variance-eligible lot", !!lot);
if (lot) {
  // NULL IS AN ANSWER HERE, AND IT IS THE RIGHT ONE ON A SITE AT THE CITY CAP.
  // This crashed on `q.grant` after a century: a district that has been
  // upzoned toward FAR_CEIL carries lots already at FAR_CEILING, and there is
  // nothing left for a board to grant on those. What the harness should check
  // is that the quote is coherent WHEN there is headroom — so it looks for a
  // site that has some, and says so when the whole sample is capped out.
  room = bbls.find((b) => {
    if (g.landmarks?.[b]) return false;
    const rec = E.resolveRec(parcels, g, b);
    if (!rec?.lotArea) return false;
    return Math.max(rec.farMaxComm, rec.farMaxRes, 2) < E.FAR_CEILING * 0.8;
  });
  ok("the century city still has a site with envelope headroom", !!room);
  if (room) {
    const q = E.varianceQuote(g, parcels, room, undefined);
    ok("variance quote on century state", !!q && q.grant > 0 && q.odds > 0 && q.odds < 1,
      q ? `grant=${q.grant} odds=${q.odds.toFixed(2)}` : "quote came back null");
  }
  const capped = E.varianceQuote(g, parcels, lot, 4);
  ok("a site already at the city ceiling quotes nothing rather than a free grant",
    capped === null || capped.grant > 0);
}

// ---- a grant changes developable SF on a fixed lot -------------------------
//
// The whole point of the hearing: the envelope you can actually build must be
// bigger after a grant than before it, on the SAME lot, read through the same
// resolveRec every desk reads. The board's coin flip is forced to heads by
// setting the filed application's odds to 1 — that is rigging the draw, not
// the measurement: what is asserted is the wiring downstream of the decision.
//
// ON A SITE WITH ROOM TO GRANT, which is not the same as the first lot in the
// table. This ran on `lot` — the first parcel over 2,000 sf — and after a
// century of upzonings that parcel sits at the city's 40 FAR ceiling, so the
// board correctly refused to quote and the harness read the refusal as a
// broken filing. Nothing downstream of the decision was being measured at all.
if (room) {
  const site = room;
  g = { ...g, cash: 50_000_000 };
  if (!g.holdings[site]) {
    const rec0 = parcels[site];
    const basis = Math.round(E.landValue(rec0, g.econ));
    g.holdings[site] = {
      bbl: site, boughtM: g.month, costBasis: basis, assessed: basis,
      condition: "average", condIdx: 0.55, svcIdx: 0.55,
      tenants: [], loan: null, cfHistory: [], service: 0, plan: 1,
    };
  }
  const before = E.resolveRec(parcels, g, site);
  const farBefore = Math.max(before.farMaxComm, before.farMaxRes, 2);
  const sfBefore = before.lotArea * farBefore;
  const filed = E.fileVariance(g, parcels, site);
  ok("variance files on the fixed site", !filed.err, filed.err ?? "");
  if (!filed.err) {
    g = filed.s;
    g.varianceApps[site].odds = 1;
    g.month = g.varianceApps[site].decideM;
    E.tickPlanning(g, parcels, bbls);
    ok("hearing resolves and records its decision", !!g.varianceLog?.[site] && g.varianceLog[site].granted);
    const after = E.resolveRec(parcels, g, site);
    const farAfter = Math.max(after.farMaxComm, after.farMaxRes, 2);
    const sfAfter = after.lotArea * farAfter;
    ok("grant changes developable SF on the fixed site", sfAfter > sfBefore * 1.05,
      `${Math.round(sfBefore).toLocaleString()} sf -> ${Math.round(sfAfter).toLocaleString()} sf (+${((sfAfter / sfBefore - 1) * 100).toFixed(0)}%)`);
  }
  }


// ---- rezonings are readable, not just news ---------------------------------
const rez = Object.entries(g.zoneLog ?? {});
ok("every rezoned district has a readable log entry", Object.keys(endAdj).every((d) => g.zoneLog?.[d]),
  `${rez.length} logged of ${Object.keys(endAdj).length} rezoned`);
ok("log direction agrees with where the envelope sits", rez.every(([d, l]) => (l.adj === endAdj[d]) && (l.dir === 1 || l.dir === -1)));

// ---- a landmark freezes the envelope ---------------------------------------
const marked = Object.keys(g.landmarks ?? {})[0];
if (marked) {
  const demo = E.demolish({ ...g, holdings: { ...g.holdings, [marked]: g.holdings[marked] ?? { bbl: marked, boughtM: 0, costBasis: 1, assessed: 1, condition: "average", condIdx: 0.5, svcIdx: 0.5, tenants: [], loan: null, cfHistory: [], service: 0, plan: 1 } } }, parcels, marked);
  ok("landmark blocks demolition", !!demo.err, demo.err ?? "demolition went through");
  ok("landmark refuses a variance quote", E.varianceQuote(g, parcels, marked, 4) === null);
} else {
  console.log("  (no landmark designated in this century — freeze asserts skipped)");
}

console.log(`\n${fails === 0 ? "zoning pass" : `${fails} zoning failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
