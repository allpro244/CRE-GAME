// WHICH CITY, AND WHICH ONE OF IT.
//
// There is one island and it is generated: `island.mjs` draws its coast, its
// districts, its parks and every street name from the run's seed, so a new
// campaign is a new place rather than the same place reshuffled. New Alden and
// Kestrel Point were hand-drawn fixtures and are gone — old saves that name
// them are refused on Continue.
//
// THE SEED IS THE SECOND HALF OF THE ADDRESS, and now most of the first half
// too. A city is still `(island, seed, size)` and every one of those has to
// survive a reload, or a deed in a save points at a parcel that no longer
// exists. The island id stays in that tuple even though there is currently one
// value a new run can take: a save written last year names the island it was
// cut on, and dropping the field would be dropping the only thing that lets
// that save find its own parcels again.
//
// Nothing below knows which kind of island it is holding an id for, and nothing
// below should.
import { randomSeed, PROCEDURAL, MANHATTAN, DEFAULT_EXTENT } from "@/citygen/index.mjs";
import { START_CASH_CHOICES, DEFAULT_START_CASH } from "@/engine/types";

export interface CityInfo { id: string; name: string; tagline: string; lots: number }

const KEY = "bw:city";
const SEED_KEY = "bw:seed:";
// The one island a new run can be cut on. An old save carries its own.
const DEFAULT_CITY = PROCEDURAL;

export function currentCity(): string {
  try {
    return localStorage.getItem(KEY) ?? DEFAULT_CITY;
  } catch {
    return DEFAULT_CITY;
  }
}

/** The seed this browser is playing on this island, minting one if there is none. */
export function currentSeed(city = currentCity()): number {
  try {
    const raw = localStorage.getItem(SEED_KEY + city);
    const n = raw ? Number(raw) >>> 0 : 0;
    if (n) return n;
  } catch { /* private mode: a fresh city every session, which is survivable */ }
  const fresh = randomSeed();
  setSeed(fresh, city);
  return fresh;
}

/**
 * HOW BIG THE ISLAND IS, per island, chosen when a run starts.
 *
 * Kept beside the seed and for the same reason: the pair (island, seed, size)
 * is what identifies a town, and all three have to survive a reload or the
 * deeds in a save point at parcels that no longer exist. It is not a graphics
 * setting — a bigger map is a bigger market with more stock, bigger banks and
 * more submarkets in it, so it can only be chosen at the start of a game.
 */
const SIZE_KEY = "bw:size:";
const DEV_KEY = "bw:density";
export const DEFAULT_SIZE = "city";
export const DEFAULT_DEV = "village";

/**
 * How built-up the town starts. Browser-local like the seed, and read at
 * generation time — it decides what buildings exist, so like the size it can
 * only be chosen when a run begins.
 *
 * THE DEFAULT IS PER CITY, because "how far along is this town" is a question a
 * real one has already answered. A generated island opens at `village`: two
 * fifths of the plat still grass, three-storey fabric, nothing over fourteen
 * floors — a town you are going to help build, which is the game the generated
 * island is for. Manhattan below 14th Street in 2000 is not two fifths grass.
 * Measured on the first written-down build, the village default cut 7,354
 * vacant lots out of 14,924 — half the Financial District as open dirt, which
 * is not a version of this city that has ever existed. It opens at
 * `metropolis`: 14% vacant, five-storey fabric, towers past sixty floors, and
 * "very little dirt left — this is a game about buying what exists."
 *
 * The player can still choose. This only changes what the picker starts on.
 */
export function currentDev(city = currentCity()): string {
  const dflt = city === MANHATTAN ? "metropolis" : DEFAULT_DEV;
  try { return localStorage.getItem(DEV_KEY + ":" + city) || dflt; } catch { return dflt; }
}

export function setDev(d: string, city = currentCity()): void {
  try { localStorage.setItem(DEV_KEY + ":" + city, d); } catch { /* private mode: the standard town, which is survivable */ }
}

/**
 * THE OPENING BANKROLL, browser-local like the seed and the size.
 *
 * It is read once, when Break ground is pressed, and then it is history: the
 * save carries the cash it actually has. Kept here rather than in the engine
 * because it is a fact about what this browser last chose, not about any
 * particular campaign — the same reason `currentSize` lives here.
 */
const CASH_KEY = "bw:cash0";

export function currentCash0(): number {
  try {
    const n = Number(localStorage.getItem(CASH_KEY));
    if (START_CASH_CHOICES.includes(n as never)) return n;
  } catch { /* private mode: the default, which is survivable */ }
  return DEFAULT_START_CASH;
}

export function setCash0(v: number): void {
  try { localStorage.setItem(CASH_KEY, String(v)); } catch { /* private mode */ }
}

/**
 * The size slot is per-city and it does not mean the same thing in both. A
 * generated island stores one of the five SIZES; Manhattan stores an EXTENT —
 * how far uptown the map goes — because scaling a traced coastline is not a
 * smaller Manhattan, it is a different island. The key is already namespaced by
 * city, so the two cannot collide; only the default differs.
 */
export function currentSize(city = currentCity()): string {
  const dflt = city === MANHATTAN ? DEFAULT_EXTENT : DEFAULT_SIZE;
  try {
    return localStorage.getItem(SIZE_KEY + city) || dflt;
  } catch {
    return dflt;
  }
}

export function setSize(size: string, city = currentCity()): void {
  try {
    localStorage.setItem(SIZE_KEY + city, size);
  } catch { /* private mode: the run is standard-sized, which is survivable */ }
}

export function setSeed(seed: number, city = currentCity()): void {
  try {
    localStorage.setItem(SEED_KEY + city, String(seed >>> 0));
  } catch { /* nothing to do; the seed lives in the save as well */ }
}

/** Roll a brand new town on the same island and reload into it. */
export function rerollCity(): number {
  const seed = randomSeed();
  setSeed(seed);
  return seed;
}

/**
 * Which island this browser is on, WITHOUT reloading.
 *
 * switchCity does this and then reloads, which is the only thing anyone needed
 * while you could change towns mid-game. Starting a new run on a different
 * island needs the two halves apart: set the island, clear its autosave, roll
 * a town on it, and reload once at the end — not twice, and not into whatever
 * campaign happened to be sitting there.
 */
export function setCity(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch { /* private mode: the reload just lands on the default city */ }
}

export function switchCity(id: string): void {
  setCity(id);
  location.reload();
}

/** Base URL of the current city's data directory, trailing slash included. */
export function dataBase(): string {
  return import.meta.env.BASE_URL + "data/" + currentCity() + "/";
}

export async function listCities(): Promise<CityInfo[]> {
  // No fetch: the island list is the generator's own config, so the picker
  // cannot disagree with what the game can actually build.
  const { cityList } = await import("@/citygen/index.mjs");
  return cityList().map((c) => ({ ...c, lots: 0 }));
}
