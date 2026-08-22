# BUILDING QUALITY — WHAT THE MEASUREMENT SAYS AND WHAT TO DO ABOUT IT

Handoff plan. Written 2026-08 off a six-seed probe on branch
`claude/rent-graph-accuracy-check-5zpd5d`. Read CLAUDE.md first: the rules
below are downstream of it, and two of them exist to stop the obvious "fix"
(turn a coefficient until the strategy wins) which is the exact thing that file
forbids.

## What was measured

Six seeds × 25 years × 8 office buildings, identical books, unlevered, every
letter signed at asking, the quality dial the only difference between arms.
Probe: `scratchpad/quality.mjs` in the session that produced this file — port
it to `test/quality-arms.mjs` as step 0 below.

| arm | rent achieved ÷ index | occ | cum NOI | capex | NOI − capex |
|---|---|---|---|---|---|
| strip — defer plan, lean service | 0.74 | 68% | $105M | $12M | $93M |
| baseline — fund, market | 1.16 | 75% | $161M | $21M | $140M |
| institutional service | 1.15 | 77% | $170M | $21M | $149M |
| reposition plan (1.8× reserve) | 1.23 | 78% | $190M | $31M | $159M |
| capital programs (lobby/systems/facade) | 1.40 | 77% | $213M | $48M | $165M |
| gut renovation when eligible | 1.21 | 73% | $155M | $113M | $42M |

Terminal net worth does NOT rank these — per-seed multiples run 3.0x to 12.9x
*within a single arm*, which is wider than every arm gap combined, because the
exit lands wherever the cycle lands. **Rank on NOI − capex and on the rent and
occupancy columns; treat terminal wealth as noise until an arm moves it on 5 of
6 paired seeds.**

## Already balanced — do not touch

- **Stripping loses.** Defer + lean ends at the condition floor (obsolete,
  0.62× rent), gives up 36% of achievable rent and 7pp of occupancy, and is
  behind baseline on 5 of 6 seeds. Free today, ruinous over a hold — which is
  what the code comments claim and what the numbers do. Correct.
- **The reserve dial is a real decision.** Fund holds the line, reposition buys
  ~+$29M of NOI for ~+$10M of capex over 25 years and a third of a condition
  grade. Sub-linear, slow, expensive, works. Correct.
- **The rent multipliers themselves.** CONDITION_RENT_MULT (0.62 / 0.82 / 1.0 /
  1.2), the programme costs per foot, RENO_COST_PSF, the decay rates. These are
  calibrated industry facts. Nothing below asks for one of them to be retuned,
  and a change that "fixes" an arm by moving one of them is the wrong change.

## The three faults, in priority order

### 1. A gut renovation is thrown away the month after it completes — BUG, not balance

`sim.ts` (~line 561) completes a renovation with `h.condition = "good"`. It
never touches `h.condIdx`. `tickLeasing` (`leasing.ts` ~1350) recomputes
`h.condition = condGrade(h.condIdx)` every single month from the index that was
never lifted, so a $210/sf gut buys **one month** of "good" and then reverts to
the grade the building had before the scaffolding went up.

That is the whole explanation for the last row of the table: $113M of capex
against $42M of net, worse than doing nothing on every seed, one seed outright
negative. It is not a balance problem and it must not be fixed with a
multiplier.

**Do:**
- On completion set `h.condIdx` to the building's ceiling — `condCeiling(rec,
  s.month)` — and derive `h.condition` from it, so one code path owns grade.
  Nothing else in the tick needs to know a gut happened.
- Decide, and write down, whether a gut moves the BONES. `condCeiling` reads
  `yearBuilt` and `buildSpec` only, so today an old building can never be
  brought near the top of the market however much is spent — which is right for
  floor-to-floor height and wrong for a full re-clad and re-plant. Recommended:
  a gut lifts `buildSpec` toward (not to) modern — e.g. `buildSpec = spec + 0.4
  × (0.75 − spec)` when spec < 0.75 — and leaves `yearBuilt` alone, so the
  ceiling rises but a 1928 building never becomes a 2015 one. Say in the
  comment which real thing each half of that models.
- Only after those two: re-measure. If the gut arm is still dominated, the
  remaining suspect is the 35%-roll-burn gate plus six months of zero income,
  not the price.

**Decision recorded (2026-08, `sim.ts` completion):** a gut **does** move the
bones, toward modern, not to it. `yearBuilt` stays put — a 1928 building is
still a 1928 floorplate, slab-to-slab and core, which no cheque retrofits.
`buildSpec` steps `spec + 0.4 × (0.75 − spec)` when spec < 0.75 — that is the
re-clad and re-plant. Then `condIdx` is set to `condCeiling` of the lifted
spec and grade is read from the index. No multiplier.

### 2. Capital programmes may be paid once and counted three times — VERIFY FIRST

One programme cheque currently moves three separate things:
- a rent multiplier in `managedRentPsfYr` (lobby ×1.04, facade ×1.08),
- `PROGRAM_LIFT` on `condIdx`, which moves `CONDITION_RENT_MULT` — rent again,
- an arrival factor in `absorption.ts leaseFactors` (lobby ×1.08, facade ×1.06).

The third is a different channel (velocity, not price) and is legitimate. The
first two are both price. Programmes reach rent 1.40× the index against
baseline 1.16× — the largest rent effect of any arm, for the middle capex — and
double-counted price is the obvious candidate.

**Do:** instrument it before changing it. Print, per arm, the decomposition of
achieved rent into condition multiplier × programme multiplier × everything
else. If the same cheque is priced twice, keep ONE channel — the condition lift
is the more honest one, since it is the thing that decays and has to be
re-bought — and delete the explicit rent multiplier, leaving the arrival factor
alone. If it turns out they are not the same cheque (systems has no rent
multiplier at all), say so and close it.

**Decision recorded (2026-08, `pnpm quality-arms` on a generated city):**
same cheque twice. 1940 office, spec-as-is: condition lift 1.20× baseline,
explicit lobby×facade 1.12×, both 1.35× (+12.3% on top of the condition
channel). Explicit multipliers deleted from `managedRentPsfYr`. Arrival
factor in absorption.ts left alone. Systems never had a rent multiplier.

### 3. Institutional service looks free, and under net leases it may literally be

The arm costs 12% more opex and returns +2pp occupancy and +$9M of NOI, i.e. it
pays for itself and then some. Check `recoveryOf` — office LOIs are drawn `net`
~80% of the time, so an NNN tenant reimburses controllable opex. If the service
upgrade is recovered from the tenant while the occupancy and covenant benefit
accrues to the landlord, the dial is not a trade-off at all and there is no
decision in it.

**Do:** measure the recovered share of the service delta. If it is high, the
fix is not a smaller `opex` multiplier in `OPS_SERVICE` — it is that a service
level above market should have an unrecovered component (the part a landlord
spends to keep a building better than the lease requires, which is precisely
what is not billable). Model that, and let the arm land where it lands.

**Decision recorded (2026-08):** `recoveryFor` now bills `recoverableService`
— `min(service, 0)`. Lean recovers lean. Market and institutional recover
the market controllable bill. The extra 12% on institutional service is an
unrecovered amenity. `OPS_SERVICE` multipliers untouched.

## Do not

- Do not tune any coefficient until the arms come out level. They are not
  supposed to come out level — a well-run building SHOULD beat a stripped one,
  and the spread between fund / institutional / reposition / programmes is
  currently inside the noise, which is a defensible place for four legitimate
  strategies to sit.
- Do not rank arms on terminal net worth. See above.
- Do not touch `CONDITION_RENT_MULT`, `RENO_COST_PSF`, `PROGRAMS[].costPsf` or
  the decay rates. Every fault above is a wiring fault.

## Order of work

0. **Port the probe to `test/quality-arms.mjs`** (`pnpm quality-arms`) with the
   six arms, paired seeds, and NOI − capex / rent ÷ index / occupancy as the
   reported columns. It must print per-seed paired differences, not just means —
   the means are what made two of these arms look decided when they are not.
   No new gate: this is a report, same as `pnpm report`.
1. Fault 1, the gut. Bug fix, largest effect, no calibration argument.
2. Fault 2, the programme decomposition. Measure, then decide.
3. Fault 3, the recovery question. Measure, then decide.
4. Re-run `pnpm quality-arms`, `pnpm conserve`, `pnpm gate`, `pnpm report`, and
   `pnpm rent-chart`. Regenerate `BASELINE.json` and say in the commit which
   moves were intended.

## Known open question, worth one paragraph in whatever you write

Everything above is unlevered. Leverage multiplies the NOI differences into the
equity return and could reorder the middle four arms outright. A levered arm
(say 60% LTV, held to maturity) is the obvious follow-up run and was not done.
