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
