# HANDOFF

State of `claude/phase-1-implementation-v4c2az` at commit `8480967`. Written to
be picked up cold, by a person or a model with none of the conversation behind
it.

**Read `CLAUDE.md` first.** It is the standard everything here is measured
against, it is short, and most of the items below exist only because it was
applied. This file is the practical companion: what is where, what will bite
you, and what I would do next.

One rule that governs this document as much as the code: **re-measure before
you believe anything written here, including this sentence.** The previous
version of this file asserted two things that were false at the time it was
written, both because they described a measurement nobody had re-run.

---

## 1. RUNNING IT

```bash
cd broadway-and-wall          # the game is HERE, not at the repo root
pnpm install
pnpm dev                      # vite, localhost:5173
pnpm package:onefile          # dist/broadway-and-wall.html — self-contained, opens from file://
```

Node 22, pnpm 10. Point your editor at `broadway-and-wall/` — that is the
entire game. Do not look for or restore any other product tree in this repo.

The city is **generated at runtime** (`src/citygen/`) from a seed — there is no
data pipeline to run for normal development. `pipeline/` is audit material and
its outputs are gitignored.

---

## 2. THE SHAPE OF THE CODE

```
src/engine/     pure functions over JSON state. No DOM, no store.
                advanceMonth(g, parcels, bbls, adjacency) is the monthly tick
                (advanceQuarter is a deprecated alias — the name always lied).
src/citygen/    generates the town from a seed. Deterministic.
src/state/      zustand store. The only mutable thing in the app.
src/ui/         RightPanel.tsx is a thin GamePanels shell (~180 lines). Pages live
                under src/ui/panels/ (ParcelDesk shell + AcquireDesk / RefiDesk /
                DevelopDesk for property desks; DebtPage, EconomyPage, etc.).
                TopBar.tsx has the tab bar. StaffPage/StartMenu/Chart/Slider are separate.
test/           harnesses. Each is a standalone node script behind a pnpm script.
tools/          baseline, rails, audits, stress.
```

**The engine is pure and must stay pure.** Functions take state and return
state; nothing in `src/engine` may touch the DOM, the store, or `Date.now()`.
A reader that mutates the state it was handed is a bug even when it works —
see §4, the register memo.

Key files by weight: `market.ts` (3.1k lines — the economy, the cycle, the
national block, the labour market), `dev.ts` (development and the capital
programme), `rivals.ts` (competing firms), `value.ts` (every valuation and rent
function), `leasing.ts`, `debt.ts`, `actions.ts` (buy/sell/approach).

Recent additions worth knowing about:
- `facility.ts` — the portfolio loan (cross-collateralised, one loan many deeds).
- `owners.ts` — the register of named private holders.
- `notes.ts`, `auction.ts`, `workout.ts` — distress machinery.

---

## 3. THE HARNESSES, IN COST ORDER

| command | cost | catches |
|---|---|---|
| `pnpm check` | ~20s | a moved standing number, a broken ledger, a stale bundle |
| `pnpm gate` | ~3 min | a violated identity, a broken city invariant. **Must pass before committing anything that moves money.** |
| `pnpm baseline:check` | ~50s | a standing number that moved without anybody noticing |
| `pnpm report` | 10–30 min | the lettered tests A–M. Report, not gate — the owner's explicit call, twice. Do not re-promote them. |
| `pnpm playtest` | ~6 min | the economy from the player's chair: what an empty building costs, whether the ask reads the roll, whether anything stabilises, whether the labour market has a cycle |
| `pnpm inflation` | ~2 min | the price level and real rent growth against observed bands. **Two of its bands fail today and did before the Aug-2026 work — see PLAYTEST_FIX_PLAN §"what is left".** |
| `pnpm facility` | ~2 min | the portfolio loan, both sides — it must work AND it must bite |
| `pnpm covenant` | ~2 min | a rich sponsor must never lose a building; a thin one still must |
| `pnpm legmatch` | ~10s | per-leg vs blended rent — one quantity, two answers |
| `pnpm advance` | ~15s | the sheet moves: standards, class, condition, your file, the fund's own margin. In `pnpm check`. |
| `pnpm ltvdist` | ~10 min | what advance the market actually offers, every desk on every live listing, cut every way. Report, not gate. |
| `pnpm shortage` | ~2 min | shortage-side mirror of `glut`/`vacdist`: growing vs declining seeds, jobs-shock overshoot. Report, not gate. |
| `pnpm test` | ~22 min | states the engine should never reach |

`pnpm engine` rebuilds `test/.engine.mjs`. **Do it before every probe.**

---

## 4. THE TRAPS. THIS IS THE SECTION THAT SAVES YOU DAYS

**The stale bundle.** `test/.engine.mjs` is gitignored and built by hand. A
container restart once left one nineteen hours stale; the obvious control —
stash, re-run, compare — CONFIRMED THE WRONG CONCLUSION because both runs
loaded the same stale bundle. `test/fresh.mjs` now refuses, but rebuild
explicitly anyway.

**The RNG stream re-roll. This is the big one.** Changing the NUMBER of `rng()`
calls anywhere re-rolls the entire century. Same code, different world. It
looks exactly like a catastrophic regression: I chased a "49% fall in the
office rent index and 72% fall in land" that was entirely a re-roll from a
commit that changed how a rival's opening debt was sized. Measured either side
over six seeds, individual moves ran +60% to −56% in both directions with a
26% difference in means. **Scale thresholds; never change the draw count** — and
if you must, re-roll before you diagnose. Rule of thumb: `rentIdx` and `land`
have a 3.4× spread ACROSS SEEDS, so a six-seed median cannot resolve anything
smaller than a factor of two.

**A PRIVATE STREAM THAT ONLY GUARDS `s.rng` IS NOT PRIVATE.** This one is new
and it is the same shape as the re-roll above, wearing a fix as a disguise.
`genRentRoll` swapped `s.rng` for a parcel-keyed hash and restored it in a
`finally`, and its comment claimed two invariants: the roll is deterministic per
building, and asking for one costs the shared world PRNG nothing. **Both were
false.** Every draw inside it goes through a NAMED channel — `rng(s, "leasing")`
— and a named draw reads and writes `s.streams[channel]`, never `s.rng`. So the
hash seeded a stream nothing used and the restore put back a stream nothing had
moved. Measured: two calls on the same building in the same month returned two
different rolls, and each call advanced `s.streams.leasing`, so a render path
that peeked at a building moved the world.

If you wrap anything in a private stream, snapshot **`s.streams` as a whole**,
not the channels you believe the callee uses. Enumerating them is right when
written and wrong two commits later. And when you read a comment asserting an
invariant, test the invariant — that is how this was found.

**The frozen world.** `advanceMonth` returns state UNCHANGED once `gameOver`
is set. Any probe running past ~year 30 without a player must resurrect:
`if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };` A measured "plateau"
in how many firms a city supports turned out to be the game being over.

**The conservation identity and debt principal.** `pnpm conserve` asserts
`Δcash == books + Δloc.balance + Δdeposits`, and `borrowed` is a books
inflow for cash-out refinance and facility draws. Voluntary paydowns book to
`debtSvc`. The conserve bot buys at half Harbor's advance and cash-out
refinances after the stepdown so `borrowed` is in REQUIRED, not a silent
exemption. Purchase still books equity only (`bought`) — the loan goes to
the seller at closing.

**One quantity, two answers.** The most productive bug class in this repo.
`managedRentPsfYr(rec, econ, h)` with no `use` returns the area-weighted BLEND
of every market in a building; with a `use` it returns that leg. Four places
asked the blended question and judged a one-leg answer against it, which is why
retail "signed 30% under market" for an unknown number of commits. `pnpm
legmatch` exists to catch the next one. Before adding a metric, ask what else
computes the same quantity.

**A test that cannot fail is itself a fake.** Three tests once measured
`g.comps.length`, which is capped, so they reported the cap. My own not-ready
invariant ran clean against the broken engine. Check that a metric can MOVE
before trusting that it did.

**And a harness whose subject is a bot has a second failure mode: the bot
stopping.** `conserve` spent an unknown number of commits reconciling a player
who owned nothing, printing "every dollar came from somewhere" the whole time.
It asserts its own coverage now.

**Measure on a constant cohort.** A trajectory sampled at fixed offsets before
each firm's death changes population at every offset. That artefact produced a
dramatic "AUM collapse" that was half composition.

**`test/entry.mjs` MODULES.** Harnesses import from a bundle built off this
list. A module missing from it is invisible to every probe, silently. `staff`
was missing once; `facility` and `owners` are in it now.

**The register memo is module-level on purpose.** `owners.register()` caches in
a module `Map`, not on `s`. The first cut cached to `s.holders`, which meant
`holderOf` — called from `sellerOf` and six render paths — mutated the state it
was handed. Keep readers pure.

**START_YEAR is 2000 (types.ts) and there are no stray copies of it.** There were
seventeen hardcoded `2000 + Math.floor(month/12)` in seven files while the
constant said 2024, so the game printed one year and aged its stock from
another. Grep before you add another.

---

## 5. WHAT SHIPPED RECENTLY (last ten commits)

- **The sheet moves — underwriting standards, class, condition, your file**
  (Sep 2026). The owner: "you always get to borrow the same LTV". Measured
  exact: `pnpm ltvdist` (new report, six seeds × 30 years, every desk on
  every live listing) had the best senior advance at 53-62% between the
  quartiles in EVERY cut — window open or shut, boom or bust, every class.
  Three causes: product `ltv` was a brochure constant; `advanceFactor` could
  only cut (credit index above 1 did nothing); and the debt fund was funded
  at index + 1.1 but earned a BANK's index + 1.9 on its book, so its margin
  factor sat on the floor forever (appetite median 0.31, flush) and the 80%
  desk wrote 53%. Now `underwritingStandards` (−1…+1 from `creditIdx` and
  `bankApp`) moves every desk's sheet inside its own band (`ADVANCE_BAND`,
  up less than down), `statedLtv` adds class (+5 MF, +2 industrial, −2
  retail), the engineer's report (−3 worn/obsolete) and your file (+4 max,
  `relAdvance`), `sizeRest` loosens DSCR/DY at the top only, and lenders
  carry `BOOK_SPREAD`/`NORMAL_NIM` per kind (banks numerically unchanged).
  `buyQuote.ltvCap` is the sheet TODAY and carries `sheetWhy`/`advanceWhy`;
  the acquisition card, refi desk and The Banks ("Sheet today" column,
  standards word) print it. After: best permanent desk p50 60% open → 42%
  shut; fund p50 0.97. `pnpm advance` gates it and is in `pnpm check`.
  BASELINE.json regenerated: the six-seed check read pop −6% / land −29%,
  a re-roll — twelve seeds on both engines give the same city distributions
  (pop +1.8%, land +2%, buildings equal); what moved one way is the street's
  own leverage (+5 pts) and failures (8.3 → 10.3 per 25 years), which is the
  mechanism. ECONOMY.md "You always got to borrow the same LTV".

- **A standing roll lets a suite, not the vacancy fraction** (Sep 2026).
  The rentable move exposed a gap in `buildRentRoll`: on a multi-plate leg
  the fill target is `legSf × targetOcc`, and when that target came in under
  the demise floor the "whole leg under the norm is the shop" branch wrote a
  tenancy the size of the TARGET — a 1,953 ft tenant on a 4,110 ft two-plate
  shop leg at a 47% target, under the 2,000 ft floor nothing else in the
  engine will let. `pnpm test` caught four of them across 8 seeds × 5 bots
  (`[tenancy] ... under the 1999 sf floor`). The branch now lets one suite
  (`min(legSf, floorSf)`) and the roll runs a shade over target rather than
  writing a closet. RNG draw order is unchanged, so this does not re-roll.
- **A ground lessee obeys the massing cap** — `groundLesseeBuildableSf`
  carried its own floor table (industrial 4) beside `MAX_FLOORS_BY_USE`
  (industrial 2); the massing invariant caught a lessee's four-storey shed at
  month 229 of the builder bot. One table now.
- **A refinance quote says why** — the owner's A7 note ("LTV maxes out at 23%
  with 5.0x DSCR at 2% — why can't I leverage more?") was the card labelling
  a loan "advance rate" / "debt yield" beside a cheque that matched neither
  leg. Two things were silent: the effective advance (stated rate × credit
  window × lender appetite × your standing × their book, `advanceFactor` and
  friends in `quote`) and the rent-roll haircut `refiQuotes` takes AFTER the
  three tests (`collateralHaircut` — concentration, rollover, one trade; the
  harness case was ×0.52 for "100% of the income is media"). `Quote` now
  carries `advanceLtvToday` + `advanceWhy`; `RefiQuote` carries
  `bindingWhy`, `advanceToday`, `haircut`; RefiDesk prints the reason under
  "What caps it", the Advance column shows the rate the desk sized at today
  (stated rate on hover), and `pnpm refi-bind` asserts the identity
  proceeds = min(legs) × haircut and that the reason line names the haircut
  whenever it bit.
- **The era is on screen** — `regime.ts` opens a quarter of new games (by
  weight: Great Inflation 13, "the morning after" 11 of 100) at an 8-17%
  base rate under a calendar that says January 2000, and nothing in the UI
  ever printed `eraLabel`/`eraBlurb`. The playtest screenshot read "JAN 2000
  · BASE RATE 17.24%" with no explanation, which is what the owner's "does
  the base rate match" question was really about. Now: an opening news item
  names the era and the opening rate, the date tile's tooltip carries it,
  a drop-3 "Era" tile sits beside Market, and the Economy strip has an Era
  tile. The calendar is unchanged (building ages read off START_YEAR).
- **The leasing mandate has a net-effective floor** (owner's ask, Sep 2026:
  "your team automatically leases buildings and you set the least effective
  rent you will take, with a cap on free rent"). The posted plan already
  carried an ask, a hold-then-step-down, a free-rent cap, a TI cap, a term
  band, a credit floor and signing authority — but its only floor was on
  FACE rent, enforced on a tenant's final, so a letter at the ask with six
  free months on a three-year term and $60 of TI signed at two-thirds of
  market net effective. `PlanRow.minNePct` is the signing floor: face after
  free rent, less TI amortised over the term, plus the bump premium
  (`loiMandateScore`), as a share of the letter's market. `clearAgainstPlan`
  signs as written only when the letter nets it; otherwise `trimToNeFloor`
  builds the counter — ask, concessions capped, then free months off one at
  a time, then TI in $5 steps — and a floor the sheet's own ask cannot net
  dockets with the reason. Rows written before the field read `floorPct`
  (what the old "walk-away floor" label promised); starter 0.82,
  player-equivalent 0.90. The plan sheet now leads with "Lowest net
  effective" (with the $/sf it means on today's index), free-rent cap and
  TI cap, then the ask; "Walk-away floor" is "Lowest ask". The editor shows
  before a desk holds the pen, so the mandate is written first and the pen
  handed second. `pnpm plan-desk` asserts the gate, the trim, the docket and
  the whole-book monotonicity; measured on six seeds × 96 months of a
  ~100-suite book: a 72% floor signs 42.8 deals at 86% net effective (the
  harness's blended measure) and the desk's own ledger reads 90.9%; a 95%
  floor signs 21.2 at 91%, ledger 100.3% — the desk never averages under
  its floor on its own measure. Baseline unmoved (the reference bots never
  hand the pen to a desk).
- **A cheap building is cheaper to run** — opex was one flat number per
  class for every address, so apartments ran a 3.6x fringe-to-prime rent
  spread into a 13.9x value spread ($36 to $502 a gross foot; half the flats
  in a $77 bin; a fringe block at 73% let earning less than nothing).
  `locOpexMult` in value.ts scales operating cost with the building's
  station at an elasticity of one half (NAA/IREM class A vs C), through the
  same location multiplier the rent reads and pivoted on the city mean, at
  every parcel-level site. After: apartments 7.3x, office 4.9x, retail
  16.7x (its own footfall gradient). Full note in ECONOMY.md. This moves
  every value, pro forma and loan size on the fringe and the prime, so the
  baseline moves — and moves a lot: land median +56%, office rent index
  +38%, population +7.5%, floor area +7% (25-year, 6-seed medians). Traced
  on seed 550991 against the previous engine: identical for six years, then
  more sites pencil at the fringe, more cranes (9 vs 1 live at year 10), more
  jobs (+9.5%), more residents, tighter housing, and the office rent index
  runs 12-28% higher through years 10-20 while vacancy sits on the same
  friction floor in both. That is the city's own growth loop answering a
  viable fringe, not a wire moving the wrong way; `pnpm playtest` §A2 now
  has asks tracking rolls harder (a 30pp-better roll asks 1.25x the model,
  was 1.02x), which is the direction that section says it wants. The
  remaining apartment spread is the rent gradient — MEASURED, and left
  alone: on the reference city 3% of offices and 10% of flats sit on
  `LOC_SPREAD`'s floor, none on the ceiling, and the p10-p90 raw multiplier
  runs 3.1x office, 2.8x apartments, 4.3x retail, 1.9x industrial, which is
  the business as the comment states it. `econ:report` A's 5.2x is the
  single worst building against the single best, and the 7.3x above is the
  0-19 bin (n=180) against the 80-99 bin (n=12); the 20-39 against 60-79
  bins run 3.8x. `pnpm facility` needed its firms restricted to
  pool-worthy buildings they can pay for (asks $400K+, under 60% of cash):
  once fringe buildings were priced on their own cost, the thin firm's eight
  cheapest deeds summed to a $4M base against the desks' $5M documentation
  floor and it papered nothing.
- **No negative cap rates on the tape** — an empty 1941 office with a tax
  bill printed "−14.80%" in the Marketplace's Cap rate column and on the
  parcel desk's "Going-in cap" row. A yield needs income; both print a dash
  with the reason ("no income to capitalise") when NOI is at or under zero.
- **`pnpm leaseup` measured a unit count, not a lease-up** — its 85% bar
  was `unitStatus` leased-over-total, and the total is the leg divided by the
  class's norm suite; a building demised into five real tenancies against a
  six-unit norm read 5 of 6 = 83% and "still empty after 20 years" with 100%
  of its feet let. Measured on that bar: 6 of 16 filled, 10 "empty" — and of
  those ten, four were at or above 95% of their area and only one under 65%.
  On rentable feet: 16 of 16 reach 85% let, min 11 months, median 41, p75
  82, max 153 (a demand-38 corner). The "fringe lease-up feel" fault in §6
  was mostly this harness; what remains is that a fringe building takes 7-13
  years to stabilise, which the letter model's tenant-pool ceiling (high 70s
  to low 90s by address) and location gradient produce by design.
- **The opening screen is asserted** — `pnpm opening-screen` renders the
  top bar, Economy, Research, Marketplace and the refinance desk against a
  real month-zero game (same SSR build as `pnpm leasing-page`) and fails if
  the era is not named, the Research "Under construction" column reads 0 sf
  on a seed that seeded jobs, the shops ledger precedes the tape, or a
  quote's reason is missing from the desk. Two faults it caught on its first
  run: `econ.pipeline` is refreshed once a month by design, so the opening
  screen read 0 sf over nine live frames (seedOpeningPipeline now refreshes
  the view once, before the first tick); and a desk whose `why` already
  named the rent-roll haircut dropped the credit-window half of the reason
  (`RefiQuote.advanceWhy`, printed on a second line of the desk table).
- **The cranes were already up** — every city opened with nothing under
  construction (Economy page: 0 sf in all four sectors, every era, a boom
  included; measured 8 seeds: 0 jobs at month 0, 0-1 at twelve, 0-6 at
  thirty-six). `seedOpeningPipeline` (dev.ts, called from `firstListings`)
  now starts jobs through the SAME door the growth loop uses — the city's
  groundbreak is factored into `startCityJob`: site contest, cornice, use
  cap, the shared pro forma — with the crew count from `crewCapacity`, the
  utilisation the loop reads off slack, and each start backdated a random
  way into its build with ledger (`spent`/`equityLeft`/`debt` along the
  S-curve fundJobs draws on) and delivery queue stamped as of that month.
  Named firms do not claim backdated starts. Measured after, 8 seeds: 0 to
  9 jobs at the bell (0 to 3.5% of stock); four of eight still open at zero
  because the pro forma clears nothing on those seeds — that is §6's
  "development barely pencils" fault showing at month 0, not the seed. This
  re-rolls the century (opening jobs occupy lots, deliver space, draw the
  city pool), so the baseline moves. The `[history]` invariant now allows a
  `build-start` event up to 60 months before month zero — no other kind is
  written into the past — and `monthLabel` already prints "Aug 1999" for it.
- **One cap-rate rail** — the era opener clamped caps to 3.2..14 and the
  monthly walk to 3.4..11, so a dear-money game could open at 12.5% and
  slide to 11.0% over its first months with nothing having moved. `CAP_RAIL`
  in `regime.ts` is read by both. Measured bind share by era (30 seeds × 30
  years): long expansion 1%, disinflation/morning-after 3-4%, Great
  Inflation 10% — a guard everywhere but the top of an inflation, which is
  where 1981's transaction caps sat. Baseline unmoved.
- **The primer offer retires itself** — it sat in the corner six months and
  two closed purchases into a playthrough. Advancing the clock or owning a
  deed dismisses it; the Primer stays in the header.
- **The Marketplace leads with the tape** — the four live listings were
  under an empty "Books for sale" explainer, the distress pipeline and the
  three-shop broker ledger. Empty books is one line (explainer on hover);
  the shops ledger moved below the tape; broker calls stay above it because
  they expire.
- **Rent rolls fit their buildings** (Sep 2026). The floorplate layer —
  stacks, suites, vacant blocks and the roll target `buildRentRoll` fills
  toward — was sized on `useSf` (GROSS) while occupancy, vacancy, rent and
  value read `useRentableSf`. The readers were moved to rentable in 1b and
  the writer never was, so a roll could be let up to the gross figure: the
  owner's Leasing page printed "Leased 7,504 sf of 5,986 sf" on a
  five-storey office at 72% efficiency, occupancy pinned at 100% with a suite
  still empty, rent arriving on 1,518 phantom feet. One basis now, in
  `plates.ts`, `leasing.ts`, `absorption.ts`, `dev.ts`, `portfolio.ts`,
  `space.ts` and the `overleased` invariant (which measured against gross and
  so could not see it). `pnpm suite-occ` / `pnpm plates-blocks` assert the
  identity on rentable; a 3-city probe finds 0 of 1,945 listing legs over
  rentable. This changes the leasing draw count, so it re-rolls every century
  (§4) and moves the baseline: rolls are 8-28% smaller, as they should be.
  It also un-broke `pnpm leaseup`: on the old engine 16 of 16 empty office
  buildings were "still empty after 20yr" because the 85%-of-units bar was
  counted on gross-sized units that rentable-sized tenants could never fill;
  now 10 of 16 fill (median 115 months) and the six that do not are fringe
  buildings in a 13% vacancy market whose `leasingOdds` readout says so
  (loiOdds 0.4%/month, share of market 0.03%). That slowness is the
  demand-pool model, not the plates, and it is open as a feel question.
  SAVES FROM BEFORE THIS carry gross-sized rolls: a loaded building can read
  "Leased 7,504 of 5,986" until those leases roll (1-8 years). No migration
  trims them — cutting a signed tenant's feet is cutting the player's rent.
  `pnpm playtest` §B after the change: office rolls 3pp under the market
  model, retail 17pp, industrial 10pp — the Layer-1/Layer-2 seam is open for
  retail and industrial (single-floor legs are let-or-empty in
  `buildRentRoll`; suspect that and the -14/+5pp draw).
- **A standing building is not "Dirt"** — the parcel desk headed every owned
  building using under 75% of its FAR envelope "Dirt — nothing pencils today ·
  Holder bid $0/sf wins the auction", which with tower-legal envelopes on the
  core is most of the town, fully-let buildings included. Built lots now read
  "Underbuilt / Redevelopment pencils · N% of the envelope unused" with both
  bids named — and "pencils" on a built lot means the builder's residual for
  the CLEARED dirt beats the standing building's appraisal per foot of lot,
  not the holder's bid for the same dirt (the first cut called a 99%-let
  corner a redevelopment on $238 against $464, neither of them the building).
- **Standing rolls no longer leave slivers.** `buildRentRoll` let a 3,000 ft
  shop as 2,500 ft plus a 500 ft remnant, a five-floor office as four floors
  and an unlettable strip; when what a draw would leave cannot be let, the
  tenant takes it. `pnpm playtest` §B: retail rolls 17pp under the market
  model → 8pp, office 3 → 8 on a re-rolled world, industrial 10 → 9; the
  rest is the for-sale skew and the −14/+5pp draw the harness itself names.
- **"Your ask vs the market" compares like with like.** `leasingOdds` printed
  a FACE, condition-adjusted ask against an EFFECTIVE standard-condition
  market rent, so a good building on the Market stance read "$35 vs $26" in
  a glut and the row went red — the player was told they were over market
  while sitting on it. The market figure is now what the building would ask
  on the Market stance with no stale markdown; the gap shown is the stance
  and the agent's markdown only. The odds themselves never used the pair.
- **A sold deed lands with its buyer.** It left the player's book and landed
  nowhere: `holderOf` re-hashed the unowned parcel to the holder the player
  had bought it FROM ("Owned by Abernathy Construction" a month after
  selling), and a named firm's winning bid put nothing in that firm's book.
  Now a living firm's bid closes into that firm's balance sheet through
  `rivalBuys(…, prefer)` — on its own cheque, or not at all (the first cut
  fell through to the appetite draw and handed Anwar Estates' bid to Pell
  Street) — and an anonymous buyer salts the register draw (`deedSalt`) so
  the holder is a different, stable name. One comp per sale, in the buyer's
  name. `pnpm deed-goes`. The unsolicited-offer card also stops saying "Your
  ask is $1.88M · vs. your ask 0.0%" about a building never listed.
- **The Books net-worth tile is the top bar's number.** It read `nwHistory`
  (stamped at the last tick), so for the rest of any month with a purchase
  or sale in it the tile disagreed with the bar above it ($2.54M against
  $2.15M after a levered buy). Live `netWorth(game, parcels)` now, one
  function; "Deposits held" prints the liability without a minus sign.
- **The primer offer no longer sits on the cycle digest.** Both cards anchor
  bottom-left; the first-run offer (z 45) covered the digest (z 22). The
  digest yields while the offer is up (`.app:has(.primer-offer)`).
- **District names travel with the parcels.** `rec.district` is the generator's
  leaf KEY (`thechange`); the map label carried the name and nothing else did,
  so the tape printed "Sold in thechange" and every district column (Economy
  submarkets, Research zoning, Notes, Palette, Concentration, the banks' book)
  printed keys. `districtName` rides on the parcel from the manifest;
  `districtLabel(rec)` / `districtLabelOf(parcels, key)` in `mix.ts` are the
  readers. Old saves fall back to the key.
- **Cap rates stop chasing inflation into the ceiling, and the Leasing tab
  lists its letters** (Sep 2026). The owner asked why an 8% cap sits on 2%
  money. Measured (`pnpm capvsrate`): the rate wire was right at the bottom —
  office 6.67% at a ≤2.5% index in a functioning market — and the 8 is the
  glut (33% office vacancy in the depression months that are 62% of cheap
  money). The wire was wrong at the TOP: reading the nominal index, it pinned
  office on the 11% rail in 17.4% of all months. Expected inflation above the
  2% target now comes off the index the cap target reads (one-sided: rents
  are sticky downward). Write-up at the end of `ECONOMY.md`. Separately,
  `pnpm leasing-page` renders the Leasing page against a real game and
  asserts the LOI and renewal letters are on it — they were only on Deals.
  The same harness renders Portfolio and asserts its occupancy — the book
  total and every row — is the top bar's number: rows were dividing by
  rentable feet while the top bar and Leasing divide by lettable feet, so a
  "fully let · 1,300 sf unlettable" building printed 94% on Portfolio.
- **The inflation fix** (`4034910`) — the most consequential. Labour demand was
  not constrained by labour supply: `employIdx` (jobs WANTED) grew unbounded,
  unfilled positions reached 8–24% of the labour force and never came back, and
  two wires took that number seriously — space demand was driven by jobs wanted
  rather than jobs filled, and the local Phillips term multiplied the same
  unbounded number into the price level. Result was 4.8%/yr CPI and office
  rents 2.4–2.7× in the first decade. Now 2.5–2.9%/yr and 0.75%/yr REAL rent
  growth. `pnpm inflation` guards it.
- **The portfolio facility** (`3ec2471`) — cross-collateralised term loan over a
  pool of deeds, with a computed pooling benefit (Herfindahls over value and
  class), a 115% release premium, cross-default, recourse, and a receiver that
  sells the whole pool. Plus the **Debt page**.
- **The owners register** (`f1da4f8`) — ~217 named private holders per town,
  assigned by hash, power-law distributed, with a memory of the player and
  demographic exit events.
- **The calendar** (`c91405e`, `e4c7dc1`) — START_YEAR 2000 → 2024 to match a
  rent table calibrated on JLL 2024 data, then the seventeen stray copies.
- **Per-leg rents** (`e4c7dc1`) — the retail-signs-under-market fault.
- **The baseline widened to six seeds** (`eb96bac`) after it reported a re-roll
  as a regression.

---

## 6. OPEN FAULTS, RANKED

**0. `pnpm facility` was failing on the committed engine — fixed, both rows.**
Verified identical on `c826741` with the working tree stashed: "2-3 month(s)
with a negative balance" and "a thinly capitalised firm went thirty years
without the facility ever biting". The first was the equity cure in
`tickFacility`: a pool earning negative NOI has a negative DSCR,
`balance × (dscr / minDSCR)` was a negative paydown target, and the cure
wrote a cheque for more than the loan — clamped at full repayment, and a
cure that clears the line retires the facility the way `repayFacility` does.
The second was the harness: `tickFacility` runs the equity cure BEFORE it
records a breach, so a firm with the cash never shows `breachedSince`; the
covenant took its paydown out of cash instead, sixteen times in thirty years
for the thin firm, and the harness counted only the recorded breach. A cure
is a bite; it counts them now. Neither row is in `pnpm check`.

**0f. One building, three appraisals in six months (playthrough 3, Hartmoor
Landing, cheap-money opening).** 107 W 7th St, 5,004 sf of flats at demand
23, 96% let: the parcel desk appraised it at $161-181K while it was on the
tape at $363K (the bot paid the ask — twice the desk's own number, which is
the bot's fault, not the game's); the month it closed, the OWNED desk read
$281-317K with market rent $15 against the $12 it had printed a moment
before; six months later $173-195K; a year on $134-152K. In-place NOI on
the same card ran $17K → $15K → $9.9K → $7.2K over that year with occupancy
96-97% throughout. Either the mark blends toward the price paid at closing
(then say so on the card) or the owned and unowned readers disagree on rent
and condition for the same roll — read `holdingValue` against the tape's
`assetValue`/`inPlace` on a fresh purchase before the offer card says "vs
appraisal −7.4%" on a building bought at 2x that appraisal. Screenshots
02/03/04/08 of the run.

**0e. The city labour market, measured before anyone touches migration.**
`pnpm playtest` §D read unemployment on its 2.8% frictional floor in 40% of
months with a 0.2pp recession gap, which looks like a load-bearing rail.
On the reference city, 6 seeds × 50 years, no player: unemployment p10
2.8% / p50 6.3% / p90 11.1%, on the floor 15.5% of months, unfilled
positions p50 0 / p90 2.7%, and population growth tracks job growth within
a few hundredths of a point a year on every seed (0.79% vs 0.82%, −1.07% vs
−1.29%, …). The recession-vs-expansion median gap is 1.2pp against a real
2-5pp — narrow, but a calibration of `natPull`, not a rail. The playtest's
40% is its own six cities with a player buying. `vacPull` (a tenth of the
vacancy gap a year) is slower than Blanchard-Katz's three-to-five-year
regional adjustment and would be the dial if the gap is ever widened; it
was left alone because the measurement did not call for it.

**0d. `econ:report` band B (supply shock) is outside its band on this
engine:** a +10% office delivery moves rents only 2.1% below the
counterfactual (band wants 10%) and the new building never reaches 80% let
inside ten years. The transmission audit's supply section reads the same
2-3% and calls the wire present; the band is a calibration question about
how hard a glut moves face rent (concessions carry 0% of the adjustment
here; real gluts move concessions first). Reported, not gated; predates the
opex change (the wire does not read opex). Read with care: the seed it draws
opens at 19.6% office vacancy with the concession dial already saturated,
so the counterfactual is equally saturated and the effective line cannot
separate from face — the 100% face share is the harness's seed, not the
market's behaviour. Re-run it on a balanced opening before acting on it.

**0c. `pnpm audit` on this engine (Sep 2026, `node tools/econaudit.mjs`,
timed out at 40 min after section 9):** experiments 1-6 WIRED (2 reads WEAK
on the negative demand shock, as before), 7 housing→retail spillover
BACKWARDS and 8 contradiction scan BROKEN — both already recorded in the
committed `ECONOMY_AUDIT.md`, so they predate this session. Note `pnpm audit`
is shadowed by pnpm's own vulnerability audit; call the tool directly.

**0a. Fringe lease-up is slow, not stuck.** After the harness fix in §5,
16 of 16 empty office buildings stabilise (median 41 months) and the slowest
fringe corner takes 153. Whether 7-13 years is the right pace for a demand-40
address is a calibration question against real suburban class-B absorption
(which does run years, not decades); the mechanism is `leaseFactors`
(location cubed, tenant pool) and it is documented as a shape.

**0b. A quarter of new games open in a 1981.** By design (`regime.ts`, era
weights), and now labelled on screen (§5). Whether an era that prints 17%
money under a year 2000 calendar is the right design is the owner's call;
the honest alternatives are to shift the calendar with the era (building
ages and every `START_YEAR` reader move with it) or to reweight the eras
toward the post-1990 range. Measured this session, 40 `newGame` seeds on the
reference city, 50 years each, no player:

    opening base rate     p10 3.76  p50 7.03  p90 14.56  max 18.17   (12 of 40 open above 10%)
    50-yr max base rate   p10 8.56  p50 12.58  p90 23.00  max 23.00  (the RATE_CEIL rail binds in ≥10% of centuries)
    months above 10%      p50 5%    p90 21%    max 33%
    peak inflation        p50 9%    p90 15%    max 22%    (the 0.22 inflation clamp binds)
    peak policy rate      p50 10.2  p90 22.8   max 31.9

The opening draw is the era table and is a design choice. The century AFTER
the opening was not: a median seed that peaks at 12.6% money and one in ten
that pins the 23% ceiling was a nation model over-producing Great
Inflations. Traced (40 seeds, monthly nation state, the four worst run-ups
printed): every peak sat downstream of a fiscal-pressure episode that FROZE
the policy rate for 30-96 months while `easeEma` compounded the ease to 20%
inflation, credibility hit its floor and expectations their clamp — and then
a bank climbing at 0.75 a meeting off a 12-month-smoothed read peaked two
years after inflation did. Two mechanism fixes, both from the record (the
Martin Fed leaned back at ~1.25 pts/yr under Vietnam pressure; Volcker moved
in 1.5-point steps): pressure is a grudging pace, not a freeze; the restore
regime moves 1.5 a meeting. Measured, both (ECONOMY.md "A LEANED-ON BANK
LEANS BACK"): peak policy max 31.9 → 24.5, p90 22.8 → 19.6; peak inflation
max 22% → 18% and its clamp no longer binds; the index ceiling still touched
by one seed in forty. `pnpm inflation`, `pnpm rates` and `pnpm balance`
green. The 16% expectations clamp still binds in the worst seed and is the
next suspect.

Listing volume, same session, 6 seeds × 10 years: 7-18 deeds live on the
tape at the opening bell (7 in a cheap-money era, 17-18 in an inflation),
22-32 arrivals a year = 2.5-3.7% of the building stock. Institutional
turnover runs 5-10% of stock VALUE a year, all-buildings turnover nearer
3-5% — the tape is at the low end of real, not broken. The playtest city
that opened with four listings was a dear-money recession.

**1. The industrial vacancy floor — RE-OPENED, then improved. Read this before
trusting any "CLOSED" below.** This entry said CLOSED and `BASELINE.json` said
`rail.vac.industrial.lo = 0.7267` — the floor binding 73% of months — for an
unknown number of commits. `pnpm vacdist` agreed with the baseline, not with
this file. The Aug-2026 playtest found the disagreement; see
`PLAYTEST_2026-08.md` §1.6.

It is much better now and it was not fixed directly: the occupancy work in
`PLAYTEST_FIX_PLAN` steps 1-2 moved it. Measured 8 seeds x 60y, industrial on
its friction floor **73.3% -> 55.9%** of months, within 2pp of natural
4.9% -> 10.3%, and p95 vacancy 5.6% -> 30.8% — the class finally has a bad
market sometimes. It is still the worst rail in the repo and it is still open.

The original entry, kept because its mechanism is still the live one: shed demand
tracked total `jobIdx` while manufacturing's share of employment/floor space
falls secularly. `econ.industComp` now declines at the NY/SF/London rate (~half
over ~40y ≈ −1.72%/yr), floor 0.35 for residual logistics; industrial driver is
`jobIdx * industComp`. Measured after: `rail.vac.industrial.lo` 0.44 → **0**,
`vactails` months on floor ~69% → **8.9%**, median industrial vac **9.7%**
(was pinned at 1.54%), sector-exit firing 74% → **5.7%** of months. Sized from
the historical record; where F landed is the measurement.

**2. ~~Development still barely pencils~~ — CLOSED.** Land ask was above the
builder residual by construction: a 14% texture blend on top of the winning
bid, then ×(1 + 0.22·demandBeta·cycleDev) on a residual that already
underwrites through-cycle `rentExp`/`capExp`. `landRead` is a pure auction
again — `max(builder, holder, textureFloor)`. Measured: builder-won lots ask
exactly the residual; ten-year mean `affordableLotShare` moves from ~1–2% into
the mid-teens (seed-dependent, cyclical), against an honest mid-cycle band of
roughly 8–12%. #47.

**3. ~~The conservation identity's debt gap~~ — CLOSED.** Cash-out refinance and
facility draws book to `borrowed`; voluntary paydowns to `debtSvc`; conserve's
bot buys at half leverage and refinances so the identity is exercised, and
`borrowed` is in REQUIRED. The first close left the bucket dead: the bot
bought at max LTV and called Alden ($2.5M minimum) on small deeds.

**4. ~~CPI is non-monotonic~~ — CLOSED (floor).** Monthly CPI change floors at
−0.05%/mo (~−0.6%/yr) while national inflation is non-negative; only a national
deflation regime re-opens the old −0.35%/mo bound. Does not invent a positive
floor — it stops the local Phillips path from manufacturing multi-year CPI
declines the national path never authorised.

**5. ~~Rivals cannot underwrite a lease-up~~ — CLOSED.** `streetRefiProceeds`
takes the same `stabViewFor` plan the player's bridge desk reads.

**6. ~~Rivals never use the facility~~ — CLOSED for acquisitions.** The street's
corporate line (`lineRoom`) now funds the equity cheque on a purchase the way
it already plugs a balloon — not the player's exact `facility` instrument, but
the same balance-sheet move.

**7. ~~#39 — rent reprices on vacancy in the same month~~ — CLOSED.** Vacancy /
scarcity pressure still observes instantly; application into `rentIdx` runs
through a per-class EMA (`rentPress`, τ≈4 months). Same-month vac→rent leadlag
clears; the four-quadrant checks (#31) still want a longer campaign sample.

**8. An 8% cap on 2% money — the glut, read through the cap rate.** Open, and
upstream of the cap formula. `pnpm capvsrate`: in cheap money (index ≤ 2.5%,
17.8% of the century) the office cap is 8.17% median, 8+ in 54.5% of months,
because 62% of those months are recession/depression with office vacancy at
33%; in the other 38% the cap is 6.67%, which is the 2013-19 record. The fix
is §1 of `REALISM_AUDIT_2026-08.md` (standing stock has no exit) plus a credit
crunch that heals on the lenders' clock instead of the phase table — see the
last section of `ECONOMY.md`. Do not touch `CAP_VAC_BETA` or its +2.0 guard
first; they are pricing the fault, not causing it.

**9. #33 seller predictability (tape path closed — `bidOdds` reads kind floors; negotiation still has its own reservation), #36 zoning depth, #48/#49 firm entry and exit.**
Longstanding, lower priority.

**Thin-sponsor covenant immortality — CLOSED.** Equity cures and covenant
paydowns are cash-only (`fundCashNeed` / `fundableNow` with `{ allowLoc: false }`).
Debt service may still draw the revolver; curing a breach with the revolver was
the immortality path.

**~~Holder relationships are wired to approaches only~~ — CLOSED.** Cold
holders block every acquire door (`buyListing` / `negotiate` / `buyOffMarket` /
`counterOffMarket` / `submitBlindBid` / `acceptCounter`), hang up open talks
and approaches across their book on `offend(..., parcels)`, and stay visible
on the tape as **NOT TO YOU** (still for sale to the market). Broker pools
already skipped them. Holders do not bid at auction — that HANDOFF claim was
wrong. Harness: `pnpm holder`.

---

## 7. WHAT I WOULD DO NEXT, IN ORDER

**Active agent queues (Aug 2026):**
- **Grok / Cursor:** `GROK_QUEUE.md` — UI splits, safe playtest balances, seller
  measurement, distress idle UX. No playtest. Do this first.
- **Fable 5:** `FABLE5_PLAN.md` — Station, zoning depth, tenant expansion, broker
  early look, firm entry/exit. **Do not start until `GROK_QUEUE.md` checklist is
  complete.**

**Longer execution plan:** `NO_PLAYTEST_PLAN.md` — phases 2–7 (CI/audits, rail
retirement, #33 sellers, #36 zoning, #48/#49 firms, optional graphics). Phase 1
(holder memory) and Phase 2 harnesses (`pnpm attention`, `pnpm rng-audit`,
`pnpm seller-stats`, CI smoke) are on tip.

1. **~~Unify city-supply vs desk delivery~~ — CLOSED (settle moment).**
   See `SKYLINE_CYCLES_PLAN.md` Phase 8.
1a. **~~Conserve `borrowed` was dead~~ — CLOSED.** Bot draws land-loan /
   cash-out principal; `borrowed` is in REQUIRED. `pnpm conserve`.
1b. **~~Income quoted on gross~~ — CLOSED.** `bldgArea` stays GSF; rent,
   NOI, cap, stock and lease-up read `rentableSf` = gross × (1 − coreLoss),
   0.72–0.92. `pnpm rentable`.
1c. **City renewal.** Anonymous fabric never starts `obsolete`. After
   rentable, merchant teardown (`clears` = YoC ≥ exit × 1.17, land in the
   basis) almost never fired on the single highest-score lot (largest unused
   FAR, least likely to pencil). Two decisions now: merchant densify still
   needs the full developer hurdle; owner-recycle (age ≥ 60, the commercial
   economic life, or obsolete) is YoC on build cost ≥ exit. The sample is
   the candidate set; they are
   underwritten in score order and the first that clears is the
   groundbreaking. Measured `CITY_SEEDS=1` × 5 × 50y: K passes (median
   age +42, need < 43). L median demo 0.097%/yr (need ≥ 0.100; was
   ~0.036 after rentable, ~0.098 before). The ~0.5% anchor is not a
   birthday: median replacement YoC ex-land is ~3.2% against a ~6.1%
   exit. Do not invent a coefficient to close that.
2. **~~Holder memory beyond approaches~~ — CLOSED.** `pnpm holder`.
3. **Retire load-bearing rails** — `NO_PLAYTEST_PLAN.md` Phase 3; measure with
   `pnpm rails` first. (3.1–3.2 largely done; see `RAIL_AUDIT.md`.)
4. **Zoning depth (#36); #33 seller predictability; #48/#49 firm entry and exit**
   — Phases 4–6; Fable owns the big cuts after Grok queue.

---

## 8. THINGS I WOULD WANT TO KNOW

**The owner's standing instructions.** Realism outranks his stated preferences,
including about difficulty — he said so explicitly. Difficulty is an OUTPUT. If
the game is too easy the question is never "what should we make worse", it is
"which real risk is not modelled yet".

**Calibrated industry constants are the opposite of a fake.** A 4% management
fee, a 6% brokerage, a 39-year depreciable life: hardcode them, cite them in a
comment. The test is not "is it a constant", it is "is it a fact about the world
or a thumb on the scale". Shape parameters sit in between — say which, in the
comment, every time.

**When a fix makes a headline number worse, keep the fix and write down the
measurement.** A correct model scoring worse than an incorrect one is
information about the rest of the model. But it IS a reason to find what the
wrong number was propping up.

**The comments are load-bearing documentation.** Most non-obvious code carries a
comment saying what was wrong before and what was measured. They are long on
purpose — several of them are the only record of a fault that took a day to
find. If you change the code, change the comment; if you find the comment
lying, that is a bug report.

**Commit messages here are the changelog.** They carry the measurements. `git
log` is genuinely the best way to understand why something is the way it is.

**Never tune a bot until the number looks good.** If a strategy loses money,
find out whether the strategy is bad or the economy is broken, and say which.

**The owner plays in long saves** — sixty to a hundred years. Faults that
compound slowly (a 1%/yr drift, a rail that binds a third of the time) matter
more here than in most games, because he will run them out to the point where
they dominate. Two of the last three fault reports were exactly that.

---

## 9. PLAYER BACKLOG — Aug 2026 session

| Item | Status |
|------|--------|
| Distressed assets (counter / loan-basis) | **Shipped** #82 |
| Playable download hygiene | **Shipped** #83 |
| Demand dynamism + Economy drift + delivery zoom | **Shipped** #84 |
| Build desk declutter + quality/presets | **Shipped** #84; 3-tab flow in #86 |
| Property desk file split (Acquire / Refi / Develop) | **#86** open |
| FAR / industrial / insolvency / refi fundable UX | **Grok G3** — balances-only PR (not #85) |
| Ground-up cost/rent pillar (`e64b048`) | **Parked** — broke `firms` seed 4242; Fable F6 only with harnesses |
| Distressed buyer idle months (playtest #6) | **Shipped** #91 |
| Seller predictability (#33) | Tape `bidOdds` now reads the same kind floors as the desk; OfferDesk shows a typical close band |
| Diversification loses (playtest #7) | **Deferred** — investigate strategy vs economy |
| The Station / zoning / tenant / broker / firms | **Shipped** #94 (engine); visibility pass on desks |

**Do not merge #85** as stacked — last commit breaks century firms. Use the
balances-only PR from `GROK_QUEUE.md` G3 instead.

---

## 10. THE LEASING OVERHAUL (Phases 0–6)

See `LEASING_OVERHAUL_PLAN.md`. Two systems shipped together:

1. **Floorplate inventory** (`src/engine/plates.ts`). A building is a stack of
   plates, not a pre-cut of N equal suites. Tenants arrive with a size;
   demise/merge are events with cost. Vacant inventory is contiguous blocks
   (`blocksOf`). The physical lettable floor is `minLettableSf` — a remnant
   under the city norm stays vacant; a whole shop smaller than the norm is
   still the shop.
2. **One clearing engine.** The four mandate dials and the desk-that-imitates
   the player are gone. A posted `leasingPlan` (asking sheet, hold-out,
   package, dollar authority) is what both the desk and the principal clear
   against (`clearAgainstPlan`). No desk → letters land on the player. A desk
   without a sheet gets `starterPlan()` (quote 90%, the old default sign line).
   Old saves that still carry leftover dial fields are migrated in `save.ts`.

**Phase 6 measured, do not tune.** The Phase 0 gap (principal +17.7 NE points
over the old desk) closed to +6.8 under the player-equivalent sheet and
stayed +6.8 after Phase 5 deletions. Residual is a posted number vs the
tenant indifference function, plus fees. That is (a) in the plan's language
— the schema cannot track the cycle — not a coefficient to twist.

Hands-off-with-plan is not strictly dominated by grinding (deals 67.4 vs
67.0; vac-months 3022 vs 3080) and is not strictly dominant (principal still
wins NE and NOI; fees are real). `pnpm stress` holds leasing constant on
purpose — the leasing comparison is `pnpm desk-vs-principal`.

`pnpm report` finished after Phase 5: no new band. Econ **B** (supply-shock
rent 1.4% vs need ≥10%) and sim **F** (office −1.04%/yr, retail −1.41%/yr)
stay REPORTED, NOT GATED. City-accept J–M all hold.

`pnpm run audit` finished: experiments 1–6 WIRED. No BACKWARDS on a
leasing wire. 7 housing→retail BACKWARDS, 8 contradiction BROKEN, 9/11/13
WEAK (`rateEma` dead; age +42 vs the audit's <40 cut — city-accept K
still holds). See `PHASE6_MEASUREMENT.md`.

Harnesses: `pnpm desk-vs-principal`, `pnpm demise`, `pnpm plan-desk`,
`pnpm plan-ui`, `pnpm plates-blocks`. Rebuild `pnpm engine` before every probe.

Phase 1 and Phase 5 are the two sanctioned `pnpm baseline` re-rolls. Phase 5
moved no standing number. Do not add world-stream draws. `pAccept` and
`drawRequirementSf` stay on `rng(s)`. See `PHASE6_MEASUREMENT.md`.
