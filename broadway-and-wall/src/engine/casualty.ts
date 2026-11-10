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
 * WHEN IT IS REBUILT. Comerio & Blecher (2010, Earthquake Spectra 26(4)),
 * from about 4,900 permit records after Loma Prieta and Northridge: a typical
 * repair took two years and a replacement almost four. So a replacement here
 * completes about REPLACE_M after the loss: the building goes up on the class's
 * own build time (BUILD_MONTHS, its middle) after a wait for the adjuster, the
 * design and the permit, spread across the lost buildings (a hash of the deed,
 * uniform from none to twice the typical wait) so they do not all break ground,
 * and come back, in one month. The market knows of each from the day of the
 * loss (it is in the pipeline); it is a construction start, and holds a crew,
 * from its groundbreak. Business-interruption cover for the lost
 * rent is not modelled; the owner carries its loan through the rebuild. The
 * insurers' capital index (opexIdx.insCap) is a share of a national insured
 * base one town's loss does not move. The player's own buildings are not
 * handled here.
 */
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, GameState } from "./types";
import { HARD_COST_PSF, heightPremium, constructionTypeMult, rentableSf, resolveRec } from "./value";
import { retireStock, BUILD_MONTHS } from "./market";
import { ownerFirm, PLAYER } from "./firms";
import { queueSupplyProject } from "./supply";
import { hash01 } from "./competitorTraits";

/** Months from the loss to a replaced building's completion: "almost four years" (Comerio & Blecher 2010). */
const REPLACE_M = 46;

export interface CasualtyClaim { bbl: string; paid: number; lostSf: number; groundM: number; deliverM: number }

export function casualtyLoss(s: GameState, parcels: ParcelTable, bbl: string): CasualtyClaim | null {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) return null;
  if (ownerFirm(s, bbl) === PLAYER) return null;
  const k = rec.class as BuiltClass;
  const floors = Math.max(1, rec.floors || 1);
  const paid = Math.round(rec.bldgArea * (HARD_COST_PSF[k] ?? 0) * constructionTypeMult(k, floors) * (s.econ.costIdx ?? 1) * heightPremium(floors));
  const lostSf = rentableSf(rec);
  const [b0, b1] = BUILD_MONTHS[k] ?? [12, 24];
  const buildM = Math.round((b0 + b1) / 2);
  const groundM = s.month + Math.round(hash01(`restore|${bbl}|${s.month}`) * 2 * Math.max(0, REPLACE_M - buildM));
  const deliverM = groundM + buildM;
  s.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  retireStock(s.econ, rec);
  s.demolished = (s.demolished ?? 0) + 1;
  // the restoration: the same building, funded by the claim, on the owner's deed
  (s.cityJobs ??= []).push({
    bbl, use: k, sf: rec.bldgArea, floors, startM: groundM, deliverM,
    ...(rec.mix ? { mix: { ...rec.mix } } : {}),
    cost: paid, spent: paid, equityLeft: 0, debt: 0, commitment: 0,
  });
  queueSupplyProject(s, { bbl, source: "city", startM: groundM, deliverM, sfByUse: rec.mix ? Object.fromEntries(Object.entries(rec.mix).map(([u, w]) => [u, lostSf * (w as number)])) : { [k]: lostSf } });
  return { bbl, paid, lostSf, groundM, deliverM };
}
