# Shortage findings — August 2026

Demand growth is not overpowered. Supply cannot overshoot in a growing city,
so growth ⇒ permanent shortage. This is the glut file's missing half:
`GLUT_FINDINGS_2026-08.md` finding 2 and `REALISM_AUDIT_2026-08.md` finding 2
already named the floor; nobody had split the seeds or injected the jobs.

Harness: `pnpm shortage` (`test/shortage.mjs`). Report, not a gate.

## Measurement

Re-run on this tip, `pnpm shortage`, 8 seeds × 60 years, `E.frictionFloor`
(vacdist had been using a swapped ratio — industrial 0.32 vs the engine's
0.22). Claude's all-seed office pile is bit-identical; industrial floor-share
moves 3pp because the floor is the engine's.

| | all seeds | growing (3) | declining (5) |
|---|---|---|---|
| office within 2pp of natural | **5.5%** | 12.2% | 1.5% |
| office on the frictional floor | **13.6%** | 22.9% | 8.1% |
| office more than 10pp over natural | **44.9%** | 12.9% | **64.2%** |
| office stock | ×1.07 | **×1.77** | ×1.05 |
| industrial on its friction floor | **52.2%** | **87.9%** | 30.8% |
| industrial stock | **×1.01** | ×1.01 | ×1.00 |

Two states, not a market — but the split is not "growing office lives on
the floor." Growing office **does** build. Growing industrial does not
(87.9% pinned, stock ×1.01, zero M lots). Declining office lives in glut
(64.2% of months more than 10pp over natural).

Jobs shock, 15% of headcount at month 60, paired control, 12 years:

- Month 36: both arms on the 3.7% office floor. Treatment stock −0.4%.
- Months from year 3 on with vacancy above natural: **0.7%**.
- Face +10.5% by month 143; extra starts +102k sf. No overshoot.

New office floor the month it opens is already at the friction fill only
9.2% of the time (median occ/stock 90.5%). The pool cap does not
instant-fill deliveries; it is why a jobs boom never leaves a queue a
crane could overbuild.

Plat: **0 M-zoned lots**, 403 fringe-C lots that may take a shed. Industrial
starts on declining seeds median 26k sf over 60 years; on growing seeds
411k — and stock still ×1.01. The fringe-C permit is not reaching the map.

## Four causes, read from source

Not coefficients. Line numbers drift; the names do not.

### 1. Industrial land barely answers

The shipped plat has **zero M-zoned lots**. `zonePermits` used to exclude
industrial from all C land. Fringe C (`demand < 45`) now permits a shed
(`dev.ts` `refreshDevelopmentFeasibility` / `zonePermits`), which is why
the floor-share fell from the 89% in GLUT_FINDINGS #2.

`tickZoning` still computes tightness from **office** vacancy and **office**
rent only (`zoning.ts`). An industrial shortage never reaches the zoning
map. Stock that grows 1% in six decades is not a market.

**Mechanism:** land answers an industrial shortage the way it answers an
office one. Either the residual decides on fringe C (already half-done) or
`tickZoning` creates M-land under chronic industrial scarcity.

### 2. The looking pool is capped by live stock

`market.ts`: `poolTarget = min(targetRaw, housable + searchFringe)`.
`housable` is `stock * (1 - friction)`. New supply raises the cap and the
pool fills the same month. Desired demand never stands in a queue a crane
could overshoot.

This was added to stop unhousable demand minting scarcity rent from tenants
who do not exist. The side effect is that a growing city cannot overbuild:
every new foot is already spoken for.

### 3. Frictional vacancy is a clamp, not a residence time

`market.ts`: `cityVac = clamp(1 - occupied/stock, friction, 0.45)`.

A real frictional vacancy is months of marketing, negotiation and fit-out
after a lease ends. Imposed as a floor, it is the answer whenever demand
outruns what the city can build, and the shortage escalator runs off it.
GLUT_FINDINGS #2 said this. It is still true.

### 4. No extrapolative underwriting

`devPencils` (`value.ts`) underwrites **spot** `effRentIdx`. `rentExp`
already exists — a 21-month EMA — and the land residual already reads it.
The start decision does not. The order book decays `17/18` a month
(`market.ts` `startOwed`), so a pipeline cannot hold a boom long enough to
overbuild it.

Developers in life underwrite the rent they expect at delivery. The comment
in `market.ts` already says so. The function the order book calls does not
do it.

## What is not the fault

- Demand elasticities. Growing seeds have demand. The problem is that
  supply cannot run past it.
- The glut-side concession / face split. That is `pnpm glut` and the
  rent-chart work. This file is the other tail.
- Industrial as a hard zero. That was REALISM_AUDIT #2. Fringe C closed
  the hard zero. The class is still frozen.

## Proposed order

1. **This harness.** Done. `pnpm shortage`.
2. **Let land answer industrial shortage.** `tickZoning` must see
   industrial scarcity, or the residual must be allowed to pick a shed
   anywhere it outbids. No coefficient.
3. **Frictional vacancy as residence time.** Generate it from lease roll
   and re-let latency. Retire the clamp as a load-bearing rail.
4. **Starts underwrite `rentExp` at delivery.** The number already exists.
   `devPencils` should read it the way the land residual does.

Do not retune a constant to silence a clause. The clauses stay red until
the mechanisms land.
