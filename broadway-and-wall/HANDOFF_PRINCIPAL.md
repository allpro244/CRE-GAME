# HANDOFF — THE PRINCIPAL

Design handoff for two changes that are really one change: **the player becomes
a person who dies**, and **the money stops being theirs**. Written to be picked
up cold, in the shape of `HANDOFF.md`: what is where, what already exists, what
will bite you, and what I would do in what order.

No code was written for this. Every symbol cited below was read at
`7a221e5`; re-read before you believe any of it, including this sentence.

---

## 0. THE ONE SENTENCE

There is one new object — a **principal**, a named person with an age, a
record, and a set of things they are good at — the player has one, every rival
firm has one, and almost every mechanism in this document is a consequence of
that single addition rather than a system of its own.

---

## 1. THE ASYMMETRY THIS IS ABOUT

Three times over, this engine models something honestly for everybody in the
city except the one participant the player controls.

| the world | the player |
|---|---|
| `owners.ts` — ~217 named holders with demographic exit hazards, executors, heirs, and `exitStory()` prose about estates being settled | immortal |
| `Rival.uncalled` — LP capital committed and not called, burned by capital calls, never refilled. `rivals.ts` `DEPLOY_YR = 2` sizes deployment on the fact that a sponsor who cannot deploy "does not finish the fund, does not earn the promote, and does not raise a second one" | equity arrives from nowhere and never has to be given back |
| `staff.ts` — every hire has hidden true `attrs`, an observed `obs`, a confidence `band0`, a salary ask priced off ability, and can be poached | has no attributes at all, only an ad-hoc `ownerCapacitySf()` |

**Scope note, added after the first draft.** The owner has put the existing
staff and skills system in scope for replacement rather than extension. §5 is
written on that basis and now proposes deleting `staff.ts` rather than
borrowing from it — which turns out to be the change that makes Parts A and B
cohere instead of sitting next to each other. §8, §9 and §12 moved with it.

The sell-reason enum in `types.ts` is the tell. It already reads:

```ts
reason?: "fund-life" | "merchant" | "estate" | "voluntary" | "receiver";
```

**Two of those five reasons can never apply to the player**, because the player
has no fund and no estate. `SellerKind` likewise already includes `"estate"`.
The vocabulary for all of this is in the codebase; the player is simply outside
it.

This matters beyond tidiness. `CENTURY_REPORT.md` §IX found that five family
offices win every century between them and that **no leveraged fund has
finished a century in 231 out of 231 attempts** — the most interesting result
this project has produced. It is currently an emergent curiosity the player can
neither participate in nor observe, because the player is neither a family nor
a fund. They are a deathless balance sheet, which is the one form of capital
that does not exist in life.

**Also note:** re-running `SEED=655720 CITY_SEED=0 HORIZON=1200
tools/play100-story.mjs` at `7a221e5` does not reproduce the committed
`PLAY100_STORY.md` — that seed now goes insolvent in 2013 at −$5.1M against a
committed $80.28B. Consistent with the RNG re-roll trap, not a regression, but
`PLAY100_STORY.md` describes a world that no longer exists and should not be
cited as evidence for anything in this document or against it.

---

## 2. THE OBJECT

One interface, used for the player and for every rival. The whole design rests
on these being *the same type* — that is what makes the league table readable
and what stops rival mortality from being a separate subsystem.

```
Principal {
  name, born (month), style/temperament,
  attrs   — hidden true ability, 1-100        (the staff.ts pattern)
  record  — what they have actually done
  ties    — who they know                     (StreetTie, already exists)
}
```

Where it hangs: `FirmIdentity` (`types.ts:1035`) is already
`{ name, short, foundedM, epithets }` and is already the player's firm-level
identity. The principal is its missing other half — the firm has a name and a
founding date; nobody has a face. `Rival` (`types.ts:1847`) takes the same
field.

Save version goes `v: 32` → `33`, with `migrateSaveState` synthesising a
principal for old saves from `firm.foundedM` (see §11 on why the synthesised
age must be deterministic).

---

## 3. PART A — MORTALITY AND SUCCESSION

### What exists already

- `owners.ts` — demographic exit hazards ("annual rates expressed monthly"),
  `exitStory()` with executor and heir prose, and an existing estate-holder
  description: *"Held in an estate since the last of them died. Executors,
  heirs, and a clock nobody in the family controls."*
- `actions.ts` — `RECAPTURE_RATE = 0.25` (§1250) and `EXCHANGE_WINDOW_M = 6`
  (1031). Holdings carry `costBasis` and `deprTaken`.
- `history.ts` — permanent per-deed event log, so a succession is recordable
  against the buildings it touches.
- `SellerKind: "estate"` and `reason: "estate"` already exist as counterparty
  and disposition vocabulary.

The tax spine required for the rest of this section is therefore already built.
That is the single most important fact in Part A: **the hard part is done.**

### The mechanism

**Age is set at the start, and it costs capital.** The start menu already
trades bankroll against difficulty with five `START_CASH_CHOICES` and honest
prose for each. Add the second axis: you are 28 with $1M, or 52 with $20M. That
is not a difficulty dial — it is the actual trade every person in this business
makes, it is legible without explanation, and both ends are playable. It also
gives the campaign a length the player chose.

**Death is a hazard, not an event.** Use a published period life table. This is
the textbook `CLAUDE.md` "calibrated industry constant" — a fact about the
world, hardcoded, cited in a comment — and it is the opposite of a fake number.
Retirement is a *decision* the player may take earlier.

**The estate is where the game is.** A ~40% rate above an exemption, filing due
in nine months, against an asset class this engine already knows takes months
to sell. Everything needed to make that bite is modelled: the liquidity model
knows a sale takes time, `portfoliosale.ts` knows what a forced whole-book exit
fetches, and the century data says a book of this kind clears at 0.72–0.90×
appraisal when the seller is motivated.

This is the endgame `CENTURY_REPORT.md` §IX was reaching for without naming it.
Wrenfield Brothers reached $15.14B at **28% LTV** and spent ten years dying of
sixty-five buildings it could not sell. Leverage kills small firms fast; size
kills big ones slowly. An estate bill is precisely the event that converts
"large, safe and illiquid" into "insolvent", and it is the one risk in this
business that gets *worse* the more conservatively you have played.

**The counterplay is the real business, and all of it is honest:**

- **Step-up in basis at death.** Hold to the grave and heirs take a clean
  basis; sell in life and you pay recapture at 25% plus gains. `deprTaken` and
  `RECAPTURE_RATE` already exist, so this interaction is nearly free — and it
  is a genuine strategic tension that real families organise decades around.
- **§6166 instalment election.** Closely-held business estate tax payable over
  fourteen years. This provision exists in life *specifically* for this problem.
  It is a fact about the world, not a mercy dial.
- Life insurance sized to the bill; gifting minority interests at a discount;
  ground-leasing the land and keeping the building (`groundLeased` already on
  holdings); or simply selling the wrong buildings at the wrong time, which is
  what most families actually do.

**Succession itself: the player continues as the heir.** Recommended over
handing control to an NPC — it preserves agency, and the cost of the transition
is already sitting in state and does not need inventing:

> **Relationships attach to the person, not the firm.** `sponsor.events`
> (`MEMORY_M = 120`), `lenderRel`, `StreetTie`, `hireReputation`, and every
> broker or holder tie are the *dead principal's*. The heir inherits the
> buildings and the debt and starts thin on all of it.

That is a real, non-fake penalty, it is exactly why second generations
underperform, and it produces the correct emotional beat: you keep the
portfolio and lose the phone book. Difficulty is an output.

### And it is where the deals come from

Rival principals age and die on the same clock. `reason: "estate"` already
exists as a disposition path. A firm hitting a succession is a firm with a
nine-month clock and no ability to wait for a bid — which is the buying
opportunity, arriving on a schedule the attentive player can *see coming years
in advance* because they can see how old the man is.

That is a tell in the `IDEA_FEST` #11 sense: visible, checkable, and impossible
to read off the balance sheet alone.

It also attacks an open fault directly. `CENTURY_REPORT.md` §XI item 9: turnover
implies an **84-year average hold against 8–15 in life**. Demography is the
mechanism that turns stock over in real cities. This is not a coefficient
change; it is the missing reason buildings trade.

---

## 4. PART B — CAPITAL THAT IS NOT YOURS

### What exists already

`rivals.ts` models the fund cycle **for the AI only**:

- `Rival.uncalled` — committed-and-undrawn LP capital, "set once at the raise
  (30-50% of the first close, drawn per fund), burned by capital calls, never
  refilled."
- `Rival.distributed` — lifetime cash sent out to their partners.
- `DEPLOY_YR = 2`, justified in comment by fund structure: three-to-five year
  investment period, eight-to-twelve buildings, and the observation that a
  sponsor who cannot deploy at that rate never raises a second fund.
- `Rival.heldSince` — "a private-equity fund on an IRR mandate and a family
  office holding for a generation both own buildings, and the only thing that
  distinguishes them is this number."
- `reason: "fund-life"` as a disposition trigger.
- The raise-timing insight is already written down and correct: *"Nobody raised
  a real estate fund in 1988. Everybody raised one in 1992."*

So the fund model exists, is calibrated, and is commented. **It has simply
never been pointed at the player.**

### The mechanism

**A fund object** with vintage, size, investment period, life, preferred return
(~8%), promote (~20% over pref), and GP co-invest. All of these are calibrated
industry constants with citations, not tuning knobs.

**Raising is earned, never a menu.** What you can raise is a function of
realised returns net to LPs, `sponsorStanding()` (which already computes
`spreadAdd`, `advanceCut`, `institutional` and a `label` running from "clean" to
"untouchable"), the market phase, and relationships. `sponsor.ts` already says
in its header comment that *"one day a rival will read it too"* — the LP is
that reader.

**The promote is the drama.** It crystallises on realisation, which creates
both the pressure to sell at fund end and the temptation to swing late in the
fund's life for a hurdle you are short of. That is why real sponsors buy the
wrong building at the top, and it is a decision the player currently has no way
to face.

**The second death.** The game today knows exactly one ending: insolvency, four
quarters cash-negative. Add the more common one — *you survive, and nobody will
back you again*. A living firm that cannot raise is a real terminal state, it is
more frightening than bankruptcy, and it makes reputation load-bearing rather
than decorative.

**The LP as a character** (`IDEA_FEST` #7). A fund at the end of its life must
sell whether or not the market is good, which is the single most common reason a
good building trades at a bad time. Once the player can *be* on that clock, they
can also learn to read who else is.

### The choice that is the whole game

The player should be able to stay on their own balance sheet — slow, safe,
patient, the family-office path — **or** raise funds: fast, fragile, and
scalable. Keep the balance-sheet path as the default and make funds opt-in.

This is worth stating plainly because it is the design payoff for both parts of
this handoff: `CENTURY_REPORT.md` proves that this exact choice decides the
century, in 231 out of 231 attempts, and the player currently cannot make it.

---

## 5. PART C — ONE PEOPLE SYSTEM, REPLACING `staff.ts`

With `staff.ts` in scope for replacement, the answer changes. Do not give the
player a second, parallel skills system. **Collapse the payroll and the
principal into one type: a person.** The player is one, every hire is one,
every heir is one, every rival firm is run by one.

That is not tidying. It is the change that makes the rest of this document
cohere — and it closes an open fault in `HANDOFF.md` §6 that has nothing to do
with either Part A or Part B.

### What `staff.ts` gets right, and must survive the rewrite

Four things, and they are the reason this system was worth building at all:

1. **Capacity, never a multiplier.** Its own header: *"A dial that reads 'good
   manager: opex ×0.94' is a difficulty setting wearing a job title, and
   CLAUDE.md forbids it."* A person covers so much and no more; what degrades
   is the work. Difficulty is arithmetic nobody typed.
2. **Hidden truth, noisy read, pay to narrow.** `attrs` is true ability 1–100
   and is **never shown**; `obs` is what the interview suggested; `band0` is
   how wide that read was, narrowed by paying for a search. This is the best
   single idea in the codebase and it generalises to people you do not employ.
3. **Its own RNG stream.** See §8 — this is load-bearing and was measured.
4. **The G&A split.** `NON_PAYROLL_GA_SHARE = 0.55` — hiring a manager must not
   bill the player for the same person twice, once in `ga` and once in salary.
   Any replacement inherits that constraint or silently double-charges.

### What it gets wrong

- **Three fixed role slots** (`pm | leasing | construction`). A principal is not
  a `StaffRole`, so the player cannot be represented in the system that models
  everyone else's competence. Hence `ownerCapacitySf()`, an ad-hoc function that
  exists only because the owner does not fit the type.
- **Attributes attach to a role, not to a career.** `ROLE_ATTRS` is keyed by the
  seat someone was hired into. What a person is good at should be a readout of
  what they have actually done.
- **Nobody wants anything.** A hire is acquired, assigned, and then is payroll.
  The only thing that ever happens to them is being poached — a pure loss with
  no counterplay, at 1.2%/month once mean ability ≥ 72 and tenure ≥ 24 months.
- **Two free dials, and they are the clearest surviving difficulty settings in
  the repo.** `ownerStyle: "handsOn"` multiplies your own capacity by 1.35
  (1.25 for construction) and `benchStyle` reshapes the ability→capacity curve.
  I grepped both: outside `staff.ts` they appear only in `types.ts` and as four
  buttons in `StaffPage.tsx`. **There is no offsetting cost anywhere in the
  engine.** The UI says so out loud — *"Neither dial is a skill chip; they
  change capacity arithmetic"* — which is an admission, not a defence. A button
  that reads "cover 35% more square feet yourself" for free is `CLAUDE.md` fake
  number 4. Note that the *inferred* form (`effectiveOwnerStyle` reading
  headcount) is fine and should stay: shape emerging from the org chart is an
  output. It is the forced override that is the dial.

### The replacement: one person

```
Person {
  name, born, attrs (hidden true), obs (what you think), band
  career  — what they have actually done, by class and submarket
  ties    — who they know                        (StreetTie, exists)
  wants   — money, title, a piece of the deal
  seat    — you | partner | employee | rival principal | none
}
```

Five things fall out of that, and none of them needs a new subsystem.

**1 · The player is in the org chart.** `ownerCapacitySf` disappears — you have
a capacity because you are a person, on the same arithmetic as everyone else.
This also kills the double-counting risk head-on: if the player and their staff
had separate attribute systems both acting on capacity and quality, that is
*one quantity with two answers*, the most productive bug class in this repo.
One type, one answer.

**2 · Skill is a readout of a career, not a build.** Keep the four general
attributes — `judgment, urgency, diligence, relationships` — as universal; they
read as well for a founder as for a leasing agent. Replace `ROLE_ATTRS` with
competence **earned by doing, per asset class and per submarket**. A person who
has run forty office leases in the Exchange knows office in the Exchange.

This is worth more than it looks. It gives the game **specialisation**, which is
real and currently absent: your firm is good at Millside industrial because that
is where you have worked, and moving into Exchange office makes you a novice
again. That is the honest reason real firms stay in their lane, and no
coefficient is imposing it. It also creates the first genuine reason to hire
rather than do it yourself — **you are buying a market you do not know** — and
it gives the start-age trade in §3 its teeth, because the 52-year-old bought
competence with the years they have left.

**3 · People want a piece, and that is where Part B pays for itself.** The way
you keep a good operator in this business is carry — a share of the deal. That
is the fund machinery from §4 pointed inward, it costs the player exactly the
thing they are trying to accumulate, and it converts the poaching event from an
unavoidable loss into a negotiation with a price.

**4 · People leave and become your competitors.** Every firm on that league
table was, in life, founded by somebody who left another firm. Right now
`rivals.ts` spawns firms from a capital-driven refill rule whose own comment
admits *"nothing in the rule capable of saying no"* — firm count drifts up about
three per century with no mechanism bounding it. `HANDOFF.md` §6 lists **#48/#49
firm entry and exit** as open.

Spawning new firms out of the people who leave existing ones replaces a rail
with a mechanism, and it gives the league table a **genealogy**: every rival
traceable to the firm they walked out of. The person you trained, whose true
attributes you are the only one who ever learned, is now bidding against you on
a corner. That is the best rivalry this game could have and the state for it is
already three-quarters built.

**5 · People are what survives a death.** This is the join with Part A. The heir
inherits the buildings and the debt and loses the principal's phone book — but
they keep **the firm's people**, and those people have their own `ties`. That is
precisely why real family firms have non-family partners, it gives the player a
reason to build a bench before they are old rather than after, and it opens an
ending the game does not currently have: **succession from inside**, where your
best partner buys the estate out. Common in life, and a far better last chapter
than a forced liquidation.

### The guardrail, unchanged

A skill may never multiply an outcome. It acts on exactly four things:

| axis | what it changes | precedent |
|---|---|---|
| **capacity** | how much you can run before work slips | `personCapacitySf`, `roleState().slip` |
| **access** | whose call gets returned, what you see before the tape | `lenderRel`, `StreetTie`, `IDEA_FEST` #1 |
| **information** | how narrow your read is before you commit | `Staff.obs` / `band0` |
| **time** | how long a thing takes you | existing lease-up and sale clocks |

A skilled principal must not make the market kinder. Skills widen the set of
decisions available and do not reduce the risk in any one of them.

**Visibility:** you see your own attributes — a person knows themselves — and
never anyone else's, including your own staff's. You learn a person by working
with them, which is the `obs`/`band` model doing the work it was built for. That
rule is what makes Part D playable.

---

## 6. PART D — THE OTHER PRINCIPALS

The owner's second idea, and the cheapest large win in this document.

Every rival firm gets a named person with an age, a record, a temperament and
hidden attributes. `StreetTie { deals, beats, insults, lastM }` and `Beat`
already exist and already track exactly what you and a firm have done to each
other — attach them to the **person**, so that when the person dies or their
fund ends, the relationship resets. A relationship that depreciates is an asset;
one that never does is a permanent upgrade.

**Why this is the highest-value display change available.**
`CENTURY_REPORT.md` §IX proved the league table is an actively misleading
document: thirteen different firms lead at year 25 across twenty-two centuries,
and the year-25 leader is still first at year 100 **four times out of
twenty-two**. The report's own recommendation was to let the player learn *that*
rather than to make the table accurate.

A table of firms cannot be read. A table of **people** can:

> *Barrowgate Realty · +40% this decade · run by Halloran Voss, 44, second
> fund, vintage 2031, 71% LTV*
>
> *Thorne & Boyle · flat · run by Edmund Boyle, 71, no fund, no debt, third
> generation*

Everything that decides the next thirty years is in the second column and none
of it is in the equity column. The player learns to read people, and the game's
single most valuable emergent finding becomes something you can *see* instead of
something that happens to you.

**What is visible and what is estimated.** Balance-sheet aggregates are roughly
public and already marked monthly (`markRival`). Age is approximate. Fund
vintage and life are inferable from behaviour. **Attributes are never visible** —
you narrow the band by dealing with them, using the `staff.ts` observation
model. Reading rivals becomes a skill in exactly the sense of §5.

---

## 7. WHAT THIS DOES TO THE CONSERVATION IDENTITY

**Read this section before writing a line of code.** `pnpm conserve` is the
repo's one hard gate and every item in this handoff moves money.

The identity is:

```
Δcash == (noi + sold + interest)
       - (debtSvc + leasing + capex + dev + taxes + bought + ga)
       + Δloc.balance + Δdeposits
```

New movements, and what each one is:

| movement | kind | disposition |
|---|---|---|
| LP capital called in | equity in — **not income** | new bucket, follow the `borrowed` precedent |
| distributions to LPs | equity out — **not expense** | new bucket |
| promote crystallising | transfer between the fund and the principal | **open question — see below** |
| estate tax paid | tax | `taxes` exists, but will see a step change of a magnitude that bucket has never carried |
| life-insurance premium / proceeds | expense in `ga` / inflow that is not income | proceeds need a bucket or an explicit exemption |

The `borrowed` field on `BooksYear`/`BooksMonth` is the exact precedent: the
facility work already established how to add a balance-sheet inflow to this
identity without breaking it, and its comment records that the identity *"used
to be blind to these — they raised cash with no books entry."* Do the same
thing, the same way.

**And extend `conserve`'s coverage assertion.** `CLAUDE.md` documents at length
how the conserve bot spent an unknown number of commits reconciling a player who
owned nothing while printing a pass. Every new bucket must be *exercised* by the
bot and named in the coverage line, or the gate is decorative for that bucket.

**The promote is a genuine modelling question, not an implementation detail.**
The engine keeps one pooled `s.cash`. A promote is the GP's share of a profit
that belongs to a vehicle the GP does not own. If the player's cash and the
fund's cash are the same number, the promote is a transfer with no counterparty
and `conserve` will be reconciling a fiction that happens to balance — the exact
failure mode of `A == B` holding trivially because both sides are zero. Decide
whether the fund is a second cash account **before** building the raise.

---

## 8. THE RNG DECISION — MAKE THIS ONE FIRST

`HANDOFF.md` §4 calls the RNG stream re-roll "the big one": changing the
*number* of `rng()` calls anywhere re-rolls the entire century, and it looks
exactly like a catastrophic regression. This feature adds a monthly hazard
evaluation for the player and a dozen-plus rival principals — the largest new
source of draws anyone has proposed for this engine.

There are **three** precedents, not two, and the third one — found while
re-reading `staff.ts` for §5 — is the best and supersedes what the first draft
of this section recommended:

- **`swans.ts` uses `hash01`**, a keyed FNV hash drawing nothing from `s.rng`,
  explicitly so that "an identical build with the firing lines switched off
  produces a bit-for-bit identical stream, and every seed is its own control."
  That is how the swan work reported paired t-statistics.
- **`owners.ts` deliberately consumes `s.rng`**, on the reasoning that an exit
  is an event in the world.
- **`staff.ts` runs its own generator.** `s.staffRng`, seeded `s.seed ^
  0x5741ff`, stepped only by that module. The header explains why, with the
  measurement: generating the hiring pool from the shared stream moved
  loan-index drift through an engineered glut from −0.04pp to **+0.97pp across
  nine seeds and broke acceptance test H**, with nothing about the economy
  having changed at all. Its conclusion generalises exactly:

  > *"A hiring pool is not a fact about the property market and it must not be
  > able to move one."*

  Neither is a man's date of death. And the same comment notes this is *"the
  first piece of"* what `CENTURY_REPORT.md` §VI asks for on the macro economy
  generally — one shared PRNG for the whole world is open fault #4.

**Recommendation: a dedicated `s.peopleRng` stream, and draw the date once.**

A separate stream beats `hash01` here because it gives everything `hash01` gives
and one thing more:

1. **Paired-testable.** With the feature off the people stream never steps and
   `s.rng` is untouched, so the control is bit-identical — same property the
   swan work relied on.
2. **`BASELINE.json` stays meaningful.** Phase 1 should leave it *bit-identical*,
   which is a checkable claim and therefore a free correctness test.
3. **It satisfies `owners.ts`'s objection.** A death stays a genuine event drawn
   at the time rather than a hash lookup, so the demographic layer is
   philosophically consistent with the one demographic system already shipped.
4. **It is the pattern this repo has already blessed and measured**, and it
   advances the fix §VI asks for instead of adding a fourth convention.

**Draw the death date once, at the principal's creation, not as a monthly
hazard.** One draw per person for their whole life instead of one per person per
month. Minimal draw count, trivially auditable, and it buys foreshadowing: the
world knows Edmund Boyle is 71 and knows when he dies, so the game can lay a
`tell` (`IDEA_FEST` #11) without anything peeking at a future roll.

The caveat, stated so nobody is surprised: an isolated stream buys nothing if
the same commit also changes an `s.rng` call count elsewhere. Land the
demographic layer with **zero** `s.rng` changes and it is paired-testable
forever. And note `staff.ts`'s own hard-won discipline about draw counts *within*
a private stream — *"ALWAYS draw once per seat so a star on the payroll cannot
change how many staffRng steps the month takes"* — which applies with full force
to a people system where the population changes size.

---

## 9. BUILD ORDER

Each phase ends runnable and committed, cheapest-and-most-informative first.

Revised after §5. The people system is no longer a late phase — it is the
substrate the others read, so it lands first, and the `staff.ts` migration is
paid off early rather than carried.

1. **The `Person` type, inert.** One type for the player, every hire, every
   heir, every rival principal. `staff.ts`'s `Staff` becomes a `Person` with a
   seat. Name, birth month, attrs, obs, band. Nothing new reads it; existing
   staff behaviour is re-pointed at the new type unchanged. Save migration to
   `v: 33`, `s.peopleRng` initialised. **Delete `ownerStyle` / `benchStyle` as
   forced overrides; keep the inferred form.**
   *Exit: `pnpm gate` green, `pnpm staff` unchanged, and `pnpm baseline:check`
   **bit-identical**.* If the baseline moved, something drew from `s.rng` and
   you want to know that now rather than in Phase 4.
2. **Read-only display.** Ages and principals on the league table; a person
   card; your own attributes visible and nobody else's. Still no new behaviour.
   **This is the phase that tells you whether the whole direction is fun**, and
   it costs almost nothing. Do not skip it and do not build past it until it
   has been played.
3. **Careers.** Competence earned by doing, per class and per submarket,
   replacing `ROLE_ATTRS`. This is the largest single behavioural change in the
   document and it lands alone, where it can be measured alone.
4. **Rival mortality only.** Rival principals age and die; estates sell through
   the existing `reason: "estate"` path. The player gets the opportunity before
   they get the risk. *Measure: does average hold move off 84 years?*
5. **Player mortality and the estate.** Start-menu age/capital trade, step-up vs
   recapture, §6166, succession as continue-as-heir with the relationship reset
   — and the bench surviving it.
6. **The fund.** Conserve buckets **first** (§7), then the raise, then the
   promote. Balance-sheet path stays the default.
7. **People leave and found firms.** Last, because it needs careers (3),
   mortality (4) and carry (6) to have anything to act on — and because it is
   the one phase that rewrites `rivals.ts` firm entry, which is load-bearing for
   the whole city.

---

## 10. WHAT TO MEASURE

- **`pnpm succession` — new, paired, swans-style.** Off vs on, same seeds, 24
  seeds × 100 years. Report: deeds traded per year and average hold (does 84
  move toward 8–15?), firm survival, top-firm share of assets, and the estate
  bill as a share of the estate at death.
- **`pnpm conserve`** — extended coverage assertion per §7. Must name any dead
  bucket and exit 1.
- **`pnpm fund` — new, to `pnpm facility`'s standard.** `HANDOFF.md` states that
  bar exactly: *it must work AND it must bite.* A fund path that only ever helps
  is not modelled, it is granted.
- **`pnpm staff`** — must keep passing across Phase 1 unchanged. It is the
  regression test for the `staff.ts` → `Person` migration, and if the rewrite
  is behaviour-preserving as intended it should not need editing. Editing it to
  make Phase 1 pass is how you lose the only control you have.
- **`pnpm firms` — new, at Phase 7.** Firm entry by genealogy against firm entry
  by capital refill. The current rule drifts up about three firms a century with
  nothing able to say no; the replacement must be *able* to say no. Report firm
  count by decade, founder provenance, and how many new firms trace to a
  departure.
- **`BASELINE.json`** — expect turnover metrics to move at Phase 4 and later.
  Regenerate deliberately and say why in the commit message. **Phase 1 must not
  move it at all** — that is the whole point of Phase 1.

**The acceptance test that matters**, and it is falsifiable: the century record
says no leveraged fund has finished a century in 231 attempts, and five family
offices win every one. Once the player can choose either path, re-run it. **If
the fund path wins, the promote is priced too cheaply and something is wrong.**
The simulation already told us what the answer should look like; this is the
rare feature that ships with its own oracle.

---

## 11. TRAPS

**The frozen world.** `advanceMonth` returns state unchanged once `gameOver` is
set. A succession must **not** set `gameOver`. And note the new failure mode: an
un-resurrected probe will now silently stop at the principal's death and every
later month will be a copy of the month they died in. That will look exactly
like the "plateau in how many firms a city supports" that turned out to be the
game being over. Every probe past year ~30 already needs the resurrect line;
after this work it needs it for a second reason.

**`test/entry.mjs` MODULES.** A new `principal.ts` or `fund.ts` missing from
that list is invisible to every harness, silently. `staff` was missing once.

**One quantity, two answers.** The most productive bug class in this repo, and
this feature creates a fresh instance of it on day one: net worth will now have
at least two meanings — the firm's equity, and the principal's estate net of a
deferred tax that has not been assessed yet. Decide which one the top bar shows,
make exactly one function compute each, and write down which is which before
anybody adds a third. `pnpm legmatch` exists because of the last time.

**Readers stay pure.** `owners.register()` caches in a module `Map` on purpose —
the first cut cached to `s.holders`, which meant `holderOf` mutated the state it
was handed. Any principal lookup called from a render path has the same shape
and the same risk.

**`START_YEAR` and stray year arithmetic.** This entire feature is age
arithmetic. There were once seventeen hardcoded `2000 + Math.floor(month/12)` in
seven files while the constant said 2024, and the game printed one year while
ageing its stock from another. Grep before adding another one.

**A test that cannot fail is itself a fake.** Check that any new metric can
move before trusting that it did — in particular, an estate-tax metric on a
cohort where nobody has died yet reports zero, correctly, forever.

**The G&A double-charge.** `NON_PAYROLL_GA_SHARE = 0.55` exists because the
`ga` line in `sim.ts` used to charge ~30bps of gross asset value for an office
nobody could see, and roughly 45% of a real firm's G&A is the payroll
`staff.ts` made explicit. Replacing the payroll without carrying that split
forward bills the player for the same person twice. It is invisible in every
harness except `conserve`, and `conserve` will only see it if the bot has
staff — which is exactly the coverage failure `CLAUDE.md` documents at length.

**Draw counts inside a private stream.** `staff.ts` draws once per seat
unconditionally so that a star on the payroll cannot change how many steps the
month takes. A people system has a *changing population* — hires, deaths,
births of heirs, founders leaving — so the same discipline is harder and matters
more. Decide the iteration order and the draw-per-person contract before
writing the tick, not after a century diverges.

---

## 12. OPEN QUESTIONS FOR THE OWNER

1. **Continue as the heir, or play the heir you are given?** Recommend
   continue-as-heir; the loss of the phone book is penalty enough and it keeps
   agency intact.
2. **Does the player see their own attributes?** Recommend yes for themselves,
   never for anyone else.
3. **Is the fund path optional?** Recommend yes — the choice is the game, and
   forcing it would delete the family-office strategy the century record says
   is the correct answer.
4. **Is the fund a second cash account?** §7. This one blocks Phase 5 and
   should be answered before it starts.
5. **How hard is the estate allowed to be?** Per the standing instruction, the
   *rate* is not a preference — it is a fact about the world. The dial is how
   much **counterplay** exists (insurance, §6166, gifting, ground leases), and
   that is a legitimate design conversation. Worth being explicit, because this
   mechanic will kill conservative players who have done nothing wrong, which
   is exactly what it does in life and will still feel bad the first time.
6. **Does the player keep a hire's true attributes secret from themselves
   forever?** §5 says you learn a person by working with them and never see the
   number. The alternative is that after enough years the band collapses and
   the number is simply shown. Recommend the band never fully closes — it is
   the more honest model and it keeps the "your former employee is now a rival
   whose true ability only you ever estimated" beat intact.
7. **Do departures respect the firm cap?** Phase 7 replaces a rule that "cannot
   say no" with a mechanism, but a people-driven spawn can also fail to say no
   if every good hire eventually leaves. The bound should be product — the town
   turns over 7 to 21 buildings a year — not a headcount rail. Worth agreeing
   before Phase 7 rather than discovering it in a century run.
8. **Does the existing `pnpm staff` harness still describe what we want?** It
   was written against the three-role model. If Phase 3 replaces roles with
   careers, some of what it asserts becomes a description of a system we chose
   to delete. Separate "this regressed" from "this is no longer the design"
   explicitly, in the commit message, at the time.
