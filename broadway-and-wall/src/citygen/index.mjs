// A CITY, FROM A NUMBER.
//
// `makeCity("somewhere", 481923)` is the whole content pipeline in one call:
// generate the geometry, turn it into the game's substrate, hand back the
// parcel table, the adjacency graph, the map layers and the skyline. About
// 350ms, no network, no files.
//
// Every island is generated. island.mjs draws the coast, the cores, the
// district plan, the parks, the piers, the railway and every name on the map
// from the run's seed, and hands back a config of exactly the shape the
// generator expects. Nothing below this line knows or cares that the config
// was computed rather than written down — the same scaleCity scales it, the
// same generateCity cuts it, the same buildCityData tabulates it.
//
// The seed is the address. A city is `(island, seed, size, build-out)` and
// every one of those has to survive a reload, or a deed in a save points at a
// parcel that no longer exists. Roll the seed and you get a different coast
// AND a different town on it; keep it and you get the same island back on
// every reload, forever, down to the byte.
import { generateCity } from "./citygen.mjs";
import { buildCityData } from "./build.mjs";
import { SIZES, DEFAULT_SIZE, scaleCity } from "./cities.mjs";
import { islandConfig, islandName } from "./island.mjs";
import { MANHATTAN, manhattanConfig, manhattanName, EXTENTS, DEFAULT_EXTENT, extentList, loadManhattanPlat, setManhattanPlat } from "./manhattan.mjs";

export { SIZES, DEFAULT_SIZE };
export { MANHATTAN, EXTENTS, DEFAULT_EXTENT, extentList };
// for the town worker, which cannot fetch the plat itself from the single-file build
export { loadManhattanPlat, setManhattanPlat };

/**
 * Fetch whatever a city needs before `makeCity` can build it synchronously.
 * A generated island needs nothing; Manhattan needs its baked plat, which is
 * kept out of the main bundle (see manhattan.mjs). Idempotent.
 */
export async function preloadCity(cityId) {
  if (cityId === MANHATTAN) await loadManhattanPlat();
}

/** The sizes an island can be built at, for the picker. */
export function sizeList() {
  return Object.entries(SIZES).map(([id, s]) => ({ id, ...s }));
}

/**
 * HOW BUILT-UP THE TOWN IS ON DAY ONE, for the picker.
 *
 * A subset of DENSITY in citygen.mjs — that table has nine entries and some of
 * them are historical calibration points rather than places anyone would
 * choose to play. These are the ones that read as different towns. `village`
 * is the default and is exactly the town the game has always shipped; every
 * other entry is a stated move away from it in BOTH height and build-out,
 * because a town that has not been built up yet is not merely shorter, it has
 * gaps in it.
 *
 * The numbers in the notes are measured on the standard island, seed 20261.
 */
export const DEVELOPMENT = [
  { id: "landing",    name: "Landing",     note: "Two thirds of the plat is still grass. One-storey fabric, nothing above four floors, and a harbour. You are not buying a city here — you are watching one start." },
  { id: "frontier",   name: "Frontier",    note: "A town that has begun. Over half the lots are empty, the ordinary building is two storeys, and the tallest thing in it is a warehouse." },
  { id: "village",    name: "Young town",  note: "The standard opening. Two fifths of it unbuilt, three-storey fabric, and nothing over fourteen floors yet." },
  { id: "town1900",   name: "Working town", note: "It has filled in around the harbour. A third still vacant, and the first buildings over twenty floors." },
  { id: "provincial", name: "Provincial",  note: "A working town that has grown up. Thirty per cent vacant, and a few thirty-floor buildings downtown." },
  { id: "harbour",    name: "Established", note: "A real skyline and less dirt — 27% vacant, four-storey fabric, towers to forty floors." },
  { id: "spiky",      name: "Boomtown",    note: "Low fabric, dramatic towers. A town that boomed once and stopped — a third of it still gaps, beside forty-seven floors." },
  { id: "capital",    name: "Capital",     note: "Built up and tall. A fifth vacant, five-storey fabric; you will be redeveloping more than you are building." },
  { id: "metropolis", name: "Metropolis",  note: "14% vacant and towers past sixty floors. Very little dirt left — this is a game about buying what exists." },
];
export const DEFAULT_DEVELOPMENT = "village";

export function developmentList() {
  return DEVELOPMENT.map((d) => ({ ...d }));
}

/**
 * THE GENERATED ISLAND.
 *
 * This is an id like any other as far as everything downstream is concerned —
 * the autosave slot is `auto@somewhere`, the seed lives at `bw:seed:somewhere`,
 * and `makeCity("somewhere", seed, …)` is a pure function of its arguments.
 * The config it builds from is computed from the seed instead of written down.
 */
export const PROCEDURAL = "somewhere";

/** Fixed reference seed for harnesses and BASELINE.json — a stable town, not a special island. */
export const REFERENCE_SEED = 1;

/**
 * The cities you can play. There is one kind of island and it is generated.
 */
export function cityList() {
  return [
    {
      id: PROCEDURAL,
      name: "Somewhere else",
      tagline: "An island nobody has drawn. The coast, the districts, the parks and every street name come out of your seed.",
    },
    {
      id: MANHATTAN,
      name: "Manhattan",
      tagline: "The real one, lot for lot: every block, tax lot, BBL and street address from the city's own records, the real parks, shoreline and subway.",
      /** A written-down city takes an EXTENT rather than a size — see manhattan.mjs. */
      extents: true,
    },
  ];
}

/**
 * What the island at a given seed is CALLED, without building it.
 *
 * The picker cannot show this before the run starts — the seed is rolled when
 * Break ground is pressed — but a saved campaign carries its seed, so the
 * Continue row can name the town instead of saying "Somewhere else" about a
 * place the player has lived in for twenty years.
 */
export function cityName(cityId, seed, opts) {
  if (cityId === PROCEDURAL) return islandName(seed);
  if (cityId === MANHATTAN) return manhattanName(opts?.size);
  return cityId;
}

/**
 * A seed that is a real number in the JS sense and a plausible one in the
 * game's: unsigned 32-bit, never zero (mulberry32 with a zero seed is a
 * perfectly fine sequence but a zero in a save reads like a missing value).
 */
export function randomSeed() {
  return ((Math.random() * 0xffffffff) >>> 0) || 1;
}

const LEGACY_DRAWN = new Set(["newalden", "kestrel"]);

/**
 * The generator's street plan for new towns. 1 cut the old quarters block by
 * block; 2 lays their streets first (citygen.mjs streetsFirst) — continuous
 * streets and four-sided blocks instead of a field of shards. A save records
 * the plan its town was built with, and a save without one is a plan-1 town,
 * so every campaign started before plan 2 rebuilds the streets it was played
 * on.
 *
 * What plan 2 does to the economy, measured (12 seeds): regular blocks put
 * the same lot area under ~4% more floor area on average — slightly larger,
 * squarer plates draw a few more towers (the run-to-run spread from merely
 * reshuffling the dice is about ±10%) — and with that extra stock meeting
 * the same opening demand, the first decade starts somewhat fewer projects.
 * That is the mechanism, not a fault to tune away: a denser town has less
 * pent-up demand. The baseline move is recorded in BASELINE.json.
 *
 * Plan 3 keeps plan 2's streets and moves WHERE the vacant lots are: by each
 * block's settlement order (distance from the founding point, ground heat,
 * corridor access, a later-platted district's lag, a block's luck) past a
 * frontier solved so the preset's expected vacant area is unchanged — young
 * towns empty on their outskirts and in late neighbourhoods, in whole blocks,
 * instead of salt and pepper over the centre. See WHERE A YOUNG TOWN IS EMPTY
 * in citygen.mjs.
 *
 * Plan 4 is the FRONTAGE PLAT (citygen.mjs THE FRONTAGE PLAT). Blocks are the
 * size real surveyed blocks are (island.mjs), and each is cut the way a
 * surveyor cuts one: two rows of street-facing lots back to back (or onto a
 * 16 ft alley, in the districts surveyed with one), ends turned to the short
 * street on a long block, every lot one frontage wide and the full depth of
 * its row, assembled sites as runs of adjacent lots. Lots carry their
 * frontage and depth, buildings stand on the street line with their yards
 * behind, a corner is a lot where the street turns, and transit demand reads
 * each lot's own platform rather than a sum over every station in range.
 * Measured on the harness seeds: median lot aspect 1.4 -> 2.4, near-square
 * lots 35% -> 11%, corner lots 40-60% -> about a third (organic quarters,
 * which really are small-blocked, still half), lot count +7% on average.
 * Plan-3 towns rebuild byte-identical; every change is behind the plan.
 *
 * Plan 5 insets a NOTCHED lot along its own shape (citygen.mjs offsetEdges).
 * The footprint step clipped a lot by one half-plane per edge, exact for a
 * convex lot and destructive for an L-shaped one: the edge beside the inside
 * corner cut a whole wing away, so opening-day buildings stood in one corner
 * of their lot behind a forecourt nobody built. Measured on Manhattan below
 * 14th Street (real tax lots, a sixth of those over 5,000 sf are notched):
 * the worst tenth of buildings covered 37% of their lot, now 61%; buildings
 * under 35% coverage on lots over 5,000 sf 239 -> 14. Generated towns cut
 * only convex lots, so plan 5 is byte-identical to plan 4 there.
 *
 * Plan 6 finishes it: a notched lot never falls back to the half-plane clip
 * in the middle of the coverage solve. Plan 5 dropped to `erode` at any
 * setback too deep for the shape — exactly the depth a tower asks for — so
 * a tall building on a notched lot still came out a sliver (130 Greenwich
 * St: 6% of its lot; now 60%). Generated towns unchanged (hashed).
 *
 * Plan 7 builds a tower by its era (citygen.mjs THE PREWAR TOWER). Every
 * tower stood on 42-58% of its lot, the 1961 plaza building, whatever year
 * it went up; a tower before 1961 now rises off 82-92% of its lot and the
 * 1916 setbacks shape it above the base, as in the real Financial District.
 * Commercial courtyard and light-court buildings stand on a solid one- or
 * two-storey base (massing.mjs courtBase). Manhattan below 14th Street:
 * towers of 10-19 floors on lots over 10,000 sf, ground coverage median
 * 53% -> 69%, tenth percentile 34% -> 49%. Floor area +1-3% a town.
 *
 * Plan 8 tones the row-house grain down a notch at the owner's request: the
 * narrowest frontage 30 ft (was 26), the narrow bands a foot or two wider, no
 * lot cut past 4:1 (was 5:1). See citygen.mjs PLAN 8: A NOTCH WIDER.
 */
export const CITY_PLAN = 8;

/**
 * Build a whole city. Deterministic: the same id and seed give byte-identical
 * output, which is what lets a save store six digits instead of two megabytes.
 */
export function makeCity(cityId, seed, opts) {
  if (LEGACY_DRAWN.has(cityId)) {
    throw new Error(`removed city: ${cityId} — all islands are generated from a seed now`);
  }
  if (cityId !== PROCEDURAL && cityId !== MANHATTAN) throw new Error(`unknown city: ${cityId}`);
  // A WRITTEN-DOWN CITY DOES NOT TAKE A SIZE, it takes an extent. `scaleCity`
  // multiplies every position and extent, and doing that to a traced Manhattan
  // gives a fictional island shaped like a shrunken one with real-sized blocks
  // in it — Central Park at a third of its acreage. So the `size` slot carries
  // the extent id for this city, which is what the picker writes into it, and
  // the same field still identifies the town in a save.
  const manhattan = cityId === MANHATTAN;
  const sizeId = manhattan
    ? (opts?.size && EXTENTS[opts.size] ? opts.size : DEFAULT_EXTENT)
    : (opts?.size && SIZES[opts.size] ? opts.size : DEFAULT_SIZE);
  const cfg = manhattan
    ? manhattanConfig(seed, { extent: sizeId })
    : scaleCity(islandConfig(seed, { planV: opts?.planV ?? CITY_PLAN }), SIZES[sizeId].k);
  // The street plan: the current one unless a save asks for the plan its
  // town was cut with (see CITY_PLAN and GameState.cityPlan).
  const city = generateCity({ ...cfg, seed: seed >>> 0, density: opts?.density, planV: opts?.planV ?? CITY_PLAN });
  const data = buildCityData({
    rawParcels: city.parcels,
    rawBuildings: city.buildings,
    rawStations: city.stations,
    manifest: { ...city.manifest, seed: seed >>> 0 },
    employment: city.employment ?? null,
    parks: city.parks ?? [],
  });
  return {
    id: cityId,
    seed: seed >>> 0,
    size: sizeId,
    sizeK: manhattan ? 0 : SIZES[sizeId].k,
    name: cfg.name,
    parcels: data.parcels,
    adjacency: data.adjacency,
    stations: data.stations,
    manifest: data.manifest,
    parcelFeatures: data.tileParcels,
    buildingFeatures: data.tileBuildings,
    context: city.context,
    buildings3d: data.buildings3d,
    stats: { ...data.stats, blocks: city.stats?.blocks ?? 0, coverage: city.stats?.coverage?.pct ?? 0 },
  };
}
