# Why? coverage — every number that moves, and whether it can say why

The cause ledger is `src/engine/why.ts` (ONE_ECONOMY_PLAN §6e). The button is
`src/ui/WhyChain.tsx` (`WhyButton`, optional `lead` line). The market-wide reads
are written by `src/engine/whyReads.ts` (`noteReads`, once a month after the
month settles) and pointed at by named marks (`whyMark` / `whyAt`); the screens
look them up through `src/ui/whyLinks.ts`.

Status: **yes** = written by the engine and shown with a Why? on the screen ·
**engine** = written, not yet beside the number · **no** = not written.

## Market-wide numbers

| Number (screen) | Event · mark | Caused by | Status |
|---|---|---|---|
| Office/retail/industrial asking rent (Markets class detail · property panel Market rent) | `market.rent` · `rent:<class>` (market.ts, where the leases are read) | the class's availability, the nation | yes |
| Apartment rent (same) | `market.rent` · `rent:multifamily` (whyReads, ≥1% move) | availability, the town's month, the nation | yes |
| Availability / vacancy (Markets class detail, Vacant space) | `market.vacancy` · `vac:<class>` (≥0.5 pt or yearly) | the town's month (jobs, spending), the nation; text carries deliveries and pipeline | yes |
| Cap rate (Markets class detail, Cap rate row · property Appraisal lead) | `market.cap` · `capRead[k].why` (propmarket.ts) | the class's recent trades, the nation | yes |
| Land index (Markets › Land) | `land.month` · `land` (≥3% or yearly) | office rent vs build cost (bigger mover first), builders' book | yes |
| Construction cost (Markets › City · Build desk Cost) | `construction.cost` · `cost` (≥2% or yearly) | materials and pay, or the contractors' markup (bigger first) → `construction.month` | yes |
| Pay in town (Markets › City) | `city.pay` · `wage` (≥1.5% or yearly) | the town's month, the nation | yes |
| Base rate (Markets › City · loan coupons) | `rate.base` · `rate` (≥0.25 pt or yearly) | the nation (policy rate) | yes |
| City Hall taxes (Markets › City · property Property tax / yr) | `city.budget` · `tax` (when a rate changes); `city.crisis`; `city.election` · `city:mayor` | the mayor's election, the town, the nation | yes |
| Industry month (Rent rests on … under a building) | `industry.month` (economy.ts `whyIndustry`), cited once a quarter for every industry with a tenant in your buildings | the nation's purchases or the town's month | yes |
| Households' spending (Rent rests on … households) | `town.month` | export industries, the nation | yes |
| Bank loan pricing (Acquire › Coupon · Refi › Lender) | `bank.widen` / `bank.sharpen` (lenders.ts, `pitchWhy`); else `rate.base` | its losses, funding, rationing, competition | yes |
| Bank failures, charge-offs, appetite | `bank.failed`, `bank.chargeoff`, `bank.appetite` | loan defaults, the nation | yes (News/Pulse) |
| Swans: embargo, arrivals, foreign capital, panic | `swan.*` (blackswans.ts) | the nation | yes (News) |
| Contractor awarded / failed / entered | `contractor.*` | `construction.month` | yes (News) |
| Insurance loss year | `insurance.lossyear` | the nation | engine (News only; no premium line carries it) |
| Home prices, house values, SFR rent | — (homeprice.ts / homes.ts) | — | no — households.ts is in other hands |
| Per-parcel land $/sf (property Land value) | parcel reads the land index (land code in propmarket.ts) | — | partial: Cleared land value row cites `land`; the parcel's own comps are not written (land market work in progress) |

## Your buildings

| Number (screen) | Event | Status |
|---|---|---|
| Appraisal (property header tile, map card Appraisal) | lead: value, NOI, yield on value, class cap → `market.cap` | yes |
| Market rent (property panel, per use) | lead: here = class rent × building factor → `market.rent` | yes |
| Property tax / yr (property panel) | lead: bill at the city's rate → `city.budget` | yes |
| A tenant leaving / going dark / downsizing / moving | `tenant.left`, `tenant.dark`, `tenant.downsized`, `tenant.moved` → `tenant.books` → industry → nation | yes (News, Pulse, Leasing) |
| Lease expiry roll | `building.rollover` | yes (News) |
| Households moving out of your flats | `household.*`, `flats.out` | yes (Leasing) |
| Loan default (rival, street) | `loan.default` | yes (News) |
| NOI, occupancy | follow from the tenant events above; no single NOI event | partial |
| Renewal odds (rent roll) | computed for the screen (`renewalIntent`), not a ledger event | no |
| Construction loan quotes (Build desk lenders) | — | no (desk pitchWhy could be wired the same way as Acquire) |
| Assessed value / tax appeal | — | no |

## Rules kept

- Ledger writes only: `noteReads` draws no random number and changes nothing
  outside `s.why` (test/why.mjs §3b checks both); the baseline does not move.
- Bounded: each read is written only when it moves past its step (or once a
  year), so a run writes a few dozen of these a year.
- Text only on screen: the existing `WhyButton`, beside the label; numbers first.
