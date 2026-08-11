# GRAPHICS & BUILDING DESIGN — handoff

The brief for a **pure presentation pass**: massing, façades, roofs and crowns,
LOD, atmosphere. Not economy, not desk UI.

Companion to `BUILDINGS.md`, which is the reference — families, traits, the
audit, how to add a skin. This file is the *brief*: scope, order of work, and
what has already been taken.

---

## 0 · SCOPE, AND THE THREE LINES THAT DEFINE IT

**In.** `src/citygen/`, `src/map/styles.ts`, `src/map/volume.ts`, and inside
`src/map/ThreeBuildings.ts`: `FRAG`'s per-style branches, `Mason`, `crownTop`,
`roofKitWants`, `roofDeck`, `propKit`, `fitRoofKit`, the `*Geom()` prop
builders, the tower kit, and `setPlayerBuildings`' massing.

**Not yours, on the map side.** `render()`, `bakeShadows()`, the post stage,
`buildWater`, `plantStreets`, `buildLawns`, `propMaterial`, and the `LIGHT` /
`HAZE` / `SEASON` / `SHADOW` GLSL blocks, plus `src/map/style.ts`. Those belong
to whoever is doing atmosphere.

**Not yours at all.** `src/engine/` — money, rents, debt, rivals RNG, harness
baselines. And `TopBar.tsx`, `RightPanel.tsx`, `Chart.tsx`.

Repo rules first: root `AGENTS.md`. Game code is only under
`broadway-and-wall/`. Do not restore Groundwork / Meridian / root `src/`.

---

## 1 · THE STACK, IN ONE PARAGRAPH

MapLibre owns the camera, the ground, the parcels and the picking. A Three.js
custom layer paints every building as a real mesh with a procedural façade —
window grids aligned to actual floor counts, view-dependent sky on glass,
cornices, crowns, rooftop furniture. **Two code paths make buildings.** The
generator (`src/citygen/build.mjs` → `buildCity`) makes the stock a town
*starts* with; `setPlayerBuildings` makes everything the player and the rivals
put up afterwards, which after twenty years is most of downtown. Read
`BUILDINGS.md` §1 before touching either.

```bash
cd broadway-and-wall
pnpm install
pnpm dev                 # → 127.0.0.1:5173   (remote: --host 0.0.0.0 --port 5173)
```

---

## 2 · AFTER EVERY `ThreeBuildings` TOUCH

```bash
npx tsc -b                                        # proves nothing about GLSL
pnpm styles                                       # if styles/pools changed
node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/bw-shoot.png --wait 20000
```

**`tsc` does not catch GLSL string errors.** The shaders are template
literals; a merge that turns one into nonsense compiles clean in TypeScript and
renders a black layer. `shoot.mjs` reports GLSL compile errors and console
exceptions on its output line, in about twenty seconds. Run it.

For anything you intend to *claim*, see §5 — the eyeball is not a measurement
and this document has already been wrong once because somebody trusted it.

---

## 3 · MEASURE BEFORE YOU BELIEVE ANY NUMBER IN HERE

`BUILDINGS.md` §2 said **82 facade families** for long enough that the number
reached commit messages and source comments. It was **144** by then, out of 152
`S_*` ids. Nothing was lying; the code had moved and the prose had not.

```bash
pnpm styles                                       # first line prints the count
grep -c '^export const S_' src/map/styles.ts      # id count
```

Neither takes a second. Treat every count in every doc here — this one
included — as a claim with a date on it.

---

## 4 · WHERE THE LEVERAGE IS

Ordered by pixels moved per line changed. The first three are **done**; they
are written up because the *reasoning* is the reusable part, and because the
fourth item is what is left.

### ✅ 4.1 · `setPlayerBuildings` vs the registry — done

The single biggest thing wrong with the picture, and invisible from any
screenshot of one building. That path had grown a private copy of five
decisions `styles.ts` already owned:

| decided | had | has |
|---|---|---|
| façade | six hard-coded ids off the asset class | `styleForBuilt` |
| era | a fixed 1992-2017 band | the delivery year the engine stamps |
| roof surface | four of nine, off the deed hash | `roofDeck` |
| crown | **nothing at all** | `crownTop` |
| roof furniture | four of forty-two, four coin flips | `roofKitWants` + `propKit` |
| corner shading, deck edge distance | every corner convex, constant 4 m | `Mason` |

Three of the six façade ids were also era-wrong for a building finished *this
month*: new retail came out as mid-century ribbon glazing, new industrial as
19th-century mill sash, one office in seven as 1920s deco piers.

**The general rule this leaves behind.** When you add a decision to one path,
the reviewable question is not "does it look right", it is **"which function
owns this, and is the other path calling it"**. None of the six could fail a
test, because there was no second opinion to disagree with. They were found by
asking both paths the same question and diffing the answers.

### ✅ 4.2 · Crowns and the roof kit — done

Crowns are 29% of a tower's pixels and roofs are 9.5% of the whole frame, which
is more surface than the walls. *"They all look similar"* is almost always a
complaint about crowns rather than façades.

The player's buildings ended at a bare plane with one grey box on it. Twelve
crown families existed and none was reachable — for a mechanical reason worth
remembering: the masonry primitives were **closures inside the generator's
rebuild loop**, so the ladder could not be reached because the trowel could not
be. `Mason`, `crownTop`, `roofKitWants`, `roofDeck` and `propKit` are module
level now and both paths call them.

### ✅ 4.3 · Far-LOD value signatures — done for reveal depth

A floor is about two pixels tall at the camera this game sits at, so the window
grid has to dissolve before it aliases. Above the dissolve: **pattern**. Below
it: **value**. Anything in the wrong half is averaged into a flat colour before
it reaches the screen.

Reveal depth was in the wrong half, and it is the strongest cue there is — 28
mm to 900 mm across the families. All of it lived in the parallax and the
per-pixel jamb shading, so the far view got `mix(wall, glass, winFrac)` and the
whole range collapsed into the palette. What depth *is* at two pixels a floor
is three things, all geometry: a deep opening **hides its own glass** off-axis,
what glass you still see **sees less sky**, and the jamb **shadows the opening**
when the sun runs along the wall. See `BUILDINGS.md` §5.

### ◐ 4.4 · Mid-rise silhouette — half done

Below the twenty-floor tower gate, `setPlayerBuildings` had five silhouettes
and **every one was the plate scaled toward its own centroid**: podium,
setback, three-stage wedding cake, tower on podium, prism. That is the
1916-to-1961 envelope, and it is the wrong shape twice over for a building
finished after 2000 — it puts the top of every building directly over the
middle of its bottom, and it steps back on all four sides including the two
that are party walls a neighbour is standing against.

**Done.** Three of the eight shapes are no longer centroid scales — the shaft
travels to one end of the plate's deep axis, a slab narrows on *one* axis
(which is what a mid-rise apartment building is, and which a uniform scale
cannot make), and a chamfered shaft takes its corners off. The wedding cake is
now the rare answer for a tall building on a big plate rather than a third of
everything. Measured on 45 buildings over 22 m: off-centre 9% → 31%, shifted
more than 3 m 0% → 9%, plan aspect changed 2% → 9%. The 9/0/2 baseline is the
tower kit, which already did this and which nothing below it could reach.

**Left, and worth more than what was taken.**

- **Which end is the street.** The shaft steps back toward one end of the deep
  axis and *which* end is hashed off the deed, because this layer has the lot
  ring and not the street graph. A block reads best when every shaft steps back
  from the same side; right now half of them step toward the street. Wiring the
  frontage through is the single biggest remaining win in massing.
- **The plan families.** The generator has eleven (`build.mjs` — courtyard,
  light court, dumbbell, campanile, end towers, twins, cruciform, shifted
  stack, notched slab, chamfer taper, twist) and `setPlayerBuildings` reaches
  none of them. A courtyard block and a dumbbell are ordinary mid-rise plans
  and the player cannot build either. `capRoof` already takes a holes argument
  and is always passed `[]`, which is most of what a courtyard needs.
- **How much of what a player builds lands in this band** is not measured.
  Measure it before sizing any of the above.

### 4.5 · Candidates after that, unranked and unmeasured

- **Ground floor at distance.** The shopfront band survives the dissolve as
  tone; the *plinth*, the stoop and the areaway do not. A masonry street reads
  as a wall meeting the pavement at a line, and it does not have one yet.
- **Trait-driven prop selection.** `roofKitWants` gates on `style ===` in
  several places where it should ask a trait — the exact fault `BUILDINGS.md`
  §3 warns about for façades, one layer up.
- **Setback terraces.** Lower tiers get a flat cap and nothing else. A real
  setback is where the plant, the terrace and the water tank actually live.

---

## 5 · HOW TO KNOW YOU DID SOMETHING

Three probes, all in `tools/probe/`, all `--eval` scripts for `shoot.mjs`. The
first two want `--profile <dir>` — a *fixed* browser profile, because
`startRun` rerolls the city seed and a fresh profile is therefore a **different
town**, which makes every before/after pair a comparison of two cities.

| | answers |
|---|---|
| `fingerprint.js` | did this extraction change any geometry — 164,330 vertices, summed positions, per-style vertex counts |
| `playerslate.js` | what does `setPlayerBuildings` actually reach, in one town |
| `slatesweep.mjs` | ...and across random towns on both islands |

```bash
P=/tmp/bw-prof
node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/fp.png --wait 12000 \
  --profile $P --verbose --settle 6000  --eval "$(cat tools/probe/fingerprint.js)"
node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/slate.png --wait 12000 \
  --profile $P --verbose --settle 20000 --eval "$(cat tools/probe/playerslate.js)"
node tools/probe/slatesweep.mjs 3            # 6 fresh towns; ~45s each
```

### One town is a screenshot

This is the same argument that put `styles.ts` in its own file. Every city here
is generated from a seed, so *"which families does this draw"* is a question
about a **distribution**. `pnpm styles` sweeps 12 cities for the generator;
`slatesweep.mjs` is that question asked of the player path, and it has to sweep
for the same reason. A family absent from a harbour town whose tallest building
is fourteen floors is **correct**, and you cannot tell that from broken without
more than one town.

Pin the seed for an A/B. Sweep it for a claim. Do not confuse the two.

### And check the measurement can move

Before believing a number moved, check that it *can*. A gate on a condition the
generator never produces reports a confident, permanent zero, and a metric
pinned at a cap measures the cap.

For anything read off the frame, **establish the noise floor first** — shoot
the same build twice. The traffic and the pedestrians move; here that is 2.0%
of built pixels and 0.008 of luminance `sd`. Then exaggerate your own
coefficient and confirm the metric follows: the reveal-depth cue goes from 9.3%
of built pixels to 18.9% at 3x, which is what makes the 9.3% believable.

---

## 6 · TASTE

- **Proportion and depth before hue.** Bay width, the shape of the hole, and
  how far back the glass sits do more work than every palette combined. A new
  colour table is almost never the answer.
- **One optical signature per family** — the thing you could name the building
  by from across the harbour. The I-beam mullion, the pointed head, the wide
  Chicago window, the slab edge, the dock door, the marquee.
- **Base albedo under ~0.80.** Contrast runs in linear space about a 0.18
  pivot; anything over ~0.85 clips to flat white before the light rig touches
  it. A glaze reads bright because it is glossy, not because it is pale.
- **Ask by trait, never by id.** `s < 8` was correct for the ids that existed
  and silently wrong for every id added after.
- **Small, reviewable commits.** An extraction that is verified geometry-neutral
  is its own commit; the change that exploits it is the next one.
