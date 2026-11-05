# REAL ECONOMY PLAN: every number real, nothing artificial

> Owner, 2026-11-05: *"Create a plan to fix things so the economy is so well
> simulated that nothing is artificial and everything is real."*

This plan comes from the economy audit of 2026-11-05, run on main 49dc8d8 (#572). The audit ran:
- the shock battery: 20 shocks × seeds 11/22/33;
- the century test: seeds 11/22 × 60 years;
- the rail audit;
- conserve;
- deepplay on seed 7919;
- seven probes on the year-10 snapshots.

Every fault below carries the audit's evidence, so a fix can be measured against it. CLAUDE.md governs every step:
- realism outranks preference;
- no fake numbers;
- measure before and after;
- **never turn a coefficient until a test reads right**.

It supersedes the open parts of `ECON_REALISM_PLAN.md` and `RENT_VACANCY_RESPONSE_PLAN.md` (both 2026-10-12, written before the agent economy). `SHOCK_TESTS_PLAN.md` stays the method.

## Progress (updated as work lands)

| Item | State | PR |
|---|---|---|
| Plan and rules on main; ledger rows #29-#34 | done | #573 |
| 0.2 scorecard: charge-offs since the shock, the whole zero-rate peg, first-year vacancy | done | #574 |
| 0.3 the measured noise floor in every verdict; a second placebo | done | #575 |
| 0.5 deepplay bugs: folded-lot mortgages, city land, NaN through JSON | done | #576 |
| 1, step 1: ease measured ex ante; rigidity fades with inflation; a held rate holds | done | #577 |
| 1, step 2: the bank's overshoot once its credibility is gone (real rate ~+25, unemployment 29-34% after the peg) | open | — |
| 1b City Hall: foundation school aid, the buildings' own service cost, the budget sets the rate | in review | #578 |
| 2.1 stabilise at natural occupancy, deduct the building's own lease-up | in review | #579 |
| 3.1 step 1: an idle builder no longer lowers its margin | measuring | branch `claude/real-economy-3-1-margins` |

### Corrections to the audit
- **3.3 loan spreads: mostly not a fake.** The playthrough's coupons 5.7 points over the index (p50) were the bot borrowing from a private-credit desk (Cordage Debt Partners), which in life does price 4-7 points over. The bank desks quoted about 2.5-3 points, high in the real range. Desk pricing is already built from funding, expected loss and running cost (`pricing.ts` `liveSpread`, `costFloor`). Lower priority; re-check against MBA/ACLI once caps are right.
- **3.2 `deployPressure`: narrower than it looked.** It applies only to a raised fund with an empty book, so its cheaper equity can pull caps down, not up. It is still a rail to replace with fee drag on uncalled commitments, but it does not explain caps running high.
- **4.3 demolition is not the valuation.** With 2.1's stabilisation in place, new office stock standing in years 3-8 of a +50% glut is still +31.8% (was +31.9%). The driver is the redevelopment bar (builders' margins, 3.1), not the appraisal.

## What "everything is real" means here

A model always has inputs. "Nothing artificial" is a precise, checkable claim. Every number in the economy is exactly one of these:

1. **A sum or average of what named agents did.** Leases signed, deeds closed, pay posted, households moved, loans written.
2. **A calibrated fact with a citation.** A tax rate, a fee, a hard cost, a lease-up time, a default rate by coverage.
3. **A behaviour rule that a real actor uses,** applied with information that actor could have, and with any shape parameter sourced in its comment.
4. **An exogenous input from outside the town:** the nation, the swans, the weather. These are listed under *Allowed exogenous inputs* in FORMULA_LEDGER.md, and they reach the town only through agents.

Anything else is a fault. The plan is done when all of these hold:

| Test | Done when |
|---|---|
| FORMULA_LEDGER.md | **0 open rows**, including the six found unlisted (Phase 0) |
| `tools/rail-audit.mjs` | **No caps or rails on any economic outcome.** Every `rail`-class site is deleted, not merely made to bind less. Every remaining `Math.min` / `Math.max` / clamp is one of the two kinds below, and the audit asserts it |
| Physical and accounting bounds | Feet, people, money held and shares cannot go negative or above the whole. A bound of this kind **binds 0%** in a run, and a bind is logged as a bug: the model produced an impossible number upstream |
| Real actors' and laws' limits | A lender's maximum LTV or minimum DSCR, a zoning FAR, a tenant's lease term, a statute. Each cites its source, sits in the rail audit as `behaviour`, and binds only where the real limit would |
| `tools/shocks.mjs` on 5 seeds | Every graded row is RIGHT, or inside the measured noise floor of its window |
| `tools/proof.mjs` on 3 seeds × 100 years | 0 FAIL; WATCH only where the band itself is under review |
| `test/conserve.mjs` + the economy-wide identity (Phase 7) | $0 unexplained, for every agent, not only the player |
| `tools/deepplay.mjs` on 3 seeds × 20 years | 0 BUG, 0 REALISM lines |
| One-valuation identity (Phase 2) | The same building valued by any two functions differs only by a named, real role difference |

**These are a direction, not a target** (owner, 2026-11-05). Zero century FAILs over 3 × 100 years, every shock RIGHT on 5 seeds and zero rails may not all be reachable together, and a hard target is exactly what tempts tuning. A good mechanism that leaves one band failing ships, with the reason written down in the PR and in PROOF.md. The no-caps rule below is not part of this softening: no rail is ever added or kept to make a row pass.

## Rules for every step

- **One fault per PR.** Every PR states:
  - before and after for the rows it names (`node tools/shocks.mjs --only <ids> --seeds 11,22,33,44,55`);
  - the century rows it touches;
  - the rail-audit line for any rail it removes.
- **No caps or rails on economic outcomes, anywhere** (owner, 2026-11-05: *"nothing should be bound by rails or caps … everything needs to be simulated"*). A number that would go somewhere absurd without a bound is a broken mechanism; fix the mechanism. The only bounds allowed are physical ones (which must never bind) and real actors' or laws' limits (cited). See 8.4.
- **Remove the fake, build the mechanism, then look.** If a test reads wrong afterwards, trace it upstream. Never re-add a rail or turn a constant to restore the old reading.
- **Delete the old path in the same PR.** Do not leave dead code that the next agent mistakes for live (`market.ts` holds about 500 lines of dead rent equation; Phase 8).
- **Check what changed, not everything** (owner, 2026-11-05). `pnpm check` is the full suite (1-2 h) and runs nightly (`full.yml`) or at the end of a phase, never per PR. Per PR, run:
  - the CI smoke test (`.github/workflows/check.yml`: `tsc -b`, `test/fresh.mjs`, `test/rng-discipline.mjs`, `test/playable-fresh.mjs`, `test/playable-loads.mjs`, `tools/rng-audit.mjs`);
  - the targeted shock rows and century rows the fault touches;
  - `test/conserve.mjs` on anything that moves money.
- **Build on recent fixes; don't replace them blind** (owner, 2026-11-05). Several items touch fresh code, so read its PR and extend it:
  - apartment pricing (#567, landlords' guest cards, `streetRolls.ts priceFlats`): 4.2 extends that rent-setting model and does not replace it;
  - the closure re-tender (#566, ledger #28): 5.1 builds on it;
  - owner redevelopment (#554): 4.3 builds on it;
  - the land amplifier (#572);
  - tenants bidding for scarce suites (#569: tours, proposals, best and final; the landlord posts at what the contest fetched). Phase 4 builds on it. Its own open step is item 4.1: a firm's willingness to pay is still `worthOf`, relative to the town's rent index, not drawn from its own sales;
  - job matching (#570: hires at the matching function's flow, job loss as a reason to leave, job seekers weighing pay by their odds of work), and the search-friction unemployment floor that replaced the 0.0% rail. Phase 5 builds on it. Its open channels are items 5.1-5.2 and 5.4: the export base does not scale with labour supply, and the region builds no housing for newcomers.
  - Read those PR bodies before touching their code.
- **Grade against the noise floor** (owner, 2026-11-05). With few sales, twin cities drift 20-35% apart on values and land from a meaningless shock. No verdict is taken from inside the measured floor (0.3), and values and land need it most. Until 0.3 lands, use the floor in this file's last section.
- **Mind the CPU** (owner, 2026-11-05). The box has 4 cores, and one fault's shocks on 5 seeds take 30-60 minutes. Run heavy jobs in the background, one at a time (shocks *or* century *or* rail audit, never two together), do light reading and probes meanwhile, and never leave a job running past twice its expected time.
- **`BASELINE.json` will move.** Regenerate it in the same PR and say in the commit message which standing numbers moved, and why.
- **Run the course check** (`.claude/skills/course-check`) before each phase, and whenever a fix surprises you.

## Order

The order is set by dependency, not by size. Instruments come first, because half the battery's red rows are the tests' errors and a fix cannot be judged by a broken ruler. The macro economy comes second, because a hyperinflation corrupts every other reading. Valuation comes third, because almost every other fix (land, demolition, caps, lending) reads a value.

| Phase | What | Why here | Size |
|---|---|---|---|
| 0 | Instruments and honest accounting | So the next fixes can be measured | 4-6 small PRs |
| 1 | The nation cannot hyperinflate | It wrecks every other number | 1-2 PRs |
| 1b | City Hall (Phase 6, run here) | A tax rate stuck at half its sourced value feeds every value, cap and land price. Fixing it later would mean re-measuring phases 2-5 | 2-3 PRs |
| 2 | One valuation | Every other system reads it | 5-7 PRs |
| 3 | The price of capital | Caps, spreads and land sit on it | 4-5 PRs |
| 4 | Space markets | Retail, flats, demolition, starts | 5-6 PRs |
| 5 | Jobs and people | The aggregates still set from the top | 5 PRs |
| 6 | (City Hall: moved to 1b) | | |
| 7 | One ledger for the whole town | Money that is really accounted | 2 PRs |
| 8 | The remaining tuned constants, and dead code | The long tail | many small PRs |

---

## Phase 0: instruments and honest accounting (first, all small)

### 0.1 Write down what is still set from the top
- **Fault:** FORMULA_LEDGER.md lists only #28. The audit found six more aggregates set by an equation every month:
  1. **New-house price.** It closes 1/30 a month toward an affordability formula (`homes.ts:618` → `homeprice.ts:149`). No sale feeds it.
  2. **Mainland rent:** `mainRent *= gC·(hh/hhRef)^(1/1.75)` (`households.ts:2572`). It feeds the shelter CPI and every flat choice.
  3. **Online share of retail.** A logistic target closed at 1/60 a month (`market.ts:3943`). `ONLINE_MAX = 0.4` was tuned to a playthrough (`market.ts:310`).
  4. **`cycleDev`.** A random walk with a spring (`market.ts:3275`) that prices every distress sale.
  5. **In-migration.** A quota of 2.5%/yr × (relative pay)³ (`households.ts:2344`).
  6. **Off-map industrial occupancy.** The old gap-closing equation whenever the off-map share is ≥10% (`market.ts:4162`, `:4313`).
  - **Also:** #28's text is wrong. The re-tender is `r` × the *opening* share (`economy.ts:740`), not current capacity, and the entrants' orders go to existing firms.
- **Build:** add the six rows and correct #28. No engine change.
- **Done when:** PROOF's `Formula ledger` row reads 7, and the count only falls from there.

### 0.2 Fix the scorecard errors the audit proved

| Row | Fix | Evidence it is the test |
|---|---|---|
| Credit crunch charge-offs, NO RESPONSE | Difference `chargeOffs` from the snapshot, not lifetime (`tools/shocks.mjs:112`, `tools/shocks/capital.mjs:74,188`) | Since the shock, charge-offs run 1.4× / 2.5× / 3.1× the control by year 6 |
| −20% industrial vacancy, NO RESPONSE | Grade month 1 and year 1, not only the 0-3 year mean | Vacancy goes 5.6→1.7, 9.4→1.9, 9.3→2.7 at month 1; seed 22 rebuilds all 194k sf by month 36 |
| Tax and insurance capitalisation on twins | Grade the income channel as a **static** test: the same snapshot, only the bill changed, appraised both ways. Keep the twin rows for the dynamics | Static tax ×2: office −2.8% to −3.9% and apartments −4.9% to −6.2%. Twin year-1 office `inc` swings −0.8% to +0.7% |
| Zero rates, hold check | Check the hold over the whole peg (120 months). Either record pre-meeting policy, or stop the committee meeting while the peg is on | Policy reads 5.99 / 10.88 / 20.43% at months 72 / 96 / 119 while it is "pegged at 0.25%" |
| Largest employer leaves | Close the top firms until **≥5% of town jobs** are gone. Pick the occupied-floor observable by the firm's class (`tools/shocks/demand.mjs:98`) | Today the firm is 0.6-1.6% of jobs, so the expected out-migration of −0.2% to −0.8% sits inside the placebo's −0.8% |
| Per-class starts rows | Grade starts as an all-class sum over ≥3 years, or with ≥5 seeds; drop single-class starts verdicts | Placebo apartment starts, years 3-8: S/C 0.14 / 0.43 / 2.61 |
| Deal volume | Count every arm's-length sale, not only cap prints (`propmarket.ts:508,539` drop sales near the dirt) | Code |
| Retail glut and e-commerce, late rows | Grade against the control's own path, and report whether the *control* is in steady state | The seed-11 control overbuilds retail to 27% vacancy on its own |
| Rates +300bp ten-year band | Expect what agents who cannot know the hike is held would price. Record the delivered policy gap (+2.1 to +2.5, not +3) | Agents' information |

### 0.3 Put the noise floor into the grade
- **Fault:** `judge` (`tools/shocks.mjs:248-259`) compares effects with a fixed 2% / 0.5pp. The placebo is graded almost only on the impact window, but its peaks are value ±20-60%, land ±46%, listings ±54%. Real shocks also diverge faster than the placebo.
- **Build:**
  - Run the placebo on 5 seeds with **three** perturbations of different size (premium ×1.001, one lease's start month +1, one household moved).
  - Take the floor for each observable and window as the 90th percentile of |effect| across them.
  - `judge` returns NOISE for any effect inside the floor.
  - Print the floor table at the top of SHOCK_TESTS.md.
- **Done when:** no verdict is drawn from inside its floor.

### 0.4 Injectors that write a computed state
- **The cases:**
  - E-commerce overwrites `econ.online` every month (`tools/shocks/demand.mjs:290-304`).
  - Insurance holds `opexIdx.ins` and `insCap` against their recursion (`cost.mjs:99-111`).
  - Tax writes `econ.taxMult` directly (`cost.mjs:171-183`).
- **Build:**
  - E-commerce: move the households' channel share (`households.ts bookSpend`) once Phase 5.4 makes it a household choice. Until then, mark the row PROVISIONAL.
  - Insurance: shock the insurers' capital, or the nation's catastrophe losses (`inputs.ts`).
  - Tax: set the statutory rate only, and let `publish` (`citygov.ts:632`) write `taxMult`.
- **Supply +50%:** route new buildings through cohorts with an owner, `condIdx` and `buildSpec` (`tools/shocks/supply.mjs:84-103`), and take the target from on-map stock.

### 0.5 Bugs the playthrough found
- Non-finite numbers in `g.econ.seekers[N].was.dWork` and `.dLink` from month 1 (deepplay: 240 and 180 hits).
- A listing with `ask = 0` (bbl 1002130001, months 31-34; 168 hits, plus 56 invariant hits).
- **Done when:** deepplay on seeds 7919, 11 and 22 prints 0 BUG.

---

## Phase 1: the nation cannot hyperinflate

- **Fault.** Ten years of a 0.25% policy rate on a town at full employment ends in hyperinflation on every seed:

  | | seed 11 | seed 22 | seed 33 |
  |---|---|---|---|
  | CPI by year 15 | ×233 | ×127 | ×74 |
  | policy rate, peak | 127% | 115% | 100% |
  | unemployment, peak | 34% | 38% | 32% |

  Inflation keeps compounding *after* release, with a policy rate far above inflation. That should be impossible.
  - The engine's own comment records the regime: "ran its full term into a 70% inflation and a 105% policy rate" (`market.ts:2770`).
  - Unemployment fell to 2.5-3.0% under the peg, so *some* inflation is right (US 1965-79). Triple digits is not.
- **Where:**
  - inflation expectations and the credibility walk (`market.ts` around `:2600-2640`, `regime.ts driftInflTarget`);
  - the Phillips curve in `tickNation`;
  - `bankStep` (`market.ts:2779`);
  - how expectations feed wages (`economy.ts postPayAndPrices`) and back into prices.
- **Build:** an expectations process that satisfies the Taylor principle.
  - Inflation = anchored expectations + slope × slack + supply shocks.
  - Expectations are a weighted mix of the target and recent inflation. The weight on the target is credibility, and it is *earned back* when the real policy rate is positive (Bernanke & Blanchard 2023; Ball & Mazumder 2011; Michigan long-run expectations 1980-95).
  - A real policy rate above r* must lower inflation within 1-3 years. That is a property to test, not a coefficient to set.
- **Done when:**
  - The zero-rate peg at full employment gives peak inflation in the range of US 1965-81 (≤15-20%), breaking within about 3 years of release.
  - A Volcker test (+8 points real) takes inflation from 12% to under 5% in 2-4 years at a 3-6 point unemployment cost.
  - The control century still passes its cycle rows (recessions per decade, months in recession).

---

## Phase 2: one valuation

Every function that values a building or a lot reads **one** income model. Functions differ only where real actors differ, and each difference is named:
- a lender haircuts;
- an assessor lags;
- a buyer forecasts.

### 2.1 Stabilisation that works
- **Fault:** `stabilisedIncome` (`value.ts:4027`) swaps the city vacancy for `normalVac`. But `noiYr(…, stabilised=false)` reads each street building's own roll (`useOccupancy` → `streetLetShare`, `value.ts:2994-3016`), so the swap does nothing.
  - On the seed-11 snapshot, `noiNat == noiNow` on **292 of 292** sampled buildings.
  - A 60%-let office (the street's p10) is valued as if it stays 60% let forever.
- **Build:** value = stabilised NOI ÷ cap − PV(lease-up rent loss + leasing commissions + TI + downtime), the standard appraisal approach (Appraisal Institute, *The Appraisal of Real Estate*, 15th ed.).
  - Lease-up time comes from the class's own record of months on market (`tenantMarket.ts MONTHS_ON_MARKET`, sourced).
  - Stabilised occupancy is the market's own long-run let share (`normalVac`), adjusted by this building's quality band.
- **Done when:**
  - A probe shows `noiNat ≠ noiNow` for every under-let building.
  - Appraisal over clearing price on listed buildings has median 0.95-1.05 (the NCREIF appraisal-to-sale ratio).
  - Then re-measure §4.3 (demolition), which reads this value.

### 2.2 One stabilised occupancy
- **Fault:** there are four.
  - (a) 85% of today's gap kept (`value.ts:3083`), used by bidders, the pro forma and the lender's view;
  - (b) `1 − normalVac` (`value.ts:3411`), used by the assessor and the build brake;
  - (c) a flat 0.90 / 0.95 × a glut haircut (`value.ts:1268` `devPencils`);
  - (d) the dead swap of 2.1.
  - The pro forma also reads rent at *forward* vacancy and occupancy at *today's* (`proforma.ts:690-701, 1117-1123`).
- **Build:** one function, `stabilisedOcc(rec, econ, horizonM)`. A buyer's or developer's *forecast* of it at delivery is a belief (`beliefs.ts`), stated as such.
- **Done when:** grep finds one definition, and the pro forma's stabilised year equals the delivered building's first stabilised appraisal in an unchanged market.

### 2.3 Learn the cap on the same model it is applied with
- **Fault:**
  - Prints are restated with `holdingValue`: a 55/45 in-place/stabilised blend, a 3% apartment reserve, a roll-quality spread (`propmarket.ts:500-512`, `value.ts:4830`).
  - The read is applied through `assetValue`/`noiYr`: market rent, no reserve.
  - The reserve sits on one side only (`value.ts:3929` vs `:3477`). The comment says 7%; the constant is 3% (`:3192`).
- **Build:**
  - One NOI definition: effective rent at stabilised occupancy, less opex, less a reserve on **both** sides, sourced (NCREIF/Green Street apartment reserves of $250-400 per unit a year).
  - In-place leases enter as the PV of the gap to market over each lease's *remaining term* (`assetValue`'s method, not `holdingValue`'s perpetual 55%).
- **Done when:** the cap implied by a print, re-applied to the same building, returns its price (±1%).

### 2.4 Face rent, effective rent and free rent, once
- **Fault:**
  - The street lease adjustment compares face rent with 0.95 × the *effective* rent (`value.ts:4098`).
  - Remaining free rent is never deducted (`value.ts:4789`, `POSITIVE_INFINITY`).
- **Build:**
  - Compare like with like: effective against effective, or face against face with concessions as cash flows.
  - Deduct remaining free months as a PV.
- **Done when:** a freshly let building in a deep-concession glut appraises at what bidders pay, ±5%.

### 2.5 The rent the player is shown is the rent tenants pay
- **Fault:** tenants' letters to the player arrive at a median **0.61×** the market rent the screen shows (deepplay: LOI rel-to-market p10 0.39, p50 0.61, p90 1.00). So the player's tenants renewed **0 times in 20 years**.
  - Either `managedRentPsfYr` is not the market, or `offerForPlayer` (`tenantMarket.ts`) is not pricing against the same street.
- **Build:**
  - The screen shows the effective rent of comparable leases signed in the last 6-12 months, as a broker's comp sheet does.
  - A tenant's offer is what leaves it as well off as its best street alternative. In equilibrium these two meet.
- **Done when:**
  - Renewal LOIs centre on 0.9-1.0× the shown market.
  - Renewal probability at lease end is 50-75% (office) and 50-60% (apartments): CoStar / Kingsley retention surveys; NMHC renewal-conversion data.

### 2.6 Tax recovery per rentable foot, and units throughout
- **Fault:**
  - Tax per foot is computed on gross area (`value.ts:3916`) and billed per rentable foot (`:3370`), so a 100%-let NNN building leaks 10-17% of its tax.
  - Tobin's q and `devPencils` divide value per rentable foot by cost per gross foot (`dev.ts:717`, `value.ts:1274-1282`), overstating q by about 1.15-1.25.
- **Build:**
  - Pro-rata share = tenant RSF ÷ building RSF (BOMA Z65.1).
  - q and yield-on-cost compare value and cost in the same feet.
- **Done when:** a 100%-let NNN shed shows 0 tax leakage, and q from `cityValueToReplacement` equals the pro formas' value over cost.

### 2.7 One land-option rule, one survey rule
- **Fault:**
  - Two land-option rules: `WAIT_DISCOUNT` / `PEAK_RENT_MULT` (`value.ts:572`) against `bankerHoldValue` (`propmarket.ts:1331`).
  - Two surveys answer the same question two ways: the land survey prints the **top** bid of about 40-60 firms (`propmarket.ts:1696`), and the cap survey the second (`:1081`).
  - Two maximum prices for one builder: `firmMaxPrice` (`rivals.ts:5460`) against `landMaxPrice` (`propmarket.ts:1229`).
- **Build:**
  - One option value (`bankerHoldValue`, on the town's own rent volatility).
  - Both surveys take the clearing price of the same filtered room that `landBidRound` builds (cash, fit, deals a year): the second-best bid.
  - One max-price function per firm.
- **Done when:** the land read over the residual has median 0.9-1.1, against about 1.7 today (SHOCK_TESTS_PLAN run 2).

---

## Phase 3: the price of capital

### 3.1 Builders' margins are the trade's
- **Fault:**
  - `firmMargin` decays to 40% of the band after about 3 years idle (`rivals.ts:279`). A never-built firm has `idle = month`.
  - The style bands start at 0% (`rivals.ts:256`, "added because … saw nothing built for years").
  - Owner redevelopment inherits both (`dev.ts:4047`).
- **Build:**
  - Margins at the trade's profit on cost: `DEV_MARGIN` 0.17, already sourced. Developers who hold differ by cost of capital, not by a margin of zero.
  - Idleness costs overhead out of the firm's books (G&A as a share of AUM; NAREIT and Green Street G&A of 0.5-1% of gross assets). It does not lower the hurdle.
  - If nothing gets built then, trace why; do not lower the margin.
- **Done when:** grep finds no idle term in a hurdle, and starts in the century are 1-3% of stock a year *without* it.

### 3.2 The cost of equity is not cut by a rail
- **Fault:**
  - `deployPressure` is at its cap of 2 in **71.5%** of calls (`rivals.ts:5484`), which takes 0.75pt off every mature fund's equity premium for good (`propmarket.ts:255`).
  - Contrarians take up to 2 more points off (`contra·shut·2`), unsourced.
- **Build:**
  - Dry powder costs what it costs in life: the fee drag on undeployed commitments, and a fund-life deadline. A fund near the end of its investment period lowers its hurdle by the IRR drag of not deploying, computed from its own terms (Preqin fund terms: 4-5-year investment period, 1.5-2% fees on commitments).
  - No cap.
- **Done when:** the rail-audit line reads 0%, and caps in the century sit at 5-8% with spreads of 2-4pp over the ten-year (CBRE Cap Rate Survey; NCREIF). Today they are 9.63% and 4.7pp, and office reaches 13.5% (8.7pp) in deepplay.

### 3.3 Loan spreads from the desks' own costs
- **Fault:**
  - The player's coupons sit a median **5.7 points** over the index (p90 8.9; refis at 15-22%).
  - Firms pay one flat `RATE_SPREAD = 1.9` and `CONSTR_SPREAD_R = 2.6` whatever the LTV (`rivals.ts:211`, `:583`), unsourced.
- **Build:** a desk prices a loan as funding cost + expected loss (PD × LGD from the loan's own DSCR and LTV) + capital charge × hurdle + opex. The parts are already sourced in `lenders.ts` (`BOOK_SPREAD`, `PRIOR_EL`, `RISK_WEIGHT`, `HURDLE`). Firms borrow from the same desks.
- **Done when:** permanent coupons sit 150-300bp over the ten-year at 55-65% LTV, and construction coupons 300-450bp over the short index (MBA / ACLI commitments; Trepp; Fed SLOOS).

### 3.4 Distress and auction prices from bidders, not formulas
- **Fault:**
  - `distressPrice = max(0.62, 0.90 − 0.22·tight − 0.08·down)` (`sponsor.ts:73`) reads `cycleDev`. It sets the receiver's sale (`facility.ts:1149`) and creditor seizure (`sim.ts:1367`).
  - The July auction draws 0-5 phantom bidders and a ×1.03-1.14 "fever" (`auction.ts:244-251`).
  - All of them print to the cap tape (`comps.ts:131`).
- **Build:**
  - Every forced sale runs `forcedSalePrice` / `bidRound` with the named firms who can close, against the seller's deadline.
  - The auction room is the firms who register.
  - Delete `distressPrice` and `cycleDev` (ledger 0.1 #4).
- **Done when:** grep finds neither, and distressed discounts in the century run 10-30% of appraisal, larger in crunches (RCA distress reports 2009-11).

### 3.5 Note collateral is valued, not asserted
- **Fault:** `collateralAsIs = assetValue(worn) × min(0.72, 0.18 + 0.74·occ)`, at its cap in 94.3% of calls (`value.ts:4901`).
- **Build:** the as-is value from 2.1 (stabilised less the PV of lease-up and the cure of deferred maintenance), less the receiver's costs and time (foreclosure 12-24 months; ATTOM, MBA).
- **Done when:** the rail is gone, and note buyers' prices are a named calculation.

### 3.6 The appraiser's grid and condition tables
- **Fault:**
  - Across 442 offices on one snapshot, the per-building cap spreads only p10 6.6% to p90 6.8% (condition held fixed).
  - Condition tables stack to about 3× the value from obsolete to good (`CONDITION_RENT_MULT` 0.62-1.2, `value.ts:1720`; `QUAL_SPREAD` +185bp, `:2108`), unsourced.
  - `residentialSpread` is a cap spread written as a formula (`value.ts:4212`, at its clamp in 51.2% of calls).
  - The 2-20% cap clamp held a worn office at exactly 20.0% for 5 years (`value.ts:3460`).
- **Build:**
  - Condition effects are fitted by the hedonic grid from prints (`econ.capFit`), as location already is.
  - The rent gap by class band comes from the street's own leases.
  - Delete the tables and `residentialSpread`.
  - The clamp stays a guard, and must bind 0% in deepplay.
- **Done when:** Class A against Class C sits at about 1.4-1.8× rent and 100-200bp of cap (CBRE; CoStar), as an output.

---

## Phase 4: space markets

### 4.1 Shops: sales, not space
- **Fault:**
  - In the seed-11 control, shop vacancy goes 3.8% → 27.3% while effective rent rises 90% (CPI +55%).
  - +50% retail stock fills 24% more space in a year with unchanged spending.
  - E-commerce −20% moves vacancy +0.7pp and rent −2.4%.
  - Century: retail vacancy 19% (FAIL, band 4-13%); rent and vacancy correlation +0.05 (FAIL).
- **Build:**
  - A shop is a firm with sales. Sales are the households' spending in its category within its trade area, split by the shops competing for it (Huff gravity; `footFactor` already reads walk-ins).
  - A shop opens where expected sales cover occupancy cost at the category's sustainable share (8-12% of sales; ICSC / NRF occupancy cost data) and closes on its own books (`tenantBooks.ts`).
  - The failure kernel's unsourced constants (`FAIL_K`, the stress caps, `tenantBooks.ts:245-252`) are replaced by coverage → default rates (S&P / Moody's / SBA, already used for `Z_RHO`).
  - Retail landlords then face real demand, and the existing landlord rules (patience, packages) answer it.
- **Done when:**
  - +50% retail: rent −8% to −30% and vacancy absorbing.
  - E-commerce −20%: shop vacancy +3-8pp, closures, and conversions where they pencil.
  - Century retail vacancy 4-13%, and rent/vacancy correlation −0.15 or below.

### 4.2 Flats: pricing that real revenue management would produce (extends #567)

#567 already prices each block on its own guest cards, which is the right rule. This item extends it: the landlord's objective over the lease term, an occupancy target and renewal limits. It does not replace it.
- **Fault:**
  - +50% stock: effective rent −64% in two months, recovered within 2 years.
  - The control swings ±20% a year.
  - −20% stock: 0% vacancy for 5 years with rent −4% to +12% and no rebuild.
  - +30% arrivals: rent +34% while vacancy *rises*.
  - `SCREEN = 0.5` of income where the cited source says 33-40% (`households.ts:1323`).
- **Build:** the landlord's real objective.
  - **Pricing:** maximise expected revenue over the lease term, given the guest-card demand curve and the cost of a vacant month (RealPage / Yardi practice: price daily against a target occupancy band of 93-96%, with limits on renewal increases).
  - **Supply:** the builder answers on the pro forma. Phase 2 makes that pro forma read the same stabilised value the street pays.
  - **Screening:** income screening at the sourced ratio.
  - **Arrivals:** they are housed where they choose; if they cannot pay, they leave or double up (households.ts).
- **Done when:**
  - Effective rents move ±3-8% a year (RealPage / Yardi Matrix).
  - A +50% glut gives about −5% to −20% over 1-2 years.
  - −20% stock gives a construction answer in 1-3 years and rents +5-15%.

### 4.3 New buildings are not demolished (builds on #554)
- **Fault:**
  - New office, retail and industrial stock standing in years 3-8: S/C +31.9%, +26.8%, +18.6% of a +50% injection.
  - Office is back to S/C 1.01-1.22 by year 15.
  - The cause is `ownerRedevelopment` (`dev.ts`), with the eroded margin (3.1), an unsourced 8% minimum addition (`dev.ts:3995`) and the dead stabilisation (2.1).
- **Build:** the teardown test in life. Redevelop when the value of the new scheme less its cost exceeds the value of the building as it stands, with the standing value from 2.1 and the trade margin from 3.1. Delete the 8%.
- **Done when:** new stock still stands at +35-55% in years 3-8. Demolition of buildings under 20 years old should be negligible (US Census, *Components of Inventory Change*).

### 4.4 Starts are decisions, not odds
- **Fault:**
  - The start probability is `min(0.95, want·ci·1.35·suit·deployPressure)`, at its cap in **86.4%** of calls (`rivals.ts:964`).
  - `BUILD_APPETITE` (`rivals.ts:441`) was set "so named builders actually build".
  - Crew capacity drifts by formula (`dev.ts:3851`).
- **Build:**
  - A builder starts every scheme that clears its hurdle, within its capital and its crews.
  - Crew capacity is the contractors' named staff: hires are bounded by the town's construction labour, and firing is free.
  - Delete the odds and `BUILD_APPETITE`.
- **Done when:** the rail is gone, century starts are 1-3% of stock a year, and both lag rows pass.

### 4.5 Industrial off the map is summed, and vacancy has no ceiling
- **Fault:**
  - When the off-map share is ≥10%, off-map industrial occupancy is the old equation (`market.ts:4162`, `:4313`), chasing the opening's occupied stock (`:4193`).
  - Off-map office, retail and flats get the mapped let rate (`market.ts:4277`).
  - `cityVac` is clamped at 45% (`market.ts:4362`).
- **Build:**
  - Off-map space is occupied by the off-map firms' heads × their industries' feet per worker (`industries.ts sfMix`), as on the map.
  - Remove the clamp: vacancy is 1 − occupied ÷ stock.
- **Done when:** ledger row 0.1 #6 is removed, and the clamp's bind count reads 0.

### 4.6 Credit reaches construction
- **Fault:** halving construction loans moves 3-year starts by 0.46 / 0.95 / 1.19, inside the ±20% noise on two seeds.
- **Build:** a builder's scheme needs its construction loan sized by the desk (`proforma.ts`, `constructionLtc`). Unsourced floors (`max(0.5, app)`, `max(0.85, creditIdx)`, `proforma.ts:628`) come out. The equity check is the builder's real account.
- **Done when:** the credit crunch moves starts −20% to −90% on every seed (2008-10: US multifamily and commercial starts −60-80%).

---

## Phase 5: jobs and people

### 5.1 The town's share of national orders is what its firms win (ledger #28; builds on #566)
- **Fault:**
  - The routine re-tender is `r` × the *opening* share (`economy.ts:740-745`), so every industry drifts back to where it started in 4-8 years.
  - A closure is refilled: −1.06 to −1.37 jobs per direct job at +2 months, back to −0.89 (one seed +0.04) within 3 years.
- **Build:**
  - Re-tendered orders are shared among *all* the nation's suppliers by quality-adjusted price. The town's firms win `capacity × pull ÷ the nation's capacity × pull`, with no reference to the opening.
  - New establishments decide to open here on their costs and on the orders they can expect to win: an entry decision at BDS rates conditional on profitability (Glaeser & Kerr 2009).
  - Off-map firms close on their books.
- **Done when:** ledger #28 is removed, and a closure of ≥5% of jobs costs 1.5-2.5 jobs per direct job and stays (Moretti 2010; Gathmann, Helm & Schönberg 2020).

### 5.2 Arrivals find work as people really do
- **Fault:** +30% population gives jobs +5% and unemployment +12pp (6.8% → 27%).
- **Build:** this follows from 5.1, plus local demand. Newcomers spend (`bookSpend`), which raises local-serving firms' sales and hiring, and lower posted pay wins exporters more orders (`pull` already reads price).
- **Done when:** unemployment rises briefly (+1 to +3pp) and returns within 2-4 years (Card 1990, Mariel: no measurable unemployment effect; Peri 2012).

### 5.3 Migration is households deciding
- **Fault:** in-migration is a quota of 2.5%/yr × (relative pay)³ (`households.ts:2344`); job-seekers are added the same way (`:3073`).
- **Build:**
  - A national pool of movers (CPS ASEC mover rates by age and tenure) weighs this town against the nation on pay, rent, commute and taxes, using the same choice households already make to leave (`MOVE_ELAST`, Diamond / Moretti, sourced).
  - Arrivals are the movers who choose here.
- **Done when:** ledger 0.1 #5 is removed.

### 5.4 Prices households pay are set by trades, not formulas
- **New-house price:**
  - **Fault:** set by formula (`homes.ts:618`).
  - **Build:** builders list new houses at their own ask; households in `buyCheck` bid within what they can carry. The index is the median closed price per sf, repeat-sales adjusted (Case-Shiller method).
  - Delete `HPI_CHASE_M` and the `hhUserCost` floor of 3.5% (`market.ts:1987`, `households.ts:1407`). The user cost is the Himmelberg, Mayer & Sinai (2005) sum with no floor.
- **Mainland rent:**
  - **Fault:** a supply-elasticity formula (`households.ts:2572`).
  - **Build:** a coarse mainland market of landlord agents with a supply curve built by builder agents. The mainland is large, so a few aggregate landlords per submarket suffice, but they must price on their own vacancy, as island landlords do.
- **Online share:**
  - **Fault:** a logistic target (`market.ts:3943`).
  - **Build:** each household's channel choice, by category, on price and convenience (Census e-commerce share as the calibration: about 16% of retail in 2024, higher in shippable categories). Delete `ONLINE_MAX`.
- **Done when:** ledger rows 0.1 #1-#3 are removed, and +30% arrivals move home prices with rents.

### 5.5 Delete `cycleDev`
- Once 3.4 removes its last reader, delete the walk (ledger 0.1 #4).
- Any "sentiment" an actor uses must be its own belief, read from data it can see (`beliefs.ts`).

---

## Phase 6: City Hall (run as phase 1b, right after Phase 1)

### 6.1 The property-tax rate closes a real budget
- **Fault:**
  - The rate goes 1.1% → 0.877% → 0.700% → **0.55% by year 3 in every seed** and stays at `PROP_LO` (`citygov.ts:170`, `:676`; 79% of the council's moves bind).
  - The city runs a 25% surplus at 1.1% ($24.9M revenue against $18.8M spending in year 2) and still runs surpluses at 0.55%, with cash at a full year of spending.
  - The opening spending (`SERVICES_PC` $1,400 per head, `PER_PUPIL` $15,600; `citygov.ts:72-74`) is not sized to the revenue sources.
  - Deepplay's tax-to-value p50 is 0.4%.
- **Build:**
  - Size the opening city from US municipal finance (Census of Governments, Annual Survey of State & Local Finances): spending per head by city size, and property tax about 30% of own-source general revenue.
  - Aid is part of the same table; today it is $6.75M against $14.1M of property tax.
  - Then the levy closes the budget, and the rate is levy ÷ assessed value, as in every US city with a levy limit.
  - The rails stay as guards and must not bind.
- **Done when:**
  - The rate sits in a 1.2-2.5% effective range (Lincoln Institute / MFC 50-State Property Tax Comparison, 2023) and moves with the budget.
  - `PROP_LO` / `PROP_HI` bind 0%.
  - The tax ×2 shock still capitalises (static −3% to −4% office).

### 6.2 One assessor
- **Fault:** there are three.
  - The city roll is a class average with a 36-month lag (`citygov.ts:350-363`).
  - The player's deed is a +32% / −9% ratchet from purchase (`sim.ts:1170`).
  - Street buildings are taxed at current value with no lag (`value.ts:4064`).
  - Council revenue is `assessed × rate`, not the sum of bills (`citygov.ts:395`).
- **Build:**
  - One parcel assessment roll for every owner: mass appraisal of the Phase 2 value, a sourced revaluation cycle (1-3 years by state; IAAO standards), and appeals for everyone.
  - The city's revenue is the sum of the bills.
- **Done when:** grep finds one assessment function, and city revenue equals Σ bills to the dollar.

### 6.3 Tiebout
- **Fault:** with tax ×2 held, the population is +0.7% late, inside noise.
- **Build:** nothing new. Measure again after 6.1 and 0.2, with a large enough shock and 5 seeds.

---

## Phase 7: one ledger for the whole town

- **Fault:**
  - The stock-flow ledger (`sfc.ts`) balances: $0.0004 on $22.5B gross at year 10.
  - But its `land` sector holds **$2,612M** while the 68 named rival firms hold **$38.9M** of cash (seed 11, year 10). Rents firms pay land in a sector bucket, not in the books of the firms that own the buildings.
  - Conserve covers only the player's cash, and its `fees` line was never exercised.
- **Build:**
  - The landlords' sector *is* the named owners. Every owner, including the player, the rivals, the land funds and the register's holders, gets a ledger account, and every rent, sale, loan, tax and fee moves through `transfer`.
  - The player's `s.cash` becomes a view of its account.
  - Extend `test/conserve.mjs` to assert, every month:
    - Σ balances = 0;
    - each agent's cash change = its booked flows;
    - each loan's balance on both sides.
  - Make the bot exercise fees.
- **Done when:** whole-economy conserve passes 50 years × 7 seeds with $0 unexplained for every agent, and the coverage line has no NO.

---

## Phase 8: the long tail

### 8.1 Tuned constants to source or derive
Each one becomes either a cited fact or an output. Each is its own small PR, with its rows measured.

| Constant | Where | Problem | Replacement |
|---|---|---|---|
| `RETAIL_YIELDS_ABOVE = 6` | `dev.ts:807` | Set to an outcome | Compare the retail and mixed residuals already computed |
| `NEUTRAL_APPETITE = 0.43` | `rivals.ts:2484` | "Measured from play" | Absorption from bidder counts and marketing time (RCA / CoStar: 4-8 months) |
| `YIELD_OVER_COUPON` | `rivals.ts:1939` | A second hurdle beside `EQUITY_PREMIUM` | Delete; one hurdle |
| `SPREAD_FULL = 3.5`, `DISTRESS_PITCH` | `rivals.ts:2657-2672` | The engine's own p90 | Investors' allocation from `investors.ts` (sourced) |
| `LOC_SPREAD.office.max = 2.20` | `value.ts:2227` | "Should not mint Midtown" | The hedonic grid fitted to prints |
| `HARD_COST_PSF.industrial = 100` | `value.ts:454` | Moved "because the class never cleared" | The RSMeans midpoint, then trace the hurdle |
| `PATIENCE_M`, `EXIT_BASE`, `SHED_MOVE` | `streetRolls.ts:107-113` | Unsourced | Months on market and renewal rates (`tenantMarket.ts` `MONTHS_ON_MARKET`, already sourced) |
| `TICKET_PCT` | `rivals.ts:572` | Unsourced | Fund concentration limits (Preqin / LPA terms: 10-20% of commitments per deal) |
| `CAPITULATION` floor 0.25 | `comps.ts:470` | Binds in 36.7% of calls | No floor; the holder sells or holds on its own books |
| `reAllocation` cap 2× | `investors.ts:124` | Binds in 27% of calls | Re-measure after 3.2; it should stop binding when caps are right |
| Desk share floor 5% | `rivalDebt.ts:369` | Binds in 67% of calls | The desk lends what its capital allows, or nothing |
| `TAX_RATE` 0.011 | `value.ts:3381` | "~1.1%" with no citation | Cite (Lincoln / MFC); becomes moot after 6.1 |
| `takeprivate.ts:184-187` ±5% premia | | Design bounds | Control premia from M&A data (median about 25-35%; FactSet Mergerstat) |

Run `tools/rail-audit.mjs` after each phase. Every `rail`-class site still in the code, at any bind rate, gets a row in this table, until none are left.

### 8.4 Every bound in the engine is classified, and the classification is enforced
- **Fault:** the rail audit classes 3,264 sites from their source text, so a rail can hide under the name "guard".
  - 257 sites classed `guard` bind in ≥1% of calls. A true guard on a physical bound should never bind in a working model.
  - 1,441 sites never ran in the audit (the player's paths and rare branches), so their bind rate is unknown.
- **Build:**
  - **Annotate every remaining bound** with one of `// bound: physical — <what cannot be negative or exceed the whole>`, `// bound: actor — <who, and the source>`, or `// bound: law — <statute>`.
  - **Make the rail audit read the annotation.** It fails on any unannotated site, any `rail` site, and any `physical` site that binds in a run.
  - **Read the 257 binding guards one by one.** Each is a disguised rail (delete it, simulate the quantity), a symptom (fix upstream, then it stops binding), or a correctly classed actor limit.
  - **Cover the unrun sites** with the deepplay bot and the MDGA player paths, so no bound goes unmeasured.
- **Done when:**
  - The audit passes with 0 `rail` sites and 0 binding `physical` sites.
  - Every `actor` and `law` site carries a citation.
  - Coverage of instrumented sites is above 95%.

### 8.2 Delete dead code
- The old rent equation, `market.ts:4697-5227`: runs only when `!e.streetRolls`, which is created at opening. It is still read by appraisal scratch copies (`absorption.ts:183`, `rivals.ts:2361`), which must be switched first.
- `PHASE_CFG` `rentDrift` / `devDrift` (`market.ts:416-423`).
- `classF` / `onRailLevel` (`market.ts:4954-4960`).

### 8.3 Opening conditions that persist
These are allowed as initial conditions only, and each must have a half-life.
- `normalVac` starts at the national `OPENING_VAC` and learns over 20 years (`market.ts:4589`, `NATVAC_RATE`). Measure that the prior is under 10% of the value by year 30.
- The opening land formula (`market.ts:1619`) and opening rents solved to a drawn Tobin's q (`market.ts:1519-1586`): confirm the first land survey and the first year of leases replace them.

---

## What is real already, and must not be "fixed"

From the same audit. A change that breaks any of these is a regression.

- **Office rents** are the mean of signed leases, and the glut has the record's shape: −5% at year 1, −25% at year 3, −40-48% at year 5, at 36-42% vacancy. Remote work and −20% office are RIGHT.
- **Rates +300bp:**
  - caps +0.9 / +0.7 points;
  - deal volume −48%;
  - distressed listings +81%;
  - charge-offs +186% in years 3-8;
  - all-class starts −64%;
  - rents flat at first.
- **Zero rates (before the spiral):** caps −1.3 / −0.8 points, land +10%, the mortgage book +21%, starts +47%, distress +246% after release.
- **Construction cost +40%:**
  - the bid index +31%;
  - starts down 34-94%;
  - land −16% to −24%;
  - existing office values +12%;
  - rents up later.
- **Insurance and energy ×2** in the record's order: gross apartments −11.5%, base-year office −1.8%, NNN about −2%.
- **Tax capitalisation in the appraisal** (static −2.8% to −3.9% office).
- **The credit crunch** reaches trades (−21% to −31%) and losses (1.4-3× by year 6).
- **Agent-summed aggregates:**
  - wages (heads-weighted posted pay);
  - jobs, unemployment and population (the register);
  - cap and land reads (closed deals between named bidders);
  - the credit window (the desks' books);
  - construction cost (contractors' winning bids).
- **The policy rate has no hard floor** (Rogoff 2016), and flats are priced on guest cards, which is a real rule.
- **Sourced constants:**
  - `DEV_MARGIN`, `HARD_COST_PSF`, `EQUITY_PREMIUM` (the table), `RISK_PRICE`;
  - `HOUSING_SUPPLY_ELAST`, `ENTRY_YR` / `EXIT_YR`, `MOVE_ELAST`, `WAGE_CURVE`;
  - the lenders' `BOOK_SPREAD` / `NORMAL_NIM` / `DEPOSIT_SPREAD_PCT`;
  - `RENT_VOL_PRIOR`, `Z_RHO` / `Z_SIG`.
- **Money:** the player's identity reconciles to $0 over 1,200 months, and the city ledger sums to zero.

## The noise floor (from the audit; Phase 0.3 replaces it with a measured table)

- **Impact window (0-3 years):** medians within ±2.5% are noise.
- **Years 3-15:** single-seed value moves under about 20-35% are noise. Land moves up to ±46% and listings up to ±54%.
- **Starts:** all-class starts over 3 years carry ±20%. Single-class starts carry ×0.14-2.6, so they cannot be graded.
- **Deal volume:** ±6%.
