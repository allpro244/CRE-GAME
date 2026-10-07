# One developer-only playthrough — 7 Oct 2026

**Generated city (reference seed), market seed 4242, $5M start, 40 years.**
Driver: `tools/playdev1.mjs` (deterministic; `pnpm engine && node tools/playdev1.mjs`).

The mandate was dirt and cranes only, with no standing income bought. The bot
played like a person at the Build desk:

- **Scan the tape.** For every land listing it ran the desk's own "Find the
  best schemes on this lot" sweep, plus the scheme the desk opens on.
- **Phone owners.** Twice a year it called the owners of lots whose parcel card
  reads *Developable*.
- **Build.** It bought when a scheme cleared the desk's own **Pencils** line
  (hurdle ≥ 1.0) and the dirt plus the whole job was fundable, then broke
  ground the month after.
- **Lease, take out, sell.** It leased through the tray, took out the mini-perm
  at stabilisation or at the balloon, and sold stabilised product once it was
  worth 1.2× basis.

`TRACE=1` prints apartment lease-up month by month. `DUMP=1` prints the
valuation pieces at delivery.

## Results

| 40 years, seed 4242 | before fixes | after fixes (no sweep) | after fixes + line sweep |
|---|---|---|---|
| Net worth | $4.23M (0.8×) | $12.98M (2.6×) | bankrupt in year 15 |
| Street | 11 of 16 | 10 of 12 | — |
| Jobs built | 6 | 6 | 4 |
| Months to 90% let, apartments | 34, 44, 48, never | 18, 18, 21, (glut: 83% at 36) | 18 |
| Covenant-sweep stops | 9 | 3 | 1 |
| Foreclosures | 1 (409 Old Union St) | 0 | insolvency |

The last two columns are different worlds, not a before/after of the sweep.
They part at year 9, at the first lender quote that changed when the
lender-name fix moved a relationship. In the bankrupt world the line sat at $0
from year 1 to year 12, so the sweep never acted. The firm died of a rate
shock: the index went 5.6% → 8.7% → 10.2% and apartment vacancy 4% → 11%. The
bot broke ground in the first month of the recession, the job delivered at
0.34× cost on a 12.1% mini-perm, and the bank cut the line to zero. That is
the developer's real risk, priced honestly. It is also a reminder that this
path is high-variance: in the century study, two of three developer seeds
died.

## What was broken (fixed)

**1. Land loans carried a coverage covenant they do not have.**
The land loan is written at `minDSCR: 0`, because dirt has no income. A lot
still pays property tax, so its NOI is slightly negative, and `d < 0` read as a
breach. The month the 12-month holiday ended, every land loan "breached". The
equity cure then demanded 12% of the balance, every month, at 11% LTV.

Measured on one 26-month build: **$4.3M of the developer's cash went into the
land loan before delivery**, alongside a run of covenant-sweep stops.

Fix: the DSCR test and the DSCR cure only run on paper that has a DSCR
covenant (`debt.ts`). The 70% LTV covenant still applies.

**2. The land loan survived groundbreak, and its balance vanished at delivery.**
Nothing retired the land loan when construction closed. It could balloon in
the middle of a build. Then `deliver()` assigned the mini-perm straight over
`h.loan`, so whatever was still owed was never repaid by anybody. The probe
showed $870K of debt disappearing in the delivery month. No cash moved, so
`pnpm conserve` could not see it.

Fix: construction LTC here is sized on the job's cost excluding land, which
makes the site the sponsor's equity, and equity goes in unencumbered.
`startDevelopment` therefore repays the land loan (and any mezz) at the
construction closing, booked as debt service:

- It counts in both funding tests, and the refusal names it.
- The Build desk's "at closing" cheque shows it.
- `siteDebtAtGroundbreak` is the one helper for all three.
- As a backstop, `deliver()` now rolls any balance still on the deed into the
  takeout rather than writing over it.

**3. Apartment lease-up was counted twice.**
`useOccupancy` already applies the market's lease-up curve to a new building
(`leaseUpFactor`: opens a fifth let, stabilised at 1.6 years). The player's own
occupancy walk then closed only 6–9% a month of the gap to that still-climbing
target. A block of flats delivered into a 4% market took **34–48 months** to
reach 90%. An identical rival building next door took 19.

It compounded: past twice the lease-up span the appraiser stops treating a
building as a lease-up (`leaseUpWeight`), so the slow fill also cut the mark
and the takeout. That chain produced the run's foreclosure.

Fix: the walk heads for the stabilised level. Inside the lease-up span the
building is let at least as far as the market curve says a building its age
is. The age is read from the delivery month, not from `yearBuilt`, which is a
whole year: a December opening used to read eleven months old on day one.
Now **18–21 months** to 90% in a 4% market, slower in a glut.

**4. One loan, two lenders.** A mini-perm is written on the "cordage" terms
but held by the construction lender. The arrears notice named Cordage, the
workout filing named Alden Savings, and the relationship credit went to the
desk that never lent. `loanLender()` is now the one answer, used everywhere.

**5. Surplus cash now pays the line down after debt service.**
This was the owner's rule: debt service first, then the line. The month-end
sweep used to hold back six months of debt service (never under $250K), so a
drawn revolver ran at index+400 next to idle cash. Now:

- **The sweep** keeps next month's scheduled debt service and sends everything
  above it to the line.
- **The parked cash** is tracked as `loc.parked`. Any repayment from cash adds
  to it, any draw spends it first, and it never exceeds the balance.
- **The leasing desk** may redraw the parked cash (`lineDeskMayDraw`) and no
  more. It still cannot borrow past what the firm's own cash would have been,
  so the delegation rule holds and the desk does not start referring every
  letter again.
- **The runway alarm** counts the parked cash too. Otherwise it would fire
  constantly.
- **The test** `test/loc-auto-paydown.mjs` is updated to the new rule.

The trade-off is real and stays in the model. Liquidity held as line headroom
disappears when the bank cuts the line (`locLimit` falls with net worth and the
credit cycle). That is exactly the doom loop the line's own comment describes.

## Finding dirt — the developer's biggest problem

| | 40 years |
|---|---|
| Land listings seen on the tape | 122–158 |
| Best scheme at the ask, p10 / p50 / p90 / max | 0.23 / 0.30–0.35 / 0.84 / 1.01× |
| Vacant lots in town at any time | ~440 |
| …where a builder's residual sets the price | 14–26 |
| …of those that reached the tape | ~0 |
| Owner calls made / lots bought off-market | 167–189 / 3–4 |
| Best scheme at the owner's named number, median | 0.95× |

Most tape land would not pencil even if it were free: yield on cost around 2%
against 8% required. It is texture-priced fringe dirt. That is realistic. What
was a kink is that the 14–26 lots that do pencil were findable only by clicking
parcels one at a time.

**Built:** a **"Sites that pencil · off-market"** list on the Market page
(`sitesThatPencil` in `buybox.ts`), the land broker's site list. It shows
vacant, unlisted, non-civic lots where the builder's residual sets the price,
with the scheme, the card value and the owner, and it opens the parcel to
approach. It shows nothing a parcel card does not already show. The owner's
number is still the owner's; most want 1.0–1.8× the residual.

## Measured, not fixed

- **The plan's finished value vs the appraisal.** Building a scheme instantly
  in the same economy (scratch probe, 14 lots), the owned mark reads about
  0.89× the plan's `stabNoi / exitYield`, and the street's `assetValue` reads
  0.70×. This is the open ECONOMY.md §3 item, narrower than the third it once
  was. It moves every standing value, so it needs its own measured commit.
- **Delivering into a glut is brutal, and mostly honestly so.** 53 Beaver St
  planned at 1.00× and marked 0.50× its cost at delivery. The breakdown:
  apartment rents −15% (rentIdx 33 → 28), vacancy 13%, a lease-up mark at 39%
  let, and rates up. The bot broke ground blind to the cycle. A desk warning
  ("ground breaks into N% vacancy, index up X since you bought") would make
  this a decision rather than a surprise.
- **The mini-perm floats at index + 2.1.** Every takeout gap in the run
  followed a rate rise. That is the real refinancing cliff, but nothing on the
  Build desk offers a rate cap on construction paper. Floating permanent loans
  have one (`loan.cap`).
- **A long dead stretch.** Years 24–38 of the after-fixes run held $8–10M of
  cash with nothing that penciled at any owner's number. The street can be
  like that. The site list at least makes the empty pipeline visible.
