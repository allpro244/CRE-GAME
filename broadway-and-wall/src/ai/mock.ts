// SCRIPTED STAND-INS FOR AN OUTSIDE AI — deterministic players that read only
// the brief, exactly as a real provider would. They exist so the whole
// pipeline (brief → reply → parse → orders → engine) can run offline, in the
// tests and in `pnpm ai-match` without a key. They are not tuned and are not
// meant to be good; `hold` is the control every other entrant is measured
// against.
import type { AiBrief } from "@/engine/aifirms";
import type { AiReply } from "./protocol";

export type MockStyle = "hold" | "yield" | "builder" | "contrarian";

type Row = Record<string, unknown>;
const n = (x: unknown) => (typeof x === "number" ? x : 0);

function yieldBuyer(b: AiBrief, minSpreadPp: number, leverage: number, why: string): AiReply {
  const f = b.firm as Row;
  const cash = n(f.cash);
  const rate = n(f.debtRatePct);
  const orders: unknown[] = [];
  let budget = cash * 0.8;
  for (const t of b.tape as Row[]) {
    const y = n(t.yieldPct), ask = n(t.ask);
    if (y < rate + minSpreadPp || ask <= 0) continue;
    const equity = ask * (1 - leverage) * 1.02 + 500_000;
    if (equity > budget) continue;
    orders.push({ action: "buy", bbl: t.bbl, maxPrice: ask, leverage });
    budget -= equity;
    if (orders.length >= 2) break;
  }
  // Take profit near the top: list the weakest-yielding income building.
  const phase = (b.market as Row).phase;
  if (phase === "peak") {
    const inc = (b.holdings as Row[]).filter((h) => n(h.sf) > 0 && !h.listed && !h.building && n(h.value) > 0);
    inc.sort((a, c) => n(a.noi) / n(a.value) - n(c.noi) / n(c.value));
    if (inc.length > 2) orders.push({ action: "sell", bbl: inc[0].bbl });
  }
  return { reasoning: `${why} Debt costs ${rate}%; buying only above ${(rate + minSpreadPp).toFixed(1)}% going-in. Phase: ${phase}.`, orders };
}

export const mockPlayers: Record<MockStyle, (b: AiBrief) => AiReply> = {
  hold: () => ({ reasoning: "Control entrant: holds cash every quarter.", orders: [{ action: "hold" }] }),
  yield: (b) => yieldBuyer(b, 0.75, 0.6, "Positive-leverage income buyer."),
  contrarian: (b) => {
    const phase = (b.market as Row).phase;
    if (phase === "recession" || phase === "depression" || phase === "recovery") return yieldBuyer(b, 0.25, 0.45, "Buys when the tape is weak.");
    return { reasoning: `Waiting out the ${phase}.`, orders: [] };
  },
  builder: (b) => {
    const orders: unknown[] = [];
    const cash = n((b.firm as Row).cash);
    for (const site of b.sites as Row[]) {
      const opts = (site.options as Row[]) ?? [];
      const go = opts.filter((o) => o.pencils && o.demandWaiting).sort((a, c) => n(c.yieldOnCost) - n(a.yieldOnCost))[0];
      if (go) { orders.push({ action: "develop", bbl: site.bbl, use: go.use, floors: go.maxFloors }); break; }
    }
    const lot = (b.land as Row[]).find((l) => n(l.ask) < cash * 0.3);
    if (lot && (b.holdings as Row[]).filter((h) => h.class === "land").length < 2) {
      orders.push({ action: "buy", bbl: lot.bbl, maxPrice: n(lot.ask), leverage: 0.4 });
    }
    return { reasoning: "Land that pencils, then build what the pro forma clears.", orders };
  },
};
