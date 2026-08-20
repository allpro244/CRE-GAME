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
import {
  makeProjection, polygonArea, centroid, bboxOfRing, sharedBoundaryLength,
} from "./geom.mjs";
import { massingStack } from "./massing.mjs";

/**
 * @param {{rawParcels:object, rawBuildings:object, rawStations:object,
 *          manifest:object, employment:object|null}} src
 */
/**
 * WHAT A QUARTER IS WORTH BEYOND WHAT IT MEASURES.
 *
 * A stable hash of the district name and the town's seed, mapped into a modest
 * band. Stable so a neighbourhood keeps its character for the life of the city
 * — a cachet that moved would be weather, not a place — and seeded so the good
 * address is somewhere different in the next town.
 *
 * The band is deliberately narrow. This is a thumb on a scale that already
 * works, not a replacement for it: at the extremes it is worth about a fifth
 * either way, which is the difference between a good address and an ordinary
 * one and nothing like the difference between downtown and the marshes.
 */
function districtCachet(name, seed) {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  const s = String(name);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  const u = ((h >>> 8) & 0xffff) / 0xffff;          // 0..1, stable
  // A business district is bought on its numbers and varies least; the places
  // people live and the old quarters carry most of the intangible.
  const n = s.toLowerCase();
  const span = /exchange|financial|core|downtown|business/.test(n) ? 0.09
    : /dock|industrial|works|yard|wharf/.test(n) ? 0.12
      : 0.20;
  return 1 + span * (u * 2 - 1);
}

export function buildCityData(src) {
  const { rawParcels, rawBuildings, rawStations, manifest, employment, parks } = src;
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

  // A SECOND CENTRE THAT IS ACTUALLY A CENTRE. One distant platform is not
  // enough if its weight is a restatement of downtown — the mill, the ferry
  // and the belt only register when they carry ridership of their own.
  const rankedSt = [...stationPts].sort((a, b) => b.w - a.w);
  const topSt = rankedSt[0];
  const farStops = rankedSt.filter((s) => topSt && Math.hypot(s.xy[0] - topSt.xy[0], s.xy[1] - topSt.xy[1]) > 450);
  const secondSt = farStops[0] ?? null;
  const thirdSt = farStops.find((s) => secondSt && Math.hypot(s.xy[0] - secondSt.xy[0], s.xy[1] - secondSt.xy[1]) > 400)
    ?? farStops[1] ?? null;

  const jobKind = (p) => {
    const L = (p.bldgclass ?? "")[0];
    const area = num(p.bldgarea) ?? 0;
    if (L === "O") return { office: area / 230, industrial: 0, retail: 0 };
    if (L === "E" || L === "F") return { office: 0, industrial: area / 550, retail: 0 };
    if (L === "K") return { office: 0, industrial: 0, retail: area / 400 };
    if (p.bldgclass === "RM" || p.bldgclass === "S1") return { office: 0, industrial: 0, retail: area / 700 };
    return { office: 0, industrial: 0, retail: 0 };
  };
  let jobPts;
  if (employment?.features?.length) {
    jobPts = employment.features.map((f) => {
      const office = num(f.properties.office);
      const industrial = num(f.properties.industrial);
      const retail = num(f.properties.retail);
      const jobs = num(f.properties.jobs) ?? 0;
      // Generated cities stamp the split. Older LODES dumps only have `jobs`;
      // treat that mass as office so the mill field stays empty rather than
      // inventing a port from a downtown total.
      return {
        xy: proj.toXY(f.geometry.coordinates),
        office: office ?? jobs,
        industrial: industrial ?? 0,
        retail: retail ?? 0,
      };
    });
  } else {
    jobPts = lots.map((l) => ({ xy: l.c, ...jobKind(l.p) }));
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
  const nearStations = bucketIndex(stationPts, 240);
  const nearJobs = bucketIndex(jobPts, 280);
  // PARK FRONTAGE, NOT A CIVIC-PARK BULLSEYE.
  //
  // Demand was transit gravity plus employment gravity, and the two were the
  // same field wearing two hats: employment is tallest downtown, and a
  // station's ridership was `22 + 54 * heat`. Amenity then sat on the same
  // square — parks are placed on hot ground — with a reach up to 520 m, so
  // the civic green painted a circle over half the island. That is the
  // owner's screenshot: one dark point on the park and concentric fade.
  //
  // Green frontage is still the oldest independent driver of urban land
  // value. Fifth Avenue faces the park; Bloomsbury is the squares. It is
  // also a FRONTAGE, one or two blocks, not a city-scale Gaussian. Each
  // park is a local bump of similar height; a great park reaches a little
  // further, it does not become the demand surface.
  const parkPts = (parks ?? []).map((pk) => ({
    xy: pk.xy ?? [pk.cx, pk.cy],
    r: Math.max(55, Math.min(140, Math.sqrt(Math.max(1, (pk.w ?? 80) * (pk.h ?? 80))) * 0.28)),
  }));
  const nearParks = bucketIndex(parkPts.filter((pk) => pk.xy?.[0] != null), 160);
  // THE WATER AND THE HIGH STREET, measured perpendicular rather than radially.
  //
  // Every term above is an isotropic kernel around a point, and two of the
  // strongest facts about urban land are not that shape: a shoreline premium
  // falls off perpendicular to the coast and a corridor premium perpendicular
  // to the road. No sum of point gravities makes either, which is why a port
  // town's harbour was worth nothing and its main road was worth nothing but a
  // wider carriageway.
  //
  // Decay lengths read off what people pay for: three hundred metres to the
  // water is four or five blocks, which is about where the hedonic literature
  // puts the half-life of a view; retail rent falls away from a high street
  // within a block or two, so ninety. Shape parameters, calibrated, not tuned.
  //
  // A WORKING DOCK IS NOT A WATERFRONT — `shoreamen` is 0 on the industrial
  // shore, because nobody pays to overlook a container yard. Same water,
  // opposite sign.
  const raws = lots.map((l) => ({
    transit: nearStations(l.c, 840, (s, d) => s.w * gauss(d, 280)),
    office: nearJobs(l.c, 780, (j, d) => j.office * gauss(d, 260)),
    mill: nearJobs(l.c, 900, (j, d) => j.industrial * gauss(d, 340)),
    shop: nearJobs(l.c, 480, (j, d) => j.retail * gauss(d, 160)),
    // Frontage, not proximity: the blocks that FACE the green, one street back.
    amen: nearParks(l.c, 280, (pk, d) => gauss(d, pk.r)),
    shore: (l.p?.shoreamen ?? 1) ? Math.exp(-(num(l.p?.shorem) ?? 9999) / 300) : 0,
    corridor: Math.exp(-(num(l.p?.corridorm) ?? 9999) / 90),
    second: (secondSt ? secondSt.w * gauss(Math.hypot(l.c[0] - secondSt.xy[0], l.c[1] - secondSt.xy[1]), 280) : 0)
      + (thirdSt ? thirdSt.w * gauss(Math.hypot(l.c[0] - thirdSt.xy[0], l.c[1] - thirdSt.xy[1]), 260) : 0),
  }));
  const p95 = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || 1; };
  const t95 = p95(raws.map((r) => r.transit));
  const o95 = p95(raws.map((r) => r.office)) || 1;
  const m95 = p95(raws.map((r) => r.mill)) || 1;
  const k95 = p95(raws.map((r) => r.shop)) || 1;
  const a95 = p95(raws.map((r) => r.amen)) || 1;
  // NORMALISED THE SAME WAY THE OTHER THREE ARE, and that is not a detail.
  // Un-normalised, an exponential decay sits far higher for the median lot
  // than a gravity term divided by its own 95th percentile does — so adding
  // the two of them at weight 22 raised the median lot's land value 11.8%
  // across the whole city. That is a level shift, and a level shift in land
  // is an economy change wearing a geometry label: it moves rents, cost basis
  // and the tax bill on every parcel. Against their own p95 they redistribute
  // instead, which is the only thing they were ever meant to do.
  const s95 = p95(raws.map((r) => r.shore)) || 1;
  const c95 = p95(raws.map((r) => r.corridor)) || 1;
  const n95 = p95(raws.map((r) => r.second)) || 1;
  // The town's mean premium, so the three multipliers below redistribute
  // instead of inflating — see the note where they are applied.
  const premMean = (() => {
    let t = 0;
    for (let i = 0; i < lots.length; i++) {
      const r = raws[i];
      t += ((num(lots[i].p?.corner) ?? 0) === 1 ? 1.18 : 1)
        * (1 + 0.15 * Math.min(1, r.shore / s95))
        * (1 + 0.25 * Math.min(1, r.corridor / c95));
    }
    return lots.length ? t / lots.length : 1;
  })();

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
    // 1.05, not 1.9. Gamma 1.9 was the un-plateau for a two-term blend
    // that piled at the top. Six independent fields do not pile, so 1.9
    // crushed scores under the demand>70 office gate (median 18, p90 50).
    // Compounding the weights the other way (sum 1.36) made half the lots
    // on some seeds prime. The mix is a 100-point skeleton again; 1.05 is
    // a mild exclusivity bend on a surface that already has a shape.
    // Keep in lockstep with DEMAND_GAMMA in src/engine/value.ts.
    const DEMAND_GAMMA = 1.05;
    const blend = Math.min(1,
      (30 * Math.min(1, dem.transit / t95)
        + 22 * Math.min(1, dem.office / o95)
        + 16 * Math.min(1, dem.mill / m95)
        + 8 * Math.min(1, dem.shop / k95)
        + 14 * Math.min(1, dem.second / n95)
        + 10 * Math.min(1, dem.amen / a95)) / 100);
    // AND SOME QUARTERS ARE SIMPLY BETTER ADDRESSES THAN THEIR NUMBERS SAY.
    //
    // Gravity fields cannot produce this and it is most of what a city actually
    // feels like. Two districts equidistant from the same jobs and the same
    // stations are not worth the same: one has the good school, the terraces
    // and the name people say when they are showing off, and the other has none
    // of that and a gasworks nobody has pulled down. Nothing measurable
    // separates Islington from Holloway, and everybody knows which is which.
    //
    // So a district carries a CACHET, drawn once per town from its own name so
    // it is stable for the life of the city and different between cities. It is
    // applied to the blend BEFORE the gamma, so it moves a whole quarter up or
    // down together rather than scattering — which is the difference between a
    // neighbourhood and noise, and the thing the owner asked to be thoughtful
    // about. Business districts vary least, because an office block is bought
    // on its numbers; residential and old quarters vary most, because a home is
    // not.
    const cachet = districtCachet(p.district ?? p.cd ?? "—", manifest.seed ?? 1);
    // THE WATER, THE HIGH STREET AND THE CORNER MULTIPLY. THEY DO NOT BLEND.
    //
    // The first cut of this put all three into the blend above at 22 of its
    // 100 points, scaling the accessibility terms down to make room. Measured
    // on the fixture, that FLATTENED THE CITY: the land distribution's p90/p10
    // spread fell from 110x to 75x, because the peak is made by the
    // accessibility terms and 22 points had been taken out of them — while the
    // ground that gained was every lot within ninety metres of an arterial and
    // three hundred of the water, which on an island is most of it. Undoing a
    // heavy tail is the opposite of what the gamma below exists to do.
    //
    // The structure was wrong, not the weights. A waterfront corner on the
    // high street is a premium ON TOP OF its location, not a substitute for
    // it: the same lot in the middle of nowhere is still in the middle of
    // nowhere. So they multiply, which preserves the gradient they sit on and
    // is what a hedonic model does with them anyway.
    //
    // Ceilings are the measured end of the real ranges: waterfront 15%,
    // high-street frontage 25%, corner 18% — the conservative end of the
    // 15-40% corner premium. Each ramps on its own p95 so it is a premium for
    // being NEAR the thing rather than a flat bonus for being on its side of
    // town.
    const cornerK = (num(p.corner) ?? 0) === 1 ? 1.18 : 1;
    const shoreK = 1 + 0.15 * Math.min(1, dem.shore / s95);
    const corridorK = 1 + 0.25 * Math.min(1, dem.corridor / c95);
    // Mean-normalised so the three multipliers redistribute: a waterfront
    // high-street corner is a premium ON TOP OF its access, and an inland
    // mid-block lot pays for it. Applied to the score — a premium that is
    // only painted on the desk is not a premium. The order book is a
    // citywide composition queue (test/orderbook.mjs); a spatial reshape
    // that keeps the demand distribution's shape does not fill it.
    const locPremium = (cornerK * shoreK * corridorK) / premMean;
    const rawDemand = Math.min(1, blend * cachet * locPremium);
    const demandScore = Math.max(4, Math.min(100, Math.round(100 * Math.pow(rawDemand, DEMAND_GAMMA))));
    const assessedPsf = assessLand / lotArea;
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
      // The three geometric facts citygen measures at the moment the lot is
      // cut. `locPremium` is the hedonic multiplier (mean 1), already in
      // demandScore; landPsf follows the score.
      shoreM: num(p.shorem) ?? 9999,
      corridorM: num(p.corridorm) ?? 9999,
      corner: (num(p.corner) ?? 0) === 1,
      locPremium: +locPremium.toFixed(4),
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
   * District tone 0-4 — FNV over the district key, the SAME derivation the
   * ground features use for their `dt` (citygen districtTone), so a volume's
   * palette family and the pavement tint under it agree about which district
   * they are in. This replaced `Number(bbl) % 5`: 1e9 and 1e4 are both
   * ≡ 0 (mod 5), so that tone was lotNo % 5 — a hard 1,2,3,4,0 stripe down
   * every block face, correlated with nothing on the ground.
   */
  const toneOf = (district) => {
    const t = String(district ?? "");
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 5;
  };

  const toGeom = (ringXY) => {
    const ll = ringXY.map(proj.toLL);
    return { type: "Polygon", coordinates: [[...ll, ll[0]]] };
  };

  // -------------------------------------------------------------- THE MASSING
  //
  // The families themselves now live in `citygen/massing.mjs`, in metres, with
  // no projection in them. They were four hundred lines here, closed over
  // `proj`, which meant the only population that could reach them was the stock
  // a city is GENERATED with — the renderer draws everything the player and the
  // rivals put up and could not call any of it, so it grew a second, much
  // poorer answer and the skyline flattened as the player bought the town.
  //
  // This is the same vocabulary it always was, at the same salts, choosing the
  // same family for the same building: the extraction is byte-identical on
  // `buildings3d` across seeds, which is the only reason it was allowed — a
  // moved generator is a moved save.
  function massing(geom, hM, year, klass, bbl, lotRingM) {
    if (geom.type !== "Polygon" || geom.coordinates.length !== 1) return null;
    const ringXY = geom.coordinates[0].slice(0, -1).map(proj.toXY);
    if (ringXY.length < 3) return null;
    const r = massingStack({
      ring: ringXY, lotRing: lotRingM, hM, year, klass, u: (k) => bh(bbl, k),
    });
    if (!r) return null;
    shape(r.name);
    // A tier standing on the WHOLE footprint hands back the caller's own ring
    // by reference, so the polygon this function was given goes back out
    // untouched rather than through a projection round trip.
    return r.tiers.map((t) => ({
      geom: t.ring === ringXY ? geom : toGeom(t.ring),
      base: t.base, top: t.top,
    }));
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
      // the district's tone family — the renderer's material key reads it as
      // the palette centre a block deviates from (per-building jitter lives in
      // the deed hash there, not here)
      tone: rec ? toneOf(rec.district) : 0,
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
  // vacant lots go out flat, so the renderer can dress them by place: demand
  // separates downtown gravel from fringe scrub, and `zn` (the zoning code's
  // first letter — the same letter dev.ts builds by) marks the residential
  // lots that go to grass behind a hedge rather than to a fenced yard
  for (const l of lots) {
    const rec = table[l.bbl];
    if (!rec || rec.class !== "land") continue;
    const zl = String(rec.zoneDist ?? "")[0];
    buildings3d.push({
      b: l.bbl, c: "land", y: 0, t: toneOf(rec.district), f: 0,
      z0: 0, z1: 0, d: 0, k: 1, ds: rec.demandScore ?? 50,
      zn: zl === "R" ? 1 : zl === "M" ? 2 : 0,
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
