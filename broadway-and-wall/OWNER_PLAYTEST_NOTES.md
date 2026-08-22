# OWNER PLAYTEST NOTES — running list

Brian's own notes from playing the build, recorded as written, plus the two
measured handoff plans that are ready to work from. Nothing in the OWNER NOTES
section below has been investigated yet unless it says so — they are the
owner's observations, and several are hypotheses ("I have a feeling…") that
want measuring before anything is changed. Do not fix from the note alone: find
the mechanism, measure it, then fix. CLAUDE.md applies to every item here.

Latest entry: 2026-08-22.

---

## 0. STANDING FACT, TO BE REPEATED WHEREVER PLAYTESTS ARE WRITTEN UP

**No playtest in this repository is based on Manhattan. Every playtest, every
harness run and every number quoted in any of these documents is on a
GENERATED city.** The Manhattan pipeline exists (`pnpm pipeline:manhattan`) and
is not what any of this was measured on. Anybody reading a finding here and
picturing real Manhattan geography, real rents or real absorption is reading it
wrong, and any conclusion drawn on that basis is invalid.

This belongs at the top of `PLAYTEST_2026-08.md`, `PLAYTEST_FIX_PLAN.md`,
`PLAYTEST_PRINCIPAL.md`, `CENTURY_REPORT.md`, `ECONOMY.md` and any future
playtest write-up — one line, same wording, so it cannot be missed.

---

## 1. OWNER NOTES — 2026-08-22

Ordered as the owner ranked them, not by size.

### 1.1 Historical supply vs space leased, per asset class — THE ONE THAT MATTERS MOST
> *"lets add a graph for each asset class of the historical supply and space
> leased (this is the most important note out of everything, it will help me
> determine how realistic the simulation is)"*

A chart per class: total stock delivered over time against space actually
leased over time. Not the annual flows already on the Economy tab — the
**stocks**, side by side, for every class, over the whole history. This is the
single view that says whether the simulation is realistic, and it is the
owner's top priority out of everything in this file.

### 1.2 Never require a horizontal scrollbar, anywhere
> *"in the portfolio tab, we should not use the horizontal sliding bar, compact
> the information in the rows so you dont have to use it. Actually make sure you
> never need to use a horizontal slider on anything in the UI, a vertical is
> okay for now, but horizontal NO"*

Portfolio tab is the worst offender — compact the rows. Then audit every other
panel. Vertical scrolling is fine for now. Horizontal is not, anywhere.

### 1.3 The development flow loses all three stages when you click away
> *"after you get through the 3 stages of deciding what building you will
> develop on a plot of land you own you have to go back and check your finances
> or the economy or anything. Then you lose your spot on all the 3 things you
> did (programme, design, financing) all of these require time and thought, then
> you lose all of it when you click out of it. I wish this would save and have
> an easy back button whenever you click out of it."*

Programme / design / financing each take real thought and are all discarded the
moment the player leaves to check finances or the economy — which is exactly
what a player SHOULD do before committing. Persist the in-progress scheme and
give a way back into it.

### 1.4 Portfolio-wide refinancing across mixed collateral
> *"Say you have 6 properties, 3 are pooled into loan, and the other 3 are
> either free and clear and or under other debts, or a mix. You should be able
> to refinance all 6 together anytime, make this happen"*

Refinance the whole book at once regardless of what each asset currently
carries — pooled, individually mortgaged, or unencumbered.

### 1.5 The deals desk is messy when negotiating on your own portfolio
> *"the ui for the deals desk is messy and obstructed when negotiating offers
> for your portfolio in particular, make this easier for the player to digest."*

### 1.6 Debt terms are missing during construction
> *"when you are in the process of constructing a building, your debt terms do
> not show under the Capital -> debt tab"*

Construction-loan terms should appear in Capital → Debt while the job is
running, same as any other facility.

### 1.7 Leverage is far below what the metrics say it should support
> *"why is it so often where i am trying to REFI when interest rate is 2%, the
> DSCR is 5.0, and the LTV maxes out at 23%??? AKA shouldnt i be able to
> leverage a ton more??? why cant I leverage more?"*

At a 2% rate and 5.0x DSCR the constraint should be the LTV cap, not the debt
service — a 23% advance is not something any lender would quote on that
coverage. **Measure the sizing path before changing it:** which of the three
tests (DSCR, debt yield, LTV) is actually binding, and on what value — if the
appraised value being sized against is the problem, the sizing rules are not.
Note the value side reads the EFFECTIVE rent index, which the recent
concession fix changed the meaning of; check that first.

### 1.8 Buying a rate cap
> *"Need to be able to buy cap rates on interest rates for loans"*

Interest-rate caps as a purchasable instrument on floating debt.

### 1.9 CF/YR in the top row may not be net of debt on some properties
> *"i have a feeling CF/YR at the top row doesnt account for debt for some
> properties"*

Hypothesis, needs verifying against the ledger. If true it is a display bug on
the number the player steers by, which makes it urgent.

### 1.10 Unfinished note
> *"with the recent updates, i have a feeling that"*

The note ends mid-sentence — the thought was cut off in transit. **Ask the
owner what this was before assuming.** Do not guess at it.

---

## 2. HANDOFF FOR CURSOR — the two measured plans

Paste block, ready to hand over. Both plans came out of measured playthroughs
on branch `claude/rent-graph-accuracy-check-5zpd5d`, not from reading code.

```
Branch: claude/rent-graph-accuracy-check-5zpd5d (repo root: broadway-and-wall/)
Read CLAUDE.md first, then these two plans. Both came out of measured
playthroughs, not code reading. Do them in this order — the second one is a
mechanism fault and outranks the first, which is mostly a bug plus two
"verify before you touch it" items.

1. RENT_VACANCY_RESPONSE_PLAN.md
   Does citywide rent answer citywide vacancy? Sign, monotonicity, duration and
   the real-terms path are all correct — do not touch them. The fault: office
   and retail asking rent falls ~2.2%/yr whether the market is 3pp or 15pp over
   natural (extra depth buys 0.04pp/yr), while the fitted curve behind it in
   market.ts asymptotes at -18.6%/yr, anchored to Houston 1983-87. Multifamily
   deepens properly (-8.13pp/yr), which is what proves this is a throttle and
   not a design choice about stickiness. Two named suspects, both downstream of
   the curve: the -0.008/mo clamp on rentPress, and the 8-month EMA averaging
   the spike away while CPI and the income anchor push back. Also: 30% of
   soft-market years still show asking RISING.
   Do NOT retune DEEP_RATE, glut(), FIT_MAX or CAP_VAC_BETA. Instrument the
   path first (step 1), count how often the rail binds (step 2), then fix.

2. QUALITY_BALANCE_PLAN.md
   Is building quality worth buying? Stripping a building correctly loses and
   the reserve dial is a real decision — leave both. Three faults: (a) a gut
   renovation is discarded the month after it completes — sim.ts:561 writes
   h.condition while tickLeasing recomputes it from an h.condIdx nobody lifted,
   so $210/sf buys one month of grade; (b) a capital programme may be priced
   into rent twice (explicit multiplier AND a condIdx lift) — measure the
   decomposition before changing anything; (c) institutional service looks free
   and under NNN the tenant may be reimbursing all of it — measure the recovered
   share first.

Both plans start with a step 0 that ports my scratch probes into real harnesses
(pnpm vac-rent, pnpm quality-arms) as REPORTS, not gates. Do that first in each
case — several of these numbers cannot be trusted from a single run, and both
plans say which ones and why (terminal net worth ranks nothing: 3.0x-12.9x
spread inside a single arm from cycle timing alone).

Context for both: they were measured on this branch, which already carries a
merged fix to the asking/effective rent chart (faceGrossUp in value.ts,
CONC_DEPTH in market.ts, test/rent-chart.mjs). That fix changed what desks quote
and what the effective index means; the rentIdx mechanism in plan 1 is untouched
by it, so both sets of findings apply to main too.

And: no playtest in this repo is based on Manhattan. Everything above was
measured on generated cities.
```

If runway is short, the cheapest real win in either plan is the gut-renovation
state bug in plan 2 — two lines, large measured effect, no calibration argument
attached.

---

## 3. Closed on `cursor/playtest-notes-171d`

Every numbered note in §1 except the unfinished sentence (1.10) is done:
stock-vs-leased graph, no horizontal scroll, persisted development scheme,
portfolio-wide refi, deals desk, construction loans on Debt, refi path
measured (not retuned), rate caps, CF/YR reconciled, gut `condIdx`,
programme double-count, unrecovered institutional service, rent-path
instrumented. 1.10 is a cut-off thought — do not guess it.

## 4. Already done on the leasing tip, for context

- **The asking/effective rent chart was wrong in level** and is fixed:
  `faceGrossUp` (value.ts) so desks quote a face rent, `CONC_DEPTH = 0.30`
  (market.ts) measured against the package the leasing desk actually writes,
  and `test/rent-chart.mjs` / `pnpm rent-chart` to keep it honest. Deliberate
  consequence: econ test B's FACE response to a supply shock now reads 5.6%
  against a 10% bar, because the adjustment moved into concessions where it
  belongs — the effective response is 13.2%, and test B prints both.
