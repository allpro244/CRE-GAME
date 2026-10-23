// CAR ACCESS: how many people a place can reach by car, and how long it takes them.
//
// An island's demand surface gives 44 of its 100 points to transit (the
// platform you walk to, 30) and the pull of a second centre (14). Those two
// terms are the island's ACCESSIBILITY: how much of the city a lot is close to
// in the way that city's people actually travel. A county seat is not travelled
// by train. Most of its trips are made by car (NHTS 2017: about 83% of US person
// trips by private vehicle, more outside the large metros), so its accessibility is the
// classic one: how many households and jobs can reach a place within a few
// minutes' drive (Hansen 1959, "How accessibility shapes land use"; the EPA
// Smart Location Database v3 D5 measures are this, auto travel time-decay
// weighted jobs and population). Retail site selection reads the same quantity
// as a trade area in drive-time rings — 5, 10 and 15 minutes are the standard
// rings (ICSC: a neighbourhood centre's primary trade area is about a five- to
// ten-minute drive, a community centre's ten to twenty) — with each ring's pull
// falling off with time the way Huff's (1963) gravity model has it.
//
// This file is the one place both the generator (build.mjs, the anchor) and
// the engine (engine/grocer.ts, the grocer's trade area) read drive time from,
// so the two cannot disagree about how far anywhere is.
//
// THE NETWORK, AS A SKETCH. The road plan's arterials run between the town and
// the section corners, and inside the town every block is on a street, so the
// surface drive is the straight line times the network's circuity at county-road
// speed; a trip may instead run out to an open interchange, along the freeway
// and off at another. That is the same sketch roads.ts reads a commute through
// (refreshAccess), not a link-by-link network assignment.

/** Road distance over straight-line distance on US road networks: 1.20 (Ballou, Rahardja & Sakai 2002, "Selected country circuity factors for road travel distance estimation", US mean 1.20) [S]. */
export const CIRCUITY = 1.2;
/** County road and town arterial speed, km/h — homeprice.ts COMMUTE.kmh [S]. */
export const SURFACE_KMH = 50;
/** Freeway speed, km/h — roads.ts HWY_KMH (a 65 mph posted limit) [S]. */
export const FREEWAY_KMH = 100;
/** The rings: nothing past fifteen minutes is in a neighbourhood or community trade area (ICSC) [S]. */
export const RING_MAX_MIN = 15;
/**
 * HUFF'S DISTANCE DECAY: a place's pull on a household falls as drive time to
 * the power LAMBDA. Huff (1963) estimated 2.7-3.2 for shopping goods;
 * convenience goods decay at least as fast, and accessibility studies use 1-2
 * (Hansen 1959). LAMBDA = 2 is the low end of Huff's range [K, a shape
 * parameter stated as such]. Below T0 minutes nothing is "nearer": every trip
 * has a parking lot at each end (T0 = 2) [K, shape].
 */
export const LAMBDA = 2, T0 = 2;

/** Huff's weight of a place `t` minutes away: 1 inside T0, (T0/t)^LAMBDA out to the fifteen-minute ring, 0 past it. */
export function huffW(t) {
  if (!(t <= RING_MAX_MIN)) return 0;
  return t <= T0 ? 1 : Math.pow(T0 / t, LAMBDA);
}

/** Minutes for `m` metres of straight line on the surface network. */
export const surfaceMin = (m) => (m * CIRCUITY) / 1000 / SURFACE_KMH * 60;

/**
 * A drive-time function over a set of open interchanges, metres in a local
 * flat frame: `ixs` [[x, y], ...]. Returns (ax, ay, bx, by) -> minutes, the
 * faster of the surface drive and on-at-one-interchange, off-at-another.
 * Freeway legs run the straight line between interchanges times the same
 * circuity (a freeway bends less than a county road; the overstatement is a
 * few per cent of a few minutes).
 */
export function driveTimer(ixs) {
  const n = ixs.length;
  const fwy = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    fwy[i * n + j] = (Math.hypot(ixs[i][0] - ixs[j][0], ixs[i][1] - ixs[j][1]) * CIRCUITY) / 1000 / FREEWAY_KMH * 60;
  }
  const toIx = (x, y, out) => { for (let i = 0; i < n; i++) out[i] = surfaceMin(Math.hypot(x - ixs[i][0], y - ixs[i][1])); return out; };
  const a = new Float64Array(n), b = new Float64Array(n);
  return (ax, ay, bx, by) => {
    let t = surfaceMin(Math.hypot(ax - bx, ay - by));
    if (n < 2) return t;
    toIx(ax, ay, a); toIx(bx, by, b);
    for (let i = 0; i < n; i++) {
      if (a[i] >= t) continue;
      for (let j = 0; j < n; j++) { if (j === i) continue; const v = a[i] + fwy[i * n + j] + b[j]; if (v < t) t = v; }
    }
    return t;
  };
}

/**
 * CAR ACCESSIBILITY at each of `sites` ([x, y] metres): the Huff-weighted count
 * of households and jobs within fifteen minutes' drive. Households and jobs
 * are added one for one — the EPA Smart Location Database's activity measure
 * (D1D, "gross activity density: employment + housing units") [S]. Origins are
 * pooled on a 200 m grid first (a household two hundred metres one way or the
 * other is the same 15 seconds' drive) so a town of 2,000 lots is
 * 2,000 x a few hundred, not 2,000 x 2,000.
 */
export function carAccessibility(sites, origins, ixs) {
  const CELL = 200;
  const cells = new Map();
  for (const o of origins) {
    if (!(o.n > 0)) continue;
    const k = Math.floor(o.x / CELL) + ":" + Math.floor(o.y / CELL);
    const c = cells.get(k);
    if (c) { c.x += o.x * o.n; c.y += o.y * o.n; c.n += o.n; } else cells.set(k, { x: o.x * o.n, y: o.y * o.n, n: o.n });
  }
  const pts = [...cells.values()].map((c) => ({ x: c.x / c.n, y: c.y / c.n, n: c.n }));
  const drive = driveTimer(ixs);
  return sites.map(([x, y]) => {
    let v = 0;
    for (const p of pts) { const w = huffW(drive(x, y, p.x, p.y)); if (w > 0) v += p.n * w; }
    return v;
  });
}
