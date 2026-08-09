# The Groundwork Simulation Report — v2

**76 full simulations of the current engine** (post unpredictability-architecture and
vintage-premium builds): 40 passive world centuries, a 24-run strategy tournament at two
horizons (100-year × 6 seeds, 40-year × 12 seeds), and a 16-century era-fidelity probe.
Every number below is measured. Where the v1 report's engine differed, the old figure is
shown for comparison.

---

## 1. Headline: the era system now keeps its promise

The design goal was "non-predictable spread, but readable." The era-fidelity probe
measures exactly that: across **64 stable era windows** (median span ~21 years), when the
news announces a new era's darling sector —

- the darling finishes **#1 in rent growth 30%** of the time (blind chance: 25%),
- **top-2 in 67%** of eras (blind chance: 50%),
- and the announced castoff finishes dead last **56%** of the time (blind chance: 25%).

Translation for the player: reading the wind is worth real money — positioning into the
darling roughly doubles your odds of riding the era's best or second-best sector — but it
is never a sure thing, and a third of eras will punish blind faith in the headline. This
is the intended shape: an edge for the attentive, not an answer key.

## 2. The macro century

Median century, 40 seeds: **10 recessions** (range 7–14), **3 named depressions**
(severity > 1.6; 141 across all runs, worst century 7 — seed 404), **4 black swans**,
**4 era rotations**, **6 demographic regime changes**.

- Longest recession: **96 months** (seed 86753). Longest expansion: **414 months** —
  34 years, seed 1492, a run that would convince two generations risk is extinct.
- Rates spanned 2.0–13.0%; inflation peaked at 8.2.
- Swans across 40 centuries: 37 stagflations, 35 pandemics, 33 crashes, 31 quakes,
  26 miracle booms.
- Construction costs end at a median **5.8×** starting level (range 3.9–8.4×); rents ride
  0.83–1.04× of cost per sector, so development still pencils in year 95 — zero rent
  indices pinned against a bound in any run (v1 engine at year 100: several pinned).

## 3. Busts and drawdowns — the weird times, quantified

140 sector busts fired across 40 centuries (~3.5 per century; seed 123 ate 9). The
distribution after the weighted-draw fix: **office 85, multifamily 40, industrial 10,
retail 5** — versus office taking 116 of 156 with retail at zero before. Office still
leads (its high resting vacancy makes it the perennial likeliest target — defensible
realism), but every sector's number can now come up.

| Sector | Median max drawdown | Worst | Worst 24-mo crash | Best 24-mo boom | Rent/cost y100 |
|---|---|---|---|---|---|
| Office | 16% | 26% (s99) | −18% | +19% | 0.92 |
| Retail | 7% | 17% (s13) | −12% | +16% | 0.86 |
| Industrial | 20% | **41%** (s246) | **−29%** | +21% | 1.04 |
| Multifamily | 7% | 17% (s12345) | −14% | +17% | 0.83 |

Seed 246 remains the industrial-catastrophe world: a 41% peak-to-trough rent collapse.
The new warehouse-glut hangover (every e-commerce wave now delivers its overbuilt
logistics space into the slowdown) is a regular contributor to industrial's violence —
it is now the highest-beta sector in both directions, which suits its real-world
character.

## 4. Sector fates: the leans that remain

- **Century-end rent levels**: industrial still finishes highest in 35/40 worlds
  (office takes the other 5) — but the margin collapsed. The rent/cost band across
  sectors is now **0.83–1.04** (v1: 0.64–1.04); multifamily's last-place finishes fell
  from 30/40 to 22/40, and retail now takes last in 12. Industrial's residual edge is
  physical: M-zoned land fills up and scrapes convert old industrial out — real scarcity.
  The parity brake caps how far that scarcity can compound (~1.04× replacement cost);
  it can no longer run to 1.6× as the v1 engine allowed.
- **20-year era balance** (40 seeds): winners office 15 / retail 8 / industrial 10 /
  multifamily 7; average finishing places 2.30–2.65. Every sector wins and loses.
- **Within-era growth** rotates properly (see §1) — the lean is a *level* phenomenon a
  patient industrial landlord harvests slowly, not a script the player can read year to
  year.

## 5. Demographic arcs

- Population growth visited the full range: **−2.0%/yr** (seed 42) to **+4.0%/yr**
  (seed 31337).
- Median century ends at 105% of starting population; extremes: seed 7 *shrank* 2%
  overall through a decline-scarred century, while seed 101 grew 20% (261K → 314K)
  through three boom decades, with a 21% within-century swing.
- 30 of 40 centuries lived through at least one decline regime; 22 saw two or more booms.
  Regime instances across all runs: 94 steady, 64 boom, 50 stagnation, 38 decline.

## 6. The city renews itself

Year-100 fabric, median across 40 worlds:

- **Stock 295 → 496 buildings (+122% SF)** — up again from v1's +110%; the margin-chasing
  firms and easier scrape math added visible construction.
- **Scrapes: median 11 per century** (max 24, seed 5678) — the wreckers are a regular
  presence now, up from 8.
- **Quality strata: 18 / 57 / 124** (p10/p50/p90; q50 range 35–76). Slightly lower median
  than v1's 67 — deeper cycles suppress renovation appetite during the long troughs.
  Watch item, not alarm: the Class-A tier holds at ~124 and the rot stratum is intentional.
- Mean building age ~95 years; 7 transit corridors per century, each upzoning a fresh
  route; biggest gentrifier +30 median / +45 max; biggest decliner −18 median / −40 worst.
- Land: median $4.5M/acre at year 100, range $3.1M–8.9M.

## 7. Firm ecology

All 40 worlds end with **10 live firms**; median 6 entrants per century (max roster 21
identities). The richest firm at year 100 holds a median **$4.9B**; the record is
**$8.5B (Vertex Development, seed 1969)**. Original firms and entrants both reach the
top — the field stays genuinely contested for a hundred years.

## 8. The strategy tournament — two horizons

$5M start, tier 2. Medians (min–max in parentheses):

**40 years, 12 seeds:**

| Strategy | Final NW | Max drawdown | Realized P&L | Hit rate | Note |
|---|---|---|---|---|---|
| Vulture | **$44.3M** (0.1–185.7M) | 45% | +$8.4M | 100% | best exit +$19.4M |
| Core | $39.6M (13.7–73.3M) | 38% | — (holds) | — | zero bailouts |
| Land banker | $6.7M (5.5–7.6M) | 20% | +$1.1M | 86% | slow, safe |
| Merchant builder | $1.5M (0.0–17.9M) | 98% | **+$4.3M** | 67% | see below |

**100 years, 6 seeds:**

| Strategy | Final NW | Max drawdown | Realized P&L | Note |
|---|---|---|---|---|
| Vulture | **$947M** (0.1M–1.51B) | 69% | +$94.3M | 74 deals; feast or famine — one seed ends broke |
| Core | $508M (309–557M) | 39% | — | the steadiest compounding curve in the game |
| Land banker | $15.5M (12.0–18.7M) | 27% | +$9.0M | dirt compounds ~1.2%/yr real |
| Merchant builder | $1.5M (0.0–18.3M) | 98% | **+$12.1M** | profitable trades, fragile balance sheet |

The vintage-premium change did what it was meant to: **the builder's trades are now
profitable** — median realized profit +$4.3M at 40 years and +$12.1M at 100 (both were
*negative* before), hit rate up from ~40% to 67%, deal count quadrupled, and the best
runs finish at $17–18M. Its median net worth stays low because the archetype never
compounds equity between projects and eats carry during dry spells — a human who scales
project size with their bankroll does not share that ceiling. Merchant build is now a
real profession with real ruin risk, which is the intended calibration.

Vulture remains the highest-ceiling strategy at every horizon (buy broken buildings in
the frequent busts, sell fixed), core the most reliable, land banking the safe floor.

## 9. Residual leans and watch items (owner's calls)

1. **Industrial's century-level crown** (35/40, by a thin ~10% margin). Rooted in real
   land scarcity; the parity brake caps it. Erasing it entirely would require the city
   to release M-zoned land dynamically (a rezoning-policy mechanic) — worth considering
   as a *feature* (industrial land release fights, port expansions) rather than a tuning
   knob.
2. **Office's bust plurality** (85 of 140). Defensible — office vacancy structure makes
   it the usual suspect — but if it grates, the draw temperature (currently ×6) can come
   down.
3. **Year-100 median quality dipped to 57** (from 67) with the deeper cycles. If the
   late-game city should look better-kept, the renovation base rate is the lever.
4. One fuzz run crashed under heavy concurrent load and never reproduced across five
   follow-up passes (all invariants clean). Logged, watching.

## 10. Verification state

Simtest green; 40-seed × 20-year era balance green (both seed sets); deep fuzz ×5 clean;
100-year health probe: no pinned rent indices, 10/10 firms, strata intact, winners
rotating; headless smoke test zero console errors. All work committed and pushed;
save v32.

---
*Method: engine bundled from src/engine.ts; passive worlds use a solvent observer with
no player actions; tournament bots are the four standing archetypes; era fidelity
measured over stable era windows ≥ 60 months, comparing announced tilt extremes at the
window's start against realized sector rent growth over its span. Scripts:
scratchpad/world100.mjs, arch100.mjs, arch40.mjs, erafid.mjs, analyze100.mjs.*
