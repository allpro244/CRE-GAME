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
| `engine/ledger.ts` | The street's mortgage record, which allocates each firm's TERM debt (debt less construction) across its financed deeds. New rows are placed under single-name limits and desk capital headroom (`placeLoan`). |
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

## Handoff to the rivals revamp

The street is in the loan book through the mortgage record (`s.cityLoans`) and
the construction jobs. That record is still a **projection** of one aggregate
`Rival.debt`. These are the seams the rivals agent should pick up, in order:

1. **Per-loan rival debt.**
   - Replace the projection with real rows that rivals originate, using
     `quote(s, product, value, noi, klass, /*street*/ true, …)` or
     `streetRefiProceeds`. The desk the firm actually borrowed from should
     become `CityLoan.lender`; it is currently `placeLoan`'s hashed preference.
   - Make `Rival.debt` the sum of the rows, not the other way round.
   - `cityLoanBook`, the desks' named books, `chargeSponsorFailure` (which
     already routes term losses to `CityLoan.lender`) and the class ledger all
     read `s.cityLoans` and need no change.
2. **Status from payments, not from `stressMs`.** Today a firm six months into
   a squeeze flips EVERY row to `workout`, which counts as `default` on the
   desk. Per-loan arrears would let one bad building default without
   cross-defaulting the book (or cross-default deliberately, by covenant).
3. **The revolver as its own balance.**
   - `Rival.revolver` is lifetime draws, not an outstanding balance.
   - Add an outstanding line balance, pay it down first from sale proceeds,
     and price it with
     `deskRatePct(shortIndexOf(econ), LOC_SPREAD, { ci, app: <the firm's bank>.appetite })`
     instead of `index + RATE_SPREAD`.
   - Put it in `cityLoanBook` as `kind: "line"`.
   - `lineRoom`'s docstring names this gap.
4. **Maturities from the rows.** `tickMaturities` derives balloons from
   `heldSince` and a hashed term. With real rows it can read `maturityM`
   directly and walk `balloonLadder`-style desks for renewal.

Keep `placeLoan`'s two rules, the single-name limit and capital headroom,
whatever originates the rows. Without them, one street firm's failure takes
down the hometown bank.
