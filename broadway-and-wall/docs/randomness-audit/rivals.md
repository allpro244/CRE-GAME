# Fake-number audit: rivals, credit and swans

Scope: `broadway-and-wall/src/engine/` {rivals, sim, blackswans, swans, privateCredit, lenders, debt, credit, portfolio, portfoliosale, investors, competitorTraits}.ts. Read-only audit. All line numbers are against the current checkout. Random draws were traced through `rng()`, `rrange()`, `hash01`/`spinHash`/FNV hashes, `circleNoise` and `newsChance`. Bounds were traced through `cl()`, `clamp()`, `clampSigned()` and `Math.min/max` wherever they bound an economic quantity.

Buckets: **FAKE** (a roll or bound deciding something the model should compute, or a tuned constant), **EXOGENOUS** (an outside shock or firm luck; keep, but size it from data), **PHYSICAL** (a definition), **GUARD** (should never bind), **COSMETIC** (news text only; no economic effect, outside the four buckets).

## Table

### FAKE

| file:line | kind | what it decides | bucket | why | proposed replacement | sev |
|---|---|---|---|---|---|---|
| rivals.ts:4924-4935, 4983-4988, 1283-1300 | firm-level arrears clock on a pooled cash account | whether a rival dies, and whether **every** building it owns goes to the lenders | FAKE | Every building's NOI, every loan's debt service, overhead and tax land in one `r.cash` (4459, 4469, 4504). One bad building drains the whole firm. 15 straight months below zero kills the firm, and `chargeSponsorFailure` hands over all of its deeds, including loans that were current. That contradicts the file's own rule at 4007 ("the loan in default is foreclosed, not the firm") and non-recourse SPE structure. A firm with positive equity but no liquidity dies the same way as an insolvent one. | Hold each building in its own SPE: its NOI services its own loan, and a shortfall defaults that loan only (deed-in-lieu or foreclosure of that asset). The parent account carries overhead, the line, recourse carve-outs and guarantees. The firm fails only when the parent misses its own obligations, or when parent recourse liabilities exceed liquid assets plus the net sale equity of the unencumbered and positive-equity buildings. | high |
| rivals.ts:4559-4566, 4596-4601 | reserve cap and payout rate | how much cash a rival holds going into a downturn | FAKE | Reserve = max($2M·dollarLevel, AUM×{4.5% to 16% by style}), capped at $30M ($45M for developers)×CPI. Everything above that is paid out at 10% a month. These are tuned constants (the comments cite median-run fixes). None of it looks at the firm's own obligations: debt service, maturities, the line. Going into a recession a $50-100M book holds about 3-5% of AUM. | Size the reserve from the firm's own forward needs: N months of debt service plus overhead plus capex, plus maturities due in the next 24 months that are not refinanceable at today's sizing, minus committed undrawn line. Distribute only free cash flow above that. Cut distributions when the credit window tightens or DSCR falls (that is what LPAs and REIT boards do). | high |
| rivals.ts:1569-1573, 3589-3601 (comment 3593-3595), 1530-1536 | opening-roster liquidity | how deep the opening firms' defences are | FAKE | Opening firms start with cash = equity × rrange(0.06, 0.16) (0.34-0.48 for builders). They have **no `uncalled`** and `distRecent = 0`, so `recallable()` is 0 until they have paid out for a while. The stress ladder's step 1 (capital call, 4956-4957) and the balloon call (4179) therefore do nothing for opening firms in their early years. This lines up with the playtest: $14-35M openers die in the first recession by year 6. The same mortality pattern for entrants was fixed at 2976-2999 by adding `uncalled`; the opening roster was left out. | Seed the opening roster as mid-life vehicles in steady state: uncalled = commitment × (1 − fund age/investment period) by style, distRecent = the style's steady-state payout over the last 24 months, and cash from the obligation-based reserve rule above, not a rrange share. | high |
| rivals.ts:3570-3587 (used at 4906-4909, 4140) | revolver capacity re-sized every month | whether a rival can borrow through a cash hole | FAKE | `lineRoom` = min(covenant, `streetRefiProceeds` on today's NOI) − debt, recomputed every tick. A recession cuts NOI and raises rates, so room goes negative exactly when the line is needed. Real facilities are committed for a term, with a quarterly borrowing-base test and a waiver negotiation. The file admits revolver pricing is not modelled (3564-3568). | Model a committed facility: commitment, maturity, spread, a quarterly covenant test. A breach goes to the desk's NPV decision (waiver for a fee, cut commitment, or call). Undrawn commitment stays available until the breach is actually tested. | high |
| workout.ts:114-127 via rivals.ts:4151; rivals.ts:4124 | extension and forbearance access | whether a desk works with a struggling rival | FAKE | Rivals call `deskWillExtend(s, desk)` with the default `rel = 20`, so a "stretched" bank never extends any rival (it needs rel > 45). Extensions are only offered at maturity; nobody modifies a loan for missed monthly payments. The rival's real relationship history with the desk is ignored. | Compute rel from the rival's actual loan history with the desk. Let the desk choose modify/forbear vs foreclose by NPV: modified-loan PV vs foreclosure recovery (mark × REO discount − costs − time) at the desk's `lenderPressure`. Apply this to payment defaults as well as balloons. | high |
| rivals.ts:4966-4968, 3779-3799, 3881 | distress sale cadence and price | how fast and at what price a stressed rival can raise cash | FAKE | It sells only on every second month of stress (`stressMs % 2 === 0`), one building at a time. Public distress asks are `rrange(0.68, 0.88)` × value (3881), and the decision uses the hard-coded midpoint 0.78. The docstring at 3934 calls exactly this kind of band "a constant chosen to make a distress sale look like a distress sale". Voluntary deleveraging is switched off once in stress (`!r.stressMs` at 4641, 4676, 4782). | List at the mark and let the clearing price come from the bid-depth function (rivals.ts ~5050, "how many firms could actually close this"). Discount only by the seller's time-to-deadline against expected days on market. Allow several assets in the same month when the arrears require it. | med |
| rivals.ts:1293 | lender loss on a failed sponsor | the loss charged to desks, which feeds bank failures | FAKE | Recovery = asset value × rrange(0.68, 0.88). A die roll decides the loss that can then break a bank (lenders.ts:1327). | Book the loss when the receiver actually sells (the REO path already prices from `lenderPressure`), at the realised price. | med |
| rivals.ts:4382-4384 | receiver release pace | how many failed-firm buildings reach the market each month | FAKE | 1-2 buildings a month, chosen at random. | Release pace = f(desk `lenderPressure`, bid depth at the mark). A flush desk sells slowly, an impaired one sells fast. Release the worst-ratio assets first. | med |
| rivals.ts:4614 | cash-out refi decision | when rivals lever up in a boom (which later kills them) | FAKE | `rng < 0.06 × cashOut`: a roll decides the leverage decision behind the failure wave. | Refinance when the firm has deals clearing its own hurdle (`firmHurdle`) and the redeployment return beats the cost of the new debt, within lineRoom/covenant. | med |
| rivals.ts:4777-4782 | voluntary trims | when a rival sells into strength or deleverages | FAKE | `rng < trimBase`, where trimBase = (0.018 + 0.052·hot·heat)·… with tuned constants. | Sell when the best bid exceeds hold value (mark including the firm's own outlook) by more than transaction costs, or when leverage is above target and falling values are forecast. The same hold-vs-sell test the player faces. | med |
| rivals.ts:978-979, 986 | groundbreak claim and winner | which rival builds a city job | FAKE | p = min(0.95, want·ci·(2.6 or 1.35)·suit·deployPressure), rolled. The winner is the max of a weight × U(0.6, 1.4). The near-player 2.6 vs 1.35 is a tuned constant. | Every firm that passes `firmWouldBuild` bids its residual land value. The highest residual wins, and fails if it cannot fund. | med |
| rivals.ts:961 | asserted build capacity | whether a rival can take on a project | FAKE | `projectCost > aum·0.9 + cash·5` is a rule of thumb, not a lender test. The real equity and line tests follow at 965-969. | Delete it and let construction-loan sizing plus the equity test decide. | low |
| rivals.ts:1414 | orphan frame ask | price of a half-built building | FAKE | Land + sunk × rrange(0.45, 0.7) × stale (stale floored at 0.45). | Residual: completed value − cost to complete − developer profit − carry, minus a discount for design risk. | med |
| rivals.ts:3862-3864 | private-offer discount | price a squeezed rival quotes you | FAKE | Ask = 0.95 − 0.20 × desperate, constants. | Seller reservation from its deadline: arrears months left × bid depth. | low |
| rivals.ts:4940-4949 | "backer" quirk rescue | a one-time equity injection | FAKE | Size = max(AUM×0.08, 2×shortfall), asserted. The quirk is assigned by hash (competitorTraits.ts:454). | Model the backer as a named holder with wealth. Its commitment depends on its own balance sheet and its view of the firm's equity. | low |
| rivals.ts:5022-5030 | husk wind-up clock | when a solvent empty firm retires | FAKE | Fixed 24 months. | Wind up at fund term (holdM) or when LPs vote: expected return on redeployment below their alternative. | low |
| rivals.ts:4956 | cure buffer | size of a capital call | FAKE | `aum × 0.004` buffer. | N months of the firm's own forward deficit. | low |
| sim.ts:454, 494 | anonymous distressed seller | whether a listing is a distress sale | FAKE | `rng < min(0.5, 0.03 + 0.33·down + 0.15·tight)`. Distress is rolled even though the owner's loan exists (`s.cityLoans`, used at 509). | Distressed only if the owner's loan is in watch/workout or its DSCR is below 1 at today's NOI. | med |
| sim.ts:497 | big-asset rejection | listings above $60M | FAKE | 88% rejected by roll, an asserted constant. | Let bid depth decide: an owner lists only when depth at the mark is above 0. | med |
| sim.ts:504, 517; 339; 621 | ask bands | listing asks | FAKE | Distress 0.72-0.90 and 0.78-0.93, "denial" 0.94-1.10 plus a cycle term: dice bands for price. | Owner reservation = hold value (income capitalised at the owner's own cost of capital) plus the deadline discount. The price is then discovered by bids. | med |
| sim.ts:1291 + sponsor.ts:73-76 | player seizure price | what creditors get for your building | FAKE | `min(0.85, distressPrice)` with distressPrice floored at 0.62. Rivals use rrange(0.68, 0.88) and receivers use `reoAsk`, so the same quantity has three answers (NO FAKE NUMBERS rule 3). | One distressed-sale mechanism (bid depth plus the seller's deadline) for player, rival and receiver. | med |
| sim.ts:144-154 | listing flow rate | how many anonymous listings appear | FAKE | 0.4%-1.2% of lots a month, constants. | Owner-level hold decisions: hold period, loan maturity, life events (tickHolders already does this for named holders). | low |
| blackswans.ts:116 | fiscal crisis odds | city fiscal crisis | FAKE | The hazard is tripled in a recession by assertion. The city's tax base and `taxMult` exist and could produce this. | A municipal budget: revenue from assessed values × rate, spending growth. Crisis when the debt service / revenue gap passes a market threshold. | med |
| swans.ts:926 | wave clamp ±0.06 | demand effect of a structural swan | FAKE (dormant) | A load-bearing cap, but `SWANS_OFF = true` (763) so it is inert. | Fix during the revamp. | low |
| privateCredit.ts:162 | rescue advance | LTV the player lends a stressed rival | FAKE | +8 points of advance when stressMs > 8: more leverage for a worse borrower, clamped 0.45-0.72. | Advance from collateral value and the lender's loan-to-own appetite; falls with arrears. | med |
| privateCredit.ts:234-236, 511-513 | private loan pricing | coupon, points, term | FAKE | `privateBase + rrange(PRIVATE_PREMIUM)`, points rrange(1.2%, 2.8%), term 6-18 months, all rolled. | Risk-based price: LTV, borrower arrears, collateral liquidity, desk appetite. | med |
| privateCredit.ts:319 | arrears relief | rival's default clock after a rescue | FAKE | `stressMs −= 2` by assertion, whatever cash it actually cured. | Remove it. The cash lands in `rival.cash` and the normal test (cash ≥ 0, 4997) resets the clock if it really cured. | high |
| privateCredit.ts:212, 491, 461 | ask spawn / refusal | whether a needy rival asks you for money | FAKE | Spawns at 22% / 28% a month; Cordage refuses 35% of the time. | Ask whenever `rivalNeedsPrivate` is true and the rival's best alternative (desk quote) is worse. | low |
| lenders.ts:1327 | bank / life company seizure | whether a desk fails | FAKE | `capital ≤ 0 && rng < 0.35`, or `cr < 0.22·target && rng < 0.09`. Examiners close banks by rule. | Prompt corrective action: a bank is closed within 90 days of tangible equity / assets < 2%. Life company: regulatory control when RBC < 70% of the authorised control level. Deterministic, timed from the breach. | high |
| lenders.ts:1356 | purchase and assumption | whether your uninsured deposits survive a failure | FAKE | 75% roll. | P&A when franchise value (deposit premium) ≥ estimated asset loss; otherwise payout. | med |
| lenders.ts:570 | depositor recovery | haircut on uninsured cash | FAKE | rrange(0.60, 0.90). | Receivership estate: recoveries on the failed desk's actual book at realised prices / its liabilities. | med |
| lenders.ts:1192-1208 | anonymous book delinquency | delinquency, charge-offs and capital for most of each desk's book | FAKE | Reduced-form badTarget (0.006 + 0.55·stress + 0.6·slack + 0.03·tight + 0.26·landFall) plus noise, clamped 0.002-0.35. The engine has building-level NOI. | Compute the anonymous book from the city's non-named stock: loan-level DSCR at today's NOI and rates on the city loan tape (`cityLoans`). | med |
| lenders.ts:1305 | anonymous book floor | desk size | FAKE | Book never falls below $20M × priceLevel. A rail. | Let it shrink to the loans actually outstanding. | med |
| lenders.ts:983 | origination chase | market share | FAKE | Shares glide back toward a fixed `bookShareOf` target (clamp −0.25 to +0.30). | Share from quote competitiveness: the borrower picks the best quote (already in `quote`). | med |
| lenders.ts:1291-1293 | appetite | desk lending appetite | FAKE | nimFac with fitted constants 0.195/0.683; appetite clamped 0-1.15. | Appetite from capital surplus over target and from expected RAROC on new paper. | med |
| lenders.ts:1242 | conduit recapitalisation | conduit capital | FAKE | Refills 1/12 of the gap each month when the window is open. Capital from nowhere. | Retained first-loss piece funded by new deal issuance; size it from deal volume. | low |
| lenders.ts:1216, 1224, 1037, 425, 1431 | caps and shapes | delinquency cap 0.4, charge-off 0.33/yr, panic floor 0.25 / max 1.6, pressure interpolation 1.15/0.85, credit pull clamp 0.45-1.2 | FAKE | Shape constants and rails on credit conditions. | Charge-off from realised REO sales; panic from the depositor run model (already in tickDeposits); creditIdx unbounded, taken from system appetite. | low |
| debt.ts:636-652 | underwriting standards index | LTV / DSCR loosening | FAKE | Weights 0.45/0.25/0.30 and divisors 0.22/0.25/0.01/0.02, tuned. | Fit to the SLOOS (Fed Senior Loan Officer survey) CRE standards series, and say so. | low |
| credit.ts:228, 247 | player LOC advance | line limit | FAKE | LOC_LTV × clamp(ci, 0.35, 1.15) × (1 − min(0.6, 1.6·cut)); land/3. | The same borrowing base as rivals: income sized at the desks, land at the land loan. | low |
| portfolio.ts:424, 794-797, 831, 857, 484 | anonymous portfolio buyers | bids on your bundle | FAKE | The BUYERS table has no balance sheets. Arrival is a roll 0.30·eager^3.2, price = indicative × patience × rrange(0.88, 1.02), limit rrange 4-16%, unsolicited 1.2%/mo, hold-vs-walk 70%. | Bidders = named rivals and institutions passing the cash / LTV test (as portfoliosale.ts:478-487 already does), bidding their own valuation. | med |
| portfoliosale.ts:498, 640, 787 | rival package take / breakup / open | rival buys a book; REO breakup price | FAKE | Take by roll 0.09·w·{1.8, 1, 0.35}; breakup asks rrange(0.62, 0.78); open rrange(0.80, 1.00). | The rival takes the package if its valuation exceeds the ask. Breakup asks go through the single distressed-sale mechanism. | med |

### EXOGENOUS (keep; should say what data sizes them)

| file:line | kind | what it decides | bucket | why | sev |
|---|---|---|---|---|---|
| blackswans.ts:80-97, 117-122 | annual hazards 1/200-1/350 | swan arrivals | EXOGENOUS | "Shape parameters from the record." Sourcing is loose. The `else if` chain allows at most one start per month (minor). | low |
| blackswans.ts:90-93 | panic hazard × exp(15·credGap) | crisis odds | EXOGENOUS | Schularick and Taylor are cited (good). The clamp on credGap is a GUARD. | — |
| blackswans.ts:144-150, 192-193, 276, 311-317, 377-387 | embargo, arrivals, panic length, fiscal and campus sizes | shock magnitude | EXOGENOUS | 1973, Mariel and 1907/2008 cited. Fiscal and campus sizes are not sourced. | low |
| blackswans.ts:216-226 | capital wave depth and phases | cap-rate shock | EXOGENOUS | Unsourced: say what it is fitted to. | low |
| blackswans.ts:264-269 | panic hits a desk, loss 0.5-1.3× capital | outside loss on a bank | EXOGENOUS | Loss size is unsourced. | low |
| swans.ts:152-153, 666-728 | trade / use level events | structural shifts | EXOGENOUS (dormant: SWANS_OFF) | Measured counts are stated. | — |
| rivals.ts:1496-1500, 1521-1527 | roster draw: 14% absent, equity ×0.55-1.75, ltv ±0.06 | firm heterogeneity | EXOGENOUS | Firm luck. Should cite a size distribution (e.g. NCREIF / Preqin fund sizes). | low |
| rivals.ts:1587-1618 | opening book picks weighted by fit | initial allocation | EXOGENOUS | — | — |
| rivals.ts:2905, 2934, 2963, 2972, 2978, 3001 | entrant arrival and raise | new firm | EXOGENOUS | The rate (pitch) is computed and the roll times the arrival. uncalled 30-50% is cited as practice. | low |
| rivals.ts:2210, 2822-2829 | retirement 1/7, spinout 5%/yr | people events | EXOGENOUS | The gates are facts. | low |
| rivals.ts:3093, 3102, 3174-3224, 3294 | city-job site/use picks | which site | EXOGENOUS (tie-break noise) | — | low |
| rivals.ts:3859, 4699-4737, 4810, 4834, 5374, 5546-5557, 3950 | private vs public listing choice, asks, REO window | seller style | EXOGENOUS | Opening asks only; price is discovered later. | low |
| lenders.ts:594, 647, 662, 1208 (noise term), 1346-1348 | receivership timing, replacement delay, reopen | timing | EXOGENOUS | — | low |
| sim.ts:463-466 (hash hold 34-155 mo), 329, 461, 634-645 | owner heterogeneity | who lists | EXOGENOUS | — | low |
| investors.ts:142-155, 272 | commit hazard, circleNoise 0.85-1.15 | raise pace | EXOGENOUS | Stated as shape parameters. | low |
| competitorTraits.ts:448, 451, 454-456, 577 | trait jitter, rules, quirks, misread | personality | EXOGENOUS | Firm heterogeneity. | low |
| portfoliosale.ts:494, 718, 723 | hunger noise, wind-down timing | — | EXOGENOUS | — | low |
| privateCredit.ts:232, 504, 509 | candidate pick | — | EXOGENOUS | — | low |

### PHYSICAL

| file:line | kind | why |
|---|---|---|
| debt.ts:1289, 1293-1295 | min(LTV, DSCR, debt yield) sizing | The definition of loan sizing. |
| debt.ts:736 | statedLtv ≤ maxLTV − 0.03 | No desk writes a loan in breach on day one. (The 0.20 floor is a GUARD.) |
| debt.ts:830-836, 1479-1481 | prepay penalty, amortisation ≥ 0 | Contract terms. |
| lenders.ts:441-442 | reoAsk ≤ mark, ≥ 0 | Definition. |
| lenders.ts:522, 525, 852 | deposit / posted rate ≥ 0 | Zero lower bound. |
| rivals.ts:1645-1650 | opening debt = min(ltv, refi, DSCR 1.25 @ +200bp) | Underwriting convention (stress test). |
| rivals.ts:4908, 3720 | draw ≤ room; call ≤ recallable | Cannot draw more than exists. |
| credit.ts:62-70, 178, 306-319, 366-370, 413, 428, 476, 523 | LOC draw/pay ≤ balance, cash | Accounting. |
| privateCredit.ts:166, 445 | face 250k-12M × CPI | Product size limits. |
| debt.ts:503-507 | class concentration caps | Regulatory CRE concentration guidance (should be cited). |

### GUARD

| file:line | why |
|---|---|
| rivals.ts:4337 (ci clamp 0.4-1.25), lenders.ts:1432 | Duplicates the pull clamp; never binds. |
| rivals.ts:278 `max(1e-6, …)`, many `Math.max(1, …)` denominators | Divide-by-zero. |
| swans.ts:673/711/728 LEVEL 0.25-4 | Level sanity. |
| blackswans.ts:91 credGap clamp, 380 pole level ≤ 16 | Extremes. |
| lenders.ts:393 (init book floor), 921-923 (deposit rate adjustment) | Init / smoothing. |
| credit.ts:50, 238 | Reserve floor; rate ≥ 1%. |
| privateCredit.ts:96-114 | Player's own sleeve policy. |

### COSMETIC (news only)

rivals.ts:1383, 2370, 4210, 4232, 4364, 4958; sim.ts:547, 628; privateCredit.ts:198, 481; lenders.ts:1402.

## How rivals fail (the chain)

1. **Cash in, cash out, one pot.** `tickRivals` (rivals.ts:4335). Per month: `r.cash += NOI/12 − interest − amort + deposit interest` (4452-4460), minus overhead of $60k·costIdx + 28bps of AUM (4468-4470), minus annual tax (4497-4503). All buildings and loans share one account.
2. **Balloons first.** `tickMaturities` (4113). A maturity that `streetRefiProceeds` will not fully refinance (4130) is cured, in order, by cash (4140), then `lineRoom` (4142-4148), then **one** desk extension via `deskWillExtend` with the default rel = 20 (4151; workout.ts:126), then a capital call if `recallable ≥ short` (4171), then a duress listing (4189-4193), and finally a deed-in-lieu (4196).
3. **The cushion is paid out.** Distributions take 10%/month of cash above the reserve (4596-4601). The reserve = min($30M or $45M·CPI, max($2M, 4.5-16% of AUM)) (4561-4566). Opening firms also started with cash of only 6-16% of equity (1569-1573), with no `uncalled` and `distRecent = 0`, so `recallable()` = 0 (3589-3601).
4. **Shortfall.** If cash < 0, draw on the line up to `lineRoom` (4906-4909). lineRoom is re-sized each month against current NOI at street coverage (3570-3587), so in a recession it is usually ≤ 0.
5. **Missed payment = arrears clock.** Cash still < 0 (or a called loan unpaid on an empty book, 4930) → `stressMs++` (4933). Any month with cash ≥ 0 resets it to 0 (4997-5009). This is a balance-sheet / cash-flow test, not a dice roll.
6. **The defence ladder while in arrears:**
   - (0) backer quirk, once (4940-4949);
   - (1) capital call only if recallable covers the whole shortfall (4956-4957); this is zero for young opening firms;
   - (2) on even months only, list one building at a duress price (4966-4968, 3781-3799). The sale is refused if it nets ≤ 0;
   - (3) from month 6 (NOTICE_M, workout.ts:69), a deed-in-lieu every 3 months (4978-4980).
   - Voluntary trims, fund-life sales and cash-out refis are all blocked while `stressMs > 0` (4641, 4676, 4782). Corporate M&A rescue is blocked for stressed firms (corporate.ts:63, 101, 133). No monthly-arrears forbearance exists.
7. **Death.** `stressMs > NOTICE_M + FORECLOSE_M` = 15 consecutive months → `failedM`, `endReason = "failed"`, and `chargeSponsorFailure` charges desks with a random 0.68-0.88 recovery (4983-4988, 1293). All remaining buildings go to receivers, released 1-2 a month at random (4382-4384). The desk losses can then trip a bank seizure, which is itself a roll (lenders.ts:1327). A seized bank refuses all extensions (workout.ts:116), and that feeds back into step 2.
8. **The other exit.** A solvent empty book retires after 24 months (5022-5030).

**Verdict.** Failure is decided by money, not by a roll: a missed payment starts a 15-month court calendar. What is fake is the structure around it:
- the pooled firm-level account, and the failure taking the whole firm;
- tuned reserve and payout constants that strip the cushion;
- opening firms with no recallable capital;
- a revolver that evaporates mark-to-market;
- no forbearance for payment defaults, and a fixed rel = 20 that shuts stretched banks;
- sales paced every other month at dice prices;
- every voluntary defence switched off once arrears begin.

Together these explain $14-35M openers dying in the first recession while a $5M player with a committed LOC (credit.ts) and their own judgement survives.

## Summary

Counts by table row (several rows group related lines): **FAKE 40** (high 8, med 22, low 10), **EXOGENOUS 18**, **PHYSICAL 10**, **GUARD 7**, **COSMETIC 11 call sites**.

Top 5 fakes:
1. **Firm-level pooled cash, and failure that takes the whole firm** (rivals.ts:4924-4988, 1283). Each building should be its own non-recourse SPE, and the parent should fail only on its own obligations.
2. **Opening roster with no recallable capital and 6-16% cash** (rivals.ts:1569-1573, 3589-3601). Seed them as mid-life funds with uncalled commitments and steady-state recent distributions.
3. **Reserve and payout constants** (rivals.ts:4559-4601). Size the reserve from forward debt service and maturities, and cut payouts in a tightening.
4. **Bank seizure by roll** (lenders.ts:1327). Replace with deterministic prompt corrective action (2% tangible equity, closed within 90 days). Related: P&A 75% roll (1356), recovery rrange (570).
5. **Revolver re-sized monthly, and no payment forbearance** (rivals.ts:3570-3587; workout.ts:126 with rel = 20). Use a committed facility with a quarterly covenant test, and an NPV-based modification decision with the real relationship.

Also high: privateCredit.ts:319 (`stressMs −= 2` by assertion).
