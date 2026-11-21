# Fake-number audit: leasing / sales / notes / auction / owners

Verified against main at c75ef8b (#838), 2026-11-20.

Scope: `broadway-and-wall/src/engine/{actions,leasing,streetRolls,notes,auction,offmarket,owners}.ts`, plus the tenant files that now exist: `tenantMarket.ts` (the street's bargain, landlord asks, random-utility taste) and `tenantBooks.ts` (firm books, failure). Read-only audit against CLAUDE.md "NO FAKE NUMBERS" and "Randomness: only at the boundary of the model".
Paths are relative to `src/engine/`. Line numbers are from the working tree at c184d44. That tree had a merge of `c75ef8b` in progress (4 unmerged files, none of them engine files). Every row of the first pass was found again by searching for its content, since the old line numbers had moved.

The randomness comes from `rng(s, ch)` / `rrange` (market.ts, the mulberry32 stream), the local `gauss` / `valuationAgeM` (actions.ts:1684-1694), `hash01` (competitorTraits.ts:287; a local copy in owners.ts:67), `gumbel` (tenantMarket.ts:726, random-utility taste) and weighted picks built on `rng`. Several fixed paths keep a `void rng(...)` so that downstream streams do not re-roll. Those voided draws decide nothing and are not listed.

Status: **STILL** = the fake is in the code as before (current line given). **CHANGED** = the mechanism moved, and the note says what is left. **NEW** = not in the first pass. Rows that are now **GONE** are in the list at the end.

## Table: FAKE rows first, sorted by severity

| file:line | kind | what quantity it decides | bucket | why | proposed replacement mechanism (FAKE only) | severity | Status |
|---|---|---|---|---|---|---|---|
| leasing.ts:2433-2436 / 2028 / 2162 | roll | TI allowance on new, expansion and renewal letters: `rrange(tiLo,tiHi)` inside the TI band. On new letters it is then scaled by `clamp01((bid-0.85)/0.15)` | FAKE | The band is calibrated (TI_ASK, leasing.ts:1061), but where in the band a deal lands is a die. The 0.85/0.15 line is asserted | TI = the cost to bring this suite to tenant standard: shell share or `fitM` age × fit-out $/sf × `costIdx`, plus the concession premium from `tiPressure`. Deterministic per suite | high | STILL |
| leasing.ts:2443 | roll | Free months on every new player LOI: `termM/12·rrange(0.25,0.85)·concession` | FAKE | The main concession is a uniform draw. The street now solves free months from the NE identity (`freeMonthsFor`, tenantMarket.ts:848), and the player's letters do not: two answers (fake type 3) | Use `freeMonthsFor(face, eff, termM)` with eff = the firm's bid from `offerForPlayer`. One mechanism for street and player | high | STILL |
| leasing.ts:1250-1299, roll at 2069 | clamp + roll | Whether a player tenant renews | FAKE | The base is now the street comparison (`stayOdds`, read in expectation). It is still multiplied by six asserted step factors (fSvc 0.74+0.48·svc, fCond 0.84+0.30·cond, fInd clamp [0.45,1.15], fFit 0.55/0.86/0.88, fCred 1.06/0.94, fTen), clamped to [0.10, 0.96], and rolled. **Defect:** `fFull` (the corner over-capacity term, 1282) and `fStrain` (the declined-relief term, 1287) are computed and named in `why`, but neither is in `p`. The news can name a reason that did not move the odds | Run the player tenant's expiry through the street's `shop` / `value` choice (streetRolls.ts:1160-1170), with service and condition as quality terms inside `value`. No product of factors, no clamp, no roll | high | CHANGED |
| leasing.ts:2097-2106, 2136 | minmax | Renewal rent: `market × stayBid × creditDisc(0.97/1.0/1.02) × clamp(1−0.14·stress+6·boom, 0.78, 1.18)`, floored at 0.6×market | FAKE | `stayBid` now comes from the firm's own options (`offerForPlayer`), which is real. The credit and trade multipliers, the trade rails and the 0.6 floor are still asserted on top of it, and the trade term double-counts what the firm's books already put into its bid | Drop the multipliers. Renewal rent = the `bargain` of the sitting tenant's stay option against its best street option (the same call the street uses at streetRolls.ts:1092/1180) | high | CHANGED |
| leasing.ts:2019 | roll | Expansion letter rent `market·rrange(0.96,1.06)` | FAKE | A die sets the rent on every expansion letter | The firm's bid for the extra space from `offerForPlayer`, the same as new letters | med | NEW |
| actions.ts:2327-2329 | minmax + roll | Off-market owner accepting a bid against their named ask: `p = 0.92 − disc·11 + 0.12·down`, clamp [0.02,0.9] | FAKE | The owner has a computed private reserve (`ownerAnswersCall`, 1901-1924; `number` at 2121), but acceptance ignores it and rolls a slope. The listed-seller path now accepts deterministically (actions.ts:584-591), so the two paths disagree (fake type 3) | Accept iff price ≥ the stored reserve. "Held" versus "ended" is set by how far under the reserve the bid is | high | FIXED (ownerFloor: take at or over the stored floor) |
| actions.ts:2407-2423 | minmax + roll | Counter on an off-market ask: pTake (`counterTakeOdds`) / pSoft clamp [0.12,0.40] / pHold, give = (0.22 or 0.38)·(0.55+0.45·rng) | FAKE | The same fault: the reserve exists, and the outcome is a die | Take iff px ≥ reserve. Otherwise counter at reserve + a share of the gap, the share from the holder's askPremium / attachment | med | FIXED (counter: take / once at the midpoint, floored / walk, by the floor) |
| actions.ts:2244-2258 | minmax + roll | Blind bid: whether the owner names a number (`pName = 0.86−2.2·gap`, ×0.55 per probe), walk `pWalk`, named number `reserve·rrange(1.01,1.05)` | FAKE | The reserve is known, and naming it is a slope plus a die | Name reserve × (1 + markup from askPremium) when the bid is inside the owner's tolerance band (from attachment). Otherwise walk | low | FIXED (blind: name within OWNER_ROOM, walk past two rooms or on the third bid) |
| actions.ts:1904-1910, 2033-2053 (REFUSE_BASE 0.26 at 1882) | minmax + roll | Whether a private owner refuses to talk at all (clamp [0.02,0.92]) | FAKE | Base 0.26 is asserted. The modifiers are re-expressed old additive terms (`0.449`, `0.46`, `0.81` …) | Refuse iff the holder's reserve (with attachment premium) is above k × value, or use the readiness hazard (owners.ts EXIT_HAZARD, sourced) as the probability that they sell at all | med | STILL |
| actions.ts:1916, 2106-2107 | roll | Owner's sale premium `1.06+0.5·u²` (land 1.0+0.15·u²) + pressure terms; stressed `−rrange(0.16,0.30)` | FAKE | No source for the premium. The distribution is chosen | Build it from seller transaction costs, tax on the gain (basis or a `since` proxy), and askPremium. Stress = the owner's debt and liquidity need, not a die | med | STILL |
| actions.ts:1921, 2110 (DREAM_MAX 1.5 at 1809, BLIND_LICENCE 0.6 at 1818, u³) | roll | Tail of the private owner's reserve ("dream" premium) | FAKE | Stated as a judgement, not a measurement. It sets the median blind reserve near 1.57× appraisal (comment at 2247) | Size it from the measured dispersion only (OPINION_SD 0.16, sourced). Drop the cubed tail or source it | med | STILL |
| actions.ts:3730 | roll | Broker-pitch ask for a private holder: `value·rrange(0.84−0.06d, 0.92−0.02d)` + 0.07 idle | FAKE | A second answer for what a private owner wants; `ownerAnswersCall` is the owner model (fake type 3) | Price the pitch with `ownerAnswersCall`. The broker rings only if that reserve is under value | med | STILL |
| actions.ts:3602 (QUIETER 0.25), 3609-3612 | constant + roll | Rate of off-market broker calls, then a roll against it | FAKE | A game-design dial ("four times quieter, by request") and a coin | Call rate = holder exit/readiness hazard × the off-market share of exits (sourced), on an accumulator like the other arrival paths | low | STILL |
| actions.ts:3004-3043 | roll | Unsolicited-offer multipliers: assembler land 1.22-1.55, assembler building 1.12-1.34, collector 1.04-1.16, opportunist 0.84-0.96 / 0.98-1.14 | FAKE | Asserted premium bands | Assembler: residual of the merged site (`planDevelopment`) less its current holding. Collector or opportunist: its `firmMaxPrice` | med | STILL |
| actions.ts:3923-3930, 3944 | roll | Unsolicited approach rate `(0.0006+0.0014·hot)·credit·…`, and price `v·mult·rrange(0.86+0.14h, 0.98+0.12h)` | FAKE | The timing is now an accumulator (no coin), but the rate is still asserted and the price is still a die | The rivals' own buy logic. A firm whose `maxPrice` beats value by its hurdle makes the call, at its number | low | CHANGED |
| actions.ts:3899 | constant | Assembler holdout premium `1.15+0.5·(1−discipline)` | FAKE | The 5% coin is gone (it rings once, when it can close, 3907). The premium is still asserted | The assembler's marginal site value from `planDevelopment`, capped by its hurdle | low | CHANGED |
| actions.ts:3831-3832 | roll | Buyer's reservation when the player counters an offer: `value·stretch·rrange(0.97,1.05)`, stretch from cycle and credit | FAKE | Asserted stretch plus a die | The offering firm's walk-away (`walkAwayToday`, as for bids) | low | STILL |
| actions.ts:4126-4135 | minmax + roll | Player quiet listing: arrival `p = clamp((0.55−0.42·ratio)·appetite + stale, 0.01, 0.5)`; bid `value·(0.9+0.13u)` | FAKE | Arrival is now an accumulator, but the rate formula and its rails are asserted, and the price is a die. The marketed path (2697) already asks real firms | Run `roomForYourSale` / `bidRound` monthly on the quiet listing too. A call comes when a firm's walk-away clears the ask | med | CHANGED |
| actions.ts:2690-2694, 2720-2726 | minmax + roll | Marketed sale: bidder count `3.4·phase·max(0.3,appetite)·max(0.25,2.1−ratio)`, cap 6; bids `value·(0.88+0.16·u·…)`; credibility die | FAKE (fallback) | The main path is now real: `roomForYourSale` bids from named firms (2697-2709), with credibility from leverage need. The dice branch runs only when `roomForYourSale` returns null (ground-leased, actions.ts:2612) | Give ground-leased sales a room too (a leasehold `bidRound`), then delete the fallback | low | CHANGED |
| actions.ts:2867 | roll | Best-and-final bump `1+rrange(0.005,0.035)·credibility` | FAKE | The walk is now deterministic (`walkAwayToday`), and the raise is still a die | Raise to min(walk, the price that beats the runner-up's walk). A second-price step | low | CHANGED |
| actions.ts:1471 | minmax | Ground-lease taker arrival `min(0.14, (0.006+0.075·demand·climate)·takeMult)` | FAKE | The coin became an accumulator. The asserted rate and its 0.14 cap remain (the owner's own example of an odds cap) | Arrival = a developer's residual under the lease beating the capitalised ground rent | med | CHANGED |
| actions.ts:1145-1160 | constant | Which ground-lessee use turns up: step weights by FAR and demand | FAKE | Asserted weights | Weight each use by its residual on this lot (highest and best use) | low | STILL |
| actions.ts:1015, 1433 | minmax | Ground-rent yield `max(3.2, 0.62·indexRate+2.5)` | FAKE | An asserted yield formula with a floor | Land cap from the capital-market law less a seniority/term spread, sourced | low | STILL |
| propmarket.ts:737-741 via actions.ts:584, 4228, 4249; re-ask actions.ts:4238, 4254 | minmax | Tape seller reserve when no reserve is stamped: 0.92×ask (0.88 for a lender sale); re-ask `max(reserve, 0.95·ask, 1.04·bestBid)` | FAKE | Named-firm and holder listings now carry a computed `reserve`. The fallback share and the re-ask speed are still asserted | Stamp a reserve on every listing from its seller's own model. The re-ask is the seller updating on the observed bid (partial adjustment, documented) | med | CHANGED |
| leasing.ts:4570-4587 / 5246-5303 | clamp + roll | Whether a tenant accepts the player's counter: logit on `fStar` with W = 0.085, clamp [0.005, 0.95] (+0.05 on best-and-final) | FAKE | Each counter is a fresh die on the same tenant. The tenant now has a real bid from its options (`offerForPlayer`), and acceptance still ignores it | Accept iff the NE ask ≤ the firm's reservation (its `bidCeiling` from the same option set), drawn or computed once per LOI. The player stays uncertain; the tenant does not | med | STILL |
| leasing.ts:4588 / 5339 | minmax + roll | Tenant walks after a rejected counter: `0.24+(f−1)·2.2` clamp [0.15,0.92] | FAKE | An asserted slope with rails | Walk iff the ask exceeds the reservation by more than its search cost. Otherwise it counters at its reservation | med | STILL |
| leasing.ts:4600 / 5366 | roll | Tenant's counter-back rent `max(open·0.94, market·(0.95+0.04·rng))` | FAKE | A die sets the counter | Counter at its reservation | low | STILL |
| leasing.ts:3494 (RENEWAL_STICK 0.06), 3501-3509 | constant | Incumbent's premium tolerance; `tenantIndifferenceMult` (+0.35·tight, −0.12·soft, +0.015·credit) | FAKE | The comment says it was cut from 10 to 6 points "to cut the exploit" (type 1/4) | Derive it from the incumbent's real moving cost (`MOVE_PSF` + downtime + lost fit-out) over rent × term | low | STILL |
| leasing.ts:1885-1886 | constant | Relief ask size: askPsf = rent × (0.85 or 0.90); extension 24+24·…+24·… months | FAKE | Whether to ask is now decided by the books (1870-1877, no coin). The size is still asserted | The ask is the rent cut that brings cover back to its covenant target, from `tenantFin` | low | CHANGED |
| leasing.ts:1932 | clamp + roll | Player-tenant headcount `staff·(1+mom·1.6+rrange(±0.004))` clamp [0.40, 2.6] | FAKE | Two answers: street firms use `sqrt(emp/prev)·…·exp(0.7·dz)` with guard [0.05, 60] (streetRolls.ts:1051) | Use the streetRolls headcount law for player tenants. Drop the jitter | med | STILL |
| leasing.ts:1474 (+1455-1473) | roll + shape | Player multifamily occupancy: turnover now `flatTurnover(e)` (the town's own), plus `rrange(±0.002)` jitter; movers include `0.055·(pool−occ)`; weight `askRatio^−3`, quality floor 0.3 | FAKE | The flat 0.45 turnover is gone. The jitter means nothing, and the 0.055 / −3 / 0.3 are unsourced shape terms. The street's flats use the households register (streetRolls.ts:2168-2173): still two models | Put the player's flats on the streetRolls flat roll (households' choice). Delete the jitter | med | CHANGED |
| leasing.ts:2167, 2172, 3392-3398 | roll + constant | Renewal free rent `round(0.5·concessionPressure²)` months; renewal escalator `bumpOf + rrange(−0.5,0.25)`; new-letter escalator = the band middle by credit (2.0/2.5/2.875) | FAKE | The renewal free-rent die is now its expected value, which is still an asserted formula. The renewal bump noise is still a die. The new-letter bands are labelled "old asserted convention, unchanged" | Bump = expected inflation (`inflExp`) + a real-growth share, less a credit discount sized from data. Renewal free rent from the NE identity | low | CHANGED |
| leasing.ts:860-861 | roll + clamp | Occupancy of an acquired building's flats with no flat roll: `useOccupancy + rrange(−0.38,−0.16)` if distressed, else `rrange(−0.05,0.04)`; clamp [0.12, 0.99] | FAKE | The commercial side now inherits the street roll (856-870). The flats fallback is still a die offset from the city average | Ensure every block has a flat roll (streetRolls) before it can be bought. Distress = the seller's actual occupancy | low | CHANGED |
| leasing.ts:1023 | roll | Construction anchor rent `market·discount·rrange(0.9,0.97)` | FAKE | Covenant (size, 1013) and term (`chosenTermM`, 1033) are now computed. The rent band is still a die | The anchor discount = the landlord's NPV of delivery risk taken off it plus the anchor's draw on the other suites, solved | low | CHANGED |
| leasing.ts:2342-2345 | constant | New-letter term multipliers: ×1.15 for suites over 2.5× typical, `max(0.8, 1−5·labourSlack)` | FAKE | Asserted adjustments on top of the firm's `chosenTermM` | Put size and slack into `chosenTermM`'s growth/option-value term, or source them | low | NEW |
| streetRolls.ts:2180-2184, 2177 | clamp | Multifamily renewal: `pRenew clamp [0.1,0.9]`; renewal rent floor `max(rent·0.97, ask)`; sitting-tenant ask ×0.97 | FAKE (partial) | Move-out now comes from the households register, and the 0.8 elasticity is gone. The 97% floor still stops renewal rents falling more than 3% in a bust (load-bearing), and the 0.97 discount is unsourced | Renewal rent = the ask with no floor (the household already chose against it). Source the sitting-tenant discount | med | CHANGED |
| streetRolls.ts:2181 | roll | Cohort stay `pRenew·rrange(0.85,1.15)` | FAKE | ±15% uniform on a cohort mean, not binomial noise | Binomial on units, or no noise | low | STILL |
| streetRolls.ts:1497-1500, 1492 | roll | New firm's quality: 50% coin to copy a vacant suite's score ±4; otherwise drawn ±6 | FAKE (minor) | A coin inside formation | Draw quality from a stated distribution once (EXOGENOUS), or set it from the firm's trade | low | NEW |
| streetRolls.ts:777 | clamp | A firm's bid for player space, `clamp(rMax/postEff, 0.4, 1)` | FAKE (if binding) | The 1 is a definition (it never offers over the post). The 0.4 floor is an unsourced rail | Measure the bind rate. If it binds, let the firm walk instead | low | NEW |
| streetRolls.ts:668, 681, 833; tenantMarket.ts:268 (KEEN_POW 3) | constant + clamp | The broker's shortlist weight `(mkt/post)^3`, capped at 4, for shops and sheds | FAKE | Marked unsourced [K] in its own comment ("the cube of the old stale-space weight") | Drop it for shops and sheds as was done for office, and let price act once through `TASTE` and the firm's choice | low | NEW |
| streetRolls.ts:1089, 1141, 1165, 1194, 1212 | constant | Outgrown thresholds: need > 1.25×sf (at expiry), > 1.5×sf and staff > 1.5× signing (mid-lease) | FAKE (minor) | They replace monthly dice (good). The thresholds are [K] | Act when the firm's `value` in its own suite at its need falls below its best option net of moving | low | NEW |
| tenantMarket.ts:222-225, 246-248, 505 | constant | Landlord ask learning: PKG_TAKE 0.03, RAISE 0.06, STRESS_MOVE 1.5, STRESS_RES 0.96, PKG_STEP 0.01, LET_MEMORY 20 [K]; reservation floor `max(0.4, 1−wait/term)` | FAKE (shape) | These set how fast street rents move. Several are tagged [K] (judgement), not fitted or sourced. The ±0.2 monthly step clamp (463, 543) is a guard | Source the speeds (asking-rent adjustment speed vs months of supply: Wheaton-Torto estimates), or fit them and say so | med | NEW |
| notes.ts:100-104, used at 129, 185, 719, 812 | clamp | The cure probability that prices every note, clamp [0.03, 0.85] | FAKE | Borrower *decisions* now read the building (notes.ts:274-380). The *price* of a note still uses the old linear score of asserted weights | Price the note from the same building-level test the borrower uses (`markAsset`, refinance proceeds, funds) | med | STILL |
| notes.ts:127 | clamp | Performing note fair value `0.70+0.30·min(1,cover/1.15)` clamp [0.55, 1] | FAKE | An asserted bond price | DCF of coupon + face at the market yield for that LTV/DSCR (BANKING.md price law) less expected loss | med | STILL |
| notes.ts:761, 785-787, 801 | roll | Which loan a desk offers as non-performing: a random stressed firm, then a random building that may be current or held by another lender; synthetic face `clean·min(1.4, debt/aum)` when no row | FAKE | A loan can still be labelled defaulted when its row is current, and the face is invented when no row exists | Offer only rows with `arrearsMs ≥ 3` held by this desk. Face = row balance | med | STILL |
| notes.ts:808-809 | roll | Synthetic note coupon `indexRate + rrange(1.6, 3.2)`; maturity `rrange(6,84)` | FAKE | A random spread, not the price law | Spread from the lender price law (BANKING.md) for that LTV and borrower | low | STILL |
| notes.ts:739-743 | constant | Whether a desk sells paper: NPL if delinquency > 2.8%, performing if pressure > 0.22 | FAKE (partial) | The three coins are gone. The thresholds are asserted | Sell when the capital charge on holding exceeds the bid–hold gap | low | CHANGED |
| notes.ts:1019, 1032 | minmax | DPO and loan-sale pricing `(0.98−0.26p)·(1.04−0.10p)`, 1.35 × paid | FAKE | Asserted price formulas | The lender's NPV of foreclosure against a payoff. The DPO is the indifference price | low | STILL |
| notes.ts:354, 374 | constant | Payoff = face × 1.02 + arrears | FAKE (minor) | An asserted prepayment premium | The note's own prepayment clause (debt.ts prepay penalty) | low | NEW |
| auction.ts:112, 163, 217, 251, 272, 584; notes.ts:86 | clamp | Collateral occupancy = the firm-wide `r.occ` clamped [0.15, 0.95] | FAKE | Uses the firm's average for one building, though the building's street roll exists. It now feeds the deterministic reinstatement and filing tests (112, 163), so it matters more | Read this building's roll occupancy (`econ.streetRolls[bbl]`) | low | STILL |
| auction.ts:274, 279 | minmax | Receiver debt share `min(0.95·asIs, debt·asIs/aum or 0.8·asIs)`, upset 0.55·asIs | FAKE | An asserted floor and debt allocation | Debt = the loan row on the building. Upset = a stated court rule | low | STILL |
| auction.ts:101 | constant | Cure = 8% of debt, which now drives the deterministic reinstatement | FAKE (minor) | An arrears approximation where the row's arrears exist | The row's actual arrears + legal | low | CHANGED |
| auction.ts:409 | constant | A bank's credit bid at its own foreclosure: `debt·(1−0.35·lenderPressure)` | FAKE (minor) | An asserted haircut slope | The desk's NPV of owning REO (value × its reoAsk path − carry) against cash | low | NEW |
| auction.ts:638 | roll | REO relist ask `est·rrange(0.78,0.90)` | FAKE | A die | The REO desk's `reoAsk` (lenders.ts), as for bank-sale listings | low | STILL |
| auction.ts:298; notes.ts:520 | constant | Equity 35% on rival auction and note buys | FAKE (minor) | Asserted LTV | The buyer's desk sizing (`dealView`) | low | STILL |
| offmarket.ts:154, 158 | minmax | Meet the reserve if bid ≥ 0.9·reserve; fish if max < 0.8·reserve | FAKE (minor) | Asserted thresholds | Meet iff reserve ≤ max (as the quoted branch does) | low | STILL |
| offmarket.ts:160 | roll | Holder cold period after a low counter `rrange(24,60)` | FAKE | Ignores the holder's `memory` trait, which `offend()` already uses | Call `offend()` | low | STILL |
| offmarket.ts:123 | minmax | Affordability gate `max > aum·0.6 + cash·4` | FAKE (minor) | An asserted capacity rule | `affordable` / `rivalCanClose` (already used elsewhere) | low | STILL |
| owners.ts:844 | minmax | An exiting holder lists at most 6 buildings at once | FAKE (minor) | An asserted tranche cap | Tranche size from price impact against bid depth | low | STILL |
| owners.ts:619 | clamp | `relMult` clamp [0.72, 1.9] | FAKE (minor) | The lower rail binds at 4 or more clean deals | A saturating form, e.g. exp(−k·deals) | low | STILL |
| owners.ts:863 | roll | Probate / dissolution lead `3+floor(rng·4)` months | FAKE (minor) | Who hears first is now deterministic by exit kind (855-862). The lead is a die | That process's stated duration (cite probate timelines) | low | CHANGED |
| | | | | | | | |
| streetRolls.ts:1066 / leasing.ts:1726; tenantBooks.ts:464 | roll | Tenant failure: `tenantInsolvent(books)` (deterministic), or `rng < BACKGROUND_FAIL[credit]` (2/4/8 per 100k firm-months) | EXOGENOUS | Failure is now decided by the firm's books. The residual coin is "what no set of books sees coming — fraud, a death". It is unsourced and should cite a rate | — | — | CHANGED |
| streetRolls.ts:588, 699, 772; tenantMarket.ts:158 (TASTE) | roll | Random-utility taste (Gumbel) on each option a firm weighs | EXOGENOUS | Idiosyncratic preference in a discrete-choice model, the allowed kind. TASTE is stated as fitted to renewal-rate facts [K]. Keep it from becoming a fitted-to-output dial | — | — | NEW |
| streetRolls.ts:1130, 115 (SHED_MOVE 0.3) | roll | A shed tenant at expiry relocates within the region | EXOGENOUS | The off-map region is not modelled building by building. The destination is now a flow (no die), but the 0.3 share has no source in its comment | — (source the share) | — | NEW |
| streetRolls.ts:1490-1504, 1521, 2248 | roll | New firm's size and sector, stochastic rounding of the last firm, seeker shuffle, weighted flat choice | EXOGENOUS / GUARD | Which firm turns up. The weights are computed | — | — | STILL |
| streetRolls.ts:2142 | roll | Back-filled flat lease rents for old saves `rrange(0.93,1.01)` | GUARD | Save-migration only | — | — | STILL |
| streetRolls.ts:1051 | clamp | Street headcount [0.05, 60] | GUARD | Wide; never binds | — | — | STILL |
| streetRolls.ts:223 | minmax | `max(0.2, …)` on the demand raw index | GUARD | Divide-by-zero protection | — | — | STILL |
| streetRolls.ts:471, 695-707, 837-838, 2133, 2235, 2250 | minmax | Available sf ≥ 0, take ≤ avail, occ ≤ cap, take ≤ unit·4 / lim | PHYSICAL | Cannot let more than exists. MF_LEASEUP is sourced | — | — | STILL |
| streetRolls.ts:2173 | minmax | Renter move-out = households register (`flatLeaseMove`), cap 0.85 | EXOGENOUS | The migration / buy / jobs / family components moved into households.ts. The 0.85 cap should be a guard; check it does not bind | — | — | CHANGED |
| streetRolls.ts:2405-2406 | clamp | cityVac / streetVac clamp [0, 0.45] | GUARD (watch) | It used to run only at the opening. It now runs **every month**, so a 45% vacancy rail now applies in a deep glut. Measure the bind rate | — | — | CHANGED |
| leasing.ts:3428 | clamp | Term shift `clamp(exp(−4g), 0.6, 1.4)` in `chosenTermM` | EXOGENOUS/shape | Grenadier-cited shape (moved from streetRolls). State whether −4 and the rails are calibrated | — | — | CHANGED |
| leasing.ts:95-101 | constant | Lease basis (recovery) by class: office base-year, MF gross, else NNN | PHYSICAL | No longer a roll. A stated market convention (owner, 2026-11-18) | — | — | CHANGED |
| leasing.ts:223-254 | roll | Sector and name of a prospect, weighted by industryPull | EXOGENOUS | Which tenant turns up | — | — | STILL |
| leasing.ts:1637, 1762 | roll | Make-ready downtime `×rrange(0.7,1.4)` / `(6 or 4)·rrange(0.8,1.5)` | EXOGENOUS | Construction/permit duration variance. Should be sized from data | — | — | STILL |
| leasing.ts:2225-2330 | roll | Which firms tour: the street's shortlist put this building first (`playerTours`) | EXOGENOUS | The aggregate LOI-arrival law and the sub-suite rounding are gone. Who tours comes from the firms' own choice | — | — | CHANGED |
| leasing.ts:1176-1205 | clamp | concessionPressure `0.22+1.88·dial`; tiPressure floor 0.01 | GUARD | Maps one dial | — | — | STILL |
| leasing.ts:1089 | minmax | TI band `min(lo·costIdx, lo/base·rent)` | PHYSICAL | An allowance cannot exceed a rent-proportional share | — | — | STILL |
| leasing.ts:3527, 3579 | minmax | Free-rent bite on NE capped at 45% of term | GUARD | Documented anti-inversion guard | — | — | STILL |
| leasing.ts:3508 | clamp | Payroll growth term in tenant indifference [−0.06, 0.05] | GUARD | Check it does not bind in booms | — | — | STILL |
| leasing.ts:3767, 3924 | clamp | Plan NE target [0.6, 1.2]; clearing pct [0.5, 1] | GUARD | Named guards on UI and plan dials | — | — | STILL |
| leasing.ts:2171-2175, 3398 | clamp | Bump within [0, 5]% | PHYSICAL | Contractual range | — | — | STILL |
| leasing.ts (useVacantSf 945-950, vacantSf, notReadySf) | minmax | leased ≤ total, occ ≤ 1, sf ≥ 0, take ≤ vacant | PHYSICAL | Definitions | — | — | STILL |
| leasing.ts:860, 1474 (0.99) | clamp | Occupancy ≤ 0.99 | PHYSICAL | Friction ("never quite full") | — | — | STILL |
| leasing.ts:3174, 3217 | minmax | Legal fee floor $8,000 | EXOGENOUS | A real-world minimum fee | — | — | STILL |
| leasing.ts:3191, 4867, 4911 | minmax | Staff ≤ 1.05 / 1 after a resize | GUARD | Re-baselines headcount | — | — | STILL |
| tenantMarket.ts:797 | constant | The street bargain splits the surplus 50/50 between the landlord's reservation and the firm's ceiling | EXOGENOUS/shape | A symmetric Nash bargain, stated. A bargaining-power term (vacancy gap) would make it a mechanism | — | — | NEW |
| tenantMarket.ts:85 (MOVE_PSF), 88 (SHORTLIST 6) | constant | Moving cost $/sf; tour-book length | EXOGENOUS | [S~] / [K] sourced in comment | — | — | NEW |
| actions.ts:1684-1694 | roll | `gauss` (Box-Muller); valuation age ~ exponential (mean VALUATION_AGE_M) | EXOGENOUS | A fact about the owner. Means stated | — | — | STILL |
| actions.ts:1770, 1775 (OPINION_SD 0.16) | roll | Owner's private valuation noise | EXOGENOUS | Sourced (Goodman & Ittner 1992) | — | — | STILL |
| actions.ts:1768-1769 (ANCHOR_STICKY) | constant | Asymmetric anchoring 0.38 / 0.25 | EXOGENOUS | 0.38 sourced (Genesove & Mayer 2001). 0.25 still unsourced | — | — | STILL |
| actions.ts:1918-1920 / 2108-2110 (QUOTE_HALF_M 60 at 1796) | constant | Whether the owner names a number | EXOGENOUS | No longer a coin: names a number iff the valuation is younger than QUOTE_HALF_M. Stated judgement | — | — | CHANGED |
| actions.ts:1827 (OWNER_FLOOR 0.80) | minmax | Owner's reserve ≥ 0.8 × value | GUARD | Better as the actual `assessed` value it cites | — | — | STILL |
| actions.ts:1846-1876 (DOOR_MIN/MAX) | clamp | Cold period after a refusal | EXOGENOUS/shape | Honestly labelled shape | — | — | STILL |
| actions.ts:1164, 1210 | roll | Ground-lessee pick given weights; build months within BUILD_MONTHS | EXOGENOUS | Which lessee; duration variance | — | — | STILL |
| actions.ts:1604, 1633 | roll | Ground-lease default via `newsChance` at `groundDefaultOdds` | EXOGENOUS | Hazard computed elsewhere; isolated stream | — | — | STILL |
| actions.ts:2510 | roll | Marketing period 2-4 weeks | EXOGENOUS | Process timing | — | — | STILL |
| actions.ts:2750, 3039, 3673, 4141 | roll | Which named firm calls; which building a broker rings about | EXOGENOUS | Identity of who turns up | — | — | STILL |
| propmarket.ts (bidRound) | roll | Tape bidder valuation | EXOGENOUS | The tape now runs `bidRound`: each firm underwrites on its own capital (out of this file set; audit there) | — | — | CHANGED |
| actions.ts:155-156, 1019-1026, 1233, 2946-2947, 3575 area | minmax | Basis, rent ≥ 0, floors ≤ zoning cap, recapture split, equity ≥ 0 | PHYSICAL | Definitions and law | — | — | STILL |
| actions.ts:1428 | clamp | CPI review collar [2%, 4%] | PHYSICAL | A contractual collar | — | — | STILL |
| actions.ts (FMV review ratchet) | minmax | Never cuts | PHYSICAL | A contract term | — | — | STILL |
| auction.ts:269, 328; notes.ts:481, 707 | roll | Which row, building or tenant is picked | EXOGENOUS | Identity | — | — | STILL |
| auction.ts:202 | roll | Flyer estimate `asIs·rrange(0.92,1.08)` | EXOGENOUS | Drive-by appraisal error. Should cite appraisal-error data | — | — | STILL |
| auction.ts:644; notes.ts:526, 592, 721, 814, 907, 943 | roll | Listing or offer windows; foreclosure duration FILE_MIN/MAX_M; modification maturity 24-36 | EXOGENOUS | Process timing. FILE_MIN/MAX should cite state timelines | — | — | STILL |
| notes.ts:339 | minmax | Arrears capped at 24 months of coupon | PHYSICAL | Stated legal limit; cite it | — | — | STILL |
| notes.ts:127, 148 | clamp | noteFair [0.55/0.08, 1.0], ask [0.08, 1.02] | GUARD | Bounds on a price share (formulas flagged above) | — | — | STILL |
| notes.ts (recovery ≤ face + arrears; cash ≥ 0; face ≥ 0) | minmax | Definitions | PHYSICAL | — | — | — | STILL |
| auction.ts (owed ≥ 0, surplus ≥ 0, shortfall split) | minmax | Waterfall definitions | PHYSICAL | — | — | — | STILL |
| offmarket.ts:93-98, 110 | roll | Firm call rate (`CALLS_MO`·appetite·…, cap 0.9) on an accumulator; which lot | EXOGENOUS | The coin became an accumulator. CALLS_MO should name its source. The 0.9 cap is a guard | — | — | CHANGED |
| offmarket.ts:152; propmarket.ts:118 (SHADE 0.10) | constant | A firm's opening "make me an offer" bid = max × (1 − SHADE) | EXOGENOUS/shape | No longer a die. A lone-bidder shade, stated as a shape parameter | — | — | CHANGED |
| offmarket.ts:91, 99 | minmax | `max(0.05, cyc)`, `max(2, doors)` | GUARD | Degenerate-input guards | — | — | STILL |
| owners.ts:223-231 | minmax | Holder counts by town size | PHYSICAL | Town generation | — | — | STILL |
| owners.ts:248-270, 405-427 | roll (hash) | Holder identity, kind, founding, tier; which holder owns a deed | EXOGENOUS | Register generation | — | — | STILL |
| owners.ts:495 | clamp | Holder traits ±25 around the kind centre, [1, 100] | EXOGENOUS | Personality draw | — | — | STILL |
| owners.ts:737, 746 (EXIT_HAZARD) | roll | Which major holder is tested; whether it exits | EXOGENOUS | Stated demographic hazards | — | — | STILL |
| owners.ts:794 | roll | An heir keeps the book (estate 0.35 / partnership 0.25) | EXOGENOUS | Should be sourced | — | — | STILL |
| owners.ts:822 | roll | Void draw to keep the stream aligned | GUARD | Stream discipline | — | — | STILL |
| owners.ts (coldUntil = max(existing, new)) | minmax | Definition | PHYSICAL | — | — | — | STILL |

## Summary

**Status counts** (one table row can group several lines). Old rows: **STILL 78, CHANGED 28, GONE 40** (36 fake, 4 non-fake). A few old rows were merged into one. **NEW 13**.
- Of the first pass's 89 FAKE rows: 34 STILL, 18 CHANGED (still fake in part), 36 GONE; one was merged.
- FAKE rows now open, including 9 NEW: 61 (high 5, med 19, low 37).

**Are tenant and seller acceptance still re-rolled probabilities?**
- **Listed sellers: no.** A bid on a listing is accepted iff it clears `listingReserve` and no firm in this month's `bidRound` bids more (actions.ts:584-591). The seller reads one offer a month.
- **Off-market owners: yes.** `ownerAnswersCall` computes a reserve, and then:
  - acceptance against a named ask is a slope plus a roll (actions.ts:2327-2329);
  - counters are a three-way roll (2407-2423);
  - blind bids roll on whether the owner names a number (2244-2258).
- **Tenants: yes.** A counter is still a fresh logit roll on `fStar` each time (leasing.ts:4572-4587, 5270-5303), with a rolled walk (4588 / 5339) and a rolled counter-back (4600 / 5366). This is true even though the tenant's opening bid now comes from its own options (`offerForPlayer`).
- **Renewals: yes.** A renewal is a roll on `renewalIntent` (leasing.ts:2069).

**What changed most.**
- The street is now a bargaining market (tenantMarket.ts). Street rent, free rent, move/stay, exit and term are solved, not rolled.
- The player's tenants open from the same option set.
- The city tape runs a real `bidRound` on every listing every month. The arrival coin, the phantom bidder, the 0.22 distress rule and the rival overbid die are gone.
- In notes and auctions, borrower and lender decisions read the building and the desk.
- What remains fake in this file set is mostly:
  1. the player-side concessions (TI and free rent);
  2. the player-side negotiation dice (tenant counters, off-market owners);
  3. renewal odds and renewal rent;
  4. secondary price bands (unsolicited offers, broker pitch, REO relist, note pricing).

**Top 5 remaining fakes**
1. **TI and free rent on player letters are dice.** TI is at leasing.ts:2433, 2028 and 2162; free rent is at leasing.ts:2443. The street solves free months from NE (`freeMonthsFor`) and the player's letters do not, so the same quantity has two answers.
2. **Renewal odds (leasing.ts:1250-1299, rolled at 2069).** The street comparison sits underneath. On top of it are six asserted factors, a [0.10, 0.96] rail and a roll. `fFull` and `fStrain` are computed but never applied to `p`.
3. **Off-market owner acceptance and counters against a known reserve.** These are actions.ts:2327, 2407-2423 and 2244-2258. Listed sellers became deterministic and private owners did not.
4. **Tenant counter acceptance, walk and counter-back are re-rolled** (leasing.ts:4572-4600, 5270-5366), even though the tenant's reservation can now be computed from its options.
5. **Renewal rent multipliers** (leasing.ts:2097-2106, 2136) and the expansion-rent die (2019). Behind them is a cluster of asserted owner-reserve terms: refusal base 0.26, premium u² and the dream u³ tail (actions.ts:1882-1921).

**Risk notes carried forward.**
- Moving the player's concessions to the NE identity will shift player NOI. Run `pnpm baseline:check` and conserve.
- The cityVac/streetVac [0, 0.45] clamp now runs every month (streetRolls.ts:2405-2406). Count its bind rate.

## Fixed since the first pass (GONE)

- streetRolls.ts:619 street lease rent `rrange(0.94,1.03)`. Now the bargain: tenantMarket.ts:797 `bargain`, applied at streetRolls.ts:947.
- streetRolls.ts:631 street free rent `·rng()`. Now the NE identity (`freeMonthsFor`, tenantMarket.ts:848; streetRolls.ts:949).
- leasing.ts:2275 the touring tenant's two-dice opening bid. Now `offerForPlayer` from the firm's options (leasing.ts:2362).
- leasing.ts:2262 the covenant/growth tour-party discount and premium. Each party is a real firm with its own covenant.
- leasing.ts:2229 the tour-party count. The party is now the firms that chose this space.
- leasing.ts:2267 / 2010 the term dice. Now `chosenTermM` (leasing.ts:3424).
- leasing.ts:1830 the covenant upgrade/downgrade coins. Now a deterministic grade from size and books (1921-1928).
- leasing.ts:816-820 the generated-roll in-place rents, stops and startM. The commercial roll is inherited from the street roll.
- leasing.ts:851 the `streetNewTenant` dice (dead code, removed).
- leasing.ts:971-977 the anchor covenant coin and term (the anchor's rent band remains; see table).
- leasing.ts:17 `vacancyTight` hard-coded natural vacancies. Now the package dial (leasing.ts:42-46).
- leasing.ts:1784 the relief-ask timing coin. Now the books decide (the ask size remains).
- streetRolls.ts:340-346 the MOVE_BASE +0.25 / 0.85 move bumps. Now `shop` versus stay, net of moving.
- streetRolls.ts:333 exit `EXIT_BASE·ratio^4` with rails. Now a participation test (streetRolls.ts:1138-1145).
- streetRolls.ts:351 the outgrown 3%/month coin. Now deterministic thresholds.
- streetRolls.ts:516 the entry multiplier cap 1.6 (streetRolls.ts:1443 now has no upper rail).
- actions.ts:3851-3895 the tape arrival coin, priceFactor clamp and appetite floor. Every listing goes to `bidRound` monthly; the draw is voided at actions.ts:4211.
- actions.ts:3907 the phantom bidder `max(1, min(5, qualifiedBuyers))`.
- actions.ts:3929 the distress "22% of the gap per bidder" rule. `contested` (4202) now only feeds the voided draw, so it is dead code.
- actions.ts:3897 the rival's `rrange(1.04,1.12)` overbid of the player's talk. The bid round must beat the player's number.
- actions.ts:585-640 the listed seller's `bidOdds` acceptance roll. Now deterministic (584-591).
- actions.ts:2806-2808 the retrade coin and cut. Now `walkAwayToday` (2911-2945).
- actions.ts:3773-3774 the "second bidder surfaced" coin.
- actions.ts:4233-4236 the bidder drop coins on an ask raise. Now each bidder's walk-away (4551-4557).
- actions.ts:3681 the holdout 5% coin (the premium remains).
- notes.ts:225 the note repayment coin. Now refinance or cash on the building's own books.
- notes.ts:240 the 9%/month performing-goes-bad coin.
- notes.ts:258-265 the reinstatement coins.
- notes.ts:296 the deed-in-lieu 3%/month coin.
- notes.ts:422 / 464 / 483 / 990 the firm-buys-paper coins. Now `paperWorth` against the ask.
- notes.ts:1065 the lender-sells-your-loan 3.5% coin. Now the desk's capital decides (notes.ts:1227).
- notes.ts:555 the receiver's 30% monthly coin. It now sells every month it has paper (notes.ts:693).
- auction.ts:245-251 the foreclosure room: dice heads, dice bids and the "fever" ×1.03-1.14. Now `bidRound` as an English auction (auction.ts:398-415).
- auction.ts:96 the 9% reinstatement coin. Now deterministic (cure versus equity).
- auction.ts:111 the 9% lender filing coin.
- offmarket.ts:184 the news coin on the economic stream.
- (Non-fake rows retired:) leasing.ts:126 `rollCredit` (credit now from size); leasing.ts:2135 LOI arrival roll; leasing.ts:2256 `drawTenantQuality`; streetRolls.ts:577 the seeker tour coin (now SEARCH_M months, deterministic).
