// THE MORTGAGE RECORD — every loan in this town, written against a deed.
//
// The banks had balance sheets and the balance sheets had no insides. A
// lender carried `book: $3.4B` and `delinquent: 2.9%` and not one loan you
// could point at — so "open its books and see it coming" meant reading two
// aggregates, the note desk conjured a face value out of thin air the month
// it decided to sell, and the player asking "which properties has this bank
// lent against?" had no answer anywhere in the state.
//
// This is the answer. Every rival-owned building carrying debt gets a row on
// the public record: whose loan it is, which desk wrote it, the balance, the
// coupon, the maturity, and what the building appraised for the day it was
// written — which is the number that makes "LTV then vs. LTV now" a readable
// fact instead of a vibe. The player's own loans and the construction book
// already exist on Holding/Development; together the three are a full
// statement for every desk in town.
//
// IT IS A PROJECTION, NOT A SECOND SIMULATION. Rivals carry one aggregate
// `debt` number, and that stays true: the record allocates the firm's TERM
// debt (its construction balances sit on the record under their own desk)
// across its financed buildings by value and reconciles every month, so it
// can never disagree with the street table. Statuses come off the borrower —
// a firm eight months into a squeeze has every loan on watch, which is what
// cross-default means. Nothing here draws on the RNG stream.
//
// IT IS NO LONGER DECORATION. The desks' books are counted off this record
// (loanbook.ts): a row's balance is on its lender's balance sheet, a row in
// workout is on its lender's delinquency line, and a firm's failure is
// charged to the desks its rows name. So the desk a row names is placed under
// the two limits a real desk lends under — one borrower's share of the book,
// and the capital to carry a bigger one (placeLoan) — and only the borrower's
// first call among the desks is hashed. BANKING.md has the handoff for making
// these rows originated rather than projected.
import type { ParcelTable } from "@/data/types";
import type { CityLoan, GameState, Rival } from "./types";
import { assetValue, resolveRec } from "./value";
import { assetGrade } from "./rivals";
import { cityLoanBook, deskTotals } from "./loanbook";
import { singleNameCap } from "./debt";
import { targetCapital } from "./lenders";

/** Deterministic 0..1 from a string — the record must not perturb the RNG. */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * WHO WROTE THIS LOAN. The same logic a borrower uses, run backwards: small
 * checks go to the hometown bank, big well-kept buildings to the life company,
 * the biggest paper to the conduit, tired buildings to the fund, and the
 * regional takes the middle of everything — which is why the regional is the
 * one a property bust kills.
 */
/** Every desk, in the order this deed's borrower would call them. */
function lenderPreference(bbl: string, value: number, worn: boolean): string[] {
  const h = hash01(bbl + ":led");
  const first = worn && h < 0.45 ? "Cordage Debt Partners"
    : value < 4_000_000 ? (h < 0.62 ? "First Harbor Bank" : "Alden Savings & Trust")
    : value > 14_000_000
      ? (h < 0.38 ? "Meridian Street Capital" : h < 0.72 ? "Pelican Life Insurance" : "Alden Savings & Trust")
      : (h < 0.55 ? "Alden Savings & Trust" : h < 0.78 ? "Pelican Life Insurance" : "First Harbor Bank");
  const rest = value > 14_000_000
    ? ["Pelican Life Insurance", "Meridian Street Capital", "Alden Savings & Trust", "Cordage Debt Partners", "First Harbor Bank"]
    : ["Alden Savings & Trust", "First Harbor Bank", "Pelican Life Insurance", "Cordage Debt Partners", "Meridian Street Capital"];
  return [first, ...rest.filter((x) => x !== first)];
}

/**
 * THE DESK THAT WILL ACTUALLY TAKE THE LOAN. The borrower's first call is the
 * hashed preference above; a desk already holding its single-name limit
 * against this firm (`singleNameCap` — the same limit the player's quotes
 * face) passes, and the loan goes to the next desk with room. Without it the
 * record put a third of the regional's book on one street firm, and the day
 * that firm failed it took the regional with it — not because a bank made a
 * bad loan but because the record ignored the limit that stops a bank making
 * that one.
 *
 * AND A DESK THAT CANNOT GROW ITS BOOK DOES NOT WRITE THE LOAN. A new loan is
 * new book, and a desk's book can only be as big as its capital carries at its
 * own target (`capital / target`); a desk at its target with no headroom sends
 * the borrower down the street, which is how a crowded desk loses business in
 * life. The opening record is the exception — those mortgages already exist and
 * were inside the stated books the city opened with — and it only asks that a
 * desk's named paper stay within three quarters of that book. If no desk has
 * room the loan goes to whichever has the most, which is what a syndicate is.
 */
function placeLoan(s: GameState, led: Record<string, CityLoan>, obligorId: string, bbl: string, value: number, worn: boolean, estBalance: number, opening: boolean,
  /** New paper placed this tick, by desk — rows are written before their balances are reconciled. */
  placedThisMonth: Record<string, number>): string {
  const pref = lenderPreference(bbl, value, worn);
  const exposure: Record<string, number> = {};
  const onDesk: Record<string, number> = {};
  for (const x of Object.values(led)) {
    onDesk[x.lender] = (onDesk[x.lender] ?? 0) + x.balance;
    if (x.obligorId === obligorId) exposure[x.lender] = (exposure[x.lender] ?? 0) + x.balance;
  }
  let best = pref[0], bestRoom = -Infinity;
  for (const name of pref) {
    const l = s.lenders?.find((x) => x.name === name);
    if (!l) continue;
    if (l.failedM !== undefined) continue;   // a receiver writes nothing
    const nameRoom = l.book * singleNameCap(l.kind) - (exposure[name] ?? 0);
    const deskRoom = opening
      ? l.book * 0.75 - (onDesk[name] ?? 0) - (placedThisMonth[name] ?? 0)
      : l.capital / Math.max(0.01, targetCapital(l.name)) - l.book - (placedThisMonth[name] ?? 0);
    const room = Math.min(nameRoom, deskRoom);
    if (room >= estBalance) { placedThisMonth[name] = (placedThisMonth[name] ?? 0) + estBalance; return name; }
    if (room > bestRoom) { bestRoom = room; best = name; }
  }
  placedThisMonth[best] = (placedThisMonth[best] ?? 0) + estBalance;
  return best;
}


/** Is this deed's paper already outside the banking system? */
function paperElsewhere(s: GameState, bbl: string): boolean {
  return !!s.notes?.some((n) => n.bbl === bbl)
    || !!s.noteOffers?.some((o) => o.bbl === bbl)
    || !!(s.rivalNotes ?? []).some((x) => x.bbl === bbl);
}

/** One month of keeping the record true. Runs after the street, before the note desk. */
export function tickLedger(s: GameState, parcels: ParcelTable) {
  if (!s.cityLoans) s.cityLoans = {};
  const placed: Record<string, number> = {};
  const led = s.cityLoans;
  const live = (s.rivals ?? []).filter((r) => r.failedM === undefined);
  const owner: Record<string, Rival> = {};
  for (const r of live) for (const b of r.bbls) owner[b] = r;

  // A deed that changed hands, a borrower that died, or paper that left the
  // banks for the note market comes off the record.
  for (const bbl of Object.keys(led)) {
    const o = owner[bbl];
    if (!o || o.id !== led[bbl].obligorId || paperElsewhere(s, bbl)) delete led[bbl];
  }

  for (const r of live) {
    // The record of this firm's mortgages, written where missing.
    if (r.debt > 1000) {
      for (const bbl of r.bbls) {
        if (led[bbl] || paperElsewhere(s, bbl)) continue;
        const rec = resolveRec(parcels, s, bbl);
        if (!rec || rec.class === "land" || rec.bldgArea <= 0) continue;
        const grade = assetGrade(r, rec);
        const v = assetValue(rec, s.econ, grade);
        if (v < 400_000) continue;
        const h = hash01(bbl + ":" + r.id);
        // At campaign start the record is backdated — the town did not take
        // out all its mortgages the day you arrived.
        const originM = s.month <= 1 ? -Math.round(h * 96) : s.month;
        // What this deed will carry: the firm's leverage on its own book.
        const est = (r.aum ?? 0) > 0 ? v * Math.min(0.9, r.debt / r.aum!) : v * 0.6;
        led[bbl] = {
          bbl,
          lender: placeLoan(s, led, r.id, bbl, v, grade === "worn" || grade === "obsolete", est, s.month <= 1, placed),
          obligorId: r.id,
          balance: 0,   // reconciled below
          ratePct: +(s.econ.indexRate + 1.6 + 1.6 * hash01(bbl + ":cpn")).toFixed(2),
          originM,
          maturityM: originM + 60 + Math.round(60 * hash01(bbl + ":mat")),
          origValue: v,
          klass: rec.class,
          status: "current",
        };
      }
    }
    // RECONCILE: the rows always sum to the firm's actual debt, weighted by
    // what each building appraised for at origination. The street table and
    // the statement can never tell two stories.
    const rows = r.bbls.map((b) => led[b]).filter(Boolean) as CityLoan[];
    if (!rows.length) continue;
    const wSum = rows.reduce((a, x) => a + x.origValue, 0);
    // TERM DEBT, NOT ALL DEBT. A firm's `debt` includes the construction
    // balances on its open jobs, and those already sit on the record under
    // their own desk (`cityJobs[].lender`). Allocating the whole number across
    // the mortgages counted every crane twice — once as construction paper and
    // once spread over the firm's finished buildings — the moment anything
    // summed the two (loanbook.ts does). `chargeSponsorFailure` has always
    // split it this way; the record now agrees with it.
    let jobDebt = 0;
    for (const j of s.cityJobs ?? []) if (j.firmId === r.id) jobDebt += j.debt ?? 0;
    const debt = Math.max(0, Math.round(r.debt - jobDebt));
    for (const x of rows) x.balance = Math.round(debt * (x.origValue / Math.max(1, wSum)));

    // Status is the borrower's, because that is what cross-default means.
    const ltv = (r.aum ?? 0) > 0 ? r.debt / r.aum! : 0;
    const status: CityLoan["status"] =
      (r.stressMs ?? 0) >= 6 ? "workout"
        : (r.stressMs ?? 0) > 0 || ltv > 0.85 ? "watch" : "current";
    for (const x of rows) {
      x.status = status;
      // A balloon that comes due on a solvent borrower rolls at today's rate —
      // which is why the record's coupons follow the rate era instead of
      // fossilising at whatever 2000 looked like.
      if (s.month >= x.maturityM && status === "current") {
        const rec = resolveRec(parcels, s, x.bbl);
        x.originM = s.month;
        x.maturityM = s.month + 60 + Math.round(60 * hash01(x.bbl + ":m" + s.month));
        x.ratePct = +(s.econ.indexRate + 1.6 + 1.6 * hash01(x.bbl + ":c" + s.month)).toFixed(2);
        if (rec) x.origValue = assetValue(rec, s.econ, assetGrade(r, rec));
      }
    }
  }

  // WHAT EACH DESK IS HOLDING IN THIS TOWN, BY CLASS — the number the quote
  // desk checks before it adds another office loan to an office book. Yours,
  // the street's, and the construction paper, counted the same way.
  // Read off the one loan book every other desk test reads, so the class
  // test and the single-name test cannot count different loans. (The street's
  // construction jobs were missing from this sum; the facility and the line
  // carry no single class and stay out of it.)
  const by = deskTotals(cityLoanBook(s, parcels));
  for (const l of s.lenders ?? []) {
    l.classBook = {};
    for (const [k, v] of Object.entries(by[l.name]?.byClass ?? {})) if (v > 0) l.classBook[k] = Math.round(v);
  }
}
