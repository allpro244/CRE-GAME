# Probes (2026-11-10 economy run)

Single-purpose measurement scripts. Each takes the game directory as its first
argument (`$PWD` from `broadway-and-wall/`), then a seed and years, and reads
`test/.engine.mjs` (run `pnpm engine` first).

| script | measures |
|---|---|
| `wt.mjs DIR` | Wheaton-Torto slope (yearly Δlog real rent on last year's vacancy, years 6-60) per class, from a `tools/proof.mjs` OUT dir |
| `landcorr.mjs DIR...` | land's 5-year correlation with property, per seed, from proof OUT dirs |
| `mprobe2.mjs ROOT SEED YEARS [class]` | the landlords' months-to-let clock against vacancy, lettings, requirements entering the market, and the looking pool by kind; `wtp.py LOG` regresses rent change on same-year and last year's vacancy from its output |
| `vprobe2.mjs ROOT SEED Y1,Y2,..` | disclosed street listings: appraisal against the bidders' values, with the bidder's yield terms broken out |
| `pvprobe.mjs ROOT SEED YEAR` | the player's own buildings (bought cash at YEAR): appraisal against the street's bids |
| `aprobe.mjs ROOT SEED YEARS` | non-distressed listings: share carrying a seller's loss anchor and its size |
| `dark.mjs ROOT SEED YEARS` | street tenants going dark and leaving town, % of let feet a year, by class |
| `cprobe.mjs ROOT SEED YEARS` | construction and land-loan coupons over the index |
