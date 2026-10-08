// CAN YOU WIN AS A PURE DEVELOPER?
//
// No existing buildings. Ever. Buy dirt, put a building on it, lease it up,
// and either hold it for the income or sell it into strength — which is the
// whole of what a merchant builder does, and a strategy the game should
// support if development is a real pillar rather than a decoration.
//
// The comparison is `pnpm play50`, which buys income as well. If the developer
// cannot get within reach of that, development is not paying for the risk it
// carries: two to four years of capital tied up, a market that can turn under
// you while the steel goes in, and a mini-perm clock at the end of it.
//
//   pnpm playdev              one run, 50 years
//   SEEDS=8 pnpm playdev      a distribution
//   HOLD=1 pnpm playdev       hold everything instead of trading out
//
// IT ASSERTS ITS OWN COVERAGE. For a stretch of commits this printed "0 sites ·
// 0 built" and exited 0 — a harness measuring development that had not
// measured any. Across the run it must buy a site, break ground, deliver a
// building and sign a lease on it, or it exits 1 naming the dead stages and
// what the site screen saw (conserve's rule: an identity is only worth the
// question it was asked, and a bot's second failure mode is stopping).
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls, seed: CITY_SEED } = loadCity(0, E.normalizeParcels);
const CITY = process.env.BW_CITY ?? "somewhere";

const SEEDS = Number(process.env.SEEDS ?? 1);
const MONTHS = Number(process.env.HORIZON ?? 600);
const HOLD = process.env.HOLD === "1";
const M = (n) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`);
const NAT = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };
const USES = ["multifamily", "office", "retail", "industrial"];

const GRANT = Number(process.env.GRANT ?? 0);
// MDGA phase 0: the levers the game already has. On by default; LEVERS=0
// reproduces the old listed-land-only, unhedged bot for a before/after.
const LEVERS = process.env.LEVERS !== "0";
const APPROACH = LEVERS;
const CAPS = LEVERS;
// startDevelopment's own closing and change-order terms (actions.ts CLOSING_PCT,
// dev.ts commitCap) — the bot budgets for the cheque the engine will ask for.
const CLOSING = 0.02;
const CHANGE_ORDERS = 0.06;

// THE DESK'S WHOLE DIAL, AT THE PRICE YOU WOULD PAY.
//
// This bot used to screen a lot with ONE scheme — every use at 60% coverage
// and the tallest storey count maxFloorsFor gave for 60% — priced on
// `landValue` rather than the ask it was about to bid, and it broke ground only
// on a scheme from a floor sweep still held at 60%. Measured on the base
// engine (seed 7919, 20 years): the tape offered land in most years, the bot
// could afford every lot it saw, and its one scheme per lot planned at a
// hurdle of 0.16 to 0.91 — median 0.44 — so it bought nothing and built
// nothing in fifty years, on the base engine and on this one. It printed "0
// sites · 0 built" and exited 0: the harness that is supposed to measure
// development had not measured any since the small-lot economics landed
// (ECONOMY.md, "Why small listed lots do not pencil").
//
// Those economics are real and are NOT changed here: most small dirt does not
// pencil, and where it does it is usually priced for a building bigger than
// a $2.5M balance sheet. What a real small developer does is what the desk
// lets a player do — draw the one- and two-storey box, at the coverage the
// use may take (MAX_COVERAGE), and price it at the cheque it will actually
// write. So the bot sweeps use x coverage x floors, prices the dirt at its bid
// plus closing, and counts a scheme only if the whole equity, the points and
// the change-order margin fit above its reserve. The hurdle is still the
// market's own: hurdleRatio >= 1, the rule underwriteDevelopment gives the
// city's crane. No threshold was moved to make a number look better.
const covsFor = (use) => {
  const top = E.MAX_COVERAGE[use] ?? 0.7;
  return [...new Set([0.4, 0.55, 0.7, top].filter((c) => c <= top + 1e-9))];
};
function bestScheme(g, bbl, landBasis, budget) {
  const rec = E.resolveRec(parcels, g, bbl);
  if (!rec || rec.class !== "land") return { pick: null, bestH: 0 };
  const e = g.econ;
  let pick = null, bestH = 0;
  for (const use of USES) {
    if (E.zoneUseBar(rec, use, e)) continue;   // only what the zoning hosts
    for (const cov of covsFor(use)) {
      // Scale the job to the cheque. A developer with six million does not
      // start a twenty-million job and hope; they build what they can fund
      // and do it again next year.
      // No 14-floor ceiling (MDGA phase 0): the envelope and the cheque decide.
      // A sparse ladder keeps the screen cheap on a tall envelope.
      const maxFl = E.maxFloorsFor(rec, cov, use);
      const ladder = [...new Set([maxFl, 60, 48, 40, 32, 26, 20, 16, 13, 10, 8, 6, 5, 4, 3, 2, 1])]
        .filter((f) => f >= 1 && f <= maxFl).sort((x, y) => y - x);
      for (const fl of ladder) {
        const plan = E.planDevelopment(g, parcels, bbl, use, fl, cov, "gmp",
          undefined, undefined, undefined, 0.5, landBasis);
        if (!plan || !Number.isFinite(plan.hurdleRatio)) continue;
        bestH = Math.max(bestH, plan.hurdleRatio);
        // THE WHOLE EQUITY, not the first cheque. equityAtClose is 55% of
        // it; the rest is drawn on the S-curve over the next two years and
        // it has to be there. Reserving only the close is how a developer
        // gets seized in month fourteen with the frame up.
        const need = plan.equity + plan.pointsCost + plan.costTotal * CHANGE_ORDERS;
        if (need > budget) continue;   // cannot fund it — try smaller
        if (plan.hurdleRatio < 1) continue;
        const gap = NAT[use] - (e.cityVac?.[use] ?? NAT[use]);
        const spread = plan.yieldOnCost - plan.exitCap;
        // Score by hurdle that clears, not by tallest plate — biggest
        // affordable mid-rises were starving the cheque while a shorter
        // job would have broken ground.
        const scoreP = plan.hurdleRatio + gap * 2 + spread * 0.05;
        if (!pick || scoreP > pick.scoreP) pick = { plan, use, fl, cov, spread, scoreP };
      }
    }
  }
  return { pick, bestH };
}

function play(seed, verbose) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  // GRANT separates two different questions. At $6M the question is whether a
  // developer can bootstrap; with capital handed to them it is whether ground
  // -up development is profitable AT ALL once it is not capital-constrained.
  if (GRANT > 0) g = { ...g, cash: g.cash + GRANT };
  // Capture the opening cheque once. A hard-coded $2.5M reserve equalled
  // DEFAULT_START_CASH, so `cash > reserve` was false from month one — three
  // fifty-year runs, three insolvencies, zero sites, while the desk had
  // dozens of lots that cleared. Same fault conserve's bot hit when the
  // bankroll became a choice.
  const openCash = g.cash;
  const log = [];
  const st = { approached: 0, offMarket: 0, caps: 0, lotsSeen: 0, lotsPencil: 0, bestLotH: 0, refused: 0, delivered: 0, land: 0, built: 0, sold: 0, leases: 0, refis: 0, stalled: 0, noSite: 0, noPencil: 0, loisSeen: 0, countered: 0, passed: 0, emptyMo: 0, vacSf: 0 };
  let peakNW = 0, drawdown = 0;
  const trace = [];
  const delivered = new Set();

  for (let m = 0; m < MONTHS; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const e = g.econ;

    // ---- lease what you have built ----------------------------------------
    st.loisSeen += g.lois.length;
    for (const loi of [...g.lois]) {
      const h = g.holdings[loi.bbl];
      const rec = E.resolveRec(parcels, g, loi.bbl);
      if (!h || !rec) continue;
      const market = E.managedRentPsfYr(rec, e, h, loi.use);
      // a developer with a mini-perm clock takes the deal
      if (loi.rentPsf >= market * 0.88) {
        const r = E.respondLOI(g, parcels, loi.id, "accept", true);
        if (!r.err) { g = r.s; st.leases++; continue; }
      }
      // ONE counter, then decide. Re-countering the same LOI every month is
      // not negotiating, it is holding the tenant hostage until the paper
      // expires — 140 counters and one signature.
      if (!loi.countered && loi.stage !== "countered") {
        const r = E.respondLOI(g, parcels, loi.id, "counter", true, { rentPsf: +(market * 0.96).toFixed(2), tiPsf: Math.round(loi.tiPsf * 0.8) });
        if (!r.err) { st.countered++; g = r.s; continue; }
      }
      // A developer with a mini-perm clock does not walk away from a tenant
      // over the fit-out cheque. fund=true draws the shortfall on the line of
      // credit, which is exactly what the line is for — the alternative was
      // passing on a hundred-odd tenants because the TI was short.
      const acc = E.respondLOI(g, parcels, loi.id, "accept", true);
      if (!acc.err) { g = acc.s; st.leases++; continue; }
      st.passed++;
      const p2 = E.respondLOI(g, parcels, loi.id, "pass");
      if (!p2.err) g = p2.s;
    }

    // ---- MARKET THE EMPTY SPACE -------------------------------------------
    // An exclusive leasing agent is worth 1.75x the prospect flow and an
    // aggressive stance is worth more again. A developer holding an empty
    // building and not doing either is not being disciplined, they are being
    // asleep.
    for (const h of Object.values(g.holdings)) {
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec || rec.class === "land" || g.developments[h.bbl]) continue;
      const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
      const full = rec.bldgArea > 0 && leased > rec.bldgArea * 0.9;
      if (!full && !h.broker) { const r = E.setBroker(g, parcels, h.bbl, true); if (!r.err) g = r.s; }
      if (full && h.broker) { const r = E.setBroker(g, parcels, h.bbl, false); if (!r.err) g = r.s; }
      if (!full && h.stance !== 1) g = E.setStance(g, h.bbl, 1);
    }

    // ---- take the bid on anything you are selling --------------------------
    for (const h of Object.values(g.holdings)) {
      if (!h.sale?.offer) continue;
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec) continue;
      const v = E.holdingValue(rec, e, h, g.month);
      if (h.sale.offer.price >= v * 0.98) {
        const r = E.acceptSaleOffer(g, parcels, h.bbl);
        if (!r.err) { g = r.s; st.sold++; }
      } else if (!h.sale.offer.countered) {
        const r = E.counterSale(g, parcels, h.bbl, Math.round(h.sale.offer.price * 1.06));
        if (!r.err) g = r.s;
      }
    }

    // ---- TAKE OUT THE MINI-PERM -------------------------------------------
    // Delivery hands you a mini-perm that is interest-only for a year and
    // MATURES IN THREE. Stabilise the building and refinance it into permanent
    // paper, or the balloon arrives and the lender takes the building. Not
    // doing this is the single most expensive omission available to a
    // developer, and the bot was making it on every job it ever finished.
    for (const h of Object.values(g.holdings)) {
      const l = h.loan;
      if (!l || g.developments[h.bbl]) continue;
      const due = l.maturityM - g.month;
      if (due > 15) continue;                       // not yet
      const { quotes } = E.refiQuotes(g, parcels, h.bbl);
      if (!quotes?.length) continue;
      // the longest, cheapest paper that will cover the payoff
      // maxProceeds is what the lender will actually advance; a quote that
      // cannot cover the payoff is not a takeout, it is a capital call
      const payoff = l.balance;
      const best = quotes.filter((qq) => qq.maxProceeds >= payoff * 0.92)
        .sort((a, b) => a.ratePct - b.ratePct)[0]
        ?? quotes.slice().sort((a, b) => b.maxProceeds - a.maxProceeds)[0];
      if (!best || best.maxProceeds <= 0) continue;
      const r = E.refinance(g, parcels, h.bbl, best.id, 1);
      if (!r.err) { g = r.s; st.refis = (st.refis ?? 0) + 1; }
    }

    // ---- MERCHANT BUILD: sell the finished product -------------------------
    // A merchant developer's return is realised at the exit, not collected
    // over thirty years. Stabilised and past its lease-up, it goes.
    if (!HOLD && m % 3 === 0) {
      for (const h of Object.values(g.holdings)) {
        if (h.sale || g.developments[h.bbl]) continue;
        const rec = E.resolveRec(parcels, g, h.bbl);
        if (!rec || rec.class === "land" || h.deliveredM === undefined) continue;
        const seasoned = g.month - h.deliveredM > 30;
        // leased square feet over building area — the same thing the panel shows
        const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
        const occ = rec.bldgArea > 0 ? leased / rec.bldgArea : (h.occ ?? 0);
        if (seasoned && occ > 0.82) {
          const v = E.holdingValue(rec, e, h, g.month);
          const r = E.listForSale(g, parcels, h.bbl, Math.round(v * 1.03));
          if (!r.err) { g = r.s; break; }
        }
      }
    }

    // ---- BUY DIRT, AND ONLY DIRT -------------------------------------------
    // WHAT IS ALREADY COMMITTED. Every live job still has equity to draw on
    // its S-curve, and that money is spoken for. A developer who counts it as
    // dry powder is a developer who gets a capital call on three jobs in the
    // same quarter — which is how the last version of this bot died twice in
    // three runs.
    let committed = 0;
    for (const d of Object.values(g.developments)) {
      committed += Math.max(0, d.equityBudget - d.equitySpent);
    }
    const reserve = openCash * 0.35 + committed;
    if (!Object.keys(g.talks ?? {}).length && g.cash > reserve) {
      let best = null;
      for (const l of g.listings) {
        if (g.holdings[l.bbl]) continue;
        const rec = E.resolveRec(parcels, g, l.bbl);
        if (!rec || rec.class !== "land") continue;      // <-- the whole rule
        if (rec.lotArea < 2500) continue;
        st.lotsSeen++;
        // is there a use that pencils on this site today, at our bid, that
        // we could fund after paying for the dirt?
        const px = Math.round(l.ask * 0.9);
        const q = E.buyQuote(g, parcels, l.bbl, px, "land", 0.5);
        const { pick, bestH } = bestScheme(g, l.bbl, px * (1 + CLOSING), g.cash - reserve - q.equity);
        st.bestLotH = Math.max(st.bestLotH, bestH);
        if (!pick) continue;
        st.lotsPencil++;
        const score = pick.spread + rec.demandScore / 400;
        if (!best || score > best.score) best = { l, score, rec, px, q, ...pick };
      }
      if (best) {
        const r = E.negotiate(g, parcels, best.l.bbl, best.px);
        if (!r.err) g = r.s;
      } else st.noSite++;
    }
    // ---- OFF-MARKET: approach the owners of ripe land (MDGA phase 0) ------
    // Most land that pencils is never listed. A developer works the phones:
    // once a quarter, ring the owner of the best unlisted ripe lot not rung
    // in the last six months, and buy if the number still builds.
    if (APPROACH && m % 3 === 0 && !Object.keys(g.talks ?? {}).length && g.cash > reserve) {
      const listed = new Set(g.listings.map((l) => l.bbl));
      let target = null;
      for (const b of bbls) {
        if (g.holdings[b] || listed.has(b) || g.approaches?.[b]) continue;
        const rec = E.resolveRec(parcels, g, b);
        if (!rec || rec.class !== "land" || rec.lotArea < 2500) continue;
        const lr = E.landRead(rec, g.econ);
        if (!(lr.builder > 0) || lr.builder < lr.psf) continue;
        const v = lr.builder * rec.lotArea;
        if (!target || v > target.v) target = { b, v };
      }
      if (target) {
        const r = E.approachOwner(g, parcels, adjacency, target.b);
        st.approached++;
        if (!r.err) {
          g = r.s;
          const a = g.approaches[target.b];
          const px = a?.ask ?? (a?.reserve !== undefined ? Math.round(E.landValue(E.resolveRec(parcels, g, target.b), g.econ)) : undefined);
          if (px) {
            const q = E.buyQuote(g, parcels, target.b, px, "land", 0.5);
            const { pick } = bestScheme(g, target.b, px * (1 + CLOSING), g.cash - reserve - q.equity);
            if (pick) {
              const r2 = E.buyOffMarket(g, parcels, target.b, "land", 0.5, a?.ask === undefined ? px : undefined);
              if (!r2.err) {
                g = r2.s;
                if (g.holdings[target.b]) { st.land++; st.offMarket++; trace.push(`  m${g.month} BOUGHT SITE OFF-MARKET ${M(px)} · cash ${M(g.cash)}`); }
              }
            }
          }
        }
      }
    }

    // ---- HEDGE THE TAKEOUT: cap any floating loan that has none (MDGA phase 0)
    if (CAPS) {
      for (const h of Object.values(g.holdings)) {
        if (!h.loan || !h.loan.floating || h.loan.cap) continue;
        const r = E.buyRateCap(g, parcels, h.bbl);
        if (!r.err) { g = r.s; st.caps++; }
      }
    }

    for (const t of Object.values(g.talks ?? {})) {
      if (t.agreed) {
        let r = E.closeDeal(g, parcels, t.bbl, "land", 0.5);
        if (r.err) r = E.closeDeal(g, parcels, t.bbl, "cash", 1);
        if (!r.err) { g = r.s; trace.push(`  m${g.month} BOUGHT SITE ${M(t.agreedPrice)} · cash ${M(g.cash)}`); st.land++; }
        continue;
      }
      // Take the counter only if the building still pencils and still fits
      // the purse at THEIR price — the dirt is the one cost that is sunk the
      // day you close.
      const rec = E.resolveRec(parcels, g, t.bbl);
      const q = rec ? E.buyQuote(g, parcels, t.bbl, t.theirPrice, "land", 0.5) : null;
      const ok = rec && rec.class === "land"
        && !!bestScheme(g, t.bbl, t.theirPrice * (1 + CLOSING), g.cash - reserve - q.equity).pick;
      if (ok) { const r = E.acceptCounter(g, parcels, t.bbl); if (!r.err) g = r.s; }
      else if (t.final) { g = E.walkAway(g, parcels, t.bbl).s; }
      else {
        const r = E.negotiate(g, parcels, t.bbl, Math.round((t.yourPrice + t.theirPrice) / 2));
        if (!r.err) g = r.s;
      }
    }

    // ---- BREAK GROUND ------------------------------------------------------
    if (g.cash > reserve) {
      for (const h of Object.values(g.holdings)) {
        const rec = E.resolveRec(parcels, g, h.bbl);
        if (!rec || rec.class !== "land" || g.developments[h.bbl]) continue;
        // the whole equity of the new job, on top of everything already committed
        const { pick } = bestScheme(g, h.bbl, undefined, g.cash - reserve);
        if (!pick) { st.noPencil++; continue; }
        const r = E.startDevelopment(g, parcels, h.bbl, pick.use, pick.fl, pick.cov, "gmp");
        if (!r.err) {
          g = r.s; st.built++;
          trace.push(`  m${g.month} BREAK GROUND ${pick.use} ${pick.fl}fl @${Math.round(pick.cov * 100)}% · cost ${M(pick.plan.costTotal)} · equity ${M(pick.plan.equity)} · at close ${M(pick.plan.equityAtClose)} · hurdle ${pick.plan.hurdleRatio.toFixed(2)} · YoC ${pick.plan.yieldOnCost.toFixed(2)} vs exit ${pick.plan.exitCap.toFixed(2)} · cash after ${M(g.cash)}`);
          break;
        } else { st.refused++; trace.push(`  m${g.month} start refused: ${r.err}`); }
      }
    }
    for (const h of Object.values(g.holdings)) {
      if (h.deliveredM !== undefined) delivered.add(h.bbl);
    }

    for (const h of Object.values(g.holdings)) {
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec || rec.class === "land" || h.deliveredM === undefined) continue;
      const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
      if (leased < rec.bldgArea * 0.2) st.emptyMo++;
      st.vacSf += Math.max(0, rec.bldgArea - leased);
    }
    const nw = E.netWorth(g, parcels);
    peakNW = Math.max(peakNW, nw);
    drawdown = Math.max(drawdown, peakNW > 0 ? 1 - nw / peakNW : 0);
    if (verbose && m % 12 === 11) {
      log.push(`  yr ${String(Math.floor(m / 12) + 1).padStart(2)}  NW ${M(nw).padStart(8)}  cash ${M(g.cash).padStart(8)}` +
        `  ${String(Object.keys(g.holdings).length).padStart(2)} held  ${String(Object.keys(g.developments).length)} building  ${e.phase}`);
    }
    if (g.gameOver) break;
  }

  const board = (g.rivals ?? []).filter((r) => r.failedM === undefined).map((r) => {
    const mk = E.markRival(g, parcels, r);
    return { name: r.name, eq: mk.aum - r.debt + r.cash };
  });
  const nwFinal = E.netWorth(g, parcels);
  board.push({ name: "You", eq: nwFinal });
  board.sort((a, b) => b.eq - a.eq);
  st.delivered = delivered.size;
  return {
    g, st, nw: nwFinal, peakNW, drawdown, log, trace,
    rank: board.findIndex((b) => b.name === "You") + 1, field: board.length, top: board[0],
  };
}

const out = [];
for (let i = 1; i <= SEEDS; i++) {
  const r = play(i * 7919, SEEDS === 1 || i === 1);
  out.push(r);
  if (r.trace?.length) console.log("\n" + r.trace.slice(0, 14).join("\n"));
  if (r.log.length) {
    console.log(`\n=== ${CITY} · DEVELOPER ONLY${HOLD ? " (hold)" : " (merchant)"} · seed ${i} · ${MONTHS / 12} years ===`);
    console.log(r.log.join("\n"));
  }
  console.log(`\nseed ${i}: net worth ${M(r.nw)}  (peak ${M(r.peakNW)}, drawdown ${(r.drawdown * 100).toFixed(0)}%)` +
    `  ${r.st.land} sites · ${r.st.built} built · ${r.st.sold} sold · ${r.st.leases} leases · ${r.st.refis} refis` +
    (r.g.gameOver ? `  — RUN ENDED: ${r.g.gameOver.cause}` : "") +
    `\n         street: ${r.rank} of ${r.field} · biggest ${r.top.name} ${M(r.top.eq)}` +
    `\n         leasing: ${r.st.loisSeen} LOI-months seen · ${r.st.leases} signed · ${r.st.countered} countered · ${r.st.passed} passed · ${r.st.emptyMo} building-months under 20% let`);
}
if (SEEDS > 1) {
  const nws = out.map((r) => r.nw).sort((a, b) => a - b);
  console.log(`\nDEVELOPER ONLY across ${SEEDS} runs: worst ${M(nws[0])}  median ${M(nws[Math.floor(nws.length / 2)])}  best ${M(nws[nws.length - 1])}` +
    `  ·  ${out.filter((r) => r.g.gameOver).length} failed  ·  median rank ${out.map((r) => r.rank).sort((a, b) => a - b)[Math.floor(out.length / 2)]}`);
}

// ---- COVERAGE: did it develop anything at all? --------------------------------
const tot = (k) => out.reduce((a, r) => a + (r.st[k] ?? 0), 0);
const stages = { "sites bought": tot("land"), "ground broken": tot("built"), "buildings delivered": tot("delivered"), "leases signed": tot("leases") };
console.log(`\ncoverage: ${Object.entries(stages).map(([k, v]) => `${k} ${v}`).join(" · ")}` +
  `\n          site screen: ${tot("lotsSeen")} lot-months seen · ${tot("lotsPencil")} pencilled and fit the purse` +
  ` · best hurdle seen ${Math.max(...out.map((r) => r.st.bestLotH)).toFixed(2)} · ${tot("refused")} starts refused` +
  `\n          levers: ${tot("approached")} owners approached · ${tot("offMarket")} sites bought off-market · ${tot("caps")} rate caps bought`);
const dead = Object.entries(stages).filter(([, v]) => !(v > 0)).map(([k]) => k);
if (dead.length) {
  console.log(`\nFAIL — the developer never got past: ${dead.join(", ")}. This run measured nothing about development.` +
    `\nRead the site-screen line above before touching any threshold: see ECONOMY.md, "Why small listed lots do not pencil".\n`);
  process.exit(1);
}
console.log("");
