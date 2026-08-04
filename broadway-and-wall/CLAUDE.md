# THE FIRST PRINCIPLE

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

The harnesses are the enforcement, and their job is to be adversarial:

- `pnpm econ:accept` and `pnpm sim:accept` are the gate.
- `pnpm audit` asks whether a shock in one place moves the right things
  elsewhere, and reports BACKWARDS as worse than BROKEN — because a wire that
  transmits the wrong way is a fake that also lies.
- `pnpm stress` asks whether the world exists without the player, whether the
  player exists to the world, whether there is a dominant strategy, whether
  there is a money pump, and whether it survives its own bounds.
- `pnpm quality`, `pnpm rates`, `pnpm devyield`, `pnpm playdev` measure single
  channels end to end.

**A test that cannot fail is itself a fake.** Three tests in this repo were
measuring `g.comps.length`, which is capped at MAX_COMPS, so they reported the
cap and their thresholds could never trip. The tournament's dominance number
divided by a bankrupt strategy and read "116770360.0x". Check that a metric can
move before trusting that it did.

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
