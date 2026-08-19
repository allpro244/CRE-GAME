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
  for (let k = hM >= 32 ? 2 : 4; k > 0; k--) post.push("slab");
  const pfam = post[Math.min(post.length - 1, Math.floor(u(19) * post.length))];
  if (PLAN.has(pfam)) return tryPlan(pfam);
  return trySetback(pfam);
}
