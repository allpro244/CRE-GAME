/**
 * WHICH CUT OF THE PARCEL TABLE THIS IS.
 *
 * The parcel table is not immutable: a finished plat, a recorded split and an
 * unpacked neighbourhood put deeds into it mid-game (sim.ts restoreCuts). Every
 * cache derived from the table (demand.ts demandModel, value.ts blockGeo,
 * owners.ts register, absorption.ts nbTable, towngrowth.ts statics, homes.ts
 * houseComps) is keyed on its identity AND this number, so it is a function of
 * the table as it stands — not of the table as it stood the first time it was
 * asked. Keyed on identity alone, a live game read the opening's table for the
 * whole campaign while the same save, Continued, read the table with its cuts:
 * measured on the region (test/region-reload.mjs, seed 3 at year 10), the
 * reloaded game diverged from the saved one in its first month.
 *
 * Bumped by whatever writes the table; read by the caches. A WeakMap, so the
 * table itself carries nothing and a structured copy (the sim worker's) starts
 * from its own count.
 */
const VER = new WeakMap<object, number>();
export function tableVersion(parcels: object): number {
  return VER.get(parcels) ?? 0;
}
export function bumpTable(parcels: object): void {
  VER.set(parcels, (VER.get(parcels) ?? 0) + 1);
}
