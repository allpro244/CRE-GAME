# MDGA — Make Development Great Again

**Goal.** A player who only develops — buys dirt, builds, holds or sells, never
buys a standing building — has a real game for fifty years: sites to find, a
reason to act in every phase of the cycle, risks that can be managed with
tools real developers use, and outcomes spread by skill rather than by seed
luck. **Realism is the constraint, not the casualty.** Every change below is a
mechanism that exists in real development markets; none is a subsidy, a
margin bump or a thumb on a coefficient (CLAUDE.md: no fake numbers;
difficulty is an output).

Written 2026-10-07 from a developer-only playthrough and the measurements in
§1. The instruments that produced them are committed in `tools/mdga/` so every
phase is judged on the same yardstick.

---

## 1. What was measured

All runs: the standard test city (`loadCity(0)`, a young town, ~1,300 lots of
which ~440 vacant), 50 years. Developer runs use `test/playdev.mjs` with
`GRANT=2500000` (a $5M start), which buys only vacant land.

### The playthrough (12 runs, 6 seeds × merchant / hold)

| seed | merchant | hold | built |
|---|---|---|---|
| 1 | $21.8M | $21.8M | 1 |
| 2 | $85.6M | $112.7M | 4 |
| 3 | $28.9M | $28.9M | 1 |
| 4 | **bankrupt yr 13** | **bankrupt** | 1 |
| 5 | $59.3M | $59.3M | 3 |
| 6 | $14.4M | $55.9M | 2 / 11 |
| **median** | **$28.9M** | **$55.9M** | |

Most runs build once or twice in fifty years and sit in cash for decades
(seed 1: idle years 1-9 and 36-50 with $20M in hand). Outcome is decided by
whether a ripe site happens to be listed early, not by play.

### F1 — The city does not grow into its demand (`tools/mdga/growth.mjs`)

| | yr 0 | yr 50 | change |
|---|---|---|---|
| jobs | 22,553 | 36,449 | **+62%** |
| population | 41,017 | 68,139 | **+66%** |
| floor area | 9.37M sf | 11.50M sf | **+23%** |
| buildings | 865 | 875 | +10 |
| vacant lots | 441 | 431 | −10 |

Vacancy prints **office 5.4%, retail 3.5%, industrial 2.5% for forty years**.
Those are not the frictional floors (3.7 / 2.7 / 1.5%) — they are the
between-tenants share (`betweenTenantsSf`) once `occupied` is clamped to
`housable − inTransit` (`market.ts` absorb). Demand exceeds capacity for
decades; for office the excess bleeds `employIdx` (firms leave) instead of
calling for floor. The city's start budget (`stock × 0.0016 × appetite ×
catchUp`, `market.ts`) is spent only on lots that pencil and decays at 1/18 a
month when nothing does.

### F2 — Building pays where people want to be, and almost nowhere else (`tools/mdga/feasibility.mjs`)

Finished value ÷ build cost (land excluded), best scheme per lot:

| | demand < 40 (~85% of vacant) | demand ≥ 40 (~15%) |
|---|---|---|
| yr 0 | 0.37 | 0.88 |
| yr 10 | 0.58 | 1.07 |
| yr 20 | 0.48 | 1.40 |
| yr 30 | 0.39 | 1.80 |
| yr 50 | 0.43 | **2.47** |

The core is a goldmine that is running out of dirt (26 → 16 vacant
high-demand lots in the sample). The outskirts, where most vacant land is,
**never** pay in fifty years even as the population grows two-thirds. Rents
outran costs overall (office rent index 33.8 → 140.6 against cost index
1.00 → 3.24), but none of it reached the edge.

### F3 — The land tape almost never offers the land that pays (`tools/mdga/landtape.mjs`)

- 0-5 vacant lots listed at any time; the tape is 0.4-1.3% of all lots
  (`targetListings`), picked **uniformly at random** across every parcel — so
  ~85% of the vacant land offered is the outskirts dirt of F2.
- The tape is thinnest in a **recession** (0.4%), exactly when distress asks
  (0.72-0.90× value, the developer's built-in edge) appear. Forced sellers
  list more in a downturn in life, not less.
- `dev.affordableLotShare` (BASELINE) is **0.023**, down from 0.13-0.15 in late
  September. Drops landed with `24e2736` (young town empty on its outskirts,
  0.10 → 0.038) and `b256ab6` (simulated opening, 0.052 → 0.023). `readLand`
  records that 0.016 "starved the city" once before.

### F4 — At the ask, a developer earns the margin and no more — by design

`readLand` prices a lot that pencils at the builder residual, so a scheme at
the ask clears hurdle ≈ 1.0. Hurdle 1.0 already **includes** the 17%
`DEV_MARGIN` on value, so building at the ask is profitable — this is correct
and stays. The playability problem is upstream (F2, F3): the player rarely
gets to the table with a lot that pencils.

### F5 — Off-market and owners

`approachOwner` works on land, but asks run 1.06-1.78× appraisal unless the
owner is stressed, so an approach almost never pencils. There is no way to
control a site cheaply while you entitle it.

### F6 — Delivered buildings meet or beat their plans (`tools/mdga/plan-vs-delivered.mjs`)

Twenty-four schemes on the best vacant lots, cash unconstrained, auto-lease on:
multifamily is worth 0.84-1.87× plan value 36 months after delivery (most
1.0-1.3×); office leases to 82-99% and is worth 1.2-1.5× plan. **The pro forma
is not systematically optimistic.** (Without anyone signing letters, office
sat at 0-21% for three years — a developer who does not lease does not get
paid, which is right.)

### F7 — Seed 4's bankruptcy was debt structure, not the plan

A 17,500 sf fringe apartment block, $5.6M all-in, started in a recession.
On delivery the construction loan rolls into the **floating** mini-perm at
index + 2.1% (`dev.ts` takeout) — 10.2% rising to 15% as the index climbed —
against ~$0.2M of NOI. Value ($2.2-3.3M) never reached the $3.9M loan, so it
could never refinance, and carry drained the firm. Rate caps exist
(`debt.ts rateCapCost`) but nothing prompts a developer to buy one, and the
construction close does not require one. (Open item: this building's
stabilised NOI ran ~half the plan's; F6 says that is not general — check
small fringe multifamily specifically, §4 Phase 0.)

### F8 — The bot under-plays the system

`playdev.mjs` screens only listed land, never approaches owners, never seeks a
variance or assembles lots, caps schemes at 14 floors, never buys a rate cap,
and keeps 35% of its opening cash idle. Results above are a floor on what a
developer can do — but they are what a new player experiences too, because
the game does not point at the alternatives.

---

## 2. Root causes, in order of weight

1. **Supply does not answer a shortage** (F1). Unhoused demand leaves town
   (employment bleed) instead of pricing space up until building pays at the
   margin. A real market under a forty-year shortage builds outward and
   upward; this one holds vacancy on a clamp.
2. **Location value never spreads** (F2). A full core should lift rents at
   every distance (the bid-rent curve shifts out as a city grows). Here the
   edge is frozen at 0.4× cost for fifty years.
3. **The land tape is random, thin and pro-cyclical in the wrong direction**
   (F3). Ripe land is not what comes to market; distress dries up the tape.
4. **No way to control a site cheaply** (F5): no option, no
   entitlement-contingent contract.
5. **Takeout risk is unhedged by default** (F7): floating mini-perm with no cap
   requirement and no fixed-rate takeout at delivery.
6. **The game does not show a developer where to look** (F8): no screen of lots
   that pencil, no signal of the shortage.

---

## 3. Principles and guardrails

- **Mechanisms, not multipliers.** Each phase adds a behaviour real markets
  have. No change to `DEV_MARGIN`, hurdle definitions, construction cost
  calibration or cap rates to make numbers look better.
- **Measure before and after with the same instruments** (`tools/mdga/*`,
  `playdev`, BASELINE). Say in the commit which numbers moved and why.
- **Money moves through the ledger.** `pnpm conserve` / `pnpm gate` after
  every phase that touches cash (options, caps, fees).
- **The city and the player face the same market.** Anything that lets the
  player build more must let the city's own builders respond to the same
  signal, or it is a player subsidy.
- **Keep the lettered reports as reports.** Bands move; note them, do not
  re-promote tests (CLAUDE.md).

---

## 4. The plan

### Phase 0 — Instruments (first, small)

- Promote the four `tools/mdga/*` probes to `pnpm mdga` (report tier, does
  not block) with a one-screen summary.
- BASELINE additions (cheap, can move, not clock-bound):
  `dev.highDemandVacantShare` (vacant lots with value/cost > 1 + margin),
  `city.floorGrowth` vs `city.jobGrowth` over the run, and a new rail
  `rail.occ.housableCap.<class>` — the share of months `occupied` sits on
  `housable − inTransit` (F1's hidden clamp; the existing `rail.vac.*.lo`
  cannot see it).
- Close F7's open item: run `plan-vs-delivered` restricted to small (< 25k sf)
  low-demand multifamily and confirm whether stabilised NOI matches the plan.
  If not, that is a one-quantity-two-answers bug and is fixed here before
  anything else.
- Upgrade `playdev.mjs` to use the levers that already exist (approach owners
  on ripe land, variances, assemblage, rate cap at takeout, no 14-floor cap)
  so measurements reflect the system, not the bot.

**Done when:** `pnpm mdga` prints the F1-F3 tables; the baseline carries the
new metrics; the F7 open item is answered.

### Phase 1 — A shortage prices space until it is built (root cause 1)

**Mechanism.** When looking demand exceeds housable stock, rents move on the
*unhoused* demand (`pool − housable`), not only on the vacancy gap, which is
pinned and therefore constant. The employment bleed stays — some firms do
leave a tight city — but at the rate the rent has made them, not as the sole
valve. Higher rents raise every residual, the margin lots start to pencil, and
the city's start budget finds sites.

**Realism anchor.** Tight markets show real rent growth well above inflation
until supply responds (San Francisco, Austin, Manhattan office 1997-2000); a
market with 5% office vacancy for forty years and flat real rents does not
exist.

**Change.** `market.ts` rent formation reads a capped unmet-demand term; the
`employIdx` bleed reads the rent level instead of the raw excess. No new
coefficient without a stated calibration (target: real rent growth while
pinned of the order of 2-5%/yr, measured against the vacancy-rent elasticity
the engine already uses).

**Acceptance.** `rail.occ.housableCap` falls from "most months" to episodes;
floor growth tracks job growth within a band over 50 years; vacancy leaves its
pinned values; `dev.affordableLotShare` rises; conserve and gate pass.

### Phase 2 — Growth spreads outward (root cause 2)

**Mechanism.** Location value has two parts: the parcel's own accessibility
(`demandScore`, fixed) and a citywide scarcity premium that rises as the
core fills. Add the second: as housable capacity in high-demand blocks binds,
a share of the unmet requirement looks next door and one ring out, lifting
`blockD` along the edge of the built area (the bid-rent curve shifting out).
Deliveries already lift nearby demand; this lets a *shortage* do it too.

**Realism anchor.** Monocentric city growth (Alonso-Muth-Mills): population
growth raises rents at every distance and moves the urban edge out. Real
outskirts get built when the middle is full, not never.

**Acceptance.** In a growing run, low-demand lots' value/cost rises over the
decades (F2 left column moves off 0.4); in a shrinking run it does not. Vacant
lots fall over fifty years in a growing town. Fringe land prices rise with it
(the player cannot buy cheap fringe and wait for free: the holder bid prices
the expected spread — realistic land speculation).

### Phase 3 — A land tape a developer can work (root cause 3)

**Mechanisms.**
1. **Land comes to market when it is ripe.** Owners of vacant lots where the
   builder residual beats the holder's option sell to builders; weight the
   tape's draw for vacant land by `builder / max(holder, floor)` instead of
   uniform. (Today uniform sampling mostly lists dirt nobody can use.)
2. **Distress lists more in a downturn, not less.** Receiver and estate land
   sales draw from their own budget that rises in recession/depression, on
   top of the thinned voluntary tape.
3. **Approaches price off the residual for ripe land.** An owner of a lot that
   pencils knows a builder can pay the residual; the approach ask should
   centre near it, not 1.06-1.78× appraisal floors built for standing
   buildings.

**Realism anchor.** Land trades when its highest and best use changes (the
"ripening" of land); distressed land inventory peaks in and after recessions
(2009-2012 lot sales by banks and receivers).

**Acceptance.** Ripe vacant listings per year in a 50-year run rise from ~0-2
to a measured, cycle-shaped number; distress land listings peak in
recessions; the developer bot's "years with no buildable site in reach" falls.

### Phase 4 — Control a site before you buy it — DROPPED

Land options were dropped at the owner's call (2026-10-07). Root cause 4
stands; the ripe-land tape and the residual-centred approach asks (phase 3)
cover part of it.

### Phase 5 — Takeout risk you can manage (root cause 5)

1. **A rate cap at construction close**, priced by the existing
   `rateCapCost`, offered on the build desk and required by the construction
   lender above a leverage threshold (real lenders require a cap on floating
   construction debt). It carries into the mini-perm.
2. **Forward takeout:** at groundbreak, optionally lock a fixed-rate permanent
   loan for delivery (fee + rate premium; void if the building does not hit
   its occupancy test) — real forward commitments.
3. **The desk says so:** show the mini-perm rate at today's index, the DSCR at
   that rate and at +300 bp, and the value-to-loan at delivery, before Break
   ground.

**Acceptance.** Re-run seed 4 with the cap: the firm survives or fails for a
reason the desk showed. Developer-run bankruptcies come from choices the desk
flagged, not from invisible floating risk.

### Phase 6 — Show a developer where to look (root cause 6)

- **A "Pencils" map lens**: per vacant lot, best-scheme hurdle at today's
  price (green ≥ 1, amber 0.9-1, grey below), from numbers the engine already
  computes (`landRead`, `planDevelopment`).
- **A site finder on the Develop / Market desk**: listed and approachable lots
  ranked by hurdle at ask, with the equity cheque and the reason each top
  failure fails (demand, envelope, cost, price).
- **Shortage signal on Economy**: unhoused demand by class, so the player
  sees why rents are rising and where the next cranes should go.

**Acceptance.** A new player can find a buildable site in under a minute of
looking, in any phase where one exists.

### Phase 7 — Verify and write it down

- `playdev` at $5M, 6 seeds × merchant/hold, 50 years: median, spread,
  failures, sites built, idle years. Target shape (not a tuned number): sites
  available in most years, median several projects, failures caused by
  choices, and a hold strategy that is a genuine alternative to merchant.
- Century runs (`pnpm test` tier) for the city: stock tracks demand, no rail
  rests, land prices stay in their realistic bands (ECONOMY.md).
- ECONOMY.md section on development supply, with the measurements before and
  after each phase; BASELINE regenerated with the moves attributed.

---

## 5. Order and size

| phase | touches | size | depends on |
|---|---|---|---|
| 0 instruments + F7 check + bot levers | tools, test, BASELINE | S | — |
| 1 shortage prices space | market.ts | M (calibration) | 0 |
| 2 growth spreads outward | market.ts / demand | M | 1 |
| 3 land tape | sim.ts refreshListings, actions.ts approach | S-M | 0 |
| ~~4 land options~~ | dropped | — | — |
| 5 rate cap / forward takeout / desk disclosure | dev.ts, debt.ts, DevelopDesk | S-M | 0 |
| 6 lens + site finder + shortage signal | UI | S-M | 0 |
| 7 verify + docs | — | S | all |

Phases 3, 5 and 6 are independent of the economy recalibration and can ship
first for an immediate playability gain; 1 and 2 are the realism core and
need the most measurement.

## 6. Already done in this session

- Build desk now asks what the engine asks before offering Break ground
  (`devFundingNeed`): the change-order cushion is shown, and all-cash jobs are
  no longer refused after a live button.
- Credit line counts as money for packages and the buttons that lagged.
- Long thin blocks are cut into ordinary lots (citygen strip fix), so the
  land a developer buys is the land they see.
- Auto-lease lets a developer's delivered buildings lease by stance without a
  letter a month.

## 7. What shipped and what it did (2026-10-08)

Phases 0, 1, 2, 3, 5, 6 and 7 shipped; Phase 4 was dropped.

| Phase | What changed | Where |
|---|---|---|
| 0 | `tools/mdga/` instruments (`pnpm mdga`, `pnpm mdga:delivered`); bot approaches owners, works a floor ladder, caps floating debt | `tools/mdga/`, `test/playdev.mjs` |
| 0 | National cycle draws from its own RNG channel (`"nation"`), so local events no longer re-roll the macro path | `market.ts` |
| 1 | Holder capitulation: a lot priced at the texture floor above what any builder can pay marks down 6% of the gap a quarter (floor 0.25×) | `comps.ts` |
| 2 | Construction type by height: wood walk-up (≤3 fl) 0.68×, podium (≤7 fl) 0.83× of tower hard cost (RSMeans) in the proforma, replacement cost and site pencils | `value.ts`, `proforma.ts`, `dev.ts` |
| 2 | Unhoused demand spills to neighbouring blocks when the city cannot house it | `demand.ts` |
| 3 | Ripe land lists (owners sell into a builder bid near value) and distressed land lists counter-cyclically at 0.72–0.90×; ripe-lot owners quote nearer value | `sim.ts`, `actions.ts` |
| 5 | Takeout hedge at construction close: float / rate cap (strike index+1.5) / forward lock (+75bp, 1% fee); hedge required above 60% LTC; desk shows mini-perm DSCR today and +300bp | `dev.ts`, `DevelopDesk.tsx` |
| 6 | Sites map lens, Site finder on the market page, Unhoused demand row on the economy page | `MapView.tsx`, `SiteFinder.tsx`, `EconomyPage.tsx` |

### Developer-only playthrough, before and after

Same harness (`test/playdev.mjs`, $5M start, 50 years, 6 seeds, develop /
hold / sell only). "Before" is the pre-MDGA run in §1; "after" includes the
Phase 0 bot levers, so part of the gain is a better-played bot, not a
different game.

| | Before merchant | After merchant | Before hold | After hold |
|---|---|---|---|---|
| Median net worth | $28.9M | $277.5M | $55.9M | $219.4M |
| Worst / best | −$0.7M / $85.6M | $56.1M / $619.9M | −$0.7M / $112.7M | $25.7M / $869.6M |
| Failed | 1 | 0 | 1 | 0 |
| Buildings delivered (6 runs) | 12 | 260 | 20 | 262 |
| Lot-months that pencilled and fit the purse | 18 | 456 | 29 | 420 |
| Median rank on the street | 7 | 3 | 6 | 4 |

The $277M median is about 8.4% a year compounded over 50 years on $5M with
leverage and drawdowns of 41–82% along the way: a good developer's career,
not a money printer. Starts still clear the hurdle by a little (median
hurdle about 1.02, best seen 1.27): the margin is earned, not given.

### What did not get fixed

- **City supply is still order-book limited.** Floor area grows +28% over
  50 years against jobs +85%; residential vacancy sits on its cap
  (`rail.occ.*.cap` in BASELINE counts those months). This is
  REALISM_AUDIT #1, the shortage-queue regime: the city's own construction
  pipeline (`startOwed`, `crewCapacity`) does not scale with demand.
  Spillover and capitulation widened where building pays but did not lift
  the city's build rate. That is the next piece of work.
- Spillover measured small on its own; the bigger fringe move came from
  pricing low-rise as low-rise.
