# Tenant tiers — a tiered space market per asset class

Owner request (2026-10-15): "a realistic set of tenants for each asset class —
some want prime space and are willing to pay for it, some want mediocre, some
want the cheapest. That should be a basic implant of the leasing system."
Chosen scope: the FULL tiered market, not a leasing-desk veneer.

## Revised (owner, 2026-10-15): a scale, not tiers

"I don't want tenants to be in hard coded tiers (A, B, C), more of a scale of
1-100 ... buildings can have an overall score that includes the land they sit
on, then tenants can fight or look for the best space possible within their
budget." And: a $20 mid tenant who sees prime space come down near what it
pays "might consider a cheap upgrade or want the cheaper mediocre space —
obviously this should be a scale."

## The score

`overallScore` (value.ts), 1-100: the address (`demandScore`) blended with the
building (`buildingScore`: bones, condition, age against the city's stock).
Location weight by class: retail 0.65, office 0.5, flats 0.5, industrial 0.35.

## The tenant

Every tenant shops for a quality on the same scale and weighs it against
rent (`moveOdds`, bands.ts): a point of quality is worth ~0.8% of rent
(QUALITY_VALUE), and the decision is a logistic over the difference between
what better space is worth and what it costs. A $20 tenant offered space thirty
points better at $21 takes it almost every time; at $30, almost never.

Letters carry the tenant's `quality`; term, fit-out, credit and the rent offer
scale with it and with how far the tenant is stretching up or settling down.

## The market (bands.ts)

The street's stock — every building the player does not own — is kept in ten
ten-point bands of the score (bookkeeping only; every reader interpolates):
stock, occupied, the band's static rent premium measured off its buildings,
and the market's swing on it. Monthly: re-measured stock carries its tenants,
net absorption in by room and out from the bottom, MOVERS (the class's gross
relocation rate) spread across every empty floor — street and player — by
their move odds, and each band's rent swings with its own vacancy gap.

Readers: `useOccupancy` (every building the player does not own) reads the
vacancy at its score; rent carries the swing at its score; the player's
leasing odds scale by how many movers its score-at-its-rent draws per empty
foot (`scoreDraw`); the Economy page shows the table.

## Superseded: the three-tier draft below
## Tiers

Every class carries three tiers of space and three tiers of tenant.

| tier  | space (building grade)     | office tenants            | flats            | retail            | industrial            |
|-------|----------------------------|---------------------------|------------------|-------------------|-----------------------|
| prime | Trophy / A                 | law, finance, HQs         | luxury           | flagship          | modern logistics      |
| mid   | B                          | the ordinary firm         | market-rate      | neighbourhood     | standard warehouse    |
| value | C                          | price-first, weak credit  | workforce        | discount          | older flex / storage  |

A building's tier IS its grade (`buildingScore` → `buildingGrade`): spec,
condition, and age against the city's own stock. It moves when the building
ages, when better space delivers around it, and when the owner renovates.

## The market by tier (econ.tiers[class])

- stock, occupied, vacancy per tier; `stock` sums to `econ.stock[class]`,
  `occupied` to `econ.occupied[class]`. The aggregate market (pool,
  absorption, the class rent index) is unchanged: tiers DISTRIBUTE it.
- Stock moves: deliveries enter at their own grade (new is mostly A);
  buildings age down a tier (A→B, B→C) at the rate competitiveness and
  condition decay imply; demolitions come out of C first.
- Occupancy moves:
  - net absorption in: to tiers by tenant-demand share and room;
  - net absorption out: weighted to C (weak credits fail first, consolidations
    leave the worst space);
  - TRADE-UP: when a higher tier is soft, tenants in the tier below move up
    (this replaces the class-wide trade-up flow of 2026-10-15);
  - SETTLING: when a higher tier is full, its overflow takes the tier below.
- Rent: each tier carries a dynamic multiplier around the static
  spec/condition premium. Spreads widen when prime is tight and compress in a
  glut (prime comes down to where mid tenants can afford it). Normalised so
  the occupied-weighted mean is the class index.

## What reads it

- `useOccupancy` (every building the player does not own, rival books):
  the street vacancy of the building's own tier, not the class.
- Rent for a building: class index × location × plate × condition × spec ×
  the tier's multiplier.
- Leasing desk: every letter carries a tenant tier. A tenant tours its own
  tier first and spills to the next one when that tier is tight or when the
  tier above is cheap. Tier sets rent appetite, concessions, term and credit.
- Economy page: a tier table per class (stock, vacancy, rent) — a small hook.

## Rounds

1. Engine: econ.tiers, init from the parcel table, monthly flows, tier rent
   multipliers, useOccupancy and rent read them. Measure: glut test (new A
   fills from B/C, vacancy lands on C), a tight market (C fills last-to-empty),
   60-year rents still tame.
2. Leasing desk: tenant tier on every letter; tier-specific flows replace the
   class-wide trade-up; rent appetite / term / credit by tier.
3. UI hooks: tier table on the Economy page, tier on letters and the building
   panel.
