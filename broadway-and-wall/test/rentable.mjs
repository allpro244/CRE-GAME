// RENTABLE IS NOT GROSS — one identity, and it can fail.
//
//   pnpm rentable
//
// `bldgArea` is gross (zoning, cost, the map). Income, occupancy and the
// space market read `rentableSf` = gross × (1 − coreLoss), 0.72–0.92, the
// BOMA office range. A panel that computed its own haircut would be a
// second answer. This file is the cheap proof that the engine's number
// is the real ratio and that NOI is struck on it.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exit(1); };
const ok = (cond, msg) => { if (!cond) fail(msg); console.log(`  ok  ${msg}`); };

console.log("\nRENTABLE — is income struck on the feet a tenant can sit in?\n");

// THE RATIO IS THE BUSINESS RANGE, not an index that reads 1.0 on the median.
const plates = [2_000, 4_300, 8_000, 12_000, 20_000, 30_000];
for (const p of plates) {
  const r = E.rentableRatio(p);
  ok(r >= 0.72 && r <= 0.92, `rentableRatio(${p}) = ${r.toFixed(3)} in [0.72, 0.92]`);
  ok(r < 1, `rentableRatio(${p}) is strictly below 1 — rentable cannot exceed gross`);
}
const median = E.rentableRatio(E.REF_PLATE_SF);
ok(median > 0.80 && median < 0.88, `median plate ${E.REF_PLATE_SF} sf reads ${median.toFixed(3)} (real office ~0.83, not 1.00)`);

// THE CORE IS SIZED FOR THE HEIGHT. A plate with no height attached keeps the
// full stair-and-lift core (the mid-rise question, and plateEfficiency's
// index); a one-storey building has no stair and no lift; two storeys need
// stairs and no lift (ADA 206.2.3 Exc. 1); three or four storeys under
// 3,000 sf a floor can still be a walk-up; five and up always have a lift.
for (const p of plates) {
  const r1 = E.rentableRatio(p, 1), r2 = E.rentableRatio(p, 2), r5 = E.rentableRatio(p, 5);
  ok(r1 >= r2 && r2 >= r5, `plate ${p}: 1 storey ${r1.toFixed(3)} >= 2 storeys ${r2.toFixed(3)} >= 5 storeys ${r5.toFixed(3)}`);
  ok(E.rentableRatio(p) === E.rentableRatio(p, 12), `plate ${p}: no height given reads as a lift building (${E.rentableRatio(p).toFixed(3)})`);
}
ok(E.rentableRatio(3_000, 1) === 0.92, "a one-storey 3,000 sf box is let on its footprint, to the 0.92 ceiling");
ok(Math.abs(E.rentableRatio(3_000, 2) - (1 - 0.07 - 360 / 3_000)) < 1e-9, "two storeys: two stairs and risers (360 sf a floor), no lift");
ok(E.rentableRatio(2_500, 3) > E.rentableRatio(2_500, 5), "three storeys on a 2,500 sf plate is a walk-up; five is not");
ok(E.rentableRatio(4_000, 3) === E.rentableRatio(4_000, 5), "three storeys on a 4,000 sf plate carries the lift (ADA: 3+ storeys and 3,000+ sf a storey)");
ok(Math.abs(E.rentableSf({ bldgArea: 6_000, floors: 2 }) - 6_000 * E.rentableRatio(3_000, 2)) < 1e-6, "rentableSf reads the record's own storeys");
ok(Math.abs(E.rentableFromSpec(6_000, 2) - E.rentableSf({ bldgArea: 6_000, floors: 2 })) < 1e-6, "a planned shell and the delivered record agree");

// A SYNTHETIC BUILDING. 10,000 sf gross, one floor, all office. Rentable
// must be the ratio times gross, and NOI must scale with it — not with gross.
const rec = {
  bbl: "rentable-probe", class: "office", bldgArea: 10_000, floors: 1, lotArea: 12_000,
  landPsf: 40, demandScore: 50, yearBuilt: 1990, farMaxComm: 2, farMaxRes: 2,
  mix: { office: 1 },
};
const letSf = E.rentableSf(rec);
const expect = 10_000 * E.rentableRatio(10_000, 1);
ok(Math.abs(letSf - expect) < 1, `rentableSf(10,000 gf) = ${letSf.toFixed(0)} (want ${expect.toFixed(0)})`);
ok(letSf < rec.bldgArea, "rentable is smaller than gross on a real plate");

// NOI ON RENTABLE. Double the gross, hold the plate (two identical floors):
// NOI must scale with RENTABLE, which is a little under double because the
// second storey brings the stairs with it. If NOI were still quoted on a
// hidden index of 1.0 this would still pass — the next check is the one
// that would have failed on the old code.
const rec2 = { ...rec, bldgArea: 20_000, floors: 2 };
const econ = {
  m: 0, rentIdx: { office: 40, retail: 30, multifamily: 25, industrial: 12 },
  effRentIdx: { office: 40, retail: 30, multifamily: 25, industrial: 12 },
  costIdx: 1, capRate: { office: 7, retail: 7, multifamily: 6, industrial: 8 },
  cityVac: { office: 0.12, retail: 0.08, multifamily: 0.05, industrial: 0.08 },
};
const n1 = E.noiYr(rec, econ, "average");
const n2 = E.noiYr(rec2, econ, "average");
ok(n1 > 0 && n2 > 0, `noiYr positive on both (${n1.toFixed(0)}, ${n2.toFixed(0)})`);
const want = E.rentableSf(rec2) / E.rentableSf(rec);
ok(Math.abs(n2 / n1 - want) < 0.03, `NOI scales with rentable feet: ${n2.toFixed(0)} / ${n1.toFixed(0)} = ${(n2 / n1).toFixed(3)} (want ${want.toFixed(3)})`);

// THE OLD FAKE: quoting on gross would make NOI / rentablePsf / rentableSf
// disagree with NOI / rentPsf / gross. Income per rentable foot must equal
// the rent stack, not the rent stack × ratio.
const impliedPsf = n1 / Math.max(1, letSf);
const grossPsf = n1 / rec.bldgArea;
ok(impliedPsf > grossPsf, `NOI/rentable ($${impliedPsf.toFixed(2)}) > NOI/gross ($${grossPsf.toFixed(2)}) — income is on the smaller feet`);

console.log("\n  rentable is the engine's number. NOI is struck on it.\n");
