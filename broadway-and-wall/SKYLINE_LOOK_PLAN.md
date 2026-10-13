# SKYLINE LOOK PLAN

The owner's target: the city should read the way a city-builder like Cities:
Skylines reads — a sunny, slightly miniature city you want to look at — on the
engine we have (three.js inside MapLibre), with every step made in code and
judged by screenshot. This file is the queue and the rules.

## How a step is judged

- **One reference set.** `seed 4242`, the same camera positions every round:
  downtown at the default camera, a street close-up, a skyline view, and the
  whole island. Before and after are always the same town from the same place.
- **One step per round.** Built, shot before/after, shown to the owner,
  approved or redirected. Nothing reaches `main` unapproved.
- **Quality-gated.** Anything that costs frame rate rides the existing graphics
  setting (Low / Medium / High). Low must stay as fast as it is today.
- **No fake numbers here either.** Looks only. Nothing in this plan is read by
  the engine; `test/design.mjs` and the baseline must not move because of it.

## The queue, by payoff

1. **Post-processing** (`src/map/real/post.ts`). One full-screen pass over the
   finished city frame: a warm, slightly saturated colour grade with a gentle
   S-curve; a soft bloom on bright surfaces (sunlit facades, lit windows at
   night); a tilt-shift band that blurs the top and bottom of the frame by how
   steeply the camera looks down and how close it is, so street views read as
   a model and the island view stays sharp; a light vignette. High: all of it.
   Medium: grade and vignette. Low: off.
2. **Lighting and sky.** A warmer, lower sun; a blue-tinted shadow fill instead
   of grey; softer shadow edges; the haze tinted to match the grade.
3. **Greenery.** Street trees on every block face, more species and sizes,
   planted yards behind houses, fuller parks. The single biggest softener of a
   grid in the reference look.
4. **Facade depth.** Parallax windows (reveals that shift with the view, no new
   geometry) and more real geometry on fronts and roofs — balconies, cornices,
   rooftop units — from the kit the renderer already has.
5. **Reflections.** Glass towers mirror the sky and their neighbours (reflection
   probes), so the glass reads as glass inside a look that supports it. The
   parked `claude/glass-prototype` branch's per-building glass tint returns here.

## Not in scope

Weathering and ageing (declined by the owner). Night or dusk visuals (the game
has no night mode). Engine changes of any kind.

## Progress

Reference set: Metropolis development, seed 4242, July (the game opens in
January: bare trees and winter yards are not the target look), shot only once
the city is fully built (`__three.live`) — earlier shots caught MapLibre's
placeholder extrusions.

- **Round 1** — post pass, lighting, greenery, window reveals, reflection
  probe. First Metropolis shots: tilt-shift and bloom far too strong, a yellow
  cast; toned down.
- **Round 2** — lawn-green yards and parks; soft-filtered shadows and a
  tighter shadow box (the rooftop "staircases" were shadow aliasing).
- **Round 3** — a patchwork of roof tones (black tar to white coat); stair
  bulkheads in the building's own material (the instance kind had not been
  flagged colourable, so every one was the same tan).
- **Round 4** — curtain walls reflect the probe brighter and stay glassy
  further off: blue glass rather than near-black stripes.
- **Round 5** — ambient occlusion (High only): a half-size distance pass of
  the city plus a street-level plane (MapLibre owns the real ground), distance
  taken per pixel, and a crease counted only where both neighbours of a pair
  stand nearer — so no grazing-angle banding and no silhouette halos.
  `?post=aoview` shows the term alone. Also back on PCFShadowMap: three r185
  retired PCFSoftShadowMap (the round 2 change had silently fallen back).
- **Round 6** — clear air over the view: the haze now starts past the camera's
  focus (0.85× its distance, was 0.35×) and takes only the far city; a lower
  cap. The skyline keeps its colour instead of fading to milk.
- **Round 7** — punched windows (masonry and panel fronts, not curtain walls)
  take a modest sky tint, stronger looking down; blinds and curtains as drawn.
  The old city's windows read as glass rather than black holes, without the
  washed-out look of the parked glass prototype.
- **Round 8** — market squares and batteries are laid in stone courses (a
  generated `bw-grain-setts` pattern at double pixel density, so a flag is a
  flag and not a car-length slab); the centre of the reference view was one
  flat beige field.
- **Round 9** — cost: the occlusion distance pass is redrawn only when the
  camera moves (or every half second for the traffic), not on every one of
  the ~30 repaints a second the cars cause; and the paving fades in only at
  street zoom, where a pattern drawn at a fixed screen size reads as stone.
- **Round 10** — night: each window draws its own lit/dark and lamp colour
  from its cell hash (about half dark; warm tungsten, a few cool
  fluorescent), so a tower at night is a field of rooms rather than one lit
  slab. `shoot-design.mjs` gained `dusk=` for night review shots.
- **Round 11** — night streets: every street lamp throws a soft warm pool on
  the carriageway (an additive `glow` instance per lamp, opacity following the
  hour; nothing by day).
- **Round 12** — livelier streets: traffic every ~24 m of kerb (was 34), a
  walker every ~12 m of footway (was 16), both still thinned by the street's
  demand, the hour and the graphics setting (applyCrowd). Walkers were held
  short of the first try's 9 m: a figure is a pixel at the default camera and
  every one is stepped each frame.
- **Round 13** — balconies on every apartment front whose original family
  carries them (via `baseOf`, so the pattern book's later families count),
  now including stack-bond brick, rainscreen, timber and new limestone; and
  up post-1990 glass apartment towers in alternate stacks. Review shots now
  use exact cameras (`z=`, `pitch=`, `bear=` in `shoot-design.mjs`), so two
  builds frame identically.
- **Round 14** — moonlight: after dark the key light is weak and cool rather
  than off, and the sky fill dims less, so roofs and walls keep their shape
  under the lit windows.

### Cost and robustness check (after round 13)
Median frame time in the software renderer this work is reviewed in (no
GPU, so only the ratios mean anything): session start, High 7.7 s; now, High
10.1 s, Medium 5.5 s. The forced-repaint test redraws the occlusion pass every
frame; in play it is cached while the camera holds still. A quality ×
time-of-day sweep (seeds 101, 2024, 31337, 777; High and Medium; day and
night) found one crash — `lotMassing` reading past the end of a lot outline —
fixed in #231; the sweep is clean since.
- **Round 15** — canal and slip water a stained teal (`CANAL_WATER`) with a
  weaker sky reflection: at full strength every canal read flat royal blue
  beside a turquoise sea. Judged on a default-size town (seed 101), the city
  most players start in.
- **Round 16** — golden hour: the finishing pass takes the low sun's warmth
  (`uGolden`, from the same dusk curve as the sun's colour): lit surfaces go
  amber, shadows a little violet. Noon and night unchanged.
- **Rounds 10, 11, 14 and 16 removed.** The game has no night mode: the hour
  is locked to afternoon (`MapView.tsx`, owner: "we don't need a night mode,
  that's pointless"), so per-room night windows, street-light pools,
  moonlight and the golden-hour grade were dead weight (the light pools cost
  an instance per lamp by day). Do not add night or dusk visuals.
- **Round 18** — road paint. The streets were bare asphalt (MapLibre's
  10 cm centre lines were under a pixel from every camera, and most streets
  had none). The 3D city now paints them (`buildMarkings`), by the carriageway
  measured kerb to kerb on the ground polygons: a dashed yellow centre line
  from 8 m, a double yellow with white lane lines from 15 m, and a stop bar
  before every junction. No paint inside a junction (a disc sized to the
  crossing streets, and wherever road continues past either kerb). The old
  MapLibre lane layers are hidden once the 3D city is up.
- **Round 19** — the roof kit. Roof plant was dropped at random spots at a
  random angle, plain tan or orange boxes and condensers with three studs
  (read as toy bricks). Now laid out square to the building's long wall with a
  clear margin and no overlaps: a stair bulkhead (door, hood, vent, dark
  membrane top in a light coping; brick-toned on brick) near the middle, a
  lift overrun beside it from ~6 storeys, a second stair on a big floor plate,
  a louvred plant room on an office or tower floor plate; packaged units with
  louvred coils and flush fan grilles in a row on one side, exhaust fans on
  the other; split condensers along a parapet; brick chimney stacks on
  pre-war masonry; New York tanks with hoops on a braced steel deck.
- **Round 20** — greenery. Out of leaf (November to March, and the game
  opens in January) a tree was its summer crown painted grey: khaki blobs
  down every street. Now the crown is cut to a lattice of twigs (an alpha
  mask over UVs wrapped round each foliage cluster) in dark bark tones, so
  the street shows through and the shadows are a tracery. Street trees run
  larger and more varied (mature 10-15 m on a wide footway). An in-town empty
  lot, MapLibre's flat lawn before, grows clumps of scrub along its edges and
  a self-seeded tree or two (a new `bush`, the same foliage and seasons),
  hung on the deed so they clear when it is built on.
- **Round 21** — relief on the fronts (option B of the owner's choice: real
  geometry on our own buildings rather than a bought model kit). Every
  punched window on a building up to 60 m gets a real sill under it, and on
  a masonry front a lintel or a hood over it, placed from the family's own
  painted window rectangle so it sits exactly under and over the opening;
  front and top faces only (the camera looks down), in their own mesh that
  Low leaves out. Shop fronts get a pier between every bay and a fascia
  under a projecting cornice, painted as one (shopkeeper green, black,
  oxblood, cream; bronze or dark aluminium uptown). Cost on High: 8.5M to
  9.9M triangles a frame, software renderer 8.2 s to 9.2 s.
- **Round 22** — balconies as the building would have them. They were one
  grey box on a few modern families, on the longest wall only, and built
  toward the inside of the wall (local +y), so most stood hidden in their own
  building. Now (`balconies`) on every street front, centred on the windows
  of the building's own floor grid (above a shop or a stone base too): a
  post-war slab carries stacks in alternate bays, in pairs or in every bay,
  with a concrete parapet before ~1985, a steel rail, or a glass rail after;
  a glass apartment tower after 1990 glass-railed stacks; a pre-war
  classical stone apartment house a balustraded stone balcony along the
  floor over the base and the floor under the cornice; a lower classical or
  Victorian front iron Juliet rails on its principal floors. Walk-ups keep
  their fire escapes. ~2,000 in Metropolis.
- **Round 23** — tall buildings step back. The 1916 setbacks covered only
  the pre-war masonry towers over 70 m. Now the white-brick apartment towers
  of 1946-61 over 70 m take the wedding cake too, and the 40-70 m masonry
  mid-rises of 1916-61 (deco, stone, terracotta, white brick, brick, buff)
  step once: a full-lot base to about two-thirds of the height, a terrace,
  the upper floors 3-5 m back (27 in Metropolis). Post-war towers over
  100 m rarely go up as a plain prism (2% from 10%; tiers more likely).
  A building the player designs keeps the player's choice: the design tab's
  Crown (Setback, Wedding cake) still decides it.
- **Round 24** — windows with real depth. The opening stopped at the
  pane: a dark rectangle with a painted jamb. Now an unshaded pane on a
  punched window (not curtain walls, not blinds or curtains) shows a room
  behind it by interior mapping: each pixel follows the eye's ray into a
  room the size of its bay and storey, 4 m deep, and takes the colour of
  the back wall, a side wall, the floor (wood or carpet) or the ceiling,
  dimmer with depth. It moves with the camera, so the window reads as an
  opening. Shader only, fades out past ~320 m with the other relief.
- **Round 25** — the ground round a building. About a third of every built
  lot is open (offices 40%, shops 37%, apartments 34%, industry 19%) and it
  showed the block fill, which went lawn-green in summer whatever stood
  there: a bank tower in a front lawn. Each built lot now lays its own ground
  (`lotGrounds`) by use and era: offices and shops a granite-flag plaza with
  trees in grates or planters along the front; apartment houses before 1940
  paved areaways and yards; from 1940 on mown lawn (seasonal, takes snow)
  with a paved walk from the street to the building and a tree or two on a
  big lawn; industry an asphalt work yard. Hung on the deed and collapsed
  away on demolition. The block fill itself now only reaches four tenths of
  the way to lawn green in summer.
- **Round 27** — behind the building (`backLot`). A back wall is one whose
  ground runs on as lot for 4 m or more. Pre-1940 walk-ups get fenced back
  gardens a house wide, each with a patio by the back door, a tree or shrubs,
  a flower bed and sometimes a shed; post-war apartments a parking lot in
  bays where the depth allows, else a lawn with benches and trees; offices
  and shops a service yard (asphalt, cars, dumpsters, a condenser); industry
  trailers and pallets. The lawn texture is mottled instead of striped, and
  no paved squares are dropped into lawns.
- **Round 28** — no two lawns alike. Each built lot's lawn draws one of
  eight grass tones (lush, ordinary, dry, yellowing, blue-green,
  sun-bleached, dark) and has its texture rotated and shifted; over all of
  it, two octaves of world-space noise (11 m and 38 m) lighten and darken
  the grass across lot lines. Shader and vertex colour only.
- **Round 29** — the edge of town. Empty lots outside downtown were tan
  gravel yards, hedged pastures and market gardens. Now each is an overgrown
  field (rough tussocky grass, scrub clumps thick toward the edges, young
  self-seeded trees, a broken fence) or an old surface lot (faded, patched,
  cracked asphalt with weeds in the cracks and ghost bay lines, an abandoned
  car or two). How far gone (`scruff`) follows demand: tidy at 60, rough
  below 30, derelict below 22, where four lots in ten are the old asphalt.
- **Round 30** — always afternoon, cloud shadows. `setDayPhase` now pins
  the hour to the calibrated day whatever it is passed (the owner: "absolutely
  no nighttime in this game"), so no caller can bring the dusk machinery back.
  Cloud shadows: what round 17 reached for, without drawing a cloud. A field
  of cumulus cells (~420 m, four octaves of value noise) at a 1,400 m base,
  sampled where each surface's line to the sun meets it, takes up to 55% (later 45%) of
  the sun's direct light (the sky fill is untouched), drifting at ~8 m/s. It
  rides the shared air hook (`addHaze`), so every lit material and the
  shadow catcher over MapLibre's ground carry it; the sea takes most of its
  shade from the catcher and gives up its glitter. Fair weather shades ~22%
  of the ground, more as the sky fills, none under a full overcast (no
  direct sun left to take); off on Low. Two faults found on the way: the
  noise sum bunches round 0.5, so the coverage threshold is fitted to its
  measured quantiles (a naive `1 - cover` shaded 7% for "34%"); and three
  uploads `cameraPosition` only to some material kinds, not the shadow
  catcher, which then painted the whole ground one shade — the field carries
  its own `cloudEye`. Measured against main on the reference camera: 5-15%
  darker in cloud-shaped patches over land and water.
- **Round 31** — mechanical floors. A modern or glass tower over 100 m (28+
  storeys) is broken every 16-24 storeys by a plant floor in its own louvred
  `@screen` wall (two storeys over 220 m), on the body's floor grid, so a
  tall slab reads as stacked blocks instead of one stripe. Masonry towers
  keep their plant in the setbacks and crown, as they did.
- **Round 32** — the clouds, finished. Close in, a cloud's soft edge spans
  the whole frame and reads as a smudge (and a passing one dims the building
  being inspected): the shade is full from the district view out and a third
  of it at street level. Far off, the air hides it as it hides everything
  else: gone by ~7 km, so the horizon is haze and not grey smears. The field
  moved to its own module (`clouds.ts`) so anything else that shows the sky
  reads the same cells. On the Metropolis default camera the open-water
  patches read as ink blots: the edge is now a broad penumbra (a cumulus has
  no hard edge and the sun is a disc) and the shade at most 45% of the sun.
  Clouds drawn into the sky itself (the finishing pass,
  where the distance pass shows no geometry above the horizon) were built and
  dropped: at the 70° pitch limit the sky is a sliver at the top of the
  frame even in a tall window, too little to judge or to be worth the pass.
- **Round 33** — wind in the trees. Every street tree's crown leans downwind
  with the square of its height above the fork (~10 cm at the top of a 7 m
  crown), in two slow periods phased by where it stands, so a row ripples
  instead of nodding as one. Vertex shader on the shared foliage material;
  bushes, near the ground, barely move.
- **Checked, not changed: the black towers.** The 1958 dark tower
  (`blackglass`) reads near-black from the play camera, which looked like a
  hole in the city. Tried as a dielectric (metalness 0.12, full sky probe):
  no measurable change on the reference shot, because a wall seen from above
  mirrors the street and the buildings opposite, not the sky, and 4% of a
  dark street is dark. That is what smoked glass looks like from a roof
  across the street; the look is right and stays.
- **Round 34** — oil-canning. Close in, a curtain wall read as one smooth
  mirror holding one smeared image of the city. No curtain wall is flat: each
  pane is set a fraction of a degree off true, so the reflection breaks into
  a faint grid of slightly different panes. Each glass pane's normal now
  tilts by up to ~2.5° from its cell hash (glass fronts only, faded out past
  ~320 m with the rest of the relief, where it would shimmer). Measured on a
  street camera: brightness spread across a glass tower's panes +2.5 (sd
  36.6 to 39.1) against +0.2 on a brick front used as the control.
- **Round 35** — no night, and the names under the lens. Night is gone from
  the code, not pinned off: the dusk state and setDayPhase, every night and
  golden-hour term in the light, lit-window emission and the `lit` attribute
  (occupancy was only ever shown as rooms lit after dark), the night veil
  over the ground, lamp glow and the park lamps' light pools, the post pass's
  uNight, the .bw-night label CSS. District and station names (the
  neighbourhoods) show only while the Demand lens is up.
- **Round 36** — winter. The owner: "winter used to be the prettiest part
  about this game, now it's the ugliest by far". Measured: snow lay only in
  a month the weather roll said it was snowing (~35% of winter months), so
  most Januaries were a summer city with the leaves taken off, and even under
  snow the roofs stayed grey (+0.2 albedo) and the harbour kept its summer
  turquoise. Now:
  - *A snowpack* (`cityVisuals snowCoverAt`): each snowfall adds to the
    cover, each month keeps a share (most in deep winter, little in March,
    none April-November). Lying snow in 36% of Decembers, 58% of Januaries
    and Februaries, 33% of Marches over 300 seeds x 20 years: Boston's
    winter. Flakes fall only in a snowing month.
  - *Snow that is snow*: flat roofs to ~0.7 albedo under full cover against
    the ploughed dark streets; gravel lots and yards under it, areaways and
    plazas shovelled grey, work yards ploughed; bare crowns and pines
    frosted.
  - *A winter harbour*: from December to February the sea's sand, shelf and
    deep colours, and MapLibre's shoal fill under the clear waterline, turn
    slate and steel-green, snow or not.
- **Round 17 (not merged)** — flat cloud sheets a few hundred metres up, seen
  only from the island view. Dropped: a flat sprite cannot be a volumetric
  cloud, and a lone hard-edged one read as an object, not weather. Branch
  `claude/skyline-r17` kept for reference.

## Where it stands, and what is left

Rounds 1–16 are on `main`, less the four night rounds. Against the session's starting point (same town,
same cameras): a graded, tilt-shifted frame; warm sun with blue-filled
shadows; ambient occlusion; tree-lined streets and wooded parks; recessed
windows that catch the sky; glass towers that reflect the city; patchwork
roofs; paved squares; balconies; livelier streets.

What still separates it from a city-builder's look is mostly **geometry**:
those games use hand-modelled buildings (real recesses, ledges, rooftop
equipment, signage), where ours are extruded footprints in painted elevations.
The next tier of work, in order of payoff:

1. Parallax windows proper (the reveal shader fakes the jamb; a parallax
   interior would give depth to every pane).
2. Rooftop equipment as a richer kit (stair towers, louvred plant rooms,
   antennas) placed by building type and size.
3. Ground-floor geometry: recessed shop bays and entrance canopies for every
   style, not only the ones that have them now.
4. Volumetric clouds for the island view (raymarched, High only), if wanted —
   flat sprites were tried and dropped (round 17).
