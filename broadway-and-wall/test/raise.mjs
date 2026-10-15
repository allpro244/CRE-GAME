// THE INVESTOR MARKET — the city's pool, and raising from it over time.
//   pnpm engine && node test/raise.mjs
//
// A. The year's pool is the city's people at the calibrated equity per head,
//    scaled by attractiveness and split by investor type; rivals entering the
//    city draw it down.
// B. A deal-by-deal raise: counsel paid up front and sunk, soft circles over
//    up to three months, a close that breaks ground with the circled money
//    and records who wrote it — or a failure that leaves the lot as dirt.
//    The cash identity holds every month (CAPITAL_RAISING_PLAN.md §3.1, §3.3).
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
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => { let d = 0; for (const h of Object.values(g.holdings)) for (const t of h.tenants ?? []) d += t.deposit ?? 0; return d; };

// ── A ───────────────────────────────────────────────────────────────────────
console.log("\nA. the city's investor money");
{
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(9601, parcels, 2_500_000), parcels, bbls);
  const p = E.investorPool(g);
  const total = Object.values(p.cap).reduce((a, b) => a + b, 0);
  const want = g.econ.population * E.EQUITY_PER_HEAD * (g.econ.priceLevel ?? 1) * (g.econ.cpi ?? 1) * p.attract;
  console.log(`  ${Math.round(g.econ.population).toLocaleString()} people · attractiveness ${p.attract.toFixed(2)} · ${M(total)} this year: ${E.INVESTOR_TYPES.map((t) => `${t.id} ${M(p.cap[t.id])}`).join(", ")}`);
  ok(Math.abs(total - want) <= 4, "the pool is the city's people at the equity per head, scaled by attractiveness");
  ok(p.attract >= 0.4 && p.attract <= 1.6, "attractiveness inside its guard");
  let rivals = 0, overdrawn = 0, years = 0;
  for (let m = 0; m < 120; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    if (g.month % 12 === 11 && g.investorPool) {
      years++; rivals += g.investorPool.rivals;
      for (const id of Object.keys(g.investorPool.used)) if (g.investorPool.used[id] > g.investorPool.cap[id] + 1) overdrawn++;
    }
  }
  // A firm's first close is the only rival raise; a decade with none (the
  // street full, or credit shut) draws nothing, and that is not a failure.
  const entered = g.rivals.filter((r) => r.bornM > 0 && r.uncalled !== undefined).length;
  console.log(`  rivals raised ${M(rivals)} in the city over ${years} years (${entered} first close${entered === 1 ? "" : "s"})`);
  ok(entered === 0 ? rivals === 0 : rivals > 0, "rivals entering the city draw the pool down — and nothing is drawn when none enter");
  ok(overdrawn === 0, "no investor type is ever drawn past its year's money");
}

// ── B ───────────────────────────────────────────────────────────────────────
console.log("\nB. raising for a job");
function findJob(g, parcels) {
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
  return pick;
}
let launched = 0, closedN = 0, failedN = 0, worst = 0, sourcesSeen = new Set();
// Whether a seed offers a $1M sponsor a lot that pencils inside ten years moves
// with the economy; five seeds keep at least three raises in reach.
for (const [seed, band] of [[9401], [9402], [9603], [9404], [9405], [9401, "Proven"]]) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels, 1_000_000), parcels, bbls);
  let lot = null, outcome = null;
  for (let m = 0; m < 120 && !g.gameOver && !outcome; m++) {
    const prev = { cash: g.cash, books: books(g), loc: g.loc?.balance ?? 0, dep: deposits(g) };
    if (!lot && g.month % 3 === 0) {
      const pick = findJob(g, parcels);
      if (pick) {
        const r = E.executePurchase(g, parcels, pick.L.bbl, pick.L.ask, "cash", false, 1);
        if (!r.err && r.s.holdings[pick.L.bbl]) {
          let g1 = r.s;
          if (band) g1.reputation = { band, score: 30, rank: 1, of: 30, m: g1.month };
          const b = pick.L.bbl;
          const p = E.planDevelopment(g1, parcels, b, pick.u, pick.f, 0.6, "gmp");
          const need = E.devFundingNeed(p).whole;
          const outside = E.maxOutside(g1, need, E.ownedHoldingValue(g1, parcels, g1.holdings[b]));
          const job = { use: pick.u, floors: pick.f, coverage: 0.6, contract: "gmp", spec: 0.5 };
          const c0 = g1.cash;
          const lr = E.launchRaise(g1, parcels, b, job, outside);
          if (!lr.err) {
            g = lr.s; lot = b; launched++;
            const legal = g.raises[b].legal;
            console.log(`  seed ${seed}${band ? ` (${band})` : ""} m${g.month}: raising ${M(outside)} for ${pick.u} ${pick.f}fl · counsel ${M(legal)} · cash ${M(c0)} → ${M(g.cash)}`);
            ok(Math.round(c0 - g.cash) === legal, `seed ${seed}: the counsel is paid at launch`);
          } else { if (process.env.DEBUG) console.log(`  launch refused seed ${seed} m${g1.month}: ${lr.err}`); g = g1; }
        }
      }
    }
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    const resid = (g.cash - prev.cash) - ((books(g) - prev.books) + ((g.loc?.balance ?? 0) - prev.loc) + (deposits(g) - prev.dep));
    if (Math.abs(resid) > Math.abs(worst)) worst = resid;
    if (lot && !g.raises?.[lot]) {
      const w = g.syndications?.[lot];
      outcome = w ? "closed" : "failed";
      if (w) {
        closedN++;
        for (const k of Object.keys(w.sources ?? {})) sourcesSeen.add(k);
        console.log(`    closed m${g.month}: ${M(w.lpCommit)} from ${Object.entries(w.sources ?? {}).map(([k, v]) => `${k} ${M(v)}`).join(", ")} · ground broken ${!!g.developments[lot]}`);
        ok(!!g.developments[lot], `seed ${seed}: the close breaks ground`);
        if (band) ok(Object.keys(w.sources ?? {}).some((k) => k !== "ff"), `seed ${seed}: a ${band} sponsor raises beyond friends and family`);
      } else {
        failedN++;
        console.log(`    failed m${g.month}: ${g.news.find((n) => /raise for/.test(n.text))?.text.slice(0, 140)}`);
        ok(!g.developments[lot], `seed ${seed}: a failed raise leaves the lot as dirt`);
      }
    }
  }
}
{
  // A raise nobody can fill fails, and the counsel stays spent.
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(9401, parcels, 1_000_000), parcels, bbls);
  const pick = findJob(g, parcels) ?? (() => { for (let m = 0; m < 24; m++) { g = E.advanceMonth(g, parcels, bbls, adjacency); const p = findJob(g, parcels); if (p) return p; } return null; })();
  if (pick) {
    const r = E.executePurchase(g, parcels, pick.L.bbl, pick.L.ask, "cash", false, 1);
    g = r.s;
    const p = E.planDevelopment(g, parcels, pick.L.bbl, pick.u, pick.f, 0.6, "gmp");
    const outside = E.maxOutside(g, E.devFundingNeed(p).whole, E.ownedHoldingValue(g, parcels, g.holdings[pick.L.bbl]));
    const lr = E.launchRaise(g, parcels, pick.L.bbl, { use: pick.u, floors: pick.f, coverage: 0.6, contract: "gmp", spec: 0.5 }, outside);
    if (!lr.err) {
      g = lr.s;
      g.ffNetwork = { cap: 0 };   // the network turns out to have nothing to give
      const cash0 = g.cash;
      for (let m = 0; m < 4; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
      ok(!g.raises?.[pick.L.bbl] && !g.syndications?.[pick.L.bbl] && !g.developments[pick.L.bbl], "a raise nobody fills fails at its deadline, and nothing is built");
    } else ok(false, `launch refused: ${lr.err}`);
  }
}
console.log();
ok(launched >= 3, `raises launched on ${launched} runs`);
ok(closedN >= 2, `and closed on ${closedN} (failed on ${failedN})`);
ok(sourcesSeen.has("ff"), `sources recorded: ${[...sourcesSeen].join(", ")}`);
ok(Math.abs(worst) <= 1, `cash identity every month: worst residual ${worst.toFixed(2)}`);
console.log(fails ? "\nFAIL" : "\nPASS — the city's money, raised over time, every dollar on the ledger");
process.exit(fails ? 1 : 0);
