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
  /** the share of revenue that is neither rent nor margin (wages, goods, services) */
  otherShare: number;
  /** last year's revenue, smoothed — what the cost base was built for */
  revRef?: number;
  cash: number; debt: number; fixed: number; spread: number; float: number; lev: number;
  /** this month's read: EBITDA over interest, months of costs in the bank, EBITDA margin */
  cover: number; liqM: number; margin: number;
}

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
  const rev = f.rev0 * (t.staff ?? 1) * (tradeProd(e, t) / Math.max(1e-6, f.prod0));
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
  f.debt *= 1 - infl / 12;
  const costsM = (other + rentDueYr + interest) / 12;
  // Draw on the bank when cash is short and leverage allows; a shut window
  // means no new money. Repay when flush; pay surplus out to the owners.
  const cap = Math.min(f.lev * 1.5, 1.5 / (Math.max(0.01, rate) * LENDER_COVER)) * Math.max(0, ebitda);
  if (f.cash < costsM && f.debt < cap) {
    const draw = Math.min(cap - f.debt, costsM * 1.5) * Math.max(0, Math.min(1, (creditOpen - 0.5) / 0.5));
    f.debt += draw; f.cash += draw;
  } else if (f.cash > 4 * costsM) {
    const spare = f.cash - 4 * costsM;
    const repay = Math.min(spare * 0.5, Math.max(0, f.debt - f.lev * Math.max(0, ebitda)));
    f.debt -= repay; f.cash -= repay + (spare - repay) * 0.15;
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
  // Background odds at rated-debt norms (S&P long-run annual defaults: ~0.1-0.3%
  // investment grade, ~1-2% BB/B, ~4-6% for unrated small firms).
  const background = credit === 2 ? 0.0002 : credit === 1 ? 0.0011 : 0.0026;
  const coverStress = Math.max(0, Math.min(4, 2 - f.cover));
  const cashStress = Math.max(0, 1 - f.liqM);
  const broke = f.cash < 0 ? Math.min(0.25, 0.04 * (1 - f.liqM)) : 0;
  return Math.min(0.5, background * Math.exp(0.8 * coverStress + 2.2 * cashStress) + broke);
}

/** 0..~3: how hard the business is squeezed — what makes a tenant write for relief. */
export function tenantSqueeze(f: TenantFin): number {
  return Math.max(0, 1.5 - f.cover) * 0.6 + Math.max(0, 3 - f.liqM) * 0.35 + Math.max(0, -f.margin) * 4;
}
