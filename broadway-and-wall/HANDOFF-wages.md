# Handoff: firms set wages and prices (§6c-D), branch `claude/wages-prices`

## Done (merged with main through #529)
- `economy.ts` `postPayAndPrices` (called at the end of `tickEconomy`): each firm posts pay (`F.pay`, nominal,
  wage-index units) = the nation's path (`natWageIdx`) × its own premium, closing over `WAGE_GAP_HALF_M` toward
  `WAGE_CURVE`·ln(u_local/u_nat) + `V_SLOPE`·(its industry's unfilled openings) + `RENT_SHARE`·(margin − BEA gos).
  No nominal cuts; owed raises per firm (`F.owe`). Prices `F.price` (vs national) are sticky (hashU01, 1/9 a month),
  and set from unit cost (labour share × relative pay) × demand pressure (implied/emp)^`PRICE_DEMAND`.
- Within an industry, the payroll is split by `hc × pay` (`wagesOf`), so "one payroll" still holds.
- `economyToEngine` publishes `eco.wage`, `eco.payIdx[i]`, `eco.priceRel`, `eco.localShare`, and once a year
  writes a why event (`whyPay`: "wages up 2.9%: 147 openings, 4.4% unemployed").
- `market.ts` wage block: the old target/ECM/freeze/noise is deleted. `natWageIdx` is still updated there (the national
  model), and `wageIdx` = `eco.wage` (read a month on). Before the books open, it follows the national path.
- `market.ts` CPI: the `SERVICES_W`·(local pay − national pay) term is replaced by
  (1−SHELTER_W)·`localShare`·Δln `priceRel` (state `e.priceRelPrev`). Same change in `cpiXS`.
- `households.ts`: each earner's wage1/2/3 is indexed by its industry's `payIdx` growth (`r.payRef`).
- FORMULA_LEDGER: #15 and the CPI local-pay term are under Removed. rng-baseline market.ts rrange = 20 (note added).

## Checks on the merged tip
- Pass: tsc, households, why, worker-determinism, rng-discipline, rng-audit (after the bump), conserve (2,863 s).
- BASELINE.json: a regeneration was running when stopped. Re-run `node tools/baseline.mjs` and diff it against main.
- test/economy.mjs FAILS 3 checks; not yet known whether main (#528/#529) fails them too. Run it on origin/main first:
  1. links: the supplier's fortune moves +0.0 (expected about −29 log pts), although the loss event is written.
     Check that `eco.linkDz` survives to the next month's `tickTenantFin` (households-2 may rebuild `e.eco`).
  2. plant wire: the industrial gap is tiny or negative. 3. factory wire: near shops −0.5% vs far +0.5% (needs a 1pp gap).
  A scratch worktree of main is at scratchpad/economy2/wt-m2 (node_modules symlinked; `git worktree remove` it after).

## Findings and open items
- 30-year probe (seed 550991): pay/national stays 0.96–1.02 (stationary), and local `priceRel` stays near 1.00.
  CPI/national reaches 1.2 through shelter, so the town's real pay sits about 17% under the nation's: with the priceRatio
  wage term gone, nothing compensates for the cost of living. The candidate fix is reservation wages or migration
  responding to real pay. Firms' prices do not feed back into quantities, only into the CPI.
- `AGGLOM` remains only in `locationCost`; the size term in pay is gone. `types.ts` `wageDebt` was removed.
