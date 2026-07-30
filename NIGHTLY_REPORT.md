# Nightly report — ambient city pass

All work is view-layer only: no engine edits except two pure additions from the
earlier portrait session, no GameState changes, no save bump. `npx tsc -b` and
`node tools/simtest.mjs` ran green before every commit. One commit per item
(three small interaction items shipped in one final commit — itemized in its
message; everything else reverts independently).

## The knob

`◦ off/low/med/high` in the map toolbar (default **med**, persisted in
localStorage, never in the save). **Off** silences everything below *and* the
pre-existing street/water life, so one click returns the map to a clean
technical drawing. `prefers-reduced-motion` freezes every ambient animation
(rain, train, migrations, pulses, camera easing, momentum) via one CSS block +
runtime checks.

## Node budget

Measured `document.querySelectorAll('.map-svg *').length`, 1440×900, fresh
New Amsterdam campaign.

| State | Nodes |
|---|---|
| **Baseline before the pass** — zoomed out (1.25×) | **5,639** |
| Baseline max zoom — *mismeasured*, see below | — |
| Corrected baseline max zoom (day, ambient additions ≈ 0) | ~14,300 |
| After: zoomed out, day, med | 5,841 |
| After: zoomed out, night, med | 6,075 |
| After: zoomed out, night, high | 6,074 |
| After: max zoom (8×), night, med | 16,684 |
| After: max zoom, ambient **off** | 13,717 |

Zoomed-out budget was 1.3 × 5,639 ≈ 7,330 — worst case lands at **6,075 (+7.7%)**.
Honesty note: my first "max zoom" baseline (5,688) was garbage — the Playwright
locator for "+" matched your **+6 mo** button, so it measured months, not zoom.
Re-derived the max-zoom baseline afterward on a build where ambient adds nothing
at day/zoomed-in-day (~14.3K). Max-zoom night runs ~+2.4K over that (lamp pools,
window grains, furniture); the brief only bounded zoomed-out, but it's recorded
here so you have it.

## What was built (flag level = minimum Ambient Detail)

**Tier B (done first, as ordered)**
- **Day/night from the calendar** — 8-month cycle (3 day / dusk / 3 night /
  dawn) off `state.month`. Dusk/dawn are multiply tints; night adds a veil and
  re-lights the city above it: seeded window grains per building, count follows
  occupancy, size follows zoom bucket; pooled lamplight on arterials at detail
  zoom. Tint **Low**, lights **Med**.
- **Seasons** — lawn/park/canopy palettes per season, bare shrunken winter
  trees, straw fall, snow on flat roofs (**Med**), longer winter shadows.
  Colors **Low**.
- **Weather** — seeded per month: ~1-in-5 rain (ground multiply + wet road
  sheen; streak lines at **High**), ~1-in-8 fog (low-zoom sit-down that lifts
  as you zoom). Legend chip names the weather. **Med**.
- **Sky/ambient tint** — folded into the phase tints; no separate layer.

**Tier A**
- **Sidewalks + curbs** both sides of every street, under the asphalt, detail
  zoom only. **Low.**
- **Surface parking** in the unbuilt slack of yard-fabric commercial parcels:
  striped stalls, cars ∝ occupancy, empty lots on dead buildings. **Med.**
- **Vacant lot texture** — gravel, weeds (season-tinted), chain-link runs,
  ≤6 blank billboards; City lens only so data lenses stay clean. **Med.**
- **Street furniture** — arterial median planting, bus shelters + benches
  (**Med**); hydrants, leaning utility poles with sagging wire on D<45 blocks,
  dumpsters against street-wall buildings (**High**).
- **Street trees follow desirability** — +2 canopy where D>70, thinned bare
  where D<45. **Low** (rides existing tree layer).
- **Dock striping** — painted bay ticks on truck aprons (buildingArt).

**Tier C**
- **Distress** — plywooded ground floors when occ<20% and old; graffiti tags at
  reach height on crime>60 blocks (needed a `hiCrime` flag threaded through the
  art params — read-only). Wall tone by age/quality: fresh deliveries read
  conspicuously clean, old cheap product dingy. Rides detail-zoom facades.
- **FOR LEASE banners** (occ<30%, capped 14) and **SOLD cards** (1 month after
  any comp). **Low.**
- **Survey stakes + site sign** for diligence/design phases (progress <5%);
  active sites gained a **site trailer + staged material** inside the existing
  fence/crane scene.
- **Scaffolding + netting** on renovations/repairs/capital programs.
- **Police cruisers** (lightbar, capped 10) on crime>65 blocks. **Med.**
- **Traffic ∝ adjacent employment**, **pedestrians ∝ retail frontage**. **Low.**
- **The freight train moves** — 26s shuttle along the mainline, static under
  reduced-motion.

**Tier D**
- **Eased button zoom / fit** (~250ms easeOutCubic; wheel stays incremental),
  **pan momentum** with decay, **eased fly-to** on located news (~460ms).
- **Hover** — parcel lifts 1.6px and outlines amber.
- **Pulse ring** on listings in their first month (reused tile-pulse, slowed,
  looped, green).
- **Migration arrows stream** along their dashes.

## Skipped, and why

- **Curb cuts at driveways** — needs per-parcel driveway geometry that doesn't
  exist; the payoff at map scale is a 1px notch. Not worth the nodes.
- **Alleys as drawn geometry** — blocks are solid parcel grids; a fake alley
  line would contradict the parcel weave the player interacts with. Dumpsters
  carry the "serviced from the side" read instead.
- **Ghost massing while configuring in the dev modal** — the dev memo is a
  drawer over the map; wiring live config → map ghost crosses the modal/map
  boundary and I didn't want to rush that plumbing at night. The assembly-flow
  ghost (pre-purchase) already covers half the value. Recommend as a daytime
  item.
- **Delivery pop-and-settle** — no clean "delivered this month" identity on the
  view side without tracking state I'd have to invent; deliveries do already
  pulse via the news-tile pulse. Punted rather than half-fake it.
- **Parallax on pan** — tried on paper, rejected: the iso projection already
  encodes depth, and translating building layers against the ground shears the
  geometry (buildings visibly detach from their parcels). I think it would look
  worse, not better.
- **Transit-corridor train** — the corridor is a staircase path; animating along
  it needs per-segment path animation, not a CSS translate. Freight line moves;
  metro doesn't. Fine as a follow-up.
- **Stop bars at intersections** — crosswalks already existed (your "already
  exists" list undersold them slightly: crosswalks, streetlights, street trees
  and pedestrian dots were present at detail zoom before tonight — I extended
  them per the brief instead of duplicating: lamps got night pools, trees got
  desirability + seasons, peds got retail scaling).

## What I think looks bad (honest)

- **Night window grains at 8× zoom** float a pixel or two off narrow towers —
  they're scatter, not face-aligned. I tightened the spread and halved their
  count at detail zoom (buildingArt's real lit windows + lamp pools carry the
  close-up), but if you zoom to 8× at night and stare, you'll see a grain
  hanging in air occasionally.
- **Winter reads slightly flat** — frost-grey lawn + grey trees is honest but
  drab at low zoom; snow caps only read once you're past ~1.7×. A light
  ground-snow mottle might help; I stopped short of painting the whole city
  white.
- **Sidewalks on every local street** make the far-out-but-not-detail zoom
  band (1.7–2.3×) slightly busier than I'd like; they're detail-gated so it
  only shows in that transition band's upper edge.
- **The fog is very quiet.** Deliberate (it must not hide banners), but you may
  read it as "the map got 15% greyer" rather than weather. The legend chip is
  doing real work there.
- **SOLD cards use the big banner chrome** — at 10+ trades in a hot month it
  can get chatty even capped. If it annoys you, revert `FOR LEASE banners and
  SOLD cards` alone.

## Commits (revert targets)

1. `Ambient detail setting` — the knob + reduced-motion CSS
2. `Day/night cycle tied to the calendar`
3. `Seasons: the ground follows the calendar`
4. `Weather passes: rain and fog, seeded by the month`
5. `Sidewalks and curbs along every street`
6. `Surface parking with striped stalls, cars by occupancy`
7. `Vacant lot texture: gravel, weeds, chain-link, billboards`
8. `Street furniture: medians, bus stops, hydrants, poles, dumpsters`
9. `Dock bay striping + street trees follow desirability`
10. `Distress, wear, scaffolding, and visible pre-construction`
11. `FOR LEASE banners and SOLD cards`
12. `Traffic follows jobs, pedestrians follow retail, cruisers follow crime`
13. `The freight train moves`
14. `Camera and map feedback: eased zoom, momentum pan, fly-to, hover lift, listing pulse, flowing migrations`
