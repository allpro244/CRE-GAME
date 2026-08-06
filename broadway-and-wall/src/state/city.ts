// WHICH CITY, AND WHICH ONE OF IT.
//
// Two islands are drawn — New Alden and Kestrel Point — and each one is a
// different game: an open grid with a hinterland behind it, and a peninsula
// where frontage is the scarce thing. The third, `somewhere`, is not drawn at
// all: island.mjs generates its coast, its districts and its names from the
// run's seed. That choice lives in localStorage and switching reloads the page,
// because the map sources, the parcel table and the autosave slot all key off
// it, and a clean reload is honest where hot-swapping five data feeds is not.
//
// THE SEED IS THE SECOND HALF OF THE ADDRESS. On the drawn islands the island
// is fixed and the seed decides every block, every lot line and every building
// on it. On the generated one the seed decides the coastline as well — which
// changes nothing about the bookkeeping here, and that is the point: a city is
// `(island, seed, size)` either way, and every one of those has to survive a
// reload or a deed in a save points at a parcel that no longer exists.
//
// Nothing below knows which kind of island it is holding an id for, and nothing
// below should. That is what makes `somewhere` a third entry rather than a
// second code path.
import { randomSeed } from "@/citygen/index.mjs";

export interface CityInfo { id: string; name: string; tagline: string; lots: number }

const KEY = "bw:city";
const SEED_KEY = "bw:seed:";
const DEFAULT_CITY = "newalden";

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
 */
export function currentDev(): string {
  try { return localStorage.getItem(DEV_KEY) || DEFAULT_DEV; } catch { return DEFAULT_DEV; }
}

export function setDev(d: string): void {
  try { localStorage.setItem(DEV_KEY, d); } catch { /* private mode: the standard town, which is survivable */ }
}

export function currentSize(city = currentCity()): string {
  try {
    return localStorage.getItem(SIZE_KEY + city) || DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
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
