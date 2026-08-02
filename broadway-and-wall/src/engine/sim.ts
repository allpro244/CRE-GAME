// newGame + advanceQuarter — the pure heart of the game. No DOM, no store:
// (state, parcels) in, state out. The UI is a lens on this.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState, Listing } from "./types";
import { START_CASH, CENTURY_MONTHS, logBooks, monthLabel } from "./types";
import { initEcon, rng, rrange, tickEcon } from "./market";
import { assetValue, holdingNOIYr, holdingValue, initialCondition, monthlyNOI, netWorth, resolveRec } from "./value";
import { tickLeasing } from "./leasing";
import { tickSales, tickListingAbsorption, tickBrokerCalls, tickLatent } from "./actions";
import { tickEscrow } from "./acquire";
import { tickLoan } from "./debt";
import { distressPrice, markSponsor } from "./sponsor";
import { tickLoc } from "./credit";
import { tickDevelopments, tickPrograms, tickCityGrowth, tickConstructionLeasing } from "./dev";
import { tickDemand } from "./demand";
import { initRivals, tickRivals } from "./rivals";

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
    v: 19,
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
    sponsor: { events: [] },
    rivals: [],
    escrow: null,
    lenderRel: {},
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
  s.econ = initEcon(s);
  if (parcels) s.rivals = initRivals(s, parcels, Object.keys(parcels));
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
  // stale listings reprice down until the market clears them
  for (const li of s.listings) {
    if (s.month - li.listedM >= 4) li.ask = Math.round(li.ask * 0.985 / 1000) * 1000;
  }
  s.listings = s.listings.filter((l) => l.expiresM > s.month && !s.holdings[l.bbl]);
  const listed = new Set(s.listings.map((l) => l.bbl));
  const target = targetListings(s, bbls.length);
  const pDistress = s.econ.phase === "recession" ? 0.42 : s.econ.phase === "recovery" ? 0.18 : 0.03;
  let guard = 0;
  while (s.listings.length < target && guard++ < 4000) {
    const bbl = bbls[Math.floor(rng(s) * bbls.length)];
    if (listed.has(bbl) || s.holdings[bbl]) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const value = assetValue(rec, s.econ, initialCondition(rec));
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
  tickRivals(s, parcels);
  tickCityGrowth(s, parcels, bbls, adjacency);
  tickDevelopments(s, parcels);
  tickConstructionLeasing(s, parcels);
  tickPrograms(s, parcels);
  tickLeasing(s, parcels);
  tickSales(s, parcels);
  tickBrokerCalls(s, parcels, bbls);
  tickListingAbsorption(s, parcels); // other buyers work the tape too
  tickEscrow(s, parcels);            // diligence reports back
  tickLatent(s, parcels);            // and what nobody looked for arrives

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
    const n = Object.keys(s.holdings).length + Object.keys(s.developments ?? {}).length;
    if (n > 0) {
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

  // Idle balances sit in the money market, not in a drawer. Short paper yields
  // under the loan index; the gap between what cash earns and what buildings
  // earn is the opportunity cost of being slow, and it should be visible
  // rather than assumed.
  if (s.cash > 0) {
    // The short rate, not the mortgage index. Twenty years of doing nothing was
    // turning $6M into $15M — a 4.9% compounded return for holding cash, which
    // is within a few points of what taking every risk in the business paid.
    // Short paper roughly matches inflation and no more; the whole point of
    // owning buildings is that cash does not keep up.
    const tbill = Math.max(0, s.econ.indexRate - 2.4);
    const interest = Math.round((s.cash * tbill) / 100 / 12);
    if (interest > 0) { s.cash += interest; logBooks(s, "noi", interest); }
  }

  // expire stale off-market asks
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (s.month > a.q + 12) delete s.approaches[bbl];
  }

  // January: the assessor and the taxman make their rounds
  if (s.month % 12 === 0 && s.month > 0) {
    let taxable = 0;
    for (const h of Object.values(s.holdings)) {
      const rec = resolveRec(parcels, s, h.bbl);
      if (!rec) continue;
      // phased reassessment: assessed value closes a quarter of the gap to market
      const v = holdingValue(rec, s.econ, h, s.month);
      const prior = h.assessed ?? h.costBasis;
      h.assessed = Math.round(prior + 0.25 * (v - prior));
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
      const owned = Object.values(s.holdings).filter((h) => !s.developments[h.bbl]);
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
        const proceeds = Math.max(0, gross - (pick.loan?.balance ?? 0));
        s.cash += proceeds;
        logBooks(s, "sold", proceeds);
        s.exits.push({ bbl: pick.bbl, address: rec.address, boughtM: pick.boughtM, soldM: s.month, price: gross, basis: pick.costBasis, gain: gross - pick.costBasis, forced: true });
        delete s.holdings[pick.bbl];
        markSponsor(s, "seized", rec.address, Math.max(0, (pick.loan?.balance ?? 0) - gross));
        s.lois = s.lois.filter((l) => l.bbl !== pick.bbl);
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `The creditors took ${rec.address} — sold at $${(gross / 1e6).toFixed(2)}M, ${(100 * (1 - gross / Math.max(1, pickV))).toFixed(0)}% under the mark. ${s.cash < 0 ? "They're not done." : "The balance is square, barely."}`,
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
  // A counter on the table is the definition of something needing you.
  if (s.talks) {
    out.push({
      key: `talks:${s.talks.bbl}:${s.talks.theirPrice}`,
      label: `${s.talks.sellerName} is at $${(s.talks.theirPrice / 1e6).toFixed(2)}M${s.talks.final ? " — their final word" : ""}`,
    });
  }
  if (s.exchange && s.exchange.deadlineM - s.month <= 2) {
    out.push({ key: "exchange", label: `1031 clock: ${monthLabel(s.exchange.deadlineM)} deadline` });
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
