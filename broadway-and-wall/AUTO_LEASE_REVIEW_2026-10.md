# Auto-lease review — October 2026

The owner's report: *"It's frustrating seeing huge TI packages and bad deals
done by your team. When you own 200 properties you want peace of mind that
your team is signing market leases without giving a bunch of free rent or TI —
while still keeping some control over what deals are signed and how aggressive
you want to be."*

Taken as a hypothesis and measured. Instrument:
`tools/mdga/auto-lease-audit.mjs` (gifted book, every building on auto,
letters captured *before* the desk answers so each signing is scored on the
space the tenant toured; `ENGINE=path` runs an older bundle for before/after).

## What was wrong

1. **The team scored fit-out at the tenant's price.** `loiMandateScore` (the
   landlord's net effective, which every desk decides on) charged a dollar of
   allowance at `TI_VALUE = 0.75` — the *tenant's* valuation. So every desk
   believed a $40/sf allowance cost the owner $30, and the error always ran
   toward the fat package. Fake number #3: one quantity, two answers, and the
   wrong one on the side that writes the cheque. Now `LANDLORD_TI_COST = 1`;
   `TI_VALUE` stays on the tenant's side of the negotiation.
2. **Fit-out had no limit by default.** A building put on auto (and every
   building the player develops is put on auto at delivery) started on "No
   cap". The only control was a per-building number in $/sf per year of lease
   term, with presets read off one use's band, set one deed at a time.
3. **Free rent had no limit at all.**
4. **The counter stopped short and nothing checked it.** `autoCounterRent`
   raised rent at most 35% over the bid, and a tenant who *took* that counter
   was signed without re-checking the policy. So a lowball at 40% of market
   could be countered to 54%, accepted, and signed under a Push building's
   100% floor. Real but rare in measured play, because most bids sit within
   35% of a market deal. A counter far over the bid is answered by the
   tenant's own logistic; the cap was a second, wrong answer.
5. **No scorecard.** The quarterly digest only shows while a firm agent holds
   the pen. Auto-lease reported only through the news feed, one line per
   letter, so with 200 buildings there was no way to tell whether the team
   was doing well.
6. **The news line contradicted the mode.** Every letter on an auto building
   also posted "LOI in at … — check the Deals desk", pointing the owner at a
   desk the letter never reaches.

## What changed

- **One firm-wide concession limit** (`GameState.autoConcessions`, shown on
  the Leasing page) instead of a per-building $/sf/yr cap:
  - *Lean*: the typical fit-out and free rent for the space, or less.
  - *Market* (default): anything inside the range the market asks.
  - *Generous*: whatever the tenant asks, priced through net effective (the
    old behaviour).

  It is measured against `streetPackage`, the street's own package for *the
  letter in hand*. That package is built by the same rules that roll the
  letters (term, covenant, cost index, concession market, first-generation
  shell, renewal refresh share), so it follows the cycle and new delivery
  without the player retyping anything. Letters over the limit get one
  counter: the package trimmed to the limit and the rent raised to the
  target. Legacy per-building caps still bind, and the building panel shows
  them with a Clear button.
- **The rent posture stays per building** (Fill / Market / Push), because how
  hard to hold is a question about one building's lease-up. So the player
  has two controls: rent posture per building, concessions for the firm.
- **The counter asks for the whole target**, and every path to a signature
  goes through the policy check.
- **`marketDealShare` reads `streetPackage`**, so the yardstick and the limit
  are one quantity. Renewals are now measured against a renewal's package
  (the refresh allowance, one to three months free) instead of a new deal's
  full fit-out.
- **Team scorecard** on the Leasing page, covering the last 12 months:
  signed, average % of a market deal, % of market rent after concessions,
  how many came in under 90% of a market deal, passed, walked, and sent to
  you. Each signing's news line now ends with "nets N% of a market deal".
- The "check the Deals desk" line is skipped on auto buildings.

## Measured, before → after

Seed 550991, 295 newly delivered shells (3M sf), every building on auto,
four years (`node tools/mdga/auto-lease-audit.mjs`; "owner NE" levelises
rent after free months and bumps, minus the whole allowance, at 7%):

| posture | owner NE (sf-wtd) | deals < 80% of market | TI p90 (years of rent) | mean vacancy |
|---|---|---|---|---|
| Market | 84% → 87% | 26% → 15% | 0.88 → 0.73 | 37% → 39% |
| Push   | 88% → 92% | 15% → 8%  | 0.64 → 0.62 | 38% → 40% |
| Fill   | 76% → 76% | 60% → 60% | 0.92 → 0.92 | 37% → 37% |
| Market + Lean | — → 87% | — → 13% | — → 0.67 | — → 37% |

The cost is honest: more letters get countered and some tenants walk, so
vacancy runs a point or two higher on Market and Push. Fill is unchanged by
design: it signs whatever rent comes.

## Follow-up: fit-out capped by the rent (`tiBandPsfYr`)

**The fault.** `TI_ASK` is a $/sf-per-year band (office $2.60–6.00) times
the cost index, whatever the space lets for. Its own comment calls it
"roughly 6–7% of lease value", which only holds near the rents it was
measured at (`RENT_BASE`). Office fit-out asks per year of term, as a share
of the space's own rent (`tools/mdga/ti-vs-rent.mjs`):

| | cheapest tenth | median | priciest tenth |
|---|---|---|---|
| month 12, before | 37% | 23% | 16% |
| month 12, after | 15% | 15% | 12% |
| month 600, before | 76% | 31% | 16% |
| month 600, after | 10% | 9% | 4% |

**The change.** The band is capped at itself read as a share of the
space's face rent: `TI_ASK / RENT_BASE`, so office 7–17% and retail and
industrial 4–11% a year. It is a cap, not a re-pricing: it never raises an
ask, and it leaves any space at or above the base rents exactly as it was.
Every reader of the band in `leasing.ts` goes through it: new, expansion
and renewal letters, the street package, the renewal refresh and the
rollover reserve. **Deliberately not touched:** the development reserve
(`proforma.ts`), the appraisal fill cost (`value.ts`) and build-to-suit
(`dev.ts`). On the spaces where the cap binds they now reserve more than
the letters ask, which errs on the safe side. Re-basing them is a separate
economy decision. (An earlier, wider experiment that re-priced fit-out as a
pure share of rent everywhere moved prime towers up as well, and changed
how life-company lenders quote; this narrower cap does neither.)

**Measured** (`auto-lease-audit.mjs`, before → after, seed 550991, 4 years):

| book | posture | owner NE | deals < 80% | deals < 60% | TI p90 (yrs of rent) |
|---|---|---|---|---|---|
| older stock, half empty | Market | 83% → 88% | 32% → 17% | 0% → 0% | 1.00 → 0.79 |
| older stock, half empty | Fill | 71% → 75% | 84% → 71% | 11% → 1% | 1.33 → 0.87 |
| new shells | Market | 75% → 76% | 64% → 64% | 7% → 4% | 1.68 → 1.61 |
| new shells | Fill | 64% → 66% | 82% → 80% | 33% → 29% | 2.05 → 2.04 |

The worst Market deal on the older book went from a $3.31 lease against a
$4.76 market (62%) to 76%; on new shells from 26% to 55%.

**What is left.** On brand-new shells in a deep glut (this run's book sat at
61% vacancy), the first-generation premium (1.7×), the glut (up to 1.56×)
and a credit tenant (1.18×) still stack on top of the capped band. A long
first-generation lease can then ask 2–5 years of rent, and Fill signs it. Each of
those multipliers is a real thing, so this is the market, not a bug. The team's
Lean concession limit is the control for an owner who will not pay it.

## Still open

**Time value.** The owner's score still straight-lines the allowance and
free rent over the term. At a 7% rate, $25/sf over 6.5 years costs about
$4.60/sf/yr levelised, not $3.85. That is smaller than the 75¢ error it sat
beside, and the fix needs a rate passed through 16 call sites. A follow-up.

**Three overlapping delegations.** Auto-lease (per building), the firm agent
with its leasing plan sheet, and renewal management all answer letters, each
with its own controls and news voice. Auto-lease is now the simple one, and
the default. The firm agent's plan desk still keeps the tenant's package and
raises rent to compensate (`planCounterTerms`). With the TI cost fixed it
asks for more rent on fat packages, but it has no concession limit. If the
two products are kept, the plan desk should read `autoConcessions` too.
