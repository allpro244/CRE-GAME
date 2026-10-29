# The formula ledger

The owner's standard (ONE_ECONOMY_PLAN.md §6c): **no aggregate is ever set directly.** Rents, prices, wages, vacancy, cap rates, growth and inflation must be sums or averages of what agents did. This file lists every place left where an equation, timer or dice roll sets a city-wide number. The count must fall to zero.

- **Agent decision rules are not on this list:** how one firm prices, how one household chooses. Those are behaviour, calibrated to micro data.
- **Calibrated facts are not on it either:** tax rates, fees, hard cost per sf.
- **Only aggregates set from the top are listed.**

When you remove one, move it to **Removed** with the PR. When you add a mechanism that sets an aggregate directly, it goes here, or it doesn't go in.

## Open

| # | What it sets | Where | Replaced by |
|---|---|---|---|
| 4 | "Natural" vacancy, flats only: the flats' rent rule and the player's flat lettings read `MF_NATURAL_VAC` | `market.ts`, `leasing.ts` (flats) | households stage 2: households decide |
| 5 | Flats' rent drift from their vacancy gap (`vacTerm`, multifamily branch of the rent tick) | `market.ts` | households stage 2 |
| 6 | Credit window (payroll growth, unemployment, noise) | `market.ts` / `lenders.ts` `creditIdx` | step 5: banks' appetite summed (in progress) |
| 7 | Trade boom/bust clock and `industryMom` | `market.ts` | step 2: industries from firms' orders (in progress) |
| 8 | Industry shock hazard (`IND_SHOCK_HAZ`) | `market.ts` | step 2 |
| 9 | Regional trend and pull | `market.ts` `regionTrend`, `regionalPull` | step 2: export base |
| 10 | Space demand drivers per commercial class (affordability band, retail Cobb–Douglas), against the opening's occupied stock (`OPENING_VAC`, an initial condition). Office and shop firms form from industries' heads and sign from their own options (step 4); the aggregate still sizes off-map sheds, the rent response `demandAt.raw` and the sublet give-back | `market.ts` (`AFFORD_BAND`, `affordRaw`, `targetRaw`, `wantedNow`) | step 2 (firms' heads × sf/worker) |
| 14 | Migration and participation formulas | `market.ts` (around 4100) | step 3 / households stage 4 |
| 15 | Town wage index (closing toward a target) | `market.ts` `wageIdx` | §6c-D: firms post wages |
| 20 | The remaining term on an opening roll, and when it started (`buildRentRoll` age and expiry draws); the "three shapes" of an arriving party at the player's door (covenant +1, term ×1.35 / ×0.6) | `leasing.ts` | the town's pre-history (households stage 4 / step 9) |
| 21 | Rival equity draws at founding (`initRivals`, `maybeNewFirm`: equity and leverage × random band) | `rivals.ts` | 6d-1: capital raised from savers' allocations |
| 22 | Anonymous part of each bank's loan book, and its delinquency formula | `lenders.ts` `anonDelinq` | step 5 (in progress) |
| 24 | City land index (rent/cost residual × cycle × bidders' book, closing 4%/month) | `market.ts` `landIdx` | step 7: land read off closed lot sales and builders' residual bids |
| 25 | A receiver's half-built frame: land + sunk cost × random band | `rivals.ts` `orphanToTape` | step 7b: builders bid the frame on cost to complete |
| 26 | Capital wave as a shift in every bidder's equity target | `blackswans.ts` → `propmarket.ts` `valueTo` | 6d-1: money chasing returns |
| 27 | Portfolio size discount (2% + 1.6%/building to 18%, ×(1 + 1.5 × shut credit)) | `portfoliosale.ts` `sizeDiscount` | step 7b: the package clears at what the few firms that can fund the whole cheque bid — alone, with a fund raise, or as a JV — so the discount comes from how few can write it |

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
| "Natural" vacancy (`NATURAL_VAC`) as the rate office, shop and shed rents were pulled toward (#4), and its ~100 readers | Rents are the leases (step 4, `tenantMarket.ts`). Readers now read: the town's opening state → `OPENING_VAC` (initial condition only); "what this market usually runs at" (developers' market studies, appraisers' stabilised occupancy, the tour depth, cap-rate vacancy term, UI) → `normalVac`, the market's own record (learned availability, twenty-year memory); the frictional floor watcher → a third of that; the flats → `MF_NATURAL_VAC` (still open, #4) | step 4 (this branch) |
| City rent drift from the vacancy gap (`rentDriftAt`, and the office/shop/shed branch of `vacTerm` with its concession dial) (#5) | Each landlord posts a face rent and a package from its own leasing: package sweetened when its space sits past its patience (then the face cut), taken back when it lets at once (then the face raised), costs passed through, comps followed; firms take the building they rank first and bargain off the runner-up. The asking and effective indices, the concession level and the quality bands' rent swing are read off the last six months' new leases. Developers' rent outlook reads the comps' last-year trend (`rentTrend12`) | step 4 (this branch) |
| 30% lowball letters of intent (#19) | A firm touring the player's floors offers from its own options: the player's posted rent when it is the better deal, otherwise what leaves it as well off as its best street building (`offerForPlayer`); renewal letters the same, without the move | step 4 (this branch) |
| Opening tenant credit and rent dice; new firms' credit from the quality they shop for (#20) | A firm's covenant is its size (`creditOfSize`: where its floor sits in the class's requirement distribution, sized to the street's grade shares); an opening lease's rent and expense stop are today's taken back by expected inflation over its age, bumped since | step 4 (this branch) |
| Street tenants' moves at lease end on a fixed share (`MOVE_BASE`) plus trade-up / trade-down coin flips | The firm shops its renewal against a broker's shortlist (rent, quality fit, distance to its named partners and island staff, a shop's walk-ins, moving cost, a logit taste calibrated to lease-expiry retention) | step 4 (this branch) |
| Flats' demand: a household budget (minimum flat `HH_MIN`, fixed rent share) on the whole region's renter households, and the island-vs-mainland margin `locEff` (`LOC_ELAST` 0.5, five-year roll) — part of #10 | each renter household choosing an island flat or one across the water by rent, commute, pay and its own taste (`households.ts` `wantsIsland`); the flats' demand is the households that want one (`islandWant`), and the street's flats are let to the households that choose each block (the rolls are written from the register; `market.ts` reads `flatSpace` as it reads the firms' `streetSpace`) | households 2 |
| Apartment turnover `MF_TURNOVER` 45% (`leasing.ts`) and the street's renewals `0.22 + out + buy + jobs` (`streetRolls.ts`) — #11 | each island household deciding at its lease end: buy, choose the mainland at the renewal rent, leave town out of work, be evicted, end, or move for the CPS's other reasons (`households.ts`); the street and the player's flats read the rate they made | households 2 |
| Tenure index and the buying hazard moved by it (`tenureIdx`, `TENURE_PER_LOG`, `ownCostIdx`) — #12 | renters buying when they have the down payment and closing cash, a payment inside the front-end ratio on a starter home, and owning no dearer than their taste allows (`households.ts` `buyCheck`) | households 2 |
| New-home sales pace: households × national new-home rate × growth × affordability over the nation's (`homeprice.ts` `salesPace`) — #13 | the register's last twelve months of home buyers × new houses' share of purchases × the share of them who can carry this house | households 2 |
| City cap rate per class (`capTargetOf`: rate pass-through, vacancy beta, crunch term, sector, flows, the monthly walk and its noise; `capFlowsOf`, `CAP_VAC_BETA`, `retExp`) | the median implied cap of a year of closed deals between named bidders (`propmarket.ts` `tickCapRead`), widened to two or three years when the market is thin; a broker survey of the bidders' own numbers once a year for a class with no print | step 7 (`claude/property-market`) |
| Per-building cap spreads (location, quality, spec, reserve, product) | the appraiser's adjustment grid fitted to the prints (`econ.capFit`); bidders price reserves, re-letting capital and a product's buyer pool as cash flows and premia | step 7 |
| Cap-rate floor over the 10Y (`CAP_FLOOR_OVER_INDEX`, #502) | each bidder's own cost of capital: the desks' debt-yield and coverage tests cap leverage in cheap money | step 7 |
| Rival asks = value × random band (`rivalAsk`, fund-life, voluntary, grudge, duress `DURESS_BAND`, quiet-treaty price), lognormal tape bids around `capTarget`, a 0.88-0.96 private bid band, a 0.68-0.88 receiver recovery band | sellers' reservations from their own situation (`sellerTerms`: loan to clear, gains tax, value in use); bids from each firm's own underwriting (`bidRound`, `forcedSalePrice`) | step 7 |
| Register holders' (ghost) asks: appraisal × a random "denial" band and a distress band | a holder's anchor — the higher of today's appraisal and last year's (loss aversion); a distressed holder prices at the street's best bid (`anchoredAsk`, `forcedSalePrice`) | step 7 (property-market-2) |
