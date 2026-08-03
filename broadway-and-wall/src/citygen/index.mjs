// A CITY, FROM A NUMBER.
//
// `makeCity("newalden", 481923)` is the whole content pipeline in one call:
// generate the geometry, turn it into the game's substrate, hand back the
// parcel table, the adjacency graph, the map layers and the skyline. About
// 350ms, no network, no files.
//
// WHAT THE SEED MOVES AND WHAT IT DOES NOT.
//
// The island does not move. The coastline, the district partition, the parks,
// the stations, the avenues and the street names are the city's identity —
// they are what makes New Alden New Alden and Kestrel Point a peninsula where
// frontage is scarce, and rerolling them would not give you a new city, it
// would give you a different game every time with no place to learn.
//
// Everything else does. The block grid is re-cut, every block is subdivided
// into different lots, so parcel sizes and shapes are new; what is built and
// what is left vacant is new; heights, ages, classes, the mix in each stacked
// building, the setbacks and podiums are new. A reroll of New Alden goes from
// 1,662 lots on 170 blocks to 1,689 on 163 — the same harbour with a
// completely different town on it. Every corner you learned is somebody
// else's corner now.
import { generateCity } from "./citygen.mjs";
import { buildCityData } from "./build.mjs";
import { CITIES, TAGLINES } from "./cities.mjs";

export { CITIES, TAGLINES };

/** The cities you can play, for the picker. */
export function cityList() {
  return Object.keys(CITIES).map((id) => ({
    id,
    name: CITIES[id].name,
    tagline: TAGLINES[id] ?? "",
  }));
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
  const cfg = CITIES[cityId];
  if (!cfg) throw new Error(`unknown city: ${cityId}`);
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
