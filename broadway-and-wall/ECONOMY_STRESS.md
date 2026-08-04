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
buildings standing  1030          972           969
vacant lots         391           449           452
built sf            15.3M          15.5M          16.3M
mean building age   43             63             83
tallest building    14            16            20
population          240000        279267        314796
office vacancy      11.5%         3.7%          3.7%
office rent index   62             111             301
firms alive         35            12            8
street AUM          $0.0M         $713.5M       $1.28B
lots ever traded    0             214           243
city groundbreaks   0             46            97
buildings demolished0             106           158
world-activity checks passed: 4/5 (trades, city building, demolition, stock change, firm failure)
```

## 28. STRATEGY TOURNAMENT — **WEAK**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  sold  holds
valueadd     $62.0M       $27.2M       $-17.5M      $413.7M      79.7%   1         78      53    11
allcash      $45.3M       $24.3M       $2.0M        $282.9M      87.1%   0         39      7     28
merchant     $20.0M       $11.1M       $5.4M        $81.6M       43.0%   0         6       4     1
core         $6.2M        $3.1M        $0.7M        $66.1M       91.1%   1         8       2     2
landbank     $4.0M        $1.6M        $-0.1M       $10.0M       75.3%   1         17      4     3
contrarian   $-0.5M       $-0.3M       $-0.9M       $41.2M       96.2%   2         6       1     1
industrial   $-1.1M       $-0.8M       $-1.4M       $70.8M       100.5%  3         7       1     3
maxlev       $-3.8M       $-3.1M       $-48.0M      $207.0M      103.2%  3         13      0     3

strongest: valueadd at $27.2M real · weakest: maxlev at $-3.1M
the field (median strategy): $1.6M real
top strategy over the field: 16.74x   (need <= 4x)
top strategy wins 2 of 4 worlds outright: 50.0%   (need <= 70% — one right answer is a solved game)
strategies that end in the black: 5 of 8
```

## B. THE PLAYER EXISTS TO THE WORLD — 25 years, one district bought out — **BROKEN**

```
seed 550991  whale took 142 lots in exchange: land $/sf vs the rest of town 1.22x -> 1.16x, lots that changed hands there 96 -> 51, listings left standing 32 -> 0
seed 12007   whale took 116 lots in exchange: land $/sf vs the rest of town 1.05x -> 0.88x, lots that changed hands there 69 -> 22, listings left standing 8 -> 2
seed 73303   whale took 135 lots in exchange: land $/sf vs the rest of town 1.45x -> 1.25x, lots that changed hands there 88 -> 67, listings left standing 18 -> 0

difference-in-differences on district land value: -13.5%   (need >= 2% — buying a district must move its ground)
lots in the bought district that changed hands: 0.53x the control
listings still on the tape there: -18.0 versus the control (a buyer clears the shelf)
```

## C. THE STREET COMPETES — who else is bidding, and does it cost you — **WIRED**

```
seed 550991  1592 listings taken off the tape by a buyer, 1868 simply expired; 1157 of the takes were assets the player would have bought at appraisal
seed 12007   1204 listings taken off the tape by a buyer, 1046 simply expired; 753 of the takes were assets the player would have bought at appraisal
seed 73303   1578 listings taken off the tape by a buyer, 1496 simply expired; 1232 of the takes were assets the player would have bought at appraisal

share of listings that ended in a TRADE rather than an expiry: 51.3%   (need >= 15% — a tape nobody clears is a shop with no customers)
assets the player wanted and lost to somebody else: 1157 over 50 years   (need >= 10 — competition has to cost you deals)
rival holdings, end / start: 1.16x
```

## D. CREDIT IS A CONSTRAINT — pin the index loose, then tight — **WIRED**

```
                     credit loose (1.35)   credit tight (0.55)
city groundbreaks    103                   84
listings that traded 1490                  783
built stock, M sf    18.78                 18.07
office rent index    348                   52
firms still alive    19                    6

cranes, loose / tight: 1.23x   (need >= 1.15 — cheap money has to build something)
trades, loose / tight: 1.90x   (need >= 1.10 — dear money has to stop deals)
```

## E. FAILURE IS REACHABLE, AND IT IS A LADDER — **WIRED**

```
seed 550991  breach -> sweep -> workout -> foreclosure -> cured  [RUN ENDED]
seed 12007   breach -> sweep -> workout -> foreclosure -> cured  [RUN ENDED]
seed 73303   breach -> sweep -> workout -> foreclosure  [RUN ENDED]

of 3 reckless sponsors: 3 breached a covenant, 3 had cash trapped, 2 cured one,
3 reached a workout desk, 3 were foreclosed, 0 had assets seized, 3 were ended
(need every rung of the ladder to fire at least once, and at least one sponsor to survive its own breach)
```

## F. GEOGRAPHY CHANGES THE ANSWER — one strategy, five cities — **WIRED**

```
city          lots   vacant   the same core strategy, median net worth
New Alden     1421   27.5%    $34.0M   (8 bought)
Chicago       1137   37.0%    $1.9M   (3 bought)
Kestrel Point 1333   29.6%    $1.0M   (7 bought)
New York      1375   26.9%    $-0.1M   (5 bought)
Boston        1733   22.0%    $-1.3M   (2 bought)

best map over the median map: 35.06x   (need >= 1.25x — the map has to be an argument)
cities where one unchanged strategy goes broke: 3 of 5   (geography should be able to beat a plan)
```

## G. TIME COSTS SOMETHING — fifty years of doing nothing — **WIRED**

```
the opening cheque, held in the bank for 50 years:
   nominal $4.5M   ·   real $2.0M   ·   CPI 2.28x
the same cheque, spent on buildings (all-cash): real $24.3M

doing nothing, in real terms: -66.2%   (need < 0 — cash must decay)
penalty for idleness: 12.0x   (need >= 3x)
```

## 29. THE MONEY PUMP — **BROKEN**

```
buy at ask, mark at appraisal      5 cycles   net worth per cycle: +$0.5M
list high, delist, repeat         12 cycles   net worth per cycle: +$0.0M
draw the revolver, repay it       10 cycles   net worth per cycle: +$0.0M
refinance, again and again         6 cycles   net worth per cycle: $-0.1M

1 loop(s) END RICHER THAN THEY STARTED: buy at ask, mark at appraisal
```

## 30. THE BOUNDS — **WIRED**

```
a 40% policy rate                          survived 5 years · vac 9.3% · rent 85 · pop 244246
ninety per cent vacant                     survived 5 years · vac 6.6% · rent 88 · pop 254953
construction at 20x                        survived 5 years · vac 8.0% · rent 95 · pop 245513
the town half emptied                      survived 5 years · vac 11.3% · rent 81 · pop 60000
no credit at all                           survived 5 years · vac 6.0% · rent 95 · pop 249146
rents at a tenth                           survived 5 years · vac 3.7% · rent 31 · pop 258786
the player owns nothing and owes nothing   survived 5 years · vac 10.1% · rent 69 · pop 244191

7 of 7 extremes ran five years without throwing or producing a number that is not a number
```

## 31. THE FOUR QUOTES AGREE — **WEAK**

```
sampled 400 standing buildings at year 10
rank corr(appraisal, senior advance):  0.862   (need >= 0.6 — the desk and the appraiser read the same building)
rank corr(income,    senior advance):  0.886   (a loan is sized on income, so this should be the tighter of the two)
rank corr(income,    appraisal):       0.974
advance rate: median 45.5%, worst 62.0%   (nothing may exceed 100% of appraisal)
lenders advancing MORE than the building is worth: 0
which test actually capped the loan: credit 200 · dscr 200
   (a desk where one test binds every time is a desk with two decorative tests)
the tape against the appraisal: median 0.75x over 21 live listings
```

## 34. THE LONG TAIL OF SEEDS — **WIRED**

```
4 worlds, one core strategy, 50 years each:
   worst $0.6M   p25 $3.1M   median $3.1M   p75 $28.9M   best $28.9M
   wipeouts: 1 of 4   ·   median holdings 2

p75 / p25: 9.32x   (need 1.3x to 12x — narrower is a world with no weather, wider is a lottery)
share of worlds a competent operator survives: 75.0%   (need >= 60%)
```

## 35. THE HUMAN CLOCK — **WIRED**

```
                    months with a letter   a buy   a site that pencils   ANY move   longest dead stretch
seed 550991      51                    598     423                   600        0 months
seed 12007       23                    479     481                   600        0 months
seed 73303       45                    584     512                   600        0 months

share of a fifty-year run with something on the table: 100.0%   (need >= 60%)
longest stretch with nothing at all: 0 months   (need <= 18 — a player should never press Next for two years)
```

## 32. NUMERICAL HYGIENE — **WIRED**

```
no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.
```

