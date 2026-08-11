# BUILDINGS

What the city is made of, who owns which file, and how to check that any of it
is true. Companion to `ECONOMY.md`, which does the same job for the simulation.

**Cold start for a Claude Code / Opus graphics session:** read
`GRAPHICS_HANDOFF.md` first (paste block + ranked work list), then this file.

The rule this whole document exists to serve: **a building family that is never
drawn is dead code that compiles.** Six were found that way, and every one was
found by counting rather than by looking. `pnpm styles` is the counter.

---

## 1 · WHERE THINGS LIVE

| File | What is in it |
|---|---|
| `src/map/styles.ts` | The style registry: every facade family, the trait tables, and `stylePool` / `styleFor`, which decide what a given building wears. **Imports nothing from three.js or MapLibre** — that is deliberate, see §4. |
| `src/map/volume.ts` | `BuildingVolume`, the one record a building mass is described by. Its own file for the same reason. |
| `src/map/ThreeBuildings.ts` | The renderer. Facade shader (`FRAG`), roof shader (`ROOF_FRAG`), the crown block, the roof-prop kit, the tower kit, and the player-build path. |
| `src/citygen/build.mjs` | `massing()` — the silhouette a *generated* building stands as. |
| `tools/styleaudit.mjs` | `pnpm styles`. Runs the real chooser over every building of every town across every seed. |

**Two different code paths make buildings, and both need feeding.** The
generator (`build.mjs`) makes the stock a city *starts* with; the renderer's
`setPlayerBuildings` makes everything the player and the rivals put up
afterwards. A family added to one and not the other is half-missing, and the
audit will not catch it because the audit only sees the generator.

---

## 2 · WHAT EXISTS NOW

**82 facade families** (was 10, of which 2 carried 71% of the city).

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

**29 roof prop kinds** — the machine deck (bulkhead, lift overrun, cooling
tower, plant, tanks, PV, skylights, guardrail) plus the landmarks (steeple,
dome, cupola, clock stage, spire, smokestack, tank tower, sign letters, urns,
dormers, helipad, pergola, planters, greenhouse, flagpole, mast, dish farm,
davit, ventilators, chimney pots).

**Current audit** (`pnpm styles`, 2 towns × 3 seeds, ~5,800 buildings):

```
DEAD (unreachable by any input): none
untenanted (reachable, absent from these towns):
    diagrid (needs office 20fl 2000), steelshelf (needs office 6fl 2015),
    megapanel (needs office 6fl 2000)
DOMINANT : none
top-5 share: 30.5%      (the two-family era was 71%)
retail 40 families · multifamily 32 · office 40 · industrial 25
```

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

**Crowns are 29% of a tower's pixels** and roofs are 9.5% of the whole frame —
a bigger surface than the walls. "They all look similar" is almost always a
complaint about crowns, not facades.

---

## 6 · OWNERSHIP, WHILE MULTIPLE AGENTS ARE ON THIS BRANCH

`ThreeBuildings.ts` is shared. The split that has been working:

**Buildings agent owns** — `src/citygen/`, `src/map/styles.ts`,
`src/map/volume.ts`, and inside `ThreeBuildings.ts`: `FRAG`'s per-style
branches, the crown block, `fitRoofKit`, the `*Geom()` prop builders, the tower
kit, and `setPlayerBuildings`' massing.

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

**A test that cannot fail is itself a fake.** Before trusting that a number
moved, check that it *can* move — a gate on a condition the generator never
produces will report a confident, permanent zero.
