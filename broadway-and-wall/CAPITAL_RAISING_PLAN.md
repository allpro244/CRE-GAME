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

Every firm, player and rival, carries an **investor reputation rating** on a scale of
**−100 to +100**. **The player always starts at 0**: unknown, which in this
business is not neutral but a closed door. Rivals carry the same rating,
computed the same way from their own records. It shows on the league table
and on each firm's profile, with a breakdown of why.

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

#### What moves it

| Component | Source in the engine | Direction | How it weighs |
|---|---|---|---|
| **Realised investor outcomes** | `Exit` (equityIn, equityOut, `irr`); SPV and fund net IRR, DPI | + or − | Net-to-investor IRR vs that strategy's target, weighted by equity size and recency. The core of the rating. |
| **Losing investors' money** | an SPV or fund with DPI < 1; a principal loss on any syndicated deal | −− | Counts in full immediately. Not shrunk for sample size (see below). |
| **Credit events** | `sponsor.events`: foreclosure, deficiency, seizure, deed-in-lieu, DPO, forced sale | −− | Investors read the same public record lenders do: the same events and the same 10-year memory, weighted on this scale. Reading them here does not change `sponsorStanding` or anything lenders do. |
| **Broken promises** | a failed completion guarantee, a missed capital call, an LPA breach, a removal for cause | −−− | The worst marks in the system: a broken guarantee follows a name longer than a foreclosure does. |
| **Execution** | delivery slip vs plan (`deliveries`), budget overrun, lease-up vs underwriting | + or − | Small per job; matters in aggregate ("always late, always over"). |
| **Tenure without incident** | firm age, years since the last mark | + (capped) | Small and capped: an old firm isn't automatically a good one. |
| **Scale under management** | AUM in vehicles you run | + (capped) | Small: big managers get meetings, not trust. |

#### Why it is hard to earn and easy to lose

These are the mechanisms that keep raising money hard. Each is a real
property of how investors read a sponsor, not a penalty multiplier.

1. **Credibility shrinkage.** Positive evidence is pulled toward 0 by sample
   size: the rating moves by about `evidence × n / (n + k)`, where `n` is
   realised deals (or funds, for institutional types) and `k` is a shape
   parameter. One brilliant deal is luck; five is a record. A 40% IRR on
   your first flip barely moves you.
2. **Asymmetry.** Losses, credit events and broken promises are **not**
   shrunk. One wiped-out deal costs more than three good ones earn. That
   matches how investor committees actually write memos.
3. **Only realised results count.** Marks, appraisals and unrealised
   "paper" IRRs don't move the rating. Investors trust cash back, which also
   closes the day-one-mark loophole from the realism findings.
4. **Slow fade both ways.** Positive evidence decays over about 15–20 years
   (a team's record goes stale). Negative evidence decays over the existing
   10-year memory. Misconduct lasts 20 years. A failed fund's bar on
   institutional money is now graded by cause rather than always permanent
   (see "Losing investors' money" below).
5. **A step-up limit, separate from the rating.** No investor backs a raise
   much larger than the sponsor has done before: roughly **2–3× your largest
   successfully completed raise** (a shape parameter). A great rating with
   no history of size still raises small.
6. **Relative, not absolute.** Investors compare. Your rating is read
   against the rivals asking that year (§3.2's softmax), so a 30 in a town
   full of 70s gets scraps.

#### What it does: gates and terms

The bands below are a starting design to be measured, not a balance target.
The terms columns are what the **market demands of a sponsor in that band**,
before the year's supply and competition move them.

| Rating | Band | Who will take the meeting | Investor pref demanded | Promote you can get | Fees you can charge | GP co-invest required | Completion guarantee | Raise speed |
|---|---|---|---|---|---|---|---|---|
| below −40 | **Toxic** | Nobody (bridge and hard money only) | — | — | — | — | — | — |
| −40 to −10 | **Questioned** | Friends and family who already know you | 12%+ | 0–10% above a 15% IRR | none | 25%+ | always, personal | very slow |
| −10 to +15 | **Unknown** (player starts at 0) | Friends, family and local HNW; small cheques | 10–12% | 10–15% above a 12–15% IRR | development fee ≤ 1% | 20%+ | always | slow; often fails |
| +15 to +35 | **Emerging** | + syndication platforms, some family offices | 9–10% | 20% above 12% | development fee 2–3% | 10–20% | usually | moderate |
| +35 to +55 | **Established** | + family offices, smaller endowments; a first fund is possible | 8–9% | 20%, then 30% above 15% | development 3–4%, management 1.25–1.5% | 5–10% | lender-driven | normal |
| +55 to +75 | **Institutional** | + endowments, pensions (with size), insurers (separate accounts) | 8% | 20/30 tiers, catch-up | full market fees | 2–5% | rarely | fast |
| above +75 | **Blue-chip** | + sovereign wealth funds and programmatic JVs (§6) | 7–8% | best tiers | market or above | 1–3% | no | oversubscribed |

Lenders, sellers and brokers don't read this rating (see Scope above).

#### Losing investors' money: exactly what happens

This is the most important negative in the system, so it is specified in
full. All numbers are a **starting design**: severity bands and fault
classes are judgement calls to be measured, and the weights are shape
parameters, labelled as such in code.

**1. When the loss is recognised.** The investor market learns of a loss at
the first **public** event, not at an appraisal:
- a foreclosure, deed-in-lieu or forced sale of a vehicle's building (news
  already reports these)
- a vehicle wound up with investors short
- a missed distribution the operating agreement required
- a defaulted capital call

Before that, nothing moves; afterwards, the final number replaces the
estimate when the vehicle is wound up.

**2. How bad it is.** Measured on the investors' money, net of fees:
`M = what investors got back ÷ what they put in`.

| Investors' multiple `M` | Severity | Base hit |
|---|---|---|
| 0.90–1.00 (pref missed, little principal lost) | Shortfall | −5 |
| 0.70–0.90 | Loss | −12 |
| 0.40–0.70 | Heavy loss | −22 |
| under 0.40 | Wipe-out | −35 |

**3. Whose fault it looks like.** Investors judge relative to the market,
which is why the shared investor market needs peer benchmarks (same
strategy, same vintage window, from rival funds and merchant SPVs):

| Fault class | Test | Multiplier |
|---|---|---|
| **Market-wide** | Peer median `M` for that strategy and vintage is also under 1.0 | × 0.5 |
| **Your deal** | Peers made money; you didn't | × 1.0 |
| **Misconduct** | Broken completion guarantee, unfunded GP call, LPA breach, removal for cause | × 2.0, plus a separate −25 |

**4. Size and skin in the game:**
- **Size:** × 0.6 to × 1.4, scaled by the lost equity's share of all the
  investor capital you have ever raised. Losing your biggest deal hurts most.
- **Alignment:** × 0.85 if your own co-invest was at least 10% and was lost
  alongside theirs. "We lost with you" is a real defence in investor
  meetings.

**5. No credibility shrinkage on losses.** Gains are discounted for small
samples; losses aren't. **Hit = base × fault × size × alignment**, applied
in full on recognition.

**6. Memory.** Market-wide and your-deal hits fade linearly over **10 years**
(the existing `sponsorStanding` horizon). Misconduct hits fade over **20
years**.

**7. The investors who lost money remember you personally,** on top of the
rating:
- **Friends and family, local wealthy individuals:** the player's personal
  network is a **finite pool**. Investors who lost money leave it: 70% for
  good, the rest for 10 years. Since this pool is all an Unknown sponsor can
  raise from, a loss early in a career **shrinks the only money available**.
- **Syndication platforms:** delist you for 10 years after any your-deal or
  misconduct loss; 5 years after a market-wide one.
- **Family offices:** won't re-invest for 10 years; if the loss was
  market-wide, each comes back at 50% odds once the rating allows it.
- **Endowments, pensions, insurers, sovereign funds (blind-pool losses):**
  - market-wide losses: out for one fund cycle (about 10 years)
  - your fund below 1.0× while peers were above: out permanently
  - misconduct: everyone out permanently, except your own money and
    hard-money lenders

  This replaces today's blanket rule ("a fund that returned under 1.0× means
  nobody backs you again"). Plenty of sponsors whose 2006–07 funds lost
  money raised again, because everyone lost; fraud and broken guarantees end
  careers.

**8. Terms while a loss mark is live** (on top of whatever the band demands):
- investors demand **+1.5 points of pref** and **+10 points of GP co-invest**
- a **completion guarantee** is mandatory again, whatever the band
- **the step-up limit resets:** the most you can raise is capped at **1×
  your largest raise since the loss**, until the mark is half faded. You
  can't grow out of a hole with other people's money.
- placement agents won't take you on while a your-deal or misconduct mark
  is live

**9. Climbing back.** Only new, realised, profitable vehicles rebuild the
rating, still subject to small-sample shrinkage. In practice that means
**about 4–6 clean deals over 8–10 years** to regain one band. Putting in
more of your own money shortens it, because larger co-invest raises the
investor score (§3.2).

**Worked examples** (a player rated +20, Emerging, mid-sized deal, size × 1.0):

| What happened | Hit | New rating | Band | What it means |
|---|---|---|---|---|
| Market-wide 2008-style loss, `M` = 0.8, own 10% co-invest lost too | −12 × 0.5 × 0.85 = **−5** | +15 | Emerging, just | Platforms gone 5 years; terms +1.5 pref and +10 co-invest; can't upsize. Survivable. |
| Your deal, `M` = 0.55 (lease-up failed while the market was fine) | −22 × 1.0 = **−22** | −2 | Unknown | Back to friends and family, minus the 70% who lost money and left for good; platforms and family offices out 10 years |
| Wipe-out on your deal, `M` = 0.2 | −35 = **−35** | −15 | Questioned | Only people who already know you; 12%+ pref; personal guarantee; years of tiny raises |
| Broken completion guarantee, `M` = 0.6 | −22 × 2.0 − 25 = **−69** | −49 | **Toxic** | No investor money for a decade or more; your own money and hard-money lenders only |

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

- A clean $1M developer reaches Emerging only after several realised,
  profitable syndications, on the order of 10–15 years. Institutional money
  arrives decades in, if ever.
- One blown-up deal or broken guarantee knocks a firm down a band for years.
- Most rivals sit Unknown to Established. Blue-chip is rare and held by the
  oldest, cleanest, biggest names.
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
  10–12% prefs, 20%+ co-invest, mandatory guarantees, slow and failure-prone
  raises. The step-up limit keeps early syndications small (§3.4).
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
7. Should reputation be visible for every rival from day one, or only once
   you've dealt with them or they've raised money publicly? (In life you know
   the big names and not the small ones.)
