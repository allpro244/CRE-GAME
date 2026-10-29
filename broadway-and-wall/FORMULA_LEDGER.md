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
| 10 | Space demand drivers per commercial class (affordability band, retail Cobb–Douglas) | `market.ts` (`AFFORD_BAND`, `affordRaw`) | step 2 (firms' heads × sf/worker) |
| 14 | Migration and participation formulas | `market.ts` (around 4100) | step 3 / households stage 4 |
| 15 | Town wage index (closing toward a target) | `market.ts` `wageIdx` | §6c-D: firms post wages |
| 16 | Construction cost index (input index × bid premium) | `market.ts` `costIdx` | step 8: named contractors, materials from industries |
| 17 | Operating cost per sf per class | `value.ts` `opexPsf` | step 8: wages, energy, insurance |
| 18 | Swan hazards: capital wave, campus/HQ, embargo, migration | `blackswans.ts` (`*_HAZ`) | step 8: national swans random by design; HQ and industry swans from firms |
| 19 | 30% lowball letters of intent | `leasing.ts` (around 2292) | step 4: tenants bid from their own books and options |
| 20 | Opening tenant credit, rent and term dice on new rolls | `leasing.ts` `rollCredit` and roll generation | step 4 / step 2: tenants are real firms |
| 21 | Rival asking prices = value × random band; rival equity draws | `rivals.ts` | step 7: sellers' own reservation prices |
| 22 | Anonymous part of each bank's loan book, and its delinquency formula | `lenders.ts` `anonDelinq` | step 5 (in progress) |

## Removed

| What it was | Replaced by | PR |
|---|---|---|
| Fiscal crisis on a random hazard (`FISCAL_HAZ`) | the city's own budget failing to roll its debt | city-gov (pending merge) |
| Phantom buyers: fixed institutions, anonymous bidders, out-of-town tape buyers | named firms on the Players list paying from their own books | #511 |
| Anonymous opening builders | builder firms from month 0 | #511 |
| Off-map jobs as a fixed share of town jobs (shadow) | each industry sized from its own demand | #515 (shadow) |
| Flats' demand: a household budget (minimum flat `HH_MIN`, fixed rent share) on the whole region's renter households, and the island-vs-mainland margin `locEff` (`LOC_ELAST` 0.5, five-year roll) — part of #10 | each renter household choosing an island flat or one across the water by rent, commute, pay and its own taste (`households.ts` `wantsIsland`); the flats' demand is the households that want one (`islandWant`) | households 2 |
| Apartment turnover `MF_TURNOVER` 45% (`leasing.ts`) and the street's renewals `0.22 + out + buy + jobs` (`streetRolls.ts`) — #11 | each island household deciding at its lease end: buy, choose the mainland at the renewal rent, leave town out of work, be evicted, end, or move for the CPS's other reasons (`households.ts`); the street and the player's flats read the rate they made | households 2 |
| Tenure index and the buying hazard moved by it (`tenureIdx`, `TENURE_PER_LOG`, `ownCostIdx`) — #12 | renters buying when they have the down payment and closing cash, a payment inside the front-end ratio on a starter home, and owning no dearer than their taste allows (`households.ts` `buyCheck`) | households 2 |
| New-home sales pace: households × national new-home rate × growth × affordability over the nation's (`homeprice.ts` `salesPace`) — #13 | the register's last twelve months of home buyers × new houses' share of purchases × the share of them who can carry this house | households 2 |
