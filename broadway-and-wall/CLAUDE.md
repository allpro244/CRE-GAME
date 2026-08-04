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

The harnesses are the enforcement, and their job is to be adversarial:

- `pnpm econ:accept` and `pnpm sim:accept` are the gate.
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

    Dcash == (noi + sold + interest)
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
