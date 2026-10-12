// LATER LANDMARK FORMS, BOOK B: the post-1990 skyline's shapes after the
// eighteen originals — the sail, the leaning pair, the loop, the skypark, the
// vertical forest and the rest. Each describes itself in the FormKit
// (signature.ts) in the lot's local frame: u along the long side, v across,
// metres, z up. Every vol and every logged loft section must stand inside the
// lot; RealCity retries the form smaller, then drops it.

import type { FormKit, MoreForm } from "./signature";
import { chamfered, ellipse, rect, turn, type P2 } from "./signature-plans";

// ---- small plan helpers, local to this book ----

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Mirror a plan across the u axis (v -> -v), keeping it counter-clockwise. */
const flipV = (r: P2[]): P2[] => r.map(([u, v]) => [u, -v] as P2).reverse();
/** Mirror a plan across the v axis (u -> -u), keeping it counter-clockwise. */
const flipU = (r: P2[]): P2[] => r.map(([u, v]) => [-u, v] as P2).reverse();

/**
 * A curved band: the arc of a circle of radius rc centred at (0, vc), from
 * angle -phi to +phi measured from +v (so the arc's crown is at (0, vc + rc)),
 * of half-thickness th(f) at fraction f (0..1) along it. n points per side,
 * counter-clockwise. f0..f1 cuts a piece of it.
 */
function arcBand(rc: number, vc: number, phi: number, th: (f: number) => number, n: number, f0 = 0, f1 = 1): P2[] {
  const outer: P2[] = [], inner: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const f = lerp(f0, f1, i / n), a = lerp(-phi, phi, f), t = th(f);
    outer.push([Math.sin(a) * (rc + t), vc + Math.cos(a) * (rc + t)]);
    inner.push([Math.sin(a) * (rc - t), vc + Math.cos(a) * (rc - t)]);
  }
  // the crown side runs right to left (counter-clockwise), the hollow side back
  return [...outer.reverse(), ...inner];
}

/** A square of half-side s rounded to a superellipse of exponent p, n points. */
function roundSquare(n: number, s: number, p = 5): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 + Math.PI / n, c = Math.cos(t), si = Math.sin(t);
    out.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * s, Math.sign(si) * Math.pow(Math.abs(si), 2 / p) * s]);
  }
  return out;
}

/** A thin metal member from (u0, v0, z0) to (u1, v1, z1): a sheared square prism of half-side e. */
function member(k: FormKit, u0: number, v0: number, z0: number, u1: number, v1: number, z1: number, e: number, col: number[]) {
  k.loft([{ r: rect(e, e, u0, v0), z: z0 }, { r: rect(e, e, u1, v1), z: z1 }], true, k.fam, col);
}

const GREENS = [[0.22, 0.36, 0.17], [0.29, 0.44, 0.2], [0.18, 0.31, 0.16], [0.36, 0.45, 0.2], [0.5, 0.44, 0.19]];
const SLAB = [0.86, 0.86, 0.83];

export const MORE_FORMS_B: MoreForm[] = [
  {
    form: { key: "sail", name: "Sail", blurb: "A D-plan sail whose leading edge curves back to a white mast", from: 1997, minFloors: 40, fams: ["silverglass", "glass", "blueglass"] },
    build(k) {
      // the sail: a D in plan, flat at the back where a white mast stands,
      // its curved front swelling at the foot and sweeping back to the mast
      // as it rises, like a spinnaker filled with wind — the Burj al Arab
      // (1999) made it the resort tower's signature
      const { A, B, H, zL } = k;
      const dir = k.turnDir;
      const uM = A * 0.86, Lmax = A * 1.72, W0 = Math.min(B * 0.86, A * 0.55), m = 9;
      const plan = (L: number, W: number): P2[] => {
        const uF = uM - L, out: P2[] = [[uM, -W]];
        // the back, then the crown side front-ward, then the hollow side back
        for (let i = 0; i <= m; i++) { const s = 1 - i / m; out.push([uF + L * s, W * Math.sqrt(1 - (1 - s) ** 2)]); }
        for (let i = 1; i < m; i++) { const s = i / m; out.push([uF + L * s, -W * Math.sqrt(1 - (1 - s) ** 2) * 1.0]); }
        return out;
      };
      const P = (r: P2[]) => (dir > 0 ? r : flipU(r));
      const secs: { r: P2[]; z: number }[] = [];
      for (const t of [0, 0.15, 0.3, 0.45, 0.58, 0.7, 0.8, 0.88, 0.94, 1]) {
        const L = Math.max(W0 * 0.7, Lmax * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.55));
        secs.push({ z: lerp(zL, H * 0.97, t), r: P(plan(L, W0 * (1 - 0.32 * t))) });
      }
      k.vol(secs[0].r, 0, zL);
      k.loft(secs, true);
      // the mast: a white spine up the flat back, carried past the roof
      const sp = P(rect(0.8, W0 * 0.45, uM + 0.8));
      k.loft([{ r: sp, z: 0 }, { r: sp, z: H }], true, k.fam, k.WHITE);
      k.spire(H, H * 1.13, 1.3, 6, k.WHITE, dir * (uM + 0.8), 0);
    },
  },
  {
    form: { key: "leaning", name: "Leaning pair", blurb: "Two square towers leaning toward each other across the lot", from: 1994, minFloors: 25, long: 1.6, fams: ["blackglass", "silverglass", "glass"] },
    build(k) {
      // two towers each leaning in toward the other over the open middle of
      // the lot, their tops a street apart: Madrid's Puerta de Europa (1996),
      // fifteen degrees off plumb on counterweighted cores
      const { A, B, H } = k;
      const s = Math.min(B * 0.85, A * 0.19), sv = Math.min(B * 0.88, s * 1.25);
      const u0 = A * 0.96 - s;
      const d = Math.max(0, Math.min(H * 0.27, u0 - 2 * s - 2));
      for (const sg of [-1, 1]) {
        k.loft([{ r: rect(s, sv, sg * u0), z: 0 }, { r: rect(s, sv, sg * (u0 - d)), z: H }], true);
        // a dark plant floor under the roof, and a helipad on one
        k.loft([{ r: rect(s * 0.92, sv * 0.92, sg * (u0 - d)), z: H }, { r: rect(s * 0.92, sv * 0.92, sg * (u0 - d)), z: H + k.fh }], true, "blackglass");
      }
      k.inst("helipad", k.turnDir * (u0 - d), 0, H + k.fh, Math.min(1, s / 9));
    },
  },
  {
    form: { key: "wave", name: "Wave", blurb: "A glass slab wrapped in white balconies that ripple floor by floor like a landscape", from: 2008, minFloors: 40, fams: ["blueglass", "glass", "greenglass"] },
    build(k) {
      // a plain glass slab whose balconies run out to a different line on
      // every floor, so the faces ripple like water or contour lines: Jeanne
      // Gang's Aqua (Chicago, 2009)
      const { A, B, H, zL, fh } = k;
      const amp = Math.min(3.6, B * 0.16, A * 0.16);
      const a = A * 0.92 - amp, b = B * 0.92 - amp;
      k.vol(rect(A * 0.94, B * 0.94), 0, zL * 1.4, true);
      k.vol(rect(a, b), zL * 1.4, H, true, true);
      const sides: [P2, P2, P2][] = [[[-a, -b], [a, -b], [0, -1]], [[a, -b], [a, b], [1, 0]], [[a, b], [-a, b], [0, 1]], [[-a, b], [-a, -b], [-1, 0]]];
      const Pt = 4 * (a + b), k1 = Math.max(2, Math.round(Pt / 44)), k2 = Math.max(3, Math.round(Pt / 23));
      const f1 = k.h(0x1a1) * 6.28, f2 = k.h(0x1a2) * 6.28;
      for (let z = zL * 1.4 + fh; z < H - fh * 0.5; z += fh) {
        const r: P2[] = [];
        let s = 0;
        sides.forEach(([p0, p1, n], si) => {
          const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), m = Math.max(2, Math.round(L / 2.2));
          const pn = sides[(si + 3) % 4][2];
          for (let i = 0; i < m; i++) {
            const f = i / m, p = ((s + L * f) / Pt) * Math.PI * 2;
            const d = amp * Math.max(0.12, Math.min(1, 0.5 + 0.32 * Math.sin(k1 * p + z / 13 + f1) + 0.28 * Math.sin(k2 * p - z / 8 + f2)));
            const nn = i === 0 ? [n[0] + pn[0], n[1] + pn[1]] : n;
            r.push([p0[0] + (p1[0] - p0[0]) * f + nn[0] * d, p0[1] + (p1[1] - p0[1]) * f + nn[1] * d]);
          }
          s += L;
        });
        k.loft([{ r, z: z - 0.35 }, { r, z }], true, k.fam, SLAB);
      }
    },
  },
  {
    form: { key: "loop", name: "Loop", blurb: "Two leaning towers joined by an L-shaped base and an L cantilevered across the top", from: 2008, minFloors: 40, long: 1.5, fams: ["diagrid", "blackglass", "silverglass"] },
    build(k) {
      // two towers leaning in toward each other, standing in opposite halves
      // of the lot, joined at the foot by an L of studios and across the top
      // by an L that cantilevers out into the air: a continuous loop of
      // floors, Koolhaas's CCTV headquarters (Beijing, 2008)
      const { A, B, H } = k;
      const su = Math.min(A * 0.2, B * 0.62), bv = B * 0.92;
      const ub = A * 0.94 - su, d = Math.max(0, Math.min(H * 0.1, (ub - su) * 0.5));
      const ut = ub - d, zB = H * 0.2, zT = H * 0.76;
      const P = (r: P2[]) => (k.turnDir > 0 ? r : flipV(r));
      // the base L: tower two's half run the length of the lot, and tower one's foot
      k.vol(P([[-ub - su, -bv], [-ub + su, -bv], [-ub + su, 0], [ub + su, 0], [ub + su, bv], [-ub - su, bv]]), 0, zB, true);
      // the two leaning towers, each in its own half
      k.loft([{ r: P(rect(su, bv / 2, -ub, -bv / 2)), z: zB }, { r: P(rect(su, bv / 2, -ut, -bv / 2)), z: zT }], false);
      k.loft([{ r: P(rect(su, bv / 2, ub, bv / 2)), z: zB }, { r: P(rect(su, bv / 2, ut, bv / 2)), z: zT }], false);
      // the top L, cantilevered: tower one's half run across to tower two
      k.bridge(P([[-ut - su, -bv], [ut + su, -bv], [ut + su, bv], [ut - su, bv], [ut - su, 0], [-ut - su, 0]]), zT, H);
    },
  },
  {
    form: { key: "aperture", name: "Aperture", blurb: "A square that thins to a blade, a trapezoid opening cut through its top", from: 2006, minFloors: 60, fams: ["silverglass", "blueglass", "glass"] },
    build(k) {
      // a square at the foot whose two faces curve in until the top is a
      // knife edge, and through the top a trapezoid opening for the wind:
      // the Shanghai World Financial Center (2008), the bottle opener
      const { H, zL, sq } = k;
      const s = sq * 0.96;
      const ab = (z: number) => { const t = clamp01((z - zL) / (H - zL)); return [s * (1 - 0.2 * t), s * (1 - 0.8 * Math.pow(t, 1.3))]; };
      const R = (z: number) => { const [a, b] = ab(z); return rect(a, b); };
      const zo0 = H * 0.85, zo1 = H * 0.94;
      k.vol(rect(s, s), 0, zL);
      const secs: { r: P2[]; z: number }[] = [];
      for (const t of [0, 0.2, 0.4, 0.55, 0.7, 0.82, 1]) { const z = lerp(zL, zo0, t); secs.push({ z, r: R(z) }); }
      k.loft(secs, true);
      // the two legs either side of the opening, which is wider at its top
      const leg = (z: number, w: number, sg: number): P2[] => { const [a, b] = ab(z); return sg < 0 ? [[-a, -b], [-w, -b], [-w, b], [-a, b]] : [[w, -b], [a, -b], [a, b], [w, b]]; };
      const w0 = ab(zo0)[0] * 0.42, w1 = ab(zo1)[0] * 0.56;
      for (const sg of [-1, 1]) k.loft([{ r: leg(zo0, w0, sg), z: zo0 }, { r: leg(zo1, w1, sg), z: zo1 }], false);
      // the lintel: a soffit over the opening, then the last of the taper
      k.bridge(R(zo1), zo1, zo1 + 0.4);
      k.loft([{ r: R(zo1 + 0.4), z: zo1 + 0.4 }, { r: R(H), z: H }], true);
    },
  },
  {
    form: { key: "blade", name: "Blade", blurb: "A knife-thin curved slab whose roof steps down in a cascade", from: 2012, minFloors: 45, fams: ["silverglass", "glass", "greenglass"] },
    build(k) {
      // a slab barely a flat deep, bent in a shallow arc, its roof stepping
      // down from one end in a falling curve — the residential blade of the
      // 2010s, every flat a through-view (Jean Nouvel's 53 West 53rd and
      // Hadid's Leeza SOHO pared the tower to an edge in the same years)
      const { A, B, H } = k;
      const t = Math.min(B * 0.26, 7.5), c = A * 0.86;
      const sg = Math.max(1, Math.min(B * 1.84 - 2 * t - 2, c * 0.34));
      const rc = (c * c + sg * sg) / (2 * sg), phi = Math.asin(Math.min(0.999, c / rc));
      const vc = B * 0.92 - t - rc, n = 4;
      const from = k.h(0xb1a) < 0.5 ? 1 : -1;
      const P = (r: P2[]) => { if (k.turnDir < 0) r = flipV(r); return from < 0 ? flipU(r) : r; };
      // the roofline: a curve falling from the full height to under half,
      // each piece's roof a slope along it and a step down to the next
      const zr = (f: number) => H * (1 - 0.55 * Math.pow(f, 1.5));
      for (let i = 0; i < n; i++) {
        const f0 = i / n, f1 = (i + 1) / n, step = i === 0 ? 0 : H * 0.035;
        const z0 = zr(f0) - step, z1 = Math.min(z0 - 3, zr(f1));
        const r = arcBand(rc, vc, phi, () => t, 4, f0, f1);
        k.vol(P(r), 0, z1, false);
        // the slope: the far end at z1 rising to the near end at z0
        const near = arcBand(rc, vc, phi, () => t, 4, f0, f0);
        k.loft([{ r: P(r), z: z1 }, { r: P(near), z: z0 }], false);
      }
    },
  },
  {
    form: { key: "vertforest", name: "Vertical forest", blurb: "Staggered deep balconies on every floor, each one planted with trees", from: 2012, minFloors: 20, fams: ["rainscreen", "stackbrick", "metalpanel"] },
    build(k) {
      // a plain core hung with deep cantilevered balconies that jump from bay
      // to bay floor by floor, every one a planter of trees and shrubs: the
      // tower as a forest, Boeri's Bosco Verticale (Milan, 2014)
      const { A, B, H, zL, fh } = k;
      const D = Math.min(3.4, B * 0.18), a = A * 0.92 - D, b = B * 0.92 - D;
      k.vol(rect(a, b), 0, H, true, true);
      let i = 0;
      for (let z = zL + fh; z < H - fh * 0.6; z += fh, i++) {
        for (let f = 0; f < 4; f++) {
          const along = f % 2 === 0 ? a : b, nb = along > 14 ? 2 : 1;
          for (let j = 0; j < nb; j++) {
            const salt = (i * 8 + f * 2 + j) * 7;
            const l = along * (nb === 2 ? 0.22 : 0.42) * (0.75 + 0.3 * k.h(0x900 + salt));
            const slot = nb === 2 ? (j === 0 ? -0.5 : 0.5) : 0;
            const c = along * (slot + ((i + f) % 2 ? 0.22 : -0.22) * (nb === 2 ? 0.6 : 1) + (k.h(0x901 + salt) - 0.5) * 0.12);
            const cc = Math.max(-along + l, Math.min(along - l, c));
            const d = D * (0.55 + 0.45 * k.h(0x902 + salt));
            const at = (hu: number, hv: number, s: number) => {
              // a box on face f, its long side along the face
              const cu = f === 0 || f === 2 ? s : (f === 1 ? a + hv : -a - hv), cv = f === 0 ? -b - hv : f === 2 ? b + hv : s;
              return f === 0 || f === 2 ? { cu, cv, hu, hv } : { cu, cv, hu: hv, hv: hu };
            };
            const sl = at(l, d / 2, cc);
            k.loft([{ r: rect(sl.hu, sl.hv, sl.cu, sl.cv), z: z - 0.35 }, { r: rect(sl.hu, sl.hv, sl.cu, sl.cv), z }], true, k.fam, SLAB);
            const nt = Math.max(1, Math.round((2 * l) / 4.2));
            for (let q = 0; q < nt; q++) {
              const tc = cc - l + ((q + 0.5) * 2 * l) / nt, th = (l / nt) * 0.9, tv = (d / 2) * 0.85;
              const T = at(th, tv, tc), g = GREENS[Math.floor(k.h(0x903 + salt + q) * GREENS.length)];
              const tall = fh * (0.5 + 0.25 * k.h(0x904 + salt + q));
              const P = (s: number) => turn(chamfered(T.hu * s, T.hv * s, Math.min(T.hu, T.hv) * s * 0.5), 0, 1, T.cu, T.cv);
              k.loft([{ r: P(0.55), z }, { r: P(1), z: z + tall * 0.45 }, { r: P(0.5), z: z + tall }], true, k.fam, g);
            }
          }
        }
      }
    },
  },
  {
    form: { key: "crescent", name: "Crescent", blurb: "A slab bent into a crescent moon, its hollow face turned to the view", from: 2003, minFloors: 25, fams: ["diagrid", "blueglass", "glass"] },
    build(k) {
      // a deep slab bent into a crescent, fattest at the middle and thinning
      // to its tips, the hollow face gathering the sun and the view: Foster's
      // The Bow (Calgary, 2012), and the crescent hotels of the Gulf before it
      const { A, B, H, zL } = k;
      const t0 = Math.min(B * 0.42, 15), c = A * 0.9;
      const sg = Math.max(1, Math.min(B * 1.84 - 2 * t0 - 2, c * 0.5));
      const rc = (c * c + sg * sg) / (2 * sg), phi = Math.asin(Math.min(0.999, c / rc));
      const vc = B * 0.92 - t0 - rc;
      let r = arcBand(rc, vc, phi, (f) => 1.2 + (t0 - 1.2) * Math.pow(Math.sin(f * Math.PI), 0.7), 18);
      if (k.turnDir < 0) r = flipV(r);
      k.vol(r, 0, zL);
      k.vol(r, zL, H, true, true);
    },
  },
  {
    form: { key: "slit", name: "Split tower", blurb: "One block split by a full-height slot, its halves stopping at different heights", from: 2004, minFloors: 35, fams: ["silverglass", "glass", "blackglass"] },
    build(k) {
      // one plan pulled apart down a slot the full height of the tower, the
      // halves slid past each other and stopping at different heights — the
      // split tower of the 2000s (Foster's Torre Caja Madrid frames the same
      // void; Shenzhen and Dubai built the split pair by the dozen)
      const { A, B, H, zL, fh } = k;
      const a = Math.min(A * 0.92, B * 1.15), b = B * 0.86, g = Math.max(2.2, a * 0.075), sh = B * 0.06;
      const H2 = H * (0.78 + 0.08 * k.h(0x511));
      for (const sg of [-1, 1]) {
        const tall = sg === k.turnDir, z1 = tall ? H : H2;
        const half = rect((a - g) / 2, b, sg * (a + g) / 2, sg * sh);
        k.vol(half, 0, zL, false);
        k.vol(half, zL, z1, true, true);
        // the slot face carried up as a glass blade past the roof
        k.vol(rect(Math.min(2, (a - g) / 4), b * 0.9, sg * (g + Math.min(2, (a - g) / 4)), sg * sh), z1, z1 + fh * 2.5, false, false, "silverglass");
        if (tall) k.mast(z1 + fh * 2.5, H * 0.08, 0.5, sg * (a + g) / 2, sg * sh);
      }
    },
  },
  {
    form: { key: "hourglass", name: "Hourglass", blurb: "A twisting oval pinched at the waist, flaring out again to the top", from: 2009, minFloors: 40, fams: ["diagrid", "blueglass", "silverglass"] },
    build(k) {
      // a hyperboloid: an oval wide at the foot, drawn in to a waist above
      // half height and flaring out again as it turns — Canton Tower (2009)
      // made the waisted, twisting lattice a type
      const { R, H, zL } = k;
      const rw = 0.5, tw = 0.56, top = 0.86, bot = 0.95;
      const cLo = tw / Math.sqrt((bot / rw) ** 2 - 1), cHi = (1 - tw) / Math.sqrt((top / rw) ** 2 - 1);
      const prof = (t: number) => rw * Math.sqrt(1 + ((t - tw) / (t < tw ? cLo : cHi)) ** 2);
      const tw2 = k.turnDir * (0.6 + 0.3 * k.h(0x6a1));
      const P = (t: number) => turn(ellipse(40, R * prof(t), R * prof(t) * 0.82), tw2 * t);
      k.vol(P(0), 0, zL);
      const secs: { r: P2[]; z: number }[] = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; secs.push({ z: lerp(zL, H, t), r: P(t) }); }
      k.loft(secs, true);
      k.vol(turn(ellipse(40, R * top * 0.5, R * top * 0.42), tw2), H, H + k.fh * 1.5, true, false, "silverglass");
      k.mast(H + k.fh * 1.5, H * 0.12, 0.6);
    },
  },
  {
    form: { key: "roundobelisk", name: "Rounded obelisk", blurb: "A rounded square tapering gently to a crown screen lit at night", from: 2015, minFloors: 50, fams: ["silverglass", "glass", "metalpanel"] },
    build(k) {
      // a square with softly rounded corners leaning in a little all the way
      // up, the glass giving way at the top to a pale screen that rounds the
      // shoulders and glows after dark: Pelli's Salesforce Tower (2018)
      const { H, zL, sq } = k;
      const s = sq * 0.96, zc = H * 0.9;
      const P = (f: number) => roundSquare(40, s * f, 5);
      k.vol(P(1), 0, zL);
      const secs: { r: P2[]; z: number }[] = [];
      for (const t of [0, 0.35, 0.7, 1]) secs.push({ z: lerp(zL, zc, t), r: P(1 - 0.17 * t) });
      k.loft(secs, false);
      // the crown screen: rounding in over the last tenth, in pale metal
      const crown: { r: P2[]; z: number }[] = [];
      for (const t of [0, 0.35, 0.65, 0.88, 1]) crown.push({ z: lerp(zc, H, t), r: P(0.83 * (1 - 0.2 * t * t)) });
      k.loft(crown, true, k.fam, k.WHITE);
    },
  },
  {
    form: { key: "notched", name: "Notched tower", blurb: "Dark glass in groups of floors, the corners notched deeper as it climbs", from: 1990, minFloors: 40, fams: ["blackglass", "silverglass", "blueglass"] },
    build(k) {
      // a square of dark glass whose corners are cut back in re-entrant
      // notches, deeper at every group of floors until the top is a cross,
      // under a notched lantern and a short spire — the corporate tower KPF
      // and Pelli built from Frankfurt to Singapore in the 1990s
      const { H, zL, fh, sq } = k;
      const s0 = sq * 0.95;
      const plan = (s: number, n: number): P2[] => {
        const out: P2[] = [];
        for (const [cu, cv] of [[1, -1], [1, 1], [-1, 1], [-1, -1]] as P2[]) {
          // each corner: in from one face, the notch, out along the other
          const q: P2[] = [[cu * s, cv * (s - n)], [cu * (s - n), cv * (s - n)], [cu * (s - n), cv * s]];
          out.push(...(cu * cv > 0 ? q : q.reverse()));
        }
        return out;
      };
      const z1 = H * 0.88, G = Math.max(4, Math.round((z1 - zL) / (fh * 7)));
      k.vol(plan(s0, s0 * 0.06), 0, zL, true);
      for (let i = 0; i < G; i++) {
        const t = i / (G - 1), s = s0 * (1 - 0.1 * t) * (i === G - 1 ? 0.9 : 1);
        const z0 = lerp(zL, z1, i / G), zz = lerp(zL, z1, (i + 1) / G);
        k.vol(plan(s, s * (0.14 + 0.3 * t + (i % 2 ? 0.07 : 0))), z0, zz, i === G - 1);
      }
      const top = plan(s0 * 0.62, s0 * 0.62 * 0.36);
      k.vol(top, z1, z1 + fh * 2, true, false);
      k.loft([{ r: top, z: z1 + fh * 2 }, { r: turn(top, 0, 0.08), z: H }], false);
      k.spire(H, H * 1.07, s0 * 0.05, 4);
    },
  },
  {
    form: { key: "cone", name: "Cone", blurb: "A round tower that narrows in one long curve to a point", from: 2014, minFloors: 70, fams: ["diagrid", "silverglass", "glass"] },
    build(k) {
      // round at the foot and closing in a single unbroken curve to a point
      // and a needle — a cone, not a dome: Lotte World Tower (Seoul, 2017)
      // and the Lakhta Center (2019) drew the supertall as a spike
      const { R, H, zL } = k;
      const r0 = R * 0.97, C = (r: number) => ellipse(36, r, r);
      k.vol(C(r0), 0, zL);
      const secs: { r: P2[]; z: number }[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        secs.push({ z: lerp(zL, H, t), r: C(Math.max(0.05, r0 * Math.pow(Math.max(0, 1 - Math.pow(t, 1.25)), 0.72))) });
      }
      k.loft(secs, false);
      k.spire(H * 0.985, H * 1.07, Math.max(0.6, r0 * 0.03), 8);
    },
  },
  {
    form: { key: "terraces", name: "Spiral terraces", blurb: "Oval floors each turned on the last, wrapped in white balcony bands", from: 2011, minFloors: 40, fams: ["glass", "blueglass", "greenglass"] },
    build(k) {
      // an oval floor plate turned a few degrees on the one below, every floor
      // ringed by a white balcony, so the tower twists like a waist — the
      // Absolute towers (Mississauga, 2012), "Marilyn Monroe"
      const { R, H, zL, fh } = k;
      const a = R * 0.97, b = a * (0.62 + 0.08 * k.h(0x7e1)), ins = Math.min(2, b * 0.18);
      const n = Math.max(4, Math.round((H - zL) / fh)), total = k.turnDir * (2.4 + 0.8 * k.h(0x7e2));
      // the rate of turn swells and slackens, so the twist has a waist
      const ang: number[] = [0];
      for (let i = 1; i <= n; i++) ang.push(ang[i - 1] + 1 + 0.85 * Math.sin((i / n) * Math.PI * 2 - 0.6));
      const sc = total / ang[n];
      k.vol(ellipse(32, a - ins, b - ins), 0, zL);
      const core: { r: P2[]; z: number }[] = [];
      for (let i = 0; i <= n; i++) core.push({ z: zL + ((H - zL) * i) / n, r: turn(ellipse(32, a - ins, b - ins), ang[i] * sc) });
      k.loft(core, true);
      for (let i = 1; i <= n; i++) {
        const z = i === n ? H + 0.4 : zL + ((H - zL) * i) / n, r = turn(ellipse(32, a, b), ang[i] * sc);
        k.loft([{ r, z: z - 0.4 }, { r, z }], true, k.fam, k.WHITE);
      }
    },
  },
  {
    form: { key: "exo", name: "Exoskeleton", blurb: "A glass box inside a deep steel diagrid, diamonds four floors high", from: 2005, minFloors: 30, fams: ["glass", "silverglass", "blueglass"] },
    build(k) {
      // the structure taken outside the glass: a lattice of steel diagonals
      // standing proud of the facade, each diamond four floors high, ring
      // beams at every node — Foster's Hearst Tower (New York, 2006)
      const { A, B, H, fh } = k;
      const a = Math.min(A * 0.93, B * 1.45), b = B * 0.93, dep = Math.min(2.4, b * 0.12), e = 0.45;
      k.vol(rect(a - dep, b - dep), 0, H, true, true);
      const T = 4 * fh, nt = Math.max(3, Math.round(H / T)), Tz = H / nt;
      const fa = a - e, fb = b - e;
      const faces: [P2, P2][] = [[[-fa, -fb], [fa, -fb]], [[fa, -fb], [fa, fb]], [[fa, fb], [-fa, fb]], [[-fa, fb], [-fa, -fb]]];
      for (const [p0, p1] of faces) {
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), m = Math.max(2, Math.round(L / (Tz * 1.15)));
        const at = (s: number): P2 => [p0[0] + ((p1[0] - p0[0]) * s) / L, p0[1] + ((p1[1] - p0[1]) * s) / L];
        for (let kz = 0; kz < nt; kz++) {
          const z0 = kz * Tz, z1 = (kz + 1) * Tz, off = kz % 2 ? 0.5 : 0;
          for (let j = -1; j <= m; j++) {
            const s0 = ((j + off) * L) / m;
            for (const sgn of [-1, 1]) {
              const s1 = s0 + (sgn * L) / (2 * m);
              if (s0 < -0.01 || s0 > L + 0.01 || s1 < -0.01 || s1 > L + 0.01) continue;
              const q0 = at(s0), q1 = at(s1);
              member(k, q0[0], q0[1], z0, q1[0], q1[1], z1, e, k.STEEL);
            }
          }
          // the ring beam at the node line
          if (kz > 0) {
            const hu = Math.abs(p1[0] - p0[0]) / 2 + e, hv = Math.abs(p1[1] - p0[1]) / 2 + e, cu = (p0[0] + p1[0]) / 2, cv = (p0[1] + p1[1]) / 2;
            k.loft([{ r: rect(hu, hv, cu, cv), z: z0 - 0.4 }, { r: rect(hu, hv, cu, cv), z: z0 + 0.4 }], true, k.fam, k.STEEL);
          }
        }
      }
    },
  },
  {
    form: { key: "ribbonlink", name: "Ribbon link", blurb: "Two towers of different heights joined by a skybridge that climbs between them", from: 2011, minFloors: 35, long: 1.6, fams: ["silverglass", "glass", "blueglass"] },
    build(k) {
      // a tall tower and a shorter one, and between them a ribbon of sky
      // lobbies that climbs from the low roof to the tall one's flank — the
      // linked pair of the 2010s (Holl's Linked Hybrid strung its bridges
      // between towers of different heights)
      const { A, B, H, fh } = k;
      const dir = k.turnDir, U = (r: P2[]) => (dir > 0 ? r : flipU(r));
      const s = Math.min(A * 0.25, B * 0.9), sv = B * 0.88, u1 = -(A * 0.95 - s), u2 = A * 0.95 - s;
      const H2 = H * (0.6 + 0.1 * k.h(0x8b1));
      k.vol(U(chamfered(s, sv, s * 0.2).map(([u, v]) => [u + u1, v] as P2)), 0, H, true, true);
      k.vol(U(rect(s, sv, u2)), 0, H2, true, true);
      k.mast(H, H * 0.07, 0.5, dir * u1, 0);
      // the ribbon: a sheared prism rising from inside the low tower to the tall one's flank
      const rh = Math.max(5, fh * 2), us = u2 - s + 0.6, ue = u1 + s - 0.6;
      const zs = H2 - rh, ze = H * 0.84, bv = sv * 0.5;
      const secs: { r: P2[]; z: number }[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, e = t * 0.55 + 0.45 * t * t;
        const slope = (ze - zs) * (0.55 + 0.9 * t) / (us - ue);
        const wu = Math.min((us - ue) * 0.4, rh / Math.max(0.2, slope));
        const uc = lerp(us, ue, t);
        secs.push({ z: lerp(zs, ze, e), r: U(rect(wu / 2, bv, uc)) });
      }
      k.loft(secs, true);
    },
  },
];
