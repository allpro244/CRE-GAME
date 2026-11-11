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
| 1, step 2: the bank's overshoot once its credibility is gone (real rate ~+25, unemployment 29-34% after the peg). **Diagnosed 2026-11-06: output has no capacity ceiling.** `spendNation` books all spending as output (`d.Y = S + invInv − d.sup`). After a ten-year peg the output gap is +25% at 2.5% unemployment (US peacetime peak ~+6%, CBO 1966), and the bust to −18% is what the bank answers. Ruled out by measurement on the national block (20 seeds): dropping the restore premium (still +13% real, +14.7pt unemployment) and reading trailing 12-month inflation instead of the 11-month-lag smoothing (no change). Build: production is the lesser of demand and capacity; unserved demand goes to prices, imports and backlogs | open | — |
| 1b City Hall: foundation school aid, the buildings' own service cost, the budget sets the rate | done | #578 |
| 2.1 stabilise at natural occupancy, deduct the building's own lease-up | done | #579 |
| 2.5 the player's renewals bargain with an outside option | done | #583 |
| 2.6 tax per rentable foot; q and the yield on cost per gross foot | done | #585 |
| 2.7 the land survey prints the clearing (second-best) bid | done | #586 |
| 3.1 step 1: an idle builder no longer lowers its margin | done | #582 |
| 3.1 step 2: builders that hold underwrite a development spread over the cap | done | #587 |
| 3.4 forced sales, the July auction and the note desk price from named bidders; `distressPrice` deleted | done | #588 |
| 3.4 next: a distress buyer's own premium for as-is, all-cash, deadline risk. With #588, distressed comps clear at about appraisal (seed 11, p50 −1%) against the record's 10-30% | open | — |
| 3.5 note collateral is the appraiser's as-is value, not a capped line | done | #591 |
| 4.1 a tenant's willingness to pay scales with its own revenue | done | #584 |
| 4.4 part 1: a pipeline site goes to the builder that reads it best, not a coin (vacancy-after-starts lag −5 → +1, PASS) | done | #597 |
| 4.4 next: `BUILD_APPETITE` and crew capacity | open | — |
| Lenders: a failed firm's estate pays its creditors in order | done | #589 |
| Lenders: a bank's single-name limit is 15% of capital (12 CFR 32), the corporate line and construction loans included (peak yearly charge-off 11.1% → 0.6%) | done | #593 |
| Lenders: a desk closes on its regulator's rule (12 U.S.C. 1831o; NAIC RBC), not a monthly coin | done | #594 |
| 1, step 2, part 1: national output has a capacity ceiling (+6%, CBO 1966); ordinary cycles unchanged | done | #592 |
| 3.2 dry powder bends a fund's hurdle by its own fee as its investment period runs out | done | #598 |
| 4.6 part 1: the debt fund's construction advance reads the window and its own book, without floors (no measured effect: the floored quote never decided a loan) | done | #600 |
| 4.6 part 2: a builder takes the construction loan the desk will write | done | #606 |
| Crunch: a seller who can wait (fund extensions, non-core holds) waits in a dislocated market; deal volume under a crunch −6.5% → −22.2% (5 seeds) | done | #610 |
| Crunch: a lender extends only a loan whose building covers its coupon. With #610, all crunch rows right-signed on 5 seeds: deal volume −31.6%, charge-offs up, starts −22.9%, office −12.9% | done | #614 |
| Hotfix: the player's closing cost was NaN after #609 (circular import read at load) | done | #611 |
| 8: rail audit #1 (a constant written as a rail) and #16 (a dead coin) | done | #595, #596 |
| 8: rail audit #19, land capitulation runs to the builder's bid | done | #601 |
| 3.4 follow-up: courthouse bidders finance on the bridge desk; the courthouse room is the distress specialists (open room's runner-up below the worn mark, p50: −8% → +8%) | done | #602, #603 |
| 4.5 part 1: vacancy has no 45% ceiling | done | #604 |
| 8 next: `marketAppetite` (an index of the room, rail audit #15) and the take-private premium (#8) should be the named bidders themselves | open | — |
| Lenders lose money again: owners re-lever at their balloon (private owners #622, firms #627, the cash-out coin deleted). Charge-offs on a crunch book had read zero | done | #622, #627 |
| A rent on the screen always has a cause chain (the read's mark is written every month) | done | #618 |
| A start unwound in its month is not counted as a start (supply.ts `broke`) | done | #624 |
| Measurement: the median of an even count (#623); lag rows read a lag that is there, or none — stationary series, Fisher-z pooled CCF, Bartlett floor (#625); charge-offs graded as a share of the book in points (#626); three land smoke detectors (#628); distressed sales against ordinary ones (#631) | done | #623, #625, #626, #628, #631 |
| Recessions: the bank reading the gap through the economy's own Okun coefficient was refuted by its review and reverted. The cause is propagation (about 2× the VAR consensus) and the unemployment lag, not the gap's scale; a nation-only calibration is under way | reverted | #629, #630 |
| Builders underwrite today's rent, untrended; the market's rent belief is formed on real rent (land yearly swing 49.7% → 24.6%) | done | #633 |
| The nation propagates policy at a sourced strength: C_RATE 0.3 (Havranek 2015), unemployment speeds from Ball-Leigh-Loungani, two unexplained gains restored or de-duplicated, two bugs (recessions 1.95 → 0.96 a decade nation-only; just under the band — the impulse side, unsourced confidence shocks, is next) | done | #634 |
| Crunch: a sponsor's margin pays the equity the desks no longer fund (developerLook, the order book, firms, the last look, teardowns; the exit reads capExp): crunch starts −6.6% → −45% on three seeds, normal credit unchanged | done | #635 |
| Shock judge: e-commerce lands on the in-store share; the employer-leaves jobs row reads filled heads | done | #636 |
| A market study counts demand shrinking as well as growing (a zero floor that bound in every downturn) | done | #637 |
| A landlord screens on verifiable income (population-surge apartment vacancy +1.7 → +0.7pp, starts RIGHT; still BACKWARDS) | done | #638 |
| The zero-rate decade is a fall in r* (2 points, Holston-Laubach-Williams), held 10 years; the old peg is its own shock, "policy held under the rule", graded on FRED 1965-80 (both RIGHT on the rows that grade them; distress after release reads BACKWARDS, −17%: an engine finding) | done | #640 |
| A building lost to fire or storm is an insured loss and is rebuilt (replacement cost, the owner keeps deed and loan; median replacement about four years, Comerio & Blecher 2010): −20% office BACKWARDS → RIGHT; apartments rent +2.7% → +0.8% (the loss is now temporary; exposes item 11) | done | #641 |
| A full flats block still has a door: landlords price their exposure (vacant + on notice, RealPage practice): −20% apartments rent +0.8% → +5.3% RIGHT; +30% population vacancy +0.7 → +0.4pp (NO RESPONSE, no longer BACKWARDS); century flats vacancy 7.3% → 8.7% (inside Census 5-11%, wider cycle) | done | #643 |
| The land market's level is a Jevons index of the panel (geometric mean), not the mean dollar: real land yearly swing 25.5% → 16.8% | done | #645 |
| New firms start where the workers are: entrants' orders +0.50 a point of labour-force growth over the nation's (KPS 2024 1.19 × BDS 0.424): arrivals jobs years 3-8 +6.7% → +10.0%, century unchanged | done | #646 |
| Shock measurement: the street's mortgage book includes the private owners' notes (zero-rate leverage row +15.2% → +9.1%, now WRONG SIZE — honest) | done | #649 |
| A borrower with equity sells at its balloon: firms whose desk extension expired reach the sale rung; private owners list on a balloon default (crunch private foreclosures 2/0/0 → 0) | done | #650 |
| The REO sale trues up the charge-off (net of 3% selling costs; recovery capped at the loss): century peak charge-off 0.8% → 3.7% (FDIC 2-4%), bank failures 0 → 1.8 a century; crunch charge-offs RIGHT | done | #652 |
| A land-survey lot nobody bids on is censored, not dropped: a year with under half the lots bid prints nothing (Kaplan-Meier identification). Mechanism: panel probe 0.26 → 0.18; the century row cannot resolve it (8 seeds: 31.7% → 23.7%, a branch without it 23.1%) | done | #653 |
| Custom a local trade lost out of town returns at the re-tender pace: town output answers the national gap 0.11% → 0.86% per point, jobs 0.14% → 0.29% (probe); century rows unresolved | done | #654 |
| An arrival has no unemployment-insurance claim (a voluntary move disqualifies): arrivals' unemployment +10.6 → +9.6pp | done | #658 |
| No normal vacancy, steps 0-1: the dead norm state deleted; fallbacks read the opening state (bit-identical, 180 months) | done | #662 |
| A job opening takes about a month to fill (JOLTS hires/openings 1.107): month-end openings 0.4% → 3.6% of positions, town V/U 0.05 → 0.55; pay and local-trade capacity read against the nation's 3.13% openings | done | #663 |
| The nation's spending follows income at measured strengths (first-year MPC 0.5, accelerator 1, no unsourced profit squeeze): nation-only gap sd 1.52 → 1.97%, recessions 0.96 → 1.13 a decade; city job-loss years 0.93 → 1.30 | done | #664 |
| A cutting industry lays off even where it has openings (Davis-Faberman-Haltiwanger); town firms staff at the nation's speeds (Ball-Leigh-Loungani): local unemployment per point of gap −0.08 → −0.19 (probe), job growth 0.6 → 0.8%/yr | done | #665 |
| A trade short of hands turns away home and export orders pro rata (exports were served first): served share 0.91 → 0.97; century FAILs 4 → 2 (construction-follows-demand lag 4 → 2 years; land moves with property 0.23 → 0.44) | done | #666 |
| Corporate credit spreads widen in a slump (Baa-10Y = 2.16 + 0.24 x unemployment gap, FRED 1986-2019): nation-only gap sd 1.97 -> 2.17%, recessions 1.13 -> 1.24 a decade | done | #668 |
| No normal vacancy, steps 2 and 4: frictional vacancy from search (theta^-0.5); the leasing desk reads the signed package and seekers per vacant foot | done | #669 |
| The brokers' survey runs every quarter for every class: +300bp held office cap -0.2 -> +0.3pp, office values +0.6% -> -4.3%; cap-lag row 3 -> 1 year | done | #670 |
| Shops do not sign a lease at a loss (participation constraint): the year 28-44 retail-vacancy surge to 31-37% is gone (peaks 16-19%) | #671 | #671 |

### Corrections to the audit
- **3.3 loan spreads: mostly not a fake.** The playthrough's coupons 5.7 points over the index (p50) were the bot borrowing from a private-credit desk (Cordage Debt Partners), which in life does price 4-7 points over. The bank desks quoted about 2.5-3 points, high in the real range. Desk pricing is already built from funding, expected loss and running cost (`pricing.ts` `liveSpread`, `costFloor`). Lower priority; re-check against MBA/ACLI once caps are right.
- **3.2 `deployPressure`: narrower than it looked.** It applies only to a raised fund with an empty book, so its cheaper equity can pull caps down, not up. It is still a rail to replace with fee drag on uncalled commitments, but it does not explain caps running high.
- **4.3 demolition is not the valuation.** With 2.1's stabilisation in place, new office stock standing in years 3-8 of a +50% glut is still +31.8% (was +31.9%). The driver is the redevelopment bar (builders' margins, 3.1), not the appraisal.

## The battery on main, 2026-11-07, and what is known about each wrong verdict

The full battery (21 shocks × seeds 11/22/33) on main after #632: 3 BACKWARDS, 5 NO RESPONSE, 1 DID NOT LAND (down from about ten wrong-way shocks at #572). Each wrong row was diagnosed and adversarially verified (triage workflow; the scripts and numbers are in the session notes). Ranked root causes and their state:

1. **Rates near zero for 10 years: the injector.** Split in #640. `capital-rates-easy10y` keeps the peg under the rule (ten-year and CPI RIGHT against FRED 1965-80); `capital-rates-zero10y` lowers r* 2 points for 120 months (8 of 9 rows RIGHT). Left: distressed listings in years 10-15, after the release, FALL 17% against the control where the record (2022-24) has them rise: loans written at the top are not stressed by normalisation. Open (engine).
2. **+30% population (BACKWARDS): the landlord's screen read a jobless earner's lost wage.** #638 (vacancy +1.7 → +0.7pp). The rest: item 11.
3. **−20% stock lost: no insurance claim.** The injector confiscated owners' buildings. A claim path (branch `claude/casualty-claims`: pays replacement cost, mortgagee first) fixes office and industrial starts but turns apartments starts BACKWARDS (−44%): owners keep cash and an empty lot. A replacement-cost policy pays full replacement only when the owner rebuilds (otherwise actual cash value), and owners mostly rebuild; the claim must start the rebuild. Open. — **Done in #641:** the claim funds the rebuild, staggered over the adjuster/permit wait. Office RIGHT, industrial RIGHT; retail still NO RESPONSE (item 6); apartments rent now NO RESPONSE (+0.8%) because a known-temporary loss leans on the flats landlord's weak rent response (item 11).
4. **Rates +300bp held (NO RESPONSE on caps): the bond market prices any deviation from the rule as gone in 4-6 meetings.** But the published persistence of rule residuals is ρ = 0.62-0.67 a quarter (English, Nelson & Sack 2003, Table 3, 1987-2000; 0.84 with 2001), which adds only about 0.15pp to the ten-year for a held +3. A held three-point deviation for years is a regime, learned by the endpoint (Kozicki-Tinsley gain); the band (2022) describes a hike the rule wanted. Treat as a judge item like 1, not an engine fault to tune. Open.
5. **Arrivals are absorbed by leaving, not hiring** (unemployment +12-14pp at year 5). Diagnosed 2026-11-07 (twin probes, seed 22; scratchpad `agent5/`):
   - **Jobs are demand-fixed.** Each industry hires toward IO output over output per worker (`economy.ts impliedHeads`); nothing reads labour supply. The export base is 63% of output and the type II multiplier is 1.70 (Moretti 2010: 1.6). Arrivals land jobless and spend out of UI and savings, so household spending *fell* 0.3-6.4% while persons rose 26%. Hiring absorbed 14-26% of the new labour force; 87-106% of the rest left. Wages are not the bottleneck: posted pay is nominally rigid (floor binds for 95% of heads), but an 8% real cut bought only +5% jobs.
   - **Confirmation:** growing the export base with the population brought jobs to +25% and unemployment to the control's within three years.
   - **Done (entry PR):** new firms start where the workers are — entrants' share of orders rises 0.50 a point of labour-force growth over the nation's (Karahan, Pugsley & Sahin 2024: startup rate +1.19 per point; BDS 2010-19 births' job creation 0.424 of their entry rate). Jobs years 3-8 +6.7% → +10.0%; unemployment +11.2 → +10.6pp (band ≤ +6); century unchanged.
   - **Open:** (a) every in-migrant lands with all earners jobless (`households.ts` arrivals `fillPeople(..., 1)`), though most US work-related moves are for a job already found (CPS ASEC reasons for moving: "new job or job transfer"); (b) arrivals draw a fake 1-10-month UI spell, so ~60% collect UI on wages never earned in town (UI +$5.5M a month at m24), against state law (a voluntary quit to relocate disqualifies; immigrants have no claim base). Fix (a) and (b) together, with a source for the job-in-hand share; (b) alone cuts the arrivals' spending.
6. **Street retail clears by waiting and leaving, not by price** (willingness to pay never binds in `shop()`/`signAt`); behind −20% retail and e-commerce rent/vacancy NO RESPONSE and the century's weak retail rent-vacancy correlation. Open.
7. **The foreign capital wave's money is no cheaper than core money** (cap NO RESPONSE): price the wave funds' debt off a home-market rate, sourced. Open.
8. **Lost export orders come back**: a re-tender gives the town its opening share whatever it holds (65% back in 36 months, against Gathmann et al.'s persistent losses). Fixing it may expose a gap between named-firm closures and BDS entry/exit; check the century drift first. Open.
9. A scheme decided on free cash is tested at groundbreak on a different funding rule. Open.
10. **The region's home price has no rent channel** (user-cost arbitrage, Poterba 1984; Himmelberg-Mayer-Sinai 2005). Open.
11. **A demand surge adds no occupied flats**: the flats landlord's expected wait at its chosen ask lengthens with demand, so a surge becomes rent. Investigate. Open. #643 fixed the frozen full-block ask; the surge's vacancy still does not fall (+0.4pp), so the remaining cause is on the arrivals' side (item 5: arrivals leave rather than rent).


## The battery on main after #646 (2026-11-07, afternoon)

22 shocks × seeds 11/22/33: **1 BACKWARDS** (zero-rate decade: distress after release, −27%), **1 DID NOT LAND** (largest employer leaves: seed 22 reads −0.50 jobs per direct job at +2 months against the gate's ≤ −0.5, seed 11 −0.62 — the gate's edge, not a broken injection), **8 NO RESPONSE** (rates +300bp caps and values; crunch charge-offs and distress; foreign wave caps; arrivals' flats vacancy; e-commerce shop vacancy and rent; −20% office rent at +1.6%, against +3.3% in #641's run; −20% retail), **3 WRONG SIZE** (construction +40% land −4.9%; +50% retail and apartments vacancy +9.5pp against ≥ +10), **1 SPILLS** (the placebo's noise floor). Down from 3 BACKWARDS / 5 NO RESPONSE / 1 DNL in the morning's battery, with the NO RESPONSE rows now concentrated in two themes: rents that do not answer vacancy (office, retail: see the office section) and capital pricing (cap rates, charge-offs).

## Why a credit crunch charges off nothing (2026-11-07, diagnosed)

A loan-by-loan probe over the crunch's 36 months (scratchpad `agent-crunch/`, seeds 11/22/33):

- **The crunch reaches the balloon** (private owners shop the halved product sheets, `streetLoans.ts deskQuotes`; firms refinance through `streetRefiProceeds`): the median takeout ÷ balance falls from about 2.0 to about 0.9, and 110-128 private maturities a seed find no full takeout (control 1-9).
- **The gaps are small, so cash closes them.** Maturing loans carry a median LTV of 0.33-0.37 (90th percentile 0.56-0.80); owners pay 73-88 gaps a seed ($5-12M), firms 83-116 (seed 22 $27.6M), and desks extend 33-36 private and 19-42 rival loans. No cash source is unlimited (owners' cash is capped at months of income). Plausible for this book: family and estate holders (advances 0.40-0.45) pay down and do not re-lever.
- **The few defaults fall on buildings with equity** (private balloon defaults at LTV 0.21-0.75) and the loss is booked as balance − `reoAsk(mark, balance)`, which is zero while the mark covers the loan; the bank-owned sale then clears at 0.88× the ask with no true-up and no liquidation cost.
- **The battery's 1-3% band is a GFC figure** (a 2005-07 vintage at about 70% LTV, a 35-40% value fall, and falling income), not a credit-only crunch on a seasoned book.

Open, in order: (1) [done with the balloon PR: a private owner with equity lists at its balloon default and the sale pays the note] foreclosure surplus to the borrower when the court does sell; (2) a foreclosure's loss is the balance plus accrued interest, carry and liquidation costs less the REO sale's actual net (Trepp CMBS loss severities on liquidated loans, about 40-60% in 2010-12, with the cost split), reserved at default and trued up at the sale; (3) source the crunch's charge-off band to the shock it injects (a credit-only freeze — e.g. 1998's CMBS seizure, when losses stayed low — against the GFC's combined shock), or add the combined shock. Done: firms whose desk extension expired went straight to the hand-back, skipping the sale rung (`ext === undefined` read the desk's extension as "already listed"), and private owners had no sale step at all (the balloon PR: private foreclosures on equity buildings in the crunch 2/0/0 → 0); the measurement's book omitted the private owners' notes (#649).

## The battery on main after #659 (2026-11-07, evening)

22 shocks × seeds 11/22/33: 1 BACKWARDS (+30% population: apartment vacancy +0.7pp, the flats demand item), 1 DID NOT LAND (the employer gate's edge), 6 NO RESPONSE, 4 WRONG SIZE, 9 RIGHT, 1 SPILLS (the placebo). Against the afternoon's: zero-rate decade BACKWARDS → NO RESPONSE, credit crunch NO RESPONSE → WRONG SIZE (charge-offs RIGHT, #652), −20% office NO RESPONSE → RIGHT; insurance ×2 RIGHT → WRONG SIZE (apartment starts −64%, now consistent across seeds), construction +40% WRONG SIZE → NO RESPONSE on land. The last was bisected (#650, #652, #654, main, main without #653): land in years 3-8 reads −18%, −2%, −7%, +2%, +2% with per-seed values from −33% to +33% — seed 11 falls 20-33% in every build — so the cost-to-land wire works and the row is the land index's own volatility (20-30% a year) through chaotically diverging twins, not a regression.

## Measurement: what a 3-seed century can and cannot see (2026-11-07)

Runs that differ in code the land and labour rows do not depend on diverge chaotically from the same seeds. Across seven 3-seed runs of essentially the same land mechanism the "Real land, yearly swing" median read 16.8-37.4%, and "City job-loss years per decade" 0.37-1.30; pooled over 8 seeds the per-seed spread is still 10-44% and 0-2.2. These rows cannot grade a change at 3 seeds, or reliably at 8. A change aimed at them needs a mechanism probe (the panel, survey and cycle probes in the scratchpad's `agent-*` folders) and should not claim a century move it cannot resolve.

## Land volatility and town recessions: what the 2026-11-07 diagnoses found

**Land** (panel probe, seed 11, 42 Januaries; scratchpad `agent-land/`). Of the panel index's yearly variance, 57% was lots priced at the texture floor (their Δlog is the town-wide `landIdx`), 23% lots whose winning bid type flipped (late years), 21% lots that stayed builder-priced (real leverage: the residual moves sd 0.195 a year on a 0.05-0.06 property move, land 16-35% of value). The texture part came from the July survey printing only the lots that drew a bid; #653 fixed it. Left: (0) **flats' forward vacancy reads 0% almost always** (seed 11, 16 years quarterly: actual 5-8% against a normal of 4.5%), because the flats' queue in `structTight` is `flatSpace.seek` — every household across the water that would want an island flat at the average rent, the whole stock of interest, though each searches once a year and only at blocks within budget. Every market study therefore underwrites flats as delivering full with no concessions (underwritten effective rent 0-20% over the market, the ratio flipping with current vacancy). Measured terms (seed 11, years 0-6): `structTight` 17-28% of stock, the demand-trend term `classDrvTrend × 18` 4-13% (population grows about 0.7% a year), against vacancy 5-8%. Counting instead the households turned away (a block on their list they could pay for, no flat free) gave a queue even larger (0.8-1.05M sf a year against a stock of about 3M, `seek` 0.4-0.8M): households are turned away at cheap blocks while dearer blocks stand empty — a price and quality mismatch — so no queue that coexists with vacancy can be subtracted from it as if it would fill it (`claude/flats-queue-turned-away`, not shipped). Tried: forwardVacancy for flats without the queue (`claude/flats-forward-vacancy`, not shipped): flats' forward vacancy reads 1-6% instead of 0% and the underwriting ratio falls to 1.00-1.06, but the inflated forecast had been propping up flats construction — century starts 0.9 → 0.6% of stock a year, the starts-to-vacancy lag 2 → 5 years (FAIL), and the +50% flats glut's late vacancy +2.8pp (RIGHT) → −0.7pp (BACKWARDS), while the −20% loss's rent improved (+3.4% → +6.8%). Next: the same change with a demand trend at the rent a new building needs — not `islandWant` (latent interest at the average rent, which overshoots) and not island renters (capped by the flats that exist, so a shortage would read as no demand and persist) — measured together. (a) the builder's best use flips with the queue — office's queue is always empty while retail's is 400-850k sf against 3-9k sf a year of absorption; (b) the multifamily underwriting rent alternates 11.7/14.9/11.7/14.6 real against an effective rent of about 10, a forward-vacancy concession ratio of 1.2-1.45 in `underwritingEcon`.

**Town recessions** (yearly rows and a monthly probe; scratchpad `agent-cycle/`). The nation has about 0.6× the record's recessions (0.83-1.0 a decade against 1.6 postwar; short), driven by sourced policy and supply shocks, counted swans, and confidence/rest-of-world shocks whose sizes are unsourced. The bigger fault is the town: exports pass a national downturn on (export heads 1.30% per point of gap; implied heads 0.96%), but filled heads moved 0.20% and town unemployment 0.07 points per point of gap (Okun about 0.8), so only 4 of 17 national recessions made a town job-loss year. Two stabilisers: (1) local trades sit about 8% short-handed and the share of their orders bought in town was re-struck each month on the staff they had, so laid-off exporters filling those openings brought leaked orders straight back (firms' purchases +0.65% of output per point the gap fell); (2) the same standing shortfall is a job sink — local trades staff toward orders, not sales, and household spending is buffered, so their openings absorb exporters' layoffs. #654 returns lost custom only at the re-tender pace: it took town output from 0.11% to 0.86% per point of gap but filled heads only from 0.20% to 0.32% — the job sink remains — and lowered the mean served share 0.92 → 0.87 (cuts at once, regains slowly). A further diagnosis (HP-filtered cycles, seed 11, 30 years; scratchpad `agent-sink/`) corrected the picture: measured at the right lag, filled heads follow labour demand (0.43% vs 0.50% per point of gap, demand itself only half the implied 0.89%, nine months late), and **local unemployment stays flat because the labour force absorbs two-thirds of the job change** — the town's labour supply is a residual of its labour demand: interstate movers (`MOVE_M`) arrive only into openings and their unused flow is thrown away, so a national downturn stops in-migration instead of raising joblessness (Blanchard & Katz 1992; Dao, Furceri & Loungani 2017: migration answers *relative* conditions and absorbs ½, now ¼, of a *local* shock in year one). The 'standing shortfall' is not standing: local openings ran 3.8-8.2% in years 1-12 (restaurants 20-42%, a bottom-rung matching gap) and 0.5-0.8% after year 15 (JOLTS leisure 5-6%, retail ~4%); town θ = V/U averages 0.23 against ~0.9-1.2 (JOLTS 2015-19). Spending is not the cause (household local purchases move 1.2% per point, households buy ~12% of local output), though its shape is wrong (no drop at job loss, no cliff at UI exhaustion; total −30% by month 12 against Ganong & Noel's ~−6% then ~−12% more).

Tried, not shipped: (1) **splitting the movers** — 30% with a job in hand into openings (CPS: intercounty "new job or transfer" 21.5-24.6% in P23-204 Table 2, 23.4% in CPS ASEC 2019; by distance, employment-related 17.7% under 50 miles to 47.6% over 500), the rest arriving every month as job seekers, with a balancing non-job out-flow (`worktree-agent-a24b1ba8f9ba5745e`). It balanced (jobs and population +0.6%/yr) and the labour force's response fell to 0.12% a point, but the town's growth had come from job movers arriving at the cap: net arrivals fell from ~55 to 10-20 households a month, openings settled at 4-9% of heads (matching `thetaRef` adapts; `V_SLOPE` pay push is cancelled by the wage curve's slack term), and those openings became a bigger job sink (local unemployment −0.06 a point; century retail vacancy 25% FAIL, job-loss years 0.37). (2) **Walk-in custom returning at once** with only contract buyers at the re-tender pace: per-industry sales cannot separate firms' purchases from households', so it returned most of the recapture (town output 0.27% a point). (3) **Job movers drawn by the town's openings relative to the nation's** (JOLTS total nonfarm openings rate, 2001-2019 mean 3.13%, FRED JTSJOR; on top of (1), commit `fd781ca5`, not shipped): openings held at ~4.6% of heads, the labour force swung with the cycle again (0.27% a point) and local unemployment stopped answering the gap (−0.01); retail vacancy recovered (25% → 9.9%) and growth balanced. It cannot work as specified: the engine's 'openings' are heads still unfilled after the month's matching — about 0.5% of heads in a balanced town, not JOLTS's 3.1% of positions open at month-end — so a balanced town read as 0.16 of the nation. Underneath: the engine fills a vacancy within weeks, where JOLTS's openings over hires (3.1% against ~3.8% a month) imply about a month. Next: the matching rate against JOLTS vacancy duration first (`thetaRef`, the matching function), then job movers by relative openings on a like-for-like measure; the spending shape at job loss; named shops' labour demand (the √ rule, streetRolls.ts) not tied to orders; and sourcing the confidence-shock sizes.

## The town and the national cycle after #663-#666 (2026-11-07, night)

Walk probe (scratchpad `walk-probe/probe2.mjs` + `dec2.py`; 12-month changes on 12-month changes of the national gap, seeds 11/22/33, 30 years), main after #666: local unemployment −0.12/−0.21/−0.15 points per point of gap (national Okun about −0.5; −0.08 before #665); staffed heads 0.19-0.64% a point; `econ.jobs` −0.23..+0.18% a point. What is left (diagnosis in scratchpad `agent-town/`):

- **Boom hiring is limited by an arrival rate that does not answer the cycle**, and labour-force participation does not move with it either. Arrivals win leftover openings whenever national unemployment is above the town's.
- **Job movers drawn by the town's openings relative to the nation's, on the now like-for-like openings measure** (branch `claude/movers-follow-openings`: 30% of movers with a job in hand, the rest non-job movers both ways, job movers scaled by openRate / 3.13%) did not help: local unemployment −0.10 a point (main then −0.08), jobs about 0. Not shipped.
- `SEP_RATE` is 1.4% a month labelled as BLS CPS flows 2015-19; the CPS E→U flow is about 1.0-1.1% of employment a month. Correcting it moves the unemployment level (u ≈ s/(s+f)), so it needs its own measured PR.
- The national cycle still reverses too fast: a confidence shock turns negative in about quarter 6 (Smets-Wouters: never), two-year gap autocorrelation 0.02 against the US +0.26. Next to source: the investment speeds `TAU_K` and `I_LAG` (tuned), and a countercyclical credit spread (Gilchrist-Zakrajšek 2012; corporate spreads are constant at shortRate + 2%). Investment sd / output sd is 4.5 against about 3.
- `test/demand-finite`'s "+12% office stock conjures 95% of itself as new occupants": the off-map stock was imputed let at the on-map occupancy. Fixed on `claude/offmap-occupancy` (off-map tenants' own book, `econ.offMap`): 6.7%, budget ≤15%.
- **The stock ledger drifted from the map** (found with the off-map book; fixed on `claude/offmap-occupancy`): demolitions, teardowns, a rival's redevelopment and fires took a mixed building's whole rentable area off its filing class, while the map, deliveries and restorations count each use. `retireStock` (market.ts) books each leg off its own class. Ledger over the map's rentable feet at year 15, seed 11: shops +3.03% → +0.07%, offices +1.08% → +0.20%, flats −3.11% → 0.00%.

**The boom's openings go unfilled (2026-11-09, branch `claude/fill-openings-boom`).** Walk probe on main 64d82eb9 (seeds 11/22/33, 30 years, 12-month changes per point of the national gap; `probe3.mjs`/`dec3.py`/`dec4.py` in scratchpad `walk-probe/`): heads +0.69/+0.65/+0.40%, employed +0.38/+0.48/+0.18%, labour force flat (+0.01/+0.01/−0.08), local unemployment −0.35/−0.44/−0.24 points against the nation's −0.7. Ruled out by measurement: (1) the fill budget (Q_FILL) does not ration the jobless — their realised finding rate equals the matching function's (0.27 against 0.27; jobless who drew a hire and found no opening: 0.4% of them); it binds on arrivals only. A JOLTS-elastic q would cut fills in a boom (hires/openings on V/U, 2001-19: −0.31, r −0.81), the wrong way. (2) `thetaRef` does not cancel the boom (−0.3% a point against θ's +8-12%). What is wrong: θ = V/U moved 8-12% a point where the record's moves ~20% (JTSJOL/UNEMPLOY ~30% per point of unemployment), because θ counted the openings as the month's search begins, which still hold every opening the month will fill; MATCH_ETA and SEP_ETA were estimated on JOLTS's month-end stock, which in the engine moves 8.1%/5.7% a point against 6.1%/4.6% for the stock at the search (fills out of unemployment are f·U, not a share of the openings). Shipped: θ reads last month's month-end openings (`vacLeft`); a saved register's `thetaRef` is carried over once by the ratio of the two counts. Probe: local unemployment −0.44/−0.47/−0.27; slope on the nation's rate 0.52/0.67/0.43 → 0.64/0.74/0.48; share of a heads change filled 0.76/0.82/0.81 → 0.83/0.83/0.93; unemployment level 6.5-6.8% → 6.3-6.5%. Century (3 seeds × 60 years): PASS 32 · WATCH 14 · FAIL 2 → PASS 30 · WATCH 18 · FAIL 0; job-loss years 1.11 → 1.67 a decade; century unemployment 6.8% → 6.6%. Still short: employed per point of gap stays 0.27-0.45% because the town's heads move only 0.35-0.65% a point (the nation's employment rate 0.70-0.76%) — labour demand, not matching. The CPS participation margin (N→U on V/U −0.38, U→N +0.14, N→E/E +0.10, E→N/E +0.08; Elsby, Hobijn & Şahin 2015) is absent from the register and would move u more but the labour force the wrong way unless all four flows come together.

## Where the night of 2026-11-07 left off (open, in order)

1. **No normal vacancy, steps 5-9.** Step 5 (lease-up from actual absorption; flats demand at the rent a new building needs) is unverified WIP on `claude/no-normal-vacancy-step5-wip` (two copies of the step agent edited one worktree; its measurements before that: flats starts 1.35/0.72/0.82% of stock, office vacancy 15.0%, retail 12.3%, sheds 13.8%, partly an opening-rent shift from devPencils it then removed). Steps 6 (builders' glut gate), 7 (appraisal reads observed vacancy), 8 (demolition valves), 9a (commercial landlords price on their own tours: the office Wheaton-Torto slope, −0.22 against −2 to −3) are designed in the chain script (`remove-normal-vacancy` workflow). Steps 5-8 shipped (#669-#678); 9b shipped 2026-11-08 (branch `claude/no-normal-vacancy-9b`): the learned norm (`normalVac`, `Econ.natVac`, `NATVAC_RATE`), `concessionTarget`, the unreachable no-street rent equation and `rentPath.gap` are deleted; the town opens at no package; the UI verdict reads the package, availability's twelve-month move and months of supply. The one norm left is the commercial ask ladder's patience seed `MONTHS_ON_MARKET` (tenantMarket.ts), which Step 9a replaces.
2. **The participation constraint for offices and sheds** (#671 binds on shops only): applied to all classes it took office vacancy to 4-5% and doubled firm turnover — audit offices' and sheds' value-of-space terms (`value` in streetRolls.ts) first.
3. **Firm turnover 13.5% a year after #671** (BDS 8-10%): shop formation now runs every year; check the formation pace and the shortfall it releases (streetRolls.ts ~1017, ~1114), and make the shop industries' employment follow the shops that exist (`islandFill` 18-40% on main).
4. **Construction cost to land** (a separate session, branch `claude/cost-moves-land`): +40% cost moved land −1.6% (record: falls 5-80%).
5. **The ten-year under a held off-rule policy** moves +0.6pp against +1 to +2.5 in the record; no engine code holds a rate off its rule, so this is a harness question, not an engine one.
6. **Investment volatility** 4.9x output (record ~3): source `TAU_K` and `I_LAG`.

## THE FIX PLAN (owner-approved 2026-11-11) — work it in this order

The scoreboard is `pnpm mechanism` (coins, draws, unsourced constants, ledger rows); every PR lowers it or says why not, and passes conserve. The outputs need not match US history (CLAUDE.md, "THE GOAL IS SIMULATION, NOT HISTORY"). Helpers may run two at a time on disjoint files.

**Phase 1 — brakes, so the economy can absorb a shock (first: every later change lands safer on a stable base).** Small changes this session set off fire-sale cascades (a dip → forced sales → falling marks → smaller credit lines → more forced sellers). Real markets have brakes the engine lacks:
- lenders choose between foreclosing and extending/modifying a loan on their own recovery numbers ("extend and pretend", 2009-12);
- owners who are not in default hold through a slump rather than being pushed to sell;
- value buyers step in when prices fall far below replacement cost;
- credit lines sized on lagged appraisals, so one bad quarter does not call everyone's lines.

**Phase 2 — how prices are set.**
- Tax assessments: fractional by statute and reassessed on a cycle (sourced), so the bill lags and sits below sale prices; reconcile the property-tax rate against them.
- Appraisals smoothed and lagged against sale prices (Geltner): below prices in a rising market, above in a falling one.
- Land priced as the development option (McDonald & Siegel; Williams 1991), replacing WAIT_DISCOUNT / PEAK_RENT_MULT.
- Buyers' required returns by investor type from sourced investor surveys, replacing the hand-set EQUITY_PREMIUM table.

**Phase 3 — market structure.** Owners decide when to sell (replacing the listings quota in `sim.ts refreshListings`); the player's buildings lease from the street's tenant shortlists; tenant turnover and renewals; then the office rent response; which class rents highest becomes an outcome.

**Phase 4 — agents for the six top-down aggregates** (FORMULA_LEDGER #28-33): house prices from builders and buyers, migration from household choice, online retail share, the city's mood, rents outside the map, industry orders.

  - #28 tried 2026-11-11 (not shipped): winning the re-tender in proportion to heads now / heads at opening (economy.ts tenderOrders) is a unit root with positive feedback — seed 11 at year 25: jobs 87k vs 61k, flat rent 40.8 vs 21.3. It needs the restoring force first: establishments entering and leaving on their own costs (wages, rents) against the nation's.

  - Tried 2026-11-11 (not shipped): street seekers touring after a fixed SEARCH_M-month search instead of a 1/SEARCH_M monthly die (streetRolls.ts). Conserve seed 22: the bot never signed a lease in 240 months — the player's desk draws its prospects from seekers early in their search, and a fixed clock let the street sign them all first. Needs the player's buildings on the same tour book (Phase 3) before the die can go.

**Phase 5 — neighbourhood demand.** Density effects at the measured elasticity (rent 0.21, wages 0.04: Ahlfeldt & Pietrostefani 2019, Table 5); congestion (speed −0.11) and construction cost (+0.055) in dense areas; vacant and decaying buildings drag nearby demand; delete the hidden random drift of town centres (`POLE_DRIFT_SD`, `POLE_NOISE_SD` in demand.ts — a design dial).

**Phase 6 (alongside) — sources.** The remaining ~390 unsourced constants, file by file, with a research helper; reconcile the `[S≠]` disagreements (office opex $4.17 vs the file's own BOMA cite ~$8.90; property tax; developer margin, soft costs, contingency; base cap rates).

**Phase 7 (alongside) — measurement.** Six seeds the standard for any change that moves the economy; flags for impossible outcomes; conserve's bot surviving (a bot that goes broke in four years is a symptom to explain, not noise).

## HANDOFF (2026-11-11, end of the fix-plan run) — START HERE

**Scoreboard** (`pnpm mechanism`): coins 91 → 64, unsourced 372 → 292, ledger rows 6 → 5 (draws ~261). Merged to main: #721, #722, #723 (UI). **Open: #724** on `claude/office-space-answers-rent-n5xdqf` — check its CI and merge it first.

**Done this run** (details in the PRs):
- Phase 1 brakes: lender forbearance (modify/wait/file on its own numbers), LOC on annual reviewed values, covenant LTV on the lender's annual Geltner-smoothed appraisal (`debt.ts lenderValue`, α 0.4).
- Phase 2 prices: 5-year revaluation at 70% assessment (Connecticut rulebook, sourced 1.809% rate); land as the development option (`value.ts landOption`, σ/drift measured yearly off the tape: `market.ts measurePropertyVol`, r = long rate, V*/K ≈ 1.2-1.3).
- Phase 3: owners' annual hold/sell review replaces the listing quota (`sim.ts refreshListings`); vacant-lot owners review yearly; the player's tours accrue from capture (`leasing.ts tourAcc`) instead of a die.
- Phase 4: ledger #32 closed (absorption reads measured availability).
- Phase 5: density elasticity 0.21; pole drift deleted. Blight is already carried by occupied-stock demand.
- **Banks (owner: "simulated and compete, nothing hard coded")**: senior income desks now solve their own advance (`debt.ts deskAdvance`): the LTV where the balloon's expected loss (Merton/lognormal, town σ credibility-blended with a 10% national prior, drift capped at expected inflation, recovery 0.85) meets PRIOR_EL × the desk's appetite. Standards read the credit index against its own 10-year mean (`econ.creditIdxMean`).
- ~30 coins removed by helpers (rivals' calls, mergers, founders' exits, package sales, developer/homebuilder schedules), ~80 constants sourced, two [S≠] reconciled (foreclosure 20 months, entitlement mean 17).

**Next, in order:**
1. **Banks, the rest of the sheet.** *Spreads done (2026-11-11, branch claude/intelligent-newton-01ljmq):* no `spread` on any product; every desk's spread is `pricing.ts liveSpread` = funding (matched-maturity FTP: one funding spread against whichever benchmark the loan is written on) + the loan's own expected loss (`debt.ts loanEl`: the balloon model at the loan's advance, term and amortised balloon balance, × the desk's own loss experience; mezz takes the slice between senior and stack top) + opex + capital (hurdle over the money the equity replaces, RAROC) + rationing + a competitive margin (`lenders.ts priceDesks`: `chase` is now a margin over the desk's own cost, compared on spreads, floored at 0). Desks publish prices at newGame (`sim.ts`). The revolver and rival lines price on the junior class. Measured seed 22: senior bank spreads ~2.5-3.0 over the 10-yr (were 1.4-1.9 off the card), life/agency desks harvest ~2 pts margin to sit near the banks, construction ~+1.5 pts (still over the LONG index — construction is floating paper; moving it to the short index is a candidate fix), mezz 3-7 over. ltvdist median advance 0.62 → 0.60. *Advances done (next PR):* every product solves its own advance (`debt.ts deskAdvance`, on PRIOR_EL of its loss class × appetite) — land on the town's land index (`landRiskView`, national prior 20%), bridge on the fund's junior budget, mezz as the stack top whose slice loses the budget; `ADVANCE_BAND`/`CLASS_ADVANCE` deleted, `advanceFactor` no longer multiplies a solved advance. The loss model (`lossOver`) now has single-asset volatility (index vol + 11% idiosyncratic, Titman & Torous ~15% total), term default as a Black-Cox first passage to the double-trigger barrier L × min(1, k/y) (so rates against cap rates move the advance), and amortisation (balance left at the balloon). Without the first two, senior advances sat on the covenant rail (maxLTV − 0.03) in calm years — on main too. ltvdist 2×20y: banks p50 0.54 of basis, Cordage 0.63 (best advance on 98% of listings — bridge reaches further on a 4× budget), Alden barely quotes (most listings × 0.5 fall under its $2.5M minimum), creditIdx p50 0.87 → 0.79. *Coverage done (third PR):* `uwDscr` is gone from every product. `sizeRest` sizes on the desk's own loss model at THIS building's yield and the underwriting coupon (`deskAdvance(..., {yieldPct, ratePct})`), capped at coverage 1.0 for permanent paper (repayment capacity, 12 CFR 34 Subpart D App. A; bridge exempt); the coverage a loan closes at is reported as `Quote.uwDscr`, an outcome. `onIncome(p)` replaces the `uwDscr > 0` flag. Coverage now binds on ~18% of First Harbor quotes (was 4%). Newgame publishes cost-only prices (`publishOpeningPrices`). Measured: Alden Savings barely lends (advances ~0.5 put most listings under its $2.5M minimum; its opening book runs off, it pays out the excess capital, and its appetite hits 0 in some later years) — an outcome, worth watching. *Still hard-coded:* `minDSCR` (the ongoing covenant), the `debtYield` floors, the products' `ltv` column (read only by text: actions.ts noLoan/287, DebtPage 792, debt.ts strongName, 2575), `maxLTV`, `termM`, `amortYears`, `ioM`, `RECOVERY` [K], construction desks' `spread` (now only a guard when an econ carries no desk prices), `LOC_SPREAD` (interest estimates). Same method as `deskAdvance`: coverage from the desk's view of income volatility (term default, not just balloon), keep only statutory ceilings (12 CFR 34 App. A supervisory LTV limits) as caps. Check with `SEEDS=11,22 YEARS=20 node test/ltvdist.mjs` (recession rows came out identical before and after the advance change, so check whether the solver ever runs in a recession).
2. **DONE (2026-11-11): the player's buildings on the street's tour book.** `streetRolls.ts shop` shows the player's vacant legs to every looking firm by the same weighting rule; a firm whose best option is a player building tours it (`e.playerTours`, consumed by `leasing.ts` the same month, party = every firm that chose it). Deleted: `absorption.ts` leasingOdds and the whole aggregate requirement law, the tour accumulator, the address-ceiling coin, the theta party size, `pullSeekerIn`. The UI shows tours drawn and firms looking instead of odds. Without a player the town is byte-identical to main; leaseup (2 seeds × 10 yr, every LOI signed): median 31 → 8 months to 85%, offices still empty 1 → 0. The street's search die is gone too: a looking firm signs once its search has run SEARCH_M months (seed 11 industrial vacancy 13.8% → 6.6%: under the die some sheds' searches outran their patience and they left town; leaseup median 13 months). Was: `leasing.ts` still runs its own arrival law (`absorption.ts leasingOdds`); street seekers shop only street buildings (`streetRolls.ts shop`). Putting holdings in `shop()` would remove two coins in streetRolls (search die, tried and reverted: the player then got no tenants) and the separate formula.
3. **Ledger #28** (industry orders): a unit root without a restoring force; establishments must enter/leave on their own costs first (note above). **#29** house prices from sales, **#30** mainland rent, **#31** online share (`ONLINE_MAX` set by playthrough), **#33** migration choice.
4. **DONE (2026-11-11): renewals at a loss.** An office or shop leaves town at lease end only when nothing pays, its own suite included; a firm that has outgrown its suite goes to market; a sitting tenant keeps the taste it signed on (`Tenant.tasteU`, persistent match quality). Sheds keep their regional-move die (SHED_MOVE). Findings on the way: main has no missing restoring force (office landlords converge on the sourced 24 months to let, ~11% vacancy, over decades); the earlier drift came from an outgrown-firm bug in the experiment and the taste redrawn at renewal. Shops that now close at lease end are worth ~0.6 of market rent to themselves against a landlord walk-away of ~0.87 — real small-shop churn. Office renewals are 62-72% of leasing volume (CBRE top-100 leases 2023: 58%; main 54-70%), so office TASTE stays on its months-of-supply fact. Six seeds × 20 years against main: office vacancy lower on every seed (by 0.9-2.5 pts), retail +0.1-1.4 pts, real rents unchanged; conserve 22 and 55 balanced for 240 quarters.
5. **DONE (2026-11-11): industrial decay.** Sheds formed only as movers from the off-map region, so a town with a thin region never housed its own growth (Frontier towns: industrial employment +14-23% over 50 years, shed firms −35%, vacancy 12-29%, real rent falling). Now sheds form from the town's own trades' gap like every class (entry on `entrantMargin`, its ×1.6 ceiling removed); the region's movers no longer also replace map closures; a relocating shed (SHED_MOVE, still unsourced) leaves the map as a flow in proportion to the region's empty floor (`e.shedOffAcc`), otherwise looks on the map; a shed not on the move leaves only when nothing pays; only tenants that relocated become off-map demand (`streetFailed.reloc`). Frontier, 5 towns × 50 years: industrial vacancy at year 50 3/2/4/9/2% (was 18/20/12/29/14%). Default map, 6 seeds: industrial vacancy 12.1% → 10.9% average (still 6-18%: more to find there). **Next: apartments** — the mainland rent every island renter weighs (ledger #30) is a formula; replace it with mainland landlords pricing by the island's landlord rule on mainland renters' budgets, and builders adding homes when rents beat cost.
5b. **DONE (2026-11-11): the town is built from its region's demand (city plan 18, `src/citygen/demand.mjs`).** The generator's per-district ladders made every island 50-58% office by floor area. Plan 18 keeps every massed building and sets its use from the island's share of its region's workplaces (Kneebone 2009 Table 3 job rings by sector, Census C2010SR-01 Table 3.4 resident rings, a per-seed core radius 2-10 miles), the engine's own national floor per worker (`tools/floor-demand.mjs` -> `floorDemand.mjs`), and flats for the renting households of the island's work (every island home is a rental in the engine; HVS 2023 ownership 65.9%). A flats-over-shop building is flats over a shop (`upper: "homes"`). The engine opens the region at the island's flat dwellers over their share of it (`market.ts regionSize`); the off-map sample holds the mainland's jobs. Frontier towns: office 12%, shops 23%, sheds 33%, flats 32% (was ~55% office). Five Frontier towns x 50 years: vacancy 1-13% in every class, unemployment 4-11%; office still has the highest rent per foot on four seeds (as in US asking rents), shops lead on seed 44 in years 10 and 40. **Open, found on the way:** (a) `households.ts locMu`, the island's general appeal, is solved at the opening to fill whatever flats were built — a fitted number; replace with an earned amenity (Glaeser-Kolko-Saiz 2001; Couture-Handbury 2020). (b) Plan-18 regions grow +3-11% in 50 years against +36% on the old office towns: every industry group loses national share (seed 22, 30 years: manufacturing -14%, office +11%, all jobs -1%); find whether the town's export share falls by mechanism or by fault. (c) Year-10 shed shakeout on every seed (sheds 15-25% vacant, unemployment 10-12%), recovering by year 20. (d) Little is built in 50 years on any seed.
5c. **Next (owner-approved 2026-11-11): the mainland housing market** — mainland submarkets with a stock, vacancy and landlords pricing by the island landlord rule (replacing `mainRent`'s Saiz exponent and `mainlandRent`'s lognormal draw); mainland builders when rent beats land plus cost (Saiz 1.75 becomes a check); owned homes in the same stock with prices from sales. Owned homes on the island are parked (owner, 2026-11-11).
6. Remaining coins (`--list coin`): actions.ts (seller refusal, late bidder), leasing.ts (partial-suite rounding), streetRolls (firm exit/failure hazards — check if sourced), privateCredit (its coin removal bankrupted the bot once: go carefully), owners.ts exit hazards (demography: probably legitimate), boards/votes (no voters modelled).
5. Which class rents highest as an outcome (section below).

**How to work fast:** two helpers at a time on disjoint files (more crashes the container: exit 137); each runs tsc + one `SEEDS=22 HZ=120 node test/conserve.mjs`; cherry-pick their local commits, resolve MECHANISM_* and playable conflicts with `--theirs`, regenerate (`node tools/mechanism-audit.mjs --update`, `pnpm -s package:playable` inside broadway-and-wall). Seed 22 sometimes leaves the bot with no lease (coverage FAIL on `leasing` with $0 unexplained); confirm on seed 55 before reading it as a fault. Never force-push (denied); after a merge, fast-forward the branch to origin/main.

## HANDOFF (2026-11-10) — where the economy work stands

**On main (merged this run, #662-#695):** jobs fill in ~a month (JOLTS); stronger recessions; layoffs where cuts happen; short-of-hands pro rata; credit spreads widen in slumps; investment speed sourced (TAU_K 68); labour flows CPS-sourced and answering tightness; the finding rate reads JOLTS month-end openings (#690); cap rates answer rates (quarterly broker survey) and the ten-year prices a held rate; shops (then all classes) never sign at a loss; "normal vacancy" deleted, steps 0-9b (leasing, lease-up, builder gate, appraisal, demolition all read the market); land: interim income, index no longer freezes, answers construction cost; new space leases at the market's pace; firm turnover counted as BDS does; office tenants' price sensitivity recalibrated + office landlords trade rent against months dark (#688); player sale offers come from the street's bid round (#693); paydown draws the LOC (#695); the sim worker load fix + a CI guard (#679, #681). Century (3×60): about PASS 32 · WATCH 14 · FAIL 0-2.

**Merged in the second run (2026-11-10, #697-#702):**
- #697 office: rent anchor, churn, office space per worker answering real rent (−0.40). Office WT slope regressed (stated in the PR).
- #692 off-map space let to its own tenants (demand-finite 64% → 6.7%); a 6-seed check showed its new FAIL rows were noise.
- #698 office slope, take 7 (measured, nothing shipped; below).
- #699 one construction-loan price: rival takeovers, home builders, A&D loans and the deficit reserve all read the desk's live quote (`proforma.ts constructionRatePct`).
- #700 sellers' loss aversion on their own purchase price (Genesove & Mayer 2001, 0.15 of the loss), replacing the market-wide anchor; distressed discount −5.9 → −9.3%.
- #701 the appraisal values the rent roll term-and-reversion (the bidders' law, `value.ts termAndReversion`, `GAP_CLOSE_YR`), replacing the unsourced 55/45 blend. Agreement with the bids did not improve: the top bidder's value sits ~1.2× the appraisal either way, which is the bid shading (the cap is read from shaded prices), not two laws.
- #702 every listing meets the street's bid round every month (the coin gate removed); trades +40%.

Century after #702 (3×60): PASS 34 · WATCH 11 · FAIL 3, with the FAILs on land's swing / co-movement and the construction lag.

**The 3-seed office WT slope is noise-dominated:** #699, which does not touch office rents, moved it from −0.40/−0.40/−0.05 to −0.13/−0.12/−0.08. Use 6+ seeds, or the same-year regression in `tools/probes/wtp.py`, before reading a change in it.

**Also merged:** #703 shed tenants keep their industry's books (closures 15.7 → 9.8%/yr; leavers rise, so total shed exits barely move; credit grade still 0 for every shed firm, which is the next shed item).

**Parked branch:** `claude/office-vacancy-answers-rent` (office → flats conversion; overbuilt office on seed 33).

**Merged in the third run (2026-11-10, #705-#708):**
- #705 tests: a loan is paid whenever cash or the line can pay it (`test/loc-pays-loans.mjs`; the engine already did this everywhere: mortgages, default cures of every cause, mezz, balloons, the bailiff); `loc-draw` and `loc-defends-deed` setups fixed (both had failed on main).
- #706 player-held notes pay, refinance, reinstate or hand over the keys on the building's own books (`markAsset`, `dealView`), not `pCure` coins: building NOI over coupon at default, median 1.95 → 1.02; deeds in lieu 3 → 12 in 3 seeds × 40 years. `pCure` still prices notes on the market (a forecast) — make it the same tests' probability.
- #708 lenders ration on their own break-even margin (opex + own expected loss + CAPM cost of equity × capital target; Damodaran Jan 2026 betas, ERP 4.49), not NORMAL_NIM. 6 seeds: PASS 33/14/1 → 35/10/3; the land rows got noisier (swing ratio 2.70 → 4.34, ranges overlapping).

**Not started / still open (in priority order):**
0. **The scoreboard is `pnpm mechanism`** (2026-11-10 baseline: 135 coins · 274 draws · 425 unsourced constants · 6 ledger rows). Work it down file by file, coins first (`--list coin`; the most are in actions.ts, dev.ts, leasing.ts, rivals.ts, notes.ts). The items below are the largest single mechanisms; each should lower the counts.
1. **Land price formation (fails or flips on nearly every change).** A lot's price is today's development residual (levered: near-zero residuals swing hardest) or a holder bid at a hand-set peak (`PEAK_RENT_MULT` 1.25) discounted by a hand-set wait (`WAIT_DISCOUNT` 0.567). Replace both with the development option (McDonald & Siegel 1986; Williams 1991; Capozza & Helsley 1990): build when the finished value V reaches V* = β/(β−1)·K; below it land = (V/V*)^β·(V* − K). β from the engine's own measured property volatility, the cap rate as the payout yield and the underwriting discount rate; check the option premium against Quigg (1993, Seattle: ~6% of land value). Then measure land's swing, swing ratio and co-movement on 6 seeds.
2. The tape's supply is a quota (`sim.ts refreshListings` tops the tape up to `targetListings` with random parcels, distress on a coin `pDistress`). Owners should review hold/sell on their own numbers (the street's best bid against their value-in-use plus the round trip's costs); distress only from real defaults (cityLoans in workout).
3. Office WT slope: decompose a year's office rent change (trade, comps pull, CPI, bargains, composition) on 6 seeds.
4. Shed firms' credit (`creditOfSize` gives every street shed firm grade 0); then the expiry exit rule (`EXIT_BASE` × the firms-per-work ratio⁴, unsourced).
5. The audit list: the player's buildings lease on a separate formula (put them on the street's shortlists); land tape hazards; player lease terms as coins; workout tables; private-credit dice; register holders' exit hazards. Also: check #702's +40% trade volume against a published turnover share of stock, and the mid-lease growers who never stop looking (take 7: 9-16% of office stock, up to 54 months; a lapse at PATIENCE_M is a realism fix of its own).
6. Which class rents highest must be an outcome (section below).
7. National shocks reverse within ~18 months (`claude/forward-looking-nation`, not shipped). The owner said: do not change black swans or confidence shocks.
8. Town payrolls in booms: heads grow slower than the nation's; labour demand, not hiring, is the remaining gap.
9. Stale tests failing on main: refi-broken, products, deed-goes, mezz-sale, visible-buyers, tenantmarket retail renewals.

**How to work:** small PRs to main; the before/after that matters is `pnpm mechanism` (coins, draws, unsourced constants, ledger rows — lower the baseline with `--update` when they fall); the century (`tools/proof.mjs`) is a smoke alarm for broken mechanisms and impossible outcomes, read per seed, conserve on any money change, `pnpm -s package:playable && node test/playable-loads.mjs` (the month must run in the sim worker — no module-level reads of imported constants across the engine's import cycles). Probes from the second run are committed in `tools/probes/` (README there).

## Which class rents highest must be an outcome (owner, 2026-11-10, open)

The owner does not want office to have the highest rent per foot every game. Which class rents highest or lowest should come out of each market's own supply and demand: the tenants it houses and what they can pay, its stock and pipeline, its vacancy and costs. It should not come from opening rent levels or class constants that fix the ranking. In the record the ranking varies by city and decade: prime high-street retail above office, industrial rents overtaking office in many US metros after 2020, apartments leading in supply-constrained towns. To check: (1) measure how often the ranking changes across seeds and over a century; (2) trace what pins it, e.g. opening rent anchors (CITY_STOCK and opening rents by class), per-class FIRM_PROFILE occupancy-cost shares, construction cost per class, or the tenants' value-of-space terms; (3) let each class's level be set by its own tenants' ability to pay and its own market. Tackle after the office rent and churn work.

*Step 1 measured (2026-11-11, seeds 11/22/55, 40 years, effective rent index every 5 years):* office leads in every seed at every five-year mark except one (seed 22 year 5, retail on top); industrial is last always, by 3-6×. The year-0 order is `RENT_BASE` (35.5 / 30.2 / 26 / 8.5) scaled by density (market.ts ~1332), and the gaps widen from there. So the ranking is pinned at the opening by the table. Step 2: derive each class's opening level from its own tenants' ability to pay (FIRM_PROFILE occupancy-cost share × sales per foot, tenantBooks rentCapacity) and its replacement cost, instead of RENT_BASE; then measure again.

## Office rents and vacancy: what the measurements say (2026-11-07, open)

The century's office Wheaton-Torto slope (yearly Δlog real effective rent on last year's vacancy) is −0.22%/yr per point on seed 11, against −2 to −3 in the record. A 40-year probe (scratchpad `offprobe.mjs`, `mosprobe.mjs`) located it:

- **The face never falls.** Through ten years at 15-16% vacancy the real face held at about 23 and real effective at 19.5-20; signed packages rose only from 10-13% (tight) to 13-16% (soft). The face is cut only once the book's package is at `PKG_MAX` (35%), and space under patience is lifted *up* to the comps and passes CPI, so the real face ratchets up in booms and holds in busts.
- **The landlord's own package stays small** (vacant books 2-6%): the vacancy clock is the average age of the space and patience is learned from the same clock, so in soft years space sits 15-18 months against a patience of about 12 and the sweetening push is about 0.5 a month. Signed packages come mostly from the tenant's bargain against its runner-up.
- **`PKG_STEP`'s documented target is not what the code does**: the note says "space a year dark … adds about three points a month and reaches the deepest package within the year", but with patience 12 months (since #531) space a year dark adds nothing. Re-reading a [K] constant to a new pace would be tuning; it needs a sourced pace for an individual dark building.
- **Months of supply is a sound tightness reading for office** (Little's law; office 11.1 months at 11.2% vacancy against the 12-month norm, +1.2 months a point, r 0.97), but **not for industrial** (11.7 months against a 6-month norm: the engine's industrial vacancy, 10.5%, sits well above the US 2010s) or retail (3.0 against 10).

Tried on branches, measured on seed 11, none shipped:

| change | WT slope |
|---|---|
| main | −0.22 |
| a package floor from months of supply over the 12-month norm, spread over a mid-grade term (`claude/office-package-floor`) | −0.15 (noise; floor binds 28% of months, 1.2% mean) |
| + patience capped at the class's months-on-market | −0.25 |
| face takes 0.58 of each sweetening step (Reis national office Q4 2009: asking −1.1%, effective −1.9%) (`claude/office-face-split`) | −0.32 |
| all three | −0.40 |

The face share is contested by the code's own source (Manhattan 2020-24: asking −3.3%, net effective −17.3%, a share of about 0.2), so it is not settled. Next: a sourced pace for how fast an individual dark building cuts (not the market average), and whether space under patience should pass CPI in a market whose months of supply is above the norm.

**Step 9a, landlords pricing on their own tours (2026-11-08, not shipped; branch `claude/landlords-tours-wip`).** The ladder (patience seeded from `MONTHS_ON_MARKET`, `noteLetting`'s yardstick, package-then-face) replaced by the flats' rule on a commercial landlord's door: each shortlist a firm takes is a tour card at every building on it, and the landlord posts the effective rent maximising p·(T − F/W(p)) over a year of cards (40-year probe `offprobe.mjs`/`allprobe.mjs`, seed 11 unless noted; main: office WT −0.31, vacancy 11.7%, real effective 16-19):

| variant | result |
|---|---|
| card = the firm's ceiling against its runner-up (`bidCeiling`) | Bertrand with no cost under it: office effective −55% in two years at unchanged 10% vacancy (five of six tours report a ceiling below the building's own post) |
| card = the firm's absolute ceiling (worth − move + taste), capacity read against the face (the anchor bug below) | WT −1.05 but vacancy 5.2%, effective −25% |
| same, capacity fixed | WT −0.17, vacancy 6.0% |
| + the landlord's own conversion (lettings over toured feet) scales W | effective 11-13 (−30%), vacancy falls to 5%, signed packages stuck at 25-35% while tight |
| + face at the top of the book | packages still ~25% at 4% vacancy; industrial effective −40% |

What blocks it: a building sees one or two tours a year in this town (`tours/q` ~1), so a landlord with two cards almost always prices to the lower (a 12-month window makes the wait F·M/W long), and the level ends up set by how `worth` is defined rather than by the market. The competitive channel the record shows (more alternatives in a glut) lives in `bargain`, not the ask. Next: a demand estimate a thin door can support without a comps anchor, or more tours per building (a shortlist that reflects how many buildings a broker actually shows in a glut).

**Step 9a, take 2: landlords trading rent against months dark (2026-11-09, not shipped; branch `claude/office-rents-darkcost-wip`).** A suite earns its effective rent p for a term N, then sits dark the months M(p) it takes to let again, so it earns p·N/(N + M(p)) over the cycle; with M(p) ∝ p^ε the best post is where M = N/(ε − 1). The landlord reads M off the market's own clock (proforma.ts `leaseUpMonthsOf` for a standing building: space on offer over lettings a month) and moves its post by ln(M*/M)/ε a year, package first. No vacancy is normal in it: M is what the tenants did, M* moves with the term (84 months, the covenant bands weighted by STREET_GRADE_SF) and with ε. ε came from the engine's own choice rule: the broker's (mkt/post)³ draw plus the logit's (post / TASTE·mkt)·(1 − 1/7) — about 11.6 for office, 13.7 shops, 15.2 sheds, so M* ≈ 8 / 6.6 / 5.9 months.

| variant (40-year probe `allprobe.mjs`, 3 seeds unless noted) | office WT | office vac | note |
|---|---|---|---|
| main (6aa5ee33) | −0.28 / −0.14 / −0.40 | 10.5 / 7.0 / 8.3 | signed pkg 15-17% |
| the trade, every book (seed 11) | −0.56 | 5.6 | shops WT +4.7; sheds effective 2.4 → 4.3 |
| the old ladder with patience = the market's months (no trade) | +0.13 / −0.15 / +0.03 | 11.3 / 5.6 / 7.8 | signed packages 31-39% (the reservation falls with M) |
| patience seeded from the market's months, `noteLetting` yard = max(patience, market months) (years 1-30) | −0.06 / −0.03 | 7.7 / 5.1 | real effective +20% over main |

What it shows: the engine's office market runs at M ≈ 22 months at 10% vacancy (turnover ≈ 6% of stock a year), while its tenants make a landlord's lettings answer its post with ε ≈ 11.6 — measured causally too (a randomised ±5% on half the vacant books at years 12-16, seeds 11 and 22: ε 6-10, noisy). Priced honestly against that elasticity, a landlord wants M ≈ 8, so office vacancy runs down to 4-6%, the same place 9a's absolute-ceiling variant landed (5.2%). The record is consistent with ε ≈ 4.5 from two independent facts: US office months of supply of 20-25 at a structural vacancy near 11% gives N/(ε − 1) ≈ 22 → ε ≈ 4.8, and the same ε gives a Wheaton-Torto slope of −(1/ε)/v ≈ −2%/yr a point, the record's −2 to −3. So the trade is the right mechanism and the engine's tenants are about 2.5 times too price-sensitive: TASTE (0.10 of rent, a Gumbel sd of 13%) is fitted to renewal rates alone, where moving costs (MOVE_PSF, $50/sf ≈ 20% of a year's rent over a term) do the work. Next: re-fit TASTE (and look at the (mkt/post)³ tour weight, a [K]) jointly against retention and the record's months of supply, then land the trade. Choosing ε to hit 11% vacancy directly would be a natural vacancy by another name.

**Step 9a, take 3: the tenants' price sensitivity recalibrated, the trade on office only (2026-11-09, PR `claude/office-rents-taste`).** Office TASTE 0.10 → 0.19 and the broker's (mkt/post)³ draw dropped for office (`KEEN_POW` office 0), so office ε = (1/0.19)·6/7 ≈ 4.5 — the figure the record's months of supply (~20-25 at ~11% vacancy) and the Wheaton-Torto slope both imply — and M* = 84/3.5 = 24 months. Renewals, the fact TASTE was fitted to, agree: office renewals in test/tenantmarket.mjs go 78% → 65% against the studies' 55%. The trade, tried on every book with this calibration (3 seeds × 60 years), sent shop rents rising with vacancy (WT +1.5 / 0.0 / +2.3) and shed vacancy to 17%, so shops and sheds keep the patience ladder (`reviewAskByPatience`), the cube and their TASTE.

| century, 3 seeds × 60 years (WT from yearly vacancy and real effective rent, years 6-60) | office WT | office vac | report |
|---|---|---|---|
| main (6aa5ee33 engine) | −0.13 / −0.66 / −0.17 | 12.2 / 7.5 / 8.0 | PASS 31 · WATCH 15 · FAIL 2 |
| the trade on every book, recalibrated | −0.23 / −0.39 / −0.62 | 15.8 / 14.4 / 13.7 | PASS 34 · WATCH 12 · FAIL 2 (shops' WT positive, sheds' vacancy 17%) |
| **office only (shipped)** | −0.56 / −0.66 / −0.49 | 16.0 / 15.6 / 13.7 | PASS 32 · WATCH 14 · FAIL 2 |

Still open: the office slope is about −0.6, not −2 to −3; office real effective drifts down (−0.7%/yr, WATCH) from a jump in the first five years (16 → 20-24) as landlords first find M < M*; land's 5-year co-movement with property fell to 0.29 (FAIL).

**Step 9a, take 4: why office stops at −0.6, and why shops and sheds cannot take the trade yet (2026-11-10, not shipped; the sheds-only variant on branch `claude/rents-all-classes-wip`).** Measured with a 40-year probe on main (seed 11; per year: vacancy, the landlords' clock M, M*, posts against the index, signed effective, new-lease feet over stock):

- **The office trade is transmitted.** Real effective rent's yearly change on the same year's trade step ln(M*/M)/ε regresses at 0.92; on last year's, 0.52-0.59. The landlord closes most of a year's gap inside the year, so last year's vacancy (the Wheaton-Torto regressor) sees only the part that persists. Nothing here is lost to the package, the bargain or the comps pull.
- **ε and the vacancy the market settles at set the ceiling.** M follows Little's law (d ln M / d vacancy = 0.067 a point at a mean 16.3%, ≈ 1/v), so the trade's slope is −(1/ε)/v: −1.4%/yr a point at the engine's 16% even with full lagged transmission, −2.0 at the record's 11%. Times the lagged 0.55: −0.8, against −0.68 to −0.76 measured (century −0.56).
- **Office settles at 16-19% because its tenants change suites too often.** New-tenant lettings run 10-12% of the office stock a year (the comps), against ~6.7% for the US derived from the lease-expiry studies (55% renewal of space on a 7-year term, plus ~1%/yr net absorption). The market's months reach M* = 24 only at 16-19% vacancy. The same churn sets the opening jump: the town opens at 10% office vacancy with faces held through the opening, M falls 21 → 13 in five years as lettings rise (10.8% → 15.8% of stock a year), and landlords below M* raise real effective rent 14 → 24 by year 9 until vacancy climbs to where M = M*. So the next office step is the churn, not the trade: where the extra lettings come from (candidates, unmeasured by cause: firm entry and exit, 6.4-6.6% of firms a year in the century; relocations; expansions).

Shops and sheds, with ε derived by Little's law from their own published facts (the vacant stock over new-tenant lettings, (1 − R)·occupancy / term + g: shops R 65%, term 90 months, v 7%, g 0.5% → M ≈ 17, ε ≈ 6.2; sheds R 75% (Prologis retention 69-87%), term 60, v 7%, g 2% → M ≈ 12.6, ε ≈ 5.8; the same arithmetic gives office ε ≈ 5.3 against the shipped 4.5):

| variant | office WT · vac | shops WT · vac | sheds WT · vac | note |
|---|---|---|---|---|
| main (3 seeds × 60 years) | −0.56 / −0.66 / −0.49 · 16.0 / 15.6 / 13.7 | −0.19 / +0.10 / −0.13 · 7.2 / 8.4 / 12.5 | +0.08 / −0.22 / −0.33 · 6.4 / 7.3 / 6.2 | renewals (test/tenantmarket.mjs) 65 / 92 FAIL / 61% |
| the trade on every book, TASTE = (6/7)/ε, cube gone, the city's clock (seed 11) | −0.55 · 14.7 | +0.22 · 12.9 [8-19] | −0.22 · 37.4 [32-43] | sheds' clock (proforma.ts leaseUpMonthsOf) reads 10-14 months at 30%+ vacancy: it blends in the off-map half, whose occupancy is an equation |
| + a street clock (street empty feet over new-lease comps; 12-year probe) | vacancy 21% (street clock 11-13 at 10% vacancy, the city's 20) | 3 → 21 → 6% in five years | street vacancy 15-33%, clock 10-15 < M* 17.8 | the street's own sheds turn over ~20% of their feet a year |
| TASTE recalibrated (shops 0.14, sheds 0.15), cube gone, patience ladder kept (2 seeds) | −0.51 / −0.38 | −0.09 / −0.36 · 11.2 / 10.2, decades 4-6 at 14-18%, peak 36% | −0.44 / −0.56 · 8.7 / 7.8 | renewals 63 / 88 / 71%: shops pass, but shop vacancy leaves the record |
| sheds only: TASTE 0.15, cube gone, patience ladder kept (3 seeds) | +0.10 / −0.67 / −0.25 · 16.8 / 14.7 / 14.2 | −0.11 / −0.15 / −0.09 · 8.4 / 8.6 / 11.4 | −0.12 / −0.92 / −0.69 · 10.3 / 8.7 / 9.8, p90 15-18 | PASS 31 · WATCH 15 · FAIL 2 (main 32 / 14 / 2); sheds' real rent +1.0%/yr (main +0.4); a fourth seed: sheds −0.37 · 8.6 |

What it shows: the trade prices against a months-of-supply figure, and a class lands at the vacancy where its own months reach that figure. Every class in the engine lets 1.5-3 times the record's share of its stock to new tenants a year, so on the trade every class settles high (office 16%, which the band still holds; shops and sheds past it), and the sheds' city clock is not a market reading at all. Calibrating shops' price sensitivity alone, under the patience ladder, weakens the only discipline the ladder has (tenants walking from dear posts) while its months-on-market norm still says raise, so shop vacancy runs away. Order of work: (1) the off-map sheds' occupancy equation (FORMULA_LEDGER #34), so the sheds' clock is a market (done on `claude/offmap-occupancy`: the off-map floor is its own tenants' book; century 3 seeds × 60 years, vacancy office 15.9 → 15.3%, shops 9.0 → 11.2% (WATCH both; the ledger's phantom shop sliver now reads vacant), sheds 6.1 → 7.7% (PASS), flats 9.0 → 9.3%; grades PASS 32/WATCH 14/FAIL 2 → 31/12/5, the new FAILs on rows the plan already calls noisy — land's yearly swing sd 19.8 → 25.0%, distressed discount −8.4 → −4.3%, construction-after-jobs lag 3 → 4 years — unresolved on three seeds); (2) the churn — new-tenant lettings by cause against the record; (3) then the trade on every book with the ε above, and MONTHS_ON_MARKET deleted.

**Step 9a, take 5: new-tenant lettings by cause (2026-11-10, measured; the fix tried is not shipped, branch `claude/tenant-churn-reqfit-wip`).** A probe counted every foot that left a street suite and every foot signed by a firm new to its suite, by cause, as a share of the street's stock a year (seed 11, years 6-40, main engine; counters in `streetRolls.ts`, probe-only, not committed):

| office, % of stock a year | main | record |
|---|---|---|
| leases expiring | 10.7 | ~12.7 (0.89 occupancy over a ~7-year term) |
| ...renewed (at once or after holding over) | 5.6 (52%) | 55-65% (CBRE / JLL expiry studies; test/tenantmarket.mjs reads 65%, counting firms that outgrew as moving) |
| lettings to firms moving **for growth** (outgrown at expiry 2.0, mid-lease 2.6) | **5.6** | part of the ~5.7 that all non-renewals give |
| lettings to firms moving for a better deal | 3.1 | |
| lettings to new firms (replacing closures 2.1, left town 0.5) | 1.7 | BDS deaths ~2% of office space by the books' default rates |
| **all new-tenant lettings** | **10.4** | ~6.7 (expiry non-renewals plus ~1% net absorption) |

The excess is moves for growth, and most of them are made by the shortlist: a firm tours any suite of **half** its requirement (`shop`, `stayOdds`: `want * 0.5`, unsourced), signs for `take < want`, and keeps the heads it wanted (`hcRef = want / lvl`), so it has outgrown the suite the day it moves in. 21-25% of let office feet were signed under 80% of need; 29-34% of let feet need over 1.25× their floor at any time, and the mid-lease rule (3% a month once need > 1.5× floor, also unsourced) and the expiry rule (need > 1.25× with no room) send them to market. Shops show the same (35-39% of shop feet signed under 80% of need, 7% of shop stock a year going to market for growth mid-lease) but those firms almost always renew in the end (lettings for growth 0.6%); a shop's growth is meant to come as more shops (the CBP note at `tradeAdd`). Sheds have a different outlier: **shed tenants go dark at 14% of the street's shed stock a year** (office 2.1%, shops 6%), because every street shed firm is credit 0 (`creditOfSize` on the regional size distribution) and in a shop trade's profile (food and apparel margins ~1% on the shed floor), failing 20-27% a year against ~1-3% for industrial tenants. That is the next shed item.

The fix tried: an office firm tours only suites of at least 80% of its requirement (`REQ_FIT`, the densest planning ratios running about a fifth under the norm, CoreNet 2012: 225 → 176 sf a worker), shops and sheds unchanged. On the probe, office lettings for growth 5.6 → 3.8, all new-tenant lettings 10.4 → 8.7, renewals 65% → 70% in test/tenantmarket.mjs. The century (3 seeds × 60 years, against #688):

| | office vac | office WT | office real rent %/yr | report |
|---|---|---|---|---|
| main (#688) | 16.0 / 15.6 / 13.7 | −0.56 / −0.66 / −0.49 | −0.7 (WATCH) | PASS 32 · WATCH 14 · FAIL 2 |
| REQ_FIT office 0.8 | 11.7 / 10.9 / 11.0 | −0.30 / −0.51 / −0.20 | −1.1 (WATCH); seed 33 real office rent 19 → 6 from year 22, still falling at 5-7% vacancy | PASS 31 · WATCH 14 · FAIL 3 (construction-follows-demand lag lost; real land −0.7%/yr; land swing 23.9% FAIL; shop vacancy 9.0 → 6.9 PASS) |

So the churn is the cause of office's high vacancy — vacancy falls into the record's band as soon as the extra lettings go — but not of the weak slope: with less churn the slope weakens, because office real rent then falls through tight years (seed 33). Something other than the months-dark trade pulls office rent down over decades (the take-3 "real effective drifts down" WATCH, now stronger); find that before taking the churn out. Not shipped.


**Step 9a, take 6: office vacancy answering office rent (2026-11-10; the demand half shipped with `claude/office-space-answers-rent`, conversion parked on `claude/office-vacancy-answers-rent`).** On the churn branch (new-tenant lettings ~7%/yr, renewals 75%) seed 11's real office rent fell 20 → 6.5 over 60 years at a flat 17% vacancy: firms' need ignored rent and, from year ~30, no office was started and none left, so the trade (M > M*) cut for decades with nothing to close the gap.

- **Demand (shipped):** office feet a worker move with real effective rent at elasticity −0.40, the mean of Stockholm −0.55 (Englund, Gunnelin, Hendershott & Söderberg 2005, NBER WP 11345, Table 4: 1 / the lnS coefficient −1.803) and London −0.24 (Hendershott, Matysiak & Lizieri 1999); employment's elasticity ≈ 1 in both, so it is space per worker. Applied only at lease events (sign, renew, a firm entering), against the opening's real effective rent (`streetRolls.ts` SPACE_RENT_ELAST, `Tenant.spw`).
- **Supply (parked):** office → flats conversion in `replacementSearch` (Lower Manhattan ~16-19M sf 1995-2006). Alone it does not stop seed 33's collapse; with demand, PASS 36 · WATCH 9 · FAIL 3 on two seeds.

Neither keeps the Wheaton-Torto slope: a 50-year probe (seed 11) read WT −0.61 on the churn branch and −0.21 with demand, and the landlords' clock decouples from vacancy (d ln M / d vacancy 0.053 → 0.034): in years 37-49 vacancy is 12-14% but lettings fall to 5.5-6.5% of stock, so M stays 26-30 > M* = 24 and the trade keeps cutting at low vacancy. The next question is why lettings thin as vacancy falls (fewer moves for a deal when there are fewer options; resizes at renewal are not lettings), since that, not the demand curve, is what the trade reads.

**Cap-rate pass-through is weak at any lag** (seen while landing #643): Δcap on Δ10Y correlates about 0.2 at lags 1-4 on main and the branch alike, so the "Cap rates lag the 10Y" row's best lag flips between 2 and 4 on noise. The finding is the weak pass-through, not the lag. Open.

## Tried and dropped (so nobody tries them again the same way)

- **The re-tender bid with capacity against the opening's heads** (`claude/retender-capacity`, for item 8's snap-back): runaway growth — jobs and population +2.2%/yr over 60 years (main 0.5-0.6), real land +8.6%/yr, retail vacancy 38%, because heads serving local demand count as bidding capacity and growth compounds (with #646's entry on top). The snap-back is the engine's stabiliser; a fix needs export-serving capacity only, or Blanchard-Katz convergence through wages and migration.
- **A matched land-survey panel with floor prints** (branch `claude/land-survey-panel`). The texture floor scales with `landIdx`, so a lot at its floor reads exactly the level: no-bid lots hold the level, fringe lots bid below their floor print a RISE every year they go unbid, and the panel ratcheted (+4.5%/yr real; PASS 29/13/6). An earlier good result came from a bug that multiplied the floor in twice. Any survey redesign must never let a print read the level (a chained matched-pair median of the bids, with lost and gained bidders as censored ranks, is the candidate).
- **A robust (Huber Proposal 2) volatility record for the appraisal filter** (`claude/robust-grid-q`): the prior entered as unclipped pseudo-steps matched to 1 while real steps were clipped and matched to ψ2, so the prior counted as ~13 steps, not 5, and pulled every class toward q0.
- **A full building's concession package fading to the market's** (`claude/package-fades-to-market`): self-referential (the comps carry the package), so concessions never burned off; vacancy collapsed to ~2%. Office rents ignore business-cycle vacancy because on-market cuts (~1.2-1.4%/yr per point, realistic) are given back when space is re-offered; the fix needs a market-tightness input (months-to-let, or the landlord's learned expected vacancy `L.v`, written and never read).
- **Builder equity from LPs** (design only): money conservation failed — LP payouts had no path back to households.
- **Full-finance carry in the decision basis** (`claude/crunch-decision-side`): leaked into cash paths and shifted every land bid 7-21% in normal credit; replaced by #635's equity stretch.

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
| `tools/shocks.mjs` on 5 seeds | No row BACKWARDS or NO RESPONSE: every shock moves what it causes in the direction any real economy does. Magnitudes are graded against the record loosely; a WRONG SIZE starts an investigation, not a tuning pass |
| `pnpm mechanism` (`tools/mechanism-audit.mjs`) | **0 coins and 0 draws** outside the allowed outside world (nation, swans, weather) and agents' own taste draws; **0 unsourced constants**. The ratchet in CI stops any count rising; each PR that lowers one lowers the baseline. **This is the scoreboard** (owner, 2026-11-10) |
| `tools/proof.mjs` | **A reference and a smoke alarm only.** No impossible outcome (negative space, a bank lending more than it has, a crunch in which no price falls, a frozen year). Its history bands are not targets: the town's history is its own |
| `test/conserve.mjs` + the economy-wide identity (Phase 7) | $0 unexplained, for every agent, not only the player |
| `tools/deepplay.mjs` on 3 seeds × 20 years | 0 BUG, 0 REALISM lines |
| One-valuation identity (Phase 2) | The same building valued by any two functions differs only by a named, real role difference |

**Not even a range — a reference** (owner, 2026-11-10: *"The goal is that everything is simulated and there's no fake numbers; I don't necessarily need it to reflect what has happened in the real world"*). Real-world numbers belong on the input side, sourced; the outputs are whatever the agents make. Progress is the mechanism audit going down (`pnpm mechanism`), not proof rows going green.

**The record is a range, not a script** (owner, 2026-11-06: *"it doesn't have to be exactly like history right?"*). US history is one draw of a random process; a simulation that matched it row for row would be suspect, not realistic. What the record is for is catching the impossible — a +25% output gap, a bank lending one name more than its capital, a credit crunch in which no sale falls — because each of those is a broken mechanism. The mechanism rules (every number one of the four kinds above, no load-bearing rails) are where the standard stays strict.

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
