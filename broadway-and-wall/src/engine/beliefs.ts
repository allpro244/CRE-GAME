// WHAT EACH FIRM BELIEVES (ONE_ECONOMY_PLAN.md §6c-C: beliefs and information).
//
// The builders and the bidders used to read the town's true rent history, its
// true vacancy this month and its true demand trend — numbers nobody in a real
// market has. A developer deciding a tower in 1985 had its broker's comps, its
// own buildings' rent rolls and a survey that described the market as it had
// been two quarters earlier. Here each named firm forms its own forecast from
// exactly those three, once a quarter:
//
//   THE SURVEY. Published market reads (RERC, PwC/Korpacz, the brokerage
//   quarterlies) describe the market as it was, not as it is: appraisal- and
//   survey-based series lag transaction-based ones by two to four quarters
//   (Geltner 1989; Fisher, Geltner & Webb 1994; Clayton, Ling & Naranjo 2009).
//   Commercial classes read the history SURVEY_LAG_M months back [S~: the
//   middle of that range]. Apartment asking rents are published monthly
//   (RealPage, Yardi Matrix), so flats read two months back [S~].
//
//   THE BROKER. Each firm works with one of the town's three house shops
//   (broker.ts), and a shop sees the leases it does — a third of the town's,
//   by the same seed-hash that gives each parcel its shop. Those comps are
//   current. A firm believes its broker's deals over the survey in proportion
//   to how many there are (Buhlmann credibility: COMP_CRED deals weigh as much
//   as the survey, a shape parameter). The broker's opinion of a cap rate is
//   the class read as of the last trade the shop itself closed — stale when
//   the shop has not printed in a while, which is how appraisers' and
//   brokers' values lag a fast market.
//
//   ITS OWN BUILDINGS. Its rent rolls are current and exact for its own
//   floors, and it weights its own vacancy by how much of the class it owns
//   (the same credibility shape as the submarket read, propmarket.ts
//   locBelief).
//
// FROM WHAT IT SEES TO WHAT IT EXPECTS. Survey expectations of returns load
// on the recent past — most heavily on the last year — and not on what
// subsequently happens (Greenwood & Shleifer 2014; for housing, Case, Shiller
// & Thompson 2012; Glaeser & Nathanson 2017). So the growth a firm expects is
// an exponentially weighted memory of the growth it has seen, half the weight
// on the last year (MEMORY_HALF_Q), and the demand growth it underwrites is
// the absorption it has seen, remembered the same way. Shape parameters,
// stated as such and chosen from those papers, not fitted to a cycle here.
//
// That is the whole mechanism of overbuilding in Wheaton (1999) and Greenwood
// & Hanson (2015): every builder extrapolates the boom it has seen, two
// quarters late, to its own delivery date. Nothing here says "overshoot".
//
// No RNG is drawn here. The ledger events are written only when a decision
// cites a belief (`whyBelief`), so a world with the ledger is the same world.
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, ClassBelief, EconHistoryPoint, GameState, Rival } from "./types";
import { BUILT_CLASSES } from "./types";
import { hash01 } from "./competitorTraits";
import { houseBrokerName, brokerIdFor } from "./broker";
import { resolveRec, streetLetShare, useRentableSf } from "./value";
import { normalVac } from "./market";
import { whyOnce } from "./why";

/** Months a commercial survey lags the market [S~ 2-4 quarters; see the head]. */
export const SURVEY_LAG_M = 6;
/** Months the published apartment asking-rent series lags [S~ monthly releases]. */
const FLATS_LAG_M = 2;
/** Leases from its own broker that weigh as much as the survey [K, credibility]. */
const COMP_CRED = 4;
/** Quarters for an observation's weight in the growth memory to halve [K, Greenwood-Shleifer 2014]. */
const MEMORY_HALF_Q = 4;
const ALPHA = 1 - Math.pow(0.5, 1 / MEMORY_HALF_Q);
/** Ten years of quarterly reads: the memory a firm measures today's level against. */
const SEEN_Q = 40;
/** Own share of the class at which its own floors weigh half [K, propmarket.ts locBelief's 0.1]. */
const OWN_CRED = 0.1;
/**
 * The rent growth an underwriter carries, a share a year. Investor surveys
 * of assumed market rent growth (PwC/Korpacz; RERC) run from about nothing to
 * about 6% a year across markets and cycles [S] — the same range rivals.ts
 * rentSignals clipped to. A guard, not a target.
 */
const G_RANGE = 0.06;

export const lagOf = (k: BuiltClass) => (k === "multifamily" ? FLATS_LAG_M : SURVEY_LAG_M);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** The house shop a firm works with: stable for its life, no RNG. */
export function shopOf(s: GameState, id: string): string {
  return `b${Math.floor(hash01(`bkcl:${s.seed}:${id}`) * 3)}`;
}
export function shopName(s: GameState, shop: string): string {
  return houseBrokerName(s, Number(shop.slice(1)) || 0);
}
/** Which shop brokered a lease comp: a third each, seed-hashed like parcels. */
function compShop(s: GameState, k: BuiltClass, c: { m: number; sf: number; b: number; e: number }): string {
  return `b${Math.floor(hash01(`lc:${s.seed}:${k}:${c.m}:${c.sf}:${c.b}:${c.e}`) * 3)}`;
}

/** The survey as published `lag` months after the month it describes. */
function surveyAt(h: EconHistoryPoint[], back: number): EconHistoryPoint | undefined {
  if (!h.length) return undefined;
  return h[Math.max(0, h.length - 1 - back)];
}
const realRent = (p: EconHistoryPoint | undefined, k: BuiltClass) => {
  const r = p?.effRent?.[k] ?? p?.rent?.[k];
  return r && r > 0 && (p?.cpi ?? 1) > 0 ? r / (p?.cpi ?? 1) : NaN;
};
const occGrowthM = (h: EconHistoryPoint[], back: number, k: BuiltClass) => {
  const a = surveyAt(h, back)?.occupied?.[k], b = surveyAt(h, back + 12)?.occupied?.[k];
  return a && b && a > 0 && b > 0 && h.length > back + 12 ? Math.pow(a / b, 1 / 12) - 1 : 0;
};

/** A firm with no broker and no buildings: the survey alone, read from history. */
function fromSurvey(s: GameState, k: BuiltClass): ClassBelief {
  const h = s.econ.history ?? [];
  const L = lagOf(k);
  const seen: number[] = [];
  for (let q = SEEN_Q - 1; q >= 0; q--) {
    if (h.length - 1 - L - 3 * q < 0) continue;
    const v = realRent(surveyAt(h, L + 3 * q), k);
    if (Number.isFinite(v)) seen.push(v);
  }
  // the growth memory started from the survey's own record, quarter by quarter
  let g = 0, dg = 0;
  for (let i = 1; i < seen.length; i++) g += ALPHA * (4 * Math.log(seen[i] / seen[i - 1]) - g);
  for (let q = Math.min(SEEN_Q, Math.floor((h.length - L - 12) / 3)) - 1; q >= 0; q--) dg += ALPHA * (occGrowthM(h, L + 3 * q, k) - dg);
  const p = surveyAt(h, L);
  const mean = seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : NaN;
  const now = seen[seen.length - 1];
  return {
    seen, g: clamp(g, -G_RANGE, G_RANGE),
    dev: seen.length >= 12 && Number.isFinite(now) ? clamp(now / mean - 1, -0.6, 1.5) : 0,
    vac: p?.vac?.[k] ?? normalVac(s.econ, k),
    dg, cap: p?.cap?.[k] ?? s.econ.capRate?.[k] ?? 0,
    nC: 0, ownSf: 0, lagM: L,
  };
}

/** Its own floors in a class: rentable feet and the share let, off its rolls. */
function ownBook(s: GameState, parcels: Record<string, ParcelRecord> | null, r: Rival | null, k: BuiltClass): { sf: number; occ: number } {
  if (!r || !parcels) return { sf: 0, occ: 0 };
  let sf = 0, let_ = 0;
  for (const bbl of r.bbls ?? []) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class !== k) continue;
    const area = useRentableSf(rec, k);
    const sh = streetLetShare(rec, s.econ, k);
    if (!(area > 0) || sh === undefined) continue;
    sf += area; let_ += area * sh;
  }
  return { sf, occ: sf > 0 ? let_ / sf : 0 };
}

/** The broker's opinion of a cap: the class read as of the last trade its shop closed. */
function shopCap(s: GameState, shop: string, k: BuiltClass): number | undefined {
  const t = s.capTape ?? [];
  const h = s.econ.history ?? [];
  for (let i = t.length - 1; i >= 0; i--) {
    const p = t[i];
    if (p.k !== k || p.kind !== "t" || brokerIdFor(s, p.bbl) !== shop) continue;
    const back = s.month - p.m;
    return surveyAt(h, back)?.cap?.[k];
  }
  return undefined;
}

function update(s: GameState, parcels: Record<string, ParcelRecord> | null, id: string, r: Rival | null): void {
  const all = (s.beliefs ??= {});
  const shop = r ? shopOf(s, id) : "";
  const prev = all[id];
  const e = s.econ, h = e.history ?? [];
  const cpi = e.cpi ?? 1;
  const out = {} as Record<BuiltClass, ClassBelief>;
  for (const k of BUILT_CLASSES) {
    const old = prev?.c?.[k];
    if (!old || !old.seen.length) { out[k] = fromSurvey(s, k); continue; }
    const L = lagOf(k);
    const p = surveyAt(h, L);
    const news = realRent(p, k);
    // the leases its broker closed this quarter, current
    let csf = 0, cv = 0, nC = 0;
    if (shop) for (const c of e.comps?.[k] ?? []) {
      if (c.m <= s.month - 3 || c.r || compShop(s, k, c) !== shop) continue;
      csf += c.sf; cv += c.e * c.sf; nC++;
    }
    const w = nC / (nC + COMP_CRED);
    const comp = csf > 0 && cpi > 0 ? cv / csf / cpi : NaN;
    const obs = Number.isFinite(comp) ? (Number.isFinite(news) ? w * comp + (1 - w) * news : comp) : news;
    const seen = old.seen.slice();
    let g = old.g;
    if (Number.isFinite(obs) && obs > 0) {
      const last = seen[seen.length - 1];
      if (last > 0) g += ALPHA * (4 * Math.log(obs / last) - g);
      seen.push(obs);
      while (seen.length > SEEN_Q) seen.shift();
    }
    const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
    const now = seen[seen.length - 1];
    // vacancy: the survey, and its own floors as far as they are the market
    const own = ownBook(s, parcels, r, k);
    const stock = Math.max(1, e.stock?.[k] ?? 1);
    const wo = own.sf > 0 ? (own.sf / stock) / (own.sf / stock + OWN_CRED) : 0;
    const vacS = p?.vac?.[k] ?? old.vac;
    const vac = wo > 0 ? wo * (1 - own.occ) + (1 - wo) * vacS : vacS;
    const dg = old.dg + ALPHA * (occGrowthM(h, L, k) - old.dg);
    out[k] = {
      seen, g: clamp(g, -G_RANGE, G_RANGE),
      dev: seen.length >= 12 ? clamp(now / mean - 1, -0.6, 1.5) : 0,
      vac, dg,
      cap: (shop ? shopCap(s, shop, k) : undefined) ?? p?.cap?.[k] ?? old.cap,
      nC, ownSf: Math.round(own.sf), lagM: L,
    };
  }
  all[id] = { m: s.month, shop, c: out };
}

/**
 * ONCE A QUARTER every living firm, and the anonymous trade ("street"),
 * revises what it believes. Called from the month, before anyone builds or bids.
 */
export function tickBeliefs(s: GameState, parcels: Record<string, ParcelRecord>): void {
  const due = s.month % 3 === 0;
  const alive = new Set<string>(["street"]);
  if (due || !s.beliefs?.street) update(s, parcels, "street", null);
  for (const r of s.rivals ?? []) {
    if (r.failedM !== undefined || r.retiredM !== undefined) continue;
    alive.add(r.id);
    if (due || !s.beliefs?.[r.id]) update(s, parcels, r.id, r);
  }
  if (due && s.beliefs) for (const id of Object.keys(s.beliefs)) if (!alive.has(id)) delete s.beliefs[id];
}

/** What this firm (or, with null, the anonymous trade) believes of a class. */
export function beliefOf(s: GameState, r: { id: string } | null | undefined, k: BuiltClass): ClassBelief {
  const b = s.beliefs?.[r?.id ?? "street"]?.c?.[k] ?? s.beliefs?.street?.c?.[k];
  return b ?? fromSurvey(s, k);
}

/** The rent signals a firm reads (the shape rivals.ts rentSignals had): its expected growth and its level against its memory. */
export function beliefSignals(s: GameState, r: { id: string } | null | undefined): Record<BuiltClass, { g: number; dev: number }> {
  const out = {} as Record<BuiltClass, { g: number; dev: number }>;
  for (const k of BUILT_CLASSES) { const b = beliefOf(s, r, k); out[k] = { g: b.g, dev: b.dev }; }
  return out;
}

/**
 * Months the listing shop markets a building to its own buyers before the
 * offering memorandum goes to the whole street. Investment-sales brokers
 * "pre-market" to their own client list for a few weeks ahead of the wide
 * launch [S~: 2-6 weeks in capital-markets practice; one month].
 */
export const PREMARKET_M = 1;

/**
 * WHO HEARS OF A LISTING. The shop that has the seller's ear (broker.ts
 * brokerIdFor) brings its own clients first; everyone else hears when the
 * memorandum goes wide, PREMARKET_M later. A round with no listing date (a
 * forced-sale estimate, a lender's quick look) is open to all.
 */
export function hearsOfListing(s: GameState, r: { id: string }, li: { bbl: string; listedM?: number }): boolean {
  if (li.listedM === undefined || s.month - li.listedM >= PREMARKET_M) return true;
  return shopOf(s, r.id) === brokerIdFor(s, li.bbl);
}

/**
 * THE BELIEF BEHIND A DECISION, on the cause ledger, once per firm, class and
 * quarter: "Ridgeway underwrote 4.0% rent growth: 9 leases through Marsh
 * Reade and a survey six months old". Returns the event id to cite.
 */
export function whyBelief(s: GameState, r: { id: string; name?: string } | null | undefined, k: BuiltClass): number {
  const id = r?.id ?? "street";
  const q = Math.floor(s.month / 3);
  return whyOnce(s, `belief:${id}:${k}:${q}`, () => {
    const b = beliefOf(s, r, k);
    const who = r?.name ?? "The town's builders";
    const shop = r ? shopOf(s, id) : "";
    const from = [
      b.nC > 0 ? `${b.nC} lease${b.nC === 1 ? "" : "s"} through ${shopName(s, shop)} this quarter` : "",
      b.ownSf > 0 ? `its own ${Math.round(b.ownSf / 1000)}k sf` : "",
      `a survey ${b.lagM} months old`,
    ].filter(Boolean).join(", ");
    const trail = b.seen.length >= 2 ? Math.pow(b.seen[b.seen.length - 1] / b.seen[Math.max(0, b.seen.length - 5)], 1 / Math.min(4, b.seen.length - 1) * 4) - 1 : 0;
    return {
      k: "belief.rent", a: "rival", aid: id, name: who,
      n: { g: +(b.g * 100).toFixed(2), vac: +(b.vac * 100).toFixed(2), dgYr: +(b.dg * 1200).toFixed(2), cap: +b.cap.toFixed(2), comps: b.nC, lagM: b.lagM },
      t: `${who} underwrote ${(b.g * 100).toFixed(1)}% real ${k} rent growth (it has seen ${(trail * 100).toFixed(1)}% over the last year) and ${(b.vac * 100).toFixed(1)}% vacancy: ${from}`,
    };
  });
}
