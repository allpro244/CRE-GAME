import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { loiNeedsPrincipal } from "@/engine/leasing";

/**
 * THE NEXT CLOCK.
 *
 * This is a game of deadlines — a contract you must fund, a letter that lapses,
 * a balloon, a lender's filing date — and the status bar showed none of them.
 * They sat on the docket sorted by kind, not by when. This is the one nearest
 * hard date across all of them, read straight off the state the engine acts
 * on (no second copy of any date), and the attention key that opens it.
 *
 * Only dates that cost something when missed. A balloon that rolls on its own
 * still counts: a rollover at the day's terms is a decision you are making by
 * not making one.
 */
export type NextDue = { m: number; what: string; title: string; key?: string; bbl?: string };

export function nextDue(g: GameState, parcels: ParcelTable | null): NextDue | null {
  const addr = (b: string) => parcels?.[b]?.address ?? b;
  const out: NextDue[] = [];
  for (const t of Object.values(g.talks ?? {})) {
    if (t.agreed && t.closeByM !== undefined) {
      out.push({ m: t.closeByM, what: "Fund", title: `Fund the purchase of ${addr(t.bbl)} — the deposit is lost after ${monthLabel(t.closeByM)}`, key: `contract:${t.bbl}`, bbl: t.bbl });
    }
  }
  for (const l of g.lois) {
    if (!loiNeedsPrincipal(g, l)) continue;
    out.push({ m: l.expiresM - 1, what: "Letter", title: `Answer ${l.name} on ${addr(l.bbl)} by ${monthLabel(l.expiresM - 1)}`, key: `loi:${l.id}`, bbl: l.bbl });
  }
  for (const h of Object.values(g.holdings)) {
    const o = h.sale?.offer;
    if (o && !(o.contract && !o.held)) {
      out.push({ m: o.expiresM, what: "Offer", title: `Offer on ${addr(h.bbl)} lapses ${monthLabel(o.expiresM)}`, key: `offer:${h.bbl}:${o.price}`, bbl: h.bbl });
    }
    if (h.loan && h.loan.maturityM - g.month <= 12) {
      out.push({ m: h.loan.maturityM, what: "Balloon", title: `Loan on ${addr(h.bbl)} balloons ${monthLabel(h.loan.maturityM)}`, bbl: h.bbl });
    }
  }
  if (g.facility && g.facility.maturityM - g.month <= 12) {
    out.push({ m: g.facility.maturityM, what: "Balloon", title: `The ${g.facility.lender} facility balloons ${monthLabel(g.facility.maturityM)}` });
  }
  for (const w of Object.values(g.workouts ?? {})) {
    out.push({ m: w.decideM, what: w.stage === "foreclosure" ? "Auction" : "Lender", title: `${w.lender} ${w.stage === "foreclosure" ? "sells" : "decides on"} ${addr(w.bbl)} ${monthLabel(w.decideM)}`, bbl: w.bbl });
  }
  const live = out.filter((d) => d.m >= g.month).sort((a, b) => a.m - b.m);
  return live[0] ?? null;
}
