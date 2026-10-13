# Banking — how debt works now, and what the rivals revamp should pick up

This is the map of the banking system after the October 2026 revamp. Read it
before touching `debt.ts`, `lenders.ts`, `loanbook.ts`, `ledger.ts`,
`credit.ts`, `workout.ts` or `privateCredit.ts`.

The organising idea: **every dollar of named debt in the city is a loan on a
real lender's books.** One shared rule set prices that debt, and one count
decides who is exposed to whom and who is not paying.

## The pieces

| file | what it owns |
|---|---|
| `engine/amortize.ts` | The only payment arithmetic: `monthlyPayment`, `scheduledPayment`, `recastPayment(loan, month)`, `CAP_PREMIUM_PCT`. Imports nothing. |
| `engine/pricing.ts` | The only price law: `deskRatePct(bench, spread, {ci, app, ease, standingAdd, rel, dealAdd})` and `appetiteAdvance(app)`. Imports nothing. |
| `engine/loanbook.ts` | `cityLoanBook(s, parcels?)`, which lists every named loan: yours (senior, mezz, facility, construction, the line) and the street's (the mortgage record and construction jobs). It also gives each loan's status (`current` / `watch` / `default`), and `deskTotals()` sums the list by holder. It is a view, not a store. |
| `engine/ledger.ts` | The street's mortgage record: prunes rows whose deed moved, marks paper held outside the banks, and reconciles each firm's debt to its loans. |
| `engine/rivalDebt.ts` | A firm's loans: origination at a real desk under the single-name and headroom limits (`deskRoom`), the line, sale payoffs, renewals, the monthly service and the payment status. |
| `engine/lenders.ts` | The desks' balance sheets. Each month the book is rebuilt as the **anonymous book** plus the **named book**. |
| `engine/credit.ts` | The revolver, written by a named bank (`lineLender`). It is sized and priced through that bank. |
| `engine/workout.ts` | The workout table. Extension odds and terms depend on lender type (`deskCondition`, `EXT_TERMS`). |

## A desk's book

```
book       = anonBook + named
delinquent = (anonBook × anonDelinq + namedDefaulted) / book
```

- **Named loans** are counted from `cityLoanBook`. A loan is either being paid
  or it is not. Its loss is booked when it actually happens, through
  `chargeLenderLoss` at the deed in lieu, the auction or a street firm's
  failure, at the size the collateral actually fetched.
- **The anonymous book** is the paper written to the town's owners the game
  does not run as firms. It is modelled as a population:
  - it grows with appetite;
  - it goes bad with vacancy, the cycle phase and the credit window
    (`anonDelinq`);
  - a third of what is delinquent is charged off over a year, and charged-off
    paper leaves the book.
- **Opening reconciliation (once).** The street's opening mortgages are carved
  out of the stated opening book. Where they are more than 75% of it, the book
  grows instead, and capital is scaled so that every desk opens the game at its
  own capital target.
- **Consequences that now follow from the arithmetic:**
  - A loan you close takes capital ratio from the desk that writes it.
  - A desk whose named borrowers stop paying reads as sick, and can die.

## Pricing

Every desk feeds `deskRatePct` the same facts and brings its personality
through its spread:

| paper | benchmark | spread | notes |
|---|---|---|---|
| Senior desks (`quote`) | loan index (fixed) / short index (floating) | product sheet | unchanged arithmetic |
| Mezz | loan index | 8.0 | now widens with the window; it was flat |
| Revolver | **short index** | 4.0 | at the line bank's appetite, plus your standing; it was the loan index + 4, flat |
| Construction | loan index | desk table | the fund passes none of the window on (`ease: 0`); relationship discount on the same convex curve (`relCurve`) |
| Private credit | Cordage's floating sheet | + 2.5–5.0 draw | it was index + 6–9, flat; advance moves with underwriting standards |

## Lender types at the workout table

| type | will extend when | fee / bump / paydown, healthy (stretched) |
|---|---|---|
| bank | healthy, or stretched with a file > 45 | 1% / +1.5 / 3% (2% / +3.0 / 8%) |
| life | the same as a bank | 1% / +1.0 / 5% (2% / +2.0 / 10%) |
| conduit (special servicer) | healthy only; the relationship counts for nothing | 1% / +0.5 / 5% (2% / +1.5 / 10%) |
| fund | stretched or better | 2% / +3.0 / 0, always |
| fund that BOUGHT this note | never | — |

"Healthy" means at least 0.7× the desk's own capital target; "stretched" means
at least 0.45×. These are the same bands the Banks page prints.

**What is deliberately NOT changed:** a covenant default never goes to
foreclosure while the coupon can be funded. That is the owner's standing rule
(`couponFundable`), and it is also how lenders behave: they trap cash and
demand a cure on a current loan, they do not auction it.

## The player's standing instruction

A balloon any desk will renew rolls on its own at maturity. It pays the same
closing costs a chosen refinance pays: the 1% fee, the new desk's points and a
cap on floating paper. Any fee the account cannot cover is added to the note.

`GameState.debtPolicy.rollMaxJumpBp` (set on the Debt page) adds one condition:
the clock stops when the renewal would reprice the coupon by more than that
amount. Covenant sweeps fold into a single docket line, keyed on the set of
swept deeds.

## Bugs fixed on the way

- Private credit looked up a lender called "Alden National", which never
  existed. Every private ask therefore said "the banks have stopped
  answering", in every market.
- A construction mini-perm was written as product `"cordage"` held by a bank.
  The private borrow desk read it as "already on private paper" and never
  quoted a takeout. Mini-perms are now `"miniperm"` and private loans are
  `"private"`. Both live in `INTERNAL_PRODUCTS`; `isPrivatePaper()` still
  reads old saves.
- `workoutMood`'s "they bought your loan" test was true if the fund had bought
  ANY of your loans. It now checks this note.
- Extension tests used absolute capital ratios. The conduit (4% target) could
  never extend, and the life company (18% target) extended while impaired.
- The single-name test missed the facility, mezz and the line.
- The mortgage record counted each street firm's construction debt twice.
- `books.ts` priced the line's interest with its own copy of the rate.

## The street's debt, loan by loan (the rivals handoff, done)

The four seams the banking revamp left for the rivals work are closed.
`engine/rivalDebt.ts` owns a firm's debt; `test/rival-loans.mjs` asserts it.

1. **Per-loan rival debt.** A firm's mortgages are real rows on
   `s.cityLoans`, one first mortgage per deed, originated when the debt is
   taken on: the opening book (backdated part-way through its term), an
   acquisition (`rivalBuys`, the steps, a package), a construction takeout at
   delivery, a cash-out refinancing. The amount is sized where it always was
   (`streetRefiProceeds` / `acquisitionLoan`); the desk is the cheapest one
   whose `quote(..., street = true)` funds that amount, among those with room
   under `placeLoan`'s two rules (now `deskRoom`: the single-name limit, which
   also counts the firm's line, and capital headroom). Its coupon and term are
   that desk's. `Rival.debt` is re-summed from the rows, the line and the
   construction balances after every change (`syncDebt`); the ledger counts
   any path that moved it some other way (`debtDrift`) and the test holds the
   count at zero. A sale pays off the mortgage on THAT building, then the line
   (`settleSale`); a foreclosure, the keys or a deed through the paper takes
   the row with the deed (`dropDeed`). A note sold out of the banks keeps its
   row, marked `heldBy`, off every desk's book but still owed.
2. **Status from payments.** Each month a firm short after its line misses
   the loans whose buildings carry themselves least, until the unpaid service
   covers the shortfall (`markPayments`). A missed payment is a default that
   month — the player's rule — and a building that no longer covers its own
   coupon, or that lives on an extension, is on watch. A bank files on its own
   loan three months in arrears, for what is owed on it.
3. **The revolver as its own balance.** `Rival.lineBal` at `Rival.lineBank`
   (the bank holding most of the firm's mortgages), priced like yours:
   `deskRatePct(shortIndexOf(econ), LOC_SPREAD, { ci, app })`. It is repaid
   first from sale proceeds after the building's own mortgage, it carries a
   short sale's deficiency, and it is on `cityLoanBook` as `kind: "line"`.
   `Rival.revolver` stays as the lifetime tally of draws.
4. **Maturities from the rows.** `tickMaturities` reads each row's
   `maturityM` (or its extension date). A balloon the market will refinance
   renews at the cheapest desk that clears it (`renewRow`, the
   `balloonLadder` rule) and pays the renewal's closing costs; a gap is paid
   from cash, moved to the line, extended by the desk, called from partners,
   or the building is handed back.

Also fixed on the way: the street's carry charged the coupon on construction
balances that `fundJobs` already capitalises, so every crane's interest was
paid twice.
