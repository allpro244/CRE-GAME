// A DEEP PLAYTHROUGH ON THE ENGINE — play like a principal for thirty years,
// touch every desk, and write down everything that looks wrong.
//
//   pnpm engine && pnpm deepplay
//   SEEDS=7919,550991 YRS=30 pnpm deepplay
//
// A REPORT, NOT A GATE. Every other harness asks whether one channel is right;
// this one plays the game — buys off the tape through the negotiation desk,
// answers every letter, refinances, appeals, renovates, builds, sells, draws
// the line, hires, opens a facility, buys a note, approaches a neighbour,
// offers a ground lease, files a variance, tries a conversion — and scans the
// state every month for numbers that cannot be. It prints:
//   BUG        a number that cannot be, or an invariant the engine asserts
//   REALISM    a quantity outside the range the business runs in
//   EVENT      things that happened (game over, a balloon nobody quotes)
//   LIMIT      an action the engine refused — in its own words, counted
// plus a metrics table per seed (opex ratio, tax on value, yields, coupon
// spreads, live LTV, lease terms, TI, free rent, development yields, the
// rent index path, every holding's yearly trace) so a realism call can be
// argued with. The bot is deliberately reckless (max proceeds, a thin
// reserve); its net worth is not a finding. PLAYTHROUGH_2026-09.md is the
// first report it produced. ~4 minutes a seed.
import { dirname, join as pjoin } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = pjoin(dirname(fileURLToPath(import.meta.url)), "..", "test");
const E = await import(pjoin(HERE, ".engine.mjs"));
const { loadCity } = await import(pjoin(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const SEEDS = (process.env.SEEDS ?? "7919,550991,12007").split(",").map(Number);
const YRS = Number(process.env.YRS ?? 30);
const CL = ["office", "retail", "multifamily", "industrial"];
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "-");
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "-");
const K = (n) => (Number.isFinite(n) ? (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : (n / 1e3).toFixed(0) + "K") : "-");

// ------------------------------------------------------------- the notebook
const findings = new Map(); // key -> { kind, text, n, first, examples[] }
function note(kind, key, text, example) {
  const k = kind + "|" + key;
  const f = findings.get(k) ?? { kind, key, text, n: 0, examples: [] };
  f.n++;
  if (example !== undefined && f.examples.length < 3) f.examples.push(example);
  findings.set(k, f);
}
const errs = new Map(); // refusal text -> count
function refused(action, err) {
  const k = action + " :: " + err.replace(/\$[\d,.]+[KM]?/g, "$X").replace(/\d+/g, "N").slice(0, 140);
  errs.set(k, (errs.get(k) ?? 0) + 1);
}
const fin = (x) => typeof x === "number" && Number.isFinite(x);

// deep NaN walk, bounded
function nanWalk(obj, path, out, depth = 0) {
  if (depth > 7 || out.length > 20) return;
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "number" && !Number.isFinite(obj)) out.push(path);
    return;
  }
  if (Array.isArray(obj)) { for (let i = 0; i < Math.min(obj.length, 400); i++) nanWalk(obj[i], path + "[" + i + "]", out, depth + 1); return; }
  for (const k of Object.keys(obj)) nanWalk(obj[k], path + "." + k, out, depth + 1);
}

// ------------------------------------------------------------- metrics
const M = {}; // per seed metrics
function met(seed, k, v) { (M[seed] ??= {}); (M[seed][k] ??= []).push(v); }

// ------------------------------------------------------------- one campaign
for (const SEED of SEEDS) {
  let g = E.firstListings(E.newGame(SEED, parcels, 2_500_000), parcels, bbls);
  const open = g.cash;
  const T = { bought: 0, sold: 0, refi: 0, dev: 0, loi: 0, loiAcc: 0, loiCounter: 0, appeals: 0, renos: 0, hires: 0, notes: 0, fac: 0, offmkt: 0, gl: 0, reuse: 0, var: 0, prog: 0, gameOver: 0 };
  const buyLog = []; // {m, price, appr, noi, ltv, rate, allIn, bind, product}
  const saleLog = []; // {listedM, soldM, ask, price, appr}
  const loiLog = []; // {m, kind, rent, mk, ti, free, term, bump, rec, acc}
  const devLog = []; // {m, use, sf, yoc, req, cost, equity, deliverM, leasedM}
  const refiLog = [];
  const appealLog = [];
  const renoLog = [];
  const prevVal = {}; const prevNoi = {}; const leases = []; const trace = {};
  let lastDeepWalk = -99;
  let hired = false; let facOpened = false; let glOffered = false; let reuseTried = false; let varTried = false;
  const startYear = E.START_YEAR ?? 2000;
  console.log(`\n=== seed ${SEED} · phase ${g.econ.phase} · index ${f2(g.econ.indexRate)}% · cash ${K(g.cash)} ===`);

  for (let m = 0; m < YRS * 12; m++) {
    const prev = g;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) {
      T.gameOver++;
      note("EVENT", "gameover", "game over reached", { m: g.month, why: String(g.gameOver?.cause ?? g.gameOver).slice(0, 120), cash: Math.round(g.cash), nw: Math.round(E.netWorth(g, parcels)) });
      g = { ...g, gameOver: null, cash: Math.max(g.cash, 0) + 3e6 };
    }
    const e = g.econ;
    const month = g.month;
    const nw = E.netWorth(g, parcels);

    // ---------------------------------------------------------- invariants
    if (m % 3 === 0) {
      let v = [];
      try { v = E.checkInvariants(g, parcels, prev); } catch (x) { note("BUG", "invariants-threw", "checkInvariants threw", String(x).slice(0, 160)); }
      for (const x of v) note("BUG", "inv:" + x.code + ":" + x.where.replace(/\d+/g, "N").slice(0, 40), `invariant ${x.code} @ ${x.where}`, { m: month, detail: x.detail.slice(0, 160) });
    }
    if (month - lastDeepWalk >= 12) {
      lastDeepWalk = month;
      const out = []; nanWalk(g, "g", out);
      for (const p of out) note("BUG", "nan:" + p.replace(/\d+/g, "N"), `non-finite number at ${p.replace(/\d+/g, "N")}`, { m: month, path: p });
    }

    // ---------------------------------------------------------- scanners
    if (!fin(g.cash)) note("BUG", "cash-nan", "cash is not finite", month);
    if (g.cash < -1000) {
      const room = (E.locLimit(g, parcels) - (g.loc?.balance ?? 0));
      if (room > 50_000) note("BUG", "cash-neg-with-line", "cash negative while the line has room", { m: month, cash: Math.round(g.cash), room: Math.round(room) });
      else note("EVENT", "cash-neg", "cash negative (line exhausted)", { m: month, cash: Math.round(g.cash) });
    }
    for (const c of CL) {
      if (!(e.capRate[c] > 2 && e.capRate[c] < 16)) note("REALISM", "cap-range:" + c, `${c} cap rate outside 2-16%`, { m: month, cap: e.capRate[c] });
      const v = e.cityVac?.[c]; if (!(v >= 0 && v <= 0.6)) note("REALISM", "vac-range:" + c, `${c} city vacancy outside 0-60%`, { m: month, vac: v });
      if (!(e.rentIdx[c] > 0)) note("BUG", "rentidx:" + c, `${c} rent index not positive`, { m: month, r: e.rentIdx[c] });
    }
    if (!(e.indexRate >= 0 && e.indexRate < 30)) note("REALISM", "index-range", "policy index outside 0-30%", { m: month, r: e.indexRate });
    // listings
    const seenL = new Set();
    for (const l of g.listings) {
      if (seenL.has(l.bbl)) note("BUG", "listing-dup", "same deed listed twice", { m: month, bbl: l.bbl });
      seenL.add(l.bbl);
      if (g.holdings[l.bbl] && !g.holdings[l.bbl].sale) note("BUG", "listing-owned", "a deed you own is on the tape without your listing", { m: month, bbl: l.bbl });
      if (!(l.ask > 0)) note("BUG", "listing-ask", "listing with no ask", { m: month, bbl: l.bbl, ask: l.ask });
    }
    // holdings
    for (const h of Object.values(g.holdings)) {
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec) { note("BUG", "holding-norec", "holding without a record", h.bbl); continue; }
      if (h.condIdx !== undefined && !(h.condIdx >= 0 && h.condIdx <= 1)) note("BUG", "condidx", "condIdx outside 0..1", { m: month, bbl: h.bbl, c: h.condIdx });
      const built = rec.class !== "land" && rec.bldgArea > 0 && !h.groundLeased;
      if (built) {
        const rsf = E.rentableSf(rec);
        const tsf = h.tenants.reduce((a, t) => a + t.sf, 0);
        if (tsf > rsf * 1.001 + 50) note("BUG", "tenants-over-rentable", "tenants let more feet than the building has", { m: month, bbl: h.bbl, tsf, rsf, gross: rec.bldgArea });
        for (const t of h.tenants) {
          if (!(t.rentPsf > 0)) note("BUG", "tenant-rent", "tenant with non-positive rent", { m: month, bbl: h.bbl, t: t.name, r: t.rentPsf });
          if (!(t.sf > 0)) note("BUG", "tenant-sf", "tenant with non-positive sf", { m: month, bbl: h.bbl, t: t.name, sf: t.sf });
          if (t.endM < t.startM) note("BUG", "tenant-term", "lease ends before it starts", { m: month, bbl: h.bbl, t: t.name });
          if (t.endM < month - 1 && !t.defaulted) note("BUG", "tenant-expired-still-there", "an expired lease still on the roll", { m: month, bbl: h.bbl, t: t.name, endM: t.endM });
        }
        const occ = E.physicalOcc(rec, h);
        if (!(occ >= 0 && occ <= 1.0001)) note("BUG", "occ-range", "occupancy outside 0..1", { m: month, bbl: h.bbl, occ });
        let val = 0, noi = 0;
        try { val = E.ownedHoldingValue(g, parcels, h); noi = (E.ownedContractNoiYr ?? E.ownedHoldingNoiYr)(g, parcels, h); } catch (x) { note("BUG", "value-threw", "value reader threw", String(x).slice(0, 120)); }
        if (!(val > 0)) note("BUG", "value-nonpos", "owned built building valued at zero or less", { m: month, bbl: h.bbl, val });
        const pv = prevVal[h.bbl];
        if (pv && val > 0 && (val / pv > 1.35 || val / pv < 0.65) && !g.developments[h.bbl] && (h.renovatingUntilM === undefined || month > h.renovatingUntilM + 1))
          note("REALISM", "value-jump", "appraisal moved >35% in one month", { m: month, bbl: h.bbl, from: Math.round(pv), to: Math.round(val), occ: +occ.toFixed(2) });
        prevVal[h.bbl] = val;
        const pn = prevNoi[h.bbl];
        if (pn !== undefined && Math.abs(noi - pn) > Math.max(20_000, Math.abs(pn) * 0.5) && occ > 0.5)
          note("REALISM", "noi-jump", "NOI moved >50% in one month with the building over half let", { m: month, bbl: h.bbl, from: Math.round(pn), to: Math.round(noi), occ: +occ.toFixed(2) });
        prevNoi[h.bbl] = noi;
        // ratios
        if (m % 12 === 0 && val > 0) {
          const os = E.operatingStatement(rec, e, h, month);
          if (os) {
            const opexRatio = os.egi > 0 ? (os.opex ?? 0) / os.egi : NaN;
            met(SEED, "opexRatio", opexRatio);
            met(SEED, "taxToValue", E.propertyTaxYr(rec, h, e) / val);
            met(SEED, "yieldOnValue", noi / val);
            met(SEED, "yieldOnBasis", noi / Math.max(1, h.costBasis));
          }
        }
        if (h.loan) {
          const L = h.loan;
          if (!(L.balance >= -1)) note("BUG", "loan-neg", "loan balance negative", { m: month, bbl: h.bbl, bal: L.balance });
          if (L.balance > L.principal * 1.02 + 1) note("BUG", "loan-over-principal", "loan balance above principal", { m: month, bbl: h.bbl, bal: L.balance, p: L.principal });
          if (!(L.ratePct > 0 && L.ratePct < 30)) note("REALISM", "coupon-range", "coupon outside 0-30%", { m: month, bbl: h.bbl, r: L.ratePct });
          if (L.maturityM < month - 1) note("BUG", "loan-past-maturity", "a loan past its maturity still on the book", { m: month, bbl: h.bbl, mat: L.maturityM, sweep: L.sweep, wk: !!g.workouts?.[h.bbl] });
          if (m % 12 === 0) { met(SEED, "couponSpread", L.ratePct - e.indexRate); met(SEED, "ltvLive", L.balance / Math.max(1, val)); }
        }
      }
    }
    for (const loi of g.lois) {
      if (!g.holdings[loi.bbl]) note("BUG", "loi-unowned", "an LOI on a building you do not own", { m: month, bbl: loi.bbl });
      if (!(loi.rentPsf > 0)) note("BUG", "loi-rent", "LOI with non-positive rent", { m: month, id: loi.id, r: loi.rentPsf });
      if (!(loi.sf > 0)) note("BUG", "loi-sf", "LOI with non-positive sf", { m: month, id: loi.id });
      if (loi.termM <= 0) note("BUG", "loi-term", "LOI with non-positive term", { m: month, id: loi.id, t: loi.termM });
    }

    // ---------------------------------------------------------- play: letters
    for (const loi of [...g.lois]) {
      const rec = E.resolveRec(parcels, g, loi.bbl); const h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      let mk = 0;
      try { mk = E.managedRentPsfYr(rec, e, h, loi.use); } catch { mk = E.marketRentPsfYr(rec, e, h.condition); }
      const rel = mk > 0 ? loi.rentPsf / mk : NaN;
      T.loi++;
      let action = "pass";
      if (loi.stage === "countered" || loi.countered) action = loi.rentPsf >= mk * 0.85 ? "accept" : "pass";
      else if (loi.rentPsf >= mk * 0.92) action = "accept";
      else if (loi.rentPsf >= mk * 0.70) action = "counter";
      const counter = action === "counter" ? { rentPsf: Math.round(mk * 100) / 100, tiPsf: Math.max(0, loi.tiPsf - 5) } : undefined;
      const r = E.respondLOI(g, parcels, loi.id, action, false, counter);
      if (r.err) refused("respondLOI:" + action, r.err); else { g = r.s; if (action === "accept") T.loiAcc++; if (action === "counter") T.loiCounter++; }
      loiLog.push({ m: month, kind: loi.kind, use: loi.use, rel, ti: loi.tiPsf, free: loi.freeM, term: loi.termM, bump: loi.bumpPct, rec: loi.recovery, sf: loi.sf, action });
      if (loi.termM > 12 * 25) note("REALISM", "loi-term-long", "an LOI asking for a term over 25 years", { m: month, term: loi.termM, use: loi.use });
      if (loi.tiPsf > 250) note("REALISM", "loi-ti-huge", "TI ask over $250/sf", { m: month, ti: loi.tiPsf, use: loi.use });
      if (loi.freeM > 24) note("REALISM", "loi-free-huge", "free rent over 24 months", { m: month, free: loi.freeM, use: loi.use });
    }
    for (const a of g.asks ?? []) {
      const r = E.answerAsk(g, parcels, a.id, "grant");
      if (r?.err) refused("answerAsk", r.err); else if (r?.s) g = r.s;
    }

    // ---------------------------------------------------------- play: the tape
    const reserve = Math.max(250_000, open * 0.12);
    const talksN = Object.keys(g.talks ?? {}).length;
    const heldN = Object.keys(g.holdings).length;
    const landHeld = Object.values(g.holdings).filter((h) => parcels[h.bbl]?.class === "land").length;
    if (talksN < 2 && g.cash > reserve * 2 && heldN < 14 && m % 2 === 0) {
      let best = null;
      for (const l of g.listings) {
        if (g.holdings[l.bbl] || !(l.ask > 0)) continue;
        const rec = E.resolveRec(parcels, g, l.bbl);
        if (!rec) continue;
        if (rec.class === "land") {
          if (rec.demandScore > 45 && l.ask < g.cash * 0.6 && (!best || best.land && l.ask < best.l.ask) && heldN >= 2 && landHeld < 2) best = { l, rec, land: true, y: 0 };
          continue;
        }
        const ip = E.inPlace(rec, g, l.bbl, l.ask);
        const y = ip?.noi > 0 ? ip.noi / l.ask : -1;
        const appr = E.marketAppraisal(g, rec, l.bbl, E.initialCondition(rec));
        if (y > (e.indexRate + 0.8) / 100 && l.ask < g.cash * 2.6 && l.ask > 300_000 && (!best || (!best.land && y > best.y))) best = { l, rec, land: false, y, appr, noi: ip.noi, occ: ip.occ };
      }
      if (best) {
        const bidPx = Math.round(best.l.ask * (best.l.distress ? 1.0 : 0.94));
        const r = E.negotiate(g, parcels, best.l.bbl, bidPx);
        if (r.err) refused("negotiate", r.err); else g = r.s;
      }
    }
    for (const t of Object.values(g.talks ?? {})) {
      const rec = E.resolveRec(parcels, g, t.bbl);
      if (!rec) continue;
      if (t.agreed) {
        const px = t.agreedPrice ?? t.theirPrice;
        // choose the cheapest permanent desk that lends, like the card does
        const choices = rec.class === "land" ? ["land"] : ["harbor", "savings", "pelican", "conduit", "cordage"];
        let pick = null;
        for (const p of choices) {
          const qq = E.buyQuote(g, parcels, t.bbl, px, p, 1);
          if (qq.principal > 0 && (!pick || qq.allInPct < pick.q.allInPct)) pick = { p, q: qq };
        }
        let r = pick ? E.closeDeal(g, parcels, t.bbl, pick.p, 1) : { err: "no lender" };
        if (r.err) { refused("closeDeal:" + (pick?.p ?? "none"), r.err); r = E.closeDeal(g, parcels, t.bbl, "cash", 1); }
        if (r.err) { refused("closeDeal:cash", r.err); const w = E.walkAway(g, parcels, t.bbl); g = w.s; }
        else {
          g = r.s; T.bought++;
          const appr = E.marketAppraisal(g, rec, t.bbl, E.initialCondition(rec));
          buyLog.push({ m: month, cls: rec.class, price: px, ask: t.theirPrice, appr, product: pick?.p ?? "cash", ltv: pick ? pick.q.principal / px : 0, rate: pick?.q.ratePct, allIn: pick?.q.allInPct, bind: pick?.q.bind, statedLtv: pick?.q.statedLtv, rounds: t.round });
          if (pick && pick.q.principal / px > 0.9) note("REALISM", "ltv-over-90", "a desk advanced over 90% of price", { m: month, p: pick.p, ltv: pick.q.principal / px });
        }
      } else if (t.final) {
        const gap = t.theirPrice / Math.max(1, t.yourPrice) - 1;
        if (gap < 0.06) { const r = E.acceptCounter(g, parcels, t.bbl); if (r.err) refused("acceptCounter", r.err); else g = r.s; }
        else { g = E.walkAway(g, parcels, t.bbl).s; }
      } else {
        if (t.round >= 2) { const r = E.acceptCounter(g, parcels, t.bbl); if (r.err) refused("acceptCounter", r.err); else g = r.s; }
        else { const r = E.negotiate(g, parcels, t.bbl, Math.round((t.yourPrice + t.theirPrice) / 2)); if (r.err) refused("negotiate:again", r.err); else g = r.s; }
      }
    }

    // ---------------------------------------------------------- play: the book
    if (m % 3 === 0) {
      for (const h of Object.values(g.holdings)) {
        const rec = E.resolveRec(parcels, g, h.bbl);
        if (!rec) continue;
        const built = rec.class !== "land" && rec.bldgArea > 0 && !h.groundLeased;
        // ops policy once
        if (built && h.service === undefined) { try { g = E.setOps(g, h.bbl, { service: 0, plan: 1 }); } catch (x) { refused("setOps", String(x)); } }
        // broker on for vacancy
        if (built && E.physicalOcc(rec, h) < 0.85 && !h.broker) { try { const r = E.setBroker(g, parcels, h.bbl, true); if (r?.s) g = r.s; else if (r?.err) refused("setBroker", r.err); } catch (x) { refused("setBroker", String(x).slice(0, 80)); } }
        // tax appeal
        if (built) {
          const tq = E.taxAppealQuote(g, parcels, h.bbl);
          if (tq && tq.annualSavings * 4 * tq.odds > tq.fee && g.cash > tq.fee * 4) {
            const r = E.fileTaxAppeal(g, parcels, h.bbl);
            if (r.err) refused("fileTaxAppeal", r.err); else { g = r.s; T.appeals++; appealLog.push({ m: month, ...tq }); }
          }
        }
        // renovation
        if (built && (h.condition === "worn" || h.condition === "obsolete") && h.renovatingUntilM === undefined && !g.developments[h.bbl]) {
          const cost = E.renovationCost(rec, e);
          const val = E.ownedHoldingValue(g, parcels, h);
          if (cost < g.cash * 0.5 && cost < val * 0.35) {
            const r = E.startRenovation(g, parcels, h.bbl);
            if (r.err) refused("startRenovation", r.err); else { g = r.s; T.renos++; renoLog.push({ m: month, bbl: h.bbl, cost, val, cond: h.condition }); }
          }
        }
        // capital program on a good building once
        if (built && h.condition === "good" && !h.program && !(h.programsDone?.lobby) && m > 36 && g.cash > 1e6 && T.prog < 2) {
          const r = E.startProgram(g, parcels, h.bbl, "lobby");
          if (r.err) refused("startProgram", r.err); else { g = r.s; T.prog++; }
        }
        // refinance
        if (built && m % 12 === 6) {
          const { quotes, value, payoff } = E.refiQuotes(g, parcels, h.bbl);
          const live = quotes.filter((x) => x.available && x.maxProceeds > 0);
          const cur = h.loan;
          const matSoon = cur && cur.maturityM - month <= 18;
          const bestNet = live.map((x) => ({ x, net: x.maxProceeds - payoff - Math.round(x.maxProceeds * x.points) })).sort((a, b) => b.net - a.net)[0];
          if (m % 12 === 6) met(SEED, "refiDesksQuoting", live.length);
          if (bestNet && (matSoon || (bestNet.net > 250_000 && (!cur || bestNet.x.ratePct < cur.ratePct - 0.75)))) {
            const r = E.refinance(g, parcels, h.bbl, bestNet.x.id, 1);
            if (r.err) refused("refinance", r.err); else { g = r.s; T.refi++; refiLog.push({ m: month, desk: bestNet.x.id, proceeds: bestNet.x.maxProceeds, ltv: bestNet.x.ltvAtMax, dscr: bestNet.x.dscrAtMax, rate: bestNet.x.ratePct, allIn: bestNet.x.allInPct, net: bestNet.net, value, payoff, matSoon: !!matSoon, prevRate: cur?.ratePct }); }
          } else if (matSoon && !bestNet) {
            note("EVENT", "balloon-no-refi", "a balloon inside 18 months and no desk quoting", { m: month, bbl: h.bbl, bal: cur.balance, quotes: quotes.map((x) => (x.why ?? x.binding ?? "").slice(0, 60)).slice(0, 3) });
          }
        }
        // develop land
        if (rec.class === "land" && !g.developments[h.bbl] && !h.sale && !h.groundOffer && !g.groundLeases?.[h.bbl] && m % 3 === 0) {
          let bestPlan = null;
          for (const use of ["office", "multifamily", "mixed", "retail", "industrial"]) {
            const maxFl = E.maxFloorsFor(rec, 0.6, use);
            for (const fl of [Math.max(1, Math.round(maxFl * 0.5)), maxFl]) {
              const p = E.planDevelopment(g, parcels, h.bbl, use, fl, 0.6, "gmp");
              if (!p) continue;
              if (m % 12 === 0) met(SEED, "devYoc-" + use, p.yieldOnCost);
              if (p.hurdleRatio >= 1 && (!bestPlan || p.hurdleRatio > bestPlan.p.hurdleRatio)) bestPlan = { p, use, fl };
            }
          }
          if (bestPlan) {
            const sp = E.spendable(g, parcels).total;
            const need = bestPlan.p.equityAtClose + bestPlan.p.pointsCost;
            if (need <= sp * 0.8) {
              const r = E.startDevelopment(g, parcels, h.bbl, bestPlan.use, bestPlan.fl, 0.6, "gmp");
              if (r.err) refused("startDevelopment", r.err);
              else { g = r.s; T.dev++; devLog.push({ m: month, bbl: h.bbl, use: bestPlan.use, fl: bestPlan.fl, sf: bestPlan.p.sf, yoc: bestPlan.p.yieldOnCost, req: bestPlan.p.requiredYield, cost: bestPlan.p.costTotal, costPsf: bestPlan.p.costTotal / Math.max(1, bestPlan.p.sf), equity: bestPlan.p.equity, months: bestPlan.p.months, ltc: bestPlan.p.ltc, rate: bestPlan.p.ratePct }); }
            } else note("EVENT", "dev-pencils-no-equity", "a scheme pencils but the equity is not there", { m: month, need: Math.round(need), have: Math.round(sp) });
          }
        }
        // sell after a long hold at a gain, or in a boom
        if (built && !h.sale && !g.developments[h.bbl] && h.renovatingUntilM === undefined && month - h.boughtM >= 60 && heldN > 3 && m % 12 === 3) {
          const val = E.ownedHoldingValue(g, parcels, h);
          if (val > h.costBasis * 1.15 && (e.phase === "expansion" || e.phase === "peak")) {
            const r = E.listForSale(g, parcels, h.bbl, Math.round(val * 1.02), "marketed");
            if (r.err) refused("listForSale", r.err); else { g = r.s; saleLog.push({ bbl: h.bbl, listedM: month, ask: Math.round(val * 1.02), appr: val, basis: h.costBasis }); }
          }
        }
        // handle a sale in progress
        if (h.sale) {
          const s = h.sale; const sl = saleLog.find((x) => x.bbl === h.bbl && !x.soldM);
          if (s.offer && !s.offer.countered) {
            if (s.offer.price >= s.ask * 0.94) { const r = E.acceptSaleOffer(g, parcels, h.bbl); if (r.err) refused("acceptSaleOffer", r.err); else { g = r.s; T.sold++; if (sl) { sl.soldM = month; sl.price = s.offer.price; } continue; } }
            else { const r = E.counterSale(g, parcels, h.bbl, Math.round(s.ask * 0.98)); if (r?.err) refused("counterSale", r.err); else if (r?.s) g = r.s; }
          } else if (s.bids && s.bids.length) {
            const live = s.bids.map((b, i) => ({ b, i })).filter((x) => !x.b.dropped).sort((a, b2) => b2.b.price - a.b.price);
            if (live.length) {
              if (live[0].b.price >= s.ask * 0.94 || (s.round ?? 0) >= 1) { const r = E.acceptBid(g, parcels, h.bbl, live[0].i); if (r.err) refused("acceptBid", r.err); else { g = r.s; T.sold++; if (sl) { sl.soldM = month; sl.price = live[0].b.price; } continue; } }
              else { const r = E.bestAndFinal(g, parcels, h.bbl); if (r.err) refused("bestAndFinal", r.err); else g = r.s; }
            }
          } else if (month - s.listedM > 15) {
            // stale — pull it
            try { g = E.delist(g, h.bbl); if (sl) sl.pulled = month; } catch (x) { refused("delist", String(x).slice(0, 80)); }
          }
        }
      }
    }

    // ---------------------------------------------------------- play: the line
    {
      const lim = E.locLimit(g, parcels); const bal = g.loc?.balance ?? 0;
      if (g.cash < 80_000 && lim - bal > 100_000) { const r = E.drawLoc(g, parcels, Math.min(lim - bal, 400_000)); if (r.err) refused("drawLoc", r.err); else g = r.s; }
      else if (bal > 0 && g.cash > reserve * 3) { const r = E.repayLoc(g, Math.min(bal, g.cash - reserve * 2)); if (r.err) refused("repayLoc", r.err); else g = r.s; }
    }

    // ---------------------------------------------------------- play: staff
    if (!hired && m === 30) {
      const gg = JSON.parse(JSON.stringify(g));
      E.refreshPool(gg, true);
      g = gg;
      const pool = g.hirePool?.list ?? [];
      const want = ["leasing", "pm"];
      for (const role of want) {
        const c = pool.filter((x) => x.role === role).sort((a, b) => a.askSalary - b.askSalary)[0];
        if (!c) { note("LIMIT", "no-candidate:" + role, "no candidate of role " + role + " in the pool", pool.map((x) => x.role)); continue; }
        const r = E.hire(g, parcels, c.id);
        if (r.err) refused("hire:" + role, r.err); else { g = r.s; T.hires++; met(SEED, "salary-" + role, c.askSalary); }
      }
      hired = true;
    }

    // ---------------------------------------------------------- play: exotic desks, once each
    if (!facOpened && m > 48 && m % 12 === 0) {
      const pool = Object.values(g.holdings).filter((h) => { const rec = E.resolveRec(parcels, g, h.bbl); return rec && rec.class !== "land" && rec.bldgArea > 0 && !h.groundLeased && !g.developments[h.bbl]; }).map((h) => h.bbl);
      if (pool.length >= 3) {
        const fq = E.facilityQuotes(g, parcels, pool.slice(0, 5));
        const ok = fq.find((x) => x.available);
        if (ok) { const r = E.openFacility(g, parcels, pool.slice(0, 5), ok.productId, 0.8); if (r.err) refused("openFacility", r.err); else { g = r.s; T.fac++; facOpened = true; met(SEED, "facRate", ok.ratePct); } }
        else note("LIMIT", "facility-refused", "no facility desk would quote a pool of " + pool.length, fq.map((x) => (x.why ?? "").slice(0, 80)).slice(0, 3));
      }
    }
    if (m % 12 === 7 && (g.noteOffers?.length ?? 0) > 0 && g.cash > 1.5e6 && T.notes < 2) {
      const o = g.noteOffers[0];
      const r = E.buyNote(g, parcels, o.id);
      if (r.err) refused("buyNote", r.err); else { g = r.s; T.notes++; met(SEED, "notePricePct", (o.ask ?? o.price ?? 0) / Math.max(1, o.face ?? 1)); }
    }
    if (m % 24 === 11 && g.cash > 1e6 && T.offmkt < 3) {
      // approach the owner of a neighbouring built parcel
      const mine = Object.keys(g.holdings);
      const cand = mine.flatMap((b) => adjacency?.[b] ?? []).filter((b) => !g.holdings[b] && parcels[b] && parcels[b].class !== "land" && parcels[b].bldgArea > 0 && !g.approaches?.[b])[0];
      if (cand) {
        const r = E.approachOwner(g, parcels, adjacency, cand);
        if (r.err) refused("approachOwner", r.err); else { g = r.s; T.offmkt++; met(SEED, "approachRefused", r.refused ? 1 : 0); if (r.ask) { const appr = E.marketAppraisal(g, parcels[cand], cand, E.initialCondition(parcels[cand])); met(SEED, "offmktAskToAppr", r.ask / Math.max(1, appr)); } }
      }
    }
    for (const [b, a] of Object.entries(g.approaches ?? {})) {
      if (a.refused || a.ask === undefined || g.holdings[b]) continue;
      const rec = E.resolveRec(parcels, g, b); if (!rec) continue;
      const appr = E.marketAppraisal(g, rec, b, E.initialCondition(rec));
      if (a.ask <= appr * 1.03 && a.ask < g.cash * 2.5) { const r = E.buyOffMarket(g, parcels, b, "harbor", 1); if (r.err) { refused("buyOffMarket", r.err); } else { g = r.s; T.bought++; } }
      else if (!a.countered) { const r = E.counterOffMarket(g, parcels, adjacency, b, Math.round(appr * 0.97)); if (r.err) refused("counterOffMarket", r.err); else g = r.s; }
    }
    if (!glOffered && m > 60 && m % 12 === 5) {
      const lot = Object.values(g.holdings).find((h) => parcels[h.bbl]?.class === "land" && !g.developments[h.bbl] && !h.sale && !g.groundLeases?.[h.bbl]);
      if (lot) { const r = E.offerGroundLease(g, parcels, lot.bbl, 75, "fixed"); if (r.err) refused("offerGroundLease", r.err); else { g = r.s; T.gl++; glOffered = true; } }
    }
    if (!reuseTried && m > 72 && m % 12 === 9) {
      for (const h of Object.values(g.holdings)) {
        const el = E.adaptiveReuseEligibility(g, parcels, h.bbl);
        if (el.ok) {
          const p = E.planAdaptiveReuse(g, parcels, h.bbl, "multifamily");
          if (p && p.yieldOnCost !== undefined) met(SEED, "reuseYoc", p.yieldOnCost);
          const r = E.startAdaptiveReuse(g, parcels, h.bbl, "multifamily");
          if (r.err) refused("startAdaptiveReuse", r.err); else { g = r.s; T.reuse++; }
          reuseTried = true; break;
        } else refused("adaptiveReuse:eligibility", el.why ?? "?");
      }
    }
    if (!varTried && m > 40 && m % 12 === 2) {
      const lot = Object.values(g.holdings).find((h) => parcels[h.bbl]?.class === "land" && !g.developments[h.bbl]);
      if (lot) { const r = E.fileVariance(g, parcels, lot.bbl); if (r.err) refused("fileVariance", r.err); else { g = r.s; T.var++; } varTried = true; }
    }

    // ---------------------------------------------------------- yearly metrics
    if (m % 12 === 11) {
      met(SEED, "nw", nw); met(SEED, "cash", g.cash);
      for (const c of CL) { met(SEED, "cap-" + c, e.capRate[c]); met(SEED, "vac-" + c, (e.cityVac?.[c] ?? NaN) * 100); }
      met(SEED, "index", e.indexRate); met(SEED, "cpi", e.cpi ?? 1);
      for (const c of CL) met(SEED, "ridx-" + c, e.rentIdx[c]);
      met(SEED, "afford-mf", e.affordEff?.multifamily ?? NaN); met(SEED, "income-mf", e.incomeEff?.multifamily ?? NaN); met(SEED, "eff-mf", e.effRentIdx?.multifamily ?? NaN);
      // rent vs replacement cost on a representative record per class (median demand)
      for (const c of CL) {
        const recs = bbls.map((b) => parcels[b]).filter((r) => r.class === c && r.bldgArea > 0);
        if (!recs.length) continue;
        const r0 = recs[Math.floor(recs.length / 2)];
        const rent = E.marketRentPsfYr(r0, e, "standard");
        const rc = E.replacementCostPsf ? E.replacementCostPsf(r0, e) : E.replacementCost(r0, e) / Math.max(1, r0.bldgArea);
        met(SEED, "rent-" + c, rent); met(SEED, "rcPsf-" + c, rc); met(SEED, "rentToCost-" + c, rent / Math.max(1, rc));
        const capv = E.capRateFor(r0, e, "standard");
        met(SEED, "capSpread-" + c, capv - e.indexRate);
      }
      const deliveries = Object.keys(g.built ?? {}).length;
      met(SEED, "cityDeliveries", deliveries);
      met(SEED, "listingsLive", g.listings.length);
      met(SEED, "docket", E.attentionItems(g, parcels).length);
      met(SEED, "holdings", Object.keys(g.holdings).length);
    }
    // lease signings: new names on the roll this month
    for (const h of Object.values(g.holdings)) {
      const ph = prev.holdings[h.bbl];
      const seen = new Set((ph?.tenants ?? []).map((t) => t.name + ":" + t.startM));
      for (const t of h.tenants) if (!seen.has(t.name + ":" + t.startM)) {
        const wasThere = (ph?.tenants ?? []).some((x) => x.name === t.name);
        leases.push({ m: month, bbl: h.bbl, sf: t.sf, rent: t.rentPsf, term: (t.endM - t.startM) / 12, ti: t.tiPsf, free: t.freeUntilM ? t.freeUntilM - t.startM : 0, renewal: wasThere, rec: t.recovery, bump: t.bumpPct, use: t.use });
      }
    }
    if (m % 12 === 11) { const yr = leases.filter((l) => l.m > month - 12); met(SEED, "newLeasesYr", yr.filter((l) => !l.renewal).length); met(SEED, "renewalsYr", yr.filter((l) => l.renewal).length); }
    // trace the biggest building yearly
    if (m % 12 === 11) {
      const hs = Object.values(g.holdings).map((h) => ({ h, rec: E.resolveRec(parcels, g, h.bbl) })).filter((x) => x.rec && x.rec.bldgArea > 0 && !x.h.groundLeased);
      for (const { h, rec } of hs) {
        const val = E.ownedHoldingValue(g, parcels, h); const noi = E.ownedHoldingNoiYr(g, parcels, h); const occ = E.physicalOcc(rec, h);
        const cap = E.capRateFor(rec, e, h.condition, h.condIdx);
        let locm = NaN, land = NaN; try { locm = E.locationRentMult(rec, e, rec.class === "land" ? undefined : rec.class); land = E.landValue(rec, e); } catch {}
        (trace[h.bbl] ??= { cls: rec.class, sf: rec.bldgArea, basis: h.costBasis, block: rec.block, rows: [] }).rows.push(`y${Math.floor(month / 12)} v${K(val)} noi${K(noi)} occ${(occ * 100).toFixed(0)} cap${f1(cap)} rent${f1(E.marketRentPsfYr(rec, e, h.condition, h.condIdx))} cond${h.condition[0]}${h.condIdx !== undefined ? (h.condIdx * 100).toFixed(0) : ""} loc${f2(locm)} bD${f1(g.blockD?.[rec.block] ?? 0)} land${K(land)}`);
      }
    }
    // development tracking
    for (const d of devLog) {
      if (!d.deliveredM && !g.developments[d.bbl] && month > d.m + 1) {
        d.deliveredM = month; const h = g.holdings[d.bbl]; d.delivered = !!h;
      }
      if (d.deliveredM && !d.leasedM) { const h = g.holdings[d.bbl]; const rec = h && E.resolveRec(parcels, g, d.bbl); if (h && rec && rec.bldgArea > 0 && E.physicalOcc(rec, h) >= 0.85) d.leasedM = month; }
    }
  }

  // ---------------------------------------------------------------- report
  const nwEnd = E.netWorth(g, parcels);
  console.log(`end: month ${g.month} · cash ${K(g.cash)} · NW ${K(nwEnd)} (${(nwEnd / open).toFixed(2)}x) · holdings ${Object.keys(g.holdings).length} · loc ${K(g.loc?.balance ?? 0)}`);
  console.log("actions:", JSON.stringify(T));
  const mm = M[SEED];
  const PCT = new Set(["opexRatio", "taxToValue", "yieldOnValue", "yieldOnBasis", "ltvLive"]);
  const fmt = (k, v) => (PCT.has(k) ? (v * 100).toFixed(1) + "%" : f1(v));
  const row = (k) => `${k.padEnd(22)} p10 ${fmt(k, q(mm[k] ?? [], 0.1))}  p50 ${fmt(k, q(mm[k] ?? [], 0.5))}  p90 ${fmt(k, q(mm[k] ?? [], 0.9))}  n ${(mm[k] ?? []).length}`;
  for (const k of ["opexRatio", "taxToValue", "yieldOnValue", "yieldOnBasis", "couponSpread", "ltvLive", "refiDesksQuoting", "docket", "listingsLive", "newLeasesYr", "renewalsYr"]) if (mm?.[k]) console.log("  " + row(k));
  for (const c of CL) if (mm?.["rent-" + c]) console.log(`  ${c.padEnd(12)} rent $${f1(q(mm["rent-" + c], 0.5))}/sf · repl $${f1(q(mm["rcPsf-" + c], 0.5))}/sf · rent/cost ${(q(mm["rentToCost-" + c], 0.5) * 100).toFixed(1)}% · cap ${f1(q(mm["cap-" + c], 0.5))}% (spread ${f1(q(mm["capSpread-" + c], 0.5))}) · vac ${f1(q(mm["vac-" + c], 0.5))}%`);
  if (buyLog.length) console.log("  buys:", buyLog.map((b) => `${b.cls.slice(0, 3)} ${K(b.price)} (ask ${K(b.ask)}, appr ${K(b.appr)}) ${b.product} ${(b.ltv * 100).toFixed(0)}% @${f2(b.rate)} allin ${f2(b.allIn)} ${b.bind ?? ""}`).join(" | "));
  if (refiLog.length) console.log("  refis:", refiLog.map((r) => `m${r.m} ${r.desk} ${K(r.proceeds)} ${(r.ltv * 100).toFixed(0)}% dscr ${f2(r.dscr)} @${f2(r.rate)} (was ${f2(r.prevRate)}) net ${K(r.net)}${r.matSoon ? " balloon" : ""}`).join(" | "));
  if (devLog.length) console.log("  devs:", devLog.map((d) => `m${d.m} ${d.use} ${d.fl}fl ${K(d.sf)}sf yoc ${f2(d.yoc)} req ${f2(d.req)} $${d.costPsf.toFixed(0)}/sf ltc ${(d.ltc * 100).toFixed(0)}% @${f2(d.rate)} ${d.months}mo → delivered ${d.deliveredM ?? "-"} (${d.deliveredM ? d.deliveredM - d.m : "-"} mo) leased85 ${d.leasedM ? d.leasedM - d.deliveredM + " mo" : "-"}`).join(" | "));
  if (saleLog.length) console.log("  sales:", saleLog.map((s) => `listed m${s.listedM} ask ${K(s.ask)} appr ${K(s.appr)} basis ${K(s.basis)} → ${s.soldM ? `sold m${s.soldM} ${K(s.price)} (${(s.price / s.appr * 100).toFixed(0)}% of appr, ${s.soldM - s.listedM} mo)` : s.pulled ? `pulled m${s.pulled}` : "open"}`).join(" | "));
  if (appealLog.length) console.log("  appeals:", appealLog.map((a) => `m${a.m} assessed ${K(a.assessed)} target ${K(a.target)} save ${K(a.annualSavings)}/yr fee ${K(a.fee)} odds ${(a.odds * 100).toFixed(0)}%`).join(" | "));
  if (renoLog.length) console.log("  renos:", renoLog.map((r) => `m${r.m} ${r.cond} cost ${K(r.cost)} on value ${K(r.val)} (${(r.cost / r.val * 100).toFixed(0)}%)`).join(" | "));
  if (loiLog.length) {
    const acc = loiLog.filter((l) => l.action === "accept");
    console.log(`  LOIs ${loiLog.length}: rel-to-market p10 ${f2(q(loiLog.map((l) => l.rel), 0.1))} p50 ${f2(q(loiLog.map((l) => l.rel), 0.5))} p90 ${f2(q(loiLog.map((l) => l.rel), 0.9))} · TI p50 $${f1(q(loiLog.map((l) => l.ti), 0.5))} p90 $${f1(q(loiLog.map((l) => l.ti), 0.9))} · free p50 ${f1(q(loiLog.map((l) => l.free), 0.5))} p90 ${f1(q(loiLog.map((l) => l.free), 0.9))} · term p10 ${f1(q(loiLog.map((l) => l.term), 0.1) / 12)}y p50 ${f1(q(loiLog.map((l) => l.term), 0.5) / 12)}y p90 ${f1(q(loiLog.map((l) => l.term), 0.9) / 12)}y · bump p50 ${f2(q(loiLog.map((l) => l.bump ?? NaN).filter(Number.isFinite), 0.5))}% · recovery ${JSON.stringify(loiLog.reduce((a, l) => { a[l.rec ?? "?"] = (a[l.rec ?? "?"] ?? 0) + 1; return a; }, {}))} · kinds ${JSON.stringify(loiLog.reduce((a, l) => { a[l.kind] = (a[l.kind] ?? 0) + 1; return a; }, {}))} · accepted ${acc.length} countered ${loiLog.filter((l) => l.action === "counter").length}`);
  }
  for (const c of CL) if (mm?.["devYoc-" + c]) console.log(`  devYoc ${c}: p10 ${f2(q(mm["devYoc-" + c], 0.1))} p50 ${f2(q(mm["devYoc-" + c], 0.5))} p90 ${f2(q(mm["devYoc-" + c], 0.9))}`);
  console.log(`  NW path: ${(mm.nw ?? []).map(K).join(" → ")}`);
  if (leases.length) {
    const nl = leases.filter((l) => !l.renewal), rn = leases.filter((l) => l.renewal);
    console.log(`  leases signed ${leases.length} (new ${nl.length}, renewal ${rn.length}) · new: term p50 ${f1(q(nl.map((l) => l.term), 0.5))}y · TI p50 $${f1(q(nl.map((l) => l.ti ?? 0), 0.5))} · free p50 ${f1(q(nl.map((l) => l.free), 0.5))}mo · bump p50 ${f2(q(nl.map((l) => l.bump ?? NaN).filter(Number.isFinite), 0.5))}% · recovery ${JSON.stringify(leases.reduce((a, l) => { a[l.rec ?? "?"] = (a[l.rec ?? "?"] ?? 0) + 1; return a; }, {}))}`);
  }
  for (const [b, t] of Object.entries(trace)) console.log(`  trace ${b} ${t.cls} ${K(t.sf)}sf basis ${K(t.basis)}: ${t.rows.join(" | ")}`);
  console.log(`  index path: ${(mm.index ?? []).map(f1).join(" → ")} · cpi end ${f2((mm.cpi ?? []).at(-1))}`);
  for (const c of CL) console.log(`  rentIdx ${c}: ${(mm["ridx-" + c] ?? []).map(f1).join(" ")}`);
  console.log(`  affordEff mf: ${(mm["afford-mf"] ?? []).map(f2).join(" ")} · incomeEff mf: ${(mm["income-mf"] ?? []).map(f2).join(" ")} · effRent mf: ${(mm["eff-mf"] ?? []).map(f1).join(" ")}`);
}

console.log("\n================ FINDINGS ================");
for (const kind of ["BUG", "REALISM", "EVENT", "LIMIT"]) {
  const fs = [...findings.values()].filter((f) => f.kind === kind).sort((a, b) => b.n - a.n);
  if (!fs.length) continue;
  console.log(`\n-- ${kind} (${fs.length}) --`);
  for (const f of fs) console.log(`  [${f.n}] ${f.text}  ${f.examples.map((x) => JSON.stringify(x)).join(" ; ").slice(0, 400)}`);
}
console.log("\n-- REFUSALS (the engine's own words) --");
for (const [k, n] of [...errs.entries()].sort((a, b) => b[1] - a[1])) console.log(`  [${n}] ${k}`);
