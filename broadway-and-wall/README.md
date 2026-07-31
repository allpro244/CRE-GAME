# Broadway & Wall

A commercial real estate tycoon game set in **Ashport** — a compact fictional harbor city (~1,800 lots) that starts young and gets built out over the campaign. Spec: `broadway-and-wall-spec-v2.md` (originally NYC-targeted; the map pivoted to a small fictional city for play density — the NYC pipeline below still works). Inherits Groundwork's engine philosophy (pure-function simulation, honest economics); Groundwork itself lives at the repo root.

**Ashport's districts:** Old Harbor (irregular colonial core), the Exchange (office grid + height core), Northside (brownstones), Millside (industrial, ripe for redevelopment), the Point (waterfront tower pads), plus Founders Park, squares, piers, and a 13-station transit net that drives the demand map.

## Running

```bash
pnpm install          # from repo root or this directory (workspace member)
pnpm pipeline:dev     # generate Ashport (deterministic, offline)
pnpm dev              # vite dev server
```

Alternative datasets — synthetic Manhattan (`pnpm pipeline:manhattan`) or real NYC data (needs network access to NYC Open Data / data.ny.gov / census.gov; set `VITE_BASEMAP_STYLE` for a street basemap):

```bash
pnpm pipeline                              # fetch → process → tiles, defaults to --district 101
node pipeline/fetch.mjs --district MN \
  && node pipeline/process.mjs && node pipeline/tiles.mjs   # all of Manhattan
pnpm dev
```

`pnpm build` type-checks and bundles; `pnpm preview` serves `dist/`.

## Data pipeline

Build-time scripts in `pipeline/`, no backend, no API keys:

| Script | What it does |
|---|---|
| `fetch.mjs` | Downloads MapPLUTO tax lots (Socrata, paginated), building footprints (SoQL `intersects` on the study bbox), MTA subway stations, and optionally Census LODES workplace employment joined to census-block centroids. Parameterized: `--district 101`, `--district 101,102`, or `--district MN` (all of Manhattan). |
| `synth.mjs` | **Offline fallback**: deterministic (seeded) synthetic full-Manhattan dataset in the exact same raw schema — real-ish coastline, the real 29°-rotated street grid north of Houston with numbered street/avenue addresses, stitched neighborhood mini-grids (Tribeca/West Village, Soho, Lower East Side) between Houston and Chambers, irregular colonial fabric below Chambers, Central Park and a dozen real parks carved out, height cores at FiDi/Midtown, pre-1961 grandfathered towers, ~48 stations from memory. The app shows a `SYNTHETIC DEV DATA` badge when this source is active. |
| `process.mjs` | Normalizes either source: imputes missing/absurd PLUTO values from building-class medians (flagged per-field), remaps building class → game asset class, computes `demandScore` 0–100 (gaussian kernels over station weight + employment), seeds initial land $/sf from assessed value blended with demand, and builds the **adjacency graph** (bbox grid index + shared-lot-line test, ≥3 m of common boundary). |
| `tiles.mjs` | Cuts `parcels.pmtiles` and `buildings.pmtiles` (z12–16, overzoomed above) with geojson-vt + vt-pbf + a built-in PMTiles v3 writer (`lib/pmtiles-writer.mjs`) — no tippecanoe required. Feature ids are numeric BBLs so MapLibre feature-state drives hover/selection (and later, ownership tint). |

Outputs land in `public/data/`: `parcels.json.gz` (attribute table keyed by BBL — the engine will simulate on this; geometry stays in tiles), `adjacency.json.gz` (both gzipped, inflated in-browser via `DecompressionStream`), `stations.json`, `context.geojson`, `manifest.json`, and the two `.pmtiles` archives (z10–15, overzoomed above). These are committed so the app runs out of the box.

## Map

MapLibre GL, styled as a clean architectural model: near-white extrusions lit by a low map-anchored sun (`light` in the style), pale-blue water, white streets between slightly-gray blocks. The basemap is configurable via `VITE_BASEMAP_STYLE` (default: OpenFreeMap Positron, keyless); its label/POI layers are stripped for the model look unless `VITE_BASEMAP_LABELS=on`. If the basemap is unreachable the app falls back to a fully self-contained light style built from `context.geojson` (land, parks, piers), so the game layers always render. Hover brightens parcel lines; selection lifts the outline, tints the building gold, and highlights adjoining lots in teal.

## Architecture notes for the next phases

- Engine/UI separation is preserved from Groundwork: the coming `src/engine/` will be pure `advanceQuarter(state) → state` over the `parcels.json` table, seeded RNG in state; UI reads via the zustand store (`src/state/store.ts`).
- `adjacency.json` replaces Groundwork's grid edge-adjacency — holdout/assemblage logic (engine `holdoutMult`, `parcelDisposition`, `approachParcelOwner`) ports onto it directly.
- Feature-state by BBL is the hook for ownership/rival tints, construction-growth extrusions, and the map lenses (land value, demand, ownership, lease expirations).
