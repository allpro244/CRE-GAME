# REALISM AUDIT — 2026-08-20, tip `b4cfae8`

> **SECOND PASS, same day: the fixes.** The findings below were measured at
> `b4cfae8`; the commits that followed this audit fixed findings 1, 2, 3, 6,
> 7 (partially), 8, 9 and 10 as mechanisms, and tried-then-reverted one cut at
> finding 5. See **WHAT WAS FIXED** at the bottom for the after-numbers and
> what remains open. Headline: `econ:accept` reads **5 of 5** on the fixed
> tree (A location, B supply shock, C cycle, D conservation, E gradient — C
> passed with a 10.7% recession-window drawdown against the 3.9% measured
> here); the 45% vacancy rail releases on healthy seeds; the affordable-lot
> share sits at 9.4%, inside its documented 8–12% band, for the first time.

Full-campaign measurement pass: which parts of this economy are still a game
wearing an economic label. Method per CLAUDE.md: `pnpm engine` first, then the
existing harnesses (`econ:report`, `sim:report`, `city:report`, `stress`,
`audit`, `econ-shape`, `land`, `leadlag`, `mixmatch`, `orderbook`, `class-race`,
`vactails`, `rails`, `inflation`, `liquidity`, `legmatch`, `conserve`,
`baseline:check`), plus three bespoke probes in long horizon: 6 seeds × 80y on
the reference city, 4 seeds × 80y with `CITY_SEEDS=1`, and single-seed anatomy
traces. Doc claims re-measured, not believed. One fix shipped in this pass (the
mark/street tax-load reconciliation, finding 6 — it was unambiguous and the fix
is the mechanism); everything else is reported, not touched.

Numbers quoted below were measured on this tip unless a commit is named.

---

## RANKED FINDINGS

### 1. Surplus stock has no exit, so a glut is an absorbing state

**The real-world fact.** Space that stops paying its keep leaves the market —
demolition without a replacement pro forma, mothballing, conversion,
abandonment. US cities remove roughly 0.5%/yr of stock; Detroit demolished tens
of thousands of buildings that no development ever replaced. No real market has
held ~50% citywide office vacancy for two decades with its stock intact.

**The measurement.**
- 80y × 6 seeds (reference city): median office vacancy 16.2% over the run;
  seed 73303 sits ON the 0.45 `cityVac` clamp for 23 consecutive years
  (23% of the whole run), with true vacancy `1 − occupied/stock` ≈ 56% —
  an 11pp lie the engine tells itself. Concessions pinned at their 1.00 cap
  for 38 straight years. Stock −3% across 40 years of ~50% vacancy while the
  demand pool fell 45%. 26 buildings demolished in those 40 years.
- 80y × 4 procedural cities (`CITY_SEEDS=1`): median office vacancy 9.2% /
  18.6% / 23.1% / 39.8%; one city spends 39.7% of 80 years at the 45% rail.
- `city:report` L: demolition 0.032–0.148%/yr, median 0.088%, against the
  file's own ~0.5%/yr anchor; K: cities age 38–49 years in 50; on 2 of 5 seeds
  the youngest building at year 50 is 16–34 years old.
- `sim:report` H: 9 of 9 glut seeds peak exactly ON the 45% clamp — the
  harness itself prints "at the clamp this number stops being a measurement."
- `stress` [D]: with credit pinned loose for 50y the city breaks 0.79× the
  ground it breaks with credit pinned tight (needs ≥1.15×) — cheap money
  builds a glut early, the glut collapses rents, and nothing ever pencils
  again. The absorbing state, seen from the credit side.
- `stress` [35]: on the dead-city seed a player has nothing to do — no letter,
  no purchase, no site that pencils — for 550 consecutive months.

**The mechanism.** Every stock-removal path requires a *replacement* that
clears a development hurdle: `tickTeardowns` skips unless
`startOwed[lead] > 0 || classPinnedOwed || recycle` (dev.ts:3340) and rejects
any replacement under `oldSf × 1.08` (dev.ts:3407); the recycle hurdle is
still a yield-on-cost test. The only demolish-to-land valve in the engine is
`tickIndustrialExit` (dev.ts:3549) — industrial-only, and gated shut unless
industrial vacancy exceeds natural+1.5pp (dev.ts:3565). Office, retail and
multifamily have no exit at any vacancy. There is no mothballing: `econ.stock`
counts a building that has been 90% empty for 30 years the same as new
delivery. With quantity frozen, three rails absorb the fault instead:
`cityVac` clamped at 0.45 (market.ts:2972 — binds up to 40% of months),
`concIdx` capped so effective ≤ 14% under asking (market.ts:3500; the conc
target clamp is at an endpoint in 73% of calls, `tools/rails.mjs`), and the
cap-rate ceiling at 11 (market.ts:3576 — binds 6–25% of months on procedural
cities; zero in the 25y baseline window, which is why the baseline never saw
it).

**Classification.** Missing mechanism (the exit option on standing stock),
with three load-bearing rails hiding it — fake #5 three times over.

**The realistic fix, as a mechanism.** Generalise what `tickIndustrialExit`
already does, for every class, and make the demolition decision the decision
it is in life: NOT a development pro forma but a carrying-cost comparison —
when a building's expected effective income minus cash opex and tax runs
negative past the owner's horizon, the owner withdraws it (mothball: out of
`stock`, out of the bills, re-enterable) or clears it to land (demolition cost
against the carry, land value as the residual claim). Conversion
(office→residential) is the same valve where the cross-use residual clears.
Once quantity can leave, the 0.45 clamp, the concession cap and the cap
ceiling can go back to being guards. Do not touch the rails first — they are
currently the only thing standing between the model and the fault.

### 2. Industrial cannot be built — one class is topologically frozen

**The real-world fact.** Industrial/logistics was the most-built asset class
in the country from 2015–2024, and it was built precisely when its vacancy sat
at 2–4%. A class at 1.5% vacancy with the strongest real rent growth in the
model attracting zero groundbreaks in 80 years cannot happen in a market.

**The measurement.**
- 80y × 6 seeds: industrial vacancy pinned at its 1.54% frictional floor
  92.6% of months (median); stock growth over 80 years: **0.000**. On
  procedural cities that DO carry M-land: still pinned 39–70% of months.
- `mixmatch`: industrial 0.0% of orders, 0.0% of 14.7M sf built.
- `class-race`: industrial is the best-underwriting use on 100–223 of ~290
  lots per window — the engine's own pro formas say sheds are the highest
  and best use of a third of the city's dirt, and its zoning never allows one.
- Real industrial rent +1.05%/yr (80y median) — the only class with positive
  real growth — and `sim:report` F flags it at +1.77%/yr on 20 seeds, above
  its own band. The scarcity walk is pricing a shortage nothing may relieve.
- BASELINE `rail.vac.industrial.lo` = 0.7567. HANDOFF §6 item 1 says this was
  CLOSED with vactails' floor share at 8.9% — stale: `vactails` today reads
  industrial below its first rail 65.7% of months.

**The mechanism.** The shipped city has zero M-zoned lots
(`pipeline/city.mjs:484` emits only C zones; the engine's own comment records
"859 C, 439 R, 0 M" at dev.ts:1346). `zonePermits` excludes industrial from C
land (dev.ts:1353-1358) → `sitePencil.industrial = 0` → `starts.industrial = 0`
(market.ts:2479) → `startOwed = 0` forever, which also kills the rival path
(rivals.ts:1785) and the M-zone weighting (dev.ts:2889). Densify cannot help:
industrial caps at 2 floors and the replacement must grow the site 1.08×
(dev.ts:3407). The sector-exit ratchet nets to zero against the pinned queue
(market.ts:2742), and `gone()` converts what M-land exists AWAY from
industrial as `industComp` declines (dev.ts:2830) — the code's own comment
names the doom loop: "shortage, higher rent, less land for the starved use,
deeper shortage" (market.ts:2725).

**Classification.** Structural conservation fault: demand carries a floor
(INDUST_COMP_FLOOR 0.50) while supply carries a hard zero. The frictional
floor is a rail binding 93% of months for this class.

**The realistic fix, as a mechanism.** Land must be able to answer an
industrial shortage the way it answers an office one. Either `zonePermits`
lets the residual decide (a shed that outbids every other use of a C lot on a
fringe gets built — which is what light-industrial/flex on commercial land is
in life), or `tickZoning` creates M-land under chronic industrial scarcity —
its scarcity signal today reads *office* vacancy and *office* rents only
(zoning.ts:76-79), so no industrial shortage can ever reach the zoning map.
Symmetry, not a coefficient.

### 3. The tournament is measuring nothing — every bot silently levers on the revolver since `c415d2c`

**The rule it violates (the repo's own).** A harness whose subject is a bot
must notice the bot lying about itself; a strategy labelled all-cash that
borrows is not a measurement of all-cash.

**The measurement.** `stress` [28]: 0 of 8 strategies end in the black; every
strategy wipes out in ~6 of 6 worlds; [34]: a competent operator survives 0%
of worlds (needs ≥60%); [G]: buying beats sitting in 0 of 6. The committed
ECONOMY_STRESS.md (Aug 10) records 4 of 8 in the black, all-cash +$20.7M real
with 2 wipeouts. Reproduced identically at pre-#124 (`001af4b`) and pre-#122
(`ec10824`) in clean worktrees, so it is not this week's demand-shape work.
Autopsy of the all-cash bot (seed 550991, stress city): spends its $2.5M by
month 5, then closes 16 MORE purchases with $0 cash — `executePurchase` funds
the equity from `fundableNow` = cash + line (actions.ts:205, the "closing
equity comes off the balance sheet" change, `c415d2c`, 2026-08-19) — carries a
$3.2M revolver at index+400 into the doom loop the LOC was designed to create
(credit.ts:locLimit), and is seized out by month 78. Every "strategy" in the
tournament is now the same strategy: max the revolver.

**Classification.** A test that no longer measures its label (the fault class
CLAUDE.md documents for `conserve`'s dead bot), sitting on an engine
affordance in which one label ("cash") has two funding paths.

**The fix, as a mechanism.** Two halves. The bots must respect their own
labels — check `spendable`/cash before a purchase, the way a real unlevered
buyer does. And `executePurchase` should take the line only on explicit
instruction (the player clicking through a "close on the line" affordance is a
decision; a bot passing `"cash"` is not). Until this is repaired, the repo is
blind on dominant strategies, survival rates and money-shaped regressions —
findings that route through the tournament (stress 28/34/F/G) are
unreadable, and the true answer to "does ownership earn money on this tip"
is UNKNOWN. This blocks reading the severity of finding 1 from the
tournament side.

### 4. Buying a district moves its land value the wrong way — again, and worse

**The real-world fact.** An institution absorbing 250 lots in one district
raises the price of the ground: holdouts extract premiums, the shelf clears,
the next seller asks more. ECONOMY.md open finding #2 named the −6.6% version
of this; the comps fix recorded +24.1%.

**The measurement.** `stress` [B] on this tip: difference-in-differences
−34.7% (needs ≥ +2%). Per seed: 3.75x→2.45x, 10.79x→29.64x, 41.58x→22.20x.
The whale clears the shelf (listings 6-9 → 0, turnover 0.38× control).

**The mechanism — partially identified; stopping short per the brief.** The
comps wire itself now marks against close-time appraisals and normalises
district-vs-town (comps.ts:262-414), which killed the old circularity. What is
left: after the whale clears the shelf, prints stop and `s.lastTradeM`'s
34–155-month relist cooldown (sim.ts:388-390) starves the district of
evidence, while the whale's own off-market closings enter down-weighted
(comps.ts:296-327). But note the per-seed baselines above — district/town
gaps of 3.7×–41.6× that swing 2× either way — the estimator is standing on the
parcel-price violence of finding 5, and a 3-seed median may not even resolve
the sign. This needs its own decomposition (which wire moved `landAdj` /
`districtHeat` in the whale arm, print by print) before anyone touches code.

**Classification.** Backwards wire or broken estimator — unsure which, and
saying so. Either way the claim "buying a district must move its ground up"
is not demonstrably true of this tip, and it was documented as fixed.

### 5. Parcel land prices are discontinuous and violent — the deferred residual arrived without its option value

**The real-world fact.** Land is the most volatile thing in CRE and the worst
recorded busts are −60..80% (Japan −70% over 14 years). Urban lots do not
lose 94% in 12 months, do not trade at ~zero in a functioning city, and do not
10× back in six years. Dirt holds value between residual regimes because
owners price the OPTION on future development, not this month's pro forma.

**The measurement.** `pnpm land` (8 seeds × 100y, real): ordinary lot —
median biggest run-up 490,805%, low 0.00× of start; prime lot — drawdown
91.5%, run-up 4,384%. Anatomy trace (seed 73303): the ordinary lot falls
172→11 $/sf (−94%) in twelve months at year 8 — the month its builder
residual flips negative — sits at 11–14 for five years, then re-prices to 107
the month the residual returns. The prime lot runs 2,175 → 11 → 10,630 → 374
across the century.

**The mechanism.** `landRead` (value.ts:729-842) prices a lot at
`builder residual if > 0, else holder, else texture floor` — a step function
across branches. The holder read (peak-rent residual × wait discount)
evidently sits below the floor exactly when the current residual dies, so the
price falls straight through to the floor. And the floor itself dissolves:
`texture = rec.landPsf × econ.landIdx × level`, where `econ.landIdx` is
deliberately homogeneous-of-degree-0 (market.ts:3598-3607 — a REAL ratio, by
design and for good reason), multiplying a `landPsf` frozen in 2024 dollars —
so the floor never carries the price level and decays toward nothing in real
terms over any long run. Related: the city `landIdx` and the parcel prices are
two answers to "what is land doing" — the index ends a century at ~0.06× real
while the same city's lots end at ~5× real (`pnpm land`).

**Classification.** Missing mechanism (the option value of dirt) plus a
dimensional fake (a real ratio used as a nominal multiplier).

**The realistic fix, as a mechanism.** The holder's reservation price should
be an expectation over the residuals the parcel could earn across the beliefs
the engine already carries (`rentExp`, `capExp` — the slow underwriting EMAs),
with today's residual as its floor — that is what "I'll wait out the cycle"
means priced. The texture floor should be re-based nominal (carry the price
level) so a century of CPI cannot dissolve it. No smoothing constant on the
price itself — the discontinuity is the branch structure, not the speed.

### 6. One building, two values: the owner's mark taxed the tenant's share — FIXED IN THIS PASS

**The rule.** One quantity, one answer (CLAUDE.md fake #3). A triple-net
tenant pays the property tax, so a stabilised NNN building's value cannot
depend on which desk appraises it.

**The measurement and mechanism.** `assetValue` capitalises pre-tax NOI at
`cap + TAX_RATE × taxBorneShare(rec)` (value.ts:1919, with the comment saying
exactly why), and `planDevelopment`'s exit yield does the same (dev.ts:1077).
`holdingValue`'s stabilised leg and `leaseUpMarkAt` loaded the FULL rate
(value.ts:2387, 2182) with no comment defending it. Retail recovery is 0.88,
so ~97bp of phantom tax on a ~6.5% cap: the player's stabilised mark on an
identical NNN retail building ran ~13–14% under the street price they had
just paid (≈6% on the 45%-weighted blend), permanently, on every net-leased
asset. ECONOMY.md open finding #3 (plan vs mark) was genuinely reconciled at
dev.ts:1060 — re-measured, holds — this was the remaining leg of the same
fault on a different axis.

**The fix (shipped).** Both sites now load `TAX_RATE × taxBorneShare(rec)`.
Validated: `pnpm gate` green (conserve 801 months, extleak, city-accept 3/3,
invariants), `covenant`, `facility`, `legmatch` pass. BASELINE.json
regenerated with attribution (see BASELINE_ATTRIBUTION.md — the movement is
almost entirely an RNG re-roll via changed street decision paths; the tell is
multifamily rents moving −23% while multifamily marks are bit-identical under
this change).

### 7. Recessions never reach the space market — the phase pushes rents directly while demand never contracts

**The real-world fact.** In 2001 and 2009 metro office employment fell 3–6%,
net absorption ran negative for 6–10 quarters, and effective rents fell
15–40% in the hard-hit markets. Recessions and rent troughs coincide, with a
lag of quarters, not never.

**The measurement.** `econ:report` C: across 50 years containing 120
recession months, the worst office rent drawdown inside a recession window is
3.9% (band: ≥5% — "rents must actually FALL") while the worst drawdown
anywhere is 17.7% — every real rent bust in this engine is a supply glut, none
is a demand event. Direct probe (3 seeds × 50y, 12-month medians by phase):
city job growth in recession months +0.8/+0.8/+1.1%/yr — statistically the
same as expansions (+0.8/+1.5/+1.1%); the office demand pool in recessions
moves −0.7/−0.2/+1.0%. On one seed rents GROW +4.7%/yr through recessions.
`pnpm audit` [9] agrees from its side: across three unshocked 50-year runs,
12-month effective rent change is negative in only 14.9% of recession months.

**The mechanism.** The labour block (market.ts:1620-1850) drives city jobs
off trend and rent-burden wires; the phase machine's cyclical contribution to
labour demand is nearly nil. Instead each phase carries a direct `rentDrift`
constant (market.ts:355-364, recession −0.0022/mo) — a price asserted where a
demand mechanism belongs (fake #2). Compounding it, `leadlag` measures
vac→rent at 28 months against its own 3–24 month band.

**Classification.** Asserted price standing in for a missing demand shock.

**The realistic fix, as a mechanism.** A recession should shed jobs
(sector-weighted, through the existing `sectorMom`/industry clocks), jobs
shed the pool, the pool sheds occupancy, and vacancy moves rents through the
wire that already exists. As the honest channel takes over, the phase
`rentDrift` constants should shrink toward zero — they are currently doing
the recession's work by hand.

### 8. Idle cash earns 1% under every monetary era — CLAUDE.md's own fake #4, still live

**The real-world fact.** Corporate cash sweeps to T-bills/money funds at
roughly the policy rate. In this engine's own Volcker-style eras the loan
index reaches double digits; in its ZIRP eras it floors at 1.45%. The deposit
never moves.

**The measurement and mechanism.** `CASH_APY = 0.01`, flat (types.ts:2903),
with a comment making the game-design argument in so many words ("cash is a
place to stand between decisions, not a position") — the exact pattern
CLAUDE.md fake #4 names. Applied at sim.ts:695 and rivals.ts:2749. The cost
CLAUDE.md prescribes instead (carrying an idle balance sheet) is absent: G&A
scales with GAV only (sim.ts:635-669), so a pure-cash firm pays the fixed
base and nothing for the balance sheet.

**Classification.** Fake number #4, by the codebase's own definition.

**The realistic fix, as a mechanism.** Deposit rate = `nat.policy` minus a
sweep/custody spread (a measured fact, ~25–50bp), wired to the same policy
rate everything else reads. If cash then reads too strong in high-rate eras,
that is information: T-bills at 8% against a frightened credit market IS the
1981 trade, and the honest counterweights (inflation eating the real value,
opportunity cost of deals not done) are already modelled.

### 9. A third of the city's dirt pencils — a standing number has crept 3× past its own documented anchor

**The real-world fact (the repo's own words).** "Most dirt does not pencil
and most deals should be walked away from" (CLAUDE.md). HANDOFF §6 item 2
records the honest band: ~8–12% mid-cycle, and the fix that landed
"mid-teens."

**The measurement.** `dev.affordableLotShare` (10-year mean, committed
baseline): 0.2345 at `c8f929b` → 0.2702 at #122 ("honest dirt") → 0.3275 at
tip (window containing the FAR doubling `1f9adb3`) → 0.3419 on the re-rolled
ruler after this pass's fix. Nobody moved it on purpose; each step was
attributed to something else and the anchor was never re-checked.

**Classification.** Fake-number creep — a calibrated anchor quietly tripled.

**The realistic fix, as a mechanism.** If doubled FAR is right, land prices
should eat the residual: lots where towers newly pencil should be bid up
(comps heat, holder asks) until the affordable share falls back toward the
anchor. That it does not is finding 5's frozen floor and starving comps wire
seen from the other side — dirt is not learning what the new envelope is
worth. Re-anchor the metric only after land can learn; do not tune the FAR
back as a balance move.

### 10. Retail is built only as a by-product and its loop is open in both directions

**The real-world fact.** Nobody adds shopfronts to a market losing its
shopfronts; ground-floor retail programs shrink to lobbies when the street is
glutted. And dead retail eventually converts or comes down.

**The measurement.** 80y × 6 seeds: retail stock +41% against a retail demand
pool +8% — supply grows five times faster than demand; median retail vacancy
15.5% against a natural rate of 8.5%; `sim:report` F: retail real rents
−2.57%/yr over 50y, 0.4× real over the run (band floor −1.0). On the dying
seed retail vacancy ends at 27.8% with the stock intact (finding 1).

**The mechanism.** `withStreetRetail` staples `1.25/floors` of retail onto
every office/MF programme wherever demand ≥ 38 (dev.ts:531-544), reading
location demand but never the retail market; `retailWantsMixed`
(dev.ts:754-764) converts standalone retail away, so the by-product is the
only retail supply; and no exit exists (finding 1).

**Classification.** Missing feedback — retail supply never reads retail
fundamentals.

**The realistic fix, as a mechanism.** The ground-floor retail share of a
programme should read the retail gap the way every other use reads its own
market — a developer facing 20% street vacancy builds lobbies and amenity
space, not shops. That is a wire, not a coefficient.

---

## WATCHLIST — real, smaller, or entangled with the above

- **orders→breaks runs backwards**: `leadlag` measures groundbreaks LEADING
  the order book by 8 months, r=0.53 pooled over 4 towns (band 0..+20). The
  two order-book bypasses (`classPinnedOwed`, `recycle` at dev.ts:3340) put
  shovels ahead of orders. BACKWARDS is the serious verdict by the harness's
  own taxonomy; it deserves a trace.
- **Construction cost heats off pre-entitlement intentions**: `crewUtil` reads
  `startOwed` the same tick it is written (market.ts:2572 → dev.ts:3118 →
  costIdx at market.ts:3767), so this month's ORDER raises next month's cost
  index 8–20 months before its shovel. Trades bid off backlog under contract.
  Also `buildEma` (market.ts:3657) is computed and read by nothing — the
  comment above the heat term describes a mechanism the code no longer uses.
- **Zoning reads asking where a tenant pays effective**: the rezoning trigger
  and dev's rent-press (zoning.ts:77-79, dev.ts:2751-2752) deflate ASKING rent
  by wages; in a glut (concessions maxed) that reads the market as ~14% dearer
  than it is and upzones into the glut. `tools/rails.mjs`: the zoning
  rent-press clamp binds 36% of calls.
- **Class dominance, mild**: `econ-shape` — class return spread 2.3pt (band
  ≤2.2), one class takes the winner's seat 67% of seeds (band ≤60%); office
  by crude return on the 80y campaign (9.6% vs 7.6–8.9%).
- **The affordability band is load-bearing**: `AFFORD_BAND`'s ceiling binds
  78–92% of calls (rails, market.ts:2630-2634) because rents sit far below
  wage parity for decades (rent-to-income medians 0.16–0.9 across F's 20
  seeds). The band is defensible (feet-per-worker is physical); rents cheap
  enough to pin it for decades are finding 1's mirror — with no supply
  withdrawal there is no marginal-cost floor under rent.
- **Whale estimator vs. land violence**: [B]'s district/town gap baselines of
  3.7×–41.6× (finding 5) make a 3-seed DiD fragile; fix the measurement while
  fixing the wire.
- **The rate-shock supply echo runs backwards** (`pnpm audit` [4], WEAK): 7–15
  years after a rate shock, the supply drought should TIGHTEN vacancy and firm
  rents; measured vacancy +51.6% peak / +200.9% at 50y and rents −59.1% — the
  shock tips the city into finding 1's absorbing glut and the echo never
  arrives. Same shape in `audit` [5] (cost shock, BROKEN): years 7–15 after a
  construction-cost shock, vacancy should tighten from the missing supply and
  instead peaks +252%. Corroboration, not a separate wire.
- **A tower's own demand pole beats its supply shock at close range**
  (`pnpm audit` [3], WEAK): within 150m of a +supply shock, rents peak +26.8%
  ABOVE the counterfactual and land runs +481% at 50y — the delivery's blockD
  redistribution plus `bumpLand` (+5–6% per delivery, dev.ts:3721) overpower
  the extra empty space next door. Agglomeration is real; a nine-fold
  half-century land premium for being next to the glut's epicentre is not.

## RE-MEASURED DOC CLAIMS

| Claim | Where | Verdict today |
|---|---|---|
| Industrial floor CLOSED, vactails floor share 8.9% | HANDOFF §6.1 | **Stale** — pinned 92.6% of months over 80y; below first rail 65.7% (`vactails`); zero sf ever built on the reference city |
| affordableLotShare "mid-teens" against an 8–12% honest band | HANDOFF §6.2 | **Stale** — 0.33–0.34 and creeping |
| Tournament: 7–8 strategies viable, all-cash ~$47M, 34 at 75% survival | ECONOMY.md / ECONOMY_STRESS.md | **Stale** — 0/8 in the black, survival 0%; attributed to `c415d2c` (bots on the revolver), not to the economy; true state unknown |
| Whale district DiD fixed, +24.1% | ECONOMY.md "LAND LEARNED FROM TRADES" | **Regressed** — −34.7% on this tip |
| planDevelopment vs holdingValue exit gap (open finding #3) | ECONOMY.md | **Holds — genuinely reconciled** (dev.ts:1060); the residual tax-load leg is fixed in this pass |
| Rent anchor: rent−wage ~0.2pp/yr, RTI ~1.03 | ECONOMY.md F section | **Holds directionally** — F's failures today are per-class (industrial +1.77%, retail −2.57%), not the old office runaway |
| H reads policy and premium separately | ECONOMY.md | **Holds** — H passes: policy −0.20pp into the glut, premium +0.53pp |

## WHERE THE ECONOMY HOLDS

Verified on this tip, and worth saying: conservation (`conserve` 801 months,
every ledger bucket exercised; econ D induced demand −2.3% ± 2.0pp against a
15% budget); no money pump (stress 29 — every loop costs money); the bounds
(stress 30 — seven absurd worlds, no NaN); the four quotes agree (stress 31 —
appraiser/lender/income/tape rank-correlate 0.94+, four caps all bind
somewhere); determinism and save round-trips (33); location has teeth (A:
2.43× achieved spread, E: 13.5× letter gradient); a supply shock wounds the
neighbourhood the right way (B: −21.6% vs counterfactual, 27-month lease-up);
the central bank reads its mandate (G: raises into inflation 39/40, eases into
unemployment, and the borrower's index correctly decouples when the premium
widens); the glut is seen by labour, credit and concessions (H); booms bid up
the trades (I: r=0.47); the failure ladder fires rung by rung (E);
liquidity is pro-cyclical and a round trip costs ~4%; the total
value→orders→breaks→delivery→vacancy→rent→value loop runs 90 months with no
constant setting it — real property cycles run 7–12 years for the same
reason.

---

# WHAT WAS FIXED — 2026-08-20 second pass

Every fix is a mechanism; every number below was measured on the fixed tree
(gate green at every commit: conserve, extleak, city invariants). RNG caveat
per HANDOFF §4: each engine change re-rolls the century, so before/after pairs
are distributions, not paired seeds.

## Fixed

**Finding 1 — the exit valve (`tickSurplusExit`, dev.ts).** Empty surplus in a
class 5pp+ over natural for 2+ years clears to land, worst building first, no
replacement pro forma — one wrecking ball city-wide per month, paced by the
deepest class's surplus (the per-class first cut cleared 42–50% of two towns
in 50y and was re-structured; the single draw caps near Detroit's ~1%/yr
record by construction). After, 6 seeds × 80y: the 45% rail binds 0.000 on
healthy seeds (was 3–23% of months); median office vacancy 4–16%; city:accept
demolition 0.36–0.39%/yr median against the ~0.5% anchor (was 0.03–0.15%);
J passes (median −11.7%). Residual: seeds where the recalibrated recessions
produce genuine 50-year decline still ride the clamp for stretches (2 of 6
campaign seeds, up to 28% of months) — the valve clears at the historical
pace and a fast collapse outruns it, which is what the record says it should
do. The clamp stays a guard, watched.

**Finding 2 — industrial can be built (dev.ts `zonePermits`/`useForZone`).**
Fringe C corridors (demand < 45) permit light industrial — the 2018–2024
last-mile record: fulfilment went into dead malls and strip corridors, not new
M districts. Stock growth on the reference city: 0.000 on every seed → +1%
to +33% across seeds (the sturdy measure — 80y × 6 seeds); `mixmatch` order
share is roll-dependent, measured 0.9% and 11.2% on two runs of the fixed
tree against a structural 0.0% before, so read it as "orders can now flow",
not a level. `rail.vac.industrial.lo` 0.7667 → 0.4167; sim:accept F
industrial real rent +1.77%/yr (out of band) → **+1.04%/yr (in band)**.
Still the tightest class; the shortage-queue regime (below) is why.

**Finding 3 — the tournament instrument (tools/econstress.mjs).** Bots fund
equity from CASH, per their labels. Re-measured: 0/8 in the black → 2/8
(contrarian +$32.2M real, industrial +$28.0M), survival 0% → 50%, buying
beats sitting 0/6 → 3/6. The engine's close-on-the-line affordance is
untouched — it is a player decision; it was never a bot's.

**Finding 6 — one building, one value (value.ts).** `holdingValue` and
`leaseUpMarkAt` load `TAX_RATE × taxBorneShare`, same as `assetValue` and the
dev exit yield.

**Finding 7 — recessions reach payrolls (market.ts `natPull`).** Sized to the
BLS record (−0.0030/mo ordinary, −0.0045 deep, against ~+1.5%/yr trend).
Labour demand turns −1 to −4.2% through national recessions; filled jobs turn
where slack exists; econ C passes at a 10.7% recession-window drawdown (3.9%
at tip). The phases' direct `rentDrift` constants were left in place — with
the honest channel live they are now a sentiment layer; shrinking them is a
follow-up, not a bundle-rider.

**Finding 8 — the sweep rate (types.ts `sweepApy`).** Policy rate less 40bp,
floored at zero, one function for player and street; deposit interest joins
January's taxable base. Measured: policy 4.55% pays 4.15%, policy 0.25% pays
zero, and the Books page prints the live rate instead of asserting "1.0%".

**Finding 9 — affordable dirt (via the finding-5 floor fix).**
`dev.affordableLotShare` 0.33 → **0.094**, inside the documented 8–12% honest
band for the first time — repriced by the CPI-carried texture floor, not by a
FAR retune. `rail.vac.office.lo` 0.41 → 0.063 on the baseline window.

**Finding 10 — street retail reads the street (dev.ts `withStreetRetail`).**
The ground-floor share fades with retail slack, gone 8pp over natural.
sim:accept F retail −2.57%/yr → −1.72%/yr (still outside −1.0; standing gluts
on old stock keep bleeding — the valve retires them at the historical pace).
Baseline retail vacancy 5.8% → 7.3% against 8.5% natural.

**Watchlist item — zoning/cornice pressure reads EFFECTIVE rent** (zoning.ts,
dev.ts): a glut no longer reads as 14% dearer than it is.

## Tried, measured, reverted — and recorded

**Finding 5, the full auction.** `max(builder, holder, floor)` fixed the
violence outright (worst 12-month falls −99/−100/−82% → −43/−75/−49%, spikes
+18,700% → +273%) and then starved the city: `dev.affordableLotShare` 0.34 →
0.016 (the pre-#47 disease from the other side), the office rail re-welded to
0.40, stock/jobs growth halved. Root: `landPsfNow` serves a RESERVATION price
(appraisals, asks) and a TRANSACTION price (what the city's start path and
the desk pay) with one number, and the holder's reservation never learns from
market silence — the no-bid decay reaches the texture but not the holder bid.
**Shipped instead:** the texture floor carries the price level (`× cpi` — it
had quietly dissolved to year-0 dollars), and a builder-won lot never prices
below the sales-comparison floor (a $2/sf residual is a bid, not a price).
Measured: 12-month falls now −32/−68/−69%, lows 0.26–0.85x of start (were
0.00x), spikes +114–187% — inside the historical envelope (Japan −70%, worst
US −60..80%) — with the affordable share at 9.4% and supply alive. The
reservation/transaction split with a holder capitulation wire is the real
finding-5 build, open below.

## Still open, in rank order

1. **The shortage-queue regime.** A structurally short market absorbs demand
   shocks in its queues (pool pinned at the housable ceiling, unfilled jobs
   absorbing hiring cuts) — econ C's 550991 trace pins tight for ~30 of 50
   years and no recession can raise vacancy off the friction floor there.
   Pre-existing (the F/H history); the glut side now has its door, the
   shortage side still needs supply to answer price faster than `sitePencil`
   bursts allow.
2. **Land reservation vs transaction + holder capitulation** — the finding-5
   completion, analysis in `landRead`'s comment.
3. **The wage-rent scissors / AFFORD_BAND vs the anchor's RTI floor.** Real
   wages compound ~0.9%/yr while real office rents run ~−0.3%/yr (both
   individually inside the record), so rent-to-income drifts to 0.3–0.6x and
   the rent-anchor harness's cheap-side floor (≥0.45 median) breaches on its
   seeds (0.11x median). Two calibrations disagree: AFFORD_BAND says feet per
   worker is physically capped (so cheap space cannot mint demand and rents
   CAN sit far under parity — Houston), the anchor says below ~0.45 is a
   death spiral. One of them is right and it should be decided by evidence,
   not by whichever harness shouts louder.
4. **Whale DiD (finding 4)** — still undecided wire-vs-estimator; re-measure
   on this tree now that parcel prices are sane, before touching comps.
5. **Deep-decline seeds and the 0.45 clamp** — see finding 1 residual.
6. **Harness preconditions moved by the re-roll:** `supply-answers` now draws
   2 of 3 seeds with flat/declining jobs (its ratio clause cannot score);
   `industrial-exit`'s six seeds drew different secular eras (median
   industComp 1.00, so its decline-scenario clauses have nothing to measure);
   `rent-anchor`'s pinned-real clauses read +0.60/+0.64%/yr against
   0.35/0.50 bars — near, not past, and its cheap-side clauses are item 3.
   Each needs its seeds or its preconditions re-anchored, not its thresholds
   quietly widened.
