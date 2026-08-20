# REALISM OUTRANKS PREFERENCE — INCLUDING THE OWNER'S

**Realism outranks the owner's preferences, including the owner's stated
preferences about difficulty. When a request and realism disagree, say so with
evidence and build the realistic thing.** This is standing instruction, not a
per-task judgement call. The owner has asked for it explicitly: *"I more so care
about realism before my preferences."*

In practice that means a suggestion arrives as a hypothesis, not a spec. Test
it. If it holds, build it. If it does not, show the measurement that says so and
propose the mechanism that delivers what the suggestion was reaching for. A
worked example is in ECONOMY.md: the proposal was to make the central bank ease
when the city's economy turns. Measured, the bank was not the broken part — the
glut never reached the labour market at all, so there was nothing to respond to.
The realistic fix delivered the same symmetry as a consequence instead of an
instruction, and it refused a rule that would have paid a player for wrecking
their own city.

# DIFFICULTY IS AN OUTPUT, NOT A DIAL

The sim should be hard. It does not get to be hard by being made hard — no
penalty multipliers, no returns quietly shaved, no difficulty setting hiding in
a coefficient. Real commercial real estate is punishing for specific, nameable
reasons, and the way this game gets hard is by modelling every one of them
honestly:

illiquidity and the months a sale actually takes · transaction costs and
transfer tax on both ends · lease-up risk on anything you build or empty ·
capital calls when a job overruns · the refinancing cliff when a balloon lands
in a bad market · covenant tests that trap cash flow · deferred maintenance
compounding · the tax bill on a value that no longer exists · concentration in
one submarket or one tenant industry · the fact that most dirt does not pencil
and most deals should be walked away from.

Get those right and the game is hard because the business is hard. This also
means difficulty has a SHAPE, not a level: a well-located stabilised asset held
unlevered is genuinely a boring bond, and it is not a bug when it behaves like
one. If the game feels too easy, the question is never "what should we make
worse" — it is "which real risk is not being modelled yet."

# NO FAKE NUMBERS

**The economy is a simulation, not a set of numbers arranged to produce a
result. Nothing in it is allowed to be a fake number.**

This governs every metric that touches real estate — rent, cap rates, land,
construction cost, absorption, debt, tax, operating expense, lease-up,
brokerage, everything down to the smallest line. It is the standard this
codebase is measured against, and it outranks any individual balance target.

## What a fake number is

1. **A constant chosen to make an outcome come out right.** If a coefficient
   exists because the median run looked wrong without it, it is a fake. The
   real fix is upstream, in whatever the coefficient was compensating for.

2. **A number asserted where a mechanism belongs.** A parcel's land value that
   never learns from the parcel next door trading is not a price — it is a
   label. Prices in this game must be *discovered* by the mechanism that
   discovers them in life: income capitalised, comparables observed, cost
   replaced, residuals solved.

3. **The same quantity with two different answers.** If `planDevelopment` says
   a finished building is worth $299.9M and `holdingValue` says $196.5M, one of
   them is fiction, and the player is being shown a decision that is not the
   decision they are actually taking.

4. **A game-design choice wearing an economic label.** A deposit rate held flat
   "because cash should not be a strategy" is a balance decision, not a
   monetary one. If cash sitting idle is too strong, the answer is the cost of
   carrying an idle balance sheet — not a rate that ignores the policy rate the
   rest of the engine reads.

5. **A rail that hides a fault.** A clamp that stops a number going somewhere
   absurd is fine as a guard and is a bug when it is load-bearing. If a
   variable rests against its rail in normal play, the rail is holding up the
   model.

## What is NOT a fake number

Calibrated industry constants are the opposite of fakes — they are the
simulation touching reality. A 4% management fee, a 1.1% tax rate, a 6%
brokerage fee, a 39-year depreciable life, hard cost per square foot by class:
these are measured facts about the business and belong hardcoded, with a
comment saying where they come from. The test is not "is it a constant", it is
**"is it a fact about the world, or a thumb on the scale."**

Shape parameters — a decay length, a response elasticity, an S-curve exponent —
sit in between. They are legitimate when they are calibrated against something
real and stated as such, and fakes when they were turned until the test passed.
Say which, in the comment, every time.

## How this is enforced

Four tiers, by what they can catch and what they cost. Run the cheap one
constantly; the expensive ones exist for the faults the cheap one cannot see.

| | cost | catches |
|---|---|---|
| `pnpm check` | ~20s | a moved standing number, a broken ledger, a stale bundle |
| `pnpm gate` | minutes | a violated identity, a broken city invariant |
| `pnpm report` · `pnpm stress` · `pnpm audit` | 10-30 min | a breached band, a dominant strategy, a backwards wire |
| `pnpm test` | ~22 min | a state the engine should never be able to reach |

`pnpm engine` rebuilds `test/.engine.mjs`. Do it before any probe; every
harness refuses a stale one.

### `pnpm check` and BASELINE.json — for the fault the other tiers cannot see

**A gate catches a violated identity. A report catches a breached band. NEITHER
CAN CATCH A NUMBER THAT IS SIMPLY WRONG, because there is nothing to compare it
to.** That is not hypothetical and it is not rare — it is how 27% of the city's
shopfronts stayed structurally unlettable for an unknown number of commits, and
how the median land value fell 71% in a single commit with every check in the
repo green. Nothing was out of balance. No band moved. The city was just quietly
wrong, everywhere, and no harness in the repo was shaped to notice.

So `BASELINE.json` is a committed record of ~31 standing numbers at a known
commit, and `pnpm baseline:check` diffs the working tree against it. Seventeen
seconds. It is a REPORT, not a gate: movement is not failure, because a fix that
improves the world moves numbers. What it is for is making sure nobody moves one
WITHOUT NOTICING. Regenerate with `pnpm baseline` when you have decided a move
is correct — and say in the commit message why.

Three rules for adding a metric, all learned the hard way and all in the file:

- **It must be able to move.** A metric pinned at a cap measures the cap.
- **It must not measure the clock.** The first cut sampled at month 300 and
  reported lot affordability as ZERO, which looked catastrophic and was nothing:
  affordability is cyclical — 8-12% mid-cycle, near zero at the turns — so a
  one-month snapshot reports the phase of the cycle rather than the level of
  anything. Cyclical quantities are ten-year means; only stocks are read at the
  end.
- **It must be CHEAP,** or it will not be run, and a check nobody runs is worse
  than no check because it looks like coverage.

**Count the rails.** Fake number five is a clamp that is load-bearing rather
than a guard, and you cannot see one by reading — only by counting. Twelve
rail-bind rates sit in the baseline for exactly this, sampled every month
(a rail that binds for a quarter and lets go is what an annual sample misses),
and every watched rail is reported even when it never binds, because a metric
that only appears once it goes wrong is a metric nobody can see going wrong.

The rest of the harnesses are the enforcement, and their job is to be
adversarial:

- **`pnpm gate` is the gate.** It runs the two things that are IDENTITIES rather
  than opinions: `conserve`, and the city invariants. It must pass before
  anything is committed that moves money.
- **`pnpm report` is a report, and it does not block.** The lettered acceptance
  tests — `econ:accept` (A–E), `sim:accept` (F–I), `city:accept` (J–M) — print
  what they measure and where it sits against its band, and a breach does not
  fail the build. `pnpm report:strict` opts back in.

  This was the owner's explicit decision, made twice: *"I don't know if I want
  you to follow that rigorous economy testing anymore. The one with letters"*
  and *"I think there's some of these policies the test that we can consider too
  strict"*. They were right about several. Measured: test F needed its seeds
  raised 7→20 before its estimator could distinguish a real breach from
  sampling, test G needed 15→40 and a rewrite of what it measured, and test H
  breached on 13 of 30 neutral seeds AT BASELINE — a test that fails on a
  healthy economy is measuring its own noise.

  A band is a matter of taste and a human narrowed it. An identity is not, which
  is why `conserve` stayed a gate. Do not re-promote the lettered tests, and do
  not weaken what any of them COMPUTES — loosening a band was a policy call;
  falsifying a measurement is not.
- `pnpm audit` asks whether a shock in one place moves the right things
  elsewhere, and reports BACKWARDS as worse than BROKEN — because a wire that
  transmits the wrong way is a fake that also lies.
- `pnpm stress` asks whether the world exists without the player, whether the
  player exists to the world, whether there is a dominant strategy, whether
  there is a money pump, and whether it survives its own bounds.
- `pnpm conserve` reconciles cash against the ledger every month for fifty
  years and fails on a single unexplained dollar. Run it after ANY change that
  moves money — it is the cheapest test in the repo and the only one that can
  see a payment nobody booked.
- `pnpm quality`, `pnpm rates`, `pnpm devyield`, `pnpm playdev` measure single
  channels end to end.

## Money moves through the ledger or it does not move

Every write to `s.cash` needs a matching `logBooks` entry, and the two
balance-sheet movements that are cash without being income or expense — the
revolver and tenant deposits — must show up in `s.loc.balance` or in a
holding's `tenants[].deposit`. `pnpm conserve` asserts exactly that identity:

    Dcash == (noi + sold + interest + borrowed)
           - (debtSvc + leasing + capex + dev + taxes + bought + ga)
           + Dloc.balance + Ddeposits

The sign of a residual tells you which kind of fault you have. Money
DISAPPEARING is a payment nobody booked. Money APPEARING is a liability
released without recording the gain — a forfeited deposit, a written-off
obligation — where no cash moves at all but net worth improves. Both existed
in this engine until the reconciliation was written, and neither was visible
from anywhere else.

A NaN once ate the player's entire bankroll in silence because nothing in the
model had the job of noticing. This is that job.

**A test that cannot fail is itself a fake.** Three tests in this repo were
measuring `g.comps.length`, which is capped at MAX_COMPS, so they reported the
cap and their thresholds could never trip. The tournament's dominance number
divided by a bankrupt strategy and read "116770360.0x". Check that a metric can
move before trusting that it did.

**It happened to `conserve` itself, which is the gate.** The bot bought a
building when `g.cash > 4_000_000` and kept a $2.5M reserve — both numbers sized
to a $6M opening bankroll. The opening bankroll became a choice of $1M / $2.5M /
$5M defaulting to $2.5M, and nobody came back to the bot. The threshold never
fired again. For an unknown number of commits the repo's one hard identity was
reconciling a player who owned nothing: 8 of the 10 ledger categories were flat
zero, `interest` and `ga` were the only two that moved, and the identity had
become `Dcash == interest - ga`. It printed "2,984 months reconciled. Every
dollar came from somewhere" the whole time, and it was true, and it meant
nothing.

Two things came out of that and both are in `test/conserve.mjs`. The bot's
thresholds are fractions of its own opening balance, so changing the start cash
cannot starve it. And the run now asserts its own COVERAGE before it reports a
pass — every ledger category the bot is meant to exercise must have moved, and
the run exits 1 naming the dead ones if not. It prints the coverage line either
way, so a category going quiet is visible rather than inferred.

The general rule: **an identity is only worth the question it was asked.**
`A == B` holds trivially when both sides are zero. Any harness whose subject is
a bot has a second failure mode nothing else will catch — the bot stopping — and
the harness is responsible for noticing.

**And a test measuring the WRONG BUILD is the same fault in a disguise** — it
can fail, just not about anything real, and it survives every check you make
against it because the checks load the wrong build too. `test/.engine.mjs` is
gitignored and built by hand. A container restart once left a bundle nineteen
hours stale; `pnpm conserve` then reported seven months out of balance, and the
seven were real faults in an engine that had since been rewritten. The obvious
control — stash the change, re-run, see whether the failures persist — CONFIRMED
THE WRONG CONCLUSION, because both runs loaded the same stale bundle. It could
only ever have returned "unchanged". Three commits and a whole plausible-looking
investigation came out of that. `test/fresh.mjs` now refuses to run a harness
against a bundle older than `src/`, and it is wired into `pnpm gate`. Rebuild
explicitly before any probe.

**Watch for the frozen world.** `advanceQuarter` returns state UNCHANGED once
`gameOver` is set, so an un-resurrected probe silently stops and every later
month is a copy of the month it died in. A measured "plateau" in the number of
firms a city supports turned out to be nothing but the game being over — the
comment asserting the plateau cited a number that could not have moved. Any
probe running past year ~30 without a player must resurrect:
`if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };`

**And measure on a constant cohort.** A trajectory sampled at fixed offsets
before each firm's death changes population at every offset — only long-lived
firms have 84 months of history, so the early columns are the survivors and the
late ones are everybody. That artefact produced a dramatic "AUM collapse" that
was half composition. Re-run on a fixed cohort before believing a shape.

**Never tune a bot until the number looks good.** If a strategy loses money,
find out whether the strategy is bad or the economy is broken, and say which.
Hill-climbing a four-seed median is fitting the test, not fixing the world.

## When a fix makes a headline number worse

Say so, keep the honest mechanism, and write down the measurement. A correct
model that scores worse than an incorrect one is information about the rest of
the model, not a reason to revert the correction — but it IS a reason to stop
and find what the incorrect number had been propping up. See the operating
deficit reserve in `ECONOMY.md`: removing the cash constraint on a developer
revealed that running out of money had been standing in for underwriting.
