# Baseline attribution — the plat overhaul

**Ruler commit:** regenerated after the city-generator overhaul (`SAVE_VERSION` 39).  
**Previous ruler:** `dc6f0b5` (whole-suite pre-lets + last-suite tours, v38).

`pnpm baseline:check` compares six seeds x 300 months. Movement is expected; this file says **why**.

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
