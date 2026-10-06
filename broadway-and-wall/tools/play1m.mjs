// ONE 50-YEAR PLAYTHROUGH FROM $1M, played as a human pressing "Yr ▸▸".
// Logs every clock stop by cause, every principal decision by type, what the
// docket held at each stop, and why a leasing desk referred letters back.
// PLAYTHROUGH_2026-10-06.md is the report it produced.
//   pnpm engine && node tools/play1m.mjs        (SEED=4242 YEARS=50 DELEGATE=auto|never|team|agent)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const E = await import(ROOT + "/test/.engine.mjs");
const { loadCity } = await import(ROOT + "/test/city.mjs");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const SEED = Number(process.env.SEED ?? 4242);
const YEARS = Number(process.env.YEARS ?? 50);
// DELEGATE: "auto" (my judgement mid-run), "never", or "agent"/"team" from day 1
const DELEGATE = process.env.DELEGATE ?? "auto";
const K = (n) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${(n / 1e3).toFixed(0)}K`);
const out = (...a) => console.log(...a);

let g = E.firstListings(E.newGame(SEED, parcels, 1_000_000), parcels, bbls);
const open = g.cash;
out(`seed ${SEED} · era ${g.econ.era} · phase ${g.econ.phase} · index ${g.econ.indexRate.toFixed(2)}% · cash ${K(g.cash)} · listings ${g.listings.length}`);

// --------------------------------------------------------------- bookkeeping
const yr = () => Math.floor(g.month / 12);
const Y = {}; // per-year counters
const bump = (k, n = 1) => { const y = yr(); (Y[y] ??= {}); Y[y][k] = (Y[y][k] ?? 0) + n; };
const stopsByHead = {};
const stopExamples = {};
const decisions = { loiAccept: 0, loiCounter: 0, loiPass: 0, renewAccept: 0, renewCounter: 0, renewPass: 0, askGrant: 0, askDecline: 0, nothingToDo: 0 };
const journal = [];
const J = (s) => { journal.push(`y${String(yr() + 1).padStart(2)} m${g.month} ${s}`); };
let delegated = { renewals: null, team: null, agent: null };
let leasingFeesPaid = 0;

const DC = {};
const dc = (k) => { DC[k] = (DC[k] ?? 0) + 1; bump("dc:" + k); };
function headOf(key) { return key.split(":")[0]; }

// ---------------------------------------------------------------- leasing, by hand
function answerLetters() {
  // what I would actually do sat at the Deals desk: read every letter, take the
  // good ones, counter the workable ones to market, let the junk go
  let guard = 0;
  while (guard++ < 400) {
    const mine = g.lois.filter((l) => E.loiNeedsPrincipal(g, l) && !l._seen);
    if (!mine.length) break;
    const loi = mine[0];
    const rec = E.resolveRec(parcels, g, loi.bbl);
    const h = g.holdings[loi.bbl];
    if (!rec || !h) { loi._seen = true; continue; }
    const mk = E.managedRentPsfYr(rec, g.econ, h, loi.use);
    const ne = E.loiMandateScore(loi, mk);
    const renewal = loi.kind === "renewal";
    let action, counter;
    if (loi.stage === "countered") action = ne >= 0.86 ? "accept" : "pass";
    else if (ne >= (renewal ? 0.93 : 0.97)) action = "accept";
    else if (ne >= 0.6) {
      action = "counter";
      counter = { rentPsf: +(mk * (renewal ? 1.0 : 1.02)).toFixed(2), tiPsf: Math.round((loi.tiPsf ?? 0) * 0.75), freeM: Math.max(0, (loi.freeM ?? 0) - 1) };
    } else action = "pass";
    const r = E.respondLOI(g, parcels, loi.id, action, false, counter);
    bump("decisions"); dc(renewal ? "renewal" : "letter");
    if (r.err) {
      // "you're short" — try the tenant-builds preset by passing
      const r2 = E.respondLOI(g, parcels, loi.id, "pass");
      if (!r2.err) g = r2.s; else { const l = g.lois.find((x) => x.id === loi.id); if (l) l._seen = true; }
      bump("loiErr"); stopExamples.loiErr ??= r.err;
      continue;
    }
    g = r.s;
    const k = (renewal ? "renew" : "loi") + action[0].toUpperCase() + action.slice(1);
    decisions[k] = (decisions[k] ?? 0) + 1;
    bump(renewal ? "renewalsAnswered" : "lettersAnswered");
    // a counter that came back as their counter stays on the desk -> loop picks it up
    const still = g.lois.find((x) => x.id === loi.id);
    if (still && still.stage !== "countered") still._seen = true;
    if (still && still.stage === "countered" && still._again) still._seen = true;
    if (still && still.stage === "countered") still._again = true;
  }
  for (const a of [...(g.asks ?? [])]) {
    const h = g.holdings[a.bbl]; const rec = h && E.resolveRec(parcels, g, a.bbl);
    // relief: grant when the market is soft (re-letting is worse), decline in tight markets
    const soft = rec && (g.econ.cityVac?.[rec.class] ?? 0.1) > 0.11;
    const r = E.answerAsk(g, parcels, a.id, soft ? "grant" : "decline");
    bump("decisions"); bump("asksAnswered"); dc("ask");
    if (!r.err) { g = r.s; decisions[soft ? "askGrant" : "askDecline"]++; }
  }
}

// ---------------------------------------------------------------- the investor
const NAT = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };
function liquidity() { return E.spendable(g, parcels).total; }
function reserve() {
  // three months of debt service and overhead, plus a cushion per building
  let ds = 0;
  for (const h of Object.values(g.holdings)) ds += h.loan?.payment ?? 0;
  return Math.max(150_000, ds * 4 + E.firmOverheadMonthly(g, parcels) * 4 + Object.keys(g.holdings).length * 40_000);
}

let lastShop = -99;
function shop() {
  if (Object.keys(g.talks ?? {}).length >= 2) return;
  const e = g.econ;
  const free = g.cash - reserve();
  if (free < 120_000) return;
  let best = null;
  for (const l of g.listings) {
    if (g.holdings[l.bbl] || g.talks?.[l.bbl] || !(l.ask > 0)) continue;
    const rec = E.resolveRec(parcels, g, l.bbl);
    if (!rec) continue;
    if (rec.class === "land") {
      // land only when I have a builder's margin and the cash to carry it
      if (free > l.ask * 0.6 && l.ask < free * 1.5) {
        let p = null;
        for (const use of ["multifamily", "office", "industrial", "retail", "mixed"]) {
          const fl = E.maxFloorsFor(rec, 0.6, use);
          const pl = E.planDevelopment({ ...g, holdings: { ...g.holdings, [l.bbl]: { bbl: l.bbl, costBasis: l.ask, boughtM: g.month, tenants: [], condition: "good" } } }, parcels, l.bbl, use, fl, 0.6, "gmp");
          if (pl && (!p || pl.hurdleRatio > p.hurdleRatio)) p = pl;
        }
        if (p && p.hurdleRatio > 1.12) {
          const score = 0.02 + (p.hurdleRatio - 1) * 0.1;
          if (!best || score > best.score) best = { l, rec, land: true, score };
        }
      }
      continue;
    }
    const ip = E.inPlace(rec, g, l.bbl, l.ask);
    const y = ip?.noi > 0 ? ip.noi / l.ask : -1;
    const appr = E.marketAppraisal(g, rec, l.bbl, E.initialCondition(rec));
    const discount = appr / l.ask - 1;
    // opportunistic: positive leverage, or a real discount to appraisal
    const spread = y * 100 - e.indexRate;
    const looseCls = (e.cityVac?.[rec.class] ?? NAT[rec.class]) > NAT[rec.class] + 0.03;
    if (l.ask > free * 3.2 || l.ask < 250_000) continue;
    if (!(spread > 1.0 || (discount > 0.12 && y > 0.04))) continue;
    if (looseCls && discount < 0.15) continue;
    const score = y + discount * 0.3 + (l.distress ? 0.01 : 0);
    if (!best || score > best.score) best = { l, rec, land: false, score, y, appr };
  }
  if (!best) return;
  const bid = Math.round(best.l.ask * (best.l.distress ? 0.95 : 0.9));
  const r = E.negotiate(g, parcels, best.l.bbl, bid);
  if (!r.err) { g = r.s; bump("decisions"); dc("bid"); J(`bid ${K(bid)} on ${best.rec.class} ${best.rec.address ?? best.l.bbl} (ask ${K(best.l.ask)}${best.land ? ", land" : `, yield ${(best.y * 100).toFixed(1)}%, appr ${K(best.appr)}`})`); }
}

function workTalks() {
  for (const t of Object.values(g.talks ?? {})) {
    const rec = E.resolveRec(parcels, g, t.bbl);
    if (!rec) continue;
    bump("decisions"); dc("talks");
    if (t.agreed) {
      const px = t.agreedPrice ?? t.theirPrice;
      const choices = rec.class === "land" ? ["land"] : ["harbor", "savings", "pelican", "conduit", "cordage"];
      let pick = null;
      for (const p of choices) {
        const q = E.buyQuote(g, parcels, t.bbl, px, p, 1);
        if (q.principal > 0 && q.equity < g.cash - reserve() * 0.5 && (!pick || q.allInPct < pick.q.allInPct)) pick = { p, q };
      }
      let r = pick ? E.closeDeal(g, parcels, t.bbl, pick.p, 1) : { err: "no lender fits" };
      if (r.err) { J(`couldn't close ${rec.address}: ${r.err.slice(0, 90)}`); g = E.walkAway(g, parcels, t.bbl).s; continue; }
      g = r.s; bump("bought");
      J(`BOUGHT ${rec.class} ${rec.address} ${Math.round(rec.bldgArea).toLocaleString()}sf for ${K(px)} — ${pick.p} ${(pick.q.principal / px * 100).toFixed(0)}% @${pick.q.ratePct?.toFixed(2)}%`);
      continue;
    }
    const gap = t.theirPrice / Math.max(1, t.yourPrice) - 1;
    if (gap < 0.05 || (t.round >= 2 && gap < 0.09)) { const r = E.acceptCounter(g, parcels, t.bbl); if (!r.err) g = r.s; }
    else if (t.final) g = E.walkAway(g, parcels, t.bbl).s;
    else { const r = E.negotiate(g, parcels, t.bbl, Math.round((t.yourPrice * 0.6 + t.theirPrice * 0.4))); if (!r.err) g = r.s; }
  }
}

function manageBook() {
  const e = g.econ;
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec) continue;
    const built = rec.class !== "land" && rec.bldgArea > 0 && !h.groundLeased;
    // develop land I own
    if (rec.class === "land" && !g.developments[h.bbl] && !h.sale) {
      let best = null;
      for (const use of ["multifamily", "office", "industrial", "retail", "mixed"]) {
        const maxFl = E.maxFloorsFor(rec, 0.6, use);
        for (const fl of [Math.max(1, Math.round(maxFl * 0.6)), maxFl]) {
          const p = E.planDevelopment(g, parcels, h.bbl, use, fl, 0.6, "gmp");
          if (p && p.hurdleRatio >= 1.05 && (!best || p.hurdleRatio > best.p.hurdleRatio)) best = { p, use, fl };
        }
      }
      if (best && best.p.equityAtClose + best.p.pointsCost < liquidity() - reserve()) {
        const r = E.startDevelopment(g, parcels, h.bbl, best.use, best.fl, 0.6, "gmp");
        bump("decisions");
        if (!r.err) { g = r.s; bump("devStarted"); J(`BUILD ${best.use} ${best.fl}fl ${Math.round(best.p.sf).toLocaleString()}sf on ${rec.address} — YoC ${best.p.yieldOnCost.toFixed(2)}% vs ${best.p.requiredYield?.toFixed(2)}%, equity ${K(best.p.equityAtClose)}`); }
      }
      continue;
    }
    if (!built || g.developments[h.bbl]) continue;
    // exclusives on anything with real vacancy — a landlord would
    const occ = E.physicalOcc(rec, h);
    if (occ < 0.8 && !h.broker && g.cash > reserve()) { const r = E.setBroker(g, parcels, h.bbl, true); if (r?.s && !r.err) { g = r.s; bump("decisions"); dc("broker"); } }
    if (occ > 0.93 && h.broker) { const r = E.setBroker(g, parcels, h.bbl, false); if (r?.s && !r.err) { g = r.s; bump("decisions"); dc("broker"); } }
    // refinance: balloon inside a year, or a big cash-out at a better coupon
    const mat = h.loan && h.loan.maturityM - g.month <= 12;
    if (mat || (g.month - (h.refiM ?? h.boughtM) > 48 && yr() % 2 === 0)) {
      const { quotes, payoff } = E.refiQuotes(g, parcels, h.bbl);
      const live = quotes.filter((x) => x.available && x.maxProceeds > 0)
        .map((x) => ({ x, net: x.maxProceeds - payoff - Math.round(x.maxProceeds * x.points) }))
        .sort((a, b) => b.net - a.net);
      const b = live[0];
      if (b && (mat || (b.net > Math.max(250_000, payoff * 0.25) && (!h.loan || b.x.ratePct < h.loan.ratePct + 0.5)))) {
        const r = E.refinance(g, parcels, h.bbl, b.x.id, 1);
        bump("decisions"); dc(mat ? "refi-balloon" : "refi-cashout");
        if (!r.err) { g = r.s; g.holdings[h.bbl].refiM = g.month; bump("refi"); J(`REFI ${rec.address} — ${K(b.x.maxProceeds)} @${b.x.ratePct.toFixed(2)}% net ${K(b.net)}${mat ? " (balloon)" : ""}`); }
        else if (mat) J(`refi refused on balloon at ${rec.address}: ${r.err.slice(0, 100)}`);
      } else if (mat && !b) J(`no desk will refinance ${rec.address}`);
    }
    // renovate the worn ones if it pays
    if ((h.condition === "worn" || h.condition === "obsolete") && h.renovatingUntilM === undefined) {
      const cost = E.renovationCost(rec, e);
      const val = E.ownedHoldingValue(g, parcels, h);
      if (cost < liquidity() - reserve() && cost < val * 0.3) {
        const r = E.startRenovation(g, parcels, h.bbl); bump("decisions");
        if (!r.err) { g = r.s; bump("reno"); J(`RENOVATE ${rec.address} ${K(cost)}`); }
      }
    }
    // sell into strength: big gain, hot market, held a while — recycle the equity
    if (!h.sale && h.renovatingUntilM === undefined && g.month - h.boughtM >= 48 && (e.phase === "expansion" || e.phase === "peak")) {
      const val = E.ownedHoldingValue(g, parcels, h);
      if (val > h.costBasis * 1.6) {
        const r = E.listForSale(g, parcels, h.bbl, Math.round(val * 1.03), "marketed");
        bump("decisions"); dc("list");
        if (!r.err) { g = r.s; J(`LIST ${rec.address} at ${K(val * 1.03)} (basis ${K(h.costBasis)})`); }
      }
    }
    if (h.sale) {
      const s = h.sale;
      if (s.offer) {
        bump("decisions"); dc("sale");
        if (s.offer.price >= s.ask * 0.94) { const r = E.acceptSaleOffer(g, parcels, h.bbl); if (!r.err) { g = r.s; bump("sold"); J(`SOLD ${rec.address} ${K(s.offer.price)}`); continue; } }
        else if (!s.offer.countered) { const r = E.counterSale(g, parcels, h.bbl, Math.round(s.ask * 0.98)); if (r?.s && !r.err) g = r.s; }
      } else if (s.bids?.length) {
        bump("decisions"); dc("sale");
        const live = s.bids.map((b, i) => ({ b, i })).filter((x) => !x.b.dropped).sort((a, b2) => b2.b.price - a.b.price);
        if (live.length && (live[0].b.price >= s.ask * 0.93 || (s.round ?? 0) >= 1)) { const r = E.acceptBid(g, parcels, h.bbl, live[0].i); if (!r.err) { g = r.s; bump("sold"); J(`SOLD ${rec.address} ${K(live[0].b.price)} (bids)`); continue; } }
        else if (live.length) { const r = E.bestAndFinal(g, parcels, h.bbl); if (!r.err) g = r.s; }
      } else if (g.month - s.listedM > 14) { g = E.delist(g, h.bbl); bump("decisions"); }
    }
  }
  // the line
  const lim = E.locLimit(g, parcels), bal = g.loc?.balance ?? 0;
  if (g.cash < 60_000 && lim - bal > 50_000) { const r = E.drawLoc(g, parcels, Math.min(lim - bal, 300_000)); if (!r.err) g = r.s; }
  else if (bal > 0 && g.cash > reserve() * 1.5) { const r = E.repayLoc(g, Math.min(bal, g.cash - reserve())); if (!r.err) g = r.s; }
}

// ---------------------------------------------------------------- delegation
function rollingLeasingLoad() {
  // letters + renewals + asks I answered over the last 12 months
  const y = yr();
  const a = Y[y - 1] ?? {}, b = Y[y] ?? {};
  return (a.lettersAnswered ?? 0) + (a.renewalsAnswered ?? 0) + (a.asksAnswered ?? 0);
}
function maybeDelegate() {
  if (DELEGATE === "never") return;
  const load = rollingLeasingLoad();
  const stopsLastYr = Y[yr() - 1]?.stops ?? 0;
  // Step 1: renewals to management once renewals alone are a chore
  if (!delegated.renewals && (DELEGATE !== "auto" || (Y[yr() - 1]?.renewalsAnswered ?? 0) >= 8)) {
    g = { ...g, renewalMgmt: true };
    g = structuredClone(g); E.workLeasingDesk(g, parcels);
    delegated.renewals = g.month; J(`DELEGATE renewals to management (load ${load}/yr, ${stopsLastYr} stops last yr)`);
  }
  // Step 2: a leasing hire with the book once letters are past ~25/yr
  if (!delegated.team && (DELEGATE === "team" || (DELEGATE === "auto" && load >= 25))) {
    let gg = structuredClone(g); E.refreshPool(gg, true); g = gg;
    const pool = (g.hirePool?.list ?? []).filter((x) => x.role === "leasing").sort((a, b) => a.askSalary - b.askSalary);
    if (pool.length) {
      const c = pool[Math.floor(pool.length / 2)];
      const r = E.hire(g, parcels, c.id);
      if (!r.err) { g = r.s; delegated.team = -1; J(`HIRE leasing ${c.name ?? c.id} at ${K(c.askSalary)}/yr (load ${load}/yr, ${stopsLastYr} stops)`); }
      else J(`hire refused: ${r.err}`);
    }
  }
  if (delegated.team === -1 && (g.staff ?? []).some((x) => x.role === "leasing")) {
    g = structuredClone({ ...g, teamLeasing: true }); E.workLeasingDesk(g, parcels);
    delegated.team = g.month; J(`HAND THE BOOK to the leasing desk (plan: ${JSON.stringify(g.leasingPlan?.sheet?.office ?? {}).slice(0, 120)})`);
  }
  if (!delegated.agent && DELEGATE === "agent") {
    g = structuredClone({ ...g, agent: true }); E.workLeasingDesk(g, parcels); delegated.agent = g.month; J("AGENT has the book");
  }
}

// ---------------------------------------------------------------- the clock
let prevNW = E.netWorth(g, parcels);
const yearLines = [];
const docketSizes = [];
const DK = {};
const RR = {};
while (g.month < YEARS * 12 && !g.gameOver) {
  // what I do before pressing Yr: answer the docket, shop, run the book
  answerLetters(); workTalks(); manageBook();
  if (g.month - lastShop >= 1) { shop(); lastShop = g.month; for (let k = 0; k < 6 && Object.keys(g.talks ?? {}).length; k++) workTalks(); }
  // press Yr ▸▸ (cap 12 or to year end)
  const stop = E.stopRule(g, parcels);
  const hunting = g.cash - reserve() > 400_000;
  const cap = hunting ? 1 : 12 - (g.month % 12);
  if (hunting) bump("monthPresses");
  let stopped = null;
  for (let i = 0; i < cap; i++) {
    const before = g.month;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    for (const n of g.news) { if (n.q !== g.month) break; const mm = /referred .* back to you — (.*?)\. It is on/.exec(n.text ?? ""); if (mm) { const k = mm[1].replace(/\d[\d,.]*/g, "N").replace(/\$N[KM]?/g, "$X").slice(0, 110); RR[k] = (RR[k] ?? 0) + 1; } }
    for (const l of g.lois) if (l.docketReason && !l._dr) { l._dr = 1; const k = String(l.docketReason).replace(/\d[\d,.]*/g, "N").slice(0, 110); RR["docket: " + k] = (RR["docket: " + k] ?? 0) + 1; }
    if (g.deskMonth?.m === g.month) { bump("deskSigned", g.deskMonth.signed); bump("deskReferred", g.deskMonth.referred); bump("deskWalked", g.deskMonth.walked); bump("deskPassed", g.deskMonth.passed); }
    // month-end bookkeeping, per year
    if (g.month % 12 === 0) {
      const nw = E.netWorth(g, parcels);
      const y = g.month / 12;
      const c = Y[y - 1] ?? {};
      const hs = Object.values(g.holdings);
      const sf = hs.reduce((a, h) => a + (E.resolveRec(parcels, g, h.bbl)?.bldgArea ?? 0), 0);
      const tenants = hs.reduce((a, h) => a + h.tenants.length, 0);
      yearLines.push(`yr ${String(y).padStart(2)} ${g.econ.phase.padEnd(10)} idx ${g.econ.indexRate.toFixed(1).padStart(4)}%  NW ${K(nw).padStart(9)} (${nw >= prevNW ? "+" : ""}${((nw / prevNW - 1) * 100).toFixed(0)}%)  cash ${K(g.cash).padStart(8)}  ${String(hs.length).padStart(2)} deeds ${String(Math.round(sf / 1000)).padStart(5)}k sf ${String(tenants).padStart(4)} tenants | stops ${String(c.stops ?? 0).padStart(3)}  letters ${String(c.lettersAnswered ?? 0).padStart(3)}  renewals ${String(c.renewalsAnswered ?? 0).padStart(3)}  asks ${String(c.asksAnswered ?? 0).padStart(2)}  decisions ${String(c.decisions ?? 0).padStart(4)}  docket≈${docketSizes.length ? Math.round(docketSizes.reduce((a, b) => a + b, 0) / docketSizes.length) : 0}`);
      prevNW = nw; docketSizes.length = 0;
      maybeDelegate();
    }
    if (g.gameOver) break;
    const it = stop(g);
    if (it) { stopped = it; break; }
  }
  bump("presses");
  if (stopped) {
    bump("stops");
    const hd = headOf(stopped.key);
    stopsByHead[hd] = (stopsByHead[hd] ?? 0) + 1;
    (stopExamples[hd] ??= []).length < 3 && stopExamples[hd].push(`m${g.month}: ${stopped.label}`);
    bump("stop:" + hd);
    const items = E.attentionItems(g, parcels);
    docketSizes.push(items.length);
    for (const it2 of items) { const h2 = headOf(it2.key); DK[h2] = (DK[h2] ?? 0) + 1; bump("dk:" + h2); }
    // a stop where nothing on the docket is a decision I can take now
    if (hd === "lease-roll") bump("leaseRollStops");
  }
}

const nw = E.netWorth(g, parcels);
out("\n" + yearLines.join("\n"));
out(`\nEND month ${g.month}${g.gameOver ? " — GAME OVER: " + String(g.gameOver.cause ?? g.gameOver).slice(0, 120) : ""}: NW ${K(nw)} (${(nw / open).toFixed(1)}x on ${K(open)}) cash ${K(g.cash)} deeds ${Object.keys(g.holdings).length}`);
const board = (g.rivals ?? []).filter((r) => r.failedM === undefined).map((r) => ({ name: r.name, eq: E.rivalEquity(E.markRival(g, parcels, r), r) }));
board.push({ name: "You", eq: nw }); board.sort((a, b) => b.eq - a.eq);
out(`street: ${board.findIndex((b) => b.name === "You") + 1} of ${board.length}; top ${board[0].name} ${K(board[0].eq)}`);
out("\nstops by cause:", JSON.stringify(Object.entries(stopsByHead).sort((a, b) => b[1] - a[1])));
out("decisions:", JSON.stringify(decisions));
out("delegated:", JSON.stringify(delegated));
for (const [k, v] of Object.entries(stopExamples)) out(`  ${k}: ${Array.isArray(v) ? v.join(" | ") : v}`);
out("\ndocket rows seen at stops (all years):", JSON.stringify(Object.entries(DK).sort((a, b) => b[1] - a[1])));
out("decision types:", JSON.stringify(Object.entries(DC).sort((a, b) => b[1] - a[1])));
const mix = {}; for (const h of Object.values(g.holdings)) { const r = E.resolveRec(parcels, g, h.bbl); if (r) mix[r.class] = (mix[r.class] ?? 0) + 1; }
out("referral reasons:\n  " + Object.entries(RR).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + "  " + k).join("\n  "));
out("end mix:", JSON.stringify(mix));
for (const y of [5, 10, 15, 20, 25, 30, 33, 35, 40, 45, 49]) { const c = Y[y] ?? {}; out(`y${y + 1}`, JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("dc:") || k.startsWith("stop:") || k.startsWith("desk"))))); }
out("\nJOURNAL\n" + journal.join("\n"));
