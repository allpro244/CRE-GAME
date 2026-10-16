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
import { FIRM_PROFILE, LENDER_COVER } from "./market";
import { hashNormal } from "./value";

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
 * so a good or bad run lasts years — sized so a small unrated firm's sales sit
 * about 19% either side of its trade's (the dispersion of small-firm revenue
 * growth in the Census Business Dynamics Statistics runs 20-35%). Failures come out of
 * this and the trade's year through the books; nothing is drawn at a fixed rate.
 */
const Z_RHO = 0.985;
const Z_SIG = 0.033;
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

/** Open a tenant's books if it has none (old saves, new leases). Deterministic. */
export function tenantFin(e: Econ, t: Tenant): TenantFin {
  if (t.fin) return t.fin as TenantFin;
  const P = FIRM_PROFILE[t.sector];
  const g = GRADE[t.credit];
  const key = `${t.name}|${t.startM}|${t.sector}`;
  const z1 = hashNormal(key + "|m"), z2 = hashNormal(key + "|r"), z3 = hashNormal(key + "|l");
  const margin = Math.min(0.45, P.margin * g.margin * Math.exp(0.25 * z1));
  const rentShare = Math.min(0.30, P.rent * Math.exp(0.30 * z2));
  const rentYr = Math.max(1, t.rentPsf * t.sf);
  const rev0 = rentYr / rentShare;
  const n = e.nat;
  const long = (e.indexRate ?? 5.4) / 100;
  // Leverage as the trade carries it, adjusted for the grade — but no more
  // than a lender would write at today's rate for this credit.
  const lev = Math.min(P.lev * g.lev * Math.exp(0.3 * z3),
    1 / ((long + P.spread + g.spread) * LENDER_COVER * (t.credit === 0 ? 0.75 : 1)));
  const fin: TenantFin = {
    rev0, prod0: tradeProd(e, t),
    otherShare: Math.max(0.2, 1 - margin - rentShare),
    cash: g.cashM * rev0 / 12,
    debt: lev * margin * rev0,
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
    f.z = Z_RHO * (f.z ?? 0) + Z_SIG * Z_GRADE[t.credit] * hashNormal(`${t.name}|${t.sector}|${Math.round(f.rev0)}|z|${mth}`);
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
