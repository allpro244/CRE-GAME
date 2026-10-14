# Capital raising: deal-by-deal syndication, development JVs and a real fund market

Status: **proposal**. Every number below is either a cited industry convention
(say so in the code comment) or a shape parameter to be calibrated and labelled
as one (CLAUDE.md, "NO FAKE NUMBERS"). Nothing here is a balance target. The
test for success is not "the player wins more"; it is "a sponsor with a track
record and no money can do what such sponsors do in life, and one without a
track record cannot".

---

## 0. Why: evidence from six development-only centuries (Oct 2026)

Playthroughs on `7bfa46c`, `7d9f948` and `9137924`, played by a rule-based
developer bot (dirt and teardowns only):

- **$5M on Metropolis (3,084 lots): won.** #1 of 43, $6.81B by 2100. It took
  20 years to reach $17M, because jobs are equity-limited.
- **$1M on Great City (6,049 lots): could not grow.** 7 developments in 100
  years, all 4-storey apartment buildings of 3,800–9,400 sf. Final $19M, #62 of
  96; the leader had $20.5B. The quarterly whole-city scan found **242 sites
  that pencil** in the last year alone; of 699 owner calls, 494 were "too dear"
  for a $1–7M balance sheet under sane concentration limits.
- **What the game has today cannot help that player** (detail in §1):
  - `jv.ts` sells stakes only in stabilised, income-producing buildings. It
    raises no equity for a job.
  - `fund.ts` buys deeds, but construction equity on a fund lot still comes
    from the GP's own cash and line. `startDevelopment` never touches
    `fund.cash`.
  - A first fund needs two clean exits, institutional standing, an open credit
    window and a 3% GP co-invest in cash. Its size is set by a formula, not by
    investors.
- **The anonymous merchant builders already raise per-deal 90/10 equity**
  (`rivals.ts` ~L478, `dev.ts` `settleMerchant`). The player is the only
  developer in town who must write 100% of every job's equity.

In life, a $1M developer with a few completed jobs builds a $30M project by
writing 5–10% of the equity and syndicating the rest. That is the missing
mechanism.

---

## 1. What exists today (inventory)

| Piece | Where | What it does | Gap |
|---|---|---|---|
| Building JV | `src/engine/jv.ts` | Sell a 25% or 49% stake in a stabilised building at a 12% minority discount plus 1% costs; pro-rata cash, calls and exits; consent clause; buyout at full pro-rata equity | Income buildings only; no development or acquisition equity; no pref or promote; the partner is a passive price-taker |
| Player fund | `src/engine/fund.ts`, `ui/panels/FundDesk.tsx` | Blind pool, 8% pref, 20% promote, pref → capital → promote waterfall, capital called as deals close, 5-year investment period / 10-year life plus 2 one-year extensions, buy-in at NAV, "second death" if DPI < 1, promote taxed when paid | Size from a formula; terms fixed; no management fee; no strategy or LPA limits; can't fund construction; a successor needs the prior fund **fully settled** (real managers raise Fund II at 60–75% deployed); no competition for LP money |
| Raise gate | `fundRaiseQuote` | Standing, credit index ≥ 0.7, 2 clean exits, cash for the 3% co-invest | A gate, not a market |
| Merchant 90/10 | `rivals.ts` ~L470–492, `types.ts` ~L2568, `dev.ts` `settleMerchant` | Anonymous builders raise job equity from "national money"; 10% sponsor co-invest; investors paid at sale through the pref and promote | Not available to the player; investors don't share interim cash (noted there as an overstatement) |
| Firm entry | `rivals.ts` `firmEntryPitch`, `RAISE_M = 14` | New rival funds arrive on leverage × product × thin; 14-month raise clock; spin-outs | Draws from no finite pool; doesn't compete with the player |
| Track record | `types.ts` `Exit` (equityIn, equityOut, levered pre-tax `irr`), `sponsor.ts` marks | Every exit has deal-level IRR and multiple; foreclosures and handbacks mark the name for 10 years | Nothing reads IRR when capital is raised |
| Firm standing | `firmCapital.ts` | Readout only; "nothing in the economy reads it" | — |

---

## 2. Principles

1. **One capital market.** Investors are a finite population that rivals and
   the player both draw on. When the player raises $40M, that money isn't
   available to a spin-out that year. `firmEntryPitch` should end up reading the
   same supply.
2. **Investors are agents with mandates, not a dial.** Each investor type has a
   check size, a return target, a strategy appetite, a track-record
   requirement, a concentration limit and a re-up habit. Supply moves with
   things the engine already models: credit index, recent real-estate returns
   (the denominator effect), the national cycle, and swans (capital wave in,
   panic out).
3. **Terms clear in a market.** The player proposes terms (pref, promote tiers,
   fees, co-invest). Investors accept, counter or pass in proportion to how the
   terms compare with what that investor can get from comparable sponsors right
   now. Offering more to investors raises faster; asking more raises slower or
   not at all. Nothing is a difficulty setting.
4. **Track record is earned from the ledger.** Realised deal IRRs and
   multiples (`Exit.irr`), loss ratio, years active, fund DPI and TVPI, sponsor
   marks. No XP.
5. **Other people's money carries other people's rules:** consent rights,
   forced-sale windows, key-person, GP removal for cause, concentration limits,
   clawback. These are what stop syndication from being a money pump, not a
   tuned constraint.
6. **Conservation first.** Every new flow gets a books bucket before any
   gameplay (HANDOFF_PRINCIPAL.md §7 precedent: `lpCalled` and `lpDistributed`
   already exist).

---

## 3. The investor (LP) market

### 3.1 Investor types (initial roster; all shape-checked against the sources in §8)

| Type | Typical cheque | Wants | Accepts first-timers? | Deal-by-deal or blind pool | Pace |
|---|---|---|---|---|---|
| Friends, family and high-net-worth (local) | $50K–$2M | 12–15% IRR, simple pref deals | Yes; relationship-driven | Deal-by-deal | Fast (1–3 months) |
| Syndication platforms (accredited individuals, aggregated) | $1M–$10M per deal | 13–16% IRR, 8% pref, quarterly cash | Needs 2–3 realised deals | Deal-by-deal | 1–2 months |
| Family offices | $2M–$25M | 12–18% IRR; co-invest rights; often want deal-level control | Sometimes | Both | 2–4 months |
| Endowments and foundations | $10M–$75M | Opportunistic 15%+, value-add 12–14% | Rarely; a fund or two of history | Blind pool | 9–18 months |
| Public and corporate pensions | $25M–$250M | Core-plus 8–10%, value-add 11–13%; low fees; big managers | No; $250M+ AUM, 2+ funds | Blind pool and separate accounts | 12–24 months |
| Insurance companies | $25M–$150M | Core and core-plus; income | No | Separate accounts | 12+ months |
| Sovereign and foreign capital | $50M–$500M | Size, trophies, cyclical | Rarely | Programmatic JV and separate accounts | Cyclical; the capital-wave swan |

Each type is a **pool** with an annual allocation to real estate in this city's
region, refreshed each year:

```
allocation_t = baseAllocation(type) × wealth_t × denominator_t × riskOn_t
```

- `wealth_t`: the national economy and population, from regime and econ.
- `denominator_t`: if real estate marks fell faster than the investor's other
  holdings, it is over its target weight and cuts new commitments. This is the
  2009–10 drought. It reads trailing real-estate returns against a
  stock-and-bond proxy from the regime state.
- `riskOn_t`: credit index and phase. Panic swan → about 0 for 12–24 months;
  capital-wave swan → foreign pool multiplied while the wave runs.

The level of `baseAllocation` is calibrated so that the existing
`firmEntryPitch` firm-count trajectory is reproduced with no player (§9). That
is the anchor, not a free knob.

### 3.2 Sponsor score: who gets the money

Each raising window, every sponsor asking (player, rival funds, spin-outs,
merchant SPVs) gets a score per investor type:

```
score = gate(reputation, type) × fit(strategy, size, cheque) × reputation × terms × relationship × capacity
```

- **gate and reputation:** the firm's **reputation rating** (§3.4). It
  decides who will take the meeting at all, and how much the sponsor is
  trusted once they do. Track record lives inside the rating, so it isn't
  scored twice.
- **terms:** the offered net-to-investor IRR at a base-case pro forma vs the
  type's clearing net IRR; fee load vs norm; GP co-invest (more skin in the
  game raises the score).
- **relationship:** investors who were paid back by you re-up first (the
  re-up rate rises with the multiple they received). Investors you lost money
  for stay out for a decade, read from the same 10-year memory as
  `sponsorStanding`.
- **capacity:** pension and insurance pools refuse to be more than about
  20–25% of any vehicle, and won't back a fund smaller than a size floor.

Each pool's allocation is split across sponsors in proportion to score (a
softmax with a temperature, labelled as a shape parameter). Under-subscribed
raises fail or close small. Over-subscribed raises can upsize or tighten terms.
**This is the competition:** the player is bidding for the same dollars as the
rivals, with the same inputs.

### 3.3 Fundraising takes time and can fail

- **Deal-by-deal raise:** soft circles arrive over 1–3 months; the closing
  condition is "commitments ≥ equity need".
- **Blind-pool fund:** first close after 6–9 months (an anchor investor
  usually needs 20–30% of target), final close at 12–18 months (`RAISE_M = 14`
  already encodes this). Investors in later closes pay an equalisation
  interest charge.
- Investor commitments are monthly hazards driven by the score, not
  scheduled.
- **Abort costs are real:** legal and placement costs are sunk; a failed
  raise can lose the land deposit if the land was tied up on the
  syndication's timeline.
- **Placement agents:** pay 1.5–2% of capital raised (industry norm) to get a
  meeting **one band above** your reputation (§3.4). The agent's name opens
  the door; it doesn't change the rating, the terms that band demands of
  you, or the odds the investor says yes.


### 3.4 Investor reputation: one number per firm, earned from the record

Every firm, player and rival, carries two linked numbers:
- a **track-record score** from −100 to +100: the evidence, computed the
  same way for every firm from its own record. **The player always starts
  at 0.**
- an **investor rank**: where that score places the firm against every
  other living firm. **This is the reputation rating investors act on.** It
  is a strict ranking: exactly one firm is #1, and no two firms share a
  place (see "Reputation is relative" below).

Both show on the league table and on each firm's profile, with a breakdown
of why. Starting at 0 in a town of firms with records puts the player near
the bottom of the ranking, which in this business is not neutral but a
closed door.

**It is a readout of facts, not XP** (the `firmCapital.ts` rule). Nothing
grants reputation; it is recomputed each month from what the ledger and the
news already know.

**Scope: investors only.** The rating answers one question: *how do the
people who write equity cheques read this sponsor?* Nothing else in the
engine reads it. Each of these stays exactly as it is, and is out of scope
for now:
- lender marks and terms (`sponsorStanding`)
- what sellers remember about lowball bids (`recentLowballs`,
  `repFloorMult`)
- broker goodwill and the quiet-sale fee (`quietFeeRate`)

Bidding hard on a building is a negotiating matter between buyer and seller.
It says nothing about whether a sponsor returns investors' money, so it
doesn't touch this rating.

#### Design intent (owner, Oct 2026)

> Really hard to raise money at the beginning. As a sponsor slowly shows
> performance, the rating slowly builds, and investors only become interested
> once they are highly confident the sponsor will make them money. Screwing up,
> or not performing the way you said you would, has a big impact.

So the rating is modelled as **investor confidence that this sponsor delivers
what it promises**. Every number below is a starting design for that intent
and must be measured (§9). The evidence values and the shrinkage constant are
shape parameters, labelled as such in code.

#### The promise is what you are judged against

Every vehicle records, at closing, **what the sponsor told investors**: the
pitched net IRR, net multiple, distribution schedule, delivery date and
budget from the offering memorandum.

- The player chooses how to pitch: conservative, base or aggressive against
  the engine's own pro forma.
- An aggressive pitch raises faster today and sets a higher bar to clear
  tomorrow.
- Investors also haircut the pitch of any sponsor below Proven, so pitching
  high helps less than it looks.

Making money is not enough. **Delivering less than you promised counts
against you, even if investors got their money back.**

#### Evidence from each realised vehicle

When a vehicle is realised (sold, refinanced out, or wound up), it adds one
piece of evidence based on investors' actual net IRR vs the pitched net IRR,
and their actual multiple `M`:

| Outcome vs the promise | Evidence |
|---|---|
| Exceptional: beat the pitch by 5+ points **and** investors' multiple ≥ 1.8× | **+8** (capped: the biggest beats are partly luck) |
| Beat the pitch by 2–5 points | **+6** |
| Met the pitch (within 2 points either way) | **+4** |
| Missed by 2–5 points, investors still made money | **−8** |
| Missed by more than 5 points, investors got their money back (`M` ≥ 1.0) | **−15** |
| Investors lost a little (`M` 0.9–1.0) | **−20** |
| Investors lost money (`M` 0.7–0.9) | **−30** |
| Heavy loss (`M` 0.4–0.7) | **−45** |
| Wipe-out (`M` under 0.4) | **−60** |

Then the **fault multiplier**, judged against peers (same strategy, same
vintage window, from rival funds and merchant SPVs):
- **Market-wide:** peers missed by a similar margin. × 0.5.
- **Your deal:** peers delivered; you didn't. × 1.0.
- **Misconduct:** a broken completion guarantee, an unfunded GP call, an LPA
  breach, a removal for cause. × 2.0, plus a separate **−25**.

Then **size**:
- **Good results** are multiplied by the deal's **size weight** (next
  section), so a big success counts for more than a small one.
- **Bad results** are multiplied by × 0.6 to × 2.0, by the deal's share of
  all the investor capital you have ever managed. A blow-up on your biggest
  deal hurts most, whatever your track record.

Then **alignment**: × 0.85 on negative evidence if your own co-invest was at
least 10% and suffered alongside theirs.

#### Quality over quantity: experience is weighted by size

A record isn't a count of deals. Investors weigh **how much money** a sponsor
has handled and **how well**: three or four large, excellent deals say as
much as ten small ones. So each realised deal carries a **size weight**:

```
size weight = (equity in the deal ÷ reference deal) ^ (1/3)
```

The **reference deal** is about $2M of equity in opening-year dollars,
carried at inflation. That reference and the cube root are shape parameters.
The cube root gives diminishing returns: a deal 8× the reference counts as 2
small deals, and 27× counts as 3. Big deals matter, but one mega-deal can't
swamp a record (with a square root or linear weight it would).

| Equity in the deal (opening-year $) | Counts as |
|---|---|
| $2M | 1 small deal |
| $5M | 1.4 |
| $10M | 1.7 |
| $25M | 2.3 |
| $50M | 2.9 |
| $100M | 3.7 |

**Experience `N`** is the sum of the size weights of realised deals with
positive evidence, not the number of deals. It drives the small-sample
discount below and the experience requirements of each band.

Credit events (foreclosure, deficiency, deed-in-lieu, DPO, forced sale) that
are not already inside a vehicle's outcome add their own negative evidence,
read from `sponsor.events`. Reading them here doesn't change anything lenders
do.

#### Deals done with your own money also build the rating, slowly

A sponsor who spends years doing successful deals on its own balance sheet
earns a reputation from that alone. Investors check public deeds and sale
prices, and the engine already has each deal's own cash ledger (`Exit`:
equityIn, equityOut, levered pre-tax `irr`). But it counts for less than a
record with other people's money: no promise was made, nobody else's money
was at risk, and managing investors (reporting, alignment, calls) is a skill
the sponsor hasn't shown yet.

**Which deals count:** realised deals with a complete ledger (`Exit.irr` not
null), whether a development sold or a refinance that returned the equity.
Holdings that are still marked rather than realised don't count, same as
everywhere else.

**Evidence per own-money deal** (judged on its realised levered IRR and
multiple, since there was no pitch):

| Result | Evidence |
|---|---|
| Strong: IRR ≥ 20% and multiple ≥ 1.5× | **+3** |
| Good: IRR 12–20% and multiple ≥ 1.25× | **+2** |
| Modest: made money, below that | 0 |
| Lost money, no credit event | half the matching row of the investor table (−10 to −30) |
| Foreclosure, deficiency or forced sale | read from `sponsor.events` exactly as for any sponsor |

**Discounts:**
- **Half weight in experience.** Each own deal adds only half its size
  weight to experience `N` (its evidence values are already the lower ones
  in the table above), so it takes about twice as much own-money record as
  investor record to convince anyone.
- **Size.** Own deals use the same size weight as investor deals, so a run
  of tiny flips counts for little, and a few big, very successful jobs count
  for a lot.
- **A ceiling: own-money evidence alone can lift the score to +35** and no
  further, and can't qualify a firm above Emerging however it ranks. Proven and above need a record with
  investors' money, because that is the thing institutions are underwriting.
  Investor-deal evidence adds on top as usual.
- **The same fading** as other positive evidence (15–20 years), so the
  record has to stay current.

**What that looks like** (own deals only, before fading):

| Own deals realised | All "good" (+2) | All "strong" (+3) |
|---|---|---|
| 5 | +4 | +6 |
| 10 | +11, Emerging floor met | +17, Emerging floor met |
| 15 | +19 | +29 |
| 20 | +29 | +35 (ceiling) |

So a developer who quietly builds and sells a good job every year or two
clears the Emerging floor in **about 10 deals, roughly 15 years**. If that
also lifts them past enough of the street to rank into Emerging, they arrive
at their first syndication able to raise $3 per $1 instead of $1, with
better terms. That is exactly how many real sponsors start: years
of their own money, then their first outside equity.

For scale, career #4 in the October playthroughs (80 developments, 52
sales, median about 1.9× cost) would on own deals alone have reached
Emerging around 2043 and the +35 ceiling around 2048, about 45 years in.
That's a rough estimate from its sale multiples, ignoring the size
weighting.

#### Warning signs before the end (investor reporting)

Investors don't wait for the exit. Quarterly reporting on every live vehicle
can flag a deal, and each flag adds **−3 provisional evidence**:
- delivery more than 6 months behind the pitched date
- costs more than 10% over the pitched budget (a capital call, or a guarantee
  drawn)
- lease-up more than 12 months behind plan
- distributions below the pitched schedule for 4 quarters in a row

The provisional total is capped at −10 per vehicle. When the vehicle is
realised, its provisional evidence is replaced by the final evidence. Every
prospective investor can see these flags: a track-record tear sheet is the
first thing they ask for.

#### How confidence is computed: slow up, fast down

```
score = shrink(sum of positive evidence) + (sum of negative evidence)
shrink(x) = x × N / (N + 4)      N = experience: sum of size weights (above)
```

- **Positive evidence is shrunk** by how little experience it rests on: one
  small good deal is noise, while a dozen small deals or a few big ones are
  a record. The 4 is a shape parameter.
- **Negative evidence is never shrunk.** It lands in full the moment it is
  recognised.
- **Only realised results build the rating.** Marks and paper IRRs don't.
  Warning signs can only subtract. Own-money deals carry lower evidence,
  count half toward experience, and are capped at +35 on their own (above).
- **Memory:** positive evidence fades over 15–20 years, so a firm must keep
  delivering; ordinary negatives fade over 10 years; misconduct over 20.

What that produces for a sponsor doing **small deals** (size weight 1) and
meeting every promise (+4 a deal), before fading. The last column is the
highest band the **score floor** allows. The band actually held also depends
on rank (below).

| Clean small investor deals | Score | Highest band the floor allows |
|---|---|---|
| 1 | +0.8 | Unknown |
| 3 | +5 | Unknown |
| 5 | +11 | **Emerging** |
| 7 | +18 | Emerging |
| 10 | +29 | **Proven** |
| 12 | +36 | Proven |
| 15 | +47 | **Institutional** |
| 17 | +55 | **Blue-chip** (if one of them was a fund) |
| 23 | +78 | Blue-chip |

**Quality vs quantity, side by side** (before fading):

| Record | Experience `N` | Score | Highest band the floor allows |
|---|---|---|---|
| 10 small deals ($2M), all met the pitch | 10.0 | +29 | Proven |
| 4 big deals ($25M), all met the pitch | 9.3 | +26 | Proven |
| **4 big deals ($25M), all exceptional** | 9.3 | **+52** | **Institutional** |
| **3 big deals ($50M), all exceptional** | 8.8 | **+48** | **Institutional** |
| 10 small deals, all exceptional | 10.0 | +57 | Institutional (Blue-chip needs a fund) |
| 1 huge deal ($100M), exceptional | 3.7 | +14 | Emerging (one deal is still luck) |

So 3–4 large, excellent deals put a sponsor where 10 excellent small deals
do, and ahead of 10 merely adequate ones. A single home run is not a track
record.

Passing a floor only makes the band **possible**. You also have to outrank
enough of the street to be inside that band's rank share.

And what one failure does to the score of a sponsor at +36 (Proven) after 12
clean deals. Every firm behind you also gains a place on you while you
rebuild:

| Failure | Hit | New score | Clean deals needed to get back to +36 |
|---|---|---|---|
| Missed the pitch by 3 points, investors still made money | −8 | +28, barely over the Proven floor, and down the ranks | about 3 |
| Missed by 7 points, money back | −15 | +21, **Emerging** | about 4–5 |
| Your deal lost investors 20% | −30 | +6, **Unknown** | about 8–9 |
| Your deal wiped out | −60 | −24, **Questioned** | 15+, more than a decade |
| Broken completion guarantee, `M` 0.6 | −45 × 2 − 25 = −115 | −79, **Toxic** | effectively a new career |
| Market-wide crash, missed by 7 points, your co-invest lost too | −15 × 0.5 × 0.85 = −6 | +30, still Proven (and peers fell too, so your rank may rise) | about 2 |

#### Reputation is relative: a strict ranking

**Why relative.** Investor confidence is a relative good, like location value
in `demand.ts` ("demand is redistributed, never created"). Each year there is
a finite amount of investor money, and it goes to whoever looks best
**compared with everyone else asking**. A few top managers raise a large
share of each year's capital. Fundraising concentration is a well-documented
feature of private real estate; cite it in the code comment when calibrating.

**Mechanics:**

1. **Score every firm** with the evidence machinery above. That part is
   unchanged.
2. **Rank every living firm once a quarter** (investor-reporting cadence).
   Ties break deterministically, in order: score; lifetime investor capital
   returned in dollars; years since the last negative mark; firm age; a
   seed hash. No RNG stream is drawn, so the ranking never moves the
   economy's random draws. **No two firms share a place, and exactly one is
   #1.**
3. **The rating shown is the rank:** "#7 of 52", with a percentile from 100
   (#1) to 0 (last).
4. **Bands are set by rank**, as shares of the living firms, with a minimum of
   one firm so small maps still have a top:

   | Band | Rank |
   |---|---|
   | **Blue-chip** | top 3% (at least the #1 firm) |
   | **Institutional** | next 10% |
   | **Proven** | next 20% |
   | **Emerging** | next 27% |
   | **Unknown** | bottom 40% |

5. **And each band also needs a score floor.** Being the best of a weak
   field mustn't unlock pensions; early in a game, or after a crash,
   nobody may qualify. **Band held = the lower of the rank band and the
   score band.**

   | Band | Score floor | Also needs |
   |---|---|---|
   | Emerging | +10 | — |
   | Proven | +25 | investor-deal experience `N` ≥ 3, from at least 2 deals |
   | Institutional | +40 | investor-deal experience `N` ≥ 8, from at least 3 deals |
   | Blue-chip | +55 | investor-deal experience `N` ≥ 12, from at least 4 deals, including a fund |

   Two bands are **absolute**, whatever the rank: **Questioned** (score
   under −10) and **Toxic** (score under −40, or any live misconduct mark).
   A disgraced firm is not rescued by a street full of worse ones.
6. **Money follows rank, steeply.** Within each investor type's gate, its
   allocation is split by rank weight `w ∝ 1 / rank^α`. The exponent `α`
   is a shape parameter, starting near 1. The #1 firm gets the most, #2
   less, and a firm in the bottom half of a band gets little even when its
   score is close to the firm above. **Terms also slide by percentile
   within a band**: the top of Proven raises at better terms than the
   bottom of Proven.
7. **It's zero-sum, so others move you:**
   - a rival delivering a big fund pushes you down a place without you
     doing anything
   - rivals blowing up in a crash push you up, which is the "survivors
     raise the 2010 vintage" effect
   - new entrants come in at score 0, near the bottom; failed firms leave
   - a market-wide crash cuts everyone's score (at the ×0.5 fault weight),
     so ranks reshuffle by who was hurt **most**, while the score floors
     can close the top bands to everyone, which is a fundraising drought on
     top of the denominator effect
8. **Stability:**
   - upgrades need two consecutive quarters at the new rank, so one quarter's
     noise doesn't flip a band
   - downgrades caused by a negative event are immediate
   - scores only move on realised events, entries, exits and fading, so
     ranks don't churn month to month
9. **Player start:** score 0, which ranks just above any firms carrying marks
   and below every firm with a positive record, typically in the bottom few
   places at month 0 (for example around #44 of 48 on Metropolis). Unknown,
   by both rank and score.

#### Who invests, and on what terms

Investors only commit when confidence is high. On top of the rank weighting,
the chance a given investor says yes rises steeply toward the top of each
band (a logistic on percentile, as a shape parameter). So at the bottom of a
band you still mostly hear no.

| Band (rank and floor) | Who will invest | Max outside equity per $1 of yours | Pref | Promote you can get | Fees you can charge | Completion guarantee |
|---|---|---|---|---|---|---|
| **Toxic** (absolute) | Nobody | 0 | — | — | — | — |
| **Questioned** (absolute) | Only friends and family who were made whole before | $0.50 | 12%+ | none | none | personal |
| **Unknown** (player starts here) | Friends and family only, from a finite personal network | **$1 (a 50/50 deal)** | 12% | 0–10% above a 15% IRR | none | always |
| **Emerging** | + local wealthy individuals, small platform cheques | $3 (75/25) | 10% | 15–20% above 12% | development fee ≤ 2% | always |
| **Proven** | + platforms in size, family offices | $6 (85/15) | 9% | 20% above 12%, 30% above 18% | development 3%, asset management 1% | usually |
| **Institutional** | + endowments, smaller pensions; a first blind-pool fund | $9 (90/10) | 8% | 20/30 tiers with catch-up | market | lender-driven |
| **Blue-chip** | + large pensions, insurers, sovereign funds; programmatic JVs (§6) | $19 (95/5) | 7–8% | best | market or above | rarely |

Other limits on top of the band:
- **Blind-pool funds** need Institutional or better, which already implies
  real investor-deal experience (`N` ≥ 8 from at least 3 deals). Investors back a fund on a record, not a
  deal.
- **Step-up limit:** no raise above about 2–3× your largest successfully
  completed one (a shape parameter).
- **The friends-and-family network is finite.** It is a shape parameter sized
  at the start of the game, and grows slowly as you return money to it
  (people tell their friends). At Unknown it is the only money there is.

**What this means at a $1M start:** the first syndicated job is at best a
50/50 deal ($1M of yours, $1M of theirs, at a 12% pref with almost no
promote), if the network has the money and the pitch closes at all. Moving
up now takes **both** a score over the floor (5+ clean deals for the Emerging floor)
**and** passing the firms ranked above you, who are building records too.
One real miss costs a band and lets everyone behind you through.

#### Investors who lost money remember you personally

On top of the rating:
- **Friends and family, local wealthy individuals:** 70% of those who lost
  money leave the network for good, the rest for 10 years. A loss early in a
  career shrinks the only money available.
- **Syndication platforms:** delist you for 10 years after a your-deal or
  misconduct loss; 5 years after a market-wide one.
- **Family offices:** won't re-invest for 10 years. If the loss was
  market-wide, each comes back at 50% odds once the rating allows.
- **Endowments, pensions, insurers, sovereign funds (fund losses):**
  - market-wide: out for one fund cycle (about 10 years)
  - your fund below 1.0× while peers were above: out permanently
  - misconduct: everyone out permanently, except your own money and
    hard-money lenders

  This replaces today's blanket "a fund under 1.0× means nobody backs you
  again". Sponsors whose 2006–07 funds lost money with everyone else did
  raise again; fraud and broken guarantees end careers.

#### Terms while a negative mark is live

- **+1.5 points of pref** and **+10 points of GP co-invest** over the band
- a completion guarantee is mandatory again, whatever the band
- **the step-up limit resets** to 1× your largest raise since the failure,
  until the mark is half faded
- placement agents won't take you on while a your-deal or misconduct mark is
  live

#### Rivals

- **Same formula, same record.** Rival exits, merchant SPV outcomes
  (`Rival.jvs`), failures (`failedM` and its reason), handbacks and missed
  calls feed their rating exactly as the player's feed the player's.
- **Opening roster:** rivals dealt at month 0 already have histories the
  game implies (style, founding age, equity raised). Their opening rating is
  an **initial condition derived from those facts**, the way `regime.ts`
  runs a prehistory for the economy. For example, a decades-old institution
  opens Institutional, a newly raised opportunity fund opens Unknown or
  Emerging, and a family firm opens on its tenure. Write that derivation down
  and measure it; don't hand-assign it.
- **Spin-outs inherit part of the team's record:** about a third to a half of
  the parent's positive evidence (track-record portability is partial in
  practice) and none of its marks. New anonymous entrants start at 0, like
  the player.
- **Rival ratings then gate rival raising** in the shared investor market
  (§3.1–3.2). That means `firmEntryPitch` and rival fund sizes start reading
  reputation too. This is why it sits in P2 (§10).

#### What we'd expect to see if it's right (measure; do not tune toward it)

- A clean $1M developer reaches Emerging after about 7 realised deals that
  met their pitch, which at a few years a deal is most of a decade or more.
  Institutional money arrives decades in, if ever.
- A single missed pitch costs a band; a loss on your own deal sends a Proven
  firm back to Unknown; a broken guarantee is close to career-ending.
- Firms that pitch aggressively raise faster early and fall further later.
- By construction about 3% of firms rank Blue-chip, but in many years fewer
  hold it, because the score floor isn't met. Early in a game and after
  crashes, the top bands are empty.
- The ranking is stable quarter to quarter and reshuffles after crashes,
  with survivors rising.
- When the median rating on the street falls after a crash, total
  fundraising falls with it (on top of the denominator effect).

---

## 4. Product A: deal-by-deal syndication (the $1M developer's path)

This is the first thing to build. It reuses the merchant 90/10 machinery.

### 4.1 Flow

1. The player ties up a site (an option or a purchase contract with a
   deposit) or already owns it.
2. **Offering memorandum:** from the Build desk, "Syndicate the equity" on a
   pencilling scheme. The player sets:
   - GP co-invest: 5–20% of equity. 10% is the market norm for a development
     JV; institutions require 5–10%.
   - Pref: 6–10%. Promote tiers by IRR hurdle, e.g. 20% above an 8% pref to a
     15% IRR, 30% above.
   - Fees:
     - development fee: 3–5% of hard and soft cost, paid over construction
     - acquisition fee: 0.5–1%
     - asset management fee: 1–1.5% of equity a year
   - Business plan: build-and-sell at stabilisation, or build-and-hold with a
     refinance. LPs must accept the hold period.
   - Who to pitch (investor types, or "everyone who'll take my call").
3. **The raise runs** (§3.3) while the land contract runs. Outcomes: closed,
   partially subscribed (shrink the scheme or top up the co-invest), or failed.
4. **At closing:**
   - LP equity is called into a **deal vehicle** (an SPV with its own cash
     account, like `fund.cash`).
   - The SPV owns the deed; the player is GP and manager.
   - The construction lender sees the SPV's total equity, so the existing
     `devFundingNeed` test reads SPV cash plus the GP commitment.
5. **During the job, overruns are a capital call.** The LPA says either pro
   rata (LPs may default on calls: their stake is diluted and the GP must fund
   it) or **GP completion guarantee** (the GP funds overruns alone). That
   choice moves the investors' required return, and it's the main risk the
   developer is selling. The guarantee is also what lenders ask for, and why
   developers go broke.
6. **Operations and exit:**
   - Interim cash is distributed quarterly through the waterfall. This fixes
     the gap noted in `rivals.ts` L489.
   - Refinance proceeds go through the waterfall too.
   - Sale proceeds: return of capital, then pref, then promote tiers.
     Generalise `fund.ts` `waterfall` to IRR-hurdle tiers; keep the existing
     simple pref/promote as the one-tier case.
7. **Consent rights** (extend `jvConsent`): new debt, change of business plan,
   demolition or conversion, sale before or after the plan window. Two more
   clauses:
   - LP forced-sale or buy-sell right after the business-plan date plus 1–2
     years.
   - Removal of the GP for cause (fraud, a missed completion guarantee,
     bankruptcy) at a discount to the GP's interest.

### 4.2 Books and net worth

- **New buckets:**
  - `feesEarned` (development, acquisition and asset-management fees, which
    are GP income and taxable)
  - `placement` (G&A)
  - `promote` stays a transfer, as in `applyDistribute`
- **GP net worth** = co-invest share of SPV equity + the promote at
  liquidation value (`gpInterestInFund` per vehicle). It does **not** count
  100% of a building the LPs own 90% of.
- **League table:** keep equity as the ranking. Optionally show AUM beside it,
  as the trade press does.
- **Track record:** each SPV exit writes an `Exit` with a **gross** deal IRR
  and a **net LP IRR**. Investors read net.

### 4.3 What stops it being a money pump

- Finite investor allocations shared with rivals (§3).
- Reputation starts at 0 (Unknown) for the player: friends and family only,
  at most $1 of outside equity per $1 of yours, a 12% pref, almost no
  promote, mandatory guarantees, and raises that often fail. Confidence
  builds only from realised deals that met their pitch (§3.4).
- The GP co-invest is cash, as in `raiseFund`.
- Completion guarantees and clawbacks put the GP's own balance sheet at risk.
- A loss marks the name for future raises.
- Consent and forced-sale clauses stop the GP from holding a loser forever.
- `pnpm stress` "dominant strategy" must be re-run with syndication on (§9).

---

## 5. Product B: the blind-pool fund (revamp `fund.ts`)

Keep everything that's already right (the waterfall order, calls on close,
extensions and NAV buy-in, the second death, promote tax) and add the
following.

1. **Strategy declaration at the raise:** core-plus, value-add, opportunistic
   or development. It sets which investor types are interested, their target
   net IRR, and the **LPA limits the engine enforces**:
   - max share of commitments in one deal (15–25%)
   - max development share
   - max leverage (LTV or LTC)
   - geographic and use limits (optional)
   - recycling of proceeds allowed during the investment period
2. **Fund construction must be fundable from the fund.** Fix the gap:
   `startDevelopment` on a `fundOwned` lot draws equity from `fund.cash` and
   calls `fund.uncalled` (via `chargeFundEquity`), not the GP's own account.
3. **Management fee:** 1–1.5% of commitments during the investment period,
   then of invested capital. It's GP income (`feesEarned`) and pays the firm's
   overhead (`firmOverheadMonthly` already exists). This is how a fund
   sponsor survives the J-curve, and it's what makes raising worth doing
   before the promote ever pays.
4. **Catch-up and clawback:** GP catch-up after the pref (50–100%), and a
   fund-level clawback at wind-down if early promote was paid on deals that
   later losses wiped out.
5. **Successor funds overlap:** allow Fund II once Fund I is 60–75% committed
   or its investment period has ended, rather than requiring Fund I settled.
   This adds:
   - an allocation policy between Fund I, Fund II and the balance sheet
   - an investor-committee consent for cross-fund trades (the conflict
     regulators care about)
   - sizing from **Fund I's interim TVPI and net IRR and its quartile vs rival
     vintages**, not a re-up multiple keyed to a settled DPI
6. **Size from demand, not formula:** target size is a request. Final size is
   what the market commits (§3.2), capped by the investors' concentration
   rules and a 120–130% hard cap.
7. **Key-person and GP removal:** removal for cause; a no-fault removal vote
   (66–75% of LPs) if the fund is badly underwater.

---

## 6. Product C: programmatic JV and separate accounts (later)

Once a sponsor has scale (AUM and realised track record), a pension, insurer
or sovereign fund can offer a **programmatic JV**: a $100–500M commitment to
develop with this firm over N years.
- Terms: 90/10 or 95/5, deal-by-deal approval, exclusivity in the city for
  that strategy, a promote at lower tiers, and a buy-sell after stabilisation.
- The capital-wave swan is the natural trigger for foreign programmatic
  money, and its departure is the natural end.
- Rivals should get these too (the large `reit` and `foreign` styles).

---

## 7. Player experience

- **Capital desk** (replaces FundDesk):
  - an investor roster by type, showing appetite this year ("pensions are
    over-allocated to real estate after the crash; they're out until about
    2047")
  - a **track record card** (deal IRRs and multiples, DPI, the marks)
  - live raises with soft circles, commitments and time left
- **Term sheet builder:** pref, tiers, fees, co-invest, guarantee choice,
  with the **market-clearing band** shown for each targeted investor type
  ("family offices are clearing value-add deals at 8% pref, 20% over 14%").
  That keeps the decision legible instead of a hidden roll.
- **Build desk:** "Syndicate this scheme" next to "Break ground", showing the
  equity split, GP cheque, fees and promote at the base case.
- **News and stories:** raises that close or fail (yours and rivals'), the
  denominator-effect drought, an investor suing over a broken guarantee, a
  fund placed in the bottom quartile.

---

## 8. Calibration sources (industry conventions; cite in comments)

Write each of these into code as a **convention with a source**:
- **Fund terms:** about 8% pref, 20% promote with a 50–100% catch-up; 1–1.5%
  management fee for value-add and opportunistic, 0.75–1% for core; 1–5% GP
  commit. Sources: ILPA principles; Preqin and PERE fund-terms surveys.
- **Development JV:** 90/10 to 95/5; 8–10% pref; promote 20% to a 12–15% IRR,
  then 30–35%; development fee 3–5% of cost. (Practitioner norms; already
  cited for the 90/10 in `rivals.ts`.)
- **Fundraising:** 12–18 months to final close (`RAISE_M` = 14 already); an
  anchor investor for 20–30% of a first fund; investor concentration limit
  about 20–25%; placement fee about 1.5–2%.
- **Denominator effect:** institutional real-estate target allocations about
  8–12%; 2009–10 commitments fell by roughly two-thirds from 2007 (Preqin
  vintage data).
- **First-time funds:** a minority reach target size. Treat this as an
  **output to compare against**, not a constant to impose.

Shape parameters (label them as such): the score softmax temperature, the
weight of track record vs terms, the denominator lag.

---

## 9. Measurement plan

Order matters. Each phase lands with its measurement.

1. **Conserve first.** Buckets `feesEarned` and `placement`; per-vehicle cash
   accounts summed in `totalLiquidity`. Extend `conserve`'s coverage assertion
   so a syndicating bot must move them (CLAUDE.md "an identity is only worth
   the question it was asked").
2. **No-player anchor.** With the investor market feeding `firmEntryPitch`,
   the unplayed firm-count trajectory (`pnpm firms`) must stay inside its
   current behaviour. If it doesn't, the pool level is wrong, not the
   assertion.
3. **`pnpm capital`, new and paired:** the same seeds, the developer bot with
   syndication off vs on, $1M and $5M, Metropolis and Great City. Report:
   - time to first syndicated job
   - jobs per decade and peak concurrent equity under management
   - realised gross and net IRR distributions
   - fraction of raises that close
   - share of each year's investor allocation won by the player vs rivals
4. **Reputation, `pnpm reputation`, new:** the distribution of ratings
   across the street by decade; years for a clean sponsor to cross each band;
   how often firms fall a band and why; and a check that the rating can move
   both ways (CLAUDE.md "a test that cannot fail is itself a fake"). Paired
   counterfactual: the same seeds with the rating frozen at 0 for everyone,
   to confirm it is what moves fundraising.
5. **Plausibility bands (reports, not gates; owner policy on lettered tests):**
   - median realised LP net IRR on development SPVs about 10–15%, with real
     dispersion and losses
   - first-time fund close rate well below 100%
   - fundraising volume falling hard after crashes and panics
6. **`pnpm stress`:** dominant-strategy and money-pump checks with
   syndication on. Fees on other people's money must not make an empty firm
   compound without risk.
7. Re-run the six-century developer study (MDGA) and compare it with this
   document's §0.

---

## 10. Phasing

| Phase | Scope | Risk |
|---|---|---|
| P0 | Fund can pay construction on fund lots; successor fund doesn't need the prior one settled; investors share interim cash on merchant SPVs | Low; bug-level |
| P1 | Deal-by-deal development syndication (§4), reusing the merchant 90/10 book; IRR-tier waterfall; fees; completion guarantee | Medium; new vehicle type and books buckets |
| P2 | Investor reputation for every firm (§3.4), read only by the investor market; investor market (§3) shared by player and rivals; `firmEntryPitch` reads both | High; touches firm entry, which is load-bearing |
| P3 | Fund revamp (§5): strategy, LPA limits, fees, catch-up and clawback, overlap, demand-sized | Medium |
| P4 | Programmatic JVs and separate accounts (§6); swan hooks | Medium |
| P5 | Placement agents, investor relationships, press | Low |

---

## 11. Open questions for the owner

1. The league table ranks equity. Should AUM show beside it, or ever count?
   (Recommendation: equity only, AUM displayed.)
2. Should the player be able to syndicate **acquisitions** too, or development
   only at first? (Rivals already buy through funds, so allowing both is the
   realistic choice.)
3. Completion guarantee: a player choice per deal (moving terms), or always on
   for development, as most lenders require?
4. Investor names: generated institutions per type (like the four JV partner
   names), or anonymous pools with named anchors only?
5. A development-only run should count syndicated jobs as "development" for
   the MDGA mandate. Agreed?
6. Reputation scale and bands (§3.4): is −100 to +100, with named bands,
   the right presentation, or would a letter grade read better on the league
   table?
7. Own-money deals (§3.4): is +35 (the top of Emerging) the right ceiling
   for a record built without investors, or should a very long, very clean
   own-money record be able to reach Proven?
8. Should reputation be visible for every rival from day one, or only once
   you've dealt with them or they've raised money publicly? (In life you know
   the big names and not the small ones.)
