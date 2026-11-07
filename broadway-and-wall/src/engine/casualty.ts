/**
 * A BUILDING LOST TO FIRE OR STORM IS AN INSURED LOSS, AND IT IS REBUILT (2026-11-07).
 *
 * Owners carry replacement-cost property cover (ISO CP 00 10 with the
 * replacement-cost option; lenders require it under the mortgage clause), and
 * this engine already bills that cover as an operating cost (inputs.ts
 * opexIdx.ins). A replacement-cost policy pays the full cost to rebuild only
 * when the owner rebuilds (otherwise actual cash value), and the mortgagee,
 * named loss payee, releases the proceeds for restoration with its loan left
 * on the rebuilt building. So a loss is a reconstruction: the improvements come
 * down, the insurer funds the same building on the same lot, the owner keeps
 * the deed and the loan, and the space is off the market for the build.
 *
 * Without it a loss confiscated the owner's building and left the mortgage on
 * an empty lot: the supply-loss shocks wiped $67-142M of builder capital per
 * seed and office starts FELL after a fifth of the stock was lost (battery
 * triage, verified). Paying the claim as cash instead (an earlier cut) turned
 * flats starts backwards: owners kept the money and an empty lot.
 *
 * The rebuild runs on the class's ordinary build time (BUILD_MONTHS, upper
 * end: a restoration waits on the adjuster and the permit) and is a
 * construction start like any other. Business-interruption cover for the lost
 * rent is not modelled; the owner carries its loan through the rebuild. The
 * insurers' capital index (opexIdx.insCap) is a share of a national insured
 * base one town's loss does not move. The player's own buildings are not
 * handled here.
 */
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, GameState } from "./types";
import { HARD_COST_PSF, heightPremium, constructionTypeMult, rentableSf, resolveRec } from "./value";
import { addStock, BUILD_MONTHS } from "./market";
import { ownerFirm, PLAYER } from "./firms";
import { queueSupplyProject } from "./supply";

export interface CasualtyClaim { bbl: string; paid: number; lostSf: number; deliverM: number }

export function casualtyLoss(s: GameState, parcels: ParcelTable, bbl: string): CasualtyClaim | null {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) return null;
  if (ownerFirm(s, bbl) === PLAYER) return null;
  const k = rec.class as BuiltClass;
  const floors = Math.max(1, rec.floors || 1);
  const paid = Math.round(rec.bldgArea * (HARD_COST_PSF[k] ?? 0) * constructionTypeMult(k, floors) * (s.econ.costIdx ?? 1) * heightPremium(floors));
  const lostSf = rentableSf(rec);
  const deliverM = s.month + (BUILD_MONTHS[k]?.[1] ?? 24);
  s.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  addStock(s.econ, k, -lostSf);
  s.demolished = (s.demolished ?? 0) + 1;
  // the restoration: the same building, funded by the claim, on the owner's deed
  (s.cityJobs ??= []).push({
    bbl, use: k, sf: rec.bldgArea, floors, startM: s.month, deliverM,
    ...(rec.mix ? { mix: { ...rec.mix } } : {}),
    cost: paid, spent: paid, equityLeft: 0, debt: 0, commitment: 0,
  });
  queueSupplyProject(s, { bbl, source: "city", deliverM, sfByUse: rec.mix ? Object.fromEntries(Object.entries(rec.mix).map(([u, w]) => [u, lostSf * (w as number)])) : { [k]: lostSf } });
  return { bbl, paid, lostSf, deliverM };
}
