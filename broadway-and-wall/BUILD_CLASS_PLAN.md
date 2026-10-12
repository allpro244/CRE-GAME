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

_See §2b — filled in from the run._

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

## 7. Order of work

0. **Measure.** Promote `test/build-spec-arms.mjs` to cover 4 tiers × location
   tercile × hold (7 / 15 / 30 y) × unlevered/levered, **real development cost**
   (hard + soft + contingency, not hard alone — the current probe understates
   the cheap side's advantage), paired seeds, per-seed differences. Report only.
1. **Bones** — tier snap, wear-rate by spec, value opens "standard", gut capped
   at one tier. Smallest change; it alone closes "fix it later". Re-measure.
2. **Tenant pool** — class into `rollCredit`. Re-measure.
3. **Flight to quality** — class-weighted arrival/renewal tilt, zero-sum across
   the city. With the Market agent. Re-measure.
4. **Exit and debt** — buyer pool and life-company gate by class.
5. **Class label** in the engine API; hand to UI.
6. After each: `pnpm conserve`, `pnpm gate`, `pnpm baseline:check`; regenerate
   BASELINE with the reason in the commit.

## Do not

- Do not shave cheap rents or add a penalty multiplier. The cheap building is
  not worse because we say so; it is worse because its plant dies sooner, its
  tenants are weaker, and it empties first.
- Do not rank on terminal net worth (QUALITY_BALANCE_PLAN.md: the exit lands
  wherever the cycle lands). Rank on PV of cash flow less real cost, paired.
- Do not tune any coefficient until the tiers sort the way §5 says.
