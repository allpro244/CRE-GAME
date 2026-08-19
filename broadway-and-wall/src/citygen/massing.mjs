// THE SILHOUETTE VOCABULARY, IN ONE PLACE.
//
// Everything here used to be four hundred lines in the middle of
// `buildCityData`, closed over that function's projection — which meant it
// could only ever be reached by the stock a city is GENERATED with. The
// renderer, which draws everything the player and the rivals put up, could not
// call it, so it grew its own answer: a coverage inset and a prism. Twenty
// years into a campaign most of downtown is the player's, and the skyline
// flattened as they built it.
//
// So the families live here, in metres, with no projection and no I/O. The
// generator wraps them back into lon/lat; the renderer is already in metres and
// calls them directly. ONE vocabulary, so a tower the player tops out in 2031
// is drawn by the rules that would have drawn it if the town had started with
// it — the same argument `styleForBuilt` makes about the facade, made about the
// shape.
//
// Pure: same inputs, same outputs. Randomness arrives as `u(k)`, a caller-
// supplied stable hash — the generator passes its per-building `bh(bbl, salt)`
// and the renderer passes the deed hash it already uses for style and palette.
// Nothing in here may reach for Math.random.
import {
  polygonArea, centroid, insetRingPerp,
  clipRingHalfPlane, longestEdgeAngle, extentAlong, isConvex,
} from "./geom.mjs";

/** The plan families. Any era can reach these — the lot decides, not the date. */
export const PLAN = new Set([
  "courtyard", "lightcourt", "dumbbell", "campanile", "endtowers",
  "twins", "cruciform", "shifted", "notch",
  "chamfertaper", "twist",
]);

// ---- THE 1916 ENVELOPE, AND THE MODULE IT STEPS ON -------------------------
//
// ART DECO'S DEFINING MOVE IS A LEGAL ARTEFACT, and it belongs in this file
// rather than in a comment about taste. The New York zoning resolution of
// 25 July 1916 — the first citywide zoning in the United States — did two
// geometrically INDEPENDENT things, and using one rule where two belong loses
// half the silhouettes:
//
//   A. THE SKY EXPOSURE PLANE. The city was cut into five height districts
//      labelled by a multiple of the ADJACENT STREET WIDTH: 1, 1.25, 1.5, 2
//      and 2.5. A street wall could rise vertically to multiple x street
//      width; above that the building had to stay under a sloping plane
//      projected from the CENTRE OF THE STREET.
//   B. THE TOWER EXEMPTION. A building could rise without limit if it covered
//      no more than a QUARTER of its site — the precedent being Ernest
//      Flagg's Singer Tower. That is the reason a prewar skyline has spikes in
//      it and not only ziggurats, and it is what `base` below has always been
//      reaching for.
//
// Hugh Ferriss with Harvey Wiley Corbett drew the envelope in 1922 — "The Four
// Stages of the Maximum Mass of the Zoning Envelope", published in Ferriss's
// The Metropolis of Tomorrow, 1929 — and that drawing, not the statute, is
// what a generation of architects designed from. Carol Willis, Form Follows
// Finance (Princeton Architectural Press, 1995) is the economic half, and it
// is this game's own thesis in a 1995 book: "market formulas produced
// characteristic forms in each city — vernaculars of capitalism — that
// resulted from local land-use patterns, municipal codes, and zoning."
//
// AND IT ENDS. The 1961 Zoning Resolution threw the 1916 formula away for
// floor area ratio — base FAR 15, a 20% bonus to FAR 20 for a public plaza —
// which is why the plaza-and-slab replaced the ziggurat. So a deco-massed
// building delivered after 1961 is a STYLISTIC CHOICE and not a legal
// outcome, and the pools below treat the two cases differently: full weight
// before 1961, and a thin revival weight afterwards at the two dates the
// revival actually happened.
//
// THE SLOPE, AND AN HONEST CONFLICT IN THE SOURCES. The statutory text was not
// reachable when this was written and the secondary sources disagree:
//
//   1. slope = 2 x the district multiple, plane drawn from the street
//      CENTRELINE — "in a one times district a developer received an
//      additional 2 feet of height per 1 foot of setback", and 5 ft per 1 ft
//      in a two-and-a-half times district;
//   2. slope 1:1 measured from the LOT line — "facades had to recede one foot
//      horizontally for every foot of additional height";
//   3. "four feet for every two feet set back" in a 2-times district, which
//      is consistent with neither.
//
// What is built here is reading 1, for one reason: it is the only one that is
// self-explaining. If the plane starts at the centre of the street and passes
// through the top of the tallest permitted vertical wall at n x W, the
// horizontal run from plane origin to lot line is W/2, so the slope is
// (n x W)/(W / 2) = 2n. That reproduces reading 1's two data points exactly
// and explains reading 2 as a lot-line simplification. THIS IS A
// RECONCILIATION AND NOT A CITATION — if somebody gets to the statute, 2n is
// the number to check, and this paragraph is where the alternatives are.
const HEIGHT_DISTRICTS = [1, 1.25, 1.5, 2, 2.5];

// THE PIERS HAVE TO SURVIVE THE SETBACK OR THE MOVE IS NOT LEGIBLE.
//
// The one thing every zigzag facade is made of is an unbroken vertical pier
// running from the base to the parapet, and a step that lands mid-bay cuts
// every pier on the face in half. Real setbacks land on the column line,
// because a setback is where a column stops. So every horizontal setback in
// the deco families is quantised to a whole number of window bays.
//
// 2.4 m is the deco bay. It is `colW` in FRAG's S_ARTDECO branch (the `s == 6`
// palette entry in ThreeBuildings.ts), and the two numbers have to agree or the
// piers stop lining up across the step. Moving one without the other is exactly
// the silent drift this file's duplicated chamfer already warns about; a shared
// constant would be better and the registry is not this module's to import.
const PIER_BAY = 2.4;
/** A setback depth rounded to whole piers — never less than one bay. */
const bays = (d) => Math.max(1, Math.round(d / PIER_BAY)) * PIER_BAY;

// A FLOOR HAS TO BE WIDE ENOUGH TO BE A FLOOR — eleven metres, a corridor and
// one bay. `MIN_PLATE_W` in ThreeBuildings.ts enforces that on everything the
// player puts up, by SKIPPING a family whose volumes fall under it; the
// generator has never enforced it at all, which is why the same family can draw
// a stick on generated stock that it is forbidden from drawing on player stock.
// The deco families check it themselves and refuse, so a ziggurat asked for four
// steps off a sixteen-metre plate hands back null and the next family is tried
// instead of a chimney being drawn. THE OTHER FIFTEEN FAMILIES IN THIS FILE
// STILL HAVE NO GUARD. That asymmetry is real, it is older than this change, and
// closing it for all of them would move every generated silhouette.
const MIN_FLOOR_W = 11;

/**
 * Shrink a ring toward a target fraction of its area, backing off toward the
 * original if the geometry will not take it. A long thin loft footprint
 * cannot lose seventy per cent of its area without the short dimension going
 * through itself; rather than drop the setback entirely, take the deepest one
 * that survives. Returns null only if even a gentle inset collapses.
 */
function shrink(ringXY, side, frac) {
  for (let f = Math.max(0.16, frac); f < 0.97; f += (1 - f) * 0.45) {
    const r = insetRingPerp(ringXY, (side * (1 - Math.sqrt(f))) / 2);
    if (r && r.length >= 3) return r;
  }
  return null;
}

/** The plate measured on its own long axis: extents u (along) and v (across). */
const plateFrame = (r) => {
  const th = longestEdgeAngle(r);
  const eu = extentAlong(r, th), ev = extentAlong(r, th + Math.PI / 2);
  return {
    ux: Math.cos(th), uy: Math.sin(th),
    vx: -Math.sin(th), vy: Math.cos(th),
    u0: eu.lo, u1: eu.hi, du: eu.span,
    v0: ev.lo, v1: ev.hi, dv: ev.span,
  };
};
/** Keep the part of r whose coordinate on axis (ax,ay) is at most c. */
const clipLo = (r, ax, ay, c) => (r ? clipRingHalfPlane(r, ax, ay, c) : null);
/** Keep the part of r whose coordinate on axis (ax,ay) is at least c. */
const clipHi = (r, ax, ay, c) => (r ? clipRingHalfPlane(r, -ax, -ay, -c) : null);
/** The slice of r between two coordinates on one axis. */
const clipBand = (r, ax, ay, a, b) => clipLo(clipHi(r, ax, ay, a), ax, ay, b);
/** Slide a ring sideways — for stacks whose plates do not sit over each other. */
const slide = (r, dx, dy) => (r ? r.map(([x, y]) => [x + dx, y + dy]) : null);

/**
 * PUSH A RING BACK FROM THE SIDES THAT FACE A STREET, AND ONLY THOSE.
 *
 * Every setback in this file before the deco families was a uniform inset
 * toward the centroid, and that is the one thing a 1916 setback is not. The sky
 * exposure plane is measured from the STREET, so it bears on the one or two
 * sides of a lot that face one and on nothing else — the party walls carry
 * straight up, because there is no plane over them and no light behind them to
 * protect. A mid-block lot steps back on one side; a corner lot on two; and the
 * stepped corner everybody draws when they draw a deco tower is what the second
 * case looks like from the street.
 *
 * `mask` is the four sides of the plate's own frame: 1 and 2 are the ends of the
 * long axis, 4 and 8 the sides. Measured from the ORIGINAL plate every time, so
 * successive tiers are nested subsets of it rather than of each other.
 */
const stepBack = (r, F, mask, d) => {
  let out = r;
  if (mask & 1) out = clipHi(out, F.ux, F.uy, F.u0 + d);
  if (mask & 2) out = clipLo(out, F.ux, F.uy, F.u1 - d);
  if (mask & 4) out = clipHi(out, F.vx, F.vy, F.v0 + d);
  if (mask & 8) out = clipLo(out, F.vx, F.vy, F.v1 - d);
  return out && out.length >= 3 ? out : null;
};

/**
 * The narrowest width of a convex ring, in metres — the exact answer, by
 * rotating calipers: for a convex polygon the minimum width is always attained
 * along the normal of one of its own edges, so testing the edge normals is not
 * a sample of directions, it is all of them.
 *
 * It exists because the frame-axis arithmetic is not enough on its own. A
 * setback taken on the street sides costs width on the u and v axes and can be
 * checked against them, but a CORNER cut costs width on the DIAGONAL and the
 * frame cannot see it: measured, guarding on the frame axes alone still left
 * 43 of 864 zigzag builds with a habitable volume under eleven metres across.
 */
const narrowestSpan = (r) => {
  if (!r || r.length < 3) return 0;
  let m = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    if (L < 0.01) continue;
    const e = extentAlong(r, Math.atan2(dy, dx) + Math.PI / 2);
    if (e.span < m) m = e.span;
  }
  return Number.isFinite(m) ? m : 0;
};

/** The four (u,v) corners of the plate frame, as signs on the two axes. */
const CORNERS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
/**
 * Cut ONE corner back by `c` metres along its diagonal.
 *
 * This is the setback shoulder — "square or oblong blocks and other rectangular
 * projections composed symmetrically... or forming repeating patterns across the
 * upper stories". The corner blocks step in while the centre bay of the street
 * face carries straight up, which is a different event from the whole face
 * stepping and is where the deco ornament clusters. A corner is also the one
 * place where TWO planes bear at once, so it is the part of the envelope that
 * comes back first.
 *
 * One half-plane on the diagonal axis, so the result stays convex and
 * Sutherland-Hodgman stays an exact partition.
 */
const cornerCut = (r, F, k, c) => {
  const [su, sv] = CORNERS[k & 3];
  const ax = (F.ux * su + F.vx * sv) / Math.SQRT2;
  const ay = (F.uy * su + F.vy * sv) / Math.SQRT2;
  const cu = su > 0 ? F.u0 : F.u1, cv = sv > 0 ? F.v0 : F.v1;
  const out = clipHi(r, ax, ay, (cu * su + cv * sv) / Math.SQRT2 + c);
  return out && out.length >= 3 ? out : null;
};

/**
 * Cut every corner off at `cut` metres — the move that separates a tower
 * built this decade from one built in 1985.
 */
const chamferRing = (r, cut) => {
  if (!r || r.length < 3 || cut <= 0.01) return r;
  const n = r.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = r[i], a = r[(i - 1 + n) % n], b = r[(i + 1) % n];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const ka = Math.min(cut, la * 0.45) / la, kb = Math.min(cut, lb * 0.45) / lb;
    out.push([p[0] + (a[0] - p[0]) * ka, p[1] + (a[1] - p[1]) * ka]);
    out.push([p[0] + (b[0] - p[0]) * kb, p[1] + (b[1] - p[1]) * kb]);
  }
  return out;
};

/** Turn a ring about a point — the twist, and the spiral's step. */
const spin = (r, cx, cy, a) => {
  if (!r) return null;
  const c = Math.cos(a), s = Math.sin(a);
  return r.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
};

/**
 * The stack of volumes a building actually stands as, base first.
 *
 * `ring` is the FOOTPRINT in metres, open (no repeated last vertex). `lotRing`
 * is the deed, or null where the caller has none or does not want the two
 * families that oversail the footprint at grade. `u(k)` is a stable [0,1) per
 * building per question. `families`, when given, replaces the era-and-lot pool
 * this function would otherwise assemble: the caller has already decided what
 * the site can take and hands over the shortlist, tried in hash order.
 *
 * Returns `{ name, tiers }` where every tier's `ring` is a metre ring, or null
 * when a plain extrusion is the right answer — which for most of a city it is,
 * because most of a city is five storeys of brick. A tier that stands on the
 * WHOLE footprint hands back the caller's own `ring` array by reference, so a
 * caller holding an already-projected polygon can pass it straight through
 * instead of round-tripping it through the projection.
 */
export function massingStack({ ring, lotRing = null, hM, year, klass, u, families = null }) {
  const ringXY = ring;
  if (!ringXY || ringXY.length < 3) return null;
  const areaM2 = Math.abs(polygonArea([ringXY]));
  if (areaM2 < 180) return null;
  const side = Math.sqrt(areaM2);
  const W = side;                 // the plate's width, near enough, in metres
  const lotRingM = lotRing;
  const out = [];
  const push = (r, base, top) => {
    if (!r || top - base < 0.6) return false;
    out.push({ ring: r, base: +base.toFixed(1), top: +top.toFixed(1) });
    return true;
  };
  /** File the silhouette and hand it back, or fall through to a slab. */
  const done = (name) => { if (out.length < 2) return null; return { name, tiers: out }; };

  // ---- the plan families, which any era can reach --------------------------
  //
  // These are keyed to the DEPTH of the plate rather than to a date, because
  // that is the thing that actually forces them: a plate you cannot get
  // daylight into has to be opened up, whoever is building it and whenever.
  // Salts 60+ — everything below 60 is spoken for by the families above.

  /** Wings round a closed light well. The prewar big-lot answer. */
  const courtyard = (depth) => {
    const F = plateFrame(ringXY);
    if (F.du < depth * 2.9 || F.dv < depth * 2.9) return null;
    const uA = F.u0 + depth, uB = F.u1 - depth;
    const mid = clipBand(ringXY, F.ux, F.uy, uA, uB);
    const wings = [
      clipLo(ringXY, F.ux, F.uy, uA),
      clipHi(ringXY, F.ux, F.uy, uB),
      clipLo(mid, F.vx, F.vy, F.v0 + depth),
      clipHi(mid, F.vx, F.vy, F.v1 - depth),
    ].filter((r) => r && r.length >= 3 && Math.abs(polygonArea([r])) > 40);
    return wings.length === 4 ? wings : null;
  };

  /** The same, open on one side — a light court facing the rear yard. */
  const lightCourt = (depth) => {
    const F = plateFrame(ringXY);
    if (F.du < depth * 2.9 || F.dv < depth * 2.2) return null;
    const uA = F.u0 + depth, uB = F.u1 - depth;
    const mid = clipBand(ringXY, F.ux, F.uy, uA, uB);
    const wings = [
      clipLo(ringXY, F.ux, F.uy, uA),
      clipHi(ringXY, F.ux, F.uy, uB),
      clipLo(mid, F.vx, F.vy, F.v0 + depth),
    ].filter((r) => r && r.length >= 3 && Math.abs(polygonArea([r])) > 40);
    return wings.length === 3 ? wings : null;
  };

  /** The dumbbell: full-depth ends, and a waist notched on both long sides. */
  const dumbbell = (endW, notch) => {
    const F = plateFrame(ringXY);
    if (F.du < endW * 2.6 || F.dv < notch * 2.8) return null;
    const mid = clipBand(ringXY, F.ux, F.uy, F.u0 + endW, F.u1 - endW);
    const waist = clipBand(mid, F.vx, F.vy, F.v0 + notch, F.v1 - notch);
    const wings = [
      clipLo(ringXY, F.ux, F.uy, F.u0 + endW),
      clipHi(ringXY, F.ux, F.uy, F.u1 - endW),
      waist,
    ].filter((r) => r && r.length >= 3 && Math.abs(polygonArea([r])) > 30);
    return wings.length === 3 ? wings : null;
  };

  /** A square of plate at one corner — what a tower actually stands on. */
  const cornerCell = (cell, k) => {
    const F = plateFrame(ringXY);
    const uSide = k & 1 ? clipHi(ringXY, F.ux, F.uy, F.u1 - cell) : clipLo(ringXY, F.ux, F.uy, F.u0 + cell);
    const c = k & 2 ? clipHi(uSide, F.vx, F.vy, F.v1 - cell) : clipLo(uSide, F.vx, F.vy, F.v0 + cell);
    return c && c.length >= 3 && Math.abs(polygonArea([c])) > 25 ? c : null;
  };

  function tryPlan(fam) {
    // The wing clip is Sutherland–Hodgman, which is an exact partition on a
    // convex ring and BRIDGES ACROSS THE CUT on a concave one — two wings
    // that both cover the same ground, drawn one inside the other. Measured,
    // every footprint this generator makes is convex in metres (1,113 of
    // 1,113 on New Alden; the same test in degrees reads 95% concave, which
    // is the epsilon being meaningless at 1e-4 rather than a real result).
    // The guard is here so that stays true rather than being assumed.
    if (!isConvex(ringXY)) return null;
    switch (fam) {
      case "courtyard": {
        // A block built solid round a closed well. Eight storeys of flats
        // with every room on either the street or the court.
        const wings = courtyard(9.5 + 4.0 * u(60));
        if (!wings) return null;
        for (const w of wings) push(w, 0, hM);
        return done("courtyard block");
      }
      case "lightcourt": {
        // The same idea on a lot too narrow to close: a U with the court
        // open to the rear, which is where the light was going to come from.
        const wings = lightCourt(9.0 + 3.5 * u(61));
        if (!wings) return null;
        for (const w of wings) push(w, 0, hM);
        return done("light court");
      }
      case "dumbbell": {
        // THE DUMBBELL. Full-depth ends and a waist pinched in on both sides
        // to get an air shaft down the middle of the block — the 1879 answer
        // to a law that said every room needed a window, and the single most
        // characteristic plan of a nineteenth century tenement district.
        const wings = dumbbell(7 + 4 * u(62), 3.6 + 2.4 * u(63));
        if (!wings) return null;
        for (const w of wings) push(w, 0, hM);
        return done("dumbbell");
      }
      case "campanile": {
        // A tower on the corner of a low block: a bank clock, a market
        // campanile, the tower over a station entrance. One small square of
        // plate carried up well past everything around it, and from a
        // distance it is the only thing on the block you can see.
        const cell = cornerCell(Math.max(7, Math.min(17, side * 0.36)), Math.floor(u(64) * 4));
        if (!cell) return null;
        push(ringXY, 0, hM);
        push(cell, hM, hM + Math.max(6, hM * (0.32 + 0.40 * u(65))));
        return done("corner tower");
      }
      case "endtowers": {
        // A low bar with its ends carried higher — the courthouse-and-wings
        // move, and it gives a block a profile instead of a line.
        const F = plateFrame(ringXY);
        const endW = Math.max(6, Math.min(F.du * 0.30, 15));
        const A = clipLo(ringXY, F.ux, F.uy, F.u0 + endW);
        const B = clipHi(ringXY, F.ux, F.uy, F.u1 - endW);
        if (!A || !B) return null;
        const barTop = hM * (0.52 + 0.16 * u(66));
        push(ringXY, 0, barTop);
        push(A, barTop, hM);
        push(B, barTop, hM * (0.90 + 0.10 * u(67)));
        return done("end towers");
      }
      case "twins": {
        // TWO SHAFTS OFF ONE PODIUM, and never quite the same height —
        // matched twins are rarer than the phrase suggests, and the offset
        // is what makes the pair read as a pair rather than as a mistake.
        const podTop = 7 + 13 * u(68);
        const sh = shrink(ringXY, side, 0.60 + 0.18 * u(69));
        if (!sh) return null;
        const F = plateFrame(sh);
        if (F.du < 26) return null;
        const gap = 3 + 4.5 * u(70), mid = (F.u0 + F.u1) / 2;
        const A = clipLo(sh, F.ux, F.uy, mid - gap / 2);
        const B = clipHi(sh, F.ux, F.uy, mid + gap / 2);
        if (!A || !B || podTop >= hM * 0.6) return null;
        push(ringXY, 0, podTop);
        push(A, podTop, hM);
        push(B, podTop, hM * (0.78 + 0.20 * u(71)));
        return done("twin towers");
      }
      case "cruciform": {
        // A PLUS-SHAPED SHAFT. Four short wings off a core, so every office
        // is near a window and the tower has a different width from every
        // angle — which is why it never reads as a slab however big it is.
        const baseTop = hM * (0.12 + 0.14 * u(72));
        const sh = shrink(ringXY, side, 0.72) ?? ringXY;
        const F = plateFrame(sh);
        const wA = Math.max(7, F.dv * 0.44), wB = Math.max(7, F.du * 0.34);
        const cu = (F.u0 + F.u1) / 2, cv = (F.v0 + F.v1) / 2;
        const barA = clipBand(sh, F.vx, F.vy, cv - wA / 2, cv + wA / 2);
        const barB = clipBand(sh, F.ux, F.uy, cu - wB / 2, cu + wB / 2);
        if (!barA || !barB) return null;
        push(ringXY, 0, baseTop);
        push(barA, baseTop, hM);
        push(barB, baseTop, hM * (0.92 + 0.08 * u(73)));
        return done("cruciform");
      }
      case "shifted": {
        // PLATES THAT DO NOT SIT OVER EACH OTHER. The contemporary move: each
        // stage slides sideways off the one below, so the building has an
        // overhang and a terrace on opposite faces at every level.
        const F = plateFrame(ringXY);
        const n = 2 + (u(74) > 0.5 ? 1 : 0);
        let z = 0, r = ringXY;
        for (let k = 0; k <= n; k++) {
          const top = k === n ? hM : hM * ((k + 1) / (n + 1));
          if (!push(r, z, top)) break;
          z = top;
          const s2 = shrink(ringXY, side, 0.86 - k * 0.08) ?? r;
          const off = (u(75 + k) - 0.5) * Math.min(10, F.dv * 0.34);
          r = slide(s2, F.vx * off, F.vy * off);
        }
        return done("shifted stack");
      }
      case "notch": {
        // A SLOT CUT THROUGH THE MIDDLE OF A SLAB, open at the top, with the
        // low link left across the bottom of it. A slab with a hole in it is
        // a completely different object against the sky.
        const F = plateFrame(ringXY);
        const cu = (F.u0 + F.u1) / 2;
        const slot = Math.max(6, F.du * (0.16 + 0.10 * u(80)));
        const A = clipLo(ringXY, F.ux, F.uy, cu - slot / 2);
        const B = clipHi(ringXY, F.ux, F.uy, cu + slot / 2);
        if (!A || !B) return null;
        push(A, 0, hM);
        push(B, 0, hM * (0.94 + 0.06 * u(81)));
        const link = clipBand(ringXY, F.ux, F.uy, cu - slot / 2, cu + slot / 2);
        if (link) push(link, 0, hM * (0.26 + 0.24 * u(82)));
        return done("notched slab");
      }
      case "chamfertaper": {
        // ONE VANDERBILT. The corners come off four times on the way up, each
        // cut deeper than the last, so the tower is an octagon by the top and
        // never shows the same width twice.
        const cuts = [0.06, 0.13, 0.22, 0.33], sc = [1.0, 0.90, 0.79, 0.66];
        const tops = [0.30, 0.56, 0.80, 1.0];
        let z = 0, ok = 0;
        for (let k = 0; k < 4; k++) {
          const plate = k === 0 ? ringXY : shrink(ringXY, side, sc[k] * sc[k]);
          if (!plate) break;
          if (push(chamferRing(plate, cuts[k] * side * (0.7 + 0.6 * u(84))), z, hM * tops[k])) ok++;
          z = hM * tops[k];
        }
        return ok >= 3 ? done("chamfer taper") : null;
      }
      case "twist": {
        // Every stage turns on the one below, so the corners run up the
        // building as slow helices and the silhouette changes as you walk
        // round it. Thin enough that the steps read as a curve.
        const cen = centroid(ringXY);
        const n = 8 + Math.floor(u(85) * 5);
        const total = (0.40 + 0.30 * u(86)) * (u(87) < 0.5 ? 1 : -1);
        let z = 0, ok = 0;
        for (let k = 0; k < n; k++) {
          const t = (k + 1) / n;
          const plate = shrink(ringXY, side, (1 - t * 0.16) ** 2);
          if (!plate) break;
          if (push(spin(plate, cen[0], cen[1], total * (k / n)), z, hM * t)) ok++;
          z = hM * t;
        }
        return ok >= 4 ? done("twist") : null;
      }
      default: return null;
    }
  }

  /** The setback families — the ones that step a single plate as it rises. */
  function trySetback(fam) {
    switch (fam) {
      case "cake": {
        // WEDDING CAKE — two to four setbacks above a street wall whose
        // height comes off the lot rather than off a constant.
        const n = 2 + Math.floor(u(7) * 3);
        const baseTop = hM * (0.24 + 0.24 * u(8));
        let z = baseTop, frac = 1, lastR = ringXY;
        push(ringXY, 0, baseTop);
        for (let k = 0; k < n; k++) {
          frac *= 0.62 + 0.16 * u(20 + k);
          const r = shrink(ringXY, side, frac);
          if (!r) break;
          const top = k === n - 1 ? hM : z + (hM - z) * (0.34 + 0.26 * u(30 + k));
          if (!push(r, z, top)) break;
          z = top; lastR = r;
        }
        if (z < hM - 0.6) push(lastR, z, hM);
        return done("wedding cake");
      }
      // ---- THE DECO FAMILIES ---------------------------------------------
      //
      // Five silhouettes off the 1916 envelope described at the top of this
      // file. What they have that `cake`, `base` and `step` do not is that
      // their setbacks are NOT uniform centroid shrinks: they come off the
      // sides that face a street, they land on the pier module, and two of
      // them keep something rising above the last step. Salts 100+ — below 60
      // is the setback families and 60+ the plan families.

      case "zigzag": {
        // THE SKY EXPOSURE PLANE, STEPPED OFF THE STREET SIDES ONLY.
        //
        // The step depth is not a taste: it is the plane. Each tier rises by
        // some amount and has to give back that rise divided by the slope,
        // and the slope is 2 x the height district multiple — so a 2.5-times
        // district gives back 1 ft for every 5 ft of rise and comes out
        // nearly vertical, while a 1-times district gives back 1 for every 2
        // and comes out a squat ziggurat. One roll picks the district, and
        // that one roll is why two neighbouring deco towers of the same
        // height are different shapes.
        //
        // WHICH SIDE IS THE STREET IS NOT KNOWABLE HERE. This module has the
        // footprint and no street graph — the same gap `playerMassing` states
        // for its own `back()` — so the side is hashed. What survives either
        // way, and is the whole point, is that the steps are on SOME sides and
        // not on all of them.
        //
        // Chrysler Building 1930, Empire State Building 1931, Guardian
        // Building Detroit 1929.
        const F = plateFrame(ringXY);
        const narrow = Math.min(F.du, F.dv);
        if (narrow < MIN_FLOOR_W + 2 * PIER_BAY) return null;
        const slope = 2 * HEIGHT_DISTRICTS[Math.min(4, Math.floor(u(100) * 5))];
        // A corner lot two thirds of the time. Deco towers are corner
        // buildings far more often than the block's corner-to-midblock count
        // says, because the corner is where the frontage and the light are
        // worth what the facade cost.
        const st = Math.floor(u(101) * 4);        // not `side`: that is the plate's own width
        const mask = u(102) < 0.66
          ? (1 << (st & 1)) | (4 << ((st >> 1) & 1))
          : 1 << (st & 1);
        const baseTop = hM * (0.20 + 0.22 * u(103));
        if (!push(ringXY, 0, baseTop)) return null;
        let z = baseTop, back = 0, diag = 0, lastR = ringXY, stepped = 0;
        for (let k = 0; k < 5 && z < hM - 1.2; k++) {
          const rise = (hM - z) * (0.26 + 0.24 * u(104 + k));
          const run = bays(rise / slope);
          // The shoulder, or the whole face. A shoulder costs no width off
          // the narrow axis, which is why it is available on plates that
          // cannot afford another full step.
          if (u(110 + k) < 0.34) diag += bays(run * 1.6);
          else if (narrow - 2 * (back + run) >= MIN_FLOOR_W) back += run;
          else break;
          let r = back > 0 ? stepBack(ringXY, F, mask, back) : ringXY;
          if (r && diag > 0) r = cornerCut(r, F, st, diag);
          if (!r) break;
          // Measured on the tier that was actually produced, not predicted off
          // the frame — the corner cut is invisible to the frame axes and it is
          // where the width was going.
          if (narrowestSpan(r) < MIN_FLOOR_W) break;
          const top = Math.min(hM, z + rise);
          if (!push(r, z, top)) break;
          z = top; lastR = r; stepped++;
        }
        // A STEPPED BUILDING WITH NO STEP IN IT IS A BOX DRAWN AS TWO VOLUMES.
        // When the plate is too narrow for even the first setback the loop
        // breaks on its first pass, and the fill below then pushes the whole
        // footprint again at a second height — two tiers, so `done` accepts it,
        // and it draws as a prism with an invisible seam in it. Measured before
        // this guard, the top volume was the full plate on more than 5% of
        // builds. Refuse, and the next family on the list is tried.
        if (!stepped) return null;
        if (z < hM - 0.6) push(lastR, z, hM);
        return done("deco zigzag");
      }

      case "telescope": {
        // THE TELESCOPING SLAB. Many small steps instead of two or three big
        // ones, every one taken as a NOTCH AT THE END, so the slab narrows in
        // plan as it rises while the long faces stay flat and the piers on
        // them run the whole way — 30 Rockefeller Plaza, 1933.
        //
        // It is the other thing the plane produces, and the reason it looks
        // nothing like a wedding cake is arithmetic: a thin plate cannot
        // afford to step on its long side, because the long side is where the
        // floor's width is. So it pays the plane at the two ends, where it has
        // depth to spare, and the setbacks become many and small rather than
        // few and deep.
        const F = plateFrame(ringXY);
        if (F.du < F.dv * 1.25) return null;         // it has to be a slab to telescope
        if (F.dv < MIN_FLOOR_W) return null;
        const slope = 2 * HEIGHT_DISTRICTS[Math.min(4, Math.floor(u(115) * 5))];
        const n = 4 + Math.floor(u(116) * 6);        // four to nine steps
        const baseTop = hM * (0.16 + 0.16 * u(117));
        if (!push(ringXY, 0, baseTop)) return null;
        let z = baseTop, back = 0, lastR = ringXY, made = 0;
        for (let k = 0; k < n; k++) {
          const rise = (hM - baseTop) / n * (0.80 + 0.40 * u(118 + (k % 6)));
          const run = bays(rise / slope);
          if (F.du - 2 * (back + run) < MIN_FLOOR_W) break;
          back += run;
          const r = stepBack(ringXY, F, 3, back);    // both ends of the long axis
          if (!r || narrowestSpan(r) < MIN_FLOOR_W) break;
          const top = Math.min(hM, z + rise);
          if (!push(r, z, top)) break;
          z = top; lastR = r; made++;
        }
        if (made < 2) return null;                   // two steps is a taper, not a telescope
        if (z < hM - 0.6) push(lastR, z, hM);
        return done("telescoping slab");
      }

      case "quarter": {
        // THE TOWER EXEMPTION, TAKEN AS AN ACTUAL QUARTER.
        //
        // `base` below is the same idea with a shaft at 30-50% of the plate,
        // which is a tower on a HALF and would not have been permitted. The
        // resolution's number is a quarter, and the difference is the entire
        // silhouette: a quarter-plate shaft is slender enough that it needs a
        // stepped shoulder between itself and the base, and that shoulder is
        // where the ornament goes.
        //
        // IT NEEDS A BIG LOT, AND THAT IS THE MECHANISM RATHER THAN A GATE.
        // A quarter of the site has to still be a floor, so the exemption is
        // only usable where the plate is about twice eleven metres across —
        // which is why the buildings that used it are the big Manhattan
        // assemblages and why a small-lot owner took the plane instead. On a
        // sixteen-metre harbour-town lot this family correctly refuses.
        // Chrysler Building 1930, Empire State Building 1931.
        //
        // THE QUARTER IS A CAP, NOT A TARGET, AND THE GRID IS NOT NEGOTIABLE.
        // Take the biggest grid-aligned tower the exemption allows: inset by
        // whole bays, then keep adding a bay until the area is genuinely under a
        // quarter. `shrink` is not used here because it works toward an AREA
        // fraction and backs off silently when the ring will not take the inset,
        // so what it returns is not what it was asked for — and the two things
        // that must both hold, a quarter of the site and a pier over a pier, are
        // one an area and the other a length.
        //
        // `insetRingPerp` is NOT the tool for this and that is worth saying,
        // because it looks like it is. It moves each vertex along the AVERAGED
        // edge normal, so on a right-angled corner the vertex travels d along
        // the diagonal and each edge only moves d/sqrt(2) — measured, a shaft
        // built that way put 0% of its setbacks on a pier. The four half-plane
        // clips move each edge by exactly what they are told.
        const F = plateFrame(ringXY);
        const frac = 0.20 + 0.05 * u(126);
        let d = bays((Math.min(F.du, F.dv) * (1 - Math.sqrt(frac))) / 2);
        let shaft = stepBack(ringXY, F, 15, d);
        // A QUARTER OF WHAT. The resolution says a quarter of the SITE, and what
        // this function is handed is the buildable plate: the footprint on the
        // generator path, and on the renderer's path the coverage the player was
        // charged for (`playerMassing` nulls `lotRing` on purpose, because a
        // podium drawn wider than the site was sold is the fault the coverage
        // contract exists to stop). Measuring the quarter against the plate is
        // therefore CONSERVATIVE — it draws a smaller tower than the law allowed
        // and refuses lots the law would have permitted — and it is the reading
        // that stays inside the coverage contract, so it is the one built.
        // What it costs is measurable and it is small: this family reaches 0.03%
        // of player builds, and the binding constraint is not the rule but the
        // plate, which is sixteen metres across at the median in a harbour town
        // and has to be twenty-two before a quarter of it is still a floor.
        const cover = (r) => (r ? Math.abs(polygonArea([r])) / areaM2 : 1);
        for (let g = 0; g < 8 && shaft && cover(shaft) > 0.25; g++) {
          d += PIER_BAY;
          shaft = stepBack(ringXY, F, 15, d);
        }
        if (!shaft || narrowestSpan(shaft) < MIN_FLOOR_W || cover(shaft) > 0.25) return null;
        const mid = stepBack(ringXY, F, 15, bays(d / 2));
        if (!mid) return null;
        // The street wall goes to the top of the vertical envelope, which is
        // low against a tower that is not height-limited at all: the base is
        // a fifth to a third of the way up, not the 44% `base` uses.
        const baseTop = hM * (0.16 + 0.16 * u(127));
        const shoulderAt = baseTop + (hM - baseTop) * (0.14 + 0.16 * u(128));
        push(ringXY, 0, baseTop);
        push(mid, baseTop, shoulderAt);
        // The crown steps once more, because the exempt tower has nothing
        // above it to answer to and the top is the only part anybody sees.
        const crownAt = hM * (0.88 + 0.07 * u(129));
        push(shaft, shoulderAt, crownAt);
        // Measured off the SHAFT's own frame and not the plate's: the shaft is
        // already metres inside the lot line, so a cut placed at the plate's
        // corner would fall outside the shaft and remove nothing.
        const SF = plateFrame(shaft);
        const kc = Math.floor(u(130) * 4);
        const crown = cornerCut(cornerCut(shaft, SF, kc, PIER_BAY), SF, kc ^ 3, PIER_BAY);
        if (!push(crown, crownAt, hM)) push(shaft, crownAt, hM);
        return done("tower on a quarter");
      }

      case "ferriss": {
        // BOTH MECHANISMS AT ONCE — Ferriss's final stage, and the one
        // silhouette in the vocabulary that nothing here could express.
        //
        // His own description: "an imposing structure with a central tower
        // about 1,000 feet high, around seventy storeys, flanked by setback
        // wings of forty storeys." `cake` cannot do it, because `cake`'s last
        // tier always ends at hM — the cake IS the building and there is no
        // spike — and one family in this file cannot call another.
        //
        // The spike is a BAND across the plate rather than a square out of the
        // middle of it, which is what makes it buildable on a modest lot: the
        // band keeps the plate's whole narrow dimension and gives away length,
        // so an eleven-metre floor survives on a sixteen-metre plate where a
        // square quarter would not.
        const F = plateFrame(ringXY);
        if (Math.min(F.du, F.dv) < MIN_FLOOR_W) return null;
        if (F.du < MIN_FLOOR_W + 4 * PIER_BAY) return null;
        const slope = 2 * HEIGHT_DISTRICTS[Math.min(4, Math.floor(u(136) * 5))];
        const st = Math.floor(u(137) * 4);        // not `side`: that is the plate's own width
        const mask = (1 << (st & 1)) | (4 << ((st >> 1) & 1));
        const baseTop = hM * (0.14 + 0.14 * u(138));
        push(ringXY, 0, baseTop);
        // the wings: one or two steps, and they stop well below the top
        const wingTop = hM * (0.52 + 0.18 * u(139));
        let z = baseTop, back = 0, ok = 0;
        const nw = 1 + (u(140) > 0.45 ? 1 : 0);
        for (let k = 0; k < nw; k++) {
          const rise = (wingTop - z) / (nw - k);
          const run = bays(rise / slope);
          if (Math.min(F.du, F.dv) - 2 * (back + run) < MIN_FLOOR_W) break;
          back += run;
          const r = stepBack(ringXY, F, mask, back);
          if (!r || narrowestSpan(r) < MIN_FLOOR_W) break;
          if (!push(r, z, Math.min(wingTop, z + rise))) break;
          z = Math.min(wingTop, z + rise); ok++;
        }
        if (!ok) return null;
        // the exempt centre tower, carried up out of the wings
        const wide = Math.max(MIN_FLOOR_W, bays(F.du * (0.28 + 0.18 * u(141))));
        // SET OUT FROM ONE PARTY WALL, IN WHOLE BAYS — which is how a column
        // grid is actually set out, and the only way the tower's piers can land
        // on the wing's piers below. Centring the band on the plate cannot do
        // it: the plate's own width is whatever the surveyor left, so a centred
        // band starts half a bay off the grid however wide it is. The tower is
        // not always over the middle either; Ferriss's own drawing puts it off
        // centre, and the roll is what decides how far.
        const slack = Math.max(0, F.du - wide);
        const u0b = F.u0 + Math.min(slack, bays(slack * (0.20 + 0.60 * u(142))));
        const shaft = clipBand(ringXY, F.ux, F.uy, u0b, u0b + wide);
        if (!shaft || shaft.length < 3 || narrowestSpan(shaft) < MIN_FLOOR_W) return null;
        if (!push(shaft, z, hM)) return null;
        return done("ferriss wings");
      }

      case "crest": {
        // THE DECO APARTMENT HOUSE, AND EVERY OTHER LOW DECO BUILDING: the
        // whole vertical event is the PARAPET.
        //
        // Five to seven storeys of flat brick with a slightly projecting
        // central entrance bay carried up past the parapet, or with the two
        // end bays carried up instead — the Grand Concourse in the Bronx had
        // nearly 300 of these by the 1930s and its historic district holds 27
        // built 1935-1945; Napier rebuilt 111 downtown buildings on the same
        // move in 1931-33 after the 7.8 quake of 3 February 1931; Miami
        // Beach's 800 contributing buildings are three storeys "symmetrical
        // about a central vertical feature with a stepped or semicircular
        // parapet tower" and no setbacks at all.
        //
        // The raised bay is a CAP, NOT A FLOOR, so it is allowed to be narrow:
        // the renderer's rule is two storeys of floor-to-floor, and `fh` does
        // not reach this module, so the cap is held under 5 m — below 2 x the
        // 2.6 m floor the renderer floors its own `fh` at. Anything taller
        // would disqualify the family instead of drawing it.
        const F = plateFrame(ringXY);
        const cap = Math.min(5.0, hM * (0.10 + 0.05 * u(148)));
        const z = hM - cap;
        if (z < 8) return null;
        if (!push(ringXY, 0, z)) return null;
        // the entrance bay, or the flanking pair. Both are documented and they
        // read completely differently against the sky.
        const across = u(149) < 0.5;
        const ax = across ? F.vx : F.ux, ay = across ? F.vy : F.uy;
        const lo = across ? F.v0 : F.u0, hi = across ? F.v1 : F.u1;
        const span = hi - lo;
        if (span < 3 * PIER_BAY) return null;
        // A projecting entrance bay is two, three or four windows wide, because
        // it is a bay and not a proportion — same pier module as the setbacks.
        const w = Math.min(span - 2 * PIER_BAY, bays(span * (0.20 + 0.16 * u(150))));
        if (w < PIER_BAY * 2) return null;
        if (u(151) < 0.62) {
          // Set out from one party wall in whole bays, for the reason `ferriss`
          // states: a band centred on the plate starts half a bay off the grid.
          const slack = Math.max(0, span - w);
          const a0 = lo + Math.min(slack, bays(slack * (0.34 + 0.32 * u(152))));
          if (!push(clipBand(ringXY, ax, ay, a0, a0 + w), z, hM)) return null;
        } else {
          const a = clipLo(ringXY, ax, ay, lo + w);
          const b = clipHi(ringXY, ax, ay, hi - w);
          if (!push(a, z, hM)) return null;
          // never quite level: the pair is a composition, not a mirror
          push(b, z, hM - cap * 0.22 * u(153));
        }
        return done("deco parapet");
      }

      case "base": {
        // TOWER ON A BASE — the 1916 exemption let a tower on a quarter of
        // the lot rise without limit, and that is the reason a prewar
        // skyline has spikes in it rather than only ziggurats.
        const shaftFrac = 0.30 + 0.20 * u(10);
        const shaft = shrink(ringXY, side, shaftFrac);
        if (!shaft) return null;
        const baseTop = Math.min(hM * 0.44, 11 + 13 * u(9));
        const crownAt = hM * (0.90 + 0.05 * u(11));
        push(ringXY, 0, baseTop);
        push(shaft, baseTop, crownAt);
        const crown = shrink(shaft, side * Math.sqrt(shaftFrac), 0.54 + 0.20 * u(12));
        if (!push(crown, crownAt, hM)) push(shaft, crownAt, hM);
        return done("tower on a base");
      }
      case "step": {
        // One high setback — the cheapest way to satisfy the sky plane.
        const zc = hM * (0.58 + 0.24 * u(13));
        push(ringXY, 0, zc);
        push(shrink(ringXY, side, 0.50 + 0.26 * u(14)), zc, hM);
        return done("high setback");
      }
      case "loft": {
        // A tall thin loft goes straight up and stops, with at most a small
        // step under the cornice.
        const zc = hM * (0.86 + 0.08 * u(5));
        push(ringXY, 0, zc);
        push(shrink(ringXY, side, 0.62 + 0.16 * u(6)), zc, hM);
        return done("loft step");
      }
      case "terrace": {
        // A prewar apartment house often gives its top floor a terrace.
        const zc = hM * (0.74 + 0.12 * u(2));
        push(ringXY, 0, zc);
        push(shrink(ringXY, side, 0.58 + 0.22 * u(3)), zc, hM);
        return done("prewar terrace");
      }
      case "retail base": {
        // Shops at grade run out to the lot line under a set-back upper floor.
        if (!lotRingM) return null;         // no deed to oversail: not this family
        const pod = insetRingPerp(lotRingM, 1.2 + 1.8 * u(20));
        if (!pod) return null;
        push(pod, 0, 4.5 + 4 * u(21));
        push(ringXY, 0, hM);
        return done("retail base");
      }
      case "podium": {
        // PODIUM AND SHAFT. One to four storeys of base, not 8.0 m of it.
        if (!lotRingM) return null;
        const pod = insetRingPerp(lotRingM, 1.0 + 1.8 * u(22));
        if (!pod) return null;
        push(pod, 0, 5 + 10 * u(23));
        push(ringXY, 0, hM);
        return done("podium and shaft");
      }
      case "mech": {
        // The plant floor steps in — the commonest thing a 1970s tower does
        // to its own profile.
        const zc = hM * (0.42 + 0.26 * u(24));
        push(ringXY, 0, zc);
        push(shrink(ringXY, side, 0.74 + 0.16 * u(25)), zc, hM);
        return done("mechanical setback");
      }
      case "taper": {
        // Two or three steps through the top third.
        const n = 2 + (u(26) > 0.55 ? 1 : 0);
        let z = hM * (0.58 + 0.14 * u(27)), frac = 1, lastR = ringXY;
        push(ringXY, 0, z);
        for (let k = 0; k < n; k++) {
          frac *= 0.76 + 0.12 * u(40 + k);
          const r = shrink(ringXY, side, frac);
          if (!r) break;
          const top = k === n - 1 ? hM : z + (hM - z) * (0.42 + 0.20 * u(50 + k));
          if (!push(r, z, top)) break;
          z = top; lastR = r;
        }
        if (z < hM - 0.6) push(lastR, z, hM);
        return done("taper");
      }
      default: return null;
    }
  }

  /** One family, whichever half of the vocabulary it lives in. */
  const attempt = (fam) => (PLAN.has(fam) ? tryPlan(fam) : trySetback(fam));

  // ---- a caller-supplied shortlist ----------------------------------------
  //
  // The renderer knows things this function cannot: what the coverage dial was
  // set to, how slender the result is, and whether the site has a deed ring
  // worth oversailing. When it hands over a list, it has already made the
  // "what can this site take" judgement and the only thing left here is to try
  // them in hash order and take the first that stands up.
  if (families && families.length) {
    const n = families.length;
    const start = Math.min(n - 1, Math.floor(u(4) * n));
    for (let i = 0; i < n; i++) {
      const r = attempt(families[(start + i) % n]);
      if (r) return r;
      out.length = 0;                // a family that would not fit leaves no trace
    }
    return null;
  }

  // ---- a plate too deep to daylight has to be opened up -------------------
  //
  // THE PLAN FAMILIES CANNOT LIVE BEHIND THE HEIGHT GATE.
  //
  // Both era branches below start by refusing anything under about twenty
  // metres, because a setback is a thing that happens to a TALL building —
  // and that is right for setbacks. It is exactly wrong for the plan, and
  // measured it cost almost all of the effect: across three cities only 99
  // buildings out of 4,394 volumes ever reached massing() at all, so a
  // courtyard block could only ever appear on a lot that was both enormous
  // and tall. The types this is trying to draw — the dumbbell tenement, the
  // courtyard apartment house, the light court — are five and six storey
  // buildings. They are the fabric, not the skyline.
  //
  // The real gate is not height, it is DEPTH. A room needs a window; a plate
  // whose short dimension runs past about twenty metres has a middle that
  // cannot reach one, and it gets cut open — at any height, on any lot.
  //
  // And it stops. Air conditioning and the fluorescent tube between them
  // made a deep plate habitable, so from the mid-fifties nobody bothers
  // any more. That is why a prewar district reads as blocks with holes in
  // them and a postwar one reads as solid slabs, and it now falls out of the
  // dates rather than being asserted.
  if (hM >= 7.5 && year < 1958) {
    const F0 = plateFrame(ringXY);
    const deep = Math.min(F0.du, F0.dv);
    if (deep > 19.5) {
      const plans = [];
      if (deep > 29 && F0.du > 33 && areaM2 >= 1000) plans.push("courtyard", "courtyard", "courtyard");
      if (deep > 21 && F0.du > 25) plans.push("lightcourt", "lightcourt");
      if (F0.du > 23) plans.push("dumbbell", "dumbbell");
      // Not every deep plate got opened. Some were built solid and were
      // miserable, and those are the ones that got converted a century later.
      for (let k = 0; k < 3; k++) plans.push("solid");
      const pf = plans[Math.min(plans.length - 1, Math.floor(u(59) * plans.length))];
      if (pf !== "solid") {
        const r = tryPlan(pf);
        if (r) return r;
        out.length = 0;              // a plan that would not fit leaves no trace
      }
    }
  }

  // ---- pre-1961: the sky-exposure plane, and the tower that dodged it ----
  if (year < 1961) {
    // WHAT A PLATE WILL TAKE.
    //
    // A setback gives away WIDTH, and a building that has none cannot give
    // any: four steps off a sixteen-metre plate leave a top floor eight
    // metres across, which is a chimney. So each family is offered only to
    // plates wide enough to survive it, and the choice is made among the
    // families that are actually available rather than by one roll that
    // ignores the site. Repeats in the list are weights.
    if (hM < 22 || areaM2 < 200) return null;         // a walk-up stands straight
    const fams = [];
    if (hM >= 30) {
      if (W >= 22) fams.push("cake", "cake", "cake");
      if (W >= 19) fams.push("base", "base");
      if (W >= 15) fams.push("step", "step");
      fams.push("loft");
    }
    if (hM >= 24) fams.push("terrace");
    // THE DECO ENVELOPE, ON THE DATES THE LAW WAS IN FORCE.
    //
    // These are gated on 1916 and NOT on the deco decades, and that separation
    // is the point: the setback is the CODE and the zigzag is the FACADE. A
    // 1954 office on a Manhattan-rules lot had to step back too, and it did —
    // what makes a stepped building read as deco is the pier and the spandrel
    // and the crown, which is styles.ts's decision and not this file's. Gating
    // the shape on 1925-1932 would have asserted that nothing else ever
    // stepped, which is false, and would also have thrown away the only
    // silhouette a 1948 tower is allowed to have.
    //
    // The weights argue from what got built rather than from a preference. The
    // plane was universal — every tall building in a height district met it,
    // and the two ways of meeting it were to step the street face or to
    // telescope the ends — while the tower exemption was for the big
    // assemblages that could spare three quarters of a site. So the stepped
    // envelope carries five slots between it and the telescope, and the quarter
    // tower one, and it usually refuses anyway on a plate this size.
    if (year >= 1916 && hM >= 30) {
      fams.push("zigzag", "zigzag", "zigzag");
      fams.push("telescope", "telescope");
      fams.push("ferriss");
      fams.push("quarter");
    }
    // THE PARAPET BAY, which is a style device and is dated like one: the deco
    // apartment house runs c.1929-1942, Napier's 111 rebuilt downtown
    // buildings 1931-33, Miami Beach c.1935-1942, Pueblo Deco from 1927. Three
    // slots on multifamily because the apartment house is the highest-count
    // deco type in the world and one everywhere else, which is the ordering
    // the counts support and the most they support.
    if (year >= 1927 && year <= 1943) fams.push("crest", ...(klass === "multifamily" ? ["crest", "crest"] : []));
    // THE PLAN FAMILIES, offered on the lots that force them. A plate you
    // cannot get daylight into the middle of has to be opened up, and how it
    // opens depends on how much frontage there is to do it with: a big
    // through-block lot closes a courtyard, a narrower one leaves the court
    // open at the back, and a tenement lot pinches its waist.
    if (areaM2 >= 1500 && W >= 36) fams.push("courtyard", "courtyard");
    if (areaM2 >= 850 && W >= 27) fams.push("lightcourt", "lightcourt");
    if (areaM2 >= 620 && W >= 23) fams.push("dumbbell", "dumbbell");
    if (hM >= 32 && W >= 20) fams.push("campanile");
    if (hM >= 28 && W >= 26) fams.push("endtowers");
    // A box is a real answer, and a city with no boxes in it is as obviously
    // fake as a city with nothing else. Fewer of them once a building is
    // tall enough that somebody had to think about its top.
    for (let k = hM >= 30 ? 2 : 3; k > 0; k--) fams.push("slab");
    const fam = fams[Math.min(fams.length - 1, Math.floor(u(4) * fams.length))];
    if (PLAN.has(fam)) return tryPlan(fam);
    return trySetback(fam);
  }

  // ---- 1961 and after: floor-area ratio, and a bonus for a plaza ---------
  if (hM < 20) return null;
  const post = [];
  if (lotRingM && klass !== "industrial") post.push("retail base");
  if (hM >= 32) {
    if (lotRingM && klass !== "industrial") post.push("podium", "podium");
    post.push("mech", "mech");
    if (W >= 18) post.push("taper", "taper");
  }
  // The post-war plan families. The daylight constraint eased — air
  // conditioning and the fluorescent tube between them made a deep plate
  // habitable — so the courtyard becomes rare and the shapes that survive
  // are the ones done for PROFILE rather than for light: the cruciform, the
  // pair off one podium, the plates that slide, the hat that oversails.
  if (hM >= 38 && W >= 22) post.push("cruciform", "cruciform");
  if (hM >= 42 && W >= 26) post.push("twins");
  if (hM >= 40) post.push("shifted", "shifted");
  if (hM >= 30 && W >= 30) post.push("notch");
  // THE TOWERS OF THE LAST DECADE. Gated on 1998 and on 62 m — about twenty
  // storeys — because a chamfered faceted taper is a move nobody was making
  // before that, and putting one on a 1974 building would be the same
  // anachronism as an arch on a 1958 brick slab.
  if (hM >= 62 && year >= 1998) post.push("chamfertaper", "chamfertaper", "twist");
  if (hM >= 78 && year >= 2005) post.push("chamfertaper", "twist");
  if (areaM2 >= 1600 && W >= 38 && hM < 46) post.push("courtyard");
  if (hM >= 26 && W >= 26) post.push("endtowers");
  // THE ENVELOPE COMES BACK AS A CHOICE, TWICE, AND ONLY WHERE IT ACTUALLY DID.
  //
  // 1961 threw the 1916 formula away, so a stepped deco mass after it is a
  // stylistic decision and has to be dated as one. The dates are the revival's
  // own: the corporate postmodern-Deco moment of the 1980s — One Liberty
  // Place, Philadelphia, 1988, Jahn's "neo-Deco cascade of chevrons" with the
  // Chrysler Building as the acknowledged influence, Tower 57 in 1987,
  // MesseTurm Frankfurt in 1991 — and then the sustained practice from 2008,
  // which is where the setback mass genuinely returned: 15 Central Park West
  // 2008, 30 Park Place 2016, 220 Central Park South 2019, One Bennett Park
  // Chicago 2019. One slot each. The population of these buildings is in the
  // dozens worldwide and the weight has to say so.
  if (hM >= 40 && year >= 1982 && year < 1996) post.push("zigzag", "telescope");
  if (hM >= 40 && year >= 2008) post.push("zigzag", "telescope", "quarter");
  for (let k = hM >= 32 ? 2 : 4; k > 0; k--) post.push("slab");
  const pfam = post[Math.min(post.length - 1, Math.floor(u(19) * post.length))];
  if (PLAN.has(pfam)) return tryPlan(pfam);
  return trySetback(pfam);
}
