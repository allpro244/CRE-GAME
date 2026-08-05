// WHICH CITY, AND WHICH ONE OF IT.
//
// Two islands ship — New Alden and Kestrel Point — and each one is a different
// game: an open grid with a hinterland behind it, and a peninsula where
// frontage is the scarce thing. That choice lives in localStorage and switching
// reloads the page, because the map sources, the parcel table and the autosave
// slot all key off it, and a clean reload is honest where hot-swapping five
// data feeds is not.
//
// THE SEED IS THE SECOND HALF OF THE ADDRESS. The island is fixed; the town on
// it is generated from a number, and that number decides every block, every
// lot line, every building. So a city is `(island, seed)` and both halves have
// to be remembered — a browser refresh must land you back in YOUR city with
// your campaign, and only starting a new run should roll a new one.
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
