// WHO BUILDS THE CITY — named firms against the anonymous "city", per run of
// an unplayed world (kept alive). ECONOMY.md "MERCHANTS BUY DIRT ON THE
// RESIDUAL".
//
//   pnpm engine && SEEDS=7777,4242 MONTHS=1200 node tools/rival-dev.mjs
//   ENGINE=/abs/other/.engine.mjs ...      another build, same seeds
//
// Per seed: jobs started (first month seen on s.cityJobs), split into the
// city's pipeline claimed by a named firm (claimJob), a named firm building on
// its own dirt (startOwnJob -> breakGround: the news line says "own land" or
// "tearing down"), and the anonymous city; jobs delivered (left the book at or
// after deliverM, not orphaned) by who held them the last month they were
// seen; vacant lots bought off the tape by named firms, by style, and how many
// of those a named firm later broke ground on. The opening pipeline is
// excluded.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? (process.env.ENGINE.startsWith("/") ? process.env.ENGINE : join(HERE, "..", process.env.ENGINE)) : join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const seeds = (process.env.SEEDS ?? "7777,4242").split(",").map(Number);
const MONTHS = +(process.env.MONTHS ?? 1200);
const rows = [];
for (const seed of seeds) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const live = new Map();
  const t = { claim: 0, own: 0, anon: 0, delFirm: 0, delAnon: 0, orphan: 0, landBuys: 0, landByStyle: {}, landBuilt: 0, ownByStyle: {} };
  const boughtLand = new Set();
  const opening = new Set((g.cityJobs ?? []).map((j) => j.bbl + ":" + j.startM));
  for (let m = 0; m < MONTHS; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const pre = new Map((g.rivals ?? []).map((r) => [r.id, new Set(r.bbls)]));
    const landListed = new Set();
    for (const l of g.listings ?? []) if (E.resolveRec(parcels, g, l.bbl)?.class === "land") landListed.add(l.bbl);
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const now = new Set();
    for (const j of g.cityJobs ?? []) {
      const k = j.bbl + ":" + j.startM;
      now.add(k);
      if (!live.has(k)) {
        if (!opening.has(k)) {
          const firm = j.firmId ? (g.rivals ?? []).find((r) => r.id === j.firmId) : null;
          const addr = E.resolveRec(parcels, g, j.bbl)?.address ?? "\u0000";
          const own = !!firm && (g.news ?? []).some((n) => n.q === g.month && n.text.startsWith(firm.name)
            && /own land|tearing down/.test(n.text) && n.text.includes(addr));
          if (!j.firmId) t.anon++;
          else if (own) { t.own++; t.ownByStyle[firm.style] = (t.ownByStyle[firm.style] ?? 0) + 1; }
          else t.claim++;
          if (j.firmId && boughtLand.has(j.bbl)) t.landBuilt++;
        }
        live.set(k, { firmId: j.firmId, deliverM: j.deliverM, orphaned: j.orphaned });
      } else {
        const v = live.get(k); v.firmId = j.firmId; v.deliverM = j.deliverM; v.orphaned = j.orphaned;
      }
    }
    for (const [k, v] of live) {
      if (now.has(k)) continue;
      live.delete(k);
      if (opening.has(k)) continue;
      if (v.orphaned || g.month < v.deliverM) { t.orphan++; continue; }
      if (v.firmId) t.delFirm++; else t.delAnon++;
    }
    for (const r of g.rivals ?? []) {
      const before = pre.get(r.id) ?? new Set();
      for (const b of r.bbls) {
        if (before.has(b) || !landListed.has(b)) continue;
        t.landBuys++; t.landByStyle[r.style] = (t.landByStyle[r.style] ?? 0) + 1; boughtLand.add(b);
      }
    }
  }
  const starts = t.claim + t.own + t.anon;
  const del = t.delFirm + t.delAnon;
  const row = {
    seed, months: MONTHS, ...t, starts, del,
    firmStartShare: +((t.claim + t.own) / Math.max(1, starts)).toFixed(3),
    firmDelShare: +(t.delFirm / Math.max(1, del)).toFixed(3),
    living: (g.rivals ?? []).filter((r) => r.failedM === undefined).length,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const avg = (k) => (rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(2);
console.log(`mean over ${rows.length} seeds x ${MONTHS} m: starts claim ${avg("claim")} own ${avg("own")} anon ${avg("anon")}`
  + ` | delivered firm ${avg("delFirm")} anon ${avg("delAnon")} orphaned ${avg("orphan")}`
  + ` | firm share of starts ${avg("firmStartShare")} of deliveries ${avg("firmDelShare")}`
  + ` | land bought ${avg("landBuys")} (built on ${avg("landBuilt")}) | living ${avg("living")}`);
