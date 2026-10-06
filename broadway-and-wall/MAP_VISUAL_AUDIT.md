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

# STREET PLAN 2 (the default for new towns)

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
forcing a town rebuild on load — and `CITY_PLAN` is now 2, so every new run
gets the new streets while every existing save keeps the town it was played
in. The baseline moved 20 of 39 metrics on the single reference town, but a
control that changed nothing except one extra draw from the city dice moved
22 of 39 by as much or more, so that town's moves are draw noise. Across 12
seeds the real effect is about +4% floor area on the same lots and 20-30%
fewer construction starts in the first decade (the denser stock meets the
same opening demand). `pnpm gate` passes.

# ROOFSCAPES (real-geometry preview)

From above — and this game is played from above — a city is mostly roof,
and every flat roof was the same pale grey slab with one box on it. Now:

- **What the roof is made of.** Pre-war masonry carries tar (dark) or gravel
  (warm), with the odd later silver coat; post-war slabs and shops a paler
  ballast or white membrane; glass towers white membrane; sheds galvanised
  or dark sheet; gables slate or red-brown shingle; one modern roof in
  sixteen is planted. Each building draws its own shade within its kind, so
  a block reads as a patchwork. A roofing texture (strips with lapped seams,
  patching, grit, 16 m a repeat) sits under the colour.
- **Parapets.** Every flat crown is fenced by a knee-high wall with an inside
  face and a coping — a metre behind a masonry cornice, half that on glass —
  and it throws a thin shadow on the deck.
- **Plant by what the building is.** Pre-war masonry and lofts between about
  six and thirty storeys take a wooden water tank on legs (one, or two on a
  big roof), because city mains only lift water about six storeys; stair
  bulkheads sit near the middle; modern, glass and shop roofs carry up to
  seven condensers by area; low sheds carry rows of skylights along their
  long side. Everything is placed inside the footprint with a margin.

Gold roofs (yours), lenses and snow still override the roof colour exactly as
before; the colour variety lives in the roofs' base vertex colours.

Cost, measured in this container's software renderer (SwiftShader, which
pays for every triangle and pixel on the CPU) on the giant town: 6.0 s → 6.6 s
a frame at the island view, 7.4 s → 8.0 s at district zoom, before the
parapets' never-seen undersides were dropped. A GPU pays a small fraction of
that; the classic renderer is untouched. Before/after in
`docs/map-overhaul/p4-roofs-*.jpg`.

# DEPTH, TREES AND GROUND (real-geometry preview)

Looked at critically, three things kept the preview reading as a model on a
table rather than a city, and roofs were not the biggest of them:

- **No air.** A block four kilometres off was as crisp and contrasty as the
  one at your feet; the classic renderer had aerial perspective and the real
  one never got it. Every material now fades toward the haze colour with
  distance from the eye — the same #bdd1e6 MapLibre fogs its ground and sky
  to, mixed in display sRGB where that colour is defined — and a sheet over
  MapLibre's ground carries the same fade so a far street hazes with the
  buildings on it. The fade is scaled to the view (it starts at a third of
  the camera distance and caps at about 55% two and a half distances out),
  greys under overcast, warms at golden hour and turns to a blue-black murk
  at night. Shadows thin out with distance rather than turning hazy.
- **Crumpled-paper trees.** Flat-shaded icosahedra caught the sun facet by
  facet. Crowns are now four lumps with normals leaning out from each lump's
  centre, a little irregularity, and a canopy that darkens toward its
  underside — soft, rounded trees for the same triangle budget class.
- **Ground.** The footways were a new-concrete cream that outshone the
  buildings; they are a step darker and cooler with weathering. The foot of
  every wall darkens over its first 3.5 m, where the street and the
  buildings opposite block the sky, so buildings stand on the ground instead
  of floating over it.

`docs/map-overhaul/p5-*-before-after.jpg`.

# NO NIGHT; TOWERS BY ERA; WATER THAT MOVES

- **No night.** The owner's call: "we don't need a night mode, that's
  pointless." The dusk cycle that ran while Play was on and the blue-hour
  photo frame are gone; the map is always the calibrated afternoon (MapView
  pins `setDayPhase(0)` for both renderers). The month still moves the sun
  and the seasons.
- **Towers by era.** Every post-1958 office tower wore the one glass
  elevation. Four more, assigned by when the tower went up: 1960s ribbon
  windows between white aluminium spandrels and a plain penthouse box;
  1960s-70s exposed concrete grids with deep punched windows (also on the
  post-war apartment slabs); 1970s-80s bronze curtain walls; 1990s-2000s
  blue-green reflective glass. Glass towers carry a recessed crown, and one
  in three steps back twice before its mast.
- **Water.** The harbour, the canals and the park ponds carry a tileable
  ripple normal map (crossing wave trains, one dominant wind) drifting about
  half a metre a second while the city animates, so the sea catches the sun
  and the sky instead of lying flat. `docs/map-overhaul/p6-*.jpg`.

# THE WEDDING CAKE

The pre-war towers were straight extrusions in one cream-striped elevation,
the most repeated thing downtown. Under the 1916 zoning resolution a tower
could rise straight only so far before stepping back from the street, and the
pre-war skyline is those setbacks. Three in four pre-war masonry towers over
70 m now rise from a full-lot base to a terrace at half to two-thirds of their
height, step in to 84%, again to 68% for the shaft, each terrace with its
cornice and parapet, the crown or spire on the slim top — same height, same
deed. A second 1920s-30s elevation joins the cream deco: tan brick with tall,
narrow, vertically linked windows and dark spandrels (assigned 35/30/35 with
deco and stone). `docs/map-overhaul/p7-setback-tower.jpg`.

**What the glass sees.** The curtain walls and the water reflected a studio
light box (RoomEnvironment). They now reflect a sky built for them — deep
blue overhead paling to a warm horizon, a band of hazy city at eye level, the
ground below, and the sun where the key light is — prefiltered once. Only the
glass families, the ribbon windows and the water take it: given to every
material it tinted the roofs and trees blue, because matte surfaces take
their ambient light from the same map, so they keep the neutral light box.
`docs/map-overhaul/p7-sky-glass.jpg`.

# WHERE A YOUNG TOWN IS EMPTY (street plan 3)

The owner's ask: in a younger town, the unbuilt parcels should be on certain
outskirts and neighbourhoods, not an equal share in the middle of the city.
Measured first: the old rule rolled each lot on its own against a mild edge
gradient, and the young presets' vacancy multiplier (2-2.5x) left even
downtown half empty — the gaps were salt and pepper over the whole plat.

Plan 3 gives every block a settlement order (distance from the founding
point, ground heat, corridor access, a later-platted district's lag, a
block's luck) and makes a lot vacant on a steep curve past a frontier. The
frontier is SOLVED, not tuned: placed so the town's expected vacant area
equals what the old rule gave the same preset, so each density rung keeps the
share of empty ground it had and only where it lies changes. A built core
keeps an 8% infill floor — surface car parks and gaps, which American
downtowns carry at least that much of — and that floor also leaves the player
prime sites in the centre.

Vacant share of lots by distance from the founding core, quartiles inner →
outer (reference island, seed 7):

| preset | plan 2 | plan 3 |
|---|---|---|
| landing | 48 / 52 / 75 / 83 % | 24 / 54 / 85 / 96 % |
| village | 23 / 28 / 36 / 53 % | 8 / 27 / 42 / 84 % |
| capital | 11 / 12 / 20 / 27 % | 3 / 5 / 15 / 57 % |

What it costs the player, said plainly: large vacant lots on high-demand
blocks (lot ≥ 5,000 sf, demand ≥ 60) fall on the reference town from 30 to 11
(village), 51 to 12 (landing) and 12 to 9 (capital). That is the request — the
dirt is now where the town has not reached — and the centre is no longer
handed out free. The build-out ladder (`test/buildout.mjs`, `BW_PLAN=2` for
the old plan) runs healthy at every preset on both plans; the young presets
open with more jobs because their centres are built. Old saves keep the plan
they were made with.

In the 3D city, unbuilt land past the fringe line (demand under 38, the
classic map's own line) is now rough grass that turns with the season rather
than gravel, and two-storey houses and shops from before 1950 are painted
clapboard half the time, with a gable — the timber town before the brick
one. `docs/map-overhaul/p8-*.jpg`.

# FOUR TIMES THE BUILDINGS

The owner: "a lot of them look the same." They did: a family was one painted
texture, so every brick walk-up on the island wore the same brick, sash and
lintel, every cornice was the same cream band, and every flat roof the same
deck. Now:

- **Four elevations a family** (17 families → 62 elevations, art-directed,
  each true to its period): dark-red Italianate with segmental arches,
  orange Federal brick with pediments and green shutters, painted brick with
  round arches; white, sandstone and granite Beaux-Arts stone; green, black,
  silver and deep-blue curtain walls; tan and buff deco; concrete, grey and
  dark ribbon slabs; clapboard with shutters, wide boards or pediments. A
  building draws one from a hash of its own deed, so it is stable.
- **Window shapes:** round arches, segmental arches, paired lights, painted
  shutters and pediments, drawn into the albedo, roughness, depth and night
  maps alike so the reveal and the glow follow the shape.
- **Trim:** cornices deep and bracketed, standard, doubled a floor down, or
  stripped to a coping; painted stone, dark green, black, terracotta or grey.
- **Roofs:** Second Empire mansards with dormers on walk-ups of 1855-1915,
  the cornice dropped to the foot of the slate; hipped roofs on half the
  clapboard houses and some brick ones; sawtooth north-light roofs on the
  rectangular factory sheds.

`docs/map-overhaul/p9-*.jpg`.

# DESIGN YOUR OWN BUILDING

The owner asked to see a new building before it is built and to control
its look. The Build desk's Design tab now has a design picker:

- **Facade:** fourteen styles, each with its four elevations shown as
  swatches (painted from the same textures the city uses). Styles that do
  not go that tall are greyed out — clapboard stops at 3 floors, brownstone
  at 8, brick walk-ups at 14. "Fits the street" leaves it to the period and
  place, as for every other building.
- **Trim** paint, **roof** (flat, gable and hipped to 4 floors, mansard to
  12) and, from 15 floors, a **crown** (flat top, setback, crown and mast,
  spire, or the wedding-cake setbacks).
- **The preview:** while the tab is open the scheme stands finished on its
  lot in the 3D city, at its real height and footprint, among its real
  neighbours, redrawn on every change. "See it on the map" closes the desk,
  flies the camera to the lot and keeps the picker in a bar over the map;
  "Back to the Build desk" returns with the choices kept in the draft.
  Breaking ground takes the preview down and the crane goes up.
- **Looks only.** The choice is carried draft → job → finished building
  (`BuildingDesign` on DevDraft, Development and BuiltOverride) and nothing
  priced reads it: `test/design.mjs`, now in `pnpm check`, runs the same
  scheme with and without a design and finds the state identical month for
  month apart from the design. What a building costs and how it wears is
  still the build-quality dial.

The classic map keeps its own styles and does not draw the preview.
`docs/map-overhaul/p10-*.jpg`.

# THE CLASSIC RENDERER IS RETIRED

The owner's call: "Get rid of the previous map / rendering, we are switching
over officially." The 3D city (`src/map/real/RealCity.ts`) is the only map:
MapView constructs `RealCityLayer` directly, the Settings → Display toggle
and the store's `realRender` are gone, and the city-context and player-item
types it borrowed now live in `src/map/real/ctx.ts`. Deleted with the classic
renderer (`ThreeBuildings.ts`, ~17,000 lines): its style registry
(`styles.ts`), its skyline signature (`skylineSig`) and test, `test/plate.mjs`,
and the probes and audits that bundled it (`tools/styleaudit.mjs`,
`tools/styleboard.mjs`, `tools/probe/crownsweep.mjs`,
`tools/probe/silhouette.mjs`; the `styles` and `plate` scripts). Two overlays
the classic map drew on the buildings themselves — lit vacant floors after
dark (moot: there is no night) and civic-works scaffolding — are not drawn;
the economy, picking, lenses, badges and panels are unaffected.

# STREETS AND PARKS MEET CLEANLY

The owner: "make sure the streets and parks are not running into each other
and all look clean." Measured on four towns first: where a diagonal
boulevard crossed a park, 24-39% of the park lay under boulevard roadway or
its planted mall — the road and the allée ran on across the lawn — and every
park's lawn met its frontage road with no edge at all.

- **A boulevard stops at the park's frontage road** (citygen, paint and
  context only — reservations and lots untouched): the roadway is cut where
  its centreline enters a park's reservation, the planted mall a further
  6 m short, so the median ends in a kerb nose the traffic swings round, and
  the allée trees that stood on the frontage ring or the lawn are dropped.
  Overlap now 1-3% everywhere (the kerb seam).
- **Every park has an edge**: the same 15 cm footway as the blocks, 2.6 m
  wide, runs round the inside of each park with its kerb on the road side.
- **One asphalt**: the park frontage ring was painted a lighter grey than
  every other street and read as a patch; it is the street asphalt now.

`docs/map-overhaul/p11-*.jpg`.

# THE ECONOMY ON THE BUILDINGS

With no night there were no dark floors to read vacancy off, so by day a
half-empty building looked like a full one.

- **Space to let advertises itself.** A building under 80% let hangs a red
  FOR LEASE or yellow SPACE TO LET banner near the top of its longest wall
  (about one building in six at the opening vacancy); under 55%, a second on
  its next-longest wall. Read from the same occupancy the engine reports.
- **Crowds follow the economy.** Twice the people and more cars are placed,
  and each is on the street when its own draw is under activity x (0.3 + 0.9
  x the demand of the ground it walks on): a thriving downtown throngs, a
  district losing its tenants empties, and the whole town thins in a slump.
- **Neglect shows.** Worn buildings go a third darker and much greyer; a
  refit reads a touch brighter.

`docs/map-overhaul/p12-lease-banners.jpg`.

# THE COUNTRY PAST THE TOWN

Young towns are mostly unbuilt fringe, and it read as a grid of flat beige
lots. Out past the fringe line (demand under 38, residential lots included)
an empty lot is now country: a third market gardens in rows along the long
side (bare soil in winter, green through summer, gold at harvest), two in
five hedged pastures, the rest fenced scrub with post-and-rail; gates are
gaps in the boundary. Bigger holdings carry a clapboard farmhouse facing the
road, a red barn behind it and a gravel track in. Everything hangs on the
lot's deed, so it is cleared the day the lot is built on. Kerbside parking
thins where demand is low, so a country road is not lined with cars.
`docs/map-overhaul/p13-countryside.jpg`.

# TREES WITH SPECIES

Every tree was the same grey-green lump at about the same size. Now: five
greens and the odd copper beech by tree; a third of the street trees are
columnar (lindens and hornbeams pruned tall and narrow); park and open-ground
trees range 0.8-1.8x in size; evergreens (a three-tier conifer) make a fifth
of the trees in the parks, half in the cemeteries, and keep their needles in
winter. Parks gain a clipped low hedge just inside the footway, open where a
walk comes in, and flower beds round the fountain or column — bare earth
November to March. `docs/map-overhaul/p14-*.jpg`.

# BUILDING SITES GO UP IN STAGES

A job was a grey box growing taller with a crane on it. Now every site —
yours and the rivals' — has plywood hoarding round the lot from day one;
under a fifth of the way it is a dug pit with an excavator; past that a
frame rises floor by floor, rusted steel columns every 6 m and a concrete
slab each storey, with the cladding following two floors behind (three
early on), so the top of a rising tower is always open structure until the
cladding closes it just before delivery. `docs/map-overhaul/p15-construction.jpg`.

# A WORKING HARBOUR

The quay was a grey line. Every 70-100 m along it a timber pier now runs
out 30-44 m into the water on pilings, decked in boards across its width,
boats moored down both sides; on a quay over 400 m long the pier nearest its
middle ends in a clapboard ferry terminal with a ferry alongside. The water
side is read off the land ring. The generator's ~1,500 seawall railing posts
and its promenade benches — laid out, oriented, and never drawn by the 3D
city — are drawn at last. `docs/map-overhaul/p16-waterfront.jpg`.

# FAR TOWERS STAY CALM

Past a few hundred metres a window is a pixel, and its relief and
mirror-glass reflection aliased into shimmering stripes on the curtain
walls. Every facade now fades its normal map out between 320 and 1,300 m
from the eye, roughens its glass toward 0.62 and drops 60% of its metalness
over the same range — what a camera actually resolves of a far tower.

# WEATHER YOU CAN SEE

The sky and the sun followed the weather; the ground did not. Now, from the
month's weather (cityVisuals): overcast softens the building shadows to a
smudge; rain turns the footways dark and glossy, lays a faint wet sheen over
the ground that reflects the sky, and sends rain streaks falling round the
view; snow drifts down as flakes, and the yards, lawns, parks, boulevard
malls, footways, fields and rough grass whiten while the carriageways stay
dark. The precipitation is a box of streaks that follows the camera and
scales with the view. `docs/map-overhaul/p17-weather-*.jpg`.

# GRAPHICS QUALITY

Settings -> Display has a Graphics row: High (the default; everything above),
Medium and Low. It replaces "prefer smoother frames", whose old "on" reads as
Medium. Looks only — the city, its buildings and the game are identical.

| | High | Medium | Low |
|---|---|---|---|
| pixel density | native | capped 1.25x | 1x |
| shadow map | 4096 | 2048 | none cast |
| walkers and cars | full | 60% | 30% |
| lamps, cars stop drawing beyond | 2,600 m | 1,800 m | 1,100 m |
| hedges, fences, railings, benches, flower beds, rooftop plant | always | culled with the lamps | culled with the lamps |
| rain and snow streaks | yes | yes | no (wet and snowy ground stays) |

Measured on the software renderer at a 2x display, Metropolis district view:
a frame took 8.98 s on High, 5.54 s on Medium (-38%) and 3.67 s on Low
(-59%). Absolute numbers are meaningless on a CPU rasteriser; the ratio is
the point. `docs/map-overhaul/p18-graphics-{high,low}.jpg`.

# POINT AT A BUILDING

The pointer picks what it is over in 3D: a ray walked down from the eye
stops at the first lot whose building stands taller than the ray there
(about 3-4 ms on the software renderer), so pointing at a tower picks the
tower, not the street behind it; clicks use the same pick. The hover card
shows use, floors, size, year, owner, occupancy, market rent, appraisal,
asking price when listed, and demand — read off the property panel's own
functions. Occupancy says "mkt est." unless a rent roll has been shown, as
the panel does. `docs/map-overhaul/p19-hover-card.jpg`.

# SHOPFRONTS BY TRADE

Every street-facing bay of a shop storey (a wall whose far side is no one's
lot) gets a canopy and fascia in a trade's colours: cafe, grocer, bank,
pharmacy, diner, hardware, bakery, boutique, with downtown stone and glass
leaning to banks and boutiques. The trade is looks only: market buildings
have no tenant roll to read it from. Which bays are boarded with plywood is
live: round((1 - retail let share) x bays), the same number that already
papers the glass. `docs/map-overhaul/p20-shopfronts.jpg`.

# NEIGHBOURHOODS HAVE A MATERIAL

Old low-rise buildings used to pick red brick, buff brick or brownstone per
lot at random. Each district now leans on one tradition, keyed by its tone
family (the same hash of the district name the pavement uses): brownstone
rows, red brick, buff brick, a timber-frame quarter, or mixed. Most
buildings in a district also share a batch of the same brick or paint.
Brownstone rows (and half the brick walk-ups) climb to their doors up
stoops, one per house front; the works quarter's sheds get loading docks
with canopies. `docs/map-overhaul/p21-*.jpg`.

# EVERY PROP ON ITS GROUND

Reported from play: cars on the footway, trees in the road and inside
buildings, and "weird white stairs". Measured, not guessed: a ground
classifier (`groundAt`: building footprint, footway with its holes, park,
open ground — boulevard mall and esplanade — lot, else road) over every
instanced prop, three towns:

| | before (town, seed 4) | after (all three towns) |
|---|---|---|
| street trees on the footway | 74 of 6,254 | all |
| trees in the road or a building | 4,639 | 0 |
| parked cars on the carriageway | 1,092 of 2,060 | all |
| lamps on the footway | 33 of 1,229 | all |

The cause was the placement, not the town: street furniture was laid by
offset from the grid/lane street centre lines with the generator's
half-width, which matches the drawn street on a straight grid block and
nothing else, and missed the diagonals, avenues and irregular streets
entirely. Trees, lamps, walkers, kerbside cars and moving traffic are now
laid along the drawn footway's own kerb edge (`dressFootways`) and every one
is checked against the ground: a tree on the footway with its crown clear of
every wall, a lamp on the footway, a parked car wholly on the carriageway
with a running lane left beside it, traffic on a lane that stays on the
road. The generator's own trees are kept on lawns, yards, malls and the
esplanade; 374 boulevard-row trees that landed in the asphalt are dropped
(the footway rows line those streets now). Stoops only on a low brownstone
or brick house whose front stands at the footway, in the house's own stone;
canopies never over the carriageway or into a neighbour's wall; car-park
cars clear of walls.

`node tools/ground-audit.mjs` (dev server running, playwright-core
installed) repeats the measurement and exits 1 on any misplaced prop.
`docs/map-overhaul/p22-ground-{before,after,district}.jpg`.

# A SKYLINE OF DIFFERENT TOWERS

Reported from play: most buildings look alike, only a few kinds. Measured:
every post-war tower was its footprint extruded straight up, in one of 8
families x 4 elevations, ending in one of three caps; the low-rise families
had four elevations each; and a frontage of hundreds of metres on one deed
was one prism in one elevation.

- **Massing.** Each tower draws a shape from the period's repertoire, by
  hash of its deed: plain slab, tower on a podium (the podium often in
  precast or granite under a glass shaft), two to four stepped tiers, a
  seven-step taper, chamfered or rounded corners, notched corners, twin tops
  of unequal height off a shared base, and combinations. Mid-rise blocks
  (24-40 m) take the gentler ones. Height and footprint are unchanged.
- **Crowns.** Plant box, two-step plant box, pyramid cap (copper green,
  slate, dark bronze, steel), stepped crown, glass lantern with mast, a
  frame of fins carried past the roof, helipad, gable, penthouse — by family.
- **Facades.** Six new tower families, each with four elevations: the
  1958-75 dark tower of bronze I-beams, mirror glass, emerald glass,
  vertical fins, 1980s white precast, postmodern granite. Era-weighted.
  Post-war apartment towers can now be red or buff brick, as so many were.
  Towers stand on a double-height glass lobby. Glass tints widened.
- **Low-rise.** Brick, buff, brownstone, limestone, post-war panel,
  clapboard, loft, grid and precast each gain three more elevations (seven
  each). The Build desk still offers the first four.
- **Long blocks are rows.** A frontage of 80 m or more on one deed is cut
  across its long axis into 18-40 m houses, each with its own elevation,
  paint and parapet a storey up or down; a block over 160 m that is tall
  becomes a row of towers.

Metropolis (seed 2): 95 post-war towers over 45 m now wear 94 distinct
family-elevation/massing/crown combinations. `docs/map-overhaul/p23-*.jpg`.
Looks only.

# THE REALISM PASS

The brief: make it look much better without anything odd — so nothing new
invented for effect, only what is in a photograph of a real city, at real
sizes and colours, and every piece checked.

- **Contact and ambient shade.** The shade at the foot of a wall climbs a
  third of the neighbouring height (3.5 m on an avenue of walk-ups, up to
  26 m among towers); walls facing another building 3/7/12 m away sit
  28/16/7% darker; every footprint stands in a soft ground band 2-4 m wide.
  `p24-shade.jpg`.
- **Vehicles and people.** Sedans, SUVs, vans, taxis and buses as shaped
  bodies at real sizes, with glass, tyres and lamps; people with legs,
  coats, arms and hair. `p24-vehicles.jpg`.
- **Windows.** Each pane draws its own state: blinds at some height,
  curtains, or bare glass a little lighter or darker. `p24-windows.jpg`.
- **Ground.** A faint grain on the asphalt (aggregate, cracks, patches) and
  mottling on the yards from zoom 15, made at runtime.
- **Street hardware.** Signals at crossings, hydrants, litter bins, bus
  shelters — all on the footway.
- **Trees.** Crowns of seven clusters with dappled light and a forked trunk,
  in a cleaner green. `p24-trees-hardware.jpg`.
- **Entrances.** A door in a stone surround on the main street wall of
  apartment and office buildings; marquees on apartment houses of six
  floors or more; glass canopies on towers. `p24-entrance.jpg`.
- **Roofs.** Decks with planters, solar rows on newer low roofs, the odd
  dish. `p24-roofs.jpg`.

**The guard.** `tools/ground-audit.mjs` checks every instanced prop stands
on its ground and, new in this pass, that nothing floats (every raised
volume stands on a lower volume of its own deed). It caught a 390 m
penthouse bar floating over a split row of towers, and a stepped tier off
a triangular footprint; both fixed. All three test towns: 0 misplaced,
0 floating.

**The cost**, on the software renderer at 2x, Metropolis district view,
against the tower-variety baseline: +26% frame time on High, +39% on
Medium, +26% on Low. Low (which now also drops the ground contact shade)
still renders faster than the old Medium.
