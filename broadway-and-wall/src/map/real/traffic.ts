// TRAFFIC THAT DRIVES.
//
// The moving cars used to run a closed loop along one block face each: start
// at one corner, drive to the next at a constant speed, vanish, reappear at
// the first corner. They passed through each other, never stopped, never
// turned, and every one of them blinked out at every junction in town.
//
// Here they drive the street network the road markings are painted from
// (buildMarkings measures every centre line's carriageway on the ground). A
// car keeps to the right in its lane, follows the car ahead at a safe gap,
// stops at the stop line when the signal is against it, and at the junction
// turns — on a curve, from its lane into the next street's — or goes straight
// on. Narrow streets are one-way, as a city's side streets are; avenues run
// two lanes or more each way.
//
// Looks only. Nothing here reads or writes the game; the network is the
// ground the 3D city already drew.

type P2 = [number, number];

export interface NetRaw {
  segs: { a: P2; b: P2; w: number }[];
  geo: ({ L: number; u: P2; nr: P2; mid: P2; cw: number } | null)[];
  nodes: number[][];
}

interface Seg {
  a: P2; u: P2; nr: P2; L: number; half: number;
  /** node index at each end */
  na: number; nb: number;
  /** usable lane span: clear of the junction box at either end */
  s0: [number, number]; s1: [number, number];
  /** lane centre offsets right of travel, per direction (empty: no traffic that way) */
  lanes: [number[], number[]];
}
interface Node {
  P: P2;
  /** the segments meeting here */
  segs: number[];
  /** signalled: two phases on the node's two axes */
  sig: boolean;
  axis: P2;
  ph: number;
}

/** One car: where it is on the network, and where it is going next. */
export interface Car {
  seg: number;
  /** 0: a to b; 1: b to a */
  dir: 0 | 1;
  lane: number;
  /** distance along the travel direction from the entry end (m); below s0 it is still turning in */
  d: number;
  v: number;
  vmax: number;
  len: number;
  /** the turn into this lane: a quadratic from p0 through p1 to p2, of length tl */
  p0?: P2; p1?: P2; p2?: P2; tl?: number;
  next: number; nextDir: 0 | 1; nextLane: number;
  /** seconds held with nowhere to go (a gridlock breaker) */
  held: number;
  /** pose, written by step */
  x: number; y: number; h: number;
  /** braking: the tail lamps brighten (0-1) */
  brake: number;
  /** where it stood at the start of this step (what the cars behind it see) */
  sSeg?: number; sD?: number;
  /** a bus: pulls in at a stop half way down a long block and dwells */
  bus?: boolean; dwell?: number; servedSeg?: number;
  /** while in a junction box: the heading it came in on, and whether it goes straight on */
  inH?: number; straight?: boolean;
}

/** Someone on foot crossing at a zebra, in step with the junction's signal. */
export interface Crosser {
  a: P2; b: P2; ni: number;
  /** unit vector a to b, and the sideways spread from the zebra's middle */
  d: P2; lat: number;
  /** 0 at a, 1 at b; going toward b when to is 1 */
  s: number; to: 0 | 1; walking: boolean;
  spd: number; len: number;
  x: number; y: number; h: number;
}

const SIG_T = 22;      // seconds of green per axis
const AMBER = 3;       // all-red clearance at each change
const GAP = 2.2;       // standstill bumper gap (m)
const HEADWAY = 1.1;   // seconds of following time
const ACC = 2.2;       // m/s²
const DEC = 4.5;       // comfortable braking, m/s²

export class Traffic {
  segs: Seg[] = [];
  nodes: Node[] = [];
  cars: Car[] = [];
  crossers: Crosser[] = [];
  private t = 0;

  constructor(raw: NetRaw, onRoad: (x: number, y: number) => boolean, rnd: () => number) {
    const key = (p: P2) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
    // the nodes, by the same rounded corner key buildMarkings used
    const nodeOf = new Map<string, number>();
    const nodeAt = (p: P2) => {
      const k = key(p);
      let i = nodeOf.get(k);
      if (i === undefined) { i = this.nodes.length; nodeOf.set(k, i); this.nodes.push({ P: p, segs: [], sig: false, axis: [1, 0], ph: 0 }); }
      return i;
    };
    raw.segs.forEach((sg, i) => {
      const g = raw.geo[i];
      if (!g || g.cw < 5 || g.cw > 44) return;
      const half = g.cw / 2;
      const a = g.mid;
      // the lane must be road at its middle, or this is not a street we drive
      if (!onRoad(a[0] + g.u[0] * g.L / 2, a[1] + g.u[1] * g.L / 2)) return;
      const na = nodeAt(sg.a), nb = nodeAt(sg.b);
      if (na === nb) return;
      // lanes, right of travel. A narrow street runs one way down its middle;
      // a working street one lane each way outside the centre line, clear of
      // the parked row; an avenue as many 3.3 m lanes as fit inside the
      // 2.4 m parking lane, as the paint has them.
      let both: number[];
      let oneWay = false;
      if (half < 4.6) { both = [0]; oneWay = true; }
      else if (g.cw < 15) both = [Math.max(1.3, Math.min(half - 3.4, 2.2))];
      else {
        const n = Math.max(1, Math.min(3, Math.floor((half - 2.4) / 3.3)));
        both = Array.from({ length: n }, (_, k) => 1.65 + 3.3 * k);
      }
      // one-way streets alternate, so a grid of them still circulates
      const way = oneWay ? (this.segs.length % 2) : -1;
      this.segs.push({
        a, u: g.u, nr: g.nr, L: g.L, half, na, nb,
        s0: [0, 0], s1: [g.L, g.L],
        lanes: [way === 1 ? [] : both, way === 0 ? [] : both],
      });
      const si = this.segs.length - 1;
      this.nodes[na].segs.push(si); this.nodes[nb].segs.push(si);
    });
    // the junction boxes: a car stops this far back from the node, behind the
    // crossing street's kerb and its zebra
    const dirAt = (si: number, ni: number): P2 => {
      const s = this.segs[si];
      return s.na === ni ? s.u : [-s.u[0], -s.u[1]];
    };
    this.nodes.forEach((nd, ni) => {
      const deg = nd.segs.length;
      if (deg >= 3) {
        nd.sig = true;
        nd.axis = dirAt(nd.segs[0], ni);
        nd.ph = rnd() * SIG_T * 2;
      }
      for (const si of nd.segs) {
        const s = this.segs[si], u = dirAt(si, ni);
        let clr = deg === 1 ? 2.5 : 0;
        if (deg >= 2) for (const o of nd.segs) {
          if (o === si) continue;
          const v = dirAt(o, ni);
          if (Math.abs(u[0] * v[0] + u[1] * v[1]) > 0.94) continue;   // straight on: no box
          clr = Math.max(clr, Math.min(this.segs[o].half, 14) + 3.2);
        }
        clr = Math.min(clr, s.L * 0.4);
        // entering from this end (s0) and leaving at it (s1), per direction
        if (s.na === ni) { s.s0[0] = clr; s.s1[1] = s.L - clr; }
        else { s.s1[0] = s.L - clr; s.s0[1] = clr; }
      }
    });
    // drop lanes too short to hold a car
    for (const s of this.segs) for (const dr of [0, 1] as const) if (s.s1[dr] - s.s0[dr] < 6) s.lanes[dr] = [];
  }

  /** The lane's point at distance d along travel, offset right by off. */
  private lanePt(si: number, dir: 0 | 1, d: number, off: number): P2 {
    const s = this.segs[si];
    const along = dir === 0 ? d : s.L - d;
    const sgn = dir === 0 ? 1 : -1;
    return [s.a[0] + s.u[0] * along + s.nr[0] * off * sgn, s.a[1] + s.u[1] * along + s.nr[1] * off * sgn];
  }
  private heading(si: number, dir: 0 | 1): number {
    const s = this.segs[si];
    return Math.atan2(dir === 0 ? s.u[1] : -s.u[1], dir === 0 ? s.u[0] : -s.u[0]);
  }
  /** the node a car on (si, dir) drives toward */
  private endNode(si: number, dir: 0 | 1) { const s = this.segs[si]; return dir === 0 ? s.nb : s.na; }

  /** Lay cars into every lane, about one per `spacing` metres, evenly so none overlap. */
  populate(spacing: number, rnd: () => number, make: (c: Car) => void) {
    this.segs.forEach((s, si) => {
      for (const dir of [0, 1] as const) {
        s.lanes[dir].forEach((off) => {
          // laid out back from the stop line, so nobody starts inside a junction
          const span = s.s1[dir] - s.s0[dir] - 10;
          if (span < 6) return;
          const n = Math.floor(span / spacing + rnd());
          for (let k = 0; k < n; k++) {
            const d = s.s0[dir] + ((k + 0.5) / n) * span + (rnd() - 0.5) * 2;
            const c: Car = {
              seg: si, dir, lane: off, d, v: 0, vmax: 0, len: 4.8,
              next: -1, nextDir: 0, nextLane: 0, held: 0,
              x: 0, y: 0, h: 0, brake: 0,
            };
            make(c);
            c.v = 0;
            this.chooseNext(c, rnd);
            this.pose(c);
            this.cars.push(c);
          }
        });
      }
    });
  }

  /** Where this car turns at the end of its block. Straight on more often than not. */
  /** how full each lane was at the last step (cars x length / lane span), for route choice */
  private occ = new Map<string, number>();
  private chooseNext(c: Car, rnd: () => number = Math.random) {
    const ni = this.endNode(c.seg, c.dir);
    const nd = this.nodes[ni];
    const inH = this.heading(c.seg, c.dir);
    const opts: { si: number; dir: 0 | 1; w: number }[] = [];
    for (const si of nd.segs) {
      if (si === c.seg) continue;
      const s = this.segs[si];
      const dir: 0 | 1 = s.na === ni ? 0 : 1;
      if (!s.lanes[dir].length) continue;
      let dh = this.heading(si, dir) - inH;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const straight = Math.abs(dh) < 0.5;
      // right turns (negative, with y north) a touch likelier than lefts
      // a driver sees a queue down the street and goes another way
      const full = this.occ.get(`${si}:${dir}:${s.lanes[dir][0]}`) ?? 0;
      opts.push({ si, dir, w: (straight ? 3 : dh < 0 ? 1.2 : 0.9) * Math.max(0.03, 1 - full * 1.4) });
    }
    if (!opts.length) {
      // the end of the road: turn round, if the street runs back
      const s = this.segs[c.seg];
      const back: 0 | 1 = c.dir === 0 ? 1 : 0;
      if (s.lanes[back].length) opts.push({ si: c.seg, dir: back, w: 1 });
    }
    if (!opts.length) { c.next = -1; return; }
    let r = rnd() * opts.reduce((a, o) => a + o.w, 0);
    let pick = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    c.next = pick.si; c.nextDir = pick.dir;
    const ln = this.segs[pick.si].lanes[pick.dir];
    // keep the same lane index where the next street has one, else the nearest
    const li = this.segs[c.seg].lanes[c.dir].indexOf(c.lane);
    c.nextLane = ln[Math.min(Math.max(0, li), ln.length - 1)];
  }

  /** Move the car onto its next street, turning in on a curve. */
  private enterNext(c: Car, over: number) {
    const s = this.segs[c.seg];
    const p0 = this.lanePt(c.seg, c.dir, s.s1[c.dir], c.lane);
    const h0 = this.heading(c.seg, c.dir);
    const ns = this.segs[c.next];
    const p2 = this.lanePt(c.next, c.nextDir, ns.s0[c.nextDir], c.nextLane);
    const h2 = this.heading(c.next, c.nextDir);
    // the control point: where the two lane lines cross, if they do sensibly
    const d0: P2 = [Math.cos(h0), Math.sin(h0)], d2: P2 = [Math.cos(h2), Math.sin(h2)];
    const den = d0[0] * d2[1] - d0[1] * d2[0];
    let p1: P2 = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    const chord = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
    if (Math.abs(den) > 0.2) {
      const t = ((p2[0] - p0[0]) * d2[1] - (p2[1] - p0[1]) * d2[0]) / den;
      if (t > 0 && t < chord * 1.5) p1 = [p0[0] + d0[0] * t, p0[1] + d0[1] * t];
    } else if (d0[0] * d2[0] + d0[1] * d2[1] < 0) {
      // a U-turn: swing out past the node
      const nd = this.nodes[this.endNode(c.seg, c.dir)].P;
      p1 = [nd[0] + d0[0] * 4, nd[1] + d0[1] * 4];
    }
    const tl = Math.max(1, (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + chord) / 2);
    let dh = h2 - h0;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    c.inH = h0; c.straight = Math.abs(dh) < 0.5;
    c.seg = c.next; c.dir = c.nextDir; c.lane = c.nextLane;
    c.p0 = p0; c.p1 = p1; c.p2 = p2; c.tl = tl;
    c.d = ns.s0[c.dir] - tl + over;
    this.chooseNext(c);
  }

  private pose(c: Car) {
    const s = this.segs[c.seg];
    const s0 = s.s0[c.dir];
    if (c.d < s0 && c.p0 && c.tl) {
      const t = Math.max(0, Math.min(1, 1 - (s0 - c.d) / c.tl)), u = 1 - t;
      const p0 = c.p0, p1 = c.p1!, p2 = c.p2!;
      c.x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
      c.y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
      const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
      const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
      if (dx * dx + dy * dy > 1e-6) c.h = Math.atan2(dy, dx);
      return;
    }
    const p = this.lanePt(c.seg, c.dir, c.d, c.lane);
    c.x = p[0]; c.y = p[1]; c.h = this.heading(c.seg, c.dir);
  }

  /** Is the way through this node open to a car coming in on (si, dir)? */
  private green(ni: number, si: number, dir: 0 | 1): boolean {
    const s = this.segs[si];
    return this.greenAlong(ni, dir === 0 ? s.u : [-s.u[0], -s.u[1]]);
  }

  /** May traffic (or a pedestrian) moving along unit vector u go through node ni now, with at least `need` seconds of the phase left? */
  private greenAlong(ni: number, u: P2, need = 0): boolean {
    const nd = this.nodes[ni];
    if (!nd.sig) return true;
    const ax = Math.abs(u[0] * nd.axis[0] + u[1] * nd.axis[1]) > 0.6 ? 0 : 1;
    const c = (this.t + nd.ph) % (SIG_T * 2);
    const inPhase = c - ax * SIG_T;
    return inPhase >= 0 && inPhase < SIG_T - AMBER - need;
  }

  /**
   * A zebra from a to b, crossed by n people. It belongs to the nearest
   * signalled junction within 30 m; walkers go when the traffic running the
   * same way as the crossing has its green (so the street they cross is
   * stopped), and only if there is time to get over.
   */
  addCrossing(a: P2, b: P2, n: number, rnd: () => number) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 3 || n <= 0) return;
    const m: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let ni = -1, best = 30;
    this.nodes.forEach((nd, i) => {
      if (!nd.sig) return;
      const dd = Math.hypot(nd.P[0] - m[0], nd.P[1] - m[1]);
      if (dd < best) { best = dd; ni = i; }
    });
    if (ni < 0) return;
    const d: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    for (let k = 0; k < n; k++) {
      const to: 0 | 1 = rnd() < 0.5 ? 0 : 1;
      const c: Crosser = { a, b, ni, d, lat: (rnd() - 0.5) * 2.2, s: to === 1 ? 0 : 1, to, walking: false, spd: 1.2 + rnd() * 0.4, len: L, x: 0, y: 0, h: 0 };
      this.posePed(c);
      this.crossers.push(c);
    }
  }
  private posePed(c: Crosser) {
    // waiting, they stand back on the kerb; walking, on the zebra
    const back = c.walking ? 0 : 0.9;
    const s = c.s;
    const along = -back + s * (c.len + 2 * back);
    const px = -c.d[1], py = c.d[0];
    c.x = c.a[0] + c.d[0] * along + px * c.lat;
    c.y = c.a[1] + c.d[1] * along + py * c.lat;
    c.h = Math.atan2(c.d[1], c.d[0]) + (c.to === 1 ? 0 : Math.PI);
  }
  private stepCrossers(dt: number) {
    for (const c of this.crossers) {
      if (!c.walking) {
        const dir: P2 = c.to === 1 ? c.d : [-c.d[0], -c.d[1]];
        if (this.greenAlong(c.ni, dir, c.len / c.spd * 0.6)) c.walking = true;
        else { this.posePed(c); continue; }
      }
      c.s += ((c.to === 1 ? 1 : -1) * c.spd * dt) / c.len;
      if (c.s >= 1 || c.s <= 0) {
        // over: wait on this side for the next green back
        c.s = c.s >= 1 ? 1 : 0;
        c.to = c.s >= 1 ? 0 : 1;
        c.walking = false;
      }
      this.posePed(c);
    }
  }

  /**
   * Advance every live car by dt seconds. `live(c)` says whether the car is
   * on the street at all (the crowd thins with the hour and the economy); a
   * car that is not neither moves nor blocks.
   */
  step(dt: number, live: (c: Car) => boolean) {
    if (dt <= 0) return;
    this.t += dt;
    this.stepCrossers(dt);
    // junctions with someone on a crossing: turning traffic waits for them
    const onFoot = new Set<number>();
    for (const c of this.crossers) if (c.walking && c.s > 0.02 && c.s < 0.98) onFoot.add(c.ni);
    // who is in each junction box now, and on what heading they came in
    const inBox = new Map<number, Car[]>();
    for (const c of this.cars) {
      if (!live(c) || c.inH === undefined || c.d >= this.segs[c.seg].s0[c.dir]) continue;
      const s = this.segs[c.seg], ni = c.dir === 0 ? s.na : s.nb;
      const l = inBox.get(ni);
      if (l) l.push(c); else inBox.set(ni, [c]);
    }
    // every lane's cars, front first
    const lanes = new Map<string, Car[]>();
    const lk = (si: number, dir: number, off: number) => `${si}:${dir}:${off}`;
    for (const c of this.cars) {
      if (!live(c)) continue;
      const k = lk(c.seg, c.dir, c.lane);
      const l = lanes.get(k);
      if (l) l.push(c); else lanes.set(k, [c]);
    }
    this.occ.clear();
    for (const [k, l] of lanes) {
      const c0 = l[0], sg = this.segs[c0.seg];
      let used = 0;
      for (const c of l) used += c.len + GAP;
      this.occ.set(k, used / Math.max(6, sg.s1[c0.dir] - sg.s0[c0.dir]));
      l.sort((p, q) => q.d - p.d);
      for (const c of l) { c.sSeg = c.seg; c.sD = c.d; }
    }
    // a car ahead as it stood when the step began (it may have moved on since)
    const was = (o: Car, si: number) => (o.sSeg === si ? o.sD! : Infinity);
    for (const l of lanes.values()) {
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        const s = this.segs[c.seg];
        const s1 = s.s1[c.dir];
        // the free road ahead: the car in front, or past the junction the
        // last car in the lane we are turning into
        let gap = Infinity;
        if (i > 0) gap = was(l[i - 1], c.seg) - l[i - 1].len - c.d;
        else if (c.next >= 0) {
          const nl = lanes.get(lk(c.next, c.nextDir, c.nextLane));
          if (nl && nl.length) {
            const last = nl[nl.length - 1];
            const ns = this.segs[c.next];
            // the turn is about as long as the box is wide
            const box = Math.max(4, s.L - s1 + ns.s0[c.nextDir]);
            gap = (s1 - c.d) + box + (was(last, c.next) - ns.s0[c.nextDir]) - last.len;
          }
        }
        // the stop line, when the light is against us and we can still stop
        let stopAt = Infinity;
        const ni = this.endNode(c.seg, c.dir);
        if (c.d <= s1 && !this.green(ni, c.seg, c.dir)) {
          const toLine = s1 - c.d;
          if (toLine > (c.v * c.v) / (2 * DEC * 1.6) - 0.5) stopAt = toLine;
        }
        if (c.next < 0) stopAt = Math.min(stopAt, s1 - c.d + 1.5);
        // THE BUS STOP, half way down a block of 70 m or more: stop, let
        // people on and off for ten seconds, go on (the cars behind wait)
        if (c.bus && c.servedSeg !== c.seg && s1 - s.s0[c.dir] >= 70) {
          const at = (s.s0[c.dir] + s1) / 2;
          if (c.d <= at) stopAt = Math.min(stopAt, at - c.d);
          if (c.d >= at - 0.6 && c.v < 0.2) {
            c.dwell = (c.dwell ?? 0) + dt;
            if (c.dwell > 10) { c.servedSeg = c.seg; c.dwell = 0; }
          }
        }
        // THE BOX. Into a junction only when nothing on a crossing path is in
        // it: traffic off the same approach follows on, and two streams going
        // straight through from opposite sides pass each other; anything else
        // (a left turn across the oncoming stream, the cross street clearing
        // on the amber) waits at the line for its gap
        if (c.next >= 0 && c.d <= s1 && s1 - c.d < 6 + c.v) {
          // DON'T BLOCK THE BOX: room for the whole car past the junction first
          const nl = lanes.get(lk(c.next, c.nextDir, c.nextLane));
          const ns = this.segs[c.next];
          const last = nl && nl.length ? nl[nl.length - 1] : null;
          const room = last ? was(last, c.next) - last.len - ns.s0[c.nextDir] : Infinity;
          const toLine0 = s1 - c.d;
          if (room < c.len + GAP + 1 && toLine0 > (c.v * c.v) / (2 * DEC * 1.6) - 0.5) stopAt = Math.min(stopAt, toLine0);
          const occ = inBox.get(ni);
          if (occ && occ.length) {
            const hIn = this.heading(c.seg, c.dir);
            let dh = this.heading(c.next, c.nextDir) - hIn;
            while (dh > Math.PI) dh -= 2 * Math.PI;
            while (dh < -Math.PI) dh += 2 * Math.PI;
            const meStraight = Math.abs(dh) < 0.5;
            const clash = occ.some((o) => {
              const k = Math.cos(o.inH! - hIn);
              if (k > 0.95) return false;                              // same approach
              if (k < -0.95 && meStraight && o.straight) return false;   // opposite, both straight on
              return true;
            });
            const toLine = s1 - c.d;
            if (clash && toLine > (c.v * c.v) / (2 * DEC * 1.6) - 0.5) stopAt = Math.min(stopAt, toLine);
          }
        }
        // a turn across a crossing in use: hold at the line until it clears
        if (c.d <= s1 && c.next >= 0 && onFoot.has(ni)) {
          let dh = this.heading(c.next, c.nextDir) - this.heading(c.seg, c.dir);
          while (dh > Math.PI) dh -= 2 * Math.PI;
          while (dh < -Math.PI) dh += 2 * Math.PI;
          const toLine = s1 - c.d;
          if (Math.abs(dh) > 0.5 && toLine > (c.v * c.v) / (2 * DEC * 1.6) - 0.5) stopAt = Math.min(stopAt, toLine);
        }
        const free = Math.min(gap - GAP - c.v * HEADWAY, stopAt - 0.3);
        // the speed at which we could still stop in the room we have
        const vSafe = free <= 0 ? 0 : Math.sqrt(2 * DEC * free);
        // ease off for a turn
        let vCap = c.vmax;
        if (c.d < s.s0[c.dir]) vCap = Math.min(vCap, c.p1 && c.p0 && c.p2 && turnSharp(c.p0, c.p1, c.p2) ? 5 : c.vmax);
        const vT = Math.min(vCap, vSafe);
        const dv = vT - c.v;
        const prev = c.v;
        c.v = Math.max(0, c.v + Math.max(-DEC * 2 * dt, Math.min(ACC * dt, dv)));
        c.brake += ((c.v < prev - 0.01 || c.v < 0.3 ? 1 : 0) - c.brake) * Math.min(1, dt * 6);
        // gridlock breaker: a car held a long while with nothing red in front
        // of it creeps on
        if (c.v < 0.05 && stopAt === Infinity) {
          c.held += dt;
          // at the front of the queue and the street ahead is full: go another way
          if (i === 0 && c.held > 4 && c.held - dt <= 4) this.chooseNext(c);
          if (c.held > 20) c.v = 2;
        }
        else c.held = 0;
        c.d += c.v * dt;
        if (c.d > s1) {
          if (c.next < 0) { c.d = s1; c.v = 0; }
          else this.enterNext(c, c.d - s1);
        }
        this.pose(c);
      }
    }
  }
}

/** Whether a turn's control polygon bends more than ~25° (a real turn, not a kink). */
function turnSharp(p0: P2, p1: P2, p2: P2): boolean {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-3 || lb < 1e-3) return false;
  return (ax * bx + ay * by) / (la * lb) < 0.9;
}
