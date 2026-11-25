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
| 4 | 26% of months labelled recession | 30% at `53ecedb`, **43% at `1efddff`**; the label changes 16-19 times a decade | **real fault, now worse** (Phase A) |
| 5 | participation 56% vs US 59-67% | the engine divides the labour force by *all* persons, children included; the US figure divides by people 16+ (US on the engine's definition: ~50%; game 45%) | **my measurement**; one naming fix (Phase C) |

---

## Phase A — the cycle label flickers (DONE, 2026-11-24)

**The fault.** `derivePhase` dated the cycle off six-month payroll *growth*
against fixed cut-offs: under −0.5% annualised was a recession, over +0.2% a
recovery. Those cut-offs suit a nation trending ~1.5% a year. These towns'
payrolls run −14% to +6% over thirty years, so ordinary wobbles crossed both.

**Correction to the first draft.** Construction lenders do *not* read the
label: `constructionLtc` ignores it (`void phase`). Nothing that prices or
decides reads it. It drives the news, the street's rumours, status text and
the screens. So the fault was what the game *told* the player, plus a 25%
coin deciding whether a rumour ran (fake six).

**The fix** (`market.ts derivePhase`), in the Bry–Boschan (1971) form the
NBER's monthly dating follows:
- dating reads payroll levels;
- a peak is the high since the last trough, stood 5 months;
- a recession is a fall of 1.4% from it that has run 6 months. 1.4% is the
  1980 recession's payroll fall (BLS, *Monthly Labor Review*, Aug 1982);
- the trough is confirmed when the low has stood 5 months;
- the next peak is measured from the trough;
- the depression rule is unchanged;
- a rumour is the turning point the data already shows and the dating has not
  confirmed. The line it prints is chosen by the month, with no draw.

`test/economy-honesty.mjs` §1 now tests this on synthetic payroll paths. The
old §1 drove `slackEma`, which nothing reads; it failed on main and tested
nothing.

**Measured (same 4 towns × 30 years, before → after):**

| | before | after |
|---|---|---|
| label changes per decade | 16.4 | 7.9 |
| months labelled recession or depression | 43% | 25% |
| recession length, mean | 8.5 mo | 11.8 mo |

Rents, vacancy, cap rates and rates: unchanged within noise. Mechanism audit:
coins 26 → 25, draws 243 → 242, unsourced 260 → 259.

The rest of the frequency is the towns' own. Payrolls with almost no trend
fall 1.4% from a high far more often than a growing nation's do. Whether
these towns *should* have so little job growth is a separate question:
population grows 8–31% over the same thirty years, against payrolls of −14%
to +6%.

## Phase D — migration and the labour market (IN PROGRESS, 2026-11-25)

Started as FORMULA_LEDGER #33 (migration as a quota). Four findings, in order.

**1. Migration was one-sided (fixed on the branch, not merged).** A working
household left at MOVE_M × (1 − pull), and arrivals came at MOVE_M × pull.
At parity nobody left while 2.5% a year arrived. Measured: a town whose pay
bought 7–14% less than the nation's for twenty years still took in ~600
households a year and lost ~200 (population +13% on flat payrolls).
Fix: every mover re-chooses, and this town is a sliver of the places it
weighs, so households leave at MOVE_M whatever the pull. The pull works on
arrivals: gross outflow rates vary least across US states (Coen-Pirani 2010,
JME 57(7)).

**2. Alone, that fix shrinks every town** (4 towns × 30 yr: population −5% to
−24%, jobs −17% to −30%), because openings pile up and nothing fills them.
Even BEFORE it, the job-opening rate reached 14–22% of the labour force by
year 30 (US record: 7.4%, 2022). After it: 22–36%.

**3. A growing pay premium is not the cure (tried, reverted).** V_SLOPE [K]
sets pay at a premium of 0.5 × excess openings. Replaced with a premium that
GROWS 0.8 a year per point of excess openings (2019–22 JOLTS and ECI [D]),
pay ran away: wage index ×17–33 in 30 years, jobs −40%, unemployment 24–28%.
Openings could not close, and nominal pay is never cut, so it ratcheted.
Reverted.

**4. The root: grown children at home cannot work.** A household has three
earner slots (head, partner, ONE "other adult"). As housing tightens, grown
children cannot form their own households and pile up at home. Every adult
beyond the first other adult has no slot and cannot hold a job.
Measured (town 1, migration fix, 20 years):

| year | 1 | 4 | 8 | 12 | 16 | 20 |
|---|---|---|---|---|---|---|
| working-age adults with no earner slot | 1,644 | 1,889 | 3,014 | 4,330 | 5,352 | 7,787 |
| households with 2+ other adults | 4.5% | 5.0% | 7.8% | 11.0% | 13.6% | 17.7% |
| unfilled openings | 1,781 | 1,976 | 3,859 | 4,502 | 6,620 | 7,452 |
| working-age adults in the labour force | 79.8% | 80.9% | 81.2% | 79.6% | 76.6% | 72.9% |

The workers the firms cannot find mostly live in town already. The register
gives them nowhere to work, and participation FALLS while a fifth of jobs
stand open.

**5. Partly fixed: a blocked grown child becomes a doubled-up household** (on
the branch). When the slot is contested and no home is free, the eldest stays
in the same home as its own doubled-up household (Census definition), with its
own earner slots. Town 1 at year 20: slotless adults 7,787 → 4,380, working-age
participation 73% → 76%. Openings still pile up (4 towns × 30 yr: 21–32%).

**6. THE BINDING CONSTRAINT IS THE REGION'S HOUSING.** Town 1, migration +
doubled-up, 20 years: the mainland's homes are full in EVERY month (12 of 12,
every year; free capacity −29 to −176, so it runs over-full). Every mover who
would take an opening is turned away (`mainRoomFor`), so the openings stand.
Builders do not answer: their pencil sits at 0.60–1.09, mostly under 1, while
mainland rent rises 2,144 → 5,324 (×2.5 nominal) in twenty years. That is
FORMULA_LEDGER #30 (mainland rent and its supply). Fix the supply side there,
then re-measure findings 1, 5 and 6 together. Nothing in Phase D merges until
towns stop shrinking for want of a home.

**7. The supply curve covered one tier of the stock (fixed on the branch).**
Saiz's elasticity is the whole stock's. The curve ran through the standard
tier's opening homes (1,226 of ~10,000), so supply answered about an eighth as
hard as the record says. Now it covers the standard and older tiers together.
Town 1, 20 years: builders do answer (~2,400 homes in years 12–14, the rent
falls back), but the mainland is full again from year 16 and openings reach
7,230.

**8. Why: the rent never sees the households turned away.** The mainland rent
follows the households living there (FORMULA_LEDGER #30), not the queue at the
door. Movers turned away for want of a home are no demand at all to the price,
so the rent rises about as fast as costs, the pencil stays near the opening's
(0.59–0.91), and building stays weak. The next piece is #30: landlords pricing
on their own vacancy, counting who applied and was turned away, as the island's
landlords already do.

**9. Turned-away applicants now bid on the rent ladder (on the branch).** The
mainland rent is NOT a formula any more (FORMULA_LEDGER #30 is stale: the rent
is a bid ladder). The gap was that movers turned away for want of a home never
bid. Now they do, for a search's length, at what renters spend out of the
offer's pay. Town 1, year 20: openings 7,230 → 5,534; the region is still full
most months. Bids are fixed at 30% of income (a long-run cross-metro share,
Davis & Ortalo-Magné 2011), so a shortage cannot bid the rent up past that
share. Next on rent: a willingness to pay against the fallback (doubling up,
leaving), not a fixed share.

**10. Tenders are now won by the hands an industry has (on the branch;
FORMULA_LEDGER #28).** It changed which towns shrink, not whether they do
(4 towns × 30 yr: populations −12% to −25%, openings 17–26%).

**11. WHERE THE OPENINGS ARE (town 0, all changes, year 20).** Local trades
want 38,268 heads and have 17.8% unfilled. Restaurants are 35% staffed,
general merchandise 44%, social assistance 53%, retail 57%, nursing 61%.
`tickFirms` cuts a local trade's month's SALES to what its staff can make
(customers buy elsewhere), but the cut is a copy (`const rpc =
E.rpc.slice()`): next month the same customers come back, and the firm
staffs toward its full orders again, posting the same openings for ever. Real
customers who cannot be served switch, to other towns, online, or doing
without. The trade then shrinks to what it can staff or bids pay up until it
can. **This is the root of the openings pile-up, and it was there before
Phase D** (the one-sided inflow hid it). Next: let unserved demand move
persistently (the town's purchase coefficient for the trade falls while it
cannot serve, and recovers as it can), with the switching speed sourced.

**12. Staffing toward served custom is a ratchet (tried, reverted).** A local
trade's heads read its served share plus what re-tenders in a month (1/TENDER_M).
Openings went to 2%, and so did everything else: jobs −80% to −86%,
unemployment 42–50%. Every quit cuts capacity, so served custom, so the
staffing target, and so on down. A month's re-tender (1/TENDER_M) cannot
outrun ordinary separations (SEP_RATE 1.3% a month).

**WHAT THIS ADDS UP TO.** Patching the labour market one link at a time does
not converge. Six changes, two reverted disasters, and every town still
shrinks. The engine's labour demand is "each industry staffs toward the heads
its orders need" plus a pay premium. That rule has no notion of what a vacancy
costs a firm, or of a firm giving up on hires it cannot make. The standard
model that has one is search and matching (Diamond-Mortensen-Pissarides;
Pissarides 2000, *Equilibrium Unemployment Theory*):
- firms post vacancies while the expected value of a filled job exceeds the
  cost of keeping the post open;
- the job-filling rate falls as the market tightens (the matching function the
  register already uses: MATCH_ETA, Shimer 2005);
- so tight markets post fewer vacancies per unfilled need, pay rises through
  bargaining, and openings settle near their natural rate by construction.

That is a redesign of `staff` and `postPayAndPrices` (economy.ts) against the
register's matching (households.ts), not a patch. It needs its own plan,
sourced parameters (vacancy cost, bargaining weight) and an owner's decision.

**STEP 1: THE INDEPENDENT PIECES, LANDED WITHOUT THE MIGRATION CHANGE (2026-11-25).**
The two-sided migration (finding 1) and the capacity tender (finding 10) are
reverted on the branch until the labour market can carry them. What lands is
findings 5, 7 and 9:
- grown children blocked from a home become doubled-up households with their
  own earner slots;
- the supply curve covers the region's whole housing stock;
- movers turned away for want of a home bid on the rent ladder.

Same 4 towns × 30 years against main `01f3066`:

| | main | step 1 |
|---|---|---|
| jobs, year 30 vs opening | −14% to +1% | −7% to +7% |
| population | +4% to +25% | −4% to +12% |
| job openings, year 30 (% of labour force) | 14–22% | 12–16% |
| labour force ÷ residents | 44.8% | 47.9% |
| local unemployment, mean | 5.3% | 5.7% |

Rents, vacancy, cap rates and the cycle barely move. Openings are still above
normal: that is step 2.

**STEP 2: SEARCH AND MATCHING FOR THE TOWN'S FIRMS (planned 2026-11-25).**

*The fault.* Labour demand is one rule: each industry staffs toward the heads
its orders need (`economy.ts staff`), and the published openings are the gap
between wanted and staffed heads. Keeping a post open costs nothing, so a
trade that cannot hire posts the same openings for ever (restaurants 35%
staffed at year 20). Pay answers with a LEVEL premium, `V_SLOPE` [K]. An
elastic job-filling rate was tried once and parked because migration did not
answer openings (comment above `households.ts Q_FILL`). That is the same
coupling Phase D ran into, so firms, pay and the filling rate move together.

*The model* (Pissarides 2000; the calibration approach of Hagedorn &
Manovskii 2008):
1. **Vacancies are posted while they pay.** For each industry, the value of a
   filled job is J = (output per head − pay) / (r + s), at the industry's own
   margins, the loan index and SEP_RATE. A vacancy costs c a month and fills
   at q(θ) a month. Firms post vacancies v until c = q(θ)·J (free entry), never
   more than the heads their orders need. Orders beyond what they staff go
   unserved, as `served` already books.
2. **Openings are the posted vacancies.** `jobVac`, `open[i]` in
   `postPayAndPrices`, and the openings `matchJobs` fills all read v, not the
   staffing gap. Where openings settle is an outcome of c, q and J.
3. **The filling rate falls as the market tightens**:
   q(θ) = Q_FILL × (θ / θ_nat)^(−α), with α the matching elasticity and
   θ_nat the nation's V/U (JOLTS / UNEMPLOY). This is the elastic q that was
   parked.
4. **Pay is bargained.** A firm's premium over national pay moves toward
   β·(the job's surplus share) + β·c·θ, the Nash wage. It replaces
   `V_SLOPE` [K]. The wage curve (Blanchflower & Oswald) and rent sharing
   stay.
5. **Then** re-land the two-sided migration (finding 1) and the capacity
   tender (finding 10), and re-measure.

*Parameters* (verified by reading the source unless marked):

| | value | source |
|---|---|---|
| matching elasticity α | 0.5–0.7; take 0.5 | Petrongolo & Pissarides 2001 JEL 39, §2 (read); Shimer 0.72 via HKV 2005 |
| bargaining weight β | = α (Hosios condition) | Hosios 1990; HM's 0.052 is the volatile extreme, not used |
| filling rate | ~5% a working day, mean vacancy 20 working days | Davis, Faberman & Haltiwanger, NBER WP 16265, Table 3 (read) |
| target check: openings | ~3.1–3.5% of the labour force | JOLTS 2001–19 3.13%; HM θ 0.634 × u 0.055 = 3.5% (ECB WP 853, Table 2, read) |
| vacancy cost c | SOLVED so free entry holds at the opening's tightness; then checked against measured hiring costs | — |
| check on c: cost per hire (c / q) | recruiting 3–4.5% of a quarter's pay (HM p.16, read); with training ~0.5–1 month's pay (Manning 2010 CEP DP 981, Table 2, read); Silva & Toledo 36–55% of a quarter (second-hand, via Dallas Fed WP 1102) | |
| Shimer's c = 0.213 | UNVERIFIED (paywalled AER); not used | |

c is the one parameter solved rather than read. It is solved ONCE, at the
opening, from free entry at the nation's tightness, then held. It is checked,
not tuned, against the measured cost per hire. If the check fails by more
than the published range, the model is wrong somewhere, and the fix is not
to move c.

*Done when* (4 towns × 30 years, then 12 towns):
- openings settle in a band set by the mechanism, and rise and fall with the
  cycle (JOLTS: 2.2–7.4% over 2001–24);
- no industry sits under 80% staffed for years;
- pay rises with tightness and stops when openings close (no runaway: the
  finding-3 failure);
- with migration two-sided again, towns neither grow without jobs nor shrink
  for want of workers;
- `conserve` holds and the mechanism counts do not rise (`V_SLOPE` goes).

*First design check, before code (2026-11-25).* Free entry sets the cost of a
hire (c / q) equal to the value of a filled job, J. Measured, a hire costs
about 0.5–1 month's pay including training (Manning). The engine's firm margin
(`F.ebitda / F.rev`) is gross operating surplus: it includes the return to
capital. Read as J = (p − w) / (r + s), at r + s ≈ 1.7% a month, it values a
filled job at roughly 15–20 months' pay. That is an order of magnitude over
the measured hiring cost, and wired in as is, it would fail the plan's own
check. J must be the LABOUR surplus of the match, with capital's return
netted out. HM split their vacancy cost the same way: 0.474 capital + 0.110
labour (ECB WP 853, pp. 15–17). Two candidate routes:
(a) net capital out of the margin with the BEA capital share by industry,
which the engine has (`INDUSTRIES[].gos` and the IO accounts);
(b) take J's LEVEL from the measured cost per hire, and let only its
proportional movements come from the margin.
Decide which before writing the vacancy rule. (b) is simpler and keeps the
level sourced. Under (a) the level is an output of the books, which is
better if it passes the check.

*Risks.* The model is known to be volatile when z is near productivity (HM).
J here comes from the engine's own margins, so check its level before trusting
v. The town's firms are a sample plus named firms (`staff`), so vacancies
must be posted per industry, not per firm.

**Phase D status:** six changes on the branch, none merged. Every town still
shrinks. Do not merge until finding 11 is fixed and towns no longer shrink
for want of workers or homes.

**Earlier next step (still open):** let every working-age adult in a household hold a job. Either a slot
per adult, or the other adults as a counted group with their industries.
About 70 sites in households.ts assume three slots. Then re-measure 1 and 2
together. Also suspect: young adults blocked from forming households by
housing should be able to move away. That ties to mainland rent (#30), the
supply side of the region's housing.

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

## Phase 0 — the instrument (done)

`tools/econprobe/realism-score.mjs` reads the series that
`tools/econprobe/series.mjs` writes and prints each statistic beside a US
reference, with no verdict. Its header records the three definitions the first
cut got wrong: land deflated twice, participation's denominator, and wage
growth read without expected inflation.

---

## Re-measured after #850, #852, #856, #857 merged (main `1efddff`, 2026-11-24)

Same 4 towns x 30 years, paired against main before the merges (`53ecedb`).

| | before | after |
|---|---|---|
| office real rent, y/y sd | 6.4% | **11.8%** (max +33%) |
| flats real rent, y/y sd | 8.2% | **10.4%** (−30% to +36%) |
| office: vacancy → rent growth corr | −0.57 | −0.30 |
| Δcap ~ Δloan index (y/y): office / flats | 0.33 / 0.26 | 0.09 / −0.05 |
| cap ~ loan index (levels): office / industrial | 0.23 / 0.32 | 0.46 / 0.55 |
| months labelled recession | 30% | **43%** |
| label changes per decade | 19.3 | 16.4 |
| distressed share of sales | 5.5% | 6.8% |

Four towns is a small sample and paired runs diverge, so a correlation moving
0.2 is weak evidence. Rent volatility nearly doubling is not.

## Also seen on main (worth a look; each needs a mechanism check first)

These are outputs. Each *could* be a broken wire.

1. **Rents got choppier with #852** (rents and caps solved per address). Office
   real rent moves ±12% a year (sd), against 6% before. Find which term
   carries the swing: the per-address solve, the tax-loaded pencil, or the
   rent table.
2. **Year-on-year cap rates no longer follow the loan index.** In levels they
   follow it better than before. Check whether the cap read now lags (a longer
   evidence window, thinner trades) or whether buyers' debt cost has stopped
   reaching their bids.
3. **About 1 sale in 10 of shops and sheds closes at more than twice the
   model's own value** (p90 price ÷ model value: +107% retail, +116%
   industrial; this was already so before the merges). Find who pays it and
   for what: an assemblage, a redevelopment play, or a valuation that misses
   the site.
4. **Retail rents barely respond to retail vacancy** (corr −0.05; other classes
   −0.24 to −0.37).
5. *(closed)* Wages and slack: local pay follows a wage curve (pay relative to
   the nation against unemployment relative to the nation; Blanchflower &
   Oswald), a level relation set in `economy.ts` `postPayAndPrices`. A
   growth-rate correlation is the wrong test, not a broken wire.

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
    money. (Phase A turned out not to: nothing prices off the label.)
- **New constants** carry a source or an [S]/[D]/[M]/[K] tag. **New random
  draws** only for exogenous events, sized from data.
