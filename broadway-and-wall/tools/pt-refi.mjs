// PLAYTEST PROBE — DOES THE REFI DESK OFFER QUOTES IT WILL NOT HONOUR?
// (throwaway, research only)
//
// The tournament logged tens of thousands of refinance() rejections whose text
// names a rule the QUOTE ITSELF should already have known — "Land money is for
// dirt. This one has a building on it", "Mezzanine sits behind a senior". That
// is CLAUDE.md's third fake: the same question with two different answers, one
// from refiQuotes() and one from refinance(). This probe asks it directly:
// for every quote the desk hands back, try to execute it, and record which
// ones are refused and why.
//
//   node tools/pt-refi.mjs '{"citySeed":1001,"marketSeed":7020,"size":"city"}'
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const E = await import(join(ROOT, "test/.engine.mjs"));
const { makeCity, PROCEDURAL } = await import(join(ROOT, "src/citygen/index.mjs"));

const cfg = JSON.parse(process.argv[2]);
const MONTHS = cfg.months ?? 600;
const built = makeCity(PROCEDURAL, cfg.citySeed, { size: cfg.size });
E.normalizeParcels(built.parcels);
const parcels = built.parcels, adjacency = built.adjacency, bbls = Object.keys(parcels);

let g = E.firstListings(E.newGame(cfg.marketSeed, parcels, 40_000_000), parcels, bbls);
g.citySize = cfg.size;

const offered = new Map();   // productId -> times offered
const refused = new Map();   // productId :: reason -> count
const accepted = new Map();
let quoteCalls = 0, emptyQuoteCalls = 0, holdingsSeen = 0, strandedHoldings = 0;
const liveCounts = [];

// Buy a broad book quickly so there is something to refinance, then every
// quarter interrogate the refi desk on every holding.
for (let m = 0; m < MONTHS; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 4e7 };

  // keep the book stocked
  if (Object.keys(g.talks ?? {}).length < 3 && g.cash > 8e6) {
    for (const l of (g.listings ?? []).slice(0, 40)) {
      if (g.holdings[l.bbl]) continue;
      const r = E.negotiate(g, parcels, l.bbl, Math.round(l.ask * 0.95));
      if (!r.err) { g = r.s; break; }
    }
  }
  for (const t of Object.values(g.talks ?? {})) {
    if (t.agreed) {
      const rec = E.resolveRec(parcels, g, t.bbl);
      const prod = rec?.class === "land" ? "land" : "savings";
      let r = E.closeDeal(g, parcels, t.bbl, prod, 0.65);
      if (r.err) r = E.closeDeal(g, parcels, t.bbl, "cash", 1);
      if (!r.err) g = r.s;
    } else if (t.final) g = E.walkAway(g, parcels, t.bbl).s;
    else { const r = E.negotiate(g, parcels, t.bbl, Math.round((t.yourPrice + t.theirPrice) / 2)); if (!r.err) g = r.s; }
  }
  // lease what we can so some assets have income and some do not
  for (const loi of [...(g.lois ?? [])]) {
    const r = E.respondLOI(g, parcels, loi.id, "accept", true);
    if (!r.err) g = r.s;
  }

  if (m % 3 !== 0 || m < 24) continue;

  for (const h of Object.values(g.holdings)) {
    if (g.developments?.[h.bbl]) continue;
    holdingsSeen++;
    const { quotes } = E.refiQuotes(g, parcels, h.bbl);
    quoteCalls++;
    if (!quotes?.length) { emptyQuoteCalls++; continue; }
    // CORRECTION TO AN EARLIER READ OF THIS PROBE. The desk marks the quotes
    // it will not honour with `available:false` and a plain-English `why`;
    // executing every quote regardless made the engine look like it was
    // contradicting itself when it was not. Only quotes the desk presents as
    // LIVE are counted as promises, and the unavailable ones are tallied
    // separately as what they are — a priced menu with most rows greyed out.
    let liveHere = 0;
    for (const q of quotes) {
      offered.set(q.id, (offered.get(q.id) ?? 0) + 1);
      if (q.available === false) {
        const k = `UNAVAILABLE ${q.id} :: ${q.why ?? "(no reason given)"}`;
        refused.set(k, (refused.get(k) ?? 0) + 1);
        continue;
      }
      liveHere++;
      const res = E.refinance(g, parcels, h.bbl, q.id, 1);
      if (res.err) {
        // A quote the desk called live that still will not execute. THIS is
        // the only category that is a genuine contradiction.
        const k = `BROKEN-PROMISE ${q.id} :: ${res.err}`;
        refused.set(k, (refused.get(k) ?? 0) + 1);
      } else {
        accepted.set(q.id, (accepted.get(q.id) ?? 0) + 1);
      }
    }
    liveCounts.push(liveHere);
    if (liveHere === 0) strandedHoldings++;
  }
}

const rows = [...offered.entries()].map(([id, off]) => ({
  id, offered: off, accepted: accepted.get(id) ?? 0,
  refusedPct: 100 * (1 - (accepted.get(id) ?? 0) / off),
})).sort((a, b) => b.offered - a.offered);

process.stdout.write(JSON.stringify({
  kind: "refi", cfg, holdingsSeen, quoteCalls, emptyQuoteCalls, strandedHoldings,
  liveCounts,
  rows,
  refusals: [...refused.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })),
}));
