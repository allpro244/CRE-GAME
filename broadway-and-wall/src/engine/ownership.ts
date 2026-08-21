/**
 * EVERY DEED IN THIS TOWN, AND THE ACCOUNTS BEHIND IT.
 *
 * There were two kinds of owner in this game and they were sealed off from
 * each other. `rivals.ts` held a few dozen OPERATING FIRMS with balance sheets
 * you could open — cash, debt, leverage, dry powder, what they own, what they
 * are worth. `owners.ts` held a register of PRIVATE LANDLORDS with names, a
 * memory of how you had treated them, and no accounts at all. Between them
 * they owned the city, and the split ran straight through the player's view of
 * it: click a tower held by Kestrel Capital and you got a balance sheet; click
 * the identical tower next door and you got a sentence about a family.
 *
 * That is a strange place to draw a line, because it is not a line the
 * business draws. The two brothers who own eleven buildings and no office are
 * not less legible than a fund — they are MORE legible, because everyone on
 * the street knows what they paid, who wrote the paper and roughly when it
 * comes due. What made them opaque here was an implementation detail: one set
 * was simulated and the other was decoration.
 *
 * SO THIS FILE IS THE MERGE, and it is a merge of the STATEMENT rather than of
 * the behaviour. Every named owner in the city — firm or family — now answers
 * the same three questions in the same words:
 *
 *   WHAT DO THEY OWN, marked at the same appraisal the player is shown on the
 *   parcel card. There is no second opinion of value hiding behind a private
 *   owner's door; `assetValue` at `gradeOf` is what the book is worth, exactly
 *   as it is for a rival and for you.
 *
 *   WHAT DO THEY OWE. This is the one quantity that did not exist for a
 *   private holder, and it did not exist as an omission rather than a
 *   decision: `lenders.ts` sizes every desk in town off SYSTEM_LTV, "the
 *   aggregate loan-to-value of a whole commercial property market", so the
 *   mortgages on the private stock have been inside the banks' books since the
 *   first month of every campaign. What was missing was any statement of WHOSE
 *   they were. `holderDebt` below is that statement, and it is derived rather
 *   than stored for the same reason the register itself is.
 *
 *   WHAT DOES IT EARN. One income statement, the same lines the player's own
 *   Books page runs — NOI, leasing, capital, overhead, interest, amortisation
 *   — computed from one set of expressions for firms and families alike. A
 *   competitor whose statement is built differently from yours is not a
 *   competitor you can read.
 *
 * WHAT IS DELIBERATELY NOT MERGED: who is in the market. A firm has appetite,
 * dry powder and a credit window, and it bids; a private holder mostly does
 * not, which is why `owners.ts` warned that conflating the two "would put four
 * hundred more bidders in every auction". Legibility and competition are
 * different things, and this file only unifies the first. `operator` on the
 * view below is the flag that says which side of that a name sits on, and it
 * is a FACT ABOUT THEM rather than a difference in kind — which is the whole
 * point of the merge.
 *
 * NOTHING HERE TOUCHES THE RNG STREAM and nothing here is stored. Every
 * derived quantity is hashed off the deed, so the accounts are identical on
 * every load of the same town and adding a line to this file cannot re-roll
 * anybody's century.
 */
import type { ParcelTable } from "@/data/types";
import type { GameState, Rival, RivalStyle, SellerKind } from "./types";
import { START_YEAR } from "./types";
import { assetValue, noiAfterTaxYr, resolveRec } from "./value";
import { CARE, gradeOf, markRival, ownerOf } from "./rivals";
import { NON_PAYROLL_GA_SHARE } from "./staff";
import { isCivicLand } from "./demand";
import type { Holder } from "./owners";
import { holderOf, isCold, relOf, standingWith } from "./owners";

/** Deterministic 0..1 from a string. Never touches the RNG stream. */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

// ------------------------------------------------------------------ the shapes

/** What an owner is worth, and how much of it is theirs. */
export interface OwnerBalance {
  /** The book, marked at the same appraisal the parcel card shows. */
  assets: number;
  debt: number;
  cash: number;
  /** assets − debt + cash. The number the league table ranks on. */
  equity: number;
  ltv: number;
}

/**
 * WHAT THE BOOK EARNS IN A YEAR AT TODAY'S MARKS — a run-rate, not a history.
 *
 * Said plainly because the distinction matters when you are reading somebody
 * else's accounts: this is what their portfolio produces if nothing changes,
 * which is the statement a broker would put in front of you. It is not what
 * they actually banked last year, and for a firm short of cash the two come
 * apart in a specific and readable way — the capital line is the first thing
 * cut, so a firm whose ACTUAL capex is far under this number is a firm whose
 * buildings are sliding. The street table prints both for exactly that reason.
 */
export interface OwnerIncome {
  /** After operating costs, management and property tax. */
  noi: number;
  leasing: number;
  capex: number;
  ga: number;
  interest: number;
  amort: number;
  /** Free cash flow to the owner, after everything above. */
  net: number;
}

export interface OwnerView {
  id: string;
  name: string;
  /** How they behave at a table — the same kind the negotiation reads. */
  kind: SellerKind;
  /** Present only for an operating firm. */
  style?: RivalStyle;
  /**
   * Do they work the tape? An operator bids, borrows to buy, and can fail; a
   * holder owns. It is a fact about the name, not a different species — both
   * sides of it produce the same two statements below.
   */
  operator: boolean;
  /** Public land the city has taken. Owned, legible, and not for sale. */
  publicOwner?: boolean;
  /** One line a broker would give you in the car on the way over. */
  note: string;
  /** The decade they got into this town. */
  since: number;
  book: string[];
  sheet: OwnerBalance;
  income: OwnerIncome;
  /** Where you stand with them, in words. */
  standing: string;
  /**
   * ...and in counts. A firm files what has passed between you under
   * `s.street` and a family under `s.holderRel`, in different words for the
   * same three events — you traded, they beat you, or you insulted them. One
   * shape here, so a panel does not need to know which register a name came
   * out of to say where you stand with it.
   */
  rel: { deals: number; offences: number; beats: number };
  cold: boolean;
  /** Present for a firm the receiver is winding up. */
  failedM?: number;
  stressed?: boolean;
}

// ------------------------------------------------------------------ the debt
//
// HOW MUCH A PRIVATE LANDLORD OWES, AND WHY IT IS NOT A GUESS.
//
// Three facts about the world, and the number falls out of them.
//
// FIRST, WHO BORROWS. The advance a lender writes is a fact about the
// borrower, not about the building: an insurance company's local book runs
// conservative because the mandate says so, a partnership that bought in
// together is levered because that is why partnerships exist, a builder who
// kept a few carries the construction paper he rolled into a mortgage, and a
// family that has owned the corner since the war has paid it off. These are
// ordinary commercial advances — 40-65% — and they sit BELOW the 55% aggregate
// in `lenders.ts` for the same reason that comment gives: "plenty of buildings
// are owned free and clear".
//
// SECOND, HOW MANY ARE CLEAR. Free-and-clear ownership is the single biggest
// thing that separates private commercial holdings from institutional ones,
// and it is overwhelmingly a function of how long it has been held. A family
// three generations into a building has no mortgage on it; the same family's
// 1994 purchase does.
//
// THIRD, PAPER ROLLS. Commercial mortgages are five-to-ten-year notes on a
// twenty-five-year amortisation schedule, refinanced at each maturity, so at
// any moment a town's private paper is uniformly spread across its cycle —
// some written last year at the full advance, some fifteen years into their
// schedule and half paid down. That spread is what makes a register have
// texture: two identical buildings on the same block, one of them financeable
// and one of them not.
const HOLDER_ADVANCE: Record<SellerKind, { ltv: number; clear: number }> = {
  // Old family money pays its mortgages off and does not take new ones.
  local: { ltv: 0.45, clear: 0.42 },
  // An estate cannot refinance while probate runs, so what is on it is what
  // was on it the day the owner died, and it has been amortising ever since.
  estate: { ltv: 0.40, clear: 0.48 },
  // A committee's mandate sets the advance, and it is disciplined.
  institution: { ltv: 0.52, clear: 0.16 },
  // Partnerships lever. It is generally why there is a partnership.
  partnership: { ltv: 0.60, clear: 0.14 },
  // A builder's mortgage is the construction loan he rolled into a term note.
  developer: { ltv: 0.63, clear: 0.10 },
  // A servicer holding a file has no mortgage on it; it IS the mortgage.
  lender: { ltv: 0, clear: 1 },
};

/** Commercial amortisation, in months. Twenty-five years is the convention. */
const AMORT_M = 300;
/** How long a note runs before it rolls. Five to ten years is the market. */
const TERM_M = 96;

/**
 * The note against one deed today: what is left of it, and what it costs.
 *
 * Priced the way `ledger.ts` prices the street's paper — index plus a spread
 * hashed off the deed — because a private mortgage and a firm's mortgage are
 * written by the same desks in the same town, and two expressions for the cost
 * of borrowing against a building is exactly the fault CLAUDE.md calls the
 * same quantity with two answers.
 */
function deedNote(
  s: GameState, h: Holder, bbl: string, value: number, dirt: boolean,
): { balance: number; ratePct: number; amortYr: number } {
  const none = { balance: 0, ratePct: 0, amortYr: 0 };
  if (value <= 0) return none;
  let adv = HOLDER_ADVANCE[h.kind] ?? HOLDER_ADVANCE.local;
  if (adv.ltv <= 0) return none;
  // A LENDER DOES NOT ADVANCE AGAINST A VACANT LOT ON AN INCOME TEST — the
  // same sentence `markRival` carries about a developer's land bank, and it
  // has to be true here for the same reason. Financing dirt at an income
  // building's advance put a mortgage on 479 vacant lots that earn nothing to
  // service it, and the register read as a city of land bankers quietly going
  // broke. Land is bought for cash far more often than not, precisely BECAUSE
  // it does not produce the income a loan is sized against; what paper there
  // is, is short, small and personally guaranteed.
  if (dirt) adv = { ltv: Math.min(adv.ltv, 0.35), clear: Math.max(adv.clear, 0.70) };
  // Held longer than a generation and it is very likely clear; bought in the
  // last cycle and it is very likely not. `since` is the holder's own vintage.
  const held = Math.max(0, START_YEAR + Math.floor(s.month / 12) - h.since);
  // Tenure pays a mortgage down; it does not make an owner stop borrowing. The
  // first cut let it add 38 points, which took an old family to four buildings
  // in five owned outright. Capped at 22, the private register measures a 20%
  // aggregate advance and the whole city — operators included, and they run
  // levered — measures 22.6%. That is the right ORDER for the quantity: what
  // is written on a single commercial loan is 60-75%, and what the aggregate
  // of a whole market's mortgage debt comes to against the value of the
  // property behind it is a quarter of it, because a large minority of
  // buildings carry no mortgage at all.
  //
  // AND IT DOES NOT AGREE WITH THE BANKS, which is a finding rather than a
  // bug in this file, so it is written down instead of tuned away. `initLenders`
  // sizes every desk in town off SYSTEM_LTV = 0.55 on exactly this reasoning —
  // "individual loans are written at 60-75%, plenty of buildings are owned
  // free and clear, and the two together land near here". Nothing in the world
  // had to honour that until the deeds could be counted, and counted, they
  // come to less than half of it. Moving SYSTEM_LTV would halve every bank in
  // this city and is a decision about the credit system, not about a register;
  // `pnpm ownership` prints both figures every run so that whoever takes that
  // decision takes it on purpose.
  const clearOdds = Math.min(0.82, adv.clear + Math.min(0.22, held * 0.0055));
  if (hash01(bbl + ":clr") < clearOdds) return none;
  const ltv = adv.ltv * (0.86 + 0.28 * hash01(bbl + ":adv"));
  const ratePct = +(s.econ.indexRate + 1.6 + 1.6 * hash01(bbl + ":cpn")).toFixed(2);
  const i = ratePct / 100 / 12;
  // Where this note sits in its own term. Uniform across the roll cycle, which
  // is what "the town's paper is spread across its cycle" means arithmetically.
  const into = Math.round(TERM_M * hash01(bbl + ":vin"));
  const principal = value * ltv;
  const bal = (k: number) => {
    if (i <= 0) return principal * Math.max(0, 1 - k / AMORT_M);
    const g = Math.pow(1 + i, AMORT_M);
    return principal * (g - Math.pow(1 + i, k)) / (g - 1);
  };
  const balance = Math.max(0, bal(into));
  return { balance, ratePct, amortYr: Math.max(0, balance - Math.max(0, bal(into + 12))) };
}

// ---------------------------------------------------------------- the accounts
//
// ONE SET OF EXPRESSIONS FOR EVERY OWNER IN TOWN.
//
// Each line below already existed somewhere in this engine and was calibrated
// there; what is new is that a family office and a private-equity fund are now
// run through the same ones. Where a line has a source it is named, because a
// statement assembled out of numbers nobody can trace is decoration with a
// dollar sign in front of it.

/**
 * HOW HARD EACH KIND OF PRIVATE OWNER WORKS THEIR BUILDINGS — the register's
 * half of `CARE` in rivals.ts, which says the same thing about firms.
 *
 * An institution runs a leasing team and a capital plan because the mandate is
 * written that way. An estate in probate spends nothing on anything, because
 * no executor authorises a roof for a building the heirs are arguing about.
 * The rest sit between, and the reason it matters is that it is where the
 * value-add stock in any city comes from: an under-managed building in a good
 * location is a deal, and this is who owns it.
 */
const HOLDER_CARE: Record<SellerKind, { lease: number; capex: number; admin: number }> = {
  institution: { lease: 1.15, capex: 1.20, admin: 6_000 },
  developer: { lease: 1.0, capex: 0.85, admin: 3_000 },
  partnership: { lease: 0.9, capex: 0.8, admin: 2_500 },
  local: { lease: 0.85, capex: 0.95, admin: 1_200 },
  estate: { lease: 0.6, capex: 0.45, admin: 2_000 },
  lender: { lease: 0.5, capex: 0.3, admin: 3_500 },
};

/**
 * The statement, from the three inputs every owner has: what the book is worth,
 * what it earns, and what is owed against it.
 *
 * `care` scales the two lines that are a CHOICE rather than a bill — leasing
 * and capital — and `ga` is the overhead, passed in because the two kinds of
 * owner carry genuinely different shapes of it (see the callers).
 */
function statement(
  assets: number, noi: number,
  debt: { interest: number; amort: number },
  care: { lease: number; capex: number },
  ga: number, land = 0,
): OwnerIncome {
  // 18bps of gross assets a year on leasing and 30bps on the capital plan —
  // the same two rates the street pays itself in tickAssetManagement, and on
  // the same base: the part of the book that is buildings.
  const built = Math.max(0, assets - land);
  const leasing = 0.0018 * built * care.lease;
  const capex = 0.003 * built * care.capex;
  const net = noi - leasing - capex - ga - debt.interest - debt.amort;
  return {
    noi: Math.round(noi), leasing: Math.round(leasing), capex: Math.round(capex),
    ga: Math.round(ga), interest: Math.round(debt.interest), amort: Math.round(debt.amort),
    net: Math.round(net),
  };
}

/**
 * A PRIVATE HOLDER'S ACCOUNTS, derived from the deeds and nothing else.
 *
 * Cash is the one line with no source to point at, so it is stated for what it
 * is: working capital, a few months of net income, sized by who they are. An
 * estate accumulates it because nobody will authorise spending it; a developer
 * runs thin because idle cash is the one thing a builder cannot justify. It is
 * not a war chest and it is not meant to be read as one — a private holder is
 * not bidding on anything, which is what `operator: false` says on the view.
 */
const CASH_MONTHS: Record<SellerKind, number> = {
  estate: 14, local: 9, institution: 7, partnership: 6, developer: 3, lender: 2,
};

export function holderAccounts(
  s: GameState, parcels: ParcelTable, h: Holder, book: string[],
): { sheet: OwnerBalance; income: OwnerIncome } {
  let assets = 0, noi = 0, debt = 0, interest = 0, amort = 0, land = 0;
  for (const bbl of book) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const grade = gradeOf(s, rec);
    const v = assetValue(rec, s.econ, grade);
    assets += v;
    noi += noiAfterTaxYr(rec, s.econ, grade, v);
    const dirt = rec.class === "land" || !(rec.bldgArea > 0);
    if (dirt) land += v;
    const note = deedNote(s, h, bbl, v, dirt);
    debt += note.balance;
    interest += note.balance * note.ratePct / 100;
    amort += note.amortYr;
  }
  const care = HOLDER_CARE[h.kind] ?? HOLDER_CARE.local;
  // WHAT IT COSTS TO ADMINISTER SOMEBODY ELSE'S BUILDINGS, and the shape of it
  // is the whole argument. The first cut of this file charged every private
  // owner a share of the player's $60,000 fixed base — "the audit, the
  // lawyers, the insurance programme, the rent on the office itself" (sim.ts)
  // — which is a description of a FIRM. Measured, it put 88 of 225 owners
  // cash-flow negative and 44 of those held under a million and a half: that
  // is not a market of failing landlords, it is an office charged to people
  // who do not have one. A private owner's overhead is bookkeeping, and
  // bookkeeping is per BUILDING — a Schedule E on a shopfront costs a few
  // hundred dollars and an institution's local book is audited line by line.
  //
  // Sub-linear in the count for the reason sim.ts already gives about the
  // player's: "the tenth building is cheaper to run than the first". The
  // proportional half is the player's own rate, unchanged, because at scale
  // both kinds of owner are paying for the same thing.
  const ga = care.admin * Math.pow(Math.max(1, book.length), 0.7) * s.econ.costIdx
    + 0.0028 * assets * NON_PAYROLL_GA_SHARE;
  // THE DIRT IS CARRIED SEPARATELY, for the reason `markRival` carries it
  // separately: there is no roof to replace on a vacant lot and no space in it
  // to let, so charging a capital plan and a leasing budget against a land
  // bank invents two costs that nobody in the business pays.
  const income = statement(assets, noi, { interest, amort }, care, ga, land);
  const months = CASH_MONTHS[h.kind] ?? 6;
  // Working capital cannot be negative and cannot be a war chest: a book that
  // loses money runs on an overdraft, which is a story the register does not
  // tell, so the floor is a month of the property tax rather than a hole.
  const cash = Math.max(0, Math.round((income.net > 0 ? income.net : Math.max(0, income.noi) * 0.1) * months / 12));
  return {
    sheet: {
      assets: Math.round(assets), debt: Math.round(debt), cash,
      equity: Math.round(assets - debt + cash),
      ltv: assets > 0 ? debt / assets : 0,
    },
    income,
  };
}

/** A firm's accounts, on the same statement. */
export function rivalAccounts(
  s: GameState, parcels: ParcelTable, r: Rival,
): { sheet: OwnerBalance; income: OwnerIncome } {
  const m = markRival(s, parcels, r);
  const care = CARE[r.style];
  // A firm's debt service is the one line it does not derive: the balance and
  // the rate are on its own record. Priced the way the street table prices it
  // — index plus 1.9 on a thirty-year schedule — so the drawer and the
  // statement cannot disagree about what a firm pays to borrow.
  const interest = r.debt * (s.econ.indexRate + 1.9) / 100;
  const amort = r.debt / 30;
  // A FIRM DOES HAVE AN OFFICE, so it pays the player's line as written: the
  // fixed base plus the proportional load, because that is what the player is
  // charged for running the same kind of shop and a league table only works if
  // both sides are measured the same way.
  const ga = 60_000 * s.econ.costIdx + 0.0028 * m.aum * NON_PAYROLL_GA_SHARE;
  const income = statement(m.aum, m.noiYr, { interest, amort },
    { lease: care.lease, capex: care.capex }, ga, m.landV);
  return {
    sheet: {
      assets: Math.round(m.aum), debt: Math.round(r.debt), cash: Math.round(r.cash),
      equity: Math.round(m.aum - r.debt + r.cash),
      ltv: m.ltv,
    },
    income,
  };
}

// ------------------------------------------------------------------ the index
//
// WHO OWNS WHAT, IN ONE PASS.
//
// `holdingsOf` in owners.ts answers this for a single holder by walking the
// whole deed table, which is correct and is O(N) per name — fine for a parcel
// card and quadratic for a register that lists two hundred of them. The panel
// that came before this file already knew that and hand-rolled a single pass;
// so does this, once, and everything reads the result.
//
// KEYED ON AN EPOCH RATHER THAN ON THE STATE, because state is cloned on every
// action and a per-object cache would never hit. Deeds move when the player
// buys or sells, when a firm does, or when the city takes a lot — so the epoch
// is the month plus the two deed counts, which changes exactly when the answer
// does and costs one walk of two small arrays to compute.
interface OwnerIndex { books: Map<string, string[]>; rivals: Map<string, Rival> }
const INDEX = new WeakMap<ParcelTable, Map<string, OwnerIndex>>();

function epochOf(s: GameState): string {
  const rs = s.rivals ?? [];
  let deeds = 0;
  for (const r of rs) deeds += r.bbls.length;
  return `${s.seed}|${s.month}|${Object.keys(s.holdings).length}|${rs.length}|${deeds}`
    + `|${Object.keys(s.civicLand ?? {}).length}`;
}

export function ownerIndex(s: GameState, parcels: ParcelTable): OwnerIndex {
  let byEpoch = INDEX.get(parcels);
  if (!byEpoch) { byEpoch = new Map(); INDEX.set(parcels, byEpoch); }
  const key = epochOf(s);
  const hit = byEpoch.get(key);
  if (hit) return hit;
  const books = new Map<string, string[]>();
  const rivals = new Map<string, Rival>();
  for (const r of s.rivals ?? []) {
    rivals.set(r.id, r);
    if (r.bbls.length) books.set(r.id, [...r.bbls]);
  }
  for (const bbl of Object.keys(parcels)) {
    if (s.holdings[bbl]) continue;
    const h = holderOf(s, parcels, bbl);
    if (!h) continue;
    const cur = books.get(h.id);
    if (cur) cur.push(bbl); else books.set(h.id, [bbl]);
  }
  const idx = { books, rivals };
  // A handful of epochs is all anybody looks at — the current month and
  // whatever a panel is mid-render against. Anything older is dead weight.
  if (byEpoch.size > 3) byEpoch.clear();
  byEpoch.set(key, idx);
  return idx;
}

// ------------------------------------------------------------------ the view

const PUBLIC_NOTE = "Taken by the city. Public land is owned, recorded and not for sale — "
  + "there is no counterparty here to negotiate with.";

function viewOfRival(s: GameState, parcels: ParcelTable, r: Rival, book: string[]): OwnerView {
  const { sheet, income } = rivalAccounts(s, parcels, r);
  const t = s.street?.[r.id];
  const parts = [
    t?.deals ? `${t.deals} deal${t.deals === 1 ? "" : "s"} done between you` : null,
    t?.beats ? `they have beaten you to ${t.beats}` : null,
    t?.insults ? `${t.insults} conversation${t.insults === 1 ? "" : "s"} you ended badly` : null,
  ].filter(Boolean);
  return {
    id: r.id, name: r.name, style: r.style, operator: true,
    kind: r.failedM !== undefined ? "lender"
      : r.style === "family" ? "local" : r.style === "developer" ? "developer" : "institution",
    note: r.spawnedFrom ? `Raised out of ${r.spawnedFrom.firmName} by ${r.spawnedFrom.personName}.` : "",
    since: START_YEAR + Math.floor(r.bornM / 12),
    book, sheet, income,
    standing: parts.length ? parts.join(" · ") : "You have never done business with them.",
    rel: { deals: t?.deals ?? 0, offences: t?.insults ?? 0, beats: t?.beats ?? 0 },
    cold: false,
    failedM: r.failedM,
    stressed: (r.stressMs ?? 0) > 0,
  };
}

function viewOfHolder(s: GameState, parcels: ParcelTable, h: Holder, book: string[]): OwnerView {
  const { sheet, income } = holderAccounts(s, parcels, h, book);
  return {
    id: h.id, name: h.name, kind: h.kind, operator: false,
    note: h.note, since: h.since, book, sheet, income,
    standing: standingWith(s, h.id),
    rel: { deals: relOf(s, h.id).deals ?? 0, offences: relOf(s, h.id).offences ?? 0, beats: 0 },
    cold: isCold(s, h.id),
  };
}

/**
 * WHO OWNS THIS DEED, with their accounts. Null only when the deed is yours —
 * your own balance sheet is the Books page, and it is the one owner in this
 * city who does not need looking up.
 *
 * There is no other null. That is the contract this file exists to hold: the
 * player can point at any parcel on the map and read the accounts of whoever
 * owns it.
 */
export function ownerAt(s: GameState, parcels: ParcelTable, bbl: string): OwnerView | null {
  if (s.holdings[bbl]) return null;
  const idx = ownerIndex(s, parcels);
  const r = ownerOf(s, bbl);
  if (r) return viewOfRival(s, parcels, r, idx.books.get(r.id) ?? [...r.bbls]);
  const h = holderOf(s, parcels, bbl);
  if (h) return viewOfHolder(s, parcels, h, idx.books.get(h.id) ?? [bbl]);
  if (isCivicLand(s, bbl)) {
    const kind = s.civicLand?.[bbl]?.kind;
    return {
      id: "city", name: "the City of Ashport", kind: "institution", operator: false,
      publicOwner: true,
      note: kind === "park" ? `${PUBLIC_NOTE} It is down for a park.` : PUBLIC_NOTE,
      since: START_YEAR, book: Object.keys(s.civicLand ?? {}),
      sheet: { assets: 0, debt: 0, cash: 0, equity: 0, ltv: 0 },
      income: { noi: 0, leasing: 0, capex: 0, ga: 0, interest: 0, amort: 0, net: 0 },
      standing: "The city is not a counterparty. Nothing here is for sale.",
      rel: { deals: 0, offences: 0, beats: 0 },
      cold: false,
    };
  }
  return null;
}

/** One owner by id, firm or family, with everything they hold. */
export function ownerById(s: GameState, parcels: ParcelTable, id: string): OwnerView | null {
  const idx = ownerIndex(s, parcels);
  const r = idx.rivals.get(id);
  if (r) return viewOfRival(s, parcels, r, idx.books.get(id) ?? [...r.bbls]);
  const book = idx.books.get(id);
  if (!book?.length) return null;
  const h = holderOf(s, parcels, book[0]);
  if (!h || h.id !== id) return null;
  return viewOfHolder(s, parcels, h, book);
}

/**
 * EVERY OWNER IN TOWN, biggest book first — the register the Owners page is.
 *
 * Firms and families in ONE list, which is the visible half of the merge. They
 * were two tables before, sorted separately, and a player who wanted to know
 * who the largest owner in the city actually was had to read both and do the
 * arithmetic themselves. Most of the time the answer is a name that never
 * bids on anything.
 */
export function allOwners(s: GameState, parcels: ParcelTable): OwnerView[] {
  const idx = ownerIndex(s, parcels);
  const out: OwnerView[] = [];
  for (const [id, book] of idx.books) {
    const r = idx.rivals.get(id);
    if (r) { out.push(viewOfRival(s, parcels, r, book)); continue; }
    const h = holderOf(s, parcels, book[0]);
    if (h && h.id === id) out.push(viewOfHolder(s, parcels, h, book));
  }
  return out.sort((a, b) => b.sheet.assets - a.sheet.assets);
}
