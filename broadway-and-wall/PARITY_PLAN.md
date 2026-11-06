# One rulebook: the player is one firm among firms

Owner's decision, 2026-11-06: *"each competitor [should have] the same exact abilities to do things as the player does … players decide what they deem is a good deal or something they want to go after, I don't want it to be very structured and rigid in the code."* The reference is Capitalism Lab: AI companies play the same game, through the same actions, as the human.

The owner's answers to the four design questions:

| Question | Answer |
|---|---|
| How far does parity go? | **Full, both ways.** Every action exists once. Any firm, the player or an AI, can use it on any other firm, the player included. |
| How does a firm decide? | **It scores every option and picks the best.** Each month a firm lists what it could do, values each option with its own beliefs, money and temperament, and acts on what it judges best. Strategy emerges; nothing is scripted. |
| What does a firm know? | **What the player could know.** Listings, comps, rumours, its own books, its broker's calls. A firm can misjudge. |
| When? | **Now,** in small measured PRs, alongside REAL_ECONOMY_PLAN. |

## Where it stands (inventory, 2026-11-06)

- **The player's actions** go through the store (`src/state/store.ts`, the action interface at lines 229-557) and are discrete decisions.
- **The rivals' actions** run inside the month tick (`sim.ts` 758-881) on monthly hazards (`rng(s,"rivals")`, hashed clocks), style tables (`paramsOf`, `styleHunt`) and scripted ladders. There is no negotiation.
- **The two share some machinery:** the quote sheets, `bidRound`/`maxPrice`, `underwriteDevelopment`, `mergeCost`, the take-private quote.
- **They differ in four ways:**
  - The decision is a coin, not a choice.
  - About 40 player actions have no rival equivalent: negotiation and counters, repricing and delisting, the broker, mezz, rate caps, the facility, recap, variances and entitlements, plats, ground leases, sale-leasebacks, tax appeals, the leasing decisions, workout requests, note modification and filing, 1031, JV stakes, and the bank and cash settings.
  - Some rival behaviour has no player equivalent: claiming city-growth jobs, being sold to an outsider, a receiver wind-down, poaching tenants for a build-to-suit.
  - The books are stored twice:

| Concept | Player | Rival |
|---|---|---|
| cash | `s.cash`, `s.bankId` | `r.cash` |
| buildings | `s.holdings[bbl]` (a full `Holding`) | `r.bbls`, `r.heldSince`, `r.marks`, book-level `r.condIdx` |
| mortgages | `Holding.loan`, `.mezz`, `s.facility` | `s.cityLoans[bbl]` rows, `r.debt` derived, construction debt on `s.cityJobs` |
| line | `s.loc` | `r.lineBal`, `r.lineBank` |
| tenants | `Holding.tenants` | `econ.streetRolls[bbl]` |
| funds | `s.fund`, `s.raises`, `s.syndications`, `Holding.jv` | `r.uncalled`, `r.jvs` |
| standing | `s.reputation`, `s.lenderRel`, `s.street` | `s.reputation.street[r.id]`, `r.doors`, `r.feud` |

## The design

### 1. One firm record
`Firm`: cash and bank, deeds (each with its roll, condition, loan stack and JV), the line, the facility, funds and LPs, reputation, and relationships with lenders, brokers, holders and other firms. The player is the firm `"player"`.

Migration path, so nothing breaks at once:
- (a) a `firmView(s, id)` adapter that reads either store;
- (b) actions written against the adapter;
- (c) storage converged one concept at a time, cash first, tenants last. At each step the whole state hashes identical where behaviour is meant to be unchanged.

### 2. One action catalogue
Every action is `{ kind, legal(s, firm, args), quote(s, firm, args), apply(s, firm, args) }`, in one module per domain:
- acquire: buy, bid, LOI and haggle, off-market approach, auction, note, take-private, package, assemble;
- dispose: list, broker, accept, counter, reprice, delist, package, 1031;
- develop: build, demolish, reuse, build-to-suit, renovate, variance, entitlement, plat, split;
- finance: refinance, pay down, mezz, cap, line, facility, fund, raise, recap, private credit, bank;
- lease: answer an LOI, renew, concessions, spec suites, buyouts, leasing policy;
- operate: capex programmes, ops stance, tax appeal;
- distress: cure, forbearance, deed in lieu, DPO, note workouts.

The store's player actions become thin calls into the catalogue. The rivals call the same functions. An action never asks who is calling, except to read that firm's own books.

### 3. One decision loop
Each month, each AI firm:
1. **Sees** what the player would see: its broker's listings and calls, the comps and cap tape, its own books and tenants' asks, its lenders' quotes, the news. Its beliefs come from `beliefs.ts`, so it can be wrong.
2. **Lists candidate actions** from the catalogue's `legal` checks on what it sees.
3. **Values each one** with its own underwriting (`valueTo`, its required return, its outlook), net of costs, against doing nothing. "Good deal" is its own judgement, not a rule.
4. **Acts** on the best, within its capacity, while the value clears its bar. Capacity is people, as in life: a firm has a staff that can run so many deals, leases and builds a month (`sheet.capacity`). That is a real limit, not a rail.

Hazards, hold clocks and style ladders are deleted as their actions move onto the loop. What stays is contract terms (a fund's life and extensions, a loan's maturity), law (the lending limit, foreclosure), and each firm's own sheet (its temperament).

### 4. Both ways
Whatever an AI firm can do to another firm, it can do to the player, and the player to it:
- bid on your listing, or haggle on its own listing with you;
- buy your defaulted note;
- take you private if you are listed;
- poach your tenant;
- lend to you or borrow from you.

The player gains the AI-only abilities where they make sense: claiming a conceived city-growth site, selling to an outside buyer, buying a receiver's book.

## The order of work, each step a measured PR

| Step | What | Done when |
|---|---|---|
| P0 | `firmView` adapter and the `Firm` type; the store's actions call through it | the whole state hashes identical (seed 11, 48 months) |
| P1 | **Acquire**: rivals buy through `buyListing`'s path (same quote, desk choice by relationship, closing costs), and can haggle (`negotiate`) and counter | conserve; century; rival deals per year in band |
| P2 | **Dispose**: rivals list, price, reprice, delist, and accept or counter bids through the player's functions; the hold-clock and trim hazards are deleted | crunch shock: deal volume falls; conserve |
| P3 | **Finance**: refinance, pay down, mezz, caps and the facility as decisions; the maturity ladder becomes a choice among the same options | conserve; charge-off and refi rows |
| P4 | **The decision loop** replaces the monthly hazards in `tickRivals`, `tickOffMarketCalls` and `tickPortfolios` | the rail audit shows no rival hazard; CPU per month measured and acceptable |
| P5 | **Develop**: `startDevelopment`, renovation programmes, variances and entitlements for rivals | starts rows; conserve |
| P6 | **Lease**: rivals answer LOIs, renew and set concessions through the player's leasing functions | rent/vacancy rows; conserve |
| P7 | The rest: notes, take-private, auctions, ground leases, plats, tax appeals; then **both ways** for every action | inventory reads "none" in neither column |
| P8 | Storage converged; the second book (rival-only fields) deleted | grep finds one book |

**Rules:**
- One action domain per PR.
- Behaviour-neutral refactors are proven by a state hash; behaviour changes by conserve, the century, the shocks that touch them, and a CPU-per-month figure.
- No step adds a rail or a coin.
- Perfect parity is checked by the inventory itself: every action has the same function on both sides.
