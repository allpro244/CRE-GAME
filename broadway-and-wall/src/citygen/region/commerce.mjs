// THE TOWN'S COMMERCE: WHERE A REAL TOWN PUTS ITS SHOPS AND ITS SHEDS.
//
// Owner: "retail and industrial placed the way a real town works." The ICSC
// shopping-centre hierarchy and the industrial land of a Midwest county seat,
// each kind where it locates in life, sized from the trade area it serves:
//
//   RETAIL
//   1  downtown main street            — the island generator's (town.mjs), untouched
//   2  neighbourhood centres, 30-125k sf, grocery-anchored, at arterial corners
//      just past downtown and through the inner ring; one per ~3-5k households
//      within 1-1.5 mi, so spaced ~2 km apart; mostly 1960s-90s
//   3  strip / convenience centres under 30k sf and gas stations, at arterial
//      corners through the inner ring and along the main roads out
//   4  community centres, 125-400k sf, on major arterials at the town's edge
//   5  at most one power centre, 250-600k sf of big boxes, at the best
//      interchange, with pads (fast food, a bank, gas)
//   6  no regional mall: one needs a trade area of ~150k+ (ICSC). A county near
//      the top of 35-60k may keep a small 1970s enclosed mall; otherwise none
//   7  a general store and gas at one or two far crossroads
//   INDUSTRIAL
//   1  the mill and rail district by the river near downtown — the island
//      generator's (town.mjs "The Mill District"), untouched
//   2  light industrial and flex: 10-40k sf on 1-5 acre lots along the
//      arterials at the town's edge
//   3  one planned industrial park at an interchange, 80-200 acres, an
//      internal loop road, platted into 2-20 acre lots, about half built
//      (warehouses, light manufacturing, a distribution centre or two of
//      150-500k sf with truck courts), the rest vacant lots for sale
//   4  a truck stop at an interchange
//
// THE NUMBERS. Trade area: the town is the county seat; the county is 35-60k
// people [K, a drawn non-metro Midwest county], 2.5 per household [S, Census],
// about half of them in and around the town [K]. Parking: 4.5 spaces per 1,000
// sf of retail [S, ICSC / ULI "Parking Requirements for Shopping Centers",
// 4-5], one per 1,000 sf of industrial [S, typical code], 32.5 m2 a space with
// its aisle share [S, ~350 sf]. Retail sites run FAR 0.2-0.3 and industrial
// 0.3-0.45 [S, typical suburban site coverage]. Nothing goes on the floodplain
// (okPt reads M.free, which excludes it).
import { add, sub, mul, dist, norm, perp, dot, resample, rectRing, crossings, ACRE, pointAt, cumLen, hull, ringAreaAbs } from "./util.mjs";

const FT2 = 0.09290304;     // m2 per sf
const SPACE_M2 = 32.5;      // a parking space with its share of the aisles
const RETAIL_RATIO = 4.5;   // spaces per 1,000 sf GLA
const IND_RATIO = 1.0;      // spaces per 1,000 sf of industrial

export function placeCommerce(M, lots, { okPt, stampRect, rng }) {
  const G = M.G, R = (a, b) => rng.range(a, b), I = (a, b) => rng.int(a, b);
  const county = Math.round(R(35000, 60000)), households = county / 2.5, townHh = households * 0.5;
  const placed = [], roads = [];
  M.commerce = { county, townHh: Math.round(townHh), placed, roads, debug: {} };
  const edgeD = G.bfs((k) => !!M.townMask[k]);
  const edge = (p) => { const k = G.idx(p); return k < 0 ? Infinity : edgeD[k]; };

  // ---- where things can go: arterial intersections, arterial frontage, interchanges
  const arts = M.oldRoads.map((pl) => ({ pl, old: true })).concat(M.secRoads.map((pl) => ({ pl, old: false })));
  const dirAt = (pl, s) => { const L = cumLen(pl).at(-1); return norm(sub(pointAt(pl, Math.min(L, s + 10)), pointAt(pl, Math.max(0, s - 10)))); };
  const corners = [];
  for (let i = 0; i < arts.length; i++) for (let j = i + 1; j < arts.length; j++) {
    for (const x of crossings(arts[i].pl, arts[j].pl)) corners.push({ p: x.p, u: dirAt(arts[i].pl, x.s), old: arts[i].old || arts[j].old, both: arts[i].old && arts[j].old });
  }
  const front = [];
  for (const a of arts) { const r = resample(a.pl, 120); for (let i = 1; i < r.length - 1; i++) front.push({ p: r[i], u: norm(sub(r[i + 1], r[i - 1])), old: a.old }); }
  const ixs = M.interchanges.map((x) => {
    // the arterial the interchange serves: the frontage sample nearest it
    let best = null; for (const f of front) { const d = dist(f.p, x.p); if (d < 400 && (!best || d < best.d)) best = { d, u: f.u }; }
    return best ? { p: x.p, u: best.u, d: dist(x.p, M.centre) } : null;
  }).filter(Boolean).sort((a, b) => a.d - b.d);
  M.commerce.debug = { interchanges: M.interchanges.length, ixs: ixs.length, corners: corners.length, nearCorners: corners.filter((q) => edge(q.p) < 600).length };

  // ---- putting one site down: pieces in the site's frame (a along the road, o back from its right-of-way)
  const fits = (rs) => rs.every((r) => {
    const ring = rectRing(r.c, r.u, r.w, r.d);
    return ring.concat([r.c], ring.map((q, i) => mul(add(q, ring[(i + 1) % 4]), 0.5))).every(okPt);
  });
  const near = (p, type, d) => placed.some((s) => s.type === type && dist(s.at, p) < d);
  const anyNear = (p, d) => placed.some((s) => dist(s.at, p) < d);
  /** Try the site on both sides of the road and, at a corner, both ways along it. Returns true if placed. */
  function put(anchor, u, parcels, meta, slide = [0]) {
    for (const sl of slide) for (const sd of [1, -1]) {
      const v = mul(perp(u), sd), at = add(anchor, mul(u, sl));
      const placeP = (pc) => ({ ...pc, u, v, c: add(add(at, mul(u, pc.a)), mul(v, 14 + pc.o + pc.d / 2)) });
      const ps = parcels.map((p) => ({ ...p, rects: p.rects.map(placeP) }));
      if (!fits(ps.flatMap((p) => p.rects))) continue;
      for (const p of ps) for (const r of p.rects) { G.disk(M.taken, r.c, Math.max(r.w, r.d) / 2 + 10); stampRect(M.lotL, rectRing(r.c, u, r.w, r.d)); }
      const sf = ps.reduce((t, p) => t + (p.sf ?? 0), 0);
      for (const p of ps) lots.push({ kind: meta.type, named: true, name: p.name, cls: p.cls, bldgclass: p.bldgclass, zone: meta.type === "industrial park" || p.cls === "industrial" ? "M1" : "C-2", year: p.year, anchor: p.rects[0].c, u, rects: p.rects, gap: 0 });
      const lotM2 = ps.reduce((t, p) => t + ringAreaAbs(hull(p.rects.flatMap((r) => rectRing(r.c, u, r.w, r.d)))), 0);
      placed.push({ type: meta.type, at, sf: Math.round(sf), lotSf: Math.round(lotM2 / FT2), parcels: ps.length, name: meta.name ?? ps[0].name });
      if (meta.roads) for (const rd of meta.roads(placeP)) roads.push(rd);
      return true;
    }
    return false;
  }
  const NAMES = ["Crossroads", "Prairie", "Heartland", "Meadowbrook", "Gateway", "Riverside", "Countryside", "Westgate", "Eastgate", "Northpoint", "Southfield", "Oak Hill", "Willow Creek", "Town & Country", "Parkview", "Hillcrest"];
  const used = new Set();
  const nameOf = (suffix) => { const free = NAMES.filter((n) => !used.has(n)); const n = free[Math.floor(rng() * free.length)] ?? `Route ${I(10, 99)}`; used.add(n); return `${n} ${suffix}`; };

  // ---- a retail site: the building row at the back, the car park in front, pads on the road
  function retail({ boxes = [], roles = [], inline = 0, pads = [], year, name, bldgclass = "K6" }) {
    // role: what the renderer draws (unreal RetailBuilder): a grocery, a big box, a department store, the inline shops
    const row = boxes.map((sf, i) => { const m2 = sf * FT2, d = Math.min(115, Math.max(45, Math.sqrt(m2 * 0.9))); return { w: m2 / d, d, z: Math.round(R(820, 920)), sf, role: roles[i] ?? "box" }; });
    if (inline > 0) row.push({ w: (inline * FT2) / 24, d: 24, z: Math.round(R(620, 720)), sf: inline, role: "inline" });
    const gap = 5, rowLen = row.reduce((t, b) => t + b.w, 0) + gap * (row.length - 1), W = rowLen + 40;
    const gla = row.reduce((t, b) => t + b.sf, 0);
    const Dp = ((gla / 1000) * RETAIL_RATIO * SPACE_M2) / W;
    const P = pads.length ? 60 : 10, Db = Math.max(...row.map((b) => b.d));
    // THE FIELD RUNS TO THE STOREFRONT (owner, after the Unreal render): the car park faces the access road
    // and ends at a ~3 m sidewalk on the stores' common front line (its fire lane is the apron's store-side
    // aisle); landscaping only at the road edge and the sides; service and loading behind every store, however deep.
    const SW = 3, front = P + Dp + SW;
    const main = [
      { a: 0, o: P - 6, w: W + 8, d: Dp + SW + Db + 22, kind: "lawn" },            // the verge at the road and the side buffers
      { a: 0, o: P, w: W, d: Dp, kind: "lot" },                                      // the car park
      { a: 0, o: P + Dp, w: rowLen + 4, d: SW, kind: "walk" },                       // the sidewalk along the storefronts
      { a: 0, o: front, w: W, d: Db + 16, kind: "pave" },                           // service drive and docks behind (under the stores)
      { a: W / 2 - 12, o: P - 4, w: 2.4, d: 0.8, kind: "sign", z: 900, tenants: Math.min(8, row.length + (inline > 0 ? Math.round(inline / 6000) : 0)) },   // the pylon sign at the main entrance
    ];
    let x = -rowLen / 2;
    for (const b of row) { main.push({ a: x + b.w / 2, o: front, w: b.w, d: b.d, kind: "bldg", z: b.z, cls: "retail", floors: 1, role: b.role, sf: Math.round(b.sf) }); x += b.w + gap; }
    const out = [{ rects: main, sf: gla, name, cls: "retail", bldgclass, year }];
    pads.forEach((pd, j) => {
      const a = -W / 2 + ((j + 0.5) * W) / pads.length, lw = Math.min(W / pads.length - 6, pd.gas ? 60 : 50);
      const m2 = pd.sf * FT2, bw = Math.sqrt(m2 * 1.4), bd = m2 / bw;
      const rects = [{ a, o: 0, w: lw, d: P - 6, kind: "lot" }, { a: a + (pd.gas ? lw * 0.25 : 0), o: P - 6 - bd - 4, w: bw, d: bd, kind: "bldg", z: 580, cls: "retail", floors: 1, role: pd.role, sf: Math.round(pd.sf) }];
      if (pd.gas) rects.push({ a: a - lw * 0.2, o: 6, w: lw * 0.45, d: 22, kind: "pave" });   // the fuel apron under the canopy
      out.push({ rects, sf: pd.sf, name: `${name}, ${pd.what}`, cls: "retail", bldgclass: "K1", year: Math.round(R(Math.max(year, 1980), 2015)) });
    });
    return { parcels: out, W };
  }
  const PAD = () => [{ what: "fast food", sf: R(2800, 4000), role: "qsr" }, { what: "bank", sf: R(3500, 5000), role: "bank" }, { what: "gas and convenience", sf: R(3000, 4500), gas: true, role: "gas" }, { what: "restaurant", sf: R(5000, 7000), role: "restaurant" }];

  // ---- 5. the power centre, at the best interchange
  const power = [];
  for (const x of ixs) {
    const k = I(3, 5), boxes = Array.from({ length: k }, () => R(30000, 140000));
    let tot = boxes.reduce((a, b) => a + b, 0);
    const scale = tot > 520000 ? 520000 / tot : tot < 230000 ? 230000 / tot : 1; for (let i = 0; i < k; i++) boxes[i] *= scale;
    tot = boxes.reduce((a, b) => a + b, 0);
    const site = retail({ boxes, roles: boxes.map(() => "box"), inline: R(15000, 30000), pads: PAD().slice(0, I(2, 4)), year: Math.round(R(1995, 2010)), name: nameOf("Commons (power centre)") });
    const off = 220 + site.W / 2;
    if (put(x.p, x.u, site.parcels, { type: "power", name: site.parcels[0].name }, [off, -off, off + 250, -off - 250, off + 500, -off - 500])) { power.push(x); break; }
  }

  // ---- industrial 3: the planned industrial park, at another interchange (or the same one, the other side)
  const parkIx = ixs.filter((x) => !power.includes(x)).concat(power);
  for (const x of parkIx) {
    if (placed.some((s) => s.type === "industrial park")) break;
    for (const acres of [160, 120, 90, 80]) {
      const area = acres * ACRE, D = Math.sqrt(area / 1.5), W = area / D;
      const parcels = industrialPark(W, D);
      if (put(x.p, x.u, parcels.list, { type: "industrial park", name: parcels.name, roads: parcels.roads }, [260 + W / 2, -(260 + W / 2), 560 + W / 2, -(560 + W / 2)])) break;
    }
  }
  // ...or on an arterial within a couple of kilometres of an interchange, where the land is
  if (!placed.some((s) => s.type === "industrial park")) {
    for (const f of shuffle(front.filter((q) => ixs.some((x) => dist(x.p, q.p) < 2200) && edge(q.p) > 200))) {
      if (placed.some((s) => s.type === "industrial park")) break;
      for (const acres of [120, 80]) {
        const area = acres * ACRE, D = Math.sqrt(area / 1.5), W = area / D;
        const parcels = industrialPark(W, D);
        if (put(f.p, f.u, parcels.list, { type: "industrial park", name: parcels.name, roads: parcels.roads }, [0, W / 2, -W / 2])) break;
      }
    }
  }
  function industrialPark(W, D) {
    const name = nameOf("Industrial Park"), m = Math.min(170, D * 0.32), rw = 14;   // lot depth off the loop, road width
    const list = [], built = [];
    const lot = (a, o, w, d) => list.push({ a, o, w, d });
    // outer ring of lots between the boundary and the loop; the entrance splits the front row
    const cut = (a0, a1, o, d) => { let a = a0; while (a1 - a > 40) { const acres = Math.min((a1 - a) * d / ACRE, R(2.5, 12)); let w = (acres * ACRE) / d; if (a1 - (a + w) < 0.6 * ACRE / d) w = a1 - a; lot(a + w / 2, o, w, d); a += w; } };
    cut(-W / 2, -rw, 0, m); cut(rw, W / 2, 0, m);                                         // the front row, either side of the entrance
    cut(-W / 2, W / 2, D - m, m);                                                            // the back row
    const io = m + rw, id = D - 2 * m - 2 * rw, ia = W - 2 * m - 2 * rw;
    if (id > 80 && ia > 80) { cut(-ia / 2, ia / 2, io, id / 2); cut(-ia / 2, ia / 2, io + id / 2, id / 2); }   // the block inside the loop
    // the side rows
    for (const sd of [-1, 1]) { let o = m; while (D - m - o > 40) { const acres = Math.min((D - m - o) * m / ACRE, R(2.5, 12)); let d = (acres * ACRE) / m; if (D - m - (o + d) < 0.6 * ACRE / m) d = D - m - o; lot(sd * (W / 2 - m / 2), o, m, d); o += d; } }
    // about half built, the front first (it went first); the one or two biggest lots are distribution centres
    const order = list.map((l, i) => ({ i, area: l.w * l.d, o: l.o })).sort((a, b) => b.area - a.area);
    const dcs = new Set(order.slice(0, rng() < 0.5 ? 1 : 2).filter((x) => x.area > 12 * ACRE).map((x) => x.i));
    const out = list.map((l, i) => {
      const isDc = dcs.has(i), builtP = isDc ? 1 : 0.62 - 0.35 * (l.o / D);
      if (rng() >= builtP) return { rects: [{ a: l.a, o: l.o, w: l.w - 2, d: l.d - 2, kind: "lawn" }], sf: 0, name: `${name}, lot ${i + 1} (platted, vacant)`, cls: "land", bldgclass: "V1", year: 0 };
      const far = isDc ? R(0.38, 0.45) : R(0.3, 0.42), sf = Math.min(isDc ? 500000 : 120000, (l.w * l.d * far) / FT2);
      const what = isDc ? "distribution centre" : rng() < 0.5 ? "warehouse" : "light manufacturing";
      return industrialLot(l, sf, `${name}, lot ${i + 1} (${what})`, isDc, what === "light manufacturing" ? "manufacturing" : "bulk");
    });
    built.push(...out);
    const roads = (placeP) => {
      const P = (a, o) => placeP({ a, o, w: 0, d: 0 }).c;   // a point in the site's frame (o measured as the rects' centre line)
      return [
        { pl: [P(0, -14), P(0, m)], w: rw },                                                 // the entrance off the arterial
        { pl: [P(-W / 2 + m + rw / 2, m + rw / 2), P(W / 2 - m - rw / 2, m + rw / 2), P(W / 2 - m - rw / 2, D - m - rw / 2), P(-W / 2 + m + rw / 2, D - m - rw / 2), P(-W / 2 + m + rw / 2, m + rw / 2)], w: rw },   // the loop
      ];
    };
    return { list: out, roads, name };
  }
  /** One industrial lot: the building at the back, a truck court before it, a small car park by the road. */
  // role: what the renderer draws (unreal RetailBuilder's industrial half), the engine's product keys (products.ts)
  function industrialLot(l, sf, name, isDc, role = "bulk") {
    const m2 = sf * FT2, bd = Math.min(l.d * 0.62, Math.max(40, Math.sqrt(m2 / 2))), bw = Math.min(l.w * 0.92, m2 / bd);
    const real = bw * bd, court = isDc ? 45 : 28, park = ((real / FT2 / 1000) * IND_RATIO * SPACE_M2) / Math.max(20, bw);
    return {
      rects: [
        { a: l.a, o: l.o, w: l.w - 2, d: l.d - 2, kind: "lawn" },
        { a: l.a, o: l.o + l.d - 2 - bd - court, w: Math.min(l.w - 4, bw + 20), d: court, kind: "pave" },
        { a: l.a, o: l.o + 4, w: Math.min(l.w - 6, bw), d: Math.min(park, Math.max(8, l.d - bd - court - 10)), kind: "lot" },
        { a: l.a, o: l.o + l.d - 2 - bd, w: bw, d: bd, kind: "bldg", z: isDc ? Math.round(R(1100, 1300)) : Math.round(R(750, 950)), cls: "industrial", floors: 1, role, sf: Math.round(sf) },
      ],
      sf: real / FT2, name, cls: "industrial", bldgclass: isDc ? "E7" : rng() < 0.5 ? "E1" : "E9", year: Math.round(R(isDc ? 1995 : 1975, 2020)),
    };
  }

  // ---- industrial 4: a truck stop at an interchange
  for (const x of ixs) {
    if (placed.some((s) => s.type === "truck stop")) break;
    const sf = R(10000, 15000), m2 = sf * FT2;
    const rects = [
      { a: 0, o: 0, w: 260, d: 190, kind: "lawn" },
      { a: -55, o: 10, w: 120, d: 45, kind: "pave" },                                    // the fuel islands
      { a: -55, o: 60, w: Math.sqrt(m2 * 1.6), d: m2 / Math.sqrt(m2 * 1.6), kind: "bldg", z: 650, cls: "retail", floors: 1, role: "truckstop", sf: Math.round(sf) },
      { a: -55, o: 120, w: 120, d: 50, kind: "lot" },                                     // cars
      { a: 70, o: 10, w: 110, d: 170, kind: "pave" },                                     // truck parking, ~120 rigs
    ];
    put(x.p, x.u, [{ rects, sf, name: `${nameOf("Travel Center")} (truck stop)`, cls: "retail", bldgclass: "K1", year: Math.round(R(1975, 2005)) }], { type: "truck stop" }, [-(230 + 130), 230 + 130, 600, -600]);
  }

  // ---- 4. community centres, on major arterials at the town's edge
  const nComm = county > 45000 ? 2 : 1;
  for (const c of shuffle(corners.filter((q) => q.old && edge(q.p) > 80 && edge(q.p) < 900)).concat(shuffle(front.filter((q) => edge(q.p) > 80 && edge(q.p) < 1200)))) {
    if (placed.filter((s) => s.type === "community").length >= nComm) break;
    if (anyNear(c.p, 700) || near(c.p, "community", 1800)) continue;
    const gla = R(150000, 300000), anchor = R(80000, 125000), grocery = R(45000, 65000);
    const site = retail({ boxes: [anchor, grocery, ...(gla > 220000 ? [R(25000, 40000)] : [])], roles: ["dept", "grocery", "box"], inline: Math.max(15000, gla - anchor - grocery), pads: PAD().slice(0, I(1, 3)), year: Math.round(R(1975, 2005)), name: nameOf("Plaza (community centre)") });
    put(c.p, c.u, site.parcels, { type: "community" }, [site.W / 2 + 25, -(site.W / 2 + 25)]);
  }

  // ---- 6. a small dated mall, only where the county is near the top of the range
  if (county > 52000) {
    for (const c of shuffle(corners.filter((q) => q.old && edge(q.p) > 100 && edge(q.p) < 1200))) {
      if (anyNear(c.p, 800)) continue;
      const year = Math.round(R(1971, 1979)), gla = R(220000, 300000);
      const site = retail({ boxes: [R(60000, 90000), R(50000, 70000), gla * 0.45], roles: ["dept", "dept", "mall"], year, name: nameOf("Mall (enclosed, 1970s)"), bldgclass: "K6" });
      if (put(c.p, c.u, site.parcels, { type: "mall" }, [site.W / 2 + 25, -(site.W / 2 + 25)])) break;
    }
  }

  // ---- 2. neighbourhood centres: one per ~4,000 households, at arterial corners just past downtown
  const nNbhd = Math.max(2, Math.min(4, Math.round(townHh / 4000)));
  for (const c of shuffle(corners.filter((q) => edge(q.p) > 30 && edge(q.p) < 700)).concat(shuffle(front.filter((q) => edge(q.p) > 30 && edge(q.p) < 900)))) {
    if (placed.filter((s) => s.type === "neighbourhood").length >= nNbhd) break;
    if (anyNear(c.p, 450) || near(c.p, "neighbourhood", 1900) || near(c.p, "community", 800)) continue;
    const grocery = R(35000, 60000), inline = M.planV >= 17 ? R(10000, 30000) : R(15000, 50000);   // the shops beside the grocery, kept short (owner, plan 17)
    const site = retail({ boxes: [grocery], roles: ["grocery"], inline, pads: PAD().slice(0, I(0, 2)), year: Math.round(R(1960, 1995)), name: nameOf("Shopping Center (neighbourhood centre)") });
    put(c.p, c.u, site.parcels, { type: "neighbourhood" }, [site.W / 2 + 22, -(site.W / 2 + 22)]);
  }

  // ---- 3. strip and convenience centres, and gas stations, through the inner ring and along the roads out
  const nStrip = I(4, 8);
  for (const c of shuffle(corners.filter((q) => edge(q.p) < 1800).concat(front.filter((q) => q.old && edge(q.p) < 1800)))) {
    if (placed.filter((s) => s.type === "strip" || s.type === "gas").length >= nStrip) break;
    if (anyNear(c.p, 350)) continue;
    if (rng() < 0.35) {
      const sf = R(2500, 4500), m2 = sf * FT2, bw = Math.sqrt(m2 * 1.5), bd = m2 / bw;
      const rects = [{ a: 0, o: 0, w: 60, d: 55, kind: "lot" }, { a: -12, o: 4, w: 30, d: 22, kind: "pave" }, { a: 14, o: 55 - bd - 4, w: bw, d: bd, kind: "bldg", z: 520, cls: "retail", floors: 1, role: "gas", sf: Math.round(sf) }];
      put(c.p, c.u, [{ rects, sf, name: `${["Casey's", "Shell", "Marathon", "BP", "Phillips 66"][I(0, 4)]} gas and convenience`, cls: "retail", bldgclass: "K1", year: Math.round(R(1970, 2015)) }], { type: "gas" }, [55, -55]);
    } else {
      // MOST STRIPS ARE SMALL (owner: the long ones "look really weird"): the typical strip by the road is
      // 3-6 shops, 4-9k sf on a lot of about an acre [S, ICSC convenience centres run 10-30k but the
      // unanchored strips most towns are full of are smaller]; one in four is a longer 9-16k row
      const plan17 = M.planV >= 17;
      const inline = plan17 ? (rng() < 0.75 ? R(4000, 9000) : R(9000, 16000)) : R(9000, 28000);
      const site = retail({ inline, pads: (!plan17 || inline > 9000) && rng() < 0.4 ? PAD().slice(0, 1) : [], year: Math.round(R(1965, 2010)), name: nameOf("Square (strip centre)"), bldgclass: "K1" });
      put(c.p, c.u, site.parcels, { type: "strip" }, [site.W / 2 + 20, -(site.W / 2 + 20)]);
    }
  }

  // ---- industrial 2: light industrial and flex on the arterials at the town's edge
  const nFlex = I(5, 8);
  for (const f of shuffle(front.filter((q) => edge(q.p) > 150 && edge(q.p) < 1600))) {
    if (placed.filter((s) => s.type === "flex").length >= nFlex) break;
    if (anyNear(f.p, 250) || placed.some((s) => s.type !== "flex" && dist(s.at, f.p) < 450)) continue;
    const sf = R(10000, 40000), acres = Math.min(5, Math.max(1, (sf * FT2) / R(0.3, 0.45) / ACRE)), m2 = acres * ACRE;
    const w = Math.sqrt(m2 * 1.2), d = m2 / w;
    const lot = industrialLot({ a: 0, o: 0, w, d }, sf, `${nameOf("Business Center")} (light industrial / flex)`, false, "flex");
    put(f.p, f.u, [lot], { type: "flex" }, [0, w * 0.6, -w * 0.6]);
  }

  // ---- 7. a general store and gas at one or two far crossroads
  let rural = 0;
  for (const c of shuffle(corners.filter((q) => !q.old && edge(q.p) > 2000))) {
    if (rural >= (rng() < 0.5 ? 1 : 2)) break;
    if (anyNear(c.p, 1500)) continue;
    const sf = R(1800, 3200), m2 = sf * FT2, bw = Math.sqrt(m2 * 1.4), bd = m2 / bw;
    const rects = [{ a: 0, o: 0, w: 50, d: 45, kind: "lot" }, { a: -10, o: 4, w: 22, d: 18, kind: "pave" }, { a: 12, o: 45 - bd - 4, w: bw, d: bd, kind: "bldg", z: 480, cls: "retail", floors: 1, role: "general", sf: Math.round(sf) }];
    if (put(c.p, c.u, [{ rects, sf, name: `${NAMES[I(0, NAMES.length - 1)]} General Store`, cls: "retail", bldgclass: "K1", year: Math.round(R(1920, 1970)) }], { type: "rural" }, [45, -45])) rural++;
  }

  function shuffle(a) { return a.map((x) => [rng(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]); }
  return M.commerce;
}
export { dot };
