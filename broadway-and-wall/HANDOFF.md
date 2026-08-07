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

### 4. The panel's land residual disagrees with the engine's
After fixing a sign error (`costTotal - landBasis`, where `costTotal` never
contained land — it printed **−$427/sf all-in to build** on a lot with $8.95M
of dirt under it), the parcel card's residual reads a median of −$0.08M
against the engine's `landValue` of $0.46M for the same lots. Before the fix
they agreed within $20k, which is why the bug survived.

Same quantity, two answers. The card forces 0.6 coverage and derives floors
from FAR, so it is a lower bound on the best scheme — have it optimise the
way a builder would, then compare again.

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
