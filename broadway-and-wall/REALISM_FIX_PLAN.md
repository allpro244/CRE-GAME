# Realism fix plan — the five findings of 2026-11-24

Written 2026-11-24. Follows a realism probe (4 towns x 30 years, no player;
2 towns x 20 years of every sale; 80 nations x 50 years of the national block).

**Read this first.** The first probe ran on a branch 853 commits behind main.
Re-measured on main (`53ecedb`), two of the five findings are already fixed.
Two more turned out to be my measurement, not the engine. That leaves one real
fault and one open question. The plan below is for main as it stands.

The rules this plan works under (CLAUDE.md): the goal is simulation, not
history. A US reference range is a smoke alarm, never a target. Nothing gets
tuned until a median looks right. A finding is a fault only when a mechanism
is wrong: a dice roll where the model could compute the answer, a rail that
binds in normal play, the same quantity with two answers, or a wire that
transmits the wrong way.

---

## Where each finding stands on main

| # | finding (old branch) | on main | verdict |
|---|---|---|---|
| 1 | 25% of building sales distressed, 40-60% in some boom years | 5.5% overall; worst years 15-23% (3,545 sales, 2 towns x 20 yr) | **fixed on main**, nothing to do |
| 2 | cap rates ignore rate moves (y/y corr ~0) | corr 0.22-0.44 by class; office cap 1.9 pp over the loan index | **fixed on main** (cap rates are now discovered from sales and broker surveys) |
| 3 | inflation to 26%, 10-yr to 33% | worst of 4 towns: 16.1% inflation, 16.8% 10-yr. National block alone, 80 worlds: peak 11.0% | **mostly fixed**; one question left (Phase B) |
| 4 | 26% of months labelled recession | now 30%, and the label changes 50-64 times in 30 years; recessions average 6 months | **real fault, now worse** (Phase A) |
| 5 | participation 56% vs US 59-67% | the engine divides the labour force by *all* persons, children included; the US figure divides by people 16+ (US on the engine's definition: ~50%; game 45%) | **my measurement**; one naming fix (Phase C) |

---

## Phase A — the cycle label flickers (the real fault)

**What is measured.** Payrolls in these towns are smooth: year-on-year job
growth has a standard deviation of 0.9%. Yet the phase changes about twice a
year. 69 "recessions" in 120 town-years, averaging 6 months, cover 30% of all
months.

**Why (from the code, `derivePhase` in market.ts).** The dates come from fixed
absolute thresholds on 6-month annualised payroll growth. Below −0.5% is a
recession and above +0.2% is a recovery, with a 3-month minimum stay. Those
thresholds suit a national trend of about 1.5% a year. A town whose trend is
0.3% a year sits within a fraction of a point of both of them, so ordinary
month-to-month wiggles cross them.

**Why it matters beyond the label.**
- Construction lenders read the label: `proforma.ts:726`,
  `constructionLtc(mix, e.phase, …)`. Flicker moves construction credit up and
  down with noise.
- The "rumoured phase" news is a coin (`rng(s) < 0.25` in `derivePhase`). That
  is a dice roll inside the model (fake number six).

**The fix: date the cycle the way the NBER does.**
1. **Depth, duration, diffusion.** A peak or trough is a turning point in the
   payroll *level*, confirmed after the fact. A contraction is a fall from the
   peak deeper than the series' own month-to-month noise (measured from the
   town's own history, not a constant), lasting a minimum number of months.
   Where possible it is also spread across sectors: the industry books
   already exist (`industryPhase`). These are definitions with a source
   (NBER dating procedure; Harding & Pagan 2002, the BBQ turning-point rule),
   not values tuned to a result.
2. **Lenders read the economy, not the label.** `constructionLtc` takes the
   inputs the label was summarising (the credit index, the payroll gap from
   peak) rather than the label itself.
3. **The rumour becomes a forecast.** The street's early read comes from the
   same signals crossing a level, with no coin. That removes one coin from the
   mechanism count.

**Measure before and after (same 4 seeds x 30 years, plus 8 more seeds):**
phase changes per decade, recession length distribution, share of town
recessions that overlap a national one, and construction loan-to-cost
volatility. Done means the label stops flipping on noise, nothing else moves
without a stated reason, and `pnpm mechanism` shows one coin fewer. There is
no target share of recession months.

## Phase B — can supply shocks stack past their own evidence? (an open question)

One town reached 16.1% inflation, close to the US post-war record. That is not
wrong in itself. The question is whether it came from causes or from double
counting. In the full game, three exogenous sources can overlap: the nation's
supply shock, the embargo swan (which overwrites the supply shock with
5.5-8.5 points), and a war's oil price and pressure on the central bank.
Each was sized from the 1970s record. If two of them are drawn from the same
historical episode, that is the same fault already fixed once for war and
fiscal shocks (the comment above `shockHaz` in market.ts).

1. **Instrument first.** Break monthly inflation into its terms (expectations,
   Phillips, easy money, supply shock, swan oil push) on the worst seeds, with
   swans on. `tools/econprobe/nation.mjs` runs without swans, which is why the
   national block alone tops out at 11%.
2. **Fix only if a double count shows up.** Each episode should be drawn once,
   from its source. Otherwise, close the question in this file with the
   decomposition as evidence.

## Phase C — "participation" means two things (a naming fix)

`e.participation = d.lf / d.persons` counts children in the denominator. That
is a legitimate ratio, but it is not what the word means anywhere else.
Rename it to what it is (labour force share of residents), and add
`lf / (work + old)` as participation if any screen or agent wants that rate.
No behaviour changes; check that the baseline does not move.

## Phase 0 — land the instrument (first, small)

Commit the scorecard as `tools/econprobe/realism-score.mjs`. It reads the
series that `tools/econprobe/series.mjs` writes and prints each statistic next
to a US reference.
- It says in its header that the reference ranges are a smoke alarm, not
  targets (CLAUDE.md). It reports numbers and does not print an ok/off verdict.
- Fix its land line: `landIdx` is already a real index (value.ts multiplies by
  CPI), so the probe must not deflate it again.
- Include the participation definition from Phase C and the cycle-label
  statistics from Phase A.

---

## Also seen on main (not among the five; worth a look later)

These are outputs. They are listed because each *could* be a broken wire, and
each needs a mechanism check before anyone calls it a fault.

- **Wages no longer track labour-market slack.** The correlation of
  unemployment with wage growth over expected inflation is −0.01 on main
  (−0.51 on the old branch). If the wage equation still reads tightness, this
  should show; find out why it does not.
- **Apartment rents swing hard:** real year-on-year −22% to +25%, sd 8.2%.
- **Retail rents barely respond to retail vacancy** (corr −0.08; other classes
  −0.3 to −0.6).

## How every phase lands

- **Branch:** from latest `origin/main`; merge main back in before the PR.
  **Small PRs:** 0, A, B, C are separate.
- **Before any probe:** `pnpm engine`. Probes running past about year 30
  resurrect the game (`gameOver`).
- **Evidence:** same seeds before and after, numbers in the PR and in this
  file. If a fix makes a headline number worse, say so and keep the honest
  mechanism.
- **Every PR runs:**
  - the targeted probe;
  - `pnpm check` (CI smoke);
  - `pnpm mechanism --check` (counts must not rise; lower the baseline when
    they fall);
  - `pnpm baseline:check`, regenerating with `pnpm baseline` only for a move
    that has been decided is correct, with the reason in the commit;
  - `pnpm gate` and `pnpm conserve` if the change touches anything that moves
    money. Phase A does, through construction loan-to-cost.
- **New constants** carry a source or an [S]/[D]/[M]/[K] tag. **New random
  draws** only for exogenous events, sized from data.
