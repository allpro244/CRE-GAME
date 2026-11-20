// 50-year play: City size (~1,400 lots), Frontier build-out, $5M. Mixed strategy:
// buy income that clears the coupon, buy dirt that pencils, build up to 3 jobs, lease, refi, sell into strength.
//   pnpm engine && BW_SIZE=city BW_DENSITY=frontier SEED=12007 node tools/play50-frontier.mjs
import { writeFileSync } from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;
const E = await import(ROOT + "test/.engine.mjs");
const { loadCity } = await import(ROOT + "test/city.mjs");
const { parcels, adjacency, bbls, seed: citySeed } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 12007);
const OUT = process.env.OUT ?? `play50-frontier-${SEED}.json`;
const START = 5e6, MONTHS = 600;
const CL = ["office", "retail", "multifamily", "industrial"];
const NAT = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };
const M = (n) => { const a = Math.abs(n); return a >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : a >= 1e3 ? `$${(n/1e3).toFixed(0)}k` : `$${Math.round(n)}`; };
const errs = {}; const noteErr = (k, r) => { if (r?.err) { const key = k + ": " + String(r.err).slice(0, 90); errs[key] = (errs[key] ?? 0) + 1; } return r; };

function board(g) {
  const rows = (g.rivals ?? []).filter((r) => r.failedM === undefined).map((r) => {
    const mk = E.markRival(g, parcels, r);
    return { name: r.name, style: r.style, eq: mk.aum - r.debt + r.cash, aum: mk.aum, bldgs: r.bbls.length };
  });
  const nw = E.netWorth(g, parcels);
  rows.push({ name: "You", style: "player", eq: nw, aum: nw, bldgs: Object.keys(g.holdings).length });
  rows.sort((a, b) => b.eq - a.eq);
  return rows;
}

function portfolio(g) {
  const by = {}; for (const c of CL) by[c] = { n: 0, sf: 0, occW: 0, leased: 0, rentW: 0, mktW: 0, noi: 0, value: 0 };
  let land = 0, debt = 0;
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl); if (!rec) continue;
    debt += h.loan?.balance ?? 0;
    if (rec.class === "land" || g.developments?.[h.bbl]) { land++; continue; }
    const b = by[rec.class]; if (!b) continue;
    b.n++; b.sf += rec.bldgArea;
    b.value += E.holdingValue(rec, g.econ, h, g.month);
    b.noi += E.holdingNOIYr(rec, g.econ, h, g.month);
    const mkt = E.managedRentPsfYr(rec, g.econ, h, rec.class);
    b.occW += E.occupancyRead(rec, h).lettableOcc * rec.bldgArea; // lettable occupancy, as the Leasing screen reads it
    if (rec.class === "multifamily") {
      const occ = h.occ ?? 0; b.leased += occ * rec.bldgArea;
      b.rentW += (h.resRentPsf ?? mkt) * occ * rec.bldgArea; b.mktW += mkt * rec.bldgArea;
    } else {
      for (const t of h.tenants ?? []) { b.leased += t.sf; b.rentW += t.rentPsf * t.sf; }
      b.mktW += mkt * rec.bldgArea;
    }
  }
  const out = {};
  for (const c of CL) { const b = by[c]; out[c] = { n: b.n, sf: Math.round(b.sf), occ: b.sf ? b.occW / b.sf : null,
    inPlace: b.leased ? b.rentW / b.leased : null, market: b.sf ? b.mktW / b.sf : null, noi: b.noi, value: b.value }; }
  return { byClass: out, land, debt };
}

let g = E.firstListings(E.newGame(SEED, parcels, START), parcels, bbls);
const st = { bought: 0, boughtLand: 0, sold: 0, built: 0, delivered: 0, leases: 0, declined: 0, refis: 0, lowCash: 0, taken: 0 };
const years = [], story = []; const push = (t) => story.push(`${2000 + Math.floor(g.month / 12)}: ${t}`);
let peak = START, dd = 0, everFirst = null;
const prevDev = new Set();
for (let m = 0; m < MONTHS; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  const e = g.econ;
  const loose = (k) => (e.cityVac?.[k] ?? NAT[k]) > NAT[k] + 0.02;
  const tight = (k) => (e.cityVac?.[k] ?? NAT[k]) < NAT[k] - 0.015;
  const soft = e.phase === "recession" || e.phase === "depression";
  const hot = e.phase === "peak" || e.phase === "expansion";
  // deliveries
  const nowDev = new Set(Object.keys(g.developments ?? {}));
  for (const b of prevDev) if (!nowDev.has(b) && g.holdings[b]) { st.delivered++; push(`Delivered ${E.resolveRec(parcels, g, b)?.address}.`); }
  prevDev.clear(); for (const b of nowDev) prevDev.add(b);

  // leasing
  for (const loi of [...(g.lois ?? [])]) {
    const rec = E.resolveRec(parcels, g, loi.bbl); const h = g.holdings[loi.bbl]; if (!rec || !h) continue;
    const market = E.managedRentPsfYr(rec, e, h, loi.use ?? rec.class);
    if (loi.rentPsf >= market * 0.92) { const r = noteErr("acceptLOI", E.respondLOI(g, parcels, loi.id, "accept", true)); if (!r.err) { g = r.s; st.leases++; } }
    else if (!loi.countered && loi.stage !== "countered") { const r = noteErr("counterLOI", E.respondLOI(g, parcels, loi.id, "counter", true, { rentPsf: +(market * 0.97).toFixed(2), tiPsf: Math.round((loi.tiPsf ?? 0) * 0.8) })); if (!r.err) g = r.s; }
    else if (soft || loi.rentPsf >= market * 0.86) { const r = noteErr("acceptLOI2", E.respondLOI(g, parcels, loi.id, "accept", true)); if (!r.err) { g = r.s; st.leases++; } else { const d = E.respondLOI(g, parcels, loi.id, "decline"); if (!d.err) { g = d.s; st.declined++; } } }
    else { const d = E.respondLOI(g, parcels, loi.id, "decline"); if (!d.err) { g = d.s; st.declined++; } }
  }
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec || rec.class === "land" || g.developments?.[h.bbl]) continue;
    const leased = (h.tenants ?? []).reduce((a, t) => a + t.sf, 0);
    const full = rec.class === "multifamily" ? (h.occ ?? 0) > 0.93 : rec.bldgArea > 0 && leased > rec.bldgArea * 0.9;
    if (!full && !h.broker) { const r = E.setBroker(g, parcels, h.bbl, true); if (!r.err) g = r.s; }
    if (full && h.broker) { const r = E.setBroker(g, parcels, h.bbl, false); if (!r.err) g = r.s; }
  }
  // refi
  for (const h of Object.values(g.holdings)) {
    const l = h.loan; if (!l || g.developments?.[h.bbl] || l.maturityM - g.month > 18) continue;
    const { quotes } = E.refiQuotes(g, parcels, h.bbl); if (!quotes?.length) continue;
    const best = quotes.filter((q) => q.maxProceeds >= l.balance * 0.9).sort((a, b) => a.ratePct - b.ratePct)[0] ?? quotes.slice().sort((a, b) => b.maxProceeds - a.maxProceeds)[0];
    const r = noteErr("refi", E.refinance(g, parcels, h.bbl, best.id, 1)); if (!r.err) { g = r.s; st.refis++; }
  }
  // offers
  for (const h of Object.values(g.holdings)) {
    if (!h.sale?.offer) continue; const rec = E.resolveRec(parcels, g, h.bbl); if (!rec) continue;
    const v = E.holdingValue(rec, e, h, g.month);
    if (h.sale.offer.price >= v * (hot ? 1.03 : 0.97)) { const p = h.sale.offer.price; const r = noteErr("acceptSale", E.acceptSaleOffer(g, parcels, h.bbl)); if (!r.err) { g = r.s; st.sold++; push(`Sold ${rec.address} (${rec.class}) for ${M(p)}, basis ${M(h.costBasis)}.`); } }
    else if (!h.sale.offer.countered) { const r = E.counterSale(g, parcels, h.bbl, Math.round(h.sale.offer.price * 1.05)); if (!r.err) g = r.s; }
  }
  if (m % 6 === 0) for (const h of Object.values(g.holdings)) {
    if (h.sale || g.developments?.[h.bbl]) continue; const rec = E.resolveRec(parcels, g, h.bbl); if (!rec || rec.class === "land") continue;
    const v = E.holdingValue(rec, e, h, g.month); const held = g.month - h.boughtM;
    if ((v > h.costBasis * 1.8 && held > 72 && hot) || (held > 120 && v < h.costBasis * 0.85 && soft)) { const r = E.listForSale(g, parcels, h.bbl, Math.round(v * 1.03)); if (!r.err) { g = r.s; break; } }
  }
  // acquire
  let committed = 0; for (const d of Object.values(g.developments ?? {})) committed += Math.max(0, (d.equityBudget ?? 0) - (d.equitySpent ?? 0));
  const nHold = Object.keys(g.holdings).length; const reserve = 1.2e6 + nHold * 2.5e5 + committed; const cash = g.cash;
  const coupon = (e.indexRate + (soft ? 0.9 : 1.5)) / 100;
  if (!Object.keys(g.talks ?? {}).length && cash > reserve) {
    let best = null;
    for (const l of g.listings ?? []) {
      if (g.holdings[l.bbl]) continue; const rec = E.resolveRec(parcels, g, l.bbl); if (!rec) continue;
      if (rec.class === "land") {
        if (rec.lotArea < 2500 || rec.demandScore < 40) continue;
        let bp = null;
        for (const use of CL) { if (loose(use) && !l.distress) continue;
          const fl = Math.min(E.maxFloorsFor(rec, 0.62, use), use === "industrial" ? 2 : 12);
          const plan = E.planDevelopment(g, parcels, l.bbl, use, fl, 0.62, "gmp"); if (plan && (!bp || plan.hurdleRatio > bp.hurdleRatio)) bp = plan; }
        if (!bp || bp.hurdleRatio < 1.0) continue;
        const score = 0.05 + (bp.hurdleRatio - 1) * 0.2 + (l.distress ? 0.03 : 0);
        if (!best || score > best.score) best = { l, rec, score, land: true };
        continue;
      }
      const noi = E.noiAfterTaxYr(rec, e, E.initialCondition(rec), l.ask); const y = l.ask > 0 ? noi / l.ask : 0;
      if (!((y > coupon && !loose(rec.class)) || (l.distress && y > coupon * 0.85))) continue;
      const score = y + (l.distress ? 0.03 : 0) + rec.demandScore / 5000;
      if (!best || score > best.score) best = { l, rec, score, land: false };
    }
    if (best) { const bid = Math.round(best.l.ask * (best.l.distress ? 0.88 : 0.94));
      const q = E.buyQuote(g, parcels, best.l.bbl, bid, best.land ? "land" : "savings", best.land ? 0.55 : 0.70);
      if (q.equity < cash - reserve * 0.5) { const r = noteErr("negotiate", E.negotiate(g, parcels, best.l.bbl, bid)); if (!r.err) g = r.s; } }
  }
  for (const t of Object.values(g.talks ?? {})) {
    const rec = E.resolveRec(parcels, g, t.bbl); const isLand = rec?.class === "land";
    if (t.agreed) { let r = E.closeDeal(g, parcels, t.bbl, isLand ? "land" : "savings", isLand ? 0.55 : 0.70);
      if (r.err) { noteErr("closeDeal", r); r = noteErr("closeCash", E.closeDeal(g, parcels, t.bbl, "cash", 1)); }
      if (!r.err) { g = r.s; st.bought++; if (isLand) st.boughtLand++; push(`Bought ${rec?.address} (${rec?.class}, ${Math.round(rec?.bldgArea ?? rec?.lotArea).toLocaleString()} sf) at ${M(t.agreedPrice ?? 0)}.`); }
      continue; }
    const ok = rec && (isLand ? t.theirPrice < E.landValue(rec, e) * 1.12 : E.noiAfterTaxYr(rec, e, E.initialCondition(rec), t.theirPrice) / Math.max(1, t.theirPrice) > (e.indexRate + 1.0) / 100);
    if (ok) { const r = E.acceptCounter(g, parcels, t.bbl); if (!r.err) g = r.s; }
    else if (t.final) g = E.walkAway(g, parcels, t.bbl).s;
    else { const r = E.negotiate(g, parcels, t.bbl, Math.round((t.yourPrice + t.theirPrice) / 2)); if (!r.err) g = r.s; }
  }
  // build
  const liveJobs = Object.keys(g.developments ?? {}).length;
  if (liveJobs < 3 && g.cash > reserve * 1.3) {
    let bj = null;
    for (const h of Object.values(g.holdings)) {
      const rec = E.resolveRec(parcels, g, h.bbl) ?? parcels[h.bbl]; if (!rec || rec.class !== "land" || g.developments?.[h.bbl]) continue;
      for (const use of CL) { if (loose(use)) continue;
        const fl = Math.min(E.maxFloorsFor(rec, 0.62, use), use === "industrial" ? 2 : 12);
        const plan = E.planDevelopment(g, parcels, h.bbl, use, fl, 0.62, "gmp");
        if (!plan || plan.hurdleRatio < 1.0 || plan.equityAtClose > g.cash - reserve) continue;
        const score = plan.hurdleRatio + (tight(use) ? 0.2 : 0);
        if (!bj || score > bj.score) bj = { h, rec, use, fl, plan, score }; }
    }
    if (bj) { const r = noteErr("startDev", E.startDevelopment(g, parcels, bj.h.bbl, bj.use, bj.fl, 0.62, "gmp"));
      if (!r.err) { g = r.s; st.built++; push(`Broke ground: ${bj.use} at ${bj.rec.address}, ${bj.plan.sf.toLocaleString()} sf, ${bj.fl} fl, YoC ${bj.plan.yieldOnCost.toFixed(2)}%, hurdle ${bj.plan.hurdleRatio.toFixed(2)}, cost ${M(bj.plan.totalCost ?? 0)}.`); } }
  }
  const nw = E.netWorth(g, parcels); peak = Math.max(peak, nw); dd = Math.max(dd, 1 - nw / peak);
  if (g.cash < 300_000) st.lowCash++;
  if (m % 12 === 11 || g.gameOver) {
    const rows = board(g); const rank = rows.findIndex((r) => r.name === "You") + 1;
    if (rank === 1 && everFirst === null) { everFirst = g.month; push(`#1 on the street at ${M(nw)}.`); }
    const p = portfolio(g);
    const mk = {}; for (const c of CL) mk[c] = { ask: e.rentIdx[c], eff: e.effRentIdx?.[c], vac: e.cityVac?.[c], cap: e.capRate?.[c], stock: e.stock?.[c], pipeline: e.pipeline?.[c] };
    years.push({ y: 2000 + Math.floor(g.month / 12), m: g.month, nw, cash: g.cash, loc: g.loc?.balance ?? 0, phase: e.phase, index: e.indexRate, cpi: e.cpi,
      landIdx: e.landIdx, pop: e.population, jobs: e.jobs, unemp: e.unemployment, rank, field: rows.length, top3: rows.slice(0, 3).map((r) => [r.name, r.style, Math.round(r.eq), r.bldgs]),
      you: rows.find((r) => r.name === "You"), mk, p, holdings: Object.keys(g.holdings).length, jobsLive: Object.keys(g.developments ?? {}).length, st: { ...st },
      rivalsAlive: rows.length - 1, rivalsDead: (g.rivals ?? []).filter((r) => r.failedM !== undefined).length });
  }
  if (g.gameOver) { push(`GAME OVER: ${g.gameOver.cause}`); break; }
}
const fin = board(g);
writeFileSync(OUT, JSON.stringify({ SEED, citySeed, parcels: bbls.length, years, story, errs, st, peak, dd, everFirst, final: fin.slice(0, 12), gameOver: g.gameOver ?? null,
  holdings: Object.values(g.holdings).map((h) => { const r = E.resolveRec(parcels, g, h.bbl); return { addr: r?.address, cls: r?.class, sf: r?.bldgArea, basis: h.costBasis, v: r ? E.holdingValue(r, g.econ, h, g.month) : 0, debt: h.loan?.balance ?? 0, occ: h.occ }; }) }, null, 1));
console.log(SEED, "NW", M(E.netWorth(g, parcels)), "rank", fin.findIndex((r) => r.name === "You") + 1, "/", fin.length, "leader", fin[0].name, M(fin[0].eq), g.gameOver ? "DEAD" : "");
