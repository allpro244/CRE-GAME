// HOW MUCH DO PARKS AND BOULEVARDS ACTUALLY VARY BETWEEN CITIES?
//
//   pnpm variety            forty generated islands
//   N=200 pnpm variety      a wider sweep
//
// Two cities that differ only in their street names are one city. This counts
// what a player can actually see is different from one town to the next, and
// it exists because both answers were once "nothing":
//
//   parks       40 of 40 islands had exactly THREE, and the largest was
//               71-79% of the total green in every single one — one park
//               programme wearing forty seeds.
//   boulevards  the count already varied 0-3, but every one of them was
//               declared at 22-30 m, so there was no such thing as a city
//               with a network of ordinary wide roads rather than a monument.
//
// A city now draws a park PROGRAMME (one great park / a set of squares /
// commons / a few greens / almost none) and a boulevard CHARACTER (grand or
// arterial), and this is the harness that says whether those still reach the
// ground. If any single row of these distributions goes back to 100%, the
// generator has stopped generating.
import { islandConfig } from "../src/citygen/island.mjs";
import { isConvex, bboxOfRing } from "../src/citygen/geom.mjs";
const N = Number(process.env.N ?? 40);
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(p*(b.length-1))];};
const rows=[];
for(let i=0;i<N;i++){
  const seed=(2166136261 ^ ((i+1)*2654435761))>>>0;
  let cfg; try { cfg = islandConfig(seed); } catch(e){ console.log("fail",seed,e.message); continue; }
  const parks=cfg.parks??[], dg=cfg.diagonals??[];
  const areas=parks.map(p=>p.w*p.h);
  const shapes=parks.map(p=>p.shape??"square");
  rows.push({seed,nPark:parks.length,areas,shapes,nDiag:dg.length,
    boul:cfg.plan?.boulevards, kind:cfg.plan?.boulevardKind, prog:cfg.plan?.parkProgramme, seams:dg.length-(cfg.plan?.boulevards??0), dw:dg.map(d=>d.h),
    flavours:parks.map(p=>p.flavour??"park"),
    coast:cfg.plan?.coastProgramme, grain:cfg.plan?.grainProgramme,
    rail:cfg.plan?.railProgramme, landmark:cfg.plan?.landmark});
}
console.log(`\nPARKS AND BOULEVARDS ACROSS ${rows.length} GENERATED ISLANDS\n`);
const counts={}; for(const r of rows) counts[r.nPark]=(counts[r.nPark]??0)+1;
console.log("park COUNT distribution:", Object.entries(counts).map(([k,v])=>`${k} parks x${v}`).join("  "));
const bc={}; for(const r of rows) bc[r.boul??"?"]=(bc[r.boul??"?"]??0)+1;
console.log("boulevard COUNT distribution:", Object.entries(bc).map(([k,v])=>`${k} x${v}`).join("  "));
const all=rows.flatMap(r=>r.areas);
console.log(`\npark AREA (sq m): p10 ${Math.round(q(all,0.1))}  median ${Math.round(q(all,0.5))}  p90 ${Math.round(q(all,0.9))}  max ${Math.round(Math.max(...all))}`);
console.log("\nper-city park areas, biggest first (first 12 cities):");
for(const r of rows.slice(0,12)) console.log(`  ${String(r.seed).padStart(10)}  ${[...r.areas].sort((a,b)=>b-a).map(a=>Math.round(a/1000)+"k").join(" ")}`);
// the shape question: is the LARGEST park always about the same share of total?
const dw=rows.flatMap(r=>r.dw??[]);
console.log("\nBOULEVARD widths (h, the reservation):", dw.length?`p10 ${Math.round(q(dw,0.1))} median ${Math.round(q(dw,0.5))} p90 ${Math.round(q(dw,0.9))}`:"n/a");
const kc={}; for(const r of rows) kc[`${r.boul} ${r.kind}`]=(kc[`${r.boul} ${r.kind}`]??0)+1;
console.log("\nboulevard COUNT x CHARACTER:", Object.entries(kc).sort().map(([k,v])=>`${k} x${v}`).join("  "));
const pc={}; for(const r of rows) pc[r.prog]=(pc[r.prog]??0)+1;
console.log("park PROGRAMME:", Object.entries(pc).map(([k,v])=>`${k} x${v}`).join("  "));
const sc={}; for(const r of rows) for(const s of r.shapes??[]) sc[s]=(sc[s]??0)+1;
console.log("park SHAPES:", Object.entries(sc).sort().map(([k,v])=>`${k} x${v}`).join("  "));
const fc={}; for(const r of rows) for(const f of r.flavours??[]) fc[f]=(fc[f]??0)+1;
console.log("park FLAVOUR:", Object.entries(fc).sort().map(([k,v])=>`${k} x${v}`).join("  "));
const cc={}; for(const r of rows) cc[r.coast??"?"]=(cc[r.coast??"?"]??0)+1;
console.log("coast PROGRAMME:", Object.entries(cc).map(([k,v])=>`${k} x${v}`).join("  "));
const gc={}; for(const r of rows) gc[r.grain??"?"]=(gc[r.grain??"?"]??0)+1;
console.log("grain PROGRAMME:", Object.entries(gc).map(([k,v])=>`${k} x${v}`).join("  "));
const rc={}; for(const r of rows) rc[r.rail??"?"]=(rc[r.rail??"?"]??0)+1;
console.log("rail PROGRAMME:", Object.entries(rc).map(([k,v])=>`${k} x${v}`).join("  "));
const lc={}; for(const r of rows) lc[r.landmark??"?"]=(lc[r.landmark??"?"]??0)+1;
console.log("LANDMARK:", Object.entries(lc).map(([k,v])=>`${k} x${v}`).join("  "));
if (!(sc.round >= Math.max(3, Math.floor(rows.length * 0.08)))) {
  console.error(`\nFAIL  too few round parks (${sc.round ?? 0} across ${rows.length} islands — need at least ${Math.max(3, Math.floor(rows.length * 0.08))})`);
  process.exit(1);
}
console.log("\nis the park programme always the same shape?");
console.log("  city   nParks   largest/total   total area");
for(const r of rows.slice(0,12)){
  const t=r.areas.reduce((a,b)=>a+b,0);
  console.log(`  ${String(r.seed).slice(0,8).padStart(9)} ${String(r.nPark).padStart(6)} ${(Math.max(...r.areas)/t*100).toFixed(0).padStart(13)}% ${Math.round(t/1000).toString().padStart(11)}k`);
}

// District silhouettes — Exchange reads taller than Millside on the same town.
import { makeCity, PROCEDURAL } from "../src/citygen/index.mjs";
const med = (arr) => { const s=[...arr].sort((a,b)=>a-b); return s.length?s[Math.floor(s.length/2)]:0; };
let districtFails = 0;
for (const seed of [20261, 481923, 550991]) {
  const p = makeCity(PROCEDURAL, seed, { size: "city", density: "development" }).parcels;
  const byD = {};
  for (const r of Object.values(p)) {
    if ((r.floors ?? 0) <= 0) continue;
    (byD[r.district] ??= []).push(r.floors);
  }
  const ranked = Object.entries(byD).filter(([, fs]) => fs.length >= 8).sort((a, b) => med(b[1]) - med(a[1]));
  const tall = ranked[0]?.[1] ?? [];
  const low = ranked[ranked.length - 1]?.[1] ?? [];
  const ok = tall.length >= 20 && low.length >= 8 && med(tall) > med(low);
  if (!ok) districtFails++;
  console.log(`\nDISTRICT MASSING seed ${seed}: tallest med ${med(tall)} (n=${tall.length})  shortest med ${med(low)} (n=${low.length})  ${ok ? "OK" : "FAIL"}`);
}
if (districtFails) { console.log(`\nFAIL  ${districtFails} seed(s) — exchange should read taller than millside`); process.exit(1); }

// Inland water — a harbour notch is not a creek in the streets.
const streams = [];
for (let i = 0; i < N; i++) {
  const seed = (2166136261 ^ ((i + 1) * 2654435761)) >>> 0;
  let cfg; try { cfg = islandConfig(seed); } catch { continue; }
  streams.push({
    seed,
    prog: cfg.plan?.streamProgramme ?? "?",
    n: cfg.plan?.nStreams ?? (cfg.streams ?? []).filter((st) => st.kind !== "pond").length,
    ponds: cfg.plan?.nPonds ?? 0,
    bridges: cfg.plan?.nBridges ?? (cfg.bridges ?? []).length,
  });
}
const wet = streams.filter((r) => r.n > 0).length;
const sp = {};
for (const r of streams) sp[r.prog] = (sp[r.prog] ?? 0) + 1;
console.log(`\nSTREAMS across ${streams.length} islands: ${wet} have inland water (${(100 * wet / streams.length).toFixed(0)}%)`);
console.log("stream PROGRAMME:", Object.entries(sp).map(([k, v]) => `${k} x${v}`).join("  "));
console.log(`bridges: median ${Math.round(q(streams.map((r) => r.bridges), 0.5))}  ponds: median ${Math.round(q(streams.map((r) => r.ponds), 0.5))}`);
if (wet < Math.floor(streams.length * 0.5)) {
  console.error(`\nFAIL  inland water on ${wet}/${streams.length} islands — need at least half`);
  process.exit(1);
}
if (Object.keys(sp).length < 2) {
  console.error(`\nFAIL  stream programme collapsed to ${Object.keys(sp).join(",")}`);
  process.exit(1);
}
const topShare = Math.max(...Object.values(sp)) / streams.length;
if (topShare > 0.72) {
  console.error(`\nFAIL  one stream programme is ${(topShare * 100).toFixed(0)}% of towns — the generator stopped generating`);
  process.exit(1);
}

// Geometry the map can actually paint. Capsules cut lots but must not be
// drawn — a stack of them is the blocky mill-pond-in-the-park. Painted
// ribbons may meander (concave) but must not cross themselves.
{
  const crosses = (ring) => {
    const n = ring.length;
    const ori = (a, b, c) => {
      const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
    };
    const hit = (a, b, c, d) => {
      const o1 = ori(a, b, c), o2 = ori(a, b, d), o3 = ori(c, d, a), o4 = ori(c, d, b);
      return o1 && o2 && o3 && o4 && o1 !== o2 && o3 !== o4;
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (hit(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
      }
    }
    return false;
  };
  let folded = 0, coarsePond = 0, huge = 0, nPond = 0, nCut = 0, nPaint = 0, spiky = 0, blocky = 0;
  for (let i = 0; i < N; i++) {
    const seed = (2166136261 ^ ((i + 1) * 2654435761)) >>> 0;
    let cfg; try { cfg = islandConfig(seed); } catch { continue; }
    let paintedWater = 0;
    for (const st of cfg.streams ?? []) {
      const ring = st.ring;
      if (!ring || ring.length < 3) continue;
      if (st.paint === false) {
        nCut++;
        if (!isConvex(ring)) folded++;
        const [x0, y0, x1, y1] = bboxOfRing(ring);
        if ((x1 - x0) > 180 || (y1 - y0) > 180) huge++;
        continue;
      }
      nPaint++;
      if (st.kind === "pond") {
        nPond++;
        if (ring.length < 40) coarsePond++;
        if (!isConvex(ring)) folded++;
      } else if (st.kind === "creek" || st.kind === "canal") {
        paintedWater++;
        if (crosses(ring)) spiky++;
      }
    }
    if (paintedWater > 12) blocky++;
  }
  console.log(`stream GEOMETRY: paint ${nPaint}  cut ${nCut}  non-convex-cut ${folded}  oversized-cut ${huge}  ponds ${nPond} coarse ${coarsePond}  crossed ${spiky}  blocky-islands ${blocky}`);
  if (folded) {
    console.error(`\nFAIL  ${folded} lot-cut rings are not convex`);
    process.exit(1);
  }
  if (huge) {
    console.error(`\nFAIL  ${huge} lot-cut rings span >180 m — a capsule should be one segment`);
    process.exit(1);
  }
  if (nPond && coarsePond) {
    console.error(`\nFAIL  ${coarsePond}/${nPond} ponds have fewer than 40 vertices — a jagged mill pond`);
    process.exit(1);
  }
  if (spiky) {
    console.error(`\nFAIL  ${spiky} painted creeks cross themselves — that is the triangular loop`);
    process.exit(1);
  }
  if (blocky) {
    console.error(`\nFAIL  ${blocky} islands paint more than 12 water pieces — capsules leaked onto the map`);
    process.exit(1);
  }
}

const failMono = (label, dist) => {
  const keys = Object.keys(dist);
  if (keys.length < 2) {
    console.error(`\nFAIL  ${label} collapsed to ${keys.join(",") || "nothing"}`);
    process.exit(1);
  }
  const share = Math.max(...Object.values(dist)) / Object.values(dist).reduce((a, b) => a + b, 0);
  if (share > 0.78) {
    console.error(`\nFAIL  ${label} is ${(share * 100).toFixed(0)}% one value — the generator stopped generating`);
    process.exit(1);
  }
};
failMono("coast programme", cc);
failMono("grain programme", gc);
failMono("rail programme", rc);
failMono("landmark", lc);
const flavoured = rows.filter((r) => (r.flavours ?? []).some((f) => f !== "park")).length;
if (flavoured < Math.floor(rows.length * 0.7)) {
  console.error(`\nFAIL  only ${flavoured}/${rows.length} towns have a cemetery/battery/market`);
  process.exit(1);
}
if ((fc.cemetery ?? 0) < Math.max(2, Math.floor(rows.length * 0.15))) {
  console.error(`\nFAIL  too few cemeteries (${fc.cemetery ?? 0})`);
  process.exit(1);
}
if ((fc.battery ?? 0) < 2 || (fc.market ?? 0) < 2) {
  console.error(`\nFAIL  battery ${fc.battery ?? 0} market ${fc.market ?? 0} — public ground collapsed`);
  process.exit(1);
}

console.log("\nvariety pass (parks + flavours + coast + grain + rail + landmark + streams)");
