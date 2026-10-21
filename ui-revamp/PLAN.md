# UI revamp plan: simpler, more functional, fast

Status: **design only, for owner review.** Nothing under `broadway-and-wall/src`
or `unreal/` has been changed. Branch `claude/ui-revamp-plan`, cut from
`origin/main` 9a5acbc3 on 2026-10-21.

Owner's brief: *"Moving through the UI is super slow ... we will soon revamp the
entire UI to have a very functional yet simple design."* The game is played in
Unreal, where the same React UI is hosted over the 3D city (`?host=unreal`). A
metro **Region** mode (land tracts, entitlements, subdividing, selling lots to
homebuilders) comes next and must fit without another redesign.

**Mockups:** [`ui-revamp/mockups/index.html`](mockups/index.html), also published
as a private Artifact: https://claude.ai/artifact/J4NRf711skqRaWeS9xw8sf
(eight core screens drawn over Unreal city shots, with before/after clicks).
**Inventory of today's UI:** [`ui-revamp/INVENTORY.md`](INVENTORY.md).
**Profiling harness used for the numbers below:** [`ui-revamp/profile-harness.html`](profile-harness.html).

---

## 1. Findings

### 1.1 What exists today (summary; detail in INVENTORY.md)

- **21 page values, 16 rail entries, 6 desks with 2–5 tabs each**, plus a docked
  building card, the Property page (7 tabs), a docket, a card queue, four engine
  card types, four "moment" cards, a palette, lenses and a HUD column.
- Most pages are long scrolls of 5–12 sections; a section-chip rail is built by
  scanning the DOM.
- In Unreal mode a page is a 1,120px parchment room over a dimmed, blurred
  backdrop: the 3D city the owner is playing in is mostly hidden whenever any
  page is open (see `mockups/before-portfolio-unreal-mode.jpg`).
- Lenses, "Show on map" and "Show my book" are never sent to Unreal, so they do
  nothing there. Keys 1–3 move the Unreal camera **and** open desks 1–3.

Clicks for the common jobs today: buy a listed building **6–7**; total debt **1**
(no top-bar readout); start a development on your lot **4–6**; advance time
**1**; read the news **1–2**; answer a tenant letter **3**.

### 1.2 Why it feels slow (measured)

**How:** `pnpm vite` dev build of origin/main in its own worktree, opened with
`?host=unreal`, 1600×900. A throwaway page (`profile-harness.html`) installs a
React DevTools hook before React loads and records, for every commit, which
components rendered and their self time (`selfBaseDuration`); a
`PerformanceObserver('longtask')` records main-thread blocks. Each desk was
opened from the rail with nothing else running. Two game states:

- **A:** Jan 2000, new firm, no buildings.
- **B:** May 2012, a 50-building firm (bought from listings in the test save),
  72 rival firms, 1,446 parcels.

Dev builds run React slower than production (roughly 1.5–3×), so read the
numbers as relative. The browser pane was in the background, so frame timing
(rAF) was unusable; the figures are commit times and long-task CPU, which are
not throttled.

**Desk open cost, state B** (time from click to the page's commit / main thread
blocked; top components by self time):

| Desk | commit | blocked | biggest costs |
|---|---:|---:|---|
| Buildings | **1,204 ms** | 1,204 ms | `BuildingDatabase` 1,168 ms |
| Marketplace | 302 ms | 279 ms | `MarketPage` 126 ms, `SiteFinder` 108 ms |
| Players | 237 ms | 237 ms | `TheStreet` 108 ms, `HeadlinerStrip` 30 ms, `RaceChart` 21 ms |
| Leasing | 218 ms | 173 ms | `LeasingPage` 53 ms, `OpsChoices` ×41 33 ms |
| Portfolio | 209 ms | 177 ms | `PortfolioPage` 83 ms, `ReturnsToDate` 21 ms |
| Books | 175 ms | 175 ms | `Waterfall` 77 ms, `BalanceSheet` 28 ms |
| Markets | 111 ms | 111 ms | `LineChart` ×30 29 ms, `EconomyPage` 18 ms |
| Banks | 106 ms | 105 ms | `BankFile` 33 ms |
| The Record | 77 ms | 65 ms | `TimelineRow` ×61 8 ms |
| Tape | 58 ms | 59 ms | `FrontPage` 18 ms |
| Debt, Investors, Rankings, Settings, Pulse | 25–48 ms | 0 | — |
| Click a building (card) | 13–39 ms | 0 | `Neighbourhood` 26 ms |
| Open Property page | 55 ms | 55 ms | `PropertyPage` 15 ms |

In state A the same desks were 15–40 ms except Buildings (493 ms), Marketplace
(162 ms) and Players (86 ms). **Cost grows with the size of the book and the
age of the city**, which matches the owner playing long games.

**Advancing time, state B:**

| Action | wall time to the new month on screen | UI main-thread work |
|---|---:|---:|
| +1 month, map view | 1.75 s | 378 ms blocked; `TopBar` 283 ms, `MapHud` 22 ms |
| +1 month, Portfolio open | 1.33 s | 491 ms blocked; `TopBar` 312 ms, `PortfolioPage` 56 ms |
| +1 year | 5.8–6.3 s | 300–380 ms; `TopBar` 195–247 ms, `Docket` 47–116 ms |

The rest of the wall time is the simulation in its worker (`state/townWorker.ts`,
`spanOffThread`), which is engine work, not UI.

**Unreal bridge:** every game change pushes a `view` message. Measured with a
stub bridge: 1.1 ms and 29 KB per change (the city message is ~1 MB, once).
**Not a cause.**

### 1.3 Top causes, with evidence

1. **The Buildings table re-appraises every deed in town on every visit.**
   `BuildingDatabase` (`ui/panels/MarketPage.tsx:20-76`) runs `marketAppraisal`
   and `inPlace` for all ~1,446 parcels inside a `useMemo` that lives in the
   component. Pages unmount on every switch (`ui/RightPanel.tsx:222-241`), so
   the memo is thrown away and the work repeats every visit, and again every
   month while open (it depends on `game`). 1.2 s at state B, 0.5 s at state A.
   It pages its output to 50 rows but computes all of them.
2. **The top bar redoes ~300 ms of portfolio math every month.** The `vitals`
   memo (`ui/TopBar.tsx:143-234`) runs on every `game` change. Timed cold, one
   call each at state B: `streetStanding` on the new state **63 ms** and again
   on the previous state **81 ms** (`engine/standing.ts:40`, ranks all 72 rival
   books just to print "1st / 62" and "▲3"), `netWorth` 11 ms, plus the rest.
   It is wrapped in `useDeferredValue`, so it does not block the click, but it
   is 200–310 ms of main-thread time on every advance and lands right when the
   player wants to act.
3. **Every desk is rebuilt from scratch on every switch.** No page stays mounted
   and derived data is memoised inside components, so each visit recomputes
   (Marketplace 279 ms, Players 237 ms, Portfolio 177 ms, Leasing 173 ms, Books
   175 ms at state B). Switching back and forth between two desks pays the full
   cost each time.
4. **102 components subscribe to the whole `game` object and 81 to `parcels`**
   (`grep "useStore((s) => s.game)"`). Every month, every one of them that is
   mounted re-renders and re-derives. `Docket` alone is 47–116 ms per year
   advance.
5. **In Unreal, the page is drawn as a full-window transparent browser texture
   at 60 fps** (`unreal/.../BWGame.cpp:856-866`, `SupportsTransparency(true)`,
   `BrowserFrameRate(60)`). The CSS still carries 43 `backdrop-filter` blur
   rules (e.g. `index.css:85`, `211`, `599` on `.page-backdrop`) and 180–220 ms
   arrival animations on every page and dock (`index.css:604`, `1746`;
   `ui/hud.css:361-440`). In the embedded browser the page cannot see the 3D
   scene behind it, so the blur has nothing to blur and only costs raster time,
   and each animation frame is a full-window repaint copied into Unreal.
   **This one is inferred, not measured inside Unreal.** Confirm with
   `stat slate` / `stat unit` and the CEF paint rate before and after turning
   them off in `html.host-unreal`.
6. **Small but constant:** `SectionNav` (`ui/RightPanel.tsx:363-395`) watches the
   whole page subtree with a MutationObserver and reads layout
   (`offsetParent`, `getBoundingClientRect`) on every mutated frame.
7. **Click depth.** Even at 0 ms, buying a building is 6–7 clicks across two
   surfaces, and the Offer button on a card is a scroll away. A third of the
   "slow" feeling is distance, not milliseconds.
8. **Out of the UI lane (flag for the engine):** a month takes 1.3–1.8 s and a
   year about 6 s in the sim worker at state B. The UI can show progress and
   stay responsive, but only engine work makes the clock itself faster.

---

## 2. Proposed structure

### 2.1 Principles

- **The city is the canvas.** Nothing covers more than two thirds of the window.
  No dimming, no blur. Panels are solid.
- **Five places, one Inbox.** Each place has at most five tabs. Each tab is one
  screen: a summary strip on top, one table or board below.
- **The verb is on screen.** Every drawer has a footer with its actions that
  never scrolls away.
- **Decide where you are told.** Anything that wants a decision can be answered
  from the Inbox row that reports it.
- **One scope value** (`island | region`) that every place reads, so the region
  mode adds data, not screens.
- **Keep `UI_PRINCIPLES.md`.** This plan applies its ten rules more strictly:
  one interruption at a time, Esc closes everything, never offer what cannot
  be done.

### 2.2 Navigation

```
HUD (52px, one row): date + clock | Cash | Debt | Net worth | CF/yr | Rank | 10Y | Island/Region | Search (Ctrl K)
Rail (64px icons): Inbox (I) · Holdings (1) · Pipeline (2) · Market (3) · Capital (4) · City (5) · … Settings
Drawer (right): standard 540px for one thing, wide 1060px for tables and boards
3D: lenses bar at the bottom; picking a building opens its file in the drawer
```

| Place (key) | Tabs | Absorbs |
|---|---|---|
| **Inbox** (I) | Needs you · Later · Done | Docket, card queue, deferred decision cards, at-risk banner, Deals "On the table" and "Tenants asking", alerts |
| **Holdings** (1) | Buildings · Leasing · Returns | Portfolio, Leasing, Returns, portfolio sale desk |
| **Pipeline** (2) | Buying · Building · Selling · *Land (region)* | Deals (LOIs, talks, sales), schemes in progress, developments by stage, your listings |
| **Market** (3) | For sale · All buildings · Sites · Distressed · Books | Marketplace, Buildings, Notes, Site finder, street books, auctions |
| **Capital** (4) | Overview · Loans · Lenders · Investors · Books | Debt, Line of credit, Banks, Investors, Books |
| **City** (5) | Markets & news · Players · Rankings · Your record | Markets, Pulse, Tape, Players, Rankings, The Record |
| **Building file** (pick in 3D) | Overview · Rent roll · Money · Build · History | Docked card + Property page, one drawer |
| Rail foot | Saves · Settings · Primer | unchanged; M and P stay |

Every section of every current page has a home in this table or in INVENTORY.md
§5 (sections move into the tab named after their page). Nothing is removed.

**Keys:** I, 1–5, Esc, Alt+← back, Ctrl K search, Space play/pause, `.` +1
month, Y +1 year, B buy at ask (in a building file). Unreal camera presets move
off 1–3 (to F1–F3, proposed) so they stop colliding with desk keys.

### 2.3 Layout and component set

One shell, 13 components. New pages are built only from these:

| Component | Job |
|---|---|
| `HudBar` | one-row vitals with deltas, clock, scope switch, search |
| `Rail` | five places + Inbox, badges, keys |
| `Drawer` | header (crumbs, title, status chips, close), `Tabs`, body, `ActionFooter`; two widths |
| `Tabs` | at most five, badge counts, remembers the last tab per place |
| `StatStrip` | 3–6 figures with a one-line note each |
| `DataTable` | virtualised, sortable, filter chips, row chips, row actions, "Show on city" |
| `KeyValue` | label/value lists |
| `StageBoard` | lanes of cards by stage (Pipeline; the Land lane later) |
| `InboxItem` | severity stripe, one-line fact, inline verbs |
| `ActionFooter` | sticky verbs plus an optional 2–3 step `Stepper` |
| `Chart` | spark, line, bar (reuse `ui/Chart.tsx`) |
| `Card` | engine interruption, one at a time (existing queue rules) |
| `Toast` | outcome of an action, where the player is looking |

Styling for Unreal: solid surfaces, no `backdrop-filter`, no arrival
animations, a single 120 ms opacity fade at most.

### 2.4 The core screens (see mockups)

1. **City + Inbox** — default view; Inbox items answered inline.
2. **Building file** — one drawer for any building; price and financing preset
   on one screen; Buy in three clicks.
3. **Holdings** — strip + virtual table; row chips for problems.
4. **Pipeline** — stage board for buying, building, selling (+ Land lane).
5. **Market** — tabbed search tables, "Show on city".
6. **Capital** — cash, debt, line, maturity wall, next loans to act on.
7. **City intel** — sparklines by sector + the Tape side by side.
8. **Region (later)** — scope switch, region map, Land lane.

Target clicks: buy a listed building **3** (with a saved financing preset; 4–5
with a custom stack); total debt **0**; start a development **3** with the
suggested scheme; advance **1**; news **1**; answer a tenant letter **1**.

### 2.5 How the Region fits

- `scope: "island" | "region"` in the store; the HUD switch sets it.
- In region scope the backdrop is the metro view, Market lists tracts, Holdings
  lists land, Pipeline shows the **Land** lane (Bought → Entitlement →
  Subdivided → Lots listed → Lots sold), City › Players includes homebuilders.
- All of that is the same `DataTable`, `StageBoard` and Building-file drawer
  ("Tract file" with tabs Overview · Entitlement · Plat · Sales · History).
- **Open question for the owner:** is the region view a 3D metro scene in
  Unreal, or a 2D map the page draws? The layout works for both; 2D is sooner.

---

## 3. Performance fixes that can ship first, on their own

Each is independent of the redesign, keeps the current UI, and is small.

| # | Fix | Where | Expected |
|---|---|---|---|
| P1 | Cache the Buildings rows per game state outside the component (a `WeakMap` keyed by the `game` object, or by month + holdings version); render only the visible page of rows | `ui/panels/MarketPage.tsx:20-76` | Buildings 1.2 s → under 50 ms on revisits; first open per month still pays once (move it to the worker later) |
| P2 | Compute the street ranking once per month: cache `streetStanding` by `game` object and keep last month's rank instead of re-ranking the previous state | `ui/TopBar.tsx:143-234`, `engine/standing.ts:40` | ~145 ms less main-thread work per advance |
| P3 | A shared derived-data layer: `derive(game, key, fn)` memoised by `game` reference, used by pages instead of in-component `useMemo` | PortfolioPage, LeasingPage, MarketPage/SiteFinder, StreetDesk `TheStreet`, BooksPage `Waterfall`, Docket | desk revisits in the same month drop to render-only (tens of ms) |
| P4 | Keep the last two desks mounted with React 19.2 `<Activity mode="hidden">` instead of unmounting | `ui/RightPanel.tsx:222-241` | back-and-forth switching becomes near-instant |
| P5 | In `html.host-unreal`: `backdrop-filter: none`, `animation: none` on page, dock, rail and cards; no page-backdrop dim | `index.css`, `ui/hud.css` | fewer full-window repaints in the embedded browser; **measure in Unreal before/after** |
| P6 | `SectionNav`: observe only the page's direct section list (or build chips from data), drop per-mutation layout reads | `ui/RightPanel.tsx:363-395` | removes layout thrash while a page updates |
| P7 | Show month progress in the HUD while the worker runs (the click already returns at once) | `ui/TopBar.tsx` | the 1.3–1.8 s month reads as "working", not "stuck" |

P1, P2 and P5 are the first three to do: biggest effect, smallest change.
Verification for each: re-run `profile-harness.html` (copy it into
`broadway-and-wall/`, open `/profile.html?host=unreal`, run the same desk
sweep), and `pnpm check` stays green. P5 needs an Unreal session.

---

## 4. Migration plan (each step keeps the game playable)

The new shell is built behind a setting (`uiShell: "classic" | "next"`, stored
like `popupsOff`), so classic stays the default until the owner switches.

| Step | What | Playable because |
|---|---|---|
| 0 | Ship P1–P7 | no visible change except speed |
| 1 | `html.host-unreal` styling: solid panels, no dim/blur, desks dock right at ≤ 2/3 width | same pages, same navigation |
| 2 | New shell behind `uiShell=next`: `HudBar` (adds Debt), `Rail` with five places, `Drawer`. Each place/tab renders today's page component inside the drawer | every old page reachable through the map in §2.2; classic shell untouched |
| 3 | Inbox: one derived list from docket, card queue, at-risk, Deals "On the table"/"Tenants asking"; inline verbs call the existing store actions | old Deals tabs still exist inside Pipeline until step 6 |
| 4 | Building file: merge `ParcelPanel` and `PropertyPage` into one drawer with `ActionFooter`; financing presets in Settings › Buying defaults; Buy at ask in 3 clicks | the full stack desk stays behind "Custom…" |
| 5 | Replace bespoke tables with `DataTable`, one place at a time: Market (incl. Buildings), Holdings, Capital › Loans, City | each place switches in one PR; others keep the old component |
| 6 | Pipeline `StageBoard` over LOIs, approaches, developments, listings; retire DealsPage | every deal still reachable from Pipeline and the Building file |
| 7 | Bridge additions so the 3D city answers the UI: `lens`, `highlight` (list of bbls), `flyTo`; camera presets off 1–3 | Unreal ignores unknown messages until the C++ side lands |
| 8 | Make `next` the default; remove the classic shell after one release with no regressions | settings switch available for one release |
| 9 | Region: `scope` value, Land lane, tract rows, region backdrop | island play unaffected |

Note: `AGENTS.md` says the web build is frozen for features. This plan only
touches the UI shell that Unreal hosts; step 0 and step 1 are fixes. The main
session should confirm that UI work under `broadway-and-wall/src/ui` is in
scope again before step 2.

---

## 5. Decisions needed from the owner

1. Approve the five places + Inbox (and their names).
2. Drawer beside the city (proposed) versus full-screen pages.
3. Region view: 3D metro scene in Unreal, or a 2D map drawn by the page.
4. Unreal camera presets moving from 1–3 to F1–F3.
5. Ship the speed fixes (P1, P2, P5) before the redesign: recommended yes.
