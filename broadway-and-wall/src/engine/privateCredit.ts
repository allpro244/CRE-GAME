// PRIVATE CREDIT — you are the expensive yes.
//
// Distressed notes let you BUY paper. This lets you WRITE it. Rivals who cannot
// clear a bank desk (hold, sponsor, speed, Cordage too rich) ask your sleeve
// for a short, expensive bridge. You fund from cash; the loan becomes a Note
// you own so tickNotes / foreclosure / July already work.
//
// Design contract: PRIVATE_CREDIT.md. Not a bank charter. Not multiplayer.
import type { ParcelTable } from "@/data/types";
import type { GameState, Note, PrivateCreditAsk, Rival } from "./types";
import { cloneState, logBooks, monthLabel } from "./types";
import { rng, rrange } from "./market";
import { assetValue, collateralAsIs, netWorth, resolveRec } from "./value";
import { assetGrade } from "./rivals";
import { firmShort } from "./firm";
import { lenderByName } from "./lenders";

const clone = (s: GameState): GameState => cloneState(s);
const money = (n: number) =>
  Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
const cl = (lo: number, hi: number, x: number) => Math.max(lo, Math.min(hi, x));

/** Leave this much cash after funding — G&A and a bad month. */
export const PRIVATE_CASH_RESERVE = 500_000;
/** Outstanding private-originated face ≤ this share of net worth. */
export const PRIVATE_BOOK_NW = 0.35;
/** At most this many live asks — a shortlist, not a marketplace. */
const MAX_ASKS = 2;
/** Ask lives two months; silence is a pass. */
const ASK_LIFE_M = 2;

/** Face you have already written that is still on the book. */
export function privateBookFace(s: GameState): number {
  return (s.notes ?? [])
    .filter((n) => n.privateOriginated)
    .reduce((a, n) => a + n.face, 0);
}

/**
 * HOW MUCH MORE FACE YOU CAN WRITE. Cash sleeve + NW rail. Unlevered — the
 * LOC is for buildings, not for warehousing other people's mortgages.
 */
export function privateSleeveCapacity(s: GameState, parcels: ParcelTable): number {
  const nw = Math.max(0, netWorth(s, parcels));
  const byNw = Math.max(0, nw * PRIVATE_BOOK_NW - privateBookFace(s));
  const byCash = Math.max(0, s.cash - PRIVATE_CASH_RESERVE);
  return Math.floor(Math.min(byNw, byCash));
}

/**
 * Drop or transfer the cityLoans row in your name.
 * Payoff / deed → delete. Sale of the note → rename the lender; the obligor's
 * debt stays — you transferred the claim, you did not forgive it.
 */
export function releasePrivateStreetRecord(s: GameState, n: Note, newLender?: string) {
  if (!n.privateOriginated) return;
  const row = s.cityLoans?.[n.bbl];
  if (!row || !s.cityLoans || row.lender !== firmShort(s)) return;
  if (newLender) row.lender = newLender;
  else delete s.cityLoans[n.bbl];
}

/** Extinguish the claim — rival debt down and street record cleared. */
export function clearPrivateOrigination(s: GameState, n: Note) {
  if (!n.privateOriginated) return;
  const r = s.rivals?.find((x) => x.id === n.obligorId);
  if (r) r.debt = Math.max(0, r.debt - n.face);
  releasePrivateStreetRecord(s, n);
}

function deedAlreadyLiens(s: GameState, bbl: string): boolean {
  if ((s.notes ?? []).some((n) => n.bbl === bbl)) return true;
  if (s.cityLoans?.[bbl]) return true;
  if (s.holdings[bbl]?.loan) return true;
  return false;
}

function rivalNeedsPrivate(
  s: GameState, r: Rival, asIs: number,
): { face: number; why: string } | null {
  if (r.failedM !== undefined || !r.bbls.length) return null;
  const stressed = (r.stressMs ?? 0) >= 3;
  const dry = r.cash < Math.max(200_000, 0.02 * Math.max(1, r.aum ?? 0));
  const balloonSoon = Object.values(r.extendedTo ?? {}).some((m) => m - s.month <= 6 && m >= s.month);
  if (!stressed && !dry && !balloonSoon) return null;

  // Size: bridge, not a permanent takeout — 55–68% of as-is, capped.
  const ltv = cl(0.55, 0.68, 0.55 + ((r.stressMs ?? 0) > 8 ? 0.08 : 0));
  let face = Math.round(asIs * ltv / 25_000) * 25_000;
  face = cl(250_000, 12_000_000, face);
  if (face < 250_000 || asIs < face / 0.7) return null;

  const alden = lenderByName(s, "Alden National");
  const cordage = lenderByName(s, "Cordage Debt Partners");
  const bankShut = !alden || (alden.appetite ?? 1) < 0.2 || alden.failedM !== undefined;
  const why = bankShut
    ? "The banks have stopped answering. They need a cheque that clears this month."
    : balloonSoon
      ? "A balloon is inside six months and the cheap desks will not re-paper it in time."
      : cordage && (s.econ.creditIdx ?? 1) < 0.85
        ? "Cordage would do it — at a coupon that eats the deal. They are asking if you will."
        : stressed
          ? "They are in a squeeze. Sponsor standing and cash both look wrong to a bank."
          : "Cash is thin against the book and they will not sell the trophy to raise it.";
  return { face, why };
}

/** Spawn / expire private asks. */
export function tickPrivateCredit(s: GameState, parcels: ParcelTable) {
  if (!s.privateAsks) s.privateAsks = [];

  // Expire
  for (let i = s.privateAsks.length - 1; i >= 0; i--) {
    const a = s.privateAsks[i];
    if (s.month < a.expiresM) continue;
    s.privateAsks.splice(i, 1);
    // They went somewhere — Cordage, a sale, or they ate the balloon.
    if (rng(s) < 0.4) {
      s.news.unshift({
        q: s.month, kind: "rumor",
        text: `${a.rivalName} found money elsewhere for ${a.address} — or did not. `
          + `The ask to ${firmShort(s)} lapsed.`,
      });
    }
  }

  if (s.privateAsks.length >= MAX_ASKS) return;
  const sleeve = privateSleeveCapacity(s, parcels);
  if (sleeve < 250_000) return;

  // One attempt per month — episodic, not a feed.
  if (rng(s) > 0.22) return;

  const candidates: { r: Rival; bbl: string; asIs: number; face: number; why: string }[] = [];
  for (const r of s.rivals ?? []) {
    if (r.failedM !== undefined) continue;
    for (const bbl of r.bbls) {
      if (deedAlreadyLiens(s, bbl)) continue;
      if (s.privateAsks.some((a) => a.bbl === bbl || a.rivalId === r.id)) continue;
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      const asIs = Math.round(collateralAsIs(rec, s.econ, r.occ ?? 0.7)
        || assetValue(rec, s.econ, assetGrade(r, rec)));
      if (asIs < 400_000) continue;
      const need = rivalNeedsPrivate(s, r, asIs);
      if (!need) continue;
      if (need.face > sleeve) continue;
      candidates.push({ r, bbl, asIs, face: need.face, why: need.why });
    }
  }
  if (!candidates.length) return;
  const pick = candidates[Math.floor(rng(s) * candidates.length)];
  const rec = resolveRec(parcels, s, pick.bbl)!;
  const ratePct = +(s.econ.indexRate + rrange(s, 6.0, 9.0)).toFixed(2);
  const points = +rrange(s, 0.012, 0.028).toFixed(3);
  const termM = Math.round(rrange(s, 6, 18));
  const ask: PrivateCreditAsk = {
    id: "P" + (s.nextPrivateAskId = (s.nextPrivateAskId ?? 1) + 1),
    rivalId: pick.r.id,
    rivalName: pick.r.name,
    bbl: pick.bbl,
    address: rec.address,
    face: pick.face,
    ratePct,
    points,
    termM,
    ltv: pick.face / Math.max(1, pick.asIs),
    asIs: pick.asIs,
    why: pick.why,
    offeredM: s.month,
    expiresM: s.month + ASK_LIFE_M,
  };
  s.privateAsks.push(ask);
  s.news.unshift({
    q: s.month, kind: "rumor",
    text: `${ask.rivalName} is asking ${firmShort(s)} for ${money(ask.face)} against ${ask.address} `
      + `— ${ask.ratePct.toFixed(2)}%, ${(ask.points * 100).toFixed(1)} points, ${ask.termM} months. `
      + ask.why,
  });
}

/**
 * FUND THE ASK. Cash out, points in, rival gets the advance, you hold a Note.
 */
export function fundPrivateAsk(
  s: GameState, parcels: ParcelTable, id: string,
): { s: GameState; err?: string; msg?: string } {
  const ask = s.privateAsks?.find((a) => a.id === id);
  if (!ask) return { s, err: "That ask is gone." };
  if (s.month > ask.expiresM) return { s, err: "That ask has lapsed." };
  const r = s.rivals?.find((x) => x.id === ask.rivalId);
  if (!r || r.failedM !== undefined) return { s, err: "The borrower is no longer a going concern." };
  if (!r.bbls.includes(ask.bbl)) return { s, err: "They no longer own the collateral." };
  if (deedAlreadyLiens(s, ask.bbl)) return { s, err: "There is already a lien on that deed." };

  const pointsCost = Math.round(ask.face * ask.points);
  // You fund face from cash; points are paid by the borrower from the advance
  // (standard hard-money: net cheque = face × (1 − points)).
  const netToBorrower = ask.face - pointsCost;
  const sleeve = privateSleeveCapacity(s, parcels);
  if (ask.face > sleeve) {
    return { s, err: `Your private sleeve will only carry another ${money(sleeve)} of face.` };
  }
  if (s.cash < ask.face + PRIVATE_CASH_RESERVE) {
    return { s, err: `Funding ${money(ask.face)} would leave you under the ${money(PRIVATE_CASH_RESERVE)} cash reserve.` };
  }

  const next = clone(s);
  const rival = next.rivals!.find((x) => x.id === ask.rivalId)!;
  const rec = resolveRec(parcels, next, ask.bbl);
  if (!rec) return { s, err: "The parcel is gone." };

  next.cash -= ask.face;
  logBooks(next, "bought", ask.face); // capital deployed into a claim
  // Points are fee income the month you close — borrower net is face − points.
  next.cash += pointsCost;
  logBooks(next, "interest", pointsCost);

  rival.cash += netToBorrower;
  rival.debt += ask.face;
  if ((rival.stressMs ?? 0) > 0) rival.stressMs = Math.max(0, (rival.stressMs ?? 0) - 2);

  if (!next.cityLoans) next.cityLoans = {};
  next.cityLoans[ask.bbl] = {
    bbl: ask.bbl,
    lender: firmShort(next),
    obligorId: rival.id,
    balance: ask.face,
    ratePct: ask.ratePct,
    originM: next.month,
    maturityM: next.month + ask.termM,
    origValue: ask.asIs,
    klass: rec.class,
    status: "current",
  };

  if (!next.notes) next.notes = [];
  next.notes.push({
    id: "N" + (next.nextNoteId = (next.nextNoteId ?? 1) + 1),
    bbl: ask.bbl,
    address: ask.address,
    originator: firmShort(next),
    obligorId: rival.id,
    obligor: rival.name,
    face: ask.face,
    ratePct: ask.ratePct,
    maturityM: next.month + ask.termM,
    perf: "performing",
    boughtM: next.month,
    basis: ask.face, // carry at face; points already taken as income
    collected: pointsCost,
    mods: 0,
    privateOriginated: true,
  });

  next.privateAsks = (next.privateAsks ?? []).filter((a) => a.id !== ask.id);
  next.news.unshift({
    q: next.month, kind: "deal",
    text: `${firmShort(next)} has written ${money(ask.face)} of private paper on ${ask.address} to ${rival.name} — `
      + `${ask.ratePct.toFixed(2)}%, ${(ask.points * 100).toFixed(1)} points, due ${monthLabel(next.month + ask.termM)}. `
      + `They cleared ${money(netToBorrower)} after points. You are the lender of record.`,
  });
  return {
    s: next,
    msg: `Funded ${money(ask.face)} · ${money(pointsCost)} points in.`,
  };
}

export function declinePrivateAsk(s: GameState, id: string): { s: GameState; err?: string; msg?: string } {
  const ask = s.privateAsks?.find((a) => a.id === id);
  if (!ask) return { s, err: "That ask is gone." };
  const next = clone(s);
  next.privateAsks = (next.privateAsks ?? []).filter((a) => a.id !== id);
  next.news.unshift({
    q: next.month, kind: "info",
    text: `${firmShort(next)} passed on ${ask.rivalName}'s ask against ${ask.address}. `
      + `They will try Cordage, sell something, or eat the balloon.`,
  });
  return { s: next, msg: "Passed." };
}
