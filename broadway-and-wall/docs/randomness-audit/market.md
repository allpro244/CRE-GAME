# Fake-number audit: market.ts, regime.ts, demand.ts, absorption.ts, growth.ts, towngrowth.ts, bands.ts

Verified against main at c75ef8b (#838) plus the opening-dearness change, 2026-11-20.

Read-only re-check of the first pass against broadway-and-wall/CLAUDE.md "NO FAKE NUMBERS". Paths are relative to `broadway-and-wall/src/engine/`. Line numbers are from the working tree, which is mid-merge of `main` (MERGE_HEAD c75ef8b): `market.ts` is the merged file with the opening-dearness change in it. Nothing was run. "Binds?" claims come from the code's own comments or from arithmetic.

Status: **STILL** = the same fake/draw is in the code (new file:line given); **CHANGED** = still there in a different form (described); **NEW** = not in the first pass. Rows that are gone are listed at the end.

Much of the old market.ts has left this file set. Rents for office, retail and sheds are now read off signed leases (`filteredReadOut`, market.ts:4924-4950), flats off block landlords (streetRolls.ts), caps and land off trades (propmarket.ts `tickCapRead`/`tickLandRead`), jobs, migration and the regional/industry shocks off the household and firm registers (economy.ts, households.ts). **Those files were not part of this audit** and the fakes and draws that moved into them have not been re-checked.

Randomness enters through `mulberry32Step` (market.ts:27), `rng()`/`rrange()` (market.ts:87-), `rrng`/`d()` (regime.ts:55,136), seed-hashed Box-Muller (market.ts:1417 `openingPriceLevel`, 2018, 2304, 2364), `hash01`/`hashNormal` (demand.ts:425, growth.ts:195-203, value.ts:1257) and `newsChance` (news only).

## FAKE (sorted by severity)

| file:line | kind | what quantity it decides | bucket | why | proposed replacement mechanism | severity | Status |
|---|---|---|---|---|---|---|---|
| demand.ts findPoles (formerly POLE_DRIFT_SD, POLE_NOISE_SD, POLE_CAP; findPoles draws; tickPoles monthly Box-Muller) | — | where the town centres are | REMOVED | 2026-11-21: tickPoles, its drift/noise draws and the ±16 cap are deleted. The centres are found once from the demand anchor (baseD local maxima, ≤4, ≥420 m apart, r 340 m [K]) with no draws, at level 0; a centre's level is derived each month from the anchors standing on it (blackswans.ts settlePoles). | Agglomeration via the density feedback in `tickDemand`, plus anchors. | — | FIXED |
| market.ts:1790 (creditTarget clamp 0.4..1.25), 1792 (creditIdx clamp 0.4..1.25 + `rrange(-0.012, 0.012)`) | clamp + roll | the local credit window: construction terms, lender appetite, term premium inputs | FAKE | Comment at 1776 still says a deep recession "reaches the 0.4 floor", so the floor is load-bearing by design. The ±1.2-point monthly die is unsourced. The national window (3129-3131) lost its die but keeps the same 0.4..1.25 clamp. | Credit supply from lender balance sheets (lenders.ts capital ÷ required capital, losses from the actual book), SLOOS-style tightening on the unemployment rise. No floor but 0, no die. | high | STILL (national window CHANGED: no die) |
| regime.ts:211-212 (`jitter = d(0.88, 1.12)`; pin to 2%-40%) | roll + clamp | opening vacancy of each class (persists for years) | FAKE | This is literally the example CLAUDE.md fake #6 names ("a vacancy level times d(0.88, 1.12)"). The 2%-40% pin is re-used by dev.ts:5910 `pastSpaceMarket`. | Opening vacancy from the pre-history: run the occupancy/absorption equation over the simulated national path against the map's stock and print what it leaves. | high | STILL |
| market.ts:4479-4480 (`poolTarget = min(targetRaw, housable + searchFringe)`), 4489 (25% bleed above housable×1.02) | minmax (cap on demand) | the looking pool, which drives absorption and the flats/offices' pressure | FAKE | CHANGED: the fringe is now Little's law (`tenantsInSearchSf`, market.ts:1047 = movers × search time), not a quarter of a vacancy norm, and the employment bleed `min(0.0015, excess×0.004)` is retired. The cap itself and the 25%/1.02 bleed remain: demand past housable+fringe is still deleted rather than priced. | Make the mainland a priced alternative (the region map has one): unhoused tenants choose island vs mainland on the rent gap; unmet demand stays in the pool until the location margin clears it. | med-high | CHANGED |
| market.ts:1698-1705 (opening `landIdx = clamp((rent/cost)^1.15, 0.05, 80)`), 1345 (`densityPriceScales` land = (rent/cost^0.35)^1.15) | asserted formula | the opening land texture level (and through value.ts the texture floor every lot is priced against) | FAKE | CHANGED: the monthly target/step and its die are gone (market.ts:5006-5013: the draw is voided and the level is read off trades in propmarket.ts `tickLandRead`). The asserted 1.15 exponent still sets the opening level the floor multiplies. | Open the land level from the opening residuals and the first land survey, not from an exponent. | med | CHANGED |
| market.ts:639 (stock floor `max(150_000, total × 0.078)` per class) | minmax | the denominator of vacancy for thin classes | FAKE | Unchanged; the comment still says 7.8% was chosen to "reproduce today's behaviour exactly at standard size". | Model the mainland stock per class from the region map. | med | STILL |
| market.ts:4660-4661 (`absorb = clamp(…, ±3% occupied) + occupied × rrange(-0.0005, 0.0005)`) | roll | monthly absorption for the classes not on the street-firm path | FAKE | Unsized noise on occupancy. | Discrete arrivals (Poisson on the flow) from the tenant books, or drop the die. | med | STILL |
| absorption.ts:38 (`supportableOcc = clamp(0.985 - 0.75·max(0, pivot - d), 0.70, 0.985)`), read by leasing.ts:1282, 2008 | clamp + asserted line | the most a building can lease, by address | FAKE | CHANGED: absorption.ts is now ~90 lines (the leasing law moved to a firm-choice model, 2026-11-11) and the supportable factor clamp 0.03..1 is gone. The asserted occupancy ceiling remains and the leasing desk still reads it. | Let it fall out of firms' shortlist choice against the ask. | med | CHANGED |
| bands.ts:212, 234, 259 (band occupancy ceiling `stock × 0.985`) | clamp | how full each quality band can get | FAKE | An asserted 1.5% minimum vacancy per band, beside market.ts's residence-time vacancy (`betweenTenantsSf`): two answers. | Use the class's residence-time vacancy as each band's floor. | low-med | STILL |
| regime.ts:104 (`vacMultOf` clamp 0.65..1.8) | clamp | opening vacancy multiple | FAKE | A fitted line through 5 openings, then clamped; rail at the deep-recession end. Now also feeds `preVacMult` (regime.ts:193) and dev.ts `pastSpaceMarket`. | Same as the jitter row: simulate occupancy through the history. | med | STILL |
| market.ts:3408 (industryMom ±0.05), 392 (`industryPull = clamp(1 + 22·mom, 0.35, 1.9)`); 4360 (sectorMom ±0.02) | clamp | industry hiring pull and class momentum | FAKE (unverified binding) | CHANGED: sectorMom now only labels the class phase (4362), no longer moves caps. industryPull binds at the edges of ±0.05 and is read only by leasing.ts:247 (which trade walks in), so its reach is now "who", not "how much". | Measure rail-hit rates; replace with saturating forms or drop. | low-med | CHANGED |
| regime.ts:255-258 (inflTarget 1.2%-6%) | clamp | the drifting inflation target | FAKE | Unverified whether 6% binds. | Measure; if it binds, let the restore term carry it. | low | STILL |
| market.ts:3045-3046 (negative-rate cut kept only if `rng > exp((policy+step)/0.35)`) | roll | whether a below-zero cut is made | FAKE | A die decides a policy action. (A deterministic form of the same law already exists at 1887.) | Use the deterministic decay at 1887 here too. | low | STILL |
| market.ts:3915 (natTight clamp -0.06..0.055) | clamp | national wage growth | FAKE | The local path removed this clamp; the national keeps it. | Remove. | low | STILL |
| market.ts:1466 (`phaseMLeft = 12 + 30·rng(s)`, econ stream), 1594 (seed hash) | roll | phase clock | FAKE / vestigial | `phaseMLeft` still has no reader outside market.ts/types.ts; 1466 still consumes an econ draw. | Remove both in a stream-breaking commit. | low | STILL |
| regime.ts:219 (rent × `d(0.95, 1.05)`), 229 (cap `d(-0.2, 0.2)` voided) | roll | opening rents | FAKE | CHANGED: the cap die is now drawn and discarded ("CAP RATES ARE NOT SET HERE", propmarket.ts openingCapSurvey). The rent die stays; the q-solve in initEcon overwrites it whenever it converges. | Delete both draws. | low | CHANGED |
| towngrowth.ts:67, 280 (C_ODDS 0.8 rezoning coin); growth.ts:569 (`rng < entitleOdds`) | roll | rezoning and entitlement votes | EXOGENOUS-leaning, flag | CHANGED: the plan commission's 0.65 coin is gone; the council now votes on evidence (`bindingCount`, towngrowth.ts:376). The centre-rezoning coin (0.8, [K]) and the subdivision entitlement coin (landdev.ts:55 odds) remain. | Source the odds, or make them depend on the neighbours' stake. | low | CHANGED |
| market.ts:1417-1421 (`openingPriceLevel`: P = 0.45·exp(0.35 z)), applied 1604-1609 | roll (seeded Box-Muller) | the town's numeraire (all rents, costs, pay) | EXOGENOUS (numeraire), flag | CHANGED: only P is left of the old P/R/Q draws, and it is now applied before the q solve so it is neutral to `devPencils`. It is neutral only if no dollar constant is unscaled; the opening cheque is fixed in dollars (comment 1682-1683). | Keep as units; audit for unscaled $ constants. | low | CHANGED |
| market.ts:1395-1410 (`openingTobinQ`: ln q = Q_ELAST·ln(Q_V0/vacantShare), Q_V0 0.45, Q_ELAST 0.42; guard at 0.01) | asserted shape | the opening q of every class (replaces the R and Q draws) | shape parameter | Stated as calibrated to two anchors (Glaeser-Gyourko-Saks 2005, Saiz 2010), not to a game outcome. One q for every class: a town short of sheds and long of office opens the same. Q_ELAST was set so a Metropolis lands at 1.8, which is calibration to an anchor, not tuning. | Later: per-class q from each class's own pencil share and zoning headroom. | low | NEW |
| market.ts:1780 (`g12 = clamp(payrollGrowth12, -0.08, 0.04)`) | clamp | payroll input to the credit target | FAKE (suspect) | An asymmetric clamp on an input; unverified whether it binds. | Measure; drop if a guard. | low | NEW |
| demand.ts:1209 (SPILL_GAIN 1.5), 1220 (unhoused share capped at 0.5) | asserted shape + clamp | how far unhoused demand pushes the frontier ring outward | shape parameter | Stated "shape parameter … not calibrated to a city". | Calibrate against the bid-rent shift, or derive from households' location choice. | low | NEW |

## EXOGENOUS (keep; size and source noted)

| file:line | kind | what it decides | bucket | why / sizing status | severity | Status |
|---|---|---|---|---|---|---|
| regime.ts:137, 144, 145 | roll | r* anchor 0.4-3.2%, credibility (cubed skew), length of history | EXOGENOUS | Sourced (Laubach-Williams range). | med | STILL |
| regime.ts:258 / market.ts:2510 | roll | ±0.0175%/mo drift of the inflation target | EXOGENOUS | Tiny, unsourced. | low | STILL |
| market.ts:2017-2022 | roll | central bank chair resolve (lognormal 0.3), term, name | EXOGENOUS | Political. | low | STILL |
| market.ts:2304-2305 | roll | consumer and investment confidence shocks | EXOGENOUS | Sourced. | med | STILL |
| market.ts:2364-2366 | roll | rest-of-world output shock | EXOGENOUS | Sourced structure. | low | STILL |
| market.ts:2500-2505 | roll | neutral rate anchor and real walk | EXOGENOUS | Sourced; clamps ±Infinity. | low | STILL |
| market.ts:2536-2569 | roll | supply, fiscal and favourable shocks: hazard, duration, size | EXOGENOUS | Hazard calibrated to the US record. | med | STILL |
| market.ts:2719, 2824, 2930, 3135, 3865-3867 | roll | noise on national unemployment, inflation (±0.4pt), u* belief, term premium (±0.30, sourced), TFP | EXOGENOUS | Term premium sourced; unemployment/inflation noise unsourced shapes. | low-med | STILL |
| market.ts:4062-4070 | roll | secular era menus (drift, 12-25y) | EXOGENOUS | Structural demand eras. | low | STILL |
| market.ts:5275-5276 | roll | ±0.12%/mo construction input-cost noise | EXOGENOUS | Unsized. | low | STILL |
| demand.ts:737 | roll (hash) | block trade-mix noise 0.35-1.65 | EXOGENOUS | Which firms are where. Unsized. | low | STILL |
| demand.ts:1119-1135 | roll (hash) | civic works: year offset, where, kind, size | EXOGENOUS | CHANGED: the year comes off a schedule (LINE_RATE + one hashed phase) and the 25% shelving die is gone; funding is `cityFundsWork` / the city's own books. Corridor, kind and size are still hashed; the capitalised points should cite hedonic studies. | low | CHANGED |
| growth.ts:356 | roll (hash) | land developer capital (uniform in log, ±0.9) | EXOGENOUS | Cited ULI/NAHB loosely. | low | STILL |
| growth.ts:166, 499-500 (READ_SIGMA 0.10 lognormal on each developer's read of lots and costs) | roll (hash) | which developer buys a tract | EXOGENOUS (agent belief) | Sourced to appraisal dispersion (Lusht 1996; IRWA). Chooses "who reads it best", the outcome still clears on the pro forma. | low | NEW |
| market.ts:3476-3479 | roll | rumour news line | EXOGENOUS (cosmetic) | Still draws `rng(s)` on the ECON stream for news, against the file's own `newsChance` rule. | low | STILL |

## PHYSICAL (keep)

market.ts:4547, 4610 (off-map occupancy in [0, offSf]); 4679 (occupied ≤ streetCap/housable, ≥ 0); 4702-4704 (sublet in [0, occupied]); 4710 (cityVac in [0,1], the old 0.45 ceiling is gone); 4726 (streetVac in [0,1]); 3607 (unemployment [0, 0.5] off the register); bands.ts:147, 173, 196, 266 (band occ ≤ band stock); towngrowth.ts:289, 298 (plate ≤ 0.9 lot).

## GUARD (keep; should never bind)

market.ts:1655 (q secant step ±1.5); 1700 (cost level ≥ 0.35 P); 1701-1704 (opening land 0.05-80); 2085 (hpi ≥ 0.2); 2716 (unemployment Okun floor, smooth); 3372 (scale ≥ 0.2); 3786 (cpiXS); 3869 (kDeep ±5%, NEW); 4146 (secular idx 0.45-2.2); 4174, 4178 (retail/manuf idx ≥ 0.3; watch manuf); 4660 (absorption ±3% of occupied); 4922 (intensity 0.15-6); 4990 (growthExp input ±15%); 5284 (cost idx ≥ 0.2); demand.ts:106/1281 (LOG_CAP ±0.62, tagged "[K] a guard rail"; measure), 114/1336 (DRIFT_CAP 34) and 116/1348 (TOTAL_CAP 36), both tagged "[K] a rail"; re-measure, 306/971 (EMP_CAP 16, "[K] a rail"); bands.ts:294, 299 (band rent ≥ 0.2).

Dead code still standing: market.ts:1363 `cityClassFactor` has no caller. market.ts:4994 and 5012 draw `rrange` and discard it (cap and land noise), kept to hold the national stream; remove in a stream-breaking commit. `cycleDev` (market.ts:3556-3558) is still computed each month but only the history record (5466) and the invariants read it.

## Summary

Old rows: 54 (32 FAKE, 22 EXOGENOUS).
- STILL: 24 (11 FAKE, 13 EXOGENOUS)
- CHANGED: 8 (7 FAKE, 1 EXOGENOUS)
- GONE: 22 (14 FAKE, 8 EXOGENOUS; several moved to files outside this audit)
- NEW: 4 (3 FAKE/shape, 1 EXOGENOUS)

Top fakes left in this file set:
1. **regime.ts:211-212 opening vacancy × d(0.88, 1.12), pinned 2-40%.** This is the example CLAUDE.md names, and it persists for years.
2. **market.ts:1790-1792 creditIdx 0.4 floor plus ±1.2pt die.** The floor is load-bearing by its own comment.
3. ~~**demand.ts:163-185 pole drift/noise/cap.**~~ Deleted 2026-11-21; centres are geometry, their level is the anchors on them.
4. **market.ts:4479-4489 pool cap plus 25% bleed.** Excess demand is deleted, not priced.
5. **market.ts:1698-1705 / 1345 opening landIdx (rent/cost)^1.15.** It still sets the level the value.ts texture floor multiplies (see dev.md).

## Fixed since the first pass

- market.ts cityVac/streetVac 0.45 ceiling: now [0,1] (4710, 4726).
- Opening dearness R and per-class OPEN_Q draws: replaced by `openingTobinQ` from land scarcity (uncommitted initEcon change). P stays as a numeraire (CHANGED row).
- Construction starts = 0.16% of stock × U(0.7,1.3) × catchUp: starts are the sum of builders' decisions (4245-4265).
- Monthly rent noise ±0.2-0.4%: rents read off the lease tape (4924-4950) and block landlords (streetRolls.ts).
- Monthly cap noise ±4.5bp and the comp-thin placeholder: read in propmarket.ts `tickCapRead`. The draw is voided (4994).
- Monthly landIdx target/step and ±0.3% die: read in propmarket.ts `tickLandRead`. The draw is voided (5012). The opening identity remains (CHANGED row).
- capFlowsOf ±1.3 rail: gone with the asserted cap spreads.
- concessionTarget clamp(gap×11): retired. Concessions are read off signed leases.
- cycleDev ±0.03 die: removed (3550). Its readers in caps, land and local vacancy are gone too.
- absorption.ts match factor, 5.5%/mo rate, local vacancy swing on cycleDev, condition multiplier 1.22/0.76/0.48, requirement-size draw: the leasing law was deleted (2026-11-11).
- vacancyPull clamp 0.4..1.7: retired (leasing.ts:2310).
- Migration choke 0.20 + 0.80×slack, spacePull caps, employIdx shed-trade bleed, employIdx ±0.12% noise: retired with the household/firm registers (economy.ts, households.ts; not re-audited).
- openingRegionTrend clamp and the regional edge walk: retired (market.ts:3320).
- Industry shocks / demand noise / local fortune, boom/bust episodes, local wage ±0.04% noise: no longer in market.ts (trade now comes from `e.eco`); not re-audited where they went.
- bands.ts tenant-quality draw (u, u2): `scoreDraw` is now deterministic.
- towngrowth.ts PLAN.odds 0.65 coin: the council votes on the binding-envelope evidence.
