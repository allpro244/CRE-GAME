# A playtest: what feels real in this economy, and what does not

**No playtest in this repository is based on Manhattan. Every playtest, every harness run and every number quoted in any of these documents is on a GENERATED city.** The Manhattan pipeline exists (`pnpm pipeline:manhattan`) and is not what any of this was measured on.

**Harness:** `pnpm playtest` — 6 seeds × 40 years, one pass, ~6 minutes. Every
number below is printed by it, so it can be argued with rather than believed.
Cross-checks quoted from `pnpm rails`, `pnpm pencils`, `pnpm devyield`,
`pnpm vacdist` and `BASELINE.json`.

> **ALL SEVEN STEPS OF THE FIX PLAN HAVE SINCE BEEN EXECUTED.** Read
> `PLAYTEST_FIX_PLAN.md` §OUTCOME before acting on anything below — several of
> these findings are fixed, one was measured wrong here, and the thing that
> matters most now (real rents falling) is not in this document at all. Section
> A's instrument in particular could not answer its own question; the correction
> is recorded in the plan and in `test/playtest.mjs`.

**Follow-up:** `PLAYTEST_FIX_PLAN.md` carries the fix plan, and it revises the
diagnosis this report left open. §1.2's question — *which side of the occupancy
disagreement is wrong* — now has an answer with arithmetic behind it: most of
the gap is one bug, `buildRentRoll` filling a leg with whole suites and dropping
the last partial one, so realised occupancy is `floor(N·p)/N` and the bias is
worst in the smallest buildings. §4 of this report ordered the work with the ask
first; **the plan reverses that** — the occupancy identity comes first, because
several findings below are its consequences rather than separate faults.

**Method.** I played the game rather than testing a channel: buy income and
dirt off the tape at market, answer every letter, price a development on every
lot held, and then look at what the screen said against what the world did. The
existing harnesses each ask whether one wire is right. This one asks the
question a player asks, which is less forgiving — *I looked at the screen, I
made a decision, did the world behave the way the screen said it would.*

---

## The one-sentence answer

**The market model feels real and the buildings do not, because they are two
different models and the game prices on one and pays you from the other.**

There are two layers here:

| | what it is | how it reads |
|---|---|---|
| **Layer 1** | the aggregate market — `econ.cityVac`, `econ.capRate`, `econ.rentIdx`, `assetValue()`, `occupancy(rec, econ)` | **genuinely good.** Section 3 below. |
| **Layer 2** | the per-building rent roll — `genRentRoll()`, `h.tenants`, `occupancyRead()` | runs **16–31 points emptier** than Layer 1 says the market is |

**Prices are set on Layer 1. Income arrives from Layer 2.** Almost everything
that reads as fake sits on that seam, and everything that reads as real sits
comfortably inside Layer 1. That is the whole finding; the rest is evidence.

This is `CLAUDE.md` fake number 3 — one quantity with two answers — and it is
worth saying why it survived a codebase that hunts that fault specifically.
**It was found twice and fixed in one consumer each time.** `actions.ts
buyQuote` fixed the *lender*, and its comment records the measurement:
*"over 3,195 listings, that estimate ran 89% occupancy against a real roll of
69%, and the gap was WIDEST on the highest quoted yields."* `shared.tsx` fixed
the *desk display* (`goingIn` / `inPlace`). Nobody fixed the thing that sets
the **ask**, or the **Economy page**. So the player is now shown an honest
going-in yield on a price set by a model that cannot see the roll — and the
honest number is terrible.

---

## 1. What does not feel real

### 1.1 The tape does not price tenancy — the largest one

Bucket every ordinary listing by *its own* disclosed roll occupancy. Distress
excluded on purpose: a receiver's building is supposed to be cheap and broken,
and leaving it in would let the one honest discount in the game stand in for
the ordinary tape.

```
   this building's own roll      n      ask / appraisal       going-in cap the buyer gets
   occupancy                            p25   MED   p75        p25     MED     p75
   0-24% let                      88   0.95  0.99  1.06       -8.0    -5.1    -2.4
   25-49% let                    198   0.96  1.00  1.04       -3.0     0.2     2.8
   50-74% let                   1189   0.95  0.99  1.04        0.6     3.7     6.2
   75-89% let                   2020   0.95  1.00  1.05        3.6     5.7     8.1
   90-100% let                  2205   0.95  0.99  1.04        5.0     7.1     9.9
```

**A building that is one-tenth let asks 0.99× appraisal. A full one asks
0.99× appraisal.** The ask is flat to the fourth row of a market's most
important fact. The consequence is the right-hand column: the buyer's going-in
yield runs from **−5.1%** to **+7.1%** at the same price relative to appraisal,
because the emptiness is handed to the buyer at full price.

The mechanism is one line in `sim.ts refreshListings`:

```js
const v = rec ? assetValue(rec, s.econ, gradeOf(s, rec)) : 0;
```

Every ask is anchored to `assetValue`, floored at `0.70 × v` and withdrawn
under `0.85 × v` — and `assetValue` prices at *model* occupancy. The listing
never learns what is actually in the building.

In life a 15%-let office building does not trade at a stabilised comp. It
trades as a lease-up story, often near land value, and the buyer prices the
years and the capital it takes to fill. Here it is offered at ninety-nine
cents on the appraisal and quietly hands over a negative cap rate.

The share of the tape offered at a **negative going-in cap**, measured both
ways — and note the ordinary column, which is the one that should be near zero:

| class | ordinary listings, negative cap | p10 | whole tape incl. distress |
|---|---|---|---|
| office | 9% | +0.6% | 16% |
| retail | 14% | −1.8% | 20% |
| multifamily | **20%** | **−5.5%** | 27% |
| industrial | 27% (n=62, thin) | −2.2% | 32% |

One ordinary multifamily building in five is offered at a price where operating
it loses money from day one, and a tenth of them at −5.5% or worse. Distress
should produce a few of those and does; the rest are the ask not reading the
roll.

### 1.2 The Economy page and the buildings disagree by 16–31 points

Same city, same month, every standing building, no player selection:

```
   class          cityVac says occupied    the rolls say    GAP      no tenant at all    legs/seed
   office               90.6%             74.6%     16.0pp           11.2%          456
   retail               93.1%             64.7%     28.3pp           12.6%          360
   industrial           98.5%             67.8%     30.7pp           28.6%            7  <- thin
```

The player reads the first column to decide and lives in the second. And
**both numbers are already committed side by side in `BASELINE.json`** —
`vac.office 0.1035` (89.7% occupied) next to `roll.commercialOcc 0.6801` — a
22-point disagreement, recorded, tracked, never reconciled. Nothing is out of
balance and no band is breached, which is precisely the fault class the
BASELINE section of `CLAUDE.md` was written for.

Related: **11–13% of office and retail legs have no tenant at all.** Not
under-let — zero. That is the same shape as the 27%-unlettable-shopfronts
episode `CLAUDE.md` cites.

### 1.3 Nothing you own ever stabilises

What the player owns, held three years or more:

```
   class          n     physical occupancy p10/MED/p90      real stabilised
   office         976        0%    54%   100%              88-92%
   retail         384        0%    62%   100%              92-96%
   multifamily    377       78%    83%    93%              94-96%
   industrial     113        0%   100%   100%              96-98%
```

Median office 54%, retail 62%. And look at the p10/p90: **0% and 100%.** Your
buildings are not at an occupancy, they are in one of two states — empty or
full.

*(Root cause found after this was written — see `PLAYTEST_FIX_PLAN.md`. It is
not that the leasing engine empties buildings: traced individually, a 44k sf
office ran 27 letters over 20 years, signed 25, and finished at 87%. It is that
occupancy slopes with how many suites a leg demises into — 57% at two suites,
81% at twelve — which is whole-suite fill quantisation, and it hits small
buildings hardest.)* `pnpm vacdist` says the same thing about the city and says it plainly:
office sits within 2pp of natural only **14.0%** of the time, on the friction
floor **24.2%**, more than 10pp over **16.8%**. *"The vacancy series is two
states rather than a market."*

Multifamily is the exception and is close to right, which is informative: it is
the one class whose occupancy is a scalar (`h.occ`) rather than a tenant list.

### 1.4 The labour market has no cycle in it

```
   unemployment    p10 2.80%   MED 2.81%   p90 6.38%
   at the 2.8% frictional floor in 56.8% of all months
   MEDIAN in recession/depression 2.80%   vs in expansion/peak 2.80%
   unfilled positions (jobVac) MED 2.50%  p90 11.05% of the labour force
```

**Unemployment is identical in recessions and in booms.** It sits on its 2.8%
frictional floor in 57% of months, and a player watching a "recession" with 12%
office vacancy reads 2.8% unemployment on the same screen.

`pnpm rails` finds it independently from the other end: `market:1911`,
`e.jobs = clamp(wanted, 0, force * (1 - FRICTIONAL))`, **at its ceiling in
46.3% of calls.** The city cannot staff the jobs it wants in half its life, so
employment pins to the labour force and unemployment reads the floor by
construction.

The code argues this is a mechanism and not a rail because the excess survives
as `jobVac`, and that argument is sound as far as it goes — but `jobVac` then
runs at 2.5% of the labour force at the median and 11% at p90 **permanently**.
One job in ten unfilled for forty years is not a labour market that clears.

Per-seed, the shape is worse than the aggregate: seed 12007 spends 86% of
months on the floor with a recession *maximum* of 2.92%; seed 73303 never
touches the floor and sits at a 10.2% median for fifty years. Each city picks a
side of the labour balance at birth and stays there. Unemployment is a **level
here, and in life it is the cyclical number.**

### 1.5 Development, in a development game, does not happen

**Six 50-year playthroughs, zero buildings built.** That is not the bot being
timid:

- `pnpm pencils` at year 30: office is the best use on **0.0%** of lots and
  bids above zero on 7.8%, median bid **−$1,419/sf** of land. Retail 0.0% best
  use. Only industrial clears anywhere, and it takes 66.8% of the city.
- `pnpm breakeven` at the **median** lot: office needs $72.10/sf and gets
  $22.92 (**+215%**); retail needs $40.95 and gets $26.74; multifamily needs
  $50.04 and gets $26.86. Buildable share at the median lot: **0% for every
  class.**
- `pnpm playtest` §F, on lots the player actually holds: retail clears a +75bp
  hurdle in **0.0%** of months; office and multifamily 12.2%.

And the few that do clear deliver something else than what they promised.
`pnpm devyield` on the 45 multifamily sites that pencil out of 1,298:

```
  p50  pro forma: YoC 6.42% vs exit 5.74% -> value $27.8M on basis $24.9M (1.12x)
       +0y   0.74x basis      +3y   0.46x      +10y   0.88x      +20y   0.48x
  p75  pro forma 1.05x
       +0y   0.75x basis      +3y   0.48x      +10y   0.85x      +20y   0.36x
```

**The plan says 1.05–1.23× and the building delivers 0.36–0.81×, and twenty
years later it is still worth a third to a half of what it cost.** A pro forma
that is wrong by that much in that direction is fake number 3 again, in the
place where it costs the player the most.

`pnpm gate` corroborates from the city's side: acceptance band **L is the one
band outside its range on a clean tree** — delivered-over-demolished runs a
median 0.49 against a 0.60 floor. The city tears down about twice what it puts
up. It is reported and not gated, so it has been sitting there in the open.

`pnpm pencils` flags the contradiction itself: multifamily stock grows
**1.13%/yr** while the median multifamily bid for dirt is **−$438/sf**. The
city builds what no developer in it could underwrite — city supply and the
desk are still two different models, exactly as §1.1 and §1.2 are.

### 1.6 Smaller things that read wrong

- **Industrial vacancy lives on its floor.** `rail.vac.industrial.lo = 0.7267`
  in the committed baseline — 73% of months. `pnpm vacdist` agrees: median
  1.5% against a 7.0% natural rate, on the friction floor 73.3% of the time,
  near natural 5.7%. `HANDOFF.md` open fault #1 is marked **CLOSED** and the
  repo's own baseline says otherwise; that entry needs re-measuring or
  re-opening.
- **Retail never has a bad decade.** Median citywide retail vacancy 3.0% across
  a 50-year run, minimum 2.7%, and it is above 5% only in the opening years.
- **The top of the land market is noise.** Land p90 across one seed:
  $287 → $3,122 → $550 → $3,363 → $7,978/sf at years 10/20/25/40/50, with a max
  of $20,705 at year 30 falling to $3,082 by year 35. The median is smooth
  ($155 → $253); it is the tail that is unstable.
- **Real rent growth is mildly negative at the median** across 6 seeds × 40y:
  office −0.64%/yr, retail −1.60%/yr, multifamily −0.36%/yr, industrial
  +0.98%/yr. Office is defensible. Retail at −1.6%/yr real for forty years is a
  47% real decline in a city whose population grows 1.1%/yr — possibly right
  for the e-commerce era, but nothing in the model is claiming that story.

---

## 2. What this costs the player, in one line

You buy a building at ninety-nine cents on an appraisal that thinks it is 90%
let, receive one that is 54% let, watch the Economy page report a 91%-occupied
market you cannot find, and discover that the only cure — building something
new — does not pencil anywhere in the city. **The difficulty is real and the
reasons are not**, which is the exact failure mode `CLAUDE.md` warns about:
this is hard the way a broken instrument is hard, not the way the business is
hard.

---

## 3. What already feels real — and it is a lot

None of the above touches these, and they are the harder half to get right.

**The cap rate stack is ordered the way the real one is**, and sits where it
should against the policy rate:

```
     office              268bp      real: 150-350bp over the 10y
     retail              236bp
     multifamily         102bp      MF and industrial tightest, as in life
     industrial          104bp
```

**The concession channel opens and closes on cue.** Effective/face rent runs
0.99–1.00 in a tight market and **0.86–0.88** once vacancy is 5pp over natural
— a 12–14% giveaway in a glut, which is the right magnitude and the right
shape. `GLUT_FINDINGS` measures the dynamics too: net effective falls 3–4× as
far as face in the first six months, ~2× at a year. That is documented reality,
and it is in here.

**The cycle has the right proportions.** Expansion 48%, recovery 22%,
recession 17%, peak 12%, depression 2% — 70% of months growing, against ~70%
for the post-war US. Phases arrive at irregular lengths and the policy rate
runs 2.0–8.3% with a 5.7% mean across a campaign, which is a plausible half
century of monetary history rather than a sine wave.

**Inflation and nominal rent growth are honestly calibrated.** CPI 2.8–3.0%/yr,
office rents compounding 2.3–2.9% nominal. The `inflation` fix that got there
is the model working the way `CLAUDE.md` asks: the fault was labour demand
unconstrained by labour supply, and it was fixed upstream rather than by
trimming a rent coefficient.

**The money is real.** `pnpm conserve` reconciles 1,261 months across 7 seeds
with every ledger category exercised and not one unexplained dollar. The
identity asserts its own coverage. That is rarer than it sounds and it is why
every number above can be trusted to be about the economy rather than about a
leak.

**The lender behaves like a lender.** It advances against the lesser of
appraisal and price, underwrites the in-place roll rather than the class
model's opinion, and refuses a tired building on a life-company product. Every
dollar of an overpayment is funded with equity. That is the single most
important rule in acquisition underwriting and it is modelled correctly.

**Drawdowns are real.** 26–77% peak-to-trough across seeds for a levered
operator, and 8–19 competing firms fail per campaign. Leverage in a cyclical
asset class should do that.

---

## 4. What I would fix, in order

Ranked by how much of the fake each one removes, not by effort.

1. **Make the ask read the roll.** `refreshListings` anchors to
   `assetValue(rec, econ, grade)`; it should anchor to the value of the income
   the deed actually conveys — the disclosure is already written on every
   listing by `stampListing`, and `inPlace`/`asIfOwned` already put it in the
   right shape. This is the smallest change with the largest effect: it fixes
   §1.1 outright and makes a lease-up buy a *decision* — cheap building, real
   work — instead of a tax on not reading the fine print.

2. **Reconcile `cityVac` with the rolls, and say which one is the market.**
   Two numbers 16–31 points apart, both in the baseline. Either the aggregate
   is the market and the rolls are generating too little tenancy, or the rolls
   are the market and the Economy page is reporting a city that does not exist.
   Both are fixable; shipping both is not. My read is that the rolls are closer
   to being wrong — 11–13% of legs with *zero* tenants points at `genRentRoll`
   /`toSuites` demising space nobody can take rather than at the market model —
   but that is a hypothesis, and §1.2's measurement is the thing to attack.

3. **Then re-measure development.** Do not touch the residual first. Office
   needing $72/sf against a $23/sf market is a 3× gap that no coefficient
   should be asked to close, and if §1.2 resolves toward fuller buildings then
   achievable income rises and the residual moves on its own. Re-run
   `pnpm pencils` and `pnpm breakeven` after, and only then ask whether
   development still does not pencil. **The `devyield` divergence is a separate
   bug and worth fixing regardless** — a pro forma that says 1.12× and delivers
   0.48× is wrong about something specific and findable.

4. **Give the labour market a cycle.** The frictional floor is defensible; a
   city permanently against it is not. The speed mismatch the code documents —
   jobs move at 1.88%/yr median against population at 0.89% — is real and the
   answer is probably in how fast labour demand may run ahead of supply, not in
   the floor. Watch `market:1911`'s 46.3% ceiling rate as the measure of done.

5. **Re-open or re-measure `HANDOFF.md` open fault #1.** Industrial vacancy on
   its floor 73% of months is in the committed baseline against an entry marked
   CLOSED. Whichever way it resolves, the document should stop disagreeing with
   `BASELINE.json`.

---

## 5. What this playtest could not see

- **Feel and pacing.** Whether any of this is *fun* — whether a delivery is a
  climax, whether a rival's death lands. No harness can answer that.
- **The UI.** I played through the engine. Everything above is about what the
  model does, not about whether the desks show it clearly. A player might well
  meet §1.1 as "why is this building so cheap per foot" and never see the cap.
- **Long saves.** 40–50 years. The owner plays 60–100, where a −1.6%/yr real
  retail drift compounds into something much louder than it looks here.
- **Whether the rolls or the aggregate is the correct market.** §1.2 states the
  disagreement and its size. It does not settle which side is wrong, and it
  should not be read as though it did.
