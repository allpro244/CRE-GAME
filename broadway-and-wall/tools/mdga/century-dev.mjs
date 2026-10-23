// ONE HUNDRED YEARS, DEVELOPMENT ONLY, ON THE ~6,000-LOT GREAT CITY MAP.
//
// Setup: Great City size (BW_SIZE=giant, ~6,049 lots), the standard "Young
// town" build-out, a $1M opening bankroll, competitors at Medium capital
// (the default RIVAL_CAPITAL). The app's own `newGame(..., where)` call, so
// rivals and banks are sized to the map exactly as a player's run would be.
//
// Mandate:
//   - buy dirt and build; sell whenever
//   - never buy a standing building to hold
//   - a standing building may be bought ONLY as a teardown: emptied (lease
//     buyout) and demolished within 12 months, or sold back out if that fails
//
// Every job is logged with its size, use, cost, construction rate, LTC, the
// market rent and city vacancy for its use at the time, and every sale with
// its price, basis and the market it sold into. Economics are snapshotted
// every 20 years.
//
//   pnpm engine && node tools/mdga/century-dev.mjs
//   (SEED=… YEARS=100 CASH=1000000 OUT=path.json)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.env.BW_SIZE ??= "giant";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const E = await import(ROOT + "/test/.engine.mjs");
const { loadCity } = await import(ROOT + "/test/city.mjs");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const SEED = Number(process.env.SEED ?? 655720);
const YEARS = Number(process.env.YEARS ?? 100);
const CASH = Number(process.env.CASH ?? 1_000_000);
const OUT = process.env.OUT ?? join(ROOT, "tools/mdga/century-dev.out.json");
const K = (n) => (n == null || !Number.isFinite(n) ? "—" : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${(n / 1e3).toFixed(0)}K`);
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const YR0 = 2000;

let g = E.firstListings(
  E.newGame(SEED, parcels, CASH, { rivalCapital: "medium" }, { citySize: process.env.BW_SIZE, cityLots: bbls.length }),
  parcels, bbls);
const open = g.cash;
const yr = () => YR0 + Math.floor(g.month / 12);
const journal = [];
const J = (s) => { journal.push(`${yr()} m${String(g.month).padStart(4)} ${s}`); if (process.env.LIVE) console.log(journal.at(-1)); };
const C = {}; const bump = (k, n = 1) => { C[k] = (C[k] ?? 0) + n; };
const ERR = {}; const err = (where, msg) => { const k = where + ": " + String(msg).replace(/\$[\d.,]+[KMB]?/g, "$X").replace(/\d[\d,.]*/g, "N").slice(0, 140); ERR[k] = (ERR[k] ?? 0) + 1; };

const USES = ["office", "multifamily", "mixed", "retail", "industrial"];
const BUILT = ["office", "multifamily", "retail", "industrial"];
const mkt = () => {
  const e = g.econ;
  return {
    phase: e.phase, idx: +e.indexRate.toFixed(2), cpi: +(e.cpi ?? 1).toFixed(3), costIdx: +(e.costIdx ?? 1).toFixed(3),
    rent: Object.fromEntries(BUILT.map((u) => [u, +(e.rentIdx?.[u] ?? 0).toFixed(2)])),
    vac: Object.fromEntries(BUILT.map((u) => [u, +(e.cityVac?.[u] ?? 0).toFixed(4)])),
    cap: Object.fromEntries(BUILT.map((u) => [u, +((e.capRate?.[u] ?? 0)).toFixed(4)])),
  };
};
const useKey = (u) => (u === "mixed" ? "multifamily" : u);

// ---------------------------------------------------------------- the desk sweep
function sweep(bbl, landBasis) {
  const rec = E.resolveRec(parcels, g, bbl);
  const rows = [];
  if (!rec) return rows;
  for (const u of USES) {
    const top = E.maxFloorsFor(rec, 0.6, u);
    const steps = [...new Set([1, 2, 3, 4, 6, 8, 12, 16, 20, 25, 30, 40, 50, top].filter((x) => x >= 1 && x <= top))];
    for (const f of steps) {
      const p = E.planDevelopment(g, parcels, bbl, u, f, 0.6, "gmp", undefined, undefined, undefined, 0.5, landBasis);
      if (!p) continue;
      rows.push({ use: u, floors: f, p, hurdle: p.hurdleRatio, equity: p.equity + p.pointsCost });
    }
  }
  if (rec.class === "land") {
    const seed = E.landRead(rec, g.econ).scheme;
    if (seed && seed.floors > 0) {
      const p = E.planDevelopment(g, parcels, bbl, seed.use, seed.floors, seed.coverage, "gmp", undefined, undefined, undefined, 0.5, landBasis);
      if (p) rows.push({ use: seed.use, floors: seed.floors, cov: seed.coverage, p, hurdle: p.hurdleRatio, equity: p.equity + p.pointsCost });
    }
  }
  // Rank by hurdle, but prefer the bigger profit among schemes that clear by a similar margin.
  return rows.sort((a, b) => (b.hurdle - a.hurdle) || (b.p.stabNoi - a.p.stabNoi));
}
const HURDLE = Number(process.env.HURDLE ?? 1.05);
const debtSvcMo = () => Object.values(g.holdings).reduce((a, h) => a + (h.loan?.monthlyPmt ?? 0) + (h.mezz?.monthlyPmt ?? 0), 0);
const reserve = () => Math.max(150_000, debtSvcMo() * 4 + E.firmOverheadMonthly(g, parcels) * 6);
const committed = () => Object.values(g.developments ?? {}).reduce((a, d) => a + Math.max(0, (d.equityBudget ?? 0) - (d.equitySpent ?? 0)), 0);
const free = () => E.fundableNow(g, parcels) - reserve() - committed();
const jobAllIn = (row) => row.equity + row.p.costTotal * 0.04 + E.takeoutHedgeCost(row.p, "cap");

// ---------------------------------------------------------------- records
const jobs = {};      // bbl -> job record (current or last)
const jobLog = [];    // every job ever started
const sales = [];     // every disposition
const teardowns = {}; // bbl -> { boughtM, price }
const landBuys = [];
let exitsSeen = 0;

// ---------------------------------------------------------------- shopping
const seen = new Set();
const dead = {}; // bbl -> month a close failed (e.g. tape lists a lot with someone else's crane on it)
const listedUnsellable = [];
const tape = { land: 0, landPencil: 0, bldg: 0, teardownPencil: 0 };
function teardownBasis(rec, ask) {
  // A building's roll costs 1.25x its remaining rent to clear; approximate from the
  // standing rent at the parcel's typical occupancy and a half-run lease.
  const rent = E.useRentPsfYr(rec, g.econ, E.initialCondition(rec), rec.class === "mixed" ? "multifamily" : rec.class);
  const roll = (rec.bldgArea ?? 0) * 0.85 * rent * 2.5 * 1.25; // ~2.5 years left on average
  return ask * 1.03 + roll;
}
/** Outside equity the sponsor could count on (RAISE mode): most of what its band's investors have open. */
const oc = () => (process.env.RAISE === "1" ? 0.8 * E.outsideCapacity(g) : 0);
function shop() {
  if (Object.keys(g.talks ?? {}).length >= 2) return;
  const f = free();
  if (f < 100_000) return;
  let best = null;
  for (const l of g.listings) {
    if (g.holdings[l.bbl] || g.talks?.[l.bbl] || !(l.ask > 0)) continue;
    if (dead[l.bbl] !== undefined && g.month - dead[l.bbl] < 24) continue;
    const rec = E.resolveRec(parcels, g, l.bbl);
    if (!rec || E.isCivicLand(g, l.bbl) || g.landmarks?.[l.bbl] !== undefined) continue;
    const key = l.bbl + ":" + l.listedM;
    const first = !seen.has(key); if (first) seen.add(key);
    const isLand = rec.class === "land";
    if (!isLand) {
      // TEARDOWN ONLY: worth more as a hole than as a building?
      if (first) tape.bldg++;
      if (l.ask > f * 4) continue;
      const basis = teardownBasis(rec, l.ask);
      if (basis + 0 > f * 6) continue;
      const rows = sweep(l.bbl, basis);
      const top = rows.find((r) => r.hurdle >= HURDLE + 0.1 && basis + jobAllIn(r) <= f + r.p.commitment * 0);
      if (!top) continue;
      if (first) tape.teardownPencil++;
      if (basis + jobAllIn(top) > f) continue;
      const score = top.hurdle - 0.1;
      if (!best || score > best.score) best = { l, rec, row: top, score, teardown: true };
      continue;
    }
    if (first) tape.land++;
    const rows = sweep(l.bbl, l.ask);
    const fit = rows.find((r) => r.hurdle >= HURDLE && l.ask * 1.03 + jobAllIn(r) <= f + oc() && l.ask * 1.03 <= f);
    if (!fit) { if (first) err("land", rows[0]?.hurdle >= HURDLE ? "pencils, cannot fund dirt + job" : "does not pencil at ask"); continue; }
    if (first) tape.landPencil++;
    const score = fit.hurdle + (l.distress ? 0.05 : 0);
    if (!best || score > best.score) best = { l, rec, row: fit, score };
  }
  if (!best) return;
  const bid = Math.round(best.l.ask * (best.l.distress ? 0.88 : 0.93));
  const r = E.negotiate(g, parcels, best.l.bbl, bid);
  if (r.err) { err("negotiate", r.err); return; }
  g = r.s; bump(best.teardown ? "teardownBids" : "landBids");
  J(`BID ${K(bid)} on ${best.teardown ? "TEARDOWN " + best.rec.class + " " + Math.round(best.rec.bldgArea).toLocaleString() + "sf at" : "lot"} ${best.rec.address} (ask ${K(best.l.ask)}, ${Math.round(best.rec.lotArea).toLocaleString()} sf lot) — scheme ${best.row.use} ${best.row.floors}fl ${best.row.hurdle.toFixed(2)}x`);
}

function workTalks() {
  for (const t of Object.values(g.talks ?? {})) {
    const rec = E.resolveRec(parcels, g, t.bbl);
    if (!rec) continue;
    const isLand = rec.class === "land";
    if (t.agreed) {
      const px = t.agreedPrice ?? t.theirPrice;
      let product = "cash";
      if (isLand) {
        const q = E.buyQuote(g, parcels, t.bbl, px, "land", 1);
        if (q.principal > 0 && q.equity < g.cash - reserve() * 0.5) product = "land";
      }
      const r = E.closeDeal(g, parcels, t.bbl, product, 1);
      if (r.err) { dead[t.bbl] = g.month; if (/crane/.test(r.err)) listedUnsellable.push({ m: g.month, address: rec.address }); err("close", r.err); J(`couldn't close ${rec.address}: ${r.err.slice(0, 120)}`); g = E.walkAway(g, parcels, t.bbl).s; continue; }
      g = r.s;
      const h = g.holdings[t.bbl];
      if (isLand) {
        bump("landBought");
        landBuys.push({ m: g.month, y: yr(), address: rec.address, price: px, lotSf: rec.lotArea, how: "tape", product, loan: h?.loan ? { bal: h.loan.balance, rate: h.loan.ratePct } : null });
        J(`BOUGHT lot ${rec.address} ${Math.round(rec.lotArea).toLocaleString()}sf for ${K(px)} ($${(px / rec.lotArea).toFixed(0)}/sf land) ${product === "land" ? `with land loan ${K(h?.loan?.balance)} @${h?.loan?.ratePct?.toFixed(2)}%` : "all cash"}`);
      } else {
        bump("teardownsBought");
        teardowns[t.bbl] = { boughtM: g.month, price: px, address: rec.address, sf: rec.bldgArea, cls: rec.class };
        J(`BOUGHT TEARDOWN ${rec.address}: ${rec.class} ${Math.round(rec.bldgArea).toLocaleString()}sf on ${Math.round(rec.lotArea).toLocaleString()}sf lot for ${K(px)} — must be down by m${g.month + 12}`);
      }
      continue;
    }
    const top = sweep(t.bbl, isLand ? t.theirPrice : teardownBasis(rec, t.theirPrice))[0];
    if (!top || top.hurdle < (isLand ? 1.0 : 1.1)) { g = E.walkAway(g, parcels, t.bbl).s; bump("walked"); continue; }
    const gap = t.theirPrice / Math.max(1, t.yourPrice) - 1;
    if (gap < 0.05 || (t.round >= 2 && gap < 0.09)) { const r = E.acceptCounter(g, parcels, t.bbl); if (!r.err) g = r.s; else err("acceptCounter", r.err); }
    else if (t.final) { g = E.walkAway(g, parcels, t.bbl).s; bump("walked"); }
    else { const r = E.negotiate(g, parcels, t.bbl, Math.round(t.yourPrice * 0.6 + t.theirPrice * 0.4)); if (!r.err) g = r.s; else err("negotiate", r.err); }
  }
}

// Off-market dirt: phone owners of lots whose parcel card reads Developable.
const om = { rounds: 0, calls: 0, refused: 0, bought: 0, tooDear: 0, cantFund: 0 };
function offMarket() {
  if (g.month % 3 !== 0 || Object.keys(g.talks ?? {}).length) return;
  const f = free();
  if (f < 150_000) return;
  om.rounds++;
  const cands = [];
  for (const b of bbls) {
    const rec = E.resolveRec(parcels, g, b);
    if (!rec || rec.class !== "land" || rec.bldgArea > 0) continue;
    if (g.holdings[b] || g.listings.some((l) => l.bbl === b) || E.isCivicLand(g, b) || g.landmarks?.[b] !== undefined || g.merged?.[b]) continue;
    const a = g.approaches?.[b];
    if (a && g.month < a.q + 12) continue;
    if (dead[b] !== undefined && g.month - dead[b] < 24) continue;
    const lr = E.landRead(rec, g.econ);
    if (lr.winner !== "builder" || !(lr.builder > 0)) continue;
    const v = E.landValue(rec, g.econ);
    if (v * 1.3 > f) continue;
    cands.push({ b, rec, v, d: rec.demandScore ?? 0 });
  }
  // best-located first: that is where building pays
  cands.sort((x, y) => y.d - x.d);
  let calls = 0;
  for (const c of cands) {
    if (calls >= 5) break;
    calls++; om.calls++;
    const r = E.approachOwner(g, parcels, adjacency, c.b);
    if (r.err) { err("approach", r.err); continue; }
    g = r.s;
    if (r.refused) { om.refused++; continue; }
    const price = r.blind ? Math.round(c.v) : r.ask;
    const rows = sweep(c.b, price);
    const fit = rows.find((x) => x.hurdle >= HURDLE && price * 1.03 + jobAllIn(x) <= free() + oc() && price * 1.03 <= free());
    if (!fit) { if (rows[0]?.hurdle >= HURDLE) om.cantFund++; else om.tooDear++; continue; }
    const q = E.buyQuote(g, parcels, c.b, price, "land", 1);
    const product = q.principal > 0 && q.equity < g.cash - reserve() * 0.5 ? "land" : "cash";
    const b = E.buyOffMarket(g, parcels, c.b, product, 1, price);
    if (b.err) { dead[c.b] = g.month; err("buyOffMarket", b.err); continue; }
    g = b.s;
    if (g.holdings[c.b]) {
      om.bought++; bump("landBought");
      const h = g.holdings[c.b];
      landBuys.push({ m: g.month, y: yr(), address: c.rec.address, price, lotSf: c.rec.lotArea, how: "off-market", product, loan: h?.loan ? { bal: h.loan.balance, rate: h.loan.ratePct } : null });
      J(`BOUGHT OFF-MARKET lot ${c.rec.address} ${Math.round(c.rec.lotArea).toLocaleString()}sf for ${K(price)} ($${(price / c.rec.lotArea).toFixed(0)}/sf; card value ${K(c.v)}) — plan ${fit.use} ${fit.floors}fl ${fit.hurdle.toFixed(2)}x`);
      break;
    }
  }
}

// ---------------------------------------------------------------- teardowns: empty, demolish, or sell back out
function clearSites() {
  for (const [bbl, t] of Object.entries(teardowns)) {
    const h = g.holdings[bbl];
    if (!h) { delete teardowns[bbl]; continue; }
    const rec = E.resolveRec(parcels, g, bbl);
    if (rec.class === "land") { delete teardowns[bbl]; continue; }
    if (!h.leasingHold) g = E.setLeasingHold(g, bbl, true);
    let d = E.demolish(g, parcels, bbl);
    if (d.err && /occupied/.test(d.err)) {
      const q = E.buyoutQuote(g, bbl);
      if (q && q.cost < free()) {
        const b = E.buyOutTenants(g, parcels, bbl);
        if (!b.err) { g = b.s; t.buyout = q.cost; J(`BOUGHT OUT ${q.tenants} tenants at ${rec.address} for ${K(q.cost)}`); d = E.demolish(g, parcels, bbl); }
      }
    }
    if (!d.err) {
      const cost = E.demolitionCost(rec, g);
      g = d.s; bump("demolished");
      J(`DEMOLISHED ${rec.address} (${Math.round(rec.bldgArea).toLocaleString()}sf ${rec.class}) for ~${K(cost)}, ${g.month - t.boughtM} mo after buying it`);
      delete teardowns[bbl];
      continue;
    }
    if (g.month - t.boughtM >= 11 && !h.sale) {
      const v = E.ownedHoldingValue(g, parcels, h);
      const r = E.listForSale(g, parcels, bbl, Math.round(v), "marketed");
      if (!r.err) { g = r.s; J(`TEARDOWN FAILED at ${rec.address} (${d.err.slice(0, 80)}) — listed for sale, mandate forbids holding it`); }
    }
  }
}

// ---------------------------------------------------------------- the Build desk
const landIdle = {};
function build() {
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec || rec.class !== "land" || g.developments[h.bbl] || h.sale || g.merged?.[h.bbl]) continue;
    landIdle[h.bbl] = (landIdle[h.bbl] ?? 0) + 1;
    if (landIdle[h.bbl] > 1 && landIdle[h.bbl] % 2 === 0) continue; // re-underwrite every other month
    const rows = sweep(h.bbl);
    const f = free();
    if (RAISE && raiseFor(h, rec, rows, f)) { delete landIdle[h.bbl]; continue; }
    const pick = rows.find((r) => r.hurdle >= 1.0 && jobAllIn(r) <= f);
    if (!pick) {
      if (landIdle[h.bbl] % 12 === 1) J(`lot ${rec.address} waiting — best ${rows[0] ? `${rows[0].use} ${rows[0].hurdle.toFixed(2)}x needs ${K(jobAllIn(rows[0]))}` : "nothing"}, can fund ${K(f)}`);
      // a lot held 8 years without a pencil is dead money — sell it
      if (landIdle[h.bbl] > 96 && !h.sale) { const v = E.ownedHoldingValue(g, parcels, h); const r = E.listForSale(g, parcels, h.bbl, Math.round(v), "marketed"); if (!r.err) { g = r.s; J(`LISTED idle lot ${rec.address} at ${K(v)}`); } }
      continue;
    }
    const kind = E.takeoutHedgeRequired(pick.p) ? "cap" : "cap";
    const r = E.startDevelopment(g, parcels, h.bbl, pick.use, pick.floors, pick.cov ?? 0.6, "gmp", undefined, { takeout: kind }, undefined, 0.5);
    if (r.err) { err("startDevelopment", r.err); J(`BUILD REFUSED ${rec.address} ${pick.use} ${pick.floors}fl: ${r.err.slice(0, 160)}`); continue; }
    g = r.s; bump("built");
    logJob(h, rec, pick, kind);
  }
}

// RAISE=1: the sponsor takes outside equity on every job it can (raise.ts —
// the Build desk's raise: counsel paid, up to three months of soft circles,
// close full, small or fail), and picks among jobs its own cash plus what its
// band's investors could carry would fund.
const RAISE = process.env.RAISE === "1";
const pendingRaise = {};
const capLog = [];
function raiseFor(h, rec, rows, f) {
  if (g.raises?.[h.bbl]) return true;
  const cap = E.outsideCapacity(g);
  if (!(cap > 0)) return false;
  const pick = rows.find((r) => r.hurdle >= 1.0 && jobAllIn(r) <= f + cap && jobAllIn(r) > f * 0.5);
  if (!pick) return false;
  const job = { use: pick.use, floors: pick.floors, coverage: pick.cov ?? 0.6, contract: "gmp", custom: { takeout: "cap" }, spec: 0.5 };
  let why = "";
  for (const frac of [1, 0.8, 0.6, 0.45, 0.3, 0.2]) {
    const target = Math.round(Math.min(cap, jobAllIn(pick)) * frac);
    if (target < 50_000) break;
    const q = E.raiseQuote(g, parcels, h.bbl, job, target);
    if (!q.ok) { why = q.why; continue; }
    const L = E.launchRaise(g, parcels, h.bbl, job, target);
    if (L.err) { why = L.err; continue; }
    g = L.s; bump("raisesLaunched");
    const t = E.playerTerms(g);
    pendingRaise[h.bbl] = { pick, target, legal: q.legal, m: g.month, band: t.band, need: jobAllIn(pick), own: f };
    J(`RAISE LAUNCHED ${rec.address}: ${K(target)} of outside equity for ${pick.use} ${pick.floors}fl (job cash ${K(jobAllIn(pick))}, own free ${K(f)}); band ${t.band}, terms ${E.termsLine(t)}, counsel ${K(q.legal)}`);
    return true;
  }
  if (why) err("raiseQuote", why);
  return false;
}
function checkRaises() {
  for (const [bbl, pr] of Object.entries(pendingRaise)) {
    if (g.raises?.[bbl]) continue;
    const h = g.holdings[bbl]; const rec = E.resolveRec(parcels, g, bbl);
    const w = g.syndications?.[bbl];
    const why = (g.news ?? []).find((n) => n.text.includes(`raise for ${rec?.address}`))?.text;
    if (g.developments[bbl] && w) {
      bump("raisesClosed");
      capLog.push({ y: yr(), bbl, address: rec?.address, ok: true, target: pr.target, got: w.lpCommit, months: g.month - pr.m, band: pr.band, sources: w.sources ?? null, legal: pr.legal });
      J(`RAISE CLOSED ${rec?.address}: ${K(w.lpCommit)} of ${K(pr.target)} after ${g.month - pr.m} mo from ${JSON.stringify(w.sources ?? {})}`);
      logJob(h, rec, pr.pick, "cap");
    } else {
      bump("raisesFailed");
      capLog.push({ y: yr(), bbl, address: rec?.address, ok: false, target: pr.target, months: g.month - pr.m, band: pr.band, legal: pr.legal, why });
      J(`RAISE FAILED ${rec?.address}: ${why ?? "?"}`);
    }
    delete pendingRaise[bbl];
  }
}
function logJob(h, rec, pick, kind) {
  {
    const m0 = mkt();
    const d = g.developments[h.bbl];
    const p = pick.p;
    const u = useKey(pick.use);
    const marketRent = E.useRentPsfYr(rec, g.econ, "good", u);
    const job = {
      n: jobLog.length + 1, bbl: h.bbl, address: rec.address, startM: g.month, startY: yr(),
      use: pick.use, floors: d.floors ?? pick.floors, gsf: Math.round(d.sf ?? p.sf), rsf: Math.round(p.rentable), lotSf: Math.round(rec.lotArea),
      landBasis: Math.round(p.landBasis), hard: Math.round(p.hardCost), soft: Math.round(p.softCost), demo: Math.round(p.demo), contingency: Math.round(p.contingency), leaseUp: Math.round(p.leaseUp),
      costTotal: Math.round(p.costTotal), basisTotal: Math.round(p.basisTotal), hardPsf: +(p.hardCost / p.sf).toFixed(0), allInPsf: +(p.basisTotal / p.sf).toFixed(0),
      ltc: +p.ltc.toFixed(3), loan: Math.round(p.commitment), rate: +p.ratePct.toFixed(2), lender: p.lender, points: +(p.points * 100).toFixed(2),
      equity: Math.round(p.equity + p.pointsCost), months: p.months, stabNoi: Math.round(p.stabNoi), yoc: +p.yieldOnCost.toFixed(2), exitYield: +p.exitYield.toFixed(2),
      hurdle: +pick.hurdle.toFixed(2), planValue: Math.round(p.stabNoi / (p.exitYield / 100)), takeout: kind,
      mktRentPsf: +marketRent.toFixed(2), cityVac: m0.vac[u], idx: m0.idx, phase: m0.phase, capRate: m0.cap[u], costIdx: m0.costIdx,
      plannedDeliverM: d.deliverM,
    };
    const w = g.syndications?.[h.bbl];
    if (w) job.syn = { lp: w.lpCommit, sources: w.sources ?? null, terms: E.playerTerms(g).band };
    jobs[h.bbl] = job; jobLog.push(job);
    delete landIdle[h.bbl];
    J(`BREAK GROUND #${job.n} ${rec.address}: ${pick.use} ${job.floors}fl ${job.gsf.toLocaleString()} gsf, all-in ${K(job.basisTotal)} ($${job.allInPsf}/sf; hard $${job.hardPsf}/sf), land ${K(job.landBasis)}; construction loan ${K(job.loan)} @${job.rate}% = ${(job.ltc * 100).toFixed(0)}% LTC; equity ${K(job.equity)}; YoC ${job.yoc}% vs exit ${job.exitYield}% (${job.hurdle}x); ${job.months} mo. Market: ${u} rent $${job.mktRentPsf}/sf, city vac ${pct(job.cityVac)}, index ${job.idx}%, ${job.phase}`);
  }
}

// ---------------------------------------------------------------- leasing
function lease() {
  if (!g.leasingPlan) {
    g = structuredClone(g);
    for (const u of ["office", "retail", "industrial"]) E.patchPlanRow(g, u, { targetNePct: 0.95, patienceM: 12 });
  }
  if (g.lois.some((l) => E.loiNeedsPrincipal(g, l))) {
    const r = E.clearTrayAgainstPlan(g, parcels);
    g = r.s; bump("lettersSigned", r.signed);
  }
  let guard = 0;
  while (guard++ < 80) {
    const loi = g.lois.find((l) => E.loiNeedsPrincipal(g, l) && !l._seen);
    if (!loi) break;
    const rec = E.resolveRec(parcels, g, loi.bbl); const h = g.holdings[loi.bbl];
    if (!rec || !h || teardowns[loi.bbl]) { const r = E.respondLOI(g, parcels, loi.id, "decline"); if (!r.err) g = r.s; else loi._seen = true; continue; }
    const mk = E.managedRentPsfYr(rec, g.econ, h, loi.use);
    const ne = E.loiMandateScore(loi, mk);
    const inLeaseUp = h.deliveredM !== undefined && g.month - h.deliveredM < 36;
    const r = E.respondLOI(g, parcels, loi.id, ne >= (inLeaseUp ? 0.80 : 0.88) ? "accept" : "pass");
    if (r.err) { err("respondLOI", r.err); const l = g.lois.find((x) => x.id === loi.id); if (l) l._seen = true; }
    else g = r.s;
  }
  for (const a of [...(g.asks ?? [])]) { const r = E.answerAsk(g, parcels, a.id, "decline"); if (!r.err) g = r.s; }
}

// ---------------------------------------------------------------- the book
const MERCHANT_NW = 40e6;  // below this, recycle every stabilised job; above, hold the best and refinance
function manage() {
  const e = g.econ;
  const nw = E.netWorth(g, parcels);
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec || rec.class === "land" || g.developments[h.bbl] || teardowns[h.bbl]) continue;
    const occ = E.physicalOcc(rec, h);
    const job = jobs[h.bbl];
    if (job && h.deliveredM !== undefined && job.deliveredM === undefined) {
      job.deliveredM = h.deliveredM; job.deliveredY = YR0 + Math.floor(h.deliveredM / 12);
      job.slip = h.deliveredM - job.plannedDeliverM;
      job.valueAtDelivery = Math.round(E.ownedHoldingValue(g, parcels, h)); job.basisBooked = Math.round(h.costBasis);
      job.miniPerm = h.loan ? { bal: Math.round(h.loan.balance), rate: h.loan.ratePct } : null;
      J(`DELIVERED #${job.n} ${rec.address} (${job.use} ${job.gsf.toLocaleString()} gsf): ${pct(occ, 0)} let day one, ${job.slip >= 0 ? "+" : ""}${job.slip} mo vs plan; value ${K(job.valueAtDelivery)} vs basis ${K(job.basisBooked)}; mini-perm ${K(job.miniPerm?.bal)} @${job.miniPerm?.rate}%; ${useKey(job.use)} vac ${pct(e.cityVac[useKey(job.use)])}`);
    }
    if (job && job.deliveredM !== undefined && job.stabM === undefined && occ >= 0.9) { job.stabM = g.month - job.deliveredM; J(`STABILISED #${job.n} ${rec.address} at ${job.stabM} mo (${pct(occ, 0)})`); }
    if (occ < 0.85 && !h.broker) { const r = E.setBroker(g, parcels, h.bbl, true); if (r?.s && !r.err) g = r.s; }
    if (occ > 0.93 && h.broker) { const r = E.setBroker(g, parcels, h.bbl, false); if (r?.s && !r.err) g = r.s; }
    // take out the mini-perm once stabilised, at the balloon, or pull equity (hold mode)
    const l = h.loan;
    if (l && !h.sale) {
      const toMat = l.maturityM - g.month;
      const miniPerm = h.deliveredM !== undefined && l.originM === h.deliveredM;
      const cashOut = nw >= MERCHANT_NW && occ >= 0.9 && g.month % 12 === 0 && g.month - (l.originM ?? 0) >= 36;
      if ((miniPerm && occ >= 0.88) || toMat <= 9 || cashOut) {
        const { quotes, payoff } = E.refiQuotes(g, parcels, h.bbl);
        const live = quotes.filter((x) => x.available && x.maxProceeds > 0).map((x) => ({ x, net: x.maxProceeds - payoff - Math.round(x.maxProceeds * x.points) }));
        const covers = live.filter((y) => y.net >= (cashOut && !miniPerm && toMat > 9 ? payoff * 0.15 : 0)).sort((a, b) => a.x.ratePct - b.x.ratePct);
        const b = covers[0] ?? (toMat <= 9 ? live.sort((a, b2) => b2.net - a.net)[0] : null);
        if (b && (b.net >= 0 || g.cash > -b.net + reserve())) {
          const r = E.refinance(g, parcels, h.bbl, b.x.id, 1);
          if (!r.err) { g = r.s; bump(miniPerm ? "takeouts" : cashOut ? "cashOutRefis" : "refis"); J(`${miniPerm ? "PERM TAKEOUT" : cashOut ? "CASH-OUT REFI" : "REFI"} ${rec.address}: ${K(b.x.maxProceeds)} @${b.x.ratePct.toFixed(2)}% (net ${K(b.net)}), occ ${pct(occ, 0)}, index ${e.indexRate.toFixed(2)}%`); if (job) (job.refis ??= []).push({ y: yr(), amt: Math.round(b.x.maxProceeds), rate: b.x.ratePct }); }
          else err("refinance", r.err);
        }
      }
    }
    // EXIT
    const soft = e.phase === "recession" || e.phase === "depression";
    if (!h.sale && job?.stabM !== undefined && g.month - job.deliveredM >= 18 && !soft) {
      const val = E.ownedHoldingValue(g, parcels, h);
      const merchant = nw < MERCHANT_NW;
      const bar = merchant ? 1.15 : 1.6;
      if (val > h.costBasis * bar) {
        const r = E.listForSale(g, parcels, h.bbl, Math.round(val * 1.03), "marketed");
        if (!r.err) { g = r.s; J(`LIST #${job.n} ${rec.address} at ${K(val * 1.03)} (basis ${K(h.costBasis)}, mark ${((val / h.costBasis - 1) * 100).toFixed(0)}% over)`); }
        else err("listForSale", r.err);
      }
    }
  }
  // work every listing (developments, idle lots, failed teardowns)
  for (const h of Object.values(g.holdings)) {
    const s = h.sale; if (!s) continue;
    if (s.offer && !(s.offer.contract && !s.offer.held)) {
      if (s.offer.price >= s.ask * 0.94) { const r = E.acceptSaleOffer(g, parcels, h.bbl); if (!r.err) g = r.s; else err("acceptSaleOffer", r.err); }
      else if (!s.offer.countered) { const r = E.counterSale(g, parcels, h.bbl, Math.round(s.ask * 0.98)); if (r?.s && !r.err) g = r.s; }
    } else if (s.bids?.length) {
      const live = s.bids.map((b, i) => ({ b, i })).filter((x) => !x.b.dropped).sort((a, b2) => b2.b.price - a.b.price);
      if (live.length && (live[0].b.price >= s.ask * 0.93 || (s.round ?? 0) >= 1)) { const r = E.acceptBid(g, parcels, h.bbl, live[0].i); if (!r.err) g = r.s; else err("acceptBid", r.err); }
      else if (live.length) { const r = E.bestAndFinal(g, parcels, h.bbl); if (!r.err) g = r.s; }
    } else if (g.month - s.listedM > 14) { g = E.delist(g, h.bbl); }
  }
  const bal = g.loc?.balance ?? 0;
  if (bal > 0 && g.cash > reserve() * 2 + committed()) { const r = E.repayLoc(g, Math.min(bal, g.cash - reserve() * 2 - committed())); if (!r.err) g = r.s; }
}

function recordExits() {
  while (exitsSeen < (g.exits ?? []).length) {
    const x = g.exits[exitsSeen++];
    const job = jobLog.slice().reverse().find((j) => j.bbl === x.bbl && j.startM >= x.boughtM - 1);
    const rec = E.resolveRec(parcels, g, x.bbl);
    const m = mkt();
    const u = useKey(rec?.class ?? "multifamily");
    const row = {
      y: yr(), m: g.month, address: x.address, kind: job ? `#${job.n} ${job.use} ${job.gsf.toLocaleString()} gsf` : (teardowns[x.bbl] ? "failed teardown" : rec?.class === "land" ? "lot" : rec?.class),
      price: Math.round(x.price), basis: Math.round(x.basis), gain: Math.round(x.gain), heldM: x.soldM - x.boughtM, forced: !!x.forced,
      irr: x.irr, equityIn: x.equityIn, equityOut: x.equityOut, psf: rec?.bldgArea ? +(x.price / rec.bldgArea).toFixed(0) : null,
      capRate: rec?.class !== "land" ? m.cap[u] : null, rent: m.rent[u], vac: m.vac[u], idx: m.idx, phase: m.phase,
    };
    if (job) job.sale = row;
    sales.push(row);
    J(`${x.forced ? "LOST (forced) " : "SOLD "}${row.kind} ${x.address} for ${K(x.price)}${row.psf ? ` ($${row.psf}/sf)` : ""} — basis ${K(x.basis)}, gain ${K(x.gain)}, held ${row.heldM} mo${x.irr != null ? `, levered IRR ${pct(x.irr)}` : ""}; ${u} cap ${row.capRate}%, vac ${pct(row.vac)}, index ${row.idx}%`);
  }
}

// ---------------------------------------------------------------- economics snapshot
function board() {
  const rows = (g.rivals ?? []).filter((r) => r.failedM === undefined).map((r) => ({ name: r.name, style: r.style, eq: E.rivalEquity(E.markRival(g, parcels, r), r), bldgs: r.bbls.length }));
  rows.push({ name: "You", style: "player", eq: E.netWorth(g, parcels), bldgs: Object.keys(g.holdings).length });
  return rows.sort((a, b) => b.eq - a.eq);
}
function snapshot() {
  const e = g.econ;
  let buildings = 0, vacant = 0, floor = 0, landPsf = [];
  for (const b of bbls) {
    const rec = E.resolveRec(parcels, g, b);
    if (!rec) continue;
    if (rec.class === "land" || !(rec.bldgArea > 0)) {
      vacant++;
      if (!E.isCivicLand(g, b) && rec.lotArea > 0) landPsf.push(E.landValue(rec, e) / rec.lotArea);
    } else { buildings++; floor += rec.bldgArea; }
  }
  landPsf.sort((a, b) => a - b);
  const bd = board();
  const nw = E.netWorth(g, parcels);
  const hs = Object.values(g.holdings);
  let value = 0, debt = 0, noi = 0;
  for (const h of hs) { const rec = E.resolveRec(parcels, g, h.bbl); if (!rec) continue; value += E.ownedHoldingValue(g, parcels, h); debt += (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0); if (rec.class !== "land") noi += E.ownedHoldingNoiYr(g, parcels, h); }
  return {
    y: yr(), m: g.month, ...mkt(), jobsCity: Math.round(e.jobs ?? 0), pop: Math.round(e.population ?? 0),
    buildings, vacantLots: vacant, floorSf: Math.round(floor), landPsfMedian: +(landPsf[Math.floor(landPsf.length / 2)] ?? 0).toFixed(0), landPsfP90: +(landPsf[Math.floor(landPsf.length * 0.9)] ?? 0).toFixed(0),
    nw: Math.round(nw), cash: Math.round(g.cash), line: Math.round(g.loc?.balance ?? 0), deeds: hs.length, liveJobs: Object.keys(g.developments).length,
    bookValue: Math.round(value), debt: Math.round(debt), noi: Math.round(noi),
    rank: bd.findIndex((r) => r.name === "You") + 1, field: bd.length, top5: bd.slice(0, 5).map((r) => ({ name: r.name, style: r.style, eq: Math.round(r.eq), bldgs: r.bldgs })),
    rivalsFailed: (g.rivals ?? []).filter((r) => r.failedM !== undefined).length,
    started: jobLog.length, sold: sales.length,
  };
}


// ---------------------------------------------------------------- downturns
// One record per recession: what the economy looked like going in, how deep it
// went, what was announced while it ran, who failed, and what it did to us.
const downturns = [];
let dt = null;
const DOWN = (ph) => ph === "recession" || ph === "depression";
const histIdx = [];   // index rate by month, for "what preceded it"
const histVac = [];
function econRead() {
  const e = g.econ;
  return {
    idx: +e.indexRate.toFixed(2), policy: +(e.nat?.policy ?? NaN).toFixed(2), infl: +((e.nat?.infl ?? NaN) * (Math.abs(e.nat?.infl ?? 0) < 1 ? 100 : 1)).toFixed(2),
    natUnemp: +((e.nat?.unemp ?? NaN) * 100).toFixed(1), localUnemp: +((e.unemployment ?? NaN) * 100).toFixed(1),
    jobs: Math.round(e.jobs ?? 0), credit: +(e.creditIdx ?? 1).toFixed(3), landIdx: +(e.landIdx ?? 0).toFixed(3),
    rent: Object.fromEntries(BUILT.map((u) => [u, +(e.rentIdx?.[u] ?? 0).toFixed(2)])),
    vac: Object.fromEntries(BUILT.map((u) => [u, +(e.cityVac?.[u] ?? 0).toFixed(4)])),
    cap: Object.fromEntries(BUILT.map((u) => [u, +(e.capRate?.[u] ?? 0).toFixed(4)])),
    shockM: e.nat?.shockM ?? 0,
  };
}
function trackDownturn() {
  const ph = g.econ.phase;
  histIdx.push(g.econ.indexRate); histVac.push({ ...g.econ.cityVac });
  const nw = E.netWorth(g, parcels);
  const alive = (g.rivals ?? []).filter((r) => r.failedM === undefined).length;
  if (!dt && DOWN(ph)) {
    const i24 = histIdx.length > 24 ? histIdx[histIdx.length - 25] : histIdx[0];
    const v24 = histVac.length > 24 ? histVac[histVac.length - 25] : histVac[0];
    const pre = econRead();
    dt = {
      startM: g.month, startY: yr(), pre, idx24Before: +i24.toFixed(2),
      vac24Before: Object.fromEntries(BUILT.map((u) => [u, +(v24?.[u] ?? 0).toFixed(4)])),
      worst: JSON.parse(JSON.stringify(pre)), depression: false,
      nw0: Math.round(nw), nwMin: Math.round(nw), cash0: Math.round(g.cash), cashMin: Math.round(g.cash),
      rivals0: alive, rivalsFailed: [], swans: [], headlines: [], forcedSales: 0, mySales: 0, myStarts: 0, myDeliveries: 0,
      liveJobs0: Object.keys(g.developments).length, deeds0: Object.keys(g.holdings).length,
      started0: jobLog.length, sales0: sales.length, failedSeen: new Set((g.rivals ?? []).filter((r) => r.failedM !== undefined).map((r) => r.name)),
      swanSeen: (g.swanLog ?? []).length, newsTop: g.news?.[0]?.q ?? -1, newsSeen: new Set(),
    };
  }
  if (!dt) return;
  const now = econRead();
  const w = dt.worst;
  if (ph === "depression") dt.depression = true;
  w.idx = Math.max(w.idx, now.idx); w.policy = Math.max(w.policy, now.policy); w.infl = Math.max(w.infl, now.infl);
  w.natUnemp = Math.max(w.natUnemp, now.natUnemp); w.localUnemp = Math.max(w.localUnemp, now.localUnemp);
  w.jobs = Math.min(w.jobs, now.jobs); w.credit = Math.min(w.credit, now.credit); w.landIdx = Math.min(w.landIdx, now.landIdx);
  for (const u of BUILT) { w.rent[u] = Math.min(w.rent[u], now.rent[u]); w.vac[u] = Math.max(w.vac[u], now.vac[u]); w.cap[u] = Math.max(w.cap[u], now.cap[u]); }
  dt.nwMin = Math.min(dt.nwMin, Math.round(nw)); dt.cashMin = Math.min(dt.cashMin, Math.round(g.cash));
  for (const r of g.rivals ?? []) if (r.failedM !== undefined && !dt.failedSeen.has(r.name)) { dt.failedSeen.add(r.name); dt.rivalsFailed.push(`${r.name} (${r.style})`); }
  const sl = g.swanLog ?? [];
  for (; dt.swanSeen < sl.length; dt.swanSeen++) { const x = sl[dt.swanSeen]; dt.swans.push(`${x.dir < 0 ? "BLACK" : "white"} ${x.family}/${x.key} ×${(+x.mult).toFixed(2)}: ${x.title}`); }
  for (const n of (g.news ?? []).slice(0, 12)) {
    if (n.q !== g.month || n.bbl || dt.newsSeen.has(n.text)) continue;
    if (/\b\d+ (Old |New )?[A-Z][a-z]+ (St|Ave|Pl|Rd|Way|Sq|Ln|Blvd|Row|Ct)\b|on the tape|withdrawn|Motivated seller/.test(n.text)) continue;
    if (!(n.kind === "warn" || n.kind === "event")) continue;
    dt.newsSeen.add(n.text);
    if (dt.headlines.length < 14) dt.headlines.push(`${YR0 + Math.floor(n.q / 12)}: ${n.text.slice(0, 220)}`);
  }
  if (!DOWN(ph)) {
    const end = econRead();
    const nwEnd = Math.round(nw);
    const rec = {
      startY: dt.startY, startM: dt.startM, endY: yr(), months: g.month - dt.startM, depression: dt.depression,
      pre: dt.pre, worst: dt.worst, end, idx24Before: dt.idx24Before, vac24Before: dt.vac24Before,
      rivals0: dt.rivals0, rivalsFailed: dt.rivalsFailed, rivalsAfter: alive, swans: dt.swans, headlines: dt.headlines,
      nw0: dt.nw0, nwMin: dt.nwMin, nwEnd, cash0: dt.cash0, cashMin: dt.cashMin, deeds0: dt.deeds0, liveJobs0: dt.liveJobs0,
      myStarts: jobLog.length - dt.started0,
      mySales: sales.slice(dt.sales0).filter((x) => !x.forced).length, myForced: sales.slice(dt.sales0).filter((x) => x.forced).length,
    };
    downturns.push(rec);
    J(`DOWNTURN ${rec.startY}-${rec.endY} (${rec.months} mo${rec.depression ? ", reached DEPRESSION" : ""}): index ${rec.pre.idx}%→peak ${rec.worst.idx}%, local unemp ${rec.pre.localUnemp}%→${rec.worst.localUnemp}%, jobs ${rec.pre.jobs.toLocaleString()}→${rec.worst.jobs.toLocaleString()}, office vac ${pct(rec.pre.vac.office)}→${pct(rec.worst.vac.office)}, MF vac ${pct(rec.pre.vac.multifamily)}→${pct(rec.worst.vac.multifamily)}, ${rec.rivalsFailed.length} rivals failed; my NW ${K(rec.nw0)}→low ${K(rec.nwMin)}→${K(rec.nwEnd)}`);
    dt = null;
  }
}

// ---------------------------------------------------------------- the town, yearly
const town = [];
const cpi0 = g.econ.cpi ?? 1;
function townRow() {
  const e = g.econ, R = e.streetRolls ?? {};
  const byClass = {}, bySec = {}, big = [];
  for (const [b, r] of Object.entries(R)) for (const t of r.t) {
    const k = t.use ?? "office"; byClass[k] = (byClass[k] ?? 0) + 1;
    const hc = (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1);
    bySec[t.sector] = (bySec[t.sector] ?? 0) + hc;
    big.push({ name: t.name, sector: t.sector, use: k, sf: Math.round(t.sf), b });
  }
  big.sort((a, b) => b.sf - a.sf);
  const yrFail = (e.streetFailed ?? []).filter((x) => x.m > g.month - 12);
  const n = e.nat ?? {};
  return {
    y: yr(), pop: e.population, jobs: e.jobs, unemp: +((e.unemployment ?? 0) * 100).toFixed(1), natUnemp: +((n.unemp ?? 0) * 100).toFixed(1),
    infl: +((n.infl ?? 0) * 100).toFixed(1), policy: +(n.policy ?? 0).toFixed(2), gap: +((n.gap ?? 0) * 100).toFixed(1), idx: +e.indexRate.toFixed(2),
    cpi: +((e.cpi ?? 1) / cpi0).toFixed(3), rwage: +(((e.wageIdx ?? 1) / (e.cpi ?? 1))).toFixed(3), online: +((e.online ?? 0) * 100).toFixed(1),
    tech: +(n.techLn ?? 0).toFixed(3), fx: +((n.dem?.q ?? 0) * 100).toFixed(1),
    rentAsk: Object.fromEntries(BUILT.map((u) => [u, +(e.rentIdx?.[u] ?? 0).toFixed(2)])),
    rentEff: Object.fromEntries(BUILT.map((u) => [u, +(e.effRentIdx?.[u] ?? e.rentIdx?.[u] ?? 0).toFixed(2)])),
    rentReal: Object.fromEntries(BUILT.map((u) => [u, +((e.effRentIdx?.[u] ?? e.rentIdx?.[u] ?? 0) / ((e.cpi ?? 1) / cpi0)).toFixed(2)])),
    vac: Object.fromEntries(BUILT.map((u) => [u, +((e.cityVac?.[u] ?? 0) * 100).toFixed(1)])),
    cap: Object.fromEntries(BUILT.map((u) => [u, +((e.capRate?.[u] ?? 0)).toFixed(2)])),
    stock: Object.fromEntries(BUILT.map((u) => [u, Math.round((e.stock?.[u] ?? 0) / 1e3)])),
    firms: byClass, trades: Object.fromEntries(Object.entries(bySec).map(([k, v]) => [k, Math.round(v / 1e3)])),
    biggest: big.slice(0, 3), failed: yrFail.filter((x) => x.why === "dark").length, left: yrFail.filter((x) => x.why === "left" && !x.to).length,
    moves: yrFail.filter((x) => x.to).length, seekers: (e.seekers ?? []).length,
    rivals: (g.rivals ?? []).filter((r) => r.failedM === undefined).length, swans: (g.swanLog ?? []).length,
  };
}

// ---------------------------------------------------------------- the clock
const snaps = [snapshot()];
const years = [];
let firstTop = null;
J(`OPEN: ${K(open)} on a ${bbls.length}-lot Great City map (${snaps[0].vacantLots} vacant), ${snaps[0].field - 1} rivals; you rank #${snaps[0].rank}. Index ${g.econ.indexRate.toFixed(2)}%, ${g.econ.phase}.`);
while (g.month < YEARS * 12 && !g.gameOver) {
  workTalks(); clearSites(); lease(); build(); manage();
  shop(); offMarket();
  for (let k = 0; k < 6 && Object.keys(g.talks ?? {}).length; k++) workTalks();
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (RAISE) checkRaises();
  recordExits();
  trackDownturn();
  if (g.month % 12 === 0) {
    const bd = board();
    const rank = bd.findIndex((r) => r.name === "You") + 1;
    const nw = E.netWorth(g, parcels);
    years.push({ y: yr(), nw: Math.round(nw), cash: Math.round(g.cash), rank, field: bd.length, leader: bd[0].name, leaderEq: Math.round(bd[0].eq), phase: g.econ.phase, idx: +g.econ.indexRate.toFixed(2), deeds: Object.keys(g.holdings).length, jobs: Object.keys(g.developments).length,
      cap: (() => { const rp = E.reputationNow(g); const t = E.playerTerms(g); return { band: t.band, score: rp?.score !== undefined ? +(+rp.score).toFixed(2) : null, rank: rp ? `${rp.rank}/${rp.of}` : null, deals: rp?.deals, perOwn: t.perOwn, terms: E.termsLine(t), ff: Math.round(g.ffNetwork?.cap ?? 0), outside: Math.round(E.outsideCapacity(g)), syn: Object.keys(g.syndications ?? {}).length, raising: Object.keys(g.raises ?? {}).length }; })() });
    if (rank === 1 && !firstTop) { firstTop = yr(); J(`TOOK #1 on the street at ${K(nw)}`); }
    town.push(townRow());
    if (process.env.PROGRESS) console.log(`${yr()} ${g.econ.phase.padEnd(10)} idx ${g.econ.indexRate.toFixed(1)}% NW ${K(nw)} cash ${K(g.cash)} #${rank}/${bd.length} deeds ${Object.keys(g.holdings).length} jobs ${Object.keys(g.developments).length} started ${jobLog.length}`);
  }
  if (g.month % 240 === 0) snaps.push(snapshot());
}
if (g.month % 240 !== 0) snaps.push(snapshot());
const result = {
  seed: SEED, years: YEARS, cash0: CASH, lots: bbls.length, gameOver: g.gameOver ?? null, endMonth: g.month, firstTop,
  snaps, years, town, downturns, openDownturn: dt ? { startY: dt.startY, months: g.month - dt.startM, pre: dt.pre, worst: dt.worst, rivalsFailed: dt.rivalsFailed, swans: dt.swans, headlines: dt.headlines } : null, jobs: jobLog, capLog, sales, landBuys, counters: C, friction: ERR, listedUnsellable, tape, offMarket: om, finalBoard: board().slice(0, 12), journal,
};
writeFileSync(OUT, JSON.stringify(result, null, 1));
if (process.env.STATE) writeFileSync(process.env.STATE, JSON.stringify(g));
const last = snaps.at(-1);
console.log(`END ${yr()}${g.gameOver ? " GAME OVER " + JSON.stringify(g.gameOver).slice(0, 160) : ""}: NW ${K(last.nw)} rank #${last.rank}/${last.field}, jobs ${jobLog.length}, sales ${sales.length}, first #1 ${firstTop ?? "never"} → ${OUT}`);
