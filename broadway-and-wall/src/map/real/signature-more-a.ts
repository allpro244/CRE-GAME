// LATER LANDMARK FORMS, A: the pre-1990 skyline. Eighteen more shapes a
// city's skyline is read from, from the Flatiron's wedge to the postmodern
// peaks, each described in the FormKit RealCity.signatureTower hands it
// (u along the lot's long side, v across, metres, z up from the street).

import type { MoreForm, FormKit } from "./signature";
import { ellipse, rect, chamfered, turn, type P2 } from "./signature-plans";

// ---- plan helpers of this file ----

/** Mirror a plan across v (u -> -u), keeping it counter-clockwise. */
const flipU = (r: P2[]): P2[] => r.map(([u, v]) => [-u, v] as P2).reverse();

/** Scale a plan about its own centroid (not the lot's centre). */
function shrink(r: P2[], f: number): P2[] {
  let cu = 0, cv = 0;
  for (const [u, v] of r) { cu += u / r.length; cv += v / r.length; }
  return r.map(([u, v]) => [cu + (u - cu) * f, cv + (v - cv) * f] as P2);
}

/** A rectangle with its four corners notched square by c: the re-entrant corners of a deco shaft. 12 points. */
function notched(a: number, b: number, c: number): P2[] {
  c = Math.min(c, a * 0.4, b * 0.4);
  return [[-a + c, -b], [a - c, -b], [a - c, -b + c], [a, -b + c], [a, b - c], [a - c, b - c],
    [a - c, b], [-a + c, b], [-a + c, b - c], [-a, b - c], [-a, -b + c], [-a + c, -b + c]];
}

/** A square of half-side s whose faces are folded into k pointed glass bays each, d deep. */
function pleated(s: number, d: number, k: number): P2[] {
  const out: P2[] = [];
  const i0 = s - d;
  // four sides, counter-clockwise from the -v face; on each, a base point then a tip
  const sides: [P2, P2, P2][] = [[[-i0, -i0], [1, 0], [0, -1]], [[i0, -i0], [0, 1], [1, 0]], [[i0, i0], [-1, 0], [0, 1]], [[-i0, i0], [0, -1], [-1, 0]]];
  for (const [o, t, n] of sides) {
    for (let j = 0; j < k; j++) {
      const f0 = (j / k) * 2 * i0, f1 = ((j + 0.5) / k) * 2 * i0;
      out.push([o[0] + t[0] * f0, o[1] + t[1] * f0]);
      out.push([o[0] + t[0] * f1 + n[0] * d, o[1] + t[1] * f1 + n[1] * d]);
    }
  }
  return out;
}

/** A pyramid (or cone) on plan r from z0 to a point at z1, in the form's cladding or in metal. */
function pyramid(k: FormKit, r: P2[], z0: number, z1: number, col?: number[], fam?: string) {
  k.loft([{ r, z: z0 }, { r: shrink(r, 0.02), z: z1 }], false, fam ?? k.fam, col);
}

/** A colonnade: n piers per side round a square of half-side s (or a circle of radius s), from z0 to z1. */
function colonnade(k: FormKit, s: number, z0: number, z1: number, round = false, du = 0, dv = 0) {
  const sp = 2.8;
  if (round) {
    const n = Math.max(8, Math.round((2 * Math.PI * s) / sp));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; k.inst("crownpier", du + Math.cos(a) * s, dv + Math.sin(a) * s, z0, 1, a + Math.PI / 2, z1 - z0); }
    return;
  }
  const n = Math.max(2, Math.round((2 * s) / sp));
  const c = rect(s, s, du, dv);
  for (let q = 0; q < 4; q++) {
    const a = c[q], b = c[(q + 1) % 4], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let j = 0; j < n; j++) k.inst("crownpier", a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n, z0, 1, ang, z1 - z0);
  }
}

export const MORE_FORMS_A: MoreForm[] = [
  {
    // THE WEDGE. A triangle filling the lot to a rounded prow, the same plan
    // floor after floor, a rusticated base and a deep cornice: the 1902
    // Fuller Building, the Flatiron, where two avenues cross at an angle.
    form: { key: "flatiron", name: "Flatiron wedge", blurb: "A limestone wedge to a rounded prow where two avenues meet, a deep cornice", from: 1902, until: 1930, minFloors: 18, fams: ["terracotta", "stone", "buff"] },
    build(k) {
      const a = k.A * 0.98, b = Math.min(k.B, k.A * 0.6) * 0.98;
      const rc = Math.max(1.2, b * 0.09), al = Math.atan2(b, 2 * a), x0 = a - rc / Math.sin(al);
      let plan: P2[] = [[-a, -b]];
      for (let i = 0; i <= 6; i++) { const t = -(Math.PI / 2 - al) + (i / 6) * (Math.PI - 2 * al); plan.push([x0 + Math.cos(t) * rc, Math.sin(t) * rc]); }
      plan.push([-a, b]);
      if (k.turnDir < 0) plan = flipU(plan);
      const zB = Math.min(k.fh * 4, k.H * 0.12), zC = k.H * 0.93;
      k.vol(plan, 0, zB, true);
      k.vol(plan, zB, zC, true);
      k.vol(shrink(plan, 0.95), zC, k.H, true, true);
    },
  },
  {
    // THE DOMED CAMPANILE. A broad mansarded base, out of it a slender square
    // shaft, and on that a bulbous mansard dome under a lantern and a
    // flagstaff: the 1908 Singer Building, the tallest in the world a year.
    form: { key: "singer", name: "Domed campanile", blurb: "A slender shaft out of a broad base, a bulbous dome, a lantern and a flagstaff", from: 1906, until: 1930, minFloors: 35, fams: ["brick", "stone", "terracotta"] },
    build(k) {
      const { H } = k;
      const a = Math.min(k.A, k.B * 1.4), b = k.B, s = Math.min(k.sq * 0.55, Math.max(8, H / 16));
      const zb = H * 0.27, zD = H * 0.72;
      k.vol(rect(a, b), 0, zb, true, true);
      k.vol(rect(s, s), zb, zD, true);
      // corner piers carried the height of the shaft
      for (const [u, v] of rect(s * 0.93, s * 0.93)) k.vol(rect(s * 0.12, s * 0.12, u, v), zb, zD + 1.2, false);
      const oct = chamfered(s, s, s * 0.32);
      const prof: [number, number][] = [[0, 1.02], [0.035, 1.14], [0.075, 1.04], [0.11, 0.72], [0.135, 0.42]];
      k.loft(prof.map(([dz, f]) => ({ r: turn(oct, 0, f), z: zD + 1.2 + dz * H })), false, k.fam, k.COPPER);
      for (const [u, v] of rect(s * 1.0, s * 1.0)) k.inst("pinnacle", u, v, zD + 1.2, 0.6);
      const zl = zD + 1.2 + 0.135 * H, lan = chamfered(s * 0.36, s * 0.36, s * 0.13);
      k.vol(lan, zl, zl + H * 0.045, true);
      pyramid(k, lan, zl + H * 0.045, H, k.COPPER);
      k.mast(H, Math.max(6, H * 0.05), 0.3);
    },
  },
  {
    // THE CLOCK CAMPANILE. Saint Mark's bell tower blown up to fifty floors:
    // a plain square shaft, a clock on every face, an open colonnaded belfry,
    // a pyramid and a gilt lantern: the 1909 Metropolitan Life tower.
    form: { key: "campanile", name: "Clock campanile", blurb: "A marble campanile: clock faces, an open belfry, a pyramid and a gilt lantern", from: 1909, until: 1935, minFloors: 40, fams: ["stone", "whitebrick", "terracotta"] },
    build(k) {
      const { H } = k;
      const s = Math.min(k.sq * 0.85, Math.max(9, H / 14));
      const z1 = H * 0.6, z2 = H * 0.68, z3 = H * 0.77, zE = z3 + 1.6;
      k.vol(rect(s * 1.04, s * 1.04), 0, k.zL * 1.4, true);
      k.vol(rect(s, s), k.zL * 1.4, z1, true);
      // the clock stage, a little proud, and a gilt clock on each face
      k.vol(rect(s * 1.04, s * 1.04), z1, z2, true);
      const cr = Math.min(s * 0.4, (z2 - z1) * 0.4), zc = (z1 + z2) / 2, o = s * 1.04 + 0.12;
      const face = (w: number, dz: number) => ({ w, dz });
      const pr = [face(0.35, -1), face(0.92, -0.4), face(0.92, 0.4), face(0.35, 1)];
      for (const [nu, nv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        k.loft(pr.map(({ w, dz }) => ({ z: zc + dz * cr, r: nu ? rect(0.15, w * cr, nu * o, 0) : rect(w * cr, 0.15, 0, nv * o) })), true, k.fam, k.GOLD);
      }
      // the belfry: a core behind an open colonnade, an entablature on it
      k.vol(rect(s * 0.66, s * 0.66), z2, z3, false);
      colonnade(k, s * 0.94, z2, z3);
      k.vol(rect(s, s), z3, zE, true);
      for (const [u, v] of rect(s * 0.9, s * 0.9)) k.inst("pinnacle", u, v, zE, 0.55);
      const zP = H * 0.93;
      k.loft([{ r: rect(s * 0.96, s * 0.96), z: zE }, { r: rect(s * 0.2, s * 0.2), z: zP }], false, k.fam, k.COPPER);
      const lan = chamfered(s * 0.2, s * 0.2, s * 0.07);
      k.vol(lan, zP, H * 0.97, true);
      k.spire(H * 0.97, H, s * 0.16, 8, k.GOLD);
    },
  },
  {
    // THE GOTHIC CROWN. A plain shaft, and on it an octagonal lantern held by
    // flying buttresses sprung from piers at the corners, every pier a
    // pinnacle: the 1925 Tribune Tower, Rouen's butter tower on Michigan Avenue.
    form: { key: "buttress", name: "Gothic crown", blurb: "An octagonal lantern held up by flying buttresses and a ring of pinnacles", from: 1922, until: 1935, minFloors: 30, fams: ["stone", "terracotta", "gothic"] },
    build(k) {
      const { H } = k;
      const a = Math.min(k.A, k.B * 1.3), b = k.B, s = Math.min(k.sq * 0.8, Math.max(10, H / 8.5));
      const zb = H * 0.16, zc = H * 0.72;
      k.vol(rect(a, b), 0, zb, true);
      k.vol(rect(s, s), zb, zc, true);
      // corner piers rising past the shaft, each ending in a pinnacle
      const p = s * 0.12, zp = zc + H * 0.11;
      for (const [u, v] of rect(s - p, s - p)) { k.vol(rect(p, p, u, v), zc, zp, true); k.inst("pinnacle", u, v, zp, Math.max(0.8, p / 1.4)); }
      // the octagon, twice, and a little stone spirelet
      const r = s * 0.62, oct = chamfered(r, r, r * 0.42), z1 = zc + H * 0.15, z2 = z1 + H * 0.06;
      k.vol(oct, zc, z1, true);
      for (const [u, v] of oct) k.inst("pinnacle", u * 0.95, v * 0.95, z1, 0.8);
      k.vol(turn(oct, 0, 0.72), z1, z2, true);
      k.vol(turn(oct, 0, 0.42), z2, H * 0.96, true);
      pyramid(k, turn(oct, 0, 0.42), H * 0.96, H);
      // the flying buttresses: one from each pier, one from each face, to the octagon
      const w = Math.max(0.7, s * 0.05), m = r - (r * 0.42) / 2;
      for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        k.loft([{ r: rect(w, w, su * (s - p * 1.6), sv * (s - p * 1.6)), z: zc + H * 0.07 }, { r: rect(w, w, su * (m + w), sv * (m + w)), z: zc + H * 0.12 }], true);
      }
      for (const [nu, nv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        k.loft([{ r: rect(w, w * 1.6, nu * s * 0.94, nv * s * 0.94), z: zc + 0.6 }, { r: rect(w, w * 1.6, nu * (r + w), nv * (r + w)), z: zc + H * 0.08 }], true);
      }
    },
  },
  {
    // THE ZIGGURAT. The 1916 zoning envelope taken literally: setback after
    // setback, each a few floors, until the tower is a stepped mountain with a
    // small temple on the summit — Bank of Manhattan's neighbours, 1 Wall's.
    form: { key: "ziggurat", name: "Ziggurat", blurb: "A stepped mountain of deco setbacks with a little temple on the summit", from: 1924, until: 1940, minFloors: 25, fams: ["deco", "decobrick", "stone"] },
    build(k) {
      const { H } = k;
      const a = Math.min(k.A, k.B * 1.5), b = k.B;
      const n = 7 + Math.floor(k.h(0xa11) * 3), z0 = H * 0.3, zT = H * 0.84;
      k.vol(rect(a, b), 0, z0, true);
      let fa = 1, fb = 1;
      for (let i = 1; i <= n; i++) {
        fa = 1 - (0.72 * i) / n; fb = 1 - (0.6 * i) / n;
        k.vol(rect(a * fa, b * fb), z0 + ((zT - z0) * (i - 1)) / n, z0 + ((zT - z0) * i) / n, true);
      }
      // the temple: a cella behind a colonnade, an entablature, a gilt roof
      const st = Math.min(a * fa, b * fb) * 0.8, zE = H * 0.93;
      k.vol(rect(st * 0.66, st * 0.66), zT, zE, false);
      colonnade(k, st * 0.94, zT, zE);
      k.vol(rect(st, st), zE, zE + 1.4, true);
      k.loft([{ r: rect(st, st), z: zE + 1.4 }, { r: rect(st * 0.12, st * 0.12), z: H }], false, k.fam, k.GOLD);
    },
  },
  {
    // THE MOORING MAST. A full-lot base, a setback, a notched shaft rising in
    // shallow steps, and on top a drum of glass and aluminium meant for
    // dirigibles, an antenna above it: the 1931 Empire State Building.
    form: { key: "mooring", name: "Mooring mast", blurb: "A notched limestone shaft stepping in to a glass mast drum and an antenna", from: 1930, until: 1940, minFloors: 60, fams: ["deco", "stone", "decobrick"] },
    build(k) {
      const { H } = k;
      const a0 = Math.min(k.A, k.B * 1.6), b0 = k.B;
      const sa = Math.min(a0 * 0.66, Math.max(12, H / 9)), sb = Math.min(b0 * 0.7, sa * 0.78), c = Math.min(sa, sb) * 0.16;
      k.vol(rect(a0, b0), 0, H * 0.055, true);
      k.vol(notched(Math.min(a0 * 0.86, sa * 1.35), Math.min(b0 * 0.84, sb * 1.35), c * 1.4), H * 0.055, H * 0.18, true);
      k.vol(notched(sa, sb, c), H * 0.18, H * 0.68, true);
      k.vol(notched(sa * 0.84, sb * 0.84, c * 0.8), H * 0.68, H * 0.76, true);
      k.vol(notched(sa * 0.66, sb * 0.66, c * 0.6), H * 0.76, H * 0.81, true);
      const rm = Math.min(sa, sb) * 0.38;
      k.vol(chamfered(rm * 1.25, rm * 1.25, rm * 0.5), H * 0.81, H * 0.84, true);
      // the mast drum: glass and metal, buttressed by four fins, a domed cap
      const d = chamfered(rm, rm, rm * 0.42);
      k.loft([{ r: d, z: H * 0.84 }, { r: turn(d, 0, 0.86), z: H * 0.95 }], false, "silverglass");
      for (let i = 0; i < 4; i++) {
        const t = Math.PI / 4 + (i * Math.PI) / 2, rr = rm * 0.9;
        k.inst("fin", Math.cos(t) * rr, Math.sin(t) * rr, H * 0.84, 1.3, t + Math.PI / 2, (H * 0.115) / 1.3);
      }
      k.loft([{ r: turn(d, 0, 0.86), z: H * 0.95 }, { r: turn(d, 0, 0.7), z: H * 0.98 }, { r: turn(d, 0, 0.3), z: H }], false, k.fam, k.STEEL);
      k.mast(H, Math.max(16, H * 0.14), 0.55);
    },
  },
  {
    // THE SETBACK SLAB. A thin limestone blade, its narrow ends stepping back
    // as it rises so the long faces stand sheer: the 1933 RCA Building at
    // Rockefeller Center, low wings at its foot.
    form: { key: "slabsetback", name: "Setback slab", blurb: "A thin limestone blade, sheer on its long faces, its narrow ends stepping back", from: 1932, until: 1950, minFloors: 40, fams: ["deco", "stone", "decobrick"] },
    build(k) {
      const { H } = k;
      const a = Math.min(k.A * 0.97, Math.max(H * 0.2, 18)), b = Math.min(k.B * 0.95, Math.max(a * 0.3, 8));
      k.vol(rect(a, Math.min(k.B * 0.95, b * 2.1)), 0, Math.max(k.fh * 5, H * 0.06), true, true);
      // the steps: the two ends step back at their own pace (chirality per deed)
      const L = [1, 0.9, 0.78, 0.68, 0.58], Rr = [1, 0.95, 0.88, 0.8, 0.72], zs = [0, 0.44, 0.58, 0.7, 0.82, 1];
      const [fl, fr] = k.turnDir > 0 ? [L, Rr] : [Rr, L];
      for (let i = 0; i < 5; i++) {
        const u0 = -a * fl[i], u1 = a * fr[i];
        k.vol(rect((u1 - u0) / 2, b, (u0 + u1) / 2, 0), zs[i] * H, zs[i + 1] * H, true, i === 4);
      }
      // a lower shoulder on one long face, the way the slab grows wider at its foot
      k.vol(rect(a * 0.8, b * 0.35, 0, -b * 1.3), 0, H * 0.22, true);
    },
  },
  {
    // THE CHÂTEAU. A stone tower under a steep copper hipped roof, round
    // turrets with conical caps at its corners, a flèche on the ridge: the
    // railway hotel and the insurance tower of the Château style, 1910s.
    form: { key: "chateautower", name: "Château tower", blurb: "A stone tower under a steep copper roof, conical turrets at its corners", from: 1910, until: 1940, minFloors: 20, fams: ["stone", "romanesque", "brick"] },
    build(k) {
      const { H } = k;
      const a = Math.min(k.A * 0.97, k.B * 1.35, Math.max(H * 0.3, 14)), b = Math.min(k.B * 0.97, a);
      const rh = Math.min(H * 0.28, b * 2.2), zE = H - rh;
      k.vol(rect(a, b), 0, zE, true);
      // the hipped roof, ridge along the long way
      const ra = Math.max(0.6, a - b * 0.92);
      k.loft([{ r: rect(a, b), z: zE }, { r: rect(ra, 0.25), z: H }], true, k.fam, k.COPPER);
      // four corner turrets rising through the eaves, their cones well above
      const rt = Math.min(b * 0.24, Math.max(3, H / 26));
      const zt = zE + rh * 0.3;
      for (const [u, v] of rect(a - rt * 0.9, b - rt * 0.9)) {
        k.vol(ellipse(14, rt, rt, 0).map(([x, y]) => [x + u, y + v] as P2), zE * 0.62, zt, true);
        k.spire(zt, zt + rt * 3.6, rt * 1.08, 14, k.COPPER, u, v);
      }
      // a dormered gable on each long face, and a copper flèche on the ridge
      for (const sv of [-1, 1]) {
        const g = rect(b * 0.35, b * 0.3, 0, sv * (b - b * 0.3));
        k.vol(g, zE, zE + rh * 0.35, false);
        k.loft([{ r: g, z: zE + rh * 0.35 }, { r: rect(0.25, b * 0.3, 0, sv * (b - b * 0.3)), z: zE + rh * 0.62 }], true, k.fam, k.COPPER);
      }
      k.spire(H - 0.5, H + rh * 0.4, Math.max(0.8, b * 0.06), 6, k.COPPER);
    },
  },
  {
    // THE CIVIC CUPOLA. A broad stone tower, a square tier with little
    // corner turrets, a drum ringed by columns, a dome and a gilt figure:
    // McKim, Mead & White's 1914 Municipal Building, the city hall as tower.
    form: { key: "cupola", name: "Civic cupola", blurb: "A stone tower crowned by a colonnaded drum, a dome and a gilt figure", from: 1910, until: 1935, minFloors: 25, fams: ["stone", "terracotta", "georgian"] },
    build(k) {
      const { H } = k;
      const a = Math.min(k.A, k.B * 1.5), b = k.B, s = Math.min(k.sq * 0.78, Math.max(10, H / 6.5));
      const rd = s * 0.56, hd = rd * 0.85, lan = Math.max(3.5, H * 0.035);
      const zD = H * 0.965 - hd - lan, zC = zD - Math.max(k.fh * 4, H * 0.1), zT = zC - Math.max(k.fh * 4, H * 0.12);
      k.vol(rect(a, b), 0, zT, true);
      k.vol(rect(s, s), zT, zC, true);
      // corner turrets on the square tier, each under a little dome
      const rt = s * 0.14;
      for (const [u, v] of rect(s - rt * 1.2, s - rt * 1.2)) {
        const c = ellipse(12, rt, rt).map(([x, y]) => [x + u, y + v] as P2);
        k.vol(c, zC, zC + rt * 2.6, true);
        k.loft([0, 0.5, 0.8, 1].map((f) => ({ r: shrink(c, Math.max(0.03, Math.cos((f * Math.PI) / 2))), z: zC + rt * 2.6 + f * rt })), false, k.fam, k.COPPER);
      }
      // the drum: a core behind a ring of columns, an entablature, an attic
      const zA = zD - 2.4;
      k.vol(ellipse(28, rd * 0.74, rd * 0.74), zC, zA, false);
      colonnade(k, rd * 0.95, zC, zA, true);
      k.vol(ellipse(28, rd, rd), zA, zA + 1.4, true);
      k.vol(ellipse(28, rd * 0.86, rd * 0.86), zA + 1.4, zD, true);
      // the dome, a lantern, the figure on its mast
      const dome = [0, 0.3, 0.55, 0.75, 0.9, 1].map((f) => ({ r: ellipse(28, rd * 0.86 * Math.max(0.12, Math.cos((f * Math.PI) / 2)), rd * 0.86 * Math.max(0.12, Math.cos((f * Math.PI) / 2))), z: zD + hd * Math.sin((f * Math.PI) / 2) }));
      k.loft(dome, false, k.fam, k.COPPER);
      const lr = rd * 0.86 * 0.12;
      k.vol(ellipse(10, lr, lr), zD + hd, zD + hd + lan * 0.7, true);
      k.spire(zD + hd + lan * 0.7, H, lr * 1.1, 10, k.GOLD);
      k.mast(H, Math.max(4, H * 0.025), 0.25);
    },
  },
  {
    // THE PLAZA SLAB. A pure bronze box held back from the street behind an
    // open granite plaza, lifted on columns over a glass lobby, a spine
    // and a low bustle behind it: Mies's 1958 Seagram Building.
    form: { key: "plazaslab", name: "Plaza slab", blurb: "A pure bronze slab on columns, set back behind an open plaza", from: 1956, until: 1975, minFloors: 30, fams: ["bronze", "blackglass", "glass"] },
    build(k) {
      const { H } = k;
      const at = Math.min(k.A * 0.8, Math.max(H * 0.15, 14)), bt = Math.min(k.B * 0.42, at * 0.58);
      const ds = Math.max(2.5, bt * 0.32), vc = k.B * 0.96 - 2 * ds - bt, zl = k.zL + k.fh;
      // the rear: a low bustle, and a spine up the back of the slab
      const vb = vc + bt + ds;
      k.vol(rect(Math.min(k.A * 0.95, at * 1.3), ds, 0, vb), 0, H * 0.2, true);
      k.vol(rect(at * 0.42, ds, 0, vb), H * 0.2, H * 0.985, true);
      // the slab on its columns over a glass lobby
      k.vol(rect(at * 0.82, bt * 0.7, 0, vc), 0, zl, false, false, "glass");
      k.bridge(rect(at, bt, 0, vc), zl, zl + k.fh);
      k.vol(rect(at, bt, 0, vc), zl + k.fh, H, true, true);
      const n = 5;
      for (let i = 0; i <= n; i++) for (const sv of [-1, 1]) k.inst("crownpier", -at * 0.97 + (i * 2 * at * 0.97) / n, vc + sv * bt * 0.95, 0, 1.1, 0, zl / 1.1);
    },
  },
  {
    // TWIN SQUARES. Two identical square shafts of close-set mullions, side
    // by side on a plaza, flat-topped, one carrying the antenna: Yamasaki's
    // 1973 World Trade Center, the skyline's tallest pair.
    form: { key: "twinslabs", name: "Twin squares", blurb: "Two identical square shafts on a windswept plaza, an antenna on one", from: 1968, until: 1980, minFloors: 60, long: 1.6, fams: ["fins", "silverglass", "precast"] },
    build(k) {
      const { H } = k;
      const s = Math.min(k.B * 0.92, k.A / 2.5, Math.max(H / 12, 12));
      const cu = k.A * 0.98 - s, dv = Math.max(0, k.B * 0.97 - s) * 0.8;
      const zb = [0.36, 0.72], bh = k.fh * 1.6;
      const ant = k.h(0x7c3) < 0.5 ? -1 : 1;
      for (const sg of [-1, 1]) {
        const u = sg * cu, v = sg * dv * k.turnDir;
        // the arcaded lobby, recessed under the shaft
        k.vol(rect(s * 0.9, s * 0.9, u, v), 0, k.zL * 1.3, false);
        k.bridge(rect(s, s, u, v), k.zL * 1.3, k.zL * 1.3 + 0.6);
        let z = k.zL * 1.3 + 0.6;
        // the shaft, banded by two mechanical floors
        for (const f of zb) {
          k.vol(rect(s, s, u, v), z, H * f, false);
          k.vol(rect(s * 0.985, s * 0.985, u, v), H * f, H * f + bh, false, false, "blackglass");
          z = H * f + bh;
        }
        k.vol(rect(s, s, u, v), z, H, true, true);
        if (sg === ant) k.mast(H, H * 0.2, 0.9, u, v);
      }
    },
  },
  {
    // THE X-BRACED TAPER. A dark obelisk of a tower whose faces lean in all
    // the way up, braced by great diagonal Xs across every face, twin masts on
    // the roof: SOM's 1969 John Hancock Center in Chicago.
    form: { key: "xbraced", name: "Tapering X-braced tower", blurb: "A dark tapering shaft crossed by giant X-braces, twin masts on the roof", from: 1965, until: 1985, minFloors: 60, fams: ["blackglass", "bronze", "metalpanel"] },
    build(k) {
      const { H } = k;
      const a0 = Math.min(k.A * 0.94, k.B * 1.5, Math.max(H / 6.5, 16)), b0 = Math.min(k.B * 0.94, a0 * 0.66), tp = 0.62;
      const zL = k.zL, aZ = (z: number) => a0 * (1 - (1 - tp) * (z / H)), bZ = (z: number) => b0 * (1 - (1 - tp) * (z / H));
      k.loft([{ r: rect(a0, b0), z: 0 }, { r: rect(aZ(H), bZ(H)), z: H }], true);
      // the Xs: n stacked on every face, each a pair of steel diagonals and a tie
      const n = 5, z0 = zL * 1.2, dz = (H - z0) / n, w = Math.max(0.8, a0 * 0.035), col = k.fam === "metalpanel" ? k.BRONZE : k.STEEL;
      const bar = (face: number, t0: number, t1: number, za: number, zb: number) => {
        const secs: { r: P2[]; z: number }[] = [];
        for (let j = 0; j <= 4; j++) {
          const z = za + ((zb - za) * j) / 4, t = t0 + ((t1 - t0) * j) / 4, A = aZ(z) + 0.25, B = bZ(z) + 0.25;
          const r = face === 0 ? rect(w, 0.25, t * aZ(z), -B) : face === 1 ? rect(0.25, w, A, t * bZ(z)) : face === 2 ? rect(w, 0.25, t * aZ(z), B) : rect(0.25, w, -A, t * bZ(z));
          secs.push({ r, z });
        }
        k.loft(secs, false, k.fam, col);
      };
      for (let i = 0; i < n; i++) {
        const za = z0 + i * dz, zb = za + dz;
        for (let f = 0; f < 4; f++) { bar(f, -0.97, 0.97, za, zb); bar(f, 0.97, -0.97, za, zb); }
        k.loft([{ r: rect(aZ(za) + 0.3, bZ(za) + 0.3), z: za }, { r: rect(aZ(za + 1) + 0.3, bZ(za + 1) + 0.3), z: za + 1 }], false, k.fam, col);
      }
      for (const su of [-1, 1]) k.mast(H, H * 0.17, 0.75, su * aZ(H) * 0.4, 0);
    },
  },
  {
    // BUNDLED TUBES. Nine square tubes bundled three by three, dropping away
    // one or two at a time so the tower steps in plan as it rises, dark
    // mechanical belts and twin masts: SOM's 1974 Sears Tower.
    form: { key: "bundle", name: "Bundled tubes", blurb: "Nine black tubes bundled together, stopping at different heights, twin masts", from: 1970, until: 1990, minFloors: 60, fams: ["blackglass", "bronze", "glass"] },
    build(k) {
      const { H } = k;
      const S = Math.min(k.sq * 0.95, Math.max(H / 9.5, 15)), e = S / 3;
      // the real tower's pattern: two full, three to 90 floors, two to 66, two to 50
      const F = [[0.46, 0.61, 0.83], [0.83, 1, 1], [0.61, 0.83, 0.46]];
      const rot = Math.floor(k.h(0xb0d) * 4) * (Math.PI / 2);
      const belts = [0.3, 0.6];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const top = H * F[j][k.turnDir > 0 ? i : 2 - i];
        const c = rect(e, e, (i - 1) * 2 * e, (j - 1) * 2 * e), r = turn(c, rot);
        let z = 0;
        for (const bf of belts) {
          const zb = H * bf;
          if (top < zb + k.fh * 4) break;
          k.vol(r, z, zb, false);
          k.vol(r, zb, zb + k.fh * 1.5, false, false, k.fam === "blackglass" ? "bronze" : "blackglass");
          z = zb + k.fh * 1.5;
        }
        k.vol(r, z, top, true, top < H);
        if (top >= H) {
          const [mu, mv] = turn([[(i - 1) * 2 * e, (j - 1) * 2 * e]], rot)[0];
          k.mast(H, H * 0.2, 0.8, mu, mv);
        }
      }
    },
  },
  {
    // THE SLANT TOP. A square aluminium tower lifted nine floors on four
    // columns at the middle of its sides (a church kept its corner), its
    // crown cut at 45° toward the sun: Hugh Stubbins's 1977 Citicorp Center.
    form: { key: "slanttop", name: "Slant top", blurb: "A silver square on four stilts at its mid-sides, its crown sliced off at 45°", from: 1975, until: 1990, minFloors: 40, fams: ["ribbon", "silverglass", "metalpanel"] },
    build(k) {
      const { H } = k;
      const s = Math.min(k.sq * 0.95, Math.max(H / 10, 13));
      const q = Math.floor(k.h(0x5a7) * 4) * (Math.PI / 2);
      const zS = Math.max(k.fh * 6, H * 0.12), w = s * 0.17;
      // the four stilts at the mid-sides and the core between them
      for (const [u, v] of [[s - w, 0], [-(s - w), 0], [0, s - w], [0, -(s - w)]]) k.vol(rect(w, w, u, v), 0, zS, false);
      k.vol(rect(s * 0.3, s * 0.3), 0, zS, false, false, "glass");
      k.bridge(rect(s, s), zS, zS + k.fh * 1.2);
      const hc = Math.min(2 * s, H * 0.3), zT = H - hc;
      k.vol(rect(s, s), zS + k.fh * 1.2, zT, false);
      // the crown: the whole top sliced at one slope, in bare aluminium
      const lo: P2[] = [[-s, -s], [s, -s], [s, s], [-s, s]], hi: P2[] = [[-s, -s], [-s + 0.4, -s], [-s + 0.4, s], [-s, s]];
      k.loft([{ r: turn(lo, q), z: zT }, { r: turn(hi, q), z: H }], true, k.fam, k.STEEL);
    },
  },
  {
    // THE CYLINDER CLUSTER. A tall glass cylinder with a revolving restaurant
    // on top, four shorter cylinders round it on a podium: John Portman's 1977
    // Renaissance Center, the downtown hotel as a mirrored citadel.
    form: { key: "cylinders", name: "Cylinder cluster", blurb: "A tall mirror-glass cylinder in a ring of shorter ones, a restaurant on top", from: 1974, until: 1990, minFloors: 25, fams: ["silverglass", "blueglass", "glass"] },
    build(k) {
      const { H } = k;
      const r0 = Math.min(k.B * 0.48, k.R * 0.5, Math.max(H / 8, 9)), r1 = r0 * 0.68;
      const du = Math.min(k.A - r1, (r0 + r1) * 0.82), dv = Math.min(k.B - r1, (r0 + r1) * 0.82);
      const zP = Math.max(k.fh * 4, H * 0.05);
      k.vol(chamfered(Math.min(k.A * 0.95, du + r1), Math.min(k.B * 0.95, dv + r1), r1), 0, zP, true, false, "precast");
      const circ = (r: number, u = 0, v = 0) => ellipse(32, r, r).map(([x, y]) => [x + u, y + v] as P2);
      const lo = H * (0.55 + 0.06 * k.h(0xc71));
      for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) k.vol(circ(r1, su * du, sv * dv), zP, lo, true, true);
      // the tall one, with a dark restaurant band and a cap above
      const zR = H * 0.92;
      k.vol(circ(r0), zP, zR, false);
      k.vol(circ(r0 * 1.04), zR, zR + Math.max(k.fh * 2, H * 0.04), false, false, "blackglass");
      k.vol(circ(r0 * 0.96), zR + Math.max(k.fh * 2, H * 0.04), H, true, true);
    },
  },
  {
    // THE BROKEN PEDIMENT. A granite slab whose top is a gable split at the
    // ridge round a circular notch, a seven-storey arch at its foot: Philip
    // Johnson's 1984 AT&T Building, the "Chippendale" highboy that made
    // postmodernism a skyline.
    form: { key: "pediment", name: "Broken pediment", blurb: "A pink granite slab under a split pediment, a tall arch at its door", from: 1982, until: 1995, minFloors: 35, fams: ["pomo", "stone"] },
    build(k) {
      const { H } = k;
      const a = Math.min(k.A * 0.95, Math.max(H * 0.17, 16)), b = Math.min(k.B * 0.95, a * 0.55);
      const sv = k.turnDir; // which long face carries the arch
      const P = (r: P2[]) => (sv > 0 ? r : r.map(([u, v]) => [-u, -v] as P2));
      // the arch: a recessed bay in the middle of the front, its head a semicircle
      const wm = Math.min(a * 0.2, H * 0.06), zs = Math.max(k.fh * 3, H * 0.15 - wm), zA = zs + wm + k.fh * 1.5, d = b * 0.3;
      k.vol(P([[-a, -b + d], [a, -b + d], [a, b], [-a, b]]), 0, zA, true);
      k.vol(P(rect((a - wm) / 2, d / 2, -(a + wm) / 2, -b + d / 2)), 0, zA, true);
      k.vol(P(rect((a - wm) / 2, d / 2, (a + wm) / 2, -b + d / 2)), 0, zA, true);
      for (const sg of [-1, 1]) {
        const secs: { r: P2[]; z: number }[] = [];
        for (let j = 1; j <= 8; j++) {
          const t = j / 8, z = zs + wm * Math.sin((t * Math.PI) / 2) , w = wm * Math.cos((t * Math.PI) / 2);
          const r: P2[] = sg < 0 ? [[-wm, -b], [-w, -b], [-w, -b + d], [-wm, -b + d]] : [[w, -b], [wm, -b], [wm, -b + d], [w, -b + d]];
          secs.push({ r: P(r), z });
        }
        secs.push({ r: secs[secs.length - 1].r, z: zA });
        k.loft(secs, false);
      }
      k.bridge(P(rect(wm, d / 2, 0, -b + d / 2)), zA - 0.01, zA);
      // the slab, and its split pediment with the circular notch
      const ph = Math.max(a * 0.55, H * 0.08), zP = H - ph, gw = a * 0.12;
      k.vol(rect(a, b), zA, zP, true);
      for (const sg of [-1, 1]) {
        const half = (au: number): P2[] => sg < 0 ? [[-au, -b], [-gw, -b], [-gw, b], [-au, b]] : [[gw, -b], [au, -b], [au, b], [gw, b]];
        k.loft([{ r: half(a), z: zP }, { r: half(gw + 0.4), z: zP + ph * (1 - (gw + 0.4) / a) }], true);
      }
      const zN = zP + ph * 0.3;
      k.vol(rect(gw, b), zP, zN, false);
      for (const sg of [-1, 1]) {
        const secs: { r: P2[]; z: number }[] = [];
        for (let j = 0; j <= 6; j++) {
          const t = j / 6, nn = gw * Math.sin((t * Math.PI) / 2) * 0.97, z = zN + gw * (1 - Math.cos((t * Math.PI) / 2));
          secs.push({ r: sg < 0 ? [[-gw, -b], [-nn, -b], [-nn, b], [-gw, b]] : [[nn, -b], [gw, -b], [gw, b], [nn, b]], z });
        }
        k.loft(secs, false);
      }
    },
  },
  {
    // GLASS GOTHIC. A tower of dark mirror glass folded into pointed bays,
    // stepping back twice, every step bristling with small glass spires, a
    // pleated glass spire at the top: Johnson & Burgee's 1984 PPG Place.
    form: { key: "glassgothic", name: "Glass Gothic", blurb: "A castle of dark mirror glass, folded into bays and bristling with glass spires", from: 1982, until: 1995, minFloors: 30, fams: ["blackglass", "silverglass", "glass"] },
    build(k) {
      const { H } = k;
      const s = Math.min(k.sq * 0.95, Math.max(H / 7.5, 14)), d = s * 0.12;
      const kk = Math.max(3, Math.round((2 * s) / 9));
      const tiers: [number, number, number, number][] = [[1, kk, 0, 0.62], [0.72, Math.max(2, kk - 1), 0.62, 0.78], [0.46, 2, 0.78, 0.9]];
      const ph = Math.max(4, k.fh * 2);
      for (const [f, n, z0, z1] of tiers) {
        const r = pleated(s * f, d * f, n);
        k.vol(r, z0 * H, z1 * H, true);
        // a small glass spire on every bay point of the step
        const pw = Math.max(0.6, d * f * 0.45);
        r.forEach(([u, v], j) => { if (j % 2) pyramid(k, rect(pw, pw, u * 0.94, v * 0.94), z1 * H, z1 * H + ph * (0.8 + 0.6 * f)); });
      }
      // four corner turrets on the first step, each a glass spire
      const ti = s - d, tw = s * 0.11;
      for (const [u, v] of rect(ti - tw, ti - tw)) {
        k.vol(rect(tw, tw, u, v), H * 0.62, H * 0.69, true);
        pyramid(k, rect(tw, tw, u, v), H * 0.69, H * 0.69 + tw * 3.4);
      }
      const top = pleated(s * 0.46, d * 0.46, 2);
      k.loft([{ r: top, z: H * 0.9 }, { r: turn(top, 0, 0.03), z: H }], false);
    },
  },
  {
    // POSTMODERN PEAKS. A stone base, a notched glass shaft, and a crown of
    // crossed gables stepping up to a gilt pyramid, small lit caps at the
    // shoulders: the late-80s downtown tower that wanted a roof again
    // (Norwest Center, Bank of America Plaza, Two Liberty's cousins).
    form: { key: "pomopeaks", name: "Postmodern peaks", blurb: "Crossed gables stepping up to a gilt pyramid on a stone base", from: 1985, until: 1998, minFloors: 35, fams: ["pomo", "silverglass", "blueglass"] },
    build(k) {
      const { H } = k;
      const a0 = Math.min(k.A * 0.97, k.B * 1.4), b0 = k.B * 0.97;
      const a1 = Math.min(a0 * 0.82, Math.max(H / 7, 14)), b1 = Math.min(b0 * 0.82, a1 * 0.8), c = Math.min(a1, b1) * 0.14;
      const a2 = a1 * 0.8, b2 = b1 * 0.82, a3 = a1 * 0.4, b3 = b1 * 0.62, s4 = Math.min(a3, b3) * 0.62;
      const g1 = b2 * 0.85, g2 = a3 * 0.9, hp = s4 * 2.6;
      const zP = H - hp, zt3 = zP - g2 * 0.9, zt2 = zt3 - Math.max(g1 * 0.75, k.fh * 4), zt1 = zt2 - Math.max(H * 0.1, k.fh * 5);
      k.vol(rect(a0, b0), 0, H * 0.14, true, false, "stone");
      k.vol(notched(a1, b1, c), H * 0.14, zt1, true);
      k.vol(notched(a2, b2, c * 0.8), zt1, zt2, true);
      // gable one: ridge along u
      k.loft([{ r: rect(a2, b2), z: zt2 }, { r: rect(a2, 0.3), z: zt2 + g1 }], true);
      // the crossing tier and gable two: ridge along v
      k.vol(rect(a3, b3), zt2, zt3, true);
      k.loft([{ r: rect(a3, b3), z: zt3 }, { r: rect(0.3, b3), z: zt3 + g2 }], true);
      // the gilt pyramid on its square lantern, lit caps on the shoulders
      k.vol(rect(s4, s4), zt3, zP, true);
      k.loft([{ r: rect(s4, s4), z: zP }, { r: rect(0.05, 0.05), z: H }], false, k.fam, k.GOLD);
      k.mast(H, Math.max(5, H * 0.03), 0.3);
      const w = Math.min(c * 0.45, b1 * 0.08);
      for (const [u, v] of rect(a1 - c - w, b1 - w)) {
        k.vol(rect(w, w, u, v), zt1, zt1 + w * 2, true);
        k.loft([{ r: rect(w, w, u, v), z: zt1 + w * 2 }, { r: rect(0.05, 0.05, u, v), z: zt1 + w * 5 }], false, k.fam, k.GOLD);
      }
    },
  },
];
