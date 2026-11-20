# Randomness & rails audit — 2026-11-20

The owner's rule (2026-11-20): *"no artificial numbers, no dice rolls, no caps,
no rails… a perfectly real simulation."* The standard is in `CLAUDE.md`
("Randomness: only at the boundary of the model").

Read-only auditors went over every random draw and every bound on an economic
quantity in `src/engine/`. They sorted each into EXOGENOUS (a genuine outside
shock: keep, and source it), PHYSICAL (a definition), GUARD (never binds), or
FAKE (a roll deciding what the model can compute, or a load-bearing bound,
asserted level or tuned constant). The first pass read a month-old checkout.
A second pass re-verified every row against **main at c75ef8b (#838)**. Full
tables, with file:line, status, reason and proposed mechanism, are in
`docs/randomness-audit/`.

| Table | Files | Open FAKE rows | Fixed on main since the first pass |
|---|---|---|---|
| `market.md` | market, regime, demand, absorption, growth, towngrowth, bands | 17 | 22 rows |
| `dev.md` | dev, value, landdev, zoning, plates, homes, roads, tax, platdesign, mix, comps | 30 | 13 rows |
| `leasing.md` | actions, leasing, streetRolls, notes, auction, offmarket, owners, tenantMarket | 61 | 40 rows |
| `rivals.md` | rivals, sim, blackswans, swans, privateCredit, lenders, debt, credit, portfolio(sale), investors, competitorTraits, workout, sponsor | 31 | 18 rows |
| `propmarket-economy.md` | propmarket, economy, households, plus draws and main bounds in 15 other files | 33 | (first pass) |

Counts are table rows, and one row can cover several lines. The auditors read
code; they did not run it. "Binds" means the code's comments or arithmetic
say so, until `tools/rails.mjs` measures it.

**Not yet covered** (economically important): proforma, facility, fund,
streetLoans, reputation, supply, industries, industryData, syndicate, raise,
waterfall, peers, loanbook, jv, leasehold, space, pricing, products, buybox,
capplan, books, standing. The full list, including plumbing and UI files, is
at the end of `propmarket-economy.md`.

## Fixed in this PR

- **Opening dearness** (`market.ts` `initEcon`). The seeded dearness draw
  (σ 0.20) and the per-class opening-q draw (σ 0.15) are gone. The opening
  Tobin's q is the town's own: `openingTobinQ`, from its vacant-land share.
  It is calibrated to Glaeser–Gyourko–Saks 2005 and Saiz 2010: q ≈ 1 where
  land is plentiful, about 1.8 at Metropolis build-out. q is struck at
  long-run cap rates, and the history's actual rates then move values, not
  rents. The price level (units only) stays a draw, `openingPriceLevel`.
  The change also stops the solver reading its own rent moves as developer
  momentum against a stale `rentExp`.

## Already fixed on main (found by the first pass, gone by the second)

- the 45% city-vacancy cap;
- construction starts as a share of stock × a die;
- the monthly land-index formula and its die;
- monthly rent and cap dice where the tape was thin;
- the street-lease rent noise;
- `bumpLand`'s ratchet;
- listed sellers' acceptance, now a floor plus a rival-bid test instead of a
  re-rolled probability;
- bank closure, now a regulatory rule instead of a roll;
- rival default losses, now settled loan by loan at a market forced-sale
  price.

## The pattern that remains

The model often already computes the answer, then decides the outcome with a
roll that ignores it:

- **Tenants:** counters, walks and renewals are each a fresh probability.
- **Off-market owners:** accept, counter and blind-bid by roll against a
  reserve that is already computed.
- **The player's letters:** TI and free rent are dice, while the street solves
  the same quantities from net effective rent (one quantity, two answers).

The fix each time: draw the private value once (*who* the counterparty is is
EXOGENOUS), then make the outcome a comparison against it.

## Fix queue (highest value first; one PR each)

Each PR must re-run `pnpm conserve` and `pnpm baseline:check`, compare against
a control on main, and say in the commit why the standing numbers moved.

1. **Land price is a label.** The texture floor, built on the generator's
   stamped price, overrides the builder's residual (`value.ts` ~1736, 1762,
   1818; `citygen/build.mjs` ~533). Land decay only runs where a builder
   would pay something (`comps.ts` ~466). `queueFactor` is 0 for a town with
   no sales history (`value.ts` ~1099). A variance multiplies land by 1.22
   (`zoning.ts` ~215). → The residual blended with land sales.
2. **Rivals: one cash pot and firm-wide death.** On a 20-month arrears clock
   every building goes back to the lenders (`rivals.ts` ~5011–5022,
   5554–5612). Opening firms have no uncalled capital and 6–16% cash (~1694).
   The reserve and payout constants are tuned (~5102, 5147). → Asset-level
   non-recourse SPVs, real commitments and reserves.
3. **TI and free rent on the player's letters are dice** (`leasing.ts`
   ~2433, 2443, 2028, 2162). → The street's net-effective rule, one answer.
4. **Tenant acceptance and renewal rolls** (`leasing.ts` ~1250–1299, 2069,
   4572–4600, 5270–5366). The renewal odds have six asserted factors and a
   0.10–0.96 clamp; two computed factors are never applied. → A stored
   reservation rent and a comparison.
5. **Off-market owner rolls** (`actions.ts` ~2244–2258, 2327, 2407–2423).
6. **Opening vacancy × d(0.88, 1.12), pinned 2–40%** (`regime.ts` ~211). The
   exact example in CLAUDE.md.
7. **The credit index's 0.4 floor plus a ±1.2-point monthly die**
   (`market.ts` ~1790).
8. **The looking-pool cap with a 25% bleed deletes excess demand**
   (`market.ts` ~4479). Also behind the flats-occupancy rail, which binds in
   ~26% of months on the reference town.
9. **Town-centre drift and noise picked for when the centre shows**
   (`demand.ts` ~163–261); the ±16 cap binds in long games.
10. **Households and firm-credit fakes** (`propmarket-economy.md`):
    - the job-fill rate is held fixed because the elastic version "ran away"
      (`households.ts` ~447);
    - the renewal rent floor of rent × 0.97 (~3755);
    - an in-migration form with a min(1) cap (~3144);
    - the firm credit gate is shut below a credit index of 0.5 (`economy.ts`
      ~1464);
    - an unsourced 10% shade on every sealed bid (`propmarket.ts` ~118);
    - a ±1.5pp valuation error in every bid (~307).
11. **Smaller items:**
    - the exit valves and build-to-suit arrivals on fixed asserted schedules;
    - the private-rescue arrears reduced by two months by assertion
      (`privateCredit.ts` ~342);
    - the 2.50 cap on `devPencils` that the opening solve skips on
      (dense-town flats).

## Keep (EXOGENOUS) — needs sourcing, not removal

National rate and inflation shocks, industry fortunes, black swans, which
firm or tenant turns up, and a firm's luck. Each should cite the real-world
distribution it is sized from. Several do not yet; see the EXOGENOUS rows in
each table.
