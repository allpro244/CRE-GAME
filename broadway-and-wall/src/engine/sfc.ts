// THE CITY'S LEDGER — STOCK-FLOW CONSISTENT (ONE_ECONOMY_PLAN.md §3, step 0).
//
// One rule: every payment leaves one agent's books and enters another's.
// `transfer` is the only way money moves here, so the sum of every balance is
// zero for ever (it opens at zero: an agent's opening cash is a deposit the
// bank owes it, booked bank -> agent). Money is CREATED only where it is in
// life: a bank lending (its balance goes further negative — the deposit it
// created), a government running a deficit funded by bonds, the rest of the
// country paying in more than it takes out. `ledgerSum` is the identity the
// whole-city conserve test asserts.
//
// Loans are a second, matched stock: what a borrower owes is exactly what
// the bank is owed. A loan's principal moves cash (lend / repay); a
// charge-off moves none — the bank's claim and the borrower's debt vanish
// together, and the loss is recorded where it lands.
//
// TWO KINDS OF ACCOUNT. The sectoral agents (households as a sector, the
// city, the bank, the landlords, the rest of the country, the market) are
// named by string. The many small agents — firms — are SLOTS: an index into
// typed columns of cash and debt, so a month over thousands of firms
// allocates nothing and a save copies two arrays rather than thousands of
// keys. A slot account is passed as its number.
//
// `flow` keys are "<from class>><to class>:<what>" and reset each month, so a
// month's flow table is the economy's transaction matrix at a glance.

/** The economy's sectoral agents (ONE_ECONOMY_PLAN.md §1). */
export const ACCOUNTS = {
  households: "hh",
  government: "gov",
  bank: "bank",
  landlords: "land",
  rest: "row",          // the rest of the country and the world
  market: "mkt",        // the month's clearing house for sales: buyers pay in, sellers are paid out; nets to zero
} as const;

/** A named agent (string) or a slot (number). */
export type Account = string | number;

export interface Ledger {
  /** Cash by named account. */
  bal: Record<string, number>;
  /** Loans outstanding by named borrower — the bank's claims on them. */
  loans: Record<string, number>;
  /** Slot accounts: cash and debt columns, `n` in use. */
  slot: { cash: Float64Array; debt: Float64Array; n: number; cls: string };
  /** Bonds the city has sold, by holder. */
  bonds: Record<string, number>;
  /** This month's flows by "<from>><to>:<what>". */
  flow: Record<string, number>;
  /** Cumulative charge-offs, by borrower class. */
  chargeOffs: Record<string, number>;
  /** Transfers booked this month. */
  n: number;
}

export function newLedger(slotClass = "firm", cap = 256): Ledger {
  return { bal: {}, loans: {}, bonds: {}, flow: {}, chargeOffs: {}, n: 0,
    slot: { cash: new Float64Array(cap), debt: new Float64Array(cap), n: 0, cls: slotClass } };
}

/** An account's class: a slot is its ledger's slot class ("firm"); a named account is its name. */
export const accountClass = (L: Ledger, a: Account): string => (typeof a === "number" ? L.slot.cls : a);

/** Make room for `n` slots (amortised doubling). */
export function ensureSlots(L: Ledger, n: number): void {
  const S = L.slot;
  if (n <= S.cash.length) return;
  let cap = Math.max(64, S.cash.length);
  while (cap < n) cap *= 2;
  const c = new Float64Array(cap), d = new Float64Array(cap);
  c.set(S.cash.subarray(0, S.n)); d.set(S.debt.subarray(0, S.n));
  S.cash = c; S.debt = d;
}
/** A new slot, cash and debt zero. Returns its index. */
export function addSlot(L: Ledger): number {
  ensureSlots(L, L.slot.n + 1);
  const i = L.slot.n++;
  L.slot.cash[i] = 0; L.slot.debt[i] = 0;
  return i;
}
/** Remove closed slots, keeping order: `keep[i]` true keeps slot i. Returns the old index -> new index map (-1 dropped). Every closed slot must be empty. */
export function compactSlots(L: Ledger, keep: ArrayLike<boolean>): Int32Array {
  const S = L.slot, map = new Int32Array(S.n);
  let j = 0;
  for (let i = 0; i < S.n; i++) {
    if (!keep[i]) {
      if (Math.abs(S.cash[i]) > 1e-6 || Math.abs(S.debt[i]) > 1e-6) throw new Error(`sfc.compactSlots: slot ${i} closed holding cash ${S.cash[i]} debt ${S.debt[i]}`);
      map[i] = -1; continue;
    }
    S.cash[j] = S.cash[i]; S.debt[j] = S.debt[i]; map[i] = j++;
  }
  for (let i = j; i < S.n; i++) { S.cash[i] = 0; S.debt[i] = 0; }
  S.n = j;
  return map;
}

const addTo = (L: Ledger, a: Account, v: number) => {
  if (typeof a === "number") L.slot.cash[a] += v;
  else L.bal[a] = (L.bal[a] ?? 0) + v;
};

/**
 * MOVE MONEY. The one way it moves. `what` names the payment; the flow is
 * booked under `key`, or "<from class>><to class>:<what>". A zero amount
 * books nothing; a non-finite one throws (a NaN once ate the player's
 * bankroll in silence; it will not eat the city's).
 */
export function transfer(L: Ledger, from: Account, to: Account, amount: number, what: string, key?: string): void {
  if (!Number.isFinite(amount)) throw new Error(`sfc.transfer: non-finite amount ${amount} ${from}>${to}:${what}`);
  if (amount === 0) return;
  addTo(L, from, -amount);
  addTo(L, to, amount);
  const k = key ?? `${accountClass(L, from)}>${accountClass(L, to)}:${what}`;
  L.flow[k] = (L.flow[k] ?? 0) + amount;
  L.n++;
}

export const cashOf = (L: Ledger, a: Account): number => (typeof a === "number" ? L.slot.cash[a] : L.bal[a] ?? 0);
export const debtOf = (L: Ledger, a: Account): number => (typeof a === "number" ? L.slot.debt[a] : L.loans[a] ?? 0);
const addDebt = (L: Ledger, a: Account, v: number) => {
  if (typeof a === "number") L.slot.debt[a] += v;
  else L.loans[a] = (L.loans[a] ?? 0) + v;
};

/** A debt the borrower already carries when the books open: the bank's claim, no cash moving. */
export function openDebt(L: Ledger, borrower: Account, amount: number): void {
  if (amount > 0) addDebt(L, borrower, amount);
}
/** A loan: the bank pays the borrower and holds the claim. */
export function lend(L: Ledger, borrower: Account, amount: number, key?: string): void {
  if (!(amount > 0)) return;
  transfer(L, ACCOUNTS.bank, borrower, amount, "loan", key);
  addDebt(L, borrower, amount);
}
/** Principal repaid: cash back to the bank, the claim down by the same. */
export function repay(L: Ledger, borrower: Account, amount: number, key?: string): void {
  const a = Math.min(amount, debtOf(L, borrower));
  if (!(a > 0)) return;
  transfer(L, borrower, ACCOUNTS.bank, a, "repay", key);
  addDebt(L, borrower, -a);
}
/** A loan written off: no cash moves; the claim and the debt go together. Returns the amount. */
export function chargeOff(L: Ledger, borrower: Account): number {
  const owed = debtOf(L, borrower);
  if (owed) {
    const c = accountClass(L, borrower);
    L.chargeOffs[c] = (L.chargeOffs[c] ?? 0) + owed;
  }
  if (typeof borrower === "number") L.slot.debt[borrower] = 0;
  else delete L.loans[borrower];
  return owed;
}
/** The city sells a bond to `holder`: cash in, a bond outstanding. */
export function sellBond(L: Ledger, holder: string, amount: number): void {
  if (!(amount > 0)) return;
  transfer(L, holder, ACCOUNTS.government, amount, "bonds");
  L.bonds[holder] = (L.bonds[holder] ?? 0) + amount;
}

/** THE IDENTITY: the sum of every balance, named and slot. Zero, to rounding. */
export function ledgerSum(L: Ledger): number {
  let s = 0;
  for (const k in L.bal) s += L.bal[k];
  const c = L.slot.cash;
  for (let i = 0; i < L.slot.n; i++) s += c[i];
  return s;
}
/** The gross of every balance — what a rounding residual is measured against. */
export function ledgerGross(L: Ledger): number {
  let s = 0;
  for (const k in L.bal) s += Math.abs(L.bal[k]);
  const c = L.slot.cash;
  for (let i = 0; i < L.slot.n; i++) s += Math.abs(c[i]);
  return s;
}
/** The bank's loan book: every claim, named and slot. */
export function loanBook(L: Ledger): number {
  let s = 0;
  for (const k in L.loans) s += L.loans[k];
  const d = L.slot.debt;
  for (let i = 0; i < L.slot.n; i++) s += d[i];
  return s;
}
/** Balances summed by class. */
export function balancesByClass(L: Ledger): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in L.bal) out[k] = (out[k] ?? 0) + L.bal[k];
  let f = 0;
  for (let i = 0; i < L.slot.n; i++) f += L.slot.cash[i];
  out[L.slot.cls] = f;
  return out;
}
/** Start a month: last month's flow table is dropped. */
export function newMonth(L: Ledger): void {
  L.flow = {};
  L.n = 0;
}

/**
 * A TYPED COLUMN THAT WENT THROUGH JSON (a harness's deep copy, an old save
 * path) comes back as a plain {"0": v, ...} object. Put it back in a typed
 * column of `cap` entries (households.ts reviveColumns, the same repair).
 */
export function reviveF64(v: unknown, cap: number): Float64Array {
  if (v instanceof Float64Array) return v.length >= cap ? v : (() => { const a = new Float64Array(cap); a.set(v); return a; })();
  const a = new Float64Array(cap);
  if (ArrayBuffer.isView(v)) { a.set((v as unknown as Float64Array).subarray(0, cap)); return a; }
  if (v && typeof v === "object") for (const [i, x] of Object.entries(v as Record<string, number>)) { const j = +i; if (j >= 0 && j < cap) a[j] = x; }
  return a;
}
/** A ledger back to typed slot columns after a JSON round trip. */
export function reviveLedger(L: Ledger): void {
  const cap = Math.max(L.slot.n, (L.slot.cash as unknown as { length?: number }).length ?? 0, Object.keys(L.slot.cash ?? {}).length);
  if (L.slot.cash instanceof Float64Array && L.slot.debt instanceof Float64Array) return;
  L.slot.cash = reviveF64(L.slot.cash, Math.max(cap, L.slot.n));
  L.slot.debt = reviveF64(L.slot.debt, L.slot.cash.length);
}
