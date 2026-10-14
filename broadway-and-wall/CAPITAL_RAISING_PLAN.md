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

## 0.5 Build order and safety plan (start here)

This document describes the full system. **Build it in this order**, each
step behind its own flag and measured before the next. The danger in this
change isn't a loud break; it's shipping with every check green while money
quietly goes to the wrong party.

1. **Write the missing identity first: vehicle conservation.** `conserve`
   reconciles totals; it can't see the sponsor being paid what the investors
   were owed. Add a check, every month, on every exit path (including forced
   swans, foreclosures, 1031s and recaps):
   - each vehicle's cash = calls − distributions ± its own flows
   - investors' and sponsor's capital accounts sum to the vehicle's equity
2. **Unify ownership** (§12.1). Move `fundOwned` and `jv` onto one ownership
   record and one routing function. **Prove it changes nothing:** same seeds,
   same state hash, before and after.
3. **Fix the as-is mark** for buildings in lease-up (realism finding #1), so
   promotes and recap prices don't inherit phantom value.
4. **Minimum viable slice**, which is what unblocks a small developer:
   - the fund pays construction on fund lots
   - deal-by-deal syndication with a waterfall, fees and a co-invest slider
     (§4, §4.4)
   - the reputation **score** (no ranking yet), from investor and own-money
     deals (§3.4)
   - the deal's business plan as its only mandate
   - a capital-source picker (§6.5)
   - the conserve bot and the MDGA driver exercise all of it
5. **Then, one flag each,** paired before/after on the same seeds:
   1. the investor rank (§3.4, relative)
   2. the finite investor pool and city attractiveness (§3.1), for the player
      and rival funds only
   3. dynamic fund mandates (§5.1) and the fund revamp (§5)
   4. recap buyouts (§4.5) and side money
   5. firm entry reading the pool (`firmEntryPitch`)
   6. merchant builders on the pool, last and most carefully
6. **Never tune toward a feel.** Every reputation and pool number here is a
   starting design or a cited convention. If raising money is too easy or
   too hard, find which real mechanism is missing (CLAUDE.md).

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

#### The money is a real, finite pool, and this city competes for it

Investor money is **a finite pool that every firm in town draws from**:
- the player
- rival funds and spin-outs
- new entrants
- (behind a flag, see below) the anonymous merchant builders

A dollar committed to one sponsor is gone for everyone else that year. How
big the pool is depends on **how attractive this city looks next to other
cities**, because that is the real decision: national investors don't ask
"should I invest in real estate here?", they ask "here, or Austin, or
Columbus?"

**Step 1: the national pool, per investor type, per year:**

```
national_t(type) = base(type) × wealth_t × denominator_t × riskOn_t
```

- `wealth_t`: the national economy and population, from the regime and
  econ state.
- `denominator_t`: if real-estate marks fell faster than investors' other
  holdings, they're over their target weight and cut new commitments. This
  is the 2009–10 drought. It reads trailing real-estate returns against a
  stock-and-bond proxy from the regime state.
- `riskOn_t`: credit index and phase. A panic swan takes it to about 0 for
  12–24 months; a capital-wave swan multiplies the foreign pool while the
  wave runs.

**Step 2: this city's share of it.** The share comes from the city's
**attractiveness relative to other cities**. That is read from what the
engine already computes in `peers.ts` (`cityRankings`: this town against 32
real US cities, all measured relative to the nation in the same year):

| Factor | Source | Effect on the share |
|---|---|---|
| **Growth:** population growth over 10 years vs peers | `cityRankings` growth10 | Growth cities draw money (the biggest factor for value-add and development investors) |
| **Jobs:** unemployment gap vs peers | `cityRankings` unemp | Weak job markets repel money |
| **Pay and rent growth** | `cityRankings` pay, rent | Rising incomes support rent growth |
| **Return over the cost of money:** going-in yield plus underwritten growth, minus the coupon | The same spread `firmEntryPitch` reads | A cheap city can attract yield buyers even without growth: the "secondary market" trade |
| **Liquidity:** trades per year and depth of the tape | `lastTradeM`, `cityJobs` (as `firmEntryPitch`) | Institutions avoid markets they can't exit |
| **Size** | Lots and population (`cityscale.ts`) | Pensions and sovereign funds need big markets: a Hamlet barely registers to them, a Great City does |
| **Shocks:** recent fiscal crisis, fire, storm surge; a campus | `econ.blackSwans` | Fiscal crises and surges cut the share for years; a campus announcement lifts it |

```
cityShare_t(type) = baseShare(size, type) × attractiveness_t(type)
pool_t(type)     = national_t(type) × cityShare_t(type)
```

- **Each investor type weights the factors differently** (shape parameters,
  stated as such):
  - pensions and insurers: size, liquidity, low risk
  - endowments and opportunistic investors: growth and dislocation
  - local friends and family: this town only, regardless of how it compares
  - yield buyers: the spread
- **Attractiveness is relative,** like demand in `demand.ts` and like the
  investor rank: it's this city's standing against its peers, so the city
  doing well in a nationwide boom doesn't by itself pull more money.
- **The friends-and-family pool is the exception.** It's local wealth (§3.4),
  sized by this town's own population and incomes, and it doesn't flow away
  to other cities.

**Step 3: the pool is drawn down.**
- Each year's pool is the money available to every sponsor in town.
- Commitments draw it down in the order the raises close.
- What isn't committed by year end mostly goes elsewhere: a small carry, as
  a shape parameter, the rest gone.
- When the pool runs dry, later raises that year close small or fail, **yours
  included**, which is the competition.

**Visible to the player** (Investors tab, §7.2): "Investors put about $X
into towns like this a year; $Y committed so far; this city ranks 19th of 33
for investors (growth strong, jobs weak, too small for most pensions)."

**What it should produce (measure, don't tune):**
- a growing, job-rich city attracts more money, and more firms enter
- a stagnant or shocked city sees capital dry up and firms thin out
- a cheap, high-yield city attracts some yield money even without growth
- Great City maps draw institutional money that Hamlets never see

**Calibration anchor:** the pool's level is calibrated so that, with no
player and no merchant builders on the pool, the existing `firmEntryPitch`
firm-count trajectory is reproduced (§9). That is the anchor, not a free
knob.

**The merchant builders: a flag and a big decision.** Today the anonymous
merchant builders raise each job's equity from unlimited "national money"
(`rivals.ts`, `fundAnonymousCityJob`). They build about five-sixths of the
city's new space. Putting them on the same finite pool is realistic (city
supply would then answer to investor appetite), but it **changes the city's
whole supply and glut behaviour**. Ship it behind its own flag and measure
it separately (§12).

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

#### Deals done with your own money count almost as much

In life, raising money comes down to the story and the track record behind
it, and deals done with your own money are part of that record. So a
sponsor's balance-sheet deals count **almost as much** as deals done with
investors. Investors check public deeds and sale prices, and the engine
already has each deal's cash ledger (`Exit`: equityIn, equityOut, levered
pre-tax `irr`).

**Which deals count:** realised deals with a complete ledger (`Exit.irr` not
null), whether a development sold or a refinance that returned the equity.
Holdings that are still marked rather than realised don't count, same as
everywhere else.

**What they're judged against: their own underwriting.** An own-money deal
had no pitch, but it had a plan. When a job breaks ground (or a building is
bought), the engine records the base-case projected levered IRR and
multiple from its own pro forma: the "projected" column of a sponsor's
track-record sheet. At realisation the deal goes through **the same evidence
table as an investor deal**, actual vs projected, with the same fault, size
and alignment rules.

**The one difference: 90% weight.** Own-money evidence is multiplied by
**0.9**, as a shape parameter. The 10% gap stands for what an own-money
record can't show yet: other people's money handled, reported on, called and
returned. It applies to good and bad results alike. Size weight and
experience `N` count in full.

The one hard requirement left: **Institutional and Blue-chip need at least
one realised investor vehicle** (Blue-chip also needs a fund). Pensions and
endowments want to have seen a sponsor manage outside capital at least once.
Everything up to Proven can be earned on your own record.

**What that looks like.** Take a $5M start that does 4 big own-money
developments, recycling the equity, and reaches $100M by 2040. Each sale is
about 2.1× the equity in about 4 years (about 20% IRR), on equity of roughly
$3M, $6M, $10.5M and $20M in opening-year dollars. Size weights total 6.5.

| How each deal did vs its own projection | Evidence per deal (× 0.9) | Score in 2040 | Highest band possible |
|---|---|---|---|
| Exceptional (beat by 5+ points, 1.8×+) | +7.2 | **+29** | **Proven** |
| Beat by 2–5 points | +5.4 | +22 | Emerging |
| Met the projection | +3.6 | +15 | Emerging |
| The same 4 deals with investors, exceptional | +8 | +32 | Proven |

So a strong solo record lands within a few points of the same record built
with investors' money. The band actually held still depends on rank against
the rest of the street.

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
  Warning signs can only subtract. Own-money deals count at 90% (above).
- **Memory: a record goes stale when the firm goes quiet, not just because
  it's old.** Positive evidence keeps full weight while the firm keeps
  realising good deals. Once 7 years pass without a realised deal with
  positive evidence, the whole positive record starts fading, reaching zero
  10 years later. It snaps back to full the next time a good deal is
  realised. Separately, any single deal over 30 years old drops out. Ordinary
  negatives fade over 10 years; misconduct over 20.

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
   | Proven | +25 | experience `N` ≥ 3, from at least 2 deals (own-money deals count) |
   | Institutional | +40 | experience `N` ≥ 8 from at least 3 deals, including at least one realised investor vehicle |
   | Blue-chip | +55 | experience `N` ≥ 12 from at least 4 deals, including a realised fund |

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
  experience `N` ≥ 8 from at least 3 deals, including at least one realised
  investor vehicle. Investors back a fund on a record, not a deal.
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
   - **Your co-invest: any amount you choose**, from the minimum your
     reputation band requires up to nearly all of the equity (§4.4). 10% is
     the market norm for a development JV; institutions require 5–10%.
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

### 4.4 How much of your own money goes in: your choice

On any deal using outside capital (a syndication, a fund-plus-sidecar, or a
JV), **the player chooses how much of their own money to put in**, on a
slider in the term sheet builder.

**Limits:**
- **Minimum:** set by your reputation band (§3.4, "max outside equity per $1
  of yours"):
  - Unknown: 50% of the equity is yours (1:1)
  - Emerging: 25%
  - Proven: about 15%
  - Institutional: 10%
  - Blue-chip: 5%

  A live negative mark adds 10 points (§3.4).
- **Maximum:** no fixed cap. The practical limits are your cash (co-invest is
  cash, never the line, as in `raiseFund`) and the investors' minimum cheque:
  if the outside share gets too small, the investor types you're pitching
  won't bother. A pension won't write $2M into a $40M deal.

**What putting in more changes:**

| | More of your own money | Less of your own money |
|---|---|---|
| **Raise** | Smaller raise; faster and more likely to close; investors score you higher for alignment (§3.2) | Bigger raise; slower, and more likely to fail |
| **Terms** | Investors accept a lower pref and a richer promote: skin in the game buys trust | Investors demand more, up to the band's worst terms at the minimum |
| **Your share of the profit** | Your pro-rata share **plus** the promote on the investors' share. More equity means more of the upside is plain ownership. | Most of your upside comes through the promote |
| **Your risk** | More of your own capital lost if it goes wrong, so concentration and liquidity matter (the lessons of careers #1 and #3) | Less at stake, but a failure costs investors more, and their memory of you (§3.4) |
| **Reputation if it fails** | The alignment discount (× 0.85 on negative evidence) applies once you're at 10% or more | No discount below 10% |

**How the deal counts on your record:** a deal's evidence weight blends
between the own-money weight (0.9) and the investor weight (1.0) by the
outside share of the equity: `weight = 0.9 + 0.1 × outside share`. That way
raising a token $50K can't turn an own-money deal into an "investor deal".
For the **Institutional and Blue-chip** requirement of a realised investor
vehicle (§3.4), the outside share must be **at least 25% of the equity and
at least one reference deal in size**.

**The same choice applies to funds.** The GP commitment to a blind-pool fund
is a slider too:
- from the market minimum (1–3% of commitments, more for a first-time or
  low-ranked sponsor)
- upward, at the player's choice

A larger commitment raises the investor score and can loosen the mandate
(§5.1). As today, it is cash at the close, never the line.

### 4.5 Refinance your partners out and keep the building (a recap buyout)

A common real exit: at stabilisation or later, the sponsor refinances, uses
the proceeds (and its own cash) to buy the investors out at an appraised
value, and keeps 100% of the building. The promote it earned turns into
ownership instead of cash.

The engine has the pieces but not the transaction: `jv.ts` `buyOutPartner`
(full pro-rata equity plus costs), and `refinance` already shares a JV's
cash-out with the partner.

**When it's allowed:**
- **Deal-by-deal syndications:** after stabilisation, or in the business
  plan's buy-sell window (§4.1).
- **Building JV stakes** (`jv.ts`): any time, as today's buyout does.
- **Fund properties:** only as a cross-trade, with investor-committee
  consent and an independent appraisal (§5). Never during the investment
  period for a deal the fund is still building.

**The price is what investors would get on a sale.** Run the vehicle's
waterfall on a hypothetical sale at an **independent appraisal**
(`marketAppraisal`), with no selling costs, since nobody pays a broker:
- Investors get their capital, their pref and their tiers, exactly as if it
  had sold.
- The sponsor's promote crystallises into extra ownership; no cash moves to
  it.
- Investors can refuse. Below Proven they ask for a **fairness premium** of
  2–5% over the waterfall value (a shape parameter, by band). In a hot
  market, investors may prefer a real sale.

**How it's funded:**
1. **A new loan**, sized by the lenders exactly as any refinance is today
   (DSCR, LTV, hold limits).
2. **Your own cash** for the gap.
3. Optionally **preferred equity or mezzanine** (`placeMezz` exists), at a
   higher cost.
4. Or **a new investor buys the old ones out** (a continuation vehicle).
   The building stays in a vehicle you run, with fresh terms from the
   investor market (§3).
5. **Partial buyouts are allowed:** buy back part of the investors' stake.

**What the example deal costs** (Appendix A, Proven band: you 15%, 9% pref,
20%/30% above 12%/18%):

| When | Appraisal | New loan | Cash from the refinance | Buy out investors at | Investors' IRR | **You must add** | You then own 100%, with equity |
|---|---|---|---|---|---|---|---|
| Year 4, 65% LTV | 64.4 | 41.8 | 10.9 | 27.5 | 15.9% | **16.6** | 22.5 |
| Year 4, 75% LTV | 64.4 | 48.3 | 17.3 | 27.5 | 15.9% | **10.2** | 16.1 |
| Year 10, 65% LTV | 76.9 | 50.0 | 10.0 | 29.2 | 14.4% | **19.2** | 26.9 |
| Year 10, 75% LTV | 76.9 | 57.7 | 17.6 | 29.2 | 14.4% | **11.6** | 19.2 |

So a refinance alone almost never buys out 85% partners, and the sponsor has
to bring real money. It's no free lunch either: at year 4 and 75% LTV your
stake is worth about $5.9M before the recap; you add $10.2M and own $16.1M
of equity. What you buy is **all of the future upside, no more pref or
promote to share, and the right to hold forever**. You pay for it with
higher leverage, which brings back the refinance-cliff risk of careers #1
and #3.

**Books and tax:**
- payment to investors → `lpDistributed`
- new loan → `borrowed`
- old loan payoff → `debtSvc`
- **transfer tax** on the share transferred when control changes hands
  (over 50%), using the existing `TRANSFER_TAX`
- no income tax to the sponsor, since it isn't selling; the purchased share
  gets a basis step-up

**Reputation:** investors who are bought out at a fair waterfall price
count it as a **realised exit** (§3.4: evidence vs the promise). One
anti-exploit rule: if the sponsor sells the building within **24 months**
for more than **15% above** the buyout appraisal, investors read it as having
bought them out cheap. That is −10 evidence, and the bought-out investors
remember it personally (§3.4). In life this is the lawsuit.

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

### 5.1 The mandate: what this fund's investors require

When a fund closes, the player gets a **mandate card**: the investors'
requirements in plain words. For example:

> **Fund I: $40M, closed March 2034.**
> - Capital must be committed to deals within **3 years** of closing.
> - Investors expect a **6% annual cash distribution** once properties
>   stabilise.
> - Every property must be sold within **6 years** of closing (two one-year
>   extensions by investor vote).
> - Target: **15% net IRR, 1.7× net multiple.**
> - No more than **20%** of the fund in one deal; leverage capped at **65%**.

**The mandate is dynamic.** It isn't a fixed template. It is assembled at the
close from the **levers the committed investors actually care about**, so two
funds by the same sponsor can carry quite different mandates, and some
levers are absent altogether.

#### The levers

| Lever | Plain-words example | Who tends to insist on it |
|---|---|---|
| **Deployment deadline** (investment period) | "Committed to deals within 1–4 years" | Everyone; shorter for single-strategy or club funds, longer for blind pools |
| **Cash yield** (distribution rate) | "6% a year once stabilised", "quarterly distributions" | Pensions, insurers, income-focused individuals. Often **absent** for opportunistic and development funds. |
| **Sale-by date** (fund life) | "All sold within 5–10 years" | Closed-end investors. **Absent** for open-ended or long-hold family-office capital, which wants holds instead. |
| **Target net IRR** | "18% net IRR" | Endowments, opportunistic investors |
| **Target net multiple** | "1.8× net" | Family offices, endowments |
| **Leverage cap** | "No more than 60% LTV across the fund" | Pensions, insurers; loose or absent for opportunistic money |
| **Concentration limit** | "No deal over 15–25% of the fund" | Institutions |
| **Strategy and use limits** | "Multifamily and industrial only", "development ≤ 30%" | Mandate-driven institutions |
| **Pre-leasing for development** | "No spec office: 40% pre-leased before groundbreak" | Conservative investors after a glut |
| **Recycling** | "Sale proceeds can be reinvested during the investment period" or "must be distributed" | Varies |
| **Co-invest rights** | "Largest investors get first look at any overflow" | Family offices, sovereigns |
| **Reporting** | "Quarterly, audited annually" | Institutions (adds a small cost) |
| **Key person / removal** | "If the founder leaves, investing stops" | Most |

#### How the mandate is generated

1. **The strategy the player declares** sets the starting point:
   - **Core-plus:** 6–8% cash yield, 8–11% IRR, 7–10 year life, 50–60%
     leverage cap
   - **Value-add:** 4–6% yield after stabilisation, 12–16% IRR, 4–7 years,
     about 65%
   - **Opportunistic / development:** little or no yield, 18–20%+ IRR, 5–8
     years, 70–75%
   - These ranges are industry conventions; cite them in comments.
2. **The investors who commit add or drop levers.** Each investor type
   carries preferences (§3.1):
   - pensions add a yield floor and a leverage cap
   - endowments add an IRR target and don't care about yield
   - family offices drop the sale-by date but want co-invest rights
   - sovereigns want size and a concentration limit
   - the mandate is the **union of the levers its largest investors insist
     on**, weighted by their share of commitments
3. **Market conditions move the numbers:**
   - after a crash or a panic swan, investors demand higher targets, lower
     leverage and pre-leasing
   - in a boom they accept looser terms
   - this reads the same credit index and recent-returns signal as the
     investor market (§3.1)
4. **Your rank moves them too.** Top-ranked sponsors negotiate looser
   mandates (longer deployment, fewer covenants). Low-ranked ones get more
   levers and tighter numbers.
5. **The player can negotiate before the close.** Each lever can be accepted
   or pushed back on in the term sheet builder (§7):
   - **refusing a lever** loses the investors who insist on it (smaller fund)
   - **accepting a tighter one** brings them in (bigger fund, harder to
     live with)
   - example: refusing a cash-yield requirement drops the pensions;
     accepting a 1-year deployment deadline wins the impatient money but
     forces fast deals

#### Hard covenants vs targets: what happens if you miss

Some levers are **covenants** the engine enforces; others are **targets**
your reputation is judged against (§3.4).

| Lever | Type | If you miss it |
|---|---|---|
| Deployment deadline | Covenant | Uncommitted capital is **released**: the fund shrinks, the management fee on it stops, and it counts as a warning sign (§3.4). Rushing bad deals to beat the deadline is the realistic trap. |
| Cash yield | Target, reported quarterly | Four quarters below promise is a warning-sign flag; at realisation it's part of "delivered vs promised" |
| Sale-by date | Covenant | Extension votes (investors can refuse). After that, unsold assets are bought in at NAV (today's rule) **or** sold by forced auction if investors vote it. Selling into a bad market to meet the date is a real risk. |
| Target IRR and multiple | Targets | Scored at wind-down against the promise, peer-relative (§3.4 evidence table) |
| Leverage, concentration, strategy, pre-leasing | Covenants | The engine **blocks** the deal from the fund (the capital-source picker greys it out with the reason, §6.5). Forcing it through is an LPA breach, which is misconduct. |
| Key person | Covenant | Investing suspends until investors vote to continue |

**The same idea applies to deal-by-deal syndications (§4):** the offering
memorandum's business plan (hold period, projected IRR, distribution
schedule) is the mandate for that deal, with the same covenant-or-target
split.

**Rivals' funds get mandates the same way.** The engine already makes
rival funds sell when "the fund's clock has run out" (the fund-life clock in
`rivals.ts`). Under this design that clock comes from each rival fund's
generated mandate rather than a fixed rule.

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

## 6.5 Choosing the capital on every deal

**Today:** one global switch on the Fund desk (`s.fundPay`, "Buy from the
vehicle") decides whether **every** purchase is paid from the fund or the
balance sheet (`executePurchase`, `AcquireDesk.tsx`). Construction is always
paid from the sponsor's own account, even on a fund lot.

**Proposed:** a **capital-source picker on every closing and every
groundbreak** (land, building, teardown, or vertical construction). It shows
each available source side by side.

| Source | Available when | What it means |
|---|---|---|
| **Your own balance sheet** | Always | Cash, line and lender, as today. Counts at 90% weight for reputation (§3.4). |
| **Your fund** | A live fund in its investment period, with enough cash plus uncalled commitments, **and** the deal fits the LPA limits (strategy, concentration, development share, leverage) | The fund owns the deed, calls capital for it, **and pays its construction** (the P0 fix). Pays the waterfall and the management fee. |
| **Syndicate this deal** | Your reputation band allows outside money (§3.4) and an investor type will take the meeting | Opens an offering memorandum. The raise runs during the contract period (1–3 months). Your co-invest comes from your balance sheet. |
| **Fund plus a co-invest sidecar** | The deal is bigger than the fund's concentration limit allows | The fund takes its maximum. Fund investors (and others the band allows) are offered the excess deal by deal, usually at lower fees. This is the most common way funds do deals too big for them. |

For each source the picker shows:
- the equity **you** put in
- the terms (pref, promote, fees)
- time to close
- the odds the raise closes, from §3.2
- what the deal will count for on your track record

#### The allocation rule (why you can't cherry-pick)

Real LPAs give the fund **first claim on deals inside its strategy** during
its investment period. Without that rule, a sponsor keeps the best deals for
itself and hands investors the rest. So:
- While a fund is investing, a deal that fits its strategy and limits must
  be **offered to the fund first**.
- Taking it onto your own balance sheet or syndicating it instead needs
  **investor-committee consent**. That is granted automatically if the fund
  lacks the capacity or the deal breaks a limit, and requested (and can be
  refused) otherwise.
- **Doing it anyway is an LPA breach:** misconduct under §3.4 (×2 and −25),
  and grounds for removal for cause.
- After the investment period ends, the rule lapses and every source is
  open again.

#### When a deal fails to raise

If a syndication doesn't close by the end of the contract period, the player
chooses:
- **close on your own balance sheet** if it's affordable
- **shrink the scheme** to what was raised
- **ask the seller for an extension**, which costs a fee and isn't always
  granted
- **walk away and lose the deposit**

The failed raise itself isn't a reputation event, but the investors who
passed are recorded, and they remember the pitch (§3.2 relationship).

#### Land you already own, syndicated at groundbreak

The common path for a small developer: buy and assemble the land with your
own money, then syndicate the vertical construction. The source chosen at
land purchase can switch at groundbreak from **own → syndicate** or **own →
fund**. How the land goes in matters, because selling your own land to your
own investors is a conflict:
- **Default: contributed at cost plus carry.** The sponsor's land basis and
  carrying costs become its co-invest (or part of it). No sale, no tax.
- **At appraised value:** only with an independent appraisal **and**
  investor consent. It counts as a sale by the sponsor (taxable gain) and
  shows on the offering memorandum.

A fund lot can't be moved to your own balance sheet or to a syndication.
That's a cross-trade, which needs consent and an independent valuation (§5).

---

## 7. Player experience (UI plan)

Built to the repo's own rules (`UI_PRINCIPLES.md`, `UI_DECLUTTER.md`): one
home per figure, desks not doors, every desk shaped *strip → what wants you
→ detail*, one interruption at a time, the verb in reach, and never offering
what can't be done.

### 7.1 Where it lives

- **A new tab on the Capital desk: "Investors"** (in `src/ui/desks.ts`). It
  is the **one home** for the investor rank, the track record, raises and
  vehicles. Today's `FundDesk` content moves here from the Debt tab.
- Everywhere else **links** to it rather than copying figures:
  - the Firm desk's Record
  - the Players league table
  - property pages
- **Naming:** "Rankings" is taken (the city against real US cities) and
  "standing" means lender marks. Use **"Investor rank"** and **"Track
  record"**.

### 7.2 The Investors tab

**Strip (a few tiles, one glance):**
- **Investor rank:** "#14 of 52 · Emerging ▲2", linking to the breakdown
- **Track-record score:** "+18", with the next floor ("Proven at +25 and
  2 more investor deals")
- **You can raise now:** "up to $3 per $1 of yours · about $4M from friends,
  family and small platforms"
- **Vehicles:** count, equity under management, uncalled commitments

**What wants you** (only shown when something does):
- raises in progress: a progress bar (soft-circled against target) and
  months left
- investor votes and consent requests waiting on you
- mandate deadlines inside 6 months: "Fund I must commit $12M more by
  Mar 2037"

**Detail, in folds:**
- **Track record sheet:** every realised deal, own money and investors
  alike, as a real pitch deck would show it:

  | Deal | Year | Equity | Projected | Actual | Investors' net | Evidence |
  |---|---|---|---|---|---|---|

  With colour for beat, met or missed, and a "why my rank moved" list
  (the biggest evidence items, ± points).
- **Investor market this year:** one row per investor type, showing:
  - appetite (a small meter)
  - the terms they're clearing at for your band
  - a plain lock reason when they won't meet you: "Family offices: need
    Proven"
- **Vehicles:** one row per fund or deal vehicle: size, called, value today,
  net IRR to date vs target, next deadline, and a status dot.

### 7.3 The vehicle page (one per fund or deal)

1. **The mandate card at the top**, in plain words, with a status light on
   each lever:
   - 🟢 "Deployment: $28M of $40M committed · 14 months left"
   - 🟡 "Cash yield: 4.1% vs 6% promised (2 of 4 quarters below)"
   - 🟢 "Leverage: 58% vs 65% cap"
2. **"If it sold today"**: one stacked bar of who gets what (lender ·
   investors' capital · pref · their profit share · your promote · your
   co-invest), computed by the **same waterfall function** as the engine.
3. **Capital account:** called, distributed, pref owed, net IRR and multiple.
4. **Actions:**
   - call capital, distribute, sell
   - **recap buyout** (§4.5), showing the price and the gap you'd fund
   - request an extension

   Unavailable actions are disabled, and the tooltip says why (rule 5).

### 7.4 Raising money: a three-step term sheet

A modal launched from the Investors tab ("Raise a fund") or from a deal
("Raise money for this deal"):

1. **What:** a fund or this deal; strategy; target size.
2. **Terms:**
   - it opens on **"Market terms for your band"**
   - adjust the **co-invest slider**, pref, promote tiers, fees, guarantee
     and mandate levers
   - a live side panel shows the size you're likely to raise, the odds of
     closing, which investor types this keeps or loses, and **your take**
     (base and downside) from the same waterfall
3. **Pitch:** tick investor types. Locked ones are greyed out with the
   reason. Then launch. Progress then lives in "What wants you"; no new HUD
   vital (rule 1).

### 7.5 Choosing the money on a deal

A segmented control inside the existing closing and groundbreak cards
(`AcquireDesk`, `DevelopDesk`): **Own money | Fund | Raise | Fund + side
money**.
- Each option shows one line of consequence: your cheque, time to close,
  terms.
- Unavailable options are disabled with the reason ("Fund: deal is 28% of
  commitments, limit 20%").
- This replaces the global "Buy from the vehicle" switch (`setFundPay`).

### 7.6 Elsewhere

- **Property page and parcel card:** an ownership line ("You 15% · Investors
  85% · Old Vesey Partners →"). Consent-locked actions show a lock and the
  reason, extending today's `JV_CONSENT` pattern.
- **Players (league table) and competitor cards:** an **Investor rank**
  column and band chip for every firm, linking to its breakdown.
- **Tape:** raises closing or failing, yours and rivals'.

### 7.7 Interruptions: one at a time, and only for decisions

**Stop the clock only for decisions:**
- a raise closed or failed
- an investor vote or consent needed
- a capital call you can't meet
- a mandate breach within 90 days

**Everything else goes into one quarterly "Investor letter" card,** a digest
across all vehicles (distributions, warning flags, rank changes) that the
player can mute. Band changes get a toast with what it unlocks: "Up to
Proven: family offices will now take your call."

### 7.8 Teaching the system

- The Investors tab always says what the next step needs: "To reach
  Emerging: about 2 more deals that meet their projection, or outrank
  Kestrel Capital (+21)."
- The first visit shows one short explainer card ("Why nobody will invest
  yet"), then never again.

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
| P2 | Investor reputation for every firm (§3.4), read only by the investor market; the finite investor pool sized by city attractiveness vs peer cities (§3.1), shared by player and rivals; `firmEntryPitch` reads both; merchant builders on the pool behind their own flag | High; touches firm entry and city supply, both load-bearing |
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
7. Own-money deals (§3.4) count at 90% of investor deals. Is 90% right, and
   should Institutional really require at least one investor vehicle?
8. Should reputation be visible for every rival from day one, or only once
   you've dealt with them or they've raised money publicly? (In life you know
   the big names and not the small ones.)

---

## Appendix A: worked examples (one deal, every structure)

Use these to sanity-check the waterfall code. Figures are $M, annual
compounding, pre-tax.

**The deal.**
- A $50M development: land, hard and soft costs, with a 3% development fee
  to the sponsor inside the budget.
- 65% construction loan ($32.5M); **$17.5M equity**.
- 2 years to build, 1 year of lease-up; stabilised NOI $3.75M (7.5% yield on
  cost).
- **Sell in year 4** at a 6% cap rate ($64.4M), or **hold**: refinance in
  year 4 at 65% LTV ($41.8M, about $9M back out), NOI growing 3% a year,
  sold in year 10.
- Before fees, the equity makes **1.84×, 16.5% IRR** selling in year 4, or
  **3.10×, 15.4% IRR** holding 10 years.

Syndications pay the investors' pref and capital first, then split the excess
by IRR tier (the sponsor's promote). The asset-management fee (1% of equity a
year) and the development fee go to the sponsor when the band allows them.

**Sell in year 4:**

| Structure | You put in | Investors put in | Investors get back | Investors' net | Your profit | Your multiple | Of which fees |
|---|---|---|---|---|---|---|---|
| Own money only | 17.5 | 0 | — | — | 14.7 | 1.84× | 0 |
| Unknown: 50% you, 12% pref, 10% above 15% | 8.8 | 8.8 | 16.0 | 1.83×, 16.3% | 7.4 | 1.85× | 0 |
| Emerging: 25% you, 10% pref, 15% above 12% | 4.4 | 13.1 | 23.6 | 1.80×, 15.2% | 6.1 | 2.40× | 2.2 |
| Proven: 15% you, 9% pref, 20%/30% above 12%/18% | 2.6 | 14.9 | 26.6 | 1.79×, 15.0% | 5.0 | 2.89× | 2.2 |
| Proven with more skin: 40% you, 8% pref | 7.0 | 10.5 | 18.8 | 1.79×, 15.0% | 8.3 | 2.18× | 2.2 |
| Institutional: 10% you, 8% pref, 20%/30% above 12%/15% | 1.8 | 15.8 | 28.2 | 1.79×, 15.0% | 4.3 | 3.45× | 2.2 |

**Hold 10 years** (refinance in year 4, sell in year 10):

| Structure | You put in | Investors' net | Your profit | Your multiple |
|---|---|---|---|---|
| Own money only | 17.5 | — | 36.8 | 3.10× |
| Unknown 50% | 8.8 | 3.09×, 15.4% | 18.5 | 3.11× |
| Emerging 25% | 4.4 | 2.94×, 14.3% | 13.2 | 4.02× |
| Proven 15% | 2.6 | 2.91×, 14.2% | 10.3 | 4.93× |
| Proven with more skin, 40% | 7.0 | 2.91×, 14.2% | 18.5 | 3.65× |
| Institutional 10% | 1.8 | 2.91×, 14.2% | 8.7 | 5.95× |

**Hold forever (own money only).** A closed-end fund or syndication must
exit, or the sponsor buys the investors out at appraisal. Owned outright,
the $17.5M becomes:

| Year | Annual cash after debt | Cash received to date | Equity value | Total |
|---|---|---|---|---|
| 10 | 2.0 | 20.8 | 35.0 | 55.8 |
| 20 | 3.5 | 48.6 | 61.5 | 110.0 |
| 30 | 5.6 | 94.5 | 97.0 | 191.5 |

**A $100M fund doing five of these deals** (staggered over 3 years, each sold
after 4 years):
- 1.5% management fee on commitments during the investment period, then
  1.25% on invested capital
- development fees on each deal
- 8% pref, 100% GP catch-up, then 80/20

| Fund outcome | GP commit | Investors' net | Management fees | Development fees | Promote | Co-invest profit | **GP total profit** |
|---|---|---|---|---|---|---|---|
| All five deals good | 1.9 (2%) | 1.56×, 12.3% IRR | 7.1 | 7.5 | 13.3 | 1.1 | **29.0** |
| One deal returns 0.6× | 1.9 (2%) | 1.38×, 8.9% IRR | 7.1 | 7.5 | 9.0 | 0.7 | **24.3** |
| One bad deal, 10% GP commit | 9.5 | 1.38×, 8.9% IRR | 7.1 | 7.5 | 9.0 | 3.6 | **27.2** |

Fee income is earned whether the fund performs or not. That is realistic,
and it is the main money-pump risk: §4.3 and §9 (`pnpm stress`) must
measure it. What answers it in the design is reputation: a fund pitched at
15% that delivers 8.9% misses by more than 5 points. That is −15 evidence
(× size, × fault) at wind-down, and the next raise is harder and smaller.

---

## 12. Integration pitfalls in the existing code (read before P0)

What could go wrong wiring this into the engine as it stands, and what to do
about each.

1. **Ownership is two ad-hoc flags, checked in many places.** `h.fundOwned`
   and `h.jv` are each tested by hand in `value.ts` (net worth), `books.ts`,
   `standing.ts`, `goals.ts`, `sim.ts` (monthly cash split, tax),
   `auction.ts` (foreclosure surplus), `actions.ts` (sale, 1031), `debt.ts`
   (consent), `dev.ts` (lease-up reserve), `facility.ts`, `portfolio.ts`,
   `leasehold.ts` and `blackswans.ts` (insurance proceeds). Adding deal
   vehicles as a third flag multiplies the branches, and **one missed exit
   path means investors silently go unpaid**, or net worth disagrees with the
   books.
   - **Do first:** one ownership record per deed (`owners: { vehicleId,
     share }[]`), with single functions for share-of-equity, consent and
     proceeds routing.
   - Migrate `fundOwned` and `jv` onto it **before** adding any new vehicle.
   - Exit paths to cover: sale, accepted bid, auction or foreclosure,
     portfolio package, 1031, fire or surge insurance, take-private,
     deed-in-lieu, DPO, ground-lease sale, recap buyout.
2. **Every vehicle is another cash purse.** `conserve` reconciles
   `cash + fund.cash` today. N deal vehicles mean N purses: sum them in
   `totalLiquidity`, give every flow a bucket, and extend the coverage
   assertion so a dead bucket fails the run.
3. **Two IRRs for one deal.** `Exit.irr` is the owner's levered IRR from the
   deed ledger, which also carries JV partner flows. Reputation needs
   **investors' net IRR** and the deal's **gross IRR**. Define each once,
   or the track-record sheet and the books will disagree (CLAUDE.md fake
   number #3).
4. **Construction is funded from the sponsor's account.**
   `startDevelopment`, `devFundingNeed` and `fundableNow` read GP liquidity,
   and draws book to `s.cash`. Every draw, overrun call and completion
   guarantee must route to the right purse. `dev.ts` already branches on
   `fundOwned` for the lease-up reserve; keep it to one routing function.
5. **Inflated marks leak into the new system.** Day-one marks run 1.3–1.8×
   cost on empty buildings (realism finding #1). The sponsor's promote "at
   liquidation value" would be phantom net worth on the league table, and
   recap buyouts priced off `marketAppraisal` would overpay. Fix the
   as-is mark first, or price recaps and promote marks on a lease-up-adjusted
   value.
6. **Big refinances can fail.** Lenders refused to refinance large, healthy
   buildings (finding #2; PR #339 scaled hold limits with inflation). Recap
   buyouts depend on those refinances, so re-measure after #339.
7. **Rivals have no track record to rank.** Rivals don't keep `Exit` ledgers
   or pitched promises (`Rival.jvs` records only the LP/GP split). Ranking
   them needs a per-rival deal ledger (compact: equity, projected, actual,
   date) plus a written-down derivation of the opening roster's records.
   Watch memory on the Great City map (about 200 firms over a century).
8. **Random draws must not move the economy.** Investor decisions (commit
   hazards, refusals, fairness premiums) need their **own RNG channel**,
   like `"shock"` for swans. `initStreams` hashes each channel by name, so
   adding one doesn't disturb the others. Drawing from an existing stream
   would make the economy diverge with player choices, which the playthroughs
   already caught once (finding #3). The ranking itself draws nothing.
9. **Firm entry is load-bearing.** `firmEntryPitch` drives how many firms the
   city carries, and its own comments record firm counts collapsing from 30
   to 3 after a past change. Ship the investor pool behind a flag, measure
   with `pnpm firms`, and only then let firm entry read it.
10. **Existing fund rules change.** Today:
    - a successor fund needs the prior one settled
    - DPI under 1 is a permanent bar
    - `fundPay` is a global switch
    - size comes from a formula

    Changing them moves `test/fund*`, `conserve` coverage and `BASELINE.json`.
    Live funds in old saves need a migration to a default mandate.
11. **Saves.** `SAVE_VERSION` is 40. The ownership refactor, mandates,
    per-rival ledgers and reputation state all need migrations, and
    mid-fund saves are the hard case.
12. **Tax.** A pass-through allocates income by share; `promoteIncomeYr`
    exists for the fund only, and deal-vehicle promotes and fees need the
    same. A recap is a sale for the investors but not for the sponsor, and
    transfer tax applies on a change of control.
13. **Interruptions.** Raises, calls, votes, consents, deadlines and reports
    across several vehicles become a wall of cards (UI rule 2). Wire only
    decisions into `attentionItems` / `stopRule`, and batch the rest into the
    quarterly investor letter (§7.7).
14. **Bots and harnesses.** The `conserve` bot, the MDGA drivers and
    `pnpm stress` must learn to syndicate, or the new code ships untested,
    exactly the "identity reconciling a player who owns nothing" trap in
    CLAUDE.md.
15. **Fee income is the money pump.** Appendix A shows a sponsor earning
    $24M+ on a mediocre fund, mostly from fees. Measure it in `pnpm stress`
    before tuning anything; reputation and finite investor money are the
    designed answer.
16. **The development-only mandate.** MDGA tooling should count syndicated
    and fund developments as development (open question 5).
