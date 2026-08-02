// Which city this browser is playing. Six datasets ship side by side under
// data/<id>/; the choice lives in localStorage and switching reloads the page,
// because the map sources, the parcel table, and the autosave slot all key off
// it — a clean reload is honest where hot-swapping five data feeds is not.
// Each city keeps its own autosave, so switching back resumes that campaign.

export interface CityInfo { id: string; name: string; tagline: string; lots: number }

const KEY = "bw:city";
const DEFAULT_CITY = "newalden";

export function currentCity(): string {
  try {
    return localStorage.getItem(KEY) ?? DEFAULT_CITY;
  } catch {
    return DEFAULT_CITY;
  }
}

export function switchCity(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch { /* private mode: the reload just lands on the default city */ }
  location.reload();
}

/** Base URL of the current city's data directory, trailing slash included. */
export function dataBase(): string {
  return import.meta.env.BASE_URL + "data/" + currentCity() + "/";
}

export async function listCities(): Promise<CityInfo[]> {
  try {
    const r = await fetch(import.meta.env.BASE_URL + "data/cities.json");
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as CityInfo[];
  } catch {
    // single-city build (legacy flat layout): no picker, just the one town
    return [];
  }
}
