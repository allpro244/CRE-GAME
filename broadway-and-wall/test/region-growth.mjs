// THE REGION GROWING, THIRTY YEARS (region expansion, Phase 4).
//
//   pnpm -s exec node test/region-growth.mjs [seed ...]      seeds 1-3 by default
//   Y=10 pnpm -s exec node test/region-growth.mjs 2          a shorter run
//
// No player: the town, its land developers, homebuilders, county and state
// run on their own (CLAUDE.md: the world must exist without the player). Every
// five years it prints the record growth.ts keeps — people, households, houses
// built, acres platted, the farm-price gradient by distance from served land,
// the roads opened, the centres, the inner ring rebuilt — and at the end it
// asserts the bands below. The bands are what a Midwest county seat does over
// three decades (Census county population estimates; Census Survey of
// Construction for houses per household), wide on purpose: they catch a
// broken mechanism, not a calibration.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
// file URLs: a bare Windows path ("D:\...") is not an import specifier
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity, REGION } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const YEARS = Number(process.env.Y ?? 30);
if (process.env.NOGROWTH) globalThis.BW_NO_GROWTH = true;
const seeds = process.argv.slice(2).map(Number);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const ml = (m) => `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m % 12]} ${2000 + Math.floor(m / 12)}`;
const k$ = (n) => `$${Math.round(n).toLocaleString()}`;
const finite = (o, path = "") => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number" && !Number.isFinite(v)) fail(`${path}${k} is ${v}`);
    else if (v && typeof v === "object") finite(v, `${path}${k}.`);
  }
};

// THE DECADE TABLE: the growth a visitor would see, at years 0, 10, 20, 30 —
// and the land's price by distance from downtown (mean $/sf of land over every
// town and fringe deed, farms apart, by km from the town's centre).
const DT_BANDS = [500, 1000, 2000, 3000, Infinity];
function decade(g, parcels, bbls) {
  const P = E.roadPlan(g);
  const C = P.centre;
  const kx = 111320 * Math.cos((C[1] * Math.PI) / 180);
  const sums = DT_BANDS.map(() => [0, 0]);
  for (const b of bbls) {
    const raw = parcels[b];
    if (!raw || raw.ag || raw.tract || g.platted?.[b] || g.merged?.[b] || !(raw.lotArea > 0)) continue;
    const rec = E.resolveRec(parcels, g, b);
    if (!rec) continue;
    const d = Math.hypot((rec.centroid[0] - C[0]) * kx, (rec.centroid[1] - C[1]) * 110540);
    const k = DT_BANDS.findIndex((x) => d < x);
    const v = E.landPsfNow(rec, g.econ);
    if (Number.isFinite(v)) { sums[k][0] += v; sums[k][1]++; }
  }
  const R = g.growth?.roads, T = E.townSummary(g), H = g.growth?.hist ?? [];
  const opened = R?.opened ?? [];
  return {
    yr: Math.round(g.month / 12), pop: Math.round(g.econ.population ?? 0),
    houses: H.at(-1)?.newHomes ?? 0, family: Object.values(g.homes?.units ?? {}).filter((u) => u.by === "family").length,
    plats: H.at(-1)?.plats ?? 0, roads: opened.filter((o) => o.kind !== "highway").length,
    programmed: Object.values(R?.art ?? {}).filter((a) => a.status).length,
    hwy: opened.filter((o) => o.kind === "highway").length, maxAdt: H.at(-1)?.roads?.maxAdt ?? 0, fund: Math.round((R?.fund ?? 0) / 1e6),
    centres: T.centres, upzones: T.upzones, redev: T.redev, townBuilt: T.townBuilt, unpacked: Object.keys(g.growth?.unpacked ?? {}).length,
    land: sums.map(([v, n]) => (n ? +(v / n).toFixed(1) : 0)),
  };
}
const decadeLine = (r) => `  ${String(r.yr).padStart(2)} ${String(r.pop).padStart(7)} ${String(r.houses).padStart(6)} ${String(r.family).padStart(6)} ${String(r.plats).padStart(5)} ${String(r.roads).padStart(5)}+${r.programmed} ${String(r.hwy).padStart(3)} ${String(r.maxAdt).padStart(7)} ${String(r.fund).padStart(5)} ${String(r.centres).padStart(7)} ${String(r.upzones).padStart(7)} ${String(r.redev).padStart(5)} ${String(r.townBuilt).padStart(6)} ${String(r.unpacked).padStart(5)}  | ${r.land.map((x) => String(x).padStart(6)).join(" ")}`;
const DECADE_HEAD = "  yr     pop  houses family plats roads hwy  maxADT fund$M centres upzones redev  built unpkd  | land $/sf by km from downtown: <0.5  0.5-1  1-2  2-3  3+";

const all = [];
for (const seed of seeds.length ? seeds : [1, 2, 3]) {
  const city = makeCity(REGION, seed);
  const parcels = city.parcels, bbls = Object.keys(parcels);
  E.normalizeParcels(parcels);
  const lots0 = bbls.length;
  let g = E.firstListings(E.newGame(seed, parcels, undefined, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
  // the inner ring's houses at the opening: 1-3 unit frames (citygen region THE INNER RING IS HOUSES)
  const ring = bbls.filter((b) => { const p = parcels[b]; return p.class === "multifamily" && (p.unitsRes ?? 0) <= 3 && ["A1", "B1", "C0"].includes(p.bldgClass); });
  console.log(`\nseed ${seed} — ${city.name}: ${lots0} parcels, ${bbls.filter((b) => parcels[b].tract).length} farm tracts, ${ring.length} inner-ring houses, ${Math.round(g.econ.population).toLocaleString()} people`);
  const t0 = performance.now();
  const dec = [];
  for (let m = 0; m < YEARS * 12; m++) {
    if (m % 120 === 0) dec.push(decade(g, parcels, bbls));
    g = E.advanceQuarter(g, parcels, bbls, city.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  }
  dec.push(decade(g, parcels, bbls));
  const ms = (performance.now() - t0) / (YEARS * 12);
  console.log(`  timing: ${ms.toFixed(0)} ms a month`);
  const H = g.growth?.hist ?? [];
  console.log("  yr    pop     hh  renters newHomes  lots  acres plats bought refused  $/sf  roads(w/h)  maxADT   centres redev upzones   bid>farm  farm $/ac | mean ask by km from served: <0.5  0.5-1.5  1.5-3  3+");
  for (const r of H) {
    if (r.m % 60 !== 0 && r !== H.at(-1)) continue;
    const t = r.town ?? {};
    console.log(`  ${String(r.m / 12).padStart(2)} ${String(r.pop).padStart(7)} ${String(r.households).padStart(6)} ${String(r.renters).padStart(6)} ${String(r.newHomes).padStart(7)} ${String(r.lots).padStart(6)} ${String(Math.round(r.acres)).padStart(6)} ${String(r.plats).padStart(4)} ${String(H.filter((x) => x.m <= r.m).reduce((a, x) => a + x.bought, 0)).padStart(5)} ${String(H.filter((x) => x.m <= r.m).reduce((a, x) => a + x.refused, 0)).padStart(5)} ${String(r.homePsf).padStart(7)}    ${r.roads.widened}/${r.roads.highway}      ${String(r.roads.maxAdt).padStart(6)}   ${String(t.centres ?? 0).padStart(4)} ${String(t.redev ?? 0).padStart(6)} ${String(t.upzones ?? 0).padStart(5)}   ${String(r.bidding ?? 0).padStart(4)}   ${r.farmAcre.toLocaleString().padStart(7)} | ${r.gradient.map((x) => x.toLocaleString().padStart(7)).join(" ")}`);
  }
  const last = H.at(-1), first = H[0];
  if (!last || !first) { fail(`seed ${seed}: no growth record`); continue; }
  finite(last, `seed ${seed} `);
  const devs = Object.values(g.growth.devs);
  console.log(`  land developers: ${devs.map((d) => `${d.name} (${d.tracts} tracts, ${d.plats} plats, ${d.lots} lots, ${d.refused} refused${d.cash !== undefined ? `; cash ${k$(d.cash)}, debt ${k$(d.debt ?? 0)}, ${d.lotsSold ?? 0} lots sold${d.failedM !== undefined ? `, FAILED ${ml(d.failedM)}` : ""}` : ""})`).join("; ") || "none"}`);
  // the developers' books must add up: nobody owes a negative sum, and a failed one owes nothing
  for (const d of devs) {
    if ((d.debt ?? 0) < -1) fail(`seed ${seed}: ${d.name} owes ${d.debt}`);
    if (d.failedM !== undefined && (d.debt ?? 0) > 0) fail(`seed ${seed}: failed ${d.name} still owes ${d.debt}`);
    const loans = Object.values(d.loans ?? {}).reduce((t, l) => t + l.bal, 0);
    if (d.debt !== undefined && Math.abs(loans - d.debt) > 2 + 1e-6 * d.debt) fail(`seed ${seed}: ${d.name} debt ${d.debt} != its loans ${loans}`);
  }
  const builders = Object.values(g.homes?.builders ?? {});
  console.log(`  homebuilders: ${builders.map((b) => `${b.name} ${b.started} started, ${b.closed} closed`).join("; ") || "none"}`);
  const R = g.growth.roads;
  console.log(`  roads: ${R.opened.map((o) => `${o.kind} ${o.id} ${ml(o.m)}${o.cost ? ` ${k$(o.cost)}` : ""}`).join("; ") || "none opened"}; county fund ${k$(R.fund)}, last levy ${k$(R.levyYr)}`);
  const hw = Object.entries(R.hwy).filter(([, h]) => h.planM > 0);
  console.log(`  state plan: ${hw.map(([id, h]) => `${id} ${h.status}${h.openM ? ` ${ml(h.openM)}` : ` plan ${ml(h.planM)}`}${h.slips ? ` (${h.slips} slips)` : ""}`).join("; ") || "nothing proposed"}`);
  const T = g.growth.town;
  if (T) console.log(`  town: ${JSON.stringify(E.townSummary(g))}${T.centres?.length ? `; centres ${T.centres.map((c) => `${c.kind} ${Math.round(c.sf / 1000)}k sf ${ml(c.m)} (${c.households} hh)`).join("; ")}` : ""}`);
  console.log(`  month: ${ms.toFixed(0)} ms mean; parcels ${lots0} -> ${bbls.length}`);
  console.log(DECADE_HEAD);
  for (const r of dec) console.log(decadeLine(r));
  all.push({ seed, first, last, ms });
  // ---- the bands
  const gr = Math.pow(last.households / first.households, 12 / Math.max(12, last.m - first.m)) - 1;
  if (!(gr > -0.02 && gr < 0.04)) fail(`seed ${seed}: households grew ${(gr * 100).toFixed(2)}%/yr, outside -2..+4`);
  const perHh = last.newHomes / Math.max(1, last.households);
  if (!(perHh < 0.4)) fail(`seed ${seed}: ${last.newHomes} new houses on ${last.households} households`);
  if (last.newHomes > 0 && !(last.lots >= last.newHomes)) fail(`seed ${seed}: more houses than lots`);
  if (!(last.acres < 0.6 * bbls.filter((b) => parcels[b].tract || g.platted?.[b]).reduce((a, b) => a + parcels[b].lotArea / 43560, 0))) fail(`seed ${seed}: most of the county platted in ${YEARS} years`);
  // land nearer served land is not cheaper than land far from it (the gradient may be flat at the farm value)
  const gd = last.gradient.filter((x) => x > 0);
  for (let i = 1; i < gd.length; i++) if (gd[i] > gd[0] * 1.5) fail(`seed ${seed}: farmland far out (${gd[i]}) dearer than at the edge (${gd[0]})`);
}
if (all.length) {
  console.log(`\n${all.map((r) => `seed ${r.seed}: ${r.first.households}->${r.last.households} hh, ${r.last.newHomes} new houses, ${r.last.plats} plats/${Math.round(r.last.acres)} ac, ${r.last.roads.widened} widenings, ${r.last.roads.highway} highway segments, ${r.last.town?.centres ?? 0} centres, ${r.ms.toFixed(0)} ms/month`).join("\n")}`);
}
if (fails) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log("\nregion-growth pass");
