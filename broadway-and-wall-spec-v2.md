# Broadway & Wall — Build Specification v2

A commercial real estate tycoon game on a real 3D map of New York City. The player buys, develops, leases, and sells actual Lower Manhattan parcels, growing net worth through honest economics. The map must feel like flying through Google Maps' 3D mode; the deal mechanics must feel like the real business.

**This spec supersedes `broadway-and-wall-spec.md` (v1) entirely — use only this document.** This is a fresh build, but it inherits proven systems from the developer's previous game, **Groundwork** (React/TS/Vite, pure-function engine in `src/engine.ts`). If the Groundwork repo is available on this machine, read its engine before implementing the leasing, debt, and AI-rival systems below and port logic where it fits; where it isn't available, implement from this spec's descriptions, which match Groundwork's behavior. Explicitly do NOT carry over Groundwork's world model: no quarter-acre parcel grid, no uniform blocks, no isometric SVG renderer, no fictional city. The world is real NYC geometry.

## Design pillars

1. **The map is the game.** 60fps flight over extruded real buildings, parcels selectable straight off the map, ownership and construction visible on the skyline itself.
2. **Real everything.** Real parcels (NYC PLUTO), real building heights, real zoning and FAR, land values seeded from real assessed values and demand data — then moved by the game's own market dynamics.
3. **Honest economics, legible causality.** Value = NOI ÷ cap rate; leverage cuts both ways; when a deal goes bad the player can trace why (Groundwork's core philosophy, kept).

## Tech stack

Vite + TypeScript + React. **MapLibre GL JS** for the 3D map: free vector basemap (OpenFreeMap default, tile URL configurable) plus game-owned **PMTiles** layers for parcels and building extrusions, preprocessed with tippecanoe and served statically — no backend, no keys. Simulation lives in a pure engine module (`advanceQuarter(state) → state`), seeded RNG, UI reads from a Zustand store, saves to IndexedDB with multiple slots and autosave. This mirrors Groundwork's engine/UI separation, which is what made that codebase maintainable — preserve it strictly.

## Data pipeline (build-time scripts)

1. **PLUTO / MapPLUTO** (NYC Open Data): one record per tax lot — BBL, address, lot area, building area, zoning district, max commercial/residential FAR, building class, year built, floors, assessed land and total value, lot polygon. v1 territory: **Manhattan Community District 1** (south of Chambers St, ~4,000 lots), parameterized by district for later expansion.
2. **Building Footprints** (NYC Open Data): polygon + roof height per building, joined by BIN/BBL, drives extrusions.
3. **Demand signals**: Census LODES workplace employment by block + MTA station locations and ridership → per-parcel `demandScore` (0–100), proximity-weighted.
4. **Adjacency graph**: precompute which parcels share lot lines (buffer-and-intersect on polygons). This replaces Groundwork's grid edge-adjacency and powers land assembly with real, irregular geometry — L-shaped lots, through-block sites, corner assemblages.

Outputs: `parcels.pmtiles`, `buildings.pmtiles`, `parcels.json` (attribute table keyed by BBL — the engine simulates on this; geometry stays in tiles), `adjacency.json`. Impute missing/absurd PLUTO values from building-class medians and flag them.

**Land value model:** initial land psf seeded from PLUTO assessed land value blended with `demandScore`, then evolved each quarter by the market engine (rates, rent growth, nearby development activity, rival acquisitions). Land near delivered new buildings and high-demand nodes appreciates; oversupplied pockets soften. Values must be inspectable: a map lens shading land value per sf, and a parcel-card sparkline of its history — reading where values are *going* is the core player skill.

## Map presentation

Cinematic fly-in to FiDi at ~55° pitch. Clean architectural-model look: subtle vertical gradient on extrusions, faint parcel lines at ground level that brighten on hover; selection lifts the outline and tints the building. Player-owned buildings get a facade tint and rooftop marker; rival firms each get a muted signature color so their footprints are readable on the skyline. Construction: the extrusion grows in height each quarter until delivery — the signature visual moment. Optional soft day-cycle lighting if it's cheap on frames. Map lenses (toggleable): land value, demand, ownership, lease expirations. Performance budget: 60fps over CD1 on an M1 Air.

## Game systems

**Time & market.** Quarterly ticks. Loan index rate (mean-reverting walk, 4.2–9.2%), market cap rates per asset class (walk with rate-linked drift), rent index per class, and a slow boom/recession cycle that the news ticker foreshadows — rumors precede turns, in Groundwork's "randomness creates situations, never verdicts" spirit. Save the RNG seed in state.

**Asset classes v1:** office, retail, mixed-use, multifamily (aggregate-occupancy model, as in Groundwork — no per-unit tenants), plus vacant land. Class comes from PLUTO building class, remapped where data is odd.

**Acquisitions.** Any parcel is approachable, but not everything is for sale: listed properties (a rotating subset) trade near ask; off-market approaches face refusal odds and price premiums that rise with assemblage pressure — port Groundwork's holdout logic onto the real adjacency graph. Buy all-cash or financed.

### Leasing (port from Groundwork)

Commercial tenants are named entities with sector, credit quality, and space needs. Vacant space generates inbound **LOIs** whose frequency scales with `demandScore`, condition, and market phase; the player can counter on rent, term, **TI allowance**, and free rent, and pays **leasing commissions** on execution. Leases are **NNN or gross** with correct expense treatment (NNN passes opex through; gross absorbs it against a base). Each lease tracks expiration; expirations trigger **renewal negotiations** where the incumbent weighs relationship, market rent, and relocation cost. Rollover risk should cluster realistically — a building with three leases expiring the same year is a visibly riskier asset, and the lease-expiration map lens exists to surface exactly that. Multifamily skips LOIs and uses aggregate occupancy drifting toward a demand-driven target.

### Debt (port from Groundwork)

Loans are structured, not abstract: fixed or floating rate at origination, amortization schedule or interest-only period, **balloon maturity** that must be refinanced or repaid, **DSCR and LTV covenants** tested quarterly, and **cash sweeps** — covenant breach traps property cash flow toward the lender until cured. Refinancing reprices at current rates and value (cash-out if equity allows); a maturity arriving in a high-rate, high-cap-rate quarter should be genuinely dangerous. Lender proceeds gate on DSCR at underwriting, not just LTV. Insolvency (cash negative 4 straight quarters) forces liquidation and ends the run with a post-mortem that names the cause in plain English.

### AI rival firms (port from Groundwork)

Six to ten named firms with distinct styles (core buyer, value-add, merchant developer, land banker) and style-consistent portfolios. Each quarter they bid on listings (the player can be outbid, and can see closed comps), acquire and assemble land, break ground on developments the player can watch rise, and occasionally distress-sell in downturns — one aggressive firm should over-lever and visibly blow up in a meaningful share of campaigns, creating buying opportunities. Rival activity feeds the land-value model, so watching *where rivals are buying* is a legitimate market signal.

### Development (simplified for v1)

On owned vacant or teardown-class parcels (and assembled sites, which merge into one developable site with combined lot area): choose use and FAR up to the real zoning max, pay hard cost per sf (varies by class and height), fund with a 60% construction loan, wait 4–6 quarters while the building rises on the map, then lease up from empty. A modest random cost/schedule overrun range keeps it honest. **Deferred to a later phase:** Groundwork's full risk stack — due diligence, GC contract structures, interest reserves, design phase, entitlement. Architect the construction module so those can slot in without rework.

**Renovation:** cash cost per sf, 2 quarters, rents +~20%, condition to good — as in the v1 prototype.

**Deferred from Groundwork (later phases, not v1):** JV equity and promote waterfalls, depreciation/recapture/capital-gains taxes and 1031 exchanges, office-to-residential conversion, entitlement/council mechanics. Keep the ledger per-deal (actual cash flows in/out) from day one so IRR, return attribution, and taxes can be added without re-architecting.

## UI

Map dominant. Top bar: date, cash, net worth, quarterly cash flow, index rate, advance button. Right panel tabs: Parcel, Portfolio, Deals (open LOIs/negotiations/loan maturities needing attention), Market (the tape + comps). Preserve the v1 prototype's identity — plat-map warmth, deed-stamp toasts, serif headers, monospace numbers — as translucent cards over the 3D map. Surface information where the player is already looking: negotiation cards anchor to the parcel, covenant warnings badge the building on the map. Desktop browser only for v1.

## Build phases (each ends runnable and committed)

1. **Map foundation.** Pipeline → PMTiles for CD1, MapLibre with extrusions, parcel hover/select showing real PLUTO data, adjacency graph computed. *Exit: fly FiDi at 60fps, click any lot, see its real record and neighbors.*
2. **Core loop.** Engine skeleton (quarterly tick, market walks, saves), simple buy/sell/renovate with basic financing, ownership on the map, land-value lens live.
3. **Deal depth.** Full leasing system (LOIs, NNN/gross, renewals, TI/LCs), structured debt (covenants, balloons, sweeps, refi), off-market acquisition friction and assembly on the real adjacency graph.
4. **A living market.** AI rival firms end-to-end (bidding, assembling, developing, distress), rival buildings rising on the skyline, comps feed, rumor-driven news.
5. **Development & polish.** Simplified construction with growing extrusions, fly-in, lenses, sound, achievement/milestone flow, balance pass and insolvency post-mortems.

## Balance targets

Start: $6M cash. A competent player reaches $25M net worth in ~15 in-game years; misused leverage into a rate spike can end a run; assembling a full blockfront and delivering a tower on it should feel like a campaign-defining achievement, not a routine move.
