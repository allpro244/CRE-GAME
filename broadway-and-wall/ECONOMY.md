# ECONOMY.md — the market rebuild

**No playtest in this repository is based on Manhattan. Every playtest, every harness run and every number quoted in any of these documents is on a GENERATED city.** The Manhattan pipeline exists (`pnpm pipeline:manhattan`) and is not what any of this was measured on.

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
EFFECTIVE    effRentIdx = rentIdx · (1 − CONC_DEPTH·concIdx), CONC_DEPTH = 0.30
```

**The consumer rule, stated once:** everything that *values an asset* reads
**effective** (NOI, appraisals, DSCR sizing, dev pro-formas, rival
underwriting). Everything that *quotes or reports the market* reads **asking**
— the parcel card, the letting panel, the arriving letter, the renewal mark
(`managedRentPsfYr`, which grosses the effective index back to face; see
`faceGrossUp`). A LOI's FACE rent is a quote and reads asking; what it NETS,
after the free rent and fit-out the same dial writes, is the effective index —
that identity is the whole point and `pnpm rent-chart` measures it.

*Corrected 2026-08.* Quotes read `effRentIdx` and the desk then wrote the
concession package on top, charging the concession twice: measured over four
playthroughs, buildings quoted 11–13% under the ASKING line the page draws and
deals struck 18–27% under the EFFECTIVE line that claims to be where deals
strike. CONC_DEPTH was 0.14 and unmeasured; 0.30 is the deal-weighted fit to
the package the leasing desk actually writes. A grep-audited checklist of every `rentIdx` read ships with the
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
| play50 gate | Run LAST: worst >$1M, median $30–150M, bankruptcies possible | Arc levers: RENT_BASE ±5%, CONC_DEPTH ±0.02 (re-measure with `pnpm rent-chart`). The conservation machinery and location curves are **not** arc levers |

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

1. ~~The shortage side of `vacTerm` should be superlinear and uncapped the way
   the glut side already is, so a market that cannot get any tighter stops
   pretending the pressure is constant.~~ **Done** in `market.ts`: pinned
   `vacTerm` is 0; near-floor shortage saturates by room above friction;
   on-rail scarcity weights `structTight` *flow* plus a reduced level (full
   level off-rail). Flow-only was tried and rejected — it killed price
   rationing and regressed supply-answers. Harness: `test/rent-anchor.mjs`.
2. ~~Supply has to answer employment. +20% stock against +46% jobs over fifty
   years is the imbalance underneath everything else here; the rent term is
   only how it surfaces.~~ **Done** via densify/delivery (`test/supply-answers.mjs`).
3. ~~`tightEma` should distinguish a market that is tight because demand is
   strong from one that is tight because nothing can be built. The second is
   not a Manhattan premium, it is a supply failure, and it should not earn a
   permanently rising rent-to-income.~~ **Done**: while vacancy is pinned,
   `tightEma` targets 0 (faster fade). Availability on the rail is saturated;
   it cannot mint Manhattan from “can’t build.” Measured: avg TE while pinned
   now sits *below* overall avg (was above); median max TE ~0.17 (was ~0.53).

**Land work is unblocked on the rent input.** Median rent−wage is ~0.20 pp/yr
and RTI ~1.03× on the rent-anchor seeds — no longer a point-a-year runaway.

**Soft-market asking escalator — also done.** While availability sits above
natural, asking no longer compounds full `inflExp` or positive phase/job/sector
sentiment (and positive cycle lift is refused on the frictional rail too).
In-place leases still escalate in `leasing.ts`; the asking index stays
flat-to-down on a soft sheet so REAL rents fall with CPI until space clears.
A partial CPI carry returns only when rent has already under-shot wages badly
(prevents an RTI death spiral). Measured: soft-month real office ~−3%/yr;
century median real ~1.2%/yr (was ~1.43%) with rent−wage ~0. Marketplace-vs-
develop softness remains a separate OPEN item.

# H IS THE LAST ONE, AND I THINK IT IS THE TEST — your call, not mine

`sim:accept` is 3 of 4. F passes, G passes, I passes. H fails on one clause and
I have not touched it, because it is your scenario written from your words and
because I already caught myself once this session saying "that is realistic"
about a number that had appeared right after my own change. Here is the whole
case; the decision is yours.

**The clause.** `loan index 6.32% -> 7.12% median over the glut (need not to
RISE: a glut is a demand shock)`.

**Decomposed** — the loan index is `policy + termPrem`, and the engine widens
the premium when credit is frightened:

```
                         vac     loan  =  policy  + premium   credit  cityU   natU
month 0                 45.0%   6.32%    4.79%     1.53%      0.65    4.7%   5.10%
months 1-12             45.0%   6.75%    5.00%     1.75%      0.63    6.5%   5.00%
months 24-96 (H window) 37.4%   7.12%    5.29%     1.86%      0.86    2.8%   4.85%
months 96-144           16.6%   4.94%    3.17%     1.78%      0.91    1.8%   5.20%
```

**Three separate problems with the clause, in order of how much they bother me.**

1. *It reads the wrong series.* `indexRate` is what a BORROWER pays: the policy
   rate plus what the market charges for risk. The claim "policy cuts into a
   demand shock" is about the policy rate alone. The premium going 1.53 to 1.86
   as lenders stare at 45% vacancy is not a bug, it is the single most
   documented fact about CRE credit in a downturn — spreads blew out in 1990
   and 2009 while the policy rate was being cut, and `market.ts` says so in the
   comment above the line that does it.

2. *The scenario is a supply shock, not a demand shock.* H injects four million
   square feet. Nobody lost a job building it, no tenant left, and the effect
   on the labour market is that space got cheap — city unemployment goes 4.7%
   to 2.8% and the city ADDS twelve thousand jobs. National unemployment falls,
   5.10% to 4.85%. There is genuinely nothing here for a central bank to ease
   into. A demand shock would be tenants handing space back, and that is a
   different injection.

3. *The window measures the recovery.* Months 24 to 96 begin two years after
   the shock. The easing, such as it is, happens in months 1-12 — and the
   engine does ease there relative to trend before the city recovers.

**What the bank does when you ask it directly** (measured over seven seeds,
against the policy rate rather than the loan rate):

```
corr(national unemployment, POLICY)  -0.529    it reads its mandate, hard
corr(city unemployment,     POLICY)  -0.328
corr(inflation,             POLICY)  +0.267
```

**What I would change, if you agree.** Keep the phase clause exactly as it is —
it is the heart of the test and it passes. Replace the single rate clause with
the two claims it was reaching for, which are separable and both true of a real
glut: the RISK PREMIUM must widen (a lender looking at empty floors must charge
for it), and the POLICY rate must not tighten on account of the glut. Then add
a second scenario for the thing H's sentence actually describes — tenants
handing back four million square feet — where the bank should visibly ease,
because that one really is a demand shock.

I have not done it. Say the word.

# LAND LEARNED FROM TRADES — and the first cut compounded

The wire is right and the first version of it was circular. Both halves are
worth keeping written down, because the second half is the more useful lesson.

## The circularity

A land ask in this engine IS the appraisal times a denial factor —
`refreshListings` prices off `assetValue`, and for dirt `assetValue` IS
`landValue` — and dirt trades at the ask. So comparing a print to
`landPsfNow` produced a ratio pinned above one BY CONSTRUCTION, at whatever
the seller's denial band happened to be. Every quarter the wire read that
premium as "the market pays over appraisal" and marked the city up again.
Compounding, forever, on the most fundamental price in the game.

It did not look like a bug in test B, which went from -6.6% to +33.5% and read
as a triumph. It looked like a bug two tests over:

```
strategies ending in the black      5 of 8  ->  3 of 8
a competent operator survives       ...     ->  1 world in 4   (34 BROKEN)
all-cash                            $47M    ->  -$8.9M, 2 wipeouts
```

Land was inflating under everybody and the tax roll was chasing it.

**The fix is to measure the district against the REST OF TOWN**, in the same
window, under the same denial band. That difference is real information about
location — it is what a comps sheet actually tells an appraiser — and it cannot
drift, because the citywide median is the reference. If every district clears
4% over appraisal then no district is hot and nothing moves. B still reads
+24.1%, and the tournament came back better than it has ever been: **7 of 8
strategies in the black**, all-cash at $47.1M with **zero wipeouts** and the
lowest drawdown of any strategy, 34 back to WIRED at 75% survival.

## And it had been propping up sim:accept F and H

This is the part to keep. With the compounding version, `sim:accept` read 4 of
4. With the correct version it reads 2 of 4 — F and H both fail again.

That is not a regression. Inflating land raised `assetValue`, which raised the
value-to-replacement ratio the city reads before it builds, which produced
**more supply than the model would otherwise have made** — and that extra
supply was holding rents down and letting the glut clear. F and H were passing
on the back of a bug.

What the bug was propping up is the thing that has been named twice in this
document and not yet fixed: **supply cannot answer price**. `cityInfillCap`
caps infill at the block's existing datum plus a step that grows only with the
town's age — so a district at 3.7% vacancy with rents tripling is allowed
exactly as much height as one that is half empty. Zoning answers scarcity now;
the envelope on any individual site still does not.

Until that is fixed, F and H are the honest reading of a city that cannot build
its way out of a shortage, and the 4-of-4 that preceded them was a number
standing on a broken input. Left failing.

# THE SPACE-TO-LABOUR WIRE — built, then recalibrated, and one thing left open

The wire is in: construction employment, a non-saturating return wire from the
cost of space to the demand for it, and zoning that answers scarcity. It closed
F and H together. Two notes on it, both honest.

## The first cut was three to five times too hot

Removing the rail from `spacePull` entirely was wrong. At rent-to-income 1.8x
it ran -6.5%/yr and compounded: one traced seed shed **37,000 jobs, 24% of its
employment, in five years**, rents collapsed 191 to 31 behind it, occupancy
went to 15%, and it bankrupted an ALL-CASH owner — which is not something a
market can do to somebody with no debt. The tournament measured it: the safest
posture in the game went from $116.8M real with zero wipeouts to -$14.6M with
three, holding nothing at the end.

Firms cannot leave that fast and neither can people. A lease has a term, a
relocation costs money and takes a year to plan, and the staff have houses. The
worst year any large metro has ever had is about four per cent, and that is now
a floor on the RATE, not on the pressure — the term still grows with the
overshoot through the whole range a real city occupies and only meets the rail
past 2.2x.

    1.5x rent-to-income  ->  -1.2%/yr     an expensive city, losing a little
    2.0x                 ->  -3.3%/yr     a city genuinely hollowing out
    3.0x                 ->  -4.1%/yr     the rail: nobody leaves faster

Recalibrated, it is better than both earlier versions on every measure:

| | before the wire | wire, uncapped | wire, calibrated |
|---|---|---|---|
| rent less wage | 0.94 pp/yr | 0.63 pp/yr | **0.17 pp/yr** |
| rent-to-income at yr 50 | 1.56x | 1.36x | **1.08x** |
| dispersion (sd) | 1.00pp | 1.77pp | **0.72pp** |
| seeds over the 1.5 rail | 69% | 56% | **19%** |
| all-cash, seed 11 | — | bankrupt, gameOver | **$396.1M** |

## And G is open — the inflation leg of the Taylor rule halved

`sim:accept` G now fails on one of its two clauses:

```
corr(inflation, loan index)     median 0.24   (need >= 0.35)   FAILS
corr(unemployment, loan index)  median -0.12  (need <= 0)      passes
```

The bank itself is not broken, and the decomposition says so — measured
directly against the policy rate rather than the loan rate:

```
corr(national unemployment, POLICY)  -0.529   the bank reads its mandate
corr(city unemployment,     POLICY)  -0.328
corr(inflation,             POLICY)  +0.267
```

It eases into a weak labour market, hard. What has weakened is the inflation
leg, and the likely reason is this wire: the employment channel gives the Okun
half of the Taylor rule far more to do than it had, so a dual-mandate bank
responding to both spends less of its variance on prices. That is what a real
dual-mandate bank does — but "that is realistic" is exactly the sentence to be
suspicious of when it arrives right after your own change, and the threshold
should not be touched until somebody has actually established whether 0.24 is
the right number for a bank that reads smoothed, lagged inflation and
deliberately looks through supply shocks. Left failing on purpose.

# THE SPACE MARKET DOES NOT FEED BACK INTO THE REAL ECONOMY

F and H are the same missing wire, in opposite directions, and neither is a
rates problem.

## What the glut actually does

Test H drops 4M sf of empty office on the city and asserts the loan index must
not rise, "because a glut is a demand shock". Decomposed over its own window:

```
                         vac     loan  =  policy  +  premium   credit  cityU   natU
month 0                 43.6%   6.24%     5.18%      1.06%      0.77    3.3%   4.73%
months 24-96 (H window) 34.4%   7.18%     5.33%      2.01%      0.80    1.9%   4.71%
```

**The central bank is not tightening into the glut.** Policy moves 15bp. The
entire rise is the term premium nearly doubling as credit takes fright —
`termPrem = 1.55 + 1.85 * max(0, 1 - creditIdx)`, and the code's own comment
says why: *"spreads blow out in a crisis even as the policy rate is being
cut."* That is what happened to CRE debt in 1990 and again in 2009. The model
is right and **H's rate clause is testing the wrong quantity**: it reads
`indexRate`, the all-in cost of borrowing, against a claim that is about the
policy rate.

## The real defect it is pointing at

Look at the last two columns. Through a **43.6% office vacancy**, with the rent
index collapsing 78 to 31:

- city unemployment **falls**, 3.3% to 1.9%
- city jobs **rise**, 138,758 to 153,502
- national unemployment moves 4.73% to 4.71% — nothing

A city drowning in empty offices adds fifteen thousand jobs. The glut is not an
economic event at all. Construction stops, tenants are not expanding, landlord
income halves — and the labour market never hears about it. So there is nothing
for the central bank to respond to, anywhere, and no amount of tuning the
policy rule will produce a response to a shock that was never transmitted.

## And it is the same hole F falls through

F's finding was rents outrunning wages by a point a year with the market pinned
on its frictional vacancy floor and supply growing at half the rate of jobs.
Both tests are describing one thing: **the space market is downstream of the
economy and never upstream of it.** Rent can run away forever because nothing
it does can push back on the incomes that pay it, and a glut cannot hurt
because nothing it does can reach the labour market either.

## Why NOT to make the central bank read the city

It was already built that way and deliberately removed. The retired note in
`market.ts`:

> THE OLD CITY-LEVEL POLICY RATE read the CITY's unemployment, so a player who
> wrecked his own city was handed a rate cut for it. The nation sets the price
> of money now.

That is correct on both counts. A central bank does not set policy for one
city, and a rule that eases when the player's own overbuilding hurts the local
labour market is a money pump wearing a Taylor rule. The city already reaches
the nation, honestly and weakly, at `n.unemp += 0.004 * (cityU - n.unemp)` —
"one city, one per cent of a nation", which is the right weight.

## The fix, and why it delivers what the rate idea was reaching for

Wire the space market into the city's own labour market, and let the existing
city -> nation -> policy chain do the rest:

1. **A glut costs jobs.** Construction employment stops when the pipeline
   stops; that is immediate and large. Tenants shedding space are tenants
   shedding people. Landlord income collapsing is spending that does not
   happen.
2. **A shortage costs jobs too, at the other end** — this is F's half. A city
   that cannot house the firms that want to be in it does not grow into the
   rent; the firms go somewhere else. That is the missing brake that lets rent
   outrun income indefinitely today, and it is the same wire.
3. **Then the bank responds on its own**, through the 0.004 channel, at the
   scale one city deserves — easing into a local slump and tightening into a
   local boom exactly as intended, without ever being told to look at a city.

That produces the symmetry the rate proposal was after, and it produces it as a
consequence rather than as an instruction. H's rate clause should then be
re-specified to test the policy rate and the premium separately, because they
are supposed to move in opposite directions in a credit event and the current
clause cannot tell the difference.

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

**F. INCOME ANCHOR — the model faults named above are fixed.** §F #1/#3
(vacTerm / tightEma) and #2 (supply answering) are closed; see the struck
items and `test/rent-anchor.mjs` / `test/supply-answers.mjs`. The historical
seven-seed median of 1.51%/yr and sixteen-seed 1.96%/yr were the *pre-fix*
reading of the rail tax. Post-fix medians: real office ~1.43%/yr, rent−wage
~0.20 pp/yr, RTI ~1.03×, TE-while-pinned below overall TE.

`heldOccupancy` was the other suspect and is exonerated: it has no consumers in
`src/engine` at all.

# INDUSTRIAL COMPOSITION LEFT; THE SHEDS DID NOT — fixed

`industComp` declines at the NY/SF/London manufacturing floor-space half-life.
Rezoning's `gone()` read only the price-exit ratchet on `baseStock`. Falling
demand made space cheap, so the ratchet never fired, `gone` stayed 0, and
M-land stayed a life sentence. Measured on six null centuries before the fix:
stock/open ≈ 0.98, soft ≈ 84% of months, real industrial rent ≈ −2.2%/yr while
IC → 0.35.

**Shipped:** (1) `gone()` reads `industComp` for industrial; (2) `tickIndustrialExit`
clears empty surplus sheds to land at trickle-or-ordinary rate, yielding crane
priority when office is chronically short; own RNG channel so densify dice are
untouched. After: stock/open ≈ 0.70, soft ≈ 52%, real ≈ −1.3%/yr. Harness:
`test/industrial-exit.mjs`.

# H'S RATE CLAUSE READ THE WRONG SERIES — harness fixed

Glut transmission to labour / credit / NOI / concessions is wired (see
`test/glut-transmission.mjs`). `sim:accept` H now asserts policy must not
tighten into the glut and the term premium must widen — not loan-index drift,
which correctly rises when spreads blow out.

# LEASE COMMISSIONS WERE COST-INDEXED TWICE — fixed

`planDevelopment` sized the lease-up reserve as `(TI + LC) × costIdx`. TI is a
construction number and belongs under `costIdx`. LC is already `rent × months ×
rate` — today's rent, already carrying a century of inflation. Multiplying it
by `costIdx` again made late-century lease-up reserves larger than hard cost
(measured: ~$770M lease-up on a $418M office job at costIdx≈21), so densify
could not clear a structural office short even when stabilised NOI / build cost
cleared the hurdle. `leaseUpValue`'s vacant-building fill cheque already used
the correct split (`TI×costIdx + LC`); the residual land fit cost did not.

**Shipped:** same identity in `planDevelopment` and the land residual; densify
in-kind / extra teardown passes gate on frictional pin + `startOwed`, not only
`structTight` (seeds with a full office book but moderate employment gap were
still freezing the wrecking ball). Harnesses: `test/lease-up-cost.mjs`,
`test/late-densify.mjs`.

# PINNED ASKING STILL COMPOUNDED FULL CPI — fixed

After soft-market mute and tightEma fade-on-rail, hot seeds still printed
~+1.2%/yr **real** office rent in months vacancy sat on the frictional floor
(soft months almost absent). `vacTerm` was already 0 on the rail; the twin of
the soft escalator was still live: `firmW=1` whenever `gap≤0`, so asking kept
full `inflExp` forever on saturated availability, and a stable `structTight`
level term paid on top.

**Shipped:** on-rail scarcity is flow-only (shortfall *worsening*); asking
carries a lease-roll fraction of CPI while pinned (restored toward full carry
only when rent is already cheap against pay); stronger cheap-side income
anchor on the rail so RTI cannot death-spiral. Measured: median pin-month real
~−0.2%/yr (was ~+1.2%); century median real office ~0.9%/yr (was ~1.3–1.5%);
supply-answers still green. Harness: `test/rent-anchor.mjs` pin-real clause.

# FIRM-NEAR-RAIL SCARCITY WAS THE HOCKEY STICK — fixed

Pin-only mute left the climb in months with vacancy just above friction
(`vac ∈ (friction, friction+2pp)`): full `st×0.045` level scarcity plus full
CPI asking printed **+4–5%/yr real** in that band (~20% of months) and late
soft share on hot seeds was ~0%. Same saturation economics as the pin.

**Shipped:** (1) scarcity *level* scales with room above friction (`railSat`,
same shape as vacTerm); near the rail → mostly flow; (2) rail-bound escalator /
press bleed / lift gate extend to friction+1.2pp; (3) cheap-side pull on the
rail targets an RTI *floor* (~0.65), not earned sustain — hard enough to track
wages when under the floor, then stops; (4) real `costIdx` mean-reverts toward
a ~0.4%/yr-above-CPI fair path so construction cannot compound a century boom
from one-way rent catch-up. Measured: median rail-bound real ~+0.3%/yr (was
firm-near +4–5%); century real office ~0.85%/yr; real construction cost
~+0.5%/yr (was ~+0.8–1.1%). Harness: `test/rent-anchor.mjs` rail-real +
cost-real clauses.

# AN 8% CAP ON 2% MONEY — half the wire was right, and the other half was the glut

The owner's report, verbatim: *"There are times when the base rate is 2% but
the lowest cap rate I can sell my building is 8%. Isn't this a problem?"* Two
questions in that: is the cap-rate-to-rate wire realistic, and if it is, where
does the 8 come from. Both measured, eight procedural cities × 100 years each,
monthly (`pnpm capvsrate`, Sep 2026, before any change):

```
index bin      n     office p10/p50/p90   multifam p50   office − index p50
 0-2         503     4.94  7.07  9.00        5.08           5.40
 2-2.5      1202     5.79  8.49  9.49        5.99           6.22
 2.5-3      1336     6.42  8.83  9.64        6.60           6.09
 3-4        1321     6.23  8.77 10.07        6.45           5.35
 4-5         953     6.56  8.44 10.84        6.17           3.82
 5-6        1171     6.82  8.54 10.93        6.41           3.02
 6-8        1350     7.25  9.34 11.00        7.06           2.62
 8-10        643     8.20 10.59 11.00        8.69           1.34
 10+        1121    10.90 11.00 11.00       11.00          −5.06
```

Cheap money is 17.8% of the century (index ≤ 2.5%), and in those months the
office cap is **8.17% in the median month, 8% or over in 54.5% of them** — a
620bp spread over the index, against a real 2010-20 record of 280-500bp
(CBRE: multifamily 230, office 280, retail 320, industrial 340 over the
ten-year; the GFC peak ran the all-property spread to ~440). The owner is
right that the number is wrong. The decomposition says which term:

```
office cap target, index ≤ 2.5%      p10     p50     p90
  CAP_BASE                           8.50    8.50    8.50
  0.55 × (index − 5.4)              −2.00   −1.78   −1.63
  −0.25 × cycleDev                  −0.11    0.07    0.15
  crunch  1.6 × (1 − creditIdx)      0.00    0.49    0.63
  sector  −30 × sectorMom           −0.23    0.04    0.23
  vacRisk (clamped −0.6 … +2.0)     −0.60    1.42    2.00
  flows                             −1.30   −0.63    0.18
  TARGET                             5.20    8.01    9.16
```

**The rate wire does what it says** — it takes 178bp off. What puts the cap at
8 is the vacancy term (+1.42 median, pinned at its +2.0 guard at p90) and the
credit crunch (+0.49). And those are not independent of the rate: **62% of
all cheap-money months are the city's recession or depression phase**, because
the policy rate is at its 0.25% floor precisely when the country is in a deep
recession, and the city is in a glut at the same time. Split by phase:

```
index ≤ 2.5%                     n     office cap p50   office vacancy p50
  recession / depression      1050        8.75              33.2%
  recovery / expansion / peak  655        6.67               9.8%
```

**At a 2% index in a functioning market the engine prices office at 6.67%.**
That is the 2013-19 record (national office 6.5-7.0 on a ~2% ten-year, trophy
CBD at 4.5-5, suburban Class B at 7.5-8.5 — and `capRateFor` spreads the
city's buildings 4.9 / 7.5 / 9.7 at p10/p50/p90 around it, good condition 6.7,
worn 8.05, which is that distribution). The 8.75 is a market with a third of
its offices empty. In 2009-11 the real thing produced exactly that — office
caps of 8-8.4 on a 3% ten-year — and then healed in three years as vacancy
came off 17.5% and credit reopened. The engine's glut does not heal: office
vacancy sits at **23.4% in the median cheap-money month** and 33% in the
depression ones, against a US national peak of ~19.5% (1991, 2024). That is
`REALISM_AUDIT_2026-08.md` §1 — standing stock has no exit, so a glut cannot
clear — read through the cap rate. The cap is pricing the vacancy honestly;
the vacancy is the fake number.

## What was fixed: the top of the wire

The same table has a second fault, and it IS the wire. Above a 10% index the
office cap is **on the 11% ceiling in the median month**, and the ceiling
binds in **17.4% of all months** (multifamily 7.7%) — a load-bearing rail,
fake number five. The term read the NOMINAL index at 0.55 per point, so a
Great Inflation at a 14% index asked for a 13% cap. The record refused that
every time: 1981, ten-year 14%, office 9-10; 1978, 8.4% against caps of 8.5;
property yields spent 1979-84 BELOW the ten-year by up to four points. The
inflation inside a nominal rate is also inside next year's rent, so a buyer
capitalises against the index less the inflation the public expects.

And the pass-through is one-sided, because rents are sticky downward: a lease
carries a fixed 2-3% bump whatever the CPI does, which is why US rent growth
never turned negative through 2010-15 at 1.5% inflation. This matters here
because the engine's `inflExp` sits at **zero in the median cheap-money month**
(p10 −0.5%) — a symmetric real-rate term was tried first and lifted every
cheap-money cap by about a point, the opposite of the record. So expected
inflation enters the cap target only above the 2% target it is anchored to
(`inflOver` in `market.ts`); at or under it the expression is exactly the
nominal one it replaces, and the modern-era calibration does not move.

After, same eight seeds and eras (`pnpm capvsrate`):

```
                                          before      after
office cap ON the 11% ceiling, all months  17.4%       4.5%
multifamily on the ceiling                  7.7%       0.5%
index ≥ 10: office cap p50                 11.00      10.44   (inflExp p50 7.1% → 5.2%)
index 6-8:  office cap p50                  9.34       8.19
index ≤ 2.5: office cap p50                 8.17       6.35
index ≤ 2.5, recession/depression           8.75       7.87   (office vacancy 33% → 21%)
index ≤ 2.5, functioning market             6.67       6.08   (vacancy 9.8% → 6.0%)
whole run: office cap p50 / spread p50   8.93 / 3.69  7.74 / 2.58
```

Read the bottom half of that table with `HANDOFF.md` §4 in mind: a change
that moves values moves every state-dependent branch after it, so the after
run is a different century on the same seeds, and this one drew far less
office vacancy (17.6% → 8.9% at the whole-run median). The term is identical
by construction wherever expected inflation is at or under target, so the
cheap-money moves are mostly the world, not the wire; the depression months
still print 7.9 on 21% vacancy, which is the diagnosis above holding. The
top half is the wire: the ceiling has gone from the number to a guard, and
what still touches it is the engine's Volcker — a real policy rate of 7.6%
in the median high-rate month, twice the real 1981-82 peak, which is the
central bank's aggressiveness and not the cap's to fix.

## What is not fixed, and what would fix it

Two upstream faults, both named before, both larger than a cap-rate change:

1. **The glut has no exit** (`REALISM_AUDIT_2026-08.md` §1). Office vacancy
   runs 17.6% at the century median and 33% in a depression, because no class
   but industrial can mothball, demolish or convert. Until standing stock can
   leave, `vacRisk` will price a vacancy no real market has had, and the +2.0
   guard on it will keep binding. The realistic mechanism is written down
   there: a carrying-cost comparison per building, not a development pro
   forma. Do not weaken `CAP_VAC_BETA` (0.12/pp is inside the 2024
   cross-metro evidence — SF at 30%+ vacancy traded office at 8-10 caps on a
   4.2% ten-year) and do not raise the guard first.

2. **Credit stays shut for as long as the glut lasts.** `creditIdx` targets
   0.62 through a depression, and the depression is stretched while slack is
   load-bearing, so `crunch` sits at +0.5-0.6 for a decade. The real CRE
   credit crunches lasted about three years (1990-93, 2008-11): bank losses
   were recognised and capital rebuilt on the lender's clock while the space
   market was still empty. The mechanism is capital availability derived
   from the lenders' own balance sheets (`lenders.ts` already carries capital
   ratios and panic spreads) rather than from the property phase table — a
   change that touches every borrowing quote and every rival, and should be
   its own decision.

Neither should be reached for through the cap formula. Severing the vacancy
or credit pricing to make cheap money read cheap would be a fake number
wearing the owner's request.


# THE RENT ROLL WAS BIGGER THAN THE BUILDING — fixed

Found on the owner's own screen: "Leased 7,504 sf of 5,986 sf". A five-storey
office of 8,314 gross feet at 72% efficiency has 5,986 rentable feet, and its
roll carried 7,504 — two tenants sized off the GROSS plate. Occupancy printed
100% with a suite still empty, and the rent on 1,518 feet that do not exist
arrived every month.

The seam: HANDOFF §7 1b moved every READER of area — `occupancyRead`,
`useVacantSf`, rent, NOI, cap, stock — onto `rentableSf`, and left the
WRITER on gross. `stacksOf` built plates from `useSf`, `typicalSuiteSf` and
`drawTenantSf` drew suites from those plates, `buildRentRoll` filled toward
`useSf × targetOcc`, `blocksOf` laid vacant blocks from `useSf − tenants`,
and the `overleased` invariant measured tenants against `useSf` — so the
identity "tenants + vacant blocks == useSf" held to the foot while the
building it described was 8-28% smaller than the roll. One quantity, two
answers, with the invariant written on the wrong one.

Everything in the physical layer reads rentable now. Measured on three
procedural cities × five years: 0 of 1,945 listing legs let past rentable
(before: any leg could run to gross). `pnpm suite-occ` and `pnpm
plates-blocks` assert the identity on rentable feet; the 9,371 ft shed is one
8,295 ft plate. This changes how many tenants a roll draws, which re-rolls
every century (§4 of HANDOFF) — the baseline moves, and the direction is the
correction: smaller rolls, lower in-place income on the same buildings, and
an occupancy figure that can no longer be pinned at 100% by arithmetic.

# STANDING ROLLS LEFT SLIVERS — fixed

`buildRentRoll` filled a leg toward its target with log-normal draws and
stopped when what was left could not take a tenancy, so a 3,000 ft shop was
generated as a 2,500 ft tenant and a 500 ft remnant, and a five-floor office
as four floors let and one unlettable strip. Each sliver was honest in itself
(`occupancyRead` names it) but the market model that prices the building
counts those feet as occupiable, and `pnpm playtest` §B put the seam at 17pp
for retail, 10pp industrial, 3pp office once the rolls were on rentable feet.

A landlord generating a standing roll demised to fit: when the space a draw
would leave cannot be let on its own, the tenant took it. Measured, same
harness, re-rolled world: retail 17pp → 8pp, industrial 10 → 9, office 3 → 8
(rolls 82 → 85% let; the market side moved the other way on the re-roll).
What remains is the for-sale skew the harness names and the −14/+5pp opening
draw, both deliberate. Prospects arriving later still leave remnants through
`matchBlock`, on purpose — that is the demise trade the leasing overhaul
built, and `pnpm demise` keeps it a minority of vacant feet.

# A STANDING ROLL LETS A SUITE, NOT THE VACANCY FRACTION — fixed

On a multi-plate leg `buildRentRoll` fills toward `legSf × targetOcc`, and
the "whole leg under the norm is the shop" branch took `free` — the target's
remainder — as the tenancy when it was under the demise floor. That is right
on a one-plate shop (the target IS the leg) and wrong on two plates at a 47%
target: a 1,953 ft tenant on a 4,110 ft shop leg, under the 2,000 ft floor.
Nobody demises to the market's vacancy fraction; they let a suite. The branch
now writes `min(legSf, floorSf)` and the roll runs a shade over target. The
floor never exceeds the plate (`typicalSuiteSf`), so it is the whole leg only
when the leg is the suite. No draw order changed.

# A REFINANCE QUOTE WITH NO REASON IS A DEAD BUTTON — fixed

`refiQuotes` sized on three tests and then multiplied by `collateralHaircut`
(concentration, rollover inside two years, one trade), and the card printed
the name of the test beside a cheque the haircut had halved. Separately the
"advance rate" leg is the desk's stated rate after `advanceFactor` (credit
window × lender appetite), your standing and the desk's book, and the card
printed the stated rate. Both reasons are now on the quote and the desk, and
`pnpm refi-bind` asserts proceeds = min(legs) × haircut with the haircut named
whenever it bit.
