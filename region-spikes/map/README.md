# Region map spike (spike 3 of `REGION_PLAN.md`)

**Question:** does a *generated* metro region look believable, before any
engine or Unreal work depends on one?

This is throwaway code. It is meant to be honest, not finished. Nothing in the
game reads it.

## Run

```bash
node region-spikes/map/region.mjs                 # seeds 1..6, 10 x 10 km (the default)
node region-spikes/map/region.mjs 7 42 --png      # chosen seeds, plus a PNG
node region-spikes/map/region.mjs 3 --km 6        # another window size -> region-3-6km.svg
```

- Plain Node ESM with no dependencies. It writes `out/region-<seed>.svg`.
- The output is deterministic per seed (seeded mulberry32; no `Math.random`).
- `--png` rasterises the SVG with a locally installed Edge or Chrome in
  headless mode. If neither is found it skips the PNG; set `CHROME=<path>` to
  point it at one.
- Each seed takes about 2 s at 10 km.

Committed renders, SVG + PNG:
- `out/region-<seed>`: seeds 1–6 at **10 × 10 km**. This is the default
  since the owner chose 10 km.
- `out/region-<seed>-6km`: the first round at 6 × 6 km, kept for comparison.
  These files were made by commit ff4cd6dc. The generator has changed since
  (town spacing and count), so to reproduce them exactly, check out that
  commit.

Seeds 1–4 are river mouths on a coast; seeds 5–6 are an inland river. The
coast/inland choice is a coin flip per seed.

## Layers (each one reads the ones before it)

The whole map is generated in one fixed frame: the river runs top to bottom,
and any sea is at the bottom. At render time the map is rotated by a multiple
of 90°, so seeds face different ways while the land survey stays cardinal
(north is always up).

1. **Land and water.** A river is built as a valley-scale bend plus meanders.
   Its floodplain is a band of varying width along it. There are 1–3 creeks,
   each with its own floodplain. Half the seeds also get a coast with a
   coastal flood band. All of these are rasterised (20 m cells) into
   water and floodplain masks. The land is flat; there is no elevation.
2. **Old settlements.**
   - **Downtown:** a 2.6 × 1.5 km block grid standing in for the island city.
     The existing generator is not imported. On a coast it fronts the sea
     beside the river mouth. Inland it sits on one bank, aligned to the river.
     The site is picked by trying candidates and keeping the driest one that
     fits.
   - **Towns:** one river-crossing town (a ferry or mill village), then 1–2
     inland crossroads towns. Each is a small grid, at least 2.5 km from the
     others.
3. **Road skeleton.**
   - **Old country roads:** A\* over a cost surface. The surface is noise as a
     stand-in for terrain, floodplain is expensive, and water costs 60× except
     where a town or downtown bridges it. Roads already laid get cheaper, so
     later roads merge into a tree. The roads run downtown → edges,
     towns → downtown, town → town, and town → edge. They are drawn as
     arterials.
   - **Survey grid:** section-line roads every mile (US Public Land Survey),
     broken wherever they hit water or a settlement.
   - **Highway master plan:**
     - **H1, the interstate:** passes just landward of downtown; all built,
       1958–74.
     - **H2, a spur:** radiates from H1 at downtown; built from the downtown
       end outward, often stopped short.
     - **H3, an outer bypass:** an arc around downtown; all PROPOSED, with
       planned years 2029–46.
     - Later freeways are kept off H1's flanks.
     - Interchanges go where a highway crosses an arterial, at least 1 mile
       apart (FHWA guidance). Old roads get first claim on an interchange.
     - Each segment between interchanges is BUILT (year opened) or PROPOSED
       (planned year).
4. **Suburbs by era.** These are built on the farm tracts of layer 5: a
   developer buys whole tracts, so subdivision edges follow the old farm
   lines, as they do in life.
   - **Accessibility:** three travel-time fields from downtown (Dijkstra on
     the grid):
     - pre-war: streetcar on the old roads, walking elsewhere;
     - post-war: car on arterials, plus freeways built by 1975;
     - recent: freeways built by 2026.
     - Freeways can only be entered at interchanges.
   - **Land budget:** each era's land is its share of US housing units
     (ACS year-built) × gross land per unit for that era. Tracts are claimed
     in order of travel time × a random "holdout" factor (owners who won't
     sell yet, which gives leapfrog development).
   - **Templates:**
     - pre-war: a grid with alleys;
     - post-war: the one curvilinear template, parallel gently curving
       streets closed into loops;
     - 1980s+: a collector spine with cul-de-sacs, lots backing onto the
       collector, and a stormwater pond in the corner nearest water.
   - **Lots:** frontage ticks along every local street.
   - **Masking:** suburbs are masked off floodplain, settlements and freeway
     right-of-way.
5. **Open land.** Survey sections are split into aliquot parts (whole 640,
   160, 80 and 40 ac), with the occasional woodlot. Every tract boundary is
   drawn, developed or not.

Commerce is out of scope.

## Sizes and where they come from

"Approximate" means general knowledge, not a cited measurement. All of these
are in `SZ` at the top of `region.mjs`.

| Size | Value | Source |
|---|---|---|
| Survey section | 1 mile = 1,609 m, 640 ac | US Public Land Survey System (PLSS) |
| Farm tracts | 40 / 80 / 160 / 640 ac | PLSS aliquot parts; split odds approximate (Midwest plat books: mostly 40–160 ac) |
| Section-line road ROW | 66 ft | one Gunter's chain, standard in PLSS states |
| River width | 100–250 m | approximate: mid-size navigable river at a regional city |
| Meander wavelength | 10–14 × channel width | Leopold & Wolman (1960), approximate |
| River floodplain | ~0.4–1.6 km total | approximate |
| Creek width / flood band | 8–20 m / 60–150 m each side | approximate (FEMA Zone A on small streams) |
| Coastal flood band | 100–250 m | approximate |
| Downtown footprint | 2.6 × 1.5 km | the existing island city |
| Downtown blocks | 80 × 240 m pitch | Manhattan grid (Commissioners' Plan 1811) |
| Town blocks | 92–120 m pitch, 4–7 × 3–5 blocks | `island.mjs`'s measured "ordinary American block"; plat size approximate |
| Town spacing / count | ≥ 2 mi; one per ~3.5 mi square | approximate: 19th-c. hamlets ~2–5 mi apart (6 km renders used 2.5 km and 2–3 towns) |
| Interchange spacing | ≥ 1 mile | FHWA / AASHTO urban guidance (2–3 mi rural) |
| Freeway ROW (mask) | 300 ft | approximate |
| Interstate years | 1958–74 | 1956 Act; most urban segments opened in the 1960s–early 70s |
| Spur years / planned years | 1975–95 / 2029–46 | approximate; plan says 10–20 yr from study to opening |
| Pre-war lot | 40 × 110 ft (~4,400 sf), 630 ft blocks, 16 ft alley | approximate streetcar suburb; alley as `island.mjs` (Chicago) |
| Post-war lot | 65 × 115 ft (~7,500 sf) | Levittown NY 60 × 100 ft; 1950s tracts 6–10k sf |
| Recent lot | 70 × 118 ft (~8,300 sf) | Census Survey of Construction median new lot ~8–9k sf (2010s), approximate |
| Streets / ponds / open space | 25–30% of gross | `REGION_PLAN.md` (20–30%) |
| Cul-de-sac max / bulb radius | 600 ft / 45 ft | approximate subdivision-code ranges (500–800 ft; 40–50 ft) |
| Stormwater pond | 4% of tract | approximate (3–8%) |
| Era unit shares | 12% pre-1940, 37% 1940–79, 51% 1980+ | ACS "Year Structure Built", US, approximate |
| Speeds | walk 5, streetcar 15, local 20, arterial 50, freeway 88 km/h | approximate (freeway = 55 mph limit, 1974–95) |
| **Urbanised share by 2026** | **35–60% (per seed)** | **KNOB. Not a fact.** In the game this is the *output* of the growth sim. It is shown in red on every map. |
| Holdout spread | lognormal σ = 0.25 | **KNOB**, also a growth-sim output in the end |

## What changed at 10 km

Only the window grew. Every world size is the same, apart from the towns:
- Town spacing went from 2.5 km up to the real low end of **2 miles**.
- Town count now follows area: one hamlet per ~3.5-mile square, which gives
  3–4 towns at 10 km.

**More believable:**
- **There is a fringe.** Suburbs thin out into a band of leapfrog
  subdivisions, then open farmland with 40–640 ac tracts. At 6 km the whole
  window was "inner suburb".
- **The bypass reads as a bypass.** At 4–5.5 km from downtown, the proposed
  arc runs mostly through rural land with a few subdivisions already waiting
  for it. That is the land-speculation play in `REGION_PLAN.md` §1.
- **Eras sort themselves by distance.** Pre-war grids hug downtown, post-war
  loops line the 1960s interstates, and cul-de-sacs sit beyond. It reads
  clearly in seeds 1, 2, 5 and 6.
- **Downtown is the right size.** It is ~4% of the window instead of ~11%,
  and it no longer pushes against the edge.
- **Towns read as absorbed villages.** Some are already ringed by
  subdivisions (Cedarboro in seed 2, Cedarmont in seed 6); others are still
  country crossroads.
- **Rivers become barriers.** In seeds 4 and 5 the far bank stays
  largely rural because the only crossings are the old-road bridges. "The
  wrong side of the river" is a real pattern.

**Still looks off:**
- **Leapfrog is too speckled.** Isolated 40-ac cul-de-sac tracts sit miles out
  in farmland (seed 1 south, seed 3 north). Some of that is real, but there
  is too much of it, and drive time cannot explain it. The fix is the
  utility frontier, listed under "What the full generator would need".
- **The subdivision templates repeat even more visibly** at this extent:
  rows of identical "combs" and "wavy stripes".
- **Creeks run through downtown** (seeds 4, 5 and 6). A creek is narrower
  than a block, so no blocks are dropped. Real cities bury such creeks in
  culverts, so the image is not wrong, but it reads as a glitch.
- **River towns lose their blocks to the river** (Oakwood in seed 5, Elmwood
  in seed 4). They need to be placed on a bank, as downtown now is.
- **Coastal seeds give ~15–20% of the window to open sea.** That is honest,
  but wasted.
- **Still no commerce.** The interchanges are empty circles in farmland or
  tract housing.

## Parcel count at 10 × 10 km (stretch item)

This is what the engine would have to hold, by type, for each seed at the
urbanised share drawn on that map (each total is shown on the map legend too):

| Seed | Downtown lots | Village lots | Pre-war lots | Post-war lots | Recent lots | Farm tracts | **Total** |
|---|---|---|---|---|---|---|---|
| 1 | 3,329–3,665 | 648 | 3,174 | 7,991 | 9,101 | 195 | **≈ 24,400** |
| 2 | 3,309–3,643 | 660 | 3,389 | 8,094 | 8,451 | 186 | **≈ 24,100** |
| 3 | 3,369–3,708 | 504 | 3,419 | 8,311 | 8,074 | 213 | **≈ 23,900** |
| 4 | 3,375–3,715 | 972 | 3,174 | 6,495 | 7,558 | 213 | **≈ 21,800** |
| 5 | 3,619–3,984 | 1,056 | 4,146 | 8,276 | 10,220 | 223 | **≈ 27,500** |
| 6 | 3,604–3,967 | 816 | 5,082 | 11,227 | 11,706 | 177 | **≈ 32,600** |

How each number is made (`M.parcels` in `region.mjs`):
- **Downtown:** land area of the core × **932–1,026 lots/km²**. That is what
  `island.mjs` measures on the generated island cities.
- **Villages:** village blocks × ~12 lots each. This is approximate: two rows
  of ~50 × 140 ft lots on a ~100 m block.
- **House lots:** one lot per frontage tick drawn by the plat templates,
  counted only where it stands on buildable land. Against the land budget
  divided by gross land per lot, this agrees within roughly ±30%. The
  cul-de-sac template leaves unplatted gaps, so it comes in under its budget.
- **Farm tracts:** undeveloped survey parcels.

On top of these, the 90–180 subdivided parent tracts per seed would exist as
the lots' parent IDs.

**What it means for the engine:**
- **House lots are the bulk:** ~80% of all parcels, nearly all of them
  single-family lots owned by households, not firms.
- **Scale versus the island:** the island city is ~4,000 parcels. A 10 km
  region at today's urbanisation is **~6× that**.
- **At full build-out it is ~12×:** the house-lot count scales roughly
  linearly with the urbanised share (the KNOB), so 100% would mean
  **~45–55k house lots and ~50–60k parcels in all**.
- **What could stay individual:** downtown (~3.5k) and the farm tracts
  (~200) could stay individually simulated parcels, as today.
- **What must aggregate:** house lots should aggregate by subdivision tract or
  phase. That is ~100–200 records, each with a lot count, era and average
  value. Lots would split out only when one is traded, built on or inspected.
- The renderer can still draw every lot, since plat geometry is cheap to
  regenerate from the seed.

## Critique of the 6 km renders, seed by seed (honest)

These notes are about the `-6km` files.

**Believable at a glance:**
- **Seed 1** (coast): downtown on the shore, a pre-war ring hugging it, and
  post-war tracts strung along I-58 and the spur. Recent subdivisions sit
  beyond them, and the proposed bypass cuts through farmland that is
  plainly about to go. This is the clearest "place with a past".
- **Seed 5** (inland): the interstate skirts downtown, the post-war belt sits
  along it, the far bank stays rural because it is floodplain, and a
  proposed bypass swings around the west. It reads right.
- **Seed 6** (inland): good layering east of the river, with a creek greenway
  breaking up the subdivisions. One weakness: the river town "Oakport" lost
  most of its blocks to the river, so it reads as a fragment.

**Weaker:**
- **Seed 3** (coast): downtown straddles the river mouth. The generator could
  not find a dry site of 2.6 km on either bank inside the window, so the
  river runs through the grid. A real port city does that with bridges and
  quays; here it just looks like blocks missing.
- **Seed 4** (coast): downtown is pushed to the map edge to stay dry, so the
  "metro" is mostly on one side of it.
- **Seed 2** (coast): an old road spikes into the middle of downtown and back
  out (both radials aim at the centre point). Otherwise fine.

**Across all seeds:**
1. **6 × 6 km is too small to be a metro.**
   - The 2.6 × 1.5 km downtown takes ~11% of the window.
   - Towns only fit at the bottom of the real spacing range.
   - The "outer bypass" is 2.5–3.3 km from downtown, where a real beltway is
     10–20 km out.
   - **A 10 km render was clearly more believable**: the
     suburbs thin out into farmland, and the bypass has room to be a bypass.
   - "Start small" is the owner's call. My evidence says the believable
     window is ≥ 10 km, possibly 15–20 km with coarser rendering out at the
     fringe.
2. **Leapfrog is too scattered.**
   - By car, everything in 6 km is within ~15 minutes, so accessibility barely
     tells tracts apart and the random holdout factor dominates.
   - Real fringe growth follows the **sewer and water service frontier** (and
     school districts and annexation), not drive time alone. The full
     generator needs a utility-extension layer; it also gives the player
     something real to read.
3. **Subdivisions fill whole tracts and repeat.**
   - Real plats come in phases of 20–80 ac, bend around creeks, and connect to
     neighbours.
   - The post-war template reads as "wavy stripes", and the cul-de-sac one as
     "combs".
   - It is fine for a region view at this zoom, and it will look canned up
     close. One template per era is enough only if it is parameterised by
     tract shape and frontage.
4. **No commerce.** Arterials and interchanges with no strip retail, office
   parks or warehouses make the map look emptier than a real suburb. This was
   out of scope, but it is the biggest missing visual cue.
5. **Highways.**
   - Interchange spacing is honoured, but there is no ramp geometry.
   - H1 sometimes clips a corner of downtown, which is realistic for urban
     renewal.
   - H3 is a partial arc that ends at whatever arterial it reaches.
   - A real master plan would close the loop, or end at a named highway.
6. **Flat land.** There is no elevation, so floodplains are uniform bands and
   roads only wiggle on noise. Bluffs and terraces would sell the
   river valleys.
7. **PLSS only.** The survey grid fits the Midwest and West. An eastern
   metro (metes and bounds, irregular farms, roads on ridgelines) needs a
   different tract generator.

## What the full generator would need

- A real growth sim that decides the urbanised share and the order tracts
  are taken in, instead of the KNOB:
  - land prices;
  - the utility frontier;
  - rival homebuilder demand by era.
- Bigger windows (≥ 10 km), with level-of-detail: lots and streets drawn only
  near the camera.
- Tract → plat → lot IDs that are stable across saves (`tract-12/3/47`), as
  `REGION_PLAN.md` §2 describes. Here a tract is only a rectangle.
- Commerce at interchanges and arterial crossings.
- **To feed Unreal:** the Unreal city builder today reads a `bw-city/1` JSON
  (see `broadway-and-wall/src/citygen/unrealExport.mjs`). It contains:
  - `parcels` (rings in cm, +X north / +Y east);
  - extruded `volumes`;
  - ordered ground layers (`land`, `pond`, `stream`, `park`, …);
  - street `centerlines` with carriageway widths.

  A region exporter would emit:
  - tracts and lots as parcels;
  - floodplain, water and ponds as ground layers;
  - every road class (freeway, arterial, local, cul-de-sac bulbs) as
    centerlines with widths;
  - house volumes from the lot and era.

  It would also need a new **status field** for highway segments
  (built / proposed + year), and **streaming by tile**: the region is far
  bigger than one island-city export.

## Unreal export (`export-unreal.mjs`)

```bash
node region-spikes/map/export-unreal.mjs 3              # full 10 km -> out/city-region-3.json
node region-spikes/map/export-unreal.mjs 3 --crop 2000  # 2 x 2 km sample -> out/city-region-3-crop2000.json
node region-spikes/map/preview-bwcity.mjs out/city-region-3.json   # top-down check -> .preview.svg
```

This writes the region in the Unreal builder's `bw-city/1` format: the shape
`toBwCity` returns in `broadway-and-wall/src/citygen/unrealExport.mjs`, parsed
by `unreal/.../CityData.cpp`.

**Units and axes:** centimetres, origin at the region's centre, +X north,
+Y east. Rings are flat and unclosed.

**Ground layers, in draw order:**

| Layer | What it holds |
|---|---|
| `land` | the whole window minus the sea |
| `marsh` | floodplain |
| `farm` / `woods` | farm tracts and woodlots, kept off floodplain |
| `yard` | developed tracts on buildable land |
| `pavement` | one convex capsule per road segment, plus cul-de-sac bulbs |
| `block` | downtown and village blocks |
| `park` | empty |
| `stream` | river and creek capsules |
| `pond` | stormwater ponds |

**Roads (`markings.centerlines`):** built roads only. Highways are 24 m,
arterials 14 m, local streets 9 m and downtown streets 12 m. Proposed
highways are left out.

**Volumes:**
- Downtown and village buildings: 60–80% of their lot. Downtown heights fall
  off from the centre and are **illustrative**.
- One house per drawn lot: 7 × 11 m pre-war, 9 × 13 m later, 7 m back from
  the right-of-way, 1 or 2 storeys by era (approximate shares).

**Parcels:** one per neighbourhood (`N…`, i.e. one per subdivided tract), one
per farm tract (`F…`), and one per downtown or village lot (`D…` / `T…`).

**Trees:** woodlots on a jittered grid (capped at ~60k in total), plus one
street tree per ~2 houses.

**Seed 3 at 10 km:** 6.7 MB, made of:
- 21,748 volumes, of which 17,872 are houses;
- 4,204 parcels, including 115 neighbourhoods;
- 36,821 trees;
- 1,491 centerlines.

**Known gaps:**
- Bridges are drawn as pavement under the stream layer.
- Yard edges follow a 20 m raster.
- Proposed-freeway right-of-way shows as bare land strips through
  subdivisions. A real reserved corridor looks like that.
