# Broadway & Wall

A commercial real estate tycoon game on a real 3D map of New York City. Spec: `broadway-and-wall-spec-v2.md`. This is the fresh build that inherits Groundwork's engine philosophy (pure-function simulation, honest economics) — Groundwork itself lives at the repo root and its `src/engine.ts` is the porting source for the leasing, debt, and rival systems in later phases.

**Phase 1 (this commit): map foundation.** Data pipeline → PMTiles for Manhattan Community District 1, MapLibre 3D map with building extrusions, parcel hover/select with the PLUTO record, and the lot-line adjacency graph that will power land assembly.

## Running

```bash
pnpm install          # from repo root or this directory (workspace member)
pnpm pipeline:dev     # offline synthetic dev dataset (see below)
pnpm dev              # vite dev server
```

Or with real NYC data (needs network access to NYC Open Data / data.ny.gov / census.gov):

```bash
pnpm pipeline         # fetch → process → tiles, defaults to --district 101
pnpm dev
```

`pnpm build` type-checks and bundles; `pnpm preview` serves `dist/`.

## Data pipeline

Build-time scripts in `pipeline/`, no backend, no API keys:

| Script | What it does |
|---|---|
| `fetch.mjs` | Downloads MapPLUTO tax lots for one community district (Socrata), building footprints (SoQL `intersects` on the district bbox), MTA subway stations, and optionally Census LODES workplace employment joined to census-block centroids. Parameterized: `node pipeline/fetch.mjs --district 101`. |
| `synth.mjs` | **Offline fallback**: deterministic (seeded) synthetic Lower-Manhattan-like dataset in the exact same raw schema — real-ish coastline, procedural irregular blocks/lots, FiDi-plausible zoning (C5-5/C6-9/C6-4/C6-2A/BPC), pre-1961 grandfathered towers, station locations from memory. The app shows a `SYNTHETIC DEV DATA` badge when this source is active. |
| `process.mjs` | Normalizes either source: imputes missing/absurd PLUTO values from building-class medians (flagged per-field), remaps building class → game asset class, computes `demandScore` 0–100 (gaussian kernels over station weight + employment), seeds initial land $/sf from assessed value blended with demand, and builds the **adjacency graph** (bbox grid index + shared-lot-line test, ≥3 m of common boundary). |
| `tiles.mjs` | Cuts `parcels.pmtiles` and `buildings.pmtiles` (z12–16, overzoomed above) with geojson-vt + vt-pbf + a built-in PMTiles v3 writer (`lib/pmtiles-writer.mjs`) — no tippecanoe required. Feature ids are numeric BBLs so MapLibre feature-state drives hover/selection (and later, ownership tint). |

Outputs land in `public/data/`: `parcels.json` (attribute table keyed by BBL — the engine will simulate on this; geometry stays in tiles), `adjacency.json`, `stations.json`, `context.geojson`, `manifest.json`, and the two `.pmtiles` archives. These are committed so the app runs out of the box.

## Map

MapLibre GL. The basemap is configurable via `VITE_BASEMAP_STYLE` (default: OpenFreeMap Liberty, keyless); if it is unreachable the app falls back to a fully self-contained dark style built from `context.geojson`, so the game layers always render. Extrusions use `heightM` from building footprints (roof height, feet→meters) with a height-ramped limestone-to-slate color and vertical gradient. Hover brightens parcel lines; selection lifts the outline, tints the building gold, and highlights adjoining lots in teal.

## Architecture notes for the next phases

- Engine/UI separation is preserved from Groundwork: the coming `src/engine/` will be pure `advanceQuarter(state) → state` over the `parcels.json` table, seeded RNG in state; UI reads via the zustand store (`src/state/store.ts`).
- `adjacency.json` replaces Groundwork's grid edge-adjacency — holdout/assemblage logic (engine `holdoutMult`, `parcelDisposition`, `approachParcelOwner`) ports onto it directly.
- Feature-state by BBL is the hook for ownership/rival tints, construction-growth extrusions, and the map lenses (land value, demand, ownership, lease expirations).
