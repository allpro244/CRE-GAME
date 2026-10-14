// BLACK SWANS (2026-10-14). The owner: the old swans "never felt like an
// actual swan — the effect didn't warrant the word, and they happened too
// often", and they were all one thing, a trade's level re-rolled off the
// industry mix. A swan is the event a city dates itself by. It is rare —
// about two and a half a century across every family here — and when one
// lands it is the story of the game.
//
// Each family is a real mechanism with a real record behind it, and each acts
// on the thing it actually hits — buildings, insurance, capital — never on a
// rent. The market answers the way it answers anything: a district that burns
// is stock that is gone and tenants who need somewhere to go, and the rebuild
// boom that follows is the developers, the land residual and the trades doing
// what they always do.
//
//   THE GREAT FIRE — Chicago 1871 (a third of the city), Baltimore 1904 (the
//   downtown core, 1,500 buildings), San Francisco 1906 (the fire after the
//   quake did most of the damage). A district burns. What stood is gone; the
//   land is not. Owners collect what their insurers can pay: about half in
//   Chicago, where 68 insurers failed, 80-90% in San Francisco and Baltimore.
//
//   THE STORM SURGE — Sandy 2012: lower Manhattan's waterfront flooded,
//   basements and plant destroyed, buildings dark for months, most of the
//   damage over the federal flood cap and so uninsured. And the market
//   remembered: exposed property traded at a lasting discount afterwards
//   (Ortega & Taspinar 2018: ~8% for flooded and non-flooded homes in the
//   zone alike, persisting and widening).
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
// MEASURED (2026-10-14). Four 100-year towns drew 1, 2, 3 and 3 swans. Each
// forced at year ten on four seeds and read against the same town without it:
//   panic   credit index -0.4 for two years; a recession inside a year in
//           three of four; a lender closed in two; jobs -3.5% at two years
//   fiscal  jobs -4.8% at four years, real land -8% at five, caps +0.4
//   campus  jobs +3.6% by year six, real land +4%, the chosen centre +8-14
//   fire    51-101 buildings, 0.6-0.9M sf; a third of the lots in the ground
//           again within two years, half standing by four
// and the century's trend reads as it did without them: jobs +1.1-1.4%/yr,
// real office rent +0.2-0.8%/yr.
//
// Its own RNG stream ("shock"), so the economy's other draws do not move.

import type { ParcelTable } from "@/data/types";
import type { BuiltClass, GameState } from "./types";
import type { ParcelRecord } from "@/data/types";
import { raiseAlert, logBooks, moveDeposit, START_YEAR } from "./types";
import { rng, addStock, pushNewsPublic } from "./market";
import { resolveRec, useRentableSf } from "./value";
import { uses } from "./mix";
import { replacementCost } from "./dev";
import { ownerOf } from "./rivals";
import { depositsOn } from "./leasing";
import { recordPropertyEvent } from "./history";
import { chargeLenderLoss } from "./lenders";

const YEAR = 12;
/** Annual odds, per city. Shape parameters from the record, stated as such. */
// Every family together runs to about two and a half a century (the panic, the
// fiscal crisis and the campus included): a hundred-year game sees two or
// three, and a given kind is once in a lifetime.
const FIRE_HAZ = 1 / 400;
const SURGE_HAZ = 1 / 250;
const WAVE_HAZ = 1 / 200;
const PANIC_HAZ = 1 / 200;
const FISCAL_HAZ = 1 / 350;
const CAMPUS_HAZ = 1 / 200;

const money = (x: number) => x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x / 1e3)}K`;

export function tickBlackSwans(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null) {
  const e = s.econ;
  tickCapitalWave(s);
  tickPanic(s);
  e.bsJobPull = 0;
  tickFiscal(s);
  tickCampus(s);
  // No swan in the opening year: the player has not had time to own anything.
  if (s.month < YEAR) return;
  // A FISCAL CRISIS IS NOT INDEPENDENT OF THE CYCLE. A city's revenue falls
  // with its payrolls and its bills do not, which is why 1975, 1978, 1990 and
  // 2013 all landed in or just after a downturn. Three times the odds in a
  // recession, half outside one: about the same rate over a century.
  const inRec = (e.nat?.recM ?? 0) > 0;
  const fiscalHaz = FISCAL_HAZ * (inRec ? 3 : 0.5);
  if (rng(s, "shock") < FIRE_HAZ / 12) greatFire(s, parcels, bbls, adjacency);
  else if (rng(s, "shock") < SURGE_HAZ / 12) stormSurge(s, parcels, bbls);
  else if (!e.capWave && rng(s, "shock") < WAVE_HAZ / 12) startCapitalWave(s);
  else if (!e.panic && rng(s, "shock") < PANIC_HAZ / 12) startPanic(s);
  else if (!e.fiscal && rng(s, "shock") < fiscalHaz / 12) startFiscal(s);
  else if (!e.campus && rng(s, "shock") < CAMPUS_HAZ / 12) startCampus(s, parcels, bbls);
}

// ---------------------------------------------------------------- the fire

/** A building gone, whoever owned it. Returns the insured payout made. */
function destroyBuilding(s: GameState, parcels: ParcelTable, bbl: string, payoutFrac: number, cause: string): { sf: number; paid: number; mine: boolean } {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea) return { sf: 0, paid: 0, mine: false };
  const e = s.econ;
  for (const u of uses(rec)) {
    const sf = useRentableSf(rec, u);
    addStock(e, u as BuiltClass, -sf);
    // Its tenants are out on the street, still wanting space: occupied falls,
    // demand does not.
    const vac = e.cityVac?.[u] ?? 0.08;
    if (e.occupied) e.occupied[u] = Math.max(0, (e.occupied[u] ?? 0) - sf * (1 - vac));
  }
  const paid = Math.round(replacementCost(rec, e) * payoutFrac);
  s.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  recordPropertyEvent(s, bbl, { kind: "demolished", sf: rec.bldgArea, use: rec.class, outcome: `${rec.yearBuilt || "Older"} building lost to the ${cause}; insurers paid ${money(paid)}` });
  const h = s.holdings[bbl];
  let mine = false;
  if (h) {
    mine = true;
    moveDeposit(s, h, -depositsOn(h));
    h.tenants = [];
    delete h.occ; delete h.makeReady; delete h.deliveredM; delete h.shellSf; delete h.leasingHold;
    h.condition = "standard";
    // THE LENDER IS PAID FIRST. Every mortgage names the lender as loss payee
    // on the policy: casualty proceeds retire the debt before the owner sees a
    // dollar, and without a prepayment charge — nobody chose to prepay. Only
    // what is left over reaches the owner, and a loan bigger than the cheque
    // stays on the dirt.
    let left = paid;
    for (const leg of ["loan", "mezz"] as const) {
      const ln = h[leg];
      if (!ln || left <= 0) continue;
      const take = Math.min(left, ln.balance);
      ln.balance = Math.round(ln.balance - take);
      left -= take;
      if (ln.balance <= 1) delete h[leg];
    }
    const intoFund = !!(h.fundOwned && s.fund && !s.fund.settled);
    if (intoFund && s.fund) s.fund.cash += left; else s.cash += left;
    // Repaying principal is a balance-sheet movement, not income: only what
    // reached the owner is booked, as a sale books its proceeds.
    if (left > 0) logBooks(s, "sold", left, bbl, intoFund);
    s.lois = s.lois.filter((l) => l.bbl !== bbl);
  } else {
    const r = ownerOf(s, bbl);
    if (r) r.cash = (r.cash ?? 0) + paid;
  }
  s.listings = s.listings.filter((l) => l.bbl !== bbl);
  return { sf: rec.bldgArea, paid, mine };
}

function greatFire(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null) {
  if (!adjacency) return;
  const yr = START_YEAR + Math.floor(s.month / 12);
  const built = (b: string) => {
    if (s.landmarks?.[b] !== undefined) return null;          // stone and a fire wall: the landmarks stand
    if ((s.cityJobs ?? []).some((j) => j.bbl === b) || s.developments[b]) return null;
    const r = resolveRec(parcels, s, b);
    return r && r.class !== "land" && r.bldgArea > 0 ? r : null;
  };
  const standing = bbls.filter((b) => built(b));
  if (standing.length < 50) return;
  // Where it starts: the old fabric burns first — timber floors and party
  // walls — so a building's odds of being the origin rise with its age.
  const age = (r: ParcelRecord) => Math.max(0, yr - (r.yearBuilt || 1920));
  let tot = 0; const w = standing.map((b) => { const a = 1 + age(built(b)!) / 40; tot += a; return a; });
  let u = rng(s, "shock") * tot, origin = standing[0];
  for (let i = 0; i < standing.length; i++) { u -= w[i]; if (u <= 0) { origin = standing[i]; break; } }
  // How far it runs: lognormal around 5% of the city's buildings (a
  // Baltimore: the whole downtown core), one in a hundred past 16% (towards a
  // Chicago). Smaller than that and it is a bad fire, not the one a city
  // dates itself by.
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng(s, "shock")))) * Math.cos(2 * Math.PI * rng(s, "shock"));
  const target = Math.max(12, Math.round(standing.length * 0.05 * Math.exp(0.5 * z)));
  // IT TAKES A DISTRICT. The fire runs outward from where it started, block
  // by block, until it has burned what it was going to burn — the size drawn
  // above. On the way a new high-spec building (sprinklers, a concrete frame,
  // a fire stair) usually stands while its neighbours go, as the steel-framed
  // towers did in Baltimore in 1904; the landmarks stand. What is left is the
  // contiguous burned district every one of those fires left.
  const c0 = parcels[origin]?.centroid ?? [0, 0];
  // Degrees of longitude are shorter than degrees of latitude away from the
  // equator; scale them so the burned district is round, not an ellipse.
  const kx = Math.cos((c0[1] * Math.PI) / 180);
  const d2 = (b: string) => { const c = parcels[b]?.centroid ?? c0; return ((c[0] - c0[0]) * kx) ** 2 + (c[1] - c0[1]) ** 2; };
  const ring = [...standing].sort((a, b) => d2(a) - d2(b));
  const burned: string[] = [];
  for (const b of ring) {
    if (burned.length >= target) break;
    const r = built(b)!;
    const stands = Math.max(0, 0.75 * ((r.buildSpec ?? 0.5) - 0.5) * 2 - age(r) / 200);
    if (b !== origin && rng(s, "shock") < stands) continue;
    burned.push(b);
  }
  void adjacency;
  if (burned.length < 3) return;
  // What the insurers can pay: Chicago's paid about half, 1906 and 1904 most.
  const payoutFrac = 0.5 + 0.45 * rng(s, "shock");
  let sf = 0, paid = 0, mineN = 0;
  for (const b of burned) {
    const r = destroyBuilding(s, parcels, b, payoutFrac, "fire");
    sf += r.sf; paid += r.paid; if (r.mine) mineN++;
  }
  const where = resolveRec(parcels, s, origin);
  const district = (where as { districtName?: string; district?: string } | null)?.districtName ?? "the old quarter";
  (s.econ.blackSwans ??= []).push({ m: s.month, kind: "fire", size: burned.length, sf: Math.round(sf), title: `the Great Fire of ${yr}`, bbls: burned });
  raiseAlert(s, {
    kind: "swan", tone: "bad", bbl: origin,
    title: `The Great Fire of ${yr}`,
    body: `It started near ${where?.address ?? "the waterfront"} and burned for two days. ${burned.length} buildings and ${(sf / 1e6).toFixed(2)}M sf are gone`
      + (mineN ? `, ${mineN} of them yours` : "") + `. The insurers are paying about ${Math.round(payoutFrac * 100)} cents on the dollar of rebuilding cost — ${money(paid)} in all.`,
    detail: `The land is still there and the tenants still need somewhere to be. Every crane in the region is about to be booked, and whoever owns cleared ground in ${district} owns the rebuild.`,
  });
}

// ---------------------------------------------------------------- the surge

function stormSurge(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const e = s.econ;
  // HOW FAR IT RUNS IS HOW HIGH IT WAS. Distance from the shore stands in for
  // elevation: a surge floods the lowest 6-15% of the city's buildings —
  // Sandy's flood zone was about a tenth of Manhattan — and the zone it
  // reached is the zone buyers remember (`surgeM`, read by capRateFor).
  const standing = bbls.map((b) => resolveRec(parcels, s, b)).filter((r) => r && r.class !== "land" && r.bldgArea > 0) as ParcelRecord[];
  if (standing.length < 50) return;
  const dist = standing.map((r) => r.shoreM ?? 9999).sort((a, b) => a - b);
  const reach = Math.max(e.surgeM ?? 0, dist[Math.floor((0.06 + 0.09 * rng(s, "shock")) * (dist.length - 1))]);
  const zone = standing.filter((r) => (r.shoreM ?? 9999) <= reach).map((r) => r.bbl);
  if (zone.length < 5) return;
  e.surgeM = reach;
  const yr = START_YEAR + Math.floor(s.month / 12);
  // Damage as a share of rebuilding cost: plant, electrical and fit-out in
  // the flooded floors. Most of it over the federal flood cap — uninsured.
  const dmg = 0.06 + 0.10 * rng(s, "shock");
  const uninsured = 0.4 + 0.3 * rng(s, "shock");
  let total = 0, mineCost = 0, mineN = 0;
  for (const b of zone) {
    const rec = resolveRec(parcels, s, b)!;
    const cost = replacementCost(rec, e) * dmg;
    total += cost;
    const h = s.holdings[b];
    if (h) {
      const own = Math.round(cost * uninsured);
      mineCost += own; mineN++;
      const intoFund = !!(h.fundOwned && s.fund && !s.fund.settled);
      if (intoFund && s.fund) s.fund.cash -= own; else s.cash -= own;
      logBooks(s, "capex", own, b, intoFund);
      h.condIdx = Math.max(0.05, (h.condIdx ?? 0.6) - 0.12);
    } else {
      const r = ownerOf(s, b);
      if (r) r.cash = (r.cash ?? 0) - cost * uninsured;
    }
  }
  // AND THE MARKET REMEMBERS: the zone trades at a lasting risk premium.
  e.surgeRisk = (e.surgeRisk ?? 0) + 0.4 + 0.3 * rng(s, "shock");
  (e.blackSwans ??= []).push({ m: s.month, kind: "surge", size: zone.length, sf: 0, title: `the surge of ${yr}` });
  raiseAlert(s, {
    kind: "swan", tone: "bad",
    title: `The surge of ${yr}`,
    body: `A storm drove the harbour over the seawall. ${zone.length} buildings within ${Math.round(reach)} m of the shore flooded — basements, switchgear and lobbies — ${money(total)} of damage, about ${Math.round(uninsured * 100)}% of it over the flood cap and uninsured.`
      + (mineN ? ` ${mineN} of the buildings are yours: ${money(mineCost)} out of pocket, and they will need capital.` : ""),
    detail: `Buyers will price the waterfront differently from now on — about ${(e.surgeRisk).toFixed(1)} points more yield to own anything the water can reach.`,
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
export function forceBlackSwan(s: GameState, parcels: ParcelTable, bbls: string[], adjacency: Record<string, string[]> | null, kind: "fire" | "surge" | "wave" | "panic" | "fiscal" | "campus") {
  if (kind === "fire") greatFire(s, parcels, bbls, adjacency);
  else if (kind === "surge") stormSurge(s, parcels, bbls);
  else if (kind === "wave") startCapitalWave(s);
  else if (kind === "panic") startPanic(s);
  else if (kind === "fiscal") startFiscal(s);
  else startCampus(s, parcels, bbls);
}
