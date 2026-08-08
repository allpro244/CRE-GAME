# HANDOFF — the 21-item backlog

State of the branch `claude/phase-1-implementation-v4c2az` as of commit
`cdbd1bd`. Written to be picked up cold by a session with none of the
conversation behind it.

Read `CLAUDE.md` first — it is the standard everything here is measured
against, and several items below exist only because it was applied.

**Two things in the list below were WRONG when it was written, and both were
wrong in the same way — they described a measurement nobody had re-run.** Item
3 asserts test G is breaching; G passes, on this build and on the build the
list was written against, because G had already been rewritten to measure the
policy rate instead of the loan index. Item 1 attributes a 93.3% drawdown to
the rent equation; the drawdown was 48% at the time and the cause was two files
away. Re-measure before you believe anything here, including this sentence.

---

## HOW TO START

```
cd broadway-and-wall
pnpm install
# the harness bundle is gitignored and MUST be rebuilt before any probe:
./node_modules/.bin/esbuild test/.entry.ts --bundle --format=esm \
  --platform=node --outfile=test/.engine.mjs
pnpm gate          # conserve + extleak + city invariants. The real gate.
pnpm report        # the lettered tests. Reports, does not block (owner's call).
```

`test/.entry.ts` is also gitignored and does not survive a fresh clone.
If it is missing, recreate it as 22 `export * from "../src/engine/<mod>"`
lines — see the header comment in any harness for the list.

**The container in this project has been reclaimed three times mid-session.**
Every time, the working tree came back on the wrong branch with none of the
work in it. It was always safe on the remote. Push early and often.

---

## THE STATE OF THE GATES

| | |
|---|---|
| `pnpm gate` | passing — 3/3 measurements in band, 1/1 identities hold |
| `conserve` | clean, all ten ledger categories live |
| A (location spread) | **breached — 1.94x against a 2.0x band, see below** |
| F (income anchor) | **breached — industrial +1.99%/yr, retail −1.62%/yr, see item 2** |
| B–E, G, H, I, J–M | in band |
| `pnpm crews` | new — the construction market's own harness, see item 1 |
| `pnpm vactails` | new — both vacancy tails: which end is a market and which is a clamp |
| `pnpm sectorexit` | new — does the exit ratchet fire on exoduses or on shortages |

**F's breach is exposed, not created.** Retail was already outside the band at
`69de9bf` (−1.09%/yr). Industrial's is new and it is the point: the exit ratchet
had been deleting a quarter of industrial demand during a permanent shortage,
which held the number inside the band by removing the tenants rather than by
housing them. Item 2 carries the full paired table and the anchor for the real
fix. `pnpm gate` passes throughout.

**A is the one breach and it is a real shift, not noise: it fell on all three
seeds (2.31/3.15/2.46 → 1.94/2.82/1.69).** A city that can build compresses the
rent premium between its best and worst locations, which is what a supply
response is supposed to do — Manhattan's spread is what it is because Manhattan
cannot build. Left breaching and the measurement left unweakened. Whether 2.0x
is the right band for a city with a working construction market is a policy
call and belongs to the owner; prime-to-secondary office in a real metro runs
about 2–3x, so it is close either way. Note also that A is a THREE-seed median
with a per-seed spread of 1.1x against a 0.06x miss, so on its own it could not
have told you anything — it is the paired per-seed comparison that makes it
real.

---

## THE LIST

Ordered by what I would do next, not by number. Items 1–4 are the ones I
believe are load-bearing for everything else.

### 1. The rent cycle — PART DONE, and the headline number got worse
Half of this is fixed and the fix is committed (`cdbd1bd`, and see
`pnpm crews`). The other half is now a much better-posed question. Read the
commit message; it carries the full paired A/B.

**What the original entry got wrong.** The 93.3% figure could not be
reproduced. Measured on 24 paired seeds at the time the list was written, the
worst real office drawdown ran p25/median/p75 of 40.3 / 48.4 / 59.0%, which
straddles the 50–60% Manhattan anchor rather than blowing through it. The
$14→$95 swing is a NOMINAL series over fifty years of inflation. Whatever
produced 93.3% was measuring something else, and chasing it would have been
chasing a number.

**What was actually wrong, and is now fixed.** Not the rent equation — the
construction market two files away. `crewCapacity` in `dev.ts` was a hard
ceiling on simultaneous jobs derived from lot count, and it was load-bearing:
the town wanted a median 2.7 cranes for every one it could run and its headroom
was exhausted in 64–88% of months. Worse, the cost of building priced off the
share of stock *under construction* — the quantity AFTER that wall had rationed
it — so the price channel could not see a boom (corr with demanded quantity
0.13, against 0.50–0.83 with supplied quantity) and real construction cost FELL
0.3–2.2%/yr for fifty years in a town desperate to build. Backwards, which
`CLAUDE.md` rates worse than broken. The trades are a market now: a workforce
that follows the work, priced off how booked it is, pivoted at full employment.
Stock growth went 0.47 → 0.85%/yr and real cost is flat, which is the real
ENR-against-CPI record.

**And it made the drawdown deeper: 48% → 69% median.** Kept, not reverted, per
`CLAUDE.md` — and it is the most useful thing measured this session, because it
says what the wrong number was propping up. The wall had been suppressing this
city's vacancy cycle by four points of swing (15.5 → 19.8pp peak-to-trough).
The rent response in `market.ts` (~line 2121) has a superlinear glut branch
calibrated at SEVEN TO NINE points over natural — that is what its own comment
cites, 1990-92 and 2020-23 — and availability now reaches 13.6 points over. A
quadratic extrapolated 50% past its fit range is doing the damage: at 9pp it
delivers −14.7%/yr, which matches 1990-92, and at 13.6pp it delivers −26%/yr,
which matches nothing.

**Both tails were measured (`pnpm vactails`) and one of them is now fixed.**

The GLUT tail was a fit evaluated 2.6x outside its own range — the quadratic
carries every anchor between five and nine points over natural and was being
asked for −76%/yr at 23.5 points. It now saturates on the Houston 1983-87 rate
past the fit boundary, C1-continuous, nothing below nine points touched
(`c34f8e8`). Paired over 24 seeds the drawdown fell on 18 and rose on 5,
sign-test p=0.011, median −3.98pp; seeds carrying an 80%+ drawdown went 9/24 to
5/24 and p75 went 84.3 → 72.8. A straight tangent was tried first and rejected
on the record — it still reaches −45%/yr, and measured it was a coin flip.

**The TIGHT tail is the bigger half and it is still open. It is a load-bearing
rail, and the numbers are not marginal:**

| class | floor | % of months ON it | longest stretch |
|---|---|---|---|
| office | 3.68% | 11.7% | **119 months** |
| industrial | 1.54% | 33.4% | **131 months** |
| multifamily | 1.35% | 9.8% | 73 months |
| retail | 2.72% | 3.4% | 29 months |

`p01 = p05 = the floor exactly` for three of four classes — that distribution is
truncated, not sampled. The real constraint is not the `cityVac` clamp but the
line above it, `occupied = clamp(occupied + absorb, 0, housable)` with
`housable = stock * (1 - friction)`; the vacancy clamp is downstream of that
and redundant.

**A CORRECTION TO `801f844`, which overstated this.** That commit said the land
residual's `vacDisc` reads `cityVac` raw and is pinned by this rail. It reads it
raw and is NOT pinned by it: `vacDisc = 1 - 1.2 * Math.max(0, cityVac - natural)`
is identically 1 for every vacancy below natural, so the tight rail cannot reach
it. Only the glut side touches land. The claim was wrong and this is the record.

**AND THE RAIL STACK IS REAL BUT IS MOSTLY NOT A FAULT.** `pnpm vactails` now
measures where each tightness signal stops responding, and every threshold sits
ABOVE the frictional floor:

| class | capRate pins | leaseUp pins | vacancy pins | % months below the first |
|---|---|---|---|---|
| office | 6.50% | 6.38% | 3.68% | **28.5%** |
| industrial | n/a | 3.88% | 1.54% | **54.7%** |
| multifamily | n/a | 2.50% | 1.35% | 24.7% |
| retail | 1.83% | 4.71% | 2.72% | 11.3% |

Before changing any of these, read the comment above the cap rate's `-0.6`
floor: *"Compression floors out at 60bp — nobody underwrites a shortage lasting
forever."* That is a stated economic reason for a SATURATING response, and a
saturating response is a mechanism, not a rail hiding a fault. It was left
alone deliberately. Uncapping it would need a real-world anchor saying how much
cap-rate compression a chronic shortage actually buys, and nobody has one here.
`vacancyPull`'s 1.7 ceiling has no stated rationale and is the weaker of the
two if somebody wants a target.

**What IS a fault is the DURATION, and it is a supply story, not a pricing
one.** Ten years unbroken at the absolute frictional floor is not a market. And
the worst offender names its own cause:

| class | 50y stock growth (6 seeds) | % months at the vacancy floor |
|---|---|---|
| office | +15% .. +85% | 11.7% |
| retail | +49% .. +93% | 3.4% |
| multifamily | +34% .. +102% | 9.8% |
| **industrial** | **−7.9% .. +12.8%, negative in 4 of 6** | **33.4%** |

Industrial is the one class whose stock SHRINKS over fifty years, and it is
pinned against its vacancy floor a third of the time with a 131-month stretch.
That is item 2 — the class that cannot be built is the class that is
permanently short. Do item 2 next; it is no longer a separate cosmetic
complaint about zoning, it is the remaining half of item 1.

**Ruled out, and stays ruled out.** The sector-exit ratchet (wrong timescale).
And now also: supply was not what set the PERIOD. The rent cycle ran 20.3 years
before and 19.3 after, while stock growth nearly doubled. The period is the sum
of the loop's lags — developer belief (`rentExp`, ~22mo), construction (30–44mo),
occupancy adjustment (~18mo), the capitulation clock (6mo) — plus the 90° the
rent integrator contributes, and the measured 55-month rent-behind-vacancy lag
is that integrator's signature. See the Barkhausen note already in `market.ts`
above the sublet block; somebody worked this out once and it is the right frame.

### 2. Zoning never changes — HALF FIXED BY ACCIDENT, and the other half is now item 1's remainder
The city cannot rezone. Industrial can only be built on M-zoned land (61 vacant
lots on the standard island), retail is a minority roll on C-zoned land, and
both are capped at two floors — correctly, a warehouse is single-storey.

**The numbers in the original entry are stale and the two halves came apart.**
Re-measured over 6 seeds x 50 years on the current build:

| | original entry | now |
|---|---|---|
| retail stock | 0.04%/yr | **+49% to +93% over 50y** |
| industrial stock | 0.12%/yr | **−7.9% to +12.8%, negative in 4 of 6 seeds** |

Retail was never really a zoning problem — it was the crew wall, and fixing the
construction market (`cdbd1bd`) fixed retail without anybody touching zoning.
Industrial did not move, because its constraint really is the zoning: there is
nowhere to put it and nothing taller than two floors to put there.

**So industrial is now the standout fault in the whole engine.** It is the only
class whose stock shrinks across a fifty-year run, and `pnpm vactails` has it
pinned against its frictional vacancy floor 33.4% of months with a 131-month
unbroken stretch — a class in permanent, unrelievable shortage. That is the
remaining half of item 1's drawdown story arriving through a different door: a
market that cannot clear on quantity clears on price, and industrial cannot
clear on quantity at all.

A real city facing quadrupled industrial rent rezones. Start here.

**AND THE SECTOR-EXIT RATCHET WAS HIDING HOW BAD THIS IS.** `pnpm sectorexit`
asks what vacancy was doing on the months the ratchet fired. Before the fix:
below natural on **91.3%** of office firings, 84.7% of retail and **93.4%** of
industrial — and industrial fired in 42.4% of all months with 43.4% of those at
its absolute frictional floor, median vacancy 1.8% against a natural of 7.0%.

Nine times in ten it was not modelling an exodus. It was modelling a shortage
and calling it an exodus, and `useForZone` then converted M-zoned land to
housing in proportion to how much had "gone" — one way, never back — removing
the capacity that would have relieved the shortage. Exit is now NET OF THE
QUEUE (you cannot have a waiting list and an exodus at once), which took
industrial's fifty-year shedding from 25.4% to 3.1% while leaving office's
mostly intact at 6.7%.

**What that revealed is the real number, and it is worse than the backlog
thought.** Test F, paired against `69de9bf`:

| class | before the fix | after |
|---|---|---|
| office | −0.72%/yr | +0.71%/yr |
| retail | −1.09%/yr ✗ | −1.62%/yr ✗ |
| industrial | +1.02%/yr | **+1.99%/yr ✗** (2.2x real over the run) |

Real wages grow 1.07%/yr. Industrial rent compounds at nearly twice that
because its demand is tied to TOTAL employment (`driver = e.employIdx`) while
its supply is zoning-locked — so a city that adds 50% more jobs is assumed to
want 45% more warehouse and cannot build a foot of it. The ratchet was quietly
deleting a quarter of that demand to keep the number down.

**Do NOT fix this by picking a decline rate that puts F back in band.** The
honest fix has an anchor and it is the one this codebase already cites in the
ratchet's own comment: New York, San Francisco and London each lost more than
half their manufacturing floor space between 1970 and 2010 — about −1.7%/yr —
and that happened for reasons that have nothing to do with rent (containers,
trade, productivity). It is a secular change in the COMPOSITION of employment,
so it belongs in the driver, not in a rent-triggered ratchet: industrial demand
should track industrial employment, and industrial's share of employment should
fall. Whoever does it should size it from that record and then report where F
lands, in that order — not the other way round.

### 3. G's unemployment clause — STALE ENTRY, and G passes
Re-run on both arms of a paired A/B, this build and the build this list was
written against:

    baseline   eases into unemployment  26/40 runs, median r −0.071  (need 24/40)
    after      eases into unemployment  28/40 runs, median r −0.056  (need 24/40)

G passes, and it passed before this session touched anything. The entry above
describes a version of the test that no longer exists: G had already been
rewritten to measure 12-month changes in the POLICY RATE over 40 seeds, which
is the direction the entry itself prescribes, and it reports what the BORROWER
feels through the loan index (11/40 base, 14/40 after) separately and
explicitly as non-gating. The handoff prompt's instruction to "leave G
breaching" is therefore void — there is nothing to leave.

**The estimator is still thin and that part of the entry was right.** 26/40 and
28/40 sit barely above the 20/40 you would get from a coin, so a build can
cross the 24/40 threshold in either direction without anything having changed.
If you want G to mean something, the work is in the estimator, not the rate
rule.

### 4. DONE — and the thread it pulled ran through the whole engine
**Read this entry first. Everything below it in this file was written before the
cost table was found to be wrong, and several entries are stale as a result.**

Four harnesses now cover this ground and all four are new:

    pnpm rails       every clamp() in the engine, and whether it is a guard or
                     the model — CLAUDE.md fault #5, measured. See below.
    pnpm breakeven   the rent each class NEEDS against the rent it gets,
                     computed by inverting the engine's own residual
    pnpm pencils     who is the high bidder for dirt, and what they would build
    pnpm leadlag     does the cycle run in the right ORDER — see below
    pnpm devyield    (existing) how many of the 1,363 sites clear their exit cap
    node tools/constants.mjs   provenance x leverage over every named constant

**`pnpm leadlag` is the best evidence in this repo that the economy is real,
and it found one specific thing that is not.** Every other harness measures a
LEVEL, and a level can be reached from a dozen directions by somebody who wants
it to come out right. An ORDERING cannot: it falls out of the wiring, and no
constant anywhere in the engine sets it. Measured over four towns and fifty
years:

    starts -> deliveries    36mo   r 0.53   expected 18-40    ok   (the control)
    deliveries -> vacancy   -1mo   r 0.67   simultaneous      ok   (space arrives empty)
    vacancy -> rent          0mo   r 0.63   expected 3-24     SIMULTANEOUS
    rent -> cap rate         2mo   r 0.67   expected 0-12     ok
    cap rate -> starts      32mo   r 0.58   expected 6-42     ok
    TOTAL LOOP              69 months = 5.8 years             (real: 7-12)

Four legs in the right order with the right gaps, none of them set anywhere.
The broken one is precise: **rent reprices on vacancy in the same month.** Real
rent cannot, because leases roll — a landlord watching vacancy rise cannot touch
the rent on space that is already let, and the engine models the tenant side of
that delay (`affordEff`, a ~100-month EMA) while the landlord side (`vacTerm` in
market.ts) reads the current gap and moves the index immediately.

That was written as a testable prediction rather than a tuning target: put a
rollover lag on the landlord's response and the loop should go from 5.8 years to
roughly 7. **It was then built and measured, and THE PREDICTION FAILED.** The
entry above is preserved as written because a prediction you quietly edit
afterwards is not a prediction.

What was built: an observation lag on the availability gap, `COMP_LAG_A = 1/7`,
a six-month mean lag derived from the fact that commercial leases take three to
nine months from tour to signature and vacancy statistics publish four to eight
weeks after the quarter — so the availability a landlord responds to is a
trailing average. Both branches of `vacTerm` read it.

    vacancy -> rent      0mo -> 1mo      (predicted 3-24)
    TOTAL LOOP           5.8y -> 3.9y    (predicted ~7)

Worse, not better. So before believing anything, an IDENTIFICATION TEST: drive
the lag from zero months to twenty-four and see whether the leg moves at all.

    COMP_LAG_A = 1     (0mo lag)     vac -> rent   0mo    loop 5.7y
    COMP_LAG_A = 0.04  (24mo lag)    vac -> rent  -3mo    loop 4.7y

A twenty-four month lag on that term moves the measured leg AWAY from positive.
**`vacTerm` is not the channel that carries the vacancy-to-rent correlation**,
so no amount of lagging it was ever going to fix this leg. The change was
reverted — the mechanism is defensible on its own terms, but it was introduced
to fix a specific measured defect, it did not, and a constant that survives
without a job is the thing this repo exists to refuse. Reverting restored the
baseline to the digit (36 / 0 / 32 / 69 months).

**The live hypothesis, untested.** If the correlation is not coming through
`vacTerm`, the candidates are `scarcity` — `clamp(unmet[k] * 0.10, 0, 0.016)`,
which is computed from the same absorption pass that sets vacancy, in the same
month, and is therefore perfectly contemporaneous with it by construction — and
the deeper structural point underneath it: **`rentIdx` is being used both as the
market's asking rent and as what the standing stock earns.** Those are different
quantities with different speeds. A new lease can be struck at the new number
today; the index of achieved rent across the stock can only move as fast as
leases roll, which is about 1% of the footprint a month on an eight-year term.
The engine already distinguishes `rentIdx` from `effRentIdx`, but `effRentIdx`
is only `rentIdx x (1 - 0.14 x concIdx)` — a concession haircut, not a
rollover-weighted average. Making it one is the next thing to try, and it is a
structural change rather than a coefficient.

**And a warning about the harness, which is worth more than the result.** This
file was wrong three times before it was right, and the control leg caught every
one. First run: no smoothing, so a monthly difference of a multi-year cycle was
pure noise and it reported vacancy leading rent by MINUS 58 months at r = 0.18.
Second: `value` was defined as `rentIdx / capRate`, so "rent leads value by
exactly 0 months at r = 0.83" was arithmetic, not a finding — a test that cannot
return anything else. Third: flows were differenced like levels, which broke the
control leg down to r = 0.12 on a leg that is a literal clock. Fourth: it
searched for maximum POSITIVE correlation on a pair that is negatively related
by definition, and pinned against the search boundary. A lag sitting at MAXLAG
is never a measurement. Every one of those produced a confident, plausible,
completely wrong table.

**The root cause, and it was not what it looked like.** `HARD_COST_PSF` said in
its own comment that it was not observed — "SOLVED: the cost at which a new
building on a median site yields about 150bp over its own exit cap". The exits
it was solved at are named in the same comment: 5.3% office, 4.6% multifamily,
6.6% industrial. `market.ts:292` records CAP_BASE being raised to 8.50 / 5.60 /
7.00 and names those exact old numbers. **Nobody re-solved the costs.** Office's
exit moved 320bp, multifamily's 84bp, industrial's 40bp — and that is precisely
the order in which the classes failed. A cost solved at a 5.3% exit needs about
8.50/5.30 = 1.60x the net rent to hold the same spread at 8.50.

So the cost table is observed now, with sources, and observed numbers do not go
stale when a cap moves. The comparison class is stated in the comment and it is
**not Manhattan**: Providence / Charleston / Portland ME. Two independent
methods agreed to within 15% — re-solving against the new caps, and reading
RSMeans.

**What fell out of it, with nothing instructed:**

    highest and best use, by demand decile      before            after
      top decile (FAR 14)               industrial 99%    office 87%, retail 13%
      second and third                  industrial 99%    retail 74%, office 26%
      middle                            industrial 99%    industrial 100%
      bottom third                      industrial 99%    nothing bids

    sites that pencil (pnpm devyield)   office 0/1363     office 59/1363
                                        multifamily 3     multifamily 66

Industrial moved to where industrial belongs. The spatial economics were never
written down anywhere; they emerged once the cost table stopped lying.

**Also fixed on the same thread, each one found by reading rather than
measuring:**

- The height ladder was written out FOUR times (value.ts, dev.ts twice,
  rivals.ts). Four copies of one quantity that happened to agree — changing the
  cost base alone would have moved one and left three, silently. One
  `heightPremium()` now, and the curve is real (1.28 -> 1.85 at the top).
- `devPencils` — the thing that decides CITY supply — read index ratios against
  a single class-blind `BASE_YOC = 0.073` and a hurdle taken from a DEBT index.
  It never touched `HARD_COST_PSF`, so a cost table wrong by a factor of two was
  invisible to it, and one hurdle served office at CAP_BASE 8.50 and flats at
  5.60 — 270bp too loose for one and 70bp too strict for the other at the same
  time. It is a real pro forma now, in value.ts with the tables it needs, and it
  underwrites at `locIdxDevP90` because a city builds on its good corners: asked
  at the mean, multifamily yields 5.28% against a 6.55% hurdle and supply stops
  dead while devyield finds 66 sites that clear.
- `rivals.ts` gated every named firm's groundbreak on `devPencils(s.econ)` with
  the default argument, so flats, sheds and shops were all gated on OFFICE
  economics. `dev.ts:2288` found and fixed this identical bug on the teardown
  path, measured it, wrote it down — and this path was left open. Sequencing
  fault: the class was knowable thirteen lines later.
- `startOwnJob` was the one of four groundbreak paths that never decremented
  `econ.startOwed`, so the town carried a permanent phantom backlog for every
  tower the street built — which then ordered an extra crane AND hired extra
  trades, raising the cost index for everybody.
- The management fee was missing from BOTH development pro formas. `noiYr`
  charges `MGMT_FEE` on EGI; the land residual and `planDevelopment` computed
  EGI minus opex and stopped, so a building earned 4% of EGI more while it was
  being underwritten than the day it opened.

**STILL OPEN on this thread, in severity order.** These came out of a seven-agent
read of the engine and each has a file:line; none is measured yet.

1. **RESOLVED, and it was not the bug it looked like — but it was hiding one.**
   The two models are not the same quantity with two answers. `rentExp` is an
   adaptive 21-month EMA; the quota extrapolates the gap between it and spot,
   and the residual underwrites `rentExp` itself. Those are two institutions,
   not two answers: a developer chases the trend, an appraiser prices off closed
   comparables, and appraisal-based indices are famously smoother than
   transaction-based ones for exactly that reason. The divergence is deliberate
   and it is now written down in `developerOptimism`, which is the thing that
   was missing — two reciprocal expressions of the same two variables with no
   comment saying why they point opposite ways is how a deliberate divergence
   gets mistaken for a fault.

   **What the check found instead.** All four expectation clamps were measured
   for binding over 3 towns x 50 years x 4 classes. Three are clean guards
   (momentum 0.4%, both residual belief clamps 0.0%, and the residual's comment
   had claimed exactly that: "it is not meant to bind"). The fourth was not:

       clamp(momentum * 2.4, -0.28, 0.45)     bound in 11.3% of months
                                              (4.9% floor, 6.4% ceiling)

   Momentum is itself clamped to +-0.30, so the product spans +-0.72 against
   limits of -0.28/+0.45 — the outer clamp bites long before the inner one, and
   in one month in nine the underwritten rent was not "spot x 2.4 x momentum",
   it was whichever bound the market was leaning on. The coefficient was quoted
   as the elasticity while the rail did the work. CLAUDE.md fault #5.

   It saturates now instead of clipping — slope 2.4 at the origin so the
   elasticity means what it says where the market spends its time, asymptotes at
   the same +0.45 / -0.28. Same treatment the glut branch of `vacTerm` already
   got for the same problem. Measured after: every clamp binds 0.0-0.4%, and the
   response sits at a median 43% of its own asymptote (p95 86%). The asymmetry
   is kept and is the point — developers extrapolate good news further than bad,
   which is why gluts get built and shortages persist.

   Loop period held at 8.1 years through the change. `pnpm gate` passes.
2. **Three hurdles for the same building, 270bp apart, and the ordering inverts
   by class.** `devPencils` now uses cap x (1+DEV_MARGIN); `dev.ts:877` uses
   `exitCap + 0.75`; the residual uses `value/(1+DEV_MARGIN)`. Pick one.
   Note `dev.ts:877` gates NOTHING — it only sets an advisory string.
3. **DONE — and the loop length moved into the real range on its own.**
   `cityValueToReplacement` computed NOI as `rentIdx * occ * 0.62` — one flat
   margin for four classes whose recovery rates are 0.88/0.92/0.50/0, reading
   ASKING rent, ignoring the property tax. Understated every class and by
   different amounts (office −32%, retail −37%, multifamily −13%, industrial
   −38%), which is 25 points of spread ACROSS classes that no centring constant
   can absorb. It now computes NOI the way the engine computes NOI, with the
   same tax solve the land residual uses.

   With that fixed, the ratio's median moved from 0.71 to parity — which is
   where a value-to-replacement ratio belongs, since a market that persistently
   traded below its own replacement cost would never have been built. So the
   `(vtr - 0.55)/0.45` centring had nothing left to centre and is gone. What
   replaces it is the ELASTICITY of construction to q, expressed as a power
   because that is what an elasticity is: the housing-supply literature puts it
   between 0.6 and 5 across metros, central value near 1.5, and a
   land-constrained harbour peninsula sits low in that range. `Q_ELASTICITY =
   1.2`.

   The rails became guards again. Measured over 3 towns x 50 years the floor
   binds **0.0%** of months and the cap 3.6%, against the old form whose floor
   bound whenever the market turned — its own comment called that "a brake that
   is always fully on... not a brake, it is a wall".

   And the brake was written out TWICE, in dev.ts and actions.ts, free to drift.
   One `buildClimate()` now.

   **The unforced part.** `pnpm leadlag` measures the order the cycle runs in,
   which no constant in this engine sets and which was not targeted by any of
   the above:

       TOTAL LOOP    5.8 years  ->  7.5 years     (real property cycles: 7-12)
       vacancy -> rent    0mo   ->  2mo           (still short of the 3-24 band)

   The loop entered the real range as a consequence of fixing a valuation, not
   as a target. That is the single best piece of evidence in this repo so far.

   **What it opened, and the answer.** The control leg jumped to 53 months
   against a `BUILD_MONTHS` of 22-34, which would have made the other four legs
   untrustworthy. Measured directly: the order book waits a median of 1.5 to 5.8
   months by class and the build period runs 34, so order-to-delivery is about
   38. The extra fifteen months were the HARNESS, not the engine — it correlated
   `e.starts` (the anonymous quota's order book) against deliveries measured as
   the change in stock, and those are not the same population. Deliveries include
   the teardown-replacement path and every rival's own job, neither of which
   passes through `e.starts`; and net stock change subtracts demolition, so a
   month where the wrecking ball outpaced the cranes recorded zero deliveries.

   `pnpm leadlag` now separates the two things "starts" was doing — the DECISION
   to build (the order book) and the SHOVEL going in — because they are
   separated by the queue and behave differently: orders are a smooth quota,
   groundbreaks are lumpy. Deliveries are counted gross off the job records. The
   full chain:

       value    -> orders    35mo  r 0.40   6-42    ok
       orders   -> breaks    20mo  r 0.50   0-18    2mo over
       breaks   -> deliv     41mo  r 0.70   20-40   1mo over (build is 34)
       deliv    -> vacancy   -1mo  r 0.68   0-18    ok
       vacancy  -> rent       2mo  r 0.67   3-24    1mo short
       rent     -> cap rate   1mo  r 0.49   0-12    ok
       TOTAL LOOP            98 months = 8.2 years  (real: 7-12)

   Three legs clean, three marginal by one or two months, and a loop period
   inside the real range. The control's 7-month excess over the known 34-month
   build is consistent with the 12-month centred smoothing broadening the peak;
   the smoothing is needed for the slow legs and cannot be dropped for the fast
   ones without splitting the harness.
4. **DONE, and it found the real one underneath.** `claimJob` now applies the
   residual as its pro forma — a firm will not pay more for the dirt than a
   builder of that use can bear on that site — and `claimJob`'s loan-to-cost
   arithmetic was wrong in a way that mattered more: it required the site to be
   bought outright in CASH on top of the equity slice of the build
   (`cost * (1 - ltc) + land`). No construction lender works that way. LTC is
   sized on total project cost, land included.

   **But the street still does not develop, and the reason is scale, not
   underwriting.** This is now the open item and it is a big one:

       median firm cash          $0.8M  ->  $1.8M over 30 years
       median firm AUM           $4M    ->  $12M
       median vacant lot land    $0.3M  ->  $0.8M
       median site the city ACTUALLY BREAKS GROUND ON    $8.5M  ->  $34.6M
       named firms' share of jobs broken   9 of 307 (2.9%)

   The city builds on dirt costing ten to forty times what any firm in town
   holds, so the street cannot fund a single one of the jobs it is offered.
   `claimJob`'s own docstring says the split should be "most construction...
   done by people you have never heard of, and the rest... by the four names
   you compete with every month". 2.9% is not the rest, it is noise, and the
   developer archetype is close to decorative.

   Two things were tried against it and NEITHER FIXED IT, which is the useful
   part. Scoring candidate sites by total builder surplus instead of by demand:
   surplus scales with lot area, so it selects for bigness and the median site
   went from $8.5M to $32.8M — the same fault as scoring on demand, reached
   from the other side. Scoring by surplus PER SQUARE FOOT, which is scale-free
   and is what a developer actually compares: median site $34.6M, claim rate
   2.5% against a 2.9% baseline, i.e. unchanged. Prime dirt has both the
   highest price and the highest residual, so no site-selection rule reaches
   the cheap end.

   The site-selection change was kept anyway, for a reason that is about
   coherence rather than the headline number: with it, the pro forma gate is
   free — identical results with the gate on and off — because the city now
   only breaks ground where a builder could pay. Under the old demand-based
   rule the same gate refused 99.7% of jobs. The city and the firm now ask the
   same question and get the same answer, which is the whole point of one model.

   **What is actually unresolved: are the firms too small, or is the city's
   development too big?** Median AUM of $12M in a town with roughly $4B of
   stock, across ~30 named firms, is 10% of the city — plausible in aggregate,
   far too small individually to develop anything. Nothing has been tuned here
   and nothing should be until somebody decides which side is wrong.
5. **`planDevelopment` counts the cycle twice with opposite sign**: through-cycle
   land in the denominator (the residual carries `capExp` and `rentExp`), spot
   exit cap in the numerator (dev.ts:872).
6. **`plateRentMult` is exactly 1.00 for every site in the residual**, because
   `plateOf` returns the reference plate when `bldgArea` is 0 — so the rent
   premium assemblage buys is invisible in the one place land is priced, while
   `value.ts:159` claims the opposite.
7. **`tickZoning` (zoning.ts:73)** sets citywide FAR — and therefore every
   residual and every land price — from office vacancy and office ASKING rent
   alone. No cost term, no cap rate, no other class.

**`pnpm rails` — CLAUDE.md's fault #5, measured for the first time.** The rule
has always been written down: *"A clamp that stops a number going somewhere
absurd is fine as a guard and is a bug when it is load-bearing. If a variable
rests against its rail in normal play, the rail is holding up the model."*
Nothing tested it. There are 118 `clamp()` callsites in the engine and from
reading the code there is no way to tell a guard from the model — both look like
`clamp(x, a, b)`. The tool instruments every one of them in a scratch copy and
plays three towns for fifty years.

    38 are LOAD-BEARING (a bound reached in >= 1% of calls)
    55 are guards
    25 were never called at all

The worst of them, and each is its own open question:

    market:1658   100.0% at floor   e.wageDebt = clamp(e.wageDebt, 0, 0.25)
    market:2249    76.3% at floor   `marketable`
    market:1039    69.6% at floor   clamp((realPolicy - 0.022) * 0.70, 0, 0.09)
    market:1398    56.6% at ceiling `trades` — construction employment share
    market:1462    50.4% at ceiling multifamily `slack`

`wageDebt` sitting on zero in 100% of months is not a clamp problem, it is a
mechanism that never runs — a state variable that has never once left its floor
in fifty years across three towns. That is the first one to look at.

**It caught its author within an hour of existing.** `devPencils` was rewritten
this week into a real per-class pro forma, and the response curve wrapped around
it — `clamp((yoc/required - 1) * 3.2 + 0.55, 0, 2.2)` — had been fitted when the
inputs were index ratios hovering near 1. With real inputs read at the ninth
decile of buildable sites, the ratio moved and the result sat on the 2.2 ceiling
in **57.2%** of all calls. The pro forma was being computed and thrown away. It
uses the same q-elasticity form as `buildClimate` now, neutral at parity,
unbounded above, no rail carrying anything. Loop period 7.0 years, still in
range; stock growth up a little in every class.

**And its coverage is stated rather than assumed.** The tool only sees the bare
`clamp()` helper — not `clampA` / `clampL` / `clampN` / `clamp01`, and not
hand-written `Math.max(a, Math.min(b, x))`. Those are printed as UNINSTRUMENTED
at the end of every run, because a tool that silently skips half its subject is
the same fault it is looking for.

**And the constant audit's answer to "is this simulated or arranged".** Of 263
named constants perturbed +-15% with the engine rebuilt each time: **121 move a
headline output, 142 are INERT** (dead, or a clamp downstream is load-bearing),
0 are unguarded. Of the 121 that matter: 12 cited, 40 claimed, 14 reasoned,
**55 bare**. The highest-leverage bare ones, with elasticity:

    PEAK_RENT_MULT      value.ts:217     1.25    5.15   the holder's option bid
    PARTICIPATION       market.ts:522    0.58    5.72
    LISTING_LIFE_M      sim.ts:30           6    5.69
    COVERAGE_LADDER     value.ts:135     0.35    5.45   (four of its rungs are in the list)
    OPEX_FIXED          value.ts:1046    0.30    5.04
    MAINTENANCE_SHARE   dev.ts:2140      0.45    4.82
    MOMENTUM            demand.ts:90    0.055    4.68
    SOFT_COST           value.ts:187     0.16    4.16
    RATE_SPREAD         rivals.ts:181     1.9    4.04

The classifier is textual and deliberately under-credits: it looks in three
places a reader would look and grades what it finds, so a real anchor written
somewhere else reads as BARE. `M_PER_DEG_LAT = 111_320` is in the list and is a
fact about the Earth. Read the comment the tool prints before acting on a row.
**142 inert out of 263 is the other half of the finding** and nobody has looked
at it yet.

---

The card no longer computes anything. `residualScheme` returns the winning
scheme *and* its working, `residualLandPsf` is the same call with the working
discarded, `landRead` does the same for `landPsfNow`, and the parcel card
renders what the engine decided. Verified neutral: 8,076 parcel-months, worst
relative difference between old and new `landPsfNow` **0.00e+0%**.

**What it uncovered is the open item now, and it is the biggest one in this
file.** `pnpm pencils` is the harness; it measures three things.

`landPsfNow` was `max(builder, holder, texture*0.30) + texture*0.14`. The
comment beside it says the comparison memory is "a MINORITY term deliberately",
weighted the way an appraiser weights sales comparison against a residual — but
the code took the best income bid and then ADDED 14% of the comparison on top.
So the price of every lot was strictly above what any builder could pay for it,
by construction. Measured at year 30 across two towns: price ran **1.24x-1.37x**
the best builder's residual and **0 of 1,109 lots** could be paid for. The
residual is by definition the price at which a builder earns exactly
`DEV_MARGIN`, so that is a city that cannot be built. Writing the blend as the
blend the comment described takes it to 1.02x-1.20x and 10.7% of lots. `pnpm
gate` passes.

**That was one layer. The layer under it is an identity nobody had checked.**
`HARD_COST_PSF` in value.ts carries, in its own comments, the net rent each
class needs to justify its cost. `RENT_BASE` in market.ts carries what each
class earns. They had never been put side by side:

    office        $560/sf hard    needs net $62    earns $43.65    -30%
    retail        $865/sf hard    needs net $97    earns $42.91    -56%
    multifamily   $345/sf hard    needs net $37    earns $30.22    -18%
    industrial    $140/sf hard    needs net $17    earns $18.00     +6%

Industrial is the only class that earns what its own cost requires. So it bids
positive for **100%** of vacant lots and is the best use on **81.9%** of them,
while office bids positive on 5.6% and retail on 4.2% — and `pnpm devyield`
reports **0 office sites pencil of 1,363, 0 retail**, in a city whose office
stock grows ~1%/yr. It grows because `devPencils` decides city supply from
index ratios and never looks at what a square foot costs or what land costs.
The player's desk does look. Same quantity, two answers, and the player is
shown the one that says no.

Do NOT fix this by moving one number until the table looks right — that is the
tune-until-it-passes move. The question is which side is miscalibrated, and the
likely answer is the cost table: $865/sf is urban podium retail and $560/sf is
CBD high-rise, both priced for a city this town is not, while the rents are
priced for a mid-size harbour town. That is the Manhattan-anchor problem the
owner named, sitting in the cost column. Whatever moves, `pnpm pencils` should
end up STRADDLING 1.0 and every class should be buildable somewhere — the
correct target is not "everything pencils", it is "the good corners pencil and
the fringe does not".

### 5. Tenant bankruptcy and lease rejection
Owner-requested. A credit tenant files, rejects the lease, and an asset goes
from stabilised to a hole in one month. Currently unmodelled and unpriceable
by the player. This is the biggest single unmodelled real risk left.

### 6. Recourse that bites
Owner-requested, pairs with 5. A bad deal currently costs you the building,
never the firm. Personal guarantees, completion guarantees, bad-boy carve-outs.

### 7. Cross-collateralisation (#22)
Owner-requested early and still open. Pledging a portfolio against one
facility, and what happens to the whole stack when one asset breaches.

### 8. JV equity and the promote (#31)
Owner-requested. Outside equity, waterfalls, and the promote — the thing that
makes a developer's return different from a building's return.

### 9. Industrial rents against industrial build cost (#36)
$18/sf net rent against $140/sf hard cost. Flagged as an inconsistency
long ago; the all-in measurement now says industrial lands at ~$269/sf all-in
with a 5.89% yield on cost against a 6.86% exit cap, i.e. it does not pencil
anywhere. Worth deciding whether that is right (it may be — most dirt should
not pencil) or whether the rent level is wrong.

### 10. Information asymmetry (#38)
Owner-requested. The player should not have perfect information. NOTE: an
earlier framing of this was wrong and the owner corrected it — *"in real life
you would never offer on a building you don't know the tenancy and NOI about,
even if it's off market"*. Preview and close must agree; that is now enforced.
Asymmetry belongs in what the MARKET knows that you do not, not in hiding the
rent roll of a building you are underwriting.

### 11. The appraiser is treated as the Bible (#39)
Owner-requested. Net worth is marked at appraisal rather than at what is
realisable. The ask → comp → appraisal loop needs to be a loop, not an
oracle.

### 12. Infrastructure (#41)
Owner-requested: *"the city never builds anything that isn't a building"*.
Transit, roads, parks, seawalls — things that move the demand surface.

### 13. NNN lease structures surfaced (#13)
Triple-net vs gross is modelled in the recovery rate but never shown or
chosen.

### 14. Player name and firm identity (#20)
Partially done — the firm has a generated name and epithets. The player still
cannot name themselves or their firm.

### 15. Memory and continuity (#33)
Owner-requested: *"nobody remembers you"*. Rivals, brokers and lenders should
carry a history of dealing with you that outlives one transaction.
`lenderRel` exists and is the model to copy.

### 16. Trouble visible on the street
Owner-requested: *"can't see trouble on the street"*. Distress should be
legible on the map before it is legible in a table.

### 17. 84-year trading
Owner-requested. The endgame length and what a multi-generational hold looks
like.

### 18. A frame-budget counter for the renderer
The graphics work built `pnpm styles` to enforce building variety and nothing
to enforce cost. `ThreeBuildings.ts` is 8,020 lines with ~20 shader programs
and a post stage, and the 60fps budget is currently a number in the corner
that nobody has checked. **This is a requirement to hand the graphics agent,
not something to build in their territory.**

### 19. Performance at large island sizes is unverified
Great City is ~4,150 buildings against ~1,030 standard. Only ever rendered
here under SwiftShader software rasterisation, which cannot answer the
question. Do not ship Metropolis or Great City as a default until somebody
measures on real hardware.

### 20. Bank failure frequency
Now that borrower losses reach lender capital, desks fail ~1.8 times per 50
years each. Defensible for five pure-CRE lenders in a town with 30% office
vacancy cycles, and hot. **Do not tune the failure roll** — if it needs
changing the fix is upstream in loss severity or recovery rate. Peak bank
delinquency of 9.5–9.9% matches the real 1990 peak (~12%), so the loss
magnitude is the validated part.

### 21. UI declutter and chart quality
Owner-requested. Graphs can be improved, clutter can be reduced. The top bar
sheds readouts under 1900px and the parcel panel is long. Lowest urgency of
anything here, but it was asked for twice.

---

## THINGS THAT ARE DONE, so nobody redoes them

- **The construction industry is a market, not a wall** (`cdbd1bd`). The crew
  count follows the work, the trades price off how booked they are over a
  non-speculative base load, and the crew base is derived from floor area and
  turnover instead of `lots / 165`. `pnpm crews` is its harness and it asks the
  four questions that were all false before: does demand reach the price, do
  the two guards stay off their rails, and is real construction cost flat.
- **Independent confirmation the city now renews at the real rate.** Nobody
  touched test L; its demolition rate went 0.215%/yr → 0.536%/yr against its
  own cited real-world anchor of ~0.5%/yr, and mean building age now rises 23
  years over fifty instead of 36. That fell out of the construction market
  working, and it is worth more than any number this session set out to move.
- **Bank failure, end to end.** Deposits seized with era-correct insurance
  limits, receivership dividends, repudiated construction commitments,
  replacement facilities with a sources-and-uses test, and contagion priced
  off wholesale funding share and capital-against-target.
- **Borrower losses reach lender capital.** A rival firm failing used to cost
  its lenders nothing. This was the wire that made the whole bank-failure
  system able to fire at all.
- **Island size and how built-up it starts.** Five sizes (378 to 5,791 lots),
  seven development levels. Both travel with the save. The street grid does
  NOT scale — more blocks, not bigger blocks.
- **The banks derive their size from the city** rather than scaling off a
  reference island.
- **The city is locked once a game starts.**
- **All-in cost psf on the development panel**, reconciling with the yield.
- **The frozen-world harness bug**: `advanceQuarter` returns state unchanged
  once `gameOver` is set, and 15 of 20 macro seeds died before month 600.
  Every long-running probe must resurrect.

---

## TWO HABITS THAT PAID OFF REPEATEDLY

**A/B every mechanism against itself.** Three separate conclusions in this
session were wrong until the counterfactual was run: bank-failure clustering
looked like contagion and was common cause (43% without it, 37% with); the
sector-exit ratchet looked like it made office rent worse and had resampled
noise; and a "load-bearing vacancy rail" turned out to be a market clearing
correctly by price.

**Check the estimator before believing the number.** F's 7-seed median moved
1.3pp on noise. G's threshold sits at exactly zero against a distribution
centred on zero. If a test's per-seed spread is wider than the effect being
measured, the test cannot see the effect.

This one nearly cost a correct mechanism again. At six seeds the change in
worst real-rent drawdown from the construction-market fix read −27pp to +39pp
per seed against a +7pp median shift — unreadable, and it would have supported
either conclusion. At twenty-four paired seeds the whole distribution moved
(p25 40→52, median 48→69, p75 59→84) and it is unambiguous. **Build the paired
A/B harness before forming the opinion, not after.** `git worktree add` a clean
copy at HEAD, bundle it to `test/.engine-base.mjs` — the gitignore already
allows suffixed bundles for exactly this — and run the same probe against both
with `ENGINE=`. It takes ten minutes and it is the difference between a
measurement and a guess.
