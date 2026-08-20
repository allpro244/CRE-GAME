# Baseline attribution — the plat overhaul

**Ruler commit:** regenerated after the city-generator overhaul (`SAVE_VERSION` 39).  
**Previous ruler:** `dc6f0b5` (whole-suite pre-lets + last-suite tours, v38).

`pnpm baseline:check` compares six seeds x 300 months. Movement is expected; this file says **why**.

---

## This ruler: a concession cannot be un-given (SAVE_VERSION unchanged)

`ad0a156` made the concession dial asymmetric. It chased its target at
0.25/month in both directions, so the giveaway evaporated as fast as it
arrived and returned to zero the moment availability normalised. It now opens
at 0.25/month and closes at the rate the class's leases actually roll — 1/60
for office and retail, 1/36 industrial, 1/12 for flats — because a landlord
can concede this month and cannot un-concede until the paper turns over.

Measured with `pnpm glut` before the change: the ASKING index carried 74-86%
of the whole effective-rent adjustment at three years, in every class at every
dose, twelve readings out of twelve. Real markets put it the other way round:
four years after 2020, Manhattan asking was -3.3% and net effective -17.3%.
No new `rng()` draws, so every move below is a repricing plus the century
re-roll that follows from changed decisions.

| Metric cluster | Driver | Direction |
|---|---|---|
| `rentIdx.office` -11%, `retail` -11%, `multifamily` -4% | THE INTENDED MOVE. The dial now holds a residue of past softness, so the effective index sits under asking for years and asking no longer has to carry the whole cut | One-time repricing, intended |
| `land.p90` +48%, `land.p10` +5% | Land is a residual and a difference, so a rent series that stops overshooting downward shows up geared on the best dirt | Follows rent |
| `city.population` +2.2%, `floorAreaM` +1.1%, `demolished` 19 -> 26 | Cheaper effective rent lets more households in and turns more worn stock over | Follows the repricing |
| **`rail.vac.office.lo` 0.247 -> 0.350** | **A REGRESSION, AND IT IS REPORTED.** Lower asking rents raise demanded space, and office supply still cannot answer it, so the frictional vacancy floor binds a third of months again. This is the same open item the income ruler recorded; it is now the largest one | Report, do not tune |
| `rail.vac.multifamily.lo` 0.16 -> 0.107 | The other half went the right way — flats' 1/12 decay is short, so their dial still clears | Follows the roll rate |
| `roll.deadLegShare` +5.4% | More mixed-use legs sit unlet at a lower effective rent | Follows |

The office rail is the honest cost of this ruler. The mechanism is right — a
market that has taught tenants to expect free rent keeps paying it — and the
city still cannot build into the demand that a cheaper effective rent creates.

---

## Previous ruler: supply answers price (SAVE_VERSION unchanged)

`9bb975e` removed the third answer to one question. The legal envelope said
27-56 floors, `cityInfillCap` let a shovel reach 5-8, and the land residual
priced a 14-floor scheme in between — so dirt was sold on a building nobody
would be permitted to build. `residualScheme` now multiplies the legal FAR by
`econ.infillShare`, the median buildable-over-legal ratio published by the
sampler that already walks these lots, and the feasibility sampler asks its
question at the same cornice.

Measured on the tip: `sitePencil.office` in pinned months 0.000 -> 1.004,
office starts 0.0 -> 6.3k sf/mo, vacancy-floor pinning 27.7% -> 25.5%.
No new `rng()` draws, so every move below is a real repricing plus the century
re-roll that follows from changed decisions.

| Metric cluster | Driver | Direction |
|---|---|---|
| `land.p10` -20%, `land.med` -14%, **`land.p90` +37%** | THE INTENDED MOVE, and the spread is the point. A smaller buildable envelope cuts the residual on ordinary dirt; on the sites that can still build, scarcity concentrates the value. Ricardian, and the right sign | One-time repricing, intended |
| `dev.affordableLotShare` 0.126 -> 0.158 | Cheaper ordinary dirt. Now ~4pp ABOVE the documented 8-12% honest band | WATCH — do not tune |
| `city.buildings` +0.7%, `floorAreaM` +2.6% | More sites pencil, so more of them get built | Follows the residual |
| **`rail.vac.office.lo` 0.333 -> 0.247** | The regression the last ruler recorded, partly repaid: the office frictional-vacancy floor binds a quarter of months instead of a third, because supply can now answer the income term | The finding, closing |
| `rail.vac.multifamily.lo` 0.09 -> 0.16 | Went the other way. Flats are the use the residual most often picks, so the extra starts concentrate there and the floor binds more | REPORT — the open half of the same item |
| `vac.*` (office +14%, retail +37%, multifamily +21%) | More delivered stock against the same demand | Follows supply |
| `rentIdx.industrial` -9.1% | Industrial is now permittable on fringe C corridors and has an exit valve; more of it exists | Intended, from #11 and #10 |
| `city.employed` / `population` (-2.7% / -1.3%) | Century re-roll on a changed decision path; inside seed noise at a 300-month snapshot | Not attributed further |

Land was re-measured against three outside facts after this ruler, because the
change moves land directly: land is **32.6%** of improved value (the city's own
assessment roll, stamped from real NYC data, says 43.7%; the literature band is
25-50%), **22.9%** of total development cost (ULI practice: 15-25% ordinary,
30-50% gateway), and a prime site prices at **$151/buildable sf** (strong
non-gateway CBD runs $60-150). Single-lot annual real returns have sd **21.9%**
against a real-world 20-25%. The $9,624-per-square-foot-of-land reading that
localised this fault is gone; the prime lot now runs $700-$4,600 real.

---

## Previous ruler: demand gets its income argument (SAVE_VERSION unchanged)

`be6813a` split `burden = rent/wage` into two arguments — a real rent index and
a damped real-income factor `incomeEff` — and `008aad4` made the secular
composition bound asymptotic so nothing walks into a clamp. Both are mechanism
changes with no new RNG draws, so every move below is a real repricing plus the
century re-roll that follows from changed decisions.

| Metric cluster | Driver | Direction |
|---|---|---|
| `rentIdx.*` (office +3.6%, retail +37%, multifamily +46%, industrial +77%) | THE INTENDED MOVE: demand now responds to income, so rents hold their real level instead of bleeding. `pnpm income`: occupancy cost per worker -2.15%/yr -> -0.49%/yr | One-time repricing, intended |
| `vac.*` (office -16%, retail -15%, multifamily -47%) | Same — a live income argument raises the demand pool | Tighter markets |
| `land.*` (p10 +33%, med +26%, p90 +75%) | Rents up, so the builder residual is up. Also `f7045ea`: the land harness had been double-deflating the index and reporting a crash that was the price level | Follows rent |
| `city.employed` / `population` (+16%) | More space demanded -> more absorbed -> larger working city | Follows demand |
| `dev.affordableLotShare` 0.094 -> 0.126 | Higher residual on the same dirt. Now just ABOVE the documented 8-12% honest band, having been inside it | WATCH — do not tune; re-read after supply answers |
| **`rail.vac.office.lo` 0.063 -> 0.333**, `industrial` 0.42 -> 0.72, `multifamily` 0.04 -> 0.09 | **A REGRESSION, AND THE FINDING.** The income term added demand and SUPPLY CANNOT ANSWER IT, so the frictional vacancy floor binds a third of office months. The dead income effect had been masking a supply-response failure: with demand flat, supply never had to respond | Report, do not tune |

That last row is the honest cost of this ruler and it is now the top open item.
The mechanism is right — a richer city wants more space — and the model cannot
build it. Per CLAUDE.md, that is a reason to find what the incorrect number was
propping up, not a reason to revert the correction.

---

## Previous ruler: the realism batch — exits, sheds, sweep rate, recessions, land floors (SAVE_VERSION unchanged)

Six mechanisms landed between this ruler and the last (see REALISM_AUDIT_2026-08.md
"WHAT WAS FIXED"): the per-class surplus-exit valve, light industrial on fringe C
corridors, street retail reading the retail gap, the policy-linked sweep rate with
taxed deposit interest, recession-sized natPull, effective-rent reads in
zoning/cornice pressure, and the land floor carrying the price level with
builder-won lots floored at the sales-comparison texture. Every one re-rolls the
century; the moves below are the sum of six re-rolls plus the intended repricings.

| Metric | Was → is | Reading |
|---|---|---|
| `dev.affordableLotShare` | 0.3419 → **0.0943** | THE INTENDED MOVE: inside the documented 8–12% honest band (HANDOFF §6.2) for the first time — the CPI-carried texture floor repriced thin-residual asks. Do not "fix" this back up. |
| `rail.vac.office.lo` | 0.41 (tip) → **0.063** | The office shortage rail nearly releases — exits + corridor sheds + honest floors together. |
| `rail.vac.industrial.lo` | 0.7667 → **0.4167** | Sheds can now be built (fringe C); still the tightest class — the shortage-queue regime remains open. |
| `land.med` / `land.p90` | 58.7 → 96.1 / 2170 → 529 | Floors carry CPI (median up); the p90 tail was the residual violence and is gone. |
| `vac.retail` | 0.0582 → 0.0727 | Near natural (0.085); street-retail gap wire + valve. |
| `city.demolished` | 27 → 22 (25y window) | The valve is calibrated to fire on chronic deep gluts, which this window's seeds mostly lack; the 50y city-accept L median is 0.36%/yr, inside its band. |

A full max(builder,holder,floor) land auction was tried inside this window,
measured (`dev.affordableLotShare` 0.016, office rail re-welded to 0.40,
stock/jobs halved), and REVERTED — the measurement and the reservation-vs-
transaction analysis live in value.ts:landRead and the audit doc.

## Previous ruler: the owner's mark carries the tenant's tax share (SAVE_VERSION unchanged)

`holdingValue`'s stabilised leg and `leaseUpMarkAt` capitalised pre-tax NOI at
`cap + TAX_RATE` — the FULL statutory rate — while `assetValue` and
`planDevelopment`'s exit yield load only `TAX_RATE × taxBorneShare(rec)`, the
share a net-leased roll does not bill to its tenants. One stabilised NNN retail
building, two values ~14% apart depending on the desk asked (CLAUDE.md fake #3).
Both sites now read `taxBorneShare`, same as `assetValue:1919` and `dev.ts:1077`.

The moves in this ruler are almost entirely an RNG re-roll, not the repricing:
the fix changes street values on lease-up-window and net-leased stock, which
changes which deals close, which re-rolls the century (HANDOFF §4 — `rentIdx`
and `land` carry a 3.4× cross-seed spread; a six-seed median cannot resolve
under 2×). The tell: `rentIdx.multifamily` moved −23.4% although multifamily's
`taxBorneShare` is 1.0 and its marks are bit-identical under this change.

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `land.p90` (−53%), `land.med` (−12%), `rentIdx.multifamily` (−23%), `vac.retail` (+87%) | Re-roll via changed street decision paths | Within cross-seed spread |
| `rail.vac.office.lo` (0.41 → 0.20) | Re-roll; the pin share is seed-shaped (80y campaign median is ~0.19) | Watch, do not tune |
| lease-up-window and NNN street values | The actual repricing: ~+6–14% on retail/industrial stabilised legs | One-time, intended |

Validated at the change: `pnpm gate` green (conserve 801 months, extleak,
city-accept 3/3, invariants), `covenant`, `facility`, `legmatch` all pass.

## Previous ruler: FAR doubled where towers go (SAVE_VERSION unchanged)

`BASELINE.json` regenerated at the FAR change, so this ruler contains BOTH the
demand-shape overhaul (#124, attributed in the section below against the old
ruler `ec10824`) and the FAR headroom change in `zoneFar`. The two were
measured separately before the regen — bare trunk (#124 alone) vs trunk + FAR —
so each delta below names its owner.

FAR itself, measured on seeds 0/1/2 after #124: mean allowance 8.0–8.7 →
12.2–13.3 (+52%), p90 18–21 → 33–37.5, fringe 2.0 → 2.4, cap-bind 0.0%.
The 38 cap is untouched; the gradient (`2.4 + 9.4·heat^2.5`) does the work.
The refusal of a true 2× mean is recorded in the `zoneFar` comment: every
parameterisation that reached mean 17+ put 12–14% of the city flat on the
ceiling — a load-bearing clamp, fake number five.

| Metric | #124 alone | + FAR | Owner |
|--------|-----------|-------|-------|
| `land.med` | −6.9% | +3.1% | FAR adds ~+10% to the median — matches the D-arc prediction (+9%) with comps governance in place |
| `land.p90` | +9.4% | +36% | FAR — the doubled allowance is in the core, so the prime tail is where it prices |
| `rentIdx.retail` | −31.3% | −46.8% | Mostly #124 (shop employment its own field); FAR deepens it via more legal supply. Retail vac +49% → −2.3%: cheaper rents re-fill shops |
| `rail.vac.office.lo` | 0.17 → 0.42 | 0.42 (unchanged) | **#124, not FAR.** Office vacancy resting on its low rail 42% of months is a watch item for the demand overhaul |
| `city.demolished` | +24% | +29% | Both — more allowance is more redevelopment; city-accept K/L moved TOWARD their bands (aging median 45→41, demo rate 0.074→0.088%/yr) |

---

## Demand is no longer one hill (SAVE_VERSION unchanged)

Lots did not move. The demand *surface* did. Station ridership no longer
copies downtown heat; employment is three independently-normalised fields
(office / mill / shop); park amenity is frontage rather than a civic-park
bullseye; shore and corridor multiply the score (mean 1). `pnpm demandshape`
on six islands: 2–3 peaks on five of six seeds, 2–3 top-decile clusters on
every seed, peak district a different place each time (wharves, ropewalk,
custom house, quays, counting house, the change). Correlation with distance
to the single best lot is 0.27–0.90 against the old one-hill 0.61–0.94.

Measured on the existing ruler (`ec10824` → `12937a8`). Not a silent regen.

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `land.p10` (+26%) · `land.med` (−7%) · `land.p90` (+9%) | Fringe lots are no longer the fade of one downtown circle; prime is several places | The land curve *moved*, it did not flatten |
| `rentIdx.industrial` (+20%) | Mill jobs are their own field, so the port is a real location | Follows the sheds |
| `rentIdx.retail` (−31%) · `vac.retail` (+49%) | Shop gravity is a block or two, not the civic-park Gaussian | Shops no longer inherit downtown heat |
| `rentIdx.office` (−5%) · `vac.office` (+17%) | Office still wants the exchange; it is no longer the only hill | Modest |
| `city.employed` / `population` / `floorAreaM` (+5–7%) | The street builds on a different surface over 300 months | Follows development, not a stock re-cut |

---

## This ruler: the plat overhaul (SAVE_VERSION 39)

The generator was cutting a town nobody would survey. Wedges where two
surveys or a boulevard met were shredded into slivers; boulevard
reservations painted as single fields of asphalt up to 112,000 sq m; an
edge fronting a reservation paid a street width twice, erasing about
thirty lots an island; creeks ran coast to coast dead straight through the
trading floor; and the core-to-fringe height gradient was worth about two
floors against an ambition draw that swung sixty per cent, so downtown
fabric equalled fringe fabric to the eye.

All of it recut lots, so the ground moved and old generated campaigns are
refused. Measured on the twelve pinned seeds of `pnpm plat`: sliver lots
0.6% -> 0.0%, spikes 0.1% -> 0.0%, largest unprogrammed apron 111,936 ->
10,552 sq m, stream meander 0.022 -> 0.060 (the "ruler, not a brook" flag
cleared), inner/outer floor gradient 1.73 -> 2.49, lots +312 across the
sweep. Zero degenerate geometry, the one hard gate. Not an engine `rng()`
re-roll — citygen has its own salted streams — though the plat change does
re-roll citygen's own shared stream, which is what a ground move is.
Conservation stayed green (1,936 months, up from 1,232: the bot trades more
on a plat with more lots on it).

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `city.employed` (+30%) · `city.population` (+27%) · `city.floorAreaM` (+10%) | 312 more lots and genuinely taller cores | More standing stock carries more jobs and people |
| `land.p90` (+51%) vs `land.med` (-11%) | The height gradient is real now: heat scales the base term instead of adding two floors to noise | The land curve SPREAD — downtown dearer, fringe cheaper, which is what a gradient does |
| `rentIdx.office` (+35%) | Office concentrates where heat is, and heat now builds | Follows the fabric |
| `rentIdx.retail` (+10%) vs `rentIdx.multifamily` (-16%) | Class corridors: retail wants frontage (scarcer), housing fills mid-block (more of it) | Follows the corridor weighting |
| `dev.affordableLotShare` (-26%) | Follows `land.p90` | Fewer lots pencil at the top of the curve |
| `vac.industrial` (-13%) · `rail.vac.industrial.lo` (+155%) | Yards seat on the creek, and the creek moved | Follows the plat |

---

## Previous ruler chain — post #63 merge

**Ruler commit:** regenerated on `cursor/consolidate-open-prs-2de8` after folding #102/#104/#105/#106 (`SAVE_VERSION` 38).  
**Previous ruler:** `664711a` (smaller parks, dry park props, v38).

`pnpm baseline:check` compares six seeds × 300 months. Movement is expected; this file says **why**.

---

## This ruler: whole-suite pre-lets + last-suite tours (SAVE_VERSION 38)

#102 stops spec construction from opening with a fractional bite of a programmed suite, and caps every suite at the actual leg. #105 lets the last suite tour and scores letters against today's marked-down ask. #104 is paint (lots do not move). #106 is quote/UI (city standing stock does not move).

Spec industrial that used to open a few percent pre-let now more often opens empty. Small sheds that could not demise (bay 12,000 ft, building under that) can let as themselves. One-suite offices that compared the whole floor to ~85% of itself now draw tours. Not an engine `rng()` re-roll. Conservation stayed green (1,221 months).

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `vac.industrial` (1.71% → 2.75%) | Sheds no longer open with a fractional pre-let | Spec industrial emptier at delivery |
| `rail.vac.industrial.lo` (−71%) | Same — frictional floor binds less once the last bay can let | Rails less load-bearing |
| `roll.deadLegShare` / `roll.commercialOcc` | Fewer leftover bites; last suite can tour | Follows the demise |
| `land.p90` (−26%) / `rentIdx.multifamily` (−14%) | Different opening occupancy on new stock, different tape | Follows the plat |
| `city.employed` / `population` | Same — different standing mix | Follows stock |

---

## Previous ruler: smaller parks, dry park props (SAVE_VERSION 38)

Park programmes dropped ~20% on count and size, sparse is the common draw, and greens keep more space between them. That recuts lots (park obstacles moved). Trees, walks, and street dashes are paint — they do not move the plat by themselves, but the park rings do. Not an engine `rng()` re-roll. Conservation stayed green (1,119 months).

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `land.med` / `land.p90` | Smaller greens; different dirt is reserved | Spatial |
| `dev.affordableLotShare` | More lots where a great park used to sit | Builders see a different tape |
| `rentIdx.*` / `vac.*` / `city.*` | Same — different standing mix on different dirt | Follows the plat |

---

## Previous ruler: painted ribbon, hidden capsules (SAVE_VERSION 38)

v37 drew the lot-cutting capsules on the map, so a mill pond in a park was a stack of rectangles with a triangular tail. The centreline was also allowed to U-turn.

The map now paints one offset ribbon per run and a 64-gon circular pond. Capsules still cut lots but are not features. The path cannot loop. Standing numbers move because the plat moved with the centreline. Not an engine `rng()` re-roll. Conservation stayed green.

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `land.med` / `land.p90` | Different water reservation; lots recut along a smoother path | Spatial |
| `rentIdx.*` / `vac.*` | Same — different standing mix | Follows the plat |
| `city.buildings` / `floorAreaM` | Capsule obstacles follow the new centreline | Stock resampled |

---

## Previous ruler: convex creeks and round mill ponds (SAVE_VERSION 37)

Creeks were one self-intersecting offset polygon. MapLibre and the 3D triangulator filled the convex hull — a green spike across the town. The estuary lead-in was a single rectangle up to ~480 m. Ponds were 20-gons.

Water is overlapping convex capsules now, ponds are 48-gons, and the lead-in walks from the harbour in short steps. That recuts lots (stream obstacles changed shape), so standing stock and rents resample. Not an engine `rng()` re-roll. Conservation stayed green (2,723 months).

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `city.buildings` / `floorAreaM` | Capsule obstacles vs one folded ring; different plat | Stock resampled |
| `land.*` / `rentIdx.*` / `vac.*` | Same — different standing mix on different dirt | Follows the plat |
| `dev.affordableLotShare` | Different lots on the new water reservation | Builders see a different tape |
| `rail.vac.*.lo` | Frictional floor on a recut town | Rails reporting, not a new clamp |

---

## Previous ruler: one land price, one development hurdle

Listed dirt that pencilled was asking 2.41× the builder residual (holder option and texture winning the auction on sites that supported a building today). The residual omitted lease-up and construction interest the desk puts in the basis. City class orders kept a `structFloor` so office stock grew while the desk reported zero office sites.

Transacted land that pencils now trades at the residual. Holder/texture price only land that does not support a building today. Residual includes the same carry the desk uses and picks the height a builder would actually build. Class orders go to zero when no sampled site clears.

Not an RNG re-roll. Conservation stayed green (1,779 months). Gate passed.

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `dev.affordableLotShare` (3% → 24%) | Asks on pencilling lots are the residual, not the option bid | Builders can pay |
| `land.med` (−40%), `land.p90` (−33%) | Same — dirt that pencils is no longer priced at 2.4× residual | Cheaper buildable land |
| `vac.multifamily` (+99%), `rentIdx.multifamily` (+14%) | More sites clear, more housing gets built | Supply answering |
| `rail.vac.*.lo` down except industrial | Frictional vacancy floor binds less often when supply can actually land | Rails less load-bearing |
| `city.floorAreaM` (+9%) | Honest orders on sites that pencil, not a structFloor of unprofitable office | Stock follows the desk |

---

## Previous ruler: citygen programmes (SAVE_VERSION 36)

The silhouette is a programme now (classic / basin / spit / river / neck), harbour slips cut the quay, lot grain runs the town, and creeks are stroked polylines instead of rectangles. Demand also has a second-station kernel and a dock employment floor — that moves prices, not lot lines, but it is in the same snapshot.

Not an engine `rng()` re-roll. New citygen salts (`0xc0a5e` coast, `0x67a10` grain, `0x5115` slips, `0x5a11` rail, `0xf1a70` park flavour, `0x1a0d` landmark). Conservation stayed green (1,225 months on this pass; full check follows playable).

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `city.buildings` / `floorAreaM` / `employed` | Different coast and slip reservations; millside is a real second centre | Stock and jobs resampled |
| `land.*` / `rentIdx.*` | Second-station kernel in the demand blend; grain changes parcel mix | Spatial, not a rent bug |
| `vac.*` | Same — different standing mix on a different plat | Follows stock |

---

## Previous ruler: inland streams (SAVE_VERSION 35)

Streams are obstacles. Lots that used to sit on dry ground now stop at the bank, so the standing city is smaller and the remaining dirt is a different sample. Not an RNG re-roll — citygen salt `0x57ea` is its own stream; engine `rng()` draw counts are unchanged. Conservation stayed green (1,880 months).

| Metric cluster | Driver | Direction |
|----------------|--------|-----------|
| `city.buildings` (−9%), `city.floorAreaM` (−15%) | Creek/canal/pond reservations take cells the generator used to plat | Smaller standing stock |
| `city.employed` / `population` (−16%) | Same — fewer floors, fewer jobs and residents at month 300 | Follows stock |
| `land.med` (+31%) | Remaining lots are a different sample; p10/p90 barely moved | Median only |
| `rentIdx.multifamily` (−25%), `rentIdx.office` (−12%) | Smaller city, different mix; industrial vac collapsed (−71%) because mill/canal towns keep more M-district waterfront working | Sector mix, not a rent bug |
| `city.demolished` (−40%) | Fewer worn buildings in a smaller plat | Follows stock |

Station harness on the new plat: injection +7.70 pts within 380 m vs control, −3.74 far (redistribution holds). Funded park claimed BBL 1000180003 and `executePurchase` refused it.

---

## Intentional world changes (do not revert without re-measuring)

| Metric cluster | Driver | Expected direction |
|----------------|--------|------------------|
| `rentIdx.*` (−13% to −26%) | Principal rival deaths → estate dispositions; size-scaled rival entry (#57); private-credit / playthrough fixes shifting turnover | Lower nominal index at month 300 — more distressed supply and earlier rival churn |
| `vac.office` (−40%), `vac.multifamily` (+38%) | Same turnover + rent-press EMA (#60) + industrial/comp fixes already on tip | Sector mix shifts; office vac reads lower at snapshot |
| `rail.vac.office.lo` (+165%) | Rails bind less often when vac is not pinned; multifamily rail.lo now non-zero | Rail metrics are *binding rates*, not levels — read with `tools/rails.mjs` |
| `city.employed` / `population` (+9%) | `cityscale` on rival first closes + more deliveries completing | Larger working city at month 300 |
| `city.floorAreaM` (−8%) | Fewer phantom completions; supply-queue orphan stall (post-#63 wishlist) | Stock closer to map reality |
| `land.p10` (−18%) | More honest builder residual / affordable lot share (#57, #60) | Cheaper tail lots |
| `roll.deadLegShare` (−18%) | Per-leg rent fixes + leasing desk work (#60) | Fewer dead mixed-use legs |
| `dev.affordableLotShare` (+8%) | Land read as pure auction (#57 HANDOFF closed item) | More lots pencil mid-cycle |

---

## Metrics that should stay stable (investigate if they move again)

- `rail.cap.*.hi/lo` at zero for most classes — caps rarely bind at month 300 on default seeds
- Conservation identity (`pnpm conserve`) — independent of baseline; must stay green
- RNG bit-identity on **unchanged** code paths — any new `rng()` call re-rolls everything; attribute drift to draw count before tuning constants

---

## How to use this

1. After an engine PR: `pnpm engine && pnpm baseline:check`
2. If a metric moves >0.5%, decide: **listed above**, **bug**, or **new intentional change** — then update this file or regenerate `BASELINE.json` with `pnpm baseline`
3. Do not treat baseline failure as CI failure — treat unexplained movement as a review trigger

---

## Still not attributed line-by-line

- Promote / fund cash flows (vehicle second account) — conserve covers; baseline does not isolate
- Player death band 70–105 — late-horizon; 300m snapshot mostly rival principals
- Life insurance — not implemented; no baseline line yet
