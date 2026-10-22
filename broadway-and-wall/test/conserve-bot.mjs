// THE CONSERVE BOT — a player who actually does things, shared so other long
// runs (test/region-longrun.mjs) exercise the same ledger paths conserve does.
// Moved verbatim out of test/conserve.mjs; the comments are conserve's, and
// they explain why each threshold is what it is. `bot.built` and
// `bot.syndicated` are the two pieces of state the loop used to keep in
// closure; they live on the bot so a reloaded run can carry them across.
export function makeConserveBot(E, { seed, START }) {
  const bot = { built: false, syndicated: 0 };
  bot.step = (g, parcels, m) => {
  // A PLAYER WHO ACTUALLY DOES THINGS. An idle run exercises almost none of
  // the cash paths: no purchases, no debt, no leasing, no capex, no balloon.
  // Leasing at market and buying on a clock walks most of the ledger.
  for (const loi of [...g.lois]) {
    const rec = E.resolveRec(parcels, g, loi.bbl), h = g.holdings[loi.bbl];
    if (!rec || !h) continue;
    const ask = E.managedRentPsfYr(rec, g.econ, h, loi.use) * E.staleDiscount(h.darkMs);
    const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= ask * 0.92 ? "accept" : "pass");
    if (!r.err) g = r.s;
  }
  // ...AND IT KEEPS A RESERVE, because a bot that buys on a clock regardless
  // of its balance is not exercising the ledger, it is racing to insolvency.
  //
  // This file stops at gameOver, so how long the bot lives IS how many
  // months get reconciled — and that fell from 3,385 to 1,987 across two
  // changes that stopped rents compounding. Diagnosed rather than assumed:
  // it died at year 4 to 17 every time with a POSITIVE net worth ($7M to
  // $105M peak) and cash of -$0.1M to -$2.5M. Not a firm the economy broke;
  // a levered buyer with no liquidity management, which used to be bailed
  // out by rent growth that was itself the bug.
  //
  // Fixing the bot rather than the economy is the whole point of the
  // distinction: conserve tests the LEDGER IDENTITY, and it needs the bot
  // alive to test it over fifty years, not to prove the bot is any good.
  // Nothing here touches an engine number.
  // WHAT IT TAKES TO GET THIS BOT TO TRANSACT, and why it is a fraction of
  // its own opening balance rather than a number of dollars.
  //
  // It used to be `g.cash > 4_000_000`, with a $2.5M working reserve behind
  // it — both sized to a $6M opening bankroll. The opening bankroll became a
  // choice of $1M / $2.5M / $5M, defaulting to $2.5M, and nobody came back
  // here. The gate on which every money-moving change in this repo is
  // validated then spent an unknown number of commits reconciling a player
  // who never bought a building: 8 of the 10 ledger categories were dead,
  // `interest` and `ga` were the only two that moved, and the identity had
  // quietly become `Dcash == interest - ga`. See the coverage assertion at
  // the bottom of this file, which exists so that cannot happen silently
  // again.
  if (m % 9 === 0 && g.cash > START * 0.6) {
    for (const li of [...g.listings].slice(0, 8)) {
      const rec = E.resolveRec(parcels, g, li.bbl);
      if (!rec || g.holdings[li.bbl] || rec.class === "land") continue;
      if (li.ask > E.assetValue(rec, g.econ, E.initialCondition(rec))) continue;
      // Leave a working balance behind, the way anybody solvent does.
      // Leave cash-out room — a purchase at lev=1 plus Alden's $2.5M
      // minimum is how this bot printed `borrowed NO` and passed. Try
      // 60% of Harbor's advance first; if the equity cheque does not
      // fit the reserve, take 85%. Either way there is principal left
      // to draw. Skip "senior" — that id is not a desk.
      let closed = false;
      for (const lev of [0.60, 0.85]) {
        const q = E.buyQuote(g, parcels, li.bbl, li.ask, "harbor", lev);
        if (q.equity > g.cash - START * 0.25) continue;
        const r = E.executePurchase(g, parcels, li.bbl, li.ask, "harbor", false, lev);
        if (!r.err) { g = r.s; closed = true; break; }
      }
      if (closed) break;
    }
  }
  // AND IT PUTS A CRANE UP, ONCE. Development is the largest and lumpiest
  // set of cash movements the player has — the draw schedule, the overrun,
  // the capital call, the completion — and conserve found real faults in it
  // before. A bot that never breaks ground leaves `dev` at zero and leaves
  // that whole arm of the ledger unreconciled, so it buys one cheap lot and
  // builds on it. One job, not a programme: the point is coverage, not a
  // developer strategy.
  //
  // IT BUILDS WHAT IT CAN PAY FOR AND SURVIVE. This used to buy the first
  // cheap lot and put four storeys of office on it, whatever the Develop
  // desk said. Diagnosed, not assumed (seeds 73303 / 11 / 22 / 33 / 4242, on
  // the engine before AND after the occupancy-based lease-up mark — same
  // lots, same plans, death months 59/98/61/75/49 before and 60/98/50/83/49
  // after): every one of those jobs planned at a hurdle of 0.12 to 0.40 — a
  // building worth 14% to 47% of what it cost — on a $3.7M to $6.1M budget,
  // 1.5x to 2.4x the firm's whole equity. Delivery marked it $2.9M to $5.0M
  // under its basis, net worth went negative, and the creditors ended the
  // run. The lease-up change moved those delivery marks by 10-16% (it
  // strikes the as-is mark off the building's own blend rather than a
  // market as-if-stabilised it would never reach) and moved no death by
  // more than eleven months. That was the bot, not the economy.
  //
  // The obvious fix is the one a real developer uses — build only when value
  // on completion covers cost, hurdle x (1 + DEV_MARGIN) >= 1 — and it was
  // measured and it does not work here: on the lots this bot can afford
  // (ask under a quarter of its cash), the best scheme over every use and
  // one to eight storeys planned at a hurdle of 0.36 to 0.79 across 240
  // months on all seven seeds. Nothing a $2.5M firm can buy the dirt for
  // pencils (see ECONOMY.md on approached-owner land quoting at option
  // value), so that rule never broke ground and `dev` went dead in the
  // coverage line. The crane is a COVERAGE DEVICE — it is here to walk the
  // draw schedule and the completion through the ledger, not to make money —
  // so it is sized as one: of the schemes whose WHOLE equity fits above the
  // working balance (playdev's rule), it builds the one that loses least,
  // and only if that loss is a quarter of net worth or less, the same
  // fraction the bot keeps back as its working balance. A bot that must
  // build something underwater builds the smallest thing it can survive.
  //
  // Measured after: it breaks ground on five seeds (one- and two-storey
  // industrial, $0.4M to $0.6M), every ledger category still moves, and the
  // run reconciles 2,242 months where it had fallen to 858. The bot still
  // dies — in years 23 to 33, of a slow bleed on a one-building book, which
  // is the next thing to read if this number falls again.
  if (!Object.keys(g.developments ?? {}).length && !bot.built && g.cash > START * 0.8) {
    const canLose = 0.25 * E.netWorth(g, parcels);
    const scheme = (bbl, basis) => {
      const rec = E.resolveRec(parcels, g, bbl);
      if (!rec || rec.class !== "land") return null;
      const budget = g.cash - (basis ?? 0) - START * 0.25;
      let best = null;
      for (const use of ["office", "multifamily", "retail", "industrial"]) {
        // Only what the lot's zoning hosts — the engine's own rule.
        if (E.zoneUseBar(rec, use, g.econ)) continue;
        const top = Math.min(E.maxFloorsFor(rec, 0.6, use), 8);
        for (let fl = 1; fl <= top; fl++) {
          const p = E.planDevelopment(g, parcels, bbl, use, fl, 0.6, "gmp", undefined, undefined, undefined, 0.5, basis);
          if (!p || !(p.stabNoi > 0) || !(p.yieldOnCost > 0) || p.equity > budget) continue;
          // All-in basis less value on completion, both off the desk's own
          // numbers: basis = NOI / yield on cost, value = NOI / exit yield.
          const loss = p.stabNoi * 100 * (1 / p.yieldOnCost - 1 / p.exitYield);
          if (loss > canLose) continue;
          if (!best || loss < best.loss) best = { p, use, fl, loss };
        }
      }
      return best;
    };
    if (!Object.keys(g.holdings).some((b) => E.resolveRec(parcels, g, b)?.class === "land")) {
      const lot = [...g.listings].find((li) => {
        const rec = E.resolveRec(parcels, g, li.bbl);
        return rec && rec.class === "land" && !g.holdings[li.bbl] && li.ask < g.cash * 0.25
          && scheme(li.bbl, li.ask);
      });
      if (lot) {
        const r = E.executePurchase(g, parcels, lot.bbl, lot.ask, "cash", false, 1);
        if (!r.err) g = r.s;
      }
    }
    for (const dirt of Object.keys(g.holdings)) {
      if (g.developments[dirt] || g.holdings[dirt].sale) continue;
      const pick = scheme(dirt);
      if (!pick) continue;
      // ON ODD SEEDS, WITH FRIENDS AND FAMILY IN THE DEAL (syndicate.ts):
      // half of what they could put in, so the investors' calls and
      // distributions run through this identity every month the deal lives.
      let custom;
      if (seed % 2 === 1) {
        const land = E.ownedHoldingValue(g, parcels, g.holdings[dirt]);
        const outside = Math.floor(E.maxOutside(g, E.devFundingNeed(pick.p).whole, land) * 0.5);
        if (outside > 0) custom = { syndicate: { outside } };
      }
      const d = E.startDevelopment(g, parcels, dirt, pick.use, pick.fl, 0.6, "gmp", undefined, custom);
      if (!d.err) { g = d.s; bot.built = true; if (custom) bot.syndicated++; break; }
    }
  }

  // A LANDLORD SHORT OF CASH SELLS SOMETHING. Without an exit the bot can
  // only ever accumulate, so one bad decade ends it no matter how much
  // equity it is sitting on — which is a fact about the bot, not the world.
  if (g.cash < 1_200_000) {
    const own = Object.keys(g.holdings).filter((b) => !g.holdings[b].sale);
    if (own.length > 1) {
      const bbl = own[0];
      const rec = E.resolveRec(parcels, g, bbl);
      if (rec) {
        const r = E.listForSale(g, parcels, bbl, Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)) * 0.92));
        if (!r.err) g = r.s;
      }
    }
  }
  for (const bbl of Object.keys(g.holdings)) {
    const off = g.holdings[bbl].sale?.offer;
    if (off && g.cash < 3_000_000) {
      const r = E.acceptSaleOffer(g, parcels, bbl);
      if (!r.err) g = r.s;
    }
  }
  // DRAW PRINCIPAL INTO CASH, so `borrowed` is actually exercised. An
  // identity that never sees a principal draw cannot claim the debt gap
  // is closed. Two doors, same bucket:
  //   1. A land loan on the cash lot the crane already bought — the
  //      dirt is unlevered, so the whole principal is net new.
  //   2. A cash-out on an income deed. Cordage first (open prepay, 80%
  //      LTV) so we do not wait out Harbor's 36-month stepdown; Harbor
  //      and Alden follow. Alden is not the first call — its $2.5M
  //      minimum silently refused every small deed the bot owns.
  if (m > 2 && m % 6 === 0) {
    for (const bbl of Object.keys(g.holdings)) {
      const h = g.holdings[bbl];
      const rec = E.resolveRec(parcels, g, bbl);
      if (!h || !rec || h.sale) continue;
      const desks = rec.class === "land"
        ? ["land"]
        : ((h.tenants?.length ?? 0) < 1 && rec.class !== "multifamily")
          ? []
          : ["cordage", "harbor", "savings"];
      let done = false;
      for (const desk of desks) {
        const r = E.refinance(g, parcels, bbl, desk, 1);
        if (!r.err) { g = r.s; done = true; break; }
      }
      if (done) break;
    }
  }
  // FUND EQUITY BUCKETS — plant a vehicle once and call/distribute so
  // `lpCalled` / `lpDistributed` are not decorative. Gates bypassed: this
  // is coverage of the identity, not a raise-worthiness test (see pnpm fund).
  if (m === 100 && !g.fund) {
    g = structuredClone(g);
    g.fund = {
      raisedM: g.month, size: 10_000_000, uncalled: 4_000_000, cash: 0,
      called: 0, distributed: 0, promotePaid: 0, prefAccrued: 0,
      investEndM: g.month + 60, lifeEndM: g.month + 120,
      pref: 0.08, promote: 0.20, gpCommit: 300_000,
    };
    const c = E.callFundCapital(g, 2_000_000);
    if (!c.err) g = c.s;
    const d = E.distributeFund(g, 400_000);
    if (!d.err) g = d.s;
  }
    return g;
  };
  return bot;
}
