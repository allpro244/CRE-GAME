// BLACK SWANS (2026-10-14; split 2026-10-29, ONE_ECONOMY_PLAN.md step 8).
//
// The owner's rule, which this file is now built on: a swan is EITHER a
// random national event — something that happens to the country by chance and
// reaches the city through the national economy and its trades — OR it is
// grown by the city's own simulation, from somebody's books. Nothing in
// between, and nothing that sets a rent.
//
// RANDOM, NATIONAL (drawn here, on the "shock" stream, at hazards read off the
// record). Each acts through the national model (market.ts tickNation and
// spendNation: households' spending, firms' plans, the government's, the
// world's demand, the dollar, credit spreads, inflation), the price of oil
// (inputs.ts) and the trades' orders (`swanSec`, read by tickIndustryCycle
// beside the national cycle). The market answers the way it answers anything.
//
//   THE EMBARGO — October 1973: a supply shock on the nation (oil x3,
//     inflation 3% -> 12% in a year) and materials dearer than CPI.
//   THE CAPITAL WAVE — 1986-90, when Japanese buyers paid yields nobody local
//     would, then went home: cap rates in and back out.
//   THE ARRIVALS — the Mariel boatlift (1980), the 1990-91 aliyah: 3-8% more
//     people in months, doubling up before the builders catch up.
//   THE PANDEMIC — 1918, 1957, 1968, 2020: services and travel collapse, then
//     come back; offices empty for a while and refill. No permanent telework
//     era (owner's ruling): the space comes back as the episode ends.
//   THE WAR — Korea 1950, Vietnam 1965, the Gulf 1990, Iraq 2003, Ukraine
//     2022: defense spending, oil, inflation, and a central bank told this is
//     not the moment.
//   THE FOREIGN CRISIS — Latin America 1982, Mexico 1994, Asia and Russia
//     1997-98, the euro 2010-12: the world buys less, money runs to the dollar
//     and credit spreads blow out.
//   THE TECH BOOM — the 1920s radio, the 1960s electronics, 1995-2000, the
//     2010s: technology and services exports run far ahead for years, and more
//     often than not break.
//   THE TRADE WAR — Smoot-Hawley 1930, the 1971 surcharge, 2002 steel,
//     2018-19: tariffs raise import prices, retaliation takes factory and farm
//     exports, investment waits.
//
// GROWN BY THE SIMULATION.
//
//   THE PANIC — kept, and its odds grow with the private credit gap
//     (Schularick & Taylor 2012); the hole lands on a named lender's books.
//   THE FISCAL CRISIS — the city's own budget failing to roll its debt
//     (citygov.ts); not drawn here.
//   THE ANCHOR — no longer a hazard. A real employer looking for a
//     headquarters or campus puts this city on a shortlist and chooses it, or
//     not, on what the city costs against the alternatives — its pay, its
//     business rents (market.ts cityLogCost, the same read that brakes the
//     town's growth) and its taxes (citygov.ts); and one that came reviews
//     the choice when its lease comes up and leaves if the city has grown
//     dear. Strauss-Kahn & Vives (2009, "Why and where do headquarters
//     move?", Regional Science and Urban Economics): about 5% of US
//     headquarters relocate in a five-year span, toward metros with lower
//     average wages, lower corporate taxes and more headquarters of their
//     own sector.
//
// EVERY SWAN WRITES ITS CAUSE (why.ts): an event when it lands, caused by the
// nation's month (or, for the anchor, by the city's costs), and the news line
// carries the id.
//
// MEASURED (2026-10-14). Each forced at year ten on four seeds and read
// against the same town without it:
//   panic   credit index -0.4 for two years; a recession inside a year in
//           three of four; a lender closed in two; jobs -3.5% at two years
// (The national swans' measurements are in FORMULA_LEDGER.md's removal note
// and test/natswans.mjs.)
//
// Its own RNG stream ("shock"), so the economy's other draws do not move.

import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState, Sector } from "./types";
import { raiseAlert, START_YEAR } from "./types";
import { rng, pushNewsPublic, locationCost, WAGE_SHARE, INDUSTRY_LABEL } from "./market";
import { resolveRec } from "./value";
import { chargeLenderLoss } from "./lenders";
import { why, whyNation, whyOnce } from "./why";

const YEAR = 12;
/** Annual odds, per city. Shape parameters from the record, stated as such. */
const WAVE_HAZ = 1 / 200;
const PANIC_HAZ = 1 / 200;
/**
 * A PANIC IS GROWN, NOT DRAWN (2026-10-15). Its odds were a flat one in two
 * hundred a year. Financial crises follow credit booms: in Schularick & Taylor's
 * 14-country, 140-year panel a one-standard-deviation rise in five-year credit
 * growth roughly doubles the odds of a crisis. Here the odds scale with the
 * private credit gap — about a third of the base rate after a deleveraging,
 * the base rate at trend, five to eight times it at a 2007-sized boom.
 */
function panicHazard(credGap: number): number {
  return PANIC_HAZ * Math.exp(PANIC_PER_GAP * Math.max(-0.15, Math.min(0.25, credGap)));
}
const PANIC_PER_GAP = 15;
const EMBARGO_HAZ = 1 / 250;
const ARRIVALS_HAZ = 1 / 250;
/**
 * THE NATIONAL SWANS' ODDS, a year [S, read off the record]:
 *   pandemic  1/60: Marani et al. (2021, PNAS) put a COVID-scale pandemic at
 *             about 2% a year; Madhav et al. (2017, Disease Control
 *             Priorities) a 1918-scale one at 1 in 100-200. The century had
 *             1918, 1957, 1968 and 2020 (and 2009, mild): one in 50-100 for
 *             one that moves an economy.
 *   war       1/20: Korea 1950, Vietnam 1965, the Gulf 1990, Afghanistan and
 *             Iraq 2001-03, Ukraine 2022 (oil) — five since 1945 that moved
 *             defense spending a point of output or oil a third.
 *   foreign   1/12: Laeven & Valencia (2018) systemic crises that reached US
 *             exports, the dollar or spreads — 1982, 1994-95, 1997-98,
 *             2010-12, 2015 — five in about fifty years.
 *   tech      1/25: radio (1920s), electronics (1960s), PCs (1980s), the
 *             internet (1995-2000), the 2010s — four or five a century.
 *   trade war 1/20: 1930, 1971, the 1981-85 restraints, 2002, 2018-19, 2025
 *             — six in about ninety-five years.
 * Most draw small: severity runs 0.25-1 with a median near 0.45, so the
 * country has a 2020 or a Korea once in a lifetime and a 1998 every decade.
 */
const PANDEMIC_HAZ = 1 / 60, WAR_HAZ = 1 / 20, FOREIGN_HAZ = 1 / 12, TECH_HAZ = 1 / 25, TRADEWAR_HAZ = 1 / 20;

/** Probes only: switch the random draws off so a forced swan can be forked against a control with no other swan in either arm. */
let drawing = true;
export function setSwanDraws(on: boolean): void { drawing = on; }

export function tickBlackSwans(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null) {
  void adjacency;
  const e = s.econ;
  tickCapitalWave(s);
  tickPanic(s);
  e.bsJobPull = 0;
  tickLegacyCampus(s);
  tickAnchors(s);
  tickEmbargo(s);
  tickArrivals(s);
  tickNatSwans(s);
  // No swan in the opening year: the player has not had time to own anything.
  if (s.month < YEAR || !drawing) { publishNatSwans(s); return; }
  const live = (k: NatSwanKind) => (e.natSwans ?? []).some((x) => x.kind === k);
  if (!e.embargo && rng(s, "shock") < EMBARGO_HAZ / 12) startEmbargo(s);
  else if (!e.arrivals && rng(s, "shock") < ARRIVALS_HAZ / 12) startArrivals(s);
  else if (!e.capWave && rng(s, "shock") < WAVE_HAZ / 12) startCapitalWave(s);
  else if (!e.panic && rng(s, "shock") < panicHazard(e.nat?.credGap ?? 0) / 12) startPanic(s);
  else if (!live("pandemic") && rng(s, "shock") < PANDEMIC_HAZ / 12) startNatSwan(s, "pandemic");
  else if (!live("war") && rng(s, "shock") < WAR_HAZ / 12) startNatSwan(s, "war");
  else if (!live("foreign") && rng(s, "shock") < FOREIGN_HAZ / 12) startNatSwan(s, "foreign");
  else if (!live("techboom") && rng(s, "shock") < TECH_HAZ / 12) startNatSwan(s, "techboom");
  else if (!live("tradewar") && rng(s, "shock") < TRADEWAR_HAZ / 12) startNatSwan(s, "tradewar");
  else considerAnchor(s, parcels, bbls);
  // The hooks are written after anything new has landed, and read by the
  // nation and the trades next month.
  publishNatSwans(s);
}

// ---------------------------------------------------------------- the national swans

export type NatSwanKind = "pandemic" | "war" | "foreign" | "techboom" | "tradewar";
export interface NatSwan {
  kind: NatSwanKind;
  m0: number;
  /** 0.25..1: a 1957 to a 2020, a Gulf to a Korea */
  sev: number;
  /** months it runs at full force (a war's length, a trade war's, a boom's) */
  len: number;
  title: string;
  why?: number;
  /** a tech boom: growth a year over trend, whether it breaks, how far and how fast */
  rate?: number; bust?: boolean; fall?: number; bustM?: number; peak?: number;
  /** a trade war: the tariff on covered imports, times the share covered */
  tariff?: number;
}
/** What the national swans do this month, as levels (log points or shares of output), read by market.ts next month. */
export interface NatSwanHooks {
  /** households' spending, log */
  c: number;
  /** the capital firms plan for, log */
  k: number;
  /** the world's output gap the city's exports sell into */
  f: number;
  /** the dollar's real level, log (+ dear) */
  q: number;
  /** government spending, share of output */
  g: number;
  /** export demand beyond the world's income (tariff retaliation, a boom's services), log */
  x: number;
  /** corporate credit spread, fraction */
  sp: number;
  /** oil's real premium, log */
  oil: number;
  /** the price-level push from oil and tariffs, log, and the annualised inflation it adds this month */
  p: number;
  infl: number;
}

/** 0 before it starts, rising over `rise` months, full for `hold`, then fading with time constant `tau`. */
function env(a: number, rise: number, hold: number, tau: number): number {
  if (a < 0) return 0;
  if (a < rise) return (a + 1) / rise;
  if (a < rise + hold) return 1;
  return Math.exp(-(a - rise - hold) / tau);
}

/**
 * HOW MUCH OF AN OIL PRICE RISE REACHES THE PRICE LEVEL DIRECTLY: about 0.03
 * per log point (a 10% rise in crude adds 0.2-0.4 points to the CPI within a
 * year: Blanchard & Gali 2007; Kilian 2008) [S]. Tariffs pass through to
 * import prices about one for one (Amiti, Redding & Weinstein 2019, the
 * 2018 tariffs), and imported content is about a tenth of what consumers buy
 * (Hale, Hobijn, Nechio & Wilson 2019, SF Fed: ~10% of PCE) [S].
 */
const OIL_CPI = 0.03, IMPORT_SHARE = 0.10;

function sevDraw(s: GameState): number {
  const u = rng(s, "shock");
  return 0.25 + 0.75 * u * u;
}

/** Months after which an episode has nothing left to give. */
function natSwanEnd(x: NatSwan): number {
  switch (x.kind) {
    case "pandemic": return 6 + 18 + 4 * 24;
    case "war": return 9 + x.len + 4 * 18;
    case "foreign": return 3 + 9 + 4 * 18;
    case "techboom": return x.len + (x.bustM ?? 0) + 4 * 12;
    case "tradewar": return 6 + x.len + 4 * 18;
  }
}

/** The episode's levels at age `a`: the nation's hooks, and the trades' and the space's levels. */
function natSwanAt(x: NatSwan, a: number, h: NatSwanHooks, sec: Partial<Record<Sector, number>>, space: Partial<Record<BuiltClass, number>>) {
  const v = x.sev;
  const add = (k: Sector, d: number) => { sec[k] = (sec[k] ?? 0) + d; };
  switch (x.kind) {
    case "pandemic": {
      // 2020: US real spending on services -18% from February to April and
      // most of it back within a year; business investment -9% in the second
      // quarter; world output -3.1% (IMF); relief about 10% of output over a
      // year (the CARES Act). At severity 1 that is a consumption level 12%
      // down for two to five months, fading over half a year.
      const acute = 2 + Math.round(4 * v);
      const e1 = env(a, 1, acute, 6);
      h.c -= 0.12 * v * e1;
      h.k -= 0.06 * v * e1;
      h.f -= 0.04 * v * env(a, 2, acute, 9);
      h.g += 0.03 * v * env(a, 1, acute + 6, 9);
      // WHICH TRADES: restaurants and travel (leisure and hospitality payrolls
      // -49% in April 2020, -10% at the end of 2021), shops, elective care
      // (health payrolls -9%), against the sheds and the screens that gained
      // (warehouse and e-commerce, software). Beyond the national swing each
      // trade already takes from the output gap.
      add("food", -0.25 * v * env(a, 1, acute, 9));
      add("apparel", -0.12 * v * env(a, 1, acute, 6));
      add("medical", -0.08 * v * env(a, 1, 1, 4));
      add("logistics", 0.08 * v * env(a, 3, 12, 18));
      add("tech", 0.04 * v * env(a, 3, 12, 18));
      // OFFICES EMPTY FOR A WHILE. US office vacancy went from 12.6% (2019) to
      // about 19-20% by 2024 (Moody's), sublease availability about doubled
      // (CBRE: ~1.5% of inventory to ~2.9%): firms held their leases and
      // marketed what they were not using. Seven per cent of the footprint
      // wanted at severity 1, arriving over half a year, held a year and a
      // half, returning over the next several. It ends: the owner has ruled
      // out a permanent telework era.
      space.office = (space.office ?? 1) * (1 - 0.07 * v * env(a, 6, 18, 24));
      break;
    }
    case "war": {
      // Defense spending: Korea +8 points of output (5% -> 13%), Vietnam +2,
      // the 1980s build-up +1.5, Afghanistan and Iraq +1.2 (3.0% -> 4.7%).
      // The deficit-financed part is what reaches demand: Korea was paid for
      // largely by tax rises (the 1950-51 Revenue Acts) and rationing, so
      // the stimulus at the top of the scale is about two points, not eight.
      // THIS IS THE NATION'S ONLY WAR FINANCE (2026-10-30): the nation no
      // longer draws a bond-financed fiscal expansion of its own off the
      // same record (market.ts SUPPLY_SHARE), so a war is financed once.
      h.g += (0.006 + 0.016 * v * v) * env(a, 9, x.len, 18);
      // Oil: the Gulf took WTI from $17 to $41 in three months (+0.9 log)
      // and back within six; 2003 +0.3; 2022 +0.5.
      h.oil += (0.25 + 0.6 * v) * env(a, 3, 4, 6);
      add("tech", 0.05 * v * env(a, 12, x.len, 24));
      add("logistics", 0.03 * v * env(a, 12, x.len, 24));
      break;
    }
    case "foreign": {
      // 1997-98: world growth 4.0% -> 2.5%, the trade-weighted dollar +15%
      // against Asia, high-yield spreads +300bp and investment-grade +80bp
      // (the CMBS market shut that autumn); 2014-15 the dollar +20%.
      // THE WORLD'S SLUMP IS NOT ADDED HERE (2026-10-30). The rest of the
      // world is already an economy with its own drawn shocks (market.ts
      // tickDemand, ROW: a gap of about 2% sd), and that draw is the whole of
      // the world's cycle, its crises included — 1982, 1998 and 2009 are in
      // the variance it stands for. A crisis that also pushed the world's gap
      // down 1-4% counted the slump twice: measured on the national block
      // with the swans on (20 seeds x 100 years), this one line was 2 of the
      // swans' 3 points of extra recession months. What the world's gap
      // cannot make is the rest of a crisis abroad — the run to the dollar
      // and the spreads — and that is what the swan carries.
      h.q += (0.04 + 0.12 * v) * env(a, 3, 9, 18);
      h.sp += (0.004 + 0.016 * v) * env(a, 1, 3, 6);
      const e2 = env(a, 2, 6, 12);
      add("finance", -0.06 * v * e2);
      add("insurance", -0.02 * v * e2);
      add("logistics", -0.04 * v * e2);
      add("apparel", -0.03 * v * e2);
      add("food", -0.02 * v * e2);
      break;
    }
    case "techboom": {
      // 1995-2000: information payrolls +20% nationally (San Francisco +60%),
      // equipment and software investment ~10% a year; 2000-02: tech payrolls
      // down 20-30% from the peak, the Nasdaq -78%. A boom that holds keeps
      // what it built (the 2010s). Levels in log points of the trade's orders.
      const boomUp = Math.min(a, x.len) / 12 * (x.rate ?? 0.08);
      let lvl = boomUp;
      if (x.bust && a > x.len) lvl = boomUp - (x.fall ?? 0) * Math.min(1, (a - x.len) / Math.max(1, x.bustM ?? 24));
      add("tech", lvl);
      add("media", 0.5 * lvl);
      add("design", 0.4 * lvl);
      const boomE = a <= x.len ? env(a, 12, x.len, 12) : Math.exp(-(a - x.len) / 12);
      h.k += 0.03 * v * boomE;
      h.x += 0.02 * v * boomE;
      if (x.bust && a > x.len) h.k -= 0.04 * v * env(a - x.len, 6, x.bustM ?? 24, 12);
      break;
    }
    case "tradewar": {
      // 2018-19: tariffs of 10-25% on about $350B of imports, passed through
      // to import prices about one for one (Amiti, Redding & Weinstein 2019);
      // retaliation took US soybean exports to China down three quarters and
      // farm and factory exports with them; the uncertainty took 1-2% off
      // investment (Caldara et al. 2020). 1930 was a 20% average tariff.
      const e3 = env(a, 6, x.len, 18);
      h.p += IMPORT_SHARE * (x.tariff ?? 0) * e3;
      h.x -= (0.02 + 0.04 * v) * e3;
      h.k -= (0.005 + 0.015 * v) * env(a, 3, x.len, 12);
      add("apparel", -0.06 * v * e3);
      add("food", -0.05 * v * e3);
      add("logistics", -0.04 * v * e3);
      break;
    }
  }
}

function tickNatSwans(s: GameState) {
  const e = s.econ;
  const list = e.natSwans;
  if (!list?.length) return;
  for (const x of [...list]) {
    const a = s.month - x.m0;
    if (x.kind === "techboom" && a === x.len) {
      const label = INDUSTRY_LABEL.tech;
      const id = why(s, {
        k: x.bust ? "swan.techbust" : "swan.techheld", a: "nation", name: x.title,
        n: { sev: x.sev, ratePerYr: x.rate ?? 0, fall: x.fall ?? 0 },
        t: x.bust ? `${label} boom broke · orders to fall ${Math.round((x.fall ?? 0) * 100)} log points over ${x.bustM} months`
          : `${label} boom held · the trade keeps what it built`,
      }, [x.why, whyNation(s)]);
      pushNewsPublic(s, x.bust ? "warn" : "info", x.bust
        ? `The ${label.toLowerCase()} boom has broken. The valuations went first; the layoffs are next, and the space the trade took on the way up is about to come back.`
        : `The ${label.toLowerCase()} boom has slowed to a walk without breaking. The trade keeps what it built.`, id);
    }
    if (a >= natSwanEnd(x)) {
      e.natSwans = e.natSwans!.filter((y) => y !== x);
      const id = why(s, { k: `swan.${x.kind}.over`, a: "nation", name: x.title, t: `${x.title} is behind the country` }, [x.why]);
      pushNewsPublic(s, "info", `${x.title[0].toUpperCase()}${x.title.slice(1)} is behind the country now; what it left is the ordinary business cycle's to work through.`, id);
    }
  }
  if (!e.natSwans!.length) delete e.natSwans;
}

/** Sum every episode at its age into the hooks the nation and the trades read. */
function publishNatSwans(s: GameState) {
  const e = s.econ;
  const list = e.natSwans ?? [];
  const prevP = e.natSw?.p ?? 0;
  if (!list.length && !e.natSw && !e.swanSec && !e.swanSpace) return;
  const h: NatSwanHooks = { c: 0, k: 0, f: 0, q: 0, g: 0, x: 0, sp: 0, oil: 0, p: 0, infl: 0 };
  const sec: Partial<Record<Sector, number>> = {};
  const space: Partial<Record<BuiltClass, number>> = {};
  // Each trade's orders move by the change in each episode's level this
  // month — per episode, so an episode that ends leaves what it did (a boom
  // that held keeps its trade bigger) rather than snapping back on the day
  // it is filed away.
  const was: Partial<Record<Sector, number>> = {};
  const scratch: NatSwanHooks = { c: 0, k: 0, f: 0, q: 0, g: 0, x: 0, sp: 0, oil: 0, p: 0, infl: 0 };
  for (const x of list) {
    natSwanAt(x, s.month - x.m0, h, sec, space);
    natSwanAt(x, s.month - x.m0 - 1, scratch, was, {});
  }
  // The price level's push from oil and tariffs, and the inflation that is
  // its change this month, annualised — what the nation's Phillips block adds.
  h.p += OIL_CPI * h.oil;
  h.infl = 12 * (h.p - prevP);
  const growth: Partial<Record<Sector, number>> = {};
  for (const k of new Set([...Object.keys(sec), ...Object.keys(was)]) as Set<Sector>) {
    const d = (sec[k] ?? 0) - (was[k] ?? 0);
    if (d !== 0) growth[k] = d;
  }
  if (!list.length && Math.abs(h.infl) < 1e-12) {
    delete e.natSw; delete e.swanSec; delete e.swanSpace;
    return;
  }
  e.natSw = h;
  if (Object.keys(growth).length) e.swanSec = growth; else delete e.swanSec;
  if (Object.keys(space).length) e.swanSpace = space; else delete e.swanSpace;
}

function startNatSwan(s: GameState, kind: NatSwanKind, sevAt?: number) {
  const e = s.econ, n = e.nat;
  const yr = START_YEAR + Math.floor(s.month / 12);
  const v = sevAt ?? sevDraw(s);
  const x: NatSwan = { kind, m0: s.month, sev: v, len: 0, title: "" };
  let tone: "bad" | "good" = "bad", head = "", body = "", detail = "";
  const nums: Record<string, number> = { sev: +v.toFixed(2) };
  if (kind === "pandemic") {
    x.title = `the pandemic of ${yr}`;
    head = `The pandemic of ${yr}`;
    body = v > 0.6
      ? "A new virus is in every city in the country. Restaurants, hotels and airlines are closing their doors, offices are emptying, and the economy is falling faster than anyone has seen."
      : "A new strain of influenza is moving through the country. Schools and offices are thinning out, restaurants and travel are quiet, and the economy is losing a step.";
    detail = "Services and travel go first and come back last. Firms will hold their leases and put the space they are not using on the sublet market; it comes back as the episode passes, not overnight.";
    nums.consumption = -0.12 * v;
    nums.officeSpace = -0.07 * v;
  } else if (kind === "war") {
    x.len = Math.round(24 + 72 * rng(s, "shock"));
    x.title = `the war of ${yr}`;
    head = `War, ${yr}`;
    const oil = 0.25 + 0.6 * v;
    body = `The country is at war. Defense orders are going out, the price of a barrel is up ${Math.round((Math.exp(oil) - 1) * 100)}% on the supply scare, and Washington will be borrowing to pay for it.`;
    detail = "Wars are paid for with borrowed money and higher prices. When the war is big, the central bank is told — politely, then less politely — that this is not the moment to raise rates. That is how Korea and Vietnam became inflations.";
    // A big war is fought on borrowed money and the bank is leaned on (the
    // Fed pegged rates until the 1951 Accord; Johnson and Martin, 1965).
    // Measured (seed 550991, severity 1): held for the war's whole length the
    // pressure took the output gap to +11 points in three years — the
    // engine's fiscal-pressure channel compounding — against about +3 with
    // the bank free; Korea ran perhaps +5. So the pressure is the record's
    // length, below, not the war's.
    // Only the largest, and not for the war's whole length: Korea's peg held
    // nine months to the Accord; under Vietnam the Fed tightened anyway in
    // 1966, a year and a half in. Nine to eighteen months.
    if (n && v > 0.8) n.pressureM = Math.max(n.pressureM ?? 0, Math.min(x.len, Math.round(9 + 9 * (v - 0.8) / 0.2)));
    nums.defense = 0.006 + 0.016 * v * v;
    nums.oil = oil;
    nums.months = x.len;
  } else if (kind === "foreign") {
    x.title = `the foreign crisis of ${yr}`;
    head = `A crisis abroad, ${yr}`;
    body = "Banks and currencies are failing overseas. Money is running to the dollar, the world is buying less of what this country makes, and credit spreads have blown out overnight.";
    detail = "Exporters lose twice, to the slump abroad and to the dearer dollar. Lenders tighten while the spreads are wide, and anything that needs refinancing this year will cost more.";
    nums.dollar = 0.04 + 0.12 * v;
    nums.spread = 0.004 + 0.016 * v;
  } else if (kind === "techboom") {
    tone = "good";
    x.len = Math.round(36 + 24 * rng(s, "shock"));
    x.rate = 0.03 + 0.05 * v;
    // Six in ten break (1929's radio, 1970's electronics, 2000), the rest
    // hold (the 2010s): a fall of 60-110% of what the boom added, over two
    // to three years.
    x.bust = rng(s, "shock") < 0.6;
    x.peak = x.rate * x.len / 12;
    x.fall = x.peak * (0.6 + 0.5 * rng(s, "shock"));
    x.bustM = Math.round(24 + 12 * rng(s, "shock"));
    x.title = `the technology boom of ${yr}`;
    head = `A technology boom, ${yr}`;
    body = `A new technology has the country's money behind it. Software and media firms are hiring about ${Math.round(x.rate * 100)}% a year faster than everyone else, and investment is pouring in.`;
    detail = "Booms like this have broken more often than they have held. Every landlord who underwrites this growth continuing is betting it is a 2010s and not a 2000.";
    nums.ratePerYr = x.rate;
    nums.months = x.len;
  } else {
    x.len = Math.round(18 + 42 * rng(s, "shock"));
    x.tariff = (0.03 + 0.12 * v) * (0.3 + 0.7 * v);
    x.title = `the trade war of ${yr}`;
    head = `Tariffs, ${yr}`;
    body = `Washington has put tariffs on a wide range of imports and the trading partners have answered in kind. Import prices are going up and the factories' and farms' export orders are being cancelled.`;
    detail = "A tariff is a tax on the buyer: prices rise, and the factories, ports and warehouses that live off trade lose the orders the other side retaliated against. Investment waits for the outcome.";
    nums.tariff = x.tariff;
    nums.exports = -(0.02 + 0.04 * v);
    nums.months = x.len;
  }
  x.why = why(s, { k: `swan.${kind}`, a: "nation", name: x.title, n: nums, t: `${head} · severity ${v.toFixed(2)}` }, [whyNation(s)]);
  (e.natSwans ??= []).push(x);
  (e.blackSwans ??= []).push({ m: s.month, kind, size: Math.round(v * 100), sf: 0, title: x.title });
  raiseAlert(s, { kind: "swan", tone, title: head, body, detail, why: x.why });
}

// ---------------------------------------------------------------- the embargo

function tickEmbargo(s: GameState) {
  // The materials premium is the oil price's now (inputs.ts; the cost index
  // reads it): a save from before carries its old schedule to nothing.
  const e = s.econ;
  if (e.embargo) e.embargo = undefined;
}

function startEmbargo(s: GameState) {
  const e = s.econ, n = e.nat;
  const yr = START_YEAR + Math.floor(s.month / 12);
  // THE NATION: the worst supply shock its weather can draw and then some —
  // 1973-74 added seven to nine points to inflation — and the seventies'
  // cluster after it, which is what made 1979 a second time.
  if (n) {
    n.shockM = Math.round(18 + 12 * rng(s, "shock"));
    n.shockSev = 0.055 + 0.03 * rng(s, "shock");
    n.shockClusterM = Math.max(n.shockClusterM ?? 0, 96);
  }
  // THE TRADES: the supply shock takes real oil up about 1.0-1.5 log points
  // (inputs.ts, OIL_PER_SHOCK), and construction materials follow oil at
  // 0.15 (market.ts MATERIALS_OIL): 15-25% over the general inflation, as in
  // 1974. The draw is kept for the stream's sake and for the paper.
  const jump = Math.exp(0.15 * 18 * (n?.shockSev ?? 0.07)) - 1;
  void rng(s, "shock");
  (e.blackSwans ??= []).push({ m: s.month, kind: "embargo", size: Math.round(jump * 100), sf: 0, title: `the embargo of ${yr}` });
  const id = why(s, { k: "swan.embargo", a: "nation", name: `the embargo of ${yr}`, n: { supplyShock: n?.shockSev ?? 0, materials: jump }, t: `Oil embargo · supply shock ${(((n?.shockSev ?? 0)) * 100).toFixed(1)} points of inflation` }, [whyNation(s)]);
  raiseAlert(s, {
    kind: "swan", tone: "bad", why: id,
    title: `The embargo of ${yr}`,
    body: `The oil exporters have cut supply and the price of a barrel has tripled in a month. Every price in the country is about to follow it, and construction first: diesel, asphalt, steel and resin are all oil. Expect materials about ${Math.round(jump * 100)}% dearer within the year, on top of the inflation itself.`,
    detail: "Every job in the ground is about to go over budget, and every pro forma written last year is wrong. The central bank will have to choose between the inflation and the jobs, and in 1974 it chose both, badly.",
  });
}

// ---------------------------------------------------------------- the arrivals

/**
 * Where they land. The region's homes are mostly on the mainland the island
 * anchors, and in a spatial equilibrium a household's location follows the
 * region's mix — but newcomers do not arrive in equilibrium. They go where
 * their community already is and where a room can be had this week: the
 * Mariel arrivals went overwhelmingly to the city of Miami and Hialeah, not
 * the county at large. Half of them wanting the island is a shape parameter.
 * They land in the household register (households.ts, the wave): renter
 * households across the water looking for work, ARRIVALS_CORE of them with a
 * taste for the island that wants a flat there at the going rent — so they
 * are the flats' demand the month they come (`islandWant`), they take the
 * island's empty flats the landlords' screens let them, and they sort
 * themselves back out at their lease ends as any household does. (This was a
 * poke at the island's location margin, `locEff`, which no longer feeds
 * anything since households stage 2.)
 */
const ARRIVALS_CORE = 0.5;

function tickArrivals(s: GameState) {
  const e = s.econ, x = e.arrivals;
  if (!x) { e.bsMigPull = 0; e.bsArrivals = undefined; return; }
  if (x.leftM > 0) {
    e.bsMigPull = x.monthly; x.leftM -= 1;
    e.bsArrivals = { monthly: x.monthly, island: ARRIVALS_CORE };
  } else { e.bsMigPull = 0; e.arrivals = undefined; e.bsArrivals = undefined; }
}

function startArrivals(s: GameState) {
  const e = s.econ;
  const yr = START_YEAR + Math.floor(s.month / 12);
  // 3-8% of the town in six to twenty-four months: between Mariel (7.8% of
  // Miami's labour force in five) and the aliyah (8% of Israel in twenty-four).
  const size = 0.03 + 0.05 * rng(s, "shock");
  const months = Math.round(6 + 18 * rng(s, "shock"));
  e.arrivals = { leftM: months, monthly: Math.pow(1 + size, 1 / months) - 1 };
  const people = Math.round((e.population ?? 0) * size / 1000) * 1000;
  (e.blackSwans ??= []).push({ m: s.month, kind: "arrivals", size: Math.round(size * 1000), sf: 0, title: `the arrivals of ${yr}` });
  const id = why(s, { k: "swan.arrivals", a: "nation", name: `the arrivals of ${yr}`, n: { people, share: size, months }, t: `${people.toLocaleString()} newcomers over ${months} months · ${(size * 100).toFixed(0)}% of the town` }, [whyNation(s)]);
  raiseAlert(s, {
    kind: "swan", tone: "good", why: id,
    title: `The arrivals of ${yr}`,
    body: `A political upheaval abroad has opened a door that was shut for a generation, and this city is where the boats and the planes are landing. About ${people.toLocaleString()} people — ${(size * 100).toFixed(0)}% of the town — over the next ${months} months, and they need somewhere to live the week they arrive.`,
    detail: "They will not wait for a flat to come empty: families are doubling up already. Whoever owns apartments is about to find out what a housing shortage looks like from the right side, and the builders are about to find out how long it takes to catch up.",
  });
}

// ---------------------------------------------------------------- the wave

/** Glide the wave's cap-rate effect along its phases. */
function tickCapitalWave(s: GameState) {
  const e = s.econ;
  const w = e.capWave;
  if (!w) return;
  w.leftM -= 1;
  e.capitalWave = w.to + (w.from - w.to) * Math.max(0, w.leftM) / Math.max(1, w.len);
  if (w.leftM > 0) return;
  const next = (phase: "hold" | "out" | "fade", len: number, to: number) => { e.capWave = { ...w, phase, leftM: len, len, from: e.capitalWave ?? 0, to }; };
  if (w.phase === "in") next("hold", Math.round(12 + 12 * rng(s, "shock")), w.to);
  else if (w.phase === "hold") {
    next("out", Math.round(12 + 12 * rng(s, "shock")), 0.3 + 0.3 * rng(s, "shock"));
    const id = why(s, { k: "swan.wave.out", a: "nation", n: { capPts: e.capWave?.to ?? 0 }, t: "Foreign buyers called home · their funds are selling" }, [whyNation(s)]);
    pushNewsPublic(s, "warn", "The foreign buyers have been called home, and their funds are selling. The bids that set every price in town for five years are about to be offers, and nobody local will pay what they paid.", id);
  } else if (w.phase === "out") next("fade", 36, 0);
  else { e.capWave = undefined; e.capitalWave = 0; }
}

function startCapitalWave(s: GameState) {
  const e = s.econ;
  const depth = -(0.8 + 0.7 * rng(s, "shock"));
  // HOW MUCH MONEY COMES, as a share of the street's book: Japanese investors
  // held about 5-10% of US institutional commercial property at the 1989-91
  // peak, a third of downtown Los Angeles offices (Farrell 1993). The swan's
  // own draw, read as that share (rivals.ts tickForeignMoney raises it as
  // named funds; it reaches prices only through what they bid).
  e.capWave = { phase: "in", leftM: 36, len: 36, from: e.capitalWave ?? 0, to: depth, share: 0.03 + 0.07 * (-depth - 0.8) / 0.7 };
  (e.blackSwans ??= []).push({ m: s.month, kind: "wave", size: Math.round(-depth * 100), sf: 0, title: "foreign capital found the city" });
  const id = why(s, { k: "swan.wave", a: "nation", n: { capPts: depth, share: +(e.capWave.share ?? 0).toFixed(3) }, t: `Foreign capital arriving · funds raised abroad to buy here, about ${Math.round((e.capWave.share ?? 0) * 100)}% of the street's book` }, [whyNation(s)]);
  raiseAlert(s, {
    kind: "swan", tone: "good", why: id,
    title: "Foreign capital has found the city",
    body: `Buyers from abroad are raising funds to buy here, and they will accept yields nobody local will — trophy towers first, then everything. Over the next three years their bids, not the town's, will set the price of whatever they want.`,
    detail: "It has happened before and it ended the same way every time: the money goes home at once, and the prices it set go with it. Selling into it is the trade; buying into it is the risk.",
  });
}

// ---------------------------------------------------------------- the panic

/** How hard the panic is pressing this month: full while it lasts, then easing. */
function tickPanic(s: GameState) {
  const p = s.econ.panic;
  if (!p) return;
  if (p.leftM > 0) { p.leftM -= 1; return; }
  // Confidence comes back the way it does after every panic — slowly, then
  // all at once: a five-month half-life once the run has stopped.
  p.force *= 0.87;
  if (p.force < 0.04) {
    s.econ.panic = undefined;
    pushNewsPublic(s, "event", "The panic is over. Nobody announced it; the commercial paper simply started rolling again, and the lenders started taking calls.",
      why(s, { k: "swan.panic.over", a: "bank", t: "The panic is over · lenders taking calls again" }));
  }
}

function startPanic(s: GameState) {
  const e = s.econ;
  const yr = START_YEAR + Math.floor(s.month / 12);
  // THE HOLE IS SOMEWHERE ELSE. A trading book, a trust company's call loans,
  // a fund of mortgage bonds from another country — never this town's
  // buildings, which is what makes it a swan rather than the cycle. It lands
  // on one of the big desks, weighted by size, because it is always a big one.
  const live = (s.lenders ?? []).filter((l) => l.failedM === undefined && (l.kind === "bank" || l.kind === "life") && l.capital > 0);
  let name = "", loss = 0;
  if (live.length) {
    const tot = live.reduce((a, l) => a + Math.max(1, l.book), 0);
    let u = rng(s, "shock") * tot;
    let hit = live[0];
    for (const l of live) { u -= Math.max(1, l.book); if (u <= 0) { hit = l; break; } }
    // Between half its capital and more than all of it: some of the time it
    // survives on its knees, some of the time the examiners come on Friday.
    loss = hit.capital * (0.5 + 0.8 * rng(s, "shock"));
    chargeLenderLoss(s, hit.name, loss, { borrower: "a book outside this city", cls: "income", how: "panic" });
    name = hit.name;
  }
  // How long the run lasts at full force: the acute phase of 1907 was about
  // three weeks and its credit squeeze half a year; 2008's ran from September
  // to the following spring.
  e.panic = { leftM: Math.round(4 + 8 * rng(s, "shock")), force: 1 };
  (e.blackSwans ??= []).push({ m: s.month, kind: "panic", size: 1, sf: 0, title: `the Panic of ${yr}` });
  // GROWN: its odds were the credit boom's, so the boom is the cause.
  const credGap = e.nat?.credGap ?? 0;
  const id = why(s, {
    k: "swan.panic", a: "bank", ...(name ? { aid: name, name } : {}),
    n: { loss: Math.round(loss), credGap, odds: panicHazard(credGap) / PANIC_HAZ },
    t: `${name || "A trust company"} took a hole far from town · private credit ${(credGap * 100).toFixed(1)} points over trend, crisis odds x${(panicHazard(credGap) / PANIC_HAZ).toFixed(1)}`,
  }, [whyNation(s)]);
  raiseAlert(s, {
    kind: "swan", tone: "bad", why: id,
    title: `The Panic of ${yr}`,
    body: (name ? `${name} has disclosed losses far from this city — a book nobody here knew it had — and ` : "A trust company has failed on losses nobody here knew about, and ")
      + "by the afternoon nobody would lend to anybody. Term sheets are being pulled mid-closing, lines are being cut, and the bond market has stopped quoting.",
    detail: "It is not the cycle; it is the window slamming in the middle of whatever the cycle was doing. Panics like this one have tipped the economy into recession more often than not. Anything that has to be refinanced in the next year is now the problem.",
  });
}

// ---------------------------------------------------------------- the anchor

/**
 * AN ANCHOR EMPLOYER CHOOSES ON COST (ONE_ECONOMY_PLAN.md §5, grown swans).
 *
 * The campus was a hazard: one in two hundred a year, a dice roll on whether
 * it walked. Now a firm decides. A large employer siting a headquarters or a
 * research campus runs a search and puts a handful of cities on a shortlist;
 * this city reaches one at `ANCHOR_SHORTLIST_HAZ` a year [K: scale — HQ-scale
 * relocations are about 1% of large firms a year (Strauss-Kahn & Vives 2009:
 * ~5% of US headquarters in five years), a town this size is on few lists].
 * Among `FINALISTS` (five: site-selection shortlists run three to five;
 * Amazon's HQ2 had twenty) it wins with logit odds on its cost against
 * theirs: the town's pay and business rent against the nation (cityLogCost,
 * the same read that brakes its growth) plus its taxes against the opening
 * (citygov.ts), the rivals drawn from the spread of US metro business costs
 * (`PEER_SD`, about 10%: BEA regional price parities and QCEW average pay
 * across metros). `COST_BETA` = 8 per log point [K]: a city 10% cheaper than
 * the field is about twice as likely to be picked, the order of the
 * location-cost elasticities in Bartik (1991).
 *
 * Between the announcement and the groundbreak the city can lose it: if its
 * costs have risen past the margin it won by, or City Hall turned against the
 * package (a populist mayor elected in the interval: Long Island City, 2019),
 * or the city is under a control board and cannot pay what it promised.
 *
 * And one that came reviews the choice when its lease is up, ten to fifteen
 * years on: it leaves if the city has grown dearer than when it chose, by
 * more than the cost of moving (`MOVE_HURDLE`, a quarter of a log point: a
 * headquarters move costs about a year or two of the savings it buys) — with
 * the same logit odds, so about one in eight leave at an unchanged cost,
 * which is Strauss-Kahn & Vives' 5% in five years over a twelve-year lease.
 */
export interface Anchor {
  id: number;
  name: string;
  sector: Sector;
  pole: number;
  /** "coming" until it breaks ground, "here" while it hires and after, "leaving" while it goes */
  state: "coming" | "here" | "leaving";
  m0: number;
  /** share of the city's jobs it brings, and the location jump at its centre */
  gain: number;
  jump: number;
  /** months of hiring (or of leaving) still to land, and the monthly pull */
  leftM: number;
  pullM: number;
  /** the city's cost (log, against the nation, taxes in) when it chose */
  costAt: number;
  breakM?: number;
  reviewM?: number;
  platformAt?: string;
  bbl?: string;
  why?: number;
}
const ANCHOR_SHORTLIST_HAZ = 1 / 20;
const FINALISTS = 5;
const COST_BETA = 8;
const PEER_SD = 0.10;
const MOVE_HURDLE = 0.25;
/** Property tax against an occupier's gross rent: 1.1% of value at a 7% cap rate is about 16% (value.ts TAX_RATE, CAP_BASE) [D]. */
const PROP_TAX_OF_RENT = 0.16;

/**
 * The city's cost to an employer, in log points: pay and rent against the
 * nation (market.ts cityLogCost) plus City Hall's taxes against the opening —
 * the payroll tax on the wage bill, the property tax on the rent.
 */
export function anchorCost(e: Econ): { total: number; wage: number; rent: number; tax: number; agglom: number } {
  const loc = locationCost(e);
  const wage = WAGE_SHARE * Math.log((e.wageIdx ?? 1) / Math.max(1e-6, e.natWageIdx ?? e.wageIdx ?? 1));
  const c = { total: loc, wage, rent: loc - wage, agglom: 0 };
  const g = e.gov;
  let tax = 0;
  if (g) {
    tax += WAGE_SHARE * Math.log(1 + (g.policy.wageRate - g.policy0.wageRate));
    tax += (1 - WAGE_SHARE) * Math.log(1 + PROP_TAX_OF_RENT * (g.policy.propRate / Math.max(1e-6, g.policy0.propRate) - 1));
  }
  return { total: c.total + tax, wage: c.wage, rent: c.rent, tax, agglom: c.agglom };
}

/** The city's costs this month as a cause (once a month). */
function whyCityCost(s: GameState): number {
  const c = anchorCost(s.econ);
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  return whyOnce(s, `citycost:${s.month}`, () => ({
    k: "city.cost", a: "city",
    n: { total: c.total, wage: c.wage, rent: c.rent, tax: c.tax },
    t: `What the city costs an employer against the nation · pay ${pct(c.wage)} · rent ${pct(c.rent)} · taxes ${pct(c.tax)}`,
  }), () => [whyNation(s)]);
}

const ANCHOR_KIND: { sector: Sector; what: string; names: string[] }[] = [
  { sector: "tech", what: "headquarters", names: ["Corvane Systems", "Halyard Software", "Brightwater Networks", "Meridale Data"] },
  { sector: "medical", what: "research campus", names: ["St. Aldric Health", "Northfield Biologics", "Carrow Therapeutics", "Lindqvist Medical"] },
  { sector: "finance", what: "operations headquarters", names: ["Ashcombe Trust", "Pellham Capital", "Garrick National Bank", "Ostrander Financial"] },
  { sector: "insurance", what: "headquarters", names: ["Holloway Mutual", "Brennard Assurance", "Kestrel Life", "Thornbury Casualty"] },
  { sector: "media", what: "studio campus", names: ["Vantage Pictures", "Larkspur Media", "Redfern Broadcasting", "Calloway Press"] },
];

function considerAnchor(s: GameState, parcels: ParcelTable, bbls: string[], forced = false) {
  const e = s.econ;
  const poles = s.poles ?? [];
  if (poles.length < 2) return;
  if ((e.anchors ?? []).some((a) => a.state === "coming")) return;
  if (!forced && rng(s, "shock") >= ANCHOR_SHORTLIST_HAZ / 12) return;
  // ON THE SHORTLIST. The other finalists' costs are drawn from the spread of
  // US metros; this city wins on logit odds against them.
  const c = anchorCost(e).total;
  let others = 0;
  for (let i = 1; i < FINALISTS; i++) {
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng(s, "shock")))) * Math.cos(2 * Math.PI * rng(s, "shock"));
    others += Math.exp(-COST_BETA * PEER_SD * z);
  }
  const mine = Math.exp(-COST_BETA * c);
  const p = mine / (mine + others);
  const kind = ANCHOR_KIND[Math.floor(rng(s, "shock") * ANCHOR_KIND.length)];
  const name = kind.names[Math.floor(rng(s, "shock") * kind.names.length)];
  const won = rng(s, "shock") < p;
  const costWhy = whyCityCost(s);
  if (!won) {
    if (forced) return;
    const id = why(s, { k: "anchor.passed", a: "firm", name, n: { odds: p, cost: c }, t: `${name} shortlisted the city for its ${kind.what} and chose elsewhere · odds were ${(p * 100).toFixed(0)}%` }, [costWhy]);
    pushNewsPublic(s, "info", `${name} had the city on its shortlist for a new ${kind.what} and has chosen another. The site consultants' read: ${c > 0.02 ? "too dear" : "close, but not the cheapest"}.`, id);
    return;
  }
  // NOT THE ADDRESS EVERYBODY ALREADY KNOWS. Anchors go where the land is
  // cheap enough to assemble a campus and the subsidy is on offer — the
  // centre that is losing, not the one that won.
  const order = poles.map((pl, i) => ({ i, lvl: pl.level })).sort((a, b) => a.lvl - b.lvl);
  const pick = order[Math.floor(rng(s, "shock") * Math.max(1, order.length - 1))].i;
  const pole = poles[pick];
  // About as far as a well-located station moves a neighbourhood, and more:
  // eight to fourteen points at the site, fading with distance.
  const jump = 8 + 6 * rng(s, "shock");
  pole.level = Math.min(16, pole.level + jump);
  // The payroll: 1-2.5% of the city's jobs over four years, the anchor and
  // the suppliers, lawyers and lunch places it brings.
  const gain = 0.01 + 0.015 * rng(s, "shock");
  let best = "", ba = -1;
  for (const b of bbls) {
    const r = parcels[b];
    if (r?.block !== pole.name) continue;
    if ((r.lotArea ?? 0) > ba) { ba = r.lotArea ?? 0; best = b; }
  }
  const addr = best ? (resolveRec(parcels, s, best)?.address ?? "") : "";
  const a: Anchor = {
    id: (e.anchorSeq = (e.anchorSeq ?? 0) + 1), name, sector: kind.sector, pole: pick, state: "coming", m0: s.month,
    gain, jump, leftM: 48, pullM: Math.pow(1 + gain, 1 / 48) - 1, costAt: c,
    breakM: s.month + Math.round(6 + 12 * rng(s, "shock")), ...(e.gov ? { platformAt: e.gov.mayor.platform } : {}),
    ...(best ? { bbl: best } : {}),
  };
  a.why = why(s, {
    k: "anchor.chose", a: "firm", name, ...(best ? { bbl: best } : {}),
    n: { odds: p, cost: c, gain, jump },
    t: `${name} chose the city for its ${kind.what} · ${(gain * 100).toFixed(1)}% more jobs · won on cost, odds ${(p * 100).toFixed(0)}%`,
  }, [costWhy]);
  (e.anchors ??= []).push(a);
  (e.blackSwans ??= []).push({ m: s.month, kind: "anchor", size: Math.round(gain * 1000), sf: 0, title: `${name} picked the city` });
  raiseAlert(s, {
    kind: "swan", tone: "good", ...(best ? { bbl: best } : {}), why: a.why,
    title: "An anchor has picked the city",
    body: `${name} is bringing its ${kind.what} here${addr ? `, on a campus by ${addr}` : ""}, after a search that had ${FINALISTS} cities on the list. About ${(gain * 100).toFixed(1)}% more jobs in the city over four years, and the blocks around the site are being re-priced this morning.`,
    detail: "It chose on cost: pay, rent and taxes against the other finalists. The deal is not built yet — if the city's costs rise or City Hall turns on the package before the groundbreaking, it can still go elsewhere.",
  });
}

function tickAnchors(s: GameState) {
  const e = s.econ;
  const list = e.anchors;
  if (!list?.length) return;
  for (const a of [...list]) {
    const pole = s.poles?.[a.pole];
    if (a.state === "coming") {
      if (s.month < (a.breakM ?? s.month)) continue;
      // THE GROUNDBREAK, OR THE WALK. The firm looks again before it commits:
      // what the city costs now against what it cost when it chose, City
      // Hall's turn if the voters have since elected a mayor who ran against
      // the package, and whether the city can pay what it promised at all.
      const c = anchorCost(e).total;
      const g = e.gov;
      const turned = !!(g && a.platformAt && g.mayor.platform === "populist" && a.platformAt !== "populist");
      const board = !!g?.control;
      const pWalk = board ? 1 : Math.min(1, 1 / (1 + Math.exp(COST_BETA * (MOVE_HURDLE - (c - a.costAt)))) + (turned ? 0.4 : 0));
      if (rng(s, "shock") < pWalk) {
        if (pole) pole.level = Math.max(-16, pole.level - a.jump);
        e.anchors = e.anchors!.filter((x) => x !== a);
        const id = why(s, {
          k: "anchor.walked", a: "firm", name: a.name, ...(a.bbl ? { bbl: a.bbl } : {}),
          n: { costMove: c - a.costAt, odds: pWalk },
          t: `${a.name} walked before the groundbreaking · ${board ? "the city under a control board" : turned ? "City Hall turned against the package" : `the city ${((c - a.costAt) * 100).toFixed(1)}% dearer than when it chose`}`,
        }, [whyCityCost(s), a.why]);
        (e.blackSwans ??= []).push({ m: s.month, kind: "anchor", size: -1, sf: 0, title: `${a.name} walked away` });
        raiseAlert(s, {
          kind: "swan", tone: "bad", ...(a.bbl ? { bbl: a.bbl } : {}), why: id,
          title: "The campus is not coming",
          body: `${a.name} has pulled out before the groundbreaking. ${board ? "The city is under a control board and cannot deliver the package it offered." : turned ? "The council fight over the subsidies went public, the new administration ran against the deal, and the company has picked another city." : "The city has grown dearer since it chose, and another finalist has made a better offer."}`,
          detail: "The land around the site repriced on the promise and has to come back down without it. Whoever bought ground there since is holding the bag.",
        });
        continue;
      }
      a.state = "here";
      a.reviewM = s.month + 120 + Math.floor(60 * rng(s, "shock"));
      pushNewsPublic(s, "event", `${a.name} has broken ground on its campus. The hiring starts now.`,
        why(s, { k: "anchor.broke", a: "firm", name: a.name, ...(a.bbl ? { bbl: a.bbl } : {}), t: `${a.name} broke ground` }, [a.why]));
    }
    if (a.state === "here") {
      if (a.leftM > 0) { e.bsJobPull = (e.bsJobPull ?? 0) + a.pullM; a.leftM -= 1; }
      if (s.month < (a.reviewM ?? Infinity)) continue;
      // THE LEASE IS UP: stay, or go where it is cheaper. A real firm moves
      // when the savings beat the cost of moving.
      const c = anchorCost(e).total;
      const pLeave = 1 / (1 + Math.exp(COST_BETA * (MOVE_HURDLE - (c - a.costAt))));
      if (rng(s, "shock") < pLeave) {
        a.state = "leaving";
        a.leftM = 24;
        a.pullM = Math.pow(1 + a.gain, -1 / 24) - 1;
        const id = why(s, {
          k: "anchor.leaving", a: "firm", name: a.name, ...(a.bbl ? { bbl: a.bbl } : {}),
          n: { costMove: c - a.costAt, odds: pLeave, gain: a.gain },
          t: `${a.name} is leaving at lease end · the city ${((c - a.costAt) * 100).toFixed(1)}% ${c >= a.costAt ? "dearer" : "cheaper"} than when it came`,
        }, [whyCityCost(s), a.why]);
        (e.blackSwans ??= []).push({ m: s.month, kind: "anchor", size: -Math.round(a.gain * 1000), sf: 0, title: `${a.name} left the city` });
        raiseAlert(s, {
          kind: "swan", tone: "bad", ...(a.bbl ? { bbl: a.bbl } : {}), why: id,
          title: `${a.name} is leaving`,
          body: `${a.name}'s lease is up and it is not renewing: it has found a city where its people and its space cost less. About ${(a.gain * 100).toFixed(1)}% of the city's jobs will go over the next two years.`,
          detail: "Anchors choose a city on what it costs and leave on the same arithmetic. The suppliers, the lawyers and the lunch places it brought go with it.",
        });
      } else {
        a.reviewM = s.month + 120 + Math.floor(60 * rng(s, "shock"));
        // A renewal resets the comparison: the new lease is signed at today's costs.
        a.costAt = c;
      }
      continue;
    }
    if (a.state === "leaving") {
      if (a.leftM > 0) { e.bsJobPull = (e.bsJobPull ?? 0) + a.pullM; a.leftM -= 1; continue; }
      if (pole) pole.level = Math.max(-16, pole.level - a.jump);
      e.anchors = e.anchors!.filter((x) => x !== a);
    }
  }
  if (!e.anchors!.length) delete e.anchors;
}

/** A campus from a save made before the anchor was grown: its hiring still lands, then it is done. */
function tickLegacyCampus(s: GameState) {
  const c = s.econ.campus;
  if (!c) return;
  if (c.walkM !== undefined || c.leftM <= 0) { s.econ.campus = undefined; return; }
  s.econ.bsJobPull = (s.econ.bsJobPull ?? 0) + c.pullM;
  c.leftM -= 1;
}

/** Fire one on demand — tests and probes only; the game never calls this. */
export function forceBlackSwan(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null,
  kind: "embargo" | "arrivals" | "wave" | "panic" | "campus" | "anchor" | NatSwanKind, sev?: number) {
  void adjacency;
  if (kind === "embargo") startEmbargo(s);
  else if (kind === "arrivals") startArrivals(s);
  else if (kind === "wave") startCapitalWave(s);
  else if (kind === "panic") startPanic(s);
  else if (kind === "campus" || kind === "anchor") forceAnchor(s, parcels, bbls);
  else startNatSwan(s, kind, sev);
  publishNatSwans(s);
}

/** A shortlist the city wins, for probes: the same path, the shortlist hazard skipped, the win still on cost. */
function forceAnchor(s: GameState, parcels: ParcelTable, bbls: string[]) {
  for (let i = 0; i < 200 && !(s.econ.anchors ?? []).some((a) => a.m0 === s.month); i++) considerAnchor(s, parcels, bbls, true);
}
