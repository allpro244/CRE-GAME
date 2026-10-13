import type { GameState } from "@/engine/types";

export type WeatherKind = "clear" | "overcast" | "rain" | "snow";

export interface CityVisualState {
  weather: WeatherKind;
  precipitation: number;
  overcast: number;
  activity: number;
  /** Snow lying on the ground, 0-1: the snowpack, not this month's flurry. */
  snowCover: number;
}

const clamp = (lo: number, hi: number, n: number) => Math.max(lo, Math.min(hi, n));

/** Stable random in [0, 1): weather changes by month, never by render. */
function weatherRoll(seed: number, month: number, salt: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((month + 1) | 0, 0x85ebca6b) ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function marketOccupancy(game: GameState): number {
  let stock = 0;
  let occupied = 0;
  for (const k of Object.keys(game.econ.stock) as (keyof typeof game.econ.stock)[]) {
    const sf = Math.max(0, game.econ.stock[k] ?? 0);
    stock += sf;
    occupied += Math.min(sf, Math.max(0, game.econ.occupied[k] ?? 0));
  }
  return stock > 0 ? occupied / stock : 0.9;
}

/** This month's weather draw, the same rolls cityVisualState makes. */
function monthWeather(seed: number, month: number) {
  const calendarMonth = ((month % 12) + 12) % 12;
  const winter = calendarMonth <= 2 || calendarMonth >= 10;
  const spring = calendarMonth >= 3 && calendarMonth <= 4;
  const precipChance = winter ? 0.35 : spring ? 0.42 : calendarMonth <= 7 ? 0.24 : 0.32;
  const precipitating = weatherRoll(seed, month, 0x31f2a9c7) < precipChance;
  const precipitation = precipitating ? 0.28 + 0.5 * weatherRoll(seed, month, 0x74d8b013) : 0;
  const snow = precipitating && (calendarMonth <= 2 || calendarMonth >= 11);
  return { calendarMonth, precipitating, precipitation, snow };
}

/**
 * THE SNOWPACK. Snow on the ground is not the month's weather: a coastal
 * north-eastern city keeps its cover for weeks after a storm through a cold
 * winter, and loses it in a thaw. So the cover is carried month to month —
 * each snowfall adds to it, each month keeps a share of what lay before (most
 * in deep winter, little in March, none from April to November). Calibrated
 * against the snow-cover days of Boston and New York: on these rolls about
 * lying snow (cover over 0.25) in 36% of Decembers, 58% of Januaries and
 * Februaries and 33% of Marches (mostly February's carried into early March),
 * measured over 300 seeds x 20 years: Boston's winter, a little snowier than
 * New York's. A snowy month leaves the next one white. Shape parameters (the keep shares), stated as such.
 */
const SNOW_KEEP = [0.6, 0.45, 0.12, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.5];
// a late snowfall lies a few days on March ground, not weeks
const SNOW_ADD = [1, 1, 0.35, 0, 0, 0, 0, 0, 0, 0, 1, 1];
export function snowCoverAt(seed: number, month: number): number {
  let cover = 0;
  for (let m = month - 4; m <= month; m++) {
    const w = monthWeather(seed, m);
    cover = cover * SNOW_KEEP[w.calendarMonth] + (w.snow ? (0.45 + 0.6 * w.precipitation) * SNOW_ADD[w.calendarMonth] : 0);
    if (SNOW_KEEP[w.calendarMonth] === 0 && !w.snow) cover = 0;
    cover = Math.min(1, cover);
  }
  return cover;
}

/**
 * Daytime visual truth for the city.
 *
 * Weather is restrained and deterministic; economic activity follows filled
 * space, employment and unemployment. None of these values feed the simulation.
 */
export function cityVisualState(game: GameState): CityVisualState {
  const month = Math.floor(game.month);
  const seed = game.citySeed ?? 1;

  const { precipitating, precipitation, snow } = monthWeather(seed, month);
  const dullDay = !precipitating && weatherRoll(seed, month, 0x0badc0de) < 0.18;
  const overcast = precipitating ? 0.32 + precipitation * 0.42 : dullDay ? 0.16 : 0;
  const weather: WeatherKind = snow ? "snow" : precipitating ? "rain" : dullDay ? "overcast" : "clear";

  const employment = clamp(0, 1, (game.econ.employIdx - 0.72) / 0.38);
  const labour = clamp(0, 1, (0.14 - (game.econ.unemployment ?? 0.06)) / 0.1);
  const occupancy = clamp(0, 1, (marketOccupancy(game) - 0.72) / 0.24);
  const economicActivity = clamp(0.42, 1.05, 0.3 + 0.34 * employment + 0.18 * labour + 0.23 * occupancy);
  const weatherDrag = 1 - precipitation * (snow ? 0.18 : 0.25);

  return {
    weather,
    precipitation,
    overcast,
    activity: clamp(0.38, 1.05, economicActivity * weatherDrag),
    snowCover: snowCoverAt(seed, month),
  };
}
