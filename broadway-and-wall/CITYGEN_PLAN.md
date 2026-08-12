# City generator — plan to make towns 2–3× better

This is a plan, not a spec to dump in one PR. Brian asked for every idea that
is **doable** and would actually make generated cities feel two or three times
better than they do now. Work lands in three pieces. Do not start Landing 1
until this plan is accepted.

Read `CLAUDE.md` first. Realism outranks preference. No difficulty sliders. No
#85 cost/rent retune. No new hot-path engine `rng()` without `RNG-NOTE:` and a
baseline bump. Citygen uses its **own dice salts**, not engine `rng()` — but
anything that recuts lots still bumps `SAVE_VERSION`.

---

## 1. What “2–3× better” means

Not more street names. Not more façade tints. Not a longer word list.

A generated town is 2–3× better when **all four** of these are true:

1. **You can tell two seeds apart from the water.** One is a closed basin, one
   is a river town, one is a spit. Today every island is harbour + cove +
   estuary + headland with the same four lobes shuffled.
2. **You can tell two seeds apart from a walk.** Vacant dirt downtown is not
   the same gravel pad as a fringe lot. A cemetery is not a lawn with a
   different name. A harbour has a quay and a breakwater you can see, without
   putting toy docks back in the basin.
3. **You can tell two seeds apart from the tape.** Demand is not one hill
   around one address. A mill town and a ferry town price dirt differently
   because the *place* is different, not because a coefficient was nudged.
4. **The harbour reads as a port.** The owner rejected pier sheds, cranes, and
   silos. What is left today is a smooth blue bite. The fix is **shore shape
   and materials** (stone quay, slips, ferry notch, breakwater, marsh, beach),
   not furniture in the water.

If a change does not move at least one of those four, it is not in this plan.

---

## 2. What is already there — do not re-propose

The generator already draws programmes. Agents keep mistaking “I cannot see
it” for “it does not exist.” These are **done**:

| Programme | Where | What it does |
|---|---|---|
| Park programmes | `island.mjs` | great / squares / commons / greens / sparse |
| Boulevard character | `island.mjs` | grand vs arterial, widths vary |
| District layout kinds | `island.mjs` | organic / chamfer / superblock / curvi / radial / lattice |
| Lot conventions | `island.mjs` | burgage / fine / row / yard / villa — as **switches**, not a town-wide grain |
| Organic town | `island.mjs` | ~11% of seeds |
| Surveys and seams | `island.mjs` | 1–3 surveys; a cap of 2 seams binds on ~38/40 islands |
| Town hall + meeting house | `citygen.mjs` | on the hottest squares |
| Lighthouse + peak tower | `citygen.mjs` | every harbour town |
| Inland streams | **PR #96** (`cursor/civic-visuals-d634`) | creek / pair / canal / mill / none; mill pond; bridges |
| Civic lots on the map | **PR #96** | city buys vacant dirt for parks; stations and bridges draw |

**Landing 0 (dependency):** merge PR #96 before Landing 2. Streams recut lots
(`SAVE_VERSION` 35 on that branch). This plan is written against the engine
tip `claude/realestate-game-claude-code-32bppd` (`SAVE_VERSION` 34) plus that
PR. Do not re-implement streams here.

Creeks on #96 are still **short rectangles**. Finishing them so they read as
brooks, not canals, is in Landing 2.

---

## 3. Out of scope — do not chase

- Restoring pier sheds, quay cranes, moored ships, grain elevators. Owner
  rejected them. `PIERS_M = []` in `citygen.mjs` is deliberate.
- Fake uniqueness: more name lists, more façade tints, shuffling the same
  four coast lobes and calling it a programme.
- Difficulty sliders, #85 cost/rent retune, engine `rng()` on the hot path.
- Hills as Landing 1. MapLibre ground is flat; buildings sit at z = 0. A hill
  that only raises buildings looks like a bug. Terrain is Landing 3.
- A second copy of park programmes, boulevard character, or district layout
  kinds. Those exist. Make them **readable**, or add a *new* programme.

---

## 4. Why three landings, not one dump

Two kinds of work live in this plan:

- **Dressing** — paint, deco, vacant-lot meshes, park flavour. Same lot
  rings. Same deeds. Keep `SAVE_VERSION` if no new obstacles.
- **Geography** — coast, slips, lot grain, marsh as undevelopable ground,
  stream meanders that recut lots. One `SAVE_VERSION` bump, one refused
  generation of old campaigns.

Dumping both in one PR mixes a save break with a graphics pass, and you cannot
tell which change made the town better. Landing 1 is the dressing you can
ship without breaking saves (once #96 is in, stay on 35). Landing 2 is the
one geography break. Landing 3 is terrain plus demand shape — the hard
graphics and the hard economy, after the silhouette is worth looking at.

---

## 5. Landing 1 — dressing (no new obstacles)

**Goal:** two seeds look like different *places* from a walk, without moving
a single lot line.

**Save:** keep current `SAVE_VERSION` (35 after #96, 34 until then). If a
change accidentally recuts lots, it is a Landing 2 item — stop and move it.

### 1a. Public ground that is not “a park”

Same park rings. Different dressing.

- **Cemetery** — ordered trees, paths, a chapel deco, iron fence. Quiet.
- **Parade / battery** — open lawn, a gun or flagstaff, less tree cover,
  often on the harbour or a high square.
- **Market square** — hard paving, stalls as low deco, less grass. The
  square the town hall already sits on is the natural host.

Flavour is a field on the park record (`flavour: "cemetery" | "battery" |
"market" | "park"`). `pnpm variety` must show flavour is not 100% `"park"`.
`pnpm parkclear` still 0 overlaps.

Town hall and meeting house stay. Do not put a cemetery on the civic square
the hall sits on.

### 1b. One signature landmark per town

Not always hall + spire + light + peak. Every seed already has those. Add
**one extra**, rule-placed, from a short list:

- gasometer on the industrial fringe
- roundhouse near a rail park / station
- college row (three matching halls) on a quiet square
- stone church with a yard (not on the market square)
- mill is already on the pond in #96 — do not double it; skip this slot when
  the stream programme is `mill`

Own salt. Deco only (`base_bbl: ""`). `pnpm variety` counts landmark kind;
no single kind at 100%.

### 1c. Vacant lots that are not one gravel tile

Early game is mostly dirt. Today `ThreeBuildings.ts` dresses every vacant lot
as “gravel pad + low fence.”

Dress by **where the lot is**, not by a new random:

- **Downtown / old town** — gravel, fence, maybe a shed
- **Fringe / millside** — scrub, a few trees, no fence or a broken one
- **Residential** — grass, hedge, a garden bed on some lots
- **Civic land** (after #96) — already turf; leave it

No plat change. `k` / district / demand on the volume record is enough to
pick a dress. After this, `pnpm package:playable`.

### 1d. Shore that is not one material

MapLibre paint on the existing coast. No new obstacles.

- marsh in the cove (darker, reed-green water edge)
- beach on the open / seaward side
- seawall downtown (stone line along the harbour)
- rock under the lighthouse

`cfg` already knows harbour / cove / headland bearings. Paint from those.
`pnpm variety` should record that shore materials are not one class.

### 1e. Breakwater and quay as paint (not dock toys)

`island.mjs` already emits `cfg.breakwaters`. `citygen.mjs` sets
`BREAKWATERS = []` next to `PIERS_M = []` because the owner rejected harbour
*furniture*. A breakwater is a **wall in the water**, not a crane.

- Draw the existing breakwater config as a stone fill (MapLibre + a low
  Three deck), same as civic bridges on #96.
- Paint a quay line along the harbour inner shore (seawall from 1d can be
  the same layer).

Do **not** restore piers, cranes, ships, silos. If the breakwater polygon
would become an obstacle (it currently is not parcelled), keep it deco /
water overlay so lots do not move.

### 1f. Railway character without moving stops

Terminal sheds, a small goods yard deco, a ferry house on the cove — **on
existing parks / water**, not new stop coordinates.

Moving stops moves demand. That is Landing 3. This landing only changes what
you *see* at the stops that already exist.

### 1g. Make the survey seam readable

Surveys 1/2/3 already exist. The join often does not *look* like a decision.
Prefer **paint and naming** on the existing diagonal: a different street
width already in the reservation, a name that is not “the next numbered
street,” a row of trees.

Do **not** widen the reservation here — that recuts lots. If the only way to
make the seam visible is a wider obstacle, that item moves to Landing 2.

### 1h. Block interiors, if massing already allows it

`build.mjs` `massing()` already has courtyard families. If courts / mews /
churchyards can be **read on the map** without recutting lots, turn the
contrast up (deeper court, a passage deco). If it needs new lot rings, skip
it until Landing 2.

### Landing 1 done when

- Two seeds, same zoom, you can name the difference without opening the
  inspector (cemetery vs battery, gravel vs scrub, quay vs marsh).
- `pnpm variety` has new keys (park flavour, landmark kind, shore class)
  and none of them are 100% one value.
- `pnpm parkclear` still 0 overlaps.
- `pnpm check` green; engine `rng()` draw counts unchanged.
- `pnpm package:playable` refreshed.
- `SAVE_VERSION` unchanged.

---

## 6. Landing 2 — one geography break

**Goal:** two seeds look like different *islands* from the water, and the
harbour is a port in plan, not only in paint.

**Save:** bump `SAVE_VERSION` and `ISLAND_GROUND_MOVED_AT` **together** (lesson
from the 33/34 collision). After #96 that is 35 → 36. Refuse generated
campaigns from the previous ground. Document in `BASELINE_ATTRIBUTION.md`.
Regenerate the conserve baseline. `pnpm package:playable`.

Own salts for every new island draw. Do not append to the stream salt
(`0x57ea` / `Dwat` on #96) or names/parks/stations will shift for no reason.

### 2a. Coast programme (the big silhouette)

Today `profile()` in `island.mjs` **always** lays four lobes: harbour, cove,
headland, river. The seed only shuffles bearings.

Replace “always four” with a **programme**. Candidates that stay inside
`COAST_SLOPE_MAX` (4.6) and still take an esplanade:

| Programme | What you see | Hard part |
|---|---|---|
| Closed basin | Harbour almost enclosed, narrow mouth, breakwater reads | Slope at the horns |
| Spit / bar | Long arm, lagoon or back-bay | Offset / esplanade on a thin arm |
| River town | Estuary dominates; harbour is the river, not a second bite | Width floor vs depth |
| Two-lobe neck | Island pinched; two bodies of land | Lots on the neck; coverage |
| Classic (today) | Harbour + cove + estuary + headland | Keep as one of the programmes, not the only one |

This is the hardest item in the plan. Soften features with the existing
`soft` ladder rather than inventing a new coast. If a programme cannot seat
an esplanade, it is not a programme — drop it.

`pnpm variety` must show coast programme is not 100% classic. Coverage
(buildable share) must stay in the band the plat harness already accepts.
`pnpm parkclear` still 0.

### 2b. Waterfront orientation

Once the coast has a role, the **districts** should face it on purpose:

- mills and yards up the creek (pairs with #96 mill / canal)
- residential on the quieter shore
- docks / old town in the harbour or cove, not a random core

This recuts lots because cores and industrial bands move. Do it in the **same
save break** as 2a, not a second one.

### 2c. Harbour slips and a ferry notch

Not pier sheds. **Cuts in the shore**: a few rectangular bites in the harbour
inner wall (slips), and a small ferry notch in the cove. These are coast, so
they are obstacles. Same `SAVE_VERSION` as 2a.

Keep them few and large enough to read at play zoom. A dozen hairline cuts
will look like noise.

### 2d. Lot-grain programme

Burgage / villa / yard already exist as per-district switches. They do not
run the town. Draw a **grain programme** (burgage old town + villa fringe,
or fine grid everywhere, or yard lots on the mill creek) so two seeds have
different *parcel* character, not only different street names.

Recuts lots. Same save break.

### 2e. Stream meanders (finish #96)

Replace short convex rectangles with a polyline of overlapping capsules or
a thicker meander so a creek reads as a brook. Keep `STREAM_CLEAR`, bridge
gaps, mill pond. Own salt already exists — **do not re-salt** if the only
change is the polygon construction from the same path; if the path itself
changes, that is a new salt or a documented shift of `Dwat` with the save
bump.

### 2f. Optional, only if 2a has room

- **Marsh as undevelopable obstacle** in one cove (not just paint). One
  programme, not every island.
- **Causeway reservation** toward the map edge (a rail or road that implies
  the rest of the world). Obstacle. Makes the snow-globe less sealed.
- **Readable seam as a wider reservation** if 1g was not enough.

### Landing 2 done when

- Forty islands: coast programme distribution is not one shape.
- A closed-basin seed and a river-town seed are obvious at the default zoom.
- Harbour inner shore has slips or a quay wall you can point at.
- `pnpm variety`, `pnpm parkclear`, `pnpm check` green.
- Baseline regenerated; attribution names the plat change (lots, not engine
  `rng()`).
- Old generated saves refused with the island-moved reason.
- `pnpm package:playable`.

---

## 7. Landing 3 — terrain and demand

**Goal:** the town is a set of places, not one hill, and the ground is not a
table.

Do this **after** Landing 2. A hill on four identical coast lobes is still
the same town with a bump. A second demand centre on a silhouette you cannot
name is a spreadsheet change the player cannot see.

### 3a. A hill, or none

MapLibre ground, streets, and building bases must rise **together**. If only
meshes rise, lots look like they float. Own pass. Some seeds stay flat
(reclaimed harbour, mill flats). Some have one ridge or a headland that is
actually high.

This is graphics-hard. Budget it as its own PR inside the landing. Measure
picking / camera so a lot on the hill is still clickable.

### 3b. A second centre that is actually a centre

`island.mjs` already admits demand piles on one place (heat + railway both
mean downtown). Owner: all the demand surrounding one specific place.

Fix in `build.mjs` demand blend: a real second core (mill, ferry, rail
junction) with its own heat, not a 10% bump on the same hill.

**Harness:** `pnpm demandshape`. Headline is correlation of demand vs
distance to the single best point. Near 1.0 is one hill. A city of
neighbourhoods is several peaks (radius in **metres**, not degrees — that
bug is written into the harness). Peaks must be far enough apart that a
player would name two districts, not two adjacent blocks.

Do not fake this with a clamp. If the railway and the harbour are the same
place, moving a number will not create a second town.

### 3c. Railway stop programmes (now the stops may move)

Terminal vs through vs belt vs ferry. This **moves demand**. Measure
`pnpm demandshape` and station injection (`pnpm station` after #96) so value
does not collapse to one corner of the island.

Own salt. If stops move, lots may not, but prices will — document it. If a
stop’s park / head-house needs a new lot, that is a save bump; prefer
reusing existing parks.

### Landing 3 done when

- `pnpm demandshape`: correlation clearly weaker than today’s one-hill
  baseline; more than one peak on most seeds; peaks in metres.
- At least some seeds have visible relief (hill + flat programmes).
- `pnpm check` green; baseline attribution if plat or demand blend moved.
- `pnpm package:playable`.

---

## 8. Suggested PR sequence (inside the landings)

Do not open one PR per bullet. Group by what shares a save bump and a
harness.

| PR | Landing | Contents |
|---|---|---|
| A | 1 | Park flavours + landmark + vacant-lot dress |
| B | 1 | Shore materials + breakwater/quay paint + rail deco + seam paint |
| C | 2 | Coast programme + waterfront orientation + slips/notch (**the save bump**) |
| D | 2 | Lot-grain programme + stream meanders (+ optional marsh/causeway) |
| E | 3 | Second demand centre + rail stop programmes |
| F | 3 | Hill / terrain |

A and B can ship in either order. C is the dangerous one. E before F: demand
shape is visible on a flat map; a hill without a second centre is still one
town.

---

## 9. Files an agent will actually touch

| File | Landings |
|---|---|
| `src/citygen/island.mjs` | 1 (flavour, landmark slot, shore roles), 2 (coast, grain, marsh), 3 (cores / stations) |
| `src/citygen/citygen.mjs` | 1 (deco, breakwater draw), 2 (stream polygons, slips) |
| `src/citygen/cities.mjs` | scale new cfg fields |
| `src/citygen/build.mjs` | 1h massing, 3b demand blend |
| `src/map/style.ts` | shore paint, breakwater, marsh/beach |
| `src/map/MapView.tsx` | 3D water / civic / terrain wiring |
| `src/map/ThreeBuildings.ts` | vacant lots, landmark meshes, quay/breakwater decks |
| `src/map/civic.ts` | only if civic dressing needs it (after #96) |
| `src/engine/save.ts` | Landing 2 (and 3 if lots move) |
| `test/citygen-variety.mjs` | every landing — new keys, fail if 100% one shape |
| `test/park-clearance.mjs` | 1a, 2 |
| `test/demandshape.mjs` | 3b, 3c |
| `test/station-access.mjs` | 3c (after #96) |
| `BASELINE_ATTRIBUTION.md` | every plat or demand-blend change |

---

## 10. Standing rules for whoever builds this

1. **Own salts.** New island draws get a named salt and a comment. Do not
   append to an existing stream of `rand()` or names/parks/stations shift.
   Comment `RNG-NOTE:` only if engine `rng()` is involved (it should not be).
2. **If lots move, bump `SAVE_VERSION` and `ISLAND_GROUND_MOVED_AT` together.**
   Refuse old generated campaigns. Continue-path / principal-phase12 follow.
3. **Measure before believing.** `pnpm variety` is the uniqueness ruler.
   `pnpm demandshape` is the demand ruler (metres, not degrees).
   `pnpm parkclear` is the overlap ruler. `pnpm check` is the conserve ruler.
4. **After map/citygen visuals:** `pnpm package:playable`.
5. **Do not restore dock toys.** Breakwater and quay are the harbour. Piers,
   cranes, ships, silos stay off.
6. **Work only under `broadway-and-wall/`.** Preferred engine tip until this
   lands: merge onto `claude/realestate-game-claude-code-32bppd` (or the
   owner’s current Broadway & Wall tip). Do not stack this on a stale
   Groundwork / Meridian tree.
7. **#96 first** for anything that assumes inland streams, civic lots, or
   `SAVE_VERSION` 35.

---

## 11. What this plan is not claiming

It will not make forty cities that look like forty real metros. It will make
the generator **choose a kind of town** — coast, public ground, grain, rail,
shore — and then dress that choice so a player can see it from the water,
from a walk, and from the tape.

That is the 2–3×. Everything else is noise.
