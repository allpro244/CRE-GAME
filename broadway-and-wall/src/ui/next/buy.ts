/**
 * THE DEFAULT FINANCING, PRICED (BUILD_SPEC 4.3). The preset names a desk (or
 * "cheapest" / "cash") and a share of its quoted principal; this resolves it
 * to the quote `closeDeal` will be asked for, with the same arithmetic the
 * classic BuyButtons stack prints (AcquireDesk.tsx): equity from `buyQuote`,
 * first-year debt service from the product's terms, NOI in place.
 */
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { buyQuote } from "@/engine/actions";
import { PRODUCTS } from "@/engine/debt";
import { inPlace, resolveRec } from "@/engine/value";
import { annualPayment } from "@/ui/panels/shared";
import type { BuyPreset } from "./nextStore";

export interface BuyPreview {
  product: string;
  label: string;
  lev: number;
  principal: number;
  equity: number;
  ratePct: number;
  ds: number;
  noi: number;
  cf: number;
  coc: number | null;
  dscr: number | null;
}

export function buyPreview(g: GameState, p: ParcelTable, bbl: string, price: number, preset: BuyPreset): BuyPreview {
  const isLand = p[bbl]?.class === "land";
  const choices = PRODUCTS.filter((x) => !x.mezz && (isLand ? x.uwDscr <= 0 : x.uwDscr > 0))
    .map((x) => ({ x, q: buyQuote(g, p, bbl, price, x.id, 1) }))
    .filter((c) => c.q.principal > 0)
    .sort((a, b) => a.q.allInPct - b.q.allInPct);
  let pick = preset.product === "cash" ? null
    : preset.product === "cheapest" ? choices[0] ?? null
    : choices.find((c) => c.x.id === preset.product) ?? choices[0] ?? null;
  const lev = pick ? Math.max(0, Math.min(1, preset.lev)) : 0;
  // under the smallest cheque a desk writes, the dial is all cash — as BuyButtons reads it
  const principal = pick && Math.round(pick.q.principal * lev) >= 100_000 ? Math.round(pick.q.principal * lev) : 0;
  if (!principal) pick = null;
  const full = pick ? pick.q : buyQuote(g, p, bbl, price, "cash", 1);
  const equity = !pick ? full.equity
    : lev >= 0.999 ? full.equity
    : price - principal + Math.round(price * 0.02) + Math.round((full.capPremium ?? 0) * lev) + Math.round((full.pointsFee ?? 0) * lev) - (full.deposits ?? 0);
  const rec = resolveRec(p, g, bbl);
  const noi = rec ? inPlace(rec, g, bbl, price).noi : 0;
  const def = pick?.x;
  const ds = pick && def ? (def.ioM > 0 ? principal * (full.ratePct / 100) : annualPayment(principal, full.ratePct, def.amortYears)) : 0;
  const cf = noi - ds;
  return {
    product: pick ? pick.x.id : "cash",
    label: def ? def.lender : "All cash",
    lev: pick ? lev : 0,
    principal,
    equity,
    ratePct: pick ? full.ratePct : 0,
    ds, noi, cf,
    coc: equity > 0 ? cf / equity : null,
    dscr: ds > 0 ? noi / ds : null,
  };
}

/** The desks a purchase can be financed by, for the preset control. */
export function buyDesks(isLand: boolean) {
  return PRODUCTS.filter((x) => !x.mezz && (isLand ? x.uwDscr <= 0 : x.uwDscr > 0)).map((x) => ({ id: x.id, lender: x.lender }));
}
