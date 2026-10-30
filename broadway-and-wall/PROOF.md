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
    SEEDS=11,22,33,44,55,66 YEARS=100 OUT=<dir> node tools/proof.mjs   # ~2.5 h on a shared box
    node tools/proof.mjs --report <dir>                                 # re-grade saved runs

Probe rules kept: fresh bundle asserted; the world is resurrected on
`gameOver` (and every seed-year is checked for a frozen world — none); the
same six cities are read every year, no seed dropped; the opening five years
are discarded as settling. First run on main at `625271e3` (#535),
2026-10-29, 6 seeds × 100 years in 90 minutes; run 2 (below) on main at
`c6469ed5` (#548), 2026-10-30, 156 minutes.

## Results — run 2 (main `c6469ed5`, #548, 2026-10-30)

**PASS 24 · WATCH 14 · FAIL 6**, against the first run's PASS 15 · WATCH 16 ·
FAIL 13 (main `625271e3`, #535). Between the two: the bands.ts overflow fix
(#541), ledger rows #4-#10, #14, #20-#22, #25, #26 closed (#539-#543 — the
formula ledger is now empty), growth bounded (#544), construction starts read
off named builders (#547), recessions and the city's unemployment (#548).
Same six seeds, 100 years, 156 minutes of run (seeds 11-44 in one process,
55 and 66 in a second after the first was stopped at a two-hour limit; each
seed is its own deterministic run, so the split changes nothing). No frozen
year, no non-finite field in 600 seed-years.

"Typical" is the median across seeds of each seed's statistic (for yearly
levels, of each seed's median year). "In band" is the share of seed-years
(levels) or seeds (statistics) inside the band. Band sources sit beside each
check in `tools/proof.mjs` (and print with `--report`).

| | Check | First run | Now | Spread now | In band | Band | Grade now (was) |
|---|---|---|---|---|---|---|---|
| Labour | Unemployment rate (yearly) | 5.1% | 4.3% | 3.4% – 5.7% | 98% | 3.0% – 11.0% | **PASS** |
| Labour | Unemployment, century mean | 5.2% | 4.5% | 4.3% – 4.9% | 50% | 4.5% – 7.0% | **WATCH** (PASS) |
| Labour | Job growth, trend %/yr | 2.9% | 1.5% | 1.3% – 1.6% | 100% | 0.0% – 2.0% | **PASS** (FAIL) |
| Labour | Job growth acceleration (last 30 yrs minus first 30, pp/yr) | 1.6% | 0.1% | -1.0% – 1.0% | 67% | -1.0% – 1.0% | **WATCH** (FAIL) |
| Labour | Population growth, trend %/yr | 2.9% | 1.6% | 1.4% – 1.7% | 100% | -0.5% – 2.0% | **PASS** (FAIL) |
| Labour | Real pay vs nation (local/national, CPI-adjusted) | 0.85 | 0.92 | 0.88 – 0.96 | 99% | 0.85 – 1.30 | **PASS** (WATCH) |
| Labour | Real pay vs nation, drift %/yr | -0.2% | -0.0% | -0.1% – -0.0% | 100% | -0.5% – 0.5% | **PASS** |
| Prices | CPI inflation, century mean %/yr | 2.9% | 2.8% | 2.3% – 3.4% | 100% | 1.5% – 4.0% | **PASS** |
| Prices | CPI inflation, yearly range | 2.6% | 2.4% | 0.5% – 5.7% | 96% | -2.0% – 10.0% | **PASS** |
| Prices | Local CPI vs national, drift %/yr | 0.2% | 0.2% | 0.1% – 0.3% | 100% | -0.5% – 0.5% | **PASS** |
| Space | Vacancy, office | 7.8% | 8.1% | 4.8% – 14.9% | 84% | 5.0% – 20.0% | **PASS** |
| Space | Vacancy, retail | 9.1% | 10.4% | 4.6% – 21.3% | 58% | 4.0% – 13.0% | **WATCH** |
| Space | Vacancy, industrial | 5.4% | 15.0% | 3.4% – 24.3% | 46% | 3.0% – 14.0% | **WATCH** |
| Space | Vacancy, multifamily | 14.5% | 0.0% | 0.0% – 7.9% | 49% | 3.0% – 10.0% | **FAIL** |
| Space | Real rent growth, office, %/yr | 3.0% | 1.9% | 1.4% – 2.1% | 17% | -1.0% – 1.5% | **WATCH** (FAIL) |
| Space | Real rent growth, retail, %/yr | 1.6% | 0.7% | 0.6% – 0.8% | 100% | -1.0% – 1.5% | **PASS** (WATCH) |
| Space | Real rent growth, industrial, %/yr | 1.8% | -0.7% | -1.3% – 1.6% | 67% | -1.0% – 1.5% | **WATCH** |
| Space | Real rent growth, multifamily, %/yr | 0.7% | -0.8% | -1.2% – -0.3% | 67% | -1.0% – 1.5% | **WATCH** (PASS) |
| Space | Occupied office sf per job, end over start | 0.21 | 0.61 | 0.45 – 0.83 | 17% | 0.70 – 1.30 | **WATCH** (FAIL) |
| Space | Real rent, yearly swing sd | 10.7% | 7.9% | 5.6% – 8.3% | 100% | 2.0% – 10.0% | **PASS** (WATCH) |
| Space | Rent and vacancy move opposite (corr of Δlog rent, vacancy) | -0.10 | -0.20 | -0.29 – -0.19 | 100% | -0.90 – -0.15 | **PASS** (WATCH) |
| Capital | Cap rate level (all classes, yearly) | 8.24% | 7.97% | 3.09% – 11.20% | 76% | 4.00% – 11.00% | **PASS** |
| Capital | Cap spread over 10Y (all classes, yearly) | 3.0pp | 3.2pp | -2.3pp – 6.1pp | 64% | 1.0pp – 6.0pp | **WATCH** |
| Capital | Cap rates lag the 10Y (best lag, years) | 2.00 | 1.00 | -2.00 – 3.00 | 67% | 0.00 – 3.00 | **WATCH** (PASS) |
| Capital | Cap rate yearly move, mean abs change (median of classes) | 1.1pp | 1.0pp | 0.8pp – 1.2pp | 0% | 0.1pp – 0.6pp | **FAIL** |
| Capital | Deal-read share (years a sale priced the cap) | 100.0% | 96.3% | 84.2% – 100.0% | 100% | 60.0% – 100.0% | **PASS** |
| Capital | Real land price growth, trend %/yr | 4.6% | 4.5% | 2.9% – 6.6% | 17% | -1.0% – 3.0% | **FAIL** |
| Capital | Bank charge-offs %/yr of book | 0.0% | 0.0% | 0.0% – 0.2% | 99% | 0.0% – 3.0% | **PASS** |
| Capital | Bank failures per century (9 lenders) | 4.21 | 1.05 | 0.00 – 2.11 | 67% | 0.50 – 10.00 | **WATCH** (PASS) |
| Capital | Peak yearly charge-off rate | 45.6% (seed 55 overflow) | 3.2% | 1.0% – 10.1% | 83% | 1.0% – 8.0% | **PASS** (FAIL) |
| Cycle | National recessions per decade | 2.21 | 1.79 | 1.47 – 2.42 | 50% | 1.00 – 1.70 | **WATCH** (FAIL) |
| Cycle | Share of months in national recession | 30.1% | 18.9% | 15.8% – 21.8% | 83% | 8.0% – 20.0% | **PASS** (FAIL) |
| Cycle | City job-loss years per decade | 0.21 | 0.32 | 0.11 – 0.43 | 0% | 1.00 – 3.50 | **FAIL** |
| Cycle | Construction follows demand (lag, years: starts after jobs growth) | 2.00 | 4.00 | -5.00 – 5.00 | 17% | 0.00 – 3.00 | **FAIL** (WATCH) |
| Cycle | Vacancy rises after starts (lag, years: vacancy after starts) | 3.00 | 5.00 | -3.00 – 5.00 | 17% | 1.00 – 4.00 | **FAIL** (WATCH) |
| Cycle | Construction starts %/yr of stock | 1.5% | 0.6% | 0.0% – 2.3% | 48% | 0.5% – 4.0% | **WATCH** |
| Households | Home ownership (owners / households) | 51.9% | 62.8% | 54.2% – 65.5% | 100% | 45.0% – 70.0% | **PASS** (WATCH) |
| Households | Doubled-up share | 3.0% | 3.4% | 2.7% – 4.1% | 98% | 2.0% – 12.0% | **PASS** |
| Firms | Firm entry rate %/yr (firms with space) | 8.9% | 8.1% | 5.1% – 13.1% | 86% | 5.0% – 15.0% | **PASS** (WATCH) |
| Firms | Firm exit rate %/yr (firms with space) | 8.5% | 7.9% | 5.5% – 12.1% | 95% | 5.0% – 15.0% | **PASS** (WATCH) |
| Firms | Tenant failures (went dark) %/yr of firms | 4.7% | 6.3% | 4.2% – 10.9% | 67% | 1.0% – 8.0% | **WATCH** |
| Integrity | Formula ledger: aggregates still set from the top | 13 | 0 | — | — | 0 | **PASS** (WATCH) |
| Integrity | Non-finite econ fields (seed-years) | 16 | 0 | — | — | 0 | **PASS** (FAIL) |
| Integrity | Frozen years | 0 | 0 | — | — | 0 | **PASS** |

The century in one line per seed (year 5 → year 100; rents real, CPI-deflated;
sf per job from year 1, as the check reads it):

| seed | jobs | population | real office rent | occupied office sf per job | office stock | flats stock | flats vacancy, median yr (years at 0%) | real flat rent | months in nat. recession | bank failures | home ownership | real pay vs nation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11 | ×4.4 | ×4.7 | ×3.8 | ×0.58 | ×2.73 | ×0.42 | 0% (63) | ×0.55 | 15% | 2 | 61→62% | 0.98→0.90 |
| 22 | ×4.0 | ×4.3 | ×3.5 | ×0.55 | ×2.57 | ×0.46 | 0% (56) | ×0.46 | 18% | 1 | 64→62% | 0.98→0.93 |
| 33 | ×4.2 | ×4.2 | ×3.8 | ×0.42 | ×2.02 | ×0.56 | 5% (20) | ×1.01 | 19% | 0 | 63→51% | 0.96→0.96 |
| 44 | ×3.6 | ×3.8 | ×3.5 | ×0.52 | ×2.07 | ×0.81 | 7% (0) | ×0.83 | 21% | 0 | 67→65% | 0.95→0.93 |
| 55 | ×4.2 | ×4.4 | ×3.6 | ×0.57 | ×2.75 | ×0.43 | 0% (51) | ×0.66 | 21% | 1 | 67→65% | 0.98→0.90 |
| 66 | ×3.2 | ×3.6 | ×4.2 | ×0.78 | ×2.75 | ×0.41 | 0% (70) | ×0.44 | 17% | 2 | 64→68% | 0.96→0.87 |

What moved, and worth saying first: the town no longer compounds (jobs ×3-4
a century, not ×6-31, and no faster at the end than the start); population,
pay against the nation, home ownership, firm entry and exit, national
recession months, the peak charge-off year and rent-vacancy co-movement all
came into band; the formula ledger is empty and the integrity rows are clean.
What is left is mostly the property side: the flats, the land read, cap-rate
noise, and construction that does not answer demand.

## What is wrong, ranked (run 2)

### 1. Flats: full for 50-70 years, their real rent halves, and they are torn down

Four seeds of six run the island's flats at **0% vacancy for 51-70 of 100
years**, and in exactly those seeds the real flat rent falls to ×0.44-0.66
and the flat stock to ×0.41-0.46 while population goes ×4. (Seed 44, the one
seed whose flats never fill, keeps ×0.81 of its flats and 7% vacancy.) The
first run had the opposite failure (15-35% vacancy with rising rents). Why
chain, seed 66 year 80: *"Apartments availability 0.0% (normal 4.8%)"* beside
*"Apartment rent $77.31/sf a year, +1.0% since Apr 2075"* — one per cent
nominal in four and a half years with CPI running ~5%/yr; seed 11 year 60 is the same
(*"availability 0.0% … 11k sf being built"*).

**Likely cause (traced to the rule).** `streetRolls.ts markFlatAsk` (#540,
FORMULA_LEDGER #4/#5): a landlord moves its ask by `REV_MGMT × (nv − ve)`,
where `nv` is *the vacancy it has learned to expect* of its block,
remembering with a five-year half-life (`OWN_MEMORY_M`). A block that stays
full teaches its landlord that full is normal: `nv` follows `ve` to zero and
the pressure term vanishes, leaving only `esc = priceLevel12 / 12`, which reads
CPI **ex-shelter** (`cpiXS`). Shelter is the part of the CPI that is rising
(#544 puts the region's rent, which grows with its size, into it), so the
flats' ask trails the CPI every year a shortage lasts. Downstream, a block
whose rent falls behind office's is the cheapest thing to replace on an
island with no vacant lots — the redevelopers take the flats for office
(office stock ×2-2.75) and the shortage deepens without a price signal.
Follow-up: anchor the landlord's normal on the town's (`normalVac`, 20-year
memory) or bound how far its own record can pull it; test passing the full
CPI or the region's rent rather than ex-shelter.

### 2. Real land +4.5%/yr, and the yearly read swings ×3-10

Real land grows 2.9-6.6%/yr (band −1 to 3) and ends at $290-5,970/sf real
across seeds. Year to year it is noise: seed 33 reads 790 → 79 → 172 → 814
$/sf at five-year steps, seed 11 1,758 → 3,446 → 3,746 → 2,884 → 1,508 →
9,598. The Why chain names office rent as the driver (*"Land +0.0% since Jan
2059 · office rent +9.3%, build cost −4.2% · builders bidding 0.9x"*), and
office real rent is ×3.5-4.2 — so the level is partly #6 (office space short
of jobs). The swings are the yearly survey's handful of fixed lots and the
cap read's spikes (#3) feeding builders' residuals (see the first run's note
under "Since" in git history: `landIdx` 1.47 → 0.03 → 28 in fifteen years on
seed 4242). Follow-up: read land off a broader set of lots/sales, and re-run
after #3.

### 3. Cap rates still move ~1 point a year (band 0.1-0.6); industrial reads ~1%

Unchanged from the first run (1.1 → 1.0pp). The worst class is industrial:
seeds 11, 22, 55, 66 read industrial caps of 0.8-1.3% for decades (seed 55:
0.9% at year 20, 0.8% at year 40, 1.0% at year 60), the same years its real
rent sits at $1.3-2/sf and vacancy at 20-27%. A cap of 1% on a rent that has
fallen two-thirds is a price held up by something other than its income —
likely the lot's land/redevelopment value (#2) — set against a thin tape of
industrial trades (`propmarket.ts tickCapReadInner` → `fitGrid`/`toRef`).
**Being worked in parallel (cap/land read stability in `propmarket.ts`);
re-run this row after it lands.**

### 4. City payrolls almost never fall: 0.32 job-loss years a decade (band 1-3.5)

#548 tied the city's unemployment to the national cycle and national
recessions came into band (19% of months), but the town's payroll still
does not shrink: in a national recession year the Why chain reads *"The
town · 183,635 jobs, +0% on its year … output gap −1.1%"* (seed 66 year 80).
The town's trend is +1.5%/yr (its mix is heavy in IT and finance, whose
national shares keep rising, #544), and the export cycle is
`CYCLE_BETA × NAT_SALES_PER_GAP × gap` — at a −1% gap a percent or two,
which the trend absorbs. A metro at 1.5%/yr does fall in 1-3 years a decade
historically, so the cyclical swing on the town's exports and its local
spending looks too small (or recessions too shallow: gaps of about −1%).
Follow-up: measure the town's payroll elasticity to the gap on the record
(MSA payroll vs output gap) before touching it.

**Since (branch `claude/payroll-cycle-2`).** Three causes found and fixed:
(1) a month-old opening reached the town's own jobless only beside a mover
(`matchJobs` step 4 stopped when the movers ran out), so the bottom rung of
every vacancy chain — restaurants — sat 13-49% short at full employment
(seed 550991 years 20-50, with ~2,850 jobless left after the month's search)
and soaked up every layoff; now the jobless still looking take what no mover
came for, and a trade stays short only when nobody is left looking.
(2) a local trade (`where: "local"`) sells only what its staffed heads make;
orders beyond them are bought out of town (its in-town share cut for the
month), while its firms still staff to the orders. (3) each trade's 1990-2019
lead over the nation's mix fades with a half-life of ~5 years
(`NAT_TREND_HALF_Y`, the least-squares carry of ten industries' 1990s CES
lead into 2000-19); the wander about it stays. One seed (550991), 100 years:
payroll fell in 23 years (2.3 a decade, was 0.5 over 60 years on main),
-1% to -7% in the national recessions (-6.9% at a -10% gap, -6.4% twice at
-15 to -17%); restaurants 0-5% short; jobs 45k → 81k (0.6%/yr).

### 5. Construction does not answer demand: both lags at the ±5-year edge; starts dying late in the century

Both lag checks went from WATCH to FAIL: the best lag sits at the search
window's edge (±5 years) on most seeds — no relation, not a long one. Starts
are 0.6% of stock a year (band 0.5-4) and in seeds 11, 22 and 44 run
0.0-0.4% for the last 20-30 years while office real rent rises and the flats
are full. Since #547 starts are ground broken by named builders on their own
pro formas, so a dry spell is builders' residuals not clearing: land at
$1,000-6,000/sf real (#2) and the volatile cap read (#3) are the two inputs
that can close a pencil; nothing points at the builders' own rule yet.
Follow-up: log the builders' best-residual distribution per year in the
proof tool so the next run can say which term shuts them out.

### 6. Office space trails jobs: sf per job 0.42-0.78 of the opening; real office rent +1.9%/yr

Much better than the first run (0.09-0.33, +3%/yr) but still out of band on
five seeds of six: jobs ×3-4 on an island whose lots are taken, office
stock ×2-2.75, the extra stock coming from replacing flats (#1). Rent clears
the gap with vacancy normal (8.1% median). Most of what is left is #5 (no
new building answers the rents) and #2 (land priced off those rents).

### 7. Industrial: 15-27% vacancy for decades, real rent −0.7%/yr

Industrial vacancy median 15% (band 3-14), 20-29% for 20-40 years in seeds
11, 22, 55 and 66, with real rent $4.6 → $1.3-2.4/sf. Why chain, seed 55
year 40: *"Industrial availability 27.2% (normal 18.7%)"* beside *"16 leases
in six months"* while the town's exports are led by IT (*"sold out of town
+9% … the town's share +1%"*). The town's industrial tenants are its making
and logistics firms, whose national shares fall (#544) — the stock does not
leave as they do (it is not converted, and #5's builders do not take it).
The rent's slide is the right answer to that; the vacancy's persistence is
what is missing (conversion or teardown of industrial). Seed 44 stays mostly
inside the band (3-14%).

### 8. Smaller watches

- **Unemployment, century mean 4.5%** (band 4.5-7; was 5.2%): arrivals
  became a flow (#544) and firms now bid pay to fill openings, so the town
  runs a little tight. Yearly levels are fine (3.4-5.7%).
- **National recessions 1.79 a decade** (band 1-1.7; was 2.2): the share of
  months is now in band (19%); recessions are short and frequent rather than
  long — 1.5-2.4 a decade across seeds.
- **Bank failures 1.05 a century** (band 0.5-10; two seeds none): the
  first run's 4.2 was inflated by #5's overflow.
- **Retail vacancy** 29-33% late in seeds 22 and 66; **tenant failures**
  6.3%/yr of firms (band 1-8, the tail to 11%).
- **Cap spread over the 10Y** reads negative in the p10 year (−2.3pp): #3.

## Earlier

The first run's ranked list (625271e3, #535) — the compounding town, space not
following jobs, flats empty with rising rents, the decoupled city and
too-frequent recessions, the seed-55 land overflow, cap-rate noise — is in
git history (`git log -p -- broadway-and-wall/PROOF.md`). Of those, the
compounding (#544), the overflow (#541), the starts equation (#547) and the
recession frequency (#548) were addressed; cap-rate noise remains (#3 above);
the flats flipped from glut to shortage (#1 above).

## How to read the tool

`tools/proof.mjs` writes one JSON per seed (yearly readings, the Why chains
of every `@rent:*`, `@vac:*`, `@land`, `@wage`, `@rate`, `@town` pointer once
a decade) and grades them; `--report <dir>` re-grades without re-running.
Monthly-sampled where a yearly sample misses the event: construction starts,
national recession starts and months, bank failures, charge-offs (from each
lender's `chargeOffsTotal`), tenants going dark. Bands and their sources are
in the code beside each check.

> Note: #549 (quality-adjusted cap/land reads) landed after this run; it roughly halves year-to-year cap moves on a 2-seed probe. Problems #2 and #3 above predate it.
