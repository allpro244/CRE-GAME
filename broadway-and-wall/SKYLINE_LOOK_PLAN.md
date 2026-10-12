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
