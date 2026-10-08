// ONE DEVELOPER-ONLY PLAYTHROUGH, played as a person sitting at the Build desk.
// Buys dirt (never standing income), builds what the desk's "best schemes"
// sweep says pencils, leases it up, takes out the mini-perm, and recycles by
// selling stabilised product. Logs every friction point a developer meets:
// why land was skipped, why a groundbreak was refused, what stopped the clock,
// how long lease-up took, what the mini-perm did at its balloon.
//   pnpm engine && node tools/playdev1.mjs     (SEED=4242 YEARS=40 CASH=5000000)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const E = await import(ROOT + "/test/.engine.mjs");
const { loadCity } = await import(ROOT + "/test/city.mjs");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const SEED = Number(process.env.SEED ?? 4242);
const YEARS = Number(process.env.YEARS ?? 40);
const CASH = Number(process.env.CASH ?? 5_000_000);
const QUIET = process.env.QUIET === "1";
const K = (n) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${(n / 1e3).toFixed(0)}K`);
const out = (...a) => console.log(...a);

let g = E.firstListings(E.newGame(SEED, parcels, CASH), parcels, bbls);
const open = g.cash;
out(`seed ${SEED} · phase ${g.econ.phase} · index ${g.econ.indexRate.toFixed(2)}% · cash ${K(g.cash)} · listings ${g.listings.length} (${g.listings.filter((l) => E.resolveRec(parcels, g, l.bbl)?.class === "land").length} land)`);

const yr = () => Math.floor(g.month / 12);
const journal = [];
const J = (s) => { journal.push(`y${String(yr() + 1).padStart(2)} m${String(g.month).padStart(3)} ${s}`); };
const C = {}; const bump = (k, n = 1) => { C[k] = (C[k] ?? 0) + n; };
const ERR = {}; const err = (where, msg) => { const k = where + ": " + String(msg).replace(/\$[\d.,]+[KMB]?/g, "$X").replace(/\d[\d,.]*/g, "N").slice(0, 150); ERR[k] = (ERR[k] ?? 0) + 1; };
const stopsByHead = {}; const stopEx = {};
const DK = {};
const jobs = {};   // bbl -> { start, deliver, use, sf, plannedYoc, ...}

const USES = ["office", "multifamily", "mixed", "retail", "industrial"];
// The desk's "Find the best schemes on this lot" button, verbatim in spirit:
// every use at a spread of heights, at the default dials (60% cover, GMP, spec 0.5).
function sweep(bbl, landBasis) {
  const rec = E.resolveRec(parcels, g, bbl);
  const rows = [];
  for (const u of USES) {
    const top = E.maxFloorsFor(rec, 0.6, u);
    const steps = [...new Set([2, 4, 6, 8, 12, 16, 20, 25, 30, 40, 50, top].filter((x) => x >= 1 && x <= top))];
    for (const f of steps) {
      const p = E.planDevelopment(g, parcels, bbl, u, f, 0.6, "gmp", undefined, undefined, undefined, 0.5, landBasis);
      if (!p) continue;
      rows.push({ use: u, floors: f, p, hurdle: p.hurdleRatio, equity: p.equity + p.pointsCost });
    }
  }
  // and the scheme the desk opens on (landRead's residual scheme), at its own footprint
  const seed = rec.class === "land" ? E.landRead(rec, g.econ).scheme : null;
  if (seed && seed.floors > 0) {
    const p = E.planDevelopment(g, parcels, bbl, seed.use, seed.floors, seed.coverage, "gmp", undefined, undefined, undefined, 0.5, landBasis);
    if (p) rows.push({ use: seed.use, floors: seed.floors, cov: seed.coverage, p, hurdle: p.hurdleRatio, equity: p.equity + p.pointsCost, seeded: true });
  }
  return rows.sort((a, b) => b.hurdle - a.hurdle);
}
const HURDLE = Number(process.env.HURDLE ?? 1.0);

function reserve() {
  let ds = 0;
  for (const h of Object.values(g.holdings)) ds += h.loan?.monthlyPmt ?? 0;
  return Math.max(250_000, ds * 4 + E.firmOverheadMonthly(g, parcels) * 6);
}
const fundable = () => E.fundableNow(g, parcels);
const committed = () => Object.values(g.developments ?? {}).reduce((a, d) => a + Math.max(0, (d.equityBudget ?? 0) - (d.equitySpent ?? 0)), 0);

// ---------------------------------------------------------------- shopping for dirt
const tape = { scans: 0, landSeen: 0, landPencil: 0, landAffordablePencil: 0, bestHurdles: [] };
const seenLand = new Set();
function shop() {
  if (Object.keys(g.talks ?? {}).length >= 2) return;
  const free = fundable() - reserve() - committed();
  tape.scans++;
  let best = null;
  for (const l of g.listings) {
    if (g.holdings[l.bbl] || g.talks?.[l.bbl] || !(l.ask > 0)) continue;
    const rec = E.resolveRec(parcels, g, l.bbl);
    if (!rec || rec.class !== "land") continue;
    const key = l.bbl + ":" + l.listedM;
    const first = !seenLand.has(key);
    if (first) { seenLand.add(key); tape.landSeen++; }
    const rows = sweep(l.bbl, l.ask);
    const top = rows[0];
    if (first) tape.bestHurdles.push(top ? top.hurdle : 0);
    if (!top) { if (first) err("land", "no scheme prices on this lot"); continue; }
    if (top.hurdle < HURDLE) { if (first) err("land", top.hurdle >= 1 ? "pencils but thin" : "does not pencil"); continue; }
    if (first) tape.landPencil++;
    // could I fund the dirt AND the job? A developer asks that before bidding
    const allIn = l.ask * 1.03 + top.equity + top.p.costTotal * 0.06;
    if (allIn > free) {
      // find the best scheme I could afford
      const fit = rows.find((r) => r.hurdle >= HURDLE && l.ask * 1.03 + r.equity + r.p.costTotal * 0.06 <= free);
      if (!fit) { if (first) err("land", "pencils, but dirt + equity exceeds what I can fund"); continue; }
      if (first) tape.landAffordablePencil++;
      const score = fit.hurdle;
      if (!best || score > best.score) best = { l, rec, row: fit, score };
      continue;
    }
    if (first) tape.landAffordablePencil++;
    if (!best || top.hurdle > best.score) best = { l, rec, row: top, score: top.hurdle };
  }
  if (!best) return;
  const bid = Math.round(best.l.ask * 0.92);
  const r = E.negotiate(g, parcels, best.l.bbl, bid);
  bump("decisions");
  if (r.err) { err("negotiate", r.err); return; }
  g = r.s; bump("landBids");
  J(`BID ${K(bid)} on lot ${best.rec.address} (ask ${K(best.l.ask)}, ${Math.round(best.rec.lotArea).toLocaleString()} sf lot) — best scheme ${best.row.use} ${best.row.floors}fl ${best.row.hurdle.toFixed(2)}x, equity ${K(best.row.equity)}`);
}

function workTalks() {
  for (const t of Object.values(g.talks ?? {})) {
    const rec = E.resolveRec(parcels, g, t.bbl);
    if (!rec) continue;
    bump("decisions");
    if (t.agreed) {
      const px = t.agreedPrice ?? t.theirPrice;
      // land loan if it quotes, else cash
      let product = "cash";
      const q = E.buyQuote(g, parcels, t.bbl, px, "land", 1);
      if (q.principal > 0 && q.equity < g.cash - reserve() * 0.5) product = "land";
      else if (px * 1.03 > g.cash - reserve() * 0.5) {
        J(`can't fund close on ${rec.address} (${K(px)}): land loan ${q.principal > 0 ? "needs " + K(q.equity) : "bind=" + q.bind}`);
        err("close", `land loan bind=${q.bind}; cash short`);
      }
      const r = E.closeDeal(g, parcels, t.bbl, product, 1);
      if (r.err) { err("close", r.err); J(`couldn't close ${rec.address}: ${r.err.slice(0, 120)}`); g = E.walkAway(g, parcels, t.bbl).s; continue; }
      g = r.s; bump("landBought");
      J(`BOUGHT lot ${rec.address} for ${K(px)} (${product}${product === "land" ? ` ${K(q.principal)} @${q.ratePct?.toFixed(2)}%` : ""})`);
      continue;
    }
    const gap = t.theirPrice / Math.max(1, t.yourPrice) - 1;
    // re-test the scheme at THEIR price before chasing it
    const top = sweep(t.bbl, t.theirPrice)[0];
    if (!top || top.hurdle < 1.0) { g = E.walkAway(g, parcels, t.bbl).s; J(`walked from ${rec.address}: at their ${K(t.theirPrice)} the best scheme is ${top ? top.hurdle.toFixed(2) + "x" : "nothing"}`); bump("landWalked"); continue; }
    if (gap < 0.05 || (t.round >= 2 && gap < 0.09)) { const r = E.acceptCounter(g, parcels, t.bbl); if (!r.err) g = r.s; else err("acceptCounter", r.err); }
    else if (t.final) { g = E.walkAway(g, parcels, t.bbl).s; bump("landWalked"); }
    else { const r = E.negotiate(g, parcels, t.bbl, Math.round(t.yourPrice * 0.6 + t.theirPrice * 0.4)); if (!r.err) g = r.s; else err("negotiate", r.err); }
  }
}

// ---------------------------------------------------------------- off-market dirt
// The tape rarely carries a lot that pencils, so a developer clicks round the
// map: every vacant lot whose parcel card reads "Developable" (landRead's
// builder wins), phone the owner, and buy if the desk sweep pencils at their
// number. Twice a year, at most four calls a round.
const om = { rounds: 0, candidates: 0, calls: 0, refused: 0, named: 0, blind: 0, bought: 0, tooDear: 0, cantFund: 0, err: 0 };
const omH = [];
const vacantLots = bbls.filter((b) => { const r = parcels[b]; return r && r.class === "land" && !(r.bldgArea > 0); });
function offMarket() {
  if (g.month % 6 !== 0 || Object.keys(g.talks ?? {}).length) return;
  const free = fundable() - reserve() - committed();
  if (free < 500_000) return;
  om.rounds++;
  const cands = [];
  for (const b of vacantLots) {
    if (g.holdings[b] || g.listings.some((l) => l.bbl === b)) continue;
    const rec = E.resolveRec(parcels, g, b);
    if (!rec || rec.class !== "land" || rec.bldgArea > 0 || E.isCivicLand(g, b) || g.landmarks?.[b] !== undefined) continue;
    const lr = E.landRead(rec, g.econ);
    if (lr.winner !== "builder" || !(lr.builder > 0)) continue;
    const a = g.approaches?.[b];
    if (a && g.month < a.q + 6) continue;
    cands.push({ b, rec, lr, v: E.landValue(rec, g.econ) });
  }
  om.candidates += cands.length;
  cands.sort((x, y) => x.v - y.v);
  let calls = 0;
  for (const c of cands) {
    if (calls >= 4) break;
    if (c.v * 1.4 > free) continue;
    calls++; om.calls++; bump("decisions");
    const r = E.approachOwner(g, parcels, adjacency, c.b);
    if (r.err) { om.err++; err("approach", r.err); continue; }
    g = r.s;
    if (r.refused) { om.refused++; continue; }
    let price;
    if (r.blind) { om.blind++; price = Math.round(c.v); }
    else { om.named++; price = r.ask; }
    const rows = sweep(c.b, price);
    const fit = rows.find((x) => x.hurdle >= HURDLE && price * 1.03 + x.equity + x.p.costTotal * 0.06 <= free);
    if (!fit) {
      if (rows[0] && rows[0].hurdle >= HURDLE) { om.cantFund++; err("off-market", "pencils at owner's number but I cannot fund dirt + job"); }
      else { om.tooDear++; omH.push(+(rows[0]?.hurdle ?? 0).toFixed(2)); err("off-market", `owner's number too dear (best ${rows[0] ? (rows[0].hurdle >= 1 ? "1.00-1.05" : rows[0].hurdle >= 0.9 ? "0.90-1.00" : "<0.90") : "none"}x at ${r.blind ? "card value" : "ask"}, ask/value ${(price / c.v).toFixed(1)})`); }
      continue;
    }
    const q = E.buyQuote(g, parcels, c.b, price, "land", 1);
    const product = q.principal > 0 && q.equity < g.cash - reserve() * 0.5 ? "land" : "cash";
    const b = E.buyOffMarket(g, parcels, c.b, product, 1, price);
    bump("decisions");
    if (b.err) { err("buyOffMarket", b.err); continue; }
    if (b.s.holdings[c.b]) {
      g = b.s; om.bought++; bump("landBought");
      J(`BOUGHT OFF-MARKET lot ${c.rec.address} for ${K(price)} (${r.blind ? "blind bid at card value" : "their ask"}, value ${K(c.v)}) — ${fit.use} ${fit.floors}fl ${fit.hurdle.toFixed(2)}x`);
      break;
    } else { g = b.s; err("buyOffMarket", b.msg ?? "no"); }
  }
}

// ---------------------------------------------------------------- the Build desk
const landIdle = {};   // bbl -> months sat owned with no job
function build() {
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec || rec.class !== "land" || g.developments[h.bbl] || h.sale || g.merged?.[h.bbl]) continue;
    landIdle[h.bbl] = (landIdle[h.bbl] ?? 0) + 1;
    // build-to-suit signed terms on the table? take them if they pencil
    const bts = g.btsProspects?.[h.bbl];
    const rows = sweep(h.bbl);
    if (!rows.length) { if (landIdle[h.bbl] % 12 === 1) err("build", "no scheme prices on owned lot"); continue; }
    const free = fundable() - reserve() - committed();
    let pick = rows.find((r) => r.hurdle >= 1.0 && r.equity + r.p.costTotal * 0.06 <= free);
    if (!pick) {
      if (rows[0].hurdle < 1.0) { if (landIdle[h.bbl] % 12 === 1) { err("build", "owned lot no longer pencils"); J(`lot ${rec.address} no longer pencils (best ${rows[0].use} ${rows[0].hurdle.toFixed(2)}x) — waiting`); } }
      else if (landIdle[h.bbl] % 6 === 1) { err("build", "pencils but equity exceeds fundable"); J(`lot ${rec.address} pencils (${rows[0].hurdle.toFixed(2)}x) but needs ${K(rows[0].equity)} equity; I can fund ${K(free)}`); }
      // offer it for build-to-suit while I wait, if a BTS use pencils
      if (!h.btsOffer && !bts) {
        const b = rows.find((r) => ["office", "retail", "industrial"].includes(r.use) && r.hurdle >= 0.95);
        if (b) { const r = E.proposeBuildToSuit(g, parcels, h.bbl, b.use, b.floors, b.cov ?? 0.62); bump("decisions"); if (!r.err) { g = r.s; bump("btsListed"); J(`shopped ${rec.address} for build-to-suit: ${b.use} ${b.floors}fl`); } else err("bts", r.err); }
      }
      continue;
    }
    let custom;
    if (bts && pick) {
      custom = { bts };
    }
    const r = E.startDevelopment(g, parcels, h.bbl, pick.use, pick.floors, pick.cov ?? 0.6, "gmp", undefined, custom, undefined, 0.5);
    bump("decisions");
    if (r.err) { err("startDevelopment", r.err); J(`BUILD REFUSED ${rec.address} ${pick.use} ${pick.floors}fl: ${r.err.slice(0, 160)}`); continue; }
    g = r.s; bump("built");
    const d = g.developments[h.bbl];
    jobs[h.bbl] = { start: g.month, plannedDeliver: d.deliverM, use: pick.use, sf: d.sf, yoc: pick.p.yieldOnCost, hurdle: pick.hurdle, cost: d.costTotal, landBasis: d.landBasis, bts: !!custom?.bts, idle: landIdle[h.bbl] };
    delete landIdle[h.bbl];
    J(`BREAK GROUND ${rec.address}: ${pick.use} ${d.floors}fl ${Math.round(d.sf).toLocaleString()}sf, $${(d.costTotal / 1e6).toFixed(1)}M, YoC ${pick.p.yieldOnCost.toFixed(2)}% vs ${pick.p.requiredYield.toFixed(2)}% (${pick.hurdle.toFixed(2)}x), ${(pick.p.ltc * 100).toFixed(0)}% LTC, equity ${K(pick.equity)}, ${pick.p.months} mo${custom?.bts ? ", BTS " + custom.bts.name : ""}`);
  }
}

// ---------------------------------------------------------------- leasing
function lease() {
  if (!g.leasingPlan) {
    g = structuredClone(g);
    for (const u of ["office", "retail", "industrial"]) E.patchPlanRow(g, u, { targetNePct: 0.95, patienceM: 12 });
    J("POSTED leasing sheet: 95% NE, 12 months' patience");
  }
  if (g.lois.some((l) => E.loiNeedsPrincipal(g, l))) {
    const r = E.clearTrayAgainstPlan(g, parcels);
    g = r.s; bump("decisions"); bump("trayPasses"); bump("lettersSigned", r.signed); bump("lettersCountered", r.countered);
  }
  let guard = 0;
  while (guard++ < 60) {
    const mine = g.lois.filter((l) => E.loiNeedsPrincipal(g, l) && !l._seen);
    if (!mine.length) break;
    const loi = mine[0];
    const rec = E.resolveRec(parcels, g, loi.bbl); const h = g.holdings[loi.bbl];
    if (!rec || !h) { loi._seen = true; continue; }
    const mk = E.managedRentPsfYr(rec, g.econ, h, loi.use);
    const ne = E.loiMandateScore(loi, mk);
    // a developer in lease-up takes more than a landlord would
    const inLeaseUp = h.deliveredM !== undefined && g.month - h.deliveredM < 36;
    const r = E.respondLOI(g, parcels, loi.id, ne >= (inLeaseUp ? 0.80 : 0.88) ? "accept" : "pass");
    bump("decisions"); bump("lettersByHand");
    if (r.err) { err("respondLOI", r.err); const l = g.lois.find((x) => x.id === loi.id); if (l) l._seen = true; }
    else g = r.s;
  }
  for (const a of [...(g.asks ?? [])]) { const r = E.answerAsk(g, parcels, a.id, "decline"); bump("decisions"); if (!r.err) g = r.s; }
}

// ---------------------------------------------------------------- the book
const deliveries = {};   // bbl -> { m, occAt: {12,24,36}, stabM }
function manage() {
  const e = g.econ;
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec || rec.class === "land" || g.developments[h.bbl]) continue;
    const occ = E.physicalOcc(rec, h);
    // delivery bookkeeping
    if (process.env.DUMP && jobs[h.bbl] && !deliveries[h.bbl] && h.deliveredM === undefined) { /* not yet */ }
    if (h.deliveredM !== undefined && jobs[h.bbl] && !deliveries[h.bbl]) {
      deliveries[h.bbl] = { m: h.deliveredM, occ0: occ, occAt: {}, slipM: h.deliveredM - jobs[h.bbl].plannedDeliver, value0: E.ownedHoldingValue(g, parcels, h), basis: h.costBasis };
      J(`DELIVERED ${rec.address}: ${(occ * 100).toFixed(0)}% let on day one, ${deliveries[h.bbl].slipM >= 0 ? "+" : ""}${deliveries[h.bbl].slipM} mo vs plan; value ${K(deliveries[h.bbl].value0)} vs basis ${K(h.costBasis)}; mini-perm ${K(h.loan?.balance ?? 0)} @${h.loan?.ratePct}%`);
    }
    const dv = deliveries[h.bbl];
    if (dv) {
      const age = g.month - dv.m;
      for (const a of [6, 12, 24, 36, 48]) if (age === a) dv.occAt[a] = occ;
      if (process.env.DUMP && (age === 0 || age === 6 || age === 12 || age === 18 || age === 24)) {
        const stabNoi = E.noiYr(rec, e, h.condition, true, h.condIdx);
        const asset = E.assetValue(rec, e);
        out(`DUMP ${rec.address} age ${age} occ ${occ.toFixed(2)} stabOcc ${E.stabilisedOccupancy(rec, e).toFixed(2)} mark ${K(E.ownedHoldingValue(g, parcels, h))} basis ${K(h.costBasis)} stabNOI ${K(stabNoi)} inPlaceNOI ${K(E.ownedHoldingNoiYr(g, parcels, h))} street-asset ${K(asset)} lease-up weight ${E.leaseUpWeight(rec, age).toFixed(2)} cap≈${(stabNoi / Math.max(1, asset) * 100).toFixed(2)}% idx ${e.indexRate.toFixed(2)} mfVac ${(e.cityVac.multifamily * 100).toFixed(1)}% rentIdx ${(e.rentIdx?.multifamily ?? 0).toFixed?.(3)}`);
      }
      if (process.env.TRACE && age % 3 === 0 && age <= 60) out(`TRACE ${rec.address} age ${age} occ ${occ.toFixed(3)} target ${rec.class === "multifamily" ? E.useOccupancy(rec, e, "multifamily").toFixed(3) : "-"} cityVac ${(e.cityVac[rec.class] ?? 0).toFixed(3)} demand ${rec.demandScore?.toFixed?.(1)}`);
      if (dv.stabM === undefined && occ >= 0.9) { dv.stabM = age; J(`STABILISED ${rec.address} at ${age} months (${(occ * 100).toFixed(0)}%)`); }
    }
    // brokers on anything in lease-up
    if (occ < 0.85 && !h.broker) { const r = E.setBroker(g, parcels, h.bbl, true); if (r?.s && !r.err) { g = r.s; bump("decisions"); bump("brokerOn"); } }
    if (occ > 0.93 && h.broker) { const r = E.setBroker(g, parcels, h.bbl, false); if (r?.s && !r.err) { g = r.s; bump("decisions"); } }
    // take out the mini-perm once stabilised, or at the balloon
    const l = h.loan;
    if (l) {
      const toMat = l.maturityM - g.month;
      const miniPerm = l.product === "cordage" && h.deliveredM !== undefined && l.originM === h.deliveredM;
      const want = (miniPerm && occ >= 0.88) || toMat <= 9;
      if (want && !h._refiTried?.[g.month]) {
        const { quotes, payoff } = E.refiQuotes(g, parcels, h.bbl);
        const live = quotes.filter((x) => x.available && x.maxProceeds > 0)
          .map((x) => ({ x, net: x.maxProceeds - payoff - Math.round(x.maxProceeds * x.points) }));
        const covers = live.filter((y) => y.net >= 0).sort((a, b) => a.x.ratePct - b.x.ratePct);
        const b = covers[0] ?? (toMat <= 9 ? live.sort((a, b2) => b2.net - a.net)[0] : null);
        if (b && (b.net >= 0 || toMat <= 9)) {
          if (b.net < 0 && g.cash < -b.net + reserve()) { err("refi", "takeout short of payoff and cash cannot cover gap"); J(`TAKEOUT GAP ${rec.address}: best desk ${b.x.id} short ${K(-b.net)}, ${toMat} mo to balloon, occ ${(occ * 100).toFixed(0)}%`); }
          else {
            const r = E.refinance(g, parcels, h.bbl, b.x.id, 1);
            bump("decisions");
            if (!r.err) { g = r.s; bump(miniPerm ? "takeouts" : "refis"); J(`${miniPerm ? "TOOK OUT mini-perm" : "REFI"} ${rec.address}: ${b.x.id} ${K(b.x.maxProceeds)} @${b.x.ratePct.toFixed(2)}% net ${K(b.net)} (occ ${(occ * 100).toFixed(0)}%, ${toMat} mo left)`); }
            else { err("refinance", r.err); }
          }
        } else if (toMat <= 9 && toMat % 3 === 0) { err("refi", "no desk quotes at the balloon"); J(`NO TAKEOUT ${rec.address}: ${toMat} mo to balloon, occ ${(occ * 100).toFixed(0)}%, payoff ${K(payoff)}; quotes ${quotes.map((q) => `${q.id}:${q.available ? K(q.maxProceeds) : "n/a " + (q.why ?? "").slice(0, 40)}`).join(" ")}`); }
      }
    }
    // MERCHANT EXIT: sell stabilised product into a decent market at a real profit
    if (!h.sale && dv && dv.stabM !== undefined && g.month - dv.m >= 24 && e.phase !== "recession" && e.phase !== "depression") {
      const val = E.ownedHoldingValue(g, parcels, h);
      if (val > h.costBasis * 1.2) {
        const r = E.listForSale(g, parcels, h.bbl, Math.round(val * 1.02), "marketed");
        bump("decisions");
        if (!r.err) { g = r.s; J(`LIST ${rec.address} at ${K(val * 1.02)} (basis ${K(h.costBasis)}, ${((val / h.costBasis - 1) * 100).toFixed(0)}% over)`); }
        else err("listForSale", r.err);
      }
    }
    if (h.sale) {
      const s = h.sale;
      if (s.offer && s.offer.contract && !s.offer.held) { /* closes itself */ }
      else if (s.offer) {
        bump("decisions");
        if (s.offer.price >= s.ask * 0.94) { const r = E.acceptSaleOffer(g, parcels, h.bbl); if (!r.err) { g = r.s; bump("sold"); J(`SOLD ${rec.address} ${K(s.offer.price)} (basis ${K(h.costBasis)})`); continue; } else err("acceptSaleOffer", r.err); }
        else if (!s.offer.countered) { const r = E.counterSale(g, parcels, h.bbl, Math.round(s.ask * 0.98)); if (r?.s && !r.err) g = r.s; }
      } else if (s.bids?.length) {
        bump("decisions");
        const live = s.bids.map((b, i) => ({ b, i })).filter((x) => !x.b.dropped).sort((a, b2) => b2.b.price - a.b.price);
        if (live.length && (live[0].b.price >= s.ask * 0.93 || (s.round ?? 0) >= 1)) { const r = E.acceptBid(g, parcels, h.bbl, live[0].i); if (!r.err) { g = r.s; J(`ACCEPTED bid ${K(live[0].b.price)} on ${rec.address} (basis ${K(h.costBasis)})`); } else err("acceptBid", r.err); }
        else if (live.length) { const r = E.bestAndFinal(g, parcels, h.bbl); if (!r.err) g = r.s; }
      } else if (g.month - s.listedM > 14) { g = E.delist(g, h.bbl); bump("decisions"); J(`DELISTED ${rec.address} — no buyer in 14 months`); }
    }
  }
  // the line: pay it down when flush
  const bal = g.loc?.balance ?? 0;
  if (bal > 0 && g.cash > reserve() * 2 + committed()) { const r = E.repayLoc(g, Math.min(bal, g.cash - reserve() * 2 - committed())); if (!r.err) g = r.s; }
}

// ---------------------------------------------------------------- the clock
let prevNW = E.netWorth(g, parcels);
const yearLines = [];
let soldBefore = 0;
while (g.month < YEARS * 12 && !g.gameOver) {
  workTalks(); lease(); build(); manage();
  shop(); offMarket(); for (let k = 0; k < 6 && Object.keys(g.talks ?? {}).length; k++) workTalks();
  const stop = E.stopRule(g, parcels);
  // a developer with money to place presses Month; otherwise Yr
  const hunting = fundable() - reserve() - committed() > 600_000 && !Object.keys(g.developments).length;
  const cap = hunting ? 1 : 12 - (g.month % 12);
  bump(hunting ? "monthPresses" : "yrPresses");
  let stopped = null;
  for (let i = 0; i < cap; i++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.month % 12 === 0) {
      const nw = E.netWorth(g, parcels);
      const hs = Object.values(g.holdings);
      const lots = hs.filter((h) => E.resolveRec(parcels, g, h.bbl)?.class === "land").length;
      yearLines.push(`yr ${String(g.month / 12).padStart(2)} ${g.econ.phase.padEnd(10)} idx ${g.econ.indexRate.toFixed(1).padStart(4)}%  NW ${K(nw).padStart(9)} (${nw >= prevNW ? "+" : ""}${((nw / prevNW - 1) * 100).toFixed(0)}%)  cash ${K(g.cash).padStart(8)}  line ${K(g.loc?.balance ?? 0).padStart(6)}/${K(E.locLimit(g, parcels)).padStart(6)}  ${String(hs.length).padStart(2)} deeds (${lots} lots, ${Object.keys(g.developments).length} jobs)  vac off ${((g.econ.cityVac.office ?? 0) * 100).toFixed(0)}% mf ${((g.econ.cityVac.multifamily ?? 0) * 100).toFixed(0)}% ret ${((g.econ.cityVac.retail ?? 0) * 100).toFixed(0)}%  land on tape ${g.listings.filter((l) => E.resolveRec(parcels, g, l.bbl)?.class === "land").length}`);
      prevNW = nw;
    }
    if (g.gameOver) break;
    const it = stop(g);
    if (it) { stopped = it; break; }
  }
  if (stopped) {
    bump("stops");
    const hd = stopped.key.split(":")[0];
    stopsByHead[hd] = (stopsByHead[hd] ?? 0) + 1;
    (stopEx[hd] ??= []).length < 3 && stopEx[hd].push(`m${g.month}: ${stopped.label}`);
    for (const it2 of E.attentionItems(g, parcels)) { const h2 = it2.key.split(":")[0]; DK[h2] = (DK[h2] ?? 0) + 1; }
    if (hd === "sheet-review") { for (const r of E.sheetReview(g, parcels)) E.patchPlanRow(g, r.use, { targetNePct: r.suggest }); bump("decisions"); }
  }
}

// ---------------------------------------------------------------- report
const nw = E.netWorth(g, parcels);
out("\n" + yearLines.join("\n"));
out(`\nEND month ${g.month}${g.gameOver ? " — GAME OVER: " + JSON.stringify(g.gameOver).slice(0, 200) : ""}: NW ${K(nw)} (${(nw / open).toFixed(1)}x on ${K(open)}) cash ${K(g.cash)} deeds ${Object.keys(g.holdings).length}`);
const board = (g.rivals ?? []).filter((r) => r.failedM === undefined).map((r) => ({ name: r.name, eq: E.rivalEquity(E.markRival(g, parcels, r), r) }));
board.push({ name: "You", eq: nw }); board.sort((a, b) => b.eq - a.eq);
out(`street: ${board.findIndex((b) => b.name === "You") + 1} of ${board.length}; top ${board[0].name} ${K(board[0].eq)}`);
out("\ncounters:", JSON.stringify(C));
const bh = tape.bestHurdles.slice().sort((a, b) => a - b);
const q = (p) => bh.length ? bh[Math.floor((bh.length - 1) * p)].toFixed(2) : "-";
out(`land tape: ${tape.landSeen} land listings seen; best-scheme hurdle at ask p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)}; ${tape.landPencil} cleared 1.05; ${tape.landAffordablePencil} of those I could fund`);
out("\nfriction (why things did not happen):\n  " + Object.entries(ERR).sort((a, b) => b[1] - a[1]).map(([k, v]) => String(v).padStart(4) + "  " + k).join("\n  "));
out("\nstops by cause:", JSON.stringify(Object.entries(stopsByHead).sort((a, b) => b[1] - a[1])));
for (const [k, v] of Object.entries(stopEx)) out(`  ${k}: ${v.join(" | ")}`);
out("docket rows seen at stops:", JSON.stringify(Object.entries(DK).sort((a, b) => b[1] - a[1])));
out("\nJOBS");
for (const [bbl, j] of Object.entries(jobs)) {
  const dv = deliveries[bbl];
  const rec = E.resolveRec(parcels, g, bbl);
  out(`  ${rec?.address ?? bbl}: ${j.use} ${Math.round(j.sf).toLocaleString()}sf start m${j.start} (lot idle ${j.idle} mo) plan ${j.hurdle.toFixed(2)}x YoC ${j.yoc.toFixed(2)}%${j.bts ? " BTS" : ""} | ${dv ? `delivered m${dv.m} (${dv.slipM >= 0 ? "+" : ""}${dv.slipM}), day-one ${(dv.occ0 * 100).toFixed(0)}%, occ@12 ${((dv.occAt[12] ?? NaN) * 100).toFixed(0)}% @24 ${((dv.occAt[24] ?? NaN) * 100).toFixed(0)}% @36 ${((dv.occAt[36] ?? NaN) * 100).toFixed(0)}%, stab ${dv.stabM ?? "never"} mo, value0/basis ${(dv.value0 / dv.basis).toFixed(2)}` : g.developments[bbl] ? "under construction" : "not delivered (lost?)"}${g.holdings[bbl] ? "" : " — no longer owned"}`);
}
out("off-market:", JSON.stringify(om), "hurdles at owner's number (sorted):", JSON.stringify(omH.sort((a, b) => a - b).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 25)) === 0)));
if (!QUIET) out("\nJOURNAL\n" + journal.join("\n"));
