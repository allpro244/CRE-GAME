# SHOCK TESTS — the plan (owner, 2026-10-31; to run Monday)

> *"The economy feels off, what are some ways you can stress test the
> fundamentals of the simulation? Like adding in 50% more for the supply of one
> asset class and see how the market responds."* The owner chose groups 1-4
> below (supply, demand, capital, cost). Not policy shocks, integrity sweeps or
> the historical replay — those are for later.

Every number in this file is on a GENERATED city (OWNER_PLAYTEST_NOTES §0).
CLAUDE.md applies throughout: a shock that responds wrongly is a question
about a MECHANISM. Trace it; never tune a coefficient until the row reads right.

## Method: paired twins

Same city, same seed, run twice. The shock is injected into one copy at a
chosen month; every difference after that is the shock's.

- **Harness:** build on `tools/econaudit-core.mjs` (`run`, `diverge`, `verdict`)
  and add the experiments to `tools/econaudit.mjs` as numbers 14+. Its rule
  stands: **an injector must not draw from the engine's RNG**, or the twins
  desynchronise and the difference is noise.
- **Timing:** inject at year 10, after the opening has settled. Read the
  response monthly for 15 years after injection (impact 0-3 years, adjustment
  3-10, recovery 10-15), as the audit already does.
- **Seeds:** 3 market seeds minimum (`SEEDS=3`), with the median and spread
  reported. One pair of twins is one draw of the noise
  (`test/economy.mjs` learned this: a single seed flipped a wire's sign).
- **Shared controls:** one control run per seed, shared by every shock on that
  seed.
- **Output:** `SHOCK_TESTS.md`. One section per shock with:
  - its scorecard (below) and the measured response against it;
  - a verdict: **RIGHT**, **WRONG SIZE**, **WRONG TIMING**, **BACKWARDS**, or
    **DID NOT LAND**;
  - one chart: control vs shocked for the target class's vacancy, effective
    rent, value, starts and the knock-ons.

  End with a ranked list of findings, each naming the mechanism to trace.

### Step 0, before any result is believed: does each shock land?

`econaudit.mjs` was last touched 2026-10-12, **before** the agent economy
(ONE_ECONOMY_PLAN §6c, #535-#557):
- construction starts are named builders' decisions (#547);
- jobs and space demand are sums of named firms (ledger #10);
- wages are firms' posted pay;
- households are a register.

An injector written against the old aggregates may now write a number that
the next month recomputes from agents, so the "shock" vanishes silently. A
test that cannot fail is a fake (CLAUDE.md). So, for every experiment:

1. **Pre-injection identity:** hash `g.econ` in both twins the month before
   injection. They must be equal.
2. **Landing check:** the month after injection, the target quantity must
   have moved by the intended amount in the shocked twin only. For example,
   office stock summed over parcels must be ×1.5, not just `econ.stock.office`.
   If not: **DID NOT LAND**. Fix the injector, not the economy.
3. **Hold check, for sustained shocks** (rates, costs, remote work): the shock
   must still be in force 5 years later.

Known suspects to check first:
- `E.addStock(g.econ, …)` in experiment 3: is `econ.stock` still a stored
  total, or is it summed from buildings now?
- Experiments 1/2 move jobs. They should now add or remove a NAMED FIRM
  (with its heads, orders and lease), not edit `econ.jobs`.
- Experiment 4 writes `nat.policy` and `indexRate`. Confirm the Taylor rule
  does not overwrite them the next month.

### Injecting through agents, not aggregates

Shocks enter the world the way they would in life: buildings appear or
vanish on real lots; firms arrive or leave with their staff and leases;
households arrive; the national rate, the cost of materials, or the insurance
market moves. Never a direct edit of a rent, a vacancy, a cap rate or a land
value. Those are the RESPONSES under test.

## The scorecards

Each row: what is injected · what should move, which way, about how much,
how fast · the source · the failure signatures. Sizes are ranges from the
record, not targets. A result outside them is a finding to trace, not a dial
to turn.

### 1. Supply shocks

**1a. +50% stock in one class, overnight.** Run once per class: office,
retail, apartments, industrial.
- **Injection:** new buildings of that class, at current vintage and standard
  quality, on vacant or teardown lots spread across the town in proportion to
  the class's existing stock. Unowned, at the street's opening rents (a
  lease-up). Occupied space is unchanged on the day.
- **Arithmetic on day one:** vacancy = 1 − occupied / (1.5 × stock). A class
  at 10% vacancy jumps to 40%.
- **Expect:**
  - **Effective rent falls within 1-2 years:** concessions first, asking
    rents later. Wheaton-Torto: real rent growth ≈ −2 to −3%/yr per point
    of vacancy over normal, so a 30-point glut means double-digit real
    declines. History: Houston office 1983-87 vacancy ~30%, effective rents
    roughly halved. Apartments adjust faster than offices (1-year leases
    against 5-10).
  - **Starts in that class fall to near zero** until vacancy is back near
    normal. Starts in other classes are roughly unchanged (control).
  - **Values fall more than rents:** buyers price in the lease-up; cap rates
    widen, deal volume falls.
  - **Recovery is set by demand growth:** years ≈ ln(1.5 ÷ occupancy ratio)
    ÷ demand growth rate. At 1.5%/yr job growth, about a decade. Industrial
    and apartments recover faster than office.
  - **Older, worse buildings lose tenants first** (flight to quality;
    experiment 3 already measures this).
  - **Land values in the class's districts fall** (lower residuals).
- **Failure signatures:**
  - rent never falls, or rises;
  - vacancy snaps back in under 2 years with no rent cut (a hidden anchor);
  - builders keep starting the class into the glut;
  - other classes' rents move with no channel (miswiring);
  - land rises.

**1b. −20% stock in one class** (fire, or a rezoning wipe-out). Per class.
- **Injection:** remove the buildings; their tenants must relocate or leave.
- **Expect:** vacancy falls, rents rise, then a construction wave 1-3 years
  later (Wheaton 1999: starts peak 1-3 years after the demand signal), with
  some overshoot. Land rises in the class's districts.
- **Failure signatures:** no construction response; rents do not rise; the
  displaced tenants vanish instead of relocating or leaving town.

### 2. Demand shocks

**2a. The largest employer leaves.**
- **Injection:** pick the firm with the most heads. It closes its local
  operation: its staff are laid off and its leases end or default by their
  terms.
- **Expect:**
  - office vacancy up by about its floor area;
  - some laid-off households leave town, so apartment vacancy rises over
    1-2 years;
  - shop sales and retail vacancy follow with a lag;
  - suppliers to that firm lose orders.

  A big plant closure typically costs a metro about 0.5-1.5 local jobs per
  direct job (Moretti 2010 multipliers run the other way for gains).
- **Failure signatures:** only office moves; nobody leaves town; the jobs are
  instantly re-created elsewhere with no slack.

**2b. +30% population over 2 years** (an arrivals wave).
- **Injection:** households land in the register, renting across the water
  and looking for work (the swan's own channel, `bsMigPull`, run larger).
- **Expect:**
  - apartment vacancy falls first and rents rise, roughly 5-15% real over
    2-3 years;
  - home prices follow;
  - apartment starts rise 1-3 years later;
  - unemployment rises briefly, then firms expand.
- **Failure signatures:** rents flat while vacancy collapses; no
  construction response; arrivals not housed anywhere.

**2c. Remote work: office space per worker −30%.**
- **Injection:** every firm's space need per head falls 30% for new leases
  and renewals. Existing leases run to term.
- **Expect:**
  - office vacancy rises GRADUALLY as leases expire (5-10 year rollover),
    not overnight;
  - effective rents and values fall; older offices hit hardest;
  - conversions or teardowns of offices to other uses pick up where they
    pencil.

  History: US office vacancy roughly 12% → 19-20% in 2020-2024, values
  down 30-40%.
- **Failure signatures:** vacancy jumps overnight (leases ignored); no
  conversions ever; rents unaffected.

**2d. E-commerce: 20% of shop spending moves online.**
- **Injection:** households' in-store share of retail categories falls 20%;
  the spending goes to out-of-town sellers.
- **Expect:** shop sales fall; marginal shops close; retail vacancy rises
  and stays up until shops convert; retail rents fall.
- **Failure signatures:** shops survive on unchanged sales; vacancy fully
  recovers with no conversions.

### 3. Capital-market shocks

**3a. Rates +300bp, held** (2022). Experiment 4 exists; re-verify it lands
and holds (step 0).
- **Expect:**
  - cap rates widen 100-200bp over 1-3 years, with only partial
    pass-through (Chervachidze-Wheaton 2013);
  - values fall 15-30% with NOI unchanged (2022-24: apartments about −20%,
    office −30% or more);
  - deal volume collapses first, because the bid-ask gap widens (MSCI RCA:
    2023 US volume about −50%);
  - refinancing failures cluster where balloons fall due;
  - starts fall after 1-2 years (the echo: fewer deliveries mean tighter
    markets 5-8 years later, which experiment 4 already reads).
- **Failure signatures:** caps move fully and instantly (no stickiness);
  values flat; volume unchanged; no refinancing distress.

**3b. Rates near zero for 10 years** (2010s).
- **Expect:** caps compress over years; land inflates; leverage rises;
  starts rise. Then, when rates normalise, the reverse, including distress
  for loans written at the top.
- **Failure signatures:** caps below what any lender's spread allows; no
  leverage build-up.

**3c. Credit crunch: lenders' maximum LTV halved for 3 years** (2008-10).
- **Injection:** every lender's max LTV and loan-sizing cut by half
  (product terms in `debt.ts`; lenders' own appetite in `lenders.ts`).
- **Expect:** transaction volume collapses; distressed and forced sales rise
  (balloons that cannot refinance); prices fall more than rents; equity-rich
  buyers pick up assets cheap.
- **Failure signatures:** volume unchanged; nobody forced to sell.

**3d. Foreign capital wave** (Japan 1987-91). `blackswans.ts`
`startCapitalWave` exists: run it at the high end (10% of the street's book).
- **Expect:** prices up with rents unchanged (caps compress); the trophy
  segment first; reversal when the money leaves, with losses for late buyers.
- **Failure signatures:** prices unmoved; rents move (miswiring).

### 4. Cost shocks

**4a. Construction cost +40%, held** (materials and contractors' bids;
`contractors.ts`, the materials input).
- **Expect:**
  - starts fall sharply;
  - rents on existing space drift up over years as supply stops answering
    demand;
  - land values FALL, because the residual is value minus cost;
  - existing buildings' values rise somewhat (replacement cost up).
- **Failure signatures:** land rises (a backwards wire, the worst kind);
  starts unaffected; rents unaffected even after 5+ years.

**4b. Insurance ×2 and energy ×2, held** (`inputs.ts`).
- **Expect:** owners' NOI falls by the uninsured, unrecovered share of the
  increase. This is a test of lease structure:
  - NNN tenants pay it, so their landlords barely notice;
  - gross leases and apartments leave the owner to eat it until the leases
    roll.

  Values fall with NOI; older buildings, which are less efficient, are hit
  harder.
- **Failure signatures:** NNN landlords lose as much as gross ones (the
  recovery wire is broken), or nobody loses.

**4c. Property tax rate ×2, held** (City Hall's rate; `citygov.ts`).
- **Expect:**
  - values fall by roughly the capitalised extra tax (extra tax ÷ cap rate),
    less what NNN leases pass through at today's rents;
  - some marginal owners sell or default;
  - over years, households and firms weigh the higher taxes (Tiebout,
    ledger #14), so a little out-migration follows.
- **Failure signatures:** values unmoved; NNN pass-through missing; the rate
  rail (`citygov.ts` PROP_LO/PROP_HI, which RAIL_AUDIT.md shows binding 85%
  of calls at the floor) clamps the injected rate back.

## Budget and order (Monday)

- **Count:** 8 supply (1a and 1b × 4 classes) + 4 demand + 4 capital + 3 cost
  = 19 shocks. With 3 seeds that is 57 shocked runs + 3 controls = 60 runs
  of 25 years (10 settling + 15 response).
- **Time:** about 2.6 min per simulated decade per run on this 4-core box, so
  about 6.5 min a run and about 6.5 CPU-hours: **about 2 hours wall-clock**
  with 4 workers (`AUDIT_JOBS=4`).
- **Order:**
  1. Step 0 (landing checks) on 1 seed for every shock, a few minutes each.
     Fix any injector that does not land.
  2. Supply (1a office first), then capital, cost, demand.
  3. Write SHOCK_TESTS.md as each group finishes, so a stopped session still
     leaves results.
- **Usage-light:** run in the background, poll rarely, and read results from
  the report, not the logs.

## What done looks like

- `pnpm audit --only=14,15,…` reproduces every row.
- `SHOCK_TESTS.md` has a verdict and chart per shock.
- A ranked list of WRONG / BACKWARDS / DID NOT LAND findings, each naming the
  mechanism to trace (file and function), ready to be worked one by one.
- No engine change in the same PR: the tests first, fixes after, each its own
  measured PR.
