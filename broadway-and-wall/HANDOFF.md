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
| B–F, G, H, I, J–M | in band |
| `pnpm crews` | new — the construction market's own harness, see item 1 |

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

**So the question is now which of these two, and it is answerable.** Either the
vacancy swing is too wide (availability runs 3.7% to 25% against a real office
range of roughly 8–20%, and BOTH tails were already too wide on the old build —
the tight end is not something this change caused), or the glut branch should
not be extrapolated past where it was fitted. Measure the tails first; the
tight end at 3.7% availability is the more obviously unreal of the two.

**Ruled out, and stays ruled out.** The sector-exit ratchet (wrong timescale).
And now also: supply was not what set the PERIOD. The rent cycle ran 20.3 years
before and 19.3 after, while stock growth nearly doubled. The period is the sum
of the loop's lags — developer belief (`rentExp`, ~22mo), construction (30–44mo),
occupancy adjustment (~18mo), the capitulation clock (6mo) — plus the 90° the
rent integrator contributes, and the measured 55-month rent-behind-vacancy lag
is that integrator's signature. See the Barkhausen note already in `market.ts`
above the sublet block; somebody worked this out once and it is the right frame.

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
