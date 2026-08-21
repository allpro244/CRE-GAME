# Fixing what the playtest found

Companion to `PLAYTEST_2026-08.md`. That document measured the faults; this one
says what to do about them, in what order, and what measurement closes each
step. Every ordering decision here is downstream of one finding: **most of the
occupancy gap is a single arithmetic bug**, and several things that look like
separate faults are its consequences.

---

## What changed since the playtest was written

The playtest left one question open — *which side of the occupancy
disagreement is wrong* — and offered a hypothesis. The hypothesis was
half right and the diagnosis is now much sharper.

**Correction to the playtest's §1.3.** A follow-up probe reported that a
building held twenty years by a landlord with unlimited cash settles at 0%
median occupancy. That was a composition artefact — the bot bought whatever
was cheapest and cheapest means smallest. Traced individually, a 44k sf
five-floor office ran 27 letters over 20 years, signed 25, and finished at
87%. **The leasing engine works.** The size gradient below is the real shape,
and it is a better fault than the one I thought I had.

---

## The root cause

Occupancy rises monotonically with how many suites a leg demises into. Every
commercial leg in the city, roll-side, no player:

| leg demises into | share of city sf | median occupancy | zero-let legs |
|---|---|---|---|
| 1 suite (indivisible) | 7.1% | 100% / 0% bimodal | **26%** |
| 1.5–3 suites | 13.0% | **57%** | 7% |
| 3–6 suites | 21.7% | 62% | 0% |
| 6–12 suites | 24.4% | 70% | 0% |
| 12+ suites | 33.8% | **81%** | 0% |

There is no such gradient in life. A two-suite building is not structurally
half empty. This is `buildRentRoll`'s fill loop:

```js
const target = whole ? (rng(s,"leasing") < targetOcc ? legSf : 0) : legSf * targetOcc;
while (leased < target && guard++ < 40) {
  const free = target - leased;
  const sf = toSuites(rec, want, free, use);   // whole suites only
  if (!sf) break;                              // <- the remainder is dropped
  ...
}
```

It fills `legSf × targetOcc` with **whole suites and drops the last partial
one, every time, and never rounds up.** So realised occupancy ≈ `floor(N·p)/N`
— a systematically downward-biased estimator of the occupancy it was aiming at,
and the bias is worst where N is smallest.

Tested directly against that prediction:

| suites in leg | n | model aims at | roll achieves | `floor(N·p)/N` predicts | unexplained |
|---|---|---|---|---|---|
| 1.5–2.5 | 439 | 80% | 55% | 54% | +1pp |
| 2.5–4 | 460 | 80% | 61% | 68% | −7pp |
| 4–7 | 380 | 79% | 67% | 69% | −2pp |
| 7–12 | 218 | 83% | 71% | 76% | −5pp |
| 12+ | 132 | 86% | 81% | 83% | −2pp |

The quantisation explains the shortfall to within 1–7pp everywhere. The
residual is the −4.5pp mean of the listing skew (root cause 3).

**The engine already knows the right answer and applies it one branch away.**
The `whole` branch, for indivisible legs, says it in its own comment: *"For an
indivisible space the target occupancy is not a fraction of floor to fill. It
is the CHANCE that the space is let."* That is exactly the correct treatment
of the last partial suite of a divisible leg, and it was never generalised.

Two smaller root causes sit underneath:

**Root cause 2 — the two layers are anchored to different constants.**
`mktDelta` is deliberately written as a *difference* so it is exactly zero at
natural vacancy. At that zero point:

| class | `OCC_BASE` | `1 − NATURAL_VAC` | gap |
|---|---|---|---|
| office | 0.84 | 0.885 | −4.5pp |
| retail | 0.89 | 0.915 | −2.5pp |
| multifamily | 0.94 | 0.955 | −1.5pp |
| industrial | 0.87 | 0.930 | **−6.0pp** |

Plus the deliberate mean-negative shape terms: `idio` −2.6pp, `trouble`
−1.7pp. So when the city model says a class is exactly at natural vacancy, the
building model says its buildings are ~9pp emptier than that.

**Root cause 3 — a selection argument applied to the whole population.**
`buildRentRoll` adds `rrange(-0.14, 0.05)` — a −4.5pp mean — justified as
*"a building coming to market is disproportionately one with a leasing
problem."* That is a **selection** argument. It is correct for a listing and
wrong for the other ~95% of the city's stock, which is measured through the
same function.

---

## The order, and why

Steps 1–3 all move city occupancy **up**, and they interact — so they land
together, are measured together, and the baseline is regenerated once at the
end of them rather than three times. Steps 4 onward are independent of each
other but must come after, because each is measured against income that
steps 1–3 change.

### Step 0 — make the fault visible before fixing it

`pnpm playtest` section B already computes the identity. Promote it to
`BASELINE.json` as `roll.vsCityVac.{class}` — the sf-weighted gap between
`1 − cityVac[k]` and the rolls of the same buildings.

This is the repo's own doctrine and the file already carries the shape of this
exact bug in its header: *"how 27% of the city's shopfronts stayed structurally
unlettable for an unknown number of commits."* The metric can move, it is not
pinned at a rail, and it costs ~20s.

**Done when:** the gap is a tracked number. It will read ~16pp office / ~28pp
retail today. That is the starting line, not a pass.

### Step 1 — the last suite is a probability, not a rounding error

In `buildRentRoll`, fill `floor(N·p)` whole suites and take one more with
probability `frac(N·p)`, so the fill is unbiased in expectation. This is the
`whole` branch's own logic generalised to the divisible case.

**RNG safety — this is the trap that eats days.** Changing the *number* of
`rng()` calls re-rolls the century (HANDOFF §4). This fix is safe **inside
`genRentRoll`**, which draws from a private stream keyed on the parcel and
restores `s.rng` in a `finally` — it costs the shared stream nothing by
construction. The same quantisation exists in `tickLeasing`'s ongoing
leasing, and there it is on the **shared** stream. Fix `genRentRoll` first,
measure, and treat the `tickLeasing` change as a separate commit whose
baseline move must be re-rolled before it is diagnosed.

**Done when:** roll occupancy no longer slopes with suite count. The 1.5–3
suite bucket should come up from 57% toward the 12+ bucket's level; the
gradient across the five buckets should be within a few points end to end.
Re-run the `floor(N·p)/N` table — "unexplained" should stay small while
"roll achieves" moves up to "model aims at".

### Step 2 — anchor the two layers to the same number

Make the sf-weighted mean of `useOccupancy(..., stabilised)` over the city's
stock equal `1 − cityVac[use]` when the city sits at natural vacancy. That
means `OCC_BASE` absorbs the known means of `idio` (−2.6pp) and `trouble`
(−1.7pp) rather than sitting below the target *and* carrying them.

**This is not a fudge and the distinction matters.** It is not a coefficient
turned until a test passed; it is making an identity true by construction that
the code already claims. `mktDelta` is written as a difference *specifically*
so the calibration is untouched at the zero point — that intent is currently
defeated by an anchor 4.5pp away from the thing it is a difference from. Say
so in the comment, with the arithmetic.

**Done when:** with `cityVac[k] == NATURAL_VAC[k]`, the sf-weighted stabilised
occupancy equals `1 − NATURAL_VAC[k]` to within a point, per class.

### Step 3 — scope the listing skew to listings

Move `rrange(-0.14, 0.05)` behind the same condition that already gates the
distressed skew: it applies when the building is being *brought to market*, not
when the city's stock is being described. `genRentRoll` already takes a
`distressed` flag; it needs the equivalent for "this is a listing."

**Done when:** a building's roll does not change because somebody listed it,
except through the distress path. Watch `pnpm legmatch` and the comps sheet —
this is a "one quantity, two answers" risk in the making if the listing roll
and the held roll diverge for any other reason.

**After 1–3 together:** regenerate `BASELINE.json` in one commit and write the
measurement down. Expect a large, deliberate move — occupancy up means NOI up
means values up means land up. `pnpm gate` and `pnpm conserve` must stay green
throughout; they are identities and nothing here should touch them.

**Expect the game to get easier, and do not fix that by re-breaking this.**
Per `CLAUDE.md`, difficulty is an output. If a correctly-occupied city makes
compounding too easy, the question is which real risk is still unmodelled —
not which number to shave back.

### Step 4 — make the ask read the roll

The playtest's largest player-visible finding, and independent of 1–3 (though
its severity falls once buildings are fuller). `sim.ts refreshListings`
anchors every ask to `assetValue(rec, econ, grade)`, which prices at model
occupancy, so a building one-tenth let asks 0.99× appraisal and a full one asks
0.99×.

The parts are all present: `stampListing` already writes the roll onto every
listing through all eight doors, and `disclosureFor` / `asIfOwned` / `inPlace`
already put it in the shape a valuation wants. The ask should be struck on the
income the deed conveys, with the lease-up to stabilisation priced as what it
is — a cost the buyer carries.

**Done when:** `pnpm playtest` section A shows ask/appraisal *falling* with
roll occupancy instead of flat at 0.99×, and the share of ordinary listings
offered at a negative going-in cap goes to near zero (today: office 9%, retail
14%, multifamily 20%).

**Watch for the money pump.** `refreshListings` already carries a long comment
about exactly this hazard in the other direction — buy at the ask, mark at the
appraisal, and you are richer every time. If the ask reads the roll but
`holdingValue` still marks at model occupancy, that pump reopens on the other
foot. Both sides move together or neither does. `pnpm stress` is the check.

### Step 5 — re-measure development, then decide

**Do not touch the residual first.** Office needing $72.10/sf against a $23/sf
market is a 3× gap that no coefficient should be asked to close, and steps 1–3
raise achievable income directly — which moves the residual on its own. Re-run
`pnpm pencils`, `pnpm breakeven` and `pnpm playtest` section F *after* the
occupancy work and see what is left.

Two things are worth fixing regardless of what that shows:

- **The pro forma divergence.** `planDevelopment` strikes `yieldOnCost` on
  `stabNoi` — stabilised NOI at model occupancy — and `pnpm devyield` shows the
  delivered building sitting at 74% occupancy at +10y and 0.36–0.81× basis at
  +20y, long after lease-up is over. That is the same root cause arriving in
  the most expensive place in the game, and it should re-measure after step 1.
  If it survives, it is its own bug.
- **Gate band L.** delivered/demolished runs a median 0.49 against a 0.60
  floor — the city tears down about twice what it puts up. It is reported and
  not gated, and it has been sitting in the open.

**Done when:** office is the best use on more than 0.0% of lots in
`pnpm pencils`, and the `devyield` pro forma and the delivered building agree
at +20y within the error a lease-up can explain.

### Step 6 — give the labour market a cycle

Independent of everything above. Unemployment is identical in recessions and
booms (2.80% vs 2.80%) and sits on its 2.8% frictional floor in 57% of months,
because `market:1911` — `e.jobs = clamp(wanted, 0, force × (1 − FRICTIONAL))` —
is at its ceiling in 46.3% of calls.

**The floor is defensible; a city permanently against it is not.** The comment
at that clamp is right that nothing sustained below ~2.5% has been recorded,
and right that raising the floor would only hide the problem again. The fault
is upstream: labour demand is allowed to run arbitrarily far ahead of labour
supply, and the excess parks in `jobVac` permanently — 2.5% of the labour force
at the median, 11% at p90, for forty years. One job in ten unfilled for a
generation is not a labour market that clears.

The mechanism the code already documents is the speed mismatch: jobs move at
1.88%/yr median against population at 0.89%. The answer is probably in what
happens to unmet labour demand — firms that cannot hire do not queue forever,
they slow down, relocate, or automate — rather than in the floor.

**Done when:** `market:1911`'s ceiling-bind rate falls well below 46.3%, and
median unemployment in recessions is meaningfully above median unemployment in
expansions. Do not gate on a level; gate on the **gap between phases**, which
is the thing that is missing.

### Step 7 — reconcile the documents

`rail.vac.industrial.lo` binds 73% of months in the committed baseline against
a `HANDOFF.md` open-fault entry marked **CLOSED**. `pnpm vacdist` agrees with
the baseline: industrial sits on its friction floor 73.3% of the time, near
natural 5.7%. Steps 1–3 will move industrial occupancy and this must be
re-measured after them anyway — but whichever way it lands, `HANDOFF.md` should
stop disagreeing with `BASELINE.json`.

Note industrial is the thinnest sample in the town (~7 legs per seed); several
of the playtest's industrial readings carry that caveat and should not be
over-read.

---

## Sequencing at a glance

```
Step 0  baseline metric                          ~1h    no world change
Steps 1-3  occupancy identity  (one baseline)    large world change, gate green throughout
Step 4  ask reads the roll                       large player-visible change, watch the pump
Step 5  re-measure development, then decide      depends on 1-3
Step 6  labour cycle                             independent
Step 7  docs                                     after 1-3
```

Steps 1–3 are the load-bearing ones. Everything in the playtest report except
the labour market is either caused by them or measured against income they
change.

## What I would not do

- **Do not tune `OCC_BASE` until the gap closes.** Step 2 sets it by an
  identity with the arithmetic written down. Hill-climbing it against the
  playtest's own number is fitting the test.
- **Do not add a coefficient to close the development gap.** Step 5 exists to
  find out how much of it was the occupancy bug first.
- **Do not raise the frictional floor** to make unemployment look cyclical.
  That is the rail hiding the fault, which is what it did before.
- **Do not fix `tickLeasing`'s quantisation in the same commit as
  `genRentRoll`'s.** One is RNG-safe and one re-rolls the century; landing them
  together makes the re-roll indistinguishable from the fix.
