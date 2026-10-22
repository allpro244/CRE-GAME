/**
 * THE BEST SCHEMES ON A LOT (BUILD_SPEC 4.4). Every legal use at a spread of
 * heights up to its envelope, each through `planDevelopment`, ranked by the
 * hurdle ratio the Build desk's verdict reads. The Build desk's "Find the best
 * schemes" calls `sweepSchemes` too, so both rank with one function (R8).
 */
import type { GameState, DevUse, Contract, UseMix } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { planDevelopment, maxFloorsFor, zoneUseBar, devMix } from "@/engine/dev";
import { landRead, resolveRec } from "@/engine/value";
import { CONSTRUCTION_LENDER } from "@/engine/lenders";
import { derive } from "@/ui/derive";

export interface SchemeRow { use: DevUse; floors: number; coverage: number; hurdle: number; equity: number; profit: number; ltcMax: number; lender: string }

const DESK_USES: DevUse[] = ["office", "multifamily", "mixed", "retail", "industrial"];

export function sweepSchemes(
  g: GameState, p: ParcelTable, bbl: string, uses: DevUse[], cov: number, contract: Contract,
  custom: { mix?: UseMix; groundRetail?: "auto" | "on" | "off" } | ((u: DevUse) => { mix?: UseMix; groundRetail?: "auto" | "on" | "off" }),
  bank: string | undefined, spec: number, n = 3,
): SchemeRow[] {
  const rec = resolveRec(p, g, bbl);
  if (!rec) return [];
  const out: SchemeRow[] = [];
  for (const u of uses) {
    const top = maxFloorsFor(rec, cov, u);
    const steps = Array.from(new Set([2, 4, 6, 8, 12, 16, 20, 25, 30, 40, 50, top].filter((x) => x >= 1 && x <= top)));
    for (const f of steps) {
      const c = typeof custom === "function" ? custom(u) : custom;
      const plan = planDevelopment(g, p, bbl, u, f, cov, contract, undefined, c, bank, spec);
      if (!plan) continue;
      out.push({
        use: u, floors: f, coverage: cov, hurdle: plan.hurdleRatio, equity: plan.equity + plan.pointsCost,
        profit: plan.exitYield > 0 ? plan.stabNoi / (plan.exitYield / 100) - plan.basisTotal : 0,
        ltcMax: plan.ltcMax, lender: plan.lender,
      });
    }
  }
  return out.sort((a, b) => b.hurdle - a.hurdle).slice(0, n);
}

/**
 * The defaults the Build desk opens on: the land residual's coverage (else
 * 60%), GMP, the house construction desk, mid spec; uses the zoning allows.
 * Cached per lot per game state: the sweep is dozens of pro formas.
 */
export function bestSchemes(g: GameState, p: ParcelTable, bbl: string, n = 3): SchemeRow[] {
  return derive(g, "next.best:" + bbl + ":" + n, () => {
    const rec = resolveRec(p, g, bbl);
    if (!rec) return [];
    const seed = rec.class === "land" ? landRead(rec, g.econ).scheme : null;
    const cov = seed?.coverage ?? 0.6;
    // the zoning question asked at the height the desk opens on, as DevelopDesk asks it
    const fl = seed && seed.floors > 0 ? seed.floors : 8;
    const legal = DESK_USES.filter((u) => !zoneUseBar(rec, u, g.econ, u === "mixed" ? devMix("mixed", undefined) : undefined, fl));
    return sweepSchemes(g, p, bbl, legal, cov, "gmp", {}, CONSTRUCTION_LENDER, 0.5, n);
  }, [p]);
}
