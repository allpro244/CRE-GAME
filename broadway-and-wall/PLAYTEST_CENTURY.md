# Broadway & Wall — Century Playtest

*A hundred years of somebody else's city, run 198 times.*

## Sample

| Experiment | Harness | Runs | Horizon |
|---|---|---|---|
| Economy observer (no player) | `tools/pt-econ.mjs` | 36 (20 × `city`, 4 each × `hamlet`/`town`/`metro`/`giant`) | 1,200 months |
| Strategy tournament | `tools/pt-strat.mjs` | 162 = 9 strategies × 18 city seeds | 1,200 months |
| Refi desk probe | `tools/pt-refi.mjs` | 1 run + a 56-quote direct test | 600 months |

Driver: `tools/pt-drive.mjs` (4 workers). Analysis: `tools/pt-an-econ.mjs`,
`tools/pt-an-strat.mjs`, `tools/pt-stories.mjs`. Engine rebuilt with
`pnpm engine` before every batch (898.6 kb bundle); no harness ran against a
stale one.

Seeds are `citySeed` 1001–1020, `marketSeed = citySeed × 7 + 13`, so the
economy a strategy faced on seed *N* is bit-identical to the observer run on
seed *N*. Every strategy ran against every seed.

Two conventions, both from CLAUDE.md, and both of which change the answers:

- **Everything is CPI-deflated.** Median CPI at year 100 is **14.3×**. A
  nominal terminal number is mostly a measure of inflation, not of skill.
- **Cyclical quantities are decade means, never a snapshot.** Vacancy, cap
  rates and rents are read as 10-year windows; only stocks are read at the end.

The observer resurrects on `gameOver` (131 resurrections over 36 runs) because
its subject is the world. The tournament does **not** resurrect — a dead run
ends and reports the month it died, because averaging a corpse's post-mortem
century into a wealth distribution is how a bankruptcy rate becomes invisible.

---

*(sections below filled from the completed batches)*
