# DOES THE CITY'S RENT ANSWER ITS VACANCY? — FINDINGS AND PLAN

Handoff plan. Written 2026-08 off two read-only probes on branch
`claude/rent-graph-accuracy-check-5zpd5d` (`scratchpad/vacrent.mjs`,
`scratchpad/vacrent2.mjs` — port them, step 0). Six seeds x 50 years, no
player, all three commercial classes. Read CLAUDE.md first: the central finding
here is a RAIL THAT IS LOAD-BEARING, which is fake number five in that file,
and the fix is not to retune the curve behind it.

## What is already right — do not touch

- **The sign and the monotonicity.** Asking rent rises when the market is tight
  and falls when it is soft, in every class, at every bucket of the vacancy
  gap. Office: +5.34%/yr at 3pp tighter than natural, −2.20%/yr at 3–6pp
  softer. Nothing here is backwards.
- **Duration is priced.** Office glut episodes (median 8.3 years) run −3.1% in
  year 1, −7.7% in year 2, −5.8% in year 3, −3.5% in year 4+. A glut that
  persists keeps repricing; `capitulation()` is doing its job.
- **The real-rent adjustment.** Against wages, soft markets run −5 to −6%/yr
  and tight markets +1.2%/yr. Sticky nominal face rents with the adjustment
  arriving in real terms is what real markets do. **Any fix must be measured in
  BOTH nominal and real terms** — a change that makes the nominal cut look
  dramatic while breaking the real path has made things worse.

## The fault: the deep-glut curve never reaches the tape

`market.ts` fits a convex glut response — `glut(gap) = gap*0.070 + gap²*0.85`,
continued past `FIT_MAX = 0.09` by a C1 asymptote to `DEEP_RATE = 0.0155/mo`,
commented as *"−18.6%/yr, the Houston 1983-87 asymptote."* At +10pp of excess
vacancy that instant term is worth roughly −15%/yr.

What actually arrives on the index is **−2.2%/yr**, and it does not deepen with
the glut:

| gap over natural | office asking %/yr | retail | multifamily |
|---|---|---|---|
| +3 to +6pp | −2.20% | −1.81% | −1.08% |
| +6 to +10pp | −2.51% | −1.39% | −5.57% |
| > +10pp | −2.16% | −1.39% | −9.21% |
| **extra depth buys** | **0.04pp/yr** | **0.42pp/yr** | **−8.13pp/yr** |

Office and retail are flat in depth. Multifamily is not — which is the proof
that this is not a design-wide decision about stickiness but something specific
to how the office and retail path is being throttled. Two suspects, both
downstream of the curve:

- `e.rentPress[k] = clamp(..., -0.008, 0.0075)` — a hard rail at −0.008/mo
  (−9.2%/yr) on the lagged pressure EMA, plus a second `clamp(e.rentPress[k],
  -0.008, 0.0075)` at the drift line. A −15%/yr instant term cannot survive
  either.
- the EMA itself (`RENT_PRESS_TAU` 8 months for office) averaging the spike
  away before it is ever applied, while `escalation` (CPI) and `anchor` (income)
  push the other way every month.

Related, same root: **30% of soft-market years (gap > +3pp) show asking RISING**
— 32% retail, 24% multifamily, 35% for the effective index.

## What to do

**Do not** change `DEEP_RATE`, `glut()`, `FIT_MAX` or `CAP_VAC_BETA`. The curve
is anchored to Houston 1983-87 and Manhattan 1990-92 and is the honest part.
The question is why a fitted curve is being delivered at a seventh of its size.

1. **Instrument the path, don't guess it.** For each month of a glut, log the
   four quantities in order: `vacTerm` (instant), `rentPress` after the EMA
   step, `rentPress` after the clamp, and the final `drift` with `escalation`,
   `anchor`, `scarcity` broken out. Run it over the office episodes the probe
   already identifies. The answer to "which of the two suspects is it" falls
   straight out, and it may be both.
2. **Count how often the rail binds.** CLAUDE.md's rule: a clamp is a guard
   when it never fires and a fake when it is load-bearing. Measure the share of
   glut-months in which `rentPress` rests on −0.008 per class. If office sits on
   it through gluts and multifamily does not, the rail IS the finding, and the
   fix is to size it from something real (the fastest asking-rent decline on
   record, per class) rather than one number shared by four markets.
3. **Then decide where the depth response should live.** Options, in the order
   I would try them: (a) let a deep glut bypass or widen the press rail, since
   the rail exists to stop a shortage tax compounding, not to stop a
   capitulation; (b) shorten `RENT_PRESS_TAU` when the pressure is negative and
   large — landlords reprice a collapse faster than they reprice a boom, which
   is the asymmetry the model currently has backwards; (c) mute the CPI
   escalator harder at deep gaps, since `softW` already saturates at +3pp and
   therefore stops distinguishing bad from catastrophic. Whichever is chosen,
   say in the comment which real-world behaviour it models.
4. **Re-measure the whole table**, nominal and real, both directions, all three
   classes. The acceptance shape: office depth should buy meaningfully more than
   0.04pp/yr; the share of soft-market years with rising asking should fall well
   below 30%; and the tight-side numbers, the episode-by-year numbers and the
   real-terms numbers above must all still stand.

## Context that must survive the fix

The city spends most of its life tight — median office vacancy 8.3% against a
natural rate of 11.5%, 56% of months more than 2pp tighter than natural against
27% more than 3pp softer. So the up-response sets the long-run level and the
down-response rarely gets to correct it. **If the supply side is why the city is
chronically tight, then fixing the rent response alone treats the symptom.**
Worth one probe before step 3: is the tightness real scarcity (jobs outrunning
floors) or a pipeline that never delivers? `sitePencil`, `structTight` and the
`supplyShut` branch in `market.ts` already exist to answer it.

**Measurement recorded (2026-08, generated city, 2 seeds × 12 years,
`pnpm vac-rent`):** the soft rail (−0.008/mo) is **not** load-bearing on
office (6% of soft months) or retail (0%). Multifamily binds more (21%) and
is the class that already deepens. Office vacTerm ≈ EMA ≈ clamped press
(−0.246 / −0.237 / −0.235 %/mo) — the 8-month EMA is not averaging the
spike away. Deep-bucket nominal (−1.82%/yr) is *weaker* than all-soft
(−3.38%/yr): that is composition (deep months sit late in an episode, after
`capitulation` has decayed), not the rail. Do **not** widen or delete the
clamp on this evidence; a change that makes the nominal cut look dramatic
while breaking the duration path would be the wrong fix. Re-run at 6×50
before touching `RENT_PRESS_TAU` or the CPI mute.

## Order of work

0. Port the probes to `test/vac-rent-response.mjs` (`pnpm vac-rent`): the
   bucket table, the episode-by-year table, the depth-response deltas, nominal
   and real, per class. A REPORT, not a gate.
1. Step 1 instrumentation. 2. Step 2 rail count. 3. Step 3 fix. 4. Step 4
   re-measure, plus `pnpm conserve`, `pnpm gate`, `pnpm report`,
   `pnpm rent-chart`, and regenerate `BASELINE.json` saying what moved and why.

Measured on the branch above, which carries the asking/effective concession fix
(`faceGrossUp`, `CONC_DEPTH`). That changed what desks quote and what the
effective index means; the `rentIdx` mechanism described here is untouched by
it, so every finding applies to main as well.
