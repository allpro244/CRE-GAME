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

Node 22, pnpm 10. The repo root has an older scaffold beside `broadway-and-wall/`;
point your editor at `broadway-and-wall/` or it will read both.

The city is **generated at runtime** (`src/citygen/`) from a seed — there is no
data pipeline to run for normal development. `pipeline/` is audit material and
its outputs are gitignored.

---

## 2. THE SHAPE OF THE CODE

```
src/engine/     pure functions over JSON state. No DOM, no store.
                advanceQuarter(g, parcels, bbls, adjacency) is the monthly tick.
src/citygen/    generates the town from a seed. Deterministic.
src/state/      zustand store. The only mutable thing in the app.
src/ui/         RightPanel.tsx is ~9,400 lines and holds nearly every page.
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

**The frozen world.** `advanceQuarter` returns state UNCHANGED once `gameOver`
is set. Any probe running past ~year 30 without a player must resurrect:
`if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };` A measured "plateau"
in how many firms a city supports turned out to be the game being over.

**The conservation identity does not track debt principal.** `pnpm conserve`
asserts `Δcash == books + Δloc.balance + Δdeposits`. Mortgage principal is
outside it by convention — `bought` books the EQUITY cheque, not the price, and
the loan goes straight to the seller at closing. Consequence: **a cash-out
refinance and a facility draw are unbooked cash inflows that the identity
cannot see.** It stays quiet only because conserve's bot does neither. If you
ever extend the identity to carry debt balances, `refinance`, `executePurchase`
and `facility` must all move together — they share the convention. This is
written up at the top of `facility.ts`.

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

**1. The industrial vacancy floor is load-bearing.** `rail.vac.industrial.lo`
binds ~46% of months (was 68% before the inflation fix, 32% before the calendar
change). CLAUDE.md fake #5: a clamp the model rests on is holding up the model.
This is the loudest open defect. Start at `frictionFloor` in `market.ts` and ask
why industrial demand cannot clear at any price.

**2. Development still barely pencils.** `dev.affordableLotShare` is 1.9% —
better than the 0.2% it was, but the honest number is 8–12% mid-cycle. Land is
the residual; if nothing pencils, either rents are too low, costs too high, or
land prices are not answering the builder's number. #47.

**3. The conservation identity's debt gap** (see §4). Real correctness work,
touching three call sites and one convention. Would close the last place money
can move without being seen.

**4. CPI is non-monotonic.** Three of six seeds ran 127–218 deflation months,
worst ten-year stretch −10.8%, because monthly inflation is clamped to
[−0.35%, +1.15%] and the lower bound is reachable. Filed, not fixed. Pushes
rents the other way from the complaint that surfaced it.

**5. Rivals cannot underwrite a lease-up.** The stabilised bridge leg is fed
only from `buyQuote`, so the player can finance a 30%-let building on stabilised
value and the street cannot. An asymmetry in the player's favour.

**6. Rivals never use the facility.** Only the player can borrow against a book.
That is a real competitive advantage nobody asked for.

**7. #39 — rent reprices on vacancy in the same month.** A simultaneity where a
lag belongs. The four-quadrant identity checks (#31) are the same subject.

**8. #33 seller predictability, #36 zoning depth, #48/#49 firm entry and exit.**
Longstanding, lower priority.

**Holder relationships are wired to approaches only.** A holder who will not
take your call still lists buildings to you on the open tape and still bids
against you at auction. Extending the memory to listings and the broker's calls
is the obvious next move on that feature.

---

## 7. WHAT I WOULD DO NEXT, IN ORDER

1. **The industrial floor** (#1 above). It is a rail holding up a model, it has
   been visible in the baseline for months, and everything downstream of
   industrial demand is wrong while it binds.
2. **Make development pencil** (#2). These two are probably the same
   investigation: both are about whether supply can answer demand.
3. **Close the ledger's debt gap** (#3), and make `conserve`'s bot refinance so
   the new identity is actually exercised. An identity is only worth the
   question it was asked.
4. **Give the street the bridge leg and the facility** (#5, #6). The player
   should not have instruments the competition lacks.
5. **Then the four quadrants** (#31/#39) — the deepest remaining structural
   question and the one most likely to move everything at once.

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
