# ECONOMY STRESS TEST — Broadway & Wall

`pnpm stress` · 4 market seeds × 50 sim years · city seed 20261.

Companion to ECONOMY_AUDIT.md. That report asks whether a shock in one place moves the right things elsewhere. This one asks whether the world exists without the player, whether the player exists to the world, whether there is a dominant strategy, and whether the engine survives being pushed to its bounds.

## 33. DETERMINISM — **WIRED**

```
3/3 seeds reproduced bit-for-bit over 50 years
save/load round trip after 15 years, then 10 more: identical
```

## A. THE NULL PLAYER — 50 years, nobody playing — **WIRED**

```
                    year 0        year 25       year 50
buildings standing  1030          1009          990
vacant lots         391           412           431
built sf            15.3M          16.0M          16.7M
mean building age   43             63             82
tallest building    14            15            19
population          240000        283058        294797
office vacancy      11.5%         6.0%          16.5%
office rent index   62             185             249
firms alive         35            24            16
street AUM          $0.0M         $2.22B        $2.34B
lots ever traded    0             207           263
city groundbreaks   0             51            107
buildings demolished0             72            151
world-activity checks passed: 5/5 (trades, city building, demolition, stock change, firm failure)
```

## 28. STRATEGY TOURNAMENT — **WEAK**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  sold  holds
maxlev       $284.2M      $102.7M      $-0.5M       $344.9M      68.0%   1         48      7     23
valueadd     $52.0M       $22.7M       $-37.2M      $353.6M      84.0%   1         65      37    9
merchant     $14.0M       $9.4M        $-6.8M       $65.7M       74.9%   1         6       5     1
industrial   $6.9M        $5.6M        $-0.1M       $162.3M      76.6%   1         9       2     0
core         $2.3M        $1.3M        $-1.8M       $5.2M        101.0%  1         10      1     1
landbank     $1.7M        $0.7M        $0.2M        $2.9M        78.9%   1         17      4     2
contrarian   $-0.1M       $-0.1M       $-0.4M       $212.2M      101.3%  3         4       0     0
allcash      $-22.5M      $-14.6M      $-84.5M      $260.4M      100.2%  3         19      1     0

strongest: maxlev at $102.7M real · weakest: allcash at $-14.6M
the field (median strategy): $1.3M real
top strategy over the field: 81.29x   (need <= 4x)
top strategy wins 2 of 4 worlds outright: 50.0%   (need <= 70% — one right answer is a solved game)
strategies that end in the black: 5 of 8
```

## B. THE PLAYER EXISTS TO THE WORLD — 25 years, one district bought out — **BROKEN**

```
seed 550991  whale took 141 lots in exchange: land $/sf vs the rest of town 1.69x -> 1.25x, lots that changed hands there 93 -> 41, listings left standing 9 -> 0
seed 12007   whale took 115 lots in exchange: land $/sf vs the rest of town 0.99x -> 1.30x, lots that changed hands there 85 -> 30, listings left standing 9 -> 0
seed 73303   whale took 125 lots in exchange: land $/sf vs the rest of town 1.28x -> 0.90x, lots that changed hands there 94 -> 58, listings left standing 10 -> 4

difference-in-differences on district land value: -26.0%   (need >= 2% — buying a district must move its ground)
lots in the bought district that changed hands: 0.44x the control
listings still on the tape there: -9.0 versus the control (a buyer clears the shelf)
```

## C. THE STREET COMPETES — who else is bidding, and does it cost you — **WIRED**

```
seed 550991  1433 listings taken off the tape by a buyer, 1360 simply expired; 1051 of the takes were assets the player would have bought at appraisal
seed 12007   1165 listings taken off the tape by a buyer, 1247 simply expired; 677 of the takes were assets the player would have bought at appraisal
seed 73303   1459 listings taken off the tape by a buyer, 1233 simply expired; 1012 of the takes were assets the player would have bought at appraisal

share of listings that ended in a TRADE rather than an expiry: 53.5%   (need >= 15% — a tape nobody clears is a shop with no customers)
assets the player wanted and lost to somebody else: 1012 over 50 years   (need >= 10 — competition has to cost you deals)
rival holdings, end / start: 1.43x
```

## D. CREDIT IS A CONSTRAINT — pin the index loose, then tight — **WIRED**

```
                     credit loose (1.35)   credit tight (0.55)
city groundbreaks    96                    71
listings that traded 1788                  761
built stock, M sf    18.49                 18.16
office rent index    263                   31
firms still alive    8                     12

cranes, loose / tight: 1.35x   (need >= 1.15 — cheap money has to build something)
trades, loose / tight: 2.35x   (need >= 1.10 — dear money has to stop deals)
```

## E. FAILURE IS REACHABLE, AND IT IS A LADDER — **WIRED**

```
seed 550991  breach -> sweep -> workout -> foreclosure -> cured  [RUN ENDED]
seed 12007   breach -> sweep -> workout -> foreclosure -> cured
seed 73303   breach -> sweep -> workout -> foreclosure  [RUN ENDED]

of 3 reckless sponsors: 3 breached a covenant, 3 had cash trapped, 2 cured one,
3 reached a workout desk, 3 were foreclosed, 0 had assets seized, 2 were ended
(need every rung of the ladder to fire at least once, and at least one sponsor to survive its own breach)
```

## F. GEOGRAPHY CHANGES THE ANSWER — one strategy, five cities — **WIRED**

```
city          lots   vacant   the same core strategy, median net worth
Boston        1733   22.0%    $26.1M   (12 bought)
Kestrel Point 1333   29.6%    $1.0M   (6 bought)
Chicago       1137   37.0%    $-0.1M   (3 bought)
New York      1375   26.9%    $-0.4M   (4 bought)
New Alden     1421   27.5%    $-1.8M   (6 bought)

best map over the median map: unbounded   (need >= 1.25x — the map has to be an argument)
cities where one unchanged strategy goes broke: 4 of 5   (geography should be able to beat a plan)
```

## G. TIME COSTS SOMETHING — fifty years of doing nothing — **WEAK**

```
the opening cheque, held in the bank for 50 years:
   nominal $5.3M   ·   real $2.4M   ·   CPI 2.18x
the same cheque, spent on buildings (all-cash): real $-0.1M

doing nothing, in real terms: -59.7%   (need < 0 — cash must decay)
penalty for idleness: -0.0x   (need >= 3x)
```

## 29. THE MONEY PUMP — **WIRED**

```
buy at ask, mark at appraisal      7 cycles   net worth per cycle: $-0.3M
list high, delist, repeat         12 cycles   net worth per cycle: +$0.0M
draw the revolver, repay it       10 cycles   net worth per cycle: +$0.0M
refinance, again and again         6 cycles   net worth per cycle: $-0.2M

every loop costs money to run. There is no free round trip in this economy.
```

## 30. THE BOUNDS — **WIRED**

```
a 40% policy rate                          survived 5 years · vac 7.6% · rent 91 · pop 249946
ninety per cent vacant                     survived 5 years · vac 7.7% · rent 88 · pop 261954
construction at 20x                        survived 5 years · vac 7.9% · rent 97 · pop 246401
the town half emptied                      survived 5 years · vac 13.7% · rent 76 · pop 60000
no credit at all                           survived 5 years · vac 7.8% · rent 89 · pop 248327
rents at a tenth                           survived 5 years · vac 3.7% · rent 31 · pop 264899
the player owns nothing and owes nothing   survived 5 years · vac 9.6% · rent 70 · pop 246702

7 of 7 extremes ran five years without throwing or producing a number that is not a number
```

## 31. THE FOUR QUOTES AGREE — **WIRED**

```
sampled 400 standing buildings at year 10
rank corr(appraisal, senior advance):  0.934   (need >= 0.6 — the desk and the appraiser read the same building)
rank corr(income,    senior advance):  0.954   (a loan is sized on income, so this should be the tighter of the two)
rank corr(income,    appraisal):       0.966
advance rate: median 49.7%, worst 67.9%   (nothing may exceed 100% of appraisal)
lenders advancing MORE than the building is worth: 0
which test actually capped the loan: credit 228 · dscr 158 · ltv 14
   (a desk where one test binds every time is a desk with two decorative tests)
the tape against the appraisal: median 0.96x over 28 live listings
```

## 34. THE LONG TAIL OF SEEDS — **WIRED**

```
4 worlds, one core strategy, 50 years each:
   worst $-1.3M   p25 $1.3M   median $1.3M   p75 $3.1M   best $3.1M
   wipeouts: 1 of 4   ·   median holdings 1

p75 / p25: 2.43x   (need 1.3x to 12x — narrower is a world with no weather, wider is a lottery)
share of worlds a competent operator survives: 75.0%   (need >= 60%)
```

## 35. THE HUMAN CLOCK — **WIRED**

```
                    months with a letter   a buy   a site that pencils   ANY move   longest dead stretch
seed 550991      18                    151     559                   600        0 months
seed 12007       108                   595     537                   600        0 months
seed 73303       51                    581     539                   600        0 months

share of a fifty-year run with something on the table: 100.0%   (need >= 60%)
longest stretch with nothing at all: 0 months   (need <= 18 — a player should never press Next for two years)
```

## 32. NUMERICAL HYGIENE — **WIRED**

```
no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.
```

