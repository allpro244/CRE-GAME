# Baseline attribution — post #63 merge

**Ruler commit:** regenerated from tip after merge of PRs #57–#62 (`07c3ac2` and later).  
**Previous ruler:** `ffb883a` (pre-Principal, pre-private-credit, pre-wishlist size-scale).

`pnpm baseline:check` compares six seeds × 300 months. Movement is expected; this file says **why**.

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
