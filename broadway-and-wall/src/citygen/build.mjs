// FROM RAW GEOMETRY TO THE GAME'S SUBSTRATE.
//
// Everything between a generated city and the tables the simulation runs on:
// the parcel attribute table keyed by BBL, the adjacency graph built from
// shared lot lines, the demand surface computed off transit and employment
// gravity, the tile-ready polygon collections and the compact mesh feed the
// 3D renderer eats.
//
// THIS FILE TOUCHES NO FILES. It used to be the middle four hundred lines of
// pipeline/process.mjs, wrapped in reads at the top and writes at the bottom,
// which meant the only way to get a city was to run Node and write a
// directory. Pulled out as a pure function it runs identically in the browser,
// which is what lets every new run generate its own city instead of shipping
// two of them. `pipeline/process.mjs` is now a thin wrapper that reads files,
// calls this, and writes files.
//
// Pure: same inputs, same outputs, no I/O, no clock, no globals.
import { makeProjection, polygonArea, centroid, bboxOfRing, sharedBoundaryLength, insetRingPerp } from "./geom.mjs";

/**
 * @param {{rawParcels:object, rawBuildings:object, rawStations:object,
 *          manifest:object, employment:object|null}} src
 */
export function buildCityData(src) {
  const { rawParcels, rawBuildings, rawStations, manifest, employment } = src;
  const num = (v) => {
    const n = typeof v === "string" ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
  };

  // Asset-class remap from PLUTO building class letter. There is no "mixed"
  // class: a building that is shops at grade with flats above gets a MIX, and
  // its `class` is whichever leg is largest. See src/engine/mix.ts for why.
  function assetClass(bldgclass, landuse, bldgarea) {
    const c = (bldgclass ?? "").toUpperCase();
    const L = c[0];
    // "Land" means NOTHING IS STANDING ON IT. Every other route to that answer
    // has to go through this test first, because a record that says vacant with
    // a floor count on it is a lie the whole engine then prices off.
    if (!bldgarea) return "land";
    if (L === "V" || landuse === "11") return "land";
    // A GARAGE IS A BUILDING. These letters — garages, transport, utility and
    // misc structures — used to come back "land" while KEEPING their floor count
    // and their building area, which produced 32 lots in New Alden alone that
    // said "vacant land" on the record with a four-storey structure drawn on
    // them. Worse, everything that prices dirt read them as dirt: an off-market
    // approach on a 2011 garage quoted land value against a built appraisal and
    // looked like a 95% discount.
    //
    // They are still the cheapest thing standing and the easiest to knock down —
    // that is what `industrial` means in this model. Teardown economics come out
    // of a low rent and an old frame, not out of pretending the frame is absent.
    if (L === "G" || L === "T" || L === "Z" || L === "Q") return "industrial";
    if (L === "E") return "industrial"; // lofts, sheds, warehouses
    if (L === "O" || L === "H" || L === "I" || L === "J" || L === "Y" || L === "W" || L === "P") return "office";
    if (L === "K" || L === "L") return "retail";
    if (L === "S" || c === "RM" || L === "M") return "stacked";
    if (L === "A" || L === "B" || L === "C" || L === "D" || L === "N" || L === "R") return "multifamily";
    return "stacked";
  }

  /**
   * A stacked building, resolved into what it is actually made of: retail on the
   * ground floor and the rest above, leaning residential where PLUTO says there
   * are units. Returns { class, mix } — the mix is the truth and the class is
   * just the biggest leg, kept so everything that files buildings by type still
   * has an answer.
   */
  function resolveMix(kind, floors, unitsRes, bbl) {
    if (kind !== "stacked") return { klass: kind, mix: kind === "land" ? undefined : { [kind]: 1 } };
    let h = 2166136261;
    for (let i = 0; i < bbl.length; i++) { h ^= bbl.charCodeAt(i); h = Math.imul(h, 16777619); }
    const j = ((h >>> 0) % 10000) / 10000;
    const fl = Math.max(1, floors || 1);
    const retail = Math.max(0.06, Math.min(0.42, (1 / fl) * (1.05 + 0.3 * j)));
    const rest = 1 - retail;
    const resLean = unitsRes > 0 ? 0.58 + 0.3 * j : 0.18 + 0.34 * j;
    const raw = { retail, multifamily: rest * resLean, office: rest * (1 - resLean) };
    const mix = {};
    let tot = 0;
    for (const k of Object.keys(raw)) if (raw[k] > 0.04) { mix[k] = raw[k]; tot += raw[k]; }
    for (const k of Object.keys(mix)) mix[k] = +(mix[k] / tot).toFixed(4);
    const klass = Object.keys(mix).sort((a, b) => mix[b] - mix[a])[0];
    return { klass, mix };
  }

  // --- pass 1: extract, project, measure -------------------------------------
  // centroid of all features -> local meter frame
  let cx = 0, cy = 0, cn = 0;
  for (const f of rawParcels.features) {
    if (!f.geometry) continue;
    const ring = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0];
    for (const [x, y] of ring) { cx += x; cy += y; cn++; }
  }
  const proj = makeProjection(cx / cn, cy / cn);

  const lots = [];
  for (const f of rawParcels.features) {
    if (!f.geometry) continue;
    const p = f.properties;
    const bbl = String(p.bbl ?? p.BBL ?? "").replace(/\.0+$/, "");
    if (!bbl) continue;
    const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
    // largest outer ring carries the lot for adjacency/centroid purposes
    let best = null, bestA = 0;
    for (const poly of polys) {
      const xy = poly[0].map(proj.toXY);
      const a = Math.abs(polygonArea([xy]));
      if (a > bestA) { bestA = a; best = xy; }
    }
    if (!best || bestA < 5) continue;
    lots.push({ bbl, p, ring: best, ringLL: f.geometry, areaM2: bestA, c: centroid(best) });
  }

  // medians by building class for imputation
  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  const byClass = new Map();
  for (const l of lots) {
    const k = (l.p.bldgclass ?? "??")[0];
    if (!byClass.has(k)) byClass.set(k, { years: [], floors: [], psf: [] });
    const g = byClass.get(k);
    const yb = num(l.p.yearbuilt); if (yb && yb > 1800) g.years.push(yb);
    const nf = num(l.p.numfloors); if (nf && nf > 0) g.floors.push(nf);
    const at = num(l.p.assesstot), la = num(l.p.lotarea);
    if (at && la) g.psf.push(at / la);
  }

  // --- demand kernels ---------------------------------------------------------
  // keep stations within 1.5 km of the study area so a citywide dataset works
  let lotsMinX = Infinity, lotsMinY = Infinity, lotsMaxX = -Infinity, lotsMaxY = -Infinity;
  for (const l of lots) {
    if (l.c[0] < lotsMinX) lotsMinX = l.c[0]; if (l.c[0] > lotsMaxX) lotsMaxX = l.c[0];
    if (l.c[1] < lotsMinY) lotsMinY = l.c[1]; if (l.c[1] > lotsMaxY) lotsMaxY = l.c[1];
  }
  const stationPts = rawStations.features
    .filter((f) => f.geometry?.type === "Point")
    .map((f) => ({
      xy: proj.toXY(f.geometry.coordinates),
      w: num(f.properties.weight) ?? 30,
      name: f.properties.stop_name ?? f.properties.name ?? "station",
      lines: f.properties.daytime_routes ?? f.properties.line ?? "",
      ll: f.geometry.coordinates,
    }))
    .filter((s) =>
      s.xy[0] > lotsMinX - 1500 && s.xy[0] < lotsMaxX + 1500 &&
      s.xy[1] > lotsMinY - 1500 && s.xy[1] < lotsMaxY + 1500);

  let jobPts;
  if (employment?.features?.length) {
    jobPts = employment.features.map((f) => ({ xy: proj.toXY(f.geometry.coordinates), jobs: num(f.properties.jobs) ?? 0 }));
  } else {
    // fallback proxy: jobs from commercial built area
    jobPts = lots
      .filter((l) => ["O", "K", "S", "R", "M"].includes((l.p.bldgclass ?? "")[0]))
      .map((l) => ({ xy: l.c, jobs: (num(l.p.bldgarea) ?? 0) / 300 }));
    console.warn("No LODES employment file — using built-area employment proxy for demandScore.");
  }

  // gaussian kernels with a 3σ cutoff via a bucket index — island-scale safe
  const gauss = (d, r) => Math.exp(-(d * d) / (2 * r * r));
  function bucketIndex(pts, cell) {
    const m = new Map();
    for (const p of pts) {
      const k = Math.floor(p.xy[0] / cell) + ":" + Math.floor(p.xy[1] / cell);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return (c, radius, fn) => {
      const r = Math.ceil(radius / cell);
      const gx = Math.floor(c[0] / cell), gy = Math.floor(c[1] / cell);
      let acc = 0;
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (const p of m.get((gx + dx) + ":" + (gy + dy)) ?? []) {
            const d = Math.hypot(c[0] - p.xy[0], c[1] - p.xy[1]);
            if (d <= radius) acc += fn(p, d);
          }
      return acc;
    };
  }
  const nearStations = bucketIndex(stationPts, 350);
  const nearJobs = bucketIndex(jobPts, 300);
  const raws = lots.map((l) => ({
    transit: nearStations(l.c, 1050, (s, d) => s.w * gauss(d, 350)),
    emp: nearJobs(l.c, 900, (j, d) => j.jobs * gauss(d, 300)),
  }));
  const p95 = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || 1; };
  const t95 = p95(raws.map((r) => r.transit));
  const e95 = p95(raws.map((r) => r.emp));

  // --- adjacency: bbox grid index + shared boundary length --------------------
  const CELL = 60; // meters
  const grid = new Map();
  lots.forEach((l, i) => {
    const [minX, minY, maxX, maxY] = bboxOfRing(l.ring);
    l.bbox = [minX, minY, maxX, maxY];
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
      for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy++) {
        const k = gx + ":" + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  const TOL = 1.5;   // meters — the "buffer" of buffer-and-intersect
  const MIN_SHARED = 3; // meters of shared lot line to count as adjacent
  const adjacency = {};
  let edgeCount = 0;
  lots.forEach((l, i) => {
    const cand = new Set();
    const [minX, minY, maxX, maxY] = l.bbox;
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
      for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy++)
        for (const j of grid.get(gx + ":" + gy) ?? []) if (j > i) cand.add(j);
    for (const j of cand) {
      const m = lots[j];
      if (m.bbox[0] > maxX + TOL || m.bbox[2] < minX - TOL || m.bbox[1] > maxY + TOL || m.bbox[3] < minY - TOL) continue;
      const shared = sharedBoundaryLength(l.ring, m.ring, TOL);
      if (shared >= MIN_SHARED) {
        (adjacency[l.bbl] ??= []).push(m.bbl);
        (adjacency[m.bbl] ??= []).push(l.bbl);
        edgeCount++;
      }
    }
  });

  // --- assemble records --------------------------------------------------------
  const table = {};
  const tileParcels = { type: "FeatureCollection", features: [] };
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i], p = l.p;
    const imputed = [];
    const cls = (p.bldgclass ?? "").toUpperCase() || "??";
    const g = byClass.get(cls[0]) ?? { years: [], floors: [], psf: [] };

    let lotArea = num(p.lotarea);
    const geomSf = Math.round(l.areaM2 * 10.7639);
    if (!lotArea || lotArea < 100 || Math.abs(lotArea - geomSf) / geomSf > 3) {
      lotArea = geomSf; imputed.push("lotArea");
    }
    let floors = num(p.numfloors);
    let bldgArea = num(p.bldgarea);
    const vacant = assetClass(cls, p.landuse, bldgArea) === "land";
    if (!vacant) {
      if (!floors) { floors = median(g.floors) ?? 4; imputed.push("floors"); }
      if (!bldgArea) { bldgArea = Math.round(lotArea * 0.7 * floors); imputed.push("bldgArea"); }
    } else { floors = floors ?? 0; bldgArea = bldgArea ?? 0; }
    let yearBuilt = num(p.yearbuilt);
    if (!vacant && (!yearBuilt || yearBuilt < 1800)) { yearBuilt = median(g.years) ?? 1930; imputed.push("yearBuilt"); }
    let assessLand = num(p.assessland);
    let assessTot = num(p.assesstot);
    if (!assessLand || assessLand <= 0) {
      assessLand = Math.round(lotArea * (median(g.psf) ?? 120) * 0.35); imputed.push("assessedLand");
    }
    if (!assessTot || assessTot < assessLand) {
      assessTot = assessLand + Math.round(bldgArea * (median(g.psf) ?? 120) * 0.4); imputed.push("assessedTotal");
    }

    const dem = raws[i];
    // GOOD GROUND IS SCARCE.
    //
    // The raw blend of transit gravity and employment gravity is two ratios that
    // each saturate at the 95th percentile, and a linear mix of two saturating
    // terms piles mass at the top: the median lot in New Alden scored 63, more
    // than a third of the city scored over 70, and better than a fifth scored
    // over 80. That is not a city, it is a plateau with a harbour on it — and it
    // is why every block felt like a good block.
    //
    // The gamma bends it back into the shape land actually takes. Value falls
    // away from a core steeply, not linearly: at 1.9 the median lot is a 42, the
    // top decile starts at 85, and about one lot in eight is genuinely prime.
    // The ORDER is untouched — the same ground is still the best ground — so
    // every district reads the same, it just stops flattering the fringe.
    const DEMAND_GAMMA = 1.9;
    const rawDemand = Math.min(1,
      (45 * Math.min(1, dem.transit / t95) + 55 * Math.min(1, dem.emp / e95)) / 100);
    const demandScore = Math.max(4, Math.min(100, Math.round(100 * Math.pow(rawDemand, DEMAND_GAMMA))));
    const assessedPsf = assessLand / lotArea;
    // assessed values run well below market; scale up, then blend with demand
    const landPsf = Math.max(30, Math.round((assessedPsf / 0.45) * (0.6 + 0.9 * (demandScore / 100))));

    const farMaxComm = num(p.commfar) ?? 0;
    const farMaxRes = num(p.resfar) ?? 0;
    const kind = assetClass(cls, p.landuse, bldgArea);
    let { klass, mix } = resolveMix(kind, floors, num(p.unitsres) ?? 0, l.bbl);
    // THE INVARIANT, ENFORCED AT THE DOOR. Whatever the source letters say, a
    // lot with floor area on it is not vacant and a lot without any is. Every
    // downstream reader — the appraisal, the off-market ask, the 3D layer, the
    // development desk — assumes these two agree, and for a couple of per cent
    // of every city they did not.
    if (klass === "land" && bldgArea > 0) { klass = "industrial"; mix = undefined; }
    if (klass !== "land" && bldgArea <= 0) { klass = "land"; mix = undefined; floors = 0; yearBuilt = 0; }

    table[l.bbl] = {
      bbl: l.bbl,
      address: p.address ?? "(no address)",
      borough: p.borough ?? "MN",
      block: p.block ?? l.bbl.slice(1, 6),
      lot: p.lot ?? l.bbl.slice(6),
      zoneDist: p.zonedist1 ?? "—",
      // the neighbourhood this lot sits in — the submarket view is built on it
      district: p.district ?? p.cd ?? "—",
      farMaxComm, farMaxRes,
      bldgClass: cls,
      class: klass,
      ...(mix && Object.keys(mix).length > 1 ? { mix } : {}),
      lotArea, bldgArea, floors, yearBuilt,
      unitsRes: num(p.unitsres) ?? 0,
      assessedLand: assessLand,
      assessedTotal: assessTot,
      demandScore,
      // How exposed this ground is to the water: 0 dry, 1 on the quay. Computed
      landPsf,
      landPsfHistory: [landPsf],
      imputed,
      centroid: proj.toLL(l.c).map((v) => +v.toFixed(6)),
    };

    tileParcels.features.push({
      type: "Feature",
      id: Number(l.bbl),
      geometry: l.ringLL,
      properties: {
        bbl: l.bbl, address: table[l.bbl].address, class: klass,
        demand: demandScore, landpsf: landPsf, zone: table[l.bbl].zoneDist,
      },
    });
  }

  // buildings for the tiler: join heights (feet -> meters) by base BBL.
  //
  // ------------------------------------------------------------------ MASSING
  //
  // TWO SHAPES WERE 61% OF EVERY TOWER IN THIS CITY.
  //
  // A pre-1961 tower got a wedding cake with its setbacks nailed to 52% and
  // 82% of its height and its insets nailed to 66% and 38% of its area: the
  // same three-step ziggurat at every scale, on every lot, in every city,
  // forever. A modern tower got a podium of exactly 8.0 m under an unaltered
  // footprint. Above 45 m nothing else existed. From the water the skyline
  // read as one building photocopied at eleven sizes, which is most of why a
  // generated city looks generated.
  //
  // Real silhouettes come from the rule that was in force when the money was
  // spent, and from how much lot there was to spend it on. The 1916 zoning
  // resolution pushed a building back from the street on a sky-exposure plane
  // as it rose — but exempted a tower standing on a QUARTER of the lot, which
  // let it go up as far as it liked. That exemption is the reason a prewar
  // downtown is ziggurats WITH SPIKES IN THEM rather than ziggurats. The 1961
  // rewrite priced height in floor-area ratio and paid a bonus for handing the
  // pavement a plaza, which is why a postwar downtown is slabs and shafts
  // standing off the street behind an apron of granite.
  //
  // Seven families now, with their proportions read off the lot: wedding cake
  // (2-4 setbacks), tower-on-a-base, single high setback, terraced prewar
  // mid-rise, podium-and-shaft, mechanical setback, taper. Plus the slab,
  // because a box is a real answer and a city with no boxes in it is as
  // obviously fake as a city with nothing but.
  const tileBuildings = { type: "FeatureCollection", features: [] };
  let missingH = 0, stacked = 0, tiersTotal = 0;
  // Which silhouette each building ended up as, so the histogram is a thing
  // you can look at rather than a thing you have to trust.
  const shapes = {};
  const shape = (k) => { shapes[k] = (shapes[k] ?? 0) + 1; };
  const lotRingByBBL = new Map(lots.map((l) => [l.bbl, l.ring]));

  const citySeed = (manifest?.seed ?? 1) >>> 0;
  /**
   * A 32-bit key from a BBL, in EXACT integer arithmetic. `Number(bbl) * P` is
   * 2.7e18 for a ten-digit BBL — three hundred times past the 2^53 where
   * doubles stop counting by ones, so the bottom nine bits of the product are
   * always zero and anything mixed in below that granularity is discarded
   * before the hash sees it. FNV over the digits is ten iterations and correct.
   */
  const keyCache = new Map();
  const keyOf = (bbl) => {
    let k = keyCache.get(bbl);
    if (k !== undefined) return k;
    const t = String(bbl);
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    k = h >>> 0; keyCache.set(bbl, k); return k;
  };
  /** A stable [0,1) per building per question, and different in a new town. */
  const bh = (bbl, salt) => {
    let x = (Math.imul(keyOf(bbl) ^ Math.imul(salt, 0x9e3779b1), 2654435761) ^
             Math.imul(citySeed, 2246822519)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };

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
  const toGeom = (ringXY) => {
    const ll = ringXY.map(proj.toLL);
    return { type: "Polygon", coordinates: [[...ll, ll[0]]] };
  };

  /**
   * The stack of volumes a building actually stands as, base first.
   * null means "a plain extrusion is the right answer" — which for most of the
   * city it is, because most of a city is five storeys of brick.
   */
  function massing(geom, hM, year, klass, bbl, lotRingM) {
    if (geom.type !== "Polygon" || geom.coordinates.length !== 1) return null;
    const ringXY = geom.coordinates[0].slice(0, -1).map(proj.toXY);
    if (ringXY.length < 3) return null;
    const areaM2 = Math.abs(polygonArea([ringXY]));
    if (areaM2 < 180) return null;
    const side = Math.sqrt(areaM2);
    const W = side;                 // the plate's width, near enough, in metres
    const u = (k) => bh(bbl, k);
    const out = [];
    const push = (r, base, top) => {
      if (!r || top - base < 0.6) return false;
      out.push({ geom: Array.isArray(r) ? toGeom(r) : r, base: +base.toFixed(1), top: +top.toFixed(1) });
      return true;
    };
    /** File the silhouette and hand it back, or fall through to a slab. */
    const done = (name) => { if (out.length < 2) return null; shape(name); return out; };

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
      // A box is a real answer, and a city with no boxes in it is as obviously
      // fake as a city with nothing else. Fewer of them once a building is
      // tall enough that somebody had to think about its top.
      for (let k = hM >= 30 ? 2 : 3; k > 0; k--) fams.push("slab");
      switch (fams[Math.min(fams.length - 1, Math.floor(u(4) * fams.length))]) {
        case "cake": {
          // WEDDING CAKE — two to four setbacks above a street wall whose
          // height comes off the lot rather than off a constant.
          const n = 2 + Math.floor(u(7) * 3);
          const baseTop = hM * (0.24 + 0.24 * u(8));
          let z = baseTop, frac = 1, lastR = ringXY;
          push(geom, 0, baseTop);
          for (let k = 0; k < n; k++) {
            frac *= 0.62 + 0.16 * bh(bbl, 20 + k);
            const r = shrink(ringXY, side, frac);
            if (!r) break;
            const top = k === n - 1 ? hM : z + (hM - z) * (0.34 + 0.26 * bh(bbl, 30 + k));
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
          push(geom, 0, baseTop);
          push(shaft, baseTop, crownAt);
          const crown = shrink(shaft, side * Math.sqrt(shaftFrac), 0.54 + 0.20 * u(12));
          if (!push(crown, crownAt, hM)) push(shaft, crownAt, hM);
          return done("tower on a base");
        }
        case "step": {
          // One high setback — the cheapest way to satisfy the sky plane.
          const zc = hM * (0.58 + 0.24 * u(13));
          push(geom, 0, zc);
          push(shrink(ringXY, side, 0.50 + 0.26 * u(14)), zc, hM);
          return done("high setback");
        }
        case "loft": {
          // A tall thin loft goes straight up and stops, with at most a small
          // step under the cornice.
          const zc = hM * (0.86 + 0.08 * u(5));
          push(geom, 0, zc);
          push(shrink(ringXY, side, 0.62 + 0.16 * u(6)), zc, hM);
          return done("loft step");
        }
        case "terrace": {
          // A prewar apartment house often gives its top floor a terrace.
          const zc = hM * (0.74 + 0.12 * u(2));
          push(geom, 0, zc);
          push(shrink(ringXY, side, 0.58 + 0.22 * u(3)), zc, hM);
          return done("prewar terrace");
        }
        default: return null;
      }
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
    for (let k = hM >= 32 ? 2 : 4; k > 0; k--) post.push("slab");
    switch (post[Math.min(post.length - 1, Math.floor(u(19) * post.length))]) {
      case "retail base": {
        // Shops at grade run out to the lot line under a set-back upper floor.
        const pod = insetRingPerp(lotRingM, 1.2 + 1.8 * u(20));
        if (!pod) return null;
        push(pod, 0, 4.5 + 4 * u(21));
        push(geom, 0, hM);
        return done("retail base");
      }
      case "podium": {
        // PODIUM AND SHAFT. One to four storeys of base, not 8.0 m of it.
        const pod = insetRingPerp(lotRingM, 1.0 + 1.8 * u(22));
        if (!pod) return null;
        push(pod, 0, 5 + 10 * u(23));
        push(geom, 0, hM);
        return done("podium and shaft");
      }
      case "mech": {
        // The plant floor steps in — the commonest thing a 1970s tower does
        // to its own profile.
        const zc = hM * (0.42 + 0.26 * u(24));
        push(geom, 0, zc);
        push(shrink(ringXY, side, 0.74 + 0.16 * u(25)), zc, hM);
        return done("mechanical setback");
      }
      case "taper": {
        // Two or three steps through the top third.
        const n = 2 + (u(26) > 0.55 ? 1 : 0);
        let z = hM * (0.58 + 0.14 * u(27)), frac = 1, lastR = ringXY;
        push(geom, 0, z);
        for (let k = 0; k < n; k++) {
          frac *= 0.76 + 0.12 * bh(bbl, 40 + k);
          const r = shrink(ringXY, side, frac);
          if (!r) break;
          const top = k === n - 1 ? hM : z + (hM - z) * (0.42 + 0.20 * bh(bbl, 50 + k));
          if (!push(r, z, top)) break;
          z = top; lastR = r;
        }
        if (z < hM - 0.6) push(lastR, z, hM);
        return done("taper");
      }
      default: return null;
    }
    return null;   // a slab is a real shape, and a city needs some
  }

  for (const f of rawBuildings.features) {
    if (!f.geometry) continue;
    const bbl = String(f.properties.base_bbl ?? f.properties.bbl ?? "").replace(/\.0+$/, "");
    const rec = table[bbl];
    let hft = num(f.properties.heightroof);
    if (!hft || hft < 8) { hft = rec && rec.floors ? rec.floors * 11.5 : 30; missingH++; }
    const hM = +(hft * 0.3048).toFixed(1);
    const year = num(f.properties.cnstrct_yr) ?? rec?.yearBuilt ?? 1950;
    const props = {
      bbl: bbl || "",
      class: rec?.class ?? "office",
      year,
      // stable per-building tone jitter for the facade palette
      tone: bbl ? Number(bbl) % 5 : 0,
      // decorative kind (hull, crane, light...) — the renderer paints by it
      ...(f.properties.deco ? { deco: f.properties.deco } : {}),
    };
    const id = bbl && table[bbl] ? Number(bbl) : undefined;
    const stack = bbl
      ? massing(f.geometry, hM, year, rec?.class ?? "office", bbl, lotRingByBBL.get(bbl))
      : null;
    if (stack && stack.length > 1) {
      // Which volume is the ROOF matters: the stair and lift overrun, the
      // antenna and the stepped deco crown belong on the top of the building
      // and not on every setback terrace under it. A bulkhead dropped on the
      // base tier of a wedding cake is a box drawn inside the tower above it.
      let ti = 0;
      for (let i = 1; i < stack.length; i++) if (stack[i].top > stack[ti].top) ti = i;
      stacked++; tiersTotal += stack.length;
      stack.forEach((t, i) => {
        tileBuildings.features.push({
          type: "Feature", id,
          geometry: t.geom,
          properties: { ...props, heightM: t.top, baseM: t.base, ...(i === ti ? { crown: 1 } : {}) },
        });
      });
    } else {
      const baseFt = num(f.properties.base_ft);
      tileBuildings.features.push({
        type: "Feature", id,
        geometry: f.geometry,
        properties: { ...props, heightM: hM, baseM: baseFt ? +(baseFt * 0.3048).toFixed(1) : 0, crown: 1 },
      });
    }
  }

  // Where the city IS, and where its centre of gravity is — so the map can
  // frame any city without a hand-tuned camera per map. The core is the
  // demand-weighted centroid with demand CUBED, which lands on the central
  // business district rather than the geometric middle of the land (those are
  // rarely the same place, and the middle is usually somebody's back yard).
  const bounds = (() => {
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    let bx = 0, by = 0, bw = 0;
    for (const l of lots) {
      const [lon, lat] = proj.toLL(centroid(l.ring));
      if (lon < w) w = lon; if (lon > e) e = lon;
      if (lat < so) so = lat; if (lat > n) n = lat;
      const d = (table[l.bbl]?.demandScore ?? 1) / 100;
      const wt = d * d * d;
      bx += lon * wt; by += lat * wt; bw += wt;
    }
    return { bbox: [w, so, e, n], core: bw ? [bx / bw, by / bw] : [(w + e) / 2, (so + n) / 2] };
  })();
  const outManifest = {
    ...manifest,
    lots: lots.length,
    adjacencyEdges: edgeCount,
    bbox: bounds.bbox.map((v) => +v.toFixed(6)),
    core: bounds.core.map((v) => +v.toFixed(6)),
    processed: true,
  };

  // The compact mesh feed for the 3D renderer — the same volumes as the tiles.
  const buildings3d = [];
  for (const f of tileBuildings.features) {
    if (f.geometry.type !== "Polygon") continue;
    const p = f.properties;
    const ring = f.geometry.coordinates[0].slice(0, -1).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
    if (ring.length < 3) continue;
    const rec = p.bbl ? table[p.bbl] : null;
    buildings3d.push({
      b: p.bbl, c: p.class, y: p.year, t: p.tone,
      f: rec?.floors ?? 0, z0: p.baseM, z1: p.heightM,
      d: p.bbl ? 0 : 1,               // decorative: ships, cranes, sheds
      ...(p.crown ? { x: 1 } : {}),   // this volume is the roof of the building
      ...(p.deco ? { dk: p.deco } : {}),
      r: ring,
    });
  }
  // vacant lots go out flat, so the renderer can dress them (gravel and fence)
  for (const l of lots) {
    const rec = table[l.bbl];
    if (!rec || rec.class !== "land") continue;
    buildings3d.push({
      b: l.bbl, c: "land", y: 0, t: Number(l.bbl) % 5, f: 0,
      z0: 0, z1: 0, d: 0, k: 1,
      r: l.ring.map((p) => proj.toLL(p).map((v) => +v.toFixed(6))),
    });
  }

  return {
    parcels: table,
    adjacency,
    stations: stationPts.map((s) => ({ name: s.name, lines: s.lines, ll: s.ll })),
    manifest: outManifest,
    tileParcels,
    tileBuildings,
    buildings3d,
    stats: {
      lots: lots.length,
      withNeighbours: Object.keys(adjacency).length,
      edges: edgeCount,
      buildings: tileBuildings.features.length,
      heightsImputed: missingH,
      stacked, tiersTotal, shapes,
    },
  };
}
