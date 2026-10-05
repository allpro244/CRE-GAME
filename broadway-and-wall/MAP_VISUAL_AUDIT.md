# MAP VISUAL AUDIT — October 2026

A ground-up look at what the map actually puts on screen, taken before the
overhaul on branch `claude/broadway-wall-map-overhaul-tyf2pt`. Screenshots were
taken with Playwright against the dev server on three generated islands
(seed 1 "Young town", seed 7 "Capital", seed 42 "Established" at Metropolis
size) and Manhattan below Houston, at island / district / street zoom, by day
and by night, in January (the month every campaign opens in) and in July, with
a selection, owned buildings and the Owners lens up.

Ranked by how much each one hurts the picture. Each item names the cause in the
code, because every one of them turned out to be a specific number or a
specific missing piece rather than a matter of taste.

## 1 · The light made every building the same building

The sun never rose above 31°, and in January it stood at 12° with an ember-red
colour (`SUN_EL_MID 21.5 ± 9.5`, `SUN_COL_WINTER [1.62, 0.96, 0.41]`). At
12° every shadow is five times the height of what casts it, so from the play
camera the streets were mostly shade, and every lit wall in town was the same
raking amber. On top of that `grade()` pushed chroma ×1.40 after ACES, so the
amber went to poster paint. The facade shader has 180 families with their own
stones, bricks and glass — none of it survived the light. **This is the main
reason "all the buildings look alike".**

## 2 · January is white

Every campaign opens in January, and January's weather is often snow: the snow
floor put two-thirds cover on every flat roof at any flurry, every vacant lot
went white, the harbour shoal iced into a white ring, and roofs, yards and lots
became one value. `setMonth` also never cleared the weather, so a probe that
jumped to July kept January's snow on the roofs.

## 3 · No value hierarchy on the ground

The block fill (the yards behind and between buildings) was `#e8e3d5` — paper
white, the same value as a snow roof or a membrane roof — so buildings did not
separate from their own lots. Downtown vacant lots were parking lots with cars
parked on pale gravel. Lot lines were drawn at 80% opacity on every parcel and
ruled the whole town like graph paper.

## 4 · Streets were pixels, not metres

* The sidewalk was a screen-pixel stroke **centred on the lot line** — half of
  it lay on the lots — and its width came from the zoom level, not from the
  street: a 9 m lane and a 30 m avenue wore the same band.
* The curb was a pixel line with a pixel offset.
* Every street, including 9 m residential lanes, carried a yellow centre dash.
* Crosswalks were solid 3.8 × 9 m bars at every gridded corner whatever the
  street's width, laid alongside the block (where cars park) rather than
  across the intersection.
* The shore road and the district seams were pixel strokes too.

## 5 · Rivers were dark cracks

A creek was a flat near-black ribbon painted flush with the pavement (it used
the park pond's shader, whose water is deliberately the darkest thing in a
park): no banks, no depth, and a bare pale strip either side where the lots had
been cut back from it, which read as a dry riverbed.

## 6 · There were no bridges

The generator lays its crossings by spacing along the stream, as dry gaps in
the ribbon. They connect to no street (measured: the nearest street centre line
is 17–21 m from most of them). The map drew a grey rectangle in each gap and the
3D layer stood two 0.5 × 11 m parapet slabs on bare ground — the black boards
by the creek. The water simply stopped in a rounded cap either side.

## 7 · Towers shimmered

The facade's window grid only began to average out once a window was 8.7 px
wide and finished at 2 px, so the whole mid-distance band of a tall town drew
grids at 3–5 px a bay and every finer detail (mullions, frit, fluting) below a
pixel: a speckled moiré on every tower at the play camera.

## 8 · A winter forest of black sticks

Bare street trees shrank to a third of their crown and went near-black, so in
any month from November to April the pavements were a bed of dark pins (with
the dark pedestrians and lamp posts adding to it).

## 9 · Coast halo and an over-saturated sea

A white ring around the island: the pale esplanade, the wet-edge band, the
iced shoal in a snow month and the cyan shoal water all stacked on one line.
The open sea, through the ×1.40 chroma, was a saturated cobalt.

## 10 · Smaller things

* Plazas and squares are pale grey ovals with nothing in them but people.
* Night is good — lit floors, lamp pools, beacons — but the creeks go black.
* Owned and selected buildings read correctly (gilt parapet, gold deck margin,
  ground halo); keep them that way.

## What a strong city map does that this did not

A good city sim (Cities: Skylines II, SimCity 4's hand-painted isometric) or a
polished map game reads in **three values** before it reads in colour: dark
roofs and asphalt, mid walls and yards, light footways and kerbs. Streets are
legible from altitude because their two edges are the brightest lines on the
ground. Water sits below the land in a channel you can see the sides of, and a
bridge is a structure with a deck, a parapet and something holding it up. The
light is a mid-afternoon sun — long enough shadows to model the massing, short
enough that the streets are lit — and colour is honest rather than graded.

---

# WHAT CHANGED

Same ranking. Every change is in `src/map/` or in the context layer citygen
hands the map; no engine file is touched, and the citygen additions draw no
`rand()`, so parcels and `buildings3d` hash identically to before (checked on
four towns) and `pnpm check` reports 0 of 39 metrics moved.

1. **Light.** `SUN_EL_MID 35 ± 11` (24° in December, 46° in June), a winter
   sun of `[1.56, 1.15, 0.70]`, and `grade()` chroma ×1.16. Shadows still
   model the massing; the streets are lit; the facade families read as what
   they are made of.
2. **January.** A snow month lays a dusting (`0.16 + 0.56·p`) rather than
   two-thirds cover; the shoal's ice skin is half as strong.
3. **Ground.** Yards `#c4c0b2` under footways `#d2cfc6` over asphalt
   `#55575a` — three values, dark to light. Downtown vacant lots are striped
   asphalt parking (stalls 2.6 × 5.2 m along the lot's long side); gravel lots
   sit a step under the footway. Lot lines at 12-42% instead of 30-80%.
   Market squares are granite setts instead of park gravel. The esplanade is
   worn setts, not chalk.
4. **Streets in metres.** citygen measures each block face's half-street (cell
   edge to kerb line) and emits: a footway ring outside the kerb line 2-5 m
   wide (0.4 × the half-street) with a rounded kerb at convex corners; the
   curb as its outer edge; centre lines tagged by width (none under 13 m, a
   dashed line on working streets, the double yellow at 21 m+); zebras at
   every gridded corner, along the footway and across the carriageway that
   corner faces, kerb to centre line. `style.ts metres()` draws all of it in
   metres at every zoom (exponential-2 ramp, with a pixel floor for the fine
   marks).
5. **Creeks.** `buildRiver` sinks the water 1.35 m into a channel. Canals get
   a dressed stone wall and coping, creeks a riprap slope into the water. The
   near bank is solved with a depth-only copy of each wall drawn ahead of the
   water, so MapLibre's ground shows at the lip exactly where land would. The
   water uses the pond shader's river branch: a clearer green-blue with a
   gravel margin and streaks down the flow. The clearance strip the lots were
   cut back to is a grass bank.
6. **Bridges.** Each generator crossing floods its gap so the creek runs
   through, and gets a structure: a stone arch footbridge (humped deck,
   parapets with coping, spandrel walls, an arch barrel over the water,
   abutments) spanning the green corridor, or a flat road deck the width of the
   boulevard where one crosses. The two parapet slabs on dry ground are gone.
7. **Towers.** The facade dissolve runs from ~12 px to ~2.6 px a bay.
8. **Winter trees** keep 70% of the crown in grey-brown twig.
9. **Coast.** The shoal is a step greener and darker, the wet edge at 0.22,
   the esplanade a mid tone.
10. **Buildings by data.** On top of the 180 families, two new readings:
    - *Condition*: the engine's own condition index (`condIdxOf` — the
      holding's where it is yours, the age reading elsewhere) is packed above
      the highlight in the state texture and drawn as weather — greyer,
      darker, soot runs under each bay heavier toward the street, and boarded
      windows on genuinely neglected deeds; a refit is a touch cleaner.
    - *The base*: masonry stands on a granite water table; a glass tower on a
      double-height lobby of dark glass; a shed comes straight down to the
      slab. Shopfronts keep their glass to the pavement.

# SECOND PASS — what the first pass left

A second look at the after images, four towns, four seasons and night.

1. **Map names did not fade or stack.** The zoom fade wrote opacity on the
   MapLibre marker element, and MapLibre rewrites that element's opacity on
   every move for its own occlusion test, so the fade had never worked:
   district names stood over the street at the dive, and a station named for
   its road and a park walk of the same name said "Hartby Walk" twice, forty
   pixels apart. The fade now writes the label's own inner span, and after
   each move the labels are placed in priority order (district, station,
   civic, park, water) and held back when they overlap one already placed or
   repeat a name already showing nearby. The halo is a tight 1 px edge plus
   the glow, the inks a step darker, and after dusk the names turn pale on a
   dark halo instead of wearing a paper fog over the lit city.
2. **Creeks went black at night.** The channel water was lit only by sun and
   sky. It now carries the town's lights: warm streaks stretched along the
   view bearing, strongest at the banks the lamps stand on, over a floor of
   sky glow.
3. **One autumn colour.** Every canopy turned the same gold at the same
   moment. Each tree now turns by its own seed: about a quarter red, a quarter
   orange, a third gold, the rest late turners still mostly green. In April
   one tree in five — the ornamental pears and cherries — flowers white or
   pale pink before the rest leaf out.
4. **No weather in a fair sky.** Fair days now carry drifting cumulus
   shadows: value noise in world metres, inside `sunVis`, so a wall, a roof,
   a tree and the street under them share each patch. Gone under a closed
   overcast, where there is no sun to cut a shadow out of.
5. **Vacant lots in mid-town were blank slabs.** Two in five are now let as
   contractors' yards or cash car parks, with a few cars loosely squared to
   the frontage.
6. **Canals and slips had nothing moored in them.** Launches and workboats
   lie along the walls, never under a bridge, only where a fairway is left.
7. **Cars were one body.** Saloons, a fifth tall utility bodies, and short
   city cars. Parked cars and standing people shrink out past ~2 km, where
   they were grain on the island view rather than objects.

Looked at and left: roofs already carry a full plant kit by type and era, and
there are already three tree species.

# THIRD PASS

1. **The tower speckle, found.** A fine blue-grey salt on tower faces at the
   street camera, densest where a face runs away at a grazing angle. Not the
   shadow map (four times the bias changed nothing), not the occlusion or
   contact passes, not the interiors: a debug bisection of the wall shader
   put it in the occupancy block. The vacant/let floor bands are rolled with
   `hash()` off `vRand` — one number per building, identical at every vertex
   — but an interpolated varying holds that value plus a few ulps of
   rounding that differ pixel to pixel, and `sin(x) * 43758` turns ulps into
   a different band, let or vacant, at every pixel. `vRand` and `vVar` are
   now `flat` varyings (WebGL2), so every pixel gets the exact value the CPU
   wrote: the noise is gone and every building keeps exactly its look.
2. **Still water freezes.** Ponds and lakes are ice in the dead of winter —
   pale, matte, snow-dusted, darker new ice out in the middle — read off the
   season, not the day's snowfall. Running creeks stay open.
3. **Landfill stands on a seawall.** A park laid past the coastline (the
   Battery) was a lawn floating over the harbour with no edge. Each run of
   its ring that lies over the water now gets a coping and a battered stone
   face stepping down into the sea.

# THE REAL-GEOMETRY PREVIEW (src/map/real/RealCity.ts)

A second renderer for the same game, off by default behind Settings →
Display → "New 3D city (preview)" (`store.realRender`, localStorage
`bw:render-real`). It answers every call MapView makes of ThreeBuildings, so
picking, labels, badges, panels and the engine are untouched; turning it off
puts the classic map back. What it draws:

- **Buildings as geometry.** Walls carry world-scale facade textures per
  family — brick, stone, glass curtain wall, modern panel, industrial,
  shopfront storey, blank civic stone — with roughness/metalness, normal
  relief for the window reveals and lit-room emission after dark. Cornices,
  string courses, parapets and dark lobby bases are modelled; old low brick
  rows take gabled roofs; roofs carry bulkheads, water tanks and plant.
- **Light.** Stock PBR materials, a sun with a view-fitted soft shadow map,
  sky fill and an environment for the glass, ACES tone mapping; seasons,
  snow on roofs, dusk and night (a veil over MapLibre's ground, lit windows,
  glowing street lamps).
- **Ground.** Raised 15 cm footways in paving flags with granite kerb faces,
  zebra bars at every gridded corner, car parks on downtown vacant lots and
  gravel elsewhere, stone footbridges over the creek gaps, a glossy veneer
  on the sea.
- **Life.** Street and park trees by season, parked cars, moving traffic and
  pedestrians, moored launches and offshore ferries, park fountains and
  columns, tower cranes slewing over every development under way.
- **The game on it.** Gold roofs on holdings, the selected building glowing,
  lenses on the roofs, tints, condition as soot and greying, developments
  and demolitions.

Not yet in it: the classic map's lit-vacancy floor bands, retail shopfront
state, civic works and the sunk creek channel. Frame rate has not been
measured on a GPU (this container has none); small props drop out past
~2.6 km of camera distance.

# STREET PLAN 2 (built, not yet the default)

The old quarters of the generated towns were cut block by block
(`splitCells`): every block split on its own at a jittered angle, so no street
ran through a junction and the district edges left a field of wedges and
triangles — "shattered glass" on the plat. Plan 2 (`streetsFirst`) lays the
long streets across the whole district first, parallel to its longest
boundary street, then cuts each strip crosswise: continuous streets,
four-sided blocks, offset T-junctions where the lanes meet the high street.
Side by side (plan 1 left, plan 2 right) in `docs/map-overhaul/plan2-*.jpg`;
`node tools/plat-svg.mjs <seed> --plan 2` draws any seed.

It is wired end to end — `makeCity(…, { planV })`, `GameState.cityPlan`
recorded on every new save, an old save rebuilt as plan 1, a plan mismatch
forcing a town rebuild on load — but `CITY_PLAN` stays 1, and today's towns
hash byte-identical. Measured on the reference town, plan 2's regular blocks
carry 5-14% more floor area on the same lots, and that stock meets the same
opening demand: the economy owed no construction starts for eight years where
plan 1 builds from year one. Turning it on is an economy decision — the full
report/stress tiers and a deliberate baseline move — not a map change.
