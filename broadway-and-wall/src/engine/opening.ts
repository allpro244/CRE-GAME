/**
 * THE YEAR THE TOWN OPENS IN (owner, 2026-11-10: "make the opening statistics
 * random within a range").
 *
 * A town does not open at an average. Each game draws one year of the US
 * record and takes that year's natural rate of unemployment (CBO's estimate)
 * as the rate its economy reverts to — the structure of its labour market.
 * Where unemployment actually stands on the opening day is not pasted in: the
 * nation's 20-60 years of history are simulated around that natural rate
 * (regime.ts simulateHistory, which also draws the neutral real rate and the
 * bank's credibility), so the opening is wherever that history arrived — the
 * cycle the town walks into. The year's actual unemployment rate is kept for
 * reference (`u`).
 *
 * This is the outside world (the nation), so it is a legitimate draw: the
 * mechanism audit counts this file under OUTSIDE. The draw is hashed off the
 * campaign seed, not taken from a stream, so a saved game rebuilds exactly and
 * no other stream moves.
 *
 * Sources [S]: FRED, read 2026-11-10.
 *   u      BLS civilian unemployment rate (UNRATE, monthly, seasonally
 *          adjusted), annual average of the twelve months; ties rounded half up.
 *   uStar  CBO noncyclical rate of unemployment (NROU, quarterly), annual
 *          average of the four quarters (vintage 2026-02-27).
 */
export const OPENING_RECORD: Record<number, { u: number; uStar: number }> = {
  1990: { u: 5.6, uStar: 5.73 }, 1991: { u: 6.9, uStar: 5.67 }, 1992: { u: 7.5, uStar: 5.60 },
  1993: { u: 6.9, uStar: 5.52 }, 1994: { u: 6.1, uStar: 5.44 }, 1995: { u: 5.6, uStar: 5.37 },
  1996: { u: 5.4, uStar: 5.29 }, 1997: { u: 4.9, uStar: 5.23 }, 1998: { u: 4.5, uStar: 5.18 },
  1999: { u: 4.2, uStar: 5.14 }, 2000: { u: 4.0, uStar: 5.11 }, 2001: { u: 4.7, uStar: 5.08 },
  2002: { u: 5.8, uStar: 5.06 }, 2003: { u: 6.0, uStar: 5.05 }, 2004: { u: 5.5, uStar: 5.04 },
  2005: { u: 5.1, uStar: 5.04 }, 2006: { u: 4.6, uStar: 5.04 }, 2007: { u: 4.6, uStar: 5.05 },
  2008: { u: 5.8, uStar: 5.05 }, 2009: { u: 9.3, uStar: 5.04 }, 2010: { u: 9.6, uStar: 5.03 },
  2011: { u: 8.9, uStar: 5.00 }, 2012: { u: 8.1, uStar: 4.94 }, 2013: { u: 7.4, uStar: 4.88 },
  2014: { u: 6.2, uStar: 4.80 }, 2015: { u: 5.3, uStar: 4.71 }, 2016: { u: 4.9, uStar: 4.64 },
  2017: { u: 4.4, uStar: 4.57 }, 2018: { u: 3.9, uStar: 4.51 }, 2019: { u: 3.7, uStar: 4.48 },
  2020: { u: 8.1, uStar: 4.46 }, 2021: { u: 5.4, uStar: 4.45 }, 2022: { u: 3.7, uStar: 4.44 },
  2023: { u: 3.6, uStar: 4.43 }, 2024: { u: 4.0, uStar: 4.42 },
};

/** The year a game (by its seed) opens in, and that year's labour market, as shares. */
export function openingLabour(seed: number): { year: number; u: number; uStar: number } {
  const years = Object.keys(OPENING_RECORD).map(Number).sort((a, b) => a - b);
  // FNV-1a over the seed and a salt: deterministic per campaign, independent
  // of every simulation stream.
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (const c of "opening-year") { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  // finish with an avalanche (MurmurHash3 fmix32) so nearby seeds spread evenly
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  const year = years[(h >>> 0) % years.length];
  const r = OPENING_RECORD[year];
  return { year, u: r.u / 100, uStar: r.uStar / 100 };
}
