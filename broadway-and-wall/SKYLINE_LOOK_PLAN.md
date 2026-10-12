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

Weathering and ageing (declined by the owner). Engine changes of any kind.

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
