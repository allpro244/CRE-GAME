# Phase 6 — adversarial measurement

Re-run after Phase 5 deletions. No coefficients were tuned.

## Desk vs patient principal (`pnpm desk-vs-principal`)

5 seeds, 10 years, same ~102-suite gifted commercial book.

```
                  desk        plan        principal   princ − plan
  signed NE%         94.7%      104.7%      111.5%    +6.8%
  tight NE%          97.3%      109.2%      115.9%    +6.8%
  soft NE%           91.9%      104.2%      107.9%    +3.8%
  deals / seed        83.0        67.4        67.0    -0.4
  vac-months          2964        3022        3080    +58
  10y NOI          $75.37M     $66.75M     $70.21M    +$3.47M
```

- desk = firm agent + `starterPlan()` (quote 90%)
- plan = firm agent + `playerEquivalentPlan()` (quote 1.08, holdM 18)
- principal = no desk; counters every letter to `tenantIndifferenceMult`

Phase 0 gap was +17.7 NE points (legacy bands). Phase 3 closed it to +6.8.
Phase 6 is the same +6.8. The leftover is a posted number vs the tenant
indifference function (tightness / credit / phase), plus 6% vs 4% fees on
NOI. The schema as written cannot track the cycle. Do not twist coefficients.

Hands-off-with-plan is **not strictly dominated** by grinding: deal count
matches, vacant-months are slightly better. It is **not strictly dominant**:
the bot still wins signed NE and NOI. Fees are real.

4% `pAccept` floor bind rate remains 0.0% on this bot.

## Plan monotonicity (`pnpm plan-desk`)

```
  quote 1.00  deals 61.3   NE 98.0%
  quote 1.12  deals 52.0   NE 104.8%
  hold 18     vac-mo 2677   NE 89.4%
  hold 0      vac-mo 2707   NE 89.1%
```

Raising `quotePct` lowers deals and raises NE%. Hold-out still raises NE%.
Vacant-months on an empty 8-year book is a weak signal after even-cut
removal; the load-bearing check is the `darkMs` schedule (12 → 1.08, 24 →
1.04, 90 → 0.95).

Block-premium wire: tightening widens the full-floor premium (0.040 → 0.065)
and shrinks the remnant discount (−0.088 → −0.068). Not backwards.

## Demise (`pnpm demise`)

26 deals in 4.3y to 81% occ, 0 whales. 10y identity holds. Remnant 5.3% of
vacant sf.

## Vacancy distribution (`pnpm vacdist`)

8 seeds × 60y, months 60+. Same regime as Phase 1.

```
  class          natural   MEDIAN
  office         11.5%      5.5%
  retail          8.5%      5.8%
  multifamily     4.5%      3.6%
  industrial      7.0%      2.5%
```

## Baseline (`pnpm baseline`)

Second sanctioned century re-roll. **No standing number moved** vs the
Phase 1 file. World-stream draw count unchanged.

## Gate / conserve

`pnpm gate` and `pnpm conserve` (1,135 months) green. $0 unexplained.

## Report (`pnpm report`, in progress)

Econ-accept A–E: 4 of 5 inside band. Outside: **B** (supply-shock rent vs
counterfactual 1.4% vs need ≥10%) — marked REPORTED, NOT GATED; pre-existing.
Sim-accept **F** (income anchor): office −1.04%/yr and retail −1.41%/yr sit
just under the −1.0 floor — also REPORTED, NOT GATED; pre-existing. No new
band from the leasing deletions.

## Audit (`pnpm run audit`, in progress)

Experiments 1–6 all **WIRED** (local demand, negative demand, glut, rate
shock, construction cost, population ±18%). No BACKWARDS verdict on a
leasing wire. The block-premium direction check lives in `pnpm plan-desk`.

## What `pnpm stress` is not

The strategy tournament holds leasing constant (`leaseAtMarket`) so it
compares acquisition and capital, not the desk. The leasing dominance
question is the table at the top of this file.
