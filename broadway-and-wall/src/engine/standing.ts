// WHERE YOU STAND, AND WHAT THE YEAR DID.
//
// The game has always kept score — net worth every month, a league table of
// the firms on the street, nineteen milestones — and showed almost none of it
// unless you went looking. A year passed with a toast. This module is the
// reading of that score: one ranking, written once, and a record at each
// December close so a year can be told back to the player as a year.
//
// Nothing here is a new number. Equity is the same arithmetic the Street page
// has always ranked on (a rival's gross assets as `markRival` marks them, less
// its debt, plus its cash; the player's `netWorth`). The year mark draws no
// random numbers and changes nothing the economy reads.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { netWorth } from "./value";
import { markRival } from "./rivals";
import { firmName } from "./firm";
import { firmCapital, TIER_LABEL } from "./firmCapital";
import { inPlace, resolveRec } from "./value";
import { buyQuote } from "./actions";
import { PRODUCTS } from "./debt";

/** A rival's net equity — gross assets as marked, less debt, plus cash. The one expression. */
export const rivalEquity = (m: { aum: number }, r: { debt: number; cash: number }) => m.aum - r.debt + r.cash;

export interface Standing {
  rank: number;
  of: number;
  equity: number;
  leader: { name: string; eq: number; me: boolean };
  /** The firm one place above you, when there is one. */
  above: { name: string; eq: number } | null;
  /** The live firms' median equity, the player excluded. */
  medianRival: number;
}

/** Your place on the street by equity, among the firms still trading. */
export function streetStanding(s: GameState, parcels: ParcelTable, nwKnown?: number): Standing {
  const me = { name: firmName(s), eq: nwKnown ?? netWorth(s, parcels), me: true };
  const board = [me, ...(s.rivals ?? [])
    .filter((r) => r.failedM === undefined)
    .map((r) => ({ name: r.name, eq: rivalEquity(markRival(s, parcels, r), r), me: false }))]
    .sort((a, b) => b.eq - a.eq);
  const i = board.findIndex((x) => x.me);
  const others = board.filter((x) => !x.me).map((x) => x.eq).sort((a, b) => a - b);
  return {
    rank: i + 1,
    of: board.length,
    equity: me.eq,
    leader: board[0],
    above: i > 0 ? { name: board[i - 1].name, eq: board[i - 1].eq } : null,
    medianRival: others.length ? others[Math.floor((others.length - 1) / 2)] : 0,
  };
}

export interface YearMark { y: number; m: number; nw: number; rank: number; of: number; medianRival: number; holdings: number; above?: string; tier?: number }

/**
 * THE DECEMBER CLOSE, KEPT. Called from the tick on the same month the
 * balance sheet is stamped; also writes the opening mark the first time it
 * runs, so year one has a start. Mutates `s`.
 */
export function stampYearMark(s: GameState, parcels: ParcelTable, nw: number): void {
  if (!s.yearMarks) {
    const st0 = streetStanding(s, parcels, s.nwHistory?.[0] ?? nw);
    s.yearMarks = [{ y: -1, m: 0, nw: s.nwHistory?.[0] ?? nw, rank: st0.rank, of: st0.of, medianRival: st0.medianRival, holdings: 0, above: st0.above?.name, tier: firmCapital(s).tier }];
  }
  if (s.month % 12 !== 11) return;
  const y = Math.floor(s.month / 12);
  if (s.yearMarks.some((x) => x.y === y)) return;
  const st = streetStanding(s, parcels, nw);
  s.yearMarks.push({ y, m: s.month, nw: Math.round(nw), rank: st.rank, of: st.of, medianRival: Math.round(st.medianRival), holdings: Object.keys(s.holdings).length, above: st.above?.name, tier: firmCapital(s).tier });
  if (s.yearMarks.length > 240) s.yearMarks.splice(1, s.yearMarks.length - 240);
}

export interface YearReview {
  y: number;
  year: number;
  nw0: number; nw1: number; nwPct: number;
  rank0: number; rank1: number; of: number;
  streetPct: number;
  cashFromBuildings: number;
  overhead: number;
  taxes: number;
  bought: number; sold: number;
  deedsIn: number; deedsOut: number;
  leases: number;
  milestones: string[];
  next: { label: string } | null;
  verdict: string;
  /** The firm you climbed past, or the one that climbed past you. */
  passed: string | null;
  passedBy: string | null;
  tier0: string | null;
  tier1: string | null;
  /** The building whose income grew most over the year, and the one that emptied most. */
  star: { bbl: string; noi0: number; noi1: number } | null;
  worry: { bbl: string; occ0: number; occ1: number } | null;
}

/**
 * THE YEAR, TOLD BACK. Everything on it was already on the books: the marks
 * above, the year's ledger, the exits and deeds dated inside it, the
 * milestones stamped inside it. Null until the year has closed.
 */
export function yearReview(
  s: GameState,
  y: number,
  milestoneList: { id: string; label: string }[],
  startYear: number,
): YearReview | null {
  const marks = s.yearMarks ?? [];
  const end = marks.find((x) => x.y === y);
  const start = marks.filter((x) => x.y < y).sort((a, b) => b.y - a.y)[0];
  if (!end || !start) return null;
  const b = (s.books ?? []).find((e) => e.yr === y);
  const lo = y * 12, hi = lo + 11;
  const inYr = (m?: number) => m !== undefined && m >= lo && m <= hi;
  const deedsIn = Object.values(s.holdings).filter((h) => inYr(h.boughtM)).length
    + (s.exits ?? []).filter((e) => inYr(e.boughtM)).length;
  const deedsOut = (s.exits ?? []).filter((e) => inYr(e.soldM)).length;
  let leases = 0;
  for (const h of Object.values(s.holdings)) for (const t of h.tenants) if (inYr(t.startM) && t.startM > h.boughtM) leases++;
  const got = milestoneList.filter((m) => inYr(s.milestones?.[m.id])).map((m) => m.label);
  const nextM = milestoneList.find((m) => s.milestones?.[m.id] === undefined);
  // THE BUILDINGS, NOT JUST THE TOTAL. Each deed stamps a quarterly line
  // (month, occupancy per mille, rent, annualised NOI); read the stamp
  // nearest each end of the year.
  let star: YearReview["star"] = null, worry: YearReview["worry"] = null;
  for (const h of Object.values(s.holdings)) {
    const rows = (h.hist ?? []).filter((r) => r[0] >= lo - 3 && r[0] <= hi);
    if (rows.length < 2) continue;
    const a = rows[0], z = rows[rows.length - 1];
    if (z[0] - a[0] < 6) continue;
    const dNoi = z[3] - a[3];
    if (dNoi > 0 && (!star || dNoi > star.noi1 - star.noi0)) star = { bbl: h.bbl, noi0: a[3], noi1: z[3] };
    const dOcc = (z[1] - a[1]) / 1000;
    if (dOcc <= -0.05 && (!worry || dOcc < worry.occ1 - worry.occ0)) worry = { bbl: h.bbl, occ0: a[1] / 1000, occ1: z[1] / 1000 };
  }
  const nwPct = start.nw > 0 ? (end.nw / start.nw - 1) * 100 : 0;
  const streetPct = start.medianRival > 0 ? (end.medianRival / start.medianRival - 1) * 100 : 0;
  const cash = b ? Math.round(b.noi - b.debtSvc) : 0;
  const up = start.rank - end.rank;
  const beat = nwPct - streetPct;
  const verdict =
    end.nw <= 0 ? "A year spent underwater. The street is watching to see whether you surface."
    : up > 0 ? `${up === 1 ? "Up a place" : `Up ${up} places`} to ${ordinal(end.rank)} of ${end.of}. ${beat >= 0 ? "You outran the street" : "The street ran faster, and you still climbed"}.`
    : up < 0 ? `${up === -1 ? "Down a place" : `Down ${-up} places`} to ${ordinal(end.rank)} of ${end.of}. ${beat >= 0 ? "You grew — somebody grew faster" : "The street outran you this year"}.`
    : end.rank === 1 ? `Still the biggest book in town. ${beat >= 0 ? "And pulling away" : "The pack gained on you"}.`
    : `Holding ${ordinal(end.rank)} of ${end.of}. ${Math.abs(beat) < 2 ? "Level with the street" : beat > 0 ? "Gaining on the firms above" : "Losing ground to the street"}.`;
  return {
    y, year: startYear + y,
    nw0: start.nw, nw1: end.nw, nwPct,
    rank0: start.rank, rank1: end.rank, of: end.of,
    streetPct,
    cashFromBuildings: cash,
    overhead: b ? Math.round(b.ga) : 0,
    taxes: b ? Math.round(b.taxes) : 0,
    bought: b ? Math.round(b.bought) : 0,
    sold: b ? Math.round(b.sold) : 0,
    deedsIn, deedsOut, leases,
    milestones: got,
    next: nextM ? { label: nextM.label } : null,
    verdict,
    passed: up > 0 && start.above && start.above !== end.above ? start.above : null,
    passedBy: up < 0 && end.above && end.above !== start.above ? end.above : null,
    tier0: start.tier !== undefined ? TIER_LABEL[start.tier] ?? null : null,
    tier1: end.tier !== undefined ? TIER_LABEL[end.tier] ?? null : null,
    star, worry,
  };
}


export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export interface CareerCard {
  name: string; heir: string; age: number;
  fromYear: number; toYear: number; years: number;
  nw0: number; nw1: number;
  rank0: number | null; rank1: number | null; of: number | null;
  best: { rank: number; of: number; year: number } | null;
  bought: number; sold: number; milestones: string[];
  tax: number;
  verdict: string;
}

/** A principal's career, told back at their death — from the records already kept. */
export function careerCard(
  s: GameState, i: number, milestoneList: { id: string; label: string }[], startYear: number,
): CareerCard | null {
  const c = s.careers?.[i];
  if (!c) return null;
  const inT = (m?: number) => m !== undefined && m >= c.fromM && m <= c.toM;
  const nw0 = s.nwHistory?.[c.fromM] ?? s.nwHistory?.[0] ?? 0;
  const marks = (s.yearMarks ?? []).filter((m) => m.m >= c.fromM && m.m <= c.toM);
  const first = marks[0], last = marks[marks.length - 1];
  const bestM = marks.filter((m) => m.y >= 0).reduce<YearMark | null>((a, m) => (!a || m.rank < a.rank ? m : a), null);
  const bought = Object.values(s.holdings).filter((h) => inT(h.boughtM)).length + (s.exits ?? []).filter((e) => inT(e.boughtM)).length;
  const sold = (s.exits ?? []).filter((e) => inT(e.soldM)).length;
  const got = milestoneList.filter((m) => inT(s.milestones?.[m.id])).map((m) => m.label);
  const climbed = first && last ? first.rank - last.rank : 0;
  const x = nw0 > 0 ? c.gross / nw0 : 0;
  const verdict = last?.rank === 1 ? `${c.name} left the biggest book in town.`
    : climbed >= 5 ? `${c.name} climbed ${climbed} places on the street.`
    : x >= 10 ? `${c.name} turned the book ${x.toFixed(0)}-fold.`
    : x >= 2 ? `${c.name} left more than they found.`
    : x >= 1 ? `${c.name} held the line.`
    : `${c.name} left less than they were handed.`;
  return {
    name: c.name, heir: c.heir, age: c.age,
    fromYear: startYear + Math.floor(c.fromM / 12), toYear: startYear + Math.floor(c.toM / 12),
    years: Math.round((c.toM - c.fromM) / 12),
    nw0, nw1: c.gross,
    rank0: first?.rank ?? null, rank1: last?.rank ?? null, of: last?.of ?? null,
    best: bestM ? { rank: bestM.rank, of: bestM.of, year: startYear + bestM.y } : null,
    bought, sold, milestones: got, tax: c.tax, verdict,
  };
}

/**
 * WHAT IS WORTH A LOOK ON THE TAPE: listed buildings whose going-in yield
 * beats the cheapest money a desk will write against them — positive
 * leverage, the first test any buyer runs. The same two numbers the
 * financing card sets side by side (the in-place NOI at the ask, and the
 * cheapest all-in coupon of a desk that will lend); no opinion of its own.
 */
export function positiveLeverage(s: GameState, parcels: ParcelTable): { count: number; of: number; best: { bbl: string; cap: number; coupon: number } | null } {
  let count = 0, of = 0;
  let best: { bbl: string; cap: number; coupon: number } | null = null;
  for (const li of s.listings ?? []) {
    const rec = resolveRec(parcels, s, li.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea || li.halfBuilt || !(li.ask > 0)) continue;
    of++;
    const cap = (inPlace(rec, s, li.bbl, li.ask).noi / li.ask) * 100;
    let coupon = Infinity;
    for (const p of PRODUCTS) {
      if (p.mezz || p.id === "land") continue;
      const q = buyQuote(s, parcels, li.bbl, li.ask, p.id, 1);
      if (q.principal > 0 && q.allInPct < coupon) coupon = q.allInPct;
    }
    if (!Number.isFinite(coupon) || !(cap > coupon)) continue;
    count++;
    if (!best || cap - coupon > best.cap - best.coupon) best = { bbl: li.bbl, cap, coupon };
  }
  return { count, of, best };
}
