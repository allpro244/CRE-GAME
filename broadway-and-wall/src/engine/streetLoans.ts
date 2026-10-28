// THE PRIVATE OWNERS' MORTGAGES, LOAN BY LOAN (2026-10-28).
//
// Most of the buildings on the map belong to the deed register (owners.ts):
// families, partnerships, estates, institutions, builders who kept a few.
// The desks have always lent to them — that is most of a real town's
// commercial mortgage book — but here it was an ANONYMOUS book in lenders.ts:
// a balance that grew with the bank's appetite and a delinquency rate drawn
// from the city's vacancy plus noise. So a bank's losses were a formula, and
// not one of them could be traced to anybody.
//
// Now each of those mortgages is a loan on the record, to a named holder,
// against a named building:
//
//   THE OPENING BOOK is seeded from the holders' own deeds, off the same
//   hashed facts their statements were already built on (ownership.ts
//   holderNoteTerms): whether the deed is clear, the advance its kind
//   writes, how far into its term the note is. The desk on each note is the
//   cheapest sheet in town that would write it today, filled in the
//   proportions the market's shape implies (lenders.ts bookShareOf) — a
//   seasoned book is spread across the desks, not piled on the cheapest one.
//
//   THE PAYMENT is made or missed out of the holder's own money. Every
//   quarter the register's buildings are read — what each earns after tax
//   (the street rolls decide how full it is), and what the holder's whole
//   book pays before debt once leasing, the capital plan and the overhead
//   are out (ownership.ts holderCfads). Every month the holder's account
//   takes that and pays its debt service; when the account runs dry the
//   holder stops feeding the buildings that carry themselves least, the way
//   the street's firms do (rivalDebt.markPayments). A missed payment is a
//   default the month it is missed — the rule every named loan is counted
//   under — and unpaid interest is added to what is owed.
//
//   THE BALLOON is refinanced at the best quote the holder can get
//   (rivalDebt.deskQuotes — the borrower shops, it does not ring the desk it
//   had). Short of a takeout the holder pays the gap if it can, the desk
//   extends a loan whose building still covers its coupon, and otherwise the
//   balloon is a default.
//
//   FORECLOSURE runs on the player's calendar — NOTICE_M to cure, FORECLOSE_M
//   once filed (workout.ts) — and ends with the desk selling the building at
//   what it will fetch (reoAsk). What it will not fetch is that desk's
//   charge-off, booked against the holder by name.
//
//   A CHANGE OF HANDS retires the old loan out of the sale (a short sale is a
//   loss) and the new owner finances its purchase at the advance its kind
//   writes, at the best quote.
//
// Nothing here draws on the RNG stream: every choice is a hash of the deed
// or a quote, so adding a loan cannot re-roll anybody's century.
import type { ParcelTable } from "@/data/types";
import type { GameState, StreetLoan } from "./types";
import { resolveRec, assetValue, noiAfterTaxYr } from "./value";
import { gradeOf } from "./rivals";
import { holderOf } from "./owners";
import type { Holder } from "./owners";
import { holderNoteTerms, holderCfads, HOLDER_AMORT_M } from "./ownership";
import { deskQuotes } from "./rivalDebt";
import { productById } from "./debt";
import { chargeLenderLoss, reoAsk, bookShareOf } from "./lenders";
import { cityLoanBook, deskTotals } from "./loanbook";
import { NOTICE_M, FORECLOSE_M } from "./workout";
import { shortIndexOf } from "./market";
import { money } from "./money";
import { bankRatePct, liveSpread } from "./pricing";
import { why } from "./why";

const usdK = (n: number) => `$${Math.round(n / 1000).toLocaleString("en-US")}k`;

function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/** Balance left after `k` months of a `n`-month schedule at `ratePct`. */
function amortised(principal: number, ratePct: number, n: number, k: number): number {
  const i = ratePct / 100 / 12;
  if (k <= 0) return principal;
  if (i <= 0) return principal * Math.max(0, 1 - k / n);
  const g = Math.pow(1 + i, n);
  return Math.max(0, principal * (g - Math.pow(1 + i, k)) / (g - 1));
}

/** One month's debt service on a loan: interest, and principal once its interest-only period has run. */
export function streetDebtService(s: GameState, x: StreetLoan): { interest: number; amort: number } {
  const p = productById(x.product);
  const interest = x.balance * x.ratePct / 100 / 12;
  const io = (p?.ioM ?? 0) > 0 && s.month < x.originM + (p?.ioM ?? 0);
  if (io) return { interest, amort: 0 };
  const n = Math.max(12, Math.round((p?.amortYears ?? HOLDER_AMORT_M / 12) * 12));
  const into = Math.max(0, s.month - x.originM - (p?.ioM ?? 0));
  const left = Math.max(1, n - into);
  const i = x.ratePct / 100 / 12;
  const pmt = i > 0 ? x.balance * i / (1 - Math.pow(1 + i, -left)) : x.balance / left;
  return { interest, amort: Math.max(0, Math.min(x.balance, pmt - interest)) };
}

type Deed = { bbl: string; h: Holder; v: number; noi: number; dirt: boolean; klass: string; condition?: string };

/** Write a loan at the best quote this building can get today. Null if no desk will lend on it. */
function writeLoan(
  s: GameState, d: Deed, amount: number, into: number, pick?: (q: ReturnType<typeof deskQuotes>[number]) => boolean,
): StreetLoan | null {
  const qs = deskQuotes(s, d.v, d.noi, { klass: d.klass, condition: d.condition });
  if (!qs.length) return null;
  // the cheapest that will write the amount (and, at the opening, has room for it)
  const q = qs.find((c) => c.principal >= amount * 0.98 && (!pick || pick(c)))
    ?? qs.find((c) => !pick || pick(c))
    ?? qs[0];
  const p = productById(q.product);
  const termM = q.termM;
  const k = into % Math.max(1, termM);
  const n = Math.max(12, (p?.amortYears ?? 25) * 12);
  const balance = Math.round(amortised(amount, q.ratePct, n, Math.max(0, k - (p?.ioM ?? 0))));
  const loan: StreetLoan = {
    bbl: d.bbl, lender: q.lender, holderId: d.h.id, holder: d.h.name, balance,
    ratePct: q.ratePct, product: q.product, originM: s.month - k, maturityM: s.month - k + termM,
    klass: d.klass, status: "current", arrearsMs: 0, noiYr: Math.round(d.noi), value: Math.round(d.v),
  };
  if (p?.floating) loan.spread = +(q.ratePct - shortIndexOf(s.econ)).toFixed(2);
  return loan;
}

/** The loan comes off the record: paid out of a sale, or short of it — the shortfall is the desk's loss. */
function retire(s: GameState, x: StreetLoan, price: number) {
  const net = price * 0.97;   // the seller's closing costs come out first
  if (net < x.balance) {
    chargeLenderLoss(s, x.lender, Math.round(x.balance - Math.max(0, net)), {
      borrower: x.holder, id: "h:" + x.holderId, bbl: x.bbl, cls: x.klass === "land" ? "land" : "income", how: "short sale",
    });
  }
  delete s.streetLoans![x.bbl];
}

/** The desk takes the building and sells it; what it will not fetch is its charge-off, against the holder by name. */
function foreclose(s: GameState, x: StreetLoan, addr: string) {
  const ask = reoAsk(s, x.value, x.balance, x.lender);
  const loss = Math.max(0, Math.round(x.balance - ask));
  chargeLenderLoss(s, x.lender, loss, {
    borrower: x.holder, id: "h:" + x.holderId, bbl: x.bbl, cls: x.klass === "land" ? "land" : "income", how: "foreclosure", why: x.whyId,
  });
  const lossWhy = s.lenders?.find((l) => l.name === x.lender)?.lossWhy;
  delete s.streetLoans![x.bbl];
  // The building has a new owner: whoever buys it from the desk. The register
  // draws them afresh from today (owners.ts deedSalt), and the desk puts it
  // on the tape first — the player can bid at the desk's price.
  (s.deedSalt ??= {})[x.bbl] = s.month;
  (s.lastTradeM ??= {})[x.bbl] = s.month;
  if (!s.holdings[x.bbl] && !s.listings.some((l) => l.bbl === x.bbl)) {
    s.listings.push({
      bbl: x.bbl, ask, listedM: s.month, expiresM: s.month + 12, distress: true, receiverFor: x.lender, reason: "receiver",
      loanBasis: Math.min(x.value, x.balance), mark: Math.round(x.value),
    });
  }
  s.news.unshift({
    q: s.month, kind: "info", bbl: x.bbl, why: lossWhy ?? x.whyId,
    text: `${x.lender} foreclosed on ${x.holder} at ${addr}: ${money(x.balance)} owed, `
      + `listed at ${money(ask)}${loss > 0 ? `, a ${money(loss)} loss to the bank` : ""}.`,
  });
}

/**
 * THE QUARTERLY READ: who holds what, what it earns, and every change of
 * hands since the last one. The first call seeds the opening book.
 */
function readHolders(s: GameState, parcels: ParcelTable) {
  const e = s.econ;
  const seeding = !s.streetLoans;
  const L = (s.streetLoans ??= {});
  const seen = (s.streetDeedHolder ??= {});
  const vals = (s.streetDeedValue ??= {});
  const books = new Map<string, { h: Holder; deeds: Deed[] }>();
  const here = new Set<string>();
  const fresh: { d: Deed; ltv: number; into: number }[] = [];
  for (const bbl of Object.keys(parcels)) {
    const h = holderOf(s, parcels, bbl);
    if (!h) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const grade = gradeOf(s, rec);
    // THE APPRAISAL IS ANNUAL (and on first sight); the income is read every
    // quarter off the street's own rolls. Valuing every private building in
    // town is the expensive half of this read and an owner does not re-mark
    // a book every quarter either.
    const v = s.month % 12 === 0 || vals[bbl] === undefined ? assetValue(rec, e, grade) : vals[bbl];
    vals[bbl] = Math.round(v);
    const dirt = rec.class === "land" || !(rec.bldgArea > 0);
    const noi = noiAfterTaxYr(rec, e, grade, v);
    const d: Deed = { bbl, h, v, noi, dirt, klass: dirt ? "land" : rec.class, condition: dirt ? undefined : grade };
    here.add(bbl);
    const b = books.get(h.id) ?? { h, deeds: [] };
    b.deeds.push(d); books.set(h.id, b);
    const x = L[bbl];
    if (seeding) {
      const t = holderNoteTerms(s, h, bbl, dirt);
      if (t && v > 0) fresh.push({ d, ...t });
    } else if (seen[bbl] !== h.id) {
      // A change of hands, or a deed the register has not carried before
      // (a delivery, a building the player or a firm sold to the market).
      if (x) retire(s, x, v);
      const t = holderNoteTerms(s, h, bbl, dirt, `m${s.month}`);
      if (t && v > 0) fresh.push({ d, ...t });
    } else if (x) {
      x.value = Math.round(v);
      x.noiYr = Math.round(noi);
    }
    seen[bbl] = h.id;
  }
  // A deed that left the register (bought by you or a firm, taken by the city)
  // paid its mortgage off at the closing.
  for (const bbl of Object.keys(L)) if (!here.has(bbl)) retire(s, L[bbl], L[bbl].value);
  for (const bbl of Object.keys(seen)) if (!here.has(bbl)) delete seen[bbl];
  for (const bbl of Object.keys(vals)) if (!here.has(bbl)) delete vals[bbl];

  if (seeding && fresh.length) {
    // THE OPENING BOOK, spread across the desks in the market's proportions:
    // each desk's share of the town's property debt (bookShareOf), less what
    // it already holds of the firms' and the cranes' paper.
    const total = fresh.reduce((a, f) => a + f.d.v * f.ltv, 0);
    const named = deskTotals(cityLoanBook(s));
    const live = (s.lenders ?? []).filter((l) => l.failedM === undefined);
    const shareSum = live.reduce((a, l) => a + bookShareOf(l.name, l.kind), 0) || 1;
    const all = total + live.reduce((a, l) => a + (named[l.name]?.named ?? 0), 0);
    const room = new Map<string, number>();
    for (const l of live) room.set(l.name, all * bookShareOf(l.name, l.kind) / shareSum - (named[l.name]?.named ?? 0));
    fresh.sort((a, b) => hash01(a.d.bbl + ":seed") - hash01(b.d.bbl + ":seed"));
    for (const f of fresh) {
      const amt = f.d.v * f.ltv;
      const loan = writeLoan(s, f.d, amt, f.into, (q) => (room.get(q.lender) ?? 0) >= amt);
      if (!loan || !(loan.balance > 0)) continue;
      room.set(loan.lender, (room.get(loan.lender) ?? 0) - loan.balance);
      L[f.d.bbl] = loan;
    }
  } else {
    for (const f of fresh) {
      const loan = writeLoan(s, f.d, f.d.v * f.ltv, 0);
      if (loan && loan.balance > 0) L[f.d.bbl] = loan;
    }
  }

  // What each holder's buildings pay before debt service, a year.
  const cf = (s.holderCfads = {} as Record<string, { cfads: number; cap: number }>);
  const cash = (s.holderCash ??= {});
  for (const [id, b] of books) {
    const r = holderCfads(s, b.h, b.deeds);
    cf[id] = { cfads: r.cfads, cap: r.cashCap };
    if (cash[id] === undefined) cash[id] = Math.round(r.cashCap);
  }
  for (const id of Object.keys(cash)) if (!cf[id]) delete cash[id];
}

/** Each holder pays its debt service out of what its buildings earned, or does not. */
function payMonth(s: GameState, parcels: ParcelTable) {
  const L = s.streetLoans;
  if (!L) return;
  const by = new Map<string, StreetLoan[]>();
  for (const x of Object.values(L)) {
    const a = by.get(x.holderId);
    if (a) a.push(x); else by.set(x.holderId, [x]);
  }
  const cash = (s.holderCash ??= {});
  const idx = shortIndexOf(s.econ);
  for (const [id, loans] of by) {
    // Floating paper floats (rivalDebt.repriceFloating does the same for the firms').
    for (const x of loans) if (x.spread !== undefined) x.ratePct = +Math.max(0.05, idx + x.spread).toFixed(2);
    const svc = loans.map((x) => ({ x, ...streetDebtService(s, x) }));
    const due = svc.reduce((a, d) => a + d.interest + d.amort, 0);
    const flow = s.holderCfads?.[id];
    let c = (cash[id] ?? 0) + (flow ? flow.cfads / 12 : 0) - due;
    const missed = new Set<StreetLoan>();
    if (c < 0) {
      // Stop feeding the buildings that carry themselves least, until what is
      // not paid covers the hole.
      const cover = (d: typeof svc[number]) => d.x.noiYr / 12 / Math.max(1, d.interest + d.amort);
      for (const d of [...svc].sort((a, b) => cover(a) - cover(b))) {
        if (c >= 0) break;
        missed.add(d.x);
        c += d.interest + d.amort;
      }
    }
    for (const d of svc) {
      const x = d.x;
      // A BALLOON NOT REPAID is a default every month it stays unpaid, whether
      // or not the coupon keeps arriving: the clock runs on the principal.
      if (x.balloonM !== undefined && !missed.has(x)) {
        x.arrearsMs += 1;
        x.balance = Math.max(0, Math.round(x.balance - d.amort));
        x.status = "default";
        continue;
      }
      if (missed.has(x)) {
        // THE CAUSE LEDGER: the month a named owner first misses, and why —
        // what its buildings paid against what it owed.
        if (x.arrearsMs === 0) {
          x.whyId = why(s, {
            k: "loan.default", a: "household", aid: "h:" + x.holderId, name: x.holder, bbl: x.bbl,
            n: { owedMo: Math.round(d.interest + d.amort), buildingNoiMo: Math.round(x.noiYr / 12), holderCfadsMo: Math.round((flow?.cfads ?? 0) / 12), holderDueMo: Math.round(due), balance: x.balance },
            t: `${x.holder} missed its payment to ${x.lender} · its buildings clear ${usdK((flow?.cfads ?? 0) / 12)}/mo before debt against ${usdK(due)}/mo owed · cash gone`,
          });
        }
        x.arrearsMs += 1;
        x.balance = Math.round(x.balance + d.interest);   // unpaid interest is still owed
      } else {
        x.arrearsMs = 0;
        x.balance = Math.max(0, Math.round(x.balance - d.amort));
      }
      const own = x.noiYr / 12 / Math.max(1, d.interest + d.amort);
      x.status = x.arrearsMs >= 1 ? "default" : (x.extensions ?? 0) > 0 || (x.klass !== "land" && own < 1) ? "watch" : "current";
    }
    cash[id] = Math.round(Math.max(0, Math.min(c, Math.max(flow?.cap ?? 0, 0))));
  }
  // The calendar: balloons, then the court.
  for (const x of Object.values(L)) {
    if (x.balance <= 0) { delete L[x.bbl]; continue; }
    if (x.arrearsMs >= NOTICE_M + FORECLOSE_M) {
      foreclose(s, x, resolveRec(parcels, s, x.bbl)?.address ?? x.bbl);
      continue;
    }
    if (s.month >= x.maturityM) rollBalloon(s, x);
  }
}

/** THE BALLOON: the best takeout in town, or the gap paid, or an extension, or a default. */
function rollBalloon(s: GameState, x: StreetLoan) {
  const cash = (s.holderCash ??= {});
  // A loan in arrears on its coupon is nobody's takeout; one whose only
  // default is the balloon itself keeps ringing round every month.
  if (x.arrearsMs === 0 || x.balloonM !== undefined) {
    const qs = deskQuotes(s, x.value, x.noiYr, { klass: x.klass });
    const full = qs.find((q) => q.principal >= x.balance * 0.98);
    const most = [...qs].sort((a, b) => b.principal - a.principal)[0];
    const gap = most ? x.balance - most.principal : Infinity;
    const take = full ?? (most && (cash[x.holderId] ?? 0) >= gap ? most : undefined);
    if (take) {
      if (!full) { cash[x.holderId] = Math.round((cash[x.holderId] ?? 0) - gap); x.balance = Math.round(x.balance - gap); }
      const p = productById(take.product);
      x.lender = take.lender; x.product = take.product; x.ratePct = take.ratePct;
      x.originM = s.month; x.maturityM = s.month + take.termM; x.extensions = 0;
      x.arrearsMs = 0; delete x.balloonM;
      if (p?.floating) x.spread = +(take.ratePct - shortIndexOf(s.econ)).toFixed(2); else delete x.spread;
      x.status = "current";
      return;
    }
    // A desk extends paper whose building still pays its coupon rather than
    // file on it — twice, a year at a time, at its own price today.
    const coupon = x.balance * x.ratePct / 100;
    if (x.balloonM === undefined && x.noiYr >= coupon && (x.extensions ?? 0) < 2) {
      x.extensions = (x.extensions ?? 0) + 1;
      x.maturityM = s.month + 12;
      x.ratePct = bankRatePct(s.econ.indexRate, liveSpread(s.econ.deskPx?.[x.lender], productById(x.product)?.spread ?? 2, x.klass === "land" ? "land" : "income"));
      x.status = "watch";
      return;
    }
  }
  // No takeout, no extension: the balloon is not paid, and the clock starts.
  if (x.balloonM === undefined) {
    x.balloonM = s.month; x.arrearsMs = Math.max(1, x.arrearsMs);
    const most = deskQuotes(s, x.value, x.noiYr, { klass: x.klass }).reduce((a, q) => Math.max(a, q.principal), 0);
    x.whyId = why(s, {
      k: "loan.default", a: "household", aid: "h:" + x.holderId, name: x.holder, bbl: x.bbl,
      n: { balance: x.balance, bestTakeout: Math.round(most), value: x.value, noiYr: x.noiYr, holderCash: Math.round(cash[x.holderId] ?? 0) },
      t: `${x.holder}'s balloon with ${x.lender} came due unpaid · owes ${usdK(x.balance)} · the most any desk will lend on it is ${usdK(most)} · building worth ${usdK(x.value)}`,
    });
  }
  x.status = "default";
  x.maturityM = s.month + 1;
}

/**
 * One month of the private owners' mortgages. Runs before the desks close
 * their books (tickLenders), so the statement counts this month's payments.
 */
export function tickStreetLoans(s: GameState, parcels: ParcelTable) {
  if (!s.lenders?.length) return;
  if (!s.streetLoans || s.month % 3 === 0) readHolders(s, parcels);
  payMonth(s, parcels);
}
