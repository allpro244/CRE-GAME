# BUILDINGS

What the city is made of, who owns which file, and how to check that any of it
is true. Companion to `ECONOMY.md`, which does the same job for the simulation.

The rule this whole document exists to serve: **a building family that is never
drawn is dead code that compiles.** Six were found that way, and every one was
found by counting rather than by looking. `pnpm styles` is the counter.

---

## 1 · WHERE THINGS LIVE

| File | What is in it |
|---|---|
| `src/map/styles.ts` | The style registry: every facade family, the trait tables, and `stylePool` / `styleFor` / `styleForBuilt`, which decide what a given building wears. **Imports nothing from three.js or MapLibre** — that is deliberate, see §4. |
| `src/map/volume.ts` | `BuildingVolume`, the one record a building mass is described by. Its own file for the same reason. |
| `src/map/ThreeBuildings.ts` | The renderer. Facade shader (`FRAG`), roof shader (`ROOF_FRAG`), the `Mason`, `crownTop`, `roofDeck`, the roof-prop kit, the tower kit, and the player-build path. |
| `src/citygen/build.mjs` | `massing()` — the silhouette a *generated* building stands as. |
| `tools/styleaudit.mjs` | `pnpm styles`. Runs the real chooser over every building of every town across every seed. |

**Two different code paths make buildings, and both need feeding.** The
generator (`build.mjs`) makes the stock a city *starts* with; the renderer's
`setPlayerBuildings` makes everything the player and the rivals put up
afterwards. A family added to one and not the other is half-missing, and the
audit will not catch it because the audit only sees the generator.

### The player path is not a second renderer, and every time it forgot that it drifted

`setPlayerBuildings` had grown a private copy of five decisions the registry
already owned, and every one of them was worse than the shared answer:

| it decided | it had | it has |
|---|---|---|
| the facade | six hard-coded ids off the class | `styleForBuilt` |
| the era | a fixed 1992-2017 band | the delivery year the engine stamps |
| the roof surface | four of the nine, off the deed hash | `roofDeck` |
| the crown | nothing at all | `crownTop` |
| corner shading | every corner declared convex | the shared `Mason` |

None of these were visible from a screenshot of one building, and none of
them could fail a test, because there was no second opinion to disagree with.
They were found by asking the same question of both paths and diffing the
answers, which is the only thing that finds this class of fault. **If you add
a decision to one path, the reviewable question is not "does it look right",
it is "which function owns this, and is the other path calling it".**

The two things that made the sharing possible are worth knowing about:

- **`Mason`** is the four operations everything above ground is made of —
  `tri`, `wall`, `cap`, `pitch`. They used to be closures inside the
  generator's rebuild loop, which is the mechanical reason the player's
  buildings had no crown: the ladder could not be reached because the trowel
  could not be. The per-volume scalars every triangle inherits (era, deck
  surface, wear, seam bearing) live in a `MasonState` the caller mutates.
- **`crownTop`** takes a Mason, the two buffers and one volume's worth of
  facts, and returns the deck the roof kit should then be fitted to — the
  bulkhead's top when it grew one, the roof itself when it did not.

---

## 2 · WHAT EXISTS NOW

**144 facade families** (was 10, of which 2 carried 71% of the city), out of
152 `S_*` ids — the other eight are not facades: `S_PLAIN`, `S_CORNICE`,
`S_GREEN`, `S_LOT`, `S_GABLE`, `S_LAWN`, `S_PATH`, `S_POND`.

> **Re-count before you quote this.** This section said 82 for long enough that
> it reached commit messages and source comments, and it was 144 by then.
> `pnpm styles` prints the number in its first line; `grep -c '^export const S_'
> src/map/styles.ts` prints the id count. Neither takes a second.

- *Pre-war fabric* — cast iron, Richardsonian, terracotta Gothic, Beaux-Arts,
  Second Empire, Italianate, Federal, tenement, Chicago school, glazed terra
  cotta, Streamline Moderne, stripped classicism, carriage house, market hall.
- *Post-war* — International Style, precast eggcrate, brutalist, mirror glass,
  metal pan, EIFS, parking deck, postwar brick slab, glazed white brick,
  balcony tower, fritted glass, mass timber, rainscreen, big box.
- *Tower skins* — terracotta pier, deep frame, steel shelf, unitised glass,
  mega panel.
- *The working city* — powerhouse, cold store, brewery, foundry, grain house,
  gasholder, ship shed, textile mill, depot, pump house.
- *Modern working* — tilt-up, big shed, flex, quonset, cross-dock, self
  storage, data centre.
- *The buildings a town has one of* — queen anne, stick, tudor, mission,
  picture palace, diner, firehouse, school, library, bank, hotel, department
  store, motel, strip.

**11 plan families** (`build.mjs`) — courtyard, light court, dumbbell,
campanile, end towers, twins, cruciform, shifted stack, notched slab, chamfer
taper, twist.

**10 tower families** (`ThreeBuildings.ts`, >20 storeys) — vanderbilt, spiral,
exo, stack, carve, blade, shelf, curveslab, deepframe, twist.

**42 roof prop kinds** — the machine deck (bulkhead, lift overrun, cooling
tower, plant, tanks, PV, skylights, guardrail) plus the landmarks (steeple,
dome, cupola, clock stage, spire, smokestack, tank tower, sign letters, urns,
dormers, helipad, pergola, planters, greenhouse, flagpole, mast, dish farm,
davit, ventilators, chimney pots).

**Current audit** (`pnpm styles`, 12 cities — 2 towns x 6 seeds — 9,563
buildings, 144 facade families):

```
DEAD (unreachable by any input): none
untenanted (reachable, absent from these towns):
    diagrid (needs office 20fl 2000), skygarden (needs office 6fl 2015),
    megabrace (needs office 12fl 2000), pvclad (needs office 6fl 2015)
DOMINANT : none
top-5 share: 20.2%      (the two-family era was 71%)
office 72 families · retail 65 · multifamily 48 · industrial 33
```

That audit covers the stock a town STARTS with. For the other path — everything
the player and the rivals put up — see `tools/probe/slatesweep.mjs` in §7; it is
the same question asked of `setPlayerBuildings`, and it has to sweep seeds for
the same reason this one does.

---

## 3 · HOW TO ADD A BUILDING

Adding a facade family is six edits, all in `styles.ts` except the shader.
Miss any of the first four and it renders as flat grey; miss the fifth and it
never appears at all.

1. **A constant.** `export const S_THING = 82;` — next free id.
2. **Trait membership** in `styles.ts`. `T_MASONRY`, `T_GLASSY`, `T_TRADE`
   (does it meet the pavement as shops?), `T_FLOORLINE`, `T_ARCHED`,
   `T_MODERN` / `T_STONE` (which crowns it can wear), `T_OLDROOF` (can it grow
   a pitched roof?), `T_CAPPED_STONE` / `T_CAPPED_PLAIN` (what its parapet is
   made of).
3. **A palette branch** in `FRAG` — `wall`, `glassA`, `glassB`, `colW` (bay
   width in metres), `win` (opening as a fraction of the bay).
4. **A reveal depth** and **a roof colour**, both ladders in the same file.
5. **A pool entry** in `stylePool`, in the era and class it belongs to.
6. **Signature math**, optional but it is the whole point — see §5.

Then `pnpm styles` and check it is not DEAD.

Nothing extra is needed to reach the buildings the player puts up — that path
calls `styleForBuilt`, which is `stylePool` less `NOT_BUILT_TO_ORDER`. Add a
family to that set only if it is a thing a town HAS but nobody develops as an
investment: the parking deck, the substation, the bus canopy, the control
tower. It is a short list on purpose.

### Numbers that will bite you

- **Base albedo must stay under ~0.80.** Contrast runs in linear space about a
  0.18 pivot, so anything over ~0.85 clips to flat white before the light rig
  touches it. A glaze reads bright because it is *glossy*, not because it is
  pale. Four of these tables were over it and had to be pulled back.
- **Style ids are never compared numerically.** `s < 8` and `s <= 4` used to
  decide floor lines and shopfronts; both were correct for the ids that existed
  and silently wrong for every id added after. Ask by trait, always.
- **`win = vec2(0.0)` opts out of interior mapping.** Windows get rooms behind
  them for free; a shed or a blank wall must decline.
- **Never gate on `v.z1`.** That is the top of *this volume*, so a wedding cake
  takes two branches of the ladder and comes out in two materials with the seam
  at the setback. Gate on floors, which every volume of a building shares.

---

## 4 · WHY THE REGISTRY IS ITS OWN FILE

Every city here is generated from a seed, so *"does this family ever get
drawn"* is a question about a **distribution**, not about a screenshot. A
family gated behind a condition the generator never produces renders nothing,
compiles cleanly, and is invisible to every other check in the repo.

`styles.ts` therefore imports nothing from three.js, MapLibre, the DOM or a GL
context, which is what lets `tools/styleaudit.mjs` bundle it with esbuild and
run the **real chooser** over every building of every town across every seed.

`pnpm styles` calls three things faults:

| | |
|---|---|
| **DEAD** | no input anywhere can select it — dead code, exits non-zero |
| **rare** | under 0.1% — it exists and nobody will ever see it |
| **DOMINANT** | over 12% — the wallpaper problem, again |

It also separates two things a bare count cannot. A supertall skin drawing zero
in a harbour town whose tallest building is fourteen floors is **correct** —
the town has no towers, the player builds them, a later scenario will start
with them. So the audit sweeps the chooser over every `(class, year, floors)`
it will ever see and reports anything reachable-but-absent as **untenanted**,
printing the shape of building that would select it.

### Gates must be read off the stock, not off Manhattan

This is the single most common way a family ends up dead, and it happened four
separate times:

- **No industrial building in New Alden has five floors.** The class runs 2 at
  the quartile and 4 at the ninth decile, so `f >= 5` was unreachable.
- **A silo has no floors.** The generator gives every building a floor count
  because everything gets one, but a grain elevator is a thirty-metre drum.
  Gating it on floors gates it on a fiction.
- **Nothing is built before 1900.** Federal, Second Empire, the pump house and
  the carriage house were all gated to the century they were invented in and
  none of them could ever be chosen.
- **The town has four buildings over ten floors.** International Style, mirror
  glass and postmodern all wanted ten; six floors is the top decile here.

Measure first. `node -e` over `generateCity` + `buildCityData` takes seconds.

---

## 5 · WHAT MAKES A BUILDING READ

Colour is the last thing the eye uses. A type is made of **proportion and
depth** first — bay width, the shape of the hole, and how far back the glass
sits. Reveal depths in this codebase run from 28 mm (unitised glass) to 560 mm
(board-formed concrete) and that range does more work than every palette
combined.

Each family draws **one optical signature** — the thing you could name the
building by from across the harbour:

> the I-beam mullion · the pointed head · the wide Chicago window · the slab
> edge · the panel joint · the dock door · the giant order over a blind plinth ·
> the marquee · the deep frame · the balcony slot · six-over-six panes

The shader is deliberately in two halves, split at the `lod` dissolve. Above
it: **pattern** — window grids, bay hashing, transom bars, things made of
edges, which genuinely cannot be drawn at two pixels a floor. Below it:
**value** — tone, not edges, which is exactly what a facade still has at that
distance. New detail must go in the correct half or it will be averaged into a
flat colour before it reaches the screen.

**Reveal depth was in the wrong half for a while, and it is the biggest cue
there is.** All of it lived in the parallax and the per-pixel jamb shading, so
the far view got `mix(wall, glass, winFrac)` and the 28 mm to 900 mm range
collapsed into the palette. What depth is at two pixels a floor is three
things, all of them geometry and all of them below the dissolve now:

- a deep opening **hides its own glass** off-axis, because the jamb is in the
  way — depth times the tangent of the view angle, per axis, against the
  opening in metres;
- what glass you can still see **sees less sky**, by the form factor of its
  own slot (17% for a board-formed slot, 1% for a unitised lite);
- and the jamb **shadows the opening** when the sun runs along the wall.

Because that is measured against the opening in metres, `colW` and `win` reach
the far view too, where before only their product did.

### Measuring a far-LOD cue

An `sd` of luminance over the built pixels of a fixed frame is the cheap test:
a cue that works widens it, a palette change moves the mean and leaves it
alone. Two things make it honest. **Establish the noise floor** — shoot the
same build twice; the traffic and the pedestrians move, and here that is 2.0%
of built pixels and 0.008 of `sd`. **And check the metric can move** before
believing that it did: at 3x the coefficient, the reveal cue's reach goes from
9.3% of built pixels to 18.9% and `sd` from 37.77 to 38.75.

**Crowns are 29% of a tower's pixels** and roofs are 9.5% of the whole frame —
a bigger surface than the walls. "They all look similar" is almost always a
complaint about crowns, not facades.

---

## 6 · OWNERSHIP, WHILE MULTIPLE AGENTS ARE ON THIS BRANCH

`ThreeBuildings.ts` is shared. The split that has been working:

**Buildings agent owns** — `src/citygen/`, `src/map/styles.ts`,
`src/map/volume.ts`, and inside `ThreeBuildings.ts`: `FRAG`'s per-style
branches, `Mason` / `crownTop` / `roofDeck`, `fitRoofKit`, the `*Geom()` prop
builders, the tower kit, and `setPlayerBuildings`' massing.

**Graphics agent owns** — `render()`, `bakeShadows()`, the post stage,
`buildWater`, `plantStreets`, `buildLawns`, `propMaterial`, and the
`LIGHT` / `HAZE` / `SEASON` / `SHADOW` GLSL blocks, plus `src/map/style.ts`.

**Nobody on the map side touches** `Chart.tsx`, `RightPanel.tsx` or
`TopBar.tsx` — those belong to the UI session.

### Cross-boundary facts worth knowing

- `userData.noShadow` is honoured by the bake. Set it on anything that should
  not cast.
- **Geometry that moves in a vertex shader cannot be seen by the shadow bake** —
  `MeshDepthMaterial` replaces the vertex stage, so it bakes at the base
  instance position. Anything with a vertex-stage LOD must be `noShadow` too,
  or it leaves a full-size orphan shadow.
- `bakeShadows` fits the sun frustum on a `TALLEST` constant. Anything taller
  stops casting silently.
- Do not put opaque geometry at exactly `z = 0`; there is a depth-only
  occlusion floor at `z = -0.5` and water at `z = 0.01`.
- Any new `ShaderMaterial` including `SHADOW_GLSL` needs `uShadowSpan`.

---

## 7 · CHECKING YOUR WORK

```bash
pnpm styles                    # distribution audit; non-zero exit on DEAD
npx tsc -b                     # the shader is a string, so this proves nothing about GLSL
pnpm dev                       # then:
node tools/shoot.mjs http://127.0.0.1:5173/ out.png --wait 20000
```

`shoot.mjs` reports **GLSL compile errors and console exceptions in its output
line**, which catches a shader that merged into nonsense in about twenty
seconds instead of at the next visual review. Run it after every merge that
touches `ThreeBuildings.ts`.

To count what actually reached the scene rather than what the rules say should
have, prop meshes are named `prop:<kind>` and the wall mesh carries `aStyle`
per vertex. Both can be read straight off `map.getLayer("bw-three-buildings")`.

### Two probes, for the two things reading a diff will not tell you

Both are `--eval` scripts for `shoot.mjs`, in `tools/probe/`. Both want
`--profile <dir>` — a **fixed** browser profile, so the first run cuts a town
and every later one resumes its autosave. Without it `startRun` rerolls the
seed and each shot is a different city, which makes every before/after
comparison a comparison of two towns. `--verbose` prints the measurement;
without it you get the 200-character "did the shader compile" summary.

```bash
P=/tmp/bw-prof
node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/fp.png --wait 12000 \
  --profile $P --verbose --settle 6000 --eval "$(cat tools/probe/fingerprint.js)"
node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/slate.png --wait 12000 \
  --profile $P --verbose --settle 20000 --eval "$(cat tools/probe/playerslate.js)"
```

- **`fingerprint.js`** — mesh count, vertex count, the summed x and z of every
  position, and the vertex count per style id, over the whole scene. This is
  what makes an extraction reviewable: `Mason`, `crownTop` and `roofDeck` were
  all lifted out of the generator's closure and all three were checked to
  leave 164,330 vertices and 152 per-style counts *exactly* where they were.
  A refactor of code this shape cannot be eyeballed.
- **`playerslate.js`** — paints a controlled spread of classes, floors and
  years over a block of real parcels through `setPlayerBuildings`, then counts
  facade families and roof surfaces. That is what showed 6 facade families
  reaching the mesh where the registry offers 82. It is now 46 on the same
  slate, and 6 roof surfaces where the private ladder could reach 4. Nothing
  in the repo could see either number before, because `pnpm styles` only
  sweeps the generator.

**A test that cannot fail is itself a fake.** Before trusting that a number
moved, check that it *can* move — a gate on a condition the generator never
produces will report a confident, permanent zero.
