// THE PLAN SHAPES landmark towers are drawn from, in a local frame: u along
// the footprint's long side, v across. Shared by signature.ts, its later
// forms (signature-more-*.ts) and RealCity.signatureTower. No three.js.

export type P2 = [number, number];

// ---- plans, in a local frame: u along the footprint's long side, v across ----

/** An ellipse of n points, counter-clockwise. */
export function ellipse(n: number, a: number, b: number, rot = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) { const t = rot + (i / n) * Math.PI * 2; out.push([Math.cos(t) * a, Math.sin(t) * b]); }
  return out;
}

/** An axis-aligned rectangle of half-extents a, b centred on (u, v), counter-clockwise. */
export function rect(a: number, b: number, u = 0, v = 0): P2[] {
  return [[u - a, v - b], [u + a, v - b], [u + a, v + b], [u - a, v + b]];
}

/** A square with its corners cut at 45° by c (an octagon), counter-clockwise. */
export function chamfered(a: number, b: number, c: number): P2[] {
  c = Math.min(c, a * 0.9, b * 0.9);
  return [[-a + c, -b], [a - c, -b], [a, -b + c], [a, b - c], [a - c, b], [-a + c, b], [-a, b - c], [-a, -b + c]];
}

/**
 * The eight-pointed star of two squares turned 45° on each other, with the
 * notches filled by arcs — the plan of the 1990s twin towers of the east.
 * 32 points; r is the outer radius.
 */
export function star8(r: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    // points at every 45°, a shallow arc between them
    const ph = ((t / (Math.PI / 4)) % 1 + 1) % 1;
    const k = i % 4 === 0 ? 1 : 0.86 + 0.06 * Math.cos((ph - 0.5) * Math.PI * 2);
    out.push([Math.cos(t) * r * k, Math.sin(t) * r * k]);
  }
  return out;
}

/** A rounded triangle (three lobes), radius r at the lobes, n points. */
export function roundTri(n: number, r: number, rot = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 0.84 + 0.16 * Math.cos(3 * t);
    out.push([Math.cos(t + rot) * r * k, Math.sin(t + rot) * r * k]);
  }
  return out;
}

/**
 * THE Y PLAN. Three wings of half-width w at 120° round a core, each wing
 * reaching its own length: the plan the buttressed-core supertall is built
 * on, because a Y braces itself against the wind from every side. Nine
 * points, counter-clockwise; each wing must reach past the core's notch.
 */
export function yPlan(w: number, len: [number, number, number], rot = Math.PI / 2): P2[] {
  const out: P2[] = [];
  const notch = w / Math.sin(Math.PI / 3);
  for (let j = 0; j < 3; j++) {
    const t = rot + (j * 2 * Math.PI) / 3;
    const dx = Math.cos(t), dy = Math.sin(t), px = -dy, py = dx;
    const nt = t - Math.PI / 3;
    out.push([Math.cos(nt) * notch, Math.sin(nt) * notch]);
    const L = Math.max(len[j], notch + w * 0.6);
    out.push([dx * L - px * w, dy * L - py * w]);
    out.push([dx * L + px * w, dy * L + py * w]);
  }
  return out;
}

/** Turn and scale a local plan about its origin. */
export function turn(r: P2[], a: number, s = 1, du = 0, dv = 0): P2[] {
  const c = Math.cos(a), si = Math.sin(a);
  return r.map(([u, v]) => [du + (u * c - v * si) * s, dv + (u * si + v * c) * s] as P2);
}
