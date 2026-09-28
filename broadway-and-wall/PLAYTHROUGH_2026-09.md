# A deep playthrough — Sep 2026

**No playtest in this repository is based on Manhattan. Every number here is on a
generated city (`test/city.mjs loadCity(0)`).**

Two playthroughs, run the same day on the tip after the UI pass:

- **The engine, played like a principal.** `pnpm deepplay`
  (`tools/deepplay.mjs`, a report, ~4 minutes a seed). Three seeds × thirty
  years, month by month, through
  the same engine actions the desks call: buy off the tape (`negotiate` →
  `acceptCounter` → `closeDeal` with the cheapest desk that lends), answer
  every letter (`respondLOI` accept / counter / pass around the managed
  market rent), refinance when a desk beats the coupon or a balloon is inside
  eighteen months, appeal assessments, gut-renovate worn buildings, run a
  lobby program, break ground on any scheme that clears its hurdle, list
  after a five-year hold in an expansion and take the best bid, draw and
  repay the line, hire a leasing desk and a manager at month 30, open a
  facility, buy a note, approach a neighbour off-market, offer a ground
  lease, file a variance, try a conversion. Every month it ran
  `checkInvariants`, walked the state for non-finite numbers, and scanned
  every holding, listing and letter for values that cannot be; every year it
  recorded the ratios the business runs on. Every refusal the engine returned
  was counted in the engine's own words.
- **The playable, driven through the store.** `scratchpad/pw-campaign2.mjs`:
  a twelve-year campaign in the real UI under Playwright, every desk
  photographed at four points, the DOM scanned on each for `NaN`,
  `undefined`, `Infinity`, `null`, `$-`, four-decimal percentages and empty
  buttons.

The bot is deliberately reckless (it takes the desk that advances most and
runs a 12% cash reserve), so its net-worth path is not a finding; what it
does is walk every desk through every market the city produces in thirty
years and write down what the screen would have said.

---

## What was wrong, and what was done about it

Ranked by how much a player would feel it. **Fixed** means this commit;
**measured, left** means it is real, understood, and written down for the
next hand.

### 1. Every building you built opened at "standard" — FIXED

`dev.ts deliver()` set `h.condition = "good"` and then computed the condition
INDEX off `condCeiling(parcels[bbl])` — the STATIC record, whose `yearBuilt`
on a lot that was land is `0`. A two-thousand-year-old ruin has a ceiling of
0.58, so every ground-up delivery was clamped to 0.58 for life: "standard",
with the word "good" printed beside it. Every reader takes the index, not the
word — the rent multiplier, the cap spread, the arrival factor on the
leasing desk (×1.00 instead of ×1.22), the assessment — while the build desk
had priced the scheme at "good".

Measured on four forced deliveries (`scratchpad/devgap.mjs`): value at
delivery 4–56% of basis, rent at delivery the "standard" rent. On the one
scheme in the campaigns that cleared its hurdle (79K sf of flats at 6.69%
against 6.64% required): value at delivery 55% of basis, 62% at
stabilisation, NOI 1.12M against 2.63M underwritten.

After: the ceiling is computed on the record `deliver()` had just written to
`s.built`, which carries the real year (a conversion keeps its old bones on
purpose). The same tower now delivers at 80% of basis, reads 92% at
stabilisation, and earns 1.53M — the rest of the gap is the assessment at
cost (`taxAppealQuote` is the answer to that, and the bot filed it) and rents
that moved during a three-year build. `pnpm delivered-condition` guards it, in
`check`; the invariants flag any ground-up delivery inside a year that reads
under 0.85.

### 2. A matured note nobody would take out sat past maturity forever — FIXED

`tickLoan` runs the takeout ladder the month a balloon lands and opens a
`balloon` file when no desk will write it. `tickWorkouts` then, for as long
as the coupon cleared, set `decideM = month + 1` and printed "still waiting on
a takeout" every six months. Nothing extended the note, nothing re-priced it,
nothing called it. Measured over three campaigns: 61 building-months of paper
carried past its maturity, one note for years, the Debt page printing a
balloon date years in the past. A covenant file open across the maturity
made it worse: the ladder never ran (it only quotes an unfiled note), and the
file closed itself the month the sweep cleared, leaving a matured loan with
no file at all.

After (`workout.ts holdoverDecision`): twelve serviced months of holdover and
the desk does one of the two ordinary things. A desk with capital documents
the extension — the same fee, coupon bump and sweep `requestForbearance`
charges when the borrower asks, the fee capitalised onto the note if the
account cannot write it — and the extension is counted on the note
(`Loan.extensions`); nobody extends twice, the borrower's own forbearance ask
included. A receiver, a fund that bought the paper, or a stretched desk
files. At the extended maturity the file closes so the ladder quotes the
takeout fresh; if nobody will, a new file opens with the one extension
already spent and forecloses a year later. A file of any cause that is open
when the note matures becomes a balloon file. Two invariants now hold it: a
note more than a month past maturity with no file, and a note fourteen months
past maturity without an extension or a filing. `pnpm balloon-holdover`
walks both paths, in `check`.

### 3. A marketed sale cleared a tenth over the mark — FIXED

`runCallForOffers` drew every bid from 86% to 109% of the owner's mark in an
expansion. The mark already carries the boom (it is made of the compressed
cap rate), so the process was paying the boom twice, and the max of a handful
of draws plus best-and-final landed the accepted bid at 108% of the appraisal
at the median and 113% at the ninetieth over 36 sales — against a tape where
the same player bought at or under the mark. A round trip in an expansion
was a free tenth.

After: bids centre on the mark (88% to 106% in an expansion, 88% to 97% in a
crunch) and best-and-final sharpens by half a point to three and a half. 56
sales in the after-run: 102% at the first quartile, 105% median, 111% at the
ninetieth — the few per cent a competitive process extracts, not a tenth.

### 4. "In-place NOI" was this month's cheque — FIXED

`holdingNOIYr(…, month)` is the cash statement: a tenant in a free-rent period
contributes nothing. That is right for the bank balance and it was what every
desk printed as in-place NOI, what the lender's collateral view underwrote,
and what the Portfolio and Debt pages summed. An anchor's two abated months
read as the building's income falling by two thirds and coming back;
measured 56 one-month NOI moves of more than 50% on buildings over half let.
`holdingValue` had always used the contract (`contractNoi` with the abatement
netted separately) — one quantity, two answers.

After: `contractNoiYr` / `ownedContractNoiYr` (value.ts) read every lease at
its contract rent, a gut renovation excepted; `inPlace`, `debtCollateral`,
the Property, Portfolio, Debt and sale desks read it. The cash tick, the
top-bar cash flow and the operating statement stay on cash. "Free rent owed"
on the property page is the abatement a buyer still funds.

### 5. The mark fell off a cliff the month a lease ended — improved, not closed

A tenant with nine months left was capitalised as a bond, then the mark
dropped by a third the month they left. Measured: 55 one-month appraisal
moves of more than 35%, most of them a known expiry landing. An appraiser
carries a rollover reserve — the expected re-letting cost of every lease
inside a year, weighted by whether the tenant renews.

After (`leasing.ts rolloverReserve`, registered into `ownedHoldingValue`):
for every commercial lease inside twelve months the mark carries
`(1 − p) × (downtime at reletMonths + TI at the market's ask band over a
five-year re-let + a 4.5% commission)`, `p` from the renewal read the
leasing desk already prints, fading in over the final year and capped at a
quarter of the mark. The glide is real; **the cliff is not gone**, because
the mark itself is 55% in-place capitalised and 45% stabilised (`holdingValue`),
so losing a 30% tenant still costs a third of the value until the space
re-lets. The honest fix is the appraiser's: a partly vacant building is worth
its stabilised value less lease-up cost and downtime, which is what
`leaseUpMark` already does for a building inside its first lease-up. Extending
that mark to any building with a hole in it is the next cut, and it moves
every standing number in BASELINE.json, so it is a measured change for its
own commit.

### 6. The run ended with equity on the book — FIXED

The playable campaign's firm went insolvent at month 43 and the card said
"the creditors took everything, and it wasn't enough" — over a book that
still owned 51 New Trinity Pl at $3.14M of appraisal and printed $887K of
net worth on the same screen. The twelfth-month seizure (`sim.ts`) takes the
most valuable unfiled building and ends the run when nothing unfiled is
left; that building had a covenant file open, and "a file on the desk
outranks the bailiff" kept it off the list while the line sat over-advanced
at $684K against a $421K limit. A firm with equity lost the run.

After: the file outranks the bailiff for as long as there is anything else
to take or any line to draw. With neither, the bankruptcy sale runs the
filed building through the same waterfall — the mortgagee's lien off the
top, the file closing with the deed, the distressed bid, the tax on the
gain — and the surplus clears the hole; the run ends only with nothing
saleable left. `test/insolvency-sale.mjs` (in `check`): a $1.27M office
carrying a $0.42M note and a covenant file, cash −$150K, the line drawn to
its limit — the twelfth month sells it at $1.31M gross on a $1.58M mark and
the account goes from −$0.15M to +$0.66M with the run continuing; with the
line undrawn, the line is drawn and the deed is not touched; beside an
unfiled building, the unfiled one goes first. Four of those checks fail on
the old engine.

### 7. Things measured and left alone

- **Empty buildings that stayed empty for years** were the bot's, not the
  engine's: 189 letters it could not sign because the fit-out and commission
  were cash it did not have ("Signing costs $X. You're short"). With the
  letters answered, a new office tower at demand 55 lets 26% → 85% in 36
  months (`scratchpad/oddsprobe.mjs`), which is slow against the 18–30 months
  a well-located new building takes in life, but a pace, not a wall.
- **A district's flat rents falling 30% in a year** (seed 550991, year 30):
  the world without a player never moves a class rent index more than 7% in a
  year (`scratchpad/rentpath.mjs`, three seeds); the move was in the player's
  campaign and did not come from location (`locationRentMult` and block
  demand unchanged on every building). The trace now prints the rent
  indices; it wants a re-run on that seed before anybody touches
  `affordEff` / `incomeEff`.
- **Land under a small building swinging 3×** (a 4K sf office marked at its
  land floor: $478K → $3.46M → $556K over eight years). Residual land values
  are leveraged to rents and caps and this is the direction of the world; the
  magnitude is a calibration of the residual's smoothing, not a bug.
- **A bridge desk writing paper at negative coverage** against an empty
  building. That is what a lease-up bridge is; the desk prints the coverage
  and the coupon (12–19% in a dear-money era), and the choice is the player's.
- **Real retail rents down 15–25% over thirty years, industrial up 20–45%.**
  Defensible against the record (e-commerce; logistics). Multifamily real
  rents drifting down 5–12% is the one to watch.
- **Opex 20–40% of EGI, tax 0.3–1.5% of value, yield on value 6–9%, coupon
  spreads 4 points on bridge paper and 1–2 on bank paper, live LTV 30–75%,
  lease terms 3–12 years (median 5.3), TI $4–34 a foot, free rent 0–4
  months, half the letters on net terms** — all inside the ranges the
  business runs in.

---

## Limitations a principal would hit (not fixed; ranked)

1. **TI cannot be amortised into the rent.** The one wall the bot hit most:
   189 letters refused for want of the fit-out cheque. In life the tenant
   repays a landlord's TI over the term at a coupon; the engine has no such
   counter. `respondLOI`'s counter would take an `amortizeTi` flag: rent up by
   the annuity on the TI at the coupon plus two points, signing cost net of
   the TI, the tenant's acceptance odds off the effective rent.
2. **A loan cannot be paid down in part.** `payOffLoan` is all or nothing; a
   principal facing a covenant test pays down to the number. The covenant
   cure path already computes the number (`equityCureNeed`); a `paydownLoan`
   action is a small addition.
3. **No sale-leaseback, no partial-interest sale, no JV on a single deed.**
   The fund is the only way to bring in a partner.
4. **No percentage rent on retail, no sublease income, no expansion
   options.** Tenant asks exist for the relief cases; the upside cases do not.
5. **No insurance, no casualty, no environmental remediation.** Every risk
   the desk carries is a market risk; the one-off physical risks that end
   real deals are absent.
6. **A facility under $5M is not written.** True to life, and the reason the
   bot with an eight-building book never got one; a smaller player's answer is
   the line, and the line is net-worth sized.
7. **A conversion requires the debt off first.** Correct — a construction
   lender wants first lien — but the desk could quote the takeout-and-convert
   as one transaction, which is how it is done.

---

## The screen

The UI campaign photographed every desk at years 0, 2, 6 and 12 (57 frames)
and scanned the DOM on each for things a desk must never print (`NaN`,
`undefined`, `Infinity`, `null`, `$-`, four-decimal percentages, empty
buttons): no hit, and no page error or console error in twelve years. What
the frames showed, read against the engine run: a one-tenant retail box
bought at 90% let went dark inside two years and the desk said so everywhere
at once — 0 / 1 spaces, in-place rent $0.00, expense leakage 100%, the
firm's occupancy 0.0%, a covenant file, the line over-advanced — which is
the single-tenant risk the tape does not price into the ask and a player has
to read off the roll before signing. The rooms are consistent with each
other. The one thing the frames caught that the scan could not is §6: the
end-of-run card contradicting the net-worth figure printed beside it, which
was the engine ending the run with a building still on the book.

---

## How to re-run the measurements

```
pnpm engine
pnpm delivered-condition        # new bones read as new
pnpm balloon-holdover           # the desk extends once, or files
pnpm insolvency-sale            # a filed building is the last thing taken, not the end of the run
pnpm check                      # all three are in the chain
pnpm gate                       # the invariants now carry the balloon and delivery checks
```

The bot is `pnpm deepplay` (SEEDS=… YRS=…). The four small probes named
above (devgap, oddsprobe, rentpath, the sale-ratio cut) were session scratch;
each is under a hundred lines against the engine bundle and its method is
described where it is cited.

One more thing the final run surfaced, once in 1,080 player-months and left
for the next hand: the engine's own `talks` invariant fired on a contract
agreed in the same tick the listing under it left the tape ("under contract
on something that is no longer for sale"). `refreshListings` keeps a listing
alive while a talk is agreed; some other path — a rival's purchase, a city
taking, a receiver — does not check the talk. Rare, real, and cheap to close
by hanging up the talk when the deed goes.
