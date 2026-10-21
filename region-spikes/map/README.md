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

### Default export: the owner's final spec

```bash
node region-spikes/map/export-unreal.mjs 3    # -> out/city-region-3.json (6 x 6 km)
```

**Downtown footprint (owner addendum):** 1.5 × 1.0 km, a small-city core on the coast, instead of the 2.6 × 1.5 km island city. The two most central lots become the ~11-floor towers. Villages shrink with it to 2–4 × 2–3 blocks (sqrt of the 38% area ratio, a side), and the river-crossing village stands on one bank (bankTowns) instead of losing its blocks to the river. These are generator options (core, townBlocks, bankTowns), so the SVG maps are unchanged.

**Region:** 6 × 6 km. `--km 10` writes `…-10km.json`.

**Downtown and villages: low-rise.**
- Downtown is mostly 1–4 floors, with a handful at 5–8 and at most two
  towers of 10–12 floors. Villages are 1–3 floors.
- Footprints cover 50–70% of the lot.
- ~15% of downtown lots and ~10% of village lots are surface parking: a
  `land` parcel paved over.
- `--dense` restores the first skyline.

**Homes: "a lot less housing".** The generator grows the region as usual;
then only these neighbourhoods stay built:
- the pre-war ring nearest downtown;
- the two post-war subdivisions nearest the first interstate (at least
  150 houses each, so not a sliver cut off by the freeway);
- the one recent subdivision nearest downtown.

All of this sits within a 2,500-house budget (the owner's target is
1,500–2,500). Every other subdivided tract goes back to farmland, so the
region has room to grow. The budget is a design call (an early point in the
region's history), not a fact. In the game the growth sim takes over from
here.

**Other suburb options:**
- `--thin-suburbs`: a third of the urbanised KNOB, growth from the towns too.
- `--full-suburbs`: the SVG maps' growth.

**Seed 3, 6 km (default):** 1.4 MB, made of:
- 2,805 volumes, of which 1,722 are houses;
- 11 neighbourhoods (mostly small pre-war tracts beside downtown, plus post-war and recent ones near the first highway);
- 1,409 parcels, 193 of them parking or vacant;
- 16,240 trees;
- 202 centerlines;
- floor mix, downtown and villages together: 1,066 buildings at 1–4 floors, 15 at 5–8, 2 towers at 11.

**Known:** the small core sits on the shore west of the river mouth, so the river and creeks no longer run through it.

### Current default: one gradient from the centre (owner, after the 6 km render)

The owner asked for a city that is "most built up" at the centre, then thins
"into less dense buildings with more vacant lots, then homes and farms
starting to surround it, like a real city".

`export-unreal.mjs 3` now builds a single gradient by distance r from a
centre near the waterfront. The distance has noise added, so the rings are
not circles, and it is shortened by 25% within 600 m of the first highway.
The band edges and shares are the owner's spec, not measurements.

| r | What is there |
|---|---|
| < 400 m | 4–8 floors, footprints 70–85%, ~3% gaps; the two most central lots are the 11 and 12 floor towers |
| 400–900 m | 2–4 floors, footprints 55–70%, ~15% surface parking |
| 900–1,650 m | 1–2 floor shops and small apartments with ~30% vacant lots. Blocks turn into pre-war house blocks (40 ft lots) the further out they are. The city's edge is ragged: noisy radius, one bank only. |
| beyond | neighbourhoods laid out on the survey tracts: pre-war near, post-war further out and along the highway |

**How the outer neighbourhoods grow:**
- Houses are built in order of distance, and only within 200 m of what is
  already built. Each subdivision therefore fills in from the city side,
  phase by phase, and nothing stands alone in the fields.
- About 6% of lots are left vacant.
- Growth stops at about 2,000 homes in all.

**Generator options used** (`region.mjs`; the SVG maps are unchanged):
- `gradientCore`: a 3.4 × 1.95 km grid, kept within a noisy 1,650 m of the
  centre and only on the centre's bank. Creeks are bent round the city and
  follow its edge to the river.
- `onlyRiverTown` and `bankTowns`: a single small village upriver, on one
  bank.

**Seed 3, 6 km:** 1.7 MB, made of:
- 3,940 volumes;
- 2,014 houses: 1,659 in the inner house blocks and 355 in the outer
  neighbourhoods;
- 7 neighbourhood parcels;
- 2,425 parcels in all, including 177 parking lots, 205 vacant lots, 110
  farm or woodlot tracts and 96 village lots;
- 10,404 trees;
- 126 centerlines.

Floor mix: 866 buildings at 1–2 floors, 732 at 3–4, 326 at 5–8, plus the
11- and 12-floor towers.

**Flags:**
- `--few-suburbs`: the previous default (1.5 × 1.0 km core, a few chosen
  neighbourhoods).
- `--thin-suburbs`, `--full-suburbs`, `--dense`: as described above.

**Seed-specific:** on seed 3 the creek floodplains to the north and east box
the city in, so most homes are in the inner house blocks. On a drier site
the outer ring would be wider.

### The gradient tells a story (owner: "not perfectly uniform ... it should tell a story and be realistic")

Density now follows history and access, not only distance. `storyPrep()` in
`export-unreal.mjs` builds a "story distance". It is distance from the
centre, made shorter along the old country roads (×0.72) and near the first
interstate (×0.85). A waterfront term makes it shorter still near the water
and longer on the far side. Every band and choice then reads from it.

**Each pattern and the era it comes from:**

| Pattern | Era and cause |
|---|---|
| Fingers of development along the old roads and the highway | streetcar and wagon routes first, then the interstate |
| Oldest, densest fabric by the water; inner houses dated 1890s near the water to 1930s further in | the town began at its landing |
| Old main street: the old road leaving the core inland, lined with narrow 2–3 floor shopfronts (1880–1930), few gaps | 19th-century main street |
| Industrial strip along the river: warehouses (cls `industrial`) and rail yards (1890–1945) | railway and mill era |
| Its outer end declined: ~45% of those lots are vacant ("former mill") | post-1960s decline |
| Freeway through the old city: the blocks it crosses are gone, the land left cleared | interstate era, urban renewal |
| Interchange strip: about 4–8 big boxes behind parking lots at the first interchange out of the city (1985–2015) | late 20th century |
| Two leapfrog subdivisions (cul-de-sacs, 2000s) out by the highway and old roads, past a farm and woodlot still holding out | recent |

The strengths (0.72, 0.85, the waterfront term, the vacancy shares) are
shape parameters chosen by eye for this spike. They are not calibrated.

**Seed 3, 6 km:** 1.8 MB, made of:
- 4,119 volumes;
- 1,926 houses (1,104 in the inner house blocks);
- 2,742 parcels, including:
  - 173 main-street lots,
  - 37 warehouses,
  - 22 vacant former-mill lots,
  - 4 strip stores,
  - 156 parking lots and 278 vacant lots,
  - 84 farm tracts,
  - 8 neighbourhoods, two of them 2000s leapfrog subdivisions;
- 199 centerlines.

Floor mix:
- 1,069 buildings at 1–2 floors;
- 752 at 3–4;
- 333 at 5–8;
- 2 towers;
- 37 warehouses.

### Final pass: smaller downtown, pockets out in the region, forest belt

Owner feedback on the gradient render:
- "Downtown seems about twice as large as it should be."
- "City looks a bit too big. Sprinkle in some existing retail strips,
  distribution centers, and other small pockets."
- "Forests should cover the BACK of the map … a continuous forest belt, with
  woodlots sprinkled through the farmland in the middle."

**Seed 3, 6 km, the default export** (`out/city-region-3.json`): 2.0 MB.

| Item | Count |
|---|---|
| Volumes | 2,952 |
| Houses | 1,470 (501 in the inner house blocks) |
| Parcels | 1,821 |
| Neighbourhood parcels | 11 |
| Main-street lots | 174 |
| Waterfront warehouses | 11, plus 5 vacant former-mill lots |
| Interchange big boxes | 4 |
| Pockets | 9 (see below) |
| Parking lots | 101 |
| Vacant lots | 144 |
| Farm or woodlot tracts | 81 |
| Village lots | 96 |
| Trees | 51,605 (under the 60k cap) |
| Centerlines | 201 |

The 9 pockets: 2 distribution centres, 3 strip centres, a gas station with a
diner, a grain elevator, a business park, and a church with a school.

Floor mix: 731 buildings at 1–2 floors, 533 at 3–4, 199 at 5–8, 2 towers,
and 17 industrial buildings.

## Generator rules for Phase 1

These are all the layout rules and numbers the spike ended with, so the
engine's Phase 1 generator can be built from them.

**Status labels used below:**
- **[S]** sourced, or a measured US norm (approximate);
- **[O]** an owner design decision;
- **[K]** a spike shape parameter chosen by eye, to be calibrated or replaced
  by the growth sim.

Code: `region.mjs` (land, roads, tracts, plats) and `export-unreal.mjs`
(`storyPrep`, `placePockets`, `gradientLots`, `gradientNeighbourhoods`).

### 1. Window and land

**Window**
- 6 × 6 km [O].
- Generated in one frame: river runs top to bottom, sea at the bottom. Then
  rotated by k·90°, so the survey stays cardinal.

**River**
- Width 100–250 m [S].
- Meander wavelength 10–14 × width [S], amplitude about wavelength/4 [K].
- Plus a valley-scale bend of 250–800 m amplitude over 0.9–1.6 × the window
  [K].

**Floodplain**
- River half-width plus 150–700 m, noisy [S]. Unbuildable.
- 1–3 creeks, 8–20 m wide, each with a 60–150 m flood band [S].
- Coastal flood band 100–250 m [S].
- Coast on half the seeds; the shoreline sits 80–88% of the way down the
  window, ±150–450 m.

**Survey grid**
- US Public Land Survey: 1-mile sections [S].
- Tracts are aliquot parts: 640, 160, 80 and 40 ac [S].
- 66 ft section-line roads, broken at water and settlements [S].

**Forest** [O, K]
- A continuous belt along the window edges away from the coast.
- Width 600 + 700·noise m (noise scale 700 m).
- Never within 2.2 km of the city centre or 900 m of the shore.
- Cut out of developed land, water and freeway right-of-way.

**Woodlots**
- About 8% of farm tracts, plus about 6% more in the middle farmland [K].

### 2. Old settlements

**Downtown site**
- Chosen at small-city size: 1.6 × 1.0 km, long side on the shore. On a coast
  it sits beside the river mouth; inland, on one bank of a straight reach.
  The driest candidate wins.
- The street grid is then laid out larger, 4.6 × 2.6 km, growing inland from
  that waterfront.
- Blocks: 80 × 240 m pitch with 18 m streets [S, Manhattan-type].
- **Centre:** inset 450 m from the waterfront edge.

**Creeks**
- A creek inside the city's radius is pushed out to its edge, and follows it
  round to the river.

**One bank**
- Only blocks reachable from the centre over dry land are kept.

**Villages**
- One river-crossing village, upriver, on one bank [O].
- 2–4 × 2–3 blocks of 92–120 m pitch [S, from `island.mjs`], 15 m lots,
  1–3 floors, about 10% parking.
- With more villages (the SVG maps), spacing is at least 2 mi and there is
  about one per 3.5 mi square [S].

### 3. Roads

**Old country roads**
- A* over a noise cost. Floodplain ×2.5. Water ×60, except where a
  settlement bridges it. Existing road ×0.35, so the network merges.
- Downtown → 4–5 radials to the edges; village → downtown → edge;
  village ↔ village.

**Highway master plan**
- **H1 interstate:** skirts downtown's landward side. Built 1958–74 [S].
- **H2 spur:** from H1 at downtown. Built 1975–95, from the downtown end;
  60% of the time stopped short with the rest PROPOSED.
- **H3 bypass:** an arc at 0.42–0.55 × the window from downtown. All
  PROPOSED, planned 2029–46 [S].
- Later freeways avoid H1's flanks: cost ×6 within 350 m.
- **Interchanges:** at arterial crossings, at least 1 mile apart [S].
  System interchanges where freeways cross.

**Road widths**
- Highway 24 m, arterial 14 m, local 9 m, downtown 12 m [O, contract].

**Freeway cut** [S, urban renewal]
- Blocks within 20 m of built freeway pavement are cleared.
- The land stays cleared; it is not farmed.

### 4. Density: one gradient, bent by history

**Story distance** [K]
- rS = |p − centre| × f, where f is the product of:
  - noise: 0.82 + 0.36 × noise (scale 450 m);
  - old roads: ×0.72 within 120 m of an old road, otherwise ×0.85 within
    450 m of the built interstate;
  - waterfront: ×(0.85 + 0.3 × min(1, waterDist / 1,800 m)).
- **Rings in rS** [O]: core < 280 m, mid < 640 m, city < 1,000 m.
- Blocks with rS beyond the city edge are dropped, except along the main
  street.

| Ring | Floors | Footprint | Gaps | Classes |
|---|---|---|---|---|
| Core (< 280 m) | 4–8 | 70–85% | 3% | 60% office, 20% multifamily, 20% retail |
| Mid (280–640 m) | 2–4 | 55–70% | 15% surface parking | 40% retail, 40% multifamily, 20% office |
| Edge (640–1,000 m) | 1–2 | 50–65% | 30% vacant | shops and small apartments |

- **Core:** the two most central lots are the 11 and 12 floor towers [O].
- **Edge:** a block becomes a house block with probability
  ((rS − 640) / 360)^0.8.
- **House blocks** [S]: 40 × 110 ft lots, 12% vacant, a 7 × 11 m house set
  4 m back, 60% two storeys. Built 1890 near the water to about 1935 further
  away.
- **Lot widths:** core and mid 25 m, edge 20 m, main street 15 m,
  waterfront 45 m [K].

**Story features (era)**
- **Old main street** (1880–1930): the old road leaving the core most
  directly inland, 70 m either side, out to 1.4 km. 2–3 floors, 80–90% of
  the lot, 5% vacant, 70% retail [O, K].
- **River industry** (1890–1945): within 260 m of the river, more than 250 m
  from the centre. cls `industrial`, 7.5–11 m tall, 60–80% of the lot.
  Vacant or rail yard: 20% normally, 45% past the mid ring, where it
  declined after the 1960s [O, K].
- **Interchange strip** (1985–2015): at the first interchange 0.9–2.8 km out.
  Up to 8 big boxes of 50–90 × 35–60 m, 6.5 m tall, behind 45 m parking
  lots, 140–340 m from the ramp [K].
- **Pockets**, each against an arterial past its right-of-way, at least
  500 m apart [O, K]:

| Pocket | Count | Where | Size | Era |
|---|---|---|---|---|
| Distribution centre | 2–3 | within 900 m of an interchange | 180–260 × 90–130 m, 10–15 m tall, 50 m truck court | 1990–2020 |
| Strip centre | 3–4 | on old roads or the highway, rS 1.1–2.8 km | 80–140 m long, 22 m deep, 35 m parking in front | 1960–2005 |
| Gas station and diner | 1 | at a crossroads, rS > 1.8 km | | 1935–65 |
| Grain elevator | 1 | rS > 2.2 km, off the highway | 3 silos ~35 m + shed | 1910–50 |
| Business park | 1 | | 3 offices of 2–3 floors | 1975–2000 |
| Church and school | 1 | | with a playing field (park) | 1900–60 |

### 5. Neighbourhoods

- **Candidates:** every survey tract on the city's bank with at least 50%
  buildable land and rS < 3.5 km.
- **Template by story distance:** pre-war grid if rS < 2 km and away from
  the highway; post-war curving loops otherwise, including along the
  highway [O].

**Lots** [S]
- Pre-war 40 × 110 ft.
- Post-war 65 × 115 ft.
- Recent 70 × 118 ft, on cul-de-sacs at most 600 ft long with 45 ft bulbs,
  plus a pond of 4% of the tract.

**Houses** [O, S]
- 7 × 11 m pre-war, 9 × 13 m otherwise, 7 m setback.
- Share with two storeys: 60% pre-war, 25% post-war, 70% recent.

**Growth**
- Houses are built in rS order, each within 200 m of the city or of
  existing houses, so subdivisions fill in from the city side phase by
  phase.
- 6% of lots are left vacant.
- Outer budget 600 houses [O, about 2,000 in all including the inner
  blocks].
- A tract with fewer than 20 houses stays a farm. The unbuilt remainder of a
  tract stays a field.

**Leapfrog** (recent, 1995–2020) [O, K]
- Up to 2 tracts beside the highway or an old road.
- 300–1,600 m past the built front, at least 450 m from any built house.
- At least 80 and at most 250 houses each.
- The farm between them and the city is the holdout.

### 6. Eras, as the yearBuilt values tell them

| Years | What was built |
|---|---|
| 1860–1940 | villages |
| 1870s–1920 | the waterfront core |
| 1880–1930 | main street |
| 1890–1945 | mills and rail yards |
| 1890–1935 | inner house blocks, older by the water |
| 1905–1939 | pre-war subdivisions |
| 1910–1950 | grain elevator |
| 1935–1965 | crossroads gas station and diner |
| 1946–1975 | post-war subdivisions along the interstate |
| 1958–1974 | interstate opened |
| 1960s | freeway cut through the old city |
| 1960–2005 | strip centres |
| 1975–2000 | business park |
| 1985–2015 | interchange big boxes |
| 1990–2020 | distribution centres |
| 1995–2020 | leapfrog subdivisions |
| 2029–2046 | proposed bypass |

Decline after the 1960s shows as vacancy at the outer end of the industrial
strip and the edge ring.

**Not decided by the spike** (the growth sim should own these):
- how far the city has grown (the house budgets);
- the story-distance strengths;
- every vacancy share.
