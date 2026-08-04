# ECONOMY.md — the market rebuild

**Status: AWAITING OWNER APPROVAL. No implementation until this document is signed off.**

The mandate, verbatim: *"THE ECONOMY IS THE GAME, AND RIGHT NOW IT'S FAKE...
I don't care if the current demand and land value systems get gutted or thrown
out entirely."* This document is the synthesis of three independently-produced
designs (economist-first: a full DiPasquale-Wheaton block ledger; game-first:
four readable dials; refactor-first: minimum surgical change), each written
against the measured acceptance-test results. Where they agreed I took the
agreement; where they disagreed I chose and say why; where I disagree with the
mandate itself, that is in **Pushback**, per your instruction.

---

## 1. The diagnosis (measured, 2026-08-04, `pnpm econ:accept`)

| Test | Verdict | Numbers |
|---|---|---|
| A. Location spread | **FAIL** | Identical 60k sf buildings, demand 16 vs 98: $81 vs $113/sf = **1.40x** (need 2–3x). Occupancy **inverts**: worst corner 100% in 16 months; best 75% in 29. |
| B. Supply shock | PASS (today) | +10% stock: vacancy 11.8→20.1%, rents −18.2%, 31mo to 80%, neighbours −7pp. Your report was true of the build you played; this week's absorption model fixed it. |
| C. Cycle | PASS (today) | 13.7% drawdown through recession windows; 25.2% worst anywhere. Same: predates your build. |
| D. Conservation | **FAIL** | +12% stock injected: **39.4%** of the new supply conjured its own tenants (budget: 15%). |

The guilty mechanisms, by name (all three designers independently confirmed):

1. **The tenant printer** — `market.ts` clamps occupied to a floor of
   `0.55 × stock`. An occupancy floor that scales with supply mints tenants.
2. **Stock-scaled absorption** — the absorb clamps and noise are
   `± % × stock`: a bigger city of *buildings* signs leases faster. It should
   be a bigger city of *tenants*.
3. **The ceiling-pinning leak** — the demand target is uncapped while occupied
   is capped at the frictional ceiling, so a mature city banks invisible
   "pent-up demand" that pours instantly into any injection.
4. **Symmetric affordability** — rent elasticity −0.58 means a supply shock
   that cuts rents 18% *manufactures ~11% more demand* through cheapness
   alone, at monthly speed.
5. **The location plateau** — `locationRentMult = 0.62 + 0.76·demandIdx`
   spans only 1.5x edge-to-edge, and the achieved spread compresses to 1.40x.
6. **The saturation that blinds arrivals** — `loiOdds = min(0.85, capture/deal)`
   pins at 0.85 for *any* sizeable vacancy anywhere, so a fringe tower and a
   prime tower draw letters at the same rate — and the fringe one, cheaper and
   less locally contested, **fills first**. This is why your two towers rented
   the same: location priced the letter a little and the queue not at all.

Your suspicion — *"occupancy drifts toward a target and rents follow a demand
index, with no finite pool of tenants anywhere"* — was exactly right.

---

## 2. The model

### Architecture decision

The economist design's full block-level occupancy ledger is the right *end
state*, but it carries the longest risk register (self-competition loops,
residual-land violence, a 6-item probe list) for two tests that already pass.
The refactor designer's warning decided it: *"if the current model is pinned at
its ceiling 80% of the time, a pool is the fix; a full parallel system risks a
second fake stapled to the first."* **v1 is the conservation core + location
teeth + sticky asking**, built from the refactor and game-first designs, with
four economist pieces grafted in because they are cheap and load-bearing
(per-block natural vacancy and churn, the vacancy lens, the asking/effective
split as UI, the capitulation news). The block ledger remains the documented
v2 if v1's block-level behavior proves too coarse.

### 2a. Conservation of demand (fixes D; principle 1)

New state on `econ` (per use k):

```
pool[k]        demanded SF — THE finite tenant pool. Init stock₀·(1−natVac).
affordEff[k]   damped affordability multiplier, init 1.0.
locIdxMean     sf-weighted mean demandIdx of built stock, measured once per
               city at init — the pivot that keeps every location curve
               mean-neutral on any map we ever ship.
```

The monthly walk:

```
targetRaw = baseStock·(1−natVac) · employIdx^elastic · (1 + 11·sectorMom) · affordEff
            └─ baseStock is FROZEN at newGame. Supply never touches demand.
affordRaw = ((rentIdx/RENT_BASE)/employIdx)^(−0.40 comm / −0.50 mf)   [was −0.58/−0.62]
affordEff += 0.010 · (affordRaw − affordEff)          half-life ≈ 6 years
pool      += 0.10 · (targetRaw − pool)                demand forms in ~a year
pool      −= 0.25 · max(0, pool − ceiling·1.02)       unhousable demand stops looking
```

Absorption, all stock-scaling deleted:

```
absorb   = clamp(0.055·(pool − occupied), −0.006·occupied, +0.010·occupied)
           + occupied · rrange(±0.0005)               ← occupied-scaled, not stock
occupied = clamp(occupied + absorb, 0, stock·(1−friction))
           ← the 0.55·stock floor is DELETED. The only floor is zero.
```

And the letter machinery: `marketRequirement`'s churn becomes
`occupied · GROSS_TURNOVER/12` (was `stock ·`), with turnover rebased
(0.088→0.099 office etc.) so citywide letter volume is bit-identical at
natural vacancy. Empty buildings do not generate move-outs.

**Why D passes:** the pool never reads live stock; churn scales with tenants;
the floor is gone; absorption speed is tenant-scaled; the only remaining
induced channel is the slow damped affordability, contributing ~12–15% of an
injection over 36 months — inside your 15% budget, and deliberately not zero
(see Pushback #2).

### 2b. Location with teeth (fixes A; principle 5)

Both halves — what a corner *charges* and what it *captures* — steepen, both
pivoted on the measured city mean so the aggregate price level cannot move as
a side effect:

```
RENT     locationRentMult = clamp((demandIdx/locIdxMean)^1.05, 0.42, 1.75)
         (as-built: the design's 0.9 measured 1.87x ACHIEVED — vintages and
         concessions eat a fifth of the asking spread, so asking runs ~2.7x
         for the test's 2.0x achieved; measured 2.37x achieved, median → 1.0)
ARRIVAL  Location factor  = clamp((demandIdx/locIdxMean)^3.0, 0.10, 3.4)
         → a ~14x tour-traffic ratio between the fringe and the prime corner
ODDS     loiOdds = 0.85·(1 − e^(−capture/(0.85·typicalDeal)))
         the soft curve keeps ORDERING all the way up — the saturation that
         made arrivals location-blind is dead
CEILING  supportableOcc = clamp(0.945 + 0.75·(demandIdx − locIdxMean), 0.68, 0.985)
         (as-built, the decisive lever the design underweighted: pace alone
         never fixed the DESTINATION — given 12 years the worst corner still
         ground to 100%. The pool of names that will take an address is
         finite: arrival odds taper to a door-knock trickle inside 8pp of the
         ceiling, and the requirement that tours is capped at what is left of
         the pool — toSuites rounds UP a suite, so the letter is dropped when
         the demised ask overshoots the pool by more than a sliver of a suite.)
CHURN    renewals gain fLoc = clamp(0.88 + 0.20·demandIdx, 0.88, 1.08) — fringe
         rolls turn over faster ("a better building across town made them an
         offer")
OCC      useOccupancy's location term 0.16→0.22, and per-block natural
         vacancy runs structurally looser on the fringe (economist graft):
         vstar_b = natVac · clamp(1.30 − 0.50·demandIdx, 0.80, 1.45)
```

**Why A passes:** achieved-rent spread measured 2.37x ≥ 2.0. The fringe
building now draws ~1/14th the traffic per marketed foot, churns faster, and
— the as-built addition — runs out of willing tenants near 70–80% while
prime carries ~92–100%: measured at yr 12, worst 50% vs best 83% with the
worst building shedding tenants through the downturn. The inversion dies
because *pace* and *destination*, not just price, now live on the gradient.

### 2c. Sticky asking, moving effective (strengthens C and B; principles 3–4)

```
concIdx[k]   0..1 concession dial. Target = clamp(11·(vac−natVac) + phaseNudge, 0, 1),
             chased at 0.25/mo — free rent moves in MONTHS.
vacOverM[k]  months vacancy has sat >1.5pp over natural — the capitulation clock.
ASKING       rentIdx: shortage pushes it up immediately; cuts ramp in only as
             min(1, vacOverM/6) — the landlord stares at the empty floor for
             half a year before touching the face rate.
EFFECTIVE    effRentIdx = rentIdx · (1 − 0.14·concIdx)
```

**The consumer rule, stated once:** everything that *prices a deal or values
an asset* reads **effective** (LOI draws, NOI, appraisals, DSCR sizing, dev
pro-formas, rival underwriting). Everything that *reports the market* reads
**asking**. A grep-audited checklist of every `rentIdx` read ships with the
change, plus an invariant asserting `effRentIdx ≤ rentIdx`.

**Player-visible (load-bearing, not polish):** the Economy tab's rent chart
becomes two lines — ASKING and EFFECTIVE with the gap shaded as concessions —
and a capitulation news item fires when asking finally cracks ("office
landlords have started cutting face rents after a year of empty floors").
Without this UI, sticky asking *reads* as "the chart ignores the recession,"
which is the exact complaint that started this. I would block ship on it.

### 2d. Quality segments the market (principle 7)

The cheap, visible form — not a 12-pool A/B/C submarket stack:

```
VINTAGE TILT   when the market sheds tenants, the shed is distributed by
               vintage: mktDelta · clamp(0.5 + age/80, 0.5, 1.7), renormalised
               to a measured city mean of exactly 1.0 — the 1928 building
               sheds ~3x what last year's does, and the citywide books still
               reconcile.
RENEWAL POACH  in a delivery year, renewal odds on worn/obsolete stock fall
               ("the new tower on Fifth is taking your tenants to lunch").
```

New Class A wounds old B *through the same wire test B already measures*, so
the neighbour-wound clause gets stronger, not regressed.

### 2e. Land value (principle 6 — partially adopted; see Pushback #3)

v1: the land index gains a vacancy discount — *no builder pays up into a
glut* — and the parcel panel gains the true per-parcel residual as a
**display**: "best use: office — a new building here clears $X/sf against
$Y/sf to build; the dirt is the difference," or "nothing pencils here at
today's rents and costs." The full balance-sheet residual is deferred: all
three designers independently flagged it as hyper-volatile (a levered
difference of two large numbers that goes negative across half the map every
glut), and two of three recommended exactly this staging. It becomes its own
project after the market it would be a residual *of* demonstrably works.

### What is deliberately NOT touched

- **`demand.ts` — the block surface, poles, transit, employment-in-place.**
  You said the demand system could be gutted. All three designers
  independently refused, and I agree: it is the only module that already
  obeys conservation (redistributive by construction, measured 0.974–0.992x),
  and it is the mechanism by which *your building changes the city* — the
  fantasy of the whole game. It was never the fake part; the citywide pools
  it feeds were.
- The phase machine, monetary eras, credit cycle, sector and industry clocks,
  the construction pipeline/cohorts, cap-rate machinery, and the entire
  player-facing leasing loop (tours, letters, counters, renewals) keep their
  exact shape. Zero new clicks anywhere. Depth is read, never clicked.
- The macro/inflation workstream (price level, real wages, expectations in
  the loan index, 5/15/30/50/100-year graphs) was HELD rather than landed on
  code this rebuild would gut; it becomes Phase 6 on top of the new market,
  where nominal-vs-real finally has an honest substrate.

---

## 3. What gets deleted, file by file

- `market.ts`: the `0.55·stock` occupancy floor; the stock-scaled absorb
  clamps and noise; the fast symmetric affordability term; the target-chase
  as the thing occupied follows (its calibrated formula survives as the
  pool's input). Everything else — phases, eras, credit, employment, city
  layer, sector/industry clocks, starts/cohorts, cap rates — survives verbatim.
- `absorption.ts`: stock-based churn; the `mood` double-count; the flat
  Location curve; the hard `min()` in loiOdds. The requirement/capture
  machinery, sub-linear marketing, deal-size distributions, shadow supply,
  and the months-to-let closed form survive.
- `value.ts`: the old `locationRentMult` constants; `useOccupancy`'s
  cycle-swing double-count. The idio/trouble texture, opex stack,
  recoveries, cap machinery survive.
- `leasing.ts`: `concessionPressure` collapses to a read of `concIdx` (one
  source of truth); everything else untouched.

---

## 4. Recalibration plan (budgeted as heavily as the model, per the mandate)

| Consumer | What moves | Retune |
|---|---|---|
| Valuation | Fringe assets reprice ~−25%, prime ~+10–15%, one time; glut appraisals mark down up to ~14% further via effective rent | Mean-preservation is enforced at the curve level (static sweep per city, ±1%); verify invariant value-jump bounds |
| Cap rates | No formula change; honest vacancy makes CAP_VAC_BETA bite | Measure cap sigma over 3×50y; if >±60bp/yr, trim beta 20% |
| Development | Pro-formas underwrite effective rent + capped lease-up; fringe ground-up stops penciling (intended) | If citywide starts fall >30%, raise the starts coefficient — never the vacancy gate first |
| Rivals | Inherit via shared functions; fringe-heavy books run structurally worse | If rival attrition doubles, raise their bid discipline — never soften the market |
| Lenders | DSCR sees effective NOI → more breaches in gluts (intended) | Haircut *generated* rival-loan LTVs ~5pts; live sizing rules untouched |
| Note desk | Fringe collateral marks honestly lower; spreads widen | Re-measure the earned-return band |
| play50 gate | Run LAST: worst >$1M, median $30–150M, bankruptcies possible | Arc levers: RENT_BASE ±5%, concession max 0.14→0.12. The conservation machinery and location curves are **not** arc levers |

**Implementation order** (each phase ends with the four tests + invariants):

0. *Probes first:* instrument the D decomposition (is the control run
   ceiling-pinned? — sizes the pool machinery); static locIdxMean sweep of
   both cities.
1. Conservation core → D goes green, B/C hold.
2. Location teeth (sweep GAMMA_ARRIVAL 2.2/3.0/3.8 against A; letters-volume
   guard ±10%) → A goes green.
3. Asking/effective split + the two-line chart → C re-verified.
4. Vintage tilt, renewal poach, vacancy lens, Economy-tab dials.
5. The recalibration table above, then the play50 gate.
6. (After approval of the running whole) the macro/inflation layer.

Two test-suite additions recommended by the panel, adopted: a mid-gradient
assertion (letters at demand 30 vs 70 must differ ≥2x — so future tuning can't
quietly re-flatten the middle where the game is actually played), and an upper
bound on B's lease-up (≤120 months in a recovery market — a building that
*never* leases shouldn't pass a queue test).

---

## 5. Pushback (per your instruction to push back)

1. **The 2–3x spread should be earned across rent AND pace, not rent alone.**
   This design lands ~2.3x on face rents — the bottom of your band — and puts
   the rest of the felt difference in traffic (14x), lease-up speed, churn,
   and concessions, so the fringe/prime *NOI and value* spread runs well past
   3x. Real intra-city face spreads on physically identical buildings run
   1.6–2.2x; pushing rent alone to 3x silently rebalances the entire game
   around one constant (an earlier measured attempt moved the median outcome
   from $93M to $1.09B). If you want 3x on rent alone, it is a separate
   balancing campaign and should be priced as one.
2. **The 15% induced-demand budget is right for the test window, wrong as a
   permanent law.** Cities that build DO grow — over years, through
   employment and population, which your city layer already models. The
   design caps *fast* induction at ~12–15% and lets *slow* induction live
   where it belongs. The cost: a decade-long unhousable shortage can't
   persist (excess demand sheds in months). If you want that regime — the
   housing squeeze where anything leases instantly for years — say so, and D's
   window moves to 24 months to make room for it.
3. **Land as a pure balance-sheet residual is deferred, not refused.** All
   three designers hit the same wall: a levered difference of two large
   numbers whipsaws, and dirt that is worthless-then-priceless on a two-year
   cycle is realism that isn't fun. v1 ships the residual as the *teaching
   display* plus a glut-discounted land index; the full residual becomes its
   own measured project on top of a working market.
4. **`demand.ts` stays.** Reasons above; gutting it would burn the one system
   already obeying your first principle.
5. **Sticky asking needs its UI to be part of the model.** Six months of
   face-rate denial with no effective line visible reads as a broken chart. The
   two-line rent chart is load-bearing; I would block ship on it.

---

*Approve, amend, or push back on any section. Nothing in §2–5 is implemented
until you do — the acceptance suite (`pnpm econ:accept`) is already committed
and failing A and D, which is the state this document starts from.*

---

# OPEN FINDINGS — measured, not fixed

Three things this branch's harnesses found and proved. The first has since been
fixed, from the other end, by a parallel session on the same branch — its entry
stays because the measurement is the useful part. The other two are open: each
is a real defect with a number on it, neither is a change the brief asked for,
and both are economy rebalances that should be their own decision rather than a
side effect of a bug fix.

## 1. The takeout bills a full payment on a building it knows cannot pay — FIXED

*Superseded. A parallel session on this branch reached the same gap from the
other side and fixed it properly; this entry is kept for the measurement.*

`deliver()` rolls the construction loan into a mini-perm that is interest-only
for two years, carries a covenant holiday for three, and matures in five. All
three of those dates say the same thing: the lender knows this building cannot
cover itself yet. And then it billed the sponsor the whole monthly payment from
the first month anyway. On the small merchant job measured for this: $53k a
month against a 12,300 sf office with no tenants, out of an account the equity
draw had already emptied, on a building `leaseUpFactor` expects to take 38
months to fill. `planDevelopment`'s lease-up reserve carried ten months of
OPERATING cost and zero months of debt service.

Two attempts, and the second one is the right one. **Reverted:** a debt-service
reserve inside the takeout facility, sized on a flat month count. It did not
destroy value per deal — it removed the cash constraint that had been standing
in for underwriting, and the merchant went from 2 sites in fifty years to 6 and
lost money on the extra four (median $3.7M and one wipeout became −$5.5M and
three). Running out of cash mid-job is not discipline, but it was doing
discipline's job. **Shipped instead:** an operating deficit reserve in the
budget, sized on the INTEGRAL of the monthly shortfall between debt service and
the NOI the building actually earns as it fills. Averaging a stream that is
deeply negative for eighteen months and positive for twenty reserves exactly
zero, which is why a flat number could not work.

## 2. Buying a district pushes its land value DOWN

New in `pnpm stress --only=B`. A whale with $400M buys every lot it can inside
one district for twenty-five years — 116 to 142 of them — and the district's
land $/sf falls 6.6% RELATIVE to the rest of the same town, measured as a
difference in differences so the RNG drift between arms cancels.

`landPsfNow` reads `rec.landPsf × siteQualityMult × econ.landIdx × level ×
cycle` and nothing else. `bumpLand` writes a per-parcel adjustment and is called
by exactly two things: a delivery, and a rezoning. Nothing anybody BUYS moves
the ground under it. The player's demand is not an input to the land market, so
absorbing a third of a district's dirt reads to the appraiser as one fewer
building trading there — which is the sign it does move, and it is backwards.

## 3. The pro forma's exit and the mark disagree by a third

`planDevelopment` values the finished building at `stabNoi / exitCap`, where
exitCap is `capRateFor(asBuilt, econ, "good")`. `holdingValue` marks the same
building at `noiYr / (cap + TAX_RATE)` with the roll-quality spread on top.
Measured on the 174,300 sf tower: the plan says $299.9M, the mark says $196.5M.
Both handle tax, differently; the plan uses a 90% stabilised occupancy where
the mark uses the site's own `useOccupancy`; the mark carries a 55bp empty-roll
spread the plan does not. None of these is wrong on its own and the gap is a
third of the value of every development decision in the game. A developer
reading a 9.49% yield on cost against a 5.33% exit is being shown 1.78x on a
job that will mark at 1.03x the day it opens.

---

# THE INCOME ANCHOR IS NOT HOLDING — traced, not fixed

`sim:accept` F fails, and unlike its neighbour on the same run it is not a
sampling problem. It is the finding.

**What F asks.** Rent is a payment out of somebody's income, so real rent per
square foot cannot durably outrun the wages of the city paying it. The file's
own header quotes the owner: *"rent should be a by product of the economy, and
the economy should be very complex and pulls on each other and intertwines and
not have anything be fakely made up."* F is that sentence as a test.

**What it measures now.** Over sixteen seeds, fifty years each:

| | rent less wage | rent-to-income at yr 50 | real rent growth |
|---|---|---|---|
| before the merge (`c75012c`) | **0.14 pp/yr** | **1.06x** | 1.13% mean / 1.15% median |
| after the merge (`965b9b8`) | **0.94 pp/yr** | **1.56x** | 1.57% mean / 1.96% median |

Before, rents tracked wages and the ratio was trendless, which is what the real
series does. After, rents beat wages by a point a year forever, and individual
seeds finish at 1.9x–2.1x — past F's own 1.8x rail.

**Bisected in one cut.** Disabling the lease-up mark inside `assetValue`
restores 0.14 pp/yr and 1.06x exactly. That change is the trigger.

**But it is not the fault, and reverting it would hide the fault.** Tracing the
macro series with the mark on and off:

- Office vacancy sits at **exactly 3.7%** at year 50 in five of six traced
  runs. 3.7% is `friction` — a third of `NATURAL_VAC.office`, the frictional
  floor in the `cityVac` clamp. The market is not clearing; it is resting on a
  rail.
- Office stock grows **+20%** across fifty years while jobs grow **+46%**.
  Supply expands at less than half the rate of the employment that bids for it.

Pinned there, the tight-side rent term is `clamp(-gap * 0.090, 0, 0.009)` —
linear, and applied at a gap that cannot get any wider because vacancy cannot
go below friction. So a permanent, constant upward push on rent with nothing to
relieve it. The glut side of that same expression was made superlinear
precisely because a saturating term meant "every further point of vacancy cost
nothing"; the shortage side still has the mirror of that bug.

The income anchor below it is real and is trying. It pulls toward an EARNED
rent-to-income, where "earned" is `tightEma`, a twenty-year memory of having
been genuinely tight. A market pinned at frictional vacancy for five decades
reads as permanently, genuinely tight — so the anchor keeps raising the ratio
it is anchoring to. It is not being overridden; it is being told the shortage
is real, because by its own measure it is.

So the lease-up mark did not break the anchor. It moved enough seeds onto the
rail for the rail to show, which is the correct outcome for a correct change,
and is why it stays in.

**What to fix, in order.**

1. The shortage side of `vacTerm` should be superlinear and uncapped the way
   the glut side already is, so a market that cannot get any tighter stops
   pretending the pressure is constant.
2. Supply has to answer employment. +20% stock against +46% jobs over fifty
   years is the imbalance underneath everything else here; the rent term is
   only how it surfaces.
3. `tightEma` should distinguish a market that is tight because demand is
   strong from one that is tight because nothing can be built. The second is
   not a Manhattan premium, it is a supply failure, and it should not earn a
   permanently rising rent-to-income.

**This blocks the land work.** `landIdx` is derived from effective rents over
construction cost. A rent series that outruns income by a point a year
compounds directly into the price of dirt, so wiring comparable sales into land
value on top of it would be building a new mechanism on a broken input. Fix the
anchor first.

# GATE REGRESSION AT THE MERGE — triaged; one was the test, one was the model

The acceptance gates went from **econ 5/5, sim 3/4** to **econ 4/5, sim 2/4**
across the merge with the parallel session. Both new failures were isolated to
that session's head (`3fb95dc`) run on its own, in a clean worktree, with
byte-identical numbers to the merged tree.

**Both are now resolved as diagnoses.** D was the estimator and is fixed — see
below, and `econ:accept` is back to 5/5. F is a real model defect and has its
own section above; it stays red on purpose until the anchor is fixed, because
the honest reading is that the merge exposed it rather than caused it.

| test | on `c75012c` (this side) | on `3fb95dc` (their side) | merged |
|---|---|---|---|
| econ D. CONSERVATION | PASS, conjured median 1.2% | **FAIL, median 19.0%** | FAIL, median 19.0% |
| sim F. INCOME ANCHOR | PASS, real rent 1.04%/yr | **FAIL, 1.51%/yr** | FAIL, 1.51%/yr |
| sim H. THE GLUT IS SEEN | FAIL (pre-existing) | FAIL | FAIL |

**D. CONSERVATION — the test, and it is fixed.** Measured over fifteen pairs
on both trees: induced demand is **−2.5% before the merge and +3.7% after**,
against a 15% budget. The model conserves tenants on both sides and got
slightly tighter, not looser. But the gate took a median of THREE pairs from a
distribution with a 22–27pp standard deviation, and a median-of-3 drawn from it
reads over budget **24% of the time regardless of the engine** — so this gate
failed one run in four for no reason, and cost an afternoon proving nothing had
moved. Induced demand is an expectation, so it now takes the MEAN over twelve
pairs and reports its own standard error. The 15% budget is untouched.

**F. INCOME ANCHOR — the model, and it is not fixed.** The seven-seed median of
1.51%/yr looked like a hair over the rail. It was a lucky draw: over sixteen
seeds the median is **1.96%/yr** and 69% of seeds breach. See the section above
for the trace — the market is pinned on its frictional vacancy floor, supply
grows at less than half the rate of employment, and the shortage side of the
rent term is linear where the glut side is superlinear.

`heldOccupancy` was the other suspect and is exonerated: it has no consumers in
`src/engine` at all.
