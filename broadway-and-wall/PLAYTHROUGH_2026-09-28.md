# A player's playthrough — 28 Sep 2026

**No playtest in this repository is based on Manhattan. Every number here is on a
generated city.**

The September deep playthrough (`PLAYTHROUGH_2026-09.md`) played the engine
the way a principal would and drove the UI to scan it for `NaN`s. This one sat
in the chair of somebody who has never seen the game: start a town, read the
screen, believe what it says, buy something, and see whether the next screen
agrees with the last. That is a different fault class. Nothing in it is out of
balance and nothing prints `NaN`; the page just tells you two things about the
same building and you have to guess which one the lender will use.

Two passes:

- **The playable, by hand, under Playwright** (`pnpm dev`, a headless Chromium
  held open between moves, every click made the way a player makes it). A
  City / Young town / $2.5M opening, the Marketplace, one purchase negotiated
  through two rounds, financed and closed, a renewal answered, seventeen months
  advanced; then a second town opened after the fixes, to read the same pages
  back.
- **The engine bot,** `SEEDS=7919,31337 YRS=30 pnpm deepplay`, sixty
  principal-years, for the things a person cannot sit through.

---

## What was wrong, and what was done

### 1. The first year of every game marked the whole city down for nothing — FIXED

Bought a 1914 retail building in January at the lender's own appraisal
($3.92M, recovery, rates falling 135bp over the spring). By May it was marked
9% lower and net worth had fallen $300K. Retail *vacancy was falling* and the
face rent index had moved from 23.85 to 23.76. Effective rent had moved from
23.85 to 20.96.

`createEcon` opened the concession dial (`concIdx`) at **zero** in every class,
so effective rent equalled face on day one, and the tick then chased the dial
toward its target at a quarter a month. The target at an ordinary opening is
not zero: 13% retail vacancy against 8.5% natural in a recovery wants ~0.6,
eighteen points of net effective. The market already had that concession
package the day the game opened; the dial was just spinning up, and every
appraisal in town (they are all struck on effective rent) went down with it.
Measured on five seeds, effective rent in the first year:

| seed (opening phase) | before, m12 vs m0 | after |
|---|---|---|
| 7919 (recovery) | −14% office, −14% retail, −14% industrial | −6%, −2%, −4% |
| 550991 (recovery) | −24%, −16%, −17% flats | −5%, −2%, −1% |
| 12007 (recovery) | −18%, −19%, −12% industrial | −5%, −2%, −3% |
| 31337, 424242 (expansion) | unchanged | unchanged (target is 0 there) |

What is left after the fix is the market moving. The effective/face ratio holds
steady from month 0.

It hid a second artefact. The opening land index is struck on effective office
rent, so it also opened on face: on one Volcker-era seed it opened at 0.67 and
slid to 0.45 over three years. It now opens at 0.46 and tracks. Both builds
meet by year eight (0.41 / 0.42).

The fix: `concessionTarget(gap, phase)` is now one exported function in
`market.ts`, read by the monthly tick and by `createEcon`, which seeds `concIdx`
at its own target and strikes `effRentIdx` (and the land index after it) from
it.

### 2. The property page gave two appraisals, and the header was the wrong one — FIXED

On the first building: **$4.22–4.76M** in the header, **$3.77–4.25M** in the
body. The lender came back at $3.92M. The header was `assetValue`, the class
model, which ignores the disclosed rent roll. The body was `marketAppraisal`
plus `displayValue`, a "hedonic location premium" on the land slice that is
added **only on that card**. No lender, sale, mark or net-worth figure ever
pays it. After the purchase the two still disagreed by that premium, and so
did the two "Equity" figures on the page ($1.33M vs $1.41M). The header also
left mezz out of equity.

Both now read `marketAppraisal`: the disclosed roll when there is one, the
owned mark when you own it, the leased fee when it is ground-leased. That is
the same number the lenders and the net worth use. The sale desk, which was
handed the premium-inflated value, now prices off it too.

### 3. Demand had four values on one building — FIXED

The Marketplace showed demand 64. The property header showed "52.12 / 100",
unrounded. The body showed 52. The leasing desk showed 54. The first three were
`rec.demandScore`, the generator's static score. The Marketplace and the
leasing desk read `demandNow` (score plus the block's live drift). The property
page, card and broker card now read `demandNow`.

### 4. The offering memorandum counted the core as vacant space — FIXED

"Vacant 3,439 sf · $34/sf market here" on a building 88% let. The suites add
up to exactly the **gross** area. `genRentRoll` demises **rentable** feet, and
12,941 rentable less 11,379 let is 1,562 sf. So the card showed 1,877 sf of
stairs and risers as space you could let, beside a stabilised pro forma, on
the screen where the price is decided. `DisclosedRoll` and the owned rent roll
header now count rentable feet.

### 5. Every NNN lease read "gross" once you owned it — FIXED

The memorandum said NNN. The owned rent roll said "G" and the renewal letter
said "gross", on the same leases. `recovery: "nnn"` is the field; the rent roll
(`ParcelDesk`) and the Deals desk were reading the legacy `net` flag, which is
`false` on every lease written since `recovery` replaced it. Both now read
`recoveryOf`, and base-year stops print as such.

### 6. "Buildable at max" drew buildings that cannot stand — FIXED

"94,076 sf · up to 12 floors" on a 3,189 sf lot is a 7,800 sf plate on a
3,200 sf site. The line was lot × FAR. Slenderness and the core stop a small
lot long before its FAR runs out, and `planDevelopment` knows it. The line now
reads `maxBuildable(rec)` (new, `dev.ts`): the planner's own
`min(plate × floors, envelope)` at the widest footprint the Build desk offers.
It says so when the lot, not zoning, is the limit. This was wrong on **17% of
lots** in the standard city, by a median 1.5× and 2.8× or more on the worst
tenth.

### 7. The top bar's "firm cash flow" left out the firm — FIXED

CF / YR read $81K. Cash rose $11K in eight months. The tooltip said "firm cash
flow", but the number was deeds less debt. The office (the $60K base plus the
AUM-scaled charge and payroll, $66K a year on one building) came out every
month without showing up there. `firmOverheadMonthly` is now one function,
charged by the tick and subtracted by the top bar.

### 8. The leasing desk called a good letter bad — FIXED

A renewal at $31.19, $4 of TI and no free rent was flagged "7% under market
net effective — the concessions are coming out of your side of the table".
The "market" it compared against is `managedRentPsfYr`, which is the **face**
rent (the property page, which shows effective, said $30). The town was signing
its ordinary deals 10% under face that month, so the letter beat the going
package. The engine's tenant model scores against face on purpose and is
unchanged. What changed is the words: the card now says "vs market asking",
and the advisor compares the letter with what the market is actually signing
(effective/face) before calling it cheap.

### 9. The financing step pre-selected a dearer loan than the one it recommended — FIXED

"Cheapest money that will write it: Alden Savings & Trust at 9.34% all in"
appeared above a 9.52% 30-year loan that was already selected. The desk opened
on the regional's 30-year product whenever it quoted. It now opens on the top
of its own cost-ordered list.

---

## Measured and left for the next hand

- **Band L (the cranes answer) moved on the gate's five towns, and it is the
  re-roll.** On `CITY_SEEDS=1`, delivered per demolition fell from a median
  1.58 to 0.48, pulling band K (aging) just outside with it. Both bands are
  reported, not gated. Eight more towns, paired, 50 years, no player:

  | town | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
  |---|---|---|---|---|---|---|---|---|
  | before | 3.64 | 1.57 | 1.71 | 2.49 | 1.27 | 0.81 | 3.11 | 2.60 |
  | after | 2.78 | 1.82 | 2.02 | 2.83 | 2.32 | 1.47 | 1.28 | 0.95 |

  Across all thirteen towns the fix lowered the ratio on six and raised it on
  six. The thirteenth is the gate's fifth, an opening where the dial already
  started at zero, and it is identical in both builds and the only one under
  the 0.60 floor. Medians are 1.47 after and 1.62 before. The gate's five drew
  three of the six downs. No level shift, and nothing to fix, but it is a
  standing reminder that band L on five towns cannot resolve a change this
  size.
- **Two baseline metrics moved the same way on both seed sets.** `land.p90`
  rose +48% on the baseline's six seeds and +40% on twelve others;
  `dev.affordableLotShare` rose +85% and +12%. Retail vacancy (+24% / −43%) and
  median land (−4% / +12%) flipped sign between the sets, so those are the
  re-roll that `tools/baseline.mjs` warns about. The land tail moving together
  is the one worth a proper look. A plausible cause is that land no longer
  opens 30–45% rich, so prime lots stop being sold into the wrong decade, but
  that is a hypothesis, not a measurement.
- **Carried from September:** fit-out in the rent, a sale-leaseback and a JV
  on one deed. All three were done in the third round, below.

## Second round — the rest of the list

- **"Yr ▸▸" stops when something is due, not when it arrives — DONE.** The
  multi-month advance stopped the month any new item landed, and an item
  already on the desk when you clicked never stopped it at all, so a letter
  could lapse in the middle of a year without a word. Attention items now
  carry `lastM`, the last month you can act (letters, tenant asks, note
  sales, private-credit quotes, broker files, first looks, sale offers).
  Those stop the run in that month, whether they were on the desk at the
  start or arrived during the run. Items with no deadline (arrears, a sweep,
  a balloon notice, a bid list) still stop the month they appear. Measured
  with a one-building book over five years on three seeds: nothing lapsed
  unseen, and the stops land at deadlines. The number of clicks barely moved
  (22 either way), because the bot never acts on opportunities: somebody
  else's note sale or a broker's file still stops the year once, now in its
  last month rather than its first. That is the existing design ("Skip runs
  past the best buying window" is why those items are on the list) and it is
  kept.
- **One occupancy basis on the property page — DONE.** The header was the last
  reader of physical occupancy; it now reads `occupancyRead` like the card,
  Leasing and the top bar ("fully let · 1,562 sf unlettable", with the reason
  in the tooltip).
- **Offer desk — MOSTLY A MISREAD, one wart fixed.** "Best and final" is a
  checkbox, not a header (the text scrape flattened it), and "Counter" was
  already disabled once the seller stopped. When their word is final, both
  controls are now hidden, since a counter at or above their number is
  "Take" spelt longer.
- **"Nothing pencils" says why — DONE.** It now shows the builder's residual
  for the land ("leaves $X/sf for the land, under the $Y/sf it trades at"),
  which is what actually fails.
- **A loan can be paid down in part — DONE.** `paydownLoan` (debt.ts): cash
  only; the note's own prepayment terms apply to the dollars prepaid; the
  payment is re-cut on the remaining amortisation exactly as the monthly tick
  and the equity cure do; the lien stays. The property's Money tab has an
  amount box with 10% / 25% presets and, when the note is in breach, a
  "Cure" preset set to `equityCureNeed`. The cost including any prepayment
  charge is shown before the click. `pnpm paydown` (in `check`) proves the
  balance, cash, ledger, recast, refusals, the step-down charge and the cure.
  In the playable: a $210K note, 25% paid down with a $1,575 prepayment
  charge, DSCR 1.36 → 1.81.
- **Small ones — DONE.** The top-bar era column clipped "disinflation"; it is
  now sized to the longest name. `deepplay` prints the game-over cause
  instead of `[object Object]`.

## Third round — the rest of the rest

- **The top-end land rise was the re-roll.** Paired town by town (before →
  after the concession fix) the land p90 went 532→948, 502→480, 1212→1212,
  542→357, 907→725 and 102→748. That is two up, three down and one
  unchanged. The median's jump is almost all town 20603, whose economy
  collapsed in the old draw (office effective rent 16) and did not in the
  new (46). Nothing to fix.
- **Fit-out in the rent — "They build it" (counter desk).** Tested as a
  hypothesis first. The counter could already cut the allowance, and the
  tenant already prices a cut allowance as 75 cents on the dollar over the
  term (`TI_VALUE`). The wall the bot hit was the cheque at signing, and
  amortising landlord TI into rent does not remove the cheque. What does is
  the ordinary alternative: the tenant builds its own space for a lower
  rent. The preset sets the allowance to zero and solves for the rent that
  leaves the tenant's net effective where its letter put it, so the odds of a
  yes do not move. On ten real letters, the cash to sign fell 60–80% and the
  rent 2–11%. The "you're short" refusal now names it.
- **Sale-leaseback — the landlord's form (`leasehold.ts`).** An occupier's
  sale-leaseback means nothing to a player who never occupies space. The
  landlord's version is selling the land under your building to long money
  and leasing it back for 99 years. The engine had no way for the player to
  pay ground rent, so this builds one:
  - The fee sells at land value; the rent is that price times
    `groundYieldPct`, the yield the owned leased fee was already valued at,
    now one function; it steps 2% a year.
  - `holdingNOIYr` deducts the rent, so the cash, the DSCR and every lender
    see it.
  - The building marks at freehold value less the rent at that same yield,
    so the deal is value-neutral before its costs. `pnpm leasehold`: net
    worth −$24K against $24K of costs, NOI down by exactly the rent, 24
    months reconciled.
  - A mortgage bigger than the land cannot be cleared by selling the land,
    and the quote refuses and says why.
  - Land you sold cannot be demolished, converted, assembled or ground-leased
    out.
  - It can be bought back at the rent's current value. That is market risk:
    in the test, rates fell and the fee cost $837K against $656K two years
    earlier.
  - Known gap: the fee buyer is not an owner on the map, and after you sell
    the leasehold the next owner holds it freehold. No player money moves
    through that gap.
- **A JV on one deed (`jv.ts`).** Sell a passive partner 25% or 49% at a
  12% minority discount (the shallow end of the 10–25% appraisers take for
  lack of control and marketability):
  - The partner takes its share of each month's cash after debt and funds
    its share of a shortfall, the fit-out cheque, make-ready, demising and
    the capital plan (booked as `lpDistributed` / `lpCalled`).
  - At any exit it is paid at the closing table, and you are taxed on your
    share. A partnership passes its income through, so income tax is on
    your share too.
  - Net worth carries your share of the equity.
  - New debt, a pay-down, a payoff, mezz, a renovation, a capital programme,
    a conversion, demolition, selling the land, a facility pledge or a
    portfolio package all need consent, which means a buy-out at the full
    pro-rata share.
  - A refinance is allowed (a balloon has to be answerable) and its cash is
    shared both ways.
  - `pnpm jv`: net worth moves by exactly the discount, counsel and tax;
    24 months reconciled; the sale split; the buy-out.
- **The fund had two faults of its own, found while mapping the JV:**
  - The waterfall took its 20% promote on everything after the pref,
    including the LPs' returned capital, so selling a building at cost paid
    the sponsor a fifth of the investors' money. It now runs pref, then
    capital, then promote on profit only, with the 3% co-invest taking its
    share of each tier (`waterfall`, pinned in `pnpm jv`).
  - Net worth counted vehicle buildings at 100% and vehicle cash at nothing.
    The co-invest therefore left net worth at the raise, and the LPs'
    capital arrived in it the day it bought a building. Net worth now holds
    `gpInterestInFund`, what that waterfall would pay the sponsor today.
    Standing a vehicle up leaves net worth unchanged.

## Fourth round — making the score visible

Played as a new player again, this time asking only "what am I trying to do,
and how am I doing?". The game kept score all along (net worth monthly, a
league table of every firm on the street, nineteen milestones, a firm
reputation tier) and showed almost none of it. The start screen stated no
aim. A full year passed with a toast that vanished before it could be read.
Your place among the rival firms was two tabs deep on Research. A milestone
was one line on the news tape. When your principal died, their whole career
got one news line and the run went on as the heir. None of it needed new
economics; it needed telling.

- **The year, told back (`standing.ts`, `YearReview.tsx`).** Every December
  close leaves a mark: net worth (the same `nwHistory` figure), your place on
  the street (the same equity the league table always ranked on, now one
  engine function, `rivalEquity`), the street's median firm, the name of the
  firm directly above you, and your reputation tier. It draws no random
  numbers, so no standing number moved. On the first January after, a card
  comes up with:
  - a verdict ("Up two places to 26th of 31. You outran the street.");
  - net worth December to December against the median firm's change;
  - your place and its movement, and the firm you went past (or that went
    past you);
  - your reputation tier and its movement;
  - cash from the buildings after debt, office and tax, and deals done;
  - the star building (biggest income gain) and the worry (biggest
    occupancy drop), each a link to the property;
  - milestones reached, and the next rung on the ladder.
  It respects the popups setting. `pnpm standing` checks that it agrees with
  the ledger and the net-worth history.
- **Your place is always in sight.** A "Street 28th / 31" chip in the top bar.
  Its tooltip names the firm above and the gap to it; a click opens the
  league table.
- **The ambition is said once, on the start screen.** You open near the bottom
  of the street; every firm above you started with a bankroll and a hundred
  years.
- **A milestone is a moment:** a gold banner for four seconds, as well as the
  news line.
- **A career is closed with a card.** When the principal dies, the card
  reads their tenure back: the book handed over and handed on, their place
  on the street at the start and end, their best year, deeds bought and
  sold, milestones reached, the estate bill, and the heir you continue as.
- **The game-over card** now carries the best place the firm ever held on the
  street and the years in town.
- **Fixed on the way:** zoning news printed the district's internal key
  ("theropewalk has been downzoned") instead of its name.
- **What is worth a look, on the same card.** The count of listed buildings
  whose going-in yield beats the cheapest all-in coupon a desk will write
  (`positiveLeverage`, the same two numbers the financing card compares),
  with the widest spread linked. It tracks the cycle: 0 of 6 in a
  dear-money opening at an 8% policy rate, 9 of 9 when money costs 2%.
- **The Street chip shows movement** since the last advance (▲ / ▼).
- **The year-one nudge sends you to the right desk.** It sent every
  milestone to the Marketplace, including the first lease (a letter on
  the Deals desk) and the first exit (sold from your own book). Each rung
  now opens its own desk and says how it is climbed.
- **"First development delivered" fired on other people's wrecking balls.**
  `s.built` also records every demolition in town, and the milestone's test
  counted anything in it the city had not built. In two first years out of
  eight, a player who never built anything got the milestone. It now reads
  the player's own delivery count, and `delivered-condition` checks that it
  fires on a real delivery.

## Tests touched, and why

Four harnesses in `check` were pinned to one draw of the world, and the fix
re-rolls every draw after month 0:

- `advance.mjs`: the hometown bank's book yield was tested against *this
  month's* index. The book yield barely moved (5.34 vs 5.45); the policy rate
  in the sampled month did. On the same seed the spread to spot runs +2.3 to
  +3.3 inside two years. A book reprices toward where the index has been, so it
  is now read against the trailing twelve-month mean. Same ±1.2 band.
- `refi-strong.mjs` and `appraisal.mjs`: the sample sizes sat exactly on their
  minimums (5 of 5, 12 of 12), so the number of qualifying listings each era
  opened with decided pass or fail. Each gained one town. The criteria (`bad
  === 0`) are unchanged.
- `appraisal.mjs`: the extra town found a building assessed at $400K and bought
  at $244K, whose mark rose 4.3% on the tax cut the closing gives. The test
  allowed for the reset only when it raised the assessment. It now allows both
  directions, since it is the same mechanism.
- `delivered-condition.mjs`: it wanted a lot of 4,000 sf or more on the tape at
  month 12 exactly. It now waits up to four years for one.

`pnpm check` and `pnpm gate` pass.
