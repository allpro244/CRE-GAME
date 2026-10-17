/**
 * THE INVESTOR MARKET — a finite pool of equity the city attracts each year,
 * and raising from it (CAPITAL_RAISING_PLAN.md §3.1, §3.3).
 *
 * ONE CAPITAL MARKET. Investors are a finite population: when one sponsor
 * raises money, that money is not available to the next. Each year the city
 * attracts an amount of private real-estate equity in proportion to its size
 * and how it compares with other places to put money, split across investor
 * types that each open to sponsors at a reputation band (reputation.ts).
 * Rivals entering the city raise from the same pools; the player raises from
 * what they leave.
 *
 * CALIBRATION. US private real-estate equity raised a year — closed-end
 * funds, non-traded vehicles and direct syndication together — runs on the
 * order of $150–250B (Preqin; NAREIT on non-traded REITs), about $600 a
 * head; carried here at the town's price level. The split across investor
 * types follows the composition of private real-estate LPs (pensions the
 * largest single group, then high-net-worth and family offices, endowments
 * and foundations, insurers and sovereign wealth). Both are calibrations, not
 * fits; the attractiveness response is a shape parameter. This step does not
 * yet make a rival's entry wait on the pool (firmEntryPitch reading it is a
 * later, separately measured step, §0.5 5.5): rivals draw the pool down, and
 * the player competes for the remainder.
 *
 * RAISING TAKES TIME AND CAN FAIL (§3.3). A deal-by-deal raise is launched on
 * a planned job; soft circles arrive over up to three months as monthly
 * hazards driven by the sponsor's place in its band, from every source the
 * band opens plus the sponsor's own network. It closes when commitments
 * cover the target — or at the deadline, small if at least half is there and
 * the sponsor can carry the rest, failed otherwise. Offering counsel is paid
 * up front and is sunk either way.
 */
import type { Econ, GameState } from "./types";
import { logBooks } from "./types";
import { rng, payrollGrowth12 } from "./market";
import { bandIdx, reputationNow, type Band } from "./reputation";

export type InvestorSource = "ff" | "local" | "family" | "endowment" | "pension";

/** Private real-estate equity raised a year per head, in today's dollars. Calibration (see header). */
export const EQUITY_PER_HEAD = 600;

/** The investor types, their share of the city's pool, and the band each opens at. Shares: LP composition (see header). */
export const INVESTOR_TYPES: { id: Exclude<InvestorSource, "ff">; label: string; share: number; band: Band }[] = [
  { id: "local", label: "Local private investors", share: 0.30, band: "Emerging" },
  { id: "family", label: "Family offices and platforms", share: 0.25, band: "Proven" },
  { id: "endowment", label: "Endowments and smaller pensions", share: 0.20, band: "Institutional" },
  { id: "pension", label: "Large pensions, insurers and sovereign funds", share: 0.25, band: "Blue-chip" },
];
export const SOURCE_LABEL: Record<InvestorSource, string> = {
  ff: "Friends and family",
  local: "Local private investors", family: "Family offices and platforms",
  endowment: "Endowments and smaller pensions", pension: "Large pensions, insurers and sovereign funds",
};

const dollarLevel = (e: Econ) => (e.priceLevel ?? 1) * (e.cpi ?? 1);

/**
 * HOW THIS CITY COMPARES as a place to put money: job growth, and local
 * unemployment against the nation's. 1 = an ordinary market; a growing, tight
 * labour market draws more, a shocked one less. Shape parameter, bounded to
 * [0.4, 1.6] as a guard (it should not rest on the rails in normal play).
 */
export function cityAttractiveness(e: Econ): number {
  const growth = payrollGrowth12(e);
  const nat = e.history?.length ? e.history[e.history.length - 1].natUnemp : undefined;
  const gap = nat !== undefined && e.unemployment !== undefined ? nat - e.unemployment : 0;
  return Math.max(0.4, Math.min(1.6, 1 + 3 * growth + 4 * gap));
}

/** The year's pool, opened (or reopened at the turn of the year) on first touch. Mutates `s`. */
export function investorPool(s: GameState) {
  const yr = Math.floor(s.month / 12);
  if (!s.investorPool || s.investorPool.yr !== yr) {
    const total = Math.max(0, (s.econ.population ?? 0) * EQUITY_PER_HEAD * dollarLevel(s.econ) * cityAttractiveness(s.econ));
    const cap = {} as Record<string, number>;
    for (const t of INVESTOR_TYPES) cap[t.id] = Math.round(total * t.share);
    s.investorPool = { yr, cap, used: {}, rivals: 0, attract: cityAttractiveness(s.econ) };
  }
  return s.investorPool;
}

/** What is left this year of one investor type's money. */
export function poolLeft(s: GameState, id: Exclude<InvestorSource, "ff">): number {
  const p = investorPool(s);
  return Math.max(0, (p.cap[id] ?? 0) - (p.used[id] ?? 0));
}

/**
 * A RIVAL RAISING IN THE CITY draws the pool down (rivals.ts, at a firm's
 * entry): the local money first, then the family offices. It does not wait on
 * the pool yet (see header). Mutates `s`.
 */
export function drawRivalRaise(s: GameState, equity: number, ids: Exclude<InvestorSource, "ff">[] = ["local", "family"]): void {
  const p = investorPool(s);
  let rest = Math.max(0, equity);
  for (const id of ids) {
    const take = Math.min(rest, Math.max(0, (p.cap[id] ?? 0) - (p.used[id] ?? 0)));
    p.used[id] = (p.used[id] ?? 0) + take;
    rest -= take;
  }
  p.rivals += Math.max(0, equity);
}

/** The sources a sponsor in `band` can raise from, with what each has left. */
export function openSources(s: GameState, band: Band, ffLeft: number): { id: InvestorSource; left: number }[] {
  const out: { id: InvestorSource; left: number }[] = [];
  if (bandIdx(band) >= bandIdx("Questioned")) out.push({ id: "ff", left: Math.max(0, ffLeft) });
  for (const t of INVESTOR_TYPES) if (bandIdx(band) >= bandIdx(t.band)) out.push({ id: t.id, left: poolLeft(s, t.id) });
  return out;
}

/** Offering counsel for a deal-by-deal raise: about 1% of the raise, at least $25,000 in today's dollars. Industry convention for small syndications. */
export function raiseLegalCost(s: GameState, target: number): number {
  return Math.round(Math.max(25_000 * dollarLevel(s.econ), 0.01 * target));
}

/** Months a deal-by-deal raise stays open before it closes small or fails (§3.3: soft circles over 1–3 months). */
export const RAISE_WINDOW_M = 3;

/**
 * THE MONTHLY HAZARD for one source: the share of the remaining need it
 * soft-circles this month. Investors commit when they are confident, so the
 * top of a band fills fast and the bottom slowly; friends and family know the
 * sponsor and care less about the street's ranking. Shape parameters.
 */
export function commitHazard(source: InvestorSource, pct: number): number {
  const p = Math.max(0, Math.min(1, pct));
  return source === "ff" ? 0.30 + 0.25 * p : 0.12 + 0.45 * p;
}

/**
 * Where the player sits on the street, 0 (last) to 1 (#1). The band already
 * gates who takes the meeting; within it, investors still back the names
 * they rank higher (§3.4, "money follows rank, steeply").
 */
export function streetPercentile(s: GameState): number {
  const r = reputationNow(s);
  return r.of <= 1 ? 1 : Math.max(0, Math.min(1, (r.of - r.rank) / (r.of - 1)));
}

/** A deal-by-deal raise in progress. */
export interface Raise {
  bbl: string;
  target: number;
  openedM: number;
  deadlineM: number;
  committed: Partial<Record<InvestorSource, number>>;
  legal: number;
  /** The sponsor's own share of the job, held while the raise is open (raise.ts sponsorShare). */
  reserve?: number;
  /** The job, exactly as the Build desk would break ground on it. */
  job: { use: string; floors: number; coverage: number; contract: string; ltc?: number; custom?: Record<string, unknown>; lender?: string; spec: number };
}

export function committedTotal(r: Raise): number {
  let t = 0;
  for (const v of Object.values(r.committed)) t += v ?? 0;
  return t;
}

/** Book the offering counsel when a raise is launched. Mutates `s`. */
export function payRaiseLegal(s: GameState, amt: number): void {
  if (!(amt > 0)) return;
  s.cash -= amt;
  logBooks(s, "ga", amt);
}

/**
 * THE RELATIONSHIP (§3.2): investors who were paid back by this sponsor re-up
 * first, and the better the multiple the faster; investors it lost money for
 * stay mostly out for a decade (§3.4: family offices out ten years, platforms
 * delist). Read from the last ten years of wound-up deals each source was in.
 * Friends and family carry their memory in the network's size instead
 * (syndicate.ts). A multiplier on the source's hazard; shape parameters.
 */
export function relationshipFactor(s: GameState, src: InvestorSource): number {
  if (src === "ff") return 1;
  let best = 0, lost = false;
  for (const c of s.synClosed ?? []) {
    if (s.month - c.closedM > 120 || !(c.sources?.[src]) || !(c.lpIn > 0)) continue;
    const m = c.lpOut / c.lpIn;
    if (m < 1 || c.misconduct) lost = true;
    best = Math.max(best, m);
  }
  if (lost) return 0.3;
  return 1 + Math.min(0.5, Math.max(0, best - 1));
}

/**
 * ONE MONTH OF SOFT CIRCLES for a raise. Mutates `r` (and draws the
 * "capital" random stream, which nothing else reads). Returns the month's new
 * commitments.
 *
 * Each source circles a share of the OFFERING a month (its hazard), up to
 * what is still needed and what it has. It used to circle a share of what
 * was still NEEDED, which approaches the target and never reaches it: every
 * raise ran its full three months and closed small (12 of 12 in two
 * 60-year raising runs, at 66-99% of target). A source that knows the
 * sponsor well now fills a modest offering in two or three months, and a
 * raise that several sources want can close in one.
 */
export function circleMonth(s: GameState, r: Raise, sources: { id: InvestorSource; left: number }[], pct: number): number {
  let added = 0;
  for (const src of sources) {
    const need = r.target - committedTotal(r);
    if (!(need > 0)) break;
    const room = Math.max(0, src.left - (r.committed[src.id] ?? 0));
    if (!(room > 0)) continue;
    const cap = Math.min(need, room);
    const c = Math.min(cap, Math.round(r.target * Math.min(0.95, commitHazard(src.id, pct) * relationshipFactor(s, src.id)) * (0.6 + 0.8 * rng(s, "capital"))));
    if (c > 0) { r.committed[src.id] = (r.committed[src.id] ?? 0) + c; added += c; }
  }
  return added;
}

