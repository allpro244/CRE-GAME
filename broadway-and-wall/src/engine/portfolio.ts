// SELLING MORE THAN ONE BUILDING AT A TIME.
//
// Everything on this desk has been a one-asset business: one sign, one run,
// one buyer, one closing. That is how a broker sells a building and it is not
// how anybody exits a book. The two transactions that actually move real
// estate at scale are the portfolio trade and the entity trade, and both work
// on a principle that is almost the opposite of a single sale:
//
//   YOU ARE NOT SELLING THE AVERAGE. YOU ARE SELLING THE WORST ONE.
//
// A bundle prices off its weakest member, because the buyer is being made to
// take the half-empty office to get the two stabilised apartment blocks, and
// they will price that risk rather than accept it. Which is exactly why
// sellers bundle: it is the only way the half-empty office ever trades at all.
// The premium for scale is real but small — an institution will pay a couple
// of points for size, homogeneity and one management platform. The discount
// for a mixed bag is much larger than the premium, and the discount for size
// itself past a certain cheque is larger still, because in a city this size
// there are perhaps four buyers who can write it.
//
// So the decision this creates is a genuine one and it is not obvious: sell
// them one at a time and take three years and the best price on each, or
// clear the whole position in a quarter and pay for the privilege. In a
// falling market the second one is right, and it stops being right about six
// months after everybody has worked that out.
import type { ParcelTable } from "@/data/types";
import type { GameState, Holding } from "./types";
import { logBooks, monthLabel } from "./types";
import { rng, rrange } from "./market";
import { holdingValue, resolveRec } from "./value";
import { depositsOn } from "./leasing";
import { useSf } from "./mix";
import { prepayPenalty } from "./debt";
import { recordComp } from "./comps";
import { saleTaxQuote, EXCHANGE_WINDOW_M } from "./actions";
import { sponsorStanding } from "./sponsor";

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** How full a building physically is, counting flats and commercial together. */
function occOf(rec: { bldgArea: number }, h: Holding): number {
  if (!rec.bldgArea) return 0;
  const comm = h.tenants.reduce((a, t) => a + t.sf, 0);
  const res = useSf(rec as never, "multifamily") * (h.occ ?? 0);
  return Math.min(1, (comm + res) / rec.bldgArea);
}
const money = (n: number) =>
  Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;

/** How long a portfolio stays on the market before the process goes stale. */
const RUN_M = 9;

/** The desks that write institutional cheques in this town. */
const BUYERS = [
  { name: "Hollis Sterling Partners", min: 12_000_000, patience: 0.98 },
  { name: "Marchpane Institutional", min: 30_000_000, patience: 1.02 },
  { name: "The Ashgrove Trust", min: 8_000_000, patience: 0.95 },
  { name: "Kestrel Core Fund", min: 45_000_000, patience: 1.04 },
  { name: "Bellwether Opportunity", min: 6_000_000, patience: 0.88 },
];

export interface PortfolioQuote {
  /** What the buildings are worth one at a time, added up. */
  sumOfParts: number;
  /** What a bundle of exactly these buildings is worth. */
  indicative: number;
  /** indicative ÷ sumOfParts − 1. Usually negative, and that is the point. */
  spreadPct: number;
  /** Every adjustment, in the words a broker would use. */
  why: { label: string; pct: number }[];
  /** Roughly how many buyers in this city can write this cheque. */
  depth: number;
  count: number;
}

/**
 * WHAT A BUNDLE IS WORTH, and why it is not the sum of the parts.
 *
 * Each term below is a real thing an acquisitions committee does to a rent
 * roll, and every one of them is readable in the UI before you commit, because
 * a discount you cannot see coming is a punishment rather than a decision.
 */
export function portfolioQuote(s: GameState, parcels: ParcelTable, bbls: string[]): PortfolioQuote {
  const rows = bbls
    .map((b) => ({ bbl: b, h: s.holdings[b], rec: resolveRec(parcels, s, b) }))
    .filter((r) => r.h && r.rec) as { bbl: string; h: Holding; rec: NonNullable<ReturnType<typeof resolveRec>> }[];
  const vals = rows.map((r) => holdingValue(r.rec, s.econ, r.h, s.month));
  const sumOfParts = Math.round(vals.reduce((a, v) => a + v, 0));
  const why: { label: string; pct: number }[] = [];
  if (!rows.length || sumOfParts <= 0) {
    return { sumOfParts: 0, indicative: 0, spreadPct: 0, why, depth: 0, count: 0 };
  }

  // --- scale ---------------------------------------------------------------
  // An institution pays a little for size: one diligence, one closing, one
  // property-management contract instead of nine. It is worth two or three
  // points and no more, and it is the only term here that is ever positive.
  const scale = Math.min(0.035, 0.006 * Math.log2(Math.max(2, rows.length)) + Math.min(0.018, sumOfParts / 4e9));
  if (rows.length > 1) why.push({ label: `Scale — one diligence, one closing, ${rows.length} deeds`, pct: scale });

  // --- homogeneity ---------------------------------------------------------
  // A clean single-class portfolio in one submarket underwrites itself. A
  // scattered mixed bag is nine separate underwritings sold as one, and the
  // buyer charges for every one of them.
  const byClass = new Map<string, number>();
  const byDistrict = new Map<string, number>();
  rows.forEach((r, i) => {
    const k = r.rec.class;
    byClass.set(k, (byClass.get(k) ?? 0) + vals[i]);
    const d = r.rec.district ?? "?";
    byDistrict.set(d, (byDistrict.get(d) ?? 0) + vals[i]);
  });
  const topClass = Math.max(...byClass.values()) / sumOfParts;
  const topDist = Math.max(...byDistrict.values()) / sumOfParts;
  // 100% one class is clean; a four-way split is a car boot sale
  const mixed = -(1 - topClass) * 0.075 - (1 - topDist) * 0.03;
  if (mixed < -0.002) {
    why.push({
      label: topClass < 0.6
        ? `Mixed asset classes — ${byClass.size} of them, no majority`
        : `Not quite one story — ${(topClass * 100).toFixed(0)}% ${[...byClass.entries()].sort((a, b) => b[1] - a[1])[0][0]}, ${byDistrict.size} districts`,
      pct: mixed,
    });
  }

  // --- THE WEAKEST MEMBER --------------------------------------------------
  // The whole reason a portfolio trade exists. The buyer underwrites the
  // problems, not the average, and the more of the value that sits in a
  // half-empty or tired building the harder the blend gets marked. This is
  // simultaneously why you bundle — that building has no bid on its own — and
  // why it costs you on the ones that did.
  let weak = 0;
  rows.forEach((r, i) => {
    const built = r.rec.class !== "land" && r.rec.bldgArea > 0;
    const occ = built ? occOf(r.rec, r.h) : 1;
    const share = vals[i] / sumOfParts;
    let d = 0;
    if (built && occ < 0.82) d += (0.82 - occ) * 0.42;
    if (r.h.condition === "standard") d += 0.03;
    if (r.h.condition === "worn") d += 0.09;
    if (!built) d += 0.06;                       // dirt in an income portfolio is a rounding error nobody wants
    weak += share * d;
  });
  if (weak > 0.002) {
    why.push({ label: "Underwritten off the weakest buildings, not the average", pct: -weak });
  }

  // --- who can actually write this cheque ----------------------------------
  const depth = BUYERS.filter((b) => sumOfParts >= b.min).length
    - (sumOfParts > 200_000_000 ? 2 : sumOfParts > 90_000_000 ? 1 : 0);
  const thin = depth <= 1 ? -0.06 : depth === 2 ? -0.025 : 0;
  if (thin < 0) why.push({ label: `Thin bidder pool — ${Math.max(1, depth)} buyer${depth === 1 ? "" : "s"} in this city can fund it`, pct: thin });

  // --- the cycle -----------------------------------------------------------
  // A portfolio bid is a leveraged bid. When the debt markets are shut there
  // is no such thing as a big cheque, at any cap rate — this is the single
  // largest term in a real downturn and the reason distressed sellers sell one
  // building at a time.
  const ci = s.econ.creditIdx ?? 1;
  const credit = -Math.max(0, 1 - ci) * 0.18 - (s.econ.phase === "recession" ? 0.035 : 0);
  if (credit < -0.004) {
    why.push({ label: ci < 0.8 ? "Credit is tight — nobody is funding a portfolio right now" : "Financing markets are soft", pct: credit });
  }

  // --- your name -----------------------------------------------------------
  const st = sponsorStanding(s);
  if (st.advanceCut > 0) {
    why.push({ label: "Your record — buyers price a forced seller", pct: -Math.min(0.05, st.advanceCut * 0.6) });
  }

  // --- how much of your book this is ---------------------------------------
  // Selling everything you own tells the market something, and the market
  // charges you for telling it.
  const bookShare = sumOfParts / Math.max(1, Object.keys(s.holdings).reduce((a, b) => {
    const rec = resolveRec(parcels, s, b); const h = s.holdings[b];
    return a + (rec && h ? holdingValue(rec, s.econ, h, s.month) : 0);
  }, 0));
  if (bookShare > 0.75 && rows.length >= 3) {
    why.push({ label: "This is essentially your whole book — everybody knows why you are selling", pct: -0.02 });
  }

  // A FLOOR UNDER THE BLEND. Every term above is defensible on its own and
  // they compound: an empty mixed bag, in a crunch, from a sponsor with a
  // record, too big for the room, arrives at eighty points of discount, and
  // there is no such trade. Past about forty points a real seller stops
  // bundling and sells them one at a time, because that is strictly better —
  // so the model has to stop there too. In a genuine crunch the bundle does
  // not get cheaper; it simply gets no bid at all, which is what the arrival
  // rate in tickPortfolio already does.
  const total = Math.max(-0.40, why.reduce((a, x) => a + x.pct, 0));
  const indicative = Math.round(sumOfParts * (1 + total));
  return { sumOfParts, indicative, spreadPct: total, why, depth: Math.max(1, depth), count: rows.length };
}

/** Take a bundle to market. */
export function listPortfolio(
  s: GameState, parcels: ParcelTable, bbls: string[], ask: number,
): { s: GameState; err?: string; msg?: string } {
  if (s.portfolioSale) return { s, err: "You already have a portfolio in the market. One process at a time." };
  const clean = [...new Set(bbls)].filter((b) => s.holdings[b]);
  if (clean.length < 2) return { s, err: "A portfolio is two buildings or more. One building is a listing." };
  if (clean.some((b) => s.workouts?.[b])) {
    return { s, err: "One of these is in default. A lender in a workout controls that deed — clear the file first." };
  }
  const q = portfolioQuote(s, parcels, clean);
  if (ask <= 0) return { s, err: "Name a price." };
  const next = clone(s);
  // A building cannot be in two processes at once.
  for (const b of clean) if (next.holdings[b]?.sale) delete next.holdings[b].sale;
  next.portfolioSale = { bbls: clean, ask: Math.round(ask), listedM: next.month, sumOfParts: q.sumOfParts, bids: [] };
  next.news.unshift({
    q: next.month, kind: "info",
    text: `Took ${clean.length} buildings to market as a portfolio at ${money(ask)} — `
      + `${money(q.sumOfParts)} of individual marks, so you are asking `
      + `${ask >= q.sumOfParts ? "a premium" : `${((1 - ask / q.sumOfParts) * 100).toFixed(0)}% under the sum of the parts`}. `
      + `Indications inside ${RUN_M} months or the process goes stale.`,
  });
  return { s: next, msg: "In the market." };
}

export function delistPortfolio(s: GameState): GameState {
  const next = clone(s);
  delete next.portfolioSale;
  return next;
}

/** Move the ask. A portfolio that has sat for six months is telling you something. */
export function repricePortfolio(s: GameState, ask: number): { s: GameState; err?: string; msg?: string } {
  if (!s.portfolioSale) return { s, err: "Nothing in the market." };
  if (ask <= 0) return { s, err: "Name a price." };
  const next = clone(s);
  const old = next.portfolioSale!.ask;
  next.portfolioSale!.ask = Math.round(ask);
  // Cutting the number restarts interest; raising it into a live process ends it.
  if (ask > old * 1.02) {
    next.portfolioSale!.bids = [];
    next.news.unshift({
      q: next.month, kind: "warn",
      text: `Raised the portfolio ask to ${money(ask)} mid-process. Every indication in hand just went away — `
        + `moving the goalposts on an institutional buyer is how you get taken off their list.`,
    });
  } else {
    next.portfolioSale!.listedM = next.month - 1;
    next.news.unshift({ q: next.month, kind: "info", text: `Portfolio repriced to ${money(ask)}.` });
  }
  return { s: next, msg: "Repriced." };
}

/** Answer a bid with a number of your own. */
export function counterPortfolio(s: GameState, price: number): { s: GameState; err?: string; msg?: string } {
  const ps = s.portfolioSale;
  const best = ps?.bids?.[0];
  if (!ps || !best) return { s, err: "Nothing to answer." };
  const next = clone(s);
  const nb = next.portfolioSale!.bids[0];
  const stretch = price / Math.max(1, best.price);
  nb.countered = true;
  // An institution has a committee-approved number. You can move them a little
  // and only a little, and pushing hard on a bundle is how the whole thing
  // falls apart — they have other portfolios to look at.
  const give = Math.max(0, 1 - (stretch - 1) / 0.11);
  if (stretch <= 1.005) return { s, err: "That is their number. Take it or leave it." };
  if (rng(next) < give * 0.7) {
    const meet = Math.round(best.price + (price - best.price) * rrange(next, 0.4, 0.9));
    nb.price = meet;
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `${best.name} came up to ${money(meet)} on the portfolio. That is their committee number and there is nothing behind it.`,
    });
    return { s: next, msg: "They moved." };
  }
  next.portfolioSale!.bids = next.portfolioSale!.bids.filter((b) => b.name !== best.name);
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${best.name} withdrew from the portfolio rather than chase ${money(price)}. `
      + `A bundle is a discretionary purchase — there is always another one next quarter.`,
  });
  return { s: next, msg: "They walked." };
}

/**
 * CLOSE IT. Every building settles individually, because that is what actually
 * happens at the table: one price for the portfolio, allocated across the
 * deeds pro rata to value, and then nine separate loan payoffs, nine separate
 * gain calculations and nine separate tax bills.
 */
export function acceptPortfolioBid(
  s: GameState, parcels: ParcelTable, exchange = false,
): { s: GameState; err?: string; msg?: string } {
  const ps = s.portfolioSale;
  const bid = ps?.bids?.[0];
  if (!ps || !bid) return { s, err: "No live indication." };
  if (s.month > bid.expiresM) return { s, err: "That indication lapsed." };
  if (exchange && s.exchange) return { s, err: "One exchange at a time — close the live 1031 first." };
  const next = clone(s);
  const live = ps.bbls.filter((b) => next.holdings[b]);
  const marks = live.map((b) => {
    const rec = resolveRec(parcels, next, b)!;
    return holdingValue(rec, next.econ, next.holdings[b], next.month);
  });
  const totalMark = marks.reduce((a, v) => a + v, 0);
  if (totalMark <= 0) return { s, err: "There is nothing left in that portfolio." };

  let proceeds = 0, taxTotal = 0, gainTotal = 0;
  live.forEach((bbl, i) => {
    const h = next.holdings[bbl];
    const rec = resolveRec(parcels, next, bbl)!;
    // PURCHASE PRICE ALLOCATION. The bundle price lands on each deed in
    // proportion to what it was worth, which is how the schedule gets written
    // and why one weak building drags the tax basis of every strong one.
    const price = Math.round(bid.price * (marks[i] / totalMark));
    const { net, gain, tax } = saleTaxQuote(h, price);
    const kick = h.loan?.kicker && gain > 0 ? Math.round(gain * h.loan.kicker) : 0;
    const breakFee = h.loan ? prepayPenalty(h.loan, next.month) : 0;
    proceeds += net - (h.loan?.balance ?? 0) - kick - breakFee;
    if (kick + breakFee > 0) logBooks(next, "debtSvc", kick + breakFee);
    gainTotal += gain;
    taxTotal += tax;
    next.exits.push({
      bbl, address: rec.address, boughtM: h.boughtM, soldM: next.month,
      price, basis: h.costBasis, gain,
    });
    recordComp(next, rec, price, bid.name, "You", undefined, h.condition);
    if (next.groundLeases?.[bbl]) delete next.groundLeases[bbl];
    next.cash -= depositsOn(h);
    for (const [child, parent] of Object.entries(next.merged ?? {})) {
      if (parent !== bbl) continue;
      delete next.merged![child];
      delete next.holdings[child];
    }
    delete next.holdings[bbl];
    if (next.workouts?.[bbl]) delete next.workouts[bbl];
    next.lois = next.lois.filter((l) => l.bbl !== bbl);
  });
  while (next.exits.length > 200) next.exits.shift();
  next.cash += proceeds;
  logBooks(next, "sold", proceeds);
  if (exchange && taxTotal > 0) {
    next.exchange = {
      deferredTax: taxTotal, rolledGain: gainTotal, minPrice: bid.price,
      deadlineM: next.month + EXCHANGE_WINDOW_M,
    };
  } else if (taxTotal > 0) {
    next.cash -= taxTotal;
    next.taxesPaid = (next.taxesPaid ?? 0) + taxTotal;
    logBooks(next, "taxes", taxTotal);
  }
  delete next.portfolioSale;
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Closed the portfolio: ${live.length} buildings to ${bid.name} at ${money(bid.price)}, `
      + `${money(proceeds)} to you after payoffs. `
      + (exchange
        ? `1031 clock running — redeploy ${money(bid.price * 0.8)} by ${monthLabel(next.month + EXCHANGE_WINDOW_M)} or ${money(taxTotal)} of tax comes due.`
        : taxTotal > 0 ? `${money(taxTotal)} of tax withheld.` : "No gain, no tax."),
  });
  return { s: next, msg: "Portfolio closed." };
}

/**
 * The process, month by month. Indications arrive, they are never as good as
 * the ask, and a bundle nobody bids on is the market telling you what it
 * thinks of the weakest building in it.
 */
export function tickPortfolio(s: GameState, parcels: ParcelTable) {
  const ps = s.portfolioSale;
  if (ps) {
    // buildings can leave the bundle by any route — foreclosure, a child deed
    // folded into an assemblage — and a process on nothing is not a process
    ps.bbls = ps.bbls.filter((b) => s.holdings[b]);
    if (ps.bbls.length < 2) {
      delete s.portfolioSale;
      s.news.unshift({ q: s.month, kind: "warn", text: "The portfolio process collapsed — there are not two buildings left in it." });
    }
  }
  const live = s.portfolioSale;
  if (live) {
    live.bids = (live.bids ?? []).filter((b) => s.month <= b.expiresM);
    const age = s.month - live.listedM;
    if (age > RUN_M && !live.bids.length) {
      delete s.portfolioSale;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `Nine months and no indication on the portfolio at ${money(live.ask)}. The process is stale — `
          + `every buyer in town has now seen it and passed, which is worth knowing and expensive to have learned.`,
      });
    } else {
      const q = portfolioQuote(s, parcels, live.bbls);
      const eager = Math.min(1, q.indicative / Math.max(1, live.ask));
      // Interest is a function of how far under the indicative your ask is,
      // and it thins fast the longer it sits.
      const arrive = 0.30 * Math.pow(eager, 3.2) * Math.max(0.25, 1 - age / (RUN_M + 3));
      if (rng(s) < arrive && live.bids.length < 3) {
        const pool = BUYERS.filter((b) => q.sumOfParts >= b.min && !live.bids.some((x) => x.name === b.name));
        if (pool.length) {
          const who = pool[Math.floor(rng(s) * pool.length)];
          const price = Math.round(Math.min(live.ask, q.indicative * who.patience * rrange(s, 0.88, 1.02)));
          live.bids.push({ name: who.name, price, expiresM: s.month + 3 });
          live.bids.sort((a, b) => b.price - a.price);
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `${who.name} indicated ${money(price)} on the portfolio — `
              + `${((1 - price / Math.max(1, q.sumOfParts)) * 100).toFixed(0)}% inside the sum of the individual marks. `
              + `That spread is what you are paying to clear ${live.bbls.length} buildings in one closing.`,
          });
        }
      }
    }
  }

  // --- THE UNSOLICITED APPROACH -------------------------------------------
  // Somebody has been watching you accumulate. Once in a great while an
  // institution comes to you with a number for a coherent slice of the book —
  // never for the whole thing, never for the bad ones, and always for the
  // assets you would least like to part with, because those are the ones worth
  // buying.
  if (!s.portfolioSale && Object.keys(s.holdings).length >= 5 && rng(s) < 0.012) {
    const byClass = new Map<string, string[]>();
    for (const bbl of Object.keys(s.holdings)) {
      if (s.workouts?.[bbl] || s.holdings[bbl].sale) continue;
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || rec.class === "land") continue;
      const h = s.holdings[bbl];
      if (occOf(rec, h) < 0.8) continue;   // they want the good ones
      const arr = byClass.get(rec.class) ?? [];
      arr.push(bbl); byClass.set(rec.class, arr);
    }
    const best = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (best && best[1].length >= 3) {
      const bbls = best[1].slice(0, 6);
      const q = portfolioQuote(s, parcels, bbls);
      const who = BUYERS.filter((b) => q.sumOfParts >= b.min);
      if (who.length) {
        const buyer = who[Math.floor(rng(s) * who.length)];
        // An unsolicited approach is a real bid, not a lowball — they are
        // paying for the right to not compete for it. That premium is the
        // entire reason to answer the phone.
        const price = Math.round(q.indicative * rrange(s, 1.0, 1.09));
        s.portfolioSale = {
          bbls, ask: price, listedM: s.month, sumOfParts: q.sumOfParts, unsolicited: true,
          bids: [{ name: buyer.name, price, expiresM: s.month + 4 }],
        };
        s.news.unshift({
          q: s.month, kind: "deal",
          text: `${buyer.name} rang unprompted with ${money(price)} for ${bbls.length} of your ${best[0]} buildings — `
            + `${price >= q.sumOfParts ? "above" : `${((1 - price / q.sumOfParts) * 100).toFixed(0)}% inside`} the sum of the individual marks. `
            + `Nobody offers on a portfolio they have not already underwritten, so this number is real. It is also `
            + `for the buildings you would least like to sell, which is how you know they did the work.`,
        });
      }
    }
  }
}
