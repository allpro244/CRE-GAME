# A Hundred Years of New Alden

*Thirty-four centuries of a city that does not exist, and what its ledgers say
about the one that does.*

---

The engine was run for one hundred simulated years, thirty-four times. Twenty-two
of those centuries had nobody playing — the observer was held solvent and
otherwise did nothing, a camera bolted to a lamppost on Broad Street for a
hundred years. The other twelve had a bot in them: an all-cash buyer, a
maximum-leverage buyer, a merchant builder, and a value-add operator, each
turned loose on three seeds.

That is 40,800 simulated months, 57,388 recorded deeds, 84,665 logged events,
and about 47,000 lot-centuries — every parcel in the city, watched from 2000 to
2100, thirty-four times over.

Two things need saying at the top, because they change how the rest reads.

**The first is that this expedition found a serious bug, and the numbers below
are from the run made after fixing it.** Reading one parcel's hundred-year deed
history — the only reason anyone would ever look — turned up 20 Sloop Alley,
which recorded 166 sales in a century. Half of that was the capture harness
counting each deed twice. The other half was real: when a listing was absorbed
and no modelled firm wanted it, the engine printed a sale to an out-of-town
buyer, stamped the trade date, and *never took the deed off the seller*.
Tidewater Development owned 20 Sloop Alley from the first month of the
simulation to the last while it "sold" eighty-three times at prices from $19.4M
to $149.7M — and every one of those phantom prints fed the comparable-sales
sheet that sets land value across the district. More than half of every deed in
this economy was a firm re-selling a building it had never let go of. It is
fixed. The whole batch was re-run. What follows is the honest tape.

**The second is that the counterfactual experiment does not work, and I am
reporting it as a failure rather than as a result.** More on that in section VI.

---

## I. THE LEDGER OF RECORDS

Across the twenty-two unplayed centuries, the median town does this:

| | 2000 | 2100 |
|---|---|---|
| population | 239,032 | 436,294 |
| jobs | 125,990 | 238,478 |
| built stock | 15.5M sf | 24.3M sf |
| real office rent index | 62 | 147 |
| price level | — | ×5.38 |
| buildings demolished | — | 228 |
| city groundbreaks | — | 238 |

Same city, same founding roster of thirty-five firms, same map. Only the
weather differs. And the weather turns out to matter enormously for prices and
almost not at all for size:

| at 2100, across 22 unplayed seeds | min | median | max | spread |
|---|---|---|---|---|
| population | 366,380 | 436,294 | 499,560 | 1.4× |
| built stock | 22.3M sf | 24.3M sf | 26.8M sf | 1.2× |
| real office rent | 28.3 | 146.7 | 273.0 | **9.7×** |
| price level | ×2.1 | ×5.4 | ×8.4 | 4.1× |
| recession months of 1200 | 161 | 196 | 255 | 1.6× |
| firms alive | 13 | 21 | 24 | 1.8× |

A hundred years of divergent history moves the population by 40% and the rent
index by a factor of ten. The city always gets built; what it costs to stand in
is a coin toss compounded for a century.

**The record books.**

| | | |
|---|---|---|
| highest real rent index ever | retail, 515 | Feb 2096, seed 4242 |
| lowest real office rent | 15.0 | Mar 2065, seed 73303 |
| biggest 12-month rent gain | +48% | to Mar 2098, seed 133713 |
| biggest 12-month rent fall | −52% | to Mar 2091, seed 2020 |
| worst office vacancy | 34.9% | Nov 2090, seed 2020 |
| longest run with no recession | 14.8 years | to Feb 2072, seed 73303 |
| longest unbroken recession | 2.0 years | to Feb 2088, seed 73303 |
| most deeds on one lot | 25 | 11 Dock Sq and 53 Broad St, seed 60613 |
| longest tenancy | 36.5 years | Whitlow Drafting, 1099 Tremont Ave |

And the money, for the twelve centuries with somebody playing. Net worth at
2100, nominal and deflated to year-2000 dollars:

| bot | seed | 2100 nominal | 2100 real | peak | worst drawdown | buildings |
|---|---|---|---|---|---|---|
| maxlev | 12007 | $53.92B | $7.13B | $66.09B | 51% (2042→2049) | 340 |
| allcash | 22 | $39.94B | $6.16B | $43.73B | 72% (2073→2080) | 210 |
| allcash | 313 | $24.64B | $2.66B | $24.88B | 85% (2014→2020) | 207 |
| maxlev | 33 | $15.67B | $4.36B | $16.18B | 66% (2083→2093) | 261 |
| maxlev | 777 | $11.87B | $1.48B | $43.58B | 73% (2089→2099) | 244 |
| valueadd | 90210 | $5.66B | $1.62B | $5.66B | 61% (2008→2016) | 30 |
| valueadd | 60613 | $2.50B | $330.7M | $2.54B | 97% (2000→2000) | 21 |
| allcash | 550991 | $2.35B | $650.0M | $7.19B | 81% (2088→2097) | 168 |
| valueadd | 11 | $2.06B | $904.1M | $3.31B | 60% (2062→2072) | 25 |
| merchant | 73303 | $342.7M | $100.8M | $906.9M | 84% (2067→2078) | 1 |
| merchant | 2468 | $9.6M | $4.7M | $24.0M | 66% (2007→2084) | 1 |
| merchant | 4242 | **−$0.3M** | −$0.1M | $6.5M | 104% (2015→2072) | 0 |

Read the drawdown column, not the first one. **Every single strategy that
survived the century lost between half and 97% of its net worth at some
point.** The best run in the dataset — $53.92B — was down 51% for seven years
in the 2040s. The 104% belongs to the one that died: net worth went negative
before the receivers finished.

---

## II. THREE CITIES

Three unplayed centuries, chosen for contrast rather than for looking good.

### seed 550991 — the boom town

| decade | pop | jobs | unemp | stock | vac | rent (real) | cap | loan | CPI | rec. months |
|---|---|---|---|---|---|---|---|---|---|---|
| 2000s | 270,660 | 147,133 | 5.8% | 15.7M | 3.7% | 117 | 6.93% | 6.58% | 1.27 | 20 |
| 2010s | 285,296 | 157,968 | 4.6% | 16.6M | 10.7% | 56 | 7.48% | 5.78% | 1.55 | 10 |
| 2020s | 334,646 | 181,481 | 5.4% | 16.6M | 8.7% | 111 | 7.03% | 6.15% | 2.00 | 17 |
| 2030s | 349,132 | 176,498 | 10.9% | 18.2M | 13.3% | 158 | 5.95% | 4.83% | 2.41 | 12 |
| 2040s | 356,773 | 201,016 | 3.2% | 19.2M | 3.7% | 52 | 5.87% | 5.11% | 2.89 | 22 |
| 2050s | 407,980 | 215,159 | 9.9% | 20.3M | 4.5% | 153 | 6.47% | 6.46% | 3.88 | 36 |
| 2060s | 393,400 | 208,929 | 8.7% | 22.2M | 17.8% | 149 | 6.45% | 3.85% | 4.68 | 15 |
| 2070s | 454,571 | 271,191 | 1.8% | 21.8M | 4.6% | 139 | 6.14% | 4.65% | 5.71 | 7 |
| 2080s | 473,170 | 229,643 | 16.6% | 25.1M | 11.2% | 241 | 5.26% | 2.47% | 7.15 | 24 |
| 2090s | 499,560 | 289,890 | 1.9% | 25.6M | 3.7% | 196 | 6.63% | 6.75% | 8.44 | 0 |

```
real office rent  ▂▂▂▂▃▃▄▄▃▃▂▁▂▂▄▄▄▃▃▄▄▅▅▅▅▄▃▁▁▁▂▂▂▃▅▅▅▅▅▆▆▅▅▄▄▃▃▄▄▄▅▆▇█▇▆▅▃▄▄
office vacancy    ▃▃▃▃▂▁▁▃▅▆▇▆▃▁▁▁▂▃▃▂▁▁▁▂▄▆██▆▃▁▁▁▁▁▁▁▁▂▂▂▅▆▅▅▅▃▁▁▂▁▁▁▁▄▆▇▆▄▂
built stock       ▁▁▁▁▁▁▁▁▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▃▃▃▃▃▄▄▄▄▄▃▄▄▄▅▅▅▅▆▆▆▅▆▅▅▅▆▆▇▇▇██████
policy rate       ▆▅▅▅▆▇▆▅▅▅▆▆▅▄▄▅▆▆▆▆▄▄▄▄▅▅▄▂▃▄▆▇▂▁▃▄██▆▅▄▄▃▄▅▅▅▅▄▅▆▇▅▁▁▁▁▃▅▇
```

The best century in the set for population, and it still spends the 2080s with
one worker in six out of a job. Note the 2040s: unemployment at 3.2%, vacancy
pinned at the floor, and the real rent index at **52** — its lowest reading of
the century, in the tightest labour market of the century. That is not a
paradox in the data; it is a symptom, and section XI names it.

### seed 424242 — the median town

| decade | pop | jobs | unemp | stock | vac | rent (real) | CPI | rec. months |
|---|---|---|---|---|---|---|---|---|
| 2000s | 257,248 | 143,157 | 4.9% | 15.8M | 10.9% | 65 | 1.17 | 32 |
| 2010s | 262,228 | 135,502 | 11.7% | 15.9M | 25.8% | 66 | 1.62 | 28 |
| 2020s | 275,746 | 155,480 | 3.5% | 16.6M | 3.7% | 41 | 1.85 | 33 |
| 2030s | 314,776 | 175,127 | 4.0% | 17.3M | 3.9% | 179 | 2.40 | 17 |
| 2040s | 310,420 | 166,110 | 7.7% | 18.8M | 15.4% | 53 | 2.73 | 26 |
| 2050s | 366,534 | 195,116 | 7.3% | 19.0M | 3.7% | 168 | 2.99 | 19 |
| 2060s | 354,559 | 194,857 | 5.4% | 20.3M | 17.7% | 54 | 3.00 | 21 |
| 2070s | 424,069 | 236,570 | 3.5% | 20.9M | 3.7% | 241 | 3.78 | 9 |
| 2080s | 380,620 | 184,211 | 17.9% | 23.6M | 31.6% | 59 | 4.60 | 32 |
| 2090s | 445,596 | 263,355 | 1.8% | 24.0M | 3.7% | 184 | 5.16 | 2 |

```
real office rent  ▂▂▂▂▂▂▂▃▃▄▄▃▂▁▁▁▁▁▂▂▃▄▄▅▆▅▄▃▂▂▂▂▂▃▃▄▅▆▆▄▃▂▂▃▃▄▅▇▇███▇▄▂▂▂▂▃▄
office vacancy    ▃▃▃▄▃▃▃▁▁▁▂▄▇▇▇▅▂▁▁▁▁▁▁▁▁▂▅▆▆▄▄▃▁▁▁▁▁▁▄▅▅▆▄▁▁▁▁▁▁▁▁▂▅▇█▆▃▁▁▁
```

Look at the rent column going down the decades: 65, 66, 41, 179, 53, 168, 54,
241, 59, 184. This city's real rents alternate between roughly 50 and roughly
200 every single decade for a hundred years. That is not a property cycle. That
is an oscillator, and it is the single most important thing this expedition
found about the shape of the economy.

### seed 1492 — the town that stalled

Population ends at 366,380, the lowest of the twenty-two, having added only 35%
in a century against the median's 83%. Its distinguishing feature is that it is
*always slightly ill*: 21 to 46 recession months per decade, unemployment never
below 2.4% and touching 13.3%, office vacancy above 15% in five decades of the
ten. It never has a catastrophe. It just never gets a decade off.

---

## III. FIVE BUILDINGS

Out of 46,893 lot-centuries:

- 7,390 lots carried a building in 2000 and were bare dirt in 2100
- 7,986 were bare dirt in 2000 and carried a building in 2100
- 21,855 never traded once in a hundred years
- **8 were cleared and then built on again** — and all eight were done by the
  player. In twenty-two unplayed centuries the count is zero.

### One — 35 Caulkers Ln, millside *(the only kind of lot that gets a second life)*

An industrial shed from 1934, 10.9k sf. Calloway & Reed bought it in April 2001
for $731K and knocked it down seven months later. **The lot then sat as dirt
for fifty-seven years.** In October 2052 they sold the hole to Halloran for
$2.1M — half its real value at purchase. Halloran opened a 118.1k sf, twelve-storey
industrial building on it in October 2058 and sold three months later for
$49.2M. By 2100 it is worth $116.4M ($34.2M real).

One of eight lots in the dataset to be cleared and rebuilt. The fifty-seven-year
gap is the story: this city clears land readily and almost never puts anything
back.

### Two — 32 Packet St, millside *(the compounder)*

A 26.3k sf industrial building from 1956, worth $2.0M in 2000. It is worth
$304.0M in 2100 — **×39.14 in real terms**, the best of 21,914 buildings that
stood the whole century. It traded exactly once, in June 2032, to a local
family trust for $21.9M.

Nothing happened to it. Nobody renovated it, nobody re-tenanted it in any way
the ledger records. It sat in the path of a growing city for a hundred years
and its owner never sold.

### Three — 72 W 5th St, exchange *(the collapse)*

A 12.7k sf walk-up, three storeys, built 2009, worth $5.5M in 2000. In 2100 it
is worth $634K — **×0.02 real, a 98% loss.** Its owners: a private seller to
Kestrel Capital in 2017 at $8.9M; Kestrel to Barrowgate in a distressed sale
four years later at $4.7M, down 47%; Barrowgate out at $4.4M in 2027.

Then a sixty-year silence, and one last entry: **May 2087, sold for $111.3M to
a doctors' partnership.** Thirteen years later the same building appraises at
$634K. That $111.3M print is either the best exit in the dataset or a number
that should not exist; it is flagged in section XI.

### Four — 89 Bancroft St, northside *(the one nobody could hold)*

Twelve events, seven of them distressed, four owners in the first eighteen
months. Tallow Lane Partners sold it in May 2000, bought it back in August, and
sold it again in April 2001. It was demolished in November 2005 and has been
vacant ever since — through six more sales, at $567K, $1.2M, $997K, $2.8M,
$2.8M, $3.3M, $2.0M, and finally $15.7M in 2088.

In real terms that last price, $2.2M, is less than five times what the *building
that used to be on it* was worth in 2000. Ninety-five years of deeds on a hole
in the ground.

### Five — 52 Packet St, millside *(the crown)*

Vacant land in 2000 at $8.2M. Vacant in 2025, 2050, and 2075 — the land alone
compounding to $140.2M. Then in April 2075 an office building opens on it:
866,100 sf over nine floors. At 2100 it is the single most valuable parcel in
its city at **$29.45B ($4.55B real)**.

That is $34,000 a foot nominal, $5,253 a foot in 2000 dollars, against a median
office deed of $643/sf real. It is also 96,000 sf per floor plate. Both numbers
are at the far edge of plausible and both are flagged below.

---

## IV. DYNASTIES AND DOWNFALLS

Thirty-five firms are founded in month zero of every century. Here is one
league table, seed 550991, by assets under management:

| | firms alive | 1st | 2nd | 3rd |
|---|---|---|---|---|
| 2025 | 19 | Alden Development Co. $600.7M (35) | Barrowgate Realty $283.0M (41) | The Delancey Trust $203.0M (9) |
| 2050 | 17 | Alden Development Co. $574.5M (58) | Wentworth Trust $291.6M (34) | Prosper Ridge $208.0M (34) |
| 2075 | 19 | Wentworth Trust $1.13B (69) | Wrenfield Brothers $668.3M (51) | Calloway & Reed $334.7M (36) |
| 2100 | 20 | **Wentworth Trust $5.63B (116)** | Wrenfield Brothers $4.21B (91) | Calloway & Reed $1.85B (56) |

Now the same question across all twenty-two unplayed centuries. **Who owns the
town in 2100?**

| | |
|---|---|
| Wentworth Trust (family) | 11 |
| Thorne & Boyle (family) | 5 |
| Calloway & Reed (family) | 3 |
| Wrenfield Brothers (family) | 2 |
| Sixpenny Holdings (family) | 1 |

Twenty-two centuries, five winners, all five of them family offices. Wrenfield
Brothers appears on that list twice — the same firm whose collapse in seed 33 is
the largest in the dataset. Same founding balance sheet, same city, same
strategy; in twenty of the twenty-two it just quietly compounds.

And who was leading at 2025? Thirteen different firms, none of them dominant: Alden
Development, Granite Mutual, Wentworth Trust, Fairlead Capital, Harbor Point,
Mercer & Vane, Wexler Building, Barrowgate, Thorne & Boyle, Delancey, Meridian
Yield, Pell Street, Kingsbridge.

**The firm leading at year 25 is still leading at year 100 in four centuries out
of twenty-two.** The near end of the century is close to random and the far end
is close to determined.

The mechanism is visible in the survival table. Of the founding cohort, across
thirty-three full-length centuries:

| style | survived a century | rate | median lifespan if it died |
|---|---|---|---|
| owner-user | 63 of 66 | **95.5%** | 58.1 yrs |
| family | 164 of 198 | **82.8%** | 47.4 yrs |
| foreign | 49 of 66 | 74.2% | 43.6 yrs |
| merchant | 18 of 99 | 18.2% | 16.7 yrs |
| core | 16 of 132 | 12.1% | 31.9 yrs |
| REIT | 6 of 99 | 6.1% | 27.6 yrs |
| vulture | 2 of 66 | 3.0% | **2.5 yrs** |
| slumlord | 2 of 66 | 3.0% | 25.9 yrs |
| opportunistic | 1 of 132 | 0.8% | 10.7 yrs |
| developer | **0 of 132** | 0% | 15.8 yrs |
| private equity | **0 of 99** | 0% | 15.0 yrs |

Not one founding private-equity firm and not one founding developer has ever
finished a century. In 231 attempts. The vulture funds have a median life of
thirty months.

### The greatest collapse

Wrenfield Brothers, seed 33. **A family office** — the style that survives a
century 83% of the time — and one of the thirty-five founders.

| | rank | assets | buildings | debt | leverage |
|---|---|---|---|---|---|
| 2025 | 9th | $30M | 4 | $2M | 8% |
| 2050 | 3rd | $200M | 35 | $44M | 22% |
| 2075 | **1st** | $570M | 65 | $161M | 28% |
| 2100 | — | nothing | 0 | — | — |

Peak $15.14B in 2087 ($2.89B real), the exact month the phase machine flipped to
"peak", with office vacancy resting on its floor at 3.7% and cap rates at 4.46%.
Then the market went out from under it:

| | phase label | vacancy | real rent | cap rate |
|---|---|---|---|---|
| 2087 | peak | 3.7% | 311 | 4.46% |
| 2089 | recovery | 15.0% | 242 | 5.56% |
| 2091 | recovery | 26.1% | 162 | 6.48% |
| 2093 | recovery | 31.4% | 67 | 7.05% |
| 2095 | recovery | 30.1% | 22 | 7.04% |
| 2098 | recovery | 10.8% | 20 | 5.55% |

Real office rent fell from 311 to 20 — **a 94% collapse over eleven years** —
and the label on the HUD said *recovery* for every year of it. Wrenfield took
ten years to die, failing in 2098 owning nothing, at 28% leverage. It was not
killed by debt. It was killed by carrying sixty-five buildings into a vacancy
spiral it could not sell out of, which is the slow way and does not trip a
covenant.

It did not go alone: Fen & Marrow ($221M) and Saltmarsh Trust ($269M) failed in
2091 on the way down, and Beaumont Ledger Co. in the same month as Wrenfield.
Office vacancy was back at its floor and the phase read "expansion" within a
year of the funeral.

---

## V. THE ANATOMY OF A CYCLE, AND THE ONE TELL

559 recessions across thirty-four centuries — 16.4 per century, against 22 in
the twentieth-century United States. Median length 11 months (p10 7, p90 20);
the NBER post-war median is 10. **Frequency and duration are right.**

Amplitude is not. Measured properly — peak-to-trough in the real office rent
index, over a whole century rather than inside a phase label — the median
century's worst drawdown is **82.4%**, with a range of 59% to 95%. Nominal
asking rent fell by more than 30% peak-to-trough in **33 of 33** full-length
runs. Real US office rents fell roughly 30–40% in the worst cycles on record.
This economy does that twice over, every century, in every seed.

### If a player could learn one thing

I scored candidate signals as rules rather than correlations, because a
correlation of −0.4 tells nobody what to do in March 2043. The question asked
of each rule: *standing here, is real office rent lower three years from now?*
Base rate, 43.0%.

Then I threw away the overlapping windows. Thirty-five thousand monthly
observations with a 36-month look-ahead are not thirty-five thousand
observations — a window starting in March shares 35 of its 36 months with one
starting in April. Sampled one per three years per run, there are 977. Error
bars below are from those, and the last two columns split the runs into two
halves by seed so the rule has to work on cities it was not read off.

| rule | fires | P(rent lower in 3y) | lift | half A | half B |
|---|---|---|---|---|---|
| **vacancy over 11.5% AND up 2pp in a year** | 143 | **93.7% ± 2.0pp** | +50.7pp | 90% | 97% |
| **vacancy up 2pp from a year ago** | 196 | **92.9% ± 1.8pp** | +49.9pp | 89% | 97% |
| vacancy 2pp above its 10-yr median | 369 | 80.2% ± 2.1pp | +37.2pp | 80% | 80% |
| vacancy above 12% (flat) | 379 | 63.6% ± 2.5pp | +20.6pp | 61% | 67% |
| vacancy above 10% (flat) | 440 | 61.4% ± 2.3pp | +18.4pp | 60% | 63% |
| pipeline over its 10-yr 80th percentile | 273 | 35.2% ± 2.9pp | −7.8pp | 38% | 31% |
| rent up >20% year on year | 137 | **0.0%** | −43.0pp | 0% | 0% |

**The answer is: watch the change in vacancy, not the level of it.** "Office
vacancy is two points higher than it was a year ago" is one subtraction on a
number already on screen, it needs no history, and real rents were lower three
years later in 92.9% of independent windows — against a coin-flip base rate.
The *level* of vacancy is worth barely half as much.

Three caveats, all of which matter.

**It is a confirmation, not a prophecy.** Across 372 distinct episodes the rule
first fires a median of **17 months after the real-rent peak, with 4.6% of the
fall already gone** — and a median 33.3% still to come over the following five
years. It tells you the thing has started, not that it is coming. That is still
worth a great deal, because a third of the decline is ahead of you when it
speaks.

**It is not emergent.** `market.ts:1421–1425` contains a term that pushes the
rent index down every month vacancy is above 11.5%, superlinearly, with a
six-month ramp. The tell works because somebody wrote it down. That is not a
mark against the game — a player still has to notice — but this report is not
going to claim a discovery for reading back a printed constant.

**The bottom rule is the interesting one.** "Rent rose more than 20% last year"
was followed by lower real rent in **zero** of 137 independent cases. Zero. Real
office rent in this economy has essentially no mean reversion inside a decade:
when it is going up it keeps going up, and when it goes it goes 80%.

---

## VI. THE COUNTERFACTUALS THAT DID NOT WORK

The design: run to month 36, freeze, then live out six centuries that differ
only in what one firm did that morning. Carry on; find a dollar on the pavement
and nothing else; take one extra building; let the next deal go; switch to 80%
leverage; stop buying for good.

The dollar branch existed to establish a noise floor. It came back
**bit-identical to the baseline across all 388 quarters and every city
statistic, in all five seeds.** I took that as proof the engine is causal rather
than chaotic, and said so.

That inference is wrong, and the adversarial pass caught it.

The engine has **one shared pseudo-random stream for the entire world** —
`market.ts:15–19`, a single `mulberry32` state driving the macro walk, every
rival's decision, every tenant renewal, every demolition. Adding a dollar to a
chequing account never calls it, which is exactly why the penny is inert. Every
other branch changes *how many times* the generator is called and when, which
re-rolls the whole remaining century for everybody.

The evidence is not subtle:

- The "take one extra building" branch shows a different **city-wide** office
  rent index in the very first quarter after the fork, in all five seeds, with
  populations differing by up to 181 people that same quarter. One 2,911 sf
  retail unit out of 1,421 parcels cannot move a city's population in a month.
- Divergence is timed exactly by the first differing purchase, never by an
  economic lag. Seed 22: skip a $618,000 purchase at month 87, and the year-2100
  office rent index moves from 423 to 1,773 and population from 434k to 483k.
- The clincher: "let the next deal go" and "stop buying for good" produce
  bit-identical cities right up to the exact quarter the first one buys
  again — seed 11, identical through month 81, first differing at month 84.

So the honest finding is a bug report, not a counterfactual. **A player who
reloads a save and buys a different building gets a different century of
weather.** The fix is to give the macro economy its own stream, seeded from the
market seed and the month, untouched by anything the player does. Then these
five seeds become answerable and worth re-running.

One result does survive, because it holds in every seed and in both engine
versions, and because its size is far outside anything the reshuffling
explains: **stopping buying is ruinous.** The "stop buying for good" branch
finishes at 1–4% of the best branch's net worth in all five seeds, on both the
pre-fix and post-fix engines. Everything else about the forks is currently
unusable.

---

## VII. WHAT EMERGED

**The town consolidates, and the consolidation accelerates.** The top firm's
share of all firm assets, pooled across the sampled seeds, runs roughly 15–39%
at 2025, 26–41% at 2050, 26–73% at 2075, 35–81% at 2100. The families do not
merely outlive everyone; they buy what everyone else has to sell.

**But the map does not concentrate.** The top 10% of lots hold 52.4% of all
built value in 2000 and 53–63% in 2100. A century of booms, busts, demolition
and construction moves the geographic concentration of value by a handful of
points. Ownership concentrates; real estate does not.

**The four space markets are related but not synchronised.**

| corr of 12-mo real rent growth | office | retail | multifamily | industrial |
|---|---|---|---|---|
| office | 1.00 | 0.46 | 0.42 | 0.34 |
| retail | | 1.00 | 0.38 | 0.31 |
| multifamily | | | 1.00 | 0.25 |
| industrial | | | | 1.00 |

0.25 to 0.46. Diversification across property type does real work here, which
is correct and is a good sign.

**The city gets denser per worker, barely.** Built square feet per job: 123 in
2000, 106 in 2100. The city adds 57% more stock and 89% more jobs, so space per
worker tightens by about 14% over a century.

**Prices, deflated to year-2000 dollars, are on the dear side but not silly:**

| class | deeds | median $/sf real | p10 | p90 |
|---|---|---|---|---|
| retail | 5,826 | $1,182 | $348 | $3,452 |
| office | 9,515 | $643 | $130 | $2,167 |
| multifamily | 18,714 | $455 | $76 | $1,480 |
| industrial | 3,014 | $216 | $68 | $1,192 |
| land | 20,319 | $174 | $56 | $680 |

First decade median $317/sf real, last decade $487/sf. Real prices per foot
rose about 54% over the century, which is a defensible number for a city that
grew 83%.

---

## VIII. ODDITIES

**A quarter of all recorded history has office vacancy resting on exactly
3.68%.** Ten thousand and eight months of 40,469. It is the frictional floor,
`NATURAL_VAC.office × 0.32`, and in 97% of the months it is touched, demand had
gone past it. See section XI — this is the biggest thing in the dataset.

**"Recovery" is this simulation's word for depression.** Share of months where
real office rent fell year-on-year, sorted by the label the player would have
been reading:

| phase label | months | rent fell YoY | fell >10% |
|---|---|---|---|
| recovery | 10,750 | **60.9%** | **35.1%** |
| recession | 6,729 | 55.4% | 25.7% |
| peak | 4,553 | 30.9% | 7.2% |
| expansion | 18,029 | 29.5% | 7.5% |

Recovery is the phase in which rents are *most* likely to be falling, and by
the largest margin. This is why the naive cycle statistics read a median rent
drawdown of 10% when the true peak-to-trough is 82%: the deep part of every
collapse is labelled "recovery" and never counted as a downturn at all.

**Nothing in this economy trades quietly.** Zero of 57,388 deeds carry the
off-market flag. The flag exists, `buyOffMarket` exists, and `tickLandComps`
weights off-market prints at 0.75 or 0.35 against 1.0 for marketed ones — a
weighting applied to a population that is always empty. No rival path ever sets
it.

**Roughly a quarter of all deeds are distressed** — 24% pooled, 19% in
expansion, 61% in recovery, and 21–27% in every asset class. Distress that
uniform across classes and that high in good times is a market where the tape a
player reads is dominated by motivated sellers. Mechanically it is selection:
distressed listings are priced at 0.72–0.90× appraisal and clear, ordinary
sellers ask 0.94–1.28× and mostly expire unsold.

**Buildings almost never change hands.** 1,688 deeds per century over 1,421
lots implies an average hold of **84 years**. US commercial real estate runs 8
to 15. The tape is thin by a factor of six, and fixing the phantom-sales bug
made this worse and truer: a third of the apparent turnover was never a sale.

**Half the firms on the leaderboard are ghosts.** Firms listed as alive that
own no buildings: 10.6% at 2025, 24.0% at 2050, 40.9% at 2075, **51.9% at
2100.** A firm that sells its last building while solvent falls between both
failure tests — `rivals.ts:1151` only fails a firm with no buildings *and* debt
exceeding cash, and `rivals.ts:1211` needs a building to even start the stress
clock — so it sits on the table forever holding about $2M in cash. Every roster
statistic in this report is contaminated by them.

---

## IX. WHAT SURPRISED ME

**That the biggest firm the town ever produced was a family office, and it died
anyway.** I went looking for the greatest collapse expecting a leverage story,
because that is what the stress tests had been finding all along. Wrenfield
Brothers reached $15.14B at 28% loan-to-value — conservative, patient, the
safest style in the game by a distance — and then spent ten years dying of
sixty-five buildings it could not sell into a market with no bid. Leverage kills
small firms fast; size kills big ones slowly, and the slow one never trips a
covenant. (On the pre-fix dataset the equivalent was Harbor Point Partners,
$26.6B at *seven* percent leverage, dead in 45 months. Different seed, different
engine, same lesson.)

**That the 2025 leaderboard is worthless and I can prove it.** Thirteen
different firms lead at year 25 across twenty-two centuries, and the leader is
still first at year 100 four times out of twenty-two. Meanwhile five family
offices win every single century between them. Whoever is winning in year 25 is
levered and will be gone; the firm that will own the town in year 100 is
sitting sixth with no debt and no press.

**That the strongest tell is a subtraction, and that the fancy version is
worse.** I built the trailing-ten-year-median formulation because it felt like
what an analyst would do, and it scored 80%. "Is vacancy two points higher than
last year" scores 93% and requires nothing but the number you saw twelve months
ago. Sophistication cost thirteen points.

**That a hundred years of divergent weather moves population by 40% and rent by
970%.** Every one of these cities gets built. What separates them is entirely
what it costs to stand in one.

**That the city physically cannot renew itself.** Eight lots out of 46,893 were
cleared and rebuilt, and all eight were the player. In twenty-two centuries
with nobody playing, not one lot in New Alden was ever demolished and built on
again. The town grows only outward onto vacant dirt, and every lot it clears is
lost for good. That is not a balance issue, it is a missing mechanism, and it
explains why oldharbor is always the loser district.

**That the honest fix made the game harder and I had to report that.** Once
rivals actually surrendered the deeds they sold, the tape thinned by a third —
and the disciplined value-buyer used in the fork experiment, which had
compounded to $8.18B on the buggy engine, went bankrupt in three seeds out of
five on the corrected one. It had been feeding on inventory that was never
really for sale.

**And that I got the headline inference wrong and an adversarial pass caught
it.** I saw the penny branch come back bit-identical five times out of five and
concluded the engine was causal rather than chaotic. It was the right
observation and the wrong conclusion: the penny is inert because it never draws
a random number, and everything else does. The counterfactual experiment I was
proudest of is the one section of this report that reports a failure.

---

## X. WORTH PUTTING IN THE GAME

**The tell, said out loud by a broker.** "When office vacancy is two points
higher than it was a year ago, real rents fell over the next three years in 93%
of a hundred simulated centuries." True, checkable, actionable, and it uses a
number already on screen. Pair it with the honest caveat that by the time it
fires you are about fifteen months past the top.

**A rival archetype the player learns to read.** Two firms, visibly different
on sight: the one winning right now (levered, developer or PE, will be gone
before the player's grandchildren) and the one that will own the town (family
office, no debt, boring, currently sixth). An in-game league table at year 25 is
an actively misleading document, and letting the player learn *that* is better
content than making the table accurate.

**"No leveraged fund in the history of this town has finished a century."** A
line an NPC can say that is literally true in 231 out of 231 attempts. It also
sets the real difficulty target: surviving as anything other than a family
office would be unprecedented here.

**The Wrenfield tutorial.** The biggest firm the city ever produced was a
conservative family office at 28% loan-to-value, and it took ten years to die of
buildings it could not sell. Any tutorial that teaches "leverage is the risk" is
teaching half the game.

**The fifty-seven-year hole.** 35 Caulkers Ln was cleared in 2001 and nothing
stood on it until 2058. Demolition as an irreversible decision with a
generational time horizon is a genuinely interesting mechanic, and right now
the city stumbles into it by accident 7,650 times a century.

**Vacancy history in the HUD.** Not the level — the twelve-month change. It is
the single most valuable number in the game and the player currently cannot see
it.

---

## XI. WHAT THIS RUN BROKE

Ranked by how much they distort the economy. The first was fixed during this
expedition; the rest are open, documented here, and none of them have been
touched.

**1. FIXED — the phantom sales.** Absorbed listings printed a comp and never
conveyed the deed. One building "sold" 83 times while one firm owned it
throughout. More than half of all deeds in the economy were fictional, and they
fed the comparable-sales sheet that sets land value. Fixing it exposed a second
fault underneath — the seller retired debt at its *target* leverage rather than
the leverage actually on the building, which drove aggregate firm debt from
$1.26B to $108M once the path became common — so a sale now releases the
leverage on the book. Gates after: `econ:accept` 5/5, `sim:accept` 4/4,
`conserve` clean at 3,701 months.

**2. OPEN — office vacancy spends a quarter of history on a clamp.** 10,008
months of 40,469 sit at exactly 3.68%, and in 97% of them demand had already
gone past the rail. For a quarter of the simulation the vacancy signal carries
no information and further demand growth is silently discarded. This project's
own rules say a clamp the model rests on is load-bearing and therefore a
defect. Excess demand should be rationed by price, not absorbed by a floor.

**3. OPEN — rent drawdowns are two to three times too deep.** Median worst real
drawdown of 82.4% per century; nominal asking rent falls more than 30%
peak-to-trough in 33 of 33 runs, which has never happened in a real market. The
cause is identifiable: the superlinear term at `market.ts:1421` (`gap² × 0.85`)
was added to stop rents going flat through a downturn and overshot into free
fall — at 21.5% vacancy the drag compounds to −17%/yr with nothing bounding the
cumulative decline.

**4. OPEN — one shared PRNG for the whole world.** The player's actions
re-roll the macro economy. Section VI. This also blocks any future
counterfactual work.

**5. OPEN — the phase label is decoupled from the market.** "Recovery" is the
label on the worst part of every collapse (60.9% of its months have rents
falling), because the machine refuses to leave that state while slack is high.
Either the machine needs to be able to say "depression" or the label needs
renaming.

**6. OPEN — the city cannot redevelop.** Eight rebuilt lots in 46,893, all
player-driven. Zero in twenty-two unplayed centuries.

**7. OPEN — the failure test cannot reach a solvent husk.** 51.9% of firms
"alive" at 2100 own nothing and never will again.

**8. OPEN — nothing trades off-market**, and there is a comp-weighting branch
that has never once executed.

**9. OPEN — turnover implies an 84-year average hold**, against 8–15 in life.

**10. WORTH A LOOK — two valuation outliers.** 72 W 5th St sold for $111.3M in
May 2087 and appraises at $634K in 2100. 52 Packet St is the most valuable
parcel in its city at $5,253/sf real, against a $643/sf median, on 96,000 sf
floor plates. Neither is proof of anything on its own; both are the kind of
number that usually has something behind it.

---

## APPENDIX — METHOD

`tools/century.mjs` runs the centuries and captures 29 macro columns a month
plus every deed, event, per-parcel history, firm league table at each
quarter-century, and parcel snapshot at years 0/25/50/75/100. Two engine
behaviours shape the capture: `s.comps` is a rolling window capped at
`MAX_COMPS` and `s.news` at 120, so both are harvested every month rather than
read at the end. A null player still carries the firm's overhead and goes
insolvent around year 68, which freezes the whole city on `gameOver`; the empty
chair is held solvent so the town can get on with its century.

`tools/centurymine.mjs` is the statistics pass, `tools/centurystories.mjs` the
narrative pass, `tools/centuryfork.mjs` the counterfactuals.

Three measurement faults were found and fixed in the tooling itself while
building this, all of the kind the house rules warn about. The cycle drawdown
was measured on the nominal index and reported a median downturn of 4%, which
is inflation carrying an index up through a market falling underneath it. The
tightest-market record initialised its floor at 1 while vacancy is captured in
percent, so it could only ever match a market below one percent and printed
`undefined`. A rule in the tell table tested `phase === "boom"`, a value the
engine never emits, and printed itself as "too few to score" rather than as a
test that could not fire.

Every headline number here was re-derived from the corrected dataset. Where a
figure comes from the pre-fix run it is labelled. Sample sizes for the tell are
non-overlapping windows with binomial standard errors and a split-half
hold-out, because thirty-five thousand overlapping monthly observations with a
three-year look-ahead are about a thousand observations wearing a large hat.
