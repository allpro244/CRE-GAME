// THE LOAN BOOK — every named loan in this town, in one list.
//
// A lender's statement used to be two aggregates with nothing inside them: a
// `book` that grew by an appetite rule and a `delinquent` share that followed
// the city's vacancy. The loans that actually existed — yours, the street's,
// the cranes on every corner — lived in five different places (Holding.loan,
// Holding.mezz, the facility, the construction pipeline, the mortgage record
// and the street's construction jobs), and each desk counted a different
// subset of them: the single-name test read first mortgages and construction,
// the class test read the record, and nothing at all read whether any of them
// was being PAID.
//
// This walks all of them, the same way, every time it is asked. It is a view,
// not a store: nothing here is written to state, so it cannot drift from the
// loans it describes, and every reader — the single-name test, the class test,
// the desk's delinquency, the Banks page — gets one answer.
//
// EVERY LOAN IS NAMED NOW (2026-10-28). The families, partnerships and
// institutions in the deed register — who own most of the buildings on the
// map — used to be the desk's ANONYMOUS book, a population whose delinquency
// was a formula plus noise. Their mortgages are on the record now
// (streetLoans.ts), seeded from their own deeds and paid or missed out of
// their own buildings' income, so a desk's book is this list and nothing
// else, and its delinquency is counted, never modelled.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "./types";
import { CONSTRUCTION_LENDER } from "./types";
import { PRODUCTS } from "./debt";
import { resolveRec } from "./value";
import { lineLender } from "./credit";
import type { LossClass } from "./pricing";

export type BookLoanKind = "senior" | "mezz" | "construction" | "facility" | "line";

/**
 * How the loan is performing, in a credit officer's three words.
 *
 *   current — paying as agreed.
 *   watch   — paying, but something is wrong: a tripped covenant and a cash
 *             sweep, a borrower whose whole book is under strain. Classified,
 *             not delinquent; it earns its coupon.
 *   default — not paying, or past its maturity with no takeout: arrears, a
 *             matured balloon in workout, a filed foreclosure, a construction
 *             job whose sponsor died. Nonaccrual — it earns nothing and it is
 *             what the desk's delinquency line counts.
 */
export type BookLoanStatus = "current" | "watch" | "default";

export interface BookLoan {
  /** The desk on the other side — whoever holds the paper today. */
  holder: string;
  /** "player", or a rival's id. */
  borrower: string;
  kind: BookLoanKind;
  balance: number;
  status: BookLoanStatus;
  bbl?: string;
  /** Asset class of the collateral, when parcels were supplied. Construction paper is "construction". */
  klass?: string;
  /** What it is for its expected loss and capital (pricing.ts). */
  cls: LossClass;
  /** The coupon, where the loan carries one. */
  ratePct?: number;
  /** The month it was written, where the loan records it — the competitive tape counts new paper. */
  originM?: number;
  /** The borrower's name, for the statement (the player is "You"; a firm or a holder by name). */
  name?: string;
}

const seniorLender = (l: { holder?: string; product: string }): string | undefined =>
  l.holder ?? PRODUCTS.find((p) => p.id === l.product)?.lender;

/** The desk that writes the firm's revolver. See credit.ts lineLender. */
export function lineHolder(s: GameState): string | undefined {
  return lineLender(s)?.name;
}

/**
 * EVERY NAMED LOAN IN TOWN. `parcels` is optional: without it the list carries
 * no asset class, which is all the monthly lender tick needs; the class ledger
 * passes it.
 */
export function cityLoanBook(s: GameState, parcels?: ParcelTable): BookLoan[] {
  const out: BookLoan[] = [];
  const klassOf = (bbl: string): string | undefined => {
    if (!parcels) return undefined;
    const rec = resolveRec(parcels, s, bbl);
    return rec ? (rec.class === "land" ? "land" : rec.class) : undefined;
  };

  // --- yours -----------------------------------------------------------------
  for (const h of Object.values(s.holdings)) {
    const w = s.workouts?.[h.bbl];
    if (h.loan && h.loan.balance > 0) {
      const holder = seniorLender(h.loan);
      if (holder) {
        // Not paying is default; past maturity but still paying the coupon is
        // a matured loan on watch — it earns its interest, which is why a desk
        // would rather extend it than file on it.
        const defaulted = w?.stage === "foreclosure"
          || w?.cause === "arrears"
          || (h.loan.arrearsMs ?? 0) >= 1;
        const status: BookLoanStatus = defaulted ? "default" : (h.loan.sweep || w) ? "watch" : "current";
        out.push({
          holder, borrower: "player", kind: "senior", balance: h.loan.balance, status, bbl: h.bbl, klass: klassOf(h.bbl),
          cls: h.loan.product === "land" || h.loan.product === "tideLand" ? "land" : h.loan.product === "cordage" ? "junior" : "income",
          ratePct: h.loan.ratePct, originM: h.loan.originM, name: "You",
        });
      }
    }
    if (h.mezz && h.mezz.balance > 0) {
      const status: BookLoanStatus = (h.mezz.arrearsMs ?? 0) >= 1 || (w && !h.loan) ? "default" : w ? "watch" : "current";
      out.push({
        holder: h.mezz.holder ?? "Cordage Debt Partners", borrower: "player", kind: "mezz",
        balance: h.mezz.balance, status, bbl: h.bbl, klass: klassOf(h.bbl), cls: "junior", ratePct: h.mezz.ratePct, name: "You",
      });
    }
  }
  if (s.facility && s.facility.balance > 0) {
    const f = s.facility;
    out.push({
      holder: f.lender, borrower: "player", kind: "facility", balance: f.balance,
      status: (f.arrearsMs ?? 0) >= 1 ? "default" : f.sweep ? "watch" : "current", cls: "income", ratePct: f.ratePct, name: "You",
    });
  }
  for (const d of Object.values(s.developments ?? {})) {
    if (!(d.loanBalance > 0)) continue;
    out.push({
      holder: d.lender ?? CONSTRUCTION_LENDER, borrower: "player", kind: "construction",
      balance: d.loanBalance, status: "current", bbl: d.bbl, klass: "construction", cls: "construction", ratePct: d.ratePct, name: "You",
    });
  }
  const line = lineHolder(s);
  if (line && s.loc.balance > 0) {
    out.push({ holder: line, borrower: "player", kind: "line", balance: s.loc.balance, status: "current", cls: "income", name: "You" });
  }

  // --- the street ----------------------------------------------------------
  // The mortgage record holds every firm's mortgages, originated by the desk
  // that wrote them (rivalDebt.ts); a note sold out of the banks (`heldBy`) is
  // still owed but is no desk's paper. Each firm's line sits at its bank, and
  // the construction jobs carry their own balance and desk.
  const firmName = new Map<string, string>();
  for (const r of s.rivals ?? []) firmName.set(r.id, r.name);
  for (const x of Object.values(s.cityLoans ?? {})) {
    if (!(x.balance > 0) || x.heldBy) continue;
    out.push({
      holder: x.lender, borrower: x.obligorId, kind: "senior", balance: x.balance * (x.share ?? 1),
      status: x.status === "workout" ? "default" : x.status === "watch" ? "watch" : "current",
      bbl: x.bbl, klass: x.klass,
      cls: x.klass === "land" ? "land" : x.product === "cordage" ? "junior" : "income",
      ratePct: x.ratePct, originM: x.originM, name: firmName.get(x.obligorId),
    });
  }
  // The private owners' mortgages (streetLoans.ts): the families, partnerships
  // and institutions in the deed register, each loan paid or missed out of
  // the holder's own buildings.
  for (const x of Object.values(s.streetLoans ?? {})) {
    if (!(x.balance > 0)) continue;
    out.push({
      holder: x.lender, borrower: "h:" + x.holderId, kind: "senior", balance: x.balance * (x.share ?? 1), status: x.status,
      bbl: x.bbl, klass: x.klass, cls: x.klass === "land" ? "land" : x.product === "cordage" ? "junior" : "income",
      ratePct: x.ratePct, originM: x.originM, name: x.holder,
    });
  }
  for (const r of s.rivals ?? []) {
    if (r.failedM !== undefined || !((r.lineBal ?? 0) > 0) || !r.lineBank) continue;
    // A line is current while the firm is: it is the first thing a sponsor
    // keeps paying, and the last thing a bank lets slide.
    out.push({
      holder: r.lineBank, borrower: r.id, kind: "line", balance: r.lineBal!,
      status: (r.stressMs ?? 0) >= 3 ? "default" : (r.stressMs ?? 0) > 0 ? "watch" : "current", cls: "income", name: r.name,
    });
  }
  // The homebuilders' acquisition, development and construction lines (homes.ts).
  for (const b of Object.values(s.homes?.builders ?? {})) {
    if (b.failedM !== undefined || !(b.debt > 0) || !b.lender) continue;
    out.push({
      holder: b.lender, borrower: `hb:${b.name}`, kind: "construction", balance: Math.round(b.debt),
      status: (b.stressMs ?? 0) >= 2 ? "default" : (b.stressMs ?? 0) > 0 ? "watch" : "current", klass: "construction",
      cls: "construction", name: b.name,
    });
  }
  for (const j of s.cityJobs ?? []) {
    // THE STREET'S MERCHANT BUILDERS borrow too (dev.ts settleMerchant): the
    // loan is on the desk from groundbreak and settled at delivery.
    if (!j.firmId && j.merchant?.lender && j.merchant.loan > 0) {
      out.push({
        holder: j.merchant.lender, borrower: "mb:" + (j.builderId ?? j.bbl), kind: "construction", balance: j.merchant.loan,
        status: j.orphaned ? "default" : "current", bbl: j.bbl, klass: "construction", cls: "construction",
        name: "a merchant builder",
      });
      continue;
    }
    if (!j.firmId || !((j.debt ?? 0) > 0)) continue;
    out.push({
      holder: j.lender ?? CONSTRUCTION_LENDER, borrower: j.firmId, kind: "construction",
      balance: j.debt ?? 0,
      // A frame whose sponsor died is a loan nobody is paying.
      status: j.orphaned ? "default" : j.repudiatedM !== undefined ? "watch" : "current",
      bbl: j.bbl, klass: "construction", cls: "construction", ratePct: j.ratePct, name: firmName.get(j.firmId),
    });
  }
  return out;
}

export interface DeskTotals {
  /** Every named dollar this desk has out. */
  named: number;
  /** Of which not paying (status "default"). */
  defaulted: number;
  /** Of which on watch. */
  watch: number;
  /** Of which lent to the player — the single-name test. */
  yours: number;
  /** By collateral class, when parcels were supplied. */
  byClass: Record<string, number>;
  /** By loan type (pricing.ts LossClass): balance, in default, on watch, count. */
  byCls: Partial<Record<LossClass, { bal: number; def: number; watch: number; n: number }>>;
  /** Coupon dollars a year on the performing paper that carries a coupon, and that paper's balance. */
  couponYr: number;
  rated: number;
  /** Term loans written in month `origM` (asked for), by dollars — the competitive tape. */
  orig: number;
}

/** The book, summed by the desk that holds it. `origM` counts the term paper written that month. */
export function deskTotals(book: BookLoan[], origM?: number): Record<string, DeskTotals> {
  const by: Record<string, DeskTotals> = {};
  for (const x of book) {
    const t = (by[x.holder] ??= { named: 0, defaulted: 0, watch: 0, yours: 0, byClass: {}, byCls: {}, couponYr: 0, rated: 0, orig: 0 });
    t.named += x.balance;
    if (x.status === "default") t.defaulted += x.balance;
    else if (x.status === "watch") t.watch += x.balance;
    if (x.borrower === "player") t.yours += x.balance;
    if (x.klass) t.byClass[x.klass] = (t.byClass[x.klass] ?? 0) + x.balance;
    const c = (t.byCls[x.cls] ??= { bal: 0, def: 0, watch: 0, n: 0 });
    c.bal += x.balance; c.n++;
    if (x.status === "default") c.def += x.balance;
    else if (x.status === "watch") c.watch += x.balance;
    // A loan not paying earns nothing (nonaccrual).
    if (x.status !== "default" && x.ratePct !== undefined && Number.isFinite(x.ratePct)) {
      t.couponYr += x.balance * x.ratePct / 100;
      t.rated += x.balance;
    }
    if (origM !== undefined && x.originM === origM && x.kind === "senior") t.orig += x.balance;
  }
  return by;
}
