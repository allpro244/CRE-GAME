# UI revamp plan

Status: **design approved in outline (2026-10-21), second pass.** Nothing under
`broadway-and-wall/src` or `unreal/` has been changed by this branch
(`claude/ui-revamp-plan`). The speed fixes P1–P7 (§4) are being built in the
`ui-speed-fixes` session; this plan does not implement them.

- **Mockups:** [`mockups/index.html`](mockups/index.html), published as a private
  Artifact: https://claude.ai/artifact/J4NRf711skqRaWeS9xw8sf
- **Build spec for migration steps 1–4:** [`BUILD_SPEC.md`](BUILD_SPEC.md)
- **Inventory of today's UI:** [`INVENTORY.md`](INVENTORY.md)
- **Profiling harness:** [`profile-harness.html`](profile-harness.html)

The owner's goal, verbatim: *"Simple, not filled with a bunch of words, little
handholding, able to deeply read the economics and statistics, and most
importantly functional. Functional and simple while maintaining depth is the
key. Removing filler words and nonsense that clutters the page. Efficiency."*

Decisions taken (by the main session for the owner): five places + Inbox;
drawer beside the city; region view is a 3D metro scene in Unreal; Unreal
camera presets move to F1–F3; speed fixes ship first.

---

## 0. Design rules

These are hard rules. A screen that breaks one does not ship. They sit on top of
`broadway-and-wall/UI_PRINCIPLES.md` and win where the two disagree.

**R1 · Word budget.**
- Labels, headings, tabs, column heads, chips: **1–3 words.**
- Buttons: a verb, optionally with an object or amount, **at most 3 words**
  ("Pay ask", "Offer $310K", "Refinance").
- **No sentences on screens.** No page subtitles, no hint text, no explanatory
  paragraphs, no "why" blurbs, no empty-state essays. An empty list says
  "None" (or "No offers").
- Inbox rows and toasts are **fact fragments of at most 8 words**, not sentences:
  "Balloon Oct · $11.2M · 6.1%", not "Your loan on 85 State St balloons in five
  months and lenders are quoting…".
- Explanation, where it is genuinely needed, goes behind a **"?"** on the label:
  a definition of at most 40 words with the formula (from `ui/Glossary.tsx`), or
  a tooltip of at most 12 words. Nothing else.
- Disabled verbs say why in a tooltip of at most 8 words ("Needs $1.2M more").

**R2 · Numbers, not sentences.** A quantity is a figure with a unit. A trend is a
sparkline or a signed delta. A comparison is a column. Words never restate a
number that is already on screen.

**R3 · Every number drills.** Any figure on screen is clickable and opens its
**breakdown**: the inputs, the arithmetic as one line, and a link to the full
table it comes from. One click to the breakdown, one more to the source.
The required drills are in §0.1.

**R4 · Dense, sortable tables.** 32px rows, tabular monospace numerals, every
column sortable, sticky header, virtualised, a column picker, sparkline columns
where a series exists. Small multiples over a single large chart. Row actions
on the row.

**R5 · Fewest clicks.** The common jobs have click budgets (§0.2). Defaults
remove choices the player makes the same way every time (financing preset,
best scheme). Every frequent verb has a key.

**R6 · No handholding.** No onboarding or tutorial flows, no "Start here", no
primer offers, no coaching lines, no "where to start" lists, no celebratory
moments that stop play. The Primer and Glossary survive only as the reference
behind "?".

**R7 · No decorative motion.** No arrival animations, pulses, glows, breathing
buttons, stamps or count-up effects. State changes are instant. The one moving
thing allowed is a progress bar while the clock runs.

**R8 · One fact, one place.** If two places show the same figure they call the
same function and one of them is a link to the other.

**R9 · Speed budget.** Any place opens in under 50 ms (production build, a
50-building firm). No render path loops over every parcel in town; that work is
cached per month or done in the worker.

### 0.1 Drill map (R3)

| Figure | Click opens | Source function (see BUILD_SPEC §5) |
|---|---|---|
| NOI | rent roll lines − opex lines (tax, insurance, management, repairs, reserves) = NOI | holding rent roll + opex in `engine/value.ts` / `engine/sim.ts` |
| Cap rate / going-in | NOI ÷ price, with the NOI drill inline | same |
| Value / appraisal | NOI, cap, income value, appraisal range, replacement cost, comps used; total = the mark. Only what the engine computes: no invented weights | `marketAppraisal`, `incomeValueAsIs`, `appraise`, `replacementCost` |
| Land value | scheme (use, floors, coverage) · finished value/sf − cost/sf = residual; builder vs holder bid, which wins | `landRead` / `residualScheme` (`engine/value.ts:1297`, `:707`) |
| Cash flow | waterfall: NOI → debt service → capex → overhead → CF | `ui/vitals/Waterfall.tsx` data |
| Net worth | balance sheet: assets at marks − loans − line = equity | BooksPage BalanceSheet |
| Debt | loan list: balance, rate, maturity, DSCR | the loan book |
| Rank | league table around you, ±5 places | `streetStanding` |
| Occupancy | by building, then by suite | `portfolioOccupancy` |
| Rent / sf | leases on the roll vs market rent | `portfolioRentPsf`, `marketRentPsfYr` |
| Vacancy, rent, cap (city) | by submarket and class, 20-year series | econ history |
| Rate (10Y, coupon) | index + spread = coupon, 10-year series | `econ.indexRate`, debt pricing |

### 0.2 Click budgets (R5), before → after

Counted from the default view (city, nothing open). "Before" is from the code
paths in INVENTORY.md §3.

| Job | Before | After | After path |
|---|---:|---:|---|
| Buy a listed building at ask | 6–7 | **3** | click building › Pay ask › Confirm (default financing) |
| Offer below ask | 7 | **3** + amount | click building › type amount › Offer |
| See cash and total debt | 1 | **0** | HUD |
| See why NOI is what it is | 3+ (Property › Money › scroll) | **1** | click the NOI figure |
| See what a lot is worth to build on | 3+ | **1** | click Land value › residual |
| Start a development on your lot | 4–6 | **3** | click lot › Plan (best scheme preselected) › Break ground |
| Answer a tenant letter | 3 | **1** | Inbox row › Accept / Counter / Decline |
| Refinance a maturing loan | 4–5 | **3** | Inbox row › Refinance › pick quote |
| Advance one month | 1 | **1** | Space or "+1 mo" |
| Read the news | 1–2 | **1** | City (remembers the News tab) |
| Find every building above 8% yield | 4+ (Marketplace, scroll, read) | **2** | Market › "Yield ≥ 8%" chip |

---

## 1. Prose audit of today's UI (R1)

**Method.** The dev build in Unreal mode, the 2012 test save (50 buildings).
Each page was opened from the store and every visible element whose text has
12 or more words, at least 70% of them alphabetic (so numeric table rows do not
count), and no child that meets the same test, was counted as a prose block.
"Words" is all visible words on the page; "prose" is the words inside prose
blocks. Source totals across `src/ui`: **344** `className="hint…"` sites,
**422** `title=` tooltips.

| Page | Words on page | Prose words | Prose share | Prose blocks | Hint elements | Buttons |
|---|---:|---:|---:|---:|---:|---:|
| Leasing | 4,349 | **1,552** | 36% | **53** | 10 | **511** |
| Primer | 1,433 | 1,224 | 85% | 43 | 6 | 7 |
| Tape (News) | 1,119 | 733 | 66% | 25 | 6 | 18 |
| Markets (Economy) | 1,133 | 644 | 57% | 18 | 4 | 16 |
| Banks | 2,259 | 481 | 21% | 19 | 11 | 19 |
| Marketplace | 1,597 | 429 | 27% | 13 | 8 | 26 |
| Players | 2,254 | 422 | 19% | 19 | 8 | 7 |
| Settings | 577 | 410 | 71% | 14 | 14 | 21 |
| Investors | 652 | 272 | 42% | 6 | 4 | 6 |
| Debt | 381 | 245 | 64% | 7 | 5 | 13 |
| Pulse | 362 | 240 | 66% | 10 | 0 | 9 |
| Card: listed building | 377 | 164 | 44% | 8 | 5 | 12 |
| Books | 1,028 | 162 | 16% | 7 | 6 | 17 |
| The Record | 889 | 142 | 16% | 8 | 3 | 56 |
| Portfolio | 2,135 | 133 | 6% | 4 | 4 | 165 |
| Property › Overview | 324 | 108 | 33% | 4 | 1 | 15 |
| Property › Operations | 312 | 97 | 31% | 5 | 1 | 27 |
| Deals | 169 | 82 | 49% | 6 | 3 | 12 |
| Saves | 99 | 69 | 70% | 3 | 5 | 3 |
| Rankings | 417 | 68 | 16% | 2 | 1 | 7 |
| Buildings | 1,053 | 48 | 5% | 2 | 2 | 8 |
| Property › Money | 218 | 25 | 11% | 2 | 0 | 10 |
| Card: owned building | 198 | 13 | 7% | 1 | 0 | 15 |
| City view (docket, HUD) | 369 | 100 | 27% | 5 | 0 | 68 |

Every page also carries a kicker + title + one-sentence subtitle
(`ui/RightPanel.tsx:208-211`); all subtitles go.

**Worst single blocks** (strip first; file:line of the text):

| Words | Where | Opens with |
|---:|---|---|
| 126 | `ui/panels/SyndicateDesk.tsx:35` | "Investors read every deal you raised…" |
| 98 | `ui/panels/EconomyPage.tsx:1422` | "Employment decides how much space…" |
| 73 | `ui/panels/MiscPages.tsx:266` (Settings) | "Bids on a sale you listed…" |
| 72 | `ui/panels/DebtPage.tsx:601` | "Past a handful of buildings an owner…" |
| 68 | `ui/panels/StreetDesk.tsx:84` | "These firms bid on the same tape…" |
| 68 | `ui/panels/HousePolicyDesk.tsx:99` (Leasing) | "No retainer and nothing while the space sits…" |
| 67 | `ui/panels/MarketPage.tsx:926` | "Every closing pays its fee…" |
| 60 | `ui/panels/EconomyPage.tsx:137` | "What a paycheque buys…" |
| 56 | `ui/panels/RankingsPage.tsx:60` | "Against 32 real US cities…" |
| 55 | `ui/panels/MarketPage.tsx:596` | "Nothing is on the courthouse steps…" |
| 54 | `ui/panels/MarketPage.tsx:315` | "Everything for sale in town…" |
| 53 | `ui/panels/SyndicateDesk.tsx:98` | "Each year the city draws…" |
| 51 | `ui/panels/PortfolioPage.tsx:1243` | "Every property dollar booked…" |
| 45 | `ui/developable.ts:37` (Property, card) | "A rebuild does not pencil here today…" |
| 43 | `ui/panels/BankProfile.tsx:84` | "Every lender in town, with nothing hidden…" |
| 42 | `ui/rollups/Rollover.tsx:91` (Leasing) | "A cluster — over a quarter of the rent…" |
| 42 | `ui/panels/BankProfile.tsx:319` | "Two tests no coverage ratio…" |
| 40 | `ui/panels/AcquireDesk.tsx:1112` (buy card) | "Agreeing a price puts you under contract…" |
| 35 | `ui/vitals/Waterfall.tsx:361` (Books) | "Two ledgers, one move…" |
| 24 | `ui/panels/PulsePage.tsx:46` | "Below replacement cost…" |

**Handholding to remove (R6):** `ui/PrimerOffer.tsx`; the docket's "Start here"
row (`ui/docket/build.ts:335`); "Where to start" on Marketplace
(`ui/panels/MarketPage.tsx:1103`); the advisor lines (`ui/advisor.ts`, used by
`DealsPage.tsx` and `modals.tsx`); `hint-fold` click-to-expand prose
(`ui/RightPanel.tsx:203-205`); YearReview, GoalCard, ExitCard,
DeliveryCeremony and MilestoneFlash as play-stopping moments (they become one
News row each).

**Decorative motion to remove (R7):** `@keyframes` in `index.css` (stamp,
start-sweep, page-arrive, panel-arrive, dock-arrive, rail-arrive, stage-fade,
advance-glow, play-breathe, tick-up, tick-down, at-risk-arrive, at-risk-pulse)
and `ui/hud.css` (card-arrive, card-nudge, tstat-turn and the redefinitions at
361–441), `ui/palette.css:30`.

How the build strips it: each place is rebuilt from the component set in §2.3,
so old prose is not carried over by default; any sentence that survives must be
moved to a "?" definition and pass R1. A lint (BUILD_SPEC §6) fails the build on
JSX text over 3 words outside the allow-list (Inbox fragments, toasts, "?"
definitions, news headlines).

---

## 2. Findings that led here (first pass, measured)

### 2.1 Structure today

21 page values, 16 rail entries, 6 desks, a docked card plus a 7-tab Property
page, a docket, a card queue, 4 engine card types, 4 moment cards, a palette and
lenses. Pages are long scrolls of 5–12 sections. In Unreal a page is a 1,120px
room over a dimmed, blurred backdrop that hides the city. Lenses, "Show on map"
and "Show my book" never reach Unreal; keys 1–3 move the Unreal camera and open
desks at once. Detail: INVENTORY.md.

### 2.2 Why it is slow (dev build, `?host=unreal`, 2012 save, 50 buildings, 72 rivals)

| Desk / action | Cost | Cause |
|---|---:|---|
| Buildings | 1,204 ms | appraises all 1,446 parcels on every mount (`ui/panels/MarketPage.tsx:20-76`) |
| Marketplace | 302 ms | `MarketPage` 126 ms + `SiteFinder` 108 ms, recomputed per visit |
| Players | 237 ms | `TheStreet` 108 ms |
| Leasing / Portfolio / Books | 218 / 209 / 175 ms | remount + recompute (`ui/RightPanel.tsx:222-241`) |
| +1 month (UI share) | 378–491 ms | `TopBar` vitals 283–312 ms: `streetStanding` twice, 63 + 81 ms (`ui/TopBar.tsx:143-234`) |
| +1 month / +1 year (wall) | 1.3–1.8 s / ~6 s | simulation worker (engine; the `engine-perf` session) |
| Unreal bridge push | 1.1 ms, 29 KB | not a cause |

Also: 102 components subscribe to the whole `game`; 43 `backdrop-filter` rules
and 180–220 ms arrival animations repaint a full-window transparent browser
texture at 60 fps inside Unreal (inferred, to be measured there).

---

## 3. Structure

### 3.1 Places

```
HUD (52px): date + clock | Cash | Debt | Net worth | CF/yr | Rank | 10Y | Island/Region | Search
Rail (64px): Inbox (I) · Holdings (1) · Pipeline (2) · Market (3) · Capital (4) · City (5) · Settings
Drawer (right): 540px for one thing, 1060px for tables and boards. Never wider.
3D: lens bar at the bottom; picking a building opens its file in the drawer.
```

| Place (key) | Tabs | Absorbs |
|---|---|---|
| **Inbox** (I) | Needs you · Later · Done | docket, card queue, deferred cards, at-risk banner, Deals "On the table" / "Tenants asking" / "Their answer", sale offers, alerts |
| **Holdings** (1) | Buildings · Leasing · Returns | Portfolio, Leasing, Returns, portfolio sale desk |
| **Pipeline** (2) | Buying · Building · Selling · *Land (region)* | Deals (LOIs, talks, sales), schemes in progress, developments, your listings |
| **Market** (3) | For sale · All buildings · Sites · Distressed · Books | Marketplace, Buildings, Notes, Site finder, street books, auctions |
| **Capital** (4) | Overview · Loans · Lenders · Investors · Books | Debt, Line, Banks, Investors, Books |
| **City** (5) | Markets · News · Players · Rankings · Record | Markets, Pulse, Tape, Players, Rankings, The Record |
| **Building file** | Overview · Rent roll · Money · Build · History | docked card + Property page |
| Rail foot | Saves · Settings | Primer → "?" reference only |

Keys: I, 1–5, Esc, Alt+← back, Ctrl K search, Space play/pause, `.` +1 month,
Y +1 year, B buy at ask (building file), F1–F3 Unreal camera presets.

### 3.2 Component set (13)

`HudBar`, `Rail`, `Drawer` (head · `Tabs` · body · `ActionFooter`), `StatStrip`,
`DataTable`, `Figure` (a number that drills, R3), `Breakdown` (the drill
popover), `KeyValue`, `StageBoard`, `InboxRow`, `Spark`/`Chart`, `Card`
(engine interruption), `Toast`. Props and data sources: BUILD_SPEC.md.

Unreal styling: solid surfaces, no `backdrop-filter`, no keyframes, no dim.

### 3.3 Region

`scope: "island" | "region"`; the HUD switch sets it. In region scope Unreal
shows the 3D metro scene; Market lists tracts, Holdings lists land, Pipeline
shows the **Land** lane (Bought › Entitled › Subdivided › Lots listed › Lots
sold), City › Players includes homebuilders; the building file becomes a tract
file (Overview · Entitlement · Plat · Sales · History). Same components.

---

## 4. Speed fixes (being built in `ui-speed-fixes`)

P1 cache Buildings rows per month · P2 rank once per month · P3 shared derived
cache keyed by `game` · P4 keep the last two desks mounted (`<Activity>`) ·
P5 no blur/animation in `host-unreal` · P6 `SectionNav` without layout reads ·
P7 clock progress in the HUD. Detail in the first-pass table above.

---

## 5. Migration (each step keeps the game playable)

The new shell lives behind a setting `uiShell: "classic" | "next"` (persisted
like `popupsOff`); classic stays the default until step 8.

| Step | What | Spec |
|---|---|---|
| 0 | Speed fixes P1–P7 | `ui-speed-fixes` session |
| 1 | `host-unreal` styling and the rule lint (R1, R7) | BUILD_SPEC §1 |
| 2 | Shell: `HudBar` (adds Debt), `Rail`, `Drawer`, keys; old pages hosted inside drawers | BUILD_SPEC §2 |
| 3 | Inbox | BUILD_SPEC §3 |
| 4 | Building file with `Figure`/`Breakdown` drills and the 3-click buy | BUILD_SPEC §4 |
| 5 | `DataTable` per place: Market, Holdings, Capital › Loans, City; prose stripped per §1 | later spec |
| 6 | Pipeline `StageBoard`; retire DealsPage | later spec |
| 7 | Bridge: `lens`, `highlight`, `flyTo`; camera presets on F1–F3 (C++ side) | later spec |
| 8 | `next` becomes the default; classic removed one release later | — |
| 9 | Region scope, Land lane, tract file, 3D metro scene | after REGION_PLAN settles |

`AGENTS.md` still says the web build is frozen for features; the main session
has put this UI work in scope.
