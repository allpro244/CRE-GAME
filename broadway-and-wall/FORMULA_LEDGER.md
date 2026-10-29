# The formula ledger

The owner's standard (ONE_ECONOMY_PLAN.md §6c): **no aggregate is ever set directly.** Rents, prices, wages, vacancy, cap rates, growth and inflation must be sums or averages of what agents did. This file lists every place left where an equation, timer or dice roll sets a city-wide number. The count must fall to zero.

- **Agent decision rules are not on this list:** how one firm prices, how one household chooses. Those are behaviour, calibrated to micro data.
- **Calibrated facts are not on it either:** tax rates, fees, hard cost per sf.
- **Only aggregates set from the top are listed.**

When you remove one, move it to **Removed** with the PR. When you add a mechanism that sets an aggregate directly, it goes here, or it doesn't go in.

## Open

| # | What it sets | Where | Replaced by |
|---|---|---|---|
| 1 | City cap rate per class (rate pass-through, vacancy beta, crunch term) | `market.ts` `capTargetOf` | step 7: closed deals between named bidders |
| 2 | Per-building cap spreads (location, quality, spec, reserve, product) | `value.ts` `capRateFor` | step 7 |
| 3 | Cap-rate floor over the 10Y (`CAP_FLOOR_OVER_INDEX`, #502) | `value.ts` | step 7 (buyers' own cost of capital) |
| 4 | "Natural" vacancy by class | `market.ts` `NATURAL_VAC` (~100 readers) | step 4: tenants shop, landlords price |
| 5 | City rent drift from vacancy gap | `market.ts` `rentDriftAt` | step 4 |
| 6 | Credit window (payroll growth, unemployment, noise) | `market.ts` / `lenders.ts` `creditIdx` | step 5: banks' appetite summed (in progress) |
| 7 | Trade boom/bust clock and `industryMom` | `market.ts` | step 2: industries from firms' orders (in progress) |
| 8 | Industry shock hazard (`IND_SHOCK_HAZ`) | `market.ts` | step 2 |
| 9 | Regional trend and pull | `market.ts` `regionTrend`, `regionalPull` | step 2: export base |
| 10 | Space demand drivers per class (affordability band, `hhCredit`, retail Cobb–Douglas) | `market.ts` (`AFFORD_BAND`, around 5640) | step 2 (firms' heads × sf/worker) and households stage 2 |
| 11 | Apartment turnover rate | `leasing.ts` `MF_TURNOVER` | households stage 2: households decide |
| 12 | Tenure (own vs rent) index | `market.ts` / `households.ts` `tenureIdx` | households stage 4 |
| 13 | New-home sales pace (affordability to the 4th power) | `homeprice.ts` `salesPace` | households stage 4: qualified buyers |
| 14 | Migration and participation formulas | `market.ts` (around 4100) | step 3 / households stage 4 |
| 15 | Town wage index (closing toward a target) | `market.ts` `wageIdx` | §6c-D: firms post wages |
| 19 | 30% lowball letters of intent | `leasing.ts` (around 2292) | step 4: tenants bid from their own books and options |
| 20 | Opening tenant credit, rent and term dice on new rolls | `leasing.ts` `rollCredit` and roll generation | step 4 / step 2: tenants are real firms |
| 21 | Rival asking prices = value × random band; rival equity draws | `rivals.ts` | step 7: sellers' own reservation prices |
| 22 | Anonymous part of each bank's loan book, and its delinquency formula | `lenders.ts` `anonDelinq` | step 5 (in progress) |

## Allowed exogenous inputs

Not aggregates the city sets, so not on the list: the rest of the world's draws, which the city is too small to move.

- **National swans are random by design** (`blackswans.ts`): the embargo, the capital wave, the arrivals, the pandemic, the war, the foreign crisis, the tech boom and the trade war, at hazards read off the record. Each reaches the city only through the national model, the oil price and the trades' orders, never as a rent.
- **Nature's loss years for insurers** (`inputs.ts`, one in four, hashed from the seed and the year).

## Removed

| What it was | Replaced by | PR |
|---|---|---|
| Construction cost index as inputs × a bid premium set from crew utilisation (was #16) | named general contractors bidding every job from their own books; the index is the average winning bid; materials read the nation's prices and oil (`contractors.ts`) | cleanup-8a |
| Operating cost per sf per class × the construction cost index (was #17) | labour at the town's wage, energy at the nation's prices and oil, repairs at the cost index, insurance at replacement cost × a capital-driven hard/soft market (`value.ts` `OPEX_MIX`, `inputs.ts`) | cleanup-8a |
| Swan hazards (was #18): `CAMPUS_HAZ` and the embargo's hand-written materials jump | an anchor employer choosing the city (and leaving it) on its pay, rents and taxes against other cities; the embargo reaches building costs through oil. National swans stay random by design (above) | cleanup-8a |
| Fiscal crisis on a random hazard (`FISCAL_HAZ`) | the city's own budget failing to roll its debt | city-gov (pending merge) |
| Phantom buyers: fixed institutions, anonymous bidders, out-of-town tape buyers | named firms on the Players list paying from their own books | #511 |
| Anonymous opening builders | builder firms from month 0 | #511 |
| Off-map jobs as a fixed share of town jobs (shadow) | each industry sized from its own demand | #515 (shadow) |
