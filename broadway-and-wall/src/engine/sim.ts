// newGame + advanceQuarter — the pure heart of the game. No DOM, no store:
// (state, parcels) in, state out. The UI is a lens on this.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState, Listing } from "./types";
import { START_CASH, CENTURY_MONTHS, CASH_APY, logBooks, monthLabel } from "./types";
import { initEcon, rng, rrange, tickEcon } from "./market";
import { assetValue, holdingNOIYr, holdingValue, monthlyNOI, netWorth, resolveRec } from "./value";
import { recordComp } from "./comps";
import { tickPlanning } from "./zoning";
import { tickLeasing, depositsOn } from "./leasing";
import { tickSales, tickListingAbsorption, tickBrokerCalls, tickGroundLeases, saleTaxQuote } from "./actions";
import { tickTalks } from "./acquire";
import { tickLoan, prepayPenalty, productById } from "./debt";
import { distressPrice, markSponsor } from "./sponsor";
import { tickLoc } from "./credit";
import { tickDevelopments, tickPrograms, tickCityGrowth, tickConstructionLeasing } from "./dev";
import { tickDemand } from "./demand";
import { initRivals, tickRivals, gradeOf } from "./rivals";
import { initLenders, tickLenders, chargeLenderLoss } from "./lenders";
import { generateFirmName, tickFirm, firmShort } from "./firm";
import { reconcileDemand } from "./demand";
import { tickWorkouts } from "./workout";
import { tickLedger } from "./ledger";
import { tickNotes, maybeSellYourLoan } from "./notes";
import { tickAuction } from "./auction";
import { tickPortfolio } from "./portfolio";

const LISTING_LIFE_M: [number, number] = [6, 12];

// 0.5–1.5% of the city is on the market at any time: thin in expansions
// (owners hold), heavier in recessions (distress shakes assets loose).
/**
 * Standing inventory, as a share of the city.
 *
 * Transaction volume in this business is PROCYCLICAL and violently so. It
 * peaks with confidence and collapses in a crunch — 2009 saw volume fall by
 * four fifths — because the bid and the ask stop being in the same postcode
 * and anyone who does not have to sell simply doesn't. Having the most
 * inventory in a recession, as this did, turned every downturn into a
 * shopping trip with no downside: exactly why a hundred playthroughs showed
 * nobody able to lose.
 *
 * So: thin the tape in a crunch, and let what IS on it be distress. Waiting
 * for the bottom should be a skill that costs you patience, not a free option.
 */
function targetListings(s: GameState, totalLots: number): number {
  const base = s.econ.phase === "peak" ? 0.013
    : s.econ.phase === "expansion" ? 0.010
    : s.econ.phase === "recovery" ? 0.006
    : 0.004;                                  // recession: the market goes quiet
  // and the credit window gates it further — no debt, no buyers, no listings
  const ci = Math.max(0.4, Math.min(1.15, s.econ.creditIdx ?? 1));
  return Math.max(4, Math.round(totalLots * base * (0.55 + 0.5 * ci)));
}

export function newGame(seed: number, parcels?: ParcelTable): GameState {
  const s: GameState = {
    v: 32,
    seed,
    rng: seed,
    month: 0,
    cash: START_CASH,
    econ: null as never,
    holdings: {},
    listings: [],
    lois: [],
    nextLoiId: 1,
    approaches: {},
    developments: {},
    built: {},
    cityBuilt: [],
    landAdj: {},
    blockD: {},
    blockA: {},
    blockE: {},
    blockJ: {},
    lines: [],
    sponsor: { events: [] },
    rivals: [],
    lenderRel: {},
    lenders: initLenders(),
    // A NAME, NOT A PRONOUN. Generated from the seed so it is stable across
    // reloads of the same run, and editable from the Books page.
    firm: { ...generateFirmName(seed), foundedM: 0, epithets: [] },
    delivered: 0,
    workouts: {},
    notes: [],
    noteOffers: [],
    nextNoteId: 1,
    rivalNotes: [],
    totalLots: parcels ? Object.keys(parcels).length : 0,
    builtAtStart: parcels ? Object.values(parcels).filter((p) => p.class !== "land").length : 0,
    exchange: null,
    taxesPaid: 0,
    agent: false,
    loc: { balance: 0, drawnTotal: 0, interestPaid: 0 },
    books: [],
    nwHistory: [START_CASH],
    exits: [],
    milestones: {},
    news: [],
    gameOver: null,
    insolventMs: 0,
  };
  s.econ = initEcon(s, parcels);
  if (parcels) s.rivals = initRivals(s, parcels, Object.keys(parcels));
  // Make the map agree with itself before anybody looks at it: what is BUILT
  // on a block is part of what makes that block valuable, and the generator's
  // gravity score did not know that. See reconcileDemand.
  if (parcels) reconcileDemand(s, parcels);
  s.news.push({
    q: 0,
    kind: "info",
    text: `${monthLabel(0)}. You arrive with $6M and a hundred years. Half this town is still empty lots — the city will fill in around you, with or without your name on it.`,
  });
  return s;
}

// Rotating for-sale stock: mostly assets a $6–50M buyer can reach, with the
// occasional trophy so the skyline stays aspirational. Some sellers are
// MOTIVATED — estates, margin calls, partnership blowups — and price to move.
// That's where a sharp buyer makes their money.
export function refreshListings(s: GameState, parcels: ParcelTable, bbls: string[]) {
  // STALE LISTINGS REPRICE DOWN — TO A FLOOR, NOT TO ZERO.
  //
  // A monthly 1.5% cut compounded for the life of a listing, and the market
  // underneath it kept moving, so an ask set at 72% of appraisal in a soft year
  // could be a fraction of appraisal by the time anybody looked at it. Nobody
  // sells a building at a tenth of what it is worth because it has been on the
  // market a while — they take it off the market, or they hold.
  //
  // The floor is 70% of TODAY'S appraisal, which is the bottom of what a real
  // discount looks like: a motivated seller, a receiver clearing a book, an
  // estate that wants it done. Below that is not a bargain, it is a bug.
  const ASK_FLOOR = 0.70;
  for (const li of s.listings) {
    const rec = resolveRec(parcels, s, li.bbl);
    const floor = rec ? assetValue(rec, s.econ, gradeOf(s, rec)) * ASK_FLOOR : 0;
    if (s.month - li.listedM >= 4) li.ask = Math.round(li.ask * 0.985 / 1000) * 1000;
    if (floor > 0 && li.ask < floor) li.ask = Math.round(floor / 1000) * 1000;
  }
  // A listing you are under contract on does not lapse out from under you. The
  // contract has its own clock; this one stops while it runs.
  s.listings = s.listings.filter((l) =>
    (l.expiresM > s.month || s.talks?.[l.bbl]?.agreed) && !s.holdings[l.bbl]);
  const listed = new Set(s.listings.map((l) => l.bbl));
  const target = targetListings(s, bbls.length);
  const pDistress = s.econ.phase === "recession" ? 0.42 : s.econ.phase === "recovery" ? 0.18 : 0.03;
  let guard = 0;
  while (s.listings.length < target && guard++ < 4000) {
    const bbl = bbls[Math.floor(rng(s) * bbls.length)];
    if (listed.has(bbl) || s.holdings[bbl]) continue;
    // A BUILDING THAT SOLD LAST YEAR IS NOT FOR SALE THIS YEAR.
    //
    // This picked a parcel at random with no memory of what had just traded,
    // so a building the market absorbed came straight back onto the tape.
    // Measured over fifty years: 68 E 10th St was sold thirty-one times and
    // 116 W 4th St twenty-nine — the same addresses, over and over, which is
    // most of why the news read as a generator rather than as a city.
    //
    // Real holds run years, and they vary: a trader is out in three, an estate
    // sits for twenty. Hash the parcel so each building keeps its own tempo
    // instead of every building sharing one cooldown.
    const traded = s.lastTradeM?.[bbl];
    if (traded !== undefined) {
      let h = 2166136261;
      for (let i = 0; i < bbl.length; i++) { h ^= bbl.charCodeAt(i); h = Math.imul(h, 16777619); }
      const hold = 34 + ((h >>> 0) % 122);          // 34 to 155 months
      if (s.month - traded < hold) continue;
    }
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const value = assetValue(rec, s.econ, gradeOf(s, rec));
    if (value <= 0) continue;
    if (value > 60_000_000 && rng(s) > 0.12) continue;
    const distress = rng(s) < pDistress;
    // THE BID-ASK GAP. A seller under no pressure does not mark their building
    // to the new cap rate; they hold last year's number and wait. So in a
    // downturn the honest asks vanish and the tape fills with either dreamers
    // or people who have run out of road — and telling those apart is the job.
    const denial = s.econ.phase === "recession" ? rrange(s, 1.10, 1.28)
      : s.econ.phase === "recovery" ? rrange(s, 1.02, 1.14)
      : rrange(s, 0.94, 1.10);
    const ask = Math.round(value * (distress ? rrange(s, 0.72, 0.90) : denial) / 1000) * 1000;
    s.listings.push({
      bbl,
      ask,
      listedM: s.month,
      expiresM: s.month + Math.round(rrange(s, ...LISTING_LIFE_M)),
      distress: distress || undefined,
    } satisfies Listing);
    listed.add(bbl);
    if (distress && rng(s) < 0.6) {
      s.news.unshift({ q: s.month, kind: "event", text: `Motivated seller: ${rec.address} hits the tape at $${(ask / 1e6).toFixed(2)}M — well under appraisal. It won't last.` });
    }
  }
}

export function advanceQuarter(
  prev: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null = null,
): GameState {
  if (prev.gameOver) return prev;
  const s: GameState = JSON.parse(JSON.stringify(prev));
  s.month++;

  tickEcon(s);
  // The neighbourhood settles before anyone acts on it: last month's
  // deliveries and lettings are now standing, so the city, the tenants and
  // the appraisers all read the same block this month.
  tickDemand(s, parcels);
  tickLenders(s);
  tickWorkouts(s, parcels);
  tickPortfolio(s, parcels);
  tickFirm(s, parcels);
  tickRivals(s, parcels);
  // The mortgage record reconciles against the street the moment the street
  // has finished moving, so the statement the note desk sells out of below is
  // never a month stale.
  tickLedger(s, parcels);
  // The county's calendar: notices of sale on the street, the July docket,
  // and the August hammer. It reads the street the banks have just had, and
  // it must settle BEFORE the note desk services anything it just resolved.
  tickAuction(s, parcels);
  // The paper desk reads the month the banks and the street have just had:
  // whose capital ratio broke, who stopped leasing, whose building sold out
  // from under whose mortgage. It cannot run before either of them.
  tickNotes(s, parcels);
  maybeSellYourLoan(s, parcels);
  tickPlanning(s, parcels, bbls);
  tickCityGrowth(s, parcels, bbls, adjacency);
  tickDevelopments(s, parcels);
  tickConstructionLeasing(s, parcels);
  tickPrograms(s, parcels);
  tickLeasing(s, parcels);
  tickGroundLeases(s, parcels);
  tickSales(s, parcels, adjacency);
  tickBrokerCalls(s, parcels, bbls);
  tickListingAbsorption(s, parcels); // other buyers work the tape too
  tickTalks(s, parcels);             // a negotiation left open goes stale

  // the 1031 clock: redeploy in time or the deferred tax comes due
  if (s.exchange && s.month > s.exchange.deadlineM) {
    s.cash -= s.exchange.deferredTax;
    s.taxesPaid = (s.taxesPaid ?? 0) + s.exchange.deferredTax;
    logBooks(s, "taxes", s.exchange.deferredTax);
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `The 1031 clock ran out — $${(s.exchange.deferredTax / 1e6).toFixed(2)}M of deferred capital-gains tax comes due.`,
    });
    s.exchange = null;
  }

  // holdings: collect NOI, run the debt stack, finish renovations
  let monthCF = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    if (h.renovatingUntilM !== undefined && s.month >= h.renovatingUntilM) {
      h.condition = "good";
      h.lastCapM = s.month;
      delete h.renovatingUntilM;
      s.news.unshift({ q: s.month, kind: "deal", text: `Renovation complete at ${rec.address} — space re-opens at the new rent.` });
    }
    const noiQ = monthlyNOI(rec, s.econ, h, s.month);
    const debtCash = tickLoan(s, rec, h, noiQ); // may refi, sweep, or force a sale
    logBooks(s, "noi", noiQ);
    logBooks(s, "debtSvc", debtCash);
    if (!s.holdings[h.bbl]) continue; // forced sale removed it
    const cf = noiQ - debtCash;
    h.cfHistory.push(Math.round(cf));
    if (h.cfHistory.length > 40) h.cfHistory.shift();
    monthCF += cf;
  }
  s.cash += monthCF;

  // --- the firm's own overhead ----------------------------------------------
  // Every cost in this game so far has been charged to a building. Real
  // operators also carry themselves: asset management, accounting, audit,
  // legal, the insurance programme, someone to answer the phone. It is not
  // billable to a property and it does not scale one-for-one with the
  // portfolio — the tenth building is cheaper to run than the first — but it
  // never goes away, and it is why an owner of two hundred assets does not
  // simply earn a hundred times the owner of two.
  //
  // Without it a century of accumulation was a free escalator; the sub-linear
  // exponent is what keeps scale worth having while still costing something.
  {
    // Charged against what you are RESPONSIBLE for, not how many doors you
    // have: a firm running fifty million needs one analyst, a firm running
    // five billion needs a department, and the second is cheaper per dollar.
    // A per-asset charge looked reasonable and was not — it billed a small
    // operator more overhead than their building earned in NOI.
    // AND IT IS CHARGED WHETHER OR NOT YOU OWN ANYTHING. This was gated on
    // holding something, so a firm that sold its book and sat on the cash paid
    // no overhead at all and compounded at the deposit rate for as long as it
    // liked — measured at $6M to $9.9M over fifty years with nothing deducted.
    // The fixed base is small and it never goes away, which is the point: an
    // office with no buildings in it is a cost, not a strategy.
    {
      let gav = 0;
      for (const h of Object.values(s.holdings)) {
        const rec = resolveRec(parcels, s, h.bbl);
        if (rec) gav += holdingValue(rec, s.econ, h, s.month);
      }
      for (const d of Object.values(s.developments ?? {})) gav += d.costTotal;
      // ~30bps of gross asset value a year at scale, over a small fixed base
      const annual = 60_000 * s.econ.costIdx + 0.0028 * gav;
      const ga = Math.round(annual / 12);
      s.cash -= ga;
      logBooks(s, "ga", ga);
    }
  }

  // THE PLAN THAT IS NOT BEING FUNDED. The capital plan stops on its own when
  // the money is short, which is correct and is also the least visible thing in
  // the game: buildings quietly start sliding and nothing says why. Once a year,
  // and only when it is really happening.
  if (s.month % 12 === 6) {
    const cut = Object.values(s.holdings).filter((h) => h.planCutM !== undefined && s.month - h.planCutM <= 12).length;
    if (cut > 0) {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The capital plan went unfunded on ${cut} building${cut > 1 ? "s" : ""} this year. Deferred maintenance is the cheapest money you will ever borrow and the dearest you will ever repay — those assets are ageing faster than the rest of the book.`,
      });
    }
  }

  // Idle balances sit in a bank account and earn what a bank account earns.
  //
  // This used to float two and a half points under the loan index, which made
  // the deposit rate a macro position: in a high-rate decade doing nothing
  // compounded at five per cent and competed with underwriting buildings. It is
  // a flat one per cent now and it is deliberately dull — cash is where you
  // stand between decisions, not a strategy. It is also booked to its own line
  // rather than into NOI, because bank interest is not property income and
  // dressing it as such flattered every yield on the Books page.
  if (s.cash > 0) {
    const interest = Math.round((s.cash * CASH_APY) / 12);
    if (interest > 0) { s.cash += interest; logBooks(s, "interest", interest); }
  }

  // EXPIRE STALE OFF-MARKET ASKS — on time, and on price.
  //
  // A number holds for six months and the record for twelve. What it does not
  // do is survive the ground underneath it being repriced: an owner who quoted
  // you a figure and then watched their district get upzoned reads the news
  // like everybody else, and the old number is gone. Without this the quote was
  // a free option on a rezoning, and the ask could drift to a fraction of the
  // appraisal beside it — which is exactly what it looked like from the panel.
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (s.month > a.q + 12) { delete s.approaches[bbl]; continue; }
    if (a.refused || !a.ask) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const v = assetValue(rec, s.econ, gradeOf(s, rec));
    if (v > 0 && a.ask < v * 0.85) {
      delete s.approaches[bbl];
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${rec.address}: the owner has withdrawn their number. The ground has moved since they gave it to you.`,
      });
    }
  }

  // January: the assessor and the taxman make their rounds
  if (s.month % 12 === 0 && s.month > 0) {
    let taxable = 0;
    for (const h of Object.values(s.holdings)) {
      const rec = resolveRec(parcels, s, h.bbl);
      if (!rec) continue;
      // phased reassessment: assessed value closes a quarter of the gap to market
      // THE ASSESSOR RATCHETS. This closed a quarter of the gap in both
      // directions, which is not how a tax roll behaves anywhere on earth: an
      // assessment chases a rising market almost at once and comes down
      // grudgingly, over years, and only if somebody files and wins. That
      // asymmetry is most of what makes a downturn expensive for an owner with
      // no debt — the mortgage is the levered owner's problem, and a 1.1% bill
      // on a value that no longer exists is everybody's.
      const v = holdingValue(rec, s.econ, h, s.month);
      const prior = h.assessed ?? h.costBasis;
      h.assessed = Math.round(prior + (v > prior ? 0.32 : 0.09) * (v - prior));
      // taxable income: NOI less interest less straight-line depreciation
      // (2.6%/yr on the 80% of basis that's improvements, not land)
      const noi = rec.class === "land" ? 0 : holdingNOIYr(rec, s.econ, h, s.month);
      const interest = h.loan ? (h.loan.balance * h.loan.ratePct) / 100 : 0;
      // Straight-line over the statutory life, on the IMPROVEMENTS only —
      // land is never depreciable. Residential rental property runs 27.5
      // years and everything else 39, which is why an apartment building
      // shelters materially more income than an office block of the same
      // price, and why the recapture bill on the way out is larger too.
      const improvements = h.costBasis * 0.8;
      const life = rec.class === "multifamily" ? 27.5 : 39;
      const deprCapacity = improvements - (h.deprTaken ?? 0);
      const depr = rec.class === "land" ? 0 : Math.max(0, Math.min(improvements / life, deprCapacity));
      h.deprTaken = (h.deprTaken ?? 0) + depr;
      taxable += noi - interest - depr; // losses net against gains across the portfolio
    }
    const tax = Math.round(Math.max(0, taxable) * 0.25);
    if (tax > 1000) {
      s.cash -= tax;
      s.taxesPaid = (s.taxesPaid ?? 0) + tax;
      logBooks(s, "taxes", tax);
      s.news.unshift({ q: s.month, kind: "info", text: `Tax season: $${(tax / 1e6).toFixed(2)}M due on last year's portfolio income (after interest and depreciation).` });
    }
  }

  // insolvency: after a year underwater the creditors don't end you — they
  // start taking things. One asset a month, sold at a 15% haircut, until the
  // balance is square. You only lose when there's nothing left to take.
  if (s.cash < 0) {
    s.insolventMs++;
    if (s.insolventMs === 6) {
      s.news.unshift({ q: s.month, kind: "warn", text: "Your lenders have noticed the negative balance. Six more months of this and they start seizing assets." });
    }
    if (s.insolventMs >= 12) {
      // A FILE ON THE DESK OUTRANKS THE BAILIFF.
      //
      // This seizure path predates the workout desk and ran alongside it: a
      // building could be three months into a foreclosure you were actively
      // negotiating and get taken by the general creditors instead, deleting
      // the file mid-conversation. Anything already in workout is spoken for —
      // that lender has a lien and a process, and the unsecured creditors
      // queue behind both.
      const owned = Object.values(s.holdings)
        .filter((h) => !s.developments[h.bbl] && !s.workouts?.[h.bbl]);
      if (owned.length) {
        // creditors take the most valuable thing you own
        let pick = owned[0], pickV = -Infinity;
        for (const h of owned) {
          const rec = resolveRec(parcels, s, h.bbl);
          const v = rec ? holdingValue(rec, s.econ, h, s.month) : 0;
          if (v > pickV) { pickV = v; pick = h; }
        }
        const rec = resolveRec(parcels, s, pick.bbl)!;
        // Creditors liquidating a distressed borrower get the distressed bid,
        // not a polite 15% off — and every seizure goes on the sponsor's record.
        const gross = Math.round(pickV * Math.min(0.85, distressPrice(s)));
        // A SEIZURE IS STILL A SALE, AND A SALE HAS A WATERFALL.
        //
        // The whole gross used to land in the account. Measured on a
        // free-and-clear $15.50M building with the clock at twelve months, that
        // moved the balance from -$5.00M to +$8.03M in a single tick — 84.1% of
        // appraisal, in cash, for a deed the creditors had just carried off,
        // with no commission, no transfer stamps, no legal and no tax on the
        // gain. It made the exit you did not choose cheaper than the one you
        // did, and on an unlevered building it read to the player exactly as it
        // was: the game taking the property and paying appraisal for it.
        //
        // The order is the real one. The referee, the broker and the county are
        // paid off the top, the mortgage is a lien and takes what is left
        // before anybody else, and only the surplus after all of that reaches
        // the borrower — which on anything levered is nothing. What the sale
        // does not cover does not evaporate either: it is the lender's loss on
        // non-recourse paper and yours on paper you signed for.
        const { net, tax } = saleTaxQuote(pick, gross);
        const lien = pick.loan?.balance ?? 0;
        const breakFee = pick.loan ? prepayPenalty(pick.loan, s.month) : 0;
        const proceeds = Math.max(0, net - lien - breakFee);
        const shortfall = Math.max(0, lien + breakFee - net);
        s.cash += proceeds;
        logBooks(s, "sold", proceeds);
        // A forced disposition is a taxable one. The bill on a gain you never
        // saw in cash is the thing that finishes a distressed sponsor, and it
        // is the reason handing back the keys beats being levied.
        if (tax > 0) {
          s.cash -= tax;
          s.taxesPaid = (s.taxesPaid ?? 0) + tax;
          logBooks(s, "taxes", tax);
        }
        if (shortfall > 0 && pick.loan) {
          if (pick.loan.recourse) { s.cash -= shortfall; logBooks(s, "debtSvc", shortfall); }
          else chargeLenderLoss(s, pick.loan.holder ?? productById(pick.loan.product).lender, shortfall);
        }
        recordComp(s, rec, gross, "a distressed buyer", firmShort(s), true, pick.condition);
        s.exits.push({ bbl: pick.bbl, address: rec.address, boughtM: pick.boughtM, soldM: s.month, price: gross, basis: pick.costBasis, gain: gross - pick.costBasis, forced: true });
        if (s.groundLeases?.[pick.bbl]) delete s.groundLeases[pick.bbl];
        s.cash -= depositsOn(s.holdings[pick.bbl]);   // the deposits go with the deed
        s.lastTradeM = s.lastTradeM ?? {};
        s.lastTradeM[pick.bbl] = s.month;
        delete s.holdings[pick.bbl];
        if (s.workouts?.[pick.bbl]) delete s.workouts[pick.bbl];
        markSponsor(s, shortfall > 0 && pick.loan?.recourse ? "deficiency" : "seized", rec.address, shortfall);
        s.lois = s.lois.filter((l) => l.bbl !== pick.bbl);
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `The creditors took ${rec.address} — sold at $${(gross / 1e6).toFixed(2)}M, ${(100 * (1 - gross / Math.max(1, pickV))).toFixed(0)}% under the mark. `
            + (lien > 0
              ? shortfall > 0
                ? `It did not cover the $${(lien / 1e6).toFixed(2)}M mortgage${pick.loan?.recourse ? `, and you signed for the $${(shortfall / 1e6).toFixed(2)}M shortfall` : `, and the paper was non-recourse`}. `
                : `The mortgage was paid off the top and $${(proceeds / 1e6).toFixed(2)}M of surplus reached you. `
              : `$${(proceeds / 1e6).toFixed(2)}M reached you after the costs of the sale${tax > 0 ? ` and $${(tax / 1e6).toFixed(2)}M of tax on the gain` : ``}. `)
            + `${s.cash < 0 ? "They're not done." : "The balance is square, barely."}`,
        });
        s.insolventMs = 8; // still on the hook until cash goes positive
      } else {
        s.gameOver = {
          cause: "Insolvency: the creditors took everything, and it wasn't enough. A hundred-year town remembers a bankruptcy.",
        };
        s.news.unshift({ q: s.month, kind: "warn", text: "The run is over — the creditors own it now." });
      }
    }
  } else {
    s.insolventMs = 0;
  }

  tickLoc(s, parcels);   // interest, sweeps, and the safety draw

  // the record book
  const nw = netWorth(s, parcels);
  s.nwHistory.push(Math.round(nw));
  checkMilestones(s, nw);

  // THE QUIET DESK — how long since anybody was at the door.
  //
  // Measured over six fifty-year runs of competent play: 69.8% of months had
  // NOTHING new arrive, the first decade ran at 87%, and the longest silence
  // was 41 consecutive months. The cause is structural and it is one sentence:
  // every inbound channel in this engine is gated on the SIZE of your book.
  // LOIs need vacancy you own, offers need buildings you own, balloons need
  // loans you took. A player with two buildings gets two buildings' worth of
  // post, forever, and the front of the game is a solitaire played against a
  // listings tape that never talks back.
  //
  // So one channel gets gated on the opposite — see tickBrokerCalls. This is
  // what it reads. It counts a letter, an offer, a bid list, an off-market
  // call and a live negotiation, and nothing else: a covenant breach is a
  // condition of your own balance sheet, not a person with a file waiting for
  // an answer, and a broker deciding whose afternoon is free does not consult
  // your loan documents.
  {
    // A LETTER GOES STALE. The tour puts one to three letters on the desk at
    // once and they sit there until they expire, so counting every standing
    // letter made the desk read as busy for the whole time a single unanswered
    // choice was open — and the floor below, which exists precisely to break a
    // drought, switched itself off for the duration. Somebody at the door is
    // somebody who arrived recently. After that they are furniture.
    const atDoor = s.lois.filter((l) => s.month - (l.arrivedM ?? s.month) <= 1).length
      + Object.values(s.holdings).filter((h) => h.sale?.offer || h.sale?.bids?.length).length
      + Object.values(s.approaches).filter((a) => a.inbound && !a.refused && a.ask).length
      + Object.keys(s.talks ?? {}).length;
    s.quietMs = atDoor ? 0 : (s.quietMs ?? 0) + 1;
  }

  // The century is a marker you pass, not the end of the game. It used to set
  // gameOver and stop the run cold.
  if (!s.milestones.century && s.month >= CENTURY_MONTHS) {
    s.milestones.century = s.month;
    const built = Math.round((100 * (s.builtAtStart + Object.keys(s.built).length)) / Math.max(1, s.totalLots));
    s.news.unshift({
      q: s.month, kind: "event",
      text: `◆ A hundred years. The place you arrived in was two-fifths empty lots; ${built}% of it stands built today, and ${Object.keys(s.holdings).length} of those buildings are yours. The clock keeps running.`,
    });
  }

  refreshListings(s, parcels, bbls);
  if (s.news.length > 120) s.news.length = 120;

  // A deed that left the book takes
  // its encumbrances with it. A creditor can seize land out from under a lease
  // at any point in the month, and the ledger has to agree by the end of it.
  for (const bbl of Object.keys(s.groundLeases ?? {})) {
    if (!s.holdings[bbl]) delete s.groundLeases![bbl];
  }
  for (const [child, parent] of Object.entries(s.merged ?? {})) {
    if (s.holdings[child] && s.holdings[parent]) continue;
    delete s.merged![child];
    delete s.holdings[child];
  }
  // The same for a workout file. A deed that left the book by any route takes
  // its default with it — a file on a building you no longer own would
  // otherwise sit there and eventually foreclose on somebody else's property.
  for (const bbl of Object.keys(s.workouts ?? {})) {
    if (!s.holdings[bbl]?.loan) delete s.workouts![bbl];
  }

  return s;
}

// ---- milestones: the century needs chapter markers -------------------------
export const MILESTONES: { id: string; label: string; test: (s: GameState, nw: number) => boolean }[] = [
  { id: "deed1", label: "First deed recorded", test: (s) => Object.keys(s.holdings).length + s.exits.length >= 1 },
  { id: "lease1", label: "First lease signed", test: (s) => Object.values(s.holdings).some((h) => h.tenants.some((t) => t.startM > h.boughtM)) },
  { id: "tower1", label: "First development delivered", test: (s) => Object.keys(s.built).some((b) => !s.cityBuilt.includes(b)) },
  { id: "exit1", label: "First profitable exit", test: (s) => s.exits.some((e) => !e.forced && e.gain > 0) },
  { id: "nw25", label: "Net worth $25M", test: (_s, nw) => nw >= 25e6 },
  { id: "nw100", label: "Net worth $100M", test: (_s, nw) => nw >= 100e6 },
  { id: "nw500", label: "Net worth $500M", test: (_s, nw) => nw >= 500e6 },
  { id: "nw1b", label: "The billion-dollar book", test: (_s, nw) => nw >= 1e9 },
  { id: "ten", label: "Ten buildings under management", test: (s) => Object.keys(s.holdings).length >= 10 },
  { id: "twentyfive", label: "A quarter-hundred holdings", test: (s) => Object.keys(s.holdings).length >= 25 },
  { id: "half", label: "Fifty years in town", test: (s) => s.month >= 600 },
  // PAST THE HALF CENTURY.
  //
  // The ladder used to stop here: eleven rungs, the last of them at month 600,
  // in a campaign that starts in January 2000 and has no end date. Everything
  // after year fifty was unmarked — which is a strange thing to do to the back
  // half of a hundred-year game and a stranger one when the game does not stop
  // at a hundred either.
  //
  // These are deliberately not all about the number at the bottom of the page.
  // A big book is one way to matter; owning a recognisable share of the city,
  // or having built a quarter-hundred of the buildings standing in it, is
  // another, and it is the one a hundred-year town would actually remember.
  { id: "nw5b", label: "Five billion under management", test: (_s, nw) => nw >= 5e9 },
  { id: "fifty", label: "Fifty buildings under management", test: (s) => Object.keys(s.holdings).length >= 50 },
  { id: "hundred", label: "A hundred deeds recorded", test: (s) => Object.keys(s.holdings).length + s.exits.length >= 100 },
  { id: "builder", label: "Twenty-five buildings of your own making", test: (s) => (s.delivered ?? 0) >= 25 },
  { id: "share", label: "A twentieth of the city's built stock", test: (s) =>
      Object.keys(s.holdings).length >= Math.max(12, 0.05 * (s.builtAtStart + Object.keys(s.built).length)) },
  { id: "diamond", label: "Seventy-five years in town", test: (s) => s.month >= 900 },
  { id: "sesqui", label: "A hundred and fifty years in town", test: (s) => s.month >= 1800 },
  { id: "bicent", label: "Two centuries in town", test: (s) => s.month >= 2400 },
];

function checkMilestones(s: GameState, nw: number) {
  for (const m of MILESTONES) {
    if (s.milestones[m.id] === undefined && m.test(s, nw)) {
      s.milestones[m.id] = s.month;
      s.news.unshift({ q: s.month, kind: "event", text: `◆ Milestone: ${m.label}.` });
    }
  }
}

// ---- attention: what needs the player right now ----------------------------
// Auto-advance stops when a NEW item appears on this list.
export function attentionItems(s: GameState): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const l of s.lois) out.push({ key: `loi:${l.id}`, label: `LOI from ${l.name} — answer by ${monthLabel(l.expiresM)}` });
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (a.inbound && !a.refused && a.ask) out.push({ key: `broker:${bbl}`, label: "A broker has something off-market for you" });
  }
  for (const h of Object.values(s.holdings)) {
    if (h.sale?.offer) out.push({ key: `offer:${h.bbl}:${h.sale.offer.price}`, label: `Offer in hand — good until ${monthLabel(h.sale.offer.expiresM)}` });
    if (h.loan && h.loan.maturityM - s.month <= 3 && h.loan.maturityM > s.month) {
      out.push({ key: `balloon:${h.bbl}`, label: `Balloon due ${monthLabel(h.loan.maturityM)}` });
    }
    if (h.loan?.sweep) out.push({ key: `sweep:${h.bbl}`, label: "Covenant breach — cash flow swept" });
  }
  // A counter on the table is the definition of something needing you — and an
  // unfunded contract is the same thing with a deadline attached.
  // Every conversation gets its own line. Four deals on the table is four
  // things needing you, and rolling them into one would hide the whole point
  // of being allowed to run four.
  for (const t of Object.values(s.talks ?? {})) {
    out.push(t.agreed
      ? {
        key: `contract:${t.bbl}`,
        label: `Under contract at $${((t.agreedPrice ?? t.theirPrice) / 1e6).toFixed(2)}M — fund it by ${monthLabel(t.closeByM ?? s.month)}`,
      }
      : {
        key: `talks:${t.bbl}:${t.theirPrice}`,
        label: `${t.sellerName} is at $${(t.theirPrice / 1e6).toFixed(2)}M${t.final ? " — their final word" : ""}`,
      });
  }
  if (s.exchange && s.exchange.deadlineM - s.month <= 2) {
    out.push({ key: "exchange", label: `1031 clock: ${monthLabel(s.exchange.deadlineM)} deadline` });
  }
  for (const o of s.noteOffers ?? []) {
    out.push({ key: `note:${o.id}`, label: `${o.lender} is selling the ${o.address} loan — ${(100 * o.askPct).toFixed(0)} cents` });
  }
  // A note tells you it has stopped paying ONCE. The key carries the month it
  // told you, so it can never stop the clock a second time.
  for (const n of s.notes ?? []) {
    if (n.perf === "nonperforming" && n.filedM === undefined && n.toldM !== undefined) {
      out.push({ key: `npl:${n.id}:${n.toldM}`, label: `${n.obligor} has stopped paying on ${n.address}` });
    }
  }
  if (s.cash < 0) out.push({ key: "cash", label: "Cash is negative" });
  for (const [id] of Object.entries(s.milestones)) {
    if (s.milestones[id] === s.month) out.push({ key: `mile:${id}`, label: "Milestone reached" });
  }
  if (s.gameOver) out.push({ key: "over", label: "The run is over" });
  return out;
}

// Run up to `cap` months, stopping when something new needs the player.
// Returns the state plus why it stopped — the UI toasts the reason.
export function advanceUntilAttention(
  s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null, cap: number,
): { s: GameState; months: number; reason: string | null } {
  const before = new Set(attentionItems(s).map((a) => a.key));
  let cur = s;
  for (let i = 1; i <= cap; i++) {
    cur = advanceQuarter(cur, parcels, bbls, adjacency);
    const now = attentionItems(cur);
    const fresh = now.find((a) => !before.has(a.key));
    if (fresh) return { s: cur, months: i, reason: fresh.label };
    if (cur.gameOver) return { s: cur, months: i, reason: null };
  }
  return { s: cur, months: cap, reason: null };
}

// Convenience for the UI: total quarterly cash flow at current state.
export function portfolioQuarterlyCF(s: GameState, parcels: ParcelTable): number {
  let cf = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    cf += monthlyNOI(rec, s.econ, h, s.month) - (h.loan?.monthlyPmt ?? 0);
  }
  for (const d of Object.values(s.developments ?? {})) {
    cf -= (d.loanBalance * d.ratePct) / 100 / 12; // construction interest
  }
  return cf;
}

export function firstListings(s: GameState, parcels: ParcelTable, bbls: string[]): GameState {
  const next = JSON.parse(JSON.stringify(s)) as GameState;
  refreshListings(next, parcels, bbls);
  return next;
}

export type { ParcelRecord };
