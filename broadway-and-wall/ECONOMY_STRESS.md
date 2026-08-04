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
buildings standing  1030          983           969
vacant lots         391           438           452
built sf            15.3M          15.5M          17.3M
mean building age   43             62             80
tallest building    14            18            21
population          240000        298881        368145
office vacancy      11.5%         9.1%          3.7%
office rent index   62             183             332
firms alive         35            25            17
street AUM          $0.0M         $1.39B        $1.74B
lots ever traded    0             206           263
city groundbreaks   0             57            124
buildings demolished0             106           185
world-activity checks passed: 5/5 (trades, city building, demolition, stock change, firm failure)
```

## 28. STRATEGY TOURNAMENT — **WEAK**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  sold  holds
allcash      $331.5M      $116.8M      $208.1M      $637.5M      27.5%   0         43      6     34
maxlev       $323.0M      $97.2M       $-1.2M       $2.45B       73.4%   1         84      7     52
core         $133.1M      $42.9M       $-0.2M       $1.10B       69.1%   1         14      3     5
industrial   $32.0M       $11.1M       $-0.0M       $134.2M      55.6%   1         11      2     4
merchant     $2.8M        $1.2M        $-1.3M       $110.8M      92.4%   1         2       0     1
landbank     $2.2M        $0.7M        $-0.2M       $7.2M        71.2%   1         15      5     1
valueadd     $-0.1M       $-0.1M       $-3.1M       $1.59B       53.1%   2         8       0     7
contrarian   $-2.1M       $-1.8M       $-2.5M       $279.1M      87.9%   2         6       2     4

strongest: allcash at $116.8M real · weakest: contrarian at $-1.8M
the field (median strategy): $1.2M real
top strategy over the field: 98.50x   (need <= 4x)
top strategy wins 1 of 4 worlds outright: 25.0%   (need <= 70% — one right answer is a solved game)
strategies that end in the black: 5 of 8
```

## B. THE PLAYER EXISTS TO THE WORLD — 25 years, one district bought out — **BROKEN**

```
seed 550991  whale took 142 lots in exchange: land $/sf vs the rest of town 1.55x -> 1.03x, lots that changed hands there 98 -> 65, listings left standing 4 -> 0
seed 12007   whale took 116 lots in exchange: land $/sf vs the rest of town 1.33x -> 1.24x, lots that changed hands there 78 -> 35, listings left standing 7 -> 0
seed 73303   whale took 130 lots in exchange: land $/sf vs the rest of town 1.36x -> 1.46x, lots that changed hands there 86 -> 47, listings left standing 13 -> 0

difference-in-differences on district land value: -6.6%   (need >= 2% — buying a district must move its ground)
lots in the bought district that changed hands: 0.55x the control
listings still on the tape there: -7.0 versus the control (a buyer clears the shelf)
```

## C. THE STREET COMPETES — who else is bidding, and does it cost you — **WIRED**

```
seed 550991  1298 listings taken off the tape by a buyer, 798 simply expired; 789 of the takes were assets the player would have bought at appraisal
seed 12007   1293 listings taken off the tape by a buyer, 828 simply expired; 729 of the takes were assets the player would have bought at appraisal
seed 73303   1430 listings taken off the tape by a buyer, 831 simply expired; 904 of the takes were assets the player would have bought at appraisal

share of listings that ended in a TRADE rather than an expiry: 61.1%   (need >= 15% — a tape nobody clears is a shop with no customers)
assets the player wanted and lost to somebody else: 789 over 50 years   (need >= 10 — competition has to cost you deals)
rival holdings, end / start: 1.58x
```

## D. CREDIT IS A CONSTRAINT — pin the index loose, then tight — **WEAK**

```
                     credit loose (1.35)   credit tight (0.55)
city groundbreaks    116                   101
listings that traded 1699                  765
built stock, M sf    19.32                 19.15
office rent index    245                   297
firms still alive    14                    24

cranes, loose / tight: 1.15x   (need >= 1.15 — cheap money has to build something)
trades, loose / tight: 2.22x   (need >= 1.10 — dear money has to stop deals)
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
New Alden     1421   27.5%    $133.1M   (14 bought)
Kestrel Point 1333   29.6%    $106.8M   (9 bought)
Boston        1733   22.0%    $26.4M   (8 bought)
Chicago       1137   37.0%    $-0.2M   (4 bought)
New York      1375   26.9%    $-0.5M   (2 bought)

best map over the median map: 5.03x   (need >= 1.25x — the map has to be an argument)
cities where one unchanged strategy goes broke: 2 of 5   (geography should be able to beat a plan)
```

## G. TIME COSTS SOMETHING — fifty years of doing nothing — **WIRED**

```
the opening cheque, held in the bank for 50 years:
   nominal $3.9M   ·   real $1.3M   ·   CPI 2.95x
the same cheque, spent on buildings (all-cash): real $141.0M

doing nothing, in real terms: -78.1%   (need < 0 — cash must decay)
penalty for idleness: 107.1x   (need >= 3x)
```

## 29. THE MONEY PUMP — **WIRED**

```
buy at ask, mark at appraisal      6 cycles   net worth per cycle: $-0.5M
list high, delist, repeat         12 cycles   net worth per cycle: +$0.0M
draw the revolver, repay it       10 cycles   net worth per cycle: +$0.0M
refinance, again and again         6 cycles   net worth per cycle: $-0.1M

every loop costs money to run. There is no free round trip in this economy.
```

## 30. THE BOUNDS — **WIRED**

```
a 40% policy rate                          survived 5 years · vac 7.7% · rent 89 · pop 253006
ninety per cent vacant                     survived 5 years · vac 7.9% · rent 83 · pop 259163
construction at 20x                        survived 5 years · vac 7.6% · rent 92 · pop 254629
the town half emptied                      survived 5 years · vac 11.2% · rent 75 · pop 60000
no credit at all                           survived 5 years · vac 9.9% · rent 83 · pop 251800
rents at a tenth                           survived 5 years · vac 3.7% · rent 31 · pop 269273
the player owns nothing and owes nothing   survived 5 years · vac 9.8% · rent 70 · pop 246562

7 of 7 extremes ran five years without throwing or producing a number that is not a number
```

## 31. THE FOUR QUOTES AGREE — **WIRED**

```
sampled 400 standing buildings at year 10
rank corr(appraisal, senior advance):  0.806   (need >= 0.6 — the desk and the appraiser read the same building)
rank corr(income,    senior advance):  0.800   (a loan is sized on income, so this should be the tighter of the two)
rank corr(income,    appraisal):       0.994
advance rate: median 49.2%, worst 69.1%   (nothing may exceed 100% of appraisal)
lenders advancing MORE than the building is worth: 0
which test actually capped the loan: credit 268 · dscr 104 · ltv 28
   (a desk where one test binds every time is a desk with two decorative tests)
the tape against the appraisal: median 0.94x over 24 live listings
```

## 34. THE LONG TAIL OF SEEDS — **WIRED**

```
4 worlds, one core strategy, 50 years each:
   worst $-0.1M   p25 $42.9M   median $42.9M   p75 $409.9M   best $409.9M
   wipeouts: 1 of 4   ·   median holdings 5

p75 / p25: 9.57x   (need 1.3x to 12x — narrower is a world with no weather, wider is a lottery)
share of worlds a competent operator survives: 75.0%   (need >= 60%)
```

## 35. THE HUMAN CLOCK — **WIRED**

```
                    months with a letter   a buy   a site that pencils   ANY move   longest dead stretch
seed 550991      73                    556     522                   594        3 months
seed 12007       92                    596     555                   600        0 months
seed 73303       8                     93      554                   597        3 months

share of a fifty-year run with something on the table: 99.5%   (need >= 60%)
longest stretch with nothing at all: 3 months   (need <= 18 — a player should never press Next for two years)
```

## 32. NUMERICAL HYGIENE — **WIRED**

```
no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.
```

