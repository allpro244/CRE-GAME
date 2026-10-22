# Build spec: migration steps 1–4

For the implementation session that starts after `ui-speed-fixes` (P1–P7)
merges. Read `PLAN.md` §0 (design rules) first: every screen here must pass
them. Paths are relative to `broadway-and-wall/src/`; line numbers are from
origin/main 9a5acbc3 and will drift.

**Ground rules for the build**
- All new UI lives in `ui/next/`. The classic UI keeps working, unchanged,
  until step 8 of PLAN §5.
- No engine changes are needed for steps 1–4. Where a UI helper is not
  exported today (Waterfall's `buildModel`, DevelopDesk's best-scheme loop),
  export or lift it in `ui/`, not in `engine/`.
- No new numbers. Every figure and every drill row calls an existing engine
  function (CLAUDE.md "no fake numbers"; PLAN R8). If a drill wants a figure the
  engine does not compute, the row is dropped, not estimated.
- Use the derived-data cache from P3 (`derive(game, key, fn)`) for anything that
  walks the book or the city.
- `pnpm check` stays green at every commit. Test in `?host=unreal`.

---

## 1. Step 1: Unreal styling and the rule lint

**1a. Styling** (`ui/next/next.css`, imported by `ui/next/Shell.tsx` and, for
classic, scoped under `html.host-unreal`):
- P5 (being built now) removes `backdrop-filter` and keyframe animations in
  `host-unreal`. Step 1 adds, also scoped to `html.host-unreal`:
  - `.page-backdrop { background: transparent; }` (no dim; the city stays lit)
  - `.page` docks right: `position: fixed; right: 0; top: var(--topbar-h); bottom: 0; width: min(1060px, 66vw); margin: 0; border-radius: 0;`
  - backdrop click-through: `.page-backdrop { pointer-events: none } .page { pointer-events: auto }`, so the 3D city can still be clicked to the left of the page.
- Tokens: keep the game's paper/ink/gold/teal (`index.css:5-44`). Add
  `--hud-h: 52px; --rail-w: 64px; --drawer-std: 540px; --drawer-wide: 1060px; --row-h: 30px;`

**1b. The word lint** (`tools/ui-words.mjs`, added to `pnpm check`):
- Parse every `ui/next/**/*.tsx` with the TypeScript compiler API (already a dev
  dependency).
- Fail on any JSX text node with more than 3 words, and any string literal
  passed to the props `label`, `title`, `heading`, `chip` with more than 3
  words.
- Allow-listed: the `q` prop of `Definition` (≤ 40 words, R1), `Toast` and
  `InboxRow` fact builders (checked at runtime instead, below), and news
  headlines (data, not copy).
- Runtime guard (dev builds only): `assertWords(s, max)` in `ui/next/words.ts`
  logs `console.error` when an Inbox fact or toast exceeds 8 words.

Done when: classic UI in Unreal shows the city to the left of any open page and
the lint runs in `pnpm check` (it has nothing to scan until step 2).

---

## 2. Step 2: the shell (HUD, rail, drawer, keys)

### 2.1 Store additions (`state/store.ts`)

| Field / action | Type | Notes |
|---|---|---|
| `uiShell` | `"classic" \| "next"` | init `localStorage.getItem("bw:ui-shell") === "next" ? "next" : "classic"` with try/catch, as `hoverCard` does (`store.ts:874`) |
| `setUiShell(v)` | `(v) => void` | writes `bw:ui-shell`, then `set`; copy `setPopupsOff` (`store.ts:1244`) |
| `placeTab` | `Partial<Record<PlaceId, string>>` | last tab per place (session only), like `rememberTab` (`ui/desks.ts:148`) |
| `setPlaceTab(place, tab)` | | |

Everything else reuses `page`, `selectedBBL`, `propertyTab`, `navBack`,
`setPage` (`:988`), `openProperty` (`:1001`), `goBack` (`:1017`), `select`
(`:916`), `focus` (`:945`), `openAttention` (`:954`).

Settings page gets one switch: "Interface: Classic / New".

### 2.2 `ui/next/places.ts`

```ts
export type PlaceId = "inbox" | "holdings" | "pipeline" | "market" | "capital" | "city";
export interface PlaceTab { id: string; label: string; page: Page; jump?: string; view?: string; width: "std" | "wide" }
export interface Place { id: PlaceId; label: string; key: string; icon: string; tabs: PlaceTab[] }
export const PLACES: Place[];
export function placeOf(page: Page): { place: PlaceId; tab: string } | null;
```

Tab → existing page (what renders inside the drawer in step 2; later steps
replace each with new components):

| Place | Tab | `page` (+ `jump` / deskView) | Width |
|---|---|---|---|
| inbox | needs / later / done | step 2: `Docket` component; step 3: `InboxList` | std |
| holdings | buildings | `portfolio` | wide |
| holdings | leasing | `leasing` | wide |
| holdings | returns | `portfolio`, jump "Returns to date" | wide |
| pipeline | all | `deals` | wide |
| market | forsale | `market` | wide |
| market | all | `buildings` | wide |
| market | sites | `market`, jump "Land" | wide |
| market | distressed | `notes` (when present) else `market` jump "Distressed" | wide |
| market | books | `market`, jump "Books for sale" | wide |
| capital | overview | `debt` | wide |
| capital | loans | `debt`, jump "Loan by loan" | wide |
| capital | lenders | `banks` | wide |
| capital | investors | `investors` | wide |
| capital | books | `books` | wide |
| city | markets | `economy` (Pulse folded in at step 5) | wide |
| city | news | `news` | wide |
| city | players | `players` | wide |
| city | rankings | `rankings` | wide |
| city | record | `firm` | wide |

`saves`, `settings` open from the rail foot (std width). `primer` is reached
only from "?" definitions (R6).

### 2.3 Components

**`ui/next/Shell.tsx`** — mounted by `App.tsx` instead of `TopBar` +
`GamePanels` + `MapRail` + `MapControls` when `uiShell === "next"`. Keeps
`MapView`/`UnrealSurface`, `Palette`, the engine cards and toasts.

```tsx
<HudBar/> <Rail/> {drawer} <LensBar/> <CardLayer/> <Toasts/>
```
`drawer` is `<BuildingFile/>` when `page === "property"` or (`page === "none"`
and `selectedBBL`), else `<PlaceDrawer/>` when `placeOf(page)`, else nothing.
Moments (YearReview, GoalCard, ExitCard, DeliveryCeremony, MilestoneFlash) are
not mounted in `next` (R6); their events already reach the news feed.

**`HudBar`** — no props. One 52px row.

| Readout | Source | Drill |
|---|---|---|
| Date + clock | `game.month`; Play `setAutoplay(autoplay ? 0 : 1)` (`:222`), +1 mo `advance()` (`:219`), +1 yr `advanceYear()` (`:229`); P7 progress bar | — |
| Cash | `game.cash` | `cash` |
| Debt | `debtBook(game).total` (2.5) | `debt` |
| Net worth | `netWorth(g, parcels)` via derive (`engine/value.ts:4331`) | `nw` |
| CF / yr | `(portfolioMonthlyCF − firmOverheadMonthly) × 12` (`engine/sim.ts:2623`, `:2607`) | `cf` |
| Rank | cached `streetStanding` from P2 (`engine/standing.ts:40`) | `rank` |
| Occ | `portfolioOccupancy(g, p).occ` (`engine/leasing.ts:396`) | `occ` |
| 10Y | `econ.indexRate`, 12-month delta from `econ.history` (as `TopBar.tsx:200-205`) | `rate` |
| Scope | Island only until step 9 (rendered disabled) | — |
| Search | opens `Palette` | — |

Deltas are the same ones TopBar computes today (move them into a derive key,
do not recompute twice). Readouts shed right-to-left below 1360px: 10Y, Occ,
Rank. Cash, Debt, NW, CF never go.

**`Rail`** — no props. Inbox, the five places, Saves, Settings. Badge counts:
Inbox = `buildInbox(...).filter(i => i.sev !== "info").length`; others from
`tabCounts(g)` (`ui/desks.ts:172`). Click = `openPlace(place)`: lands on
`placeTab[place]` or the first tab; clicking the open place closes the drawer.

**`Drawer`**
```ts
interface DrawerProps {
  width: "std" | "wide";
  crumbs?: string[];            // ≤ 3 words each
  title: string;                // address or place name
  meta?: string;                // one mono line of facts, no sentence
  chips?: { label: string; tone?: "gold" | "teal" | "red" }[];
  tabs?: { id: string; label: string; count?: number }[];
  tab?: string; onTab?: (id: string) => void;
  footer?: React.ReactNode;     // ActionFooter
  onClose: () => void;
  children: React.ReactNode;
}
```
Header, tabs, scrolling body, sticky footer. No page subtitle. The body of a
hosted classic page renders without `SectionNav` and without `.page-head`.

**`PlaceDrawer`** — resolves `placeOf(page)` and renders `Drawer` with that
place's tabs and the hosted page component (`RightPanel.tsx:222-241` list).
Uses `<Activity>` from P4 to keep the last two tabs mounted.

**`ActionFooter`**
```ts
interface ActionFooterProps {
  steps?: string[]; step?: number;      // optional stepper ("Price", "Confirm")
  verbs: Verb[];                         // right-aligned, primary last
  input?: React.ReactNode;              // e.g. offer amount
}
interface Verb { label: string; run: () => void; primary?: boolean; key?: string; disabled?: string /* reason ≤ 8 words */ }
```

**`LensBar`** — the lenses from `ui/MapControls.tsx:13` as one bottom bar. In
Unreal they do nothing until step 7 adds the `lens` bridge message; render them
but mark `disabled: "Not in 3D yet"` when `UNREAL_HOST`.

### 2.4 Keys (`ui/next/keys.ts`, replaces the classic handler when `next`)

Copy the guards from `RightPanel.tsx:51-135` (ignore in inputs; modal blocks
play and advance; Esc order: card `data-esc` → drawer → selection).

| Key | Action |
|---|---|
| I | open/close Inbox |
| 1–5 | open/close Holdings, Pipeline, Market, Capital, City |
| Esc | as above |
| Alt+← | `goBack()` |
| Ctrl/⌘ K | Palette |
| Space, G | play/pause |
| `.` | `advance()` |
| Y | `advanceYear()` |
| N | `advanceUntil()` |
| B | in a building file for sale: Pay ask |
| M, P | map-only, photo (unchanged) |

**Camera presets:** change `CAMERA` in `state/unrealHost.ts:142` from
`Digit1-3` to `F1-F3`, and the matching key names on the C++ side
(`unreal/BroadwayWall/Source/BroadwayWall/`, where `kd`/`ku` are handled). That
is a small C++ change; coordinate with whoever owns `unreal/`.

### 2.5 Shared helpers (`ui/next/derive.ts`)

- `debtBook(g)`: rows `{bbl, lender, balance, rate, maturesM, kind: "mortgage" | "mezz" | "facility" | "line"}` and `total`. Same sum as `tabCounts(g).debtBal` (`ui/desks.ts:192-206`); change `tabCounts` to call it so the two cannot disagree (R8).
- `fmt`: reuse `ui/format.ts` (`usd`, `pct`).

Done when: with `uiShell = "next"` every classic page is reachable through the
rail/tab map above, keys work, the HUD shows Debt, and the classic shell is
unchanged.

---

## 3. Step 3: Inbox

### 3.1 Data (`ui/next/inbox.ts`)

```ts
interface InboxItem {
  key: string;                    // attention key, e.g. "loi:42"
  sev: "critical" | "decide" | "info";
  subject: string;                // ≤ 4 words: address, tenant or firm
  facts: string;                  // ≤ 8 words, numbers first ("Oct · $11.2M · 6.1%")
  verbs: Verb[];                  // ≤ 3, primary first
  bbl?: string;
  dueM?: number;
}
export function buildInbox(g: GameState, parcels: ParcelTable, snooze: Record<string, number>, seen: string[]): InboxItem[];
```

Source: `attentionItems(g, parcels)` (`engine/sim.ts:1705`), which already
covers every decision the docket, the at-risk banner, `nextDue` and the
decision cards read. Severity: `critical` from the item; `decide` where a verb
below exists; otherwise `info`. Do **not** carry over the docket's coaching
rows (`ui/docket/build.ts`: "Start here" `:335`, idle cash, buy-box
suggestion, milestone nudges) (R6). Keep its folding of sweeps and
self-renewing balloons (`build.ts:166-184`).

Sort: critical, then by `dueM`, then decide, then info.

### 3.2 Verbs per attention key (all existing store actions)

| Key head (`sim.ts` line) | Verbs |
|---|---|
| `loi:{id}` (1734) | Sign `respondLoi(id,"accept")` · Counter → open building file Rent roll with `setLoiFocus(id)` · Decline `respondLoi(id,"decline")` |
| `tenant-ask:{id}` (1749) | Grant `answerAsk(id,"grant")` · Decline `answerAsk(id,"decline")` |
| `offer:{bbl}:{price}` (1867) | Take → inline confirm, then `acceptOffer(bbl)` · Counter (amount) `counterSale(bbl, price)` · Decline `declineOffer(bbl)` |
| `sale-bids` (1874) | Take best `takeBid(bbl, 0)` · Best & final `runBestAndFinal(bbl)` · Open |
| `portfolio-bid` (1811) | Take `acceptPortfolio()` · Counter (amount) `counterPortfolioBid(price)` |
| `balloon:{bbl}:…` (1960-73) | Refinance → building file Money tab (refi quotes from `refiQuotes`, `engine/debt.ts:2289`; commit `refi(bbl, product, lev)`) · Later |
| `arrears`, `workout:{bbl}:{stage}` (1991, 2151) | Cure `cureDefault(bbl)` · Forbear `askForbearance(bbl)` · Hand back `handBackKeys(bbl)` (inline confirm) |
| `private-ask` (2191) | Fund `fundPrivateAsk(id)` · Decline `declinePrivateAsk(id)` |
| `note` (2186) | Buy `takeNote(id)` · Open |
| `npl` (2239) | Restructure `restructureNote(id)` · File `fileNote(id)` · Sell `offloadNote(id)` |
| `private-borrow` (2198) | Accept `acceptPrivateBorrowQuote(id)` · Decline `declinePrivateBorrowQuote(id)` |
| `street-book` (2210) | Buy `buyStreetBook(id)` · Offer (amount) `offerStreetBook(id, price)` |
| `broker` (1836, inbound calls) | Counter (amount) `counterOff(bbl, px)` · Hang up `hangUpCall(bbl)` |
| `auction` (2231) | Bid → `setAuctionOpen(true)` (AuctionModal stays as is) |
| everything else | Open → `openAttention(key)` (`store.ts:954`) |

Verify each id/argument against the item's payload while building; the table
gives the action, the payload parsing is in the matching `sim.ts` block.

**Later** = `snoozeDocket(key, game.month + 3)` (`store.ts:941`); for `loi:` also
`markCardSeen("loi:" + id)` as DecisionModal does (`modals.tsx:969`), so the
deadline does not stop the clock again. Critical items cannot be snoozed.
**Done** tab: a session list `inboxDone: {key, subject, facts, m}[]` in the
store, appended by each verb.

### 3.3 Components

- `InboxList({ tab: "needs" | "later" | "done" })`: virtual list of `InboxRow`.
- `InboxRow({ item })`: severity stripe · subject (bold) · facts (mono) · verbs
  on the right. Click on the row body = `openAttention(item.key)`.
- Engine cards still stop the clock (`ui/panels/modals.tsx`); in `next` their
  "Decide later" leaves the item in the Inbox, which it already is. No card
  queue pill; the Inbox badge replaces it.
- Replaces in `next`: `Docket`, `AtRiskBanner`, `CardQueue`, `nextDue` readout.

Done when: every item the docket and the decision cards show today appears in
the Inbox with a verb that resolves it, and answering a tenant letter is one
click from an open Inbox.

---

## 4. Step 4: Building file, drills, 3-click buy

### 4.1 `ui/next/BuildingFile.tsx`

Opens when `selectedBBL` is set (map pick, Unreal `bwUnreal.select`, table row,
Inbox). Drawer `std`. Tabs map to `PropTab` (`ui/panels/shared.tsx:149`):

| Tab | `PropTab` | Body |
|---|---|---|
| Overview | `summary` | **new** (below) |
| Rent roll | `leasing` (+ `ops` leasing policy) | hosted `<ParcelPanel embedded tab="leasing"/>` (`ParcelDesk.tsx:1423`) in step 4; `DataTable` in step 5 |
| Money | `money` | hosted `ParcelPanel` money tab (loans, `RefiSection`) |
| Build | `build` | hosted `ParcelPanel` build tab, with the best scheme preselected (4.4) |
| History | `history` | hosted PropertyPage history block |

Buying and selling are not tabs: they are the footer (4.3). `ops` settings
(stance, auto-lease, broker, renovate) sit under Rent roll and Money.

**Overview** (all figures are `Figure`s):
- `StatStrip`: owned → Value · NOI · Occ · Debt · DSCR · CF/mo; for sale →
  Ask · Going-in · NOI · Value (vs ask).
- Two `KeyValue` boxes: Rent (in place, market, leased, roll 2y, WALT, each
  with a 24-month spark where `econ.history` / the holding has a series) and
  Asset (condition, cost to fair, demand, land value, listed months).
- `meta` line: class · floors · sf · year · condition · owner.
- Sources: `inPlace(rec, s, bbl, price)` (`engine/value.ts:3156`),
  `marketAppraisal(game, rec, bbl, cond)` (`:2996`),
  `operatingStatement(rec, econ, h, month)` (`:3288`), `marketRentPsfYr`,
  `landRead(rec, econ)` (`:1297`). Nothing in the classic card's prose
  (`ui/developable.ts:37`, `AcquireDesk.tsx:1112`) is carried over.

### 4.2 `Figure` and `Breakdown` (the drill, R3)

```ts
interface FigureProps { value: number | null; fmt: "usd" | "pct" | "psf" | "x" | "sf" | "n"; drill?: DrillKey; args?: Record<string, unknown>; tone?: "pos" | "neg" }
type DrillKey = "cash" | "debt" | "nw" | "cf" | "rank" | "occ" | "rate" | "noi" | "cap" | "value" | "land" | "rent" | "dscr";
interface DrillResult { title: string; total: string; rows: { label: string; value: string; tone?: "pos" | "neg" }[]; formula?: string; link?: { label: string; go: () => void } }
export const DRILLS: Record<DrillKey, (g: GameState, p: ParcelTable, args: any) => DrillResult>;
```
`Figure` renders the formatted number with a dotted underline; click opens
`Breakdown` anchored to it; Esc or outside click closes. One open at a time.

| Drill | Rows from |
|---|---|
| `noi` (owned) | `operatingStatement`: baseRent, −freeRent, recoveredOpex, recoveredTax, −opex, −mgmt, −reserve, −tax, −groundRent = noi; link → Rent roll tab |
| `noi` (for sale) | `inPlace(...).noi` and the disclosed roll (`DisclosedRoll`, `AcquireDesk.tsx:140`); formula "NOI ÷ ask = going-in" |
| `cap` | NOI ÷ price; market cap `capRateFor(rec, econ, cond)` (`value.ts:2823`) |
| `value` | NOI, cap, `incomeValueAsIs` (`:3421`), `appraise(bbl, value)` lo/mid/hi (`:2872`), `replacementCost`; total = `marketAppraisal` / `ownedHoldingValue` (`:3959`) |
| `land` | `landRead(rec, econ)`: `scheme` {use, floors, coverage, valuePsf, costPsf}, residual, builder vs holder, winner |
| `cf` | Waterfall `buildModel(game, prev, parcels).cashRows` (`ui/vitals/Waterfall.tsx:73`, export it) |
| `nw` | `buildBalanceSheet(s, parcels)` (`engine/books.ts:64`): assets by class, cash, notes, CIP − mortgages, mezz, line, facility, partners = equity |
| `debt` | `debtBook(g)` rows (2.5) |
| `rank` | `streetStanding` (cached): rank, of, leader, above, median rival |
| `occ` | `portfolioOccupancy` + per-holding leased/lettable |
| `rent` | `h.tenants` (rentPsf × sf) vs `marketRentPsfYr` |
| `dscr` | NOI ÷ annual debt service from the holding's loan |
| `rate` | `econ.indexRate`, spread, coupon; 10-year series from `econ.history` |
| `cash` | last 12 months of `booksMonthly` cash movement (Books › Cash) |

### 4.3 Footer verbs

**For sale, not owned** (3 clicks to own at ask):
1. Pick the building (opens the file).
2. **Pay ask** (`B`) → `offer(bbl, ask, false)` (`store.ts:1553`, the same call
   as the classic "Pay ask", `AcquireDesk.tsx:1090`). Most sellers take it;
   if they counter, the footer shows **Take $X** `acceptCounter(bbl)` /
   **Walk** `walkAway(bbl)` (one extra click, as today).
3. **Confirm** with the default financing → `closeDeal(bbl, product, lev)`
   (`store.ts:1562`). `product`/`lev` come from the preset; preview the quote
   with `buyQuote(s, parcels, bbl, price, product, lev)` (`engine/actions.ts:112`)
   and show Equity · Debt svc · CoC · DSCR as `Figure`s before Confirm.
   "Custom" opens the classic `BuyButtons` stack desk (`AcquireDesk.tsx:1123`).

Offer below ask: amount input + **Offer** → `offer(bbl, amount)`.
Not listed: **Approach** `approach(bbl)` / **Bid** `bidBlind(bbl, bid)`.

**Financing preset** (store, persisted `bw:buy-preset`):
`buyPreset: { product: "cheapest" | "cash" | ProductId; lev: number }`, default
`{ product: "cheapest", lev: 1 }` (BuyButtons' own default: the cheapest product
that quotes, full quoted principal). Set in Settings › Buying and from the
segmented control in the file. Product ids: `engine/debt.ts:102` PRODUCTS.

**Owned:** Refinance → Money tab, quotes from `refiQuotes`, commit
`refi(bbl, product, lev)` · List (ask) `listSale(bbl, ask, mode)` · when listed:
Reprice `reprice(bbl, ask)`, Delist `delistSale(bbl)`, Take bid `takeBid(bbl, i)` ·
Renovate `renovate(bbl)` · Build → Build tab.

**Vacant lot you own** (3 clicks): pick › **Plan** (Build tab, best scheme
preselected) › **Break ground** →
`develop(bbl, use, floors, coverage, "gmp", plan.ltcMax * ltcWant, undefined, plan.lender)`
(`store.ts:1466`, as `DevelopDesk.tsx:1167` calls it).

### 4.4 Best scheme helper

Lift the inline sweep from `BestSchemes` (`ui/panels/DevelopDesk.tsx:463-481`:
every use in `USES` × floors 2..50 and the top, each through
`planDevelopment` (`engine/dev.ts:784`), ranked by `hurdleRatio`) into
`ui/next/bestScheme.ts`:
```ts
export function bestSchemes(g: GameState, p: ParcelTable, bbl: string, n = 3): { use: DevUse; floors: number; coverage: number; hurdle: number; equity: number; profit: number }[];
```
Cache per `(bbl, game.month)` through the derive cache: the sweep is many
`planDevelopment` calls. `DevelopDesk` imports it so both use one function (R8).

Done when: buy at ask is 3 clicks from the city, NOI/value/land drills open on
the Overview, and every action the classic card and Property page offer is still
reachable (footer, or a hosted tab).

---

## 5. Acceptance for steps 1–4

- Click budgets in PLAN §0.2 for: buy at ask, cash + debt, NOI, land value,
  start a build, tenant letter, refinance, advance, news. Count them by hand in
  `?host=unreal` and record them in the PR.
- Speed: re-run `ui-revamp/profile-harness.html` (copy to
  `broadway-and-wall/profile.html`, open `/profile.html?host=unreal`). Opening
  any place or the building file stays under 50 ms after P1–P7 in the 2012
  test state.
- `pnpm check` green; the word lint passes on `ui/next/`.
- Classic shell unchanged with `uiShell = "classic"`.
