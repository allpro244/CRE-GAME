# Rail audit — measurement only (Phase 3.0)

**When:** 2026-08-11  
**Command:** `N=3 HZ=600 node tools/rails.mjs` (3 towns × 50 years, no player)  
**BIND threshold:** 1% of calls at a bound counts as load-bearing

## Summary

| Metric | Count |
|--------|------:|
| `clamp()` callsites instrumented | 147 |
| Load-bearing (≥1% bind rate) | 45 |
| Guards (<1% bind rate) | 70 |
| Never called | 32 |

**Do not retire a rail from this list without a paired harness run and `pnpm gate`.**  
Phase 3.1+ is one rail per PR, measured before/after.

## Phase 3.1 — `cycleDev` rail retired ✅

**Change:** `market.ts` `tickMacro` — spring `-0.048 * cycleDev` on each step instead of pinning at ±1.

| Metric | Before | After |
|--------|--------|-------|
| `market:1527` at ceiling | 39.1% | **0%** (no longer load-bearing) |
| Load-bearing clamps total | 45 | 41 |
| `pnpm cycle-dev` pin rate | — | 0% at ±1 |

Harness: `pnpm cycle-dev` · Gate: `pnpm gate` green on branch.

## Phase 3.2 — Dev boost + lease-up clamps retired ✅

**Change:** `dev.ts` — construction advance boost uses `tanh` saturation; lease-up duration uses logistic curve (no `clamp()` at those sites).

| Site | Before | After |
|------|--------|-------|
| `dev:197` boost | 73% at ceiling | **Not load-bearing** (removed clamp) |
| `dev:895` leaseUpMarket | 50% at floor | **Not load-bearing** (removed clamp) |
| Order-book pick | `[0.33,2.5]` clamp (historical) | `startOwed` weights only |

Harness: `pnpm orderbook` · `pnpm mixmatch` for full report.

## Top load-bearing clamps (remaining)

These bind often enough that the number in code may not be the number doing the work.

| Where | Calls | Floor | Ceil | Code (truncated) |
|-------|------:|------:|-----:|------------------|
| market:2484 | 5,400 | 0.0% | 92.7% | `clamp(Math.pow(burden, -0.40), AFFORD_BAND…)` |
| market:2480 | 1,800 | 0.0% | 92.5% | afford band low tier |
| market:3242 | 7,200 | 65.1% | 22.3% | `softW = clamp(gap / 0.03, 0, 1)` |
| dev:197 | 121,003 | 16.8% | 68.3% | lease-up boost clamp |
| market:3277 | 7,182 | 0.0% | 82.7% | `cheapFloor` when dev < 0 |
| market:1765 | 1,800 | 0.0% | 76.4% | jobs vs frictional unemployment |
| market:3051 | 7,200 | 64.0% | 3.9% | `concTarget` concentration |
| dev:895 | 96,916 | 48.0% | 3.1% | `leaseUpMarket` |
| demand:900 | 3,824 | 28.2% | 10.2% | demand score clamp |
| zoning:75 | 1,800 | 32.0% | 0.0% | rent pressure in rezoning |
| zoning:153 | 26 | 26.9% | 0.0% | upzoning probability |
| zoning:156 | 26 | 7.7% | 0.0% | `FAR_FLOOR` / `FAR_CEIL` step |

## Suggested retirement order (not implemented here)

1. **market afford bands** (2480–2484) — largest ceiling binds; needs paired macro audit  
2. **dev:197 boost** — 68% ceiling bind on lease-up  
3. **market:3242 soft vacancy wedge** — floor+ceiling both active  

## Coverage gaps

`clampA`, `clampL`, `clampN`, `clamp01`, and hand-written `Math.max/min` pairs are **not** instrumented.  
See full `pnpm rails` output for the UNINSTRUMENTED section.

## Re-run

```bash
cd broadway-and-wall
pnpm rails                    # default N=3, HZ=600
N=6 HZ=720 node tools/rails.mjs   # wider sample
BIND=0.02 node tools/rails.mjs    # stricter load-bearing definition
```
