# HANDOFF — the 21-item backlog

State of the branch `claude/phase-1-implementation-v4c2az` as of commit
`e89ac34`. Written to be picked up cold by a session with none of the
conversation behind it.

Read `CLAUDE.md` first — it is the standard everything here is measured
against, and several items below exist only because it was applied.

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
| `conserve` | clean |
| F (income anchor) | in band on all four classes, 20 seeds |
| G (policy responds) | **breached, deliberately — see item 3** |
| H, I, J–M | in band |

---

## THE LIST

Ordered by what I would do next, not by number. Items 1–4 are the ones I
believe are load-bearing for everything else.

### 1. The rent index oscillates violently and nobody knows why
**Evidence.** Real office rent swings $14 to $95 and back on a ~28-year
period. Worst peak-to-trough drawdown anywhere in a 50-year run is 93.3%;
Manhattan office effective rents fell 50–60% in the 1990 bust, so 93% is not
a market. Per-seed real rent CAGR spans −5.21% to +3.63%.

**What has been ruled out.** The sector-exit ratchet is not the oscillator —
the demand anchor walks down smoothly (0.93, 0.87, 0.80, 0.71 by decade)
while rent swings wildly. Different timescales.

**Where to look.** The supply-and-rent feedback loop. Suspect the interaction
between `tickCityGrowth`'s start rate, the delivery cohorts, and the rent
response to vacancy in `market.ts` around line 1529 (`drift`, `vacTerm`,
`scarcity`).

### 2. Zoning never changes in fifty years
The city cannot rezone. Industrial can only be built on M-zoned land (61
vacant lots on the standard island), retail is a minority roll on C-zoned
land, and both are capped at two floors — correctly, a warehouse is
single-storey. Result: retail stock grows **0.04%/yr** and industrial
**0.12%/yr** over fifty years.

The sector-exit ratchet now stops the rent compounding this caused, but the
underlying fact remains: a real city facing quadrupled industrial rent
rezones, and this one cannot. This is also the honest fix for item 3's
cousin — a city that loses its industry should look different.

### 3. G's unemployment clause asserts something the engine does not do
`corr(unemployment, loan index)` over 30 independent seeds: median −0.05,
p25–p75 of −0.36 to +0.17, **13 of 30 seeds with the wrong sign on a build
that passes**. The clause tests `median <= 0` against a distribution centred
on zero, so it passes or fails largely at random.

Deliberately left breaching rather than re-thresholded or padded with seeds.
The fix is a rate rule that reads the labour market with enough weight to
survive a fifty-year sample — not a bigger n.

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
