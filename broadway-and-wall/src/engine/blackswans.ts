// BLACK SWANS (2026-10-14). The owner: the old swans "never felt like an
// actual swan — the effect didn't warrant the word, and they happened too
// often", and they were all one thing, a trade's level re-rolled off the
// industry mix. A swan is the event a city dates itself by. It is rare —
// about two and a half a century across every family here — and when one
// lands it is the story of the game.
//
// Each family is a real mechanism with a real record behind it, and each acts
// on the thing it actually hits — capital, credit, the tax bill, the cost of
// building, a centre's fortunes, how many people need a home — never on a
// rent directly. The market answers the way it answers anything.
// (A great fire and a storm surge were tried and cut, owner 2026-10-14.)
//
//   THE CAPITAL WAVE — 1986-90, when Japanese buyers paid yields nobody local
//   would (Rockefeller Center, the Exxon Building at a record price), cap
//   rates compressed for years, and then the money went home all at once and
//   the early-1990s valuations crashed through where they had started. A
//   white swan for whoever sells into it, a black one for whoever buys.
//
//   THE PANIC — 1907 (the Knickerbocker Trust), 1970 (Penn Central's paper),
//   2008 (Lehman). A big lender takes a hole somewhere far from this city's
//   buildings, and overnight nobody will lend to anybody. It is not the
//   business cycle closing the window, it is the window slamming in the
//   middle of whatever the cycle was doing — and more often than not (1907
//   and 2008 did, 1970 and 1998 did not) it drags the economy into the
//   recession it was not otherwise due.
//
//   THE FISCAL CRISIS — New York 1975 ("Ford to City: Drop Dead"), Cleveland
//   1978, Philadelphia 1990, Detroit 2013. The city cannot roll its debt. It
//   lays off its own workforce, cuts services, and raises the property tax
//   to pay the bondholders — New York cut a fifth of its municipal payroll
//   and lost about one job in six between 1969 and 1977. The tax stays up
//   for a generation; the jobs take a decade to come back.
//
//   THE CAMPUS — the white swan nobody can plan for: an anchor employer picks
//   one of the town's centres for its headquarters or research campus, and
//   the ground around it reprices on the morning of the announcement. And
//   sometimes it walks before a shovel goes in (Amazon in Long Island City,
//   November 2018 to February 2019), and whoever paid up for the land
//   between owns very expensive dirt.
//
//   THE EMBARGO — October 1973. The oil exporters cut supply and the price of
//   a barrel quadrupled in three months. Inflation went from 3% to 12% inside
//   a year and the central bank chased it into the 1974-75 recession; and
//   construction, which runs on diesel, asphalt, steel and resin, took it
//   worst: the BLS construction-materials index rose about 30% in 1974 alone
//   against CPI's 11%. Every job in the ground went over budget, every pro
//   forma written the year before was wrong, and the developers who had
//   fixed-price contracts and the ones who did not found out which they were.
//
//   THE ARRIVALS — April to October 1980, the Mariel boatlift: 125,000 people
//   landed in Miami in five months, 7% of its labour force (Card 1990). And
//   1990-91, when the Soviet Union opened its doors and Israel's population
//   rose 8% in two years; rents went up by a third before the builders caught
//   up. A wave of newcomers does not wait for a flat to be empty: they double
//   up, take the spare room, and the town's housing is suddenly short. Card
//   found Miami's labour market absorbed them within a few years — which is
//   the jobs model's business, not this file's.
//
// MEASURED (2026-10-14). Each forced at year ten on four seeds and read
// against the same town without it:
//   panic   credit index -0.4 for two years; a recession inside a year in
//           three of four; a lender closed in two; jobs -3.5% at two years
//   fiscal  jobs -4.8% at four years, real land -8% at five, caps +0.4
//   campus  jobs +3.6% by year six, real land +4%, the chosen centre +8-14
//
// Its own RNG stream ("shock"), so the economy's other draws do not move.

import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { raiseAlert, START_YEAR } from "./types";
import { rng, pushNewsPublic, islandResidents } from "./market";
import { resolveRec } from "./value";
import { chargeLenderLoss } from "./lenders";

const YEAR = 12;
/** Annual odds, per city. Shape parameters from the record, stated as such. */
// Every family together runs to about two and a half a century: a hundred-year
// game sees two or three, and a given kind is once in a lifetime.
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
const FISCAL_HAZ = 1 / 350;
const CAMPUS_HAZ = 1 / 200;
const EMBARGO_HAZ = 1 / 250;
const ARRIVALS_HAZ = 1 / 250;

export function tickBlackSwans(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null) {
  void adjacency;
  const e = s.econ;
  tickCapitalWave(s);
  tickPanic(s);
  e.bsJobPull = 0;
  tickFiscal(s);
  tickCampus(s);
  tickEmbargo(s);
  tickArrivals(s);
  // No swan in the opening year: the player has not had time to own anything.
  if (s.month < YEAR) return;
  // A FISCAL CRISIS IS NOT INDEPENDENT OF THE CYCLE. A city's revenue falls
  // with its payrolls and its bills do not, which is why 1975, 1978, 1990 and
  // 2013 all landed in or just after a downturn. Three times the odds in a
  // recession, half outside one: about the same rate over a century.
  const inRec = (e.nat?.recM ?? 0) > 0;
  const fiscalHaz = FISCAL_HAZ * (inRec ? 3 : 0.5);
  if (!e.embargo && rng(s, "shock") < EMBARGO_HAZ / 12) startEmbargo(s);
  else if (!e.arrivals && rng(s, "shock") < ARRIVALS_HAZ / 12) startArrivals(s);
  else if (!e.capWave && rng(s, "shock") < WAVE_HAZ / 12) startCapitalWave(s);
  else if (!e.panic && rng(s, "shock") < panicHazard(e.nat?.credGap ?? 0) / 12) startPanic(s);
  else if (!e.fiscal && rng(s, "shock") < fiscalHaz / 12) startFiscal(s);
  else if (!e.campus && rng(s, "shock") < CAMPUS_HAZ / 12) startCampus(s, parcels, bbls);
}

// ---------------------------------------------------------------- the embargo

function tickEmbargo(s: GameState) {
  const e = s.econ, x = e.embargo;
  if (!x) return;
  // The materials premium lands over the first year, then is simply the new
  // price of materials: nobody hands it back (the 1974 jump never reversed in
  // nominal terms). `costShock` is read once per month by the cost index.
  if (x.leftM > 0) { e.costShock = (e.costShock ?? 0) + x.monthly; x.leftM -= 1; }
  else e.embargo = undefined;
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
  // THE TRADES: materials 12-20% over and above the general inflation the
  // cost index already passes through, landing over twelve months.
  const jump = 0.12 + 0.08 * rng(s, "shock");
  e.embargo = { leftM: 12, monthly: Math.pow(1 + jump, 1 / 12) - 1 };
  (e.blackSwans ??= []).push({ m: s.month, kind: "embargo", size: Math.round(jump * 100), sf: 0, title: `the embargo of ${yr}` });
  raiseAlert(s, {
    kind: "swan", tone: "bad",
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
 * the county at large. Half of them on the island is a shape parameter; the
 * location margin (`locEff`, market.ts) then sorts them back out over its
 * own five-year half-life, as those families did.
 */
const ARRIVALS_CORE = 0.5;

function tickArrivals(s: GameState) {
  const e = s.econ, x = e.arrivals;
  if (!x) { e.bsMigPull = 0; return; }
  if (x.leftM > 0) {
    e.bsMigPull = x.monthly; x.leftM -= 1;
    const share = Math.min(1, islandResidents(e).residents / Math.max(1, e.population ?? 1));
    if (share > 0 && share < ARRIVALS_CORE && e.locEff) {
      e.locEff.multifamily *= 1 + x.monthly * (ARRIVALS_CORE / share - 1);
    }
  } else { e.bsMigPull = 0; e.arrivals = undefined; }
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
  raiseAlert(s, {
    kind: "swan", tone: "good",
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
  const next = (phase: "hold" | "out" | "fade", len: number, to: number) => { e.capWave = { phase, leftM: len, len, from: e.capitalWave ?? 0, to }; };
  if (w.phase === "in") next("hold", Math.round(12 + 12 * rng(s, "shock")), w.to);
  else if (w.phase === "hold") {
    next("out", Math.round(12 + 12 * rng(s, "shock")), 0.3 + 0.3 * rng(s, "shock"));
    pushNewsPublic(s, "warn", "The foreign buyers have gone home. The bids that set every price in town for five years are simply not there any more, and nobody local will pay what they paid.");
  } else if (w.phase === "out") next("fade", 36, 0);
  else { e.capWave = undefined; e.capitalWave = 0; }
}

function startCapitalWave(s: GameState) {
  const e = s.econ;
  const depth = -(0.8 + 0.7 * rng(s, "shock"));
  e.capWave = { phase: "in", leftM: 36, len: 36, from: e.capitalWave ?? 0, to: depth };
  (e.blackSwans ??= []).push({ m: s.month, kind: "wave", size: Math.round(-depth * 100), sf: 0, title: "foreign capital found the city" });
  raiseAlert(s, {
    kind: "swan", tone: "good",
    title: "Foreign capital has found the city",
    body: `Buyers from abroad are paying yields nobody local will — trophy towers first, then everything. Over the next three years they will take about ${(-depth).toFixed(1)} points off every cap rate in town.`,
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
    pushNewsPublic(s, "event", "The panic is over. Nobody announced it; the commercial paper simply started rolling again, and the lenders started taking calls.");
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
  let name = "";
  if (live.length) {
    const tot = live.reduce((a, l) => a + Math.max(1, l.book), 0);
    let u = rng(s, "shock") * tot;
    let hit = live[0];
    for (const l of live) { u -= Math.max(1, l.book); if (u <= 0) { hit = l; break; } }
    // Between half its capital and more than all of it: some of the time it
    // survives on its knees, some of the time the examiners come on Friday.
    const loss = hit.capital * (0.5 + 0.8 * rng(s, "shock"));
    chargeLenderLoss(s, hit.name, loss);
    name = hit.name;
  }
  // How long the run lasts at full force: the acute phase of 1907 was about
  // three weeks and its credit squeeze half a year; 2008's ran from September
  // to the following spring.
  e.panic = { leftM: Math.round(4 + 8 * rng(s, "shock")), force: 1 };
  (e.blackSwans ??= []).push({ m: s.month, kind: "panic", size: 1, sf: 0, title: `the Panic of ${yr}` });
  raiseAlert(s, {
    kind: "swan", tone: "bad",
    title: `The Panic of ${yr}`,
    body: (name ? `${name} has disclosed losses far from this city — a book nobody here knew it had — and ` : "A trust company has failed on losses nobody here knew about, and ")
      + "by the afternoon nobody would lend to anybody. Term sheets are being pulled mid-closing, lines are being cut, and the bond market has stopped quoting.",
    detail: "It is not the cycle; it is the window slamming in the middle of whatever the cycle was doing. Panics like this one have tipped the economy into recession more often than not. Anything that has to be refinanced in the next year is now the problem.",
  });
}

// ---------------------------------------------------------------- the fiscal crisis

function tickFiscal(s: GameState) {
  const e = s.econ;
  // The tax comes down slowly — New York's 1970s rates were a generation
  // unwinding — about a twentieth of the surcharge a year.
  if (e.taxMult !== undefined && e.taxMult !== 1) {
    e.taxMult = 1 + (e.taxMult - 1) * Math.pow(0.95, 1 / 12);
    if (Math.abs(e.taxMult - 1) < 0.005) delete e.taxMult;
  }
  const f = e.fiscal;
  if (!f) return;
  if (f.leftM > 0) { e.bsJobPull = (e.bsJobPull ?? 0) + f.pullM; f.leftM -= 1; }
  else {
    e.fiscal = undefined;
    pushNewsPublic(s, "event", "The control board has handed the city its books back. The budget balances, the bonds are selling again, and the city that came out the other side is smaller than the one that went in.");
  }
}

function startFiscal(s: GameState) {
  const e = s.econ;
  // THE BILL: a surcharge on the property tax of a fifth to two fifths — the
  // city's one revenue it can raise by vote, and the one its bondholders are
  // secured by.
  const surcharge = 0.2 + 0.2 * rng(s, "shock");
  e.taxMult = (e.taxMult ?? 1) * (1 + surcharge);
  // THE JOBS: the city's own layoffs, the services that go with them, and the
  // households and firms that leave because the streets got worse — 3-7% of
  // the city's payroll over three to five years, net of the cycle.
  const loss = 0.03 + 0.04 * rng(s, "shock");
  const months = Math.round(36 + 24 * rng(s, "shock"));
  e.fiscal = { leftM: months, pullM: Math.pow(1 - loss, 1 / months) - 1 };
  (e.blackSwans ??= []).push({ m: s.month, kind: "fiscal", size: Math.round(loss * 100), sf: 0, title: "the city could not pay its bills" });
  raiseAlert(s, {
    kind: "swan", tone: "bad",
    title: `The city cannot pay its bills`,
    body: `The banks have refused to roll the city's notes, and Washington has said no. A control board has taken the budget: ${Math.round(surcharge * 100)}% on every property-tax bill from this year, a fifth of the municipal payroll laid off, and the services that go with it.`,
    detail: `Every building's tax bill just went up and stays up — the board pays the bondholders first. And the cuts do what cuts do: over the next ${Math.round(months / 12)} years expect about ${Math.round(loss * 100)}% of the city's jobs to go somewhere else.`,
  });
}

// ---------------------------------------------------------------- the campus

const CAMPUS_KIND = [
  "a technology company's second headquarters",
  "a hospital system's research campus",
  "a bank's new operations headquarters",
  "a university's new science campus",
  "a pharmaceutical company's research headquarters",
];

function tickCampus(s: GameState) {
  const e = s.econ;
  const c = e.campus;
  if (!c) return;
  if (c.walkM !== undefined) {
    c.walkM -= 1;
    if (c.walkM <= 0) {
      // IT WALKED. The politics turned, the subsidy package became a campaign
      // issue, and the company announced it would go elsewhere — after the
      // land around the site had already repriced on the promise.
      const p = s.poles?.[c.pole];
      if (p) p.level = Math.max(-16, p.level - c.jump);
      (e.blackSwans ??= []).push({ m: s.month, kind: "campus", size: -1, sf: 0, title: "the campus walked away" });
      raiseAlert(s, {
        kind: "swan", tone: "bad",
        title: "The campus is not coming",
        body: `${c.name[0].toUpperCase()}${c.name.slice(1)} has pulled out. The council fight over the subsidies went public, the company said it would not build where it was not wanted, and it has picked another city.`,
        detail: "The land around the site repriced on the promise and has to come back down without it. Whoever bought ground there in the last year is holding the bag.",
      });
      e.campus = undefined;
      return;
    }
  }
  if (c.leftM > 0 && c.walkM === undefined) { e.bsJobPull = (e.bsJobPull ?? 0) + c.pullM; c.leftM -= 1; }
  else if (c.leftM <= 0) e.campus = undefined;
}

function startCampus(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const e = s.econ;
  const poles = s.poles ?? [];
  if (poles.length < 2) return;
  // NOT THE ADDRESS EVERYBODY ALREADY KNOWS. Anchors go where the land is
  // cheap enough to assemble a campus and the subsidy is on offer — the
  // centre that is losing, not the one that won.
  const order = poles.map((p, i) => ({ i, lvl: p.level })).sort((a, b) => a.lvl - b.lvl);
  const pick = order[Math.floor(rng(s, "shock") * Math.max(1, order.length - 1))].i;
  const p = poles[pick];
  // About as far as a well-located station moves a neighbourhood, and more:
  // eight to fourteen points at the site, fading with distance.
  const jump = 8 + 6 * rng(s, "shock");
  p.level = Math.min(16, p.level + jump);
  // The payroll: 1-2.5% of the city's jobs over four years, the anchor and
  // the suppliers, lawyers and lunch places it brings.
  const gain = 0.01 + 0.015 * rng(s, "shock");
  const months = 48;
  const name = CAMPUS_KIND[Math.floor(rng(s, "shock") * CAMPUS_KIND.length)];
  // Three times in ten it walks before ground is broken.
  const walks = rng(s, "shock") < 0.3;
  e.campus = { pole: pick, leftM: months, pullM: Math.pow(1 + gain, 1 / months) - 1, jump, name,
    ...(walks ? { walkM: Math.round(6 + 12 * rng(s, "shock")) } : {}) };
  // Where: the biggest lot on the centre's own block (a pole is named for
  // the block it was found on).
  let best = "", ba = -1;
  for (const b of bbls) {
    const r = parcels[b];
    if (r?.block !== p.name) continue;
    if ((r.lotArea ?? 0) > ba) { ba = r.lotArea ?? 0; best = b; }
  }
  const addr = best ? (resolveRec(parcels, s, best)?.address ?? "") : "";
  (e.blackSwans ??= []).push({ m: s.month, kind: "campus", size: Math.round(gain * 1000), sf: 0, title: `${name} picked the city` });
  raiseAlert(s, {
    kind: "swan", tone: "good", ...(best ? { bbl: best } : {}),
    title: "An anchor has picked the city",
    body: `${name[0].toUpperCase()}${name.slice(1)} is coming${addr ? `, on a campus by ${addr}` : ""}. About ${(gain * 100).toFixed(1)}% more jobs in the city over four years, and the blocks around the site are being re-priced this morning.`,
    detail: "The ground near the site is worth more today than it was yesterday, and everybody knows it. The deal is not built yet — subsidy packages have been known to come apart in the council before a shovel goes in.",
  });
}

/** Fire one on demand — tests and probes only; the game never calls this. */
export function forceBlackSwan(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null, kind: "embargo" | "arrivals" | "wave" | "panic" | "fiscal" | "campus") {
  void adjacency;
  if (kind === "embargo") startEmbargo(s);
  else if (kind === "arrivals") startArrivals(s);
  else if (kind === "wave") startCapitalWave(s);
  else if (kind === "panic") startPanic(s);
  else if (kind === "fiscal") startFiscal(s);
  else startCampus(s, parcels, bbls);
}
