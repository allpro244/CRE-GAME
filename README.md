# Groundwork

A commercial real estate development simulator. You start with $600,000 in Meridian City and try to build a portfolio without going broke.

Single-page React + TypeScript app, bundled to one self-contained HTML file.

Two cities: **Meridian** (procedural: river, meandering street grid, superblocks, per-seed
arterials) and **New Amsterdam** (an island between two rivers: twin cores, a central park,
avenues, bridges, a shoreline expressway). Same economy, different geography.

---

## Running it

```bash
pnpm install
pnpm dev            # vite dev server with hot reload — the good feedback loop
pnpm build          # production build to dist/
```

To produce the single-file playable artifact, use any single-file Vite plugin
(e.g. `vite-plugin-singlefile`): one HTML file with JS and CSS inlined. The chat
environment used its own `bundle-artifact.sh` for this.

---

## Architecture

| File | What it is |
|---|---|
| `src/engine.ts` | The entire simulation. Pure functions, no React. Every game rule lives here. |
| `src/views2.tsx` | Deal board, deal drawer/modal, LOI negotiation, portfolio (shared AssetCard), refi, debt tab |
| `src/mapview.tsx` | Isometric + flat city map, street network rendering, memoized layers, parcel selection, block panel |
| `src/buildingArt.ts` | Procedural facades & construction sites. Pure: params + prism geometry in, element descriptors out. No React, no engine imports. |
| `src/App.tsx` | Shell, dashboard, economy tab, modals, save/load |
| `src/charts.tsx` | Minimal SVG line/bar charts |
| `src/index.css` | Dark "surveyor terminal" theme (amber #d9a648 on #0e1216) |

**The engine is the product.** It's deliberately pure: `advanceMonth(state) -> state`, no side effects,
no DOM. That's what makes the headless test harness possible, and it's why balance changes are safe to
make — you can simulate 30 years in milliseconds before touching the UI.

### Core state model

- `GameState.tiles` — 14x10 city blocks. Each tile's desirability is **anchor + emergence**:
  `baseD` (geography and street access, fixed at generation except for permanent
  infrastructure like transit) plus a quarterly **mix term** — occupied SF within ~2 blocks
  scored as jobs/residents/amenity by a geometric mean (monoculture ≈ 0, balance compounds),
  scaled with diminishing returns, weighted by average product quality, damped by heavy
  industrial presence. `pop` and `emp` are likewise anchored (`popBase`/`empBase`) plus
  endogenous: occupied residential space attracts residents, occupied business space
  attracts jobs, and demand factors read those. **The game never forecasts** — the map
  shows what is, the player forms the thesis.
- `GameState.roads` — the per-seed street network on block boundaries (local / collector /
  arterial / highway / rail). Arterials jog, locals prune into superblocks and dead ends,
  bridges are scarce. Access is economic: each tile carries `acc` (arterial frontage,
  highway/rail proximity, quiet) feeding rents, demand and land value — retail wants
  frontage, industrial wants the highway and the rail spur, housing pays for quiet.
- Each block is a **4x4 grid of quarter-acre parcels** (`PGRID`, `PARCEL_AC`). Footprints are cell-index
  sets (`cells: number[]`), so buildings can be L-shaped. Edge-sharing (not corner) defines one site —
  see `isContiguous()`.
- `GameState.stock` — ~190 standing buildings, every one real and owned. Listings are drawn *from* stock.
- `GameState.assets` — what you own. `GameState.land` — banked vacant parcels.
- Save format is versioned (`version: 9`); `deserialize()` rejects mismatches rather than crashing.

### Major systems

Economy phases · tenant-level rent rolls with LOI/RFP/renewal negotiation · NNN vs gross leases ·
retail percentage rent (tenant sales from neighborhood traffic; overage past a market-anchored
breakpoint — where the trade outruns the rents) · off-market land friction (unlisted parcels have
owners: ~a third won't sell at any price, most want 50-100% over market, one in ten is quietly
motivated; dispositions are seeded per parcel so reloads can't re-roll an owner, hot blocks
harden, recessions soften, refusals are remembered 24 months — listed land on the deal board is
the pressure valve) ·
multifamily as an aggregate-occupancy asset class · structured debt with balloons, covenants and cash
sweeps · credit facilities · JV equity with 8% pref and 20% promote · depreciation, recapture, capital
gains and 1031 exchanges · 10 AI firms that buy *and* develop · rivals play the land game (firms
cold-call parcel owners, assemble contiguous sites lot by lot — visible on the map as claret pads —
break ground when the mass is there, give up on stale assemblies after a holdout wins, and
occasionally close on an off-market lead you priced but didn't tie up) · lease escalations and
tenant renewal options (negotiated in the LOI, exercised only when they're in the tenant's favor) ·
construction pipeline · land banking · demolition · office-to-multifamily conversion · reputation ·
zoning (every block carries a use class R/C/MU/M and an intensity tier 1-3 generated with the city;
use gates the product, tier caps density, existing violations are grandfathered; land prices what
the paper allows, so upzoning is land value — rezoning applications cost real fees, take 5-9 months,
and live or die at a hearing where neighborhood opposition, spot-zoning coherence, the economic
phase and your reputation all vote; the council upzones its own transit corridors; AI firms obey
the same paper) · construction-to-perm takeout (construction loans reprice +150bps and start
amortizing when their IO runway ends — the takeout is your job) · retail co-tenancy (lose an
anchor ≥35% of the building and the inline tenants pull their clauses: some leave within the
quarter, some take a 15% abatement) · insured casualty (fire/storm/burst mains: deductible now,
that share of the rent offline for months, expenses running on all of it — worse mid
insurance-crisis) · a How-to-play primer that opens once on a fresh campaign ·
a REAL leasing market: citywide vacancy per asset class is measured from the actual standing
stock building by building (overbuild industrial and those exact square feet sit empty), rents
follow the vacancy gap with momentum and a price-elasticity stabilizer (cheap space fills, dear
space empties — soft decades find bottoms), tile rents carry a local supply/demand balance term,
leasing velocity/concessions/renewals all swing with per-type tightness (landlord's vs tenant's
market), land is priced as a RESIDUAL (achievable rent → NOI → value at today's cap, minus
today's construction cost, times zoned density, anchored to the location curve), cap rates widen
in soft sectors, and the Economy tab reports it all like a broker's market report.

---

## Testing

```bash
npx esbuild src/engine.ts --bundle --format=esm --outfile=/tmp/engine.mjs

node tools/simtest.mjs    # 6 seeds x 30 years, auto-player, asserts invariants
node tools/probe.mjs      # expense ratios, cap rate distribution, dev spreads
```

`simtest.mjs` is the safety net. It asserts things like: no parcel is ever double-occupied, every
listing points at a real stock building, `listedId` and listings stay in bijection, no NaN in net
worth, the street network is well-formed with no landlocked blocks, desirability stays in bounds,
and — the strictest one — **the per-tile supply ledger always equals the standing stock** (this
invariant has already caught three real bookkeeping bugs; keep it).
**Run it after any engine change.** Balance regressions show up as wild swings in the reported 30-year
net worth range (healthy is roughly $1M–$40M across seeds, with occasional bankruptcies).

`probe.mjs` prints the numbers you tune against: net expense ratios by asset class, going-in cap rate
percentiles vs borrowing cost, and development yield spreads.

---

## Working on this

A few things learned the hard way:

- **Change the engine, then probe, then touch the UI.** Several times a UI-motivated tweak (relieving
  management fees, cutting CAM) quietly moved valuations 15% and needed a cap rate recalibration.
- **Bump `version` in `newGame()` and `deserialize()` whenever `GameState`'s shape changes.** Old saves
  loading into new code is the one bug class that silently corrupts a campaign.
- The map is split into layers memoized on *stable identities* (`tilesGeom`, `grids`, `tileVals`,
  road runs) with handlers reading a `live` ref — hover/pan/zoom re-render a tooltip, not the city.
  If you add per-frame state to a layer path, profile it. Buildings render one prism per footprint
  rectangle (see `cellRects`), with a zoom-bucketed LOD: flat prisms far out, `buildingArt` facades
  (lit windows track occupancy) past ~1.6×.
- `useIsoBuildings`' memo stamp tracks counts + construction progress + coarse occupancy. If you
  add a new way for geometry to change, add it to the stamp or the map won't update.
- Copy is part of the design. News items, error messages, and hints are written in a dry practitioner's
  voice; keep it.

## Ideas not yet built

Rival firms bidding against you on *land* · entitlement/rezoning as a play · percentage rent for retail ·
lease options and fixed-rate renewal caps · corporate G&A and staff · rate caps and hedging ·
tenant sales volumes driving retail health · a proper tutorial.
