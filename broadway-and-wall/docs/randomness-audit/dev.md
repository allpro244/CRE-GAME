# Fake-number audit: dev.ts, value.ts, landdev.ts, zoning.ts, plates.ts, homes.ts, roads.ts, tax.ts, platdesign.ts, mix.ts, comps.ts

Verified against main at c75ef8b (#838) plus the opening-dearness change, 2026-11-20.

Read-only re-check of the first pass against broadway-and-wall/CLAUDE.md "NO FAKE NUMBERS". Paths are relative to `broadway-and-wall/src/engine/`. The working tree is mid-merge of `main` (MERGE_HEAD c75ef8b). Nothing was run. Rows marked (out of scope) sit in other files but are links in the land-value chain.

Status: **STILL** = the same item is in the code (new file:line given); **CHANGED** = still there in a different form (described); **NEW** = not in the first pass. Rows that are gone are listed at the end.

## Findings

| file:line | kind | quantity it decides | bucket | why | proposed replacement mechanism (FAKE only) | sev | Status |
|---|---|---|---|---|---|---|---|
| value.ts:1736, 1762 | minmax (floor) | Land price floor for every non-farm lot: `texture = rec.landPsf × landIdx × level × envelopeRealisation × cpi × priceLevel`; `floor = texture × 0.30` | FAKE | Unchanged. `rec.landPsf` is still the generator's stamp (citygen/build.mjs:533), the 0.30 is asserted, and the comment (1739-1761) still quotes texture winning 59.1% of vacant lots. | Price from interim-use income (value.ts now has a car-park interim use, ~3720) and the real option (value.ts:578-622). Keep location texture only as a rent input. | high | STILL |
| value.ts:1818 (ripe branch: `if (base < floor) { base = floor; winner = "texture" }`), 1820-1825 (else max(holder, floor)) | minmax | The builder's residual is overridden by the floor | FAKE | Unchanged. The comment calls the floor "sales-comparison", but it is the stamped texture × comp-adjusted landAdj. | Price a transacted lot at the residual; show an owner who will not sell as unlisted, or as an ask that decays on time-on-market. | high | STILL |
| comps.ts:426 (landAdj clamp [0.25, 4]) | clamp | the comp heat adjustment on the stamped texture | FAKE (suspect) | Both rails asserted; landAdj multiplies only the stamp. | Remove the rails; let comps move the reservation price directly. Count binds. | med | STILL |
| comps.ts:459-479 (`holderCapitulation`) | mechanism | the only downward force on the floor | FAKE | CHANGED: the 0.25 floor is gone ("NO FLOOR (2026-11-06)", rail audit #19 had it binding 36.7%). It is still gated on `builder > 0` and `winner === "texture"`, so lots with no positive residual (most of a young town's dirt) never decay. CAPITULATION 0.06 is a stated shape from 2007-11. | Time-on-market decay on every listed lot with no bid, driven by bids received or not received. | high | CHANGED |
| zoning.ts:215 | asserted mult | Variance granted: landAdj ×1.22 (cap 4) | FAKE | Counted twice: the extra FAR already reaches the residual. | Remove. | high | STILL |
| value.ts:1099 (`if (!(q.absYr > 0)) return 0`) | minmax | queue factor (wait to build) for any lot behind the first | FAKE (binding guard) | absYr is still five trailing years of the town's own tape (value.ts:1135-1141). A young or stalled town has none, every lot behind the first is worth 0 as a site, and the price falls to the texture floor. | Seed take-up from modelled demand (job and household growth × space per head); use a finite wait. | med | STILL |
| value.ts:1684 | minmax | `level = max(0.35, 1 + 0.85·(demandIdx − mean))` scales the texture floor | FAKE | Asserted slope and floor, applied only to the stamp. | Goes with the floor. | med | STILL |
| value.ts:1783 | clamp | comp reconciliation discount on the builder bid, [−25%, 0] | FAKE (suspect) | Asserted. | Weight by comp count and dispersion; no rail. | med | STILL |
| dev.ts:4309 (`useForZone(…, rng(s,"dev"), e)`), 3621-3712 (programme weights 0.55/0.30/0.15, 0.40/0.40/0.20, 0.70/0.30/0.25 × `siteHurdle`); rivals.ts:3762 (out of scope) | roll | which use a teardown probes first; which use a rival builds | FAKE | CHANGED: for city teardowns the roll now only picks the probe. `replacementSearch` (dev.ts:4108, called at 4473) prices every permitted use and keeps the best hurdle, and the weights are multiplied by each class's `siteHurdle` instead of an order book. The roll still orders the sample and scores it. rivals.ts:3762 still takes the rolled use for a rival. | Drop the probe roll (rank by residual − as-is value). Route rivals through `replacementSearch`. | med | CHANGED |
| dev.ts:4710 (industrial exit `onSchedule(…, officeShort ? 0.12 : min(0.9, 0.3 + 2.2·share))`), 4733-4735 (score condW 1.4/1.15 × M-zone 1.25 × age × demand) | asserted rate + score | whether and which shed leaves the stock | FAKE | CHANGED: no longer a die. The same asserted pace now runs on a deterministic schedule. Each candidate must pass `worthMoreCleared` (dev.ts:4637, an owner-economics test), but which one goes and how often are still asserted. | Every owner's own test each month (NOI − carry < 0 and cleared > as-is); the count follows from how many fail it. | high | CHANGED |
| dev.ts:4834-4837 (surplus exit `p = min(0.5, max(0.06, 2.2·worstShare))` on schedule), 4855-4857 (score) | asserted rate + score | office/retail/flat surplus clearance | FAKE | CHANGED, as the industrial row: schedule, not dice; `worthMoreCleared` gate; gated on capitulated packages (`pkgDeepM`). The pace is still asserted. | Same owner test. | high | CHANGED |
| dev.ts:5680-5684 (`openingTrade = max(0.5, stock·0.018/12/TYPICAL_SF·32)`), 306-308 (`builderTarget = clamp(1.5·looks, 10, 60)`), 429 (outsiders) | asserted rate + clamp | the opening roster of developers and the "outsiders" who look when shops are few | FAKE | CHANGED: monthly looks are now one per living firm (dev.ts:5097-5106); the quota is gone. The asserted 1.8%/yr×32 now sets only the opening roster and the outsider count (tagged [K]). The 10-60 clamp still sets how many firms a town opens with. | Opening roster from the opening stock's actual developer count (or free entry over the pre-history); outsiders from expected profit. | med | CHANGED (two old rows, developerLooksPerMonth and builderTarget, merged here) |
| dev.ts:1855-1868 (BTS: `p = min(0.09, (0.004+0.045·demand)·phaseHit/sizeHard)`, phaseHit [0.45,1.1], sizeHard [0.55,2.4], `lookAcc` accumulator) | asserted rate + clamps | build-to-suit anchor arrival | FAKE | CHANGED: it is now a deterministic accumulator (hash-phased) instead of a coin. The rate and both clamps are still asserted. | Arrivals from occupier firms whose space need, from sector employment growth, exceeds the shell. | med | CHANGED |
| dev.ts:2966-2988 (pre-leasing: fair share of `grossLettingsMo`, `near` clamp [0.35, 1.35], cap 0.42, discount clamp [0.86, 0.99]) | clamp + asserted | pre-letting of frames under construction | FAKE (shape) | CHANGED: no roll, and no per-class rate × appetite. It is the frame's fair share of the market's own gross lettings, accrued. The nearness ramp, the 0.42 cap and the discount band are still asserted. | Price the discount as delivery risk (time × lease-up variance); drop the cap. | low-med | CHANGED |
| dev.ts:4319-4320 | asserted weights | teardown sample score `(0.35 + land/built) × densify × condW(1.35/1.15) × (1 + 2.2·structTight)` | FAKE | It ranks which candidates are underwritten first. | Rank by residual − as-is value. | med | STILL |
| dev.ts:4928 | minmax | off-map stock exit at up to 0.4%/month | FAKE | Asserted withdrawal rate. | Owner test on the off-map cohort. | med | STILL |
| dev.ts:4993 (`nudgeBlockDemand(min(3, 0.8 + sf/180k))` on city delivery) | asserted | demand spillover from a delivery | FAKE | Asserted spillover. | A demand model that reads nearby stock/amenity. | med | STILL |
| dev.ts:3023 (`nudgeBlockDemand(min(4, 1 + sf/150k))` on the player's delivery) | asserted | demand spillover from the player's delivery | FAKE | A second spillover with different constants for the same event (rule 3). | Same as above; one law for both. | med | NEW |
| value.ts:3827, 3833 (cap clamp [2%, 20%]) | clamp | cap rate per building | GUARD (stated) | CHANGED: the [3.2%, 13%] rail is now [2%, 20%], stated as "a guard on a broken input, not a price", and the spreads are gone (caps from bidders, propmarket.ts). Count binds to confirm. | — | low | CHANGED |
| value.ts:5002 | minmax | ground-lease yield = `max(3.2, 0.55·indexRate + 2.1)` | FAKE | Asserted formula and floor. | From ground-lease trades, or risk-free plus a sized land premium. | med | STILL |
| value.ts:5035 | minmax | leased-fee value floored at 0.55 × land | FAKE | Asserted floor. | PV of rent plus reversion, no floor. | med | STILL |
| value.ts:4582 (residential `(0.94-occ)·2.2` [−0.12, 0.85]), 4643 (roll distance [−0.25, 0.70]), 4647 (flat 0.55 with no commercial roll), 4656 (occupancy), 4665 (concentration), 4671 (industry) | clamp | distress cap-rate spreads | FAKE (suspect) | Asserted slopes and rails. | Expected NOI loss over the hold, discounted. | low | STILL |
| dev.ts:5517 | roll weights | use specialisation base weights [0.40, 0.22, 0.20, 0.18] | FAKE | Asserted mix. | Learn from own results, or Census/Dodge starts by type. | low | STILL |
| homes.ts:54-55 (BUILDER_ENTRY_P 0.25, LISTED 0.5), 724-727 (schedule) | asserted rate | homebuilder entry | FAKE | CHANGED: no die. A builder looks on a hashed-phase schedule (every 4th month, every 2nd if listed, [K]); residual > 0 and room decide. The look rate is still asserted. | Entry in proportion to residual × lots available. | low | CHANGED |
| value.ts:396 | clamp | envelopeRealisation floored at 0.30 | FAKE (suspect) | Asserted floor; feeds texture and residual. | Remove; physicalMaxFloors defines it. | low | STILL |
| value.ts:357, 367 (shop-depth [0.3, 1.6]), 377 (plate rent [0.85, 1.10]) | clamp | shape rails on rent | FAKE (shape) | CHANGED: the locMult, lease-up 0.5 floor and qualityCycle rails from the first pass are no longer present. These three remain. | Count binds; remove any that bind. | low | CHANGED |
| dev.ts:2394, 2416 | minmax | takeover commitment = `max(0.35, ltc − 0.12)` | FAKE | Asserted LTC. | Size by the lender's own constraints. | low | STILL |
| citygen/build.mjs:533 (out of scope) | minmax | `landPsf = max(30, assessed/0.45 × (0.6 + 0.9·demand/100))` | FAKE | The $30/sf stamp at the base of the floor chain. | Goes with the texture floor. | med | STILL |
| market.ts:1698-1705 (out of scope) | asserted shape | opening landIdx = (rent/cost)^1.15 | FAKE (shape) | CHANGED: the monthly target × cycleDev × vacDisc × bidders plus ±0.3% die is gone; the level is read off land trades (propmarket.ts `tickLandRead`, not re-audited). The opening identity remains and the floor multiplies it. | Open on the first land survey. | med | CHANGED |
| dev.ts:5900-5913 (`pastSpaceMarket`: `cityVac = clamp(vac × then/now, 0.02, 0.40)`) | clamp | the space market the opening pipeline's backdated frames were decided in | FAKE (inherited) | It re-uses the regime.ts 2-40% opening pin and the `vacMultOf`/`rentMultOf` lines (see market.md). | Goes with simulating the pre-history's occupancy. | low | NEW |
| value.ts:5182 (`max(landAppraisalFloor(…), v − roll)`) | minmax | as-is value of a building with a lease-up roll | FAKE (inherited) | The floor inherits the texture floor chain. | Goes with the texture floor. | low | NEW |
| value.ts:1225-1229, 5015-5018 | hashNormal | owner ask = model × belief lag × exp(0.15·N(0,1)) | EXOGENOUS | Sourced (Geltner 1993; Webb 1994). The per-lot error never re-draws, and it multiplies the floor. | n/a (consider re-drawing on sale) | — | STILL |
| value.ts:3837-3844 | hash | appraisal display band ±3.5% bias | EXOGENOUS | Display only. Unsourced. | — | — | STILL |
| value.ts:1242-1250 (`siteCostMult`, SITE_COST_SIGMA 0.15, 60-month epoch staggered by lot) | hashNormal | per-site hard cost | EXOGENOUS | CHANGED: moved from dev.ts `projectCostMult` to value.ts so the appraisal and the desk read one number. Sourced (RSMeans quartiles). | — | — | CHANGED |
| dev.ts:2797 | rrange | cost-plus escalation noise ±0.08%/month | EXOGENOUS | Small. Unsourced. | — | — | STILL |
| dev.ts:2806-2839 | roll + rrange | site risk: change orders (+1.5-7%), weather delay, sub default (+3-9%, +2-5 months) | EXOGENOUS | Genuine accidents; rates unsourced (size from FMI/Dodge/CII). | — | — | STILL |
| dev.ts:323; homes.ts:113 | hash01 | builder capital around $3M | EXOGENOUS | CHANGED (dev.ts): spread ×1.6 and ×8 for cash builders (`CASH_BUILDER_LTC`); a founder that cannot carry its first scheme is not created. homes.ts unchanged. | — | — | CHANGED |
| dev.ts:5451-5530 | rng/gauss | drawDeveloper traits (LTC mix 25/75, bar σ 0.20, floor, ambition, outlook σ 0.10, momentum, maxShare) | EXOGENOUS | Population heterogeneity, partly sourced. | — | — | STILL |
| dev.ts:5240 | rng | per-look outlook jitter ±3% | EXOGENOUS | Belief noise. | — | — | STILL |
| dev.ts:160 (`pickConstructionDesk`), 446, 474 | hash/roll | construction desk pick; builder pick (AUM-faded) | EXOGENOUS | Who gets the job. | — | — | STILL |
| dev.ts:4290, 4717, 4843, 5250; 5933 (opening backdate) | roll | site sampling (search friction); opening frame backdate | EXOGENOUS | Limited attention / timing. The pro forma decides. | — | — | STILL |
| plates.ts:362-372 | gauss | tenant size lognormal (SIZE_DIST) | EXOGENOUS | Firm-size distribution. Check SIZE_DIST's source. | — | — | STILL |
| homes.ts:536-541, 649 | poisson | house sales around the modelled pace | EXOGENOUS | Arrival noise around a modelled mean. | — | — | STILL |
| zoning.ts:199; odds 118-126 | roll | variance decision; odds clamp(…, 0.08, 0.82) | EXOGENOUS | Political. The odds are an asserted shape. | — | — | STILL |
| landdev.ts:55, 211; growth.ts:569 | roll | entitlement decision; odds 0.80 to 0.45 by distance ([K]) | EXOGENOUS | Political; size the odds from data. | — | — | STILL |
| zoning.ts:248-250 (LANDMARK_RATE 0.006 on a hashed-phase schedule) | schedule | landmarking | EXOGENOUS | CHANGED: no monthly die; a flow on a schedule ([K]). | — | — | CHANGED |
| roads.ts:397-414 | roll | state highway: funding, slip, drop | EXOGENOUS | CHANGED: funding is now `corridorWarranted` (the county's traffic counts), and a drop is deterministic (3 slips and no ten-year growth). Only the slip length `24 + rng·49` months (412) is still drawn. | — | — | CHANGED |
| mix.ts:60-63 | hash01 | derived retail share of a legacy mixed record clamp(…, 0.06, 0.42) | EXOGENOUS | Imputation of missing data. | — | — | STILL |
| dev.ts:2909 (`onSchedule`: `(month−1)·rate + hash01(seed:sched:key)`) | schedule | how the exit valves and other flows fire at a rate | GUARD/plumbing | Deterministic phasing of a rate; the rate itself is the fake where it is asserted (see exit rows). | — | — | NEW |
| dev.ts:5629-5651 (`equityStretch` clamp [0.5, 2.5]) | clamp | profit-on-cost scaling with the equity share | GUARD (stated) | "The guard on the ratio is not meant to bind." | — | — | NEW |
| value.ts:4966 | minmax | building value ≥ landValue | PHYSICAL | It ignores demolition cost and inherits the texture floor. | — | — | STILL |
| value.ts:273, 299 | clamp | plate efficiency [0.72, 0.92], [0.78, 1] | PHYSICAL | Design range. | — | — | STILL |
| dev.ts:1137, 2390, 2406 | minmax | coverage [0.08, 0.9] | PHYSICAL | Site geometry. | — | — | STILL |
| value.ts:1919, 2264, 3772, 4264, 4609-4610, 4789, 4813-4815, 4913, 4923; platdesign.ts:411 | clamp | condition, occupancy, shares in [0, 1] | PHYSICAL | Definitions. | — | — | STILL |
| dev.ts:193 | minmax | LTC ≤ 0.85 | PHYSICAL | Lending ceiling. | — | — | STILL |
| tax.ts:224 | clamp | depreciable land share [LAND_SHARE_MIN, MAX] | PHYSICAL | Regulatory band. | — | — | STILL |
| landdev.ts:47, 107 | clamp | entitlement 12-24 months; infrastructure 6-18 months | PHYSICAL | Sourced durations. | — | — | STILL |
| value.ts:878 | clamp | infillShare [0.15, 1] (unresolved records only) | GUARD | — | — | — | STILL |
| value.ts:1099, 1475 | minmax | max(0.01, r); min(3, hurdle^elasticity) | GUARD | — | — | — | STILL |
| dev.ts:847 | minmax | buildClimate [0.10, 2.5] | GUARD | — | — | — | STILL |
| dev.ts:5489, 5668 | minmax | spread floor [1, 1.25] | GUARD | — | — | — | STILL |
| value.ts:1993 | minmax | specWearMult | GUARD | Sourced shape bounds. | — | — | STILL |
| value.ts:410-414 | clamp | siteQualityMult [0.82, 1.22] | (dead) | Still no callers. Delete. | — | — | STILL |
| dev.ts:4331-4335, 5718 | roll | teardownRoll, the old in-kind roll, shareJitter, formerBuildRoll, formerDemoRoll, formerDurationRoll: drawn then discarded | (dead) | Kept to hold the stream. Remove in a stream-breaking commit. | — | — | STILL |

## How land value is set (after the "Land:" PR, 2026-11-20)

1. `readLand`: **income** = the builder's residual if the option is ripe and the residual is positive; otherwise the **holder** = the development option (beta now carries the idle-land tax and insurance, `optionBeta(…, tau)`) plus the interim car park's income until exercise, `interim/(r+tau) × (1 − reach)`.
2. **sales** = the district's recency-weighted median price per foot of zoned envelope (`econ.landComps`, comps.ts, quarterly; half-life 12 months, dropped at 60; distress excluded; off-market at 0.75/0.35) × this lot's envelope, restated by CPI.
3. **seed** = the old texture (stamp × landIdx × level × envelope × cpi × priceLevel × 0.30), weight `econ.landSeedW` = 3 prints halving yearly from the opening, gone at 60 months.
4. price = (w_sales·sales + w_seed·seed + 3·income) / (w_sales + w_seed + 3). No floor, no max. `winner` = the largest term.
5. Removed: the floor (value.ts 1762/1818), softDiscount and its [−25%, 0] clamp, `districtHeat`, the `landAdj` district pull and its [0.25, 4] clamp, `holderCapitulation`, the variance ×1.22. `queueFactor`'s take-up adds the stock wearing out (occupied/55 yr) where demolition runs slower.

## How land value was set (before the "Land:" PR)

1. `landValue(rec, econ)` (value.ts:1858) = `lotArea × landPsfNow`, a memo over `readLand` (value.ts:1675-1855).
2. `readLand` reads `residualCore`: **builder** = the best scheme's residual (after `queueFactor`, which still returns 0 with no five-year tape, value.ts:1099). **Option** = a real development option (value.ts:578-622; beta from the town's measured `landSigma`). The old "holder" (residual at a certain +25% peak × 0.567) is gone.
3. **texture floor** = stamp × landIdx × level × envelopeRealisation × cpi × priceLevel × 0.30 (value.ts:1736, 1762). landAdj (comps.ts:426, [0.25, 4]) and the variance ×1.22 (zoning.ts:215) still push the stamp. `bumpLand` is gone. Capitulation pulls it down only where a positive builder bid exists (comps.ts:466).
4. **Pricing rule (unchanged in shape):** if the option is ripe and builder > 0, price = builder (× the comp discount) **but never below the floor** (1818). Otherwise price = holder-option if ≥ floor, else the floor. Then max with farm, subdivider, homes.
5. The owner's ask = landPsfNow × belief lag × exp(0.15·N) (value.ts:5015-5018).

**Verdict.** The option value replaced the worst of the holder bid, the bumpLand ratchet is gone, and capitulation no longer stops at a floor. But the stamped texture floor still overrides the residual, and on lots with no positive residual nothing ever brings it down. The first pass's diagnosis stands.

## Summary

Old rows: 73.
- STILL: 44 (17 FAKE, 13 EXOGENOUS, 7 PHYSICAL, 5 GUARD, 2 dead)
- CHANGED: 16 (12 FAKE, 4 EXOGENOUS)
- GONE: 13 (9 FAKE, 4 EXOGENOUS)
- NEW: 5 (3 FAKE, 2 guard/plumbing)

Top fakes left in this file set:
1. **value.ts:1736/1762/1818** texture floor on the generator stamp (build.mjs:533), overriding the residual.
2. **comps.ts:466** capitulation still gated on builder > 0. Together with **value.ts:1099** (queueFactor 0 without a tape), this keeps young-town dirt at the stamp.
3. **zoning.ts:215** variance ×1.22, and **comps.ts:426** landAdj rails [0.25, 4].
4. **dev.ts:4710 / 4834** exit valves: the dice are gone, but the asserted pace and score remain.
5. **dev.ts:5680-5684 / 306** opening developer roster from the old 1.8%×32 quota, clamped 10-60.

## Fixed since the first pass

- dev.ts bumpLand (×1.06/1.05/1.03, cap 4): removed (dev.ts:5051-5056).
- dev.ts:4104 in-kind roll `min(0.92, 0.70 + 1.2·structTight)`: dead. `replacementSearch` picks the use (the draw is kept at 4332).
- dev.ts developerLooksPerMonth quota (0.5/month floor): every living firm looks each month (5097-5106).
- dev.ts:343/389 new-builder coin 0.25 × credit: `foundersFor`, entry for schemes that pencil but no firm here can fund.
- dev.ts:3572 classAppetite: deleted.
- dev.ts:5472 opening pipeline utilisation clamp(1 − 7·slack, 0.18, 1): the opening crews start whatever pencils (`seedOpeningPipeline`).
- value.ts:571 holder bid at a certain +25% peak × 0.567: a real development option (value.ts:578-622).
- value.ts:4789 collateral clamp(0.18 + 0.74·occ): replaced (value.ts:5364).
- value.ts:3388/3759 idle-land carry 1.2%: `idleLandCarryRate = taxRate + 0.1% insurance` (value.ts:3715-3716).
- plates.ts:380 industrial whole-bay 45% die: `remnantSf` test.
- dev.ts:1684 BTS credit tier 58% roll: covenant from size (`creditOfSize`, dev.ts:1777).
- dev.ts:350/399 2%/month idle retirement coin: `builderDone` after 180 months without a start or a pencil.
- homes.ts:662 tenure roll: SFR share accrued closing by closing (homes.ts:663-665).
- tax.ts:48/101 appeal coin: decided on the evidence at the hearing (tax.ts:100-106). The odds at tax.ts:47 are now only a quote.
