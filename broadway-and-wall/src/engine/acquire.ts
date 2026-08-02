// ACQUISITION, AS A NEGOTIATION.
//
// Buying was a dice roll. You named a price, an invisible seller rolled
// against it, and if you won you got exactly the building the panel described.
// That is the single most skill-intensive activity in this business reduced to
// a coin toss with no counterparty and no consequences.
//
// Two things are missing from that, and they are the same thing twice.
//
// FIRST, a seller is a person with a reason. An estate wants this closed
// before the tax year turns and will take less to be certain of it. An
// institution rebalancing out of the sector wants the number and does not care
// who you are. A partnership in litigation cannot agree on anything and will
// waste four months of your life. Price is not the only currency at the table:
// certainty of close is worth three to five per cent, and a buyer who can
// waive contingencies and fund in fifteen days routinely beats a higher offer.
// Nothing in the old model let you spend that.
//
// SECOND, you do not know what you are buying. Between handshake and closing
// there is a diligence period, and it exists because buildings have roofs at
// the end of their life, chillers nobody has serviced since 1998, a tank under
// the yard, an estoppel that comes back saying the anchor's rent is eleven per
// cent below what the offering memorandum showed, and an easement across the
// exact corner you were going to build on. Finding those is the job. Deciding
// whether to eat them, retrade them or walk from your deposit is the decision
// the job is for.
//
// So: an offer is a price and ONE structural choice — sixty days of diligence,
// or as-is. Diligence gives you the look and the walk: the deposit stays
// refundable until the period ends, and everything the consultants find is
// yours to retrade or flee. As-is closes fast with the deposit hard from day
// one — that certainty is worth real basis points to the seller, and it buys
// you the building including whatever nobody looked for.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { DiligenceItem, Escrow, GameState, SellerKind } from "./types";
import { logBooks, monthLabel } from "./types";
import { rng, rrange } from "./market";
import { assetValue, initialCondition, resolveRec } from "./value";
import { ownerOf } from "./rivals";
import { uses, useSf } from "./mix";

/** Deposit, as a share of price. Standard for a deal this size. */
const DEPOSIT_PCT = 0.02;

/**
 * Who is on the other side, and what they actually want.
 *
 *   certainty — how much they will discount for a clean, fast, unconditional
 *               close. An estate is desperate for it; a fund does not care.
 *   floor     — the share of appraised value below which they simply refuse.
 *   patience  — how far they will let a retrade go before telling you to leave.
 *   dawdle    — the chance in any month that they hold everything up.
 */
const SELLERS: Record<SellerKind, {
  label: string; blurb: string; certainty: number; floor: number; patience: number; dawdle: number;
}> = {
  estate: {
    label: "an estate", certainty: 0.055, floor: 0.80, patience: 0.75, dawdle: 0.06,
    blurb: "Executors, three heirs and a deadline. They want it done more than they want the last dollar.",
  },
  institution: {
    label: "an institutional owner", certainty: 0.012, floor: 0.94, patience: 0.25, dawdle: 0.02,
    blurb: "A fund rebalancing out of the sector. They have a committee, a number, and no reason to like you.",
  },
  partnership: {
    label: "a partnership in dispute", certainty: 0.04, floor: 0.84, patience: 0.55, dawdle: 0.16,
    blurb: "Two partners who no longer speak. Everything takes twice as long and nobody can say yes quickly.",
  },
  developer: {
    label: "a developer taking profits", certainty: 0.03, floor: 0.88, patience: 0.4, dawdle: 0.04,
    blurb: "They built it, they leased it, and they are recycling the equity into the next one.",
  },
  local: {
    label: "a local family owner", certainty: 0.035, floor: 0.86, patience: 0.6, dawdle: 0.08,
    blurb: "They have owned it since before you were born and they are in no hurry, but they are reasonable.",
  },
  lender: {
    label: "a lender's receiver", certainty: 0.07, floor: 0.70, patience: 0.85, dawdle: 0.05,
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
/**
 * What is wrong with this building, whether or not anybody looks.
 *
 * Every item is derived from things the player can already see — how old it
 * is, what condition it is in, what it is used for — so a careful buyer can
 * price the RISK before spending a month to find out. That is the actual
 * skill: you cannot know what the roof will cost, but you can know that a
 * 1920s industrial building is where the tank is going to be.
 */
export function latentIssues(s: GameState, rec: ParcelRecord, seed: number): DiligenceItem[] {
  const out: DiligenceItem[] = [];
  const year = 2000 + Math.floor(s.month / 12);
  const age = Math.max(0, year - rec.yearBuilt);
  const cond = initialCondition(rec);
  const sf = Math.max(1, rec.bldgArea);
  const idx = s.econ.costIdx;
  // a deterministic stream per deal, so the same offer always finds the same
  // things — diligence reveals the building, it does not roll a new one
  let h = seed >>> 0;
  const roll = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };

  // HOW MUCH OF THIS IS ACTUALLY A SURPRISE.
  //
  // A tired building is already priced as a tired building — a worn asset
  // trades at a wider cap and rents for less precisely because everyone in the
  // room can see the roof is finished. Charging the full cure cost on top of
  // that is double counting, and it was: applied at face value it destroyed
  // nineteen runs in twenty. What a buyer is actually exposed to is the part
  // the price did NOT already say, which is large on a building that presents
  // well and small on one that plainly does not.
  //
  // Contamination, title and a lease that is not the lease you were shown are
  // different: no amount of looking at the brickwork prices those, so they
  // land in full whatever condition the building is in.
  const priced = cond === "worn" ? 0.25 : cond === "standard" ? 0.55 : 1;
  const push = (kind: DiligenceItem["kind"], label: string, detail: string, cost: number) => {
    const physical = kind === "roof" || kind === "systems" || kind === "structure";
    out.push({ kind, label, detail, cost: Math.round(cost * (physical ? priced : 1)), found: false });
  };

  // roofs last about twenty-five years and nobody replaces them early
  if (age > 18 && roll() < (cond === "worn" ? 0.50 : cond === "standard" ? 0.28 : 0.09)) {
    push("roof", "Roof at the end of its life",
      `The membrane is ${Math.min(40, age)} years old and patched in four places. The engineer gives it two winters.`,
      sf * rrange(s, 7, 15) * idx);
  }
  // mechanical plant
  if (age > 28 && roll() < (cond === "worn" ? 0.42 : cond === "standard" ? 0.22 : 0.05)) {
    push("systems", "Mechanical plant past its service life",
      `Original air handling and a switchboard nobody has been able to buy parts for since the nineties.`,
      sf * rrange(s, 11, 26) * idx);
  }
  // the tank, the dry cleaner, the plating shop
  const dirty = (mixShare(rec, "industrial") > 0.3 ? 0.20 : 0.035) + (rec.yearBuilt < 1980 ? 0.05 : 0);
  if (roll() < dirty) {
    push("environmental", "Phase II came back dirty",
      `Historic use left contamination in the soil. Remediation, a monitoring covenant, and a lender who now wants a letter.`,
      rrange(s, 180_000, 2_400_000) * idx);
  }
  // structure — rare, and the one that kills deals
  if (age > 55 && roll() < 0.07) {
    push("structure", "Structural work required",
      `Spalling at the slab edge and corroded reinforcement on two elevations. It is fixable. It is not cheap.`,
      sf * rrange(s, 26, 62) * idx);
  }
  // the estoppel that disagrees with the offering memorandum
  if (roll() < 0.22) {
    const v = assetValue(rec, s.econ, cond);
    push("estoppel", "Estoppels came back short",
      `A tenant's actual lease is not the one you were shown — a rent concession the seller never mentioned, and a termination right in year three.`,
      v * rrange(s, 0.010, 0.038));
  }
  // title and survey
  if (roll() < 0.10) {
    push("title", "Title and survey exceptions",
      `A utility easement crosses the rear of the lot and an encroachment was never resolved. It limits what can be built here.`,
      assetValue(rec, s.econ, cond) * rrange(s, 0.006, 0.03));
  }
  return out;
}

function mixShare(rec: ParcelRecord, use: "industrial"): number {
  const total = uses(rec).reduce((a, u) => a + useSf(rec, u), 0);
  return total > 0 ? useSf(rec, use) / total : 0;
}

/** How thoroughly a given diligence period actually looks. */
export function discoveryRate(months: number): number {
  // sixty days with real consultants finds nearly everything findable
  return months <= 0 ? 0 : months === 1 ? 0.62 : 0.92;
}

// -------------------------------------------------------------------- the bid
/**
 * What the seller thinks of an offer.
 *
 * Price against their floor, plus the value of certainty: a short diligence
 * period and hard money are worth real basis points to somebody who has been
 * retraded before, and every seller has been retraded before.
 */
export function offerOdds(
  s: GameState, parcels: ParcelTable, bbl: string,
  price: number, diligenceM: number,
): { p: number; effective: number; certaintyBonus: number; seller: { kind: SellerKind; name: string } } {
  const seller = sellerOf(s, parcels, bbl);
  const prof = SELLERS[seller.kind];
  const rec = resolveRec(parcels, s, bbl);
  const li = s.listings.find((l) => l.bbl === bbl);
  const ask = li?.ask ?? (rec ? assetValue(rec, s.econ, initialCondition(rec)) : price);
  // Certainty, in dollars. As-is is the whole package — no contingency, hard
  // money, close in thirty days — and an estate or a receiver will pay real
  // points for it. Sixty days of free look is worth almost nothing to them.
  const certainty = prof.certainty * (diligenceM <= 0 ? 1.55 : 0.12);
  const effective = price * (1 + certainty);
  const disc = 1 - effective / Math.max(1, ask);
  const floorHit = effective < ask * prof.floor ? 0.6 : 0;
  const phase = s.econ.phase === "recession" ? 0.14 : s.econ.phase === "expansion" ? -0.10 : 0;
  const motivated = li?.distress ? 0.16 : 0;
  const p = Math.max(0.02, Math.min(0.97, 1.0 - disc * 5.8 + phase + motivated - floorHit));
  return { p, effective, certaintyBonus: certainty, seller };
}

// ------------------------------------------------------------------ the ticks
/** One month of a deal under contract. */
export function tickEscrow(s: GameState, parcels: ParcelTable) {
  const e = s.escrow;
  if (!e) return;
  const rec = resolveRec(parcels, s, e.bbl);
  if (!rec) { s.escrow = null; return; }
  const prof = SELLERS[e.sellerKind];

  // DILIGENCE. The consultants report back through the period, and whatever is
  // still open gets its remaining chance in the final report — so a sixty-day
  // period really is twice the look a thirty-day one is. It was not: an
  // off-by-one meant both periods got exactly one roll.
  if (e.diligenceM > 0 && s.month <= e.closesM) {
    const rate = discoveryRate(e.diligenceM);
    const last = s.month >= e.closesM;
    const perMonth = 1 - Math.pow(1 - rate, 1 / e.diligenceM);
    for (const f of e.findings) {
      if (f.found) continue;
      if (rng(s) < (last ? rate : perMonth)) {
        f.found = true;
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `Diligence at ${rec.address}: ${f.label.toLowerCase()} — ${f.detail} Est. $${(f.cost / 1e6).toFixed(2)}M.`,
        });
      }
    }
    // a difficult seller drags their feet, and there is nothing to be done
    if (!last && rng(s) < prof.dawdle) {
      e.closesM++;
      s.news.unshift({ q: s.month, kind: "info", text: `${e.sellerName} pushed the closing at ${rec.address} out a month. Nothing you can do about it.` });
      return;
    }
  }

  // The period is over. The deposit goes hard — that is what the end of a
  // contingency MEANS — and the seller will not wait indefinitely after that.
  if (s.month >= e.closesM && !e.hardDeposit) {
    e.hardDeposit = true;
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `Diligence closed at ${rec.address}. Your $${(e.deposit / 1e6).toFixed(2)}M deposit is hard now — close it, retrade it, or lose it.`,
    });
  }
  if (s.month > e.closesM + 2) {
    s.escrow = null;
    logBooks(s, "bought", e.deposit);
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `${e.sellerName} terminated at ${rec.address} — you sat past the outside date and the deposit went with it.`,
    });
  }
}

/** Everything found so far, and what it would cost to put right. */
export function foundCost(e: Escrow): number {
  return e.findings.filter((f) => f.found).reduce((a, f) => a + f.cost, 0);
}
export function hiddenCost(e: Escrow): number {
  return e.findings.filter((f) => !f.found).reduce((a, f) => a + f.cost, 0);
}

/**
 * Ask the seller to come down by what you found. How far they will go is
 * the whole of their character: a receiver shrugs and eats it, an institution
 * tells you the deal was as-is and you can leave.
 */
export function retrade(s: GameState, parcels: ParcelTable, ask: number): { s: GameState; err?: string; msg?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const e = next.escrow;
  if (!e) return { s, err: "Nothing under contract." };
  if (e.retraded) return { s, err: "You have already been back to them once. Close it or walk." };
  const rec = resolveRec(parcels, next, e.bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const found = foundCost(e);
  if (found <= 0) return { s, err: "You have not found anything to retrade against." };
  const want = Math.max(0, Math.round(ask));
  if (want > found) return { s, err: `You can only credit against what diligence actually found — $${(found / 1e6).toFixed(2)}M.` };
  const prof = SELLERS[e.sellerKind];
  e.retraded = true;
  // they concede up to `patience` of what you found, and resent the rest
  const willing = found * prof.patience;
  if (want <= willing) {
    e.price = Math.round(e.price - want);
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `${e.sellerName} took the credit at ${rec.address}: price down $${(want / 1e6).toFixed(2)}M to $${(e.price / 1e6).toFixed(2)}M.`,
    });
    return { s: next, msg: `They came down $${(want / 1e6).toFixed(2)}M.` };
  }
  // over the line: they split it, or they end it
  if (rng(next) < prof.patience) {
    const give = Math.round(willing);
    e.price = Math.round(e.price - give);
    next.news.unshift({
      q: next.month, kind: "deal",
      text: `${e.sellerName} refused most of it at ${rec.address} but gave $${(give / 1e6).toFixed(2)}M to keep the deal alive.`,
    });
    return { s: next, msg: `They gave $${(give / 1e6).toFixed(2)}M and said that is the end of it.` };
  }
  next.escrow = null;
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `${e.sellerName} terminated at ${rec.address} — they called the retrade a fishing trip and put it back on the market.`
      + (e.hardDeposit ? ` Your $${(e.deposit / 1e6).toFixed(2)}M deposit was hard. It is gone.` : " Your deposit came back."),
  });
  if (!e.hardDeposit) next.cash += e.deposit;
  return { s: next, msg: "They walked." };
}

/** Take the deposit back, or lose it. */
export function abandonEscrow(s: GameState, parcels: ParcelTable): { s: GameState; err?: string; msg?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const e = next.escrow;
  if (!e) return { s, err: "Nothing under contract." };
  const rec = resolveRec(parcels, next, e.bbl);
  next.escrow = null;
  if (!e.hardDeposit) {
    next.cash += e.deposit;
    next.news.unshift({ q: next.month, kind: "info", text: `You walked from ${rec?.address ?? e.bbl}. The deposit was refundable and it came back.` });
    return { s: next, msg: "Walked. Deposit returned." };
  }
  logBooks(next, "bought", e.deposit);
  next.news.unshift({
    q: next.month, kind: "warn",
    text: `You walked from ${rec?.address ?? e.bbl} and left $${(e.deposit / 1e6).toFixed(2)}M of hard money on the table. That is what buying certainty costs when you are wrong.`,
  });
  return { s: next, msg: `Walked. The $${(e.deposit / 1e6).toFixed(2)}M deposit is gone.` };
}

export function escrowSummary(e: Escrow, month: number): string {
  const left = Math.max(0, e.closesM - month);
  return left > 0
    ? `${left} month${left === 1 ? "" : "s"} of diligence left · closes ${monthLabel(e.closesM)}`
    : "Diligence is over. Close it, retrade it, or walk.";
}

export { DEPOSIT_PCT };
