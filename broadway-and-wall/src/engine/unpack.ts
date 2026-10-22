// A RESERVED NEIGHBOURHOOD, UNPACKED (the region map, Phase 4).
//
// Phase 1 kept each outer subdivision as one reserved record outside the
// engine (citygen region: `reserved`, with a recipe that redraws its lots).
// When something needs one of its houses as a deed of its own — a house sale,
// a site somebody wants to assemble — the neighbourhood is unpacked: its
// houses come into the parcel table one deed each, redrawn from the recipe
// (citygen neighbourhoodLots), deterministically, so the page, the worker and
// a harness all arrive at the same lots from the state alone. A save stores
// one number per neighbourhood (`growth.unpacked`).
//
// What an unpacked house is: a family's home on its lot — owner-occupied, so
// it is not rental stock and has no rent roll; it is held off the market the
// way a closed house on a plat is (homes.ts isHomeOffMarket: a "family" unit,
// closed at the opening), until a resale market for owner-occupied houses
// exists to trade it. Its zoning is the subdivision's own: single-family,
// FAR 0.45 (proforma.ts LOW_DENSITY_ZONES "R-1").
import type { ParcelTable, ParcelRecord } from "@/data/types";
import type { GameState } from "./types";
import { bumpTable } from "./tableVersion";
import { neighbourhoodLots } from "@/citygen/index.mjs";

/** The deed of house `n` in neighbourhood `id`: 7 + the tract's survey number (5 digits) + the house (4). */
export const unpackedBbl = (id: number, n: number) => String(7e9 + (id % 1e5) * 1e4 + n);
/** A single-family district: a house and a garage, FAR 0.45 [S, typical R-1]. */
const R1 = { zone: "R-1", far: 0.45 };
/** The farm-texture stamp under a suburban lot with no comparable sales behind it (as landdev.ts lotRecords): Illinois cropland, $/sf (USDA NASS 2024). */
const LAND_STAMP = 9600 / 43560;

/** The houses of one neighbourhood as parcel records, regenerated from the recipe. */
function houseRecords(s: GameState, parcels: ParcelTable, id: number): ParcelRecord[] {
  const nb = neighbourhoodLots(s.growth?.mapSeed ?? s.seed, id);
  if (!nb) return [];
  // the shape of a record: an ordinary house deed of the town's (the inner ring's), with this lot's facts
  let tpl: ParcelRecord | undefined;
  for (const b in parcels) { const p = parcels[b]; if (p.class === "multifamily" && p.bldgClass === "A1") { tpl = p; break; } }
  if (!tpl) return [];
  return nb.lots.map((l, k) => ({
    ...tpl!,
    bbl: unpackedBbl(id, k + 1),
    address: `Neighbourhood ${id}, house ${k + 1}`,
    block: `N${id}`, lot: String(k + 1),
    district: "outskirts", districtName: "The Outskirts",
    zoneDist: R1.zone, farMaxComm: R1.far, farMaxRes: R1.far,
    class: "multifamily" as const, bldgClass: "A1", mix: undefined,
    lotArea: l.a, bldgArea: l.houseSf, floors: l.storeys, yearBuilt: nb.year, unitsRes: 1,
    lotFront: l.f, lotDepth: l.d, corner: false,
    landPsf: LAND_STAMP, landPsfHistory: [LAND_STAMP], imputed: [],
    assessedLand: Math.round(l.a * LAND_STAMP * 0.45), assessedTotal: Math.round(l.a * LAND_STAMP * 0.45 + l.houseSf * 60),
    centroid: l.c,
    ag: undefined, tract: undefined, homeLot: undefined, centre: undefined,
  }));
}

/**
 * Put every unpacked neighbourhood's houses into the parcel table (and the
 * BBL list), in place; idempotent, a pure function of the state. Returns the
 * BBLs it added.
 */
export function materializeNeighbourhoods(s: GameState, parcels: ParcelTable, bbls?: string[]): string[] {
  const added: string[] = [];
  for (const k of Object.keys(s.growth?.unpacked ?? {})) materializeNeighbourhood(s, parcels, bbls, Number(k), added);
  return added;
}
/** One unpacked neighbourhood's houses into the table (sim.ts restoreCuts replays them in the order they were cut). */
export function materializeNeighbourhood(s: GameState, parcels: ParcelTable, bbls: string[] | undefined, id: number, added: string[] = []): string[] {
  if (s.growth?.unpacked?.[id] === undefined || parcels[unpackedBbl(id, 1)]) return added;
  bumpTable(parcels);
  for (const r of houseRecords(s, parcels, id)) {
    if (parcels[r.bbl]) continue;
    parcels[r.bbl] = r;
    bbls?.push(r.bbl);
    added.push(r.bbl);
  }
  return added;
}

/**
 * Unpack neighbourhood `id` (the reserved record `N<id>`): its houses become
 * deeds, each a family's home (off the market, homes.ts). Returns the new BBLs;
 * [] if it is already unpacked or there is no such neighbourhood.
 */
export function unpackNeighbourhood(s: GameState, parcels: ParcelTable, bbls: string[], id: number): string[] {
  if (s.citySize !== "region" || !s.growth || s.growth.unpacked?.[id] !== undefined) return [];
  const recs = houseRecords(s, parcels, id);
  if (!recs.length) return [];
  (s.growth.unpacked ??= {})[id] = s.month;
  (s.cutOrder ??= []).push("u:" + id);
  const added = materializeNeighbourhoods(s, parcels, bbls);
  s.homes ??= { units: {}, builders: {} };
  for (const r of recs) {
    s.homes.units[r.bbl] ??= { bbl: r.bbl, parent: `N${id}`, by: "family", sf: r.bldgArea, startM: 0, doneM: 0, budget: 0, spent: 0, lotCost: 0, closedM: 0 };
  }
  return added;
}
