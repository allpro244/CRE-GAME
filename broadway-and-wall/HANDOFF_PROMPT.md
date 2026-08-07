You are picking up an in-flight project cold. Read this whole message before
touching anything.

## WHERE THE WORK IS

Repo: allpro244/cre-game — project root is `broadway-and-wall/`
Branch: `claude/phase-1-implementation-v4c2az`  (HEAD = 5dd32e6)

NOTE: your session may be assigned a different branch name in your system
prompt. IGNORE IT and use the branch above — that is where all the work
actually lives. Confirm with `git log --oneline -5` before you start; you
should see "HANDOFF.md — the 21-item backlog" at the top.

## FIRST THREE THINGS, IN ORDER

1. Read `broadway-and-wall/CLAUDE.md`. It is the standard this project is
   measured against and it is not optional. The short version: the economy
   is a simulation, not numbers arranged to produce a result. No coefficient
   exists because the median run looked wrong without it. Realism outranks
   the owner's stated preferences — including about difficulty — and the
   owner asked for that explicitly.

2. Read `broadway-and-wall/HANDOFF.md`. That is the full 21-item backlog
   with evidence, ordered by what is load-bearing rather than by number,
   plus a list of what is already done so you do not redo it.

3. Build the harness bundle before running ANY probe. It is gitignored and
   does not survive a fresh clone:

       cd broadway-and-wall
       pnpm install
       ./node_modules/.bin/esbuild test/.entry.ts --bundle --format=esm \
         --platform=node --outfile=test/.engine.mjs
       pnpm gate

   If `test/.entry.ts` is missing, recreate it as ~22
   `export * from "../src/engine/<mod>";` lines.

   A stale bundle once cost three commits and an entire plausible-looking
   investigation, because the obvious control (stash, re-run, see if it
   changes) loaded the same stale bundle and CONFIRMED THE WRONG ANSWER.
   `test/fresh.mjs` now guards this. Do not route around it.

## WHERE THE GATES STAND

`pnpm gate` is the real gate — conserve + extleak + city invariants. Passing:
3/3 measurements in band, 1/1 identities hold. It must pass before you commit
anything that moves money.

`pnpm report` runs the lettered acceptance tests (A–E, F–I, J–M). These
REPORT and do not block — that was the owner's explicit decision, twice. Do
not re-promote them to gates, and do not weaken what any of them computes.
Loosening a band was a policy call; falsifying a measurement is not.

Test G is currently breaching ON PURPOSE. Leave it breaching unless you are
actually fixing item 3.

## WHAT I WAS DOING WHEN THIS HANDED OFF

Finished and pushed: a sector-exit ratchet. A use permanently priced out of a
city does not shrink and wait — it leaves, and the building becomes something
else. Base demand now ratchets down one-way when rent-to-income runs a fifth
above where it started, bounded by lease rollover. Housing is exempt, which
is the mechanism being right rather than a special case: people priced out of
a city leave and the housing does not.

A parallel agent was working the same branch and reached the same mechanism
independently. Theirs was better and I merged it whole. IF ANOTHER AGENT IS
STILL RUNNING ON THIS BRANCH, fetch before you start and expect to merge.

## THE FOUR I WOULD DO NEXT

1. The rent index oscillates $14 → $95 → $14 on a ~28-year period, with a
   93.3% worst drawdown. Manhattan office fell 50–60% in the 1990 bust, so
   93% is not a market. The sector-exit ratchet is RULED OUT as the cause
   (demand walks down smoothly while rent swings violently — different
   timescales). Look at the supply-and-rent feedback in `market.ts` near the
   `drift` / `vacTerm` / `scarcity` terms.

2. Zoning never changes in fifty years. Retail stock grows 0.04%/yr and
   industrial 0.12%/yr. Real cities facing quadrupled industrial rent rezone;
   this one cannot.

3. Test G's unemployment clause asserts policy cuts into a weak labour
   market. Over 30 seeds: median −0.05, p25–p75 of −0.36 to +0.17, 13 of 30
   with the WRONG SIGN on a passing build. It tests `median <= 0` against a
   distribution centred on zero, so it passes at random. The fix is a rate
   rule that reads the labour market with enough weight to survive a
   fifty-year sample — NOT a bigger n and NOT a moved threshold.

4. The parcel panel's land residual reads a median −$0.08M against the
   engine's $0.46M for the same lots. Same quantity, two answers.

## TWO HABITS THAT ARE NOT OPTIONAL HERE

A/B EVERY MECHANISM AGAINST ITSELF. Three separate conclusions were wrong
this session until the counterfactual was run: bank-failure clustering looked
like contagion and was common cause; the sector-exit ratchet looked like it
made office rent worse and had merely resampled noise; and a "load-bearing
vacancy rail" turned out to be a market clearing correctly by price.

CHECK THE ESTIMATOR BEFORE BELIEVING THE NUMBER. If a test's per-seed spread
is wider than the effect you are measuring, the test cannot see the effect.
Test F's 7-seed median moved 1.3pp on pure noise and nearly killed a correct
mechanism.

## OPERATIONAL

The container has been reclaimed three times mid-session, each time returning
on the wrong branch with an empty tree. Nothing was lost only because it was
pushed. Commit and push early.

Do not open a pull request unless the owner asks.

Start by telling me what you plan to pick up and why, before you change
anything.
