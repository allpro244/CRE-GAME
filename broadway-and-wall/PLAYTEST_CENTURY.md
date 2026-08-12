# Broadway & Wall — Century Playtest

*A hundred years of somebody else's city, run 198 times.*

## Sample

| Experiment | Harness | Runs | Horizon |
|---|---|---|---|
| Economy observer (no player) | `tools/pt-econ.mjs` | 36 — 20 × `city`, 4 each × `hamlet`/`town`/`metro`/`giant` | 1,200 months |
| Strategy tournament | `tools/pt-strat.mjs` | 162 = 9 strategies × 18 city seeds, all `city`, $5M start | 1,200 months |
| Refi desk probe | `tools/pt-refi.mjs` + direct test | 5,617 quote interrogations + a 56-quote executable test | 600 months |

**198 century-long runs, 237,600 simulated months, 0 harness failures.**
Driver `tools/pt-drive.mjs` (4 workers); analysis in `tools/pt-an-econ.mjs`,
`tools/pt-an-strat.mjs`, `tools/pt-stories.mjs`. Tournament wall time 85 min.

Measured against game code at **`1fb24dc`** (the PR #82 merge), bundle rebuilt
with `pnpm engine` immediately before the batches, zero source files newer than
the bundle. This is a **pre-#83, pre-FAR-overhaul baseline.**

Seeds are `citySeed` 1001–1020 with `marketSeed = citySeed × 7 + 13`, so the
economy a strategy faced on seed *N* is bit-identical to the observer run on
seed *N*. Every strategy ran against every seed.

Three conventions, all from CLAUDE.md, all of which change the answers:

- **Everything is CPI-deflated.** Median CPI at year 100 is 14.3× (observer)
  / 11.9× (tournament). A nominal terminal number mostly measures inflation.
- **Cyclical quantities are decade means, never a snapshot.** Only stocks are
  read at the end.
- **The observer resurrects on `gameOver`** (131 times over 36 runs) because
  its subject is the world. **The tournament does not** — a dead run ends and
  reports the month it died, because averaging a corpse's post-mortem century
  into a wealth distribution is how a bankruptcy rate becomes invisible.

**Not covered:** size and starting-cash sweeps at strategy level were built and
then cancelled at the owner's direction. Every strategy claim below is for a
standard `city` with a $5M cheque, and none of it is known to hold at other
sizes or bankrolls.

---

## Economic Swings

**The cycle is frequent and shallow; the *recovery* is what's slow.**
Counting downturns on the engine's own `cycleDev < −0.02` rather than on phase
labels: **18 downturns per century** (p10/p90 = 15/20, n=20 `city` seeds),
median length **8 months**. The city spends 17% of its time contracting.

But vacancy takes far longer to heal than the downturn lasts: median
**46 months** to bring a vacancy spike back under its long-run mean, p90
**155 months**. That gap — an 8-month contraction leaving a 4-year hole — is
the most realistic thing in the economic model, and it is what makes timing
matter.

**Real rents go somewhere, and where is mostly the seed's choice.**
CPI-deflated, indexed to month 12 = 100, at year 100 (20 `city` seeds):

| Class | p10 | median | p90 | median peak-trough swing | worst trough |
|---|---|---|---|---|---|
| Office | 65 | **204** | 300 | 145 pts | 49 |
| Retail | 82 | **199** | 285 | 129 pts | 26 |
| Multifamily | 47 | **126** | 247 | 101 pts | 22 |
| Industrial | 16 | **121** | 202 | 99 pts | 9 |

A median city doubles real office rent over a century; a p10 city loses a
third of it. That is a very wide band, and it is the single biggest driver of
player outcomes (see Wealth Outcomes).

**Cap rates cycle properly — I was wrong to suspect otherwise.** Decade means
looked suspiciously flat (office 7.93–8.60 across ten decades), which reads
like a missing cap-rate cycle. It was smoothing. Within-run monthly dispersion,
months 60+, pooled over 20 seeds:

| Class | p10 | median | p90 | median within-run p10→p90 spread |
|---|---|---|---|---|
| Office | 6.58 | 8.01 | 9.78 | **3.12 pp** |
| Retail | 5.11 | 6.56 | 8.21 | 3.03 pp |
| Multifamily | 4.08 | 5.56 | 7.23 | 3.19 pp |
| Industrial | 5.44 | 7.03 | 8.68 | 3.24 pp |

~310bp of cap-rate movement in every class is a realistic repricing cycle.
Recording the correction because the decade-mean view is the one a casual probe
produces, and it is wrong.

**Rates and inflation are well-shaped.** Index rate p10/p50/p90 =
2.30/5.32/7.81%, min 1.62%, max 17.38% — a full Volcker-style spike is in the
distribution. CPI compounds at 2.70%/yr median. Construction cost ends at
18.11× nominal against 14.3× CPI, i.e. ~1.27× real over a century — modestly
outpacing inflation, which is the right direction for a labour-heavy input.

**17.0% of all debt maturities land in a recession or depression**
(3,177 of 18,710 balloons, pooled over the 162 tournament runs). The
refinancing cliff is real and it is priced in at roughly the right frequency.

**Land value dispersion explodes, and the bottom rots.** On a fixed cohort of
every lot present at t=0, CPI-deflated $/sf, median across 20 seeds:

| Year | p10 | p50 | p90 | p99 | p90/p10 |
|---|---|---|---|---|---|
| 5 | 15.8 | 77.5 | 1,178 | 1,945 | 67× |
| 25 | 9.2 | 63.3 | 927 | 2,172 | 118× |
| 45 | 4.5 | 22.0 | 1,242 | 2,609 | 259× |
| 65 | 2.8 | 25.4 | 1,173 | 2,718 | 488× |
| 95 | **1.0** | 69.4 | 1,770 | 3,988 | **1,489×** |

The top decile roughly holds its real value. The bottom decile falls from
$15.80/sf to $1.00/sf real — a 94% loss over the century. Real cities do have
enormous land gradients, so the *level* of dispersion is defensible; the drift
of peripheral land toward zero is the part worth a second look.

**The classes barely co-move.** Correlation of 12-month real rent growth,
pooled over 20 `city` seeds: office~retail **0.35**, office~multifamily
**0.16**, office~industrial 0.21, retail~multifamily 0.18, retail~industrial
0.25, multifamily~industrial 0.23. Real property types share a macro and a
rate driver and typically correlate far higher than this. Flagging as a
question rather than a verdict — but if the four classes are near-independent,
diversification is a stronger free lunch here than in life.

**Industrial is structurally dead on the supply side.** This is the most
clear-cut economic finding in the batch:

- **22,100 sf of industrial completions across all 36 centuries — occurring in
  1 of 36 runs.** Against 136.4M sf of office (36/36 runs), 171.4M sf of
  multifamily (36/36), 44.8M sf of retail (36/36).
- Median final industrial stock 415k sf vs 5.98M office.
- Industrial vacancy runs 8–13% for decades 0–6, then collapses onto its
  frictional floor: decade means of **2.2 / 1.5 / 1.5** in 7 of 8 sampled
  seeds. Median absorption is −105 sf/yr; completions 0.
- Identical at every city size tested.

Nothing industrial is ever built. The existing shed stock is slowly absorbed
and never replaced, and the class ends the century pinned at its vacancy floor
with no supply response available.

**On the vacancy floor generally** — office vacancy rests exactly on its floor
**46.2%** of months (retail 45.8%, industrial 31.5%, multifamily 22.9%; months
60+, 20 seeds). That looks like CLAUDE.md's fifth fake, and it is not: it is
`frictionFloor()`, documented in `market.ts` as "the one rail in this engine
that actually binds," exported precisely so `tools/baseline.mjs` can watch it.
The committed baseline records office at 0.6267 over 300 months; 46.2% over
1,200 months is the same rail, read over a longer horizon. **Industrial is the
exception worth noting** — baseline records 0.0, this run measures 31.5%,
because the industrial floor only starts binding in the back half of the
century, past where the baseline looks.

**Rivals churn hard.** 30 start; median 28 fail per century; median 10 alive at
year 100 (so the city keeps seating new ones). Median 129 demolitions per
century. The world is emphatically not static around the player.

---

## Wealth Outcomes

CPI-deflated terminal net worth from a $5M start, 18 seeds per strategy.
Bankrupt runs are recorded as $0 and **not dropped**.

| Strategy | bankrupt | p10 | p25 | **median** | p75 | p90 | real CAGR (med) |
|---|---|---|---|---|---|---|---|
| Concentrated (office) | 3/18 | $0 | $18M | **$158M** | $248M | $302M | **3.52%** |
| Diversified | 7/18 | $0 | $0 | **$58M** | $144M | $286M | 2.49% |
| Distressed buyer | **2/18** | $0 | $16M | **$46M** | $87M | $147M | 2.24% |
| Aggressive leverage | 8/18 | $0 | $0 | **$35M** | $109M | $193M | 1.96% |
| Buy & hold unlevered | 8/18 | $0 | $0 | **$23M** | $75M | $124M | 1.53% |
| Levered buy & hold | 8/18 | $0 | $0 | **$18M** | $67M | $168M | 1.29% |
| Rentier (buy 3, collect) | 3/18 | $0 | $3M | **$12M** | $19M | $27M | 0.87% |
| Ground-up developer | **17/18** | $0 | $0 | **$0** | $0 | $0 | n/a |
| Merchant builder | **17/18** | $0 | $0 | **$0** | $0 | $0 | n/a |

**How rich can you plausibly get?** The realistic ceiling on a good seed with a
good strategy is **$150–300M real** (30–60× the opening cheque) over a century,
which is a real CAGR of 3.5–4%. The extreme tail reached **$718.6M real**
($10.61B nominal). The median across all 162 runs is far lower, because
**73 of 162 runs (45%) ended in bankruptcy.**

**Drawdowns are brutal even for winners.** Median max drawdown is 39–100%
depending on strategy; every strategy has a p90 drawdown of 100%. Six of the
biggest fortunes in the batch survived drawdowns of 23–61% on the way. Deep
holes are normal, not exceptional.

**Skill vs luck** — two-way ANOVA on log₁₀ real terminal wealth, 162 cells,
bankrupts floored at $50k rather than dropped (dropping them would decompose
the survivors only):

- **Strategy (skill): 32.1%**
- **City seed (luck): 20.1%**
- **Interaction + within: 47.8%**

The largest single term is the interaction — *the right strategy for that
particular city* — which is the healthiest possible result. It means neither
"pick the good strategy" nor "get the good seed" is the whole game; reading the
city you were dealt is worth more than either.

**But the cities themselves are wildly unequal.** Median outcome across all 9
strategies, by seed: Melvford Sound $146.9M, Langwich $105.4M, Hartstead
Landing $74.8M … and **8 of 18 seeds have a median of $0**, meaning the median
strategy goes bankrupt there. On Whitbourne Point, 8 of 9 strategies died.
Bankruptcy count per seed ranges 0–8. Lot count does not explain it (Kirkwich,
982 lots, 0 bankruptcies; New Tarrstone, 1,352 lots, 6 bankruptcies).

---

## Best Strategy

**On median wealth: office-concentrated levered buy-and-hold** — $158M real,
2.71× the runner-up's median, winning 9 of 18 individual cities.

**On risk-adjusted terms: the same strategy, and that is the uncomfortable
part.** It carries the *second-lowest* bankruptcy rate (3/18 = 17%) while
producing the highest median. It is not a high-variance lottery ticket that
looks good on the mean — it wins on median, on p75, on p90, and on survival
simultaneously. Its survival-weighted median ($132M) is 3.7× the next best.

The one strategy that beats it on pure safety is the **distressed buyer**
(2/18 bankrupt, 11%) — but at $46M median it earns less than a third as much,
and it pays for that safety with a crippling amount of nothing to do (below).

**Two disclosures that matter for how much weight to put on this:**

1. **"Concentrated" is really "office."** My bot picks its class at year 2 by
   highest observed cap rate, and that selected **office in 18 of 18 runs**.
   So the measured result is not "concentration beats diversification" in the
   abstract — it is "the highest-cap-rate class, held levered, beat everything,
   including a diversified book, by 2.7×." Whether concentration *per se* helps
   is untested; a proper test would force each class in turn.
2. Diversification actively *hurt*: $58M median vs $158M, and more than double
   the bankruptcy rate (7/18 vs 3/18). Given the low measured cross-class
   correlations, diversifying should have reduced risk. It reduced return and
   raised ruin instead. That is worth a look on its own.

**Is there a dominant strategy that trivialises the game?** Not quite, and this
is the good news. Concentrated wins only **9 of 18 cities** — a coin flip. The
other nine went to aggressive (3), diversified (3), distress (2) and unlevered
(1). A strategy that wins the median decisively but only half the individual
cities is exactly the shape you want: a clear favourite that is genuinely
wrong about half the time.

**Ground-up development is not a viable pillar.** Both building strategies died
in 17 of 18 runs, median terminal $0, median death year **2043**. The
mechanism is in Player Friction below. I want to be careful here: some of this
was my bot, and I fixed two real bot faults before trusting the number
(budgeting `plan.equity` rather than `plan.equityAtClose`; not buying a second
site before the first is under way). What survives those fixes is the finding.

---

## Player Friction

**1. Development almost never pencils, and the developer spends the century
waiting.** Across **all 162 runs and all nine strategies, 18 ground-up projects
were started in total** — 16 runs out of 162 built anything at all. The
developer bot's median `nothingToDo` count is **204 months — seventeen years
with no holdings, no talks and no site under construction.** It buys a lot, the
lot does not pencil at any floor count, and it sits there paying property tax
on dirt until it dies. A representative failing plan reads:

> Yield on cost is 5.87% against a 6.96% required yield (4.85% exit, tax-loaded
> to 5.95%, plus the developer margin). That is a way to build a building for
> more than it is worth.

That message is excellent — it is specific, honest and teaches the business.
The problem is that it is the answer *almost every time*, and the game offers
a development desk as a pillar.

**2. The distressed buyer has nothing to do for 73 years.** Median
**874 idle months of 1,200** (p10 545, p90 944) — months where it had money
above its reserve, went shopping, and found nothing that met its rule. It is
the safest strategy in the game and it is almost certainly the most boring to
play.

**3. The lease-up capital trap.** 847 refusals across 33 of 162 runs of the
form:

> `Signing costs $562K. You're short $391K and the line only has $0 left.`

You complete a building, a tenant arrives, and you cannot afford the tenant
improvements to sign them — so the building stays empty, the debt service
continues, and you die owning a vacant asset. This is a real risk and it
*should* exist. What makes it friction rather than difficulty is that nothing
in the development pro forma warns you that you will need this money on the far
side of construction. `planDevelopment` does include a `leaseUp` line in
`costTotal` — but it also reports `equity` and `equityAtClose` as separate
numbers, and a player who budgets to the smaller one walks into a capital call
they did not know was coming. I made exactly that mistake writing the bot, and
so does `tools/billion-2050.mjs`.

**4. The refinance desk is honest but its menu is mostly greyed out.**
I need to correct an earlier read of my own here. The desk *appears* to offer
quotes it will not honour — my probe recorded 5,617 mezzanine quotes refused
5,617 times, and the tournament logged `refinance` at an 8.4% success rate
over 210,651 attempts. **Both numbers are artifacts of my harness**, which
tried every quote returned. In fact each quote carries `available: false` and
a plain-English `why`, and in a direct test **0 of 56 available quotes failed
to execute.** The engine is internally consistent; my bot was ignoring the
flag.

The genuine friction is what remains: on a live asset the desk returns **8
products of which typically ~3 are actually fundable** (22 of 56 in the sample).
The reasons are good — "Below their minimum check", "Life-company money wants a
well-kept building. Renovate first." — but a refinance screen that lists eight
lenders and means three is a screen that has to be read carefully every single
time, on every asset, for a century.

**5. The death spiral is long, unrecoverable, and you have to sit through it.**
When cash goes negative the creditors seize one asset every ~4 months
(`insolventMs` resets to 8 after each seizure). Measured across dead runs, the
gap between cash first going negative and the run actually ending:

| Strategy | median | p90 | final NW at death | peak NW before it |
|---|---|---|---|---|
| Buy & hold unlevered | **11 yrs** | 20 yrs | −$318M | $149M |
| Aggressive | 8 yrs | **39 yrs** | −$161M | $135M |
| Levered | 7 yrs | 12 yrs | −$66M | $123M |
| Diversified | 5 yrs | 24 yrs | −$364M | $82M |

The seizure rate is far slower than the rate the hole grows, so the deficit
compounds without bound — one unlevered run reached **−$305M in cash against
zero debt** before the game ended. Up to 39 years of a run can be spent in a
state that cannot be recovered from, watching assets get taken one at a time.

**6. Unlevered buy-and-hold goes bankrupt 44% of the time.** With no debt at
all. The mechanism is the same trap as #3 at portfolio scale: cash hits zero,
the line is empty, leases cannot be signed for want of TI money, buildings go
vacant, and property tax plus G&A (charged on gross asset value) keeps running.
Net worth fell from $116M to $33M over six years while cash sat pinned at
$0.00 in one traced run. A player who has taken no leverage will not expect to
be able to go bankrupt, and the game does not warn them that liquidity — not
solvency — is what kills you.

**Numbers that disagree** — I looked for CLAUDE.md's third fake and did not
find a clean instance. The one I chased (refi quotes vs execution) turned out
to be my error, recorded above.

---

## Recommended Improvements

Ordered by measured impact. Each cites the measurement behind it.

**1. Make industrial buildable, or make its absence deliberate.**
*Evidence: 22,100 sf of industrial completions in 36 centuries, 1 of 36 runs,
vs 136M sf office; vacancy pinned at the 1.5% floor by decade 8.* Right now a
player who concentrates in industrial is in a market that cannot grow and whose
stock only shrinks. Either the class needs a supply response that can actually
trigger, or the game should say out loud that sheds are a legacy stock in this
city. **This one is not "the economy is realistically hard" — a class with zero
supply response for a century is a mechanism that never fires.**

**2. Show the whole equity cheque on the development pro forma.**
*Evidence: 18 ground-ups across 162 centuries; 847 signing-cost refusals across
33 runs; my bot and `billion-2050.mjs` both mis-budgeted the same way.* The
Costs / Financing / Equity grouping already on your list is the right place.
The specific ask: show `equity` (total, over the life of the job) at least as
prominently as `equityAtClose`, and show the lease-up reserve as money you will
need *after* delivery, not as a line inside `costTotal`.

**3. Cap or accelerate the death spiral.**
*Evidence: median 5–11 years, p90 up to 39 years, between cash going negative
and the run ending; deficits reaching −$305M against zero debt.* When the
deficit is growing faster than seizures can cover it, the outcome is already
determined. Either escalate seizures to match the burn, or call it when
negative cash exceeds the liquidation value of the book. Losing should be
decisive, not a 39-year sit.

**4. Warn on liquidity, not just solvency.**
*Evidence: unlevered buy-and-hold bankrupt 8/18; a traced run held $0.00 cash
for six years while net worth fell $116M → $33M before going negative.* There
is already a six-month warning at `insolventMs === 6`. It fires after cash is
already negative. The dangerous state is *cash near zero with committed TI
obligations and an empty line*, which is visible months earlier.

**5. Filter or rank the refinance menu.**
*Evidence: ~3 of 8 products fundable on a typical asset (22 of 56 sampled).*
The data is already there — `available` and `why` are on every quote. Default
to hiding or collapsing unavailable lenders behind a "3 of 8 lenders will quote
this" summary. This is a pure UI win with no model change.

**6. Give the distressed strategy something to do in a boom.**
*Evidence: median 874 idle months of 1,200.* This is the one where I would
push back on my own recommendation: waiting for the cycle *is* the vulture
strategy, and CLAUDE.md is explicit that difficulty from real risk is not a bug.
But 73 years of an empty screen is a UX problem even if it is a correct
economic result. The fix is probably surfacing what a vulture actually does
between cycles — watching, underwriting, building relationships — rather than
handing them deals.

**7. Look at why diversification loses.**
*Evidence: diversified $58M median and 7/18 bankrupt vs concentrated $158M and
3/18, despite measured cross-class rent correlations of only 0.16–0.35.* With
correlations that low, spreading across classes should cut risk. It did the
opposite on both axes. Either the diversification bonus is not reaching value,
or spreading thin costs more in per-asset overhead than it saves in variance.

**Explicitly NOT recommended — these are the business being hard, correctly:**
17% of balloons landing in a soft market; 46-month median vacancy recovery;
most dirt not pencilling *as a rule* (the rate is the problem, not the
existence); 45% overall bankruptcy across all strategies including deliberately
reckless ones; the rentier earning 0.87% real — a well-located unlevered asset
behaving like a boring bond is the documented intent.

---

## Notable Stories

All pulled from recorded run output; each names the run so it can be re-run.

**Melvford Sound is a different game.** *(seed 1013)* Median outcome across all
nine strategies: $146.9M real — more than the next-best city and 45× the median
city. It produced the single largest fortune in the batch: the office-
concentrated bot finished with **$718.6M real ($10.61B nominal against a 14.8×
CPI)**, off 100 acquisitions, 393 leases and 32 sales, finishing #1 of 11
survivors. On the same seed the levered bot made $558M and the diversified bot
$286M. Three different strategies all cleared a quarter-billion real on one
city — the city was the story, not the strategy.

**Whitbourne Point killed eight of nine.** *(seed 1005)* Only the distressed
buyer survived, at $16M. Its median across strategies is $0. Same generator,
same 1,275 lots, same century — and the opposite outcome to Melvford Sound.

**The forty-year second act.** *(diversified, seed 1013)* Worth **$17.5M real
in 2060** — a mediocre 3.5× on the opening cheque after sixty years — and
**$286.2M by 2100.** A 16.4× in the final forty years. The same pattern shows
up on Merwold Neck (11.1×) and twice on Ayldale Landing. A run that looks dead
at the two-thirds mark is not necessarily dead.

**56 E 6th St, bought out of distress, sold for 163.6× basis.** *(distress,
seed 1009, sold 2098 for $18.8M after 7 years.)* The largest single-asset
multiple recorded. Runner-up: 45 Tannery Rd, 101.3× after 25 years
*(levered, seed 1017)*. And 213 Milk St, held **70 years**, sold for $116.2M at
22.7× *(aggressive, seed 1016)* — the long hold that actually paid.

**Tallow Lane Partners always dies first.** *(seed 1015, Randport)* The same
PE rival fails in **2001 — year one** — in all six strategy runs on that seed.
Deterministic given the seed, which is correct, but it means Randport opens
with a rival collapse before the player has closed anything.

**Rival mortality has a clear pecking order.** 3,701 failures across 162 runs.
Opportunists die young (median 2030), developers next (2033), merchants (2034).
The patient styles last: REITs (2057), owner-users (2057), family offices
(2055). Development kills rivals on roughly the same schedule it killed my
developer bot (median death 2043) — the game is at least *consistent* about
who ground-up building destroys.

**Buried 84%, still finished at $85M real.** *(aggressive, seed 1018)* The
deepest drawdown among runs that survived. Four others finished above $67M
after drawdowns of 74–77%.

---

### Harness caveats

- **My bot is not a good player.** It uses one shared leasing/negotiation core
  across all nine strategies so the comparison is policy-vs-policy, but a human
  would beat it. Absolute wealth numbers are a floor, not a ceiling.
- **The refinance failure counts in the raw telemetry are inflated** by the bot
  trying quotes marked `available: false`. Corrected reading is in Player
  Friction #4.
- **`ddPeakM` records the last peak, not the peak preceding the max drawdown**,
  so drawdown *magnitudes* are sound but the peak→trough year pairs in
  `pt-stories.mjs` output are not. No such pair is cited above.
- **"Concentrated" selected office in 18/18 runs.** See Best Strategy.
- **No size or starting-cash sweep** — cancelled at the owner's direction.
