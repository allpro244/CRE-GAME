# Baseline attribution — post #63 merge

**Ruler commit:** regenerated on `cursor/unify-dev-land-ba6d` (`5234f8d`) after land asks, the residual, and city orders were made the same question.  
**Previous ruler:** `bce4162` (citygen programmes, v36).

`pnpm baseline:check` compares six seeds × 300 months. Movement is expected; this file says **why**.

---

## This ruler: one land price, one development hurdle

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
