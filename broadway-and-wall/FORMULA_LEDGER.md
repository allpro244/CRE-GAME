# The formula ledger

The owner's standard (ONE_ECONOMY_PLAN.md §6c): **no aggregate is ever set directly.** Rents, prices, wages, vacancy, cap rates, growth and inflation must be sums or averages of what agents did. This file lists every place left where an equation, timer or dice roll sets a city-wide number. The count must fall to zero.

- **Agent decision rules are not on this list:** how one firm prices, how one household chooses. Those are behaviour, calibrated to micro data.
- **Calibrated facts are not on it either:** tax rates, fees, hard cost per sf.
- **Only aggregates set from the top are listed.**

When you remove one, move it to **Removed** with the PR. When you add a mechanism that sets an aggregate directly, it goes here, or it doesn't go in.

## Open

| # | What it sets | Where | Replaced by |
|---|---|---|---|
| 4 | "Natural" vacancy by class | `market.ts` `NATURAL_VAC` (~100 readers) | step 4: tenants shop, landlords price |
| 5 | City rent drift from vacancy gap | `market.ts` `rentDriftAt` | step 4 |
| 6 | Credit window (payroll growth, unemployment, noise) | `market.ts` / `lenders.ts` `creditIdx` | step 5: banks' appetite summed (in progress) |
| 7 | Trade boom/bust clock and `industryMom` | `market.ts` | step 2: industries from firms' orders (in progress) |
| 8 | Industry shock hazard (`IND_SHOCK_HAZ`) | `market.ts` | step 2 |
| 9 | Regional trend and pull | `market.ts` `regionTrend`, `regionalPull` | step 2: export base |
| 10 | Space demand drivers per commercial class (affordability band, retail Cobb–Douglas) | `market.ts` (`AFFORD_BAND`, `affordRaw`) | step 2 (firms' heads × sf/worker) |
| 14 | Migration and participation formulas | `market.ts` (around 4100) | step 3 / households stage 4 |
| 15 | Town wage index (closing toward a target) | `market.ts` `wageIdx` | §6c-D: firms post wages |
| 16 | Construction cost index (input index × bid premium) | `market.ts` `costIdx` | step 8: named contractors, materials from industries |
| 17 | Operating cost per sf per class | `value.ts` `opexPsf` | step 8: wages, energy, insurance |
| 18 | Swan hazards: capital wave, campus/HQ, embargo, migration | `blackswans.ts` (`*_HAZ`) | step 8: national swans random by design; HQ and industry swans from firms |
| 19 | 30% lowball letters of intent | `leasing.ts` (around 2292) | step 4: tenants bid from their own books and options |
| 20 | Opening tenant credit, rent and term dice on new rolls | `leasing.ts` `rollCredit` and roll generation | step 4 / step 2: tenants are real firms |
| 21 | Rival equity draws at founding (`initRivals`, `maybeNewFirm`: equity and leverage × random band) | `rivals.ts` | 6d-1: capital raised from savers' allocations |
| 22 | Anonymous part of each bank's loan book, and its delinquency formula | `lenders.ts` `anonDelinq` | step 5 (in progress) |
| 25 | A receiver's half-built frame: land + sunk cost × random band | `rivals.ts` `orphanToTape` | step 7b: builders bid the frame on cost to complete |
| 26 | Capital wave as a shift in every bidder's equity target | `blackswans.ts` → `propmarket.ts` `valueTo` | 6d-1: money chasing returns |

## Removed

| What it was | Replaced by | PR |
|---|---|---|
| Fiscal crisis on a random hazard (`FISCAL_HAZ`) | the city's own budget failing to roll its debt | city-gov (pending merge) |
| Phantom buyers: fixed institutions, anonymous bidders, out-of-town tape buyers | named firms on the Players list paying from their own books | #511 |
| Anonymous opening builders | builder firms from month 0 | #511 |
| Off-map jobs as a fixed share of town jobs (shadow) | each industry sized from its own demand | #515 (shadow) |
| Flats' demand: a household budget (minimum flat `HH_MIN`, fixed rent share) on the whole region's renter households, and the island-vs-mainland margin `locEff` (`LOC_ELAST` 0.5, five-year roll) — part of #10 | each renter household choosing an island flat or one across the water by rent, commute, pay and its own taste (`households.ts` `wantsIsland`); the flats' demand is the households that want one (`islandWant`), and the street's flats are let to the households that choose each block (the rolls are written from the register; `market.ts` reads `flatSpace` as it reads the firms' `streetSpace`) | households 2 |
| Apartment turnover `MF_TURNOVER` 45% (`leasing.ts`) and the street's renewals `0.22 + out + buy + jobs` (`streetRolls.ts`) — #11 | each island household deciding at its lease end: buy, choose the mainland at the renewal rent, leave town out of work, be evicted, end, or move for the CPS's other reasons (`households.ts`); the street and the player's flats read the rate they made | households 2 |
| Tenure index and the buying hazard moved by it (`tenureIdx`, `TENURE_PER_LOG`, `ownCostIdx`) — #12 | renters buying when they have the down payment and closing cash, a payment inside the front-end ratio on a starter home, and owning no dearer than their taste allows (`households.ts` `buyCheck`) | households 2 |
| New-home sales pace: households × national new-home rate × growth × affordability over the nation's (`homeprice.ts` `salesPace`) — #13 | the register's last twelve months of home buyers × new houses' share of purchases × the share of them who can carry this house | households 2 |
| City cap rate per class (`capTargetOf`: rate pass-through, vacancy beta, crunch term, sector, flows, the monthly walk and its noise; `capFlowsOf`, `CAP_VAC_BETA`, `retExp`) | the median implied cap of a year of closed deals between named bidders (`propmarket.ts` `tickCapRead`), widened to two or three years when the market is thin; a broker survey of the bidders' own numbers once a year for a class with no print | step 7 (`claude/property-market`) |
| Per-building cap spreads (location, quality, spec, reserve, product) | the appraiser's adjustment grid fitted to the prints (`econ.capFit`); bidders price reserves, re-letting capital and a product's buyer pool as cash flows and premia | step 7 |
| Cap-rate floor over the 10Y (`CAP_FLOOR_OVER_INDEX`, #502) | each bidder's own cost of capital: the desks' debt-yield and coverage tests cap leverage in cheap money | step 7 |
| Rival asks = value × random band (`rivalAsk`, fund-life, voluntary, grudge, duress `DURESS_BAND`, quiet-treaty price), lognormal tape bids around `capTarget`, a 0.88-0.96 private bid band, a 0.68-0.88 receiver recovery band | sellers' reservations from their own situation (`sellerTerms`: loan to clear, gains tax, value in use); bids from each firm's own underwriting (`bidRound`, `forcedSalePrice`) | step 7 |
| Register holders' (ghost) asks: appraisal × a random "denial" band and a distress band | a holder's anchor — the higher of today's appraisal and last year's (loss aversion); a distressed holder prices at the street's best bid (`anchoredAsk`, `forcedSalePrice`) | step 7 (property-market-2) |
| City land index (rent/cost residual × cycle × bidders' book, closing 4%/month) | lots go through bid rounds — builders bid their own residual (their margin, no queue wait), land bankers the holder's option (`propmarket.ts` `landMaxPrice`, `landBidRound`); the texture level is read only off land bankers' closed purchases of texture-governed lots (12/24/36-month median, five prints' weight or it stays where it was — `tickLandRead`). Open: the town lacks long-horizon land buyers; read off bids instead, the level fell 90% in 20 years | land-7b |
| Portfolio size discount (`sizeDiscount`: 2% + 1.6%/building to 18%, widened by shut credit) | package bids: firms with a three-year track record value the book deed by deed, bid alone, with a raise from the investor pool, or split it between two firms; the book clears at the best bid over the seller's floor (`propmarket.ts` `packageBids`) | land-7b |
