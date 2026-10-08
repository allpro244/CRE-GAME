# Economy realism plan — jobs, workers, people

Written 2026-10-08. Three places where the city's economy asserts a number
instead of deriving it, measured first, then a plan to make each one an
outcome of causes. Same rules as everything else here (CLAUDE.md): realism
outranks preference, no fake numbers, measure before and after, never tune a
coefficient until a median looks right.

Order: **A → B → C**, smallest and most contained first. Each phase ships on
its own, with a paired before/after and a BASELINE attribution.

---

## What was measured

Four 50-year worlds, no player, one row a month (`scratchpad` probes; the
Phase 0 instruments below make these permanent).

| Finding | Number |
|---|---|
| Local recession months while the nation is NOT worsening | 52-71% (seeds 1-4) |
| Correlation, local 12-month job growth vs national unemployment change | -0.35 to -0.53 |
| Mean 12-month job growth in a "recovery" | -0.28% to +0.39% |
| Mean 12-month job growth in a "recession" | -0.82% to 0.00% |
| Months local unemployment sits at exactly 2.80% | 8-48% |
| Lowest local unemployment, every world | 2.80% exactly |
| Labour-force participation | 58%, fixed |
| Natural population growth | 0.016%/month, fixed |

So: the city runs its own clock that produces about half its recessions on
its own; the phase label sets job growth rather than describing it; the
labour market hits a wall instead of tightening; and births and deaths are a
constant.

---

## Phase 0 — Instruments (first, small)

`tools/econreal/` with `pnpm econreal`, reading engine state only:

- **Cycle:** share of local downturn months that coincide with a national
  downturn; the hazard of an expansion ending by its age so far (duration
  dependence); length and depth distributions; job growth by derived phase.
- **Labour:** unemployment distribution and how many months it sits on any
  value; unfilled-job rate; participation; wage growth against unemployment
  (the wage Phillips curve).
- **People:** population growth split into natural increase and migration;
  migration against job growth, wages and rent burden.
- **Baseline:** add `rail.unemp.floor` (months on the floor) and the
  local/national coincidence share to `tools/baseline.mjs`, so the moves are
  visible on every commit.

Reference ranges come from public data and are stated in the tool, not tuned
toward: BLS metro employment (LAUS / CES), NBER cycle dates, Census
components of population change.

---

## Phase A — Labour market without a wall (fixes the 2.8% floor)

**Now:** `jobs = min(wanted, labour force × (1 − 2.8%))`, participation
fixed at 0.58. Unfilled jobs do raise wages and pull migrants, but weakly, so
the clamp does the adjusting.

**Change:**

1. **Matching friction instead of a cap.** Hires per month come from a
   matching function of job seekers and unfilled jobs (the standard
   Cobb-Douglas form, elasticity about 0.5 — Petrongolo & Pissarides 2001).
   As seekers run out, each hire gets harder: unemployment approaches its
   frictional level smoothly and unfilled jobs pile up. That is the Beveridge
   curve, which falls out of the mechanism; nothing asserts it.
2. **Participation responds to the market.** People re-enter when jobs are
   easy to find and leave when they are not: about 56-62% across a cycle,
   roughly the swing in US data, driven by unemployment and real wages.
3. **Workers come from outside.** A booming city draws commuters and movers:
   in-commuting and migration respond to unfilled jobs and to the local wage
   premium over the national wage, not only to job growth.
4. **The 2.8% clamp is deleted.** A 1% guard stays under unemployment as a
   rail that should never bind; the rails counter reports it.

**Done when:** unemployment never rests on one value; the city's minimum
across worlds is about 1.5-3.5%; booms are limited by wages and housing, not
by a cap; wage growth in a tight market reaches about 4-5% nominal at 2%
inflation; the guard binds 0% of months.

**Risk:** faster booms put more pressure on housing and space. The
shortage-pricing fix shipped this week is what answers that. Watch
`rent-anchor`.

---

## Phase B — The cycle comes from causes, not a clock (fixes the timer)

**Now:** each phase runs a random-length countdown, shortened by a glut, a
tight market or a national recession; the label sets job growth (+0.26% a
month in expansion, -0.14% in recession). The ten industries run the same
boom/steady/bust clocks.

**Change:**

1. **An export-base city.** The city's jobs split into export industries
   (the existing ten: finance, law, tech, media, insurance, logistics,
   apparel, food, medical, design) and local-serving jobs (shops, schools,
   trades, government).
2. **Each export industry follows the nation by its own sensitivity.** A
   beta to national employment from the industry's real cyclicality
   (finance, logistics and apparel swing hard; medical barely moves), its
   own long-run trend, and its own shocks drawn as a hazard (a plant closes,
   a sector booms) that fade over time. The clocks go.
3. **Local-serving jobs follow the base.** Local jobs = export jobs × an
   economic-base multiplier, adjusting with a lag. The multiplier comes from
   the city's own mix at the opening (typically 1.5-2.5 in the literature).
   This is where a downturn spreads from one industry to the whole town.
4. **Local limits stay.** The cost of space against wages, the labour supply
   from Phase A, and housing for newcomers keep doing what they do now.
5. **The phase becomes a description.** Computed from the data with
   hysteresis: falling jobs over two quarters is a recession, recovery runs
   until jobs regain their old peak, and so on. All 104 places that read the
   phase across 21 files keep working, now reading an output. Anything that
   used the label as a *cause* (cap rates via `cycleDev`, credit, industry
   odds) is moved to the underlying driver.
6. **Real estate keeps its own cycle.** The supply cycle (orders,
   entitlement, construction lag, gluts) is already endogenous, and is why
   property cycles run longer than business cycles. No change there.

**Done when:**
- at least two-thirds of local downturn months fall in national downturns;
- the hazard of an expansion ending is roughly flat with its age, as in
  post-war US data;
- "recovery" never means falling jobs;
- different industry mixes give different cycle amplitudes (a finance town
  swings harder than a hospital town);
- the share of time in recession and the depth of recessions land inside
  metro history ranges.

**Risk:** this is the largest change of the three. Cycle length and depth
drive how the whole game feels, and every money path reads the cycle
somewhere. It ships behind a full gate, a 16-seed paired baseline and
`pnpm report`, and the measured changes are written up before it merges.

---

## Phase C — People are born, age and leave (fixes fixed population growth)

**Now:** population grows 0.016% a month plus migration, and the population
has no age.

**Change:**

1. **Three age groups:** children, working age and 65+. Births come from
   the working-age group at a fertility rate, deaths are mostly from the
   65+ group, and people age from one group to the next. Rates start from
   US vital statistics (crude birth rate about 11 per 1,000, deaths about 9).
2. **Participation reads the age mix.** An ageing city has fewer workers
   per head, which feeds Phase A.
3. **Space demand reads the age mix where it matters.** Households drive
   apartment demand rather than raw population, and retail reads spending
   by age.
4. **Migration is mostly working-age.** Movers follow jobs and wages and
   avoid high rents (Phase A); the national level sets a slow background
   flow.

**Done when:** natural increase moves over the decades instead of being a
constant; an ageing town's growth and participation slow without anything
telling them to; population components land inside Census ranges for
metros.

**Risk:** smallest of the three. Mostly changes long-run growth and
apartment demand.

---

## Phase D — Verify and write it down

After each phase:
- `pnpm check`, `pnpm gate`, `pnpm conserve`;
- a 16-seed paired baseline against the previous commit, regenerated with
  attribution;
- `pnpm report` reviewed;
- the developer-only and investor playthroughs re-run;
- an ECONOMY.md section with what was measured, what moved, and what got
  worse.

---

## Order and size

| Phase | Touches | Size | Depends on |
|---|---|---|---|
| 0 instruments | tools, baseline | S | — |
| A labour market | market.ts (city block) | M | 0 |
| B export-base cycle | market.ts, industries, every phase reader | L | 0, A |
| C demographics | market.ts, demand target | S-M | 0, A |
| D verify + docs | — | S | each |

A first because B needs a labour market that answers it and C needs
participation that reads age. B is the core realism gain and the most work.
