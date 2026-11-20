# Randomness & rails audit — 2026-11-20

The owner's rule (2026-11-20): *"no artificial numbers, no dice rolls, no caps,
no rails… a perfectly real simulation."* The standard is in `CLAUDE.md`
("Randomness: only at the boundary of the model").

Four read-only auditors covered every random draw and every bound on an
economic quantity in `src/engine/`. Their full tables, with file:line,
bucket, reason and proposed mechanism, are in `docs/randomness-audit/`:

| Area | Files | FAKE | EXOGENOUS | PHYSICAL | GUARD |
|---|---|---|---|---|---|
| Market core (`market.md`) | market, regime, demand, absorption, growth, towngrowth, bands | 32 | ~30 draw sites | ~25 | ~60 |
| Leasing & deals (`leasing.md`) | actions, leasing, streetRolls, notes, auction, offmarket, owners | 89 | 34 | 13 | 15 |
| Development & value (`dev.md`) | dev, value, landdev, zoning, plates, homes, roads, tax, platdesign, mix | 37 | 21 | 8 | 5 |
| Rivals & finance (`rivals.md`) | rivals, sim, blackswans, swans, privateCredit, lenders, debt, credit, portfolio(sale), investors, competitorTraits | 40 | 18 | 10 | 7 |

The counts are table rows, and one row can cover several lines. The auditors
read code; they did not run it. A bound marked "binds" is from the code's own
comments or from arithmetic until `tools/rails.mjs` measures it.

## Fixed

- **Opening dearness** (`market.ts` `initEcon`). The seeded "dearness" draw
  (σ 0.20) and the per-class opening-q draw (σ 0.15) are gone. The opening
  Tobin's q is now the town's: `openingTobinQ`, from its vacant-land share.
  It is calibrated to Glaeser–Gyourko–Saks 2005 and Saiz 2010: q ≈ 1 where
  land is plentiful, about 1.8 at Metropolis build-out. The fix also found
  and removed a bias that predates it. Every town had opened at about 0.68 of
  the q it was solved to, because the solver read its own rent moves as
  developer "momentum" (up to +45% optimism) against a stale `rentExp`, and
  the price level was applied after the solve.

## The pattern that keeps coming back

The model often *already computes* the answer, then decides the outcome with
a roll that ignores it:

- a tenant's indifference rent exists, but acceptance is a re-rolled logit;
- an owner's private price exists, but the bid outcome is a slope plus a
  roll;
- the best use of a lot is computed (`residualScheme`), but the use built is
  rolled;
- the street's lease rents carry a 0.94–1.03 uniform multiplier;
- rents and cap rates take a monthly die wherever the deal tape is thin.

The fix is the same each time: draw the private value once (who the
counterparty is, which is EXOGENOUS), then make the outcome a comparison
against it.

## Fix queue (highest value first)

Each item is one PR. Each must re-run `pnpm conserve` and
`pnpm baseline:check`, and say in the commit why the standing numbers moved.

1. **Land price is a label, not a residual.** A stamped texture floor wins
   on 59% of vacant lots (`value.ts` ~1563/1609). It ratchets up on every
   delivery (`bumpLand`, ×1.03–1.06; a variance adds ×1.22, counting the
   envelope twice) and only comes down through `holderCapitulation` (floor
   0.25). The land index itself is a hand-shaped rent/cost formula plus a
   ±0.3% monthly die (`market.ts` ~6912). → The residual blended with
   observed land sales.
2. **City vacancy capped at 45%** (`market.ts` ~5885, 5901). A glut past it
   reads a different vacancy from occupied ÷ stock. → Remove it; the glut
   curve already flattens past its fitted range (`DEEP_RATE`). Run stress on
   overbuild first.
3. **Street lease rent noise and random concessions** (`streetRolls.ts`
   ~619, 631; `leasing.ts` ~2346, 2356, 1931, 2060). They feed the rent index
   every month, and the 0.985 mean drags rents down. → A bargain between the
   firm's and the landlord's reservation rents, with net-effective
   concessions.
4. **Construction starts are a share of stock × a ±30% die** (`market.ts`
   ~5069, `catchUp` 4.5). → Starts from the sites that actually pencil
   (`sitePencil`), rationed by credit, each site with its own start hazard.
5. **Rivals die too easily** (`rivals.ts`). One cash pot per firm, and
   failure seizes every building, including loans that were current
   (~4924–4988). Opening firms have 6–16% of equity in cash and no recallable
   capital (~1569, 3589). The reserve and payout constants are tuned
   (~4559–4601). The credit line is resized to current income monthly
   (~3570). Banks are closed by a roll (`lenders.ts` ~1327). → Non-recourse
   asset-level debt, real reserves and commitments, and loan modification.
6. **Tenant/seller acceptance re-rolled every counter** (`leasing.ts`
   ~4441/5129, `actions.ts` ~585–640, 2359, 2416–2470). The player can fish
   for a yes. → A stored private value and a comparison.
7. **The sales tape's trade probability, an invented bidder, and a 0.92
   reserve** (`actions.ts` ~3851–3922). → Run the existing second-price
   auction on every listing with real qualifying firms.
8. **Monthly rent and cap dice where there is no tape** (`market.ts` ~6703,
   6857). → A tape for sheds and flats; appraisal smoothing with no die.
9. **Renewal intent on its 0.96 ceiling, and two expiry models**
   (`leasing.ts` ~1171–1237 vs `streetRolls.ts` ~331). → One expiry model;
   renewal rent as a split of the tenant's moving-cost saving.
10. **The credit window's 0.4 floor plus a die** (`market.ts` ~1949), and the
    looking-pool cap that deletes unmet demand (~5665).
11. **Smaller items:**
    - the opening vacancy jitter (`regime.ts` 188);
    - the use-by-roll and demolition-by-roll (`dev.ts` 3457, 4029, 4104, 4450);
    - developers' looks tied to standing stock (`dev.ts` 5272);
    - the rumour draw on the economy stream (`market.ts` 3653);
    - dead "rail" helpers kept alive with `void`;
    - the 2.50 cap on `devPencils` that the opening solve skips on (dense-town
      apartments);
    - the NPL notes on current loans (`notes.ts` ~603).

## Keep (EXOGENOUS) — needs sourcing, not removal

National rate and inflation shocks, industry fortunes, black swans, which
firm or tenant turns up, and a firm's luck. Each should cite the real-world
distribution it is sized from. Several do not yet; see the EXOGENOUS rows in
each table.
