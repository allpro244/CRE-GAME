# PROOF — the whole economy, a century, no player (ONE_ECONOMY_PLAN §6c-F)

**A report, not a gate.** `tools/proof.mjs` runs the full agent economy — firms
with books, the 68 industries and their supplier links, the banks, City Hall,
the household register, the tenant and property markets, land from sales,
contractors, the national swans — for 100 years on six seeds with nobody
playing, and sets each stylized fact against a band read off the historical
record. Nothing here should ever be tuned until a row turns green (CLAUDE.md:
never tune to pass). The bands are readings of history; a FAIL is a question
about a mechanism, not a target for a coefficient.

    pnpm engine
    SEEDS=11,22,33,44,55,66 YEARS=100 OUT=<dir> node tools/proof.mjs   # ~90 min on a shared box
    node tools/proof.mjs --report <dir>                                 # re-grade saved runs

Probe rules kept: fresh bundle asserted; the world is resurrected on
`gameOver` (and every seed-year is checked for a frozen world — none); the
same six cities are read every year, no seed dropped; the opening five years
are discarded as settling. Run on main at `625271e3` (#535), 2026-10-29,
6 seeds × 100 years in 90 minutes.

## Results

PASS 15 · WATCH 16 · FAIL 13. "Typical" is the median across seeds of each
seed's statistic (for yearly levels, of each seed's median year). "In band" is
the share of seed-years (levels) or seeds (statistics) inside the band.

| | Check | Typical | Spread (p10-p90 of years, or min-max of seeds) | In band | Band | Grade | Source of band |
|---|---|---|---|---|---|---|---|
| Labour | Unemployment rate (yearly) | 5.1% | 4.7% – 5.6% | 100% | 3.0% – 11.0% | **PASS** | BLS CPS 1948-2024: 2.5-10.8%; metro rates rarely outside 3-11% |
| Labour | Unemployment, century mean | 5.2% | 5.1% – 5.2% | 100% | 4.5% – 7.0% | **PASS** | BLS 1948-2024 mean 5.7% |
| Labour | Job growth, trend %/yr | 2.9% | 1.8% – 3.8% | 17% | 0.0% – 2.0% | **FAIL** | BLS CES metro payrolls 1990-2024: most large metros 0-2%/yr (plan gate: 0.5-1.5%) |
| Labour | Job growth acceleration (last 30 yrs minus first 30, pp/yr) | 1.6% | 0.6% – 3.9% | 33% | -1.0% – 1.0% | **FAIL** | metros mature: growth slows as a place fills and grows dear (Glaeser-Gyourko 2005) |
| Labour | Population growth, trend %/yr | 2.9% | 1.8% – 3.7% | 17% | -0.5% – 2.0% | **FAIL** | Census metro population 1950-2020: -0.5 to +2%/yr for established cities |
| Labour | Real pay vs nation (local/national, CPI-adjusted) | 0.85 | 0.79 – 0.96 | 52% | 0.85 – 1.30 | **WATCH** | BEA RPP-adjusted per-capita income, MSAs 2008-2022: ~0.85-1.3 of US |
| Labour | Real pay vs nation, drift %/yr | -0.2% | -0.3% – -0.2% | 100% | -0.5% – 0.5% | **PASS** | metro pay premia persist for decades (Moretti 2012) |
| Prices | CPI inflation, century mean %/yr | 2.9% | 2.6% – 3.7% | 100% | 1.5% – 4.0% | **PASS** | BLS CPI-U 1925-2024 ~3.0%/yr; post-1983 2.8% |
| Prices | CPI inflation, yearly range | 2.6% | 0.5% – 6.3% | 96% | -2.0% – 10.0% | **PASS** | BLS CPI-U Dec/Dec 1948-2024: -1% (1949) to 13.3% (1979) |
| Prices | Local CPI vs national, drift %/yr | 0.2% | 0.1% – 0.3% | 100% | -0.5% – 0.5% | **PASS** | BLS metro CPI vs US 1984-2024 |
| Space | Vacancy, office | 7.8% | 4.1% – 14.0% | 79% | 5.0% – 20.0% | **PASS** | CBRE/REIS US office 1980-2024: 8-19%; metro 5-25% |
| Space | Vacancy, retail | 9.1% | 2.2% – 15.3% | 41% | 4.0% – 13.0% | **WATCH** | REIS/CoStar US retail 1990-2024: 4-13% |
| Space | Vacancy, industrial | 5.4% | 2.0% – 18.6% | 60% | 3.0% – 14.0% | **WATCH** | CBRE US industrial 1989-2024: 3-14% |
| Space | Vacancy, multifamily | 14.5% | 8.2% – 34.8% | 25% | 3.0% – 10.0% | **FAIL** | Census HVS rental vacancy 1965-2024: 5-11%; managed (NMHC) 3-8% |
| Space | Real rent growth, office, %/yr | 3.0% | 2.2% – 3.6% | 0% | -1.0% – 1.5% | **FAIL** | NCREIF/CBRE real rents 1978-2024 ~-1 to +1.5%/yr; Eichholtz et al.: near flat over centuries |
| Space | Real rent growth, retail, %/yr | 1.6% | 1.0% – 2.5% | 33% | -1.0% – 1.5% | **WATCH** | as above |
| Space | Real rent growth, industrial, %/yr | 1.8% | -0.9% – 2.9% | 33% | -1.0% – 1.5% | **WATCH** | as above |
| Space | Real rent growth, multifamily, %/yr | 0.7% | 0.3% – 1.0% | 100% | -1.0% – 1.5% | **PASS** | as above |
| Space | Occupied office sf per job, end over start | 0.21 | 0.09 – 0.33 | 0% | 0.70 – 1.30 | **FAIL** | office sf per worker ~250→~190 over 1990-2020 (CBRE/NAIOP) |
| Space | Real rent, yearly swing sd | 10.7% | 5.8% – 13.5% | 50% | 2.0% – 10.0% | **WATCH** | NCREIF/CBRE market rent growth sd ~3-8%/yr |
| Space | Rent and vacancy move opposite (corr of Δlog rent, vacancy) | -0.10 | -0.22 – -0.01 | 33% | -0.90 – -0.15 | **WATCH** | Wheaton-Torto rent adjustment (r ~ -0.3 to -0.7) |
| Capital | Cap rate level (all classes, yearly) | 8.24% | 5.50% – 11.73% | 83% | 4.00% – 11.00% | **PASS** | NCREIF/RCA 1980-2024: 4-11% |
| Capital | Cap spread over 10Y (all classes, yearly) | 3.0pp | -0.8pp – 6.1pp | 67% | 1.0pp – 6.0pp | **WATCH** | NCREIF/RCA cap rate minus UST10 1990-2024: ~1.5-5.5pp |
| Capital | Cap rates lag the 10Y (best lag, years) | 2.00 | 1.00 – 2.00 | 100% | 0.00 – 3.00 | **PASS** | Chervachidze-Wheaton 2013: 0-3 yr lag, partial pass-through |
| Capital | Cap rate yearly move, mean abs change (median of classes) | 1.1pp | 1.0pp – 1.5pp | 0% | 0.1pp – 0.6pp | **FAIL** | NCREIF/ACLI 1985-2024: typical 0.2-0.5pp; 2009's +1.5pp the extreme |
| Capital | Deal-read share (years a sale priced the cap) | 100.0% | 98.9% – 100.0% | 100% | 60.0% – 100.0% | **PASS** | RCA tracks trades in every class in every major metro each year |
| Capital | Real land price growth, trend %/yr | 4.6% | 1.7% – 6.4% | 17% | -1.0% – 3.0% | **FAIL** | Davis-Heathcote; Knoll et al. (2017): ~0-3%/yr real long-run |
| Capital | Bank charge-offs %/yr of book | 0.0% | 0.0% – 0.3% | 95% | 0.0% – 3.0% | **PASS** | FDIC QBP CRE net charge-offs 1991-2024: ~0-3%/yr |
| Capital | Bank failures per century (9 lenders) | 4.21 | 0.00 – 8.42 | 83% | 0.50 – 10.00 | **PASS** | FDIC 1934-2024: failures cluster in crises |
| Capital | Peak yearly charge-off rate | 45.6% | 0.7% – 2.5e18% (seed 55 overflow, #5) | 17% | 1.0% – 8.0% | **FAIL** | FDIC CRE charge-offs peak 2-4% (1991, 2010); C&D ~8% |
| Cycle | National recessions per decade | 2.21 | 1.58 – 2.32 | 17% | 1.00 – 1.70 | **FAIL** | NBER 1945-2020: 1 per 6.3 yrs; post-1982 1 per 8-10 |
| Cycle | Share of months in national recession | 30.1% | 18.4% – 32.3% | 17% | 8.0% – 20.0% | **FAIL** | NBER 1945-2020: ~14% of months |
| Cycle | City job-loss years per decade | 0.21 | 0.00 – 0.74 | 0% | 1.00 – 3.50 | **FAIL** | BLS CES metros 1990-2024: ~1-3 years a decade |
| Cycle | Construction follows demand (lag, yrs: starts after jobs growth) | 2.00 | -3.00 – 5.00 | 50% | 0.00 – 3.00 | **WATCH** | Wheaton (1987, 1999): starts peak 1-3 yrs after demand |
| Cycle | Vacancy rises after starts (lag, yrs) | 3.00 | -5.00 – 5.00 | 33% | 1.00 – 4.00 | **WATCH** | Wheaton-Torto: completions 2-3 yrs after starts push vacancy up |
| Cycle | Construction starts %/yr of stock | 1.5% | 0.0% – 3.0% | 72% | 0.5% – 4.0% | **WATCH** | Census/Dodge: ~1-3% of stock a year |
| Households | Home ownership (owners / households) | 51.9% | 38.4% – 58.5% | 73% | 45.0% – 70.0% | **WATCH** | Census HVS 1965-2024: 62-69% US; large metros 45-65% |
| Households | Doubled-up share | 3.0% | 2.0% – 3.5% | 91% | 2.0% – 12.0% | **PASS** | Census CPS / Harvard JCHS: ~5-10% |
| Firms | Firm entry rate %/yr (firms with space) | 8.9% | 4.2% – 23.4% | 53% | 5.0% – 15.0% | **WATCH** | Census BDS 1978-2020: entry 8-13%/yr |
| Firms | Firm exit rate %/yr (firms with space) | 8.5% | 4.3% – 22.2% | 53% | 5.0% – 15.0% | **WATCH** | Census BDS 1978-2020: exit 7-11%/yr |
| Firms | Tenant failures (went dark) %/yr of firms | 4.7% | 2.8% – 10.7% | 74% | 1.0% – 8.0% | **WATCH** | BDS firm deaths ~8%/yr, mostly small |
| Integrity | Formula ledger: aggregates still set from the top | 13 | — | — | 0 | **WATCH** | FORMULA_LEDGER.md open rows #4-#10, #14, #20-#22, #25, #26 |
| Integrity | Non-finite econ fields (seed-years) | 16 | — | — | 0 | **FAIL** | `econ.constructionAppetite`, seed 55 years 85-100 (#5, fixed) |
| Integrity | Frozen years | 0 | — | — | 0 | **PASS** | resurrected on gameOver; none frozen |

The century in one line per seed (year 5 → year 100; office rent and land
are real, CPI-deflated):

| seed | jobs | population | real office rent | occupied office sf per job | office stock | flats stock | flats vacancy (median yr) | months in nat. recession | bank failures | home ownership | real pay vs nation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 11 | ×5.7 | ×6.2 | ×8.6 | ×0.33 | ×1.97 | ×1.19 | 24% | 32% | 0 | 62→30% | 0.95→0.81 |
| 22 | ×14.2 | ×14.9 | ×7.5 | ×0.18 | ×3.14 | ×1.65 | 16% | 32% | 6 | 63→42% | 0.95→0.81 |
| 33 | ×9.0 | ×9.3 | ×11.0 | ×0.28 | ×2.39 | ×1.24 | 12% | 18% | 2 | 66→38% | 0.96→0.87 |
| 44 | ×30.9 | ×29.7 | ×16.1 | ×0.09 | ×2.58 | ×1.28 | 12% | 30% | 4 | 62→39% | 0.94→0.78 |
| 55 | ×16.0 | ×16.3 | ×10.8 | ×0.18 | ×2.67 | ×1.00 | 15% | 30% | 8 | 64→49% | 0.98→0.83 |
| 66 | ×10.8 | ×11.6 | ×7.4 | ×0.21 | ×2.03 | ×1.14 | 13% | 30% | 2 | 60→30% | 1.00→0.79 |

What is right, and worth saying first: unemployment, CPI (2.9%/yr over the
century, local within ±0.3%/yr of the nation), office vacancy, the cap-rate
level and its lag behind the ten-year, the doubled-up share, the deal-read
share (every class has closed deals every year), bank charge-offs in an
ordinary year, and the integrity checks other than one seed's overflow. No
frozen year anywhere.

## What is wrong, ranked

### 1. The town compounds without limit — jobs ×6 to ×31 a century, and speeding up

Job growth trends at 2.9%/yr (band 0-2) and the last thirty years run 1.6
points a year faster than the first thirty: seed 44 ends at 1.44 million jobs
from 51 thousand. Everything downstream of it is distorted: office rent ×7-16
real, land 4.6%/yr real, office space per job falls to a fifth, home
ownership halves.

**Cause (traced).** The Why ledger's `town.month` / `industry.exports` chain
names the driver every decade: *"Securities, funds and trusts · sold out of
town +9% on its year · the town's share +1%"*. Two compounding terms in
`economy.ts tickExports`:

- **The nation's industries each run their 1990-2019 CES rate forever**
  (`NAT_TREND`, mean-reverting to that centre, `NAT_TREND_TAU_M` 360). At those
  centres computer design grows 5.5%/yr, social assistance 4.3%, warehousing
  3.1% for a hundred years. Summed at the nation's own mix, total employment
  goes **×10.7 in a century** (measured from the engine's `NAT_TREND` and
  `NAT_EMP_SHARE`), against ×2.7 for the weighted mean rate and roughly ×3.5
  for actual US payrolls 1925-2024. A sum of exponentials is dominated by its
  fastest term; the trends need to be a *mix* that sums to the labour force,
  not independent levels.
- **The town's export share is an integrated random walk with no Itô
  correction.** `lnShare += (fort - LOCATION_PULL·cost)/12`, `fort` an OU
  process (sd 2%/yr, τ 20 yr). Its variance after a century is ~1.3 log
  points per industry, so E[exp(lnShare)] drifts up ×~1.9 even with a
  zero-mean `fort` — the town gains share on average when the shares of all
  towns must average out. The cost brake (`locationCost`, 85% pay, 15% rent)
  cannot catch it because pay does not rise: migration supplies every worker
  at ~5% unemployment (see #4), so real pay *falls* to 0.8 of the nation and
  the town gets *cheaper* as it booms; and the agglomeration term adds a
  small positive feedback.

**Follow-up (not small; moves every number):** make the national industry
trends shares of a labour-force total (or decay each industry's trend toward
the aggregate over a few decades), and give the town's share the −σ²/2 drift
so its expectation is flat. Then re-run this suite before touching anything
in the space markets — most of #2 and #3 may be this.

### 2. Space does not follow jobs: office sf per job falls to 0.09-0.33 of the opening; real office rent +3%/yr

Jobs ×6-31, office stock ×2-3. Rent clears the gap: real office rent grows
2.2-3.6%/yr (band −1 to +1.5) with vacancy *normal* (7.8% median — the market
is not tight by its own measure, it is just priced higher every year).
Firms economise on dear space (`affordEff`) until a worker has a fifth of the
floor he had.

**Cause.** Construction starts are an aggregate set from the top:
`market.ts` ~L4183, `start = stock × 0.0016 × appetite × catchUp × jitter` —
proportional to the *existing stock*, so the build rate cannot exceed ~2-4% of
stock a year however far demand runs ahead. It is **not on
FORMULA_LEDGER.md** and should be (it is an aggregate quantity of new
supply set by an equation, not the sum of developers' decisions). The street
firms' own builds sit beside it but do not replace it. Starts do follow
demand (median lag 2 years, inside the band) but the vacancy-after-starts lag
hits the ±5-year search boundary on half the seeds — i.e. unidentified.

**Follow-up:** list the starts formula on the ledger; let the developers'
pencils set the amount, not the stock. Measure after #1.

### 3. Flats: 15-35% vacancy for decades while their rents rise

Multifamily vacancy median 14.5% (band 3-10), 25-45% for decades in seeds 11
and 22, while real flat rents still rise 0.3-1.0%/yr. The Why chain at seed
11 year 100: *"Apartments availability 40.8% (normal 4.5%)"* beside *"Apartment
rent … −1.2%"*, and at year 90 *"Apartment rent $317.67/sf … +1.0% · availability
34.9%"*.

**Cause (two answers to one quantity — fake number type 3).** The flats' rent
rule (`market.ts` rent block, multifamily) prices off `effGap = gap −
structTight`, and for flats `structTight` is the *aggregate* demand equation's
`wantedNow` against housable space (`market.ts` ~L5019) — the old formula's
wish list. The households who actually choose (households stage 2) leave the
flats empty at the same time. The aggregate says "shortage", the agents say
"glut", and the rent listens to the aggregate. FORMULA_LEDGER rows #4 and #5
already name the flats' natural vacancy and vacancy drift; `structTight` for
flats belongs with them. Meanwhile the island's flat stock barely grows (×1.0-1.65)
while the region's population grows ×6-30 — the population lives off the map.

**Follow-up:** for flats, compute `structTight` from the register's renters
who wanted an island flat and could not get one (the `islandWant` minus those
housed), not from `wantedNow`.

### 4. The city is decoupled from the national cycle; the national cycle is too frequent

- **National recessions: 2.2 per decade, 30% of months in recession** (NBER
  ~1 per 6-8 years, ~14% of months). ECONOMY.md measured 1.05-1.7 per decade
  and 15-19% of months before #513/#529; this is a regression. National
  unemployment swings 3% → 10% inside two years (seed 7 smoke run: 3.2%,
  8.9%, 10.4%, 5.7%, 3.7% in successive years). Likely cause: the national
  swans split out in #529 (`blackswans.ts` natSw into `spendNation`) on top of
  the wider rate swings of #513, against a dating rule (`REC_DROP` 0.6% off
  the output peak) that fires on noise. Needs a run with the swans off to
  split the two.
- **City unemployment barely moves:** sd 0.3-0.7pp a year against the
  nation's 1.9-3.0pp, correlation 0.27; payrolls fall in 0.2 years per
  decade (band 1-3.5). In a 2-3%/yr growth trend a national recession is a
  pause, and the household register's migration absorbs the rest — workers
  arrive and leave so fast the town's rate sits at ~5% whatever happens.
  Partly #1 (a town growing 3%/yr cannot shrink); partly that migration is
  the only margin.

### 5. A land read blows up and takes the banks with it (seed 55, year 79)

Seed 55's bank books read $1e15 at year 80 and charge-offs $5e68 at year 84,
and `econ.constructionAppetite` is NaN for the last sixteen years — the only
non-finite reading in 600 seed-years. Traced month by month: in month 948 (a
January land-queue refresh) nine street firms' lines jump from $1-70M to
$1e17-1e20, every bank's named book goes to 1e20 the month after, and the
overflow reaches the econ a few years later.

**Cause (traced to the line):** `bands.ts` re-centres the quality bands'
rent swings so their occupied-weighted mean is one — and it divided EVERY
band by that mean every month, including a band with no lease in the window
(which "keeps its swing") and a band with no stock. A band never re-read is
divided again and again: by year 79 the two lowest office bands' swing stood
at 7e13 and the lowest shop band's at 3e16. The first month a lot's best
scheme scored into one of those bands (`residualScheme` → shop use, value
$7e15/sf), its land read was 1e16 $/sf; every firm holding such a lot marked
its book at 1e20, `lineRoom` advanced against the mark, and the firms drew.
Seed 55's eight bank failures and the peak charge-off row are partly this;
seeds 22 and 44 also show 25-140% charge-off years that should be re-read
after the fix.

**Fixed here** (small, clear): only the swings set this month are
re-centred; a stale band stays where it was set (`bands.ts`, step 4).

### 6. Cap rates jump ~1.1 points a year (band 0.1-0.6)

Levels are right (8.2% median, 2-year lag behind the ten-year) but every
class moves ~1 point a year and spikes to 16-22% (office, seed 22 year 10 and
90) or 1.8% (retail, seed 11 year 95). The read is a weighted median of
deals adjusted to a reference building by a regression fitted on the same
thin tape (`propmarket.ts tickCapReadInner`, `fitGrid` → `toRef`), which
extrapolates when few prints fall in the window. Land read off sales has the
same thinness: real land swings ×3 year to year in seed 55 (462 → 1,420 →
359 → 937 → 228 $/sf real). Follow-up: report the fit's standard error and
fall back to the raw median when the reference adjustment exceeds the
spread of the prints.

**Done (claude/cap-reads):** the read is now a time-dummy hedonic grid
(whole record, priced kinds of evidence incl. compelled sellers) read by
the appraisers' own updating (Quan-Quigley / Geltner, Huber-robust;
volatility learned from their record). `tools/mdga/capreads.mjs`, seeds
22 and 55 x 50 years, mean |year-on-year change| (pp) before -> after:
office 0.87/1.92 -> 0.33/1.07, retail 0.72/1.29 -> 0.55/1.35, flats
1.06/1.74 -> 0.50/1.05, industrial 0.94/0.81 -> 1.00/0.86; land |dlog|
0.23/0.33 -> 0.17/0.06, worst year x63/x40 -> x2.3/x1.7. What is left in
seed 55 is the market itself, not the read: the deals-alone median and
the read track together through caps of 6 -> 21 -> 6% (a cycle amplitude
problem, #4), and industrial prints scatter 0.46-0.50 in log. The
condition slope is near zero for office, retail and flats in the prints
themselves (year-demeaned bins flat within +/-0.05): bidders price
condition only through the income the appraiser already capitalises —
`dealView`'s capital plan reads age and spec, not condition, so a worn
building carries no catch-up capex. The fit cannot find a premium nobody
pays. Land: the read no longer swings, but 50 years hold 8-10 lot sales
(the rest broker indications) and its level falls to 0.15-0.2 of the
opening (land level — separate work).

### 7. Smaller watches

- **Home ownership falls from ~63% to 30-49%** over the century (band
  45-70). Likely #1: prices rise with a town that compounds while pay falls
  against the nation.
- **Firm entry and exit** sit at 4-6%/yr for half a century (band 5-15;
  BDS 8-13) and then jump to 17-29% once the town is huge — churn scales with
  growth rather than being a steady hazard. Measured on firms holding space
  in the street's rolls (fids present one year and not the next).
- **Rent and vacancy barely co-move** (corr of Δlog rent and vacancy −0.10;
  band −0.15 to −0.9): rent is mostly following the trend of #2, not the
  cycle.
- **Real rent swings 10.7% a year** (band 2-10): the same thin comps.
- **Formula ledger: 13 open** (#4-#10, #14, #20-#22, #25, #26), plus the
  construction-starts equation of #2 that is not yet on it.

## Fixed here

- `bands.ts`: only the quality-band rent swings set this month are
  re-centred (#5). `pnpm conserve` passes with it (4,171 months reconciled).
  Not yet re-run through the century: the next proof run on combined main
  should show seed 55 with no overflow and the peak charge-off row sane.
  Test state, compared with and without the fix on main 748e2de3 (#539):
  `rival-assembly`, `sale-instructions` and `rival-husks` pass both ways
  (the two that failed earlier did so only on the older base 625271e3, so the
  tests did not depend on the compounding swings). `fund-plumbing`,
  `take-private`, `floating` and `visible-buyers` fail identically both ways,
  and so do `advance`, `appraisal`, `refi-strong`, `buybox`, `quiet-clock` and
  `fund-builds` (checked on 625271e3). Main was already red on those, and this
  fix does not change any of them.

Since this run, main closed ledger rows #6-#8, #20-#22, #25 and #26 (#536-#539):
`--report` now counts **5 open** (#4, #5, #9, #10, #14). The run itself was
on 625271e3, so every other number above is from before those PRs.

## How to read the tool

`tools/proof.mjs` writes one JSON per seed (yearly readings, the Why chains
of every `@rent:*`, `@vac:*`, `@land`, `@wage`, `@rate`, `@town` pointer once
a decade) and grades them; `--report <dir>` re-grades without re-running.
Monthly-sampled where a yearly sample misses the event: construction starts,
national recession starts and months, bank failures, charge-offs (from each
lender's `chargeOffsTotal`), tenants going dark. Bands and their sources are
in the code beside each check.
