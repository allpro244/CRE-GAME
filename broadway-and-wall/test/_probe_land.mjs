// probe: house value against income, and the land read, region and island
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity, REGION } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const med = (v) => { v = v.slice().sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN; };
function read(name, parcels, bbls, seed, size) {
  const g = E.firstListings(E.newGame(seed, parcels, 25e6, undefined, size ? { citySize: size, cityLots: bbls.length } : undefined), parcels, bbls);
  const e = g.econ;
  const inc = E.medianIncome(e);
  const houses = bbls.filter((b) => ["A1", "B1", "C0"].includes(parcels[b].bldgClass) && parcels[b].class === "multifamily" && (parcels[b].unitsRes ?? 0) <= 3);
  const hv = houses.map((b) => { const r = E.resolveRec(parcels, g, b); return { v: E.assetValue(r, e, E.initialCondition(r)), land: E.landValue(r, e), inc: E.incomeValueAsIs ? E.incomeValueAsIs(r, e, E.initialCondition(r)) : 0 }; });
  const vac = bbls.filter((b) => parcels[b].class === "land" && !parcels[b].ag);
  const reads = vac.map((b) => E.landRead(E.resolveRec(parcels, g, b), e));
  const win = {}; for (const r of reads) win[r.winner] = (win[r.winner] ?? 0) + 1;
  const mfAll = bbls.filter((b) => parcels[b].class === "multifamily").map((b) => { const r = E.resolveRec(parcels, g, b); return E.landValue(r, e) / Math.max(1, E.assetValue(r, e, E.initialCondition(r))); });
  console.log(`${name} seed ${seed}: P ${e.priceLevel.toFixed(2)} median HH $${Math.round(inc).toLocaleString()} | houses ${houses.length}: value med $${Math.round(med(hv.map((x) => x.v))).toLocaleString()} (land $${Math.round(med(hv.map((x) => x.land))).toLocaleString()}, income $${Math.round(med(hv.map((x) => x.inc))).toLocaleString()}) = ${(med(hv.map((x) => x.v)) / inc).toFixed(1)}x income | vacant ${vac.length} land $/sf med ${med(reads.map((r) => r.psf)).toFixed(2)} winners ${JSON.stringify(win)} | mf land/value med ${med(mfAll).toFixed(2)}`);
}
for (const seed of [1, 2, 3]) {
  const city = makeCity(REGION, seed);
  E.normalizeParcels(city.parcels);
  read("region", city.parcels, Object.keys(city.parcels), seed, "region");
}
for (const seed of [11, 22]) {
  const { parcels, bbls } = loadCity(0, E.normalizeParcels);
  read("island", parcels, bbls, seed);
}
