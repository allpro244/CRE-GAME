# Competitors — design for approval

**Status:** design only. No competitor code is written until the owner approves
this document. (The staff / principal removal it depends on is already approved
and is a separate change.)

**Vocabulary.** The other AI firms are **competitors**. "Rival" and "the Street"
leave every player-facing string: page titles, news copy, tooltips, glossary.
Code identifiers (`Rival`, `rivals.ts`) and the save key `game.rivals` stay, so
old saves load and the diff stays reviewable.

**Firms only.** A competitor is a firm. It has no principal, no person, no
portrait and no name beyond the firm's own. The player is a firm too.

---

## 0. The one sentence

Every competitor is a **firm with a trait sheet**. About 22 numbers (1–100), a
few hard **rules** and a couple of **quirks** decide what it buys, where, how
big, how levered, and when it sells. The player sees the sheet through an
**estimate** that sharpens with contact. A small **story layer** on top picks
the handful of firms worth watching and tells their story without adding chores.

---

## 1. What exists today and what is wrong with it

`engine/rivals.ts` is a strong economic engine and stays. It has:

- 35 firms with real balance sheets;
- ten styles: family, core, opportunistic, developer, merchant, pe, reit,
  vulture, owneruser, foreign, slumlord;
- hold clocks, balloon maturities, foreclosures, deeds in lieu, fund raises,
  spinouts, construction jobs, and Jev at the decision points.

The problem is not the economics. It is that:

1. **Styles differ only in money behaviour.** They differ in leverage, hold clock,
   cycle sensitivity, upkeep and build appetite. The only setting about *what* a
   firm owns is a list of asset classes. Nothing says *where* it buys, *how big*
   it goes, or *what quality* it builds. Location fit in `rivalBuys` is the same
   for every firm (`locFit` from `demandScore`). So a "developer" and a "merchant"
   look identical on the map.
2. **Thirty-five near-equal rows.** Nobody stands out, so watching a game is a
   league table and a news feed.
3. **Nothing is foreshadowed.** Balloons, hold clocks and half-done assemblages
   are all in the state, but the player only learns of them when they resolve.

---

## 2. The trait sheet

### 2.1 Traits (numbers, 1–100)

Every trait must change a **decision**: a filter, a threshold, or a weight when
ranking options. No trait may change how the market treats a firm. That is
`CLAUDE.md` (no fake numbers), and it is enforced in review.

| Group | Trait | 1 means… | 100 means… | Decision it drives (code site) |
|---|---|---|---|---|
| **Where** | Prime appetite | avoids the core | only the best-located lots | Location weight in `rivalBuys` and in job/site choice. Replaces today's shared `locFit`. |
| | Edge appetite | never leaves the core | lives on the outskirts | Same weight, inverted demand curve. Both can be high (a generalist); both low means it is pinned to its home turf. |
| | Home-turf loyalty | buys anywhere | buys only in districts it already owns in | Multiplies weight by the share of its book already in that district |
| **What** | Office, Residential, Retail, Industrial, Land (5 traits) | won't touch it | specialist | Class weight. Replaces `STYLE.classes`. A trait under 15 is a hard no. |
| | Scale | small infill | full-block towers | Preferred deal size, in lot area and buildable floor area; a weight that peaks at its target |
| | Quality | Class C | trophy | Which condition it buys at, and what it builds (floors, spec). It pairs with Upkeep. |
| **How** | Build appetite | never builds | builds everything | Replaces `BUILD_APPETITE` |
| | Hold patience | flips | holds for generations | Replaces `STYLE.holdM` |
| | Renovation appetite | buys as-is | buys tired buildings to fix | Weight on below-grade buildings, plus capex after purchase |
| | Distress appetite | avoids it | hunts it | Replaces `STYLE.distressBias` |
| | Assembly drive | single lots | builds sites lot by lot | New: targets lots next to its own (§2.5) |
| **Money** | Leverage appetite | all cash | max lender will give | Replaces `STYLE.maxLtv` and the opening `ltv` |
| | Cycle timing | buys busts (contrarian) | rides booms | Replaces `procyclical` and `contra` |
| | Price discipline | will overpay | never above its number | Replaces `STYLE.patience` (how far over appraisal it chases) |
| | Cash-out appetite | never refinances out | pulls equity in every boom | Replaces `STYLE.cashOut` |
| **Run** | Upkeep | milks the building | over-maintains | Replaces `CARE.capex` / `CARE.lease` |
| | Capacity | one deal at a time | many deals and jobs at once | Replaces `maxLiveJobs`, and caps purchases per year |
| | Reach | hears only the open tape | first call on off-market deals | Share of off-market and early-look listings it sees before the tape |
| | Underwriting | sloppy values | sharp values | Noise on its own value estimate when it bids. Low means it overpays at times and misses bargains. |
| **Temperament** | Grudge memory | forgets | never forgets | How long and how much the relationship ledger (§5) weighs |
| | Secrecy | an open book | opaque | How wide the player's estimates stay (§3) |
| | Panic threshold *(hidden)* | sells at the first stress | rides it to the end | Stress months before it markets assets (`DURESS_BAND`, `stressMs`) |

That is 22 traits plus the hidden one.

### 2.2 Rules (hard limits, not numbers)

Each firm has 0–3 rules. Rules filter the options **before** traits rank them.

- **ONLY …** — ONLY trophy · ONLY industrial · ONLY land · ONLY assembles ·
  ONLY its home district · ONLY builds (never buys a standing building)
- **NEVER …** — NEVER sells · NEVER builds · NEVER above 50% LTV ·
  NEVER buys distress · NEVER sells to the player (earned through §5, never rolled)
- **ALWAYS …** — ALWAYS bids on its own block · ALWAYS sells at delivery ·
  ALWAYS buys at the courthouse steps

Breadth falls out of the rules. A firm with an ONLY rule is a specialist. One
with a single soft focus is a two-lane firm. One with no rules and mid traits
is a generalist. There is no separate "focus" setting.

### 2.3 Quirks (0–2 per firm)

Each quirk has a small but real effect, and a story hook.

| Quirk | Effect |
|---|---|
| Corner-obsessed | Weight ×1.5 on corner lots; pays up to its Price-discipline cap for them |
| Loyal to one bank | Always borrows from the same lender: better terms in good times, shares its fate in bad |
| Deep-pocketed backer *(hidden until used)* | One rescue capital injection in its first crisis |
| Copycat | Moves toward whatever district or class the leading firm (often you) made money in last year |
| Trophy hunter | Bids on any building that sets a record price |
| Landmark lover | Won't redevelop old buildings, and buys them when offered |
| Late payer | Lenders read it as riskier: wider spread, earlier sweep |
| Patient seller | Lists well above value and waits |
| Neighbourhood champion | Weight bonus in its home district, and refuses to sell there |
| Feuding | Picks one other competitor and bids against it wherever they overlap |

### 2.4 Shown, estimated, hidden

| Tier | What | How it is shown |
|---|---|---|
| **Shown** | Name, book, what it owns, public rules ("NEVER sells" is something the market knows) | Exact |
| **Estimated** | Most traits | A range, e.g. `Leverage appetite 40–65`. It starts about ±22 wide (the band the old principal reads used), plus a Secrecy bonus. |
| **Hidden** | Panic threshold, deep-pocketed backer, any undiscovered quirk | `??` until an event reveals it |

**How estimates narrow** (no RNG on the economic streams — see §8):

- **Trading with them** (buy from, sell to, lose a bid to): the traits that deal
  touched narrow a lot. A closed sale narrows Price discipline and Leverage.
- **Watching them**: every observable action narrows the trait behind it a
  little. A groundbreak narrows Build appetite, Scale and Quality; a cash-out
  refi narrows Cash-out appetite.
- **Time**: slow general narrowing for firms active near your holdings.

**Fairness rule.** Every hidden trait must give off a visible tell before it
decides anything. Before a panic sale you see the firm stop buying, its LTV
climb past its pattern, a "marketing assets" line. A sharp player could have
read it. Hidden must never mean random.

### 2.5 Assembly (the one new mechanism in phase 1)

A firm with high Assembly drive picks a **target site**: a run of adjacent lots
that together pencil (using the player's existing assemblage underwriting). It
then weights those lots heavily until it owns them all, or gives up after a
patience window. The last lot is a **holdout**. If you own it, you can name your
price, up to what the assembled site is worth to them under their Price
discipline. If you won't sell, they build what they can around you.

---

## 3. From profiles to firms

A **profile** is a template: a centre value for each trait, the rules it usually
carries, and its likely quirks. A firm is drawn from a profile: each trait gets
the centre ± a seeded jitter, then 0–3 rules and 0–2 quirks are rolled. So two
Trophy Builders still differ.

### 3.1 The profiles (28)

Key traits only. Unlisted traits centre at 50.

| # | Profile | Defining traits | Usual rules |
|---|---|---|---|
| 1 | Trophy Builder | Prime 90, Scale 85, Quality 95, Build 85, Hold 80, Leverage 35 | ONLY trophy |
| 2 | Ego Builder | Prime 85, Scale 98, Quality 90, Build 95, Price discipline 15, Underwriting 25 | ONLY builds |
| 3 | Merchant Builder | Build 95, Hold 10, Scale 50, Quality 55 | ALWAYS sells at delivery |
| 4 | Industrial Edge Developer | Edge 90, Industrial 95, Build 85, Scale 70, Cycle timing 75 | ONLY industrial |
| 5 | Workhorse Rental Builder | Residential 90, Prime 40, Edge 55, Build 70, Hold 90, Leverage 55 | — |
| 6 | Mixed-Use Placemaker | Retail 70, Residential 70, Assembly 75, Home-turf 85, Build 80 | ONLY its home district |
| 7 | Assembler | Assembly 98, Land 80, Price discipline 70, Hold 60 | ONLY assembles |
| 8 | Build-to-Suit Specialist | Build 80, Office 70, Industrial 60, Reach 80 | ONLY builds |
| 9 | Adaptive-Reuse Converter | Office 85, Renovation 95, Distress 60, Cycle timing 30 | — |
| 10 | Pension / Core | Office 70, Residential 70, Quality 75, Leverage 30, Hold 85, Price discipline 80 | NEVER above 50% LTV |
| 11a–c | Sector REIT (office / retail / residential) | that class 95, Capacity 80, Hold 75 | ONLY that class |
| 12 | Old Family Dynasty | Hold 98, Leverage 15, Quality 70, Home-turf 75, Secrecy 85 | NEVER sells (most rolls) |
| 13 | Foreign Trophy Buyer | Quality 95, Prime 95, Price discipline 10, Build 5, Leverage 25 | ONLY trophy |
| 14 | Owner-User Corporation | Office 80, Industrial 50, Hold 100, Build 30 | NEVER sells |
| 15 | High-Street Retail Landlord | Retail 98, Prime 80, Hold 70 | ONLY retail |
| 16 | Net-Lease Buyer | Quality 60, Hold 80, Price discipline 40, Renovation 5 | — |
| 17 | Neighbourhood Operator | Residential 85, Scale 15, Home-turf 95, Capacity 75, Upkeep 60 | ONLY its home district |
| 18 | Institutional Expander | Home-turf 100, Price discipline 10, Hold 100 | ONLY its home district, NEVER sells |
| 19 | Vulture | Distress 98, Cycle timing 5, Underwriting 80, Hold 50 | ALWAYS buys at the courthouse steps |
| 20 | Loan-to-Own Lender | Distress 90, Reach 70, Underwriting 85 | (needs notes, phase 3) |
| 21 | Hot-Money Flipper | Leverage 95, Cycle timing 98, Hold 10, Underwriting 30, Panic 20 | — |
| 22 | Value-Add Fund | Renovation 85, Hold 25 (fund clock), Leverage 70 | — |
| 23 | Contrarian | Cycle timing 5, Quality 70, Price discipline 90, Leverage 20, Hold 85 | — |
| 24 | Land Banker | Land 98, Build 0, Edge 70, Hold 60, Leverage 15 | NEVER builds |
| 25 | Corporate Raider | Distress 70, Capacity 90, Reach 85 | (takeovers, phase 3) |
| 26 | Slumlord | Quality 5, Upkeep 3, Residential 70, Cash-out 70 | — |
| 27 | Preservationist | Hold 98, Renovation 70, Build 0 | NEVER builds, NEVER sells |
| 28 | Spinout Upstart | copies its parent firm's profile, Capacity 30, Grudge memory 90 (at its parent) | — |

### 3.2 The roster

- 35 slots, as today. Most profiles appear once, so each town has a different cast.
- **Balance check (about the city, not any firm):** every town gets at least
  4 builders, 4 long-term holders, 2 distress buyers and 1 land banker. That is
  the mix a property market needs to clear, not a thumb on any firm's scale.
- Opening equity stays in today's $2.5M–$10M band. Nobody starts much bigger than you.
- New firms entering mid-game (today's `maybeNewFirm`) draw a profile that
  fits the cycle: hot money in booms, vultures in busts.

### 3.3 Migration that proves the plumbing

Phase 1 opens by expressing each of today's 11 styles as a trait sheet. Each
trait maps to the old parameter as an **offset from the style's centre**, so a
trait at its centre reproduces the old number exactly. The baseline must then
be **bit-identical**. Only after that do new traits and profiles switch on,
each one measured.

---

## 4. Drift: traits change with what happens

- Burned in a crash (lost more than a third of equity): Leverage −10 to −20,
  Panic threshold down, Price discipline up.
- A big win: Leverage and Scale +5, Price discipline −5 (hubris).
- A new fund closes: Capacity up. A fund winds down: Hold patience forced short.
- Taken over: the sheet moves toward the acquirer's.
- Bounded: at most ±15 on any trait per year.

The profile label is recalculated from the current traits each year. So news
can say "Kestrel Capital has become a vulture", and over 100 years each firm
has an arc rather than a fixed type.

---

## 5. Relationships: competitors remember you

It extends the existing `s.street[firmId]` tie (`deals`, `beats`, `insults`) into a ledger:

| Event | Effect |
|---|---|
| You sold them a building that worked out | goodwill |
| You beat them to a deal | grudge |
| You lowballed them | grudge (small) |
| You rescued them (bought distress at a fair price, took their note fairly) | big goodwill |
| You won a holdout against them | big grudge |

Grudge memory decides how long each entry lasts and how much it weighs. The
consequences are real decisions, kept inside the firm's own limits:

- **Grudge:** the firm bids up on listings you are also in, but never above its
  Price-discipline cap. It refuses to sell to you below value. A deep grudge
  triggers **NEVER sells to the player**.
- **Goodwill:** a first look at its sales before the tape, a JV invitation on a
  job, and an offer to buy your building before you list.

The player never manages this. It shows up as one line where it matters:
"Lost to Kestrel — they have bid against you since the Pearl St holdout."

---

## 6. The story layer (what makes a game worth watching)

### 6.1 Headliners

A **story director** scores every firm each quarter for how much it matters
right now. It promotes the top 4–6 to **headliners** and fills these roles when
it can:

- **Nemesis**: most grudge with you
- **Neighbour**: most buildings or jobs next to yours
- **High-flyer**: most levered firm in a boom
- **Circling**: a vulture or raider near someone's distress
- **Upstart**: youngest firm with momentum

Headliners rotate as stories end. The other ~30 are background, shown in a
folded table.

### 6.2 Arc badges (headliners only)

**Raising → Deploying → Overreaching → Strained → Crisis →
Rescued / Fire sale / Foreclosed / Taken over**, computed from existing
signals: LTV against the firm's own pattern, `stressMs`, the maturity ladder,
and `uncalled`.

### 6.3 What's coming (foreshadowing, read-only)

One line per headliner, from state that already exists:

- "Fairlead must exit 6 buildings by '34" (hold clock)
- "Kestrel: $40M of balloons due Q3, LTV 81%" (maturities)
- "Wexler holds 3 of 4 lots on Pearl & Water" (assembly)
- "Alden tops out on Front St in 8 months, 240k sf of office" (construction pipeline)

These never enter your docket and never stop the clock.

### 6.4 Pacing

Headline beats are capped at about 2–3 a quarter, with variety enforced, and
something resolves roughly every year.

---

## 7. Screens

Under the `UI_DECLUTTER.md` rules: one home per number, and desks, not doors.

| What | Where |
|---|---|
| **Competitors page** | Replaces the Street page. Headliner strip on top (a card each), equity race chart, then the 35-row table in a `Fold`. **Merges the Jev match leaderboard into it**: one table, Jev firms carry the existing `JevBadge`. There is no second leaderboard. |
| **Firm card** | Profile label · rules as tags · the 3 defining traits plus anything you've narrowed · quirks found · `??` for hidden · relationship line · arc badge · what's coming. The full sheet sits in a `Fold`. |
| **Map** | The Owners lens (exists) colours by firm. It adds a crisis pulse on a firm in Crisis and outlines a target site under assembly. Cranes (exists) already shows jobs. |
| **News** | Leads with headliner beats; routine tape stays out (existing rule). |
| **Spectator mode** | Autoplay gets a spectator-only stop rule that pauses on headline beats, using the existing pause toast. A player's own stop rule is unchanged. |
| **Year review** | Three competitor lines: deal of the year, biggest blow-up, your rank. |

Example card:

```
WEXLER BUILDING CO.                      Trophy Builder   ◆ Overreaching
Rules: ONLY trophy · NEVER sells                    Nemesis — Pearl St holdout
  Prime appetite   86        Leverage      30–62
  Scale            84        Capacity      40–62
  Quality          92        Underwriting  ??
Quirks: corner-obsessed · ???
Coming: tops out at 1 Front St in 8 months — 410k sf of trophy office
```

---

## 8. Rules the build must keep

1. **Traits change choices, never market outcomes.** No trait multiplies rent,
   NOI, cap rate or price paid by the market.
2. **Determinism.** Trait draws, estimate narrowing and the story director use
   their own seeded streams, not `rivals`/`econ`. Choosing which firm to
   *show* must never move the economy.
3. **Save compatibility.** A save with no trait sheets gets one derived from its
   style on load (the §3.3 mapping), so old saves keep playing the same game.
4. **Jev.** A Jev-run firm gets its trait sheet as part of its question state, so
   its answers stay in character. The scripted rule stays the fallback.
5. **Measurement.** Every phase that changes behaviour is run against
   `pnpm check`, the gate and century runs, and recorded in
   `BASELINE_ATTRIBUTION.md`.

---

## 9. Build order

| Phase | What | Moves the economy? |
|---|---|---|
| **0** | Player-facing rename to "competitors" | No |
| **1a** | Trait sheets as data; the 11 styles expressed as sheets; derivation on load | **No: bit-identical baseline is the acceptance test** |
| **1b** | Where/What/Scale/Quality traits live in `rivalBuys` and site choice; rules and quirks; 28 profiles and the roster draw; assembly and holdouts | Yes — measured |
| **2** | Estimates and hidden traits; firm card; Competitors page with headliners, race chart and merged Jev table; map pulse | No (display only) |
| **3** | Story director, arcs, what's coming, spectator stops, year-review lines | No |
| **4** | Relationship ledger consequences; drift | Yes — measured |
| **5** | New mechanics: conversions (9), loan-to-own (20), build-to-suit tenant poaching (8), raider takeovers (25), firm-vs-firm feuds | Yes — each measured on its own |

Phases 2 and 3 can ship before 1b if we want the spectator payoff first; they
read existing state.

---

## 10. More ideas to make the city feel alive

Suggestions, not part of the approved scope until picked:

1. **Copycats chase your success.** When you make money in a district or class,
   the next year's competitor weight there rises (the Copycat quirk, made
   general and small). Real capital chases returns. Your edge erodes, which is
   honest difficulty.
2. **The tour log.** A listing shows which firms toured it ("3 firms walked
   this building"). You see the competition before the bid, and it is the
   foreshadowing system applied to deals.
3. **Annual letters.** Each December, every headliner publishes a one-line
   letter to its investors: "We are sellers of office" or "We see value in the
   east side". It is generated from its current weights. It is true but
   incomplete, like a real letter. Reading them narrows estimates a little.
4. **Bidding wars you can watch.** When two headliners want the same listing,
   it runs as a short visible auction in the news across a couple of months,
   and you can jump in.
5. **Competitor JVs with each other.** Two firms co-sponsor a big job.
   Partners can fall out in a downturn: one buys the other out cheaply.
6. **Signature buildings.** A firm's best delivery gets its name on the map
   label ("Wexler Tower"). Landmarks outlive the firms that built them.
7. **Trade-press survey.** A quarterly line on competitor sentiment ("7 of 10
   headliners are net sellers"), computed from their actual positions. It is a
   real leading indicator built from real behaviour.
8. **Tenant moves between competitors.** When a competitor's tower delivers,
   news names the tenants it pulled and from whose building. Supply competition
   becomes visible, not just a vacancy number.
9. **Firm obituaries.** When a firm dies, two lines: what it built, how it
   died, and who bought the pieces. It is the payoff of a 30-year arc.
10. **Your reputation as a trait sheet.** Competitors keep estimates of *you*,
    built from how you play: "always overpays for corners", "sells into every
    boom". They act on it (bid against your pattern). You can read their read
    of you, and play against it.

---

## 11. Decisions for the owner

1. Approve the trait list (§2.1), or add, cut or rename traits.
2. Approve the profile list (§3.1) and the roster balance check (§3.2).
3. Phase order: economy-first (1a → 1b → 2 → 3) or spectator-first
   (1a → 2 → 3 → 1b)?
4. Which of the §10 ideas to take into scope.
