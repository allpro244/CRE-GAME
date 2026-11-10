// THE TENANT MARKET (ONE_ECONOMY_PLAN.md step 4, 2026-10-29).
//
// Rent used to be an equation of the city's vacancy against a "natural" rate
// per class (market.ts NATURAL_VAC, `rentDriftAt`, `vacTerm`), and every lease
// was priced off the index that equation moved. Here nobody sets the rent of
// the town. Two kinds of agent meet:
//
//   LANDLORDS PRICE THEIR OWN SPACE. Each street building's owner holds an
//   asking rent for each kind of space it has, in dollars. An office
//   landlord trades rent against months dark: when the market's space takes
//   longer to let than the months at which a cut gains as much in months as
//   it gives up in rent, it cuts — harder when its loan is in trouble — and
//   when space lets faster, it raises. A shop or shed landlord cuts when its
//   space has sat past its patience (learned from its own lettings) and
//   raises when space lets fast. Both keep within reach of the comparable
//   deals their brokers show them when their own space says they are out of
//   line.
//
//   TENANTS SHOP. A firm looking for space — new, growing, or at the end of a
//   lease — gets a broker's shortlist of buildings with room, and weighs each
//   on what the space is worth to it (the building's market rent, how well the
//   building fits the quality it shops for, and how far it is from the firms it
//   trades with and the people who work for it) against what the landlord will
//   take and what moving costs. It signs where the deal is best for it, and it
//   bargains from its options: the landlord it chooses has to beat the
//   runner-up, so a firm with a close second gets a concession and a firm with
//   nowhere else to go pays the ask.
//
//   AND TENANTS COMPETE. The firms looking in a month tour the same market, so
//   in a tight one several want the same suite. Its landlord takes the best
//   proposal its room holds, the firm it signs pays enough to beat the best
//   one it turned away (`contestPrice`), and its next suite is posted at what
//   this one fetched (`noteContest`). Where space is plentiful nobody is
//   turned away and none of this binds; it is what makes rents climb fastest
//   at the lowest vacancy.
//
// The city's rent index is then a READ-OUT of the leases signed (`readOut`),
// and so are its concession level and the rent swing between quality bands.
//
// Constants carry [S] when they are a measured fact with a source and [K]
// when they are a shape parameter, stated as such (CLAUDE.md).
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, Credit, Econ, GameState, Tenant } from "./types";
import { SIZE_DIST } from "./plates";
import { tenantQualityTerms } from "./bands";
import { FIRM_PROFILE, SF_PER_JOB, MAKE_READY_M, CONC_DEPTH } from "./market";
import { IO_A, INDUSTRY_IDS, N_IND, sfMix } from "./industries";

export type Comm = "office" | "retail" | "industrial";

/**
 * A FIRM'S HEADS (FORMULA_LEDGER #10): the floor it needs in reference feet
 * (streetRolls.ts `firmHc`: what it took at signing, moved by its staff since)
 * over the feet a worker of its industry takes on its class's floor
 * (industries.ts `sfMix` on market.ts SF_PER_JOB). Its need is those heads
 * times those feet — the same number read the other way. economy.ts and
 * streetRolls.ts read these heads.
 */
export function tenantHeads(t: Tenant): number {
  const k = (t.use ?? "office") as Comm;
  return (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1) / ((SF_PER_JOB[k] || 230) * sfMix(t.ind, k));
}
export const COMM_USES: Comm[] = ["office", "retail", "industrial"];

// ---------------------------------------------------------------- the facts

/**
 * WHAT A MOVE COSTS THE TENANT, $/sf in 2024 money (times the town's cost
 * index), all in: the move itself, cabling, IT and furniture ($15-35/sf in
 * the JLL and Cushman & Wakefield relocation guides, 2019-2024), the new
 * fit-out the landlord's allowance does not cover (office fit-outs run
 * $100-200/sf against allowances of $50-120, CBRE fit-out cost guides), and
 * the weeks of disruption. A shop adds fixtures and the sales lost while it
 * reopens; a shed is racking, power and equipment [S~: the middles of those
 * ranges, summed].
 */
export const MOVE_PSF: Record<Comm, number> = { office: 50, retail: 50, industrial: 15 };

/** Buildings on a tenant broker's shortlist: a tour book runs five to eight (CBRE / JLL tenant-rep practice) [K]. */
export const SHORTLIST = 6;

/**
 * HOW FAR A FIRM'S TRIPS GO IN AN HOUR, door to door: about 15 km/h in a
 * town's mix of walking, transit and driving (NHTS 2017: urban car trips
 * ~30 km/h, bus ~12, walking 5, all modes with access time ~15-20) [S~].
 */
const SPEED_M_PER_H = 15_000;
/**
 * TRIPS A YEAR BETWEEN A FIRM AND EACH FIRM IT TRADES WITH BY NAME: about one
 * a week — meetings, site visits, deliveries [K].
 */
const LINK_TRIPS_YR = 50;
/** Working days a year, for the commute [S: 260 less ~30 days of leave and holidays]. */
const COMMUTE_DAYS = 230;
/**
 * WHAT A COMMUTE COSTS, and who pays it. US DOT values personal travel time at
 * half the wage [S: USDOT, "Revised Departmental Guidance on Valuation of
 * Travel Time", 2016]; a firm that moves further from its people pays about
 * half of their extra commute in wages or loses them [S~: Mulalic, van
 * Ommeren & Pilegaard 2014, Economic Journal — firm relocations in Denmark].
 */
const COMMUTE_VOT = 0.5, COMMUTE_FIRM_SHARE = 0.5;
/** Paid hours a year, for the hourly cost of a head [S: 52 x 40 less leave ≈ 2,000]. */
const HOURS_YR = 2000;
/**
 * A FIRM'S NAMED RELATIONSHIPS (economy.ts LINKS_PER_FIRM, about three
 * suppliers a firm keeps by name): a firm with fewer counts the centre of its
 * industry's customers for the rest.
 */
const LINKS_EXPECTED = 3;

/**
 * THE REASONS A FIRM MOVES THAT ARE NOT IN ITS BOOKS — a merger, a new partner
 * who hates the commute, a landlord it has fallen out with — as a taste for
 * each building, Gumbel-distributed with this scale against the building's
 * rent (the logit of discrete-choice location models). It sets two things at
 * once, and is calibrated against both (2026-11-09):
 *
 *   HOW HARD A BUILDING'S LETTINGS ANSWER ITS POST. A building chosen with
 *   odds P answers its post with elasticity (post / scale)·(1 - P), about
 *   (1/TASTE)·6/7 with a shortlist of six and the firm's own suite, plus the
 *   broker's tour-book weight (KEEN_POW: zero for office and sheds)
 *   (`askElasticity`). The record puts the office figure near 4.5, from two
 *   independent facts: (a) US office space on the market takes ~20-25 months
 *   to absorb at ~11% vacancy (CBRE / CoStar availability over trailing
 *   net absorption, 2010s; Cushman & Wakefield months of supply) [S~], and a
 *   landlord trading rent against months dark lets at N/(ε-1) months with
 *   N = 84 (`bestMonthsToLet`), so ε = 1 + 84/22 ≈ 4.8; (b) the Wheaton-Torto
 *   rent adjustment, real office rent growth falling 2-3% a year for each
 *   point of vacancy (Wheaton & Torto 1988; Hendershott 1996) [S], which with
 *   the landlord's step ln(Mbest/M)/ε and M rising with vacancy gives ε ≈ 4-5 (REAL_ECONOMY_PLAN, "Office rents and vacancy", step 9a take 2).
 *   So office TASTE = (6/7)/4.5 ≈ 0.19. It was 0.10, fitted to renewals
 *   alone, which with the broker's price cube (KEEN_POW 3) gave ε ≈ 11.6 — measured 6-10 in an
 *   ask test — 2.5 times the record.
 *
 *   SHOPS AND SHEDS (2026-11-09) have no published months-of-supply series
 *   to read, so their figure is derived by Little's law from facts that are
 *   published: the months space takes to let is the vacant stock over the
 *   new-tenant lettings a year, and new-tenant lettings are the expiring
 *   space that does not renew, (1 - R)·occupancy / lease term, plus net
 *   absorption g. ε then follows from the same trade, ε = 1 + N/M, with N the
 *   class's own term.
 *     office      R 55%, N 84 mo, v 11%, g 1%/yr → M ≈ 20, ε ≈ 5.3
 *                 (a check: the months-of-supply reading above gives 4.5-4.8)
 *     shops       R 65% (lease-expiry studies, above; Kimco reports ~90%
 *                 renewal-and-option retention in a 96%-let grocery-anchored
 *                 portfolio, 2024 annual report — the top of the range),
 *                 N 90 mo (shop leases run 5-10 years), v 7% (CoStar /
 *                 REIS US retail 1990-2024: 4-13%), g 0.5%/yr → M ≈ 17,
 *                 ε ≈ 6.2
 *     sheds       R 75% (Prologis retention 69-87%, 10-Ks 2012-25), N 60 mo
 *                 (industrial leases run about five years; CompStak WALT,
 *                 industrial ~0.7 x office), v 7% (CBRE US industrial
 *                 1989-2024: 3-14%), g 2%/yr (CBRE / Cushman US net
 *                 absorption ~200-300 msf a year on ~14 bsf) → M ≈ 12.6,
 *                 ε ≈ 5.8
 *   So sheds' TASTE = (6/7)/5.8 ≈ 0.15 with the cube dropped (it was 0.07
 *   with the cube, ε ≈ 15.2, fitted to renewals alone; sheds renewed 61% of
 *   expiring space in test/tenantmarket.mjs against the studies' 75%, and
 *   renew 71% at 0.15). [S~: each input is a published range; the
 *   derivation is the engine's own choice rule, and no vacancy is read off
 *   it.] Shops keep 0.08 and the cube for now: at 0.14 without it (shops
 *   renew 88%, nearer the studies' 65% than today's 92%) shop vacancy rose
 *   past the record (14-18% for decades, 36% at a peak; 2 seeds x 60 years,
 *   REAL_ECONOMY_PLAN step 9a take 4), because shop landlords still price
 *   by patience — a months-on-market norm a less price-sensitive tenant no
 *   longer disciplines. Shops and sheds still price by patience, not by the
 *   month-dark trade (below): see `reviewAsk`.
 *
 *   HOW OFTEN A FIRM RENEWS IN PLACE, with moving costs as above and ordinary
 *   landlords: about 55% of expiring office space, 65% of shops and 75% of
 *   sheds (CBRE and JLL lease-expiry studies; Prologis retention) [S~],
 *   measured in test/tenantmarket.mjs. Renewals answer the taste's scale
 *   against the move (a larger scale, more firms find a reason to go). At
 *   0.10 office renewed 78% of expiring space in the test, over the studies'
 *   55%; at 0.19 it renews 65% — the two facts agree in direction, and the
 *   elasticity is the one that sets the number.
 *
 * [K: shape parameter, calibrated to the facts stated above, not to a vacancy.]
 */
export const TASTE: Record<Comm, number> = { office: 0.19, retail: 0.08, industrial: 0.15 };

/**
 * THE LANDLORD'S PRICING RULE: WHAT A MONTH DARK COSTS, AND THE PACKAGE FIRST.
 *
 * A landlord posts two things for its space: an asking (face) rent and a
 * package — free rent and fit-out, as a share of the face over the term.
 * Faces are sticky and packages move: a landlord cutting what it takes
 * sweetens the package before it cuts the face (its lender and its valuer
 * read the face), and one raising it takes the package back before it raises
 * the face. That is the record: four years after the 2020 shock Manhattan
 * asking was -3.3% while net effective was -17.3%, and US gateway free rent
 * went 9.7 to 12.5 months in a year (market.ts CONC_DEPTH).
 *
 * HOW MUCH AN OFFICE LANDLORD TAKES is a trade between rent and months dark
 * (2026-11-09, REAL_ECONOMY_PLAN "Office rents and vacancy"). Shops and sheds
 * still price by patience (below, `reviewAskByPatience`): the trade, tried on
 * them too, sent shop rents rising with vacancy and doubled shed vacancy
 * (measured, 3 seeds x 60 years), and the months-of-supply fact it is
 * calibrated to (TASTE) is read for office only. A suite earns its effective
 * rent p for a lease term N, then sits dark for the months M(p) it takes to
 * let again, so over the cycle it earns p·N/(N + M(p)). A lower post lets
 * faster: M(p) ∝ p^ε, where ε is how a building's share of the town's
 * lettings answers its post (`askElasticity`). The landlord's best post is
 * where a cut gains as much in months dark as it gives up in rent:
 * d ln[p·N/(N+M)]/d ln p = 1 - ε·M/(N+M) = 0, at Mbest = N/(ε - 1)
 * (`bestMonthsToLet`). Its evidence for M is the market's own clock — the
 * space on offer over the lettings a month (proforma.ts leaseUpMonthsOf, the
 * clock a developer's lease-up reads): a suite at the market's going rent
 * wins its fair share. So when space takes longer to let than Mbest, every
 * month dark costs more than the rent a cut gives up, and the landlord moves
 * its post down by the step that would bring its own months to Mbest,
 * ln(Mbest/M)/ε; when space lets faster, up. No vacancy or months on market is
 * normal: M is what the town's tenants did this year, and Mbest moves with the
 * lease a tenant signs and with how many places the tenant has to go. Each
 * landlord takes the others' posts as given, so in a glut all of them cut
 * and keep cutting until the tenants the lower rents bring (firms entering,
 * expanding, the participation constraint easing) take the months back
 * down: the rate of change answers the months of supply, which is the
 * Wheaton-Torto shape (Wheaton & Torto 1988; Grenadier 1995: a landlord's
 * rent trades against its expected vacancy).
 *
 *   COMPS_M      months for an opinion of rent to refresh — the share of a
 *                year's move a month's review makes, and the months for an
 *                ask to close on the comps its broker shows it: about once a
 *                year [K].
 *   PKG_MAX      the deepest package: 15-20 months free on a ten-year office
 *                lease and $100-150/sf of fit-out in a glut, 30-40% of face
 *                (market.ts CONC_DEPTH) [S]. A cut past it comes off the face.
 *   PKG_TAKE     how much of the package one quick letting takes back [K].
 *   RAISE        the step a face rises by when space lets at once with no
 *                package left to take back, scaled down to nothing at the
 *                market's months to let [K].
 *   STRESS       an owner whose mortgage is behind (or whose firm is under
 *                water) cuts half as fast again, and takes less [K].
 */
const COMPS_M = 12;
const PKG_MAX = 0.35;
const PKG_TAKE = 0.03;
const RAISE = 0.06;
const STRESS_MOVE = 1.5, STRESS_RES = 0.96;

/**
 * SHOPS AND SHEDS: PRICING BY PATIENCE (the rule office used before the
 * month-dark trade). Space sitting past the landlord's patience sweetens the
 * package, then cuts the face; space letting fast takes it back.
 *   PKG_STEP     a point a month for each patience past, up to three — so
 *                space a year dark reaches the deepest package within the
 *                year, the pace gateway free rent moved in 2020-21 [K].
 *   CUT_DEEP     the steepest a face falls in a month, once the package is at
 *                its deepest and the space has sat three patiences past:
 *                -18.6% a year, the Houston 1983-87 office rate [S]; a third
 *                of it for each patience past, before.
 *   LET_MEMORY   lettings over which a landlord learns how long a vacancy
 *                takes: about twenty — patience is slow to change [K].
 *   MONTHS_ON_MARKET  the patience before its own lettings teach it: the
 *                months available space spends on the market in an ordinary
 *                US market, ten months for shops and six for sheds (CoStar and
 *                CBRE months-on-market series, 2010s) [S~]; office's entry (a
 *                year) opens a book and is otherwise unread.
 */
const PKG_STEP = 0.01;
const CUT_DEEP = 0.0155;
const LET_MEMORY = 20;
const MONTHS_ON_MARKET: Record<Comm, number> = { office: 12, retail: 10, industrial: 6 };
export function searchMonths(k: Comm): number {
  return MONTHS_ON_MARKET[k];
}

/**
 * THE TERM THE NEXT TENANT SIGNS, months: the middle of each covenant's band
 * (leasing.ts termBandM: 84-144, 60-108, 36-60) weighted by the share of a
 * class's let space each covenant holds (tenantBooks.ts STREET_GRADE_SF:
 * 0.30, 0.45, 0.25): 0.30·114 + 0.45·84 + 0.25·48 = 84 [D].
 */
const NEXT_TERM_M = 84;
/**
 * HOW A BROKER'S TOUR BOOK ANSWERS A POST: a building is drawn onto the
 * shortlist with weight (market rent / post)^KEEN_POW (streetRolls.ts shop).
 * For shops the cube of the old stale-space weight, unsourced [K]; for office
 * and sheds nothing — the firm weighs price once, in its own choice (TASTE,
 * where their figures are calibrated with this at zero).
 */
export const KEEN_POW: Record<Comm, number> = { office: 0, retail: 3, industrial: 0 };
/**
 * HOW A BUILDING'S LETTINGS ANSWER ITS POST, as an elasticity: the tour book
 * (KEEN_POW) and, once toured, the firm's logit choice among the shortlist
 * and its own suite — its taste for each is Gumbel with scale TASTE x the
 * market rent, so a building chosen with odds P answers its post with
 * elasticity (post / scale)·(1 - P), at P = 1 / (SHORTLIST + 1) [D: the
 * engine's own choice rule, nothing fitted here].
 */
export function askElasticity(k: Comm, post: number, mkt: number): number {
  return KEEN_POW[k] + (post / Math.max(1e-9, TASTE[k] * mkt)) * (SHORTLIST / (SHORTLIST + 1));
}
/** The months to let at which a cut gains in months dark what it gives up in rent: N / (ε - 1). */
export function bestMonthsToLet(eps: number, termM = NEXT_TERM_M): number {
  return termM / Math.max(1e-6, eps - 1);
}
/** The log step that would bring a post's months to let to the best: ln(Mbest / M) / ε. */
export function darkCostStep(k: Comm, post: number, mkt: number, monthsToLet: number): number {
  const eps = askElasticity(k, post, mkt);
  return Math.log(bestMonthsToLet(eps) / Math.max(1e-6, monthsToLet)) / eps;
}

// ---------------------------------------------------------------- the landlord's book

/** A landlord's book on one kind of space in one building. */
export interface LandlordAsk {
  /** asking (face) rent, $/sf/yr */
  a: number;
  /** the package it posts: free rent and fit-out as a share of the face over the term */
  c: number;
  /** months it expects a vacancy to take to let, learned from its lettings (shops and sheds; office reads the market's clock) */
  t: number;
  /** month the ask was last reviewed */
  m: number;
}

/** The town's package now, from the comps: what separates face from effective. */
export function compsPackage(e: Econ, k: Comm): number {
  const face = e.rentIdx?.[k] ?? 0, eff = e.effRentIdx?.[k] ?? face;
  return face > 0 ? Math.max(0, Math.min(PKG_MAX, 1 - eff / face)) : 0;
}

/** What the comps say this building's space rents for, face: the read-out market rent times the face-over-effective of the read-out. */
export function compsFace(e: Econ, mkt: number, k: Comm): number {
  const face = e.rentIdx?.[k] ?? 0, eff = e.effRentIdx?.[k] ?? face;
  return mkt * (eff > 0 ? face / eff : 1);
}

/** A landlord's book, opened at the comps when it has none (or a fresh opening). */
export function askOf(book: Partial<Record<Comm, LandlordAsk>>, k: Comm, e: Econ, mkt: number, _vacNow: number, m: number): LandlordAsk {
  const L = (book[k] ??= { a: NaN, c: compsPackage(e, k), t: searchMonths(k), m });
  if (!(L.a > 0) || !Number.isFinite(L.a)) { L.a = +Math.max(0.01, compsFace(e, mkt, k)).toFixed(2); L.c = compsPackage(e, k); }
  if (!Number.isFinite(L.c)) L.c = compsPackage(e, k);
  return L;
}

/**
 * What the landlord posts, effective: the face less the package. A sitting
 * tenant is offered the same face a new one would be — its landlord's ask.
 *
 * It was offered the face no higher than the comps, "renewal at market". But
 * the comps are the leases that signed on space that was empty, and in a tight
 * market there is little of that: the market for a full building is what its
 * landlord can get, and the tenant's say in it is its options — the runner-up
 * on its broker's shortlist and the cost of moving (`bargain`). Capped at the
 * comps, a full building's ask, which passes its costs through and rises when
 * a tenant has nowhere else to go, never reached a renewal, and the comps
 * themselves were the only way a renewal could move (measured: office rents
 * -24% and sheds -29% against the old rule at LOWER vacancy, 6.9% and 7.0%).
 * A landlord that asks more than its tenant's options are worth loses the
 * tenant at the roll, which is the discipline the cap was standing in for.
 */
export function postedEff(L: LandlordAsk, _e: Econ, _k: Comm, _mkt: number, _sitting: boolean): number {
  return L.a * (1 - L.c);
}

/**
 * ONE MONTH OF A LANDLORD'S BOOK on one kind of space: its costs passed
 * through (the town's CPI over the year — the others' posts it prices
 * against move with it), the month-dark trade (above) and, for space it has
 * to let, its own evidence against the comps.
 *
 * `monthsToLet` is the market's clock (proforma.ts leaseUpMonthsOf for a
 * standing building: space on offer over lettings a month).
 */
export function reviewAsk(L: LandlordAsk, e: Econ, k: Comm, mkt: number, opts: { m: number; monthsToLet: number; darkM?: number; stressed: boolean; infl12: number; holdFace?: boolean }): void {
  if (k !== "office") return reviewAskByPatience(L, e, k, mkt, opts);
  if (L.m >= opts.m) return;
  const months = Math.max(1, Math.min(12, opts.m - L.m));
  L.m = opts.m;
  const comps = compsFace(e, mkt, k), pull = Math.min(1, months / COMPS_M);
  if (!(L.a > 0) || !Number.isFinite(L.a)) L.a = comps > 0 ? comps : 1;
  const toComps = comps > 0 ? (Math.log(comps) - Math.log(L.a)) * pull : 0;
  let d = (opts.infl12 / 12) * months;
  // THE MONTH-DARK TRADE: the share of the year's step a month's review makes.
  let step = mkt > 0 ? darkCostStep(k, L.a * (1 - L.c), mkt, opts.monthsToLet) * pull : 0;
  if (step < 0 && opts.stressed) step *= STRESS_MOVE;
  if (opts.darkM !== undefined) {
    // SPACE TO LET. Its own evidence: space that has sat longer than the
    // market's months to let is dearer than the market at fair share, and
    // follows the comps down; space letting as fast follows them up when they
    // have passed it. It does not follow them down otherwise: the comps are
    // the deals that signed, the cheap end of what was on offer, and chasing
    // them with no evidence of its own ratchets the town toward its keenest
    // landlord (measured, office -30% at 6% vacancy).
    d += opts.darkM > opts.monthsToLet ? Math.min(0, toComps) : Math.max(0, toComps);
    // The trade moves the package first; past the deepest package (or with
    // none left to take back) the face.
    const keep = (1 - L.c) * Math.exp(step);
    let c = 1 - keep;
    if (c > PKG_MAX) { if (!opts.holdFace) d += Math.log(keep / (1 - PKG_MAX)); c = PKG_MAX; }
    else if (c < 0) { if (!opts.holdFace) d += Math.log(keep); c = 0; }
    L.c = c;
  } else {
    // NOTHING TO LET. The package — given to win a tenant for empty space —
    // is not offered, and fades over the year a broker's opinion takes to
    // refresh. The face is what its tenants will renew at, and the same trade
    // prices it: a tenant that leaves leaves a suite to let on the market's
    // clock. It does not chase the comps: they are the buildings that let,
    // and a full building chasing them up ratchets every good corner's raise
    // onto the whole town (measured: shop rents rising 3.5% a year over 18%
    // vacancy).
    L.c *= 1 - pull;
    if (!opts.holdFace) d += step;
  }
  L.c = Math.max(0, Math.min(PKG_MAX, L.c));
  L.a = +(L.a * Math.exp(Math.max(-0.2, Math.min(0.2, d)))).toFixed(2);
}

/**
 * The landlord learns from a letting: let faster than the market's months to
 * let say space takes at fair share, it gave too much (the package back
 * first, then the face up), in proportion to the share of what it had to let
 * that went (`share`: 1 when the letting fills it, or when a sitting tenant
 * with nowhere else to go renews). Its yardstick was its own learned patience
 * floored at an ordinary market's months on market (MONTHS_ON_MARKET, the last
 * norm, deleted 2026-11-09); it is now the market's clock.
 */
export function noteLetting(L: LandlordAsk, k: Comm, tom: number, share: number, monthsToLet: number, holdFace = false) {
  // shops and sheds: the yardstick is the longer of the landlord's patience
  // and its class's ordinary months on market, and the patience is learned
  const yard = k === "office" ? Math.max(1e-6, monthsToLet) : Math.max(L.t, searchMonths(k));
  if (tom < yard && share > 0) {
    const f = (1 - tom / yard) * Math.min(1, share);
    if (L.c > 0) L.c = Math.max(0, L.c - PKG_TAKE * f);
    else if (!holdFace) L.a = +(L.a * Math.exp(RAISE * f)).toFixed(2);
  }
  if (k !== "office") L.t += (Math.max(0.5, tom) - L.t) / LET_MEMORY;
}

/**
 * WHAT THE LANDLORD WILL GO TO for a tenant with somewhere else to go: its
 * posted effective rent less what it expects to lose by waiting for the next
 * tenant instead — the months to let (the market's clock for office, its own
 * learned patience for shops and sheds; plus the make-ready when the tenant
 * would leave a suite it is sitting in), spread over the term — and less
 * again when it needs the cash.
 */
export function reservation(L: LandlordAsk, k: Comm, post: number, termM: number, sitting: boolean, stressed: boolean, monthsToLet: number): number {
  const wait = (k === "office" ? monthsToLet : L.t) + (sitting ? MAKE_READY_M[k] : 0);
  return post * Math.max(0.4, 1 - wait / Math.max(12, termM)) * (stressed ? STRESS_RES : 1);
}

/**
 * ONE MONTH OF A SHOP OR SHED LANDLORD'S BOOK: costs passed through, face and
 * package pulled toward the comps, and — space sitting past its patience —
 * the package sweetened, then the face cut (both faster when its loan is in
 * trouble). Space to let within its patience follows the comps up, not down
 * (the comps are the cheap end of what was on offer); a full building passes
 * its costs through and does not chase the comps.
 */
function reviewAskByPatience(L: LandlordAsk, e: Econ, k: Comm, mkt: number, opts: { m: number; darkM?: number; stressed: boolean; infl12: number; holdFace?: boolean }): void {
  if (L.m >= opts.m) return;
  const months = Math.max(1, Math.min(12, opts.m - L.m));
  L.m = opts.m;
  const comps = compsFace(e, mkt, k), pull = Math.min(1, months / COMPS_M);
  if (!(L.a > 0) || !Number.isFinite(L.a)) L.a = comps > 0 ? comps : 1;
  if (!(L.t > 0)) L.t = searchMonths(k);
  const toComps = comps > 0 ? (Math.log(comps) - Math.log(L.a)) * pull : 0;
  let d = 0;
  if (opts.darkM !== undefined && opts.darkM <= L.t) {
    d += (opts.infl12 / 12) * months + Math.max(0, toComps);
  } else if (opts.darkM !== undefined) {
    d += Math.min(0, toComps);
    const push = Math.min(3, (opts.darkM - L.t) / Math.max(1, L.t)) * (opts.stressed ? STRESS_MOVE : 1) * months;
    if (L.c < PKG_MAX) L.c = Math.min(PKG_MAX, L.c + PKG_STEP * push);
    else if (!opts.holdFace) d -= CUT_DEEP * push / 3;
  } else {
    d += (opts.infl12 / 12) * months;
    L.c *= 1 - pull;
  }
  L.c = Math.max(0, Math.min(PKG_MAX, L.c));
  L.a = +(L.a * Math.exp(Math.max(-0.2, Math.min(0.2, d)))).toFixed(2);
}
// ---------------------------------------------------------------- where firms are

/** A point in metres (local projection of a parcel's centroid). */
export function posOf(rec: Pick<ParcelRecord, "centroid">): [number, number] | null {
  const c = rec.centroid;
  if (!c) return null;
  const k = 111_320;
  return [c[0] * k * Math.cos((c[1] * Math.PI) / 180), c[1] * k];
}

/**
 * EACH FIRM'S PLACES THAT MATTER, this month: the buildings of the firms it
 * trades with by name (economy.ts links), the homes of its people who live on
 * the island (the household register), and — for a firm with fewer named
 * relationships than usual — the centre of its industry's customers. Each
 * point carries the hours a year a metre of distance to it costs the firm.
 */
export interface LocCtx {
  m: number;
  /** fid -> [x, y, hoursPerMetreYr, kind(0 link,1 worker,2 customers)] flattened */
  pts: Map<number, number[]>;
  /** each housed firm's position */
  at: Map<number, [number, number]>;
  /** each firm's industry */
  ind: Map<number, number>;
}

const CTX = new WeakMap<GameState, LocCtx>();

/**
 * The month's location context, built once a month per state. `memo` false
 * builds it without leaving it behind — for a read that must change nothing
 * (a valuation), since which moment of the month the context is first built
 * at is otherwise part of what the month does.
 */
export function locCtx(s: GameState, recOf: (bbl: string) => ParcelRecord | null | undefined, memo = true): LocCtx {
  const hit = CTX.get(s);
  if (hit && hit.m === s.month) return hit;
  const at = new Map<number, [number, number]>();
  const heads = new Map<number, number>();
  const place = (t: Tenant, bbl: string) => {
    if (t.fid === undefined || t.use === "multifamily") return;
    const rec = recOf(bbl);
    const p = rec ? posOf(rec) : null;
    if (p) at.set(t.fid, p);
    heads.set(t.fid, tenantHeads(t));
  };
  for (const [bbl, roll] of Object.entries(s.econ.streetRolls ?? {})) for (const t of roll.t) place(t, bbl);
  for (const [bbl, h] of Object.entries(s.holdings)) for (const t of h.tenants ?? []) place(t, bbl);
  const pts = new Map<number, number[]>();
  const add = (fid: number, p: [number, number], hPerM: number, kind: number) => {
    let a = pts.get(fid);
    if (!a) { a = []; pts.set(fid, a); }
    a.push(p[0], p[1], hPerM, kind);
  };
  // the firms they trade with by name
  const E = s.economy;
  const ind = new Map<number, number>();
  if (E?.f && E.L?.slot) {
    const n = E.L.slot.n, id = E.f.id as unknown as ArrayLike<number>, ii = E.f.ind as unknown as ArrayLike<number>;
    for (let q = 0; q < n; q++) if (id[q] >= 0) ind.set(id[q], ii[q]);
  }
  const linkH = LINK_TRIPS_YR * 2 / SPEED_M_PER_H;
  const nLinks = new Map<number, number>();
  // (a save that went through JSON holds its link columns as plain {"0": ...}
  // objects until economy.ts reviveLinks mends them, which may be later in the
  // month than this read: read either form, or a loaded game forgets its links
  // for a month and parts from the running one — economy.mjs's JSON replay)
  const lk = E?.lk as unknown as { s?: ArrayLike<number> | Record<string, number>; c?: ArrayLike<number> | Record<string, number> } | undefined;
  const col = (v: ArrayLike<number> | Record<string, number>): ArrayLike<number> => ArrayBuffer.isView(v) || Array.isArray(v) ? v as ArrayLike<number> : Object.values(v);
  if (lk?.s && lk.c) {
    const S = col(lk.s), C = col(lk.c);
    for (let l = 0; l < S.length; l++) {
      const a = S[l], b = C[l];
      const pa = at.get(a), pb = at.get(b);
      if (pa && pb) {
        add(a, pb, linkH, 0); add(b, pa, linkH, 0);
        nLinks.set(a, (nLinks.get(a) ?? 0) + 1); nLinks.set(b, (nLinks.get(b) ?? 0) + 1);
      }
    }
  }
  // the island's people and where they work
  const R = s.households as unknown as { n?: number; blocks?: string[]; a?: { blk: Int32Array; emp1: Int32Array; emp2: Int32Array; wt: Float32Array } } | undefined;
  if (R?.a && R.blocks && R.n) {
    const commuteH = COMMUTE_DAYS * 2 / SPEED_M_PER_H * COMMUTE_VOT * COMMUTE_FIRM_SHARE;
    const home = new Map<number, [number, number] | null>();
    const acc = new Map<number, Map<number, number>>();   // fid -> block -> heads
    for (let i = 0; i < R.n; i++) {
      const b = R.a.blk[i];
      if (b < 0) continue;
      for (const emp of [R.a.emp1[i], R.a.emp2[i]]) {
        if (emp < 0 || !at.has(emp)) continue;
        let m = acc.get(emp);
        if (!m) { m = new Map(); acc.set(emp, m); }
        m.set(b, (m.get(b) ?? 0) + R.a.wt[i]);
      }
    }
    for (const [fid, m] of acc) for (const [b, w] of m) {
      let p = home.get(b);
      if (p === undefined) { const rec = recOf(R.blocks[b]); p = rec ? posOf(rec) : null; home.set(b, p); }
      if (p) add(fid, p, commuteH * w, 1);
    }
  }
  // the centre of each industry's customers, for firms with fewer named links than usual
  if (ind.size) {
    const cx = new Float64Array(N_IND), cy = new Float64Array(N_IND), cw = new Float64Array(N_IND);
    const sx = new Float64Array(N_IND), sy = new Float64Array(N_IND), sw = new Float64Array(N_IND);
    for (const [fid, p] of at) {
      const j = ind.get(fid);
      if (j === undefined) continue;
      const h = heads.get(fid) ?? 1;
      sx[j] += p[0] * h; sy[j] += p[1] * h; sw[j] += h;
    }
    for (let i = 0; i < N_IND; i++) {
      for (let j = 0; j < N_IND; j++) {
        if (!(sw[j] > 0)) continue;
        const a = IO_A[INDUSTRY_IDS[j]][i] ?? 0;
        if (!(a > 0)) continue;
        cx[i] += a * sx[j]; cy[i] += a * sy[j]; cw[i] += a * sw[j];
      }
    }
    for (const [fid] of at) {
      const i = ind.get(fid);
      if (i === undefined || !(cw[i] > 0)) continue;
      const short = LINKS_EXPECTED - (nLinks.get(fid) ?? 0);
      if (short > 0) add(fid, [cx[i] / cw[i], cy[i] / cw[i]], linkH * short, 2);
    }
  }
  const ctx: LocCtx = { m: s.month, pts, at, ind };
  if (memo) CTX.set(s, ctx);
  return ctx;
}

/** A firm's cost of an hour of its people's time: its payroll over its heads (its own books), else its trade's share of sales at the town's reference. */
export function hourCost(t: Tenant): number {
  const heads = Math.max(0.5, tenantHeads(t));
  const rev = t.fin?.revRef ?? t.fin?.rev0 ?? 0;
  const w = FIRM_PROFILE[t.sector]?.wage ?? 0.35;
  return rev > 0 ? rev * w / heads / HOURS_YR : 0;
}

/** Hours-weighted distance cost a year ($) of a firm at a point; and the mean metres to its named partners / customers' centre (for the record). */
export function placeCost(pts: number[] | undefined, p: [number, number] | null, hour: number): { cost: number; dLink: number; dWork: number } {
  if (!pts || !p || !(hour > 0)) return { cost: 0, dLink: NaN, dWork: NaN };
  let cost = 0, dl = 0, wl = 0, dw = 0, ww = 0;
  for (let i = 0; i < pts.length; i += 4) {
    const d = Math.hypot(pts[i] - p[0], pts[i + 1] - p[1]);
    cost += d * pts[i + 2] * hour;
    if (pts[i + 3] === 1) { dw += d * pts[i + 2]; ww += pts[i + 2]; } else { dl += d * pts[i + 2]; wl += pts[i + 2]; }
  }
  return { cost, dLink: wl > 0 ? dl / wl : NaN, dWork: ww > 0 ? dw / ww : NaN };
}

// ---------------------------------------------------------------- the deal

/** One option on a firm's shortlist, valued per foot a year. */
export interface Option {
  bbl: string;
  /** feet it would take here */
  take: number;
  /** the building's market rent (effective, read-out), and a shop's walk-ins on it (`footFactor`) */
  mkt: number; ff: number;
  /** the landlord's ask (face), what it posts after its package (effective), and what it would go to */
  ask: number; post: number; res: number;
  /** what the space is worth to this firm, $/sf/yr, before rent */
  worth: number;
  /** moving cost, $/sf/yr over the term */
  move: number;
  /** worth less the posted rent less moving, plus the firm's taste for it: what the firm ranks on */
  joint: number;
  /** metres to its partners / its people from here */
  dLink: number; dWork: number;
  /** the current building (a renewal) */
  stay?: boolean;
}

/** A Gumbel draw (the logit taste). */
export function gumbel(u: number): number {
  return -Math.log(-Math.log(Math.min(1 - 1e-12, Math.max(1e-12, u))));
}

/**
 * WHAT A BUILDING IS WORTH TO A FIRM, $/sf/yr: its market rent (the read-out
 * of what deals sign at, for its address, plate, quality and condition) times
 * how well it fits the quality this firm shops for (bands.ts: a firm
 * stretching up offers under, one settling down pays over), plus — for a shop
 * — how the people within a walk of it now compare with the town's (the trips
 * that make a shop's sales: streetRolls CATCHMENT), less what being there
 * costs it in its people's and partners' time.
 */
export function worthOf(t: Tenant, k: Comm, mkt: number, sc: number, take: number, distCostYr: number, footRel?: number, capacity = 1): number {
  const fit = tenantQualityTerms(t.quality ?? sc, sc).rent;
  // `capacity`: what the firm's trade can pay against what the market asks (tenantBooks.ts rentCapacity)
  return mkt * capacity * fit * footFactor(k, footRel) - distCostYr / Math.max(1, take);
}
/**
 * A SHOP'S WALK-INS against what its address's rent already charges for, as a
 * multiple of what the space is worth: half the trade is the walking
 * catchment (streetRolls.ts CATCHMENT), so sales — and what a shop can pay —
 * move with the square root of its walk-ins [K: the same elasticity]. Read
 * the same way when a comp is normalised (`recordLease`), so a good corner's
 * rent is the corner's, not the town's.
 */
export function footFactor(k: Comm, footRel?: number): number {
  return k === "retail" && footRel !== undefined && footRel > 0 ? Math.pow(Math.max(0.25, Math.min(4, footRel)), 0.5) : 1;
}

/** Moving cost, $/sf/yr over the term. */
export function moveCostPsfYr(e: Econ, k: Comm, termM: number): number {
  return MOVE_PSF[k] * (e.costIdx ?? 1) / Math.max(1, termM / 12);
}

/**
 * THE BARGAIN. The firm takes the building it ranks first, at its posted
 * rent — unless the runner-up's landlord is hungrier: the firm can walk to
 * the runner-up and have it go to its own reservation, so the chosen landlord
 * must leave the firm at least as well off as that, and the two split what is
 * left (a Nash bargain with an outside option). So a firm with a close second
 * at a landlord that needs the tenant more gets the rent cut; a firm with
 * nowhere else to go pays what is posted. Never under the chosen landlord's
 * own reservation, never over its post.
 */
export function bargain(best: Option, second: Option | undefined): number {
  if (!second) return best.post;
  // THE FIRM'S CEILING HERE: the rent r at which it is as well off as at the
  // runner-up at that landlord's reservation. Its surplus here at r is
  // joint_best + post_best - r; at the runner-up gone to its reservation,
  // joint_second + post_second - res_second. Equal at
  // r = post_best + (joint_best - joint_second) - (post_second - res_second).
  // The last term was ADDED (REAL_ECONOMY_PLAN 2.5, 2026-11-05): a hungrier
  // runner-up RAISED the firm's ceiling, so the ceiling sat over the post and
  // every street deal signed at the post — while offerForPlayer, with the
  // sign right, priced the player's tenants against a discount no street
  // landlord ever gave (a sitting tenant's renewal letter at a median 0.61x
  // the player's market in a 20-year playthrough; 0 renewals).
  const rMax = best.post + (best.joint - second.joint) - (second.post - second.res);
  return Math.max(best.res, Math.min(best.post, (best.res + rMax) / 2));
}

/**
 * THE MOST A FIRM WILL OFFER FOR AN OPTION when other firms want the same
 * space: the rent at which it is no better off here than at its runner-up at
 * the runner-up's post — or, with no runner-up worth having, than with no
 * space this month (it keeps looking: worth 0 to it) — so its ceiling is the
 * post plus how much more it likes this suite than its next-best thing. Never
 * under what it would bargain to anyway (`bargain`). The counterpart of
 * `bargain`'s outside option, from the tenant's side; nothing new is assumed.
 */
export function bidCeiling(best: Option, alt: Option | undefined, offer: number): number {
  return Math.max(offer, best.post + best.joint - Math.max(0, alt?.joint ?? 0));
}

/**
 * COMPETING PROPOSALS. Several firms that toured the same space each put in a
 * proposal; the landlord takes the best and runs a "best and final" round, so
 * the firm it signs pays what it bargained (`offer`) or, when it beat a firm
 * the landlord had to turn away, enough to beat that firm's best — never more
 * than its own ceiling. That is an English auction's price: the winner pays
 * the loser's ceiling (Vickrey 1961; in leasing, the "multiple offers" market
 * brokers report in tight markets, where face rents rise and concessions
 * burn off — CBRE / JLL / Cushman tenant-rep commentary 2021-22 on industrial
 * and 2014-15 on Manhattan retail).
 */
export function contestPrice(offer: number, ceiling: number, turnedDown: number): number {
  return Math.min(ceiling, Math.max(offer, turnedDown));
}

/**
 * THE LANDLORD LEARNS FROM THE OFFERS IT TURNED DOWN. A landlord that had to
 * turn firms away has seen what its space fetches: the deal it just signed,
 * which beat them. When that is above what it posts, its next suite is posted
 * there — the package taken back first (a landlord with several proposals
 * stops offering free rent and fit-out), then the face raised to it. This is
 * the price the contest set, not a step: no gain is chosen. In the opening's
 * years the face holds, as in `noteLetting`.
 */
export function noteContest(L: LandlordAsk, cleared: number, holdFace = false): void {
  if (!(cleared > 0) || !(L.a > 0) || cleared <= L.a * (1 - L.c)) return;
  const c = 1 - cleared / L.a;
  if (c >= 0) { L.c = Math.min(L.c, c); return; }
  L.c = 0;
  if (!holdFace) L.a = +cleared.toFixed(2);
}

/** Free months that take a face rent to an effective one over a term. */
export function freeMonthsFor(face: number, eff: number, termM: number): number {
  if (!(face > 0) || eff >= face) return 0;
  return Math.max(0, Math.min(termM - 1, Math.round(termM * (1 - eff / face))));
}

// ---------------------------------------------------------------- the read-out

/**
 * A LEASE SIGNED, AS A COMP: its face and effective rent in index dollars (its
 * rent over its building's market rent, times the effective index the month it
 * signed), its building's quality band and the band's swing then, and its feet.
 */
export interface Comp { m: number; f: number; e: number; b: number; nb: number; sf: number; r?: 1 }

export const COMP_WINDOW_M = 6;

/** Record a commercial lease (the street's, a renewal, or the player's). */
export function recordLease(e: Econ, k: BuiltClass, m: number, face: number, eff: number, mkt: number, sf: number, band: number, bandRent: number, renewal = false) {
  if (k === "multifamily" || !(mkt > 0) || !(sf > 0) || !(face > 0) || !(eff > 0)) return;
  const idx = e.effRentIdx?.[k] ?? e.rentIdx?.[k] ?? 0;
  if (!(idx > 0)) return;
  const list = ((e.comps ??= {})[k] ??= []);
  const fx = face / mkt * idx, ex = eff / mkt * idx;
  list.push({ m, f: +fx.toFixed(4), e: +ex.toFixed(4), b: band, nb: +(ex * Math.max(0.05, bandRent)).toFixed(4), sf: Math.round(sf), ...(renewal ? { r: 1 as const } : {}) });
  while (list.length && list[0].m < m - COMP_WINDOW_M) list.shift();
  while (list.length > 600) list.shift();
}

/**
 * THE TOWN'S RENT, READ OFF ITS LEASES: the asking (face) and effective rent
 * indices are the square-foot-weighted means of the comps of the last six
 * months, each normalised to an ordinary building (its address, plate,
 * quality and condition taken out). The concession level is what separates
 * them. Null when nothing has signed in the window — the index then stands.
 */
export function readOut(e: Econ, k: Comm, m: number): { face: number; eff: number; conc: number; sf: number; n: number } | null {
  const list = e.comps?.[k];
  if (!list) return null;
  while (list.length && list[0].m < m - COMP_WINDOW_M) list.shift();
  // NEW LEASES ARE THE MARKET; renewals follow it. A renewal is priced off the
  // comps (a sitting tenant is offered market), so counting it in the market
  // it was priced from weighs the index toward itself — measured, it halved
  // how fast rents rose in a tight market. Renewals count only where too few
  // new leases signed to say anything (MIN_NEW).
  let nNew = 0;
  for (const c of list) if (!c.r) nNew++;
  const useNew = nNew >= MIN_NEW;
  let sf = 0, f = 0, ef = 0, n = 0;
  for (const c of list) { if (useNew && c.r) continue; sf += c.sf; f += c.f * c.sf; ef += c.e * c.sf; n++; }
  if (!(sf > 0)) return null;
  const face = f / sf, eff = ef / sf;
  return { face, eff, conc: Math.max(0, Math.min(1, (1 - eff / Math.max(1e-9, face)) / CONC_DEPTH)), sf, n };
}
/** New leases in the window below which renewals count in the read-out too [K]. */
const MIN_NEW = 3;

/**
 * EACH QUALITY BAND'S RENT AGAINST THE CLASS, read off the same comps: a band
 * with deals reads what they signed at with the band's own swing taken back
 * out (`nb`), over the effective index. Bands without a deal in the window
 * keep what they had.
 */
export function bandReadOut(e: Econ, k: Comm, nBands: number): (number | undefined)[] {
  const list = e.comps?.[k] ?? [];
  const idx = e.effRentIdx?.[k] ?? 0;
  const sf = new Array(nBands).fill(0), v = new Array(nBands).fill(0);
  for (const c of list) { if (c.b >= 0 && c.b < nBands) { sf[c.b] += c.sf; v[c.b] += c.nb * c.sf; } }
  return sf.map((x, b) => (x > 0 && idx > 0 ? v[b] / x / idx : undefined));
}

// ---------------------------------------------------------------- a firm's covenant

/**
 * A FIRM'S COVENANT IS MOSTLY ITS SIZE. An investment-grade name sells to
 * thousands of customers in several lines; a small unrated shop to a handful
 * (tenantBooks.ts Z_GRADE: sales volatility falls steeply with size — Comin &
 * Philippon 2005; Davis et al. 2006). On the street the largest firms hold
 * about 30% of a class's let space as investment-grade names, the next 45% are
 * mid-market and the smallest 25% weak (tenantBooks.ts STREET_GRADE_SF). So a
 * firm's grade is where its floor sits in the class's requirement
 * distribution (plates.ts SIZE_DIST, log-normal): above the size whose
 * larger firms hold 30% of the feet it is a grade-2 name, above the size
 * whose larger firms hold 75% a grade-1 [D: ln x = mu + sigma (sigma + z),
 * z = 0.524 and -0.674]. This replaced a draw on the building's score.
 */
export function creditOfSize(k: Comm, sf: number): Credit {
  const d = SIZE_DIST[k];
  const lx = Math.log(Math.max(1, sf));
  if (lx >= d.mu + d.sigma * (d.sigma + 0.524)) return 2;
  if (lx >= d.mu + d.sigma * (d.sigma - 0.674)) return 1;
  return 0;
}

// ---------------------------------------------------------------- why it left

const fmtPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

/** "moved to 40 Water St · rent −18% · 600 m closer to clients" */
export function movedLine(to: string, rentCh: number, dLinkOld: number, dLinkNew: number, dWorkOld: number, dWorkNew: number): string {
  const parts = [`moved to ${to}`];
  if (Number.isFinite(rentCh)) parts.push(`rent ${fmtPct(rentCh)}`);
  const dl = dLinkOld - dLinkNew, dw = dWorkOld - dWorkNew;
  if (Number.isFinite(dl) && Math.abs(dl) >= 100) parts.push(`${Math.round(Math.abs(dl) / 50) * 50} m ${dl > 0 ? "closer to" : "further from"} clients`);
  else if (Number.isFinite(dw) && Math.abs(dw) >= 100) parts.push(`${Math.round(Math.abs(dw) / 50) * 50} m ${dw > 0 ? "closer to" : "further from"} its staff`);
  return parts.join(" · ");
}

export { fmtPct };
