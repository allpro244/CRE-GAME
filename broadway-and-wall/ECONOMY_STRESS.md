# ECONOMY STRESS TEST — Broadway & Wall

`pnpm stress` · 6 market seeds × 50 sim years · city seed 20261.

Companion to ECONOMY_AUDIT.md. That report asks whether a shock in one place moves the right things elsewhere. This one asks whether the world exists without the player, whether the player exists to the world, whether there is a dominant strategy, and whether the engine survives being pushed to its bounds.

## 33. DETERMINISM — **WIRED**

```
3/3 seeds reproduced bit-for-bit over 50 years
save/load round trip after 15 years, then 10 more: identical
```

## A. THE NULL PLAYER — 50 years, nobody playing — **WIRED**

```
                    year 0        year 25       year 50
buildings standing  948           975           999
vacant lots         645           618           594
built sf            10.0M          11.7M          13.3M
mean building age   44             66             76
tallest building    14            21            27
population          31793         39952         44036
office vacancy      15.4%         6.2%          4.6%
office rent index   30             70             107
firms alive         29            25            25
street AUM          $0.0M         $345.1M       $434.6M
lots ever traded    0             527           608
city groundbreaks   0             43            79
buildings demolished0             16            28
world-activity checks passed: 5/5 (trades, city building, demolition, stock change, firm failure)
```

## 28. STRATEGY TOURNAMENT — **WEAK**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  sold  holds
merchant     $-6.9M       $-3.6M       $-12.6M      $-0.1M       107.9%  6         1       0     0
industrial   $-5.8M       $-4.7M       $-31.0M      $171.2M      227.4%  5         11      1     1
contrarian   $-7.9M       $-7.1M       $-299.2M     $-3.8M       251.1%  6         13      1     1
landbank     $-14.2M      $-12.6M      $-40.4M      $-5.5M       347.2%  6         18      0     0
core         $-15.5M      $-13.6M      $-43.7M      $-5.3M       219.7%  6         6       0     0
allcash      $-16.3M      $-14.3M      $-49.6M      $-1.7M       378.9%  6         18      0     0
maxlev       $-36.8M      $-32.7M      $-100.7M     $-4.8M       608.3%  6         31      1     0
valueadd     $-55.8M      $-47.2M      $-170.3M     $-3.3M       387.7%  6         14      1     0

strongest: merchant at $-3.6M real · weakest: valueadd at $-47.2M
the field (median strategy): $-13.6M real
top strategy over the field: unbounded — the median strategy loses money   (need <= 4x)
top strategy wins 3 of 6 worlds outright: 50.0%   (need <= 70% — one right answer is a solved game)
strategies that end in the black: 0 of 8

did each strategy actually trade?
   merchant     bought   1  sold   0  built   1
   industrial   bought  11  sold   1  built   0
   contrarian   bought  13  sold   1  built   0
   landbank     bought  18  sold   0  built   0
   core         bought   6  sold   0  built   0
   allcash      bought  18  sold   0  built   0
   maxlev       bought  31  sold   1  built   0
   valueadd     bought  14  sold   1  built   0
```

## B. THE PLAYER EXISTS TO THE WORLD — 25 years, one district bought out — **WEAK**

```
seed 550991  whale took 251 lots in thechange: land $/sf vs the rest of town 3.75x -> 2.45x, lots that changed hands there 196 -> 73, listings left standing 6 -> 0
seed 12007   whale took 247 lots in thechange: land $/sf vs the rest of town 10.79x -> 29.64x, lots that changed hands there 206 -> 87, listings left standing 9 -> 0
seed 73303   whale took 219 lots in thechange: land $/sf vs the rest of town 41.58x -> 22.20x, lots that changed hands there 206 -> 78, listings left standing 8 -> 0

difference-in-differences on district land value: -34.7%   (need >= 2% — buying a district must move its ground)
lots in the bought district that changed hands: 0.38x the control   (must MOVE — a whale is a sink, not a source)
listings still on the tape there: -8.0 versus the control (a buyer clears the shelf)
```

## C. THE STREET COMPETES — who else is bidding, and does it cost you — **WEAK**

```
seed 550991  1018 listings taken off the tape by a buyer, 655 simply expired; 548 of the takes were assets the player would have bought at appraisal
seed 12007   1153 listings taken off the tape by a buyer, 675 simply expired; 754 of the takes were assets the player would have bought at appraisal
seed 73303   796 listings taken off the tape by a buyer, 599 simply expired; 472 of the takes were assets the player would have bought at appraisal

share of listings that ended in a TRADE rather than an expiry: 60.8%   (need >= 15% — a tape nobody clears is a shop with no customers)
assets the player wanted and lost to somebody else: 548 over 50 years   (need >= 10 — competition has to cost you deals)
rival holdings, end / start: 0.23x
```

## D. CREDIT IS A CONSTRAINT — pin the index loose, then tight — **WEAK**

```
                     credit loose (1.35)   credit tight (0.55)
city groundbreaks    77                    97
listings that traded 942                   625
built stock, M sf    10.49                 12.04
office rent index    18                    118
firms still alive    13                    26

cranes, loose / tight: 0.79x   (need >= 1.15 — cheap money has to build something)
trades, loose / tight: 1.51x   (need >= 1.10 — dear money has to stop deals)
```

## E. FAILURE IS REACHABLE, AND IT IS A LADDER — **WIRED**

```
seed 550991  breach -> sweep -> workout -> foreclosure  [RUN ENDED]
seed 12007   breach -> sweep  [RUN ENDED]
seed 73303   breach -> sweep -> cured  [RUN ENDED]

of 3 reckless sponsors: 3 breached a covenant, 3 had cash trapped, 1 cured one,
1 reached a workout desk, 1 were foreclosed, 0 had assets seized, 3 were ended
(need every rung of the ladder to fire at least once, and at least one sponsor to survive its own breach)
```

## F. GEOGRAPHY CHANGES THE ANSWER — one strategy, five cities — **WIRED**

```
city          lots   vacant   the same core strategy, median net worth
Yarfield Head 1467   41.0%    $-9.5M   (7 bought)
Barrworth Landing1298   36.9%    $-12.7M   (7 bought)
Stancliff Landing1471   40.1%    $-34.2M   (2 bought)
Stanton Bight 1593   40.5%    $-43.7M   (3 bought)
Duncliff Head 1213   35.0%    $-163.9M   (11 bought)

best map over the median map: unbounded   (need >= 1.25x — the map has to be an argument)
cities where one unchanged strategy goes broke: 5 of 5   (geography should be able to beat a plan)
```

## G. TIME COSTS SOMETHING — fifty years of doing nothing — **BROKEN**

```
the opening cheque is $2.5M, read from the engine — 6 seeds, 50 years

S1  doing nothing is fatal:   insolvent in 4 of 6 runs   (need 6 of 6)
      months to insolvency: 455  448  434  317  —  —   median 434 (year 36.2)
S2  buying beats sitting:     in 0 of 6 worlds   (need 6 of 6)
      buyer's real return: -673%  -1831%  -206%  -663%  -1079%  -166%
      and it COMPOUNDS (>0) in 0 of 6 — a world where both arms lose is a
      different story from one where the buyer merely trails the bank
S3  cash decays:              real return < 0 in 6 of 6   (need 6 of 6)
      per seed: -102%  -102%  -101%  -101%  -28%  -100%

each arm is deflated by its OWN world's price level — one of them stops at year 36 and the other runs to 50, so there is no single "end of the measurement" to share
```

## 29. THE MONEY PUMP — **WIRED**

```
buy at ask, mark at appraisal      8 cycles   net worth per cycle: $-0.3M
list high, delist, repeat         12 cycles   net worth per cycle: +$0.0M
draw the revolver, repay it       10 cycles   net worth per cycle: +$0.0M
refinance, again and again         6 cycles   net worth per cycle: $-0.0M

every loop costs money to run. There is no free round trip in this economy.
```

## 30. THE BOUNDS — **WIRED**

```
a 40% policy rate                          survived 5 years · vac 3.7% · rent 31 · pop 32787
ninety per cent vacant                     survived 5 years · vac 9.6% · rent 22 · pop 31058
construction at 20x                        survived 5 years · vac 10.5% · rent 27 · pop 32048
the town half emptied                      survived 5 years · vac 41.3% · rent 19 · pop 7948
no credit at all                           survived 5 years · vac 3.7% · rent 32 · pop 33035
rents at a tenth                           survived 5 years · vac 3.7% · rent 18 · pop 32464
the player owns nothing and owes nothing   survived 5 years · vac 15.0% · rent 27 · pop 31756

7 of 7 extremes ran five years without throwing or producing a number that is not a number
```

## 31. THE FOUR QUOTES AGREE — **WIRED**

```
sampled 400 standing buildings at year 10
rank corr(appraisal, senior advance):  0.941   (need >= 0.6 — the desk and the appraiser read the same building)
rank corr(income,    senior advance):  0.995   (a loan is sized on income, so this should be the tighter of the two)
rank corr(income,    appraisal):       0.939
advance rate: median 49.1%, worst 69.4%   (nothing may exceed 100% of appraisal)
lenders advancing MORE than the building is worth: 0
which test actually capped the loan: dy 237 · credit 128 · appraisal 20 · ltv 15
   (a desk where one test binds every time is a desk with two decorative tests)
the tape against the appraisal: median 0.99x over 17 live listings
```

## 34. THE LONG TAIL OF SEEDS — **BROKEN**

```
6 worlds, one core strategy, 50 years each:
   worst $-32.7M   p25 $-29.8M   median $-13.6M   p75 $-5.2M   best $-5.1M
   wipeouts: 6 of 6   ·   median holdings 0

p75 / p25: -5174888.77x   (need 1.3x to 12x — narrower is a world with no weather, wider is a lottery)
share of worlds a competent operator survives: 0.0%   (need >= 60%)
```

## 35. THE HUMAN CLOCK — **BROKEN**

```
                    months with a letter   a buy   a site that pencils   ANY move   longest dead stretch
seed 550991      18                    233     56                    241        345 months
seed 12007       144                   594     140                   594        5 months
seed 73303       5                     34      0                     38         550 months

share of a fifty-year run with something on the table: 40.2%   (need >= 60%)
longest stretch with nothing at all: 550 months   (need <= 18 — a player should never press Next for two years)
```

## 32. NUMERICAL HYGIENE — **WIRED**

```
no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.
```

