# Realism fix plan

## THE ROADMAP: toward a fully simulated economy (2026-11-25; start here)

**Target** (CLAUDE.md): every number comes from a mechanism or a sourced fact.
Measured by `pnpm mechanism` and the ledger:

| count | 2026-11-25 | goal |
|---|---|---|
| coins (decisions by dice) | 25 | 0 |
| draws inside the city | 242 | 0, or moved to outside shocks |
| unsourced constants | 259 | 0 (sourced or derived) |
| FORMULA_LEDGER rows open | 5 (#28 #29 #30 #31 #33) | 0 |
| load-bearing rails | ~25 (last counted 2026-08) | 0 |

Outputs are not targets (`tools/econprobe/realism-score.mjs` is a smoke alarm).

**Work rules learned the hard way (Phase D below):**
- One mechanism per session. Write the plan first, then build, then a one-month
  harness check, then 4 towns × 30 years, then merge.
- Never judge a core change by 30-year runs alone. They say THAT it broke, not
  WHERE.
- Before measuring: `git rev-list --count HEAD..origin/main` must be 0, and the
  bundle must be fresh (`pnpm engine`).

### Track A: the core economy, in dependency order (one at a time)

| # | piece | depends on | state |
|---|---|---|---|
| A0 | **One-month identity harness** (done: #867, first catch fixed #868) (`tools/econprobe/identities.mjs`, seconds): per industry, hires = filled − separations − quits − retirements − deaths; households = homes occupied + doubled-up; arrivals − departures = net migration; vacancies posted vs staffing gap; money in = money out. Run on any town at any month. | — | **next** |
| A1 | **Labour market: search and matching** (Phase D step 2) | A0 | **landed (v2)** — see Phase D, step 2, second build |
| A2 | Migration two-sided (Phase D finding 1) | A1, **A4** | re-applied on A1 and reverted again: free homes go first to the region's own doubled-up queue, so departures are replaced locally and the town shrinks (town 0: employment 40.5k → 34k) until housing answers |
| A3 | National orders won on staffed capacity (#28; finding 10) | A1 | **landed** (#871); #28 stays open (a fully staffed town still drifts to its opening share) |
| A4 | **Rents that price scarcity**, then supply by builder agents | A1 | **diagnosed** (below) |
| A5 | New-house price from closed sales (#29) | A4 | to plan |
| A6 | Online share per spending category, sourced reach (#31) | A0 | built, measuring |
| A7 | Re-count load-bearing rails (`tools/rail-audit.mjs`, ~15 min), then remove what A1–A6 leave | A1–A6 | to do |

### A4 diagnosis (2026-11-26)

Town 0, main `126dbed`, 20 years (`pencil.mjs` probe):
- the region's housing stock grows 10.1k → 14.3k (+41%): the supply curve
  answers;
- the doubled-up queue grows 790 → **4,240** households;
- the standard rent rises 1,429 → 1,827 (+28%) while CPI rises 72%, so REAL
  RENT FALLS through a shortage;
- the builders' pencil stays near its opening level (0.42–0.71 against
  0.56).

The market does not price scarcity. Every household bids a fixed 30% of
income on the ladder (`mainWill`, HH_RENT_SHARE0: Davis & Ortalo-Magné's
long-run cross-metro share). A doubled-up household bids only with verified
pay and three months' rent saved (`readyToRent`). So a growing queue moves the
rent only through which incomes sit at the margin, never through what people
will pay to avoid doubling up.

What A4 needs:
1. **A willingness to pay against the fallback.** A household bids up to the
   rent at which renting and doubling up leave it equally well off, not a
   fixed share. Cobb-Douglas with half the space doubled up gives only ~26% of
   income (α 0.3), which is below 30%. So the disutility of doubling up
   (privacy, conflict, commute) is the parameter that matters, and it has no
   source yet.
2. **Calibrate it to the household-formation response to rent.** Candidate
   sources to READ before using: Paciorek 2016 (J. Urban Econ. 93); Bitler &
   Hoynes 2016 on doubling up in the Great Recession. A Canadian figure (UBC,
   authors unnamed: −23% young-adult headship per $1,000 of median rent) was
   found and is NOT used.
3. Then builder agents (the remaining formula in #30). Then re-land A2.

### A4 first build (2026-11-26, held back; history on the branch)

Built: each household's own taste for a home of its own (logit, drawn once).
Slope from Paciorek's 0.121 (FEDS 2013-26, Table 2, read), level and slope
solved at the opening.
- **Used as every bid**, it priced the best tier off the top of the taste: the
  standard rent +67% in a year, 13,000 homes started, a 15,000-home glut.
- **Moved to the bottom of the ladder only** (the cheapest homes clear at the
  marginal household's keep-price), it behaves. But the doubled-up queue still
  grows (1,030 → 3,860): most doubled-up households have no verified pay or
  deposit and are not in the market at all. Priced out, not outbid.
- 4 towns × 30 years: jobs −4 to −6 points in three towns (unexplained),
  unemployment slightly lower. Not landed until the job loss is understood.

The lever for the queue is cheap homes (filtering, the older tiers' supply),
not the rent at the margin.

### A2, fourth attempt (2026-11-26, reverted again)

On top of A1, the room fix (#870) and the renewal auction (#874), two-sided
migration still shrinks town 0 (employment 41k → 31–33.5k in 20 years), even
when movers with offers compete for homes at renewal. Departures run 36–120
households a month and arrivals 0–99, while 1,500–2,800 movers with offers
wait in the queue and the region's free homes stay at turnover level.

The arrivals pass through a stack of gates:
- a monthly quota, `arriveAcc` = MOVE_M × min(1, pull) × households;
- the openings above the nation's rate;
- the local applicants' share (`outsiders`);
- the room check;
- the month's order: doubled-up locals take freed homes before the month's
  arrivals are processed.

That stack IS FORMULA_LEDGER #33. Fixing it means arrivals as a national pool
of movers choosing among places, matched to openings and homes in one market
with the town's own households. A redesign, not a patch. Until then the
one-sided outflow (households leave only when the town pays worse) stays.

### A6 sources (verified 2026-11-26, from the documents)

The online share today is a logistic toward ONLINE_MAX 0.4. That ceiling was
chosen because 0.5 "saturated by year 60 in a playthrough", which makes it a
rail. Around it sit three [K] constants. What to build instead is each
spending category's channel choice (logit) on price, toward that category's
own long-run reach.

| item | value | source |
|---|---|---|
| total online share of US retail | 0.9% (Q3 2000), 5.3% (Q4 2010), 16.6% (2024), 17.9% SA (Q3 2026) | Census Quarterly E-Commerce Report; tsnotadjustedsales.xlsx |
| online share by category, 2022 (2015) | electronics 48.8% (24.3); furniture 48.7% (22.4); clothing 35.9% (19.1); sporting/toys/books 47.0% (30.5); grocery 6.5% (1.4); health ≥12.4% (6.8) | Census ARTS 2022 benchmarked, ecommerce.xlsx + ecommerce4541.xlsx (calculated; general-merchandise stores sit outside the denominators, so these run high) |
| price elasticity of buying online | −1.2 to −1.4 (Amazon, all); −3.9 big-ticket | Baugh, Ben-David & Park, NBER w20052 |
| | ≈ −2 (eBay) | Einav, Knoepfle, Levin & Sundaresan 2014 AER |
| | 2.3–3.5 (1997, early adopters: an upper bound) | Goolsbee 2000, working-paper §IV |
| rent ÷ sales, retail | all 1.42%; furniture 4.0%; hobby/books 4.2%; electronics 2.0%; health 1.8%; building materials 1.3%; general merchandise 0.65% | Census ARTS 2022 bes.xlsx (paid rent only) |

So a shop's rent premium moves its price little (rent is 1–5% of sales), and
online's reach is a property of the category. The national adoption path is
an outside input (technology), and the town's deviation from it is price.

### A6 built (2026-11-26): option (a), a sourced reach per category

Where online buying has run longest it has stopped rising: UK online share of
all retail 27–29% 2022–26 after a 37.8% lockdown peak (ONS J4MC); China
physical goods online 26–28% 2022–25 (NBS). Food sells online at ~0.4 of the
non-food rate (UK food stores ~9–10.5% vs non-food ~25%, ONS KQ77/KQ78). So:

- reach 0.28 overall [S]; goods 34.2%, groceries 13.7% (from 0.4 and the
  households' own basket, groceries 30.2% of shop spending, CE 2023);
- both run on one adoption curve (technology plus the shop–shed rent gap),
  slope 10.785 [D] for 11% at year 20;
- check, not fitted: at Census 2022's 13.9% total the curve gives groceries
  6.8%; Census measured 6.5%;
- each household's grocery dollar and goods dollar go online at their own
  share (`spendVector`), so a poorer town, which spends more of its shop
  money on food, loses less of its high street;
- ONLINE_MAX (a playthrough rail) and ONLINE_GOODS [K] are gone. The latter
  fed only a retail index nothing read.

Open: autodealers sit in "goods" at the goods reach, but the UK and China
figures exclude vehicle sales, where online share is far lower. A vehicle
reach needs its own source.

### Constants that disagree with their sources (found 2026-11-26; each needs its own measured change)

| constant | ours | source says | note |
|---|---|---|---|
| `SF_PER_JOB` industrial / retail (market.ts) | 550 / 420 sf | warehouse ~2,400, retail (non-mall) ~1,600, malls ~690–990 sf per worker (EIA CBECS 2018, Table B2) | CBECS counts gross building area per worker, but 3–5× is far beyond that. Sets demand per job and the opening's jobs (`jobs0` = stock / sf per job), so a change re-sizes every town. |
| `SPEC_COST_PSF` office (leasing.ts) | $31.5 | spec suite $80–110/sf CBD (Cushman & Wakefield, 2023); US average fit-out $162/sf (C&W Fit Out Cost Guide 2026) | $31.5 is shell-space level. The TI-allowance comment beside it ($15–40) is dated too. | **Fixed 2026-11-26:** office $95, retail $80 (C&W 2023, ICSC 2023). Office TI_ASK [2.6, 6.0]/yr is still open: CBRE puts the average new-lease allowance at $87.51 (2024, 12 markets, term not stated), against $21–48 for an 8-year lease here. A source with lease terms is needed before changing it.
| `NORMAL_NIM` bank (lenders.ts) | 4.1 | industry 3.39%, community banks 3.77% (FDIC Quarterly Banking Profile, Q4 2025) | The "Cordage sheet" it cites could not be checked. |
| `CAP_PREMIUM_PCT` | 1.25% | 0.2–0.4% (2022) to 1–2.3% (2023) | Should be priced as an option on rates. |

### Track B: the audit grind (parallel, small PRs, does not touch Track A's files)

Lists: `node tools/mechanism-audit.mjs --list coin|draw|unsourced`. For each site:
1. Source it (a citation, or an [S]/[D]/[M] tag with the derivation).
2. Or replace the draw with what the model can compute (CLAUDE.md fake six: dice
   may choose WHO, never HOW MUCH or WHETHER).
3. Or move it to an outside shock, sized from data.

Each PR lowers the baseline (`--update`) and says by how much. Order: coins
first (25, they decide outcomes), then the largest files by draws (rivals.ts,
actions.ts, dev.ts), then unsourced constants by file. Keep Track B sessions
off economy.ts and households.ts while Track A is working there.

### Owner decisions waiting
- GitHub default branch → `main` (Settings → General).
- PR #858 (non-recourse rival debt, draft, makes failures worse by its own numbers).
- PR #851 (anchor swan): its three town-centre constants need a source or a derivation.
- Whether to run several Track B sessions at once.

---

## The five findings of 2026-11-24

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

*First build attempt (2026-11-25, reverted; history on
claude/youthful-franklin-ee5xyi).* Built: vacancies capped by free entry at
θ* = θ_nat·(J/J0)^(1/(1−η)) × searchers, the elastic filling rate, Nash pay
β·(c/w)·(θ − θ_nat) with β = 1 − MATCH_ETA and COST_PER_HIRE_M 0.75
(Manning), J/J0 from EBITDA per head (route b). Measured, 4 towns × 30 years:

| variant | openings | jobs (yr 30) | unemployment (yr 30) |
|---|---|---|---|
| step 1 (main) | 12–16% | −7% to +7% | 4.5–5.6% |
| caps split by heads share | 3.3–4.0% | −35% to −41% | 9–14% |
| same, job value held flat | 4.7–6.6% | −27% to −32% | 7–10% |
| caps split by staffing gap | 3.6–6.3% | −19% to −38% | 5.7–33% (2 runs died) |
| + start-of-month stock × (1 + q) | 3.9–10% | −21% (1 town) | 26.5% (3 runs died) |

Openings do what the theory says. Jobs and unemployment do not, and runs
die silently. An earlier variant crashed with "Invalid array length" in the
movers' slot list (`for (let v = open[ind]; v >= wR / 2; v -= wR)
slots.push`), so the silent deaths are most likely the same runaway
exhausting memory.

Lessons for the next attempt:
1. **Hires are the vacancy stock × the filling rate, and they must cover the
   month's separations, quits, retirements and deaths.** Check that identity
   on the first month of a town before any long run. The cap units were wrong
   once already (JOLTS's openings are a month-END stock).
2. **EBITDA per head is too volatile for J's moves.** Rent and fixed costs
   over fewer heads collapse it in a slump. Take J's moves from the margin per
   unit of output, or hold J flat until a better read exists.
3. **Guard the movers' slot loop** against a non-finite or huge `open[ind]`
   (a definition, not a rail: a count of openings is finite).
4. **Develop with a one-month, one-town harness**: hires vs separations by
   industry, vacancies vs gap, the filling rate. Use 30-year runs only to
   confirm.

*Second build (v2, 2026-11-26, landed).* Developed against the harness's
monthly trace (`TRACE=1`), not 30-year endpoints. Three faults found that way,
each in under ten minutes:
1. **Job value in dollars grew with inflation**, so pay ran away (pay/nat
   1.02 → 2.49 by year 20).
2. **In real terms, AVERAGE EBITDA per head fell** with fixed costs over fewer
   heads, so pay sank (0.71×) while a fifth of jobs went unfilled.
3. **Bargaining on the firms' theoretical tightness** left pay flat while the
   measured tightness ran 4× the nation's.

What landed:
- vacancies by free entry, θ* = θ_nat·jr^(1/(1−η)), with jr = a hire's
  MARGINAL surplus per $ of output (P(1−tax) − inputs − comp·W) over the
  industry's operating-surplus share (BEA);
- vacancies allocated by staffing gap, at month-START units (× (1 + q));
- the elastic filling rate;
- Nash pay on the town's MEASURED tightness (month-end openings over the
  jobless), β = 1 − MATCH_ETA, c/w from COST_PER_HIRE_M (Manning);
- `V_SLOPE` deleted; openings published as the month-end stock; the movers'
  slot list guarded.

Town 0, 20 years: employment 42–44.5k, unemployment 4.4–7.6%, openings
3.5–7%, pay up to 1.26× the nation's in the tight years and back to 1.11×.

4 towns × 30 years against main `dce542a`:

| | main | A1 |
|---|---|---|
| openings at year 30 | 10–17% | 4.5–7.1% |
| jobs vs opening | −11% to +9% | −12% to −5% |
| local unemployment, mean | ~5.5% | 6.5% (one town 9.3% at year 30) |
| population | −5% to +14% | −7% to +5% |

Openings are realistic and population no longer grows without jobs. Fewer
orders get staffed: firms no longer count hires they could never make. Both
openings and unemployment sit a little above normal, which suggests mismatch
(which industries post vs who is looking). Look at that next, by industry, in
the harness.

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
