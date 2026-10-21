# Spike 5: the subdivision pro forma (land developer's side)

This spike checks whether the region plan's land-development economics work
with real numbers. It models one 100-acre suburban tract from start to
finish: buy raw land, entitle it, build streets and utilities in phases, and
sell finished lots to homebuilders.

**Nothing here sets the lot price.** Each month, the price a builder pays is
the homebuilder's residual: the new-home price at that month's mortgage rate,
less vertical construction cost, overhead, marketing, commissions, the
builder's normal profit and construction-loan carry. Every input has a
source, apart from a handful marked APPROX below.

```bash
node region-spikes/proforma/proforma.mjs
```

```bash
node region-spikes/proforma/proforma.mjs --json
```

The script is plain Node ESM with no dependencies (tested on Node 24). It
does not touch the engine.

---

## Results (`node proforma.mjs`, 2026-10-21 inputs)

### Checks: does the mechanism reproduce known numbers?

| Check | Model | Source |
|---|---|---|
| Builder residual at 2024 conditions (NAHB home, 6.72% mortgage, 14.32% AD&C rate, 11.0% profit) | **$91,787** | NAHB 2024 finished lot **$91,057** |
| Residual at today's 7.40% rate (9.8% long-run profit) | **$73,603** | WRA Dodge Co. budget: cost + 20% margin = **$68,383**/lot |
| Same, at 6.5% | $111k | Forestar FY2025 average lot **$108,400** (FY PMMS average ≈ 6.6%) |
| New-home price at 7.40% vs the 2024 survey | −5.3% | Census average new-home price Aug 2026: −8.8% year on year |

The residual lands within 1% of NAHB's published lot cost. It also lands
close to the two independent lot-price observations above. The builder
side holds up.

### Scenarios

| | (a) Sensible deal | (b) Bad deal | (c) Fair price, strict jurisdiction |
|---|---|---|---|
| Jurisdiction cost and yield | Dodge Co. WI | Dodge Co. WI | Dane Co. WI |
| Land $/acre | $20,000 (local comp) | $50,000 (metro-core comp) | $50,000 (local comp) |
| Entitlement | 6 mo | 8 mo | 6 mo |
| Builder absorption | 2.47/mo × 2 builders | 2.0/mo × 2 | 2.47 × 2 |
| Mortgage rate | 7.40% flat | 7.40%, then the 2022 jump (+3.86 pp over 10 months) starting at month 22 | 7.40% flat |
| Lots | 213 | 213 | 188 |
| Lots sold / months | 213 / 58 | **48 / 120** (residual reaches $0; 92 months without a sale) | 188 / 53 |
| Average lot price (residual) | $73,603 | $56,876 (range $9k–$74k) | $73,603 |
| Revenue / cost | $15.68M / $11.83M | $3.29M (incl. $0.56M ag write-down) / $10.59M | $13.84M / $22.03M |
| Profit | **+$3.85M** | **−$7.30M** | **−$8.19M** |
| Unlevered IRR | **21.9%** | **−24.0%** | **−29.7%** |
| Risk-weighted IRR (85% approval) | 19.0% | −24.7% | −31.0% |
| Equity multiple | 1.33x | 0.31x | 0.63x |
| Peak equity | $5.53M (month 13) | $8.53M | $11.60M |

Base-case quarterly cash flow:

```
  Q 1  land -$2000k  soft  -$389k  infra     $0k  lots   0  rev     $0k  net -$2389k  cum -$2389k
  Q 3  land     $0k  soft  -$816k  infra  -$955k  lots   0  rev     $0k  net -$1772k  cum -$4290k
  Q 5  land     $0k  soft    -$9k  infra  -$495k  lots   4  rev   $294k  net  -$209k  cum -$5242k   <- peak equity
  Q 6  ...  phases 2-4 overlap sales; each quarter ~15 lots, ~$1.1M  ...
  Q16  land     $0k  soft   -$31k  infra  -$701k  lots  14  rev  $1030k  net   $298k  cum   $210k   <- payback, ~4 yrs
  Q20  land     $0k  soft   -$13k  infra     $0k  lots   6  rev   $442k  net   $428k  cum  $3851k
```

### Which part of the bad deal does the damage?

Each ingredient was applied alone to the base case:

| Ingredient | IRR | Multiple |
|---|---|---|
| Overpaid land ($50k/ac instead of $20k/ac) | 3.3% | 1.06x |
| Heavy-regulation review (8 months, not 6) | 21.2% | 1.33x |
| Slowest 10-K sales pace (2.0, not 2.47) | 19.2% | 1.33x |
| 2022-style rate shock mid-sales | **−17.8%** | 0.58x |

### Sensitivity (base case, one variable at a time)

| Mortgage rate (flat) | IRR | Lot price | | Half pass-through* IRR | Lot |
|---|---|---|---|---|---|
| 5.5% | 99.4% | $160k | | 75.7% | $130k |
| 6.5% | 58.7% | $111k | | 54.3% | $106k |
| **7.4%** | **21.9%** | **$74k** | | 36.4% | $87k |
| 8.5% | −17.1% | $35k | | 15.6% | $68k |
| 9.5% | −21.0% | $4k | | −2.7% | $53k |
| 11.26% | −19.1% | $0 | | −17.6% | $31k |

\*Half pass-through means the new-home price moves half as much as buyer
affordability implies (sticky prices, buydowns). This variant is a bound for
comparison and is not sourced.

| Absorption (homes/community/mo) | IRR | Months | | Entitlement | IRR | | Land $/ac | IRR | Peak equity |
|---|---|---|---|---|---|---|---|---|---|
| 1.5 | 15.7% | 84 | | 3 mo | 23.0% | | $7,250 (ag value) | 37.7% | $4.25M |
| 2.0 | 19.2% | 68 | | 6 mo | 21.9% | | $10,000 | 33.4% | $4.53M |
| **2.47** | **21.9%** | 58 | | 9 mo | 20.8% | | **$20,000** | **21.9%** | $5.53M |
| 3.0 | 25.3% | 49 | | 12 mo | 19.9% | | $35,000 | 10.8% | $7.03M |
| 3.7 | 25.9% | 43 | | 18 mo | 18.1% | | $50,000 | 3.3% | $8.53M |
| | | | | 24 mo | 16.7% | | $75,000 | −5.2% | $11.03M |

**What the developer can bid for raw land.** The developer's own residual
gives the maximum $/acre for a target unlevered IRR: $58.5k at 0%, $36.4k at
10%, $28.5k at 15%, $22.1k at 20% and $16.9k at 25%. The Dodge County comp
($20k) sits at roughly a 22% IRR, which is about where a merchant land
developer would want it. The Wisconsin agricultural value ($7,250) is the
floor, so a tract here carries a conversion premium of about 2.8x.

---

## Inputs and sources

Every page below was opened and read, apart from the one flagged. Each value
also has a comment in the `SRC` block at the top of
[`proforma.mjs`](proforma.mjs).

### Homebuilder (sets the lot price)

| Input | Value | Source and reading |
|---|---|---|
| New-home price | $665,298 | NAHB, *Cost of Constructing a Home-2024*, Table 1, "Total Sales Price". [PDF](https://www.nahb.org/-/media/AB4EFC742624475A97A0A62189986FF8.ashx) · [summary](https://eyeonhousing.org/2025/01/cost-of-constructing-a-home-in-2024/) |
| Construction cost | $428,215 | Same table, "Total Construction Cost" (2,647 sf, about $162/sf). It already includes site work: permit $7,640, **impact fee $6,367**, water and sewer $6,260. Impact fees are therefore paid by the builder at permit and are not double-counted on the developer's side. |
| Overhead / marketing / commission | 5.7% / 0.8% / 2.8% of price | Same table |
| Builder required profit | 9.8% of price | Same report, p.7: the 1998–2024 long-run average pre-tax profit share. The 2024 figure of 11.0% is used only for the reproduction check. |
| Builder construction-loan rate | 11.82% now, 14.32% in Q2 2024 | NAHB AD&C survey, effective rate on speculative single-family construction. [Q2 2026](https://eyeonhousing.org/2026/08/cost-of-credit-for-builders-up-since-the-end-of-2025/) · [Q2 2024](https://eyeonhousing.org/2024/08/credit-for-builders-rates-up-availability-down-in-the-second-quarter/) |
| Builder debt share | 22% (derived) | Calibrated so that carry at the 2024 AD&C rate equals NAHB's own financing line of $10,220. The rest of the capital is the builder's equity, paid for by the profit margin. |
| Build time | 7.4 months | Census Survey of Construction via NAHB, built-for-sale homes, permit to completion, 2025. [link](https://eyeonhousing.org/2026/09/single-family-home-construction-time-declines-in-2025/) |
| Months on market after completion | 3.2 | Census/HUD series MNMFS, Jan 2026. [FRED](https://fred.stlouisfed.org/series/MNMFS). **WEAK:** FRED was down for maintenance on 2026-10-21, so this was read from a search excerpt of that page. |
| Mortgage rate | 7.40% now; 6.72% in the 2024 survey year | Freddie Mac PMMS 30-year, 10/15/2026, [pmms](https://www.freddiemac.com/pmms). 2024 average computed from the [history CSV](https://www.freddiemac.com/pmms/docs/PMMS_history.csv). |
| Rate shock | +3.86 pp over 10 months | Same CSV: 3.22% on 1/6/2022 to 7.08% on 10/27/2022 |
| Down payment | 20.3% blended | NAR 2025 Profile: median 10% for first-time buyers and 23% for repeat buyers; first-time buyers were 21% of the market. [link](https://www.nar.realtor/news/real-estate-news/nar-2025-profile-of-home-buyers-sellers-reveals-market-extremes) |
| Builder sales pace | 2.47 homes/community/month (mean) | FY2025 10-Ks: Tri Pointe 2.4 ([10-K](https://www.sec.gov/Archives/edgar/data/1561680/000156168026000008/tph-20251231.htm)), M/I Homes 3.0 ([10-K](https://www.sec.gov/Archives/edgar/data/799292/000079929226000006/mho-20251231.htm)), Beazer 2.0 ([10-K](https://www.sec.gov/Archives/edgar/data/915840/000091584025000075/bzh-20250930.htm)). All three fell from 2024 (3.1 / 3.3 / 2.4). |
| Census cross-check | Median $393,700, average $478,700 (Aug 2026) | Census/HUD New Residential Sales, release CB26-155. [PDF](https://www.census.gov/construction/nrs/pdf/newressales.pdf) |

**How the rate moves the home price.** The buyer pool's monthly payment and
cash down payment are held fixed in dollars, so the loan they can carry, and
therefore the price, moves with the rate. The mechanism is calibrated at the
NAHB home and the 2024 rate. This is full pass-through and should be read as
an upper bound (see the assessment).

### Land developer

| Input | Dodge Co. (base) | Dane Co. | Source |
|---|---|---|---|
| Lots per gross acre | 2.14 (171/80) | 1.89 (151/80) | More Housing Wisconsin, *Briefing Paper 7*, Sept 2024. The line-item budgets of three **actual proposed 80-acre subdivisions** were prepared by Steve DeCleene (Neumann Companies, a residential developer) and Robert Procter (Axley Brynelson). [PDF](https://action.wra.org/wp-content/uploads/2024/10/MHW-Briefing-Paper-7-September_FINAL-compressed.pdf), table on p.8. The yield already nets out streets, ponds and open space, so a separate gross-to-net factor is not needed. |
| Raw land | $20,000/ac | $50,000/ac | Same table: "Land Cost" $1.6M and $4.0M for 80 acres |
| Planning, due diligence, legal | $1,217/lot | $1,507 | same |
| Closing, property tax, loan fees | $1,217/lot | $3,778 | same |
| Engineering and inspections | $3,833/lot | $3,868 | same |
| Off-site infrastructure | $1,000/lot | $8,191 | same |
| On-site infrastructure (grading, sanitary, water, storm, curbs and roads) | $30,850/lot | $57,118 | same |
| Landscaping and amenities, electric, other | $667 + $1,217 + $3,923 | $3,368 + $1,242 + $9,290 | same |
| Developer sales commission | 3% of lot price | | same ("Sales Commissions at 3%") |
| Agricultural use value (denial or write-down exit) | $7,250/ac (Wisconsin cropland 2025; U.S. $5,830) | | USDA NASS *Land Values 2025 Summary*. [text](https://esmis.nal.usda.gov/sites/default/release-files/pn89d6567/2n49w148w/1g05hb655/land0825.txt) |
| Entitlement review | 3.4 mo (light), 8.4 mo (heavy); mean about 6 | | Gyourko, Hartley & Krimmel, NBER w26573 (2019), p.4. [PDF](https://www.nber.org/papers/w26573.pdf). The paper notes a "thick upper tail" of 18–24 months. |
| Lot developer benchmark (check only) | $108,400 average lot, 21.9% gross margin, 14,240 lots | | Forestar FY2025 10-K. [link](https://www.sec.gov/Archives/edgar/data/1406587/000162828025053125/for-20250930.htm). Land vs development spend was $595M vs $1.1B, and lots are "developed in phases". |

The model leaves out land, development-loan interest and commissions from the
Wisconsin budgets and computes them itself. The budgets' own dev-loan interest
line is excluded because v1 is unlevered.

### APPROX (unsourced): flagged

| Input | Value | Why it is unsourced |
|---|---|---|
| Entitlement approval odds | 85% | No national approval-rate dataset was found. WRLURI measures delay, not denial. |
| Builders in the community | 2 | In the game this should be endogenous: how many rival builders bid. |
| Number of phases | 4 | Phasing is confirmed by Forestar and KB Home; the count is a layout choice. |
| Months to build one phase | 8 | Bounded by the KB Home FY2025 10-K: West Coast community development takes "10 to 24 months", longer than its other segments. |
| Months to resell a denied tract | 3 | |
| Horizon | 120 months | Lots unsold by then are written down to agricultural value. |
| Half pass-through variant | 0.5 | Sensitivity only. It is never used in a scenario. |

---

## Assessment

**Does a sensible deal pencil?** Yes. With land at the local comp, today's
7.40% rate and today's slow 2025 builder pace, the deal makes a 21.9%
unlevered IRR (19% after entitlement risk) on a 1.33x multiple over about
five years. It needs $5.5M of peak equity and pays back in about four years.
That is a believable merchant land-development return. Nothing was tuned to
get there: the lot price comes from NAHB's home and the costs come from a
real developer's budget.

**Does a bad deal fail for the right reasons?** Yes, and the attribution
table shows which reasons matter:

- **The rate shock is the killer.** The lot is a residual worth roughly
  11–14% of the home price, so it is heavily geared to that price. Each
  1-point move in the mortgage rate moves the lot price by about $37–39k,
  roughly half of the base lot price. In the full bad case the residual reaches zero: builders stop
  buying, the developer mothballs the later phases, and the land is written
  down to farm value. The deal loses 70% of its capital.
- **Overpaying for land is the second killer.** At $50k/acre the IRR drops
  to 3%, below any cost of capital, even with nothing else going wrong.
- **Slow sales and slow approvals hurt, but they are not fatal on their
  own.** They cut IRR by 1–6 points. That fits the industry view that land
  is lost on the purchase price and the cycle, not on months.
- **Strict jurisdictions (c) fail on cost, not on price.** Dane County's
  standards ($84k/lot of horizontal cost against $43k in Dodge) cannot be
  carried by a national-average home. The Wisconsin paper reaches the same
  conclusion: those lots need $148k. In the game, a strict jurisdiction will
  only develop where home prices are high enough, which is the right
  emergent behaviour.

**Weakest numbers, worst first:**

1. **Rate → home price pass-through.** Full affordability pass-through with
   fixed builder costs and margin makes the lot price swing far more than it
   does in practice. At 8.5% the lot falls to $35k. In 2022–25, real builders
   absorbed rate rises with incentives and margin compression (Tri Pointe's
   gross margin fell from 23.3% to 21.0%, Beazer's from 18.0% to 14.3%), and
   absorption fell instead. Forestar's average lot price *rose* from $96.6k
   to $108.4k, although its 10-K attributes that mostly to regional mix. The half
   pass-through table is probably closer to reality, but the 0.5 is
   unsourced. **This is the one to fix before the engine depends on it.** The
   engine should model price stickiness plus absorption response, and let
   builder margins flex.
2. **Mixing national and local data.** The home is NAHB's national survey
   home ($665k, larger and pricier than Census's $394k median). The costs
   are rural and suburban Wisconsin. The cross-checks agree, but a game
   market needs its *own* home price and cost per square foot from the same
   place.
3. **Entitlement odds (85%) and phase timing (8 months)** are unsourced.
   IRR is not very sensitive to them, but they shape gameplay.
4. **Months on market (3.2)** was read from a search excerpt because FRED
   was down.
5. **No inflation, property tax beyond the budget line, or leverage.** The
   model is unlevered and nominal-flat. A development loan (the AD&C land
   rate is 10.4–12.6% effective, from the same NAHB source) would raise
   levered IRR in the good case and deepen losses in the bad one.

**What the game engine would need to simulate this:**

- **A per-market new-home price model**: a buyer pool's payment capacity
  driven by the mortgage rate, with stickiness and incentives, and an
  absorption response to rates. This is the single most important piece.
- **A homebuilder rival pro forma**: construction cost per sf, soft-cost
  shares, required margin and AD&C carry, so its lot bid *is* the residual,
  as in `builderResidual()`. Margins should flex in downturns.
- **A land developer residual for raw land**: `maxLandBid()` is how raw-land
  asking prices get discovered, with agricultural value
  (USDA $/acre by state) as the floor.
- **Jurisdiction parameters**: yield (lots per gross acre), horizontal cost
  per lot, review months and approval odds. These are the levers that make
  Dodge pencil and Dane fail.
- **Phase-level state**: unbuilt, under construction or finished lots per
  phase, with a mothball decision when the lot price falls below the phase's
  own infrastructure cost.
- **Lot takedowns by builders** at their absorption pace, priced monthly at
  the residual.
- **Monthly cash flow, IRR, multiple and peak equity per project.** This
  script is a working reference implementation of all of it.
