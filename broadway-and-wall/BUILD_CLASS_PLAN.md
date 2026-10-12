# BUILD CLASS — WHY "BUILD CHEAP, FIX IT LATER" WINS, AND THE REVAMP

**Generated city, not Manhattan.** Every number here is from a generated city,
like every other harness in this repo.

Owner's ask (2026-10): *"Currently I think it's best to build as cheap quality as
possible then just improve it as you go along and it seems unbalanced. I'd like
this entire system revamped and rethought … somewhat simplified to manage but
more depth … certainly more depth on how it impacts your investment."*

Read CLAUDE.md first. The ask is treated as a hypothesis. It holds, and the
measurement below says why. **The fix is not to make cheap worse.** It is that
four real things a build quality decides are not modelled at all, so the only
thing the slider moves is a cost line and a thin rent line.

Lanes: other agents own UI, Market/Economics and Graphics. This plan is the
engine side of quality. Where it touches their lanes it says so (§6).

---

## 1. What the slider does today

One number, `buildSpec` 0..1 (0.5 = market), set at groundbreak.

| channel | where | effect, spec 0 → 1 |
|---|---|---|
| hard cost | `specCostMult` (proforma.ts) | ×0.69 → ×1.31 |
| rent | `specRentMult` (value.ts) | ×0.90 → ×1.10 |
| cap rate | `specSpread` (value.ts `capRate`) | +15bp → −15bp |
| condition ceiling | `condCeiling` | 0.90 → 0.995, decays 0.0027 → 0.0017 /yr |
| opening condition | dev.ts delivery | `min(ceiling, 0.90 + 0.09·spec)` |

What it does **not** touch: who the tenants are (`rollCredit` reads location
only), how long they sign (`termBandM` reads credit), how fast the plant wears
(`COND_DECAY` is per class, spec-blind), how occupancy behaves in a downturn,
lease-up speed, the lender's appetite, or who buys it on exit. Rivals and city
stock all build at 0.5, so there is no competitive set to be above or below.

## 2. Measured

### Day one — the pro forma (`planDevelopment`, 25-26 lots, demand > 55, 8 floors, 60% cover)

| spec | total cost | stabilised NOI | value ÷ cost (office) | value ÷ cost (flats) |
|---|---|---|---|---|
| 0.00 | 0.73× | 0.89× | **0.687** | **0.995** |
| 0.25 | 0.86× | 0.95× | 0.645 | 0.934 |
| 0.50 | 1.00× | 1.00× | 0.613 | 0.888 |
| 0.75 | 1.14× | 1.05× | 0.588 | 0.855 |
| 1.00 | 1.28× | 1.11× | 0.569 | 0.829 |

**Strictly monotone: the cheaper the bones, the better the deal, on every lot.**
Total cost spans 1.76×; NOI spans 1.24×. Probe: `test/_spec-pf.mjs` (scratch).

### The hold — `test/build-spec-arms.mjs` widened to spec 0 and 1

4 seeds × 30 y × 6 new offices, unlevered, Fund plan, every letter signed at
asking, PV at 7%. Cost is **hard cost × spec only**, so it understates the
cheap side's edge (soft cost and contingency scale with hard). "+capex" buys
every programme as soon as it is allowed.

| arm | spec | build cost | rent ÷ idx | NOI − capex | PV − cost | beats Standard |
|---|---|---|---|---|---|---|
| floor | 0.00 | $75M | 1.52 | $422M | **$147M** | 3 / 4 |
| floor + capex | 0.00 | $75M | 1.55 | $411M | $109M | 2 / 4 |
| budget ("Box") | 0.28 | $94M | 1.63 | $455M | **$145M** | **4 / 4** |
| budget + capex | 0.28 | $94M | 1.68 | $441M | $95M | 1 / 4 |
| Standard | 0.50 | $109M | 1.67 | $434M | $104M | — |
| Standard + capex | 0.50 | $109M | 1.76 | $499M | $109M | 1 / 4 |
| signature | 0.88 | $135M | 1.83 | $506M | $107M | 1 / 4 |
| trophy | 1.00 | $143M | 1.87 | $503M | $100M | 1 / 4 |

Read:
- **Cheap wins the 30-year hold too, not just day one.** Budget beats
  Standard on every seed; floor on 3 of 4. Trophy earns ~$80M more NOI − capex
  than floor over thirty years and still loses, because it paid ~$68M more
  up front and nothing makes the extra rent *safer*. Per-seed spreads are wide
  (−$62M to +$138M), so read the paired column, not the means.
- **"Fix it later" through programmes does not pay** in this run — every
  +capex arm except Standard's is behind its own no-capex arm. What the owner
  is seeing is mostly the *build cheap* half: the upfront saving is never
  clawed back by a cheaper building's operation. The gut route (§2, point 3)
  was not in this probe; step 0 adds it.
- So step 1 (wear and opening grade) and step 3 (flight to quality) carry
  the weight; programmes are not where the exploit lives.

### Why "fix it later" works

1. **Condition is the big rent lever, and every spec can buy it.** Condition runs
   0.62 → 1.20 on rent and +185 → −40bp on cap. Spec runs 0.90 → 1.10 and ±15bp.
   A spec-0 office opens at its ceiling 0.90, which reads "good" (≥ 0.865 is the
   top of the table), so it collects the full 1.20× for ~13 years on the Fund
   plan — exactly what a trophy collects. Trophy only pulls ahead once the cheap
   ceiling decays, and slowly: 1.16× vs 1.20× at year 30.
2. **The plan bill does not know the plant is cheap.** Wear is spec-blind, so a
   value building costs the same reserve per foot to hold at "good" as a trophy.
   And since the reserve is priced on asset value, the cheaper building pays
   *less*.
3. **A gut upgrades the bones.** `sim.ts` steps spec `0.4 × (0.75 − spec)` on
   completion. From spec 0 that is two-thirds of the way to "standard" in one
   job; a second gut gets past it. The one thing condCeiling says money cannot
   buy, money buys.
4. **There is no downside in the cycle.** Cheap and trophy space lose tenants at
   the same rate in a glut, so the cheap building's risk profile is identical
   and its yield is higher. In life this is the single largest difference.

## 3. What real quality buys (the missing mechanisms)

Each is a fact about the business, not a balance lever.

- **Flight to quality.** When vacancy is high, rents on good space come down to
  where tenants in lesser space can afford to trade up, and they do. Lesser
  space empties first and refills last. Recent prints: Washington trophy vacancy
  ~10% against ~26% for B/C; Houston trophy 21% against 27.5% Class A overall
  (Q4 2024); CBRE: Class A/trophy rents up ~3%/yr since 2021, everything else
  down ~1%/yr. Quality is a **beta**, not just a level.
- **The tenant pool.** Credit tenants and long terms gather in good buildings —
  a bank does not sign fifteen years in a building that leaks. Lesser space lets
  to smaller, weaker, shorter covenants: more rolls, more downtime, more TI and
  commission cycles, more defaults.
- **Plant life.** Value-engineered systems, roofs and façades wear out sooner.
  The reserve a value building needs to stand still is higher, per foot, than a
  premium one.
- **Exit and debt.** Core buyers and the life company want Class A; Class B/C
  trades value-add, to a thinner pool, at a wider and less certain cap
  (Chicago CBD: stabilised A 9.25-11% vs value-add 10.75-12.75%, H1 2026).
- **You cannot retrofit bones.** Floor-to-floor, column grid, core, slab — what
  you built is what you have. A re-clad and re-plant lifts a building about one
  class, at more than it would have cost to build it in, and with the building
  empty while it happens.

## 4. The revamp — three layers, one new decision

Kept simple for the player: **one choice at groundbreak** (four named tiers),
**the two dials they already have** (service, plan), and **one label they read**
(Class A / B / C).

### Layer 1 — Bones (chosen once, permanent)

Snap the slider to four tiers. The number stays 0..1 underneath so saves and
every reader keep working.

| tier | spec | hard cost | what it is |
|---|---|---|---|
| Value | 0.15 | ×0.78 | value-engineered box, short-life systems |
| Standard | 0.50 | ×1.00 | what the street builds |
| Premium | 0.75 | ×1.155 | better skin, plant and lobby; institutional grade |
| Trophy | 0.95 | ×1.28 | name-on-the-building |

(Cost column is the existing `specCostMult`, untouched.)

Bones now set, in addition to today's ceiling:
- **plant wear rate** — `COND_DECAY × wearMult(spec)`, value wears faster.
  Shape parameter; calibrate on component-life tables (BOMA / RSMeans
  life-cycle: value-grade roofing and HVAC replacement cycles run materially
  shorter than institutional-grade). The plan bill already scales with wear, so
  this lands on the capex line by itself.
- **the opening grade** — a value building opens "standard", not "good". New
  is not the same as good; a value box is new and ordinary on day one.

### Layer 2 — Condition (unchanged mechanics)

`condIdx`, decay, the plan, programmes, gut — as today. Two changes:
- **A gut lifts bones at most one tier**, and the step is priced: the retrofit
  share of `RENO_COST_PSF` rises with the target spec. A gut never takes a
  Value box past Premium-minus. Replaces the `0.4 × (0.75 − spec)` step.
- Condition stops being the only premium a cheap building can buy — Layer 3
  reads bones and condition together.

### Layer 3 — Class (derived, what the market sees)

`classIdx = f(bones, condition, age against the city's stock)` read every
month, labelled A / B / C (+ "Trophy" at the top). Relative, because Class A is
relative: when a new tower delivers next door, everybody else moves down a
notch. This is the label on the tape, the rent roll and the leasing desk.

Class is the one input to five channels:

| channel | today | after |
|---|---|---|
| rent level | spec ×0.90–1.10 + condition | unchanged in level (§5) |
| **rent & occupancy beta** | none | arrival and renewal odds tilt toward high class as city vacancy rises above natural, away as it falls (flight to quality, both ways) |
| **tenant pool** | `rollCredit(location)` | `rollCredit(location, class)` → credit, and via `termBandM` term, deposit, default odds |
| **exit** | spec ±15bp | class-keyed buyer pool: cap spread and months-to-sell; C trades value-add |
| **debt** | life co `minCondition` | life co keys on class; C is bridge / regional only |

### Opex

The owner asked "maybe opex, not sure". **Recommended: not directly.** The
service dial already owns operating spend (Lean / Market / Institutional), and
operating cost follows the building's station through `locOpexMult`. A value
building's real extra cost is capital — plant replaced sooner — and that is
Layer 1's wear rate, which reaches the Books as capex, which is where it is in
life. One new opex channel would be a second answer to the same question.

## 5. What "balanced" means here — and what it must not mean

**Not** "every tier earns the same", and **not** "trophy wins". The real answer
depends on where and how long:

- Value should still win a **merchant build into a hot fringe market, sold at
  delivery** — cheap, fast, nobody holds it through a downturn.
- Trophy should win **prime dirt held through a cycle** — the beta and the
  tenant pool pay for themselves when the market turns.
- Standard / Premium are the long middle.

Acceptance (report, not gate): over the paired-seed arms in §7, **no tier is
best in every (location tercile × hold length × leverage) cell, and the best
tier rises with demand score and with hold length.** If Value still wins prime
30-year levered holds, a mechanism is missing; if Trophy wins the fringe flip,
one is overweight. Do not move `specCostMult`, `CONDITION_RENT_MULT`, or the
location tables to get there — those are calibrated, and the fault was never in
them.

Rent level is deliberately left alone in this plan: the A/B spread already
compounds spec × condition (1.10 × 1.20 = 1.32× over a standard B), which is
inside observed A/B asking spreads. Re-examine only if §7 shows the beta and
tenant pool channels are right and the level still is not.

## 6. Lanes

- **Market / Economics** — the flight-to-quality tilt reads city vacancy vs
  natural and lives in `absorption.ts leaseFactors` / `renewalIntent`. It must
  **redistribute** demand by class, not create it: the city's total take-up in a
  month is unchanged, only who wins it. Agree the hook before either side edits
  absorption.ts. Rivals choosing a tier (so the city has a real competitive set)
  is a supply-side change and is theirs to schedule.
- **UI** — DevelopDesk's slider becomes four tier buttons with a one-line
  "what you're buying" per tier; the holding card gains the Class label. The
  engine exposes `buildTier(spec)`, `classOf(rec, h, s)` and a per-tier pro
  forma read; layout is theirs.
- **Graphics** — optional: tier as a material/finish cue on the building.

## 7. Order of work — execution spec

**Status: planned, not started.** Owner's call (2026-10): execute after the UI,
Market/Economics and Graphics agents land. Before starting, merge their tips
and re-read the files named below — line numbers here are from
`claude/build-class-plan` at the commit that added this file and will drift.

Each step is one commit, measured before and after with step 0's harness.
After every step: `pnpm engine`, `pnpm conserve`, `pnpm gate`,
`pnpm baseline:check`; regenerate BASELINE only with the reason in the commit.

### Step 0 — the harness (report, no engine change)

`test/build-class-arms.mjs`, script `pnpm class-arms`. Grow it out of
`test/build-spec-arms.mjs`:
- arms: the four tiers (0.15 / 0.50 / 0.75 / 0.95), plus "Value + every
  programme" and "Value + gut when eligible" (the fix-it-later strategies);
- cells: location tercile (demand score) × hold 7 / 15 / 30 y × unlevered /
  levered at the desk's own max advance;
- cost: `planDevelopment(...).costTotal` per arm — hard + soft + contingency +
  lease-up, not hard × spec alone (the existing probe understates the cheap
  side's edge);
- columns: PV(NOI − capex + exit) − cost at 7%, occupancy mean and its
  standard deviation across the cycle, mean tenant credit, WALT, exit cap;
- per-seed paired differences against Standard; a tier "wins" a cell only on
  5 of 6 seeds;
- print the §5 acceptance line: best tier per cell, and whether it rises with
  demand and with hold.

### Step 1 — bones (engine only; closes "fix it later" by itself)

| change | where |
|---|---|
| `BUILD_TIERS` table {key, label, spec, blurb}; `buildTier(spec)` reader (nearest tier, so saved odd specs still read) | new, `src/engine/value.ts` beside `specRentMult` |
| wear by bones: `wear *= specWearMult(spec)`, shape parameter, Value ≈ 1.3×, Trophy ≈ 0.85×, calibrated on component-life tables and stated as such | `leasing.ts` monthly decay (`COND_DECAY[...] * ...`, ~line 1307); the plan bill reads `wear`, so capex follows with no second edit |
| opening condition: `min(ceiling, openIdx(spec))` where Value opens at a "standard" index and Premium+ at "good" | `dev.ts` delivery (~line 2139) and the same line in `test/build-spec-arms.mjs` |
| gut lifts bones at most one tier: `spec = min(nextTierSpec(spec0), 0.75)`, replacing `spec0 + 0.4 × (0.75 − spec0)` | `sim.ts` renovation completion (~line 714) |
| gut cost rises with the bones it lifts: retrofit share on `RENO_COST_PSF` when the step changes tier | `value.ts` reno cost (~line 3474) and `actions.ts startRenovation` quote |

Not touched: `specCostMult`, `specRentMult`, `CONDITION_RENT_MULT`,
`condCeiling` shape, programme costs and lifts.

### Step 2 — tenant pool

- `classIdx(rec, h, s)` — bones and condition blended, read against the
  sf-weighted spec/condition of the city's stock in that use (relative). Grade
  `classGrade(idx)` → "Trophy" | "A" | "B" | "C". Pure function, `value.ts`.
- `rollCredit(s, demand, classIdx)` — class shifts the draw the way location
  already does (`r + demand/250`). All three call sites in `leasing.ts`
  (~lines 750, 758, 2057).
- **Bug to fix on the way:** line 758 draws a *second* `rollCredit` for the
  deposit, so a tenant's deposit is sized on a different covenant than the
  tenant has. Draw once, use it for both.
- Term follows for free through `termBandM(credit)`.

### Step 3 — flight to quality (with the Market agent)

- `leaseFactors` (`absorption.ts` ~line 346) gains a "Building class" row:
  `mult = exp(β · (classIdx − cityMeanClass) · slack)`, `slack` = city vacancy
  over natural for that use (negative when tight, so the tilt reverses in a
  boom — tenants settle for B when A is full).
- `renewalIntent` (`leasing.ts` ~line 1020) gains the matching `fClass` and a
  `why` line ("a better building made them an offer in a soft market").
- **Zero-sum rule:** normalise so the sf-weighted mean multiplier across the
  city's stock is 1.0 each month. It moves who wins a lease, never how many
  leases the city signs. Agree this with the Market agent before editing
  absorption.ts; it is their file.
- β is a shape parameter; calibrate to the trophy vs B/C vacancy gaps in §3
  (DC ~16pp, Houston ~6pp at ~25% overall vacancy) and say so in the comment.

### Step 4 — exit and debt

- `capRateFor` (`value.ts` ~line 2243): replace `specSpread` (±15bp, bones
  only) with a class spread. C carries the value-add spread (~150bp over
  stabilised A, Chicago H1 2026), so condition's `qualSpread` and the class
  spread must be checked for double counting the same way QUALITY_BALANCE_PLAN
  §2 checked programmes. Instrument first.
- Life company (`debt.ts` `minCondition` ~line 58/288): gate on class ≥ A
  instead of condition alone.
- Months-to-sell by class, if the Market agent's sale-timing model has a hook;
  otherwise leave to them.

### Step 5 — the API for UI

Export `BUILD_TIERS`, `buildTier`, `classIdx`, `classGrade`, and a
`tierCompare(s, parcels, bbl, use, floors, coverage)` that returns the four
tiers' pro formas side by side (cost, stabilised NOI, value ÷ cost, opening
grade, plant wear). The UI agent owns the DevelopDesk tier buttons
(`DevelopDesk.tsx` ~line 698 slider and ~line 716 presets) and the Class label
on the holding card.

## 8. Open questions for the owner

1. Four fixed tiers, or keep a slider that snaps to them? (Plan assumes fixed.)
2. Should rival developers pick tiers (a real competitive set) in this pass or
   the Market agent's next one?
3. Saves: buildings already built at an odd spec read as the nearest tier for
   labels but keep their exact number for maths. OK?

## Do not

- Do not shave cheap rents or add a penalty multiplier. The cheap building is
  not worse because we say so; it is worse because its plant dies sooner, its
  tenants are weaker, and it empties first.
- Do not rank on terminal net worth (QUALITY_BALANCE_PLAN.md: the exit lands
  wherever the cycle lands). Rank on PV of cash flow less real cost, paired.
- Do not tune any coefficient until the tiers sort the way §5 says.
