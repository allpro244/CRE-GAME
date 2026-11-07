/**
 * A BUILDING LOST TO FIRE OR STORM IS AN INSURED LOSS (2026-11-07).
 *
 * Owners carry replacement-cost property cover (ISO CP 00 10 with the
 * replacement-cost option; lenders require it under the mortgage clause), and
 * this engine already bills that cover as an operating cost (inputs.ts
 * opexIdx.ins). A loss with no claim confiscated the owner's equity and left
 * its mortgage owing on an empty lot: the supply-loss shocks wiped $67-142M of
 * builder capital per seed against $27-35M of builder cash, so the town's
 * builders shrank exactly when scarcity asked them to build, and office starts
 * FELL after a fifth of the stock was lost (battery triage, verified).
 *
 * A claim, in the order the policy pays it:
 * - the improvements come down, as a teardown takes them (the lot stays the owner's);
 * - the insurer pays what it costs to rebuild them today: the class's hard cost
 *   per gross foot on the pro forma's own path (HARD_COST_PSF x construction
 *   type x height x the cost index), the same number a builder underwrites;
 * - the mortgagee is paid first under the loss-payable clause (its loan is
 *   retired, and any shortfall is its loss, charged as such);
 * - the owner gets the rest.
 * A flat all-perils deductible ($10k-$250k on a commercial policy) is under 1%
 * of a total loss on a building of this size and is not modelled. The insurers'
 * capital index (opexIdx.insCap) is a share of a national insured base that one
 * town's loss does not move. The player's own buildings are not handled here.
 */
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, GameState } from "./types";
import { HARD_COST_PSF, heightPremium, constructionTypeMult, rentableSf, resolveRec } from "./value";
import { addStock } from "./market";
import { ownerFirm, rivalOf, PLAYER } from "./firms";
import { holderOf } from "./owners";
import { syncDebt, loanBookTouched } from "./rivalDebt";
import { chargeLenderLoss } from "./lenders";

export interface CasualtyClaim { bbl: string; owner: string; paid: number; toLender: number; toOwner: number; lostSf: number }

export function casualtyLoss(s: GameState, parcels: ParcelTable, bbl: string): CasualtyClaim | null {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) return null;
  const firm = ownerFirm(s, bbl);
  if (firm === PLAYER) return null;
  const k = rec.class as BuiltClass;
  const floors = Math.max(1, rec.floors || 1);
  const paid = Math.round(rec.bldgArea * (HARD_COST_PSF[k] ?? 0) * constructionTypeMult(k, floors) * (s.econ.costIdx ?? 1) * heightPremium(floors));
  const lostSf = rentableSf(rec);
  let toLender = 0, toOwner = 0, owner = "nobody";
  const r = firm ? rivalOf(s, firm) : undefined;
  if (r) {
    owner = r.name;
    const x = s.cityLoans?.[bbl];
    if (x && x.obligorId === r.id) {
      toLender = Math.min(paid, x.balance);
      if (x.balance > paid) chargeLenderLoss(s, x.lender, Math.round(x.balance - paid), { borrower: r.name, id: r.id, bbl, cls: "income", how: "uninsured shortfall" });
      delete s.cityLoans![bbl];
      loanBookTouched();
      syncDebt(s, r);
    }
    toOwner = paid - toLender;
    r.cash += toOwner;
  } else {
    const h = holderOf(s, parcels, bbl);
    if (h) {
      owner = h.name;
      const x = s.streetLoans?.[bbl];
      if (x) {
        toLender = Math.min(paid, x.balance);
        if (x.balance > paid) chargeLenderLoss(s, x.lender, Math.round((x.balance - paid) * (x.share ?? 1)), { borrower: x.holder, id: "h:" + x.holderId, bbl, cls: "income", how: "uninsured shortfall" });
        delete s.streetLoans![bbl];
        loanBookTouched();
      }
      toOwner = paid - toLender;
      (s.holderCash ??= {})[h.id] = (s.holderCash[h.id] ?? 0) + toOwner;
    }
  }
  s.built[bbl] = { class: "land" as unknown as BuiltClass, bldgArea: 0, floors: 0, yearBuilt: 0 };
  addStock(s.econ, k, -lostSf);
  s.demolished = (s.demolished ?? 0) + 1;
  return { bbl, owner, paid: r || owner !== "nobody" ? paid : 0, toLender, toOwner, lostSf };
}
