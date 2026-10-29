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
| 4 | "Natural" vacancy, flats only: the flats' rent rule and the player's flat lettings read `MF_NATURAL_VAC` | `market.ts`, `leasing.ts` (flats) | households stage 2: households decide |
| 5 | Flats' rent drift from their vacancy gap (`vacTerm`, multifamily branch of the rent tick) | `market.ts` | households stage 2 |
| 6 | Credit window (payroll growth, unemployment, noise) | `market.ts` / `lenders.ts` `creditIdx` | step 5: banks' appetite summed (in progress) |
| 7 | Trade boom/bust clock and `industryMom` | `market.ts` | step 2: industries from firms' orders (in progress) |
| 8 | Industry shock hazard (`IND_SHOCK_HAZ`) | `market.ts` | step 2 |
| 9 | Regional trend and pull | `market.ts` `regionTrend`, `regionalPull` | step 2: export base |
| 10 | Space demand drivers per class (affordability band, `hhCredit`, retail Cobb–Douglas), against the opening's occupied stock (`OPENING_VAC`, an initial condition). Office and shop firms now form from industries' heads (streetRolls.ts) and sign from their own options; the aggregate still sizes off-map sheds, the rent response `demandAt.raw` and the sublet give-back | `market.ts` (`AFFORD_BAND`, `targetRaw`, `wantedNow`) | step 2 (firms' heads × sf/worker) and households stage 2 |
| 11 | Apartment turnover rate | `leasing.ts` `MF_TURNOVER` | households stage 2: households decide |
| 12 | Tenure (own vs rent) index | `market.ts` / `households.ts` `tenureIdx` | households stage 4 |
| 13 | New-home sales pace (affordability to the 4th power) | `homeprice.ts` `salesPace` | households stage 4: qualified buyers |
| 14 | Migration and participation formulas | `market.ts` (around 4100) | step 3 / households stage 4 |
| 15 | Town wage index (closing toward a target) | `market.ts` `wageIdx` | §6c-D: firms post wages |
| 16 | Construction cost index (input index × bid premium) | `market.ts` `costIdx` | step 8: named contractors, materials from industries |
| 17 | Operating cost per sf per class | `value.ts` `opexPsf` | step 8: wages, energy, insurance |
| 18 | Swan hazards: capital wave, campus/HQ, embargo, migration | `blackswans.ts` (`*_HAZ`) | step 8: national swans random by design; HQ and industry swans from firms |
| 20 | The remaining term on an opening roll, and when it started (`buildRentRoll` age and expiry draws); the "three shapes" of an arriving party at the player's door (covenant +1, term ×1.35 / ×0.6) | `leasing.ts` | the town's pre-history (households stage 4 / step 9) |
| 21 | Rival asking prices = value × random band; rival equity draws | `rivals.ts` | step 7: sellers' own reservation prices |
| 22 | Anonymous part of each bank's loan book, and its delinquency formula | `lenders.ts` `anonDelinq` | step 5 (in progress) |

## Removed

| What it was | Replaced by | PR |
|---|---|---|
| Fiscal crisis on a random hazard (`FISCAL_HAZ`) | the city's own budget failing to roll its debt | city-gov (pending merge) |
| Phantom buyers: fixed institutions, anonymous bidders, out-of-town tape buyers | named firms on the Players list paying from their own books | #511 |
| Anonymous opening builders | builder firms from month 0 | #511 |
| Off-map jobs as a fixed share of town jobs (shadow) | each industry sized from its own demand | #515 (shadow) |
| "Natural" vacancy (`NATURAL_VAC`) as the rate office, shop and shed rents were pulled toward (#4), and its ~100 readers | Rents are the leases (step 4, `tenantMarket.ts`). Readers now read: the town's opening state → `OPENING_VAC` (initial condition only); "what this market usually runs at" (developers' market studies, appraisers' stabilised occupancy, the tour depth, cap-rate vacancy term, UI) → `normalVac`, the market's own record (learned availability, twenty-year memory); the frictional floor watcher → a third of that; the flats → `MF_NATURAL_VAC` (still open, #4) | step 4 (this branch) |
| City rent drift from the vacancy gap (`rentDriftAt`, and the office/shop/shed branch of `vacTerm` with its concession dial) (#5) | Each landlord posts a face rent and a package from its own leasing: package sweetened when its space sits past its patience (then the face cut), taken back when it lets at once (then the face raised), costs passed through, comps followed; firms take the building they rank first and bargain off the runner-up. The asking and effective indices, the concession level and the quality bands' rent swing are read off the last six months' new leases. Developers' rent outlook reads the comps' last-year trend (`rentTrend12`) | step 4 (this branch) |
| 30% lowball letters of intent (#19) | A firm touring the player's floors offers from its own options: the player's posted rent when it is the better deal, otherwise what leaves it as well off as its best street building (`offerForPlayer`); renewal letters the same, without the move | step 4 (this branch) |
| Opening tenant credit and rent dice; new firms' credit from the quality they shop for (#20) | A firm's covenant is its size (`creditOfSize`: where its floor sits in the class's requirement distribution, sized to the street's grade shares); an opening lease's rent and expense stop are today's taken back by expected inflation over its age, bumped since | step 4 (this branch) |
| Street tenants' moves at lease end on a fixed share (`MOVE_BASE`) plus trade-up / trade-down coin flips | The firm shops its renewal against a broker's shortlist (rent, quality fit, distance to its named partners and island staff, a shop's walk-ins, moving cost, a logit taste calibrated to lease-expiry retention) | step 4 (this branch) |
