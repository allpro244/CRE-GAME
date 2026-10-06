# One playthrough from $1M, fifty years — 6 Oct 2026

**Generated city (reference seed), market seed 4242. Not Manhattan.**

One run, played like a person sitting in the chair: press **Yr ▸▸**, stop when
the game stops you, clear the docket, look at the tape, press again. When I had
cash to put to work I pressed **Month** instead, because that is what you do
while you are shopping. The driver is `tools/play1m.mjs`. It is deterministic,
so `pnpm engine && node tools/play1m.mjs` reproduces every number here.

The style was opportunistic. I bought income at a real discount to appraisal
or a positive spread over the index, levered about 70%, refinanced at every
balloon, listed into expansions once value reached 1.6× basis, and recycled
the money. I bought land only when a scheme cleared the builder's hurdle by
12%, and none did, so **I never built anything**. That is a finding about my
filter, not about the dev desk.

Leasing was done by hand until it became a chore. Renewals went to management
in year 13. A leasing hire took the pen in year 34.

## The result

| | |
|---|---|
| Net worth, year 50 | **$834.8M** (834× on $1M; 14.4%/yr compounded) |
| Street | **2nd of 22**. Hargreaves & Heirs had $1.74B |
| Deeds bought / held at end | 408 / 109 (54 office, 32 apts, 17 retail, 6 industrial) |
| Peak book | 132 deeds, 1.30M sf, 148 commercial tenants (year 48) |
| Worst years | yr 19–21 (−9%, −11%, −2%) when the index hit 9.3% |
| Cash at the end | **$406M**, 49% of net worth, sitting idle |

The trajectory: $2.9M at year 1, $12M at 10, $48M at 20, $152M at 30, $448M at
40, $835M at 50.

The first deal made the game. The opening tape had a 42k sf apartment building
asking $2.48M against a $3.32M appraisal. I bought it at $2.35M and sold it for
$6.82M in year 5. A 34% discount on the opening tape is an outlier, though:
across eight seeds the median opening appraisal/ask is 0.96 and the p90 is 1.20.

## Where the player's time actually went

Every decision I made over fifty years, by type:

| decision | count | per year at scale (yrs 30–50) |
|---|---|---|
| negotiation rounds on purchases | 1,167 | ~32 |
| **refinancing a maturing loan** | **942** | **~30** |
| answering a sale (bid list, offer, *then closing it*) | 621 | ~20 |
| bids placed | 416 | ~12 |
| broker exclusives on/off | 374 | ~10 |
| listing for sale | 308 | |
| **new-lease letters** | **269** | ~5–19 |
| tenant rent-relief / give-back asks | 122 | ~4 |
| renewal letters (before and after management) | 109 | |

And what stopped the clock:

| stop cause | stops | docket rows seen at stops |
|---|---|---|
| **balloon** | **224** | 963 |
| early-look lapsing | 124 | 416 |
| covenant sweep | 65 | **1,454** |
| sale bids | 47 | 309 |
| private-credit quote | 15 | 268 |
| portfolio bid | 13 | 56 |
| LOI | 1 | 455 |

**The headline: in this run, leasing was not the biggest chore. Debt was.**
From year 9 on, almost every month had a new stop. Most of them were a loan
coming due that any desk would refinance, or a first look on a listing I had
no interest in. Leasing letters almost never stopped the clock, because I
answered them as they arrived. They were steady work rather than
interruptions.

There is a caveat on that. My book was 109 small deeds, averaging about 10k sf,
and 32 of them were apartment buildings, which never send a letter. A book of
twenty 100k sf office buildings would turn the table over. The leasing findings
below hold either way, because they are about *how* the desk and the principal
share the work, not how much of it there is.

---

## Leasing a large book without handing everything to the desk

### What I saw

**1. Handing over the pen silently lowered my pricing.** By hand I signed at
97% of market net effective or better and countered everything else to 102%.
The moment a desk took the book, it ran `starterPlan()`: quote 90% of market,
no hold-out, an 82% NE floor. That is the old default mandate. Nothing on the
handoff told me so. A player who never opens the sheet's sliders has just cut
their own rents by 5–15 points. Phase 6 measured the gap at +6.8 NE points
under a player-equivalent sheet. The starter sheet is well below that.

**2. Delegating to staff costs nothing extra in commission.** The principal
pays 4% on a new lease and 2% on a renewal (`leaseCosts`). The staff desk pays
4% and 2% (`deskFee`). Only the outside agent costs more (6%). So the cost of
handing your own team the book is salary, which you were paying for capacity
anyway, plus whatever the sheet gives away. **The reason a player doesn't want
to delegate is not money. It is that delegating is the end of the game's
leasing content.** Once the desk holds the pen, leasing turns into a
scoreboard.

**3. Half the desk's referrals are tour dead-heats.** About 235 letters came
back from management and the leasing desk. The reasons:

| reason | share |
|---|---|
| "multiple tenants are competing for the same space; you choose the winner" | **46%** |
| "signing would leave less than the treasury reserve" | **35%** |
| incumbent expansion | 8% |
| term outside the sheet's band (starter sheet floor is 36 mo) | 6% |
| off-package TI / free rent | 4% |

**4. The treasury test reads cash only.** `agentCanFund` checks
`s.cash − cost ≥ agentCashReserve`. The capital plan funds "off cash OR the
undrawn line" (sim.ts). The desk does not. So in the years I ran cash close to
reserve and kept the line undrawn on purpose, the desk referred perfectly good
leases with $16K–$52K fit-out cheques. That is 35% of all referrals. A related
`ti-book` stop ("open lease signing costs $16K would breach the cash reserve")
fires on top of the letter it is about. It is the same decision, raised twice.

**5. Rent-relief asks are one decision made 122 times.** I declined 110 and
granted 12, always by the same rule: grant when the class is soft, decline
when it is tight. That is a policy, so it belongs on the sheet.

**6. Small things.** The desk scorecard still says "check the pass line on your
mandate" (the dials are gone). There is no one-click "counter to my sheet" on a
letter card: every counter opens the draft.

### What I would build, in order

None of these needs a fake number. Each one is either a policy the principal
writes down, or a real mechanism the engine already has (capacity, slip, fees)
applied to a new place.

**A. Let the principal run their own sheet ("standing terms").** This is the
main answer to the question. Today the posted plan does nothing unless a desk
holds the pen. Let it do two things for the principal too:

- **"Counter to my sheet" on every letter card.** One click fills the
  counter draft with the plan row's ask and package, trimmed to the floor by
  the same `trimToNeFloor` the desk uses.
- **"Clear the tray against my sheet"** on Deals and Leasing. It runs
  `clearAgainstPlan` over every letter that needs the principal, signs or
  counters what clears, and leaves only the docket exceptions. The principal
  still holds the pen and still pays the principal's 4%/2%. The realistic
  limit is the principal's time, and the engine already models it:
  `ownerCapacitySf` (150k sf before style and bandwidth) and `slip`. Above
  capacity, the batch answers late, so some letters lapse or walk. That is
  the honest reason a 1M sf owner hires a leasing team, and it makes the hire
  a decision about *throughput* rather than *giving up control*.

**B. Turn the quarterly digest into the leasing decision.** The digest already
computes "your sheet is 6 points over where deals cleared; you bought 31
vacant-months with it". Make it one stop a quarter. Show it per class, with
that advisory line and two buttons: **[Move ask to where deals cleared]** and
**[Hold]**. Show the vacant-months and NE cost of the last quarter's sheet
beside each. Leasing a large book then becomes "set the price of the firm's
space every quarter against what the market did". That is the real job of a
head of leasing, and it is a better game than letter 140 of 300.

**C. Write the sheet from the player's own record at handoff.** When a desk
first takes the pen, seed each row from the last ~24 months of the principal's
signings: median signed NE, the TI and free rent actually given, and the term
band actually signed. Fall back to `starterPlan()` only with no history. Say
what was written ("Your desk will work your own terms: 99% ask, 94% NE floor,
TI to $35 — edit the sheet"). This fixes finding 1 with a mechanism, not a
default.

**D. Let the desk pick tour winners.** Add a sheet rule: when two letters
compete for one block, the desk signs the one with the higher NE over the
floor and refers only when they are within ~2 points and differ on credit.
Keep the current behaviour as a toggle ("I pick tour winners"). This removes
half of all referrals.

**E. Test the treasury reserve against liquidity, not cash.** Read
`spendable()` (cash plus the committed undrawn line), the same test the
capital plan already uses, or add a sheet option "the desk may draw the line
for fit-out up to $X". Drop the `ti-book` stop when every letter it counts is
already on the docket. This removes another third of all referrals.

**F. Keep the pen where it matters: per building, not firm-wide.** The pen is
firm-wide today (`teamLeasing`). Sliders for size (`deskMaxSf`) and dollar
authority exist, plus "Nobody signs but you". Add a pin on the property page:
**"I sign here"**. The trophy tower and the building in lease-up stay yours,
and the 40 small shops go to the desk. `loiNeedsPrincipal` gets one more
clause. This is what "without giving everything to the desk" means in
practice.

**G. Put rent relief on the sheet.** A row for asks: grant relief when the
class vacancy is over X, the tenant's credit is at least Y, and the cut is no
more than Z% for N months; decline otherwise; refer anything else.

**H. Batch renewals by building.** Show a building's rolling year as one card
("4 renewals at 88 Old Bank, terms vs market, [Answer all to my sheet]"),
instead of four letters arriving in four different months.

---

## The other chores, which were bigger in this run

**Balloons: 942 manual refinancings, 224 clock stops.** Every loan matures,
every maturity stops the clock twice (`balloon:<bbl>:far`, then `:near`), and
almost every one was answered by "take the cheapest desk that covers the
payoff". Add a standing instruction, firm-wide or per loan: **roll at
maturity**. At the 12-month notice, the treasury takes the cheapest quote that
clears payoff and the reserve. It stops only when no desk quotes, when
proceeds fall short of payoff, or when the coupon jumps more than X bp. Under
the "money" clock setting the balloon stop is unavoidable today, and it is the
single largest source of stops. The year-45–49 rows show what a real stop
looks like: a dozen "No lender will size a loan against this income" refusals
on a book that was still worth $600M+. That should stay a stop.

**Selling takes two decisions for one sale.** Taking a clean bid
(`acceptBid`) puts the building under contract and posts "under contract …
Close it". Two months later a second "Offer in hand" stop asks you to accept
the same price again. That accounts for a good share of the 621 sale
decisions. A clean contract should close itself at the closing date. The stop
is warranted only on a retrade, which `acceptBid` already models.

**Early-look and broker files: 124 + 5 stops** on listings I never wanted. The
buy box filter exists, but a player who never set one gets stopped by every
listing they could afford. After the third lapsed first look, offer to write a
buy box from what the player has actually bought.

**Covenant sweeps sit on the docket for years.** There were 65 stops, but the
sweep rows appeared 1,454 times in the docket at stops. Once you have seen a
sweep and decided to ride it out, it should fold into a single "3 buildings
swept" line until something changes: a cure becomes affordable, or the test
passes.

**Late game had nothing to do with money.** I ended with $406M of idle cash
after selling into the year 35–37 peak. Part of that is my pacing: two
negotiations at a time, about twelve bids a year. Part of it is the game: the
only bulk acquisition channel is the occasional street-book package, so
putting $400M to work means about 40 multi-round negotiations a year. A
"portfolio bid" channel going the other way (you bid on a rival's or a fund's
book) would give a large firm something to do that fits its size.

**Starting from $1M, the office costs 6% a year before you own anything.**
That is $5K a month (`firmOverheadMonthly`) while you look. I lost $94K in
year 1 of my first attempt, when I pressed Yr and only shopped once a year.
Shopping monthly fixed it. The cost is realistic; the trap is that pressing Yr
while you hold only cash gives the player no reason to look at the tape.

---

## What was built from this (same day)

Everything in this report except the late-game portfolio channel was built.
`HANDOFF.md` §11 has the engine detail. The replay is `NEW=1 node
tools/play1m.mjs`: it plays the same opening the same way, but uses the new
tools. It posts a number of 97% with 12 months' patience, clears its tray,
applies a relief rule, lets loans that will roll do so, lets contracts close,
and takes the buy box its book implies. Its world diverges from the first
run after the first different decision, so compare the chores, not the
fortunes.

| fifty years | old tools | new tools |
|---|---|---|
| balloon clock stops | 224 | 65 |
| refinancings done by hand | 942 | 140 at a balloon, 188 chosen cash-outs |
| sale decisions | 621 | 464 |
| first-look stops | 124 | 75 |
| letters, renewals and asks handled | ~500 | ~1,580 |
| …leasing decisions taken | ~500 (one per letter) | 628 (406 tray passes, 222 by hand) |
| net worth / street | $835M, 2nd of 22 | $1.07B, 1st of 21 |

The new run ended bigger, but that is mostly a different 50 years, not a
feature. The leasing line is the one that answers the question. It handled
three times the letters for about a quarter more clicks, and only about one
letter in seven needed an individual answer: competing tenants, expansions,
the treasury, and a tenant's final under the number.

**What the probe said about concessions.** The worry was that tenants ask
for more free rent and fit-out than real life, especially on second-generation
space. Measured on four towns over twenty years (`pnpm concessions`), that
does not hold:

- Free rent opens at 0.2, 0.5 and 0.9–1.2 months per year of term in tight,
  balanced and glutted markets. That is inside or under the broker-survey
  bands.
- Second-generation office TI opens at a median of $1.5–1.8/sf a year of
  term, deflated. That is under the $3–6 band for a tired fit-out.

What does run hot is the opening rent: a median of 77% of asking (67% net
effective), because most letters arrive at buildings with space that has sat
for years. So TI was not cut. The vacancy clock now restarts on a signing,
as its own comment always said, but that barely moved the measurement.
Why so much space sits dark in tight markets is a separate open question.

## Caveats

- One seed, one city, one strategy. The 834× is not a balance claim.
- The driver answers instantly and never forgets. A human misses deadlines,
  so the real number of LOI stops would be higher than 1.
- "Decisions" counts each engine call the player would make. A negotiation
  round counts once, even though in the UI it is two or three clicks.
- I did not build. The land filter (hurdle ≥ 1.12 before buying a lot) never
  fired on this seed, so the development desk was untested here.
