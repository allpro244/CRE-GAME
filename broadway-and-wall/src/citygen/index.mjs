// A CITY, FROM A NUMBER.
//
// `makeCity("newalden", 481923)` is the whole content pipeline in one call:
// generate the geometry, turn it into the game's substrate, hand back the
// parcel table, the adjacency graph, the map layers and the skyline. About
// 350ms, no network, no files.
//
// WHAT THE SEED MOVES AND WHAT IT DOES NOT — WHICH NOW DEPENDS ON WHERE.
//
// On the two AUTHORED islands, the island does not move. The coastline, the
// district partition, the parks, the stations, the avenues and the street
// names are the city's identity — they are what makes New Alden New Alden and
// Kestrel Point a peninsula where frontage is scarce, and rerolling them would
// not give you a new city, it would give you a different game every time with
// no place to learn. That is still true and those two are untouched.
//
// Everything else does move. The block grid is re-cut, every block is
// subdivided into different lots, so parcel sizes and shapes are new; what is
// built and what is left vacant is new; heights, ages, classes, the mix in each
// stacked building, the setbacks and podiums are new. A reroll of New Alden
// goes from 1,662 lots on 170 blocks to 1,689 on 163 — the same harbour with a
// completely different town on it. Every corner you learned is somebody else's
// corner now.
//
// THE THIRD DOOR is the one where the island moves too. `somewhere` is not a
// place, it is a generator: island.mjs draws the coast, the cores, the district
// plan, the parks, the piers, the railway and every name on the map from the
// run's own seed, and hands back a config of exactly the shape cities.mjs
// exports. Nothing below this line knows the difference — the same scaleCity
// scales it, the same generateCity cuts it, the same buildCityData tabulates
// it. The argument the header used to make against this was an argument for
// keeping New Alden fixed, and it still is. It was never an argument against
// there being somewhere else to go.
import { generateCity } from "./citygen.mjs";
import { buildCityData } from "./build.mjs";
import { CITIES, TAGLINES, SIZES, DEFAULT_SIZE, scaleCity } from "./cities.mjs";
import { islandConfig, islandName } from "./island.mjs";

export { CITIES, TAGLINES, SIZES, DEFAULT_SIZE };

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
  { id: "frontier",   name: "Frontier",   note: "43% of the lots are still empty and nothing stands above nine floors. Almost everything here is yours to build." },
  { id: "village",    name: "Young town", note: "The standard opening. A quarter of it unbuilt, a low skyline, and somewhere to go." },
  { id: "provincial", name: "Provincial", note: "A working town that has filled in. A quarter vacant still, and a few thirty-floor buildings." },
  { id: "harbour",    name: "Established", note: "A real skyline and less dirt — 23% vacant, towers to forty floors." },
  { id: "spiky",      name: "Boomtown",   note: "Low fabric, dramatic towers. A town that boomed once and stopped — plenty of gaps beside forty-eight floors." },
  { id: "capital",    name: "Capital",    note: "Built up and tall. Under a fifth of it vacant; you will be redeveloping more than you build." },
  { id: "metropolis", name: "Metropolis", note: "13% vacant and sixty floors. There is very little dirt left — this is a game about buying what exists." },
];
export const DEFAULT_DEVELOPMENT = "village";

export function developmentList() {
  return DEVELOPMENT.map((d) => ({ ...d }));
}

/**
 * THE ISLAND THAT IS NOT DRAWN YET.
 *
 * This is an id like any other as far as everything downstream is concerned —
 * the autosave slot is `auto@somewhere`, the seed lives at `bw:seed:somewhere`,
 * and `makeCity("somewhere", seed, …)` is a pure function of its arguments the
 * same as the other two. What is different is only that the config it builds
 * from is computed instead of written down.
 */
export const PROCEDURAL = "somewhere";

/** The cities you can play, for the picker. */
export function cityList() {
  return [
    ...Object.keys(CITIES).map((id) => ({
      id,
      name: CITIES[id].name,
      tagline: TAGLINES[id] ?? "",
    })),
    {
      id: PROCEDURAL,
      name: "Somewhere else",
      tagline: "An island nobody has drawn. The coast, the districts and every street name come out of your seed.",
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
export function cityName(cityId, seed) {
  if (cityId === PROCEDURAL) return islandName(seed);
  return CITIES[cityId]?.name ?? cityId;
}

/**
 * A seed that is a real number in the JS sense and a plausible one in the
 * game's: unsigned 32-bit, never zero (mulberry32 with a zero seed is a
 * perfectly fine sequence but a zero in a save reads like a missing value).
 */
export function randomSeed() {
  return ((Math.random() * 0xffffffff) >>> 0) || 1;
}

/**
 * Build a whole city. Deterministic: the same id and seed give byte-identical
 * output, which is what lets a save store six digits instead of two megabytes.
 */
export function makeCity(cityId, seed, opts) {
  // A GENERATED ISLAND IS DRAWN FROM THE SAME SEED THE TOWN IS, which is what
  // keeps a save honest: the save stores (island, seed, size, build-out), and
  // every one of those four is an argument to this function. Roll the seed and
  // you get a different coast AND a different town on it; keep it and you get
  // the same island back on every reload, forever, down to the byte.
  const base = cityId === PROCEDURAL ? islandConfig(seed) : CITIES[cityId];
  if (!base) throw new Error(`unknown city: ${cityId}`);
  // The island's size is part of what the town IS, so it is settled before the
  // generator runs and never afterwards — same island, same seed, same size
  // gives the same city, which is what lets a save store three fields instead
  // of two megabytes.
  const sizeId = opts?.size && SIZES[opts.size] ? opts.size : DEFAULT_SIZE;
  const cfg = scaleCity(base, SIZES[sizeId].k);
  const city = generateCity({ ...cfg, seed: seed >>> 0, density: opts?.density });
  const data = buildCityData({
    rawParcels: city.parcels,
    rawBuildings: city.buildings,
    rawStations: city.stations,
    manifest: { ...city.manifest, seed: seed >>> 0 },
    employment: city.employment ?? null,
  });
  return {
    id: cityId,
    seed: seed >>> 0,
    size: sizeId,
    sizeK: SIZES[sizeId].k,
    name: cfg.name,
    parcels: data.parcels,
    adjacency: data.adjacency,
    stations: data.stations,
    manifest: data.manifest,
    // The two collections the map draws. They used to be cut into PMTiles by
    // the pipeline; at 1,600 parcels and 1,200 footprints a plain GeoJSON
    // source is well inside what MapLibre handles without noticing, and it is
    // the difference between a city that ships and a city that is made.
    parcelFeatures: data.tileParcels,
    buildingFeatures: data.tileBuildings,
    context: city.context,
    buildings3d: data.buildings3d,
    stats: { ...data.stats, blocks: city.stats?.blocks ?? 0, coverage: city.stats?.coverage?.pct ?? 0 },
  };
}
