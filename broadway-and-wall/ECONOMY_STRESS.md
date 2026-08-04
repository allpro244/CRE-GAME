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
buildings standing  1030          979           953
vacant lots         391           442           468
built sf            15.3M          15.9M          17.6M
mean building age   43             63             81
tallest building    14            19            25
population          240000        283942        342943
office vacancy      11.5%         5.1%          8.3%
office rent index   62             107             256
firms alive         35            18            19
street AUM          $0.0M         $548.2M       $3.76B
lots ever traded    0             226           260
city groundbreaks   0             48            108
buildings demolished0             93            185
world-activity checks passed: 5/5 (trades, city building, demolition, stock change, firm failure)
```

## 28. STRATEGY TOURNAMENT — **BROKEN**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  sold  holds
maxlev       $940.6M      $387.3M      $240.9M      $1.45B       52.1%   0         82      10    51
valueadd     $389.7M      $154.2M      $259.6M      $447.7M      39.8%   0         94      68    16
allcash      $233.5M      $90.4M       $68.2M       $436.2M      37.9%   0         32      6     26
core         $21.2M       $11.6M       $-0.1M       $480.0M      81.4%   1         14      2     5
industrial   $16.5M       $5.9M        $0.1M        $139.1M      39.3%   1         12      3     2
landbank     $0.7M        $0.3M        $-0.1M       $2.9M        84.7%   2         15      3     2
merchant     $-0.6M       $-0.3M       $-3.5M       $25.8M       95.7%   2         5       4     0
contrarian   $-1.8M       $-1.6M       $-2.1M       $3.7M        111.9%  3         4       0     2

strongest: maxlev at $387.3M real · weakest: contrarian at $-1.6M
the field (median strategy): $5.9M real
top strategy over the field: 65.54x   (need <= 4x)
top strategy wins 3 of 4 worlds outright: 75.0%   (need <= 70% — one right answer is a solved game)
strategies that end in the black: 5 of 8
```

## B. THE PLAYER EXISTS TO THE WORLD — 25 years, one district bought out — **WIRED**

```
seed 550991  whale took 143 lots in exchange: land $/sf vs the rest of town 2.44x -> 1.61x, lots that changed hands there 94 -> 39, listings left standing 21 -> 0
seed 12007   whale took 118 lots in exchange: land $/sf vs the rest of town 1.04x -> 1.18x, lots that changed hands there 90 -> 22, listings left standing 18 -> 3
seed 73303   whale took 131 lots in exchange: land $/sf vs the rest of town 1.04x -> 1.57x, lots that changed hands there 95 -> 50, listings left standing 21 -> 3

difference-in-differences on district land value: 14.0%   (need >= 2% — buying a district must move its ground)
lots in the bought district that changed hands: 0.41x the control   (must MOVE — a whale is a sink, not a source)
listings still on the tape there: -18.0 versus the control (a buyer clears the shelf)
```

## C. THE STREET COMPETES — who else is bidding, and does it cost you — **WIRED**

```
seed 550991  1220 listings taken off the tape by a buyer, 1305 simply expired; 615 of the takes were assets the player would have bought at appraisal
seed 12007   1326 listings taken off the tape by a buyer, 1334 simply expired; 957 of the takes were assets the player would have bought at appraisal
seed 73303   1355 listings taken off the tape by a buyer, 1433 simply expired; 768 of the takes were assets the player would have bought at appraisal

share of listings that ended in a TRADE rather than an expiry: 49.8%   (need >= 15% — a tape nobody clears is a shop with no customers)
assets the player wanted and lost to somebody else: 768 over 50 years   (need >= 10 — competition has to cost you deals)
rival holdings, end / start: 1.48x
```

## D. CREDIT IS A CONSTRAINT — pin the index loose, then tight — **WEAK**

```
                     credit loose (1.35)   credit tight (0.55)
city groundbreaks    110                   112
listings that traded 1395                  737
built stock, M sf    19.44                 19.55
office rent index    127                   458
firms still alive    16                    27

cranes, loose / tight: 0.98x   (need >= 1.15 — cheap money has to build something)
trades, loose / tight: 1.89x   (need >= 1.10 — dear money has to stop deals)
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
New Alden     1421   27.5%    $113.6M   (14 bought)
Kestrel Point 1333   29.6%    $19.1M   (16 bought)
New York      1375   26.9%    $-0.1M   (3 bought)
Chicago       1137   37.0%    $-0.2M   (4 bought)
Boston        1733   22.0%    $-0.6M   (2 bought)

best map over the median map: unbounded   (need >= 1.25x — the map has to be an argument)
cities where one unchanged strategy goes broke: 3 of 5   (geography should be able to beat a plan)
```

## G. TIME COSTS SOMETHING — fifty years of doing nothing — **WIRED**

```
the opening cheque, held in the bank for 50 years:
   nominal $3.5M   ·   real $1.2M   ·   CPI 2.84x
the same cheque, spent on buildings (all-cash): real $173.7M

doing nothing, in real terms: -79.3%   (need < 0 — cash must decay)
penalty for idleness: 139.5x   (need >= 3x)
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
a 40% policy rate                          survived 5 years · vac 7.1% · rent 92 · pop 251546
ninety per cent vacant                     survived 5 years · vac 7.1% · rent 88 · pop 261568
construction at 20x                        survived 5 years · vac 7.5% · rent 98 · pop 247517
the town half emptied                      survived 5 years · vac 13.4% · rent 76 · pop 60000
no credit at all                           survived 5 years · vac 9.1% · rent 85 · pop 248191
rents at a tenth                           survived 5 years · vac 3.7% · rent 31 · pop 261451
the player owns nothing and owes nothing   survived 5 years · vac 9.6% · rent 70 · pop 246793

7 of 7 extremes ran five years without throwing or producing a number that is not a number
```

## 31. THE FOUR QUOTES AGREE — **WEAK**

```
sampled 400 standing buildings at year 10
rank corr(appraisal, senior advance):  0.934   (need >= 0.6 — the desk and the appraiser read the same building)
rank corr(income,    senior advance):  0.947   (a loan is sized on income, so this should be the tighter of the two)
rank corr(income,    appraisal):       0.981
advance rate: median 44.1%, worst 62.9%   (nothing may exceed 100% of appraisal)
lenders advancing MORE than the building is worth: 0
which test actually capped the loan: credit 293 · dscr 107
   (a desk where one test binds every time is a desk with two decorative tests)
the tape against the appraisal: median 0.72x over 19 live listings
```

## 34. THE LONG TAIL OF SEEDS — **WEAK**

```
4 worlds, one core strategy, 50 years each:
   worst $-0.1M   p25 $11.6M   median $11.6M   p75 $184.9M   best $184.9M
   wipeouts: 1 of 4   ·   median holdings 5

p75 / p25: 15.93x   (need 1.3x to 12x — narrower is a world with no weather, wider is a lottery)
share of worlds a competent operator survives: 75.0%   (need >= 60%)
```

## 35. THE HUMAN CLOCK — **WIRED**

```
                    months with a letter   a buy   a site that pencils   ANY move   longest dead stretch
seed 550991      116                   597     537                   600        0 months
seed 12007       76                    600     566                   600        0 months
seed 73303       42                    594     565                   600        0 months

share of a fifty-year run with something on the table: 100.0%   (need >= 60%)
longest stretch with nothing at all: 0 months   (need <= 18 — a player should never press Next for two years)
```

## 32. NUMERICAL HYGIENE — **WIRED**

```
no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.
```

