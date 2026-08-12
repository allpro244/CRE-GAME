// PLAYTEST HARNESS — STRATEGY TOURNAMENT (throwaway, research only)
//
// One century, one city, one strategy. Every strategy runs against every seed
// so "this strategy is good" can be separated from "this seed was generous".
//
//   node tools/pt-strat.mjs '{"strategy":"levered","citySeed":1,"marketSeed":2,"size":"city"}'
//
// DESIGN NOTE — WHY ONE SHARED CORE.
// Leasing, broker coverage, negotiation mechanics, maturity refinancing and
// taking a good bid are IDENTICAL for every strategy. If each bot had its own
// leasing loop, the tournament would be measuring which loop I wrote better,
// not which strategy is better. All that differs between strategies is the
// POLICY object: what it will buy, whether it borrows and how hard, whether it
// builds, and when it sells.
//
// DEATH IS NOT RESURRECTED HERE. A resurrected player is a different player,
// and averaging a corpse's post-mortem century into a wealth distribution is
// how a bankruptcy rate becomes invisible. When the game ends the run ends,
// and the run reports the month it died. The ECONOMY is measured separately by
// tools/pt-econ.mjs, which does resurrect, because there the subject is the
// world rather than the player.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const E = await import(join(ROOT, "test/.engine.mjs"));
const { makeCity, cityName, PROCEDURAL } = await import(join(ROOT, "src/citygen/index.mjs"));

const cfg = JSON.parse(process.argv[2]);
const MONTHS = cfg.months ?? 1200;
const START = cfg.startCash ?? 5_000_000;
const CLASSES = ["office", "retail", "multifamily", "industrial"];
const NAT = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };

// ---------------------------------------------------------------- strategies
// Each policy answers four questions. Anything left undefined takes the
// default in `play()`, so a policy states only where it differs.
const POLICIES = {
  // The floor. Buy a handful of stabilised buildings with cash in the first
  // years, then never transact again — only collect rent and re-let. This is
  // the "is doing nothing viable" control, and CLAUDE.md is explicit that a
  // well-located unlevered asset behaving like a boring bond is correct.
  rentier: {
    label: "Rentier (buy 3, then only collect rent)",
    maxAssets: 3, borrow: false, builds: false, sells: false, buyWindowM: 240,
  },
  // Unlevered compounder: keep buying income, all cash, forever. No debt, no
  // disposals. Tests whether patient equity alone compounds.
  holdUnlevered: {
    label: "Buy & hold, unlevered",
    borrow: false, builds: false, sells: false,
  },
  // The conventional levered owner: bank debt at par leverage, refinance when
  // the balloon comes due, sell nothing unless it is a dog.
  levered: {
    label: "Levered buy & hold (bank debt, maturity refi)",
    borrow: true, targetLtv: 0.65, builds: false, sells: "dogs", cashOut: false,
  },
  // Aggressive: maximum advance, and cash-out refinance whenever the asset has
  // appreciated enough to support it, redeploying the proceeds into more.
  aggressive: {
    label: "Aggressive leverage (max LTV + cash-out refi)",
    borrow: true, targetLtv: 0.80, builds: false, sells: "dogs", cashOut: true,
  },
  // Ground-up specialist. Buys dirt only, and builds on it.
  developer: {
    label: "Ground-up developer",
    borrow: true, targetLtv: 0.65, builds: true, landOnly: true, sells: "gains",
  },
  // Merchant builder: build, lease up, trade out into strength.
  merchant: {
    label: "Merchant builder (build, lease, sell into strength)",
    borrow: true, targetLtv: 0.70, builds: true, landOnly: true, sells: "merchant",
  },
  // Vulture. Only distressed paper, and only when the cycle is against the
  // seller. Sits on its hands in a boom by construction.
  distress: {
    label: "Opportunistic distressed buyer",
    borrow: true, targetLtv: 0.65, builds: false, sells: "gains", distressOnly: true,
  },
  // Same engine as `levered`, but forced across all four classes.
  diversified: {
    label: "Diversified levered (all four classes)",
    borrow: true, targetLtv: 0.65, builds: false, sells: "dogs", diversify: true,
  },
  // Same engine as `levered`, but locked to whichever single class looked best
  // at the two-year mark and never allowed to leave it.
  concentrated: {
    label: "Concentrated levered (one asset class)",
    borrow: true, targetLtv: 0.65, builds: false, sells: "dogs", concentrate: true,
  },
};

const pol = POLICIES[cfg.strategy];
if (!pol) { console.error("unknown strategy " + cfg.strategy); process.exit(2); }

// ---------------------------------------------------------------------- city
const built = makeCity(PROCEDURAL, cfg.citySeed, { size: cfg.size });
E.normalizeParcels(built.parcels);
const parcels = built.parcels;
const adjacency = built.adjacency;
const bbls = Object.keys(parcels);

let g = E.firstListings(E.newGame(cfg.marketSeed, parcels, START), parcels, bbls);
g.citySize = cfg.size;
g.citySeed = cfg.citySeed;

// ------------------------------------------------------------------ recorder
// FRICTION TELEMETRY. Every engine call the bot makes goes through call(),
// which records the error string verbatim when one comes back. These are the
// moments where the obvious move failed — which is exactly what a real player
// would hit, and the only way to find them at scale is to count them.
const errs = new Map();
const attempts = new Map();
function call(name, res) {
  attempts.set(name, (attempts.get(name) ?? 0) + 1);
  if (res && res.err) {
    const key = `${name} :: ${String(res.err).slice(0, 120)}`;
    errs.set(key, (errs.get(key) ?? 0) + 1);
    return null;
  }
  return res;
}

const st = {
  bought: 0, sold: 0, builtN: 0, leases: 0, countered: 0, passed: 0,
  refis: 0, cashOutRefis: 0, refiTried: 0, walked: 0, land: 0, distressBuys: 0,
  balloonInBad: 0, balloonTotal: 0, refiAllQuotesFailed: 0,
};
const stories = [];
const push = (m, tag, text) => { if (stories.length < 200) stories.push({ m, y: 2000 + Math.floor(m / 12), tag, text }); };

const annual = [];
let peakNW = START, maxDD = 0, ddPeakM = 0, ddTroughM = 0, curDDpeak = START;
let diedM = null, deathReason = null;
let idleMonths = 0;            // had real money, wanted to buy, found nothing
let nothingToDoMonths = 0;     // no holdings, no talks, no lois, no developments
let concClass = null;
const rivalFails = [];
const buyLog = [];

// ------------------------------------------------------------------ helpers
const cash = () => g.cash;
const reserveFor = () => {
  // Fractions of the OPENING balance, never absolute dollars. CLAUDE.md
  // records a bot whose $4M threshold was sized to a $6M bankroll and silently
  // stopped trading when the default start cash changed.
  const n = Object.keys(g.holdings).length;
  let committed = 0;
  for (const d of Object.values(g.developments ?? {})) {
    committed += Math.max(0, (d.equityBudget ?? 0) - (d.equitySpent ?? 0));
  }
  return START * 0.30 + n * START * 0.06 + committed;
};

function pickProduct(loanWanted) {
  // Choose the cheapest product that will actually write a loan this size.
  const cands = E.PRODUCTS.filter((p) => p.id !== "mezz" && p.id !== "land")
    .filter((p) => loanWanted >= (p.minLoan ?? 0) && loanWanted <= (p.maxLoan ?? Infinity));
  cands.sort((a, b) => a.spread - b.spread);
  return cands[0]?.id ?? "harbor";
}

function softPhase(e) { return e.phase === "recession" || e.phase === "depression"; }
function hotPhase(e) { return e.phase === "peak" || e.phase === "expansion"; }

// ---------------------------------------------------------------- main loop
const t0 = Date.now();
for (let m = 0; m < MONTHS; m++) {
  const deadBefore = (g.rivals ?? []).filter((r) => r.failedM !== undefined).length;
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  const deadAfter = (g.rivals ?? []).filter((r) => r.failedM !== undefined).length;
  if (deadAfter > deadBefore) {
    for (const r of g.rivals ?? []) {
      if (r.failedM !== undefined && !rivalFails.some((x) => x.name === r.name)) {
        rivalFails.push({ name: r.name, style: r.style, m: r.failedM });
        push(r.failedM, "rival", `Rival ${r.name} (${r.style}) failed.`);
      }
    }
  }

  if (g.gameOver) {
    diedM = g.month;
    deathReason = typeof g.gameOver === "string" ? g.gameOver : (g.gameOver?.reason ?? "insolvent");
    push(g.month, "death", `WIPED OUT: ${String(deathReason).slice(0, 160)}`);
    break;
  }

  const e = g.econ;
  const loose = (k) => (e.cityVac?.[k] ?? NAT[k]) > NAT[k] + 0.02;
  const tight = (k) => (e.cityVac?.[k] ?? NAT[k]) < NAT[k] - 0.015;

  // Lock the concentrated bot's class at two years, on observed yield.
  if (pol.concentrate && concClass === null && m >= 24) {
    let best = null;
    for (const k of CLASSES) {
      const y = (e.rentIdx?.[k] ?? 0) > 0 ? (e.capRate?.[k] ?? 0) : 0;
      if (!best || y > best.y) best = { k, y };
    }
    concClass = best?.k ?? "multifamily";
    push(m, "policy", `Concentrating on ${concClass} for the rest of the century.`);
  }

  // ---- SHARED CORE 1: lease the space you own ------------------------------
  for (const loiSnap of [...(g.lois ?? [])]) {
    // Re-read the live LOI each pass. Acting on one LOI can retire another
    // (same building, same suite), and replaying a stale snapshot produces a
    // torrent of "That LOI is gone" that is the harness's fault, not the
    // game's — it would drown the friction telemetry this run exists to take.
    const loi = (g.lois ?? []).find((x) => x.id === loiSnap.id);
    if (!loi) continue;
    const rec = E.resolveRec(parcels, g, loi.bbl);
    const h = g.holdings[loi.bbl];
    if (!rec || !h) continue;
    const market = E.managedRentPsfYr(rec, e, h, loi.use ?? rec.class);
    if (loi.rentPsf >= market * 0.92) {
      const r = call("respondLOI.accept", E.respondLOI(g, parcels, loi.id, "accept", true));
      if (r) { g = r.s; st.leases++; continue; }
    }
    if (!loi.countered && loi.stage !== "countered") {
      const r = call("respondLOI.counter", E.respondLOI(g, parcels, loi.id, "counter", true, {
        rentPsf: +(market * 0.97).toFixed(2), tiPsf: Math.round((loi.tiPsf ?? 0) * 0.8),
      }));
      if (r) { g = r.s; st.countered++; continue; }
    }
    // One counter then decide. A soft market takes the deal.
    if (softPhase(e) || loi.rentPsf >= market * 0.86) {
      const r = call("respondLOI.accept2", E.respondLOI(g, parcels, loi.id, "accept", true));
      if (r) { g = r.s; st.leases++; continue; }
    }
    const p = call("respondLOI.pass", E.respondLOI(g, parcels, loi.id, "pass"));
    if (p) { g = p.s; st.passed++; }
  }

  // ---- SHARED CORE 2: market vacant space ----------------------------------
  for (const h of Object.values(g.holdings)) {
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec || rec.class === "land" || g.developments?.[h.bbl]) continue;
    const leased = (h.tenants ?? []).reduce((a, t) => a + t.sf, 0);
    const full = rec.bldgArea > 0 && leased > rec.bldgArea * 0.9;
    // Brokers are a commercial product; the engine refuses one on apartments.
    // Asking anyway every month for a century is harness noise, so the bot
    // learns the rule once. Noted as friction separately: nothing in the
    // listing tells you this before you try.
    const brokerable = rec.class !== "multifamily";
    if (brokerable && !full && !h.broker) { const r = call("setBroker.on", E.setBroker(g, parcels, h.bbl, true)); if (r) g = r.s; }
    if (full && h.broker) { const r = call("setBroker.off", E.setBroker(g, parcels, h.bbl, false)); if (r) g = r.s; }
    if (!full && h.stance !== 1) g = E.setStance(g, h.bbl, 1);
  }

  // ---- SHARED CORE 3: debt maturity ----------------------------------------
  // Every strategy that borrows must roll its balloons. This is where the
  // refinancing cliff bites, so it is instrumented: a maturity landing in a
  // soft market is counted whether or not the refi succeeds.
  for (const h of Object.values(g.holdings)) {
    const l = h.loan;
    if (!l || g.developments?.[h.bbl]) continue;
    const due = l.maturityM - g.month;
    if (due > 18) continue;
    if (due === 18) { st.balloonTotal++; if (softPhase(e)) st.balloonInBad++; }
    st.refiTried++;
    const { quotes } = E.refiQuotes(g, parcels, h.bbl);
    if (!quotes?.length) {
      errs.set("refiQuotes :: no quotes returned at maturity", (errs.get("refiQuotes :: no quotes returned at maturity") ?? 0) + 1);
      continue;
    }
    const payoff = l.balance;
    // Try every quote the desk actually offered, cheapest sufficient first.
    // A player would do the same — refused by one lender, ring the next — and
    // it separates "no lender will do this" from "this one quote was bad".
    const ranked = [
      ...quotes.filter((q) => q.maxProceeds >= payoff).sort((a, b) => a.ratePct - b.ratePct),
      ...quotes.filter((q) => q.maxProceeds < payoff).sort((a, b) => b.maxProceeds - a.maxProceeds),
    ];
    let done = false;
    for (const q of ranked) {
      const r = call("refinance", E.refinance(g, parcels, h.bbl, q.id, 1));
      if (r) { g = r.s; st.refis++; done = true; break; }
    }
    if (!done) st.refiAllQuotesFailed++;
  }

  // ---- POLICY: cash-out refinance ------------------------------------------
  if (pol.cashOut && m % 6 === 0) {
    for (const h of Object.values(g.holdings)) {
      if (!h.loan || g.developments?.[h.bbl]) continue;
      if (g.month - (h.loan.startM ?? h.boughtM ?? 0) < 48) continue;
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec) continue;
      const v = E.holdingValue(rec, e, h, g.month);
      const { quotes } = E.refiQuotes(g, parcels, h.bbl);
      if (!quotes?.length) continue;
      const best = quotes.slice().sort((a, b) => b.maxProceeds - a.maxProceeds)[0];
      if (!best) continue;
      // Only pull cash if it is a real advance over the existing balance.
      if (best.maxProceeds < h.loan.balance * 1.25) continue;
      const r = call("refinance.cashout", E.refinance(g, parcels, h.bbl, best.id, 1));
      if (r) { g = r.s; st.cashOutRefis++; st.refis++; break; }
    }
  }

  // ---- SHARED CORE 4: take a good bid --------------------------------------
  for (const h of Object.values(g.holdings)) {
    if (!h.sale?.offer) continue;
    // A pure hold strategy is not allowed to be quietly rescued by an
    // unsolicited bid — that would make the "never sells" control a seller.
    // The one exception is the survival case above, where it is selling on
    // purpose because the alternative is dying solvent-on-paper.
    if (pol.sells === false && cash() > START * 0.05) continue;
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (!rec) continue;
    const v = E.holdingValue(rec, e, h, g.month);
    if (h.sale.offer.price >= v * (hotPhase(e) ? 1.02 : 0.97)) {
      const r = call("acceptSaleOffer", E.acceptSaleOffer(g, parcels, h.bbl));
      if (r) {
        g = r.s; st.sold++;
        const gain = h.costBasis > 0 ? h.sale.offer.price / h.costBasis : 0;
        if (gain > 2.5) push(g.month, "sale", `Sold ${rec.address} for $${(h.sale.offer.price / 1e6).toFixed(1)}M — ${gain.toFixed(1)}x basis after ${Math.round((g.month - h.boughtM) / 12)}y.`);
      }
    } else if (!h.sale.offer.countered) {
      const r = call("counterSale", E.counterSale(g, parcels, h.bbl, Math.round(h.sale.offer.price * 1.05)));
      if (r) g = r.s;
    }
  }

  // ---- SHARED CORE 4b: survival ---------------------------------------------
  // Every strategy gets this, including the ones whose policy is never to
  // sell. A player staring at an empty tank raises cash from whatever they
  // own; a bot that starves to death holding assets is measuring my
  // negligence. Applied identically to all nine so it cannot advantage one.
  if (cash() < START * 0.05 && !Object.values(g.holdings).some((h) => h.sale)) {
    let worst = null;
    for (const h of Object.values(g.holdings)) {
      if (g.developments?.[h.bbl]) continue;
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec) continue;
      const v = E.holdingValue(rec, e, h, g.month);
      const eq = v - (h.loan?.balance ?? 0);
      if (eq <= 0) continue;               // selling this frees nothing
      if (!worst || eq < worst.eq) worst = { h, rec, v, eq };
    }
    if (worst) {
      const r = call("listForSale.survival", E.listForSale(g, parcels, worst.h.bbl, Math.round(worst.v * 0.94)));
      if (r) { g = r.s; push(g.month, "survival", `Cash to $${(cash() / 1e3).toFixed(0)}k — listing ${worst.rec.address} to raise equity.`); }
    }
  }

  // ---- POLICY: disposition --------------------------------------------------
  if (pol.sells && m % 6 === 0) {
    for (const h of Object.values(g.holdings)) {
      if (h.sale || g.developments?.[h.bbl]) continue;
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec || rec.class === "land") continue;
      const v = E.holdingValue(rec, e, h, g.month);
      const held = g.month - h.boughtM;
      let want = false;
      if (pol.sells === "dogs") want = held > 120 && v < h.costBasis * 0.85 && softPhase(e);
      if (pol.sells === "gains") want = (v > h.costBasis * 1.9 && held > 72 && hotPhase(e)) || (held > 120 && v < h.costBasis * 0.85 && softPhase(e));
      if (pol.sells === "merchant") {
        const leased = (h.tenants ?? []).reduce((a, t) => a + t.sf, 0);
        const stabilised = rec.bldgArea > 0 && leased > rec.bldgArea * 0.8;
        want = stabilised && held > 36 && (hotPhase(e) || v > h.costBasis * 1.3);
      }
      if (!want) continue;
      const r = call("listForSale", E.listForSale(g, parcels, h.bbl, Math.round(v * 1.03)));
      if (r) { g = r.s; break; }
    }
  }

  // ---- SHARED CORE 5: work the talks ---------------------------------------
  for (const t of Object.values(g.talks ?? {})) {
    const rec = E.resolveRec(parcels, g, t.bbl);
    if (t.agreed) {
      const isLand = rec?.class === "land";
      let r = null;
      if (pol.borrow) {
        const price = t.agreedPrice ?? 0;
        const lev = isLand ? Math.min(0.5, pol.targetLtv) : pol.targetLtv;
        const prod = isLand ? "land" : pickProduct(price * lev);
        r = call("closeDeal.debt", E.closeDeal(g, parcels, t.bbl, prod, lev));
      }
      if (!r) r = call("closeDeal.cash", E.closeDeal(g, parcels, t.bbl, "cash", 1));
      if (r) {
        g = r.s; st.bought++;
        if (isLand) st.land++;
        buyLog.push({ m: g.month, bbl: t.bbl, price: t.agreedPrice, cls: rec?.class, addr: rec?.address });
        if (st.bought <= 3) push(g.month, "buy", `Bought ${rec?.address ?? t.bbl} at $${((t.agreedPrice ?? 0) / 1e6).toFixed(1)}M.`);
      }
      continue;
    }
    // Counter-party has come back with a price.
    const noi = rec && rec.class !== "land" ? E.noiAfterTaxYr(rec, e, E.initialCondition(rec), t.theirPrice) : 0;
    const ok = rec && (rec.class === "land"
      ? t.theirPrice < E.landValue(rec, e) * 1.06
      : noi / Math.max(1, t.theirPrice) > (e.indexRate + 1.0) / 100);
    if (ok) {
      const r = call("acceptCounter", E.acceptCounter(g, parcels, t.bbl));
      if (r) g = r.s;
    } else if (t.final) {
      g = E.walkAway(g, parcels, t.bbl).s; st.walked++;
    } else {
      const mid = Math.round((t.yourPrice + t.theirPrice) / 2);
      const r = call("negotiate.mid", E.negotiate(g, parcels, t.bbl, mid));
      if (r) g = r.s;
    }
  }

  // ---- POLICY: acquisition --------------------------------------------------
  const reserve = reserveFor();
  const nHold = Object.keys(g.holdings).length;
  const capped = pol.maxAssets != null && nHold >= pol.maxAssets;
  const windowShut = pol.buyWindowM != null && m > pol.buyWindowM;
  // A developer does not buy a second site before the first is under way.
  // The naive version — buy dirt whenever you can afford dirt — reliably
  // killed the bot: land pays property tax and produces no income, so an
  // unbuilt lot is a subscription to a bill. That is a real property of the
  // business and it stays in the report as a finding, but a bot that keeps
  // doing it is measuring my carelessness rather than the strategy.
  const idleDirt = pol.landOnly && Object.values(g.holdings).some((h) => {
    const rr = E.resolveRec(parcels, g, h.bbl) ?? parcels[h.bbl];
    return rr && rr.class === "land" && !g.developments?.[h.bbl];
  });
  const canShop = !capped && !windowShut && !idleDirt
    && Object.keys(g.talks ?? {}).length < 2 && cash() > reserve;

  if (canShop) {
    let best = null;
    for (const l of g.listings ?? []) {
      if (g.holdings[l.bbl]) continue;
      const rec = E.resolveRec(parcels, g, l.bbl);
      if (!rec) continue;
      const isLand = rec.class === "land";

      if (pol.landOnly && !isLand) continue;
      if (!pol.landOnly && isLand) continue;          // income buyers do not buy dirt
      if (pol.distressOnly && !l.distress) continue;
      if (pol.concentrate && !isLand && concClass && rec.class !== concClass) continue;

      if (isLand) {
        if (rec.lotArea < 3000 || rec.demandScore < 50) continue;
        // Only buy dirt you could plausibly build on soon.
        const score = rec.demandScore / 800 + (l.distress ? 0.04 : 0);
        if (!best || score > best.score) best = { l, score, isLand, rec };
        continue;
      }

      const cond = E.initialCondition(rec);
      const noi = E.noiAfterTaxYr(rec, e, cond, l.ask);
      const yld = l.ask > 0 ? noi / l.ask : 0;
      const hurdle = pol.borrow ? (e.indexRate + (softPhase(e) ? 0.9 : 1.5)) / 100 : (e.indexRate + 0.5) / 100;
      let want = (yld > hurdle && !loose(rec.class)) || (l.distress && yld > hurdle * 0.85);
      if (pol.distressOnly) want = l.distress && yld > hurdle * 0.8;
      if (!want) continue;

      let score = yld + (l.distress ? 0.03 : 0) + rec.demandScore / 5000;
      if (pol.diversify) {
        // Bias hard toward whatever class you own least of.
        const owned = {};
        for (const h of Object.values(g.holdings)) {
          const rr = E.resolveRec(parcels, g, h.bbl);
          if (rr && rr.class !== "land") owned[rr.class] = (owned[rr.class] ?? 0) + 1;
        }
        const mine = owned[rec.class] ?? 0;
        const tot = Object.values(owned).reduce((a, b) => a + b, 0);
        const share = tot > 0 ? mine / tot : 0;
        score += (0.25 - share) * 0.08;
      }
      if (!best || score > best.score) best = { l, score, isLand, rec, yld };
    }

    if (best) {
      const bid = Math.round(best.l.ask * (best.l.distress ? 0.88 : 0.94));
      let equityOk = false;
      if (pol.borrow) {
        const lev = best.isLand ? Math.min(0.5, pol.targetLtv) : pol.targetLtv;
        const prod = best.isLand ? "land" : pickProduct(bid * lev);
        const q = E.buyQuote(g, parcels, best.l.bbl, bid, prod, lev);
        equityOk = q && q.equity < cash() - reserve * 0.5;
      } else {
        equityOk = bid * 1.05 < cash() - reserve * 0.5;
      }
      if (equityOk) {
        const r = call("negotiate.open", E.negotiate(g, parcels, best.l.bbl, bid));
        if (r) { g = r.s; if (best.l.distress) st.distressBuys++; }
      } else {
        idleMonths++;   // wanted it, could not fund it
      }
    } else {
      idleMonths++;     // had money, found nothing worth bidding on
    }
  }

  // ---- POLICY: development ---------------------------------------------------
  if (pol.builds && m % 3 === 0 && cash() > reserve) {
    for (const h of Object.values(g.holdings)) {
      const rec = E.resolveRec(parcels, g, h.bbl) ?? parcels[h.bbl];
      if (!rec || rec.class !== "land" || g.developments?.[h.bbl] || h.sale) continue;
      // Build for whatever the city is short of; if nothing is tight, build
      // the class with the least slack rather than nothing at all.
      let use = CLASSES.find((k) => tight(k));
      if (!use) {
        use = CLASSES.slice().sort((a, b) =>
          ((e.cityVac?.[a] ?? NAT[a]) - NAT[a]) - ((e.cityVac?.[b] ?? NAT[b]) - NAT[b]))[0];
      }
      const flMax = Math.min(E.maxFloorsFor(rec, 0.6), use === "multifamily" ? 12 : 10);
      let bestPlan = null, bestFl = 0;
      for (let fl = 2; fl <= flMax; fl++) {
        const plan = E.planDevelopment(g, parcels, h.bbl, use, fl, 0.6, "gmp");
        if (!plan || plan.hurdleRatio < 1.0) continue;
        // Underwrite the WHOLE equity cheque, not the closing draw. `equity`
        // is what the job needs over its life; `equityAtClose` is only the
        // first instalment, and the balance arrives as capital calls while the
        // steel is going in. Sizing to equityAtClose is how the bot kept
        // committing to jobs it could half-fund and dying on the second call —
        // it did so on every seed tried. (The same slip is in the existing
        // tools/billion-2050.mjs, which sizes on equityAtClose too.)
        if (plan.equity + plan.pointsCost > cash() - reserve * 0.5) continue;
        if (!bestPlan || plan.hurdleRatio > bestPlan.hurdleRatio) { bestPlan = plan; bestFl = fl; }
      }
      if (!bestPlan) continue;
      const r = call("startDevelopment", E.startDevelopment(g, parcels, h.bbl, use, bestFl, 0.6, "gmp"));
      if (r) {
        g = r.s; st.builtN++;
        push(g.month, "build", `Broke ground: ${use} at ${rec.address}, ${bestPlan.sf?.toLocaleString?.() ?? "?"} sf, YoC ${bestPlan.yieldOnCost?.toFixed?.(2)}%.`);
        break;
      }
    }
  }

  // ---- bookkeeping ----------------------------------------------------------
  const nw = E.netWorth(g, parcels);
  if (nw > curDDpeak) { curDDpeak = nw; ddPeakM = g.month; }
  peakNW = Math.max(peakNW, nw);
  const dd = curDDpeak > 0 ? 1 - nw / curDDpeak : 0;
  if (dd > maxDD) { maxDD = dd; ddTroughM = g.month; }

  if (nHold === 0 && !Object.keys(g.talks ?? {}).length && !Object.keys(g.developments ?? {}).length) {
    nothingToDoMonths++;
  }

  if (m % 12 === 11) {
    annual.push({
      y: 2000 + Math.floor(g.month / 12),
      nw, real: nw / (e.cpi || 1), cash: g.cash,
      n: nHold, phase: e.phase, cpi: e.cpi,
      debt: Object.values(g.holdings).reduce((a, h) => a + (h.loan?.balance ?? 0), 0),
    });
  }
}

// ------------------------------------------------------------------- results
const finalNW = diedM !== null ? 0 : E.netWorth(g, parcels);
const cpi = g.econ.cpi || 1;
const rows = (g.rivals ?? []).filter((r) => r.failedM === undefined).map((r) => {
  const mk = E.markRival(g, parcels, r);
  return { name: r.name, style: r.style, eq: mk.aum - r.debt + r.cash };
});
rows.push({ name: "You", style: "player", eq: finalNW });
rows.sort((a, b) => b.eq - a.eq);

process.stdout.write(JSON.stringify({
  kind: "strat",
  cfg: { ...cfg, cityName: cityName(PROCEDURAL, cfg.citySeed), lots: bbls.length, label: pol.label },
  ms: Date.now() - t0,
  monthsLived: diedM ?? MONTHS,
  died: diedM !== null, diedM, deathReason,
  finalNW, finalReal: finalNW / cpi, cpi,
  peakNW, maxDD, ddPeakM, ddTroughM,
  st, idleMonths, nothingToDoMonths, concClass,
  rank: rows.findIndex((r) => r.name === "You") + 1,
  nRivals: rows.length - 1,
  topRival: rows.find((r) => r.name !== "You") ?? null,
  rivalFails,
  annual,
  stories,
  buyLog: buyLog.slice(0, 60),
  errs: [...errs.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })),
  attempts: [...attempts.entries()].map(([k, v]) => ({ k, v })),
  finalPhase: g.econ.phase,
}));
