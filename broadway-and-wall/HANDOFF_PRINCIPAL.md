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
| `staff.ts` — every hire has hidden true `attrs`, an observed `obs`, a confidence `band0`, a salary ask priced off ability, and can be poached | has no attributes at all |

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

## 5. PART C — SKILLS, DONE THE `staff.ts` WAY

The owner asked for a skills system. It is the right instinct and it has one
failure mode, which `CLAUDE.md` names as fake number #4 and `staff.ts` names in
its own header:

> *"A dial that reads 'good manager: opex ×0.94' is a difficulty setting
> wearing a job title, and CLAUDE.md forbids it."*

**A skill may never multiply an outcome.** It acts on one of four things, and
`staff.ts` already demonstrates all four:

| axis | what it changes | precedent in repo |
|---|---|---|
| **capacity** | how much you can personally run before work starts slipping | `ownerCapacitySf()`, `roleState().slip` |
| **access** | whose call gets returned, what you see before the tape does | `lenderRel`, `StreetTie`, `IDEA_FEST` #1 |
| **information** | how narrow your read is before you commit | `Staff.obs` / `band0` |
| **time** | how long a thing takes you | existing lease-up and sale clocks |

The `staff.ts` observation model is the keystone and should be lifted wholesale:
`attrs` is **TRUE ability, 1-100, never shown**; `obs` is what the interview
suggested; `band0` is how wide that read was, narrowed by paying for a search.
Hidden truth, noisy observation, pay to narrow the band. That is already the
best system in this codebase and it generalises to people the player does not
employ.

**Skills are earned by doing, never bought from a pool.** No XP, no shop, no
respec. You get better at leasing office space by leasing office space. This
also gives the start-age trade in §3 real teeth: the 52-year-old bought
competence with the years they have left.

**The trap to hold the line on:** a skilled principal must not make the market
kinder. Skills widen the set of decisions available — more deals at once, more
seen before committing, more calls returned — and do not reduce the risk in any
one of them. Difficulty stays an output.

**Recommendation on visibility:** the player sees their own attributes (a person
knows themselves) and never sees anyone else's. Which leads directly to Part D.

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

There are two precedents and they went opposite ways:

- **`swans.ts` uses `hash01`** — a keyed FNV hash with an extra avalanche
  round, drawing nothing from `s.rng` — explicitly so that "an identical build
  with the firing lines switched off produces a bit-for-bit identical stream,
  and every seed is its own control." That is how the swan work was able to
  report paired t-statistics.
- **`owners.ts` deliberately consumes `s.rng`**, on the reasoning that an exit
  is an event in the world.

**Recommendation: `hash01`, keyed, for everything demographic.** Three reasons:

1. This feature is *expected* to change league-table outcomes materially. If it
   also re-rolls every world, nobody will be able to tell whether succession
   made the game harder or the weather simply changed. The century medians
   cannot resolve anything smaller than a factor of two across seeds.
2. It keeps `BASELINE.json` meaningful. A hash-only demographic layer with zero
   `s.rng` changes should leave the baseline **bit-identical** — which is a
   checkable claim, and therefore a free correctness test for the whole of
   Phase 1.
3. Keyed as `` `${s.seed}:principal:${firmId}:${yr}` ``, a principal's death
   date is fixed at world creation and merely *discovered*. Philosophically
   this is fine — it is a hazard being realised — and it buys something
   valuable: heirs and their attributes are deterministic too, so the game can
   foreshadow a succession honestly.

The caveat, stated so nobody is surprised: hashing buys nothing if the same
commit also changes any `s.rng` call count elsewhere. Land the demographic layer
with **zero** `s.rng` changes and it is paired-testable forever.

---

## 9. BUILD ORDER

Each phase ends runnable and committed, cheapest-and-most-informative first.

1. **The principal, inert.** Add the object for the player and every rival.
   Name, birth month, nothing reads it. Save migration to `v: 33`.
   *Exit: `pnpm gate` green and `pnpm baseline:check` bit-identical.* If the
   baseline moved, something drew from `s.rng` and you want to know now.
2. **Read-only display.** Ages and principals on the league table; a principal
   card. Still no behaviour. **This is the phase that tells you whether the
   whole direction is fun**, and it costs almost nothing. Do not skip it and do
   not build past it until it has been played.
3. **Rival mortality only.** Rival principals age and die; estates sell through
   the existing `reason: "estate"` path. The player gets the opportunity before
   they get the risk. *Measure: does average hold move off 84 years?*
4. **Player mortality and the estate.** Start-menu age/capital trade,
   step-up vs recapture, §6166, succession as continue-as-heir with the
   relationship reset.
5. **The fund.** Conserve buckets **first** (§7), then the raise, then the
   promote. Balance-sheet path stays the default.
6. **Skills.** Last, because they need the other five to have anything to act
   on.

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
- **`BASELINE.json`** — expect turnover metrics to move at Phase 3 and later.
  Regenerate deliberately and say why in the commit message. Phase 1 must not
  move it at all.

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
