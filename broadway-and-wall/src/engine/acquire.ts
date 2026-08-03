// ACQUISITION, AS A NEGOTIATION.
//
// Buying was a dice roll. You named a price, an invisible seller rolled
// against it, and if you won you got exactly the building the panel described.
// That is the single most skill-intensive activity in this business reduced to
// a coin toss with no counterparty.
//
// A seller is a person with a reason. An estate wants this closed before the
// tax year turns and will take less to be certain of it. An institution
// rebalancing out of the sector wants the number and does not care who you
// are. A partnership in litigation cannot agree on anything. That is what you
// are reading across the table, and it is what decides the price.
//
// There WAS a diligence period here too — sixty days or as-is, a consultants'
// report, then close or retrade or walk. Every piece of that is real, and
// together they put four screens and two months between deciding to buy a
// building and owning it, which made the most frequent action in the game its
// slowest. An offer is a price now, and agreeing one is buying the building.
import type { ParcelTable } from "@/data/types";
import type { GameState, SellerKind } from "./types";
import { monthLabel } from "./types";
import { assetValue, initialCondition, resolveRec } from "./value";
import { ownerOf } from "./rivals";
import { executePurchase } from "./actions";

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/**
 * Who is on the other side, and what they actually want.
 *
 *   certainty — how much they will discount for a clean, fast, unconditional
 *               close. An estate is desperate for it; a fund does not care.
 *   floor     — the share of appraised value below which they simply refuse.
 *   patience  — how far they will let a retrade go before telling you to leave.
 *   dawdle    — the chance in any month that they hold everything up.
 */
// WHAT THEY WILL ACTUALLY TAKE, as a share of the ask.
//
// These floors were four to twenty per cent under the asking price, which made
// the negotiation a formality: open at ninety-two and almost everybody said
// yes, on almost every building, in almost every market. A real seller with a
// building anybody else wants does not take eight per cent off because you
// asked once. Every floor moved up between five and ten points, and the
// institution — a committee with a number and no reason to like you — now
// barely moves at all. The receiver is still the cheapest money in town at
// eighty cents, because that is what a receiver is for.
const SELLERS: Record<SellerKind, {
  label: string; blurb: string; certainty: number; floor: number; patience: number; dawdle: number;
}> = {
  estate: {
    label: "an estate", certainty: 0.055, floor: 0.87, patience: 0.75, dawdle: 0.06,
    blurb: "Executors, three heirs and a deadline. They want it done more than they want the last dollar.",
  },
  institution: {
    label: "an institutional owner", certainty: 0.012, floor: 0.98, patience: 0.25, dawdle: 0.02,
    blurb: "A fund rebalancing out of the sector. They have a committee, a number, and no reason to like you.",
  },
  partnership: {
    label: "a partnership in dispute", certainty: 0.04, floor: 0.90, patience: 0.55, dawdle: 0.16,
    blurb: "Two partners who no longer speak. Everything takes twice as long and nobody can say yes quickly.",
  },
  developer: {
    label: "a developer taking profits", certainty: 0.03, floor: 0.93, patience: 0.4, dawdle: 0.04,
    blurb: "They built it, they leased it, and they are recycling the equity into the next one.",
  },
  local: {
    label: "a local family owner", certainty: 0.035, floor: 0.92, patience: 0.6, dawdle: 0.08,
    blurb: "They have owned it since before you were born and they are in no hurry, but they are reasonable.",
  },
  lender: {
    label: "a lender's receiver", certainty: 0.07, floor: 0.80, patience: 0.85, dawdle: 0.05,
    blurb: "A special servicer clearing a book. They will take a haircut to be rid of it and they will not warrant a thing.",
  },
};

export const sellerProfile = (k: SellerKind) => SELLERS[k];

/** Who owns this listing, decided once and stable for the life of the listing. */
export function sellerOf(s: GameState, parcels: ParcelTable, bbl: string): { kind: SellerKind; name: string } {
  const rival = ownerOf(s, bbl);
  if (rival) {
    return {
      kind: rival.stressMs && rival.stressMs > 4 ? "lender" : rival.style === "family" ? "local" : rival.style === "developer" ? "developer" : "institution",
      name: rival.name,
    };
  }
  const li = s.listings.find((l) => l.bbl === bbl);
  const rec = parcels[bbl];
  // stable per listing: the same parcel keeps the same seller while it is up
  let h = 2166136261;
  for (const ch of bbl + String(li?.listedM ?? 0)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const r = ((h >>> 0) % 1000) / 1000;
  if (li?.distress) return { kind: r < 0.45 ? "lender" : r < 0.8 ? "estate" : "partnership", name: SELLERS[r < 0.45 ? "lender" : r < 0.8 ? "estate" : "partnership"].label };
  const kind: SellerKind = r < 0.22 ? "estate" : r < 0.46 ? "local" : r < 0.68 ? "institution" : r < 0.86 ? "partnership" : "developer";
  void rec;
  return { kind, name: SELLERS[kind].label };
}

// ------------------------------------------------------------------ diligence



// ------------------------------------------------------------------ the ticks
/** One month of a live negotiation. */
export function tickTalks(s: GameState, parcels: ParcelTable) {
  // A NEGOTIATION GOES STALE. Nobody holds a number open indefinitely while
  // you think about it, and a building somebody else buys is not yours to keep
  // talking about.
  const t = s.talks;
  if (!t) return;
  // UNDER CONTRACT. Nobody takes it out from under you while the paper is
  // signed — but the closing date is real, and a buyer who cannot fund by it is
  // a buyer who loses the building and looks like an amateur doing it.
  if (t.agreed) {
    if (s.month >= (t.closeByM ?? t.openedM + CLOSE_WINDOW_M)) {
      delete s.talks;
      // It genuinely goes back on the market — the listing's own clock stopped
      // while the contract ran, so give it a fresh one rather than letting it
      // vanish the same month and make a liar of the news line.
      const li = s.listings.find((l) => l.bbl === t.bbl);
      if (li && li.expiresM <= s.month) li.expiresM = s.month + 4;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The contract on ${parcels[t.bbl]?.address ?? t.bbl} expired unfunded. `
          + `${t.sellerName} kept the deposit's worth of goodwill and put it back on the market.`,
      });
    }
    return;
  }
  const gone = !s.listings.some((l) => l.bbl === t.bbl);
  if (gone) {
    delete s.talks;
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `${parcels[t.bbl]?.address ?? t.bbl} went to somebody else while you were still talking about it.`,
    });
  } else if (s.month - t.openedM >= 3) {
    delete s.talks;
    s.news.unshift({
      q: s.month, kind: "info",
      text: `${t.sellerName} has stopped waiting on ${parcels[t.bbl]?.address ?? t.bbl}. The building is still for sale if you want to start again.`,
    });
  }
}

// ------------------------------------------------------------- the negotiation
/**
 * BUYING, AS A CONVERSATION.
 *
 * The old model was a single roll. You named a price, an unseen seller rolled
 * against it, and a refusal printed a line of news and left you exactly where
 * you started — no counter, no number to read, no way to tell whether you were
 * two per cent away or forty. The most skill-intensive thing in this business
 * was a slot machine with a percentage on it.
 *
 * This is the same trade with the counterparty put back in the room. Every
 * seller has a RESERVATION: what they will actually take today, which is their
 * floor against appraisal, moved by who they are, what the market is doing,
 * and whether they are distressed. You cannot see it. What you can see is
 * their number, your number, how far apart they are, and how much patience is
 * left — which is precisely what you can see across a real table.
 *
 * Offer inside the reservation and it is done. Offer close and they come back
 * with a number of their own, and the gap narrows each round because both
 * sides are converging on a deal they both want. Offer far below it and they
 * tell you where they are and stop moving. Run out of rounds and the next word
 * is final.
 */
const OPEN_ROUNDS: Record<SellerKind, number> = {
  estate: 4, institution: 2, partnership: 3, developer: 3, local: 4, lender: 4,
};

/** What this seller will actually take today. Never shown to the player. */
function reservationOf(
  s: GameState, parcels: ParcelTable, bbl: string, sellerKind: SellerKind,
): { reservation: number; ask: number } {
  const prof = SELLERS[sellerKind];
  const rec = resolveRec(parcels, s, bbl);
  const li = s.listings.find((l) => l.bbl === bbl);
  const ask = li?.ask ?? (rec ? assetValue(rec, s.econ, initialCondition(rec)) : 0);
  // A soft market drags the floor down; a hot one lets them hold out. Distress
  // is the seller's problem and your opportunity.
  const phase = s.econ.phase === "recession" ? -0.055 : s.econ.phase === "expansion" ? 0.03 : 0;
  const distress = li?.distress ? -0.06 : 0;
  const floor = Math.max(0.6, prof.floor + phase + distress);
  // A clean, unconditional close is worth real money to somebody who has been
  // retraded before, and every seller has been. With no diligence to offer,
  // every deal here IS that close — so the discount they will take for it is
  // simply part of the floor, priced by who they are.
  const reservation = Math.round((ask * floor) / (1 + prof.certainty));
  return { reservation, ask };
}

/**
 * Open a negotiation, or answer their counter with one of your own.
 *
 * THERE IS NO LENDER IN THIS FUNCTION. It used to take a product and a
 * leverage dial, because agreeing a price and funding the purchase were one
 * button — which meant the player had to pick a lender, read three coverage
 * tests and set a leverage slider before they were allowed to say a number out
 * loud. That is backwards from how anybody buys a building. You agree a price
 * first, and then you go and find the money against a deal you actually have.
 */
export function negotiate(
  s: GameState, parcels: ParcelTable, bbl: string, price: number,
): { s: GameState; err?: string; msg?: string } {
  const existing = s.talks;
  if (existing && existing.bbl !== bbl) {
    return { s, err: `You are mid-negotiation at ${parcels[existing.bbl]?.address ?? existing.bbl}. Finish it or walk away first.` };
  }
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.listings.some((l) => l.bbl === bbl)) return { s, err: "That property is no longer on the market." };
  const px = Math.round(price);
  if (!Number.isFinite(px) || px <= 0) return { s, err: "Name a real number." };

  const next = clone(s);
  const seller = existing
    ? { kind: existing.sellerKind, name: existing.sellerName }
    : sellerOf(next, parcels, bbl);
  const { reservation, ask } = reservationOf(next, parcels, bbl, seller.kind);
  const round = (existing?.round ?? 0) + 1;
  const maxRounds = existing?.maxRounds ?? OPEN_ROUNDS[seller.kind];
  const prof = SELLERS[seller.kind];

  // --- they take it ---------------------------------------------------------
  // And that is a handshake, not a closing. The deed is reserved and the clock
  // starts; the money is the next conversation.
  if (px >= reservation) {
    return { s: strikeDeal(next, bbl, px, seller, rec.address), msg: `Agreed at ${fmtM(px)}. Now fund it.` };
  }

  // --- too far below to be worth an answer ---------------------------------
  // A seller who is a long way from you does not counter, they tell you where
  // they are. That IS the information — and it is far more use than a refusal.
  const gap = px / Math.max(1, reservation);

  // AN INSULT ENDS THE CONVERSATION.
  //
  // A lowball used to be free: they told you where they were and waited while
  // you tried again, so the optimal play was always to open at sixty per cent
  // and walk it up. Nobody sells that way. Come in far enough under and the
  // seller stops taking your calls on this building — the listing stays, the
  // number stays, and you are not the one who gets it. That is the entire cost
  // of finding out where the floor is by kicking it.
  if (gap < 0.62) {
    delete next.talks;
    const rival = ownerOf(next, bbl);
    if (rival) {
      // A named firm remembers. They will not deal with you here again.
      next.approaches[bbl] = { q: next.month, refused: true };
    }
    next.news.unshift({
      q: next.month, kind: "warn",
      text: `${fmtM(px)} at ${rec.address} ended it. ${seller.name} is not interested in a conversation `
        + `that starts there and the building is off the table for you — it is still for sale to somebody else.`,
    });
    // and the tape absorbs it faster now that a serious buyer has been rebuffed
    const li2 = next.listings.find((l) => l.bbl === bbl);
    if (li2) li2.expiresM = Math.min(li2.expiresM, next.month + 2);
    return { s: next, msg: "They ended it. That was an insult, not an offer." };
  }

  if (gap < 0.80 || round > maxRounds) {
    const theirs = Math.round(round > maxRounds ? reservation * 1.005 : ask * 0.985);
    next.talks = {
      bbl, sellerKind: seller.kind, sellerName: seller.name,
      yourPrice: px, theirPrice: theirs, round, maxRounds,
      openedM: existing?.openedM ?? next.month, final: true,
      note: round > maxRounds
        ? `${seller.name} is done moving. ${fmtM(theirs)} is the number; take it or leave it.`
        : `${seller.name} did not counter — ${fmtM(px)} is not in the conversation. They are at ${fmtM(theirs)}.`,
    };
    return { s: next, msg: round > maxRounds ? "Their final number." : "They didn't move." };
  }

  // --- they counter ---------------------------------------------------------
  // Converging: each round the seller gives up a share of the remaining gap,
  // and the impatient ones give up more to be finished.
  const prev = existing?.theirPrice ?? ask;
  const give = 0.28 + prof.patience * 0.22 + round * 0.06;
  const theirs = Math.max(reservation, Math.round(prev - (prev - Math.max(px, reservation)) * Math.min(0.85, give)));
  const roundsLeft = maxRounds - round;
  next.talks = {
    bbl, sellerKind: seller.kind, sellerName: seller.name,
    yourPrice: px, theirPrice: theirs, round, maxRounds,
    openedM: existing?.openedM ?? next.month,
    final: roundsLeft <= 0,
    note: roundsLeft <= 0
      ? `${seller.name} counters at ${fmtM(theirs)} and says it is the last of it.`
      : `${seller.name} counters at ${fmtM(theirs)}. You are ${fmtM(theirs - px)} apart.`,
  };
  next.news.unshift({
    q: next.month, kind: "info",
    text: `${rec.address}: you offered ${fmtM(px)}, ${seller.name} came back at ${fmtM(theirs)}.`,
  });
  return { s: next, msg: `They countered at ${fmtM(theirs)}.` };
}

/** Take the number on the table. Also a handshake, not a closing. */
export function acceptCounter(s: GameState, parcels: ParcelTable): { s: GameState; err?: string; msg?: string } {
  const t = s.talks;
  if (!t) return { s, err: "There is nothing on the table." };
  if (t.agreed) return { s, err: "The price is already agreed. What is left is funding it." };
  const rec = resolveRec(parcels, s, t.bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone(s);
  return {
    s: strikeDeal(next, t.bbl, t.theirPrice, { kind: t.sellerKind, name: t.sellerName }, rec.address),
    msg: `Agreed at ${fmtM(t.theirPrice)}. Now fund it.`,
  };
}

/** How long a contract holds while you go and find the money. */
export const CLOSE_WINDOW_M = 3;

/**
 * The handshake. A price is a price and the building comes off everybody
 * else's tape, but nothing has moved: no deed, no cash, no loan. What you have
 * is three months and an obligation.
 */
function strikeDeal(
  next: GameState, bbl: string, px: number,
  seller: { kind: SellerKind; name: string }, address: string,
): GameState {
  next.talks = {
    bbl, sellerKind: seller.kind, sellerName: seller.name,
    yourPrice: px, theirPrice: px, round: next.talks?.round ?? 1,
    maxRounds: next.talks?.maxRounds ?? OPEN_ROUNDS[seller.kind],
    openedM: next.talks?.openedM ?? next.month,
    agreed: true, agreedPrice: px, closeByM: next.month + CLOSE_WINDOW_M,
    note: `Agreed at ${fmtM(px)} with ${seller.name}. You are under contract — place the debt and fund it by `
      + `${monthLabel(next.month + CLOSE_WINDOW_M)} or the deal is off and somebody else gets it.`,
  };
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `Under contract at ${address}: ${fmtM(px)} agreed with ${seller.name}. `
      + `Nothing has moved yet — the money is due by ${monthLabel(next.month + CLOSE_WINDOW_M)}.`,
  });
  return next;
}

/**
 * FUND IT. The second half of buying a building, and now a decision of its
 * own: which desk, how much leverage, and what that does to the coverage and
 * the cheque you write. The price is already settled and cannot move here.
 */
export function closeDeal(
  s: GameState, parcels: ParcelTable, product: string, lev: number,
): { s: GameState; err?: string; msg?: string } {
  const t = s.talks;
  if (!t?.agreed || t.agreedPrice === undefined) return { s, err: "Nothing is under contract." };
  const rec = resolveRec(parcels, s, t.bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone(s);
  return closeAgreed(next, parcels, t.bbl, t.agreedPrice, product, lev,
    { kind: t.sellerKind, name: t.sellerName }, rec.address);
}

/** Leave the table. */
export function walkAway(s: GameState, parcels: ParcelTable): { s: GameState; msg?: string } {
  const t = s.talks;
  if (!t) return { s };
  const next = clone(s);
  delete next.talks;
  const li = next.listings.find((l) => l.bbl === t.bbl);
  if (li && li.expiresM <= next.month) li.expiresM = next.month + 4;
  next.news.unshift({
    q: next.month, kind: "info",
    text: t.agreed
      ? `You tore up the contract on ${parcels[t.bbl]?.address ?? t.bbl}. ${t.sellerName} will remember that you could not fund it.`
      : `You walked away from ${parcels[t.bbl]?.address ?? t.bbl}. ${t.sellerName} will remember, but the building will still be there.`,
  });
  return { s: next, msg: t.agreed ? "Contract torn up." : "Walked away." };
}

// A $610,000 lot quoted as "$0.61M" reads like a rounding error. Money in
// this game spans four orders of magnitude and the unit has to follow it.
const fmtM = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};

/**
 * AGREEING A PRICE IS BUYING THE BUILDING.
 *
 * There used to be a diligence period between the handshake and the keys: pick
 * sixty days or as-is, wait, read a consultants' report, then close or retrade
 * or walk. Every one of those is a real thing in the business and together
 * they were four screens and two months of waiting between deciding to buy
 * something and owning it — which made the most frequent action in the game
 * the slowest one, and put a modal in front of a decision the player had
 * already made.
 *
 * So the trade closes when it is agreed. The negotiation IS the deal now, and
 * it is the part worth playing.
 */
function closeAgreed(
  next: GameState, parcels: ParcelTable, bbl: string, px: number,
  product: string, lev: number,
  seller: { kind: SellerKind; name: string }, address: string,
): { s: GameState; err?: string; msg?: string } {
  const done = executePurchase(next, parcels, bbl, px, product as never, false, lev);
  if (done.err) return { s: next, err: done.err };
  const out = done.s;
  out.listings = out.listings.filter((l: { bbl: string }) => l.bbl !== bbl);
  delete out.talks;
  out.news.unshift({
    q: out.month, kind: "deal",
    text: `Bought ${address} from ${seller.name} at ${fmtM(px)}.`,
  });
  return { s: out, msg: `Bought at ${fmtM(px)}.` };
}
