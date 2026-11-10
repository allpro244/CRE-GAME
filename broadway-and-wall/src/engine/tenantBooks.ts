/**
 * EVERY TENANT KEEPS BOOKS (2026-10-15). Hidden from the player — a landlord
 * never sees a tenant's accounts — but they are what decides whether the rent
 * gets paid.
 *
 * A tenant's business is its trade's business (market.ts FIRM_PROFILE and the
 * trade's aggregate books) with its own draw on top, fixed at signing and
 * deterministic in who the tenant is:
 *
 *   revenue      sized off the rent it agreed to: rent is a share of revenue
 *                near its trade's norm (some tenants stretch for the space)
 *   - costs      wages and everything else, moving with revenue
 *   - rent       what the lease actually charges — FIXED while revenue moves,
 *                which is the operating leverage that makes a downturn bite
 *   - interest   its own debt: a floating share at the short rate plus its
 *                credit spread, the rest fixed and rolling at the long rate
 *   = cash       which runs down when the business cannot carry its costs
 *
 * Revenue follows the tenant's headcount (`staff`) and its trade's sales per
 * worker, so a recession squeezes twice: fewer people, each selling less.
 * The credit grade at signing sets how thick the margin, how heavy the debt
 * and how deep the cash: an investment-grade tenant can ride out years that
 * end a start-up in months. Default, rent-relief letters and credit
 * migration read these books (leasing.ts).
 */
import type { Credit, Econ, Tenant } from "./types";
import { FIRM_PROFILE, LENDER_COVER, SF_PER_JOB } from "./market";
import { hashNormal } from "./value";
import { INDUSTRIES, INDUSTRY_IDS, TRADE_TO_INDUSTRY, type IndustryId } from "./industries";

/**
 * A SHED TENANT KEEPS A SHED BUSINESS'S BOOKS (2026-11-10). The trade
 * profiles (market.ts FIRM_PROFILE) are the office and shop trades': a food
 * or apparel firm there is a restaurant or a clothes shop, paying ~9% of its
 * sales in rent. The street's shed firms are in those trades too — a food
 * plant, a garment works, a wholesaler — and kept the shop's books, so a shed
 * firm sold a shop's sales on its floor (revenue per foot = rent per foot over
 * the rent share), three times the rent's weight on its margin; every point
 * shed rents outran its trade's sales took ~0.1 points of margin, not ~0.03.
 * Measured, seed 11, years 3-8: shed tenants went dark at 15% of shed stock a
 * year (offices 2.7%, shops 4.7%), food plants 15%, garment works 42%; the
 * record for industrial tenants is ~1-3% (Prologis bad debt ~0.3-0.5% of
 * revenue, retention 69-87%; BDS establishment exits in manufacturing and
 * wholesale ~6-8% a year counting moves and lease-end closures).
 *
 * A shed firm's books are its industry's, renting its floor:
 *   rent share  US industrial rent 2023 (~$9.8/sf a year NNN, Cushman &
 *               Wakefield MarketBeat: $9.59 Q2 2023, +10% over the year) [S~]
 *               times the industry's feet a worker over its output a worker
 *               (industries.ts sfPerWorker, BEA output over CES heads) [D].
 *               It reproduces the BEA rent row where the floor is mostly
 *               rented — wholesale 3.2% against BEA 3.8%, trucking 3.5%
 *               against 2.3% — and gives the renter's share where plants
 *               are mostly owned (food plants 1.5% against BEA's 0.5%).
 *   margin      the industry's EBITDA over sales, US listed firms, January
 *               2026 (Damodaran, NYU Stern, margin.html) [S]: distributors
 *               11.4%, food processing 15.3%, apparel 11.5%, trucking 15.6%,
 *               transportation 9.8%. The grade still scales it (`GRADE`).
 * Leverage, floating share and spread stay the trade's (FINANCE_LIKE).
 */
const SHED_RENT_PSF_2023 = 9.8;
const SHED_MARGIN: Partial<Record<IndustryId, number>> = {
  wholesale: 0.114, warehousing: 0.098, transportsup: 0.098, trucking: 0.156,
  food: 0.153, textiles: 0.115, apparel: 0.115,
};
function shedBook(ind: IndustryId): { margin: number; rent: number } {
  const I = INDUSTRIES[ind];
  const rent = SHED_RENT_PSF_2023 * I.sfPerWorker / Math.max(1, I.outPerWorkerK * 1000);
  return { margin: SHED_MARGIN[ind] ?? I.gos, rent: Math.max(0.005, Math.min(0.15, rent)) };
}
const SHED_BOOK: Partial<Record<IndustryId, { margin: number; rent: number }>> = {};
/**
 * The margin and rent share a tenant's books are built on: its trade's
 * (FIRM_PROFILE), or on a shed floor its industry's (`shedBook`) — the one
 * the city's books hold it in, else its trade's shed industries weighted by
 * US employment (TRADE_TO_INDUSTRY).
 */
export function bookProfile(t: { sector: Tenant["sector"]; use?: string; ind?: number }): { margin: number; rent: number } {
  const P = FIRM_PROFILE[t.sector];
  if (t.use !== "industrial") return P;
  const id = t.ind !== undefined ? INDUSTRY_IDS[t.ind] : undefined;
  if (id && INDUSTRIES[id]?.space.startsWith("industrial")) return (SHED_BOOK[id] ??= shedBook(id));
  const opts = TRADE_TO_INDUSTRY.industrial[t.sector];
  if (!opts?.length) return P;
  let w = 0, mg = 0, rt = 0;
  for (const [k, x] of opts) { const b = (SHED_BOOK[k] ??= shedBook(k)); w += x; mg += x * b.margin; rt += x * b.rent; }
  return { margin: mg / w, rent: rt / w };
}

export interface TenantFin {
  /** revenue at signing, $/yr, and the trade's sales per worker then */
  rev0: number; prod0: number;
  /** the price level when the books opened — revenue is in dollars of the day */
  cpi0?: number;
  /** the share of revenue that is neither rent nor margin (wages, goods, services) */
  otherShare: number;
  /** last year's revenue, smoothed — what the cost base was built for */
  revRef?: number;
  cash: number; debt: number; fixed: number; spread: number; float: number; lev: number;
  /** this month's read: EBITDA over interest, months of costs in the bank, EBITDA margin */
  cover: number; liqM: number; margin: number;
  /** the firm's own fortunes: log sales against its trade's, and the month last drawn */
  z?: number; zM?: number;
}

/**
 * A FIRM'S OWN FORTUNES (2026-10-16). Two firms in one trade do not have one
 * year: one wins the big client and the other loses it. Each firm's sales run
 * on its trade's plus a persistent shock of its own — monthly persistence 0.985,
 * so a good or bad run lasts years — sized so a small unrated firm's sales
 * GROW at the dispersion small firms' do: 20-35% a year either side of its
 * trade's (Census Business Dynamics Statistics) [S]. A year's change in z
 * has a spread of Z_SIG/sqrt(1-rho^2) x sqrt(2(1-rho^12)) = 3.33 Z_SIG, so
 * 0.075 gives 25% [D]; the level then sits 0.43 either side of the trade's, a
 * 90/10 ratio of ~3 in sales per head, inside the 2-4 measured within US
 * industries (Syverson 2011, JEL) [S]. Failures come out of this and the
 * trade's year through the books; nothing is drawn at a fixed rate.
 * (Until 2026-10-29 this was 0.033, "19% either side" as a LEVEL, and the
 * draws it scaled were correlated 0.77 month to month (value.ts hashNormal,
 * unmixed), so the fortunes wandered far wider than either number said.
 * Measured on seed 550991 over ten years, firms going dark a year by grade,
 * small / mid-market / investment grade, against ~5% / ~1.5% / ~0.5%
 * (S&P long-run, SBA): correlated draws at 0.033, 7.2% / 3.8% / 2.1%;
 * independent draws at 0.033, 0.6% / 0.1% / 0.1%; at 0.075, 4.7% / 0.8% / 0.2%.)
 */
const Z_RHO = 0.985;
const Z_SIG = 0.075;
/**
 * ...and by covenant, because covenant is mostly size: an investment-grade
 * name sells to thousands of customers in several lines, a small unrated
 * shop to a handful. Sales volatility falls steeply with firm size (Comin &
 * Philippon 2005; Davis et al. 2006).
 */
const Z_GRADE: Record<Credit, number> = { 2: 0.55, 1: 0.65, 0: 1 };

/** Months of costs a tenant keeps in cash before it pays the surplus out. */
const CASH_KEEP_M = 1.5;

const GRADE: Record<Credit, { margin: number; lev: number; cashM: number; spread: number }> = {
  2: { margin: 1.30, lev: 0.6, cashM: 4.0, spread: 0.010 },
  1: { margin: 1.00, lev: 1.0, cashM: 2.0, spread: 0.025 },
  0: { margin: 0.75, lev: 1.4, cashM: 0.8, spread: 0.045 },
};

function tradeProd(e: Econ, t: Tenant): number {
  const b = e.firmBooks?.[t.sector];
  return b ? b.sales / Math.max(1e-6, b.emp) : 1;
}

/** The opening's rent per foot and price level, which sales per head are measured from. */
export function revAnchor(e: Econ): { cpi: number; rent: Partial<Record<string, number>>; eff?: Partial<Record<string, number>>; prod?: Partial<Record<string, number>> } {
  return (e.revAnchor ??= { cpi: e.cpi ?? 1, rent: { office: e.rentIdx?.office, retail: e.rentIdx?.retail, industrial: e.rentIdx?.industrial },
    eff: { office: e.effRentIdx?.office ?? e.rentIdx?.office, retail: e.effRentIdx?.retail ?? e.rentIdx?.retail, industrial: e.effRentIdx?.industrial ?? e.rentIdx?.industrial } });
}

/**
 * WHAT A FIRM'S TRADE CAN PAY FOR SPACE NOW, AGAINST WHAT THE MARKET ASKS
 * (REAL_ECONOMY_PLAN 4.1, 2026-11-05). A firm values space at the market rent
 * for the address (tenantMarket.ts worthOf) — and the market rent is what firms
 * paid, so what a firm would pay rose with the rent index itself and nothing a
 * firm earned ever pushed back: shop rents climbed 90% through a run to 27%
 * vacancy (audit seed 11). What a trade can pay for space is its rent share of
 * what it sells, and what it sells per foot is the opening's (the anchor the
 * books are sized from) carried forward by the price level and the trade's own
 * sales per worker. This is that capacity over today's rent index: exactly 1
 * at the opening, under 1 once rents outrun what the trade earns, over 1 when
 * they lag it. It multiplies what the space is worth to the firm.
 */
export function rentCapacity(e: Econ, t: { sector?: Tenant["sector"] }, k: "office" | "retail" | "industrial"): number {
  const A = revAnchor(e);
  // EFFECTIVE AGAINST EFFECTIVE (2026-11-08): the capacity multiplies the
  // building's market rent, which is effective (value.ts useRentPsfYr), so it
  // is read against the effective index and the effective rent the trade paid
  // at the anchor. Read against the asking index, a firm's worth of a suite
  // carried the town's concession level — a firm valued its space 10-20% less
  // whenever landlords gave more free rent, so every glut's packages cut what
  // every firm would pay for space (a firm's value of space set by its
  // landlords' marketing, not by what it sells). The anchor is read at the
  // new game, before the town's first lease, so it is the opening's rent
  // before any package: against the asking index the opening's growth then
  // set (19.3 against an anchor of 16.3 on office, seed 11), every office firm
  // started at 84% of what its space was worth to it. A save without the
  // effective anchor takes the asking one, read at the same moment.
  const idx = e.effRentIdx?.[k] ?? e.rentIdx?.[k];
  const r0 = (A.eff ??= {})[k] ??= A.rent[k];
  if (!(idx && idx > 0) || !(r0 && r0 > 0) || !t.sector) return 1;
  const prod = tradeProd(e, t as Tenant);
  const p0 = ((A.prod ??= {})[t.sector] ??= prod);
  const cap = r0 * ((e.cpi ?? 1) / Math.max(1e-6, A.cpi)) * (prod / Math.max(1e-9, p0));
  return cap / idx;
}

/**
 * What a firm in this trade would clear if it started up here today: its
 * trade's normal margin, less what today's rent takes of a head's sales
 * beyond the trade's normal rent share. `space` is the footage per head it
 * would take at today's rent (1 at the opening's).
 */
export function entrantMargin(e: Econ, sector: Tenant["sector"], k: "office" | "retail" | "industrial", space: number): number {
  const P = FIRM_PROFILE[sector];
  const A = revAnchor(e);
  const b = e.firmBooks?.[sector];
  const prod = b ? b.sales / Math.max(1e-6, b.emp) : 1;
  const rentNow = (e.rentIdx?.[k] ?? 1) / Math.max(1e-6, A.rent[k] ?? e.rentIdx?.[k] ?? 1);
  const salesNow = ((e.cpi ?? 1) / Math.max(1e-6, A.cpi)) * prod;
  return P.margin + P.rent - P.rent * space * rentNow / Math.max(1e-6, salesNow);
}

/** Open a tenant's books if it has none (old saves, new leases). Deterministic. */
export function tenantFin(e: Econ, t: Tenant): TenantFin {
  if (t.fin) return t.fin as TenantFin;
  const P = FIRM_PROFILE[t.sector];
  const B = bookProfile(t);
  const g = GRADE[t.credit];
  const key = `${t.name}|${t.startM}|${t.sector}`;
  const z1 = hashNormal(key + "|m"), z2 = hashNormal(key + "|r"), z3 = hashNormal(key + "|l");
  // REVENUE IS WHAT THE FIRM SELLS, NOT WHAT IT PAYS (2026-10-16). It was
  // read back from the rent — revenue = rent / the trade's rent share — so a
  // firm signing at three times the rent booked three times the sales, and
  // no firm could ever be priced out of a dear town by its books. Revenue is
  // now its people times what a worker in its trade sells: the town's opening
  // sales per worker (the trade's rent share of the opening rent per head),
  // carried forward by the trade's own productivity and the price level. A
  // firm on a dearer floor than the market's is a firm that can pay for it —
  // firms sort into buildings by what they sell, so a firm's sales per head
  // carry its premium over the market's rent — and what is left to move a
  // margin is the market's rent against what the trade sells. That is the
  // squeeze a dear town puts on all of its firms at once.
  const k = (t.use ?? "office") as keyof typeof SF_PER_JOB;
  const A = revAnchor(e);
  const rentYr = Math.max(1, t.rentPsf * t.sf);
  const mkt = Math.max(0.01, e.rentIdx?.[k] ?? t.rentPsf);
  const rel = Math.max(0.2, Math.min(5, t.rentPsf / mkt));
  const heads = (t.hcRef ?? t.sf) / Math.max(0.2, t.staffSign ?? 1) / Math.max(1, SF_PER_JOB[k] || 230);
  const perHead = (A.rent[k] ?? mkt) * (SF_PER_JOB[k] || 230) / B.rent
    * ((e.cpi ?? 1) / Math.max(1e-6, A.cpi)) * tradeProd(e, t) * rel;
  void z2;
  const rev0 = Math.max(rentYr * 1.05, heads * perHead);
  const rentShare = rentYr / rev0;
  const margin = Math.min(0.45, B.margin * g.margin * Math.exp(0.25 * z1)) + B.rent - rentShare;
  const n = e.nat;
  const long = (e.indexRate ?? 5.4) / 100;
  // Leverage as the trade carries it, adjusted for the grade — but no more
  // than a lender would write at today's rate for this credit.
  const lev = Math.min(P.lev * g.lev * Math.exp(0.3 * z3),
    1 / ((long + P.spread + g.spread) * LENDER_COVER * (t.credit === 0 ? 0.75 : 1)));
  const fin: TenantFin = {
    rev0, prod0: tradeProd(e, t),
    otherShare: Math.max(0.2, 1 - Math.max(0, margin) - rentShare),
    cash: g.cashM * rev0 / 12,
    debt: lev * Math.max(0, margin) * rev0,
    fixed: long + P.spread + g.spread, spread: P.spread + g.spread, float: P.float, lev,
    cover: 99, liqM: g.cashM, margin,
  };
  void n;
  t.fin = fin;
  return fin;
}

/**
 * One month of a tenant's business. `rentDueYr` is what the lease charges this
 * month, annualised (zero in a free-rent month).
 */
export function tickTenantFin(e: Econ, t: Tenant, rentDueYr: number, creditOpen: number): TenantFin {
  const f = tenantFin(e, t);
  const n = e.nat;
  const short = (n?.policy ?? 4) / 100, long = (e.indexRate ?? 5.4) / 100, infl = n?.infl ?? 0.02;
  // IN DOLLARS OF THE DAY (2026-10-15). Revenue was held at its signing
  // level in nominal terms while the rent escalated and the debt was eroded
  // as if real, so a long inflation starved every tenant: measured, a century
  // with prices up 32x emptied the street's offices, shops and sheds to the
  // 45% bound. A business's sales rise with the prices it charges; its rent
  // and its debt are nominal contracts. Everything here is in current dollars.
  f.cpi0 ??= e.cpi ?? 1;
  const priceLevel = (e.cpi ?? 1) / Math.max(1e-6, f.cpi0);
  const mth = e.m ?? 0;
  if (f.zM !== mth) {
    // ...plus a named customer won or lost last month (economy.ts `tickLinks`): its share of sales, moved from or to its rivals
    const link = t.fid !== undefined ? (e.eco?.linkDz?.[t.fid] ?? 0) : 0;
    f.z = Z_RHO * (f.z ?? 0) + Z_SIG * Z_GRADE[t.credit] * hashNormal(`${t.name}|${t.sector}|${Math.round(f.rev0)}|z|${mth}`) + link;
    f.zM = mth;
  }
  const sig = Z_SIG * Z_GRADE[t.credit];
  const own = Math.exp((f.z ?? 0) - 0.5 * sig * sig / (1 - Z_RHO * Z_RHO));
  const rev = f.rev0 * (t.staff ?? 1) * (tradeProd(e, t) / Math.max(1e-6, f.prod0)) * priceLevel * own;
  // Costs are sticky — 40% were set for last year's revenue — so a revenue
  // drop goes straight to the bottom line before the business can adjust.
  f.revRef = (f.revRef ?? rev) + (rev - (f.revRef ?? rev)) / 12;
  const other = f.otherShare * (0.4 * f.revRef + 0.6 * rev);
  const ebitda = rev - other - rentDueYr;
  f.fixed += (long + f.spread - f.fixed) / 60;
  const rate = f.float * (short + f.spread) + (1 - f.float) * f.fixed;
  const interest = f.debt * rate;
  const tax = 0.21 * Math.max(0, ebitda - interest);
  f.cash += (ebitda - interest - tax) / 12;
  void infl;
  const costsM = (other + rentDueYr + interest) / 12;
  // Draw on the bank when cash is short and leverage allows; a shut window
  // means no new money. Repay when flush; pay surplus out to the owners.
  const cap = Math.min(f.lev * 1.5, 1.5 / (Math.max(0.01, rate) * LENDER_COVER)) * Math.max(0, ebitda);
  if (f.cash < costsM && f.debt < cap) {
    const draw = Math.min(cap - f.debt, costsM * 1.5) * Math.max(0, Math.min(1, (creditOpen - 0.5) / 0.5));
    f.debt += draw; f.cash += draw;
  } else if (f.cash > CASH_KEEP_M * costsM) {
    // LEAN, AS SMALL BUSINESSES RUN: the median US small business holds about
    // 27 days of outflows in cash (JPMorgan Chase Institute 2016); surplus
    // goes to the owners or pays down debt. Kept at ~1.5 months here.
    const spare = f.cash - CASH_KEEP_M * costsM;
    const repay = Math.min(spare * 0.5, Math.max(0, f.debt - f.lev * Math.max(0, ebitda)));
    f.debt -= repay; f.cash -= repay + (spare - repay) * 0.15;
  }
  // ...AND BORROWS BACK UP TO ITS NORMAL LEVERAGE as earnings grow (and
  // inflation wears the old debt down), paying the proceeds to its owners —
  // the recapitalisation every levered small business does. Toward what a
  // lender would write today, over three years, while the window is open.
  {
    const levNow = Math.min(f.lev, 1 / (Math.max(0.01, rate) * LENDER_COVER));
    const target = levNow * Math.max(0, ebitda);
    if (f.debt < target) f.debt += (target - f.debt) / 36 * Math.max(0, Math.min(1, (creditOpen - 0.5) / 0.5));
  }
  f.cover = interest > 0 ? ebitda / interest : (ebitda > 0 ? 99 : -1);
  f.liqM = f.cash / Math.max(1e-9, costsM);
  f.margin = ebitda / Math.max(1e-9, rev);
  return f;
}

/**
 * Monthly odds this tenant stops paying and goes dark. A healthy business
 * carries a small background risk (fraud, a founder's death, a lost contract);
 * the rest is its books — interest cover under two, under a month of costs in
 * the bank, and a business already burning borrowed cash it cannot replace.
 */
export function tenantFailOdds(f: TenantFin, credit: Credit): number {
  // FAILURE IS THE BOOKS (2026-10-16). What is left of a background is what
  // no set of accounts sees coming — fraud, a founder's death — at a few
  // hundredths of a per cent a year. The rest is the firm's own position:
  // odds climb from 2.5x interest cover down and from under a month of costs
  // in the bank, and a firm whose cash has run out and whose bank will not
  // lend it more goes within months. With each firm's own fortunes on top of
  // its trade's (`Z_SIG`), that gives the observed rated-debt default rates —
  // ~0.5% a year investment grade, ~1.5% mid-market, ~5% for small unrated
  // firms (S&P long-run; SBA loan performance) — out of the accounts, and
  // roughly doubles them in a recession (US business bankruptcies 2007-09).
  const coverStress = Math.max(0, Math.min(4.5, 2.5 - f.cover));
  const cashStress = Math.max(0, 1 - f.liqM);
  const broke = f.cash < 0 ? Math.min(0.25, 0.04 * (1 - f.liqM)) : 0;
  return Math.min(0.5, BACKGROUND_FAIL[credit] + FAIL_K * (Math.exp(1.1 * coverStress + 2.2 * cashStress) - 1) + broke);
}

/** Odds per unit of book stress (see tenantFailOdds). */
const FAIL_K = 0.00005;

/** 0..~3: how hard the business is squeezed — what makes a tenant write for relief. */
export function tenantSqueeze(f: TenantFin): number {
  return Math.max(0, 1.5 - f.cover) * 0.6 + Math.max(0, 3 - f.liqM) * 0.35 + Math.max(0, -f.margin) * 4;
}

// ---------------------------------------------------------------------------
// THE STREET'S TENANTS KEEP THE SAME BOOKS (2026-10-15).
//
// The player's tenants each carried accounts and failed off them; everyone
// else's tenants were a pool, and failed only as a share of their trade's
// failures above a background rate. So the player's roll was held to a
// stricter standard than the market it competes with.
//
// The street now carries representative tenants — one per trade and credit
// grade in each commercial class — sized off the street's occupied space and
// keeping exactly the books above (`tickTenantFin`, `tenantFailOdds`). A
// cohort's failures hand its space back; the failed share is replaced by new
// tenants on fresh books as the market re-lets it, so a cohort is a mix of
// survivors and entrants rather than one firm dying slowly.
// ---------------------------------------------------------------------------

/** Share of a commercial class's let space by covenant: investment grade, mid, weak (sf-weighted). */
const STREET_GRADE_SF: Record<Credit, number> = { 2: 0.30, 1: 0.45, 0: 0.25 };

export interface StreetCohort { t: Tenant; w: number }
/** Representative tenants per trade and covenant on the street. */
const STREET_PER_COHORT = 6;

function freshCohortTenant(e: Econ, k: string, sector: Tenant["sector"], credit: Credit, m: number): Tenant {
  const rent = Math.max(0.01, (e.inPlaceReal?.[k as "office"] ?? 1) * (e.cpi ?? 1));
  return { name: `street-${k}-${sector}-${credit}-${m}`, sector, credit, sf: 1000, rentPsf: rent,
    net: false, startM: m, endM: m + 96, staff: 1 } as Tenant;
}

/**
 * One month of the street's tenants in class `k`. Returns the share of the
 * street's let space whose tenants failed this month (beyond the background
 * a market's ordinary churn already carries).
 */
export function tickStreetTenants(e: Econ, k: "office" | "retail" | "industrial", sectors: Tenant["sector"][],
  sectorShare: Partial<Record<string, number>>, month: number): number {
  if (!sectors.length) return 0;
  e.streetCohorts ??= {};
  let book = e.streetCohorts[k] as StreetCohort[] | undefined;
  if (!book) {
    const tot = sectors.reduce((a, sec) => a + (sectorShare[sec] ?? 1), 0) || 1;
    book = [];
    // Six tenants per trade and covenant, each with its own draw of margin,
    // rent burden and leverage (tenantFin hashes the name): a cohort fails
    // from its weak tail first, not all at once.
    for (const sec of sectors) for (const c of [2, 1, 0] as Credit[]) for (let i = 0; i < STREET_PER_COHORT; i++) {
      const t = freshCohortTenant(e, k, sec, c, month);
      t.name += `-${i}`;
      book.push({ t, w: ((sectorShare[sec] ?? 1) / tot) * STREET_GRADE_SF[c] / STREET_PER_COHORT });
    }
    e.streetCohorts[k] = book;
  }
  const marketRent = Math.max(0.01, (e.inPlaceReal?.[k] ?? 1) * (e.cpi ?? 1));
  let failed = 0;
  for (const c of book) {
    const t = c.t;
    // Headcount follows the trade's own payroll month to month: a cohort is
    // the trade's tenants on this street, so it shrinks and grows with them.
    const emp = e.firmBooks?.[t.sector]?.emp ?? 1;
    const prevEmp = (t as Tenant & { empRef?: number }).empRef ?? emp;
    (t as Tenant & { empRef?: number }).empRef = emp;
    t.staff = Math.max(0.4, Math.min(2.6, (t.staff ?? 1) * emp / Math.max(1e-6, prevEmp)));
    // The roll reprices toward market over an eight-year term, and the space
    // follows the headcount (a growing tenant takes more floor; the cohort's
    // rent grows with it rather than shrinking as a share of its sales).
    t.rentPsf += (marketRent - t.rentPsf) / 96;
    t.sf = 1000 * (t.staff ?? 1);
    const f = tickTenantFin(e, t, t.rentPsf * t.sf, e.creditIdx ?? 1);
    const odds = tenantFailOdds(f, t.credit);
    const excess = Math.max(0, odds - BACKGROUND_FAIL[t.credit]);
    failed += c.w * excess;
    // The failed share is re-let to newcomers on fresh books: blend toward a
    // healthy balance sheet at today's revenue, in proportion to the turnover
    // (failures plus ordinary roll, an eighth a year).
    const renew = Math.min(1, odds + 1 / 96);
    const rev = f.rev0 * (t.staff ?? 1) * (e.cpi ?? 1) / Math.max(1e-6, f.cpi0 ?? e.cpi ?? 1);
    const g = GRADE[t.credit];
    // Newcomers borrow what today's lenders will write: no more than keeps
    // interest covered at today's rate, so a dear-money decade re-lets to
    // firms carrying less debt, not to the opening's leverage.
    const long = (e.indexRate ?? 5.4) / 100;
    const levNow = Math.min(f.lev, 1 / ((long + f.spread) * LENDER_COVER));
    f.cash += renew * (g.cashM * rev / 12 - f.cash);
    f.debt += renew * (levNow * Math.max(0.02, f.margin) * rev - f.debt);
    f.fixed += renew * (long + f.spread - f.fixed);
    t.staff = (t.staff ?? 1) + renew * (1 - (t.staff ?? 1));
  }
  const tot = book.reduce((a, c) => a + c.w, 0) || 1;
  return failed / tot;
}

/** The background odds already carried by a market's ordinary churn. */
/** What no set of books sees coming — fraud, a death — per month, by covenant. */
export const BACKGROUND_FAIL: Record<Credit, number> = { 2: 0.00002, 1: 0.00004, 0: 0.00008 };
