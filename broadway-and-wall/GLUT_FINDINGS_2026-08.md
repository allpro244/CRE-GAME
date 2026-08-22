# What a supply glut does to this city, and to your rent roll

Measured with `pnpm glut` and `pnpm vacdist`, against a set of real-world
numbers **pre-registered before any engine output was read**, and then attacked
by six independent skeptics whose job was to refute the findings rather than
confirm them. Four of the six original claims did not survive. What is below is
what did, plus what the attack found that nobody had gone looking for.

## The experiment

One finished, empty building equal to 10 / 25 / 40 per cent of a class's
citywide stock, dropped on a good lot in a rival's hands at month 60, watched
for twelve years. Every reading is TREATMENT against its own PAIRED CONTROL on
the same seed, at a FIXED MONTH, in NOMINAL terms, with a PLACEBO band beside
it. Five seed pairs. The player owns twelve buildings of the class spread
across the demand gradient and answers every letter at asking, so the numbers
measure the market and not a bot.

**The placebo band is not decoration.** One shared stateful stream drives the
whole world, so changing the number of `rng()` draws re-rolls the century. A
null arm that injects zero square feet and burns a handful of draws moves face
rent by ±2pp at month 12, ±7pp at 36, ±9pp at 60 and **±30pp at 96 and 120**.
Nothing this experiment says past about five years is evidence. The first cut
of the harness reported minima over 144 monthly draws and its headline sat
inside that null.

## What happens to rents

| class | dose | peak vac | face @36 | eff @36 | face's share | eff/face m6 / m12 / m24 |
|---|---|---|---|---|---|---|
| office | 10% | 16.8% | −16.7% | −19.8% | **85%** | 3.03× 2.10× 1.38× |
| office | 25% | 26.8% | −30.5% | −40.2% | **77%** | 3.41× 2.06× 1.49× |
| office | 40% | 34.7% | −28.4% | −38.4% | **75%** | 3.46× 2.20× 1.49× |
| retail | 10% | 17.8% | −24.4% | −33.0% | **76%** | 3.63× 2.07× 1.50× |
| retail | 40% | 35.4% | −28.1% | −38.0% | **74%** | 3.79× 2.02× 1.52× |
| multifamily | 10% | 11.8% | −19.7% | −24.1% | **81%** | 3.82× 2.17× 1.51× |
| multifamily | 40% | 30.6% | −28.8% | −30.6% | **77%** | 4.39× 2.24× 1.43× |
| industrial | 10% | 12.9% | −21.0% | −26.3% | **86%** | 7.77× 3.68× 1.62× |
| industrial | 40% | 31.6% | −28.7% | −38.7% | **74%** | 6.16× 2.70× 1.65× |

Three things in that table are RIGHT and worth saying so.

**The concession channel opens correctly.** Net effective falls 3–4× as far as
face in the first six months and about 2× at a year, which is the documented
shape. Industrial is steeper because it has almost no fit-out leg, so the whole
concession is free rent.

**The rate at which asking rent falls saturates, and that is deliberate and
sourced.** `market.ts` caps it off Manhattan 1990-92 (~9pp of excess, −14%/yr)
and Houston 1983-87 (15–20pp, −16%/yr): "twice the glut, a tenth more decline."
The record agrees with the cap.

**Duration carries the rest, which is the promise that cap makes.** A 10%
office glut spends 2 months more than five points over natural and clears in 82;
a 40% glut spends all 144 and has not cleared when the window shuts.

**The level is defensible.** 2.0% of face per point of vacancy sits between the
two anchors the record offers — Houston 2014-17 at 0.11%/pp and Manhattan in
the 1990s at 2.5–7%/pp.

## What happens to the buildings you own

Office, 40% dose, against the paired control:

- occupancy 72.3% → 61.7% at the trough, −12.1pp against control
- new square feet let per month **falls** in every window (−333, −362, −342, −239)
- letters per month falls (−0.17 to −0.62)
- gross new leasing over five years 49k sf against 61k in the control
- net absorption on your book −23k sf against −4k
- your in-place rent roll $30.18 → $15.72 as leases roll, against $31.74
- a vacant foot waits 78.6 months to be re-let, against 69.6 in the control
- the rival's building is 75% let after twelve years

New deals in the glut sign at 4.8 months free on a 5.4-year term (7.4% of
contracted months) with $18.2/sf of fit-out, NER 19.2% under face. Renewals get
2.2 months and $11.2/sf. In the control: 1.5 months and $7.9/sf on a new lease,
0.4 months and $3.1/sf on a renewal.

Flats have no letters — residential space runs on aggregate occupancy — so for
that class the occupancy path IS the leasing velocity. It moves: −3.1pp at the
10% dose, −14.3pp at 40%.

## The findings, ranked

### 1. Concessions have no memory. Face rent has nothing but.

At month 36 the headline rent carries **74–86% of the whole adjustment**, in
every class at every dose — twelve cells out of twelve, all clear of the
placebo null. The pre-registered falsifier, written before any of this was
measured, requires face to carry **at most 35%** over three years and to be
*able* to carry none of it. Manhattan carried 19% over four years, and national
asking rents carried roughly nothing while effective fell 11%.

The concession channel does not merely stop helping; past month 12 it hands the
cut back. At the 10% office dose the dial is at **0.00 by month 60 with vacancy
still 5.7pp above control**, and effective and face have converged exactly.

The cause is structural, not a coefficient. `concIdx` is a **level** function of
*current* availability against natural, so it returns to zero as absolute
vacancy normalises — while `rentIdx` **integrates** the same pressure into a
permanent compounding drift. One channel forgets and the other cannot.

*Category: a number asserted where a mechanism belongs.*

**The mechanism.** A concession is not a market-wide scalar that tracks this
month's vacancy — it is a term inside a signed lease, and it burns off when
that lease rolls, five or ten years later. Put the giveaway in the lease stock
and let it expire with the paper. Then the persistence the record shows arrives
for free, and the face index stops being the only thing with a memory.

The second half of the same mechanism: in life the face/concession split is
decided by **who owns the building and what their lender allows**. An owner
whose covenants and appraisal key off headline rent protects face and clears in
concessions; an owner already recapitalised or foreclosed has nothing left to
protect and cuts face. The rent drift in this engine — `cycleRent + cycleMom +
press + anchor + cycleJobs + escalation` — contains no balance-sheet, default
or REO term anywhere, so there is no state in which face carries none of the
adjustment. Every mute path requires a *tight* market.

### 2. The city does not live near its natural vacancy rate

`pnpm vacdist`, 8 seeds × 60 years, no player, no shock:

| class | natural | median | on the frictional floor | within 2pp of natural |
|---|---|---|---|---|
| office | 11.5% | **6.8%** | **27.6%** of months | 15.2% |
| industrial | 7.0% | **1.5%** | **89.3%** of months | 2.4% |
| multifamily | 4.5% | 3.3% | 19.2% | 48.5% |
| retail | 8.5% | 8.4% | 11.8% | **39.1%** |

US office vacancy has been at or above 12% for most of forty years. National
industrial ran 4–7% through the 2010s. A city that spends a quarter of its life
at 3.7% office and nine tenths of it at 1.5% industrial is not visiting the
tight tail, it is living there — and every counterfactual measured against that
city is measured against an extreme. The adversarial pass found this from the
other side: a third to a half of the "glut effect" in the first cut was the
*control arm rising*, not the treatment falling, because three control seeds in
five were welded to the floor and escalating.

Retail, in the same engine, is right. So this is not a modelling limitation.

*Category: a rail that is load-bearing rather than a guard.*

**The mechanism.** Frictional vacancy is not a floor, it is a **residence
time**: space stands empty because leases end and re-letting takes months of
marketing, negotiation and fit-out. Generate it from lease roll and re-let
latency and the 3–6% band falls out of the timing instead of being clamped
underneath it — and it stops being the answer whenever demand outruns what the
city can build.

### 3. The concession is expressed twice in the same deal

`useRentPsfYr` (value.ts) returns `effRentIdx` — the effective index, already
net of the giveaway — and `managedRentPsfYr` carries that into the LOI's
`rentPsf`. Free rent and fit-out are then applied **on top of it**. On stale
space `staleDiscount` cuts the same number a third time, and its own comment
says it stands in for a range measured "once free rent and allowances are
counted."

It costs nothing at balance, where the dial is zero. In a glut, where the index
is taking its full 14%, the deal's quoted "face" of $23.67 is an already
discounted number; grossed back up to true asking it is $27.52, and NER against
true asking is 69.5% — below the level any broker panel in the pre-registration
supports.

*Category: the same quantity with two different answers.*

**The mechanism.** Pick one place for the giveaway to live. The landlord quotes
**asking**; the lease carries free rent and TI explicitly; NER is *computed from
the signed terms*. `effRentIdx` then becomes a statistic derived from the lease
tape rather than an input that also prices leases. Valuation and feasibility go
on reading NER, correctly — they just read the NER the market actually signed.

This one needs a confirming measurement before it is built: re-run the lease
tape reporting both `rentIdx`-based and `effRentIdx`-based face for the same
deals, to be sure no downstream consumer already un-does the discount.

### 4. Tenant improvement is a construction cost that never reads the cost index

The comment above `tiPressure` argues that a fit-out is a construction cost and
"the contractor has not heard about the vacancy rate" — and `TI_ASK` is then the
only construction cost in `leasing.ts` that never multiplies by `econ.costIdx`,
unlike make-ready and spec suites a few hundred lines away, and unlike
development TI. The `^0.6` exponent is a reduced form standing in for a cost
channel that is simply absent.

*Category: a number asserted where a mechanism belongs.* Low severity.

**The mechanism.** Split the allowance into the two things it is: what the
build-out *costs* (contractor pricing, which moves with `costIdx` and is
famously counter-cyclical to leasing) and what share of it the landlord *eats*
(the cyclical negotiation). The exponent disappears rather than being retuned.

### Also, and it is a small one

The "ONE SOURCE OF TRUTH" comment above `concessionPressure` names tour depth as
one of the dial's three consumers. Tour depth is not on the dial — it reads
`vacancyPull()`, an unsmoothed raw-vacancy ratio with its own saturation. The
comment is false.

## What did NOT survive

Four claims were killed by the adversarial pass and are recorded so they are not
made again.

**"The effective index is the face index through an affine wire, so the ratio is
pinned."** Refuted on the algebra. `eff = R(1 − 0.14C)` gives
`ratio = 1 + g(1−f)/f` with two free inputs and range `[1, ∞)`; the measured
range is 1.00–7.77. The claim's evidence was a month-12 slice, which is the one
window where the concession chase is converged and the face EMA is not — it
measured a ratio of two time constants.

**"Face rent is far too sensitive to vacancy."** Refuted by the placebo, which
reaches the exact number that was being reported. Also CPI-deflated across arms
whose price levels diverge 39%, and the two quoted numbers were read at
different months. The corrected reading is 2.0% of face per point of vacancy,
which is *between* the record's own anchors.

**"The concession dial's ceiling sits below documented distress."** Refuted, and
the sign is the other way. As a change, 0 → 14.0pp matches the largest documented
drift exactly. The defect is at the **origin**: the dial sits at exactly zero in
58–62% of quarters, asserting no concessions at all in a market at natural
vacancy, where the record documents a standing 6.1%-of-term package and NER at
83% of face. The engine's balanced market is ~12pp more generous to the landlord
than the record; its distressed end is only ~5pp shy.

**"TI and free rent cannot rotate against each other."** Refuted. `conc^0.6`
against a linear free-rent term is a 2.4× rotation across the dial's range, with
TI's share of concession value falling 51% → 40% as the dial opens — which is the
documented sign. A TI-compression state is reachable and was measured.

## Open, and honestly open

**The vacancy-to-asking elasticity cannot be scored yet.** The pre-registered
evidence contradicts itself by 20–60×: Houston 2014-17 gives 0.11% of face per
point of vacancy; Manhattan gives 2.5–7%. The engine sits between them. No
coefficient here should be touched until someone assembles a panel conditioned
on the things that plainly differ across those episodes — depth of the move,
market tier, and whether the landlord cohort was financially intact.

**The shortage-side mirror now exists: `pnpm shortage`.** It splits vacdist's
pile into growing vs declining seeds and injects a jobs shock as the inverse
of this file's building dump. The clauses are a report, not a gate — they
print FAIL on the current engine. Findings and the four causes are in
`SHORTAGE_FINDINGS_2026-08.md`. Do not silence a clause by retuning a
coefficient.
