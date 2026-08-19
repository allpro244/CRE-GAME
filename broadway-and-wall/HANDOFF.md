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
| `pnpm inflation` | ~2 min | the price level and real rent growth against observed bands |
| `pnpm facility` | ~2 min | the portfolio loan, both sides — it must work AND it must bite |
| `pnpm covenant` | ~2 min | a rich sponsor must never lose a building; a thin one still must |
| `pnpm legmatch` | ~10s | per-leg vs blended rent — one quantity, two answers |
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

**START_YEAR is 2024 and there are no stray copies of it.** There were
seventeen hardcoded `2000 + Math.floor(month/12)` in seven files while the
constant said 2024, so the game printed one year and aged its stock from
another. Grep before you add another.

---

## 5. WHAT SHIPPED RECENTLY (last ten commits)

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

**1. ~~The industrial vacancy floor is load-bearing~~ — CLOSED.** Shed demand
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

**8. #33 seller predictability, #36 zoning depth, #48/#49 firm entry and exit.**
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
   needs the full developer hurdle; owner-recycle (worn and ≥70, or obsolete)
   is YoC on build cost ≥ exit. The sample keeps the best 12 and takes the
   first that clears. Re-measure `CITY_SEEDS=1 node test/city-accept.mjs`
   K/L before trusting the bands.
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
| Seller predictability (#33) | Measurement **Grok G4**; engine depth still open |
| Diversification loses (playtest #7) | **Deferred** — investigate strategy vs economy |
| The Station / zoning / tenant / broker / firms | **Shipped** #94 (engine); visibility pass on desks |

**Do not merge #85** as stacked — last commit breaks century firms. Use the
balances-only PR from `GROK_QUEUE.md` G3 instead.
