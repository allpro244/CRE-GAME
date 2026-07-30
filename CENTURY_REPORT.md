# The Century Report

**64 hundred-year simulations of Groundwork** — 40 passive world runs (one per seed, no
player) plus a 24-run strategy tournament (four archetype bots × six seeds, each starting
with $5M). Engine as of save v32, with the century-calibration slate and the deep-cycle
pass. All numbers below are measured, not estimated.

---

## 1. The macro weather of a century

A hundred years in Meridian City contains, at the median: **10 recessions** (range 6–14),
**3 of them severe** enough that the news calls them depressions, **4 black swans**,
**4 era rotations**, and **6 demographic regime changes**. No two centuries rhyme:

- The unluckiest world (seed 99) endured **14 recessions, 8 of them named** — roughly one
  economic catastrophe per decade.
- The longest single recession ran **98 months** (seed 4) — an eight-year depression.
- The longest expansion ran **297 months** (seed 77) — twenty-four years without a downturn,
  the kind of run that convinces a generation risk is dead.
- Rates visited both rails: 2.0% and 13.0%. Inflation peaked at 8.4.
- Black swans across 40 centuries: 44 pandemics, 37 quakes, 30 crashes, 30 miracle booms,
  25 stagflations. The median century sees four; the worst saw six.
- Construction costs end the century at **6.0× their starting level** (range 4.2–8.8×),
  with rents riding 0.6–1.0× of that per sector — nominal rents roughly quadruple to
  sextuple over a hundred years, and the feasibility gravity keeps development viable
  the whole way (zero rent indices pinned to a bound in any of the 40 runs).

## 2. Cycles now cut deep, and unevenly

The deep-cycle pass shows up clearly in the rent record:

| Sector | Median max drawdown | Worst drawdown | Worst 24-mo crash | Best 24-mo boom |
|---|---|---|---|---|
| Office | 25% | 33% (s123) | −26% | +20% |
| Retail | 10% | 17% (s31337) | −13% | +15% |
| Industrial | 26% | **50%** (s246) | **−35%** | +19% |
| Multifamily | 14% | 26% (s2024) | −15% | +17% |

Seed 246's industrial market lost **half its rent level peak-to-trough** — a genuine
sector depression. 156 sector busts fired across the 40 centuries (~4 per century);
seed 99 ate 8 of them.

**Flag — bust distribution is skewed:** of those 156 busts, office took 116, multifamily
28, industrial 12, and **retail zero**. The picker selects "most overbuilt relative to
equilibrium," and office's naturally high resting vacancy wins that contest almost every
time. The era balance already compensates (see §6), but the *flavor* is wrong — a bust
should be able to land anywhere capital herded last. Fix identified (measure overbuild
against each sector's resting vacancy, same REST offsets the momentum system uses);
one-line change, held for the next tuning pass so this report describes the shipped build.

## 3. Demographic arcs: sun belt and rust belt, by dice

The demographic tide produces genuinely different century shapes:

- Population growth spanned **−1.9%/yr** (seed 300, deep decline) to **+4.0%/yr**
  (seed 555, peak boom) — the full requested range gets visited.
- Median century ends at **105%** of starting population; the extremes are the story:
  seed 2024 shrank **262K → 232K** (steady→stagnation→decline→steady→decline — a rust-belt
  biography), while seed 888 grew **291K → 346K** through three separate boom decades.
- 26 of 40 centuries lived through at least one decline regime; 19 enjoyed two or more
  booms. Regime mix across all runs: 92 steady, 60 stagnation, 51 boom, 36 decline.

## 4. The city renews itself now

Year-100 fabric, median across 40 worlds:

- **Stock grows 295 → 461 buildings; total SF up 110%** over the century (the pre-fix
  engine managed 18% in 40 years and then froze).
- **Quality strata: p10/p50/p90 = 18/67/128.** A maintained Class-A tier at the top,
  a healthy renovated middle, and a rot stratum at the fringe waiting for the wreckers.
  The old engine decayed monotonically to a median of ~34.
- Mean building age ~99 years — the city keeps its old bones (Manhattan-style) but
  renovates them; **8 scrape-and-rebuilds** per median century (max 19, seed 54321).
- **7 transit lines** per median century, each on a fresh corridor, each upzoning its route.
- Desirability moves both ways at last: the median century's biggest gentrifier climbs
  **+32 points** (max +46) and its biggest decliner falls **−19** (worst −38, seed 1969).
  Both rise and fall stories on every map.

## 5. Firm ecology holds for a hundred years

- **10 live rival firms at year 100 in all 40 runs** (median 7 entrants replacing
  collapses; the busiest century burned through 21 firm identities).
- The richest firm at year 100 holds a median **$4.4B** net worth — and in seed 5150 it's
  **Quarry & Vane at $7.5B**, a firm that didn't exist at genesis. Entrants don't just
  fill seats; they can win the whole table.

## 6. Sector fates: growth rotates, levels still lean

Twenty-year era balance is the tightest ever measured (40 seeds: winners
office 10 / retail 12 / industrial 11 / multifamily 7; average finishing places
2.40–2.60). Quarter-century *growth* leadership rotates properly. But the **century-end
rent LEVEL** ranking is nearly deterministic: industrial finishes highest in **38 of 40**
worlds (rent/cost 1.04 vs 0.64–0.78 for the rest) and multifamily lowest in 30 of 40.

Translation: within any given 20–25-year stretch, any sector can be the hot hand — but a
century-long industrial hold still out-earns a century-long anything-else hold, because
industrial's structural supply scarcity compounds a small persistent edge. The phased
sector anchors (K = 0.70 for industrial) blunted this but did not erase it; industrial's
tight vacancy keeps overpowering the gravity. Options if you want it flatter: push the
industrial anchor harder (~0.55), or accept it as structural realism (industrial land
scarcity is real). **Owner's call — this is the largest remaining lean in the game.**

## 7. The hundred-year strategy tournament

Four bots, $5M start, tier 2, six seeds each:

| Strategy | y20 | y40 | y60 | y80 | **y100 (median)** | Range | Max drawdown | Note |
|---|---|---|---|---|---|---|---|---|
| **Vulture** (distress flips) | 12.7M | 37.9M | 143M | 242M | **$435M** | 41–898M | 45% | best single exit **+$133.5M** (Oakline Tower); 84% hit rate; zero bailouts |
| **Core** (buy & hold) | 6.8M | 25.8M | 49M | 94M | **$206M** | 42–448M | 56% | pure compounding; 7 near-death bailouts across 6 runs |
| **Land banker** | 5.3M | 6.6M | 8.9M | 13M | **$19M** | 13–23M | 27% | *finally works* — was dead money before the feasibility fix; 93% hit rate, 52 deals |
| **Merchant builder** | 3.3M | 1.7M | 1.7M | 1.7M | **$1.7M** | 0.1–5.7M | 84% | still ruined — see below |

The headline: **the feasibility anchor changed who can win a century.** Compounders
(core, vulture) now grow 40–90× because NOI tracks the cost curve instead of stalling
against it. Land banking went from a flat $5M to a steady 1.4%/yr real compounder —
dirt now appreciates with the city.

The merchant builder remains broken, but the diagnosis shifted: its pro formas are
honest and development *does* pencil — the bot simply operates a fixed ~$5M bankroll in
an economy where a 40K SF project costs 6× more by mid-century. It prices itself out by
year 20 and never does another deal (median 4 deals in 100 years). A human player who
compounds capital between builds — or recycles into bigger projects as tiers unlock —
does not have this problem. I'd call it bot naivety rather than a game flaw, but it does
confirm: **quick-flip development without capital growth is a losing century strategy,
while develop-and-hold rides both the margin and the compounding.**

## 8. What I'd tune next (in order)

1. **Bust picker REST-normalization** — one line; ends the office bust monopoly and lets
   retail/industrial busts exist. Needs a 40-seed era re-check after (small shift expected).
2. **Industrial century-level lean** — push its anchor toward 0.55 if you want century-end
   rent levels as rotational as growth already is; leave it if industrial-as-quiet-king
   feels like realism.
3. **Multifamily floor** — MF finishes last in 30/40 centuries at 0.64× cost; a modest
   anchor bump (1.18 → 1.25) would keep decline-decade MF from being a near-automatic loser.

None of these block play. The century, as shipped, is dynamic top to bottom: the eras
turn, the city grows and rots and rebuilds, the field of rivals refreshes itself, and the
dice write genuinely different hundred-year biographies every time.

---
*Method: engine bundled from src/engine.ts at v32; passive runs used a solvent observer
(no player actions); tournament bots are the four archetypes from the strategy audit.
All event counts tracked from live state (news feed trimming makes headline-counting
undercount). Scripts: scratchpad/world100.mjs, arch100.mjs, analyze100.mjs.*
