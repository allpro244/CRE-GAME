# Skyline + Cycles — Implementation Plan

**Owner goals (locked):** hardcore sim, niche/deep, veteran-first UX, accessible
via literacy not simplification, session fantasy = **build a skyline + survive
cycles**, no scenario campaigns, realism without tedium, 3D map is core,
difficulty = honest risk.

**This plan does not add:** difficulty sliders, casual mode, mobile UI, scripted
campaigns, or abstracted cap-rate tycoon mechanics.

**Execution:** work in order. Each phase ends runnable with `pnpm check` green;
money-moving phases also require `pnpm gate`.

---

## Architecture principles

1. **Map is the index** — every list row and news item should be able to `focus(bbl)`.
2. **`attentionItems` is the inbox** — one source of truth for blocking decisions.
3. **Engine stays pure** — new digest/ceremony logic reads state; UI reacts in store.
4. **No fake numbers** — cycle digest reports measured econ fields only.
5. **Progressive disclosure** — Summary vs Full OM is a view toggle, not a second sim.

---

## Phase 0 — Baseline & branch

| Task | Detail |
|------|--------|
| Branch | `cursor/skyline-cycles-d634` off current tip |
| Harness | `pnpm install && pnpm engine` |
| Smoke | `pnpm check` before any change |
| Play snapshot | Note one seed + one save slot for before/after comparison |

**Done when:** clean branch, harness fresh, baseline check recorded.

---

## Phase 1 — Map click → desk (foundation)

**Goal:** Clicking any lot reliably opens the parcel glance card and flies the camera there.

### 1.1 Unify `select` and `focus` on map click

| File | Change |
|------|--------|
| `src/map/MapView.tsx` | On parcel click: call `focus(bbl, true)` instead of `select(bbl)` alone; also handle Three.js building mesh picks if not wired |
| `src/state/store.ts` | Optional: `select(bbl, { fly?: boolean })` to avoid double code paths |
| `src/map/ThreeBuildings.ts` | Raycast pick → `bbl` → store `focus` (if mesh clicks miss parcels today) |

**Acceptance:**
- Click parcel polygon → glance card opens, camera eases to centroid.
- Click same parcel again → no broken toggle; Escape closes card.
- Click owned building extrusion → same behavior as parcel click.
- `pnpm check` passes.

### 1.2 Map HUD strip (minimal)

| File | Change |
|------|--------|
| `src/ui/MapHud.tsx` | **New** — bottom-left overlay: month, next delivery (player), next balloon (≤18mo), attention count |
| `src/App.tsx` | Mount `<MapHud />` when `playing` |
| `src/index.css` | HUD styles — translucent, does not block map |
| `src/engine/sim.ts` or `src/ui/mapHudData.ts` | Pure helper: `mapHudSnapshot(game, parcels) → { deliveries, balloons, attentionN }` |

**Acceptance:**
- HUD visible on map; clicking a HUD row calls `focus(bbl)`.
- Zero holdings → HUD shows attention count only, no errors.

---

## Phase 2 — Decision inbox (kill hunt-the-LOI)

**Goal:** One queue for everything `attentionItems` already knows about.

### 2.1 Inbox component

| File | Change |
|------|--------|
| `src/ui/InboxRail.tsx` | **New** — lists `attentionItems(game)` with primary action per kind |
| `src/ui/panels/modals.tsx` | Extract routing table: `attentionKey → { page, action, bbl? }` shared with DecisionModal |
| `src/state/store.ts` | `openAttention(key)` — sets page, selects bbl, focuses map |
| `src/ui/YearRail.tsx` | Reuse inbox row styling; year-one rail becomes special case of inbox |

**Action routing (initial):**

| Key prefix | Primary action |
|------------|----------------|
| `loi:` | Open Deals → scroll to LOI |
| `tenant-ask:` | Open Property desk |
| `offer:` / `sale-bids:` | Open Portfolio → sale section |
| `broker:` | Open Market → broker calls |
| `lease-roll:` / `nonrenew:` | Open Leasing |
| loan maturity keys | Open Debt |

**Acceptance:**
- Every `attentionItems` entry has a working "Open" button.
- `Yr` / `Skip` still stop on same items; inbox count matches badge on Deals nav.
- Pop-up decision cards unchanged for users who leave them on.

### 2.2 Extend rail beyond year one

| File | Change |
|------|--------|
| `src/ui/InboxRail.tsx` | Show when `attentionItems.length > 0` OR `game.month < 12` (year-one milestones) |
| `src/ui/TopBar.tsx` | Deals badge uses same count as inbox LOI + bids subset |

**Acceptance:**
- Month 24 with a maturing loan → rail visible with "Refi …" entry.

---

## Phase 3 — Development map loop (skyline payoff)

**Goal:** Owned bright zoning → develop → crane → delivery is obvious on the map.

### 3.1 "Developable" discovery

| File | Change |
|------|--------|
| `src/ui/developable.ts` | **New** — `developableSites(game, parcels): { bbl, residual, pencils, deliverEst? }[]` using existing `planDevelopment` / land read |
| `src/ui/MapHud.tsx` | Section: "N sites ready" → click opens zoning lens + first site focus |
| `src/ui/panels/ParcelDesk.tsx` | Banner on owned vacant/assemblable lots: "Developable · residual $X/sf" with link to Property desk |

**Acceptance:**
- Owned lot with zoning headroom shows develop CTA on parcel card.
- Sites that do not pencil show "Nothing pencils today" (existing copy) with reason.

### 3.2 Construction progress on skyline

| File | Change |
|------|--------|
| `src/map/MapView.tsx` | Pass `progress = (month - startM) / (deliverM - startM)` into `setPlayerBuildings` |
| `src/map/ThreeBuildings.ts` | Interpolate extrusion height by progress; ensure crane visible for `construction: true` |
| `src/map/MapView.tsx` | Feature-state `underConstruction` on parcel layer (optional outline pulse) |

**Acceptance:**
- Advancing months grows building height smoothly on player + rival jobs.
- Delivered building drops crane, sets `fresh` flag for 30 days (existing).

### 3.3 Delivery ceremony

| File | Change |
|------|--------|
| `src/state/store.ts` | After `advanceMonth`, detect new `deliveredM === month` holdings → queue ceremony |
| `src/ui/DeliveryCeremony.tsx` | **New** — non-blocking banner: address, use, sf; auto `focus(bbl)`; deed-stamp toast |
| `src/engine/sim.ts` | `deliveriesThisMonth(prev, next)` pure helper |
| `src/index.css` | `.delivery-stamp` animation (subtle; not mobile-game confetti) |

**Acceptance:**
- Player delivery → camera fly-to + toast + news item with `bbl` (✈).
- Milestone `tower1` still fires via existing `MILESTONES`.
- Ceremony skippable (click map); does not block Advance.

---

## Phase 4 — Cycle survival digest (felt risk)

**Goal:** Surviving cycles = reading exposure, not spreadsheet archaeology.

### 4.1 Monthly cycle digest

| File | Change |
|------|--------|
| `src/engine/cycleDigest.ts` | **New** — pure: phase, rumoredPhase, Δrates, Δcap by class, city vac, portfolio refi cliffs, floating % |
| `src/ui/CycleDigest.tsx` | **New** — collapsible card in MapHud or top-bar expander; first open each month auto-expand, then remember collapsed |
| `src/ui/panels/ResearchPage.tsx` | Reuse prose helpers for one-line "why" where they exist |

**Acceptance:**
- Digest text uses live `game.econ` only — no invented causes.
- Veteran can collapse permanently (localStorage `digestCollapsed`).

### 4.2 Refi cliff map badges

| File | Change |
|------|--------|
| `src/map/MapView.tsx` | Markers on holdings with `loan.maturityM - month ≤ 18` |
| `src/map/cityVisuals.ts` | Icon/atlas for maturity urgency (6mo = urgent) |
| `src/ui/MapHud.tsx` | "N balloons in 18mo" → Debt page filtered |

**Acceptance:**
- Badge click → `focus(bbl)` + open Debt or Property loan section.
- Paid-off loan removes badge same month.

### 4.3 News amplification (light touch)

| File | Change |
|------|--------|
| `src/engine/rivals.ts` / `dev.ts` | Ensure rival `breakGround` / `deliver` push `news` with `bbl` |
| `src/engine/sim.ts` | Rate step ≥25bp in a month → `news` warn line |

**Acceptance:**
- Rival delivery appears on News with ✈; click flies to site.
- No duplicate news spam (cap 1 rival build headline per month).

---

## Phase 5 — Literacy layer (accessibility without dumbing down)

**Goal:** Sim fans without CRE background can learn in-game.

### 5.1 First-run Primer prompt

| File | Change |
|------|--------|
| `src/ui/StartMenu.tsx` | After first "Break ground" on fresh browser: optional modal "Read the Primer (2 min)?" |
| `src/state/store.ts` | `primerOffered` in localStorage |

**Acceptance:**
- Skippable; never blocks play.
- "Don't show again" respected.

### 5.2 Glossary tooltips

| File | Change |
|------|--------|
| `src/ui/Glossary.tsx` | **New** — `Gloss term="DSCR"` wraps children; hover shows definition + link to Primer section |
| `src/ui/panels/ParcelDesk.tsx` | Wrap ~12 high-frequency terms (DSCR, WALT, NNN, cap rate, LTV, NOI, TI, IO, etc.) |
| `src/ui/panels/MiscPages.tsx` | Add anchor ids to Primer sections for deep links |

**Acceptance:**
- Hover does not break layout; works on Summary rows.
- No gameplay values changed.

### 5.3 Summary | Full OM toggle

| File | Change |
|------|--------|
| `src/ui/panels/ParcelDesk.tsx` | `detailLevel: 'summary' | 'full'` — summary shows 5–7 rows + one risk flag |
| `src/ui/panels/PortfolioPage.tsx` | Same toggle on portfolio rows (optional phase 5 stretch) |

**Acceptance:**
- Default `summary` for `game.month < 12`; `full` after or if user toggles (persist in save).

---

## Phase 6 — Rival skyline storybeats

**Goal:** City feels contested; cycles have visible characters.

| File | Change |
|------|--------|
| `src/ui/DeliveryCeremony.tsx` | Handle rival deliveries: smaller toast + news only (no blocking) |
| `src/map/MapView.tsx` | Owners lens: click rival-colored parcel → filter tooltip with firm name + holding count |
| `src/ui/panels/ResearchPage.tsx` | Link "Under construction" table rows to `focus(bbl)` |

**Acceptance:**
- At least one rival job visible on map per active city with development.
- Owners lens legend lists firm names (existing data).

---

## Phase 7 — Portfolio ↔ map integration

| File | Change |
|------|--------|
| `src/ui/panels/PortfolioPage.tsx` | Sort: district, delivery date, under construction; "Show all on map" button |
| `src/ui/MapHud.tsx` | Player SF delivered / city built SF (from `game.delivered`, `built`) |
| `src/state/store.ts` | `mapFilter: 'all' | 'owned' | 'construction'` toggles tint pass in MapView |

**Acceptance:**
- "Show all on map" fits camera to bounding box of holdings.
- Filter does not hide non-owned when off.

---

## Phase 8 — Engine: unified delivery queue (HANDOFF #1)

**Goal:** Skyline matches sim; retire dual-supply confusion.

| File | Change |
|------|--------|
| `src/engine/types.ts` | Document single `CityJob` queue as authoritative |
| `src/engine/dev.ts` | Route player `developments` into same delivery pipeline as `cityJobs` where possible |
| `src/engine/cityscale.ts` | One `reconcileSupplyQueue` path |
| `test/` | Extend city invariant harness for queue consistency |

**Acceptance:**
- `pnpm gate` passes.
- Player + rival deliveries consume same absorption pool (measure with existing report harness).
- No new load-bearing clamps without baseline comment.

**Risk:** Highest engine risk in plan — do after UI phases prove the loop, or parallel only if gate stays green.

---

## Phase 9 — Map polish (ongoing, pick per PR)

| Item | Files | Notes |
|------|-------|-------|
| Lease-expiration lens | `MapView.tsx`, `store.ts` lens enum | Spec item; color by months to expiry |
| Block assemblage outline | `MapView.tsx` adjacency | Teal join on merged sites |
| District silhouettes | `ThreeBuildings.ts`, `citygen` | Millside vs Exchange massing |
| Map-only mode | `TopBar.tsx`, `store.ts` | Hide page sheet, keep HUD + inbox |
| Photo/export frame | `MapView.tsx` | Nice-to-have |

---

## Testing matrix

| Phase | Required |
|-------|----------|
| 1–2 | `pnpm check` |
| 3–4 | `pnpm check` + manual: buy → develop → deliver → digest |
| 5 | `pnpm check` |
| 8 | `pnpm gate` + `pnpm baseline:check` (explain any moves) |
| All | No new RNG draw count in hot paths without re-roll note in commit |

---

## Suggested PR breakdown (for agent execution)

1. **PR1 — Map click + MapHud** (Phase 1)
2. **PR2 — Inbox rail** (Phase 2)
3. **PR3 — Developable + construction height** (Phase 3.1–3.2)
4. **PR4 — Delivery ceremony** (Phase 3.3)
5. **PR5 — Cycle digest + refi badges** (Phase 4)
6. **PR6 — Primer prompt + glossary + summary toggle** (Phase 5)
7. **PR7 — Rival beats + portfolio map** (Phase 6–7)
8. **PR8 — Unified delivery queue** (Phase 8 — engine)
9. **PR9+ — Map polish** (Phase 9, à la carte)

---

## Out of scope (explicit)

- Scenario campaigns or win-condition objectives beyond existing milestones
- Difficulty settings or penalty multipliers
- Mobile / touch UI
- Simplified economics mode
- New asset classes or tax/JV systems
- Root-level `src/` or Groundwork restoration

---

## Agent execution checklist

```
[x] git checkout -b cursor/skyline-cycles-d634
[x] pnpm install && pnpm engine && pnpm check
[x] Phase 1 — map click + MapHud
[x] Phase 2 — InboxRail
[x] Phase 3 — developable + delivery ceremony (construction height already existed)
[x] Phase 4 — cycle digest + balloon notices on map
[x] Phase 5 — Primer offer + glossary + Summary/Full OM
[x] Phase 6–7 (partial) — portfolio show on map; rival delivery toast path
[ ] Phase 8 — unified delivery queue (engine)
[ ] Phase 9 — map polish à la carte
[x] Draft PR: https://github.com/allpro244/CRE-GAME/pull/67
```
