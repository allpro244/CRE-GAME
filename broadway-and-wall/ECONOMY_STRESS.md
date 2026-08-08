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
buildings standing  800           796           795
vacant lots         563           567           568
built sf            11.0M          13.3M          14.4M
mean building age   42             50             52
tallest building    14            20            20
population          43451         54813         55681
office vacancy      15.4%         14.4%         8.7%
office rent index   37             98             205
firms alive         33            33            34
street AUM          $0.0M         $698.0M       $1.89B
lots ever traded    0             286           322
city groundbreaks   0             160           201
buildings demolished0             164           208
world-activity checks passed: 4/5 (trades, city building, demolition, stock change, firm failure)
```

## 28. STRATEGY TOURNAMENT — **WEAK**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  sold  holds
allcash      $42.1M       $20.7M       $-1.1M       $1.44B       52.4%   2         24      4     17
valueadd     $24.6M       $17.3M       $-0.2M       $238.9M      72.2%   2         47      29    9
maxlev       $63.4M       $13.6M       $-5.9M       $325.9M      61.1%   2         49      5     27
core         $16.5M       $5.6M        $-0.1M       $284.4M      49.6%   1         2       0     1
industrial   $1.7M        $0.4M        $-0.4M       $20.9M       77.1%   2         11      2     1
merchant     $-0.2M       $-0.1M       $-0.2M       $-0.1M       104.3%  6         1       0     0
contrarian   $-0.3M       $-0.1M       $-0.4M       $86.5M       106.7%  4         5       0     0
landbank     $-1.4M       $-1.4M       $-3.7M       $3.9M        105.5%  5         18      2     0

strongest: allcash at $20.7M real · weakest: landbank at $-1.4M
the field (median strategy): $0.4M real
top strategy over the field: 53.25x   (need <= 4x)
top strategy wins 2 of 6 worlds outright: 33.3%   (need <= 70% — one right answer is a solved game)
strategies that end in the black: 4 of 8
```

## B. THE PLAYER EXISTS TO THE WORLD — 25 years, one district bought out — **WEAK**

```
seed 550991  whale took 153 lots in exchange: land $/sf vs the rest of town 0.88x -> 0.58x, lots that changed hands there 124 -> 72, listings left standing 5 -> 2
seed 12007   whale took 180 lots in exchange: land $/sf vs the rest of town 1.09x -> 0.75x, lots that changed hands there 129 -> 60, listings left standing 9 -> 1
seed 73303   whale took 159 lots in exchange: land $/sf vs the rest of town 1.59x -> 0.94x, lots that changed hands there 135 -> 54, listings left standing 5 -> 2

difference-in-differences on district land value: -34.0%   (need >= 2% — buying a district must move its ground)
lots in the bought district that changed hands: 0.47x the control   (must MOVE — a whale is a sink, not a source)
listings still on the tape there: -3.0 versus the control (a buyer clears the shelf)
```

## C. THE STREET COMPETES — who else is bidding, and does it cost you — **WIRED**

```
seed 550991  604 listings taken off the tape by a buyer, 508 simply expired; 312 of the takes were assets the player would have bought at appraisal
seed 12007   609 listings taken off the tape by a buyer, 443 simply expired; 386 of the takes were assets the player would have bought at appraisal
seed 73303   669 listings taken off the tape by a buyer, 510 simply expired; 300 of the takes were assets the player would have bought at appraisal

share of listings that ended in a TRADE rather than an expiry: 54.5%   (need >= 15% — a tape nobody clears is a shop with no customers)
assets the player wanted and lost to somebody else: 312 over 50 years   (need >= 10 — competition has to cost you deals)
rival holdings, end / start: 1.10x
```

## D. CREDIT IS A CONSTRAINT — pin the index loose, then tight — **WEAK**

```
                     credit loose (1.35)   credit tight (0.55)
city groundbreaks    198                   181
listings that traded 672                   286
built stock, M sf    14.45                 14.10
office rent index    158                   209
firms still alive    33                    34

cranes, loose / tight: 1.09x   (need >= 1.15 — cheap money has to build something)
trades, loose / tight: 2.35x   (need >= 1.10 — dear money has to stop deals)
```

## E. FAILURE IS REACHABLE, AND IT IS A LADDER — **WIRED**

```
seed 550991  breach -> sweep -> workout -> foreclosure -> cured
seed 12007   breach -> sweep -> workout -> foreclosure -> cured
seed 73303   breach -> sweep -> workout -> foreclosure -> cured  [RUN ENDED]

of 3 reckless sponsors: 3 breached a covenant, 3 had cash trapped, 3 cured one,
3 reached a workout desk, 3 were foreclosed, 0 had assets seized, 1 were ended
(need every rung of the ladder to fire at least once, and at least one sponsor to survive its own breach)
```

## F. GEOGRAPHY CHANGES THE ANSWER — one strategy, five cities — **WIRED**

```
city          lots   vacant   the same core strategy, median net worth
New Alden     1363   41.3%    $16.5M   (2 bought)
Kestrel Point 1298   39.9%    $-0.2M   (0 bought)

best map over the median map: unbounded   (need >= 1.25x — the map has to be an argument)
cities where one unchanged strategy goes broke: 1 of 2   (geography should be able to beat a plan)
```

## G. TIME COSTS SOMETHING — fifty years of doing nothing — **WEAK**

```
the opening cheque, held in the bank for 50 years:
   nominal $-0.1M   ·   real $-0.1M   ·   CPI 2.31x
the same cheque, spent on buildings (all-cash): real $-0.0M

doing nothing, in real terms: -100.9%   (need < 0 — cash must decay)
penalty for idleness: -21066.4x   (need >= 3x)
```

## 29. THE MONEY PUMP — **WIRED**

```
buy at ask, mark at appraisal      6 cycles   net worth per cycle: $-0.1M
list high, delist, repeat         12 cycles   net worth per cycle: +$0.0M
draw the revolver, repay it       10 cycles   net worth per cycle: +$0.0M
refinance, again and again         0 cycles   net worth per cycle: n/a — the loop does not run

every loop costs money to run. There is no free round trip in this economy.
```

## 30. THE BOUNDS — **WIRED**

```
a 40% policy rate                          survived 5 years · vac 5.3% · rent 69 · pop 44348
ninety per cent vacant                     survived 5 years · vac 3.7% · rent 50 · pop 46400
construction at 20x                        survived 5 years · vac 6.8% · rent 50 · pop 44010
the town half emptied                      survived 5 years · vac 4.3% · rent 86 · pop 10863
no credit at all                           survived 5 years · vac 4.2% · rent 83 · pop 44409
rents at a tenth                           survived 5 years · vac 3.7% · rent 22 · pop 44312
the player owns nothing and owes nothing   survived 5 years · vac 9.8% · rent 43 · pop 43628

7 of 7 extremes ran five years without throwing or producing a number that is not a number
```

## 31. THE FOUR QUOTES AGREE — **WIRED**

```
sampled 400 standing buildings at year 10
rank corr(appraisal, senior advance):  0.795   (need >= 0.6 — the desk and the appraiser read the same building)
rank corr(income,    senior advance):  0.972   (a loan is sized on income, so this should be the tighter of the two)
rank corr(income,    appraisal):       0.819
advance rate: median 41.4%, worst 68.0%   (nothing may exceed 100% of appraisal)
lenders advancing MORE than the building is worth: 0
which test actually capped the loan: dy 207 · credit 104 · ltv 61 · appraisal 18 · dscr 10
   (a desk where one test binds every time is a desk with two decorative tests)
the tape against the appraisal: median 0.93x over 22 live listings
```

## 34. THE LONG TAIL OF SEEDS — **WIRED**

```
6 worlds, one core strategy, 50 years each:
   worst $-0.1M   p25 $5.3M   median $5.6M   p75 $10.4M   best $35.3M
   wipeouts: 1 of 6   ·   median holdings 1

p75 / p25: 1.96x   (need 1.3x to 12x — narrower is a world with no weather, wider is a lottery)
share of worlds a competent operator survives: 83.3%   (need >= 60%)
```

## 35. THE HUMAN CLOCK — **WIRED**

```
                    months with a letter   a buy   a site that pencils   ANY move   longest dead stretch
seed 550991      26                    571     288                   585        7 months
seed 12007       35                    598     253                   598        2 months
seed 73303       30                    504     60                    529        12 months

share of a fifty-year run with something on the table: 97.5%   (need >= 60%)
longest stretch with nothing at all: 12 months   (need <= 18 — a player should never press Next for two years)
```

## 32. NUMERICAL HYGIENE — **WIRED**

```
no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.
```

