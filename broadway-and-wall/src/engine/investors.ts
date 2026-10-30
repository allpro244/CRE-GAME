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
 * CALIBRATION. The first cut counted only new private commitments —
 * closed-end funds, non-traded vehicles and syndication, $150–250B a year
 * (Preqin; NAREIT), about $600 a head. The equity that actually reaches US
 * commercial property each year is the larger number the owner asked for
 * (Oct 2026): add open-end core funds' net inflows, separate accounts and
 * programmatic JVs, cross-border capital and REIT equity raised, and it is
 * on the order of $400-500B — about $1,500 a head. Carried at the town's
 * price level. The split across investor
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
import { bandIdx, reputationNow, scaleMult, type Band } from "./reputation";

export type InvestorSource = "ff" | "local" | "family" | "endowment" | "pension";

/** Private real-estate equity raised a year per head, in today's dollars. Calibration (see header). */
export const EQUITY_PER_HEAD = 1500;

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

/**
 * THE SHARE OF ITS INVESTABLE MONEY A SAVER PUTS IN REAL ESTATE: 10.8%, the
 * average target allocation to real estate across investors surveyed by the
 * Hodes Weill & Associates / Cornell Baker Real Estate Allocations Monitor
 * (2023). That survey is of institutions; it is used for the town's
 * wealthier savers as well, the people who buy into a local sponsor's fund.
 * Calibration. [S]
 */
export const RE_ALLOC = 0.108;

/**
 * THE TOWN'S SAVERS, as the household register reads them (households.ts
 * fills these in: investableSurplus, commitSavings). A hook rather than an
 * import, because the register imports half the engine and this file is
 * imported by the other half.
 */
export const SAVERS: {
  surplus?: (s: GameState) => { dollars: number; savers: number } | null;
  commit?: (s: GameState, amount: number, alloc: number) => { taken: number; savers: number };
} = {};

/**
 * WHAT REAL ESTATE IS EXPECTED TO PAY, against the ten-year (FORMULA_LEDGER
 * #21): the street's going-in yield (the mean of its cap rates by class) plus
 * rents growing with expected inflation, less the ten-year yield. Savers and
 * institutions move money into the class when that premium is wide and out
 * of it when it is thin.
 */
export function rePremium(e: Econ): number {
  const caps = Object.values(e.capRate ?? {}).filter((x) => Number.isFinite(x) && x > 0);
  if (!caps.length) return RE_PREMIUM_NORM;
  const cap = caps.reduce((a, x) => a + x, 0) / caps.length / 100;
  return cap + (e.inflExp ?? 0.02) - (e.indexRate ?? 0) / 100;
}
/**
 * The long-run premium of unlevered property over the ten-year: about three
 * points (NCREIF NPI total return 1978-2023 ~8.5% a year against a ten-year
 * Treasury averaging ~5.6%). Calibration. [S]
 */
const RE_PREMIUM_NORM = 0.03;
/**
 * THE SHARE OF ITS INVESTABLE MONEY A SAVER PUTS IN REAL ESTATE THIS YEAR:
 * the surveyed target allocation (RE_ALLOC, 10.8%) at the class's normal
 * premium, in proportion to the premium on offer — nothing when property
 * yields no more than the ten-year, twice the target at twice the normal
 * premium (a guard). Proportional is a shape parameter (unit elasticity of the
 * allocation to the expected excess return), not a fit. [K]
 */
export function reAllocation(e: Econ): number {
  return RE_ALLOC * Math.max(0, Math.min(2, rePremium(e) / RE_PREMIUM_NORM));
}

/**
 * The year's pool, opened (or reopened at the turn of the year) on first touch. Mutates `s`.
 *
 * LOCAL MONEY IS THE TOWN'S SAVERS (FORMULA_LEDGER #21): once the household
 * register is running, the local investors' pool is what its households hold
 * over their goals (households.ts investableSurplus) at this year's
 * allocation to real estate (reAllocation). Before the register exists (the
 * opening, an old save) it is the per-head calibration's local share. The
 * institutions' money is the per-head calibration (header), at the same
 * allocation response to what the class is expected to pay.
 */
export function investorPool(s: GameState) {
  const yr = Math.floor(s.month / 12);
  if (!s.investorPool || s.investorPool.yr !== yr) {
    const tilt = reAllocation(s.econ) / RE_ALLOC;
    const total = Math.max(0, (s.econ.population ?? 0) * EQUITY_PER_HEAD * dollarLevel(s.econ) * cityAttractiveness(s.econ)) * tilt;
    const cap = {} as Record<string, number>;
    for (const t of INVESTOR_TYPES) cap[t.id] = Math.round(total * t.share);
    const sur = SAVERS.surplus?.(s);
    if (sur) cap.local = Math.round(sur.dollars * reAllocation(s.econ));
    s.investorPool = { yr, cap, used: {}, rivals: 0, attract: cityAttractiveness(s.econ) };
  }
  return s.investorPool;
}

/**
 * Local money committed to a fund — the rivals' raises, the player's
 * syndicates and funds alike — leaves the savers' accounts (households.ts
 * commitSavings). Returns the households (weighted) that put money in.
 */
export function commitLocal(s: GameState, amount: number): number {
  if (!(amount > 0) || !s.households) return 0;
  return SAVERS.commit?.(s, amount, reAllocation(s.econ)).savers ?? 0;
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
export function drawRivalRaise(s: GameState, equity: number, ids: Exclude<InvestorSource, "ff">[] = ["local", "family"]): RaiseFrom {
  const p = investorPool(s);
  let rest = Math.max(0, equity);
  const out: RaiseFrom = { savers: 0 };
  for (const id of ids) {
    const take = Math.min(rest, Math.max(0, (p.cap[id] ?? 0) - (p.used[id] ?? 0)));
    p.used[id] = (p.used[id] ?? 0) + take;
    out[id] = take;
    if (id === "local" && take > 0) out.savers = commitLocal(s, take);
    rest -= take;
  }
  p.rivals += Math.max(0, equity);
  return out;
}
/** Where a rival's raise came from: dollars by investor type, and the local households (weighted) that put money in. */
export type RaiseFrom = Partial<Record<Exclude<InvestorSource, "ff">, number>> & { savers: number };

/** The sources a sponsor in `band` can raise from, with what each has left. */
export function openSources(s: GameState, band: Band, ffLeft: number): { id: InvestorSource; left: number }[] {
  const out: { id: InvestorSource; left: number }[] = [];
  if (bandIdx(band) >= bandIdx("Questioned")) out.push({ id: "ff", left: Math.max(0, ffLeft) });
  // The biggest firms reach money from well beyond the city (scaleMult): the
  // same types, the national allocations as well as the local ones.
  const reach = scaleMult(s);
  for (const t of INVESTOR_TYPES) if (bandIdx(band) >= bandIdx(t.band)) out.push({ id: t.id, left: poolLeft(s, t.id) * reach });
  return out;
}

/** Offering counsel for a deal-by-deal raise: about 1% of the raise, at least $25,000 in today's dollars. Industry convention for small syndications. */
export function raiseLegalCost(s: GameState, target: number): number {
  return Math.round(Math.max(25_000 * dollarLevel(s.econ), 0.01 * target));
}

/**
 * Months a deal-by-deal raise stays open before it closes small or fails.
 * THE RAISE IS THE PRE-DEVELOPMENT WINDOW (owner, Oct 2026: "it feels off
 * that you can't execute the raise and start construction at the same
 * time"). A sponsor raises equity while the drawings, permits and the
 * contractor's bid are being finished — three to nine months on a real job —
 * and closes the equity with the construction loan. Three months was a
 * waiting room: measured over 19 playtest raises by a new sponsor, none
 * filled, nine closed small on the last day and ten failed. Six months, with
 * the sponsor able to close early once half is in (raise.ts closeRaiseNow).
 */
export const RAISE_WINDOW_M = 6;
/**
 * HOW STEADY A MONTH OF CIRCLES IS. Investors commit at a pace the sponsor
 * can read off its band, its rank and the deal — a month runs 85-115% of that
 * pace, not 60-140% as it did. A raise is work, not a dice roll.
 */
export function circleNoise(u: number): number {
  return 0.85 + 0.3 * u;
}

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
  /** How the offering reads to investors, 0-1.25 (pitchAppeal): a multiplier on every source's hazard. */
  appeal?: number;
  /** The job, exactly as the Build desk would break ground on it. */
  job: { use: string; floors: number; coverage: number; contract: string; ltc?: number; custom?: Record<string, unknown>; lender?: string; spec: number };
}

/**
 * What the sponsor's open raises hold of its money (each its own share of its
 * job, at launch). Nothing else may spend it — another raise, or ground
 * broken with the sponsor's own cash — or the raise fails at its closing
 * with the counsel already paid.
 */
export function heldByRaises(s: GameState, except?: string): number {
  let t = 0;
  for (const [b, r] of Object.entries(s.raises ?? {})) if (b !== except) t += r.reserve ?? 0;
  return t;
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
/**
 * WHAT THE PITCH IS WORTH TO AN INVESTOR (§3.3, §3.4 "The promise"): the net
 * IRR offered against the pref the band's terms sign them at. Investors
 * haircut the pitch of a sponsor below Proven (20%, §3.4), an offering at the
 * pref circles at the ordinary pace, a richer one faster (to 1.25x), a thin
 * one slower, and one that projects a loss does not raise at all.
 */
/**
 * HOW THE SPONSOR PITCHES (§3.4 "The promise"): against the engine's own
 * projection, conservative (three-quarters of it), base (all of it) or
 * aggressive (15% over it). A richer pitch raises faster today and is the
 * bar the record judges tomorrow. Shape parameters.
 */
export type PitchStyle = "conservative" | "base" | "aggressive";
export const PITCH_MULT: Record<PitchStyle, number> = { conservative: 0.75, base: 1, aggressive: 1.15 };

export function pitchAppeal(pitch: number, pref: number, band: Band): number {
  const read = pitch * (bandIdx(band) < bandIdx("Proven") ? 0.8 : 1);
  if (!(pref > 0)) return 1;
  return Math.max(0, Math.min(1.25, read / pref));
}

export function circleMonth(s: GameState, r: Raise, sources: { id: InvestorSource; left: number }[], pct: number): number {
  let added = 0;
  for (const src of sources) {
    const need = r.target - committedTotal(r);
    if (!(need > 0)) break;
    const room = Math.max(0, src.left - (r.committed[src.id] ?? 0));
    if (!(room > 0)) continue;
    const cap = Math.min(need, room);
    const c = Math.min(cap, Math.round(r.target * Math.min(0.95, commitHazard(src.id, pct) * relationshipFactor(s, src.id) * (r.appeal ?? 1) * scaleMult(s)) * circleNoise(rng(s, "capital"))));
    if (c > 0) { r.committed[src.id] = (r.committed[src.id] ?? 0) + c; added += c; }
  }
  return added;
}

