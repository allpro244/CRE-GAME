// Shared planar geometry helpers for the data pipeline.
// All polygon work happens in a local meter projection (equirectangular
// around the district centroid) — accurate to well under a meter at CD1 scale.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = 6378137;
export function makeProjection(lon0, lat0) {
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
  const ky = (Math.PI / 180) * R;
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLL: ([x, y]) => [lon0 + x / kx, lat0 + y / ky],
  };
}

export function ringArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function polygonArea(poly) {
  // poly: array of rings, first outer, rest holes
  let a = Math.abs(ringArea(poly[0]));
  for (let i = 1; i < poly.length; i++) a -= Math.abs(ringArea(poly[i]));
  return a;
}

export function centroid(ring) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f; cy += (y1 + y2) * f; a += f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function bboxOfRing(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// Clip a simple polygon ring against the half-plane (dot(p,n) <= d).
// Sutherland–Hodgman; adequate for pipeline use on tax-lot-shaped rings.
export function clipRingHalfPlane(ring, nx, ny, d) {
  const out = [];
  const inside = ([x, y]) => x * nx + y * ny <= d;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const da = a[0] * nx + a[1] * ny - d;
      const db = b[0] * nx + b[1] * ny - d;
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? out : null;
}

// Split a ring by the line through point p with direction (dx,dy).
// Returns [left, right] rings (either may be null).
export function splitRing(ring, p, dx, dy) {
  // normal to the cut line
  const nx = -dy, ny = dx;
  const d = p[0] * nx + p[1] * ny;
  return [clipRingHalfPlane(ring, nx, ny, d), clipRingHalfPlane(ring, -nx, -ny, -d)];
}

// Inset a convex-ish ring toward its centroid by `m` meters (approximate).
export function insetRing(ring, m) {
  const c = centroid(ring);
  const out = ring.map(([x, y]) => {
    const vx = x - c[0], vy = y - c[1];
    const len = Math.hypot(vx, vy) || 1;
    const k = Math.max(0, 1 - m / len);
    return [c[0] + vx * k, c[1] + vy * k];
  });
  return polygonArea([out]) > 1 ? out : null;
}

// Minimum distance between two segments.
function segSegDist(p1, p2, q1, q2) {
  const d1 = ptSegDist(p1, q1, q2), d2 = ptSegDist(p2, q1, q2);
  const d3 = ptSegDist(q1, p1, p2), d4 = ptSegDist(q2, p1, p2);
  return Math.min(d1, d2, d3, d4);
}
function ptSegDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Length of the shared frontage between two rings within `tol` meters —
// the buffer-and-intersect adjacency test, done directly on the boundary.
export function sharedBoundaryLength(ringA, ringB, tol) {
  let shared = 0;
  for (let i = 0; i < ringA.length; i++) {
    const a1 = ringA[i], a2 = ringA[(i + 1) % ringA.length];
    const segLen = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]);
    if (segLen < 1e-6) continue;
    // sample the segment; a sample point counts if within tol of B's boundary
    const steps = Math.max(2, Math.ceil(segLen / 2));
    let hit = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = [a1[0] + (a2[0] - a1[0]) * t, a1[1] + (a2[1] - a1[1]) * t];
      let dmin = Infinity;
      for (let j = 0; j < ringB.length; j++) {
        const d = ptSegDist(p, ringB[j], ringB[(j + 1) % ringB.length]);
        if (d < dmin) dmin = d;
        if (dmin <= tol) break;
      }
      if (dmin <= tol) hit++;
    }
    shared += segLen * (hit / (steps + 1));
  }
  return shared;
}

export { segSegDist, ptSegDist };
