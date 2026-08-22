# Phase 6 — measurement (do not tune)

Phases 0–5 shipped the floorplate inventory and the posted leasing plan.
This file is the Phase 6 record. Numbers come from the committed engine.
Do not retune coefficients because a column is “too high” or “too low.”

## Block-premium wire

`blockPremAdj(tight, kind)` is exported so the formula can be audited.

Tightening **widens** the full-floor premium and **shrinks** the remnant
discount. Softening does the reverse.

| tightness | full-floor office | remnant office |
|-----------|-------------------|----------------|
| 0.55      | +0.040            | −0.088         |
| 0.85      | +0.065            | −0.068         |

`pnpm plan-desk` asserts this wire. Passing.

## Desk vs principal (same 102-suite book, 5 seeds × 10 years)

Three arms: leftover Phase-0 desk (90-cent first-letter), posted plan
(`playerEquivalentPlan`: quote 1.08, hold 18, step 0.02, floor 0.95),
and the patient principal bot.

|                    | desk     | plan      | principal | princ − plan |
|--------------------|----------|-----------|-----------|--------------|
| signed NE%         | 94.7%    | 104.7%    | 111.5%    | **+6.8**     |
| tight NE%          | 97.3%    | 109.2%    | 115.9%    | +6.8         |
| soft NE%           | 91.9%    | 104.2%    | 107.9%    | +3.8         |
| deals / seed       | 83.0     | 67.4      | 67.0      | −0.4         |
| vacant-months      | 2,964    | 3,022     | 3,080     | +58          |
| 10y NOI            | $75.37M  | $66.75M   | $70.21M   | +$3.47M      |

Phase 3 residual was +6.8. Phase 6 residual is +6.8. The leftover desk
still dumps first letters at 90 cents; the plan quotes 1.08 and holds
out. The bot still beats the posted number because it prices each letter
to indifference. That is residual (a) from Phase 3 — a posted number vs
an indifference function — not a desk with a private rule.

Hands-off-with-a-plan is **not strictly dominated**: deals match the bot
and vacant-months are slightly better. It is **not strictly dominant**:
the bot still wins signed NE and 10-year NOI. Fees (6% vs 4%) show up
in NOI, not in signed NE%.

**Do not tune.** Closing the 6.8 would mean either teaching the sheet to
price like the bot (that is a different product) or clipping the bot
(that is a fake number).

## Vacancy (8 × 60 years, months 60+)

`pnpm vacdist`. Same regime as Phase 1 after even-cut removal.

| kind        | median | p10   | p90    |
|-------------|--------|-------|--------|
| office      | 5.5%   | 2.7%  | 11.4%  |
| retail      | 5.8%   | 2.9%  | 13.2%  |
| multifamily | 3.6%   | 2.3%  | 6.0%   |
| industrial  | 2.5%   | 1.3%  | 5.5%   |

Office median 5.5% is the post-Phase-1 number (closet slivers no longer
count as tenants). It is not a Phase 6 movement.

## Demise / remnant (`pnpm demise`)

26 deals in 4.3 years to 81% occupancy. 0 whales. Identity holds
(leased + vacant = plate). Remnant vacant 5.3% of vacant sf. Passing.

## Report (`pnpm report`)

No **new** band from this overhaul. The two outside-band rows were already
REPORTED, NOT GATED before Phases 0–5.

| battery | inside band | outside | note |
|---------|-------------|---------|------|
| econ-accept A–E | 4 of 5 | **B** supply-shock rent 1.4% vs need ≥10% | vacancy did move +12.8pp; rent clause is the known glut-study gap |
| sim-accept F–I | 3 of 4 | **F** office −1.04%/yr, retail −1.41%/yr vs −1.0 floor | income-anchor floor; named in `ECONOMY.md` |
| city-accept J–M | 3 of 3 + identity | — | stock, age, cranes, map all hold |

City-accept (CITY_SEEDS=1, five market seeds in J–L): median building-count
+8.0%, age +39 years, delivered/demolished 2.04, 0 bad parcels.

## Stress (`pnpm stress`)

The existing strategy tournament holds leasing constant (`leaseAtMarket` in
`test/leasepolicy.mjs`). It compares acquisition and capital, not the desk.
The leasing-dominance question **is** `pnpm desk-vs-principal` above: the
posted plan is not strictly dominated by the principal bot and is not
strictly dominant either.

## Audit (`pnpm run audit`)

Experiments 1–6 (local demand, negative demand, glut, rate shock,
construction cost, population ±18%) all **WIRED**. No BACKWARDS on a
leasing wire. The block-premium term is separately gated in `pnpm plan-desk`
(tightening widens the full-floor premium).

Pre-existing, not a Phase 6 finding:

| experiment | verdict | why it is not this overhaul |
|------------|---------|-----------------------------|
| 7 housing → nearby retail | BACKWARDS | nearby retail rent falls on a housing add; local-over-far premium still yes |
| 7 office → street retail | WIRED | lunch-trade wire still fires |
| 8 contradiction scan | BROKEN | 8.67% of use-months show negative absorption with rising effective rent — a market.ts / rent-index question |
| 9 cycle coherence | WEAK | recession-month rent-fall 25.8% (need >50%); deliveries into peak/recession 12.2% (need >20%) |

Later experiments (dead knobs, narrative, 50-year stability) append when
the running battery finishes.

## What this overhaul did not do

- Multifamily demising.
- Glut / market-balance via leasing constants.
- Stacking-plan graphics.
- A broker marketing layer.
- Teaching the sheet to price like the bot.
