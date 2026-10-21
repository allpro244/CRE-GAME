// The region is generated in a canonical frame (river top to bottom, y down,
// sea at the bottom, metres 0..S) and played in the world frame (metres, x east,
// y north, origin at the window's centre), turned a multiple of 90 degrees per
// seed so the sea and the river face different ways while the survey stays
// cardinal.
import { makeRng } from "./util.mjs";

export function makeFrame(seed, S) {
  const k = Math.floor(makeRng("orient:" + seed)() * 4);
  const rot = (x, y, n) => { for (let i = 0; i < n; i++) [x, y] = [-y, x]; return [x, y]; };
  return {
    k,
    /** canonical point -> world point */
    toW: (p) => rot(p[0] - S / 2, S / 2 - p[1], k),
    /** world point -> canonical point */
    toC: (q) => { const [x, y] = rot(q[0], q[1], (4 - k) % 4); return [x + S / 2, S / 2 - y]; },
    /** canonical direction -> world direction */
    dirW: (v) => rot(v[0], -v[1], k),
  };
}
