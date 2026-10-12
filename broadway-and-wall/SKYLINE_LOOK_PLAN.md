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
