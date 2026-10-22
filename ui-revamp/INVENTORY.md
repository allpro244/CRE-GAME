# Current UI inventory (origin/main 9a5acbc3, 2026-10-21)

Paths are relative to `broadway-and-wall/src/`. Read-only survey; nothing here was changed.

The labelled side rail of desks is `<nav className="siderail">` inside
`ui/TopBar.tsx:601-790`, not `MapRail.tsx`. `MapRail.tsx` is the folding
left column over the map that holds the Docket, MapHud and CycleDigest.

## 1. Surfaces

The store's `page` field (`state/store.ts:66`) picks the page. Its values are
`none | portfolio | leasing | deals | market | buildings | notes | debt |
investors | banks | books | economy | pulse | players | news | rankings | firm |
property | saves | settings | primer`.

Desks and their tabs come from `ui/desks.ts:31-102`. Keys 1–6 pick a desk
(`RightPanel.tsx:101-108`), and pressing the same key again closes it. Every
room except Property is also a rail line (`TopBar.tsx:662-700`) and an entry
in the Ctrl/⌘K palette (`Palette.tsx:61-74`).

| Surface | File | Purpose | How you get there |
|---|---|---|---|
| Holdings | panels/PortfolioPage | the book, income, exposure, portfolio sale | rail, key 1 |
| Leasing | panels/LeasingPage | occupancy, letters, mandate, rent roll | rail, key 1 tab |
| Marketplace | panels/MarketPage | listings, REO, distressed, street books, land | rail, key 2 |
| Buildings | MarketPage `BuildingDatabase` | every building, sortable | rail |
| Notes | panels/NotesPage | distressed paper (tab only when there is some, `desks.ts:52`) | key 2 tab |
| Deals | panels/DealsPage | LOIs, talks, sales | rail, key 3 |
| Debt / Investors / Banks / Books | DebtPage, InvestorsPage, BankProfile `BanksPage`, BooksPage | the Capital desk | rail, key 4 |
| Markets / Pulse / Players / Tape / Rankings | EconomyPage, PulsePage, PlayersPage, NewsPage, RankingsPage | the City desk | rail, key 5 |
| The Record | FirmStanding + FirmTimeline | firm history | rail, key 6 |
| Property file | panels/PropertyPage | the full desk for one deed | from a card door, table row or palette (`page=property` + `selectedBBL` + `propertyTab`) |
| Saves / Primer / Settings | panels/MiscPages | rail foot | `TopBar.tsx:711,719,727` |
| Docked parcel card | ParcelDesk `ParcelPanel` | glance card and buy desk | click a building (`select`, `store.ts:916`); in Unreal, `window.bwUnreal.select` |
| Palette | ui/Palette | search the clock, desks, lenses, to-dos, deeds, tenants, firms, lenders, lots | Ctrl/⌘K |
| Shortcuts | ui/Shortcuts | the key list | `?` |
| MapRail (Docket, MapHud, CycleDigest) | MapRail, docket/Docket, MapHud, CycleDigest | what wants you, city HUD, cycle readout | always on while playing |
| MapControls | ui/MapControls | emphasis filters and 8 lenses | hidden when a page is open |
| DesignPeekBar | ui/DesignPeekBar | design controls while the scheme is shown | `designPeek` |
| Toasts, AtRiskBanner | App.tsx | messages; a click opens the item | `toast` |
| Engine cards | panels/modals: Alert, DefaultNotice, Decision, Auction | one at a time (`RightPanel.tsx:254-257`) | engine state |
| GameOverPage | modals.tsx:1142 | post-mortem | `game.gameOver` |
| Moments: YearReview, GoalCard, ExitCard, DeliveryCeremony | YearReview.tsx, DeliveryCeremony.tsx | one at a time (`App.tsx:36-45`) | engine state, toast click |
| MilestoneFlash, CardQueue, PrimerOffer | YearReview.tsx:118, CardQueue, PrimerOffer | banner, “N more cards”, primer offer | state |
| StartMenu → GameSetup | StartMenu, GameSetup | start screen | `phase !== "playing"` |
| Map-only / Photo | store `mapOnly` / `photoFrame` | hide desks / hide all chrome | keys M / P |

Top-bar readouts are also doors: Line → Debt › Line of credit (`TopBar.tsx:398`),
Size rank → Players (470), Next due → the item (501), Market → Markets (550),
Book → Debt (574). Back: Alt+← walks `navBack`, up to 24 steps (`store.ts:130`).

## 2. Navigation model

- No router. `RightPanel.tsx` (`GamePanels`, mounted at `App.tsx:81`) switches
  on `page` with a chain of `{page==="x" && <X/>}` (`RightPanel.tsx:222-241`)
  inside one `.page-backdrop` overlay. Backdrop click or Esc sets `page` to
  `"none"`.
- `setPage` (`store.ts:988-1000`) pushes nav history and wraps the update in
  `startTransition`.
- **Every page unmounts on switch and remounts on return.** Nothing is kept
  mounted and there is no `React.lazy` anywhere in `ui/`.
- The docked `ParcelPanel` unmounts when any page opens; PropertyPage re-mounts
  it embedded (`PropertyPage.tsx:379`).
- Each page keeps its own sub-view in local state; deep links go through the
  one-shot handoff in `ui/deskView.ts`.
- `SectionNav` (`RightPanel.tsx:363`) builds the section chips by scanning the
  page DOM, with a MutationObserver on the whole subtree.

## 3. Clicks for the common jobs (from the default view)

| Job | Today | Path |
|---|---|---|
| Buy a listed building | 6, or 7 via Marketplace | click building → “Make an offer ↓” (`ParcelDesk.tsx:1418`, only scrolls) → Pay ask / Offer (`AcquireDesk.tsx:1090/1082`) → “Structure the stack ▸” (1273) → optional lender (1298) → “Review & commit ▸” (1373) → “Close at $X” (1405) |
| Check cash | 0 | top bar (`TopBar.tsx:389`) |
| Check total debt | 1 (or hover) | no top-bar readout; rail Debt tooltip (`TopBar.tsx:678`) or Debt page tile (`DebtPage.tsx:~263`) |
| Develop your vacant lot | 4 minimum, ~6 typical | click lot → “Open the Build desk →” (`ParcelDesk.tsx:297`) → pick a use (`DevelopDesk.tsx:~515`) → Next · Design (875) → Next · Financing (890) → Break ground (~1167) |
| Advance time | 1 | Play (`TopBar.tsx:877`), Advance 1 mo (583), 1 yr (586), skip (589); keys Space/G, Y, N |
| Read the news | 1 (2 by key) | rail Tape (`TopBar.tsx:688`); key 5 lands on Markets |
| Answer a tenant letter | 3 | Deals → Tenants asking → answer |

## 4. Inside Unreal (`?host=unreal`, `UNREAL_HOST` at `state/unrealHost.ts:30`)

- `App.tsx:76` renders `UnrealSurface` (a transparent full-screen layer that
  forwards the pointer as viewport fractions) instead of `MapView`.
- `startUnrealHost` (`unrealHost.ts:81`) adds `html.host-unreal`; CSS makes the
  page transparent (`index.css:2705-2709`).
- `DesignPicker.tsx:112` swaps in `KitPicker`; `SchemeViewer.tsx:22` swaps in
  `HostSchemeWindow`, which cuts a `clipPath` hole through the layers above it.
- Nothing else in `ui/` checks `UNREAL_HOST`: TopBar, the rail, MapRail,
  MapControls, lenses, photo frame and DesignPeekBar all still render.
- Page → Unreal (`window.ue.bridge`): `city` (bw-city/1, about 1 MB once),
  `view` (bw-render/1, about 30–66 KB per game change), `select`, and `input`
  events (quality, preview, preview-off, camera keys, hover, pan, orbit, click,
  zoom, preview-rect, preview-orbit).
- Unreal → page: `window.bwUnreal.select(bbl)` (`BWGame.cpp:853`).
- **Gaps:** `lens`, `mapFilter`, `flyTo`, `fitBook` and `hoverCard` are never
  sent to Unreal, so lenses, “Show on map” and “Show my book” do nothing there.
  Digit1-3 go to the Unreal camera **and** fire desk hotkeys 1-3
  (`unrealHost.ts:142`, `RightPanel.tsx:101`).
- Unreal hosts the page in an `SWebBrowser` added over the whole viewport:
  transparent, `BrowserFrameRate(60)`, UI-only input
  (`unreal/BroadwayWall/Source/BroadwayWall/BWGame.cpp:856-880`).

## 5. Tabs and sections inside the big pages

- **PortfolioPage:** holdings table (sort, Top earners, per-row refi / ops /
  list / ground lease / assemble), Exposure, Scheme in progress, Portfolio sale
  desk, Returns to date.
- **MarketPage:** lens toggle, Books for sale, Bank-owned, Distressed (auction),
  Noticed for the courthouse, In workout, On the market, The shops, Land, BuyBox
  editor, Where to start. BuildingDatabase has class filters.
- **EconomyPage:** stance selector (general, office, retail, multifamily,
  industrial, land, banks, employers, districts), span 20y/all; What money has
  cost, The space market, sector, Submarkets, Neighbourhood demand, How this works.
- **DebtPage:** tiles, The stack, Private borrow offers, Where the risk is,
  Maturity wall, Borrowing against the whole book, Line of credit, Loan by loan.
- **BooksPage:** Balance (Today / Year-end), P&L, Cash (Year / Month), Property tax.
- **DealsPage:** Live / Sales; On the table, Tenants asking, Letters of intent,
  Their answer, Doors you knocked on, Sales in progress.
- **LeasingPage:** Leased fees, On your desk, By building, Exposure by trade,
  The rent roll.
- **AcquireDesk:** OfferDesk, BuyButtons (Thesis / Structure / Commit),
  OffMarketCounter, BlindBidDesk, SaleSection, ListSection, GroundLeaseSection,
  VacantPossession, DisclosedRoll.
- **ParcelDesk (card):** Summary / Full OM, doors (Rent roll, Money, Operations,
  Sell, Build), Developable prompt, sticky BuyCta.
- **PropertyPage tabs:** Overview, Rent roll, Money, Operations, Sell (or
  Acquire), Build (or Convert / Build), Deed history.
- **DevelopDesk:** stepper Programme / Design / Financing; Shops at grade,
  Delivery strategy, The site, Costs, Financing, Outside equity, Equity, Reuse,
  DevelopGlance, BestSchemes.
- **PropertyDesks:** AssetHistory, WorkoutDesk, MinDealSize, LettingOdds,
  LeasingDesk, ResidualRead, Assemble, LandDesk.
- **Others:** News (front, headlines, prints + kind filters), Players (street,
  private, owners), Banks (per-lender), Investors (Syndicate, Fund).
