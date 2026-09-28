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
- **Occupancy has three answers on a building with an unlettable remainder:**
  88% in the header (physical), "fully let" in the body (lettable basis) and
  100.0% in the top bar. Each is defensible. Three on one screen is not. Pick
  one basis for the headline and label the other.
- **"Yr ▸▸" stops on every letter.** In the first seventeen months it stopped
  after 5, 7 and 1 months. The docket already queues the letters. A year click
  could run the year and stop only on something that expires inside it.
- **The offer desk keeps "Best and final" as its header during a two-round
  negotiation,** and still offers "Counter" after "They have stopped moving".
- **"Nothing pencils today" sits beside "worth $420/sf finished against $351/sf
  to build".** That reads as a margin. Say what the hurdle needs.
- **`tools/deepplay.mjs` prints `game over … why: [object Object]`.**
- **Carried from September, still true:** TI cannot be amortised into rent, a
  loan cannot be paid down in part, and there is no sale-leaseback or JV.

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
