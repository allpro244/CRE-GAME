/**
 * HOW THIS TOWN STACKS UP AGAINST REAL ONES (2026-10-10).
 *
 * Thirty-two real US cities that stood between about 18,000 and 230,000
 * people in 2000 — boomtowns (Frisco, Gilbert, Bozeman), steady regional
 * centres (Sioux Falls, Madison, Fargo) and the Rust Belt (Youngstown, Gary,
 * Flint) — read off official files, every number with a source:
 *
 *   population   Census Bureau city estimates, 2000-2024 (annual, July 1)
 *   unemployment BLS Local Area Unemployment Statistics, the city's county
 *   pay          BLS QCEW average annual pay, all covered jobs, the county
 *   rent         HUD Fair Market Rent, two bedrooms, the city's FMR area
 *
 * (`src/data/peerCities.json` carries the URLs; the county is a weak proxy
 * for a suburb such as Gilbert or Frisco, and the pay and unemployment there
 * are the county's.)
 *
 * ONE NATION, SO ONE CYCLE. This game's nation is simulated and is not the
 * real one — its 2009 may be a boom. Comparing a town on the simulated cycle
 * with cities on the real one would rank the cycle, not the place. So every
 * peer is read RELATIVE to the real US in the same year — its unemployment
 * gap, its pay and rent as a share of the nation's — and laid on this game's
 * national path. Population is the record itself through 2024.
 *
 * AFTER THE RECORD ENDS, A PROJECTION, AND IT SAYS SO. The nation follows
 * the Census Bureau's 2023 projection (main series: 336M in 2024, a peak of
 * 369M about 2080, 366M in 2100), flat after it. A city's growth OVER the
 * nation's in its last ten years of record carries forward and fades with a
 * 17-year half-life — measured on these 32 cities: regressing each one's
 * 2014-24 excess growth on its 2000-10 excess growth gives 0.56 over 14
 * years. (A first cut used 30 years, a state-level persistence; it took
 * Frisco to 1.8M people by 2100. Cities build out faster than regions.)
 * Unemployment gap, pay share and rent share hold at their last five years'
 * average.
 *
 * MONEY IN 2000 DOLLARS. A century of this game's inflation makes "dollars
 * of the day" unreadable by 2100, so pay and rent are deflated by the
 * nation's price level. The nation's rent moves with the nation's pay — the
 * share of income spent on rent is about constant (Davis & Ortalo-Magné
 * 2011) — the same comparator the town's price level reads.
 */
import PEERS from "@/data/peerCities.json";
import type { GameState } from "./types";
import { START_YEAR } from "./types";
import { RENT_BASE } from "./market";

type Series = Record<string, number>;
type Peer = { name: string; state: string; county: string; pop: Series; unemp: Series; avgPay: Series; fmr2br: Series };
const DATA = PEERS as unknown as {
  sources: { series: string; url: string; retrieved?: string }[];
  usPop: Record<string, number>;
  usPopProj: Record<string, number>;
  us: { unemp: Series; avgPay: Series; rent2br: Series };
  cities: Peer[];
};

/** US population growth over the last census decade, per year (log) — the base a city's recent excess is read against. */
const US_GROWTH_RECENT = Math.log(DATA.usPop["2020"] / DATA.usPop["2010"]) / 10;
const TREND_HALF_LIFE_Y = 17;
/** The US population in a year past the record: the Census projection, flat after its last year. */
function usPopProj(year: number): number {
  const ys = Object.keys(DATA.usPopProj).map(Number);
  const last = Math.max(...ys), first = Math.min(...ys);
  return DATA.usPopProj[String(Math.min(last, Math.max(first, year)))];
}

export type RankRow = {
  name: string; state: string; you?: boolean;
  pop: number; growth10: number | null; unemp: number; pay: number; rent2br: number;
  projected: boolean;
};

function lastYear(s: Series): number {
  return Math.max(...Object.keys(s).map(Number).filter((y) => Number.isFinite(s[y])));
}
function at(s: Series, y: number): number | undefined {
  const v = s[String(y)];
  return Number.isFinite(v) ? v : undefined;
}
function meanOver(f: (y: number) => number | undefined, from: number, to: number): number {
  let sum = 0, n = 0;
  for (let y = from; y <= to; y++) { const v = f(y); if (v !== undefined && Number.isFinite(v)) { sum += v; n++; } }
  return n ? sum / n : 0;
}

/** A peer's population in a year: the record, or its projection past the record. */
export function peerPop(p: Peer, year: number): number {
  const L = lastYear(p.pop);
  if (year <= L) return at(p.pop, Math.max(2000, year)) ?? p.pop["2000"];
  const g = Math.log(p.pop[String(L)] / p.pop[String(L - 10)]) / 10;
  const n = year - L;
  const H = TREND_HALF_LIFE_Y;
  // The nation's path, times the city's excess fading: the integral of
  // (g - gUS) x 0.5^(t/H) over n years.
  const excess = (g - US_GROWTH_RECENT) * (H / Math.LN2) * (1 - Math.pow(0.5, n / H));
  return p.pop[String(L)] * (usPopProj(year) / usPopProj(L)) * Math.exp(excess);
}

/** The peer's gap or share against the US in a year — the record, or its last five years' mean. */
function relative(p: Series, us: Series, year: number, kind: "gap" | "share"): { v: number; projected: boolean } {
  const f = (y: number) => {
    const a = at(p, y), b = at(us, y);
    if (a === undefined || b === undefined || !(b > 0)) return undefined;
    return kind === "gap" ? a - b : a / b;
  };
  const L = Math.min(lastYear(p), lastYear(us));
  const y = Math.max(2000, year);
  if (y <= L) return { v: f(y) ?? meanOver(f, L - 4, L), projected: false };
  return { v: meanOver(f, L - 4, L), projected: true };
}

/** The national levels in this game's world: unemployment, average pay and a two-bed rent, in dollars of the day. */
function nationNow(s: GameState): { unemp: number; pay: number; rent: number } {
  const e = s.econ;
  const payIdx = (e.natWageIdx ?? e.wageIdx ?? 1) / Math.max(1e-6, e.wage0 ?? e.wageIdx ?? 1);
  const priceIdx = e.natCpi ?? e.cpi ?? 1;
  // In 2000 dollars: pay deflated by the nation's prices, and rent moving
  // with pay (a constant share of income), deflated the same way.
  const real = payIdx / Math.max(0.1, priceIdx);
  return {
    unemp: (e.nat?.unemp ?? e.unemployment ?? 0.05) * 100,
    pay: DATA.us.avgPay["2000"] * real,
    rent: DATA.us.rent2br["2000"] * real,
  };
}

/** The town's population ten years ago, from its own record. */
function townPopAgo(s: GameState, months: number): number | null {
  const h = s.econ.history ?? [];
  const i = h.length - 1 - months;
  return i >= 0 && h[i]?.population ? h[i].population! : null;
}

export function cityRankings(s: GameState, townName: string): { year: number; recordEnds: number; rows: RankRow[] } {
  const year = START_YEAR + Math.floor(s.month / 12);
  const nat = nationNow(s);
  const rows: RankRow[] = DATA.cities.map((p) => {
    const u = relative(p.unemp, DATA.us.unemp, year, "gap");
    const w = relative(p.avgPay, DATA.us.avgPay, year, "share");
    const r = relative(p.fmr2br, DATA.us.rent2br, year, "share");
    const pop = peerPop(p, year);
    const pop10 = year - 10 >= 2000 ? peerPop(p, year - 10) : null;
    return {
      name: p.name, state: p.state,
      pop: Math.round(pop),
      growth10: pop10 ? Math.pow(pop / pop10, 1 / 10) - 1 : null,
      unemp: Math.max(1.5, nat.unemp + u.v),
      pay: nat.pay * w.v,
      rent2br: nat.rent * r.v,
      projected: year > lastYear(p.pop) || u.projected || w.projected || r.projected,
    };
  });
  const e = s.econ;
  const pop = e.population ?? 0;
  const ago = townPopAgo(s, 120);
  const natRentPsf = RENT_BASE.multifamily * ((e.natWageIdx ?? e.wageIdx ?? 1) / Math.max(1e-6, e.wage0 ?? e.wageIdx ?? 1));
  rows.push({
    name: townName, state: "", you: true,
    pop: Math.round(pop),
    growth10: ago ? Math.pow(pop / ago, 1 / 10) - 1 : null,
    unemp: (e.unemployment ?? 0) * 100,
    pay: nat.pay * ((e.wageIdx ?? 1) / Math.max(1e-6, e.natWageIdx ?? e.wageIdx ?? 1)),
    rent2br: nat.rent * ((e.effRentIdx?.multifamily ?? e.rentIdx.multifamily) / natRentPsf),
    projected: false,
  });
  return { year, recordEnds: lastYear(DATA.cities[0].pop), rows };
}

export const PEER_SOURCES = DATA.sources;
